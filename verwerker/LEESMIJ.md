# BROS verwerkingscomputer — Vergaderingen & opnames (v1.54) en Plannen omzetten (v1.57)

> **Plannen omzetten met Plan2CAD (v1.57):** zie [§ Plannen omzetten](#plannen-omzetten-met-plan2cad-v157) onderaan.

De Mac mini haalt opnames op uit de beveiligde wachtrij van het Planbord, transcribeert ze **lokaal**, bewaart het origineel in de projectmap op Drive en maakt (optioneel, via een cloud-API) een **conceptverslag**. Alles wat de AI maakt, blijft een concept tot iemand van BROS het in het Planbord controleert.

**Wat al gebouwd en getest is:** de volledige keten in een testomgeving (zie *Wat getest is* onderaan).

**Wat nog niet getest is:** deze verwerkingscomputer op de Mac mini zelf, en echte Nederlandstalige opnames. Doorloop daarom eerst de *installatie* en de *praktijktest* hieronder. Pas daarna kiezen we het model en de instellingen definitief.

---

## 1. Wat waar gebeurt

| Stap | Waar | Wat gaat er naartoe |
|---|---|---|
| Opname opladen | browser → Supabase-opslag `opnames` (privé) | het bestand, in delen van 20 MB, elk met een SHA-256-controlegetal |
| Wachtrij | Supabase (tabel `verwerkingen`) | enkel de opdracht. De Mac mini haalt ze zelf op; niemand hoeft de Mac te bereiken |
| Omzetten en knippen | **lokaal** op de Mac mini (ffmpeg) | — |
| Transcriptie | **lokaal** op de Mac mini (whisper.cpp, Metal) | — |
| Origineel + transcript | Google Drive, projectmap › `Vergaderingen/<datum onderwerp>` (via het Drive-script) | het originele bestand en een transcript (.txt) |
| Afspeelkopie | Supabase-opslag `opnames` | AAC 32 kbit/s mono, ongeveer 14 MB per uur |
| Conceptverslag (optioneel) | cloud-API van Anthropic | de **tekst** van het transcript plus onderwerp, datum, projectnaam, de namen van de deelnemers en de agenda. **Geen audio** |
| Automatische controles | **lokaal** | citaten, getallen, voorwaarden, ontkenningen en namen worden vergeleken met het transcript |
| Resultaat | Supabase (tabellen `vergadering_uitvoer`, `vergadering_punten`) | het transcript, de eerste AI-uitvoer en de punten (als voorstel) |

De uploaddelen worden **pas** verwijderd als de kopie op Drive met MD5 gecontroleerd is. Er wordt dus nooit de enige kopie weggegooid. Heeft een project nog geen projectmap op Drive, dan blijft het origineel in de opslag van het Planbord, en het Planbord meldt dat.

Op de Mac blijven enkel tijdelijke bestanden staan: een WAV-kopie, de delen en de tussenresultaten. Die worden na elke geslaagde verwerking opgeruimd. Na een mislukte verwerking blijven ze staan om te kunnen hervatten, en ze verdwijnen vanzelf na 14 dagen. De interne SSD is dus geen archief.

## 2. Diensten en kosten

- **Claude-abonnement (Pro, Max of Team)** — dat is wat je nu gebruikt voor Claude en Cowork. Het dekt **geen** API-verbruik.
- **Anthropic API (optioneel, voor het conceptverslag)** — dat is een apart account op [platform.claude.com](https://platform.claude.com), en je betaalt per verbruik.
  - Standaard gebruikt de verwerker `claude-sonnet-5-5`. Volgens de prijspagina van oktober 2026 kost dat $2 per miljoen tokens in en $10 per miljoen tokens uit.
  - **Orde van grootte** voor een vergadering van een uur: zo'n 15.000 à 30.000 tokens in en 3.000 à 6.000 tokens uit, dus enkele dollarcent tot ongeveer $0,15.
  - Met de *tweede AI-controle* aan komt daar ongeveer evenveel bij.
  - De **werkelijke** tokens en een kostenraming staan per vergadering in het tabblad Logboek en onder Instellingen › Evaluatie proefperiode. Kijk de prijzen na als je het account aanmaakt.
  - Volgens de commerciële voorwaarden van Anthropic worden API-gegevens standaard niet gebruikt om modellen te trainen, en is er een beperkte bewaartermijn. Kijk de actuele voorwaarden na vóór je dit voor klantgesprekken gebruikt.
- **Supabase** — het bestaande project. Het gratis plan heeft 1 GB opslag en 50 MB per bestand. Uploads staan er enkel tijdelijk; de afspeelkopieën blijven. Het verbruik staat onder Instellingen › Vergaderingen & opnames.
- **Google Drive** — de bestaande opslag van BROS. Daar komen de originelen.
- **Op de Mac** — ffmpeg, whisper.cpp en de modellen. Die zijn gratis (open source).
- **Zonder API-sleutel** werkt alles behalve de samenvatting. Je krijgt het transcript plus de automatisch gevonden bedragen, maten, datums en codes als controlepunten.

## 3. Installatie op de Mac mini (M4, 16 GB, 256 GB)

Voorwaarden:

- macOS bijgewerkt en een eigen gebruikersaccount voor de verwerker, bijvoorbeeld *bros-verwerker* (aanbevolen) of het bestaande account.
- [Homebrew](https://brew.sh) geïnstalleerd.
- **FileVault blijft aan.**

1. **Login voor de verwerkingscomputer**
   - Supabase › Authentication › *Add user*: maak een eigen e-mailadres aan (bv. `verwerker@bros.be`) met een sterk wachtwoord.
   - Planbord › Instellingen › *Vergaderingen & opnames* › vul dat adres in › **Koppelen**.
   - Die login ziet niets van het Planbord; hij kan enkel opdrachten uit de wachtrij ophalen en afwerken.
2. **Databasescript** `sql/051_vergaderingen.sql` uitvoeren in Supabase. De controle moet `6 | 6 | 1 | 1` geven. Staat er bij intern_project 0, open dan het project BROS › Bewerken › vink *Intern project* aan.
3. **Drive-script**: het nieuwe `drive/Code.gs` (of `Code.ingevuld.gs`) plakken en een **nieuwe versie** online zetten (actie `opname`).
4. **Op de Mac mini**: kopieer de map `verwerker/` en voer uit:
   ```bash
   cd verwerker
   bash installeer.sh
   ```
   Het script:
   - installeert ffmpeg en whisper.cpp (Homebrew);
   - downloadt het spraakmodel `ggml-large-v3-turbo-q5_0.bin` (547 MiB, met SHA-1-controle) en het stiltedetectiemodel (VAD);
   - vraagt de Supabase-URL en de publieke sleutel (dezelfde als in `config.js`), het e-mailadres van de verwerkingslogin en de URL van het Drive-script;
   - bewaart het **wachtwoord** en (optioneel) de **Anthropic API-sleutel** in de **sleutelhanger**, nooit in een bestand;
   - installeert de LaunchAgent `be.bros.verwerker`, die bij het inloggen start en na een crash herstart.
5. **Controleren**:
   ```bash
   python3 ~/Library/Application\ Support/BROS-verwerker/bros_verwerker.py controle
   ```
   Alles moet *OK* zijn. In het Planbord staat dan "Verwerkingscomputer online".

**Instellingen** staan in `~/Library/Application Support/BROS-verwerker/config.json`. Daar staan geen geheimen in. Na een wijziging herstart je de dienst:
```bash
launchctl kickstart -k gui/$(id -u)/be.bros.verwerker
```

Het **logboek** staat in `~/Library/Logs/BROS-verwerker.log` (het wisselt zelf bij 10 MB).

## 4. Herstart, stroomuitval en macOS-updates

- **Systeeminstellingen › Energie**:
  - zet *Start automatisch op na stroomonderbreking* **aan**;
  - zet *Voorkom automatisch in slaap gaan als het scherm uit is* **aan**.
  - De dienst houdt de Mac ook zelf wakker zolang hij draait (`caffeinate`).
- **FileVault blijft aan.** Na elke herstart (stroomuitval, update) wacht de Mac op het ontgrendelscherm. Tot iemand **eenmalig inlogt** met het account van de verwerker, draait er niets. Dat is veilig: opnames wachten in de wachtrij en het Planbord toont "Verwerkingscomputer niet bereikbaar sinds …".
  - Daarom is het een LaunchAgent (start na het inloggen, met de sleutelhanger open) en geen LaunchDaemon.
  - Het scherm mag daarna vergrendelen; de dienst blijft lopen.
- **Geplande herstart of update**: `sudo fdesetup authrestart` laat de Mac één keer herstarten zonder het FileVault-ontgrendelscherm. Kijk daarna na of de dienst weer "online" staat; zo nodig log je in.
- **Na een macOS-update**:
  - voer `bros_verwerker.py controle` uit;
  - controleer `brew upgrade ffmpeg whisper-cpp` en voer daarna een korte test uit (punt 5.1);
  - een update van whisper.cpp kan het transcript licht veranderen, dus test opnieuw vóór je hem in gebruik neemt.
- **Onderbreking tijdens een verwerking** (herstart, crash, stroom):
  - de lopende opdracht wordt na maximaal 10 minuten vrijgegeven en hervat vanaf het laatste afgewerkte deel;
  - na 3 onderbrekingen staat ze op *Mislukt*, met een melding; iemand kan ze opnieuw starten.
- **Geheugen**: per deel wordt het spraakmodel in een **apart proces** geladen. Als dat proces stopt, is het geheugen weer vrij. Er loopt altijd **één** opname tegelijk.

## 5. Praktijktest (doen vóór de proefperiode)

Zonder metingen beloven we geen snelheid of nauwkeurigheid. Voer daarom eerst deze test uit.

### 5.1 Model en instellingen kiezen (lokaal, zonder Planbord)

1. Neem 2 à 3 echte opnames:
   - een kort gesprek van ongeveer 5 minuten;
   - een werfvergadering van ongeveer 30 minuten;
   - een **lange vergadering van 60 à 90 minuten**.
2. Vergelijk de modellen (download eerst de extra modellen met `installeer.sh --modellen`):
   ```bash
   cd ~/Library/Application\ Support/BROS-verwerker
   python3 bros_verwerker.py meet ~/Desktop/werfvergadering.m4a \
     --modellen modellen/ggml-large-v3-turbo-q5_0.bin,modellen/ggml-large-v3-turbo-q8_0.bin,modellen/ggml-medium-q5_0.bin
   ```
3. De resultaten komen in `testresultaat/`:
   - `rapport.json`: verwerkingstijd per deel en in totaal, "× realtime", piekgeheugen per model, vrije schijfruimte voor en na, grootte van de werkmap;
   - per model een transcript (.txt en .json).
4. Beoordeel elk transcript met dezelfde lijst. Noteer per model het aantal fouten:
   - namen van klanten, aannemers en BROS;
   - bedragen;
   - maten;
   - materiaal- en kleurcodes (RAL, NCS, referenties);
   - datums en deadlines;
   - "als …" (voorwaarden), "niet" en "geen" (ontkenningen);
   - stukken die het model verzon (bv. "Ondertiteling …") of oversloeg.
5. Kies het model met het beste resultaat dat comfortabel past:
   - houd het geheugen ruim onder 16 GB, zodat macOS, Claude en de andere automatisaties blijven werken;
   - zet het gekozen model in `config.json` als `whisper_model`.
6. Probeer eventueel ook:
   - `whisper_threads` 4 tegenover 6;
   - `deel_minuten` 10 tegenover 15;
   - met en zonder VAD (`vad_model` leeg laten).

Vul deze tabel in:

| Opname | Duur | Model | Verwerkingstijd | × realtime | Piekgeheugen | Fouten (namen / bedragen / maten / voorwaarden) |
|---|---|---|---|---|---|---|
| | | | | | | |

### 5.2 Volledige keten in het Planbord

1. Open in het Planbord een **testproject** (of *BROS — Interne werking*) › Vergaderingen › **+ Vergadering** (onderwerp, deelnemers, controleur).
2. Laad een korte opname op van je **telefoon** (Safari of Chrome) en een van de **computer**.
3. Volg de status: *In wachtrij → Wordt verwerkt (stap, voortgang) → Klaar voor controle*.
4. Kijk na:
   - het origineel staat in de projectmap › Vergaderingen;
   - **▶** speelt het juiste bronfragment af;
   - het transcript heeft tijdsaanduidingen, en onduidelijke stukken zijn gemarkeerd.
5. Beoordeel elk punt (juist, aanpassen, afwijzen of toevoegen) en maak van een actiepunt een taak. Kijk na dat de taak in de takenlijst staat, met de link naar de vergadering en het bronfragment.
6. **Verslag als gecontroleerd markeren**, daarna **Delen met de klant**. Controleer via Instellingen › Testmodus (als klant) dat de klant **enkel** dat verslag ziet: geen opname, transcript of interne opmerking.

### 5.3 Proefscript: inhoud die fout kan gaan

Neem met twee of drie mensen dit gesprek op (ongeveer 3 minuten, gewoon praten zoals op de werf). Controleer daarna elk punt.

> — We doen de plinten in eik, **als** de prijs onder de vijftienhonderd euro blijft.
> — Akkoord, maar **niet** in de gang, daar blijft het wit.
> — De nis is drie meter twintig breed en vijfenveertig centimeter diep.
> — Kleur van de kasten: RAL negen nul één nul.
> — Noa bestelt de tegels tegen vrijdag.
> — Iemand moet de schrijnwerker nog bellen. *(geen naam, geen datum)*
> — Misschien nog twee extra stopcontacten in de keuken, dat zien we nog. *(voorstel, geen besluit; mogelijk meerwerk)*
> — Jan van Peeters Elektro komt op veertien november.

Verwachte uitkomst:

- de voorwaarde "als de prijs onder …" staat bij de beslissing, of er staat een waarschuwing;
- "niet in de gang" is niet omgedraaid;
- 3,20 m, 45 cm, RAL 9010 en 14 november staan bij *Kritieke gegevens*;
- het actiepunt van Noa staat op Noa met de deadline als tekst ("tegen vrijdag");
- "schrijnwerker bellen" heeft verantwoordelijke en deadline **nog te bepalen**;
- de stopcontacten staan als *voorgesteld* of *mogelijk meerwerk*, niet als *besloten*.

Noteer wat fout is en hoe je het corrigeerde. Het logboek bewaart dat ook.

### 5.4 Robuustheid

| Test | Hoe | Verwacht |
|---|---|---|
| Verwerkingscomputer offline | `launchctl bootout gui/$(id -u)/be.bros.verwerker`, opname opladen, 5 min wachten, `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/be.bros.verwerker.plist` | Planbord: "niet bereikbaar sinds …" (ook in *Wacht op jou* voor beheer), de opdracht blijft wachten en wordt daarna verwerkt |
| Onderbreking | tijdens "transcriberen deel 2/…" `launchctl kickstart -k gui/$(id -u)/be.bros.verwerker` | hervat vanaf het laatste afgewerkte deel (logboek) |
| Stroom | stekker eruit tijdens een verwerking, opnieuw aan, inloggen | idem (na maximaal 10 min vrijgegeven) |
| Mislukt | een tekstbestand hernoemen naar `.m4a` en opladen | *Mislukt* met "Dit bestand bevat geen geluid …", geen eindeloze pogingen |
| Opnieuw verwerken | *Opnieuw verwerken…* › enkel verslag, daarna alles | geen dubbele voorstellen, geen dubbele taken, beoordeelde punten blijven |
| Gestopt | *Stoppen* tijdens de verwerking | de Mac stopt binnen 30 s, status *Mislukt* (opnieuw te starten) |
| Rechten | inloggen als medewerker die geen deelnemer, controleur of projectlead is (ook niet nadat hij zichzelf een taak in het project gaf) | de vergadering is onzichtbaar en de opname kan niet afgespeeld worden |

### 5.5 Proefperiode

Planbord › Instellingen › *Evaluatie proefperiode* toont per soort hoeveel AI-punten juist, gecorrigeerd of afgewezen werden, en wat gemist werd (handmatig toegevoegd). *Verwerkingsmetingen laden* toont tijd, geheugen, schijf en kost per verwerking. Met *Logboek exporteren (CSV)* krijg je elke beoordeling en correctie met wie en wanneer.

## 6. Instellingen (`config.json`)

| Sleutel | Standaard | Uitleg |
|---|---|---|
| `naam` | `macmini` | naam van deze verwerkingscomputer in het Planbord |
| `supabase_url`, `supabase_anon_key` | — | zoals in `config.js` van het Planbord (publiek) |
| `email` | — | login van de verwerkingscomputer (het wachtwoord staat in de sleutelhanger) |
| `drive_script_url` | — | web app-URL van het Drive-script (Instellingen › Drive) |
| `whisper_cli`, `ffmpeg`, `ffprobe` | via PATH | programma's |
| `whisper_model` | `…/ggml-large-v3-turbo-q5_0.bin` | spraakmodel (kies na de praktijktest) |
| `vad_model` | `…/ggml-silero-v6.2.0.bin` | stiltedetectie: minder verzonnen tekst in stiltes; leeg = uit |
| `whisper_threads` | 4 | CPU-threads (de GPU doet het meeste werk) |
| `deel_minuten` | 10 | lengte van een deel; knippen gebeurt in een stilte |
| `woordenlijst` | werf, meetstaat, offerte, … | vaktermen die het spraakmodel als woordenschat meekrijgt, samen met de namen van het team en de deelnemers (bv. "werf" i.p.v. "wirf"). Een lijst: `["werf", "kalkplaat", …]` |
| `laag_vertrouwen` | 0.45 | segmenten met een lagere modelzekerheid worden "onduidelijk" gemarkeerd |
| `min_vrij_gb` | 15 | onder deze vrije ruimte neemt de Mac geen opdrachten meer aan |
| `llm.model` | `claude-sonnet-5-5` | taalmodel voor het conceptverslag |
| `llm.tweede_controle` | `false` | tweede AI-controle (zoekt extra fouten en gemiste punten; vervangt de menselijke controle niet) |
| `llm.prijs_input_per_mtok`, `llm.prijs_output_per_mtok` | 2 / 10 | enkel voor de kostenraming in het logboek |

## 7. Rechtstreeks opnemen (sinds 1.58)

In het Planbord neemt de knop **● Opnemen** (tabblad Vergaderingen) rechtstreeks op met de microfoon van laptop of gsm (webm/opus of m4a, ± 20 MB per uur) en laadt de opname bij het stoppen op via dezelfde weg (`vgOpnameOpladen`, bron `microfoon`). Zulke opnames hebben geen duur in de bestandskop: sinds 1.58.0 bepaalt de verwerker die door het geluid één keer te decoderen.

## Wat getest is

Getest in de ontwikkelomgeving (Linux, zonder Mac mini en zonder echte opnames):

- **Database** (lokale Postgres met dezelfde scripts):
  - rechten: beheer, projectlid, medewerker die geen lid is, klant, aannemer, verwerker en anoniem;
  - wachtrij: claimen, geen dubbele opdrachten, lease met hervatten, na 3 onderbrekingen mislukt, wachttijd na een fout, stoppen;
  - punten: bewaking van het origineel, taken zonder dubbels (ook na opnieuw verwerken), controle en heropenen;
  - delen met de klant: enkel na controle, nooit het transcript;
  - opslagregels: uploaddelen pas weg na de Drive-controle;
  - een project verwijderen ruimt alles op.
- **Verwerker**, met nagebootste Supabase, Drive-script, Anthropic-API en whisper-cli (zelfde JSON-formaat als whisper.cpp; geen echte spraakherkenning):
  - de volledige keten;
  - een crash in deel 2 met hervatten;
  - opnieuw verwerken uit Drive;
  - overbelaste en kapotte AI-antwoorden;
  - zonder API-sleutel;
  - een onleesbaar bestand;
  - stoppen door een gebruiker en stopsignaal/herstart;
  - een Planbord dat offline is;
  - een project zonder projectmap;
  - waarschuwingen bij weggelaten voorwaarden en ontkenningen, verzonnen namen en bedragen;
  - kritieke gegevens die zonder AI gevonden worden.
- **Planbord-scherm** (browser), de hele controleketen:
  - aanmaken, opladen in delen, signaal online/offline, bronfragment afspelen;
  - corrigeren, bevestigen, afwijzen, toevoegen;
  - taken met link, geen tweede taak;
  - controle, delen met de klant, intern project, mobiel.

**Niet getest:**

- whisper.cpp op de Mac mini (snelheid, geheugen, Metal);
- de nauwkeurigheid op Nederlandstalige opnames;
- het Drive-script tegen het echte Google Drive;
- de echte Anthropic-API.

Dat is de praktijktest hierboven.

---

## Plannen omzetten met Plan2CAD (v1.57)

Dezelfde verwerkingscomputer zet ook plannen om: iemand sleept een pdf of foto in het tabblad Plannen van een project, en de Mac mini maakt er een DXF (en DWG) op ware grootte van in de projectmap › **Plannen/DXF**.

| Stap | Waar | Wat |
|---|---|---|
| Opladen | browser → Supabase-opslag `plan2cad` (privé) | het plan (max. 50 MB) met een SHA-256-controlegetal |
| Wachtrij | Supabase (tabel `plan_omzettingen`, script 054) | de opdracht met de opties (pagina's, papierformaat, schaal, DWG) |
| Origineel bewaren | Google Drive, projectmap › Plannen/DXF (Drive-script, actie `plan`) | het origineel, met MD5-controle; pas daarna gaat het uit de opslag |
| Omzetten | **lokaal** op de Mac mini: Plan2CAD in een eigen Python-omgeving, als apart proces | per pagina of geplakt plannetje: lijnen, vlakken, tekst, schaal |
| DWG | **lokaal**: ODA File Converter (als die geïnstalleerd is) | DWG naast de DXF |
| Resultaat | Drive (Plannen/DXF) en de opslag `plan2cad` (om als onderlegger in de tekenmodule te openen) | DXF/DWG; een nieuwe versie stuurt de vorige naar de prullenbak van Drive |

Een schaal onder 75 % zekerheid wordt **nooit stil gebruikt**: het resultaat staat dan op *Schaal controleren* in het Planbord. Plannen gaan vóór opnames in de wachtrij (ze duren meestal 10 seconden tot een minuut).

### Installeren of bijwerken

1. `sql/054_plan_omzettingen.sql` uitvoeren in Supabase. De controle moet `1 | 1 | 1 | 54` geven.
2. Het nieuwe `drive/Code.gs` (of `Code.ingevuld.gs`) plakken en een **nieuwe versie** online zetten (actie `plan`).
3. Op de Mac mini: kopieer de map `verwerker/` (met de submap `plan2cad/`) en voer opnieuw uit:
   ```bash
   cd verwerker
   bash installeer.sh
   ```
   Het script installeert nu ook `tesseract` (Homebrew, voor maatgetallen op scans, foto's en CAD-pdf's), kopieert Plan2CAD naar `~/Library/Application Support/BROS-verwerker/plan2cad` en maakt er een eigen Python-omgeving voor (`plan2cad-venv`, ongeveer 600 MB). Instellingen en sleutelhanger blijven.
4. **DWG (optioneel):** installeer de gratis [ODA File Converter](https://www.opendesign.com/guestfiles/oda_file_converter) in Programma's. Zonder komt er enkel een DXF — Vectorworks en AutoCAD lezen die op ware grootte.
5. `python3 ~/Library/Application\ Support/BROS-verwerker/bros_verwerker.py controle` — de regel *Plan2CAD* moet OK zijn.

Instellingen in `config.json` (optioneel): `plan2cad_python`, `plan2cad_map` (standaard naast config.json) en `plan2cad_timeout` (standaard 1200 seconden per plan).

### Wat getest is

De volledige keten (wachtrij, origineel naar Drive met MD5, omzetten, DXF naar Drive en de opslag, herschalen vanuit Drive, mislukte bestanden, stoppen, vastgelopen opdrachten) in een testomgeving met de echte databasefuncties van script 054 en een nagebootst Drive-script, op een vectorplan (haardmeubel), een verslag met twee geplakte plannen en een kapot bestand. Nog niet getest: op de Mac mini zelf en met het echte Drive-script.

## Renders (v1.59, script 055)

De verwerkingscomputer maakt ook de renders uit het tabblad Renders van het Planbord en de A3-presentaties.

| Stap | Waar | Wat |
|---|---|---|
| Opdracht | Planbord → Supabase (`render_opdrachten`) | ontwerp + max. 4 sfeerbeelden in de opslag `renders`, afspraken van de ruimte als kopie |
| Renderen | Mac mini → **OpenAI** `images/edits` (betaald) | één aanvraag per render, **nooit automatisch herhaald**; formaat in de verhouding van het ontwerp |
| Resultaat | opslag `renders` + Drive (Renders/<ruimte>) | pas daarna "Klaar"; mislukt het opladen, dan blijft het beeld in de werkmap op de Mac mini |
| Presentatie | Mac mini (lokaal, `render/bros_presentatie.py` in de Python-omgeving van Plan2CAD) | A3-pdf in de huisstijl → opslag + Drive (Renders/Presentaties) |

**Veiligheid voor de kosten.** Vlak vóór de betaalde aanvraag legt de verwerker in de databank vast dat ze vertrekt (`render_api_start`, één keer per opdracht, enkel met een geldige claim). Alles wat daarna misloopt (time-out, fout 5xx, herstart, stroomuitval) wordt *Controle nodig* (`onzeker`) — nooit opnieuw in de wachtrij. Een aantoonbare weigering van OpenAI (4xx, bv. ongeldige sleutel of geweigerde inhoud) wordt *Mislukt*. Fouten vóór het versturen (ontwerp ophalen, netwerk) gaan opnieuw in de wachtrij (max. 3 keer, niets betaald). Zonder OpenAI-sleutel neemt de verwerker geen renders aan: ze blijven in de wachtrij.

### Installeren of bijwerken

1. `sql/055_renders.sql` uitvoeren in Supabase. De controle moet `4 | 4 | 1 | 55` geven.
2. Het nieuwe `drive/Code.gs` (of `Code.ingevuld.gs`) plakken en een **nieuwe versie** online zetten (actie `render`).
3. Op de Mac mini `bash installeer.sh` opnieuw uitvoeren (zie hierboven). Het script kopieert `render/` naar `~/Library/Application Support/BROS-verwerker/render` en vraagt **"OpenAI API-sleutel instellen voor renders? (j/n)"** — typ de sleutel daar zelf in (je ziet niets tijdens het typen; twee keer). Een sleutel uit het OpenAI Platform-project van BROS, met toegang tot beeldgeneratie en een maandlimiet.
4. `controle` moet tonen: *OpenAI-sleutel voor renders: aanwezig* en *A3-presentaties (huisstijl): OK*.
5. In het Planbord: Instellingen › Renders nakijken en **één proefrender** doen; kijk daarna het verbruik na in het OpenAI-dashboard.

Een andere sleutel: `security add-generic-password -U -s BROS-verwerker -a openai-api-key -w` en daarna de dienst herstarten (`launchctl kickstart -k gui/$(id -u)/be.bros.verwerker`).

Instellingen in `config.json` (optioneel): `openai_url`, `render_timeout` (standaard 600 seconden per render), `render_map`.

### Wat getest is

In een testomgeving met de echte databasefuncties van script 055 (50 tests: toegang voor team/klant/aannemer/verwerker, opslagregels, idempotentie ook bij 8 gelijktijdige aanvragen, daglimiet, onzeker/hervatten), de verwerker met een nagebootste OpenAI en Drive (18 tests: formaat, volgorde van de beelden, 5xx/time-out → onzeker zonder herhaling, 4xx → mislukt, geen sleutel, opslag die hapert, presentatie) en het tabblad in een echte browser (15 tests, ook gsm-breedte). Nog niet getest: een echte betaalde aanvraag bij OpenAI en het echte Drive-script — doe daarom eerst één proefrender.