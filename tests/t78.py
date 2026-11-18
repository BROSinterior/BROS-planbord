"""1.78 — naservice: een beheerder past de datum aan van een geregistreerde actie of van de ontvangst van een door BROS
geregistreerde melding (script 070). De oorspronkelijke datum, wie, wanneer en waarom blijven bewaard."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib")); from h import *
herstel("basis")
R = {}
def ok(k, c, x=""): R[k] = "OK" if c else "FOUT " + str(x)[:600]
ok("script 070: schemaversie 70", pg("select (value->>'versie_schema')::int from instellingen where key='app'")[0] >= 70)
als(B, "update projecten set voorlopig_opgeleverd_op = current_date - 30 where id=%s", (P,), f=None)
NK = als(K, "select naservice_melden(%s,'Lade sluit niet','','Keuken')", (P,))[0]
NM = als(M, "insert into naservice_punten (project_id, titel, bron, ontvangen_op, gemeld_naam) values (%s,'Silicone loskomend','mail', now() - interval '3 days','Daan Klant') returning id::text", (P,))[0]
als(M, "select naservice_actie(%s,'aanvaard')", (NM,), f=None)
als(M, "select naservice_actie(%s,'registratie','Klant gebeld',null,null,'[]',true,false, now() - interval '1 day')", (NM,), f=None)
ev = lambda punt, soort: pg("select id::text from naservice_gebeurtenissen where punt_id=%s and soort=%s", (punt, soort))[0]
EREG, EMAIL, EKLANT, EAANV = ev(NM, "registratie"), ev(NM, "ontvangen"), ev(NK, "ontvangen"), ev(NM, "aanvaard")
# --- databank ---
ok("medewerker kan geen datum aanpassen", "Enkel een beheerder" in (fout(M, "select naservice_datum(%s, now() - interval '2 days')", (EREG,)) or ""))
ok("datum in de toekomst wordt geweigerd", "toekomst" in (fout(B, "select naservice_datum(%s, now() + interval '2 days')", (EREG,)) or ""))
ok("melding die de klant zelf deed: tijdstip ligt vast", "Enkel de datum" in (fout(B, "select naservice_datum(%s, now() - interval '5 days')", (EKLANT,)) or ""))
ok("stap 'aanvaard': tijdstip ligt vast", "Enkel de datum" in (fout(B, "select naservice_datum(%s, now() - interval '5 days')", (EAANV,)) or ""))
ok("rechtstreeks wijzigen blijft onmogelijk", pg("select count(*) from naservice_gebeurtenissen where id=%s and op_oorspronkelijk is null", (EREG,))[0] == 1 and (fout(B, "update naservice_gebeurtenissen set op = now() - interval '9 days' where id=%s", (EREG,)) is not None or pg("select op_oorspronkelijk is null and op > now() - interval '2 days' from naservice_gebeurtenissen where id=%s", (EREG,))[0]))
start_postgrest(); poort(); zetapp()
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.chromium.launch()
    m, merrs = nieuwe_pagina(b, 1440, 950); login(m, "medewerker@test.local")
    m.evaluate(f"() => {{ S.view='projecten'; S.project='{P}'; S.ptab='naservice'; render(); nsDetail('{NM}'); }}"); m.wait_for_timeout(500)
    ok("medewerker ziet geen 'datum aanpassen'", m.locator('#mform [data-ns="datum"]').count() == 0)
    p, errs = nieuwe_pagina(b, 1440, 950); login(p, "beheer@test.local")
    p.evaluate(f"() => {{ S.view='projecten'; S.project='{P}'; S.ptab='naservice'; render(); nsDetail('{NM}'); }}"); p.wait_for_timeout(500)
    ok("beheer: 'datum aanpassen' bij de actie en bij de ontvangst per mail (niet bij de andere stappen)", p.locator(f'#mform [data-ns="datum"][data-ev="{EREG}"]').count() == 1 and p.locator(f'#mform [data-ns="datum"][data-ev="{EMAIL}"]').count() == 1 and p.locator('#mform [data-ns="datum"]').count() == 2)
    p.locator(f'#mform [data-ns="datum"][data-ev="{EREG}"]').click(); p.wait_for_timeout(200)
    nieuw = pg("select to_char((now() - interval '6 days') at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI')")[0]
    oud = pg("select to_char(op at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI') from naservice_gebeurtenissen where id=%s", (EREG,))[0]
    ok("formulier staat klaar met de huidige datum", p.locator("#ns_dt").input_value() == oud, [p.locator("#ns_dt").input_value(), oud])
    p.fill("#ns_dt", nieuw); p.fill("#ns_dt_reden", "verkeerde dag ingevuld"); p.locator('[data-ns="datum-bewaar"]').click(); p.wait_for_timeout(1200)
    r = pg("select to_char(op at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI'), to_char(op_oorspronkelijk at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI'), op_gewijzigd_naam, op_reden, op_gewijzigd_door::text from naservice_gebeurtenissen where id=%s", (EREG,))
    ok("datum aangepast; oorspronkelijke datum, naam en reden bewaard", r == (nieuw, oud, "Phil", "verkeerde dag ingevuld", B), r)
    ok("historiek toont de aanpassing", "datum aangepast door Phil" in p.locator("#mform .ns-tl").inner_text() and "verkeerde dag ingevuld" in p.locator("#mform .ns-tl").inner_text(), p.locator("#mform .ns-tl").inner_text()[-400:])
    # tweede aanpassing: de eerste datum blijft de oorspronkelijke
    als(B, "select naservice_datum(%s, now() - interval '5 days', 'toch dag later')", (EREG,), f=None)
    ok("tweede aanpassing: de oorspronkelijke datum blijft de eerste", pg("select to_char(op_oorspronkelijk at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI'), op_reden from naservice_gebeurtenissen where id=%s", (EREG,)) == (oud, "toch dag later"))
    # ontvangst per mail: het punt verandert mee
    p.evaluate(f"async () => {{ await nsVers('{NM}'); nsDetail('{NM}'); }}"); p.wait_for_timeout(300)
    p.locator(f'#mform [data-ns="datum"][data-ev="{EMAIL}"]').click(); p.wait_for_timeout(200)
    nieuw2 = pg("select to_char((now() - interval '10 days') at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI')")[0]
    p.fill("#ns_dt", nieuw2); p.locator('[data-ns="datum-bewaar"]').click(); p.wait_for_timeout(1200)
    ok("ontvangst aangepast: het punt krijgt dezelfde ontvangstdatum", pg("select to_char(ontvangen_op at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI') from naservice_punten where id=%s", (NM,))[0] == nieuw2 == pg("select to_char(op at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI') from naservice_gebeurtenissen where id=%s", (EMAIL,))[0])
    ok("detail: stap 'Ontvangen' toont de nieuwe datum", nieuw2[8:10] + "/" + nieuw2[5:7] in p.locator("#mform .ns-stappen").inner_text(), p.locator("#mform .ns-stappen").inner_text())
    ok("klant ziet de nieuwe datum (zonder interne velden)", als(K, "select to_char(ontvangen_op at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI') from klant_naservice_punten where id=%s", (NM,))[0] == nieuw2
       and "op_oorspronkelijk" not in [c[0] for c in pg("select column_name from information_schema.columns where table_name='klant_naservice_tijdlijn'", f="all")])
    p.screenshot(path=WORK + "/shots/t78.png")
    ok("geen JS-fouten", not [e for e in errs + merrs if "PE " in e], errs + merrs)
for kk, v in R.items(): print(("  " if v == "OK" else "✗ ") + kk + ("" if v == "OK" else "  → " + v))
print(f"\n{sum(v == 'OK' for v in R.values())}/{len(R)} OK")
