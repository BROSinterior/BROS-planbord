-- =====================================================================
--  BROS Planbord — databasescript 010: uren met tijd, zichtbaar voor klant, realtime-fix
--  • taken.uren_klant     : gepresteerde uren van deze taak (met datum/tijd) tonen aan de klant
--  • uren.tijd_van/tot    : optioneel begin- en einduur van een prestatie
--  • realtime             : ALLE tabellen in de publicatie (tarieven ontbrak, waardoor
--                           het live-kanaal in de app nooit werkte)
--  Alleen toevoegingen; mag opnieuw uitgevoerd worden.
-- =====================================================================
alter table public.taken add column if not exists uren_klant boolean not null default false;
alter table public.uren  add column if not exists tijd_van time;
alter table public.uren  add column if not exists tijd_tot time;

do $$
declare t text;
begin
  foreach t in array array['profiles','tarieven','fasen','standaardtaken','projecten','taken','uren','documenten','instellingen','loten','posten','meetstaat_posten','vorderingen','vordering_regels','contacten','project_contacten'] loop
    if to_regclass('public.' || t) is not null and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', '10'::jsonb), updated_at = now() where key = 'app';
select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' order by 1;
