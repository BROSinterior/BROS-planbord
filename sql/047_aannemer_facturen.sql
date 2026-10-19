-- =====================================================================
--  BROS Planbord — databasescript 047: facturen van aannemers + hulp in het aannemersportaal (v1.49)
--  - Tabel aannemer_facturen: de aannemer laadt zijn factuur (pdf) op in zijn portaal, met nummer, datum, vervaldag en bedrag;
--    optioneel gekoppeld aan loten en/of posten (met of zonder bedrag per koppeling).
--  - BROS (beheer) volgt ze op in het Planbord: ontvangen → goedgekeurd → betaald (datum), of 'vraag van BROS' (betwist) met
--    een toelichting die de aannemer ziet. Per factuur kies je of de klant ze in zijn portaal ziet (standaard niet).
--  - Private opslag 'aannemerfacturen' (pdf, max 15 MB): de aannemer leest en schrijft enkel zijn eigen facturen,
--    beheer alles, de klant enkel de facturen die BROS voor hem zichtbaar zette.
--  - De aannemer werkt via aannemer_factuur() en aannemer_factuur_weg() (enkel zolang BROS ze nog niet goedkeurde).
--  - Tabel aannemer_hulp: vragen aan de hulp-assistent van het aannemersportaal (log en daglimiet; enkel beheer leest).
--  Vereist schema 46. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 46 then
    raise exception 'Voer eerst de scripts tot en met 046 uit.';
  end if;
end $$;

-- ---------- 1. tabel ----------
create table if not exists public.aannemer_facturen (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projecten(id) on delete cascade,
  contact_id uuid references public.contacten(id) on delete set null,
  aannemer_naam text not null default '',              -- naam op het moment van opladen (blijft als de fiche ooit verdwijnt)
  nummer text not null default '',
  datum date,
  vervaldag date,
  bedrag_excl numeric(12,2) not null,
  btw_bedrag numeric(12,2),
  omschrijving text not null default '',
  pdf_path text not null,
  pdf_naam text not null default '',
  koppeling jsonb not null default '[]'::jsonb,        -- [{ "lot": 12, "post_id": null | uuid, "bedrag": null | getal }]
  status text not null default 'ontvangen' check (status in ('ontvangen', 'goedgekeurd', 'betaald', 'betwist')),
  betaald_op date,
  bros_opmerking text not null default '',
  zichtbaar_klant boolean not null default false,
  gemeld boolean not null default false,                -- opgenomen in de dagmail aan BROS (Drive-script)
  ingediend_door uuid references public.profiles(id) on delete set null,
  beoordeeld_door uuid references public.profiles(id) on delete set null,
  beoordeeld_op timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint aannemer_facturen_bedrag check (abs(bedrag_excl) < 10000000 and (btw_bedrag is null or abs(btw_bedrag) < 10000000)),
  constraint aannemer_facturen_koppeling check (jsonb_typeof(koppeling) = 'array')
);
create unique index if not exists aannemer_facturen_pdf on public.aannemer_facturen (pdf_path);
create index if not exists aannemer_facturen_project on public.aannemer_facturen (project_id, created_at desc);
create index if not exists aannemer_facturen_contact on public.aannemer_facturen (contact_id);
create index if not exists aannemer_facturen_open on public.aannemer_facturen (status) where status in ('ontvangen', 'betwist');
create index if not exists aannemer_facturen_melden on public.aannemer_facturen (created_at) where not gemeld;

alter table public.aannemer_facturen enable row level security;
drop policy if exists aannemer_facturen_beheer on public.aannemer_facturen;
create policy aannemer_facturen_beheer on public.aannemer_facturen for all to authenticated
  using ((select public.is_beheer())) with check ((select public.is_beheer()));
revoke all on public.aannemer_facturen from anon;
grant select, insert, update, delete on public.aannemer_facturen to authenticated;

-- statuswijziging door BROS: wie/wanneer bijhouden, betaald → betaaldatum (vandaag als ze leeg is)
create or replace function public.aannemer_factuur_status()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status <> 'ontvangen' then
    new.beoordeeld_op := now(); new.beoordeeld_door := coalesce(auth.uid(), new.beoordeeld_door);
  end if;
  if new.status = 'betaald' and new.betaald_op is null then new.betaald_op := (now() at time zone 'Europe/Brussels')::date; end if;
  if new.status <> 'betaald' then new.betaald_op := null; end if;
  return new;
end $$;
drop trigger if exists aannemer_facturen_status on public.aannemer_facturen;
create trigger aannemer_facturen_status before insert or update on public.aannemer_facturen
  for each row execute function public.aannemer_factuur_status();

-- ---------- 2. wat de aannemer en de klant zien ----------
drop view if exists public.aan_facturen;
create view public.aan_facturen as
  select f.id, f.project_id, f.nummer, f.datum, f.vervaldag, f.bedrag_excl, f.btw_bedrag, f.omschrijving, f.pdf_path, f.pdf_naam,
         f.koppeling, f.status, f.betaald_op, f.bros_opmerking, f.beoordeeld_op, f.created_at, f.updated_at
  from public.aannemer_facturen f
  where f.contact_id in (select public.mijn_contacten()) and f.project_id in (select public.aannemer_projecten());

drop view if exists public.klant_aannemer_facturen;
create view public.klant_aannemer_facturen as
  select f.id, f.project_id, coalesce(nullif(c.bedrijf, ''), nullif(f.aannemer_naam, ''), c.naam, '') as aannemer, f.nummer, f.datum,
         f.bedrag_excl, f.btw_bedrag, f.omschrijving, f.pdf_path, f.pdf_naam,
         coalesce((select jsonb_agg(distinct (k->>'lot')::int) from jsonb_array_elements(f.koppeling) k where k ? 'lot'), '[]'::jsonb) as loten,
         f.status, f.betaald_op, f.created_at
  from public.aannemer_facturen f left join public.contacten c on c.id = f.contact_id
  where f.zichtbaar_klant and f.project_id in (select public.klant_projecten());

-- ---------- 3. de aannemer: opladen, verbeteren, intrekken ----------
-- p_path: '<project>/<contact>/<naam>.pdf' in de opslag 'aannemerfacturen' (eerst opladen, dan deze functie)
create or replace function public.aannemer_factuur(p_id uuid, p_project uuid, p_path text, p_naam text, p_nummer text, p_datum date, p_vervaldag date,
                                                   p_excl numeric, p_btw numeric, p_omschrijving text, p_koppeling jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; f public.aannemer_facturen; k jsonb; uit jsonb := '[]'::jsonb; lt int; pid uuid; b numeric; mijnLoten int[]; nieuw uuid; cnaam text;
begin
  if not public.is_aannemer() then raise exception 'Geen toegang.'; end if;
  if p_project is null or p_project not in (select public.aannemer_projecten()) then raise exception 'Geen toegang tot dit project.'; end if;
  select pc.contact_id into cid from public.project_contacten pc
   where pc.project_id = p_project and pc.contact_id in (select public.mijn_contacten()) and pc.rol not in ('bouwheer', 'contactpersoon')
   order by pc.contact_id limit 1;
  if cid is null then raise exception 'Geen toegang tot dit project.'; end if;
  if p_excl is null or p_excl = 0 then raise exception 'Vul het bedrag excl. btw in.'; end if;
  if abs(p_excl) >= 10000000 or abs(coalesce(p_btw, 0)) >= 10000000 then raise exception 'Dit bedrag is te groot.'; end if;
  if p_btw is not null and p_excl > 0 and (p_btw < 0 or p_btw > p_excl * 0.25) then raise exception 'Het btw-bedrag klopt niet (tussen 0 en 25 %% van het bedrag excl. btw).'; end if;
  if p_datum is not null and (p_datum > (now() at time zone 'Europe/Brussels')::date + 31 or p_datum < date '2000-01-01') then raise exception 'De factuurdatum klopt niet.'; end if;
  if p_vervaldag is not null and p_datum is not null and p_vervaldag < p_datum then raise exception 'De vervaldag ligt vóór de factuurdatum.'; end if;
  if coalesce(trim(p_nummer), '') = '' then raise exception 'Vul het factuurnummer in.'; end if;
  -- koppeling (optioneel): enkel loten en posten van dit project; loten waaraan hij gekoppeld is of die in de meetstaat staan
  if p_koppeling is not null and jsonb_typeof(p_koppeling) <> 'array' then raise exception 'Ongeldige koppeling.'; end if;
  if jsonb_array_length(coalesce(p_koppeling, '[]'::jsonb)) > 300 then raise exception 'Te veel koppelingen (max. 300).'; end if;
  select coalesce(array_agg(distinct l), '{}') into mijnLoten from public.project_contacten pc, unnest(pc.loten) l
   where pc.project_id = p_project and pc.contact_id in (select public.mijn_contacten());
  for k in select * from jsonb_array_elements(coalesce(p_koppeling, '[]'::jsonb)) loop
    lt := null; pid := null; b := null;
    begin
      lt := nullif(k->>'lot', '')::int; pid := nullif(k->>'post_id', '')::uuid; b := nullif(k->>'bedrag', '')::numeric;
    exception when others then raise exception 'Ongeldige koppeling.';
    end;
    if pid is not null then
      select m.lot into lt from public.meetstaat_posten m where m.id = pid and m.project_id = p_project and m.status <> 'vervallen';
      if lt is null then raise exception 'Een gekozen post hoort niet bij dit project.'; end if;
    end if;
    if lt is null then raise exception 'Kies een lot of een post.'; end if;
    if not (lt = any (mijnLoten)) and not exists (select 1 from public.meetstaat_posten m where m.project_id = p_project and m.lot = lt and m.status <> 'vervallen') then
      raise exception 'Lot % hoort niet bij dit project.', lt;
    end if;
    if b is not null and abs(b) >= 10000000 then raise exception 'Een bedrag in de koppeling is te groot.'; end if;
    uit := uit || jsonb_build_array(jsonb_build_object('lot', lt, 'post_id', pid, 'bedrag', case when b is null then null else round(b, 2) end));
  end loop;
  select coalesce(nullif(c.bedrijf, ''), c.naam) into cnaam from public.contacten c where c.id = cid;

  if p_id is null then
    if p_path is null or p_path !~ ('^' || p_project::text || '/' || cid::text || '/[A-Za-z0-9_-]+\.pdf$') then raise exception 'Ongeldig bestand.'; end if;
    if (select count(*) from public.aannemer_facturen x where x.contact_id = cid and x.created_at > now() - interval '1 day') >= 30 then
      raise exception 'Maximaal 30 facturen per dag. Probeer het morgen opnieuw of neem contact op met BROS.';
    end if;
    if exists (select 1 from public.aannemer_facturen x where x.contact_id = cid and x.project_id = p_project and lower(trim(x.nummer)) = lower(trim(p_nummer))) then
      raise exception 'Factuur % staat al in het portaal voor dit project.', trim(p_nummer);
    end if;
    insert into public.aannemer_facturen (project_id, contact_id, aannemer_naam, nummer, datum, vervaldag, bedrag_excl, btw_bedrag, omschrijving, pdf_path, pdf_naam, koppeling, ingediend_door)
    values (p_project, cid, coalesce(cnaam, ''), left(trim(p_nummer), 60), p_datum, p_vervaldag, round(p_excl, 2), round(p_btw, 2), left(coalesce(trim(p_omschrijving), ''), 1000),
            p_path, left(coalesce(nullif(trim(p_naam), ''), 'factuur.pdf'), 160), uit, auth.uid())
    returning id into nieuw;
    return nieuw;
  end if;

  select * into f from public.aannemer_facturen where id = p_id for update;
  if f.id is null or f.contact_id is distinct from cid or f.project_id <> p_project then raise exception 'Factuur niet gevonden.'; end if;
  if f.status not in ('ontvangen', 'betwist') then raise exception 'BROS heeft deze factuur al goedgekeurd; wijzigen kan niet meer. Stuur een creditnota of neem contact op.'; end if;
  if exists (select 1 from public.aannemer_facturen x where x.id <> f.id and x.contact_id = cid and x.project_id = p_project and lower(trim(x.nummer)) = lower(trim(p_nummer))) then
    raise exception 'Factuur % staat al in het portaal voor dit project.', trim(p_nummer);
  end if;
  -- een nieuwe pdf (vervangen) mag, maar enkel in zijn eigen map
  if p_path is not null and p_path <> f.pdf_path and p_path !~ ('^' || p_project::text || '/' || cid::text || '/[A-Za-z0-9_-]+\.pdf$') then raise exception 'Ongeldig bestand.'; end if;
  update public.aannemer_facturen set nummer = left(trim(p_nummer), 60), datum = p_datum, vervaldag = p_vervaldag, bedrag_excl = round(p_excl, 2), btw_bedrag = round(p_btw, 2),
         omschrijving = left(coalesce(trim(p_omschrijving), ''), 1000), koppeling = uit,
         pdf_path = coalesce(p_path, f.pdf_path), pdf_naam = case when p_path is not null and p_path <> f.pdf_path then left(coalesce(nullif(trim(p_naam), ''), 'factuur.pdf'), 160) else f.pdf_naam end,
         status = 'ontvangen', gemeld = case when f.status = 'betwist' then false else f.gemeld end,   -- verbeterd na een vraag van BROS: opnieuw ter controle (en opnieuw melden)
         zichtbaar_klant = false   -- gewijzigd door de aannemer: pas opnieuw zichtbaar voor de klant als BROS dat beslist
   where id = f.id;
  return f.id;
end $$;

-- de map in de opslag waarin de aannemer voor dit project oplaadt: '<project>/<contact>' (zelfde contact als aannemer_factuur kiest)
create or replace function public.aannemer_factuur_map(p_project uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare cid uuid;
begin
  if not public.is_aannemer() or p_project is null or p_project not in (select public.aannemer_projecten()) then raise exception 'Geen toegang tot dit project.'; end if;
  select pc.contact_id into cid from public.project_contacten pc
   where pc.project_id = p_project and pc.contact_id in (select public.mijn_contacten()) and pc.rol not in ('bouwheer', 'contactpersoon')
   order by pc.contact_id limit 1;
  if cid is null then raise exception 'Geen toegang tot dit project.'; end if;
  return p_project::text || '/' || cid::text;
end $$;

-- intrekken (zolang BROS ze niet goedkeurde); geeft het pad terug zodat het portaal de pdf kan opruimen
create or replace function public.aannemer_factuur_weg(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare f public.aannemer_facturen;
begin
  if not public.is_aannemer() then raise exception 'Geen toegang.'; end if;
  select * into f from public.aannemer_facturen where id = p_id for update;
  if f.id is null or f.contact_id not in (select public.mijn_contacten()) or f.project_id not in (select public.aannemer_projecten()) then raise exception 'Factuur niet gevonden.'; end if;
  if f.status not in ('ontvangen', 'betwist') then raise exception 'BROS heeft deze factuur al goedgekeurd; verwijderen kan niet meer.'; end if;
  delete from public.aannemer_facturen where id = f.id;
  return f.pdf_path;
end $$;

-- ---------- 4. opslag (pdf) ----------
-- mag de ingelogde gebruiker dit bestand lezen? (eigen factuur, beheer, of klant bij een zichtbare factuur)
create or replace function public.aannemerfactuur_leesbaar(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_beheer()
      or (public.is_aannemer() and split_part(p_name, '/', 2) in (select x::text from public.mijn_contacten() x)
          and split_part(p_name, '/', 1) in (select x::text from public.aannemer_projecten() x))
      or exists (select 1 from public.aannemer_facturen f where f.pdf_path = p_name and f.zichtbaar_klant and f.project_id in (select public.klant_projecten()))
$$;
-- mag de aannemer dit bestand verwijderen? enkel in zijn map en enkel als geen factuur er nog naar wijst (intrekken/vervangen gaan via de functies)
create or replace function public.aannemerfactuur_weg_ok(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_beheer()
      or (public.is_aannemer() and split_part(p_name, '/', 2) in (select x::text from public.mijn_contacten() x)
          and split_part(p_name, '/', 1) in (select x::text from public.aannemer_projecten() x)
          and not exists (select 1 from public.aannemer_facturen f where f.pdf_path = p_name))   -- enkel een pdf waar geen factuur (meer) naar wijst: geen stille wissel van de pdf achter een factuur
$$;
create or replace function public.aannemerfacturen_aantal(p_map text)
returns int language sql stable security definer set search_path = public, storage as $$
  select count(*)::int from storage.objects o where o.bucket_id = 'aannemerfacturen' and o.name like p_map || '/%'
     and o.created_at > now() - interval '1 day'
     and split_part(p_map, '/', 2) in (select x::text from public.mijn_contacten() x)   -- enkel de eigen map tellen
$$;
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public) values ('aannemerfacturen', 'aannemerfacturen', false) on conflict (id) do update set public = false;
    if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
      update storage.buckets set file_size_limit = 15728640, allowed_mime_types = array['application/pdf'] where id = 'aannemerfacturen';
    end if;
    execute 'drop policy if exists aannemerfacturen_insert on storage.objects';
    execute 'drop policy if exists aannemerfacturen_read on storage.objects';
    execute 'drop policy if exists aannemerfacturen_delete on storage.objects';
    execute $p$create policy aannemerfacturen_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'aannemerfacturen' and lower(name) like '%.pdf' and split_part(name, '/', 4) = '' and split_part(name, '/', 3) <> ''
      and split_part(name, '/', 1) in (select x::text from public.aannemer_projecten() x)
      and split_part(name, '/', 2) in (select x::text from public.mijn_contacten() x)
      and public.aannemerfacturen_aantal(split_part(name, '/', 1) || '/' || split_part(name, '/', 2)) < 40)$p$;
    execute $p$create policy aannemerfacturen_read on storage.objects for select to authenticated using (
      bucket_id = 'aannemerfacturen' and public.aannemerfactuur_leesbaar(name))$p$;
    execute $p$create policy aannemerfacturen_delete on storage.objects for delete to authenticated using (
      bucket_id = 'aannemerfacturen' and public.aannemerfactuur_weg_ok(name))$p$;
  end if;
end $$;

-- ---------- 5. hulp-assistent van het aannemersportaal (log, daglimiet) ----------
create table if not exists public.aannemer_hulp (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  vraag text not null,
  antwoord text not null default '',
  model text not null default '',
  tokens_in int not null default 0,
  tokens_uit int not null default 0,
  kost_usd numeric(10,6) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists aannemer_hulp_user on public.aannemer_hulp (user_id, created_at desc);
create index if not exists aannemer_hulp_tijd on public.aannemer_hulp (created_at desc);
alter table public.aannemer_hulp enable row level security;
drop policy if exists aannemer_hulp_beheer on public.aannemer_hulp;
create policy aannemer_hulp_beheer on public.aannemer_hulp for select to authenticated using ((select public.is_beheer()));
revoke all on public.aannemer_hulp from anon, authenticated;
grant select on public.aannemer_hulp to authenticated;   -- schrijven enkel door de Edge Function (service key)

-- ---------- 6. realtime (Planbord ziet een nieuwe factuur meteen) ----------
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'aannemer_facturen') then
    alter publication supabase_realtime add table public.aannemer_facturen;
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
revoke all on function public.pb_gebruik() from public, anon, authenticated;
grant execute on function public.pb_gebruik() to service_role;
revoke all on function public.aannemer_factuur_status() from public, anon, authenticated;
revoke all on function public.aannemerfacturen_aantal(text) from public, anon;
revoke all on public.aannemer_hulp from anon;
revoke insert, update, delete, truncate, references, trigger on public.aannemer_hulp from authenticated;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(47, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: moet 2 | 1 | 3 teruggeven (2 tabellen, de opslag, 3 functies voor de aannemer)
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('aannemer_facturen', 'aannemer_hulp'))::int as tabellen,
       (select count(*) from storage.buckets where id = 'aannemerfacturen')::int as opslag,
       (select count(*) from pg_proc where proname in ('aannemer_factuur', 'aannemer_factuur_weg', 'aannemer_factuur_map'))::int as functies;
