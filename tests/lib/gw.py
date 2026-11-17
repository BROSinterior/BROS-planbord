"""Testpoort: Supabase-auth (wachtwoord 'test'), REST-proxy naar PostgREST, Drive-script-mock, statische app."""
import http.server, socketserver, json, time, threading, urllib.request, urllib.error, os, base64, uuid, psycopg, jwt, mimetypes
WORK = os.environ.get("PB_WORK", "/tmp/pbtest")
SECRET = "testgeheim-testgeheim-testgeheim-1234"; DSN = "host=/tmp port=5444 dbname=bros user=postgres"
APP = WORK + "/app"; DRIVE_LOG = []; AGENDA = []; PDF = open(WORK + "/factuur.pdf", "rb").read() if os.path.exists(WORK + "/factuur.pdf") else b""
def tok(uid, email, role="authenticated"):
    return jwt.encode({"sub": uid, "email": email, "role": role, "aud": "authenticated", "exp": int(time.time()) + 3600 * 8, "iat": int(time.time())}, SECRET, algorithm="HS256")
ANON = jwt.encode({"role": "anon", "exp": int(time.time()) + 3600 * 24 * 30}, SECRET, algorithm="HS256")
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Access-Control-Allow-Headers", "*"); self.send_header("Access-Control-Allow-Methods", "*"); self.send_header("Access-Control-Expose-Headers", "*")
    def do_OPTIONS(self): self.send_response(204); self._cors(); self.end_headers()
    def _json(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self._cors(); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def _body(self):
        n = int(self.headers.get("Content-Length") or 0); return self.rfile.read(n) if n else b""
    def _user(self):
        a = self.headers.get("Authorization", "")[7:]
        try: return jwt.decode(a, SECRET, algorithms=["HS256"], audience="authenticated")
        except Exception: return None
    def do_GET(self): self._route("GET")
    def do_POST(self): self._route("POST")
    def do_PATCH(self): self._route("PATCH")
    def do_DELETE(self): self._route("DELETE")
    def do_PUT(self): self._route("PUT")
    def do_HEAD(self): self._route("HEAD")
    def _route(self, m):
        p = self.path
        if p.startswith("/auth/v1/token"):
            b = json.loads(self._body() or b"{}")
            if "refresh_token" in b: uid, email = b["refresh_token"].split("|", 1)
            else:
                if b.get("password") != "test": return self._json(400, {"error": "invalid_grant", "error_description": "Invalid login credentials"})
                with psycopg.connect(DSN) as c: r = c.execute("select id::text, email from auth.users where lower(email)=lower(%s)", (b.get("email"),)).fetchone()
                if not r: return self._json(400, {"error": "invalid_grant", "error_description": "Invalid login credentials"})
                uid, email = r
            return self._json(200, {"access_token": tok(uid, email), "token_type": "bearer", "expires_in": 28800, "expires_at": int(time.time()) + 28800, "refresh_token": uid + "|" + email,
                                     "user": {"id": uid, "email": email, "aud": "authenticated", "role": "authenticated", "app_metadata": {}, "user_metadata": {}, "created_at": "2026-01-01T00:00:00Z"}})
        if p.startswith("/auth/v1/user"):
            u = self._user(); return self._json(200 if u else 401, {"id": u["sub"], "email": u["email"], "aud": "authenticated", "role": "authenticated", "app_metadata": {}, "user_metadata": {}} if u else {"msg": "no"})
        if p.startswith("/auth/v1/logout"): self.send_response(204); self._cors(); self.end_headers(); return
        if p.startswith("/auth/v1/"): return self._json(200, {})
        if p.startswith("/rest/v1/"):
            body = self._body() if m in ("POST", "PATCH", "PUT", "DELETE") else None
            req = urllib.request.Request("http://127.0.0.1:3333" + p[len("/rest/v1"):], data=body, method=m)
            for k, v in self.headers.items():
                if k.lower() in ("authorization", "content-type", "accept", "prefer", "range", "range-unit", "accept-profile", "content-profile"): req.add_header(k, v)
            if not self.headers.get("Authorization") or self.headers.get("Authorization", "").endswith("undefined"): req.add_header("Authorization", "Bearer " + ANON)
            req.add_header("X-Forwarded-For", self.client_address[0]); req.add_header("User-Agent", self.headers.get("User-Agent", "test"))   # 1.76: zoals Supabase (IP en browser bij goedkeuren)
            try: r = urllib.request.urlopen(req, timeout=30); code, data, hdrs = r.status, r.read(), r.headers
            except urllib.error.HTTPError as e: code, data, hdrs = e.code, e.read(), e.headers
            self.send_response(code); self._cors()
            for k in ("Content-Type", "Content-Range", "Preference-Applied", "Location"):
                if hdrs.get(k): self.send_header(k, hdrs.get(k))
            self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data); return
        if p.startswith("/drive"):
            b = json.loads(self._body() or b"{}"); DRIVE_LOG.append(b); a = b.get("action")
            if a == "bestand":
                if b.get("id") == "00000000-0000-0000-0000-00000000dead": return self._json(200, {"ok": False, "error": "Document niet gevonden."})
                return self._json(200, {"ok": True, "mime": "application/pdf", "b64": base64.b64encode(PDF).decode()})
            if a == "yukikoppel": return self._json(200, {"ok": True, "document": b.get("_doc")})
            if a == "yukifactuur": return self._json(200, {"ok": True, "proef": True, "regels": [{"tarief": r.get("tarief"), "excl": r.get("excl"), "omschrijving": b.get("omschrijving"), "btwcode": ""} for r in b.get("regels", [])], "klant": "Test", "datum": "2026-11-16", "vervaldag": "2026-12-01", "waarschuwingen": ["test"], "xml": "<SalesInvoices/>"})
            if a == "agendaweek": return self._json(200, {"ok": True, "items": AGENDA})   # 1.73: testafspraken uit de Google Agenda
            if a == "put":   # 1.76: bestand bewaren in de projectmap (de pdf blijft in DRIVE_LOG)
                fid = "drv-" + uuid.uuid4().hex[:12]
                return self._json(200, {"ok": True, "file": {"id": fid, "name": b.get("name"), "path": b.get("subpath"), "url": "https://drive.google.com/file/d/" + fid, "size": len(b.get("base64") or "") * 3 // 4}})
            if a == "mwmail":   # 1.76: zoals het Drive-script: wie nog niet gemeld werd en een e-mailadres heeft
                with psycopg.connect(DSN) as c:
                    rs = c.execute("update goedkeuring_aannemers a set gemeld_op = now() from contacten k where k.id = a.contact_id and a.goedkeuring_id = %s and a.gemeld_op is null and k.email <> '' returning k.email", (b.get("id"),)).fetchall(); c.commit()
                return self._json(200, {"ok": True, "naar": [r[0] for r in rs], "zonder": []})
            return self._json(200, {"ok": True})
        if p.startswith("/app/"):
            f = os.path.join(APP, p[5:].split("?")[0]) or APP
            if os.path.isdir(f): f = os.path.join(f, "index.html")
            if not os.path.exists(f): self.send_response(404); self.end_headers(); return
            data = open(f, "rb").read(); self.send_response(200); self.send_header("Content-Type", mimetypes.guess_type(f)[0] or "application/octet-stream"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data); return
        self.send_response(404); self.end_headers()
class S(socketserver.ThreadingMixIn, http.server.HTTPServer): daemon_threads = True; allow_reuse_address = True
def start(port=55400):
    srv = S(("127.0.0.1", port), H); threading.Thread(target=srv.serve_forever, daemon=True).start(); return srv
