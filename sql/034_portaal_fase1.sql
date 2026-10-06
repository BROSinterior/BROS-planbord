-- =====================================================================
--  BROS Planbord — databasescript 034: klantenportaal fase 1
--  1. Betalen: per factuur (vordering) de gestructureerde mededeling, de vervaldag en de factuur-pdf
--     (een gedeeld document). Rekeningnummer en begunstigde staan in Instellingen › Klantenportaal.
--  2. Live bijwerken: tabel portaal_pings — één rij per project, aangeraakt bij elke wijziging die de klant
--     ziet (facturen, meetstaat, verslagen, documenten, planning …). Het portaal luistert daarop (realtime)
--     en herlaadt dan zijn gegevens. De klant leest enkel de rijen van zijn eigen projecten.
--  3. Wekelijkse samenvatting: per contact aan/uit (contacten.weekmail), de klant zet ze zelf uit in het portaal.
--  Vereist schema 33. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 33 then
    raise exception 'Voer eerst de scripts tot en met 033 uit.';
  end if;
end $$;

-- ---------- 1. betalen ----------
alter table public.vorderingen add column if not exists mededeling text;            -- +++123/4567/89012+++
alter table public.vorderingen add column if not exists vervaldag date;
alter table public.vorderingen add column if not exists factuur_document uuid references public.documenten(id) on delete set null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'vorderingen_mededeling_check') then
    alter table public.vorderingen add constraint vorderingen_mededeling_check
      check (mededeling is null or mededeling ~ '^\+\+\+\d{3}/\d{4}/\d{5}\+\+\+$');
  end if;
end $$;

-- wat de klant ziet: dezelfde kolommen als script 033, met de betaalgegevens erbij
create or replace view public.klant_vorderingen as
  select v.id, v.project_id, v.nr, v.soort, v.omschrijving, v.datum, v.factuurnummer, v.bedrag_excl, v.status, v.btw_bedrag,
         v.mededeling, v.vervaldag, v.factuur_document
  from public.vorderingen v
  where v.status <> 'opgemaakt' and v.project_id in (select public.klant_projecten());

-- ---------- 2. live bijwerken ----------
-- bewust zonder foreign key: rijen worden nooit verwijderd (een DELETE-melding gaat via realtime naar iedereen)
create table if not exists public.portaal_pings (
  project_id   uuid primary key,
  gewijzigd_op timestamptz not null default now()
);
alter table public.portaal_pings drop constraint if exists portaal_pings_project_id_fkey;
alter table public.portaal_pings enable row level security;
drop policy if exists portaal_pings_lezen on public.portaal_pings;
create policy portaal_pings_lezen on public.portaal_pings for select to authenticated
  using (public.is_intern() or project_id in (select public.klant_projecten()) or project_id in (select public.aannemer_projecten()));
revoke all on public.portaal_pings from anon;
grant select on public.portaal_pings to authenticated;

-- trigger: de kolom met het project-id komt als argument mee (project_id, of id voor de tabel projecten).
-- Enkel wijzigingen die de klant kan zien (gedeelde documenten en verslagen, verstuurde facturen, klanttaken …),
-- en één schrijfactie per project per transactie (een bulkwijziging van 500 posten geeft één melding).
drop function if exists public.portaal_ping_project(uuid);
create or replace function public.portaal_ping()
returns trigger language plpgsql security definer set search_path = public as $$
declare j jsonb; o jsonb; p uuid; po uuid; zichtbaar boolean := true; pid uuid;
begin
  j := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  o := case when tg_op = 'UPDATE' then to_jsonb(old) else j end;
  zichtbaar := case tg_table_name
    when 'documenten'     then coalesce((j->>'gedeeld')::boolean, false) or coalesce((o->>'gedeeld')::boolean, false)
    when 'notities'       then coalesce((j->>'klant_zichtbaar')::boolean, false) or coalesce((o->>'klant_zichtbaar')::boolean, false)
    when 'werfverslagen'  then coalesce((j->>'klant_zichtbaar')::boolean, false) or coalesce((o->>'klant_zichtbaar')::boolean, false)
    when 'vaststellingen' then coalesce((j->>'klant_zichtbaar')::boolean, false) or coalesce((o->>'klant_zichtbaar')::boolean, false)
    when 'vorderingen'    then coalesce(j->>'status', '') <> 'opgemaakt' or coalesce(o->>'status', '') <> 'opgemaakt'
    when 'taken'          then (j->>'contact_id') is not null or (o->>'contact_id') is not null or coalesce((j->>'timing_klant')::boolean, false) or coalesce((o->>'timing_klant')::boolean, false)
                               or coalesce((j->>'uren_klant')::boolean, false) or coalesce((o->>'uren_klant')::boolean, false)
    else true end;
  if not zichtbaar then return null; end if;
  if tg_argv[0] = 'vordering' then
    select v.project_id into p from public.vorderingen v where v.id = (j->>'vordering_id')::uuid and v.status <> 'opgemaakt';
  else
    p := nullif(j->>tg_argv[0], '')::uuid; po := nullif(o->>tg_argv[0], '')::uuid;
  end if;
  foreach pid in array array[p, case when po is distinct from p then po end] loop
    if pid is not null and exists (select 1 from public.projecten where id = pid) then
      insert into public.portaal_pings (project_id, gewijzigd_op) values (pid, now())
      on conflict (project_id) do update set gewijzigd_op = now() where public.portaal_pings.gewijzigd_op < now();
    end if;
  end loop;
  return null;
end $$;

drop trigger if exists uren_portaal_ping on public.uren;   -- uren: enkel intern relevant, geen live-melding
do $$
declare t text; arg text;
begin
  foreach t in array array['vorderingen', 'meetstaat_posten', 'goedkeuringen', 'notities', 'documenten', 'werfverslagen', 'werfplannen',
                           'taken', 'klant_timing', 'vaststellingen', 'project_contacten', 'projecten', 'vordering_regels'] loop
    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = t) then
      arg := case t when 'projecten' then 'id' when 'vordering_regels' then 'vordering' else 'project_id' end;
      execute format('drop trigger if exists %I on public.%I', t || '_portaal_ping', t);
      execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.portaal_ping(%L)', t || '_portaal_ping', t, arg);
    end if;
  end loop;
end $$;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'portaal_pings') then
    alter publication supabase_realtime add table public.portaal_pings;
  end if;
end $$;

-- ---------- 3. wekelijkse samenvatting ----------
alter table public.contacten add column if not exists weekmail boolean not null default true;
alter table public.contacten add column if not exists weekmail_laatst timestamptz;

create or replace view public.klant_ik as
  select c.id, c.naam, c.bedrijf, c.email, c.gsm, c.portaal_login, pc.project_id, pc.rol, c.weekmail
  from public.contacten c join public.project_contacten pc on pc.contact_id = c.id
  where c.user_id = auth.uid();

-- de klant zet de weekmail zelf aan of uit (voor al zijn contactfiches)
create or replace function public.klant_weekmail(p_aan boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_klant() then raise exception 'Geen toegang.'; end if;
  update public.contacten set weekmail = coalesce(p_aan, true), updated_at = now() where user_id = auth.uid();
end $$;
revoke all on function public.klant_weekmail(boolean) from public, anon;
grant execute on function public.klant_weekmail(boolean) to authenticated;

-- ---------- rechten (views alleen-lezen, niets voor anon; zie script 031) ----------
select public.rechten_herstellen();
-- na rechten_herstellen (dat alle tabellen en functies opnieuw toekent): portaal_pings blijft alleen-lezen
revoke insert, update, delete, truncate, references, trigger on public.portaal_pings from authenticated, anon;
revoke all on function public.portaal_ping() from public, anon, authenticated;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(34, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: moet 3 teruggeven (betaalkolommen) en minstens 10 (live-triggers)
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'vorderingen' and column_name in ('mededeling', 'vervaldag', 'factuur_document'))::int as betaalkolommen,
       (select count(*) from pg_trigger where tgname like '%\_portaal\_ping')::int as live_triggers;
