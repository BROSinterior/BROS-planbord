-- =====================================================================
--  BROS Planbord — databasescript 035: klantenportaal fase 2
--  1. Keuzes en materialen: per project keuzes (tegels, kranen, kleuren …) met opties (foto's, meerprijs). De klant kiest
--     in het portaal met naam en vinkje; een optie met meer- of minprijs wordt meteen een meer-/minwerkpost met akkoord
--     (klantprijs = de meerprijs). BROS kan een keuze heropenen (de post verdwijnt dan weer).
--  2. Meerwerk aanvragen: de klant beschrijft wat hij extra wil (met foto's); BROS behandelt het en koppelt er een
--     voorstel (goedkeuring) aan, of antwoordt.
--  3. Werfpunten melden: de klant meldt een punt met foto's; het komt binnen als "te beoordelen" in de werfopvolging.
--     Pas als BROS het goedkeurt (en een verantwoordelijke kiest), ziet de aannemer het.
--  Foto's van de klant: bucket 'werf', map <project>/klant/ (enkel jpg, enkel zijn eigen projecten).
--  Vereist schema 34. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 34 then
    raise exception 'Voer eerst de scripts tot en met 034 uit.';
  end if;
end $$;

-- ---------- 1. keuzes en materialen ----------
create table if not exists public.keuzes (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projecten(id) on delete cascade,
  ruimte            text not null default '',
  onderwerp         text not null,
  toelichting       text not null default '',
  lot               int references public.loten(nr) on delete set null,   -- lot voor de meer-/minwerkpost
  deadline          date,
  volgorde          int not null default 0,
  status            text not null default 'concept' check (status in ('concept', 'open', 'gekozen', 'bevestigd', 'vervallen')),
  gekozen_optie     uuid,
  gekozen_op        timestamptz,
  gekozen_naam      text not null default '',
  gekozen_door      uuid references public.profiles(id),
  gekozen_opmerking text not null default '',
  meerwerk_post     uuid references public.meetstaat_posten(id) on delete set null,
  created_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists keuzes_project_idx on public.keuzes(project_id);
create table if not exists public.keuze_opties (
  id          uuid primary key default gen_random_uuid(),
  keuze_id    uuid not null references public.keuzes(id) on delete cascade,
  naam        text not null,
  omschrijving text not null default '',
  leverancier text not null default '',
  referentie  text not null default '',
  link        text not null default '',
  meerprijs   numeric(12,2) not null default 0,   -- excl. btw t.o.v. de offerte; 0 = inbegrepen, negatief = minprijs
  fotos       jsonb not null default '[]'::jsonb,  -- [{path, url, w, h}] in de bucket 'werf' (<project>/keuzes/…)
  volgorde    int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists keuze_opties_keuze_idx on public.keuze_opties(keuze_id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'keuzes_gekozen_optie_fk') then
    alter table public.keuzes add constraint keuzes_gekozen_optie_fk foreign key (gekozen_optie) references public.keuze_opties(id) on delete set null;
  end if;
end $$;
drop trigger if exists keuzes_touch on public.keuzes;
create trigger keuzes_touch before update on public.keuzes for each row execute function public.touch_updated_at();

alter table public.keuzes enable row level security;
alter table public.keuze_opties enable row level security;
drop policy if exists keuzes_intern on public.keuzes;
create policy keuzes_intern on public.keuzes for all to authenticated using (public.is_intern()) with check (public.is_intern());
drop policy if exists keuze_opties_intern on public.keuze_opties;
create policy keuze_opties_intern on public.keuze_opties for all to authenticated using (public.is_intern()) with check (public.is_intern());

create or replace view public.klant_keuzes as
  select k.id, k.project_id, k.ruimte, k.onderwerp, k.toelichting, k.deadline, k.volgorde, k.status,
         k.gekozen_optie, k.gekozen_op, k.gekozen_naam, k.gekozen_opmerking
  from public.keuzes k
  where k.status <> 'concept' and k.project_id in (select public.klant_projecten());
create or replace view public.klant_keuze_opties as
  select o.id, o.keuze_id, o.naam, o.omschrijving, o.leverancier, o.referentie, o.link, o.meerprijs, o.fotos, o.volgorde
  from public.keuze_opties o join public.keuzes k on k.id = o.keuze_id
  where k.status <> 'concept' and k.project_id in (select public.klant_projecten());

-- de klant kiest: met naam (en vinkje in het portaal); meer-/minprijs → meer-/minwerkpost met akkoord
drop function if exists public.klant_keuze_maken(uuid, uuid, text, text);
create or replace function public.klant_keuze_maken(p_keuze uuid, p_optie uuid, p_naam text, p_opmerking text default '', p_meerprijs numeric default null)
returns public.keuzes language plpgsql security definer set search_path = public as $$
declare k public.keuzes; o public.keuze_opties; p public.projecten; v_lot int; v_post uuid; v_btw numeric; v_volg int;
begin
  if not public.is_klant() then raise exception 'Geen toegang.'; end if;
  select * into k from public.keuzes where id = p_keuze for update;
  if k.id is null or k.project_id not in (select public.klant_projecten()) then raise exception 'Keuze niet gevonden.'; end if;
  if k.status <> 'open' then raise exception 'Deze keuze is al gemaakt of niet meer open. Wil je iets wijzigen? Laat het BROS weten.'; end if;
  select * into o from public.keuze_opties where id = p_optie and keuze_id = k.id;
  if o.id is null then raise exception 'Deze optie hoort niet bij deze keuze.'; end if;
  if length(trim(coalesce(p_naam, ''))) < 2 then raise exception 'Vul je naam in.'; end if;
  -- de klant keurt de prijs goed die hij zag: werd ze intussen gewijzigd, dan eerst opnieuw laten bekijken
  if p_meerprijs is not null and round(p_meerprijs, 2) <> o.meerprijs then
    raise exception 'De prijs van deze optie werd net aangepast. Herlaad de pagina en bekijk de nieuwe prijs.';
  end if;
  if o.meerprijs <> 0 then
    select * into p from public.projecten where id = k.project_id;
    perform pg_advisory_xact_lock(hashtext('keuzepost:' || k.project_id::text));   -- volgnummer en code uniek, ook bij gelijktijdige keuzes
    v_lot := coalesce(k.lot, (select min(nr) from public.loten where actief is not false));
    if v_lot is null then raise exception 'BROS moet deze keuze nog vervolledigen — laat het hen even weten.'; end if;
    v_btw := coalesce(p.btw_tarief, 6)::numeric / 100;   -- 0 % (btw verlegd) blijft 0 %
    select coalesce(max(volgorde), 0) + 1 into v_volg from public.meetstaat_posten where project_id = k.project_id and lot = v_lot;
    insert into public.meetstaat_posten (project_id, lot, code, groep, omschrijving, locatie, eenheid, prijstype, hoeveelheid, btw, status, volgorde, akkoord_op, opmerking)
    values (k.project_id, v_lot, v_lot || '.K' || v_volg, 'KEUZES', left('Keuze ' || k.onderwerp || ': ' || o.naam, 500), k.ruimte, 'stk', 'EP', 1, v_btw,
            case when o.meerprijs < 0 then 'minwerk' else 'meerwerk' end, v_volg, now(), 'Gekozen door ' || left(trim(p_naam), 120) || ' in het klantenportaal')
    returning id into v_post;
    insert into public.meetstaat_prijzen (post_id, eenheidsprijs, marge) values (v_post, abs(o.meerprijs), 0)
      on conflict (post_id) do update set eenheidsprijs = excluded.eenheidsprijs, marge = excluded.marge;
  end if;
  update public.keuzes set status = 'gekozen', gekozen_optie = o.id, gekozen_op = now(), gekozen_naam = left(trim(p_naam), 120), gekozen_door = auth.uid(),
         gekozen_opmerking = left(trim(coalesce(p_opmerking, '')), 1000), meerwerk_post = v_post
   where id = k.id returning * into k;
  return k;
end $$;
revoke all on function public.klant_keuze_maken(uuid, uuid, text, text, numeric) from public, anon;
grant execute on function public.klant_keuze_maken(uuid, uuid, text, text, numeric) to authenticated;

-- ---------- 2. meerwerk aanvragen ----------
create table if not exists public.meerwerk_aanvragen (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projecten(id) on delete cascade,
  contact_id    uuid references public.contacten(id) on delete set null,
  user_id       uuid references public.profiles(id),
  titel         text not null,
  omschrijving  text not null default '',
  ruimte        text not null default '',
  fotos         jsonb not null default '[]'::jsonb,
  status        text not null default 'ingediend' check (status in ('ingediend', 'in_behandeling', 'voorstel', 'geweigerd', 'ingetrokken')),
  antwoord      text not null default '',
  goedkeuring_id uuid references public.goedkeuringen(id) on delete set null,
  behandeld_door uuid references public.profiles(id),
  behandeld_op  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists meerwerk_aanvragen_project_idx on public.meerwerk_aanvragen(project_id);
drop trigger if exists meerwerk_aanvragen_touch on public.meerwerk_aanvragen;
create trigger meerwerk_aanvragen_touch before update on public.meerwerk_aanvragen for each row execute function public.touch_updated_at();
alter table public.meerwerk_aanvragen enable row level security;
drop policy if exists mwa_intern on public.meerwerk_aanvragen;
create policy mwa_intern on public.meerwerk_aanvragen for all to authenticated using (public.is_intern()) with check (public.is_intern());

create or replace view public.klant_meerwerk_aanvragen as
  select a.id, a.project_id, a.titel, a.omschrijving, a.ruimte, a.fotos, a.status, a.antwoord, a.goedkeuring_id, a.created_at, a.behandeld_op
  from public.meerwerk_aanvragen a
  where a.project_id in (select public.klant_projecten());

create or replace function public.klant_meerwerk_aanvragen(p_project uuid, p_titel text, p_omschrijving text, p_ruimte text default '', p_fotos jsonb default '[]'::jsonb)
returns public.meerwerk_aanvragen language plpgsql security definer set search_path = public as $$
declare a public.meerwerk_aanvragen;
begin
  if not public.is_klant() or p_project not in (select public.klant_projecten()) then raise exception 'Geen toegang.'; end if;
  if length(trim(coalesce(p_titel, ''))) < 3 then raise exception 'Geef je vraag een korte titel.'; end if;
  if (select count(*) from public.meerwerk_aanvragen where user_id = auth.uid() and created_at > now() - interval '1 day') >= 15 then
    raise exception 'Je hebt vandaag al veel aanvragen ingediend — neem gerust contact op met je aanspreekpunt.';
  end if;
  if not public.fotos_geldig(p_fotos, p_project || '/klant/') or jsonb_array_length(coalesce(p_fotos, '[]'::jsonb)) > 10 then raise exception 'Ongeldige foto''s.'; end if;
  insert into public.meerwerk_aanvragen (project_id, contact_id, user_id, titel, omschrijving, ruimte, fotos)
  values (p_project, (select pc.contact_id from public.project_contacten pc join public.contacten c on c.id = pc.contact_id
                      where pc.project_id = p_project and c.user_id = auth.uid() and c.actief limit 1),
          auth.uid(), left(trim(p_titel), 160), left(trim(coalesce(p_omschrijving, '')), 4000), left(trim(coalesce(p_ruimte, '')), 120), coalesce(p_fotos, '[]'::jsonb))
  returning * into a;
  return a;
end $$;
revoke all on function public.klant_meerwerk_aanvragen(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.klant_meerwerk_aanvragen(uuid, text, text, text, jsonb) to authenticated;

create or replace function public.klant_meerwerk_intrekken(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_klant() then raise exception 'Geen toegang.'; end if;
  update public.meerwerk_aanvragen set status = 'ingetrokken'
   where id = p_id and project_id in (select public.klant_projecten()) and status in ('ingediend', 'in_behandeling');
  if not found then raise exception 'Deze aanvraag kan niet meer ingetrokken worden.'; end if;
end $$;
revoke all on function public.klant_meerwerk_intrekken(uuid) from public, anon;
grant execute on function public.klant_meerwerk_intrekken(uuid) to authenticated;

-- ---------- 3. werfpunten melden door de klant ----------
alter table public.vaststellingen add column if not exists gemeld_door_klant uuid references public.contacten(id) on delete set null;
alter table public.vaststellingen add column if not exists te_beoordelen boolean not null default false;

-- de aannemer ziet een door de klant gemeld punt pas na goedkeuring door BROS (zelfde kolommen als script 025)
create or replace view public.aan_vaststellingen as
  select v.id, v.project_id, v.bezoek_id, v.nr, v.titel, v.omschrijving, v.ruimte, v.lot, v.contact_id, v.prioriteit, v.deadline, v.status,
         v.fotos, v.opgelost_op, v.opgelost_fotos, v.opmerking, v.plan_id, v.plan_x, v.plan_y, v.created_at, v.updated_at,
         (select datum from public.werfbezoeken b where b.id = v.bezoek_id) as bezoek_datum
  from public.vaststellingen v
  where v.contact_id in (select public.mijn_contacten()) and v.project_id in (select public.aannemer_projecten()) and not v.te_beoordelen;

-- wat de klant ziet: de punten die hij zelf meldde (punten van BROS deelt hij via de werfverslagen, zoals voorheen)
drop view if exists public.klant_vaststellingen;
create view public.klant_vaststellingen as
  select v.id, v.project_id, v.nr, v.titel, v.omschrijving, v.ruimte, v.status, v.fotos, v.opgelost_op, v.opgelost_fotos, v.deadline,
         v.te_beoordelen, true as door_klant, v.created_at, v.updated_at
  from public.vaststellingen v
  where v.gemeld_door_klant in (select public.mijn_contacten()) and v.project_id in (select public.klant_projecten());

create or replace function public.klant_werfpunt_melden(p_project uuid, p_titel text, p_omschrijving text, p_ruimte text default '', p_fotos jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_contact uuid;
begin
  if not public.is_klant() or p_project not in (select public.klant_projecten()) then raise exception 'Geen toegang.'; end if;
  if length(trim(coalesce(p_titel, ''))) < 3 then raise exception 'Geef het punt een korte titel.'; end if;
  if (select count(*) from public.vaststellingen v join public.contacten c on c.id = v.gemeld_door_klant where c.user_id = auth.uid() and v.created_at > now() - interval '1 day') >= 40 then
    raise exception 'Je hebt vandaag al veel punten gemeld — bel gerust je aanspreekpunt.';
  end if;
  if not public.fotos_geldig(p_fotos, p_project || '/klant/') or jsonb_array_length(coalesce(p_fotos, '[]'::jsonb)) > 10 then raise exception 'Ongeldige foto''s.'; end if;
  select pc.contact_id into v_contact from public.project_contacten pc join public.contacten c on c.id = pc.contact_id
   where pc.project_id = p_project and c.user_id = auth.uid() and c.actief limit 1;
  insert into public.vaststellingen (project_id, titel, omschrijving, ruimte, status, prioriteit, klant_zichtbaar, te_beoordelen, gemeld_door_klant, fotos, created_by)
  values (p_project, left(trim(p_titel), 160), left(trim(coalesce(p_omschrijving, '')), 4000), left(trim(coalesce(p_ruimte, '')), 120), 'open', 'normaal', true, true, v_contact,
          coalesce(p_fotos, '[]'::jsonb), auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.klant_werfpunt_melden(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.klant_werfpunt_melden(uuid, text, text, text, jsonb) to authenticated;

-- aannemer: een punt dat nog te beoordelen is, kan hij niet melden of aanvullen (zelfde functie als script 031 + die voorwaarde)
create or replace function public.aannemer_vaststelling_melden(p_id uuid, p_status text default null, p_opmerking text default null, p_fotos jsonb default '[]'::jsonb)
returns public.vaststellingen language plpgsql security definer set search_path = public as $$
declare v public.vaststellingen; nieuw jsonb := '[]'::jsonb; f jsonb;
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
  if p_status = 'opgelost' then
    if v.status <> 'open' then raise exception 'Dit punt staat niet meer open.'; end if;
    update public.vaststellingen set status = 'opgelost', opgelost_op = now(), opgelost_door = auth.uid(),
      opmerking = coalesce(nullif(left(trim(p_opmerking), 2000), ''), opmerking), opgelost_fotos = opgelost_fotos || nieuw, updated_at = now() where id = p_id returning * into v;
  elsif p_status is not null then
    raise exception 'Een aannemer kan een punt enkel als opgelost melden.';
  else
    update public.vaststellingen set opmerking = coalesce(nullif(left(trim(p_opmerking), 2000), ''), opmerking), opgelost_fotos = opgelost_fotos || nieuw, updated_at = now() where id = p_id returning * into v;
  end if;
  return v;
end $$;

-- taak voor de verantwoordelijke pas na goedkeuring (zelfde functie als script 019, met die ene voorwaarde erbij)
create or replace function public.vaststelling_taak()
returns trigger language plpgsql security definer set search_path = public as $$
declare t_id uuid; t_status text; p_fase int; v_titel text;
begin
  if pg_trigger_depth() > 1 then return new; end if;
  select id into t_id from public.taken where vaststelling_id = new.id limit 1;
  v_titel := 'V-' || lpad(new.nr::text, 3, '0') || ' · ' || coalesce(nullif(trim(new.titel), ''), left(regexp_replace(coalesce(new.omschrijving, ''), '\s+', ' ', 'g'), 120));
  t_status := case when new.status in ('opgelost', 'gecontroleerd') then 'done' when new.status = 'vervallen' then 'done' else 'todo' end;
  if (new.contact_id is null and new.assignee is null) or new.te_beoordelen then
    if t_id is not null then delete from public.taken where id = t_id and status <> 'done'; end if;
    return new;
  end if;
  if t_id is null then
    select fase_nr into p_fase from public.projecten where id = new.project_id;
    insert into public.taken (project_id, titel, fase_nr, assignee, contact_id, status, start, eind, uren_gepland, notitie, volgorde, vaststelling_id)
    values (new.project_id, v_titel, p_fase, new.assignee, new.contact_id, t_status, null, new.deadline, 0, coalesce(new.ruimte, ''), 9500 + coalesce(new.nr, 0), new.id);
  else
    update public.taken set titel = v_titel, assignee = new.assignee, contact_id = new.contact_id, status = t_status, eind = new.deadline,
      notitie = coalesce(nullif(new.ruimte, ''), notitie), updated_at = now()
    where id = t_id;
  end if;
  return new;
end $$;
drop trigger if exists vaststellingen_taak on public.vaststellingen;
create trigger vaststellingen_taak after insert or update of titel, omschrijving, ruimte, contact_id, assignee, deadline, status, nr, te_beoordelen on public.vaststellingen
  for each row execute function public.vaststelling_taak();

-- foto's van de klant: enkel jpg in <eigen project>/klant/
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
        or (public.is_klant()
            and split_part(name, '/', 1) in (select public.klant_projecten()::text)
            and split_part(name, '/', 2) = 'klant'
            and split_part(name, '/', 4) = '' and lower(name) like '%.jpg')))$p$;
  end if;
end $$;

-- ---------- live bijwerken (script 034) voor de nieuwe tabellen ----------
do $$
declare t text;
begin
  foreach t in array array['keuzes', 'meerwerk_aanvragen'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_portaal_ping', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.portaal_ping(%L)', t || '_portaal_ping', t, 'project_id');
  end loop;
end $$;
create or replace function public.keuze_optie_ping()
returns trigger language plpgsql security definer set search_path = public as $$
declare p uuid;
begin
  select k.project_id into p from public.keuzes k where k.id = coalesce(new.keuze_id, old.keuze_id) and k.status <> 'concept';
  if p is not null then
    insert into public.portaal_pings (project_id, gewijzigd_op) values (p, now())
    on conflict (project_id) do update set gewijzigd_op = now() where public.portaal_pings.gewijzigd_op < now();
  end if;
  return null;
end $$;
drop trigger if exists keuze_opties_portaal_ping on public.keuze_opties;
create trigger keuze_opties_portaal_ping after insert or update or delete on public.keuze_opties for each row execute function public.keuze_optie_ping();

-- realtime voor het Planbord (nieuwe aanvraag of keuze van de klant meteen zichtbaar)
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['keuzes', 'keuze_opties', 'meerwerk_aanvragen'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------- rechten ----------
select public.rechten_herstellen();
revoke insert, update, delete, truncate, references, trigger on public.portaal_pings from authenticated, anon;
revoke all on function public.portaal_ping() from public, anon, authenticated;
revoke all on function public.keuze_optie_ping() from public, anon, authenticated;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(35, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: moet 3 | 2 | 2 teruggeven
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('keuzes', 'keuze_opties', 'meerwerk_aanvragen'))::int as tabellen,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'vaststellingen' and column_name in ('gemeld_door_klant', 'te_beoordelen'))::int as werfpuntkolommen,
       (select count(*) from pg_proc where proname in ('klant_keuze_maken', 'klant_werfpunt_melden'))::int as functies;
