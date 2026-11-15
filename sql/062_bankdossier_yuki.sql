-- =====================================================================
--  BROS Planbord — databasescript 062: bankdossier in het klantenportaal + Yuki-facturen opvolgen (v1.66)
--  1. Klantenportaal: de klant ziet ook wanneer een factuur betaald werd (klant_vorderingen.betaald_op) — voor het
--     bankdossier (verbouwlening) en de facturenlijst.
--  2. yuki_facturen: elke factuur die het Drive-script uit Yuki leest, komt hier terecht met het resultaat
--     (gekoppeld / niet gevonden / twijfel / verdacht). Wat niet automatisch gekoppeld raakte, verschijnt in het Planbord
--     onder Facturen › Yuki-koppeling, waar beheer ze manueel aan de juiste vordering koppelt (yuki_koppel).
--     De factuur-pdf van een niet-gekoppelde factuur wacht in Drive (map "_Yuki facturen te koppelen" in PROJECTEN) en
--     gaat bij het koppelen naar Documenten/Facturen van het project (Drive-script, actie yukipdf).
--  Enkel beheer ziet en wijzigt yuki_facturen. Vereist schema 61. Alleen toevoegingen; mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 61 then
    raise exception 'Voer eerst de scripts tot en met 061 uit.';
  end if;
end $$;

-- ---------- 1. klantenportaal: betaaldatum zichtbaar (nieuwe kolom achteraan, zelfde definitie als script 034 + 045) ----------
create or replace view public.klant_vorderingen as
  select v.id, v.project_id, v.nr, v.soort, v.omschrijving, v.datum, v.factuurnummer, v.bedrag_excl, v.status, v.btw_bedrag,
         v.mededeling, v.vervaldag, v.factuur_document,
         v.betaald_op
  from public.vorderingen v
  where v.status <> 'opgemaakt' and v.project_id in (select public.klant_projecten());

-- ---------- 2. Yuki-facturen ----------
create table if not exists public.yuki_facturen (
  id               uuid primary key default gen_random_uuid(),
  factuurnummer    text not null unique,
  datum            date,
  klant            text not null default '',
  onderwerp        text not null default '',
  totaal_incl      numeric(12,2),
  excl             numeric(12,2),
  btw              numeric(12,2),
  mededeling       text,
  vervaldag        date,
  projectnummers   text[] not null default '{}',
  resultaat        text not null default 'niet_gevonden' check (resultaat in ('gekoppeld', 'niet_gevonden', 'twijfel', 'verdacht')),
  reden            text not null default '',
  voorstel_project uuid references public.projecten(id) on delete set null,   -- project dat het script herkende (als hulp)
  vordering_id     uuid references public.vorderingen(id) on delete set null,
  pdf_drive_id     text,                                                   -- pdf in Drive (wachtmap of al in de projectmap)
  pdf_verdacht     text not null default '',                               -- reden waarom de pdf niet automatisch gedeeld werd
  mail_id          text,
  handmatig        boolean not null default false,
  genegeerd        boolean not null default false,                         -- bv. een creditnota of een factuur die niet bij een project hoort
  notitie          text not null default '',
  ontvangen_op     timestamptz not null default now(),
  gekoppeld_op     timestamptz,
  gekoppeld_door   uuid references public.profiles(id) on delete set null,
  updated_at       timestamptz not null default now()
);
create index if not exists yuki_facturen_open_idx on public.yuki_facturen(resultaat) where resultaat <> 'gekoppeld' and not genegeerd;
alter table public.yuki_facturen enable row level security;
drop policy if exists yuki_facturen_beheer_lezen on public.yuki_facturen;
create policy yuki_facturen_beheer_lezen on public.yuki_facturen for select to authenticated using ((select public.is_beheer()));
drop policy if exists yuki_facturen_beheer_wijzigen on public.yuki_facturen;
create policy yuki_facturen_beheer_wijzigen on public.yuki_facturen for update to authenticated using ((select public.is_beheer())) with check ((select public.is_beheer()));
revoke all on public.yuki_facturen from anon, authenticated;
grant select, update (genegeerd, notitie, updated_at) on public.yuki_facturen to authenticated;   -- koppelen enkel via yuki_koppel

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'yuki_facturen') then
    alter publication supabase_realtime add table public.yuki_facturen;
  end if;
end $$;

-- ---------- 3. manueel koppelen (enkel beheer) ----------
-- p_bedrag_excl: het excl.-bedrag van de factuur. Bij een Yuki-factuur met gekend excl.-bedrag wordt dat altijd gebruikt;
-- anders geeft het Planbord het bedrag mee (berekend uit de vordering, of afgeleid uit het totaal en de btw van de posten).
-- De btw wordt totaal − excl., zodat het te betalen bedrag (QR-code in het portaal) op de cent gelijk is aan de Yuki-factuur.
create or replace function public.yuki_koppel(p_yuki uuid, p_vordering uuid, p_bedrag_excl numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare y public.yuki_facturen; v public.vorderingen; v_excl numeric; v_patch_herinneren boolean;
begin
  if not public.is_beheer() then raise exception 'Enkel een beheerder kan facturen koppelen.'; end if;
  select * into y from public.yuki_facturen where id = p_yuki for update;
  if y.id is null then raise exception 'Yuki-factuur niet gevonden.'; end if;
  if y.resultaat = 'gekoppeld' and y.vordering_id is not null then raise exception 'Factuur % is al gekoppeld.', y.factuurnummer; end if;
  select * into v from public.vorderingen where id = p_vordering for update;
  if v.id is null then raise exception 'Vordering niet gevonden.'; end if;
  if coalesce(btrim(v.factuurnummer), '') <> '' and btrim(v.factuurnummer) <> y.factuurnummer then
    raise exception 'Deze vordering heeft al factuurnummer %.', v.factuurnummer;
  end if;
  if exists (select 1 from public.vorderingen x where btrim(x.factuurnummer) = y.factuurnummer and x.id <> v.id) then
    raise exception 'Factuurnummer % staat al bij een andere vordering.', y.factuurnummer;
  end if;
  if y.totaal_incl is null or y.totaal_incl = 0 then
    raise exception 'Van factuur % is geen totaalbedrag gekend. Kijk ze na in Yuki en vul het factuurnummer en bedrag zelf in bij de facturatie van het project.', y.factuurnummer;
  end if;
  v_excl := coalesce(y.excl, p_bedrag_excl);
  if v_excl is null then raise exception 'Het bedrag excl. btw ontbreekt.'; end if;
  if v_excl = 0 or sign(v_excl) <> sign(y.totaal_incl) or abs(v_excl) > abs(y.totaal_incl) + 0.01 then
    raise exception 'Bedrag excl. btw (%) past niet bij het totaal van de factuur (%).', v_excl, y.totaal_incl;
  end if;
  v_patch_herinneren := not coalesce(v.status <> 'betaald' and coalesce(y.vervaldag, v.vervaldag) < current_date, false);   -- oude factuur: geen automatische herinneringen
  update public.vorderingen
     set factuurnummer = y.factuurnummer,
         datum = coalesce(y.datum, v.datum),
         bedrag_excl = round(v_excl, 2),
         btw_bedrag = round(y.totaal_incl - v_excl, 2),
         status = case when v.status = 'betaald' then 'betaald' else 'verzonden' end,
         mededeling = coalesce(y.mededeling, v.mededeling),
         vervaldag = coalesce(v.vervaldag, y.vervaldag),
         herinneren = v.herinneren and v_patch_herinneren
   where id = v.id;
  -- btw apart nog eens zetten: de trigger vordering_bevriezen (script 033) herrekent de btw als het bedrag wijzigt en de btw toevallig gelijk blijft
  update public.vorderingen set btw_bedrag = round(y.totaal_incl - v_excl, 2) where id = v.id and btw_bedrag is distinct from round(y.totaal_incl - v_excl, 2);
  update public.yuki_facturen
     set resultaat = 'gekoppeld', vordering_id = v.id, handmatig = true, genegeerd = false,
         gekoppeld_op = now(), gekoppeld_door = auth.uid(), updated_at = now()
   where id = y.id;
  return jsonb_build_object('vordering', v.id, 'project', v.project_id, 'bedrag_excl', round(v_excl, 2), 'pdf', y.pdf_drive_id is not null, 'herinneren_uit', not v_patch_herinneren);
end $$;

-- rechten: bewust geen rechten_herstellen() (zie script 060)
do $$ begin
  revoke all on function public.yuki_koppel(uuid, uuid, numeric) from public, anon;
  grant execute on function public.yuki_koppel(uuid, uuid, numeric) to authenticated;
end $$;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(62, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: geeft 1 | 1 | 1 | 62 terug (betaaldatum in het portaal, tabel yuki_facturen, functie yuki_koppel, schemaversie)
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'klant_vorderingen' and column_name = 'betaald_op')::int as portaal,
       (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'yuki_facturen')::int as tabel,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'yuki_koppel')::int as functie,
       (select (value->>'versie_schema')::int from public.instellingen where key = 'app') as schema;
