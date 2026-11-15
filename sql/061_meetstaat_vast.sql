-- =====================================================================
--  BROS Planbord — databasescript 061: goedgekeurde meetstaat ligt vast (v1.65)
--  Een post die de klant goedkeurde via de akkoord-knop in het portaal (offerte, meerwerkvoorstel, overeenkomst of
--  een keuze; herkenbaar aan meetstaat_posten.akkoord_op) ligt vast:
--    · niemand kan nog omschrijving, locatie, hoeveelheid, eenheid, prijstype, btw, lot, nummer of status wijzigen,
--      de klantprijs veranderen of de post verwijderen — ook niet rechtstreeks via de databank;
--    · wat intern is, blijft vrij: kostprijs (de marge wordt herrekend zodat de klantprijs exact blijft), vakman,
--      bestellen/leveren, leverancier, artikelnr., interne opmerking, volgorde en groep;
--    · een andere standaardmarge van een lot verandert de klantprijs van vastgelegde posten niet meer.
--  Is de offerte (of een overeenkomst met posten) goedgekeurd, dan is de meetstaat van het project 'vast':
--    · een nieuwe post is meerwerk of minwerk (geen offerte/akkoord meer), een nieuw voorstel is een meerwerkvoorstel;
--    · meetstaat_wijziging(post, soort, hoeveelheid, omschrijving) maakt de meer-/minwerkpost voor het verschil
--      (soort 'hoeveelheid', 'schrappen' of 'vervangen'), met dezelfde klantprijs en een verwijzing naar de originele post
--      (meetstaat_posten.herkomst_post_id; herkomst_soort zegt welke wijziging — 'nieuw' = de vervangende post).
--  Posten die met de hand op 'akkoord' staan (zonder goedkeuring in het portaal) blijven aanpasbaar zoals voorheen.
--  De enige weg terug: het goedgekeurde voorstel annuleren (enkel beheer, script 050) of een keuze heropenen (keuze_heropenen).
--  Ook de functies van prijsvragen en aannemers veranderen de klantprijs van een goedgekeurde post niet meer.
--  Keurt de klant een offerte goed, dan worden andere open offertevoorstellen van dat project ingetrokken.
--  Vereist schema 60. Alleen toevoegingen; mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 60 then
    raise exception 'Voer eerst de scripts tot en met 060 uit.';
  end if;
end $$;

alter table public.meetstaat_posten add column if not exists herkomst_post_id uuid references public.meetstaat_posten(id) on delete set null;
alter table public.meetstaat_posten add column if not exists herkomst_soort text;   -- 'hoeveelheid' | 'schrappen' | 'vervangen' (minwerk) | 'nieuw' (de vervangende post)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'meetstaat_posten_herkomst_soort_check') then
    alter table public.meetstaat_posten add constraint meetstaat_posten_herkomst_soort_check check (herkomst_soort is null or herkomst_soort in ('hoeveelheid', 'schrappen', 'vervangen', 'nieuw'));
  end if;
end $$;
create index if not exists meetstaat_posten_herkomst_idx on public.meetstaat_posten(herkomst_post_id) where herkomst_post_id is not null;

-- view van het team: de nieuwe kolommen achteraan (zelfde definitie als scripts 033 + 045)
create or replace view public.meetstaat_posten_v as
  select m.id, m.project_id, m.post_id, m.lot, m.code, m.groep, m.omschrijving, m.locatie, m.eenheid, m.prijstype, m.hoeveelheid,
         m.btw, m.status, m.vakman, m.te_bestellen, m.besteld, m.leverdatum, m.geleverd, m.leverancier, m.artikelnr, m.opmerking,
         m.volgorde, m.created_by, m.created_at, m.updated_at, m.akkoord_op, m.akkoord_goedkeuring,
         case when (select public.is_beheer()) then pr.eenheidsprijs else null::numeric end as eenheidsprijs,
         case when (select public.is_beheer()) then pr.marge else null::numeric end as marge,
         round(coalesce(pr.eenheidsprijs, 0) * (1 + coalesce(pr.marge, l.marge, 0)), 2) as verkoop_ep,
         m.herkomst_post_id, m.herkomst_soort
  from public.meetstaat_posten m
  left join public.meetstaat_prijzen pr on pr.post_id = m.id
  join public.loten l on l.nr = m.lot
  where (select public.is_intern());   -- rolcontrole één keer per opvraging (zoals script 045)

-- ---------- is de meetstaat van een project goedgekeurd? (offerte of overeenkomst met posten) ----------
create or replace function public.meetstaat_is_vast(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_intern() and exists (
    select 1 from public.goedkeuringen g
     where g.project_id = p_project and g.status = 'akkoord' and g.soort in ('offerte', 'overeenkomst')
       and jsonb_typeof(g.posten) = 'array' and jsonb_array_length(g.posten) > 0);
$$;

-- ---------- 1. posten: vastgelegd = niet meer te wijzigen of te verwijderen ----------
-- security invoker: current_user = 'authenticated' bij wie via de app/API schrijft; de functies van het portaal, annuleren
-- (script 050) en meetstaat_wijziging draaien als eigenaar en gaan gewoon door.
create or replace function public.meetstaat_post_vast()
returns trigger language plpgsql set search_path = public as $$
declare app boolean := current_user in ('authenticated', 'anon');
begin
  if not app then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then
    if new.akkoord_op is not null or new.akkoord_goedkeuring is not null then
      raise exception 'Een post wordt enkel goedgekeurd door de klant (akkoord-knop in het portaal).';
    end if;
    if new.herkomst_post_id is not null or new.herkomst_soort is not null then
      raise exception 'Meer- en minwerk op een goedgekeurde post maak je met de knop ± op die post.';
    end if;
    if new.status in ('offerte', 'akkoord') and public.meetstaat_is_vast(new.project_id) then
      raise exception 'De meetstaat van dit project is goedgekeurd door de klant: een nieuwe post is meerwerk of minwerk.';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    -- (een project verwijderen ruimt zijn meetstaat op via de cascade: die loopt dieper dan 1 trigger)
    if old.akkoord_op is not null and pg_trigger_depth() = 1 then   -- (een keuze heropenen gaat via keuze_heropenen)
      raise exception 'Post % is goedgekeurd door de klant en ligt vast. Schrappen kan via minwerk (knop ± op de post).', old.code;
    end if;
    return old;
  end if;
  if (new.akkoord_op, new.akkoord_goedkeuring) is distinct from (old.akkoord_op, old.akkoord_goedkeuring) then
    raise exception 'Het akkoord van de klant wijzigt enkel via het portaal, of met Annuleren bij het goedgekeurde voorstel.';
  end if;
  if (new.herkomst_post_id, new.herkomst_soort) is distinct from (old.herkomst_post_id, old.herkomst_soort) then
    raise exception 'De verwijzing naar de originele post ligt vast.';
  end if;
  if old.akkoord_op is not null
     and (new.project_id, new.lot, new.code, new.omschrijving, new.locatie, new.eenheid, new.prijstype, new.hoeveelheid, new.btw, new.status)
         is distinct from (old.project_id, old.lot, old.code, old.omschrijving, old.locatie, old.eenheid, old.prijstype, old.hoeveelheid, old.btw, old.status) then
    raise exception 'Post % is goedgekeurd door de klant en ligt vast. Een wijziging gaat via meer- of minwerk (knop ± op de post).', old.code;
  end if;
  if old.akkoord_op is null and new.status is distinct from old.status and new.status in ('offerte', 'akkoord') and public.meetstaat_is_vast(new.project_id) then
    raise exception 'De meetstaat van dit project is goedgekeurd door de klant: zet deze post op meerwerk of minwerk.';
  end if;
  return new;
end $$;
drop trigger if exists meetstaat_post_vast on public.meetstaat_posten;
create trigger meetstaat_post_vast before insert or update or delete on public.meetstaat_posten
  for each row execute function public.meetstaat_post_vast();

-- ---------- 2. prijzen: de klantprijs van een vastgelegde post verandert niet (kostprijs mag, marge wordt herrekend) ----------
create or replace function public.meetstaat_prijs_vast()
returns trigger language plpgsql set search_path = public as $$
-- Geldt voor iedereen (ook de functies van prijsvragen en aannemers): de klantprijs van een post die in een vorige transactie
-- goedgekeurd werd, verandert niet. (akkoord_op = now(): net in deze transactie goedgekeurd/aangemaakt, bv. een keuze uit het portaal.)
declare app boolean := current_user in ('authenticated', 'anon'); m record; m2 record; ep_oud numeric; ep_nieuw numeric;
begin
  select p.akkoord_op, p.code, l.marge as lotmarge into m
    from public.meetstaat_posten p join public.loten l on l.nr = p.lot where p.id = coalesce(old.post_id, new.post_id);
  if tg_op = 'UPDATE' and new.post_id is distinct from old.post_id then
    select p.akkoord_op, p.code into m2 from public.meetstaat_posten p where p.id = new.post_id;
    if m.akkoord_op is not null or m2.akkoord_op is not null then
      raise exception 'De prijs van post % ligt vast (goedgekeurd door de klant).', coalesce(m.code, m2.code);
    end if;
    return new;
  end if;
  if m.akkoord_op is null or m.akkoord_op >= now() then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if app and pg_trigger_depth() = 1 then raise exception 'De prijs van post % ligt vast (goedgekeurd door de klant).', m.code; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then raise exception 'De prijs van post % ligt vast (goedgekeurd door de klant).', m.code; end if;
  ep_oud := round(coalesce(old.eenheidsprijs, 0) * (1 + coalesce(old.marge, m.lotmarge, 0)), 2);
  ep_nieuw := round(coalesce(new.eenheidsprijs, 0) * (1 + coalesce(new.marge, m.lotmarge, 0)), 2);
  if ep_nieuw <> ep_oud then
    raise exception 'Post % is goedgekeurd aan % per eenheid: die klantprijs ligt vast. Een andere kostprijs kan (de marge wordt herrekend); een andere klantprijs gaat via meer- of minwerk.', m.code, to_char(ep_oud, 'FM999G999G990D00');
  end if;
  return new;
end $$;
drop trigger if exists meetstaat_prijs_vast on public.meetstaat_prijzen;
create trigger meetstaat_prijs_vast before insert or update or delete on public.meetstaat_prijzen
  for each row execute function public.meetstaat_prijs_vast();

-- ---------- 3. standaardmarge van een lot wijzigen: vastgelegde posten houden hun klantprijs ----------
create or replace function public.lot_marge_vastleggen()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.marge is distinct from old.marge then
    update public.meetstaat_prijzen pr set marge = old.marge
      from public.meetstaat_posten p
     where p.id = pr.post_id and p.lot = new.nr and p.akkoord_op is not null and pr.marge is null;
  end if;
  return new;
end $$;
drop trigger if exists loten_marge_vastleggen on public.loten;
create trigger loten_marge_vastleggen before update of marge on public.loten
  for each row execute function public.lot_marge_vastleggen();

-- ---------- 4. na een goedgekeurde offerte: enkel nog meerwerkvoorstellen ----------
create or replace function public.goedkeuring_meetstaat_vast()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'UPDATE' and old.status <> 'open' and (new.soort, new.project_id) is distinct from (old.soort, old.project_id) then
    raise exception 'Over dit voorstel werd al beslist: soort en project liggen vast.';
  end if;
  if new.soort = 'offerte' and (tg_op = 'INSERT' or (new.soort, new.project_id) is distinct from (old.soort, old.project_id))
     and public.meetstaat_is_vast(new.project_id) then
    raise exception 'De meetstaat van dit project is al goedgekeurd door de klant: leg wijzigingen voor als meerwerkvoorstel.';
  end if;
  return new;
end $$;
drop trigger if exists goedkeuring_meetstaat_vast on public.goedkeuringen;
create trigger goedkeuring_meetstaat_vast before insert or update of soort, project_id on public.goedkeuringen
  for each row execute function public.goedkeuring_meetstaat_vast();

-- een offerte (of overeenkomst met posten) goedgekeurd → andere open offertevoorstellen van dat project worden ingetrokken
create or replace function public.goedkeuring_andere_offertes_in()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'akkoord' and old.status is distinct from 'akkoord' and new.soort in ('offerte', 'overeenkomst')
     and jsonb_typeof(new.posten) = 'array' and jsonb_array_length(new.posten) > 0 then
    update public.goedkeuringen set status = 'ingetrokken'
     where project_id = new.project_id and soort = 'offerte' and status = 'open' and id <> new.id;
  end if;
  return null;
end $$;
drop trigger if exists goedkeuring_andere_offertes_in on public.goedkeuringen;
create trigger goedkeuring_andere_offertes_in after update of status on public.goedkeuringen
  for each row execute function public.goedkeuring_andere_offertes_in();

-- ---------- 5. meer-/minwerk op een vastgelegde post ----------
drop function if exists public.ms_wijziging_regel(public.meetstaat_posten, text, numeric, text, text, numeric, numeric);
create or replace function public.ms_wijziging_regel(p_o public.meetstaat_posten, p_soort text, p_status text, p_hoev numeric, p_oms text, p_opm text, p_kost numeric, p_marge numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; n int;
begin
  select coalesce(max((regexp_match(code, '-M(\d+)$'))[1]::int), 0) + 1 into n from public.meetstaat_posten where herkomst_post_id = p_o.id;
  insert into public.meetstaat_posten (project_id, post_id, lot, code, groep, omschrijving, locatie, eenheid, prijstype, hoeveelheid, btw, status,
                                       vakman, leverancier, artikelnr, opmerking, volgorde, created_by, herkomst_post_id, herkomst_soort)
  values (p_o.project_id, p_o.post_id, p_o.lot, left(coalesce(nullif(p_o.code, ''), 'post') || '-M' || n, 40), p_o.groep, left(p_oms, 2000), p_o.locatie,
          p_o.eenheid, p_o.prijstype, p_hoev, p_o.btw, p_status, p_o.vakman, p_o.leverancier, p_o.artikelnr, left(p_opm, 2000), p_o.volgorde, auth.uid(), p_o.id, p_soort)
  returning id into v_id;
  insert into public.meetstaat_prijzen (post_id, eenheidsprijs, marge) values (v_id, coalesce(p_kost, 0), p_marge)
    on conflict (post_id) do update set eenheidsprijs = excluded.eenheidsprijs, marge = excluded.marge;
  return v_id;
end $$;

create or replace function public.meetstaat_wijziging(p_post uuid, p_soort text, p_hoeveelheid numeric default null, p_omschrijving text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.meetstaat_posten; pr public.meetstaat_prijzen; v_lotmarge numeric; v_marge numeric; eff numeric; d numeric;
        ids uuid[] := '{}'; v_opm text; v_oms text;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  select * into o from public.meetstaat_posten where id = p_post for update;
  if o.id is null then raise exception 'Post niet gevonden.'; end if;
  if o.akkoord_op is null then raise exception 'Post % is nog niet goedgekeurd door de klant: pas hem gewoon aan in de meetstaat.', o.code; end if;
  if o.status not in ('akkoord', 'meerwerk') then raise exception 'Enkel een goedgekeurde offerte- of meerwerkpost kan je via meer- of minwerk wijzigen.'; end if;
  if p_soort not in ('hoeveelheid', 'schrappen', 'vervangen') then raise exception 'Onbekende wijziging.'; end if;
  -- huidige hoeveelheid = goedgekeurd + eerdere meer- en minwerken op deze post (vervallen en een vervangende post tellen niet)
  select o.hoeveelheid + coalesce(sum(case when c.status = 'meerwerk' then c.hoeveelheid when c.status = 'minwerk' then -abs(c.hoeveelheid) else 0 end), 0)
    into eff from public.meetstaat_posten c where c.herkomst_post_id = o.id and c.status <> 'vervallen' and coalesce(c.herkomst_soort, '') <> 'nieuw';
  select * into pr from public.meetstaat_prijzen where post_id = o.id;
  select marge into v_lotmarge from public.loten where nr = o.lot;
  v_marge := coalesce(pr.marge, v_lotmarge, 0);   -- vast op de marge van vandaag: dezelfde klantprijs als de goedgekeurde post
  v_opm := 'Op post ' || o.code || ' (goedgekeurd ' || to_char(o.akkoord_op at time zone 'Europe/Brussels', 'DD/MM/YYYY') || ')';
  if p_soort = 'hoeveelheid' then
    if p_hoeveelheid is null or p_hoeveelheid < 0 then raise exception 'Geef de nieuwe hoeveelheid (0 of meer).'; end if;
    d := round(p_hoeveelheid - eff, 3);
    if d = 0 then raise exception 'Dat is de huidige hoeveelheid (%).', eff; end if;
    ids := ids || public.ms_wijziging_regel(o, 'hoeveelheid', case when d > 0 then 'meerwerk' else 'minwerk' end, abs(d), o.omschrijving,
                                           (case when d > 0 then 'Meerwerk: ' else 'Minwerk: ' end) || v_opm || ', van ' || eff || ' naar ' || p_hoeveelheid || ' ' || o.eenheid, pr.eenheidsprijs, v_marge);
  elsif p_soort = 'schrappen' then
    if eff <= 0 then raise exception 'Post % is al volledig geschrapt.', o.code; end if;
    ids := ids || public.ms_wijziging_regel(o, 'schrappen', 'minwerk', eff, o.omschrijving, 'Geschrapt: ' || v_opm, pr.eenheidsprijs, v_marge);
  else
    if exists (select 1 from public.meetstaat_posten c where c.herkomst_post_id = o.id and c.herkomst_soort = 'nieuw' and c.status <> 'vervallen') then
      raise exception 'Post % is al vervangen. Pas de vervangende post aan, of zet die eerst op vervallen.', o.code;
    end if;
    v_oms := coalesce(nullif(btrim(coalesce(p_omschrijving, '')), ''), o.omschrijving);
    if p_hoeveelheid is not null and p_hoeveelheid <= 0 then raise exception 'Geef de hoeveelheid van de nieuwe post.'; end if;
    if eff > 0 then ids := ids || public.ms_wijziging_regel(o, 'vervangen', 'minwerk', eff, o.omschrijving, 'Vervangen: ' || v_opm, pr.eenheidsprijs, v_marge); end if;
    ids := ids || public.ms_wijziging_regel(o, 'nieuw', 'meerwerk', coalesce(p_hoeveelheid, nullif(eff, 0), o.hoeveelheid), v_oms,
                                           'Vervangt ' || v_opm || ' — prijs nakijken', pr.eenheidsprijs, v_marge);
  end if;
  return jsonb_build_object('ids', to_jsonb(ids), 'hoeveelheid_voor', eff);
end $$;

-- ---------- 6. een keuze uit het portaal heropenen: de (goedgekeurde) keuzepost gaat mee weg, in één keer ----------
create or replace function public.keuze_heropenen(p_keuze uuid)
returns public.keuzes language plpgsql security definer set search_path = public as $$
declare k public.keuzes; v_post public.meetstaat_posten;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  select * into k from public.keuzes where id = p_keuze for update;
  if k.id is null then raise exception 'Keuze niet gevonden.'; end if;
  select * into v_post from public.meetstaat_posten where id = k.meerwerk_post for update;
  if v_post.id is not null then
    if exists (select 1 from public.vordering_regels r where r.post_id = v_post.id) then
      raise exception 'De post % uit deze keuze staat al in een vordering: heropenen kan niet automatisch. Maak een minwerk (± op de post).', v_post.code;
    end if;
    if exists (select 1 from public.meetstaat_posten c where c.herkomst_post_id = v_post.id) then
      raise exception 'Op de post % uit deze keuze staan al meer- of minwerken: heropenen kan niet automatisch.', v_post.code;
    end if;
  end if;
  update public.keuzes set status = 'open', gekozen_optie = null, gekozen_op = null, gekozen_naam = '', gekozen_door = null, gekozen_opmerking = '', meerwerk_post = null
   where id = k.id returning * into k;
  if v_post.id is not null then delete from public.meetstaat_posten where id = v_post.id; end if;
  return k;
end $$;

-- rechten: bewust geen rechten_herstellen() (zie script 060)
do $$ declare f text; begin
  foreach f in array array['meetstaat_post_vast()', 'meetstaat_prijs_vast()', 'lot_marge_vastleggen()', 'goedkeuring_meetstaat_vast()', 'goedkeuring_andere_offertes_in()',
                           'ms_wijziging_regel(public.meetstaat_posten, text, text, numeric, text, text, numeric, numeric)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
  end loop;
  -- door de triggers (als de gebruiker) en de app opgeroepen
  revoke all on function public.meetstaat_is_vast(uuid) from public, anon;
  grant execute on function public.meetstaat_is_vast(uuid) to authenticated;
  revoke all on function public.meetstaat_wijziging(uuid, text, numeric, text) from public, anon;
  grant execute on function public.meetstaat_wijziging(uuid, text, numeric, text) to authenticated;
  revoke all on function public.keuze_heropenen(uuid) from public, anon;
  grant execute on function public.keuze_heropenen(uuid) to authenticated;
end $$;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(61, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: geeft 2 | 4 | 5 | 61 terug (nieuwe kolommen, functies, triggers, schemaversie)
-- plus het aantal goedgekeurde posten dat vanaf nu vastligt.
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'meetstaat_posten' and column_name in ('herkomst_post_id', 'herkomst_soort'))::int as kolommen,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('meetstaat_is_vast', 'meetstaat_wijziging', 'ms_wijziging_regel', 'keuze_heropenen'))::int as functies,
       (select count(*) from pg_trigger where tgname in ('meetstaat_post_vast', 'meetstaat_prijs_vast', 'loten_marge_vastleggen', 'goedkeuring_meetstaat_vast', 'goedkeuring_andere_offertes_in'))::int as triggers,
       (select (value->>'versie_schema')::int from public.instellingen where key = 'app') as schema,
       (select count(*) from public.meetstaat_posten where akkoord_op is not null)::int as vastgelegde_posten;
