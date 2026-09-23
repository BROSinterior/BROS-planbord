-- =====================================================================
--  BROS Planbord — databasescript 028: tekenmodule (fase 0 + 1)
--  - tekenplannen:   een tekening per project, met onderlegger (pdf / afbeelding / dxf) en schaal (kalibratie)
--  - plan_objecten:  de getekende objecten (vanaf fase 2: symbolen, tekst, lijnen) — één rij per object, in mm
--  - plan_versies:   momentopnames van een plan (herstel)
--  - plan_symbolen:  de symbolenbibliotheek (naam, laag, standaardhoogte, koppeling met een meetstaatpost);
--                    de tekening van elk symbool zit in symbolen.js
--  Bestanden (onderleggers) gaan in de bestaande bucket 'werf' onder <project>/tekenen/.
--  Alleen toevoegingen; mag opnieuw uitgevoerd worden (na script 027).
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 27 then
    raise exception 'Voer eerst de scripts tot en met 027 uit.';
  end if;
end $$;

-- ---------- tekenplannen ----------
create table if not exists public.tekenplannen (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projecten(id) on delete cascade,
  naam          text not null default '',
  schaal        int  not null default 50,            -- tekenschaal voor afdruk (1:50, 1:20)
  papier        text not null default 'A1',          -- A1 / A3
  onderlegger   jsonb not null default '{}'::jsonb,  -- {soort, path, url, beeld_path, beeld_url, pagina, pw, ph, w, h, eenheid, bbox, bestand}
  kalibratie    jsonb not null default '{}'::jsonb,  -- {s, rot, tx, ty, bron, pdf_schaal}  (mm per onderlegger-eenheid)
  lagen         jsonb not null default '{}'::jsonb,  -- zichtbaarheid/kleur per laag, dekking onderlegger
  volgorde      int  not null default 0,
  gedeeld_klant boolean not null default false,      -- fase 3: zichtbaar in het klantenportaal
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id),
  updated_at    timestamptz not null default now()
);
create index if not exists tekenplannen_project_idx on public.tekenplannen(project_id, volgorde);
alter table public.tekenplannen enable row level security;
drop policy if exists tp_intern on public.tekenplannen;
create policy tp_intern on public.tekenplannen for all to authenticated using (public.is_intern()) with check (public.is_intern());

-- ---------- plan_objecten ----------
create table if not exists public.plan_objecten (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.tekenplannen(id) on delete cascade,
  laag        text not null default 'nieuw',
  soort       text not null default 'lijn',          -- symbool, tekst, lijn, polylijn, rechthoek, cirkel, boog, maat, vlak …
  geo         jsonb not null default '{}'::jsonb,    -- geometrie in mm (wereldcoördinaten, y naar boven)
  props       jsonb not null default '{}'::jsonb,    -- bv. symbool: {code, rot, hoogte, kring, label}
  z           int  not null default 0,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now()
);
create index if not exists plan_objecten_plan_idx on public.plan_objecten(plan_id);
alter table public.plan_objecten enable row level security;
drop policy if exists po_intern on public.plan_objecten;
create policy po_intern on public.plan_objecten for all to authenticated using (public.is_intern()) with check (public.is_intern());

-- ---------- plan_versies ----------
create table if not exists public.plan_versies (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.tekenplannen(id) on delete cascade,
  notitie     text not null default '',
  snapshot    jsonb not null default '{}'::jsonb,    -- {plan: {...}, objecten: [...]}
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index if not exists plan_versies_plan_idx on public.plan_versies(plan_id, created_at desc);
alter table public.plan_versies enable row level security;
drop policy if exists pv_intern on public.plan_versies;
create policy pv_intern on public.plan_versies for all to authenticated using (public.is_intern()) with check (public.is_intern());

-- ---------- plan_symbolen (bibliotheek) ----------
create table if not exists public.plan_symbolen (
  code        text primary key,                      -- zelfde code als in symbolen.js
  naam        text not null,
  groep       text not null default 'elektro',       -- elektro, verlichting, data, beveiliging, sanitair, hvac
  laag        text not null default 'elektro',
  hoogte_mm   int,                                   -- standaardhoogte (hoogteregel op het blad); leeg = plafond / vloer
  post_id     uuid references public.posten(id) on delete set null,   -- fase 3: telling naar de meetstaat
  volgorde    int not null default 0,
  actief      boolean not null default true
);
alter table public.plan_symbolen enable row level security;
drop policy if exists ps_lezen on public.plan_symbolen;
create policy ps_lezen on public.plan_symbolen for select to authenticated using (public.is_intern());
drop policy if exists ps_beheer on public.plan_symbolen;
create policy ps_beheer on public.plan_symbolen for all to authenticated using (public.is_beheer()) with check (public.is_beheer());

insert into public.plan_symbolen (code, naam, groep, laag, hoogte_mm, volgorde) values
  ('stopcontact',        'Stopcontact',                              'elektro',     'elektro',     200,  10),
  ('stopcontact_gesch',  'Geschakeld stopcontact',                   'elektro',     'elektro',     200,  20),
  ('vloerstopcontact',   'Vloerstopcontact',                         'elektro',     'elektro',     null, 30),
  ('data',               'Telefoon-/datastopcontact',                'data',        'elektro',     200,  40),
  ('tv',                 'Tv-aansluiting',                           'data',        'elektro',     200,  50),
  ('schakelaar',         'Schakelaar',                               'elektro',     'elektro',     1000, 60),
  ('schakelaar_gesch',   'Schakelaar geschakelde stopcontacten',     'elektro',     'elektro',     1000, 70),
  ('voeding',            'Voeding',                                  'elektro',     'elektro',     null, 80),
  ('lichtpunt',          'Centraal lichtpunt',                       'verlichting', 'verlichting', null, 100),
  ('hanglamp',           'Hanglamp',                                 'verlichting', 'verlichting', null, 110),
  ('spot',               'In- of opbouwspot',                        'verlichting', 'verlichting', null, 120),
  ('spot_richtbaar',     'Richtbare in- of opbouwspot',              'verlichting', 'verlichting', null, 130),
  ('applique',           'Wandapplique (opbouw)',                    'verlichting', 'verlichting', 1800, 140),
  ('applique_richtbaar', 'Richtbare wandapplique (opbouw)',          'verlichting', 'verlichting', 1800, 150),
  ('applique_inbouw',    'Wandapplique (inbouw – Brick in the Wall)','verlichting', 'verlichting', 300,  160),
  ('tl',                 'TL-lamp',                                  'verlichting', 'verlichting', null, 170),
  ('ledstrip',           'LED-strip + transfo',                      'verlichting', 'verlichting', null, 180),
  ('ventiel',            'Ventilatieventiel',                        'hvac',        'hvac',        null, 200),
  ('prado',              'Prado-spot inclusief ventilatie',          'hvac',        'hvac',        null, 210),
  ('muziekbox',          'Muziekbox (inbouw plafond / wand)',        'data',        'elektro',     null, 220),
  ('rookmelder',         'Rookmelder',                               'beveiliging', 'elektro',     null, 230),
  ('gas',                'Gastoevoer',                               'hvac',        'hvac',        null, 240),
  ('wifi_versterker',    'Wifi-versterker',                          'data',        'elektro',     null, 250),
  ('wifi_ap',            'Wifi-access point',                        'data',        'elektro',     null, 260),
  ('alarmdetector',      'Alarmdetector',                            'beveiliging', 'elektro',     null, 270),
  ('alarmcontact',       'Alarmcontact (raam / deur)',               'beveiliging', 'elektro',     null, 280),
  ('camera',             'Camera',                                   'beveiliging', 'elektro',     null, 290),
  ('bewegingssensor',    'Bewegingssensor',                          'elektro',     'elektro',     null, 300),
  ('thermostaat',        'Thermostaat',                              'hvac',        'hvac',        1500, 310),
  ('parlofoon',          'Parlofoon / videofoon',                    'beveiliging', 'elektro',     1600, 320),
  ('alarmbediening',     'Alarmbediening',                           'beveiliging', 'elektro',     1600, 330),
  ('deurbel',            'Deurbel',                                  'beveiliging', 'elektro',     1600, 340),
  ('aircobediening',     'Aircobediening',                           'hvac',        'hvac',        1500, 350),
  ('kw',                 'Koud water (KW)',                          'sanitair',    'sanitair',    null, 400),
  ('ww',                 'Warm water (WW)',                          'sanitair',    'sanitair',    null, 410),
  ('afvoer',             'Afvoer',                                   'sanitair',    'sanitair',    null, 420),
  ('airco_unit',         'Airco binnenunit',                         'hvac',        'hvac',        null, 430),
  ('radiator',           'Radiator',                                 'hvac',        'hvac',        null, 440)
on conflict (code) do nothing;

-- ---------- realtime ----------
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'tekenplannen') then alter publication supabase_realtime add table public.tekenplannen; end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'plan_objecten') then alter publication supabase_realtime add table public.plan_objecten; end if;
end $$;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', '28'::jsonb), updated_at = now() where key = 'app';

-- Controle: moet 4 teruggeven
select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('tekenplannen', 'plan_objecten', 'plan_versies', 'plan_symbolen');
