-- =====================================================================
--  BROS Planbord — databasescript 041: afspraken ter plaatse (werf, kantoor BROS of een ander adres)
--  Een ingeplande taak kan een afspraak zijn: datum (taken.start), van–tot, plaats en adres, en de deelnemers
--  (klanten/aannemers van het project). Het Drive-script zet ze in de Google Agenda van brosburo ("PB/Klant, onderwerp",
--  met het adres) en mailt de deelnemers een agendabestand (.ics). In het klanten- en aannemersportaal zien de deelnemers
--  hun afspraken en zetten ze die met één klik in hun eigen agenda (Apple/Outlook via .ics, of Google Agenda).
--  Vereist schema 40. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 40 then
    raise exception 'Voer eerst de scripts tot en met 040 uit.';
  end if;
end $$;

alter table public.taken
  add column if not exists afspraak           text,                              -- null = geen afspraak; 'werf' | 'kantoor' | 'elders'
  add column if not exists afspraak_van       time,
  add column if not exists afspraak_tot       time,
  add column if not exists afspraak_adres     text not null default '',          -- het adres zoals het in de agenda komt
  add column if not exists afspraak_onderwerp text not null default '',          -- titel voor de agenda en het portaal (leeg = titel van de taak)
  add column if not exists afspraak_contacten uuid[] not null default '{}',      -- deelnemers (contacten): zien de afspraak in hun portaal en krijgen de mail
  add column if not exists afspraak_agenda    boolean not null default true,     -- in de Google Agenda van brosburo zetten
  add column if not exists afspraak_mailen    boolean not null default true,     -- deelnemers mailen bij nieuw/gewijzigd/geannuleerd
  add column if not exists agenda_event_id    text,                              -- (Drive-script) id van het agenda-item
  add column if not exists afspraak_mail      jsonb not null default '{}'::jsonb; -- (Drive-script) wat er gemaild werd: {hash, aan, seq}
alter table public.taken drop constraint if exists taken_afspraak_check;
alter table public.taken add constraint taken_afspraak_check check (
  afspraak is null or (afspraak in ('werf', 'kantoor', 'elders') and start is not null and afspraak_van is not null
                       and (afspraak_tot is null or afspraak_tot > afspraak_van)));
create index if not exists taken_afspraak_idx on public.taken(start) where afspraak is not null;
create index if not exists taken_afspraak_contacten_idx on public.taken using gin (afspraak_contacten);

-- wat de klant ziet: enkel de afspraken waarvoor hij als deelnemer aangevinkt is (vanaf een week geleden)
create or replace view public.klant_afspraken as
  select t.id, t.project_id, coalesce(nullif(trim(t.afspraak_onderwerp), ''), t.titel) as onderwerp, t.afspraak as plaats, t.afspraak_adres as adres,
         t.start as datum, t.afspraak_van as van, t.afspraak_tot as tot, coalesce(p.name, 'BROS') as met,
         coalesce((t.afspraak_mail->>'seq')::int, 0) as volgnr, t.updated_at
  from public.taken t left join public.profiles p on p.id = t.assignee
  where t.afspraak is not null and t.start >= current_date - 7
    and public.is_klant() and t.afspraak_contacten && array(select public.mijn_contacten());
-- wat de aannemer ziet (ook wie niet aan het project gekoppeld is maar uitgenodigd werd: dan zonder klantnaam)
create or replace view public.aan_afspraken as
  select t.id, t.project_id, coalesce(nullif(trim(t.afspraak_onderwerp), ''), t.titel) as onderwerp, t.afspraak as plaats, t.afspraak_adres as adres,
         t.start as datum, t.afspraak_van as van, t.afspraak_tot as tot, coalesce(p.name, 'BROS') as met,
         pr.nummer as project_nummer, case when t.project_id in (select public.aannemer_projecten()) then pr.klant else '' end as project_klant, pr.gemeente as project_gemeente,
         coalesce((t.afspraak_mail->>'seq')::int, 0) as volgnr, t.updated_at
  from public.taken t left join public.profiles p on p.id = t.assignee join public.projecten pr on pr.id = t.project_id
  where t.afspraak is not null and t.start >= current_date - 7
    and public.is_aannemer() and t.afspraak_contacten && array(select public.mijn_contacten());

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

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(41, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: moet 1 | 1 | 10 teruggeven
select (select count(*) from information_schema.views where table_schema = 'public' and table_name = 'klant_afspraken')::int as klant_view,
       (select count(*) from information_schema.views where table_schema = 'public' and table_name = 'aan_afspraken')::int as aannemer_view,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'taken' and (column_name like 'afspraak%' or column_name = 'agenda_event_id'))::int as kolommen;
