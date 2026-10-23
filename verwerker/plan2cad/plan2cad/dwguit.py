"""DXF omzetten naar DWG met de (gratis) ODA File Converter.

Er bestaat geen open manier om DWG te schrijven: DWG is een gesloten formaat
van Autodesk. De ODA File Converter is de gratis, officiele omweg. Zonder die
tool blijft de DXF over - die opent even goed in Vectorworks en AutoCAD.
"""

from __future__ import annotations

import glob
import os
import shutil
import subprocess
import tempfile
from typing import Optional

MAC_ZOEKPADEN = [
    "/Applications/ODAFileConverter.app/Contents/MacOS/ODAFileConverter",
    "/Applications/ODAFileConverter*.app/Contents/MacOS/ODAFileConverter",
    "/Applications/ODA/ODAFileConverter*/ODAFileConverter.app/Contents/MacOS/ODAFileConverter",
    os.path.expanduser("~/Applications/ODAFileConverter*.app/Contents/MacOS/ODAFileConverter"),
]

DOWNLOAD_URL = "https://www.opendesign.com/guestfiles/oda_file_converter"


class ODANietGevonden(RuntimeError):
    pass


def zoek_oda() -> Optional[str]:
    """Zoek het uitvoerbare bestand van de ODA File Converter."""
    uit_omgeving = os.environ.get("ODA_FILE_CONVERTER")
    if uit_omgeving and os.path.exists(uit_omgeving):
        return uit_omgeving
    for patroon in MAC_ZOEKPADEN:
        for treffer in sorted(glob.glob(patroon), reverse=True):
            if os.path.exists(treffer):
                return treffer
    for naam in ("ODAFileConverter", "ODAFileConverter.exe"):
        pad = shutil.which(naam)
        if pad:
            return pad
    return None


def dxf_naar_dwg(dxf_pad: str,
                 dwg_pad: Optional[str] = None,
                 versie: str = "ACAD2018",
                 timeout: int = 180) -> str:
    """Zet een DXF om naar DWG. Geeft het pad naar de DWG terug."""
    oda = zoek_oda()
    if not oda:
        raise ODANietGevonden(
            "De ODA File Converter is niet gevonden. Installeer hem gratis via "
            f"{DOWNLOAD_URL} (of zet ODA_FILE_CONVERTER naar het pad). "
            "Zonder deze tool krijg je enkel de DXF - Vectorworks en AutoCAD "
            "importeren die probleemloos op ware grootte."
        )

    dxf_pad = os.path.abspath(dxf_pad)
    if dwg_pad is None:
        dwg_pad = os.path.splitext(dxf_pad)[0] + ".dwg"
    dwg_pad = os.path.abspath(dwg_pad)

    with tempfile.TemporaryDirectory() as invoer, tempfile.TemporaryDirectory() as uitvoer:
        tijdelijke_dxf = os.path.join(invoer, os.path.basename(dxf_pad))
        shutil.copy2(dxf_pad, tijdelijke_dxf)

        commando = [oda, invoer, uitvoer, versie, "DWG", "0", "1", "*.DXF"]
        try:
            subprocess.run(commando, timeout=timeout,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("De ODA File Converter reageerde niet binnen de tijd.") from exc

        gemaakt = glob.glob(os.path.join(uitvoer, "*.dwg")) + glob.glob(os.path.join(uitvoer, "*.DWG"))
        if not gemaakt:
            raise RuntimeError(
                "De ODA File Converter heeft geen DWG geproduceerd. "
                "Start hem een keer manueel op zodat de licentievoorwaarden aanvaard zijn."
            )
        shutil.move(gemaakt[0], dwg_pad)
    return dwg_pad


def status() -> dict:
    pad = zoek_oda()
    return {
        "beschikbaar": pad is not None,
        "pad": pad,
        "download": DOWNLOAD_URL,
    }
