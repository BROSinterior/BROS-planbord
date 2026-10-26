-- =====================================================================
--  BROS Planbord — databasescript 055: Renders (BROS Render in het Planbord, v1.59)
--  Per project een tabblad Renders: ontwerpbeelden opladen en meteen laten renderen (betaalde OpenAI-beeldgeneratie op de
--  verwerkingscomputer, de Mac mini), optionele sfeerbeelden (licht/sfeer, max. 4), materiaalafspraken per ruimte,
--  vergelijken, goedkeuren, downloaden en een A3-presentatie in de BROS-huisstijl.
--
--  - render_beelden: ontwerp (opgeladen bron), sfeer (sfeerbibliotheek van het project) en render (resultaat). Bestanden in
--    de privé-opslag 'renders' onder <project>/<soort>/<bestand>.
--  - render_opdrachten: één betaalde beeldgeneratie. Dubbel betalen kan niet: elke aanvraag heeft een vast request_id per
--    gebruiker; dezelfde aanvraag opnieuw (bv. na een netwerkfout) geeft de bestaande opdracht terug, een andere inhoud met
--    hetzelfde id wordt geweigerd. Daglimiet (Instellingen › Renders) wordt in de databank zelf bewaakt.
--    Een opdracht die al naar OpenAI vertrok en onderbroken werd, wordt 'onzeker' — NOOIT automatisch opnieuw verstuurd.
--  - render_afspraken: materiaalafspraken per ruimte ('*' = het hele project); de opdracht bewaart een kopie (snapshot).
--  - render_presentaties: A3-pdf (klant, datum, ontwerpversie) uit gekozen renders — geen betaalde generatie.
--  - Toegang: enkel het team (beheer + medewerkers); de verwerkingscomputer enkel wat hij nu verwerkt. Klanten en aannemers
--    zien niets. De OpenAI-sleutel staat enkel op de Mac mini (sleutelhanger), nooit in de databank of de browser.
--  Vereist schema 54. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 54 then
    raise exception 'Voer eerst de scripts tot en met 054 uit.';
  end if;
end $$;

-- ---------- 1. tabellen ----------
create table if not exists public.render_beelden (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projecten(id) on delete cascade,
  soort             text not null check (soort in ('ontwerp', 'sfeer', 'render')),
  ruimte            text not null default '',
  naam              text not null default '',
  pad               text not null unique,                             -- in de opslag 'renders'
  mime              text not null default '',
  grootte           bigint not null default 0,
  breedte           int,
  hoogte            int,
  sha256            text not null default '',
  opdracht_id       uuid,                                             -- render: de opdracht die hem maakte
  goedgekeurd_door  uuid references public.profiles(id) on delete set null,
  goedgekeurd_op    timestamptz,
  drive             jsonb,                                            -- {id, url} van de kopie in de projectmap › Renders
  created_by        uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now()
);
create index if not exists render_beelden_project_idx on public.render_beelden(project_id, created_at desc);

create table if not exists public.render_afspraken (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projecten(id) on delete cascade,
  ruimte      text not null default '*',
  tekst       text not null check (length(tekst) between 1 and 2000),
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists render_afspraken_project_idx on public.render_afspraken(project_id);

create table if not exists public.render_opdrachten (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projecten(id) on delete cascade,
  ruimte             text not null,
  instructie         text not null,
  bron_id            uuid not null references public.render_beelden(id) on delete restrict,
  sfeer_ids          uuid[] not null default '{}',
  afspraken          jsonb not null default '[]'::jsonb,              -- kopie van de afspraken op het moment van de aanvraag
  model              text not null,
  kwaliteit          text not null check (kwaliteit in ('low', 'medium', 'high')),
  lange_zijde        int not null default 2048,
  request_id         text not null,
  digest             text not null,
  status             text not null default 'wachtrij' check (status in ('wachtrij', 'bezig', 'klaar', 'mislukt', 'onzeker', 'geannuleerd')),
  dag                date not null default (now() at time zone 'Europe/Brussels')::date,
  pogingen           int not null default 0,
  max_pogingen       int not null default 3,                          -- enkel vóór het versturen naar OpenAI
  worker             text,
  worker_user        uuid,
  claim              uuid,
  lease_tot          timestamptz,
  api_verstuurd_op   timestamptz,                                     -- gezet vlak vóór de betaalde aanvraag
  openai_request_id  text not null default '',
  verbruik           jsonb,
  resultaat_id       uuid references public.render_beelden(id) on delete set null,
  stap               text not null default '',
  voortgang          numeric(5,4) not null default 0,
  fout               text not null default '',
  fout_detail        text not null default '',
  aangevraagd_door   uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  gestart_op         timestamptz,
  klaar_op           timestamptz,
  constraint render_opdrachten_request unique (aangevraagd_door, request_id),
  constraint render_opdrachten_sfeer check (cardinality(sfeer_ids) <= 4)
);
create index if not exists render_opdrachten_project_idx on public.render_opdrachten(project_id, created_at desc);
create index if not exists render_opdrachten_wachtrij_idx on public.render_opdrachten(status, created_at);
create index if not exists render_opdrachten_dag_idx on public.render_opdrachten(dag);

create table if not exists public.render_presentaties (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projecten(id) on delete cascade,
  klant             text not null,
  versie            text not null,
  datum             date not null,
  liggend           boolean not null default false,
  render_ids        uuid[] not null,
  status            text not null default 'wachtrij' check (status in ('wachtrij', 'bezig', 'klaar', 'mislukt')),
  pad               text,                                             -- de pdf in de opslag 'renders'
  grootte           bigint,
  paginas           int,
  drive             jsonb,
  pogingen          int not null default 0,
  max_pogingen      int not null default 3,
  worker            text,
  worker_user       uuid,
  claim             uuid,
  lease_tot         timestamptz,
  fout              text not null default '',
  fout_detail       text not null default '',
  aangevraagd_door  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  klaar_op          timestamptz,
  constraint render_presentaties_aantal check (cardinality(render_ids) between 1 and 40)
);
create index if not exists render_presentaties_project_idx on public.render_presentaties(project_id, created_at desc);

drop trigger if exists render_opdrachten_touch on public.render_opdrachten;
create trigger render_opdrachten_touch before update on public.render_opdrachten for each row execute function public.touch_updated_at();
drop trigger if exists render_presentaties_touch on public.render_presentaties;
create trigger render_presentaties_touch before update on public.render_presentaties for each row execute function public.touch_updated_at();
drop trigger if exists render_afspraken_touch on public.render_afspraken;
create trigger render_afspraken_touch before update on public.render_afspraken for each row execute function public.touch_updated_at();

-- ---------- 2. instellingen (Instellingen › Renders, enkel beheer) ----------
insert into public.instellingen (key, value)
  values ('render', jsonb_build_object('model', 'gpt-image-2', 'kwaliteit', 'medium', 'lange_zijde', 2048, 'daglimiet', 20))
  on conflict (key) do nothing;
create or replace function public.rd_instelling()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('model', coalesce(nullif(v->>'model', ''), 'gpt-image-2'),
                            'kwaliteit', case when v->>'kwaliteit' in ('low', 'medium', 'high') then v->>'kwaliteit' else 'medium' end,
                            'lange_zijde', case when (v->>'lange_zijde') in ('1536', '2048', '2560') then (v->>'lange_zijde')::int else 2048 end,
                            'daglimiet', least(greatest(coalesce((v->>'daglimiet')::int, 20), 0), 500))
  from (select coalesce((select value from public.instellingen where key = 'render'), '{}'::jsonb) as v) x
$$;

-- ---------- 3. hulpfuncties voor toegang ----------
create or replace function public.rd_pad_project(p_name text)
returns uuid language sql immutable set search_path = public as $$
  select case when split_part(coalesce(p_name, ''), '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(p_name, '/', 1)::uuid end
$$;
-- verwerkt de ingelogde verwerkingscomputer nu een render- of presentatieopdracht van dit project?
create or replace function public.rd_actieve_job(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_verwerker() and p_project is not null and (
    exists (select 1 from public.render_opdrachten o where o.project_id = p_project and o.status = 'bezig' and o.worker_user = auth.uid() and o.lease_tot > now())
    or exists (select 1 from public.render_presentaties o where o.project_id = p_project and o.status = 'bezig' and o.worker_user = auth.uid() and o.lease_tot > now()))
$$;
-- (opslagregel) ontwerp- en sfeerbeelden van het team: bestaat het project?
create or replace function public.rd_project_ok(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_intern() and p_project is not null and exists (select 1 from public.projecten where id = p_project)
$$;
-- (opslagregel) mag een opgeladen bestand weg: enkel als er geen beeld (meer) naar verwijst — eerst de rij (rb_weg), dan het bestand
create or replace function public.rd_bestand_weg_ok(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_intern() and split_part(p_name, '/', 2) in ('ontwerp', 'sfeer') and not exists (select 1 from public.render_beelden b where b.pad = p_name)
$$;
-- een opgeladen bestand in de opslag controleren (bestaat, juiste grootte)
create or replace function public.rd_object_ok(p_pad text, p_grootte bigint)
returns boolean language sql stable security definer set search_path = public, storage as $$
  select exists (select 1 from storage.objects o where o.bucket_id = 'renders' and o.name = p_pad
                 and (o.metadata->>'size') is not null and (o.metadata->>'size')::bigint = p_grootte)
$$;

alter table public.render_beelden enable row level security;
alter table public.render_afspraken enable row level security;
alter table public.render_opdrachten enable row level security;
alter table public.render_presentaties enable row level security;
drop policy if exists rb_lezen on public.render_beelden;
drop policy if exists rb_weg on public.render_beelden;
create policy rb_lezen on public.render_beelden for select to authenticated using (public.is_intern());
-- een beeld verwijderen: wie het opleed of beheer; nooit een bron of sfeer van een opdracht die loopt of wacht
create policy rb_weg on public.render_beelden for delete to authenticated using (public.is_intern() and (public.is_beheer() or created_by = auth.uid())
  and not exists (select 1 from public.render_opdrachten o where (o.bron_id = render_beelden.id or render_beelden.id = any(o.sfeer_ids)) and o.status in ('wachtrij', 'bezig')));
drop policy if exists ra_lezen on public.render_afspraken;
drop policy if exists ra_schrijven on public.render_afspraken;
create policy ra_lezen on public.render_afspraken for select to authenticated using (public.is_intern());
create policy ra_schrijven on public.render_afspraken for all to authenticated using (public.is_intern()) with check (public.is_intern() and length(trim(tekst)) > 0);
drop policy if exists ro_lezen on public.render_opdrachten;
create policy ro_lezen on public.render_opdrachten for select to authenticated using (public.is_intern());
drop policy if exists rp_lezen on public.render_presentaties;
drop policy if exists rp_weg on public.render_presentaties;
create policy rp_lezen on public.render_presentaties for select to authenticated using (public.is_intern());
create policy rp_weg on public.render_presentaties for delete to authenticated using (public.is_intern() and status <> 'bezig' and (public.is_beheer() or aangevraagd_door = auth.uid()));

-- ---------- 4. functies voor het team ----------
-- een sfeerbeeld registreren (na het opladen naar renders/<project>/sfeer/…)
create or replace function public.render_sfeer_bewaar(p_project uuid, p_pad text, p_naam text, p_mime text, p_grootte bigint, p_sha256 text, p_breedte int, p_hoogte int)
returns public.render_beelden language plpgsql security definer set search_path = public as $$
declare b public.render_beelden;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  if not exists (select 1 from public.projecten where id = p_project) then raise exception 'Project niet gevonden.'; end if;
  if coalesce(p_pad, '') not like p_project::text || '/sfeer/%' or split_part(p_pad, '/', 4) <> '' then raise exception 'Ongeldig pad voor het sfeerbeeld.'; end if;
  if p_mime not in ('image/png', 'image/jpeg', 'image/webp') then raise exception 'Enkel PNG, JPEG of WebP.'; end if;
  if coalesce(p_sha256, '') !~ '^[0-9a-f]{64}$' then raise exception 'Beeld zonder controlegetal.'; end if;
  if not public.rd_object_ok(p_pad, p_grootte) then raise exception 'Het beeld staat (nog) niet volledig in de opslag. Probeer opnieuw.'; end if;
  select * into b from public.render_beelden where pad = p_pad;
  if b.id is not null then return b; end if;   -- dezelfde upload opnieuw bevestigd
  insert into public.render_beelden (project_id, soort, ruimte, naam, pad, mime, grootte, breedte, hoogte, sha256)
  values (p_project, 'sfeer', '', left(coalesce(nullif(trim(p_naam), ''), 'sfeerbeeld'), 200), p_pad, p_mime, p_grootte, p_breedte, p_hoogte, p_sha256)
  returning * into b;
  return b;
end $$;

-- een render aanvragen. p_bron: {"id": bestaand ontwerp of render} of een nieuw opgeladen ontwerp
-- {"pad","naam","mime","grootte","sha256","breedte","hoogte"} (pad = <project>/ontwerp/<request_id>.<ext>).
-- Idempotent op (aanvrager, request_id): dezelfde aanvraag geeft de bestaande opdracht terug ("hergebruikt": true).
create or replace function public.render_aanvragen(p_project uuid, p_request_id text, p_ruimte text, p_instructie text, p_bron jsonb,
                                                   p_sfeer_ids uuid[], p_kwaliteit text, p_model text, p_toestemming boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg jsonb := public.rd_instelling(); o public.render_opdrachten; b public.render_beelden; dig text; v_ruimte text; vandaag date;
        n int; sfeer uuid[] := coalesce(p_sfeer_ids, '{}'); afspr jsonb; ext text;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  if coalesce(p_request_id, '') !~ '^[0-9a-f]{32}$' then raise exception 'Ongeldig aanvraagnummer.'; end if;
  v_ruimte := left(trim(coalesce(p_ruimte, '')), 120);
  dig := md5(jsonb_build_object('p', p_project, 'r', v_ruimte, 'i', trim(coalesce(p_instructie, '')), 'b', coalesce(p_bron, '{}'::jsonb) - 'breedte' - 'hoogte',
                                's', to_jsonb(sfeer), 'k', p_kwaliteit, 'm', p_model)::text);
  -- 1. dezelfde aanvraag al ontvangen? (ook na een netwerkfout: nooit een tweede betaalde opdracht)
  perform pg_advisory_xact_lock(hashtext('render_aanvraag:' || auth.uid()::text || ':' || p_request_id));
  select * into o from public.render_opdrachten where aangevraagd_door = auth.uid() and request_id = p_request_id;
  if o.id is not null then
    if o.digest <> dig then raise exception 'Deze aanvraag werd al verwerkt met andere instellingen. Start een nieuwe aanvraag.'; end if;
    return jsonb_build_object('opdracht', to_jsonb(o), 'bron', (select to_jsonb(x) from public.render_beelden x where x.id = o.bron_id), 'hergebruikt', true);
  end if;
  -- 2. controles
  if p_toestemming is not true then raise exception 'Bevestig eerst de betaalde beeldgeneratie.'; end if;
  if not exists (select 1 from public.projecten where id = p_project) then raise exception 'Project niet gevonden.'; end if;
  if v_ruimte = '' then raise exception 'Vul de ruimte in.'; end if;
  if length(trim(coalesce(p_instructie, ''))) = 0 or length(p_instructie) > 4000 then raise exception 'Beschrijf wat er gerenderd moet worden (max. 4000 tekens).'; end if;
  if p_kwaliteit not in ('low', 'medium', 'high') then raise exception 'Ongeldige kwaliteit.'; end if;
  if p_model is distinct from cfg->>'model' then raise exception 'Het beeldmodel werd intussen gewijzigd (nu %). Herlaad het Planbord en bevestig opnieuw.', cfg->>'model'; end if;
  if cardinality(sfeer) > 4 or (select count(distinct x) from unnest(sfeer) x) <> cardinality(sfeer) then raise exception 'Kies maximaal vier verschillende sfeerbeelden.'; end if;
  if exists (select 1 from unnest(sfeer) x where not exists (select 1 from public.render_beelden s where s.id = x and s.project_id = p_project and s.soort = 'sfeer')) then
    raise exception 'Kies sfeerbeelden uit de sfeerbibliotheek van dit project.'; end if;
  -- 3. daglimiet (voor het hele team, per kalenderdag in België) — één aanvraag tegelijk telt
  perform pg_advisory_xact_lock(hashtext('render_daglimiet'));
  vandaag := (now() at time zone 'Europe/Brussels')::date;
  select count(*) into n from public.render_opdrachten where dag = vandaag and status <> 'geannuleerd';
  if n + 1 > (cfg->>'daglimiet')::int then raise exception 'Daglimiet bereikt (% renders vandaag). Een beheerder kan die verhogen in Instellingen › Renders.', n; end if;
  -- 4. de bron: een bestaand beeld van dit project, of het pas opgeladen ontwerp
  if p_bron ? 'id' then
    select * into b from public.render_beelden where id = (p_bron->>'id')::uuid and project_id = p_project;
    if b.id is null then raise exception 'Dit beeld hoort niet bij dit project.'; end if;
    if b.soort = 'sfeer' then raise exception 'Een sfeerbeeld is geen ontwerp. Kies het ontwerp dat je wilt renderen.'; end if;
  else
    ext := lower(substring(coalesce(p_bron->>'pad', '') from '\.([a-z0-9]{3,4})$'));
    if coalesce(p_bron->>'pad', '') <> p_project::text || '/ontwerp/' || p_request_id || '.' || coalesce(ext, '') or coalesce(ext, '') not in ('png', 'jpg', 'jpeg', 'webp') then
      raise exception 'Ongeldig pad voor het ontwerpbeeld.'; end if;
    if p_bron->>'mime' not in ('image/png', 'image/jpeg', 'image/webp') then raise exception 'Enkel PNG, JPEG of WebP.'; end if;
    if coalesce(p_bron->>'sha256', '') !~ '^[0-9a-f]{64}$' then raise exception 'Beeld zonder controlegetal.'; end if;
    if sfeer && array(select id from public.render_beelden where pad = p_bron->>'pad') then raise exception 'Een ontwerp kan niet tegelijk sfeerbeeld zijn.'; end if;
    if not public.rd_object_ok(p_bron->>'pad', (p_bron->>'grootte')::bigint) then raise exception 'Het ontwerpbeeld staat (nog) niet volledig in de opslag. Probeer opnieuw.'; end if;
    select * into b from public.render_beelden where pad = p_bron->>'pad';
    if b.id is null then
      insert into public.render_beelden (project_id, soort, ruimte, naam, pad, mime, grootte, breedte, hoogte, sha256)
      values (p_project, 'ontwerp', v_ruimte, left(coalesce(nullif(trim(p_bron->>'naam'), ''), 'ontwerp'), 200), p_bron->>'pad', p_bron->>'mime', (p_bron->>'grootte')::bigint,
              nullif(p_bron->>'breedte', '')::int, nullif(p_bron->>'hoogte', '')::int, p_bron->>'sha256')
      returning * into b;
    end if;
  end if;
  -- 5. afspraken van deze ruimte en het hele project (kopie: latere wijzigingen veranderen deze opdracht niet)
  select coalesce(jsonb_agg(jsonb_build_object('ruimte', a.ruimte, 'tekst', a.tekst) order by a.ruimte, a.created_at), '[]'::jsonb) into afspr
  from public.render_afspraken a where a.project_id = p_project and (a.ruimte = '*' or lower(trim(a.ruimte)) = lower(v_ruimte));
  insert into public.render_opdrachten (project_id, ruimte, instructie, bron_id, sfeer_ids, afspraken, model, kwaliteit, lange_zijde, request_id, digest, dag)
  values (p_project, v_ruimte, trim(p_instructie), b.id, sfeer, afspr, cfg->>'model', p_kwaliteit, (cfg->>'lange_zijde')::int, p_request_id, dig, vandaag)
  returning * into o;
  return jsonb_build_object('opdracht', to_jsonb(o), 'bron', to_jsonb(b), 'hergebruikt', false);
end $$;

-- annuleren: enkel zolang de opdracht nog niet gestart is (eigen opdracht of beheer)
create or replace function public.render_annuleer(p_id uuid)
returns public.render_opdrachten language plpgsql security definer set search_path = public as $$
declare o public.render_opdrachten;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  update public.render_opdrachten set status = 'geannuleerd', klaar_op = now(), fout = 'Geannuleerd door ' || coalesce((select name from public.profiles where id = auth.uid()), 'een gebruiker') || '.'
  where id = p_id and status = 'wachtrij' and (public.is_beheer() or aangevraagd_door = auth.uid()) returning * into o;
  if o.id is null then raise exception 'Deze opdracht is al gestart of niet van jou — annuleren kan niet meer.'; end if;
  return o;
end $$;

-- goedkeuren (menselijke beoordeling; wijzigt geen afspraken)
create or replace function public.render_goedkeur(p_beeld uuid, p_goed boolean)
returns public.render_beelden language plpgsql security definer set search_path = public as $$
declare b public.render_beelden;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  update public.render_beelden set goedgekeurd_door = case when p_goed then auth.uid() end, goedgekeurd_op = case when p_goed then now() end
  where id = p_beeld and soort = 'render' returning * into b;
  if b.id is null then raise exception 'Render niet gevonden.'; end if;
  return b;
end $$;

-- een A3-presentatie aanvragen (geen betaalde generatie)
create or replace function public.render_presentatie_maak(p_project uuid, p_klant text, p_versie text, p_datum date, p_liggend boolean, p_render_ids uuid[])
returns public.render_presentaties language plpgsql security definer set search_path = public as $$
declare r public.render_presentaties;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  if length(trim(coalesce(p_klant, ''))) = 0 or length(p_klant) > 100 then raise exception 'Vul de klantnaam in (max. 100 tekens).'; end if;
  if length(trim(coalesce(p_versie, ''))) = 0 or length(p_versie) > 40 then raise exception 'Vul de ontwerpversie in (max. 40 tekens).'; end if;
  if p_datum is null then raise exception 'Kies een datum.'; end if;
  if coalesce(cardinality(p_render_ids), 0) = 0 or cardinality(p_render_ids) > 40 then raise exception 'Kies 1 tot 40 beelden.'; end if;
  if (select count(distinct x) from unnest(p_render_ids) x) <> cardinality(p_render_ids) then raise exception 'Elk beeld maar één keer.'; end if;
  if exists (select 1 from unnest(p_render_ids) x where not exists (select 1 from public.render_beelden b where b.id = x and b.project_id = p_project and b.soort in ('render', 'ontwerp'))) then
    raise exception 'Kies enkel renders of ontwerpen van dit project.'; end if;
  insert into public.render_presentaties (project_id, klant, versie, datum, liggend, render_ids)
  values (p_project, trim(p_klant), trim(p_versie), p_datum, coalesce(p_liggend, false), p_render_ids) returning * into r;
  return r;
end $$;

-- ---------- 5. functies voor de verwerkingscomputer (rol verwerker) ----------
-- volgende render. Vastgelopen opdrachten (lease verlopen): nog niet naar OpenAI → opnieuw in de wachtrij (max. 3 pogingen);
-- wel al verstuurd → 'onzeker' (nooit automatisch opnieuw betalen).
create or replace function public.render_claim(p_naam text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.render_opdrachten; p public.projecten; r record; bron public.render_beelden;
begin
  if not public.is_verwerker() then raise exception 'Geen verwerkingscomputer.'; end if;
  for r in select * from public.render_opdrachten where status = 'bezig' and lease_tot < now() for update skip locked loop
    if r.api_verstuurd_op is not null then
      update public.render_opdrachten set status = 'onzeker', klaar_op = now(), lease_tot = null,
             fout = 'De verwerkingscomputer werd onderbroken nadat de opdracht naar OpenAI vertrok. Er wordt niets automatisch opnieuw betaald: kijk het verbruik na en start zo nodig bewust een nieuwe render.' where id = r.id;
    elsif r.pogingen >= r.max_pogingen then
      update public.render_opdrachten set status = 'mislukt', klaar_op = now(), lease_tot = null, fout = 'De opdracht werd ' || r.pogingen || ' keer onderbroken vóór het renderen (niets betaald). Probeer opnieuw.' where id = r.id;
    else
      update public.render_opdrachten set status = 'wachtrij', worker = null, worker_user = null, lease_tot = null, fout = 'Onderbroken vóór het renderen — wordt hervat.' where id = r.id;
    end if;
  end loop;
  select * into o from public.render_opdrachten where status = 'wachtrij' order by created_at limit 1 for update skip locked;
  if o.id is null then return null; end if;
  update public.render_opdrachten set status = 'bezig', worker = left(p_naam, 60), worker_user = auth.uid(), claim = gen_random_uuid(), lease_tot = now() + interval '10 minutes',
         pogingen = pogingen + 1, gestart_op = coalesce(gestart_op, now()), stap = 'gestart', voortgang = 0, fout = '' where id = o.id returning * into o;
  update public.verwerker_status set huidige_job = o.id where naam = left(p_naam, 60);
  select * into p from public.projecten where id = o.project_id;
  select * into bron from public.render_beelden where id = o.bron_id;
  return jsonb_build_object(
    'job', jsonb_build_object('id', o.id, 'claim', o.claim, 'soort', 'render', 'poging', o.pogingen, 'max_pogingen', o.max_pogingen),
    'opdracht', jsonb_build_object('id', o.id, 'ruimte', o.ruimte, 'instructie', o.instructie, 'afspraken', o.afspraken, 'model', o.model, 'kwaliteit', o.kwaliteit,
                                   'lange_zijde', o.lange_zijde, 'api_verstuurd_op', o.api_verstuurd_op, 'gebruiker', md5('bros-render:' || coalesce(o.aangevraagd_door::text, ''))),
    'bron', jsonb_build_object('id', bron.id, 'pad', bron.pad, 'mime', bron.mime, 'sha256', bron.sha256, 'soort', bron.soort, 'naam', bron.naam),
    'sfeer', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'pad', s.pad, 'mime', s.mime, 'sha256', s.sha256) order by array_position(o.sfeer_ids, s.id))
                       from public.render_beelden s where s.id = any(o.sfeer_ids)), '[]'::jsonb),
    'project', jsonb_build_object('id', p.id, 'nummer', p.nummer, 'klant', p.klant, 'naam', p.naam, 'drive', coalesce(p.drive_folder_id, '') <> ''));
end $$;

create or replace function public.rd_eigen(p_job uuid, p_claim uuid)
returns public.render_opdrachten language plpgsql stable security definer set search_path = public as $$
declare o public.render_opdrachten;
begin
  if not public.is_verwerker() then raise exception 'Geen verwerkingscomputer.'; end if;
  select * into o from public.render_opdrachten where id = p_job;
  if o.id is null or o.worker_user is distinct from auth.uid() or o.claim is distinct from p_claim then raise exception 'Deze render is niet (meer) van deze verwerkingscomputer.'; end if;
  return o;
end $$;

-- voortgang + lease verlengen (de hartslag van de verwerker)
create or replace function public.render_voortgang(p_job uuid, p_claim uuid, p_stap text, p_voortgang numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.render_opdrachten;
begin
  o := public.rd_eigen(p_job, p_claim);
  if o.status <> 'bezig' then return jsonb_build_object('actief', false, 'status', o.status); end if;
  update public.render_opdrachten set stap = left(coalesce(p_stap, ''), 200), voortgang = least(greatest(coalesce(p_voortgang, 0), 0), 1), lease_tot = now() + interval '10 minutes' where id = p_job;
  return jsonb_build_object('actief', true);
end $$;

-- vlak vóór de betaalde aanvraag: vastleggen dat ze vertrekt (één keer per opdracht)
create or replace function public.render_api_start(p_job uuid, p_claim uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.render_opdrachten;
begin
  o := public.rd_eigen(p_job, p_claim);
  if o.api_verstuurd_op is not null then raise exception 'Deze render werd al naar OpenAI verstuurd — niet opnieuw.'; end if;
  -- in één stap: enkel als de opdracht nog van deze verwerker is, loopt en de lease geldig is
  update public.render_opdrachten set api_verstuurd_op = now(), stap = 'renderen (OpenAI)', lease_tot = now() + interval '20 minutes'
  where id = p_job and claim = p_claim and worker_user = auth.uid() and status = 'bezig' and api_verstuurd_op is null and lease_tot > now() returning * into o;
  if o.id is null then raise exception 'Deze render loopt niet meer op deze verwerkingscomputer — niet versturen.'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- resultaat: het beeld staat in renders/<project>/render/<opdracht>.<ext>
create or replace function public.render_klaar(p_job uuid, p_claim uuid, p_resultaat jsonb)
returns public.render_opdrachten language plpgsql security definer set search_path = public as $$
declare o public.render_opdrachten; b public.render_beelden;
begin
  o := public.rd_eigen(p_job, p_claim);
  -- ook 'onzeker' (lease verlopen tijdens de betaalde aanvraag): het betaalde beeld mag niet verloren gaan
  if o.status not in ('bezig', 'onzeker') then raise exception 'Deze render loopt niet meer (status %).', o.status; end if;
  if coalesce(p_resultaat->>'pad', '') !~ ('^' || o.project_id::text || '/render/' || o.id::text || '\.(png|jpg|webp)$') then raise exception 'Ongeldig pad voor de render.'; end if;
  if not public.rd_object_ok(p_resultaat->>'pad', (p_resultaat->>'grootte')::bigint) then raise exception 'De render staat niet volledig in de opslag.'; end if;
  insert into public.render_beelden (project_id, soort, ruimte, naam, pad, mime, grootte, breedte, hoogte, sha256, opdracht_id, drive, created_by)
  values (o.project_id, 'render', o.ruimte, left(coalesce(p_resultaat->>'naam', 'render'), 200), p_resultaat->>'pad', coalesce(p_resultaat->>'mime', 'image/png'),
          (p_resultaat->>'grootte')::bigint, nullif(p_resultaat->>'breedte', '')::int, nullif(p_resultaat->>'hoogte', '')::int, coalesce(p_resultaat->>'sha256', ''), o.id,
          case when jsonb_typeof(p_resultaat->'drive') = 'object' then p_resultaat->'drive' end, o.aangevraagd_door)
  on conflict (pad) do update set drive = excluded.drive
  returning * into b;
  update public.render_opdrachten set status = 'klaar', resultaat_id = b.id, klaar_op = now(), lease_tot = null, stap = '', voortgang = 1, fout = left(coalesce(p_resultaat->>'melding', ''), 500),
         openai_request_id = left(coalesce(p_resultaat->>'openai_request_id', ''), 200), verbruik = case when jsonb_typeof(p_resultaat->'verbruik') = 'object' then p_resultaat->'verbruik' end
  where id = p_job returning * into o;
  update public.verwerker_status set huidige_job = null where user_id = auth.uid() and huidige_job = p_job;
  return o;
end $$;

-- mislukt. Nog niet naar OpenAI verstuurd en p_opnieuw → terug in de wachtrij (tot max_pogingen).
-- Wel verstuurd: 'onzeker' tenzij OpenAI de aanvraag aantoonbaar weigerde (p_onzeker = false → 'mislukt').
create or replace function public.render_mislukt(p_job uuid, p_claim uuid, p_fout text, p_detail text, p_opnieuw boolean, p_onzeker boolean, p_openai_request_id text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.render_opdrachten; st text;
begin
  o := public.rd_eigen(p_job, p_claim);
  if o.status <> 'bezig' then return jsonb_build_object('ok', false, 'status', o.status); end if;
  st := case when o.api_verstuurd_op is null and coalesce(p_opnieuw, false) and o.pogingen < o.max_pogingen then 'wachtrij'
             when o.api_verstuurd_op is not null and coalesce(p_onzeker, true) then 'onzeker'
             else 'mislukt' end;
  update public.render_opdrachten set status = st, fout = left(coalesce(p_fout, ''), 500), fout_detail = left(coalesce(p_detail, ''), 4000),
         openai_request_id = left(coalesce(nullif(p_openai_request_id, ''), openai_request_id), 200),
         worker = case when st = 'wachtrij' then null else worker end, worker_user = case when st = 'wachtrij' then null else worker_user end,
         lease_tot = null, klaar_op = case when st = 'wachtrij' then null else now() end
  where id = p_job;
  update public.verwerker_status set huidige_job = null where user_id = auth.uid() and huidige_job = p_job;
  return jsonb_build_object('ok', true, 'status', st);
end $$;

-- presentaties (geen kosten: opnieuw proberen mag)
create or replace function public.presentatie_claim(p_naam text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.render_presentaties; p public.projecten; r record;
begin
  if not public.is_verwerker() then raise exception 'Geen verwerkingscomputer.'; end if;
  for r in select * from public.render_presentaties where status = 'bezig' and lease_tot < now() for update skip locked loop
    update public.render_presentaties set status = case when r.pogingen >= r.max_pogingen then 'mislukt' else 'wachtrij' end, worker = null, worker_user = null, lease_tot = null,
           fout = case when r.pogingen >= r.max_pogingen then 'De presentatie werd ' || r.pogingen || ' keer onderbroken. Probeer opnieuw.' else 'Onderbroken — wordt hervat.' end where id = r.id;
  end loop;
  select * into o from public.render_presentaties where status = 'wachtrij' order by created_at limit 1 for update skip locked;
  if o.id is null then return null; end if;
  update public.render_presentaties set status = 'bezig', worker = left(p_naam, 60), worker_user = auth.uid(), claim = gen_random_uuid(), lease_tot = now() + interval '10 minutes',
         pogingen = pogingen + 1, fout = '' where id = o.id returning * into o;
  select * into p from public.projecten where id = o.project_id;
  return jsonb_build_object(
    'job', jsonb_build_object('id', o.id, 'claim', o.claim, 'soort', 'presentatie', 'poging', o.pogingen),
    'presentatie', jsonb_build_object('id', o.id, 'klant', o.klant, 'versie', o.versie, 'datum', o.datum, 'liggend', o.liggend),
    'beelden', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'pad', b.pad, 'mime', b.mime, 'sha256', b.sha256, 'ruimte', b.ruimte) order by array_position(o.render_ids, b.id))
                         from public.render_beelden b where b.id = any(o.render_ids) and b.project_id = o.project_id), '[]'::jsonb),
    'project', jsonb_build_object('id', p.id, 'nummer', p.nummer, 'klant', p.klant, 'naam', p.naam, 'drive', coalesce(p.drive_folder_id, '') <> ''));
end $$;

create or replace function public.rp_eigen(p_job uuid, p_claim uuid)
returns public.render_presentaties language plpgsql stable security definer set search_path = public as $$
declare o public.render_presentaties;
begin
  if not public.is_verwerker() then raise exception 'Geen verwerkingscomputer.'; end if;
  select * into o from public.render_presentaties where id = p_job;
  if o.id is null or o.worker_user is distinct from auth.uid() or o.claim is distinct from p_claim then raise exception 'Deze presentatie is niet (meer) van deze verwerkingscomputer.'; end if;
  return o;
end $$;

create or replace function public.presentatie_voortgang(p_job uuid, p_claim uuid, p_stap text, p_voortgang numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.render_presentaties;
begin
  o := public.rp_eigen(p_job, p_claim);
  if o.status <> 'bezig' then return jsonb_build_object('actief', false, 'status', o.status); end if;
  update public.render_presentaties set lease_tot = now() + interval '10 minutes' where id = p_job;
  return jsonb_build_object('actief', true);
end $$;

create or replace function public.presentatie_klaar(p_job uuid, p_claim uuid, p_resultaat jsonb)
returns public.render_presentaties language plpgsql security definer set search_path = public as $$
declare o public.render_presentaties;
begin
  o := public.rp_eigen(p_job, p_claim);
  if o.status <> 'bezig' then raise exception 'Deze presentatie loopt niet meer.'; end if;
  if coalesce(p_resultaat->>'pad', '') !~ ('^' || o.project_id::text || '/presentatie/' || o.id::text || '-[0-9]{1,3}\.pdf$') then raise exception 'Ongeldig pad voor de presentatie.'; end if;
  if not public.rd_object_ok(p_resultaat->>'pad', (p_resultaat->>'grootte')::bigint) then raise exception 'De presentatie staat niet volledig in de opslag.'; end if;
  update public.render_presentaties set status = 'klaar', pad = p_resultaat->>'pad', grootte = (p_resultaat->>'grootte')::bigint, paginas = nullif(p_resultaat->>'paginas', '')::int,
         drive = case when jsonb_typeof(p_resultaat->'drive') = 'object' then p_resultaat->'drive' end, fout = left(coalesce(p_resultaat->>'melding', ''), 500),
         klaar_op = now(), lease_tot = null where id = p_job returning * into o;
  return o;
end $$;

create or replace function public.presentatie_mislukt(p_job uuid, p_claim uuid, p_fout text, p_detail text, p_opnieuw boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.render_presentaties; st text;
begin
  o := public.rp_eigen(p_job, p_claim);
  if o.status <> 'bezig' then return jsonb_build_object('ok', false, 'status', o.status); end if;
  st := case when coalesce(p_opnieuw, false) and o.pogingen < o.max_pogingen then 'wachtrij' else 'mislukt' end;
  update public.render_presentaties set status = st, fout = left(coalesce(p_fout, ''), 500), fout_detail = left(coalesce(p_detail, ''), 4000), worker = null, worker_user = null, lease_tot = null,
         klaar_op = case when st = 'mislukt' then now() end where id = p_job;
  return jsonb_build_object('ok', true, 'status', st);
end $$;

-- opnieuw proberen (mislukte presentatie)
create or replace function public.render_presentatie_opnieuw(p_id uuid)
returns public.render_presentaties language plpgsql security definer set search_path = public as $$
declare o public.render_presentaties;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  update public.render_presentaties set status = 'wachtrij', max_pogingen = pogingen + 3, fout = '', fout_detail = '', worker = null, worker_user = null, claim = null, lease_tot = null, klaar_op = null
  where id = p_id and status = 'mislukt' returning * into o;
  if o.id is null then raise exception 'Enkel een mislukte presentatie kan opnieuw.'; end if;
  return o;
end $$;

-- ---------- 6. opslag 'renders' (privé) ----------
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public) values ('renders', 'renders', false) on conflict (id) do update set public = false;
    if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
      update storage.buckets set file_size_limit = 52428800, allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'] where id = 'renders';
    end if;
    execute 'drop policy if exists renders_insert on storage.objects';
    execute 'drop policy if exists renders_read on storage.objects';
    execute 'drop policy if exists renders_delete on storage.objects';
    -- team: ontwerp- en sfeerbeelden; de verwerkingscomputer: renders en presentaties van wat hij nu verwerkt
    execute $p$create policy renders_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'renders' and split_part(name, '/', 4) = '' and (
        (split_part(name, '/', 2) in ('ontwerp', 'sfeer') and public.rd_project_ok(public.rd_pad_project(name)))
        or (split_part(name, '/', 2) in ('render', 'presentatie') and public.rd_actieve_job(public.rd_pad_project(name)))))$p$;
    execute $p$create policy renders_read on storage.objects for select to authenticated using (
      bucket_id = 'renders' and (public.is_intern() or public.rd_actieve_job(public.rd_pad_project(name))))$p$;
    execute $p$create policy renders_delete on storage.objects for delete to authenticated using (
      bucket_id = 'renders' and public.rd_bestand_weg_ok(name))$p$;
  end if;
end $$;

-- ---------- 7. live ----------
do $$ declare t text; begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['render_beelden', 'render_opdrachten', 'render_afspraken', 'render_presentaties'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
        execute 'alter publication supabase_realtime add table public.' || t;
      end if;
    end loop;
  end if;
end $$;

-- ---------- rechten ----------
revoke all on public.render_beelden, public.render_opdrachten, public.render_presentaties, public.render_afspraken from anon;
revoke insert, update, truncate, references, trigger on public.render_beelden, public.render_opdrachten, public.render_presentaties from authenticated;   -- schrijven via de functies
revoke truncate, references, trigger on public.render_afspraken from authenticated;
grant select, delete on public.render_beelden, public.render_presentaties to authenticated;
grant select on public.render_opdrachten to authenticated;
grant select, insert, update, delete on public.render_afspraken to authenticated;
revoke all on function public.rd_eigen(uuid, uuid), public.rp_eigen(uuid, uuid), public.rd_instelling() from public, anon, authenticated;
revoke all on function public.rd_pad_project(text), public.rd_actieve_job(uuid), public.rd_project_ok(uuid), public.rd_bestand_weg_ok(text), public.rd_object_ok(text, bigint) from public, anon;
grant execute on function public.rd_pad_project(text), public.rd_actieve_job(uuid), public.rd_project_ok(uuid), public.rd_bestand_weg_ok(text) to authenticated;   -- nodig voor de opslagregels
revoke all on function public.rd_object_ok(text, bigint) from authenticated;
do $$ declare f text; begin
  foreach f in array array['render_sfeer_bewaar(uuid, text, text, text, bigint, text, integer, integer)', 'render_aanvragen(uuid, text, text, text, jsonb, uuid[], text, text, boolean)',
                           'render_annuleer(uuid)', 'render_goedkeur(uuid, boolean)', 'render_presentatie_maak(uuid, text, text, date, boolean, uuid[])', 'render_presentatie_opnieuw(uuid)',
                           'render_claim(text)', 'render_voortgang(uuid, uuid, text, numeric)', 'render_api_start(uuid, uuid)', 'render_klaar(uuid, uuid, jsonb)',
                           'render_mislukt(uuid, uuid, text, text, boolean, boolean, text)', 'presentatie_claim(text)', 'presentatie_voortgang(uuid, uuid, text, numeric)',
                           'presentatie_klaar(uuid, uuid, jsonb)', 'presentatie_mislukt(uuid, uuid, text, text, boolean)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';   -- de functies controleren zelf de rol
  end loop;
end $$;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(55, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: moet 4 | 4 | 1 | 55 teruggeven (tabellen, met RLS, opslag aanwezig, schemaversie).
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('render_beelden', 'render_opdrachten', 'render_afspraken', 'render_presentaties'))::int as tabellen,
       (select count(*) from pg_tables where schemaname = 'public' and tablename in ('render_beelden', 'render_opdrachten', 'render_afspraken', 'render_presentaties') and rowsecurity)::int as rls,
       (select count(*) from storage.buckets where id = 'renders')::int as opslag,
       (select (value->>'versie_schema')::int from public.instellingen where key = 'app') as schema;
