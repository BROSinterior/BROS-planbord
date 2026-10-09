-- =====================================================================
--  BROS Planbord — databasescript 040: standaardverantwoordelijke per fase en per standaardtaak
--  - fasen.standaard_wie:          null = projectlead, of een medewerker (profiel-id)
--  - standaardtaken.standaard_wie: null = zoals de fase, 'lead' = projectlead, of een medewerker (profiel-id)
--  - taken.standaard_taak:         van welke standaardtaak een taak komt (om later de verdeling toe te passen op lopende projecten)
--  Wie een standaardtaak krijgt bij een nieuw project of een toegevoegde fase: taak → fase → projectlead.
--  Een medewerker die op inactief staat, valt terug op de projectlead.
--  Instellen: Planbord › Instellingen › Fasen en standaardtaken. Enkel beheer kan dit wijzigen (bestaande policies).
--  Vereist schema 39. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 39 then
    raise exception 'Voer eerst de scripts tot en met 039 uit.';
  end if;
end $$;

alter table public.fasen          add column if not exists standaard_wie text;
alter table public.standaardtaken add column if not exists standaard_wie text;
alter table public.fasen          drop constraint if exists fasen_standaard_wie_check;
alter table public.standaardtaken drop constraint if exists standaardtaken_standaard_wie_check;
alter table public.fasen add constraint fasen_standaard_wie_check
  check (standaard_wie is null or standaard_wie ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
alter table public.standaardtaken add constraint standaardtaken_standaard_wie_check
  check (standaard_wie is null or standaard_wie = 'lead' or standaard_wie ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

alter table public.taken add column if not exists standaard_taak int references public.standaardtaken(id) on delete set null;
create index if not exists taken_standaard_taak_idx on public.taken(standaard_taak);
-- bestaande taken koppelen aan hun standaardtaak (zelfde fase en titel)
update public.taken t set standaard_taak = s.id
  from public.standaardtaken s
 where t.standaard_taak is null and t.fase_nr = s.fase_nr and lower(trim(t.titel)) = lower(trim(s.titel));

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(40, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: aantal fasen | standaardtaken | taken gekoppeld aan een standaardtaak (de laatste mag 0 zijn)
select (select count(*) from public.fasen)::int as fasen,
       (select count(*) from public.standaardtaken)::int as standaardtaken,
       (select count(*) from public.taken where standaard_taak is not null)::int as gekoppelde_taken;
