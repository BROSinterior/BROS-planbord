#!/bin/bash
# BROS verwerkingscomputer — installatie op de Mac mini (Apple Silicon, macOS). Zie LEESMIJ.md.
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

echo "1/5 Programma's (Homebrew): ffmpeg, whisper.cpp, python"
brew install ffmpeg whisper-cpp python@3.12 >/dev/null || brew upgrade ffmpeg whisper-cpp >/dev/null || true
PY="$(brew --prefix)/bin/python3"; [ -x "$PY" ] || PY="$(command -v python3)"
WCLI="$(command -v whisper-cli || true)"; [ -n "$WCLI" ] || { echo "whisper-cli niet gevonden na 'brew install whisper-cpp' — zie LEESMIJ.md"; exit 1; }
echo "  python: $PY · whisper-cli: $WCLI"

echo "2/5 Spraakmodel en stiltedetectie"
download "$HF/ggml-large-v3-turbo-q5_0.bin" "$MOD/ggml-large-v3-turbo-q5_0.bin" "e050f7970618a659205450ad97eb95a18d69c9ee"
download "$VAD_URL" "$MOD/ggml-silero-v6.2.0.bin"

echo "3/5 Programma en instellingen"
cp "$HIER/bros_verwerker.py" "$APP/bros_verwerker.py"
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

echo "4/5 Geheimen in de sleutelhanger (dienst BROS-verwerker)"
if security find-generic-password -s BROS-verwerker -a supabase-wachtwoord >/dev/null 2>&1; then echo "  wachtwoord verwerkingslogin: aanwezig"
else echo "  Wachtwoord van de verwerkingslogin (je ziet niets tijdens het typen):"; security add-generic-password -U -s BROS-verwerker -a supabase-wachtwoord -w; fi
if security find-generic-password -s BROS-verwerker -a anthropic-api-key >/dev/null 2>&1; then echo "  Anthropic API-sleutel: aanwezig"
else read -r -p "  Anthropic API-sleutel instellen voor het conceptverslag? (j/n) " JN; if [ "$JN" = "j" ]; then echo "  API-sleutel (sk-ant-…):"; security add-generic-password -U -s BROS-verwerker -a anthropic-api-key -w; else echo "  overgeslagen: enkel transcript (later: security add-generic-password -U -s BROS-verwerker -a anthropic-api-key -w)"; fi; fi

echo "5/5 Automatisch starten (LaunchAgent be.bros.verwerker)"
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
launchctl bootout "gui/$(id -u)/be.bros.verwerker" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo
"$PY" "$APP/bros_verwerker.py" controle || true
echo
echo "Klaar. Logboek: $LOG"
echo "Nog zelf te doen (LEESMIJ.md §4): Systeeminstellingen › Energie › 'Start automatisch op na stroomonderbreking' en 'Voorkom automatisch in slaap gaan' aan. FileVault blijft aan."
