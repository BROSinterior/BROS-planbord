"""Vector-PDF uitlezen: lijnen, rechthoeken, curven en tekst omzetten naar
papier-millimeter.
"""

from __future__ import annotations

import math
from typing import List, Optional

import pymupdf

from .model import Polylijn, Tekening, Tekst
from .units import PT_TO_MM


def _bezier(p0, p1, p2, p3, stappen: int = 12):
    """Bezier afvlakken naar rechte stukjes."""
    punten = []
    for i in range(1, stappen + 1):
        t = i / stappen
        mt = 1 - t
        x = (mt ** 3) * p0[0] + 3 * (mt ** 2) * t * p1[0] + 3 * mt * (t ** 2) * p2[0] + (t ** 3) * p3[0]
        y = (mt ** 3) * p0[1] + 3 * (mt ** 2) * t * p1[1] + 3 * mt * (t ** 2) * p2[1] + (t ** 3) * p3[1]
        punten.append((x, y))
    return punten


def _bezier_stappen(p0, p3) -> int:
    d = math.hypot(p3[0] - p0[0], p3[1] - p0[1])
    return max(4, min(24, int(d / 2) + 4))


def _kleur_naar_rgb(kleur) -> Optional[tuple]:
    if kleur is None:
        return None
    try:
        if len(kleur) == 3:
            return tuple(int(max(0.0, min(1.0, c)) * 255) for c in kleur)
        if len(kleur) == 1:
            g = int(max(0.0, min(1.0, kleur[0])) * 255)
            return (g, g, g)
    except TypeError:
        return None
    return None


#: hoeveel echte lijnen en curven een pagina minstens moet hebben om als
#: vectorplan te tellen. Rechthoeken tellen niet mee: een tekstverwerker
#: zet er een handvol op elke pagina (kaders, tabellen, achtergronden).
MIN_TEKENWERK = 30
#: hoe groot een ingesloten afbeelding minstens moet zijn (deel van de pagina)
#: om als plan in aanmerking te komen, in plaats van als logo of icoontje
MIN_AFBEELDING = 0.06


def pagina_inhoud(pad: str, pagina: int = 0) -> dict:
    """Wat staat er werkelijk op deze pagina?

    Geeft een overzicht met het aantal lijnen/curven, het aantal rechthoeken,
    de ingesloten afbeeldingen (groot genoeg om een plan te kunnen zijn, met
    hun plaats in mm) en de route die daaruit volgt:

    - "vector-pdf": er staat echt tekenwerk op (lijnen en curven)
    - "afbeelding-pdf": geen tekenwerk, wel een of meer afbeeldingen - typisch
      een verslag of offerte waarin plannetjes als schermafbeelding geplakt zijn
    - "scan-pdf": een ingescande pagina (een afbeelding over bijna het hele blad)

    Waarom rechthoeken apart: een Word-verslag heeft paginakaders, tabelranden
    en tekstvakken. Die als "tekenwerk" tellen liet ooit een verslag met twee
    geplakte plannen als vectorplan door, met enkel de kaders als resultaat.
    """
    doc = pymupdf.open(pad)
    try:
        if pagina < 0 or pagina >= doc.page_count:
            raise ValueError(f"Pagina {pagina + 1} bestaat niet - dit document heeft "
                             f"{doc.page_count} pagina('s).")
        page = doc[pagina]
        # oppervlaktes zelf berekenen: Rect.get_area() bestaat niet in elke PyMuPDF-versie
        # (op de verwerkingscomputer gaf dat 'Rect' object has no attribute 'get_area')
        br = page.rect
        blad_opp = max(1e-9, (br.x1 - br.x0) * (br.y1 - br.y0))

        lijnen = rechthoeken = 0
        for d in page.get_drawings():
            for item in d.get("items", []):
                if item[0] in ("l", "c"):
                    lijnen += 1
                elif item[0] in ("re", "qu"):
                    rechthoeken += 1

        afbeeldingen = []
        for info in page.get_image_info(xrefs=True):
            x0, y0, x1, y1 = info["bbox"]
            x0, y0, x1, y1 = max(x0, br.x0), max(y0, br.y0), min(x1, br.x1), min(y1, br.y1)
            if x1 <= x0 or y1 <= y0:
                continue
            vak = pymupdf.Rect(x0, y0, x1, y1)
            deel = (x1 - x0) * (y1 - y0) / blad_opp
            if deel < MIN_AFBEELDING:
                continue
            afbeeldingen.append({
                "vak": (vak.x0, vak.y0, vak.x1, vak.y1),
                "deel": deel,
                "breedte_px": info.get("width", 0),
                "hoogte_px": info.get("height", 0),
                "xref": info.get("xref", 0),
            })
        # van boven naar onder, dan van links naar rechts - zoals je leest
        afbeeldingen.sort(key=lambda a: (round(a["vak"][1] / 20), a["vak"][0]))

        grootste = max((a["deel"] for a in afbeeldingen), default=0.0)
        if lijnen >= MIN_TEKENWERK:
            route = "vector-pdf"
        elif grootste > 0.55 and len(afbeeldingen) == 1:
            route = "scan-pdf"
        elif afbeeldingen:
            route = "afbeelding-pdf"
        elif lijnen + rechthoeken >= 6:
            route = "vector-pdf"            # eenvoudig vectorplan zonder afbeeldingen
        else:
            route = "scan-pdf"              # leeg of onbekend: rasterweg probeert nog iets

        return {
            "route": route,
            "lijnen": lijnen,
            "rechthoeken": rechthoeken,
            "afbeeldingen": afbeeldingen,
            "breedte_mm": page.rect.width * PT_TO_MM,
            "hoogte_mm": page.rect.height * PT_TO_MM,
        }
    finally:
        doc.close()


def is_vector_pdf(pad: str, pagina: int = 0) -> bool:
    """Bevat de pagina echt tekenwerk? (Behouden voor bestaande aanroepen.)"""
    return pagina_inhoud(pad, pagina)["route"] == "vector-pdf"


def render_afbeelding(pad: str, pagina: int, vak, min_dpi: int = 300):
    """Haal een ingesloten afbeelding van de pagina, minstens op haar eigen resolutie.

    Er wordt niet het losse beeldbestand uitgelezen maar het stuk pagina waar
    het beeld staat: dan klopt de oriëntatie en uitsnede zoals ze op de pagina
    staan, en komt wat erover getekend is (rode lijnen, aanduidingen) mee.

    Geeft (afbeelding BGR, pixels per millimeter op de pagina).
    """
    import numpy as np
    import cv2

    doc = pymupdf.open(pad)
    try:
        page = doc[pagina]
        rechthoek = pymupdf.Rect(*vak)
        # eigen resolutie van het beeld, maar nooit grover dan min_dpi: kleine
        # schermafbeeldingen hebben 1 pixel dunne lijnen, en uitdunnen en
        # tekst lezen gaan beter op een iets groter beeld
        dpi = int(min(1200, max(min_dpi, _eigen_dpi(page, rechthoek))))
        pix = page.get_pixmap(dpi=dpi, clip=rechthoek, alpha=False)
        arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
        if pix.n == 3:
            arr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
        elif pix.n == 4:
            arr = cv2.cvtColor(arr, cv2.COLOR_RGBA2BGR)
        else:
            arr = cv2.cvtColor(arr, cv2.COLOR_GRAY2BGR)
        return arr.copy(), dpi / 25.4
    finally:
        doc.close()


def _eigen_dpi(page, rechthoek) -> float:
    """De resolutie waarop een ingesloten beeld op de pagina staat."""
    beste = 0.0
    for info in page.get_image_info():
        vak = pymupdf.Rect(info["bbox"])
        if not vak.intersects(rechthoek):
            continue
        breedte_inch = max(1e-6, vak.width / 72.0)
        beste = max(beste, info.get("width", 0) / breedte_inch)
    return beste or 300.0


def pagina_info(pad: str) -> List[dict]:
    doc = pymupdf.open(pad)
    try:
        info = []
        for i, page in enumerate(doc):
            r = page.rect
            tek = page.get_drawings()
            items = sum(len(d.get("items", [])) for d in tek)
            info.append({
                "nummer": i,
                "breedte_mm": r.width * PT_TO_MM,
                "hoogte_mm": r.height * PT_TO_MM,
                "vector_items": items,
                "tekst_lengte": len(page.get_text("text") or ""),
                "afbeeldingen": len(page.get_images(full=True)),
            })
        return info
    finally:
        doc.close()


def lees_vector_pdf(pad: str, pagina: int = 0, met_tekst: bool = True,
                    min_lengte_mm: float = 0.15) -> Tekening:
    """Lees een vector-PDF-pagina in als Tekening in papier-mm."""
    doc = pymupdf.open(pad)
    try:
        page = doc[pagina]
        rect = page.rect
        h_pt = rect.height
        x0_pt, y0_pt = rect.x0, rect.y0

        def naar_mm(p):
            # PDF: y naar beneden vanaf bovenkant -> CAD: y naar boven vanaf onderkant
            x = (p[0] - x0_pt) * PT_TO_MM
            y = (h_pt - (p[1] - y0_pt)) * PT_TO_MM
            return (x, y)

        tekening = Tekening(
            blad_breedte_mm=rect.width * PT_TO_MM,
            blad_hoogte_mm=h_pt * PT_TO_MM,
            bron=pad,
            herkomst="vector-pdf",
        )

        gekleurde_vlakken = _VlakkenRooster()
        zichtbaar = _ZichtbareKleur(page)
        for d in page.get_drawings():
            soort = d.get("type", "s")
            vulkleur = _kleur_naar_rgb(d.get("fill")) if soort in ("f", "fs") else None
            lijnkleur = _kleur_naar_rgb(d.get("color")) if soort in ("s", "fs") else None
            dikte = float(d.get("width") or 0.0) * PT_TO_MM
            gesloten_hint = bool(d.get("closePath"))
            deelpaden = _deelpaden(d.get("items", []), naar_mm)

            # Een vlak met vulling wordt een vlak, geen kader.
            # Witte vlakken zijn het lastige geval. Vaak dekken ze een eerder
            # getekend gekleurd vlak af - de treden van een trap die uit een
            # grijs kleurverloop gespaard worden. Die moeten blijven, anders
            # ligt het verloop eronder bloot als een zwart blok. Maar een wit
            # vlak dat niets gekleurds afdekt (een kamerachtergrond) heeft in
            # CAD geen zin en valt weg.
            randen = [punten for punten, _ in deelpaden if len(punten) >= 3]
            if vulkleur == (0, 0, 0) and randen:
                # Een vlak met een patroon (textuur, verloop) als verf meldt de
                # PDF-bibliotheek als zwart. Wat echt zichtbaar is, staat op de
                # gerenderde pagina: daar de kleur afnemen. Een echt zwarte
                # muur blijft daarbij gewoon zwart.
                vulkleur = zichtbaar.kleur(randen) or vulkleur
            houden = vulkleur is not None and bool(randen)
            if houden and _bijna_wit(vulkleur):
                houden = gekleurde_vlakken.raakt(_omkadering(randen))
            if houden and not _bijna_wit(vulkleur):
                gekleurde_vlakken.voeg_toe(_omkadering(randen))
            if houden:
                if randen:
                    # alle randen samen: een vorm, met de binnenste als gaten
                    tekening.polylijnen.append(Polylijn(
                        punten=randen[0], gesloten=True, laag="PLAN_VULLING",
                        kleur=vulkleur, vulling=True, extra_paden=randen[1:]))

            if soort in ("s", "fs"):
                for nr, (punten, gesloten) in enumerate(deelpaden):
                    # "closePath" slaat in PDF op het laatste deelpad, niet op alle
                    sluiten = gesloten or (gesloten_hint and nr == len(deelpaden) - 1
                                           and len(punten) > 2)
                    pl = Polylijn(punten=punten, gesloten=sluiten,
                                  laag="PLAN_LIJNEN", lijndikte_mm=dikte, kleur=lijnkleur)
                    if len(punten) >= 2 and pl.lengte() >= min_lengte_mm:
                        tekening.polylijnen.append(pl)

        _verdeel_lijnlagen(tekening)

        if met_tekst:
            tekening.teksten = _lees_tekst(page, naar_mm)

        return tekening
    finally:
        doc.close()


def _deelpaden(items, naar_mm):
    """Zet de tekenopdrachten van een PDF-object om naar losse deelpaden.

    Opeenvolgende lijnstukken en curven die op elkaar aansluiten worden een
    pad; rechthoeken en vierhoeken zijn telkens een gesloten pad op zich.
    Geeft [(punten, gesloten), ...].
    """
    paden = []
    huidig: List = []

    def spoel():
        nonlocal huidig
        if len(huidig) >= 2:
            gesloten = len(huidig) > 3 and _dichtbij(huidig[0], huidig[-1])
            paden.append((huidig[:-1] if gesloten else huidig, gesloten))
        huidig = []

    for item in items:
        kop = item[0]
        if kop == "l":
            p1, p2 = naar_mm(item[1]), naar_mm(item[2])
            if huidig and _dichtbij(huidig[-1], p1):
                huidig.append(p2)
            else:
                spoel()
                huidig = [p1, p2]
        elif kop == "c":
            p0, p1, p2, p3 = [naar_mm(item[i]) for i in range(1, 5)]
            stukken = _bezier(p0, p1, p2, p3, _bezier_stappen(p0, p3))
            if huidig and _dichtbij(huidig[-1], p0):
                huidig.extend(stukken)
            else:
                spoel()
                huidig = [p0] + stukken
        elif kop == "re":
            spoel()
            r = item[1]
            paden.append(([naar_mm((r.x0, r.y0)), naar_mm((r.x1, r.y0)),
                           naar_mm((r.x1, r.y1)), naar_mm((r.x0, r.y1))], True))
        elif kop == "qu":
            spoel()
            q = item[1]
            paden.append(([naar_mm((q.ul.x, q.ul.y)), naar_mm((q.ur.x, q.ur.y)),
                           naar_mm((q.lr.x, q.lr.y)), naar_mm((q.ll.x, q.ll.y))], True))
    spoel()
    return paden


def _bijna_wit(rgb) -> bool:
    return min(rgb) >= 245


def _omkadering(randen):
    xs = [x for rand in randen for x, _ in rand]
    ys = [y for rand in randen for _, y in rand]
    return (min(xs), min(ys), max(xs), max(ys))


class _ZichtbareKleur:
    """De kleur die een vlak op de gerenderde pagina werkelijk heeft."""

    def __init__(self, page, dpi: int = 72):
        self.page = page
        self.dpi = dpi
        self.beeld = None
        self.hoogte_mm = page.rect.height * PT_TO_MM

    def _laad(self):
        import numpy as np
        pix = self.page.get_pixmap(dpi=self.dpi, alpha=False)
        self.beeld = np.frombuffer(pix.samples, dtype=np.uint8).reshape(
            pix.height, pix.width, pix.n)[:, :, :3].copy()

    def kleur(self, randen):
        import cv2
        import numpy as np
        if self.beeld is None:
            self._laad()
        s = self.dpi / 25.4
        hoogte, breedte = self.beeld.shape[:2]
        veelhoeken = [np.array([[x * s, (self.hoogte_mm - y) * s] for x, y in rand], np.int32)
                      for rand in randen]
        masker = np.zeros((hoogte, breedte), np.uint8)
        cv2.fillPoly(masker, veelhoeken, 255)
        # randpixels niet meetellen: daar liggen de omlijning en de buren
        masker = cv2.erode(masker, np.ones((3, 3), np.uint8))
        pixels = self.beeld[masker > 0]
        if len(pixels) < 4:
            return None
        r, g, b = (int(v) for v in np.median(pixels, axis=0))
        return (r, g, b)


class _VlakkenRooster:
    """Onthoudt waar al gekleurde vlakken liggen, om snel overlap te toetsen."""

    def __init__(self, cel_mm: float = 20.0):
        self.cel = cel_mm
        self.cellen: dict = {}

    def _cellen(self, kader):
        x0, y0, x1, y1 = kader
        for cx in range(int(x0 // self.cel), int(x1 // self.cel) + 1):
            for cy in range(int(y0 // self.cel), int(y1 // self.cel) + 1):
                yield (cx, cy)

    def voeg_toe(self, kader):
        for sleutel in self._cellen(kader):
            self.cellen.setdefault(sleutel, []).append(kader)

    def raakt(self, kader) -> bool:
        x0, y0, x1, y1 = kader
        for sleutel in self._cellen(kader):
            for a0, b0, a1, b1 in self.cellen.get(sleutel, ()):
                if a0 < x1 and x0 < a1 and b0 < y1 and y0 < b1:
                    return True
        return False


#: herkenbare pennen krijgen een leesbare laagnaam in plaats van een kleurcode
_KLEURNAMEN = {
    "ROOD": (255, 0, 0), "BLAUW": (0, 0, 255), "GROEN": (0, 160, 0),
    "GEEL": (255, 220, 0), "ORANJE": (255, 140, 0), "MAGENTA": (255, 0, 255),
    "CYAAN": (0, 200, 255), "BRUIN": (140, 80, 30),
}
#: meer verschillende lijnkleuren dan dit: dan geen laag per kleur, maar een
#: laag met de kleur per object. Een export met honderden grijstinten zou
#: anders honderden lagen geven.
MAX_KLEURLAGEN = 12


def _kleurnaam(rgb) -> str:
    r, g, b = rgb
    if max(rgb) - min(rgb) < 30:                       # grijswaarde
        return "" if max(rgb) < 90 else ("GRIJS" if max(rgb) < 200 else "LICHTGRIJS")
    beste, afstand = None, None
    for naam, (rr, gg, bb) in _KLEURNAMEN.items():
        a = (r - rr) ** 2 + (g - gg) ** 2 + (b - bb) ** 2
        if afstand is None or a < afstand:
            beste, afstand = naam, a
    if afstand is not None and afstand < 90 ** 2:
        return beste
    return f"{r:02X}{g:02X}{b:02X}"


def _verdeel_lijnlagen(tekening: Tekening):
    """Zet lijnen op een laag per pen - zolang dat overzichtelijk blijft.

    Een CAD-export gebruikt doorgaans een handvol penkleuren (zwart, blauw voor
    maten, rood voor aanduidingen): dan krijgt elke kleur een eigen laag die je
    in Vectorworks apart kan aan- of uitzetten. Zijn het er meer, dan gaat
    alles op een laag en houdt elk object gewoon zijn eigen kleur.
    """
    lijnen = [pl for pl in tekening.polylijnen if not pl.vulling]
    namen = {}
    for pl in lijnen:
        if pl.kleur is not None:
            namen.setdefault(pl.kleur, _kleurnaam(pl.kleur))
    verschillend = set(namen.values())
    if len(verschillend) > MAX_KLEURLAGEN:
        for pl in lijnen:
            pl.laag = "PLAN_LIJNEN"
        tekening.notities.append(
            f"{len(verschillend)} verschillende lijnkleuren - alles op laag PLAN_LIJNEN, "
            "elk object behoudt zijn kleur")
        return
    for pl in lijnen:
        naam = namen.get(pl.kleur, "") if pl.kleur is not None else ""
        pl.laag = f"PLAN_LIJNEN_{naam}" if naam else "PLAN_LIJNEN"


def _dichtbij(a, b, tol: float = 0.01) -> bool:
    return abs(a[0] - b[0]) < tol and abs(a[1] - b[1]) < tol


def _lees_tekst(page, naar_mm) -> List[Tekst]:
    resultaat: List[Tekst] = []
    data = page.get_text("dict")
    for blok in data.get("blocks", []):
        if blok.get("type") != 0:
            continue
        for regel in blok.get("lines", []):
            richting = regel.get("dir", (1.0, 0.0))
            hoek = math.degrees(math.atan2(-richting[1], richting[0]))
            for span in regel.get("spans", []):
                tekst = (span.get("text") or "").strip()
                if not tekst:
                    continue
                bbox = span.get("bbox")
                grootte_mm = float(span.get("size", 0)) * PT_TO_MM
                # Het ankerpunt is waar de tekst begint, gezien vanuit de
                # leesrichting. Voor liggende tekst is dat de linkeronderhoek;
                # voor staande tekst (die van onder naar boven leest) is dat de
                # RECHTERonderhoek, want vandaar strekt de letterhoogte zich
                # naar links uit. Met de linkerhoek komt het berekende midden
                # een volle tekstbreedte naast de maatlijn te liggen.
                if abs(hoek) < 45 or abs(hoek) > 135:
                    pos = naar_mm((bbox[0], bbox[3]))
                    breedte = (bbox[2] - bbox[0]) * PT_TO_MM
                else:
                    pos = naar_mm((bbox[2], bbox[3]))
                    breedte = (bbox[3] - bbox[1]) * PT_TO_MM
                resultaat.append(Tekst(
                    inhoud=tekst,
                    positie=pos,
                    hoogte_mm=max(0.5, grootte_mm * 0.72),
                    hoek_graden=round(hoek, 2),
                    breedte_mm=breedte,
                ))
    return resultaat
