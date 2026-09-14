-- =====================================================================
--  BROS Planbord — databasescript 006: Drive-koppeling
--  Documenten per project + instellingen voor het Drive-script.
--  Alleen toevoegingen; mag opnieuw uitgevoerd worden.
-- =====================================================================
alter table public.projecten
  add column if not exists drive_folder_id text not null default '',
  add column if not exists drive_url       text not null default '';

create table if not exists public.documenten (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projecten(id) on delete cascade,
  drive_id    text not null,
  naam        text not null,
  pad         text not null default '',
  url         text not null default '',
  mime        text not null default '',
  grootte     bigint,
  gewijzigd   timestamptz,
  gesynct_op  timestamptz not null default now(),
  unique (project_id, drive_id)
);
create index if not exists documenten_project_idx on public.documenten(project_id);

alter table public.documenten enable row level security;
drop policy if exists documenten_all on public.documenten;
create policy documenten_all on public.documenten for all to authenticated using (true) with check (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'documenten') then
    execute 'alter publication supabase_realtime add table public.documenten';
  end if;
end $$;

insert into public.instellingen (key, value) values ('drive', '{"url":"","secret":""}'::jsonb) on conflict (key) do nothing;
update public.instellingen set value = jsonb_set(value, '{versie_schema}', '6'::jsonb), updated_at = now() where key = 'app';

select column_name from information_schema.columns where table_name = 'documenten' order by ordinal_position;
