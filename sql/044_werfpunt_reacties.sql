-- =====================================================================
--  BROS Planbord — databasescript 044: reacties op werfpunten (aannemer ⇄ BROS)
--  - Een aannemer kan bij een toegewezen werfpunt een opmerking bewaren zonder het als opgelost te melden
--    (feedback: "nog niet klaar, omdat …"). Opmerkingen worden niet meer overschreven maar toegevoegd,
--    met datum en naam: vaststellingen.opmerking wordt een doorlopend gesprek.
--  - werfpunt_reactie: BROS antwoordt in hetzelfde gesprek (Planbord › Werf › punt › Reactie aan de aannemer).
--  - Mails (Drive-script): werfpuntfeedback (aannemer → projectverantwoordelijke), werfpuntreactie (BROS → aannemer).
--  Vereist schema 43. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 43 then
    raise exception 'Voer eerst de scripts tot en met 043 uit.';
  end if;
end $$;

-- een regel toevoegen aan het gesprek van een werfpunt ("14/10 09:16 · PCKI: tekst")
create or replace function public.werfpunt_regel(p_oud text, p_wie text, p_tekst text)
returns text language sql stable set search_path = public as $$
  select right(case when coalesce(trim(p_oud), '') = '' then '' else p_oud || E'\n' end
               || to_char(now() at time zone 'Europe/Brussels', 'DD/MM HH24:MI') || ' · ' || coalesce(nullif(trim(p_wie), ''), '?') || ': '
               || left(regexp_replace(trim(p_tekst), '\s*\n\s*', ' ', 'g'), 2000), 12000)   -- één bericht = één regel
$$;

-- aannemer: opgelost melden, bewijsfoto's en/of een opmerking (zelfde functie als script 035, de opmerking wordt toegevoegd i.p.v. overschreven)
create or replace function public.aannemer_vaststelling_melden(p_id uuid, p_status text default null, p_opmerking text default null, p_fotos jsonb default '[]'::jsonb)
returns public.vaststellingen language plpgsql security definer set search_path = public as $$
declare v public.vaststellingen; nieuw jsonb := '[]'::jsonb; f jsonb; v_naam text; v_opm text;
begin
  if not public.is_aannemer() then raise exception 'Geen toegang.'; end if;
  select * into v from public.vaststellingen where id = p_id for update;
  if v.id is null or v.contact_id is null or v.contact_id not in (select public.mijn_contacten()) or v.te_beoordelen then raise exception 'Dit punt is niet aan jou toegewezen.'; end if;
  if not public.fotos_geldig(p_fotos, v.project_id || '/' || v.id || '/') then raise exception 'Ongeldige foto.'; end if;
  for f in select * from jsonb_array_elements(coalesce(p_fotos, '[]'::jsonb)) loop
    if not exists (select 1 from jsonb_array_elements(v.opgelost_fotos) b where b->>'path' = f->>'path') then
      nieuw := nieuw || jsonb_build_array(jsonb_build_object('path', f->>'path', 'url', f->>'url', 'w', f->'w', 'h', f->'h', 'op', now(), 'door', 'aannemer'));
    end if;
  end loop;
  select naam into v_naam from public.contacten where id = v.contact_id;
  -- dezelfde opmerking nog eens (herhaalde verzending vanuit de wachtrij): niet dubbel toevoegen
  v_opm := case when coalesce(trim(p_opmerking), '') = ''
                  or coalesce(v.opmerking, '') like '%: ' || replace(replace(regexp_replace(trim(p_opmerking), '\s*\n\s*', ' ', 'g'), '%', '\%'), '_', '\_')
                then v.opmerking else public.werfpunt_regel(v.opmerking, v_naam, p_opmerking) end;
  if p_status = 'opgelost' then
    if v.status <> 'open' then raise exception 'Dit punt staat niet meer open.'; end if;
    update public.vaststellingen set status = 'opgelost', opgelost_op = now(), opgelost_door = auth.uid(),
      opmerking = v_opm, opgelost_fotos = opgelost_fotos || nieuw, updated_at = now() where id = p_id returning * into v;
  elsif p_status is not null then
    raise exception 'Een aannemer kan een punt enkel als opgelost melden.';
  else
    if coalesce(trim(p_opmerking), '') = '' and jsonb_array_length(nieuw) = 0 and jsonb_array_length(coalesce(p_fotos, '[]'::jsonb)) = 0 then raise exception 'Schrijf een opmerking of voeg een foto toe.'; end if;
    update public.vaststellingen set opmerking = v_opm, opgelost_fotos = opgelost_fotos || nieuw, updated_at = now() where id = p_id returning * into v;
  end if;
  return v;
end $$;
revoke all on function public.aannemer_vaststelling_melden(uuid, text, text, jsonb) from public, anon;
grant execute on function public.aannemer_vaststelling_melden(uuid, text, text, jsonb) to authenticated;

-- BROS: reactie in het gesprek van een werfpunt (enkel het team)
create or replace function public.werfpunt_reactie(p_id uuid, p_tekst text)
returns public.vaststellingen language plpgsql security definer set search_path = public as $$
declare v public.vaststellingen; v_naam text;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  if length(trim(coalesce(p_tekst, ''))) < 2 then raise exception 'Schrijf een reactie.'; end if;
  select name into v_naam from public.profiles where id = auth.uid();
  update public.vaststellingen set opmerking = public.werfpunt_regel(opmerking, 'BROS (' || coalesce(v_naam, 'team') || ')', p_tekst), updated_at = now()
   where id = p_id returning * into v;
  if v.id is null then raise exception 'Werfpunt niet gevonden.'; end if;
  return v;
end $$;

-- de aannemer ziet het gesprek enkel bij punten die aan hem toegewezen zijn (niet bij een punt dat hij meldde en dat aan iemand anders ging)
-- (zelfde kolommen als script 043)
create or replace view public.aan_vaststellingen as
  select v.id, v.project_id, v.bezoek_id, v.nr, v.titel, v.omschrijving, v.ruimte, v.lot, v.contact_id, v.prioriteit, v.deadline, v.status,
         v.fotos, v.opgelost_op, v.opgelost_fotos,
         case when v.contact_id in (select public.mijn_contacten()) then v.opmerking else '' end as opmerking,
         v.plan_id, v.plan_x, v.plan_y, v.created_at, v.updated_at,
         (select datum from public.werfbezoeken b where b.id = v.bezoek_id) as bezoek_datum,
         v.te_beoordelen, (v.gemeld_door_aannemer is not null and v.gemeld_door_aannemer in (select public.mijn_contacten())) as door_mij,
         case when v.gemeld_door_aannemer in (select public.mijn_contacten()) then v.bros_antwoord else '' end as bros_antwoord,
         case when v.gemeld_door_aannemer in (select public.mijn_contacten()) then v.beantwoord_op end as beantwoord_op,
         case when v.gemeld_door_aannemer in (select public.mijn_contacten()) then coalesce((select name from public.profiles p where p.id = v.beantwoord_door), '') else '' end as beantwoord_naam,
         (v.contact_id in (select public.mijn_contacten()) and not v.te_beoordelen) as aan_mij
  from public.vaststellingen v
  where v.project_id in (select public.aannemer_projecten())
    and ((v.contact_id in (select public.mijn_contacten()) and not v.te_beoordelen)
         or v.gemeld_door_aannemer in (select public.mijn_contacten()));

-- ---------- rechten ----------
select public.rechten_herstellen();
revoke insert, update, delete, truncate, references, trigger on public.portaal_pings from authenticated, anon;
revoke insert, update, delete, truncate, references, trigger on public.portaal_voorbeeld from authenticated, anon;
revoke update, truncate, references, trigger on public.goedkeuring_tekenaars from authenticated, anon;
revoke all on public.goedkeuring_codes from authenticated, anon;
revoke all on function public.portaal_ping() from public, anon, authenticated;
revoke all on function public.keuze_optie_ping() from public, anon, authenticated;
revoke all on function public.werf_foto_ping() from public, anon, authenticated;
revoke all on function public.werf_fotos_gedeeld() from public, anon, authenticated;
revoke all on function public.prijsvraag_doorzetten() from public, anon, authenticated;
revoke all on function public.prijsaanvraag_zonder_pv() from public, anon, authenticated;
revoke all on function public.profiles_testmodus_guard() from public, anon, authenticated;
revoke all on function public.overeenkomst_vast() from public, anon, authenticated;
revoke all on function public.tekenaar_ping() from public, anon, authenticated;
revoke all on function public.tekenaar_vast() from public, anon, authenticated;
revoke all on function public.antwoord_ping() from public, anon, authenticated;
revoke all on function public.werfpunt_antwoord() from public, anon, authenticated;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(44, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: moet 2 teruggeven
select count(*)::int as functies from pg_proc where proname in ('werfpunt_reactie', 'werfpunt_regel');
