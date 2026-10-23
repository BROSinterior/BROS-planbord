"""De volledige keten: bestand in, DXF/DWG op ware grootte uit."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import List, Optional

import numpy as np

from . import raster as rasterlaag
from . import schaal as schaallaag
from . import vectorpdf
from .dwguit import ODANietGevonden, dxf_naar_dwg
from .dxfuit import schrijf_dxf
from .model import SchaalKandidaat, Tekening
from .units import herken_papierformaat

AFBEELDINGEN = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp", ".heic"}


@dataclass
class Opties:
    pagina: int = 0
    # Welke geplakte afbeelding op de pagina (0, 1, ...) - enkel bij een
    # verslag of offerte met plannetjes als afbeelding. None = de grootste.
    afbeelding: Optional[int] = None
    dpi: int = 300
    papierformaat: Optional[str] = None       # alleen nuttig bij foto's
    met_tekst: bool = True
    met_ocr: bool = True
    haaks_zetten: bool = True
    controlevierkant: bool = True
    dwg: bool = False
    dxf_versie: str = "R2018"
    uitvoermap: Optional[str] = None


@dataclass
class Analyse:
    bestand: str
    route: str                     # "vector-pdf", "scan-pdf", "afbeelding-pdf", "foto"
    tekening: Tekening
    kandidaten: List[SchaalKandidaat] = field(default_factory=list)
    voorbeeld: Optional[np.ndarray] = None     # afbeelding voor de preview
    px_per_mm_voorbeeld: float = 1.0
    meldingen: List[str] = field(default_factory=list)
    pagina: int = 0
    afbeelding: Optional[int] = None

    @property
    def beste(self) -> Optional[SchaalKandidaat]:
        return self.kandidaten[0] if self.kandidaten else None


def bepaal_route(pad: str, pagina: int = 0) -> str:
    ext = os.path.splitext(pad)[1].lower()
    if ext == ".pdf":
        return vectorpdf.pagina_inhoud(pad, pagina)["route"]
    if ext in AFBEELDINGEN:
        return "foto"
    raise ValueError(f"Onbekend bestandstype: {ext}. Gebruik een PDF of een afbeelding.")


def bronnen(pad: str) -> List[dict]:
    """Alles wat in dit bestand apart om te zetten valt.

    Een gewone PDF geeft een bron per pagina. Een verslag met geplakte
    plannetjes geeft per pagina een bron per plannetje: elk heeft zijn eigen
    schaal, en ze in een DXF samen zetten zou ze over elkaar leggen.
    """
    ext = os.path.splitext(pad)[1].lower()
    if ext != ".pdf":
        return [{"pagina": 0, "afbeelding": None, "route": "foto",
                 "label": os.path.basename(pad), "bruikbaar": True}]
    uit = []
    for info in vectorpdf.pagina_info(pad):
        nummer = info["nummer"]
        inhoud = vectorpdf.pagina_inhoud(pad, nummer)
        if inhoud["route"] == "afbeelding-pdf":
            aantal = len(inhoud["afbeeldingen"])
            for i, beeld in enumerate(inhoud["afbeeldingen"]):
                plaats = _plaats(beeld["vak"], inhoud) if aantal > 1 else ""
                uit.append({"pagina": nummer, "afbeelding": i, "route": "afbeelding-pdf",
                            "label": f"Pagina {nummer + 1} - afbeelding {i + 1}{plaats}",
                            "bruikbaar": True})
        else:
            soort = {"vector-pdf": "vectorplan", "scan-pdf": "scan"}.get(inhoud["route"], "")
            bruikbaar = True
            if inhoud["route"] == "vector-pdf" and inhoud["lijnen"] == 0:
                soort, bruikbaar = "enkel tekst en kaders", False
            elif inhoud["route"] == "scan-pdf" and not inhoud["afbeeldingen"]:
                # geen tekenwerk en geen afbeelding: een tekstpagina, geen scan
                soort, bruikbaar = "enkel tekst", False
            uit.append({"pagina": nummer, "afbeelding": None, "route": inhoud["route"],
                        "label": f"Pagina {nummer + 1} - {soort}", "bruikbaar": bruikbaar})
    return uit


def _voorbeeld_dpi(tekening: Tekening, langste_px: int = 6000) -> int:
    """Resolutie van het voorbeeld: scherp genoeg om in te zoomen bij het
    aanduiden van twee punten, maar een A0 niet zo groot dat het geheugen
    volloopt (6000 px aan de lange kant is een A3 op 360 dpi)."""
    langste_mm = max(tekening.blad_breedte_mm, tekening.blad_hoogte_mm, 1.0)
    return int(max(110, min(220, langste_px / (langste_mm / 25.4))))


def _plaats(vak, inhoud) -> str:
    """Korte plaatsaanduiding van een afbeelding op de pagina."""
    x0, y0, x1, y1 = vak
    midden_y = (y0 + y1) / 2 / (inhoud["hoogte_mm"] / 0.3528)
    midden_x = (x0 + x1) / 2 / (inhoud["breedte_mm"] / 0.3528)
    hoogte = "bovenaan" if midden_y < 0.4 else ("onderaan" if midden_y > 0.6 else "midden")
    zijde = " links" if midden_x < 0.35 else (" rechts" if midden_x > 0.65 else "")
    return f" ({hoogte}{zijde})"


def analyseer(pad: str, opties: Optional[Opties] = None, voortgang=None) -> Analyse:
    """Lees het bestand in, zet het om naar vectoren en stel de schaal voor."""
    opties = opties or Opties()

    def melden(tekst: str):
        if voortgang:
            voortgang(tekst)

    melden("bestandstype bepalen")
    route = bepaal_route(pad, opties.pagina)
    meldingen: List[str] = []
    gekozen_afbeelding: Optional[int] = None

    if route == "afbeelding-pdf":
        # Een verslag of offerte met plannetjes als geplakte afbeelding.
        inhoud = vectorpdf.pagina_inhoud(pad, opties.pagina)
        beelden = inhoud["afbeeldingen"]
        if opties.afbeelding is not None and 0 <= opties.afbeelding < len(beelden):
            gekozen_afbeelding = opties.afbeelding
        else:
            gekozen_afbeelding = max(range(len(beelden)), key=lambda i: beelden[i]["deel"])
        melden(f"afbeelding {gekozen_afbeelding + 1} van de pagina uitlezen")
        beeld, px_per_mm = vectorpdf.render_afbeelding(
            pad, opties.pagina, beelden[gekozen_afbeelding]["vak"], min_dpi=opties.dpi)
        meldingen.append(
            f"geen tekenwerk op deze pagina, wel {len(beelden)} geplakte afbeelding(en) - "
            f"afbeelding {gekozen_afbeelding + 1} wordt gevectoriseerd"
            + (". Kies een andere bij 'Bron'." if len(beelden) > 1 else ""))
        meldingen.append("een geplakte afbeelding is vaak verkleind in het document, dus "
                         "een schaalvermelding erop klopt niet meer - de maatlijnen of "
                         "twee aangeduide punten bepalen de schaal")
        # Een schermafbeelding is kaarsrecht: niet ontschuinen. Een handvol
        # schuine muren zou anders het hele plan een fractie doen kantelen.
        tekening = rasterlaag.vectoriseer(
            beeld, px_per_mm, herkomst="afbeelding-pdf", met_ocr=opties.met_ocr,
            ontschuinen=False, haaks_zetten=opties.haaks_zetten, bron=pad,
            voortgang=voortgang, schoon=True)
        # het formaat op de pagina zegt niets over de echte schaal van het plan
        tekening.papierschaal_betrouwbaar = False
        voorbeeld = beeld

    elif route == "vector-pdf":
        tekening = vectorpdf.lees_vector_pdf(pad, opties.pagina, met_tekst=opties.met_tekst)
        voorbeeld, px_per_mm = rasterlaag.render_pdf_pagina(pad, opties.pagina,
                                                             dpi=_voorbeeld_dpi(tekening))
        naam, orientatie = herken_papierformaat(tekening.blad_breedte_mm, tekening.blad_hoogte_mm)
        if naam:
            meldingen.append(f"blad herkend als {naam} {orientatie}")
        meldingen.append(f"{tekening.aantal_segmenten()} lijnstukken en "
                         f"{len(tekening.teksten)} tekstfragmenten uit de PDF gehaald")
        if vectorpdf.pagina_inhoud(pad, opties.pagina)["lijnen"] == 0:
            meldingen.append("LET OP: deze pagina bevat geen tekenwerk, enkel tekst en "
                             "kaders. Staat het plan op een andere pagina?")

    elif route == "scan-pdf":
        beeld, px_per_mm_bron = rasterlaag.render_pdf_pagina(pad, opties.pagina, dpi=opties.dpi)
        meldingen.append(f"ingescande pagina - gerenderd op {opties.dpi} dpi en gevectoriseerd")
        tekening = rasterlaag.vectoriseer(
            beeld, px_per_mm_bron, herkomst="scan-pdf", met_ocr=opties.met_ocr,
            haaks_zetten=opties.haaks_zetten, bron=pad, voortgang=voortgang)
        voorbeeld, px_per_mm = rasterlaag.render_pdf_pagina(pad, opties.pagina,
                                                             dpi=_voorbeeld_dpi(tekening))

    else:  # foto
        melden("foto inlezen")
        origineel = rasterlaag.laad_afbeelding(pad)
        melden("blad zoeken en rechttrekken")
        recht, px_per_mm_bron = rasterlaag.trek_recht(origineel, papierformaat=opties.papierformaat)
        if recht is not origineel:
            meldingen.append("blad in de foto gevonden en perspectief rechtgetrokken")
        else:
            # geen bladrand: dan het lijnwerk van het plan zelf gebruiken
            melden("perspectief uit het lijnwerk halen")
            recht, gelukt, uitleg = rasterlaag.rectificeer_op_lijnwerk(origineel)
            meldingen.append("geen bladrand gevonden - " +
                             (uitleg if gelukt else f"en {uitleg}"))

        papier_zeker = px_per_mm_bron is not None
        werk_px_per_mm = px_per_mm_bron or (300 / 25.4)

        melden("vouwen in het papier opsporen")
        ontvouwd, vouw_ok, vouw_uitleg = rasterlaag.ontvouw(recht, werk_px_per_mm)
        meldingen.append(vouw_uitleg)
        if vouw_ok:
            recht = ontvouwd
        if not papier_zeker:
            meldingen.append("papierformaat onbekend - de bladverhouding is wel naar een "
                             "standaardformaat getrokken. Kies het formaat (A3, A4, ...) "
                             "voor het scherpste resultaat, of duid twee punten aan met "
                             "een gekende maat.")
        tekening = rasterlaag.vectoriseer(
            recht, werk_px_per_mm, herkomst="foto", met_ocr=opties.met_ocr,
            haaks_zetten=opties.haaks_zetten, bron=pad, voortgang=voortgang)
        tekening.papierschaal_betrouwbaar = papier_zeker
        voorbeeld = recht
        px_per_mm = werk_px_per_mm

    meldingen.extend(tekening.notities)
    kandidaten = schaallaag.bepaal_schaal(tekening)

    if (route == "vector-pdf" and opties.met_ocr
            and (not kandidaten or kandidaten[0].vertrouwen < 0.75)):
        # CAD-programma's exporteren maatgetallen vaak als lijntjes (een
        # lijnlettertype) in plaats van als tekst. Dan zitten ze wel in de
        # tekening, maar leest de PDF-tekst ze niet. Lees de pagina dan als
        # beeld: de posities komen in dezelfde papiermillimeters uit, en de
        # maatlijnen zelf zijn exact - dus de schaal ook.
        melden("getekende maatgetallen lezen")
        beeld, px_per_mm_ocr = rasterlaag.render_pdf_pagina(pad, opties.pagina, dpi=300)
        tekening.schaalteksten = rasterlaag.lees_tekst_ocr(beeld, px_per_mm_ocr)
        nieuwe = schaallaag.bepaal_schaal(tekening)
        if nieuwe and (not kandidaten or nieuwe[0].vertrouwen > kandidaten[0].vertrouwen):
            kandidaten = nieuwe
            meldingen.append(f"maatgetallen staan als lijnwerk in de PDF - "
                             f"{len(tekening.schaalteksten)} woorden gelezen op de "
                             "gerenderde pagina om de schaal te bepalen")
    if not kandidaten:
        meldingen.append("geen schaal gevonden op het blad - duid twee punten aan "
                         "met een gekende maat")

    return Analyse(
        bestand=pad,
        route=route,
        tekening=tekening,
        kandidaten=kandidaten,
        voorbeeld=voorbeeld,
        px_per_mm_voorbeeld=px_per_mm,
        meldingen=meldingen,
        pagina=opties.pagina,
        afbeelding=gekozen_afbeelding,
    )


def converteer(analyse: Analyse,
               schaalnoemer: float,
               opties: Optional[Opties] = None) -> dict:
    """Schrijf de DXF (en optioneel DWG) weg op ware grootte."""
    opties = opties or Opties()
    map_ = opties.uitvoermap or os.path.dirname(os.path.abspath(analyse.bestand))
    os.makedirs(map_, exist_ok=True)
    basis = os.path.splitext(os.path.basename(analyse.bestand))[0]
    achtervoegsel = f"_p{analyse.pagina + 1}" if analyse.pagina else ""
    if analyse.afbeelding is not None:
        achtervoegsel += f"_afb{analyse.afbeelding + 1}"
    dxf_pad = _vrij_pad(os.path.join(map_, f"{basis}{achtervoegsel}_1op1.dxf"))

    resultaat = schrijf_dxf(
        analyse.tekening, dxf_pad, schaalnoemer,
        met_tekst=opties.met_tekst,
        met_controlevierkant=opties.controlevierkant,
        dxf_versie=opties.dxf_versie,
    )
    resultaat["route"] = analyse.route
    resultaat["bron"] = analyse.bestand
    resultaat["dwg"] = None
    resultaat["waarschuwingen"] = []

    if opties.dwg:
        try:
            resultaat["dwg"] = dxf_naar_dwg(dxf_pad)
        except ODANietGevonden as exc:
            resultaat["waarschuwingen"].append(str(exc))
        except Exception as exc:  # pragma: no cover
            resultaat["waarschuwingen"].append(f"DWG-omzetting mislukt: {exc}")

    return resultaat


def _vrij_pad(pad: str) -> str:
    if not os.path.exists(pad):
        return pad
    basis, ext = os.path.splitext(pad)
    n = 2
    while os.path.exists(f"{basis}_{n}{ext}"):
        n += 1
    return f"{basis}_{n}{ext}"
