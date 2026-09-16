#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
BROS Planbord — yuki_sync.py
Koppelt verkoopfacturen uit Yuki (mail "Factuur van BROS: Factuur voor <klant>") aan vorderingen in het Planbord.

Invoer  : JSON op stdin, lijst van facturen zoals uit de Yuki-mail gehaald:
          [{"factuurnummer":"2026145","datum":"2026-09-15","klant":"R.m. invest","totaal_incl":9181.00,
            "excl":7587.60, "btw":1593.40, "mail_id":"...", "onderwerp":"..."}]
          (excl/btw zijn optioneel — enkel als de pdf gelezen werd)
Omgeving: PLANBORD_URL (Supabase-URL), PLANBORD_KEY (publishable/anon key), PLANBORD_BOT_EMAIL, PLANBORD_BOT_PASSWORD
Uitvoer : JSON-rapport op stdout: per factuur wat er gebeurd is (gekoppeld / al gekoppeld / niet gevonden / twijfel).

Werkwijze per factuur:
 1. Al gekoppeld? (factuurnummer bestaat al in vorderingen) → overslaan.
 2. Project zoeken: projectnummer (6 cijfers) in klantnaam/onderwerp, anders klantnaam ≈ projecten.klant / bedrijf / naam.
 3. Vordering zoeken bij dat project (status 'opgemaakt'): berekend bedrag incl. btw ≈ factuurtotaal (± 1 €),
    anders excl. ≈ maatstaf, anders de enige openstaande vordering (met melding "verschil").
    Zonder project: over alle projecten de vordering met exact hetzelfde berekende bedrag (uniek) → koppelen.
 4. Koppelen = factuurnummer, datum, bedrag_excl invullen en status 'verzonden' (bedrag bevroren).
Met --dry-run wordt niets weggeschreven.
"""
import json, os, re, sys, unicodedata, urllib.request, urllib.parse

URL = os.environ.get("PLANBORD_URL", "").rstrip("/")
KEY = os.environ.get("PLANBORD_KEY", "")
DRY = "--dry-run" in sys.argv
TOL = 1.0  # euro

def req(path, method="GET", body=None, token=None, prefer=None):
    h = {"apikey": KEY, "Content-Type": "application/json", "Authorization": "Bearer " + (token or KEY)}
    if prefer: h["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(URL + path, data=data, method=method, headers=h)
    with urllib.request.urlopen(r, timeout=60) as resp:
        t = resp.read().decode()
        return json.loads(t) if t else None

def login():
    j = req("/auth/v1/token?grant_type=password", "POST", {"email": os.environ["PLANBORD_BOT_EMAIL"], "password": os.environ["PLANBORD_BOT_PASSWORD"]})
    return j["access_token"]

def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(bv|bvba|nv|vof|cv|srl|sa|invest|group)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()

# ---------- dezelfde rekenregels als app.js (vordCalc) ----------
def ms_verkoop(r, loten):
    marge = float(r["marge"]) if r.get("marge") not in (None, "") else float(loten.get(r["lot"], {}).get("marge") or 0)
    return (float(r["hoeveelheid"] or 0)) * (float(r["eenheidsprijs"] or 0)) * (1 + marge)

def row_signed(r, loten):
    return ms_verkoop(r, loten) * (-1 if r["status"] == "minwerk" else 1)

def vord_calc(v, rows, regels, loten):
    mw = v["soort"] == "meerwerk"
    lot_rg = {r["lot"]: float(r["pct"]) for r in regels if r["vordering_id"] == v["id"] and not r.get("post_id")}
    post_rg = {r["post_id"]: float(r["pct"]) for r in regels if r["vordering_id"] == v["id"] and r.get("post_id")}
    excl = btw = 0.0
    for r in rows:
        if r["project_id"] != v["project_id"] or r["status"] == "vervallen": continue
        if (r["status"] in ("meerwerk", "minwerk")) != mw: continue
        pct = post_rg.get(r["id"], lot_rg.get(r["lot"]))
        if pct is None: continue
        a = pct * row_signed(r, loten); excl += a; btw += a * float(r["btw"] or 0)
    return round(excl, 2), round(btw, 2), round(excl + btw, 2)

def main():
    facturen = json.load(sys.stdin)
    token = login()
    projecten = req("/rest/v1/projecten?select=id,nummer,klant,naam,bedrijf,status", token=token)
    vorderingen = req("/rest/v1/vorderingen?select=*", token=token)
    regels = req("/rest/v1/vordering_regels?select=*", token=token)
    rows = req("/rest/v1/meetstaat_posten?select=id,project_id,lot,status,hoeveelheid,eenheidsprijs,marge,btw", token=token)
    loten = {l["nr"]: l for l in req("/rest/v1/loten?select=nr,marge", token=token)}
    calc = {v["id"]: vord_calc(v, rows, regels, loten) for v in vorderingen}
    bestaand = {str(v.get("factuurnummer") or "").strip(): v for v in vorderingen if v.get("factuurnummer")}
    rapport = []
    for f in facturen:
        nr = str(f.get("factuurnummer") or "").strip(); incl = float(f.get("totaal_incl") or 0); excl_f = f.get("excl")
        if not nr: rapport.append({**f, "resultaat": "overgeslagen", "reden": "geen factuurnummer"}); continue
        if nr in bestaand:
            v = bestaand[nr]; rapport.append({**f, "resultaat": "al gekoppeld", "vordering": v["id"], "project": v["project_id"]}); continue
        # 1) project
        tekst = " ".join(str(f.get(k) or "") for k in ("klant", "onderwerp", "omschrijving"))
        m = re.search(r"\b(2[5-9]\d{4})\b", tekst); proj = None
        if m: proj = next((p for p in projecten if p.get("nummer") == m.group(1)), None)
        if not proj:
            k = norm(f.get("klant")); kand = []
            for p in projecten:
                namen = [norm(p.get("klant")), norm(p.get("bedrijf")), norm(p.get("naam"))]
                if k and any(n and (k in n or n in k) for n in namen): kand.append(p)
            if len(kand) == 1: proj = kand[0]
            elif len(kand) > 1:
                # meerdere kandidaten: kies die met een openstaande vordering die op het bedrag past
                fit = [p for p in kand if any(v["project_id"] == p["id"] and v["status"] == "opgemaakt" and abs(calc[v["id"]][2] - incl) <= TOL for v in vorderingen)]
                proj = fit[0] if len(fit) == 1 else None
                if not proj: rapport.append({**f, "resultaat": "twijfel", "reden": "meerdere projecten passen: " + ", ".join(p["klant"] for p in kand)}); continue
        # 2) vordering
        kand_v = [v for v in vorderingen if v["status"] == "opgemaakt" and (not proj or v["project_id"] == proj["id"])]
        v = None; opm = ""
        exact = [x for x in kand_v if abs(calc[x["id"]][2] - incl) <= TOL]
        if len(exact) == 1: v = exact[0]
        elif not exact and excl_f is not None:
            e2 = [x for x in kand_v if abs(calc[x["id"]][0] - float(excl_f)) <= TOL]
            if len(e2) == 1: v = e2[0]
        if not v and proj and len(kand_v) == 1:
            v = kand_v[0]; opm = f"verschil: berekend {calc[v['id']][2]:.2f} incl. vs factuur {incl:.2f}"
        if not v:
            rapport.append({**f, "resultaat": "niet gevonden", "project": proj["klant"] if proj else None, "reden": "geen openstaande vordering met dit bedrag" if proj else "project niet herkend"}); continue
        c = calc[v["id"]]
        bedrag_excl = float(excl_f) if excl_f is not None else (c[0] if abs(c[2] - incl) <= TOL else round(incl / (1 + (c[1] / c[0] if c[0] else 0.06)), 2))
        patch = {"factuurnummer": nr, "datum": f.get("datum") or v.get("datum"), "bedrag_excl": bedrag_excl, "status": "verzonden"}
        if opm: patch["opmerking"] = ((v.get("opmerking") or "") + " " + opm).strip()
        if not DRY: req(f"/rest/v1/vorderingen?id=eq.{v['id']}", "PATCH", patch, token=token, prefer="return=minimal")
        v.update(patch); bestaand[nr] = v  # ook in deze run niet tweemaal dezelfde vordering koppelen
        p = next((x for x in projecten if x["id"] == v["project_id"]), {})
        rapport.append({**f, "resultaat": "gekoppeld" + (" (dry-run)" if DRY else ""), "project": p.get("klant"), "projectnummer": p.get("nummer"), "vordering_nr": v["nr"], "vordering_soort": v["soort"], "berekend_incl": c[2], "bedrag_excl": bedrag_excl, "opmerking": opm})
    print(json.dumps(rapport, ensure_ascii=False, indent=1))

if __name__ == "__main__":
    main()
