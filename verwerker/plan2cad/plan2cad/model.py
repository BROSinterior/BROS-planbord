"""Tussenmodel: wat er tussen de inlees- en de exportstap zit.

Alle coordinaten zitten in **papier-millimeter**, met de oorsprong linksonder
op het blad en de y-as naar boven (zoals in CAD, niet zoals in PDF).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Tuple

Punt = Tuple[float, float]


@dataclass
class Polylijn:
    punten: List[Punt]
    gesloten: bool = False
    laag: str = "PLAN"
    lijndikte_mm: float = 0.0
    kleur: Optional[Tuple[int, int, int]] = None
    # True = een ingekleurd vlak (muurvulling, vloertint) in plaats van een
    # getekende lijn. Wordt een vlak in de DXF, geen kader.
    vulling: bool = False
    # Bij een vlak: de overige randen van hetzelfde vlak. Een vlak met gaten
    # (een trap met treden, een muur met een nis) bestaat in PDF uit meerdere
    # randen die samen EEN vorm zijn; apart ingekleurd worden de gaten vol.
    extra_paden: List[List[Punt]] = field(default_factory=list)

    def lengte(self) -> float:
        tot = 0.0
        pts = list(self.punten) + ([self.punten[0]] if self.gesloten and self.punten else [])
        for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
            tot += ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
        return tot


@dataclass
class Tekst:
    inhoud: str
    positie: Punt          # linksonder van de tekst
    hoogte_mm: float
    hoek_graden: float = 0.0
    laag: str = "PLAN_TEKST"
    breedte_mm: float = 0.0

    @property
    def midden(self) -> Punt:
        import math
        hoek = math.radians(self.hoek_graden)
        dx = self.breedte_mm / 2.0
        dy = self.hoogte_mm / 2.0
        x = self.positie[0] + dx * math.cos(hoek) - dy * math.sin(hoek)
        y = self.positie[1] + dx * math.sin(hoek) + dy * math.cos(hoek)
        return (x, y)


@dataclass
class Tekening:
    """Een blad in papier-mm."""
    polylijnen: List[Polylijn] = field(default_factory=list)
    teksten: List[Tekst] = field(default_factory=list)
    blad_breedte_mm: float = 0.0
    blad_hoogte_mm: float = 0.0
    bron: str = ""
    herkomst: str = ""            # "vector-pdf", "scan-pdf", "foto"
    notities: List[str] = field(default_factory=list)
    # False zodra de papiermaat een aanname is (foto zonder gekend formaat):
    # dan zegt een schaalvermelding op het blad niets over de echte maten
    papierschaal_betrouwbaar: bool = True
    # Teksten die enkel dienen om de schaal te vinden, niet om in de DXF te
    # zetten: maatgetallen die in een CAD-PDF als lijntjes getekend zijn en
    # dus al als lijnwerk in de tekening zitten.
    schaalteksten: List[Tekst] = field(default_factory=list)

    def aantal_segmenten(self) -> int:
        return sum(max(0, len(p.punten) - 1) for p in self.polylijnen)

    def begrenzing(self):
        xs, ys = [], []
        for p in self.polylijnen:
            for x, y in p.punten:
                xs.append(x)
                ys.append(y)
        if not xs:
            return None
        return (min(xs), min(ys), max(xs), max(ys))


@dataclass
class SchaalKandidaat:
    noemer: float                 # de gemeten noemer, bv. 50,25 - dit rekent maatfouten weg
    methode: str                  # "maatlijnen", "vermelding", "kalibratie", "handmatig"
    vertrouwen: float             # 0..1
    toelichting: str = ""
    standaardnoemer: Optional[float] = None   # de nette schaal waar dit bij hoort, bv. 50

    @property
    def afwijking_procent(self) -> float:
        if not self.standaardnoemer:
            return 0.0
        return 100.0 * (self.noemer - self.standaardnoemer) / self.standaardnoemer

    def __str__(self) -> str:
        from .units import formatteer_schaal
        if not self.standaardnoemer:
            return (f"maten kloppen (verhouding {formatteer_schaal(self.noemer)}) - "
                    f"{self.methode}, {int(self.vertrouwen * 100)}% zeker")
        basis = formatteer_schaal(self.standaardnoemer)
        extra = ""
        if abs(self.afwijking_procent) > 0.15:
            extra = f" (gemeten {formatteer_schaal(self.noemer)})"
        return f"{basis}{extra} - {self.methode}, {int(self.vertrouwen * 100)}% zeker"
