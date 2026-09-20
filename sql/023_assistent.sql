-- =====================================================================
--  BROS Planbord — databasescript 023: AI-assistent in het klantenportaal (fase 9)
--  - assistent_gesprekken / assistent_berichten: het gesprek per klant en project (vraag + antwoord, tokens, kost)
--  - taak_voorstellen: wat de assistent aan BROS voorstelt; BROS bevestigt (→ echte taak), past aan of weigert
--  - projecten.assistent: per project aan/uit; instellingen 'assistent': model, plafond, routering, toon
--  - de Edge Function 'assistent' (supabase/functions/assistent) schrijft berichten en voorstellen met de service-sleutel;
--    de klant leest zijn eigen gesprek via de view klant_assistent_berichten
--  Vereist schema 22. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 22 then
    raise exception 'Voer eerst de scripts tot en met 022 uit.';
  end if;
end $$;

alter table public.projecten add column if not exists assistent boolean not null default true;

create table if not exists public.assistent_gesprekken (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projecten(id) on delete cascade,
  user_id       uuid not null,                                   -- de klantlogin (auth.users)
  contact_id    uuid references public.contacten(id) on delete set null,
  gestart_op    timestamptz not null default now(),
  laatste_op    timestamptz not null default now()
);
create unique index if not exists assistent_gesprekken_uniq on public.assistent_gesprekken(project_id, user_id);

create table if not exists public.assistent_berichten (
  id            uuid primary key default gen_random_uuid(),
  gesprek_id    uuid not null references public.assistent_gesprekken(id) on delete cascade,
  project_id    uuid not null references public.projecten(id) on delete cascade,
  rol           text not null check (rol in ('klant', 'assistent')),
  tekst         text not null default '',
  tokens_in     int not null default 0,
  tokens_uit    int not null default 0,
  kost          numeric(10,5) not null default 0,               -- geschatte kost in euro
  model         text not null default '',
  created_at    timestamptz not null default now()
);
create index if not exists assistent_berichten_gesprek_idx on public.assistent_berichten(gesprek_id, created_at);
create index if not exists assistent_berichten_project_idx on public.assistent_berichten(project_id, created_at);

create table if not exists public.taak_voorstellen (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projecten(id) on delete cascade,
  bericht_id          uuid references public.assistent_berichten(id) on delete set null,
  titel               text not null default '',
  onderwerp           text not null default 'overig' check (onderwerp in ('planning', 'facturatie', 'ontwerp', 'documenten', 'klacht', 'overig')),
  omschrijving        text not null default '',
  vraag               text not null default '',
  antwoord            text not null default '',
  voorgestelde_user   uuid references public.profiles(id),
  eind                date,
  urgentie            text not null default 'normaal' check (urgentie in ('normaal', 'hoog')),
  status              text not null default 'open' check (status in ('open', 'bevestigd', 'geweigerd')),
  taak_id             uuid references public.taken(id) on delete set null,
  beoordeeld_door     uuid references public.profiles(id),
  beoordeeld_op       timestamptz,
  reden               text not null default '',
  created_at          timestamptz not null default now()
);
create index if not exists taak_voorstellen_status_idx on public.taak_voorstellen(status, created_at);

-- rechten: team leest alles; de klant leest enkel zijn eigen gesprek (via de view); schrijven doet de Edge Function (service-sleutel)
alter table public.assistent_gesprekken enable row level security;
alter table public.assistent_berichten enable row level security;
alter table public.taak_voorstellen enable row level security;
drop policy if exists ag_intern on public.assistent_gesprekken;
create policy ag_intern on public.assistent_gesprekken for select to authenticated using (public.is_intern());
drop policy if exists ab_intern on public.assistent_berichten;
create policy ab_intern on public.assistent_berichten for select to authenticated using (public.is_intern());
drop policy if exists tv_intern on public.taak_voorstellen;
create policy tv_intern on public.taak_voorstellen for all to authenticated using (public.is_intern()) with check (public.is_intern());

create or replace view public.klant_assistent_berichten as
  select b.id, b.project_id, b.rol, b.tekst, b.created_at
  from public.assistent_berichten b
  join public.assistent_gesprekken g on g.id = b.gesprek_id
  where g.user_id = auth.uid() and b.project_id in (select public.klant_projecten());
revoke all on public.klant_assistent_berichten from anon;
grant select on public.klant_assistent_berichten to authenticated;

-- klant_project: ook de schakelaar 'assistent' meegeven aan het portaal
drop view if exists public.klant_project;
create view public.klant_project as
  select p.id, p.nummer, p.klant, p.naam, p.adres, p.postcode, p.gemeente, p.status, p.fase_nr, p.start, p.eind,
         p.projecttype, p.btw_tarief, p.offerte_datum, p.contract_datum, p.opgeleverd_op, p.lead, p.assistent
  from public.projecten p
  where p.id in (select public.klant_projecten());
revoke all on public.klant_project from anon;
grant select on public.klant_project to authenticated;

-- voorstel bevestigen → echte taak (in één beweging), of weigeren
create or replace function public.voorstel_bevestig(p_id uuid, p_titel text default null, p_assignee uuid default null, p_eind date default null, p_fase int default null)
returns public.taak_voorstellen language plpgsql security definer set search_path = public as $$
declare v public.taak_voorstellen; t_id uuid; v_fase int;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  select * into v from public.taak_voorstellen where id = p_id for update;
  if v.id is null then raise exception 'Voorstel niet gevonden.'; end if;
  if v.status <> 'open' then raise exception 'Dit voorstel is al beoordeeld.'; end if;
  select coalesce(p_fase, fase_nr) into v_fase from public.projecten where id = v.project_id;
  insert into public.taken (project_id, titel, fase_nr, assignee, status, eind, uren_gepland, notitie, volgorde)
  values (v.project_id, coalesce(nullif(trim(p_titel), ''), v.titel), v_fase, coalesce(p_assignee, v.voorgestelde_user), 'todo', coalesce(p_eind, v.eind), 0,
          left('Vraag van de klant via het portaal: ' || v.vraag, 500), 9800)
  returning id into t_id;
  update public.taak_voorstellen set status = 'bevestigd', taak_id = t_id, beoordeeld_door = auth.uid(), beoordeeld_op = now(),
         titel = coalesce(nullif(trim(p_titel), ''), titel), voorgestelde_user = coalesce(p_assignee, voorgestelde_user), eind = coalesce(p_eind, eind)
   where id = p_id returning * into v;
  return v;
end $$;
grant execute on function public.voorstel_bevestig(uuid, text, uuid, date, int) to authenticated;

create or replace function public.voorstel_weiger(p_id uuid, p_reden text default '')
returns public.taak_voorstellen language plpgsql security definer set search_path = public as $$
declare v public.taak_voorstellen;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  update public.taak_voorstellen set status = 'geweigerd', reden = coalesce(p_reden, ''), beoordeeld_door = auth.uid(), beoordeeld_op = now()
   where id = p_id and status = 'open' returning * into v;
  if v.id is null then raise exception 'Voorstel niet gevonden of al beoordeeld.'; end if;
  return v;
end $$;
grant execute on function public.voorstel_weiger(uuid, text) to authenticated;

-- instellingen: model, plafond, routering (standaard: planning → Thomas, al de rest → Phil; aanpasbaar in Instellingen → Assistent)
insert into public.instellingen (key, value) values ('assistent', jsonb_build_object(
  'actief', true,
  'model', 'gpt-4o-mini',
  'functie', 'assistent',
  'plafond_project', 30,
  'plafond_globaal', 600,
  'datums', true,
  'begroeting', 'Vraag gerust iets over je project — over de planning, de meetstaat, de facturatie of de documenten. Een medewerker van BROS kijkt mee.',
  'routering', jsonb_build_object(
    'planning',   (select id from public.profiles where role in ('beheer','medewerker') and name ilike 'thomas%' limit 1),
    'facturatie', (select id from public.profiles where role = 'beheer' order by created_at limit 1),
    'ontwerp',    (select id from public.profiles where role = 'beheer' order by created_at limit 1),
    'documenten', (select id from public.profiles where role = 'beheer' order by created_at limit 1),
    'klacht',     (select id from public.profiles where role = 'beheer' order by created_at limit 1),
    'overig',     (select id from public.profiles where role = 'beheer' order by created_at limit 1))
)) on conflict (key) do nothing;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'taak_voorstellen') then alter publication supabase_realtime add table public.taak_voorstellen; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'assistent_berichten') then alter publication supabase_realtime add table public.assistent_berichten; end if;
end $$;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', '23'::jsonb), updated_at = now() where key = 'app';

-- Controle: moet 1 teruggeven
select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'taak_voorstellen';
