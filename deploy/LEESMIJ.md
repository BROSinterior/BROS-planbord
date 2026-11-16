# Online zetten via de Mac mini (1.73, voorbereiding)

Twee scripts. Ze vragen bij elke stap je akkoord en bewaren geen geheimen in de repository.

| Script | Wat het doet |
|---|---|
| `bash deploy/versie.sh 1.74.0 "omschrijving"` | Zet APP_VERSION in app.js, alle `?v=` in index.html en version.json in één keer op de nieuwe versie. |
| `bash deploy/online-zetten.sh` | Voert de databasescripts uit die nog niet uitgevoerd zijn, en zet drive/Code.gs online (zelfde webapp-URL). |

Pushen naar GitHub (GitHub Pages) doe je zoals altijd. Het Planbord zelf staat online zodra de push klaar is; dit script doet enkel de databank en het Drive-script.

## Eenmalig installeren op de Mac mini

Typ deze commando's zelf in Terminal; je typt de geheimen nooit in een chat.

1. **psql** (voor de databasescripts):
   `brew install libpq && brew link --force libpq`
2. **De verbinding met Supabase** in de Keychain. In Supabase: Project Settings › Database › Connection string › URI (met je databankwachtwoord). Daarna:
   `security add-generic-password -U -s BROS-deploy -a supabase-db-url -w`
   en plak de URI wanneer erom gevraagd wordt (je ziet niets tijdens het plakken).
3. **clasp** (voor het Drive-script):
   `npm install -g @google/clasp` en daarna `clasp login`. Log in als het Google-account waaronder het Drive-script draait.
   Zet bij https://script.google.com/home/usersettings de **Google Apps Script API** aan.
4. **Het Drive-script-project koppelen.** De script-ID staat in de scripteditor › Projectinstellingen.
   `mkdir -p ~/bros-deploy && cd ~/bros-deploy && clasp clone <script-ID> --rootDir drive-script`
5. **De deployment-id** staat in de scripteditor › Implementeren › Implementaties beheren › de webapp › Implementatie-ID. Die id hoort bij de webapp-URL die in het Planbord staat:
   `security add-generic-password -U -s BROS-deploy -a drive-deployment-id -w`

**Vooraf:** voer in de scripteditor één keer `instellingenBewaren` uit (zie de stappen van 1.71). Daarna staan de 5 vaste waarden in de scripteigenschappen. Zo kan `drive/Code.gs` uit de repository zonder aanpassen online, en is `Code.ingevuld.gs` niet meer nodig.

## Bij een nieuwe versie

```
cd <map van de repository> && git pull
bash deploy/online-zetten.sh
```

Het script toont welke databasescripts nog openstaan en hoeveel regels het Drive-script verschilt met wat online staat. Pas na "ja" voert het iets uit. Bij een fout in een databasescript stopt het meteen; de scripts daarna blijven onuitgevoerd.
