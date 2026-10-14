-- =====================================================================
--  BROS Planbord — databasescript 043: aannemers melden werfpunten (werfmodus) — eerst voorgelegd aan BROS
--  - aannemer_werfpunt_melden: een aannemer meldt in de werfmodus een nieuw punt met foto's (ruimte, plan-pin).
--    Het wordt een vaststelling met te_beoordelen = true en gemeld_door_aannemer = zijn contact (zoals de klant in script 035).
--  - BROS beoordeelt in het Planbord (Werf): goedkeuren (+ verantwoordelijke kiezen, standaard de aannemer zelf),
--    antwoorden (vaststellingen.bros_antwoord, zichtbaar voor wie het meldde en per mail) of niet weerhouden (status vervallen).
--  - De aannemer ziet zijn eigen meldingen (ook nog te beoordelen) en het antwoord in de werfmodus en in zijn portaal;
--    de klant ziet het antwoord bij zijn eigen gemelde punten.
--  Vereist schema 42. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 42 then
    raise exception 'Voer eerst de scripts tot en met 042 uit.';
  end if;
end $$;

alter table public.vaststellingen
  add column if not exists gemeld_door_aannemer uuid references public.contacten(id) on delete set null,
  add column if not exists bros_antwoord        text not null default '',
  add column if not exists beantwoord_op        timestamptz,
  add column if not exists beantwoord_door      uuid references public.profiles(id) on delete set null;

-- melden (ook offline: het id komt van het toestel, een tweede poging met hetzelfde id vult enkel de foto's aan)
create or replace function public.aannemer_werfpunt_melden(p_id uuid, p_project uuid, p_titel text, p_omschrijving text default '', p_ruimte text default '',
                                                            p_plan_id uuid default null, p_plan_x numeric default null, p_plan_y numeric default null, p_fotos jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v public.vaststellingen; v_contact uuid; nieuw jsonb := '[]'::jsonb; f jsonb;
begin
  if not public.is_aannemer() or p_project not in (select public.aannemer_projecten()) then raise exception 'Geen toegang tot dit project.'; end if;
  if not public.fotos_geldig(p_fotos, p_project || '/aannemer/') or jsonb_array_length(coalesce(p_fotos, '[]'::jsonb)) > 12 then raise exception 'Ongeldige foto''s.'; end if;
  select pc.contact_id into v_contact from public.project_contacten pc join public.contacten c on c.id = pc.contact_id
   where pc.project_id = p_project and c.id in (select public.mijn_contacten()) order by (pc.rol = 'aannemer') desc limit 1;
  if v_contact is null then raise exception 'Je bent niet aan dit project gekoppeld.'; end if;
  select * into v from public.vaststellingen where id = p_id for update;
  if v.id is not null then   -- herhaalde verzending vanuit de wachtrij (enkel zolang het nog voorgelegd is, max. 12 foto's)
    if v.gemeld_door_aannemer is distinct from v_contact or v.project_id <> p_project then raise exception 'Dit punt bestaat al.'; end if;
    if not v.te_beoordelen then return p_id; end if;
    for f in select * from jsonb_array_elements(coalesce(p_fotos, '[]'::jsonb)) loop
      if not exists (select 1 from jsonb_array_elements(v.fotos) b where b->>'path' = f->>'path') then nieuw := nieuw || jsonb_build_array(f); end if;
    end loop;
    if jsonb_array_length(nieuw) > 0 then
      if jsonb_array_length(coalesce(v.fotos, '[]'::jsonb)) + jsonb_array_length(nieuw) > 12 then raise exception 'Maximaal 12 foto''s per punt.'; end if;
      update public.vaststellingen set fotos = fotos || nieuw where id = p_id;
    end if;
    return p_id;
  end if;
  if length(trim(coalesce(p_titel, ''))) < 3 then raise exception 'Geef het punt een korte titel.'; end if;
  if (select count(*) from public.vaststellingen where gemeld_door_aannemer = v_contact and created_at > now() - interval '1 day') >= 40 then
    raise exception 'Je meldde vandaag al veel punten — neem gerust contact op met BROS.';
  end if;
  if p_plan_id is not null and not exists (select 1 from public.werfplannen where id = p_plan_id and project_id = p_project) then p_plan_id := null; end if;
  insert into public.vaststellingen (id, project_id, titel, omschrijving, ruimte, status, prioriteit, klant_zichtbaar, te_beoordelen, gemeld_door_aannemer, fotos,
                                     plan_id, plan_x, plan_y, created_by)
  values (p_id, p_project, left(trim(p_titel), 160), left(trim(coalesce(p_omschrijving, '')), 4000), left(trim(coalesce(p_ruimte, '')), 120), 'open', 'normaal', false, true, v_contact,
          coalesce(p_fotos, '[]'::jsonb), p_plan_id, case when p_plan_id is null or p_plan_x is null or p_plan_y is null then null else greatest(0, least(1, p_plan_x)) end,
          case when p_plan_id is null or p_plan_x is null or p_plan_y is null then null else greatest(0, least(1, p_plan_y)) end, auth.uid());
  return p_id;
end $$;
revoke all on function public.aannemer_werfpunt_melden(uuid, uuid, text, text, text, uuid, numeric, numeric, jsonb) from public, anon;
grant execute on function public.aannemer_werfpunt_melden(uuid, uuid, text, text, text, uuid, numeric, numeric, jsonb) to authenticated;

-- het antwoord van BROS bewaren (wie en wanneer); enkel het team
create or replace function public.werfpunt_antwoord()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.bros_antwoord is distinct from old.bros_antwoord then
    new.beantwoord_op := case when coalesce(trim(new.bros_antwoord), '') = '' then null else now() end;
    new.beantwoord_door := case when coalesce(trim(new.bros_antwoord), '') = '' then null else auth.uid() end;
  end if;
  return new;
end $$;
drop trigger if exists vaststellingen_antwoord on public.vaststellingen;
create trigger vaststellingen_antwoord before update of bros_antwoord on public.vaststellingen for each row execute function public.werfpunt_antwoord();

-- wat de aannemer ziet: punten die aan hem toegewezen zijn (na goedkeuring) én de punten die hij zelf meldde (ook nog te beoordelen)
-- (zelfde kolommen als script 035, nieuwe achteraan)
create or replace view public.aan_vaststellingen as
  select v.id, v.project_id, v.bezoek_id, v.nr, v.titel, v.omschrijving, v.ruimte, v.lot, v.contact_id, v.prioriteit, v.deadline, v.status,
         v.fotos, v.opgelost_op, v.opgelost_fotos, v.opmerking, v.plan_id, v.plan_x, v.plan_y, v.created_at, v.updated_at,
         (select datum from public.werfbezoeken b where b.id = v.bezoek_id) as bezoek_datum,
         v.te_beoordelen, (v.gemeld_door_aannemer is not null and v.gemeld_door_aannemer in (select public.mijn_contacten())) as door_mij,
         -- het antwoord enkel voor wie het meldde (niet het antwoord aan een klant of andere aannemer bij een punt dat later aan hem toegewezen werd)
         case when v.gemeld_door_aannemer in (select public.mijn_contacten()) then v.bros_antwoord else '' end as bros_antwoord,
         case when v.gemeld_door_aannemer in (select public.mijn_contacten()) then v.beantwoord_op end as beantwoord_op,
         case when v.gemeld_door_aannemer in (select public.mijn_contacten()) then coalesce((select name from public.profiles p where p.id = v.beantwoord_door), '') else '' end as beantwoord_naam,
         (v.contact_id in (select public.mijn_contacten()) and not v.te_beoordelen) as aan_mij   -- aan hem toegewezen: enkel dan kan hij het als opgelost melden
  from public.vaststellingen v
  where v.project_id in (select public.aannemer_projecten())
    and ((v.contact_id in (select public.mijn_contacten()) and not v.te_beoordelen)
         or v.gemeld_door_aannemer in (select public.mijn_contacten()));
-- wat de klant ziet bij zijn eigen gemelde punten: ook het antwoord
create or replace view public.klant_vaststellingen as
  select v.id, v.project_id, v.nr, v.titel, v.omschrijving, v.ruimte, v.status, v.fotos, v.opgelost_op, v.opgelost_fotos, v.deadline,
         v.te_beoordelen, true as door_klant, v.created_at, v.updated_at, v.bros_antwoord, v.beantwoord_op
  from public.vaststellingen v
  where v.gemeld_door_klant in (select public.mijn_contacten()) and v.project_id in (select public.klant_projecten());

-- foto's van de aannemer bij een nieuw punt: enkel jpg in <eigen project>/aannemer/
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute 'drop policy if exists werf_insert on storage.objects';
    execute $p$create policy werf_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'werf' and (
        public.is_intern()
        or (public.is_aannemer()
            and split_part(name, '/', 1) in (select public.aannemer_projecten()::text)
            and split_part(name, '/', 2) in (select v.id::text from public.vaststellingen v where v.contact_id in (select public.mijn_contacten()) and not v.te_beoordelen)
            and split_part(name, '/', 4) = '' and lower(name) like '%.jpg')
        or (public.is_aannemer()
            and split_part(name, '/', 1) in (select public.aannemer_projecten()::text)
            and split_part(name, '/', 2) = 'aannemer'
            and split_part(name, '/', 4) = '' and lower(name) like '%.jpg')
        or (public.is_klant()
            and split_part(name, '/', 1) in (select public.klant_projecten()::text)
            and split_part(name, '/', 2) = 'klant'
            and split_part(name, '/', 4) = '' and lower(name) like '%.jpg')))$p$;
  end if;
end $$;

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

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(43, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: moet 1 | 1 | 1 teruggeven
select (select count(*) from pg_proc where proname = 'aannemer_werfpunt_melden')::int as functie,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'aan_vaststellingen' and column_name = 'door_mij')::int as aannemer_view,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'klant_vaststellingen' and column_name = 'bros_antwoord')::int as klant_view;
