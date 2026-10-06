-- =====================================================================
--  BROS Planbord — databasescript 033: prijzen en facturatie nagekeken (v1.34)
--  1. Klantprijs overal op dezelfde manier: eenheidsprijs afgerond op de cent, totaal = hoeveelheid × die eenheidsprijs
--     (afgerond op de cent) — in het Planbord (meetstaat_posten_v) én het klantenportaal (klant_meetstaat).
--  2. Nauwkeuriger opslag: marge per post met 8 decimalen (een herrekende marge houdt de klantprijs op de cent),
--     percentages van vorderingen met 9 decimalen (een factuur op bedrag komt exact uit).
--  3. Iedereen ziet prijswijzigingen live: een wijziging van een kostprijs/marge (meetstaat_prijzen) of van de
--     standaardmarge van een lot raakt de betrokken meetstaatposten aan → realtime-melding ook voor medewerkers.
--  4. Vorderingen: btw van een verstuurde factuur wordt bewaard (btw_bedrag) i.p.v. herrekend; het klantenportaal
--     krijgt enkel verstuurde/betaalde facturen (geen ontwerpen meer via de databank).
--  5. Goedgekeurde posten (akkoord / meerwerk / minwerk) houden hun klantprijs bij 'prijzen overnemen' uit een
--     prijsaanvraag; de marge wordt herrekend.
--  6. Akkoord van de aannemer (script 032): posten die na het delen gewijzigd zijn of geen klantprijs hebben,
--     worden niet overschreven (lijst in niet_toegepast); klantprijs exact behouden.
--  7. Akkoord van de klant zet geen 'akkoord' meer op vervallen posten.
--  8. Controle: marge tussen −100 % en +1000 %.
--  9. Verzonden/betaalde vordering: factuurbedrag en btw worden in de databank bevroren (ook via de Yuki-koppeling);
--     bestaande verstuurde facturen krijgen hun btw van vandaag.
-- 10. Delen met een aannemer krijgt het tijdstip van de databank.
--  Vereist schema 32. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 32 then
    raise exception 'Voer eerst de scripts tot en met 032 uit.';
  end if;
end $$;

-- ---------- 1+2. views even weg, kolommen nauwkeuriger, views opnieuw ----------
drop view if exists public.meetstaat_posten_v;
drop view if exists public.klant_meetstaat;
drop view if exists public.klant_vordering_regels;
drop view if exists public.klant_vorderingen;

alter table public.meetstaat_prijzen alter column marge type numeric(12,8);
alter table public.vordering_regels alter column pct type numeric(12,9);
alter table public.vorderingen add column if not exists btw_bedrag numeric(12,2);   -- bevroren btw van een verstuurde factuur
alter table public.aannemer_meetstaten add column if not exists niet_toegepast jsonb not null default '[]'::jsonb;

create view public.meetstaat_posten_v as
  select m.id, m.project_id, m.post_id, m.lot, m.code, m.groep, m.omschrijving, m.locatie, m.eenheid, m.prijstype, m.hoeveelheid,
         m.btw, m.status, m.vakman, m.te_bestellen, m.besteld, m.leverdatum, m.geleverd, m.leverancier, m.artikelnr, m.opmerking,
         m.volgorde, m.created_by, m.created_at, m.updated_at, m.akkoord_op, m.akkoord_goedkeuring,
         case when public.is_beheer() then pr.eenheidsprijs else null::numeric end as eenheidsprijs,
         case when public.is_beheer() then pr.marge else null::numeric end as marge,
         round(coalesce(pr.eenheidsprijs, 0) * (1 + coalesce(pr.marge, l.marge, 0)), 2) as verkoop_ep
  from public.meetstaat_posten m
  left join public.meetstaat_prijzen pr on pr.post_id = m.id
  join public.loten l on l.nr = m.lot
  where public.is_intern();

create view public.klant_meetstaat as
  select m.id, m.project_id, m.lot, m.code, m.groep, m.omschrijving, m.locatie, m.eenheid, m.prijstype, m.hoeveelheid,
         round(coalesce(pr.eenheidsprijs, 0) * (1 + coalesce(pr.marge, l.marge, 0)), 2) as prijs,
         round(m.hoeveelheid * round(coalesce(pr.eenheidsprijs, 0) * (1 + coalesce(pr.marge, l.marge, 0)), 2), 2) as totaal,
         m.btw, m.status, m.volgorde, m.leverdatum, m.geleverd, m.akkoord_op
  from public.meetstaat_posten m
  left join public.meetstaat_prijzen pr on pr.post_id = m.id
  join public.loten l on l.nr = m.lot
  where m.project_id in (select public.klant_projecten());

create view public.klant_vorderingen as
  select v.id, v.project_id, v.nr, v.soort, v.omschrijving, v.datum, v.factuurnummer, v.bedrag_excl, v.status, v.btw_bedrag
  from public.vorderingen v
  where v.status <> 'opgemaakt' and v.project_id in (select public.klant_projecten());

create view public.klant_vordering_regels as
  select r.id, r.vordering_id, r.lot, r.post_id, r.pct
  from public.vordering_regels r
  join public.vorderingen v on v.id = r.vordering_id
  where v.status <> 'opgemaakt' and v.project_id in (select public.klant_projecten());

-- ---------- 3. prijswijziging → meetstaatpost aanraken (realtime voor iedereen) ----------
create or replace function public.meetstaat_prijs_aanraken()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now(); return new;
end $$;
create or replace function public.meetstaat_prijs_na()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.meetstaat_posten set updated_at = now() where id = coalesce(new.post_id, old.post_id);
  return null;
end $$;
drop trigger if exists meetstaat_prijzen_touch on public.meetstaat_prijzen;
create trigger meetstaat_prijzen_touch before update on public.meetstaat_prijzen for each row execute function public.meetstaat_prijs_aanraken();
drop trigger if exists meetstaat_prijzen_melding on public.meetstaat_prijzen;
create trigger meetstaat_prijzen_melding after insert or update or delete on public.meetstaat_prijzen for each row execute function public.meetstaat_prijs_na();

create or replace function public.lot_marge_aanraken()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.marge is distinct from old.marge then
    update public.meetstaat_posten m set updated_at = now()
     where m.lot = new.nr and not exists (select 1 from public.meetstaat_prijzen p where p.post_id = m.id and p.marge is not null);
  end if;
  return null;
end $$;
drop trigger if exists loten_marge_melding on public.loten;
create trigger loten_marge_melding after update on public.loten for each row execute function public.lot_marge_aanraken();

-- ---------- 5. prijzen overnemen uit een prijsaanvraag: goedgekeurde posten houden hun klantprijs ----------
create or replace function public.prijsaanvraag_overnemen(p_id uuid, p_posten uuid[] default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; r record; v numeric; m numeric;
begin
  if not public.is_beheer() then raise exception 'Alleen een beheerder kan prijzen overnemen.'; end if;
  for r in select pr.post_id, pr.eenheidsprijs, mp.status
             from public.prijsaanvraag_regels pr join public.meetstaat_posten mp on mp.id = pr.post_id
            where pr.aanvraag_id = p_id and pr.eenheidsprijs is not null and (p_posten is null or pr.post_id = any (p_posten)) loop
    m := null;
    if r.status in ('akkoord', 'meerwerk', 'minwerk') and r.eenheidsprijs > 0 then
      select round(coalesce(p.eenheidsprijs, 0) * (1 + coalesce(p.marge, l.marge, 0)), 2) into v
        from public.meetstaat_posten x join public.loten l on l.nr = x.lot left join public.meetstaat_prijzen p on p.post_id = x.id where x.id = r.post_id;
      if coalesce(v, 0) > 0 then m := round(v / r.eenheidsprijs - 1, 8); if m < -1 or m > 10 then m := null; end if; end if;
    end if;
    insert into public.meetstaat_prijzen (post_id, eenheidsprijs, marge) values (r.post_id, r.eenheidsprijs, m)
      on conflict (post_id) do update set eenheidsprijs = excluded.eenheidsprijs,
        marge = case when excluded.marge is not null then excluded.marge else public.meetstaat_prijzen.marge end, updated_at = now();
    n := n + 1;
  end loop;
  update public.prijsaanvragen set status = 'gekozen', gekozen_op = now(), updated_at = now() where id = p_id;
  return n;
end $$;

-- ---------- 6. akkoord van de aannemer: veilig toepassen ----------
create or replace function public.aannemer_mp_beslis(p_id uuid, p_versie int, p_akkoord boolean, p_naam text, p_opmerking text)
returns public.aannemer_meetstaten language plpgsql security definer set search_path = public as $$
declare a public.aannemer_meetstaten; r jsonb; pr numeric; v numeric; m numeric; n int := 0; nt jsonb := '[]'::jsonb; gewijzigd timestamptz;
begin
  select * into a from public.aannemer_meetstaten
   where id = p_id and gedeeld and contact_id in (select public.mijn_contacten()) and project_id in (select public.aannemer_projecten())
   for update;
  if a.id is null then raise exception 'Deze meetstaat is niet (meer) met jou gedeeld.'; end if;
  if a.versie <> p_versie then raise exception 'BROS heeft intussen een nieuwe versie gedeeld — herlaad de pagina.'; end if;
  if a.status not in ('gedeeld', 'tegenvoorstel') then raise exception 'Deze versie is al goedgekeurd.'; end if;
  if length(trim(coalesce(p_naam, ''))) < 2 then raise exception 'Vul je naam in.'; end if;
  if p_akkoord then
    if exists (select 1 from jsonb_each(a.reactie) e where e.value->>'tegenprijs' is not null) then
      raise exception 'Je hebt nog tegenvoorstellen staan: dien ze in als tegenvoorstel, of haal ze weg om akkoord te gaan.';
    end if;
    for r in select * from jsonb_array_elements(a.regels) loop
      pr := nullif(r->>'prijs', '')::numeric; if pr is null or pr <= 0 then continue; end if;
      if not exists (select 1 from public.meetstaat_posten x where x.id = (r->>'post_id')::uuid and x.project_id = a.project_id) then continue; end if;
      select round(coalesce(p.eenheidsprijs, 0) * (1 + coalesce(p.marge, l.marge, 0)), 2), p.updated_at into v, gewijzigd
        from public.meetstaat_posten x join public.loten l on l.nr = x.lot left join public.meetstaat_prijzen p on p.post_id = x.id
       where x.id = (r->>'post_id')::uuid;
      -- niet overschrijven: prijs/marge na het delen gewijzigd, geen klantprijs, of een onmogelijke marge
      if (gewijzigd is not null and a.gedeeld_op is not null and gewijzigd > a.gedeeld_op) or coalesce(v, 0) <= 0 then
        nt := nt || jsonb_build_array(r->>'post_id'); continue;
      end if;
      m := round(v / pr - 1, 8);
      if m < -1 or m > 10 then nt := nt || jsonb_build_array(r->>'post_id'); continue; end if;
      insert into public.meetstaat_prijzen (post_id, eenheidsprijs, marge) values ((r->>'post_id')::uuid, pr, m)
        on conflict (post_id) do update set eenheidsprijs = excluded.eenheidsprijs, marge = excluded.marge;
      n := n + 1;
    end loop;
    update public.aannemer_meetstaten set status = 'akkoord', beslist_op = now(), beslist_naam = left(trim(p_naam), 120), beslist_door = auth.uid(),
      opmerking = left(trim(coalesce(p_opmerking, '')), 2000), toegepast_op = case when n > 0 then now() else toegepast_op end, niet_toegepast = nt
     where id = a.id returning * into a;
  else
    if not exists (select 1 from jsonb_each(a.reactie)) and length(trim(coalesce(p_opmerking, ''))) = 0 then
      raise exception 'Zet bij minstens één post een opmerking of tegenprijs, of schrijf een algemene opmerking.';
    end if;
    update public.aannemer_meetstaten set status = 'tegenvoorstel', beslist_op = now(), beslist_naam = left(trim(p_naam), 120), beslist_door = auth.uid(),
      opmerking = left(trim(coalesce(p_opmerking, '')), 2000)
     where id = a.id returning * into a;
  end if;
  return a;
end $$;

-- ---------- 7. akkoord van de klant: vervallen posten niet aanraken ----------
create or replace function public.goedkeuring_beslis(p_id uuid, p_akkoord boolean, p_naam text, p_opmerking text default '')
returns public.goedkeuringen language plpgsql security definer set search_path = public as $$
declare g public.goedkeuringen; r jsonb; v_email text;
begin
  select * into g from public.goedkeuringen where id = p_id for update;
  if g.id is null then raise exception 'Voorstel niet gevonden.'; end if;
  if not public.is_klant() or g.project_id not in (select public.klant_projecten()) then raise exception 'Geen toegang tot dit voorstel.'; end if;
  if g.status <> 'open' then raise exception 'Dit voorstel is al beslist.'; end if;
  if g.geldig_tot is not null and g.geldig_tot < current_date then raise exception 'De termijn voor dit voorstel is verstreken (tot %). Vraag BROS om het opnieuw voor te leggen.', to_char(g.geldig_tot, 'DD/MM/YYYY'); end if;
  select email into v_email from auth.users where id = auth.uid();
  update public.goedkeuringen
     set status = case when p_akkoord then 'akkoord' else 'geweigerd' end,
         beslist_op = now(), beslist_door = auth.uid(),
         beslist_naam = coalesce(nullif(trim(p_naam), ''), v_email, ''), beslist_email = coalesce(v_email, ''),
         opmerking = coalesce(p_opmerking, '')
   where id = p_id returning * into g;
  if p_akkoord then
    for r in select * from jsonb_array_elements(g.posten) loop
      update public.meetstaat_posten
         set akkoord_op = now(), akkoord_goedkeuring = g.id,
             status = case when status = 'offerte' then 'akkoord' else status end,
             updated_at = now()
       where id = (r->>'id')::uuid and project_id = g.project_id and status <> 'vervallen';
    end loop;
  end if;
  return g;
end $$;

-- ---------- 8. controle op de marge (bestaande rijen worden niet geblokkeerd: NOT VALID) ----------
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'meetstaat_prijzen_marge_check') then
    alter table public.meetstaat_prijzen add constraint meetstaat_prijzen_marge_check check (marge is null or (marge >= -1 and marge <= 10)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'loten_marge_check') then
    alter table public.loten add constraint loten_marge_check check (marge >= -1 and marge <= 10) not valid;
  end if;
end $$;

-- ---------- 9. vordering verzonden/betaald: factuurbedrag en btw bevriezen in de databank ----------
-- (ook als de status buiten het Planbord wijzigt, bv. via de Yuki-koppeling) — zelfde rekenregel als app.js (vordCalc):
-- per post hoeveelheid × klant-EP op de cent, minwerk altijd negatief, % van de post of anders van het lot.
create or replace function public.vordering_bevriezen()
returns trigger language plpgsql security definer set search_path = public as $$
declare e numeric; b numeric;
begin
  if new.status = 'opgemaakt' then
    if tg_op = 'UPDATE' and old.status is distinct from 'opgemaakt' then new.btw_bedrag := null; end if;
    return new;
  end if;
  if new.bedrag_excl is not null and new.btw_bedrag is not null
     and (tg_op = 'INSERT' or new.bedrag_excl is not distinct from old.bedrag_excl or new.btw_bedrag is distinct from old.btw_bedrag) then
    return new;
  end if;
  with posten as (
    select m.id, m.lot, coalesce(m.btw, 0) as btw, x.totaal * case when m.status = 'minwerk' then -sign(x.totaal) else 1 end as bedrag
      from public.meetstaat_posten m
      cross join lateral (select round(coalesce(m.hoeveelheid, 0) * round(coalesce(pr.eenheidsprijs, 0) * (1 + coalesce(pr.marge, l.marge, 0)), 2), 2) as totaal
                            from public.loten l left join public.meetstaat_prijzen pr on pr.post_id = m.id where l.nr = m.lot) x
     where m.project_id = new.project_id and m.status <> 'vervallen'
       and (m.status in ('meerwerk', 'minwerk')) = (new.soort = 'meerwerk')
  ), met_pct as (
    select p.*, coalesce((select r.pct from public.vordering_regels r where r.vordering_id = new.id and r.post_id = p.id limit 1),
                         (select r.pct from public.vordering_regels r where r.vordering_id = new.id and r.post_id is null and r.lot = p.lot limit 1)) as pct
      from posten p
  )
  select coalesce(sum(pct * bedrag), 0), coalesce(sum(pct * bedrag * btw), 0) into e, b from met_pct where pct is not null;
  if new.bedrag_excl is null then new.bedrag_excl := round(e, 2); end if;
  if new.btw_bedrag is null or (tg_op = 'UPDATE' and new.bedrag_excl is distinct from old.bedrag_excl and new.btw_bedrag is not distinct from old.btw_bedrag) then
    -- nog geen percentages (berekening € 0) maar wel een bedrag: btw leeg laten, 'Percentages herrekenen' vult ze later in
    new.btw_bedrag := case when abs(e) > 0.005 then round(b * new.bedrag_excl / e, 2) when abs(new.bedrag_excl) < 0.005 then 0 else null end;
  end if;
  return new;
end $$;
drop trigger if exists vorderingen_bevriezen on public.vorderingen;
create trigger vorderingen_bevriezen before insert or update on public.vorderingen for each row execute function public.vordering_bevriezen();
-- bestaande verstuurde/betaalde facturen: btw nu bevriezen op wat het Planbord vandaag toont
update public.vorderingen set btw_bedrag = null where status <> 'opgemaakt' and btw_bedrag is null;

-- ---------- 10. delen met een aannemer: tijdstip van de databank (niet van de computer) ----------
-- aannemer_mp_beslis vergelijkt dit met het tijdstip van prijswijzigingen; een verkeerd ingestelde klok mag daar niets aan veranderen.
create or replace function public.aannemer_meetstaat_gedeeld_op()
returns trigger language plpgsql as $$
begin
  if new.gedeeld and (tg_op = 'INSERT' or new.versie is distinct from old.versie or not old.gedeeld) then new.gedeeld_op := now(); end if;
  return new;
end $$;
drop trigger if exists aannemer_meetstaten_gedeeld_op on public.aannemer_meetstaten;
create trigger aannemer_meetstaten_gedeeld_op before insert or update on public.aannemer_meetstaten for each row execute function public.aannemer_meetstaat_gedeeld_op();


-- ---------- rechten (views alleen-lezen, niets voor anon) ----------
select public.rechten_herstellen();

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(33, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle 1: posten met een onmogelijke marge (moet 0 zijn; anders nakijken in het Planbord)
select count(*) as posten_met_onmogelijke_marge from public.meetstaat_prijzen where marge < -1 or marge > 10;
-- Controle 2: loten met een onmogelijke standaardmarge (moet 0 zijn)
select count(*) as loten_met_onmogelijke_marge from public.loten where marge < -1 or marge > 10;
