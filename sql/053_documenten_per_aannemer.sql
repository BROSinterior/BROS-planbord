-- =====================================================================
--  BROS Planbord — databasescript 053: documenten per aannemer delen (v1.56)
--  Vroeger zag elke aannemer van een project alle documenten die 'met aannemers' gedeeld waren. Nu deel je een document
--  bewust met één of meer gekozen aannemers; een aannemer ziet enkel wat met hém gedeeld is (en dus niet wie er nog werkt).
--  - document_aannemers: per document de aannemers (contacten) die het zien, met datum en of de melding al vertrok.
--  - documenten.gedeeld_aannemers blijft bestaan als samenvatting ('met minstens één aannemer gedeeld'); de databank houdt
--    het zelf bij. Rechtstreeks aanzetten kan niet meer (een oude, nog openstaande versie van het Planbord deelt zo met
--    niemand); uitzetten = met geen enkele aannemer meer delen.
--  - aan_documenten (aannemersportaal): enkel de documenten die met jouw contact gedeeld zijn.
--  - Bestaande deelacties blijven zoals ze waren: elk document dat nu met 'de aannemers' gedeeld is, wordt gedeeld met de
--    aannemers die vandaag aan dat project gekoppeld zijn (zonder nieuwe mail, tenzij die nog niet vertrokken was). Wie later gekoppeld wordt, ziet ze niet
--    vanzelf. Wordt een aannemer losgekoppeld van het project, dan vervallen zijn gedeelde documenten van dat project.
--  - Meldingsmail (Drive-script, nieuw drive/Code.gs): per aannemer enkel zijn eigen nieuwe documenten. Tot het nieuwe
--    script online staat, vertrekt er geen documentenmail naar aannemers (nooit één met de documenten van een ander).
--  Vereist schema 52. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 52 then
    raise exception 'Voer eerst de scripts tot en met 052 uit.';
  end if;
end $$;

create table if not exists public.document_aannemers (
  document_id  uuid not null references public.documenten(id) on delete cascade,
  contact_id   uuid not null references public.contacten(id) on delete cascade,
  gedeeld_op   timestamptz not null default now(),
  gedeeld_door uuid default auth.uid() references public.profiles(id) on delete set null,
  gemeld       boolean not null default false,     -- al opgenomen in een meldingsmail aan deze aannemer
  primary key (document_id, contact_id)
);
create index if not exists document_aannemers_contact_idx on public.document_aannemers(contact_id);
create index if not exists document_aannemers_gemeld_idx on public.document_aannemers(gemeld) where not gemeld;

-- enkel aannemers (geen bouwheer/contactpersoon) die aan het project van het document gekoppeld zijn
create or replace function public.document_aannemers_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.documenten d join public.project_contacten pc on pc.project_id = d.project_id
                 where d.id = new.document_id and pc.contact_id = new.contact_id and pc.rol not in ('bouwheer', 'contactpersoon')) then
    raise exception 'Deze aannemer is niet aan het project van dit document gekoppeld.';
  end if;
  return new;
end $$;
drop trigger if exists document_aannemers_check on public.document_aannemers;
create trigger document_aannemers_check before insert on public.document_aannemers for each row execute function public.document_aannemers_check();

-- samenvatting documenten.gedeeld_aannemers bijhouden
create or replace function public.document_aannemers_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_doc uuid := coalesce(case when tg_op = 'DELETE' then old.document_id else new.document_id end, old.document_id);
begin
  if coalesce(current_setting('bros.da_vast', true), '') = v_doc::text then return null; end if;   -- uitzetten via documenten zelf (hieronder)
  update public.documenten d set gedeeld_aannemers = exists (select 1 from public.document_aannemers x where x.document_id = v_doc),
         gedeeld_aannemers_op = case when tg_op = 'INSERT' then now() else d.gedeeld_aannemers_op end
   where d.id = v_doc and (d.gedeeld_aannemers is distinct from exists (select 1 from public.document_aannemers x where x.document_id = v_doc) or tg_op = 'INSERT');
  return null;
end $$;
drop trigger if exists document_aannemers_sync on public.document_aannemers;
create trigger document_aannemers_sync after insert or delete on public.document_aannemers for each row execute function public.document_aannemers_sync();

-- documenten: gedeeld_aannemers volgt de tabel; de oude melding per document (aan álle aannemers) staat voorgoed uit
create or replace function public.documenten_gedeeld()
returns trigger language plpgsql as $$
begin
  if new.gedeeld and not coalesce(old.gedeeld, false) then new.gedeeld_op := now(); new.gemeld_klant := false; end if;
  if not new.gedeeld then new.gemeld_klant := true; end if;
  new.gemeld_aannemers := true;   -- 1.56: meldingen aan aannemers lopen per aannemer via document_aannemers
  return new;
end $$;
create or replace function public.documenten_aannemers_vast()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- enkel een rechtstreekse wijziging door een gebruiker (niet de samenvatting hierboven)
  if tg_op = 'INSERT' then new.gedeeld_aannemers := false; return new; end if;   -- delen gebeurt enkel via document_aannemers
  if new.project_id is distinct from old.project_id then   -- ander project: de deelacties horen niet meer
    perform set_config('bros.da_vast', new.id::text, true);
    delete from public.document_aannemers where document_id = new.id;
    perform set_config('bros.da_vast', '', true);
    new.gedeeld_aannemers := false; return new;
  end if;
  if pg_trigger_depth() = 1 and new.gedeeld_aannemers is distinct from old.gedeeld_aannemers then
    if new.gedeeld_aannemers then
      -- een oude, nog openstaande versie van het Planbord: duidelijke fout (dan zet ze ook de Drive-link niet open)
      raise exception 'Vernieuw het Planbord (versie 1.56): kies voortaan per document met welke aannemers je het deelt.';
    else
      perform set_config('bros.da_vast', new.id::text, true);
      delete from public.document_aannemers where document_id = new.id;   -- uitzetten = met niemand meer delen
      perform set_config('bros.da_vast', '', true);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists documenten_aannemers_vast on public.documenten;
create trigger documenten_aannemers_vast before insert or update of gedeeld_aannemers, project_id on public.documenten for each row execute function public.documenten_aannemers_vast();

-- aannemer losgekoppeld van een project (of rol bouwheer/contactpersoon): zijn gedeelde documenten van dat project vervallen
create or replace function public.document_aannemers_ontkoppeld()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- na de wijziging: is dit contact nog als aannemer aan het (oude) project gekoppeld? zo niet, dan vervallen de deelacties
  if not exists (select 1 from public.project_contacten pc where pc.project_id = old.project_id and pc.contact_id = old.contact_id
                 and pc.rol not in ('bouwheer', 'contactpersoon')) then
    delete from public.document_aannemers x using public.documenten d
     where x.document_id = d.id and d.project_id = old.project_id and x.contact_id = old.contact_id;
  end if;
  return null;
end $$;
drop trigger if exists document_aannemers_ontkoppeld on public.project_contacten;
create trigger document_aannemers_ontkoppeld after update or delete on public.project_contacten for each row execute function public.document_aannemers_ontkoppeld();

alter table public.document_aannemers enable row level security;
drop policy if exists da_intern on public.document_aannemers;
create policy da_intern on public.document_aannemers for all to authenticated using ((select public.is_intern())) with check ((select public.is_intern()));

-- aannemersportaal: enkel wat met jouw contact gedeeld is
create or replace view public.aan_documenten as
  select d.id, d.project_id, d.naam, d.pad, d.url, d.mime, d.grootte, d.gewijzigd
  from public.documenten d
  where d.project_id in (select public.aannemer_projecten())
    and exists (select 1 from public.document_aannemers x where x.document_id = d.id and x.contact_id in (select public.mijn_contacten()));

-- bestaande deelacties behouden: met de aannemers die vandaag aan het project gekoppeld zijn (geen nieuwe mail)
insert into public.document_aannemers (document_id, contact_id, gedeeld_op, gedeeld_door, gemeld)
  select distinct on (d.id, pc.contact_id) d.id, pc.contact_id, coalesce(d.gedeeld_aannemers_op, now()), null, d.gemeld_aannemers   -- nog niet gemeld = de nieuwe mail per aannemer neemt het mee
  from public.documenten d
  join public.project_contacten pc on pc.project_id = d.project_id and pc.rol not in ('bouwheer', 'contactpersoon')
  where d.gedeeld_aannemers
    and not exists (select 1 from public.instellingen i where i.key = 'app' and coalesce((i.value->>'versie_schema')::int, 0) >= 53)
on conflict (document_id, contact_id) do nothing;
-- documenten die met 'de aannemers' gedeeld waren terwijl er nog geen aannemer gekoppeld was: met niemand gedeeld
update public.documenten d set gedeeld_aannemers = false
 where d.gedeeld_aannemers and not exists (select 1 from public.document_aannemers x where x.document_id = d.id);
update public.documenten d set gemeld_aannemers = true where not d.gemeld_aannemers;

-- realtime
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'document_aannemers') then
    alter publication supabase_realtime add table public.document_aannemers;
  end if;
end $$;

-- rechten
revoke all on public.document_aannemers from anon;
revoke truncate, references, trigger on public.document_aannemers from authenticated;
grant select, insert, update, delete on public.document_aannemers to authenticated;
revoke all on public.aan_documenten from anon;
grant select on public.aan_documenten to authenticated;
revoke all on function public.document_aannemers_check() from public, anon, authenticated;
revoke all on function public.document_aannemers_sync() from public, anon, authenticated;
revoke all on function public.documenten_aannemers_vast() from public, anon, authenticated;
revoke all on function public.document_aannemers_ontkoppeld() from public, anon, authenticated;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(53, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: tabel met RLS | aantal deelacties per aannemer | documenten met aannemers gedeeld | schemaversie.
-- De 2e kolom is 0 als er nog niets met aannemers gedeeld was.
select (select count(*) from pg_tables where schemaname = 'public' and tablename = 'document_aannemers' and rowsecurity)::int as tabel,
       (select count(*) from public.document_aannemers)::int as deelacties,
       (select count(*) from public.documenten where gedeeld_aannemers)::int as documenten,
       (select (value->>'versie_schema')::int from public.instellingen where key = 'app') as schema;
