-- =====================================================================
--  BROS Planbord — databasescript 058: nieuwste beeldmodellen en geoptimaliseerde prompts (v1.62)
--  - Beeldmodel standaard gpt-image-2.5-sunburst (OpenAI, "editing precision matters most"); gpt-image-2.5-flare kan ook.
--  - Kwaliteit: naast low/medium/high ook xhigh en max (enkel de 2.5-modellen); lange zijde ook 3072 px.
--  - Prompt optimaliseren (standaard aan): de verwerkingscomputer laat een taalmodel van OpenAI (promptmodel, standaard
--    gpt-5.5; gpt-6-astra kan ook) eerst alle invoerbeelden bekijken en de BROS-instructie omzetten in een precieze
--    beeldopdracht — zoals ChatGPT dat doet — en daarna in dezelfde aanvraag het beeld maken. Nog altijd één betaalde
--    aanvraag per render, nooit automatisch herhaald. De gebruikte en de herschreven prompt worden per opdracht bewaard.
--  Vereist schema 57. Mag opnieuw uitgevoerd worden.
-- =====================================================================

do $$ begin
  if coalesce((select (value->>'versie_schema')::int from public.instellingen where key = 'app'), 0) < 57 then
    raise exception 'Voer eerst de scripts tot en met 057 uit.';
  end if;
end $$;

-- ---------- 1. kolommen ----------
alter table public.render_opdrachten drop constraint if exists render_opdrachten_kwaliteit_check;
alter table public.render_opdrachten add constraint render_opdrachten_kwaliteit_check check (kwaliteit in ('low', 'medium', 'high', 'xhigh', 'max'));
alter table public.render_opdrachten add column if not exists prompt_gebruikt text not null default '';     -- de BROS-instructie zoals verstuurd
alter table public.render_opdrachten add column if not exists prompt_herschreven text not null default '';  -- de geoptimaliseerde beeldopdracht (revised_prompt)
alter table public.render_opdrachten add column if not exists promptmodel text not null default '';         -- leeg = rechtstreeks naar het beeldmodel
alter table public.render_opdrachten add column if not exists optimaliseren boolean not null default false;  -- vastgelegd bij de aanvraag (oudere opdrachten: nee)

-- ---------- 2. instellingen ----------
create or replace function public.rd_instelling()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('model', coalesce(nullif(v->>'model', ''), 'gpt-image-2.5-sunburst'),
                            'kwaliteit', case when v->>'kwaliteit' in ('low', 'medium', 'high', 'xhigh', 'max') then v->>'kwaliteit' else 'medium' end,
                            'lange_zijde', case when (v->>'lange_zijde') in ('1536', '2048', '2560', '3072') then (v->>'lange_zijde')::int else 2048 end,
                            'daglimiet', least(greatest(coalesce((v->>'daglimiet')::int, 20), 0), 500),
                            'optimaliseren', coalesce((v->>'optimaliseren')::boolean, true),
                            'promptmodel', coalesce(nullif(v->>'promptmodel', ''), 'gpt-5.5'),
                            'controle', coalesce((v->>'controle')::boolean, true))
  from (select coalesce((select value from public.instellingen where key = 'render'), '{}'::jsonb) as v) x
$$;
revoke all on function public.rd_instelling() from public, anon, authenticated;

-- het rendermodel naar het nieuwste model zetten (enkel als het nog op gpt-image-2 of leeg stond), prompt optimaliseren aan
insert into public.instellingen (key, value) values ('render', '{}'::jsonb) on conflict (key) do nothing;
-- (enkel de eerste keer: wie daarna bewust terug naar gpt-image-2 gaat, houdt dat bij opnieuw uitvoeren)
update public.instellingen set value = value || jsonb_build_object('model', 'gpt-image-2.5-sunburst'), updated_at = now()
where key = 'render' and coalesce(nullif(value->>'model', ''), 'gpt-image-2') = 'gpt-image-2'
  and coalesce((select (i.value->>'versie_schema')::int from public.instellingen i where i.key = 'app'), 0) < 58;
update public.instellingen set value = jsonb_build_object('optimaliseren', true, 'promptmodel', 'gpt-5.5') || value, updated_at = now()
where key = 'render' and not (value ? 'optimaliseren');

-- ---------- 3. aanvraagfuncties: ook kwaliteit xhigh en max (de bestaande functies, enkel die controle verruimd) ----------
do $$
declare f text; def text; n int := 0;
begin
  foreach f in array array['render_aanvragen', 'render_stalenbord_aanvragen', 'render_standpunt_aanvragen'] loop
    select pg_get_functiondef(p.oid) into def from pg_proc p where p.proname = f and p.pronamespace = 'public'::regnamespace;
    if def is null then raise exception 'Functie % niet gevonden.', f; end if;
    if position($q$p_kwaliteit not in ('low', 'medium', 'high')$q$ in def) > 0 then
      execute replace(def, $q$p_kwaliteit not in ('low', 'medium', 'high')$q$, $q$p_kwaliteit not in ('low', 'medium', 'high', 'xhigh', 'max')$q$);
      n := n + 1;
    elsif position($q$p_kwaliteit not in ('low', 'medium', 'high', 'xhigh', 'max')$q$ in def) = 0 then
      raise exception 'Kwaliteitscontrole in % niet gevonden.', f;
    end if;
  end loop;
  raise notice '% aanvraagfunctie(s) bijgewerkt', n;
end $$;

-- ---------- 4. bij de aanvraag vastleggen: prompt optimaliseren + promptmodel; kwaliteit past bij het model ----------
-- (een latere wijziging in Instellingen verandert een al bevestigde opdracht niet; opdrachten van vóór 058 blijven zonder optimalisatie)
create or replace function public.rd_opdracht_prompt()
returns trigger language plpgsql security definer set search_path = public as $$
declare cfg jsonb := public.rd_instelling();
begin
  if new.kwaliteit in ('xhigh', 'max') and coalesce(new.model, '') !~ '^gpt-image-2\.5' then
    raise exception 'Kwaliteit "%" bestaat enkel bij gpt-image-2.5. Kies een andere kwaliteit (er werd niets betaald).', new.kwaliteit;
  end if;
  new.optimaliseren := coalesce(new.soort, 'render') = 'render' and coalesce((cfg->>'optimaliseren')::boolean, false);
  new.promptmodel := case when new.optimaliseren then coalesce(cfg->>'promptmodel', '') else '' end;
  return new;
end $$;
revoke all on function public.rd_opdracht_prompt() from public, anon, authenticated;
drop trigger if exists rd_opdracht_prompt on public.render_opdrachten;
create trigger rd_opdracht_prompt before insert on public.render_opdrachten for each row execute function public.rd_opdracht_prompt();

-- de verwerkingscomputer krijgt de vastgelegde keuze mee
do $$
declare def text; oud text := $q$'controle', coalesce((select (value->>'controle')::boolean from public.instellingen where key = 'render'), true)),$q$;
        nieuw text := $q$'controle', coalesce((select (value->>'controle')::boolean from public.instellingen where key = 'render'), true),
                                   'optimaliseren', coalesce(o.optimaliseren, false), 'promptmodel', coalesce(o.promptmodel, '')),$q$;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p where p.proname = 'render_claim' and p.pronamespace = 'public'::regnamespace;
  if position($q$'optimaliseren', coalesce(o.optimaliseren$q$ in def) = 0 then
    if position(oud in def) = 0 then raise exception 'render_claim heeft niet de verwachte vorm (script 057).'; end if;
    execute replace(def, oud, nieuw);
  end if;
end $$;

-- de gebruikte en de herschreven prompt bewaren (na de aanvraag; ook na render_klaar)
create or replace function public.render_prompt_bewaar(p_job uuid, p_claim uuid, p_prompt text, p_herschreven text, p_promptmodel text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.render_opdrachten;
begin
  o := public.rd_eigen(p_job, p_claim);
  update public.render_opdrachten set prompt_gebruikt = left(coalesce(p_prompt, ''), 20000), prompt_herschreven = left(coalesce(p_herschreven, ''), 20000),
         promptmodel = left(coalesce(p_promptmodel, ''), 80) where id = o.id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.render_prompt_bewaar(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.render_prompt_bewaar(uuid, uuid, text, text, text) to authenticated;   -- de functie controleert zelf de rol

update public.instellingen set value = jsonb_set(value, '{versie_schema}', to_jsonb(greatest(58, coalesce((value->>'versie_schema')::int, 0)))), updated_at = now() where key = 'app';

-- Controle: moet gpt-image-2.5-sunburst | true | 4 | 58 teruggeven (model, prompt optimaliseren, nieuwe kolommen, schemaversie).
select (select value->>'model' from public.instellingen where key = 'render') as model,
       (public.rd_instelling()->>'optimaliseren')::boolean as optimaliseren,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'render_opdrachten' and column_name in ('prompt_gebruikt', 'prompt_herschreven', 'promptmodel', 'optimaliseren'))::int as kolommen,
       (select (value->>'versie_schema')::int from public.instellingen where key = 'app') as schema;
