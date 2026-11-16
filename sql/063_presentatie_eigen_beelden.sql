-- =====================================================================
--  BROS Planbord — databasescript 063: eigen beelden in de A3-presentatie (v1.68)
--  Bij Renders van een project kan het team zelf beelden toevoegen (renders uit een ander programma, foto's, referenties):
--  render_beelden soort 'eigen', in de opslag 'renders' onder <project>/eigen/<bestand>. Ze gaan nooit naar een
--  beeldgeneratie (geen kosten) en kunnen in de A3-presentatie, tussen de renders, in de gekozen volgorde.
--  De verwerkingscomputer (Mac mini) verandert niet: hij haalt elk gekozen beeld op zoals een render.
--  Vereist schema 62. Alleen toevoegingen; mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 62 then
    raise exception 'Voer eerst de scripts tot en met 062 uit.';
  end if;
end $$;

-- ---------- 1. nieuwe soort ----------
alter table public.render_beelden drop constraint if exists render_beelden_soort_check;
alter table public.render_beelden add constraint render_beelden_soort_check check (soort in ('ontwerp', 'sfeer', 'render', 'stalenbord', 'achtergrond', 'eigen'));

-- ---------- 2. opslag: het team mag ook onder <project>/eigen/ opladen (en een niet-geregistreerd bestand weer weghalen) ----------
create or replace function public.rd_bestand_weg_ok(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_intern() and split_part(p_name, '/', 2) in ('ontwerp', 'sfeer', 'achtergrond', 'eigen') and not exists (select 1 from public.render_beelden b where b.pad = p_name)
$$;
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    execute 'drop policy if exists renders_insert on storage.objects';
    execute $p$create policy renders_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'renders' and split_part(name, '/', 4) = '' and (
        (split_part(name, '/', 2) in ('ontwerp', 'sfeer', 'achtergrond', 'eigen') and public.rd_project_ok(public.rd_pad_project(name)))
        or (split_part(name, '/', 2) in ('render', 'stalenbord', 'presentatie') and public.rd_job_pad_ok(name))))$p$;
  end if;
end $$;

-- ---------- 3. een eigen beeld registreren (na het opladen naar renders/<project>/eigen/…) ----------
create or replace function public.render_eigen_bewaar(p_project uuid, p_pad text, p_naam text, p_mime text, p_grootte bigint, p_sha256 text,
                                                      p_breedte int, p_hoogte int, p_ruimte text)
returns public.render_beelden language plpgsql security definer set search_path = public as $$
declare b public.render_beelden; v_ruimte text := left(trim(coalesce(p_ruimte, '')), 120);
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  if not exists (select 1 from public.projecten where id = p_project) then raise exception 'Project niet gevonden.'; end if;
  if coalesce(p_pad, '') not like p_project::text || '/eigen/%' or split_part(p_pad, '/', 4) <> '' then raise exception 'Ongeldig pad voor het beeld.'; end if;
  if p_mime not in ('image/png', 'image/jpeg', 'image/webp') then raise exception 'Enkel PNG, JPEG of WebP.'; end if;
  if coalesce(p_sha256, '') !~ '^[0-9a-f]{64}$' then raise exception 'Beeld zonder controlegetal.'; end if;
  if v_ruimte = '*' then v_ruimte := ''; end if;
  if not public.rd_object_ok(p_pad, p_grootte) then raise exception 'Het beeld staat (nog) niet volledig in de opslag. Probeer opnieuw.'; end if;
  select * into b from public.render_beelden where pad = p_pad;
  if b.id is not null then return b; end if;   -- dezelfde upload opnieuw bevestigd
  insert into public.render_beelden (project_id, soort, ruimte, naam, pad, mime, grootte, breedte, hoogte, sha256)
  values (p_project, 'eigen', v_ruimte, left(coalesce(nullif(trim(p_naam), ''), 'beeld'), 200), p_pad, p_mime, p_grootte, p_breedte, p_hoogte, p_sha256)
  returning * into b;
  return b;
end $$;

-- naam en ruimte van een eigen beeld aanpassen (de ruimte bepaalt bij welk stalenbord het in de presentatie komt)
create or replace function public.render_eigen_bewerk(p_beeld uuid, p_naam text, p_ruimte text)
returns public.render_beelden language plpgsql security definer set search_path = public as $$
declare b public.render_beelden; v_ruimte text := left(trim(coalesce(p_ruimte, '')), 120);
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  if v_ruimte = '*' then v_ruimte := ''; end if;
  update public.render_beelden set naam = left(coalesce(nullif(trim(p_naam), ''), naam), 200), ruimte = v_ruimte
   where id = p_beeld and soort = 'eigen' returning * into b;
  if b.id is null then raise exception 'Beeld niet gevonden.'; end if;
  return b;
end $$;

-- ---------- 4. presentatie: ook eigen beelden (zelfde definitie als script 056, enkel de soorten erbij) ----------
create or replace function public.render_presentatie_maak(p_project uuid, p_klant text, p_versie text, p_datum date, p_liggend boolean, p_render_ids uuid[],
                                                          p_stalenborden boolean default false)
returns public.render_presentaties language plpgsql security definer set search_path = public as $$
declare r public.render_presentaties; sb uuid[] := '{}';
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  if length(trim(coalesce(p_klant, ''))) = 0 or length(p_klant) > 100 then raise exception 'Vul de klantnaam in (max. 100 tekens).'; end if;
  if length(trim(coalesce(p_versie, ''))) = 0 or length(p_versie) > 40 then raise exception 'Vul de ontwerpversie in (max. 40 tekens).'; end if;
  if p_datum is null then raise exception 'Kies een datum.'; end if;
  if coalesce(cardinality(p_render_ids), 0) = 0 or cardinality(p_render_ids) > 40 then raise exception 'Kies 1 tot 40 beelden.'; end if;
  if (select count(distinct x) from unnest(p_render_ids) x) <> cardinality(p_render_ids) then raise exception 'Elk beeld maar één keer.'; end if;
  if exists (select 1 from unnest(p_render_ids) x where not exists (select 1 from public.render_beelden b where b.id = x and b.project_id = p_project and b.soort in ('render', 'ontwerp', 'eigen'))) then
    raise exception 'Kies enkel renders, ontwerpen of eigen beelden van dit project.'; end if;
  if coalesce(p_stalenborden, false) then
    -- per ruimte van de gekozen beelden (volgorde van eerste voorkomen) de nu geselecteerde stalenbordversie — vastgelegd
    select coalesce(array_agg(s.id order by k.eerste), '{}') into sb
    from (select lower(trim(b.ruimte)) as sleutel, min(array_position(p_render_ids, b.id)) as eerste
          from public.render_beelden b where b.id = any(p_render_ids) and trim(b.ruimte) <> '' group by 1) k
    join public.render_beelden s on s.project_id = p_project and s.soort = 'stalenbord' and s.geselecteerd and lower(trim(s.ruimte)) = k.sleutel;
  end if;
  insert into public.render_presentaties (project_id, klant, versie, datum, liggend, render_ids, stalenborden, stalenbord_ids)
  values (p_project, trim(p_klant), trim(p_versie), p_datum, coalesce(p_liggend, false), p_render_ids, coalesce(p_stalenborden, false), sb) returning * into r;
  return r;
end $$;

-- ---------- rechten (bewust geen rechten_herstellen(), zie script 060) ----------
do $$ declare f text; begin
  foreach f in array array['render_eigen_bewaar(uuid, text, text, text, bigint, text, integer, integer, text)', 'render_eigen_bewerk(uuid, text, text)',
                           'render_presentatie_maak(uuid, text, text, date, boolean, uuid[], boolean)', 'rd_bestand_weg_ok(text)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';   -- de functies controleren zelf de rol
  end loop;
end $$;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(63, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: geeft 1 | 2 | 63 terug (soort 'eigen' toegelaten, de twee nieuwe functies, schemaversie)
select (select count(*) from pg_constraint where conname = 'render_beelden_soort_check' and pg_get_constraintdef(oid) like '%eigen%')::int as soort,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('render_eigen_bewaar', 'render_eigen_bewerk'))::int as functies,
       (select (value->>'versie_schema')::int from public.instellingen where key = 'app') as schema;
