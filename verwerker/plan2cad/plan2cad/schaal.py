"""Schaalbepaling.

Drie wegen, in volgorde van betrouwbaarheid:

1. **maatlijnen** - de maatgetallen op het plan vergelijken met de gemeten
   papierlengte van de bijhorende maatlijn. Meerdere maten die dezelfde schaal
   opleveren = hoge zekerheid. Dit werkt ook als het plan verkleind geprint is,
   want het meet wat er effectief op het blad staat.
2. **vermelding** - de tekst "1/50", "schaal 1:20", ... op het blad.
3. **kalibratie** - twee punten aanduiden met een gekende maat.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict
from typing import List, Optional, Sequence, Tuple

from .model import Polylijn, SchaalKandidaat, Tekening, Tekst
from .units import snap_naar_standaardschaal

# ---------------------------------------------------------------- vermelding

_VERMELDING = re.compile(
    r"(?:schaal|schal|scale|sch\.?|ech\.?|maatstaf)?\s*"
    r"\b1\s*[:/]\s*(\d{1,4}(?:[.,]\d{1,2})?)\b",
    re.IGNORECASE,
)
_MET_WOORD = re.compile(r"(?:schaal|scale|sch\.|maatstaf)", re.IGNORECASE)


def schaal_uit_vermelding(teksten: Sequence[Tekst]) -> List[SchaalKandidaat]:
    stemmen = defaultdict(float)
    voorbeelden = {}
    for t in teksten:
        inhoud = t.inhoud
        for m in _VERMELDING.finditer(inhoud):
            try:
                noemer = float(m.group(1).replace(",", "."))
            except ValueError:
                continue
            if noemer <= 0 or noemer > 5000:
                continue
            gewicht = 2.0 if _MET_WOORD.search(inhoud) else 1.0
            stemmen[noemer] += gewicht
            voorbeelden.setdefault(noemer, inhoud.strip())

    kandidaten = []
    if stemmen:
        totaal = sum(stemmen.values())
        for noemer, gewicht in sorted(stemmen.items(), key=lambda kv: -kv[1]):
            vertrouwen = min(0.75, 0.45 + 0.3 * (gewicht / totaal))
            kandidaten.append(SchaalKandidaat(
                noemer=noemer,
                methode="vermelding",
                vertrouwen=vertrouwen,
                toelichting=f'gelezen op het blad: "{voorbeelden[noemer]}"',
            ))
    return kandidaten


# ---------------------------------------------------------------- maatlijnen

_GETAL = re.compile(r"^[^\d\-+]{0,3}(\d{1,3}(?:[.\s]\d{3})+|\d{1,6})(?:[,.](\d{1,3}))?\s*"
                    r"(mm|cm|m|M|CM|MM)?[^\d]{0,3}$")


def _parse_getal(tekst: str) -> Optional[Tuple[float, Optional[str], int]]:
    """Zet een maatgetal om naar (waarde, expliciete eenheid of None, aantal decimalen).

    Het aantal decimalen komt uit de geschreven tekst, niet uit de waarde:
    "420,0" is als getal geheel, maar de nul achter de komma is er wel degelijk
    en verraadt dat het om centimeter met millimeterprecisie gaat.
    """
    s = tekst.strip().replace("'", "").replace('"', "")
    if not s or len(s) > 14:
        return None
    m = _GETAL.match(s)
    if not m:
        return None
    heel, decimaal, eenheid = m.group(1), m.group(2), m.group(3)
    heel_schoon = heel.replace(".", "").replace(" ", "")
    if not heel_schoon.isdigit():
        return None
    # losse cijfers zonder eenheid of decimaal zijn bijna altijd ruis
    # (kamernummers, OCR-fouten, delen van een legende)
    if len(heel_schoon) < 2 and not decimaal and not eenheid:
        return None
    waarde = float(heel_schoon)
    decimalen = 0
    if decimaal:
        waarde += float(decimaal) / (10 ** len(decimaal))
        decimalen = len(decimaal)
        # "3.60" met punt als decimaalteken
        if "." in heel and len(heel.split(".")[-1]) != 3:
            return None
    if waarde <= 0:
        return None
    return waarde, (eenheid.lower() if eenheid else None), decimalen


def _mogelijke_mm(waarde: float, eenheid: Optional[str],
                  decimalen: int = 0) -> List[Tuple[float, float, bool]]:
    """Welke werkelijke maten in mm kan dit getal voorstellen?

    Geeft per mogelijkheid (maat in mm, gewicht, zeker). "Zeker" betekent dat de
    eenheid vastligt in plaats van geraden is: er staat een eenheid bij ("30 cm")
    of het is een meterwaarde met twee decimalen ("4,20"). In alle andere
    gevallen beslist het geheel van het blad welke eenheid het plan gebruikt.
    """
    if eenheid == "mm":
        return [(waarde, 1.0, True)]
    if eenheid == "cm":
        return [(waarde * 10, 1.0, True)]
    if eenheid == "m":
        return [(waarde * 1000, 1.0, True)]

    opties = []
    if decimalen == 0:
        # kaal geheel getal: het kan mm zijn (3600) of cm (360)
        if waarde >= 30:
            opties.append((waarde, 1.0, False))
        if 3 <= waarde <= 3000:
            opties.append((waarde * 10, 0.5, False))
        return opties

    # Er staat een komma. Met een decimaal kan het centimeter zijn (BROS:
    # 416,3) maar ook millimeter met precisie (schrijnwerk: 652,5 of 5819,8).
    # De komma alleen beslist dat dus niet; het geheel van het blad doet dat
    # (zie de plausibiliteit van de maatgroottes in schaal_uit_maatlijnen).
    if decimalen == 1 and waarde >= 30:
        opties.append((waarde * 10, 1.0, False))      # cm met mm-precisie
        opties.append((waarde, 0.9, False))           # mm met tiende-precisie
    elif waarde <= 120:
        # "4,20" of "3,6": meter. Twee decimalen onder 120 is bijna altijd meter.
        opties.append((waarde * 1000, 1.0, decimalen == 2))
        if waarde >= 30:
            opties.append((waarde * 10, 0.5, False))
    else:
        opties.append((waarde * 10, 1.0, False))
        opties.append((waarde, 0.9, False))
    return opties


def _segmenten(polylijnen: Sequence[Polylijn], min_mm: float = 1.5):
    """Alle rechte stukken als (p1, p2, lengte, hoek in graden 0..180)."""
    uit = []
    for pl in polylijnen:
        if getattr(pl, "vulling", False):
            continue                     # een ingekleurd vlak is geen maatlijn
        pts = list(pl.punten)
        if pl.gesloten and len(pts) > 2:
            pts.append(pts[0])
        for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
            dx, dy = x2 - x1, y2 - y1
            lengte = math.hypot(dx, dy)
            if lengte < min_mm:
                continue
            hoek = math.degrees(math.atan2(dy, dx)) % 180.0
            uit.append(((x1, y1), (x2, y2), lengte, hoek))
    return uit


def _hoekverschil(a: float, b: float) -> float:
    d = abs(a - b) % 180.0
    return min(d, 180.0 - d)


def _afstand_tot_segment(punt, p1, p2):
    px, py = punt
    x1, y1 = p1
    x2, y2 = p2
    dx, dy = x2 - x1, y2 - y1
    lengte2 = dx * dx + dy * dy
    if lengte2 == 0:
        return math.hypot(px - x1, py - y1), 0.0
    t = ((px - x1) * dx + (py - y1) * dy) / lengte2
    tc = max(0.0, min(1.0, t))
    projx, projy = x1 + tc * dx, y1 + tc * dy
    return math.hypot(px - projx, py - projy), t


def _nummeringen(teksten: Sequence[Tekst], min_reeks: int = 4) -> set:
    """Welke getallen horen bij een nummering in plaats van bij een maat?

    Traptreden, kolomassen en detailverwijzingen worden doorlopend genummerd:
    29, 30, 31, 32... Zo'n reeks staat vlak naast lijnwerk en lijkt daardoor
    sprekend op een maatketen, maar de getallen zeggen niets over afstanden.
    Maten daarentegen volgen elkaar nooit als 1, 2, 3 op.
    """
    gehele = set()
    for t in teksten:
        ontleed = _parse_getal(t.inhoud)
        if not ontleed:
            continue
        waarde, eenheid, decimalen = ontleed
        if (eenheid is None and decimalen == 0 and float(waarde).is_integer()
                and 1 <= waarde <= 400):
            gehele.add(int(waarde))

    uit = set()
    for begin in sorted(gehele):
        if begin - 1 in gehele:
            continue                       # niet het begin van een reeks
        eind = begin
        while eind + 1 in gehele:
            eind += 1
        if eind - begin + 1 >= min_reeks:
            uit.update(float(n) for n in range(begin, eind + 1))
    return uit


_MAAL = re.compile(r"\d\s*[xX×*]\s*\d|\d\s*[xX×]$|^[xX×]\s*\d")


def _afmetingsaanduidingen(teksten: Sequence[Tekst]) -> set:
    """Welke getallen horen bij een afmetingsaanduiding als "tafel 800 x 2500"?

    Zulke paren staan vlak naast meubels en deuren en worden zo voor een
    maatgetal aangezien, terwijl ze niets met de lijn ernaast te maken hebben.
    Herkenbaar aan: een "x" ertussen, of - als de x zelf niet gelezen is (in
    een CAD-PDF zijn enkel de cijfers als lijntjes herkend) - twee getallen
    van dezelfde hoogte op dezelfde regel, vlak naast elkaar. In een
    maatketen staat elk getal midden op zijn eigen stuk maatlijn, dus nooit
    op een paar letterbreedtes van het volgende.
    Geeft de id()'s van de teksten die overgeslagen moeten worden.
    """
    uit = set()
    getallen = []
    kruisjes = []
    for t in teksten:
        inhoud = t.inhoud.strip()
        if _MAAL.search(inhoud):
            uit.add(id(t))
            continue
        if inhoud in ("x", "X", "×", "*"):
            kruisjes.append(t)
            continue
        if _parse_getal(inhoud):
            getallen.append(t)

    def breedte(t):
        return t.breedte_mm or 0.6 * t.hoogte_mm * len(t.inhoud.strip())

    def zelfde_regel(a, b):
        h = max(a.hoogte_mm, b.hoogte_mm, 0.1)
        if abs(a.hoek_graden - b.hoek_graden) > 5:
            return None
        if min(a.hoogte_mm, b.hoogte_mm) < 0.7 * h:
            return None
        hoek = math.radians(a.hoek_graden)
        ux, uy = math.cos(hoek), math.sin(hoek)
        dx = b.midden[0] - a.midden[0]
        dy = b.midden[1] - a.midden[1]
        langs = dx * ux + dy * uy
        dwars = -dx * uy + dy * ux
        if abs(dwars) > 0.35 * h:
            return None
        return abs(langs) - (breedte(a) + breedte(b)) / 2.0, h

    for i, a in enumerate(getallen):
        for b in getallen[i + 1:]:
            r = zelfde_regel(a, b)
            if r and r[0] < 2.5 * r[1]:
                uit.add(id(a))
                uit.add(id(b))
        for k in kruisjes:
            r = zelfde_regel(a, k)
            if r and r[0] < 1.5 * r[1]:
                uit.add(id(a))
    return uit


def _streepjesregister(segmenten, cel_mm: float = 6.0):
    """Rooster met alle korte streepjes, om maatstreepjes snel terug te vinden."""
    register: dict = defaultdict(list)
    for p1, p2, lengte, hoek in segmenten:
        if not (0.7 <= lengte <= 6.0):
            continue
        for punt in (p1, p2, ((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2)):
            register[(int(punt[0] // cel_mm), int(punt[1] // cel_mm))].append((p1, p2, hoek))
    return register, cel_mm


def _heeft_maatstreepje(punt, richting_hoek: float, register, cel_mm: float,
                        straal_mm: float = 2.5) -> bool:
    """Staat er een dwarsstreepje bij dit uiteinde?

    Maatlijnen worden afgesloten met een streepje of pijltje haaks (of schuin)
    op de lijn. Muren, trapneuzen en arceringen hebben dat niet, en dat is het
    verschil tussen een maat en zomaar een lijn.
    """
    cx, cy = int(punt[0] // cel_mm), int(punt[1] // cel_mm)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for p1, p2, hoek in register.get((cx + dx, cy + dy), ()):
                if _hoekverschil(hoek, richting_hoek) < 25.0:
                    continue          # loopt mee met de maatlijn, geen streepje
                afstand, t_param = _afstand_tot_segment(punt, p1, p2)
                if afstand <= straal_mm and -0.4 <= t_param <= 1.4:
                    return True
    return False


def _segmentregister(segmenten, cel_mm: float = 12.0):
    """Rooster over alle segmenten, zodat zoeken niet over de hele lijst hoeft.

    Zonder rooster kost het koppelen van maatgetallen aan maatlijnen
    teksten x segmenten stappen. Op een gescande A0 met tweeduizend woorden en
    tienduizenden segmenten loopt dat op tot minuten.
    """
    register: dict = defaultdict(list)
    for gegevens in segmenten:
        p1, p2 = gegevens[0], gegevens[1]
        x_min, x_max = sorted((p1[0], p2[0]))
        y_min, y_max = sorted((p1[1], p2[1]))
        for cx in range(int(x_min // cel_mm), int(x_max // cel_mm) + 1):
            for cy in range(int(y_min // cel_mm), int(y_max // cel_mm) + 1):
                register[(cx, cy)].append(gegevens)
    return register, cel_mm


def _meet_tussen_eindpunten(t: Tekst, segmentregister, cel_mm: float,
                            max_afstand_mm: float, reik_mm: float = 250.0):
    """Meet een maat zoals een tekenaar ze bedoelt: tussen haar eindmarkeringen.

    Vanaf het maatgetal wordt de maatlijn gezocht, en daarna langs die lijn
    naar links en rechts gelopen tot de eerste dwarse markering - een
    maatstreepje, een schuine slash, of een hulplijn. De afstand daartussen is
    de maat.

    Waarom niet gewoon de lengte van de maatlijn: in CAD-maatvoering staat het
    getal vaak IN de lijn (——1960——), zodat de lijn in twee helften uiteenvalt;
    en in een maatketting loopt een lijn door over meerdere maten. In beide
    gevallen geeft de lengte van "de lijn" niet de maat.

    Geeft de papierlengte in mm, of None als er geen eenduidige maat is.
    """
    cx, cy = t.midden
    halve_tekst = max(0.5, t.breedte_mm / 2.0)

    def in_buurt(x0, y0, x1, y1):
        gezien = set()
        for gx in range(int(min(x0, x1) // cel_mm), int(max(x0, x1) // cel_mm) + 1):
            for gy in range(int(min(y0, y1) // cel_mm), int(max(y0, y1) // cel_mm) + 1):
                for gegevens in segmentregister.get((gx, gy), ()):
                    if id(gegevens) not in gezien:
                        gezien.add(id(gegevens))
                        yield gegevens

    # 1. de maatlijn: evenwijdig met de tekst, vlakbij, en tot aan het getal
    lijn = None
    for p1, p2, lengte, hoek in in_buurt(cx - 20, cy - 20, cx + 20, cy + 20):
        if lengte < 1.0 or _hoekverschil(hoek, t.hoek_graden) > 6.0:
            continue
        ux, uy = (p2[0] - p1[0]) / lengte, (p2[1] - p1[1]) / lengte
        loodrecht = abs(-(cx - p1[0]) * uy + (cy - p1[1]) * ux)
        if loodrecht > max_afstand_mm:
            continue
        langs = (cx - p1[0]) * ux + (cy - p1[1]) * uy
        # hoe ver ligt het getal voorbij het einde van dit stuk lijn?
        buiten = max(0.0, -langs, langs - lengte)
        if buiten > halve_tekst + 4.0:
            continue
        score = loodrecht + 0.5 * buiten
        if lijn is None or score < lijn[0]:
            lijn = (score, p1, ux, uy)
    if lijn is None:
        return None
    _, (ax, ay), ux, uy = lijn
    # het voetpunt van het getal op de maatlijn
    langs_c = (cx - ax) * ux + (cy - ay) * uy
    vx, vy = ax + ux * langs_c, ay + uy * langs_c

    # 2. langs de lijn naar beide kanten tot de eerste dwarse markering
    links = rechts = None
    hoek_lijn = math.degrees(math.atan2(uy, ux)) % 180.0
    gang = 3.0                                     # breedte van de zoekgang
    for p1, p2, lengte, hoek in in_buurt(vx - reik_mm, vy - reik_mm, vx + reik_mm, vy + reik_mm):
        if lengte < 0.6 or _hoekverschil(hoek, hoek_lijn) < 25.0:
            continue
        sx, sy = (p2[0] - p1[0]) / lengte, (p2[1] - p1[1]) / lengte
        noemer = ux * sy - uy * sx
        if abs(noemer) < 1e-9:
            continue
        # snijpunt van de maatlijn met deze markering
        d = ((p1[0] - vx) * sy - (p1[1] - vy) * sx) / noemer
        param = ((vx + ux * d - p1[0]) * sx + (vy + uy * d - p1[1]) * sy)
        if not (-gang <= param <= lengte + gang):
            continue                               # de markering kruist de lijn niet
        if abs(d) < halve_tekst * 0.8 or abs(d) > reik_mm:
            continue                               # binnen het getal zelf, of te ver
        if d > 0 and (rechts is None or d < rechts):
            rechts = d
        elif d < 0 and (links is None or d > links):
            links = d
    if links is None or rechts is None:
        return None
    afstand = rechts - links
    if afstand < t.breedte_mm * 0.9:
        return None
    # het getal staat in een maat doorgaans ongeveer in het midden
    if abs((rechts + links) / 2.0) > afstand * 0.35:
        return None
    return afstand


def _zoek_maatlijn(t: Tekst, segmenten, max_afstand_mm: float,
                   register=None, cel_mm: float = 6.0,
                   segmentregister=None, segment_cel_mm: float = 12.0):
    """Welke maatlijn hoort bij dit maatgetal? Geeft de papierlengte terug."""
    cx, cy = t.midden
    minimum_lengte = max(2.0, t.breedte_mm * 0.9)

    if segmentregister is not None:
        straal = int(max_afstand_mm // segment_cel_mm) + 1
        gezien = set()
        nabij = []
        for dx in range(-straal, straal + 1):
            for dy in range(-straal, straal + 1):
                for gegevens in segmentregister.get(
                        (int(cx // segment_cel_mm) + dx, int(cy // segment_cel_mm) + dy), ()):
                    sleutel = id(gegevens)
                    if sleutel not in gezien:
                        gezien.add(sleutel)
                        nabij.append(gegevens)
        segmenten = nabij

    # Eerst de nauwkeurige manier: van maatstreepje tot maatstreepje.
    if segmentregister is not None:
        tussen = _meet_tussen_eindpunten(t, segmentregister, segment_cel_mm, max_afstand_mm)
        if tussen is not None:
            return tussen

    beste = None
    for p1, p2, lengte, hoek in segmenten:
        if _hoekverschil(hoek, t.hoek_graden) > 6.0:
            continue
        if lengte < minimum_lengte:
            continue              # een maatlijn is nooit korter dan zijn eigen getal
        afstand, t_param = _afstand_tot_segment((cx, cy), p1, p2)
        if afstand > max_afstand_mm:
            continue
        if not (-0.15 <= t_param <= 1.15):
            continue
        # het maatgetal staat normaal midden boven de maatlijn
        score = afstand + abs(t_param - 0.5) * 8.0
        if register is not None:
            streepjes = (_heeft_maatstreepje(p1, hoek, register, cel_mm) +
                         _heeft_maatstreepje(p2, hoek, register, cel_mm))
            score -= 4.0 * streepjes
        if beste is None or score < beste[0]:
            beste = (score, lengte)
    return None if beste is None else beste[1]


def _gewogen_mediaan(waarden_gewichten) -> float:
    """Mediaan in plaats van gemiddelde, om een gebroken maatlijn te negeren.

    Een maatlijn die door ruis of een vouw in stukken valt, wordt altijd te
    KORT gemeten - nooit te lang - en geeft dus een te grote schaalnoemer. Een
    gemiddelde trekt alle maten mee scheef: drie maatlijnen zeggen 1/50,2, een
    gebroken vierde zegt 1/52,9, en het gemiddelde wordt 1/51,05 - waarmee elke
    muur 1,7 % te groot uitkomt. De mediaan laat die ene uitschieter links
    liggen.
    """
    rij = sorted(waarden_gewichten)
    totaal = sum(g for _, g in rij)
    if totaal <= 0:
        return rij[len(rij) // 2][0]
    helft = totaal / 2.0
    opgeteld = 0.0
    for i, (waarde, gewicht) in enumerate(rij):
        opgeteld += gewicht
        if opgeteld > helft + 1e-9:
            return waarde
        if abs(opgeteld - helft) <= 1e-9 and i + 1 < len(rij):
            # precies op de helft: tussen de twee middelste in
            return (waarde + rij[i + 1][0]) / 2.0
    return rij[-1][0]


def schaal_uit_maatlijnen(tekening: Tekening,
                          max_afstand_mm: float = 6.0,
                          tolerantie: float = 0.035) -> List[SchaalKandidaat]:
    """Leid de schaal af door maatgetallen te vergelijken met de maatlijn eronder.

    De verhoudingen worden geclusterd in plaats van meteen naar een standaard-
    schaal gedwongen. Zo werkt de methode ook als het blad niet exact op formaat
    staat - bij een foto bijvoorbeeld - en blijft de uitkomst maatvast.
    """
    segmenten = _segmenten(tekening.polylijnen)
    if not segmenten:
        return []

    alle_teksten = list(tekening.teksten) + list(tekening.schaalteksten)
    genummerd = _nummeringen(alle_teksten)
    afmetingen = _afmetingsaanduidingen(alle_teksten)
    register, cel_mm = _streepjesregister(segmenten)
    segmentregister, segment_cel_mm = _segmentregister(segmenten)

    metingen = []   # (verhouding, gewicht, omschrijving, labelsleutel)
    for t in alle_teksten:
        if id(t) in afmetingen:
            continue
        ontleed = _parse_getal(t.inhoud)
        if not ontleed:
            continue
        waarde, eenheid, decimalen = ontleed
        if waarde in genummerd:
            continue
        interpretaties = _mogelijke_mm(waarde, eenheid, decimalen)
        if not interpretaties:
            continue
        papier_mm = _zoek_maatlijn(t, segmenten, max_afstand_mm, register, cel_mm,
                                   segmentregister, segment_cel_mm)
        if papier_mm is None or papier_mm <= 0:
            continue
        lengtegewicht = 1.0 + min(2.0, papier_mm / 40.0)
        sleutel = (t.inhoud.strip(), round(t.midden[0], 1), round(t.midden[1], 1))
        for echt_mm, eenheidsgewicht, zeker in interpretaties:
            verhouding = echt_mm / papier_mm
            if not (0.2 <= verhouding <= 20000):
                continue
            metingen.append((
                verhouding,
                lengtegewicht * eenheidsgewicht,
                f'"{t.inhoud.strip()}" over {papier_mm:.1f} mm op het blad',
                sleutel,
                zeker,
                echt_mm,
            ))

    if not metingen:
        return []

    # clusteren op relatieve afstand. De vergelijking gebeurt met het begin van
    # het cluster, niet met de vorige waarde: anders schuift een reeks waarden
    # die elk net binnen de marge van hun voorganger liggen, als een ketting
    # door en wordt het cluster willekeurig breed.
    metingen.sort(key=lambda m: m[0])
    clusters: List[list] = [[metingen[0]]]
    for meting in metingen[1:]:
        begin = clusters[-1][0][0]
        if (meting[0] - begin) / begin <= 2.0 * tolerantie:
            clusters[-1].append(meting)
        else:
            clusters.append([meting])

    kandidaten = []
    totaal_gewicht = sum(m[1] for m in metingen)
    for cluster in clusters:
        gewicht = sum(m[1] for m in cluster)
        labels = {m[3] for m in cluster}
        gemeten = _gewogen_mediaan([(m[0], m[1]) for m in cluster])
        gesnapt = snap_naar_standaardschaal(gemeten, tolerantie)

        score = gewicht * (1.7 if gesnapt else 1.0)

        # een maat met een vaste eenheid ("30 cm", "4,20") legt vast in welke
        # eenheid dit plan geschreven is
        vaste_eenheid = sum(1 for m in cluster if m[4])
        if vaste_eenheid:
            score *= 1.0 + min(2.0, 0.9 * vaste_eenheid)

        # Hoe groot zijn de maten in deze lezing? Op een bouw- of meubelplan
        # liggen de meeste maten tussen een paar centimeter en tientallen
        # meters; de mediaan ligt nooit onder 15 cm. Een plan in centimeter
        # gelezen als millimeter geeft net dat: kamers van 40 cm, muren van
        # 3 cm. Zo valt de verkeerde eenheid af zonder dat de komma moet
        # beslissen.
        mediaan_maat = sorted(m[5] for m in cluster)[len(cluster) // 2]
        te_klein = mediaan_maat < 150.0
        if te_klein:
            score *= 0.25

        # klopt de uitkomst als gebouw? Een plan waarvan het blad 1 meter of
        # 500 meter breed wordt, komt van een verkeerd gelezen eenheid.
        blad = max(tekening.blad_breedte_mm, tekening.blad_hoogte_mm)
        if blad > 0:
            uitgestrektheid_m = blad * gemeten / 1000.0
            if not (1.5 <= uitgestrektheid_m <= 200.0):
                score *= 0.12
                aannemelijk = False
            else:
                aannemelijk = True
        else:
            aannemelijk = True
        aandeel = gewicht / totaal_gewicht
        basis = 0.30 + 0.30 * aandeel
        if gesnapt:
            basis += 0.10
        if len(labels) >= 2:
            basis += 0.13
        if len(labels) >= 3:
            basis += 0.13
        if len(labels) >= 6:
            basis += 0.06
        if not aannemelijk:
            basis = min(basis, 0.25)
        if te_klein:
            basis = min(basis, 0.45)

        toelichting = (f"{len(labels)} maatgetal(len) leveren dezelfde verhouding op - o.a. "
                       + "; ".join(sorted({m[2] for m in cluster})[:3]))
        if not aannemelijk:
            toelichting += (f" - maar dan wordt het blad {blad * gemeten / 1000.0:.1f} m breed, "
                            "wat niet klopt voor een bouwplan")
        # Altijd de gemeten waarde gebruiken, niet de afgeronde. Ook bij een
        # foto met gekend papierformaat is het rechttrekken nooit pixelperfect;
        # de gemeten verhouding komt uit hetzelfde beeld als de muren en werkt
        # die fout dus mee weg. Afronden naar 1/50 gaf in de test alle maten
        # consequent 0,6 % te kort.
        if gesnapt and abs(gemeten - gesnapt) / gesnapt > 0.0015:
            toelichting += (f" - effectief gemeten 1/{gemeten:.2f}, en die waarde wordt "
                            "gebruikt zodat de maten kloppen")
        elif not gesnapt:
            toelichting += " - geen gangbare schaal, maar de maten zelf kloppen wel"

        kandidaten.append((score, SchaalKandidaat(
            noemer=gemeten,
            standaardnoemer=gesnapt,
            methode="maatlijnen",
            vertrouwen=min(0.97, basis),
            toelichting=toelichting,
        )))

    kandidaten.sort(key=lambda kv: -kv[0])
    return [k for _, k in kandidaten]


# ---------------------------------------------------------------- kalibratie

def schaal_uit_kalibratie(papier_afstand_mm: float, werkelijke_afstand_mm: float) -> SchaalKandidaat:
    if papier_afstand_mm <= 0:
        raise ValueError("De aangeduide afstand op het blad is nul.")
    noemer = werkelijke_afstand_mm / papier_afstand_mm
    return SchaalKandidaat(
        noemer=noemer,
        methode="kalibratie",
        vertrouwen=0.99,
        toelichting=(f"twee punten aangeduid: {papier_afstand_mm:.2f} mm op het blad "
                     f"= {werkelijke_afstand_mm:.0f} mm in werkelijkheid"),
    )


# ---------------------------------------------------------------- combineren

def bepaal_schaal(tekening: Tekening) -> List[SchaalKandidaat]:
    """Geef alle kandidaten, beste eerst."""
    uit_maten = schaal_uit_maatlijnen(tekening)
    uit_tekst = schaal_uit_vermelding(list(tekening.teksten) + list(tekening.schaalteksten))

    # Bevestigen de twee methodes elkaar? Dan is het zo goed als zeker.
    def vergelijkbaar(a: SchaalKandidaat, b: SchaalKandidaat) -> bool:
        na = a.standaardnoemer or a.noemer
        nb = b.standaardnoemer or b.noemer
        return abs(na - nb) / nb < 0.02

    # De vermelding wordt met ALLE kandidaten vergeleken, niet alleen met de
    # sterkste. Anders kan de vermelding de kandidaat die ze bevestigt niet
    # naar voren halen, en wordt datzelfde bewijs daarna ook nog uit de lijst
    # gefilterd omdat het "al gedekt" is.
    for maat in uit_maten:
        for k in uit_tekst:
            if vergelijkbaar(k, maat):
                maat.vertrouwen = max(maat.vertrouwen, 0.99)
                maat.toelichting += (f" - en bevestigd door de vermelding op het blad "
                                     f"({k.toelichting})")
                break

    if not tekening.papierschaal_betrouwbaar:
        # Bij een foto zonder gekend papierformaat werken we op een aangenomen
        # resolutie. De maatlijnmethode heeft daar geen last van - die meet de
        # verhouding en die valt weg - maar een vermelding als "1/50" gaat uit
        # van echte papiermillimeters en levert dan te kleine of te grote maten.
        for k in uit_tekst:
            k.vertrouwen = min(k.vertrouwen, 0.2)
            k.toelichting += (" - LET OP: het papierformaat is onbekend, dus deze "
                              "schaal levert geen kloppende maten. Duid twee punten "
                              "aan of kies het papierformaat.")

    alles = uit_maten + [k for k in uit_tekst
                         if not any(vergelijkbaar(k, m) for m in uit_maten)]
    alles.sort(key=lambda k: -k.vertrouwen)
    return alles
