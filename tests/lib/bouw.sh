#!/bin/bash
# bouwt de testdatabank 'bros' op uit stubs + sql/001..N (tot en met $1, standaard alles)
TOT=${1:-999}
P="su postgres -c"
$P "psql -h /tmp -p 5444 -d postgres -qc \"select pg_terminate_backend(pid) from pg_stat_activity where datname='bros' and pid<>pg_backend_pid()\"" >/dev/null
$P "dropdb -h /tmp -p 5444 --if-exists bros && createdb -h /tmp -p 5444 bros"
LIB="$(cd "$(dirname "$0")" && pwd)"; REPO="${PB_REPO:-$(cd "$LIB/../.." && pwd)}"
cp "$LIB/stubs.sql" /tmp/stubs.sql; chmod 644 /tmp/stubs.sql
$P "psql -h /tmp -p 5444 -d bros -v ON_ERROR_STOP=1 -q -f /tmp/stubs.sql" 2>&1 | grep -v NOTICE
for f in "$REPO"/sql/[0-9][0-9][0-9]_*.sql; do
  n=$(basename $f | cut -c1-3); [ $((10#$n)) -gt $TOT ] && break
  cp "$f" /tmp/s.sql; chmod 644 /tmp/s.sql
  out=$($P "psql -h /tmp -p 5444 -d bros -v ON_ERROR_STOP=1 -q -tA -f /tmp/s.sql" 2>&1 | grep -v "NOTICE\|^$\|views alleen-lezen")
  if echo "$out" | grep -q ERROR; then echo "FOUT in $(basename $f):"; echo "$out" | grep -A3 ERROR | head -8; exit 1; fi
  echo "$(basename $f): $(echo "$out" | tail -1)"
done
