"""1.71 — navigatie (menu Meer, gsm-balk, projectgroepen, compacte kop, ingeklapte uitleg) en documenten via het beveiligde script."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib")); from h import *
herstel("basis"); start_postgrest(); poort(); zetapp(); gw.DRIVE_LOG.clear()
R = {}
def ok(k, c, x=""): R[k] = "OK" if c else "FOUT " + str(x)[:600]
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.chromium.launch(); p, errs = nieuwe_pagina(b, 1440, 950)
    login(p, "beheer@test.local"); body = lambda q=p: q.locator("body").inner_text()
    top = p.locator("nav.tabs").inner_text()
    ok("hoofdmenu zonder Contacten, Notities, Voorstellen, Rapporten", all(x not in top for x in ["Contacten", "Notities", "Voorstellen", "Rapporten"]) and "Projecten" in top, top)
    p.locator("[data-act=nav-meer]").click(); p.wait_for_timeout(300)
    ok("Meer ▾ toont het menu", p.locator(".nav-menu").count() == 1 and "Contacten" in p.locator(".nav-menu").inner_text() and "Rapporten" in p.locator(".nav-menu").inner_text())
    p.locator(".nav-menu [data-nav=contacten]").click(); p.wait_for_timeout(400)
    ok("menu-item opent Contacten en sluit het menu", p.evaluate("() => S.view") == "contacten" and p.locator(".nav-menu").count() == 0 and p.locator(".nav-meer > button[aria-current=page]").count() == 1)
    p.locator("[data-act=nav-meer]").click(); p.wait_for_timeout(200); p.locator("h1").first.click(); p.wait_for_timeout(300)
    ok("klik ernaast sluit het menu", p.locator(".nav-menu").count() == 0)
    # projectpagina
    p.evaluate(f"() => {{ S.view='projecten'; S.project='{P}'; S.ptab='taken'; render(); }}"); p.wait_for_timeout(600)
    groepen = p.locator(".pgroepen button").all_inner_texts()
    ok("5 groepen: Werk, Ontwerp, Geld, Werf, Dossier", [g.split()[0] for g in groepen] == ["Werk", "Ontwerp", "Geld", "Werf", "Dossier"], groepen)
    ok("Werk: tabbladen Taken, Planning, Uren", p.locator(".subtabs button").all_inner_texts()[:3] == ["Taken", "Planning", "Uren"], p.locator(".subtabs button").all_inner_texts())
    p.locator(".pgroepen button", has_text="Geld").click(); p.wait_for_timeout(500)
    ok("Geld opent de meetstaat, tabbladen Meetstaat + Facturatie", p.evaluate("() => S.ptab") == "meetstaat" and p.locator(".subtabs button").all_inner_texts() == ["Meetstaat", "Facturatie"], p.locator(".subtabs button").all_inner_texts())
    p.locator(".subtabs [data-ptab=facturatie]").click(); p.wait_for_timeout(400); p.locator(".pgroepen button", has_text="Werk").click(); p.wait_for_timeout(300); p.locator(".pgroepen button", has_text="Geld").click(); p.wait_for_timeout(400)
    ok("een groep onthoudt het laatst gebruikte tabblad (Facturatie)", p.evaluate("() => S.ptab") == "facturatie")
    ok("compacte kop: geen 'E-mail —' of 'Forfait —'", p.locator(".pmeta").count() == 1 and "—\nE-mail" not in body() and p.locator(".panel-body.meta").count() == 0)
    ok("geen Meetstaat-knop in de kop als er al een meetstaat is", p.locator(".page-head [data-act=ms-open]").count() == 0)
    # uitleg ingeklapt (meetstaat: prijsvragen)
    p.locator(".subtabs [data-ptab=meetstaat]").click(); p.wait_for_timeout(500)
    dicht = p.locator(".uitleg-dicht").count(); knop = p.locator(".uitleg-knop").first
    ok("lange uitleg ingeklapt achter ⓘ", dicht >= 1 and knop.count() == 1, dicht)
    knop.click(); p.wait_for_timeout(200)
    ok("ⓘ toont de uitleg + 'altijd tonen'", p.locator(".uitleg-dicht").count() == dicht - 1 and p.locator(".uitleg-altijd").count() == 1)
    # gsm
    m, e2 = nieuwe_pagina(b, 390, 844); login(m, "beheer@test.local")
    ok("gsm: balk onderaan zichtbaar, bovenmenu verborgen", m.locator(".gsm-balk").is_visible() and not m.locator("nav.tabs").is_visible())
    m.locator(".gsm-balk [data-nav=uren]").click(); m.wait_for_timeout(400)
    ok("gsm: Uren via de balk", m.evaluate("() => S.view") == "uren")
    m.locator("[data-act=nav-meer-gsm]").click(); m.wait_for_timeout(300)
    ok("gsm: Meer toont Facturen, Planning, Contacten …", m.locator(".nav-menu.gsm").is_visible() and "Facturen" in m.locator(".nav-menu.gsm").inner_text() and "Planning" in m.locator(".nav-menu.gsm").inner_text())
    m.locator(".nav-menu.gsm [data-nav=planning]").click(); m.wait_for_timeout(400)
    ok("gsm: Planning via Meer", m.evaluate("() => S.view") == "planning")
    ok("gsm: niets scrollt opzij", m.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"))
    m.evaluate(f"() => {{ S.view='projecten'; S.project='{P}'; S.ptab='taken'; render(); }}"); m.wait_for_timeout(400); m.screenshot(path=WORK + "/shots/t71-gsm.png")
    ok("geen JS-fouten (Planbord)", not [e for e in errs + e2 if "PE " in e], errs + e2)
    p.screenshot(path=WORK + "/shots/t71.png")
    # klantenportaal: document via het beveiligde script
    k, e3 = nieuwe_pagina(b, 1280, 900); login(k, "klant@x.be", "/app/klant/"); k.wait_for_timeout(800)
    k.evaluate("() => { const a = [...document.querySelectorAll('[data-nav], [data-tab], button, a')].find(x => /Documenten|Facturatie/.test(x.textContent || '')); if (a) a.click(); }"); k.wait_for_timeout(700)
    links = k.locator("a[data-doc-open]")
    if links.count() == 0:   # documenten staan misschien in een ander tabblad
        for t in ["Documenten", "Facturatie", "Dossier"]:
            k.evaluate(f"() => {{ const a = [...document.querySelectorAll('button, a')].find(x => (x.textContent || '').trim().startsWith('{t}')); if (a) a.click(); }}"); k.wait_for_timeout(600)
            if k.locator("a[data-doc-open]").count(): break
    ok("klantenportaal: documentlinks gaan via het script", k.locator("a[data-doc-open]").count() >= 1, k.locator("body").inner_text()[:800])
    if k.locator("a[data-doc-open]").count():
        gw.DRIVE_LOG.clear()
        # headless Chromium downloadt een pdf in plaats van ze te tonen: het nieuwe venster vangen we op om te zien wat erin geladen wordt
        k.evaluate("""() => { window.__geopend = null; window.open = () => new Proxy({ document: { title: '', body: {} }, close() {} }, { set(t, key, v) { if (key === 'location') window.__geopend = String(v); t[key] = v; return true; } }); }""")
        k.locator("a[data-doc-open]").first.click(); k.wait_for_timeout(1500)
        geopend = k.evaluate("() => window.__geopend") or ""
        ok("klik → actie 'bestand' met login, de pdf opent als blob (geen Drive-link)", any(x.get("action") == "bestand" and x.get("token") for x in gw.DRIVE_LOG) and geopend.startswith("blob:"), (gw.DRIVE_LOG[-1:] if gw.DRIVE_LOG else None, geopend))
    ok("geen JS-fouten (portaal)", not [e for e in e3 if "PE " in e], e3)
for kk, v in R.items(): print(("  " if v == "OK" else "✗ ") + kk + ("" if v == "OK" else "  → " + v))
print(f"\n{sum(v == 'OK' for v in R.values())}/{len(R)} OK")
