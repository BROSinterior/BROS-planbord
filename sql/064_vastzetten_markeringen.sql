-- =====================================================================
--  BROS Planbord — databasescript 064: vordering vastzetten voor Yuki + persoonlijke markeringen (v1.70)
--  1. vorderingen.vast_op / vast_door: een vordering op "Op te maken" kan "klaar voor Yuki" gezet worden. Het bedrag (excl. en btw)
--     ligt dan vast in bedrag_excl en btw_bedrag, ook als de meetstaat nadien wijzigt. Zo komt het bedrag dat je in Yuki typt
--     altijd exact overeen en koppelt het Drive-script de Yuki-factuur automatisch. "Losmaken" zet het terug.
--  2. mijn_markeringen: wat je in "Wacht op jou" op Gezien/Later zet en welke afspraken je als "niet gewerkt" wegklikt (Uren),
--     voortaan in de databank in plaats van in de browser — dus hetzelfde op laptop en gsm.
--  Vereist schema 63. Alleen toevoegingen; mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 63 then
    raise exception 'Voer eerst de scripts tot en met 063 uit.';
  end if;
end $$;

-- ---------- 1. vordering vastzetten ----------
alter table public.vorderingen add column if not exists vast_op timestamptz;
alter table public.vorderingen add column if not exists vast_door uuid references public.profiles(id) on delete set null;

-- vast kan enkel met een bedrag en btw, en enkel zolang de vordering op "Op te maken" staat (daarna is ze toch bevroren)
create or replace function public.vordering_vast_controle()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.status <> 'opgemaakt' then   -- verzonden of betaald: het bedrag is dan toch bevroren; "vast" heeft geen betekenis meer
    if new.vast_op is not null and (tg_op = 'INSERT' or old.vast_op is null) then raise exception 'Enkel een vordering die nog op te maken is, kan vastgezet worden.'; end if;
    new.vast_op := null; new.vast_door := null; return new;
  end if;
  if tg_op = 'UPDATE' and old.status <> 'opgemaakt' then new.vast_op := null; new.vast_door := null; return new; end if;   -- terug naar op te maken: niet meer vast
  if new.vast_op is not null and (tg_op = 'INSERT' or old.vast_op is null) then
    if new.bedrag_excl is null or new.btw_bedrag is null then raise exception 'Vastzetten kan enkel met een bedrag en btw.'; end if;
    new.vast_door := coalesce(new.vast_door, auth.uid());
  end if;
  if new.vast_op is null then new.vast_door := null; end if;
  -- vastgezet en nog op te maken: het bedrag ligt vast (een ander bedrag of btw = eerst losmaken)
  if tg_op = 'UPDATE' and old.vast_op is not null and new.vast_op is not null
     and (new.bedrag_excl is distinct from old.bedrag_excl or new.btw_bedrag is distinct from old.btw_bedrag) then
    raise exception 'Deze vordering staat klaar voor Yuki: maak ze eerst los om het bedrag te wijzigen.';
  end if;
  return new;
end $$;
drop trigger if exists vorderingen_vast on public.vorderingen;
create trigger vorderingen_vast before insert or update on public.vorderingen for each row execute function public.vordering_vast_controle();

-- percentages van een vastgezette vordering: niet meer wijzigen (enkel via losmaken)
create or replace function public.vordering_regel_vast()
returns trigger language plpgsql security invoker set search_path = public as $$
declare vid uuid := coalesce(new.vordering_id, old.vordering_id);
begin
  if current_user not in ('authenticated', 'anon') then return coalesce(new, old); end if;   -- functies en de verwerker: ongemoeid
  if exists (select 1 from public.vorderingen v where v.id = vid and v.vast_op is not null and v.status = 'opgemaakt') then
    raise exception 'Deze vordering staat klaar voor Yuki: maak ze eerst los om de percentages te wijzigen.';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists vordering_regels_vast on public.vordering_regels;
create trigger vordering_regels_vast before insert or update or delete on public.vordering_regels for each row execute function public.vordering_regel_vast();

-- ---------- 2. persoonlijke markeringen ----------
create table if not exists public.mijn_markeringen (
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  soort      text not null check (soort in ('wj', 'uw')),   -- wj = Wacht op jou (Gezien/Later), uw = Uren: afspraak "niet gewerkt"
  sleutel    text not null check (length(sleutel) between 1 and 200),
  stempel    text not null default '',                       -- wj: verandert de melding, dan komt ze terug
  tot        date,                                           -- wj "Later": tot deze dag verborgen
  updated_at timestamptz not null default now(),
  primary key (user_id, soort, sleutel)
);
alter table public.mijn_markeringen enable row level security;
drop policy if exists mm_lezen on public.mijn_markeringen;
drop policy if exists mm_schrijven on public.mijn_markeringen;
-- lezen: je eigen markeringen; "niet gewerkt" ook van collega's (teamoverzicht van de uren)
create policy mm_lezen on public.mijn_markeringen for select to authenticated using (user_id = auth.uid() or (soort = 'uw' and (select public.is_intern())));
-- schrijven: enkel je eigen (beheer ook "niet gewerkt" voor een ander, zoals bij de uren)
create policy mm_schrijven on public.mijn_markeringen for all to authenticated
  using ((select public.is_intern()) and (user_id = auth.uid() or (soort = 'uw' and (select public.is_beheer()))))
  with check ((select public.is_intern()) and (user_id = auth.uid() or (soort = 'uw' and (select public.is_beheer()))));
revoke all on public.mijn_markeringen from anon;
grant select, insert, update, delete on public.mijn_markeringen to authenticated;
-- opruimen: markeringen ouder dan een jaar zijn betekenisloos
delete from public.mijn_markeringen where updated_at < now() - interval '1 year';

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'mijn_markeringen') then
    alter publication supabase_realtime add table public.mijn_markeringen;
  end if;
end $$;

-- rechten: bewust geen rechten_herstellen() (zie script 060)
do $$ begin
  revoke all on function public.vordering_vast_controle(), public.vordering_regel_vast() from public, anon;
end $$;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(64, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: geeft 2 | 1 | 2 | 64 terug (kolommen vast_op/vast_door, tabel mijn_markeringen, triggers, schemaversie)
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'vorderingen' and column_name in ('vast_op', 'vast_door'))::int as kolommen,
       (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'mijn_markeringen')::int as tabel,
       (select count(*) from pg_trigger where tgname in ('vorderingen_vast', 'vordering_regels_vast'))::int as triggers,
       (select (value->>'versie_schema')::int from public.instellingen where key = 'app') as schema;
