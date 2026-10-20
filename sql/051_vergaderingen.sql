-- =====================================================================
--  BROS Planbord — databasescript 051: Vergaderingen & opnames (v1.54)
--  Per project (ook het interne project 'BROS — Interne werking') vergaderingen met een opname, die de
--  verwerkingscomputer (Mac mini) op de achtergrond verwerkt: transcriptie (lokaal) → conceptverslag (cloud-API,
--  optioneel) → menselijke controle → bevestigde taken. Alle AI-resultaten zijn concepten tot iemand ze controleert.
--
--  - vergaderingen: onderwerp, datum, deelnemers, controleur, opname, status, bewerkbaar conceptverslag, controle, klantdeling.
--  - vergadering_uitvoer: elke AI-uitvoer (transcript + eerste verslag), onveranderlijk: de eerste uitvoer blijft altijd bewaard.
--  - vergadering_punten: beslissingen, open vragen, actiepunten, mogelijk meerwerk en kritieke gegevens, elk met bron
--    (tijdsaanduiding + citaat). Bevestigen / corrigeren / afwijzen / toevoegen; de oorspronkelijke AI-versie blijft bewaard.
--  - vergadering_feedback: logboek van elke beoordeling en correctie (voor de evaluatie van de proefperiode).
--  - verwerkingen: de beveiligde wachtrij voor de verwerkingscomputer (claimen met lease, hervatten, max. 3 pogingen).
--  - verwerker_status: hartslag van de verwerkingscomputer (zichtbaar signaal als hij niet bereikbaar is).
--  - nieuwe rol 'verwerker': de login van de verwerkingscomputer. Ziet niets behalve wat de functies hieronder geven.
--  - opslag 'opnames' (privé): uploads (in delen van max. 20 MB) en een kleine afspeelkopie. Het origineel gaat naar de
--    projectmap op Google Drive (map Vergaderingen) en wordt pas daarna uit de opslag gehaald — nooit de enige kopie.
--  - taken: link naar vergadering, punt en bronfragment (bron_sec).
--  - projecten.intern: het bestaande interne project 'BROS' wordt gemarkeerd (zelfde id, taken en historiek).
--  - Toegang: beheer + de leden van de vergadering (wie ze aanmaakte, de controleur, de deelnemers van BROS) + de projectlead;
--    het interne project: het hele team. Wie toegang nodig heeft, voeg je toe als deelnemer. De projectlead en het interne
--    project kan enkel beheer wijzigen. Klanten zien niets, behalve een gecontroleerd verslag dat iemand expliciet deelt.
--  Vereist schema 50. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 50 then
    raise exception 'Voer eerst de scripts tot en met 050 uit.';
  end if;
end $$;

-- ---------- 1. rol 'verwerker' ----------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('beheer', 'medewerker', 'klant', 'aannemer', 'verwerker'));
create or replace function public.is_verwerker()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'verwerker' and active from public.profiles where id = auth.uid()), false)
$$;
-- een nieuwe login (Supabase › Authentication › Add user) omzetten naar de login van de verwerkingscomputer (enkel beheer)
create or replace function public.verwerker_instellen(p_email text)
returns text language plpgsql security definer set search_path = public as $$
declare pr public.profiles;
begin
  if not public.is_beheer() then raise exception 'Enkel een beheerder kan de verwerkingscomputer koppelen.'; end if;
  select * into pr from public.profiles where lower(email) = lower(trim(coalesce(p_email, ''))) limit 1;
  if pr.id is null then raise exception 'Geen login gevonden met dit e-mailadres. Maak hem eerst aan in Supabase › Authentication › Add user.'; end if;
  if pr.id = auth.uid() then raise exception 'Je eigen login kan niet de verwerkingscomputer worden.'; end if;
  if pr.role = 'verwerker' then update public.profiles set active = true where id = pr.id; return pr.email || ' is al de login van de verwerkingscomputer.'; end if;
  if pr.role <> 'medewerker' or pr.active then raise exception 'Deze login is al in gebruik (rol %, %). Maak een aparte login aan voor de verwerkingscomputer.', pr.role, case when pr.active then 'actief' else 'niet actief' end; end if;
  if exists (select 1 from public.taken where assignee = pr.id) or exists (select 1 from public.uren where user_id = pr.id) then
    raise exception 'Deze login heeft al taken of uren. Maak een aparte login aan voor de verwerkingscomputer.';
  end if;
  update public.profiles set role = 'verwerker', active = true, name = case when name = '' or name = initcap(split_part(email, '@', 1)) then 'Verwerkingscomputer' else name end where id = pr.id;
  delete from public.tarieven where user_id = pr.id;
  return pr.email || ' is nu de login van de verwerkingscomputer.';
end $$;

-- ---------- 2. het interne project ----------
alter table public.projecten add column if not exists intern boolean not null default false;
create unique index if not exists projecten_een_intern on public.projecten ((true)) where intern;   -- er is maar één intern project
-- het interne project en de projectlead (die geven toegang tot de vergaderingen) wijzigt enkel beheer
create or replace function public.projecten_intern_vast()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_beheer() then
    if (case when tg_op = 'INSERT' then new.intern else new.intern is distinct from old.intern end) then
      raise exception 'Enkel een beheerder kan het interne project aanduiden.';
    end if;
    if tg_op = 'UPDATE' and new.lead is distinct from old.lead then
      raise exception 'Enkel een beheerder kan de projectlead wijzigen.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists projecten_intern_vast on public.projecten;
create trigger projecten_intern_vast before insert or update of intern, lead on public.projecten for each row execute function public.projecten_intern_vast();
do $$ declare n int; begin
  if not exists (select 1 from public.projecten where intern) then
    select count(*) into n from public.projecten where lower(trim(klant)) = 'bros';
    if n = 1 then update public.projecten set intern = true where lower(trim(klant)) = 'bros'; end if;   -- zelfde rij: id, nummer, taken en historiek blijven
  end if;
end $$;

-- ---------- 3. tabellen ----------
create table if not exists public.vergaderingen (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projecten(id) on delete cascade,
  onderwerp           text not null check (length(trim(onderwerp)) > 0),
  datum               date not null default current_date,
  tijd                time,
  deelnemers          jsonb not null default '[]'::jsonb,    -- [{ "soort": "team", "id": … } | { "soort": "contact", "id": … } | { "soort": "vrij", "naam": … }]
  deelnemer_ids       uuid[] not null default '{}',          -- de teamleden uit deelnemers (bijgehouden door een trigger, voor de toegang)
  controleur          uuid references public.profiles(id) on delete set null,
  agenda              jsonb not null default '[]'::jsonb,    -- punten om te bespreken (o.a. uit een vorige vergadering)
  vorige_id           uuid references public.vergaderingen(id) on delete set null,
  status              text not null default 'concept' check (status in ('concept', 'wachtrij', 'verwerking', 'controle', 'gecontroleerd', 'mislukt')),
  opname              jsonb,                                 -- naam, mime, grootte, delen [{pad, grootte, sha256}], duur_sec, toestemming, geupload_op/door
  afspeel_pad         text,                                  -- kleine afspeelkopie in opslag 'opnames'
  afspeel_grootte     bigint,
  drive_file_id       text,                                  -- het origineel in de projectmap (Vergaderingen/…)
  drive_url           text,
  drive_map_url       text,
  drive_md5           text,                                  -- gecontroleerd tegen de opname: pas dan mogen de uploaddelen weg
  inbox_leeg          boolean not null default false,
  huidige_uitvoer     uuid,
  verslag             jsonb not null default '{}'::jsonb,    -- bewerkbaar conceptverslag { samenvatting, onderwerpen: [{ titel, tekst, segmenten }] }
  verslag_bewerkt_op  timestamptz,
  verslag_bewerkt_door uuid references public.profiles(id) on delete set null,
  interne_notitie     text not null default '',
  gecontroleerd_door  uuid references public.profiles(id) on delete set null,
  gecontroleerd_op    timestamptz,
  verslag_gecontroleerd jsonb,                               -- vaste kopie op het moment van de controle
  klant_verslag       jsonb,                                 -- wat expliciet met de klant gedeeld is (enkel na controle)
  klant_gedeeld_op    timestamptz,
  klant_gedeeld_door  uuid references public.profiles(id) on delete set null,
  fout                text not null default '',
  created_by          uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint vergaderingen_deelnemers check (jsonb_typeof(deelnemers) = 'array'),
  constraint vergaderingen_agenda check (jsonb_typeof(agenda) = 'array'),
  constraint vergaderingen_verslag check (jsonb_typeof(verslag) = 'object')
);
create index if not exists vergaderingen_project_idx on public.vergaderingen(project_id, datum desc);

create table if not exists public.verwerkingen (
  id                uuid primary key default gen_random_uuid(),
  vergadering_id    uuid not null references public.vergaderingen(id) on delete cascade,
  soort             text not null default 'volledig' check (soort in ('volledig', 'verslag')),   -- verslag = enkel het conceptverslag opnieuw (zelfde transcript)
  status            text not null default 'wachtrij' check (status in ('wachtrij', 'bezig', 'klaar', 'mislukt', 'geannuleerd')),
  pogingen          int not null default 0,
  max_pogingen      int not null default 3,
  beschikbaar_vanaf timestamptz not null default now(),
  worker            text,
  worker_user       uuid,
  lease_tot         timestamptz,
  stap              text not null default '',
  voortgang         numeric(5,4) not null default 0,
  fout              text not null default '',
  fout_detail       text not null default '',
  metingen          jsonb,
  aangevraagd_door  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  gestart_op        timestamptz,
  klaar_op          timestamptz
);
create unique index if not exists verwerkingen_een_actief on public.verwerkingen(vergadering_id) where status in ('wachtrij', 'bezig');   -- nooit dubbel verwerken
create index if not exists verwerkingen_wachtrij_idx on public.verwerkingen(status, beschikbaar_vanaf, created_at);

create table if not exists public.vergadering_uitvoer (
  id              uuid primary key default gen_random_uuid(),
  vergadering_id  uuid not null references public.vergaderingen(id) on delete cascade,
  job_id          uuid unique references public.verwerkingen(id) on delete set null,
  versie          int not null,
  soort           text not null default 'volledig',
  transcript      jsonb not null default '[]'::jsonb,   -- [{ i, s, e, t, p, onduidelijk, reden }] (seconden)
  verslag         jsonb,                                -- eerste AI-concept van deze uitvoer (zoals de API het gaf, na controle op vorm)
  controles       jsonb,                                -- de automatische controles (getallen, voorwaarden, ontkenningen, citaten …)
  modellen        jsonb,                                -- welk transcriptiemodel / taalmodel, met instellingen
  metingen        jsonb,                                -- verwerkingstijd per stap, geheugen, schijfruimte, tokens
  waarschuwing    text not null default '',
  created_at      timestamptz not null default now(),
  unique (vergadering_id, versie)
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'vergaderingen_huidige_uitvoer_fkey') then
    alter table public.vergaderingen add constraint vergaderingen_huidige_uitvoer_fkey foreign key (huidige_uitvoer) references public.vergadering_uitvoer(id) on delete set null;
  end if;
end $$;

create table if not exists public.vergadering_punten (
  id                      uuid primary key default gen_random_uuid(),
  vergadering_id          uuid not null references public.vergaderingen(id) on delete cascade,
  uitvoer_id              uuid references public.vergadering_uitvoer(id) on delete set null,   -- leeg = door iemand toegevoegd
  soort                   text not null check (soort in ('beslissing', 'vraag', 'actie', 'meerwerk', 'gegeven')),
  tekst                   text not null default '',
  aard                    text check (aard in ('besloten', 'voorgesteld', 'besproken')),
  voorwaarden             text not null default '',
  citaat                  text not null default '',
  bron_start              numeric(10,2),
  bron_eind               numeric(10,2),
  segmenten               int[] not null default '{}',
  waarschuwingen          text[] not null default '{}',
  kritiek                 boolean not null default false,      -- moet expliciet gecontroleerd worden
  gegeven_soort           text not null default '',            -- bedrag, maat, naam, materiaal, datum, hoeveelheid, andere
  verantwoordelijke_tekst text not null default '',            -- zoals in de opname genoemd
  verantwoordelijke       uuid references public.profiles(id) on delete set null,
  deadline                date,
  deadline_tekst          text not null default '',
  status                  text not null default 'voorstel' check (status in ('voorstel', 'bevestigd', 'gecorrigeerd', 'afgewezen')),
  reden                   text not null default '',
  beoordeeld_door         uuid references public.profiles(id) on delete set null,
  beoordeeld_op           timestamptz,
  origineel               jsonb not null default '{}'::jsonb,  -- de AI-versie (of de eerste versie) — wijzigt nooit
  taak_id                 uuid references public.taken(id) on delete set null,
  taak_koppeling          text check (taak_koppeling in ('nieuw', 'bestaand')),
  sleutel                 text not null default '',
  vervangt                uuid references public.vergadering_punten(id) on delete set null,
  verborgen               boolean not null default false,      -- vervangen door een latere verwerking (blijft bewaard)
  volgorde                int not null default 0,
  toegevoegd_door         uuid references public.profiles(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists vergadering_punten_vg_idx on public.vergadering_punten(vergadering_id, soort, volgorde);
create index if not exists vergadering_punten_taak_idx on public.vergadering_punten(taak_id) where taak_id is not null;

create table if not exists public.vergadering_feedback (
  id              bigint generated always as identity primary key,
  vergadering_id  uuid not null references public.vergaderingen(id) on delete cascade,
  punt_id         uuid references public.vergadering_punten(id) on delete set null,
  actie           text not null,
  voor            jsonb,
  na              jsonb,
  door            uuid default auth.uid(),
  op              timestamptz not null default now()
);
create index if not exists vergadering_feedback_vg_idx on public.vergadering_feedback(vergadering_id, op);

create table if not exists public.verwerker_status (
  naam          text primary key,
  user_id       uuid,
  laatst_gezien timestamptz not null default now(),
  versie        text not null default '',
  info          jsonb not null default '{}'::jsonb,
  huidige_job   uuid
);

alter table public.taken
  add column if not exists vergadering_id   uuid references public.vergaderingen(id) on delete set null,
  add column if not exists vergader_punt_id uuid references public.vergadering_punten(id) on delete set null,
  add column if not exists bron_sec         numeric(10,2);
alter table public.vergaderingen add column if not exists vorige_opnames jsonb not null default '[]'::jsonb;   -- een vervangen opname (na 'mislukt') blijft traceerbaar; niets wordt automatisch weggegooid
alter table public.verwerkingen add column if not exists claim uuid;   -- per claim nieuw: een oud (vastgelopen) proces kan een opnieuw geclaimde opdracht niet meer aanraken

drop trigger if exists vergaderingen_touch on public.vergaderingen;
create trigger vergaderingen_touch before update on public.vergaderingen for each row execute function public.touch_updated_at();
drop trigger if exists vergadering_punten_touch on public.vergadering_punten;
create trigger vergadering_punten_touch before update on public.vergadering_punten for each row execute function public.touch_updated_at();

-- ---------- 4. toegang ----------
-- projectlid: het interne project (heel het team) of de projectlead (beide enkel door beheer te wijzigen)
create or replace function public.vg_project_lid(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projecten p where p.id = p_project and (p.intern or p.lead = auth.uid()))
$$;
-- op de kolommen van de rij zelf (zodat ook een net aangemaakte vergadering meteen leesbaar is)
create or replace function public.vg_rij_toegang(p_project uuid, p_created_by uuid, p_controleur uuid, p_deelnemers uuid[])
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_beheer() or (public.is_intern() and (p_created_by = auth.uid() or p_controleur = auth.uid() or auth.uid() = any (coalesce(p_deelnemers, '{}')) or public.vg_project_lid(p_project)))
$$;
create or replace function public.vg_toegang(p_vid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select public.vg_rij_toegang(v.project_id, v.created_by, v.controleur, v.deelnemer_ids) from public.vergaderingen v where v.id = p_vid), false)
$$;
-- uit een opslagpad '<vergadering>/…' de vergadering halen (ongeldig pad → null, dus geen toegang)
create or replace function public.vg_pad(p_name text)
returns uuid language sql immutable set search_path = public as $$
  select case when split_part(coalesce(p_name, ''), '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(p_name, '/', 1)::uuid end
$$;
-- heeft de ingelogde verwerkingscomputer een lopende opdracht voor deze vergadering?
create or replace function public.vg_actieve_job(p_vid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_verwerker() and exists (select 1 from public.verwerkingen j where j.vergadering_id = p_vid and j.status = 'bezig' and j.worker_user = auth.uid() and j.lease_tot > now())
$$;
-- (voor de opslagregels, die met de rechten van de gebruiker lopen)
create or replace function public.vg_status(p_vid uuid)
returns text language sql stable security definer set search_path = public as $$
  select status from public.vergaderingen where id = p_vid and (public.vg_toegang(p_vid) or public.vg_actieve_job(p_vid)) $$;
create or replace function public.vg_drive_ok(p_vid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select drive_md5 is not null from public.vergaderingen where id = p_vid and public.vg_actieve_job(p_vid)), false) $$;
-- mag de ingelogde gebruiker het verslag afronden (controleren, heropenen, delen)?
create or replace function public.vg_controleur(p_vid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_beheer() or (public.is_intern() and exists (select 1 from public.vergaderingen v where v.id = p_vid and v.controleur = auth.uid()))
$$;

alter table public.vergaderingen enable row level security;
alter table public.verwerkingen enable row level security;
alter table public.vergadering_uitvoer enable row level security;
alter table public.vergadering_punten enable row level security;
alter table public.vergadering_feedback enable row level security;
alter table public.verwerker_status enable row level security;
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' and tablename in ('vergaderingen', 'verwerkingen', 'vergadering_uitvoer', 'vergadering_punten', 'vergadering_feedback', 'verwerker_status') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;
create policy vg_lezen on public.vergaderingen for select to authenticated using (public.vg_rij_toegang(project_id, created_by, controleur, deelnemer_ids));
create policy vg_maken on public.vergaderingen for insert to authenticated with check (public.is_intern() and created_by = auth.uid() and status = 'concept');
create policy vg_wijzigen on public.vergaderingen for update to authenticated using (public.vg_rij_toegang(project_id, created_by, controleur, deelnemer_ids)) with check (public.vg_rij_toegang(project_id, created_by, controleur, deelnemer_ids));
create policy vg_weg on public.vergaderingen for delete to authenticated using (public.vg_rij_toegang(project_id, created_by, controleur, deelnemer_ids) and status = 'concept' and opname is null and (public.is_beheer() or created_by = auth.uid()));
create policy vw_lezen on public.verwerkingen for select to authenticated using (public.vg_toegang(vergadering_id));
create policy vu_lezen on public.vergadering_uitvoer for select to authenticated using (public.vg_toegang(vergadering_id));
create policy vp_lezen on public.vergadering_punten for select to authenticated using (public.vg_toegang(vergadering_id));
create policy vp_maken on public.vergadering_punten for insert to authenticated with check (public.vg_toegang(vergadering_id) and uitvoer_id is null and toegevoegd_door = auth.uid());
create policy vp_wijzigen on public.vergadering_punten for update to authenticated using (public.vg_toegang(vergadering_id)) with check (public.vg_toegang(vergadering_id));
create policy vp_weg on public.vergadering_punten for delete to authenticated using (public.vg_toegang(vergadering_id) and uitvoer_id is null and taak_id is null and (toegevoegd_door = auth.uid() or public.is_beheer()));
create policy vf_lezen on public.vergadering_feedback for select to authenticated using (public.vg_toegang(vergadering_id));
create policy vs_lezen on public.verwerker_status for select to authenticated using (public.is_intern());
-- (verwerkingen, uitvoer, feedback en verwerker_status: schrijven enkel via de functies hieronder)

-- ---------- 5. bewaking ----------
-- deelnemer_ids volgen de deelnemers
create or replace function public.vg_deelnemer_ids()
returns trigger language plpgsql set search_path = public as $$
begin
  new.deelnemer_ids := coalesce((select array_agg(distinct (d->>'id')::uuid) from jsonb_array_elements(new.deelnemers) d
                                 where d->>'soort' = 'team' and (d->>'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'), '{}');
  return new;
end $$;
drop trigger if exists vergaderingen_deelnemers on public.vergaderingen;
create trigger vergaderingen_deelnemers before insert or update on public.vergaderingen for each row execute function public.vg_deelnemer_ids();   -- altijd: deelnemer_ids kan niemand rechtstreeks zetten

-- met een gewone login (app/API) enkel de gewone velden; status, opname, controle en klantdeling enkel via de functies
create or replace function public.vg_bewaking()
returns trigger language plpgsql set search_path = public as $$
declare app boolean := current_user in ('authenticated', 'anon');
begin
  if not app then return new; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'concept' or new.opname is not null or new.vorige_opnames <> '[]'::jsonb or new.afspeel_pad is not null or new.drive_file_id is not null or new.huidige_uitvoer is not null
       or new.gecontroleerd_op is not null or new.verslag_gecontroleerd is not null or new.klant_verslag is not null or new.klant_gedeeld_op is not null or new.inbox_leeg then
      raise exception 'Een nieuwe vergadering begint altijd zonder opname of verslag.';
    end if;
    new.verslag_bewerkt_op := null; new.verslag_bewerkt_door := null; new.gecontroleerd_door := null; new.klant_gedeeld_door := null; new.fout := '';
    return new;
  end if;
  if (new.project_id, new.status, new.opname, new.afspeel_pad, new.afspeel_grootte, new.drive_file_id, new.drive_url, new.drive_map_url, new.drive_md5, new.inbox_leeg, new.huidige_uitvoer,
      new.gecontroleerd_door, new.gecontroleerd_op, new.verslag_gecontroleerd, new.klant_verslag, new.klant_gedeeld_op, new.klant_gedeeld_door, new.fout, new.created_by, new.created_at)
     is distinct from
     (old.project_id, old.status, old.opname, old.afspeel_pad, old.afspeel_grootte, old.drive_file_id, old.drive_url, old.drive_map_url, old.drive_md5, old.inbox_leeg, old.huidige_uitvoer,
      old.gecontroleerd_door, old.gecontroleerd_op, old.verslag_gecontroleerd, old.klant_verslag, old.klant_gedeeld_op, old.klant_gedeeld_door, old.fout, old.created_by, old.created_at) then
    raise exception 'Status, opname, controle en klantdeling wijzigen enkel via de knoppen in het Planbord.';
  end if;
  if new.controleur is distinct from old.controleur and not (public.is_beheer() or old.created_by = auth.uid()
     or exists (select 1 from public.projecten p where p.id = old.project_id and p.lead = auth.uid())) then
    raise exception 'De controleur kiest enkel een beheerder, wie de vergadering aanmaakte of de projectlead.';
  end if;
  if new.vorige_opnames is distinct from old.vorige_opnames then raise exception 'Vorige opnames wijzigen enkel via het Planbord.'; end if;
  if old.status = 'gecontroleerd' and (new.verslag, new.onderwerp, new.datum, new.deelnemers, new.controleur) is distinct from (old.verslag, old.onderwerp, old.datum, old.deelnemers, old.controleur) then
    raise exception 'Dit verslag is gecontroleerd. Heropen het eerst om iets te wijzigen.';
  end if;
  if new.verslag is distinct from old.verslag then new.verslag_bewerkt_op := now(); new.verslag_bewerkt_door := auth.uid();
  else new.verslag_bewerkt_op := old.verslag_bewerkt_op; new.verslag_bewerkt_door := old.verslag_bewerkt_door; end if;
  return new;
end $$;
drop trigger if exists vergaderingen_bewaking on public.vergaderingen;
create trigger vergaderingen_bewaking before insert or update on public.vergaderingen for each row execute function public.vg_bewaking();

-- punten: de AI-versie (origineel), de bron en de taakkoppeling liggen vast; beoordelen zet wie en wanneer
create or replace function public.vp_bewaking()
returns trigger language plpgsql set search_path = public as $$
declare app boolean := current_user in ('authenticated', 'anon'); v_status text;
begin
  if not app then return coalesce(new, old); end if;
  select status into v_status from public.vergaderingen where id = coalesce(new.vergadering_id, old.vergadering_id);
  if v_status is null then return coalesce(new, old); end if;   -- opgeruimd samen met de vergadering of het project
  -- een taak die uit dit punt kwam, werd verwijderd in de takenlijst: de koppeling valt weg (dat mag altijd)
  if tg_op = 'UPDATE' and old.taak_id is not null and new.taak_id is null and not exists (select 1 from public.taken where id = old.taak_id) then return new; end if;
  if v_status = 'gecontroleerd' then raise exception 'Dit verslag is gecontroleerd. Heropen het eerst om iets te wijzigen.'; end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'INSERT' then
    if new.uitvoer_id is not null or new.taak_id is not null or new.vervangt is not null or new.verborgen then raise exception 'Ongeldig nieuw punt.'; end if;
    new.status := case when new.status = 'afgewezen' then 'afgewezen' else 'bevestigd' end;   -- wat je zelf toevoegt, is door jou bevestigd
    new.toegevoegd_door := auth.uid(); new.beoordeeld_door := auth.uid(); new.beoordeeld_op := now(); new.taak_koppeling := null;
    new.origineel := jsonb_build_object('tekst', new.tekst, 'aard', new.aard, 'voorwaarden', new.voorwaarden, 'bron_start', new.bron_start, 'handmatig', true);
    return new;
  end if;
  if (new.vergadering_id, new.uitvoer_id, new.origineel, new.taak_id, new.taak_koppeling, new.sleutel, new.vervangt, new.verborgen, new.toegevoegd_door, new.created_at, new.citaat, new.segmenten)
     is distinct from (old.vergadering_id, old.uitvoer_id, old.origineel, old.taak_id, old.taak_koppeling, old.sleutel, old.vervangt, old.verborgen, old.toegevoegd_door, old.created_at, old.citaat, old.segmenten) then
    raise exception 'De bron, de AI-versie en de taakkoppeling van een punt liggen vast.';
  end if;
  if old.taak_id is not null and new.status in ('voorstel', 'afgewezen') then
    raise exception 'Dit punt is al een taak. Pas de taak zelf aan in de takenlijst.';
  end if;
  if new.status is distinct from old.status or (new.status <> 'voorstel' and (new.tekst, new.aard, new.voorwaarden, new.verantwoordelijke, new.deadline, new.reden) is distinct from (old.tekst, old.aard, old.voorwaarden, old.verantwoordelijke, old.deadline, old.reden)) then
    new.beoordeeld_door := auth.uid(); new.beoordeeld_op := now();
  else new.beoordeeld_door := old.beoordeeld_door; new.beoordeeld_op := old.beoordeeld_op; end if;
  return new;
end $$;
drop trigger if exists vergadering_punten_bewaking on public.vergadering_punten;
create trigger vergadering_punten_bewaking before insert or update or delete on public.vergadering_punten for each row execute function public.vp_bewaking();

-- uitvoer wijzigt nooit (ook niet via de API); enkel samen met de vergadering verwijderd
create or replace function public.vu_vast()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then raise exception 'Een AI-uitvoer wordt nooit gewijzigd (de oorspronkelijke versie blijft bewaard).'; end if;
  if current_user in ('authenticated', 'anon') and pg_trigger_depth() = 1 then raise exception 'Een AI-uitvoer wordt niet verwijderd.'; end if;
  return old;   -- (enkel samen met de vergadering of het project)
end $$;
drop trigger if exists vergadering_uitvoer_vast on public.vergadering_uitvoer;
create trigger vergadering_uitvoer_vast before update or delete on public.vergadering_uitvoer for each row execute function public.vu_vast();

-- logboek: elke beoordeling, correctie en toevoeging (voor de evaluatie van de proefperiode)
create or replace function public.vp_logboek()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_voor jsonb; v_na jsonb; v_actie text;
begin
  if not exists (select 1 from public.vergaderingen where id = new.vergadering_id) then return new; end if;   -- (de vergadering of het project wordt verwijderd)
  v_na := jsonb_build_object('status', new.status, 'tekst', new.tekst, 'aard', new.aard, 'voorwaarden', new.voorwaarden, 'verantwoordelijke', new.verantwoordelijke, 'deadline', new.deadline, 'reden', new.reden, 'taak_id', new.taak_id);
  if tg_op = 'INSERT' then
    if new.uitvoer_id is not null then return new; end if;   -- AI-punten: de uitvoer zelf is het bewijs
    insert into public.vergadering_feedback (vergadering_id, punt_id, actie, na, door) values (new.vergadering_id, new.id, 'toegevoegd', v_na || jsonb_build_object('soort', new.soort), auth.uid());
    return new;
  end if;
  v_voor := jsonb_build_object('status', old.status, 'tekst', old.tekst, 'aard', old.aard, 'voorwaarden', old.voorwaarden, 'verantwoordelijke', old.verantwoordelijke, 'deadline', old.deadline, 'reden', old.reden, 'taak_id', old.taak_id);
  if v_voor = v_na and new.verborgen = old.verborgen then return new; end if;
  v_actie := case when new.verborgen and not old.verborgen then 'vervangen'
                  when new.taak_id is distinct from old.taak_id then 'taak'
                  when new.status is distinct from old.status then new.status
                  else 'aangepast' end;
  insert into public.vergadering_feedback (vergadering_id, punt_id, actie, voor, na, door) values (new.vergadering_id, new.id, v_actie, v_voor, v_na, auth.uid());
  return new;
end $$;
drop trigger if exists vergadering_punten_logboek on public.vergadering_punten;
create trigger vergadering_punten_logboek after insert or update on public.vergadering_punten for each row execute function public.vp_logboek();

create or replace function public.vg_logboek()
returns trigger language plpgsql security definer set search_path = public as $$
declare f public.vergadering_feedback;
begin
  if new.verslag is not distinct from old.verslag or auth.uid() is null or public.is_verwerker() then return new; end if;   -- (de verwerkingscomputer: de uitvoer zelf is het bewijs)
  -- één regel per bewerkingsbeurt (10 minuten, zelfde persoon): de 'voor' van de eerste wijziging en de laatste 'na'
  select * into f from public.vergadering_feedback where vergadering_id = new.id and actie = 'verslag_bewerkt' and door = auth.uid() and op > now() - interval '10 minutes' order by op desc limit 1;
  if f.id is not null then update public.vergadering_feedback set na = new.verslag, op = now() where id = f.id;
  else insert into public.vergadering_feedback (vergadering_id, actie, voor, na, door) values (new.id, 'verslag_bewerkt', old.verslag, new.verslag, auth.uid()); end if;
  return new;
end $$;
drop trigger if exists vergaderingen_logboek on public.vergaderingen;
create trigger vergaderingen_logboek after update on public.vergaderingen for each row execute function public.vg_logboek();

create or replace function public.vg_log(p_vid uuid, p_actie text, p_na jsonb default null, p_punt uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.vg_toegang(p_vid) or public.vg_actieve_job(p_vid)) then raise exception 'Geen toegang tot deze vergadering.'; end if;
  insert into public.vergadering_feedback (vergadering_id, punt_id, actie, na, door) values (p_vid, p_punt, p_actie, p_na, auth.uid());
end $$;

-- ---------- 6. functies voor het Planbord ----------
-- opname geüpload (alle delen staan in de opslag) → in de wachtrij
create or replace function public.vergadering_opname(p_id uuid, p_meta jsonb)
returns public.vergaderingen language plpgsql security definer set search_path = public as $$
declare v public.vergaderingen; d jsonb; n int := 0; tot bigint := 0; obj_size bigint;
begin
  if not public.vg_toegang(p_id) then raise exception 'Geen toegang tot deze vergadering.'; end if;
  select * into v from public.vergaderingen where id = p_id for update;
  if v.status not in ('concept', 'mislukt') then raise exception 'Deze vergadering heeft al een opname in verwerking of klaar (status %).', v.status; end if;
  if coalesce((p_meta->>'toestemming')::boolean, false) is not true then raise exception 'Bevestig eerst dat de deelnemers weten dat er opgenomen werd.'; end if;
  if jsonb_typeof(p_meta->'delen') <> 'array' or jsonb_array_length(p_meta->'delen') = 0 or jsonb_array_length(p_meta->'delen') > 200 then raise exception 'Geen geldige upload.'; end if;
  for d in select * from jsonb_array_elements(p_meta->'delen') loop
    n := n + 1;
    if coalesce(d->>'pad', '') not like p_id::text || '/inbox/%' or (d->>'sha256') !~ '^[0-9a-f]{64}$' or coalesce((d->>'grootte')::bigint, 0) <= 0 then raise exception 'Ongeldig uploaddeel %.', n; end if;
    if to_regclass('storage.objects') is not null then
      execute 'select (metadata->>''size'')::bigint from storage.objects where bucket_id = ''opnames'' and name = $1' into obj_size using d->>'pad';
      if obj_size is null then raise exception 'Uploaddeel % ontbreekt in de opslag. Probeer de upload opnieuw.', n; end if;
      if obj_size <> (d->>'grootte')::bigint then raise exception 'Uploaddeel % is onvolledig (% van % bytes). Probeer de upload opnieuw.', n, obj_size, d->>'grootte'; end if;
    end if;
    tot := tot + (d->>'grootte')::bigint;
  end loop;
  if tot <> coalesce((p_meta->>'grootte')::bigint, -1) then raise exception 'De delen samen zijn niet even groot als het bestand.'; end if;
  if v.opname is not null then   -- vorige (mislukte) opname: blijft traceerbaar, ook op Drive
    update public.vergaderingen set vorige_opnames = vorige_opnames || jsonb_build_array(v.opname || jsonb_build_object('drive_file_id', v.drive_file_id, 'drive_url', v.drive_url, 'inbox_leeg', v.inbox_leeg, 'vervangen_op', now())) where id = p_id;
  end if;
  update public.vergaderingen
     set opname = jsonb_build_object('naam', left(coalesce(p_meta->>'naam', 'opname'), 200), 'mime', left(coalesce(p_meta->>'mime', ''), 100), 'grootte', tot,
                                     'delen', p_meta->'delen', 'toestemming', true, 'geupload_op', now(), 'geupload_door', auth.uid(), 'bron', left(coalesce(p_meta->>'bron', 'bestand'), 20)),
         status = 'wachtrij', fout = '', afspeel_pad = null, afspeel_grootte = null, drive_file_id = null, drive_url = null, drive_md5 = null, inbox_leeg = false
   where id = p_id returning * into v;
  insert into public.verwerkingen (vergadering_id, soort) values (p_id, 'volledig');
  perform public.vg_log(p_id, 'opname', jsonb_build_object('naam', v.opname->>'naam', 'grootte', tot, 'delen', n));
  return v;
end $$;

-- opnieuw verwerken: alles (transcript + verslag) of enkel het conceptverslag
create or replace function public.vergadering_verwerk(p_id uuid, p_soort text default 'volledig')
returns public.vergaderingen language plpgsql security definer set search_path = public as $$
declare v public.vergaderingen;
begin
  if not public.vg_toegang(p_id) then raise exception 'Geen toegang tot deze vergadering.'; end if;
  if p_soort not in ('volledig', 'verslag') then raise exception 'Onbekende verwerking.'; end if;
  select * into v from public.vergaderingen where id = p_id for update;
  if v.opname is null then raise exception 'Er is nog geen opname.'; end if;
  if v.status in ('wachtrij', 'verwerking') then raise exception 'Deze opname staat al in de wachtrij of wordt verwerkt.'; end if;
  if v.status = 'gecontroleerd' then raise exception 'Dit verslag is gecontroleerd. Heropen het eerst.'; end if;
  if p_soort = 'verslag' and v.huidige_uitvoer is null then raise exception 'Er is nog geen transcript: verwerk eerst de volledige opname.'; end if;
  if p_soort = 'volledig' and v.inbox_leeg and v.drive_file_id is null then raise exception 'De opname is niet meer beschikbaar.'; end if;
  insert into public.verwerkingen (vergadering_id, soort) values (p_id, p_soort);
  update public.vergaderingen set status = 'wachtrij', fout = '' where id = p_id returning * into v;
  perform public.vg_log(p_id, 'verwerking_aangevraagd', jsonb_build_object('soort', p_soort));
  return v;
end $$;

-- een opdracht in de wachtrij (of lopend) stoppen
create or replace function public.vergadering_stop(p_id uuid)
returns public.vergaderingen language plpgsql security definer set search_path = public as $$
declare v public.vergaderingen; n int;
begin
  if not public.vg_toegang(p_id) then raise exception 'Geen toegang tot deze vergadering.'; end if;
  select * into v from public.vergaderingen where id = p_id for update;
  update public.verwerkingen set status = 'geannuleerd', klaar_op = now(), fout = 'Gestopt door een gebruiker.' where vergadering_id = p_id and status in ('wachtrij', 'bezig');
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Er loopt geen verwerking voor deze vergadering.'; end if;
  update public.vergaderingen set status = case when huidige_uitvoer is not null then 'controle' else 'mislukt' end,
         fout = case when huidige_uitvoer is not null then '' else 'Verwerking gestopt. Start ze opnieuw wanneer je wil.' end
   where id = p_id returning * into v;
  perform public.vg_log(p_id, 'verwerking_gestopt');
  return v;
end $$;

-- actiepunt → taak (nieuw of koppelen aan een bestaande taak); nooit dubbel
create or replace function public.vergadering_punt_taak(p_punt uuid, p_titel text, p_assignee uuid default null, p_eind date default null, p_bestaande uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pt public.vergadering_punten; v public.vergaderingen; t_id uuid; ander uuid; mmss text; orig jsonb; gewijzigd boolean;
begin
  select * into pt from public.vergadering_punten where id = p_punt for update;
  if pt.id is null then raise exception 'Punt niet gevonden.'; end if;
  if not public.vg_toegang(pt.vergadering_id) then raise exception 'Geen toegang tot deze vergadering.'; end if;
  select * into v from public.vergaderingen where id = pt.vergadering_id;
  if v.status = 'gecontroleerd' then raise exception 'Dit verslag is gecontroleerd. Heropen het eerst.'; end if;
  if pt.soort not in ('actie', 'vraag', 'meerwerk', 'beslissing') then raise exception 'Van dit punt kan geen taak gemaakt worden.'; end if;
  if pt.verborgen then raise exception 'Dit punt werd vervangen door een latere verwerking.'; end if;
  if pt.taak_id is not null then return jsonb_build_object('taak_id', pt.taak_id, 'al', true); end if;
  -- hetzelfde actiepunt in dezelfde vergadering (bv. na opnieuw verwerken) is al een taak → koppelen in plaats van dubbel
  if pt.sleutel <> '' then
    select taak_id into ander from public.vergadering_punten where vergadering_id = pt.vergadering_id and id <> pt.id and sleutel = pt.sleutel and taak_id is not null limit 1;
  end if;
  if ander is not null and p_bestaande is null then p_bestaande := ander; end if;
  if p_assignee is not null and not exists (select 1 from public.profiles where id = p_assignee and active and role in ('beheer', 'medewerker')) then raise exception 'Kies een teamlid als verantwoordelijke (of laat leeg).'; end if;
  mmss := case when pt.bron_start is null then '' else ' · ' || lpad((floor(pt.bron_start / 60))::int::text, 2, '0') || ':' || lpad((floor(pt.bron_start)::int % 60)::text, 2, '0') end;
  if p_bestaande is not null then
    if not exists (select 1 from public.taken where id = p_bestaande and project_id = v.project_id) then raise exception 'Die taak hoort niet bij dit project.'; end if;
    update public.taken set notitie = trim(both from notitie || case when notitie = '' then '' else E'\n' end || '↳ Besproken in vergadering "' || v.onderwerp || '" (' || to_char(v.datum, 'DD/MM/YYYY') || mmss || ')'), updated_at = now() where id = p_bestaande;
    t_id := p_bestaande;
  else
    if length(trim(coalesce(p_titel, ''))) < 2 then raise exception 'Geef de taak een titel.'; end if;
    insert into public.taken (project_id, titel, assignee, eind, status, notitie, vergadering_id, vergader_punt_id, bron_sec)
    values (v.project_id, left(trim(p_titel), 300), p_assignee, p_eind, 'todo',
            'Uit vergadering "' || v.onderwerp || '" (' || to_char(v.datum, 'DD/MM/YYYY') || mmss || ')' || case when p_assignee is null or p_eind is null then E'\nNog te bepalen: ' || concat_ws(' en ', case when p_assignee is null then 'verantwoordelijke' end, case when p_eind is null then 'deadline' end) else '' end,
            v.id, pt.id, pt.bron_start)
    returning id into t_id;
  end if;
  orig := pt.origineel;
  gewijzigd := p_bestaande is null and (trim(coalesce(p_titel, '')) is distinct from coalesce(orig->>'tekst', pt.tekst) or p_assignee is distinct from nullif(orig->>'verantwoordelijke', '')::uuid or p_eind is distinct from nullif(orig->>'deadline', '')::date);
  update public.vergadering_punten
     set taak_id = t_id, taak_koppeling = case when p_bestaande is null then 'nieuw' else 'bestaand' end,
         tekst = case when p_bestaande is null then left(trim(p_titel), 300) else tekst end,
         verantwoordelijke = case when p_bestaande is null then p_assignee else verantwoordelijke end,
         deadline = case when p_bestaande is null then p_eind else deadline end,
         status = case when gewijzigd or status = 'gecorrigeerd' then 'gecorrigeerd' else 'bevestigd' end,
         beoordeeld_door = auth.uid(), beoordeeld_op = now()
   where id = pt.id;
  return jsonb_build_object('taak_id', t_id, 'al', false, 'gekoppeld', p_bestaande is not null);
end $$;

-- controle afronden (controleur of beheer): alle punten beoordeeld
create or replace function public.vergadering_controleer(p_id uuid)
returns public.vergaderingen language plpgsql security definer set search_path = public as $$
declare v public.vergaderingen; n int;
begin
  if not public.vg_toegang(p_id) or not public.vg_controleur(p_id) then raise exception 'Enkel de controleur van dit verslag (of een beheerder) kan de controle afronden.'; end if;
  select * into v from public.vergaderingen where id = p_id for update;
  if v.status <> 'controle' then raise exception 'Dit verslag is niet klaar voor controle (status %).', v.status; end if;
  select count(*) into n from public.vergadering_punten where vergadering_id = p_id and not verborgen and status = 'voorstel';
  if n > 0 then raise exception 'Nog % % te beoordelen (bevestigen, corrigeren of afwijzen).', n, case when n = 1 then 'punt' else 'punten' end; end if;
  update public.vergaderingen
     set status = 'gecontroleerd', gecontroleerd_door = auth.uid(), gecontroleerd_op = now(),
         verslag_gecontroleerd = jsonb_build_object('verslag', v.verslag, 'uitvoer', v.huidige_uitvoer, 'punten',
           coalesce((select jsonb_agg(jsonb_build_object('id', id, 'soort', soort, 'tekst', tekst, 'aard', aard, 'voorwaarden', voorwaarden, 'status', status, 'bron_start', bron_start,
                     'verantwoordelijke', verantwoordelijke, 'deadline', deadline, 'taak_id', taak_id) order by soort, volgorde, bron_start)
                     from public.vergadering_punten where vergadering_id = p_id and not verborgen and status <> 'afgewezen'), '[]'::jsonb))
   where id = p_id returning * into v;
  perform public.vg_log(p_id, 'gecontroleerd');
  return v;
end $$;

create or replace function public.vergadering_heropen(p_id uuid, p_reden text)
returns public.vergaderingen language plpgsql security definer set search_path = public as $$
declare v public.vergaderingen;
begin
  if not public.vg_toegang(p_id) or not public.vg_controleur(p_id) then raise exception 'Enkel de controleur van dit verslag (of een beheerder) kan het heropenen.'; end if;
  if length(trim(coalesce(p_reden, ''))) < 3 then raise exception 'Schrijf kort waarom je het verslag heropent.'; end if;
  select * into v from public.vergaderingen where id = p_id for update;
  if v.status <> 'gecontroleerd' then raise exception 'Dit verslag is niet gecontroleerd.'; end if;
  update public.vergaderingen set status = 'controle', klant_verslag = null, klant_gedeeld_op = null, klant_gedeeld_door = null where id = p_id returning * into v;   -- de klant ziet het niet meer tot het opnieuw gedeeld wordt
  perform public.vg_log(p_id, 'heropend', jsonb_build_object('reden', left(trim(p_reden), 500)));
  return v;
end $$;

-- delen met de klant: een afzonderlijke, expliciete handeling, enkel voor een gecontroleerd verslag. De inhoud wordt HIER
-- samengesteld uit de gecontroleerde versie en de bevestigde punten (enkel de gekozen onderdelen; nooit transcript, opname,
-- interne opmerking, afgewezen punten of kritieke gegevens).
drop function if exists public.vergadering_deel_klant(uuid, jsonb);
create or replace function public.vergadering_deel_klant(p_id uuid, p_onderdelen jsonb)
returns public.vergaderingen language plpgsql security definer set search_path = public as $$
declare v public.vergaderingen; vs jsonb; o jsonb := coalesce(p_onderdelen, '{}'::jsonb); inhoud jsonb;
  aan_wie boolean := coalesce((o->>'wie')::boolean, false); ook_voorstel boolean := coalesce((o->>'voorstellen')::boolean, false);
begin
  if not public.vg_toegang(p_id) or not public.vg_controleur(p_id) then raise exception 'Enkel de controleur van dit verslag (of een beheerder) kan het met de klant delen.'; end if;
  select * into v from public.vergaderingen where id = p_id for update;
  if v.status <> 'gecontroleerd' then raise exception 'Enkel een gecontroleerd verslag kan met de klant gedeeld worden.'; end if;
  if (select intern from public.projecten where id = v.project_id) then raise exception 'Verslagen van het interne project worden niet met klanten gedeeld.'; end if;
  vs := coalesce(v.verslag_gecontroleerd->'verslag', v.verslag, '{}'::jsonb);
  inhoud := jsonb_build_object('onderwerp', v.onderwerp, 'datum', v.datum, 'gedeeld_door', (select name from public.profiles where id = auth.uid()),
    'samenvatting', case when coalesce((o->>'samenvatting')::boolean, false) then coalesce(vs->>'samenvatting', '') else '' end,
    'onderwerpen', case when coalesce((o->>'onderwerpen')::boolean, false) then coalesce((select jsonb_agg(jsonb_build_object('titel', coalesce(x->>'titel', ''), 'tekst', coalesce(x->>'tekst', '')))
                     from jsonb_array_elements(case when jsonb_typeof(vs->'onderwerpen') = 'array' then vs->'onderwerpen' else '[]'::jsonb end) x), '[]'::jsonb) else '[]'::jsonb end,
    'beslissingen', case when coalesce((o->>'beslissingen')::boolean, false) then coalesce((select jsonb_agg(jsonb_build_object('tekst', tekst, 'aard', coalesce(aard, ''), 'voorwaarden', voorwaarden) order by volgorde, bron_start)
                     from public.vergadering_punten where vergadering_id = v.id and not verborgen and soort = 'beslissing' and status in ('bevestigd', 'gecorrigeerd') and (aard = 'besloten' or ook_voorstel)), '[]'::jsonb) else '[]'::jsonb end,
    'actiepunten', case when coalesce((o->>'acties')::boolean, false) then coalesce((select jsonb_agg(jsonb_build_object('tekst', coalesce(t.titel, pt.tekst), 'deadline', coalesce(t.eind, pt.deadline),
                     'wie', case when aan_wie then coalesce((select name from public.profiles where id = coalesce(t.assignee, pt.verantwoordelijke)), '') else '' end) order by pt.volgorde, pt.bron_start)
                     from public.vergadering_punten pt left join public.taken t on t.id = pt.taak_id where pt.vergadering_id = v.id and not pt.verborgen and pt.soort = 'actie' and pt.status in ('bevestigd', 'gecorrigeerd')), '[]'::jsonb) else '[]'::jsonb end,
    'vragen', case when coalesce((o->>'vragen')::boolean, false) then coalesce((select jsonb_agg(jsonb_build_object('tekst', tekst) order by volgorde, bron_start)
                     from public.vergadering_punten where vergadering_id = v.id and not verborgen and soort = 'vraag' and status in ('bevestigd', 'gecorrigeerd')), '[]'::jsonb) else '[]'::jsonb end);
  update public.vergaderingen set klant_verslag = inhoud, klant_gedeeld_op = now(), klant_gedeeld_door = auth.uid() where id = p_id returning * into v;
  perform public.vg_log(p_id, 'gedeeld', jsonb_build_object('onderdelen', o));
  return v;
end $$;
create or replace function public.vergadering_deel_stop(p_id uuid)
returns public.vergaderingen language plpgsql security definer set search_path = public as $$
declare v public.vergaderingen;
begin
  if not public.vg_toegang(p_id) or not public.vg_controleur(p_id) then raise exception 'Enkel de controleur van dit verslag (of een beheerder) kan het delen stoppen.'; end if;
  update public.vergaderingen set klant_verslag = null, klant_gedeeld_op = null, klant_gedeeld_door = null where id = p_id returning * into v;
  perform public.vg_log(p_id, 'gedeeld_stop');
  return v;
end $$;

-- ---------- 7. functies voor de verwerkingscomputer (rol verwerker) ----------
create or replace function public.verwerker_meld(p_naam text, p_versie text, p_info jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_verwerker() then raise exception 'Geen verwerkingscomputer.'; end if;
  insert into public.verwerker_status (naam, user_id, laatst_gezien, versie, info) values (left(p_naam, 60), auth.uid(), now(), left(coalesce(p_versie, ''), 40), coalesce(p_info, '{}'::jsonb))
  on conflict (naam) do update set user_id = excluded.user_id, laatst_gezien = now(), versie = excluded.versie, info = excluded.info;
  return jsonb_build_object('ok', true, 'nu', now(), 'wachtrij', (select count(*) from public.verwerkingen where status = 'wachtrij'));
end $$;

-- volgende opdracht (één tegelijk); vastgelopen opdrachten (lease verlopen) worden eerst teruggezet of na 3 pogingen 'mislukt'
create or replace function public.verwerking_claim(p_naam text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j public.verwerkingen; v public.vergaderingen; p public.projecten; r record; trans jsonb;
begin
  if not public.is_verwerker() then raise exception 'Geen verwerkingscomputer.'; end if;
  for r in select * from public.verwerkingen where status = 'bezig' and lease_tot < now() for update skip locked loop
    if r.pogingen >= r.max_pogingen then
      update public.verwerkingen set status = 'mislukt', klaar_op = now(), fout = 'De verwerking werd ' || r.pogingen || ' keer onderbroken (verwerkingscomputer gestopt of niet meer bereikbaar).' where id = r.id;
      update public.vergaderingen set status = case when huidige_uitvoer is not null then 'controle' else 'mislukt' end, fout = 'De verwerking werd ' || r.pogingen || ' keer onderbroken. Probeer opnieuw.' where id = r.vergadering_id;
    else
      update public.verwerkingen set status = 'wachtrij', worker = null, worker_user = null, lease_tot = null, fout = 'Onderbroken — wordt hervat.' where id = r.id;
      update public.vergaderingen set status = 'wachtrij' where id = r.vergadering_id;
    end if;
  end loop;
  select * into j from public.verwerkingen where status = 'wachtrij' and beschikbaar_vanaf <= now() order by created_at limit 1 for update skip locked;
  if j.id is null then return null; end if;
  update public.verwerkingen set status = 'bezig', worker = left(p_naam, 60), worker_user = auth.uid(), claim = gen_random_uuid(), lease_tot = now() + interval '10 minutes', pogingen = pogingen + 1,
         gestart_op = coalesce(gestart_op, now()), stap = 'gestart', voortgang = 0 where id = j.id returning * into j;
  update public.vergaderingen set status = 'verwerking', fout = '' where id = j.vergadering_id returning * into v;
  update public.verwerker_status set huidige_job = j.id where naam = left(p_naam, 60);
  select * into p from public.projecten where id = v.project_id;
  if j.soort = 'verslag' then select transcript into trans from public.vergadering_uitvoer where id = v.huidige_uitvoer; end if;
  return jsonb_build_object(
    'job', jsonb_build_object('id', j.id, 'claim', j.claim, 'soort', j.soort, 'poging', j.pogingen, 'max_pogingen', j.max_pogingen),
    'vergadering', jsonb_build_object('id', v.id, 'onderwerp', v.onderwerp, 'datum', v.datum, 'tijd', v.tijd, 'opname', v.opname, 'drive_file_id', v.drive_file_id, 'drive_md5', v.drive_md5,
                                      'inbox_leeg', v.inbox_leeg, 'afspeel_pad', v.afspeel_pad, 'agenda', v.agenda,
                                      'deelnemers', coalesce((select jsonb_agg(case d->>'soort' when 'team' then (select jsonb_build_object('naam', name, 'team_id', id) from public.profiles where id::text = d->>'id')
                                                                                   when 'contact' then (select jsonb_build_object('naam', naam) from public.contacten where id::text = d->>'id')
                                                                                   else jsonb_build_object('naam', d->>'naam') end) from jsonb_array_elements(v.deelnemers) d), '[]'::jsonb)),
    'project', jsonb_build_object('id', p.id, 'nummer', p.nummer, 'klant', p.klant, 'naam', p.naam, 'intern', p.intern, 'drive', coalesce(p.drive_folder_id, '') <> ''),
    'team', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'naam', name)) from public.profiles where active and role in ('beheer', 'medewerker')), '[]'::jsonb),
    'punten', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'soort', soort, 'tekst', tekst, 'status', status, 'bron_start', bron_start, 'sleutel', sleutel, 'taak_id', taak_id))
                        from public.vergadering_punten where vergadering_id = v.id and not verborgen), '[]'::jsonb),
    'transcript', trans);
end $$;

-- (vorige versies zonder claim-token)
drop function if exists public.vw_eigen(uuid);
drop function if exists public.verwerking_voortgang(uuid, text, numeric);
drop function if exists public.verwerking_bestand(uuid, jsonb);
drop function if exists public.verwerking_klaar(uuid, jsonb);
drop function if exists public.verwerking_mislukt(uuid, text, text, boolean);
create or replace function public.vw_eigen(p_job uuid, p_claim uuid)
returns public.verwerkingen language plpgsql stable security definer set search_path = public as $$
declare j public.verwerkingen;
begin
  if not public.is_verwerker() then raise exception 'Geen verwerkingscomputer.'; end if;
  select * into j from public.verwerkingen where id = p_job;
  if j.id is null or j.worker_user is distinct from auth.uid() or j.claim is distinct from p_claim then raise exception 'Deze opdracht is niet (meer) van deze verwerkingscomputer.'; end if;
  return j;
end $$;

-- voortgang + lease verlengen; 'actief: false' = gestopt door een gebruiker → de verwerkingscomputer stopt
create or replace function public.verwerking_voortgang(p_job uuid, p_claim uuid, p_stap text, p_voortgang numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j public.verwerkingen;
begin
  j := public.vw_eigen(p_job, p_claim);
  if j.status <> 'bezig' then return jsonb_build_object('actief', false, 'status', j.status); end if;
  update public.verwerkingen set stap = left(coalesce(p_stap, ''), 200), voortgang = least(greatest(coalesce(p_voortgang, 0), 0), 1), lease_tot = now() + interval '10 minutes' where id = p_job;
  return jsonb_build_object('actief', true);
end $$;

-- tussentijds vastleggen (blijft bewaard bij een nieuwe poging): kopie op Drive, afspeelkopie, duur, uploaddelen opgeruimd
create or replace function public.verwerking_bestand(p_job uuid, p_claim uuid, p_gegevens jsonb)
returns public.vergaderingen language plpgsql security definer set search_path = public as $$
declare j public.verwerkingen; v public.vergaderingen;
begin
  j := public.vw_eigen(p_job, p_claim);
  if j.status <> 'bezig' then raise exception 'Deze opdracht loopt niet meer.'; end if;
  select * into v from public.vergaderingen where id = j.vergadering_id for update;
  if p_gegevens ? 'drive_file_id' then
    if coalesce(p_gegevens->>'drive_md5', '') !~ '^[0-9a-f]{32}$' then raise exception 'Kopie op Drive zonder controlegetal.'; end if;
    update public.vergaderingen set drive_file_id = left(p_gegevens->>'drive_file_id', 200), drive_url = left(p_gegevens->>'drive_url', 500), drive_map_url = left(p_gegevens->>'drive_map_url', 500), drive_md5 = p_gegevens->>'drive_md5' where id = v.id;
  end if;
  if p_gegevens ? 'afspeel_pad' then
    if coalesce(p_gegevens->>'afspeel_pad', '') not like v.id::text || '/afspeel/%' then raise exception 'Ongeldig pad voor de afspeelkopie.'; end if;
    update public.vergaderingen set afspeel_pad = p_gegevens->>'afspeel_pad', afspeel_grootte = (p_gegevens->>'afspeel_grootte')::bigint where id = v.id;
  end if;
  if p_gegevens ? 'duur_sec' then update public.vergaderingen set opname = opname || jsonb_build_object('duur_sec', (p_gegevens->>'duur_sec')::numeric, 'formaat', left(coalesce(p_gegevens->>'formaat', ''), 200)) where id = v.id; end if;
  if coalesce((p_gegevens->>'inbox_leeg')::boolean, false) then
    if (select drive_md5 from public.vergaderingen where id = v.id) is null then raise exception 'De uploaddelen blijven tot de kopie op Drive gecontroleerd is.'; end if;
    update public.vergaderingen set inbox_leeg = true where id = v.id;
  end if;
  update public.verwerkingen set lease_tot = now() + interval '10 minutes' where id = p_job;
  select * into v from public.vergaderingen where id = j.vergadering_id;
  return v;
end $$;

-- resultaat: nieuwe (onveranderlijke) uitvoer, conceptverslag (tenzij al door iemand bewerkt) en punten — zonder dubbels
create or replace function public.verwerking_klaar(p_job uuid, p_claim uuid, p_resultaat jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j public.verwerkingen; v public.vergaderingen; u_id uuid; ver int; pt jsonb; oud public.vergadering_punten; n int := 0; nv int := 0; volg int := 0; trans jsonb; nieuw_id uuid;
begin
  j := public.vw_eigen(p_job, p_claim);
  if j.status <> 'bezig' then raise exception 'Deze opdracht loopt niet meer (status %).', j.status; end if;
  select * into v from public.vergaderingen where id = j.vergadering_id for update;
  trans := p_resultaat->'transcript';
  if j.soort = 'verslag' then select transcript into trans from public.vergadering_uitvoer where id = v.huidige_uitvoer; end if;
  if trans is null or jsonb_typeof(trans) <> 'array' then raise exception 'Resultaat zonder transcript.'; end if;
  select coalesce(max(versie), 0) + 1 into ver from public.vergadering_uitvoer where vergadering_id = v.id;
  insert into public.vergadering_uitvoer (vergadering_id, job_id, versie, soort, transcript, verslag, controles, modellen, metingen, waarschuwing)
  values (v.id, j.id, ver, j.soort, trans, p_resultaat->'verslag', p_resultaat->'controles', p_resultaat->'modellen', p_resultaat->'metingen', left(coalesce(p_resultaat->>'waarschuwing', ''), 2000))
  returning id into u_id;
  for pt in select * from jsonb_array_elements(coalesce(p_resultaat->'punten', '[]'::jsonb)) loop
    volg := volg + 1;
    if coalesce(pt->>'soort', '') not in ('beslissing', 'vraag', 'actie', 'meerwerk', 'gegeven') then continue; end if;
    oud := null;
    if coalesce(pt->>'vervangt', '') ~ '^[0-9a-f-]{36}$' then
      select * into oud from public.vergadering_punten where id = (pt->>'vervangt')::uuid and vergadering_id = v.id and not verborgen for update;   -- vergrendeld: een gelijktijdige beoordeling wacht
    end if;
    if oud.id is null and coalesce(pt->>'sleutel', '') <> '' then
      select * into oud from public.vergadering_punten where vergadering_id = v.id and soort = pt->>'soort' and sleutel = pt->>'sleutel' and not verborgen order by created_at limit 1 for update;
    end if;
    insert into public.vergadering_punten (vergadering_id, uitvoer_id, soort, tekst, aard, voorwaarden, citaat, bron_start, bron_eind, segmenten, waarschuwingen, kritiek, gegeven_soort,
                                           verantwoordelijke_tekst, verantwoordelijke, deadline, deadline_tekst, origineel, sleutel, vervangt, verborgen, volgorde)
    values (v.id, u_id, pt->>'soort', left(coalesce(pt->>'tekst', ''), 2000), nullif(pt->>'aard', ''), left(coalesce(pt->>'voorwaarden', ''), 2000), left(coalesce(pt->>'citaat', ''), 2000),
            nullif(pt->>'bron_start', '')::numeric, nullif(pt->>'bron_eind', '')::numeric,
            coalesce((select array_agg(x::int) from jsonb_array_elements_text(coalesce(pt->'segmenten', '[]'::jsonb)) x where x ~ '^\d+$'), '{}'),
            coalesce((select array_agg(left(x, 300)) from jsonb_array_elements_text(coalesce(pt->'waarschuwingen', '[]'::jsonb)) x), '{}'),
            coalesce((pt->>'kritiek')::boolean, false), left(coalesce(pt->>'gegeven_soort', ''), 40), left(coalesce(pt->>'verantwoordelijke_tekst', ''), 200),
            (select id from public.profiles where id::text = pt->>'verantwoordelijke' and active and role in ('beheer', 'medewerker')),
            case when coalesce(pt->>'deadline', '') ~ '^\d{4}-\d{2}-\d{2}$' then (pt->>'deadline')::date end, left(coalesce(pt->>'deadline_tekst', ''), 200),
            pt - 'vervangt', left(coalesce(pt->>'sleutel', ''), 300), oud.id,
            oud.id is not null and oud.status <> 'voorstel',   -- al beoordeeld (of al een taak): geen nieuw voorstel, wel bewaard
            volg) returning id into nieuw_id;
    if oud.id is not null and oud.status = 'voorstel' then update public.vergadering_punten set verborgen = true where id = oud.id; end if;   -- het oude, nog niet beoordeelde voorstel wordt vervangen
    if oud.id is not null and oud.status <> 'voorstel' then nv := nv + 1; else n := n + 1; end if;
  end loop;
  update public.vergaderingen
     set huidige_uitvoer = u_id, status = 'controle', fout = '',
         verslag = case when verslag_bewerkt_op is null and jsonb_typeof(p_resultaat->'verslag_concept') = 'object' then p_resultaat->'verslag_concept' else verslag end
   where id = v.id;
  update public.verwerkingen set status = 'klaar', klaar_op = now(), voortgang = 1, stap = 'klaar', metingen = p_resultaat->'metingen', fout = '' where id = j.id;
  update public.verwerker_status set huidige_job = null where user_id = auth.uid();
  return jsonb_build_object('ok', true, 'uitvoer_id', u_id, 'versie', ver, 'nieuwe_punten', n, 'al_beoordeeld', nv);
end $$;

-- mislukt: opnieuw proberen (met wachttijd) of definitief, met een begrijpelijke melding
create or replace function public.verwerking_mislukt(p_job uuid, p_claim uuid, p_fout text, p_detail text, p_opnieuw boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j public.verwerkingen; definitief boolean;
begin
  j := public.vw_eigen(p_job, p_claim);
  if j.status <> 'bezig' then return jsonb_build_object('ok', true, 'status', j.status); end if;
  definitief := not coalesce(p_opnieuw, false) or j.pogingen >= j.max_pogingen;
  update public.verwerkingen set status = case when definitief then 'mislukt' else 'wachtrij' end, worker = case when definitief then worker end, worker_user = case when definitief then worker_user end,
         lease_tot = null, beschikbaar_vanaf = now() + make_interval(mins => 5 * j.pogingen), fout = left(coalesce(p_fout, ''), 500), fout_detail = left(coalesce(p_detail, ''), 4000),
         klaar_op = case when definitief then now() end
   where id = j.id;
  update public.vergaderingen set status = case when definitief then (case when huidige_uitvoer is not null then 'controle' else 'mislukt' end) else 'wachtrij' end,
         fout = left(coalesce(p_fout, ''), 500) || case when definitief then '' else ' — nieuwe poging binnen ' || 5 * j.pogingen || ' min.' end
   where id = j.vergadering_id;
  update public.verwerker_status set huidige_job = null where user_id = auth.uid();
  return jsonb_build_object('ok', true, 'definitief', definitief);
end $$;

-- ---------- 8. opslag 'opnames' (privé) ----------
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public) values ('opnames', 'opnames', false) on conflict (id) do update set public = false;
    if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
      update storage.buckets set file_size_limit = 52428800, allowed_mime_types = null where id = 'opnames';   -- 50 MB per deel (het maximum van een gratis Supabase-project); de app uploadt delen van 20 MB
    end if;
    execute 'drop policy if exists opnames_insert on storage.objects';
    execute 'drop policy if exists opnames_read on storage.objects';
    execute 'drop policy if exists opnames_delete on storage.objects';
    execute $p$create policy opnames_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'opnames' and split_part(name, '/', 4) = '' and (
        (split_part(name, '/', 2) = 'inbox' and public.is_intern() and public.vg_toegang(public.vg_pad(name))
           and public.vg_status(public.vg_pad(name)) in ('concept', 'mislukt'))
        or (split_part(name, '/', 2) = 'afspeel' and public.vg_actieve_job(public.vg_pad(name)))))$p$;
    execute $p$create policy opnames_read on storage.objects for select to authenticated using (
      bucket_id = 'opnames' and ((public.is_intern() and public.vg_toegang(public.vg_pad(name))) or public.vg_actieve_job(public.vg_pad(name))))$p$;
    execute $p$create policy opnames_delete on storage.objects for delete to authenticated using (
      bucket_id = 'opnames' and public.vg_actieve_job(public.vg_pad(name)) and (
        split_part(name, '/', 2) = 'afspeel'
        or (split_part(name, '/', 2) = 'inbox' and public.vg_drive_ok(public.vg_pad(name)))))$p$;   -- uploaddelen pas weg als de kopie op Drive gecontroleerd is
  end if;
end $$;

-- ---------- 9. wat de klant ziet: enkel expliciet gedeelde, gecontroleerde verslagen ----------
create or replace view public.klant_vergaderverslagen as
  select v.id, v.project_id, v.onderwerp, v.datum, v.klant_verslag as verslag, v.klant_gedeeld_op as gedeeld_op
  from public.vergaderingen v
  where v.klant_gedeeld_op is not null and v.status = 'gecontroleerd' and v.klant_verslag is not null and v.project_id in (select public.klant_projecten());

-- ---------- 10. live ----------
do $$ declare t text; begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['vergaderingen', 'vergadering_punten', 'verwerkingen', 'verwerker_status'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------- rechten (zoals 050) ----------
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
revoke all on function public.aannemer_factuur_status() from public, anon, authenticated;
revoke all on function public.aannemerfacturen_aantal(text) from public, anon;
revoke all on public.aannemer_hulp from anon;
revoke insert, update, delete, truncate, references, trigger on public.aannemer_hulp from authenticated;
revoke all on function public.vordering_betaald_op() from public, anon, authenticated;
revoke all on function public.betaalherinnering_bewaken() from public, anon, authenticated;
revoke all on function public.goedkeuring_status_vast() from public, anon, authenticated;
revoke all on function public.goedkeuring_annuleer(uuid, text) from public, anon;
grant execute on function public.goedkeuring_annuleer(uuid, text) to authenticated;
-- 051: triggerfuncties en interne hulpfuncties niet rechtstreeks aanroepbaar
revoke all on function public.vg_deelnemer_ids() from public, anon, authenticated;
revoke all on function public.projecten_intern_vast() from public, anon, authenticated;
revoke all on function public.vg_bewaking() from public, anon, authenticated;
revoke all on function public.vp_bewaking() from public, anon, authenticated;
revoke all on function public.vu_vast() from public, anon, authenticated;
revoke all on function public.vp_logboek() from public, anon, authenticated;
revoke all on function public.vg_logboek() from public, anon, authenticated;
revoke all on function public.vg_log(uuid, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.vw_eigen(uuid, uuid) from public, anon, authenticated;
grant select, insert, update, delete on public.vergaderingen, public.vergadering_punten to authenticated;
grant select on public.verwerkingen, public.vergadering_uitvoer, public.vergadering_feedback, public.verwerker_status to authenticated;
-- schrijven in de verwerkingstabellen enkel via de functies
revoke insert, update, delete, truncate, references, trigger on public.verwerkingen, public.vergadering_uitvoer, public.vergadering_feedback, public.verwerker_status from authenticated, anon;
revoke truncate, references, trigger on public.vergaderingen, public.vergadering_punten from authenticated, anon;
revoke all on public.vergaderingen, public.vergadering_punten, public.verwerkingen, public.vergadering_uitvoer, public.vergadering_feedback, public.verwerker_status from anon;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(51, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: moet 6 | 6 | 1 | 1 teruggeven (6 tabellen, 6 met RLS, opslag aanwezig, intern project gevonden).
-- Staat er bij intern_project 0: open in het Planbord het project BROS › Bewerken › vink 'Intern project' aan.
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('vergaderingen', 'verwerkingen', 'vergadering_uitvoer', 'vergadering_punten', 'vergadering_feedback', 'verwerker_status'))::int as tabellen,
       (select count(*) from pg_tables where schemaname = 'public' and tablename in ('vergaderingen', 'verwerkingen', 'vergadering_uitvoer', 'vergadering_punten', 'vergadering_feedback', 'verwerker_status') and rowsecurity)::int as rls,
       (select count(*) from storage.buckets where id = 'opnames')::int as opslag,
       (select count(*) from public.projecten where intern)::int as intern_project;
