"""1.77 — Naservice (script 069): voorlopige oplevering aanvinken, klant meldt in het portaal, BROS registreert een mail,
beoordeelt en wijst toe, de aannemer plant en meldt opgelost, BROS sluit af; de tijdlijn ligt vast; definitieve oplevering
met voorbehoud; hoofdscherm Naservice. Enkel verzonnen testgegevens."""
import os, sys, re, json; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib")); from h import *
herstel("basis")
R = {}
def ok(k, c, x=""): R[k] = "OK" if c else "FOUT " + str(x)[:600]
CA = "cccccccc-7700-0000-0000-00000000000a"; CB = "cccccccc-7700-0000-0000-00000000000b"
pg("update projecten set drive_folder_id='fldTest' where id=%s", (P,), f=None)
pg("insert into contacten (id, soort, naam, email, user_id) values (%s,'aannemer','Omega Olaf','aan@x.be',%s)", (CA, A), f=None)
pg("insert into project_contacten (project_id, contact_id, rol) values (%s,%s,'aannemer')", (P, CA), f=None)
pg("insert into contacten (id, soort, naam, email) values (%s,'aannemer','Kappa Kris','kappa@test.local')", (CB,), f=None)
ok("script 069: schemaversie 69", pg("select (value->>'versie_schema')::int from instellingen where key='app'")[0] >= 69)
# --- databank: regels die vastliggen ---
ok("klant kan niets melden vóór de voorlopige oplevering", "na de voorlopige oplevering" in (fout(K, "select naservice_melden(%s,'Kras in de deur')", (P,)) or ""))
start_postgrest(); poort(); zetapp()
FOTO = lambda sub: json.dumps([{"path": f"{P}/{sub}/a.jpg", "url": f"https://x.supabase.co/storage/v1/object/public/werf/{P}/{sub}/a.jpg", "w": 10, "h": 10}])
def pwacht(pagina, fn, t=10.0):
    for _ in range(int(t / 0.25)):
        try:
            if fn(): return True
        except Exception: pass
        pagina.wait_for_timeout(250)
    return fn()
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.chromium.launch(); p, errs = nieuwe_pagina(b, 1440, 950)
    login(p, "beheer@test.local")
    p.evaluate(f"() => {{ S.view='projecten'; S.project='{P}'; S.ptab='naservice'; render(); }}"); p.wait_for_timeout(500)
    ok("tabblad Naservice in de groep Werf", p.locator('.subtabs button[data-ptab="naservice"]').count() == 1 and p.locator('.subtabs button[data-ptab="werf"]').count() == 1, p.locator(".subtabs").inner_text() if p.locator(".subtabs").count() else "")
    ok("nog niet opgeleverd: knop Voorlopig opgeleverd met termijn 12 maanden", p.locator('[data-ns="voorlopig"]').count() == 1 and p.locator("#ns_tm").input_value() == "12")
    vo = pg("select (current_date - 40)::text")[0]
    p.fill("#ns_vo", vo); p.fill("#ns_opm", "Samen met de klant overlopen"); p.locator('[data-ns="voorlopig"]').click(); p.wait_for_timeout(1200)
    pr = pg("select voorlopig_opgeleverd_op::text, oplevering_termijn_maanden, opgeleverd_op::text from projecten where id=%s", (P,))
    ok("voorlopig opgeleverd bewaard (ook 'werkelijk opgeleverd op')", pr == (vo, 12, vo), pr)
    ok("historiek: voorlopig opgeleverd, met mail aan de klant", pg("select count(*) from naservice_gebeurtenissen where project_id=%s and soort='voorlopig' and melden and position('Samen met de klant' in tekst) > 0", (P,))[0] == 1)
    p.evaluate("async () => { await refetch('projecten'); await refetch('naservice_gebeurtenissen'); render(); }"); p.wait_for_timeout(500)
    ok("lijn voorlopig → vandaag → definitief", p.locator(".ns-balk .ns-nu").count() == 1 and "tot de definitieve oplevering" in p.locator(".ns-balk").inner_text(), p.locator("main").inner_text()[:300])
    # --- klantenportaal: melden ---
    k, kerrs = nieuwe_pagina(b, 1300, 900); login(k, "klant@x.be", "/app/klant/")
    ok("klant: tab Naservice + melding op Welkom", k.locator('nav.tabs [data-tab="naservice"]').count() == 1 and "voorlopig opgeleverd" in k.locator("main").inner_text())
    k.locator('nav.tabs [data-tab="naservice"]').click(); k.wait_for_timeout(400)
    ok("klant: lijn met de definitieve oplevering", k.locator(".ns-balk").count() == 1 and "definitieve oplevering" in k.locator(".ns-balk").inner_text().lower())
    k.locator('[data-act="ns-nieuw"]').first.click(); k.wait_for_timeout(200)
    k.fill('#nsForm input[name="titel"]', "Lade van de keukenkast sluit niet"); k.fill('#nsForm textarea[name="omschrijving"]', "Sinds vorige week, linkse lade"); k.fill('#nsForm input[name="ruimte"]', "Keuken")
    k.locator('#nsForm button[type="submit"]').click(); k.wait_for_timeout(1500)
    n1 = pg("select id::text, nr, status, bron, gemeld_naam, gemeld_door::text from naservice_punten where titel like 'Lade%%'")
    ok("klant: punt gemeld (NS-001, ontvangen, door de klant)", n1 and n1[1] == 1 and n1[2] == "ontvangen" and n1[3] == "klant" and n1[4] == "Daan Klant" and n1[5] == CK, n1)
    N1 = n1[0]
    ok("klant: BROS meteen verwittigd (naservicemail)", any(x.get("action") == "naservicemail" and x.get("id") == N1 for x in gw.DRIVE_LOG))
    ok("klant: punt staat er met stappen (Ontvangen)", "Lade van de keukenkast" in k.locator("main").inner_text() and k.locator(".ns-stap.nu").count() >= 1)
    # --- databank: foto's en rechten ---
    ok("klant: foto's enkel uit zijn eigen map", "Ongeldige" in (fout(K, "select naservice_melden(%s,'Test foto','','',%s::jsonb)", (P, FOTO("aannemer"))) or "") and fout(K, "select naservice_melden(%s,'Test foto ok','','',%s::jsonb)", (P, FOTO("klant"))) is None)
    pg("delete from naservice_punten where titel like 'Test foto%%'", f=None)
    ok("klant kan niet zelf aanvaarden of afsluiten", "enkel een bericht" in (fout(K, "select naservice_actie(%s,'afgesloten')", (N1,)) or ""))
    ok("status wijzigen kan enkel via de knoppen", "met de knoppen" in (fout(M, "update naservice_punten set status='afgesloten' where id=%s", (N1,)) or ""))
    ok("aannemer ziet nog niets (niet toegewezen)", als(A, "select count(*) from aan_naservice_punten")[0] == 0)
    # --- Planbord: punt per mail registreren ---
    p.evaluate("async () => { await refetch('naservice_punten'); await refetch('naservice_gebeurtenissen'); render(); }"); p.wait_for_timeout(500)
    ok("bord: het punt van de klant staat bij Te beoordelen", "Lade van de keukenkast" in p.locator(".ns-bord .ns-kol").first.inner_text() and p.locator('.subtabs button[data-ptab="naservice"] .cnt').inner_text() == "1")
    p.locator('[data-ns="nieuw"]').click(); p.wait_for_timeout(300)
    p.select_option("#nsp_bron", "mail"); op_mail = pg("select to_char((now() - interval '3 days') at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI')")[0]
    p.fill("#nsp_op", op_mail); p.fill("#nsp_titel", "Silicone in de douche loskomend"); p.fill("#nsp_oms", "Mail van de klant: de voeg bij de douchebak komt los."); p.fill("#nsp_ruimte", "Badkamer")
    p.locator("#mform button[type=submit]").click(); p.wait_for_timeout(1500)
    n2 = pg("select id::text, nr, bron, status, to_char(ontvangen_op at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI') from naservice_punten where titel like 'Silicone%%'")
    ok("mail geregistreerd met de datum van de mail (NS-002)", n2 and n2[1] == 2 and n2[2] == "mail" and n2[4] == op_mail, n2)
    N2 = n2[0]
    e2 = pg("select door_rol, door_naam, position('per mail' in tekst) > 0, to_char(op at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI') from naservice_gebeurtenissen where punt_id=%s and soort='ontvangen'", (N2,))
    ok("historiek: ontvangen per mail op de maildatum, geregistreerd door BROS", e2 and e2[2] and e2[3] == op_mail, e2)
    ok("detail opent na registreren", p.locator("#mform .ns-stappen").count() == 1 and "NS-002" in p.locator("#modal .mh").inner_text())
    # --- toewijzen aan aannemer ---
    p.evaluate(f"() => nsDetail('{N1}')"); p.wait_for_timeout(300)
    p.locator('[data-ns="toon"][data-act2="toewijzen"]').click(); p.wait_for_timeout(200)
    p.select_option("#ns_a_contact", CA); p.fill("#ns_a_tekst", "Graag deze week"); p.locator('[data-ns="doe"]').click(); p.wait_for_timeout(1200)
    ok("toegewezen: aannemer + status aanvaard", pg("select status, contact_id::text from naservice_punten where id=%s", (N1,)) == ("aanvaard", CA))
    ok("detail: historiek toont 'Vakman ingeschakeld' met de opdracht", "Vakman ingeschakeld" in p.locator("#mform .ns-tl").inner_text() and "Graag deze week" in p.locator("#mform .ns-tl").inner_text())
    # zelf geregistreerde actie met een datum + interne notitie
    p.locator('#mform input[name="ns_soort"][value="registratie"]').check(); p.wait_for_timeout(100)
    reg_op = pg("select to_char((now() - interval '1 day') at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI')")[0]
    p.fill("#ns_op", reg_op); p.fill("#ns_tekst", "Klant gebeld: sleutel ligt bij de buren"); p.locator("#ns_zk").uncheck()
    p.locator('[data-ns="bericht"]').click(); p.wait_for_timeout(1000)
    rg = pg("select to_char(op at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI'), zichtbaar_klant, melden, created_at > op from naservice_gebeurtenissen where punt_id=%s and soort='registratie'", (N1,))
    ok("actie geregistreerd met eigen datum, intern, zonder mail", rg and rg[0] == reg_op and rg[1] is False and rg[2] is False and rg[3], rg)
    ok("detail: 'geregistreerd op' zichtbaar bij een actie met een andere datum", "geregistreerd op" in p.locator("#mform .ns-tl").inner_text())
    ok("klant ziet de interne notitie niet", als(K, "select count(*) from klant_naservice_tijdlijn where soort='registratie'")[0] == 0)
    p.evaluate("() => { const c = document.querySelector('#mform [data-close]'); if (c) c.click(); }"); p.wait_for_timeout(200)
    # --- aannemersportaal ---
    a, aerrs = nieuwe_pagina(b, 1300, 900); login(a, "aan@x.be", "/app/aannemer/")
    a.evaluate(f"() => {{ S.project='{P}'; S.tab='naservice'; render(); }}"); a.wait_for_timeout(500)
    at = a.locator("main").inner_text()
    ok("aannemer: tab Naservice met het toegewezen punt (niet het andere)", a.locator('nav.tabs [data-tab="naservice"]').count() == 1 and "Lade van de keukenkast" in at and "Silicone" not in at, at[:400])
    ok("aannemer ziet de interne notitie niet", "sleutel ligt bij de buren" not in at)
    dg = pg("select (current_date + 5)::text")[0]
    a.fill('form.nsa-form[data-actie="ingepland"] input[name="datum"]', dg); a.locator('form.nsa-form[data-actie="ingepland"] button').click(); a.wait_for_timeout(1500)
    ok("aannemer plant een datum", pg("select status, gepland_op::text from naservice_punten where id=%s", (N1,)) == ("ingepland", dg))
    a.fill('form.nsa-form[data-actie="opgelost"] textarea[name="tekst"]', "Geleider vervangen"); a.locator('form.nsa-form[data-actie="opgelost"] button').click(); a.wait_for_timeout(1500)
    ok("aannemer meldt opgelost", pg("select status from naservice_punten where id=%s", (N1,))[0] == "opgelost")
    ok("aannemer: kaart bijgewerkt na de actie (opgelost, geen formulieren meer)", "Opgelost" in a.locator("main").inner_text() and a.locator('form.nsa-form[data-actie="opgelost"]').count() == 0, a.locator("main").inner_text()[:300])
    ok("aannemer: BROS meteen verwittigd", sum(1 for x in gw.DRIVE_LOG if x.get("action") == "naservicemail" and x.get("id") == N1) >= 3)
    ok("aannemer kan niet afsluiten", "Een aannemer kan" in (fout(A, "select naservice_actie(%s,'afgesloten')", (N1,)) or ""))
    # --- klant volgt het ---
    k.reload(); k.wait_for_timeout(2500); k.locator('nav.tabs [data-tab="naservice"]').click(); k.wait_for_timeout(400)
    k.locator(f'#ns-{N1} details summary').click(); k.wait_for_timeout(200)
    kt = k.locator(f"#ns-{N1}").inner_text()
    ok("klant: status opgelost, vakman en historiek (BROS en aannemer)", "Opgelost" in kt and "Omega Olaf" in kt and "Herstelling ingepland" in kt and "Geleider vervangen" in kt and "AANNEMER" in kt.upper(), kt[:600])
    ok("klant: punt per mail staat er ook (gemeld per mail)", "Silicone in de douche" in k.locator("main").inner_text() and "per mail" in k.locator("main").inner_text())
    k.fill(f'#ns-{N1} form.ns-reactie textarea[name="tekst"]', "Is in orde, bedankt!"); k.locator(f'#ns-{N1} form.ns-reactie button[type=submit]').click(); k.wait_for_timeout(1500)
    ok("klant: reactie in de historiek", pg("select count(*) from naservice_gebeurtenissen where punt_id=%s and soort='bericht' and door_rol='klant' and tekst like 'Is in orde%%'", (N1,))[0] == 1)
    # --- BROS sluit af ---
    p.evaluate(f"async () => {{ await nsVers('{N1}'); nsDetail('{N1}'); }}"); p.wait_for_timeout(400)
    p.locator('[data-ns="toon"][data-act2="afgesloten"]').click(); p.locator('[data-ns="doe"]').click(); p.wait_for_timeout(1000)
    ok("afgesloten", pg("select status, afgesloten_op is not null from naservice_punten where id=%s", (N1,)) == ("afgesloten", True))
    ok("stappen: alle vijf afgevinkt", p.locator("#mform .ns-stap.klaar").count() == 5, p.locator("#mform .ns-stappen").inner_text())
    soorten = [r[0] for r in pg("select soort from naservice_gebeurtenissen where punt_id=%s order by op, created_at", (N1,), f="all")]
    ok("volledige historiek in volgorde", [x for x in soorten if x != "registratie"][:2] == ["ontvangen", "toegewezen"] and all(s in soorten for s in ["registratie", "ingepland", "opgelost", "bericht", "afgesloten"]), soorten)
    ok("historiek kan niet gewist worden", pg("select count(*) from naservice_gebeurtenissen where punt_id=%s", (N1,))[0] == len(soorten) and (fout(B, "delete from naservice_gebeurtenissen where punt_id=%s", (N1,)) or "") is not None or pg("select count(*) from naservice_gebeurtenissen where punt_id=%s", (N1,))[0] == len(soorten))
    ok("punt met historiek kan niet verwijderd worden", "blijft bewaard" in (fout(B, "delete from naservice_punten where id=%s", (N1,)) or ""))
    p.evaluate("() => { const c = document.querySelector('#mform [data-close]'); if (c) c.click(); }"); p.wait_for_timeout(200)
    # niet onder naservice
    ok("niet onder naservice vraagt een uitleg", "uit waarom" in (fout(M, "select naservice_actie(%s,'geweigerd','')", (N2,)) or ""))
    # --- definitieve oplevering (zoals het Drive-script: service) ---
    ok("definitief opleveren: enkel beheer", "Enkel een beheerder" in (fout(M, "update projecten set definitief_opgeleverd_op=current_date where id=%s", (P,)) or ""))
    pg("update projecten set definitief_opgeleverd_op = current_date, definitief_automatisch = true where id=%s", (P,), f=None)   # zoals het Drive-script (geen gewone login)
    ok("definitief: historiek + voorbehoud voor het open punt (niet voor het afgesloten)", pg("select count(*) from naservice_gebeurtenissen where project_id=%s and soort='definitief'", (P,))[0] == 1
       and pg("select count(*) from naservice_gebeurtenissen where punt_id=%s and soort='voorbehoud'", (N2,))[0] == 1 and pg("select count(*) from naservice_gebeurtenissen where punt_id=%s and soort='voorbehoud'", (N1,))[0] == 0)
    ok("na definitief: voorlopige datum en termijn liggen vast", "al definitief opgeleverd" in (fout(B, "update projecten set oplevering_termijn_maanden=24 where id=%s", (P,)) or ""))
    ok("klant ziet de definitieve oplevering", als(K, "select definitief_opgeleverd_op is not null from klant_oplevering")[0] is True and als(K, "select count(*) from klant_naservice_tijdlijn where soort='definitief'")[0] == 1)
    p.evaluate("async () => { await refetch('projecten'); await refetch('naservice_punten'); await refetch('naservice_gebeurtenissen'); render(); }"); p.wait_for_timeout(500)
    ok("Planbord: lijn toont 'Definitief opgeleverd'", "Definitief opgeleverd" in p.locator(".ns-balk").inner_text() and p.locator(".ns-balk.klaar").count() == 1)
    p.screenshot(path=WORK + "/shots/t77-project.png", full_page=True)
    # --- hoofdscherm ---
    p.evaluate("() => { S.view='naservice'; S.project=null; render(); }"); p.wait_for_timeout(400)
    mt = p.locator("main").inner_text()
    ok("hoofdscherm Naservice: open punten + definitief opgeleverde projecten", "Openstaande punten" in mt and "Silicone" in mt and "Definitief opgeleverd" in mt, mt[:400])
    ok("Meer-menu bevat Naservice", "naservice" in p.evaluate("() => MEER_TABS.join(',')"))
    p.screenshot(path=WORK + "/shots/t77-overzicht.png")
    k.reload(); k.wait_for_timeout(2500); k.locator('nav.tabs [data-tab="naservice"]').click(); k.wait_for_timeout(400); k.screenshot(path=WORK + "/shots/t77-klant.png", full_page=True)
    a.evaluate("async () => { await loadAll(); render(); S.tab = 'naservice'; render(); }"); a.wait_for_timeout(800); a.screenshot(path=WORK + "/shots/t77-aannemer.png", full_page=True)
    ok("geen JS-fouten (Planbord, klant, aannemer)", not [e for e in errs + kerrs + aerrs if "PE " in e], errs + kerrs + aerrs)
for kk, v in R.items(): print(("  " if v == "OK" else "✗ ") + kk + ("" if v == "OK" else "  → " + v))
print(f"\n{sum(v == 'OK' for v in R.values())}/{len(R)} OK")
