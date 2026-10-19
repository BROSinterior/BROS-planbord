-- =====================================================================
--  BROS Planbord — databasescript 048: opvolging van klantfacturen (betalingen uit Yuki en betalingsherinneringen) (v1.50)
--  - vorderingen: betaald_op, open_bedrag (volgens Yuki), herinneren (aan/uit per factuur), yuki_open_op (laatst gezien als
--    openstaand in Yuki), yuki_niet_open_sinds, yuki_gecheckt_op, opvolging_gemeld_op (na de tweede herinnering één keer gemeld).
--    Het Drive-script zet een verzonden factuur pas op 'betaald' als Yuki ze eerder als openstaand toonde en daarna op twee
--    verschillende dagen niet meer (en nooit als in één ronde opvallend veel facturen tegelijk zouden kantelen).
--  - Tabel betaalherinneringen: het Drive-script stelt elke ochtend herinneringen voor (3 en 7 dagen na de vervaldag);
--    BROS (beheer) keurt ze goed in het Planbord (tekst aanpasbaar) en pas dan vertrekken ze. Niets gaat zonder goedkeuring.
--  Vereist schema 47. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 47 then
    raise exception 'Voer eerst de scripts tot en met 047 uit.';
  end if;
end $$;

-- ---------- 1. vorderingen ----------
alter table public.vorderingen add column if not exists betaald_op date;
alter table public.vorderingen add column if not exists open_bedrag numeric(12,2);
alter table public.vorderingen add column if not exists herinneren boolean not null default true;
alter table public.vorderingen add column if not exists yuki_open_op timestamptz;
alter table public.vorderingen add column if not exists yuki_gecheckt_op timestamptz;
alter table public.vorderingen add column if not exists opvolging_gemeld_op timestamptz;
alter table public.vorderingen add column if not exists yuki_niet_open_sinds timestamptz;   -- eerste keer dat Yuki ze niet meer als openstaand toonde (betaald pas na een tweede bevestiging, een volgende dag)
create index if not exists vorderingen_open on public.vorderingen (vervaldag) where status = 'verzonden';

-- betaald gezet (in het Planbord of door het script) zonder datum → vandaag; terug naar verzonden → datum weg
create or replace function public.vordering_betaald_op()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'betaald' and new.betaald_op is null and (tg_op = 'INSERT' or old.status is distinct from 'betaald') then
    new.betaald_op := (now() at time zone 'Europe/Brussels')::date;
  end if;
  if new.status <> 'betaald' and tg_op = 'UPDATE' and old.status = 'betaald' then new.betaald_op := null; new.open_bedrag := null; new.yuki_niet_open_sinds := null; end if;
  if new.status = 'betaald' then new.open_bedrag := 0; end if;
  return new;
end $$;
drop trigger if exists vorderingen_betaald_op on public.vorderingen;
create trigger vorderingen_betaald_op before insert or update on public.vorderingen for each row execute function public.vordering_betaald_op();

-- ---------- 2. betalingsherinneringen ----------
create table if not exists public.betaalherinneringen (
  id uuid primary key default gen_random_uuid(),
  vordering_id uuid not null references public.vorderingen(id) on delete cascade,
  project_id uuid not null references public.projecten(id) on delete cascade,
  niveau int not null check (niveau in (1, 2)),
  status text not null default 'voorgesteld' check (status in ('voorgesteld', 'goedgekeurd', 'verstuurd', 'geannuleerd', 'mislukt')),
  aan text not null default '',                 -- e-mailadressen, gescheiden door komma's
  taal text not null default 'nl' check (taal in ('nl', 'en')),
  onderwerp text not null default '',
  tekst text not null default '',               -- aanpasbaar vóór goedkeuring; de mail krijgt er de betaalgegevens en de portaalknop bij
  dagen_te_laat int,
  open_bedrag numeric(12,2),
  voorgesteld_op timestamptz not null default now(),
  goedgekeurd_door uuid references public.profiles(id) on delete set null,
  goedgekeurd_op timestamptz,
  verstuurd_op timestamptz,
  fout text not null default '',
  updated_at timestamptz not null default now(),
  constraint betaalherinneringen_uniek unique (vordering_id, niveau)
);
create index if not exists betaalherinneringen_status on public.betaalherinneringen (status);
create index if not exists betaalherinneringen_project on public.betaalherinneringen (project_id);
alter table public.betaalherinneringen enable row level security;
drop policy if exists betaalherinneringen_beheer on public.betaalherinneringen;
create policy betaalherinneringen_beheer on public.betaalherinneringen for all to authenticated
  using ((select public.is_beheer())) with check ((select public.is_beheer()));
revoke all on public.betaalherinneringen from anon;
grant select, insert, update, delete on public.betaalherinneringen to authenticated;

-- goedkeuren: wie/wanneer; een verstuurde herinnering is vast (niet meer te wijzigen of terug te zetten)
create or replace function public.betaalherinnering_bewaken()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and old.status = 'verstuurd' and (new.status is distinct from old.status or new.tekst is distinct from old.tekst or new.aan is distinct from old.aan or new.onderwerp is distinct from old.onderwerp)
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Deze herinnering is al verstuurd.';
  end if;
  if new.status = 'goedgekeurd' and (tg_op = 'INSERT' or old.status is distinct from 'goedgekeurd') then
    new.goedgekeurd_op := now(); new.goedgekeurd_door := coalesce(auth.uid(), new.goedgekeurd_door);
    if coalesce(trim(new.aan), '') = '' then raise exception 'Vul minstens één e-mailadres in.'; end if;
  end if;
  return new;
end $$;
drop trigger if exists betaalherinneringen_bewaken on public.betaalherinneringen;
create trigger betaalherinneringen_bewaken before insert or update on public.betaalherinneringen for each row execute function public.betaalherinnering_bewaken();

-- ---------- 3. realtime ----------
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'betaalherinneringen') then
    alter publication supabase_realtime add table public.betaalherinneringen;
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
revoke all on function public.vordering_betaald_op() from public, anon, authenticated;
revoke all on function public.betaalherinnering_bewaken() from public, anon, authenticated;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(48, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: moet 7 | 1 teruggeven (7 nieuwe kolommen in vorderingen, tabel betaalherinneringen)
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'vorderingen'
          and column_name in ('betaald_op', 'open_bedrag', 'herinneren', 'yuki_open_op', 'yuki_niet_open_sinds', 'yuki_gecheckt_op', 'opvolging_gemeld_op'))::int as kolommen,
       (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'betaalherinneringen')::int as tabel;
