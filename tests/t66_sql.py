"""Script 062 — klant_vorderingen.betaald_op, yuki_facturen (RLS) en yuki_koppel."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib")); from h import *
from decimal import Decimal as D
R = {}
def ok(k, c, x=""): R[k] = "OK" if c else "FOUT " + str(x)[:600]
herstel("tot61"); seed()
r0 = psql_file(REPO + "/sql/062_bankdossier_yuki.sql"); r1 = psql_file(REPO + "/sql/062_bankdossier_yuki.sql")
ok("062 twee keer uitvoerbaar, controle 1|1|1|62", r0.returncode == 0 and r1.returncode == 0 and r0.stdout.strip().endswith("1|1|1|62") and r1.stdout.strip().endswith("1|1|1|62"), (r0.stdout[-80:], r0.stderr[-400:]))
pg("update instellingen set value = jsonb_set(value, '{versie_schema}', '60') where key='app'", f=None)
rx = psql_file(REPO + "/sql/062_bankdossier_yuki.sql"); ok("062 weigert zonder 061", rx.returncode != 0 and "061" in rx.stderr, rx.stderr[-200:])
pg("update instellingen set value = jsonb_set(value, '{versie_schema}', '62') where key='app'", f=None)
seed_factuur()
ok("klant ziet betaald_op van zijn factuur", als(K, "select betaald_op::text from klant_vorderingen where id=%s", (V0,)) == ("2026-09-15",))
V3 = "eeeeeeee-0000-0000-0000-000000000003"
pg("insert into vorderingen (id, project_id, nr, soort, omschrijving, datum, status) values (%s,%s,3,'vordering','Vordering 3','2026-11-10','opgemaakt')", (V3, P), f=None)
pg("insert into vordering_regels (vordering_id, lot, pct) values (%s,1,0.2)", (V3,), f=None)   # 20 % van lot 1 (840) = 168 excl, 10,08 btw
Y1 = pg("""insert into yuki_facturen (factuurnummer, datum, klant, totaal_incl, mededeling, vervaldag, resultaat, reden, voorstel_project, pdf_drive_id)
           values ('2026-031','2026-11-10','Delta',178.08,'+++111/2222/33394+++','2026-10-01','niet_gevonden','geen vordering met dit bedrag',%s,'drvY1') returning id::text""", (P,))[0]
Y2 = pg("insert into yuki_facturen (factuurnummer, totaal_incl, resultaat) values ('2026-010', 839.52, 'twijfel') returning id::text")[0]
Y3 = pg("insert into yuki_facturen (factuurnummer, totaal_incl, excl, btw, resultaat) values ('2026-099', -50, -47.17, -2.83, 'niet_gevonden') returning id::text")[0]
ok("beheer ziet yuki_facturen", als(B, "select count(*) from yuki_facturen")[0] == 3)
ok("medewerker ziet ze niet", als(M, "select count(*) from yuki_facturen")[0] == 0)
ok("klant ziet ze niet", als(K, "select count(*) from yuki_facturen")[0] == 0)
e = fout(M, "select yuki_koppel(%s,%s,168)", (Y1, V3)); ok("medewerker kan niet koppelen", e and "beheerder" in e, e)
e = fout(K, "select yuki_koppel(%s,%s,168)", (Y1, V3)); ok("klant kan niet koppelen", e is not None, e)
e = fout(B, "update yuki_facturen set resultaat='gekoppeld' where id=%s", (Y1,)); ok("resultaat niet rechtstreeks te wijzigen", e and "permission" in e.lower(), e)
e = fout(B, "insert into yuki_facturen (factuurnummer) values ('x')"); ok("niet zelf toevoegen", e and "permission" in e.lower(), e)
als(B, "update yuki_facturen set genegeerd=true, notitie='creditnota' where id=%s", (Y3,), f=None)
ok("negeren mag (beheer)", pg("select genegeerd, notitie from yuki_facturen where id=%s", (Y3,)) == (True, "creditnota"))
e = fout(B, "select yuki_koppel(%s,%s,168)", (Y1, V1)); ok("vordering met een ander factuurnummer → geweigerd", e and "al factuurnummer" in e, e)
e = fout(B, "select yuki_koppel(%s,%s,700)", (Y2, V3)); ok("factuurnummer dat al bij een andere vordering staat → geweigerd", e and "andere vordering" in e, e)
e = fout(B, "select yuki_koppel(%s,%s,500)", (Y1, V3)); ok("excl. groter dan het totaal → geweigerd", e and "past niet" in e, e)
e = fout(B, "select yuki_koppel(%s,%s,null)", (Y1, V3)); ok("zonder excl.-bedrag → geweigerd", e and "ontbreekt" in e, e)
j = als(B, "select yuki_koppel(%s,%s,168)", (Y1, V3))[0]
v = pg("select factuurnummer, datum::text, bedrag_excl, btw_bedrag, status, mededeling, vervaldag::text, herinneren from vorderingen where id=%s", (V3,))
ok("gekoppeld: nummer, datum, excl 168, btw = totaal − excl (10,08), verzonden, mededeling, vervaldag", v[:7] == ("2026-031", "2026-11-10", D("168.00"), D("10.08"), "verzonden", "+++111/2222/33394+++", "2026-10-01"), v)
ok("oude vervaldag → herinneringen uit (en gemeld)", v[7] is False and j["herinneren_uit"] is True, (v, j))
y = pg("select resultaat, vordering_id::text, handmatig, gekoppeld_door::text from yuki_facturen where id=%s", (Y1,))
ok("yuki-rij: gekoppeld, handmatig, door Phil", y == ("gekoppeld", V3, True, B), y)
ok("antwoord meldt dat er een pdf wacht", j["pdf"] is True, j)
e = fout(B, "select yuki_koppel(%s,%s,168)", (Y1, V3)); ok("twee keer koppelen → al gekoppeld", e and "al gekoppeld" in e, e)
ok("klant ziet de nieuwe factuur", als(K, "select factuurnummer from klant_vorderingen where id=%s", (V3,)) == ("2026-031",))
# een al betaalde vordering zonder nummer blijft betaald
V4 = "eeeeeeee-0000-0000-0000-000000000004"
pg("insert into vorderingen (id, project_id, nr, soort, datum, status, bedrag_excl, btw_bedrag) values (%s,%s,4,'vordering','2026-08-01','opgemaakt',100,6)", (V4, P), f=None)
pg("update vorderingen set status='betaald' where id=%s", (V4,), f=None)
Y4 = pg("insert into yuki_facturen (factuurnummer, totaal_incl, excl, btw, resultaat) values ('2026-005', 106, 100, 6, 'niet_gevonden') returning id::text")[0]
als(B, "select yuki_koppel(%s,%s,999)", (Y4, V4))
ok("betaalde vordering blijft betaald; excl van Yuki wint (100, niet 999)", pg("select status, bedrag_excl, btw_bedrag, factuurnummer from vorderingen where id=%s", (V4,)) == ("betaald", D("100.00"), D("6.00"), "2026-005"))
# zonder vervaldag (herinneren mag niet leeg worden) en btw exact
V6 = "eeeeeeee-0000-0000-0000-000000000006"
pg("insert into vorderingen (id, project_id, nr, soort, datum, status) values (%s,%s,6,'vordering','2026-11-12','opgemaakt')", (V6, P), f=None)
pg("insert into vordering_regels (vordering_id, lot, pct) values (%s,2,0.1)", (V6,), f=None)   # 10 % van lot 2 = 180 excl, 10,80 btw
Y6 = pg("insert into yuki_facturen (factuurnummer, totaal_incl, resultaat) values ('2026-061', 190.80, 'niet_gevonden') returning id::text")[0]
e = fout(B, "select yuki_koppel(%s,%s,180)", (Y6, V6)); ok("koppelen zonder vervaldag lukt", e is None, e)
ok("…herinneringen blijven aan, btw = 10,80", pg("select herinneren, bedrag_excl, btw_bedrag from vorderingen where id=%s", (V6,)) == (True, D("180.00"), D("10.80")))
Y7 = pg("insert into yuki_facturen (factuurnummer, resultaat) values ('2026-062', 'verdacht') returning id::text")[0]
V7 = "eeeeeeee-0000-0000-0000-000000000007"
pg("insert into vorderingen (id, project_id, nr, soort, datum, status) values (%s,%s,7,'vordering','2026-11-12','opgemaakt')", (V7, P), f=None)
e = fout(B, "select yuki_koppel(%s,%s,0)", (Y7, V7)); ok("zonder totaal (verdachte mail) → geweigerd, geen factuur van € 0", e and "totaalbedrag" in e, e)
ok("…vordering ongewijzigd", pg("select status, coalesce(factuurnummer, '') from vorderingen where id=%s", (V7,)) == ("opgemaakt", ""))
for k, v in R.items(): print(("  " if v == "OK" else "✗ ") + k + ("" if v == "OK" else "  → " + v))
print(f"\n{sum(v == 'OK' for v in R.values())}/{len(R)} OK")
