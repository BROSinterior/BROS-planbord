-- =====================================================================
--  BROS Planbord — databasescript 065: wijzigingenlogboek voor sneller laden (v1.72)
--  Elke wijziging in een tabel van het Planbord laat een korte regel na in pb_wijzigingen (welke tabel, welke rij,
--  ingevoegd/gewijzigd/verwijderd — géén inhoud). Daarmee:
--   1. luistert het Planbord nog maar op één realtime-kanaal (i.p.v. één per tabel, ±60) en haalt het enkel de
--      gewijzigde rijen op;
--   2. hoeft het Planbord na een pauze (laptop dicht, ander tabblad) niet meer alles te herladen: het vraagt enkel
--      wat er sindsdien veranderde.
--  Regels ouder dan 3 dagen worden vanzelf opgeruimd. Vereist schema 64. Alleen toevoegingen; mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 64 then
    raise exception 'Voer eerst de scripts tot en met 064 uit.';
  end if;
end $$;

create table if not exists public.pb_wijzigingen (
  id      bigint generated always as identity primary key,
  tabel   text not null,
  sleutel text not null,            -- id (of nr, key …) van de rij; '*' = de hele tabel opnieuw ophalen
  op      text not null check (op in ('I', 'U', 'D')),
  ts      timestamptz not null default now()
);
create index if not exists pb_wijzigingen_ts on public.pb_wijzigingen (ts);
alter table public.pb_wijzigingen enable row level security;
drop policy if exists pw_lezen on public.pb_wijzigingen;
-- lezen: enkel BROS (klanten en aannemers hebben hun eigen portaal); tabellen die enkel beheer ziet, enkel voor beheer
create policy pw_lezen on public.pb_wijzigingen for select to authenticated
  using ((select public.is_intern()) and ((select public.is_beheer()) or tabel not in ('yuki_facturen', 'tarieven', 'fin_plan', 'fin_vaste_kosten', 'fin_instellingen', 'aannemer_facturen', 'betaalherinneringen')));
revoke all on public.pb_wijzigingen from anon, authenticated;
grant select on public.pb_wijzigingen to authenticated;   -- schrijven gebeurt enkel door de trigger

-- de trigger: tg_argv[0] = tabel zoals het Planbord ze kent, tg_argv[1] = sleutelkolom (of '*')
create or replace function public.pb_wijziging()
returns trigger language plpgsql security definer set search_path = public as $$
declare t text := tg_argv[0]; k text := tg_argv[1]; nieuw text; oud text; afgeleid boolean := tg_table_name <> t;
begin
  if k = '*' then
    insert into public.pb_wijzigingen (tabel, sleutel, op) values (t, '*', 'U');
  else
    if tg_op <> 'DELETE' then nieuw := to_jsonb(new) ->> k; end if;
    if tg_op <> 'INSERT' then oud := to_jsonb(old) ->> k; end if;
    if tg_op = 'DELETE' then
      insert into public.pb_wijzigingen (tabel, sleutel, op) values (t, coalesce(oud, '*'), case when afgeleid then 'U' else 'D' end);
    else
      if tg_op = 'UPDATE' and oud is distinct from nieuw and oud is not null and not afgeleid then
        insert into public.pb_wijzigingen (tabel, sleutel, op) values (t, oud, 'D');
      end if;
      insert into public.pb_wijzigingen (tabel, sleutel, op) values (t, coalesce(nieuw, '*'), case when tg_op = 'INSERT' and not afgeleid then 'I' else 'U' end);
    end if;
  end if;
  if random() < 0.002 then delete from public.pb_wijzigingen where ts < now() - interval '3 days'; end if;   -- af en toe opruimen
  return null;
end $$;
revoke all on function public.pb_wijziging() from public, anon, authenticated;

-- triggers op alle tabellen van het Planbord (enkel als de tabel bestaat)
do $$
declare r record; k text;
begin
  for r in select * from (values
    ('profiles','profiles','id'), ('tarieven','tarieven','user_id'), ('fasen','fasen','nr'), ('standaardtaken','standaardtaken','*'),
    ('projecten','projecten','id'), ('taken','taken','id'), ('uren','uren','id'), ('documenten','documenten','id'), ('instellingen','instellingen','key'),
    ('loten','loten','nr'), ('posten','posten','id'), ('meetstaat_posten','meetstaat_posten','id'), ('meetstaat_prijzen','meetstaat_posten','post_id'),
    ('vorderingen','vorderingen','id'), ('yuki_facturen','yuki_facturen','id'), ('vordering_regels','vordering_regels','id'),
    ('contacten','contacten','id'), ('project_contacten','project_contacten','id'), ('goedkeuringen','goedkeuringen','id'), ('notities','notities','id'),
    ('werfbezoeken','werfbezoeken','id'), ('vaststellingen','vaststellingen','id'), ('klant_timing','klant_timing','*'), ('werfplannen','werfplannen','id'),
    ('werfverslagen','werfverslagen','id'), ('taak_voorstellen','taak_voorstellen','id'), ('assistent_berichten','assistent_berichten','id'),
    ('prijsaanvragen','prijsaanvragen','id'), ('prijsaanvraag_regels','prijsaanvraag_regels','id'), ('tekenplannen','tekenplannen','id'),
    ('aannemer_meetstaten','aannemer_meetstaten','id'), ('aannemer_meetstaat_posten','aannemer_meetstaat_posten','id'), ('keuzes','keuzes','id'),
    ('keuze_opties','keuze_opties','id'), ('meerwerk_aanvragen','meerwerk_aanvragen','id'), ('werf_fotos','werf_fotos','id'), ('werf_updates','werf_updates','id'),
    ('woningdossier','woningdossier','id'), ('prijsvragen','prijsvragen','id'), ('prijsvraag_gunningen','prijsvraag_gunningen','*'),
    ('goedkeuring_tekenaars','goedkeuring_tekenaars','id'), ('aannemer_facturen','aannemer_facturen','id'), ('betaalherinneringen','betaalherinneringen','id'),
    ('fin_plan','fin_plan','id'), ('fin_vaste_kosten','fin_vaste_kosten','id'), ('fin_instellingen','fin_instellingen','id'), ('vergaderingen','vergaderingen','id'),
    ('vergadering_punten','vergadering_punten','id'), ('verwerkingen','verwerkingen','id'), ('verwerker_status','verwerker_status','naam'), ('ms_raming','ms_raming','id'),
    ('document_aannemers','document_aannemers','*'), ('plan_omzettingen','plan_omzettingen','id'), ('render_beelden','render_beelden','id'),
    ('render_opdrachten','render_opdrachten','id'), ('render_afspraken','render_afspraken','id'), ('render_presentaties','render_presentaties','id'),
    ('render_ruimtes','render_ruimtes','id'), ('render_standpunten','render_standpunten','id'), ('taak_punten','taak_punten','id'),
    ('ontwerp_rondes','ontwerp_rondes','id'), ('ontwerp_documenten','ontwerp_documenten','id'), ('ontwerp_feedback','ontwerp_feedback','id'),
    ('mijn_markeringen','mijn_markeringen','*')
  ) as v(tbl, tabel, sleutel) loop
    if to_regclass('public.' || r.tbl) is null or (select relkind from pg_class where oid = to_regclass('public.' || r.tbl)) <> 'r' then continue; end if;
    k := r.sleutel;
    -- tabel zonder die sleutelkolom (bv. een oudere vordering_regels zonder id): dan telkens de hele tabel
    if k <> '*' and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = r.tbl and column_name = k) then k := '*'; end if;
    execute format('drop trigger if exists pb_wijz on public.%I', r.tbl);
    execute format('create trigger pb_wijz after insert or update or delete on public.%I for each row execute function public.pb_wijziging(%L, %L)', r.tbl, r.tabel, k);
  end loop;
end $$;

-- opruimen bij het uitvoeren
delete from public.pb_wijzigingen where ts < now() - interval '3 days';

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'pb_wijzigingen') then
    alter publication supabase_realtime add table public.pb_wijzigingen;
  end if;
end $$;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(65, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: geeft 1 | ≥60 | 65 terug (tabel pb_wijzigingen, aantal tabellen met de trigger, schemaversie)
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'pb_wijzigingen')::int as tabel,
       (select count(*) from pg_trigger where tgname = 'pb_wijz')::int as triggers,
       (select (value->>'versie_schema')::int from public.instellingen where key = 'app') as schema;
