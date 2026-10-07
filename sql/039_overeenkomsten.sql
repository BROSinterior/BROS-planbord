-- =====================================================================
--  BROS Planbord — databasescript 039: overeenkomsten laten goedkeuren in het klantenportaal
--  - goedkeuringen.soort 'overeenkomst': een pdf (uit de projectmap of opgeladen) wordt bevroren in de private opslag
--    'overeenkomsten' (<project>/<goedkeuring>.pdf) met zijn SHA-256-vingerafdruk.
--  - goedkeuring_tekenaars: iedere bouwheer keurt zelf goed; pas als iedereen akkoord is, staat de overeenkomst op akkoord.
--  - Akkoord = pdf geopend, vinkje 'gelezen en akkoord', naam, en een code die hij per mail krijgt (Drive-script,
--    actie 'ovmail' soort 'code'). Vastgelegd: naam, e-mail van de login, tijdstip, IP-adres en browser.
--  - Na het laatste akkoord maakt het Planbord de getekende pdf (overeenkomst + akkoordpagina) en bewaart die in de
--    projectmap (Documenten/Overeenkomsten), gedeeld met de klant (goedkeuringen.getekend_document).
--  Vereist schema 38. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 38 then
    raise exception 'Voer eerst de scripts tot en met 038 uit.';
  end if;
end $$;

-- ---------- 1. overeenkomst als soort goedkeuring ----------
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.goedkeuringen'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ 'soort' loop
    execute format('alter table public.goedkeuringen drop constraint %I', c);
  end loop;
  alter table public.goedkeuringen add constraint goedkeuringen_soort_check check (soort in ('offerte', 'meerwerk', 'overeenkomst'));
end $$;
alter table public.goedkeuringen
  add column if not exists document_id      uuid references public.documenten(id) on delete set null,   -- bron in de projectmap (indien gekozen)
  add column if not exists bestand_path     text,          -- bevroren kopie in opslag 'overeenkomsten'
  add column if not exists bestand_naam     text not null default '',
  add column if not exists bestand_sha256   text not null default '',
  add column if not exists bestand_grootte  bigint,
  add column if not exists getekend_document uuid references public.documenten(id) on delete set null,   -- getekende pdf in de projectmap
  add column if not exists getekend_op      timestamptz,
  add column if not exists getekend_drive_id text;         -- Drive-bestand van de getekende pdf: eens gezet wordt ze niet opnieuw gemaakt

create table if not exists public.goedkeuring_tekenaars (
  id             uuid primary key default gen_random_uuid(),
  goedkeuring_id uuid not null references public.goedkeuringen(id) on delete cascade,
  contact_id     uuid not null references public.contacten(id) on delete cascade,
  status         text not null default 'open' check (status in ('open', 'akkoord', 'geweigerd')),
  beslist_op     timestamptz,
  beslist_naam   text not null default '',
  beslist_email  text not null default '',
  beslist_ip     text not null default '',
  beslist_agent  text not null default '',
  opmerking      text not null default '',
  code_tot       timestamptz,     -- tot wanneer de laatst gemailde code geldt (de code zelf staat in goedkeuring_codes)
  code_pogingen  int not null default 0,
  code_email     text not null default '',
  created_at     timestamptz not null default now(),
  unique (goedkeuring_id, contact_id)
);
create index if not exists goedkeuring_tekenaars_gk_idx on public.goedkeuring_tekenaars(goedkeuring_id);
-- de gemailde code: md5(code || tekenaar-id), enkel geschreven door het Drive-script (service key) en gelezen door overeenkomst_beslis.
-- Niemand met een login kan deze tabel lezen (RLS zonder policies + geen rechten).
create table if not exists public.goedkeuring_codes (
  tekenaar_id uuid primary key references public.goedkeuring_tekenaars(id) on delete cascade,
  code_hash   text not null,
  gemaakt_op  timestamptz not null default now()
);
alter table public.goedkeuring_codes enable row level security;
alter table public.goedkeuring_tekenaars enable row level security;
drop policy if exists gkt_intern_lezen on public.goedkeuring_tekenaars;
drop policy if exists gkt_intern_maken on public.goedkeuring_tekenaars;
drop policy if exists gkt_intern_weg on public.goedkeuring_tekenaars;
alter table public.goedkeuring_tekenaars drop column if exists code_hash;   -- (testversie) de code staat apart
create policy gkt_intern_lezen on public.goedkeuring_tekenaars for select to authenticated using (public.is_intern());
create policy gkt_intern_maken on public.goedkeuring_tekenaars for insert to authenticated with check (public.is_intern() and status = 'open' and code_tot is null and beslist_op is null);
create policy gkt_intern_weg on public.goedkeuring_tekenaars for delete to authenticated using (public.is_intern());
-- (geen update-policy: beslissen gebeurt enkel via overeenkomst_beslis, de code enkel via het Drive-script)

-- wat de klant ziet
drop view if exists public.klant_goedkeuringen;
create view public.klant_goedkeuringen as
  select g.id, g.project_id, g.soort, g.titel, g.toelichting, g.status, g.posten, g.totaal_excl, g.btw, g.totaal_incl,
         g.voorgelegd_op, g.geldig_tot, p.name as voorgelegd_door_naam, g.beslist_op, g.beslist_naam, g.opmerking,
         g.bestand_path, g.bestand_naam, g.bestand_sha256, g.bestand_grootte, g.getekend_document
  from public.goedkeuringen g left join public.profiles p on p.id = g.voorgelegd_door
  where g.project_id in (select public.klant_projecten());
create or replace view public.klant_tekenaars as
  select t.id, t.goedkeuring_id, c.naam, t.status, t.beslist_op, t.beslist_naam, (t.contact_id in (select public.mijn_contacten())) as ik,
         (t.code_tot is not null and t.code_tot > now() and t.contact_id in (select public.mijn_contacten())) as code_verstuurd
  from public.goedkeuring_tekenaars t join public.goedkeuringen g on g.id = t.goedkeuring_id join public.contacten c on c.id = t.contact_id
  where g.project_id in (select public.klant_projecten());

-- de bestaande beslissing (offerte/meerwerk) weigert een overeenkomst: die loopt via overeenkomst_beslis
create or replace function public.goedkeuring_beslis(p_id uuid, p_akkoord boolean, p_naam text, p_opmerking text default '')
returns public.goedkeuringen language plpgsql security definer set search_path = public as $$
declare g public.goedkeuringen; r jsonb; v_email text;
begin
  select * into g from public.goedkeuringen where id = p_id for update;
  if g.id is null then raise exception 'Voorstel niet gevonden.'; end if;
  if not public.is_klant() or g.project_id not in (select public.klant_projecten()) then raise exception 'Geen toegang tot dit voorstel.'; end if;
  if g.soort = 'overeenkomst' then raise exception 'Een overeenkomst keur je goed met de code die je per mail krijgt.'; end if;
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

-- ---------- 2. beslissen over een overeenkomst ----------
create or replace function public.overeenkomst_beslis(p_id uuid, p_akkoord boolean, p_naam text, p_code text default '', p_opmerking text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare g public.goedkeuringen; t public.goedkeuring_tekenaars; v_email text; hdr json; v_ip text; v_agent text; n_open int; n_nee int; v_hash text;
begin
  select * into g from public.goedkeuringen where id = p_id for update;
  if g.id is null or g.soort <> 'overeenkomst' then raise exception 'Overeenkomst niet gevonden.'; end if;
  if not public.is_klant() or g.project_id not in (select public.klant_projecten()) then raise exception 'Geen toegang tot deze overeenkomst.'; end if;
  if g.status <> 'open' then raise exception 'Over deze overeenkomst is al beslist.'; end if;
  if g.geldig_tot is not null and g.geldig_tot < current_date then raise exception 'De termijn is verstreken (tot %). Vraag BROS om de overeenkomst opnieuw voor te leggen.', to_char(g.geldig_tot, 'DD/MM/YYYY'); end if;
  select * into t from public.goedkeuring_tekenaars
   where goedkeuring_id = g.id and contact_id in (select public.mijn_contacten()) and status = 'open' order by created_at limit 1 for update;
  if t.id is null then raise exception 'Je hoeft deze overeenkomst niet (meer) goed te keuren.'; end if;
  select email into v_email from auth.users where id = auth.uid();
  hdr := nullif(current_setting('request.headers', true), '')::json;
  -- IP: eerst wat de proxy zelf zet (cf-connecting-ip / x-real-ip), pas dan het eerste x-forwarded-for-adres
  v_ip := left(trim(coalesce(nullif(hdr->>'cf-connecting-ip', ''), nullif(hdr->>'x-real-ip', ''), split_part(hdr->>'x-forwarded-for', ',', 1), '')), 64);
  v_agent := left(coalesce(hdr->>'user-agent', ''), 300);
  if coalesce(p_akkoord, false) then
    if length(trim(coalesce(p_naam, ''))) < 3 then raise exception 'Vul je volledige naam in.'; end if;
    select code_hash into v_hash from public.goedkeuring_codes where tekenaar_id = t.id;
    if v_hash is null or t.code_tot is null or t.code_tot < now() then
      return jsonb_build_object('ok', false, 'fout', 'Vraag eerst een (nieuwe) code aan: ze is 15 minuten geldig.');
    end if;
    if t.code_pogingen >= 5 then return jsonb_build_object('ok', false, 'fout', 'Te veel foute pogingen. Vraag een nieuwe code aan.'); end if;
    if md5(regexp_replace(coalesce(p_code, ''), '\D', '', 'g') || t.id::text) <> v_hash then
      update public.goedkeuring_tekenaars set code_pogingen = code_pogingen + 1 where id = t.id;
      return jsonb_build_object('ok', false, 'fout', 'Deze code klopt niet. Kijk de mail nog eens na (of vraag een nieuwe code aan).');
    end if;
    update public.goedkeuring_tekenaars set status = 'akkoord', beslist_op = now(), beslist_naam = left(trim(p_naam), 120), beslist_email = coalesce(v_email, ''),
           beslist_ip = v_ip, beslist_agent = v_agent, code_tot = null where id = t.id;
  else
    if length(trim(coalesce(p_opmerking, ''))) < 3 then raise exception 'Schrijf kort wat je wil aanpassen of vragen.'; end if;
    update public.goedkeuring_tekenaars set status = 'geweigerd', beslist_op = now(), beslist_naam = left(coalesce(nullif(trim(p_naam), ''), v_email, ''), 120),
           beslist_email = coalesce(v_email, ''), beslist_ip = v_ip, beslist_agent = v_agent, opmerking = left(trim(p_opmerking), 2000), code_tot = null where id = t.id;
  end if;
  delete from public.goedkeuring_codes where tekenaar_id = t.id;
  select count(*) filter (where status = 'open'), count(*) filter (where status = 'geweigerd') into n_open, n_nee from public.goedkeuring_tekenaars where goedkeuring_id = g.id;
  if n_nee > 0 then
    update public.goedkeuringen set status = 'geweigerd', beslist_op = now(), beslist_door = auth.uid(), beslist_naam = left(coalesce(nullif(trim(p_naam), ''), v_email, ''), 120),
           beslist_email = coalesce(v_email, ''), opmerking = left(coalesce(p_opmerking, ''), 2000) where id = g.id;
  elsif n_open = 0 then
    update public.goedkeuringen set status = 'akkoord', beslist_op = now(), beslist_door = auth.uid(),
           beslist_naam = (select string_agg(beslist_naam, ', ' order by beslist_op) from public.goedkeuring_tekenaars where goedkeuring_id = g.id),
           beslist_email = (select string_agg(beslist_email, ', ' order by beslist_op) from public.goedkeuring_tekenaars where goedkeuring_id = g.id)
     where id = g.id;
  end if;
  return jsonb_build_object('ok', true, 'status', (select status from public.goedkeuringen where id = g.id), 'nog_open', n_open);
end $$;

-- ---------- 3. opslag 'overeenkomsten' (privé) ----------
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public) values ('overeenkomsten', 'overeenkomsten', false) on conflict (id) do update set public = false;
    if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
      update storage.buckets set file_size_limit = 31457280, allowed_mime_types = array['application/pdf'] where id = 'overeenkomsten';
    end if;
    execute 'drop policy if exists overeenkomsten_insert on storage.objects';
    execute 'drop policy if exists overeenkomsten_read on storage.objects';
    execute 'drop policy if exists overeenkomsten_delete on storage.objects';
    execute $p$create policy overeenkomsten_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'overeenkomsten' and public.is_intern() and lower(name) like '%.pdf' and split_part(name, '/', 3) = '')$p$;
    execute $p$create policy overeenkomsten_read on storage.objects for select to authenticated using (
      bucket_id = 'overeenkomsten' and (public.is_intern() or split_part(name, '/', 1) in (select x::text from public.klant_projecten() x)))$p$;
    execute $p$create policy overeenkomsten_delete on storage.objects for delete to authenticated using (
      bucket_id = 'overeenkomsten' and public.is_beheer()
      and not exists (select 1 from public.goedkeuringen g where g.bestand_path = storage.objects.name))$p$;   -- de vaste kopie van een voorgelegde overeenkomst blijft
  end if;
end $$;
-- een voorgelegde overeenkomst ligt vast. Wie met een login rechtstreeks (via de app/API) wijzigt — current_user
-- 'authenticated' — kan enkel: titel/toelichting/termijn aanpassen, intrekken (open → ingetrokken) en de getekende pdf koppelen.
-- De beslissing zelf gebeurt enkel via overeenkomst_beslis (security definer, current_user = eigenaar).
-- (security invoker, zodat current_user de echte gebruiker is)
create or replace function public.overeenkomst_vast()
returns trigger language plpgsql set search_path = public as $$
declare app boolean := current_user in ('authenticated', 'anon');
begin
  if tg_op = 'DELETE' then
    if app and old.soort = 'overeenkomst' and exists (select 1 from public.goedkeuring_tekenaars where goedkeuring_id = old.id and status <> 'open') then
      raise exception 'Over deze overeenkomst werd al beslist: ze blijft bewaard als bewijs (je kan ze wel intrekken).';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if app and new.soort = 'overeenkomst' and new.status <> 'open' then raise exception 'Een nieuwe overeenkomst staat altijd eerst open.'; end if;
    return new;
  end if;
  if (old.soort = 'overeenkomst' or new.soort = 'overeenkomst') and (app or current_user = 'service_role')   -- (enkel de SQL-editor mag dit nog)
     and (new.bestand_path, new.bestand_sha256, new.project_id, new.soort) is distinct from (old.bestand_path, old.bestand_sha256, old.project_id, old.soort) then
    raise exception 'Het document van een voorgelegde overeenkomst kan niet meer wijzigen. Trek ze in en leg een nieuwe voor.';
  end if;
  if app and old.soort = 'overeenkomst' then
    if new.status is distinct from old.status and not (old.status = 'open' and new.status = 'ingetrokken') then
      raise exception 'De status van een overeenkomst wijzigt enkel door de goedkeuring in het portaal (of door intrekken).';
    end if;
    if (new.beslist_op, new.beslist_door, new.beslist_naam, new.beslist_email, new.opmerking, new.posten::text)
       is distinct from (old.beslist_op, old.beslist_door, old.beslist_naam, old.beslist_email, old.opmerking, old.posten::text)
       or (old.getekend_drive_id is not null and new.getekend_drive_id is distinct from old.getekend_drive_id) then
      raise exception 'De beslissing over een overeenkomst kan niet gewijzigd worden.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists overeenkomst_vast on public.goedkeuringen;
create trigger overeenkomst_vast before insert or update or delete on public.goedkeuringen for each row execute function public.overeenkomst_vast();

-- tekenaars: enkel toevoegen aan een open overeenkomst waarover nog niemand besliste; één login = één bouwheer per overeenkomst;
-- wie al besliste blijft staan (bewijs)
create or replace function public.tekenaar_vast()
returns trigger language plpgsql set search_path = public as $$
declare g public.goedkeuringen;
begin
  if current_user not in ('authenticated', 'anon') then return coalesce(new, old); end if;
  if tg_op = 'INSERT' then
    select * into g from public.goedkeuringen where id = new.goedkeuring_id;
    if g.id is null or g.soort <> 'overeenkomst' or g.status <> 'open' then raise exception 'Bouwheren voeg je enkel toe aan een open overeenkomst.'; end if;
    if exists (select 1 from public.goedkeuring_tekenaars where goedkeuring_id = g.id and status <> 'open') then
      raise exception 'Over deze overeenkomst werd al beslist: leg een nieuwe voor.';
    end if;
    if exists (select 1 from public.goedkeuring_tekenaars t join public.contacten a on a.id = t.contact_id join public.contacten b on b.id = new.contact_id
                where t.goedkeuring_id = g.id and t.contact_id <> new.contact_id and a.user_id is not null and a.user_id = b.user_id) then
      raise exception 'Twee gekozen bouwheren delen dezelfde login (hetzelfde e-mailadres). Iedere bouwheer heeft een eigen login nodig om zelf goed te keuren.';
    end if;
    return new;
  end if;
  if old.status <> 'open' then raise exception 'Deze bouwheer besliste al: dat blijft bewaard (trek de overeenkomst in en leg een nieuwe voor).'; end if;
  select * into g from public.goedkeuringen where id = old.goedkeuring_id;
  if g.id is not null and g.status = 'open' and exists (select 1 from public.goedkeuring_tekenaars where goedkeuring_id = g.id and status <> 'open') then
    raise exception 'Over deze overeenkomst werd al deels beslist: trek ze in en leg een nieuwe voor.';
  end if;
  return old;
end $$;
drop trigger if exists tekenaar_vast on public.goedkeuring_tekenaars;
create trigger tekenaar_vast before insert or delete on public.goedkeuring_tekenaars for each row execute function public.tekenaar_vast();

-- ---------- 4. live + rechten ----------
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'goedkeuring_tekenaars') then
    alter publication supabase_realtime add table public.goedkeuring_tekenaars;
  end if;
end $$;
drop trigger if exists goedkeuring_tekenaars_portaal_ping on public.goedkeuring_tekenaars;
create or replace function public.tekenaar_ping()
returns trigger language plpgsql security definer set search_path = public as $$
declare p uuid;
begin
  select project_id into p from public.goedkeuringen where id = coalesce(new.goedkeuring_id, old.goedkeuring_id);
  if p is not null then
    insert into public.portaal_pings (project_id, gewijzigd_op) values (p, now())
    on conflict (project_id) do update set gewijzigd_op = now() where public.portaal_pings.gewijzigd_op < now();
  end if;
  return null;
end $$;
create trigger goedkeuring_tekenaars_portaal_ping after insert or update or delete on public.goedkeuring_tekenaars for each row execute function public.tekenaar_ping();

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

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(39, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: moet 1 | 1 | 1 teruggeven
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'goedkeuring_tekenaars')::int as tekenaars,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'klant_goedkeuringen' and column_name = 'bestand_sha256')::int as view_klant,
       (select count(*) from pg_proc where proname = 'overeenkomst_beslis')::int as beslis;
