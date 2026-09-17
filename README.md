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
| `klant/` | het klantenportaal (index.html + portaal.js): alleen-lezen zicht van de bouwheer op zijn project |
| `werf/` | de werfmodus voor op de smartphone (vaststellingen met foto's, werkt ook zonder bereik; installeerbaar als app) |
| `next/` | (later) testversie van een volgende update |

## In gebruik nemen (eenmalig)

1. **Supabase** → SQL Editor → inhoud van `sql/001_init.sql` plakken → Run. Onderaan moet `13 | 52` verschijnen.
2. **Supabase** → Authentication → Providers → Email: aan; *Confirm email* mag uit.
   Authentication → Settings: **"Allow new user signups" UIT** (alleen uitgenodigde mensen kunnen inloggen).
3. **Supabase** → Authentication → URL Configuration:
   Site URL = het adres van de app (bv. `https://brosinterior.github.io/BROS-planbord/`), en hetzelfde adres bij Redirect URLs.
4. **Supabase** → Authentication → Users → *Invite user*: eerst de beheerder (Phil), daarna de anderen.
   De eerste uitgenodigde gebruiker wordt automatisch beheerder.
   De genodigde klikt op *Accept invitation* in de mail, komt in de app en kiest daar een wachtwoord (sinds v1.10.1).
   Komt hij op een 404 terecht, dan klopt de Site URL uit stap 3 niet (hoofdletters!). Een uitnodigingslink is beperkt geldig;
   is ze vervallen, dan volstaat *Wachtwoord vergeten?* op het loginscherm (of in Supabase: *Send password recovery*).
   Wachtwoord kwijt → *Wachtwoord vergeten?* op het loginscherm; wachtwoord wijzigen → knop *Wachtwoord* in de kopbalk.
5. `config.js` invullen met Project URL + anon public key (Settings → API).
6. **GitHub Desktop** → deze map publiceren als repository `BROS-planbord` → op github.com: Settings → Pages → Branch `main` / root → Save.
   Na een minuut staat de app op `https://brosinterior.github.io/BROS-planbord/` (let op: hoofdletters tellen mee).

## Updaten tijdens gebruik

- Code en gegevens staan los van elkaar: een nieuwe versie van de app raakt de database niet.
- Nieuwe versie = bestanden vervangen in deze map → GitHub Desktop → *Commit* → *Push*. Na ± 1 minuut staat ze online.
- `version.json` krijgt bij elke update een nieuw nummer; wie de app open heeft, ziet "nieuwe versie beschikbaar" en herlaadt wanneer het past.
- Bij elke update ook het `?v=…` achter de scripts in `index.html` gelijkzetten met het versienummer (Claude doet dit mee bij elke levering); zo laadt geen enkele browser nog een oude app.js uit zijn cache. Ziet iemand toch een oude versie: ⌘⇧R (harde herlaad).
- Databasewijzigingen komen als genummerde scripts in `sql/` (002 … 015), altijd toevoegingen, nooit verwijderingen. Vóór elk script: Supabase → Database → Backups.
- Een volgende versie eerst testen: in de map `next/` zetten; die is bereikbaar op `…/BROS-planbord/next/` met dezelfde database.

## Rollen

- **Beheer**: projecten aanmaken/bewerken, forfaits en uurtarieven zien, medewerkers beheren, uren van iedereen bewerken.
- **Medewerker**: projecten, taken, planning en meetstaat (met klantprijzen) zien; taken, meetstaatposten (omschrijving, hoeveelheid, status, locatie) en eigen uren bewerken; eigen profiel aanpassen. Geen kostprijzen, marges, richtprijzen, uurtarieven of interne kosten — sinds script 012 ook afgeschermd in de database (tabel `meetstaat_prijzen` en views `meetstaat_posten_v`, `loten_v`, `posten_v`). Een post uit de bibliotheek krijgt zijn richtprijs automatisch als kostprijs, ook als een medewerker ze toevoegt; beheer vult of corrigeert de prijzen daarna.

## Drive-koppeling (script 006 + drive/Code.gs)

1. Log in als brosburo@gmail.com op script.google.com → Nieuw project → plak `drive/Code.gs`.
2. Vul `CONFIG` in: een zelfgekozen SECRET en de map-ID's van `BROS/PROJECTEN` en `BROS/PROJECTEN/A SJABLOON` (het deel van de Drive-URL na `/folders/`).
3. Deploy → New deployment → Web app → Execute as **Me**, Who has access **Anyone** → Deploy → kopieer de Web app-URL.
4. In het Planbord: Instellingen → Drive-koppeling → URL + secret → Bewaren → "Verbinding testen".
5. Nieuwe projecten krijgen automatisch hun map (kopie van A SJABLOON, bestanden hernoemd met de klantnaam). Voor bestaande projecten: projectfiche → Dossier → "Bestaande map koppelen".
6. Mapnaam: het Planbord zoekt op de opgeslagen Drive-map (projectformulier), anders op de klantnaam; wordt die niet gevonden, dan probeert het ook een versie zonder koppeltekens en dubbele spaties. Het script herkent bovendien mappen die enkel in hoofdletters, spaties of leestekens verschillen (bv. "Chantor - Mansi" ↔ "Chantor Mansi"); bij meerdere kandidaten vraagt het om de exacte naam. Wijzig je de klantnaam vóór er een map gekoppeld is, dan volgt de Drive-map mee. Wijzig je de mapnaam zelf op Drive na koppeling, dan blijft de koppeling werken (ze loopt via de map-ID).

## Meetstaat in het Planbord (script 007)

- Projectfiche → tabblad **Meetstaat**: "+ Lot toevoegen" zet een lot met zijn standaardposten klaar, "+ Post" kiest uit de bibliotheek of maakt een vrije post. Hoeveelheid, kostprijs, marge, locatie, btw en status vul je in de tabel in; totalen rekenen live.
- Instellingen → **Postenbibliotheek**: loten (standaardmarge, standaard aan) en posten (standaard, groep, omschrijving, eenheid, richtprijs, btw, actief).
- "Exporteren naar Drive (Excel)" maakt `MEETSTAAT KLANT.xlsx` in Documenten/Meetstaat/DEF van de projectmap; de vorige versie verhuist naar Documenten/Meetstaat met haar datum vóór de naam (versielog), in het sjabloon uit A SJABLOON (formules, keuzelijsten en logo blijven intact; rijen worden ingevoegd als een lot meer dan 35 posten heeft). De klant krijgt enkel verkoopprijzen te zien.
- Vereist: `sql/007_meetstaat.sql` én de nieuwste `drive/Code.gs` (acties `template` en `put`).

## Facturatie (vorderingsstaat)

- Projectfiche → tabblad **Facturatie** (script 008): "+ Voorschot" (% op het contract, telt voor elk lot mee), "+ Vordering" (loten aanvinken; het resterende % wordt voorgesteld en is daarna per lot óf per post aanpasbaar — klap een lot open met ▸; een post-% overschrijft het lot-%), "+ Meerwerkfactuur" (op het meer-/minwerk, los van het contract) en "+ Slotfactuur" (alles tot 100 %).
- Op bedrag in plaats van op %: vul bij het aanmaken 'Bedrag excl. btw' in (of bij een voorschot 'Of een bedrag'); de percentages van de gekozen loten worden dan zo berekend dat de vordering precies op dat bedrag uitkomt en het wordt van de rest afgehouden — handig voor facturen die al verstuurd waren vóór de meetstaat in het Planbord stond. Bij een nog open vordering kan dat achteraf ook: factuurbedrag invullen → 'Percentages afleiden uit € …'. Is het bedrag groter dan wat nog openstaat, dan gaan de percentages naar het maximum en wordt het verschil gemeld.
- Per vordering: omschrijving, datum, Yuki-factuurnummer, berekend bedrag (excl./btw/incl.) en het factuurbedrag. Zet je de status op verzonden of betaald, dan wordt het bedrag bevroren (latere wijzigingen in de meetstaat veranderen de factuur niet meer) en toont het Planbord een verschil als factuur en berekening uiteenlopen.
- Onderaan staat het klantoverzicht (facturen, bedragen, status, nog te factureren) — dit wordt de basis voor het klantportaal. De Excel-export krijgt een tabblad VORDERINGSSTAAT met hetzelfde overzicht plus de percentages per lot en per post.

## Klantenportaal (script 011 + drive/Code.gs)

De bouwheer logt in op `…/BROS-planbord/klant/` met e-mail + wachtwoord en ziet alleen zijn eigen project(en), alleen-lezen: Welkom (status, "zo werkt het bij BROS" = de fasen, aanspreekpunt), Meetstaat met verkoopprijzen (geen kostprijs/marge), Facturatie (verzonden en betaalde facturen, nog te factureren), Planning per fase plus de uren van taken met de schakelaar Klant, gedeelde Documenten en Wie is wie. Bij het eerste bezoek: vuurwerk en "Welkom".

Hoe het afgeschermd is: klanten krijgen rol `klant`; alle interne tabellen zijn enkel leesbaar voor het team (`is_intern()`), klanten lezen via views `klant_*` die alleen de eigen projecten (bouwheer/contactpersoon in Contacten) en alleen klantvriendelijke kolommen bevatten. Een klant die op het Planbord inlogt, wordt naar het portaal gestuurd.

Activeren (eenmalig):
1. Supabase → SQL Editor → `sql/011_klantportaal.sql` → Run (moet `9` teruggeven).
2. Supabase → Authentication → URL Configuration → Redirect URLs: `https://brosinterior.github.io/BROS-planbord/klant/` toevoegen (naast de bestaande).
3. Drive-script: nieuwste `drive/Code.gs` plakken, in `PORTAAL.SERVICE_KEY` de **service_role**-sleutel zetten (Supabase → Project Settings → API → service_role; die sleutel hoort alleen in het script, nooit in de app of in git) → Deploy → Manage deployments → Version: New. Het script stuurt de uitnodigings- en herstelmails via Gmail, dus er is geen SMTP-instelling nodig in Supabase. Afzender = `PORTAAL.VAN` (archief@bros.be): daarvoor moet dat adres in de Gmail van brosburo@gmail.com ingesteld staan als alias (Gmail → Instellingen → Accounts en import → "E-mail verzenden als" → "Nog een e-mailadres toevoegen" → archief@bros.be → SMTP-server smtp.gmail.com, poort 587, TLS, gebruikersnaam archief@bros.be, wachtwoord = een **app-wachtwoord** van archief@bros.be (myaccount.google.com/apppasswords, vereist verificatie in 2 stappen); daarna de bevestigingscode uit de mailbox van archief@bros.be). Staat de alias er niet, dan vertrekt de mail van brosburo@gmail.com met archief@bros.be als antwoordadres. Controleren: in de scripteditor `portaalAliassen()` uitvoeren.
4. `config.js`: `driveScriptUrl` = de Web app-URL van het script (staat er al in); het portaal gebruikt die voor "Wachtwoord vergeten".
5. Instellingen → Klantenportaal: welkomtekst, inleiding werkwijze en contactblok nakijken. Team → Bewerken: functie, foto en korte biografie per medewerker (pagina Wie is wie).

Gebruik per project: projectfiche → Dossier → Contacten → bij de bouwheer "Portaal-toegang geven" (beheer). De klant krijgt een mail met een persoonlijke link, kiest een wachtwoord en is binnen. "Link opnieuw sturen" stuurt een nieuwe link (bv. wachtwoord kwijt). Documenten: schakelaar bij een bestand = delen met de klant (het bestand wordt dan "iedereen met de link mag lezen" op Drive; uitzetten draait dat terug). Uren: de schakelaar Klant bij een taak (Uren-tabblad) bepaalt welke uren de klant ziet. Facturen verschijnen pas bij status verzonden of betaald.

## Akkoord-knop (script 013)

- Meetstaat → **Ter goedkeuring voorleggen**: kies Offerte (alle posten in status Offerte) of Meerwerkvoorstel (meer-/minwerkposten), vink aan wat erin hoort, geef een titel, een toelichting en een datum 'Reageren vóór' (standaard 14 dagen; leeg = geen deadline). Na die datum kan de klant niet meer goedkeuren ("Termijn verstreken") en leg je het opnieuw voor. Het Planbord bewaart een bevroren kopie (posten, hoeveelheden, klantprijzen, totalen) in `goedkeuringen`; latere wijzigingen in de meetstaat raken het voorstel niet. De klant krijgt een mail (via het Drive-script) en ziet het voorstel in het portaal onder **Akkoord**.
- De klant keurt goed met zijn naam en een vinkje, of klikt "Ik heb een vraag / niet akkoord" met een opmerking. De beslissing loopt via de databasefunctie `goedkeuring_beslis()` (controleert dat het zijn project is en dat het voorstel nog open staat) en wordt vastgelegd met naam, e-mail en tijdstip.
- Bij akkoord: offerteposten → status Akkoord; alle posten uit het voorstel krijgen `akkoord_op` (vinkje "✓ klant dd/mm" in de meetstaat, ook in het portaal). BROS krijgt een melding op het rapportadres (info@bros.be), de klant een bevestiging met het overzicht. Bij "niet akkoord" blijven de posten ongewijzigd en staat de opmerking in het paneel **Goedkeuringen door de klant** op de meetstaat; van daaruit kan je intrekken of opnieuw voorleggen.
- Vereist `sql/013_goedkeuringen.sql` en het nieuwe `drive/Code.gs` (actie `gkmail`).

## Notities en verslagen (script 014)

- Projectfiche → tabblad **Notities** (+ Notitie) en hoofdnavigatie **Notities** (alle projecten, zoeken, eigen open actiepunten). Soorten: vergadering, werfverslag, bespreking, feedback klant, notitie — elk met een sjabloon (aanwezig, besproken, beslissingen, afspraken, volgende stap) dat je met "Sjabloon invullen" in het verslag zet.
- Per notitie: datum, aanwezigen (vrije tekst), verslag, verantwoordelijken uit het team én uit de aan het project gekoppelde contacten (aannemers, architect, …), en **actiepunten**: elke regel wordt een taak op het project (wie, deadline, gekoppeld aan de notitie). In de notitie vink je ze af; in de takenlijst staat "📝 <verslag>" bij zo'n taak, en in het taakformulier kan je een taak aan een verslag koppelen. Bij een nieuwe notitie zie je de nog open actiepunten uit vorige verslagen.
- **Delen met de klant**: het verslag en zijn actiepunten (titel, wie, deadline, klaar/open) verschijnen in het portaal onder **Verslagen**; de klant krijgt een mail met het verslag (Drive-script, actie `notitiemail`). Interne opmerkingen horen dan niet in dat verslag — maak daarvoor een aparte notitie zonder deling.
- **Toewijzen aan de klant of een aannemer** (script 015): in het taakformulier en bij de actiepunten kies je onder "Klant en contacten van dit project" een contact in plaats van een teamlid (`taken.contact_id`). De klant ziet zijn actiepunten in het portaal (Welkom-banner, "Jouw actiepunten" onder Verslagen, ook zonder gedeeld verslag) en vinkt ze zelf af via `klant_taak_klaar()`; het Planbord toont de taak met naam en label klant/aannemer.
- Vereist `sql/014_notities.sql`, `sql/015_taken_klant.sql` en het nieuwe `drive/Code.gs`.

## Timing voor de klant (script 017)

- De klant ziet in het portaal onder Planning per fase een van–tot. Die volgt **automatisch** de taken van de fase (vroegste start → laatste einde), tenzij je de fase **vastzet**: projectfiche → tabblad **Planning**, paneel **Timing voor de klant** → Van/Tot invullen (of "Vastzetten" om de huidige taaktiming te bevriezen) en eventueel een toelichting. Een vastgezette fase schuift niet meer mee met de taken; ✕ wist ze en dan volgt ze weer de taken. Tabel `klant_timing` (enkel de vastgezette fasen), view `klant_planning`.
- **Timing delen met de klant** per taak: schakelaar in het taakformulier, of het vinkje in de lijst "Taken met gedeelde timing" onder het paneel. Zo'n taak verschijnt in de klantplanning als regel onder haar fase met titel, van–tot en status (gepland / bezig / klaar) — geen uren, geen wie. Standaard uit; in de takenlijst staat "timing → klant" bij zo'n taak. Kolom `taken.timing_klant`, view `klant_planning_taken`.
- Geen extra werk na het script: bestaande projecten tonen meteen dezelfde (automatische) planning als vroeger.

## Werfopvolging (script 016) — stap 1

Vervangt ArchiSnapper stap voor stap. Stap 1 = vaststellingen met foto's registreren en opvolgen.

- Projectfiche → tabblad **Werf**: kerncijfers (open, te laat, opgelost/te controleren, gecontroleerd), de vaststellingen als kaarten met foto, nummer (V-001, V-002, … per project), ruimte, lot, verantwoordelijke (aannemer of teamlid), deadline en status; filters op status en verantwoordelijke, zoeken, en **Per aannemer** groeperen (met e-mailadres, handig om te mailen). Daaronder de **werfbezoeken** (datum, aanwezigen, weer, algemene opmerkingen) waaraan de vaststellingen hangen.
- Vaststelling: korte **titel** voor het overzicht (script 019; de omschrijving blijft de uitleg; de gekoppelde taak heet "V-012 · titel"), foto's (worden in de browser verkleind tot 1600 px en in de storage-bucket `werf` gezet), omschrijving, ruimte (met suggesties), lot, verantwoordelijke, deadline, prioriteit, status open → opgelost (datum en wie) → gecontroleerd, of vervallen; opmerking/reactie; schakelaar "zichtbaar voor de klant" (gebruikt in stap 2 voor het werfverslag). Klik op een foto voor groot.
- **Werfmodus** (`werf/`, knop 📱 Werfmodus op het tabblad Werf, of rechtstreeks `…/BROS-planbord/werf/`): mobiele app voor op de werf. Aanmelden met je Planbord-account (niet voor klanten), project kiezen, lijst open/opgelost/alles, 📷 Vaststelling (foto nemen of uit de galerij, omschrijving, ruimte, aannemer, prioriteit, deadline), tik op een punt voor detail → **Opgelost met bewijsfoto**, Gecontroleerd, Heropenen, foto toevoegen, bewerken, vervallen. **Bezoek starten** maakt een werfbezoek waaraan de nieuwe vaststellingen gekoppeld worden tot je het afsluit.
- **Zonder bereik**: alles wat je bewaart, komt in een wachtrij op het toestel (IndexedDB, foto's inbegrepen) en wordt verzonden zodra er weer verbinding is (bolletje rechtsboven: groen = gesynchroniseerd, oranje = wachtend, grijs = offline; tik erop om te verzenden). De lijst van het laatst geopende project blijft offline zichtbaar. Voorwaarde: de werfmodus één keer met bereik openen (de app-bestanden worden dan lokaal bewaard door een service worker). Aanmelden lukt niet offline; blijf dus aangemeld.
- Op de smartphone: Safari → Delen → **Zet op beginscherm** (Android: Chrome → Toevoegen aan startscherm). De app opent dan schermvullend als "BROS Werf".
- **Vaststelling → taak** (script 018): een vaststelling met een verantwoordelijke (aannemer, bouwheer of teamlid) wordt automatisch een taak op het project ("V-012 · omschrijving", deadline = op te lossen tegen, `taken.vaststelling_id`). Zo staat ze in de takenlijst van die persoon: teamlid → tabblad Taken, bouwheer → "Jouw actiepunten" in het portaal, aannemer → later het aannemersportaal. Status loopt in beide richtingen mee: opgelost/gecontroleerd ↔ klaar, en een taak die de klant of het team afvinkt zet de vaststelling op opgelost. Verantwoordelijke weghalen verwijdert de (nog open) taak. In takenlijsten staat "📍 V-012" bij zo'n taak; klik erop om de vaststelling te openen. De bouwheer is ook te kiezen als verantwoordelijke.
- Groeperen: op het tabblad Werf per verantwoordelijke, per lot of per ruimte; in een werfbezoek staan de vaststellingen per lot; in de werfmodus de chip "Per lot" (het lot is daar ook in te vullen).
- Vereist `sql/016_werf.sql` (tabellen `werfbezoeken`, `vaststellingen`, bucket `werf`, realtime), `sql/018_werf_taken.sql` en `sql/019_vaststelling_titel.sql`. Alleen het team (beheer + medewerker) kan lezen en schrijven; de klant ziet in stap 1 enkel de vaststellingen die hem als taak toegewezen zijn.
- Volgende stappen: (2) pin op het plan + werfverslag als pdf naar aannemers en klant (Drive-map Werfcontrole, mail), (3) aannemersportaal (eigen login, punten afwerken met foto), (4) checklists en oplevering.

## Yuki-koppeling (in drive/Code.gs)

- Yuki mailt elke verkoopfactuur ("Factuur van BROS: Factuur voor <klant>") naar de klant en naar accounting@bros.be. Een Gmail-filter in accounting@ stuurt die mails door naar brosburo@gmail.com; daar draait elk uur `yukiSync()` (Apps Script): factuurnummer, datum, klant en totaal uit de mail, maatstaf/btw uit de pdf, en de factuur wordt aan de juiste vordering in het Planbord gekoppeld (factuurnummer, datum, bedrag, status verzonden = bevroren).
- Herkenning: projectnummer in de pdf/klantnaam, anders klantnaam ≈ klant/bedrijf van het project; dan de openstaande vordering met hetzelfde bedrag incl. btw (± 1 €). Twijfel of een afwijkend bedrag wordt gemeld, niet geraden. Verwerkte mails krijgen het label "Planbord/verwerkt"; na elke run met resultaat gaat een samenvatting naar info@bros.be.
- Instellen: `YUKI` bovenaan het script invullen (Supabase-URL, key, bot-gebruiker), `autoriseer()` uitvoeren (Gmail-recht), daarna éénmaal `yukiInstall()` (label + uurlijkse trigger). Het script logt in als een aparte Planbord-gebruiker met de rechten van een teamlid.

## Contacten (script 009)

- Tabblad **Contacten**: klanten, aannemers, leveranciers, architecten, studiebureaus. Per contact: naam/bedrijf, contactpersoon, e-mail, gsm, adres (postcode ⇄ gemeente), btw-nummer, vakgebied en typische loten, interne notities, actief/inactief. Klik op een contact voor de gekoppelde projecten.
- Koppeling aan projecten met een **rol** (bouwheer, contactpersoon, aannemer, leverancier, architect, studiebureau) en voor aannemers/leveranciers de loten van dat project. Bouwheer en contactpersoon zijn zichtbaar voor de klant; de rest is intern (`intern = true`).
- Nieuw project: kies de bouwheer uit de contacten (gegevens worden overgenomen) of laat het veld leeg — dan wordt uit de klantgegevens automatisch een contact aangemaakt en gekoppeld. Bestaande projecten kregen bij script 009 hun bouwheer als contact.
- Voorbereiding portaal: `contacten.user_id` koppelt later een login aan een contact; een aannemer ziet dan enkel de projecten (en loten) waaraan hij gekoppeld is.

## Uren met tijd en klantweergave (script 010)

- Uren kunnen ook op **afgewerkte taken** geregistreerd worden: ze staan onderaan in de takenkeuze (met ✓), of klik op **+ Uren** naast de taak op de projectfiche › Uren.
- Per registratie optioneel een **begin- en einduur**; de uren worden dan berekend (op kwartieren). Zichtbaar in de weekstaat, de projectfiche en de CSV-export (kolommen Van/Tot).
- Per taak een schakelaar **Klant** (in de taak zelf of in de kolom Klant op de projectfiche › Uren): staat ze aan, dan zijn de gepresteerde uren van die taak — met datum en tijdstip — zichtbaar voor de klant. Standaard uit. Het paneel **Wat de klant ziet** toont precies die lijst; **Afdrukken / pdf** maakt er een nette klantversie van. Dit is ook wat het klantportaal later toont.
- Script 010 zet bovendien **alle tabellen in de realtime-publicatie** (tarieven ontbrak; daardoor werkten de live-updates tussen gebruikers niet) en de app gebruikt nu één kanaal per tabel.

## Meetstaat importeren uit Excel (v1.10)

- Projectfiche › Meetstaat › **Importeren uit Excel**: kies een bestaande meetstaat (elk BROS-sjabloon van 2024 tot 2026 DEF). Het Planbord leest het blad MEETSTAAT (lotkoppen `N. NAAM`, per post: code, locatie, omschrijving, artikelnr., hoeveelheid, eenheid, eenheidsprijs, btw, bijgevraagd/weggelaten, bestel- en leverstatus, leverancier) en het blad OVERZICHT (controle per lot, onvoorziene kost 10 %).
- Voorbeeld per lot met aantal posten en bedrag, daarna kies je de status (akkoord/offerte) en, als het project al posten heeft, vervangen of aanvullen. Groepskoppen en tekstregels zonder cijfers blijven bewaard; onaangeroerde regels van het lege sjabloon worden overgeslagen (daarvoor wordt het sjabloon uit Drive gelezen).
- De eenheidsprijs in de Excel is de **klantprijs**: die komt binnen als prijs met marge 0 %, zodat de totalen exact gelijk blijven aan het document dat de klant kreeg. Vul daarna per post de echte kost en marge in.
- Daarna werkt alles zoals bij een nieuwe meetstaat: bewerken in het Planbord, **Exporteren naar Drive** maakt de versie in het nieuwe sjabloon in `Documenten/Meetstaat/DEF` (de oude verhuist met datum naar `Documenten/Meetstaat`). Voorwaarde: de Drive-map van het project is gekoppeld (Dossier).
- De code zit in `meetstaat-import.js` (werkt ook in Node voor tests). Op 16/09/2026 zijn de meetstaten van 20 lopende projecten op deze manier ingelezen (opmerking op elke post: "Import uit Excel 16/09/2026").
