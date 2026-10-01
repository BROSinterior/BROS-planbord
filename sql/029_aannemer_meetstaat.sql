-- =====================================================================
--  BROS Planbord — databasescript 029: meetstaat in het aannemersportaal
--  - view aan_meetstaat: de posten van de loten waaraan de aannemer in een project gekoppeld is
--    (Dossier › Contacten › loten), zonder vervallen posten en ZONDER prijzen (geen kostprijs, marge of klantprijs)
--  - het aannemersportaal toont ze onder 'Meetstaat' en maakt er een pdf van om door te sturen naar onderaannemers
--  Vereist schema 28. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 28 then
    raise exception 'Voer eerst de scripts tot en met 028 uit.';
  end if;
end $$;

drop view if exists public.aan_meetstaat;
create view public.aan_meetstaat as
  select m.id, m.project_id, m.lot, m.code, m.groep, m.omschrijving, m.locatie, m.eenheid, m.prijstype, m.hoeveelheid, m.volgorde, m.status
  from public.meetstaat_posten m
  where m.project_id in (select public.aannemer_projecten())
    and m.status <> 'vervallen'
    and m.lot = any (coalesce((select array_agg(distinct l) from public.project_contacten pc, unnest(pc.loten) l
                                where pc.project_id = m.project_id and pc.contact_id in (select public.mijn_contacten())), '{}'::int[]));

revoke all on public.aan_meetstaat from anon;
grant select on public.aan_meetstaat to authenticated;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', '29'::jsonb), updated_at = now() where key = 'app';

-- Controle: moet 1 teruggeven
select count(*) from information_schema.views where table_schema = 'public' and table_name = 'aan_meetstaat';
