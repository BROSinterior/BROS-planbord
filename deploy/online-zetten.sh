#!/bin/bash
# =====================================================================
#  BROS Planbord — databasescripts en Drive-script online zetten (1.73, voorbereiding)
#  Draai dit op de Mac mini (of je laptop) NA "git pull", in de map van de repository:
#      bash deploy/online-zetten.sh
#  Het script doet niets zonder jouw akkoord: bij elke stap typ je "ja".
#   1. Databank: toont welke scripts in sql/ nog niet uitgevoerd zijn (hoger dan de schemaversie) en voert ze in volgorde uit.
#   2. Drive-script: zet drive/Code.gs in het Apps Script-project (clasp push) en werkt de bestaande deployment bij
#      (dezelfde webapp-URL, dus niets te wijzigen in het Planbord).
#  Geheimen staan enkel in de Keychain van deze Mac (dienst BROS-deploy) — zie deploy/LEESMIJ.md voor de eenmalige installatie.
# =====================================================================
set -uo pipefail
cd "$(dirname "$0")/.."
REPO=$(pwd)
vraag() { local a; read -r -p "$1 (ja/nee) " a; [ "$a" = "ja" ]; }
geheim() { security find-generic-password -s BROS-deploy -a "$1" -w 2>/dev/null || true; }

echo "BROS Planbord — online zetten"
echo "  repository: $REPO ($(git rev-parse --short HEAD 2>/dev/null || echo '?'))"
if [ -n "$(git status --porcelain 2>/dev/null | grep -v '^??' || true)" ]; then echo "  Let op: er zijn niet-gecommitte wijzigingen. Eerst committen en pushen."; vraag "Toch verdergaan?" || exit 1; fi
VERSIE=$(sed -n 's/^const APP_VERSION = "\([0-9.]*\)";.*/\1/p' app.js | head -1); echo "  Planbord-versie in de code: $VERSIE"

# ---------- 1. databankscripts ----------
echo; echo "== 1. Databank =="
DB=$(geheim supabase-db-url)
if [ -z "$DB" ]; then echo "  Geen verbinding ingesteld (Keychain BROS-deploy / supabase-db-url) — stap overgeslagen. Zie deploy/LEESMIJ.md."
elif ! command -v psql >/dev/null; then echo "  psql ontbreekt (brew install libpq && brew link --force libpq) — stap overgeslagen."
else
  NU=$(psql "$DB" -tAc "select coalesce((value->>'versie_schema')::int, 0) from public.instellingen where key = 'app'" 2>/dev/null || echo "")
  if ! [[ "$NU" =~ ^[0-9]+$ ]]; then echo "  Kon de schemaversie niet lezen — controleer de verbinding."; else
    echo "  schemaversie nu: $NU"
    TE_DOEN=()
    for f in sql/[0-9][0-9][0-9]_*.sql; do n=$((10#$(basename "$f" | cut -c1-3))); [ "$n" -gt "$NU" ] && TE_DOEN+=("$f"); done
    if [ ${#TE_DOEN[@]} -eq 0 ]; then echo "  Alles is al uitgevoerd."; else
      printf '  nog uit te voeren:\n'; printf '    %s\n' "${TE_DOEN[@]}"
      if vraag "  Deze ${#TE_DOEN[@]} script(s) nu uitvoeren, in deze volgorde?"; then
        for f in "${TE_DOEN[@]}"; do
          echo "  → $f"
          if ! psql "$DB" -v ON_ERROR_STOP=1 -q -f "$f" | tail -3; then echo "  FOUT in $f — gestopt. Niets van de volgende scripts is uitgevoerd."; exit 1; fi
        done
        echo "  schemaversie nu: $(psql "$DB" -tAc "select (value->>'versie_schema') from public.instellingen where key = 'app'")"
      fi
    fi
  fi
fi

# ---------- 2. Drive-script ----------
echo; echo "== 2. Drive-script =="
MAP="$HOME/bros-deploy/drive-script"; DEPLOY_ID=$(geheim drive-deployment-id)
if ! command -v clasp >/dev/null; then echo "  clasp ontbreekt (npm install -g @google/clasp) — stap overgeslagen."
elif [ ! -f "$MAP/.clasp.json" ]; then echo "  Nog niet ingesteld ($MAP met clasp clone) — stap overgeslagen. Zie deploy/LEESMIJ.md."
elif [ -z "$DEPLOY_ID" ]; then echo "  Deployment-id ontbreekt (Keychain BROS-deploy / drive-deployment-id) — stap overgeslagen."
else
  ONLINE="$MAP/Code.js"; [ -f "$MAP/Code.gs" ] && ONLINE="$MAP/Code.gs"
  (cd "$MAP" && clasp pull >/dev/null 2>&1) || true
  if [ -f "$ONLINE" ] && cmp -s "$ONLINE" drive/Code.gs; then echo "  Het Drive-script online is al gelijk aan drive/Code.gs."
  else
    [ -f "$ONLINE" ] && echo "  Verschil met online: $(diff "$ONLINE" drive/Code.gs | grep -c '^[<>]') regels."
    if grep -q '"VUL-IN"' drive/Code.gs && ! grep -q 'instelling("PROJECTEN_FOLDER_ID"' drive/Code.gs; then echo "  drive/Code.gs is een oude versie met VUL-IN-waarden — gestopt."; exit 1; fi
    if vraag "  drive/Code.gs online zetten en de deployment bijwerken (zelfde webapp-URL)?"; then
      cp drive/Code.gs "$ONLINE" && (cd "$MAP" && clasp push -f && clasp deploy -i "$DEPLOY_ID" -d "Planbord $VERSIE ($(date +%Y-%m-%d))") \
        && echo "  Drive-script online (versie $VERSIE)." || { echo "  FOUT bij clasp — controleer 'clasp login' en de deployment-id."; exit 1; }
    fi
  fi
fi
echo; echo "Klaar."
