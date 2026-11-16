-- =====================================================================
--  BROS Planbord — databasescript 066: rechtstreeks factureren in Yuki (v1.73, proefmodus)
--  vorderingen.yuki_verstuurd_op / yuki_bericht: wanneer het Drive-script de factuur in Yuki aanmaakte (bij "Te verzenden")
--  en wat Yuki antwoordde. Zo stuurt niemand dezelfde vordering twee keer door. Enkel het Drive-script vult dit in.
--  Vereist schema 65. Alleen toevoegingen; mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 65 then
    raise exception 'Voer eerst de scripts tot en met 065 uit.';
  end if;
end $$;

alter table public.vorderingen add column if not exists yuki_verstuurd_op timestamptz;
alter table public.vorderingen add column if not exists yuki_bericht text;

-- enkel het Drive-script (service key) zet dit; vanuit het Planbord niet te wijzigen
create or replace function public.vordering_yuki_bescherming()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and (new.yuki_verstuurd_op is distinct from old.yuki_verstuurd_op or new.yuki_bericht is distinct from old.yuki_bericht) then
    raise exception 'Enkel het Drive-script kan een vordering als "naar Yuki gestuurd" markeren.';
  end if;
  return new;
end $$;
drop trigger if exists vorderingen_yuki_bescherming on public.vorderingen;
create trigger vorderingen_yuki_bescherming before update on public.vorderingen for each row execute function public.vordering_yuki_bescherming();
do $$ begin revoke all on function public.vordering_yuki_bescherming() from public, anon; end $$;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(66, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: geeft 2 | 1 | 66 terug (kolommen, trigger, schemaversie)
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'vorderingen' and column_name in ('yuki_verstuurd_op', 'yuki_bericht'))::int as kolommen,
       (select count(*) from pg_trigger where tgname = 'vorderingen_yuki_bescherming')::int as trigger,
       (select (value->>'versie_schema')::int from public.instellingen where key = 'app') as schema;
