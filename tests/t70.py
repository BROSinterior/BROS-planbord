"""1.70 — script 064 (vordering vastzetten, mijn_markeringen) + Planbord: Klaar voor Yuki, Overzicht, projecten zonder Drive-map, tellers, Gezien/Later in de databank."""
import os, sys, json, re; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib")); from h import *
from decimal import Decimal as D
herstel("basis")
R = {}
def ok(k, c, x=""): R[k] = "OK" if c else "FOUT " + str(x)[:600]
r = psql_file(REPO + "/sql/064_vastzetten_markeringen.sql"); ok("064 mag opnieuw (controle 2|1|2|≥64)", re.search(r"2\|1\|2\|(6[4-9]|[7-9][0-9])", r.stdout) is not None, r.stdout + r.stderr)
V3 = "eeeeeeee-0000-0000-0000-000000000003"
pg("insert into vorderingen (id, project_id, nr, soort, omschrijving, datum, status) values (%s,%s,3,'vordering','Vordering 3','2026-11-10','opgemaakt')", (V3, P), f=None)
pg("insert into vordering_regels (vordering_id, lot, pct) values (%s,1,0.2)", (V3,), f=None)
# ---- databank ----
ok("vastzetten zonder bedrag → geweigerd", "bedrag" in (fout(B, "update vorderingen set vast_op=now() where id=%s", (V3,)) or ""))
ok("vastzetten met bedrag en btw", fout(B, "update vorderingen set vast_op=now(), bedrag_excl=168, btw_bedrag=10.08 where id=%s", (V3,)) is None and pg("select vast_door::text from vorderingen where id=%s", (V3,))[0] == B)
ok("vast: bedrag wijzigen → geweigerd", "eerst los" in (fout(B, "update vorderingen set bedrag_excl=170 where id=%s", (V3,)) or ""))
ok("vast: percentages wijzigen → geweigerd", "eerst los" in (fout(B, "update vordering_regels set pct=0.3 where vordering_id=%s", (V3,)) or ""))
ok("vast: omschrijving mag wel", fout(B, "update vorderingen set omschrijving='Vordering 3 — kasten' where id=%s", (V3,)) is None)
ok("vast → verzonden (zoals bij het koppelen) mag; 'vast' vervalt", fout(B, "update vorderingen set status='verzonden', factuurnummer='2026-031' where id=%s", (V3,)) is None and pg("select vast_op from vorderingen where id=%s", (V3,))[0] is None)
ok("verzonden vordering vastzetten → geweigerd", "nog op te maken" in (fout(B, "update vorderingen set vast_op=now() where id=%s", (V3,)) or ""))
e = fout(B, "update vorderingen set status='opgemaakt', factuurnummer='' where id=%s", (V3,)); ok("terug naar op te maken: niet vast", e is None and pg("select vast_op from vorderingen where id=%s", (V3,))[0] is None, e)
pg("update vorderingen set vast_op=now(), bedrag_excl=168, btw_bedrag=10.08 where id=%s", (V3,), f=None)
ok("losmaken: bedrag en btw leeg", fout(B, "update vorderingen set vast_op=null, bedrag_excl=null, btw_bedrag=null where id=%s", (V3,)) is None and pg("select vast_op, vast_door, bedrag_excl from vorderingen where id=%s", (V3,)) == (None, None, None))
ok("na losmaken: percentages weer vrij", fout(B, "update vordering_regels set pct=0.2 where vordering_id=%s", (V3,)) is None)
# markeringen
ok("eigen markering (wj) bewaren", fout(M, "insert into mijn_markeringen (soort, sleutel, stempel, tot) values ('wj','vs:1','x','2026-12-01')") is None and pg("select user_id::text from mijn_markeringen where sleutel='vs:1'")[0] == M)
ok("markering voor een ander → geweigerd", fout(M, "insert into mijn_markeringen (user_id, soort, sleutel) values (%s,'wj','vs:2')", (B,)) is not None)
ok("beheer: 'niet gewerkt' voor een medewerker mag", fout(B, "insert into mijn_markeringen (user_id, soort, sleutel) values (%s,'uw','t1')", (M,)) is None)
pg("insert into mijn_markeringen (user_id, soort, sleutel) values (%s,'wj','geheim')", (B,), f=None)
ok("collega ziet 'niet gewerkt' van anderen, niet hun Gezien/Later", als(M, "select count(*) from mijn_markeringen where user_id=%s and soort='uw'", (M,))[0] == 1 and als(M, "select count(*) from mijn_markeringen where user_id=%s", (B,))[0] == 0)
ok("klant ziet niets", als(K, "select count(*) from mijn_markeringen")[0] == 0 and fout(K, "insert into mijn_markeringen (soort, sleutel) values ('wj','x')") is not None)
pg("delete from mijn_markeringen", f=None)
# ---- Planbord ----
start_postgrest(); poort(); zetapp()
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.chromium.launch(); p, errs = nieuwe_pagina(b, 1440, 1000)
    p.context.grant_permissions(["clipboard-read", "clipboard-write"], origin="http://127.0.0.1:55400")
    login(p, "beheer@test.local")
    # tellers rond
    rad = p.evaluate("() => { const c = document.querySelector('nav .cnt, .cnt'); return c ? getComputedStyle(c).borderRadius : '' }")
    ok("tellers zijn rond (border-radius 9px)", rad == "9px", rad)
    ok("cijfers in het gewone lettertype", "Mono" not in p.evaluate("() => { const e = document.querySelector('.num') || document.body; return getComputedStyle(e).fontFamily }"))
    # Overzicht
    p.evaluate("() => { S.view='overzicht'; render(); }"); p.wait_for_timeout(500); body = lambda: p.locator("body").inner_text()
    ok("Overzicht: tegels voor jezelf met het team eronder", "Mijn open taken" in body() and "Mijn uren deze week" in body() and "team" in body())
    ok("Overzicht: uren per project zonder projecten met 0 / 0 u", "0 / 0 u" not in p.locator(".panel", has_text="Uren per project").inner_text(), p.locator(".panel", has_text="Uren per project").inner_text()[:400])
    # projecten zonder Drive-map
    ok("Wacht op jou (beheer): lopende projecten zonder Drive-map", "zonder Drive-map" in body(), body()[:1200])
    p.evaluate("() => { S.view='instellingen'; render(); }"); p.wait_for_timeout(400)
    ok("Instellingen: lijst met knop per project", p.locator(".panel", has_text="Projecten zonder Drive-map").count() >= 1 and p.locator(f"[data-act=drive-create][data-pid='{P}']").count() == 1)
    # Klaar voor Yuki
    p.evaluate(f"() => {{ S.view='projecten'; S.project='{P}'; S.ptab='facturatie'; render(); }}"); p.wait_for_timeout(700)
    ok("facturatie: knop 'Klaar voor Yuki' bij een vordering op te maken", p.locator(f"[data-act=vord-vast][data-id='{V3}']").count() == 1, body()[:800])
    p.locator(f"[data-act=vord-vast][data-id='{V3}']").click(); p.wait_for_timeout(1200)
    v = pg("select vast_op is not null, bedrag_excl, btw_bedrag, status from vorderingen where id=%s", (V3,))
    ok("vastgezet op het berekende bedrag (168 + 10,08), status blijft op te maken", v == (True, D("168.00"), D("10.08"), "opgemaakt"), v)
    ok("🔒 Klaar voor Yuki + Kopiëren + Losmaken; geen ✕ meer", "Klaar voor Yuki" in body() and p.locator(f"[data-act=vord-kopie][data-id='{V3}']").count() == 1 and p.locator(f"[data-act=vord-los][data-id='{V3}']").count() == 1 and p.locator(f"[data-act=vord-del][data-id='{V3}']").count() == 0)
    p.locator(f"[data-act=vord-kopie][data-id='{V3}']").click(); p.wait_for_timeout(500)
    klem = p.evaluate("() => navigator.clipboard.readText()")
    ok("kopiëren voor Yuki: klant, projectnummer, bedragen", "Klant: Delta Daan" in klem and "260099" in klem and "Totaal excl. btw: € 168,00" in klem and "Btw: € 10,08" in klem and "Totaal incl. btw: € 178,08" in klem, klem)
    # meetstaat wijzigt: vastgezet bedrag blijft
    pg("update meetstaat_prijzen set eenheidsprijs = eenheidsprijs * 2 where post_id in (select id from meetstaat_posten where project_id=%s and lot=1)", (P,), f=None)
    p.evaluate("() => refetch('meetstaat_posten')"); p.wait_for_timeout(900)
    tot = p.evaluate(f"() => vordCalc(S.vorderingen['{V3}']).incl")
    ok("meetstaat dubbel zo duur → vastgezette vordering blijft 178,08", abs(tot - 178.08) < 0.005, tot)
    p.locator(f"[data-act=vord-los][data-id='{V3}']").click(); p.wait_for_timeout(1200)
    ok("losmaken: weer berekend (nu duurder)", pg("select vast_op, bedrag_excl from vorderingen where id=%s", (V3,)) == (None, None) and p.evaluate(f"() => vordCalc(S.vorderingen['{V3}']).incl") > 200)
    # Gezien/Later in de databank
    pg("insert into vaststellingen (project_id, titel, status, te_beoordelen) values (%s,'Barst in tegel','open',true)", (P,), f=None)
    p.evaluate("() => { refetch('vaststellingen'); S.view='overzicht'; render(); }"); p.wait_for_timeout(900)
    later = p.locator("[data-wj-act=weg]").first
    if later.count():
        later.click(); p.wait_for_timeout(800)
        ok("Later → bewaard in de databank", pg("select count(*) from mijn_markeringen where user_id=%s and soort='wj'", (B,))[0] == 1)
        q, e2 = nieuwe_pagina(b); login(q, "beheer@test.local"); q.evaluate("() => { S.view='overzicht'; render(); }"); q.wait_for_timeout(600)
        ok("…en ook verborgen in een andere browser", "Barst in tegel" not in q.locator("body").inner_text(), q.locator("body").inner_text()[:800])
    else: ok("Later-knop aanwezig", False, body()[:1000])
    ok("geen JS-fouten", not [e for e in errs if "PE " in e], errs)
    p.screenshot(path=WORK + "/shots/t70.png", full_page=False)
for k, v in R.items(): print(("  " if v == "OK" else "✗ ") + k + ("" if v == "OK" else "  → " + v))
print(f"\n{sum(v == 'OK' for v in R.values())}/{len(R)} OK")
