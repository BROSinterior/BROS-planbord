-- =====================================================================
--  BROS Planbord — databasescript 009: Contacten
--  Contacten (klanten, aannemers, leveranciers, architecten, …) en de koppeling
--  contact ↔ project met een rol. Bestaande projecten krijgen automatisch hun
--  bouwheer als contact. Alleen toevoegingen; mag opnieuw uitgevoerd worden.
-- =====================================================================
create table if not exists public.contacten (
  id          uuid primary key default gen_random_uuid(),
  soort       text not null default 'klant' check (soort in ('klant','aannemer','leverancier','architect','studiebureau','andere')),
  naam        text not null,                         -- weergavenaam: persoon of bedrijf
  bedrijf     text not null default '',
  contactpersoon text not null default '',           -- bij een bedrijf: wie
  klanttype   text not null default 'particulier' check (klanttype in ('particulier','zakelijk')),
  email       text not null default '',
  email2      text not null default '',
  gsm         text not null default '',
  tel         text not null default '',
  adres       text not null default '',
  postcode    text not null default '',
  gemeente    text not null default '',
  btw_nummer  text not null default '',
  vakgebied   text not null default '',              -- aannemer/leverancier: bv. "schrijnwerk, keukens"
  loten       int[] not null default '{}',           -- typische loten (meetstaat) voor aannemers/leveranciers
  notities    text not null default '',
  actief      boolean not null default true,
  user_id     uuid references public.profiles(id) on delete set null,   -- later: login voor klant-/aannemersportaal
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists contacten_soort_idx on public.contacten(soort, naam);

create table if not exists public.project_contacten (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projecten(id) on delete cascade,
  contact_id  uuid not null references public.contacten(id) on delete cascade,
  rol         text not null default 'bouwheer' check (rol in ('bouwheer','contactpersoon','aannemer','leverancier','architect','studiebureau','andere')),
  loten       int[] not null default '{}',           -- aannemer: welke loten van dit project
  intern      boolean not null default true,         -- true = niet zichtbaar voor de klant (portaal)
  notitie     text not null default '',
  created_at  timestamptz not null default now(),
  unique (project_id, contact_id, rol)
);
create index if not exists project_contacten_project_idx on public.project_contacten(project_id);
create index if not exists project_contacten_contact_idx on public.project_contacten(contact_id);

alter table public.contacten enable row level security;
alter table public.project_contacten enable row level security;
drop policy if exists contacten_all on public.contacten; create policy contacten_all on public.contacten for all to authenticated using (true) with check (true);
drop policy if exists pc_all on public.project_contacten; create policy pc_all on public.project_contacten for all to authenticated using (true) with check (true);

do $$
declare t text;
begin
  foreach t in array array['contacten','project_contacten'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------- Bestaande projecten: bouwheer als contact ----------
insert into public.contacten (soort, naam, bedrijf, contactpersoon, klanttype, email, email2, gsm, tel, adres, postcode, gemeente, btw_nummer)
select distinct on (lower(regexp_replace(p.klant, '\s+', ' ', 'g')))
  'klant', p.klant, coalesce(p.bedrijf, ''), coalesce(p.contact, ''), coalesce(p.klanttype, 'particulier'),
  coalesce(p.email1, ''), coalesce(p.email2, ''), coalesce(p.gsm1, ''), coalesce(p.gsm2, ''),
  coalesce(p.adres, ''), coalesce(p.postcode, ''), coalesce(p.gemeente, ''), coalesce(p.btw_nummer, '')
from public.projecten p
where coalesce(p.klant, '') <> ''
  and not exists (select 1 from public.contacten c where lower(regexp_replace(c.naam, '\s+', ' ', 'g')) = lower(regexp_replace(p.klant, '\s+', ' ', 'g')))
order by lower(regexp_replace(p.klant, '\s+', ' ', 'g')), (case when coalesce(p.email1, '') <> '' then 0 else 1 end), p.nummer desc nulls last;

insert into public.project_contacten (project_id, contact_id, rol, intern)
select p.id, c.id, 'bouwheer', false
from public.projecten p
join public.contacten c on c.soort = 'klant' and lower(regexp_replace(c.naam, '\s+', ' ', 'g')) = lower(regexp_replace(p.klant, '\s+', ' ', 'g'))
where not exists (select 1 from public.project_contacten pc where pc.project_id = p.id and pc.rol = 'bouwheer');

update public.instellingen set value = jsonb_set(value, '{versie_schema}', '9'::jsonb), updated_at = now() where key = 'app';
select (select count(*) from public.contacten) as contacten, (select count(*) from public.project_contacten) as koppelingen;
