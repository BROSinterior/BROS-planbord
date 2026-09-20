-- =====================================================================
--  BROS Planbord — databasescript 026: telefoonnummers uniform opslaan als +32/471.93.06.33
--  - tel_format(): maakt van elke schrijfwijze (0471 93 06 33, +32471930633, 0032…, 03/123.45.67) het BROS-formaat
--    mobiel +32/471.93.06.33 · vast +32/3.123.45.67 of +32/16.12.34.56 · buitenland +31/612.34.56.78
--  - trigger op contacten (gsm, tel) en projecten (gsm1, gsm2): ook bij import (Yuki, Excel) en in het Planbord zelf
--  - bestaande nummers worden eenmalig omgezet
--  Vereist schema 25. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 25 then
    raise exception 'Voer eerst de scripts tot en met 025 uit.';
  end if;
end $$;

create or replace function public.tel_format(s text)
returns text language plpgsql immutable as $$
declare t text; d text; n text; cc text;
begin
  t := trim(coalesce(s, '')); if t = '' then return ''; end if;
  d := regexp_replace(t, '[^0-9+]', '', 'g'); if d = '' then return t; end if;
  if left(d, 2) = '00' then d := '+' || substr(d, 3); end if;
  if left(d, 1) <> '+' then
    if left(d, 1) = '0' then d := '+32' || substr(d, 2);
    elsif length(d) in (8, 9) then d := '+32' || d;
    else return t; end if;
  end if;
  if left(d, 3) = '+32' then
    n := regexp_replace(substr(d, 4), '^0', '');
    if length(n) = 9 then return '+32/' || substr(n, 1, 3) || '.' || substr(n, 4, 2) || '.' || substr(n, 6, 2) || '.' || substr(n, 8, 2); end if;
    if length(n) = 8 then
      if left(n, 1) in ('2', '3', '4', '9') then return '+32/' || substr(n, 1, 1) || '.' || substr(n, 2, 3) || '.' || substr(n, 5, 2) || '.' || substr(n, 7, 2); end if;
      return '+32/' || substr(n, 1, 2) || '.' || substr(n, 3, 2) || '.' || substr(n, 5, 2) || '.' || substr(n, 7, 2);
    end if;
    return '+32/' || n;
  end if;
  -- ander land: landcode (2 cijfers, behalve +1 en +7) en de rest in groepen
  cc := substr(d, 2, 1);
  if cc not in ('1', '7') then cc := substr(d, 2, 2); end if;
  n := regexp_replace(substr(d, 2 + length(cc)), '^0', '');
  if length(n) < 4 then return t; end if;
  if length(n) = 9 then return '+' || cc || '/' || substr(n, 1, 3) || '.' || substr(n, 4, 2) || '.' || substr(n, 6, 2) || '.' || substr(n, 8, 2); end if;
  if length(n) = 10 then return '+' || cc || '/' || substr(n, 1, 3) || '.' || substr(n, 4, 3) || '.' || substr(n, 7, 2) || '.' || substr(n, 9, 2); end if;
  return '+' || cc || '/' || n;
end $$;

create or replace function public.tel_trigger()
returns trigger language plpgsql as $$
begin
  if tg_table_name = 'contacten' then
    new.gsm := public.tel_format(new.gsm); new.tel := public.tel_format(new.tel);
  else
    new.gsm1 := public.tel_format(new.gsm1); new.gsm2 := public.tel_format(new.gsm2);
  end if;
  return new;
end $$;
drop trigger if exists contacten_tel on public.contacten;
create trigger contacten_tel before insert or update of gsm, tel on public.contacten for each row execute function public.tel_trigger();
drop trigger if exists projecten_tel on public.projecten;
create trigger projecten_tel before insert or update of gsm1, gsm2 on public.projecten for each row execute function public.tel_trigger();

-- bestaande nummers omzetten
update public.contacten set gsm = public.tel_format(gsm), tel = public.tel_format(tel)
  where gsm <> public.tel_format(gsm) or tel <> public.tel_format(tel);
update public.projecten set gsm1 = public.tel_format(gsm1), gsm2 = public.tel_format(gsm2)
  where gsm1 <> public.tel_format(gsm1) or gsm2 <> public.tel_format(gsm2);

update public.instellingen set value = jsonb_set(value, '{versie_schema}', '26'::jsonb), updated_at = now() where key = 'app';

-- Controle: moet +32/471.93.06.33 teruggeven
select public.tel_format('0471 93 06 33');
