#!/usr/bin/env python3
"""BROS presentatie-generator - A3 staand, BROS-huisstijl.
(Planbord 1.59: kopie van make_presentatie uit de skill bros-presentatie, met klantnaam, ontwerpversie en datum op de
 cover via --klant/--versie/--datum. Draait op de verwerkingscomputer in de Python-omgeving van Plan2CAD, met PyMuPDF.)

Gebruik:
  python3 make_presentatie.py --assets DIR --out "250926 Presentatie Klant.pdf" [--liggend] \
      cover:img1.jpg,img2.jpg,img3.jpg  render:r1.jpg  render:r2.jpg  plan:grondplan.png ...

Paginatypes (item = type:pad[,pad...]):
  cover:a,b,c   omslag - 3 staande uitsneden + groot logo. Focus per beeld: a.jpg@0.3 (0=links, 1=rechts)
  render:a      render over volle breedte, verticaal gecentreerd, klein logo onderaan (standaard)
  duo:a,b       twee renders onder elkaar, volle breedte, klein logo
  collage:a     beeld vult de bovenkant (volle breedte tot net boven het logo), klein logo
  plan:a        witte pagina, plan zo groot mogelijk binnen marges, geen logo
  full:a        beeld vult de volledige pagina (aflopend), geen logo
  moodboard:spec.json   materialenbord genereren (make_moodboard.py, zelfde map) en plaatsen zoals een render
Een item zonder type wordt als render behandeld.
--liggend: A3 liggend (1190,6 x 841,9 pt) i.p.v. staand. Cover = 3 stroken links + groot logo rechts,
           duo = twee renders naast elkaar, logo onderaan gecentreerd.
Assets-map moet bevatten: bg_a3.jpg, bg_a3_liggend.jpg en logo.pdf (vectorlogo uit Logo BROS zwart.eps)
"""
import argparse, io, os, sys

import pymupdf as fitz
from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = None
DPI = 300
LIGGEND = False
# --- A3 staand (maten uit het voorbeeld "170626 Presentatie Sene Jules") ---
W, H = 841.89, 1190.55
LOGO_S = fitz.Rect(339.7, 1092.1, 502.2, 1148.6)   # klein logo, 162.5 pt breed (57 mm)
LOGO_L = fitz.Rect(144.4, 950.9, 697.7, 1143.3)    # groot logo cover, 553 pt breed (195 mm)
COVER_SLOTS = [fitz.Rect(x, 309.1, x + 157.6, 769.4) for x in (100.6, 342.2, 583.7)]
LOGO_TOP = 1060.0                             # alles boven deze lijn is vrij voor beeld
BG = "bg_a3.jpg"


def set_liggend():
    """A3 liggend: zelfde logo- en strookmaten, opstelling herschikt."""
    global LIGGEND, W, H, LOGO_S, LOGO_L, COVER_SLOTS, LOGO_TOP, BG
    LIGGEND = True
    W, H = 1190.55, 841.89
    lw, lh = 162.5, 56.5                                   # klein logo, zelfde maat als staand
    LOGO_S = fitz.Rect(W / 2 - lw / 2, 754, W / 2 + lw / 2, 754 + lh)
    LOGO_TOP = 720.0
    sw, sh, gap = 157.6, 460.3, 60.0                       # stroken zoals staand
    x0 = 100; y0 = (H - sh) / 2
    COVER_SLOTS = [fitz.Rect(x0 + i * (sw + gap), y0, x0 + i * (sw + gap) + sw, y0 + sh) for i in range(3)]
    Lw = 340; Lh = Lw / 2.8758; cx = (COVER_SLOTS[-1].x1 + W) / 2
    LOGO_L = fitz.Rect(cx - Lw / 2, H / 2 - Lh / 2, cx + Lw / 2, H / 2 + Lh / 2)
    BG = "bg_a3_liggend.jpg"


def load(path):
    im = Image.open(path)
    im = ImageOps.exif_transpose(im)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, "white")
        bg.paste(im, mask=im.split()[-1])
        im = bg
    elif im.mode == "CMYK":
        im = im.convert("RGB")
    else:
        im = im.convert("RGB")
    return im


def crop_to(im, ar, fx=0.5, fy=0.5):
    """Uitsnede met beeldverhouding ar (b/h), focuspunt fx/fy (0..1)."""
    w, h = im.size
    if w / h > ar:
        nw = round(h * ar); x = round((w - nw) * fx)
        return im.crop((x, 0, x + nw, h))
    nh = round(w / ar); y = round((h - nh) * fy)
    return im.crop((0, y, w, y + nh))


def stream(im, rect):
    maxw = int(rect.width / 72 * DPI)
    if im.width > maxw:
        im = im.resize((maxw, round(im.height * maxw / im.width)), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, "JPEG", quality=90, optimize=True, subsampling=0)
    return b.getvalue()


def put(page, im, rect):
    page.insert_image(rect, stream=stream(im, rect), keep_proportion=False)


def parse(p):
    fx = 0.5
    if "@" in p:
        p, f = p.rsplit("@", 1); fx = float(f)
    return p, fx


class Deck:
    def __init__(self, assets, titel=None):
        self.titel = titel or {}
        self.doc = fitz.open()
        self.bg = open(os.path.join(assets, BG), "rb").read()
        self.logodoc = fitz.open(os.path.join(assets, "logo.pdf"))
        self._bgx = self._lsx = self._llx = 0

    def page(self, texture=True):
        pg = self.doc.new_page(width=W, height=H)
        if texture:
            self._bgx = pg.insert_image(pg.rect, stream=self.bg, keep_proportion=False, xref=self._bgx) if self._bgx else pg.insert_image(pg.rect, stream=self.bg, keep_proportion=False)
        return pg

    def logo(self, pg, big=False):
        pg.show_pdf_page(LOGO_L if big else LOGO_S, self.logodoc, 0)   # vector, blijft scherp

    # ---- paginatypes ----
    def cover(self, paths):
        if len(paths) != 3:
            sys.exit("cover heeft precies 3 beelden nodig")
        pg = self.page()
        for slot, p in zip(COVER_SLOTS, paths):
            p, fx = parse(p)
            put(pg, crop_to(load(p), slot.width / slot.height, fx), slot)
        self.logo(pg, big=True)
        self.covertekst(pg)

    def covertekst(self, pg):
        """Klantnaam, ontwerpversie en datum op de cover (Planbord 1.59), gecentreerd onder de stroken (staand) of onder het logo (liggend)."""
        klant = (self.titel.get("klant") or "").strip()
        regel = "  ·  ".join(x for x in ("Ontwerp " + self.titel["versie"].strip() if (self.titel.get("versie") or "").strip() else "", (self.titel.get("datum") or "").strip()) if x)
        if not klant and not regel:
            return
        kleur = (0.16, 0.15, 0.14)
        if LIGGEND:
            cx, y = (LOGO_L.x0 + LOGO_L.x1) / 2, LOGO_L.y1 + 46
        else:
            cx, y = W / 2, (COVER_SLOTS[0].y1 + LOGO_L.y0) / 2 + 2
        def regelzet(tekst, grootte, yy, spatie=0.0):
            if not tekst:
                return
            f = fitz.Font("helv")
            breedte = f.text_length(tekst, fontsize=grootte) + spatie * max(0, len(tekst) - 1)
            while breedte > W - 120 and grootte > 6:
                grootte -= 0.5; breedte = f.text_length(tekst, fontsize=grootte) + spatie * max(0, len(tekst) - 1)
            x = cx - breedte / 2
            if spatie:
                for ch in tekst:
                    pg.insert_text((x, yy), ch, fontname="helv", fontsize=grootte, color=kleur); x += f.text_length(ch, fontsize=grootte) + spatie
            else:
                pg.insert_text((x, yy), tekst, fontname="helv", fontsize=grootte, color=kleur)
        regelzet(klant.upper(), 15, y - 8, spatie=2.2)
        regelzet(regel, 9.5, y + 12, spatie=0.6)

    def render(self, paths):
        pg = self.page()
        im = load(parse(paths[0])[0]); ar = im.width / im.height
        if LIGGEND:                                   # binnen zone boven het logo, max. volle breedte
            box = fitz.Rect(0, 40, W, LOGO_TOP - 10)
            bw = min(W, box.height * ar); bh = bw / ar
            if bw >= W - 60:                          # bijna volle breedte: aflopend links/rechts
                bw = W; bh = min(box.height, W / ar); im = crop_to(im, bw / bh)
            r = fitz.Rect(W / 2 - bw / 2, box.y0 + (box.height - bh) / 2, W / 2 + bw / 2, box.y0 + (box.height + bh) / 2)
            put(pg, im, r); self.logo(pg); return
        h = W / ar
        if h <= 900:                                  # liggend beeld: volle breedte
            r = fitz.Rect(0, H / 2 - h / 2, W, H / 2 + h / 2)
        else:                                         # staand/vierkant: passen in vrije zone
            bh = LOGO_TOP - 60; bw = bh * ar
            if bw > W - 120: bw = W - 120; bh = bw / ar
            cy = min(H / 2, 30 + (LOGO_TOP - 30) / 2)
            r = fitz.Rect(W / 2 - bw / 2, cy - bh / 2, W / 2 + bw / 2, cy + bh / 2)
        put(pg, im, r); self.logo(pg)

    def duo(self, paths):
        pg = self.page(); gap = 18
        ims = [load(parse(p)[0]) for p in paths[:2]]
        if LIGGEND:                                   # naast elkaar, gelijke hoogte
            cw = (W - gap) / 2; box_h = LOGO_TOP - 10 - 40
            ch = min(box_h, min(cw / (i.width / i.height) for i in ims))
            y = 40 + (box_h - ch) / 2
            for k, im in enumerate(ims):
                x = k * (cw + gap)
                put(pg, crop_to(im, cw / ch), fitz.Rect(x, y, x + cw, y + ch))
            self.logo(pg); return
        hs = [W / (i.width / i.height) for i in ims]
        tot = sum(hs) + gap
        if tot > LOGO_TOP - 60:                       # te hoog: bijsnijden tot gelijke hoogte
            each = (LOGO_TOP - 60 - gap) / 2
            ims = [crop_to(i, W / each) for i in ims]; hs = [each, each]; tot = 2 * each + gap
        y = min(H / 2, 30 + (LOGO_TOP - 30) / 2) - tot / 2
        for im, h in zip(ims, hs):
            put(pg, im, fitz.Rect(0, y, W, y + h)); y += h + gap
        self.logo(pg)

    def collage(self, paths):
        pg = self.page(); r = fitz.Rect(0, 0, W, (LOGO_TOP - 20) if LIGGEND else 1031.5)
        p, fx = parse(paths[0])
        put(pg, crop_to(load(p), r.width / r.height, fx, 0.0), r); self.logo(pg)

    def plan(self, paths):
        pg = self.page(texture=False)
        im = load(parse(paths[0])[0]); box = fitz.Rect(36, 36, W - 36, H - 36)
        ar = im.width / im.height
        bw, bh = (box.width, box.width / ar) if ar > box.width / box.height else (box.height * ar, box.height)
        r = fitz.Rect(W / 2 - bw / 2, H / 2 - bh / 2, W / 2 + bw / 2, H / 2 + bh / 2)
        # plannen: PNG (lossless) houden voor scherpe lijnen
        maxw = int(r.width / 72 * DPI)
        if im.width > maxw:
            im = im.resize((maxw, round(im.height * maxw / im.width)), Image.LANCZOS)
        b = io.BytesIO(); im.save(b, "PNG", optimize=True)
        pg.insert_image(r, stream=b.getvalue())

    def full(self, paths):
        pg = self.page(texture=False); p, fx = parse(paths[0])
        put(pg, crop_to(load(p), W / H, fx), pg.rect)

    def moodboard(self, paths):
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import json, tempfile, make_moodboard
        spec = json.load(open(paths[0]))
        base = os.path.dirname(os.path.abspath(paths[0]))
        for m in spec["materialen"]:                      # beeldpaden relatief t.o.v. de spec
            if m.get("beeld") and not os.path.isabs(m["beeld"]):
                m["beeld"] = os.path.join(base, m["beeld"])
        tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False).name
        make_moodboard.build(spec, tmp)
        self.render([tmp])

    def save(self, out):
        self.doc.set_metadata({"title": os.path.splitext(os.path.basename(out))[0],
                               "author": "BROS Interior Architects", "creator": "BROS Planbord"})
        self.doc.save(out, garbage=4, deflate=True)
        print(f"OK: {out} - {len(self.doc)} pagina's, {os.path.getsize(out)/1e6:.1f} MB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--assets", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--liggend", action="store_true", help="A3 liggend i.p.v. staand")
    ap.add_argument("--klant", default="")
    ap.add_argument("--versie", default="")
    ap.add_argument("--datum", default="")
    ap.add_argument("items", nargs="+")
    a = ap.parse_args()
    if a.liggend:
        set_liggend()
    d = Deck(a.assets, {"klant": a.klant, "versie": a.versie, "datum": a.datum})
    for it in a.items:
        t, _, rest = it.partition(":")
        if not rest or t not in ("cover", "render", "duo", "collage", "plan", "full"):
            t, rest = "render", it
        getattr(d, t)(rest.split(","))
    d.save(a.out)


if __name__ == "__main__":
    main()
