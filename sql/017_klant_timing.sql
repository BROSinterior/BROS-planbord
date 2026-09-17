-- =====================================================================
--  BROS Planbord — databasescript 017: timing voor de klant
--  - klant_timing: per project en fase een vastgezette van–tot (en toelichting) voor de klant; zonder record volgt de fase automatisch de taken
--  - taken.timing_klant: schakelaar per taak "timing delen met de klant" (titel + van–tot in het portaal)
--  - klant_planning: automatisch uit de taken, tenzij vastgezet; nieuwe view klant_planning_taken
--  Alleen toevoegingen; mag opnieuw uitgevoerd worden.
-- =====================================================================

create table if not exists public.klant_timing (
  project_id  uuid not null references public.projecten(id) on delete cascade,
  fase_nr     int  not null references public.fasen(nr) on delete cascade,
  start       date,
  eind        date,
  opmerking   text not null default '',
  updated_at  timestamptz not null default now(),
  primary key (project_id, fase_nr)
);
alter table public.klant_timing enable row level security;
drop policy if exists kt_intern on public.klant_timing;
create policy kt_intern on public.klant_timing for all to authenticated using (public.is_intern()) with check (public.is_intern());
drop trigger if exists klant_timing_touch on public.klant_timing;
create trigger klant_timing_touch before update on public.klant_timing for each row execute function public.touch_updated_at();

alter table public.taken add column if not exists timing_klant boolean not null default false;

-- planning voor de klant: automatisch uit de taken (vroegste start, laatste einde), tenzij BROS de fase vastzet in klant_timing
drop view if exists public.klant_planning;
create view public.klant_planning as
  with fasen_van_project as (
    select t.project_id, t.fase_nr from public.taken t where t.fase_nr is not null
    union
    select kt.project_id, kt.fase_nr from public.klant_timing kt
  )
  select f.project_id, f.fase_nr,
         coalesce(kt.start, (select min(t.start) from public.taken t where t.project_id = f.project_id and t.fase_nr = f.fase_nr)) as start,
         coalesce(kt.eind,  (select max(t.eind)  from public.taken t where t.project_id = f.project_id and t.fase_nr = f.fase_nr)) as eind,
         coalesce(kt.opmerking, '') as opmerking,
         (kt.start is not null or kt.eind is not null) as vast,
         (select count(*) from public.taken t where t.project_id = f.project_id and t.fase_nr = f.fase_nr)::int as taken,
         (select count(*) from public.taken t where t.project_id = f.project_id and t.fase_nr = f.fase_nr and t.status = 'done')::int as klaar
  from fasen_van_project f
  left join public.klant_timing kt on kt.project_id = f.project_id and kt.fase_nr = f.fase_nr
  where f.project_id in (select public.klant_projecten());

-- taken waarvan de timing gedeeld wordt: titel, fase, van–tot, status (geen uren, geen wie)
create or replace view public.klant_planning_taken as
  select t.id, t.project_id, t.fase_nr, t.titel, t.start, t.eind, t.status, t.volgorde
  from public.taken t
  where t.timing_klant and t.project_id in (select public.klant_projecten());

revoke all on public.klant_planning, public.klant_planning_taken from anon;
grant select on public.klant_planning, public.klant_planning_taken to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'klant_timing') then alter publication supabase_realtime add table public.klant_timing; end if;
end $$;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', '17'::jsonb), updated_at = now() where key = 'app';

-- Controle: moet 1 teruggeven
select count(*) from information_schema.columns where table_name = 'taken' and column_name = 'timing_klant';
