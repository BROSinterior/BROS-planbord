"""1.68 — Planbord: eigen beelden bij Renders en in de A3-presentatie (opladen, aanvinken, volgorde, bewerken, verwijderen)."""
import os, sys, json, base64, re; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib")); from h import *
herstel("basis")
pg("insert into storage.buckets (id, name, public) values ('renders','renders',false) on conflict do nothing", f=None)
start_postgrest(); poort(); zetapp()
R = {}
def ok(k, c, x=""): R[k] = "OK" if c else "FOUT " + str(x)[:600]
STORE = {}; UPLOADS = []
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
def sub(route):
    a = route.request.headers.get("authorization", "")
    try: return json.loads(base64.urlsafe_b64decode(a.split(".")[1] + "==="))["sub"]
    except Exception: return None
def storage(route):
    req = route.request; u = req.url; m = req.method; uid = sub(route)
    if "/object/sign/renders" in u and m == "POST":
        paths = json.loads(req.post_data or "{}").get("paths", [])
        return route.fulfill(status=200, content_type="application/json", body=json.dumps([{"path": p, "signedURL": "/object/sign/renders/" + p + "?token=t", "error": None} for p in paths]))
    if "/object/sign/renders/" in u and m == "GET":
        return route.fulfill(status=200, content_type="image/png", body=PNG)
    mm = re.search(r"/storage/v1/object/renders/(.+)$", u.split("?")[0])
    if mm and m in ("POST", "PUT"):
        name = mm.group(1); body = req.post_data_buffer or b""; ct = req.headers.get("content-type", "")
        if ct.startswith("multipart/form-data"):   # supabase-js stuurt een Blob als formulier: enkel het bestand telt
            bnd = ("--" + ct.split("boundary=")[1]).encode()
            for part in body.split(bnd):
                if b"\r\n\r\n" in part and b"filename" in part.split(b"\r\n\r\n", 1)[0] or b"Content-Type: image" in part.split(b"\r\n\r\n", 1)[0]:
                    body = part.split(b"\r\n\r\n", 1)[1][:-2]; break
        e = fout(uid, "insert into storage.objects (bucket_id, name, metadata) values ('renders', %s, jsonb_build_object('size', %s))", (name, len(body)))
        if e: return route.fulfill(status=403, content_type="application/json", body=json.dumps({"statusCode": "403", "error": "Unauthorized", "message": e}))
        STORE[name] = body; UPLOADS.append(name)
        return route.fulfill(status=200, content_type="application/json", body=json.dumps({"Key": "renders/" + name, "Id": "x"}))
    if re.search(r"/storage/v1/object/renders/?$", u.split("?")[0]) and m == "DELETE":
        prefixes = json.loads(req.post_data or "{}").get("prefixes", [])
        for n in prefixes:
            if als(uid, "select rd_bestand_weg_ok(%s)", (n,))[0]: pg("delete from storage.objects where name=%s", (n,), f=None); STORE.pop(n, None)
        return route.fulfill(status=200, content_type="application/json", body=json.dumps([{"name": n} for n in prefixes]))
    route.fulfill(status=404, body="")
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    b = pw.chromium.launch(); p, errs = nieuwe_pagina(b, 1400, 1000)
    p.route("**/storage/v1/**", storage)
    login(p, "medewerker@test.local")
    p.evaluate(f"() => {{ S.view = 'projecten'; S.project = '{P}'; S.ptab = 'renders'; render(); }}"); p.wait_for_timeout(800)
    body = lambda: p.locator("body").inner_text()
    ok("Renders: blok 'Eigen beelden' met knop", "Eigen beelden" in body() and p.locator("[data-rd-act=eigen-nieuw]").count() == 1, body()[:1500])
    ok("A3-presentatie uit zonder beelden", p.locator("[data-rd-act=pres-nieuw]").first.is_disabled())
    # toevoegen via het blok (ruimte Keuken), jpg + png + bmp (omgezet naar JPEG)
    p.locator("[data-rd-act=eigen-nieuw]").click(); p.wait_for_timeout(400)
    p.set_input_files("#eg_f", [WORK + "/img/render1.jpg", WORK + "/img/foto2.png", WORK + "/img/oud.bmp"]); p.fill("#eg_r", "Keuken")
    p.locator("#mform button[type=submit]").click(); p.wait_for_timeout(3500)
    rows = pg("select naam, ruimte, mime, breedte, hoogte, pad, sha256, created_by::text from render_beelden where soort='eigen' order by created_at", f="all")
    ok("3 eigen beelden geregistreerd met ruimte Keuken en maker", len(rows) == 3 and all(r[1] == "Keuken" and r[7] == M for r in rows), rows)
    ok("namen zonder extensie", [r[0] for r in rows] == ["render1", "foto2", "oud"], [r[0] for r in rows])
    ok("bmp omgezet naar JPEG; jpg/png ongewijzigd", [r[2] for r in rows] == ["image/jpeg", "image/png", "image/jpeg"] and rows[2][5].endswith(".jpg"), [r[2] for r in rows])
    ok("afmetingen gelezen (1600×1000)", rows[0][3:5] == (1600, 1000), rows[0])
    import hashlib
    ok("sha256 = inhoud van het opgeladen bestand", all(hashlib.sha256(STORE[r[5]]).hexdigest() == r[6] for r in rows), [(r[5] in STORE) for r in rows])
    ok("pad <project>/eigen/<hex>.<ext>", all(re.match(P + r"/eigen/[0-9a-f]{32}\.(jpg|png)$", r[5]) for r in rows), [r[5] for r in rows])
    ok("blok toont 3 beelden", p.locator(".rd-eg").count() == 3 and "Keuken" in p.locator(".rd-eigen").inner_text())
    ok("A3-presentatie nu mogelijk", not p.locator("[data-rd-act=pres-nieuw]").first.is_disabled())
    # bewerken
    ids = [x[0] for x in pg("select id::text from render_beelden where soort='eigen' order by created_at", f="all")]
    p.locator(f"[data-rd-act=eigen-bewerk][data-id='{ids[1]}']").click(); p.wait_for_timeout(300); p.fill("#eb_n", "Foto bestaande toestand"); p.fill("#eb_r", "Leefruimte"); p.locator("#mform button[type=submit]").click(); p.wait_for_timeout(900)
    ok("naam/ruimte aangepast", pg("select naam, ruimte from render_beelden where id=%s", (ids[1],)) == ("Foto bestaande toestand", "Leefruimte"))
    # presentatie: eigen beelden in het venster, extra opladen vanuit het venster
    p.locator("[data-rd-act=pres-nieuw]").first.click(); p.wait_for_timeout(600)
    ok("presentatievenster: blok eigen beelden met 3 beelden", p.locator("#rp_eigen .rd-pk").count() == 3, p.locator("#modal").inner_text()[:1200])
    p.locator(f"#rp_eigen [data-rd-pk='{ids[2]}']").check(); p.locator(f"#rp_eigen [data-rd-pk='{ids[0]}']").check(); p.wait_for_timeout(200)
    ok("nummering in volgorde van aanvinken", p.locator(f"[data-rd-nr='{ids[2]}']").inner_text() == "1" and p.locator(f"[data-rd-nr='{ids[0]}']").inner_text() == "2")
    p.fill("#rp_er", "Badkamer"); p.set_input_files("[data-rd-pres-eigen]", [WORK + "/img/foto2.png"]); p.wait_for_timeout(2500)
    nieuw = pg("select id::text, ruimte from render_beelden where soort='eigen' order by created_at desc limit 1")
    ok("opladen vanuit het venster: geregistreerd met ruimte Badkamer", nieuw[1] == "Badkamer" and len(ids) == 3 and pg("select count(*) from render_beelden where soort='eigen'")[0] == 4)
    ok("…meteen aangevinkt als nummer 3", p.locator(f"#rp_eigen [data-rd-pk='{nieuw[0]}']").is_checked() and p.locator(f"[data-rd-nr='{nieuw[0]}']").inner_text() == "3", p.locator("#rp_eigen").inner_text())
    ok("melding '1 toegevoegd en aangevinkt'", "1 toegevoegd" in p.locator("#rp_es").inner_text())
    p.locator("#mform button[type=submit]").click(); p.wait_for_timeout(1500)
    pr = pg("select render_ids::text[], klant from render_presentaties order by created_at desc limit 1")
    ok("presentatie aangemaakt met de 3 eigen beelden in volgorde", pr and pr[0] == [ids[2], ids[0], nieuw[0]], pr)
    # verwijderen: niet zolang de presentatie wacht
    p.locator(f"[data-rd-act=eigen-weg][data-id='{ids[0]}']").click(); p.wait_for_timeout(800)
    ok("verwijderen geblokkeerd zolang de presentatie in de wachtrij staat", pg("select count(*) from render_beelden where id=%s", (ids[0],))[0] == 1)
    pg("update render_presentaties set status='klaar'", f=None); p.evaluate("() => refetch('render_presentaties')"); p.wait_for_timeout(800)
    p.locator(f"[data-rd-act=eigen-weg][data-id='{ids[1]}']").click(); p.wait_for_timeout(1500)
    pad1 = rows[1][5]
    ok("verwijderen: rij en bestand weg", pg("select count(*) from render_beelden where id=%s", (ids[1],))[0] == 0 and pad1 not in STORE and pg("select count(*) from storage.objects where name=%s", (pad1,))[0] == 0)
    ok("volledig scherm opent", (p.locator(f"[data-rd-act=eigen-groot][data-id='{ids[0]}']").click() or True) and p.wait_for_timeout(400) is None and p.locator("#rdv").count() >= 1)
    p.keyboard.press("Escape"); p.wait_for_timeout(300)
    # klant ziet niets
    p2, e2 = nieuwe_pagina(b); p2.route("**/storage/v1/**", storage); login(p2, "klant@x.be", "/app/klant/")
    ok("klantenportaal: geen eigen beelden zichtbaar", "render1" not in p2.locator("body").inner_text())
    ok("geen JS-fouten", not [e for e in errs if "PE " in e], errs)
    p.evaluate(f"() => {{ S.view = 'projecten'; S.project = '{P}'; S.ptab = 'renders'; render(); }}"); p.wait_for_timeout(700)
    p.screenshot(path=WORK + "/shots/eigen.png", full_page=True)
for k, v in R.items(): print(("  " if v == "OK" else "✗ ") + k + ("" if v == "OK" else "  → " + v))
print(f"\n{sum(v == 'OK' for v in R.values())}/{len(R)} OK")
