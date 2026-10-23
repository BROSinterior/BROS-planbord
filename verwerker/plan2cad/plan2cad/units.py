"""Eenheden en schaal-hulpmiddelen.

Interne conventie in Plan2CAD:

* alle geometrie wordt eerst uitgedrukt in **papier-millimeter** (mm zoals
  het op het blad staat);
* de schaalnoemer (1/50 -> 50) zet papier-mm om naar **werkelijke mm**;
* de DXF wordt altijd weggeschreven in werkelijke millimeter, dus 1:1.
"""

from __future__ import annotations

# 1 PDF-punt = 1/72 inch
PT_TO_MM = 25.4 / 72.0
MM_TO_PT = 72.0 / 25.4

# Gangbare bouwkundige schalen (noemer van 1/n)
STANDAARD_SCHALEN = [1, 2, 2.5, 5, 10, 20, 25, 33.333, 50, 75, 100, 125, 200, 250, 500, 1000, 1250, 2000, 2500, 5000]

# Papierformaten in mm (breedte, hoogte) staand
PAPIERFORMATEN = {
    "A4": (210.0, 297.0),
    "A3": (297.0, 420.0),
    "A2": (420.0, 594.0),
    "A1": (594.0, 841.0),
    "A0": (841.0, 1189.0),
    "B1": (707.0, 1000.0),
    "Letter": (215.9, 279.4),
    "Tabloid": (279.4, 431.8),
}


def snap_naar_standaardschaal(noemer: float, tolerantie: float = 0.04):
    """Geef de dichtstbijzijnde standaardschaal terug als die binnen de
    tolerantie ligt (relatieve afwijking), anders None."""
    if noemer <= 0:
        return None
    beste = None
    beste_afw = None
    for s in STANDAARD_SCHALEN:
        afw = abs(noemer - s) / s
        if beste_afw is None or afw < beste_afw:
            beste_afw = afw
            beste = s
    if beste_afw is not None and beste_afw <= tolerantie:
        return beste
    return None


def herken_papierformaat(breedte_mm: float, hoogte_mm: float, tolerantie_mm: float = 3.0):
    """Herken een standaard papierformaat (staand of liggend)."""
    for naam, (b, h) in PAPIERFORMATEN.items():
        for bb, hh in ((b, h), (h, b)):
            if abs(breedte_mm - bb) <= tolerantie_mm and abs(hoogte_mm - hh) <= tolerantie_mm:
                orientatie = "staand" if hh >= bb else "liggend"
                return naam, orientatie
    return None, None


def formatteer_schaal(noemer: float) -> str:
    if abs(noemer - round(noemer)) < 0.01:
        return f"1/{int(round(noemer))}"
    return f"1/{noemer:.1f}".replace(".", ",")
