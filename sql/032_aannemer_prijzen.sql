-- =====================================================================
--  BROS Planbord — databasescript 032: meetstaat met prijzen voor de aannemer (goedkeuren)
--  - aannemer_meetstaten:       per project en per aannemer — marge (afslag op de klantprijs, standaard 10 %), status,
--                               de gedeelde momentopname (regels), zijn reactie en zijn akkoord. Alleen beheer.
--  - aannemer_meetstaat_posten: afwijkingen per post: tonen / verbergen, eigen marge of vaste aannemersprijs. Alleen beheer.
--  - aan_meetstaat_prijzen:     wat de aannemer ziet: enkel de gedeelde momentopname met ZIJN prijzen
--                               (nooit klantprijs, kostprijs of marge van BROS).
--  - aannemer_mp_reactie / aannemer_mp_beslis: de aannemer bewaart opmerkingen/tegenvoorstellen en keurt goed of dient
--    een tegenvoorstel in. Bij akkoord worden zijn prijzen de kostprijs in de meetstaat; de klantprijs blijft gelijk
--    (de marge van die posten wordt herrekend).
--  Vereist schema 31. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 31 then
    raise exception 'Voer eerst de scripts tot en met 031 uit.';
  end if;
end $$;

-- ---------- tabellen ----------
create table if not exists public.aannemer_meetstaten (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projecten(id) on delete cascade,
  contact_id    uuid not null references public.contacten(id) on delete cascade,
  marge         numeric(6,4) not null default 0.10,   -- afslag op de klantprijs: aannemersprijs = klantprijs × (1 − marge)
  bericht       text not null default '',             -- bericht van BROS bovenaan in zijn portaal
  gedeeld       boolean not null default false,
  versie        int not null default 0,                -- +1 bij elke keer delen
  status        text not null default 'concept' check (status in ('concept', 'gedeeld', 'akkoord', 'tegenvoorstel', 'ingetrokken')),
  regels        jsonb not null default '[]'::jsonb,    -- momentopname bij het delen: [{post_id, lot, code, groep, omschrijving, locatie, eenheid, prijstype, hoeveelheid, status, prijs}]
  gedeeld_op    timestamptz,
  gedeeld_door  uuid references public.profiles(id),
  reactie       jsonb not null default '{}'::jsonb,    -- van de aannemer: {post_id: {opmerking, tegenprijs}}
  opmerking     text not null default '',              -- algemene opmerking van de aannemer
  beslist_op    timestamptz,
  beslist_naam  text not null default '',
  beslist_door  uuid references public.profiles(id),
  toegepast_op  timestamptz,                           -- prijzen overgenomen als kostprijs (bij akkoord)
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (project_id, contact_id)
);
create index if not exists aannemer_meetstaten_contact_idx on public.aannemer_meetstaten(contact_id);
drop trigger if exists aannemer_meetstaten_touch on public.aannemer_meetstaten;
create trigger aannemer_meetstaten_touch before update on public.aannemer_meetstaten for each row execute function public.touch_updated_at();

create table if not exists public.aannemer_meetstaat_posten (
  id        uuid primary key default gen_random_uuid(),
  am_id     uuid not null references public.aannemer_meetstaten(id) on delete cascade,
  post_id   uuid not null references public.meetstaat_posten(id) on delete cascade,
  tonen     boolean,              -- null = standaard (zijn loten, zonder binnenschrijnwerk) · true = toch tonen · false = verbergen
  marge     numeric(6,4),         -- null = marge van de aannemer
  prijs     numeric(12,2),        -- vaste aannemersprijs (gaat voor op klantprijs − marge)
  unique (am_id, post_id)
);
create index if not exists aannemer_meetstaat_posten_am_idx on public.aannemer_meetstaat_posten(am_id);

alter table public.aannemer_meetstaten enable row level security;
alter table public.aannemer_meetstaat_posten enable row level security;
drop policy if exists am_beheer on public.aannemer_meetstaten;
create policy am_beheer on public.aannemer_meetstaten for all to authenticated using (public.is_beheer()) with check (public.is_beheer());
drop policy if exists amp_beheer on public.aannemer_meetstaat_posten;
create policy amp_beheer on public.aannemer_meetstaat_posten for all to authenticated using (public.is_beheer()) with check (public.is_beheer());
revoke all on public.aannemer_meetstaten, public.aannemer_meetstaat_posten from anon;

-- ---------- wat de aannemer ziet ----------
drop view if exists public.aan_meetstaat_prijzen;
create view public.aan_meetstaat_prijzen as
  select a.id, a.project_id, a.contact_id, a.versie, a.status, a.regels, a.bericht, a.gedeeld_op, a.reactie, a.opmerking, a.beslist_op, a.beslist_naam
  from public.aannemer_meetstaten a
  where a.gedeeld and a.contact_id in (select public.mijn_contacten()) and a.project_id in (select public.aannemer_projecten());

-- ---------- de aannemer bewaart opmerkingen en tegenvoorstellen (nog niet beslist) ----------
create or replace function public.aannemer_mp_reactie(p_id uuid, p_versie int, p_reactie jsonb, p_opmerking text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.aannemer_meetstaten; schoon jsonb := '{}'::jsonb; k text; v jsonb; tp numeric; opm text;
begin
  select * into a from public.aannemer_meetstaten
   where id = p_id and gedeeld and contact_id in (select public.mijn_contacten()) and project_id in (select public.aannemer_projecten());
  if a.id is null then raise exception 'Deze meetstaat is niet (meer) met jou gedeeld.'; end if;
  if a.versie <> p_versie then raise exception 'BROS heeft intussen een nieuwe versie gedeeld — herlaad de pagina.'; end if;
  if a.status not in ('gedeeld', 'tegenvoorstel') then raise exception 'Deze versie is al goedgekeurd.'; end if;
  -- enkel posten uit de gedeelde versie; opmerking max. 500 tekens; tegenprijs ≥ 0
  for k, v in select * from jsonb_each(coalesce(p_reactie, '{}'::jsonb)) loop
    if not exists (select 1 from jsonb_array_elements(a.regels) r where r->>'post_id' = k) then continue; end if;
    opm := left(trim(coalesce(v->>'opmerking', '')), 500);
    tp := case when jsonb_typeof(v->'tegenprijs') = 'number' and (v->>'tegenprijs')::numeric >= 0 and (v->>'tegenprijs')::numeric < 10000000 then round((v->>'tegenprijs')::numeric, 2) end;
    if opm = '' and tp is null then continue; end if;
    schoon := schoon || jsonb_build_object(k, jsonb_build_object('opmerking', opm, 'tegenprijs', tp));
  end loop;
  update public.aannemer_meetstaten set reactie = schoon, opmerking = left(trim(coalesce(p_opmerking, '')), 2000) where id = a.id;
end $$;

-- ---------- de aannemer beslist: akkoord (prijzen worden kostprijs) of tegenvoorstel ----------
create or replace function public.aannemer_mp_beslis(p_id uuid, p_versie int, p_akkoord boolean, p_naam text, p_opmerking text)
returns public.aannemer_meetstaten language plpgsql security definer set search_path = public as $$
declare a public.aannemer_meetstaten; r jsonb; pr numeric; v numeric; m numeric; n int := 0;
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
    -- prijzen overnemen als kostprijs; klantprijs blijft gelijk → marge herrekenen
    for r in select * from jsonb_array_elements(a.regels) loop
      pr := nullif(r->>'prijs', '')::numeric; if pr is null or pr <= 0 then continue; end if;
      if not exists (select 1 from public.meetstaat_posten m where m.id = (r->>'post_id')::uuid and m.project_id = a.project_id) then continue; end if;
      select coalesce(mp.eenheidsprijs, 0) * (1 + coalesce(mp.marge, l.marge, 0)) into v
        from public.meetstaat_posten m join public.loten l on l.nr = m.lot left join public.meetstaat_prijzen mp on mp.post_id = m.id
       where m.id = (r->>'post_id')::uuid;
      m := case when coalesce(v, 0) > 0 then least(greatest(round(v / pr - 1, 4), -0.9999), 99.9999) else null end;
      insert into public.meetstaat_prijzen (post_id, eenheidsprijs, marge, updated_at) values ((r->>'post_id')::uuid, pr, m, now())
        on conflict (post_id) do update set eenheidsprijs = excluded.eenheidsprijs,
          marge = case when excluded.marge is null then public.meetstaat_prijzen.marge else excluded.marge end, updated_at = now();
      n := n + 1;
    end loop;
    update public.aannemer_meetstaten set status = 'akkoord', beslist_op = now(), beslist_naam = left(trim(p_naam), 120), beslist_door = auth.uid(),
      opmerking = left(trim(coalesce(p_opmerking, '')), 2000), toegepast_op = case when n > 0 then now() else toegepast_op end
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

-- ---------- realtime (Planbord ziet een akkoord meteen) ----------
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'aannemer_meetstaten') then
    alter publication supabase_realtime add table public.aannemer_meetstaten;
  end if;
end $$;

-- ---------- rechten (views alleen-lezen, niets voor anon; zie script 031) ----------
select public.rechten_herstellen();

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(32, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: moet 3 teruggeven
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('aannemer_meetstaten', 'aannemer_meetstaat_posten', 'aan_meetstaat_prijzen'))::int as objecten;
