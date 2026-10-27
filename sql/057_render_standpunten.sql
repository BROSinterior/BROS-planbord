-- =====================================================================
--  BROS Planbord — databasescript 057: Renders per ruimte en standpunt, met volledige beeldhistoriek (v1.61)
--  Uitbreiding van de renders (055) en stalenborden (056). Niets wordt verwijderd: bestaande beelden, opdrachten,
--  goedkeuringen, Drive-koppelingen, presentaties en stalenborden blijven zoals ze zijn en worden enkel gekoppeld.
--
--  Structuur: project → ruimte (render_ruimtes, vaste id: hernoemen breekt niets) → standpunt (render_standpunten:
--  één camerastandpunt met zijn oorspronkelijk ontwerp) → versies (render_beelden soort 'render' met standpunt_id,
--  versie en basis_beeld_id = de versie waarop een correctie gebaseerd was; vertakkingen blijven bewaard).
--
--  - render_ruimtes: verdieping, zijde (straat/tuin/…), kijkrichting, omgevingsnotitie, lichtvoorkeur (standaard helder) en
--    vastgelegde achtergrondreferenties (eigen foto's of een expliciet gekozen render), elk met een gevel/raamgroep.
--  - render_standpunten: oorspronkelijk ontwerp, hoofdversie, presentatieversie (los van goedkeuring), controlelijst van
--    belangrijke elementen (voorstellen van de automatische controle blijven onbevestigd tot het team ze bevestigt) en de
--    geldende expliciete correcties.
--  - render_opdrachten: modus 'nieuw' (ontwerp = geometrische hoofdbron) of 'correctie' (bestaande versie = bewerkingsdoel,
--    oorspronkelijk ontwerp apart als geometrische referentie), achtergrondreferenties en een kopie van de context
--    (werfadres, verdieping, zijde, licht, controlelijst, correcties) op het moment van de aanvraag.
--  - render_beelden.controle: resultaat van de automatische controle (enkel een vermoeden, nooit een garantie).
--  - Migratie: ruimtes uit de bestaande namen; standpunten en versiereeksen uit bron_id/resultaat_id; onzekere koppelingen
--    worden gemarkeerd om na te kijken (niets wordt op bestandsnaam of gelijkenis samengevoegd).
--  Vereist schema 56. Mag opnieuw uitgevoerd worden (de migratie koppelt enkel wat nog niet gekoppeld is).
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 56 then
    raise exception 'Voer eerst de scripts tot en met 056 uit.';
  end if;
end $$;

-- ---------- 1. tabellen en kolommen ----------
create table if not exists public.render_ruimtes (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projecten(id) on delete cascade,
  naam              text not null check (length(trim(naam)) between 1 and 120 and trim(naam) <> '*'),
  verdieping        text not null default '',
  zijde             text not null default '',            -- straatzijde, tuinzijde, zijgevel, binnenkoer, meerdere zijden …
  kijkrichting      text not null default '',
  omgeving_notitie  text not null default '',
  licht             text not null default 'helder' check (licht in ('helder', 'neutraal', 'gedempt')),
  licht_notitie     text not null default '',
  achtergronden     jsonb not null default '[]'::jsonb,  -- [{"id": beeld, "omschrijving": "tuinzijde, raamgroep links"}]
  volgorde          int not null default 0,
  created_by        uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists render_ruimtes_naam on public.render_ruimtes (project_id, lower(trim(naam)));

create table if not exists public.render_standpunten (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projecten(id) on delete cascade,
  ruimte_id          uuid not null references public.render_ruimtes(id) on delete restrict,
  naam               text not null default '',
  ontwerp_id         uuid references public.render_beelden(id) on delete set null,   -- het oorspronkelijke ontwerp (geometrische hoofdbron)
  hoofdversie_id     uuid references public.render_beelden(id) on delete set null,
  presentatie_id     uuid references public.render_beelden(id) on delete set null,
  keuze_op           timestamptz,                                                     -- laatste wijziging van hoofd- of presentatieversie
  controlelijst      jsonb not null default '[]'::jsonb,  -- [{"id","soort","tekst","bevestigd","bron":"team|voorstel"}]
  correcties         jsonb not null default '[]'::jsonb,  -- [{"id","tekst","actief","datum","door","opdracht_id"}]
  omgeving_notitie   text not null default '',            -- bv. "raam rechts = tuinzijde; deur links kijkt naar de gang"
  achtergrond_keuze  uuid[] not null default '{}',        -- leeg = alle achtergronden van de ruimte
  koppeling          text not null default 'zeker' check (koppeling in ('zeker', 'onzeker', 'handmatig')),
  koppeling_reden    text not null default '',
  volgorde           int not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists render_standpunten_project_idx on public.render_standpunten(project_id, ruimte_id);

alter table public.render_beelden drop constraint if exists render_beelden_soort_check;
alter table public.render_beelden add constraint render_beelden_soort_check check (soort in ('ontwerp', 'sfeer', 'render', 'stalenbord', 'achtergrond'));
alter table public.render_beelden add column if not exists ruimte_id uuid references public.render_ruimtes(id) on delete set null;
alter table public.render_beelden add column if not exists standpunt_id uuid references public.render_standpunten(id) on delete set null;
alter table public.render_beelden add column if not exists basis_beeld_id uuid references public.render_beelden(id) on delete set null;  -- versie waarop deze correctie gebaseerd was
alter table public.render_beelden add column if not exists koppeling text;            -- 'zeker' | 'onzeker' | 'handmatig'
alter table public.render_beelden add column if not exists controle jsonb;            -- automatische controle (vermoeden, geen garantie)
alter table public.render_beelden add column if not exists omschrijving text not null default '';
create index if not exists render_beelden_standpunt_idx on public.render_beelden(standpunt_id);

alter table public.render_opdrachten add column if not exists ruimte_id uuid references public.render_ruimtes(id) on delete set null;
alter table public.render_opdrachten add column if not exists standpunt_id uuid references public.render_standpunten(id) on delete set null;
alter table public.render_opdrachten add column if not exists ontwerp_id uuid references public.render_beelden(id) on delete set null;
alter table public.render_opdrachten add column if not exists modus text;             -- 'nieuw' | 'correctie' (leeg = aanvraag van een oudere pagina)
alter table public.render_opdrachten add column if not exists achtergrond_ids uuid[] not null default '{}';
alter table public.render_opdrachten add column if not exists context jsonb;          -- kopie: werfadres, ruimte, licht, controlelijst, correcties, achtergronden
alter table public.render_opdrachten drop constraint if exists render_opdrachten_modus;
alter table public.render_opdrachten add constraint render_opdrachten_modus check (modus is null or modus in ('nieuw', 'correctie'));
alter table public.render_opdrachten drop constraint if exists render_opdrachten_achtergrond;
alter table public.render_opdrachten add constraint render_opdrachten_achtergrond check (cardinality(achtergrond_ids) <= 6);

alter table public.render_afspraken add column if not exists ruimte_id uuid references public.render_ruimtes(id) on delete set null;

drop trigger if exists render_ruimtes_touch on public.render_ruimtes;
create trigger render_ruimtes_touch before update on public.render_ruimtes for each row execute function public.touch_updated_at();
drop trigger if exists render_standpunten_touch on public.render_standpunten;
create trigger render_standpunten_touch before update on public.render_standpunten for each row execute function public.touch_updated_at();

-- ---------- 2. vaste ruimte-id bij elke rij met een ruimtenaam ----------
create or replace function public.rd_ruimte_id(p_project uuid, p_naam text)
returns uuid language plpgsql security definer set search_path = public as $$
declare i uuid; n text := left(trim(regexp_replace(coalesce(p_naam, ''), '\s+', ' ', 'g')), 120);
begin
  if p_project is null or n = '' or n = '*' then return null; end if;
  select id into i from public.render_ruimtes where project_id = p_project and lower(trim(naam)) = lower(n);
  if i is null then
    insert into public.render_ruimtes (project_id, naam) values (p_project, n) on conflict do nothing returning id into i;
    if i is null then select id into i from public.render_ruimtes where project_id = p_project and lower(trim(naam)) = lower(n); end if;
  end if;
  return i;
end $$;

create or replace function public.rd_ruimte_koppel()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.ruimte is not distinct from old.ruimte and new.ruimte_id is not null and new.ruimte_id is not distinct from old.ruimte_id then return new; end if;
  if trim(coalesce(new.ruimte, '')) in ('', '*') then new.ruimte_id := null; return new; end if;
  if new.ruimte_id is not null and exists (select 1 from public.render_ruimtes r where r.id = new.ruimte_id and r.project_id = new.project_id
                                           and lower(trim(r.naam)) = lower(trim(new.ruimte))) then return new; end if;
  new.ruimte_id := public.rd_ruimte_id(new.project_id, new.ruimte);
  return new;
end $$;
drop trigger if exists render_beelden_ruimte on public.render_beelden;
create trigger render_beelden_ruimte before insert or update on public.render_beelden for each row execute function public.rd_ruimte_koppel();
drop trigger if exists render_opdrachten_ruimte on public.render_opdrachten;
create trigger render_opdrachten_ruimte before insert or update on public.render_opdrachten for each row execute function public.rd_ruimte_koppel();
drop trigger if exists render_afspraken_ruimte on public.render_afspraken;
create trigger render_afspraken_ruimte before insert or update on public.render_afspraken for each row execute function public.rd_ruimte_koppel();

-- standpunt van een bron: het standpunt van dat beeld, of een nieuw standpunt voor een ontwerp zonder standpunt
create or replace function public.rd_standpunt_voor(p_beeld uuid, p_naam text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare b public.render_beelden; s uuid; r uuid;
begin
  select * into b from public.render_beelden where id = p_beeld;
  if b.id is null then return null; end if;
  if b.standpunt_id is not null then return b.standpunt_id; end if;
  if b.soort <> 'ontwerp' then return null; end if;
  r := coalesce(b.ruimte_id, public.rd_ruimte_id(b.project_id, b.ruimte));
  if r is null then r := public.rd_ruimte_id(b.project_id, 'Zonder ruimte'); update public.render_beelden set ruimte = 'Zonder ruimte', ruimte_id = r where id = b.id; end if;
  insert into public.render_standpunten (project_id, ruimte_id, naam, ontwerp_id, volgorde)
  values (b.project_id, r, left(coalesce(nullif(trim(p_naam), ''), nullif(regexp_replace(b.naam, '\.[A-Za-z0-9]{2,4}$', ''), ''), 'Standpunt'), 120), b.id,
          (select coalesce(max(volgorde), 0) + 1 from public.render_standpunten where ruimte_id = r))
  returning id into s;
  update public.render_beelden set standpunt_id = s, koppeling = 'zeker' where id = b.id;
  return s;
end $$;

-- een aanvraag van een oudere pagina (render_aanvragen van 055) toch aan het juiste standpunt koppelen
create or replace function public.rd_opdracht_standpunt()
returns trigger language plpgsql security definer set search_path = public as $$
declare b public.render_beelden; s public.render_standpunten;
begin
  if new.soort <> 'render' or new.standpunt_id is not null then return new; end if;
  select * into b from public.render_beelden where id = new.bron_id;
  if b.id is null then return new; end if;
  new.standpunt_id := public.rd_standpunt_voor(b.id);
  if new.standpunt_id is not null then
    select * into s from public.render_standpunten where id = new.standpunt_id;
    new.ontwerp_id := coalesce(new.ontwerp_id, s.ontwerp_id);
    new.ruimte_id := s.ruimte_id;   -- de ruimte volgt het standpunt (een oudere pagina kan een andere ruimtenaam meegeven)
    new.ruimte := coalesce((select naam from public.render_ruimtes where id = s.ruimte_id), new.ruimte);
  end if;
  return new;
end $$;
drop trigger if exists render_opdrachten_standpunt on public.render_opdrachten;
create trigger render_opdrachten_standpunt before insert on public.render_opdrachten for each row execute function public.rd_opdracht_standpunt();

-- ---------- 3. migratie van de bestaande historiek (enkel wat nog niet gekoppeld is) ----------
-- 3a. ruimtes uit de bestaande namen (de trigger vult ruimte_id)
update public.render_beelden set ruimte = ruimte where ruimte_id is null and trim(ruimte) not in ('', '*');
update public.render_opdrachten set ruimte = ruimte where ruimte_id is null and trim(ruimte) not in ('', '*');
update public.render_afspraken set ruimte = ruimte where ruimte_id is null and trim(ruimte) not in ('', '*');

-- 3b. standpunten en versiereeksen uit bron_id → resultaat_id
do $$
declare r record; wortel uuid; stap int; b public.render_beelden; s uuid; kamers int; nieuwste public.render_beelden; dubbel boolean;
begin
  -- elke render: de wortel van zijn reeks (volg de bron tot een ontwerp)
  drop table if exists rd_mig;
  create temp table rd_mig (render_id uuid primary key, wortel uuid, basis uuid, opdracht uuid) on commit drop;
  -- handmatig losgemaakte beelden (koppeling 'handmatig') blijven los: opnieuw uitvoeren draait geen keuze van het team terug
  for r in select x.id, x.opdracht_id, x.project_id from public.render_beelden x where x.soort = 'render' and x.standpunt_id is null and coalesce(x.koppeling, '') <> 'handmatig' loop
    wortel := null; stap := 0; b := null;
    select bb.* into b from public.render_opdrachten o join public.render_beelden bb on bb.id = o.bron_id where o.id = r.opdracht_id;
    while b.id is not null and stap < 60 loop
      if b.standpunt_id is not null then wortel := b.id; exit; end if;
      if b.soort = 'ontwerp' then wortel := b.id; exit; end if;
      exit when b.soort <> 'render' or b.opdracht_id is null;
      select bb.* into b from public.render_opdrachten o join public.render_beelden bb on bb.id = o.bron_id where o.id = b.opdracht_id;
      stap := stap + 1;
    end loop;
    insert into rd_mig values (r.id, wortel,
      (select case when bb.soort = 'render' then bb.id end from public.render_opdrachten o join public.render_beelden bb on bb.id = o.bron_id where o.id = r.opdracht_id), r.opdracht_id);
  end loop;
  -- elk ontwerp is een standpunt (ook als er nog geen bruikbare render van is)
  for r in select id from public.render_beelden where soort = 'ontwerp' and standpunt_id is null and coalesce(koppeling, '') <> 'handmatig' order by created_at loop
    perform public.rd_standpunt_voor(r.id);
  end loop;
  -- renders aan het standpunt van hun wortel
  for r in select m.*, x.created_at from rd_mig m join public.render_beelden x on x.id = m.render_id order by x.created_at loop
    s := null;
    if r.wortel is not null then select standpunt_id into s from public.render_beelden where id = r.wortel; end if;
    if s is null then
      update public.render_beelden set koppeling = 'onzeker' where id = r.render_id;   -- reeks niet terug te vinden: zelf koppelen
      continue;
    end if;
    update public.render_beelden set standpunt_id = s, basis_beeld_id = coalesce(basis_beeld_id, r.basis), koppeling = 'zeker' where id = r.render_id;
    update public.render_opdrachten set standpunt_id = coalesce(standpunt_id, s) where id = r.opdracht;
  end loop;
  -- per standpunt: versies nummeren, ruimte nakijken, hoofd- en presentatieversie uit bestaande keuzes
  for r in select * from public.render_standpunten loop
    with v as (select id, row_number() over (order by created_at, id) as n from public.render_beelden where standpunt_id = r.id and soort = 'render')
    update public.render_beelden x set versie = v.n from v where x.id = v.id and x.versie is null;
    -- renders die (in 1.60) naar een andere ruimte verhuisd werden: het standpunt volgt de nieuwste render, maar is onzeker
    select count(distinct coalesce(ruimte_id::text, '')) into kamers from public.render_beelden where standpunt_id = r.id and soort in ('ontwerp', 'render');
    if kamers > 1 then
      select * into nieuwste from public.render_beelden where standpunt_id = r.id and soort = 'render' and ruimte_id is not null order by created_at desc limit 1;
      if nieuwste.id is not null and nieuwste.ruimte_id <> r.ruimte_id then
        update public.render_standpunten set ruimte_id = nieuwste.ruimte_id where id = r.id;
      end if;
      update public.render_standpunten set koppeling = 'onzeker', koppeling_reden = 'De beelden van dit standpunt stonden in verschillende ruimtes.' where id = r.id and koppeling = 'zeker';
    end if;
    -- hetzelfde ontwerp twee keer opgeladen (zelfde controlegetal, zelfde ruimte): niet samenvoegen, wel laten nakijken
    select exists (select 1 from public.render_standpunten s2 join public.render_beelden o2 on o2.id = s2.ontwerp_id join public.render_beelden o1 on o1.id = r.ontwerp_id
                   where s2.id <> r.id and s2.project_id = r.project_id and s2.ruimte_id = r.ruimte_id and o1.sha256 <> '' and o2.sha256 = o1.sha256) into dubbel;
    if dubbel then
      update public.render_standpunten set koppeling = 'onzeker', koppeling_reden = 'Hetzelfde ontwerpbeeld werd meerdere keren opgeladen: mogelijk hetzelfde standpunt (samenvoegen kan).' where id = r.id and koppeling = 'zeker';
    end if;
    if r.hoofdversie_id is null then
      update public.render_standpunten set hoofdversie_id = (select id from public.render_beelden where standpunt_id = r.id and soort = 'render' and goedgekeurd_op is not null order by created_at desc limit 1)
      where id = r.id;
    end if;
    if r.presentatie_id is null then
      update public.render_standpunten set presentatie_id = (
        select b2.id from public.render_presentaties p2 cross join lateral unnest(p2.render_ids) as u(bid) join public.render_beelden b2 on b2.id = u.bid
        where p2.project_id = r.project_id and b2.standpunt_id = r.id and b2.soort = 'render' order by p2.created_at desc, array_position(p2.render_ids, b2.id) limit 1)
      where id = r.id;
    end if;
  end loop;
  -- alle beelden van een standpunt in de ruimte van het standpunt (de trigger houdt de naam gelijk)
  update public.render_beelden x set ruimte = rr.naam, ruimte_id = rr.id
  from public.render_standpunten s2 join public.render_ruimtes rr on rr.id = s2.ruimte_id
  where x.standpunt_id = s2.id and x.ruimte_id is distinct from rr.id;
  update public.render_opdrachten x set ruimte = rr.naam, ruimte_id = rr.id
  from public.render_standpunten s2 join public.render_ruimtes rr on rr.id = s2.ruimte_id
  where x.standpunt_id = s2.id and x.ruimte_id is distinct from rr.id and x.status not in ('wachtrij', 'bezig');
  -- modus van afgewerkte opdrachten (voor de historiek); wachtende aanvragen van een oudere pagina blijven ongemoeid
  update public.render_opdrachten o set modus = case when b2.soort = 'render' then 'correctie' else 'nieuw' end,
         ontwerp_id = coalesce(o.ontwerp_id, (select ontwerp_id from public.render_standpunten where id = o.standpunt_id))
  from public.render_beelden b2 where b2.id = o.bron_id and o.soort = 'render' and o.modus is null and o.status not in ('wachtrij', 'bezig');
end $$;

-- ---------- 4. toegang ----------
alter table public.render_ruimtes enable row level security;
alter table public.render_standpunten enable row level security;
drop policy if exists rr_lezen on public.render_ruimtes;
create policy rr_lezen on public.render_ruimtes for select to authenticated using (public.is_intern());
drop policy if exists rs_lezen on public.render_standpunten;
create policy rs_lezen on public.render_standpunten for select to authenticated using (public.is_intern());
revoke all on public.render_ruimtes, public.render_standpunten from anon;
revoke insert, update, delete, truncate, references, trigger on public.render_ruimtes, public.render_standpunten from authenticated;   -- schrijven via de functies
grant select on public.render_ruimtes, public.render_standpunten to authenticated;

-- een beeld verwijderen: ook niet als het ontwerp- of achtergrondreferentie is van een opdracht die wacht of loopt
drop policy if exists rb_weg on public.render_beelden;
create policy rb_weg on public.render_beelden for delete to authenticated using (public.is_intern() and (public.is_beheer() or created_by = auth.uid())
  and soort not in ('stalenbord', 'render')
  and not exists (select 1 from public.render_opdrachten o where (o.bron_id = render_beelden.id or render_beelden.id = any(o.sfeer_ids) or render_beelden.id = any(o.referentie_ids)
                                                                  or o.basis_id = render_beelden.id or o.ontwerp_id = render_beelden.id or render_beelden.id = any(o.achtergrond_ids))
                                                                 and o.status in ('wachtrij', 'bezig'))
  and not exists (select 1 from public.render_standpunten s where s.ontwerp_id = render_beelden.id));

-- ---------- 5. functies voor het team ----------
create or replace function public.rd_tekst(p text, n int) returns text language sql immutable as $$ select left(trim(coalesce(p, '')), n) $$;

-- ruimte aanmaken (of de bestaande met die naam teruggeven)
create or replace function public.render_ruimte_maak(p_project uuid, p_naam text)
returns public.render_ruimtes language plpgsql security definer set search_path = public as $$
declare r public.render_ruimtes; i uuid;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  if not exists (select 1 from public.projecten where id = p_project) then raise exception 'Project niet gevonden.'; end if;
  if trim(coalesce(p_naam, '')) in ('', '*') then raise exception 'Vul de naam van de ruimte in.'; end if;
  i := public.rd_ruimte_id(p_project, p_naam);
  select * into r from public.render_ruimtes where id = i;
  return r;
end $$;

-- ruimte-instellingen: naam (hernoemen houdt alle koppelingen), verdieping, zijde, kijkrichting, licht, achtergronden
create or replace function public.render_ruimte_bewaar(p_ruimte uuid, p_velden jsonb)
returns public.render_ruimtes language plpgsql security definer set search_path = public as $$
declare r public.render_ruimtes; n text; ag jsonb; x jsonb;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  select * into r from public.render_ruimtes where id = p_ruimte for update;
  if r.id is null then raise exception 'Ruimte niet gevonden.'; end if;
  if p_velden ? 'naam' then
    n := left(trim(regexp_replace(coalesce(p_velden->>'naam', ''), '\s+', ' ', 'g')), 120);
    if n = '' or n = '*' then raise exception 'Vul de naam van de ruimte in.'; end if;
    if lower(n) <> lower(trim(r.naam)) and exists (select 1 from public.render_ruimtes where project_id = r.project_id and lower(trim(naam)) = lower(n) and id <> r.id) then
      raise exception 'Er bestaat al een ruimte "%" in dit project. Kies een andere naam.', n; end if;
    update public.render_ruimtes set naam = n where id = r.id;
    -- (zeldzaam) twee gekozen stalenborden met een net andere schrijfwijze van dezelfde ruimte: enkel het nieuwste blijft gekozen
    update public.render_beelden set geselecteerd = false where ruimte_id = r.id and soort = 'stalenbord' and geselecteerd
      and id <> (select id from public.render_beelden where ruimte_id = r.id and soort = 'stalenbord' and geselecteerd order by created_at desc limit 1);
    -- de naam staat ook als tekst bij beelden, opdrachten en afspraken: mee aanpassen (de vaste id blijft dezelfde)
    update public.render_beelden set ruimte = n where ruimte_id = r.id and ruimte is distinct from n;
    update public.render_opdrachten set ruimte = n where ruimte_id = r.id and ruimte is distinct from n;
    update public.render_afspraken set ruimte = n where ruimte_id = r.id and ruimte is distinct from n;
  end if;
  if p_velden ? 'achtergronden' then
    if jsonb_typeof(p_velden->'achtergronden') <> 'array' or jsonb_array_length(p_velden->'achtergronden') > 6 then raise exception 'Maximaal 6 achtergrondreferenties per ruimte.'; end if;
    ag := '[]'::jsonb;
    for x in select * from jsonb_array_elements(p_velden->'achtergronden') loop
      if not exists (select 1 from public.render_beelden b where b.id = (x->>'id')::uuid and b.project_id = r.project_id and b.soort in ('achtergrond', 'render')) then
        raise exception 'Een achtergrondreferentie moet een achtergrondfoto of een render van dit project zijn.'; end if;
      if not ag @> jsonb_build_array(jsonb_build_object('id', x->>'id')) then
        ag := ag || jsonb_build_array(jsonb_build_object('id', x->>'id', 'omschrijving', public.rd_tekst(x->>'omschrijving', 200)));
      end if;
    end loop;
    update public.render_ruimtes set achtergronden = ag where id = r.id;
  end if;
  update public.render_ruimtes set
    verdieping = case when p_velden ? 'verdieping' then public.rd_tekst(p_velden->>'verdieping', 60) else verdieping end,
    zijde = case when p_velden ? 'zijde' then public.rd_tekst(p_velden->>'zijde', 120) else zijde end,
    kijkrichting = case when p_velden ? 'kijkrichting' then public.rd_tekst(p_velden->>'kijkrichting', 200) else kijkrichting end,
    omgeving_notitie = case when p_velden ? 'omgeving_notitie' then public.rd_tekst(p_velden->>'omgeving_notitie', 1000) else omgeving_notitie end,
    licht = case when p_velden->>'licht' in ('helder', 'neutraal', 'gedempt') then p_velden->>'licht' else licht end,
    licht_notitie = case when p_velden ? 'licht_notitie' then public.rd_tekst(p_velden->>'licht_notitie', 500) else licht_notitie end,
    volgorde = case when p_velden ? 'volgorde' then coalesce((p_velden->>'volgorde')::int, volgorde) else volgorde end
  where id = r.id returning * into r;
  return r;
end $$;

-- een achtergrondfoto registreren (na het opladen naar renders/<project>/achtergrond/…) en aan de ruimte toevoegen
create or replace function public.render_achtergrond_bewaar(p_ruimte uuid, p_pad text, p_naam text, p_mime text, p_grootte bigint, p_sha256 text, p_breedte int, p_hoogte int, p_omschrijving text)
returns public.render_beelden language plpgsql security definer set search_path = public as $$
declare r public.render_ruimtes; b public.render_beelden;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  select * into r from public.render_ruimtes where id = p_ruimte for update;
  if r.id is null then raise exception 'Ruimte niet gevonden.'; end if;
  if coalesce(p_pad, '') not like r.project_id::text || '/achtergrond/%' or split_part(p_pad, '/', 4) <> '' then raise exception 'Ongeldig pad voor de achtergrondfoto.'; end if;
  if p_mime not in ('image/png', 'image/jpeg', 'image/webp') then raise exception 'Enkel PNG, JPEG of WebP.'; end if;
  if coalesce(p_sha256, '') !~ '^[0-9a-f]{64}$' then raise exception 'Beeld zonder controlegetal.'; end if;
  if not public.rd_object_ok(p_pad, p_grootte) then raise exception 'De foto staat (nog) niet volledig in de opslag. Probeer opnieuw.'; end if;
  select * into b from public.render_beelden where pad = p_pad;
  if b.id is not null and r.achtergronden @> jsonb_build_array(jsonb_build_object('id', b.id::text)) then return b; end if;   -- dezelfde foto opnieuw bevestigd
  if jsonb_array_length(r.achtergronden) >= 6 then raise exception 'Maximaal 6 achtergrondreferenties per ruimte.'; end if;
  if b.id is null then
    insert into public.render_beelden (project_id, soort, ruimte, ruimte_id, naam, pad, mime, grootte, breedte, hoogte, sha256, omschrijving)
    values (r.project_id, 'achtergrond', r.naam, r.id, left(coalesce(nullif(trim(p_naam), ''), 'achtergrond'), 200), p_pad, p_mime, p_grootte, p_breedte, p_hoogte, p_sha256, public.rd_tekst(p_omschrijving, 200))
    returning * into b;
  end if;
  if not r.achtergronden @> jsonb_build_array(jsonb_build_object('id', b.id::text)) then
    update public.render_ruimtes set achtergronden = achtergronden || jsonb_build_array(jsonb_build_object('id', b.id::text, 'omschrijving', public.rd_tekst(p_omschrijving, 200))) where id = r.id;
  end if;
  return b;
end $$;

-- standpunt bewaren: naam, ruimte (verplaatsen neemt alle versies mee), controlelijst, correcties, omgeving, achtergrondkeuze
create or replace function public.render_standpunt_bewaar(p_standpunt uuid, p_velden jsonb)
returns public.render_standpunten language plpgsql security definer set search_path = public as $$
declare s public.render_standpunten; rr public.render_ruimtes; lijst jsonb; x jsonb; ag uuid[];
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  select * into s from public.render_standpunten where id = p_standpunt for update;
  if s.id is null then raise exception 'Standpunt niet gevonden.'; end if;
  if p_velden ? 'ruimte_id' and (p_velden->>'ruimte_id')::uuid is distinct from s.ruimte_id then
    select * into rr from public.render_ruimtes where id = (p_velden->>'ruimte_id')::uuid and project_id = s.project_id;
    if rr.id is null then raise exception 'Kies een ruimte van dit project.'; end if;
    update public.render_standpunten set ruimte_id = rr.id, achtergrond_keuze = '{}' where id = s.id;
    update public.render_beelden set ruimte = rr.naam, ruimte_id = rr.id where standpunt_id = s.id;
    update public.render_opdrachten set ruimte = rr.naam, ruimte_id = rr.id where standpunt_id = s.id;
  end if;
  if p_velden ? 'controlelijst' then
    if jsonb_typeof(p_velden->'controlelijst') <> 'array' or jsonb_array_length(p_velden->'controlelijst') > 60 then raise exception 'Ongeldige controlelijst (max. 60 punten).'; end if;
    lijst := '[]'::jsonb;
    for x in select * from jsonb_array_elements(p_velden->'controlelijst') loop
      continue when public.rd_tekst(x->>'tekst', 300) = '';
      lijst := lijst || jsonb_build_array(jsonb_build_object(
        'id', coalesce(nullif(x->>'id', ''), md5(random()::text)),
        'soort', case when x->>'soort' in ('opening', 'wand', 'dak', 'kast', 'schab', 'meubel', 'armatuur', 'decoratie', 'ander') then x->>'soort' else 'ander' end,
        'tekst', public.rd_tekst(x->>'tekst', 300), 'bevestigd', coalesce((x->>'bevestigd')::boolean, false),
        'bron', case when x->>'bron' = 'voorstel' then 'voorstel' else 'team' end));
    end loop;
    update public.render_standpunten set controlelijst = lijst where id = s.id;
  end if;
  if p_velden ? 'correcties' then
    if jsonb_typeof(p_velden->'correcties') <> 'array' or jsonb_array_length(p_velden->'correcties') > 60 then raise exception 'Ongeldige lijst met correcties.'; end if;
    lijst := '[]'::jsonb;
    for x in select * from jsonb_array_elements(p_velden->'correcties') loop
      continue when public.rd_tekst(x->>'tekst', 1000) = '';
      lijst := lijst || jsonb_build_array(jsonb_build_object('id', coalesce(nullif(x->>'id', ''), md5(random()::text)), 'tekst', public.rd_tekst(x->>'tekst', 1000),
        'actief', coalesce((x->>'actief')::boolean, true), 'datum', coalesce(x->>'datum', now()::text), 'door', x->>'door', 'opdracht_id', x->>'opdracht_id'));
    end loop;
    update public.render_standpunten set correcties = lijst where id = s.id;
  end if;
  if jsonb_typeof(p_velden->'correcties_actief') = 'object' then
    update public.render_standpunten set correcties = coalesce((select jsonb_agg(case when p_velden->'correcties_actief' ? (c->>'id') then jsonb_set(c, '{actief}', to_jsonb(((p_velden->'correcties_actief')->>(c->>'id'))::boolean)) else c end order by i)
                                                              from jsonb_array_elements(correcties) with ordinality as e(c, i)), '[]'::jsonb)
    where id = s.id;
  end if;
  if p_velden ? 'achtergrond_keuze' and not (p_velden ? 'ruimte_id' and (p_velden->>'ruimte_id')::uuid is distinct from s.ruimte_id) then   -- bij verplaatsen: keuze van de oude ruimte vervalt
    select coalesce(array_agg(distinct v::uuid), '{}') into ag from jsonb_array_elements_text(p_velden->'achtergrond_keuze') v;
    select * into rr from public.render_ruimtes where id = (select ruimte_id from public.render_standpunten where id = s.id);
    if exists (select 1 from unnest(ag) a where not rr.achtergronden @> jsonb_build_array(jsonb_build_object('id', a::text))) then
      raise exception 'Kies achtergronden die bij de ruimte vastgelegd zijn.'; end if;
    update public.render_standpunten set achtergrond_keuze = ag where id = s.id;
  end if;
  update public.render_standpunten set
    naam = case when p_velden ? 'naam' and public.rd_tekst(p_velden->>'naam', 120) <> '' then public.rd_tekst(p_velden->>'naam', 120) else naam end,
    omgeving_notitie = case when p_velden ? 'omgeving_notitie' then public.rd_tekst(p_velden->>'omgeving_notitie', 1000) else omgeving_notitie end,
    volgorde = case when p_velden ? 'volgorde' then coalesce((p_velden->>'volgorde')::int, volgorde) else volgorde end
  where id = s.id returning * into s;
  return s;
end $$;

-- hoofdversie of presentatieversie kiezen (los van goedkeuring)
create or replace function public.render_standpunt_kies(p_standpunt uuid, p_beeld uuid, p_rol text, p_aan boolean)
returns public.render_standpunten language plpgsql security definer set search_path = public as $$
declare s public.render_standpunten;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  if p_rol not in ('hoofd', 'presentatie') then raise exception 'Ongeldige keuze.'; end if;
  if not exists (select 1 from public.render_beelden where id = p_beeld and standpunt_id = p_standpunt and soort = 'render') then raise exception 'Deze versie hoort niet bij dit standpunt.'; end if;
  update public.render_standpunten set
    hoofdversie_id = case when p_rol = 'hoofd' then case when p_aan then p_beeld when hoofdversie_id = p_beeld then null else hoofdversie_id end else hoofdversie_id end,
    presentatie_id = case when p_rol = 'presentatie' then case when p_aan then p_beeld when presentatie_id = p_beeld then null else presentatie_id end else presentatie_id end,
    keuze_op = now()
  where id = p_standpunt returning * into s;
  if s.id is null then raise exception 'Standpunt niet gevonden.'; end if;
  return s;
end $$;

-- een beeld handmatig aan een standpunt koppelen (p_standpunt) of ervan losmaken (null)
create or replace function public.render_beeld_koppel(p_beeld uuid, p_standpunt uuid)
returns public.render_beelden language plpgsql security definer set search_path = public as $$
declare b public.render_beelden; s public.render_standpunten; rr public.render_ruimtes;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  select * into b from public.render_beelden where id = p_beeld and soort in ('ontwerp', 'render') for update;
  if b.id is null then raise exception 'Enkel een ontwerp of render kan gekoppeld worden.'; end if;
  if b.standpunt_id is not null then   -- eerst los van het vorige standpunt (keuzes die naar dit beeld wezen, vervallen)
    update public.render_standpunten set hoofdversie_id = case when hoofdversie_id = b.id then null else hoofdversie_id end,
           presentatie_id = case when presentatie_id = b.id then null else presentatie_id end, ontwerp_id = case when ontwerp_id = b.id then null else ontwerp_id end
    where id = b.standpunt_id;
  end if;
  if p_standpunt is null then
    update public.render_beelden set standpunt_id = null, koppeling = 'handmatig' where id = b.id returning * into b;
    return b;
  end if;
  perform pg_advisory_xact_lock(hashtext('standpunt:' || p_standpunt::text));
  select * into s from public.render_standpunten where id = p_standpunt and project_id = b.project_id for update;
  if s.id is null then raise exception 'Kies een standpunt van hetzelfde project.'; end if;
  select * into rr from public.render_ruimtes where id = s.ruimte_id;
  update public.render_beelden set standpunt_id = s.id, ruimte = rr.naam, ruimte_id = rr.id, koppeling = 'handmatig',
         versie = case when b.soort = 'render' and (b.standpunt_id is distinct from s.id or b.versie is null)
                       then (select coalesce(max(versie), 0) + 1 from public.render_beelden where standpunt_id = s.id and soort = 'render') else b.versie end
  where id = b.id returning * into b;
  if b.soort = 'ontwerp' and s.ontwerp_id is null then update public.render_standpunten set ontwerp_id = b.id where id = s.id; end if;
  return b;
end $$;

-- een los beeld (ontwerp of render) wordt een eigen standpunt in zijn ruimte
create or replace function public.render_standpunt_nieuw(p_beeld uuid, p_ruimte uuid, p_naam text)
returns public.render_standpunten language plpgsql security definer set search_path = public as $$
declare b public.render_beelden; s public.render_standpunten; rr public.render_ruimtes;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  select * into b from public.render_beelden where id = p_beeld and soort in ('ontwerp', 'render');
  if b.id is null then raise exception 'Enkel een ontwerp of render kan een standpunt worden.'; end if;
  select * into rr from public.render_ruimtes where id = coalesce(p_ruimte, b.ruimte_id) and project_id = b.project_id;
  if rr.id is null then raise exception 'Kies de ruimte van het nieuwe standpunt.'; end if;
  insert into public.render_standpunten (project_id, ruimte_id, naam, ontwerp_id, koppeling, volgorde)
  values (b.project_id, rr.id, left(coalesce(nullif(trim(p_naam), ''), regexp_replace(b.naam, '\.[A-Za-z0-9]{2,4}$', ''), 'Standpunt'), 120), case when b.soort = 'ontwerp' then b.id end, 'handmatig',
          (select coalesce(max(volgorde), 0) + 1 from public.render_standpunten where ruimte_id = rr.id))
  returning * into s;
  perform public.render_beeld_koppel(b.id, s.id);
  select * into s from public.render_standpunten where id = s.id;
  return s;
end $$;

-- twee standpunten samenvoegen (bv. hetzelfde ontwerp twee keer opgeladen): alle versies gaan naar p_naar
create or replace function public.render_standpunt_samenvoegen(p_van uuid, p_naar uuid)
returns public.render_standpunten language plpgsql security definer set search_path = public as $$
declare a public.render_standpunten; z public.render_standpunten; rr public.render_ruimtes; m int;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  if p_van = p_naar then raise exception 'Kies twee verschillende standpunten.'; end if;
  perform pg_advisory_xact_lock(hashtext('standpunt:' || p_naar::text));
  select * into a from public.render_standpunten where id = p_van for update;
  select * into z from public.render_standpunten where id = p_naar for update;
  if a.id is null or z.id is null or a.project_id <> z.project_id then raise exception 'Kies twee standpunten van hetzelfde project.'; end if;
  if exists (select 1 from public.render_opdrachten where standpunt_id = a.id and status in ('wachtrij', 'bezig')) then raise exception 'Er loopt nog een render op dit standpunt. Wacht tot hij klaar is.'; end if;
  select * into rr from public.render_ruimtes where id = z.ruimte_id;
  select coalesce(max(versie), 0) into m from public.render_beelden where standpunt_id = z.id and soort = 'render';
  update public.render_beelden set standpunt_id = z.id, ruimte = rr.naam, ruimte_id = rr.id, versie = case when soort = 'render' then coalesce(versie, 0) + m else versie end, koppeling = 'handmatig'
  where standpunt_id = a.id;
  update public.render_opdrachten set standpunt_id = z.id, ruimte = rr.naam, ruimte_id = rr.id where standpunt_id = a.id;
  update public.render_standpunten set ontwerp_id = coalesce(z.ontwerp_id, a.ontwerp_id), hoofdversie_id = coalesce(z.hoofdversie_id, a.hoofdversie_id),
         presentatie_id = coalesce(z.presentatie_id, a.presentatie_id), controlelijst = z.controlelijst || a.controlelijst, correcties = z.correcties || a.correcties,
         omgeving_notitie = trim(both ' ' from z.omgeving_notitie || case when a.omgeving_notitie <> '' and z.omgeving_notitie <> '' then ' · ' else '' end || a.omgeving_notitie),
         koppeling = 'handmatig', koppeling_reden = '', keuze_op = now()
  where id = z.id returning * into z;
  delete from public.render_standpunten where id = a.id;
  return z;
end $$;

-- een onzekere (gemigreerde) koppeling bevestigen
create or replace function public.render_koppeling_bevestig(p_standpunt uuid)
returns public.render_standpunten language plpgsql security definer set search_path = public as $$
declare s public.render_standpunten;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  update public.render_standpunten set koppeling = 'handmatig', koppeling_reden = '' where id = p_standpunt returning * into s;
  if s.id is null then raise exception 'Standpunt niet gevonden.'; end if;
  update public.render_beelden set koppeling = 'handmatig' where standpunt_id = s.id and koppeling = 'onzeker';
  return s;
end $$;

-- een render die vroeger los aan een ruimte gekoppeld werd (056): bij een standpunt verhuist het hele standpunt
create or replace function public.render_beeld_ruimte(p_beeld uuid, p_ruimte text)
returns public.render_beelden language plpgsql security definer set search_path = public as $$
declare b public.render_beelden; v_ruimte text := left(trim(coalesce(p_ruimte, '')), 120);
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  if v_ruimte = '' or v_ruimte = '*' then raise exception 'Vul de ruimte in.'; end if;
  select * into b from public.render_beelden where id = p_beeld and soort in ('ontwerp', 'render');
  if b.id is null then raise exception 'Enkel een ontwerp of render kan aan een ruimte gekoppeld worden.'; end if;
  if b.standpunt_id is not null then
    perform public.render_standpunt_bewaar(b.standpunt_id, jsonb_build_object('ruimte_id', public.rd_ruimte_id(b.project_id, v_ruimte)));
    select * into b from public.render_beelden where id = p_beeld;
    return b;
  end if;
  update public.render_beelden set ruimte = v_ruimte where id = b.id returning * into b;
  if b.soort = 'render' then update public.render_opdrachten set ruimte = v_ruimte where resultaat_id = b.id and soort = 'render'; end if;
  return b;
end $$;

-- ---------- 6. een render of correctie aanvragen (betaald) ----------
-- p_modus 'nieuw': p_bron = een nieuw opgeladen ontwerp {"pad","naam","mime","grootte","sha256","breedte","hoogte"} (pad =
--   <project>/ontwerp/<request_id>.<ext>) of {"id": bestaand ontwerp}. Een nieuw ontwerp wordt een nieuw standpunt in p_ruimte;
--   een bestaand ontwerp rendert opnieuw binnen zijn eigen standpunt.
-- p_modus 'correctie': p_bron = {"id": een versie van het standpunt} (ook een oudere: de vertakking blijft bewaard). Het
--   oorspronkelijke ontwerp gaat apart mee als geometrische referentie; geen sfeerbeelden (de belichting blijft).
-- Idempotent op (aanvrager, request_id), zelfde daglimiet en modelcontrole als render_aanvragen.
create or replace function public.render_standpunt_aanvragen(p_project uuid, p_request_id text, p_modus text, p_ruimte text, p_standpunt uuid, p_standpunt_naam text,
                                                             p_bron jsonb, p_instructie text, p_sfeer_ids uuid[], p_kwaliteit text, p_model text, p_toestemming boolean,
                                                             p_correctie_bewaren boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg jsonb := public.rd_instelling(); o public.render_opdrachten; b public.render_beelden; s public.render_standpunten; rr public.render_ruimtes; p public.projecten;
        dig text; vandaag date; n int; sfeer uuid[] := coalesce(p_sfeer_ids, '{}'); afspr jsonb; ext text; ag uuid[]; ctx jsonb; sid uuid; instr text := trim(coalesce(p_instructie, ''));
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  if coalesce(p_request_id, '') !~ '^[0-9a-f]{32}$' then raise exception 'Ongeldig aanvraagnummer.'; end if;
  if p_modus not in ('nieuw', 'correctie') then raise exception 'Ongeldige soort aanvraag.'; end if;
  dig := md5(jsonb_build_object('p', p_project, 'm', p_modus, 'r', trim(coalesce(p_ruimte, '')), 's', p_standpunt, 'sn', trim(coalesce(p_standpunt_naam, '')),
                                'b', coalesce(p_bron, '{}'::jsonb) - 'breedte' - 'hoogte', 'i', instr, 'sf', to_jsonb(sfeer), 'k', p_kwaliteit, 'model', p_model,
                                'cb', coalesce(p_correctie_bewaren, true))::text);
  -- 1. dezelfde aanvraag al ontvangen? (ook na een netwerkfout: nooit een tweede betaalde opdracht)
  perform pg_advisory_xact_lock(hashtext('render_aanvraag:' || auth.uid()::text || ':' || p_request_id));
  select * into o from public.render_opdrachten where aangevraagd_door = auth.uid() and request_id = p_request_id;
  if o.id is not null then
    if o.digest <> dig then raise exception 'Deze aanvraag werd al verwerkt met andere instellingen. Start een nieuwe aanvraag.'; end if;
    return jsonb_build_object('opdracht', to_jsonb(o), 'bron', (select to_jsonb(x) from public.render_beelden x where x.id = o.bron_id),
                              'standpunt', (select to_jsonb(x) from public.render_standpunten x where x.id = o.standpunt_id), 'hergebruikt', true);
  end if;
  -- 2. controles
  if p_toestemming is not true then raise exception 'Bevestig eerst de betaalde beeldgeneratie.'; end if;
  select * into p from public.projecten where id = p_project;
  if p.id is null then raise exception 'Project niet gevonden.'; end if;
  if length(instr) = 0 or length(instr) > 4000 then raise exception 'Beschrijf wat er gerenderd of gecorrigeerd moet worden (max. 4000 tekens).'; end if;
  if p_kwaliteit not in ('low', 'medium', 'high') then raise exception 'Ongeldige kwaliteit.'; end if;
  if p_model is distinct from cfg->>'model' then raise exception 'Het beeldmodel werd intussen gewijzigd (nu %). Herlaad het Planbord en bevestig opnieuw.', cfg->>'model'; end if;
  if p_modus = 'correctie' and cardinality(sfeer) > 0 then raise exception 'Bij een correctie gaan er geen sfeerbeelden mee: de belichting van de gekozen versie blijft.'; end if;
  if cardinality(sfeer) > 4 or (select count(distinct x) from unnest(sfeer) x) <> cardinality(sfeer) then raise exception 'Kies maximaal vier verschillende sfeerbeelden.'; end if;
  if exists (select 1 from unnest(sfeer) x where not exists (select 1 from public.render_beelden sx where sx.id = x and sx.project_id = p_project and sx.soort = 'sfeer')) then
    raise exception 'Kies sfeerbeelden uit de sfeerbibliotheek van dit project.'; end if;
  if p_modus = 'correctie' then
    select * into b from public.render_beelden where id = (p_bron->>'id')::uuid and project_id = p_project and soort = 'render' and standpunt_id is not null;
    if b.id is null then raise exception 'Kies de versie van dit standpunt die gecorrigeerd moet worden.'; end if;
    if p_standpunt is not null and p_standpunt <> b.standpunt_id then raise exception 'Deze versie hoort bij een ander standpunt.'; end if;
    select * into s from public.render_standpunten where id = b.standpunt_id;
  else
    if p_bron ? 'id' then
      select * into b from public.render_beelden where id = (p_bron->>'id')::uuid and project_id = p_project and soort = 'ontwerp';
      if b.id is null then raise exception 'Kies een ontwerp van dit project.'; end if;
    else
      if trim(coalesce(p_ruimte, '')) in ('', '*') then raise exception 'Vul de ruimte in.'; end if;
      ext := lower(substring(coalesce(p_bron->>'pad', '') from '\.([a-z0-9]{3,4})$'));
      if coalesce(p_bron->>'pad', '') <> p_project::text || '/ontwerp/' || p_request_id || '.' || coalesce(ext, '') or coalesce(ext, '') not in ('png', 'jpg', 'jpeg', 'webp') then
        raise exception 'Ongeldig pad voor het ontwerpbeeld.'; end if;
      if p_bron->>'mime' not in ('image/png', 'image/jpeg', 'image/webp') then raise exception 'Enkel PNG, JPEG of WebP.'; end if;
      if coalesce(p_bron->>'sha256', '') !~ '^[0-9a-f]{64}$' then raise exception 'Beeld zonder controlegetal.'; end if;
      if not public.rd_object_ok(p_bron->>'pad', (p_bron->>'grootte')::bigint) then raise exception 'Het ontwerpbeeld staat (nog) niet volledig in de opslag. Probeer opnieuw.'; end if;
    end if;
  end if;
  -- 3. daglimiet (renders en stalenborden samen, hele team, per kalenderdag in België)
  perform pg_advisory_xact_lock(hashtext('render_daglimiet'));
  vandaag := (now() at time zone 'Europe/Brussels')::date;
  select count(*) into n from public.render_opdrachten where dag = vandaag and status <> 'geannuleerd';
  if n + 1 > (cfg->>'daglimiet')::int then raise exception 'Daglimiet bereikt (% beelden vandaag). Een beheerder kan die verhogen in Instellingen › Renders.', n; end if;
  -- 4. bron en standpunt (een nieuw ontwerp = een nieuw standpunt; een bestaand ontwerp = zijn eigen standpunt)
  if p_modus = 'nieuw' and b.id is null then
    select * into b from public.render_beelden where pad = p_bron->>'pad';
    if b.id is null then
      insert into public.render_beelden (project_id, soort, ruimte, naam, pad, mime, grootte, breedte, hoogte, sha256)
      values (p_project, 'ontwerp', left(trim(regexp_replace(p_ruimte, '\s+', ' ', 'g')), 120), left(coalesce(nullif(trim(p_bron->>'naam'), ''), 'ontwerp'), 200), p_bron->>'pad', p_bron->>'mime',
              (p_bron->>'grootte')::bigint, nullif(p_bron->>'breedte', '')::int, nullif(p_bron->>'hoogte', '')::int, p_bron->>'sha256')
      returning * into b;
    end if;
  end if;
  if p_modus = 'nieuw' then
    sid := public.rd_standpunt_voor(b.id, p_standpunt_naam);   -- eerst uitvoeren, dan lezen (een nieuw standpunt is anders niet zichtbaar)
    select * into s from public.render_standpunten where id = sid;
    select * into b from public.render_beelden where id = b.id;
  end if;
  select * into rr from public.render_ruimtes where id = s.ruimte_id;
  -- 5. context (kopie): werfadres, ruimte, licht, bevestigde controlepunten, geldende correcties, achtergronden
  ag := case when cardinality(s.achtergrond_keuze) > 0 then s.achtergrond_keuze
             else coalesce((select array_agg((x->>'id')::uuid order by i) from jsonb_array_elements(rr.achtergronden) with ordinality as e(x, i)), '{}') end;
  ag := coalesce((select array_agg(a order by i) from unnest(ag) with ordinality as u(a, i) where exists (select 1 from public.render_beelden z where z.id = a and z.project_id = p_project)), '{}');
  ag := ag[1:6];
  ctx := jsonb_build_object(
    'adres', jsonb_build_object('adres', coalesce(p.adres, ''), 'postcode', coalesce(p.postcode, ''), 'gemeente', coalesce(p.gemeente, '')),
    'ruimte', jsonb_build_object('naam', rr.naam, 'verdieping', rr.verdieping, 'zijde', rr.zijde, 'kijkrichting', rr.kijkrichting, 'notitie', rr.omgeving_notitie,
                                 'licht', rr.licht, 'licht_notitie', rr.licht_notitie),
    'standpunt', jsonb_build_object('naam', s.naam, 'omgeving_notitie', s.omgeving_notitie),
    'controlelijst', coalesce((select jsonb_agg(jsonb_build_object('soort', x->>'soort', 'tekst', x->>'tekst')) from jsonb_array_elements(s.controlelijst) x where (x->>'bevestigd')::boolean), '[]'::jsonb),
    'correcties', coalesce((select jsonb_agg(x->>'tekst' order by i) from jsonb_array_elements(s.correcties) with ordinality as e(x, i)
                            where coalesce((x->>'actief')::boolean, true)
                              and not exists (select 1 from public.render_opdrachten q where q.id::text = x->>'opdracht_id' and q.status in ('mislukt', 'geannuleerd', 'onzeker'))), '[]'::jsonb),
    'achtergronden', coalesce((select jsonb_agg(jsonb_build_object('id', a, 'omschrijving', coalesce((select x->>'omschrijving' from jsonb_array_elements(rr.achtergronden) x where x->>'id' = a::text limit 1), '')) order by i)
                               from unnest(ag) with ordinality as u(a, i)), '[]'::jsonb),
    'basis_versie', case when p_modus = 'correctie' then b.versie end);
  -- 6. afspraken van deze ruimte en het hele project (kopie)
  select coalesce(jsonb_agg(jsonb_build_object('ruimte', a.ruimte, 'tekst', a.tekst) order by a.ruimte, a.created_at), '[]'::jsonb) into afspr
  from public.render_afspraken a where a.project_id = p_project and (a.ruimte = '*' or a.ruimte_id = rr.id or lower(trim(a.ruimte)) = lower(trim(rr.naam)));
  insert into public.render_opdrachten (project_id, soort, modus, ruimte, ruimte_id, standpunt_id, ontwerp_id, instructie, bron_id, sfeer_ids, achtergrond_ids, afspraken, context,
                                        model, kwaliteit, lange_zijde, request_id, digest, dag)
  values (p_project, 'render', p_modus, rr.naam, rr.id, s.id, s.ontwerp_id, instr, b.id, sfeer, ag, afspr, ctx,
          cfg->>'model', p_kwaliteit, (cfg->>'lange_zijde')::int, p_request_id, dig, vandaag)
  returning * into o;
  -- 7. een correctie blijft gelden voor de volgende versies van dit standpunt (aanpasbaar in het standpunt)
  if p_modus = 'correctie' and coalesce(p_correctie_bewaren, true)
     and not exists (select 1 from jsonb_array_elements(s.correcties) x where lower(trim(x->>'tekst')) = lower(left(instr, 1000))
                     and coalesce((x->>'actief')::boolean, true)
                     and not exists (select 1 from public.render_opdrachten q where q.id::text = x->>'opdracht_id' and q.status in ('mislukt', 'geannuleerd', 'onzeker'))) then
    update public.render_standpunten set correcties = correcties || jsonb_build_array(jsonb_build_object('id', o.id::text, 'tekst', left(instr, 1000), 'actief', true,
           'datum', now()::text, 'door', coalesce((select name from public.profiles where id = auth.uid()), ''), 'opdracht_id', o.id::text))
    where id = s.id;
  end if;
  return jsonb_build_object('opdracht', to_jsonb(o), 'bron', to_jsonb(b), 'standpunt', (select to_jsonb(x) from public.render_standpunten x where x.id = s.id), 'hergebruikt', false);
end $$;

-- ---------- 7. verwerkingscomputer ----------
create or replace function public.render_claim(p_naam text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.render_opdrachten; p public.projecten; r record; bron public.render_beelden; kan jsonb;
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
  -- wat deze verwerkingscomputer kan (gemeld met verwerker_meld): stalenborden (1.60+), standpunten met rollen (1.61+).
  -- Een oudere verwerker laat zulke opdrachten in de wachtrij (er wordt niets betaald), gewone aanvragen doet hij wel.
  select coalesce((select v.info from public.verwerker_status v where v.naam = left(p_naam, 60) and v.user_id = auth.uid()), '{}'::jsonb) into kan;
  select * into o from public.render_opdrachten x where x.status = 'wachtrij'
    and ((x.soort = 'render' and (x.modus is null or kan->>'standpunten' = 'true')) or (x.soort = 'stalenbord' and kan->>'stalenborden' = 'true'))
    order by x.created_at limit 1 for update skip locked;
  if o.id is null then return null; end if;
  update public.render_opdrachten set status = 'bezig', worker = left(p_naam, 60), worker_user = auth.uid(), claim = gen_random_uuid(), lease_tot = now() + interval '10 minutes',
         pogingen = pogingen + 1, gestart_op = coalesce(gestart_op, now()), stap = 'gestart', voortgang = 0, fout = '' where id = o.id returning * into o;
  update public.verwerker_status set huidige_job = o.id where naam = left(p_naam, 60);
  select * into p from public.projecten where id = o.project_id;
  select * into bron from public.render_beelden where id = o.bron_id;
  return jsonb_build_object(
    'job', jsonb_build_object('id', o.id, 'claim', o.claim, 'soort', 'render', 'poging', o.pogingen, 'max_pogingen', o.max_pogingen),
    'opdracht', jsonb_build_object('id', o.id, 'soort', o.soort, 'modus', coalesce(o.modus, case when bron.soort = 'render' then 'correctie' else 'nieuw' end),
                                   'ruimte', o.ruimte, 'instructie', o.instructie, 'afspraken', o.afspraken, 'materialen', o.materialen, 'context', coalesce(o.context, '{}'::jsonb),
                                   'standpunt_id', o.standpunt_id, 'legende', o.legende, 'model', o.model, 'kwaliteit', o.kwaliteit, 'lange_zijde', o.lange_zijde,
                                   'api_verstuurd_op', o.api_verstuurd_op, 'gebruiker', md5('bros-render:' || coalesce(o.aangevraagd_door::text, '')),
                                   'controle', coalesce((select (value->>'controle')::boolean from public.instellingen where key = 'render'), true)),
    'bron', jsonb_build_object('id', bron.id, 'pad', bron.pad, 'mime', bron.mime, 'sha256', bron.sha256, 'soort', bron.soort, 'naam', bron.naam, 'versie', bron.versie),
    'ontwerp', (select jsonb_build_object('id', x.id, 'pad', x.pad, 'mime', x.mime, 'sha256', x.sha256, 'naam', x.naam) from public.render_beelden x
                where x.id = o.ontwerp_id and x.id <> o.bron_id and x.project_id = o.project_id),
    'sfeer', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'pad', s.pad, 'mime', s.mime, 'sha256', s.sha256) order by array_position(o.sfeer_ids, s.id))
                       from public.render_beelden s where s.id = any(o.sfeer_ids)), '[]'::jsonb),
    'achtergronden', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'pad', s.pad, 'mime', s.mime, 'sha256', s.sha256, 'naam', s.naam,
                                                 'omschrijving', coalesce((select c->>'omschrijving' from jsonb_array_elements(coalesce(o.context->'achtergronden', '[]'::jsonb)) c where c->>'id' = s.id::text limit 1), s.omschrijving))
                                    order by array_position(o.achtergrond_ids, s.id))
                               from public.render_beelden s where s.id = any(o.achtergrond_ids) and s.project_id = o.project_id), '[]'::jsonb),
    'referenties', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'pad', s.pad, 'mime', s.mime, 'sha256', s.sha256, 'naam', s.naam, 'soort', s.soort) order by array_position(o.referentie_ids, s.id))
                             from public.render_beelden s where s.id = any(o.referentie_ids) and s.project_id = o.project_id), '[]'::jsonb),
    'basis', (select jsonb_build_object('id', s.id, 'pad', s.pad, 'mime', s.mime, 'sha256', s.sha256, 'versie', s.versie) from public.render_beelden s
              where s.id = o.basis_id and s.project_id = o.project_id and s.soort = 'stalenbord'),
    'controlelijst_leeg', coalesce((select jsonb_array_length(controlelijst) = 0 from public.render_standpunten where id = o.standpunt_id), false),
    'project', jsonb_build_object('id', p.id, 'nummer', p.nummer, 'klant', p.klant, 'naam', p.naam, 'drive', coalesce(p.drive_folder_id, '') <> '',
                                  'adres', coalesce(p.adres, ''), 'postcode', coalesce(p.postcode, ''), 'gemeente', coalesce(p.gemeente, '')));
end $$;

-- resultaat: renders/<project>/render/<opdracht>.<ext> of …/stalenbord/…; een render wordt een nieuwe versie van zijn standpunt
-- (een mislukte opdracht maakt geen versie: de vorige bruikbare versie blijft staan)
create or replace function public.render_klaar(p_job uuid, p_claim uuid, p_resultaat jsonb)
returns public.render_opdrachten language plpgsql security definer set search_path = public as $$
declare o public.render_opdrachten; b public.render_beelden; v int; bron public.render_beelden; sid uuid; voorstel jsonb := '[]'::jsonb; x jsonb;
begin
  o := public.rd_eigen(p_job, p_claim);
  if o.status not in ('bezig', 'onzeker') then raise exception 'Deze render loopt niet meer (status %).', o.status; end if;
  if coalesce(p_resultaat->>'pad', '') !~ ('^' || o.project_id::text || '/' || o.soort || '/' || o.id::text || '\.(png|jpg|webp)$') then raise exception 'Ongeldig pad voor de render.'; end if;
  if not public.rd_object_ok(p_resultaat->>'pad', (p_resultaat->>'grootte')::bigint) then raise exception 'De render staat niet volledig in de opslag.'; end if;
  select * into bron from public.render_beelden where id = o.bron_id;
  if o.soort = 'stalenbord' then
    perform pg_advisory_xact_lock(hashtext('stalenbord:' || o.project_id::text || ':' || lower(trim(o.ruimte))));
    select versie into v from public.render_beelden where pad = p_resultaat->>'pad';
    if v is null then
      select coalesce(max(versie), 0) + 1 into v from public.render_beelden where project_id = o.project_id and soort = 'stalenbord' and lower(trim(ruimte)) = lower(trim(o.ruimte));
    end if;
  else
    sid := coalesce(o.standpunt_id, bron.standpunt_id, public.rd_standpunt_voor(bron.id));
    if sid is not null then
      perform pg_advisory_xact_lock(hashtext('standpunt:' || sid::text));
      select versie into v from public.render_beelden where pad = p_resultaat->>'pad';
      if v is null then select coalesce(max(versie), 0) + 1 into v from public.render_beelden where standpunt_id = sid and soort = 'render'; end if;
    end if;
  end if;
  insert into public.render_beelden (project_id, soort, ruimte, naam, pad, mime, grootte, breedte, hoogte, sha256, opdracht_id, drive, created_by, versie,
                                     standpunt_id, basis_beeld_id, koppeling, controle)
  values (o.project_id, o.soort, o.ruimte, left(coalesce(p_resultaat->>'naam', o.soort), 200), p_resultaat->>'pad', coalesce(p_resultaat->>'mime', 'image/png'),
          (p_resultaat->>'grootte')::bigint, nullif(p_resultaat->>'breedte', '')::int, nullif(p_resultaat->>'hoogte', '')::int, coalesce(p_resultaat->>'sha256', ''), o.id,
          case when jsonb_typeof(p_resultaat->'drive') = 'object' then p_resultaat->'drive' end, o.aangevraagd_door, v,
          sid, case when o.soort = 'render' and bron.soort = 'render' then bron.id end, case when sid is not null then 'zeker' when o.soort = 'render' then 'onzeker' end,
          case when jsonb_typeof(p_resultaat->'controle') = 'object' then p_resultaat->'controle' end)
  on conflict (pad) do update set drive = excluded.drive, controle = coalesce(excluded.controle, render_beelden.controle)
  returning * into b;
  -- voorstel voor de controlelijst (automatisch vermoeden): enkel als het standpunt nog geen lijst heeft, en NIET bevestigd
  if sid is not null and jsonb_typeof(p_resultaat->'voorstel_controlelijst') = 'array' then
    for x in select * from jsonb_array_elements(p_resultaat->'voorstel_controlelijst') limit 40 loop
      continue when public.rd_tekst(x->>'tekst', 300) = '';
      voorstel := voorstel || jsonb_build_array(jsonb_build_object('id', md5(random()::text),
        'soort', case when x->>'soort' in ('opening', 'wand', 'dak', 'kast', 'schab', 'meubel', 'armatuur', 'decoratie', 'ander') then x->>'soort' else 'ander' end,
        'tekst', public.rd_tekst(x->>'tekst', 300), 'bevestigd', false, 'bron', 'voorstel'));
    end loop;
    update public.render_standpunten set controlelijst = voorstel where id = sid and jsonb_array_length(controlelijst) = 0 and jsonb_array_length(voorstel) > 0;
  end if;
  update public.render_opdrachten set status = 'klaar', resultaat_id = b.id, standpunt_id = coalesce(standpunt_id, sid), klaar_op = now(), lease_tot = null, stap = '', voortgang = 1,
         fout = left(coalesce(p_resultaat->>'melding', ''), 500), openai_request_id = left(coalesce(p_resultaat->>'openai_request_id', ''), 200),
         verbruik = case when jsonb_typeof(p_resultaat->'verbruik') = 'object' then p_resultaat->'verbruik' end
  where id = p_job returning * into o;
  update public.verwerker_status set huidige_job = null where user_id = auth.uid() and huidige_job = p_job;
  return o;
end $$;

-- automatische controle bewaren NA render_klaar (de registratie van het betaalde beeld wacht nooit op de controle)
create or replace function public.render_controle_bewaar(p_job uuid, p_claim uuid, p_controle jsonb, p_voorstel jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.render_opdrachten; voorstel jsonb := '[]'::jsonb; x jsonb;
begin
  o := public.rd_eigen(p_job, p_claim);
  if o.status <> 'klaar' or o.resultaat_id is null then return jsonb_build_object('ok', false, 'status', o.status); end if;
  if jsonb_typeof(p_controle) = 'object' then
    update public.render_beelden set controle = p_controle where id = o.resultaat_id;
  end if;
  if o.standpunt_id is not null and jsonb_typeof(p_voorstel) = 'array' then
    for x in select * from jsonb_array_elements(p_voorstel) limit 40 loop
      continue when public.rd_tekst(x->>'tekst', 300) = '';
      voorstel := voorstel || jsonb_build_array(jsonb_build_object('id', md5(random()::text),
        'soort', case when x->>'soort' in ('opening', 'wand', 'dak', 'kast', 'schab', 'meubel', 'armatuur', 'decoratie', 'ander') then x->>'soort' else 'ander' end,
        'tekst', public.rd_tekst(x->>'tekst', 300), 'bevestigd', false, 'bron', 'voorstel'));
    end loop;
    update public.render_standpunten set controlelijst = voorstel where id = o.standpunt_id and jsonb_array_length(controlelijst) = 0 and jsonb_array_length(voorstel) > 0;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- 8. opslag: ook achtergrondfoto's van het team ----------
create or replace function public.rd_bestand_weg_ok(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_intern() and split_part(p_name, '/', 2) in ('ontwerp', 'sfeer', 'achtergrond') and not exists (select 1 from public.render_beelden b where b.pad = p_name)
$$;
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    execute 'drop policy if exists renders_insert on storage.objects';
    execute $p$create policy renders_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'renders' and split_part(name, '/', 4) = '' and (
        (split_part(name, '/', 2) in ('ontwerp', 'sfeer', 'achtergrond') and public.rd_project_ok(public.rd_pad_project(name)))
        or (split_part(name, '/', 2) in ('render', 'stalenbord', 'presentatie') and public.rd_job_pad_ok(name))))$p$;
  end if;
end $$;

-- ---------- 9. live ----------
do $$ declare t text; begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['render_ruimtes', 'render_standpunten'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
        execute 'alter publication supabase_realtime add table public.' || t;
      end if;
    end loop;
  end if;
end $$;

-- ---------- rechten ----------
revoke all on function public.rd_ruimte_id(uuid, text), public.rd_standpunt_voor(uuid, text) from public, anon, authenticated;
do $$ declare f text; begin
  foreach f in array array['render_ruimte_maak(uuid, text)', 'render_ruimte_bewaar(uuid, jsonb)',
                           'render_achtergrond_bewaar(uuid, text, text, text, bigint, text, integer, integer, text)', 'render_standpunt_bewaar(uuid, jsonb)',
                           'render_standpunt_kies(uuid, uuid, text, boolean)', 'render_beeld_koppel(uuid, uuid)', 'render_standpunt_nieuw(uuid, uuid, text)',
                           'render_standpunt_samenvoegen(uuid, uuid)', 'render_koppeling_bevestig(uuid)', 'render_beeld_ruimte(uuid, text)',
                           'render_standpunt_aanvragen(uuid, text, text, text, uuid, text, jsonb, text, uuid[], text, text, boolean, boolean)',
                           'render_claim(text)', 'render_klaar(uuid, uuid, jsonb)', 'render_controle_bewaar(uuid, uuid, jsonb, jsonb)', 'rd_bestand_weg_ok(text)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';   -- de functies controleren zelf de rol
  end loop;
end $$;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(57, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: moet 2 | 2 | 0 | 57 teruggeven (nieuwe tabellen, met RLS, renders zonder standpunt die niet gemarkeerd zijn, schemaversie).
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('render_ruimtes', 'render_standpunten'))::int as tabellen,
       (select count(*) from pg_tables where schemaname = 'public' and tablename in ('render_ruimtes', 'render_standpunten') and rowsecurity)::int as rls,
       (select count(*) from public.render_beelden where soort = 'render' and standpunt_id is null and coalesce(koppeling, '') not in ('onzeker', 'handmatig'))::int as los,
       (select (value->>'versie_schema')::int from public.instellingen where key = 'app') as schema;
