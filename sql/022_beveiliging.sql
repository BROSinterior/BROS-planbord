-- =====================================================================
--  BROS Planbord — databasescript 022: beveiliging en integriteit (na codereview)
--  1. Niemand kan zijn eigen rol/actief/e-mail wijzigen (alleen beheer).
--  2. Nieuwe accounts die niet als klant uitgenodigd zijn, starten inactief; beheer activeert ze onder Team.
--  3. Kostprijzen: alleen beheer schrijft in meetstaat_prijzen; elke meetstaatregel krijgt automatisch een prijsregel.
--  4. Storage: de bestandenlijst van de buckets 'werf' en 'portaal' is enkel voor het team (bestanden zelf blijven via hun link bereikbaar).
--  5. is_beheer() en klant_projecten() houden rekening met 'actief'.
--  6. Nummering per project met lock + unieke index (geen dubbele V-nummers bij gelijktijdige/offline invoer); één taak per vaststelling.
--  7. Projecten verwijderen: alleen beheer.
--  8. Indexen op veelgebruikte sleutels; goedkeuring_beslis met rijvergrendeling.
--  9. RPC om foto's aan een vaststelling toe te voegen zonder de lijst te overschrijven (werfmodus).
--  Alleen aanpassingen die de app al verwacht; mag opnieuw uitgevoerd worden. Vereist schema 21.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 21 then
    raise exception 'Voer eerst de scripts tot en met 021 uit (huidig schema: %).', (select value->>'versie_schema' from public.instellingen where key = 'app');
  end if;
end $$;

-- ---------- 1. eigen profiel: rol, actief en e-mail enkel door beheer ----------
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_beheer()
     and (new.role, new.active, new.email) is distinct from (old.role, old.active, old.email) then
    raise exception 'Alleen een beheerder mag rol, actief of e-mail van een profiel wijzigen.';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles for each row execute function public.profiles_guard();

-- ---------- 2. nieuwe accounts: enkel klanten (uitgenodigd via het Planbord) meteen actief ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text; v_role text; v_contact uuid; v_active boolean;
begin
  v_name := coalesce(new.raw_user_meta_data->>'name', initcap(split_part(new.email, '@', 1)));
  v_role := case when new.raw_user_meta_data->>'rol' = 'klant' then 'klant'
                 when (select count(*) from public.profiles) = 0 then 'beheer' else 'medewerker' end;
  -- teamleden die je uitnodigt via Supabase (Authentication → Invite) starten inactief: beheer zet ze aan onder Team
  v_active := v_role = 'klant' or v_role = 'beheer' or coalesce(new.raw_user_meta_data->>'actief', '') = 'ja';
  insert into public.profiles (id, email, name, initials, role, active)
  values (new.id, new.email, v_name, upper(left(v_name, 2)), v_role, v_active)
  on conflict (id) do nothing;
  if v_role = 'klant' then
    v_contact := nullif(new.raw_user_meta_data->>'contact_id', '')::uuid;
    if v_contact is not null then
      update public.contacten set user_id = new.id where id = v_contact and user_id is null;
    else
      update public.contacten set user_id = new.id where user_id is null and lower(email) = lower(new.email);
    end if;
  else
    insert into public.tarieven (user_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end $$;

-- ---------- 3. kostprijzen alleen door beheer; elke regel krijgt een prijsregel ----------
drop policy if exists mprijs_insert on public.meetstaat_prijzen;
create policy mprijs_insert on public.meetstaat_prijzen for insert to authenticated with check (public.is_beheer());
create or replace function public.meetstaat_prijs_default()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.meetstaat_prijzen (post_id, eenheidsprijs)
  values (new.id, coalesce((select richtprijs from public.posten where id = new.post_id), 0))
  on conflict (post_id) do nothing;
  return new;
end $$;

-- ---------- 4. storage: lijst van de buckets enkel voor het team ----------
drop policy if exists werf_read on storage.objects;
create policy werf_read on storage.objects for select to authenticated using (bucket_id = 'werf' and public.is_intern());
drop policy if exists portaal_read on storage.objects;
create policy portaal_read on storage.objects for select to authenticated using (bucket_id = 'portaal' and public.is_intern());

-- ---------- 5. actief telt overal mee ----------
create or replace function public.is_beheer()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'beheer' and active from public.profiles where id = auth.uid()), false)
$$;
create or replace function public.klant_projecten()
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct pc.project_id
  from public.project_contacten pc
  join public.contacten c on c.id = pc.contact_id
  where c.user_id = auth.uid() and c.actief and pc.rol in ('bouwheer','contactpersoon')
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.active)
$$;

-- ---------- 6. nummering met lock + unieke index ----------
create or replace function public.werf_nummer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext(tg_table_name || ':' || new.project_id::text));
  if tg_table_name = 'vaststellingen' then
    if new.nr is null or new.nr <= 0 or exists (select 1 from public.vaststellingen v where v.project_id = new.project_id and v.nr = new.nr and v.id <> new.id) then
      select coalesce(max(nr), 0) + 1 into new.nr from public.vaststellingen where project_id = new.project_id;
    end if;
  else
    if new.nr is null or new.nr <= 0 or exists (select 1 from public.werfbezoeken w where w.project_id = new.project_id and w.nr = new.nr and w.id <> new.id) then
      select coalesce(max(nr), 0) + 1 into new.nr from public.werfbezoeken where project_id = new.project_id;
    end if;
  end if;
  return new;
end $$;
create or replace function public.werfverslag_nummer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('werfverslagen:' || new.project_id::text));
  if new.nr is null or new.nr <= 0 or exists (select 1 from public.werfverslagen w where w.project_id = new.project_id and w.nr = new.nr and w.id <> new.id) then
    select coalesce(max(nr), 0) + 1 into new.nr from public.werfverslagen where project_id = new.project_id;
  end if;
  return new;
end $$;
-- eventuele dubbele nummers uit het verleden eerst hernummeren
do $$ declare r record; begin
  for r in select id, project_id from (select id, project_id, row_number() over (partition by project_id, nr order by created_at) rn from public.vaststellingen) x where rn > 1 loop
    update public.vaststellingen set nr = (select coalesce(max(nr), 0) + 1 from public.vaststellingen where project_id = r.project_id) where id = r.id;
  end loop;
  for r in select id, project_id from (select id, project_id, row_number() over (partition by project_id, nr order by created_at) rn from public.werfbezoeken) x where rn > 1 loop
    update public.werfbezoeken set nr = (select coalesce(max(nr), 0) + 1 from public.werfbezoeken where project_id = r.project_id) where id = r.id;
  end loop;
  for r in select id, project_id from (select id, project_id, row_number() over (partition by project_id, nr order by created_at) rn from public.werfverslagen) x where rn > 1 loop
    update public.werfverslagen set nr = (select coalesce(max(nr), 0) + 1 from public.werfverslagen where project_id = r.project_id) where id = r.id;
  end loop;
end $$;
create unique index if not exists vaststellingen_project_nr on public.vaststellingen(project_id, nr);
create unique index if not exists werfbezoeken_project_nr on public.werfbezoeken(project_id, nr);
create unique index if not exists werfverslagen_project_nr on public.werfverslagen(project_id, nr);
-- één taak per vaststelling (dubbels uit het verleden: de oudste blijft)
delete from public.taken t using public.taken t2
  where t.vaststelling_id is not null and t.vaststelling_id = t2.vaststelling_id and t.created_at > t2.created_at;
create unique index if not exists taken_vaststelling_uniq on public.taken(vaststelling_id) where vaststelling_id is not null;

-- ---------- 7. projecten verwijderen: alleen beheer ----------
drop policy if exists projecten_all on public.projecten;
drop policy if exists projecten_select on public.projecten;
drop policy if exists projecten_insert on public.projecten;
drop policy if exists projecten_update on public.projecten;
drop policy if exists projecten_delete on public.projecten;
create policy projecten_select on public.projecten for select to authenticated using (public.is_intern());
create policy projecten_insert on public.projecten for insert to authenticated with check (public.is_intern());
create policy projecten_update on public.projecten for update to authenticated using (public.is_intern()) with check (public.is_intern());
create policy projecten_delete on public.projecten for delete to authenticated using (public.is_beheer());

-- ---------- 8. indexen + rijvergrendeling bij beslissen ----------
create index if not exists contacten_user_idx on public.contacten(user_id) where user_id is not null;
create index if not exists uren_taak_idx on public.uren(taak_id);
create index if not exists mp_post_idx on public.meetstaat_posten(post_id);
create index if not exists mp_gk_idx on public.meetstaat_posten(akkoord_goedkeuring);
create index if not exists vaststellingen_bezoek_idx on public.vaststellingen(bezoek_id);
create index if not exists werfverslagen_bezoek_idx on public.werfverslagen(bezoek_id);

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
       where id = (r->>'id')::uuid and project_id = g.project_id;
    end loop;
  end if;
  return g;
end $$;

-- ---------- 9. foto's toevoegen zonder de lijst te overschrijven (werfmodus, ook na offline) ----------
create or replace function public.vaststelling_fotos_toevoegen(p_id uuid, p_veld text, p_fotos jsonb)
returns public.vaststellingen language plpgsql security definer set search_path = public as $$
declare v public.vaststellingen; bestaand jsonb; nieuw jsonb := '[]'::jsonb; f jsonb;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  if p_veld not in ('fotos', 'opgelost_fotos') then raise exception 'Onbekend veld.'; end if;
  select * into v from public.vaststellingen where id = p_id for update;
  if v.id is null then raise exception 'Vaststelling niet gevonden.'; end if;
  bestaand := case when p_veld = 'fotos' then v.fotos else v.opgelost_fotos end;
  for f in select * from jsonb_array_elements(coalesce(p_fotos, '[]'::jsonb)) loop
    if not exists (select 1 from jsonb_array_elements(bestaand) b where b->>'path' = f->>'path') then nieuw := nieuw || jsonb_build_array(f); end if;
  end loop;
  if p_veld = 'fotos' then update public.vaststellingen set fotos = bestaand || nieuw, updated_at = now() where id = p_id returning * into v;
  else update public.vaststellingen set opgelost_fotos = bestaand || nieuw, updated_at = now() where id = p_id returning * into v; end if;
  return v;
end $$;
grant execute on function public.vaststelling_fotos_toevoegen(uuid, text, jsonb) to authenticated;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', '22'::jsonb), updated_at = now() where key = 'app';

-- Controle: moet 1 teruggeven
select count(*) from pg_trigger where tgname = 'profiles_guard';
