-- =====================================================================
--  BROS Planbord — databasescript 036: klantenportaal fase 3
--  1. Voortgang: werffoto's (genomen in de werfmodus of opgeladen in het Planbord) die je deelt met de klant,
--     met per week een korte tekst. De klant ziet ze per week op het tabblad Werf.
--  2. Woningdossier: per project de gebruikte materialen en kleuren, leveranciers, garanties en onderhoud
--     (met een gedeeld document als handleiding of garantiebewijs). Zichtbaar voor de klant als jij het aanzet.
--  3. Taal: per contact nl of en — het klantenportaal en de weekmail in het Engels voor anderstalige klanten.
--  Vereist schema 35. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 35 then
    raise exception 'Voer eerst de scripts tot en met 035 uit.';
  end if;
end $$;

-- ---------- 1. voortgang ----------
create table if not exists public.werf_fotos (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projecten(id) on delete cascade,
  path          text not null,
  url           text not null,
  w             int, h int,
  bijschrift    text not null default '',
  genomen_op    timestamptz not null default now(),
  gedeeld_klant boolean not null default false,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);
create index if not exists werf_fotos_project_idx on public.werf_fotos(project_id, genomen_op desc);
alter table public.werf_fotos add column if not exists gedeeld_op timestamptz;   -- wanneer gedeeld met de klant (voor de weekmail)
create or replace function public.werf_fotos_gedeeld()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.gedeeld_klant and (tg_op = 'INSERT' or not coalesce(old.gedeeld_klant, false)) then new.gedeeld_op := now();
  elsif not new.gedeeld_klant then new.gedeeld_op := null;
  elsif tg_op = 'UPDATE' then new.gedeeld_op := old.gedeeld_op;
  end if;
  return new;
end $$;
update public.werf_fotos set gedeeld_op = created_at where gedeeld_klant and gedeeld_op is null;   -- bij opnieuw uitvoeren
drop trigger if exists werf_fotos_gedeeld on public.werf_fotos;
create trigger werf_fotos_gedeeld before insert or update on public.werf_fotos for each row execute function public.werf_fotos_gedeeld();
create table if not exists public.werf_updates (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projecten(id) on delete cascade,
  week       date not null,                               -- maandag van de week
  tekst      text not null default '',
  gedeeld    boolean not null default true,
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (project_id, week)
);
drop trigger if exists werf_updates_touch on public.werf_updates;
create trigger werf_updates_touch before update on public.werf_updates for each row execute function public.touch_updated_at();
alter table public.werf_fotos enable row level security;
alter table public.werf_updates enable row level security;
drop policy if exists werf_fotos_intern on public.werf_fotos;
create policy werf_fotos_intern on public.werf_fotos for all to authenticated using (public.is_intern()) with check (public.is_intern());
drop policy if exists werf_updates_intern on public.werf_updates;
create policy werf_updates_intern on public.werf_updates for all to authenticated using (public.is_intern()) with check (public.is_intern());

create or replace view public.klant_werf_fotos as
  select f.id, f.project_id, f.url, f.w, f.h, f.bijschrift, f.genomen_op
  from public.werf_fotos f
  where f.gedeeld_klant and f.project_id in (select public.klant_projecten());
create or replace view public.klant_werf_updates as
  select u.id, u.project_id, u.week, u.tekst
  from public.werf_updates u
  where u.gedeeld and trim(u.tekst) <> '' and u.project_id in (select public.klant_projecten());

-- ---------- 2. woningdossier ----------
alter table public.projecten add column if not exists dossier_klant boolean not null default false;
create table if not exists public.woningdossier (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projecten(id) on delete cascade,
  ruimte       text not null default '',
  onderdeel    text not null default '',      -- bv. vloer, kraan, verf muren
  materiaal    text not null default '',      -- product / materiaal
  kleur        text not null default '',      -- kleur, RAL/NCS, afwerking
  leverancier  text not null default '',
  referentie   text not null default '',
  garantie_tot date,
  onderhoud    text not null default '',
  document_id  uuid references public.documenten(id) on delete set null,   -- handleiding / garantiebewijs (moet gedeeld zijn om voor de klant zichtbaar te zijn)
  keuze_id     uuid references public.keuzes(id) on delete set null,       -- overgenomen uit een keuze
  volgorde     int not null default 0,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists woningdossier_project_idx on public.woningdossier(project_id);
drop trigger if exists woningdossier_touch on public.woningdossier;
create trigger woningdossier_touch before update on public.woningdossier for each row execute function public.touch_updated_at();
alter table public.woningdossier enable row level security;
drop policy if exists woningdossier_intern on public.woningdossier;
create policy woningdossier_intern on public.woningdossier for all to authenticated using (public.is_intern()) with check (public.is_intern());

create or replace view public.klant_woningdossier as
  select w.id, w.project_id, w.ruimte, w.onderdeel, w.materiaal, w.kleur, w.leverancier, w.referentie, w.garantie_tot, w.onderhoud, w.document_id, w.volgorde
  from public.woningdossier w join public.projecten p on p.id = w.project_id
  where p.dossier_klant and w.project_id in (select public.klant_projecten());

-- de klant ziet of het dossier aanstaat (zelfde kolommen als script 023 + dossier_klant achteraan)
create or replace view public.klant_project as
  select p.id, p.nummer, p.klant, p.naam, p.adres, p.postcode, p.gemeente, p.status, p.fase_nr, p.start, p.eind, p.projecttype, p.btw_tarief,
         p.offerte_datum, p.contract_datum, p.opgeleverd_op, p.lead, p.assistent, p.dossier_klant
  from public.projecten p
  where p.id in (select public.klant_projecten());

-- ---------- 3. taal ----------
alter table public.contacten add column if not exists taal text not null default 'nl';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'contacten_taal_check') then
    alter table public.contacten add constraint contacten_taal_check check (taal in ('nl', 'en'));
  end if;
end $$;
create or replace view public.klant_ik as
  select c.id, c.naam, c.bedrijf, c.email, c.gsm, c.portaal_login, pc.project_id, pc.rol, c.weekmail, c.taal
  from public.contacten c join public.project_contacten pc on pc.contact_id = c.id
  where c.user_id = auth.uid();
create or replace function public.klant_taal(p_taal text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_klant() then raise exception 'Geen toegang.'; end if;
  if p_taal not in ('nl', 'en') then raise exception 'Onbekende taal.'; end if;
  update public.contacten set taal = p_taal, updated_at = now() where user_id = auth.uid();
end $$;
revoke all on function public.klant_taal(text) from public, anon;
grant execute on function public.klant_taal(text) to authenticated;

-- ---------- live bijwerken (script 034) ----------
create or replace function public.werf_foto_ping()
returns trigger language plpgsql security definer set search_path = public as $$
declare j jsonb; o jsonb; p uuid;
begin
  j := to_jsonb(case when tg_op = 'DELETE' then old else new end); o := case when tg_op = 'UPDATE' then to_jsonb(old) else j end;
  if tg_table_name = 'werf_fotos' and not (coalesce((j->>'gedeeld_klant')::boolean, false) or coalesce((o->>'gedeeld_klant')::boolean, false)) then return null; end if;
  if tg_table_name = 'woningdossier' and not exists (select 1 from public.projecten where id = (j->>'project_id')::uuid and dossier_klant) then return null; end if;
  p := (j->>'project_id')::uuid;
  if p is not null and exists (select 1 from public.projecten where id = p) then
    insert into public.portaal_pings (project_id, gewijzigd_op) values (p, now())
    on conflict (project_id) do update set gewijzigd_op = now() where public.portaal_pings.gewijzigd_op < now();
  end if;
  return null;
end $$;
do $$
declare t text;
begin
  foreach t in array array['werf_fotos', 'werf_updates', 'woningdossier'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_portaal_ping', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.werf_foto_ping()', t || '_portaal_ping', t);
  end loop;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['werf_fotos', 'werf_updates', 'woningdossier'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------- rechten ----------
select public.rechten_herstellen();
revoke insert, update, delete, truncate, references, trigger on public.portaal_pings from authenticated, anon;
revoke all on function public.portaal_ping() from public, anon, authenticated;
revoke all on function public.keuze_optie_ping() from public, anon, authenticated;
revoke all on function public.werf_foto_ping() from public, anon, authenticated;
revoke all on function public.werf_fotos_gedeeld() from public, anon, authenticated;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(36, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: moet 3 | 1 | 1 teruggeven
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('werf_fotos', 'werf_updates', 'woningdossier'))::int as tabellen,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'klant_project' and column_name = 'dossier_klant')::int as dossier_vlag,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'klant_ik' and column_name = 'taal')::int as taal;
