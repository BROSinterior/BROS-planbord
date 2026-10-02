-- =====================================================================
--  BROS Planbord — databasescript 031: beveiligingsronde 2 (audit oktober 2026)
--  1. Views zijn ALLEEN-LEZEN. Supabase geeft elke nieuwe view standaard ook insert/update/delete aan anon en
--     authenticated; omdat views met de rechten van de eigenaar draaien, kon je via klant_* en aan_* rijen
--     aanpassen of zelfs andermans gegevens opvragen. Nu: enkel SELECT voor ingelogde gebruikers, niets voor anon.
--  2. anon (niet ingelogd) krijgt nergens nog toegang toe: geen tabellen, views of functies.
--  3. Nieuwe accounts kiezen hun rol niet meer zelf: wie zich registreert, is een inactieve medewerker zonder
--     toegang. Klant- en aannemerslogins krijgen hun rol en contactkoppeling enkel nog via het Drive-script
--     (portaaluitnodiging, met de geheime sleutel). Vereist het nieuwe drive/Code.gs.
--  4. klant_projecten() vereist de rol klant.
--  5. Foto's bij werfpunten: enkel paden binnen het eigen project/werfpunt en https-links naar de werf-opslag.
--  6. Opslag 'werf': een aannemer mag enkel foto's (.jpg) opladen bij zijn eigen werfpunten; bestandstypes en
--     -grootte beperkt.
--  7. Prijsofferte-regels van aannemers (worden kostprijzen): enkel beheer.
--  8. Fasen, instellingen 'portaal'/'assistent' en de teamkaart: enkel voor actieve gebruikers.
--  9. Uren: een medewerker registreert en wijzigt enkel zijn eigen uren (beheer: iedereen).
-- 10. Profielkleur en profielfoto: enkel geldige waarden (kleurcode, https-link).
--  Vereist schema 29 (030_tekenen mag ervoor of erna). Mag opnieuw uitgevoerd worden.
--  Na elk later script dat views (her)maakt: select public.rechten_herstellen();
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 29 then
    raise exception 'Voer eerst de scripts tot en met 029 uit.';
  end if;
end $$;

-- ---------- 3. nieuwe accounts: nooit rol of contact uit de (door de gebruiker zelf ingevulde) metadata ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text; v_first boolean := not exists (select 1 from public.profiles);
begin
  v_name := left(coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), initcap(split_part(new.email, '@', 1))), 80);
  insert into public.profiles (id, email, name, initials, role, active)
  values (new.id, new.email, v_name, upper(left(v_name, 2)), case when v_first then 'beheer' else 'medewerker' end, v_first)
  on conflict (id) do nothing;
  insert into public.tarieven (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

-- rol + contactkoppeling na een portaaluitnodiging: enkel met de geheime sleutel (Drive-script), nooit vanuit de app
create or replace function public.portaal_koppel(p_user uuid, p_rol text, p_contact uuid)
returns void language plpgsql security definer set search_path = public as $$
declare huidig text;
begin
  if p_rol not in ('klant', 'aannemer') then raise exception 'Ongeldige rol.'; end if;
  select role into huidig from public.profiles where id = p_user;
  if huidig is null then raise exception 'Profiel niet gevonden.'; end if;
  if huidig in ('beheer') or (huidig = 'medewerker' and exists (select 1 from public.profiles where id = p_user and active)) then
    raise exception 'Dit e-mailadres hoort bij een teamlid van het Planbord.';
  end if;
  update public.profiles set role = p_rol, active = true where id = p_user;
  if p_contact is not null then
    update public.contacten set user_id = p_user where id = p_contact and (user_id is null or user_id = p_user);
  end if;
  delete from public.tarieven where user_id = p_user;
end $$;
revoke all on function public.portaal_koppel(uuid, text, uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.portaal_koppel(uuid, text, uuid) to service_role';
  end if;
end $$;

-- ---------- 4. klant_projecten: enkel voor klantlogins ----------
create or replace function public.klant_projecten()
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct pc.project_id
  from public.project_contacten pc
  join public.contacten c on c.id = pc.contact_id
  where c.user_id = auth.uid() and c.actief and pc.rol in ('bouwheer','contactpersoon')
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role = 'klant')
$$;

-- ---------- 5. foto's bij werfpunten controleren ----------
create or replace function public.fotos_geldig(p_fotos jsonb, p_prefix text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(bool_and(
           coalesce(f->>'path', '') like p_prefix || '%' and (f->>'path') !~ '\.\.' and length(f->>'path') < 300
           and (f->>'url') ~ '^https://[a-z0-9.-]+/storage/v1/object/public/werf/'
           and right(f->>'url', length(f->>'path')) = f->>'path'), true)
  from jsonb_array_elements(case when jsonb_typeof(p_fotos) = 'array' then p_fotos else '[]'::jsonb end) f
$$;

create or replace function public.vaststelling_fotos_toevoegen(p_id uuid, p_veld text, p_fotos jsonb)
returns public.vaststellingen language plpgsql security definer set search_path = public as $$
declare v public.vaststellingen; bestaand jsonb; nieuw jsonb := '[]'::jsonb; f jsonb;
begin
  if not public.is_intern() then raise exception 'Geen toegang.'; end if;
  if p_veld not in ('fotos', 'opgelost_fotos') then raise exception 'Onbekend veld.'; end if;
  select * into v from public.vaststellingen where id = p_id for update;
  if v.id is null then raise exception 'Vaststelling niet gevonden.'; end if;
  if not public.fotos_geldig(p_fotos, v.project_id || '/' || v.id || '/') then raise exception 'Ongeldige foto.'; end if;
  bestaand := case when p_veld = 'fotos' then v.fotos else v.opgelost_fotos end;
  for f in select * from jsonb_array_elements(coalesce(p_fotos, '[]'::jsonb)) loop
    if not exists (select 1 from jsonb_array_elements(bestaand) b where b->>'path' = f->>'path') then nieuw := nieuw || jsonb_build_array(f); end if;
  end loop;
  if p_veld = 'fotos' then update public.vaststellingen set fotos = bestaand || nieuw, updated_at = now() where id = p_id returning * into v;
  else update public.vaststellingen set opgelost_fotos = bestaand || nieuw, updated_at = now() where id = p_id returning * into v; end if;
  return v;
end $$;

create or replace function public.aannemer_vaststelling_melden(p_id uuid, p_status text default null, p_opmerking text default null, p_fotos jsonb default '[]'::jsonb)
returns public.vaststellingen language plpgsql security definer set search_path = public as $$
declare v public.vaststellingen; nieuw jsonb := '[]'::jsonb; f jsonb;
begin
  if not public.is_aannemer() then raise exception 'Geen toegang.'; end if;
  select * into v from public.vaststellingen where id = p_id for update;
  if v.id is null or v.contact_id is null or v.contact_id not in (select public.mijn_contacten()) then raise exception 'Dit punt is niet aan jou toegewezen.'; end if;
  if not public.fotos_geldig(p_fotos, v.project_id || '/' || v.id || '/') then raise exception 'Ongeldige foto.'; end if;
  for f in select * from jsonb_array_elements(coalesce(p_fotos, '[]'::jsonb)) loop
    if not exists (select 1 from jsonb_array_elements(v.opgelost_fotos) b where b->>'path' = f->>'path') then
      nieuw := nieuw || jsonb_build_array(jsonb_build_object('path', f->>'path', 'url', f->>'url', 'w', f->'w', 'h', f->'h', 'op', now(), 'door', 'aannemer'));
    end if;
  end loop;
  if p_status = 'opgelost' then
    if v.status <> 'open' then raise exception 'Dit punt staat niet meer open.'; end if;
    update public.vaststellingen set status = 'opgelost', opgelost_op = now(), opgelost_door = auth.uid(),
      opmerking = coalesce(nullif(left(trim(p_opmerking), 2000), ''), opmerking), opgelost_fotos = opgelost_fotos || nieuw, updated_at = now() where id = p_id returning * into v;
  elsif p_status is not null then
    raise exception 'Een aannemer kan een punt enkel als opgelost melden.';
  else
    update public.vaststellingen set opmerking = coalesce(nullif(left(trim(p_opmerking), 2000), ''), opmerking), opgelost_fotos = opgelost_fotos || nieuw, updated_at = now() where id = p_id returning * into v;
  end if;
  return v;
end $$;

-- ---------- 6. opslag 'werf' ----------
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute 'drop policy if exists werf_insert on storage.objects';
    execute $p$create policy werf_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'werf' and (
        public.is_intern()
        or (public.is_aannemer()
            and split_part(name, '/', 1) in (select public.aannemer_projecten()::text)
            and split_part(name, '/', 2) in (select v.id::text from public.vaststellingen v where v.contact_id in (select public.mijn_contacten()))
            and split_part(name, '/', 4) = '' and lower(name) like '%.jpg')))$p$;
    if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
      execute $u$update storage.buckets set file_size_limit = 26214400, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'application/octet-stream'] where id = 'werf'$u$;
    end if;
  end if;
end $$;

-- ---------- 7. offerteprijzen van aannemers: enkel beheer ----------
drop policy if exists par_intern on public.prijsaanvraag_regels;
drop policy if exists par_beheer on public.prijsaanvraag_regels;
create policy par_beheer on public.prijsaanvraag_regels for all to authenticated using (public.is_beheer()) with check (public.is_beheer());

-- ---------- 8. enkel actieve gebruikers ----------
drop policy if exists fasen_select on public.fasen;
create policy fasen_select on public.fasen for select to authenticated using (public.is_intern() or public.is_klant() or public.is_aannemer());
drop policy if exists instellingen_select on public.instellingen;
create policy instellingen_select on public.instellingen for select to authenticated
  using (public.is_intern() or ((public.is_klant() or public.is_aannemer()) and key in ('portaal', 'assistent')));
create or replace view public.klant_team as
  select id, name, initials, color, functie, bio, foto_url
  from public.profiles p
  where role in ('beheer', 'medewerker') and active and portaal_zichtbaar
    and (public.is_intern() or public.is_klant() or public.is_aannemer());

-- ---------- 9. uren: eigen uren (beheer: alles) ----------
drop policy if exists uren_all on public.uren;
drop policy if exists uren_select on public.uren;
drop policy if exists uren_schrijf on public.uren;
drop policy if exists uren_wijzig on public.uren;
drop policy if exists uren_wis on public.uren;
create policy uren_select on public.uren for select to authenticated using (public.is_intern());
create policy uren_schrijf on public.uren for insert to authenticated with check (public.is_beheer() or (public.is_intern() and user_id = auth.uid()));
create policy uren_wijzig on public.uren for update to authenticated using (public.is_beheer() or (public.is_intern() and user_id = auth.uid())) with check (public.is_beheer() or (public.is_intern() and user_id = auth.uid()));
create policy uren_wis on public.uren for delete to authenticated using (public.is_beheer() or (public.is_intern() and user_id = auth.uid()));

-- ---------- 10. profielkleur en -foto ----------
update public.profiles set color = '#888888' where color is null or color !~ '^#[0-9A-Fa-f]{3,8}$';
update public.profiles set foto_url = '' where coalesce(foto_url, '') <> '' and foto_url !~ '^https://';
alter table public.profiles drop constraint if exists profiles_color_check;
alter table public.profiles add constraint profiles_color_check check (color ~ '^#[0-9A-Fa-f]{3,8}$');
alter table public.profiles drop constraint if exists profiles_foto_check;
alter table public.profiles add constraint profiles_foto_check check (coalesce(foto_url, '') = '' or foto_url ~ '^https://');

-- ---------- 1 + 2. rechten: views alleen-lezen, niets voor anon ----------
-- Herbruikbaar: voer `select public.rechten_herstellen();` uit na elk script dat views (her)maakt.
create or replace function public.rechten_herstellen()
returns text language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select table_name from information_schema.views where table_schema = 'public' loop
    execute format('revoke all on public.%I from public, anon, authenticated', r.table_name);
    execute format('grant select on public.%I to authenticated', r.table_name);
    n := n + 1;
  end loop;
  execute 'revoke all on all tables in schema public from anon';
  execute 'revoke all on all sequences in schema public from anon';
  execute 'revoke execute on all functions in schema public from public, anon';
  execute 'grant execute on all functions in schema public to authenticated';
  execute 'revoke all on function public.portaal_koppel(uuid, text, uuid) from authenticated';
  execute 'revoke all on function public.rechten_herstellen() from authenticated';
  return n || ' views alleen-lezen gezet; anon heeft geen toegang meer.';
end $$;
select public.rechten_herstellen();
-- nieuwe objecten (latere scripts): standaard niets voor anon
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon, public;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(31, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle 1: moet 0 teruggeven (geen schrijfrechten meer op views)
select count(*) as schrijfrechten_op_views from information_schema.role_table_grants g
  join information_schema.views v on v.table_schema = g.table_schema and v.table_name = g.table_name
  where g.table_schema = 'public' and g.grantee in ('anon', 'authenticated', 'PUBLIC') and g.privilege_type <> 'SELECT';
-- Controle 2: wie heeft er een login? Kijk na of je iedereen kent (vooral actieve medewerkers en klant/aannemer zonder contact).
select p.email, p.role, p.active, p.created_at::date as sinds,
       (select string_agg(c.naam, ', ') from public.contacten c where c.user_id = p.id) as contact
from public.profiles p order by p.role, p.created_at;
