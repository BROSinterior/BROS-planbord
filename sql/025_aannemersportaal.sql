-- =====================================================================
--  BROS Planbord — databasescript 025: aannemersportaal (fase 8)
--  - rol 'aannemer': login voor een contactpersoon van een aannemer/leverancier (uitgenodigd vanuit Dossier › Contacten)
--  - een aannemer ziet enkel de projecten waaraan hij gekoppeld is (project_contacten), via de views aan_*:
--    zijn vaststellingen (opgelost melden met bewijsfoto), plannen, verslagen die hem gestuurd zijn, gedeelde documenten,
--    de gedeelde planning, zijn actiepunten, prijsaanvragen en zijn vragen aan BROS
--  - prijsaanvragen: BROS vraagt per lot eenheidsprijzen; de aannemer vult ze in; beheer vergelijkt en neemt over als kostprijs
--  - vragen van de aannemer komen als taakvoorstel (bron 'aannemer') in de wachtrij Voorstellen
--  - de werfmodus (werf/) werkt ook voor aannemers, beperkt tot hun eigen punten
--  Vereist schema 24. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 24 then
    raise exception 'Voer eerst de scripts tot en met 024 uit.';
  end if;
end $$;

-- ---------- 1. rol aannemer ----------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('beheer','medewerker','klant','aannemer'));

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text; v_role text; v_contact uuid; v_active boolean;
begin
  v_name := coalesce(new.raw_user_meta_data->>'name', initcap(split_part(new.email, '@', 1)));
  v_role := case when new.raw_user_meta_data->>'rol' in ('klant', 'aannemer') then new.raw_user_meta_data->>'rol'
                 when (select count(*) from public.profiles) = 0 then 'beheer' else 'medewerker' end;
  v_active := v_role in ('klant', 'aannemer', 'beheer') or coalesce(new.raw_user_meta_data->>'actief', '') = 'ja';
  insert into public.profiles (id, email, name, initials, role, active)
  values (new.id, new.email, v_name, upper(left(v_name, 2)), v_role, v_active)
  on conflict (id) do nothing;
  if v_role in ('klant', 'aannemer') then
    v_contact := nullif(new.raw_user_meta_data->>'contact_id', '')::uuid;
    if v_contact is not null then
      update public.contacten set user_id = new.id where id = v_contact and user_id is null;
    else
      update public.contacten set user_id = new.id where user_id is null and lower(email) = lower(new.email);
    end if;
  else
    insert into public.tarieven (user_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end $$;

create or replace function public.is_aannemer()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'aannemer' and active from public.profiles where id = auth.uid()), false)
$$;
-- de contacten (meestal één) die aan deze login hangen
create or replace function public.mijn_contacten()
returns setof uuid language sql stable security definer set search_path = public as $$
  select c.id from public.contacten c where c.user_id = auth.uid() and c.actief
$$;
-- projecten waar de ingelogde aannemer aan gekoppeld is (elke rol behalve bouwheer/contactpersoon)
create or replace function public.aannemer_projecten()
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct pc.project_id
  from public.project_contacten pc
  join public.contacten c on c.id = pc.contact_id
  where c.user_id = auth.uid() and c.actief and pc.rol not in ('bouwheer','contactpersoon')
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role = 'aannemer')
$$;

-- loten (namen) ook voor aannemers leesbaar
create or replace view public.loten_v as
  select l.nr, l.naam, l.buildwise, l.standaard_aan, l.vakman, l.actief,
         case when public.is_beheer() then l.marge end as marge
  from public.loten l
  where public.is_intern() or public.is_klant() or public.is_aannemer();

-- ---------- 2. delen met aannemers: documenten en werfverslagen ----------
alter table public.documenten add column if not exists gedeeld_aannemers boolean not null default false;
alter table public.werfverslagen add column if not exists aannemer_zichtbaar boolean not null default false;
alter table public.taak_voorstellen add column if not exists bron text not null default 'assistent';
alter table public.taak_voorstellen drop constraint if exists taak_voorstellen_bron_check;
alter table public.taak_voorstellen add constraint taak_voorstellen_bron_check check (bron in ('assistent', 'aannemer'));
alter table public.taak_voorstellen add column if not exists contact_id uuid references public.contacten(id) on delete set null;

-- ---------- 3. prijsaanvragen ----------
create table if not exists public.prijsaanvragen (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projecten(id) on delete cascade,
  contact_id    uuid not null references public.contacten(id) on delete cascade,
  loten         int[] not null default '{}',
  titel         text not null default '',
  bericht       text not null default '',
  deadline      date,
  status        text not null default 'open' check (status in ('open', 'ingediend', 'gekozen', 'afgesloten')),
  opmerking     text not null default '',          -- opmerking van de aannemer bij het indienen
  ingediend_op  timestamptz,
  gekozen_op    timestamptz,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists prijsaanvragen_project_idx on public.prijsaanvragen(project_id, created_at desc);
create index if not exists prijsaanvragen_contact_idx on public.prijsaanvragen(contact_id);
drop trigger if exists prijsaanvragen_touch on public.prijsaanvragen;
create trigger prijsaanvragen_touch before update on public.prijsaanvragen for each row execute function public.touch_updated_at();

create table if not exists public.prijsaanvraag_regels (
  id            uuid primary key default gen_random_uuid(),
  aanvraag_id   uuid not null references public.prijsaanvragen(id) on delete cascade,
  post_id       uuid not null references public.meetstaat_posten(id) on delete cascade,
  eenheidsprijs numeric(12,2),                    -- null = nog niet ingevuld
  opmerking     text not null default '',
  updated_at    timestamptz not null default now(),
  unique (aanvraag_id, post_id)
);
create index if not exists prijsaanvraag_regels_aanvraag_idx on public.prijsaanvraag_regels(aanvraag_id);

alter table public.prijsaanvragen enable row level security;
alter table public.prijsaanvraag_regels enable row level security;
drop policy if exists pa_intern on public.prijsaanvragen;
create policy pa_intern on public.prijsaanvragen for all to authenticated using (public.is_intern()) with check (public.is_intern());
drop policy if exists par_intern on public.prijsaanvraag_regels;
create policy par_intern on public.prijsaanvraag_regels for all to authenticated using (public.is_intern()) with check (public.is_intern());

-- ---------- 4. wat de aannemer ziet (views; filter op aannemer_projecten()) ----------
drop view if exists public.aan_project;
create view public.aan_project as
  select p.id, p.nummer, p.klant, p.naam, p.adres, p.postcode, p.gemeente, p.status, p.fase_nr, p.start, p.eind, p.lead, p.projecttype,
         (select coalesce(array_agg(distinct l order by l), '{}') from public.project_contacten pc2, unnest(pc2.loten) l
            where pc2.project_id = p.id and pc2.contact_id in (select public.mijn_contacten())) as mijn_loten,
         (select string_agg(distinct pc3.rol, ', ') from public.project_contacten pc3 where pc3.project_id = p.id and pc3.contact_id in (select public.mijn_contacten())) as mijn_rol
  from public.projecten p
  where p.id in (select public.aannemer_projecten());

-- vaststellingen die aan (een contact van) de aannemer toegewezen zijn
drop view if exists public.aan_vaststellingen;
create view public.aan_vaststellingen as
  select v.id, v.project_id, v.bezoek_id, v.nr, v.titel, v.omschrijving, v.ruimte, v.lot, v.contact_id, v.prioriteit, v.deadline, v.status,
         v.fotos, v.opgelost_op, v.opgelost_fotos, v.opmerking, v.plan_id, v.plan_x, v.plan_y, v.created_at, v.updated_at,
         (select datum from public.werfbezoeken b where b.id = v.bezoek_id) as bezoek_datum
  from public.vaststellingen v
  where v.contact_id in (select public.mijn_contacten()) and v.project_id in (select public.aannemer_projecten());

drop view if exists public.aan_werfplannen;
create view public.aan_werfplannen as
  select w.id, w.project_id, w.naam, w.url, w.w, w.h, w.volgorde
  from public.werfplannen w
  where w.project_id in (select public.aannemer_projecten());

-- verslagen die naar (een e-mailadres van) de aannemer gestuurd zijn, of die BROS met alle aannemers deelt
drop view if exists public.aan_werfverslagen;
create view public.aan_werfverslagen as
  select w.id, w.project_id, w.nr, w.datum, w.titel, w.pdf_url, w.punten, w.verzonden_op, w.created_at
  from public.werfverslagen w
  where w.project_id in (select public.aannemer_projecten())
    and (w.aannemer_zichtbaar or exists (select 1 from public.contacten c where c.id in (select public.mijn_contacten())
           and (w.aan ? lower(c.email) or w.aan ? c.email or (c.email2 <> '' and w.aan ? lower(c.email2)))));

drop view if exists public.aan_documenten;
create view public.aan_documenten as
  select d.id, d.project_id, d.naam, d.pad, d.url, d.mime, d.grootte, d.gewijzigd
  from public.documenten d
  where d.gedeeld_aannemers and d.project_id in (select public.aannemer_projecten());

-- planning: per fase (zoals voor de klant) + taken met gedeelde timing
drop view if exists public.aan_planning;
create view public.aan_planning as
  with fasen_van_project as (
    select t.project_id, t.fase_nr from public.taken t where t.fase_nr is not null
    union
    select kt.project_id, kt.fase_nr from public.klant_timing kt
  )
  select f.project_id, f.fase_nr,
         coalesce(kt.start, (select min(t.start) from public.taken t where t.project_id = f.project_id and t.fase_nr = f.fase_nr)) as start,
         coalesce(kt.eind,  (select max(t.eind)  from public.taken t where t.project_id = f.project_id and t.fase_nr = f.fase_nr)) as eind,
         coalesce(kt.opmerking, '') as opmerking
  from fasen_van_project f
  left join public.klant_timing kt on kt.project_id = f.project_id and kt.fase_nr = f.fase_nr
  where f.project_id in (select public.aannemer_projecten());
drop view if exists public.aan_planning_taken;
create view public.aan_planning_taken as
  select t.id, t.project_id, t.fase_nr, t.titel, t.start, t.eind, t.status, t.volgorde
  from public.taken t
  where t.timing_klant and t.project_id in (select public.aannemer_projecten());

-- actiepunten voor de aannemer (uit verslagen of los), zonder de werfpunten (die staan apart)
drop view if exists public.aan_taken;
create view public.aan_taken as
  select t.id, t.project_id, t.titel, t.eind, t.status, t.notitie_id, n.titel as notitie_titel, t.vaststelling_id, t.updated_at
  from public.taken t
  left join public.notities n on n.id = t.notitie_id
  where t.contact_id in (select public.mijn_contacten()) and t.project_id in (select public.aannemer_projecten());

-- meetstaatposten van de gevraagde loten: hoeveelheden en eenheden, nooit prijzen van BROS of van anderen
drop view if exists public.aan_prijsaanvragen;
create view public.aan_prijsaanvragen as
  select a.id, a.project_id, a.loten, a.titel, a.bericht, a.deadline, a.status, a.opmerking, a.ingediend_op, a.created_at
  from public.prijsaanvragen a
  where a.contact_id in (select public.mijn_contacten()) and a.project_id in (select public.aannemer_projecten());
drop view if exists public.aan_prijsaanvraag_posten;
create view public.aan_prijsaanvraag_posten as
  select a.id as aanvraag_id, m.id as post_id, m.lot, m.code, m.groep, m.omschrijving, m.locatie, m.eenheid, m.prijstype, m.hoeveelheid, m.volgorde,
         r.eenheidsprijs, coalesce(r.opmerking, '') as opmerking
  from public.prijsaanvragen a
  join public.meetstaat_posten m on m.project_id = a.project_id and m.lot = any (a.loten) and m.status <> 'vervallen'
  left join public.prijsaanvraag_regels r on r.aanvraag_id = a.id and r.post_id = m.id
  where a.contact_id in (select public.mijn_contacten()) and a.project_id in (select public.aannemer_projecten());

-- vragen die de aannemer stelde (taakvoorstellen met bron 'aannemer')
drop view if exists public.aan_vragen;
create view public.aan_vragen as
  select v.id, v.project_id, v.titel, v.vraag, v.onderwerp, v.status, v.reden, v.created_at, v.beoordeeld_op
  from public.taak_voorstellen v
  where v.bron = 'aannemer' and v.contact_id in (select public.mijn_contacten()) and v.project_id in (select public.aannemer_projecten());

revoke all on public.aan_project, public.aan_vaststellingen, public.aan_werfplannen, public.aan_werfverslagen, public.aan_documenten,
  public.aan_planning, public.aan_planning_taken, public.aan_taken, public.aan_prijsaanvragen, public.aan_prijsaanvraag_posten, public.aan_vragen from anon;
grant select on public.aan_project, public.aan_vaststellingen, public.aan_werfplannen, public.aan_werfverslagen, public.aan_documenten,
  public.aan_planning, public.aan_planning_taken, public.aan_taken, public.aan_prijsaanvragen, public.aan_prijsaanvraag_posten, public.aan_vragen to authenticated;

-- ---------- 5. wat de aannemer doet (functies) ----------
-- werfpunt: opgelost melden (met bewijsfoto's), foto's of een opmerking toevoegen
create or replace function public.aannemer_vaststelling_melden(p_id uuid, p_status text default null, p_opmerking text default null, p_fotos jsonb default '[]'::jsonb)
returns public.vaststellingen language plpgsql security definer set search_path = public as $$
declare v public.vaststellingen; nieuw jsonb := '[]'::jsonb; f jsonb;
begin
  if not public.is_aannemer() then raise exception 'Geen toegang.'; end if;
  select * into v from public.vaststellingen where id = p_id for update;
  if v.id is null or v.contact_id is null or v.contact_id not in (select public.mijn_contacten()) then raise exception 'Dit punt is niet aan jou toegewezen.'; end if;
  for f in select * from jsonb_array_elements(coalesce(p_fotos, '[]'::jsonb)) loop
    if not exists (select 1 from jsonb_array_elements(v.opgelost_fotos) b where b->>'path' = f->>'path') then nieuw := nieuw || jsonb_build_array(f); end if;
  end loop;
  if p_status = 'opgelost' then
    if v.status <> 'open' then raise exception 'Dit punt staat niet meer open.'; end if;
    update public.vaststellingen set status = 'opgelost', opgelost_op = now(), opgelost_door = auth.uid(),
      opmerking = coalesce(nullif(trim(p_opmerking), ''), opmerking), opgelost_fotos = opgelost_fotos || nieuw, updated_at = now() where id = p_id returning * into v;
  elsif p_status is not null then
    raise exception 'Een aannemer kan een punt enkel als opgelost melden.';
  else
    update public.vaststellingen set opmerking = coalesce(nullif(trim(p_opmerking), ''), opmerking), opgelost_fotos = opgelost_fotos || nieuw, updated_at = now() where id = p_id returning * into v;
  end if;
  return v;
end $$;
grant execute on function public.aannemer_vaststelling_melden(uuid, text, text, jsonb) to authenticated;

-- actiepunt afvinken: klant én aannemer (vervangt de klant-only versie)
create or replace function public.klant_taak_klaar(p_id uuid, p_klaar boolean)
returns public.taken language plpgsql security definer set search_path = public as $$
declare t public.taken;
begin
  select * into t from public.taken where id = p_id;
  if t.id is null then raise exception 'Actiepunt niet gevonden.'; end if;
  if not (public.is_klant() or public.is_aannemer()) or t.contact_id is null or t.contact_id not in (select public.mijn_contacten()) then
    raise exception 'Dit actiepunt is niet aan jou toegewezen.';
  end if;
  update public.taken set status = case when p_klaar then 'done' else 'todo' end, updated_at = now() where id = p_id returning * into t;
  return t;
end $$;

-- prijs invullen per post (zolang de aanvraag open of ingediend is)
create or replace function public.prijs_invullen(p_aanvraag uuid, p_post uuid, p_prijs numeric, p_opmerking text default '')
returns void language plpgsql security definer set search_path = public as $$
declare a public.prijsaanvragen;
begin
  if not public.is_aannemer() then raise exception 'Geen toegang.'; end if;
  select * into a from public.prijsaanvragen where id = p_aanvraag;
  if a.id is null or a.contact_id not in (select public.mijn_contacten()) then raise exception 'Prijsaanvraag niet gevonden.'; end if;
  if a.status not in ('open', 'ingediend') then raise exception 'Deze prijsaanvraag is afgesloten.'; end if;
  if not exists (select 1 from public.meetstaat_posten m where m.id = p_post and m.project_id = a.project_id and m.lot = any (a.loten)) then raise exception 'Deze post hoort niet bij de aanvraag.'; end if;
  insert into public.prijsaanvraag_regels (aanvraag_id, post_id, eenheidsprijs, opmerking) values (p_aanvraag, p_post, p_prijs, coalesce(p_opmerking, ''))
  on conflict (aanvraag_id, post_id) do update set eenheidsprijs = excluded.eenheidsprijs, opmerking = excluded.opmerking, updated_at = now();
end $$;
grant execute on function public.prijs_invullen(uuid, uuid, numeric, text) to authenticated;

create or replace function public.prijsaanvraag_indienen(p_id uuid, p_opmerking text default '')
returns public.prijsaanvragen language plpgsql security definer set search_path = public as $$
declare a public.prijsaanvragen;
begin
  if not public.is_aannemer() then raise exception 'Geen toegang.'; end if;
  update public.prijsaanvragen set status = 'ingediend', ingediend_op = now(), opmerking = coalesce(p_opmerking, ''), updated_at = now()
   where id = p_id and contact_id in (select public.mijn_contacten()) and status in ('open', 'ingediend') returning * into a;
  if a.id is null then raise exception 'Prijsaanvraag niet gevonden of al afgesloten.'; end if;
  return a;
end $$;
grant execute on function public.prijsaanvraag_indienen(uuid, text) to authenticated;

-- beheer: de prijzen van één aanvraag overnemen als kostprijs in de meetstaat (enkel ingevulde posten)
create or replace function public.prijsaanvraag_overnemen(p_id uuid, p_posten uuid[] default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_beheer() then raise exception 'Alleen een beheerder kan prijzen overnemen.'; end if;
  insert into public.meetstaat_prijzen (post_id, eenheidsprijs)
    select r.post_id, r.eenheidsprijs from public.prijsaanvraag_regels r
    where r.aanvraag_id = p_id and r.eenheidsprijs is not null and (p_posten is null or r.post_id = any (p_posten))
  on conflict (post_id) do update set eenheidsprijs = excluded.eenheidsprijs, updated_at = now();
  get diagnostics n = row_count;
  update public.prijsaanvragen set status = 'gekozen', gekozen_op = now(), updated_at = now() where id = p_id;
  return n;
end $$;
grant execute on function public.prijsaanvraag_overnemen(uuid, uuid[]) to authenticated;

-- vraag of opmerking voor BROS → taakvoorstel in de wachtrij (routering uit de instellingen van de assistent)
create or replace function public.aannemer_vraag(p_project uuid, p_titel text, p_tekst text default '', p_onderwerp text default 'overig')
returns public.taak_voorstellen language plpgsql security definer set search_path = public as $$
declare v public.taak_voorstellen; c_id uuid; c_naam text; cfg jsonb; wie uuid; ow text;
begin
  if not public.is_aannemer() then raise exception 'Geen toegang.'; end if;
  if p_project not in (select public.aannemer_projecten()) then raise exception 'Geen toegang tot dit project.'; end if;
  if coalesce(trim(p_titel), '') = '' then raise exception 'Geef een korte titel.'; end if;
  select id, naam into c_id, c_naam from public.contacten where id in (select public.mijn_contacten()) limit 1;
  ow := case when p_onderwerp in ('planning', 'facturatie', 'ontwerp', 'documenten', 'klacht', 'overig') then p_onderwerp else 'overig' end;
  select value into cfg from public.instellingen where key = 'assistent';
  wie := coalesce(nullif(cfg->'routering'->>ow, '')::uuid, nullif(cfg->'routering'->>'overig', '')::uuid,
                  (select id from public.profiles where role = 'beheer' and active order by created_at limit 1));
  insert into public.taak_voorstellen (project_id, titel, onderwerp, omschrijving, vraag, antwoord, voorgestelde_user, eind, urgentie, status, bron, contact_id)
  values (p_project, left(trim(p_titel), 120), ow, left(coalesce(p_tekst, ''), 2000), left(coalesce(p_tekst, ''), 2000), '', wie, current_date + 7,
          case when ow = 'klacht' then 'hoog' else 'normaal' end, 'open', 'aannemer', c_id)
  returning * into v;
  return v;
end $$;
grant execute on function public.aannemer_vraag(uuid, text, text, text) to authenticated;

-- ---------- 6. foto's: aannemers mogen uploaden in de bucket 'werf' (bewijsfoto's) ----------
drop policy if exists werf_insert on storage.objects;
create policy werf_insert on storage.objects for insert to authenticated with check (bucket_id = 'werf' and (public.is_intern() or public.is_aannemer()));

-- ---------- 7. instellingen: adres van het aannemersportaal ----------
update public.instellingen set value = value || jsonb_build_object('url_aannemer', 'https://brosinterior.github.io/BROS-planbord/aannemer/'), updated_at = now()
  where key = 'portaal' and not (value ? 'url_aannemer');

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'prijsaanvragen') then alter publication supabase_realtime add table public.prijsaanvragen; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'prijsaanvraag_regels') then alter publication supabase_realtime add table public.prijsaanvraag_regels; end if;
end $$;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', '25'::jsonb), updated_at = now() where key = 'app';

-- Controle: moet 11 teruggeven
select count(*) as aan_views from information_schema.views where table_schema = 'public' and table_name like 'aan\_%';
