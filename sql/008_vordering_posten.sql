-- =====================================================================
--  BROS Planbord — databasescript 008: vorderingen per lot én per post
--  vordering_regels krijgt een eigen id en een optionele post_id:
--   - post_id leeg  = percentage voor het hele lot
--   - post_id gevuld = percentage voor die ene meetstaatregel (overschrijft het lot-%)
--  Alleen toevoegingen; mag opnieuw uitgevoerd worden.
-- =====================================================================
alter table public.vordering_regels add column if not exists post_id uuid references public.meetstaat_posten(id) on delete cascade;
alter table public.vordering_regels add column if not exists id uuid not null default gen_random_uuid();

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'vordering_regels_pkey' and conrelid = 'public.vordering_regels'::regclass
             and (select count(*) from unnest(conkey)) = 2) then
    alter table public.vordering_regels drop constraint vordering_regels_pkey;
    alter table public.vordering_regels add constraint vordering_regels_pkey primary key (id);
  end if;
end $$;

create unique index if not exists vordering_regels_uniq
  on public.vordering_regels (vordering_id, lot, coalesce(post_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists vordering_regels_post_idx on public.vordering_regels(post_id);

update public.instellingen set value = jsonb_set(value, '{versie_schema}', '8'::jsonb), updated_at = now() where key = 'app';
select column_name from information_schema.columns where table_name = 'vordering_regels' order by ordinal_position;
