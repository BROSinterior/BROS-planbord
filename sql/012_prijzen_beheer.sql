-- =====================================================================
--  BROS Planbord — databasescript 012: kostprijzen en marges alleen voor beheer
--  - kostprijs (eenheidsprijs) en marge van meetstaatposten verhuizen naar een aparte tabel
--    meetstaat_prijzen die alleen beheerders kunnen lezen
--  - iedereen van het team leest de meetstaat via de view meetstaat_posten_v: de verkoopprijs
--    (verkoop_ep) staat er berekend in; kostprijs en marge zijn leeg voor medewerkers
--  - loten (standaardmarge) en posten (richtprijzen) idem via loten_v en posten_v
--  - uurtarieven waren al alleen voor beheer (tabel tarieven)
--  Alleen toevoegingen/verplaatsingen; mag opnieuw uitgevoerd worden.
--  Let op: na dit script ook het nieuwe drive/Code.gs deployen (Yuki-koppeling leest de view).
-- =====================================================================

-- ---------- 1. Prijzentabel ----------
create table if not exists public.meetstaat_prijzen (
  post_id       uuid primary key references public.meetstaat_posten(id) on delete cascade,
  eenheidsprijs numeric(12,2) not null default 0,       -- kostprijs / aannemersprijs excl. btw
  marge         numeric(6,4),                            -- null = marge van het lot
  updated_at    timestamptz not null default now()
);
alter table public.meetstaat_prijzen enable row level security;
drop policy if exists mprijs_select on public.meetstaat_prijzen;
create policy mprijs_select on public.meetstaat_prijzen for select to authenticated using (public.is_beheer());
drop policy if exists mprijs_insert on public.meetstaat_prijzen;
create policy mprijs_insert on public.meetstaat_prijzen for insert to authenticated with check (public.is_intern());
drop policy if exists mprijs_update on public.meetstaat_prijzen;
create policy mprijs_update on public.meetstaat_prijzen for update to authenticated using (public.is_beheer()) with check (public.is_beheer());
drop policy if exists mprijs_delete on public.meetstaat_prijzen;
create policy mprijs_delete on public.meetstaat_prijzen for delete to authenticated using (public.is_beheer());

-- bestaande prijzen overzetten (enkel zolang de oude kolommen nog bestaan)
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'meetstaat_posten' and column_name = 'eenheidsprijs') then
    insert into public.meetstaat_prijzen (post_id, eenheidsprijs, marge)
      select id, coalesce(eenheidsprijs, 0), marge from public.meetstaat_posten
      on conflict (post_id) do nothing;
  end if;
end $$;

-- ---------- 2. Oude kolommen weg (views die ervan afhangen eerst) ----------
drop view if exists public.klant_meetstaat;
alter table public.meetstaat_posten drop column if exists eenheidsprijs;
alter table public.meetstaat_posten drop column if exists marge;

-- nieuwe post uit de bibliotheek krijgt automatisch de richtprijs als kostprijs (ook als een medewerker ze toevoegt)
create or replace function public.meetstaat_prijs_default()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.post_id is not null then
    insert into public.meetstaat_prijzen (post_id, eenheidsprijs)
    values (new.id, coalesce((select richtprijs from public.posten where id = new.post_id), 0))
    on conflict (post_id) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists meetstaat_posten_prijs on public.meetstaat_posten;
create trigger meetstaat_posten_prijs after insert on public.meetstaat_posten for each row execute function public.meetstaat_prijs_default();

-- ---------- 3. Loten en postenbibliotheek: marge en richtprijs alleen voor beheer ----------
drop policy if exists loten_select on public.loten;
create policy loten_select on public.loten for select to authenticated using (public.is_beheer());
drop policy if exists posten_select on public.posten;
create policy posten_select on public.posten for select to authenticated using (public.is_beheer());

create or replace view public.loten_v as
  select l.nr, l.naam, l.buildwise, l.standaard_aan, l.vakman, l.actief,
         case when public.is_beheer() then l.marge end as marge
  from public.loten l
  where public.is_intern() or public.is_klant();

create or replace view public.posten_v as
  select p.id, p.lot, p.code, p.buildwise, p.groep, p.omschrijving, p.eenheid, p.prijstype, p.btw, p.standaard_aan, p.per_ruimte, p.vakman, p.volgorde, p.actief, p.n,
         case when public.is_beheer() then p.richtprijs end as richtprijs,
         case when public.is_beheer() then p.prijs_min end as prijs_min,
         case when public.is_beheer() then p.prijs_max end as prijs_max,
         case when public.is_beheer() then p.marge end as marge
  from public.posten p
  where public.is_intern();

-- ---------- 4. De meetstaat voor het team: verkoopprijs berekend, kostprijs/marge alleen voor beheer ----------
create or replace view public.meetstaat_posten_v as
  select m.*,
         case when public.is_beheer() then pr.eenheidsprijs end as eenheidsprijs,
         case when public.is_beheer() then pr.marge end as marge,
         coalesce(pr.eenheidsprijs, 0) * (1 + coalesce(pr.marge, l.marge, 0)) as verkoop_ep
  from public.meetstaat_posten m
  left join public.meetstaat_prijzen pr on pr.post_id = m.id
  join public.loten l on l.nr = m.lot
  where public.is_intern();

-- klantportaal: dezelfde berekening, uit de nieuwe tabel
create or replace view public.klant_meetstaat as
  select m.id, m.project_id, m.lot, m.code, m.groep, m.omschrijving, m.locatie, m.eenheid, m.prijstype, m.hoeveelheid,
         round(coalesce(pr.eenheidsprijs, 0) * (1 + coalesce(pr.marge, l.marge, 0)), 2) as prijs,
         round(m.hoeveelheid * coalesce(pr.eenheidsprijs, 0) * (1 + coalesce(pr.marge, l.marge, 0)), 2) as totaal,
         m.btw, m.status, m.volgorde, m.leverdatum, m.geleverd
  from public.meetstaat_posten m
  left join public.meetstaat_prijzen pr on pr.post_id = m.id
  join public.loten l on l.nr = m.lot
  where m.project_id in (select public.klant_projecten());

revoke all on public.loten_v, public.posten_v, public.meetstaat_posten_v, public.klant_meetstaat from anon;
grant select on public.loten_v, public.posten_v, public.meetstaat_posten_v, public.klant_meetstaat to authenticated;

-- ---------- 5. Live-updates ----------
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'meetstaat_prijzen') then
    alter publication supabase_realtime add table public.meetstaat_prijzen;
  end if;
end $$;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', '12'::jsonb), updated_at = now() where key = 'app';

-- Controle: aantal posten en aantal prijsregels moeten gelijk zijn
select (select count(*) from public.meetstaat_posten) as posten, (select count(*) from public.meetstaat_prijzen) as prijzen;
