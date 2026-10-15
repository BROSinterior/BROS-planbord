-- =====================================================================
--  BROS Planbord — databasescript 045: onderhoudsvrij en sneller (v1.48)
--  - pb_gebruik(): database- en opslaggebruik, voor de wekelijkse bewaking door het Drive-script (enkel met de service key).
--  - Snelheid: de toegangsregels (policies) en views roepen is_intern()/is_beheer()/… niet meer per rij aan maar één keer per
--    opvraging ("(select public.is_intern())") — zelfde regels, veel minder werk bij grote tabellen.
--  - Indexen voor de tellers (assistent, gemelde werfpunten, meerwerkaanvragen).
--  - Projectnummer volgens de Belgische datum (een project op 1 januari om 00:30 krijgt het nieuwe jaartal).
--  - Foto's van klanten/aannemers: enkel adressen van de eigen Supabase-opslag (*.supabase.co).
--  - Werfmodus: een herhaalde "opgelost"-melding (antwoord onderweg verloren) of een herhaalde reactie wordt niet dubbel/als fout behandeld.
--  Vereist schema 44. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 44 then
    raise exception 'Voer eerst de scripts tot en met 044 uit.';
  end if;
end $$;

-- ---------- gebruik (voor de bewaking; nooit voor gebruikers van de app) ----------
create or replace function public.pb_gebruik()
returns jsonb language sql stable security definer set search_path = public, storage as $$
  select jsonb_build_object(
    'db', pg_database_size(current_database()),
    'storage', (select coalesce(sum(coalesce((metadata->>'size')::bigint, 0)), 0) from storage.objects),
    'bestanden', (select count(*) from storage.objects))
$$;
revoke all on function public.pb_gebruik() from public, anon, authenticated;
grant execute on function public.pb_gebruik() to service_role;

-- ---------- projectnummer: Belgische datum ----------
create or replace function public.next_projectnummer()
returns text language plpgsql as $$
declare yy text; n int;
begin
  perform pg_advisory_xact_lock(424242);
  yy := to_char((now() at time zone 'Europe/Brussels')::date, 'YY');
  select coalesce(max(substring(nummer from 3)::int), 0) + 1 into n
    from public.projecten where nummer ~ '^[0-9]{6}$' and left(nummer, 2) = yy;
  return yy || lpad(n::text, 4, '0');
end $$;

-- ---------- foto's: enkel de eigen opslag ----------
create or replace function public.fotos_geldig(p_fotos jsonb, p_prefix text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(bool_and(
           coalesce(f->>'path', '') like p_prefix || '%' and (f->>'path') !~ '\.\.' and length(f->>'path') < 300
           and (f->>'url') ~ '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/werf/'
           and right(f->>'url', length(f->>'path')) = f->>'path'), true)
  from jsonb_array_elements(case when jsonb_typeof(p_fotos) = 'array' then p_fotos else '[]'::jsonb end) f
$$;

-- ---------- werfmodus: herhaalde meldingen ----------
-- (zelfde functie als script 044) — "opgelost" nog eens melden terwijl het al door hem als opgelost gemeld is: geen fout meer
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
  v_opm := case when coalesce(trim(p_opmerking), '') = ''
                  or coalesce(v.opmerking, '') like '%: ' || replace(replace(regexp_replace(trim(p_opmerking), '\s*\n\s*', ' ', 'g'), '%', '\%'), '_', '\_')
                then v.opmerking else public.werfpunt_regel(v.opmerking, v_naam, p_opmerking) end;
  if p_status = 'opgelost' and v.status = 'opgelost' and v.opgelost_door is not distinct from auth.uid() then
    p_status := null;   -- herhaling vanuit de wachtrij (het eerste antwoord ging onderweg verloren): enkel nog foto's/opmerking aanvullen
    if coalesce(trim(p_opmerking), '') = '' and jsonb_array_length(nieuw) = 0 then return v; end if;
  end if;
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

-- reactie van BROS: dezelfde tekst nog eens als laatste regel (herhaalde verzending) → niet dubbel
create or replace function public.werfpunt_reactie(p_id uuid, p_tekst text)
returns public.vaststellingen language plpgsql security definer set search_path = public as $$
declare v public.vaststellingen; v_naam text; v_tekst text;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  if length(trim(coalesce(p_tekst, ''))) < 2 then raise exception 'Schrijf een reactie.'; end if;
  v_tekst := left(regexp_replace(trim(p_tekst), '\s*\n\s*', ' ', 'g'), 2000);
  select * into v from public.vaststellingen where id = p_id for update;
  if v.id is null then raise exception 'Werfpunt niet gevonden.'; end if;
  if right(coalesce(v.opmerking, ''), length(v_tekst) + 2) = ': ' || v_tekst and v.updated_at > now() - interval '10 minutes' then return v; end if;
  select name into v_naam from public.profiles where id = auth.uid();
  update public.vaststellingen set opmerking = public.werfpunt_regel(opmerking, 'BROS (' || coalesce(v_naam, 'team') || ')', p_tekst), updated_at = now()
   where id = p_id returning * into v;
  return v;
end $$;

-- ---------- indexen voor tellers en limieten ----------
create index if not exists assistent_berichten_rol_idx on public.assistent_berichten(rol, created_at);
create index if not exists vaststellingen_gemeld_aannemer_idx on public.vaststellingen(gemeld_door_aannemer, created_at) where gemeld_door_aannemer is not null;
create index if not exists vaststellingen_gemeld_klant_idx on public.vaststellingen(gemeld_door_klant, created_at) where gemeld_door_klant is not null;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'meerwerk_aanvragen' and column_name = 'user_id') then
    execute 'create index if not exists meerwerk_aanvragen_user_idx on public.meerwerk_aanvragen(user_id, created_at)';
  end if;
end $$;

-- ---------- snelheid: rolcontrole één keer per opvraging i.p.v. per rij ----------
-- policies: is_intern()/is_beheer()/is_klant()/is_aannemer() → (select public.…()) — de regels zelf blijven identiek
do $$
declare r record; q text; c text; re text := '(?<!SELECT )(?<!\.)\m(is_intern|is_beheer|is_klant|is_aannemer)\(\)';
begin
  for r in select * from pg_policies where schemaname in ('public', 'storage') loop
    q := r.qual; c := r.with_check;
    if q is not null and q ~ re then q := regexp_replace(q, re, '(select public.\1())', 'g'); else q := null; end if;
    if c is not null and c ~ re then c := regexp_replace(c, re, '(select public.\1())', 'g'); else c := null; end if;
    if q is not null then execute format('alter policy %I on %I.%I using (%s)', r.policyname, r.schemaname, r.tablename, q); end if;
    if c is not null then execute format('alter policy %I on %I.%I with check (%s)', r.policyname, r.schemaname, r.tablename, c); end if;
  end loop;
end $$;
-- views: zelfde kolommen, zelfde opties (security_invoker e.d.), enkel de rolcontrole verpakt
do $$
declare r record; d text; o text; re text := '(?<!SELECT )(?<!\.)\m(is_intern|is_beheer)\(\)';
begin
  for r in select c.oid, c.relname, c.reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'v' loop
    d := pg_get_viewdef(r.oid);
    if d ~ re then
      o := case when r.reloptions is null then '' else ' with (' || array_to_string(r.reloptions, ', ') || ')' end;
      execute format('create or replace view public.%I%s as %s', r.relname, o, regexp_replace(rtrim(d, '; '), re, '(select public.\1())', 'g'));
    end if;
  end loop;
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
revoke all on function public.pb_gebruik() from public, anon, authenticated;
grant execute on function public.pb_gebruik() to service_role;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(45, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: moet 1 | 0 teruggeven (1 = functie pb_gebruik bestaat; 0 = geen policy meer met een rolcontrole per rij)
select (select count(*) from pg_proc where proname = 'pb_gebruik')::int as gebruik,
       (select count(*) from pg_policies where schemaname in ('public', 'storage')
          and (coalesce(qual, '') ~ '(?<!SELECT )(?<!\.)\m(is_intern|is_beheer|is_klant|is_aannemer)\(\)' or coalesce(with_check, '') ~ '(?<!SELECT )(?<!\.)\m(is_intern|is_beheer|is_klant|is_aannemer)\(\)'))::int as per_rij;
