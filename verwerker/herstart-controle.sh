#!/bin/bash
# BROS verwerker — controle: start de Mac mini vanzelf terug op na een stroomonderbreking? (alleen lezen, verandert niets)
ok() { echo "  ✓ $1"; }; nok() { echo "  ✗ $1"; }
echo "Mac mini — herstarten na een stroomonderbreking"
AR=$(pmset -g 2>/dev/null | awk '/autorestart/ {print $2}')
[ "$AR" = "1" ] && ok "start zelf op na stroomonderbreking" || nok "start NIET zelf op (Systeeminstellingen › Energie, of: sudo pmset -a autorestart 1)"
SL=$(pmset -g 2>/dev/null | awk '$1 == "sleep" {print $2}')
[ "$SL" = "0" ] && ok "valt niet in slaap" || nok "slaapt na ${SL:-?} min (sudo pmset -a sleep 0 disksleep 0 womp 1)"
AL=$(defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null || true)
[ -n "$AL" ] && ok "logt automatisch in als $AL" || nok "logt niet automatisch in — na een panne moet iemand inloggen (zie verwerker/HERSTARTEN.md)"
FV=$(fdesetup status 2>/dev/null || true); echo "  · FileVault: ${FV:-onbekend}"
launchctl print "gui/$(id -u)/be.bros.verwerker" >/dev/null 2>&1 && ok "dienst be.bros.verwerker draait" || nok "dienst be.bros.verwerker draait niet (bash verwerker/installeer.sh)"
