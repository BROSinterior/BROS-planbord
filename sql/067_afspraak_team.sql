-- =====================================================================
--  BROS Planbord — databasescript 067: afspraak met meerdere mensen van BROS (v1.74)
--  taken.afspraak_team: wie van BROS nog mee naar de afspraak gaat (naast de verantwoordelijke). Het Drive-script zet
--  hen als gast op het agenda-item, zodat de afspraak in ieders Google Agenda staat, en hun initialen komen in de titel
--  ("PB + NDK/Klant, onderwerp"). In het Planbord staat de afspraak ook in hun weekagenda (Uren) en bij Mijn werk.
--  Vereist schema 66. Alleen toevoegingen; mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 66 then
    raise exception 'Voer eerst de scripts tot en met 066 uit.';
  end if;
end $$;

alter table public.taken add column if not exists afspraak_team uuid[] not null default '{}';

-- enkel medewerkers van BROS, zonder dubbels en zonder de verantwoordelijke zelf
create or replace function public.taak_afspraak_team()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.afspraak_team is null then new.afspraak_team := '{}'; end if;
  if tg_op = 'UPDATE' and new.afspraak_team = old.afspraak_team and new.assignee is not distinct from old.assignee then return new; end if;
  new.afspraak_team := coalesce((
    select array_agg(x.id order by x.eerste)
    from (select u.id, min(u.ord) as eerste from unnest(new.afspraak_team) with ordinality as u(id, ord) group by u.id) x
    join public.profiles p on p.id = x.id and p.role in ('beheer', 'medewerker')
    where x.id is distinct from new.assignee), '{}');
  return new;
end $$;
drop trigger if exists taken_afspraak_team on public.taken;
create trigger taken_afspraak_team before insert or update on public.taken for each row execute function public.taak_afspraak_team();
do $$ begin revoke all on function public.taak_afspraak_team() from public, anon; end $$;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(67, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: geeft 1 | 1 | 67 terug (kolom, trigger, schemaversie)
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'taken' and column_name = 'afspraak_team')::int as kolom,
       (select count(*) from pg_trigger where tgname = 'taken_afspraak_team')::int as trigger,
       (select (value->>'versie_schema')::int from public.instellingen where key = 'app') as schema;
