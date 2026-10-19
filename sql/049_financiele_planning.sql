-- =====================================================================
--  BROS Planbord — databasescript 049: financiële planning (v1.52)
--  Enkel voor beheer (RLS). Basis voor een jaarplanning, een businessplan en een dossier voor de bank:
--  - fin_plan: per project de slaagkans (offertes), een budget en marge als er (nog) geen meetstaat is, het voorschot- en
--    slotpercentage en eventueel een eigen facturatieplan. Rijen zonder project_id zijn "geraamde projecten": verwachte
--    opdrachten die nog niet in het Planbord staan (met eigen naam, start en einde).
--  - fin_vaste_kosten: lonen, huur, wagens, verzekeringen … per maand, kwartaal of jaar.
--  - fin_instellingen: uitgangspunten (standaard voorschot/slot, betaaltermijnen, marge, kans, indexatie, scenario's).
--  Omzet, kostprijs en marge per post komen uit de meetstaat; gefactureerd uit de vorderingen; aankopen uit de
--  aannemersfacturen. Start en geplande einde van een echt project = projecten.start / projecten.eind.
--  Vereist schema 48. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 48 then
    raise exception 'Voer eerst de scripts tot en met 048 uit.';
  end if;
end $$;

-- ---------- 1. planning per project (en geraamde projecten) ----------
create table if not exists public.fin_plan (
  id uuid primary key default gen_random_uuid(),
  project_id uuid unique references public.projecten(id) on delete cascade,   -- leeg = geraamd project (nog niet in het Planbord)
  naam text not null default '',                  -- geraamd project: omschrijving (bv. "Renovatie appartement — via architect X")
  kans int check (kans is null or kans between 0 and 100),          -- slaagkans in % (offertes en geraamde projecten); leeg = standaard
  budget_excl numeric(12,2) check (budget_excl is null or abs(budget_excl) < 100000000),   -- omzet excl. btw als er (nog) geen meetstaat is
  marge_pct numeric(6,4) check (marge_pct is null or (marge_pct > -1 and marge_pct < 10)),  -- marge op kostprijs bij een budget (0,25 = 25 %)
  start date,                                      -- enkel voor geraamde projecten (echte projecten: projecten.start)
  eind date,                                       -- idem (projecten.eind)
  voorschot_pct numeric(6,4) check (voorschot_pct is null or (voorschot_pct >= 0 and voorschot_pct <= 1)),
  slot_pct numeric(6,4) check (slot_pct is null or (slot_pct >= 0 and slot_pct <= 1)),
  plan jsonb,                                      -- eigen facturatieplan [{ "datum": "2027-03-01", "pct": 0.3 }] (deel van wat nog te factureren is); leeg = automatisch
  opmerking text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fin_plan_plan check (plan is null or jsonb_typeof(plan) = 'array'),
  constraint fin_plan_geraamd check (project_id is not null or length(trim(naam)) > 0),
  constraint fin_plan_periode check (start is null or eind is null or eind >= start)
);
drop trigger if exists fin_plan_touch on public.fin_plan;
create trigger fin_plan_touch before update on public.fin_plan for each row execute function public.touch_updated_at();

-- ---------- 2. vaste kosten ----------
create table if not exists public.fin_vaste_kosten (
  id uuid primary key default gen_random_uuid(),
  categorie text not null default 'overig' check (categorie in ('lonen', 'huur', 'wagens', 'verzekeringen', 'software', 'marketing', 'administratie', 'financiering', 'overig')),
  omschrijving text not null default '',
  bedrag numeric(12,2) not null default 0 check (abs(bedrag) < 100000000),   -- per periode (excl. btw)
  frequentie text not null default 'maand' check (frequentie in ('maand', 'kwartaal', 'jaar')),
  vanaf date not null default (date_trunc('month', now()))::date,            -- eerste betaling (maand)
  tot date,                                                                  -- leeg = blijvend
  indexeren boolean not null default true,                                   -- jaarlijkse indexatie (uitgangspunten)
  volgorde int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fin_vaste_kosten_periode check (tot is null or tot >= vanaf)
);
drop trigger if exists fin_vaste_kosten_touch on public.fin_vaste_kosten;
create trigger fin_vaste_kosten_touch before update on public.fin_vaste_kosten for each row execute function public.touch_updated_at();

-- ---------- 3. uitgangspunten ----------
create table if not exists public.fin_instellingen (
  id int primary key default 1 check (id = 1),
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint fin_instellingen_value check (jsonb_typeof(value) = 'object')
);
insert into public.fin_instellingen (id, value) values (1, '{}'::jsonb) on conflict (id) do nothing;
drop trigger if exists fin_instellingen_touch on public.fin_instellingen;
create trigger fin_instellingen_touch before update on public.fin_instellingen for each row execute function public.touch_updated_at();

-- ---------- 4. rechten: enkel beheer ----------
do $$ declare t text; begin
  foreach t in array array['fin_plan', 'fin_vaste_kosten', 'fin_instellingen'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_beheer', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.is_beheer())) with check ((select public.is_beheer()))', t || '_beheer', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke truncate, references, trigger on public.%I from authenticated', t);
  end loop;
end $$;
revoke delete on public.fin_instellingen from authenticated;

-- ---------- 5. realtime ----------
do $$ declare t text; begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['fin_plan', 'fin_vaste_kosten', 'fin_instellingen'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------- rechten (zoals 048) ----------
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


update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(49, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: moet 3 | 3 | 1 teruggeven (3 tabellen, 3 met RLS, 1 rij uitgangspunten)
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('fin_plan', 'fin_vaste_kosten', 'fin_instellingen'))::int as tabellen,
       (select count(*) from pg_tables where schemaname = 'public' and tablename in ('fin_plan', 'fin_vaste_kosten', 'fin_instellingen') and rowsecurity)::int as rls,
       (select count(*) from public.fin_instellingen)::int as uitgangspunten;
