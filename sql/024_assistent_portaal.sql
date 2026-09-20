-- =====================================================================
--  BROS Planbord — databasescript 024: instellingen 'assistent' leesbaar voor de klant
--  Sinds script 011 leest een klant enkel de instelling 'portaal'. Het portaal toont het tabblad "Vragen"
--  pas als het ook de instelling 'assistent' (aan/uit, begroeting, functienaam) kan lezen — daarom ontbrak het tabblad.
--  Vereist schema 23. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 23 then
    raise exception 'Voer eerst de scripts tot en met 023 uit.';
  end if;
end $$;

drop policy if exists instellingen_select on public.instellingen;
create policy instellingen_select on public.instellingen for select to authenticated
  using (public.is_intern() or key in ('portaal', 'assistent'));

update public.instellingen set value = jsonb_set(value, '{versie_schema}', '24'::jsonb), updated_at = now() where key = 'app';

-- Controle: moet 24 teruggeven
select value->>'versie_schema' as versie_schema from public.instellingen where key = 'app';
