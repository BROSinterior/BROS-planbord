-- =====================================================================
--  BROS Planbord — databasescript 050: een goedgekeurde offerte of goedgekeurd meerwerk annuleren (v1.53)
--  - Nieuwe status 'geannuleerd' voor goedkeuringen (offerte en meerwerk; een getekende overeenkomst blijft bewaard als bewijs).
--  - goedkeuring_annuleer(id, reden): enkel beheer. In één keer:
--      * het voorstel gaat naar 'geannuleerd' met tijdstip, wie en de reden (de beslissing van de klant blijft zichtbaar als historiek);
--      * de posten die met dit akkoord goedgekeurd werden verliezen hun akkoord (akkoord_op / akkoord_goedkeuring leeg)
--        en posten in status 'akkoord' gaan terug naar 'offerte' — ze kunnen daarna opnieuw voorgelegd worden.
--        Meer-/minwerkposten houden hun status; posten die intussen vervallen zijn, blijven vervallen.
--  - Bewaking: met een gewone login kan niemand meer rechtstreeks een status zetten (behalve open → ingetrokken), de beslissing
--    van de klant wijzigen of een beslist voorstel verwijderen — goedkeuren/weigeren gaat enkel via het portaal, annuleren
--    enkel via de functie (zodat de posten altijd mee terugspringen).
--  - De klant ziet in het portaal dat het voorstel geannuleerd werd, met de reden.
--  - Financiële planning: per project (en geraamd project) zelf kiezen of het meetelt (fin_plan.meetellen).
--  Vereist schema 49. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 49 then
    raise exception 'Voer eerst de scripts tot en met 049 uit.';
  end if;
end $$;

-- ---------- 1. status 'geannuleerd' + vastleggen wie, wanneer en waarom ----------
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.goedkeuringen'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ 'status' loop
    execute format('alter table public.goedkeuringen drop constraint %I', c);
  end loop;
  alter table public.goedkeuringen add constraint goedkeuringen_status_check check (status in ('open', 'akkoord', 'geweigerd', 'ingetrokken', 'geannuleerd'));
end $$;
alter table public.goedkeuringen
  add column if not exists geannuleerd_op   timestamptz,
  add column if not exists geannuleerd_door uuid references public.profiles(id) on delete set null,
  add column if not exists annuleer_reden   text not null default '';

-- ---------- 2. annuleren (enkel beheer) ----------
create or replace function public.goedkeuring_annuleer(p_id uuid, p_reden text)
returns public.goedkeuringen language plpgsql security definer set search_path = public as $$
declare g public.goedkeuringen;
begin
  if not public.is_beheer() then raise exception 'Enkel een beheerder kan een goedgekeurd voorstel annuleren.'; end if;
  select * into g from public.goedkeuringen where id = p_id for update;
  if g.id is null then raise exception 'Voorstel niet gevonden.'; end if;
  if g.soort = 'overeenkomst' then raise exception 'Een getekende overeenkomst blijft bewaard als bewijs en kan niet geannuleerd worden.'; end if;
  if g.status <> 'akkoord' then raise exception 'Enkel een goedgekeurd voorstel kan geannuleerd worden (dit staat op %).', g.status; end if;
  if length(trim(coalesce(p_reden, ''))) < 3 then raise exception 'Schrijf kort waarom je het voorstel annuleert.'; end if;
  update public.meetstaat_posten
     set akkoord_op = null, akkoord_goedkeuring = null,
         status = case when status = 'akkoord' then 'offerte' else status end,
         updated_at = now()
   where akkoord_goedkeuring = g.id and project_id = g.project_id;
  update public.goedkeuringen
     set status = 'geannuleerd', geannuleerd_op = now(), geannuleerd_door = auth.uid(), annuleer_reden = left(trim(p_reden), 2000)
   where id = g.id returning * into g;
  return g;
end $$;

-- ---------- 3. bewaking: beslissen en annuleren enkel via de functies ----------
-- (security invoker, zodat current_user de echte gebruiker is; goedkeuring_beslis, overeenkomst_beslis en goedkeuring_annuleer
--  draaien als eigenaar en het Drive-script als service_role — die gaan hier gewoon door)
-- Met een gewone login (app/API) kan enkel nog: een nieuw voorstel 'open' aanmaken, een open voorstel intrekken, titel/toelichting/
-- termijn aanpassen en een open of ingetrokken voorstel verwijderen. Een goedgekeurd, geweigerd of geannuleerd voorstel blijft bewaard.
create or replace function public.goedkeuring_status_vast()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    -- (een project verwijderen ruimt zijn voorstellen op via de cascade: die loopt dieper dan 1 trigger)
    if pg_trigger_depth() = 1 and old.status in ('akkoord', 'geweigerd', 'geannuleerd') then
      raise exception 'Over dit voorstel werd al beslist: het blijft bewaard als historiek (een goedgekeurd voorstel kan je annuleren).';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'open' or new.geannuleerd_op is not null or new.beslist_op is not null then raise exception 'Een nieuw voorstel staat altijd eerst open.'; end if;
    return new;
  end if;
  if new.status is distinct from old.status and not (old.status = 'open' and new.status = 'ingetrokken') then
    raise exception 'De status van een voorstel wijzigt enkel door de klant (goedkeuren/weigeren), door intrekken of met de knop Annuleren (dan springen de posten mee terug).';
  end if;
  if (new.beslist_op, new.beslist_door, new.beslist_naam, new.beslist_email, new.opmerking) is distinct from (old.beslist_op, old.beslist_door, old.beslist_naam, old.beslist_email, old.opmerking) then
    raise exception 'De beslissing van de klant kan niet gewijzigd worden.';
  end if;
  if (new.geannuleerd_op, new.geannuleerd_door, new.annuleer_reden) is distinct from (old.geannuleerd_op, old.geannuleerd_door, old.annuleer_reden) then
    raise exception 'De annulering van een voorstel kan niet gewijzigd worden.';
  end if;
  if old.status <> 'open' and new.posten::text is distinct from old.posten::text then
    raise exception 'De posten van een beslist voorstel liggen vast.';
  end if;
  return new;
end $$;
drop trigger if exists goedkeuring_status_vast on public.goedkeuringen;
create trigger goedkeuring_status_vast before insert or update or delete on public.goedkeuringen for each row execute function public.goedkeuring_status_vast();

-- ---------- 4. financiële planning: project zelf in/uit zetten (enkel beheer, RLS van script 049) ----------
alter table public.fin_plan add column if not exists meetellen boolean not null default true;

-- ---------- 5. wat de klant ziet (zelfde kolommen als script 039, met de annulering erbij) ----------
create or replace view public.klant_goedkeuringen as
  select g.id, g.project_id, g.soort, g.titel, g.toelichting, g.status, g.posten, g.totaal_excl, g.btw, g.totaal_incl,
         g.voorgelegd_op, g.geldig_tot, p.name as voorgelegd_door_naam, g.beslist_op, g.beslist_naam, g.opmerking,
         g.bestand_path, g.bestand_naam, g.bestand_sha256, g.bestand_grootte, g.getekend_document,
         g.geannuleerd_op, g.annuleer_reden
  from public.goedkeuringen g left join public.profiles p on p.id = g.voorgelegd_door
  where g.project_id in (select public.klant_projecten());

-- ---------- rechten (zoals 049) ----------
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
revoke all on function public.werfpunt_antwoord() from public, anon, authenticated;
revoke all on function public.pb_gebruik() from public, anon, authenticated;
grant execute on function public.pb_gebruik() to service_role;
revoke all on function public.aannemer_factuur_status() from public, anon, authenticated;
revoke all on function public.aannemerfacturen_aantal(text) from public, anon;
revoke all on public.aannemer_hulp from anon;
revoke insert, update, delete, truncate, references, trigger on public.aannemer_hulp from authenticated;
revoke all on function public.vordering_betaald_op() from public, anon, authenticated;
revoke all on function public.betaalherinnering_bewaken() from public, anon, authenticated;
revoke all on function public.goedkeuring_status_vast() from public, anon, authenticated;
revoke all on function public.goedkeuring_annuleer(uuid, text) from public, anon;
grant execute on function public.goedkeuring_annuleer(uuid, text) to authenticated;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(50, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: moet 1 | 1 | 1 | 1 teruggeven (status toegelaten, functie aanwezig, bewaking actief, kolom meetellen)
select (select count(*) from pg_constraint where conname = 'goedkeuringen_status_check' and pg_get_constraintdef(oid) ~ 'geannuleerd')::int as status_ok,
       (select count(*) from pg_proc where proname = 'goedkeuring_annuleer')::int as functie,
       (select count(*) from pg_trigger where tgname = 'goedkeuring_status_vast')::int as bewaking,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'fin_plan' and column_name = 'meetellen')::int as meetellen;
