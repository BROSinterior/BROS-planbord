-- =====================================================================
--  BROS Planbord — databasescript 060: projectfase volgt automatisch het werk (v1.64)
--  De fase van een project (= wat de klant in het portaal ziet: "Je project zit in stap …") schuift
--  vanzelf op, alleen vooruit:
--    · de verste fase met een taak van BROS die bezig of klaar is (enkel actieve fasen; taken van klant/aannemer tellen niet);
--    · mijlpaal: een goedgekeurde overeenkomst            → minstens de fase "Opmeting";
--    · mijlpaal: de eerste gepubliceerde ontwerpronde      → minstens de fase "… voorontwerp".
--  Uitzonderingen: projecten met status 'verloren', het interne project en projecten waarvan de fase
--  vastgezet is (projecten.fase_vast). Zelf een fase kiezen in het projectformulier blijft mogelijk.
--  Elke wijziging komt in public.fase_log (van → naar, waarom, door wie).
--  Bij het uitvoeren krijgen alle projecten meteen hun berekende fase (alleen vooruit).
--  Alleen toevoegingen; mag opnieuw uitgevoerd worden.
-- =====================================================================

alter table public.projecten add column if not exists fase_vast boolean not null default false;   -- true = nooit automatisch verschuiven
alter table public.projecten add column if not exists fase_bron text not null default '';         -- 'auto' | 'manueel' | '' (van voor 060)
alter table public.projecten add column if not exists fase_reden text not null default '';        -- bv. taak „Opmeting ter plaatse” klaar
alter table public.projecten add column if not exists fase_sinds timestamptz;                     -- wanneer de fase laatst wijzigde

create table if not exists public.fase_log (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projecten(id) on delete cascade,
  van         int,
  naar        int,
  bron        text not null check (bron in ('auto', 'manueel')),
  reden       text not null default '',
  door        uuid,
  op          timestamptz not null default now()
);
create index if not exists fase_log_project_idx on public.fase_log(project_id, op desc);
alter table public.fase_log enable row level security;
drop policy if exists fase_log_intern on public.fase_log;
create policy fase_log_intern on public.fase_log for select to authenticated using (public.is_intern());
revoke all on public.fase_log from anon, authenticated;
grant select on public.fase_log to authenticated;   -- lezen enkel voor het team (policy); schrijven enkel via de functies hieronder

-- ---------- berekening (wijzigt niets): verste fase + waarom ----------
create or replace function public.project_fase_bereken(p_project uuid, out nr int, out reden text)
language plpgsql stable security definer set search_path = public as $$
declare t record; m int; v_ronde int;
begin
  -- rechtstreeks via de API enkel voor het team (triggers en het script zelf mogen altijd)
  if pg_trigger_depth() = 0 and auth.uid() is not null and not public.is_intern() then raise exception 'Geen toegang.'; end if;
  nr := 0; reden := '';
  -- 1. werk: de verste actieve fase met een taak die bezig of klaar is
  select tk.fase_nr, tk.titel, tk.status into t
    from public.taken tk join public.fasen f on f.nr = tk.fase_nr and f.actief
   where tk.project_id = p_project and tk.status in ('busy', 'done')
     and tk.contact_id is null                                    -- werk van BROS: taken van de klant of een aannemer duwen de fase niet
   order by tk.fase_nr desc, tk.updated_at desc nulls last limit 1;
  if t.fase_nr is not null then
    nr := t.fase_nr;
    reden := 'taak „' || left(t.titel, 80) || '” ' || case when t.status = 'done' then 'klaar' else 'bezig' end;
  end if;
  -- 2. mijlpaal: overeenkomst goedgekeurd → minstens Opmeting
  if exists (select 1 from public.goedkeuringen where project_id = p_project and soort = 'overeenkomst' and status = 'akkoord') then
    select f.nr into m from public.fasen f where f.actief and f.naam ilike '%opmeting%' and f.naam not ilike '%maatwerk%'
     order by (lower(btrim(f.naam)) = 'opmeting') desc, f.nr limit 1;
    if m is not null and m > nr then nr := m; reden := 'overeenkomst goedgekeurd'; end if;
  end if;
  -- 3. mijlpaal: eerste ontwerpronde gepubliceerd → minstens Bespreking voorontwerp
  select min(r.nummer) into v_ronde from public.ontwerp_rondes r where r.project_id = p_project and r.status <> 'concept';
  if v_ronde is not null then
    select f.nr into m from public.fasen f where f.actief and f.naam ilike '%voorontwerp%' order by f.nr limit 1;
    if m is null then select min(f.nr) into m from public.fasen f where f.actief and f.naam ilike '%ontwerp%'; end if;
    if m is not null and m > nr then nr := m; reden := 'ontwerpronde V' || v_ronde || ' gepubliceerd'; end if;
  end if;
end $$;

-- ---------- toepassen: alleen vooruit, nooit bij vastgezet / verloren / intern ----------
create or replace function public.project_fase_auto(p_project uuid, p_voorvoegsel text default '')
returns int language plpgsql security definer set search_path = public as $$
declare p public.projecten; b record;
begin
  if pg_trigger_depth() = 0 and auth.uid() is not null and not public.is_intern() then raise exception 'Geen toegang.'; end if;
  select * into p from public.projecten where id = p_project for update;   -- twee taken tegelijk afgevinkt: na elkaar, nooit achteruit
  if p.id is null or p.fase_vast or p.status = 'verloren' or coalesce(p.intern, false) then return p.fase_nr; end if;
  select * into b from public.project_fase_bereken(p_project);
  if coalesce(b.nr, 0) <= coalesce(p.fase_nr, 0) then return p.fase_nr; end if;
  perform set_config('bros.fase_auto', '1', true);
  update public.projecten
     set fase_nr = b.nr, fase_bron = 'auto', fase_reden = coalesce(p_voorvoegsel, '') || b.reden, fase_sinds = now()
   where id = p_project;
  perform set_config('bros.fase_auto', '', true);
  insert into public.fase_log (project_id, van, naar, bron, reden, door) values (p_project, p.fase_nr, b.nr, 'auto', coalesce(p_voorvoegsel, '') || b.reden, auth.uid());
  return b.nr;
end $$;

-- ---------- zelf gekozen fase, vastzetten / loslaten ----------
create or replace function public.projecten_fase_regels()
returns trigger language plpgsql security definer set search_path = public as $$
declare b record;
begin
  if coalesce(current_setting('bros.fase_auto', true), '') = '1' then return new; end if;   -- wijziging door project_fase_auto
  if new.fase_nr is distinct from old.fase_nr then
    new.fase_bron := 'manueel'; new.fase_reden := ''; new.fase_sinds := now();
    insert into public.fase_log (project_id, van, naar, bron, reden, door)
    values (new.id, old.fase_nr, new.fase_nr, 'manueel', case when new.fase_vast then 'zelf gekozen en vastgezet' else 'zelf gekozen' end, auth.uid());
  end if;
  -- losgelaten of status gewijzigd → meteen herberekenen (alleen vooruit); een fase die je in dezelfde bewaring zelf koos, wint
  if ((old.fase_vast and not new.fase_vast) or new.status is distinct from old.status) and new.fase_nr is not distinct from old.fase_nr
     and not new.fase_vast and new.status <> 'verloren' and not coalesce(new.intern, false) then
    select * into b from public.project_fase_bereken(new.id);
    if coalesce(b.nr, 0) > coalesce(new.fase_nr, 0) then
      insert into public.fase_log (project_id, van, naar, bron, reden, door) values (new.id, new.fase_nr, b.nr, 'auto', b.reden, auth.uid());
      new.fase_nr := b.nr; new.fase_bron := 'auto'; new.fase_reden := b.reden; new.fase_sinds := now();
    end if;
  end if;
  return new;
end $$;
drop trigger if exists projecten_fase_regels on public.projecten;
create trigger projecten_fase_regels before update of fase_nr, fase_vast, status on public.projecten
  for each row execute function public.projecten_fase_regels();

-- ---------- de signalen: taak bezig/klaar, overeenkomst akkoord, ontwerpronde gepubliceerd ----------
create or replace function public.fase_sig_taak()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.project_fase_auto(new.project_id);
  return null;
end $$;
drop trigger if exists taken_fase_auto on public.taken;
create trigger taken_fase_auto after insert or update of status, fase_nr, project_id on public.taken
  for each row when (new.status in ('busy', 'done') and new.fase_nr is not null and new.project_id is not null and new.contact_id is null)
  execute function public.fase_sig_taak();

create or replace function public.fase_sig_mijlpaal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.project_fase_auto(new.project_id);
  return null;
end $$;
drop trigger if exists goedkeuringen_fase_auto on public.goedkeuringen;
create trigger goedkeuringen_fase_auto after insert or update of status on public.goedkeuringen
  for each row when (new.soort = 'overeenkomst' and new.status = 'akkoord')
  execute function public.fase_sig_mijlpaal();
drop trigger if exists ontwerp_rondes_fase_auto on public.ontwerp_rondes;
create trigger ontwerp_rondes_fase_auto after insert or update of status on public.ontwerp_rondes
  for each row when (new.status <> 'concept')
  execute function public.fase_sig_mijlpaal();

-- realtime: het team ziet de fase live verschuiven (projecten zit al in de publicatie; voor de zekerheid)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'projecten') then
    alter publication supabase_realtime add table public.projecten;
  end if;
end $$;

-- rechten: bewust geen rechten_herstellen() (die zet ook de interne functies van eerdere scripts weer open).
-- Niets hiervan is rechtstreeks via de API op te roepen; de triggers lopen als eigenaar.
do $$ declare f text; begin
  foreach f in array array['project_fase_bereken(uuid)', 'project_fase_auto(uuid, text)', 'projecten_fase_regels()', 'fase_sig_taak()', 'fase_sig_mijlpaal()'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
  end loop;
end $$;

-- ---------- meteen opruimen: elk project krijgt zijn berekende fase (alleen vooruit) ----------
do $$ declare r record; begin
  for r in select id from public.projecten where status <> 'verloren' and not coalesce(intern, false) and not fase_vast loop
    perform public.project_fase_auto(r.id, 'eerste berekening: ');
  end loop;
end $$;

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(60, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: geeft 4 | 2 | 3 | 60 terug (nieuwe kolommen, functies, triggers, schemaversie)
-- plus het aantal projecten dat bij deze uitvoering automatisch opschoof.
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'projecten' and column_name in ('fase_vast', 'fase_bron', 'fase_reden', 'fase_sinds'))::int as kolommen,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('project_fase_bereken', 'project_fase_auto'))::int as functies,
       (select count(*) from pg_trigger where tgname in ('taken_fase_auto', 'goedkeuringen_fase_auto', 'ontwerp_rondes_fase_auto'))::int as triggers,
       (select (value->>'versie_schema')::int from public.instellingen where key = 'app') as schema,
       (select count(*) from public.fase_log where bron = 'auto' and reden like 'eerste berekening:%' and op > now() - interval '5 minutes')::int as opgeschoven;
