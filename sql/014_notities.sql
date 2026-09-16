-- =====================================================================
--  BROS Planbord — databasescript 014: notities / verslagen per project
--  - notities: vergaderingen, werfverslagen, besprekingen, feedback, losse notities
--  - verantwoordelijken: teamleden (profiles) én contacten (aannemers, architect, …)
--  - taken kunnen aan een notitie hangen (actiepunten): taken.notitie_id
--  - klant_zichtbaar: het verslag (met zijn actiepunten) staat in het klantenportaal onder "Verslagen"
--  Alleen toevoegingen; mag opnieuw uitgevoerd worden.
-- =====================================================================

create table if not exists public.notities (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projecten(id) on delete cascade,
  soort           text not null default 'vergadering' check (soort in ('vergadering','werfverslag','bespreking','feedback','notitie')),
  titel           text not null default '',
  datum           date not null default current_date,
  deelnemers      text not null default '',                       -- vrije tekst: wie was erbij
  inhoud          text not null default '',
  verantwoordelijken uuid[] not null default '{}',                -- teamleden (profiles.id)
  contact_ids     uuid[] not null default '{}',                   -- contacten (aannemers, architect, …)
  klant_zichtbaar boolean not null default false,
  gedeeld_op      timestamptz,                                    -- wanneer voor het eerst gedeeld met de klant
  auteur          uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists notities_project_idx on public.notities(project_id, datum desc);
alter table public.notities enable row level security;
drop policy if exists notities_intern on public.notities;
create policy notities_intern on public.notities for all to authenticated using (public.is_intern()) with check (public.is_intern());
drop trigger if exists notities_touch on public.notities;
create trigger notities_touch before update on public.notities for each row execute function public.touch_updated_at();

alter table public.taken add column if not exists notitie_id uuid references public.notities(id) on delete set null;
create index if not exists taken_notitie_idx on public.taken(notitie_id);

-- ---------- klantportaal: gedeelde verslagen + hun actiepunten ----------
create or replace view public.klant_notities as
  select n.id, n.project_id, n.soort, n.titel, n.datum, n.deelnemers, n.inhoud, n.gedeeld_op, n.updated_at, p.name as auteur_naam
  from public.notities n
  left join public.profiles p on p.id = n.auteur
  where n.klant_zichtbaar and n.project_id in (select public.klant_projecten());

create or replace view public.klant_notitie_taken as
  select t.id, t.notitie_id, t.project_id, t.titel, t.eind, t.status, p.name as wie
  from public.taken t
  join public.notities n on n.id = t.notitie_id and n.klant_zichtbaar
  left join public.profiles p on p.id = t.assignee
  where t.project_id in (select public.klant_projecten());

revoke all on public.klant_notities, public.klant_notitie_taken from anon;
grant select on public.klant_notities, public.klant_notitie_taken to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notities') then
    alter publication supabase_realtime add table public.notities;
  end if;
end $$;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', '14'::jsonb), updated_at = now() where key = 'app';

-- Controle: moet 'notities' teruggeven
select table_name from information_schema.tables where table_schema = 'public' and table_name = 'notities';
