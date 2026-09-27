-- =====================================================================
--  BROS Planbord — databasescript 028: meldingen aan aannemers
--  - project_contacten.verwittigd_op: wanneer de partij per mail verwittigd werd dat ze aan het project gekoppeld is
--  - prijsaanvragen.herinnerd_op / herinneringen: automatische wekelijkse herinnering zolang een prijsaanvraag open staat
--    (het Drive-script stuurt ze vanuit de uurlijkse trigger van documentenDigest)
--  Vereist schema 27. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 27 then
    raise exception 'Voer eerst de scripts tot en met 027 uit.';
  end if;
end $$;

alter table public.project_contacten add column if not exists verwittigd_op timestamptz;
alter table public.prijsaanvragen
  add column if not exists herinnerd_op  timestamptz,
  add column if not exists herinneringen int not null default 0;

create index if not exists prijsaanvragen_open_idx on public.prijsaanvragen(status, herinnerd_op) where status = 'open';

update public.instellingen set value = jsonb_set(value, '{versie_schema}', '28'::jsonb), updated_at = now() where key = 'app';

-- Controle: moet 2 teruggeven
select count(*) from information_schema.columns
 where (table_name = 'prijsaanvragen' and column_name = 'herinnerd_op') or (table_name = 'project_contacten' and column_name = 'verwittigd_op');
