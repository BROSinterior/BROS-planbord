"""Eenmalig per testronde: Postgres starten, testdatabank opbouwen uit sql/001..N (enkel verzonnen testgegevens),
PostgREST en de bibliotheken van het klantenportaal klaarzetten. Maakt in PB_WORK (standaard /tmp/pbtest):
tot61.dump (schema t.e.m. script 061) en basis.dump (alle scripts + testgebruikers en een testproject met facturen)."""
import os, sys, subprocess, json, urllib.request, tarfile, io
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from h import *
sh = lambda c, **k: subprocess.run(["bash", "-c", c], **k)
# 1. Postgres (lokaal cluster op poort 5444)
if not os.path.exists(PGDATA + "/PG_VERSION"):
    sh(f"mkdir -p {PGDATA} && chown postgres {PGDATA} && su postgres -c '{PGBIN}/initdb -D {PGDATA} -A trust -U postgres' >/dev/null", check=True)
pgstart()
# 2. PostgREST
if not os.path.exists(WORK + "/postgrest"):
    src = os.environ.get("PB_POSTGREST")
    if src and os.path.exists(src): sh(f"cp '{src}' {WORK}/postgrest && chmod +x {WORK}/postgrest", check=True)
    else:
        url = "https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz"
        sh(f"cd {WORK} && curl -fsSL {url} | tar xJ && chmod +x postgrest", check=True)
open(WORK + "/pgrst.conf", "w").write('db-uri = "postgres://authenticator:x@localhost:5444/bros"\ndb-schemas = "public"\ndb-anon-role = "anon"\njwt-secret = "%s"\nserver-port = 3333\ndb-pool = 5\n' % gw.SECRET)
# 3. bibliotheken van het klantenportaal (zelfde versies als de cdn-links)
for pak, ver in [("jspdf", "2.5.1"), ("pdf-lib", "1.17.1"), ("xlsx", "0.18.5"), ("qrcode-generator", "1.4.4")]:
    doel = f"{WORK}/vend/x_{pak}-{ver}"
    if not os.path.exists(doel + "/package"):
        sh(f"mkdir -p {doel} && cd {doel} && npm pack {pak}@{ver} --silent >/dev/null && tar xzf *.tgz", check=True)
# 4. testbestanden
def mini_pdf(tekst):   # een geldige pdf van één pagina met tekst (pdf-lib moet ze kunnen samenvoegen, pypdf de tekst lezen)
    stroom = ("BT /F1 14 Tf 72 760 Td (%s) Tj ET" % tekst).encode("latin-1")
    objs = [b"<</Type/Catalog/Pages 2 0 R>>", b"<</Type/Pages/Kids[3 0 R]/Count 1>>", b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>",
            b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>", b"<</Length %d>>stream\n" % len(stroom) + stroom + b"\nendstream"]
    uit = b"%PDF-1.4\n"; pos = []
    for i, o in enumerate(objs): pos.append(len(uit)); uit += b"%d 0 obj\n" % (i + 1) + o + b"\nendobj\n"
    x = len(uit); uit += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + b"".join(b"%010d 00000 n \n" % p for p in pos)
    return uit + b"trailer<</Size %d/Root 1 0 R>>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, x)
if not os.path.exists(WORK + "/factuur.pdf"): open(WORK + "/factuur.pdf", "wb").write(mini_pdf("FACTUUR 2026-014 (testfactuur van Yuki)"))
os.makedirs(WORK + "/img", exist_ok=True)
try:
    from PIL import Image
    Image.new("RGB", (1600, 1000), (180, 150, 120)).save(WORK + "/img/render1.jpg", quality=90)
    Image.new("RGB", (1200, 1200), (90, 120, 160)).save(WORK + "/img/foto2.png")
    Image.new("RGB", (800, 600), (200, 200, 90)).save(WORK + "/img/oud.bmp")
except ImportError: print("PIL ontbreekt: t68_ui slaat de beeldtest over")
# 5. databank: t.e.m. 061 → tot61.dump; alle scripts + testgegevens → basis.dump
lib = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib")
def dump(naam): sh(f"su postgres -c 'pg_dump -h /tmp -p 5444 -Fc bros' > {WORK}/{naam}.dump", check=True)
r = sh(f"PB_REPO='{REPO}' bash '{lib}/bouw.sh' 61", capture_output=True, text=True); print(r.stdout[-300:], r.stderr[-300:])
if "FOUT" in r.stdout: sys.exit("databank t.e.m. 061 niet opgebouwd")
dump("tot61")
r = sh(f"PB_REPO='{REPO}' bash '{lib}/bouw.sh'", capture_output=True, text=True); print(r.stdout[-400:])
if "FOUT" in r.stdout: sys.exit("databank niet opgebouwd")
seed(); seed_factuur(); dump("basis")
print("klaar:", WORK)
