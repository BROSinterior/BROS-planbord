-- =====================================================================
--  BROS Planbord — databasescript 015: taken/actiepunten toewijzen aan de klant (of een ander contact)
--  - taken.contact_id: toegewezen aan een contact (bouwheer, aannemer, …) in plaats van een teamlid
--  - de klant ziet zijn eigen actiepunten in het portaal (ook zonder gedeeld verslag) en kan ze afvinken
--  Alleen toevoegingen; mag opnieuw uitgevoerd worden.
-- =====================================================================

alter table public.taken add column if not exists contact_id uuid references public.contacten(id) on delete set null;
create index if not exists taken_contact_idx on public.taken(contact_id);

-- actiepunten van de klant zelf (contact met zijn login), over al zijn projecten
create or replace view public.klant_taken as
  select t.id, t.project_id, t.titel, t.eind, t.status, t.notitie_id, n.titel as notitie_titel, n.klant_zichtbaar as notitie_gedeeld, t.updated_at
  from public.taken t
  join public.contacten c on c.id = t.contact_id and c.user_id = auth.uid()
  left join public.notities n on n.id = t.notitie_id
  where t.project_id in (select public.klant_projecten());

-- actiepunten bij gedeelde verslagen: nu ook met contactnaam en "voor mij"
drop view if exists public.klant_notitie_taken;
create view public.klant_notitie_taken as
  select t.id, t.notitie_id, t.project_id, t.titel, t.eind, t.status,
         coalesce(p.name, c.naam, '') as wie,
         (c.user_id is not null and c.user_id = auth.uid()) as voor_mij
  from public.taken t
  join public.notities n on n.id = t.notitie_id and n.klant_zichtbaar
  left join public.profiles p on p.id = t.assignee
  left join public.contacten c on c.id = t.contact_id
  where t.project_id in (select public.klant_projecten());

-- de klant vinkt zijn eigen actiepunt af (of weer open)
create or replace function public.klant_taak_klaar(p_id uuid, p_klaar boolean)
returns public.taken language plpgsql security definer set search_path = public as $$
declare t public.taken;
begin
  select * into t from public.taken where id = p_id;
  if t.id is null then raise exception 'Actiepunt niet gevonden.'; end if;
  if not public.is_klant() or t.contact_id is null or not exists (select 1 from public.contacten c where c.id = t.contact_id and c.user_id = auth.uid()) then
    raise exception 'Dit actiepunt is niet aan jou toegewezen.';
  end if;
  update public.taken set status = case when p_klaar then 'done' else 'todo' end, updated_at = now() where id = p_id returning * into t;
  return t;
end $$;
grant execute on function public.klant_taak_klaar(uuid, boolean) to authenticated;

revoke all on public.klant_taken, public.klant_notitie_taken from anon;
grant select on public.klant_taken, public.klant_notitie_taken to authenticated;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', '15'::jsonb), updated_at = now() where key = 'app';

-- Controle: moet 'klant_taak_klaar' teruggeven
select proname from pg_proc where proname = 'klant_taak_klaar';
