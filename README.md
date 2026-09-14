# BROS Planbord

Interne projectapp van BROS: projecten, taken, planning (Gantt), urenregistratie en team.
Statische webapp (geen build-stap) op een Supabase-database.

## Bestanden

| Bestand | Wat |
|---|---|
| `index.html` | de pagina (opmaak) |
| `app.js` | alle logica |
| `config.js` | koppeling met de database — **hier de Project URL en anon-sleutel invullen** |
| `version.json` | versienummer; de app meldt een nieuwe versie aan wie ze open heeft |
| `sql/001_init.sql` | databasescript 1: tabellen, rechten, live-sync, fasen en standaardtaken |
| `next/` | (later) testversie van een volgende update |

## In gebruik nemen (eenmalig)

1. **Supabase** → SQL Editor → inhoud van `sql/001_init.sql` plakken → Run. Onderaan moet `13 | 52` verschijnen.
2. **Supabase** → Authentication → Providers → Email: aan; *Confirm email* mag uit.
   Authentication → Settings: **"Allow new user signups" UIT** (alleen uitgenodigde mensen kunnen inloggen).
3. **Supabase** → Authentication → URL Configuration:
   Site URL = het adres van de app (bv. `https://brosinterior.github.io/bros-planbord/`), en hetzelfde adres bij Redirect URLs.
4. **Supabase** → Authentication → Users → *Invite user*: eerst de beheerder (Phil), daarna de anderen.
   De eerste uitgenodigde gebruiker wordt automatisch beheerder.
5. `config.js` invullen met Project URL + anon public key (Settings → API).
6. **GitHub Desktop** → deze map publiceren als repository `bros-planbord` → op github.com: Settings → Pages → Branch `main` / root → Save.
   Na een minuut staat de app op `https://<gebruikersnaam>.github.io/bros-planbord/`.

## Updaten tijdens gebruik

- Code en gegevens staan los van elkaar: een nieuwe versie van de app raakt de database niet.
- Nieuwe versie = bestanden vervangen in deze map → GitHub Desktop → *Commit* → *Push*. Na ± 1 minuut staat ze online.
- `version.json` krijgt bij elke update een nieuw nummer; wie de app open heeft, ziet "nieuwe versie beschikbaar" en herlaadt wanneer het past.
- Databasewijzigingen komen als genummerde scripts in `sql/` (002, 003, …), altijd toevoegingen, nooit verwijderingen. Vóór elk script: Supabase → Database → Backups.
- Een volgende versie eerst testen: in de map `next/` zetten; die is bereikbaar op `…/bros-planbord/next/` met dezelfde database.

## Rollen

- **Beheer**: projecten aanmaken/bewerken, forfaits en uurtarieven zien, medewerkers beheren, uren van iedereen bewerken.
- **Medewerker**: alles zien, taken en eigen uren bewerken, eigen profiel aanpassen.
