-- =====================================================================
--  BROS Planbord — databasescript 013: goedkeuringen (akkoord-knop in het klantenportaal)
--  - BROS legt een voorstel voor (de hele offerte of een meerwerkvoorstel); het Planbord bewaart een
--    bevroren kopie van de posten en bedragen in goedkeuringen.posten
--  - de klant keurt goed of weigert (met opmerking) via de functie goedkeuring_beslis(); bij akkoord
--    springen offerteposten naar status akkoord en krijgen alle posten akkoord_op + de goedkeuring-id
--  Alleen toevoegingen; mag opnieuw uitgevoerd worden.
-- =====================================================================

create table if not exists public.goedkeuringen (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projecten(id) on delete cascade,
  soort           text not null default 'offerte' check (soort in ('offerte','meerwerk')),
  titel           text not null default '',
  toelichting     text not null default '',                       -- boodschap van BROS aan de klant
  status          text not null default 'open' check (status in ('open','akkoord','geweigerd','ingetrokken')),
  posten          jsonb not null default '[]'::jsonb,             -- bevroren kopie: id, lot, code, omschrijving, locatie, hoeveelheid, eenheid, prijs, totaal, btw, status
  totaal_excl     numeric(12,2) not null default 0,
  btw             numeric(12,2) not null default 0,
  totaal_incl     numeric(12,2) not null default 0,
  voorgelegd_door uuid references public.profiles(id),
  voorgelegd_op   timestamptz not null default now(),
  geldig_tot      date,                                           -- uiterste datum om te beslissen (leeg = geen deadline)
  beslist_op      timestamptz,
  beslist_door    uuid,                                           -- auth-gebruiker van de klant
  beslist_naam    text not null default '',
  beslist_email   text not null default '',
  opmerking       text not null default '',                       -- reactie van de klant
  created_at      timestamptz not null default now()
);
create index if not exists goedkeuringen_project_idx on public.goedkeuringen(project_id, voorgelegd_op desc);
alter table public.goedkeuringen enable row level security;
drop policy if exists gk_intern on public.goedkeuringen;
create policy gk_intern on public.goedkeuringen for all to authenticated using (public.is_intern()) with check (public.is_intern());
drop policy if exists gk_klant on public.goedkeuringen;
create policy gk_klant on public.goedkeuringen for select to authenticated using (project_id in (select public.klant_projecten()));

alter table public.goedkeuringen add column if not exists geldig_tot date;
alter table public.meetstaat_posten
  add column if not exists akkoord_op timestamptz,
  add column if not exists akkoord_goedkeuring uuid references public.goedkeuringen(id) on delete set null;

-- ---------- beslissing van de klant (enkel via deze functie; controleert eigenaarschap en status) ----------
create or replace function public.goedkeuring_beslis(p_id uuid, p_akkoord boolean, p_naam text, p_opmerking text default '')
returns public.goedkeuringen language plpgsql security definer set search_path = public as $$
declare g public.goedkeuringen; r jsonb; v_email text;
begin
  select * into g from public.goedkeuringen where id = p_id;
  if g.id is null then raise exception 'Voorstel niet gevonden.'; end if;
  if not public.is_klant() or g.project_id not in (select public.klant_projecten()) then raise exception 'Geen toegang tot dit voorstel.'; end if;
  if g.status <> 'open' then raise exception 'Dit voorstel is al beslist.'; end if;
  if g.geldig_tot is not null and g.geldig_tot < current_date then raise exception 'De termijn voor dit voorstel is verstreken (tot %). Vraag BROS om het opnieuw voor te leggen.', to_char(g.geldig_tot, 'DD/MM/YYYY'); end if;
  select email into v_email from auth.users where id = auth.uid();
  update public.goedkeuringen
     set status = case when p_akkoord then 'akkoord' else 'geweigerd' end,
         beslist_op = now(), beslist_door = auth.uid(),
         beslist_naam = coalesce(nullif(trim(p_naam), ''), v_email, ''), beslist_email = coalesce(v_email, ''),
         opmerking = coalesce(p_opmerking, '')
   where id = p_id returning * into g;
  if p_akkoord then
    for r in select * from jsonb_array_elements(g.posten) loop
      update public.meetstaat_posten
         set akkoord_op = now(), akkoord_goedkeuring = g.id,
             status = case when status = 'offerte' then 'akkoord' else status end,
             updated_at = now()
       where id = (r->>'id')::uuid and project_id = g.project_id;
    end loop;
  end if;
  return g;
end $$;
grant execute on function public.goedkeuring_beslis(uuid, boolean, text, text) to authenticated;

-- ---------- views vernieuwen (nieuwe kolommen akkoord_op / akkoord_goedkeuring) ----------
drop view if exists public.meetstaat_posten_v;
create view public.meetstaat_posten_v as
  select m.*,
         case when public.is_beheer() then pr.eenheidsprijs end as eenheidsprijs,
         case when public.is_beheer() then pr.marge end as marge,
         coalesce(pr.eenheidsprijs, 0) * (1 + coalesce(pr.marge, l.marge, 0)) as verkoop_ep
  from public.meetstaat_posten m
  left join public.meetstaat_prijzen pr on pr.post_id = m.id
  join public.loten l on l.nr = m.lot
  where public.is_intern();

drop view if exists public.klant_meetstaat;
create view public.klant_meetstaat as
  select m.id, m.project_id, m.lot, m.code, m.groep, m.omschrijving, m.locatie, m.eenheid, m.prijstype, m.hoeveelheid,
         round(coalesce(pr.eenheidsprijs, 0) * (1 + coalesce(pr.marge, l.marge, 0)), 2) as prijs,
         round(m.hoeveelheid * coalesce(pr.eenheidsprijs, 0) * (1 + coalesce(pr.marge, l.marge, 0)), 2) as totaal,
         m.btw, m.status, m.volgorde, m.leverdatum, m.geleverd, m.akkoord_op
  from public.meetstaat_posten m
  left join public.meetstaat_prijzen pr on pr.post_id = m.id
  join public.loten l on l.nr = m.lot
  where m.project_id in (select public.klant_projecten());

drop view if exists public.klant_goedkeuringen;
create view public.klant_goedkeuringen as
  select g.id, g.project_id, g.soort, g.titel, g.toelichting, g.status, g.posten, g.totaal_excl, g.btw, g.totaal_incl,
         g.voorgelegd_op, g.geldig_tot, p.name as voorgelegd_door_naam, g.beslist_op, g.beslist_naam, g.opmerking
  from public.goedkeuringen g
  left join public.profiles p on p.id = g.voorgelegd_door
  where g.project_id in (select public.klant_projecten());

revoke all on public.meetstaat_posten_v, public.klant_meetstaat, public.klant_goedkeuringen from anon;
grant select on public.meetstaat_posten_v, public.klant_meetstaat, public.klant_goedkeuringen to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'goedkeuringen') then
    alter publication supabase_realtime add table public.goedkeuringen;
  end if;
end $$;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', '13'::jsonb), updated_at = now() where key = 'app';

-- Controle: moet 'goedkeuring_beslis' teruggeven
select proname from pg_proc where proname = 'goedkeuring_beslis';
