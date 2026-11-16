"""1.67 — Planbord: Yuki-koppeling met voorstellen (zeker / op bedrag / enige), alles-zeker-koppelen, projectmap bij koppelen en delen, al lang op te maken, #aankoop-yuki."""
import os, sys, base64; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib")); from h import *
from decimal import Decimal as D
herstel("basis"); start_postgrest(); poort(); zetapp(); gw.DRIVE_LOG.clear()
P2 = "aaaaaaaa-0000-0000-0000-000000000002"; P3 = "aaaaaaaa-0000-0000-0000-000000000003"; P4 = "aaaaaaaa-0000-0000-0000-000000000004"
pg("insert into projecten (id, klant, nummer, status, btw_tarief, drive_folder_id) values (%s,'Alfa Annie','260101','lopend',6,''), (%s,'Beta Bérénice','260158','lopend',6,'MAPVB'), (%s,'Gamma Geert','260170','lopend',6,'')", (P2, P3, P4), f=None)
def post(pid, kost):
    i = pg("insert into meetstaat_posten (project_id, lot, code, omschrijving, hoeveelheid, eenheid, status, volgorde) values (%s,1,'1.1','Werk',1,'sog','akkoord',10) returning id::text", (pid,))[0]
    pg("update meetstaat_prijzen set eenheidsprijs=%s where post_id=%s", (kost, i), f=None); return i
post(P2, 10000); post(P3, 20000); post(P4, 5000)
def vord(vid, pid, nr, soort, oms, datum, pct):
    pg("insert into vorderingen (id, project_id, nr, soort, omschrijving, datum, status) values (%s,%s,%s,%s,%s,%s,'opgemaakt')", (vid, pid, nr, soort, oms, datum), f=None)
    pg("insert into vordering_regels (vordering_id, lot, pct) values (%s,1,%s)", (vid, pct), f=None)
    pg("update vorderingen set created_at=%s::date where id=%s", (datum, vid), f=None)
VC = "eeeeeeee-0000-0000-0000-0000000000c0"; VB = "eeeeeeee-0000-0000-0000-0000000000b0"; VP = "eeeeeeee-0000-0000-0000-0000000000a0"
vord(VC, P2, 0, "voorschot", "Voorschot bij ondertekening", "2026-09-16", 0.3)     # 3000 excl → 3180 incl
vord(VB, P3, 0, "voorschot", "Voorschot bij ondertekening", "2026-11-01", 0.3)     # 6000 → 6360
vord(VP, P4, 0, "voorschot", "Voorschot", "2026-11-10", 0.2)                        # 1000 → 1060
# Yuki-facturen: zeker via projectnummer (Alfa), enige-maar-afwijkend (Beta, ander bedrag), op bedrag (onbekende klantnaam, Peeters-bedrag)
YC = pg("insert into yuki_facturen (factuurnummer, datum, klant, totaal_incl, excl, btw, projectnummers, resultaat, reden, pdf_drive_id) values ('2026150','2026-09-17','Alfa Annie',3816,3600,216,'{260101}','niet_gevonden','project niet herkend','drvC') returning id::text")[0]
YB = pg("insert into yuki_facturen (factuurnummer, datum, klant, totaal_incl, resultaat, reden, voorstel_project, pdf_drive_id, pdf_verdacht) values ('2026190','2026-11-02','Beta Bérénice',7700,'niet_gevonden','bedrag wijkt af',%s,'drvB','de factuur-pdf vermeldt een andere rekening (BE99…0000) dan die van BROS') returning id::text", (P3,))[0]
YP = pg("insert into yuki_facturen (factuurnummer, datum, klant, totaal_incl, resultaat, reden) values ('2026210','2026-11-11','G. Gamma-Smet',1272,'niet_gevonden','project niet herkend') returning id::text")[0]
# zeker #2: bestaande seed (project P, vordering V3 opgemaakt 168 excl / 178,08 incl)
V3 = "eeeeeeee-0000-0000-0000-000000000003"
pg("insert into vorderingen (id, project_id, nr, soort, omschrijving, datum, status) values (%s,%s,3,'vordering','Vordering 3','2026-11-10','opgemaakt')", (V3, P), f=None)
pg("insert into vordering_regels (vordering_id, lot, pct) values (%s,1,0.2)", (V3,), f=None)
Y1 = pg("insert into yuki_facturen (factuurnummer, datum, klant, totaal_incl, resultaat, reden, voorstel_project, pdf_drive_id) values ('2026-031','2026-11-10','Delta Daan',178.08,'niet_gevonden','',%s,'drvY1') returning id::text", (P,))[0]
# gekoppeld, pdf wacht: project zonder Drive-map
V9 = "eeeeeeee-0000-0000-0000-000000000009"
pg("insert into vorderingen (id, project_id, nr, soort, omschrijving, datum, status, bedrag_excl, btw_bedrag) values (%s,%s,1,'vordering','Vordering 1','2026-11-05','opgemaakt',100,6)", (V9, P4), f=None)
pg("update vorderingen set status='verzonden', factuurnummer='2026205' where id=%s", (V9,), f=None)
YW = pg("insert into yuki_facturen (factuurnummer, totaal_incl, resultaat, vordering_id, pdf_drive_id, pdf_verdacht) values ('2026205',106,'gekoppeld',%s,'drvW','project heeft geen Drive-map') returning id::text", (V9,))[0]
R = {}
def ok(k, c, x=""): R[k] = "OK" if c else "FOUT " + str(x)[:700]
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.chromium.launch(); p, errs = nieuwe_pagina(b, 1400, 1000)
    p.goto("http://127.0.0.1:55400/app/#aankoop-yuki"); p.wait_for_timeout(900)
    if p.locator("input[type=password]").count(): p.fill("input[type=email]", "beheer@test.local"); p.fill("input[type=password]", "test"); p.keyboard.press("Enter")
    p.wait_for_timeout(2600)
    st = p.evaluate("() => [S.view, S.factTab]")
    if st[0] != "aankoop": p.evaluate("() => { S.view = 'aankoop'; S.factTab = 'yuki'; render(); }"); p.wait_for_timeout(500)
    ok("#aankoop-yuki opent Facturen › Yuki-koppeling", st == ["aankoop", "yuki"], st)
    body = lambda: p.locator("body").inner_text()
    kC = p.locator(f"[data-yuki='{YC}']"); kB = p.locator(f"[data-yuki='{YB}']"); kP = p.locator(f"[data-yuki='{YP}']"); k1 = p.locator(f"[data-yuki='{Y1}']")
    ok("Alfa: ✓ Zeker (projectnummer op de factuur) — voorschot voorgesteld", "Zeker" in kC.inner_text() and kC.locator("[data-yk=vid]").input_value() == VC and "projectnummer 260101" in kC.inner_text(), kC.inner_text())
    ok("Beta: voorstel 'bedrag wijkt af' (enige vordering), geen 'Zeker'", "bedrag wijkt af" in kB.inner_text() and "Zeker" not in kB.inner_text() and kB.locator("[data-yk=vid]").input_value() == VB, kB.inner_text())
    ok("Peeters: voorstel op bedrag (klant niet herkend) met controle-opdracht", "Voorstel op bedrag" in kP.inner_text() and kP.locator("[data-yk=pid]").input_value() == P4 and "kijk na of de klant" in kP.inner_text(), kP.inner_text())
    ok("knop 'Alle 2 zekere koppelen'", p.locator("[data-yk-act=alles]").count() == 1 and "Alle 2 zekere" in p.locator("[data-yk-act=alles]").inner_text(), p.locator("[data-yk-act=alles]").all_inner_texts())
    ok("Beta (pdf verdacht): knop deelt de pdf niet", "pdf delen" not in kB.locator("[data-yk-act=koppel]").inner_text())
    ok("pdf wacht: 'Map koppelen of aanmaken en pdf delen' bij project zonder map", p.locator(f"[data-yk-act=pdf][data-id='{YW}']").inner_text().startswith("Map koppelen of aanmaken"), body()[:3000])
    ok("al lang op te maken: Alfa-voorschot (sinds 16/09) met knop naar factuur 2026150", "Al lang" in body() and p.locator(f"[data-yk-act=koppel-op][data-vid='{VC}']").count() >= 1, body()[-2500:])
    # alles zeker koppelen
    gw.DRIVE_LOG.clear(); p.locator("[data-yk-act=alles]").click(); p.wait_for_timeout(4500)
    vc = pg("select factuurnummer, status, bedrag_excl, btw_bedrag from vorderingen where id=%s", (VC,)); v3 = pg("select factuurnummer, status from vorderingen where id=%s", (V3,))
    ok("alles zeker: Alfa-voorschot = 2026150, verzonden, 3600 + 216", vc == ("2026150", "verzonden", D("3600.00"), D("216.00")), vc)
    ok("alles zeker: vordering 3 = 2026-031", v3 == ("2026-031", "verzonden"), v3)
    fp = [x for x in gw.DRIVE_LOG if x.get("action") == "factuurpdf"]
    ok("alles zeker: pdf's gedeeld; project zonder map → maakMap mee", len(fp) == 2 and all(x.get("maakMap") is True for x in fp) and {x.get("yuki") for x in fp} == {YC, Y1}, fp)
    ok("Beta en Peeters blijven staan", kB.count() == 1 and kP.count() == 1 and kC.count() == 0)
    # Beta manueel koppelen (bedrag wijkt af): geen pdf-deling (verdacht)
    gw.DRIVE_LOG.clear(); kB.locator("[data-yk-act=koppel]").click(); p.wait_for_timeout(2500)
    vb = pg("select factuurnummer, bedrag_excl, btw_bedrag from vorderingen where id=%s", (VB,))
    ok("Beta: gekoppeld met het Yuki-bedrag (7700 incl.)", vb[0] == "2026190" and vb[1] + vb[2] == D("7700.00"), vb)
    ok("Beta: verdachte pdf NIET automatisch gedeeld", not [x for x in gw.DRIVE_LOG if x.get("action") == "factuurpdf"], gw.DRIVE_LOG)
    ok("Beta: staat nu bij 'de pdf wacht' met zijn reden", "andere rekening" in body() and p.locator(f"[data-yk-act=pdf][data-id='{YB}']").count() == 1, body()[:3000])
    # pdf met map aanmaken
    gw.DRIVE_LOG.clear(); p.locator(f"[data-yk-act=pdf][data-id='{YW}']").click(); p.wait_for_timeout(2000)
    ok("map aanmaken en pdf delen → factuurpdf met maakMap", any(x.get("action") == "factuurpdf" and x.get("yuki") == YW and x.get("maakMap") is True for x in gw.DRIVE_LOG), gw.DRIVE_LOG)
    # Peeters via voorstel op bedrag
    p.locator(f"[data-yuki='{YP}'] [data-yk-act=koppel]").click(); p.wait_for_timeout(2000)
    ok("Peeters: gekoppeld na bevestiging", pg("select factuurnummer from vorderingen where id=%s", (VP,))[0] == "2026210")
    wj = p.evaluate("() => wjFacturen().map(x => x.titel)")
    ok("Wacht op jou (beheer): 'facturen wachten op één klik'", any("wacht" in t and "één klik" in t for t in wj), wj)
    p.evaluate("() => { S.view = 'overzicht'; render(); }"); p.wait_for_timeout(500)
    ok("Overzicht toont de Yuki-melding met link", "op één klik" in body(), body()[:1500])
    ok("geen JS-fouten", not [e for e in errs if "PE " in e], errs)
    p.screenshot(path=WORK + "/shots/yuki167.png", full_page=True)
for k, v in R.items(): print(("  " if v == "OK" else "✗ ") + k + ("" if v == "OK" else "  → " + v))
print(f"\n{sum(v == 'OK' for v in R.values())}/{len(R)} OK")
