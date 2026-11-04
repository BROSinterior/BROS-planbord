-- =====================================================================
--  BROS Planbord — databasescript 059: to-do's per verantwoordelijke, ontwerptraject met klantenfeedback en Budgetkompas (v1.63)
--
--  1. To-do's: de actiepunten van een notitie of vergadering worden per verantwoordelijke één taak ("To do's · <verslag>")
--     met de punten als checklist (taak_punten). Alle punten af = taak klaar (en omgekeerd: taak afvinken = alle punten af).
--     Een punt kan losgemaakt worden tot een aparte taak. Een vergadering kan een notitie (verslag) worden.
--     Klant en aannemer vinken hun eigen punten af in het portaal.
--  2. Ontwerptraject: per ontwerpgesprek een ronde (V1, V2, …) met een verslag, vaste documenten (opslag 'ontwerp'),
--     open vragen en een feedbacktermijn. Gepubliceerd = zichtbaar in het klantenportaal, los van het dossier.
--     De klant geeft feedback op een plek in een beeld of pagina, beantwoordt de vragen, verstuurt en bevestigt de ronde.
--     BROS antwoordt per punt (aangepast / niet mogelijk / afspraak / genoteerd); de feedback wordt één to-do voor de projectlead.
--  3. Budgetkompas (exclusief btw): richtbudget (en budgetgrens) per project; na een goedgekeurde offerte telt die als basis.
--     Vastgelegd: goedgekeurde meer-/minwerkvoorstellen, gemaakte keuzes en ontwerpbeslissingen met akkoord.
--     Open: indicatieve impact van feedback en ontwerpwijzigingen (vork), open keuzes en open voorstellen — "wat als".
--     Niets wijzigt vanzelf de meetstaat: bindend wordt het enkel via de bestaande keuzes en de akkoord-knop.
--  Vereist schema 58. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 58 then
    raise exception 'Voer eerst de scripts tot en met 058 uit.';
  end if;
end $$;

-- =====================================================================
-- 1. TO-DO'S PER VERANTWOORDELIJKE
-- =====================================================================
alter table public.taken add column if not exists bundel boolean not null default false;     -- één taak met de punten als checklist
alter table public.notities add column if not exists vergadering_id uuid references public.vergaderingen(id) on delete set null;
create unique index if not exists notities_vergadering_uq on public.notities(vergadering_id) where vergadering_id is not null;

create table if not exists public.taak_punten (
  id                uuid primary key default gen_random_uuid(),
  taak_id           uuid not null references public.taken(id) on delete cascade,
  tekst             text not null check (length(btrim(tekst)) between 1 and 1000),
  klaar             boolean not null default false,
  klaar_op          timestamptz,
  klaar_door        uuid references public.profiles(id) on delete set null,
  deadline          date,
  volgorde          int not null default 0,
  notitie_id        uuid references public.notities(id) on delete set null,
  vergader_punt_id  uuid references public.vergadering_punten(id) on delete set null,
  ontwerp_feedback_id uuid,                                            -- (koppeling hieronder, na de tabel ontwerp_feedback)
  bron_sec          numeric(10,2),
  los_taak_id       uuid references public.taken(id) on delete set null, -- losgemaakt tot een aparte taak
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists taak_punten_taak_idx on public.taak_punten(taak_id, volgorde);
create unique index if not exists taak_punten_vpunt_uq on public.taak_punten(vergader_punt_id) where vergader_punt_id is not null;
alter table public.taak_punten enable row level security;
drop policy if exists taak_punten_intern on public.taak_punten;
create policy taak_punten_intern on public.taak_punten for all to authenticated using (public.is_intern()) with check (public.is_intern());
grant select, insert, update, delete on public.taak_punten to authenticated;

-- de koppeling van een vergaderpunt mag nu ook 'bundel' zijn (punt in een to-dotaak)
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.vergadering_punten'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%taak_koppeling%' loop
    execute format('alter table public.vergadering_punten drop constraint %I', c);
  end loop;
  alter table public.vergadering_punten add constraint vergadering_punten_taak_koppeling_check check (taak_koppeling in ('nieuw', 'bestaand', 'bundel'));
end $$;

-- klaar_op / klaar_door en updated_at; een punt kan niet van taak wisselen
create or replace function public.td_punt_voor()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.tekst := btrim(new.tekst); new.created_by := coalesce(new.created_by, auth.uid());
    if new.klaar then new.klaar_op := now(); new.klaar_door := auth.uid(); end if;
    if not exists (select 1 from public.taken where id = new.taak_id and bundel) then raise exception 'Punten horen enkel bij een to-dotaak.'; end if;
    return new;
  end if;
  if new.taak_id is distinct from old.taak_id then raise exception 'Een punt kan niet naar een andere taak verhuizen.'; end if;
  if new.klaar is distinct from old.klaar then
    new.klaar_op := case when new.klaar then now() end; new.klaar_door := case when new.klaar then auth.uid() end;
  else new.klaar_op := old.klaar_op; new.klaar_door := old.klaar_door; end if;
  new.tekst := btrim(new.tekst); new.updated_at := now();
  return new;
end $$;
drop trigger if exists td_punt_voor on public.taak_punten;
create trigger td_punt_voor before insert or update on public.taak_punten for each row execute function public.td_punt_voor();

-- de taak volgt haar punten: alles af → klaar; deels af → bezig; terug open → te doen; einddatum = vroegste open deadline
create or replace function public.td_herreken(p_taak uuid)
returns void language plpgsql security definer set search_path = public as $$
declare n_tot int; n_open int; d_open date; d_max date; t public.taken; st text; e date;
begin
  select * into t from public.taken where id = p_taak for update;   -- twee mensen die tegelijk de laatste punten afvinken: na elkaar tellen
  if t.id is null or not t.bundel then return; end if;
  select count(*), count(*) filter (where not klaar), min(deadline) filter (where not klaar and deadline is not null), max(deadline) filter (where deadline is not null)
    into n_tot, n_open, d_open, d_max
    from public.taak_punten where taak_id = p_taak and los_taak_id is null;
  st := case when n_tot = 0 then t.status when n_open = 0 then 'done' when n_open = n_tot then case when t.status = 'done' then 'todo' else t.status end else 'busy' end;
  e := coalesce(d_open, d_max, t.eind);
  update public.taken set status = st, eind = e, start = case when t.start is not null and e is not null and t.start > e then e else t.start end, updated_at = now()
   where id = p_taak and (status is distinct from st or eind is distinct from e);
end $$;
create or replace function public.td_punt_na()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.td_herreken(coalesce(new.taak_id, old.taak_id));
  return null;
end $$;
drop trigger if exists td_punt_na on public.taak_punten;
create trigger td_punt_na after insert or update or delete on public.taak_punten for each row execute function public.td_punt_na();

-- de to-dotaak zelf afvinken (in een takenlijst) = alle open punten afvinken
create or replace function public.td_taak_klaar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() = 1 and new.bundel and new.status = 'done' and old.status is distinct from 'done' then
    update public.taak_punten set klaar = true where taak_id = new.id and not klaar and los_taak_id is null;
  elsif pg_trigger_depth() = 1 and new.bundel and old.status = 'done' and new.status <> 'done'
        and not exists (select 1 from public.taak_punten where taak_id = new.id and not klaar and los_taak_id is null) then
    -- de taak terug open zetten (bv. in een takenlijst of op het bord): het laatst afgevinkte punt gaat weer open, zodat taak en checklist kloppen
    update public.taak_punten set klaar = false
     where id = (select id from public.taak_punten where taak_id = new.id and los_taak_id is null order by klaar_op desc nulls last, volgorde desc limit 1);
  end if;
  return null;
end $$;
drop trigger if exists td_taak_klaar on public.taken;
create trigger td_taak_klaar after update of status on public.taken for each row execute function public.td_taak_klaar();

-- een to-dotaak voor (bron, verantwoordelijke) zoeken of maken — enkel voor de functies hieronder
create or replace function public.td_bundel(p_project uuid, p_notitie uuid, p_vergadering uuid, p_ronde uuid, p_assignee uuid, p_contact uuid, p_bron text)
returns uuid language plpgsql security definer set search_path = public as $$
declare t_id uuid; fase int;
begin
  -- enkel via de functies van dit script (die zetten bros.td) of door het team
  if not public.is_intern() and coalesce(current_setting('bros.td', true), '') <> '1' then raise exception 'Geen toegang.'; end if;
  perform pg_advisory_xact_lock(hashtext('td:' || p_project::text || ':' || coalesce(p_vergadering::text, p_ronde::text, p_notitie::text, '') || ':' || coalesce(p_assignee::text, '') || ':' || coalesce(p_contact::text, '')));
  select id into t_id from public.taken t
   where t.bundel and t.project_id = p_project
     and case when p_vergadering is not null then t.vergadering_id = p_vergadering
              when p_ronde is not null then t.ontwerp_ronde_id = p_ronde
              else t.notitie_id = p_notitie and t.vergadering_id is null and t.ontwerp_ronde_id is null end
     and t.assignee is not distinct from p_assignee and t.contact_id is not distinct from p_contact
   order by t.created_at limit 1;
  if t_id is not null then return t_id; end if;
  select fase_nr into fase from public.projecten where id = p_project;
  insert into public.taken (project_id, titel, assignee, contact_id, status, bundel, notitie_id, vergadering_id, ontwerp_ronde_id, fase_nr, uren_gepland, volgorde, notitie)
  values (p_project, left('To do''s · ' || coalesce(nullif(btrim(p_bron), ''), 'verslag'), 300), p_assignee, p_contact, 'todo', true,
          p_notitie, p_vergadering, p_ronde, fase, 0, 9000, 'Verzamelde punten — vink ze af in de checklist.')
  returning id into t_id;
  return t_id;
end $$;

-- punten toevoegen (notitie, vergadering of los), gegroepeerd per verantwoordelijke (teamlid of contact; geen = nog te bepalen)
create or replace function public.todo_toevoegen(p_project uuid, p_notitie uuid, p_vergadering uuid, p_punten jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x jsonb; a uuid; c uuid; d date; t_id uuid; n int := 0; v_taken uuid[] := '{}'; bron text; v_vg uuid := p_vergadering; nt public.notities; vg public.vergaderingen; vol int;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  if not exists (select 1 from public.projecten where id = p_project) then raise exception 'Project niet gevonden.'; end if;
  if p_notitie is not null then
    select * into nt from public.notities where id = p_notitie;
    if nt.id is null or nt.project_id <> p_project then raise exception 'Deze notitie hoort niet bij dit project.'; end if;
    v_vg := coalesce(v_vg, nt.vergadering_id);
  end if;
  if v_vg is not null then
    select * into vg from public.vergaderingen where id = v_vg;
    if vg.id is null or vg.project_id <> p_project then raise exception 'Deze vergadering hoort niet bij dit project.'; end if;
    if not public.vg_toegang(vg.id) then raise exception 'Geen toegang tot deze vergadering.'; end if;
  end if;
  bron := coalesce(nullif(btrim(nt.titel), ''), nullif(btrim(vg.onderwerp), ''), 'verslag ' || to_char(coalesce(nt.datum, vg.datum, current_date), 'DD/MM/YYYY'));
  if jsonb_typeof(p_punten) <> 'array' or jsonb_array_length(p_punten) = 0 then raise exception 'Geen punten.'; end if;
  perform set_config('bros.td', '1', true);
  if jsonb_array_length(p_punten) > 200 then raise exception 'Te veel punten in één keer (max. 200).'; end if;
  for x in select * from jsonb_array_elements(p_punten) loop
    if length(btrim(coalesce(x->>'tekst', ''))) = 0 then continue; end if;
    a := nullif(x->>'assignee', '')::uuid; c := nullif(x->>'contact_id', '')::uuid; d := nullif(x->>'deadline', '')::date;
    if a is not null and c is not null then raise exception 'Een punt heeft één verantwoordelijke: een teamlid of een contact.'; end if;
    if a is not null and not exists (select 1 from public.profiles where id = a and active and role in ('beheer', 'medewerker')) then raise exception 'Kies een actief teamlid als verantwoordelijke.'; end if;
    if c is not null and not exists (select 1 from public.project_contacten where project_id = p_project and contact_id = c) then raise exception 'Dit contact is niet aan het project gekoppeld.'; end if;
    t_id := public.td_bundel(p_project, case when v_vg is null then p_notitie end, v_vg, null, a, c, bron);
    if p_notitie is not null then update public.taken set notitie_id = p_notitie where id = t_id and notitie_id is null; end if;
    select coalesce(max(volgorde), 0) + 1 into vol from public.taak_punten where taak_id = t_id;
    insert into public.taak_punten (taak_id, tekst, deadline, volgorde, notitie_id, created_by)
    values (t_id, left(btrim(x->>'tekst'), 1000), d, vol, p_notitie, auth.uid());
    n := n + 1; if not t_id = any(v_taken) then v_taken := v_taken || t_id; end if;
  end loop;
  return jsonb_build_object('punten', n, 'taken', to_jsonb(v_taken));
end $$;

-- een vergaderpunt wordt een punt in de to-dotaak van zijn verantwoordelijke (i.p.v. een aparte taak)
create or replace function public.vergadering_punt_todo(p_punt uuid, p_titel text, p_assignee uuid default null, p_eind date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pt public.vergadering_punten; v public.vergaderingen; t_id uuid; ander uuid; orig jsonb; gewijzigd boolean; nid uuid; vol int;
begin
  select * into pt from public.vergadering_punten where id = p_punt for update;
  if pt.id is null then raise exception 'Punt niet gevonden.'; end if;
  if not public.vg_toegang(pt.vergadering_id) then raise exception 'Geen toegang tot deze vergadering.'; end if;
  select * into v from public.vergaderingen where id = pt.vergadering_id;
  if v.status = 'gecontroleerd' then raise exception 'Dit verslag is gecontroleerd. Heropen het eerst.'; end if;
  if pt.soort not in ('actie', 'vraag', 'meerwerk', 'beslissing') then raise exception 'Van dit punt kan geen to-do gemaakt worden.'; end if;
  if pt.verborgen then raise exception 'Dit punt werd vervangen door een latere verwerking.'; end if;
  if pt.taak_id is not null then return jsonb_build_object('taak_id', pt.taak_id, 'al', true); end if;
  if pt.sleutel <> '' then   -- hetzelfde punt (bv. na opnieuw verwerken) staat al in een taak → niet dubbel
    select taak_id into ander from public.vergadering_punten where vergadering_id = pt.vergadering_id and id <> pt.id and sleutel = pt.sleutel and taak_id is not null limit 1;
    if ander is not null then
      update public.vergadering_punten set taak_id = ander, taak_koppeling = 'bestaand', beoordeeld_door = auth.uid(), beoordeeld_op = now(),
             status = case when status = 'gecorrigeerd' then 'gecorrigeerd' else 'bevestigd' end where id = pt.id;
      return jsonb_build_object('taak_id', ander, 'al', true);
    end if;
  end if;
  if length(btrim(coalesce(p_titel, ''))) < 2 then raise exception 'Geef het punt een omschrijving.'; end if;
  if p_assignee is not null and not exists (select 1 from public.profiles where id = p_assignee and active and role in ('beheer', 'medewerker')) then raise exception 'Kies een teamlid als verantwoordelijke (of laat leeg).'; end if;
  perform set_config('bros.td', '1', true);
  t_id := public.td_bundel(v.project_id, null, v.id, null, p_assignee, null, v.onderwerp);
  select id into nid from public.notities where vergadering_id = v.id;
  if nid is not null then update public.taken set notitie_id = nid where id = t_id and notitie_id is null; end if;
  select coalesce(max(volgorde), 0) + 1 into vol from public.taak_punten where taak_id = t_id;
  insert into public.taak_punten (taak_id, tekst, deadline, volgorde, notitie_id, vergader_punt_id, bron_sec, created_by)
  values (t_id, left(btrim(p_titel), 1000), p_eind, vol, nid, pt.id, pt.bron_start, auth.uid());
  orig := pt.origineel;
  gewijzigd := btrim(p_titel) is distinct from coalesce(orig->>'tekst', pt.tekst) or p_assignee is distinct from nullif(orig->>'verantwoordelijke', '')::uuid or p_eind is distinct from nullif(orig->>'deadline', '')::date;
  update public.vergadering_punten
     set taak_id = t_id, taak_koppeling = 'bundel', tekst = left(btrim(p_titel), 300), verantwoordelijke = p_assignee, deadline = p_eind,
         status = case when gewijzigd or status = 'gecorrigeerd' then 'gecorrigeerd' else 'bevestigd' end, beoordeeld_door = auth.uid(), beoordeeld_op = now()
   where id = pt.id;
  return jsonb_build_object('taak_id', t_id, 'al', false, 'bundel', true);
end $$;

-- een punt losmaken tot een aparte taak (bv. een groot werk)
create or replace function public.todo_punt_los(p_punt uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare tp public.taak_punten; t public.taken; n_id uuid;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  select * into tp from public.taak_punten where id = p_punt for update;
  if tp.id is null then raise exception 'Punt niet gevonden.'; end if;
  if tp.los_taak_id is not null then return jsonb_build_object('taak_id', tp.los_taak_id, 'al', true); end if;
  select * into t from public.taken where id = tp.taak_id;
  if t.vergadering_id is not null and not public.vg_toegang(t.vergadering_id) then raise exception 'Geen toegang tot deze vergadering.'; end if;
  insert into public.taken (project_id, titel, assignee, contact_id, status, eind, fase_nr, uren_gepland, volgorde, notitie_id, vergadering_id, vergader_punt_id, bron_sec, ontwerp_ronde_id, notitie)
  values (t.project_id, left(tp.tekst, 300), t.assignee, t.contact_id, case when tp.klaar then 'done' else 'todo' end, tp.deadline, t.fase_nr, 0, 9001,
          coalesce(tp.notitie_id, t.notitie_id), t.vergadering_id, tp.vergader_punt_id, tp.bron_sec, t.ontwerp_ronde_id, 'Losgemaakt uit "' || t.titel || '"')
  returning id into n_id;
  update public.taak_punten set los_taak_id = n_id where id = tp.id;
  if tp.vergader_punt_id is not null then update public.vergadering_punten set taak_id = n_id, taak_koppeling = 'nieuw' where id = tp.vergader_punt_id; end if;
  return jsonb_build_object('taak_id', n_id, 'al', false);
end $$;

-- een vergadering → één notitie (verslag) in Notities; de to-dotaken van de vergadering hangen er meteen aan
create or replace function public.vergadering_notitie(p_vergadering uuid, p_titel text, p_inhoud text, p_deelnemers text default '')
returns public.notities language plpgsql security definer set search_path = public as $$
declare v public.vergaderingen; n public.notities; vr uuid[]; cr uuid[];
begin
  select * into v from public.vergaderingen where id = p_vergadering;
  if v.id is null or not public.vg_toegang(v.id) then raise exception 'Geen toegang tot deze vergadering.'; end if;
  select * into n from public.notities where vergadering_id = v.id;
  if n.id is null and v.opname is not null and v.status <> 'gecontroleerd' then raise exception 'Rond eerst de controle van het verslag af: in Notities komt enkel wat iemand bevestigde.'; end if;
  if n.id is null then
    select coalesce(array_agg(distinct assignee) filter (where assignee is not null), '{}'), coalesce(array_agg(distinct contact_id) filter (where contact_id is not null), '{}')
      into vr, cr from public.taken where vergadering_id = v.id;
    insert into public.notities (project_id, soort, titel, datum, deelnemers, inhoud, verantwoordelijken, contact_ids, klant_zichtbaar, auteur, vergadering_id)
    values (v.project_id, 'vergadering', left(coalesce(nullif(btrim(p_titel), ''), v.onderwerp, 'Vergadering'), 300), coalesce(v.datum, current_date), left(coalesce(p_deelnemers, ''), 2000),
            left(coalesce(p_inhoud, ''), 100000), vr, cr, false, auth.uid(), v.id)
    returning * into n;
  end if;
  update public.taken set notitie_id = n.id where vergadering_id = v.id and bundel and notitie_id is null;
  update public.taak_punten tp set notitie_id = n.id from public.taken t where t.id = tp.taak_id and t.vergadering_id = v.id and t.bundel and tp.notitie_id is null;
  return n;
end $$;

-- een gedeeld vergaderverslag toont bij een punt in een to-dotaak de tekst en deadline van het punt (niet de verzameltaak)
do $$ declare def text; oud text := $q$left join public.taken t on t.id = pt.taak_id where pt.vergadering_id = v.id$q$; nieuw text := $q$left join public.taken t on t.id = pt.taak_id and not t.bundel where pt.vergadering_id = v.id$q$;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p where p.proname = 'vergadering_deel_klant' and p.pronamespace = 'public'::regnamespace;
  if def is null then raise exception 'vergadering_deel_klant niet gevonden (script 051).'; end if;
  if position(nieuw in def) = 0 then
    if position(oud in def) = 0 then raise exception 'vergadering_deel_klant heeft niet de verwachte vorm (script 051).'; end if;
    execute replace(def, oud, nieuw);
  end if;
end $$;

-- klant / aannemer: eigen punten zien en afvinken
create or replace view public.klant_taak_punten as
  select tp.id, tp.taak_id, t.project_id, tp.tekst, tp.klaar, tp.klaar_op, tp.deadline, tp.volgorde,
         (t.contact_id is not null and t.contact_id in (select public.mijn_contacten())) as voor_mij
  from public.taak_punten tp
  join public.taken t on t.id = tp.taak_id
  where tp.los_taak_id is null and (
        (t.contact_id is not null and t.contact_id in (select public.mijn_contacten())
           and (t.project_id in (select public.klant_projecten()) or t.project_id in (select public.aannemer_projecten())))
     or (t.notitie_id is not null and exists (select 1 from public.notities n where n.id = t.notitie_id and n.klant_zichtbaar) and t.project_id in (select public.klant_projecten())));

create or replace function public.klant_taak_punt_klaar(p_punt uuid, p_klaar boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare tp public.taak_punten; t public.taken;
begin
  select * into tp from public.taak_punten where id = p_punt;
  if tp.id is null or tp.los_taak_id is not null then raise exception 'Punt niet gevonden.'; end if;
  select * into t from public.taken where id = tp.taak_id;
  if not (public.is_klant() or public.is_aannemer()) or t.contact_id is null or t.contact_id not in (select public.mijn_contacten())
     or not (t.project_id in (select public.klant_projecten()) or t.project_id in (select public.aannemer_projecten())) then
    raise exception 'Dit punt is niet aan jou toegewezen.';
  end if;
  update public.taak_punten set klaar = coalesce(p_klaar, false) where id = p_punt;
  return jsonb_build_object('ok', true, 'status', (select status from public.taken where id = t.id));
end $$;

-- =====================================================================
-- 2. ONTWERPTRAJECT
-- =====================================================================
alter table public.projecten add column if not exists richtbudget numeric(12,2);            -- excl. btw — startpunt van het Budgetkompas
alter table public.projecten add column if not exists budgetgrens numeric(12,2);            -- excl. btw — wat de klant maximaal wil uitgeven (optioneel)
alter table public.projecten add column if not exists budget_op date;                       -- datum van het richtbudget
alter table public.projecten add column if not exists budget_toelichting text not null default '';
alter table public.projecten add column if not exists budget_klant boolean not null default false;   -- Budgetkompas zichtbaar in het portaal

create table if not exists public.ontwerp_rondes (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projecten(id) on delete cascade,
  nummer            int not null,                                   -- V1, V2, … (per project, automatisch)
  titel             text not null default '',
  datum             date not null default current_date,             -- datum van het ontwerpgesprek
  verslag           text not null default '',                       -- voor de klant: wat besproken en beslist werd
  intern            text not null default '',                       -- nooit zichtbaar voor de klant
  vragen            jsonb not null default '[]'::jsonb,             -- [{id, tekst}] open vragen aan de klant
  feedback_tot      date,
  status            text not null default 'concept' check (status in ('concept', 'gepubliceerd', 'afgesloten')),
  gepubliceerd_op   timestamptz,
  gepubliceerd_door uuid references public.profiles(id) on delete set null,
  bevestigd_op      timestamptz,
  bevestigd_naam    text not null default '',
  bevestigd_door    uuid,
  bevestigd_email   text not null default '',
  vergadering_id    uuid references public.vergaderingen(id) on delete set null,
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (project_id, nummer)
);
create index if not exists ontwerp_rondes_project_idx on public.ontwerp_rondes(project_id, nummer desc);

create table if not exists public.ontwerp_documenten (
  id          uuid primary key default gen_random_uuid(),
  ronde_id    uuid not null references public.ontwerp_rondes(id) on delete cascade,
  project_id  uuid not null references public.projecten(id) on delete cascade,
  soort       text not null check (soort in ('beeld', 'pdf')),
  titel       text not null default '',
  pad         text not null,                                        -- opslag 'ontwerp': <project>/<ronde>/<id>.<ext> (vaste kopie)
  mime        text not null default '',
  grootte     bigint not null default 0,
  sha256      text not null default '',
  breedte     int,
  hoogte      int,
  paginas     int not null default 1,
  bron        text not null default 'upload' check (bron in ('upload', 'render', 'presentatie', 'drive')),
  bron_id     text not null default '',
  volgorde    int not null default 0,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (pad)
);
create index if not exists ontwerp_documenten_ronde_idx on public.ontwerp_documenten(ronde_id, volgorde);

create table if not exists public.ontwerp_feedback (
  id                  uuid primary key default gen_random_uuid(),
  ronde_id            uuid not null references public.ontwerp_rondes(id) on delete cascade,
  project_id          uuid not null references public.projecten(id) on delete cascade,
  soort               text not null default 'feedback' check (soort in ('feedback', 'antwoord', 'afspraak', 'wijziging')),
  document_id         uuid references public.ontwerp_documenten(id) on delete set null,
  pagina              int,
  x                   numeric(6,5),
  y                   numeric(6,5),
  vraag_id            text not null default '',
  tekst               text not null default '' check (length(tekst) <= 4000),
  door_klant          boolean not null default false,
  auteur              uuid,                                         -- auth-gebruiker (klant of teamlid)
  auteur_naam         text not null default '',
  verstuurd_op        timestamptz,                                  -- klant: leeg = nog niet verstuurd (concept, enkel voor hemzelf)
  reactie             text not null default '' check (length(reactie) <= 4000),
  reactie_status      text not null default 'open' check (reactie_status in ('open', 'aangepast', 'niet_mogelijk', 'afspraak', 'genoteerd')),
  reactie_door        uuid references public.profiles(id) on delete set null,
  reactie_op          timestamptz,
  intern              text not null default '',                     -- interne opmerking (nooit voor de klant)
  impact_status       text not null default 'geen' check (impact_status in ('geen', 'indicatief', 'akkoord', 'in_voorstel', 'vervallen')),
  impact_min          numeric(12,2),                                -- excl. btw; negatief = minder
  impact_max          numeric(12,2),
  impact_toelichting  text not null default '',
  impact_op           timestamptz,
  goedkeuring_id      uuid references public.goedkeuringen(id) on delete set null,
  klant_keuze         text check (klant_keuze in ('doorvoeren', 'niet')),
  klant_keuze_op      timestamptz,
  klant_keuze_naam    text not null default '',
  signaal             boolean not null default false,               -- feedback die waarschijnlijk iets kost of bespaart
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists ontwerp_feedback_ronde_idx on public.ontwerp_feedback(ronde_id, created_at);
create index if not exists ontwerp_feedback_project_idx on public.ontwerp_feedback(project_id) where impact_status <> 'geen';

alter table public.taken add column if not exists ontwerp_ronde_id uuid references public.ontwerp_rondes(id) on delete set null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'taak_punten_feedback_fk') then
    alter table public.taak_punten add constraint taak_punten_feedback_fk foreign key (ontwerp_feedback_id) references public.ontwerp_feedback(id) on delete set null;
  end if;
end $$;

alter table public.ontwerp_rondes enable row level security;
alter table public.ontwerp_documenten enable row level security;
alter table public.ontwerp_feedback enable row level security;
drop policy if exists ontwerp_rondes_intern on public.ontwerp_rondes;
create policy ontwerp_rondes_intern on public.ontwerp_rondes for all to authenticated using (public.is_intern()) with check (public.is_intern());
drop policy if exists ontwerp_documenten_intern on public.ontwerp_documenten;
create policy ontwerp_documenten_intern on public.ontwerp_documenten for all to authenticated using (public.is_intern()) with check (public.is_intern());
drop policy if exists ontwerp_feedback_intern on public.ontwerp_feedback;
create policy ontwerp_feedback_intern on public.ontwerp_feedback for all to authenticated using (public.is_intern() and (not door_klant or verstuurd_op is not null)) with check (public.is_intern());   -- concepten van de klant blijven van hem
grant select, insert, update, delete on public.ontwerp_rondes, public.ontwerp_documenten, public.ontwerp_feedback to authenticated;

-- ronde: nummer automatisch, status enkel vooruit (concept → gepubliceerd ⇄ afgesloten), bevestiging enkel door de klant
-- (security invoker: current_user = 'authenticated' bij wie rechtstreeks wijzigt; de klantfuncties hieronder zijn security definer)
create or replace function public.ontwerp_ronde_regels()
returns trigger language plpgsql set search_path = public as $$
declare app boolean := current_user in ('authenticated', 'anon');
begin
  if tg_op = 'INSERT' then
    perform 1 from public.projecten where id = new.project_id for update;
    select coalesce(max(nummer), 0) + 1 into new.nummer from public.ontwerp_rondes where project_id = new.project_id;
    if new.status <> 'concept' then raise exception 'Een nieuwe ontwerpronde start als concept.'; end if;
    new.created_by := coalesce(new.created_by, auth.uid()); new.bevestigd_op := null; new.bevestigd_naam := ''; new.bevestigd_door := null; new.bevestigd_email := '';
    new.gepubliceerd_op := null; new.gepubliceerd_door := null;
    return new;
  end if;
  if new.project_id is distinct from old.project_id or new.nummer is distinct from old.nummer then raise exception 'Project en nummer van een ontwerpronde liggen vast.'; end if;
  if app and (new.bevestigd_op, new.bevestigd_naam, new.bevestigd_door, new.bevestigd_email) is distinct from (old.bevestigd_op, old.bevestigd_naam, old.bevestigd_door, old.bevestigd_email) then
    raise exception 'Enkel de klant kan een ontwerpronde bevestigen (in het portaal).';
  end if;
  if app and old.status <> 'concept' then
    if (new.titel, new.datum, new.verslag) is distinct from (old.titel, old.datum, old.verslag) then
      raise exception 'Na publiceren liggen titel, datum en verslag vast (de klant heeft ze gezien). Zet een aanvulling als afspraak, of maak een nieuwe ronde.';
    end if;
    if exists (select 1 from jsonb_array_elements(case when jsonb_typeof(old.vragen) = 'array' then old.vragen else '[]'::jsonb end) q
                where not (case when jsonb_typeof(new.vragen) = 'array' then new.vragen else '[]'::jsonb end) @> jsonb_build_array(q)) then
      raise exception 'Na publiceren kan je vragen enkel toevoegen, niet wijzigen of weghalen.';
    end if;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'concept' then raise exception 'Een gepubliceerde ronde kan niet terug naar concept. Maak een nieuwe ronde.'; end if;
    if old.status = 'concept' and new.status = 'gepubliceerd' then
      if not exists (select 1 from public.ontwerp_documenten where ronde_id = new.id) and btrim(new.verslag) = '' then
        raise exception 'Voeg minstens één document of een verslag toe vóór je publiceert.';
      end if;
      new.gepubliceerd_op := now(); new.gepubliceerd_door := auth.uid();
    elsif old.status = 'concept' then raise exception 'Publiceer de ronde eerst.';
    end if;
  else new.gepubliceerd_op := old.gepubliceerd_op; new.gepubliceerd_door := old.gepubliceerd_door;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists ontwerp_ronde_regels on public.ontwerp_rondes;
create trigger ontwerp_ronde_regels before insert or update on public.ontwerp_rondes for each row execute function public.ontwerp_ronde_regels();
create or replace function public.ontwerp_ronde_weg()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.projecten where id = old.project_id) then return old; end if;   -- het hele project wordt verwijderd
  if current_user in ('authenticated', 'anon') and old.status <> 'concept' then raise exception 'Een gepubliceerde ronde blijft bewaard (chronologie). Sluit ze af in plaats van te verwijderen.'; end if;
  return old;
end $$;
drop trigger if exists ontwerp_ronde_weg on public.ontwerp_rondes;
create trigger ontwerp_ronde_weg before delete on public.ontwerp_rondes for each row execute function public.ontwerp_ronde_weg();

-- documenten liggen vast zodra de ronde gepubliceerd is (enkel de titel mag nog)
create or replace function public.ontwerp_document_regels()
returns trigger language plpgsql set search_path = public as $$
declare st text;
begin
  select status into st from public.ontwerp_rondes where id = coalesce(new.ronde_id, old.ronde_id);
  if st is null then return coalesce(new, old); end if;   -- opgeruimd samen met de ronde of het project
  if tg_op = 'INSERT' then
    if new.project_id is distinct from (select project_id from public.ontwerp_rondes where id = new.ronde_id) then raise exception 'Document en ronde horen niet bij hetzelfde project.'; end if;
    if split_part(new.pad, '/', 1) <> new.project_id::text or split_part(new.pad, '/', 2) <> new.ronde_id::text then raise exception 'Ongeldig opslagpad.'; end if;
    if st <> 'concept' then raise exception 'Deze ronde is gepubliceerd: voeg nieuwe documenten toe in een nieuwe ronde.'; end if;
    new.created_by := coalesce(new.created_by, auth.uid());
    return new;
  end if;
  if tg_op = 'DELETE' then
    if st <> 'concept' and current_user in ('authenticated', 'anon') then raise exception 'De documenten van een gepubliceerde ronde blijven bewaard.'; end if;
    return old;
  end if;
  if st <> 'concept' and (new.pad, new.ronde_id, new.project_id, new.sha256, new.soort, new.paginas) is distinct from (old.pad, old.ronde_id, old.project_id, old.sha256, old.soort, old.paginas) then
    raise exception 'De documenten van een gepubliceerde ronde liggen vast.';
  end if;
  if (new.pad, new.ronde_id, new.project_id) is distinct from (old.pad, old.ronde_id, old.project_id) then raise exception 'Pad en ronde van een document liggen vast.'; end if;
  return new;
end $$;
drop trigger if exists ontwerp_document_regels on public.ontwerp_documenten;
create trigger ontwerp_document_regels before insert or update or delete on public.ontwerp_documenten for each row execute function public.ontwerp_document_regels();

-- feedback: wat de klant schreef, ligt vast (BROS antwoordt ernaast); impact met geldige bedragen
create or replace function public.ontwerp_feedback_regels()
returns trigger language plpgsql set search_path = public as $$
declare app boolean := current_user in ('authenticated', 'anon'); r public.ontwerp_rondes;
begin
  select * into r from public.ontwerp_rondes where id = coalesce(new.ronde_id, old.ronde_id);
  if tg_op = 'DELETE' then
    if r.id is null or not exists (select 1 from public.projecten where id = old.project_id) then return old; end if;   -- opgeruimd met de ronde of het project
    if app and old.door_klant then raise exception 'Feedback van de klant blijft bewaard.'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.project_id is distinct from r.project_id then raise exception 'Feedback en ronde horen niet bij hetzelfde project.'; end if;
    if app then   -- door het team rechtstreeks: een afspraak of ontwerpwijziging van BROS
      if new.soort not in ('afspraak', 'wijziging') then raise exception 'Het team voegt afspraken en ontwerpwijzigingen toe; feedback komt van de klant.'; end if;
      new.door_klant := false; new.auteur := auth.uid(); new.auteur_naam := coalesce((select name from public.profiles where id = auth.uid()), '');
      new.verstuurd_op := now(); new.klant_keuze := null; new.klant_keuze_op := null; new.klant_keuze_naam := '';
    end if;
  else
    if new.ronde_id is distinct from old.ronde_id or new.project_id is distinct from old.project_id or new.door_klant is distinct from old.door_klant or new.auteur is distinct from old.auteur then
      raise exception 'Bron en auteur van een feedbackpunt liggen vast.';
    end if;
    if app and old.door_klant and (new.tekst, new.document_id, new.pagina, new.x, new.y, new.vraag_id, new.verstuurd_op, new.soort, new.auteur_naam) is distinct from (old.tekst, old.document_id, old.pagina, old.x, old.y, old.vraag_id, old.verstuurd_op, old.soort, old.auteur_naam) then
      raise exception 'Wat de klant schreef, ligt vast. Antwoord ernaast.';
    end if;
    if app and old.door_klant and old.verstuurd_op is null then raise exception 'Deze feedback is nog niet verstuurd door de klant.'; end if;
    if app and (new.klant_keuze, new.klant_keuze_op, new.klant_keuze_naam) is distinct from (old.klant_keuze, old.klant_keuze_op, old.klant_keuze_naam) then
      raise exception 'Enkel de klant kiest of een indicatieve wijziging doorgevoerd wordt.';
    end if;
    if (new.reactie, new.reactie_status) is distinct from (old.reactie, old.reactie_status) and app then new.reactie_door := auth.uid(); new.reactie_op := now();
    else new.reactie_door := old.reactie_door; new.reactie_op := old.reactie_op; end if;
  end if;
  if new.impact_status in ('indicatief', 'akkoord', 'in_voorstel') then
    if new.impact_min is null and new.impact_max is null then raise exception 'Vul de budgetimpact in (bedrag of vork, excl. btw).'; end if;
    new.impact_min := coalesce(new.impact_min, new.impact_max); new.impact_max := coalesce(new.impact_max, new.impact_min);
    if new.impact_min > new.impact_max then raise exception 'De vork van de budgetimpact loopt van laag naar hoog.'; end if;
    if new.impact_status = 'akkoord' and new.impact_min <> new.impact_max then raise exception 'Een beslissing met akkoord heeft één bedrag (geen vork).'; end if;
    if new.impact_status = 'in_voorstel' and new.goedkeuring_id is null then raise exception 'Koppel het meerwerkvoorstel waarin dit zit.'; end if;
    if new.goedkeuring_id is not null and not exists (select 1 from public.goedkeuringen g where g.id = new.goedkeuring_id and g.project_id = new.project_id and g.soort = 'meerwerk') then
      raise exception 'Dat voorstel hoort niet bij dit project (of is geen meerwerkvoorstel).';
    end if;
  end if;
  if tg_op = 'INSERT' or (new.impact_status, new.impact_min, new.impact_max) is distinct from (old.impact_status, old.impact_min, old.impact_max) then
    new.impact_op := case when new.impact_status = 'geen' then null else now() end;
    if tg_op = 'UPDATE' and new.impact_status <> 'indicatief' then new.klant_keuze := null; new.klant_keuze_op := null; new.klant_keuze_naam := ''; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists ontwerp_feedback_regels on public.ontwerp_feedback;
create trigger ontwerp_feedback_regels before insert or update or delete on public.ontwerp_feedback for each row execute function public.ontwerp_feedback_regels();

-- feedback die waarschijnlijk geld kost of bespaart (een signaal voor BROS, nooit een bedrag voor de klant)
create or replace function public.ontwerp_signaal(p_tekst text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_tekst, '') ~* ('\m(extra|bijkomend\w*|toevoeg\w*|bijplaats\w*|bijmaken|erbij|groter\w*|breder\w*|hoger\w*|langer\w*|dieper\w*|massie[fv]\w*|natuursteen|marmer|graniet|messing|brons|maatwerk|verlichting|led|ledstrip\w*|spots?|stopcontact\w*|domotica|verplaats\w*|weglaten|schrappen|kleiner\w*|goedkoper|eenvoudiger|minder)\M'
                                   || '|\mander(e)?\s+(materiaal|hout|houtsoort|steen|kleur|tegels?|vloer|kraan|grepen|greep)\M|niet meer nodig')
$$;

-- ---------- klantenportaal ----------
create or replace view public.klant_ontwerp_rondes as
  select r.id, r.project_id, r.nummer, r.titel, r.datum, r.verslag, r.vragen, r.feedback_tot, r.status, r.gepubliceerd_op,
         r.bevestigd_op, r.bevestigd_naam, r.updated_at
  from public.ontwerp_rondes r
  where r.status <> 'concept' and r.project_id in (select public.klant_projecten());
create or replace view public.klant_ontwerp_documenten as
  select d.id, d.ronde_id, d.project_id, d.soort, d.titel, d.pad, d.mime, d.breedte, d.hoogte, d.paginas, d.volgorde
  from public.ontwerp_documenten d join public.ontwerp_rondes r on r.id = d.ronde_id
  where r.status <> 'concept' and r.project_id in (select public.klant_projecten());
create or replace view public.klant_ontwerp_feedback as
  select f.id, f.ronde_id, f.project_id, f.soort, f.document_id, f.pagina, f.x, f.y, f.vraag_id, f.tekst, f.door_klant, f.auteur_naam,
         coalesce(f.auteur = auth.uid() and not public.voorbeeld_actief(), false) as eigen, f.verstuurd_op, f.created_at,
         f.reactie, f.reactie_status, f.reactie_op,
         case when p.budget_klant then f.impact_status else 'geen' end as impact_status,
         case when p.budget_klant then f.impact_min end as impact_min, case when p.budget_klant then f.impact_max end as impact_max,
         case when p.budget_klant then f.impact_toelichting else '' end as impact_toelichting,
         f.klant_keuze, f.klant_keuze_naam
  from public.ontwerp_feedback f
  join public.ontwerp_rondes r on r.id = f.ronde_id
  join public.projecten p on p.id = f.project_id
  where r.status <> 'concept' and r.project_id in (select public.klant_projecten())
    and (f.verstuurd_op is not null or (f.auteur = auth.uid() and not public.voorbeeld_actief()));

-- feedback bewaren (concept, enkel voor de klant zelf tot hij verstuurt); leeg = verwijderen
create or replace function public.klant_ontwerp_feedback(p_id uuid, p_ronde uuid, p_document uuid, p_pagina int, p_x numeric, p_y numeric, p_vraag text, p_tekst text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.ontwerp_rondes; f public.ontwerp_feedback; d public.ontwerp_documenten; t text := btrim(coalesce(p_tekst, '')); v text := coalesce(p_vraag, ''); naam text;
begin
  if not public.is_klant() then raise exception 'Geen toegang.'; end if;
  if p_id is not null then
    select * into f from public.ontwerp_feedback where id = p_id;
    if f.id is null or f.auteur is distinct from auth.uid() then raise exception 'Feedback niet gevonden.'; end if;
    if f.verstuurd_op is not null then raise exception 'Deze feedback is al verstuurd. Voeg gerust een nieuw punt toe.'; end if;
    p_ronde := f.ronde_id;
  end if;
  select * into r from public.ontwerp_rondes where id = p_ronde;
  if r.id is null or r.status = 'concept' or r.project_id not in (select public.klant_projecten()) then raise exception 'Ontwerpronde niet gevonden.'; end if;
  if r.status <> 'gepubliceerd' then raise exception 'Deze ronde is afgesloten; feedback geven kan niet meer.'; end if;
  if length(t) > 4000 then raise exception 'Hou het punt korter (max. 4000 tekens).'; end if;
  if p_id is not null and t = '' then delete from public.ontwerp_feedback where id = p_id; return jsonb_build_object('ok', true, 'verwijderd', true); end if;
  if t = '' then raise exception 'Schrijf je feedback.'; end if;
  if p_document is not null then
    select * into d from public.ontwerp_documenten where id = p_document and ronde_id = r.id;
    if d.id is null then raise exception 'Dit document hoort niet bij deze ronde.'; end if;
    if p_pagina is not null and (p_pagina < 1 or p_pagina > greatest(d.paginas, 1)) then raise exception 'Ongeldige pagina.'; end if;
    if (p_x is null) <> (p_y is null) or p_x < 0 or p_x > 1 or p_y < 0 or p_y > 1 then raise exception 'Ongeldige plaats.'; end if;
  elsif p_x is not null or p_y is not null then raise exception 'Een plaats hoort bij een document.';
  end if;
  if v <> '' and not exists (select 1 from jsonb_array_elements(r.vragen) q where q->>'id' = v) then raise exception 'Deze vraag bestaat niet (meer).'; end if;
  naam := coalesce((select name from public.profiles where id = auth.uid()), '');
  if p_id is null then
    if v <> '' then select * into f from public.ontwerp_feedback where ronde_id = r.id and auteur = auth.uid() and vraag_id = v and verstuurd_op is null; end if;
    if f.id is null then
      if (select count(*) from public.ontwerp_feedback where ronde_id = r.id and auteur = auth.uid()) >= 300 then raise exception 'Je gaf al heel veel feedback op deze ronde (max. 300 punten).'; end if;
      if (select count(*) from public.ontwerp_feedback where auteur = auth.uid() and created_at > now() - interval '1 day') >= 400 then raise exception 'Te veel feedback vandaag. Probeer morgen opnieuw of contacteer BROS.'; end if;
      insert into public.ontwerp_feedback (ronde_id, project_id, soort, document_id, pagina, x, y, vraag_id, tekst, door_klant, auteur, auteur_naam, signaal)
      values (r.id, r.project_id, case when v <> '' then 'antwoord' else 'feedback' end, p_document, case when p_document is not null then coalesce(p_pagina, 1) end, p_x, p_y, v, t, true, auth.uid(), naam, public.ontwerp_signaal(t))
      returning * into f;
      return to_jsonb(f) - 'intern';
    end if;
  end if;
  update public.ontwerp_feedback set tekst = t, document_id = case when f.vraag_id <> '' then null else p_document end,
         pagina = case when f.vraag_id = '' and p_document is not null then coalesce(p_pagina, 1) end,
         x = case when f.vraag_id = '' then p_x end, y = case when f.vraag_id = '' then p_y end, signaal = public.ontwerp_signaal(t), auteur_naam = naam
   where id = f.id returning * into f;
  return to_jsonb(f) - 'intern';
end $$;

-- alle eigen concepten van een ronde versturen → één to-do voor de projectlead (met elk punt) en een mail (Drive-script, klantmelding 'ontwerp')
create or replace function public.klant_ontwerp_versturen(p_ronde uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.ontwerp_rondes; p public.projecten; n int; t_id uuid; x record; vol int; doc text; vraag text; lead uuid;
begin
  if not public.is_klant() then raise exception 'Geen toegang.'; end if;
  select * into r from public.ontwerp_rondes where id = p_ronde for update;
  if r.id is null or r.status = 'concept' or r.project_id not in (select public.klant_projecten()) then raise exception 'Ontwerpronde niet gevonden.'; end if;
  if r.status <> 'gepubliceerd' then raise exception 'Deze ronde is afgesloten; feedback versturen kan niet meer.'; end if;
  select count(*) into n from public.ontwerp_feedback where ronde_id = r.id and auteur = auth.uid() and verstuurd_op is null;
  if n = 0 then raise exception 'Er is nog geen feedback om te versturen.'; end if;
  select * into p from public.projecten where id = r.project_id;
  lead := case when p.lead is not null and exists (select 1 from public.profiles where id = p.lead and active and role in ('beheer', 'medewerker')) then p.lead end;
  perform set_config('bros.td', '1', true);
  t_id := public.td_bundel(r.project_id, null, null, r.id, lead, null, 'feedback ontwerp V' || r.nummer);
  update public.taken set titel = left('Feedback ontwerp V' || r.nummer || ' verwerken' || case when btrim(r.titel) <> '' then ' · ' || r.titel else '' end, 300) where id = t_id and titel like 'To do''s · feedback ontwerp V%';
  select coalesce(max(volgorde), 0) into vol from public.taak_punten where taak_id = t_id;
  for x in select f.*, (select d.titel from public.ontwerp_documenten d where d.id = f.document_id) as doc_titel
             from public.ontwerp_feedback f where f.ronde_id = r.id and f.auteur = auth.uid() and f.verstuurd_op is null order by f.created_at loop
    vol := vol + 1;
    vraag := case when x.vraag_id <> '' then (select q->>'tekst' from jsonb_array_elements(r.vragen) q where q->>'id' = x.vraag_id limit 1) end;
    doc := case when x.document_id is not null then coalesce(nullif(x.doc_titel, ''), 'document') || case when coalesce(x.pagina, 1) > 1 then ' p.' || x.pagina else '' end || ': '
                when vraag is not null then 'Vraag "' || left(vraag, 80) || '": ' else '' end;
    insert into public.taak_punten (taak_id, tekst, volgorde, ontwerp_feedback_id, created_by)
    values (t_id, left(doc || x.tekst, 1000), vol, x.id, null);
  end loop;
  update public.ontwerp_feedback set verstuurd_op = now() where ronde_id = r.id and auteur = auth.uid() and verstuurd_op is null;
  return jsonb_build_object('ok', true, 'verstuurd', n, 'taak_id', t_id);
end $$;

create or replace function public.klant_ontwerp_bevestigen(p_ronde uuid, p_naam text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.ontwerp_rondes;
begin
  if not public.is_klant() then raise exception 'Geen toegang.'; end if;
  select * into r from public.ontwerp_rondes where id = p_ronde for update;
  if r.id is null or r.status = 'concept' or r.project_id not in (select public.klant_projecten()) then raise exception 'Ontwerpronde niet gevonden.'; end if;
  if r.bevestigd_op is not null then raise exception 'Deze ronde werd al bevestigd door %.', r.bevestigd_naam; end if;
  if length(btrim(coalesce(p_naam, ''))) < 2 then raise exception 'Vul je naam in.'; end if;
  if exists (select 1 from public.ontwerp_feedback where ronde_id = r.id and auteur = auth.uid() and verstuurd_op is null) then
    raise exception 'Je hebt nog feedback die niet verstuurd is. Verstuur of verwijder die eerst.';
  end if;
  update public.ontwerp_rondes set bevestigd_op = now(), bevestigd_naam = left(btrim(p_naam), 120), bevestigd_door = auth.uid(),
         bevestigd_email = coalesce((select email from public.profiles where id = auth.uid()), '')
   where id = r.id;
  return jsonb_build_object('ok', true);
end $$;

-- indicatieve wijziging: "doorvoeren" of "liever niet" (geen verbintenis: bindend wordt het pas via een keuze of meerwerkvoorstel)
create or replace function public.klant_ontwerp_impact(p_feedback uuid, p_keuze text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.ontwerp_feedback; p public.projecten;
begin
  if not public.is_klant() then raise exception 'Geen toegang.'; end if;
  select * into f from public.ontwerp_feedback where id = p_feedback for update;
  if f.id is null or f.project_id not in (select public.klant_projecten()) or f.verstuurd_op is null then raise exception 'Punt niet gevonden.'; end if;
  select * into p from public.projecten where id = f.project_id;
  if not p.budget_klant then raise exception 'Punt niet gevonden.'; end if;
  if f.impact_status <> 'indicatief' then raise exception 'Over dit punt is al beslist.'; end if;
  if p_keuze is not null and p_keuze not in ('doorvoeren', 'niet') then raise exception 'Ongeldige keuze.'; end if;
  update public.ontwerp_feedback set klant_keuze = p_keuze, klant_keuze_op = case when p_keuze is null then null else now() end,
         klant_keuze_naam = case when p_keuze is null then '' else coalesce((select name from public.profiles where id = auth.uid()), '') end
   where id = f.id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- opslag 'ontwerp' (privé): team laadt op; de klant leest enkel de documenten van gepubliceerde rondes van zijn project ----------
create or replace function public.ontwerp_klant_pad(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ontwerp_documenten d join public.ontwerp_rondes r on r.id = d.ronde_id
                  where d.pad = p_name and r.status <> 'concept' and r.project_id in (select public.klant_projecten()))
$$;
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public) values ('ontwerp', 'ontwerp', false) on conflict (id) do update set public = false;
    if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
      update storage.buckets set file_size_limit = 62914560, allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] where id = 'ontwerp';
    end if;
    execute 'drop policy if exists ontwerp_insert on storage.objects';
    execute 'drop policy if exists ontwerp_read on storage.objects';
    execute 'drop policy if exists ontwerp_delete on storage.objects';
    execute $p$create policy ontwerp_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'ontwerp' and public.is_intern() and split_part(name, '/', 4) = '' and split_part(name, '/', 3) <> ''
      and exists (select 1 from public.ontwerp_rondes r where r.id::text = split_part(name, '/', 2) and r.project_id::text = split_part(name, '/', 1) and r.status = 'concept'))$p$;
    execute $p$create policy ontwerp_read on storage.objects for select to authenticated using (
      bucket_id = 'ontwerp' and (public.is_intern() or public.ontwerp_klant_pad(name)))$p$;
    execute $p$create policy ontwerp_delete on storage.objects for delete to authenticated using (
      bucket_id = 'ontwerp' and public.is_intern()
      and not exists (select 1 from public.ontwerp_documenten d join public.ontwerp_rondes r on r.id = d.ronde_id where d.pad = storage.objects.name and r.status <> 'concept'))$p$;
  end if;
end $$;

-- =====================================================================
-- 3. BUDGETKOMPAS (excl. btw)
-- =====================================================================
create or replace function public.budgetkompas(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.projecten; v_intern boolean := public.is_intern() and not public.voorbeeld_actief(); /* testmodus: zoals de klant het ziet */ basis numeric; basis_soort text; basis_datum timestamptz; off_titel text;
        vast jsonb := '[]'::jsonb; open jsonb := '[]'::jsonb; verloop jsonb := '[]'::jsonb; x record; t_basis numeric := 0; t_rest numeric := 0; t_pend numeric := 0; off_gezien boolean := false;
        som_vast numeric := 0; omin numeric := 0; omax numeric := 0; e record;
begin
  select * into p from public.projecten where id = p_project;
  if p.id is null or not (v_intern or (p.budget_klant and p_project in (select public.klant_projecten()))) then raise exception 'Geen toegang.'; end if;
  -- basis: de goedgekeurde offerte(s), anders het richtbudget
  select sum(totaal_excl), max(beslist_op), string_agg(titel, ' + ' order by beslist_op) into basis, basis_datum, off_titel
    from public.goedkeuringen where project_id = p_project and soort = 'offerte' and status = 'akkoord';
  if basis is not null then basis_soort := 'offerte'; else basis := p.richtbudget; basis_soort := case when p.richtbudget is not null then 'richtbudget' end; basis_datum := p.budget_op::timestamptz; end if;
  -- vastgelegd
  for x in
    select 'meerwerk' as soort, g.id::text as ref, g.titel, g.totaal_excl as bedrag, g.beslist_op as datum
      from public.goedkeuringen g where g.project_id = p_project and g.soort = 'meerwerk' and g.status = 'akkoord'
    union all
    select 'keuze', k.id::text, coalesce(nullif(k.ruimte, '') || ' · ', '') || k.onderwerp || ': ' || o.naam, o.meerprijs, coalesce(k.gekozen_op, k.updated_at)
      from public.keuzes k join public.keuze_opties o on o.id = k.gekozen_optie
     where k.project_id = p_project and k.status in ('gekozen', 'bevestigd') and coalesce(o.meerprijs, 0) <> 0
       and not exists (select 1 from public.goedkeuringen g where g.project_id = p_project and g.soort = 'meerwerk' and g.status = 'akkoord'
                        and k.meerwerk_post is not null and g.posten @> jsonb_build_array(jsonb_build_object('id', k.meerwerk_post)))
    union all
    select 'ontwerp', f.id::text, coalesce(nullif(left(f.tekst, 140), ''), 'Ontwerpwijziging') || ' (V' || r.nummer || ')', f.impact_max, f.impact_op
      from public.ontwerp_feedback f join public.ontwerp_rondes r on r.id = f.ronde_id
     where f.project_id = p_project and f.impact_status = 'akkoord' and (v_intern or r.status <> 'concept')
       and not (basis_soort = 'offerte' and f.impact_op <= basis_datum)   -- vóór de offerte afgesproken: zit in de offerte
    order by 5 nulls first
  loop
    vast := vast || jsonb_build_object('soort', x.soort, 'ref', x.ref, 'titel', x.titel, 'bedrag', x.bedrag, 'datum', x.datum);
    som_vast := som_vast + coalesce(x.bedrag, 0);
  end loop;
  -- open (wat als): indicatieve impact, open keuzes, open voorstellen
  for x in
    select 'ontwerp' as soort, f.id::text as ref, coalesce(nullif(left(f.tekst, 140), ''), 'Ontwerpwijziging') || ' (V' || r.nummer || ')' as titel,
           f.impact_min as min, f.impact_max as max, f.klant_keuze, f.impact_toelichting as toelichting, '[]'::jsonb as opties, f.impact_op as datum,
           (f.klant_keuze is distinct from 'niet' and f.impact_status <> 'in_voorstel') as standaard   -- voorstel geweigerd of ingetrokken: niet meer standaard
      from public.ontwerp_feedback f join public.ontwerp_rondes r on r.id = f.ronde_id
     where f.project_id = p_project and (v_intern or r.status <> 'concept')
       and (f.impact_status = 'indicatief' or (f.impact_status = 'in_voorstel' and not exists (select 1 from public.goedkeuringen g where g.id = f.goedkeuring_id and g.status in ('akkoord', 'open'))))
    union all
    select 'voorstel', g.id::text, g.titel, least(0, g.totaal_excl), greatest(0, g.totaal_excl), null, g.toelichting, '[]'::jsonb, g.voorgelegd_op, true
      from public.goedkeuringen g where g.project_id = p_project and g.soort = 'meerwerk' and g.status = 'open'
    union all
    select 'keuze', k.id::text, coalesce(nullif(k.ruimte, '') || ' · ', '') || k.onderwerp, min(o.meerprijs), max(o.meerprijs), null, k.toelichting,
           jsonb_agg(jsonb_build_object('id', o.id, 'naam', o.naam, 'bedrag', o.meerprijs) order by o.volgorde, o.meerprijs), k.updated_at, true
      from public.keuzes k join public.keuze_opties o on o.keuze_id = k.id
     where k.project_id = p_project and k.status = 'open'
     group by k.id
     having max(o.meerprijs) <> 0 or min(o.meerprijs) <> 0
  loop
    open := open || jsonb_build_object('soort', x.soort, 'ref', x.ref, 'titel', x.titel, 'min', x.min, 'max', x.max, 'klant_keuze', x.klant_keuze,
                                       'toelichting', x.toelichting, 'opties', x.opties, 'datum', x.datum, 'standaard', x.standaard);
    if x.standaard then
      if x.soort = 'keuze' then omin := omin + coalesce(x.min, 0); omax := omax + coalesce(x.max, 0);   -- een keuze: van de goedkoopste tot de duurste optie
      else omin := omin + coalesce(x.min, 0); omax := omax + coalesce(x.max, 0); end if;
    end if;
  end loop;
  -- verloop: wat het budget op welke dag veranderde. Een offerte vervangt het richtbudget (de eerste) en de ontwerpbeslissingen
  -- die erin opgenomen zijn (akkoord vóór de laatste offerte, zoals in 'vast'); meer-/minwerk en keuzes komen er altijd bij.
  -- Zo eindigt het verloop altijd op het huidige budget.
  t_basis := coalesce(p.richtbudget, 0);
  if p.richtbudget is not null then
    verloop := verloop || jsonb_build_object('datum', coalesce(p.budget_op::timestamptz, p.created_at), 'titel', 'Richtbudget', 'delta', p.richtbudget, 'totaal', p.richtbudget, 'soort', 'richtbudget');
  end if;
  for e in
    select g.beslist_op as datum, 'Offerte goedgekeurd: ' || g.titel as titel, g.totaal_excl as bedrag, 'offerte' as soort, false as opgenomen
      from public.goedkeuringen g where g.project_id = p_project and g.soort = 'offerte' and g.status = 'akkoord'
    union all
    select (v->>'datum')::timestamptz, v->>'titel', (v->>'bedrag')::numeric, v->>'soort', false from jsonb_array_elements(vast) v
    union all   -- ontwerpbeslissingen vóór de (laatste) offerte: wel in het verloop, en opgenomen in de offerte
    select f.impact_op, coalesce(nullif(left(f.tekst, 140), ''), 'Ontwerpwijziging') || ' (V' || r.nummer || ')', f.impact_max, 'ontwerp', true
      from public.ontwerp_feedback f join public.ontwerp_rondes r on r.id = f.ronde_id
     where f.project_id = p_project and f.impact_status = 'akkoord' and (v_intern or r.status <> 'concept') and basis_soort = 'offerte' and f.impact_op <= basis_datum
    order by 1 nulls first, 2
  loop
    if e.soort = 'offerte' then
      -- de offerte neemt de nog niet opgenomen ontwerpbeslissingen (t_pend) en, de eerste keer, het richtbudget over
      verloop := verloop || jsonb_build_object('datum', e.datum, 'titel', e.titel, 'delta', e.bedrag - t_pend - case when off_gezien then 0 else t_basis end,
                                               'totaal', case when off_gezien then t_basis else 0 end + e.bedrag + t_rest, 'soort', 'offerte');
      t_basis := case when off_gezien then t_basis else 0 end + e.bedrag; t_pend := 0; off_gezien := true;
    else
      if e.opgenomen then t_pend := t_pend + coalesce(e.bedrag, 0); else t_rest := t_rest + coalesce(e.bedrag, 0); end if;
      verloop := verloop || jsonb_build_object('datum', e.datum, 'titel', e.titel, 'delta', e.bedrag, 'totaal', t_basis + t_pend + t_rest, 'soort', e.soort);
    end if;
  end loop;
  return jsonb_build_object(
    'project_id', p.id, 'basis', basis, 'basis_soort', basis_soort, 'basis_datum', basis_datum, 'basis_titel', off_titel,
    'richtbudget', p.richtbudget, 'budgetgrens', p.budgetgrens, 'toelichting', p.budget_toelichting, 'zichtbaar_klant', p.budget_klant,
    'vast', vast, 'som_vast', som_vast, 'huidig', case when basis is null then null else basis + som_vast end,
    'open', open, 'open_min', omin, 'open_max', omax,
    'verwacht_min', case when basis is null then null else basis + som_vast + omin end,
    'verwacht_max', case when basis is null then null else basis + som_vast + omax end,
    'verloop', verloop, 'btw', 'excl');
end $$;

-- =====================================================================
-- 4. LIVE (portaal + Planbord), RECHTEN, SCHEMA
-- =====================================================================
do $$ declare t text; begin
  foreach t in array array['taak_punten', 'ontwerp_rondes', 'ontwerp_documenten', 'ontwerp_feedback'] loop
    if t <> 'taak_punten' then
      execute format('drop trigger if exists %I on public.%I', t || '_portaal_ping', t);
      execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.portaal_ping(%L)', t || '_portaal_ping', t, 'project_id');
    end if;
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
-- een punt afvinken laat de klant live meekijken (via de taak)
create or replace function public.td_ping()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  select project_id into pid from public.taken where id = coalesce(new.taak_id, old.taak_id) and (contact_id is not null or notitie_id is not null);
  if pid is not null then
    insert into public.portaal_pings (project_id, gewijzigd_op) values (pid, now())
    on conflict (project_id) do update set gewijzigd_op = now() where public.portaal_pings.gewijzigd_op < now();
  end if;
  return null;
end $$;
drop trigger if exists taak_punten_portaal_ping on public.taak_punten;
create trigger taak_punten_portaal_ping after insert or update or delete on public.taak_punten for each row execute function public.td_ping();

select public.rechten_herstellen();
do $$ declare f text; begin
  foreach f in array array['td_herreken(uuid)', 'td_bundel(uuid, uuid, uuid, uuid, uuid, uuid, text)', 'td_punt_voor()', 'td_punt_na()', 'td_taak_klaar()', 'td_ping()',
                           'ontwerp_ronde_regels()', 'ontwerp_ronde_weg()', 'ontwerp_document_regels()', 'ontwerp_feedback_regels()'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
  end loop;
end $$;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(59, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: moet 4 | 1 | 13 | 59 teruggeven (nieuwe tabellen, opslag ontwerp, nieuwe functies, schemaversie).
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('taak_punten', 'ontwerp_rondes', 'ontwerp_documenten', 'ontwerp_feedback'))::int as tabellen,
       (select count(*) from storage.buckets where id = 'ontwerp')::int as opslag,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('todo_toevoegen', 'vergadering_punt_todo', 'todo_punt_los', 'vergadering_notitie', 'klant_taak_punt_klaar',
          'klant_ontwerp_feedback', 'klant_ontwerp_versturen', 'klant_ontwerp_bevestigen', 'klant_ontwerp_impact', 'budgetkompas', 'ontwerp_signaal', 'td_bundel', 'td_herreken'))::int as functies,
       (select (value->>'versie_schema')::int from public.instellingen where key = 'app') as schema;
