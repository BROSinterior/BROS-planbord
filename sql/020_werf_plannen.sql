-- =====================================================================
--  BROS Planbord — databasescript 020: werfplannen (stap 2a)
--  - werfplannen: plannen per project (pdf-pagina's of afbeeldingen, als jpeg in de bucket 'werf')
--  - vaststellingen.plan_id + plan_x/plan_y: pin op het plan (verhoudingen 0–1 van breedte en hoogte)
--  Alleen toevoegingen; mag opnieuw uitgevoerd worden (na script 016).
-- =====================================================================

create table if not exists public.werfplannen (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projecten(id) on delete cascade,
  naam        text not null default '',
  path        text not null default '',
  url         text not null default '',
  w           int,
  h           int,
  volgorde    int not null default 0,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists werfplannen_project_idx on public.werfplannen(project_id, volgorde);
alter table public.werfplannen enable row level security;
drop policy if exists wp_intern on public.werfplannen;
create policy wp_intern on public.werfplannen for all to authenticated using (public.is_intern()) with check (public.is_intern());

alter table public.vaststellingen add column if not exists plan_id uuid references public.werfplannen(id) on delete set null;
alter table public.vaststellingen add column if not exists plan_x numeric(6,4);
alter table public.vaststellingen add column if not exists plan_y numeric(6,4);
create index if not exists vaststellingen_plan_idx on public.vaststellingen(plan_id);

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'werfplannen') then alter publication supabase_realtime add table public.werfplannen; end if;
end $$;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', '20'::jsonb), updated_at = now() where key = 'app';

-- Controle: moet 1 teruggeven
select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'werfplannen';
