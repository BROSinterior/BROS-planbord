"""1.73 — Mijn werk, Google Agenda-afspraken in de weekagenda, Naar Yuki (proefmodus), script 066, minimale databankversie,
opgeruimde compatibiliteitscode."""
import os, sys, re, datetime; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib")); from h import *
herstel("basis")
VANDAAG = datetime.date.today(); dag = lambda n: (VANDAAG + datetime.timedelta(days=n)).isoformat(); MAANDAG = VANDAAG - datetime.timedelta(days=VANDAAG.weekday())
R = {}
def ok(k, c, x=""): R[k] = "OK" if c else "FOUT " + str(x)[:600]
# ---- databank: 066 ----
r = psql_file(REPO + "/sql/066_yuki_factureren.sql"); ok("066 mag opnieuw (controle 2|1|66)", re.search(r"^2\|1\|6[6-9]$", r.stdout, re.M) is not None, r.stdout[-200:] + r.stderr[-300:])
V3 = "eeeeeeee-0000-0000-0000-000000000003"
pg("insert into vorderingen (id, project_id, nr, soort, omschrijving, datum, status) values (%s,%s,3,'vordering','Vordering 3','2026-11-10','opgemaakt')", (V3, P), f=None)
pg("insert into vordering_regels (vordering_id, lot, pct) values (%s,1,0.2)", (V3,), f=None)
ok("Planbord kan 'naar Yuki gestuurd' niet zelf zetten", "Drive-script" in (fout(B, "update vorderingen set yuki_verstuurd_op=now() where id=%s", (V3,)) or ""))
ok("…het Drive-script (service) wel", pg("update vorderingen set yuki_bericht='x' where id=%s returning id::text", (V3,)) == (V3,))
pg("update vorderingen set yuki_bericht=null where id=%s", (V3,), f=None)
# ---- testgegevens Mijn werk ----
T_LAAT = pg("insert into taken (project_id, titel, status, assignee, eind) values (%s,'Offerte nakijken','todo',%s,%s) returning id::text", (P, B, dag(-7)))[0]
T_LATER = pg("insert into taken (project_id, titel, status, assignee, eind) values (%s,'Lichtplan tekenen','todo',%s,%s) returning id::text", (P, B, dag(40)))[0]
T_TODO = pg("insert into taken (project_id, titel, status, assignee, bundel) values (%s,'To do''s · werfvergadering','todo',%s,true) returning id::text", (P, B))[0]
pg("insert into taak_punten (taak_id, tekst, deadline) values (%s,'Stopcontacten keuken uitzetten',%s), (%s,'Stalen bestellen',null)", (T_TODO, dag(0), T_TODO), f=None)
pg("insert into vaststellingen (project_id, titel, omschrijving, assignee, deadline, status) values (%s,'Barst in de tegel','Barst naast de deur',%s,%s,'open')", (P, B, (MAANDAG + datetime.timedelta(days=9)).isoformat()), f=None)
pg("insert into taken (project_id, titel, status, assignee, eind) values (%s,'Klaar','done',%s,%s)", (P, B, dag(-7)), f=None)
pg("insert into keuzes (project_id, onderwerp, deadline, status) values (%s,'Kleur van de keukenfronten',%s,'open')", (P, dag(3)), f=None)
pg("insert into taak_voorstellen (project_id, titel, onderwerp, status, urgentie) values (%s,'Wanneer komt de schilder?','planning','open','normaal')", (P,), f=None)
# ---- Planbord ----
start_postgrest(); poort(); zetapp()
gw.AGENDA[:] = [
    {"id": "ga-1", "titel": "NO/ Showroom Alfa", "plaats": "Gent", "dag": dag(0), "van": "10:00", "tot": "11:30", "heledag": False, "gasten": [], "maker": "kantoor@test.local"},
    {"id": "ga-2", "titel": "Overleg aannemer", "plaats": "", "dag": dag(0), "van": "14:00", "tot": "15:00", "heledag": False, "gasten": ["medewerker@test.local"], "maker": "kantoor@test.local"},
    {"id": "ga-3", "titel": "PH/ Iets van Phil", "plaats": "", "dag": dag(1), "van": "09:00", "tot": "10:00", "heledag": False, "gasten": [], "maker": "kantoor@test.local"},
    {"id": "ga-4", "titel": "Verlof", "plaats": "", "dag": dag(2), "van": None, "tot": None, "heledag": True, "gasten": ["medewerker@test.local"], "maker": ""}]
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.chromium.launch(); p, errs = nieuwe_pagina(b, 1440, 950)
    login(p, "beheer@test.local"); body = lambda q=p: q.locator("main").inner_text()
    ok("versie ≥ 1.73.0", tuple(map(int, p.evaluate("() => APP_VERSION").split("."))) >= (1, 73, 0))
    ok("compatibiliteitscode opgeruimd (enkel schemaV ≥ 64 blijft)", p.evaluate("() => SCHEMA_MIN") == 63)
    # Mijn werk
    top = p.locator("nav.tabs").inner_text()
    ok("hoofdmenu: Mijn werk met rood bolletje (te laat)", "Mijn werk" in top and p.locator("nav.tabs [data-nav=mijnwerk] .cnt").count() == 1, top)
    p.locator("nav.tabs [data-nav=mijnwerk]").click(); p.wait_for_timeout(500)
    t = body()
    ok("Mijn werk: groepen Te laat / Deze week / Later", all(x in t.upper() for x in ["TE LAAT", "DEZE WEEK", "LATER"]), t[:800])
    ok("Mijn werk: taak, to-do (met punten), werfpunt", "Offerte nakijken" in t and "Stopcontacten keuken uitzetten" in t and "Barst in de tegel" in t and "Werfpunt" in t and "To-do" in t, t[:1500])
    ok("Mijn werk: afgewerkte taak niet, keuze van een ander project-lead niet", "Klaar" not in [l.strip() for l in t.split("\n")] and "keukenfronten" not in t)
    volg = [x for x in ["Offerte nakijken", "To do's · werfvergadering", "Barst in de tegel", "Lichtplan tekenen"] if x in t]
    ok("Mijn werk: gesorteerd op datum (te laat → to-do 19/11 → werfpunt 25/11 → december)", sorted(volg, key=t.index) == volg and len(volg) == 4, volg)
    p.locator("[data-mw=soort][data-v=werf]").click(); p.wait_for_timeout(300)
    ok("filter Werfpunten", "Barst in de tegel" in body() and "Offerte nakijken" not in body())
    p.locator("[data-mw=soort][data-v='']").click(); p.wait_for_timeout(300)
    p.select_option("select[data-mw=wie]", M); p.wait_for_timeout(400)
    ok("beheer bekijkt het werk van Noa: keuze en vraag (Noa is lead)", "Werk van Noa" in body() and "Kleur van de keukenfronten" in body() and "Wanneer komt de schilder?" in body(), body()[:800])
    p.select_option("select[data-mw=wie]", B); p.wait_for_timeout(300)
    p.locator(f".task-check[data-toggle='{T_LAAT}']").click(); p.wait_for_timeout(900)
    ok("afvinken in Mijn werk → taak klaar", pg("select status from taken where id=%s", (T_LAAT,))[0] == "done")
    # Naar Yuki (proef)
    p.evaluate(f"() => {{ S.view='projecten'; S.project='{P}'; S.ptab='facturatie'; render(); }}"); p.wait_for_timeout(600)
    p.locator(f"[data-act=vord-vast][data-id='{V3}']").click(); p.wait_for_timeout(1200)
    ok("vastgezet → knop 'Naar Yuki…'", p.locator(f"[data-act=vord-yuki][data-id='{V3}']").count() == 1)
    gw.DRIVE_LOG.clear(); p.locator(f"[data-act=vord-yuki][data-id='{V3}']").click(); p.wait_for_timeout(1200)
    st = [x for x in gw.DRIVE_LOG if x.get("action") == "yukifactuur"]
    ok("Naar Yuki: regels per btw-tarief = vastgezet bedrag", st and abs(sum(r["excl"] for r in st[0]["regels"]) - float(pg("select bedrag_excl from vorderingen where id=%s", (V3,))[0])) < 0.005 and "project 260099" in st[0]["omschrijving"], st)
    ok("proefmodus: venster 'er ging niets naar Yuki'", "niets" in p.locator("#modal").inner_text() and "Proef" in p.locator("#modal").inner_text(), p.locator("#modal").inner_text()[:300])
    p.keyboard.press("Escape"); p.wait_for_timeout(200)
    ok("geen JS-fouten (beheer)", not [e for e in errs if "PE " in e], errs)
    # medewerker: weekagenda met Google Agenda
    m, e2 = nieuwe_pagina(b, 1440, 950); login(m, "medewerker@test.local")
    m.evaluate("() => { try { localStorage.setItem('bros.uw.weekend', '1'); } catch (e) { } S.view='uren'; render(); }"); m.wait_for_timeout(1500)
    ga = m.locator(".uw-ga").all_inner_texts()
    ok("Uren: agenda-afspraken van Noa (initialen + deelnemer), niet die van Phil, geen hele dag", len(ga) == 2 and any("Showroom Alfa" in x for x in ga) and any("Overleg aannemer" in x for x in ga) and not any("Phil" in x for x in ga), ga)
    m.locator("[data-uw-ga-ok='ga-1']").click(); m.wait_for_timeout(500)
    f = m.locator("#modal")
    ok("✓ Uren… → urenformulier met 10:00–11:30, 1,5 u en de titel", f.locator("[name=tijd_van]").input_value() == "10:00" and f.locator("[name=tijd_tot]").input_value() == "11:30" and "Showroom Alfa" in (f.locator("[name=notitie]").input_value() if f.locator("[name=notitie]").count() else ""), f.inner_text()[:400])
    f.locator("button[type=submit]").click(); m.wait_for_timeout(1200)
    ok("na boeken: afspraak verdwijnt (uren in dat tijdvak)", m.locator("[data-uw-ga='ga-1']").count() == 0 and pg("select count(*) from uren where user_id=%s and datum=%s", (M, dag(0)))[0] == 1)
    m.locator("[data-uw-ga-weg='ga-2']").click(); m.wait_for_timeout(800)
    ok("✕ → niet meer getoond (in de databank)", m.locator("[data-uw-ga='ga-2']").count() == 0 and pg("select count(*) from mijn_markeringen where user_id=%s and sleutel='ga:ga-2'", (M,))[0] == 1)
    ok("geen JS-fouten (medewerker)", not [e for e in e2 if "PE " in e], e2)
    m.screenshot(path=WORK + "/shots/t73-uren.png")
    # gsm: Mijn werk in de balk
    g, e3 = nieuwe_pagina(b, 390, 844); login(g, "beheer@test.local")
    g.locator(".gsm-balk [data-nav=mijnwerk]").click(); g.wait_for_timeout(500)
    ok("gsm: Mijn werk in de balk", g.evaluate("() => S.view") == "mijnwerk" and g.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"))
    g.locator("[data-act=nav-meer-gsm]").click(); g.wait_for_timeout(300)
    ok("gsm: Taken onder Meer", "Taken" in g.locator(".nav-menu.gsm").inner_text())
    g.screenshot(path=WORK + "/shots/t73-gsm.png")
    # te oude databank
    pg("update instellingen set value = jsonb_set(value, '{versie_schema}', '60') where key='app'", f=None)
    o, e4 = nieuwe_pagina(b); login(o, "beheer@test.local")
    ok("databank ouder dan 063 → duidelijke melding", "Databank bijwerken" in o.locator("body").inner_text() and "063" in o.locator("body").inner_text(), o.locator("body").inner_text()[:300])
    pg("update instellingen set value = jsonb_set(value, '{versie_schema}', '66') where key='app'", f=None)
    p.screenshot(path=WORK + "/shots/t73.png")
for kk, v in R.items(): print(("  " if v == "OK" else "✗ ") + kk + ("" if v == "OK" else "  → " + v))
print(f"\n{sum(v == 'OK' for v in R.values())}/{len(R)} OK")
