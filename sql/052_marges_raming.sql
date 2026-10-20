-- =====================================================================
--  BROS Planbord — databasescript 052: geraamde marges in de meetstaat (v1.55)
--  Voor posten zonder offerte van een aannemer (bv. een meetstaat die met klantprijzen uit Excel geïmporteerd werd)
--  duidt beheer aan hoeveel marge BROS erop heeft. De KLANTPRIJS VERANDERT NIET: de marge bepaalt enkel de geraamde
--  kostprijs (kost = klantprijs / (1 + marge %) of klantprijs − marge in €) voor de marge in de meetstaat en de
--  financiële planning.
--  - ms_raming: per post óf per lot van een project:
--      bron   'auto' (standaard) · 'aannemer' (er zit een aannemersofferte achter: de ingevulde kostprijs telt) · 'raming'
--      marge  % op de kostprijs (0,25 = 25 %)  — of —  bedrag: de marge in € (voor een lot: verdeeld over de geraamde posten)
--    Leeg = de marge van het lot, dan de standaardmarge van het project (Financiële planning), dan de algemene standaard.
--  - Alleen beheer kan dit lezen of wijzigen (zoals kostprijzen en de financiële planning). Klanten, aannemers en
--    medewerkers zien niets.
--  Vereist schema 51. Alleen toevoegingen; mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 51 then
    raise exception 'Voer eerst de scripts tot en met 051 uit.';
  end if;
end $$;

create table if not exists public.ms_raming (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projecten(id) on delete cascade,
  lot         int,                                                            -- lotregel (post_id leeg)
  post_id     uuid unique references public.meetstaat_posten(id) on delete cascade,   -- postregel (lot leeg)
  bron        text not null default 'auto' check (bron in ('auto', 'aannemer', 'raming')),
  marge       numeric(8,6) check (marge is null or (marge > -1 and marge <= 10)),     -- op de kostprijs
  bedrag      numeric(12,2) check (bedrag is null or abs(bedrag) < 100000000),       -- marge in euro excl. btw
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  constraint ms_raming_soort check ((post_id is null) <> (lot is null)),
  constraint ms_raming_een check (marge is null or bedrag is null),
  constraint ms_raming_lot unique (project_id, lot)                                -- postregels hebben lot = null (telt niet mee)
);
create index if not exists ms_raming_project_idx on public.ms_raming(project_id);

-- een postregel hoort bij het project van die post
create or replace function public.ms_raming_check()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.post_id is not null and not exists (select 1 from public.meetstaat_posten m where m.id = new.post_id and m.project_id = new.project_id) then
    raise exception 'Deze post hoort niet bij dit project.';
  end if;
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists ms_raming_check on public.ms_raming;
create trigger ms_raming_check before insert or update on public.ms_raming for each row execute function public.ms_raming_check();

alter table public.ms_raming enable row level security;
drop policy if exists ms_raming_beheer on public.ms_raming;
create policy ms_raming_beheer on public.ms_raming for all to authenticated using ((select public.is_beheer())) with check ((select public.is_beheer()));

-- realtime (andere beheerders zien een wijziging meteen)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'ms_raming') then
    alter publication supabase_realtime add table public.ms_raming;
  end if;
end $$;

-- rechten
revoke all on public.ms_raming from anon;
revoke truncate, references, trigger on public.ms_raming from authenticated;
grant select, insert, update, delete on public.ms_raming to authenticated;
revoke all on function public.ms_raming_check() from public, anon, authenticated;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(52, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: moet 1 | 1 | 52 teruggeven (tabel aanwezig, met RLS, schemaversie).
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'ms_raming')::int as tabel,
       (select count(*) from pg_tables where schemaname = 'public' and tablename = 'ms_raming' and rowsecurity)::int as rls,
       (select (value->>'versie_schema')::int from public.instellingen where key = 'app') as schema;
