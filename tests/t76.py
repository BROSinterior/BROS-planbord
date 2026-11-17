"""1.76 — goedgekeurd meer-/minderwerk naar de aannemer: aannemer(s) verplicht kiezen bij het voorleggen (ook een externe partij,
die aan het project gekoppeld wordt), na de goedkeuring een pdf-bevestiging zonder prijzen met de volledige goedkeuring van de klant,
gedeeld in het aannemersportaal + mail, en "Ontvangen" door de aannemer (naam, tijdstip, IP) — script 068."""
import os, sys, re, base64, zlib, json, urllib.request; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib")); from h import *
herstel("basis")
R = {}
def ok(k, c, x=""): R[k] = "OK" if c else "FOUT " + str(x)[:600]
CA = "cccccccc-7600-0000-0000-00000000000a"; CX = "cccccccc-7600-0000-0000-00000000000b"
pg("update projecten set drive_folder_id='fldTest' where id=%s", (P,), f=None)
pg("insert into contacten (id, soort, naam, email, user_id) values (%s,'aannemer','Omega Olaf','aan@x.be',%s)", (CA, A), f=None)
pg("insert into project_contacten (project_id, contact_id, rol) values (%s,%s,'aannemer')", (P, CA), f=None)
pg("insert into contacten (id, soort, naam, email) values (%s,'aannemer','Kappa Kris','kappa@test.local')", (CX,), f=None)
ok("script 068: schemaversie 68", pg("select (value->>'versie_schema')::int from instellingen where key='app'")[0] >= 68)
start_postgrest(); poort(); zetapp()
def tekst_pdf(b):   # tekst uit de pdf van pdf-lib (hex-strings, eventueel in een gecomprimeerde stroom)
    uit = []
    for m in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", b, re.S):
        s = m.group(1)
        try: s = zlib.decompress(s)
        except Exception: pass
        uit += [bytes.fromhex(h.decode()).decode("latin-1") for h in re.findall(rb"<([0-9A-Fa-f]+)>\s*Tj", s)]
    return "\n".join(uit)
from playwright.sync_api import sync_playwright
def pwacht(pagina, fn, t=15.0):   # wachten zonder de pagina stil te leggen (Drive-routes worden enkel tijdens Playwright-aanroepen afgehandeld)
    for _ in range(int(t / 0.25)):
        try:
            if fn(): return True
        except Exception: pass
        pagina.wait_for_timeout(250)
    return fn()
with sync_playwright() as pw:
    b = pw.chromium.launch(); p, errs = nieuwe_pagina(b, 1440, 950)
    login(p, "beheer@test.local")
    p.evaluate(f"() => {{ S.view='projecten'; S.project='{P}'; S.ptab='facturatie'; render(); gkForm('{P}', 'meerwerk'); }}"); p.wait_for_timeout(600)
    ok("voorleggen meerwerk: blok 'Aannemer(s) die dit uitvoeren' zichtbaar", p.locator("#gk_aan_blok").is_visible() and "Omega Olaf" in p.locator("#gk_aan_list").inner_text())
    ok("de aannemer van het project staat NIET vooraf aangevinkt (manueel koppelen)", p.locator('#gk_aan_list input[name="gk_aan"]:checked').count() == 0)
    ok("externe aannemer kiesbaar, klanten niet", p.locator('#gk_aan_extra option', has_text="Kappa Kris").count() == 1 and p.locator('#gk_aan_extra option', has_text="Daan Klant").count() == 0)
    p.locator("#mform button[type=submit]").click(); p.wait_for_timeout(500)
    ok("zonder aannemer kan je niet voorleggen", p.locator("#gk_aan_blok").is_visible() and pg("select count(*) from goedkeuringen where soort='meerwerk'")[0] == 0, p.locator("#toast").inner_text())
    p.select_option("#gk_aan_extra", CX); p.wait_for_timeout(200)
    ok("externe aannemer toegevoegd en aangevinkt (met 'wordt aan het project gekoppeld')", p.locator(f'#gk_aan_list input[value="{CX}"]:checked').count() == 1 and "gekoppeld" in p.locator("#gk_aan_list").inner_text() and "geen portaaltoegang" in p.locator("#gk_aan_list").inner_text().lower())
    p.locator(f'#gk_aan_list input[value="{CA}"]').check()
    p.locator("#mform button[type=submit]").click(); p.wait_for_timeout(1200)
    g = pg("select id::text, aannemers::text[] from goedkeuringen where soort='meerwerk'")
    ok("voorstel bewaard met beide aannemers", g and sorted(g[1]) == sorted([CA, CX]), g)
    G = g[0]
    ok("externe partij gekoppeld aan het project als aannemer", pg("select count(*) from project_contacten where project_id=%s and contact_id=%s and rol='aannemer'", (P, CX))[0] == 1)
    ok("per aannemer een rij (nog niet gemeld/gezien)", pg("select count(*) from goedkeuring_aannemers where goedkeuring_id=%s and gemeld_op is null and gezien_op is null", (G,))[0] == 2)
    ok("aannemer ziet het open voorstel nog niet in het portaal", als(A, "select count(*) from aan_meerwerk")[0] == 0)
    p.evaluate(f"() => gkForm('{P}', 'offerte')"); p.wait_for_timeout(300)
    if p.locator("#gk_soort option[value=offerte]").count():
        p.select_option("#gk_soort", "offerte"); p.wait_for_timeout(200)
        ok("bij een offerte: geen aannemerblok", not p.locator("#gk_aan_blok").is_visible())
    p.keyboard.press("Escape"); p.evaluate("() => { const c = document.querySelector('#mform [data-close]'); if (c) c.click(); }"); p.wait_for_timeout(200)
    # de klant keurt goed (via de REST-API, zoals het portaal): IP en browser worden bewaard
    req = urllib.request.Request("http://127.0.0.1:55400/rest/v1/rpc/goedkeuring_beslis", data=json.dumps({"p_id": G, "p_akkoord": True, "p_naam": "Daan Klant", "p_opmerking": "Graag zo snel mogelijk"}).encode(), method="POST",
                                 headers={"Authorization": "Bearer " + gw.tok(K, "klant@x.be"), "Content-Type": "application/json", "User-Agent": "TestBrowser/1.0"})
    urllib.request.urlopen(req).read()
    gk = pg("select status, beslist_ip, beslist_agent from goedkeuringen where id=%s", (G,))
    ok("goedkeuring klant: IP en browser bewaard", gk[0] == "akkoord" and gk[1] == "127.0.0.1" and "TestBrowser" in gk[2], gk)
    ok("IP/browser niet wijzigbaar door het team", "kunnen niet gewijzigd" in (fout(M, "update goedkeuringen set beslist_ip='1.2.3.4' where id=%s", (G,)) or ""))
    # het Planbord maakt de bevestiging (automatisch, elke 2 min; hier meteen)
    p.evaluate("async () => { await refetch('goedkeuringen'); await refetch('goedkeuring_aannemers'); await mwAuto(); }"); p.wait_for_timeout(300)
    ok_bev = pwacht(p, lambda: pg("select bevestiging_drive_id is not null and bevestiging_document is not null and length(bevestiging_sha)=64 from goedkeuringen where id=%s", (G,))[0], 15)
    pwacht(p, lambda: pg("select count(*) from goedkeuring_aannemers where goedkeuring_id=%s and gemeld_op is not null", (G,))[0] == 2, 15)   # mwAuto werkt op de achtergrond verder (delen, mail)
    ok("bevestiging gemaakt: Drive-bestand, document en controlecode", ok_bev, pg("select bevestiging_op, bevestiging_drive_id, bevestiging_sha from goedkeuringen where id=%s", (G,)))
    put = [x for x in gw.DRIVE_LOG if x.get("action") == "put" and x.get("subpath") == "Documenten/Meerwerk"]
    ok("pdf bewaard in Documenten/Meerwerk", len(put) == 1 and put[0]["name"].endswith(".pdf"), [x.get("action") for x in gw.DRIVE_LOG])
    if put:
        raw = base64.b64decode(put[0]["base64"]); open(WORK + "/shots/t76-bevestiging.pdf", "wb").write(raw); t = tekst_pdf(raw)
        sha = pg("select bevestiging_sha from goedkeuringen where id=%s", (G,))[0]
        ok("pdf: titel, project, posten, hoeveelheid", "Bevestiging meer-/minderwerk" in t and "Delta Daan" in t and "Extra tegels badkamer" in t and "Meerwerk" in t, t[:500])
        ok("pdf: volledige goedkeuring van de klant (naam, login, IP, browser, opmerking)", all(x in t for x in ["Daan Klant", "klant@x.be", "127.0.0.1", "TestBrowser", "Graag zo snel mogelijk"]), t[-900:])
        ok("pdf: bestemd voor beide aannemers", "Omega Olaf" in t and "Kappa Kris" in t)
        ok("pdf: controlecode = bewaarde SHA-256", sha in t, sha)
        ok("pdf: GEEN prijzen", "€" not in t and not re.search(r"\d+,\d\d\b", t.replace("127.0.0.1", "")), re.findall(r".{20}\d+,\d\d.{10}", t))
    ok("mail gevraagd aan het Drive-script", any(x.get("action") == "mwmail" and x.get("id") == G for x in gw.DRIVE_LOG))
    ok("beide aannemers gemeld (mail)", pg("select count(*) from goedkeuring_aannemers where goedkeuring_id=%s and gemeld_op is not null", (G,))[0] == 2)
    d = pg("select bevestiging_document::text from goedkeuringen where id=%s", (G,))[0]
    ok("document gedeeld met beide aannemers, al gemeld (geen dubbele verzamelmail)", pg("select count(*) from document_aannemers where document_id=%s and gemeld", (d,))[0] == 2)
    n_put = len(put); p.evaluate("async () => { await mwAuto(); }"); p.wait_for_timeout(1500)
    ok("geen tweede pdf bij een volgende ronde", len([x for x in gw.DRIVE_LOG if x.get("action") == "put" and x.get("subpath") == "Documenten/Meerwerk"]) == n_put)
    # Planbord: overzicht en details
    p.evaluate("async () => { await refetch('goedkeuringen'); await refetch('goedkeuring_aannemers'); S.ptab='meetstaat'; render(); }"); p.wait_for_timeout(1200)
    ok("overzicht: per aannemer 'gemeld'", "Omega Olaf · gemeld" in p.locator("main").inner_text(), p.locator("main").inner_text()[:400])
    p.evaluate(f"() => gkView('{G}')"); p.wait_for_timeout(400)
    mt = p.locator("#mform").inner_text()
    ok("details: aannemers met status, pdf-link en controlecode", "Aannemers (uitvoering)" in mt and "Gemeld op" in mt and p.locator('#mform a:has-text("Bevestiging (pdf)")').count() == 1 and "SHA-256" in mt, mt[-600:])
    p.evaluate("() => { const c = document.querySelector('#mform [data-close]'); if (c) c.click(); }"); p.wait_for_timeout(200)
    # aannemersportaal
    a, aerrs = nieuwe_pagina(b, 1300, 900); login(a, "aan@x.be", "/app/aannemer/")
    rij = als(A, "select posten::text, document_id from aan_meerwerk")
    ok("portaal: view zonder prijzen", rij and "prijs" not in rij[0] and "totaal" not in rij[0] and "Extra tegels" in rij[0] and rij[1], rij)
    ok("portaal: enkel zijn eigen rij", als(A, "select count(*) from goedkeuring_aannemers")[0] == 1)
    a.evaluate(f"() => {{ S.project='{P}'; S.tab='overzicht'; render(); }}"); a.wait_for_timeout(600)
    at = a.locator("main").inner_text() if a.locator("main").count() else a.locator("body").inner_text()
    ok("portaal: paneel met het goedgekeurde meerwerk en de knop Ontvangen", "De klant keurde meer-/minderwerk goed" in at and a.locator('[data-act="mw-ok"]').count() == 1 and a.locator(f'[data-doc-open="{d}"]').count() >= 1, at[:500])
    ok("portaal: geen bedragen in het paneel", "€" not in a.locator('[data-act="mw-ok"]').locator("xpath=ancestor::div[contains(@class,'panel')][1]").inner_text())
    a.evaluate("() => { S.project=null; render(); }"); a.wait_for_timeout(300)
    ok("projectkaart: chip 'meer-/minderwerk te bevestigen'", "meer-/minderwerk te bevestigen" in a.locator("body").inner_text())
    a.evaluate(f"() => {{ S.project='{P}'; S.tab='overzicht'; render(); }}"); a.wait_for_timeout(300)
    a.locator('[data-act="mw-ok"]').click(); a.wait_for_timeout(1500)
    zg = pg("select gezien_op is not null, gezien_naam, gezien_email, gezien_ip from goedkeuring_aannemers where goedkeuring_id=%s and contact_id=%s", (G, CA))
    ok("Ontvangen: tijdstip, naam, login en IP bewaard", zg[0] and zg[1] == "Aannemer Jan" and zg[2] == "aan@x.be" and zg[3] == "127.0.0.1", zg)
    ok("portaal: daarna 'Ontvangen' en geen knop meer", a.locator('[data-act="mw-ok"]').count() == 0)
    a.evaluate("() => { S.tab='documenten'; render(); }"); a.wait_for_timeout(400)
    ok("portaal Documenten: sectie Meer- en minderwerk met status Ontvangen", "Meer- en minderwerk" in a.locator("body").inner_text() and "Ontvangen" in a.locator("body").inner_text())
    ok("ontvangst ligt vast (team kan ze niet wissen of wijzigen)", "niet gewijzigd" in (fout(M, "update goedkeuring_aannemers set gezien_naam='x' where contact_id=%s", (CA,)) or "") and "blijft bewaard" in (fout(M, "delete from goedkeuring_aannemers where contact_id=%s", (CA,)) or ""))
    ok("een andere aannemer kan niet bevestigen voor iemand anders", "Niet gevonden" in (fout(A, "select meerwerk_ontvangen(id) from goedkeuring_aannemers where contact_id=%s", (CX,)) or "Niet gevonden"))
    ok("team kan geen ontvangst invullen bij een nieuwe rij", pg("select count(*) from goedkeuring_aannemers where contact_id=%s and gezien_op is not null", (CX,))[0] == 0)
    ok("portaal zonder JS-fouten", not [e for e in aerrs if "PE " in e], aerrs)
    # na de goedkeuring nog een (nieuwe, externe) aannemer toevoegen → gekoppeld, gedeeld en gemaild
    p.evaluate(f"async () => {{ await refetch('goedkeuring_aannemers'); gkAannemersForm('{G}'); }}"); p.wait_for_timeout(400)
    ok("toevoegen: wie al gekoppeld is staat er niet meer bij", p.locator(f'#gk_aan_list input[value="{CA}"]').count() == 0 and p.locator('#gk_aan_extra option', has_text="Kappa Kris").count() == 0)
    p.select_option("#gk_aan_extra", "__nieuw"); p.fill("#gk_aan_nnaam", "Lambda Lies"); p.fill("#gk_aan_nmail", "lambda@test.local")
    p.locator("#mform button[type=submit]").click(); p.wait_for_timeout(2500)
    cl = pg("select id::text from contacten where naam='Lambda Lies' and soort='aannemer' and email='lambda@test.local'")
    ok("nieuw contact aangemaakt en aan het project gekoppeld als aannemer", cl and pg("select count(*) from project_contacten where project_id=%s and contact_id=%s and rol='aannemer'", (P, cl[0]))[0] == 1)
    ok("nieuwe aannemer: in het voorstel, document gedeeld en gemaild", cl and cl[0] in pg("select aannemers::text[] from goedkeuringen where id=%s", (G,))[0] and pg("select count(*) from document_aannemers where document_id=%s and contact_id=%s", (d, cl[0]))[0] == 1
       and pg("select gemeld_op is not null from goedkeuring_aannemers where goedkeuring_id=%s and contact_id=%s", (G, cl[0]))[0], pg("select contact_id, gemeld_op from goedkeuring_aannemers where goedkeuring_id=%s", (G,), f="all"))
    # 1.76: claimen zonder or-filter (PostgREST 12 gaf bij een or-filter de rij niet terug → ook de getekende overeenkomst-pdf kwam er nooit)
    cl2 = p.evaluate(f"async () => [await pbClaim('goedkeuringen', '{G}', 'getekend_op', 'getekend_drive_id', 10), await pbClaim('goedkeuringen', '{G}', 'getekend_op', 'getekend_drive_id', 10)]")
    pg("update goedkeuringen set getekend_op = now() - interval '20 minutes' where id=%s", (G,), f=None)
    cl3 = p.evaluate(f"async () => pbClaim('goedkeuringen', '{G}', 'getekend_op', 'getekend_drive_id', 10)")
    ok("claim: eerste keer ja, meteen opnieuw nee, vastgelopen poging (>10 min) opnieuw ja", cl2 == [True, False] and cl3 is True, [cl2, cl3])
    ok("Planbord zonder JS-fouten", not [e for e in errs if "PE " in e], errs)
    p.screenshot(path=WORK + "/shots/t76.png"); a.screenshot(path=WORK + "/shots/t76-portaal.png")
for kk, v in R.items(): print(("  " if v == "OK" else "✗ ") + kk + ("" if v == "OK" else "  → " + v))
print(f"\n{sum(v == 'OK' for v in R.values())}/{len(R)} OK")
