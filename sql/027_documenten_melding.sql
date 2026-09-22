-- =====================================================================
--  BROS Planbord — databasescript 027: gebundelde melding bij gedeelde documenten
--  - documenten.gedeeld_op / gedeeld_aannemers_op: wanneer een bestand (voor het laatst) gedeeld werd
--  - documenten.gemeld_klant / gemeld_aannemers: al opgenomen in een verzamelmail? (het Drive-script zet dit)
--  Het Drive-script (documentenDigest, elk uur) mailt per project één overzicht aan de klant en aan de aannemers
--  zodra er 45 minuten niets meer gedeeld werd. Vereist schema 26. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 26 then
    raise exception 'Voer eerst de scripts tot en met 026 uit.';
  end if;
end $$;

alter table public.documenten
  add column if not exists gedeeld_op            timestamptz,
  add column if not exists gedeeld_aannemers_op  timestamptz,
  add column if not exists gemeld_klant          boolean not null default true,     -- bestaande gedeelde bestanden niet alsnog melden
  add column if not exists gemeld_aannemers      boolean not null default true;

create or replace function public.documenten_gedeeld()
returns trigger language plpgsql as $$
begin
  if new.gedeeld and not coalesce(old.gedeeld, false) then new.gedeeld_op := now(); new.gemeld_klant := false; end if;
  if not new.gedeeld then new.gemeld_klant := true; end if;
  if new.gedeeld_aannemers and not coalesce(old.gedeeld_aannemers, false) then new.gedeeld_aannemers_op := now(); new.gemeld_aannemers := false; end if;
  if not new.gedeeld_aannemers then new.gemeld_aannemers := true; end if;
  return new;
end $$;
drop trigger if exists documenten_gedeeld on public.documenten;
create trigger documenten_gedeeld before update of gedeeld, gedeeld_aannemers on public.documenten for each row execute function public.documenten_gedeeld();

create index if not exists documenten_gemeld_idx on public.documenten(gemeld_klant, gemeld_aannemers) where not gemeld_klant or not gemeld_aannemers;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', '27'::jsonb), updated_at = now() where key = 'app';

-- Controle: moet 1 teruggeven
select count(*) from pg_trigger where tgname = 'documenten_gedeeld';
