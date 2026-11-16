"""1.69 — Uren als weekagenda: blokken, slepen (nieuw, verschuiven, verlengen), afspraken bevestigen, team, lijst, rechten."""
import os, sys, datetime as dt; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib")); from h import *
from decimal import Decimal as D
herstel("basis")
start_postgrest(); poort(); zetapp()
vandaag = dt.date.today(); ma = vandaag - dt.timedelta(days=vandaag.weekday()); dag = lambda i: (ma + dt.timedelta(days=i)).isoformat()
# als vandaag maandag is, ligt dinsdag in de toekomst: gebruik de vorige week als basis
if vandaag.weekday() < 2: ma = ma - dt.timedelta(days=7)
T1 = "77777777-0000-0000-0000-000000000001"; T2 = "77777777-0000-0000-0000-000000000002"; T3 = "77777777-0000-0000-0000-000000000003"; T4 = "77777777-0000-0000-0000-000000000004"
for tid, d, van, tot, wie, titel in [(T1, dag(0), "09:00", "10:30", M, "Werfbezoek opmeting"), (T2, dag(1), "14:00", None, M, "Plaatsbezoek keuken"), (T3, dag(0), "11:00", "12:00", B, "Klantgesprek"), (T4, (vandaag + dt.timedelta(days=9)).isoformat(), "10:00", "11:00", M, "Toekomstige afspraak")]:
    pg("insert into taken (id, project_id, titel, assignee, start, eind, status, afspraak, afspraak_van, afspraak_tot) values (%s,%s,%s,%s,%s,%s,'todo','werf',%s,%s)", (tid, P, titel, wie, d, d, van, tot), f=None)
H1 = pg("insert into uren (project_id, user_id, datum, uren, tijd_van, tijd_tot, notitie) values (%s,%s,%s,2,'13:00','15:00','Tekenen') returning id::text", (P, M, dag(0)))[0]
H2 = pg("insert into uren (project_id, user_id, datum, uren, notitie) values (%s,%s,%s,1.5,'zonder tijd') returning id::text", (P, M, dag(2)))[0]
pg("insert into uren (project_id, user_id, datum, uren, tijd_van, tijd_tot) values (%s,%s,%s,7,'08:30','15:30')", (P, B, dag(0)), f=None)
R = {}
def ok(k, c, x=""): R[k] = "OK" if c else "FOUT " + str(x)[:700]
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.chromium.launch(); p, errs = nieuwe_pagina(b, 1400, 1000)
    login(p, "medewerker@test.local")
    ok("Wacht op jou: afspraken nog als uren te bevestigen", "nog als uren te bevestigen" in p.locator("body").inner_text(), p.locator("body").inner_text()[:1500])
    p.evaluate(f"() => {{ localStorage.removeItem('bros.uw.modus'); S.view = 'uren'; S.weekStart = '{ma.isoformat()}'; S.hoursUser = null; render(); }}"); p.wait_for_timeout(700)
    body = lambda: p.locator("body").inner_text()
    ok("Uren opent als weekagenda (Mijn week)", "Mijn week" in body() and p.locator(".uw-dag").count() == 5, body()[:800])
    ok("blok met tijd staat in de kolom van maandag", p.locator(f"[data-uw-dag='{dag(0)}'] [data-uw-h='{H1}']").count() == 1)
    blk = p.locator(f"[data-uw-h='{H1}']"); top = blk.evaluate("e => parseFloat(e.style.top)")
    ok("blok 13:00 staat op 6 uur onder 07:00 (360 px)", abs(top - 360) < 1, top)
    ok("uren zonder tijdstip als kaartje boven woensdag", p.locator(f"[data-edit-hours='{H2}']").count() == 1)
    a1 = p.locator(f"[data-uw-afs='{T1}']"); a2 = p.locator(f"[data-uw-afs='{T2}']")
    ok("eigen afspraken als stippellijn met ✓ Uren", a1.count() == 1 and a2.count() == 1 and a1.locator("[data-uw-ok]").count() == 1, body()[:1500])
    ok("afspraak van een ander (Phil) niet in mijn week", p.locator(f"[data-uw-afs='{T3}']").count() == 0)
    ok("melding: 2 afspraken nog zonder uren + 'Alle 2 boeken'", "2 afspraken deze week nog zonder uren" in body() and p.locator("[data-uw-allesok]").count() == 1)
    # bevestigen
    a1.locator("[data-uw-ok]").click(); p.wait_for_timeout(1200)
    u1 = pg("select datum::text, tijd_van::text, tijd_tot::text, uren, taak_id::text, project_id::text, user_id::text from uren where taak_id=%s", (T1,))
    ok("✓ Uren: geboekt met datum, 09:00–10:30, 1,5 u, taak en project", u1 == (dag(0), "09:00:00", "10:30:00", D("1.50"), T1, P, M), u1)
    ok("afspraak wordt een gewoon blok (zonder dubbele titel)", p.locator(f"[data-uw-afs='{T1}']").count() == 0 and p.locator(f".uw-b").count() >= 2 and p.locator(".uw-b", has_text="Werfbezoek opmeting").inner_text().count("Werfbezoek opmeting") == 1)
    # afspraak zonder einduur: 1 uur
    a2.locator("[data-uw-ok]").click(); p.wait_for_timeout(1200)
    ok("afspraak zonder einduur → 1 uur (14:00–15:00)", pg("select tijd_van::text, tijd_tot::text, uren from uren where taak_id=%s", (T2,)) == ("14:00:00", "15:00:00", D("1.00")))
    ok("Wacht op jou: niets meer te bevestigen", not p.evaluate("() => uwWachtItems().length"))
    # nieuw blok door te slepen op dinsdag 08:00–10:00
    col = p.locator(f"[data-uw-dag='{dag(1)}']"); bb = col.bounding_box()
    x = bb["x"] + bb["width"] / 2; y0 = bb["y"] + 60 + 2; y1 = bb["y"] + 180 - 8
    p.mouse.move(x, y0); p.mouse.down(); p.mouse.move(x, y0 + 30, steps=4); p.mouse.move(x, y1, steps=6)
    ghost = p.locator(".uw-geest").inner_text() if p.locator(".uw-geest").count() else ""
    p.mouse.up(); p.wait_for_timeout(600)
    ok("slepen toont 08:00–10:00 · 2 u", "08:00–10:00" in ghost, ghost)
    ok("formulier opent met datum, van, tot en 2 u", p.locator("#h_datum").input_value() == dag(1) and p.locator("#h_van").input_value() == "08:00" and p.locator("#h_tot").input_value() == "10:00" and p.locator("#h_uren").input_value() == "2", [p.locator(s).input_value() for s in ["#h_datum", "#h_van", "#h_tot", "#h_uren"]] if p.locator("#h_van").count() else body()[:500])
    ok("project voorgesteld = laatst gebruikte", p.locator("#h_proj").input_value() == P)
    p.fill("#h_not", "Plannen tekenen"); p.locator("#mform button[type=submit]").click(); p.wait_for_timeout(1200)
    n3 = pg("select id::text, uren from uren where notitie='Plannen tekenen'")
    ok("nieuw blok bewaard (2 u)", n3 and n3[1] == D("2.00"), n3)
    # verschuiven naar woensdag 10:00 (+2u)
    blk = p.locator(f"[data-uw-h='{H1}']"); bb = blk.bounding_box(); wo = p.locator(f"[data-uw-dag='{dag(2)}']").bounding_box()
    sx, sy = bb["x"] + 20, bb["y"] + 10
    p.mouse.move(sx, sy); p.mouse.down(); p.mouse.move(sx + 10, sy + 10, steps=3); p.mouse.move(wo["x"] + 30, sy - 180, steps=8); p.mouse.up(); p.wait_for_timeout(1500)
    h1 = pg("select datum::text, tijd_van::text, tijd_tot::text, uren from uren where id=%s", (H1,))
    ok("verschuiven: naar woensdag 10:00–12:00, uren blijven 2", h1 == (dag(2), "10:00:00", "12:00:00", D("2.00")), h1)
    # verlengen met de onderrand (+1 u)
    rek = p.locator(f"[data-uw-rek='{H1}']"); rb = rek.bounding_box()
    p.mouse.move(rb["x"] + 20, rb["y"] + 3); p.mouse.down(); p.mouse.move(rb["x"] + 20, rb["y"] + 20, steps=3); p.mouse.move(rb["x"] + 20, rb["y"] + 63, steps=6); p.mouse.up(); p.wait_for_timeout(1500)
    h1 = pg("select tijd_van::text, tijd_tot::text, uren from uren where id=%s", (H1,))
    ok("verlengen: 10:00–13:00 = 3 u", h1 == ("10:00:00", "13:00:00", D("3.00")), h1)
    # klikken = bewerken
    p.locator(f"[data-uw-h='{H1}'] b").click(); p.wait_for_timeout(500)
    ok("klik op een blok opent het formulier om te bewerken", p.locator("#modal").inner_text().startswith("Registratie bewerken"), p.locator("#modal").inner_text()[:200])
    p.keyboard.press("Escape"); p.locator("[data-close]").first.click() if p.locator("#modalBg.show").count() else None; p.wait_for_timeout(300)
    # niet gewerkt (✕) voor Phil zijn afspraak: als Phil
    # team
    p.locator("[data-uw-modus=team]").click(); p.wait_for_timeout(600)
    ok("team: tabel met Phil 7 u op maandag en Noa's week", "Uren van het team" in body() and p.locator(".uw-team").count() == 1 and "7" in p.locator(f"[data-uw-zie='{B}']").nth(1).inner_text(), body()[:1500])
    ok("team: 'te bevestigen' bij Phil = 1", "1" in p.locator(".uw-team tbody tr", has_text="Phil").locator("td").last.inner_text())
    p.locator(f".uw-wie[data-uw-zie='{B}']").click(); p.wait_for_timeout(600)
    ok("week van Phil: alleen lezen, geen ✓ Uren", "Week van Phil" in body() and "Alleen lezen" in body() and p.locator("[data-uw-ok]").count() == 0 and p.locator(".uw-dag.mag").count() == 0)
    n0 = pg("select count(*) from uren")[0]; col = p.locator(f"[data-uw-dag='{dag(3)}']").bounding_box(); p.mouse.click(col["x"] + 40, col["y"] + 100); p.wait_for_timeout(400)
    ok("klikken in de week van een ander opent geen formulier", p.locator("#modalBg.show").count() == 0)
    # lijst
    p.locator("[data-uw-modus=lijst]").click(); p.wait_for_timeout(500)
    ok("lijst: de vroegere tabel met de knoppen", "Registraties" in body() and p.locator("[data-uw-modus=agenda]").count() == 1)
    p.locator("[data-uw-modus=agenda]").click(); p.wait_for_timeout(300)
    p.evaluate("() => { S.hoursUser = null; render(); }"); p.wait_for_timeout(400)
    ok("geen JS-fouten (medewerker)", not [e for e in errs if "PE " in e], errs)
    p.screenshot(path=WORK + "/shots/uren1.png", full_page=True)
    # Phil: ✕ niet gewerkt
    q, e2 = nieuwe_pagina(b); login(q, "beheer@test.local")
    q.evaluate(f"() => {{ S.view = 'uren'; S.weekStart = '{ma.isoformat()}'; S.hoursUser = null; render(); }}"); q.wait_for_timeout(700)
    q.locator(f"[data-uw-afs='{T3}'] [data-uw-weg]").click(); q.wait_for_timeout(500)
    ok("✕ niet gewerkt: verdwijnt, geen uren", q.locator(f"[data-uw-afs='{T3}']").count() == 0 and pg("select count(*) from uren where taak_id=%s", (T3,))[0] == 0)
    # beheer mag in de week van Noa slepen
    q.evaluate(f"() => {{ S.hoursUser = '{M}'; render(); }}"); q.wait_for_timeout(500)
    ok("beheer: week van Noa is bewerkbaar", q.locator(".uw-dag.mag").count() == 5 and "Alleen lezen" not in q.locator("body").inner_text())
    ok("geen JS-fouten (beheer)", not [e for e in e2 if "PE " in e], e2)
    # smal scherm
    m, e3 = nieuwe_pagina(b, 390, 844); login(m, "medewerker@test.local"); m.evaluate(f"() => {{ S.view = 'uren'; S.weekStart = '{ma.isoformat()}'; render(); }}"); m.wait_for_timeout(600)
    ok("gsm: geen horizontaal scrollen van de pagina (enkel in de agenda)", m.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), m.evaluate("() => [document.documentElement.scrollWidth, window.innerWidth]"))
    m.screenshot(path=WORK + "/shots/uren-gsm.png")
for k, v in R.items(): print(("  " if v == "OK" else "✗ ") + k + ("" if v == "OK" else "  → " + v))
print(f"\n{sum(v == 'OK' for v in R.values())}/{len(R)} OK")
