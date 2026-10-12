-- =====================================================================
--  BROS Planbord — databasescript 042: vragen van aannemers en klanten beantwoorden
--  Bij Voorstellen kan BROS nu ook gewoon antwoorden ("Beantwoorden…"), met of zonder taak:
--  - taak_voorstellen.bros_antwoord (+ beantwoord_op/_door) en status 'beantwoord' (afgehandeld zonder taak);
--  - aannemer: het antwoord staat onder zijn vraag in het portaal (view aan_vragen) en hij krijgt een mail (Drive-script);
--  - klant (vraag via de assistent): het antwoord komt als bericht van BROS in zijn gesprek (assistent_berichten.rol 'bros')
--    en hij krijgt een mail.
--  Een al beoordeeld voorstel (bevestigd/geweigerd/beantwoord) kan nog een (nieuw) antwoord krijgen.
--  Vereist schema 41. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 41 then
    raise exception 'Voer eerst de scripts tot en met 041 uit.';
  end if;
end $$;

alter table public.taak_voorstellen
  add column if not exists bros_antwoord   text not null default '',
  add column if not exists beantwoord_op   timestamptz,
  add column if not exists beantwoord_door uuid references public.profiles(id) on delete set null;
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.taak_voorstellen'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ 'status' loop
    execute format('alter table public.taak_voorstellen drop constraint %I', c);
  end loop;
  alter table public.taak_voorstellen add constraint taak_voorstellen_status_check check (status in ('open', 'bevestigd', 'geweigerd', 'beantwoord'));
end $$;

-- berichten van BROS in het gesprek van de klant
alter table public.assistent_berichten add column if not exists afzender text not null default '';   -- naam van wie bij BROS antwoordde (rol 'bros')
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.assistent_berichten'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ 'rol' loop
    execute format('alter table public.assistent_berichten drop constraint %I', c);
  end loop;
  alter table public.assistent_berichten add constraint assistent_berichten_rol_check check (rol in ('klant', 'assistent', 'bros'));
end $$;

-- antwoorden (en eventueel meteen een taak maken)
create or replace function public.voorstel_beantwoord(p_id uuid, p_antwoord text, p_taak boolean default false, p_titel text default null,
                                                      p_assignee uuid default null, p_eind date default null, p_fase int default null)
returns public.taak_voorstellen language plpgsql security definer set search_path = public as $$
declare v public.taak_voorstellen; t_id uuid; v_fase int; v_naam text; v_gesprek uuid;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  if length(trim(coalesce(p_antwoord, ''))) < 2 then raise exception 'Schrijf een antwoord.'; end if;
  select * into v from public.taak_voorstellen where id = p_id for update;
  if v.id is null then raise exception 'Vraag niet gevonden.'; end if;
  select name into v_naam from public.profiles where id = auth.uid();
  if coalesce(p_taak, false) then
    if v.status <> 'open' then raise exception 'Van deze vraag werd al een taak gemaakt of ze is al afgehandeld.'; end if;
    select coalesce(p_fase, fase_nr) into v_fase from public.projecten where id = v.project_id;
    insert into public.taken (project_id, titel, fase_nr, assignee, status, eind, uren_gepland, notitie, volgorde)
    values (v.project_id, coalesce(nullif(trim(p_titel), ''), v.titel), v_fase, coalesce(p_assignee, v.voorgestelde_user), 'todo', coalesce(p_eind, v.eind), 0,
            left(case when v.bron = 'aannemer' then 'Vraag van de aannemer via het portaal: ' else 'Vraag van de klant via het portaal: ' end || v.vraag, 500), 9800)
    returning id into t_id;
    update public.taak_voorstellen set status = 'bevestigd', taak_id = t_id, beoordeeld_door = auth.uid(), beoordeeld_op = now(),
           titel = coalesce(nullif(trim(p_titel), ''), titel), voorgestelde_user = coalesce(p_assignee, voorgestelde_user), eind = coalesce(p_eind, eind)
     where id = p_id;
  elsif v.status = 'open' then
    update public.taak_voorstellen set status = 'beantwoord', beoordeeld_door = auth.uid(), beoordeeld_op = now() where id = p_id;
  end if;
  update public.taak_voorstellen set bros_antwoord = left(trim(p_antwoord), 4000), beantwoord_op = now(), beantwoord_door = auth.uid()
   where id = p_id returning * into v;
  -- klant: het antwoord ook als bericht in zijn gesprek met de assistent
  if v.bron = 'assistent' and v.bericht_id is not null then
    select gesprek_id into v_gesprek from public.assistent_berichten where id = v.bericht_id;
    if v_gesprek is not null then
      insert into public.assistent_berichten (gesprek_id, project_id, rol, tekst, afzender) values (v_gesprek, v.project_id, 'bros', left(trim(p_antwoord), 4000), coalesce(v_naam, 'BROS'));
      update public.assistent_gesprekken set laatste_op = now() where id = v_gesprek;
    end if;
  end if;
  return v;
end $$;

-- het antwoord in het aannemersportaal (kolommen achteraan toegevoegd)
create or replace view public.aan_vragen as
  select v.id, v.project_id, v.titel, v.vraag, v.onderwerp, v.status, v.reden, v.created_at, v.beoordeeld_op,
         v.bros_antwoord, v.beantwoord_op, coalesce(p.name, '') as beantwoord_naam
  from public.taak_voorstellen v left join public.profiles p on p.id = v.beantwoord_door
  where v.bron = 'aannemer' and v.contact_id in (select public.mijn_contacten()) and v.project_id in (select public.aannemer_projecten());
-- het gesprek van de klant: met de naam van wie bij BROS antwoordde
create or replace view public.klant_assistent_berichten as
  select b.id, b.project_id, b.rol, b.tekst, b.created_at, b.afzender
  from public.assistent_berichten b join public.assistent_gesprekken g on g.id = b.gesprek_id
  where ((g.user_id = auth.uid() and not public.voorbeeld_actief()) or g.user_id = (select c.user_id from public.contacten c where c.id = public.voorbeeld_contact('klant')))
    and b.project_id in (select public.klant_projecten());

-- het portaal van de klant of aannemer ververst live zodra BROS antwoordt (zoals bij de andere portaalgegevens)
create or replace function public.antwoord_ping()
returns trigger language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(new); o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
begin
  -- (via jsonb: de twee tabellen hebben andere kolommen)
  if (tg_table_name = 'assistent_berichten' and j->>'rol' = 'bros')
     or (tg_table_name = 'taak_voorstellen' and coalesce(j->>'bros_antwoord', '') <> '' and (j->>'bros_antwoord') is distinct from (o->>'bros_antwoord')) then
    insert into public.portaal_pings (project_id, gewijzigd_op) values ((j->>'project_id')::uuid, now())
    on conflict (project_id) do update set gewijzigd_op = now() where public.portaal_pings.gewijzigd_op < now();
  end if;
  return null;
end $$;
drop trigger if exists assistent_berichten_antwoord_ping on public.assistent_berichten;
create trigger assistent_berichten_antwoord_ping after insert on public.assistent_berichten for each row execute function public.antwoord_ping();
drop trigger if exists taak_voorstellen_antwoord_ping on public.taak_voorstellen;
create trigger taak_voorstellen_antwoord_ping after insert or update of bros_antwoord on public.taak_voorstellen for each row execute function public.antwoord_ping();

-- ---------- rechten ----------
select public.rechten_herstellen();
revoke insert, update, delete, truncate, references, trigger on public.portaal_pings from authenticated, anon;
revoke insert, update, delete, truncate, references, trigger on public.portaal_voorbeeld from authenticated, anon;
revoke update, truncate, references, trigger on public.goedkeuring_tekenaars from authenticated, anon;
revoke all on public.goedkeuring_codes from authenticated, anon;
revoke all on function public.portaal_ping() from public, anon, authenticated;
revoke all on function public.keuze_optie_ping() from public, anon, authenticated;
revoke all on function public.werf_foto_ping() from public, anon, authenticated;
revoke all on function public.werf_fotos_gedeeld() from public, anon, authenticated;
revoke all on function public.prijsvraag_doorzetten() from public, anon, authenticated;
revoke all on function public.prijsaanvraag_zonder_pv() from public, anon, authenticated;
revoke all on function public.profiles_testmodus_guard() from public, anon, authenticated;
revoke all on function public.overeenkomst_vast() from public, anon, authenticated;
revoke all on function public.tekenaar_ping() from public, anon, authenticated;
revoke all on function public.tekenaar_vast() from public, anon, authenticated;
revoke all on function public.antwoord_ping() from public, anon, authenticated;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(42, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: moet 1 | 1 | 1 teruggeven
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'aan_vragen' and column_name = 'bros_antwoord')::int as aannemer_view,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'klant_assistent_berichten' and column_name = 'afzender')::int as klant_view,
       (select count(*) from pg_proc where proname = 'voorstel_beantwoord')::int as functie;
