#!/bin/bash
# Alle tests van het Planbord. Gebruik: bash tests/alles.sh   (vereist Postgres 16, Python met psycopg, pyjwt, playwright, Node)
# Op GitHub (GITHUB_ACTIONS) komt elke mislukte controle ook als annotatie bij de run: leesbaar zonder de volledige log te openen.
cd "$(dirname "$0")"; set -o pipefail; fout=0
meld() { [ -n "$GITHUB_ACTIONS" ] && printf '%s\n' "$2" | head -8 | while IFS= read -r l; do echo "::error title=$1::$(printf '%s' "$l" | cut -c1-300)"; done; return 0; }
if [ -z "$PB_OVERSLAAN" ]; then
  python3 voorbereiden.py > /tmp/pbtest-voorbereiden.txt 2>&1; rc=$?; tail -5 /tmp/pbtest-voorbereiden.txt
  if [ $rc -ne 0 ]; then tail -30 /tmp/pbtest-voorbereiden.txt; meld "voorbereiden.py" "$(grep -v '^\s*$' /tmp/pbtest-voorbereiden.txt | tail -8)"; exit 1; fi
fi
for t in t_gs.js t67_gs.js t70_gs.js t73_gs.js t73b_gs.js; do
  [ -f "$t" ] || continue
  echo "== $t"; node $t > /tmp/pbtest-uit.txt 2>&1; rc=$?; tail -1 /tmp/pbtest-uit.txt
  if [ $rc -ne 0 ] || grep -q "✗\|FOUT" /tmp/pbtest-uit.txt; then fout=1; grep "✗" /tmp/pbtest-uit.txt; tail -15 /tmp/pbtest-uit.txt
    meld "$t" "$( (grep "✗" /tmp/pbtest-uit.txt; [ $rc -ne 0 ] && tail -6 /tmp/pbtest-uit.txt) )"; fi
done
for t in t66_sql.py t68_sql.py t_smoke.py t66_portaal.py t66_yuki.py t67_ui.py t68_ui.py t69_ui.py t7*.py; do
  [ -f "$t" ] || continue
  echo "== $t"; timeout 600 python3 $t > /tmp/pbtest-uit.txt 2>&1; rc=$?
  grep "✗" /tmp/pbtest-uit.txt; tail -1 /tmp/pbtest-uit.txt
  if [ $rc -ne 0 ] || grep -q "✗" /tmp/pbtest-uit.txt; then fout=1; tail -20 /tmp/pbtest-uit.txt
    meld "$t" "$( (grep "✗" /tmp/pbtest-uit.txt; [ $rc -ne 0 ] && grep -v '^\s*$' /tmp/pbtest-uit.txt | tail -4) )"; fi
done
[ $fout -eq 0 ] && echo "ALLES OK" || { echo "ER ZIJN FOUTEN"; exit 1; }
