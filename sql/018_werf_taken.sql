-- =====================================================================
--  BROS Planbord — databasescript 018: vaststellingen ↔ taken
--  Een vaststelling die aan iemand toegewezen is (aannemer, bouwheer of teamlid) wordt automatisch
--  een taak op het project (taken.vaststelling_id) en staat zo in de takenlijst van die verantwoordelijke:
--  team → tabblad Taken, klant → "Jouw actiepunten" in het portaal, aannemer → later het aannemersportaal.
--  Status loopt in beide richtingen mee (open ↔ te doen, opgelost/gecontroleerd ↔ klaar).
--  Alleen toevoegingen; mag opnieuw uitgevoerd worden.
-- =====================================================================

alter table public.taken add column if not exists vaststelling_id uuid references public.vaststellingen(id) on delete cascade;
create index if not exists taken_vaststelling_idx on public.taken(vaststelling_id);

-- vaststelling → taak
create or replace function public.vaststelling_taak()
returns trigger language plpgsql security definer set search_path = public as $$
declare t_id uuid; t_status text; p_fase int; v_titel text;
begin
  if pg_trigger_depth() > 1 then return new; end if;
  select id into t_id from public.taken where vaststelling_id = new.id limit 1;
  v_titel := 'V-' || lpad(new.nr::text, 3, '0') || ' · ' || left(regexp_replace(coalesce(new.omschrijving, ''), '\s+', ' ', 'g'), 120);
  t_status := case when new.status in ('opgelost', 'gecontroleerd') then 'done' when new.status = 'vervallen' then 'done' else 'todo' end;
  if new.contact_id is null and new.assignee is null then
    -- niemand verantwoordelijk: een nog open gekoppelde taak weghalen, een afgewerkte laten staan
    if t_id is not null then delete from public.taken where id = t_id and status <> 'done'; end if;
    return new;
  end if;
  if t_id is null then
    select fase_nr into p_fase from public.projecten where id = new.project_id;
    insert into public.taken (project_id, titel, fase_nr, assignee, contact_id, status, start, eind, uren_gepland, notitie, volgorde, vaststelling_id)
    values (new.project_id, v_titel, p_fase, new.assignee, new.contact_id, t_status, null, new.deadline, 0, coalesce(new.ruimte, ''), 9500 + coalesce(new.nr, 0), new.id);
  else
    update public.taken set titel = v_titel, assignee = new.assignee, contact_id = new.contact_id, status = t_status, eind = new.deadline,
      notitie = coalesce(nullif(new.ruimte, ''), notitie), updated_at = now()
    where id = t_id;
  end if;
  return new;
end $$;
drop trigger if exists vaststellingen_taak on public.vaststellingen;
create trigger vaststellingen_taak after insert or update of omschrijving, ruimte, contact_id, assignee, deadline, status, nr on public.vaststellingen
  for each row execute function public.vaststelling_taak();

-- taak → vaststelling (klaar gezet in het Planbord of door de klant in het portaal)
create or replace function public.taak_vaststelling()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 or new.vaststelling_id is null or new.status = old.status then return new; end if;
  if new.status = 'done' then
    update public.vaststellingen set status = 'opgelost', opgelost_op = coalesce(opgelost_op, now()), opgelost_door = coalesce(opgelost_door, auth.uid()), updated_at = now()
      where id = new.vaststelling_id and status = 'open';
  elsif old.status = 'done' then
    update public.vaststellingen set status = 'open', opgelost_op = null, opgelost_door = null, updated_at = now()
      where id = new.vaststelling_id and status in ('opgelost', 'gecontroleerd');
  end if;
  return new;
end $$;
drop trigger if exists taken_vaststelling on public.taken;
create trigger taken_vaststelling after update of status on public.taken for each row execute function public.taak_vaststelling();

-- bestaande toegewezen vaststellingen: taak aanmaken
update public.vaststellingen v set status = v.status where (v.contact_id is not null or v.assignee is not null)
  and not exists (select 1 from public.taken t where t.vaststelling_id = v.id);

-- portaal: de klant ziet bij zijn actiepunt ook het nummer van de vaststelling
drop view if exists public.klant_taken;
create view public.klant_taken as
  select t.id, t.project_id, t.titel, t.eind, t.status, t.notitie_id, n.titel as notitie_titel, n.klant_zichtbaar as notitie_gedeeld, t.vaststelling_id, t.updated_at
  from public.taken t
  join public.contacten c on c.id = t.contact_id and c.user_id = auth.uid()
  left join public.notities n on n.id = t.notitie_id
  where t.project_id in (select public.klant_projecten());
revoke all on public.klant_taken from anon;
grant select on public.klant_taken to authenticated;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', '18'::jsonb), updated_at = now() where key = 'app';

-- Controle: moet 1 teruggeven
select count(*) from information_schema.columns where table_name = 'taken' and column_name = 'vaststelling_id';
