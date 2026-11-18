-- =====================================================================
--  BROS Planbord — databasescript 070: datums van geregistreerde acties aanpassen (v1.78)
--  - Een beheerder kan de datum aanpassen van een zelf geregistreerde actie (bv. "klant gebeld") en van de ontvangst
--    van een punt dat BROS registreerde (mail, telefoon, bezoek, aannemer). Wat de klant zelf in het portaal meldde
--    en de stappen (aanvaard, ingepland, opgelost …) houden hun tijdstip: dat zette het Planbord zelf.
--  - De historiek blijft eerlijk: de oorspronkelijke datum, wie de datum aanpaste, wanneer en waarom worden bewaard
--    en staan in het Planbord bij de regel.
--  Vereist schema 69. Alleen toevoegingen; mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 69 then
    raise exception 'Voer eerst de scripts tot en met 069 uit.';
  end if;
end $$;

alter table public.naservice_gebeurtenissen
  add column if not exists op_oorspronkelijk timestamptz,              -- de eerste datum (enkel gezet als de datum ooit aangepast werd)
  add column if not exists op_gewijzigd_op   timestamptz,
  add column if not exists op_gewijzigd_door uuid references auth.users(id) on delete set null,
  add column if not exists op_gewijzigd_naam text not null default '',
  add column if not exists op_reden          text not null default '';

create or replace function public.naservice_datum(p_id uuid, p_op timestamptz, p_reden text default '')
returns public.naservice_gebeurtenissen language plpgsql security definer set search_path = public as $$
declare g public.naservice_gebeurtenissen; n public.naservice_punten; w record;
begin
  if not public.is_beheer() then raise exception 'Enkel een beheerder kan een datum aanpassen.'; end if;
  if p_op is null then raise exception 'Kies een datum.'; end if;
  if p_op > now() + interval '1 hour' then raise exception 'De datum kan niet in de toekomst liggen.'; end if;
  select * into g from public.naservice_gebeurtenissen where id = p_id for update;
  if g.id is null then raise exception 'Regel niet gevonden.'; end if;
  if g.punt_id is not null then select * into n from public.naservice_punten where id = g.punt_id for update; end if;
  if not (g.soort = 'registratie' or (g.soort = 'ontvangen' and n.id is not null and n.bron <> 'klant')) then
    raise exception 'Enkel de datum van een geregistreerde actie of van een door BROS geregistreerde melding kan aangepast worden.';
  end if;
  if g.op = p_op then return g; end if;
  select * into w from public.ns_wie();
  update public.naservice_gebeurtenissen
     set op_oorspronkelijk = coalesce(op_oorspronkelijk, op), op = p_op, op_gewijzigd_op = now(), op_gewijzigd_door = auth.uid(),
         op_gewijzigd_naam = w.naam, op_reden = left(trim(coalesce(p_reden, '')), 500)
   where id = p_id returning * into g;
  if g.soort = 'ontvangen' then   -- de ontvangst van het punt zelf mee aanpassen
    perform set_config('naservice.actie', '1', true);
    update public.naservice_punten set ontvangen_op = p_op where id = n.id;
    perform set_config('naservice.actie', '', true);
  end if;
  return g;
end $$;
revoke all on function public.naservice_datum(uuid, timestamptz, text) from public, anon;
grant execute on function public.naservice_datum(uuid, timestamptz, text) to authenticated;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(70, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: geeft 5 | 1 | 70 terug (nieuwe kolommen, functie, schemaversie)
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'naservice_gebeurtenissen'
          and column_name in ('op_oorspronkelijk', 'op_gewijzigd_op', 'op_gewijzigd_door', 'op_gewijzigd_naam', 'op_reden'))::int as kolommen,
       (select count(*) from pg_proc where proname = 'naservice_datum')::int as functie,
       (select (value->>'versie_schema')::int from public.instellingen where key = 'app') as schema;
