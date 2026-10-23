"""DXF wegschrijven op ware grootte (millimeter, 1:1)."""

from __future__ import annotations

import math
from typing import Optional

import ezdxf
import ezdxf.colors
from ezdxf.enums import TextEntityAlignment

from .model import Tekening
from .units import formatteer_schaal

# ezdxf/AutoCAD kleurindex 7 = zwart/wit afhankelijk van achtergrond
STANDAARDKLEUR = 7


def schrijf_dxf(tekening: Tekening,
                doelpad: str,
                schaalnoemer: float,
                met_tekst: bool = True,
                met_controlevierkant: bool = True,
                dxf_versie: str = "R2018",
                oorsprong_linksonder: bool = True) -> dict:
    """Zet de tekening (papier-mm) om naar werkelijke mm en schrijf een DXF.

    schaalnoemer 50 betekent: het plan staat op 1/50, dus 1 mm op papier is
    50 mm in werkelijkheid.
    """
    doc = ezdxf.new(dxf_versie, setup=True)
    doc.header["$INSUNITS"] = 4          # 4 = millimeter
    doc.header["$MEASUREMENT"] = 1       # metrisch
    doc.header["$LUNITS"] = 2            # decimaal
    doc.header["$LUPREC"] = 2
    msp = doc.modelspace()

    f = float(schaalnoemer)

    begrenzing = tekening.begrenzing()
    dx = dy = 0.0
    if oorsprong_linksonder and begrenzing:
        dx, dy = -begrenzing[0], -begrenzing[1]

    def om(p):
        return ((p[0] + dx) * f, (p[1] + dy) * f)

    lagen = set()

    def zorg_laag(naam: str, kleur=None):
        if naam in lagen:
            return
        lagen.add(naam)
        if naam not in doc.layers:
            # Een kleurlaag (PLAN_LIJNEN_BLAUW) krijgt haar eigen kleur; de
            # verzamellagen blijven neutraal, want daar draagt elk object
            # zijn eigen kleur en zou een laagkleur misleiden.
            if kleur is not None and naam not in ("PLAN_LIJNEN", "PLAN_VULLING", "PLAN_TEKST"):
                laag = doc.layers.add(naam)
                laag.rgb = kleur
                return
            doc.layers.add(naam, dxfattribs={"color": STANDAARDKLEUR})

    aantal_polylijnen = 0
    aantal_vlakken = 0

    # Vlakken eerst: in CAD bepaalt de volgorde wat bovenop ligt, en een
    # muurvulling hoort onder de lijnen, niet erover.
    for pl in tekening.polylijnen:
        if not pl.vulling or len(pl.punten) < 3:
            continue
        zorg_laag(pl.laag)
        punten = [om(p) for p in pl.punten]
        vlak = msp.add_hatch(dxfattribs={"layer": pl.laag})
        if pl.kleur is not None:
            vlak.set_solid_fill(rgb=pl.kleur)
        else:
            vlak.set_solid_fill(color=8)
        vlak.paths.add_polyline_path(punten, is_closed=True)
        for extra in pl.extra_paden:
            if len(extra) >= 3:
                vlak.paths.add_polyline_path([om(p) for p in extra], is_closed=True)
        aantal_vlakken += 1

    for pl in tekening.polylijnen:
        if pl.vulling or len(pl.punten) < 2:
            continue
        zorg_laag(pl.laag, pl.kleur)
        punten = [om(p) for p in pl.punten]
        attribs = {"layer": pl.laag}
        if pl.kleur is not None and pl.kleur != (0, 0, 0):
            # kleur per object: blijft juist ook als alle lijnen op een laag staan
            attribs["true_color"] = ezdxf.colors.rgb2int(pl.kleur)
        if pl.lijndikte_mm:
            # lijndikte in DXF is in 1/100 mm, geplot op papier -> papierdikte behouden
            attribs["lineweight"] = _lineweight(pl.lijndikte_mm)
        if len(punten) == 2:
            msp.add_line(punten[0], punten[1], dxfattribs=attribs)
        else:
            msp.add_lwpolyline(punten, close=pl.gesloten, dxfattribs=attribs)
        aantal_polylijnen += 1

    aantal_teksten = 0
    if met_tekst and tekening.teksten:
        zorg_laag("PLAN_TEKST")
        for t in tekening.teksten:
            hoogte = max(0.1, t.hoogte_mm * f)
            try:
                ent = msp.add_text(
                    t.inhoud,
                    height=hoogte,
                    rotation=t.hoek_graden,
                    dxfattribs={"layer": "PLAN_TEKST", "style": "OpenSans"},
                )
                ent.set_placement(om(t.positie), align=TextEntityAlignment.LEFT)
                aantal_teksten += 1
            except Exception:
                continue

    if met_controlevierkant:
        zorg_laag("CONTROLE_1M")
        # vierkant van exact 1000 x 1000 mm, linksonder van de tekening
        x0, y0 = 0.0, (-1500.0 if begrenzing else 0.0)
        msp.add_lwpolyline(
            [(x0, y0), (x0 + 1000, y0), (x0 + 1000, y0 + 1000), (x0, y0 + 1000)],
            close=True, dxfattribs={"layer": "CONTROLE_1M"},
        )
        msp.add_text(
            "CONTROLE: dit vierkant meet exact 1000 x 1000 mm",
            height=60,
            dxfattribs={"layer": "CONTROLE_1M"},
        ).set_placement((x0, y0 - 120), align=TextEntityAlignment.LEFT)

    doc.saveas(doelpad)

    breedte = hoogte_t = 0.0
    if begrenzing:
        breedte = (begrenzing[2] - begrenzing[0]) * f
        hoogte_t = (begrenzing[3] - begrenzing[1]) * f

    return {
        "pad": doelpad,
        "polylijnen": aantal_polylijnen,
        "vlakken": aantal_vlakken,
        "teksten": aantal_teksten,
        "lagen": sorted(lagen),
        "schaal": formatteer_schaal(schaalnoemer),
        "breedte_mm": breedte,
        "hoogte_mm": hoogte_t,
    }


def _lineweight(dikte_mm: float) -> int:
    """Dichtstbijzijnde toegelaten DXF-lijndikte (in 1/100 mm)."""
    toegelaten = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80,
                  90, 100, 106, 120, 140, 158, 200, 211]
    waarde = int(round(dikte_mm * 100))
    return min(toegelaten, key=lambda a: abs(a - waarde))
