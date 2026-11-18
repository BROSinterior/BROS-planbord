"""1.68 — script 063: eigen beelden (soort 'eigen'), opslagregel, registreren, bewerken, presentatie, verwijderen."""
import os, sys; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib")); from h import *
import re
herstel("basis")
r = psql_file(REPO + "/sql/063_presentatie_eigen_beelden.sql"); R = {}
def ok(k, c, x=""): R[k] = "OK" if c else "FOUT " + str(x)[:500]
ok("063 voert uit, controle 1|2|≥63 (verlaagt een hogere schemaversie niet)", re.search(r"1\|2\|(6[3-9]|[7-9][0-9])", r.stdout) is not None and not r.stderr.strip().count("ERROR"), r.stdout + r.stderr)
r2 = psql_file(REPO + "/sql/063_presentatie_eigen_beelden.sql"); ok("063 mag opnieuw", re.search(r"1\|2\|(6[3-9]|[7-9][0-9])", r2.stdout) is not None, r2.stdout + r2.stderr)
pg("insert into storage.buckets (id, name, public) values ('renders','renders',false) on conflict do nothing", f=None)
SHA = "a" * 64
def upload(uid, pad, size=1234):
    return fout(uid, "insert into storage.objects (bucket_id, name, metadata) values ('renders', %s, jsonb_build_object('size', %s))", (pad, size))
pad = f"{P}/eigen/abc123.jpg"
ok("medewerker mag opladen onder <project>/eigen/", upload(M, pad) is None, upload(M, pad + "x"))
ok("klant mag niet opladen", upload(K, f"{P}/eigen/k.jpg") is not None)
ok("niet in een submap", upload(M, f"{P}/eigen/sub/a.jpg") is not None)
args = lambda p=pad, mime="image/jpeg", sha=SHA, size=1234, ruimte="Keuken": (P, p, "Render Enscape keuken.jpg", mime, size, sha, 4000, 3000, ruimte)
SQL = "select (render_eigen_bewaar(%s,%s,%s,%s,%s,%s,%s,%s,%s)).id::text"
b1 = als(M, SQL, args())[0]
row = pg("select soort, ruimte, naam, created_by::text, breedte from render_beelden where id=%s", (b1,))
ok("registreren: soort eigen, ruimte, naam, maker", row == ("eigen", "Keuken", "Render Enscape keuken.jpg", M, 4000), row)
ok("zelfde pad opnieuw → dezelfde rij", als(M, SQL, args())[0] == b1)
ok("ander project in het pad → geweigerd", "Ongeldig pad" in (fout(M, SQL, (P, "aaaaaaaa-0000-0000-0000-0000000000ff/eigen/x.jpg", "x", "image/jpeg", 1, SHA, 1, 1, "")) or ""))
ok("verkeerd mime → geweigerd", "PNG" in (fout(M, SQL, args(mime="image/gif")) or ""))
ok("bestand niet (volledig) in de opslag → geweigerd", "opslag" in (fout(M, SQL, args(p=f"{P}/eigen/bestaatniet.jpg")) or ""))
ok("verkeerde grootte → geweigerd", "opslag" in (fout(M, SQL, args(p=pad, size=999)) or ""))
ok("klant: geen toegang", "Geen toegang" in (fout(K, SQL, args()) or ""))
ok("ruimte '*' wordt leeg", (upload(M, f"{P}/eigen/st.png") is None) and pg("select ruimte from render_beelden where id=%s", (als(M, SQL, args(p=f"{P}/eigen/st.png", mime="image/png", ruimte="*"))[0],))[0] == "")
# bewerken
als(M, "select render_eigen_bewerk(%s, %s, %s)", (b1, "Zicht op eiland", "Leefruimte"))
ok("bewerken: naam en ruimte", pg("select naam, ruimte from render_beelden where id=%s", (b1,)) == ("Zicht op eiland", "Leefruimte"))
ok("bewerken van een render (geen eigen beeld) → geweigerd", "niet gevonden" in (fout(M, "select render_eigen_bewerk(%s, 'x', 'y')", (pg("select id::text from render_beelden where soort <> 'eigen' limit 1")[0] if pg("select count(*) from render_beelden where soort<>'eigen'")[0] else "00000000-0000-0000-0000-000000000000",)) or ""))
# presentatie
pr = als(M, "select (render_presentatie_maak(%s, 'Delta', 'V1 - Voorontwerp', current_date, false, array[%s]::uuid[], true)).id::text", (P, b1))
ok("presentatie met enkel een eigen beeld", pr and pg("select render_ids[1]::text, status from render_presentaties where id=%s", (pr[0],)) == (b1, "wachtrij"))
upload(M, f"{P}/sfeer/s.jpg"); sf = als(M, "select (render_sfeer_bewaar(%s,%s,'s','image/jpeg',1234,%s,1,1)).id::text", (P, f"{P}/sfeer/s.jpg", SHA))[0]
ok("sfeerbeeld in een presentatie → geweigerd", "eigen beelden" in (fout(M, "select render_presentatie_maak(%s,'K','V1',current_date,false,array[%s]::uuid[])", (P, sf)) or ""))
# job voor de Mac mini bevat het eigen beeld (pad + sha)
ok("presentatie-opdracht: eigen beeld met pad en sha256 (claim-query)", pg("select count(*) from render_beelden b where exists (select 1 from render_presentaties r where r.id=%s and b.id = any(r.render_ids)) and b.pad=%s and b.sha256=%s", (pr[0], pad, SHA))[0] == 1)
# verwijderen
b2 = als(M, SQL, args(p=f"{P}/eigen/st.png", mime="image/png"))[0]
ok("klant kan het niet verwijderen (enkel maker of beheer)", als(B, "select count(*) from render_beelden where id=%s", (b2,))[0] == 1 and (fout(K, "delete from render_beelden where id=%s", (b2,)) is None) and pg("select count(*) from render_beelden where id=%s", (b2,))[0] == 1)
als(M, "delete from render_beelden where id=%s", (b2,), f=None)
ok("maker verwijdert de rij", pg("select count(*) from render_beelden where id=%s", (b2,))[0] == 0)
ok("daarna mag het bestand weg (rd_bestand_weg_ok)", als(M, "select rd_bestand_weg_ok(%s)", (f"{P}/eigen/st.png",))[0] is True and als(M, "select rd_bestand_weg_ok(%s)", (pad,))[0] is False)
ok("oude soorten nog toegelaten (constraint)", pg("select pg_get_constraintdef(oid) from pg_constraint where conname='render_beelden_soort_check'")[0].count("'") == 12)
for k, v in R.items(): print(("  " if v == "OK" else "✗ ") + k + ("" if v == "OK" else "  → " + v))
print(f"\n{sum(v == 'OK' for v in R.values())}/{len(R)} OK")
