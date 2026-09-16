-- =====================================================================
--  BROS Planbord — databasescript 011: klantenportaal
--  - rol 'klant' (login voor bouwheren); klanten zien alleen hun eigen project(en), alleen-lezen
--  - de interne tabellen worden afgeschermd voor klanten (is_intern()); klanten lezen via views
--    zonder kostprijzen, marges, forfaits of interne notities
--  - teamprofiel (functie, bio, foto) voor de pagina "Wie is wie"; documenten "delen met klant"
--  - instellingen 'portaal' (welkomtekst, werkwijze, contact); storage-bucket 'portaal' voor teamfoto's
--  Alleen toevoegingen; mag opnieuw uitgevoerd worden.
-- =====================================================================

-- ---------- 1. Velden ----------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('beheer','medewerker','klant'));
alter table public.profiles
  add column if not exists functie          text not null default '',
  add column if not exists bio              text not null default '',
  add column if not exists foto_url         text not null default '',
  add column if not exists portaal_zichtbaar boolean not null default true;   -- staat op de pagina "Wie is wie"
alter table public.contacten
  add column if not exists portaal_sinds    timestamptz,                        -- uitnodiging verstuurd
  add column if not exists portaal_login    timestamptz;                        -- laatste keer ingelogd in het portaal
alter table public.documenten
  add column if not exists gedeeld          boolean not null default false;     -- zichtbaar voor de klant

insert into public.instellingen (key, value) values ('portaal', jsonb_build_object(
  'welkom', 'Welkom in jouw BROS-portaal. Hier volg je je project op de voet: de meetstaat, de facturatie, de planning en de documenten die we met je delen.',
  'werkwijze', 'Bij BROS doorloopt elk project dezelfde stappen, van het eerste gesprek tot de oplevering. Hieronder zie je die stappen en waar jouw project nu staat.',
  'contact', 'Vragen? Mail naar info@bros.be of bel je projectverantwoordelijke.',
  'url', 'https://brosinterior.github.io/BROS-planbord/klant/'
)) on conflict (key) do nothing;

-- ---------- 2. Nieuwe login → profiel; klanten krijgen rol 'klant' en worden aan hun contact gekoppeld ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text; v_role text; v_contact uuid;
begin
  v_name := coalesce(new.raw_user_meta_data->>'name', initcap(split_part(new.email, '@', 1)));
  v_role := case when new.raw_user_meta_data->>'rol' = 'klant' then 'klant'
                 when (select count(*) from public.profiles) = 0 then 'beheer' else 'medewerker' end;
  insert into public.profiles (id, email, name, initials, role)
  values (new.id, new.email, v_name, upper(left(v_name, 2)), v_role)
  on conflict (id) do nothing;
  if v_role = 'klant' then
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

-- ---------- 3. Hulpfuncties ----------
create or replace function public.is_intern()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('beheer','medewerker') and active from public.profiles where id = auth.uid()), false)
$$;
create or replace function public.is_klant()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'klant' and active from public.profiles where id = auth.uid()), false)
$$;
-- projecten waar de ingelogde klant bouwheer of contactpersoon van is
create or replace function public.klant_projecten()
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct pc.project_id
  from public.project_contacten pc
  join public.contacten c on c.id = pc.contact_id
  where c.user_id = auth.uid() and c.actief and pc.rol in ('bouwheer','contactpersoon')
$$;
-- laatste portaalbezoek bijhouden (klant roept dit zelf aan)
create or replace function public.portaal_bezoek()
returns void language sql security definer set search_path = public as $$
  update public.contacten set portaal_login = now() where user_id = auth.uid()
$$;

-- ---------- 4. Interne tabellen: alleen voor het team ----------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (public.is_intern() or id = auth.uid());
drop policy if exists standaardtaken_select on public.standaardtaken;
create policy standaardtaken_select on public.standaardtaken for select to authenticated using (public.is_intern());
drop policy if exists instellingen_select on public.instellingen;
create policy instellingen_select on public.instellingen for select to authenticated using (public.is_intern() or key = 'portaal');
drop policy if exists posten_select on public.posten;
create policy posten_select on public.posten for select to authenticated using (public.is_intern());
drop policy if exists projecten_all on public.projecten;
create policy projecten_all on public.projecten for all to authenticated using (public.is_intern()) with check (public.is_intern());
drop policy if exists taken_all on public.taken;
create policy taken_all on public.taken for all to authenticated using (public.is_intern()) with check (public.is_intern());
drop policy if exists uren_all on public.uren;
create policy uren_all on public.uren for all to authenticated using (public.is_intern()) with check (public.is_intern());
drop policy if exists documenten_all on public.documenten;
create policy documenten_all on public.documenten for all to authenticated using (public.is_intern()) with check (public.is_intern());
drop policy if exists mp_all on public.meetstaat_posten;
create policy mp_all on public.meetstaat_posten for all to authenticated using (public.is_intern()) with check (public.is_intern());
drop policy if exists vord_all on public.vorderingen;
create policy vord_all on public.vorderingen for all to authenticated using (public.is_intern()) with check (public.is_intern());
drop policy if exists vordr_all on public.vordering_regels;
create policy vordr_all on public.vordering_regels for all to authenticated using (public.is_intern()) with check (public.is_intern());
drop policy if exists contacten_all on public.contacten;
create policy contacten_all on public.contacten for all to authenticated using (public.is_intern()) with check (public.is_intern());
drop policy if exists pc_all on public.project_contacten;
create policy pc_all on public.project_contacten for all to authenticated using (public.is_intern()) with check (public.is_intern());
-- fasen en loten (enkel namen) mogen klanten lezen: fasen_select / loten_select blijven 'true'

-- ---------- 5. Wat de klant ziet: views zonder interne gegevens ----------
-- (views draaien met de rechten van de eigenaar; de filter op klant_projecten() bepaalt wat de ingelogde klant krijgt)
create or replace view public.klant_project as
  select p.id, p.nummer, p.klant, p.naam, p.adres, p.postcode, p.gemeente, p.status, p.fase_nr, p.start, p.eind,
         p.projecttype, p.btw_tarief, p.offerte_datum, p.contract_datum, p.opgeleverd_op, p.lead
  from public.projecten p
  where p.id in (select public.klant_projecten());

create or replace view public.klant_meetstaat as
  select m.id, m.project_id, m.lot, m.code, m.groep, m.omschrijving, m.locatie, m.eenheid, m.prijstype, m.hoeveelheid,
         round(m.eenheidsprijs * (1 + coalesce(m.marge, l.marge, 0)), 2) as prijs,
         round(m.hoeveelheid * m.eenheidsprijs * (1 + coalesce(m.marge, l.marge, 0)), 2) as totaal,
         m.btw, m.status, m.volgorde, m.leverdatum, m.geleverd
  from public.meetstaat_posten m
  join public.loten l on l.nr = m.lot
  where m.project_id in (select public.klant_projecten());

create or replace view public.klant_vorderingen as
  select v.id, v.project_id, v.nr, v.soort, v.omschrijving, v.datum, v.factuurnummer, v.bedrag_excl, v.status
  from public.vorderingen v
  where v.project_id in (select public.klant_projecten());

create or replace view public.klant_vordering_regels as
  select r.id, r.vordering_id, r.lot, r.post_id, r.pct
  from public.vordering_regels r
  join public.vorderingen v on v.id = r.vordering_id
  where v.project_id in (select public.klant_projecten());

-- planning: per fase de timing en de voortgang (geen taaktitels)
create or replace view public.klant_planning as
  select t.project_id, t.fase_nr, min(t.start) as start, max(t.eind) as eind,
         count(*)::int as taken, count(*) filter (where t.status = 'done')::int as klaar
  from public.taken t
  where t.project_id in (select public.klant_projecten())
  group by t.project_id, t.fase_nr;

-- uren: enkel van taken die op "zichtbaar voor klant" staan
create or replace view public.klant_uren as
  select u.id, u.project_id, u.datum, u.tijd_van, u.tijd_tot, u.uren, t.titel as taak, t.fase_nr, p.name as medewerker
  from public.uren u
  join public.taken t on t.id = u.taak_id and t.uren_klant
  left join public.profiles p on p.id = u.user_id
  where u.project_id in (select public.klant_projecten());

create or replace view public.klant_documenten as
  select d.id, d.project_id, d.naam, d.pad, d.url, d.mime, d.grootte, d.gewijzigd
  from public.documenten d
  where d.gedeeld and d.project_id in (select public.klant_projecten());

-- wie is wie: het team (voor iedereen die ingelogd is)
create or replace view public.klant_team as
  select p.id, p.name, p.initials, p.color, p.functie, p.bio, p.foto_url
  from public.profiles p
  where p.role in ('beheer','medewerker') and p.active and p.portaal_zichtbaar;

-- de klant zelf (naam, contactgegevens) en zijn rol per project
create or replace view public.klant_ik as
  select c.id, c.naam, c.bedrijf, c.email, c.gsm, c.portaal_login, pc.project_id, pc.rol
  from public.contacten c
  join public.project_contacten pc on pc.contact_id = c.id
  where c.user_id = auth.uid();

revoke all on public.klant_project, public.klant_meetstaat, public.klant_vorderingen, public.klant_vordering_regels,
  public.klant_planning, public.klant_uren, public.klant_documenten, public.klant_team, public.klant_ik from anon;
grant select on public.klant_project, public.klant_meetstaat, public.klant_vorderingen, public.klant_vordering_regels,
  public.klant_planning, public.klant_uren, public.klant_documenten, public.klant_team, public.klant_ik to authenticated;
grant execute on function public.portaal_bezoek() to authenticated;

-- ---------- 6. Teamfoto's: publieke storage-bucket 'portaal' (schrijven: team) ----------
insert into storage.buckets (id, name, public) values ('portaal', 'portaal', true)
  on conflict (id) do update set public = true;
drop policy if exists portaal_read on storage.objects;
create policy portaal_read on storage.objects for select using (bucket_id = 'portaal');
drop policy if exists portaal_insert on storage.objects;
create policy portaal_insert on storage.objects for insert to authenticated with check (bucket_id = 'portaal' and public.is_intern());
drop policy if exists portaal_update on storage.objects;
create policy portaal_update on storage.objects for update to authenticated using (bucket_id = 'portaal' and public.is_intern());
drop policy if exists portaal_delete on storage.objects;
create policy portaal_delete on storage.objects for delete to authenticated using (bucket_id = 'portaal' and public.is_intern());

update public.instellingen set value = jsonb_set(value, '{versie_schema}', '11'::jsonb), updated_at = now() where key = 'app';

-- Controle: moet 9 views teruggeven
select count(*) as klant_views from information_schema.views where table_schema = 'public' and table_name like 'klant\_%';
