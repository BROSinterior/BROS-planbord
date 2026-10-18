-- =====================================================================
--  BROS Planbord — databasescript 046: portaaltoegang altijd aan de juiste login koppelen
--  Probleem: had een contact al een login (bv. een ouder e-mailadres) en nodigde je hem opnieuw uit op een nieuw adres,
--  dan kreeg hij wel een nieuwe login, maar de contactfiche bleef aan de oude login hangen → "Nog geen project gekoppeld".
--  Nu: een uitnodiging (portaal_koppel, via het Drive-script) koppelt de contactfiche aan de login van het adres waarnaar je uitnodigt.
--  De oude login verliest daarmee de toegang tot die contactfiche (enkel als hij aan geen andere fiche hangt, wordt hij op inactief gezet).
--  Heeft de fiche al een actieve login met een ándere rol (klant ↔ aannemer), dan stopt de uitnodiging met een duidelijke melding.
--  Vereist schema 45. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 45 then
    raise exception 'Voer eerst de scripts tot en met 045 uit.';
  end if;
end $$;

create or replace function public.portaal_koppel(p_user uuid, p_rol text, p_contact uuid)
returns void language plpgsql security definer set search_path = public as $$
declare huidig text; oud uuid;
begin
  if p_rol not in ('klant', 'aannemer') then raise exception 'Ongeldige rol.'; end if;
  select role into huidig from public.profiles where id = p_user;
  if huidig is null then raise exception 'Profiel niet gevonden.'; end if;
  if huidig in ('beheer') or (huidig = 'medewerker' and exists (select 1 from public.profiles where id = p_user and active)) then
    raise exception 'Dit e-mailadres hoort bij een teamlid van het Planbord.';
  end if;
  update public.profiles set role = p_rol, active = true where id = p_user;
  if p_contact is not null then
    select user_id into oud from public.contacten where id = p_contact;
    -- hangt er een actieve login met een ándere rol aan (bv. iemand die aannemer én bouwheer is): niet stil omzetten
    if oud is not null and oud <> p_user and exists (select 1 from public.profiles where id = oud and active and role in ('klant', 'aannemer') and role <> p_rol) then
      raise exception 'Deze contactfiche heeft al een login als % (een andere rol). Maak voor de rol % een aparte contactfiche met een eigen e-mailadres.', (select role from public.profiles where id = oud), p_rol;
    end if;
    update public.contacten set user_id = p_user where id = p_contact;   -- 046: ook als er al een (andere) login aan hing
    -- de vorige login hangt nergens meer aan: op inactief (geen portaal zonder contactfiche); een teamlid nooit
    if oud is not null and oud <> p_user and not exists (select 1 from public.contacten where user_id = oud) then
      update public.profiles set active = false where id = oud and role in ('klant', 'aannemer');
    end if;
  end if;
  delete from public.tarieven where user_id = p_user;
end $$;
revoke all on function public.portaal_koppel(uuid, text, uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.portaal_koppel(uuid, text, uuid) to service_role';
  end if;
end $$;

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
revoke all on function public.werfpunt_antwoord() from public, anon, authenticated;
revoke all on function public.pb_gebruik() from public, anon, authenticated;
grant execute on function public.pb_gebruik() to service_role;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(46, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle 1: moet 1 teruggeven
select count(*)::int as functie from pg_proc where proname = 'portaal_koppel' and prosrc like '%046%';
-- Controle 2: klant- of aannemerslogins die aan geen enkele contactfiche hangen (die zien "nog geen project") — nakijken
select p.email, p.role, p.active, p.created_at::date as sinds
  from public.profiles p
 where p.role in ('klant', 'aannemer') and p.active and not exists (select 1 from public.contacten c where c.user_id = p.id)
 order by p.created_at;
