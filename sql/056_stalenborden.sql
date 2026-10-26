-- =====================================================================
--  BROS Planbord — databasescript 056: Stalenborden per ruimte (v1.60)
--  Uitbreiding van de renders (script 055). Per ruimte een fotorealistisch stalenbord: echte stalen (behang, hout, textiel,
--  gelakte of geverfde panelen) op een tafel of bureau uit die ruimte. Zelfde wachtrij, zelfde verwerkingscomputer (Mac mini),
--  zelfde bescherming tegen dubbel betalen, zelfde toestemming en daglimiet als een render.
--
--  - render_opdrachten.soort 'stalenbord': referentiebeelden van de ruimte (referentie_ids, max. 6), de door Phil bevestigde
--    materiaallijst (materialen), aandachtspunten/correcties (instructie) en optioneel het vorige stalenbord dat gericht
--    gecorrigeerd wordt (basis_id). De afspraken van de ruimte en het project worden zoals bij een render gekopieerd.
--  - render_beelden.soort 'stalenbord': het resultaat, met een versienummer per project + ruimte. Eerdere versies blijven
--    bewaard; per ruimte is hoogstens één versie 'geselecteerd' voor de presentatie (expliciete keuze, nooit automatisch).
--  - render_presentaties.stalenborden: optie "Stalenborden per ruimte opnemen". De gekozen versies worden bij het aanmaken
--    vastgelegd (stalenbord_ids). Een presentatie maken start NOOIT een beeldgeneratie.
--  - render_beeld_ruimte: een ontwerp of render aan een andere ruimte koppelen (bv. na een voorstel op basis van de bestandsnaam).
--  Vereist schema 55. Mag opnieuw uitgevoerd worden. Bestaande renders en presentaties blijven ongewijzigd werken.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 55 then
    raise exception 'Voer eerst de scripts tot en met 055 uit.';
  end if;
end $$;

-- ---------- 1. kolommen ----------
alter table public.render_beelden drop constraint if exists render_beelden_soort_check;
alter table public.render_beelden add constraint render_beelden_soort_check check (soort in ('ontwerp', 'sfeer', 'render', 'stalenbord'));
alter table public.render_beelden add column if not exists versie int;                                  -- stalenbord: 1, 2, 3 … per project + ruimte
alter table public.render_beelden add column if not exists geselecteerd boolean not null default false; -- stalenbord: deze versie gaat in de presentatie
create unique index if not exists render_beelden_stalenbord_keuze on public.render_beelden (project_id, lower(trim(ruimte))) where soort = 'stalenbord' and geselecteerd;

alter table public.render_opdrachten add column if not exists soort text not null default 'render';
alter table public.render_opdrachten drop constraint if exists render_opdrachten_soort;
alter table public.render_opdrachten add constraint render_opdrachten_soort check (soort in ('render', 'stalenbord'));
alter table public.render_opdrachten add column if not exists referentie_ids uuid[] not null default '{}';
alter table public.render_opdrachten add column if not exists basis_id uuid references public.render_beelden(id) on delete set null;
alter table public.render_opdrachten add column if not exists materialen jsonb not null default '[]'::jsonb;
alter table public.render_opdrachten add column if not exists legende boolean not null default true;
alter table public.render_opdrachten drop constraint if exists render_opdrachten_referenties;
alter table public.render_opdrachten add constraint render_opdrachten_referenties check (cardinality(referentie_ids) <= 6);

alter table public.render_presentaties add column if not exists stalenborden boolean not null default false;
alter table public.render_presentaties add column if not exists stalenbord_ids uuid[] not null default '{}';
alter table public.render_presentaties drop constraint if exists render_presentaties_stalenborden;
alter table public.render_presentaties add constraint render_presentaties_stalenborden check (cardinality(stalenbord_ids) <= 40);

-- een beeld verwijderen: ook niet als het referentie of basis is van een stalenbord dat wacht of loopt; stalenborden zelf nooit
-- (eerdere versies blijven bewaard)
drop policy if exists rb_weg on public.render_beelden;
create policy rb_weg on public.render_beelden for delete to authenticated using (public.is_intern() and (public.is_beheer() or created_by = auth.uid())
  and soort <> 'stalenbord'
  and not exists (select 1 from public.render_opdrachten o where (o.bron_id = render_beelden.id or render_beelden.id = any(o.sfeer_ids) or render_beelden.id = any(o.referentie_ids)
                                                                  or o.basis_id = render_beelden.id) and o.status in ('wachtrij', 'bezig')));

-- ---------- 2. een stalenbord aanvragen (betaald, zoals een render) ----------
-- p_referenties: 1–6 ontwerpen of renders van dit project (volgorde = belangrijkheid). p_materialen: de bevestigde lijst
-- ["Groen-wit gestreept behang: vlak bedrukt", …], 1–12 regels. p_basis: het vorige stalenbord bij een gerichte correctie
-- (dan zijn de aandachtspunten verplicht; ze komen in instructie, leeg = geen). Idempotent op (aanvrager, request_id), zoals render_aanvragen.
create or replace function public.render_stalenbord_aanvragen(p_project uuid, p_request_id text, p_ruimte text, p_referenties uuid[], p_materialen jsonb,
                                                              p_aandachtspunten text, p_basis uuid, p_legende boolean, p_kwaliteit text, p_model text, p_toestemming boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg jsonb := public.rd_instelling(); o public.render_opdrachten; bs public.render_beelden; dig text; v_ruimte text; vandaag date; n int;
        refs uuid[] := coalesce(p_referenties, '{}'); mat jsonb; afspr jsonb; punten text := trim(coalesce(p_aandachtspunten, ''));
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  if coalesce(p_request_id, '') !~ '^[0-9a-f]{32}$' then raise exception 'Ongeldig aanvraagnummer.'; end if;
  v_ruimte := left(trim(coalesce(p_ruimte, '')), 120);
  -- materiaallijst normaliseren: enkel niet-lege tekstregels
  if jsonb_typeof(coalesce(p_materialen, 'null'::jsonb)) <> 'array' then raise exception 'Geef de materialenlijst mee (één materiaal per regel).'; end if;
  select coalesce(jsonb_agg(to_jsonb(left(trim(x), 200)) order by i), '[]'::jsonb) into mat
  from jsonb_array_elements_text(p_materialen) with ordinality as e(x, i) where trim(x) <> '';
  dig := md5(jsonb_build_object('p', p_project, 'soort', 'stalenbord', 'r', v_ruimte, 'ref', to_jsonb(refs), 'm', mat, 'a', punten, 'b', p_basis,
                                'l', coalesce(p_legende, true), 'k', p_kwaliteit, 'model', p_model)::text);
  -- 1. dezelfde aanvraag al ontvangen? (ook na een netwerkfout: nooit een tweede betaalde opdracht)
  perform pg_advisory_xact_lock(hashtext('render_aanvraag:' || auth.uid()::text || ':' || p_request_id));
  select * into o from public.render_opdrachten where aangevraagd_door = auth.uid() and request_id = p_request_id;
  if o.id is not null then
    if o.digest <> dig then raise exception 'Deze aanvraag werd al verwerkt met andere instellingen. Start een nieuwe aanvraag.'; end if;
    return jsonb_build_object('opdracht', to_jsonb(o), 'hergebruikt', true);
  end if;
  -- 2. controles
  if p_toestemming is not true then raise exception 'Bevestig eerst de betaalde beeldgeneratie.'; end if;
  if not exists (select 1 from public.projecten where id = p_project) then raise exception 'Project niet gevonden.'; end if;
  if v_ruimte = '' or v_ruimte = '*' then raise exception 'Vul de ruimte in.'; end if;
  if jsonb_array_length(mat) = 0 then raise exception 'Vul minstens één materiaal in (één per regel).'; end if;
  if jsonb_array_length(mat) > 12 then raise exception 'Maximaal 12 materialen per stalenbord.'; end if;
  if length(punten) > 2000 then raise exception 'Aandachtspunten: max. 2000 tekens.'; end if;
  if p_kwaliteit not in ('low', 'medium', 'high') then raise exception 'Ongeldige kwaliteit.'; end if;
  if p_model is distinct from cfg->>'model' then raise exception 'Het beeldmodel werd intussen gewijzigd (nu %). Herlaad het Planbord en bevestig opnieuw.', cfg->>'model'; end if;
  if cardinality(refs) = 0 then raise exception 'Kies minstens één referentiebeeld van deze ruimte.'; end if;
  if cardinality(refs) > 6 or (select count(distinct x) from unnest(refs) x) <> cardinality(refs) then raise exception 'Kies maximaal zes verschillende referentiebeelden.'; end if;
  if exists (select 1 from unnest(refs) x where not exists (select 1 from public.render_beelden b where b.id = x and b.project_id = p_project and b.soort in ('ontwerp', 'render'))) then
    raise exception 'Kies als referentie enkel ontwerpen of renders van dit project.'; end if;
  if p_basis is not null then
    select * into bs from public.render_beelden where id = p_basis and project_id = p_project and soort = 'stalenbord';
    if bs.id is null then raise exception 'Het stalenbord dat je wilt corrigeren hoort niet bij dit project.'; end if;
    if punten = '' then raise exception 'Beschrijf wat er aan het stalenbord moet veranderen.'; end if;
  end if;
  -- 3. daglimiet (renders en stalenborden samen, hele team, per kalenderdag in België)
  perform pg_advisory_xact_lock(hashtext('render_daglimiet'));
  vandaag := (now() at time zone 'Europe/Brussels')::date;
  select count(*) into n from public.render_opdrachten where dag = vandaag and status <> 'geannuleerd';
  if n + 1 > (cfg->>'daglimiet')::int then raise exception 'Daglimiet bereikt (% beelden vandaag). Een beheerder kan die verhogen in Instellingen › Renders.', n; end if;
  -- 4. afspraken van deze ruimte en het hele project (kopie), zoals bij een render
  select coalesce(jsonb_agg(jsonb_build_object('ruimte', a.ruimte, 'tekst', a.tekst) order by a.ruimte, a.created_at), '[]'::jsonb) into afspr
  from public.render_afspraken a where a.project_id = p_project and (a.ruimte = '*' or lower(trim(a.ruimte)) = lower(v_ruimte));
  insert into public.render_opdrachten (project_id, soort, ruimte, instructie, bron_id, sfeer_ids, referentie_ids, basis_id, materialen, legende, afspraken,
                                        model, kwaliteit, lange_zijde, request_id, digest, dag)
  values (p_project, 'stalenbord', v_ruimte, punten, coalesce(p_basis, refs[1]), '{}', refs, p_basis, mat, coalesce(p_legende, true), afspr,
          cfg->>'model', p_kwaliteit, (cfg->>'lange_zijde')::int, p_request_id, dig, vandaag)
  returning * into o;
  return jsonb_build_object('opdracht', to_jsonb(o), 'hergebruikt', false);
end $$;

-- een stalenbordversie kiezen voor de presentatie (of de keuze intrekken). Per ruimte hoogstens één.
create or replace function public.render_stalenbord_kies(p_beeld uuid, p_aan boolean)
returns public.render_beelden language plpgsql security definer set search_path = public as $$
declare b public.render_beelden;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  select * into b from public.render_beelden where id = p_beeld and soort = 'stalenbord';
  if b.id is null then raise exception 'Stalenbord niet gevonden.'; end if;
  perform pg_advisory_xact_lock(hashtext('stalenbord:' || b.project_id::text || ':' || lower(trim(b.ruimte))));   -- eerst het slot per ruimte, dan de rij (geen deadlock)
  select * into b from public.render_beelden where id = p_beeld for update;
  if p_aan then
    update public.render_beelden set geselecteerd = false
    where project_id = b.project_id and soort = 'stalenbord' and lower(trim(ruimte)) = lower(trim(b.ruimte)) and geselecteerd and id <> b.id;
  end if;
  update public.render_beelden set geselecteerd = coalesce(p_aan, false) where id = b.id returning * into b;
  return b;
end $$;

-- een ontwerp of render aan een (andere) ruimte koppelen — kosteloos; een render neemt zijn opdracht mee
create or replace function public.render_beeld_ruimte(p_beeld uuid, p_ruimte text)
returns public.render_beelden language plpgsql security definer set search_path = public as $$
declare b public.render_beelden; v_ruimte text := left(trim(coalesce(p_ruimte, '')), 120);
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  if v_ruimte = '' or v_ruimte = '*' then raise exception 'Vul de ruimte in.'; end if;
  update public.render_beelden set ruimte = v_ruimte where id = p_beeld and soort in ('ontwerp', 'render') returning * into b;
  if b.id is null then raise exception 'Enkel een ontwerp of render kan aan een ruimte gekoppeld worden.'; end if;
  if b.soort = 'render' then
    update public.render_opdrachten set ruimte = v_ruimte where resultaat_id = b.id and soort = 'render';
  end if;
  return b;
end $$;

-- goedkeuren: renders en stalenborden (menselijke beoordeling; wijzigt geen afspraken)
create or replace function public.render_goedkeur(p_beeld uuid, p_goed boolean)
returns public.render_beelden language plpgsql security definer set search_path = public as $$
declare b public.render_beelden;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  update public.render_beelden set goedgekeurd_door = case when p_goed then auth.uid() end, goedgekeurd_op = case when p_goed then now() end
  where id = p_beeld and soort in ('render', 'stalenbord') returning * into b;
  if b.id is null then raise exception 'Render niet gevonden.'; end if;
  return b;
end $$;

-- ---------- 3. presentatie: optie "Stalenborden per ruimte opnemen" (nooit een beeldgeneratie) ----------
drop function if exists public.render_presentatie_maak(uuid, text, text, date, boolean, uuid[]);
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
  if exists (select 1 from unnest(p_render_ids) x where not exists (select 1 from public.render_beelden b where b.id = x and b.project_id = p_project and b.soort in ('render', 'ontwerp'))) then
    raise exception 'Kies enkel renders of ontwerpen van dit project.'; end if;
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

-- ---------- 4. verwerkingscomputer ----------
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
  -- een stalenbord enkel naar een verwerkingscomputer die stalenborden kent (1.60+): een oudere zou er een gewone render van
  -- maken (betaald en onbruikbaar). Tot de Mac mini bijgewerkt is, blijven stalenborden gewoon in de wachtrij.
  select * into o from public.render_opdrachten x where x.status = 'wachtrij'
    and (x.soort = 'render' or exists (select 1 from public.verwerker_status v where v.naam = left(p_naam, 60) and v.user_id = auth.uid() and v.info->>'stalenborden' = 'true'))
    order by x.created_at limit 1 for update skip locked;
  if o.id is null then return null; end if;
  update public.render_opdrachten set status = 'bezig', worker = left(p_naam, 60), worker_user = auth.uid(), claim = gen_random_uuid(), lease_tot = now() + interval '10 minutes',
         pogingen = pogingen + 1, gestart_op = coalesce(gestart_op, now()), stap = 'gestart', voortgang = 0, fout = '' where id = o.id returning * into o;
  update public.verwerker_status set huidige_job = o.id where naam = left(p_naam, 60);
  select * into p from public.projecten where id = o.project_id;
  select * into bron from public.render_beelden where id = o.bron_id;
  return jsonb_build_object(
    'job', jsonb_build_object('id', o.id, 'claim', o.claim, 'soort', 'render', 'poging', o.pogingen, 'max_pogingen', o.max_pogingen),
    'opdracht', jsonb_build_object('id', o.id, 'soort', o.soort, 'ruimte', o.ruimte, 'instructie', o.instructie, 'afspraken', o.afspraken, 'materialen', o.materialen,
                                   'legende', o.legende, 'model', o.model, 'kwaliteit', o.kwaliteit, 'lange_zijde', o.lange_zijde, 'api_verstuurd_op', o.api_verstuurd_op,
                                   'gebruiker', md5('bros-render:' || coalesce(o.aangevraagd_door::text, ''))),
    'bron', jsonb_build_object('id', bron.id, 'pad', bron.pad, 'mime', bron.mime, 'sha256', bron.sha256, 'soort', bron.soort, 'naam', bron.naam),
    'sfeer', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'pad', s.pad, 'mime', s.mime, 'sha256', s.sha256) order by array_position(o.sfeer_ids, s.id))
                       from public.render_beelden s where s.id = any(o.sfeer_ids)), '[]'::jsonb),
    'referenties', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'pad', s.pad, 'mime', s.mime, 'sha256', s.sha256, 'naam', s.naam, 'soort', s.soort) order by array_position(o.referentie_ids, s.id))
                             from public.render_beelden s where s.id = any(o.referentie_ids) and s.project_id = o.project_id), '[]'::jsonb),
    'basis', (select jsonb_build_object('id', s.id, 'pad', s.pad, 'mime', s.mime, 'sha256', s.sha256, 'versie', s.versie) from public.render_beelden s
              where s.id = o.basis_id and s.project_id = o.project_id and s.soort = 'stalenbord'),
    'project', jsonb_build_object('id', p.id, 'nummer', p.nummer, 'klant', p.klant, 'naam', p.naam, 'drive', coalesce(p.drive_folder_id, '') <> ''));
end $$;

-- resultaat: renders/<project>/render/<opdracht>.<ext> of renders/<project>/stalenbord/<opdracht>.<ext>
create or replace function public.render_klaar(p_job uuid, p_claim uuid, p_resultaat jsonb)
returns public.render_opdrachten language plpgsql security definer set search_path = public as $$
declare o public.render_opdrachten; b public.render_beelden; v int;
begin
  o := public.rd_eigen(p_job, p_claim);
  -- ook 'onzeker' (lease verlopen tijdens de betaalde aanvraag): het betaalde beeld mag niet verloren gaan
  if o.status not in ('bezig', 'onzeker') then raise exception 'Deze render loopt niet meer (status %).', o.status; end if;
  if coalesce(p_resultaat->>'pad', '') !~ ('^' || o.project_id::text || '/' || o.soort || '/' || o.id::text || '\.(png|jpg|webp)$') then raise exception 'Ongeldig pad voor de render.'; end if;
  if not public.rd_object_ok(p_resultaat->>'pad', (p_resultaat->>'grootte')::bigint) then raise exception 'De render staat niet volledig in de opslag.'; end if;
  if o.soort = 'stalenbord' then
    perform pg_advisory_xact_lock(hashtext('stalenbord:' || o.project_id::text || ':' || lower(trim(o.ruimte))));
    select versie into v from public.render_beelden where pad = p_resultaat->>'pad';   -- opnieuw gemeld: zelfde versie
    if v is null then
      select coalesce(max(versie), 0) + 1 into v from public.render_beelden where project_id = o.project_id and soort = 'stalenbord' and lower(trim(ruimte)) = lower(trim(o.ruimte));
    end if;
  end if;
  insert into public.render_beelden (project_id, soort, ruimte, naam, pad, mime, grootte, breedte, hoogte, sha256, opdracht_id, drive, created_by, versie)
  values (o.project_id, o.soort, o.ruimte, left(coalesce(p_resultaat->>'naam', o.soort), 200), p_resultaat->>'pad', coalesce(p_resultaat->>'mime', 'image/png'),
          (p_resultaat->>'grootte')::bigint, nullif(p_resultaat->>'breedte', '')::int, nullif(p_resultaat->>'hoogte', '')::int, coalesce(p_resultaat->>'sha256', ''), o.id,
          case when jsonb_typeof(p_resultaat->'drive') = 'object' then p_resultaat->'drive' end, o.aangevraagd_door, v)
  on conflict (pad) do update set drive = excluded.drive
  returning * into b;
  update public.render_opdrachten set status = 'klaar', resultaat_id = b.id, klaar_op = now(), lease_tot = null, stap = '', voortgang = 1, fout = left(coalesce(p_resultaat->>'melding', ''), 500),
         openai_request_id = left(coalesce(p_resultaat->>'openai_request_id', ''), 200), verbruik = case when jsonb_typeof(p_resultaat->'verbruik') = 'object' then p_resultaat->'verbruik' end
  where id = p_job returning * into o;
  update public.verwerker_status set huidige_job = null where user_id = auth.uid() and huidige_job = p_job;
  return o;
end $$;

create or replace function public.presentatie_claim(p_naam text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.render_presentaties; p public.projecten; r record;
begin
  if not public.is_verwerker() then raise exception 'Geen verwerkingscomputer.'; end if;
  for r in select * from public.render_presentaties where status = 'bezig' and lease_tot < now() for update skip locked loop
    update public.render_presentaties set status = case when r.pogingen >= r.max_pogingen then 'mislukt' else 'wachtrij' end, worker = null, worker_user = null, lease_tot = null,
           fout = case when r.pogingen >= r.max_pogingen then 'De presentatie werd ' || r.pogingen || ' keer onderbroken. Probeer opnieuw.' else 'Onderbroken — wordt hervat.' end where id = r.id;
  end loop;
  -- een presentatie met stalenborden enkel naar een verwerkingscomputer die het paginatype kent (1.60+)
  select * into o from public.render_presentaties x where x.status = 'wachtrij'
    and (cardinality(x.stalenbord_ids) = 0 or exists (select 1 from public.verwerker_status v where v.naam = left(p_naam, 60) and v.user_id = auth.uid() and v.info->>'stalenborden' = 'true'))
    order by x.created_at limit 1 for update skip locked;
  if o.id is null then return null; end if;
  update public.render_presentaties set status = 'bezig', worker = left(p_naam, 60), worker_user = auth.uid(), claim = gen_random_uuid(), lease_tot = now() + interval '10 minutes',
         pogingen = pogingen + 1, fout = '' where id = o.id returning * into o;
  select * into p from public.projecten where id = o.project_id;
  return jsonb_build_object(
    'job', jsonb_build_object('id', o.id, 'claim', o.claim, 'soort', 'presentatie', 'poging', o.pogingen),
    'presentatie', jsonb_build_object('id', o.id, 'klant', o.klant, 'versie', o.versie, 'datum', o.datum, 'liggend', o.liggend, 'stalenborden', o.stalenborden),
    'beelden', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'pad', b.pad, 'mime', b.mime, 'sha256', b.sha256, 'ruimte', b.ruimte) order by array_position(o.render_ids, b.id))
                         from public.render_beelden b where b.id = any(o.render_ids) and b.project_id = o.project_id), '[]'::jsonb),
    'stalenborden', case when o.stalenborden then coalesce((
        select jsonb_agg(jsonb_build_object('id', b.id, 'pad', b.pad, 'mime', b.mime, 'sha256', b.sha256, 'ruimte', b.ruimte, 'versie', b.versie,
                                            'legende', coalesce(x.legende, true), 'materialen', coalesce(x.materialen, '[]'::jsonb)) order by array_position(o.stalenbord_ids, b.id))
        from public.render_beelden b left join public.render_opdrachten x on x.id = b.opdracht_id
        where b.id = any(o.stalenbord_ids) and b.project_id = o.project_id and b.soort = 'stalenbord'), '[]'::jsonb) else '[]'::jsonb end,
    'project', jsonb_build_object('id', p.id, 'nummer', p.nummer, 'klant', p.klant, 'naam', p.naam, 'drive', coalesce(p.drive_folder_id, '') <> ''));
end $$;

-- ---------- 5. opslag: de verwerkingscomputer schrijft enkel het bestand van de opdracht die hij nu verwerkt ----------
-- render/<opdracht>.<ext>, stalenbord/<opdracht>.<ext> of presentatie/<presentatie>-<n>.pdf (strenger dan 055: niet meer elk pad van het project)
create or replace function public.rd_job_pad_ok(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_verwerker() and split_part(coalesce(p_name, ''), '/', 4) = '' and (
    (split_part(p_name, '/', 2) in ('render', 'stalenbord') and exists (
       select 1 from public.render_opdrachten o where o.project_id = public.rd_pad_project(p_name) and o.soort = split_part(p_name, '/', 2) and o.status = 'bezig'
         and o.worker_user = auth.uid() and o.lease_tot > now() and split_part(p_name, '/', 3) ~ ('^' || o.id::text || '\.(png|jpg|webp)$')))
    or (split_part(p_name, '/', 2) = 'presentatie' and exists (
       select 1 from public.render_presentaties o where o.project_id = public.rd_pad_project(p_name) and o.status = 'bezig'
         and o.worker_user = auth.uid() and o.lease_tot > now() and split_part(p_name, '/', 3) ~ ('^' || o.id::text || '-[0-9]{1,3}\.pdf$'))))
$$;
revoke all on function public.rd_job_pad_ok(text) from public, anon;
grant execute on function public.rd_job_pad_ok(text) to authenticated;   -- nodig voor de opslagregel

-- een render mag nooit vertrekken van een stalenbord (ook niet vanuit een oudere 1.59-pagina): enkel een ontwerp of render als bron
create or replace function public.rd_bron_controle()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.soort, 'render') = 'render' and exists (select 1 from public.render_beelden b where b.id = new.bron_id and b.soort = 'stalenbord') then
    raise exception 'Een stalenbord is geen ontwerp. Gebruik Corrigeren… bij het stalenbord zelf.';
  end if;
  return new;
end $$;
drop trigger if exists render_opdrachten_bron on public.render_opdrachten;
create trigger render_opdrachten_bron before insert on public.render_opdrachten for each row execute function public.rd_bron_controle();

do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    execute 'drop policy if exists renders_insert on storage.objects';
    execute $p$create policy renders_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'renders' and split_part(name, '/', 4) = '' and (
        (split_part(name, '/', 2) in ('ontwerp', 'sfeer') and public.rd_project_ok(public.rd_pad_project(name)))
        or (split_part(name, '/', 2) in ('render', 'stalenbord', 'presentatie') and public.rd_job_pad_ok(name))))$p$;
  end if;
end $$;

-- ---------- rechten ----------
do $$ declare f text; begin
  foreach f in array array['render_stalenbord_aanvragen(uuid, text, text, uuid[], jsonb, text, uuid, boolean, text, text, boolean)', 'render_stalenbord_kies(uuid, boolean)',
                           'render_beeld_ruimte(uuid, text)', 'render_goedkeur(uuid, boolean)', 'render_presentatie_maak(uuid, text, text, date, boolean, uuid[], boolean)',
                           'render_claim(text)', 'render_klaar(uuid, uuid, jsonb)', 'presentatie_claim(text)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';   -- de functies controleren zelf de rol
  end loop;
end $$;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(56, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: moet 3 | 2 | 1 | 56 teruggeven (nieuwe opdrachtkolommen, nieuwe beeldkolommen, presentatie-optie, schemaversie).
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'render_opdrachten' and column_name in ('soort', 'referentie_ids', 'materialen'))::int as opdrachten,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'render_beelden' and column_name in ('versie', 'geselecteerd'))::int as beelden,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'render_presentaties' and column_name = 'stalenborden')::int as presentatie,
       (select (value->>'versie_schema')::int from public.instellingen where key = 'app') as schema;
