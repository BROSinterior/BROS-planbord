-- =====================================================================
--  BROS Planbord — databasescript 068: goedgekeurd meer-/minderwerk naar de aannemer (v1.76)
--  - goedkeuringen.aannemers: bij een meer-/minwerkvoorstel kies je de aannemer(s) die het uitvoeren (minstens één).
--  - Keurt de klant goed, dan maakt het Planbord een bevestiging in pdf (zonder prijzen, met de volledige goedkeuring
--    van de klant: naam, login, tijdstip, IP-adres, browser, opmerking en een controlecode). Die komt in de projectmap
--    (Documenten/Meerwerk), wordt gedeeld met die aannemer(s) en het Drive-script mailt ze met de pdf in bijlage.
--  - goedkeuring_aannemers: per aannemer wanneer hij gemeld werd en wanneer (en door wie) hij de ontvangst bevestigde
--    in het aannemersportaal ("Ontvangen": naam, login, tijdstip, IP-adres, browser).
--  - goedkeuring_beslis bewaart voortaan ook het IP-adres en de browser van de klant bij goedkeuren/weigeren.
--  - aan_meerwerk (aannemersportaal): zijn goedgekeurd meerwerk, ZONDER prijzen.
--  Vereist schema 67. Alleen toevoegingen; mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 67 then
    raise exception 'Voer eerst de scripts tot en met 067 uit.';
  end if;
end $$;

-- ---------- 1. kolommen ----------
alter table public.goedkeuringen
  add column if not exists aannemers            uuid[] not null default '{}',   -- contacten (aannemers) die het meer-/minwerk uitvoeren
  add column if not exists beslist_ip           text not null default '',
  add column if not exists beslist_agent        text not null default '',
  add column if not exists bevestiging_op       timestamptz,                     -- bezig/klaar met de pdf (ook: claim, zodat maar één Planbord ze maakt)
  add column if not exists bevestiging_drive_id text,                            -- Drive-bestand van de bevestiging (eens gezet: niet opnieuw)
  add column if not exists bevestiging_document uuid references public.documenten(id) on delete set null,
  add column if not exists bevestiging_sha      text not null default '';

-- IP en browser van de klant: enkel de databank zet ze (bij de beslissing)
create or replace function public.goedkeuring_bewijs_vast()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and (new.beslist_ip, new.beslist_agent) is distinct from (old.beslist_ip, old.beslist_agent) then
    raise exception 'De gegevens van de goedkeuring door de klant kunnen niet gewijzigd worden.';
  end if;
  return new;
end $$;
drop trigger if exists goedkeuring_bewijs_vast on public.goedkeuringen;
create trigger goedkeuring_bewijs_vast before update on public.goedkeuringen for each row execute function public.goedkeuring_bewijs_vast();

-- ---------- 2. goedkeuren door de klant: ook IP en browser bewaren (verder ongewijzigd t.o.v. script 039) ----------
create or replace function public.goedkeuring_beslis(p_id uuid, p_akkoord boolean, p_naam text, p_opmerking text default '')
returns public.goedkeuringen language plpgsql security definer set search_path = public as $$
declare g public.goedkeuringen; r jsonb; v_email text; hdr json; v_ip text; v_agent text;
begin
  select * into g from public.goedkeuringen where id = p_id for update;
  if g.id is null then raise exception 'Voorstel niet gevonden.'; end if;
  if not public.is_klant() or g.project_id not in (select public.klant_projecten()) then raise exception 'Geen toegang tot dit voorstel.'; end if;
  if g.soort = 'overeenkomst' then raise exception 'Een overeenkomst keur je goed met de code die je per mail krijgt.'; end if;
  if g.status <> 'open' then raise exception 'Dit voorstel is al beslist.'; end if;
  if g.geldig_tot is not null and g.geldig_tot < current_date then raise exception 'De termijn voor dit voorstel is verstreken (tot %). Vraag BROS om het opnieuw voor te leggen.', to_char(g.geldig_tot, 'DD/MM/YYYY'); end if;
  select email into v_email from auth.users where id = auth.uid();
  hdr := nullif(current_setting('request.headers', true), '')::json;
  v_ip := left(trim(coalesce(nullif(hdr->>'cf-connecting-ip', ''), nullif(hdr->>'x-real-ip', ''), split_part(hdr->>'x-forwarded-for', ',', 1), '')), 64);
  v_agent := left(coalesce(hdr->>'user-agent', ''), 300);
  update public.goedkeuringen
     set status = case when p_akkoord then 'akkoord' else 'geweigerd' end,
         beslist_op = now(), beslist_door = auth.uid(),
         beslist_naam = coalesce(nullif(trim(p_naam), ''), v_email, ''), beslist_email = coalesce(v_email, ''),
         opmerking = coalesce(p_opmerking, ''), beslist_ip = coalesce(v_ip, ''), beslist_agent = coalesce(v_agent, '')
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

-- ---------- 3. per aannemer: gemeld en ontvangen ----------
create table if not exists public.goedkeuring_aannemers (
  id             uuid primary key default gen_random_uuid(),
  goedkeuring_id uuid not null references public.goedkeuringen(id) on delete cascade,
  contact_id     uuid not null references public.contacten(id) on delete cascade,
  gemeld_op      timestamptz,                 -- mail met de pdf vertrokken
  gezien_op      timestamptz,                 -- "Ontvangen" in het aannemersportaal
  gezien_naam    text not null default '',
  gezien_email   text not null default '',
  gezien_ip      text not null default '',
  gezien_agent   text not null default '',
  created_at     timestamptz not null default now(),
  unique (goedkeuring_id, contact_id)
);
alter table public.goedkeuring_aannemers enable row level security;
drop policy if exists ga_intern on public.goedkeuring_aannemers;
drop policy if exists ga_aannemer on public.goedkeuring_aannemers;
create policy ga_intern on public.goedkeuring_aannemers for all to authenticated using ((select public.is_intern())) with check ((select public.is_intern()));
create policy ga_aannemer on public.goedkeuring_aannemers for select to authenticated using (contact_id in (select public.mijn_contacten()));
revoke all on public.goedkeuring_aannemers from anon;
grant select, insert, update, delete on public.goedkeuring_aannemers to authenticated;

-- het bewijs van ontvangst ligt vast (enkel via meerwerk_ontvangen)
create or replace function public.goedkeuring_aannemer_vast()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.gezien_op is not null then raise exception 'Deze aannemer bevestigde de ontvangst al: dat blijft bewaard.'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then new.gezien_op := null; new.gezien_naam := ''; new.gezien_email := ''; new.gezien_ip := ''; new.gezien_agent := ''; return new; end if;
  if (new.gezien_op, new.gezien_naam, new.gezien_email, new.gezien_ip, new.gezien_agent, new.goedkeuring_id, new.contact_id)
     is distinct from (old.gezien_op, old.gezien_naam, old.gezien_email, old.gezien_ip, old.gezien_agent, old.goedkeuring_id, old.contact_id) then
    raise exception 'De ontvangstbevestiging van de aannemer kan niet gewijzigd worden.';
  end if;
  return new;
end $$;
drop trigger if exists goedkeuring_aannemer_vast on public.goedkeuring_aannemers;
create trigger goedkeuring_aannemer_vast before insert or update or delete on public.goedkeuring_aannemers for each row execute function public.goedkeuring_aannemer_vast();

-- de aannemer bevestigt de ontvangst (portaal)
create or replace function public.meerwerk_ontvangen(p_id uuid, p_naam text default '')
returns public.goedkeuring_aannemers language plpgsql security definer set search_path = public as $$
declare a public.goedkeuring_aannemers; g public.goedkeuringen; v_email text; hdr json; v_ip text; v_agent text;
begin
  select * into a from public.goedkeuring_aannemers where id = p_id for update;
  if a.id is null or not public.is_aannemer() or a.contact_id not in (select public.mijn_contacten()) then raise exception 'Niet gevonden.'; end if;
  select * into g from public.goedkeuringen where id = a.goedkeuring_id;
  if g.status <> 'akkoord' then raise exception 'Dit meer-/minderwerk is niet (meer) goedgekeurd.'; end if;
  if a.gezien_op is not null then return a; end if;
  select email into v_email from auth.users where id = auth.uid();
  hdr := nullif(current_setting('request.headers', true), '')::json;
  v_ip := left(trim(coalesce(nullif(hdr->>'cf-connecting-ip', ''), nullif(hdr->>'x-real-ip', ''), split_part(hdr->>'x-forwarded-for', ',', 1), '')), 64);
  v_agent := left(coalesce(hdr->>'user-agent', ''), 300);
  update public.goedkeuring_aannemers
     set gezien_op = now(), gezien_naam = left(coalesce(nullif(trim(p_naam), ''), v_email, ''), 120), gezien_email = coalesce(v_email, ''),
         gezien_ip = coalesce(v_ip, ''), gezien_agent = coalesce(v_agent, '')
   where id = p_id returning * into a;
  return a;
end $$;
revoke all on function public.meerwerk_ontvangen(uuid, text) from public, anon;
grant execute on function public.meerwerk_ontvangen(uuid, text) to authenticated;

-- ---------- 4. aannemersportaal: zijn goedgekeurd meerwerk, zonder prijzen ----------
create or replace view public.aan_meerwerk as
  select a.id, a.goedkeuring_id, g.project_id, g.titel, g.toelichting, g.status,
         (select coalesce(jsonb_agg(jsonb_build_object('code', x->>'code', 'omschrijving', x->>'omschrijving', 'locatie', x->>'locatie',
                 'hoeveelheid', x->'hoeveelheid', 'eenheid', x->>'eenheid', 'st', coalesce(x->>'status', x->>'st'), 'lot', x->'lot')), '[]'::jsonb)
            from jsonb_array_elements(g.posten) x) as posten,
         g.beslist_op, g.beslist_naam, g.bevestiging_document as document_id, g.geannuleerd_op,
         a.gemeld_op, a.gezien_op, a.gezien_naam
  from public.goedkeuring_aannemers a join public.goedkeuringen g on g.id = a.goedkeuring_id
  where a.contact_id in (select public.mijn_contacten()) and g.status in ('akkoord', 'geannuleerd') and g.soort = 'meerwerk';
revoke all on public.aan_meerwerk from anon;
grant select on public.aan_meerwerk to authenticated;

-- ---------- 5. live bijwerken ----------
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'goedkeuring_aannemers') then
    alter publication supabase_realtime add table public.goedkeuring_aannemers;
  end if;
end $$;
drop trigger if exists pb_wijz on public.goedkeuring_aannemers;
create trigger pb_wijz after insert or update or delete on public.goedkeuring_aannemers for each row execute function public.pb_wijziging('goedkeuring_aannemers', 'id');

do $$ begin
  revoke all on function public.goedkeuring_bewijs_vast(), public.goedkeuring_aannemer_vast() from public, anon;
end $$;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(68, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: geeft 7 | 1 | 1 | 68 terug (nieuwe kolommen, tabel, view, schemaversie)
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'goedkeuringen'
          and column_name in ('aannemers', 'beslist_ip', 'beslist_agent', 'bevestiging_op', 'bevestiging_drive_id', 'bevestiging_document', 'bevestiging_sha'))::int as kolommen,
       (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'goedkeuring_aannemers')::int as tabel,
       (select count(*) from information_schema.views where table_schema = 'public' and table_name = 'aan_meerwerk')::int as view,
       (select (value->>'versie_schema')::int from public.instellingen where key = 'app') as schema;
