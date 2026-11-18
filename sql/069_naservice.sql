-- =====================================================================
--  BROS Planbord — databasescript 069: Naservice (v1.77)
--  - projecten: voorlopige oplevering (aanvinken + datum), termijn tot de definitieve oplevering (standaard 12 maanden)
--    en de definitieve oplevering (automatisch na de termijn, met proces-verbaal; open punten worden voorbehoud).
--  - naservice_punten: alles wat na de voorlopige oplevering gemeld wordt — door de klant in het portaal (met foto's)
--    of door BROS geregistreerd (mail, telefoon, werfbezoek).
--  - naservice_gebeurtenissen: de volledige tijdlijn per punt (en per project): ontvangen, beoordeeld, toegewezen,
--    ingepland, opgelost, afgesloten, berichten en zelf geregistreerde acties — wie, wat, wanneer. Kan niet gewijzigd
--    of gewist worden (een correctie is een nieuwe regel).
--  - Klant en aannemer zien elk hun deel via views; acties lopen via naservice_actie (één ingang, altijd met historiek).
--  Vereist schema 68. Alleen toevoegingen; mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 68 then
    raise exception 'Voer eerst de scripts tot en met 068 uit.';
  end if;
end $$;

-- ---------- 1. oplevering per project ----------
alter table public.projecten
  add column if not exists voorlopig_opgeleverd_op   date,                    -- aangevinkt in het tabblad Naservice
  add column if not exists oplevering_termijn_maanden int not null default 12, -- tot de definitieve oplevering (Woningbouwwet: minstens 1 jaar)
  add column if not exists oplevering_opmerking      text not null default '',
  add column if not exists definitief_opgeleverd_op  date,
  add column if not exists definitief_automatisch    boolean not null default false,
  add column if not exists definitief_pv_drive_id    text,
  add column if not exists definitief_pv_document    uuid references public.documenten(id) on delete set null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'projecten_oplevering_termijn_chk') then
    alter table public.projecten add constraint projecten_oplevering_termijn_chk check (oplevering_termijn_maanden between 1 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projecten_definitief_na_voorlopig_chk') then
    alter table public.projecten add constraint projecten_definitief_na_voorlopig_chk check (definitief_opgeleverd_op is null or (voorlopig_opgeleverd_op is not null and definitief_opgeleverd_op >= voorlopig_opgeleverd_op));
  end if;
end $$;
create index if not exists projecten_naservice_idx on public.projecten (voorlopig_opgeleverd_op) where voorlopig_opgeleverd_op is not null and definitief_opgeleverd_op is null;

-- ---------- 2. punten ----------
create table if not exists public.naservice_punten (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projecten(id) on delete cascade,
  nr              int not null default 0,                         -- NS-001 … per project
  titel           text not null,
  omschrijving    text not null default '',
  ruimte          text not null default '',
  fotos           jsonb not null default '[]'::jsonb,             -- [{path,url,w,h}]
  bron            text not null default 'klant' check (bron in ('klant', 'mail', 'telefoon', 'werfbezoek', 'bros', 'aannemer')),
  ontvangen_op    timestamptz not null default now(),             -- wanneer het probleem binnenkwam (bij mail: de datum van de mail)
  gemeld_door     uuid references public.contacten(id) on delete set null,
  gemeld_naam     text not null default '',
  status          text not null default 'ontvangen' check (status in ('ontvangen', 'aanvaard', 'ingepland', 'opgelost', 'afgesloten', 'geweigerd')),
  prioriteit      text not null default 'normaal' check (prioriteit in ('normaal', 'dringend')),
  contact_id      uuid references public.contacten(id) on delete set null,   -- aannemer die het oplost
  gepland_op      date,
  opgelost_op     timestamptz,
  afgesloten_op   timestamptz,
  klant_zichtbaar boolean not null default true,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists naservice_punten_project_idx on public.naservice_punten (project_id, status);
create index if not exists naservice_punten_contact_idx on public.naservice_punten (contact_id) where contact_id is not null;

create table if not exists public.naservice_gebeurtenissen (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projecten(id) on delete cascade,
  punt_id            uuid references public.naservice_punten(id) on delete cascade,   -- leeg = over het project (oplevering)
  soort              text not null check (soort in ('ontvangen', 'aanvaard', 'geweigerd', 'toegewezen', 'ingepland', 'opgelost', 'afgesloten', 'heropend',
                                                   'bericht', 'registratie', 'voorlopig', 'definitief', 'termijn', 'voorbehoud')),
  tekst              text not null default '',
  fotos              jsonb not null default '[]'::jsonb,
  datum              date,                                   -- bv. de geplande datum
  door_user          uuid references auth.users(id) on delete set null,
  door_naam          text not null default '',
  door_rol           text not null default 'bros' check (door_rol in ('bros', 'klant', 'aannemer', 'systeem')),
  op                 timestamptz not null default now(),     -- wanneer het gebeurde (bij een zelf geregistreerde actie: de opgegeven datum)
  zichtbaar_klant    boolean not null default true,
  zichtbaar_aannemer boolean not null default true,
  melden             boolean not null default false,          -- het Drive-script mailt de betrokkenen
  gemeld_op          timestamptz,
  gemeld_naar        text not null default '',
  created_at         timestamptz not null default now()      -- wanneer het geregistreerd werd (vast)
);
create index if not exists naservice_gebeurtenissen_punt_idx on public.naservice_gebeurtenissen (punt_id, op);
create index if not exists naservice_gebeurtenissen_project_idx on public.naservice_gebeurtenissen (project_id, op);
create index if not exists naservice_gebeurtenissen_melden_idx on public.naservice_gebeurtenissen (created_at) where melden and gemeld_op is null;

alter table public.naservice_punten enable row level security;
alter table public.naservice_gebeurtenissen enable row level security;
drop policy if exists ns_intern on public.naservice_punten;
create policy ns_intern on public.naservice_punten for all to authenticated using ((select public.is_intern())) with check ((select public.is_intern()));
drop policy if exists nsg_intern_lezen on public.naservice_gebeurtenissen;
create policy nsg_intern_lezen on public.naservice_gebeurtenissen for select to authenticated using ((select public.is_intern()));
revoke all on public.naservice_punten, public.naservice_gebeurtenissen from anon;
grant select, insert, update, delete on public.naservice_punten to authenticated;
grant select on public.naservice_gebeurtenissen to authenticated;   -- schrijven enkel via naservice_actie en de triggers

-- wie doet het? (naam en rol van de ingelogde gebruiker)
create or replace function public.ns_wie(out naam text, out rol text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then naam := 'Planbord'; rol := 'systeem'; return; end if;
  if public.is_intern() then rol := 'bros'; elsif public.is_aannemer() then rol := 'aannemer'; elsif public.is_klant() then rol := 'klant'; else rol := 'systeem'; end if;
  if rol in ('klant', 'aannemer') then
    select coalesce(nullif(c.contactpersoon, ''), c.naam) into naam from public.contacten c where c.id in (select public.mijn_contacten()) order by c.naam limit 1;
  end if;
  if coalesce(naam, '') = '' then select coalesce(nullif(p.name, ''), p.email) into naam from public.profiles p where p.id = auth.uid(); end if;
  naam := coalesce(naam, '');
end $$;

-- nummer + vaste velden bij een nieuw punt; status, aannemer en planning wijzigen enkel via naservice_actie
create or replace function public.ns_punt_voor()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('ns:' || new.project_id));
    new.nr := coalesce((select max(nr) from public.naservice_punten where project_id = new.project_id), 0) + 1;
    if current_user in ('authenticated', 'anon') and coalesce(current_setting('naservice.actie', true), '') <> '1' then
      new.status := 'ontvangen'; new.contact_id := null; new.gepland_op := null; new.opgelost_op := null; new.afgesloten_op := null;
    end if;
    new.titel := left(trim(new.titel), 160);
    if length(new.titel) < 3 then raise exception 'Geef het punt een korte titel.'; end if;
    if new.created_by is null then new.created_by := auth.uid(); end if;
    return new;
  end if;
  if current_user in ('authenticated', 'anon') and coalesce(current_setting('naservice.actie', true), '') <> '1'
     and ((new.status, new.contact_id, new.gepland_op, new.opgelost_op, new.afgesloten_op, new.nr, new.project_id, new.bron, new.ontvangen_op, new.gemeld_door)
          is distinct from (old.status, old.contact_id, old.gepland_op, old.opgelost_op, old.afgesloten_op, old.nr, old.project_id, old.bron, old.ontvangen_op, old.gemeld_door)) then
    raise exception 'Status, aannemer, planning en ontvangst van een naservicepunt wijzig je met de knoppen (zo blijft de historiek volledig).';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists ns_punt_voor on public.naservice_punten;
create trigger ns_punt_voor before insert or update on public.naservice_punten for each row execute function public.ns_punt_voor();

-- een punt verwijderen kan enkel zolang er niets mee gebeurde (anders: afsluiten of "niet onder naservice")
create or replace function public.ns_punt_weg()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and pg_trigger_depth() = 1
     and (old.status <> 'ontvangen' or exists (select 1 from public.naservice_gebeurtenissen g where g.punt_id = old.id and g.soort <> 'ontvangen')) then
    raise exception 'Met dit punt is al iets gebeurd: het blijft bewaard. Sluit het af of zet het op "niet onder naservice".';
  end if;
  return old;
end $$;
drop trigger if exists ns_punt_weg on public.naservice_punten;
create trigger ns_punt_weg before delete on public.naservice_punten for each row execute function public.ns_punt_weg();

-- elk nieuw punt: eerste regel in de tijdlijn (ontvangen)
create or replace function public.ns_punt_na()
returns trigger language plpgsql security definer set search_path = public as $$
declare w record; v_tekst text;
begin
  select * into w from public.ns_wie();
  v_tekst := case new.bron
    when 'klant' then 'Gemeld in het klantenportaal'
    when 'mail' then 'Ontvangen per mail' || case when new.gemeld_naam <> '' then ' van ' || new.gemeld_naam else '' end || ' — geregistreerd door ' || w.naam
    when 'telefoon' then 'Telefonisch gemeld' || case when new.gemeld_naam <> '' then ' door ' || new.gemeld_naam else '' end || ' — geregistreerd door ' || w.naam
    when 'werfbezoek' then 'Vastgesteld tijdens een bezoek — geregistreerd door ' || w.naam
    when 'aannemer' then 'Gemeld door de aannemer' || case when new.gemeld_naam <> '' then ' (' || new.gemeld_naam || ')' else '' end || ' — geregistreerd door ' || w.naam
    else 'Geregistreerd door ' || w.naam end;
  insert into public.naservice_gebeurtenissen (project_id, punt_id, soort, tekst, fotos, door_user, door_naam, door_rol, op, zichtbaar_klant, zichtbaar_aannemer, melden)
  values (new.project_id, new.id, 'ontvangen', v_tekst, '[]'::jsonb, auth.uid(),
          case when new.bron = 'klant' then coalesce(nullif(new.gemeld_naam, ''), w.naam) else coalesce(nullif(new.gemeld_naam, ''), w.naam) end,
          case when new.bron = 'klant' then 'klant' when w.rol = 'systeem' then 'systeem' else 'bros' end,
          new.ontvangen_op, new.klant_zichtbaar, true, true);
  return null;
end $$;
drop trigger if exists ns_punt_na on public.naservice_punten;
create trigger ns_punt_na after insert on public.naservice_punten for each row execute function public.ns_punt_na();

-- de tijdlijn ligt vast: niet wijzigen of wissen (enkel het Drive-script zet "gemaild")
create or replace function public.ns_tijdlijn_vast()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') or pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  raise exception 'De historiek van de naservice kan niet gewijzigd of gewist worden — voeg een nieuwe regel toe.';
end $$;
drop trigger if exists ns_tijdlijn_vast on public.naservice_gebeurtenissen;
create trigger ns_tijdlijn_vast before update or delete on public.naservice_gebeurtenissen for each row execute function public.ns_tijdlijn_vast();

-- ---------- 3. acties: één ingang voor BROS, klant en aannemer ----------
-- p_actie: aanvaard | geweigerd | toewijzen | ingepland | opgelost | afgesloten | heropend | bericht | registratie
create or replace function public.naservice_actie(p_punt uuid, p_actie text, p_tekst text default '', p_datum date default null, p_contact uuid default null,
                                                  p_fotos jsonb default '[]'::jsonb, p_klant boolean default true, p_aannemer boolean default true, p_op timestamptz default null)
returns public.naservice_punten language plpgsql security definer set search_path = public as $$
declare n public.naservice_punten; w record; v_soort text; v_tekst text := left(trim(coalesce(p_tekst, '')), 4000); v_melden boolean := true;
        v_klant boolean := coalesce(p_klant, true); v_aan boolean := coalesce(p_aannemer, true); v_op timestamptz := now(); v_naam text;
begin
  select * into n from public.naservice_punten where id = p_punt for update;
  if n.id is null then raise exception 'Naservicepunt niet gevonden.'; end if;
  select * into w from public.ns_wie();
  -- wie mag wat
  if w.rol = 'bros' then null;
  elsif w.rol = 'klant' then
    if n.project_id not in (select public.klant_projecten()) or not n.klant_zichtbaar then raise exception 'Geen toegang.'; end if;
    if p_actie <> 'bericht' then raise exception 'Je kan enkel een bericht of foto toevoegen.'; end if;
    if not public.fotos_geldig(p_fotos, n.project_id || '/klant/') then raise exception 'Ongeldige foto''s.'; end if;
    v_klant := true; v_aan := false;
  elsif w.rol = 'aannemer' then
    if n.contact_id is null or n.contact_id not in (select public.mijn_contacten()) or n.status in ('ontvangen', 'geweigerd') then raise exception 'Dit punt is niet aan jou toegewezen.'; end if;
    if p_actie not in ('ingepland', 'opgelost', 'bericht') then raise exception 'Een aannemer kan een datum inplannen, het punt als opgelost melden of een bericht sturen.'; end if;
    if not public.fotos_geldig(p_fotos, n.project_id || '/aannemer/') then raise exception 'Ongeldige foto''s.'; end if;
    v_aan := true; if p_actie = 'bericht' then v_klant := false; end if;
  else raise exception 'Geen toegang.';
  end if;
  if w.rol = 'bros' and not public.fotos_geldig(p_fotos, n.project_id || '/') then raise exception 'Ongeldige foto''s.'; end if;
  if jsonb_array_length(coalesce(p_fotos, '[]'::jsonb)) > 10 then raise exception 'Maximaal 10 foto''s.'; end if;
  perform set_config('naservice.actie', '1', true);
  v_soort := p_actie;
  if p_actie = 'aanvaard' then
    if n.status <> 'ontvangen' then raise exception 'Dit punt werd al beoordeeld.'; end if;
    update public.naservice_punten set status = 'aanvaard' where id = n.id returning * into n;
    if v_tekst = '' then v_tekst := 'Aanvaard als naservice'; end if;
  elsif p_actie = 'geweigerd' then
    if n.status in ('afgesloten', 'geweigerd') then raise exception 'Dit punt is al afgesloten.'; end if;
    if length(v_tekst) < 3 then raise exception 'Leg kort uit waarom dit niet onder de naservice valt (de klant ziet dit).'; end if;
    update public.naservice_punten set status = 'geweigerd', afgesloten_op = now() where id = n.id returning * into n;
  elsif p_actie = 'toewijzen' then
    if p_contact is null or not exists (select 1 from public.contacten c where c.id = p_contact and c.soort <> 'klant') then raise exception 'Kies een aannemer.'; end if;
    if n.status in ('afgesloten', 'geweigerd') then raise exception 'Dit punt is afgesloten — heropen het eerst.'; end if;
    if not exists (select 1 from public.project_contacten pc where pc.project_id = n.project_id and pc.contact_id = p_contact and pc.rol not in ('bouwheer', 'contactpersoon')) then
      insert into public.project_contacten (project_id, contact_id, rol) values (n.project_id, p_contact, 'aannemer');
    end if;
    select coalesce(nullif(c.naam, ''), c.bedrijf) into v_naam from public.contacten c where c.id = p_contact;
    update public.naservice_punten set contact_id = p_contact, status = case when status = 'ontvangen' then 'aanvaard' else status end where id = n.id returning * into n;
    v_soort := 'toegewezen'; v_tekst := 'Toegewezen aan ' || v_naam || case when v_tekst <> '' then E'\n' || v_tekst else '' end;
  elsif p_actie = 'ingepland' then
    if p_datum is null then raise exception 'Kies de datum van de herstelling.'; end if;
    if n.status in ('afgesloten', 'geweigerd') then raise exception 'Dit punt is afgesloten.'; end if;
    update public.naservice_punten set gepland_op = p_datum, status = case when status in ('ontvangen', 'aanvaard', 'ingepland') then 'ingepland' else status end where id = n.id returning * into n;
  elsif p_actie = 'opgelost' then
    if n.status in ('afgesloten', 'geweigerd', 'opgelost') then raise exception 'Dit punt staat niet meer open.'; end if;
    update public.naservice_punten set status = 'opgelost', opgelost_op = now() where id = n.id returning * into n;
  elsif p_actie = 'afgesloten' then
    if n.status in ('afgesloten', 'geweigerd') then raise exception 'Dit punt is al afgesloten.'; end if;
    update public.naservice_punten set status = 'afgesloten', afgesloten_op = now(), opgelost_op = coalesce(opgelost_op, now()) where id = n.id returning * into n;
  elsif p_actie = 'heropend' then
    if n.status not in ('opgelost', 'afgesloten', 'geweigerd') then raise exception 'Dit punt staat nog open.'; end if;
    if length(v_tekst) < 3 then raise exception 'Waarom wordt het punt heropend?'; end if;
    update public.naservice_punten set status = 'aanvaard', opgelost_op = null, afgesloten_op = null where id = n.id returning * into n;
  elsif p_actie = 'bericht' then
    if length(v_tekst) < 2 and jsonb_array_length(coalesce(p_fotos, '[]'::jsonb)) = 0 then raise exception 'Schrijf een bericht of voeg een foto toe.'; end if;
    v_melden := (w.rol <> 'bros') or v_klant or v_aan;
  elsif p_actie = 'registratie' and w.rol = 'bros' then
    if length(v_tekst) < 3 then raise exception 'Beschrijf de actie.'; end if;
    v_op := coalesce(p_op, now()); if v_op > now() + interval '1 hour' then raise exception 'Een geregistreerde actie kan niet in de toekomst liggen.'; end if;
    v_melden := false;
  else raise exception 'Onbekende actie.';
  end if;
  if w.rol = 'bros' and p_actie <> 'registratie' then v_op := now(); end if;
  insert into public.naservice_gebeurtenissen (project_id, punt_id, soort, tekst, fotos, datum, door_user, door_naam, door_rol, op, zichtbaar_klant, zichtbaar_aannemer, melden)
  values (n.project_id, n.id, v_soort, v_tekst, coalesce(p_fotos, '[]'::jsonb), case when p_actie = 'ingepland' then p_datum else null end, auth.uid(), w.naam, w.rol, v_op,
          v_klant and n.klant_zichtbaar, v_aan and n.contact_id is not null, v_melden);
  perform set_config('naservice.actie', '', true);
  return n;
end $$;
revoke all on function public.naservice_actie(uuid, text, text, date, uuid, jsonb, boolean, boolean, timestamptz) from public, anon;
grant execute on function public.naservice_actie(uuid, text, text, date, uuid, jsonb, boolean, boolean, timestamptz) to authenticated;

-- de klant meldt een punt (portaal), met foto's
create or replace function public.naservice_melden(p_project uuid, p_titel text, p_omschrijving text default '', p_ruimte text default '', p_fotos jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_contact uuid; v_naam text;
begin
  if not public.is_klant() or p_project not in (select public.klant_projecten()) then raise exception 'Geen toegang.'; end if;
  if not exists (select 1 from public.projecten where id = p_project and voorlopig_opgeleverd_op is not null) then raise exception 'De naservice start na de voorlopige oplevering.'; end if;
  if (select count(*) from public.naservice_punten n where n.project_id = p_project and n.bron = 'klant' and n.created_by = auth.uid() and n.created_at > now() - interval '1 day') >= 30 then
    raise exception 'Je hebt vandaag al veel punten gemeld — bel gerust je aanspreekpunt.';
  end if;
  if not public.fotos_geldig(p_fotos, p_project || '/klant/') or jsonb_array_length(coalesce(p_fotos, '[]'::jsonb)) > 10 then raise exception 'Ongeldige foto''s.'; end if;
  select pc.contact_id, coalesce(nullif(c.contactpersoon, ''), c.naam) into v_contact, v_naam from public.project_contacten pc join public.contacten c on c.id = pc.contact_id
   where pc.project_id = p_project and c.id in (select public.mijn_contacten()) and pc.rol in ('bouwheer', 'contactpersoon') limit 1;
  insert into public.naservice_punten (project_id, titel, omschrijving, ruimte, fotos, bron, ontvangen_op, gemeld_door, gemeld_naam)
  values (p_project, left(trim(coalesce(p_titel, '')), 160), left(trim(coalesce(p_omschrijving, '')), 4000), left(trim(coalesce(p_ruimte, '')), 120),
          coalesce(p_fotos, '[]'::jsonb), 'klant', now(), v_contact, coalesce(v_naam, ''))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.naservice_melden(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.naservice_melden(uuid, text, text, text, jsonb) to authenticated;

-- ---------- 4. oplevering: elke wijziging komt in de tijdlijn van het project ----------
create or replace function public.ns_oplevering_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare w record;
begin
  if (new.voorlopig_opgeleverd_op, new.oplevering_termijn_maanden, new.definitief_opgeleverd_op) is not distinct from (old.voorlopig_opgeleverd_op, old.oplevering_termijn_maanden, old.definitief_opgeleverd_op) then return null; end if;
  select * into w from public.ns_wie();
  if new.definitief_opgeleverd_op is not null and old.definitief_opgeleverd_op is null then
    insert into public.naservice_gebeurtenissen (project_id, soort, tekst, datum, door_user, door_naam, door_rol, zichtbaar_aannemer, melden)
    values (new.id, 'definitief', case when new.definitief_automatisch then 'Definitief opgeleverd na afloop van de termijn van ' || new.oplevering_termijn_maanden || ' maanden' else 'Definitief opgeleverd' end
            || coalesce(' — ' || nullif(new.oplevering_opmerking, ''), ''), new.definitief_opgeleverd_op, auth.uid(), case when new.definitief_automatisch then 'Planbord' else w.naam end,
            case when new.definitief_automatisch then 'systeem' else w.rol end, false, false);   -- de mail (met het pv) stuurt het Drive-script zelf
    -- open punten worden voorbehoud: zichtbaar in hun eigen tijdlijn
    insert into public.naservice_gebeurtenissen (project_id, punt_id, soort, tekst, door_user, door_naam, door_rol, zichtbaar_aannemer, melden)
    select n.project_id, n.id, 'voorbehoud', 'Bij de definitieve oplevering nog open: opgenomen als voorbehoud — BROS volgt dit punt verder op.', auth.uid(), 'Planbord', 'systeem', true, false
      from public.naservice_punten n where n.project_id = new.id and n.status not in ('afgesloten', 'geweigerd') and n.klant_zichtbaar;
  elsif new.definitief_opgeleverd_op is null and old.definitief_opgeleverd_op is not null then
    insert into public.naservice_gebeurtenissen (project_id, soort, tekst, door_user, door_naam, door_rol, zichtbaar_klant, zichtbaar_aannemer)
    values (new.id, 'termijn', 'Definitieve oplevering ongedaan gemaakt', auth.uid(), w.naam, w.rol, false, false);
  elsif new.voorlopig_opgeleverd_op is distinct from old.voorlopig_opgeleverd_op then
    insert into public.naservice_gebeurtenissen (project_id, soort, tekst, datum, door_user, door_naam, door_rol, zichtbaar_aannemer, melden)
    values (new.id, case when new.voorlopig_opgeleverd_op is null then 'termijn' else 'voorlopig' end,
            case when new.voorlopig_opgeleverd_op is null then 'Voorlopige oplevering uitgevinkt'
                 when old.voorlopig_opgeleverd_op is null then 'Voorlopig opgeleverd — de naservice loopt ' || new.oplevering_termijn_maanden || ' maanden, tot de definitieve oplevering'
                 else 'Datum van de voorlopige oplevering gewijzigd (was ' || to_char(old.voorlopig_opgeleverd_op, 'DD/MM/YYYY') || ')' end
            || coalesce(E'\n' || nullif(new.oplevering_opmerking, ''), ''),
            new.voorlopig_opgeleverd_op, auth.uid(), w.naam, w.rol, false,
            old.voorlopig_opgeleverd_op is null and new.voorlopig_opgeleverd_op is not null and new.voorlopig_opgeleverd_op > current_date - 60);   -- de klant krijgt uitleg over de naservice (niet bij een oude oplevering die je nu pas aanvinkt)
  else
    insert into public.naservice_gebeurtenissen (project_id, soort, tekst, door_user, door_naam, door_rol, zichtbaar_aannemer)
    values (new.id, 'termijn', 'Termijn tot de definitieve oplevering: ' || new.oplevering_termijn_maanden || ' maanden (was ' || old.oplevering_termijn_maanden || ')', auth.uid(), w.naam, w.rol, false);
  end if;
  return null;
end $$;
drop trigger if exists ns_oplevering_log on public.projecten;
create trigger ns_oplevering_log after update of voorlopig_opgeleverd_op, oplevering_termijn_maanden, definitief_opgeleverd_op on public.projecten for each row execute function public.ns_oplevering_log();

-- definitief opleveren mag niet vóór de afgesproken termijn (behalve beheer, met een opmerking) en het pv is vast
create or replace function public.ns_oplevering_vast()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if new.definitief_opgeleverd_op is not null and old.definitief_opgeleverd_op is null then
    if not public.is_beheer() then raise exception 'Enkel een beheerder kan definitief opleveren (het Planbord doet het automatisch na de termijn).'; end if;
    new.definitief_automatisch := false;
  end if;
  if new.definitief_automatisch is distinct from old.definitief_automatisch and not (new.definitief_opgeleverd_op is not null and old.definitief_opgeleverd_op is null) then
    raise exception 'Automatisch of niet kan je niet zelf wijzigen.';
  end if;
  if old.definitief_pv_drive_id is not null and new.definitief_pv_drive_id is distinct from old.definitief_pv_drive_id then raise exception 'Het proces-verbaal van de definitieve oplevering ligt vast.'; end if;
  if old.definitief_opgeleverd_op is not null and (new.voorlopig_opgeleverd_op, new.oplevering_termijn_maanden) is distinct from (old.voorlopig_opgeleverd_op, old.oplevering_termijn_maanden) then
    raise exception 'Het project is al definitief opgeleverd: de voorlopige oplevering en de termijn liggen vast.';
  end if;
  if new.definitief_opgeleverd_op is null and old.definitief_opgeleverd_op is not null and (old.definitief_pv_drive_id is not null or not public.is_beheer()) then
    raise exception 'De definitieve oplevering heeft al een proces-verbaal: ze kan niet meer ongedaan gemaakt worden.';
  end if;
  return new;
end $$;
drop trigger if exists ns_oplevering_vast on public.projecten;
create trigger ns_oplevering_vast before update of voorlopig_opgeleverd_op, oplevering_termijn_maanden, definitief_opgeleverd_op, definitief_automatisch, definitief_pv_drive_id on public.projecten
  for each row execute function public.ns_oplevering_vast();

-- ---------- 5. klantenportaal ----------
create or replace view public.klant_oplevering as
  select p.id as project_id, p.voorlopig_opgeleverd_op, p.oplevering_termijn_maanden,
         (p.voorlopig_opgeleverd_op + make_interval(months => p.oplevering_termijn_maanden))::date as definitief_gepland_op,
         p.definitief_opgeleverd_op, p.definitief_pv_document
  from public.projecten p
  where p.id in (select public.klant_projecten()) and p.voorlopig_opgeleverd_op is not null;
create or replace view public.klant_naservice_punten as
  select n.id, n.project_id, n.nr, n.titel, n.omschrijving, n.ruimte, n.fotos, n.bron, n.ontvangen_op, n.status, n.gepland_op, n.opgelost_op, n.afgesloten_op,
         (n.gemeld_door is not null and n.gemeld_door in (select public.mijn_contacten())) as door_mij,
         (select coalesce(nullif(c.naam, ''), c.bedrijf) from public.contacten c where c.id = n.contact_id) as uitvoerder
  from public.naservice_punten n
  where n.project_id in (select public.klant_projecten()) and n.klant_zichtbaar;
create or replace view public.klant_naservice_tijdlijn as
  select g.id, g.project_id, g.punt_id, g.soort, g.tekst, g.fotos, g.datum, g.door_naam, g.door_rol, g.op
  from public.naservice_gebeurtenissen g
  where g.project_id in (select public.klant_projecten()) and g.zichtbaar_klant
    and (g.punt_id is null or g.punt_id in (select n.id from public.naservice_punten n where n.klant_zichtbaar));
-- ---------- 6. aannemersportaal: enkel zijn eigen punten (na beoordeling door BROS) ----------
create or replace view public.aan_naservice_punten as
  select n.id, n.project_id, n.nr, n.titel, n.omschrijving, n.ruimte, n.fotos, n.ontvangen_op, n.status, n.prioriteit, n.gepland_op, n.opgelost_op, n.afgesloten_op
  from public.naservice_punten n
  where n.contact_id in (select public.mijn_contacten()) and n.status not in ('ontvangen', 'geweigerd');
create or replace view public.aan_naservice_tijdlijn as
  select g.id, g.project_id, g.punt_id, g.soort, g.tekst, g.fotos, g.datum, g.door_naam, g.door_rol, g.op
  from public.naservice_gebeurtenissen g
  where g.zichtbaar_aannemer and g.punt_id in (select n.id from public.naservice_punten n where n.contact_id in (select public.mijn_contacten()) and n.status not in ('ontvangen', 'geweigerd'));
revoke all on public.klant_oplevering, public.klant_naservice_punten, public.klant_naservice_tijdlijn, public.aan_naservice_punten, public.aan_naservice_tijdlijn from anon;
grant select on public.klant_oplevering, public.klant_naservice_punten, public.klant_naservice_tijdlijn, public.aan_naservice_punten, public.aan_naservice_tijdlijn to authenticated;

-- ---------- 7. live bijwerken ----------
do $$ declare t text; begin
  foreach t in array array['naservice_punten', 'naservice_gebeurtenissen'] loop
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
    execute format('drop trigger if exists pb_wijz on public.%I', t);
    execute format('create trigger pb_wijz after insert or update or delete on public.%I for each row execute function public.pb_wijziging(%L, %L)', t, t, 'id');
  end loop;
end $$;

do $$ begin
  revoke all on function public.ns_punt_voor(), public.ns_punt_weg(), public.ns_punt_na(), public.ns_tijdlijn_vast(), public.ns_oplevering_log(), public.ns_oplevering_vast() from public, anon, authenticated;
  revoke all on function public.ns_wie() from public, anon;
end $$;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(69, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: geeft 7 | 2 | 5 | 69 terug (nieuwe projectkolommen, tabellen, portaal-views, schemaversie)
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'projecten'
          and column_name in ('voorlopig_opgeleverd_op', 'oplevering_termijn_maanden', 'oplevering_opmerking', 'definitief_opgeleverd_op', 'definitief_automatisch', 'definitief_pv_drive_id', 'definitief_pv_document'))::int as kolommen,
       (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('naservice_punten', 'naservice_gebeurtenissen') and table_type = 'BASE TABLE')::int as tabellen,
       (select count(*) from information_schema.views where table_schema = 'public' and table_name in ('klant_oplevering', 'klant_naservice_punten', 'klant_naservice_tijdlijn', 'aan_naservice_punten', 'aan_naservice_tijdlijn'))::int as views,
       (select (value->>'versie_schema')::int from public.instellingen where key = 'app') as schema;
