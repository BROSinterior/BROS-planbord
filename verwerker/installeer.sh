#!/bin/bash
# BROS verwerkingscomputer — installatie op de Mac mini (Apple Silicon, macOS). Zie LEESMIJ.md.
# Vergaderingen & opnames (script 051), sinds 1.57 Plannen omzetten met Plan2CAD (script 054) en sinds 1.59 Renders (script 055).
#   bash installeer.sh              installeren of bijwerken (vraagt de instellingen en geheimen)
#   bash installeer.sh --modellen   extra spraakmodellen downloaden voor de praktijktest (meet)
# Verandert geen systeeminstellingen (energie, FileVault, gebruikers): die zet je zelf, zie LEESMIJ.md §4.
set -euo pipefail
HIER="$(cd "$(dirname "$0")" && pwd)"
APP="$HOME/Library/Application Support/BROS-verwerker"
MOD="$APP/modellen"
PLIST="$HOME/Library/LaunchAgents/be.bros.verwerker.plist"
LOG="$HOME/Library/Logs/BROS-verwerker.log"
HF="https://huggingface.co/ggerganov/whisper.cpp/resolve/main"
VAD_URL="https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin"

[ "$(uname -s)" = "Darwin" ] || { echo "Dit script is voor macOS."; exit 1; }
[ "$(uname -m)" = "arm64" ] || echo "Let op: geen Apple Silicon (arm64) — whisper.cpp draait dan zonder Metal en veel trager."
command -v brew >/dev/null || { echo "Installeer eerst Homebrew: https://brew.sh"; exit 1; }
mkdir -p "$MOD" "$HOME/Library/Logs" "$HOME/Library/LaunchAgents"

download() {   # url doel [sha1]
  if [ -s "$2" ]; then echo "  aanwezig: $(basename "$2")"; else echo "  downloaden: $(basename "$2")"; curl -fL --retry 3 -C - -o "$2.part" "$1" && mv "$2.part" "$2"; fi
  if [ -n "${3:-}" ]; then echo "$3  $2" | shasum -a 1 -c - >/dev/null && echo "  controlegetal ok" || { echo "  FOUT: controlegetal klopt niet voor $(basename "$2") — verwijder het bestand en probeer opnieuw"; exit 1; }; fi
}

if [ "${1:-}" = "--modellen" ]; then
  echo "Extra modellen voor de praktijktest:"
  download "$HF/ggml-large-v3-turbo-q8_0.bin" "$MOD/ggml-large-v3-turbo-q8_0.bin"
  download "$HF/ggml-medium-q5_0.bin" "$MOD/ggml-medium-q5_0.bin"
  echo "Klaar. Vergelijk met: python3 \"$APP/bros_verwerker.py\" meet OPNAME --modellen \"$MOD/ggml-large-v3-turbo-q5_0.bin,$MOD/ggml-large-v3-turbo-q8_0.bin,$MOD/ggml-medium-q5_0.bin\""
  exit 0
fi

echo "1/6 Programma's (Homebrew): ffmpeg, whisper.cpp, python, tesseract"
brew install ffmpeg whisper-cpp python@3.12 tesseract tesseract-lang >/dev/null || brew upgrade ffmpeg whisper-cpp tesseract >/dev/null || true
PY="$(brew --prefix)/bin/python3"; [ -x "$PY" ] || PY="$(command -v python3)"
WCLI="$(command -v whisper-cli || true)"; [ -n "$WCLI" ] || { echo "whisper-cli niet gevonden na 'brew install whisper-cpp' — zie LEESMIJ.md"; exit 1; }
echo "  python: $PY · whisper-cli: $WCLI"

echo "2/6 Spraakmodel en stiltedetectie"
download "$HF/ggml-large-v3-turbo-q5_0.bin" "$MOD/ggml-large-v3-turbo-q5_0.bin" "e050f7970618a659205450ad97eb95a18d69c9ee"
download "$VAD_URL" "$MOD/ggml-silero-v6.2.0.bin"

echo "3/6 Programma en instellingen"
cp "$HIER/bros_verwerker.py" "$APP/bros_verwerker.py"
if [ -d "$HIER/render" ]; then   # 1.59: A3-presentaties voor de renders (huisstijl + script)
  rm -rf "$APP/render.nieuw" && cp -R "$HIER/render" "$APP/render.nieuw" && rm -rf "$APP/render" && mv "$APP/render.nieuw" "$APP/render"
  echo "  presentatieprogramma (renders): ok"
fi
if [ ! -f "$APP/config.json" ]; then
  read -r -p "  Supabase Project URL (zoals in config.js): " SBURL
  read -r -p "  Supabase publieke sleutel (anon/publishable, zoals in config.js): " SBKEY
  read -r -p "  E-mailadres van de verwerkingslogin: " MAIL
  read -r -p "  Web app-URL van het Drive-script (Instellingen › Drive; leeg = geen Drive): " DURL
  "$PY" - "$APP/config.json" "$SBURL" "$SBKEY" "$MAIL" "$DURL" "$WCLI" "$MOD" "$(command -v ffmpeg)" "$(command -v ffprobe)" <<'PYEOF'
import json, sys
pad, url, key, mail, durl, wcli, mod, ff, fp = sys.argv[1:]
json.dump({"naam": "macmini", "supabase_url": url.strip(), "supabase_anon_key": key.strip(), "email": mail.strip(), "drive_script_url": durl.strip(),
           "whisper_cli": wcli, "ffmpeg": ff, "ffprobe": fp, "whisper_model": mod + "/ggml-large-v3-turbo-q5_0.bin", "vad_model": mod + "/ggml-silero-v6.2.0.bin",
           "whisper_threads": 4, "deel_minuten": 10, "min_vrij_gb": 15, "llm": {"model": "claude-sonnet-5-5", "tweede_controle": False}}, open(pad, "w"), indent=2)
PYEOF
  chmod 600 "$APP/config.json"
  echo "  config.json gemaakt"
else
  echo "  config.json bestaat al (niet overschreven)"
fi

echo "4/6 Plan2CAD (plannen omzetten naar DXF/DWG, eigen Python-omgeving)"
if [ -d "$HIER/plan2cad/plan2cad" ]; then
  rm -rf "$APP/plan2cad.nieuw" && mkdir -p "$APP/plan2cad.nieuw" && cp -R "$HIER/plan2cad/plan2cad" "$APP/plan2cad.nieuw/plan2cad"
  rm -rf "$APP/plan2cad" && mv "$APP/plan2cad.nieuw" "$APP/plan2cad"
  # 1.58.1: Plan2CAD vraagt Python 3.11 of nieuwer (de vaste PyMuPDF-versie bestaat niet voor de Python 3.9 van macOS)
  NIEUW_PY=""
  for k in "$(brew --prefix)/bin/python3.12" "$(brew --prefix python@3.12 2>/dev/null || true)/bin/python3.12" "$(brew --prefix)/bin/python3" "$(command -v python3.12 || true)" "$PY"; do
    if [ -n "$k" ] && [ -x "$k" ] && "$k" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then NIEUW_PY="$k"; break; fi
  done
  [ -n "$NIEUW_PY" ] || { echo "  FOUT: geen Python 3.11 of nieuwer gevonden. Voer uit: brew install python@3.12 — en daarna dit script opnieuw."; exit 1; }
  if [ -x "$APP/plan2cad-venv/bin/python" ] && ! "$APP/plan2cad-venv/bin/python" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
    echo "  de Python-omgeving van Plan2CAD gebruikte een te oude Python — wordt opnieuw gemaakt"
    rm -rf "$APP/plan2cad-venv"
  fi
  [ -x "$APP/plan2cad-venv/bin/python" ] || "$NIEUW_PY" -m venv "$APP/plan2cad-venv"
  echo "  Python voor Plan2CAD: $("$APP/plan2cad-venv/bin/python" -c 'import sys; print(sys.version.split()[0])')"
  "$APP/plan2cad-venv/bin/python" -m pip install --quiet --upgrade pip
  if "$APP/plan2cad-venv/bin/python" -m pip install --quiet -r "$HIER/plan2cad/requirements.txt"; then echo "  Plan2CAD en zijn Python-pakketten: ok"
  else echo "  FOUT: de Python-pakketten voor Plan2CAD konden niet geïnstalleerd worden (zie hierboven)"; exit 1; fi
  ODA="$(ls -d /Applications/ODAFileConverter*.app "/Applications/ODA File Converter.app" 2>/dev/null | head -1 || true)"
  if [ -n "$ODA" ]; then echo "  ODA File Converter: $ODA (DWG naast de DXF)"
  else echo "  ODA File Converter niet gevonden: enkel DXF. Voor DWG: gratis downloaden via https://www.opendesign.com/guestfiles/oda_file_converter en in Programma's zetten."; fi
else
  echo "  map plan2cad/ ontbreekt naast dit script — Plannen omzetten wordt overgeslagen"
fi

echo "5/6 Geheimen in de sleutelhanger (dienst BROS-verwerker)"
if security find-generic-password -s BROS-verwerker -a supabase-wachtwoord >/dev/null 2>&1; then echo "  wachtwoord verwerkingslogin: aanwezig"
else echo "  Wachtwoord van de verwerkingslogin (je ziet niets tijdens het typen):"; security add-generic-password -U -s BROS-verwerker -a supabase-wachtwoord -w; fi
if security find-generic-password -s BROS-verwerker -a anthropic-api-key >/dev/null 2>&1; then echo "  Anthropic API-sleutel: aanwezig"
else read -r -p "  Anthropic API-sleutel instellen voor het conceptverslag? (j/n) " JN; if [ "$JN" = "j" ]; then echo "  API-sleutel (sk-ant-…):"; security add-generic-password -U -s BROS-verwerker -a anthropic-api-key -w; else echo "  overgeslagen: enkel transcript (later: security add-generic-password -U -s BROS-verwerker -a anthropic-api-key -w)"; fi; fi

if security find-generic-password -s BROS-verwerker -a openai-api-key >/dev/null 2>&1; then echo "  OpenAI API-sleutel (renders): aanwezig"
else read -r -p "  OpenAI API-sleutel instellen voor renders (betaalde beeldgeneratie)? (j/n) " JN; if [ "$JN" = "j" ]; then echo "  OpenAI API-sleutel (sk-…; je ziet niets tijdens het typen):"; security add-generic-password -U -s BROS-verwerker -a openai-api-key -w; else echo "  overgeslagen: renders blijven in de wachtrij tot de sleutel er is (later: security add-generic-password -U -s BROS-verwerker -a openai-api-key -w)"; fi; fi

echo "6/6 Automatisch starten (LaunchAgent be.bros.verwerker)"
cat > "$PLIST" <<PLEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>be.bros.verwerker</string>
  <key>ProgramArguments</key><array><string>$PY</string><string>$APP/bros_verwerker.py</string><string>dienst</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(brew --prefix)/bin:/usr/bin:/bin:/usr/sbin:/sbin</string><key>BROS_LOG</key><string>$LOG</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ExitTimeOut</key><integer>40</integer>
  <key>Nice</key><integer>5</integer>
  <key>ProcessType</key><string>Standard</string>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/BROS-verwerker.launchd.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/BROS-verwerker.launchd.log</string>
</dict></plist>
PLEOF
DIENST="gui/$(id -u)/be.bros.verwerker"
launchctl bootout "$DIENST" 2>/dev/null || true
# bootout loopt asynchroon: eerst wachten tot de vorige dienst echt gestopt is (anders "Bootstrap failed: 5: Input/output error")
for _ in $(seq 1 50); do launchctl print "$DIENST" >/dev/null 2>&1 || break; sleep 1; done
if ! launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null; then
  sleep 5
  if ! launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null && ! launchctl print "$DIENST" >/dev/null 2>&1; then
    echo "  Automatisch starten lukte niet. Herstart de Mac mini, of voer later uit: launchctl bootstrap gui/$(id -u) \"$PLIST\""
  fi
fi
launchctl print "$DIENST" >/dev/null 2>&1 && echo "  dienst be.bros.verwerker: actief"
echo
"$PY" "$APP/bros_verwerker.py" controle || true
echo
echo "Klaar. Logboek: $LOG"
echo "Nog zelf te doen (LEESMIJ.md §4): Systeeminstellingen › Energie › 'Start automatisch op na stroomonderbreking' en 'Voorkom automatisch in slaap gaan' aan. FileVault blijft aan."
