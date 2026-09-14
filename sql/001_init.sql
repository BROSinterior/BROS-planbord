-- =====================================================================
--  BROS Planbord — databasescript 001 (eerste opzet)
--  Uitvoeren in Supabase: SQL Editor → New query → plakken → Run
--  Dit script is idempotent: het mag opnieuw uitgevoerd worden.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. Gebruikersprofielen (gekoppeld aan de Supabase-login)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text unique,
  name        text not null default '',
  initials    text not null default '',
  role        text not null default 'medewerker' check (role in ('beheer','medewerker')),
  color       text not null default '#2A4DD0',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Uurtarieven apart, zodat alleen beheerders ze kunnen zien
create table if not exists public.tarieven (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  intern      numeric(8,2) not null default 0,
  extern      numeric(8,2) not null default 0,
  updated_at  timestamptz not null default now()
);

-- Nieuwe login → automatisch een profiel
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  v_name := coalesce(new.raw_user_meta_data->>'name', initcap(split_part(new.email, '@', 1)));
  insert into public.profiles (id, email, name, initials, role)
  values (new.id, new.email, v_name, upper(left(v_name, 2)),
          case when (select count(*) from public.profiles) = 0 then 'beheer' else 'medewerker' end)
  on conflict (id) do nothing;
  insert into public.tarieven (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Hulpfunctie: is de ingelogde gebruiker beheerder?
create or replace function public.is_beheer()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'beheer' from public.profiles where id = auth.uid()), false)
$$;

-- ---------------------------------------------------------------------
-- 2. Fasen en standaardtaken (het BROS Stappenplan)
-- ---------------------------------------------------------------------
create table if not exists public.fasen (
  nr          int primary key,
  naam        text not null,
  actief      boolean not null default true
);

create table if not exists public.standaardtaken (
  id          serial primary key,
  fase_nr     int not null references public.fasen(nr) on delete cascade,
  volgorde    int not null,
  titel       text not null,
  unique (fase_nr, volgorde)
);

-- ---------------------------------------------------------------------
-- 3. Projecten, taken, uren
-- ---------------------------------------------------------------------
create table if not exists public.projecten (
  id          uuid primary key default gen_random_uuid(),
  klant       text not null,
  naam        text not null default '',
  adres       text not null default '',
  gemeente    text not null default '',
  contact     text not null default '',
  status      text not null default 'offerte' check (status in ('offerte','lopend','on_hold','afgerond')),
  fase_nr     int references public.fasen(nr),
  forfait     numeric(12,2),
  lead        uuid references public.profiles(id),
  start       date,
  eind        date,
  drive_map   text not null default '',
  notities    text not null default '',
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.taken (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projecten(id) on delete cascade,
  titel         text not null,
  fase_nr       int references public.fasen(nr),
  assignee      uuid references public.profiles(id),
  start         date,
  eind          date,
  uren_gepland  numeric(8,2) not null default 0,
  status        text not null default 'todo' check (status in ('todo','busy','done')),
  volgorde      int not null default 0,
  notitie       text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists taken_project_idx on public.taken(project_id);
create index if not exists taken_assignee_idx on public.taken(assignee);

create table if not exists public.uren (
  id          uuid primary key default gen_random_uuid(),
  taak_id     uuid references public.taken(id) on delete set null,
  project_id  uuid not null references public.projecten(id) on delete cascade,
  user_id     uuid not null references public.profiles(id),
  datum       date not null,
  uren        numeric(6,2) not null check (uren > 0),
  notitie     text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists uren_project_idx on public.uren(project_id);
create index if not exists uren_user_datum_idx on public.uren(user_id, datum);

create table if not exists public.instellingen (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- updated_at bijhouden
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists projecten_touch on public.projecten;
create trigger projecten_touch before update on public.projecten for each row execute function public.touch_updated_at();
drop trigger if exists taken_touch on public.taken;
create trigger taken_touch before update on public.taken for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- 4. Rechten (Row Level Security): alleen ingelogde gebruikers
-- ---------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.tarieven       enable row level security;
alter table public.fasen          enable row level security;
alter table public.standaardtaken enable row level security;
alter table public.projecten      enable row level security;
alter table public.taken          enable row level security;
alter table public.uren           enable row level security;
alter table public.instellingen   enable row level security;

-- profiles: iedereen leest, eigen profiel bewerken, beheer bewerkt alles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid() or public.is_beheer()) with check (id = auth.uid() or public.is_beheer());

-- tarieven: alleen beheer
drop policy if exists tarieven_beheer on public.tarieven;
create policy tarieven_beheer on public.tarieven for all to authenticated using (public.is_beheer()) with check (public.is_beheer());

-- fasen & standaardtaken: iedereen leest, beheer bewerkt
drop policy if exists fasen_select on public.fasen;
create policy fasen_select on public.fasen for select to authenticated using (true);
drop policy if exists fasen_beheer on public.fasen;
create policy fasen_beheer on public.fasen for all to authenticated using (public.is_beheer()) with check (public.is_beheer());
drop policy if exists standaardtaken_select on public.standaardtaken;
create policy standaardtaken_select on public.standaardtaken for select to authenticated using (true);
drop policy if exists standaardtaken_beheer on public.standaardtaken;
create policy standaardtaken_beheer on public.standaardtaken for all to authenticated using (public.is_beheer()) with check (public.is_beheer());

-- projecten, taken, uren: alle ingelogde medewerkers mogen alles zien en bewerken
drop policy if exists projecten_all on public.projecten;
create policy projecten_all on public.projecten for all to authenticated using (true) with check (true);
drop policy if exists taken_all on public.taken;
create policy taken_all on public.taken for all to authenticated using (true) with check (true);
drop policy if exists uren_all on public.uren;
create policy uren_all on public.uren for all to authenticated using (true) with check (true);

-- instellingen: iedereen leest, beheer bewerkt
drop policy if exists instellingen_select on public.instellingen;
create policy instellingen_select on public.instellingen for select to authenticated using (true);
drop policy if exists instellingen_beheer on public.instellingen;
create policy instellingen_beheer on public.instellingen for all to authenticated using (public.is_beheer()) with check (public.is_beheer());

-- ---------------------------------------------------------------------
-- 5. Live-synchronisatie (realtime)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles','projecten','taken','uren','fasen','standaardtaken']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6. Startgegevens: het BROS Stappenplan (13 fasen, 52 standaardtaken)
-- ---------------------------------------------------------------------
insert into public.fasen (nr, naam) values
  (1,'Briefing'),
  (2,'Afspraak inplannen'),
  (3,'Architect'),
  (4,'Voorontwerp'),
  (5,'Afspraak inplannen met klant'),
  (6,'Plannen uitwerken'),
  (7,'Meetstaat en plannen'),
  (8,'Plannen controleren'),
  (9,'Aannemer'),
  (10,'Afspraak maken met klant'),
  (11,'Planning werken'),
  (12,'Start werken'),
  (13,'Eindfase')
on conflict (nr) do update set naam = excluded.naam;

insert into public.standaardtaken (fase_nr, volgorde, titel) values
  (1,1,'Wat verwacht de klant?'),
  (1,2,'Wat is er besproken met de klant?'),
  (1,3,'Zijn er plannen?'),
  (1,4,'Foto''s bestaande toestand'),
  (2,1,'Afspraak inplannen om ter plaatse te gaan (als dat kan)'),
  (3,1,'Architect contacteren'),
  (3,2,'Afspraak inplannen'),
  (3,3,'Ter plaatse gaan met architect'),
  (3,4,'Ereloon laten weten'),
  (3,5,'Akkoord apart tekenen van het proces'),
  (3,6,'Bouwaanvraag'),
  (4,1,'Grondplannen'),
  (4,2,'Presentatiebundel'),
  (4,3,'Moodboard'),
  (4,4,'3D'),
  (5,1,'Afspraak'),
  (5,2,'Aanpassingen'),
  (5,3,'Nieuwe afspraak inplannen (2 à 3 weken)'),
  (5,4,'Definitief ontwerp'),
  (6,1,'Grondplan'),
  (6,2,'Plan van afbraak'),
  (6,3,'Ruwbouwwerken'),
  (6,4,'Loodgieterij'),
  (6,5,'Elektriciteit & verlichtingsplan'),
  (6,6,'Vloerplan'),
  (6,7,'Verlaagd plafond plan'),
  (6,8,'Aanzichten'),
  (6,9,'Schrijnwerkplannen'),
  (6,10,'Legplan tegels'),
  (7,1,'Meetstaat simultaan maken'),
  (7,2,'Aanpassingen'),
  (8,1,'Controle van plannen'),
  (8,2,'Zijn alle benodigdheden aangekomen?'),
  (9,1,'Alles doorsturen naar aannemer'),
  (9,2,'Afspraak inplannen om ter plaatse te gaan'),
  (9,3,'Meetstaat op basis van plannen'),
  (9,4,'Offerte opvragen'),
  (10,1,'Tegels?'),
  (10,2,'Kraanwerk?'),
  (10,3,'Verlichting kiezen'),
  (10,4,'Offertes met aannemer overlopen en aanpassen'),
  (10,5,'Offertes met klant overlopen'),
  (11,1,'Alles moet vaststaan voor bouwwerken'),
  (11,2,'Planningaanpassingen doorgeven aan klant'),
  (12,1,'Wekelijkse opvolging'),
  (12,2,'Per afgewerkt onderdeel: controle, zit alles op de juiste plaats?'),
  (12,3,'Werfverslag maken en doorsturen'),
  (12,4,'Indien wijzigingen: prijs doorgeven aan klant en akkoord krijgen'),
  (12,5,'Indien aanpassingen ontwerp: nieuwe 3D maken, doorsturen en goedkeuring krijgen'),
  (13,1,'Per afgewerkt onderdeel voorlopige oplevering inplannen'),
  (13,2,'Voorlopige oplevering van het project'),
  (13,3,'Klantgeschenk aanleveren')
on conflict (fase_nr, volgorde) do update set titel = excluded.titel;

insert into public.instellingen (key, value) values
  ('app', '{"naam":"BROS Planbord","versie_schema":1}'::jsonb)
on conflict (key) do nothing;

-- Klaar. Controle: de query hieronder moet 13 en 52 teruggeven.
select (select count(*) from public.fasen) as fasen, (select count(*) from public.standaardtaken) as standaardtaken;
