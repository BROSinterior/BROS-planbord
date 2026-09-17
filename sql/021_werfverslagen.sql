-- =====================================================================
--  BROS Planbord — databasescript 021: werfverslagen (stap 2b)
--  Een werfverslag = pdf (gemaakt in het Planbord) met de vaststellingen en plannen, bewaard in de bucket 'werf',
--  gemaild naar aannemers/klant via het Drive-script en optioneel zichtbaar voor de klant in het portaal.
--  Alleen toevoegingen; mag opnieuw uitgevoerd worden (na script 020).
-- =====================================================================

create table if not exists public.werfverslagen (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projecten(id) on delete cascade,
  bezoek_id     uuid references public.werfbezoeken(id) on delete set null,
  nr            int not null default 1,
  datum         date not null default current_date,
  titel         text not null default '',
  pdf_path      text not null default '',
  pdf_url       text not null default '',
  punten        int not null default 0,
  aan           jsonb not null default '[]'::jsonb,      -- e-mailadressen waarnaar verzonden
  bericht       text not null default '',
  klant_zichtbaar boolean not null default false,
  verzonden_op  timestamptz,
  drive_url     text not null default '',
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);
create index if not exists werfverslagen_project_idx on public.werfverslagen(project_id, nr);
alter table public.werfverslagen enable row level security;
drop policy if exists wv_intern on public.werfverslagen;
create policy wv_intern on public.werfverslagen for all to authenticated using (public.is_intern()) with check (public.is_intern());

create or replace function public.werfverslag_nummer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.nr is null or new.nr <= 0 or exists (select 1 from public.werfverslagen w where w.project_id = new.project_id and w.nr = new.nr and w.id <> new.id) then
    select coalesce(max(nr), 0) + 1 into new.nr from public.werfverslagen where project_id = new.project_id;
  end if;
  return new;
end $$;
drop trigger if exists werfverslagen_nr on public.werfverslagen;
create trigger werfverslagen_nr before insert on public.werfverslagen for each row execute function public.werfverslag_nummer();

-- portaal: gedeelde werfverslagen
create or replace view public.klant_werfverslagen as
  select w.id, w.project_id, w.nr, w.datum, w.titel, w.pdf_url, w.punten, w.verzonden_op, w.created_at
  from public.werfverslagen w
  where w.klant_zichtbaar and w.project_id in (select public.klant_projecten());
revoke all on public.klant_werfverslagen from anon;
grant select on public.klant_werfverslagen to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'werfverslagen') then alter publication supabase_realtime add table public.werfverslagen; end if;
end $$;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', '21'::jsonb), updated_at = now() where key = 'app';

-- Controle: moet 1 teruggeven
select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'werfverslagen';
