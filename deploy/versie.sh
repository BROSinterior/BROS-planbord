#!/bin/bash
# BROS Planbord — nieuwe versie klaarzetten (1.73): APP_VERSION, alle ?v= in index.html en version.json in één keer.
# Gebruik (in de map van de repository):  bash deploy/versie.sh 1.74.0 "Korte omschrijving voor de update-melding"
# Raakt niets anders aan; commit en push doe je daarna zelf.
set -euo pipefail
cd "$(dirname "$0")/.."
NIEUW="${1:-}"; NOTITIE="${2:-}"
if ! [[ "$NIEUW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then echo "Gebruik: bash deploy/versie.sh 1.74.0 \"omschrijving\""; exit 1; fi
OUD=$(sed -n 's/^const APP_VERSION = "\([0-9.]*\)";.*/\1/p' app.js | head -1)
[ -n "$OUD" ] || { echo "APP_VERSION niet gevonden in app.js"; exit 1; }
echo "Versie $OUD → $NIEUW"
python3 - "$OUD" "$NIEUW" "$NOTITIE" <<'PY'
import json, re, sys, datetime
oud, nieuw, notitie = sys.argv[1], sys.argv[2], sys.argv[3]
s = open("app.js", encoding="utf-8").read()
s = s.replace(f'const APP_VERSION = "{oud}";', f'const APP_VERSION = "{nieuw}";', 1)
open("app.js", "w", encoding="utf-8").write(s)
h = open("index.html", encoding="utf-8").read()
h2, n = re.subn(r'\?v=\d+\.\d+\.\d+', f"?v={nieuw}", h)
open("index.html", "w", encoding="utf-8").write(h2)
v = {"version": nieuw, "date": datetime.date.today().isoformat(), "notes": notitie or f"Versie {nieuw}"}
open("version.json", "w", encoding="utf-8").write(json.dumps(v, ensure_ascii=False))
print(f"  app.js: APP_VERSION = {nieuw}\n  index.html: {n} scriptregels ?v={nieuw}\n  version.json bijgewerkt")
PY
echo "Klaar. Kijk na met: git diff --stat"
