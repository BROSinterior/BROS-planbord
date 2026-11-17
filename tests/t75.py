"""1.75 — tabblad Projecten: standaard enkel In offerte en Lopend; andere statussen aanvinken (onthouden per browser)."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib")); from h import *
herstel("basis")
R = {}
def ok(k, c, x=""): R[k] = "OK" if c else "FOUT " + str(x)[:600]
for nr, klant, st in [("260191", "Epsilon Erik", "offerte"), ("260192", "Zeta Zoë", "afgerond"), ("260193", "Eta Elke", "verloren"), ("260194", "Theta Tom", "on_hold")]:
    pg("insert into projecten (klant, naam, nummer, status) values (%s,'Testproject',%s,%s)", (klant, nr, st), f=None)
start_postgrest(); poort(); zetapp()
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.chromium.launch(); p, errs = nieuwe_pagina(b, 1440, 950)
    login(p, "beheer@test.local")
    p.evaluate("() => { S.view='projecten'; S.project=null; render(); }"); p.wait_for_timeout(400)
    t = lambda: p.locator("main table").inner_text()
    ok("standaard: In offerte en Lopend zichtbaar", "Epsilon Erik" in t() and "Delta Daan" in t(), t()[:300])
    ok("standaard: Afgerond, Verloren en On hold verborgen", all(x not in t() for x in ["Zeta Zoë", "Eta Elke", "Theta Tom"]))
    ok("vinkjes per status, Offerte en Lopend aan", p.locator("[data-projzicht=offerte][aria-pressed=true]").count() == 1 and p.locator("[data-projzicht=lopend][aria-pressed=true]").count() == 1 and p.locator("[data-projzicht=verloren][aria-pressed=false]").count() == 1)
    ok("teller: x van y projecten", " van " in p.locator(".page-head .eyebrow").inner_text(), p.locator(".page-head .eyebrow").inner_text())
    p.locator("[data-projzicht=verloren]").click(); p.wait_for_timeout(300)
    ok("Verloren aanvinken → verloren projecten erbij", "Eta Elke" in t() and "Zeta Zoë" not in t())
    p.reload(); p.wait_for_timeout(2500); p.evaluate("() => { S.view='projecten'; S.project=null; render(); }"); p.wait_for_timeout(300)
    ok("onthouden na herladen", "Eta Elke" in t() and p.locator("[data-projzicht=verloren][aria-pressed=true]").count() == 1)
    p.locator("[data-projzicht='*']").click(); p.wait_for_timeout(300)
    ok("'standaard' zet terug naar In offerte + Lopend", "Eta Elke" not in t() and "Epsilon Erik" in t() and p.locator("[data-projzicht='*']").count() == 0)
    for k in ["offerte", "lopend"]: p.locator(f"[data-projzicht={k}]").click(); p.wait_for_timeout(200)
    ok("niets aangevinkt → duidelijke melding", "Geen projecten met deze status" in t())
    p.locator("[data-projzicht='*']").click(); p.wait_for_timeout(200)
    p.evaluate("() => { S.filters.status = 'late'; S.view='projecten'; render(); }"); p.wait_for_timeout(200)
    ok("filter 'Te laat' van Taken heeft geen invloed meer op Projecten", "Delta Daan" in t())
    ok("geen JS-fouten", not [e for e in errs if "PE " in e], errs)
    p.screenshot(path=WORK + "/shots/t75.png")
for kk, v in R.items(): print(("  " if v == "OK" else "✗ ") + kk + ("" if v == "OK" else "  → " + v))
print(f"\n{sum(v == 'OK' for v in R.values())}/{len(R)} OK")
