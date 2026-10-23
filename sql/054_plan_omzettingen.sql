-- =====================================================================
--  BROS Planbord — databasescript 054: Plannen omzetten met Plan2CAD (v1.57)
--  Per project een plan (pdf, scan, foto) slepen in het tabblad Plannen. De verwerkingscomputer (Mac mini, dezelfde als
--  voor Vergaderingen & opnames) zet het om naar DXF (en DWG) op ware grootte en bewaart origineel + resultaat in de
--  projectmap op Drive, map Plannen/DXF. Een schaal waar Plan2CAD niet zeker van is, wordt nooit stil gebruikt: het
--  resultaat staat dan op 'Schaal controleren' tot iemand een schaal kiest of in de tekenmodule twee punten aanduidt.
--
--  - plan_omzettingen: de opdracht (bestand, opties), de wachtrij-gegevens (claim met lease, max. 3 pogingen, zoals
--    'verwerkingen' van script 051) en de resultaten per bron (pagina of geplakte afbeelding): schaal, zekerheid,
--    schaalvoorstellen, DXF/DWG in de opslag en op Drive.
--  - opslag 'plan2cad' (privé): <omzetting>/bron/<bestand> (het origineel, tot de kopie op Drive gecontroleerd is) en
--    <omzetting>/uit/<bestand>.dxf (om het resultaat als onderlegger in de tekenmodule te openen).
--  - Toegang: het team (beheer + medewerkers) ziet en start omzettingen; de verwerkingscomputer enkel wat hij nu
--    verwerkt, via de functies hieronder. Klanten en aannemers zien niets.
--  Vereist schema 51 (de verwerkingscomputer). Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 53 then
    raise exception 'Voer eerst de scripts tot en met 053 uit.';
  end if;
end $$;

-- ---------- 1. tabel ----------
create table if not exists public.plan_omzettingen (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projecten(id) on delete cascade,
  bestand           text not null,                                   -- naam van het origineel
  bron_pad          text,                                            -- in de opslag 'plan2cad' (leeg zodra de kopie op Drive gecontroleerd is)
  bron_grootte      bigint not null default 0,
  bron_sha256       text not null default '',
  opties            jsonb not null default '{}'::jsonb,              -- {paginas, papier, schaal, dwg} + bij herschalen {alleen, schaal, index}
  soort             text not null default 'omzetten' check (soort in ('omzetten', 'herschaal')),
  status            text not null default 'wachtrij' check (status in ('wachtrij', 'bezig', 'klaar', 'controle', 'mislukt', 'geannuleerd')),
  pogingen          int not null default 0,
  max_pogingen      int not null default 3,
  worker            text,
  worker_user       uuid,
  claim             uuid,
  lease_tot         timestamptz,
  stap              text not null default '',
  voortgang         numeric(5,4) not null default 0,
  fout              text not null default '',
  fout_detail       text not null default '',
  resultaten        jsonb not null default '[]'::jsonb,              -- per bron, zie verwerker/bros_verwerker.py (PlanOmzetting)
  drive_bron        jsonb,                                           -- {id, url, md5, size} van het origineel op Drive
  drive_map_url     text not null default '',
  aangevraagd_door  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  gestart_op        timestamptz,
  klaar_op          timestamptz,
  constraint plan_omzettingen_resultaten check (jsonb_typeof(resultaten) = 'array'),
  constraint plan_omzettingen_opties check (jsonb_typeof(opties) = 'object')
);
create index if not exists plan_omzettingen_project_idx on public.plan_omzettingen(project_id, created_at desc);
create index if not exists plan_omzettingen_wachtrij_idx on public.plan_omzettingen(status, created_at);

drop trigger if exists plan_omzettingen_touch on public.plan_omzettingen;
create trigger plan_omzettingen_touch before update on public.plan_omzettingen for each row execute function public.touch_updated_at();

-- ---------- 2. toegang ----------
alter table public.plan_omzettingen enable row level security;
drop policy if exists po_lezen on public.plan_omzettingen;
drop policy if exists po_weg on public.plan_omzettingen;
create policy po_lezen on public.plan_omzettingen for select to authenticated using (public.is_intern());
-- verwijderen: wie ze aanvroeg of beheer, niet terwijl ze verwerkt wordt
create policy po_weg on public.plan_omzettingen for delete to authenticated using (public.is_intern() and status <> 'bezig' and (public.is_beheer() or aangevraagd_door = auth.uid()));

-- heeft de ingelogde verwerkingscomputer een lopende opdracht voor deze omzetting?
create or replace function public.po_actieve_job(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_verwerker() and exists (select 1 from public.plan_omzettingen o where o.id = p_id and o.status = 'bezig' and o.worker_user = auth.uid() and o.lease_tot > now())
$$;
-- uit een opslagpad '<omzetting>/…' de omzetting halen (ongeldig pad → null, dus geen toegang)
create or replace function public.po_pad(p_name text)
returns uuid language sql immutable set search_path = public as $$
  select case when split_part(coalesce(p_name, ''), '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(p_name, '/', 1)::uuid end
$$;
-- (voor de opslagregels) mag het origineel uit de opslag: enkel als de kopie op Drive gecontroleerd is
create or replace function public.po_drive_ok(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select o.drive_bron ? 'md5' from public.plan_omzettingen o where o.id = p_id and public.po_actieve_job(p_id)), false)
$$;
-- bestaat de omzetting nog niet, of is ze van de ingelogde gebruiker en nog niet gestart? (het origineel opladen gebeurt vóór de rij bestaat)
create or replace function public.po_upload_ok(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_intern() and p_id is not null and not exists (select 1 from public.plan_omzettingen o where o.id = p_id and (o.aangevraagd_door is distinct from auth.uid() or o.status <> 'wachtrij'))
$$;

-- status uit de resultaten: 'controle' zolang er een resultaat is met een onzekere schaal
create or replace function public.po_status(p_resultaten jsonb)
returns text language sql immutable set search_path = public as $$
  select case when exists (select 1 from jsonb_array_elements(coalesce(p_resultaten, '[]'::jsonb)) e where coalesce((e->>'ok')::boolean, false) and not coalesce((e->>'zeker')::boolean, false)) then 'controle'
              when exists (select 1 from jsonb_array_elements(coalesce(p_resultaten, '[]'::jsonb)) e where coalesce((e->>'ok')::boolean, false)) then 'klaar' else 'mislukt' end
$$;

-- ---------- 3. functies voor het team ----------
-- een nieuwe omzetting (na het opladen van het origineel naar plan2cad/<id>/bron/…)
create or replace function public.plan_omzetting_maak(p_id uuid, p_project uuid, p_bestand text, p_pad text, p_grootte bigint, p_sha256 text, p_opties jsonb)
returns public.plan_omzettingen language plpgsql security definer set search_path = public as $$
declare o public.plan_omzettingen; schaal numeric;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  if not exists (select 1 from public.projecten where id = p_project) then raise exception 'Project niet gevonden.'; end if;
  if coalesce(p_pad, '') not like p_id::text || '/bron/%' or split_part(p_pad, '/', 4) <> '' then raise exception 'Ongeldig pad voor het origineel.'; end if;
  if coalesce(p_sha256, '') !~ '^[0-9a-f]{64}$' then raise exception 'Origineel zonder controlegetal.'; end if;
  schaal := nullif(p_opties->>'schaal', '')::numeric;
  if schaal is not null and (schaal <= 0 or schaal > 100000) then raise exception 'Ongeldige schaal.'; end if;
  insert into public.plan_omzettingen (id, project_id, bestand, bron_pad, bron_grootte, bron_sha256, opties)
  values (p_id, p_project, left(coalesce(nullif(trim(p_bestand), ''), 'plan'), 200), p_pad, greatest(coalesce(p_grootte, 0), 0), p_sha256,
          jsonb_build_object('paginas', left(coalesce(nullif(p_opties->>'paginas', ''), 'alle'), 40),
                             'papier', left(coalesce(p_opties->>'papier', ''), 20),
                             'schaal', schaal,
                             'dwg', coalesce((p_opties->>'dwg')::boolean, true)))
  returning * into o;
  return o;
end $$;

-- opnieuw omzetten (na 'mislukt', of met andere opties)
create or replace function public.plan_omzetting_opnieuw(p_id uuid, p_opties jsonb default null)
returns public.plan_omzettingen language plpgsql security definer set search_path = public as $$
declare o public.plan_omzettingen; schaal numeric;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  select * into o from public.plan_omzettingen where id = p_id for update;
  if o.id is null then raise exception 'Omzetting niet gevonden.'; end if;
  if o.status in ('wachtrij', 'bezig') then raise exception 'Deze omzetting loopt al.'; end if;
  if o.bron_pad is null and o.drive_bron is null then raise exception 'Het origineel is niet meer beschikbaar.'; end if;
  if p_opties is not null then
    schaal := nullif(p_opties->>'schaal', '')::numeric;
    if schaal is not null and (schaal <= 0 or schaal > 100000) then raise exception 'Ongeldige schaal.'; end if;
    o.opties := jsonb_build_object('paginas', left(coalesce(nullif(p_opties->>'paginas', ''), o.opties->>'paginas', 'alle'), 40),
                                   'papier', left(coalesce(p_opties->>'papier', o.opties->>'papier', ''), 20),
                                   'schaal', schaal, 'dwg', coalesce((p_opties->>'dwg')::boolean, (o.opties->>'dwg')::boolean, true));
  else
    o.opties := o.opties - 'alleen' - 'index';
  end if;
  update public.plan_omzettingen set opties = o.opties, soort = 'omzetten', status = 'wachtrij', pogingen = 0, fout = '', fout_detail = '', stap = '', voortgang = 0,
         worker = null, worker_user = null, claim = null, lease_tot = null, klaar_op = null where id = p_id returning * into o;
  return o;
end $$;

-- één resultaat opnieuw wegschrijven op een gekozen schaal (gekozen voorstel, ingegeven, of gekalibreerd in de tekenmodule)
create or replace function public.plan_omzetting_herschaal(p_id uuid, p_index int, p_noemer numeric, p_bron text default 'opgegeven')
returns public.plan_omzettingen language plpgsql security definer set search_path = public as $$
declare o public.plan_omzettingen; r jsonb;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  if p_noemer is null or p_noemer <= 0 or p_noemer > 100000 then raise exception 'Ongeldige schaal.'; end if;
  select * into o from public.plan_omzettingen where id = p_id for update;
  if o.id is null then raise exception 'Omzetting niet gevonden.'; end if;
  if o.status in ('wachtrij', 'bezig') then raise exception 'Deze omzetting loopt al.'; end if;
  if o.bron_pad is null and o.drive_bron is null then raise exception 'Het origineel is niet meer beschikbaar.'; end if;
  r := o.resultaten -> p_index;
  if r is null or not coalesce((r->>'ok')::boolean, false) then raise exception 'Dit resultaat bestaat niet.'; end if;
  update public.plan_omzettingen set soort = 'herschaal', status = 'wachtrij', pogingen = 0, fout = '', fout_detail = '', stap = '', voortgang = 0,
         worker = null, worker_user = null, claim = null, lease_tot = null, klaar_op = null,
         opties = opties || jsonb_build_object('index', p_index, 'alleen', (r->>'pagina') || ':' || coalesce(r->>'afbeelding', ''), 'herschaal', p_noemer,
                                               'herschaal_bron', case when p_bron in ('opgegeven', 'voorstel', 'kalibratie') then p_bron else 'opgegeven' end)
  where id = p_id returning * into o;
  return o;
end $$;

-- het resultaat is als onderlegger geopend in de tekenmodule (zodat het Planbord er de kalibratie van kan voorstellen)
create or replace function public.plan_omzetting_koppel(p_id uuid, p_index int, p_tekenplan uuid)
returns public.plan_omzettingen language plpgsql security definer set search_path = public as $$
declare o public.plan_omzettingen;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  select * into o from public.plan_omzettingen where id = p_id for update;
  if o.id is null or o.resultaten -> p_index is null then raise exception 'Resultaat niet gevonden.'; end if;
  if p_tekenplan is not null and not exists (select 1 from public.tekenplannen where id = p_tekenplan and project_id = o.project_id) then raise exception 'Plan niet gevonden in dit project.'; end if;
  update public.plan_omzettingen set resultaten = jsonb_set(resultaten, array[p_index::text], (resultaten -> p_index) || jsonb_build_object('tekenplan_id', p_tekenplan))
  where id = p_id returning * into o;
  return o;
end $$;

-- stoppen terwijl ze in de wachtrij staat of loopt (de verwerkingscomputer stopt bij de volgende hartslag)
create or replace function public.plan_omzetting_stop(p_id uuid)
returns public.plan_omzettingen language plpgsql security definer set search_path = public as $$
declare o public.plan_omzettingen;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  update public.plan_omzettingen set status = case when jsonb_array_length(resultaten) > 0 then public.po_status(resultaten) else 'geannuleerd' end,
         soort = 'omzetten', opties = opties - 'alleen' - 'index' - 'herschaal' - 'herschaal_bron', fout = 'Gestopt door ' || coalesce((select name from public.profiles where id = auth.uid()), 'een gebruiker') || '.', klaar_op = now(), lease_tot = null
  where id = p_id and status in ('wachtrij', 'bezig') returning * into o;
  if o.id is null then raise exception 'Deze omzetting loopt niet.'; end if;
  return o;
end $$;

-- ---------- 4. functies voor de verwerkingscomputer (rol verwerker) ----------
-- volgende omzetting; vastgelopen opdrachten (lease verlopen) worden eerst teruggezet of na 3 pogingen 'mislukt'
create or replace function public.plan_claim(p_naam text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.plan_omzettingen; p public.projecten; r record;
begin
  if not public.is_verwerker() then raise exception 'Geen verwerkingscomputer.'; end if;
  for r in select * from public.plan_omzettingen where status = 'bezig' and lease_tot < now() for update skip locked loop
    if r.pogingen >= r.max_pogingen then
      update public.plan_omzettingen set status = 'mislukt', klaar_op = now(), fout = 'De omzetting werd ' || r.pogingen || ' keer onderbroken (verwerkingscomputer gestopt of niet meer bereikbaar). Probeer opnieuw.' where id = r.id;
    else
      update public.plan_omzettingen set status = 'wachtrij', worker = null, worker_user = null, lease_tot = null, fout = 'Onderbroken — wordt hervat.' where id = r.id;
    end if;
  end loop;
  select * into o from public.plan_omzettingen where status = 'wachtrij' order by created_at limit 1 for update skip locked;
  if o.id is null then return null; end if;
  update public.plan_omzettingen set status = 'bezig', worker = left(p_naam, 60), worker_user = auth.uid(), claim = gen_random_uuid(), lease_tot = now() + interval '10 minutes',
         pogingen = pogingen + 1, gestart_op = coalesce(gestart_op, now()), stap = 'gestart', voortgang = 0, fout = '' where id = o.id returning * into o;
  update public.verwerker_status set huidige_job = o.id where naam = left(p_naam, 60);
  select * into p from public.projecten where id = o.project_id;
  return jsonb_build_object(
    'job', jsonb_build_object('id', o.id, 'claim', o.claim, 'soort', o.soort, 'poging', o.pogingen, 'max_pogingen', o.max_pogingen),
    'omzetting', jsonb_build_object('id', o.id, 'bestand', o.bestand, 'bron_pad', o.bron_pad, 'bron_grootte', o.bron_grootte, 'bron_sha256', o.bron_sha256,
                                    'opties', o.opties, 'resultaten', o.resultaten, 'drive_bron', o.drive_bron),
    'project', jsonb_build_object('id', p.id, 'nummer', p.nummer, 'klant', p.klant, 'naam', p.naam, 'drive', coalesce(p.drive_folder_id, '') <> ''));
end $$;

create or replace function public.po_eigen(p_job uuid, p_claim uuid)
returns public.plan_omzettingen language plpgsql stable security definer set search_path = public as $$
declare o public.plan_omzettingen;
begin
  if not public.is_verwerker() then raise exception 'Geen verwerkingscomputer.'; end if;
  select * into o from public.plan_omzettingen where id = p_job;
  if o.id is null or o.worker_user is distinct from auth.uid() or o.claim is distinct from p_claim then raise exception 'Deze omzetting is niet (meer) van deze verwerkingscomputer.'; end if;
  return o;
end $$;

-- voortgang + lease verlengen; 'actief: false' = gestopt door een gebruiker
create or replace function public.plan_voortgang(p_job uuid, p_claim uuid, p_stap text, p_voortgang numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.plan_omzettingen;
begin
  o := public.po_eigen(p_job, p_claim);
  if o.status <> 'bezig' then return jsonb_build_object('actief', false, 'status', o.status); end if;
  update public.plan_omzettingen set stap = left(coalesce(p_stap, ''), 200), voortgang = least(greatest(coalesce(p_voortgang, 0), 0), 1), lease_tot = now() + interval '10 minutes' where id = p_job;
  return jsonb_build_object('actief', true);
end $$;

-- tussentijds vastleggen: het origineel op Drive (gecontroleerd), het origineel uit de opslag gehaald
create or replace function public.plan_bestand(p_job uuid, p_claim uuid, p_gegevens jsonb)
returns public.plan_omzettingen language plpgsql security definer set search_path = public as $$
declare o public.plan_omzettingen;
begin
  o := public.po_eigen(p_job, p_claim);
  if o.status <> 'bezig' then raise exception 'Deze omzetting loopt niet meer.'; end if;
  if p_gegevens ? 'drive_bron' then
    if coalesce(p_gegevens->'drive_bron'->>'md5', '') !~ '^[0-9a-f]{32}$' or coalesce(p_gegevens->'drive_bron'->>'id', '') = '' then raise exception 'Kopie op Drive zonder controlegetal.'; end if;
    update public.plan_omzettingen set drive_bron = jsonb_build_object('id', left(p_gegevens->'drive_bron'->>'id', 200), 'url', left(coalesce(p_gegevens->'drive_bron'->>'url', ''), 500),
                                                                     'md5', p_gegevens->'drive_bron'->>'md5', 'size', (p_gegevens->'drive_bron'->>'size')::bigint),
           drive_map_url = left(coalesce(p_gegevens->>'drive_map_url', drive_map_url), 500) where id = p_job;
  end if;
  if coalesce((p_gegevens->>'bron_weg')::boolean, false) then
    if (select drive_bron from public.plan_omzettingen where id = p_job) is null then raise exception 'Het origineel blijft in de opslag tot de kopie op Drive gecontroleerd is.'; end if;
    update public.plan_omzettingen set bron_pad = null where id = p_job;
  end if;
  update public.plan_omzettingen set lease_tot = now() + interval '10 minutes' where id = p_job returning * into o;
  return o;
end $$;

-- resultaat; bij herschalen enkel dat ene resultaat vervangen (de rest blijft)
create or replace function public.plan_klaar(p_job uuid, p_claim uuid, p_resultaten jsonb)
returns public.plan_omzettingen language plpgsql security definer set search_path = public as $$
declare o public.plan_omzettingen; alles jsonb; idx int; oud jsonb; st text;
begin
  o := public.po_eigen(p_job, p_claim);
  if o.status <> 'bezig' then raise exception 'Deze omzetting loopt niet meer (status %).', o.status; end if;
  if p_resultaten is null or jsonb_typeof(p_resultaten) <> 'array' then raise exception 'Resultaat zonder lijst.'; end if;
  if o.soort = 'herschaal' then
    idx := (o.opties->>'index')::int; oud := o.resultaten -> idx;
    if oud is null or jsonb_array_length(p_resultaten) <> 1 then raise exception 'Herschalen gaf geen enkel resultaat terug.'; end if;
    alles := jsonb_set(o.resultaten, array[idx::text], (p_resultaten -> 0) || jsonb_build_object('tekenplan_id', oud->'tekenplan_id'));
  else
    alles := p_resultaten;
  end if;
  st := public.po_status(alles);
  update public.plan_omzettingen set resultaten = alles, status = st, soort = 'omzetten', klaar_op = now(), lease_tot = null, stap = '', voortgang = 1,
         opties = opties - 'alleen' - 'index' - 'herschaal' - 'herschaal_bron',
         fout = case when st = 'mislukt' then coalesce((select e->>'fout' from jsonb_array_elements(alles) e limit 1), 'Geen enkele pagina kon omgezet worden.') else '' end
  where id = p_job returning * into o;
  update public.verwerker_status set huidige_job = null where user_id = auth.uid() and huidige_job = p_job;
  return o;
end $$;

-- mislukt: opnieuw proberen (na een minuut, tot max_pogingen) of definitief
create or replace function public.plan_mislukt(p_job uuid, p_claim uuid, p_fout text, p_detail text, p_opnieuw boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.plan_omzettingen; definitief boolean;
begin
  o := public.po_eigen(p_job, p_claim);
  if o.status <> 'bezig' then return jsonb_build_object('ok', false, 'status', o.status); end if;
  definitief := not coalesce(p_opnieuw, false) or o.pogingen >= o.max_pogingen;
  update public.plan_omzettingen set status = case when not definitief then 'wachtrij'
                                                   when o.soort = 'herschaal' and jsonb_array_length(o.resultaten) > 0 then public.po_status(o.resultaten)   -- de vorige resultaten blijven geldig
                                                   else 'mislukt' end,
         soort = case when definitief then 'omzetten' else o.soort end,
         opties = case when definitief then opties - 'alleen' - 'index' - 'herschaal' - 'herschaal_bron' else opties end,
         fout = left(coalesce(p_fout, ''), 500), fout_detail = left(coalesce(p_detail, ''), 4000), worker = null, worker_user = null, lease_tot = null,
         klaar_op = case when definitief then now() else null end
  where id = p_job;
  update public.verwerker_status set huidige_job = null where user_id = auth.uid() and huidige_job = p_job;
  return jsonb_build_object('ok', true, 'definitief', definitief);
end $$;

-- ---------- 5. opslag 'plan2cad' (privé) ----------
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public) values ('plan2cad', 'plan2cad', false) on conflict (id) do update set public = false;
    if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
      update storage.buckets set file_size_limit = 52428800, allowed_mime_types = null where id = 'plan2cad';   -- 50 MB per bestand (het maximum van een gratis Supabase-project)
    end if;
    execute 'drop policy if exists plan2cad_insert on storage.objects';
    execute 'drop policy if exists plan2cad_read on storage.objects';
    execute 'drop policy if exists plan2cad_delete on storage.objects';
    execute $p$create policy plan2cad_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'plan2cad' and split_part(name, '/', 4) = '' and (
        (split_part(name, '/', 2) = 'bron' and public.po_upload_ok(public.po_pad(name)))
        or (split_part(name, '/', 2) = 'uit' and public.po_actieve_job(public.po_pad(name)))))$p$;
    execute $p$create policy plan2cad_read on storage.objects for select to authenticated using (
      bucket_id = 'plan2cad' and (public.is_intern() or public.po_actieve_job(public.po_pad(name))))$p$;
    execute $p$create policy plan2cad_delete on storage.objects for delete to authenticated using (
      bucket_id = 'plan2cad' and (
        (public.is_intern() and (public.is_beheer() or not exists (select 1 from public.plan_omzettingen o where o.id = public.po_pad(name) and o.aangevraagd_door is distinct from auth.uid())))
        or (public.po_actieve_job(public.po_pad(name)) and (split_part(name, '/', 2) = 'uit' or (split_part(name, '/', 2) = 'bron' and public.po_drive_ok(public.po_pad(name)))))))$p$;   -- het origineel pas weg als de kopie op Drive gecontroleerd is
  end if;
end $$;

-- ---------- 6. live ----------
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'plan_omzettingen') then
    alter publication supabase_realtime add table public.plan_omzettingen;
  end if;
end $$;

-- ---------- rechten ----------
-- (bewust geen rechten_herstellen(): die zet alle functies open, ook de interne van eerdere scripts)
revoke all on public.plan_omzettingen from anon;
revoke insert, update, truncate, references, trigger on public.plan_omzettingen from authenticated;   -- schrijven enkel via de functies
grant select, delete on public.plan_omzettingen to authenticated;
revoke all on function public.po_eigen(uuid, uuid) from public, anon, authenticated;
revoke all on function public.po_actieve_job(uuid) from public, anon;
revoke all on function public.po_pad(text) from public, anon;
revoke all on function public.po_drive_ok(uuid) from public, anon;
revoke all on function public.po_upload_ok(uuid) from public, anon;
revoke all on function public.po_status(jsonb) from public, anon;
grant execute on function public.po_actieve_job(uuid), public.po_pad(text), public.po_drive_ok(uuid), public.po_upload_ok(uuid) to authenticated;   -- nodig voor de opslagregels
do $$ declare f text; begin
  foreach f in array array['plan_omzetting_maak(uuid, uuid, text, text, bigint, text, jsonb)', 'plan_omzetting_opnieuw(uuid, jsonb)', 'plan_omzetting_herschaal(uuid, integer, numeric, text)',
                           'plan_omzetting_koppel(uuid, integer, uuid)', 'plan_omzetting_stop(uuid)', 'plan_claim(text)', 'plan_voortgang(uuid, uuid, text, numeric)',
                           'plan_bestand(uuid, uuid, jsonb)', 'plan_klaar(uuid, uuid, jsonb)', 'plan_mislukt(uuid, uuid, text, text, boolean)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';   -- de functies controleren zelf de rol
  end loop;
end $$;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(54, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: moet 1 | 1 | 1 | 54 teruggeven (tabel, met RLS, opslag aanwezig, schemaversie).
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'plan_omzettingen')::int as tabel,
       (select count(*) from pg_tables where schemaname = 'public' and tablename = 'plan_omzettingen' and rowsecurity)::int as rls,
       (select count(*) from storage.buckets where id = 'plan2cad')::int as opslag,
       (select (value->>'versie_schema')::int from public.instellingen where key = 'app') as schema;
