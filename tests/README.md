# Tests van het BROS Planbord

`bash tests/alles.sh` bouwt een testdatabank op uit `sql/001..N` (Postgres 16 op poort 5444), start PostgREST en een
testpoort (inloggen met wachtwoord `test`, een nagemaakt Drive-script) en draait alle tests: databankregels en rechten,
het Drive-script (in Node, met nagemaakte Google-diensten) en de schermen van het Planbord en de portalen (Playwright).

- Draait vanzelf bij elke push (GitHub › Actions › Tests). Een rood kruisje bij een commit = een test faalt.
- Enkel verzonnen testgegevens (gebruikers `beheer@test.local`, `medewerker@test.local`, testklanten). Nooit klantgegevens
  of echte e-mailadressen in deze map.
- Werkmap: `PB_WORK` (standaard `/tmp/pbtest`). `PB_OVERSLAAN=1` slaat het opnieuw opbouwen van de databank over.
- Nieuwe functie = een nieuw bestand `t<versie>_<onderwerp>.py` (wordt door `alles.sh` meegenomen als het met `t7` begint,
  of voeg het toe aan de lijst).
