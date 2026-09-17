-- =====================================================================
--  BROS Planbord — databasescript 019: titel per vaststelling
--  Korte titel per punt (bv. "Scharnier kastdeur") voor een snel overzicht; de omschrijving blijft de uitleg.
--  De automatisch aangemaakte taak heet voortaan "V-012 · <titel>" (zonder titel: begin van de omschrijving).
--  Alleen toevoegingen; mag opnieuw uitgevoerd worden (na script 018).
-- =====================================================================

alter table public.vaststellingen add column if not exists titel text not null default '';

create or replace function public.vaststelling_taak()
returns trigger language plpgsql security definer set search_path = public as $$
declare t_id uuid; t_status text; p_fase int; v_titel text;
begin
  if pg_trigger_depth() > 1 then return new; end if;
  select id into t_id from public.taken where vaststelling_id = new.id limit 1;
  v_titel := 'V-' || lpad(new.nr::text, 3, '0') || ' · ' || coalesce(nullif(trim(new.titel), ''), left(regexp_replace(coalesce(new.omschrijving, ''), '\s+', ' ', 'g'), 120));
  t_status := case when new.status in ('opgelost', 'gecontroleerd') then 'done' when new.status = 'vervallen' then 'done' else 'todo' end;
  if new.contact_id is null and new.assignee is null then
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
create trigger vaststellingen_taak after insert or update of titel, omschrijving, ruimte, contact_id, assignee, deadline, status, nr on public.vaststellingen
  for each row execute function public.vaststelling_taak();

update public.instellingen set value = jsonb_set(value, '{versie_schema}', '19'::jsonb), updated_at = now() where key = 'app';

-- Controle: moet 1 teruggeven
select count(*) from information_schema.columns where table_name = 'vaststellingen' and column_name = 'titel';
