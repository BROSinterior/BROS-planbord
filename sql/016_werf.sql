-- =====================================================================
--  BROS Planbord — databasescript 016: werfopvolging (stap 1)
--  - werfbezoeken: één record per bezoek (datum, aanwezigen, notities)
--  - vaststellingen: genummerde punten met foto's, ruimte, verantwoordelijke aannemer (contact), deadline en status
--  - storage-bucket 'werf' voor de foto's (publiek leesbaar via onraadbare paden; schrijven: team)
--  Alleen toevoegingen; mag opnieuw uitgevoerd worden.
-- =====================================================================

create table if not exists public.werfbezoeken (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projecten(id) on delete cascade,
  nr          int not null default 1,                          -- volgnummer per project
  datum       date not null default current_date,
  aanwezigen  text not null default '',
  notities    text not null default '',
  weer        text not null default '',
  auteur      uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists werfbezoeken_project_idx on public.werfbezoeken(project_id, datum desc);
alter table public.werfbezoeken enable row level security;
drop policy if exists wb_intern on public.werfbezoeken;
create policy wb_intern on public.werfbezoeken for all to authenticated using (public.is_intern()) with check (public.is_intern());
drop trigger if exists werfbezoeken_touch on public.werfbezoeken;
create trigger werfbezoeken_touch before update on public.werfbezoeken for each row execute function public.touch_updated_at();

create table if not exists public.vaststellingen (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projecten(id) on delete cascade,
  bezoek_id     uuid references public.werfbezoeken(id) on delete set null,
  nr            int not null default 1,                        -- volgnummer per project (V-001, V-002, …)
  omschrijving  text not null default '',
  ruimte        text not null default '',                      -- locatie / ruimte / verdieping
  lot           int references public.loten(nr),
  contact_id    uuid references public.contacten(id) on delete set null,   -- verantwoordelijke aannemer
  assignee      uuid references public.profiles(id),                        -- of een teamlid
  prioriteit    text not null default 'normaal' check (prioriteit in ('laag','normaal','hoog')),
  deadline      date,
  status        text not null default 'open' check (status in ('open','opgelost','gecontroleerd','vervallen')),
  fotos         jsonb not null default '[]'::jsonb,            -- [{path, url, w, h, op}]
  opgelost_op   timestamptz,
  opgelost_door uuid,
  opgelost_fotos jsonb not null default '[]'::jsonb,           -- bewijsfoto's van de aannemer (stap 3)
  opmerking     text not null default '',                      -- reactie / opmerking bij oplossing
  klant_zichtbaar boolean not null default false,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists vaststellingen_project_idx on public.vaststellingen(project_id, nr);
create index if not exists vaststellingen_contact_idx on public.vaststellingen(contact_id);
alter table public.vaststellingen enable row level security;
drop policy if exists vs_intern on public.vaststellingen;
create policy vs_intern on public.vaststellingen for all to authenticated using (public.is_intern()) with check (public.is_intern());
drop trigger if exists vaststellingen_touch on public.vaststellingen;
create trigger vaststellingen_touch before update on public.vaststellingen for each row execute function public.touch_updated_at();

-- volgnummers per project automatisch (ook bij offline gesyncte punten)
create or replace function public.werf_nummer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'vaststellingen' then
    if new.nr is null or new.nr <= 0 or exists (select 1 from public.vaststellingen v where v.project_id = new.project_id and v.nr = new.nr and v.id <> new.id) then
      select coalesce(max(nr), 0) + 1 into new.nr from public.vaststellingen where project_id = new.project_id;
    end if;
  else
    if new.nr is null or new.nr <= 0 or exists (select 1 from public.werfbezoeken w where w.project_id = new.project_id and w.nr = new.nr and w.id <> new.id) then
      select coalesce(max(nr), 0) + 1 into new.nr from public.werfbezoeken where project_id = new.project_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists vaststellingen_nr on public.vaststellingen;
create trigger vaststellingen_nr before insert on public.vaststellingen for each row execute function public.werf_nummer();
drop trigger if exists werfbezoeken_nr on public.werfbezoeken;
create trigger werfbezoeken_nr before insert on public.werfbezoeken for each row execute function public.werf_nummer();

-- ---------- foto's: bucket 'werf' ----------
insert into storage.buckets (id, name, public) values ('werf', 'werf', true) on conflict (id) do update set public = true;
drop policy if exists werf_read on storage.objects;
create policy werf_read on storage.objects for select using (bucket_id = 'werf');
drop policy if exists werf_insert on storage.objects;
create policy werf_insert on storage.objects for insert to authenticated with check (bucket_id = 'werf' and public.is_intern());
drop policy if exists werf_update on storage.objects;
create policy werf_update on storage.objects for update to authenticated using (bucket_id = 'werf' and public.is_intern());
drop policy if exists werf_delete on storage.objects;
create policy werf_delete on storage.objects for delete to authenticated using (bucket_id = 'werf' and public.is_intern());

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'werfbezoeken') then alter publication supabase_realtime add table public.werfbezoeken; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'vaststellingen') then alter publication supabase_realtime add table public.vaststellingen; end if;
end $$;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', '16'::jsonb), updated_at = now() where key = 'app';

-- Controle: moet 2 teruggeven
select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('werfbezoeken','vaststellingen');
