"""1.66 — Planbord: Facturen › Yuki-koppeling (manueel koppelen + pdf delen, pdf opladen, negeren, meldingen), bankgegevens in Instellingen."""
import os, sys, base64; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib")); from h import *
from decimal import Decimal as D
herstel("basis"); start_postgrest(); poort(); zetapp(); gw.DRIVE_LOG.clear()
V3 = "eeeeeeee-0000-0000-0000-000000000003"; V5 = "eeeeeeee-0000-0000-0000-000000000005"
pg("insert into vorderingen (id, project_id, nr, soort, omschrijving, datum, status) values (%s,%s,3,'vordering','Vordering 3','2026-11-10','opgemaakt')", (V3, P), f=None)
pg("insert into vordering_regels (vordering_id, lot, pct) values (%s,1,0.2)", (V3,), f=None)
pg("insert into vorderingen (id, project_id, nr, soort, omschrijving, datum, status, bedrag_excl) values (%s,%s,4,'vordering','Manueel verstuurd','2026-11-01','opgemaakt',50)", (V5, P), f=None)
pg("update vorderingen set status='verzonden' where id=%s", (V5,), f=None)
Y1 = pg("""insert into yuki_facturen (factuurnummer, datum, klant, totaal_incl, mededeling, vervaldag, resultaat, reden, voorstel_project, pdf_drive_id)
           values ('2026-031','2026-11-10','Delta Daan',178.08,'+++111/2222/33394+++','2026-12-10','niet_gevonden','bedrag wijkt af van de openstaande vordering',%s,'drvY1') returning id::text""", (P,))[0]
Y2 = pg("insert into yuki_facturen (factuurnummer, klant, totaal_incl, resultaat, reden) values ('2026-040','Onbekend BV',99,'verdacht','De handtekening van Yuki werd niet bevestigd') returning id::text")[0]
R = {}
def ok(k, c, x=""): R[k] = "OK" if c else "FOUT " + str(x)[:600]
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.chromium.launch(); p, errs = nieuwe_pagina(b, 1400, 1000)
    login(p, "beheer@test.local"); p.wait_for_timeout(800)
    nav = p.locator("nav, .nav, aside").first.inner_text()
    p.evaluate("() => { S.view = 'aankoop'; S.factTab = null; render(); }"); p.wait_for_timeout(600)
    main = p.locator("main").inner_text() if p.locator("main").count() else p.locator("body").inner_text()
    ok("Facturen opent op Yuki-koppeling (er is werk) met badge", "Yuki-koppeling" in main and "Factuur 2026-031" in main, main[:600])
    ok("meldingen: verstuurd zonder factuurnummer (V5) en factuur zonder pdf (2026-020)", "Manueel verstuurd" in main and "2026-020" in main, main[:2500])
    kaart = p.locator(f"[data-yuki='{Y1}']")
    ok("voorstel: project herkend en vordering 3 gekozen (bedrag klopt)", kaart.locator("[data-yk=pid]").input_value() == P and kaart.locator("[data-yk=vid]").input_value() == V3, (kaart.locator("[data-yk=pid]").input_value(), kaart.locator("[data-yk=vid]").input_value()))
    ok("vergelijking: klopt", "klopt" in kaart.inner_text(), kaart.inner_text())
    ok("verdachte factuur in het rood met waarschuwing", "Verdacht" in p.locator(f"[data-yuki='{Y2}']").inner_text())
    kaart.locator("[data-yk-act=koppel]").click(); p.wait_for_timeout(2500)
    v = pg("select factuurnummer, status, bedrag_excl, btw_bedrag from vorderingen where id=%s", (V3,))
    ok("koppelen → vordering 3 heeft factuur 2026-031, verzonden, 168 + 10,08", v == ("2026-031", "verzonden", D("168.00"), D("10.08")), v)
    ok("…en het Drive-script kreeg 'factuurpdf' voor deze Yuki-factuur", any(x.get("action") == "factuurpdf" and x.get("yuki") == Y1 for x in gw.DRIVE_LOG), gw.DRIVE_LOG[-2:])
    ok("kaart verdwijnt na koppelen", p.locator(f"[data-yuki='{Y1}']").count() == 0)
    # pdf opladen bij 2026-020
    btn = p.locator(f"[data-yk-act=upload][data-vid='{V2}']")
    with p.expect_file_chooser() as fc: btn.click()
    fc.value.set_files(WORK + "/factuur.pdf"); p.wait_for_timeout(2500)
    up = [x for x in gw.DRIVE_LOG if x.get("action") == "factuurpdf" and x.get("vordering") == V2]
    ok("pdf opladen → Drive-script krijgt de pdf (base64) voor 2026-020", up and base64.b64decode(up[0]["base64"])[:4] == b"%PDF", gw.DRIVE_LOG[-1:])
    # negeren
    p.locator(f"[data-yuki='{Y2}'] [data-yk-act=negeer]").click(); p.wait_for_timeout(1200)
    ok("negeren → genegeerd", pg("select genegeerd from yuki_facturen where id=%s", (Y2,))[0] is True)
    main = p.locator("body").inner_text()
    ok("genegeerd staat onderaan (terug te zetten)", "Genegeerd" in main)
    # medewerker: geen tabblad, geen gegevens
    p2, e2 = nieuwe_pagina(b); login(p2, "medewerker@test.local"); p2.evaluate("() => { S.view = 'aankoop'; S.factTab = 'yuki'; render(); }"); p2.wait_for_timeout(600)
    ok("medewerker: geen Yuki-gegevens", "2026-031" not in p2.locator("body").inner_text() and "Factuur 2026-040" not in p2.locator("body").inner_text())
    # instellingen: bedrijfsgegevens
    p.evaluate("() => { S.view = 'instellingen'; render(); }"); p.wait_for_timeout(700)
    ok("Instellingen: velden voor het bankdossier", p.locator("#po_bnaam").count() == 1 and p.locator("#po_bnaam").input_value() == "BROS BV" and p.locator("#po_bbtw").input_value() == "BE 0123.456.789")
    p.fill("#po_badres", "Kloosterstraat 165, 2000 Antwerpen (BE)"); p.click("[data-act=portaal-save]"); p.wait_for_timeout(1200)
    ok("bewaren: adres in instellingen, iban blijft", pg("select value->>'bedrijf_adres', value->>'iban' from instellingen where key='portaal'") == ("Kloosterstraat 165, 2000 Antwerpen (BE)", "BE68539007547034"))
    ok("geen JS-fouten", not [e for e in errs + e2 if "PE " in e], errs + e2)
    p.evaluate("() => { S.view = 'aankoop'; S.factTab = 'yuki'; render(); }"); p.wait_for_timeout(500)
    p.screenshot(path=WORK + "/shots/yuki.png", full_page=True)
for k, v in R.items(): print(("  " if v == "OK" else "✗ ") + k + ("" if v == "OK" else "  → " + v))
print(f"\n{sum(v == 'OK' for v in R.values())}/{len(R)} OK")
