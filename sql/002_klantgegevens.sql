-- =====================================================================
--  BROS Planbord — databasescript 002: klantgegevens op het project
--  Alleen toevoegingen (veilig tijdens gebruik). Mag opnieuw uitgevoerd worden.
-- =====================================================================
alter table public.projecten
  add column if not exists postcode        text    not null default '',
  add column if not exists gsm1            text    not null default '',
  add column if not exists gsm2            text    not null default '',
  add column if not exists email1          text    not null default '',
  add column if not exists email2          text    not null default '',
  add column if not exists factuur_email1  boolean not null default false,
  add column if not exists factuur_email2  boolean not null default false;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', '2'::jsonb), updated_at = now() where key = 'app';

select column_name from information_schema.columns where table_schema = 'public' and table_name = 'projecten' and column_name in ('postcode','gsm1','gsm2','email1','email2','factuur_email1','factuur_email2');
