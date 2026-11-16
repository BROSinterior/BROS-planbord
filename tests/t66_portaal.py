"""1.66 — klantenportaal: meetstaat ↔ facturatie (kolom Gefactureerd), bankdossier per factuur en volledig, Excel."""
import os, sys, io, re; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib")); from h import *
from pypdf import PdfReader; import openpyxl
herstel("basis"); start_postgrest(); poort(); zetapp()
R = {}
def ok(k, c, x=""): R[k] = "OK" if c else "FOUT " + str(x)[:700]
from playwright.sync_api import sync_playwright
def dl(page, sel):
    with page.expect_download(timeout=60000) as d: page.click(sel)
    return d.value
with sync_playwright() as pw:
    b = pw.chromium.launch(); p, errs = nieuwe_pagina(b, 1400, 950)
    login(p, "klant@x.be", "/app/klant/"); p.wait_for_timeout(1200)
    p.click("[data-tab=meetstaat]"); p.wait_for_timeout(600)
    body = p.locator("main").inner_text()
    ok("meetstaat: kolom Gefactureerd en KPI", "GEFACTUREERD" in body.upper() and p.locator("th:has-text('Gefactureerd')").count() >= 1, body[:500])
    rij = p.locator("tr", has=p.locator("text=Wandkast eik")).first
    ok("Wandkast: 30 % voorschot + 70 % vordering 1 = 100 %", "100 %" in rij.inner_text(), rij.inner_text())
    chips = rij.locator(".fact-chip").all_inner_texts()
    ok("Wandkast: chips Voorschot en #1", chips == ["Voorschot", "#1"], chips)
    rT = p.locator("tr", has=p.locator("text=Tegelvloer keuken")).first
    ok("Tegelvloer: 30 % + 50 % = 80 %", "80 %" in rT.inner_text(), rT.inner_text())
    rM = p.locator("tr", has=p.locator("text=Extra tegels badkamer")).first
    ok("meerwerk: 100 % in #2", "100 %" in rM.inner_text() and rM.locator(".fact-chip").all_inner_texts() == ["#2"], rM.inner_text())
    rij.locator(".fact-chip").first.click(); p.wait_for_timeout(500)
    ok("chip opent Facturatie", "Bankdossier" in p.locator("main").inner_text() or "bank" in p.locator("main").inner_text().lower())
    # ---------- facturatie
    main = p.locator("main").inner_text()
    ok("facturatie: paneel voor de bank + knoppen", "Verbouwlening" in main and p.locator("[data-act=bank-dossier]").count() == 1 and p.locator("[data-act=bank-excel]").count() == 1 and p.locator("[data-act=bank-pdf]").count() == 3, main[:600])
    ok("betaald op zichtbaar", "op 15/09/2026" in main, main[:800])
    d = dl(p, f"[data-act=bank-pdf][data-id='{V1}']"); pdf = PdfReader(d.path()); txt = "\n".join(pg_.extract_text() for pg_ in pdf.pages)
    ok("Voor de bank (#1): vorderingsstaat + factuur-pdf", "Vorderingsstaat" in txt and "FACTUUR 2026-014 (testfactuur van Yuki)" in txt and len(pdf.pages) >= 2, (len(pdf.pages), txt[:600]))
    ok("partijen en bedrijfsgegevens", all(x in txt for x in ["Delta Daan", "Teststraat 12", "BROS BV", "BE 0123.456.789", "Noa"]), txt[:900])
    ok("factuurbedragen: 1.260,00 excl, 75,60 btw, 1.335,60 incl", all(x in txt for x in ["1.260,00", "75,60", "1.335,60"]), txt[:1500])
    ok("per onderdeel: lot 1 vorige 252 / deze 420 / cumul 672 / rest 168; lot 2 540 / 840 / 1.380 / 420; totaal 792 / 1.260 / 2.052 / 588", all(x in txt for x in ["252,00", "420,00", "672,00", "168,00", "540,00", "840,00", "1.380,00", "2.052,00", "588,00", "46,67 %", "77,73 %"]), txt[:2500])
    ok("gefactureerd t.e.m. deze factuur: 2.052,00 (74,35 %) van 2.760,00; nog 708,00", "2.052,00  (74,35 %)" in txt and "708,00" in txt, txt[-1500:])
    ok("verklaring met naam projectverantwoordelijke", "verklaart dat de werken" in txt and "projectverantwoordelijke" in txt, txt[-900:])
    d = dl(p, f"[data-act=bank-pdf][data-id='{V0}']"); t0 = "\n".join(x.extract_text() for x in PdfReader(d.path()).pages)
    ok("voorschot: verklaring zegt 'voorschot', niet 'uitgevoerd'", "voorschot is bij de start" in t0 and "verklaart dat de werken waarop" not in t0, t0[-700:])
    p.wait_for_timeout(500)
    d = dl(p, "[data-act=bank-dossier]"); pdf = PdfReader(d.path()); tv = "\n".join(x.extract_text() for x in pdf.pages)
    ok("volledig dossier: overzicht + 3 vorderingsstaten + 2 factuur-pdf's", tv.count("Vorderingsstaat") >= 3 and tv.count("testfactuur van Yuki") == 2 and "Bankdossier" in tv, (len(pdf.pages), tv[:500]))
    ok("overzicht: kerncijfers en betaald/te betalen", all(x in tv for x in ["2.640,00", "120,00", "2.760,00", "839,52", "Betaald op 15/09/2026"]), tv[:1800])
    p.wait_for_timeout(1200)
    tst = p.evaluate("[...document.querySelectorAll('.toast,#toast')].map(x => x.textContent).join(' | ')")
    ok("ontbrekende pdf van #2 wordt gemeld", "2026-020" in tst, tst)
    d = dl(p, "[data-act=bank-excel]"); import shutil; xp = WORK + "/bank.xlsx"; shutil.copy(d.path(), xp); wb = openpyxl.load_workbook(xp, data_only=True)
    ok("Excel: 4 bladen", wb.sheetnames == ["Overzicht", "Facturen", "Meetstaat en facturatie", "Per onderdeel"], wb.sheetnames)
    ws = wb["Meetstaat en facturatie"]; kop = [c.value for c in ws[1]]; gi = kop.index("Gefactureerd")
    som = round(sum((r[gi].value or 0) for r in ws.iter_rows(min_row=2)), 2)
    ok("Excel: som gefactureerd per post = som facturen excl. (2.172,00)", som == 2172.0, (som, kop))
    fk = wb["Facturen"]; ok("Excel: facturen met status en pdf", [r[0].value for r in fk.iter_rows(min_row=2)] == ["2026-010", "2026-014", "2026-020"] and fk.cell(2, 12).value == "ja" and fk.cell(4, 12).value == "nee")
    ok("geen JS-fouten (portaal)", not [e for e in errs if "PE " in e], errs)
    # Engels: knoppen vertaald
    p.click("[data-act=taal]"); p.wait_for_timeout(800); p.click("[data-tab=facturatie]"); p.wait_for_timeout(500)
    ok("Engels: knoppen vertaald", "For the bank" in p.locator("main").inner_text() and "Complete bank file" in p.locator("main").inner_text())
    p.screenshot(path=WORK + "/shots/fact.png", full_page=False)
# ---------- afronding: meetstaat gewijzigd na een bevroren factuur, en een factuur zonder percentages ----------
pg("update meetstaat_posten set hoeveelheid=10.333 where omschrijving='Tegelvloer keuken'", f=None)   # basis lot 1 verandert → factuur 1 (bevroren 1.260) wordt geschaald
V5 = "eeeeeeee-0000-0000-0000-000000000005"
pg("insert into vorderingen (id, project_id, nr, soort, omschrijving, datum, status, bedrag_excl, btw_bedrag) values (%s,%s,4,'vordering','Factuur zonder verdeling','2026-11-05','opgemaakt',50,3)", (V5, P), f=None)
pg("update vorderingen set status='verzonden', factuurnummer='2026-025' where id=%s", (V5,), f=None)
with sync_playwright() as pw:
    b = pw.chromium.launch(); p, errs = nieuwe_pagina(b, 1400, 950)
    login(p, "klant@x.be", "/app/klant/"); p.click("[data-tab=facturatie]"); p.wait_for_timeout(700)
    d = dl(p, f"[data-act=bank-pdf][data-id='{V1}']"); t1 = "\n".join(x.extract_text() for x in PdfReader(d.path()).pages)
    i0 = t1.find("Totaal aanneming (contract)"); blok = t1[i0:i0 + 160]
    ok("geschaalde factuur: totaalrij 'deze factuur' = exact 1.260,00", "1.260,00" in blok, blok)
    d = dl(p, f"[data-act=bank-pdf][data-id='{V5}']"); t5 = "\n".join(x.extract_text() for x in PdfReader(d.path()).pages)
    ok("factuur zonder percentages: regel 'Niet over de onderdelen verdeeld' met 50,00", "Niet over de onderdelen verdeeld" in t5 and "50,00" in t5, t5[:1800])
    d = dl(p, "[data-act=bank-excel]"); import shutil; shutil.copy(d.path(), WORK + "/bank2.xlsx"); wb = openpyxl.load_workbook(WORK + "/bank2.xlsx", data_only=True)
    ws = wb["Meetstaat en facturatie"]; kop = [c.value for c in ws[1]]
    ci = kop.index("Factuur 2026-014"); s1 = round(sum((r[ci].value or 0) for r in ws.iter_rows(min_row=2)), 2)
    ok("Excel: per post opgeteld = exact het factuurbedrag (1.260,00)", s1 == 1260.0, s1)
    c5 = kop.index("Factuur 2026-025"); s5 = round(sum((r[c5].value or 0) for r in ws.iter_rows(min_row=2)), 2)
    ok("Excel: factuur zonder verdeling telt via 'niet verdeeld' (50,00)", s5 == 50.0, s5)
    gi = kop.index("Gefactureerd"); sg = round(sum((r[gi].value or 0) for r in ws.iter_rows(min_row=2)), 2)
    ok("Excel: totaal gefactureerd = som van alle facturen (2.222,00)", sg == 2222.0, sg)
    ok("geen JS-fouten (afronding)", not [e for e in errs if "PE " in e], errs)
for k, v in R.items(): print(("  " if v == "OK" else "✗ ") + k + ("" if v == "OK" else "  → " + v))
print(f"\n{sum(v == 'OK' for v in R.values())}/{len(R)} OK")
