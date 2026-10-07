-- =====================================================================
--  BROS Planbord — databasescript 038: testmodus (klantenportaal / aannemersportaal bekijken als een contact)
--  Een beheerder met profiles.testmodus (enkel aan te zetten in de SQL-editor) kiest in het Planbord een contact en opent
--  het klanten- of aannemersportaal zoals dat contact het ziet — ook als het contact nog geen login heeft.
--  Veiligheid: de testmodus geldt enkel
--    · voor een actieve beheerder met testmodus aan,
--    · in een LEES-transactie (PostgREST voert GET-aanvragen read-only uit): elke schrijfactie (RPC, opladen) loopt
--      dus gewoon onder de eigen rol en wordt geweigerd ("Geen toegang") — er kan niets in naam van de klant gebeuren,
--    · voor aanvragen met de header X-Client-Info = bros-voorbeeld=<rol>:<contact> (enkel het portaal in testmodus stuurt die;
--      het Planbord niet) en enkel voor het contact dat nu gekozen is (een ander tabblad met een vorig contact toont niets meer),
--    · max. 12 uur na het starten.
--  Vereist schema 37. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 37 then
    raise exception 'Voer eerst de scripts tot en met 037 uit.';
  end if;
end $$;

-- ---------- wie mag de testmodus gebruiken ----------
alter table public.profiles add column if not exists testmodus boolean not null default false;
-- testmodus kan niet via de app gewijzigd worden (enkel hier, in de SQL-editor)
create or replace function public.profiles_testmodus_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.testmodus is distinct from old.testmodus then
    raise exception 'De testmodus kan enkel in de SQL-editor van Supabase aan- of uitgezet worden.';
  end if;
  return new;
end $$;
drop trigger if exists profiles_testmodus_guard on public.profiles;
create trigger profiles_testmodus_guard before update on public.profiles for each row execute function public.profiles_testmodus_guard();
-- aanzetten voor Phil (beheerder). Ander account? Pas de voorwaarde aan en voer deze regel opnieuw uit.
-- (enkel de eerste keer: zolang nog niemand de testmodus heeft)
update public.profiles set testmodus = true where role = 'beheer' and active and (name ilike 'phil%' or email ilike 'phil%')
   and not exists (select 1 from public.profiles where testmodus);

-- ---------- het gekozen contact ----------
create table if not exists public.portaal_voorbeeld (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  contact_id uuid not null references public.contacten(id) on delete cascade,
  rol        text not null check (rol in ('klant', 'aannemer')),
  sinds      timestamptz not null default now()
);
alter table public.portaal_voorbeeld enable row level security;
drop policy if exists pvb_eigen on public.portaal_voorbeeld;
create policy pvb_eigen on public.portaal_voorbeeld for select to authenticated using (user_id = auth.uid());

-- het contact waarvoor deze aanvraag de testmodus gebruikt (null = geen testmodus)
create or replace function public.voorbeeld_contact(p_rol text)
returns uuid language sql stable security definer set search_path = public as $$
  select case
    when coalesce(nullif(current_setting('request.headers', true), '')::json->>'x-client-info', '') not like 'bros-voorbeeld=' || p_rol || ':%' then null
    when current_setting('transaction_read_only', true) is distinct from 'on' then null
    else (select v.contact_id from public.portaal_voorbeeld v join public.profiles p on p.id = v.user_id
           where v.user_id = auth.uid() and v.rol = p_rol and p.role = 'beheer' and p.active and p.testmodus
             and v.sinds > now() - interval '12 hours'
             and nullif(current_setting('request.headers', true), '')::json->>'x-client-info' = 'bros-voorbeeld=' || p_rol || ':' || v.contact_id::text)
  end
$$;

-- staat de testmodus aan voor deze aanvraag? (dan telt de eigen login niet mee)
create or replace function public.voorbeeld_actief()
returns boolean language sql stable security definer set search_path = public as $$
  select public.voorbeeld_contact('klant') is not null or public.voorbeeld_contact('aannemer') is not null
$$;

-- starten / stoppen (vanuit het Planbord)
create or replace function public.voorbeeld_start(p_contact uuid, p_rol text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'beheer' and active and testmodus) then
    raise exception 'De testmodus staat niet aan voor jouw account.';
  end if;
  if p_rol not in ('klant', 'aannemer') then raise exception 'Kies klant of aannemer.'; end if;
  if not exists (select 1 from public.contacten where id = p_contact and actief) then raise exception 'Dit contact staat op inactief.'; end if;
  if p_rol = 'klant' and not exists (select 1 from public.project_contacten where contact_id = p_contact and rol in ('bouwheer', 'contactpersoon')) then
    raise exception 'Dit contact is bij geen enkel project bouwheer of contactpersoon.';
  end if;
  if p_rol = 'aannemer' and not exists (select 1 from public.contacten where id = p_contact and soort <> 'klant') then
    raise exception 'Kies een aannemer, leverancier of studiebureau.';
  end if;
  insert into public.portaal_voorbeeld (user_id, contact_id, rol, sinds) values (auth.uid(), p_contact, p_rol, now())
    on conflict (user_id) do update set contact_id = excluded.contact_id, rol = excluded.rol, sinds = now();
end $$;
create or replace function public.voorbeeld_stop()
returns void language sql security definer set search_path = public as $$
  delete from public.portaal_voorbeeld where user_id = auth.uid();
$$;
create or replace view public.mijn_voorbeeld as
  select v.rol, v.contact_id, c.naam, c.bedrijf, v.sinds,
         (v.sinds > now() - interval '12 hours' and p.role = 'beheer' and p.active and p.testmodus and c.actief) as actief
  from public.portaal_voorbeeld v join public.contacten c on c.id = v.contact_id join public.profiles p on p.id = v.user_id
  where v.user_id = auth.uid();

-- ---------- de bestaande rol-functies kennen de testmodus (enkel bij lezen, zie boven) ----------
create or replace function public.is_klant()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'klant' and active from public.profiles where id = auth.uid()), false)
      or public.voorbeeld_contact('klant') is not null
$$;
create or replace function public.is_aannemer()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'aannemer' and active from public.profiles where id = auth.uid()), false)
      or public.voorbeeld_contact('aannemer') is not null
$$;
create or replace function public.mijn_contacten()
returns setof uuid language sql stable security definer set search_path = public as $$
  select c.id from public.contacten c where c.user_id = auth.uid() and c.actief and not public.voorbeeld_actief()
  union
  select x from (select public.voorbeeld_contact('klant') as x union select public.voorbeeld_contact('aannemer')) v where x is not null
$$;
create or replace function public.klant_projecten()
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct pc.project_id
  from public.project_contacten pc
  join public.contacten c on c.id = pc.contact_id
  where c.actief and pc.rol in ('bouwheer', 'contactpersoon')
    and ((c.user_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role = 'klant'))
         or c.id = public.voorbeeld_contact('klant'))
$$;
create or replace function public.aannemer_projecten()
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct pc.project_id
  from public.project_contacten pc
  join public.contacten c on c.id = pc.contact_id
  where c.actief and pc.rol not in ('bouwheer', 'contactpersoon')
    and ((c.user_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role = 'aannemer'))
         or c.id = public.voorbeeld_contact('aannemer'))
$$;

-- views die rechtstreeks op de login keken (zelfde kolommen, enkel de voorwaarde verruimd met het testcontact)
create or replace view public.klant_ik as
  select c.id, c.naam, c.bedrijf, c.email, c.gsm, c.portaal_login, pc.project_id, pc.rol, c.weekmail, c.taal
  from public.contacten c join public.project_contacten pc on pc.contact_id = c.id
  where (c.user_id = auth.uid() and not public.voorbeeld_actief()) or c.id = public.voorbeeld_contact('klant') or c.id = public.voorbeeld_contact('aannemer');
create or replace view public.klant_taken as
  select t.id, t.project_id, t.titel, t.eind, t.status, t.notitie_id, n.titel as notitie_titel, n.klant_zichtbaar as notitie_gedeeld, t.vaststelling_id, t.updated_at
  from public.taken t
  join public.contacten c on c.id = t.contact_id and ((c.user_id = auth.uid() and not public.voorbeeld_actief()) or c.id = public.voorbeeld_contact('klant') or c.id = public.voorbeeld_contact('aannemer'))
  left join public.notities n on n.id = t.notitie_id
  where t.project_id in (select public.klant_projecten());
create or replace view public.klant_notitie_taken as
  select t.id, t.notitie_id, t.project_id, t.titel, t.eind, t.status, coalesce(p.name, c.naam, '') as wie,
         ((c.user_id is not null and c.user_id = auth.uid() and not public.voorbeeld_actief()) or (c.id is not null and c.id = public.voorbeeld_contact('klant'))) as voor_mij
  from public.taken t
  join public.notities n on n.id = t.notitie_id and n.klant_zichtbaar
  left join public.profiles p on p.id = t.assignee
  left join public.contacten c on c.id = t.contact_id
  where t.project_id in (select public.klant_projecten());
create or replace view public.klant_assistent_berichten as
  select b.id, b.project_id, b.rol, b.tekst, b.created_at
  from public.assistent_berichten b join public.assistent_gesprekken g on g.id = b.gesprek_id
  where ((g.user_id = auth.uid() and not public.voorbeeld_actief()) or g.user_id = (select c.user_id from public.contacten c where c.id = public.voorbeeld_contact('klant')))
    and b.project_id in (select public.klant_projecten());

-- ---------- rechten ----------
select public.rechten_herstellen();
revoke insert, update, delete, truncate, references, trigger on public.portaal_pings from authenticated, anon;
revoke all on function public.portaal_ping() from public, anon, authenticated;
revoke all on function public.keuze_optie_ping() from public, anon, authenticated;
revoke all on function public.werf_foto_ping() from public, anon, authenticated;
revoke all on function public.werf_fotos_gedeeld() from public, anon, authenticated;
revoke all on function public.prijsvraag_doorzetten() from public, anon, authenticated;
revoke all on function public.prijsaanvraag_zonder_pv() from public, anon, authenticated;
revoke all on function public.profiles_testmodus_guard() from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.portaal_voorbeeld from authenticated, anon;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(38, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: toont wie de testmodus mag gebruiken (moet jouw naam zijn; leeg → zie de update-regel bovenaan)
select name, email from public.profiles where testmodus;
