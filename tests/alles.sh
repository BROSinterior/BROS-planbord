#!/bin/bash
# Alle tests van het Planbord. Gebruik: bash tests/alles.sh   (vereist Postgres 16, Python met psycopg, pyjwt, playwright, Node)
cd "$(dirname "$0")"; set -o pipefail; fout=0
[ -n "$PB_OVERSLAAN" ] || python3 voorbereiden.py || exit 1
for t in t_gs.js t67_gs.js t70_gs.js t73_gs.js; do echo "== $t"; node $t | tee /tmp/pbtest-uit.txt | tail -1; grep -q "✗\|FOUT" /tmp/pbtest-uit.txt && fout=1; done
for t in t66_sql.py t68_sql.py t_smoke.py t66_portaal.py t66_yuki.py t67_ui.py t68_ui.py t69_ui.py t7*.py; do
  [ -f "$t" ] || continue
  echo "== $t"; timeout 600 python3 $t > /tmp/pbtest-uit.txt 2>&1; rc=$?
  grep "✗" /tmp/pbtest-uit.txt; tail -1 /tmp/pbtest-uit.txt
  if [ $rc -ne 0 ] || grep -q "✗" /tmp/pbtest-uit.txt; then fout=1; tail -20 /tmp/pbtest-uit.txt; fi
done
[ $fout -eq 0 ] && echo "ALLES OK" || { echo "ER ZIJN FOUTEN"; exit 1; }
