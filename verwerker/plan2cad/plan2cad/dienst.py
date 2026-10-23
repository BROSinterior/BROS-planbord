"""Plan2CAD als dienst, zonder venster - voor de verwerkingscomputer van het BROS Planbord.

De verwerkingscomputer (Mac mini) roept dit op als apart proces, per opdracht uit de
wachtrij van het Planbord:

    python -m plan2cad.dienst PLAN.pdf --uit MAP [--paginas alle] [--papier A3]
                                        [--schaal 50] [--alleen 2:1] [--dwg]

Per bron (pagina, of geplakte afbeelding op een pagina) wordt het plan gelezen, de schaal
gezocht en een DXF (en eventueel DWG) op ware grootte geschreven. Voortgang en resultaat
gaan als regels naar stdout:

    P2C-VOORTGANG 0.40 Pagina 2 - vectorplan: schaal zoeken
    P2C-RESULTAAT {...json...}

Een schaal die niet zeker genoeg is, wordt NIET stil gebruikt als echte schaal: de DXF komt
er dan voorlopig (met de beste gok, of op papiermaat) en het resultaat zegt 'zeker: false',
zodat het Planbord vraagt om de schaal te bevestigen of twee punten aan te duiden.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
from typing import List, Optional

from .pijplijn import Opties, analyseer, bronnen, converteer
from .units import PAPIERFORMATEN, formatteer_schaal

ZEKER_GENOEG = 0.75
MAX_BRONNEN = 12


def _meld(voortgang: float, tekst: str) -> None:
    print(f"P2C-VOORTGANG {max(0.0, min(1.0, voortgang)):.3f} {tekst}", flush=True)


def kies_bronnen(pad: str, spec: str, alleen: Optional[str] = None) -> List[dict]:
    """Welke bronnen omzetten.

    spec: "alle" (elke bruikbare pagina/afbeelding), "1", "1-3", "1,4".
    alleen: "pagina:afbeelding" (vanaf 1, afbeelding mag leeg) - precies die ene bron,
    voor het opnieuw omzetten op een andere schaal.
    """
    lijst = bronnen(pad)
    if alleen:
        delen = (alleen.split(":") + [""])[:2]
        pagina = int(delen[0]) - 1
        afbeelding = int(delen[1]) - 1 if delen[1].strip() else None
        gekozen = [b for b in lijst if b["pagina"] == pagina and b["afbeelding"] == afbeelding]
        if not gekozen:
            raise ValueError(f"Bron {alleen} bestaat niet (meer) in dit bestand.")
        return gekozen

    spec = (spec or "alle").strip().lower()
    if spec in ("", "alle", "*"):
        gekozen = [b for b in lijst if b.get("bruikbaar", True)] or lijst[:1]
    else:
        paginas = set()
        for deel in spec.replace(";", ",").replace(" ", ",").split(","):
            if not deel:
                continue
            if "-" in deel:
                a, b = deel.split("-", 1)
                paginas.update(range(int(a), int(b) + 1))
            else:
                paginas.add(int(deel))
        gekozen = [b for b in lijst if b["pagina"] + 1 in paginas]
        if not gekozen:
            raise ValueError(f"Geen van de pagina's '{spec}' bestaat in dit bestand "
                             f"({len({b['pagina'] for b in lijst})} pagina's).")
    return gekozen[:MAX_BRONNEN]


def _kandidaat_json(k) -> dict:
    return {
        "noemer": round(float(k.noemer), 4),
        "standaard": float(k.standaardnoemer) if k.standaardnoemer else None,
        "vertrouwen": round(float(k.vertrouwen), 3),
        "methode": k.methode,
        "tekst": str(k),
        "toelichting": k.toelichting,
    }


def zet_om(pad: str, uit: str, paginas: str = "alle", papier: Optional[str] = None,
           schaal: Optional[float] = None, alleen: Optional[str] = None,
           dwg: bool = False) -> dict:
    os.makedirs(uit, exist_ok=True)
    if papier:
        overeenkomst = {n.lower(): n for n in PAPIERFORMATEN}.get(papier.strip().lower())
        papier = overeenkomst  # onbekend formaat = automatisch

    _meld(0.02, "bestand overlopen")
    lijst = kies_bronnen(pad, paginas, alleen)
    resultaten = []
    for i, bron in enumerate(lijst):
        basis = i / len(lijst)
        stap = 1.0 / len(lijst)
        label = bron["label"]
        opties = Opties(pagina=bron["pagina"], afbeelding=bron["afbeelding"],
                        papierformaat=papier, dwg=dwg, uitvoermap=uit)

        def voortgang(tekst, basis=basis, stap=stap, label=label):
            _meld(basis + stap * 0.4, f"{label}: {tekst}")

        res = {"label": label, "pagina": bron["pagina"] + 1,
               "afbeelding": None if bron["afbeelding"] is None else bron["afbeelding"] + 1,
               "route": bron["route"]}
        try:
            _meld(basis + stap * 0.05, f"{label}: inlezen")
            analyse = analyseer(pad, opties, voortgang=voortgang)
            kandidaten = [_kandidaat_json(k) for k in analyse.kandidaten[:5]]
            beste = analyse.beste
            if schaal:
                noemer, keuze, zeker = float(schaal), "opgegeven", True
            elif beste is not None and beste.vertrouwen >= ZEKER_GENOEG:
                noemer, keuze, zeker = float(beste.noemer), "automatisch", True
            elif beste is not None:
                noemer, keuze, zeker = float(beste.noemer), "voorlopig", False
            else:
                noemer, keuze, zeker = 1.0, "papiermaat", False

            _meld(basis + stap * 0.85, f"{label}: DXF schrijven")
            uitvoer = converteer(analyse, noemer, opties)
            res.update({
                "ok": True,
                "noemer": round(noemer, 4),
                "schaal_tekst": formatteer_schaal(noemer) if noemer != 1.0 else "papiermaat (1:1 met het blad)",
                "keuze": keuze,
                "zeker": zeker,
                "vertrouwen": round(float(beste.vertrouwen), 3) if beste is not None else 0.0,
                "kandidaten": kandidaten,
                "meldingen": list(analyse.meldingen),
                "dxf": uitvoer["pad"],
                "dwg": uitvoer.get("dwg"),
                "waarschuwingen": uitvoer.get("waarschuwingen", []),
                "polylijnen": uitvoer.get("polylijnen", 0),
                "vlakken": uitvoer.get("vlakken", 0),
                "teksten": uitvoer.get("teksten", 0),
                "breedte_mm": round(float(uitvoer.get("breedte_mm", 0.0)), 1),
                "hoogte_mm": round(float(uitvoer.get("hoogte_mm", 0.0)), 1),
            })
        except Exception as exc:   # een bron die mislukt, mag de andere niet tegenhouden
            res.update({"ok": False, "fout": f"{type(exc).__name__}: {exc}",
                        "detail": traceback.format_exc()[-2000:]})
        resultaten.append(res)
        _meld(basis + stap, f"{label}: klaar")

    return {"ok": any(r.get("ok") for r in resultaten), "resultaten": resultaten}


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="plan2cad.dienst")
    p.add_argument("bestand")
    p.add_argument("--uit", required=True)
    p.add_argument("--paginas", default="alle")
    p.add_argument("--papier", default=None)
    p.add_argument("--schaal", type=float, default=None)
    p.add_argument("--alleen", default=None, help="pagina:afbeelding (vanaf 1)")
    p.add_argument("--dwg", action="store_true")
    args = p.parse_args(argv)
    try:
        uit = zet_om(args.bestand, args.uit, args.paginas, args.papier,
                     args.schaal if args.schaal and args.schaal > 0 else None,
                     args.alleen, args.dwg)
    except Exception as exc:
        uit = {"ok": False, "fout": f"{type(exc).__name__}: {exc}", "detail": traceback.format_exc()[-2000:],
               "resultaten": []}
    print("P2C-RESULTAAT " + json.dumps(uit, ensure_ascii=False), flush=True)
    return 0 if uit.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
