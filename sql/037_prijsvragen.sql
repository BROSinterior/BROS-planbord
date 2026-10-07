-- =====================================================================
--  BROS Planbord — databasescript 037: prijsvragen (prijzen opvragen bij meerdere aannemers, vergelijken, gunnen per post)
--  Bouwt verder op de prijsaanvragen van script 025/028/033: één prijsaanvraag = één deelnemer van een prijsvraag.
--  1. prijsvragen: één ronde per keer — titel, bericht, deadline, gekozen loten of losse posten, status open → gesloten → gegund.
--     prijsaanvragen.prijsvraag_id / posten (losse posten; leeg = alle posten van de loten) / bijlagen (pdf van de aannemer).
--     Bestaande prijsaanvragen komen per project in één prijsvraag 'Prijsaanvragen vóór v1.38'.
--  2. Kandidaten hoeven niet aan het project gekoppeld te zijn: ze zien enkel hun eigen prijsaanvraag (projectnummer en gemeente).
--  3. Per post 'niet aangeboden'. Offerte als pdf in de private opslag 'offertes' (enkel de aannemer zelf en beheer).
--  4. Twee soorten prijsvraag: zonder prijzen (enkel posten, hoeveelheden en eenheden) of met onze prijzen als voorstel
--     (richtprijs = klantprijs − een afslag, standaard 10 %; de aannemer past aan waar nodig). De afslag zelf ziet hij niet.
--  5. prijsvraag_gunningen + prijsvraag_gunnen(): per post de winnaar kiezen (enkel ingediende prijzen); zijn prijs wordt de kostprijs.
--     Zonder prijzen blijft standaard de marge (klantprijs volgt); met onze prijzen blijft standaard de klantprijs (marge herrekend).
--     Posten met klantakkoord (akkoord/meerwerk/minwerk) houden altijd hun klantprijs.
--     Gegunde aannemers worden aan hun lot(en) gekoppeld; bij afronden krijgen de anderen status 'niet weerhouden'.
--  Vereist schema 36. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 36 then
    raise exception 'Voer eerst de scripts tot en met 036 uit.';
  end if;
end $$;

-- ---------- 1. prijsvragen ----------
create table if not exists public.prijsvragen (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projecten(id) on delete cascade,
  titel       text not null default '',
  bericht     text not null default '',
  deadline    date,
  loten       int[] not null default '{}',
  posten      uuid[],                                   -- null = alle posten van de loten
  richtprijs_marge numeric(6,4) check (richtprijs_marge is null or (richtprijs_marge >= 0 and richtprijs_marge < 0.9)),   -- null = zonder prijzen
  status      text not null default 'open' check (status in ('open', 'gesloten', 'gegund')),
  afgerond_op timestamptz,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists prijsvragen_project_idx on public.prijsvragen(project_id, created_at desc);
drop trigger if exists prijsvragen_touch on public.prijsvragen;
create trigger prijsvragen_touch before update on public.prijsvragen for each row execute function public.touch_updated_at();
alter table public.prijsvragen enable row level security;
drop policy if exists pv_beheer on public.prijsvragen;
create policy pv_beheer on public.prijsvragen for all to authenticated using (public.is_beheer()) with check (public.is_beheer());

alter table public.prijsaanvragen
  add column if not exists prijsvraag_id      uuid references public.prijsvragen(id) on delete cascade,
  add column if not exists posten             uuid[],
  add column if not exists bijlagen           jsonb not null default '[]'::jsonb,   -- [{path, naam, grootte, op}] — pdf's van de aannemer
  add column if not exists herinnerd_deadline timestamptz;                           -- herinnering kort vóór de deadline (één keer)
create index if not exists prijsaanvragen_pv_idx on public.prijsaanvragen(prijsvraag_id);
drop policy if exists pa_intern on public.prijsaanvragen;
drop policy if exists pa_lezen on public.prijsaanvragen;
drop policy if exists pa_beheer on public.prijsaanvragen;
create policy pa_lezen on public.prijsaanvragen for select to authenticated using (public.is_intern());
create policy pa_beheer on public.prijsaanvragen for all to authenticated using (public.is_beheer()) with check (public.is_beheer());
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.prijsaanvragen'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ 'status' loop
    execute format('alter table public.prijsaanvragen drop constraint %I', c);
  end loop;
  alter table public.prijsaanvragen add constraint prijsaanvragen_status_check check (status in ('open', 'ingediend', 'gekozen', 'afgesloten', 'niet_weerhouden'));
end $$;
alter table public.prijsvragen add column if not exists richtprijs_marge numeric(6,4);
alter table public.prijsvragen add column if not exists oud boolean not null default false;   -- samengevoegde prijsaanvragen van vóór v1.38
alter table public.prijsaanvraag_regels add column if not exists niet_aangeboden boolean not null default false;
alter table public.prijsaanvraag_regels add column if not exists richtprijs numeric(12,2);   -- voorstel van BROS (klantprijs − afslag), bij het versturen

-- bestaande prijsaanvragen: per project één prijsvraag
do $$
declare r record; v uuid;
begin
  for r in select project_id, min(created_at) as op, max(deadline) as dl, (array_agg(created_by order by created_at))[1] as door,
                  bool_or(status in ('open', 'ingediend')) as loopt, bool_or(status = 'gekozen') as gekozen,
                  array(select distinct l from public.prijsaanvragen x, unnest(x.loten) l where x.project_id = a.project_id and x.prijsvraag_id is null order by l) as lots
             from public.prijsaanvragen a where prijsvraag_id is null group by project_id loop
    insert into public.prijsvragen (project_id, titel, deadline, loten, status, created_by, created_at, afgerond_op, oud)
      values (r.project_id, 'Prijsaanvragen vóór v1.38', r.dl, r.lots, case when r.loopt then 'open' when r.gekozen then 'gegund' else 'gesloten' end, r.door, r.op,
              case when r.loopt then null else now() end, true)
      returning id into v;
    update public.prijsaanvragen set prijsvraag_id = v where project_id = r.project_id and prijsvraag_id is null;
  end loop;
end $$;
update public.prijsvragen set oud = true where titel = 'Prijsaanvragen vóór v1.38' and not oud;
-- wie niet (meer) aan het project gekoppeld is, ziet geen klantnaam in de titel van een oude aanvraag
update public.prijsaanvragen a set titel = 'Prijsaanvraag ' || coalesce((select p.nummer from public.projecten p where p.id = a.project_id), '')
 where a.prijsvraag_id in (select id from public.prijsvragen where oud)
   and a.titel <> 'Prijsaanvraag ' || coalesce((select p.nummer from public.projecten p where p.id = a.project_id), '')
   and not exists (select 1 from public.project_contacten pc where pc.project_id = a.project_id and pc.contact_id = a.contact_id);

-- vangnet: een prijsaanvraag zonder prijsvraag (bv. vanuit een nog open Planbord van vóór v1.38) krijgt er meteen een
create or replace function public.prijsaanvraag_zonder_pv()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.prijsvraag_id is null then
    insert into public.prijsvragen (project_id, titel, bericht, deadline, loten, posten, created_by)
      values (new.project_id, coalesce(nullif(new.titel, ''), 'Prijsvraag'), new.bericht, new.deadline, new.loten, new.posten, new.created_by)
      returning id into new.prijsvraag_id;
  end if;
  return new;
end $$;
drop trigger if exists prijsaanvraag_zonder_pv on public.prijsaanvragen;
create trigger prijsaanvraag_zonder_pv before insert on public.prijsaanvragen for each row execute function public.prijsaanvraag_zonder_pv();

-- titel, bericht en deadline van de prijsvraag gelden voor alle lopende aanvragen; sluiten = wie nog niet indiende kan niets meer
create or replace function public.prijsvraag_doorzetten()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.titel is distinct from old.titel or new.bericht is distinct from old.bericht or new.deadline is distinct from old.deadline then
    update public.prijsaanvragen set titel = new.titel, bericht = new.bericht, deadline = new.deadline,
           herinnerd_deadline = case when new.deadline is distinct from old.deadline then null else herinnerd_deadline end
     where prijsvraag_id = new.id and status in ('open', 'ingediend');
  end if;
  if new.status in ('gesloten', 'gegund') and old.status = 'open' then
    update public.prijsaanvragen set status = 'afgesloten' where prijsvraag_id = new.id and status = 'open';
  end if;
  return null;
end $$;
drop trigger if exists prijsvraag_doorzetten on public.prijsvragen;
create trigger prijsvraag_doorzetten after update on public.prijsvragen for each row execute function public.prijsvraag_doorzetten();

-- ---------- 2. gunningen ----------
create table if not exists public.prijsvraag_gunningen (
  prijsvraag_id uuid not null references public.prijsvragen(id) on delete cascade,
  post_id       uuid not null references public.meetstaat_posten(id) on delete cascade,
  aanvraag_id   uuid not null references public.prijsaanvragen(id) on delete cascade,
  eenheidsprijs numeric(12,2) not null,
  gegund_door   uuid references public.profiles(id),
  gegund_op     timestamptz not null default now(),
  primary key (prijsvraag_id, post_id)
);
create index if not exists prijsvraag_gunningen_aanvraag_idx on public.prijsvraag_gunningen(aanvraag_id);
alter table public.prijsvraag_gunningen enable row level security;
drop policy if exists pvg_beheer on public.prijsvraag_gunningen;
create policy pvg_beheer on public.prijsvraag_gunningen for all to authenticated using (public.is_beheer()) with check (public.is_beheer());

-- ---------- 3. wat de aannemer ziet: ook zonder koppeling aan het project, enkel zijn eigen aanvragen ----------
drop view if exists public.aan_prijsaanvraag_posten;
drop view if exists public.aan_prijsaanvragen;
create view public.aan_prijsaanvragen as
  select a.id, a.project_id, a.loten, a.titel, a.bericht, a.deadline, a.status, a.opmerking, a.ingediend_op, a.created_at,
         a.prijsvraag_id, a.bijlagen,
         coalesce(v.status, 'open') as prijsvraag_status, (v.richtprijs_marge is not null) as met_richtprijs,
         case when v.status = 'gegund' or v.id is null then (select count(*) from public.prijsvraag_gunningen g where g.aanvraag_id = a.id)::int else 0 end as gegund_posten
  from public.prijsaanvragen a
  left join public.prijsvragen v on v.id = a.prijsvraag_id
  where public.is_aannemer() and a.contact_id in (select public.mijn_contacten());
create view public.aan_prijsaanvraag_posten as
  select a.id as aanvraag_id, m.id as post_id, m.lot, m.code, m.groep, m.omschrijving, m.locatie, m.eenheid, m.prijstype, m.hoeveelheid, m.volgorde,
         r.eenheidsprijs, coalesce(r.opmerking, '') as opmerking, coalesce(r.niet_aangeboden, false) as niet_aangeboden, r.richtprijs,
         exists (select 1 from public.prijsvraag_gunningen g join public.prijsvragen v on v.id = g.prijsvraag_id
                  where g.aanvraag_id = a.id and g.post_id = m.id and v.status = 'gegund') as gegund
  from public.prijsaanvragen a
  join public.meetstaat_posten m on m.project_id = a.project_id and m.status <> 'vervallen'
       and (case when a.posten is not null then m.id = any (a.posten) else m.lot = any (a.loten) end)
  left join public.prijsaanvraag_regels r on r.aanvraag_id = a.id and r.post_id = m.id
  where public.is_aannemer() and a.contact_id in (select public.mijn_contacten());
-- projecten van zijn prijsaanvragen (kandidaten zonder koppeling zien enkel nummer en gemeente)
create or replace view public.aan_prijsvraag_projecten as
  select p.id, p.nummer, p.gemeente, (p.id in (select public.aannemer_projecten())) as gekoppeld
  from public.projecten p
  where public.is_aannemer() and p.id in (select a.project_id from public.prijsaanvragen a where a.contact_id in (select public.mijn_contacten()));

-- prijs invullen per post (zolang de aanvraag open of ingediend is en de prijsvraag loopt); 'niet aangeboden' wist de prijs
drop function if exists public.prijs_invullen(uuid, uuid, numeric, text);
create or replace function public.prijs_invullen(p_aanvraag uuid, p_post uuid, p_prijs numeric, p_opmerking text default '', p_niet boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare a public.prijsaanvragen;
begin
  if not public.is_aannemer() then raise exception 'Geen toegang.'; end if;
  select * into a from public.prijsaanvragen where id = p_aanvraag;
  if a.id is null or a.contact_id not in (select public.mijn_contacten()) then raise exception 'Prijsaanvraag niet gevonden.'; end if;
  if a.status not in ('open', 'ingediend') or exists (select 1 from public.prijsvragen v where v.id = a.prijsvraag_id and v.status <> 'open') then
    raise exception 'Deze prijsaanvraag is afgesloten.';
  end if;
  if not exists (select 1 from public.meetstaat_posten m where m.id = p_post and m.project_id = a.project_id and m.status <> 'vervallen'
                   and (case when a.posten is not null then m.id = any (a.posten) else m.lot = any (a.loten) end)) then
    raise exception 'Deze post hoort niet bij de aanvraag.';
  end if;
  if p_prijs is not null and (p_prijs < 0 or p_prijs > 9999999999) then raise exception 'Geef een geldige prijs.'; end if;
  p_prijs := round(p_prijs, 2);
  if exists (select 1 from public.prijsvraag_gunningen g where g.aanvraag_id = a.id and g.post_id = p_post) then
    raise exception 'Deze post kan je niet meer wijzigen: BROS heeft er al een keuze voor gemaakt. Neem contact op met je aanspreekpunt.';
  end if;
  if a.status = 'ingediend' and not exists (select 1 from public.prijsaanvraag_regels r where r.aanvraag_id = p_aanvraag and r.post_id = p_post
       and r.eenheidsprijs is not distinct from (case when coalesce(p_niet, false) then null else p_prijs end)
       and r.niet_aangeboden = coalesce(p_niet, false) and r.opmerking = left(coalesce(p_opmerking, ''), 1000)) then
    -- gewijzigd na indienen: BROS ziet het pas na opnieuw indienen (vergelijken en gunnen gebruikt enkel ingediende prijzen)
    update public.prijsaanvragen set status = 'open', ingediend_op = null where id = a.id;
  end if;
  insert into public.prijsaanvraag_regels (aanvraag_id, post_id, eenheidsprijs, opmerking, niet_aangeboden)
    values (p_aanvraag, p_post, case when coalesce(p_niet, false) then null else p_prijs end, left(coalesce(p_opmerking, ''), 1000), coalesce(p_niet, false))
  on conflict (aanvraag_id, post_id) do update set eenheidsprijs = excluded.eenheidsprijs, opmerking = excluded.opmerking,
    niet_aangeboden = excluded.niet_aangeboden, updated_at = now();
end $$;

create or replace function public.prijsaanvraag_indienen(p_id uuid, p_opmerking text default '')
returns public.prijsaanvragen language plpgsql security definer set search_path = public as $$
declare a public.prijsaanvragen;
begin
  if not public.is_aannemer() then raise exception 'Geen toegang.'; end if;
  update public.prijsaanvragen x set status = 'ingediend', ingediend_op = now(), opmerking = left(coalesce(p_opmerking, ''), 2000), updated_at = now()
   where x.id = p_id and x.contact_id in (select public.mijn_contacten()) and x.status in ('open', 'ingediend')
     and not exists (select 1 from public.prijsvragen v where v.id = x.prijsvraag_id and v.status <> 'open')
  returning * into a;
  if a.id is null then raise exception 'Prijsaanvraag niet gevonden of al afgesloten.'; end if;
  return a;
end $$;

-- offerte (pdf) van de aannemer bij zijn prijsaanvraag: toevoegen of weghalen
create or replace function public.prijsaanvraag_bijlage(p_id uuid, p_path text, p_naam text default '', p_grootte bigint default 0, p_weg boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.prijsaanvragen; lijst jsonb;
begin
  if not public.is_aannemer() then raise exception 'Geen toegang.'; end if;
  select * into a from public.prijsaanvragen where id = p_id for update;
  if a.id is null or a.contact_id not in (select public.mijn_contacten()) then raise exception 'Prijsaanvraag niet gevonden.'; end if;
  if a.status not in ('open', 'ingediend') or exists (select 1 from public.prijsvragen v where v.id = a.prijsvraag_id and v.status <> 'open') then
    raise exception 'Deze prijsaanvraag is afgesloten.';
  end if;
  if p_path !~ ('^' || a.id::text || '/[A-Za-z0-9_-]+\.pdf$') then raise exception 'Ongeldig bestand.'; end if;
  lijst := coalesce((select jsonb_agg(x) from jsonb_array_elements(a.bijlagen) x where x->>'path' <> p_path), '[]'::jsonb);
  if not coalesce(p_weg, false) then
    if jsonb_array_length(lijst) >= 5 then raise exception 'Maximaal 5 bijlagen.'; end if;
    lijst := lijst || jsonb_build_array(jsonb_build_object('path', p_path, 'naam', left(coalesce(nullif(trim(p_naam), ''), 'offerte.pdf'), 120),
                                                           'grootte', greatest(coalesce(p_grootte, 0), 0), 'op', now()));
  end if;
  update public.prijsaanvragen set bijlagen = lijst where id = a.id;
  return lijst;
end $$;

-- private opslag voor offertes: de aannemer laadt op in '<zijn aanvraag>/<id>.pdf', enkel hij en beheer lezen
create or replace function public.mijn_prijsaanvragen(p_lopend boolean default false)
returns setof uuid language sql stable security definer set search_path = public as $$
  select a.id from public.prijsaanvragen a
   where public.is_aannemer() and a.contact_id in (select public.mijn_contacten())
     and (not p_lopend or (a.status in ('open', 'ingediend')
          and not exists (select 1 from public.prijsvragen v where v.id = a.prijsvraag_id and v.status <> 'open')))
$$;
create or replace function public.offertes_aantal(p_map text)
returns int language sql stable security definer set search_path = public, storage as $$
  select count(*)::int from storage.objects o where o.bucket_id = 'offertes' and split_part(o.name, '/', 1) = p_map
     and (public.is_beheer() or p_map in (select x::text from public.mijn_prijsaanvragen(false) x))
$$;
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public) values ('offertes', 'offertes', false) on conflict (id) do update set public = false;
    if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
      update storage.buckets set file_size_limit = 15728640, allowed_mime_types = array['application/pdf'] where id = 'offertes';
    end if;
    execute 'drop policy if exists offertes_insert on storage.objects';
    execute 'drop policy if exists offertes_read on storage.objects';
    execute 'drop policy if exists offertes_delete on storage.objects';
    execute $p$create policy offertes_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'offertes' and lower(name) like '%.pdf' and split_part(name, '/', 3) = ''
      and split_part(name, '/', 1) in (select x::text from public.mijn_prijsaanvragen(true) x)
      and public.offertes_aantal(split_part(name, '/', 1)) < 5)$p$;
    execute $p$create policy offertes_read on storage.objects for select to authenticated using (
      bucket_id = 'offertes' and (public.is_beheer() or split_part(name, '/', 1) in (select x::text from public.mijn_prijsaanvragen(false) x)))$p$;
    execute $p$create policy offertes_delete on storage.objects for delete to authenticated using (
      bucket_id = 'offertes' and (public.is_beheer() or split_part(name, '/', 1) in (select x::text from public.mijn_prijsaanvragen(true) x)))$p$;
  end if;
end $$;

-- ---------- 4. gunnen: per post de winnaar, prijzen als kostprijs, aannemers koppelen ----------
drop function if exists public.prijsvraag_gunnen(uuid, jsonb, boolean, boolean);
create or replace function public.prijsvraag_gunnen(p_prijsvraag uuid, p_keuzes jsonb, p_afronden boolean default false, p_koppelen boolean default true,
                                                    p_klantprijs_blijft boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.prijsvragen; k jsonb; a public.prijsaanvragen; pr numeric; post public.meetstaat_posten; oud numeric; m numeric; n int := 0; houd boolean;
        gekoppeld int := 0; c record; v_rol text; lots int[]; vorige uuid; vorigen uuid[] := '{}';
begin
  if not public.is_beheer() then raise exception 'Alleen een beheerder kan gunnen.'; end if;
  select * into v from public.prijsvragen where id = p_prijsvraag for update;
  if v.id is null then raise exception 'Prijsvraag niet gevonden.'; end if;
  if jsonb_typeof(coalesce(p_keuzes, '[]'::jsonb)) <> 'array' then raise exception 'Ongeldige keuze.'; end if;
  for k in select * from jsonb_array_elements(coalesce(p_keuzes, '[]'::jsonb)) loop
    select * into a from public.prijsaanvragen where id = (k->>'aanvraag_id')::uuid and prijsvraag_id = v.id;
    if a.id is null then raise exception 'Deze aannemer hoort niet bij de prijsvraag.'; end if;
    if a.ingediend_op is null then raise exception 'Deze aannemer heeft zijn prijzen nog niet ingediend.'; end if;
    select * into post from public.meetstaat_posten where id = (k->>'post_id')::uuid and project_id = v.project_id and status <> 'vervallen';
    if post.id is null or not (case when a.posten is not null then post.id = any (a.posten) else post.lot = any (a.loten) end) then
      raise exception 'Deze post hoort niet bij de aanvraag.';
    end if;
    select r.eenheidsprijs into pr from public.prijsaanvraag_regels r where r.aanvraag_id = a.id and r.post_id = post.id and not r.niet_aangeboden;
    if pr is null then raise exception 'Voor post % gaf deze aannemer geen prijs.', coalesce(nullif(post.code, ''), left(post.omschrijving, 40)); end if;
    -- kostprijs: de marge blijft (klantprijs volgt) of de klantprijs blijft (marge herrekend); posten met klantakkoord houden altijd hun klantprijs
    houd := post.status in ('akkoord', 'meerwerk', 'minwerk') or coalesce(p_klantprijs_blijft, v.richtprijs_marge is not null);
    m := null;
    if houd then
      select round(coalesce(p.eenheidsprijs, 0) * (1 + coalesce(p.marge, l.marge, 0)), 2) into oud
        from public.meetstaat_posten x left join public.loten l on l.nr = x.lot left join public.meetstaat_prijzen p on p.post_id = x.id where x.id = post.id;
      if coalesce(oud, 0) > 0 then
        if pr > 0 then m := round(oud / pr - 1, 8); end if;
        if m is null or m < -1 or m > 10 then
          raise exception 'Post %: met deze prijs (€ %) kan de klantprijs (€ %) niet behouden blijven. Kies een andere prijs of zet "klantprijs behouden" uit%.',
            coalesce(nullif(post.code, ''), left(post.omschrijving, 40)), pr, oud,
            case when post.status in ('akkoord', 'meerwerk', 'minwerk') then ' (deze post heeft een klantakkoord: pas eerst de klantprijs aan)' else '' end;
        end if;
      end if;
    end if;
    insert into public.meetstaat_prijzen (post_id, eenheidsprijs, marge) values (post.id, pr, m)
      on conflict (post_id) do update set eenheidsprijs = excluded.eenheidsprijs,
        marge = case when excluded.marge is not null then excluded.marge else public.meetstaat_prijzen.marge end, updated_at = now();
    select g.aanvraag_id into vorige from public.prijsvraag_gunningen g where g.prijsvraag_id = v.id and g.post_id = post.id;
    if vorige is not null and vorige <> a.id then vorigen := vorigen || vorige; end if;
    insert into public.prijsvraag_gunningen (prijsvraag_id, post_id, aanvraag_id, eenheidsprijs, gegund_door)
      values (v.id, post.id, a.id, pr, auth.uid())
      on conflict (prijsvraag_id, post_id) do update set aanvraag_id = excluded.aanvraag_id, eenheidsprijs = excluded.eenheidsprijs,
        gegund_door = excluded.gegund_door, gegund_op = now();
    n := n + 1;
  end loop;
  -- status van de deelnemers: 'gekozen' pas bij het afronden (zolang de prijsvraag loopt, kan een winnaar nog verder invullen)
  if coalesce(p_afronden, false) or v.status = 'gegund' then
    update public.prijsaanvragen x set status = 'gekozen', gekozen_op = coalesce(x.gekozen_op, now())
     where x.prijsvraag_id = v.id and exists (select 1 from public.prijsvraag_gunningen g where g.aanvraag_id = x.id);
  end if;
  -- wie al zijn posten kwijt is aan een ander
  update public.prijsaanvragen x set status = case when v.status = 'gegund' then 'niet_weerhouden' else 'ingediend' end
   where x.id = any (vorigen) and x.status = 'gekozen' and not exists (select 1 from public.prijsvraag_gunningen g where g.aanvraag_id = x.id);
  -- winnaars koppelen aan de loten van hun gegunde posten
  if coalesce(p_koppelen, true) and (coalesce(p_afronden, false) or v.status = 'gegund') then
    for c in select x.contact_id, array_agg(distinct mp.lot order by mp.lot) as lots, ct.soort
               from public.prijsvraag_gunningen g join public.prijsaanvragen x on x.id = g.aanvraag_id
               join public.meetstaat_posten mp on mp.id = g.post_id join public.contacten ct on ct.id = x.contact_id
              where g.prijsvraag_id = v.id
                and (coalesce(p_afronden, false) or (g.post_id::text, g.aanvraag_id::text) in (select e->>'post_id', e->>'aanvraag_id' from jsonb_array_elements(coalesce(p_keuzes, '[]'::jsonb)) e))
              group by x.contact_id, ct.soort loop
      v_rol := case when c.soort in ('aannemer', 'leverancier', 'architect', 'studiebureau', 'andere') then c.soort else 'aannemer' end;
      select pc.loten into lots from public.project_contacten pc where pc.project_id = v.project_id and pc.contact_id = c.contact_id and pc.rol = v_rol;
      if not found then
        insert into public.project_contacten (project_id, contact_id, rol, loten, intern) values (v.project_id, c.contact_id, v_rol, c.lots, true);
        gekoppeld := gekoppeld + 1;
      elsif not (c.lots <@ lots) then
        update public.project_contacten set loten = array(select distinct l from unnest(lots || c.lots) l order by l)
         where project_id = v.project_id and contact_id = c.contact_id and project_contacten.rol = v_rol;
        gekoppeld := gekoppeld + 1;
      end if;
    end loop;
  end if;
  if coalesce(p_afronden, false) then
    update public.prijsvragen set status = 'gegund', afgerond_op = now() where id = v.id;
    -- enkel wie indiende is 'niet weerhouden'; wie niets indiende, staat op afgesloten
    update public.prijsaanvragen x set status = case when x.ingediend_op is not null then 'niet_weerhouden' else 'afgesloten' end
     where x.prijsvraag_id = v.id and x.status in ('open', 'ingediend')
       and not exists (select 1 from public.prijsvraag_gunningen g where g.aanvraag_id = x.id);
  end if;
  return jsonb_build_object('posten', n, 'gekoppeld', gekoppeld);
end $$;

-- een gunning ongedaan maken (de kostprijs blijft staan: pas die zelf aan of gun opnieuw)
create or replace function public.prijsvraag_gunning_weg(p_prijsvraag uuid, p_post uuid)
returns void language plpgsql security definer set search_path = public as $$
declare vorige uuid; st text;
begin
  if not public.is_beheer() then raise exception 'Alleen een beheerder kan gunnen.'; end if;
  select status into st from public.prijsvragen where id = p_prijsvraag;
  delete from public.prijsvraag_gunningen where prijsvraag_id = p_prijsvraag and post_id = p_post returning aanvraag_id into vorige;
  update public.prijsaanvragen x set status = case when st = 'gegund' then 'niet_weerhouden' else 'ingediend' end
   where x.id = vorige and x.status = 'gekozen' and not exists (select 1 from public.prijsvraag_gunningen g where g.aanvraag_id = x.id);
end $$;

-- ---------- 5. live + rechten ----------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['prijsvragen', 'prijsvraag_gunningen'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

select public.rechten_herstellen();
revoke insert, update, delete, truncate, references, trigger on public.portaal_pings from authenticated, anon;
revoke all on function public.portaal_ping() from public, anon, authenticated;
revoke all on function public.keuze_optie_ping() from public, anon, authenticated;
revoke all on function public.werf_foto_ping() from public, anon, authenticated;
revoke all on function public.werf_fotos_gedeeld() from public, anon, authenticated;
revoke all on function public.prijsvraag_doorzetten() from public, anon, authenticated;
revoke all on function public.prijsaanvraag_zonder_pv() from public, anon, authenticated;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(37, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: moet 2 | 3 | 0 teruggeven (tabellen · views · prijsaanvragen zonder prijsvraag)
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('prijsvragen', 'prijsvraag_gunningen'))::int as tabellen,
       (select count(*) from information_schema.views where table_schema = 'public' and table_name in ('aan_prijsaanvragen', 'aan_prijsaanvraag_posten', 'aan_prijsvraag_projecten'))::int as views,
       (select count(*) from public.prijsaanvragen where prijsvraag_id is null)::int as los;
