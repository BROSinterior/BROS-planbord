"""Commandolijn van Plan2CAD - handig om een hele map in een keer om te zetten."""

from __future__ import annotations

import argparse
import glob
import os
import sys

from . import __version__
from .dwguit import status as oda_status
from .pijplijn import AFBEELDINGEN, Opties, analyseer, converteer
from .units import PAPIERFORMATEN


def bouw_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="plan2cad",
        description="Zet plannen (PDF, scan of foto) om naar DXF/DWG op ware grootte (1:1, mm).",
    )
    p.add_argument("bestanden", nargs="*", help="bestanden of mappen")
    p.add_argument("--venster", action="store_true", help="open het app-venster")
    p.add_argument("--schaal", type=float, default=None,
                   help="schaalnoemer opleggen, bv. 50 voor 1/50")
    p.add_argument("--pagina", type=int, default=1, help="paginanummer van de PDF (vanaf 1)")
    p.add_argument("--afbeelding", type=int, default=None,
                   help="welke geplakte afbeelding op de pagina (vanaf 1) - voor verslagen en "
                        "offertes met plannetjes als afbeelding; standaard de grootste")
    p.add_argument("--bronnen", action="store_true",
                   help="toon wat er in het bestand apart om te zetten valt, en stop")
    p.add_argument("--papier", default=None,
                   help="papierformaat van een foto, bv. A3 - maakt het rechttrekken exact")
    p.add_argument("--dpi", type=int, default=300, help="renderresolutie voor ingescande PDF's")
    p.add_argument("--dwg", action="store_true", help="ook een DWG maken (vereist ODA File Converter)")
    p.add_argument("--geen-tekst", action="store_true", help="tekst niet meenemen")
    p.add_argument("--geen-haaks", action="store_true", help="niet automatisch haaks zetten")
    p.add_argument("--geen-controle", action="store_true", help="geen controlevierkant toevoegen")
    p.add_argument("--uit", default=None, help="uitvoermap (standaard: naast het origineel)")
    p.add_argument("--info", action="store_true", help="enkel analyseren, niets wegschrijven")
    p.add_argument("--ook-bij-twijfel", action="store_true",
                   help="omzetten ook als de gevonden schaal onzeker is")
    p.add_argument("--versie", action="version", version=f"Plan2CAD {__version__}")
    return p


ZEKER_GENOEG = 0.75


def _verzamel(paden):
    uit = []
    for pad in paden:
        if os.path.isdir(pad):
            gevonden = set()
            for naam in sorted(os.listdir(pad)):
                if os.path.splitext(naam)[1].lower() in {".pdf"} | AFBEELDINGEN:
                    gevonden.add(os.path.join(pad, naam))
            uit.extend(sorted(gevonden))
        else:
            uit.append(pad)
    return uit


def main(argv=None) -> int:
    args = bouw_parser().parse_args(argv)

    if args.venster or not args.bestanden:
        try:
            from .venster import start
        except ImportError:
            print("Het app-venster vereist PySide6:  pip install PySide6", file=sys.stderr)
            return 2
        start()
        return 0

    papier = args.papier
    if papier:
        overeenkomst = {n.lower(): n for n in PAPIERFORMATEN}.get(papier.strip().lower())
        if overeenkomst is None:
            print(f"Onbekend papierformaat '{papier}'. Kies uit: "
                  + ", ".join(PAPIERFORMATEN), file=sys.stderr)
            return 2
        papier = overeenkomst

    if args.bronnen:
        from .pijplijn import bronnen
        for pad in _verzamel(args.bestanden):
            print(f"\n== {os.path.basename(pad)}")
            for b in bronnen(pad):
                vlag = f"--pagina {b['pagina'] + 1}"
                if b["afbeelding"] is not None:
                    vlag += f" --afbeelding {b['afbeelding'] + 1}"
                print(f"   {b['label']:<45} {vlag}")
        return 0

    opties = Opties(
        pagina=max(0, args.pagina - 1),
        afbeelding=(args.afbeelding - 1) if args.afbeelding else None,
        dpi=args.dpi,
        papierformaat=papier,
        met_tekst=not args.geen_tekst,
        haaks_zetten=not args.geen_haaks,
        controlevierkant=not args.geen_controle,
        dwg=args.dwg,
        uitvoermap=args.uit,
    )

    if args.dwg and not oda_status()["beschikbaar"]:
        print("Let op: de ODA File Converter is niet gevonden, er komt enkel een DXF.\n"
              f"        Downloaden kan via {oda_status()['download']}\n")

    fouten = 0
    for pad in _verzamel(args.bestanden):
        print(f"\n== {os.path.basename(pad)}")
        try:
            analyse = analyseer(pad, opties)
        except Exception as exc:
            print(f"   overgeslagen: {exc}")
            fouten += 1
            continue

        print(f"   route: {analyse.route}")
        for melding in analyse.meldingen:
            print(f"   · {melding}")
        for kandidaat in analyse.kandidaten[:3]:
            print(f"   schaal: {kandidaat}")
            print(f"           {kandidaat.toelichting}")

        if args.info:
            continue

        noemer = args.schaal
        if noemer is None:
            if not analyse.kandidaten:
                print("   geen schaal gevonden - geef er zelf een op met --schaal, "
                      "of gebruik het venster om twee punten aan te duiden")
                fouten += 1
                continue
            # Een onzekere schaal stil gebruiken is het gevaarlijkste wat deze
            # tool kan doen: de DXF ziet er dan perfect uit maar alle maten
            # kloppen niet. Liever niets afleveren dan iets verkeerds.
            if analyse.beste.vertrouwen < ZEKER_GENOEG and not args.ook_bij_twijfel:
                print(f"   OVERGESLAGEN: de schaal is te onzeker "
                      f"({int(analyse.beste.vertrouwen * 100)}% - {analyse.beste}).")
                print("   Geef de schaal op met --schaal, duid twee punten aan in het "
                      "venster, of gebruik --ook-bij-twijfel als je het toch wil.")
                fouten += 1
                continue
            noemer = analyse.beste.noemer

        resultaat = converteer(analyse, noemer, opties)
        print(f"   -> {resultaat['pad']}")
        print(f"      {resultaat['polylijnen']} lijnobjecten, {resultaat['teksten']} teksten, "
              f"{resultaat['breedte_mm'] / 1000:.2f} x {resultaat['hoogte_mm'] / 1000:.2f} m")
        if resultaat.get("dwg"):
            print(f"   -> {resultaat['dwg']}")
        for waarschuwing in resultaat.get("waarschuwingen", []):
            print(f"      let op: {waarschuwing}")

    return 1 if fouten else 0


if __name__ == "__main__":
    sys.exit(main())
