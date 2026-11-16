"""1.72 — script 065 (wijzigingenlogboek), één realtime-kanaal, bijwerken na een pauze, zware tabellen na de eerste weergave,
modules pas laden wanneer nodig, app.js opgesplitst."""
import os, sys, json; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib")); from h import *
herstel("basis")
R = {}
def ok(k, c, x=""): R[k] = "OK" if c else "FOUT " + str(x)[:600]
r = psql_file(REPO + "/sql/065_wijzigingen.sql"); import re; ok("065 mag opnieuw (controle 1|…|65)", re.search(r"^1\|\d+\|6[5-9]$", r.stdout, re.M) is not None, r.stdout[-300:] + r.stderr[-300:])
n_trig = pg("select count(*) from pg_trigger where tgname='pb_wijz'")[0]; ok("trigger op ±60 tabellen", n_trig >= 60, n_trig)
# ---- databank ----
pg("delete from pb_wijzigingen", f=None)
T1 = pg("insert into taken (project_id, titel, status) values (%s,'Tegels bestellen','todo') returning id::text", (P,))[0]
pg("update taken set titel='Tegels bestellen (Villeroy)' where id=%s", (T1,), f=None)
log = pg("select tabel, sleutel, op from pb_wijzigingen order by id", f="all")
ok("insert + update van een taak → I en U met het id", log[:2] == [("taken", T1, "I"), ("taken", T1, "U")], log)
post = pg("select id::text from meetstaat_posten where project_id=%s limit 1", (P,))[0]
pg("delete from pb_wijzigingen", f=None); pg("update meetstaat_prijzen set eenheidsprijs=eenheidsprijs+1 where post_id=%s", (post,), f=None)
ok("prijs wijzigen → meetstaat_posten U (sleutel = post)", set(pg("select tabel, sleutel, op from pb_wijzigingen", f="all")) == {("meetstaat_posten", post, "U")}, pg("select * from pb_wijzigingen", f="all"))
pg("delete from pb_wijzigingen", f=None)
pg("insert into instellingen (key, value) values ('t72', '{}'::jsonb) on conflict (key) do update set value=excluded.value", f=None)
ok("instellingen: sleutel = key", ("instellingen", "t72", "I") in pg("select tabel, sleutel, op from pb_wijzigingen", f="all") or ("instellingen", "t72", "U") in pg("select tabel, sleutel, op from pb_wijzigingen", f="all"))
pg("delete from instellingen where key='t72'", f=None)
ok("verwijderen → D", ("instellingen", "t72", "D") in pg("select tabel, sleutel, op from pb_wijzigingen", f="all"))
ok("medewerker leest het logboek, klant niet", als(M, "select count(*) from pb_wijzigingen")[0] >= 1 and als(K, "select count(*) from pb_wijzigingen")[0] == 0)
ok("niemand schrijft zelf in het logboek", fout(B, "insert into pb_wijzigingen (tabel, sleutel, op) values ('taken','x','I')") is not None)
pg("insert into pb_wijzigingen (tabel, sleutel, op) values ('yuki_facturen','y1','U')", f=None)
ok("Yuki-wijzigingen enkel zichtbaar voor beheer", als(M, "select count(*) from pb_wijzigingen where tabel='yuki_facturen'")[0] == 0 and als(B, "select count(*) from pb_wijzigingen where tabel='yuki_facturen'")[0] == 1)
pg("insert into pb_wijzigingen (tabel, sleutel, op, ts) values ('taken','oud','U', now() - interval '5 days')", f=None)
r = psql_file(REPO + "/sql/065_wijzigingen.sql"); ok("opruimen: regels ouder dan 3 dagen weg", pg("select count(*) from pb_wijzigingen where sleutel='oud'")[0] == 0)
# ---- Planbord ----
start_postgrest(); poort(); zetapp()
SPION = r"""(() => { window.__joins = []; const o = WebSocket.prototype.send; WebSocket.prototype.send = function (d) { window.__ws = this; try { const m = JSON.parse(d); if (m.event === 'phx_join') window.__joins.push(m.topic); } catch (e) { } return o.call(this, d); }; })();"""
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.chromium.launch(); p, errs = nieuwe_pagina(b, 1440, 950); p.context.add_init_script(SPION)
    req = []; p.on("request", lambda q: req.append(q.url))
    login(p, "beheer@test.local")
    ok("versie ≥ 1.72.0", tuple(map(int, p.evaluate("() => APP_VERSION").split("."))) >= (1, 72, 0))
    ok("opgesplitst: meetstaat.js, werf.js, facturatie.js geladen", p.evaluate("() => [typeof vMeetstaat, typeof vWerf, typeof vordCalc, typeof vFacturatie].join()") .count("function") == 4, p.evaluate("() => [typeof vMeetstaat, typeof vWerf, typeof vordCalc, typeof vFacturatie].join()"))
    ok("tekenmodule en renders nog niet geladen bij het opstarten", p.evaluate("() => typeof vTekenen === 'undefined' && typeof vRenders === 'undefined'"), [u for u in req if "tekenen" in u or "renders" in u])
    ok("zware tabellen geladen na de eerste weergave", wacht(lambda: p.evaluate("() => S.zwaarKlaar === true && Object.keys(S.documenten).length >= 2")))
    ok("stand van het logboek gekend na het opstarten", p.evaluate("() => !!S.wzTs"))
    topics = p.evaluate("() => window.__joins")
    ok("één realtime-kanaal (pb-wijzigingen) i.p.v. één per tabel", [t for t in topics if "pb-" in t] == ["realtime:pb-wijzigingen"], topics)
    # realtime: een wijziging van een collega komt binnen via het logboek
    T2 = pg("insert into taken (project_id, titel, status) values (%s,'Kast tekenen','todo') returning id::text", (P,))[0]
    w = pg("select id, tabel, sleutel, op, ts::text from pb_wijzigingen where tabel='taken' and sleutel=%s order by id desc limit 1", (T2,))
    rec = {"id": w[0], "tabel": w[1], "sleutel": w[2], "op": w[3], "ts": w[4]}
    p.evaluate("""(rec) => { const ws = window.__ws; ws.onmessage({ data: JSON.stringify({ topic: 'realtime:pb-wijzigingen', event: 'postgres_changes', ref: null,
        payload: { ids: [1], data: { type: 'INSERT', schema: 'public', table: 'pb_wijzigingen', commit_timestamp: new Date().toISOString(), errors: null,
          columns: [{ name: 'id', type: 'int8' }, { name: 'tabel', type: 'text' }, { name: 'sleutel', type: 'text' }, { name: 'op', type: 'text' }, { name: 'ts', type: 'timestamptz' }], record: rec } } }) }); }""", rec)
    ok("realtime: nieuwe taak van een collega verschijnt (enkel die rij opgehaald)", wacht(lambda: p.evaluate(f"() => !!S.taken['{T2}']")), p.evaluate("() => Object.keys(S.taken).length"))
    # na een pauze: enkel de wijzigingen
    pg("update taken set titel='Kast tekenen (eik)' where id=%s", (T2,), f=None)
    pg("delete from documenten where id=%s", (D2,), f=None)
    pg("update meetstaat_prijzen set eenheidsprijs=eenheidsprijs+5 where post_id=%s", (post,), f=None)
    voor = p.evaluate(f"() => S.meetstaat_posten['{post}'] && S.meetstaat_posten['{post}'].verkoop_ep")
    req.clear(); p.evaluate("() => refetchAll()"); p.wait_for_timeout(1500)
    rest = [u for u in req if "/rest/v1/" in u]
    ok("na een pauze: titel bijgewerkt, document weg, prijs herrekend",
       p.evaluate(f"() => S.taken['{T2}'].titel") == "Kast tekenen (eik)" and p.evaluate(f"() => !S.documenten['{D2}']") and p.evaluate(f"() => S.meetstaat_posten['{post}'].verkoop_ep") != voor,
       (p.evaluate(f"() => S.taken['{T2}'] && S.taken['{T2}'].titel"), p.evaluate(f"() => !!S.documenten['{D2}']"), voor))
    ok("na een pauze: een handvol aanvragen i.p.v. ±65 tabellen", len(rest) <= 8 and any("pb_wijzigingen" in u for u in rest) and not any("/rest/v1/uren" in u for u in rest), rest)
    # 'Laden…' zolang de zware tabellen niet binnen zijn, enkel op schermen die ze nodig hebben
    txt = p.evaluate("() => { S.zwaarKlaar = false; S.view = 'notities'; render(); const a = document.querySelector('main').innerText; S.view = 'overzicht'; render(); const b = document.querySelector('main').innerText; S.zwaarKlaar = true; render(); return [a, b]; }")
    ok("'Laden…' op Notities zolang de zware tabellen laden, niet op Overzicht", "Laden" in txt[0] and "Laden…" not in txt[1], [t[:120] for t in txt])
    # modules bij het openen
    p.evaluate(f"() => {{ S.view='projecten'; S.project='{P}'; S.ptab='tekenen'; render(); }}")
    ok("tab Plannen laadt de tekenmodule", wacht(lambda: p.evaluate("() => typeof vTekenen === 'function' && typeof p2cSectie === 'function' && typeof SYMBOLEN !== 'undefined'")) and wacht(lambda: p.locator("[data-act=tk-new]").count() >= 1), p.locator("main").inner_text()[:400])
    p.evaluate("() => { S.ptab='renders'; render(); }")
    ok("tab Renders laadt renders.js", wacht(lambda: p.evaluate("() => typeof vRenders === 'function'")) and "Renders laden" not in p.locator("main").inner_text())
    ok("tab Renders staat er ook vóór renders.js geladen is", p.locator(".subtabs [data-ptab=renders], .pgroepen [data-ptab=renders]").count() >= 1)
    ok("geen JS-fouten (beheer)", not [e for e in errs if "PE " in e], errs)
    p.screenshot(path=WORK + "/shots/t72.png")
    # medewerker
    m, e2 = nieuwe_pagina(b, 1280, 900); login(m, "medewerker@test.local")
    ok("medewerker: start en ziet het logboek (bijwerken werkt)", wacht(lambda: m.evaluate("() => S.ready && S.zwaarKlaar && !!S.wzTs")), m.evaluate("() => [S.ready, S.zwaarKlaar, S.wzTs]"))
    ok("geen JS-fouten (medewerker)", not [e for e in e2 if "PE " in e], e2)
for kk, v in R.items(): print(("  " if v == "OK" else "✗ ") + kk + ("" if v == "OK" else "  → " + v))
print(f"\n{sum(v == 'OK' for v in R.values())}/{len(R)} OK")
