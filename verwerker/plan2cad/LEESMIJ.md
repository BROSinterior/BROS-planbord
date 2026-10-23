# Plan2CAD (kopie voor de verwerkingscomputer)

Dit is een kopie van het pakket `plan2cad` uit de Plan2CAD-app (`~/Applications/Plan2CAD/plan2cad` op de MacBook van Phil),
zonder het venster. De verwerkingscomputer roept het aan als apart proces:

    python -m plan2cad.dienst PLAN.pdf --uit MAP [--paginas alle] [--papier A3] [--schaal 50] [--alleen 2:1] [--dwg]

`installeer.sh` (map erboven) kopieert dit naar `~/Library/Application Support/BROS-verwerker/plan2cad` en maakt er een eigen
Python-omgeving voor (`plan2cad-venv`). Wordt Plan2CAD verbeterd, zet dan de nieuwe `plan2cad/*.py` hier én in de app,
en voer `installeer.sh` opnieuw uit op de Mac mini.
