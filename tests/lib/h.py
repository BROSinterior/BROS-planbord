import os, sys, json, time, subprocess, psycopg
LIB = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, LIB)
REPO = os.environ.get("PB_REPO") or os.path.dirname(os.path.dirname(LIB))   # de repository (tests/lib → ..)
WORK = os.environ.get("PB_WORK", "/tmp/pbtest"); os.makedirs(WORK + "/shots", exist_ok=True)
PGBIN = os.environ.get("PB_PGBIN", "/usr/lib/postgresql/16/bin"); PGDATA = os.environ.get("PB_PGDATA", "/var/tmp/pbtest-pg")
import gw
DSN = "host=/tmp port=5444 dbname=bros user=postgres"
B = "11111111-1111-1111-1111-111111111111"; M = "33333333-3333-3333-3333-333333333333"; K = "66666666-6666-6666-6666-666666666666"; A = "44444444-4444-4444-4444-444444444444"
P = "aaaaaaaa-0000-0000-0000-000000000001"; CK = "cccccccc-0000-0000-0000-000000000001"
def pg(sql, a=(), f="one"):
    with psycopg.connect(DSN) as c:
        r = c.execute(sql, a); x = r.fetchone() if f == "one" else r.fetchall() if f == "all" else None; c.commit(); return x
def als(uid, sql, args=(), f="one"):
    with psycopg.connect(DSN) as c:
        cur = c.cursor(); cur.execute("set local role authenticated"); cur.execute("select set_config('request.jwt.claim.sub',%s,true)", (uid,))
        cur.execute(sql, args); r = (cur.fetchone() if f == "one" else cur.fetchall() if f == "all" else None) if cur.description else None; c.commit(); return r
def fout(uid, sql, args=()):
    try: als(uid, sql, args, f=None); return None
    except psycopg.Error as e: return e.diag.message_primary or str(e)
def psql_file(path):
    subprocess.run(["bash", "-c", f"cp '{path}' /tmp/s.sql; chmod 644 /tmp/s.sql"], check=True)
    return subprocess.run(["bash", "-c", "su postgres -c \"psql -h /tmp -p 5444 -d bros -v ON_ERROR_STOP=1 -q -tA -f /tmp/s.sql\""], capture_output=True, text=True)
def pgstart():
    if subprocess.run(["bash","-c","su postgres -c \"psql -h /tmp -p 5444 -d postgres -tAc 'select 1'\" >/dev/null 2>&1"]).returncode:
        subprocess.run(["bash","-c",f"su postgres -c \"{PGBIN}/pg_ctl -D {PGDATA} -o '-p 5444 -k /tmp' -l {PGDATA}.log start\" >/dev/null 2>&1; sleep 2"])
def herstel(dump="basis"):
    pgstart()
    subprocess.run(["bash", "-c", f"""su postgres -c "psql -h /tmp -p 5444 -d postgres -qc \\"select pg_terminate_backend(pid) from pg_stat_activity where datname='bros' and pid<>pg_backend_pid()\\"" >/dev/null; su postgres -c "dropdb -h /tmp -p 5444 --if-exists bros && createdb -h /tmp -p 5444 bros" && su postgres -c "pg_restore -h /tmp -p 5444 -d bros {WORK}/{dump}.dump" 2>&1 | grep -v "^$" | head -3"""], check=True)
def seed():
    for uid, email, naam, rol in [(B, "beheer@test.local", "Phil", "beheer"), (M, "medewerker@test.local", "Noa", "medewerker"), (K, "klant@x.be", "Daan Klant", "klant"), (A, "aan@x.be", "Aannemer Jan", "aannemer")]:
        pg("insert into auth.users (id, email, raw_user_meta_data) values (%s,%s,%s) on conflict do nothing", (uid, email, json.dumps({"name": naam})), f=None)
        pg("insert into profiles (id, email, name, role, active) values (%s,%s,%s,%s,true) on conflict (id) do update set role=excluded.role, name=excluded.name, email=excluded.email, active=true", (uid, email, naam, rol), f=None)
    pg("""insert into projecten (id, klant, naam, nummer, adres, postcode, gemeente, status, lead, btw_tarief, start)
          values (%s,'Delta Daan','Renovatie woning','260099','Teststraat 12','2018','Antwerpen','lopend',%s,6,'2026-09-01')""", (P, M), f=None)
    pg("insert into contacten (id, soort, naam, email, user_id) values (%s,'klant','Daan Klant','klant@x.be',%s)", (CK, K), f=None)
    pg("insert into project_contacten (project_id, contact_id, rol) values (%s,%s,'bouwheer')", (P, CK), f=None)
def start_postgrest():
    subprocess.run(["bash", "-c", f"pkill -x postgrest; sleep 0.5; cd {WORK} && (nohup ./postgrest pgrst.conf > pgrst.log 2>&1 &)"], check=True)
    for _ in range(40):
        try:
            import urllib.request; urllib.request.urlopen("http://127.0.0.1:3333/", timeout=1); break
        except Exception as e:
            if "40" in str(e): break
            time.sleep(0.25)
    time.sleep(0.6)
_srv = []
def poort():
    if not _srv: _srv.append(gw.start())
def zetapp():
    subprocess.run(["bash", "-c", f"rm -rf {WORK}/app && mkdir -p {WORK}/app && cp -r {REPO}/. {WORK}/app/ && rm -rf {WORK}/app/.git {WORK}/app/tests"], check=True)
    open(WORK + "/app/config.js", "w").write(f'window.PLANBORD_CONFIG = {{ supabaseUrl: "http://127.0.0.1:55400", supabaseAnonKey: "{gw.ANON}", driveScriptUrl: "https://script.google.com/macros/s/TESTSCRIPT/exec" }};\n')
VEND = {"jspdf": WORK + "/vend/x_jspdf-2.5.1/package/dist/jspdf.umd.min.js", "pdf-lib": WORK + "/vend/x_pdf-lib-1.17.1/package/dist/pdf-lib.min.js",
        "xlsx": WORK + "/vend/x_xlsx-0.18.5/package/dist/xlsx.full.min.js", "qrcode": WORK + "/vend/x_qrcode-generator-1.4.4/package/qrcode.js"}
FAKE_WS = r"""(() => { class FakeWS { constructor(url) { this.url = url; this.readyState = 0; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen({}); }, 10); }
  send(d) { let m; try { m = JSON.parse(d); } catch (e) { return; } const zeg = (o) => setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(o) }), 5);
    if (m.event === "phx_join") { const pc = (m.payload && m.payload.config && m.payload.config.postgres_changes) || []; zeg({ topic: m.topic, event: "phx_reply", payload: { status: "ok", response: { postgres_changes: pc.map((b, i) => Object.assign({}, b, { id: i + 1 })) } }, ref: m.ref, join_ref: m.join_ref }); }
    else if (m.event === "heartbeat" || m.event === "phx_leave") zeg({ topic: m.topic, event: "phx_reply", payload: { status: "ok", response: {} }, ref: m.ref }); }
  close() { this.readyState = 3; this.onclose && this.onclose({ code: 1000 }); } }
  FakeWS.CONNECTING = 0; FakeWS.OPEN = 1; FakeWS.CLOSING = 2; FakeWS.CLOSED = 3; window.WebSocket = FakeWS; })();"""
def routes(page):
    def cdn(route):
        u = route.request.url
        for k, f in VEND.items():
            if k in u: return route.fulfill(status=200, content_type="text/javascript", body=open(f, "rb").read())
        route.abort()
    page.route("https://cdnjs.cloudflare.com/**", cdn); page.route("https://cdn.jsdelivr.net/**", cdn)
    def drive(route):
        import urllib.request
        b = route.request.post_data or "{}"
        r = urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:55400/drive", data=b.encode(), method="POST"))
        route.fulfill(status=200, content_type="application/json", body=r.read())
    page.route("https://script.google.com/**", drive)
    page.route("https://fonts.googleapis.com/**", lambda r: r.abort()); page.route("https://fonts.gstatic.com/**", lambda r: r.abort())
def nieuwe_pagina(b, w=1400, h=950):
    ctx = b.new_context(viewport={"width": w, "height": h}, accept_downloads=True); ctx.add_init_script(FAKE_WS); p = ctx.new_page(); errs = []
    p.on("pageerror", lambda e: errs.append("PE " + str(e)))
    p.on("console", lambda m: errs.append("C " + m.text) if m.type == "error" and "WebSocket" not in m.text and "Failed to load resource" not in m.text and "ERR_" not in m.text else None)
    p.on("dialog", lambda d: d.accept())
    routes(p); return p, errs
def login(page, email, pad="/app/"):
    page.goto("http://127.0.0.1:55400" + pad); page.wait_for_timeout(900)
    if page.locator("input[type=password]").count():
        page.fill("input[type=email]", email); page.fill("input[type=password]", "test"); page.keyboard.press("Enter")
    page.wait_for_timeout(2500)
def wacht(fn, t=8.0):
    eind = time.time() + t
    while time.time() < eind:
        try:
            r = fn()
            if r: return r
        except Exception: pass
        time.sleep(0.25)
    return fn()
D1 = "dddddddd-0000-0000-0000-000000000001"; D2 = "dddddddd-0000-0000-0000-000000000002"
V0 = "eeeeeeee-0000-0000-0000-000000000000"; V1 = "eeeeeeee-0000-0000-0000-000000000001"; V2 = "eeeeeeee-0000-0000-0000-000000000002"
def seed_factuur():
    pg("update loten set marge=0.2 where nr in (1,2)", f=None)
    ids = {}
    for key, lot, code, oms, h, eh, kost, st in [("A", 1, "1.1", "Tegelvloer keuken", 10, "m2", 50, "akkoord"), ("A2", 1, "1.2", "Plinten", 20, "lm", 10, "akkoord"),
                                                 ("C", 2, "2.1", "Wandkast eik", 1, "sog", 1000, "akkoord"), ("C2", 2, "2.2", "Stopcontacten", 5, "stk", 100, "akkoord"),
                                                 ("MW", 1, "1.3", "Extra tegels badkamer", 2, "stk", 50, "meerwerk")]:
        i = pg("insert into meetstaat_posten (project_id, lot, code, omschrijving, hoeveelheid, eenheid, status, locatie, volgorde) values (%s,%s,%s,%s,%s,%s,%s,'keuken',%s) returning id::text", (P, lot, code, oms, h, eh, st, int(code.split('.')[1]) * 10))[0]
        pg("update meetstaat_prijzen set eenheidsprijs=%s where post_id=%s", (kost, i), f=None); ids[key] = i
    for d, nr in [(D1, "2026-010"), (D2, "2026-014")]:
        pg("insert into documenten (id, project_id, drive_id, naam, pad, url, mime, gedeeld) values (%s,%s,%s,%s,'Documenten/Facturen','https://drive.google.com/x','application/pdf',true)", (d, P, "drv" + nr, "Factuur " + nr + ".pdf"), f=None)
    def vord(vid, nr, soort, oms, regels, nummer, datum, extra):
        pg("insert into vorderingen (id, project_id, nr, soort, omschrijving, datum, status) values (%s,%s,%s,%s,%s,%s,'opgemaakt')", (vid, P, nr, soort, oms, datum), f=None)
        for lot, post, pct in regels: pg("insert into vordering_regels (vordering_id, lot, post_id, pct) values (%s,%s,%s,%s)", (vid, lot, post, pct), f=None)
        sets = ", ".join(f"{k}=%s" for k in extra); pg(f"update vorderingen set status='verzonden', factuurnummer=%s{', ' + sets if sets else ''} where id=%s", (nummer, *extra.values(), vid), f=None)
    vord(V0, 0, "voorschot", "Voorschot bij ondertekening", [(1, None, 0.3), (2, None, 0.3)], "2026-010", "2026-09-05", {"factuur_document": D1, "mededeling": "+++090/9337/55493+++"})
    pg("update vorderingen set status='betaald', betaald_op='2026-09-15' where id=%s", (V0,), f=None)
    vord(V1, 1, "vordering", "Vordering 1 — afbraak en kasten", [(1, None, 0.5), (2, ids["C"], 0.7)], "2026-014", "2026-10-20", {"factuur_document": D2, "vervaldag": "2026-11-04"})
    vord(V2, 2, "meerwerk", "Meerwerk badkamer", [(1, None, 1.0)], "2026-020", "2026-11-02", {"vervaldag": "2026-11-16"})
    pg("""insert into instellingen (key, value) values ('portaal', '{"iban":"BE68539007547034","begunstigde":"BROS BV","bedrijf_naam":"BROS BV","bedrijf_adres":"Kloosterstraat 165, 2000 Antwerpen","bedrijf_btw":"BE 0123.456.789"}')
          on conflict (key) do update set value = excluded.value""", f=None)
    pg("""insert into instellingen (key, value) values ('drive', '{"url":"https://script.google.com/macros/s/TESTSCRIPT/exec","secret":"x"}') on conflict (key) do update set value = excluded.value""", f=None)
    pg("update profiles set portaal_zichtbaar=true where id in (%s,%s)", (B, M), f=None)
    return ids
