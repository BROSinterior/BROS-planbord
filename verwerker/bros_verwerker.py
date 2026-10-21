#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
BROS Planbord — verwerkingscomputer (Mac mini) voor Vergaderingen & opnames (script 051, v1.54)

Haalt opdrachten op uit de beveiligde wachtrij in Supabase (één tegelijk), en per opname:
  1. haalt het origineel op (uploaddelen uit de opslag 'opnames', of het origineel op Drive) en controleert het (SHA-256 / MD5);
  2. zet het om naar 16 kHz mono WAV (ffmpeg) en maakt een kleine afspeelkopie (AAC 32 kbit/s mono);
  3. knipt lange opnames op stiltes in delen (standaard ~10 min) en transcribeert elk deel LOKAAL met whisper.cpp
     (Metal op Apple Silicon); het model wordt per deel geladen in een apart proces en het geheugen is daarna weer vrij;
  4. bewaart het origineel + transcript in de projectmap op Drive (via het Drive-script) en controleert de kopie (MD5);
  5. (optioneel) maakt een conceptverslag via een cloud-API (Anthropic) en controleert dat automatisch tegen het transcript
     (citaten, getallen, voorwaarden, ontkenningen, namen); zonder API-sleutel: enkel transcript + gevonden kritieke gegevens;
  6. levert alles in als CONCEPT (status 'klaar voor controle') en ruimt de tijdelijke bestanden op.

Geen externe Python-pakketten nodig (alleen de standaardbibliotheek). Nodig op de Mac: ffmpeg, whisper.cpp (whisper-cli) en een model.
Geheimen staan NIET in deze code of in het configuratiebestand maar in de macOS-sleutelhanger (dienst 'BROS-verwerker').

Gebruik:
  python3 bros_verwerker.py              # de dienst (zo start launchd hem)
  python3 bros_verwerker.py controle     # alles nakijken: programma's, model, sleutelhanger, login, Drive-script, schijf
  python3 bros_verwerker.py test FILE    # één opname lokaal verwerken zonder Planbord (rapport + transcript in ./testresultaat)
  python3 bros_verwerker.py meet FILE --modellen a.bin,b.bin   # praktijktest: verwerkingstijd/geheugen per model vergelijken
"""
import base64
import difflib
import hashlib
import json
import os
import platform
import re
import resource
import shutil
import signal
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid as uuidlib
from datetime import datetime, timezone

VERSIE = "1.56.2"
# vaktermen die het spraakmodel als woordenschat meekrijgt (aan te passen in config.json › "woordenlijst")
WOORDENLIJST = ["werf", "werfbezoek", "werfvergadering", "meetstaat", "offerte", "meerwerk", "minwerk", "vordering", "oplevering",
                "schrijnwerker", "aannemer", "bouwheer", "ontwerp", "plannen", "maatwerk", "Planbord"]
IS_MAC = platform.system() == "Darwin"

# ---------------------------------------------------------------- configuratie
STANDAARD = {
    "naam": "macmini",
    "supabase_url": "",
    "supabase_anon_key": "",
    "email": "",
    "drive_script_url": "",
    "ffmpeg": "ffmpeg",
    "ffprobe": "ffprobe",
    "whisper_cli": "whisper-cli",
    "whisper_model": "",
    "vad_model": "",
    "whisper_threads": 4,
    "whisper_extra": [],
    "taal": "nl",
    "deel_minuten": 10,
    "werkmap": "",
    "min_vrij_gb": 15,
    "poll_seconden": 20,
    "laag_vertrouwen": 0.45,
    "llm": {"provider": "anthropic", "model": "claude-sonnet-5-5", "max_tokens": 16000, "tweede_controle": False,
            "prijs_input_per_mtok": 2.0, "prijs_output_per_mtok": 10.0, "url": "https://api.anthropic.com/v1/messages"},
}
SLEUTELHANGER_DIENST = "BROS-verwerker"


def standaard_configpad():
    if os.environ.get("BROS_VERWERKER_CONFIG"):
        return os.environ["BROS_VERWERKER_CONFIG"]
    if IS_MAC:
        return os.path.expanduser("~/Library/Application Support/BROS-verwerker/config.json")
    return os.path.expanduser("~/.config/bros-verwerker/config.json")


def laad_config(pad=None):
    pad = pad or standaard_configpad()
    cfg = json.loads(json.dumps(STANDAARD))
    if os.path.exists(pad):
        with open(pad, "r", encoding="utf-8") as f:
            eigen = json.load(f)
        for k, v in eigen.items():
            if k == "llm" and isinstance(v, dict):
                cfg["llm"].update(v)
            else:
                cfg[k] = v
    if not cfg["werkmap"]:
        cfg["werkmap"] = os.path.expanduser("~/Library/Caches/BROS-verwerker" if IS_MAC else "~/.cache/bros-verwerker")
    cfg["_pad"] = pad
    return cfg


def geheim(account, env):
    """Uit de macOS-sleutelhanger; op andere systemen (tests) uit een omgevingsvariabele."""
    if os.environ.get(env):
        return os.environ[env].strip()
    if IS_MAC:
        try:
            r = subprocess.run(["security", "find-generic-password", "-s", SLEUTELHANGER_DIENST, "-a", account, "-w"],
                               capture_output=True, text=True, timeout=10)
            if r.returncode == 0:
                return r.stdout.strip()
        except Exception:
            pass
    return ""


_LOGLOCK = threading.Lock()


def log(*a):
    """Naar stdout; met BROS_LOG ook naar dat bestand (wisselt bij 10 MB: één oude kopie .1)."""
    regel = " ".join([datetime.now().strftime("%Y-%m-%d %H:%M:%S")] + [str(x) for x in a])
    pad = os.environ.get("BROS_LOG")
    if not pad:
        print(regel, flush=True)
        return
    with _LOGLOCK:
        try:
            if os.path.exists(pad) and os.path.getsize(pad) > 10 * 1024 * 1024:
                os.replace(pad, pad + ".1")
            with open(pad, "a", encoding="utf-8") as f:
                f.write(regel + "\n")
        except OSError:
            print(regel, flush=True)


class Fout(Exception):
    """Fout met een begrijpelijke melding voor het Planbord. opnieuw=True: later opnieuw proberen."""
    def __init__(self, melding, detail="", opnieuw=True):
        super().__init__(melding)
        self.melding = melding
        self.detail = detail
        self.opnieuw = opnieuw


class Gestopt(Exception):
    pass


# ---------------------------------------------------------------- HTTP
def http(method, url, headers=None, data=None, timeout=120, stream_naar=None):
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            if stream_naar is not None:
                h = hashlib.sha256()
                n = 0
                while True:
                    blok = r.read(1024 * 1024)
                    if not blok:
                        break
                    stream_naar.write(blok)
                    h.update(blok)
                    n += len(blok)
                return r.status, {"sha256": h.hexdigest(), "bytes": n}, dict(r.headers)
            body = r.read()
            return r.status, body, dict(r.headers)
    except urllib.error.HTTPError as e:
        body = e.read() if hasattr(e, "read") else b""
        return e.code, body, dict(e.headers or {})
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
        raise Fout("Geen verbinding met het internet of de server (%s)." % url.split("/")[2], repr(e), opnieuw=True)


def json_of(body):
    try:
        return json.loads(body.decode("utf-8") if isinstance(body, (bytes, bytearray)) else body)
    except Exception:
        return None


# ---------------------------------------------------------------- Supabase
class Supabase:
    def __init__(self, cfg):
        self.url = cfg["supabase_url"].rstrip("/")
        self.key = cfg["supabase_anon_key"]
        self.email = cfg["email"]
        self.token = None
        self.refresh = None
        self.verloopt = 0
        self.lock = threading.Lock()

    def _login(self):
        wachtwoord = geheim("supabase-wachtwoord", "BROS_SUPABASE_WACHTWOORD")
        if not wachtwoord:
            raise Fout("Geen wachtwoord voor de verwerkingslogin in de sleutelhanger (zie LEESMIJ).", opnieuw=False)
        if self.refresh:
            st, body, _ = http("POST", self.url + "/auth/v1/token?grant_type=refresh_token", {"apikey": self.key, "Content-Type": "application/json"},
                               json.dumps({"refresh_token": self.refresh}).encode(), timeout=30)
            if st == 200:
                return self._zet(json_of(body))
        st, body, _ = http("POST", self.url + "/auth/v1/token?grant_type=password", {"apikey": self.key, "Content-Type": "application/json"},
                           json.dumps({"email": self.email, "password": wachtwoord}).encode(), timeout=30)
        if st != 200:
            raise Fout("Inloggen van de verwerkingscomputer mislukt (%s). Klopt het wachtwoord in de sleutelhanger?" % st, body[:300].decode("utf-8", "replace"), opnieuw=True)
        self._zet(json_of(body))

    def _zet(self, j):
        self.token = j["access_token"]
        self.refresh = j.get("refresh_token") or self.refresh
        self.verloopt = time.time() + int(j.get("expires_in", 3600)) - 120

    def headers(self, extra=None):
        with self.lock:
            if not self.token or time.time() > self.verloopt:
                self._login()
            h = {"apikey": self.key, "Authorization": "Bearer " + self.token}
        if extra:
            h.update(extra)
        return h

    def rpc(self, naam, args, timeout=120):
        for poging in range(2):
            st, body, _ = http("POST", self.url + "/rest/v1/rpc/" + naam, self.headers({"Content-Type": "application/json"}), json.dumps(args).encode(), timeout=timeout)
            if st == 401 and poging == 0:
                self.token = None
                continue
            if st >= 300:
                j = json_of(body) or {}
                melding = j.get("message") or body[:300].decode("utf-8", "replace")
                raise Fout("Planbord: " + melding, "%s %s" % (naam, st), opnieuw=st >= 500 or st == 429)
            return json_of(body) if body else None

    def download(self, pad, doel):
        with open(doel, "wb") as f:
            st, info, _ = http("GET", self.url + "/storage/v1/object/authenticated/opnames/" + urllib.parse.quote(pad), self.headers(), timeout=600, stream_naar=f)
        if st != 200:
            raise Fout("Uploaddeel niet gevonden in de opslag (%s)." % st, pad, opnieuw=st >= 500)
        return info

    def upload(self, pad, bestand, mime):
        with open(bestand, "rb") as f:
            data = f.read()
        st, body, _ = http("POST", self.url + "/storage/v1/object/opnames/" + urllib.parse.quote(pad), self.headers({"Content-Type": mime, "x-upsert": "false"}), data, timeout=600)
        if st in (400, 409) and re.search(rb"Duplicate|already exists|409", body or b""):
            return   # al opgeladen bij een vorige poging van dezelfde opdracht
        if st >= 300:
            raise Fout("Afspeelkopie opladen mislukt (%s)." % st, body[:300].decode("utf-8", "replace"), opnieuw=True)

    def verwijder(self, paden):
        if not paden:
            return
        st, body, _ = http("DELETE", self.url + "/storage/v1/object/opnames", self.headers({"Content-Type": "application/json"}), json.dumps({"prefixes": paden}).encode(), timeout=120)
        if st >= 300:
            raise Fout("Opruimen van de uploaddelen mislukt (%s)." % st, body[:300].decode("utf-8", "replace"), opnieuw=True)


# ---------------------------------------------------------------- Drive (via het Drive-script)
class Drive:
    def __init__(self, cfg, sb):
        self.url = cfg["drive_script_url"]
        self.sb = sb
        self.claim = None   # claim-token van de lopende opdracht

    def actief(self):
        return bool(self.url)

    def call(self, vid, soort, **kw):
        body = dict(kw, action="opname", soort=soort, vergadering_id=vid, claim=self.claim, token=self.sb.headers()["Authorization"][7:])
        st, raw, _ = http("POST", self.url, {"Content-Type": "application/json"}, json.dumps(body).encode(), timeout=300)
        j = json_of(raw)
        if st != 200 or j is None:
            raise Fout("Het Drive-script antwoordt niet zoals verwacht (%s)." % st, (raw or b"")[:300].decode("utf-8", "replace"), opnieuw=True)
        return j

    def upload(self, vid, pad, naam, mime, md5_lokaal, voortgang=None):
        """Bestand naar de map van de vergadering; geeft {id, md5, url} terug, MD5 gecontroleerd."""
        grootte = os.path.getsize(pad)
        j = self.call(vid, "start", naam=naam, grootte=grootte, mime=mime)
        if not j.get("ok"):
            if j.get("geen_map"):
                return {"geen_map": True, "melding": j.get("error", "")}
            raise Fout("Drive: " + j.get("error", "onbekende fout"), opnieuw=True)
        if j.get("bestaand"):
            b = j["bestaand"]
            if b.get("md5") == md5_lokaal:
                return {"id": b["id"], "md5": b["md5"], "url": b.get("url", ""), "map_url": j.get("map_url", "")}
            naam = naam.rsplit(".", 1)[0] + " (" + datetime.now().strftime("%H%M%S") + ")." + naam.rsplit(".", 1)[-1]
            j = self.call(vid, "start", naam=naam, grootte=grootte, mime=mime)
            if not j.get("ok") or not j.get("upload_url"):
                raise Fout("Drive: " + j.get("error", "geen uploadsessie"), opnieuw=True)
        sessie = j["upload_url"]
        blok = 8 * 1024 * 1024
        pos = 0
        resultaat = None
        with open(pad, "rb") as f:
            while pos < grootte:
                f.seek(pos)
                data = f.read(blok)
                eind = pos + len(data) - 1
                st, raw, hdr = http("PUT", sessie, {"Content-Range": "bytes %d-%d/%d" % (pos, eind, grootte), "Content-Length": str(len(data))}, data, timeout=600)
                if st in (200, 201):
                    resultaat = json_of(raw)
                    pos = grootte
                elif st == 308:
                    rng = hdr.get("Range") or hdr.get("range") or ""
                    pos = int(rng.split("-")[-1]) + 1 if rng else 0
                elif st in (500, 502, 503, 504):
                    time.sleep(5)
                    st2, _, hdr2 = http("PUT", sessie, {"Content-Range": "bytes */%d" % grootte, "Content-Length": "0"}, b"", timeout=60)
                    rng = hdr2.get("Range") or hdr2.get("range") or ""
                    pos = int(rng.split("-")[-1]) + 1 if (st2 == 308 and rng) else pos
                else:
                    raise Fout("Opladen naar Drive mislukt (%s)." % st, (raw or b"")[:300].decode("utf-8", "replace"), opnieuw=True)
                if voortgang:
                    voortgang(pos / grootte)
        if not resultaat or not resultaat.get("id"):
            raise Fout("Drive gaf geen bestand terug na het opladen.", opnieuw=True)
        info = self.call(vid, "info", file_id=resultaat["id"])
        if not info.get("ok"):
            raise Fout("Drive: " + info.get("error", "controle mislukt"), opnieuw=True)
        if info.get("md5") != md5_lokaal or int(info.get("size", -1)) != grootte:
            raise Fout("De kopie op Drive komt niet overeen met de opname (controlegetal). Ze wordt opnieuw opgeladen.", opnieuw=True)
        return {"id": info["id"], "md5": info["md5"], "url": info.get("url", ""), "map_url": info.get("map_url", "")}

    def download(self, vid, doel, grootte, voortgang=None):
        blok = 8 * 1024 * 1024
        with open(doel, "wb") as f:
            pos = 0
            while pos < grootte:
                j = self.call(vid, "lees", start=pos, lengte=min(blok, grootte - pos))
                if not j.get("ok"):
                    raise Fout("Drive: " + j.get("error", "lezen mislukt"), opnieuw=True)
                data = base64.b64decode(j["base64"])
                if not data:
                    raise Fout("Drive gaf een leeg stuk terug.", opnieuw=True)
                f.write(data)
                pos += len(data)
                if voortgang:
                    voortgang(pos / grootte)


# ---------------------------------------------------------------- hulpmiddelen
def md5_van(pad):
    h = hashlib.md5()
    with open(pad, "rb") as f:
        for blok in iter(lambda: f.read(1024 * 1024), b""):
            h.update(blok)
    return h.hexdigest()


def sha256_van(pad):
    h = hashlib.sha256()
    with open(pad, "rb") as f:
        for blok in iter(lambda: f.read(1024 * 1024), b""):
            h.update(blok)
    return h.hexdigest()


def vrij_gb(pad):
    os.makedirs(pad, exist_ok=True)
    return round(shutil.disk_usage(pad).free / 1e9, 1)


def mapgrootte(pad):
    tot = 0
    for root, _, files in os.walk(pad):
        for f in files:
            try:
                tot += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return tot


def piek_geheugen_kind_mb():
    r = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    return round(r / (1024 * 1024) if IS_MAC else r / 1024, 1)   # macOS: bytes, Linux: kB


def systeemgeheugen():
    info = {}
    try:
        if IS_MAC:
            tot = int(subprocess.run(["sysctl", "-n", "hw.memsize"], capture_output=True, text=True, timeout=5).stdout.strip())
            info["totaal_gb"] = round(tot / 1e9, 1)
            vm = subprocess.run(["vm_stat"], capture_output=True, text=True, timeout=5).stdout
            ps = int(re.search(r"page size of (\d+)", vm).group(1))
            def pg(n):
                m = re.search(n + r":\s+(\d+)", vm)
                return int(m.group(1)) if m else 0
            info["beschikbaar_gb"] = round((pg("Pages free") + pg("Pages inactive") + pg("Pages speculative")) * ps / 1e9, 1)
            mp = subprocess.run(["memory_pressure", "-Q"], capture_output=True, text=True, timeout=5).stdout
            m = re.search(r"free percentage:\s*(\d+)%", mp)
            if m:
                info["vrij_pct"] = int(m.group(1))
        else:
            with open("/proc/meminfo") as f:
                mi = dict((l.split(":")[0], int(l.split()[1])) for l in f if ":" in l)
            info["totaal_gb"] = round(mi["MemTotal"] / 1e6, 1)
            info["beschikbaar_gb"] = round(mi.get("MemAvailable", 0) / 1e6, 1)
    except Exception:
        pass
    return info


def mmss(sec):
    sec = int(max(0, sec or 0))
    return "%02d:%02d:%02d" % (sec // 3600, sec // 60 % 60, sec % 60) if sec >= 3600 else "%02d:%02d" % (sec // 60, sec % 60)


def normaliseer(t):
    t = (t or "").lower()
    t = re.sub(r"[^\w\s€%.,]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def sleutel(soort, tekst):
    return (soort + ":" + re.sub(r"[^a-z0-9à-ÿ ]", "", normaliseer(tekst)))[:200]


def woorden(t):
    return set(w for w in re.findall(r"[a-zà-ÿ0-9]+", (t or "").lower()) if len(w) > 2)


def lijkt_op(a, b):
    wa, wb = woorden(a), woorden(b)
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


# ---------------------------------------------------------------- audio
class Audio:
    def __init__(self, cfg, stop=None):
        self.cfg = cfg
        self.stop = stop or threading.Event()
        self.proces = None

    def run(self, args, timeout=None, meet=False):
        """meet=True: piekgeheugen van dit ene proces meten (macOS: /usr/bin/time -l) → self.laatste_rss_mb."""
        if self.stop.is_set():
            raise Gestopt()
        self.laatste_rss_mb = None
        if meet and IS_MAC and os.path.exists("/usr/bin/time"):
            args = ["/usr/bin/time", "-l"] + list(args)
        self.proces = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")
        try:
            out, err = self.proces.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            self.proces.kill()
            raise Fout("Een verwerkingsstap duurde te lang en werd gestopt.", " ".join(args[:3]), opnieuw=True)
        finally:
            rc = self.proces.returncode
            self.proces = None
        if self.stop.is_set():
            raise Gestopt()
        m = re.search(r"(\d+)\s+maximum resident set size", err or "")
        if m:
            self.laatste_rss_mb = round(int(m.group(1)) / (1024 * 1024), 1)
        elif meet:
            self.laatste_rss_mb = piek_geheugen_kind_mb()   # (Linux/tests: hoogste waarde van alle hulpprocessen tot nu)
        return rc, out, err

    def kill(self):
        p = self.proces
        if p and p.poll() is None:
            try:
                p.terminate()
                time.sleep(2)
                if p.poll() is None:
                    p.kill()
            except Exception:
                pass

    def probe(self, pad):
        rc, out, err = self.run([self.cfg["ffprobe"], "-v", "error", "-print_format", "json", "-show_format", "-show_streams", pad], timeout=120)
        j = json_of(out.encode()) if rc == 0 else None
        if not j or not any(s.get("codec_type") == "audio" for s in j.get("streams", [])):
            raise Fout("Dit bestand bevat geen geluid dat we kunnen lezen. Is het wel een audio- of video-opname?", (err or "")[-500:], opnieuw=False)
        a = next(s for s in j["streams"] if s.get("codec_type") == "audio")
        duur = float(j.get("format", {}).get("duration") or a.get("duration") or 0)
        if duur <= 1:
            raise Fout("De opname is leeg of te kort.", opnieuw=False)
        return {"duur_sec": round(duur, 2), "formaat": "%s %s Hz %s kanaal" % (a.get("codec_name"), a.get("sample_rate"), a.get("channels"))}

    def naar_wav(self, bron, doel):
        rc, _, err = self.run([self.cfg["ffmpeg"], "-nostdin", "-y", "-v", "error", "-i", bron, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", doel])
        if rc != 0:
            raise Fout("De opname kon niet omgezet worden (ffmpeg).", (err or "")[-800:], opnieuw=False)

    def afspeelkopie(self, bron, doel, kbps=32):
        rc, _, err = self.run([self.cfg["ffmpeg"], "-nostdin", "-y", "-v", "error", "-i", bron, "-vn", "-ac", "1", "-c:a", "aac", "-b:a", "%dk" % kbps, "-movflags", "+faststart", doel])
        if rc != 0:
            raise Fout("De afspeelkopie kon niet gemaakt worden (ffmpeg).", (err or "")[-800:], opnieuw=True)

    def stiltes(self, wav):
        rc, _, err = self.run([self.cfg["ffmpeg"], "-nostdin", "-v", "info", "-i", wav, "-af", "silencedetect=noise=-35dB:d=0.6", "-f", "null", "-"])
        st = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", err or "")]
        en = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", err or "")]
        return [((a + b) / 2) for a, b in zip(st, en)]

    @staticmethod
    def kniptijden(duur, stiltes, deel_s):
        """Knippunten rond elke deel_s seconden, liefst midden in een stilte (60 s ervoor tot 30 s erna), zodat geen woord doormidden gaat."""
        punten, t = [], 0.0
        while duur - t > deel_s * 1.25:
            doel = t + deel_s
            kandidaten = [s for s in stiltes if doel - 60 <= s <= doel + 30 and s > t + 30]
            knip = min(kandidaten, key=lambda s: abs(s - doel)) if kandidaten else doel
            punten.append(round(knip, 2))
            t = knip
        grenzen = [0.0] + punten + [round(duur, 2)]
        return [(grenzen[i], grenzen[i + 1]) for i in range(len(grenzen) - 1)]

    def knip(self, wav, start, eind, doel):
        rc, _, err = self.run([self.cfg["ffmpeg"], "-nostdin", "-y", "-v", "error", "-i", wav, "-ss", "%.2f" % start, "-to", "%.2f" % eind, "-c", "copy", doel])
        if rc != 0:
            raise Fout("Knippen van de opname mislukt.", (err or "")[-500:], opnieuw=True)


# ---------------------------------------------------------------- transcriptie (whisper.cpp)
HALLUCINATIES = ["ondertitel", "amara.org", "bedankt voor het kijken", "bedankt voor het luisteren", "abonneer", "www.", "tv gelderland",
                 "dank je wel voor het kijken", "dank u wel voor het kijken", "copyright", "muziek speelt", "[muziek]", "(muziek)"]


def whisper_args(cfg, model, wav, uitbasis, prompt):
    a = [cfg["whisper_cli"], "-m", model, "-f", wav, "-l", cfg.get("taal") or "nl", "-t", str(cfg.get("whisper_threads") or 4), "-ojf", "-of", uitbasis, "-np"]
    if cfg.get("vad_model") and os.path.exists(cfg["vad_model"]):
        a += ["--vad", "-vm", cfg["vad_model"]]
    if prompt:
        a += ["--prompt", prompt[:700]]
    a += list(cfg.get("whisper_extra") or [])
    return a


def lees_whisper_json(pad, offset, start_i):
    with open(pad, "r", encoding="utf-8", errors="replace") as f:
        d = json.load(f)
    seg = []
    for x in d.get("transcription", []):
        tekst = (x.get("text") or "").strip()
        if not tekst:
            continue
        toks = [t for t in x.get("tokens", []) if not str(t.get("text", "")).startswith(("[_", "<|"))]
        p = round(sum(float(t.get("p", 0)) for t in toks) / len(toks), 3) if toks else None
        s = round(offset + x["offsets"]["from"] / 1000.0, 2)
        e = round(offset + x["offsets"]["to"] / 1000.0, 2)
        seg.append({"i": start_i + len(seg), "s": s, "e": e, "t": tekst, "p": p})
    return seg


def markeer_onduidelijk(segmenten, drempel):
    vorige = []
    for s in segmenten:
        redenen = []
        tl = s["t"].lower()
        if any(h in tl for h in HALLUCINATIES):
            redenen.append("mogelijk verzonnen door het spraakmodel (typische ondertitelzin)")
        if s.get("p") is not None and s["p"] < drempel:
            redenen.append("lage zekerheid van het spraakmodel")
        n = normaliseer(s["t"])
        if len(n) > 3 and vorige.count(n) >= 2:
            redenen.append("herhaalde zin (mogelijk een fout van het spraakmodel)")
        duur = max(0.1, s["e"] - s["s"])
        if len(s["t"]) / duur > 30:
            redenen.append("onwaarschijnlijk veel tekst voor de duur")
        if redenen:
            s["onduidelijk"] = True
            s["reden"] = "; ".join(redenen)
        vorige = (vorige + [n])[-3:]
    return segmenten


# ---------------------------------------------------------------- kritieke gegevens (zonder AI, vaste regels)
_GETAL = r"\d+(?:[.,]\d+)*"
PATRONEN = [
    ("bedrag", re.compile(r"(?:€\s?" + _GETAL + r"(?:\s?(?:euro|eur))?|" + _GETAL + r"\s?(?:euro|eur|€)\b|" + _GETAL + r"\s?(?:duizend|honderd)\s?(?:euro|eur))", re.I)),
    ("maat", re.compile(r"\b" + _GETAL + r"\s?(?:mm|cm|dm|m|meter|centimeter|millimeter|m²|m2|m³|m3|vierkante meter|kubieke meter|lopende meter|lm)\b", re.I)),
    ("hoeveelheid", re.compile(r"\b" + _GETAL + r"\s?(?:stuks?|st|dozen|platen|pakken|rollen|uur|uren|dagen|weken)\b", re.I)),
    ("percentage", re.compile(r"\b" + _GETAL + r"\s?(?:%|procent)", re.I)),
    ("datum", re.compile(r"\b(?:\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{1,2}\s(?:januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december|jan|feb|mrt|apr|jun|jul|aug|sep|sept|okt|nov|dec)\b|(?:tegen|voor|vóór|tot|op)\s(?:maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)|week\s\d{1,2})", re.I)),
    ("materiaal", re.compile(r"\b(?:RAL\s?\d{4}|NCS\s?S?\s?\d{4}-?[A-Z]\d{0,2}[A-Z]?|[A-Z]{2,5}[- ]?\d{2,6}[A-Z]?)\b")),
]


def vind_gegevens(segmenten):
    uit = []
    for s in segmenten:
        for soort, pat in PATRONEN:
            for m in pat.finditer(s["t"]):
                waarde = m.group(0).strip()
                if soort == "materiaal" and waarde.isdigit():
                    continue
                uit.append({"soort": soort, "waarde": waarde, "seg": s["i"], "s": s["s"], "e": s["e"], "citaat": s["t"]})
    return uit


def getallen(t):
    out = set()
    for g in re.findall(r"\d+(?:[.,\s]\d{3})*(?:[.,]\d+)?", t or ""):
        out.add(re.sub(r"[.,\s]", "", g))
    return out


VOORWAARDE = re.compile(r"\b(als|indien|mits|op voorwaarde|tenzij|behalve|zolang|enkel als|alleen als|pas als|op conditie|onder voorbehoud)\b", re.I)
ONTKENNING = re.compile(r"\b(niet|geen|nooit|nee|niets|nergens|allerminst)\b", re.I)


# ---------------------------------------------------------------- conceptverslag (cloud-API)
SYSTEEM = """Je maakt een CONCEPTVERSLAG van een vergadering van BROS (interieurarchitectuur en design-build, Antwerpen) op basis van een automatisch transcript. Het transcript kan fouten bevatten: verkeerd verstane woorden, namen en getallen. Een medewerker van BROS controleert je concept; jij beslist niets.

Strikte regels:
1. Gebruik uitsluitend wat in het transcript staat. Verzin niets: geen namen, bedragen, maten, materiaalcodes, datums, deadlines, verantwoordelijken of goedkeuringen die niet letterlijk gezegd zijn.
2. Maak onderscheid tussen
   - "besloten": iemand bevestigt expliciet ("we doen dat", "akkoord", "zo afgesproken"),
   - "voorgesteld": een voorstel zonder duidelijke bevestiging,
   - "besproken": besproken zonder voorstel of besluit.
   Twijfel je, kies dan het voorzichtigste ("besproken" of "voorgesteld").
3. Behoud voorwaarden en ontkenningen letterlijk. "Akkoord als de prijs onder 1.500 euro blijft" is een beslissing met als voorwaarde "als de prijs onder 1.500 euro blijft" — nooit gewoon "akkoord". "Niet in eik" mag nooit "in eik" worden.
4. Elk punt verwijst naar de segmenten waar het gezegd werd (de S-nummers) en bevat een kort, LETTERLIJK citaat uit die segmenten.
5. Verantwoordelijke en deadline enkel als ze letterlijk genoemd worden; anders laat je ze leeg (""). Reken geen datums uit: "volgende week" blijft "volgende week".
6. Neem getallen, maten, bedragen, codes en namen over zoals in het transcript. Klinkt iets onlogisch of onverstaanbaar, zet het bij "onduidelijk" in plaats van het te verbeteren.
7. Mogelijk meerwerk: enkel als iets besproken wordt dat buiten de oorspronkelijke opdracht lijkt te vallen of extra kost. Je doet geen uitspraak over prijzen of goedkeuring.
8. Schrijf in het Nederlands, zakelijk en kort.
Antwoord uitsluitend met één JSON-object volgens het schema, zonder tekst ervoor of erna."""

SCHEMA = """{
  "samenvatting": "3 tot 6 zinnen: waarover ging de vergadering en wat is het belangrijkste resultaat",
  "onderwerpen": [{"titel": "kort", "tekst": "wat er besproken werd (2 tot 5 zinnen)", "segmenten": [3, 4]}],
  "beslissingen": [{"tekst": "wat", "aard": "besloten | voorgesteld | besproken", "voorwaarden": "letterlijke voorwaarde of \\"\\"", "segmenten": [12], "citaat": "letterlijk uit het transcript"}],
  "open_vragen": [{"tekst": "de vraag die nog open staat", "segmenten": [20], "citaat": "..."}],
  "actiepunten": [{"tekst": "wat moet er gebeuren", "aard": "afgesproken | voorgesteld", "verantwoordelijke": "naam zoals gezegd of \\"\\"", "deadline": "zoals gezegd of \\"\\"", "segmenten": [31], "citaat": "..."}],
  "meerwerk": [{"tekst": "wat mogelijk extra is", "segmenten": [40], "citaat": "..."}],
  "kritieke_gegevens": [{"soort": "bedrag | maat | hoeveelheid | naam | materiaal | datum | andere", "waarde": "zoals gezegd", "context": "waarover het gaat", "segmenten": [12], "citaat": "..."}],
  "onduidelijk": [{"segmenten": [7], "reden": "waarom dit onduidelijk is"}]
}"""

CONTROLE_SYSTEEM = """Je controleert een conceptverslag tegen het transcript van een vergadering. Zoek fouten: punten die niet in het transcript staan, verkeerd overgenomen getallen of namen, weggelaten voorwaarden of ontkenningen, "besloten" waar enkel iets voorgesteld of besproken werd, en belangrijke beslissingen of actiepunten die ontbreken. Antwoord uitsluitend met JSON: {"problemen": [{"lijst": "beslissingen|open_vragen|actiepunten|meerwerk|kritieke_gegevens", "index": 0, "probleem": "kort"}], "ontbrekend": [{"soort": "beslissing|actie|vraag", "tekst": "...", "segmenten": [1]}]}. Geen problemen gevonden is GEEN bewijs dat alles juist is; zeg enkel wat je vindt."""


def transcript_tekst(segmenten):
    regels = []
    for s in segmenten:
        regels.append("[S%d %s]%s %s" % (s["i"], mmss(s["s"]), " (onduidelijk)" if s.get("onduidelijk") else "", s["t"]))
    return "\n".join(regels)


def lees_json_antwoord(tekst):
    t = (tekst or "").strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    a, b = t.find("{"), t.rfind("}")
    if a < 0 or b < a:
        raise ValueError("geen JSON")
    return json.loads(t[a:b + 1])


class Taalmodel:
    def __init__(self, cfg):
        self.cfg = cfg["llm"]
        self.sleutel = geheim("anthropic-api-key", "ANTHROPIC_API_KEY")
        self.tokens_in = 0
        self.tokens_uit = 0

    def actief(self):
        return bool(self.sleutel) and self.cfg.get("provider") == "anthropic"

    def vraag(self, systeem, inhoud, max_tokens=None):
        body = {"model": self.cfg["model"], "max_tokens": int(max_tokens or self.cfg.get("max_tokens") or 16000),
                "system": systeem, "messages": [{"role": "user", "content": inhoud}]}
        # 1.56.2: geen temperature meer standaard — nieuwere modellen weigeren die parameter (400 "deprecated"); enkel als ze in config.json staat
        if self.cfg.get("temperature") is not None:
            body["temperature"] = self.cfg["temperature"]
        laatste = None
        for poging in range(4):
            st, raw, hdr = http("POST", self.cfg.get("url") or STANDAARD["llm"]["url"],
                                {"x-api-key": self.sleutel, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                                json.dumps(body).encode(), timeout=600)
            if st == 200:
                j = json_of(raw) or {}
                u = j.get("usage") or {}
                self.tokens_in += int(u.get("input_tokens", 0))
                self.tokens_uit += int(u.get("output_tokens", 0))
                return "".join(c.get("text", "") for c in j.get("content", []) if c.get("type") == "text"), j.get("stop_reason")
            laatste = (st, (raw or b"")[:300].decode("utf-8", "replace"))
            # een parameter die het model niet (meer) kent: één keer opnieuw zonder die parameter
            if st == 400 and poging == 0:
                fout = str(((json_of(raw) or {}).get("error") or {}).get("message", ""))
                weg = [k for k in ("temperature", "top_p", "top_k") if k in body and k in fout]
                if weg:
                    for k in weg:
                        body.pop(k, None)
                    log("taalmodel weigerde %s — opnieuw zonder" % ", ".join(weg))
                    continue
            if st in (429, 500, 502, 503, 529):
                time.sleep(min(60, 5 * (2 ** poging)))
                continue
            break
        raise Fout("De samenvattingsdienst gaf een fout (%s)." % (laatste[0] if laatste else "?"), laatste[1] if laatste else "", opnieuw=True)

    def kost(self):
        return round(self.tokens_in / 1e6 * float(self.cfg.get("prijs_input_per_mtok", 0)) + self.tokens_uit / 1e6 * float(self.cfg.get("prijs_output_per_mtok", 0)), 4)

    def verslag(self, context, segmenten):
        tekst = transcript_tekst(segmenten)
        inhoud = context + "\n\nSCHEMA (antwoord exact in deze vorm):\n" + SCHEMA + "\n\nTRANSCRIPT (elke regel: [S-nummer tijd] tekst):\n" + tekst
        antwoord, stop = self.vraag(SYSTEEM, inhoud)
        try:
            return lees_json_antwoord(antwoord)
        except Exception as e:
            herstel = inhoud + "\n\nJe vorige antwoord was geen geldige JSON (" + str(e)[:100] + "). Geef enkel het JSON-object."
            antwoord, stop = self.vraag(SYSTEEM, herstel)
            return lees_json_antwoord(antwoord)

    def controle(self, verslag, segmenten):
        inhoud = "CONCEPTVERSLAG:\n" + json.dumps(verslag, ensure_ascii=False) + "\n\nTRANSCRIPT:\n" + transcript_tekst(segmenten)
        antwoord, _ = self.vraag(CONTROLE_SYSTEEM, inhoud, max_tokens=4000)
        return lees_json_antwoord(antwoord)


# ---------------------------------------------------------------- van AI-uitvoer naar punten (+ automatische controles)
def bronbereik(segnrs, idx):
    s = [idx[i] for i in segnrs if i in idx]
    if not s:
        return None, None, "", []
    return min(x["s"] for x in s), max(x["e"] for x in s), " ".join(x["t"] for x in s), s


def citaat_gevonden(citaat, brontekst):
    c, b = normaliseer(citaat), normaliseer(brontekst)
    if not c:
        return False
    if c in b:
        return True
    if len(c) > len(b) + 10:
        return False
    sm = difflib.SequenceMatcher(None, c, b)
    m = sm.find_longest_match(0, len(c), 0, len(b))
    if m.size >= 0.85 * len(c):
        return True
    beste = 0.0
    for st in range(0, max(1, len(b) - len(c) + 1), max(1, len(c) // 4)):
        beste = max(beste, difflib.SequenceMatcher(None, c, b[st:st + len(c)]).ratio())
    return beste >= 0.85


def koppel_persoon(naam, team):
    n = normaliseer(naam)
    if not n:
        return None
    exact = [t for t in team if normaliseer(t["naam"]) == n]
    if len(exact) == 1:
        return exact[0]["id"]
    voornaam = [t for t in team if normaliseer(t["naam"]).split(" ")[0] == n.split(" ")[0]]
    return voornaam[0]["id"] if len(voornaam) == 1 and len(n.split(" ")) == 1 else None


def maak_punten(v, segmenten, team, bestaande, deelnemers):
    """v = AI-uitvoer (of None). Geeft (punten, controles, verslag_concept)."""
    idx = {s["i"]: s for s in segmenten}
    punten, controles = [], {"automatisch": [], "ai_controle": None}
    namen_ok = set(normaliseer(d.get("naam", "")) for d in deelnemers) | set(normaliseer(t["naam"]) for t in team)

    def nieuw(soort, item, tekst, extra):
        segs = [int(x) for x in (item.get("segmenten") or []) if str(x).lstrip("-").isdigit()]
        s, e, brontekst, bronseg = bronbereik(segs, idx)
        w = []
        if not bronseg:
            w.append("Geen geldige bron in het transcript — controleer of dit gezegd werd")
        citaat = (item.get("citaat") or "").strip()
        if bronseg and citaat and not citaat_gevonden(citaat, brontekst):
            w.append("Citaat niet letterlijk teruggevonden in de bron")
        if bronseg and not citaat:
            w.append("Geen citaat opgegeven")
        alles = " ".join([tekst, item.get("voorwaarden") or "", item.get("waarde") or "", item.get("deadline") or ""])
        for g in getallen(alles) - getallen(brontekst):
            w.append("Getal %s staat niet in de bron" % g)
        if bronseg and VOORWAARDE.search(brontekst) and soort == "beslissing" and extra.get("aard") == "besloten" and not (item.get("voorwaarden") or "").strip():
            w.append("De bron bevat een voorwaarde (“%s”) die niet in de beslissing staat" % VOORWAARDE.search(brontekst).group(0))
        if bronseg and ONTKENNING.search(brontekst) and not ONTKENNING.search(tekst + " " + (item.get("voorwaarden") or "")):
            w.append("De bron bevat een ontkenning (“%s”) — klopt de betekenis?" % ONTKENNING.search(brontekst).group(0))
        if any(x.get("onduidelijk") for x in bronseg):
            w.append("De bron bevat een onduidelijke passage")
        p = {"soort": soort, "tekst": tekst.strip()[:2000], "citaat": citaat[:2000], "segmenten": segs, "bron_start": s, "bron_eind": e,
             "waarschuwingen": w, "sleutel": sleutel(soort, tekst)}
        p.update(extra)
        p["kritiek"] = bool(p.get("kritiek") or soort in ("beslissing", "gegeven", "meerwerk") or getallen(alles) or w)
        punten.append(p)
        return p

    if v:
        for b in v.get("beslissingen") or []:
            aard = b.get("aard") if b.get("aard") in ("besloten", "voorgesteld", "besproken") else "besproken"
            nieuw("beslissing", b, b.get("tekst") or "", {"aard": aard, "voorwaarden": (b.get("voorwaarden") or "").strip()[:2000]})
        for q in v.get("open_vragen") or []:
            nieuw("vraag", q, q.get("tekst") or "", {})
        for a in v.get("actiepunten") or []:
            vt = (a.get("verantwoordelijke") or "").strip()
            p = nieuw("actie", a, a.get("tekst") or "", {"aard": "besloten" if a.get("aard") == "afgesproken" else "voorgesteld",
                                                       "verantwoordelijke_tekst": vt[:200], "deadline_tekst": (a.get("deadline") or "").strip()[:200]})
            if vt:
                _, _, brontekst, _ = bronbereik(p["segmenten"], idx)
                if normaliseer(vt) not in normaliseer(brontekst) and normaliseer(vt).split(" ")[0] not in normaliseer(brontekst):
                    p["waarschuwingen"].append("Naam van de verantwoordelijke niet teruggevonden in de bron")
                pid = koppel_persoon(vt, team)
                if pid:
                    p["verantwoordelijke"] = pid
                elif normaliseer(vt) not in namen_ok:
                    p["waarschuwingen"].append("“%s” is geen gekend teamlid — verantwoordelijke nog te bepalen" % vt)
        for m in v.get("meerwerk") or []:
            nieuw("meerwerk", m, m.get("tekst") or "", {})
        for g in v.get("kritieke_gegevens") or []:
            soort = g.get("soort") or "andere"
            nieuw("gegeven", g, ((g.get("waarde") or "") + (" — " + g["context"] if g.get("context") else "")), {"gegeven_soort": soort[:40], "kritiek": True})
        for o in v.get("onduidelijk") or []:
            for i in o.get("segmenten") or []:
                if isinstance(i, int) and i in idx:
                    idx[i]["onduidelijk"] = True
                    idx[i]["reden"] = ((idx[i].get("reden") + "; ") if idx[i].get("reden") else "") + "AI: " + (o.get("reden") or "onduidelijk")[:200]
    # vaste regels: elk bedrag, elke maat, datum, hoeveelheid en code in het transcript komt op de controlelijst (ook zonder AI)
    gedekt = set()
    for p in punten:
        if p["soort"] == "gegeven":
            for i in p["segmenten"]:
                for g in getallen(p["tekst"]):
                    gedekt.add((i, g))
    for g in vind_gegevens(segmenten):
        gs = getallen(g["waarde"])
        if gs and all((g["seg"], x) in gedekt for x in gs):
            continue
        w = ["Automatisch gevonden in het transcript (geen AI) — controleer of dit juist verstaan is"]
        if idx[g["seg"]].get("onduidelijk"):
            w.append("De bron bevat een onduidelijke passage")
        punten.append({"soort": "gegeven", "tekst": g["waarde"], "citaat": g["citaat"][:2000], "segmenten": [g["seg"]], "bron_start": g["s"], "bron_eind": g["e"],
                       "gegeven_soort": g["soort"], "kritiek": True, "waarschuwingen": w, "sleutel": sleutel("gegeven", g["waarde"] + " " + str(int(g["s"] // 30)))})
        for x in gs:
            gedekt.add((g["seg"], x))
    # bij opnieuw verwerken: wat al bestaat, vervangen in plaats van dubbel voorstellen
    for p in punten:
        for b in bestaande:
            if b["soort"] != p["soort"]:
                continue
            dicht = p.get("bron_start") is None or b.get("bron_start") is None or abs(float(b["bron_start"]) - float(p["bron_start"])) <= 90
            if b.get("sleutel") == p["sleutel"] or (dicht and lijkt_op(b["tekst"], p["tekst"]) >= 0.6):
                p["vervangt"] = b["id"]
                break
        controles["automatisch"].append({"soort": p["soort"], "tekst": p["tekst"][:120], "waarschuwingen": p["waarschuwingen"]})
    concept = None
    if v:
        onderw = []
        for o in v.get("onderwerpen") or []:
            segs = [int(x) for x in (o.get("segmenten") or []) if str(x).isdigit()]
            s, _, _, _ = bronbereik(segs, idx)
            onderw.append({"titel": (o.get("titel") or "")[:200], "tekst": (o.get("tekst") or "")[:4000], "segmenten": segs, "bron_start": s})
        concept = {"samenvatting": (v.get("samenvatting") or "")[:6000], "onderwerpen": onderw, "bron": "ai", "aangemaakt": datetime.now(timezone.utc).isoformat()}
    return punten, controles, concept


# ---------------------------------------------------------------- de verwerking van één opname
class Verwerking:
    def __init__(self, cfg, sb, drive, taal, job, stop):
        self.cfg, self.sb, self.drive, self.taal, self.opdracht, self.stop = cfg, sb, drive, taal, job, stop
        self.job_id = job["job"]["id"]
        self.claim = job["job"].get("claim")
        drive.claim = self.claim
        self.v = job["vergadering"]
        self.audio = Audio(cfg, stop)
        self.stap, self.voortgang = "gestart", 0.0
        self.metingen = {"stappen": {}, "versie": VERSIE, "computer": platform.node(), "systeem": platform.platform()}
        self.waarschuwingen = []
        self.map = os.path.join(cfg["werkmap"], self.v["id"])
        os.makedirs(self.map, exist_ok=True)
        self.staatpad = os.path.join(self.map, "staat.json")
        self.staat = self._laad_staat()

    # -- tussentijdse staat (hervatten na onderbreking)
    def _laad_staat(self):
        verwacht = {"opname": (self.v.get("opname") or {}).get("geupload_op"), "naam": (self.v.get("opname") or {}).get("naam")}
        try:
            with open(self.staatpad) as f:
                s = json.load(f)
            if s.get("sleutel") == verwacht:
                return s
        except Exception:
            pass
        shutil.rmtree(self.map, ignore_errors=True)
        os.makedirs(self.map, exist_ok=True)
        return {"sleutel": verwacht}

    def bewaar(self):
        with open(self.staatpad + ".tmp", "w") as f:
            json.dump(self.staat, f)
        os.replace(self.staatpad + ".tmp", self.staatpad)

    def zet(self, stap, voortgang):
        self.stap, self.voortgang = stap, max(0.0, min(1.0, voortgang))
        if self.stop.is_set():
            raise Gestopt()

    def meet(self, naam, t0):
        self.metingen["stappen"][naam] = round(time.time() - t0, 1)

    # -- 1. het origineel
    def origineel(self):
        op = self.v.get("opname") or {}
        ext = os.path.splitext(op.get("naam") or "")[1][:8] or ".bin"
        pad = os.path.join(self.map, "origineel" + ext)
        if self.staat.get("origineel_ok") and os.path.exists(pad):
            return pad
        t0 = time.time()
        vrij = vrij_gb(self.cfg["werkmap"])
        nodig = (op.get("grootte") or 0) * 3 / 1e9 + (op.get("duur_sec") or 7200) * 32000 * 2 / 1e9 + float(self.cfg["min_vrij_gb"])
        if vrij < nodig:
            raise Fout("Te weinig vrije schijfruimte op de verwerkingscomputer (%.1f GB vrij, %.1f GB nodig)." % (vrij, nodig), opnieuw=True)
        delen = op.get("delen") or []
        if not self.v.get("inbox_leeg") and delen:
            with open(pad, "wb") as uit:
                for n, d in enumerate(delen):
                    self.zet("opname ophalen %d/%d" % (n + 1, len(delen)), 0.02 * n / len(delen))
                    tmp = pad + ".deel"
                    info = self.sb.download(d["pad"], tmp)
                    if info["sha256"] != d["sha256"] or info["bytes"] != int(d["grootte"]):
                        os.remove(tmp)
                        raise Fout("Uploaddeel %d is beschadigd (controlegetal klopt niet). Laad de opname opnieuw op." % (n + 1), d["pad"], opnieuw=False)
                    with open(tmp, "rb") as f:
                        shutil.copyfileobj(f, uit, 1024 * 1024)
                    os.remove(tmp)
        elif self.v.get("drive_file_id") and self.drive.actief():
            self.zet("opname ophalen van Drive", 0.0)
            self.drive.download(self.v["id"], pad, int(op.get("grootte") or 0), lambda x: self.zet("opname ophalen van Drive", 0.02 * x))
            if self.v.get("drive_md5") and md5_van(pad) != self.v["drive_md5"]:
                raise Fout("Het origineel op Drive komt niet overeen met het controlegetal.", opnieuw=True)
        else:
            raise Fout("De opname is niet meer beschikbaar (geen uploaddelen en geen kopie op Drive).", opnieuw=False)
        if os.path.getsize(pad) != int(op.get("grootte") or -1):
            raise Fout("De opgehaalde opname is niet volledig.", opnieuw=True)
        self.staat["origineel_ok"] = True
        self.staat["md5"] = md5_van(pad)
        self.bewaar()
        self.meet("ophalen", t0)
        return pad

    # -- 2..3 omzetten, afspeelkopie, transcriptie
    def transcriptie(self, orig):
        t0 = time.time()
        self.zet("opname lezen", 0.03)
        info = self.audio.probe(orig)
        self.metingen["duur_opname_s"] = info["duur_sec"]
        self.metingen["formaat"] = info["formaat"]
        if not self.staat.get("duur_gemeld"):
            self.sb.rpc("verwerking_bestand", {"p_job": self.job_id, "p_claim": self.claim, "p_gegevens": {"duur_sec": info["duur_sec"], "formaat": info["formaat"]}})
            self.staat["duur_gemeld"] = True
            self.bewaar()
        wav = os.path.join(self.map, "audio.wav")
        if not self.staat.get("wav_ok") or not os.path.exists(wav):
            self.zet("omzetten naar WAV", 0.05)
            self.audio.naar_wav(orig, wav)
            self.staat["wav_ok"] = True
            self.bewaar()
        afspeel = os.path.join(self.map, "afspeel.m4a")
        if not self.staat.get("afspeel_ok") or not os.path.exists(afspeel):
            self.zet("afspeelkopie maken", 0.07)
            self.audio.afspeelkopie(orig, afspeel, 32)
            if os.path.getsize(afspeel) > 48 * 1024 * 1024:
                self.audio.afspeelkopie(orig, afspeel, 16)
            self.staat["afspeel_ok"] = True
            self.bewaar()
        self.meet("omzetten", t0)
        t1 = time.time()
        if "delen" not in self.staat:
            self.zet("delen bepalen (stiltes)", 0.08)
            stil = self.audio.stiltes(wav)
            self.staat["delen"] = Audio.kniptijden(info["duur_sec"], stil, float(self.cfg["deel_minuten"]) * 60)
            self.bewaar()
        delen = self.staat["delen"]
        self.metingen["delen"] = len(delen)
        segmenten, staart = [], ""
        namen = ", ".join(d.get("naam", "") for d in self.v.get("deelnemers") or [] if d.get("naam"))
        p = self.opdracht.get("project") or {}
        # 1.56.2: de namen van het team en de vaktermen van BROS sturen het spraakmodel (bv. "werf" i.p.v. "wirf", "Noa" i.p.v. "Noah")
        teamnamen = ", ".join(sorted({str(t.get("naam", "")).strip() for t in (self.opdracht.get("team") or []) if str(t.get("naam", "")).strip()}))
        vaktermen = ", ".join(str(w).strip() for w in (self.cfg.get("woordenlijst") or WOORDENLIJST) if str(w).strip())
        basisprompt = ("Vergadering van BROS interieurarchitecten" + (", project " + p.get("klant", "") if p.get("klant") else "") + (". Deelnemers: " + namen if namen else "")
                       + (". Team: " + teamnamen if teamnamen else "") + (". Vaktermen: " + vaktermen if vaktermen else "") + ".")[:450]
        for n, (s, e) in enumerate(delen):
            uitbasis = os.path.join(self.map, "deel%03d" % n)
            if not os.path.exists(uitbasis + ".json"):
                self.zet("transcriberen deel %d/%d" % (n + 1, len(delen)), 0.1 + 0.6 * n / len(delen))
                dwav = os.path.join(self.map, "deel%03d.wav" % n)
                self.audio.knip(wav, s, e, dwav)
                tdeel = time.time()
                rc, out, err = self.audio.run(whisper_args(self.cfg, self.cfg["whisper_model"], dwav, uitbasis, basisprompt + (" " + staart if staart else "")),
                                              timeout=max(600, (e - s) * float(self.cfg.get("max_x_duur", 4)) + 300), meet=True)   # vastgelopen spraakmodel: stoppen i.p.v. de wachtrij te blokkeren
                if rc != 0 or not os.path.exists(uitbasis + ".json"):
                    raise Fout("Het spraakmodel (whisper.cpp) stopte met een fout bij deel %d." % (n + 1), (err or "")[-1500:], opnieuw=True)
                self.metingen.setdefault("delen_s", []).append(round(time.time() - tdeel, 1))
                self.staat.setdefault("rss", []).append(self.audio.laatste_rss_mb)
                self.bewaar()
                os.remove(dwav)
            seg = lees_whisper_json(uitbasis + ".json", s, len(segmenten))
            segmenten += seg
            staart = " ".join(x["t"] for x in seg[-3:])[-200:]
        piek = max([x for x in self.staat.get("rss", []) if x] or [0])
        self.metingen["piek_geheugen_spraakmodel_mb"] = piek
        self.metingen["geheugen_na_transcriptie"] = systeemgeheugen()
        self.metingen["schijf_werkmap_mb"] = round(mapgrootte(self.map) / 1e6, 1)
        markeer_onduidelijk(segmenten, float(self.cfg["laag_vertrouwen"]))
        self.meet("transcriberen", t1)
        if info["duur_sec"]:
            self.metingen["snelheid_x_realtime"] = round(info["duur_sec"] / max(1, self.metingen["stappen"]["transcriberen"]), 2)
        return segmenten, afspeel

    # -- 4. Drive + afspeelkopie
    def bewaar_bestanden(self, orig, afspeel, segmenten):
        t0 = time.time()
        op = self.v.get("opname") or {}
        if not self.staat.get("drive_ok") and not self.v.get("drive_md5"):
            if not self.drive.actief():
                self.waarschuwingen.append("Geen Drive-script ingesteld op de verwerkingscomputer: het origineel blijft in de opslag van het Planbord.")
            else:
                self.zet("origineel naar de projectmap (Drive)", 0.72)
                r = self.drive.upload(self.v["id"], orig, op.get("naam") or ("opname" + os.path.splitext(orig)[1]), op.get("mime") or "application/octet-stream",
                                      self.staat["md5"], lambda x: self.zet("origineel naar de projectmap (Drive)", 0.72 + 0.06 * x))
                if r.get("geen_map"):
                    self.waarschuwingen.append("Dit project heeft nog geen projectmap op Drive: het origineel blijft in de opslag van het Planbord. Koppel de map en verwerk opnieuw om het te verplaatsen.")
                else:
                    self.sb.rpc("verwerking_bestand", {"p_job": self.job_id, "p_claim": self.claim, "p_gegevens": {"drive_file_id": r["id"], "drive_url": r.get("url", ""), "drive_map_url": r.get("map_url", ""), "drive_md5": r["md5"]}})
                    self.staat["drive_ok"] = True
                    self.v["drive_md5"] = r["md5"]
                    self.bewaar()
        elif self.v.get("drive_md5"):
            self.staat["drive_ok"] = True
        if not self.staat.get("afspeel_op"):
            self.zet("afspeelkopie opladen", 0.79)
            pad = "%s/afspeel/%s.m4a" % (self.v["id"], self.job_id)
            self.sb.upload(pad, afspeel, "audio/mp4")
            self.sb.rpc("verwerking_bestand", {"p_job": self.job_id, "p_claim": self.claim, "p_gegevens": {"afspeel_pad": pad, "afspeel_grootte": os.path.getsize(afspeel)}})
            oud = self.v.get("afspeel_pad")
            if oud and oud != pad:
                try:
                    self.sb.verwijder([oud])
                except Fout:
                    pass
            self.staat["afspeel_op"] = pad
            self.bewaar()
        if self.staat.get("drive_ok") and self.drive.actief() and not self.staat.get("transcript_drive"):
            try:
                tpad = os.path.join(self.map, "transcript.txt")
                with open(tpad, "w", encoding="utf-8") as f:
                    f.write("Transcript (automatisch, NIET gecontroleerd) — %s — %s\n\n" % (self.v.get("onderwerp", ""), self.v.get("datum", "")))
                    for s in segmenten:
                        f.write("[%s]%s %s\n" % (mmss(s["s"]), " (onduidelijk)" if s.get("onduidelijk") else "", s["t"]))
                self.drive.upload(self.v["id"], tpad, "Transcript %s.txt" % datetime.now().strftime("%Y-%m-%d %H%M"), "text/plain", md5_van(tpad))
                self.staat["transcript_drive"] = True
                self.bewaar()
            except Fout as e:
                self.waarschuwingen.append("Transcript niet als kopie op Drive gezet: " + e.melding)
        self.meet("bewaren", t0)

    # -- 5. conceptverslag
    def verslag(self, segmenten):
        t0 = time.time()
        bestaande = self.opdracht.get("punten") or []
        team = self.opdracht.get("team") or []
        deelnemers = self.v.get("deelnemers") or []
        v, ai_controle = None, None
        if not segmenten:
            self.waarschuwingen.append("Het spraakmodel vond geen gesproken tekst in deze opname.")
        elif self.taal.actief():
            self.zet("conceptverslag maken (cloud)", 0.82)
            p = self.opdracht.get("project") or {}
            agenda = "; ".join(a.get("tekst", "") for a in (self.v.get("agenda") or []) if isinstance(a, dict))
            context = "Vergadering: %s\nDatum: %s\nProject: %s%s\nDeelnemers (zoals ingevuld): %s%s" % (
                self.v.get("onderwerp", ""), self.v.get("datum", ""), p.get("klant", ""), (" · " + p["naam"]) if p.get("naam") and p.get("naam") != p.get("klant") else "",
                ", ".join(d.get("naam", "") for d in deelnemers) or "niet ingevuld", ("\nAgenda: " + agenda) if agenda else "")
            try:
                v = self.taal.verslag(context, segmenten)
                if self.cfg["llm"].get("tweede_controle"):
                    self.zet("tweede controle (cloud)", 0.9)
                    ai_controle = self.taal.controle(v, segmenten)
            except Fout as e:
                self.waarschuwingen.append("Geen conceptverslag: " + e.melding + " Het transcript is wel klaar; kies later 'Verslag opnieuw maken'.")
                v = None
            except ValueError:
                self.waarschuwingen.append("De samenvattingsdienst gaf geen bruikbaar antwoord. Het transcript is wel klaar; kies later 'Verslag opnieuw maken'.")
                v = None
        else:
            self.waarschuwingen.append("Geen automatisch conceptverslag (geen API-sleutel ingesteld op de verwerkingscomputer). Het transcript en de gevonden bedragen, maten en datums staan klaar.")
        punten, controles, concept = maak_punten(v, segmenten, team, bestaande, deelnemers)
        if ai_controle:
            controles["ai_controle"] = ai_controle
            lijsten = {"beslissingen": "beslissing", "open_vragen": "vraag", "actiepunten": "actie", "meerwerk": "meerwerk", "kritieke_gegevens": "gegeven"}
            per = {}
            for p in punten:
                per.setdefault(p["soort"], []).append(p)
            for pr in ai_controle.get("problemen") or []:
                l = per.get(lijsten.get(pr.get("lijst"), ""), [])
                i = pr.get("index")
                if isinstance(i, int) and 0 <= i < len(l):
                    l[i]["waarschuwingen"].append("Tweede AI-controle: " + str(pr.get("probleem", ""))[:250])
                    l[i]["kritiek"] = True
            for o in ai_controle.get("ontbrekend") or []:
                if o.get("soort") in ("beslissing", "actie", "vraag") and o.get("tekst"):
                    segs = [int(x) for x in (o.get("segmenten") or []) if str(x).isdigit()]
                    s, e, _, _ = bronbereik(segs, {x["i"]: x for x in segmenten})
                    punten.append({"soort": o["soort"], "tekst": str(o["tekst"])[:2000], "segmenten": segs, "bron_start": s, "bron_eind": e, "aard": "besproken" if o["soort"] != "vraag" else None,
                                   "waarschuwingen": ["Tweede AI-controle: mogelijk gemist punt — bevestig of wijs af"], "kritiek": True, "sleutel": sleutel(o["soort"], str(o["tekst"]))})
        self.meet("verslag", t0)
        self.metingen["tokens_in"], self.metingen["tokens_uit"] = self.taal.tokens_in, self.taal.tokens_uit
        self.metingen["geschatte_kost_usd"] = self.taal.kost()
        return v, punten, controles, concept

    def run(self):
        t0 = time.time()
        self.metingen["vrij_gb_voor"] = vrij_gb(self.cfg["werkmap"])
        self.metingen["geheugen_voor"] = systeemgeheugen()
        soort = self.opdracht["job"]["soort"]
        if soort == "verslag":
            segmenten = self.opdracht.get("transcript") or []
        else:
            orig = self.origineel()
            segmenten, afspeel = self.transcriptie(orig)
            self.bewaar_bestanden(orig, afspeel, segmenten)
        v, punten, controles, concept = self.verslag(segmenten)
        # uploaddelen opruimen: enkel als het origineel gecontroleerd op Drive staat (nooit de enige kopie)
        op = self.v.get("opname") or {}
        if soort == "volledig" and self.staat.get("drive_ok") and not self.v.get("inbox_leeg") and op.get("delen"):
            self.zet("uploaddelen opruimen", 0.96)
            self.sb.verwijder([d["pad"] for d in op["delen"]])
            self.sb.rpc("verwerking_bestand", {"p_job": self.job_id, "p_claim": self.claim, "p_gegevens": {"inbox_leeg": True}})
        self.metingen["vrij_gb_na"] = vrij_gb(self.cfg["werkmap"])
        self.metingen["totaal_s"] = round(time.time() - t0, 1)
        self.zet("resultaat bewaren", 0.98)
        resultaat = {"transcript": segmenten if soort == "volledig" else None, "verslag": v, "verslag_concept": concept, "punten": punten, "controles": controles,
                     "modellen": {"transcriptie": os.path.basename(self.cfg.get("whisper_model") or ""), "vad": os.path.basename(self.cfg.get("vad_model") or ""),
                                  "threads": self.cfg.get("whisper_threads"), "deel_minuten": self.cfg.get("deel_minuten"),
                                  "taalmodel": self.cfg["llm"]["model"] if self.taal.actief() else None, "tweede_controle": bool(self.cfg["llm"].get("tweede_controle")) and self.taal.actief()},
                     "metingen": self.metingen, "waarschuwing": " ".join(self.waarschuwingen)}
        r = self.sb.rpc("verwerking_klaar", {"p_job": self.job_id, "p_claim": self.claim, "p_resultaat": resultaat}, timeout=300)
        shutil.rmtree(self.map, ignore_errors=True)   # enkel afgeleide en tijdelijke bestanden; het origineel staat op Drive of in de opslag
        return r


# ---------------------------------------------------------------- de dienst
class Dienst:
    def __init__(self, cfg):
        self.cfg = cfg
        self.sb = Supabase(cfg)
        self.drive = Drive(cfg, self.sb)
        self.stop_alles = threading.Event()
        self.huidig = None

    def info(self):
        return {"schijf_vrij_gb": vrij_gb(self.cfg["werkmap"]), "geheugen": systeemgeheugen(), "computer": platform.node(), "systeem": platform.platform(),
                "model": os.path.basename(self.cfg.get("whisper_model") or ""), "model_ok": bool(self.cfg.get("whisper_model") and os.path.exists(self.cfg["whisper_model"])),
                "vad": bool(self.cfg.get("vad_model") and os.path.exists(self.cfg["vad_model"])),
                "samenvatting": Taalmodel(self.cfg).actief(), "taalmodel": self.cfg["llm"]["model"], "drive": self.drive.actief(),
                "bezig": bool(self.huidig), "stap": self.huidig.stap if self.huidig else ""}

    def meld(self):
        try:
            self.sb.rpc("verwerker_meld", {"p_naam": self.cfg["naam"], "p_versie": VERSIE, "p_info": self.info()}, timeout=30)
        except Fout as e:
            log("melden mislukt:", e.melding)

    def hartslag(self, verw, stop_job):
        laatste_meld = 0
        while not stop_job.wait(float(self.cfg.get("hartslag_seconden", 30))):
            try:
                r = self.sb.rpc("verwerking_voortgang", {"p_job": verw.job_id, "p_claim": verw.claim, "p_stap": verw.stap, "p_voortgang": round(verw.voortgang, 3)}, timeout=30)
                if r and r.get("actief") is False:
                    log("opdracht gestopt door een gebruiker")
                    verw.stop.set()
                    verw.audio.kill()
                    return
                if time.time() - laatste_meld > 60:
                    self.meld()
                    laatste_meld = time.time()
            except Fout as e:
                log("hartslag mislukt:", e.melding)

    def een_opdracht(self):
        job = self.sb.rpc("verwerking_claim", {"p_naam": self.cfg["naam"]})
        if not job:
            return False
        log("opdracht", job["job"]["id"], job["job"]["soort"], "poging", job["job"]["poging"], "—", job["vergadering"].get("onderwerp"))
        stop = threading.Event()
        verw = None
        stop_job = threading.Event()
        try:
            verw = Verwerking(self.cfg, self.sb, self.drive, Taalmodel(self.cfg), job, stop)
            self.huidig = verw
            threading.Thread(target=self.hartslag, args=(verw, stop_job), daemon=True).start()
            r = verw.run()
            log("klaar:", json.dumps(r), "in", verw.metingen.get("totaal_s"), "s")
        except Gestopt:
            if self.stop_alles.is_set():
                self._mislukt(job, "Onderbroken: de verwerkingscomputer werd gestopt. De verwerking wordt hervat.", "", True)
            else:
                log("gestopt op vraag van een gebruiker")
        except Fout as e:
            log("fout:", e.melding, e.detail[:500])
            self._mislukt(job, e.melding, e.detail, e.opnieuw)
        except MemoryError:
            self._mislukt(job, "Te weinig werkgeheugen op de verwerkingscomputer.", "", True)
        except Exception as e:
            log("onverwachte fout:", traceback.format_exc())
            self._mislukt(job, "Onverwachte fout op de verwerkingscomputer (%s). Probeer opnieuw; blijft het mislukken, bekijk het logboek." % type(e).__name__, traceback.format_exc()[-3000:], True)
        finally:
            stop_job.set()
            self.huidig = None
        return True

    def _mislukt(self, job, melding, detail, opnieuw):
        try:
            self.sb.rpc("verwerking_mislukt", {"p_job": job["job"]["id"], "p_claim": job["job"].get("claim"), "p_fout": melding, "p_detail": detail or "", "p_opnieuw": bool(opnieuw)})
        except Fout as e:
            log("melden van de fout mislukt (de opdracht wordt na 10 min. vanzelf vrijgegeven):", e.melding)

    def opruimen(self):
        """Werkmappen van meer dan 14 dagen oud (enkel afgeleide bestanden en een kopie van een origineel dat elders bewaard blijft)."""
        wm = self.cfg["werkmap"]
        if not os.path.isdir(wm):
            return
        for d in os.listdir(wm):
            p = os.path.join(wm, d)
            try:
                if os.path.isdir(p) and time.time() - os.path.getmtime(p) > 14 * 86400:
                    shutil.rmtree(p, ignore_errors=True)
            except OSError:
                pass

    def start(self):
        def stopsignaal(sig, frame):
            log("stopsignaal ontvangen")
            self.stop_alles.set()
            if self.huidig:
                self.huidig.stop.set()
                self.huidig.audio.kill()
        signal.signal(signal.SIGTERM, stopsignaal)
        signal.signal(signal.SIGINT, stopsignaal)
        log("BROS verwerker", VERSIE, "gestart op", platform.node())
        if IS_MAC and shutil.which("caffeinate"):
            try:
                subprocess.Popen(["caffeinate", "-i", "-w", str(os.getpid())])   # Mac wakker houden zolang de dienst draait
            except OSError:
                pass
        self.opruimen()
        laatste_meld = 0
        wacht = 5
        while not self.stop_alles.is_set():
            try:
                if time.time() - laatste_meld > 60:
                    self.meld()
                    laatste_meld = time.time()
                if vrij_gb(self.cfg["werkmap"]) < float(self.cfg["min_vrij_gb"]):
                    log("te weinig schijfruimte — wacht")
                    self.stop_alles.wait(300)
                    continue
                had = self.een_opdracht()
                wacht = 5
                if had:
                    laatste_meld = 0
                    continue
                self.stop_alles.wait(float(self.cfg["poll_seconden"]))
            except Fout as e:
                log("verbinding:", e.melding)
                self.stop_alles.wait(wacht)
                wacht = min(300, wacht * 2)
        log("gestopt")


# ---------------------------------------------------------------- controle en praktijktest
def controle(cfg):
    ok = True
    def regel(goed, tekst):
        nonlocal ok
        ok = ok and goed
        print(("  OK   " if goed else "  FOUT ") + tekst)
    print("BROS verwerker", VERSIE, "— controle (" + cfg["_pad"] + ")")
    for k in ("ffmpeg", "ffprobe", "whisper_cli"):
        regel(bool(shutil.which(cfg[k]) or os.path.exists(cfg[k])), "%s: %s" % (k, shutil.which(cfg[k]) or cfg[k]))
    regel(bool(cfg["whisper_model"]) and os.path.exists(cfg["whisper_model"]), "spraakmodel: " + (cfg["whisper_model"] or "(niet ingevuld)"))
    if cfg.get("vad_model"):
        regel(os.path.exists(cfg["vad_model"]), "VAD-model: " + cfg["vad_model"])
    regel(vrij_gb(cfg["werkmap"]) >= float(cfg["min_vrij_gb"]), "vrije schijfruimte: %s GB (minimum %s)" % (vrij_gb(cfg["werkmap"]), cfg["min_vrij_gb"]))
    print("       werkgeheugen:", systeemgeheugen())
    regel(bool(geheim("supabase-wachtwoord", "BROS_SUPABASE_WACHTWOORD")), "wachtwoord verwerkingslogin in de sleutelhanger")
    t = Taalmodel(cfg)
    print("  " + ("OK   " if t.actief() else "INFO ") + "API-sleutel voor het conceptverslag: " + ("aanwezig (" + cfg["llm"]["model"] + ")" if t.actief() else "niet ingesteld — enkel transcript"))
    if cfg["supabase_url"] and cfg["email"]:
        try:
            sb = Supabase(cfg)
            r = sb.rpc("verwerker_meld", {"p_naam": cfg["naam"], "p_versie": VERSIE, "p_info": {"controle": True}})
            regel(True, "inloggen op het Planbord als %s (wachtrij: %s)" % (cfg["email"], r.get("wachtrij")))
        except Fout as e:
            regel(False, "inloggen op het Planbord: " + e.melding)
    else:
        regel(False, "supabase_url / email in config.json")
    if cfg.get("drive_script_url"):
        try:
            st, raw, _ = http("POST", cfg["drive_script_url"], {"Content-Type": "application/json"}, json.dumps({"action": "opname", "soort": "info", "token": "x", "vergadering_id": str(uuidlib.uuid4())}).encode(), timeout=60)
            j = json_of(raw) or {}
            regel(st == 200 and "ok" in j, "Drive-script bereikbaar (" + (j.get("error") or "antwoord ok") + ")")
        except Fout as e:
            regel(False, "Drive-script: " + e.melding)
    else:
        print("  INFO drive_script_url niet ingevuld — originelen blijven in de opslag van het Planbord")
    print("\n" + ("Alles in orde." if ok else "Er zijn problemen (zie FOUT)."))
    return 0 if ok else 1


def lokale_test(cfg, bestand, modellen=None, uitmap="testresultaat"):
    """Praktijktest zonder Planbord: zelfde stappen (omzetten, knippen, transcriberen) en metingen, per model."""
    os.makedirs(uitmap, exist_ok=True)
    rapport = {"bestand": os.path.basename(bestand), "grootte_mb": round(os.path.getsize(bestand) / 1e6, 1), "computer": platform.node(), "systeem": platform.platform(),
               "geheugen_voor": systeemgeheugen(), "vrij_gb_voor": vrij_gb(cfg["werkmap"]), "modellen": []}
    a = Audio(cfg)
    info = a.probe(bestand)
    rapport.update(info)
    werk = os.path.join(cfg["werkmap"], "test-" + uuidlib.uuid4().hex[:8])
    os.makedirs(werk, exist_ok=True)
    try:
        wav = os.path.join(werk, "audio.wav")
        t = time.time(); a.naar_wav(bestand, wav); rapport["omzetten_s"] = round(time.time() - t, 1)
        t = time.time(); a.afspeelkopie(bestand, os.path.join(werk, "afspeel.m4a")); rapport["afspeelkopie_s"] = round(time.time() - t, 1)
        rapport["afspeelkopie_mb"] = round(os.path.getsize(os.path.join(werk, "afspeel.m4a")) / 1e6, 1)
        delen = Audio.kniptijden(info["duur_sec"], a.stiltes(wav), float(cfg["deel_minuten"]) * 60)
        rapport["delen"] = len(delen)
        for model in (modellen or [cfg["whisper_model"]]):
            m = {"model": os.path.basename(model), "delen_s": []}
            seg, t0 = [], time.time()
            for n, (s, e) in enumerate(delen):
                dwav = os.path.join(werk, "d%03d.wav" % n)
                a.knip(wav, s, e, dwav)
                uit = os.path.join(werk, "d%03d" % n)
                td = time.time()
                rc, _, err = a.run(whisper_args(cfg, model, dwav, uit, "Vergadering van BROS interieurarchitecten."), meet=True)
                if rc != 0:
                    raise Fout("whisper.cpp fout", err[-1500:])
                m["delen_s"].append(round(time.time() - td, 1))
                m.setdefault("rss_mb", []).append(a.laatste_rss_mb)
                seg += lees_whisper_json(uit + ".json", s, len(seg))
                print("  %s deel %d/%d: %.1f s" % (m["model"], n + 1, len(delen), m["delen_s"][-1]), flush=True)
            markeer_onduidelijk(seg, float(cfg["laag_vertrouwen"]))
            m["transcriberen_s"] = round(time.time() - t0, 1)
            m["x_realtime"] = round(info["duur_sec"] / max(0.1, m["transcriberen_s"]), 2)
            m["piek_geheugen_mb"] = max([x for x in m.get("rss_mb", []) if x] or [0])
            m["segmenten"] = len(seg)
            m["onduidelijk"] = sum(1 for x in seg if x.get("onduidelijk"))
            m["gevonden_gegevens"] = len(vind_gegevens(seg))
            naam = re.sub(r"[^\w.-]", "_", m["model"])
            with open(os.path.join(uitmap, "transcript-" + naam + ".txt"), "w", encoding="utf-8") as f:
                for x in seg:
                    f.write("[%s]%s %s\n" % (mmss(x["s"]), " (ONDUIDELIJK: %s)" % x.get("reden") if x.get("onduidelijk") else "", x["t"]))
            with open(os.path.join(uitmap, "transcript-" + naam + ".json"), "w", encoding="utf-8") as f:
                json.dump(seg, f, ensure_ascii=False, indent=1)
            rapport["modellen"].append(m)
        rapport["schijf_werkmap_mb"] = round(mapgrootte(werk) / 1e6, 1)
    finally:
        shutil.rmtree(werk, ignore_errors=True)
    rapport["vrij_gb_na"] = vrij_gb(cfg["werkmap"])
    rapport["geheugen_na"] = systeemgeheugen()
    with open(os.path.join(uitmap, "rapport.json"), "w", encoding="utf-8") as f:
        json.dump(rapport, f, ensure_ascii=False, indent=2)
    print(json.dumps(rapport, ensure_ascii=False, indent=2))
    return 0


def main(argv):
    cfg = laad_config()
    cmd = argv[1] if len(argv) > 1 else "dienst"
    if cmd == "controle":
        return controle(cfg)
    if cmd in ("test", "meet"):
        if len(argv) < 3:
            print("gebruik: bros_verwerker.py %s BESTAND [--modellen pad1,pad2]" % cmd)
            return 2
        modellen = None
        if "--modellen" in argv:
            modellen = [m for m in argv[argv.index("--modellen") + 1].split(",") if m]
        return lokale_test(cfg, argv[2], modellen)
    if cmd == "versie":
        print(VERSIE)
        return 0
    Dienst(cfg).start()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
