/**
 * BROS Planbord — Drive-script (Google Apps Script)
 * Draait als brosburo@gmail.com en maakt/koppelt projectmappen in BROS/PROJECTEN.
 *
 * Installatie (eenmalig):
 *  1. Log in als brosburo@gmail.com op https://script.google.com → Nieuw project → plak dit bestand.
 *  2. Vul de map-ID's in CONFIG in (het deel van de URL na /folders/) en de rest van YUKI en PORTAAL (geen geheimen).
 *  3. Deploy → New deployment → type "Web app" → Execute as: Me → Who has access: Anyone → Deploy.
 *     Kopieer de "Web app URL" naar het Planbord onder Instellingen → Drive.
 *  4. Geheimen staan NIET in deze code maar in de Scripteigenschappen (tandwiel "Projectinstellingen" → Scripteigenschappen):
 *     zet daar SERVICE_KEY = de secret key van Supabase (sb_secret_…) en voer dan één keer sleutelsInstellen() uit.
 *     Die maakt zelf een nieuw Drive-secret (en zet het ook in het Planbord) en een nieuw wachtwoord voor de bot-login.
 *     Een nieuwe versie van dit script plakken wist de geheimen dus niet meer.
 *  Bij een latere wijziging aan dit script: Deploy → Manage deployments → potlood → Version: New → Deploy.
 *  Afspraken in de Google Agenda (script 041): kies bovenaan de functie agendaMachtiging, klik Uitvoeren en geef toestemming voor Agenda
 *  (melding "Google heeft deze app niet geverifieerd" → Geavanceerd → Ga naar … (onveilig) → Toestaan). Daarna een nieuwe versie online zetten.
 *  Controle: Planbord › Instellingen › Drive-koppeling › Agenda testen.
 */
/* ---- Geheimen: uit de Scripteigenschappen, nooit in de code (en dus nooit in git) ---- */
let _geheimen = null;
function geheim(naam) {
  if (!_geheimen) _geheimen = PropertiesService.getScriptProperties().getProperties();
  return String(_geheimen[naam] || "").trim();
}
function willekeurig() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ""); }   // 64 tekens, cryptografisch willekeurig
const CONFIG = {
  get SECRET() { return geheim("DRIVE_SECRET"); },   // scripteigenschap, gezet door sleutelsInstellen() (zelfde waarde staat in Planbord → Instellingen → Drive)
  PROJECTEN_FOLDER_ID: "VUL-IN",    // map BROS/PROJECTEN
  SJABLOON_FOLDER_ID: "VUL-IN",     // map BROS/PROJECTEN/A SJABLOON
};

function doPost(e) {
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || "{}");
    try { onderhoudZeker(); } catch (x) { }   // 1.48: de onderhoudstrigger bestaat (zonder dat iemand iets moet uitvoeren)
    if (body.action === "reset") return json(portaalReset(body));   // klantenportaal: "wachtwoord vergeten" — bewust zonder secret, stuurt enkel een mail naar een bestaande klantlogin
    if (body.action === "gkmail") return json(goedkeuringMail(body)); // portaal (klant beslist) én Planbord: identiteit en rol via het meegestuurde login-token
    if (body.action === "voorstelmail") return json(voorstelMailAannemer(body)); // aannemersportaal: melding van een vraag/opmerking (token-gecontroleerd, aannemer)
    if (body.action === "prijsaanvraagmail") return json(prijsaanvraagMail(body)); // prijsaanvragen: team (token) → aannemer, of aannemer (token) → BROS
    if (body.action === "koppelmail") return json(koppelMail(body));
    if (body.action === "aanprijsmail") return json(aanPrijsMail(body)); // meetstaat met prijzen (script 032): team (beheer) → aannemer bij delen, aannemer → BROS bij akkoord/tegenvoorstel
    if (body.action === "klantmelding") return json(klantMelding(body));
    if (body.action === "ovmail") return json(overeenkomstMail(body)); // overeenkomsten (script 039): voorgelegd (team), code en beslist (klant) // klantenportaal (script 035): keuze gemaakt, meerwerk aangevraagd of werfpunt gemeld → mail aan de projectverantwoordelijke
    if (body.action === "werfpuntmelding") return json(werfpuntMelding(body));
    if (body.action === "werfpuntfeedback") return json(werfpuntFeedback(body));   // aannemer (script 044): opmerking/foto bij een toegewezen werfpunt zonder het op te lossen → mail aan de projectverantwoordelijke   // aannemer (script 043): nieuw werfpunt gemeld in de werfmodus → mail aan de projectverantwoordelijke (token-gecontroleerd)
    if (body.action === "bestand") return json(portaalBestand(body)); // klant/aannemer: een gedeeld document ophalen om er een pdf-dossier van te maken (login + toegang gecontroleerd) // team (token): aannemer verwittigen dat hij aan een project gekoppeld is (met uitnodiging als hij nog geen login heeft)
    if (!body.secret || body.secret !== CONFIG.SECRET) return json({ ok: false, error: "Geen toegang (secret klopt niet)." });
    if (body.action === "ping") return json({ ok: true, info: "Verbinding en secret in orde.", projecten: DriveApp.getFolderById(CONFIG.PROJECTEN_FOLDER_ID).getName(), sjabloon: DriveApp.getFolderById(CONFIG.SJABLOON_FOLDER_ID).getName() });
    // Drive-acties: naast het secret ook een geldig teamlogin vereist (het secret alleen volstaat niet meer), en enkel mappen onder PROJECTEN
    if (body.action === "create") { caller(body.token, false); return json(createOrLink(String(body.klant || "").trim(), true)); }
    if (body.action === "link") { caller(body.token, false); return json(createOrLink(String(body.klant || "").trim(), false)); }
    if (body.action === "list") { caller(body.token, false); onderProjecten(String(body.folderId || "")); return json(listById(String(body.folderId || ""))); }
    if (body.action === "template") { caller(body.token, false); return json(getTemplate(String(body.match || "MEETSTAAT"))); }
    if (body.action === "put") { caller(body.token, false); onderProjecten(String(body.folderId || "")); return json(putFile(body)); }
    if (body.action === "invite") return json(portaalInvite(body));
    if (body.action === "share") return json(portaalShare(body));
    if (body.action === "notitiemail") return json(notitieMail(body));
    if (body.action === "assistentmail") return json(assistentMail(body));   // vanuit de Edge Function (secret), melding aan de verantwoordelijke
    if (body.action === "werfverslagmail") return json(werfverslagMail(body));
    if (body.action === "afspraak") return json(afspraakSync(body));
    if (body.action === "agendatest") return json(agendaStatus(body));   // Instellingen › Agenda testen (1.47)
    if (body.action === "antwoordmail") return json(antwoordMail(body));
    if (body.action === "werfpuntantwoord") return json(werfpuntAntwoord(body));
    if (body.action === "werfpuntreactie") return json(werfpuntReactie(body));   // werfpunt (script 044): reactie van BROS → mail aan de toegewezen aannemer   // werfpunt (script 043): antwoord van BROS aan de aannemer of klant die het meldde   // vragen beantwoorden (script 042): mail met het antwoord aan de aannemer of klant   // afspraken ter plaatse (script 041): Google Agenda van brosburo + mail met agendabestand aan de deelnemers
    return json({ ok: false, error: "Onbekende actie." });
  } catch (err) {
    const msg = String(err && err.message || err); console.error(msg);
    return json({ ok: false, error: /^(Supabase|Planbord|Drive:|Exception|TypeError|ReferenceError)/.test(msg) ? "Er ging iets mis in het Drive-script. Probeer het opnieuw of verwittig BROS." : msg });
  }
}
function doGet() { return json({ ok: true, info: "BROS Planbord Drive-script actief." }); }
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
/* ---- beveiliging (v1.30) ---- */
/** HTML-escape voor alles wat in een mail terechtkomt (namen, titels, opmerkingen van klanten en aannemers). */
function H(t) { return String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(x) { const v = String(x || "").trim(); if (!UUID_RE.test(v)) throw new Error("Ongeldige verwijzing."); return v; }
/** Teller tegen misbruik (mailbommen, dagquotum Gmail): max `max` keer per `sec` seconden per sleutel. */
function quotum(key, max, sec) {
  const lock = LockService.getScriptLock(); lock.waitLock(5000);
  try { const c = CacheService.getScriptCache(); const k = "q:" + key; const n = Number(c.get(k) || 0); if (n >= max) return false; c.put(k, String(n + 1), sec); return true; }
  finally { lock.releaseLock(); }
}
/** Eénmalig per sleutel binnen `sec` seconden (bv. één mail per beslissing). */
function eenmalig(key, sec) { return quotum("1:" + key, 1, sec); }
/** Beveiliging: een map-id moet onder BROS/PROJECTEN liggen (max. 8 niveaus diep), anders geen toegang. */
function onderProjecten(folderId) {
  if (!folderId) throw new Error("Geen map-id.");
  let id = folderId;
  for (let i = 0; i < 8; i++) {
    if (id === CONFIG.PROJECTEN_FOLDER_ID) return true;
    const r = UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(id) + "?supportsAllDrives=true&fields=id,parents", { headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    const f = JSON.parse(r.getContentText() || "{}"); if (f.error || !f.parents || !f.parents.length) break;
    id = f.parents[0];
  }
  throw new Error("Deze map ligt niet onder PROJECTEN.");
}

/** Maakt de projectmap aan uit het sjabloon (create=true) of koppelt een bestaande map met die naam. */
function createOrLink(klant, create) {
  if (!klant) return { ok: false, error: "Geen klantnaam." };
  const existing = driveQuery("mimeType='application/vnd.google-apps.folder' and trashed=false and '" + CONFIG.PROJECTEN_FOLDER_ID + "' in parents and name='" + klant.replace(/'/g, "\\'") + "'", "id,name,webViewLink");
  if (existing.length) { const f = existing[0]; return { ok: true, created: false, folder: { id: f.id, url: f.webViewLink, name: f.name }, files: listFiles(f.id, "") }; }
  // Geen exacte naam: zoek een map die op hoofdletters, spaties en leestekens na hetzelfde heet (bv. "Chantor - Mansi" ↔ "Chantor Mansi")
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
  const alle = driveQuery("mimeType='application/vnd.google-apps.folder' and trashed=false and '" + CONFIG.PROJECTEN_FOLDER_ID + "' in parents", "id,name,webViewLink");
  const lijkend = alle.filter(f => norm(f.name) === norm(klant));
  if (lijkend.length === 1) { const f = lijkend[0]; return { ok: true, created: false, folder: { id: f.id, url: f.webViewLink, name: f.name }, files: listFiles(f.id, "") }; }
  if (lijkend.length > 1) return { ok: false, error: "Meerdere mappen lijken op \"" + klant + "\": " + lijkend.map(f => f.name).join(", ") + ". Vul de exacte mapnaam in bij Drive-map." };
  if (!create) return { ok: false, error: "Geen map gevonden met de naam \"" + klant + "\" in PROJECTEN." };
  const root = driveCreateFolders([{ name: klant, parent: CONFIG.PROJECTEN_FOLDER_ID }])[0];
  const files = copyTemplate(root.id, klant);
  return { ok: true, created: true, folder: { id: root.id, url: root.webViewLink, name: root.name }, files: files };
}

/* ---- Sjabloon kopiëren via de Drive REST API: mappen per laag en alle bestanden tegelijk (fetchAll = parallel) ---- */
const SKIP = (name) => name.indexOf("~$") === 0 || name.indexOf("._") === 0 || name.indexOf("Icon") === 0 || name === ".DS_Store";
function driveReq(url, method, payload) {
  return { url: url, method: method, contentType: "application/json", payload: JSON.stringify(payload), headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
}
function driveFetchAll(reqs) {
  const out = [];
  chunks(reqs, 40).forEach(batch => {
    UrlFetchApp.fetchAll(batch).forEach(r => { const j = JSON.parse(r.getContentText() || "{}"); if (j.error) throw new Error("Drive API: " + (j.error.message || r.getResponseCode())); out.push(j); });
  });
  return out;
}
/** Maakt mappen aan ({name, parent}) en geeft ze terug in dezelfde volgorde. */
function driveCreateFolders(specs) {
  if (!specs.length) return [];
  return driveFetchAll(specs.map(s => driveReq("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,webViewLink", "post", { name: s.name, mimeType: "application/vnd.google-apps.folder", parents: [s.parent] })));
}
/** Kopieert de volledige inhoud van A SJABLOON naar de nieuwe projectmap; geeft de lijst van gekopieerde bestanden terug. */
function copyTemplate(dstRootId, klant) {
  const srcId = CONFIG.SJABLOON_FOLDER_ID;
  const map = {}; map[srcId] = { dst: dstRootId, path: "" };   // sjabloonmap-id → nieuwe map-id + pad
  let level = [srcId];
  while (level.length) {                                       // mappenboom laag per laag
    let subs = [];
    chunks(level, 20).forEach(ids => {
      const q = "mimeType='application/vnd.google-apps.folder' and trashed=false and (" + ids.map(i => "'" + i + "' in parents").join(" or ") + ")";
      driveQuery(q, "id,name,parents").forEach(f => { const parent = (f.parents || []).find(p => map[p]); if (parent) subs.push({ src: f.id, name: f.name, parent: parent }); });
    });
    if (!subs.length) break;
    const made = driveCreateFolders(subs.map(s => ({ name: s.name, parent: map[s.parent].dst })));
    subs.forEach((s, i) => { map[s.src] = { dst: made[i].id, path: map[s.parent].path ? map[s.parent].path + "/" + s.name : s.name }; });
    level = subs.map(s => s.src);
    if (Object.keys(map).length > 300) break;
  }
  const srcIds = Object.keys(map);                             // alle bestanden in één keer opzoeken …
  let files = [];
  chunks(srcIds, 20).forEach(ids => {
    const q = "mimeType!='application/vnd.google-apps.folder' and trashed=false and (" + ids.map(i => "'" + i + "' in parents").join(" or ") + ")";
    driveQuery(q, "id,name,parents").forEach(f => { if (SKIP(f.name)) return; const parent = (f.parents || []).find(p => map[p]); if (parent) files.push({ src: f.id, name: renameFor(f.name, klant), parent: parent }); });
  });
  const copied = driveFetchAll(files.map(f => driveReq("https://www.googleapis.com/drive/v3/files/" + f.src + "/copy?supportsAllDrives=true&fields=id,name,mimeType,size,modifiedTime,webViewLink", "post", { name: f.name, parents: [map[f.parent].dst] })));
  return copied.map((c, i) => ({ id: c.id, name: c.name, path: map[files[i].parent].path, url: c.webViewLink, mime: c.mimeType, size: Number(c.size) || 0, updated: c.modifiedTime })).filter(f => !/^image\/|^video\//.test(f.mime || ""));
}
/** "SJABLOON MEETSTAAT 2026 DEF.xlsx" → "MEETSTAAT 2026 DEF Chantor Mansi.xlsx"; "TEMPLATE_BROS.skp" → "Chantor Mansi.skp" */
function renameFor(name, klant) {
  const dot = name.lastIndexOf("."); const base = dot > 0 ? name.slice(0, dot) : name; const ext = dot > 0 ? name.slice(dot) : "";
  let b = base.replace(/SJABLOON/ig, "").replace(/TEMPLATE_?BROS/ig, "").replace(/TEMPLATE/ig, "").replace(/[\s_]+/g, " ").trim();
  return (b ? b + " " : "") + klant + ext;
}
function listById(folderId) {
  if (!folderId) return { ok: false, error: "Geen map-id." };
  const r = UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/files/" + folderId + "?supportsAllDrives=true&fields=id,name,webViewLink", { headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  const f = JSON.parse(r.getContentText()); if (f.error) throw new Error("Map niet gevonden: " + (f.error.message || ""));
  const lijst = { volledig: true }; const files = listFiles(f.id, "", lijst);
  return { ok: true, folder: { id: f.id, url: f.webViewLink, name: f.name }, files: files, volledig: lijst.volledig };   // volledig: geen limiet geraakt (dan mag het Planbord verdwenen bestanden opruimen)
}

/* ---- Snel oplijsten via de Drive REST API (DriveApp is te traag per map) ---- */
const MAX_FILES = 1200;
const MAX_IMG_PER_MAP = 60;   // afbeeldingen per map (renders, plannen als png); fotomappen van de werf blijven zo hanteerbaar
function driveQuery(q, fields) {
  let out = [], pageToken = null;
  do {
    const url = "https://www.googleapis.com/drive/v3/files?pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&q=" + encodeURIComponent(q) + "&fields=" + encodeURIComponent("nextPageToken,files(" + fields + ")") + (pageToken ? "&pageToken=" + pageToken : "");
    const r = UrlFetchApp.fetch(url, { headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    const j = JSON.parse(r.getContentText());
    if (j.error) throw new Error("Drive API: " + (j.error.message || r.getResponseCode()));
    out = out.concat(j.files || []); pageToken = j.nextPageToken;
  } while (pageToken);
  return out;
}
function chunks(arr, n) { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; }
/* 1.48: "kol=in.(…)" in stukken van 25 — een URL van Apps Script mag niet langer dan ±2 kB zijn (anders "URLFetch URL Length") */
function pbIn(voor, kol, ids, na) { let o = []; chunks([...new Set((ids || []).filter(Boolean))], 25).forEach(c => { o = o.concat(pbAdmin(voor + kol + "=in.(" + c.join(",") + ")" + (na || ""), "get") || []); }); return o; }
/* 1.48: genoeg dagquotum voor mails over? (gmail.com: ±100 ontvangers per dag) — houdt een reserve voor de belangrijke mails (codes, uitnodigingen, goedkeuringen) */
function mailRuimte(n) { try { return MailApp.getRemainingDailyQuota() >= (n || 1) + 20; } catch (e) { return true; } }
function listFiles(rootId, path, info) {
  info = info || {};
  const paths = {}; paths[rootId] = path || "";
  let level = [rootId], allIds = [rootId];
  // mappenboom in de breedte (één aanvraag per laag van max. 20 mappen)
  while (level.length) {
    let next = [];
    chunks(level, 20).forEach(ids => {
      const q = "mimeType='application/vnd.google-apps.folder' and trashed=false and (" + ids.map(i => "'" + i + "' in parents").join(" or ") + ")";
      driveQuery(q, "id,name,parents").forEach(f => { const parent = (f.parents || []).find(p => paths[p] !== undefined); if (parent === undefined) return; paths[f.id] = paths[parent] ? paths[parent] + "/" + f.name : f.name; next.push(f.id); allIds.push(f.id); });
    });
    level = next;
    if (allIds.length > 300) { info.volledig = false; break; }
  }
  // bestanden van alle mappen (video's overslaan; afbeeldingen wel, maar max. MAX_IMG_PER_MAP per map — de recentste)
  let out = []; const imgs = {};
  chunks(allIds, 20).forEach(ids => {
    if (out.length >= MAX_FILES) { info.volledig = false; return; }
    const q = "mimeType!='application/vnd.google-apps.folder' and trashed=false and not mimeType contains 'video/' and (" + ids.map(i => "'" + i + "' in parents").join(" or ") + ")";
    driveQuery(q, "id,name,mimeType,size,modifiedTime,webViewLink,parents").forEach(f => {
      if (f.name.indexOf("~$") === 0 || f.name.indexOf("._") === 0 || f.name.indexOf("Icon") === 0 || f.name === ".DS_Store") return;
      const parent = (f.parents || []).find(p => paths[p] !== undefined);
      const row = { id: f.id, name: f.name, path: parent !== undefined ? paths[parent] : "", url: f.webViewLink, mime: f.mimeType, size: Number(f.size) || 0, updated: f.modifiedTime };
      if ((f.mimeType || "").indexOf("image/") === 0) { (imgs[row.path] = imgs[row.path] || []).push(row); } else out.push(row);
    });
  });
  Object.keys(imgs).forEach(p => { const l = imgs[p].sort((a, b) => String(b.updated).localeCompare(String(a.updated))); if (l.length > MAX_IMG_PER_MAP) info.volledig = false; out = out.concat(l.slice(0, MAX_IMG_PER_MAP)); });
  if (out.length > MAX_FILES) info.volledig = false;
  return out.slice(0, MAX_FILES);
}

/* ---- Sjabloonbestand ophalen en een bestand in de projectmap wegschrijven (voor de meetstaat-export) ---- */
/** Zoekt in A SJABLOON het Excel-bestand waarvan de naam `match` bevat en geeft het terug als base64. */
function getTemplate(match) {
  const files = listFiles(CONFIG.SJABLOON_FOLDER_ID, "").filter(f => f.name.toUpperCase().indexOf(match.toUpperCase()) >= 0 && /\.xlsx$/i.test(f.name) && f.name.indexOf("~$") !== 0);
  if (!files.length) return { ok: false, error: "Geen sjabloon gevonden met \"" + match + "\" in de naam (map A SJABLOON)." };
  const jaar = (n) => Math.max(0, ...(String(n).match(/\b20\d\d\b/g) || []).map(Number));
  files.sort((a, b) => jaar(b.name) - jaar(a.name) || String(b.updated).localeCompare(String(a.updated)));   // 1.48: bij "…2026" en "…2027" het nieuwste jaar, anders het laatst gewijzigde
  const f = files[0];
  const r = UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/files/" + f.id + "?alt=media&supportsAllDrives=true", { headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) return { ok: false, error: "Sjabloon niet leesbaar (" + r.getResponseCode() + ")." };
  return { ok: true, name: f.name, path: f.path, base64: Utilities.base64Encode(r.getContent()) };
}
/** Schrijft een bestand (base64) in de projectmap, in de submap `subpath` (bv. "Documenten/Meetstaat/DEF"); submappen worden aangemaakt als ze ontbreken.
 *  Met `archiveTo` (bv. "Documenten/Meetstaat") verhuizen bestaande Excel-bestanden uit de doelmap eerst naar die map, met hun wijzigingsdatum vóór de naam (logboek van versies). */
function putFile(body) {
  const folderId = String(body.folderId || ""); if (!folderId) return { ok: false, error: "Geen projectmap gekoppeld." };
  const root = DriveApp.getFolderById(folderId);
  const folder = subfolder(root, String(body.subpath || ""));
  const archived = [];
  if (body.archiveTo) {
    const dest = subfolder(root, String(body.archiveTo));
    const it = folder.getFiles();
    while (it.hasNext()) {
      const f = it.next(); const n = f.getName();
      if (!/\.xlsx$/i.test(n) || n.indexOf("~$") === 0 || n.indexOf("._") === 0) continue;
      const d = f.getLastUpdated(); const stamp = ("0" + d.getDate()).slice(-2) + ("0" + (d.getMonth() + 1)).slice(-2) + d.getFullYear();
      let newName = /^\d{8}\s/.test(n) ? n : stamp + " " + n; const base = newName.replace(/\.xlsx$/i, ""); let k = 2;
      while (dest.getFilesByName(newName).hasNext()) newName = base + " (" + (k++) + ").xlsx";
      f.moveTo(dest); f.setName(newName);
      archived.push({ id: f.getId(), name: newName, url: f.getUrl(), path: String(body.archiveTo), size: f.getSize(), mime: f.getMimeType(), updated: d.toISOString() });
    }
  }
  let name = String(body.name || "bestand.xlsx"); const mExt = name.match(/^(.*?)(\.[A-Za-z0-9]{1,5})?$/); const base = mExt[1], ext = mExt[2] || ""; let k = 2;   // extensie behouden (ook .pdf)
  while (folder.getFilesByName(name).hasNext()) { name = base + " (" + (k++) + ")" + ext; }
  const blob = Utilities.newBlob(Utilities.base64Decode(String(body.base64 || "")), body.mime || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name);
  const file = folder.createFile(blob);
  return { ok: true, archived: archived, file: { id: file.getId(), name: file.getName(), url: file.getUrl(), path: String(body.subpath || ""), size: file.getSize(), mime: file.getMimeType(), updated: new Date().toISOString() } };
}
/** Zoekt (of maakt) een submappad; mapnamen worden vergeleken zonder hoofdletters en zonder punt/spatie op het einde ("DEF." = "DEF"). */
function subfolder(root, path) {
  let folder = root;
  const norm = (s) => String(s).trim().replace(/[.\s]+$/, "").toLowerCase();
  path.split("/").filter(Boolean).forEach(seg => {
    const it = folder.getFolders(); let found = null;
    while (it.hasNext()) { const f = it.next(); if (norm(f.getName()) === norm(seg)) { found = f; break; } }
    folder = found || folder.createFolder(seg);
  });
  return folder;
}

/* =====================================================================
   Yuki-koppeling: verkoopfacturen uit de mail koppelen aan vorderingen in het Planbord
   - Yuki mailt "Factuur van BROS: Factuur voor <klant>" (afzender via yukiworks.be); die mails moeten in deze
     Gmail (brosburo@gmail.com) toekomen — via een doorstuurfilter vanuit accounting@bros.be.
   - yukiSync() leest de nieuwe mails, haalt nummer/datum/klant/bedrag uit mail en pdf, zoekt de juiste vordering
     via de Planbord-database (login als bot-gebruiker) en vult factuurnummer, datum en bedrag in (status verzonden).
   - Verwerkte mails krijgen het label "Planbord/verwerkt"; een samenvatting gaat per mail naar YUKI.REPORT_TO.
   Installatie: YUKI invullen, éénmaal yukiInstall() uitvoeren (maakt de uurlijkse trigger + het label).
   ===================================================================== */
const YUKI = {
  PLANBORD_URL: "VUL-IN",          // Supabase Project URL, bv. https://xxxx.supabase.co
  PLANBORD_KEY: "VUL-IN",          // publishable/anon key (zelfde als in config.js)
  BOT_EMAIL: "VUL-IN",             // Planbord-gebruiker voor de koppeling (bv. planbord-bot@bros.be)
  get BOT_PASSWORD() { return geheim("BOT_PASSWORD"); },   // scripteigenschap, gezet door sleutelsInstellen()
  REPORT_TO: "info@bros.be",       // samenvatting na elke run met resultaat
  QUERY: 'subject:"Factuur van BROS" newer_than:60d -label:planbord-verwerkt -label:planbord-te-bekijken',   // Yuki verstuurt "namens" accounting@bros.be via yukiworks.be
  LABEL: "Planbord/verwerkt",
  LABEL_CHECK: "Planbord/te bekijken",   // niet gekoppeld: één keer gemeld; label weghalen in Gmail = opnieuw proberen
  TOL: 1.0,                        // toegelaten verschil in euro tussen factuur en berekend bedrag
};
/* =====================================================================
   Klantenportaal — uitnodigen en bestanden delen (vanuit het Planbord, actie "invite" en "share")
   Vereist de scripteigenschap SERVICE_KEY: Supabase → Project Settings → API Keys → Secret keys → een sb_secret_…-key.
   Die sleutel staat ALLEEN in de Scripteigenschappen van dit script — nooit in de code, de app of config.js.
   De uitnodigingsmail vertrekt uit de Gmail van het script (brosburo@gmail.com), zodat er geen SMTP-instelling nodig is.
   ===================================================================== */
const PORTAAL = {
  get SERVICE_KEY() { return geheim("SERVICE_KEY"); },   // scripteigenschap: de secret key van Supabase (sb_secret_…), zelf in te vullen
  URL: "https://brosinterior.github.io/BROS-planbord/klant/",   // ook toevoegen bij Supabase → Authentication → URL Configuration → Redirect URLs
  URL_AANNEMER: "https://brosinterior.github.io/BROS-planbord/aannemer/",   // aannemersportaal — idem bij Redirect URLs
  AFZENDER: "BROS",
  VAN: "archief@bros.be",   // afzender van de mails naar klanten — moet in Gmail van brosburo@gmail.com ingesteld staan als "E-mail verzenden als"-alias; anders vertrekt de mail van brosburo met dit adres als antwoordadres
  ONDERWERP: "Welkom in je BROS-klantenportaal",
};
/** Mail naar de klant: vanuit PORTAAL.VAN als dat een Gmail-alias is, anders vanuit het scriptaccount met PORTAAL.VAN als reply-to. */
function portaalMail(to, subject, text, html) {
  subject = String(subject || "").replace(/[\r\n]+/g, " ").slice(0, 240);
  const opt = { htmlBody: html, name: PORTAAL.AFZENDER };
  if (PORTAAL.VAN) { const aliases = GmailApp.getAliases(); if (aliases.indexOf(PORTAAL.VAN) >= 0) opt.from = PORTAAL.VAN; else opt.replyTo = PORTAAL.VAN; }
  GmailApp.sendEmail(to, subject, text, opt);
}
/** Controle: welke afzenders kan dit account gebruiken? (Uitvoeren in de editor → Logboek.) */
function portaalAliassen() { Logger.log("Aliassen van " + Session.getActiveUser().getEmail() + ": " + JSON.stringify(GmailApp.getAliases()) + " — PORTAAL.VAN = " + PORTAAL.VAN); }
function pbAdmin(path, method, body, prefer) {
  if (!PORTAAL.SERVICE_KEY) throw new Error("De secret key van Supabase ontbreekt: zet ze als scripteigenschap SERVICE_KEY (Projectinstellingen → Scripteigenschappen).");
  const headers = { apikey: PORTAAL.SERVICE_KEY };
  if (PORTAAL.SERVICE_KEY.indexOf("sb_") !== 0) headers.Authorization = "Bearer " + PORTAAL.SERVICE_KEY;   // enkel de oude service_role-JWT hoort ook als Bearer; een sb_secret_-key niet
  const opt = { method: method || "get", contentType: "application/json", headers: headers, muteHttpExceptions: true };
  if (prefer) headers.Prefer = prefer;
  if (body) opt.payload = JSON.stringify(body);
  const r = UrlFetchApp.fetch(YUKI.PLANBORD_URL + path, opt); const t = r.getContentText();
  if (r.getResponseCode() >= 300) throw new Error("Supabase " + r.getResponseCode() + ": " + t.slice(0, 300));
  return t ? JSON.parse(t) : null;
}
/** Wie roept het script aan? Het Planbord stuurt het login-token mee; we lezen zijn profiel (rol) met dat token. */
function caller(token, beheerOnly) {
  if (!token) throw new Error("Geen login meegestuurd — log opnieuw in op het Planbord.");
  const u = pbReq("/auth/v1/user", "get", null, token);
  const prof = pbReq("/rest/v1/profiles?id=eq." + u.id + "&select=role,name,active", "get", null, token);
  const role = prof && prof[0] && prof[0].active !== false ? prof[0].role : "";
  if (beheerOnly ? role !== "beheer" : (role !== "beheer" && role !== "medewerker")) throw new Error(beheerOnly ? "Alleen beheerders kunnen portaaltoegang geven." : "Geen toegang.");
  return { id: u.id, name: prof[0].name, role: role };
}
/** Uitnodigings- of herstellink voor een portaallogin (klant of aannemer); koppelt de login aan het contact. */
function portaalLink(email, naam, contactId, rol) {
  const url = rol === "aannemer" ? PORTAAL.URL_AANNEMER : PORTAAL.URL;
  let j, bestaand = false;
  if (contactId) contactId = uuid(contactId);
  try { j = pbAdmin("/auth/v1/admin/generate_link", "post", { type: "invite", email: email, data: { name: String(naam || "").slice(0, 80) }, redirect_to: url }); }
  catch (e) {
    if (!/already|exists|registered|duplicate/i.test(String(e))) throw e;
    bestaand = true;
    j = pbAdmin("/auth/v1/admin/generate_link", "post", { type: "recovery", email: email, redirect_to: url });
  }
  const link = j.action_link || (j.properties && j.properties.action_link); let userId = j.id || (j.user && j.user.id);
  if (!link) throw new Error("Geen uitnodigingslink gekregen van Supabase.");
  if (!userId) { const pr = pbAdmin("/rest/v1/profiles?email=eq." + encodeURIComponent(email) + "&select=id", "get") || []; userId = pr[0] && pr[0].id; }
  if (!userId) throw new Error("Geen gebruiker gekregen van Supabase.");
  if (bestaand) {
    const prof = pbAdmin("/rest/v1/profiles?id=eq." + userId + "&select=role,active", "get");
    const r0 = prof && prof[0];
    // een inactieve 'medewerker' is een (al dan niet ongewenste) registratie zonder toegang: die mag een portaallogin worden
    if (r0 && r0.role !== rol && !(r0.role === "medewerker" && !r0.active)) throw new Error("Dit e-mailadres hoort al bij een " + (r0.role === "beheer" || r0.role === "medewerker" ? "teamlid van het Planbord" : "login als " + r0.role) + "; gebruik een ander adres.");
    // 1.48: een inactieve 'medewerker' kan iemand zijn die zich zelf registreerde met het adres van de klant (en dus het wachtwoord kent):
    // nooit zo'n login overnemen — eerst verwijderen, dan een verse uitnodiging (enkel wie de mail ontvangt kiest het wachtwoord)
    const gebruikt = r0 && r0.role === "medewerker" && !r0.active && ["uren?user_id", "taken?assignee", "projecten?lead"].some(q => (pbAdmin("/rest/v1/" + q + "=eq." + userId + "&select=id&limit=1", "get") || []).length);
    if (r0 && r0.role === "medewerker" && !r0.active && !gebruikt) {   // (een oud-teamlid met uren/taken wordt gewoon omgezet, zoals vroeger)
      pbAdmin("/auth/v1/admin/users/" + userId, "delete");
      j = pbAdmin("/auth/v1/admin/generate_link", "post", { type: "invite", email: email, data: { name: String(naam || "").slice(0, 80) }, redirect_to: url });
      const l2 = j.action_link || (j.properties && j.properties.action_link); const u2 = j.id || (j.user && j.user.id);
      if (!l2 || !u2) throw new Error("Geen nieuwe uitnodigingslink gekregen van Supabase.");
      return portaalKoppelAf(l2, u2, false, url, rol, contactId);
    }
  }
  return portaalKoppelAf(link, userId, bestaand, url, rol, contactId);
}
function portaalKoppelAf(link, userId, bestaand, url, rol, contactId) {
  pbAdmin("/rest/v1/rpc/portaal_koppel", "post", { p_user: userId, p_rol: rol, p_contact: contactId || null });   // rol + koppeling (script 030)
  if (contactId) pbAdmin("/rest/v1/contacten?id=eq." + contactId, "patch", { portaal_sinds: new Date().toISOString() });
  return { link: link, userId: userId || null, bestaand: bestaand, url: url };
}
function portaalInvite(body) {
  const wie = caller(body.token, true);
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Geen geldig e-mailadres: " + email };
  const naam = String(body.naam || "").trim(); const contactId = String(body.contact_id || ""); const rol = body.rol === "aannemer" ? "aannemer" : "klant";
  let r; try { r = portaalLink(email, naam, contactId, rol); } catch (e) { return { ok: false, error: String(e.message || e) }; }
  const link = r.link, userId = r.userId, bestaand = r.bestaand;
  const aanhef = naam ? "Beste " + naam : "Beste";
  if (rol === "aannemer") {
    const tekstA = aanhef + ",\n\nBROS geeft je toegang tot het aannemersportaal. Daar vind je per project de werfpunten die aan jou toegewezen zijn (met foto's en plannen), de werfverslagen, de documenten die we delen en de prijsaanvragen die we je sturen. Werfpunten meld je er als opgelost, met een bewijsfoto.\n\nKies je wachtwoord via deze link:\n" + link + "\n\nDaarna log je altijd in op " + PORTAAL.URL_AANNEMER + " met je e-mailadres en wachtwoord. Op de werf gebruik je dezelfde login in de werfmodus (" + PORTAAL.URL_AANNEMER.replace(/aannemer\/?$/, "werf/") + "), die ook zonder bereik werkt.\nDe link hierboven is beperkt geldig; is hij vervallen, klik dan op het portaal op \"Wachtwoord vergeten\".\n\nMet vriendelijke groeten,\n" + wie.name + " — BROS";
    const htmlA = "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1B1E1C\"><p>" + H(aanhef) + ",</p><p>BROS geeft je toegang tot het <b>aannemersportaal</b>. Daar vind je per project de werfpunten die aan jou toegewezen zijn (met foto's en plannen), de werfverslagen, de documenten die we delen en de prijsaanvragen die we je sturen. Werfpunten meld je er als opgelost, met een bewijsfoto.</p>"
      + "<p style=\"margin:24px 0\"><a href=\"" + link + "\" style=\"background:#1B1E1C;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block\">Kies je wachtwoord</a></p>"
      + "<p>Daarna log je altijd in op <a href=\"" + PORTAAL.URL_AANNEMER + "\">" + PORTAAL.URL_AANNEMER + "</a> met je e-mailadres en wachtwoord. Op de werf gebruik je dezelfde login in de <a href=\"" + PORTAAL.URL_AANNEMER.replace(/aannemer\/?$/, "werf/") + "\">werfmodus</a> op je smartphone, die ook zonder bereik werkt.<br><span style=\"color:#767D78;font-size:13px\">De knop hierboven is beperkt geldig; is hij vervallen, klik dan op het portaal op \"Wachtwoord vergeten\".</span></p>"
      + "<p>Met vriendelijke groeten,<br>" + H(wie.name) + " — BROS</p></div>";
    portaalMail(email, "Toegang tot het BROS-aannemersportaal", tekstA, htmlA);
    return { ok: true, bestaand: bestaand, user_id: userId };
  }
  const tekst = aanhef + ",\n\nWelkom in je persoonlijke BROS-klantenportaal. Daar volg je je project op de voet: de meetstaat, de facturatie, de planning en de documenten die we met je delen.\n\nKies je wachtwoord via deze link:\n" + link + "\n\nDaarna log je altijd in op " + PORTAAL.URL + " met je e-mailadres en wachtwoord.\nDe link hierboven is beperkt geldig; is hij vervallen, klik dan op het portaal op \"Wachtwoord vergeten\" en je krijgt een nieuwe.\n\nTot snel,\n" + wie.name + " — BROS";
  const html = "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1B1E1C\"><p>" + H(aanhef) + ",</p><p>Welkom in je persoonlijke <b>BROS-klantenportaal</b>. Daar volg je je project op de voet: de meetstaat, de facturatie, de planning en de documenten die we met je delen.</p>"
    + "<p style=\"margin:24px 0\"><a href=\"" + link + "\" style=\"background:#1B1E1C;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block\">Kies je wachtwoord</a></p>"
    + "<p>Daarna log je altijd in op <a href=\"" + PORTAAL.URL + "\">" + PORTAAL.URL + "</a> met je e-mailadres en wachtwoord.<br><span style=\"color:#767D78;font-size:13px\">De knop hierboven is beperkt geldig; is hij vervallen, klik dan op het portaal op \"Wachtwoord vergeten\" en je krijgt een nieuwe link.</span></p>"
    + "<p>Tot snel,<br>" + H(wie.name) + " — BROS</p></div>";
  portaalMail(email, PORTAAL.ONDERWERP, tekst, html);
  return { ok: true, bestaand: bestaand, user_id: userId || null };
}
/** "Wachtwoord vergeten" op het portaal: herstellink per Gmail, enkel voor klantlogins; geeft nooit prijs of een adres bestaat. */
function portaalReset(body) {
  const t0 = Date.now();
  try { return portaalResetIntern(body); }
  finally { const rest = 3500 - (Date.now() - t0); if (rest > 0) Utilities.sleep(rest); }   // altijd even lang: verraadt niet of er een account bestaat
}
function portaalResetIntern(body) {
  const email = String(body.email || "").trim().toLowerCase();
  if (email.length > 200 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: true };
  if (!eenmalig("reset:" + email, 600)) return { ok: true };          // max. één mail per 10 minuten per adres
  if (!quotum("reset-dag:" + email, 4, 86400) || !mailRuimte(1)) return { ok: true };   // 1.48: max. 4 per dag per adres, en nooit het laatste dagquotum (reserve voor codes en uitnodigingen)
  if (!quotum("reset-alle", 30, 3600)) return { ok: true };           // en hoogstens 30 per uur in totaal
  try {
    const prof = pbAdmin("/rest/v1/profiles?email=eq." + encodeURIComponent(email) + "&role=in.(klant,aannemer)&active=eq.true&select=id,name,role", "get");
    if (!prof || !prof.length) return { ok: true };
    const url = prof[0].role === "aannemer" ? PORTAAL.URL_AANNEMER : PORTAAL.URL;
    const j = pbAdmin("/auth/v1/admin/generate_link", "post", { type: "recovery", email: email, redirect_to: url });
    const link = j.action_link || (j.properties && j.properties.action_link); if (!link) return { ok: true };
    const naam = prof[0].name || "";
    const pnaam = prof[0].role === "aannemer" ? "BROS-aannemersportaal" : "BROS-klantenportaal";
    portaalMail(email, "Nieuw wachtwoord voor je " + pnaam, "Beste " + naam + ",\n\nVia deze link kies je een nieuw wachtwoord voor het " + pnaam + ":\n" + link + "\n\nVroeg je dit niet aan, dan mag je deze mail negeren.\n\nBROS",
      "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1B1E1C\"><p>Beste " + H(naam) + ",</p><p>Via de knop hieronder kies je een nieuw wachtwoord voor het " + pnaam + ".</p><p style=\"margin:24px 0\"><a href=\"" + link + "\" style=\"background:#1B1E1C;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block\">Nieuw wachtwoord kiezen</a></p><p style=\"color:#767D78;font-size:13px\">Vroeg je dit niet aan, dan mag je deze mail negeren.</p><p>BROS</p></div>");
  } catch (e) { Logger.log("reset: " + e); }
  return { ok: true };
}
/** Wie roept aan (team of klant)? Geeft {id, name, role}; gooit als het token niet klopt. */
function callerAny(token) {
  if (!token) throw new Error("Geen login meegestuurd.");
  const u = pbReq("/auth/v1/user", "get", null, token);
  const prof = pbReq("/rest/v1/profiles?id=eq." + u.id + "&select=role,name,email,active", "get", null, token);
  if (!prof || !prof[0] || prof[0].active === false) throw new Error("Geen actieve login.");
  return { id: u.id, name: prof[0].name, role: prof[0].role, email: prof[0].email || u.email };
}
/** Klantenportaal (script 035): melding aan BROS als de klant een keuze maakt, meerwerk aanvraagt of een werfpunt meldt.
 *  Enkel een actieve klant, enkel records die hij via zijn eigen views ziet; max. 30 per uur per login. */
function klantMelding(body) {
  const wie = callerAny(body.token);
  if (wie.role !== "klant") return { ok: false, error: "Geen toegang." };
  if (!quotum("klantmelding:" + wie.id, 30, 3600)) return { ok: false, error: "Te veel meldingen in korte tijd." };
  const id = uuid(body.id); const soort = String(body.soort || "");
  const view = { keuze: "klant_keuzes", meerwerk: "klant_meerwerk_aanvragen", werfpunt: "klant_vaststellingen" }[soort];
  if (!view) return { ok: false, error: "Onbekende melding." };
  const rij = (pbReq("/rest/v1/" + view + "?id=eq." + id + "&select=*", "get", null, body.token) || [])[0];
  if (!rij) return { ok: false, error: "Niet gevonden." };
  if ((soort === "keuze" && rij.status !== "gekozen") || (soort === "meerwerk" && rij.status !== "ingediend") || (soort === "werfpunt" && !rij.te_beoordelen)) return { ok: true, overgeslagen: true };
  if (!eenmalig("klantmelding:" + soort + ":" + id, 21600)) return { ok: true, al: true };   // één mail per record
  const p = (pbAdmin("/rest/v1/projecten?id=eq." + rij.project_id + "&select=id,nummer,klant,naam,lead", "get") || [])[0] || {};
  const lead = p.lead ? (pbAdmin("/rest/v1/profiles?id=eq." + p.lead + "&select=name,email", "get") || [])[0] : null;
  const naar = (lead && lead.email) || YUKI.REPORT_TO; const proj = (p.klant || "") + (p.naam && p.naam !== p.klant ? " · " + p.naam : "");
  let onderwerp, lijnen = [];
  if (soort === "keuze") {
    const o = rij.gekozen_optie ? (pbReq("/rest/v1/klant_keuze_opties?id=eq." + rij.gekozen_optie + "&select=naam,meerprijs", "get", null, body.token) || [])[0] : null;
    onderwerp = "Keuze gemaakt: " + rij.onderwerp;
    lijnen = [(rij.ruimte ? rij.ruimte + " · " : "") + rij.onderwerp, "Gekozen: " + (o ? o.naam + (Number(o.meerprijs) ? " (" + (Number(o.meerprijs) > 0 ? "+" : "−") + " € " + Math.abs(Number(o.meerprijs)).toFixed(2).replace(".", ",") + " excl. btw — staat als meer-/minwerk in de meetstaat)" : " (inbegrepen)") : "?"), "Door: " + (rij.gekozen_naam || wie.name)].concat(rij.gekozen_opmerking ? ["Opmerking: " + rij.gekozen_opmerking] : []);
  } else if (soort === "meerwerk") {
    onderwerp = "Meerwerk aangevraagd: " + rij.titel;
    lijnen = [rij.titel + (rij.ruimte ? " (" + rij.ruimte + ")" : ""), rij.omschrijving || "", (rij.fotos || []).length ? (rij.fotos.length + " foto('s) — zie het Planbord › Meetstaat") : ""].filter(Boolean);
  } else {
    onderwerp = "Werfpunt gemeld: " + rij.titel;
    lijnen = ["V-" + ("00" + rij.nr).slice(-3) + " · " + rij.titel + (rij.ruimte ? " (" + rij.ruimte + ")" : ""), rij.omschrijving || "", "Te beoordelen in het Planbord › Werf: goedkeuren en een verantwoordelijke kiezen."].filter(Boolean);
  }
  const html = "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1B1E1C;max-width:640px\"><p><b>" + H(wie.name || "De klant") + "</b> (" + H(proj) + ") via het klantenportaal:</p><ul>" + lijnen.map(l => "<li style=\"white-space:pre-line\">" + H(l) + "</li>").join("") + "</ul>"
    + ((rij.fotos || []).slice(0, 6).map(f => String(f.url || "").indexOf(YUKI.PLANBORD_URL + "/storage/v1/object/public/werf/") === 0 ? "<a href=\"" + H(f.url) + "\"><img src=\"" + H(f.url) + "\" width=\"120\" style=\"border-radius:6px;margin:2px\"></a>" : "").join("")) + "</div>";
  GmailApp.sendEmail(naar, "Portaal · " + proj + " · " + onderwerp, wie.name + " (" + proj + ") via het klantenportaal:\n\n- " + lijnen.join("\n- "), { htmlBody: html, name: "BROS Planbord" });
  return { ok: true };
}
/** Goedkeuringsmails: "voorgelegd" (team → klant: er wacht een voorstel) en "beslist" (klant → BROS-melding + bevestiging aan de klant). */
function goedkeuringMail(body) {
  const wie = callerAny(body.token); const soort = String(body.soort || "");
  if (soort !== "voorgelegd" && soort !== "beslist") return { ok: false, error: "Onbekende soort." };
  if (soort === "voorgelegd" && wie.role !== "beheer" && wie.role !== "medewerker") return { ok: false, error: "Geen toegang." };
  if (soort === "beslist" && wie.role !== "klant") return { ok: false, error: "Geen toegang." };
  const g = (pbAdmin("/rest/v1/goedkeuringen?id=eq." + uuid(body.id) + "&select=*", "get") || [])[0];
  if (!g) return { ok: false, error: "Voorstel niet gevonden." };
  if (soort === "beslist" && g.beslist_door !== wie.id) return { ok: false, error: "Geen toegang." };
  if (soort === "beslist" && !eenmalig("gk:" + g.id + ":" + g.status + ":" + (g.beslist_op || ""), 21600)) return { ok: true };   // één mail per beslissing
  if (soort === "voorgelegd" && !quotum("gkv:" + g.id, 3, 3600)) return { ok: false, error: "Dit voorstel werd net al gemaild; probeer het later opnieuw." };
  const p = (pbAdmin("/rest/v1/projecten?id=eq." + g.project_id + "&select=nummer,klant,naam,lead", "get") || [])[0] || {};
  const pcs = pbAdmin("/rest/v1/project_contacten?project_id=eq." + g.project_id + "&rol=in.(bouwheer,contactpersoon)&select=contact_id", "get") || [];
  const klanten = pcs.length ? (pbAdmin("/rest/v1/contacten?id=in.(" + pcs.map(x => x.contact_id).join(",") + ")&user_id=not.is.null&select=naam,email", "get") || []).filter(c => c.email) : [];
  const eur = (n) => "€ " + Number(n || 0).toLocaleString("nl-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nl = (n) => Number(n || 0).toLocaleString("nl-BE", { maximumFractionDigits: 2 });
  const rows = (g.posten || []).map(x => "<tr><td style=\"padding:4px 8px;color:#767D78;font-family:monospace\">" + H(x.code) + "</td><td style=\"padding:4px 8px\">" + String(x.omschrijving || "").replace(/</g, "&lt;") + (x.locatie ? " <span style=\"color:#767D78\">· " + H(x.locatie) + "</span>" : "") + "</td><td style=\"padding:4px 8px;text-align:right;white-space:nowrap\">" + nl(x.hoeveelheid) + " " + H(x.eenheid) + "</td><td style=\"padding:4px 8px;text-align:right;white-space:nowrap\">" + eur(x.prijs) + "</td><td style=\"padding:4px 8px;text-align:right;white-space:nowrap\">" + eur(x.totaal) + "</td></tr>").join("");
  const tabel = "<table style=\"border-collapse:collapse;width:100%;font-size:13px\"><thead><tr style=\"color:#767D78;font-size:11px;text-transform:uppercase\"><th align=\"left\" style=\"padding:4px 8px\">Nr</th><th align=\"left\" style=\"padding:4px 8px\">Omschrijving</th><th align=\"right\" style=\"padding:4px 8px\">Hoev.</th><th align=\"right\" style=\"padding:4px 8px\">Prijs</th><th align=\"right\" style=\"padding:4px 8px\">Totaal</th></tr></thead><tbody>" + rows
    + "<tr><td colspan=\"4\" style=\"padding:6px 8px;border-top:2px solid #C6C3B9\"><b>Totaal excl. btw</b></td><td style=\"padding:6px 8px;text-align:right;border-top:2px solid #C6C3B9\"><b>" + eur(g.totaal_excl) + "</b></td></tr><tr><td colspan=\"4\" style=\"padding:2px 8px\">Btw</td><td style=\"padding:2px 8px;text-align:right\">" + eur(g.btw) + "</td></tr><tr><td colspan=\"4\" style=\"padding:2px 8px\"><b>Totaal incl. btw</b></td><td style=\"padding:2px 8px;text-align:right\"><b>" + eur(g.totaal_incl) + "</b></td></tr></tbody></table>";
  const kop = (g.soort === "meerwerk" ? "Meerwerkvoorstel" : "Offerte") + " · " + (p.klant || "") + (p.naam && p.naam !== p.klant ? " · " + p.naam : "");
  const wrap = (inner) => "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1B1E1C;max-width:720px\">" + inner + "</div>";
  const naar = [];
  if (soort === "voorgelegd") {
    klanten.forEach(c => {
      const tot = g.geldig_tot ? " Graag je reactie vóór <b>" + g.geldig_tot.split("-").reverse().join("/") + "</b>." : "";
      const html = wrap("<p>Beste " + H(c.naam || "") + ",</p><p>Er staat een voorstel voor je klaar in je BROS-klantenportaal: <b>" + H(g.titel) + "</b>." + tot + (g.toelichting ? "</p><p style=\"white-space:pre-line\">" + H(g.toelichting) : "") + "</p><p style=\"margin:24px 0\"><a href=\"" + PORTAAL.URL + "\" style=\"background:#1B1E1C;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block\">Bekijken en goedkeuren</a></p>" + tabel + "<p style=\"margin-top:20px\">Vragen? Antwoord gerust op deze mail.<br>" + H(wie.name) + " — BROS</p>");
      portaalMail(c.email, "Voorstel ter goedkeuring: " + g.titel, "Beste " + (c.naam || "") + ",\n\nEr staat een voorstel voor je klaar in je BROS-klantenportaal: " + g.titel + " (" + eur(g.totaal_incl) + " incl. btw).\nBekijken en goedkeuren: " + PORTAAL.URL + "\n\n" + wie.name + " — BROS", html); naar.push(c.email);
    });
  } else {
    const ok = g.status === "akkoord"; const wanneer = g.beslist_op ? new Date(g.beslist_op).toLocaleString("nl-BE", { timeZone: "Europe/Brussels" }) : "";
    const melding = wrap("<p>" + (ok ? "<b>Akkoord</b> van de klant" : "<b>Niet akkoord</b> / vraag van de klant") + " voor <b>" + H(kop) + "</b>.</p><p>Voorstel: <b>" + H(g.titel) + "</b> (" + eur(g.totaal_incl) + " incl. btw)<br>Beslist door: " + H(g.beslist_naam) + " (" + H(g.beslist_email) + ") op " + wanneer + "</p>" + (g.opmerking ? "<p style=\"padding:10px 14px;border-left:3px solid #B93A34;background:#F7DEDC\">“" + H(g.opmerking) + "”</p>" : "") + tabel + "<p style=\"color:#767D78;font-size:13px\">Automatische melding uit het BROS Planbord — de posten staan " + (ok ? "op Akkoord" : "ongewijzigd") + " in de meetstaat van project " + (p.nummer || "") + ".</p>");
    portaalMail(YUKI.REPORT_TO, (ok ? "✔ Akkoord" : "✖ Niet akkoord") + " — " + kop + " — " + g.titel, (ok ? "Akkoord" : "Niet akkoord") + " van " + g.beslist_naam + " voor " + g.titel + " (" + kop + ")" + (g.opmerking ? "\n\nOpmerking: " + g.opmerking : ""), melding); naar.push(YUKI.REPORT_TO);
    if (g.beslist_email) {
      const bevestiging = wrap("<p>Beste " + H(g.beslist_naam) + ",</p>" + (ok ? "<p>Bedankt voor je akkoord op <b>" + H(g.titel) + "</b>. Dit is je bevestiging; hieronder staat wat je hebt goedgekeurd.</p>" : "<p>We hebben je reactie op <b>" + H(g.titel) + "</b> goed ontvangen en nemen contact met je op.</p><p style=\"padding:10px 14px;border-left:3px solid #C6C3B9;background:#ECEAE3\">“" + (g.opmerking || "").replace(/</g, "&lt;") + "”</p>") + tabel + "<p style=\"color:#767D78;font-size:13px\">Vastgelegd op " + wanneer + " door " + H(g.beslist_naam) + " (" + H(g.beslist_email) + ").</p><p>BROS</p>");
      portaalMail(g.beslist_email, (ok ? "Bevestiging van je akkoord: " : "Je reactie op: ") + g.titel, (ok ? "Bedankt voor je akkoord op " : "We ontvingen je reactie op ") + g.titel + " (" + eur(g.totaal_incl) + " incl. btw).\n\nBROS", bevestiging); naar.push(g.beslist_email);
    }
  }
  return { ok: true, naar: naar };
}
/* =====================================================================
   Overeenkomsten goedkeuren in het klantenportaal (script 039)
   'voorgelegd' (team → iedere tekenaar), 'code' (klant: eenmalige code van 6 cijfers per mail, 15 min geldig),
   'beslist' (klant: melding aan BROS, bevestiging aan de tekenaar; als iedereen akkoord is ook aan alle tekenaars).
   ===================================================================== */
function overeenkomstMail(body) {
  const soort = String(body.soort || "");
  if (["voorgelegd", "code", "beslist"].indexOf(soort) < 0) return { ok: false, error: "Onbekende soort." };
  const wie = callerAny(body.token);
  if (soort === "voorgelegd" && wie.role !== "beheer" && wie.role !== "medewerker") return { ok: false, error: "Geen toegang." };
  if (soort !== "voorgelegd" && wie.role !== "klant") return { ok: false, error: "Geen toegang." };
  const g = (pbAdmin("/rest/v1/goedkeuringen?id=eq." + uuid(body.id) + "&soort=eq.overeenkomst&select=*", "get") || [])[0];
  if (!g) return { ok: false, error: "Overeenkomst niet gevonden." };
  const p = (pbAdmin("/rest/v1/projecten?id=eq." + g.project_id + "&select=nummer,klant,naam,lead", "get") || [])[0] || {};
  const proj = (p.klant || "") + (p.naam && p.naam !== p.klant ? " · " + p.naam : "");
  const ts = pbAdmin("/rest/v1/goedkeuring_tekenaars?goedkeuring_id=eq." + g.id + "&select=id,contact_id,status,beslist_naam,beslist_email,beslist_op,code_tot,created_at&order=created_at,id", "get") || [];
  const cs = ts.length ? (pbAdmin("/rest/v1/contacten?id=in.(" + ts.map(t => t.contact_id).join(",") + ")&select=id,naam,contactpersoon,email,user_id,actief", "get") || []) : [];
  const wrap = (inner) => "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1B1E1C;max-width:640px\">" + inner + "</div>";
  const knop = (url, txt) => "<p style=\"margin:24px 0\"><a href=\"" + url + "\" style=\"background:#1B1E1C;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block\">" + txt + "</a></p>";
  const tot = g.geldig_tot ? String(g.geldig_tot).split("-").reverse().join("/") : "";
  if (soort === "voorgelegd") {
    if (!quotum("ovv:" + g.id, 3, 3600)) return { ok: false, error: "Deze overeenkomst werd net al gemaild; probeer het later opnieuw." };
    const naar = [];
    ts.filter(t => t.status === "open").forEach(t => { const c = cs.find(x => x.id === t.contact_id); if (!c || !c.email || !c.user_id) return;
      const naam = c.contactpersoon || c.naam;
      const html = wrap("<p>Beste " + H(naam) + ",</p><p>In je BROS-klantenportaal staat een overeenkomst klaar om goed te keuren: <b>" + H(g.titel) + "</b>" + (tot ? " (graag vóór <b>" + tot + "</b>)" : "") + ".</p>"
        + (g.toelichting ? "<p style=\"padding:10px 14px;border-left:3px solid #DAD8D0;white-space:pre-line\">" + H(g.toelichting) + "</p>" : "")
        + "<p>Je leest de overeenkomst (pdf) in het portaal onder <b>Akkoord</b>. Ga je akkoord, dan bevestig je met je naam en een code die je per mail krijgt." + (ts.length > 1 ? " Iedere bouwheer keurt zelf goed." : "") + "</p>"
        + knop(PORTAAL.URL, "Overeenkomst bekijken") + "<p>Met vriendelijke groeten,<br>" + H(wie.name) + " — BROS</p>");
      portaalMail(String(c.email).trim(), "Overeenkomst ter goedkeuring: " + g.titel, "Beste " + naam + ",\n\nIn je BROS-klantenportaal staat een overeenkomst klaar om goed te keuren: " + g.titel + (tot ? " (graag vóór " + tot + ")" : "") + ".\nBekijken: " + PORTAAL.URL + "\n\n" + wie.name + " — BROS", html);
      naar.push(c.email); });
    return { ok: true, naar: naar };
  }
  const mijn = cs.filter(c => c.user_id === wie.id && c.actief !== false).map(c => c.id);   // zoals overeenkomst_beslis (mijn_contacten: enkel actieve)
  const t = ts.find(x => mijn.indexOf(x.contact_id) >= 0 && (soort === "code" ? x.status === "open" : true));
  if (!t) return { ok: false, error: "Je hoeft deze overeenkomst niet (meer) goed te keuren." };
  if (soort === "code") {
    if (g.status !== "open") return { ok: false, error: "Over deze overeenkomst is al beslist." };
    if (!quotum("ovc:" + t.id, 5, 3600)) return { ok: false, error: "Je vroeg al enkele codes aan; wacht even en probeer het dan opnieuw." };
    if (!wie.email) return { ok: false, error: "Geen e-mailadres bij je login." };
    let code = ""; while (code.length < 6) { const b = Utilities.getUuid().replace(/\D/g, ""); code += b; } code = code.slice(0, 6);
    const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, code + t.id, Utilities.Charset.UTF_8).map(b => ("0" + (b & 0xff).toString(16)).slice(-2)).join("");
    // de code zelf in goedkeuring_codes (niemand met een login kan die lezen); geldigheid en pogingen bij de tekenaar
    pbAdmin("/rest/v1/goedkeuring_codes?tekenaar_id=eq." + t.id, "delete");
    pbAdmin("/rest/v1/goedkeuring_codes", "post", { tekenaar_id: t.id, code_hash: hash });
    pbAdmin("/rest/v1/goedkeuring_tekenaars?id=eq." + t.id, "patch", { code_tot: new Date(Date.now() + 15 * 60000).toISOString(), code_pogingen: 0, code_email: wie.email });
    const html = wrap("<p>Je code om de overeenkomst <b>" + H(g.titel) + "</b> goed te keuren:</p><p style=\"font-size:30px;font-weight:700;letter-spacing:6px;margin:18px 0\">" + code.slice(0, 3) + " " + code.slice(3) + "</p><p>De code is 15 minuten geldig. Heb je ze niet zelf aangevraagd? Dan hoef je niets te doen — zonder code gebeurt er niets.</p><p>BROS</p>");
    portaalMail(wie.email, "Je code voor " + g.titel + ": " + code, "Je code om de overeenkomst " + g.titel + " goed te keuren: " + code + "\nDe code is 15 minuten geldig.\n\nBROS", html);
    const e = String(wie.email); return { ok: true, naar: e.replace(/^(.).*(@.*)$/, "$1…$2") };
  }
  // beslist
  if (!t.beslist_op || !eenmalig("ovb:" + t.id + ":" + t.status + ":" + t.beslist_op, 21600)) return { ok: true };
  const ok = t.status === "akkoord"; const wanneer = new Date(t.beslist_op).toLocaleString("nl-BE", { timeZone: "Europe/Brussels" });
  const profs = pbAdmin("/rest/v1/profiles?select=id,name,email,role&active=eq.true", "get") || [];
  const lead = profs.find(x => x.id === p.lead); const maker = profs.find(x => x.id === g.voorgelegd_door);
  const team = [...new Set([YUKI.REPORT_TO, lead && lead.email, maker && maker.email].filter(Boolean))].join(",");
  const stand = ts.map(x => { const c = cs.find(y => y.id === x.contact_id) || {}; return "<li>" + H(c.naam || "?") + ": " + (x.status === "akkoord" ? "akkoord (" + H(x.beslist_naam) + ")" : x.status === "geweigerd" ? "niet akkoord" : "nog niet") + "</li>"; }).join("");
  const opm = (pbAdmin("/rest/v1/goedkeuring_tekenaars?id=eq." + t.id + "&select=opmerking", "get") || [])[0] || {};
  portaalMail(team, (ok ? "✔ Akkoord" : "✖ Niet akkoord") + " — overeenkomst " + g.titel + " — " + proj, (ok ? "Akkoord" : "Niet akkoord") + " van " + t.beslist_naam + " op " + g.titel + " (" + proj + ")." + (opm.opmerking ? "\n\nOpmerking: " + opm.opmerking : ""),
    wrap("<p>" + (ok ? "<b>Akkoord</b>" : "<b>Niet akkoord</b>") + " op de overeenkomst <b>" + H(g.titel) + "</b> (" + H(proj) + ").</p><p>Door: " + H(t.beslist_naam) + " (" + H(t.beslist_email) + ") op " + H(wanneer) + "</p>" + (opm.opmerking ? "<p style=\"white-space:pre-line\">Opmerking: " + H(opm.opmerking) + "</p>" : "")
      + "<p>Stand:</p><ul>" + stand + "</ul>" + (g.status === "akkoord" ? "<p>Iedereen is akkoord. Het Planbord maakt de getekende pdf en bewaart die in de projectmap (Documenten/Overeenkomsten) zodra het open staat.</p>" : "")));
  if (t.beslist_email) portaalMail(t.beslist_email, (ok ? "Bevestiging van je akkoord: " : "Je reactie op: ") + g.titel,
    (ok ? "Bedankt voor je akkoord op " : "We ontvingen je reactie op ") + g.titel + ".\n\nBROS",
    wrap("<p>Beste " + H(t.beslist_naam) + ",</p>" + (ok ? "<p>Bedankt voor je akkoord op de overeenkomst <b>" + H(g.titel) + "</b>, vastgelegd op " + H(wanneer) + ".</p><p>Controlecode van het document (SHA-256): <span style=\"font-family:monospace;font-size:12px\">" + H(g.bestand_sha256) + "</span></p>"
      + (g.status === "akkoord" ? "<p>Iedereen heeft nu goedgekeurd. De getekende versie verschijnt in je portaal onder Documenten.</p>" : "<p>De overeenkomst is goedgekeurd zodra ook de andere bouwheer(en) akkoord gaven.</p>")
      : "<p>We ontvingen je reactie op <b>" + H(g.titel) + "</b> en nemen contact met je op.</p>") + "<p>BROS</p>"));
  return { ok: true };
}
/* =====================================================================
   Afspraken ter plaatse (script 041)
   Het Planbord roept 'afspraak' aan na elke wijziging aan een taak met een afspraak (en vóór het verwijderen, met weg: true).
   - Google Agenda van dit account (brosburo): "PB/Klant, onderwerp" met het adres; bijgewerkt of verwijderd als de afspraak wijzigt.
   - Deelnemers (contacten met e-mail): mail met agendabestand (.ics) bij een nieuwe/gewijzigde afspraak, annulering als ze vervalt
     of als iemand niet meer aangevinkt is. Wat gemaild werd, staat in taken.afspraak_mail ({hash, aan, seq}).
   Eerste keer: voer agendaMachtiging() één keer uit in de editor (toestemming voor Google Agenda), en zet daarna een nieuwe versie online.
   ===================================================================== */
const AFS_BROS_ADRES = "BROS, Kloosterstraat 165, 2000 Antwerpen";
const AFS_AGENDA_ID = "brosburo@gmail.com";   // de agenda waarin de afspraken komen (scripteigenschap AGENDA_ID overschrijft dit)
const AFS_MACHTIGING = "Het Drive-script heeft nog geen toestemming voor Google Agenda. Open het script als brosburo@gmail.com, kies bovenaan de functie agendaMachtiging, klik Uitvoeren en geef toestemming (bij \"niet geverifieerd\": Geavanceerd → Ga naar … → Toestaan). Zet daarna een nieuwe versie online.";
function agendaFout(e) {   // Google-foutmelding → wat je moet doen
  const m = String((e && e.message) || e || "");
  if (/permission|toestemming|authori[sz]|Required permissions|machtiging|gemachtigd|scope/i.test(m)) return new Error(AFS_MACHTIGING + " [Google: " + m.slice(0, 220) + "]");
  return e instanceof Error ? e : new Error(m);
}
function scriptAccount() { try { return Session.getEffectiveUser().getEmail() || ""; } catch (e) { return ""; } }
function agendaKalender() {
  const id = geheim("AGENDA_ID") || AFS_AGENDA_ID; let cal = null;
  try {
    cal = CalendarApp.getCalendarById(id);
    if (!cal && scriptAccount().toLowerCase() === id.toLowerCase()) cal = CalendarApp.getDefaultCalendar();
  } catch (e) { throw agendaFout(e); }
  if (!cal) { const me = scriptAccount(); throw new Error("De agenda " + id + " is niet bereikbaar voor het Drive-script" + (me ? " (dat draait als " + me + ")" : "") + ". Zet het script onder " + id + ", of deel die agenda met dat account (Wijzigingen aanbrengen in afspraken)."); }
  return cal;
}
/* één keer uitvoeren in de editor: vraagt de toestemming voor Google Agenda en test meteen of een afspraak aanmaken lukt */
const AFS_SCOPE = "https://www.googleapis.com/auth/calendar";
function agendaMachtiging() {
  // vraagt (in de editor) uitdrukkelijk de toestemming voor Google Agenda, ook als die vroeger werd uitgevinkt
  if (ScriptApp.requireScopes) ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, [AFS_SCOPE]);
  const cal = agendaKalender(); const t0 = new Date(Date.now() + 86400000);
  const ev = cal.createEvent("BROS Planbord — test (mag weg)", t0, new Date(t0.getTime() + 900000)); ev.deleteEvent();
  Logger.log("Agenda in orde: " + cal.getName() + " (" + cal.getId() + "), script draait als " + scriptAccount() + ". Zet nu een nieuwe versie online: Implementeren → Implementaties beheren → potlood → Versie: Nieuwe versie → Implementeren.");
}
/* Planbord › Instellingen › Agenda testen */
function agendaStatus(body) {
  caller(body.token, false);
  try { const cal = agendaKalender(); return { ok: true, agenda: cal.getName(), id: cal.getId(), account: scriptAccount() }; }
  catch (e) { return { ok: false, error: agendaFout(e).message }; }
}
function afsIcs(a, weg, organisator, deelnemer) {
  const pad = (n) => ("0" + n).slice(-2);
  const e = (x) => String(x == null ? "" : x).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  // regels van max. 75 bytes (UTF-8), nooit midden in een teken
  const vouw = (l) => { const o = []; let cur = "", n = 0; for (const ch of l) { const c = ch.codePointAt(0); const b = c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; if (n + b > 74) { o.push(cur); cur = " "; n = 1; } cur += ch; n += b; } o.push(cur); return o.join("\r\n"); };
  const d = String(a.datum).replace(/-/g, ""); const v = String(a.van).slice(0, 5).split(":").map(Number);
  let t = a.tot ? String(a.tot).slice(0, 5).split(":").map(Number) : null;
  if (!t || t[0] * 60 + t[1] <= v[0] * 60 + v[1]) { const m = Math.min(v[0] * 60 + v[1] + 60, 23 * 60 + 59); t = [Math.floor(m / 60), m % 60]; }
  const n = new Date(); const stamp = n.getUTCFullYear() + pad(n.getUTCMonth() + 1) + pad(n.getUTCDate()) + "T" + pad(n.getUTCHours()) + pad(n.getUTCMinutes()) + pad(n.getUTCSeconds()) + "Z";
  const r = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//BROS//Planbord//NL", "CALSCALE:GREGORIAN", "METHOD:" + (weg ? "CANCEL" : "PUBLISH"),
    "BEGIN:VTIMEZONE", "TZID:Europe/Brussels", "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST", "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
    "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD", "END:VTIMEZONE",
    "BEGIN:VEVENT", "UID:taak-" + a.id + "@bros.be", "DTSTAMP:" + stamp, "SEQUENCE:" + (a.seq || 0),
    "DTSTART;TZID=Europe/Brussels:" + d + "T" + pad(v[0]) + pad(v[1]) + "00", "DTEND;TZID=Europe/Brussels:" + d + "T" + pad(t[0]) + pad(t[1]) + "00",
    "SUMMARY:" + e(a.titel), "LOCATION:" + e(a.adres), "DESCRIPTION:" + e(a.omschrijving), "STATUS:" + (weg ? "CANCELLED" : "CONFIRMED"),
    ...(organisator ? ["ORGANIZER;CN=BROS:mailto:" + organisator] : []), ...(deelnemer ? ["ATTENDEE;CN=\"" + String(deelnemer.naam || deelnemer.email).replace(/["\r\n]/g, "") + "\":mailto:" + deelnemer.email] : []), "END:VEVENT", "END:VCALENDAR"];
  return r.map(vouw).join("\r\n") + "\r\n";
}
function afspraakSync(body) {
  caller(body.token, false);
  const id = uuid(body.id);
  if (!quotum("afs:" + id, 30, 3600)) return { ok: false, error: "Deze afspraak werd het voorbije uur al heel vaak bijgewerkt; probeer het later opnieuw." };
  // één tegelijk: twee snelle bewaringen na elkaar mogen geen dubbel agenda-item of dubbele mails geven
  // 1.48: een eigen slot (UserLock — het script draait altijd als hetzelfde account) i.p.v. het scriptslot, zodat quotum()/eenmalig() van andere acties (codes, goedkeuringen) niet moeten wachten
  const lock = LockService.getUserLock(); if (!lock.tryLock(30000)) return { ok: false, error: "Het Drive-script is bezig; probeer het zo opnieuw." };
  try { return afspraakSyncIn(body, id); } finally { lock.releaseLock(); }
}
function afspraakSyncIn(body, id) {
  const t = (pbAdmin("/rest/v1/taken?id=eq." + id + "&select=*", "get") || [])[0];
  if (!t) return { ok: false, error: "Taak niet gevonden." };
  const p = (pbAdmin("/rest/v1/projecten?id=eq." + t.project_id + "&select=nummer,klant,naam", "get") || [])[0] || {};
  const actief = !body.weg && !!t.afspraak && !!t.start && !!t.afspraak_van;
  const onderwerpRuw = String(t.afspraak_onderwerp || "").trim() || t.titel;
  // 1.48.2: begint het onderwerp al met initialen ("PB/ …", "PB + NDK/ …"): die gebruiken in de agendatitel, en ze weglaten in de mail aan de klant
  const voor = String(onderwerpRuw).match(/^\s*([A-Z]{1,4}(?:\s*\+\s*[A-Z]{1,4})*)\s*\/\s*/);
  const onderwerp = voor ? String(onderwerpRuw).slice(voor[0].length).trim() || onderwerpRuw : onderwerpRuw;
  const prof = t.assignee ? ((pbAdmin("/rest/v1/profiles?id=eq." + t.assignee + "&select=name,initials,email", "get") || [])[0] || null) : null;
  const ini = prof ? String(prof.initials || String(prof.name || "").slice(0, 2)).toUpperCase() : "BROS";
  const ids = (t.afspraak_contacten || []).filter(x => UUID_RE.test(String(x)));
  const cs = ids.length ? (pbAdmin("/rest/v1/contacten?id=in.(" + ids.join(",") + ")&select=id,naam,contactpersoon,email,taal,actief", "get") || []) : [];
  const van = String(t.afspraak_van || "").slice(0, 5), tot = t.afspraak_tot ? String(t.afspraak_tot).slice(0, 5) : "";
  const res = { ok: true, agenda: "", gemaild: [], geannuleerd: [] };
  const patch = {};
  // ---- 1. Google Agenda van brosburo
  const wilAgenda = actief && t.afspraak_agenda !== false;
  try {   // agendafouten (bv. nog geen toestemming: agendaMachtiging()) mogen de mails niet tegenhouden
  const cal = wilAgenda || t.agenda_event_id ? agendaKalender() : null;
  let ev = null; if (cal && t.agenda_event_id) { try { ev = cal.getEventById(t.agenda_event_id); } catch (e) { ev = null; } }
  if (wilAgenda) {
    const begin = Utilities.parseDate(t.start + " " + van, "Europe/Brussels", "yyyy-MM-dd HH:mm");
    let einde = tot ? Utilities.parseDate(t.start + " " + tot, "Europe/Brussels", "yyyy-MM-dd HH:mm") : new Date(begin.getTime() + 3600000);
    if (einde <= begin) einde = new Date(begin.getTime() + 3600000);
    const titel = (voor ? voor[1].replace(/\s*\+\s*/g, " + ") : ini) + "/" + (p.klant || "") + ", " + onderwerp;   // "PB/Klant, onderwerp" (of "PB + NDK/…")
    const besch = [(p.nummer ? p.nummer + " · " : "") + (p.klant || "") + (p.naam && p.naam !== p.klant ? " · " + p.naam : ""),
      prof ? "BROS: " + prof.name : "", cs.length ? "Deelnemers: " + cs.map(c => c.naam).join(", ") : "", t.notitie ? "Notitie: " + t.notitie : "", "(Aangemaakt vanuit het BROS Planbord — wijzig de afspraak in het Planbord, niet hier.)"].filter(Boolean).join("\n");
    if (ev) { ev.setTitle(titel); ev.setTime(begin, einde); ev.setLocation(t.afspraak_adres || ""); ev.setDescription(besch); res.agenda = "gewijzigd"; }
    else { ev = cal.createEvent(titel, begin, einde, { location: t.afspraak_adres || "", description: besch }); res.agenda = "gezet"; }
    if (ev.getId() !== t.agenda_event_id) pbAdmin("/rest/v1/taken?id=eq." + t.id, "patch", { agenda_event_id: ev.getId() });   // meteen bewaren (geen dubbel item als iets hierna misloopt)
  } else if (ev || t.agenda_event_id) {
    if (ev) { try { ev.deleteEvent(); } catch (e) { } res.agenda = "verwijderd"; }
    patch.agenda_event_id = null;
  }
  } catch (e) { console.error("agenda: " + e); const f = agendaFout(e); res.agendaFout = true; res.waarschuwing = "Niet in de Google Agenda gezet: " + (f.message.indexOf(AFS_MACHTIGING) === 0 ? f.message : String(f.message).slice(0, 200)); }
  // ---- 2. mails aan de deelnemers
  const vorig = t.afspraak_mail || {}; const vorigAan = (vorig.aan || []).map(String);
  const mailen = t.afspraak_mailen !== false && t.start >= Utilities.formatDate(new Date(), "Europe/Brussels", "yyyy-MM-dd");
  const ontvangers = actief ? cs.filter(c => c.actief !== false && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(c.email || "").trim())) : [];
  const aan = ontvangers.map(c => String(c.email).trim().toLowerCase());
  const hash = actief ? JSON.stringify([t.start, van, tot, t.afspraak_adres || "", onderwerpRuw]) : "";   // ruw: bestaande afspraken worden niet opnieuw gemaild
  let seq = Number(vorig.seq) || 0; const gewijzigd = !!vorig.hash && hash !== vorig.hash;
  const datumTxt = (en) => { const d = Utilities.parseDate(t.start + " 12:00", "Europe/Brussels", "yyyy-MM-dd HH:mm"); const dagen = en ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] : ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"]; return dagen[Number(Utilities.formatDate(d, "Europe/Brussels", "u")) % 7] + " " + Utilities.formatDate(d, "Europe/Brussels", "dd/MM/yyyy") + ", " + van + (tot ? "–" + tot : ""); };
  const wrap = (inner) => "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1B1E1C;max-width:640px\">" + inner + "</div>";
  const stuur = (c, weg, nieuwsoort) => {
    const en = String(c.taal || "") === "en"; const naam = c.contactpersoon || c.naam;
    const a = { id: t.id, seq: seq, datum: t.start, van: van, tot: tot, adres: t.afspraak_adres || "", titel: "BROS: " + onderwerp,
      omschrijving: (en ? "Appointment with " : "Afspraak met ") + (prof ? prof.name + " (BROS)" : "BROS") + "\n" + (en ? "Questions? info@bros.be" : "Vragen? info@bros.be") };
    const ics = Utilities.newBlob(afsIcs(a, weg, PORTAAL.VAN, weg ? { naam: naam, email: String(c.email).trim() } : null), "text/calendar; charset=utf-8; method=" + (weg ? "CANCEL" : "PUBLISH"), weg ? "annulering-bros.ics" : "afspraak-bros.ics");
    const kop = weg ? (en ? "Cancelled: appointment with BROS" : "Geannuleerd: afspraak met BROS") : nieuwsoort === "gewijzigd" ? (en ? "Changed appointment with BROS" : "Gewijzigde afspraak met BROS") : (en ? "Appointment with BROS" : "Afspraak met BROS");
    const onderwerpMail = kop + ": " + onderwerp + " — " + datumTxt(en);
    const tekst = (en ? "Dear " : "Beste ") + naam + ",\n\n" + (weg ? (en ? "The following appointment has been cancelled:" : "Deze afspraak gaat niet door:") : (en ? "Here are the details of your appointment with BROS:" : "Hierbij de gegevens van je afspraak met BROS:"))
      + "\n\n" + onderwerp + "\n" + datumTxt(en) + "\n" + (t.afspraak_adres || "") + "\n\n" + (weg ? (en ? "If it is in your calendar, you can remove it.\n\n" : "Staat ze in je agenda, dan kan je ze verwijderen.\n\n") : (en ? "The attachment adds it to your calendar. You can also find it in your BROS portal." : "Met de bijlage zet je ze in je agenda. Je vindt ze ook in je BROS-portaal.") + "\n\n") + (prof ? prof.name + " — " : "") + "BROS";
    const html = wrap("<p>" + (en ? "Dear " : "Beste ") + H(naam) + ",</p><p>" + (weg ? (en ? "The following appointment has been <b>cancelled</b>:" : "Deze afspraak gaat <b>niet door</b>:") : nieuwsoort === "gewijzigd" ? (en ? "Your appointment with BROS has <b>changed</b>:" : "Je afspraak met BROS is <b>gewijzigd</b>:") : (en ? "Here are the details of your appointment with BROS:" : "Hierbij de gegevens van je afspraak met BROS:")) + "</p>"
      + "<table style=\"border-collapse:collapse;margin:12px 0\"><tr><td style=\"padding:4px 14px 4px 0;color:#767D78\">" + (en ? "What" : "Wat") + "</td><td style=\"padding:4px 0\"><b>" + H(onderwerp) + "</b></td></tr><tr><td style=\"padding:4px 14px 4px 0;color:#767D78\">" + (en ? "When" : "Wanneer") + "</td><td style=\"padding:4px 0\">" + H(datumTxt(en)) + "</td></tr><tr><td style=\"padding:4px 14px 4px 0;color:#767D78\">" + (en ? "Where" : "Waar") + "</td><td style=\"padding:4px 0\">" + H(t.afspraak_adres || "") + "</td></tr>" + (prof ? "<tr><td style=\"padding:4px 14px 4px 0;color:#767D78\">" + (en ? "With" : "Met") + "</td><td style=\"padding:4px 0\">" + H(prof.name) + "</td></tr>" : "") + "</table>"
      + (weg ? "<p>" + (en ? "If it is in your calendar, you can remove it." : "Staat ze in je agenda, dan kan je ze verwijderen.") + "</p>" : "<p>" + (en ? "Open the attachment to add it to your calendar. You can also find it in your BROS portal." : "Open de bijlage om de afspraak in je agenda te zetten. Je vindt ze ook in je BROS-portaal.") + "</p>") + "<p>" + (prof ? H(prof.name) + " — " : "") + "BROS</p>");
    const opt = { htmlBody: html, name: PORTAAL.AFZENDER, attachments: [ics] };
    if (PORTAAL.VAN) { const al = GmailApp.getAliases(); if (al.indexOf(PORTAAL.VAN) >= 0) opt.from = PORTAAL.VAN; else opt.replyTo = PORTAAL.VAN; }
    GmailApp.sendEmail(String(c.email).trim(), onderwerpMail.replace(/[\r\n]+/g, " ").slice(0, 240), tekst, opt);
  };
  if (mailen) try {
    const weg = vorigAan.filter(m => aan.indexOf(m) < 0);
    if (weg.length && vorig.hash) {
      const wie = vorig.wie || {}; seq += 1;
      weg.forEach(m => { const w = wie[m] || {}; try { stuur({ naam: w.naam || "", taal: w.taal || "", email: m }, true); res.geannuleerd.push(m); } catch (e) { console.error("annulering " + m + ": " + e); } });
    }
    const naar = ontvangers.filter(c => gewijzigd || vorigAan.indexOf(String(c.email).trim().toLowerCase()) < 0 || !vorig.hash);
    if (naar.length) {
      if (gewijzigd && !weg.length) seq += 1;
      naar.forEach(c => { const m = String(c.email).trim().toLowerCase(); try { stuur(c, false, gewijzigd && vorigAan.indexOf(m) >= 0 ? "gewijzigd" : "nieuw"); res.gemaild.push(m); } catch (e) { console.error("afspraakmail " + m + ": " + e); } });
    }
    const blijft = aan.filter(m => res.gemaild.indexOf(m) >= 0 || vorigAan.indexOf(m) >= 0); const wie = {};
    blijft.forEach(m => { const c = ontvangers.find(x => String(x.email).trim().toLowerCase() === m); if (c) wie[m] = { naam: c.contactpersoon || c.naam, taal: c.taal || "" }; });
    patch.afspraak_mail = actief ? { hash: hash, aan: blijft, seq: seq, wie: wie } : (res.geannuleerd.length || !vorigAan.length ? {} : vorig);
  } finally {
    if (!patch.afspraak_mail && (res.gemaild.length || res.geannuleerd.length)) {   // fout halverwege: bewaren wie al gemaild werd (anders mailt de volgende keer opnieuw)
      const aanNu = vorigAan.filter(m => res.geannuleerd.indexOf(m) < 0).concat(res.gemaild.filter(m => vorigAan.indexOf(m) < 0));
      patch.afspraak_mail = { hash: hash, aan: aanNu, seq: seq, wie: vorig.wie || {} };
    }
  }
  if (Object.keys(patch).length) pbAdmin("/rest/v1/taken?id=eq." + t.id, "patch", patch);
  return res;
}
/* =====================================================================
   Vragen beantwoorden (script 042): BROS antwoordt in het Planbord (voorstel_beantwoord); dit mailt het antwoord
   naar de aannemer (contact van de vraag) of de klant (login van het gesprek met de assistent).
   ===================================================================== */
function antwoordMail(body) {
  const wie = caller(body.token, false);
  const v = (pbAdmin("/rest/v1/taak_voorstellen?id=eq." + uuid(body.id) + "&select=*", "get") || [])[0];
  if (!v || !String(v.bros_antwoord || "").trim()) return { ok: false, error: "Geen antwoord gevonden bij deze vraag." };
  if (!eenmalig("antw:" + v.id + ":" + v.beantwoord_op, 21600)) return { ok: true, naar: "" };   // dit antwoord werd al gemaild
  const p = (pbAdmin("/rest/v1/projecten?id=eq." + v.project_id + "&select=nummer,klant,naam", "get") || [])[0] || {};
  let c = null, url = PORTAAL.URL;
  if (v.bron === "aannemer") {
    if (v.contact_id) c = (pbAdmin("/rest/v1/contacten?id=eq." + v.contact_id + "&select=naam,contactpersoon,email,taal", "get") || [])[0] || null;
    url = PORTAAL.URL_AANNEMER;
  } else if (v.bericht_id) {
    const b = (pbAdmin("/rest/v1/assistent_berichten?id=eq." + v.bericht_id + "&select=gesprek_id", "get") || [])[0];
    const g = b ? (pbAdmin("/rest/v1/assistent_gesprekken?id=eq." + b.gesprek_id + "&select=user_id,contact_id", "get") || [])[0] : null;
    if (g) {
      c = (pbAdmin("/rest/v1/contacten?" + (g.contact_id ? "id=eq." + g.contact_id : "user_id=eq." + g.user_id) + "&select=naam,contactpersoon,email,taal&limit=1", "get") || [])[0] || null;
      if (!c || !c.email) { const pr = (pbAdmin("/rest/v1/profiles?id=eq." + g.user_id + "&select=name,email", "get") || [])[0]; if (pr && pr.email) c = { naam: (c && c.naam) || pr.name || "", email: pr.email, taal: c && c.taal }; }
    }
  }
  const email = c && String(c.email || "").trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: true, naar: "", waarschuwing: "geen e-mailadres gekend — enkel in het portaal" };
  const en = String(c.taal || "") === "en"; const naam = c.contactpersoon || c.naam || "";
  const proj = (p.nummer ? p.nummer + " · " : "") + (p.klant || "") + (p.naam && p.naam !== p.klant ? " · " + p.naam : "");
  const vraag = String(v.vraag || v.titel || "").trim();
  const html = "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1B1E1C;max-width:640px\"><p>" + (en ? "Dear " : "Beste ") + H(naam) + ",</p>"
    + "<p>" + (en ? "Here is our answer to your question" : "Hierbij ons antwoord op je vraag") + (v.bron === "aannemer" && proj ? " (" + H(proj) + ")" : "") + ":</p>"
    + (vraag ? "<p style=\"padding:8px 12px;border-left:3px solid #DAD8D0;color:#767D78;white-space:pre-line\">" + H(vraag.slice(0, 1500)) + "</p>" : "")
    + "<p style=\"white-space:pre-line\">" + H(v.bros_antwoord) + "</p>"
    + "<p style=\"margin:24px 0\"><a href=\"" + url + "\" style=\"background:#1B1E1C;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block\">" + (en ? "Open your portal" : "Naar je portaal") + "</a></p>"
    + "<p>" + H(wie.name) + " — BROS</p></div>";
  const tekst = (en ? "Dear " : "Beste ") + naam + ",\n\n" + (en ? "Here is our answer to your question:" : "Hierbij ons antwoord op je vraag:") + "\n\n" + (vraag ? "> " + vraag.slice(0, 1500).replace(/\n/g, "\n> ") + "\n\n" : "") + v.bros_antwoord + "\n\n" + url + "\n\n" + wie.name + " — BROS";
  try { portaalMail(email, (en ? "Reply from BROS: " : "Antwoord van BROS: ") + (v.titel || ""), tekst, html); }
  catch (e) { CacheService.getScriptCache().remove("q:1:antw:" + v.id + ":" + v.beantwoord_op); throw e; }   // mislukt: later opnieuw kunnen proberen
  return { ok: true, naar: email };
}
/* =====================================================================
   Werfpunten gemeld door een aannemer (script 043)
   - werfpuntMelding: de aannemer (eigen token) meldt een nieuw punt → mail aan de projectverantwoordelijke (één keer per punt)
   - werfpuntAntwoord: BROS antwoordt (Planbord) → mail aan wie het punt meldde (aannemer of klant)
   ===================================================================== */
function werfpuntMelding(body) {
  const wie = callerAny(body.token);
  if (wie.role !== "aannemer") return { ok: false, error: "Geen toegang." };
  if (!quotum("werfpuntmelding:" + wie.id, 40, 3600)) return { ok: false, error: "Te veel meldingen in korte tijd." };
  const id = uuid(body.id);
  const rij = (pbReq("/rest/v1/aan_vaststellingen?id=eq." + id + "&select=*", "get", null, body.token) || [])[0];
  if (!rij || !rij.door_mij || !rij.te_beoordelen) return { ok: true, overgeslagen: true };
  if (!eenmalig("werfpuntmelding:" + id, 86400)) return { ok: true, al: true };
  const v = (pbAdmin("/rest/v1/vaststellingen?id=eq." + id + "&select=gemeld_door_aannemer", "get") || [])[0] || {};
  const c = v.gemeld_door_aannemer ? (pbAdmin("/rest/v1/contacten?id=eq." + v.gemeld_door_aannemer + "&select=naam,contactpersoon", "get") || [])[0] : null;
  const p = (pbAdmin("/rest/v1/projecten?id=eq." + rij.project_id + "&select=nummer,klant,naam,lead", "get") || [])[0] || {};
  const lead = p.lead ? (pbAdmin("/rest/v1/profiles?id=eq." + p.lead + "&select=name,email", "get") || [])[0] : null;
  const naar = (lead && lead.email) || YUKI.REPORT_TO; const proj = (p.klant || "") + (p.naam && p.naam !== p.klant ? " · " + p.naam : "");
  const van = (c && (c.naam + (c.contactpersoon ? " (" + c.contactpersoon + ")" : ""))) || wie.name || "Een aannemer";
  const lijnen = ["V-" + ("00" + (rij.nr || 0)).slice(-3) + " · " + rij.titel + (rij.ruimte ? " (" + rij.ruimte + ")" : ""), rij.omschrijving || "", "Te beoordelen in het Planbord › project › Werf: goedkeuren (en een verantwoordelijke kiezen), antwoorden of niet weerhouden."].filter(Boolean);
  const fotos = (rij.fotos || []).slice(0, 6).filter(f => String(f.url || "").indexOf(YUKI.PLANBORD_URL + "/storage/v1/object/public/werf/") === 0);
  const html = "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1B1E1C;max-width:640px\"><p><b>" + H(van) + "</b> meldde een werfpunt in de werfmodus (" + H(proj) + "):</p><ul>" + lijnen.map(l => "<li style=\"white-space:pre-line\">" + H(l) + "</li>").join("") + "</ul>"
    + fotos.map(f => "<a href=\"" + H(f.url) + "\"><img src=\"" + H(f.url) + "\" width=\"120\" style=\"border-radius:6px;margin:2px\"></a>").join("") + "</div>";
  try { GmailApp.sendEmail(naar, "Werf · " + proj + " · punt gemeld door " + van + ": " + rij.titel, van + " meldde een werfpunt (" + proj + "):\n\n- " + lijnen.join("\n- "), { htmlBody: html, name: "BROS Planbord" }); }
  catch (e) { CacheService.getScriptCache().remove("q:1:werfpuntmelding:" + id); throw e; }
  return { ok: true };
}
function werfpuntAntwoord(body) {
  const wie = caller(body.token, false);
  const v = (pbAdmin("/rest/v1/vaststellingen?id=eq." + uuid(body.id) + "&select=id,nr,titel,omschrijving,status,te_beoordelen,project_id,gemeld_door_aannemer,gemeld_door_klant,bros_antwoord,beantwoord_op", "get") || [])[0];
  if (!v || !String(v.bros_antwoord || "").trim()) return { ok: false, error: "Geen antwoord bij dit punt." };
  const cid = v.gemeld_door_aannemer || v.gemeld_door_klant; if (!cid) return { ok: true, naar: "", waarschuwing: "niemand te mailen (punt van BROS)" };
  const key = "werfpuntantwoord:" + v.id + ":" + v.beantwoord_op;
  if (!eenmalig(key, 21600)) return { ok: true, naar: "" };
  const c = (pbAdmin("/rest/v1/contacten?id=eq." + cid + "&select=naam,contactpersoon,email,taal", "get") || [])[0] || {};
  const email = String(c.email || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: true, naar: "", waarschuwing: "geen e-mailadres gekend — enkel in het portaal" };
  const p = (pbAdmin("/rest/v1/projecten?id=eq." + v.project_id + "&select=nummer,klant,naam", "get") || [])[0] || {};
  const aannemer = !!v.gemeld_door_aannemer; const en = String(c.taal || "") === "en"; const naam = c.contactpersoon || c.naam || "";
  const nr = "V-" + ("00" + (v.nr || 0)).slice(-3); const url = aannemer ? PORTAAL.URL_AANNEMER : PORTAAL.URL;
  const stand = v.status === "vervallen" ? (en ? "not retained" : "niet weerhouden") : v.te_beoordelen ? (en ? "still being reviewed" : "nog in beoordeling") : (en ? "accepted" : "opgenomen in de werfopvolging");
  const html = "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1B1E1C;max-width:640px\"><p>" + (en ? "Dear " : "Beste ") + H(naam) + ",</p>"
    + "<p>" + (en ? "About the site issue you reported" : "Over het werfpunt dat je meldde") + " — <b>" + H(nr + " " + (v.titel || "")) + "</b>" + (aannemer && (p.nummer || p.klant) ? " (" + H((p.nummer ? p.nummer + " · " : "") + (p.klant || "")) + ")" : "") + ", " + stand + ":</p>"
    + "<p style=\"white-space:pre-line\">" + H(v.bros_antwoord) + "</p>"
    + "<p style=\"margin:24px 0\"><a href=\"" + url + "\" style=\"background:#1B1E1C;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block\">" + (en ? "Open your portal" : "Naar je portaal") + "</a></p><p>" + H(wie.name) + " — BROS</p></div>";
  const tekst = (en ? "Dear " : "Beste ") + naam + ",\n\n" + (en ? "About the site issue you reported" : "Over het werfpunt dat je meldde") + " — " + nr + " " + (v.titel || "") + ", " + stand + ":\n\n" + v.bros_antwoord + "\n\n" + url + "\n\n" + wie.name + " — BROS";
  try { portaalMail(email, (en ? "Reply from BROS: " : "Antwoord van BROS: ") + nr + " " + (v.titel || ""), tekst, html); }
  catch (e) { CacheService.getScriptCache().remove("q:1:" + key); throw e; }
  return { ok: true, naar: email };
}
/* ---- reacties op werfpunten (script 044): aannemer ⇄ BROS in vaststellingen.opmerking ---- */
const laatsteRegels = (t, n) => String(t || "").split("\n").filter(Boolean).slice(-n);
function werfpuntFeedback(body) {
  const wie = callerAny(body.token);
  if (wie.role !== "aannemer") return { ok: false, error: "Geen toegang." };
  const id = uuid(body.id);
  const rij = (pbReq("/rest/v1/aan_vaststellingen?id=eq." + id + "&select=*", "get", null, body.token) || [])[0];
  if (!rij || rij.aan_mij === false) return { ok: true, overgeslagen: true };
  const laatste = laatsteRegels(rij.opmerking, 1)[0] || "";
  if (!laatste || / · BROS \(/.test(laatste)) return { ok: true, overgeslagen: true };   // enkel als het laatste bericht van de aannemer komt
  if (!quotum("werfpuntfeedback-user:" + wie.id, 20, 3600) || !eenmalig("werfpuntfeedback:" + id + ":" + laatste.slice(0, 120), 86400)) return { ok: true, overgeslagen: true };   // geen herhaalde mails
  const v = (pbAdmin("/rest/v1/vaststellingen?id=eq." + id + "&select=contact_id", "get") || [])[0] || {};
  const c = v.contact_id ? (pbAdmin("/rest/v1/contacten?id=eq." + v.contact_id + "&select=naam,contactpersoon", "get") || [])[0] : null;
  const p = (pbAdmin("/rest/v1/projecten?id=eq." + rij.project_id + "&select=nummer,klant,naam,lead", "get") || [])[0] || {};
  const lead = p.lead ? (pbAdmin("/rest/v1/profiles?id=eq." + p.lead + "&select=name,email", "get") || [])[0] : null;
  const naar = (lead && lead.email) || YUKI.REPORT_TO; const proj = (p.klant || "") + (p.naam && p.naam !== p.klant ? " · " + p.naam : "");
  const van = (c && (c.naam + (c.contactpersoon ? " (" + c.contactpersoon + ")" : ""))) || wie.name || "De aannemer";
  const nr = "V-" + ("00" + (rij.nr || 0)).slice(-3);
  const regels = laatsteRegels(rij.opmerking, 4);
  const html = "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1B1E1C;max-width:640px\"><p><b>" + H(van) + "</b> reageerde op werfpunt <b>" + H(nr + " " + (rij.titel || "")) + "</b> (" + H(proj) + ")" + (rij.status === "opgelost" ? " en meldde het als opgelost" : " — het punt is nog niet opgelost") + ":</p>"
    + "<div style=\"padding:10px 14px;border-left:3px solid #DAD8D0;white-space:pre-line\">" + H(regels.join("\n")) + "</div>"
    + "<p style=\"color:#767D78\">Antwoorden: Planbord › project › Werf › " + H(nr) + " › Reactie aan de aannemer.</p></div>";
  GmailApp.sendEmail(naar, "Werf · " + proj + " · reactie van " + van + " op " + nr + " " + (rij.titel || ""), van + " reageerde op " + nr + " (" + proj + "):\n\n" + regels.join("\n"), { htmlBody: html, name: "BROS Planbord" });
  return { ok: true };
}
function werfpuntReactie(body) {
  const wie = caller(body.token, false);
  const v = (pbAdmin("/rest/v1/vaststellingen?id=eq." + uuid(body.id) + "&select=id,nr,titel,status,project_id,contact_id,opmerking", "get") || [])[0];
  if (!v) return { ok: false, error: "Werfpunt niet gevonden." };
  if (!v.contact_id) return { ok: true, naar: "", waarschuwing: "niet toegewezen aan een aannemer — niet gemaild" };
  const c = (pbAdmin("/rest/v1/contacten?id=eq." + v.contact_id + "&select=naam,contactpersoon,email,soort", "get") || [])[0] || {};
  const email = String(c.email || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: true, naar: "", waarschuwing: "geen e-mailadres gekend — enkel in het portaal" };
  if (!quotum("werfpuntreactie:" + v.id, 10, 3600)) return { ok: true, naar: "" };
  const p = (pbAdmin("/rest/v1/projecten?id=eq." + v.project_id + "&select=nummer,klant,naam", "get") || [])[0] || {};
  const nr = "V-" + ("00" + (v.nr || 0)).slice(-3); const laatste = laatsteRegels(v.opmerking, 1)[0] || "";
  const tekst = laatste.replace(/^\d\d\/\d\d \d\d:\d\d · [^:]*: /, "");
  const url = c.soort === "klant" ? PORTAAL.URL : PORTAAL.URL_AANNEMER;
  const html = "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1B1E1C;max-width:640px\"><p>Beste " + H(c.contactpersoon || c.naam || "") + ",</p>"
    + "<p>BROS reageerde op werfpunt <b>" + H(nr + " " + (v.titel || "")) + "</b>" + (p.nummer || p.klant ? " (" + H((p.nummer ? p.nummer + " · " : "") + (p.klant || "")) + ")" : "") + ":</p>"
    + "<p style=\"white-space:pre-line\">" + H(tekst) + "</p>"
    + "<p style=\"margin:24px 0\"><a href=\"" + url + "\" style=\"background:#1B1E1C;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block\">Naar je portaal</a></p><p>" + H(wie.name) + " — BROS</p></div>";
  portaalMail(email, "Reactie van BROS: " + nr + " " + (v.titel || ""), "Beste " + (c.contactpersoon || c.naam || "") + ",\n\nBROS reageerde op werfpunt " + nr + " " + (v.titel || "") + ":\n\n" + tekst + "\n\n" + url + "\n\n" + wie.name + " — BROS", html);
  return { ok: true, naar: email };
}
/** Verslag gedeeld met de klant: mail met het verslag en de actiepunten naar de klanten met portaal-toegang. */
function notitieMail(body) {
  const wie = caller(body.token, false);
  const n = (pbAdmin("/rest/v1/notities?id=eq." + encodeURIComponent(String(body.id || "")) + "&select=*", "get") || [])[0];
  if (!n || !n.klant_zichtbaar) return { ok: false, error: "Notitie niet gevonden of niet gedeeld." };
  const p = (pbAdmin("/rest/v1/projecten?id=eq." + n.project_id + "&select=nummer,klant,naam", "get") || [])[0] || {};
  const pcs = pbAdmin("/rest/v1/project_contacten?project_id=eq." + n.project_id + "&rol=in.(bouwheer,contactpersoon)&select=contact_id", "get") || [];
  const klanten = pcs.length ? (pbAdmin("/rest/v1/contacten?id=in.(" + pcs.map(x => x.contact_id).join(",") + ")&user_id=not.is.null&select=naam,email", "get") || []).filter(c => c.email) : [];
  const taken = pbAdmin("/rest/v1/taken?notitie_id=eq." + n.id + "&select=titel,eind,status,assignee", "get") || [];
  const namen = {}; (pbAdmin("/rest/v1/profiles?select=id,name", "get") || []).forEach(u => namen[u.id] = u.name);
  const SOORT = { vergadering: "Vergadering", werfverslag: "Werfverslag", bespreking: "Bespreking", feedback: "Feedback", notitie: "Notitie" };
  const datum = String(n.datum || "").split("-").reverse().join("/");
  const punten = taken.length ? "<h3 style=\"font-size:15px;margin:18px 0 6px\">Actiepunten</h3><ul style=\"padding-left:18px;margin:0\">" + taken.map(t => "<li>" + (t.status === "done" ? "✅ " : "") + String(t.titel).replace(/</g, "&lt;") + (t.assignee && namen[t.assignee] ? " <span style=\"color:#767D78\">· " + H(namen[t.assignee]) + "</span>" : "") + (t.eind ? " <span style=\"color:#767D78\">· " + String(t.eind).split("-").reverse().join("/") + "</span>" : "") + "</li>").join("") + "</ul>" : "";
  const html = "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1B1E1C;max-width:720px\"><p>Beste,</p><p>Hierbij het verslag <b>" + String(n.titel || SOORT[n.soort]).replace(/</g, "&lt;") + "</b> (" + (SOORT[n.soort] || n.soort) + " van " + datum + ") voor " + H(p.klant || "") + (p.naam && p.naam !== p.klant ? " · " + H(p.naam) : "") + "." + (n.deelnemers ? "<br><span style=\"color:#767D78\">Aanwezig: " + String(n.deelnemers).replace(/</g, "&lt;") + "</span>" : "") + "</p>"
    + "<div style=\"white-space:pre-line;padding:14px 16px;border:1px solid #DAD8D0;border-radius:10px;background:#F5F4F0\">" + String(n.inhoud || "").replace(/</g, "&lt;") + "</div>" + punten
    + "<p style=\"margin-top:20px\">Je vindt dit verslag ook terug in je klantenportaal: <a href=\"" + PORTAAL.URL + "\">" + PORTAAL.URL + "</a></p><p>" + H(wie.name) + " — BROS</p></div>";
  const tekst = "Beste,\n\nHierbij het verslag " + (n.titel || "") + " (" + datum + ").\n\n" + (n.inhoud || "") + (taken.length ? "\n\nActiepunten:\n" + taken.map(t => "- " + t.titel + (t.assignee && namen[t.assignee] ? " (" + namen[t.assignee] + ")" : "")).join("\n") : "") + "\n\nOok in je portaal: " + PORTAAL.URL + "\n\n" + wie.name + " — BROS";
  const naar = []; klanten.forEach(c => { portaalMail(c.email, "Verslag: " + (n.titel || SOORT[n.soort]) + " · " + datum, tekst.replace("Beste,", "Beste " + c.naam + ","), html.replace("Beste,", "Beste " + String(c.naam).replace(/</g, "&lt;") + ",")); naar.push(c.email); });
  return { ok: true, naar: naar };
}
/** Werfverslag (pdf gemaakt in het Planbord, in de Supabase-bucket 'werf'): mailen naar aannemers/klant als bijlage, optioneel kopie in de Drive-map Werfcontrole. */
function werfverslagMail(body) {
  const wie = caller(body.token, false);
  const w = (pbAdmin("/rest/v1/werfverslagen?id=eq." + encodeURIComponent(String(body.id || "")) + "&select=*", "get") || [])[0];
  if (!w) return { ok: false, error: "Werfverslag niet gevonden." };
  const p = (pbAdmin("/rest/v1/projecten?id=eq." + w.project_id + "&select=nummer,klant,naam,adres,gemeente", "get") || [])[0] || {};
  if (String(w.pdf_url || "").indexOf(YUKI.PLANBORD_URL + "/storage/v1/object/public/werf/") !== 0) return { ok: false, error: "Pdf staat niet in de werf-opslag." };
  const r = UrlFetchApp.fetch(w.pdf_url, { muteHttpExceptions: true }); if (r.getResponseCode() >= 300) throw new Error("Pdf niet gevonden (" + r.getResponseCode() + ").");
  const naam = "Werfverslag " + w.nr + " - " + (p.klant || "") + " - " + String(w.datum || "").split("-").reverse().join("-") + ".pdf";
  const pdf = r.getBlob().setName(naam).setContentType("application/pdf");
  const datum = String(w.datum || "").split("-").reverse().join("/"); const proj = (p.klant || "") + (p.naam && p.naam !== p.klant ? " · " + p.naam : "");
  const aan = (body.aan || []).map(e => String(e).trim()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  const bericht = String(w.bericht || "").trim();
  const html = "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1B1E1C;max-width:720px\"><p>Beste,</p>"
    + (bericht ? "<p style=\"white-space:pre-line\">" + bericht.replace(/</g, "&lt;") + "</p>" : "<p>In bijlage het werfverslag " + w.nr + " van " + datum + " voor <b>" + proj.replace(/</g, "&lt;") + "</b>" + (p.adres ? " (" + H(p.adres) + (p.gemeente ? ", " + H(p.gemeente) : "") + ")" : "") + ".</p>")
    + "<p>Het verslag bevat " + w.punten + " vaststelling" + (w.punten === 1 ? "" : "en") + " met foto's, verantwoordelijke en uiterste datum, en de plannen met de locatie van elk punt. Gelieve de open punten die aan jou toegewezen zijn tegen de vermelde datum in orde te brengen en ons te verwittigen zodra dat gebeurd is.</p>"
    + (w.klant_zichtbaar ? "<p>Als klant vind je dit verslag ook terug in je portaal: <a href=\"" + PORTAAL.URL + "\">" + PORTAAL.URL + "</a></p>" : "")
    + "<p>" + H(wie.name) + " — BROS</p></div>";
  const tekst = "Beste,\n\n" + (bericht || "In bijlage het werfverslag " + w.nr + " van " + datum + " voor " + proj + ".") + "\n\nHet verslag bevat " + w.punten + " vaststellingen met foto's, verantwoordelijke en uiterste datum, en de plannen met de locatie van elk punt.\n\n" + wie.name + " — BROS";
  const naar = [];
  aan.forEach(e => { const opt = { htmlBody: html, name: PORTAAL.AFZENDER, attachments: [pdf] }; if (PORTAAL.VAN) { const al = GmailApp.getAliases(); if (al.indexOf(PORTAAL.VAN) >= 0) opt.from = PORTAAL.VAN; else opt.replyTo = PORTAAL.VAN; } GmailApp.sendEmail(e, "Werfverslag " + w.nr + " · " + proj + " · " + datum, tekst, opt); naar.push(e); });
  let driveUrl = "";
  if (body.drive && body.folderId) { try { onderProjecten(String(body.folderId)); const folder = subfolder(DriveApp.getFolderById(String(body.folderId)), "Werfcontrole"); let n = naam, k = 2; while (folder.getFilesByName(n).hasNext()) n = naam.replace(/\.pdf$/, " (" + (k++) + ").pdf"); const f = folder.createFile(pdf.copyBlob().setName(n)); driveUrl = f.getUrl(); } catch (e) { Logger.log("Drive-kopie mislukt: " + e); } }
  const patch = { aan: naar }; if (naar.length) patch.verzonden_op = new Date().toISOString(); if (driveUrl) patch.drive_url = driveUrl;
  pbAdmin("/rest/v1/werfverslagen?id=eq." + w.id, "patch", patch);
  return { ok: true, naar: naar, drive_url: driveUrl };
}
/** Taakvoorstel van de AI-assistent: mail naar de voorgestelde verantwoordelijke, beheer in kopie. */
function assistentMail(body) {
  const v = (pbAdmin("/rest/v1/taak_voorstellen?id=eq." + encodeURIComponent(String(body.id || "")) + "&select=*", "get") || [])[0];
  if (!v) return { ok: false, error: "Voorstel niet gevonden." };
  if (!quotum("am:" + v.project_id, 8, 86400)) return { ok: true, info: "Al veel meldingen vandaag voor dit project — de vraag staat wel bij Voorstellen." };   // 1.48: mailquotum beschermen
  return voorstelMail(v, null);
}
/** Vraag of melding van een aannemer uit zijn portaal (script 025): de aannemer stuurt zijn token mee; het voorstel moet van hem zijn. */
function voorstelMailAannemer(body) {
  const wie = callerAny(body.token); if (wie.role !== "aannemer") return { ok: false, error: "Geen toegang." };
  if (!quotum("vm-user:" + wie.id, 10, 3600)) return { ok: true };
  const v = (pbAdmin("/rest/v1/taak_voorstellen?id=eq." + uuid(body.id) + "&bron=eq.aannemer&select=*", "get") || [])[0];
  if (!v) return { ok: false, error: "Voorstel niet gevonden." };
  const c = (pbAdmin("/rest/v1/contacten?id=eq." + v.contact_id + "&select=id,naam,bedrijf,email,user_id", "get") || [])[0];
  if (!c || c.user_id !== wie.id) return { ok: false, error: "Geen toegang." };
  if (!eenmalig("vm:" + v.id, 3600)) return { ok: true };
  const r = voorstelMail(v, c); return { ok: !!(r && r.ok) };
}
function voorstelMail(v, aannemer) {
  const p = (pbAdmin("/rest/v1/projecten?id=eq." + v.project_id + "&select=nummer,klant,naam", "get") || [])[0] || {};
  const profs = pbAdmin("/rest/v1/profiles?select=id,name,email,role,active&active=eq.true", "get") || [];
  const naar = profs.find(x => x.id === v.voorgestelde_user); const beheer = profs.filter(x => x.role === "beheer" && x.email);
  const to = naar && naar.email ? naar.email : (beheer[0] ? beheer[0].email : "");
  if (!to) return { ok: false, error: "Geen e-mailadres voor de verantwoordelijke." };
  const cc = beheer.map(x => x.email).filter(e => e && e !== to).join(",");
  const proj = (p.klant || "") + (p.naam && p.naam !== p.klant ? " · " + p.naam : "");
  const link = PORTAAL.URL.replace(/klant\/?$/, "") + "#voorstellen";
  const esc = H;
  const wieTxt = aannemer ? "De aannemer <b>" + esc(aannemer.naam) + "</b>" + (aannemer.bedrijf && aannemer.bedrijf !== aannemer.naam ? " (" + esc(aannemer.bedrijf) + ")" : "") + " stelt via het aannemersportaal een vraag of melding" : "De assistent in het klantenportaal stelt een taak voor";
  const html = "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1B1E1C;max-width:720px\"><p>Dag " + esc(naar ? naar.name : "team") + ",</p>"
    + "<p>" + wieTxt + " bij <b>" + esc(proj) + "</b>" + (v.urgentie === "hoog" ? " <span style=\"color:#B93A34;font-weight:700\">(hoge urgentie)</span>" : "") + ":</p>"
    + "<div style=\"padding:12px 16px;border:1px solid #DAD8D0;border-radius:10px;background:#F5F4F0\"><b>" + esc(v.titel) + "</b><br><span style=\"color:#767D78\">" + esc(v.onderwerp) + (v.eind ? " · tegen " + String(v.eind).split("-").reverse().join("/") : "") + "</span>" + (v.omschrijving && !aannemer ? "<p style=\"margin:8px 0 0\">" + esc(v.omschrijving) + "</p>" : "") + "</div>"
    + (aannemer ? "<p style=\"margin-top:14px;white-space:pre-line\">" + esc(v.vraag) + "</p>" + (aannemer.email ? "<p style=\"color:#767D78;font-size:13px\">Rechtstreeks antwoorden kan op " + esc(aannemer.email) + "; het antwoord dat je in het Planbord bij 'weigeren' invult, leest hij in zijn portaal.</p>" : "")
        : "<p style=\"margin-top:14px\"><b>Vraag van de klant:</b><br>" + esc(v.vraag) + "</p><p><b>Antwoord van de assistent:</b><br>" + esc(v.antwoord) + "</p>")
    + "<p><a href=\"" + link + "\" style=\"display:inline-block;padding:10px 16px;background:#1D1D1F;color:#fff;border-radius:8px;text-decoration:none\">Voorstel bekijken in het Planbord</a></p><p style=\"color:#767D78;font-size:13px\">Bevestig, pas aan of weiger het voorstel in het Planbord; pas dan wordt het een taak.</p></div>";
  const tekst = (aannemer ? "Aannemer " + aannemer.naam + " stelt een vraag bij " : "De assistent stelt een taak voor bij ") + proj + ": " + v.titel + "\n\n" + v.vraag + (aannemer ? "" : "\nAntwoord: " + v.antwoord) + "\n\nBekijken: " + link;
  const opt = { htmlBody: html, name: PORTAAL.AFZENDER }; if (cc) opt.cc = cc; if (aannemer && aannemer.email) opt.replyTo = aannemer.email;
  if (PORTAAL.VAN && !(aannemer && aannemer.email)) { const al = GmailApp.getAliases(); if (al.indexOf(PORTAAL.VAN) >= 0) opt.from = PORTAAL.VAN; else opt.replyTo = PORTAAL.VAN; }
  else if (PORTAAL.VAN) { const al = GmailApp.getAliases(); if (al.indexOf(PORTAAL.VAN) >= 0) opt.from = PORTAAL.VAN; }
  GmailApp.sendEmail(to, (v.urgentie === "hoog" ? "[Dringend] " : "") + (aannemer ? "Vraag van aannemer · " : "Taakvoorstel · ") + proj + " · " + v.titel, tekst, opt);
  return { ok: true, naar: [to].concat(cc ? cc.split(",") : []) };
}
/** Prijsaanvragen (script 025): 'nieuw'/'herinnering' (team → aannemer, met uitnodiging als hij nog geen login heeft), 'ingediend' (aannemer → BROS), 'gekozen' (team → aannemer). */
function prijsaanvraagMail(body) {
  const soort = String(body.soort || "nieuw");
  if (["nieuw", "herinnering", "gekozen", "ingediend", "niet_weerhouden"].indexOf(soort) < 0) return { ok: false, error: "Onbekende soort." };
  // eerst wie er belt (vóór we iets opzoeken): aannemer voor 'ingediend', anders een teamlid (of de automatische herinnering)
  const beller = soort === "ingediend" ? callerAny(body.token) : null;
  if (beller && beller.role !== "aannemer") return { ok: false, error: "Geen toegang." };
  const team = soort !== "ingediend" ? (AUTO_WIE || caller(body.token, false)) : null;
  const a = (pbAdmin("/rest/v1/prijsaanvragen?id=eq." + uuid(body.id) + "&select=*", "get") || [])[0];
  if (!a) return { ok: false, error: "Prijsaanvraag niet gevonden." };
  const c = (pbAdmin("/rest/v1/contacten?id=eq." + a.contact_id + "&select=id,naam,bedrijf,contactpersoon,email,user_id", "get") || [])[0];
  if (!c) return { ok: false, error: "Contact niet gevonden." };
  const p = (pbAdmin("/rest/v1/projecten?id=eq." + a.project_id + "&select=nummer,klant,naam,adres,gemeente,lead", "get") || [])[0] || {};
  // script 037: een kandidaat (niet aan het project gekoppeld) krijgt geen klantnaam, enkel projectnummer en gemeente
  const gekoppeld = soort === "ingediend" || (pbAdmin("/rest/v1/project_contacten?project_id=eq." + a.project_id + "&contact_id=eq." + a.contact_id + "&select=id", "get") || []).length > 0;
  const proj = gekoppeld ? (p.klant || "") + (p.naam && p.naam !== p.klant ? " · " + p.naam : "") : "project " + (p.nummer || "") + (p.gemeente ? " in " + p.gemeente : "");
  const pv = a.prijsvraag_id ? ((pbAdmin("/rest/v1/prijsvragen?id=eq." + a.prijsvraag_id + "&select=richtprijs_marge,status", "get") || [])[0] || {}) : {};
  const metPrijzen = pv.richtprijs_marge != null;
  const loten = pbAdmin("/rest/v1/loten?nr=in.(" + (a.loten || []).join(",") + ")&select=nr,naam", "get") || [];
  const lotTxt = (a.loten || []).map(n => { const l = loten.find(x => x.nr === n); return l ? n + ". " + l.naam : String(n); }).join(", ") + (a.posten && a.posten.length ? " — " + a.posten.length + " post" + (a.posten.length === 1 ? "" : "en") : "");
  const esc = H;
  const wrap = (inner) => "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1B1E1C;max-width:720px\">" + inner + "</div>";
  const knop = (url, txt) => "<p style=\"margin:24px 0\"><a href=\"" + url + "\" style=\"background:#1B1E1C;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block\">" + txt + "</a></p>";
  const dl = a.deadline ? String(a.deadline).split("-").reverse().join("/") : "";
  if (soort === "ingediend") {
    const wie = beller; if (c.user_id !== wie.id) return { ok: false, error: "Geen toegang." };
    if (!eenmalig("pai:" + a.id + ":" + (a.ingediend_op || ""), 3600)) return { ok: true };
    const profs = pbAdmin("/rest/v1/profiles?select=id,name,email,role,active&active=eq.true", "get") || [];
    const maker = profs.find(x => x.id === a.created_by) || profs.find(x => x.id === p.lead); const beheer = profs.filter(x => x.role === "beheer" && x.email);
    const to = maker && maker.email ? maker.email : (beheer[0] ? beheer[0].email : ""); if (!to) return { ok: false, error: "Geen ontvanger." };
    const cc = beheer.map(x => x.email).filter(e => e !== to).join(",");
    const regels = pbAdmin("/rest/v1/prijsaanvraag_regels?aanvraag_id=eq." + a.id + "&eenheidsprijs=not.is.null&select=post_id", "get") || [];
    const link = PORTAAL.URL.replace(/klant\/?$/, "");
    const html = wrap("<p>Dag " + esc(maker ? maker.name : "team") + ",</p><p><b>" + esc(c.naam) + "</b>" + (c.bedrijf && c.bedrijf !== c.naam ? " (" + esc(c.bedrijf) + ")" : "") + " heeft zijn prijsopgave ingediend voor <b>" + esc(proj) + "</b> — " + esc(a.titel || "prijsaanvraag") + " (" + esc(lotTxt) + "): " + regels.length + " posten met prijs.</p>" + (a.opmerking ? "<p style=\"padding:10px 14px;border-left:3px solid #DAD8D0;white-space:pre-line\">" + esc(a.opmerking) + "</p>" : "") + knop(link, "Vergelijken in het Planbord") + "<p style=\"color:#767D78;font-size:13px\">Projectfiche › Meetstaat › Prijsvragen › Vergelijken en gunnen: per post de winnaar kiezen; zijn prijs wordt de kostprijs.</p>");
    const opt = { htmlBody: html, name: PORTAAL.AFZENDER }; if (cc) opt.cc = cc; if (c.email) opt.replyTo = c.email;
    GmailApp.sendEmail(to, "Prijsopgave ingediend · " + proj + " · " + c.naam, c.naam + " diende zijn prijzen in voor " + proj + " (" + lotTxt + "). Bekijken: " + link, opt);
    return { ok: true };
  }
  const wie = team;
  if (!c.email) return { ok: false, error: "Dit contact heeft geen e-mailadres." };
  const naam = c.contactpersoon || c.naam; const aanhef = "Beste " + naam;
  const verstreken = !!(a.deadline && a.deadline < Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"));
  let uitgenodigd = false, linkHtml = "", linkTxt = "";
  if (!c.user_id && soort !== "gekozen" && soort !== "niet_weerhouden") {
    const r = portaalLink(String(c.email).trim().toLowerCase(), naam, c.id, "aannemer"); uitgenodigd = !r.bestaand;
    linkHtml = "<p>Je hebt nog geen login voor het aannemersportaal van BROS. Kies eerst je wachtwoord:</p>" + knop(r.link, "Kies je wachtwoord") + "<p style=\"color:#767D78;font-size:13px\">Daarna log je in op <a href=\"" + PORTAAL.URL_AANNEMER + "\">" + PORTAAL.URL_AANNEMER + "</a> met je e-mailadres en wachtwoord. Die link is beperkt geldig; vervallen? Klik op het portaal op \"Wachtwoord vergeten\".</p>";
    linkTxt = "\n\nJe hebt nog geen login: kies eerst je wachtwoord via " + r.link + " en log daarna in op " + PORTAAL.URL_AANNEMER;
  } else { linkHtml = knop(PORTAAL.URL_AANNEMER, "Prijzen invullen in het portaal"); linkTxt = "\n\nInvullen: " + PORTAAL.URL_AANNEMER; }
  let onderwerp, html, tekst;
  if (soort === "gekozen") {
    if (!eenmalig("pag:" + a.id + ":" + Math.floor(Date.now() / 600000), 600)) return { ok: true };
    const gun = a.prijsvraag_id ? (pbAdmin("/rest/v1/prijsvraag_gunningen?aanvraag_id=eq." + a.id + "&select=post_id", "get") || []).length : 0;
    const wat = gun ? "je prijs voor " + gun + " post" + (gun === 1 ? "" : "en") + " uit je prijsopgave" : "je prijsopgave";
    onderwerp = "Je prijzen zijn weerhouden · " + proj;
    html = wrap("<p>" + H(aanhef) + ",</p><p>Goed nieuws: BROS heeft " + esc(wat) + " voor <b>" + esc(proj) + "</b> (" + esc(lotTxt) + ") weerhouden" + (gun ? " — in het portaal staan ze aangeduid met ✓" : "") + ". " + esc(wie.name) + " neemt contact met je op over de verdere afspraken en de planning.</p>" + knop(PORTAAL.URL_AANNEMER, "Naar het aannemersportaal") + "<p>Met vriendelijke groeten,<br>" + esc(wie.name) + " — BROS</p>");
    tekst = aanhef + ",\n\nBROS heeft " + wat + " voor " + proj + " (" + lotTxt + ") weerhouden. " + wie.name + " neemt contact met je op.\n\n" + wie.name + " — BROS";
  } else if (soort === "niet_weerhouden") {
    if (a.status !== "niet_weerhouden") return { ok: false, error: "Deze aanvraag staat niet op 'niet weerhouden'." };
    if (!eenmalig("panw:" + a.id, 86400)) return { ok: true };
    onderwerp = "Je prijsopgave · " + proj;
    html = wrap("<p>" + H(aanhef) + ",</p><p>Bedankt voor je prijsopgave voor <b>" + esc(proj) + "</b> (" + esc(lotTxt) + "). We hebben deze keer voor een andere offerte gekozen. We nemen je graag opnieuw mee bij een volgende prijsvraag.</p><p>Met vriendelijke groeten,<br>" + esc(wie.name) + " — BROS</p>");
    tekst = aanhef + ",\n\nBedankt voor je prijsopgave voor " + proj + " (" + lotTxt + "). We hebben deze keer voor een andere offerte gekozen. We nemen je graag opnieuw mee bij een volgende prijsvraag.\n\n" + wie.name + " — BROS";
  } else {
    const her = soort === "herinnering";
    onderwerp = (her ? "Herinnering: prijsaanvraag" : "Prijsaanvraag") + " · " + proj + (dl ? (her && verstreken ? " · gevraagd tegen " : " · vóór ") + dl : "");
    const herTxt = her ? (verstreken ? "We wachten nog op je prijsopgave voor <b>" + esc(proj) + "</b> (" + esc(lotTxt) + "). De gevraagde datum, <b>" + dl + "</b>, is intussen verstreken — laat ons weten wanneer we je prijzen mogen verwachten, of dat je deze keer niet meedoet, dan plannen wij verder." : "Een korte herinnering: we wachten nog op je prijsopgave voor <b>" + esc(proj) + "</b> (" + esc(lotTxt) + ")" + (dl ? ", graag vóór <b>" + dl + "</b>" : "") + ".") : "";
    html = wrap("<p>" + H(aanhef) + ",</p>" + (her ? "<p>" + herTxt + "</p>" : "<p>BROS vraagt je een prijsopgave voor <b>" + esc(proj) + "</b>" + (p.adres ? " (" + esc(p.adres) + (p.gemeente ? ", " + esc(p.gemeente) : "") + ")" : "") + ": <b>" + esc(lotTxt) + "</b>." + (dl ? " Graag je prijzen vóór <b>" + dl + "</b>." : "") + "</p>")
      + (a.bericht ? "<p style=\"padding:10px 14px;border-left:3px solid #DAD8D0;white-space:pre-line\">" + esc(a.bericht) + "</p>" : "")
      + (metPrijzen ? "<p>In het aannemersportaal zie je de posten met hoeveelheden, eenheden en <b>de prijs die BROS voorstelt</b>; je past aan waar nodig (of vinkt 'niet aangeboden' aan), voegt eventueel je offerte als pdf toe en dient in als alles klopt.</p>"
        : "<p>In het aannemersportaal zie je de posten met hoeveelheden en eenheden; je vult per post je eenheidsprijs (excl. btw) in — of vinkt 'niet aangeboden' aan — met eventueel een opmerking, voegt je offerte als pdf toe als je wil, en dient in als alles klopt.</p>") + linkHtml
      + "<p>Met vriendelijke groeten,<br>" + esc(wie.name) + " — BROS</p>");
    tekst = aanhef + ",\n\n" + (her ? "Herinnering: we wachten nog op je prijsopgave voor " + proj + " (" + lotTxt + ")" + (dl ? (verstreken ? " — de gevraagde datum " + dl + " is verstreken; laat ons weten wanneer we je prijzen mogen verwachten" : " (vóór " + dl + ")") : "") : "BROS vraagt je een prijsopgave voor " + proj + ": " + lotTxt + (dl ? " (vóór " + dl + ")" : "")) + ".\n" + (a.bericht ? "\n" + a.bericht + "\n" : "") + linkTxt + "\n\n" + wie.name + " — BROS";
  }
  portaalMail(String(c.email).trim(), onderwerp, tekst, html);
  if (soort === "herinnering") { try { pbAdmin("/rest/v1/prijsaanvragen?id=eq." + a.id, "patch", { herinnerd_op: new Date().toISOString(), herinneringen: (Number(a.herinneringen) || 0) + 1 }); } catch (e) { } }
  return { ok: true, naar: c.email, uitgenodigd: uitgenodigd };
}
/* =====================================================================
   Meetstaat met prijzen voor de aannemer (script 032)
   'gedeeld' (beheer → aannemer; met uitnodiging voor het portaal als hij nog geen login heeft),
   'akkoord' / 'tegenvoorstel' (aannemer → wie deelde, beheer in kopie). Identiteit en rol via het login-token.
   ===================================================================== */
function aanPrijsMail(body) {
  const soort = String(body.soort || "");
  if (["gedeeld", "akkoord", "tegenvoorstel"].indexOf(soort) < 0) return { ok: false, error: "Onbekende soort." };
  const aannemerKant = soort !== "gedeeld";
  const beller = aannemerKant ? callerAny(body.token) : caller(body.token, true);
  if (aannemerKant && beller.role !== "aannemer") return { ok: false, error: "Geen toegang." };
  const a = (pbAdmin("/rest/v1/aannemer_meetstaten?id=eq." + uuid(body.id) + "&select=*", "get") || [])[0];
  if (!a) return { ok: false, error: "Meetstaat niet gevonden." };
  const c = (pbAdmin("/rest/v1/contacten?id=eq." + a.contact_id + "&select=id,naam,bedrijf,contactpersoon,email,user_id", "get") || [])[0];
  if (!c) return { ok: false, error: "Contact niet gevonden." };
  const p = (pbAdmin("/rest/v1/projecten?id=eq." + a.project_id + "&select=nummer,klant,naam,adres,gemeente,lead", "get") || [])[0] || {};
  const proj = (p.klant || "") + (p.naam && p.naam !== p.klant ? " · " + p.naam : "");
  const regels = a.regels || []; const totaal = regels.reduce((s, r) => { const v = yukiR2((Number(r.prijs) || 0) * (Number(r.hoeveelheid) || 0)); return s + (r.status === "minwerk" ? -Math.abs(v) : v); }, 0);
  const geld = (n) => "€ " + Number(n || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const esc = H;
  const wrap = (inner) => "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1B1E1C;max-width:720px\">" + inner + "</div>";
  const knop = (url, txt) => "<p style=\"margin:24px 0\"><a href=\"" + url + "\" style=\"background:#1B1E1C;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block\">" + txt + "</a></p>";
  if (aannemerKant) {
    if (c.user_id !== beller.id) return { ok: false, error: "Geen toegang." };
    if (a.status !== soort) return { ok: false, error: "De status klopt niet." };
    if (!eenmalig("apm:" + a.id + ":" + a.versie + ":" + soort, 3600)) return { ok: true };
    const profs = pbAdmin("/rest/v1/profiles?select=id,name,email,role,active&active=eq.true", "get") || [];
    const deler = profs.find(x => x.id === a.gedeeld_door) || profs.find(x => x.id === p.lead); const beheer = profs.filter(x => x.role === "beheer" && x.email);
    const to = deler && deler.email ? deler.email : (beheer[0] ? beheer[0].email : ""); if (!to) return { ok: false, error: "Geen ontvanger." };
    const cc = beheer.map(x => x.email).filter(e => e !== to).join(",");
    const reacties = Object.keys(a.reactie || {}).length;
    const link = PORTAAL.URL.replace(/klant\/?$/, "");
    const wat = soort === "akkoord"
      ? "is <b>akkoord</b> met de meetstaat met prijzen (versie " + a.versie + ", totaal " + geld(totaal) + " excl. btw). De prijzen staan nu als kostprijs in de meetstaat; de klantprijzen zijn ongewijzigd."
      : "dient een <b>tegenvoorstel</b> in op de meetstaat met prijzen (versie " + a.versie + "): " + reacties + " post" + (reacties === 1 ? "" : "en") + " met een opmerking of tegenprijs.";
    const html = wrap("<p>Dag " + esc(deler ? deler.name : "team") + ",</p><p><b>" + esc(c.naam) + "</b>" + (c.bedrijf && c.bedrijf !== c.naam ? " (" + esc(c.bedrijf) + ")" : "") + " " + wat + "</p><p>Project: <b>" + esc(proj) + "</b> · beslist door " + esc(a.beslist_naam || c.naam) + "</p>"
      + (a.opmerking ? "<p style=\"padding:10px 14px;border-left:3px solid #DAD8D0;white-space:pre-line\">" + esc(a.opmerking) + "</p>" : "")
      + knop(link, "Bekijken in het Planbord") + "<p style=\"color:#767D78;font-size:13px\">Planbord › project › Meetstaat › Meetstaat voor aannemers.</p>");
    const opt = { htmlBody: html, name: PORTAAL.AFZENDER }; if (cc) opt.cc = cc; if (c.email) opt.replyTo = c.email;
    GmailApp.sendEmail(to, (soort === "akkoord" ? "Akkoord meetstaat · " : "Tegenvoorstel meetstaat · ") + proj + " · " + c.naam, c.naam + (soort === "akkoord" ? " is akkoord met de meetstaat met prijzen voor " : " dient een tegenvoorstel in voor ") + proj + ". Bekijken: " + link, opt);
    return { ok: true, naar: to };
  }
  // gedeeld: team → aannemer
  if (!a.gedeeld || a.status !== "gedeeld") return { ok: false, error: "Deze meetstaat is niet gedeeld." };
  if (!c.email) return { ok: false, error: "Dit contact heeft geen e-mailadres." };
  if (!eenmalig("apm:" + a.id + ":" + a.versie + ":gedeeld", 600)) return { ok: true, naar: c.email };
  const naam = c.contactpersoon || c.naam; const aanhef = "Beste " + naam;
  let uitgenodigd = false, linkHtml, linkTxt;
  if (!c.user_id) {
    const r = portaalLink(String(c.email).trim().toLowerCase(), naam, c.id, "aannemer"); uitgenodigd = !r.bestaand;
    linkHtml = "<p>Je hebt nog geen login voor het aannemersportaal van BROS. Kies eerst je wachtwoord:</p>" + knop(r.link, "Kies je wachtwoord") + "<p style=\"color:#767D78;font-size:13px\">Daarna log je in op <a href=\"" + PORTAAL.URL_AANNEMER + "\">" + PORTAAL.URL_AANNEMER + "</a> met je e-mailadres en wachtwoord.</p>";
    linkTxt = "\n\nJe hebt nog geen login: kies eerst je wachtwoord via " + r.link + " en log daarna in op " + PORTAAL.URL_AANNEMER;
  } else { linkHtml = knop(PORTAAL.URL_AANNEMER, "Meetstaat bekijken en goedkeuren"); linkTxt = "\n\nBekijken en goedkeuren: " + PORTAAL.URL_AANNEMER; }
  const nieuw = a.versie > 1 ? "een aangepaste versie (versie " + a.versie + ") van " : "";
  const html = wrap("<p>" + H(aanhef) + ",</p><p>BROS deelt " + nieuw + "de meetstaat met prijzen voor <b>" + esc(proj) + "</b>" + (p.adres ? " (" + esc(p.adres) + (p.gemeente ? ", " + esc(p.gemeente) : "") + ")" : "") + ": " + regels.length + " posten, samen <b>" + geld(totaal) + "</b> excl. btw.</p>"
    + (a.bericht ? "<p style=\"padding:10px 14px;border-left:3px solid #DAD8D0;white-space:pre-line\">" + esc(a.bericht) + "</p>" : "")
    + "<p>In het aannemersportaal (tabblad Meetstaat) zie je per post de hoeveelheid en jouw eenheidsprijs. Je kan per post een opmerking of tegenvoorstel zetten, en daarna akkoord gaan of je tegenvoorstel indienen.</p>" + linkHtml
    + "<p>Met vriendelijke groeten,<br>" + esc(beller.name) + " — BROS</p>");
  const tekst = aanhef + ",\n\nBROS deelt " + nieuw + "de meetstaat met prijzen voor " + proj + ": " + regels.length + " posten, samen " + geld(totaal) + " excl. btw. Bekijk en keur goed in het aannemersportaal (tabblad Meetstaat)." + linkTxt + "\n\n" + beller.name + " — BROS";
  portaalMail(String(c.email).trim(), (a.versie > 1 ? "Aangepaste meetstaat" : "Meetstaat") + " met prijzen ter goedkeuring · " + proj, tekst, html);
  return { ok: true, naar: c.email, uitgenodigd: uitgenodigd };
}
/* =====================================================================
   Aannemer verwittigen (script 028)
   koppelmail: het Planbord roept dit aan wanneer een partij aan een project gekoppeld wordt (vinkje in het koppelformulier).
   Heeft ze al een login voor het aannemersportaal, dan gaat een korte melding; anders vertrekt meteen de uitnodiging.
   ===================================================================== */
function koppelMail(body) {
  const wie = caller(body.token, false);
  const pc = (pbAdmin("/rest/v1/project_contacten?id=eq." + uuid(body.id) + "&select=id,project_id,contact_id,rol,loten,notitie", "get") || [])[0];
  if (!pc) return { ok: false, error: "Koppeling niet gevonden." };
  if (pc.rol === "bouwheer" || pc.rol === "contactpersoon") return { ok: false, error: "Voor de klant gebruik je 'Portaal-toegang geven'." };
  const c = (pbAdmin("/rest/v1/contacten?id=eq." + pc.contact_id + "&select=id,naam,bedrijf,contactpersoon,email,user_id,soort", "get") || [])[0];
  if (!c) return { ok: false, error: "Contact niet gevonden." };
  if (c.soort === "klant") return { ok: false, error: "Dit contact is een klant." };
  if (!c.email) return { ok: false, error: "Dit contact heeft geen e-mailadres." };
  const p = (pbAdmin("/rest/v1/projecten?id=eq." + pc.project_id + "&select=nummer,klant,naam,adres,gemeente", "get") || [])[0] || {};
  const proj = (p.klant || "") + (p.naam && p.naam !== p.klant ? " · " + p.naam : "");
  const loten = (pc.loten || []).length ? (pbAdmin("/rest/v1/loten?nr=in.(" + pc.loten.join(",") + ")&select=nr,naam", "get") || []) : [];
  const lotTxt = (pc.loten || []).map(n => { const l = loten.find(x => x.nr === n); return l ? n + ". " + l.naam : String(n); }).join(", ");
  const esc = H;
  const knop = (url, txt) => "<p style=\"margin:24px 0\"><a href=\"" + url + "\" style=\"background:#1B1E1C;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block\">" + txt + "</a></p>";
  const naam = c.contactpersoon || c.naam; const aanhef = "Beste " + naam;
  const waar = p.adres ? " (" + esc(p.adres) + (p.gemeente ? ", " + esc(p.gemeente) : "") + ")" : "";
  const intro = "<p>BROS werkt met je samen op het project <b>" + esc(proj) + "</b>" + waar + (lotTxt ? " voor <b>" + esc(lotTxt) + "</b>" : "") + ".</p>"
    + "<p>In het aannemersportaal vind je vanaf nu per project de werfpunten die aan jou toegewezen zijn (met foto's en plannen), de werfverslagen, de documenten die we delen, de planning en de prijsaanvragen die we je sturen. Werfpunten meld je er als opgelost, met een bewijsfoto.</p>"
    + (pc.notitie ? "<p style=\"padding:10px 14px;border-left:3px solid #DAD8D0;white-space:pre-line\">" + esc(pc.notitie) + "</p>" : "");
  let uitgenodigd = false, html, tekst;
  if (!c.user_id) {
    const r = portaalLink(String(c.email).trim().toLowerCase(), naam, c.id, "aannemer"); uitgenodigd = !r.bestaand;
    html = "<p>" + H(aanhef) + ",</p>" + intro + "<p>Kies eerst je wachtwoord:</p>" + knop(r.link, "Kies je wachtwoord")
      + "<p style=\"color:#767D78;font-size:13px\">Daarna log je altijd in op <a href=\"" + PORTAAL.URL_AANNEMER + "\">" + PORTAAL.URL_AANNEMER + "</a> met je e-mailadres en wachtwoord. Op de werf gebruik je dezelfde login in de werfmodus (" + PORTAAL.URL_AANNEMER.replace(/aannemer\/?$/, "werf/") + "). De link is beperkt geldig; vervallen? Klik op het portaal op \"Wachtwoord vergeten\".</p>";
    tekst = aanhef + ",\n\nBROS werkt met je samen op het project " + proj + (lotTxt ? " voor " + lotTxt : "") + ". In het aannemersportaal vind je de werfpunten, verslagen, documenten, planning en prijsaanvragen van je projecten.\n\nKies eerst je wachtwoord via " + r.link + " en log daarna in op " + PORTAAL.URL_AANNEMER;
  } else {
    html = "<p>" + H(aanhef) + ",</p>" + intro + knop(PORTAAL.URL_AANNEMER, "Naar het aannemersportaal") + "<p style=\"color:#767D78;font-size:13px\">Je logt in met je bestaande e-mailadres en wachtwoord; het project staat in je lijst.</p>";
    tekst = aanhef + ",\n\nBROS werkt met je samen op het project " + proj + (lotTxt ? " voor " + lotTxt : "") + ". Het staat vanaf nu in je aannemersportaal: " + PORTAAL.URL_AANNEMER;
  }
  html = "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1B1E1C;max-width:720px\">" + html + "<p>Met vriendelijke groeten,<br>" + esc(wie.name) + " — BROS</p></div>";
  portaalMail(String(c.email).trim(), "Nieuw project · " + proj + (lotTxt ? " · " + lotTxt : ""), tekst + "\n\n" + wie.name + " — BROS", html);
  try { pbAdmin("/rest/v1/project_contacten?id=eq." + pc.id, "patch", { verwittigd_op: new Date().toISOString() }); } catch (e) { }
  return { ok: true, naar: c.email, uitgenodigd: uitgenodigd };
}
/* =====================================================================
   Prijsaanvragen — automatische wekelijkse herinnering (script 028)
   Loopt mee met de uurlijkse trigger van documentenDigest (digestInstall). Een prijsaanvraag die HERINNERING.DAGEN dagen open staat
   zonder indiening krijgt een herinnering, en daarna elke week opnieuw (op werkdagen, vanaf HERINNERING.VAN_UUR). Na HERINNERING.MAX
   herinneringen stopt het en krijgt de projectlead één mail dat de aannemer niet reageert. Afsluiten of indienen stopt het altijd.
   ===================================================================== */
const HERINNERING = { DAGEN: 7, VAN_UUR: 8, MAX: 4 };
let AUTO_WIE = null;   // afzender voor automatische mails (geen login-token beschikbaar in een trigger)
function prijsaanvraagHerinneringen() {
  const nu = new Date(); const dag = nu.getDay(); if (dag === 0 || dag === 6 || nu.getHours() < HERINNERING.VAN_UUR) return 0;
  let open; try { open = pbAdmin("/rest/v1/prijsaanvragen?status=eq.open&select=id,project_id,contact_id,titel,deadline,created_at,herinnerd_op,herinneringen,created_by,herinnerd_deadline", "get") || []; }
  catch (e) { open = pbAdmin("/rest/v1/prijsaanvragen?status=eq.open&select=id,project_id,contact_id,titel,deadline,created_at,herinnerd_op,herinneringen,created_by", "get") || []; }   // vóór script 037
  const vandaagIso = Utilities.formatDate(nu, "Europe/Brussels", "yyyy-MM-dd"); const binnen2 = Utilities.formatDate(new Date(nu.getTime() + 2 * 86400000), "Europe/Brussels", "yyyy-MM-dd");
  const grens = nu.getTime() - HERINNERING.DAGEN * 86400000; let n = 0;
  const profs = open.length ? (pbAdmin("/rest/v1/profiles?select=id,name,email,role&active=eq.true", "get") || []) : [];
  open.forEach(a => {
    // script 037: één herinnering in de laatste 2 dagen vóór de deadline (niet als de aanvraag pas verstuurd of net herinnerd werd)
    const kortVoor = "herinnerd_deadline" in a && !a.herinnerd_deadline && a.deadline && a.deadline >= vandaagIso && a.deadline <= binnen2 && (Number(a.herinneringen) || 0) < HERINNERING.MAX
      && nu.getTime() - new Date(a.herinnerd_op || a.created_at).getTime() > 2 * 86400000;
    if (kortVoor) {
      const p0 = (pbAdmin("/rest/v1/projecten?id=eq." + a.project_id + "&select=lead", "get") || [])[0] || {};
      const lead0 = profs.find(x => x.id === a.created_by) || profs.find(x => x.id === p0.lead) || profs.find(x => x.role === "beheer");
      AUTO_WIE = { id: lead0 ? lead0.id : null, name: lead0 ? lead0.name : "Het team van BROS", role: "beheer" };
      try { const r = prijsaanvraagMail({ id: a.id, soort: "herinnering" }); if (r && r.ok) { n++; pbAdmin("/rest/v1/prijsaanvragen?id=eq." + a.id, "patch", { herinnerd_deadline: nu.toISOString() }); } }
      catch (e) { Logger.log("Herinnering (deadline) mislukt (" + a.id + "): " + e); }
      AUTO_WIE = null; return;
    }
    const ref = new Date(a.herinnerd_op || a.created_at).getTime(); if (ref > grens) return;
    const p = (pbAdmin("/rest/v1/projecten?id=eq." + a.project_id + "&select=klant,naam,lead", "get") || [])[0] || {};
    const lead = profs.find(x => x.id === a.created_by) || profs.find(x => x.id === p.lead) || profs.find(x => x.role === "beheer");
    if ((Number(a.herinneringen) || 0) >= HERINNERING.MAX) {
      if ((Number(a.herinneringen) || 0) === HERINNERING.MAX) {
        const c = (pbAdmin("/rest/v1/contacten?id=eq." + a.contact_id + "&select=naam,email", "get") || [])[0] || {};
        const proj = (p.klant || "") + (p.naam && p.naam !== p.klant ? " · " + p.naam : "");
        if (lead && lead.email) portaalMail(lead.email, "Geen reactie op prijsaanvraag · " + proj + " · " + (c.naam || ""), "Dag " + lead.name + ",\n\n" + (c.naam || "De aannemer") + " heeft na " + HERINNERING.MAX + " herinneringen nog geen prijzen ingediend voor " + proj + " (" + (a.titel || "prijsaanvraag") + "). Het Planbord stuurt geen herinneringen meer; bel hem even, of sluit de aanvraag af (projectfiche › Meetstaat › Prijsaanvragen).\n\nBROS Planbord", "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1B1E1C\"><p>Dag " + lead.name + ",</p><p><b>" + String(c.naam || "De aannemer").replace(/</g, "&lt;") + "</b> heeft na " + HERINNERING.MAX + " herinneringen nog geen prijzen ingediend voor <b>" + proj.replace(/</g, "&lt;") + "</b> (" + String(a.titel || "prijsaanvraag").replace(/</g, "&lt;") + "). Het Planbord stuurt geen herinneringen meer; bel hem even, of sluit de aanvraag af (projectfiche › Meetstaat › Prijsaanvragen).</p><p>BROS Planbord</p></div>");
        pbAdmin("/rest/v1/prijsaanvragen?id=eq." + a.id, "patch", { herinneringen: HERINNERING.MAX + 1, herinnerd_op: nu.toISOString() });
      }
      return;
    }
    AUTO_WIE = { id: lead ? lead.id : null, name: lead ? lead.name : "Het team van BROS", role: "beheer" };
    try { const r = prijsaanvraagMail({ id: a.id, soort: "herinnering" }); if (r && r.ok) n++; else Logger.log("Herinnering niet verstuurd (" + a.id + "): " + (r && r.error)); }
    catch (e) { Logger.log("Herinnering mislukt (" + a.id + "): " + e); }
    AUTO_WIE = null;
  });
  Logger.log(n + " herinnering(en) voor prijsaanvragen verstuurd."); return n;
}
/* =====================================================================
   Gedeelde documenten — verzamelmail (script 027)
   documentenDigest() draait elk uur (digestInstall() eenmalig uitvoeren): per project één mail aan de klant(en) en één aan
   de aannemers met de bestanden die sinds de vorige mail gedeeld zijn — pas als er DIGEST.WACHT_MIN minuten niets meer bijkwam,
   zodat een reeks bestanden in één mail belandt. Verstuurt enkel aan contacten met een portaallogin (de link gaat naar het portaal).
   ===================================================================== */
/* =====================================================================
   Onderhoud zonder omkijken (1.48) — loopt mee met de bestaande uurlijkse triggers (yukiSync, documentenDigest)
   - hartslag: elk uur een schrijfactie in Supabase (instellingen.hartslag), zodat een gratis project nooit gepauzeerd wordt
     na een week zonder gebruik (bv. bouwverlof); het Planbord toont beheerders een melding als de hartslag stilvalt.
   - back-up: elke week alle tabellen als .json.gz in Drive (map "BROS Planbord back-ups"), de laatste 12 weken blijven bewaard.
   - bewaking: elke week database- en opslaggebruik (Supabase), Drive/Gmail-opslag en het mailquotum; een mail aan
     YUKI.REPORT_TO enkel als iets boven 80 % zit.
   - zelfherstel: ontbreekt een van de vaste triggers, dan wordt hij opnieuw aangemaakt.
   ===================================================================== */
const ONDERHOUD = { BACKUP_MAP: "BROS Planbord back-ups", BACKUP_WEKEN: 12, DREMPEL: 0.8 };
const BACKUP_TABELLEN = ["profiles", "tarieven", "fasen", "standaardtaken", "projecten", "taken", "uren", "documenten", "instellingen", "loten", "posten", "meetstaat_posten", "meetstaat_prijzen",
  "vorderingen", "vordering_regels", "contacten", "project_contacten", "goedkeuringen", "goedkeuring_tekenaars", "notities", "werfbezoeken", "vaststellingen", "klant_timing", "werfplannen", "werfverslagen",
  "taak_voorstellen", "assistent_gesprekken", "assistent_berichten", "prijsaanvragen", "prijsaanvraag_regels", "prijsvragen", "prijsvraag_gunningen", "tekenplannen", "plan_objecten", "plan_versies", "plan_symbolen",
  "aannemer_meetstaten", "aannemer_meetstaat_posten", "keuzes", "keuze_opties", "meerwerk_aanvragen", "werf_fotos", "werf_updates", "woningdossier",
  "aannemer_facturen", "aannemer_hulp"];   // 1.49 (script 047)
const BACKUP_OPTIONEEL = ["aannemer_facturen", "aannemer_hulp"];   // bestaan pas na script 047: ontbreken is dan geen back-upfout
const BACKUP_ORDE = { fasen: "nr", loten: "nr", tarieven: "user_id", instellingen: "key", klant_timing: "project_id,fase_nr", prijsvraag_gunningen: "prijsvraag_id,post_id", meetstaat_prijzen: "post_id", plan_symbolen: "code" };
function onderhoud(volledig) {
  const cache = CacheService.getScriptCache();
  if (!cache.get("hartslag")) { cache.put("hartslag", "1", 3000); try { hartslag(); } catch (e) { Logger.log("Hartslag: " + e); } try { triggersHerstellen(); } catch (e) { Logger.log("Triggers: " + e); } }
  if (!volledig) return;   // yukiSync/documentenDigest: enkel de hartslag (hun eigen werk heeft de tijd nodig); back-up en bewaking via onderhoudUur
  const props = PropertiesService.getScriptProperties(); const nu = Date.now(), WEEK = 7 * 86400000;
  if (nu - Number(props.getProperty("BACKUP_LAATST") || 0) > WEEK) {
    try { const f = backup(); props.setProperty("BACKUP_LAATST", String(nu)); props.setProperty("BACKUP_GEMELD", ""); props.setProperty("BACKUP_FOUTEN", Object.keys(f).length ? JSON.stringify(f).slice(0, 800) : ""); return; }   // bewaking in een volgende run (elk een eigen 6-minutenvenster)
    catch (e) { Logger.log("Back-up: " + e); const fout = String(e).slice(0, 300); if (props.getProperty("BACKUP_FOUTEN") !== fout) props.setProperty("BACKUP_GEMELD", ""); props.setProperty("BACKUP_FOUTEN", fout); props.setProperty("BACKUP_LAATST", String(nu - WEEK + 86400000)); }   // mislukt (bv. Drive vol): morgen opnieuw, en de bewaking hieronder meldt het meteen   // (zelfde fout: geen nieuwe mail)
  }
  if (nu - Number(props.getProperty("GEZONDHEID_LAATST") || 0) > WEEK || (props.getProperty("BACKUP_FOUTEN") && !props.getProperty("BACKUP_GEMELD"))) {
    try { gezondheid(); props.setProperty("GEZONDHEID_LAATST", String(nu)); props.setProperty("BACKUP_GEMELD", props.getProperty("BACKUP_FOUTEN") ? "1" : ""); } catch (e) { Logger.log("Bewaking: " + e); }
  }
}
/* eigen uurtrigger voor het onderhoud — wordt automatisch aangemaakt bij het eerste gebruik van het Planbord na deze versie (doPost) */
function onderhoudUur() { onderhoud(true); }
function onderhoudZeker() {
  const cache = CacheService.getScriptCache(); if (cache.get("onderhoud-trigger")) return;
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === "onderhoudUur")) ScriptApp.newTrigger("onderhoudUur").timeBased().everyHours(1).create();
  cache.put("onderhoud-trigger", "1", 21600);
}
function onderhoudInstall() { CacheService.getScriptCache().remove("onderhoud-trigger"); onderhoudZeker(); CacheService.getScriptCache().remove("hartslag"); onderhoud(false); Logger.log("OK — onderhoud draait elk uur (hartslag), back-up en bewaking wekelijks."); }
function hartslag() {
  pbAdmin("/rest/v1/instellingen?on_conflict=key", "post", { key: "hartslag", value: { drive: new Date().toISOString(), versie: "1.49.0" } }, "resolution=merge-duplicates,return=minimal");
}
function triggersHerstellen() {   // enkel triggers die er eerder al waren (nooit iets aanzetten dat BROS zelf niet installeerde)
  const props = PropertiesService.getScriptProperties();
  const er = ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction());
  const gezien = (props.getProperty("TRIGGERS_GEZIEN") || "").split(",").filter(Boolean);
  const alle = [...new Set(gezien.concat(er.filter(h => ["yukiSync", "documentenDigest", "weekoverzicht"].indexOf(h) >= 0)))];
  props.setProperty("TRIGGERS_GEZIEN", alle.join(","));
  if (alle.indexOf("yukiSync") >= 0 && er.indexOf("yukiSync") < 0) ScriptApp.newTrigger("yukiSync").timeBased().everyHours(1).create();
  if (alle.indexOf("documentenDigest") >= 0 && er.indexOf("documentenDigest") < 0) ScriptApp.newTrigger("documentenDigest").timeBased().everyHours(1).create();
  if (alle.indexOf("weekoverzicht") >= 0 && er.indexOf("weekoverzicht") < 0) ScriptApp.newTrigger("weekoverzicht").timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
}
/* alle rijen van een tabel met de service key (per 1000) */
function pbAdminAll(tabel) {
  let all = []; const orde = BACKUP_ORDE[tabel] || "id";
  for (let off = 0; ; off += 1000) {
    const d = pbAdmin("/rest/v1/" + tabel + "?select=*&order=" + orde + "&limit=1000&offset=" + off, "get") || [];
    all = all.concat(d); if (d.length < 1000) return all;
  }
}
/** Elke week automatisch (via onderhoud); mag ook met de hand uitgevoerd worden. */
function backup() {
  const t0 = Date.now(); const data = { gemaakt: new Date().toISOString(), tabellen: {}, fouten: {} };
  BACKUP_TABELLEN.forEach(t => { if (Date.now() - t0 > 240000) { data.fouten[t] = "tijd op"; return; } try { data.tabellen[t] = pbAdminAll(t); } catch (e) { if (BACKUP_OPTIONEEL.indexOf(t) >= 0 && /does not exist|42P01|PGRST205|schema cache|404/i.test(String(e))) return; data.fouten[t] = String(e).slice(0, 200); } });
  const it = DriveApp.getRootFolder().getFoldersByName(ONDERHOUD.BACKUP_MAP); const map = it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(ONDERHOUD.BACKUP_MAP);
  const naam = "planbord-" + Utilities.formatDate(new Date(), "Europe/Brussels", "yyyy-MM-dd") + ".json.gz";
  map.createFile(Utilities.gzip(Utilities.newBlob(JSON.stringify(data), "application/json", naam.replace(/\.gz$/, "")), naam));
  // oude back-ups (enkel de eigen planbord-*.json.gz in deze map) naar de prullenbak
  const grens = Date.now() - ONDERHOUD.BACKUP_WEKEN * 7 * 86400000; const fs = map.getFiles();
  while (fs.hasNext()) { const f = fs.next(); if (/^planbord-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(f.getName()) && f.getDateCreated().getTime() < grens) f.setTrashed(true); }
  Logger.log("Back-up " + naam + ": " + Object.keys(data.tabellen).length + " tabellen" + (Object.keys(data.fouten).length ? ", fouten: " + JSON.stringify(data.fouten) : ""));
  return data.fouten;
}
/** Elke week: gebruik t.o.v. de limieten; mail enkel als iets boven 80 % zit. */
function gezondheid(altijd) {
  const regels = [];
  try { const g = pbAdmin("/rest/v1/rpc/pb_gebruik", "post", {}) || {};   // script 045
    const DB = 500 * 1048576, OPSLAG = 1024 * 1048576;   // limieten van het gratis Supabase-plan (op een betaald plan ruim hoger)
    if (g.db != null) regels.push(["Supabase-database", g.db, DB]); if (g.storage != null) regels.push(["Supabase-opslag (foto's, plannen, pdf's)", g.storage, OPSLAG]); } catch (e) { Logger.log("pb_gebruik: " + e); }
  try { const lim = DriveApp.getStorageLimit(); if (lim > 0) regels.push(["Google-opslag van " + scriptAccount() + " (Drive + Gmail)", DriveApp.getStorageUsed(), lim]); } catch (e) { }
  const mb = (b) => Math.round(b / 1048576) + " MB";
  const te = regels.filter(r => r[1] / r[2] >= ONDERHOUD.DREMPEL);
  let back = ""; try { const f = backupFouten(); if (f) back = f; } catch (e) { }
  Logger.log(regels.map(r => r[0] + ": " + mb(r[1]) + " / " + mb(r[2])).join(" · "));
  if (!te.length && !back && !altijd) return;
  const txt = "Planbord — bewaking\n\n" + regels.map(r => (r[1] / r[2] >= ONDERHOUD.DREMPEL ? "⚠ " : "") + r[0] + ": " + mb(r[1]) + " van " + mb(r[2]) + " (" + Math.round(r[1] / r[2] * 100) + " %)").join("\n")
    + (back ? "\n\nBack-up: " + back : "") + "\n\nWat te doen: oude foto's/plannen opruimen of het plan uitbreiden (Supabase), of oude mails met grote bijlagen verwijderen (Gmail). Deze mail komt hooguit één keer per week (en één keer per nieuwe back-upfout).";
  GmailApp.sendEmail(YUKI.REPORT_TO, "Planbord: " + (te.length ? "opslag bijna vol" : "melding"), txt);
}
function backupFouten() {
  const f = PropertiesService.getScriptProperties().getProperty("BACKUP_FOUTEN") || ""; if (f) return "niet volledig — " + f;
  const it = DriveApp.getRootFolder().getFoldersByName(ONDERHOUD.BACKUP_MAP); if (!it.hasNext()) return "nog geen back-up gemaakt"; return "";
}
const DIGEST = { WACHT_MIN: 45, VAN_UUR: 7, TOT_UUR: 21 };   // niet 's nachts mailen; wat 's avonds gedeeld wordt, gaat 's ochtends
function digestInstall() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "documentenDigest").forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("documentenDigest").timeBased().everyHours(1).create();
  Logger.log("OK — uurlijkse trigger voor documentenDigest aangemaakt (verzamelmail documenten + herinneringen prijsaanvragen). Test nu met documentenDigest().");
}
function documentenDigest() {
  onderhoud(false);   // 1.48: hartslag (back-up en bewaking via de eigen uurtrigger onderhoudUur)
  const uur = new Date().getHours(); if (uur < DIGEST.VAN_UUR || uur >= DIGEST.TOT_UUR) return;
  const dag = new Date().getDay(); if (((dag === 1 && uur >= 10) || dag === 2) && ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === "weekoverzicht")) { try { weekoverzicht(); } catch (e) { Logger.log("Weekoverzicht inhalen: " + e); } }   // 1.48: gemiste maandagmails (quotum, storing) zelf inhalen; wie al gemaild werd, slaat het over
  try { prijsaanvraagHerinneringen(); } catch (e) { Logger.log("Herinneringen prijsaanvragen: " + e); }   // script 028
  try { aannemerFacturenMelden(); } catch (e) { Logger.log("Aannemersfacturen melden: " + e); }   // 1.49 (script 047)
  const docs = pbAdmin("/rest/v1/documenten?or=(gemeld_klant.eq.false,gemeld_aannemers.eq.false)&select=id,project_id,naam,pad,url,gedeeld,gedeeld_aannemers,gedeeld_op,gedeeld_aannemers_op,gemeld_klant,gemeld_aannemers&limit=500", "get") || [];
  if (!docs.length) { Logger.log("Niets te melden."); return; }
  const grens = Date.now() - DIGEST.WACHT_MIN * 60000; let mails = 0;
  const projIds = [...new Set(docs.map(d => d.project_id))];
  const projecten = pbIn("/rest/v1/projecten?", "id", projIds, "&select=id,nummer,klant,naam,lead");
  const pcs = pbIn("/rest/v1/project_contacten?", "project_id", projIds, "&select=project_id,contact_id,rol");
  const cIds = [...new Set(pcs.map(x => x.contact_id))];
  const contacten = pbIn("/rest/v1/contacten?", "id", cIds, "&user_id=not.is.null&actief=eq.true&select=id,naam,contactpersoon,email,user_id");
  const profs = pbAdmin("/rest/v1/profiles?select=id,name,email&active=eq.true", "get") || [];
  const esc = H;
  projecten.forEach(p => {
    const proj = (p.klant || "") + (p.naam && p.naam !== p.klant ? " · " + p.naam : ""); const lead = profs.find(x => x.id === p.lead);
    [["klant", "gemeld_klant", "gedeeld", "gedeeld_op", PORTAAL.URL, (x) => x.rol === "bouwheer" || x.rol === "contactpersoon", "je BROS-klantenportaal"],
     ["aannemers", "gemeld_aannemers", "gedeeld_aannemers", "gedeeld_aannemers_op", PORTAAL.URL_AANNEMER, (x) => x.rol !== "bouwheer" && x.rol !== "contactpersoon", "het BROS-aannemersportaal"]].forEach(([wie, gemeld, gedeeld, op, url, rolOk, portaalNaam]) => {
      const lijst = docs.filter(d => d.project_id === p.id && !d[gemeld] && d[gedeeld]);
      if (!lijst.length) return;
      if (lijst.some(d => d[op] && new Date(d[op]).getTime() > grens)) return;   // nog bezig met delen: volgend uur
      const ids = lijst.map(d => d.id);
      const naar = pcs.filter(x => x.project_id === p.id && rolOk(x)).map(x => contacten.find(c => c.id === x.contact_id)).filter(c => c && c.email);
      const uniek = [...new Map(naar.map(c => [String(c.email).toLowerCase(), c])).values()];
      if (uniek.length && !mailRuimte(uniek.length)) { Logger.log("Dagquotum voor mails bijna op — " + proj + " volgt later."); return; }   // niet als gemeld zetten: volgend uur/morgen opnieuw
      if (uniek.length) {
        const groepen = {}; lijst.forEach(d => (groepen[d.pad || ""] = groepen[d.pad || ""] || []).push(d));
        const rows = Object.keys(groepen).sort().map(g => (g ? "<div style=\"color:#767D78;font-size:12px;margin-top:10px\">" + esc(g.replace(/\//g, " › ")) + "</div>" : "") + groepen[g].map(d => "<div style=\"padding:6px 0;border-bottom:1px solid #EEE\">" + esc(d.naam) + "</div>").join("")).join("");
        uniek.forEach(c => {
          const naam = c.contactpersoon || c.naam;
          const html = "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1B1E1C;max-width:640px\"><p>Beste " + esc(naam) + ",</p><p>BROS heeft " + (lijst.length === 1 ? "een nieuw document" : lijst.length + " nieuwe documenten") + " voor je klaargezet bij <b>" + esc(proj) + "</b>:</p>" + rows
            + "<p style=\"margin:24px 0\"><a href=\"" + url + "\" style=\"background:#1B1E1C;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block\">Bekijken in " + portaalNaam + "</a></p><p style=\"color:#767D78;font-size:13px\">Je vindt ze onder Documenten; het portaal toont altijd de laatste versie.</p><p>" + esc(lead ? lead.name : "Het team") + " — BROS</p></div>";
          const tekst = "Beste " + naam + ",\n\nBROS heeft " + lijst.length + " nieuwe document(en) voor je klaargezet bij " + proj + ":\n" + lijst.map(d => "- " + (d.pad ? d.pad + "/" : "") + d.naam).join("\n") + "\n\nBekijken: " + url + "\n\nBROS";
          try { portaalMail(String(c.email).trim(), (lijst.length === 1 ? "Nieuw document" : lijst.length + " nieuwe documenten") + " · " + proj, tekst, html); mails++; } catch (e) { Logger.log("Digest " + c.email + ": " + e); }   // 1.48: één fout adres stopt de rest niet
        });
      }
      const patch = {}; patch[gemeld] = true;
      chunks(ids, 25).forEach(c => pbAdmin("/rest/v1/documenten?id=in.(" + c.join(",") + ")", "patch", patch));
    });
  });
  Logger.log(mails + " mail(s) verstuurd.");
}
/** 1.49 (script 047): één keer per dag (vanaf DIGEST.VAN_UUR) een mail aan BROS met de facturen die aannemers in hun portaal
 *  oplaadden of verbeterden sinds de vorige mail. Niets nieuw → geen mail. Opvolgen doe je in het Planbord (tabblad Aankoop). */
function aannemerFacturenMelden() {
  const props = PropertiesService.getScriptProperties(); const vandaag = Utilities.formatDate(new Date(), "Europe/Brussels", "yyyy-MM-dd");
  if (props.getProperty("AF_MAIL_DAG") === vandaag) return;
  let rijen; try { rijen = pbAdmin("/rest/v1/aannemer_facturen?gemeld=eq.false&select=id,project_id,contact_id,aannemer_naam,nummer,datum,vervaldag,bedrag_excl,btw_bedrag,omschrijving,status,created_at&order=created_at.asc&limit=200", "get") || []; }
  catch (e) { Logger.log("aannemer_facturen (script 047 nog niet uitgevoerd?): " + e); return; }
  if (!rijen.length) return;   // niets nieuw: later vandaag opnieuw kijken
  if (!mailRuimte(1)) { Logger.log("Dagquotum voor mails bijna op — aannemersfacturen volgen later."); return; }
  const projecten = pbIn("/rest/v1/projecten?", "id", rijen.map(r => r.project_id), "&select=id,nummer,klant,naam");
  const eu = (n) => "€ " + Number(n || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const d = (x) => x ? String(x).slice(8, 10) + "/" + String(x).slice(5, 7) + "/" + String(x).slice(0, 4) : "";
  const pn = (id) => { const p = projecten.find(x => x.id === id); return p ? (p.nummer ? p.nummer + " · " : "") + (p.klant || "") + (p.naam && p.naam !== p.klant ? " · " + p.naam : "") : ""; };
  const incl = (r) => Number(r.bedrag_excl || 0) + Number(r.btw_bedrag || 0); const tot = rijen.reduce((s, r) => s + incl(r), 0);
  const url = PORTAAL.URL.replace(/klant\/?$/, "") + "#aankoop";
  const html = "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1B1E1C;max-width:760px\"><p>" + (rijen.length === 1 ? "Een aannemer laadde een factuur op" : rijen.length + " facturen van aannemers opgeladen of verbeterd") + " in het aannemersportaal (samen " + eu(tot) + " incl. btw):</p>"
    + "<table style=\"border-collapse:collapse;width:100%\"><tr style=\"color:#767D78;font-size:12px;text-align:left\"><th style=\"padding:4px 6px\">Project</th><th style=\"padding:4px 6px\">Aannemer</th><th style=\"padding:4px 6px\">Factuur</th><th style=\"padding:4px 6px;text-align:right\">Incl. btw</th><th style=\"padding:4px 6px\">Vervalt</th></tr>"
    + rijen.map(r => "<tr style=\"border-top:1px solid #EEE\"><td style=\"padding:6px\">" + H(pn(r.project_id)) + "</td><td style=\"padding:6px\">" + H(r.aannemer_naam || "") + "</td><td style=\"padding:6px\"><b>" + H(r.nummer || "") + "</b>" + (r.omschrijving ? "<div style=\"color:#767D78;font-size:12px\">" + H(String(r.omschrijving).slice(0, 140)) + "</div>" : "") + "</td><td style=\"padding:6px;text-align:right;white-space:nowrap\">" + eu(incl(r)) + "</td><td style=\"padding:6px;white-space:nowrap\">" + d(r.vervaldag) + "</td></tr>").join("") + "</table>"
    + "<p style=\"margin:22px 0\"><a href=\"" + url + "\" style=\"background:#1B1E1C;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;display:inline-block\">Opvolgen in het Planbord (Aankoop)</a></p><p style=\"color:#767D78;font-size:12px\">Deze mail komt hooguit één keer per dag, enkel als er iets nieuws is.</p></div>";
  const tekst = rijen.length + " factuur/facturen van aannemers:\n" + rijen.map(r => "- " + pn(r.project_id) + " · " + (r.aannemer_naam || "") + " · " + (r.nummer || "") + " · " + eu(incl(r)) + (r.vervaldag ? " · vervalt " + d(r.vervaldag) : "")).join("\n") + "\n\nOpvolgen: " + url;
  portaalMail(YUKI.REPORT_TO, (rijen.length === 1 ? "Nieuwe aannemersfactuur" : rijen.length + " nieuwe aannemersfacturen") + " · " + eu(tot), tekst, html);
  props.setProperty("AF_MAIL_DAG", vandaag);   // eerst noteren: mislukt het markeren hieronder, dan vandaag geen tweede mail
  chunks(rijen.map(r => r.id), 25).forEach(c => { try { pbAdmin("/rest/v1/aannemer_facturen?id=in.(" + c.join(",") + ")", "patch", { gemeld: true }); } catch (e) { Logger.log("gemeld zetten: " + e); } });
}
/* =====================================================================
   Wekelijkse samenvatting voor klanten (script 034) — elke maandag rond 8 uur
   Per klant (contact met portaaltoegang, weekmail aan) en per lopend project: nieuwe verslagen, werfverslagen,
   documenten en facturen van de voorbije week, plus wat op hem wacht (akkoord, actiepunten, openstaande facturen).
   Niets nieuws en niets open → geen mail. De klant zet ze zelf uit in het portaal (Welkom › Op de hoogte blijven).
   Installatie: éénmaal weekoverzichtInstall() uitvoeren. Voorbeeld zonder iets te versturen naar klanten:
   weekoverzichtProef() — stuurt alle mails van deze week naar YUKI.REPORT_TO.
   ===================================================================== */
function weekoverzichtInstall() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "weekoverzicht").forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("weekoverzicht").timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
  Logger.log("OK — wekelijkse trigger (maandag 8–9 u) aangemaakt. Voorbeeld bekijken: weekoverzichtProef().");
}
function weekoverzichtProef() { weekoverzicht(true); }
function weekoverzicht(proef) {
  const nu = Date.now(), DAG = 86400000; const iso = (t) => encodeURIComponent(new Date(t).toISOString());
  let contacten; try { contacten = pbAdmin("/rest/v1/contacten?weekmail=eq.true&actief=eq.true&user_id=not.is.null&email=not.is.null&select=id,naam,contactpersoon,email,user_id,weekmail_laatst,taal", "get") || []; }
  catch (e) { contacten = pbAdmin("/rest/v1/contacten?weekmail=eq.true&actief=eq.true&user_id=not.is.null&email=not.is.null&select=id,naam,contactpersoon,email,user_id,weekmail_laatst", "get") || []; }   // vóór script 036 (geen kolom taal)
  if (!contacten.length) return Logger.log("Geen klanten met de weekmail aan.");
  const klantIds = pbIn("/rest/v1/profiles?role=eq.klant&active=eq.true&", "id", contacten.map(c => c.user_id), "&select=id").map(x => x.id);
  const klanten = contacten.filter(c => klantIds.indexOf(c.user_id) >= 0 && (proef || !c.weekmail_laatst || nu - new Date(c.weekmail_laatst).getTime() > 5 * DAG));
  if (!klanten.length) return Logger.log("Niemand te mailen (al gemaild deze week of geen klantlogin).");
  const pcs = pbIn("/rest/v1/project_contacten?", "contact_id", klanten.map(c => c.id), "&rol=in.(bouwheer,contactpersoon)&select=project_id,contact_id");
  const pIds = [...new Set(pcs.map(x => x.project_id))]; if (!pIds.length) return Logger.log("Geen projecten.");
  const projecten = pbIn("/rest/v1/projecten?", "id", pIds, "&status=in.(lopend,offerte,on_hold)&select=id,nummer,klant,naam,lead,fase_nr,status");
  if (!projecten.length) return Logger.log("Geen lopende projecten.");
  const pidL = projecten.map(p => p.id); const vanaf = nu - 14 * DAG;
  const fasen = pbAdmin("/rest/v1/fasen?select=nr,naam", "get") || [];
  const profs = pbAdmin("/rest/v1/profiles?select=id,name&active=eq.true", "get") || [];
  const notities = pbIn("/rest/v1/notities?", "project_id", pidL, "&klant_zichtbaar=eq.true&gedeeld_op=gt." + iso(vanaf) + "&select=project_id,titel,soort,datum,gedeeld_op");
  const wvs = pbIn("/rest/v1/werfverslagen?", "project_id", pidL, "&klant_zichtbaar=eq.true&verzonden_op=gt." + iso(vanaf) + "&select=project_id,nr,titel,datum,verzonden_op");
  const docs = (pbIn("/rest/v1/documenten?", "project_id", pidL, "&gedeeld=eq.true&gedeeld_op=gt." + iso(vanaf) + "&select=project_id,naam,pad,gedeeld_op")).filter(x => x.pad !== "Documenten/Facturen");   // facturen staan al bij "Factuur …"
  const vords = pbIn("/rest/v1/vorderingen?", "project_id", pidL, "&status=neq.opgemaakt&select=project_id,nr,soort,omschrijving,datum,factuurnummer,bedrag_excl,btw_bedrag,status,vervaldag");
  const gks = pbIn("/rest/v1/goedkeuringen?", "project_id", pidL, "&status=eq.open&select=project_id,titel,totaal_incl,geldig_tot");
  const kIds = klanten.map(c => c.id); const taken = pbIn("/rest/v1/taken?", "project_id", pidL, "&contact_id=not.is.null&status=neq.done&select=project_id,contact_id,titel,eind").filter(t => kIds.indexOf(t.contact_id) >= 0);
  let wfotos = []; try { wfotos = pbIn("/rest/v1/werf_fotos?", "project_id", pidL, "&gedeeld_klant=eq.true&gedeeld_op=gt." + iso(vanaf) + "&select=project_id,gedeeld_op"); } catch (e) { }   // script 036 (gedeeld_op = moment van delen met de klant)
  let kzOpen = []; try { kzOpen = pbIn("/rest/v1/keuzes?", "project_id", pidL, "&status=eq.open&select=project_id,onderwerp,deadline"); } catch (e) { }   // script 035
  const vandaag = Utilities.formatDate(new Date(), "Europe/Brussels", "yyyy-MM-dd");
  const d = (s) => s ? String(s).slice(8, 10) + "/" + String(s).slice(5, 7) + "/" + String(s).slice(0, 4) : "";
  const eu = (n) => "€ " + Number(n || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const na = (t, since) => t && new Date(t).getTime() > since;
  const FASE_EN = { "Ondertekenen contract": "Contract signing", "Opmeting": "Survey", "Ontwerpfase": "Design phase", "Bespreking voorontwerp": "Preliminary design review", "Definitief ontwerp": "Final design", "Ruwbouw": "Structural works", "Buitenschrijnwerk": "Exterior joinery", "Technieken": "Building services", "Bezetting": "Plastering", "Vloeren": "Flooring", "Opmeting maatwerk": "Custom joinery survey", "Installatie maatwerk": "Custom joinery installation", "Afwerking": "Finishing", "Kennismaking": "Introduction", "Voorontwerp": "Preliminary design", "Meetstaat en offerte": "Bill of quantities and quotation", "Uitvoering": "Execution", "Oplevering": "Handover" };   // fasenamen in de Engelse mail (zelfde als klant/i18n-en.js)
  const TXT = {
    nl: { beste: "Beste", week: "Je week bij BROS voor", stap: "je project zit in stap", nieuw: "Nieuw sinds de vorige keer", wacht: "Wat op je wacht", knop: "Naar je klantenportaal", voet: "Je krijgt deze samenvatting elke maandag als er iets nieuws is. Liever niet? Zet ze uit in je portaal onder Welkom › Op de hoogte blijven.", onderwerp: "Je week bij BROS", verslag: "Verslag", werfverslag: "Werfverslag", doc1: "Nieuw document", docs: "nieuwe documenten", factuur: "Factuur", incl: "incl. btw", excl: "excl. btw", akkoord: "Wacht op je akkoord", voor: "graag vóór", open: "staat open", vervallen: "vervallen sinds", tebetalen: "te betalen vóór", actie1: "Jouw actiepunt", acties: "actiepunten voor jou", tegen: "tegen", fotos: "nieuwe foto's van de werf", foto1: "nieuwe foto van de werf", keuze: "Wacht op je keuze", team: "Het team", portaal: "Portaal" },
    en: { beste: "Dear", week: "Your week with BROS for", stap: "your project is in step", nieuw: "New since last time", wacht: "Waiting for you", knop: "Go to your client portal", voet: "You receive this summary every Monday when there is something new. Prefer not to? Turn it off in your portal under Welcome › Stay informed.", onderwerp: "Your week with BROS", verslag: "Report", werfverslag: "Site report", doc1: "New document", docs: "new documents", factuur: "Invoice", incl: "incl. VAT", excl: "excl. VAT", akkoord: "Awaiting your approval", voor: "please before", open: "is open", vervallen: "overdue since", tebetalen: "due by", actie1: "Your action item", acties: "action items for you", tegen: "by", fotos: "new photos from the site", foto1: "new photo from the site", keuze: "Awaiting your choice", team: "The team", portaal: "Portal" } };
  let mails = 0; const gemaild = {};   // één mail per e-mailadres en project (ook bij twee rollen of twee contactfiches)
  let quotumOp = false;
  klanten.forEach(c => { if (quotumOp) return; let fout = false, verstuurd = false; try {
    const since = Math.max(nu - 14 * DAG, c.weekmail_laatst ? new Date(c.weekmail_laatst).getTime() : nu - 7 * DAG); const T = TXT[c.taal === "en" ? "en" : "nl"];
    [...new Set(pcs.filter(x => x.contact_id === c.id).map(x => x.project_id))].forEach(pid => {
      const p = projecten.find(y => y.id === pid); if (!p) return;
      const sleutel = String(c.email).trim().toLowerCase() + "|" + p.id; if (gemaild[sleutel]) return;
      const nieuw = [], wacht = [];
      notities.filter(n => n.project_id === p.id && na(n.gedeeld_op, since)).forEach(n => nieuw.push(T.verslag + ": " + H(n.titel || T.verslag.toLowerCase()) + (n.datum ? " (" + d(n.datum) + ")" : "")));
      wvs.filter(w => w.project_id === p.id && na(w.verzonden_op, since)).forEach(w => nieuw.push(T.werfverslag + " " + H(w.nr || "") + (w.titel ? ": " + H(w.titel) : "") + (w.datum ? " (" + d(w.datum) + ")" : "")));
      const nd = docs.filter(x2 => x2.project_id === p.id && na(x2.gedeeld_op, since)); if (nd.length) nieuw.push(nd.length === 1 ? T.doc1 + ": " + H(nd[0].naam) : nd.length + " " + T.docs + " (" + nd.slice(0, 3).map(x2 => H(x2.naam)).join(", ") + (nd.length > 3 ? ", …" : "") + ")");
      const nf = wfotos.filter(x2 => x2.project_id === p.id && na(x2.gedeeld_op, since)).length; if (nf) nieuw.push(nf + " " + (nf === 1 ? T.foto1 : T.fotos));
      const bedrag = (v) => v.btw_bedrag != null && v.bedrag_excl != null ? eu(Number(v.bedrag_excl) + Number(v.btw_bedrag)) + " " + T.incl : v.bedrag_excl != null ? eu(v.bedrag_excl) + " " + T.excl : "";
      vords.filter(v => v.project_id === p.id && v.datum && new Date(v.datum + "T23:59:59Z").getTime() > since).forEach(v => nieuw.push(T.factuur + " " + H(v.factuurnummer || v.nr) + " · " + bedrag(v)));
      gks.filter(g => g.project_id === p.id && !(g.geldig_tot && g.geldig_tot < vandaag)).forEach(g => wacht.push(T.akkoord + ": " + H(g.titel) + " · " + eu(g.totaal_incl) + " " + T.incl + (g.geldig_tot ? " — " + T.voor + " " + d(g.geldig_tot) : "")));
      kzOpen.filter(k => k.project_id === p.id).forEach(k => wacht.push(T.keuze + ": " + H(k.onderwerp) + (k.deadline ? " — " + T.voor + " " + d(k.deadline) : "")));
      vords.filter(v => v.project_id === p.id && v.status === "verzonden").forEach(v => wacht.push(T.factuur + " " + H(v.factuurnummer || v.nr) + " " + T.open + " · " + bedrag(v) + (v.vervaldag ? (v.vervaldag < vandaag ? " — <b>" + T.vervallen + " " + d(v.vervaldag) + "</b>" : " — " + T.tebetalen + " " + d(v.vervaldag)) : "")));
      const mt = taken.filter(t => t.project_id === p.id && t.contact_id === c.id); if (mt.length) wacht.push((mt.length === 1 ? T.actie1 + ": " : mt.length + " " + T.acties + ": ") + mt.slice(0, 4).map(t => H(t.titel) + (t.eind ? " (" + T.tegen + " " + d(t.eind) + ")" : "")).join(", "));
      if (!nieuw.length && !wacht.length) return;
      const proj = (p.klant || "") + (p.naam && p.naam !== p.klant ? " · " + p.naam : ""); const fase = fasen.find(f => f.nr === p.fase_nr); const lead = profs.find(u => u.id === p.lead);
      const naam = c.contactpersoon || c.naam; const lijst = (a) => "<ul style=\"padding-left:18px;margin:6px 0 16px\">" + a.map(t => "<li style=\"margin:4px 0\">" + t + "</li>").join("") + "</ul>";
      const html = "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1B1E1C;max-width:640px\"><p>" + T.beste + " " + H(naam) + ",</p>"
        + "<p>" + T.week + " <b>" + H(proj) + "</b>" + (fase && p.status === "lopend" ? " — " + T.stap + " " + fase.nr + ": " + H((T === TXT.en && FASE_EN[fase.naam]) || fase.naam) : "") + ".</p>"
        + (nieuw.length ? "<h3 style=\"font-size:15px;margin:18px 0 0\">" + T.nieuw + "</h3>" + lijst(nieuw) : "")
        + (wacht.length ? "<h3 style=\"font-size:15px;margin:18px 0 0\">" + T.wacht + "</h3>" + lijst(wacht) : "")
        + "<p style=\"margin:24px 0\"><a href=\"" + PORTAAL.URL + "\" style=\"background:#1B1E1C;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block\">" + T.knop + "</a></p>"
        + "<p>" + H(lead ? lead.name : T.team) + " — BROS</p><p style=\"color:#767D78;font-size:12px\">" + T.voet + "</p></div>";
      const tekst = T.beste + " " + naam + ",\n\n" + T.week + " " + proj + ".\n\n" + (nieuw.length ? T.nieuw + ":\n- " + nieuw.join("\n- ") + "\n\n" : "") + (wacht.length ? T.wacht + ":\n- " + wacht.join("\n- ") + "\n\n" : "") + T.portaal + ": " + PORTAAL.URL + "\n\nBROS";
      const naar = proef ? YUKI.REPORT_TO : String(c.email).trim();
      if (!mailRuimte(1)) { quotumOp = true; fout = true; return; }   // 1.48: quotum op — deze klant (en de rest) later, niet als gemaild zetten
      gemaild[sleutel] = true;
      portaalMail(naar, (proef ? "[PROEF voor " + c.email + "] " : "") + T.onderwerp + " · " + proj, tekst.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"), html); mails++; verstuurd = true;
    });
    } catch (e) { fout = true; Logger.log("Weekoverzicht " + c.email + ": " + e); }
    if (!proef && (!fout || verstuurd)) { try { pbAdmin("/rest/v1/contacten?id=eq." + c.id, "patch", { weekmail_laatst: new Date().toISOString() }); } catch (e) { Logger.log("weekmail_laatst " + c.email + ": " + e); } }   // 1.48: al iets verstuurd → als gemaild markeren (geen dubbele mails bij het inhalen)
  });
  Logger.log(mails + " weekoverzicht(en) " + (proef ? "als proef naar " + YUKI.REPORT_TO : "verstuurd") + ".");
}
/** Pdf-dossier in het portaal: één gedeeld document ophalen (pdf, afbeelding als jpg ≤2000 px, Google-document als pdf).
 *  Enkel voor een actieve klant/aannemer, enkel documenten die hij via zijn eigen view (klant_documenten / aan_documenten)
 *  mag zien, max. 25 MB, max. 150 per uur per login. */
function portaalBestand(body) {
  const wie = callerAny(body.token);
  const team = wie.role === "beheer" || wie.role === "medewerker";   // script 039: het team haalt een pdf uit de projectmap om als overeenkomst voor te leggen
  if (wie.role !== "klant" && wie.role !== "aannemer" && !team) return { ok: false, error: "Geen toegang." };
  if (!quotum("bestand:" + wie.id, 150, 3600)) return { ok: false, error: "Even geduld: te veel bestanden in korte tijd." };
  const docId = uuid(body.id);
  if (!team) {
    const view = wie.role === "klant" ? "klant_documenten" : "aan_documenten";
    const zicht = (pbReq("/rest/v1/" + view + "?id=eq." + docId + "&select=id,naam", "get", null, body.token) || [])[0];
    if (!zicht) return { ok: false, error: "Geen toegang tot dit document." };
  }
  const d = (pbAdmin("/rest/v1/documenten?id=eq." + docId + "&select=drive_id,naam", "get") || [])[0];
  if (!d || !d.drive_id) return { ok: false, error: "Document niet gevonden." };
  onderProjecten(d.drive_id);
  const token = ScriptApp.getOAuthToken(); const hdr = { Authorization: "Bearer " + token };
  const base = "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(d.drive_id);
  const meta = JSON.parse(UrlFetchApp.fetch(base + "?supportsAllDrives=true&fields=mimeType,size,thumbnailLink", { headers: hdr, muteHttpExceptions: true }).getContentText() || "{}");
  const mt = String(meta.mimeType || ""); let r;
  if (mt === "application/pdf") {
    if (Number(meta.size) > 25e6) return { ok: false, error: "Te groot voor een dossier (max. 25 MB): " + d.naam };
    r = UrlFetchApp.fetch(base + "?alt=media&supportsAllDrives=true", { headers: hdr, muteHttpExceptions: true });
  } else if (/^image\//.test(mt)) {
    if (meta.thumbnailLink) r = UrlFetchApp.fetch(String(meta.thumbnailLink).replace(/=s\d+(-[a-z]+)?$/, "=s2000"), { headers: hdr, muteHttpExceptions: true });
    if ((!r || r.getResponseCode() >= 300) && /^image\/(jpeg|png)$/.test(mt) && Number(meta.size) <= 15e6) r = UrlFetchApp.fetch(base + "?alt=media&supportsAllDrives=true", { headers: hdr, muteHttpExceptions: true });
  } else if (/^application\/vnd\.google-apps\.(document|presentation|spreadsheet|drawing)$/.test(mt)) {
    r = UrlFetchApp.fetch(base + "/export?mimeType=application%2Fpdf", { headers: hdr, muteHttpExceptions: true });
  } else return { ok: false, overslaan: true, error: "Dit bestandstype kan niet in een pdf: " + d.naam };
  if (!r || r.getResponseCode() >= 300) return { ok: false, error: "Bestand kon niet gelezen worden: " + d.naam };
  const blob = r.getBlob(); const bytes = blob.getBytes();
  if (bytes.length > 25e6) return { ok: false, error: "Te groot voor een dossier (max. 25 MB): " + d.naam };
  let mime = String(blob.getContentType() || "").split(";")[0];
  if (mt === "application/pdf" || /google-apps/.test(mt)) mime = "application/pdf";
  else if ((bytes[0] & 0xff) === 0x89 && (bytes[1] & 0xff) === 0x50) mime = "image/png"; else mime = "image/jpeg";
  return { ok: true, naam: d.naam, mime: mime, b64: Utilities.base64Encode(bytes) };
}
/** Bestand delen met de klant: "iedereen met de link mag lezen" aan- of uitzetten. */
function portaalShare(body) {
  caller(body.token, false);
  const id = String(body.fileId || ""); if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return { ok: false, error: "Geen bestand." };
  if (id === CONFIG.PROJECTEN_FOLDER_ID || id === CONFIG.SJABLOON_FOLDER_ID) return { ok: false, error: "Een map kan je niet delen." };
  onderProjecten(id);
  const token = ScriptApp.getOAuthToken(); const base = "https://www.googleapis.com/drive/v3/files/" + id;
  const meta = JSON.parse(UrlFetchApp.fetch(base + "?supportsAllDrives=true&fields=mimeType", { headers: { Authorization: "Bearer " + token }, muteHttpExceptions: true }).getContentText() || "{}");
  if (!meta.mimeType || meta.mimeType === "application/vnd.google-apps.folder") return { ok: false, error: "Een map kan je niet delen, enkel losse bestanden." };
  if (body.on) {
    const r = UrlFetchApp.fetch(base + "/permissions?supportsAllDrives=true", { method: "post", contentType: "application/json", payload: JSON.stringify({ role: "reader", type: "anyone" }), headers: { Authorization: "Bearer " + token }, muteHttpExceptions: true });
    if (r.getResponseCode() >= 300) throw new Error("Drive: " + r.getContentText().slice(0, 200));
  } else {
    const r = UrlFetchApp.fetch(base + "/permissions/anyoneWithLink?supportsAllDrives=true", { method: "delete", headers: { Authorization: "Bearer " + token }, muteHttpExceptions: true });
    if (r.getResponseCode() >= 300 && r.getResponseCode() !== 404) throw new Error("Drive: " + r.getContentText().slice(0, 200));
  }
  return { ok: true };
}

/** Eénmalig (en na elk lek) uitvoeren in de editor, nadat de scripteigenschap SERVICE_KEY gezet is:
 *  test de secret key, maakt een nieuw Drive-secret (scripteigenschap + Planbord → Instellingen → Drive) en een nieuw
 *  bot-wachtwoord (scripteigenschap + Supabase), en test de bot-login. Niets geheims komt in het Logboek.
 *  Daarna: Implementeren → Implementaties beheren → potlood → Nieuwe versie. */
function sleutelsInstellen() {
  if (!geheim("SERVICE_KEY")) throw new Error("Zet eerst de secret key van Supabase als scripteigenschap: tandwiel 'Projectinstellingen' (links) → onderaan 'Scripteigenschappen' → 'Scripteigenschap toevoegen' → naam SERVICE_KEY, waarde sb_secret_… → Opslaan. Voer daarna sleutelsInstellen opnieuw uit.");
  if (geheim("SERVICE_KEY").indexOf("sb_secret_") !== 0) Logger.log("Let op: SERVICE_KEY begint niet met sb_secret_ — is het wel de secret key?");
  pbAdmin("/rest/v1/instellingen?key=eq.app&select=key", "get");   // secret key werkt?
  Logger.log("1/3 Secret key van Supabase werkt.");
  const secret = willekeurig(); const nu = new Date().toISOString();
  const cur = (pbAdmin("/rest/v1/instellingen?key=eq.drive&select=value", "get") || [])[0];
  const value = Object.assign({}, (cur && cur.value) || {}, { secret: secret });
  if (cur) pbAdmin("/rest/v1/instellingen?key=eq.drive", "patch", { value: value, updated_at: nu });
  else pbAdmin("/rest/v1/instellingen", "post", { key: "drive", value: value, updated_at: nu });
  PropertiesService.getScriptProperties().setProperty("DRIVE_SECRET", secret); _geheimen = null;
  Logger.log("2/3 Nieuw Drive-secret bewaard in het script en in het Planbord (Instellingen → Drive)" + (value.url ? "." : " — vul daar nog de Web app-URL in."));
  botWachtwoordVernieuwen(); pbLogin();
  Logger.log("3/3 Nieuw wachtwoord voor de bot-login " + YUKI.BOT_EMAIL + " gezet en getest.\nKlaar. Nu nog: Implementeren → Implementaties beheren → potlood → Nieuwe versie → Implementeren. Wie het Planbord open heeft, herlaadt één keer.");
}
/** Nieuw wachtwoord voor de bot-login (YUKI.BOT_EMAIL): in Supabase en als scripteigenschap BOT_PASSWORD; heft een eventuele ban op.
 *  Wordt aangeroepen door sleutelsInstellen(); het wachtwoord komt nergens in beeld. */
function botWachtwoordVernieuwen() {
  const email = String(YUKI.BOT_EMAIL || "").trim().toLowerCase(); if (!email || email === "vul-in") throw new Error("YUKI.BOT_EMAIL is niet ingevuld.");
  const users = pbAdmin("/auth/v1/admin/users?page=1&per_page=1000", "get"); const lijst = (users && users.users) || users || [];
  const u = lijst.find(x => String(x.email || "").toLowerCase() === email); if (!u) throw new Error("Geen login gevonden voor " + email);
  const pw = willekeurig();
  pbAdmin("/auth/v1/admin/users/" + u.id, "put", { password: pw, ban_duration: "none" });
  PropertiesService.getScriptProperties().setProperty("BOT_PASSWORD", pw); _geheimen = null;
}
function yukiInstall() {
  GmailApp.createLabel(YUKI.LABEL); GmailApp.createLabel(YUKI.LABEL_CHECK);
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "yukiSync").forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("yukiSync").timeBased().everyHours(1).create();
  Logger.log("OK — label en uurlijkse trigger aangemaakt. Test nu met yukiSync().");
}
function yukiSync() {
  onderhoud(false);   // 1.48: hartslag — draait elk uur, ook 's nachts en in het weekend
  const label = GmailApp.getUserLabelByName(YUKI.LABEL) || GmailApp.createLabel(YUKI.LABEL);
  const labelCheck = GmailApp.getUserLabelByName(YUKI.LABEL_CHECK) || GmailApp.createLabel(YUKI.LABEL_CHECK);
  const threads = GmailApp.search(YUKI.QUERY, 0, 30);
  if (!threads.length) return Logger.log("Geen nieuwe Yuki-facturen.");
  const facturen = [], verdacht = [], t0 = Date.now();
  threads.forEach(t => t.getMessages().forEach(m => {
    if (Date.now() - t0 > 240000) return;   // 1.48: binnen de 6-minutenlimiet blijven; de rest (zonder label) volgt bij de volgende run
    // enkel mails die echt via Yuki verstuurd zijn (afzender, antwoordadres, Sender of Return-Path bij yukiworks); het onderwerp alleen volstaat niet
    const kop = [m.getFrom(), m.getReplyTo(), m.getHeader("Sender"), m.getHeader("Return-Path")].join(" ");
    if (!/yukiworks\./i.test(kop) || m.getSubject().indexOf("Factuur van BROS") < 0) { Logger.log("Overgeslagen (niet van Yuki): " + m.getFrom() + " · " + m.getSubject()); return; }
    // 1.48: "yukiworks" in een kopregel kan iedereen zelf zetten — enkel automatisch verwerken als Gmail de handtekening (DKIM/SPF/DMARC) van yukiworks bevestigde
    if (!yukiEcht(m)) { const body = m.getPlainBody() || ""; verdacht.push({ thread: t, factuurnummer: ((body.match(/Factuurnummer\s*:\s*([0-9A-Za-z\-\/]+)/) || [])[1] || "?").trim(), klant: (m.getSubject().match(/Factuur voor\s+(.+)$/) || [])[1] || m.getFrom(), totaal_incl: yukiNum((body.match(/Totaalbedrag\s*:\s*EUR\s*([0-9\.\s]+,\d{2})/) || [])[1] || "0,00"), resultaat: "te bekijken", reden: "afzender niet bevestigd door Gmail (geen geldige Yuki-handtekening) — niet automatisch verwerkt. Komt hij echt van Yuki, koppel hem dan zelf in het Planbord." }); return; }
    const f = yukiParse(m); if (f) { f.thread = t; facturen.push(f); }
  }));
  verdacht.forEach(v => v.thread.addLabel(labelCheck));
  if (!facturen.length) { if (verdacht.length) yukiRapporteer(verdacht.map(v => { const o = Object.assign({}, v); delete o.thread; return o; })); return Logger.log("Geen facturen herkend in " + threads.length + " mails."); }
  // zelfde factuur in meerdere mails (bv. doorgestuurd én via filter): één keer verwerken, alle mails labelen
  const perNr = {}; facturen.forEach(f => { (perNr[f.factuurnummer] = perNr[f.factuurnummer] || []).push(f); });
  const uniek = Object.keys(perNr).map(nr => perNr[nr][0]);
  const rapport = yukiKoppel(uniek);
  rapport.forEach(r => { const ok = r.resultaat === "gekoppeld" || r.resultaat === "al gekoppeld"; perNr[r.factuurnummer].forEach(f => f.thread.addLabel(ok ? label : labelCheck)); });
  yukiRapporteer(rapport.concat(verdacht.map(v => { const o = Object.assign({}, v); delete o.thread; return o; })));
}
/** Heeft Gmail bevestigd dat de mail echt van Yuki komt? Enkel de bovenste resultaten (door Gmail zelf toegevoegd), met een verankerd domein:
 *  - DKIM of SPF geslaagd voor (een subdomein van) yukiworks.be/.nl, of
 *  - DMARC geslaagd voor bros.be (Yuki verstuurt "namens" accounting@bros.be — enkel wie bros.be toelaat, haalt dat) samen met een yukiworks-spoor
 *    (zo komt ook een via info@bros.be doorgestuurde factuur door). */
const YUKI_DOM = "(?:[\\w-]+\\.)*yukiworks\\.(?:be|nl)(?![\\w.-])";
function yukiEcht(m) {
  let ar = "", arc = ""; try { ar = String(m.getHeader("Authentication-Results") || ""); arc = String(m.getHeader("ARC-Authentication-Results") || ""); } catch (e) { }
  const yuki = (re) => new RegExp(re.replace("YUKI", YUKI_DOM), "i");
  const direct = yuki("dkim=pass[^;]*header\\.[di]=@?YUKI").test(ar) || yuki("spf=pass[^;]*smtp\\.mailfrom=(?:[^;\\s@]*@)?YUKI").test(ar) || yuki("dmarc=pass[^;]*header\\.from=YUKI").test(ar);
  const brosDmarc = /dmarc=pass[^;]*header\.from=bros\.be(?![\w.-])/i.test(ar) && (yuki("(?:dkdomain|spfdomain|header\\.[di]|mailfrom)=@?(?:[^;\\s@]*@)?YUKI").test(ar + " " + arc));
  return direct || brosDmarc;   // (viaArc alleen volstaat niet: de samenvatting kan door een vreemde ARC-server beweerd worden)
}
/** Haalt nummer, datum, klant en bedragen uit de mail (en de pdf-bijlage als die leesbaar is). */
function yukiParse(m) {
  const body = m.getPlainBody() || ""; const subj = m.getSubject() || "";
  const nr = (body.match(/Factuurnummer\s*:\s*([0-9A-Za-z\-\/]+)/) || [])[1];
  const dat = (body.match(/Datum\s*:\s*(\d{2})-(\d{2})-(\d{4})/) || []);
  const tot = (body.match(/Totaalbedrag\s*:\s*EUR\s*([0-9\.\s]+,\d{2})/) || [])[1];
  if (!nr || !tot) return null;
  const f = { factuurnummer: nr.trim(), datum: dat.length ? dat[3] + "-" + dat[2] + "-" + dat[1] : null, totaal_incl: yukiNum(tot), klant: (subj.match(/Factuur voor\s+(.+)$/) || [])[1] || "", onderwerp: subj, mail: m.getId() };
  // betaalgegevens voor het klantenportaal (script 034): gestructureerde mededeling en vervaldag uit de mail
  f.mededeling = yukiOgm(body); f.vervaldag = yukiVervaldag(body);
  // pdf lezen via Drive (OCR/conversie naar Google Doc): klant, maatstaf, btw, omschrijvingen
  try {
    const pdf = m.getAttachments().find(a => /\.pdf$/i.test(a.getName()) && /factuur/i.test(a.getName()));
    if (pdf) f.pdfBlob = pdf.copyBlob();
    if (pdf) { const txt = yukiPdfText(pdf); if (txt) { f.pdf_tekst = txt.slice(0, 4000);
      if (!f.mededeling) f.mededeling = yukiOgm(txt); if (!f.vervaldag) f.vervaldag = yukiVervaldag(txt);
      const tot2 = txt.match(/Totaal\s+€\s*([0-9\.\s]+,\d{2})\s+€\s*([0-9\.\s]+,\d{2})\s+€\s*([0-9\.\s]+,\d{2})/);
      if (tot2) { f.excl = yukiNum(tot2[1]); f.btw = yukiNum(tot2[2]); }
      const first = txt.split("\n").map(s => s.trim()).filter(Boolean)[0]; if (first && !f.klant) f.klant = first;
      f.projectnummers = txt.match(/\b\d{6}\b/g) || []; } }
  } catch (e) { f.pdf_fout = String(e); }
  return f;
}
/** Belgische gestructureerde mededeling (+++123/4567/89012+++), enkel met een geldig controlegetal (modulo 97). */
function yukiOgm(txt) {
  const re = /(?:\+{3}|\*{3})\s*(\d{3})\s*\/\s*(\d{4})\s*\/\s*(\d{5})\s*(?:\+{3}|\*{3})/g; let m;
  while ((m = re.exec(String(txt || "")))) { const d = m[1] + m[2] + m[3]; if ((Number(d.slice(0, 10)) % 97 || 97) === Number(d.slice(10))) return "+++" + m[1] + "/" + m[2] + "/" + m[3] + "+++"; }
  return null;
}
/** Vervaldag zoals Yuki ze vermeldt (vervaldatum / te betalen voor / uiterste betaaldatum …), als jjjj-mm-dd. */
function yukiVervaldag(txt) {
  const m = String(txt || "").match(/(?:verval\s*(?:datum|dag)|uiterste\s*betaal\s*(?:datum|dag)|te\s+betalen\s+(?:voor|tegen|uiterlijk(?:\s+op)?)|betaalbaar\s+(?:voor|tegen)|due\s*date)\s*:?\s*(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/i);
  if (!m) return null; const p2 = (x) => ("0" + x).slice(-2); const iso = m[3] + "-" + p2(m[2]) + "-" + p2(m[1]);
  return isNaN(new Date(iso + "T12:00:00Z").getTime()) ? null : iso;
}
/** Factuur-pdf in de projectmap (Documenten/Facturen) zetten, delen met de klant en als document in het Planbord registreren. */
function yukiPdfBewaren(f, p, token) {
  if (!f.pdfBlob || !p || !p.drive_folder_id) return null;
  onderProjecten(p.drive_folder_id);
  const map = subfolder(DriveApp.getFolderById(p.drive_folder_id), "Documenten/Facturen");
  const naam = "Factuur " + String(f.factuurnummer).replace(/[\\\/:*?"<>|]/g, "-") + ".pdf";
  const bestaand = map.getFilesByName(naam); let file = null;
  while (bestaand.hasNext() && !file) { const x = bestaand.next(); if (!x.isTrashed()) file = x; }   // niet uit de prullenbak
  if (!file) file = map.createFile(f.pdfBlob.setName(naam));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);   // zoals "delen met klant" in Dossier
  const nu = new Date().toISOString();
  const rij = { project_id: p.id, drive_id: file.getId(), naam: naam, pad: "Documenten/Facturen", url: file.getUrl(), mime: "application/pdf", grootte: file.getSize(), gewijzigd: nu, gesynct_op: nu, gedeeld: true, gedeeld_op: nu, gemeld_klant: true };
  const r = pbReq("/rest/v1/documenten?on_conflict=project_id,drive_id", "post", rij, token, "resolution=merge-duplicates,return=representation");
  return r && r[0] ? r[0].id : null;
}
/** Betaalgegevens (mededeling, vervaldag, pdf) bewaren bij een gekoppelde vordering — los van de koppeling zelf,
 *  zodat een ontbrekend script 034 de koppeling nooit doet mislukken. Geeft een opmerking terug als iets niet lukte. */
function yukiBetaalgegevens(f, v, p, token, bedrag) {
  const extra = {}; let opm = "";
  // te betalen bedrag = het totaal op de Yuki-factuur: btw = totaal − excl (dan klopt de QR-code in het portaal op de cent)
  if (bedrag != null && f.totaal_incl != null && v.btw_bedrag == null) { const b = yukiR2(Number(f.totaal_incl) - Number(bedrag)); if (Math.abs(b) < Math.abs(Number(f.totaal_incl))) extra.btw_bedrag = b; }
  if (f.mededeling && !v.mededeling) extra.mededeling = f.mededeling;
  if (f.vervaldag && !v.vervaldag) extra.vervaldag = f.vervaldag;
  try { if (f.pdfBlob && !v.factuur_document) { const doc = yukiPdfBewaren(f, p, token); if (doc) extra.factuur_document = doc; } } catch (e) { opm += "factuur-pdf niet bewaard (" + String(e.message || e).slice(0, 120) + ") "; }
  if (Object.keys(extra).length) { try { pbReq("/rest/v1/vorderingen?id=eq." + v.id, "patch", extra, token, "return=minimal"); } catch (e) { opm += "betaalgegevens niet bewaard — is script 034 uitgevoerd? "; } }
  if (!f.mededeling && !v.mededeling) opm += "geen gestructureerde mededeling gevonden ";
  return opm.trim();
}
/** Eenmalig (editor): betaalgegevens aanvullen voor facturen die al vóór script 034 gekoppeld werden (laatste 180 dagen). */
function yukiBetaalgegevensAanvullen() {
  const token = pbLogin();
  const vorderingen = pbAll("/rest/v1/vorderingen?select=*&factuurnummer=not.is.null", token);
  const projecten = pbAll("/rest/v1/projecten?select=id,nummer,klant,drive_folder_id", token);
  const threads = GmailApp.search('subject:"Factuur van BROS" newer_than:180d', 0, 100); let n = 0;
  threads.forEach(t => t.getMessages().forEach(m => {
    const kop = [m.getFrom(), m.getReplyTo(), m.getHeader("Sender"), m.getHeader("Return-Path")].join(" ");
    if (!/yukiworks\./i.test(kop)) return;
    const f = yukiParse(m); if (!f) return;
    const v = vorderingen.find(x => String(x.factuurnummer).trim() === f.factuurnummer); if (!v || (v.mededeling && v.vervaldag && v.factuur_document)) return;
    const opm = yukiBetaalgegevens(f, v, projecten.find(p => p.id === v.project_id), token); n++;
    Object.assign(v, { mededeling: v.mededeling || f.mededeling, vervaldag: v.vervaldag || f.vervaldag, factuur_document: v.factuur_document || "x" });
    Logger.log("Factuur " + f.factuurnummer + ": " + (opm || "aangevuld"));
  }));
  Logger.log(n + " factuur/facturen aangevuld.");
}
function yukiNum(s) { return Number(String(s).replace(/[\s\.]/g, "").replace(",", ".")); }
/** Pdf → tekst: uploaden als Google Doc (conversie + OCR), exporteren als tekst, weer verwijderen. */
function yukiPdfText(blob) {
  const token = ScriptApp.getOAuthToken(); const boundary = "planbord" + Date.now();
  const meta = JSON.stringify({ name: "tmp-" + blob.getName(), mimeType: "application/vnd.google-apps.document" });
  const body = Utilities.newBlob("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + meta + "\r\n--" + boundary + "\r\nContent-Type: application/pdf\r\n\r\n").getBytes()
    .concat(blob.getBytes()).concat(Utilities.newBlob("\r\n--" + boundary + "--").getBytes());
  const up = UrlFetchApp.fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&ocrLanguage=nl", { method: "post", contentType: "multipart/related; boundary=" + boundary, payload: body, headers: { Authorization: "Bearer " + token }, muteHttpExceptions: true });
  const j = JSON.parse(up.getContentText()); if (!j.id) throw new Error("pdf-conversie: " + up.getContentText().slice(0, 200));
  try { const ex = UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/files/" + j.id + "/export?mimeType=text/plain", { headers: { Authorization: "Bearer " + token }, muteHttpExceptions: true }); return ex.getContentText(); }
  finally { UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/files/" + j.id, { method: "delete", headers: { Authorization: "Bearer " + token }, muteHttpExceptions: true }); }
}
/* ---- Planbord-database (Supabase REST) ---- */
function pbReq(path, method, body, token, prefer) {
  const headers = { apikey: YUKI.PLANBORD_KEY }; if (token) headers.Authorization = "Bearer " + token; else if (YUKI.PLANBORD_KEY.indexOf("sb_") !== 0) headers.Authorization = "Bearer " + YUKI.PLANBORD_KEY;
  const opt = { method: method || "get", contentType: "application/json", headers: headers, muteHttpExceptions: true };
  if (prefer) opt.headers.Prefer = prefer; if (body) opt.payload = JSON.stringify(body);
  const r = UrlFetchApp.fetch(YUKI.PLANBORD_URL + path, opt); const t = r.getContentText();
  if (r.getResponseCode() >= 300) throw new Error("Planbord " + r.getResponseCode() + ": " + t.slice(0, 200));
  return t ? JSON.parse(t) : null;
}
/* alles ophalen, per 1000 rijen en in een vaste volgorde (de databank geeft max. 1000 rijen per aanvraag) */
function pbAll(path, token, orde) {
  let all = []; const sep = path.indexOf("?") >= 0 ? "&" : "?";
  for (let off = 0; ; off += 1000) {
    const d = pbReq(path + sep + "order=" + (orde || "id") + ".asc&limit=1000&offset=" + off, "get", null, token) || [];
    all = all.concat(d); if (d.length < 1000) return all;
  }
}
function pbLogin() { return pbReq("/auth/v1/token?grant_type=password", "post", { email: YUKI.BOT_EMAIL, password: YUKI.BOT_PASSWORD }).access_token; }
function yukiNorm(s) { return String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\b(bv|bvba|nv|vof|cv|srl|sa|invest|group)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim(); }
/* dezelfde rekenregels als app.js (vordCalc) */
function yukiR2(n) { const v = Number(n) || 0; return (v < 0 ? -1 : 1) * Math.round(Number((Math.abs(v) * 100).toFixed(6))) / 100; }
function yukiCalc(v, rows, regels, loten) {
  const mw = v.soort === "meerwerk"; const lotRg = {}, postRg = {};
  regels.filter(r => r.vordering_id === v.id).forEach(r => { if (r.post_id) postRg[r.post_id] = Number(r.pct); else lotRg[r.lot] = Number(r.pct); });
  let excl = 0, btw = 0;
  rows.forEach(r => { if (r.project_id !== v.project_id || r.status === "vervallen") return; if ((r.status === "meerwerk" || r.status === "minwerk") !== mw) return;
    const pct = postRg[r.id] != null ? postRg[r.id] : lotRg[r.lot]; if (pct == null) return;
    // verkoopprijs: sinds script 012 berekend in de view (verkoop_ep); daarvoor kostprijs × (1 + marge)
    // op de cent afgerond zoals het Planbord en het klantenportaal; minwerk altijd negatief
    const marge = r.marge != null && r.marge !== "" ? Number(r.marge) : Number((loten[r.lot] || {}).marge) || 0;
    const ep = yukiR2(r.verkoop_ep != null ? Number(r.verkoop_ep) : Number(r.eenheidsprijs || 0) * (1 + marge));
    const tot = yukiR2(Number(r.hoeveelheid || 0) * ep);
    const a = pct * (r.status === "minwerk" ? -Math.abs(tot) : tot);
    excl += a; btw += a * (Number(r.btw) || 0); });
  return { excl: Math.round(excl * 100) / 100, btw: Math.round(btw * 100) / 100, incl: Math.round((excl + btw) * 100) / 100 };
}
function yukiKoppel(facturen) {
  const token = pbLogin();
  const projecten = pbAll("/rest/v1/projecten?select=id,nummer,klant,naam,bedrijf,status,drive_folder_id", token);
  const vorderingen = pbAll("/rest/v1/vorderingen?select=*", token);
  const regels = pbAll("/rest/v1/vordering_regels?select=*", token);
  let rows, loten = {};
  try { rows = pbAll("/rest/v1/meetstaat_posten_v?select=id,project_id,lot,status,hoeveelheid,verkoop_ep,btw", token); }
  catch (e) { rows = pbAll("/rest/v1/meetstaat_posten?select=id,project_id,lot,status,hoeveelheid,eenheidsprijs,marge,btw", token); pbAll("/rest/v1/loten?select=nr,marge", token, "nr").forEach(l => loten[l.nr] = l); }
  const calcMemo = {}; const calcOf = (v) => calcMemo[v.id] || (calcMemo[v.id] = yukiCalc(v, rows, regels, loten));   // 1.48: enkel berekenen wat nodig is
  const bestaand = {}; vorderingen.forEach(v => { if (v.factuurnummer) bestaand[String(v.factuurnummer).trim()] = v; });
  const TOL = YUKI.TOL; const rapport = [];
  facturen.forEach(f => {
    const nr = f.factuurnummer, incl = f.totaal_incl; const out = Object.assign({}, f); delete out.pdfBlob;
    if (bestaand[nr]) { out.resultaat = "al gekoppeld";
      // factuurnummer stond er al (manueel ingevuld): de betaalgegevens wel nog aanvullen
      const bv = bestaand[nr]; if (bv.id && (!bv.mededeling || !bv.vervaldag || !bv.factuur_document)) { try { yukiBetaalgegevens(f, bv, projecten.find(x => x.id === bv.project_id) || {}, token, bv.bedrag_excl); } catch (e) { } }
      rapport.push(out); return; }
    let proj = null; const pn = (f.projectnummers || []).concat((f.klant + " " + f.onderwerp).match(/\b\d{6}\b/g) || []).find(n => projecten.some(p => p.nummer === n));
    if (pn) proj = projecten.find(p => p.nummer === pn) || null;
    if (!proj) { const k = yukiNorm(f.klant); const kand = projecten.filter(p => k && [p.klant, p.bedrijf, p.naam].map(yukiNorm).some(n => n && (k.indexOf(n) >= 0 || n.indexOf(k) >= 0)));
      if (kand.length === 1) proj = kand[0];
      else if (kand.length > 1) { const fit = kand.filter(p => vorderingen.some(v => v.project_id === p.id && v.status === "opgemaakt" && Math.abs(calcOf(v).incl - incl) <= TOL)); if (fit.length === 1) proj = fit[0]; else { out.resultaat = "twijfel"; out.reden = "meerdere projecten passen: " + kand.map(p => p.klant).join(", "); rapport.push(out); return; } } }
    const kandV = vorderingen.filter(v => v.status === "opgemaakt" && (!proj || v.project_id === proj.id) && Math.abs(calcOf(v).incl) > TOL);   // 1.48: nooit een lege vordering (€ 0) koppelen
    let v = null, opm = "";
    const exact = kandV.filter(x => Math.abs(calcOf(x).incl - incl) <= TOL);
    if (exact.length === 1) v = exact[0];
    else if (!exact.length && f.excl != null) { const e2 = kandV.filter(x => Math.abs(calcOf(x).excl - f.excl) <= TOL); if (e2.length === 1) v = e2[0]; }
    // geen automatische koppeling meer bij een afwijkend bedrag (veiligheid: een vervalste mail kan zo niets wijzigen) — wel melden
    if (!v) { out.resultaat = "niet gevonden"; out.project = proj ? proj.klant : null; out.reden = proj ? (kandV.length === 1 ? "bedrag wijkt af van de openstaande vordering (berekend " + calcOf(kandV[0]).incl.toFixed(2) + " incl.) — koppel ze zelf in het Planbord" : "geen openstaande vordering met dit bedrag") : "project niet herkend"; rapport.push(out); return; }
    const c = calcOf(v);
    const bedrag = f.excl != null ? f.excl : (Math.abs(c.incl - incl) <= TOL ? c.excl : Math.round(incl / (1 + (c.excl ? c.btw / c.excl : 0.06)) * 100) / 100);
    const patch = { factuurnummer: nr, datum: f.datum || v.datum, bedrag_excl: bedrag, status: "verzonden" };
    if (opm) patch.opmerking = ((v.opmerking || "") + " " + opm).trim();
    pbReq("/rest/v1/vorderingen?id=eq." + v.id, "patch", patch, token, "return=minimal");
    Object.assign(v, patch); bestaand[nr] = v;
    const p = projecten.find(x => x.id === v.project_id) || {};
    const betaal = yukiBetaalgegevens(f, v, p, token, bedrag); if (betaal) opm = (opm ? opm + "; " : "") + betaal;
    Object.assign(out, { resultaat: "gekoppeld", project: p.klant, projectnummer: p.nummer, vordering_nr: v.nr, vordering_soort: v.soort, berekend_incl: c.incl, bedrag_excl: bedrag, opmerking: opm });
    rapport.push(out);
  });
  return rapport;
}
function yukiRapporteer(rapport) {
  const lijn = r => "• Factuur " + r.factuurnummer + " (" + (r.klant || "?") + ", € " + (r.totaal_incl || 0).toFixed(2) + " incl.): " + r.resultaat +
    (r.resultaat === "gekoppeld" ? " → " + r.project + " (" + r.projectnummer + "), " + (r.vordering_nr === 0 ? "voorschot" : r.vordering_soort + " #" + r.vordering_nr) + ", bedrag excl. € " + r.bedrag_excl.toFixed(2) + (r.opmerking ? " — LET OP: " + r.opmerking : "") : r.reden ? " — " + r.reden : "") + (r.pdf_fout ? " (pdf niet gelezen)" : "");
  const nieuw = rapport.filter(r => r.resultaat !== "al gekoppeld"); if (!nieuw.length) return;
  const txt = "Yuki-facturen verwerkt in het Planbord:\n\n" + nieuw.map(lijn).join("\n") + "\n\nNiet-gekoppelde facturen koppel je manueel (projectfiche → Facturatie → factuurnummer en bedrag bij de juiste vordering), of je maakt eerst de vordering aan en haalt in Gmail het label \"Planbord/te bekijken\" van de mail — dan probeert het script het volgende uur opnieuw.";
  GmailApp.sendEmail(YUKI.REPORT_TO, "Planbord: " + nieuw.filter(r => r.resultaat === "gekoppeld").length + " factuur/facturen gekoppeld" + (nieuw.some(r => r.resultaat !== "gekoppeld") ? " — " + nieuw.filter(r => r.resultaat !== "gekoppeld").length + " te bekijken" : ""), txt);
  Logger.log(txt);
}

/** Eenmalig uitvoeren vanuit de editor (Uitvoeren ▷) om alle rechten te verlenen: Drive én de Drive-API. */
function autoriseer() {
  DriveApp.getRootFolder().getName();
  GmailApp.getInboxUnreadCount();        // Gmail-recht voor de Yuki-koppeling
  const r = UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/about?fields=user", { headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() } });
  Logger.log("OK — rechten in orde voor " + JSON.parse(r.getContentText()).user.emailAddress);
}
