"""Rooktest: alle hoofdschermen van Planbord, klantenportaal en aannemersportaal zonder JS-fouten (data van bros62f)."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib")); from h import *
herstel("basis"); start_postgrest(); poort(); zetapp()
R = {}
def ok(k, c, x=""): R[k] = "OK" if c else "FOUT " + str(x)[:600]
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.chromium.launch(); p, errs = nieuwe_pagina(b)
    login(p, "beheer@test.local")
    views = p.evaluate("() => Object.keys({overzicht:1, projecten:1, taken:1, planning:1, uren:1, contacten:1, notities:1, voorstellen:1, aankoop:1, rapporten:1, instellingen:1})")
    for v in views:
        p.evaluate(f"() => {{ S.view = '{v}'; S.project = null; render(); }}"); p.wait_for_timeout(350)
    for t in ["taken", "meetstaat", "facturatie", "dossier", "notities", "plannen", "ontwerp", "vergaderingen", "renders", "werf"]:
        p.evaluate(f"([pid]) => {{ S.view = 'projecten'; S.project = pid; S.ptab = '{t}'; render(); }}", [P]); p.wait_for_timeout(350)
    for ft in ["klanten", "aannemers", "yuki"]:
        p.evaluate(f"() => {{ S.view = 'aankoop'; S.factTab = '{ft}'; render(); }}"); p.wait_for_timeout(300)
    ok("Planbord (beheer): alle schermen zonder JS-fouten", not [e for e in errs if "PE " in e], errs)
    ok("tekenmodule-koppelingen aanwezig", p.evaluate("() => typeof TK !== 'undefined' || typeof tkOpen === 'function' || !!document.querySelector('script[src*=tekenen]')"))
    p2, e2 = nieuwe_pagina(b); login(p2, "klant@x.be", "/app/klant/")
    for t in ["welkom", "akkoord", "meetstaat", "facturatie", "planning", "werf", "verslagen", "documenten", "team", "vragen"]:
        p2.evaluate(f"() => {{ S.tab = '{t}'; render(); }}"); p2.wait_for_timeout(300)
    ok("klantenportaal: alle tabbladen zonder JS-fouten", not [e for e in e2 if "PE " in e], e2)
    p3, e3 = nieuwe_pagina(b); login(p3, "medewerker@test.local")
    for v in ["overzicht", "projecten", "aankoop"]:
        p3.evaluate(f"() => {{ S.view = '{v}'; render(); }}"); p3.wait_for_timeout(300)
    p3.evaluate("([pid]) => { S.view = 'projecten'; S.project = pid; S.ptab = 'meetstaat'; render(); }", [P]); p3.wait_for_timeout(300)
    ok("Planbord (medewerker) zonder JS-fouten", not [e for e in e3 if "PE " in e], e3)
for k, v in R.items(): print(("  " if v == "OK" else "✗ ") + k + ("" if v == "OK" else "  → " + v))
print(f"\n{sum(v == 'OK' for v in R.values())}/{len(R)} OK")
