"""Scans en foto's omzetten naar vectoren.

De weg is: rechttrekken -> ontschuinen -> zwart/wit -> lijnen uitdunnen tot
1 pixel -> rechte stukken detecteren -> samenvoegen en haaks zetten.
"""

from __future__ import annotations

import bisect
import math
import re
from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

import cv2
import numpy as np

from .model import Polylijn, Tekening, Tekst
from .units import PAPIERFORMATEN


# ---------------------------------------------------------------- inlezen

def render_pdf_pagina(pad: str, pagina: int = 0, dpi: int = 300) -> Tuple[np.ndarray, float]:
    """Render een PDF-pagina naar een afbeelding. Geeft (afbeelding, px per mm)."""
    import pymupdf
    doc = pymupdf.open(pad)
    try:
        page = doc[pagina]
        zoom = dpi / 72.0
        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
        arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
        if pix.n == 4:
            arr = cv2.cvtColor(arr, cv2.COLOR_RGBA2BGR)
        elif pix.n == 3:
            arr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
        else:
            arr = cv2.cvtColor(arr, cv2.COLOR_GRAY2BGR)
        return arr.copy(), dpi / 25.4
    finally:
        doc.close()


def laad_afbeelding(pad: str) -> np.ndarray:
    data = np.fromfile(pad, dtype=np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"Kan de afbeelding niet lezen: {pad}")
    return img


# ---------------------------------------------------------------- rechttrekken

def _orden_hoeken(pts: np.ndarray) -> np.ndarray:
    pts = pts.reshape(4, 2).astype(np.float32)
    som = pts.sum(axis=1)
    verschil = np.diff(pts, axis=1).ravel()
    return np.array([
        pts[np.argmin(som)],       # linksboven
        pts[np.argmin(verschil)],  # rechtsboven
        pts[np.argmax(som)],       # rechtsonder
        pts[np.argmax(verschil)],  # linksonder
    ], dtype=np.float32)


def vind_bladhoeken(img: np.ndarray, min_oppervlakte_deel: float = 0.25) -> Optional[np.ndarray]:
    """Zoek de vier hoeken van het blad in een foto."""
    h, w = img.shape[:2]
    schaal = 1200.0 / max(h, w)
    klein = cv2.resize(img, None, fx=min(1.0, schaal), fy=min(1.0, schaal)) if schaal < 1 else img
    factor = img.shape[1] / klein.shape[1]

    grijs = cv2.cvtColor(klein, cv2.COLOR_BGR2GRAY)
    grijs = cv2.GaussianBlur(grijs, (5, 5), 0)
    randen = cv2.Canny(grijs, 40, 120)
    randen = cv2.dilate(randen, np.ones((5, 5), np.uint8), iterations=1)

    contouren, _ = cv2.findContours(randen, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contouren:
        return None
    beeld_opp = klein.shape[0] * klein.shape[1]
    for cnt in sorted(contouren, key=cv2.contourArea, reverse=True)[:8]:
        opp = cv2.contourArea(cnt)
        if opp < beeld_opp * min_oppervlakte_deel:
            break
        omtrek = cv2.arcLength(cnt, True)
        benadering = cv2.approxPolyDP(cnt, 0.02 * omtrek, True)
        if len(benadering) == 4 and cv2.isContourConvex(benadering):
            return _orden_hoeken(benadering.astype(np.float32) * factor)
    return None


def _vluchtpunt(segmenten: Sequence["Segment"]) -> Optional[np.ndarray]:
    """Het punt waar een bundel evenwijdige lijnen elkaar snijdt op de foto.

    Op een rechte foto snijden ze elkaar nergens (het punt ligt oneindig ver);
    hoe schuiner de camera stond, hoe dichterbij dat punt komt te liggen.
    """
    rijen = []
    for s in segmenten:
        p1 = np.array([s.x1, s.y1, 1.0])
        p2 = np.array([s.x2, s.y2, 1.0])
        lijn = np.cross(p1, p2)
        norm = np.linalg.norm(lijn[:2])
        if norm < 1e-9:
            continue
        # lange lijnen zijn betrouwbaarder dan korte
        rijen.append(lijn / norm * s.lengte)
    if len(rijen) < 4:
        return None
    _, _, vt = np.linalg.svd(np.array(rijen))
    return vt[-1]


def _families(segmenten: Sequence["Segment"], min_lengte: float,
              spreiding: float = 28.0):
    """Splits de lijnen in twee bundels die haaks op elkaar horen te staan."""
    lang = [s for s in segmenten if s.lengte >= min_lengte]
    if len(lang) < 12:
        return None, None

    histogram = np.zeros(180)
    for s in lang:
        histogram[int(s.hoek) % 180] += s.lengte
    histogram = np.convolve(np.r_[histogram, histogram, histogram],
                            np.ones(7) / 7, mode="same")[180:360]
    piek = float(np.argmax(histogram))

    def dichtbij(hoek, doel):
        d = abs((hoek - doel) % 180.0)
        return min(d, 180.0 - d) <= spreiding

    familie_a = [s for s in lang if dichtbij(s.hoek, piek)]
    familie_b = [s for s in lang if dichtbij(s.hoek, piek + 90.0)]
    if len(familie_a) < 6 or len(familie_b) < 6:
        return None, None

    # de bundel die het dichtst bij horizontaal ligt, wordt de x-as
    def hoe_horizontaal(familie):
        hoek = np.median([s.hoek for s in familie]) % 180.0
        return min(hoek, 180.0 - hoek)

    if hoe_horizontaal(familie_a) <= hoe_horizontaal(familie_b):
        return familie_a, familie_b
    return familie_b, familie_a


def _spreiding(familie: Sequence["Segment"]) -> float:
    """Hoe sterk waaieren de lijnen van een bundel uit? (in graden)"""
    som = 0j
    gewicht = 0.0
    for s in familie:
        som += s.lengte * complex(math.cos(math.radians(2 * s.hoek)),
                                  math.sin(math.radians(2 * s.hoek)))
        gewicht += s.lengte
    if gewicht == 0:
        return 0.0
    r = abs(som) / gewicht
    r = min(1.0 - 1e-12, max(1e-12, r))
    return math.degrees(math.sqrt(-2.0 * math.log(r))) / 2.0


def _transformeer(segmenten: Sequence["Segment"], matrix: np.ndarray) -> List["Segment"]:
    punten = np.array([[s.x1, s.y1, 1.0] for s in segmenten] +
                      [[s.x2, s.y2, 1.0] for s in segmenten], float).T
    beeld = matrix @ punten
    beeld = beeld[:2] / np.where(np.abs(beeld[2]) < 1e-12, 1e-12, beeld[2])
    n = len(segmenten)
    return [Segment(float(beeld[0, i]), float(beeld[1, i]),
                    float(beeld[0, i + n]), float(beeld[1, i + n])) for i in range(n)]


def schat_rechtzetting(segmenten: Sequence["Segment"], breedte: int, hoogte: int,
                       min_lengte: float = 120.0):
    """Bereken de perspectiefcorrectie uit het lijnwerk zelf.

    Werkt zonder bladrand: een bouwplan zit vol lijnen die in werkelijkheid
    evenwijdig en haaks lopen, en dat is genoeg om de stand van de camera terug
    te rekenen.

    Geeft (matrix, toelichting) of (None, reden).
    """
    horizontaal, verticaal = _families(segmenten, min_lengte)
    if horizontaal is None:
        return None, "te weinig lange rechte lijnen om op te sturen"

    vp_h = _vluchtpunt(horizontaal)
    vp_v = _vluchtpunt(verticaal)
    if vp_h is None or vp_v is None:
        return None, "vluchtpunten niet te bepalen"

    # de horizon: de lijn door beide vluchtpunten
    horizon = np.cross(vp_h, vp_v)
    if abs(horizon[2]) < 1e-12:
        return None, "horizon niet te bepalen"
    horizon = horizon / horizon[2]

    # stap 1: de horizon terugduwen naar het oneindige, zodat evenwijdige
    # lijnen weer evenwijdig lopen
    h_affien = np.array([[1.0, 0.0, 0.0],
                         [0.0, 1.0, 0.0],
                         [horizon[0], horizon[1], 1.0]])

    # stap 2: de twee richtingen haaks op elkaar en op de assen zetten
    rh = h_affien @ vp_h
    rv = h_affien @ vp_v
    if abs(rh[2]) > 1e-6 * max(1.0, np.linalg.norm(rh[:2])):
        rh = rh / rh[2] if abs(rh[2]) > 1e-12 else rh
    dh = rh[:2] / (np.linalg.norm(rh[:2]) or 1.0)
    dv = rv[:2] / (np.linalg.norm(rv[:2]) or 1.0)
    basis = np.column_stack([dh, dv])
    if abs(np.linalg.det(basis)) < 1e-6:
        return None, "de twee richtingen vallen samen"
    if np.linalg.det(basis) < 0:
        dv = -dv
        basis = np.column_stack([dh, dv])
    m = np.linalg.inv(basis)
    h_metrisch = np.array([[m[0, 0], m[0, 1], 0.0],
                           [m[1, 0], m[1, 1], 0.0],
                           [0.0, 0.0, 1.0]])

    h = h_metrisch @ h_affien

    # stap 3: terugschalen en verschuiven zodat het beeld even groot blijft
    # en volledig binnen het kader valt
    hoekpunten = np.array([[0, 0, 1], [breedte, 0, 1],
                           [breedte, hoogte, 1], [0, hoogte, 1]], float).T
    beeld = h @ hoekpunten
    if np.any(np.abs(beeld[2]) < 1e-12):
        return None, "correctie klapt het beeld om"
    beeld = beeld[:2] / beeld[2]
    b_breedte = beeld[0].max() - beeld[0].min()
    b_hoogte = beeld[1].max() - beeld[1].min()
    if b_breedte <= 0 or b_hoogte <= 0:
        return None, "correctie geeft een leeg beeld"

    factor = math.sqrt((breedte * hoogte) / (b_breedte * b_hoogte))
    if not (0.2 < factor < 5.0):
        return None, "correctie is onwaarschijnlijk sterk"
    s = np.array([[factor, 0, -factor * beeld[0].min()],
                  [0, factor, -factor * beeld[1].min()],
                  [0, 0, 1.0]])
    h = s @ h

    return h, f"perspectief uit het lijnwerk gehaald ({len(horizontaal)} horizontale en {len(verticaal)} verticale lijnen)"


def rectificeer_op_lijnwerk(img: np.ndarray, max_zijde: int = 1800):
    """Trek een foto recht op basis van het lijnwerk, zonder bladrand."""
    hoogte, breedte = img.shape[:2]
    krimp = min(1.0, max_zijde / max(hoogte, breedte))
    klein = cv2.resize(img, None, fx=krimp, fy=krimp, interpolation=cv2.INTER_AREA) if krimp < 1 else img

    ppm_klein = (300 / 25.4) * krimp
    masker = binariseer(klein)
    lijnmasker, _ = scheid_tekst_van_lijnen(masker, max(8, int(round(4.5 * ppm_klein))))
    segmenten = voeg_samen(detecteer_segmenten(lijnmasker, ppm_klein), px_per_mm=ppm_klein)

    # terugrekenen naar de volledige resolutie
    if krimp < 1:
        segmenten = [Segment(s.x1 / krimp, s.y1 / krimp, s.x2 / krimp, s.y2 / krimp)
                     for s in segmenten]

    min_lengte = max(60.0, 0.05 * max(breedte, hoogte))
    matrix, toelichting = schat_rechtzetting(segmenten, breedte, hoogte, min_lengte)
    if matrix is None:
        return img, False, toelichting

    # nakijken of de correctie de zaak echt verbetert. Een foto die al recht
    # genomen is, heeft er niets aan; dan enkel maar onscherper maken.
    horizontaal, verticaal = _families(segmenten, min_lengte)
    if horizontaal is None:
        return img, False, "te weinig lange lijnen om de correctie te toetsen"
    voor = max(_spreiding(horizontaal), _spreiding(verticaal))
    na = max(_spreiding(_transformeer(horizontaal, matrix)),
             _spreiding(_transformeer(verticaal, matrix)))
    if na > voor * 0.8:
        return img, False, (f"foto stond al vlak genoeg (spreiding {voor:.2f} graden, "
                            f"correctie zou er {na:.2f} van maken)")

    recht = cv2.warpPerspective(img, matrix, (breedte, hoogte),
                                flags=cv2.INTER_CUBIC, borderValue=(255, 255, 255))
    return recht, True, f"{toelichting}: lijnen lopen van {voor:.2f} naar {na:.2f} graden spreiding"


def _vouwprofiel(lijnmasker: np.ndarray, verticaal: bool = False,
                 min_bedekking: float = 0.18,
                 max_kromming: float = 0.025):
    """Meet het vouwpatroon aan lijnen die recht horen te lopen.

    In een bouwplan raakt alles alles: maatlijnen hangen aan hulplijnen, die aan
    muren. Losse vormen tellen levert dan een handvol reuzenklodders op. Daarom
    eerst een filter dat alles wegneemt wat niet in deze richting loopt - wat
    overblijft zijn de lange strepen zelf, netjes los van elkaar.

    Van elke streep wordt bijgehouden waar hij loopt; het vouwpatroon zelf komt
    er daarna uit door alle strepen samen op te lossen.
    """
    masker = lijnmasker.T if verticaal else lijnmasker
    hoogte, breedte = masker.shape[:2]

    lengte_kern = max(15, breedte // 60)
    kern = cv2.getStructuringElement(cv2.MORPH_RECT, (lengte_kern, 1))
    langs = cv2.morphologyEx(masker, cv2.MORPH_OPEN, kern)

    aantal, labels, stats, _ = cv2.connectedComponentsWithStats(langs, 8)
    waarnemingen = []

    for i in range(1, aantal):
        x, y, w, h, _ = stats[i]
        if w < min_bedekking * breedte:
            continue
        if h > max(24, 0.03 * hoogte):
            continue
        deel = labels[y:y + h, x:x + w] == i
        rijen, kolommen = np.nonzero(deel)
        if kolommen.size == 0:
            continue
        opgeteld = np.bincount(kolommen, weights=rijen, minlength=w)
        geteld = np.bincount(kolommen, minlength=w)
        geldig = geteld > 0
        if geldig.sum() < w * 0.6:
            continue
        xs = np.nonzero(geldig)[0].astype(float)
        ys = opgeteld[geldig] / geteld[geldig] + y

        helling, snijpunt = np.polyfit(xs, ys, 1)
        rest = ys - (helling * xs + snijpunt)
        if np.abs(rest).max() > max_kromming * breedte:
            continue        # deze lijn is in de tekening zelf al gebogen
        stap = max(1, len(xs) // 400)      # niet elke pixelkolom is nodig
        waarnemingen.append((xs[::stap] + x, ys[::stap]))

    if len(waarnemingen) < 3:
        return None, len(waarnemingen)

    verschuiving = _pas_vouw(waarnemingen, breedte)
    if verschuiving is None:
        return None, len(waarnemingen)
    return verschuiving.astype(np.float32), len(waarnemingen)


def _pas_vouw(waarnemingen, breedte: int, knopen: int = 16, gladheid: float = 40.0):
    """Zoek het vouwpatroon en de rechte lijnen in een keer.

    Elke ijklijn beslaat maar een deel van het blad, en elke lijn heeft zijn
    eigen helling en hoogte. Wie per lijn apart de afwijking meet en die stukken
    daarna aan elkaar plakt, krijgt sprongen op de naden: de stukken zijn immers
    elk ten opzichte van hun eigen rechte gemeten. Daarom worden hier alle
    lijnen en het vouwpatroon samen opgelost, zodat er een doorlopend patroon
    over de volle breedte uitkomt.
    """
    knooppunten = np.linspace(0, breedte - 1, knopen)
    aantal_lijnen = len(waarnemingen)
    rijen = sum(len(xs) for xs, _ in waarnemingen)
    kolommen = 2 * aantal_lijnen + knopen

    a = np.zeros((rijen + knopen - 2, kolommen))
    b = np.zeros(rijen + knopen - 2)

    rij = 0
    for i, (xs, ys) in enumerate(waarnemingen):
        n = len(xs)
        # eigen rechte van deze lijn: helling en hoogte
        a[rij:rij + n, 2 * i] = xs
        a[rij:rij + n, 2 * i + 1] = 1.0
        # gedeeld vouwpatroon, lineair tussen de knooppunten
        index = np.clip(np.searchsorted(knooppunten, xs) - 1, 0, knopen - 2)
        deel = (xs - knooppunten[index]) / (knooppunten[index + 1] - knooppunten[index])
        a[rij + np.arange(n), 2 * aantal_lijnen + index] = 1.0 - deel
        a[rij + np.arange(n), 2 * aantal_lijnen + index + 1] = deel
        b[rij:rij + n] = ys
        rij += n

    # het patroon moet vloeiend zijn, geen zaagtand waar weinig lijnen liggen
    for k in range(knopen - 2):
        a[rij + k, 2 * aantal_lijnen + k] = gladheid
        a[rij + k, 2 * aantal_lijnen + k + 1] = -2.0 * gladheid
        a[rij + k, 2 * aantal_lijnen + k + 2] = gladheid

    oplossing, *_ = np.linalg.lstsq(a, b, rcond=None)
    knoopwaarden = oplossing[2 * aantal_lijnen:]

    verschuiving = np.interp(np.arange(breedte), knooppunten, knoopwaarden)
    # de rechte helling eruit halen: dat is gewone scheefstand, geen vouw,
    # en die wordt later apart en nauwkeuriger rechtgezet
    xs = np.arange(breedte, dtype=float)
    helling, snijpunt = np.polyfit(xs, verschuiving, 1)
    return verschuiving - (helling * xs + snijpunt)


def ontvouw(img: np.ndarray, px_per_mm: float = 300 / 25.4):
    """Strijk een gevouwen of gekruld blad plat.

    De vouw wordt niet in de foto gezocht maar in de gevolgen ervan: lijnen die
    recht horen te lopen en dat niet doen.
    """
    grijs_masker = binariseer(img)
    lijnmasker, _ = scheid_tekst_van_lijnen(grijs_masker, max(12, int(round(4.5 * px_per_mm))))

    verschuiving_y, n_h = _vouwprofiel(lijnmasker, verticaal=False)
    verschuiving_x, n_v = _vouwprofiel(lijnmasker, verticaal=True)

    if verschuiving_y is None and verschuiving_x is None:
        return img, False, f"geen lange rechte lijnen gevonden om op te ijken ({n_h} + {n_v})"

    hoogte, breedte = img.shape[:2]
    amplitude = 0.0
    kaart_x, kaart_y = np.meshgrid(np.arange(breedte, dtype=np.float32),
                                   np.arange(hoogte, dtype=np.float32))
    if verschuiving_y is not None:
        kaart_y = kaart_y + verschuiving_y[None, :].astype(np.float32)
        amplitude = max(amplitude, float(np.ptp(verschuiving_y)))
    if verschuiving_x is not None:
        kaart_x = kaart_x + verschuiving_x[:, None].astype(np.float32)
        amplitude = max(amplitude, float(np.ptp(verschuiving_x)))

    if amplitude < 1.0 * px_per_mm:
        return img, False, (f"blad lag vlak genoeg (doorbuiging "
                            f"{amplitude / px_per_mm:.1f} mm)")

    recht = cv2.remap(img, kaart_x, kaart_y, interpolation=cv2.INTER_CUBIC,
                      borderMode=cv2.BORDER_REPLICATE)
    return recht, True, (f"vouw uitgestreken met {n_h} horizontale en {n_v} verticale "
                         f"ijklijnen (doorbuiging was {amplitude / px_per_mm:.1f} mm)")


def trek_recht(img: np.ndarray,
               hoeken: Optional[np.ndarray] = None,
               papierformaat: Optional[str] = None,
               doel_px_per_mm: float = 300 / 25.4):
    """Corrigeer perspectief. Geeft (afbeelding, px_per_mm of None)."""
    if hoeken is None:
        hoeken = vind_bladhoeken(img)
    if hoeken is None:
        return img, None

    lb, rb, ro, lo = hoeken
    breedte = (np.linalg.norm(rb - lb) + np.linalg.norm(ro - lo)) / 2.0
    hoogte = (np.linalg.norm(lo - lb) + np.linalg.norm(ro - rb)) / 2.0

    px_per_mm = None
    if papierformaat and papierformaat in PAPIERFORMATEN:
        pb, ph = PAPIERFORMATEN[papierformaat]
        if breedte > hoogte:
            pb, ph = ph, pb
        doel_b = int(round(pb * doel_px_per_mm))
        doel_h = int(round(ph * doel_px_per_mm))
        px_per_mm = doel_px_per_mm
    else:
        # papierformaat onbekend: de verhouding wel naar een standaardblad trekken.
        # Dat haalt de scheeftrekking eruit; de echte maat komt dan van de maatlijnen.
        verhouding = breedte / hoogte if hoogte else 1.0
        beste = None
        for pb, ph in PAPIERFORMATEN.values():
            for kandidaat in (pb / ph, ph / pb):
                afwijking = abs(verhouding - kandidaat) / kandidaat
                if afwijking < 0.05 and (beste is None or afwijking < beste[0]):
                    beste = (afwijking, kandidaat)
        if beste:
            oppervlakte = breedte * hoogte
            doel_b = int(round(math.sqrt(oppervlakte * beste[1])))
            doel_h = int(round(math.sqrt(oppervlakte / beste[1])))
        else:
            doel_b = int(round(breedte))
            doel_h = int(round(hoogte))

    doel = np.array([[0, 0], [doel_b - 1, 0], [doel_b - 1, doel_h - 1], [0, doel_h - 1]],
                    dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(hoeken, doel)
    recht = cv2.warpPerspective(img, matrix, (doel_b, doel_h), flags=cv2.INTER_CUBIC)
    return recht, px_per_mm


# ---------------------------------------------------------------- zwart/wit

def binariseer(img: np.ndarray, blokgrootte: int = 41, c: int = 12) -> np.ndarray:
    """Geeft een masker waar lijnen wit (255) zijn."""
    grijs = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    # ongelijke belichting van een foto wegwerken
    achtergrond = cv2.medianBlur(grijs, 31)
    genormaliseerd = cv2.divide(grijs, achtergrond, scale=255)
    blokgrootte = blokgrootte if blokgrootte % 2 == 1 else blokgrootte + 1
    masker = cv2.adaptiveThreshold(genormaliseerd, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                   cv2.THRESH_BINARY_INV, blokgrootte, c)
    masker = cv2.morphologyEx(masker, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    return masker


def scheid_tekst_van_lijnen(masker: np.ndarray,
                            max_teksthoogte_px: int = 60) -> Tuple[np.ndarray, np.ndarray]:
    """Splits kleine losse blobs (letters, cijfers) van de lijnen.

    De beslissing per stukje inkt gebeurt in een opzoektabel over alle labels
    tegelijk. Een lus die per stukje de hele foto afgaat, lijkt onschuldig op een
    eenvoudige tekening, maar een echt plan heeft duizenden losse stukjes en dan
    loopt dat in de miljarden bewerkingen.
    """
    aantal, labels, stats, _ = cv2.connectedComponentsWithStats(masker, 8)
    breedtes = stats[:, cv2.CC_STAT_WIDTH]
    hoogtes = stats[:, cv2.CC_STAT_HEIGHT]
    oppervlaktes = stats[:, cv2.CC_STAT_AREA]

    klein = (hoogtes <= max_teksthoogte_px) & (breedtes <= max_teksthoogte_px * 2)
    gedrongen = np.maximum(breedtes, hoogtes) < max_teksthoogte_px * 1.5
    is_tekst = klein & gedrongen & (oppervlaktes > 8)
    if aantal:
        is_tekst[0] = False                      # label 0 is de achtergrond

    tekstmasker = is_tekst[labels]
    tekst = np.where(tekstmasker, 255, 0).astype(np.uint8)
    lijnen = np.where(~tekstmasker & (masker > 0), 255, 0).astype(np.uint8)
    return lijnen, tekst


# ---------------------------------------------------------------- vectoriseren

@dataclass
class Segment:
    x1: float
    y1: float
    x2: float
    y2: float

    @property
    def lengte(self) -> float:
        return math.hypot(self.x2 - self.x1, self.y2 - self.y1)

    @property
    def hoek(self) -> float:
        return math.degrees(math.atan2(self.y2 - self.y1, self.x2 - self.x1)) % 180.0


_skelet_waarschuwing: List[str] = []


def _skelet(masker: np.ndarray) -> np.ndarray:
    try:
        return cv2.ximgproc.thinning(masker, thinningType=cv2.ximgproc.THINNING_ZHANGSUEN)
    except Exception:
        if not _skelet_waarschuwing:
            _skelet_waarschuwing.append(
                "let op: de uitgebreide OpenCV ontbreekt (opencv-contrib-python), "
                "dus lijnen worden grover uitgedund. Dat geeft dubbele lijnen en "
                "minder nauwkeurige maten bij scans en foto's.")
        # terugval: eenvoudige morfologische uitdunning
        skel = np.zeros_like(masker)
        img = masker.copy()
        element = cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3))
        for _ in range(60):
            geopend = cv2.morphologyEx(img, cv2.MORPH_OPEN, element)
            tijdelijk = cv2.subtract(img, geopend)
            geerodeerd = cv2.erode(img, element)
            skel = cv2.bitwise_or(skel, tijdelijk)
            img = geerodeerd.copy()
            if cv2.countNonZero(img) == 0:
                break
        return skel


def _hough_naar_rijen(lijnen) -> np.ndarray:
    """HoughLinesP geeft (N,1,4) in OpenCV 4 en (N,4) in OpenCV 5.

    Beide vormen worden hier teruggebracht tot rijen van vier getallen, zodat de
    tool werkt met welke versie er ook geinstalleerd staat.
    """
    rijen = np.asarray(lijnen)
    if rijen.size == 0:
        return np.empty((0, 4))
    return rijen.reshape(-1, rijen.shape[-1])[:, :4]


def detecteer_segmenten(masker: np.ndarray,
                        px_per_mm: float = 300 / 25.4,
                        min_lengte_px: Optional[int] = None,
                        max_gat_px: Optional[int] = None) -> List[Segment]:
    """Rechte stukken uit het masker halen.

    De drempels worden uit de resolutie afgeleid, niet vast in pixels gezet:
    een gaatje van een halve millimeter op papier is bij 600 dpi twee keer zoveel
    pixels als bij 300 dpi, en met vaste waarden valt een lijn dan uiteen.
    """
    if min_lengte_px is None:
        min_lengte_px = max(6, int(round(1.5 * px_per_mm)))
    if max_gat_px is None:
        max_gat_px = max(3, int(round(1.0 * px_per_mm)))
    skel = _skelet(masker)
    lijnen = cv2.HoughLinesP(skel, 1, np.pi / 360, threshold=30,
                             minLineLength=min_lengte_px, maxLineGap=max_gat_px)
    if lijnen is None:
        return []
    return [Segment(float(x1), float(y1), float(x2), float(y2))
            for x1, y1, x2, y2 in _hough_naar_rijen(lijnen)]


def dominante_hoek(segmenten: Sequence[Segment], min_lengte: float = 30.0) -> float:
    """Scheefstand bepalen (in graden, -45..45).

    Haaks lijnwerk herhaalt zich elke 90 graden, dus wordt elke hoek eerst maal
    vier genomen; dan vallen 0 en 90 samen en telt een bundel muren als een
    geheel mee. Een gewone piek in een lijstje van 0 tot 90 breekt net op die
    overgang: een muur van 89,5 graden en een van 90,5 belanden dan aan
    weerszijden van de rand en heffen elkaar op, waardoor een duidelijke
    scheefstand van een paar graden onopgemerkt blijft.
    """
    som = 0j
    for s in segmenten:
        if s.lengte < min_lengte:
            continue
        som += s.lengte * complex(math.cos(math.radians(4 * s.hoek)),
                                  math.sin(math.radians(4 * s.hoek)))
    if som == 0:
        return 0.0
    hoek = math.degrees(math.atan2(som.imag, som.real)) / 4.0
    # atan2 geeft -180..180, na deling -45..45
    return hoek


def _roteer(segmenten: Sequence[Segment], graden: float, midden: Tuple[float, float]) -> List[Segment]:
    if abs(graden) < 0.05:
        return list(segmenten)
    r = math.radians(-graden)
    cos_r, sin_r = math.cos(r), math.sin(r)
    cx, cy = midden

    def draai(x, y):
        dx, dy = x - cx, y - cy
        return (cx + dx * cos_r - dy * sin_r, cy + dx * sin_r + dy * cos_r)

    uit = []
    for s in segmenten:
        x1, y1 = draai(s.x1, s.y1)
        x2, y2 = draai(s.x2, s.y2)
        uit.append(Segment(x1, y1, x2, y2))
    return uit


def voeg_samen(segmenten: Sequence[Segment],
               hoek_tolerantie: float = 2.5,
               afstand_tolerantie: float = 3.0,
               gat_tolerantie: float = 8.0,
               px_per_mm: Optional[float] = None) -> List[Segment]:
    """Voeg stukjes van dezelfde lijn samen tot een enkel segment."""
    if px_per_mm:
        afstand_tolerantie = max(2.0, 0.3 * px_per_mm)
        gat_tolerantie = max(4.0, 1.5 * px_per_mm)
    groepen: dict = {}
    for s in segmenten:
        if s.lengte < 3:
            continue
        hoek = s.hoek
        rho = (-math.sin(math.radians(hoek)) * s.x1 + math.cos(math.radians(hoek)) * s.y1)
        sleutel = (int(round(hoek / hoek_tolerantie)), int(round(rho / afstand_tolerantie)))
        groepen.setdefault(sleutel, []).append(s)

    resultaat: List[Segment] = []
    for groep in groepen.values():
        hoek = sum(s.hoek * s.lengte for s in groep) / sum(s.lengte for s in groep)
        r = math.radians(hoek)
        ux, uy = math.cos(r), math.sin(r)
        stukken = []
        for s in groep:
            t1 = s.x1 * ux + s.y1 * uy
            t2 = s.x2 * ux + s.y2 * uy
            n = (-s.x1 * uy + s.y1 * ux + -s.x2 * uy + s.y2 * ux) / 2.0
            stukken.append((min(t1, t2), max(t1, t2), n))
        stukken.sort()
        huidige = list(stukken[0])
        samengevoegd = []
        for begin, eind, n in stukken[1:]:
            if begin <= huidige[1] + gat_tolerantie:
                huidige[1] = max(huidige[1], eind)
                huidige[2] = (huidige[2] + n) / 2.0
            else:
                samengevoegd.append(tuple(huidige))
                huidige = [begin, eind, n]
        samengevoegd.append(tuple(huidige))
        for begin, eind, n in samengevoegd:
            x1 = ux * begin - uy * n
            y1 = uy * begin + ux * n
            x2 = ux * eind - uy * n
            y2 = uy * eind + ux * n
            seg = Segment(x1, y1, x2, y2)
            if seg.lengte >= 4:
                resultaat.append(seg)
    return resultaat


def lijn_uit(segmenten: Sequence[Segment], tolerantie_px: float = 4.0) -> List[Segment]:
    """Zet bijna-gelijke x- of y-waarden van rechte lijnen exact gelijk.

    Dat maakt van "bijna dezelfde muurlijn" ook echt dezelfde lijn, wat later in
    CAD het verschil is tussen netjes doortekenen en overal microsprongetjes.
    """
    verticaal_x, horizontaal_y = [], []
    for s in segmenten:
        if abs(s.x1 - s.x2) < 0.01:
            verticaal_x.append((s.x1, s.lengte))
        if abs(s.y1 - s.y2) < 0.01:
            horizontaal_y.append((s.y1, s.lengte))

    def clusters(waarden):
        if not waarden:
            return []
        waarden = sorted(waarden)
        groepen = [[waarden[0]]]
        for w in waarden[1:]:
            # vergelijken met het BEGIN van de groep, niet met de vorige waarde.
            # Een reeks lijnen die elk net binnen de marge van hun voorganger
            # liggen - arcering, een maatketen, een dunne muur - zou anders als
            # ketting doorschuiven en helemaal op een lijn worden getrokken.
            if w[0] - groepen[-1][0][0] <= tolerantie_px:
                groepen[-1].append(w)
            else:
                groepen.append([w])
        # gewogen gemiddelde: lange lijnen wegen zwaarder
        return [(min(g)[0], max(g)[0], sum(v * l for v, l in g) / sum(l for _, l in g))
                for g in groepen]

    cx, cy = clusters(verticaal_x), clusters(horizontaal_y)
    cx_sleutels = [g[0] for g in cx]
    cy_sleutels = [g[0] for g in cy]

    def trek_naar(waarde, groepen, sleutels):
        # de groepen liggen op volgorde, dus opzoeken kan met een halvering
        # in plaats van de hele lijst af te lopen per segment
        index = bisect.bisect_right(sleutels, waarde + 0.01) - 1
        if 0 <= index < len(groepen):
            laag, hoog, gemiddelde = groepen[index]
            if laag - 0.01 <= waarde <= hoog + 0.01:
                return gemiddelde
        return waarde

    uit = []
    for s in segmenten:
        x1, y1, x2, y2 = s.x1, s.y1, s.x2, s.y2
        if abs(x1 - x2) < 0.01:
            x1 = x2 = trek_naar(x1, cx, cx_sleutels)
        if abs(y1 - y2) < 0.01:
            y1 = y2 = trek_naar(y1, cy, cy_sleutels)
        uit.append(Segment(x1, y1, x2, y2))
    return uit


def _afstand_tot_segment(punt, p1, p2):
    """Afstand van een punt tot een segment, plus waar op het segment dat valt."""
    px, py = punt
    x1, y1 = p1
    x2, y2 = p2
    dx, dy = x2 - x1, y2 - y1
    lengte2 = dx * dx + dy * dy
    if lengte2 == 0:
        return math.hypot(px - x1, py - y1), 0.0
    t = ((px - x1) * dx + (py - y1) * dy) / lengte2
    tc = max(0.0, min(1.0, t))
    return math.hypot(px - (x1 + tc * dx), py - (y1 + tc * dy)), t


def strijk_sprongen(segmenten: Sequence[Segment],
                    max_gat_px: float,
                    max_sprong_px: float,
                    verbind_straal_px: float = 6.0) -> List[Segment]:
    """Haal de knik uit muren die over een vouw in het papier lopen.

    Een vouw laat een muur links en rechts ervan op een iets andere hoogte
    uitkomen: de twee stukken sluiten op elkaar aan, maar met een sprongetje.
    Een muur die in werkelijkheid verspringt, ziet er in eerste instantie net zo
    uit - het verschil is dat daar een dwarsstukje tussen zit dat de twee
    niveaus verbindt. Zit dat er niet, dan komt de sprong van het papier en
    wordt hij weggestreken.
    """
    resultaat = [Segment(s.x1, s.y1, s.x2, s.y2) for s in segmenten]

    for as_naam in ("horizontaal", "verticaal"):
        horizontaal = as_naam == "horizontaal"

        def langs(s):      # coordinaat langs de lijn
            return (s.x1, s.x2) if horizontaal else (s.y1, s.y2)

        def dwars(s):      # de constante coordinaat
            return s.y1 if horizontaal else s.x1

        recht, dwarse = [], []
        for i, s in enumerate(resultaat):
            if horizontaal and abs(s.y1 - s.y2) < 0.01 and abs(s.x1 - s.x2) > 1:
                recht.append(i)
            elif (not horizontaal) and abs(s.x1 - s.x2) < 0.01 and abs(s.y1 - s.y2) > 1:
                recht.append(i)
            elif horizontaal and abs(s.x1 - s.x2) < 0.01:
                dwarse.append(i)
            elif (not horizontaal) and abs(s.y1 - s.y2) < 0.01:
                dwarse.append(i)
        if len(recht) < 2:
            continue

        # rooster van dwarsstukjes, om de verbinding bij een knooppunt te toetsen
        cel = max(8.0, max_gat_px)
        rooster: dict = {}
        for j in dwarse:
            s = resultaat[j]
            for punt in ((s.x1, s.y1), (s.x2, s.y2), ((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2)):
                rooster.setdefault((int(punt[0] // cel), int(punt[1] // cel)), []).append(j)

        def verbonden(x, y, sprong) -> bool:
            cx, cy = int(x // cel), int(y // cel)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for j in rooster.get((cx + dx, cy + dy), ()):
                        s = resultaat[j]
                        lengte = math.hypot(s.x2 - s.x1, s.y2 - s.y1)
                        # het verbindingsstukje van een echte verspringing is
                        # net zo lang als de verspringing zelf - niet korter,
                        # en niet veel langer
                        if not (sprong * 0.6 <= lengte <= sprong * 3.0 + 2.0):
                            continue
                        afstand, t = _afstand_tot_segment((x, y), (s.x1, s.y1), (s.x2, s.y2))
                        if afstand <= verbind_straal_px and -0.3 <= t <= 1.3:
                            return True
            return False

        recht.sort(key=lambda i: min(langs(resultaat[i])))
        ouder = {i: i for i in recht}

        def wortel(i):
            while ouder[i] != i:
                ouder[i] = ouder[ouder[i]]
                i = ouder[i]
            return i

        for pos, i in enumerate(recht):
            si = resultaat[i]
            ai, bi = sorted(langs(si))
            # De lijst loopt op beginpunt, dus zodra een kandidaat verder begint
            # dan het einde plus het toegestane gat, kunnen we stoppen. Bij veel
            # lange lijnen over hetzelfde bereik grijpt die stop niet, vandaar
            # ook een harde bovengrens op het aantal buren dat we bekijken.
            for j in recht[pos + 1:pos + 400]:
                sj = resultaat[j]
                aj, bj = sorted(langs(sj))
                if aj > bi + max_gat_px:
                    break
                sprong = abs(dwars(sj) - dwars(si))
                if sprong < 1e-6 or sprong > max_sprong_px:
                    continue
                overlap = min(bi, bj) - max(ai, aj)
                if overlap > 0.2 * min(bi - ai, bj - aj):
                    continue        # ze lopen naast elkaar: twee aparte muren
                if wortel(i) == wortel(j):
                    continue
                # het knooppunt ligt tussen de twee uiteinden in
                grens = (bi + aj) / 2.0 if aj >= bi else (bj + ai) / 2.0
                midden = (dwars(si) + dwars(sj)) / 2.0
                x, y = (grens, midden) if horizontaal else (midden, grens)
                if verbonden(x, y, sprong):
                    continue        # echte verspringing, laten staan
                ouder[wortel(i)] = wortel(j)

        groepen: dict = {}
        for i in recht:
            groepen.setdefault(wortel(i), []).append(i)
        for leden in groepen.values():
            if len(leden) < 2:
                continue
            gewicht = 0.0
            totaal = 0.0
            for i in leden:
                a, b = langs(resultaat[i])
                lengte = abs(b - a)
                totaal += dwars(resultaat[i]) * lengte
                gewicht += lengte
            if gewicht == 0:
                continue
            nieuw = totaal / gewicht
            for i in leden:
                s = resultaat[i]
                if horizontaal:
                    resultaat[i] = Segment(s.x1, nieuw, s.x2, nieuw)
                else:
                    resultaat[i] = Segment(nieuw, s.y1, nieuw, s.y2)

    return resultaat


def sluit_hoeken(segmenten: Sequence[Segment], tolerantie_px: float = 8.0) -> List[Segment]:
    """Trek loshangende uiteinden door tot op de lijn waar ze bij horen.

    Hough kapt lijnen doorgaans een paar pixels te vroeg af; hierdoor sluiten
    hoeken en T-aansluitingen weer netjes.

    Elk uiteinde wordt enkel vergeleken met de segmenten in zijn eigen buurt.
    Alles met alles vergelijken is op een echt plan met duizenden lijnen niet
    haalbaar.
    """
    resultaat = [Segment(s.x1, s.y1, s.x2, s.y2) for s in segmenten]
    lijnen = []
    for s in resultaat:
        dx, dy = s.x2 - s.x1, s.y2 - s.y1
        lengte = math.hypot(dx, dy)
        if lengte == 0:
            lijnen.append(None)
            continue
        lijnen.append((s.x1, s.y1, dx / lengte, dy / lengte, lengte))

    # buurtenraster: welk segment komt in welke cel voor?
    cel = max(32.0, tolerantie_px * 4)
    raster: dict = {}
    for j, s in enumerate(resultaat):
        if lijnen[j] is None:
            continue
        x_min, x_max = sorted((s.x1, s.x2))
        y_min, y_max = sorted((s.y1, s.y2))
        for cx in range(int((x_min - tolerantie_px) // cel), int((x_max + tolerantie_px) // cel) + 1):
            for cy in range(int((y_min - tolerantie_px) // cel), int((y_max + tolerantie_px) // cel) + 1):
                raster.setdefault((cx, cy), []).append(j)

    for i, s in enumerate(resultaat):
        if lijnen[i] is None:
            continue
        for kant in (0, 1):
            ex, ey = (s.x1, s.y1) if kant == 0 else (s.x2, s.y2)
            beste = None
            buren = raster.get((int(ex // cel), int(ey // cel)), ())
            for j in buren:
                gegevens = lijnen[j]
                if j == i or gegevens is None:
                    continue
                ax, ay, ux, uy, lengte = gegevens
                if abs(ux * lijnen[i][2] + uy * lijnen[i][3]) > 0.966:   # < 15 graden verschil
                    continue
                t = (ex - ax) * ux + (ey - ay) * uy
                if not (-tolerantie_px <= t <= lengte + tolerantie_px):
                    continue
                vx, vy = ax + t * ux, ay + t * uy
                afstand = math.hypot(ex - vx, ey - vy)
                if afstand <= tolerantie_px and (beste is None or afstand < beste[0]):
                    beste = (afstand, vx, vy)
            if beste:
                _, vx, vy = beste
                if kant == 0:
                    s.x1, s.y1 = vx, vy
                else:
                    s.x2, s.y2 = vx, vy
    return resultaat


def trek_losse_einden_door(segmenten: Sequence[Segment], reik_px: float,
                           los_px: float) -> List[Segment]:
    """Trek een uiteinde dat nog los hangt door tot de dwarse lijn waar het op afkomt.

    Ruis of een vouw kan het laatste stuk van een dunne lijn wegvreten: een
    maatlijn stopt dan twee millimeter voor haar maatstreepje. Het gewone
    aansluiten reikt daar niet ver genoeg voor, en ruimer zetten zou overal
    lijnen aan elkaar plakken.

    Hier wordt enkel verlengd, nooit ingekort; enkel in de eigen richting van
    de lijn; enkel als de verlenging een dwarse lijn ook echt raakt (en niet
    ernaast valt); en enkel voor uiteinden die nog los hangen. Een deuropening
    of een gat tussen twee muren blijft dus een gat.
    """
    resultaat = [Segment(s.x1, s.y1, s.x2, s.y2) for s in segmenten]
    cel = max(16.0, reik_px)
    rooster: dict = {}
    for j, s in enumerate(resultaat):
        if s.lengte == 0:
            continue
        x_min, x_max = sorted((s.x1, s.x2))
        y_min, y_max = sorted((s.y1, s.y2))
        for cx in range(int((x_min - reik_px) // cel), int((x_max + reik_px) // cel) + 1):
            for cy in range(int((y_min - reik_px) // cel), int((y_max + reik_px) // cel) + 1):
                rooster.setdefault((cx, cy), []).append(j)

    def raakt_iets(x, y, eigen):
        for j in rooster.get((int(x // cel), int(y // cel)), ()):
            if j == eigen:
                continue
            o = resultaat[j]
            afstand, t = _afstand_tot_segment((x, y), (o.x1, o.y1), (o.x2, o.y2))
            if afstand <= los_px:
                return True
        return False

    for i, s in enumerate(resultaat):
        lengte = s.lengte
        if lengte == 0:
            continue
        ux, uy = (s.x2 - s.x1) / lengte, (s.y2 - s.y1) / lengte
        for kant in (0, 1):
            ex, ey = (s.x1, s.y1) if kant == 0 else (s.x2, s.y2)
            if raakt_iets(ex, ey, i):
                continue                       # hangt niet los
            richting = -1.0 if kant == 0 else 1.0
            dx, dy = ux * richting, uy * richting
            beste = None
            for j in rooster.get((int(ex // cel), int(ey // cel)), ()):
                if j == i:
                    continue
                o = resultaat[j]
                ol = o.lengte
                if ol == 0:
                    continue
                ox, oy = (o.x2 - o.x1) / ol, (o.y2 - o.y1) / ol
                if abs(ox * ux + oy * uy) > 0.5:     # minder dan 60 graden: niet dwars
                    continue
                # snijpunt van de verlenging met de dwarse lijn
                noemer = dx * oy - dy * ox
                if abs(noemer) < 1e-9:
                    continue
                stap = ((o.x1 - ex) * oy - (o.y1 - ey) * ox) / noemer
                if not (0.0 < stap <= reik_px):
                    continue                   # achteruit, of te ver
                sx, sy = ex + dx * stap, ey + dy * stap
                t = ((sx - o.x1) * ox + (sy - o.y1) * oy) / ol
                if not (-0.02 <= t <= 1.02):
                    continue                   # valt naast de dwarse lijn
                if beste is None or stap < beste[0]:
                    beste = (stap, sx, sy)
            if beste:
                _, sx, sy = beste
                if kant == 0:
                    s.x1, s.y1 = sx, sy
                else:
                    s.x2, s.y2 = sx, sy
    return resultaat


def zet_haaks(segmenten: Sequence[Segment],
              px_per_mm: float = 300 / 25.4,
              speling_mm: float = 1.5,
              min_lengte_mm: float = 8.0,
              grenzen_graden: Tuple[float, float] = (0.4, 3.0)) -> List[Segment]:
    """Zet lijnen die bijna haaks staan, exact haaks.

    De marge is niet vast maar hangt af van de lengte: wat telt is niet de hoek
    maar hoe ver het uiteinde van de lijn ernaast ligt. Een halve graad over
    twee centimeter is niets; over twintig centimeter is het een zichtbare
    scheefstand.

    Korte stukjes blijven ongemoeid. Een licht gebogen gevel bestaat uit een
    reeks korte stukjes met elk een eigen hoek; wie daarvan de stukjes plat
    slaat die toevallig bijna recht liggen en de rest laat staan, maakt van een
    vloeiende boog een trap.
    """
    uit = []
    ondergrens, bovengrens = grenzen_graden
    for s in segmenten:
        lengte_mm = s.lengte / px_per_mm
        if lengte_mm < min_lengte_mm:
            uit.append(s)
            continue
        tolerantie = math.degrees(math.atan2(speling_mm, lengte_mm))
        tolerantie = min(bovengrens, max(ondergrens, tolerantie))
        hoek = s.hoek
        if hoek < tolerantie or hoek > 180 - tolerantie:
            y = (s.y1 + s.y2) / 2.0
            uit.append(Segment(s.x1, y, s.x2, y))
        elif abs(hoek - 90) < tolerantie:
            x = (s.x1 + s.x2) / 2.0
            uit.append(Segment(x, s.y1, x, s.y2))
        else:
            uit.append(s)
    return uit


# ---------------------------------------------------------------- OCR

def _ocr_data(beeld: np.ndarray, talen: str, psm: int = 11):
    import pytesseract
    for taalkeuze in (talen, "eng"):
        try:
            return pytesseract.image_to_data(
                beeld, lang=taalkeuze, config=f"--psm {psm}",
                output_type=pytesseract.Output.DICT)
        except Exception:
            continue
    return None


def _egaliseer(grijs: np.ndarray) -> np.ndarray:
    """Ongelijke belichting wegwerken - dat maakt het verschil voor de OCR."""
    achtergrond = cv2.medianBlur(grijs, 31)
    return cv2.divide(grijs, achtergrond, scale=255)


_GETAL_WOORD = re.compile(r"^[+\-±]?\d+(?:[.,]\d+)*(?:\s?(?:mm|cm|m))?$")
_SCHAAL_WOORD = re.compile(r"^\d+\s?[:/]\s?\d+$")


def aannemelijk_woord(woord: str, zekerheid: Optional[float] = None) -> bool:
    """Kan dit een echt woord of getal van een plan zijn?

    De tekstherkenning leest op lijnwerk graag "woorden" in muren, arcering en
    deurbogen: "ry", "iG", "tT", "hk". Die horen niet als tekst in de DXF, en
    bij een schermafbeelding zouden ze een gat in een muur gommen. Wat blijft:

    - getallen met minstens twee cijfers (3600, 416,3, +7.79, 30 cm)
    - schaalaanduidingen (1/50, 1:20)
    - woorden van minstens drie letters in een normale schrijfwijze
      (HAL, keuken, Douchekamer) of met cijfers erin (HEA160, VH289)
    - korte afkortingen in hoofdletters (WC, VH)
    """
    w = woord.strip().strip(".,;:()[]{}'\"")
    if not w:
        return False
    if _SCHAAL_WOORD.match(w):
        return True
    if _GETAL_WOORD.match(w):
        return sum(c.isdigit() for c in w) >= 2
    letters = [c for c in w if c.isalpha()]
    cijfers = [c for c in w if c.isdigit()]
    if not letters:
        return False
    if any(not (c.isalnum() or c in "-/&+") for c in w):
        return False
    if cijfers:
        return len(w) >= 3 and len(letters) >= 1          # HEA160, VH289, 2xHEA
    if len(letters) < 2:
        return False                                       # losse letter: "a", "N"
    if len(letters) == 2:
        return w.isupper()                                 # WC, VH - niet "ry" of "iG"
    romp = w[1:]
    if not (w.islower() or w.isupper() or romp.islower()):
        return False                                       # rare schrijfwijze: "rN", "iGo"
    if len(letters) >= 5:
        return True                                        # lange woorden zijn zelden toeval
    # Kort woord (3-4 letters): hier hallucineert de tekstherkenning het
    # vaakst ("hud", "tat", "Gom"). Ruimtenamen en afkortingen op plannen
    # staan meestal in hoofdletters; een kort woord in kleine letters moet
    # daarom heel zeker gelezen zijn.
    if zekerheid is None:
        return True
    if w.isupper():
        return zekerheid >= 55
    return zekerheid >= 85


def lees_tekst_ocr(img: np.ndarray, px_per_mm: float, talen: str = "nld+eng",
                   min_zekerheid: float = 40.0) -> List[Tekst]:
    """Lees de tekst op het plan, zowel horizontaal als verticaal geschreven.

    Geeft Tekst-objecten in papier-mm met de oorsprong linksonder.
    """
    try:
        import pytesseract  # noqa: F401
    except ImportError:
        return []

    grijs = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    egaal = _egaliseer(grijs)
    H = grijs.shape[0]

    gevonden = {}

    def voeg_toe(t: Tekst, zekerheid: Optional[float] = None):
        if not aannemelijk_woord(t.inhoud, zekerheid):
            return
        sleutel = (t.inhoud, round(t.positie[0], 1), round(t.positie[1], 1), t.hoek_graden)
        gevonden.setdefault(sleutel, t)

    def maatgetallen() -> int:
        return sum(1 for t in gevonden.values()
                   if re.fullmatch(r"\d{2,6}([.,]\d{1,3})?", t.inhoud.strip()))

    def verwerk(beeld, gedraaid: bool, psms=(11, 6)):
        for psm in psms:
            # de tweede doorloop is enkel nodig als de eerste te weinig
            # maatgetallen oplevert - hij kost evenveel tijd als de eerste
            if psm != psms[0] and maatgetallen() >= 4:
                return
            data = _ocr_data(beeld, talen, psm)
            if not data:
                continue
            for i, woord in enumerate(data.get("text", [])):
                woord = (woord or "").strip()
                if not woord:
                    continue
                try:
                    zekerheid = float(data["conf"][i])
                except (ValueError, KeyError, TypeError):
                    continue
                if zekerheid < min_zekerheid:
                    continue
                x, y, w, h = (data["left"][i], data["top"][i],
                              data["width"][i], data["height"][i])
                if w <= 0 or h <= 0:
                    continue
                if not gedraaid:
                    voeg_toe(Tekst(
                        inhoud=woord,
                        positie=(x / px_per_mm, (H - (y + h)) / px_per_mm),
                        hoogte_mm=h / px_per_mm,
                        breedte_mm=w / px_per_mm,
                        hoek_graden=0.0,
                    ), zekerheid)
                else:
                    # Gedraaid met de klok mee: x_orig = y', y_cad = x'.
                    # Het ankerpunt van staande tekst is de rechteronderhoek,
                    # dus y' + h' en niet y' - anders ligt het berekende midden
                    # een tekstbreedte naast de maatlijn.
                    voeg_toe(Tekst(
                        inhoud=woord,
                        positie=((y + h) / px_per_mm, x / px_per_mm),
                        hoogte_mm=h / px_per_mm,
                        breedte_mm=w / px_per_mm,
                        hoek_graden=90.0,
                    ), zekerheid)

    verwerk(egaal, False)
    verwerk(cv2.rotate(egaal, cv2.ROTATE_90_CLOCKWISE), True)
    return list(gevonden.values())


# ---------------------------------------------------------------- geheel

def _tekstvak_px(t: Tekst, px_per_mm: float, hoogte_px: int):
    """Het vak in pixels waar een gelezen woord staat (x0, y0, x1, y1)."""
    if abs(t.hoek_graden - 90.0) < 1.0:
        # staande tekst: het ankerpunt is de rechteronderhoek
        x1 = t.positie[0] * px_per_mm
        x0 = x1 - t.hoogte_mm * px_per_mm
        y1 = hoogte_px - t.positie[1] * px_per_mm
        y0 = y1 - t.breedte_mm * px_per_mm
    else:
        x0 = t.positie[0] * px_per_mm
        x1 = x0 + t.breedte_mm * px_per_mm
        y1 = hoogte_px - t.positie[1] * px_per_mm
        y0 = y1 - t.hoogte_mm * px_per_mm
    return int(x0), int(y0), int(round(x1)), int(round(y1))


def _segmenten_schoon(img: np.ndarray, px_per_mm: float,
                      max_teksthoogte: int,
                      teksten: Sequence[Tekst] = ()) -> List[Segment]:
    """Lijnwerk uit een schoon digitaal beeld: een schermafbeelding of export.

    Een fotoroute zoekt dunne inktlijnen en dunt alles uit tot een middellijn.
    Maar op een architectenplan zijn muren vaak ingekleurde vlakken - een
    grijs vlak uitdunnen geeft een rommel van halve randen. Hier worden de
    twee apart behandeld:

    - donkere, dikke vlakken (muren, ingekleurde aanduidingen) leveren hun
      OMTREK, zoals een muur in CAD een gesloten vorm is;
    - dunne lijnen (maatlijnen, deuren, meubels) worden uitgedund zoals altijd.

    Een schoon beeld heeft geen schaduw of ruis, dus een vaste grijsgrens werkt
    hier beter dan het plaatselijke drempelen dat voor foto's nodig is.
    """
    grijs = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img

    # Wat de tekstherkenning als woord las, eerst uitgommen. Vetgedrukte
    # titels zijn even donker en dik als een muur en zouden anders als muurvlak
    # opgepikt worden - met een krabbel van omtrekjes als resultaat.
    if teksten:
        grijs = grijs.copy()
        hoogte_px = grijs.shape[0]
        for t in teksten:
            schoon_woord = re.sub(r"[^0-9A-Za-z]", "", t.inhoud)
            if len(schoon_woord) < 2:
                continue
            x0, y0, x1, y1 = _tekstvak_px(t, px_per_mm, hoogte_px)
            grijs[max(0, y0 - 1):max(0, y1 + 1), max(0, x0 - 1):max(0, x1 + 1)] = 255

    # 1. muurvlakken: donker EN dikker dan een lijn
    donker = np.where(grijs < 165, 255, 0).astype(np.uint8)
    k = max(3, int(round(0.30 * px_per_mm)))
    k += 1 - k % 2                                   # oneven
    kern = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    muren = cv2.morphologyEx(donker, cv2.MORPH_OPEN, kern)

    segmenten: List[Segment] = []
    min_opp = (1.0 * px_per_mm) ** 2
    epsilon = max(0.8, 0.10 * px_per_mm)
    min_rand = max(3.0, 0.6 * px_per_mm)
    contouren, _ = cv2.findContours(muren, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    for contour in contouren:
        if cv2.contourArea(contour) < min_opp:
            continue
        veelhoek = cv2.approxPolyDP(contour, epsilon, True).reshape(-1, 2).astype(float)
        if len(veelhoek) < 3:
            continue
        for (x1, y1), (x2, y2) in zip(veelhoek, np.roll(veelhoek, -1, axis=0)):
            stuk = Segment(float(x1), float(y1), float(x2), float(y2))
            if stuk.lengte >= min_rand:
                segmenten.append(stuk)

    # 2. dunne lijnen: alle inkt die niet bij een muurvlak hoort
    inkt = np.where(grijs < 232, 255, 0).astype(np.uint8)
    # ruim genoeg rond de muren: de zachte grijze rand die een muurvlak op een
    # schermafbeelding heeft, gaf anders een spooklijn evenwijdig aan de muur
    rand_k = max(7, int(round(0.6 * px_per_mm)) | 1)
    rand = cv2.dilate(muren, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (rand_k, rand_k)))
    dun = cv2.bitwise_and(inkt, cv2.bitwise_not(rand))
    lijnmasker, _ = scheid_tekst_van_lijnen(dun, max_teksthoogte)
    segmenten.extend(detecteer_segmenten(lijnmasker, px_per_mm))
    return segmenten


#: duidelijke kleuren die op plannen een betekenis hebben (rood = uit te breken,
#: blauw/groen = nieuwe toestand of aanduidingen) - elk een eigen laag
_KLEURLAGEN = (
    ("PLAN_LIJNEN_ROOD", (220, 30, 30)),
    ("PLAN_LIJNEN_BLAUW", (40, 80, 220)),
    ("PLAN_LIJNEN_GROEN", (40, 160, 60)),
)


def _kleurlaag(img: np.ndarray, s: "Segment"):
    """Leg een lijn op een kleurlaag als ze in het beeld duidelijk gekleurd is.

    Grijs en zwart blijven op PLAN_LIJNEN. Enkel uitgesproken kleur telt: de
    zachte kleurzweem van een schermafbeelding mag geen laag opleveren.
    """
    hoogte, breedte = img.shape[:2]
    stalen = []
    for t in np.linspace(0.1, 0.9, 9):
        x = int(round(s.x1 + (s.x2 - s.x1) * t))
        y = int(round(s.y1 + (s.y2 - s.y1) * t))
        if 0 <= x < breedte and 0 <= y < hoogte:
            vak = img[max(0, y - 2):y + 3, max(0, x - 2):x + 3].reshape(-1, 3).astype(int)
            # de meest verzadigde pixel uit het venstertje: een lijn van een
            # pixel breed ligt zelden exact onder het staalpunt
            verzadiging = vak.max(axis=1) - vak.min(axis=1)
            stalen.append(vak[int(np.argmax(verzadiging))])
    if not stalen:
        return "PLAN_LIJNEN", None
    b, g, r = np.median(np.array(stalen), axis=0)
    if max(r, g, b) - min(r, g, b) < 70:
        return "PLAN_LIJNEN", None
    if r > g + 60 and r > b + 60:
        return _KLEURLAGEN[0]
    if b > r + 40 and b > g + 10:
        return _KLEURLAGEN[1]
    if g > r + 40 and g > b + 20:
        return _KLEURLAGEN[2]
    return "PLAN_LIJNEN", None


def vectoriseer(img: np.ndarray,
                px_per_mm: float,
                herkomst: str = "scan",
                met_ocr: bool = True,
                ontschuinen: bool = True,
                haaks_zetten: bool = True,
                bron: str = "",
                voortgang=None,
                schoon: bool = False) -> Tekening:
    """Zet een rechtgetrokken afbeelding om naar een Tekening in papier-mm.

    schoon=True voor een digitaal beeld zonder ruis of schaduw (een geplakte
    schermafbeelding): dan worden muurvlakken als omtrek overgenomen.
    """
    def melden(tekst: str):
        if voortgang:
            voortgang(tekst)

    hoogte_px, breedte_px = img.shape[:2]
    max_teksthoogte = max(12, int(round(4.5 * px_per_mm)))
    vooraf_gelezen = None
    if schoon:
        if met_ocr:
            # bij een schoon beeld eerst de tekst lezen: die wordt uitgegomd
            # voor de muurvlakken gezocht worden (zie _segmenten_schoon)
            melden("tekst lezen (dit is de traagste stap)")
            vooraf_gelezen = lees_tekst_ocr(img, px_per_mm)
        melden("muurvlakken en lijnen scheiden")
        segmenten = _segmenten_schoon(img, px_per_mm, max_teksthoogte,
                                      vooraf_gelezen or ())
    else:
        melden("zwart/wit zetten")
        masker = binariseer(img)
        melden("tekst van lijnwerk scheiden")
        lijnmasker, _ = scheid_tekst_van_lijnen(masker, max_teksthoogte)
        melden("lijnen zoeken")
        segmenten = detecteer_segmenten(lijnmasker, px_per_mm)
    notities = []
    if ontschuinen and segmenten:
        scheef = dominante_hoek(segmenten)
        if abs(scheef) > 0.1:
            segmenten = _roteer(segmenten, scheef, (breedte_px / 2.0, hoogte_px / 2.0))
            notities.append(f"scheefstand van {scheef:.2f} graden gecorrigeerd")
    melden(f"{len(segmenten)} lijnstukken opschonen")
    if haaks_zetten:
        # eerst haaks zetten, dan pas samenvoegen. Een vouw in het papier maakt
        # van een lange rechte lijn een reeks stukjes met elk een iets andere
        # hoek; wie die eerst probeert samen te voegen, houdt snippers over.
        # Zet je ze eerst allemaal recht, dan vallen ze weer op een lijn.
        segmenten = zet_haaks(segmenten, px_per_mm)
    segmenten = voeg_samen(segmenten,
                           afstand_tolerantie=max(2.0, 0.6 * px_per_mm),
                           gat_tolerantie=max(6.0, 4.0 * px_per_mm))
    if haaks_zetten:
        segmenten = zet_haaks(segmenten, px_per_mm)
        segmenten = lijn_uit(segmenten, tolerantie_px=max(2.0, 0.35 * px_per_mm))
        melden("sprongen door vouwen wegstrijken")
        segmenten = strijk_sprongen(segmenten,
                                    max_gat_px=max(4.0, 3.0 * px_per_mm),
                                    max_sprong_px=max(3.0, 1.8 * px_per_mm),
                                    verbind_straal_px=max(3.0, 0.5 * px_per_mm))
        segmenten = lijn_uit(segmenten, tolerantie_px=max(2.0, 0.35 * px_per_mm))
    segmenten = sluit_hoeken(segmenten, tolerantie_px=max(4.0, 0.7 * px_per_mm))
    segmenten = trek_losse_einden_door(segmenten,
                                       reik_px=max(8.0, 2.5 * px_per_mm),
                                       los_px=max(3.0, 0.4 * px_per_mm))

    tekening = Tekening(
        blad_breedte_mm=breedte_px / px_per_mm,
        blad_hoogte_mm=hoogte_px / px_per_mm,
        bron=bron,
        herkomst=herkomst,
        notities=notities,
    )
    for s in segmenten:
        # beeldcoordinaten (y naar beneden) -> CAD (y naar boven)
        p1 = (s.x1 / px_per_mm, (hoogte_px - s.y1) / px_per_mm)
        p2 = (s.x2 / px_per_mm, (hoogte_px - s.y2) / px_per_mm)
        laag, kleur = ("PLAN_LIJNEN", None)
        if schoon and img.ndim == 3:
            laag, kleur = _kleurlaag(img, s)
        tekening.polylijnen.append(Polylijn(punten=[p1, p2], laag=laag, kleur=kleur))

    if vooraf_gelezen is not None:
        tekening.teksten = vooraf_gelezen
    elif met_ocr:
        melden("tekst lezen (dit is de traagste stap)")
        tekening.teksten = lees_tekst_ocr(img, px_per_mm)

    if _skelet_waarschuwing:
        tekening.notities.extend(_skelet_waarschuwing)

    melden("schaal bepalen")
    return tekening
