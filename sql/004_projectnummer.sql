-- =====================================================================
--  BROS Planbord — databasescript 004: projectnummer, klanttype en
--  extra projectgegevens voor rapportage. Alleen toevoegingen; mag
--  opnieuw uitgevoerd worden.
-- =====================================================================

-- 1. Nieuwe kolommen
alter table public.projecten
  add column if not exists nummer          text,
  add column if not exists klanttype       text    not null default 'particulier' check (klanttype in ('particulier','zakelijk')),
  add column if not exists bedrijf         text    not null default '',
  add column if not exists btw_nummer      text    not null default '',
  add column if not exists projecttype     text    not null default '',
  add column if not exists btw_tarief      int,
  add column if not exists bron            text    not null default '',
  add column if not exists oppervlakte_m2  numeric(8,1),
  add column if not exists offerte_datum   date,
  add column if not exists contract_datum  date,
  add column if not exists opgeleverd_op   date,
  add column if not exists verloren_reden  text    not null default '',
  add column if not exists tags            text    not null default '';

create unique index if not exists projecten_nummer_idx on public.projecten(nummer);

-- 2. Status 'verloren' toelaten (offerte niet doorgegaan)
alter table public.projecten drop constraint if exists projecten_status_check;
alter table public.projecten add constraint projecten_status_check
  check (status in ('offerte','lopend','on_hold','afgerond','verloren'));

-- 3. Automatisch projectnummer: JJ + volgnummer van 4 cijfers (bv. 260001)
create or replace function public.next_projectnummer()
returns text language plpgsql as $$
declare yy text; n int;
begin
  perform pg_advisory_xact_lock(424242);
  yy := to_char(current_date, 'YY');
  select coalesce(max(substring(nummer from 3)::int), 0) + 1 into n
    from public.projecten where nummer ~ '^[0-9]{6}$' and left(nummer, 2) = yy;
  return yy || lpad(n::text, 4, '0');
end $$;

create or replace function public.set_projectnummer()
returns trigger language plpgsql as $$
begin
  if new.nummer is null or new.nummer = '' then new.nummer := public.next_projectnummer(); end if;
  return new;
end $$;

drop trigger if exists projecten_nummer on public.projecten;
create trigger projecten_nummer before insert on public.projecten
  for each row execute function public.set_projectnummer();

-- 4. Bestaande projecten zonder nummer krijgen er een (oudste eerst)
do $$
declare r record;
begin
  for r in select id from public.projecten where nummer is null or nummer = '' order by created_at loop
    update public.projecten set nummer = public.next_projectnummer() where id = r.id;
  end loop;
end $$;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', '4'::jsonb), updated_at = now() where key = 'app';

-- Controle: nummers van de bestaande projecten
select nummer, klant, klanttype, status from public.projecten order by nummer;
