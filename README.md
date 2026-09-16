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
| `drive/Code.gs` | Google Apps Script dat projectmappen aanmaakt/koppelt op Drive en de meetstaat-export wegschrijft (installatie: zie bovenaan dat bestand) |
| `meetstaat-export.js` | schrijft de meetstaat van een project in het Excel-sjabloon (zip/XML, opmaak en formules blijven intact) |
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
- Databasewijzigingen komen als genummerde scripts in `sql/` (002 … 007 meetstaat), altijd toevoegingen, nooit verwijderingen. Vóór elk script: Supabase → Database → Backups.
- Een volgende versie eerst testen: in de map `next/` zetten; die is bereikbaar op `…/bros-planbord/next/` met dezelfde database.

## Rollen

- **Beheer**: projecten aanmaken/bewerken, forfaits en uurtarieven zien, medewerkers beheren, uren van iedereen bewerken.
- **Medewerker**: alles zien, taken en eigen uren bewerken, eigen profiel aanpassen.

## Drive-koppeling (script 006 + drive/Code.gs)

1. Log in als brosburo@gmail.com op script.google.com → Nieuw project → plak `drive/Code.gs`.
2. Vul `CONFIG` in: een zelfgekozen SECRET en de map-ID's van `BROS/PROJECTEN` en `BROS/PROJECTEN/A SJABLOON` (het deel van de Drive-URL na `/folders/`).
3. Deploy → New deployment → Web app → Execute as **Me**, Who has access **Anyone** → Deploy → kopieer de Web app-URL.
4. In het Planbord: Instellingen → Drive-koppeling → URL + secret → Bewaren → "Verbinding testen".
5. Nieuwe projecten krijgen automatisch hun map (kopie van A SJABLOON, bestanden hernoemd met de klantnaam). Voor bestaande projecten: projectfiche → Dossier → "Bestaande map koppelen".

## Meetstaat in het Planbord (script 007)

- Projectfiche → tabblad **Meetstaat**: "+ Lot toevoegen" zet een lot met zijn standaardposten klaar, "+ Post" kiest uit de bibliotheek of maakt een vrije post. Hoeveelheid, kostprijs, marge, locatie, btw en status vul je in de tabel in; totalen rekenen live.
- Instellingen → **Postenbibliotheek**: loten (standaardmarge, standaard aan) en posten (standaard, groep, omschrijving, eenheid, richtprijs, btw, actief).
- "Exporteren naar Drive (Excel)" maakt `MEETSTAAT KLANT.xlsx` in Documenten/Meetstaat/DEF van de projectmap; de vorige versie verhuist naar Documenten/Meetstaat met haar datum vóór de naam (versielog), in het sjabloon uit A SJABLOON (formules, keuzelijsten en logo blijven intact; rijen worden ingevoegd als een lot meer dan 35 posten heeft). De klant krijgt enkel verkoopprijzen te zien.
- Vereist: `sql/007_meetstaat.sql` én de nieuwste `drive/Code.gs` (acties `template` en `put`).

## Facturatie (vorderingsstaat)

- Projectfiche → tabblad **Facturatie** (script 008): "+ Voorschot" (% op het contract, telt voor elk lot mee), "+ Vordering" (loten aanvinken; het resterende % wordt voorgesteld en is daarna per lot óf per post aanpasbaar — klap een lot open met ▸; een post-% overschrijft het lot-%), "+ Meerwerkfactuur" (op het meer-/minwerk, los van het contract) en "+ Slotfactuur" (alles tot 100 %).
- Per vordering: omschrijving, datum, Yuki-factuurnummer, berekend bedrag (excl./btw/incl.) en het factuurbedrag. Zet je de status op verzonden of betaald, dan wordt het bedrag bevroren (latere wijzigingen in de meetstaat veranderen de factuur niet meer) en toont het Planbord een verschil als factuur en berekening uiteenlopen.
- Onderaan staat het klantoverzicht (facturen, bedragen, status, nog te factureren) — dit wordt de basis voor het klantportaal. De Excel-export krijgt een tabblad VORDERINGSSTAAT met hetzelfde overzicht plus de percentages per lot en per post.

## Yuki-koppeling (in drive/Code.gs)

- Yuki mailt elke verkoopfactuur ("Factuur van BROS: Factuur voor <klant>") naar de klant en naar accounting@bros.be. Een Gmail-filter in accounting@ stuurt die mails door naar brosburo@gmail.com; daar draait elk uur `yukiSync()` (Apps Script): factuurnummer, datum, klant en totaal uit de mail, maatstaf/btw uit de pdf, en de factuur wordt aan de juiste vordering in het Planbord gekoppeld (factuurnummer, datum, bedrag, status verzonden = bevroren).
- Herkenning: projectnummer in de pdf/klantnaam, anders klantnaam ≈ klant/bedrijf van het project; dan de openstaande vordering met hetzelfde bedrag incl. btw (± 1 €). Twijfel of een afwijkend bedrag wordt gemeld, niet geraden. Verwerkte mails krijgen het label "Planbord/verwerkt"; na elke run met resultaat gaat een samenvatting naar info@bros.be.
- Instellen: `YUKI` bovenaan het script invullen (Supabase-URL, key, bot-gebruiker), `autoriseer()` uitvoeren (Gmail-recht), daarna éénmaal `yukiInstall()` (label + uurlijkse trigger). Het script logt in als een aparte Planbord-gebruiker met de rechten van een teamlid.

## Contacten (script 009)

- Tabblad **Contacten**: klanten, aannemers, leveranciers, architecten, studiebureaus. Per contact: naam/bedrijf, contactpersoon, e-mail, gsm, adres (postcode ⇄ gemeente), btw-nummer, vakgebied en typische loten, interne notities, actief/inactief. Klik op een contact voor de gekoppelde projecten.
- Koppeling aan projecten met een **rol** (bouwheer, contactpersoon, aannemer, leverancier, architect, studiebureau) en voor aannemers/leveranciers de loten van dat project. Bouwheer en contactpersoon zijn zichtbaar voor de klant; de rest is intern (`intern = true`).
- Nieuw project: kies de bouwheer uit de contacten (gegevens worden overgenomen) of laat het veld leeg — dan wordt uit de klantgegevens automatisch een contact aangemaakt en gekoppeld. Bestaande projecten kregen bij script 009 hun bouwheer als contact.
- Voorbereiding portaal: `contacten.user_id` koppelt later een login aan een contact; een aannemer ziet dan enkel de projecten (en loten) waaraan hij gekoppeld is.
