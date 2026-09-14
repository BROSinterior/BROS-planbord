/**
 * BROS Planbord — Drive-script (Google Apps Script)
 * Draait als brosburo@gmail.com en maakt/koppelt projectmappen in BROS/PROJECTEN.
 *
 * Installatie (eenmalig):
 *  1. Log in als brosburo@gmail.com op https://script.google.com → Nieuw project → plak dit bestand.
 *  2. Vul CONFIG in: een zelfgekozen SECRET, en de map-ID's (het deel van de URL na /folders/).
 *  3. Deploy → New deployment → type "Web app" → Execute as: Me → Who has access: Anyone → Deploy.
 *     Kopieer de "Web app URL" en zet die samen met de SECRET in het Planbord onder Instellingen → Drive.
 *  Bij een latere wijziging aan dit script: Deploy → Manage deployments → potlood → Version: New → Deploy.
 */
const CONFIG = {
  SECRET: "VUL-IN",                 // zelf kiezen, bv. een lange willekeurige tekst
  PROJECTEN_FOLDER_ID: "VUL-IN",    // map BROS/PROJECTEN
  SJABLOON_FOLDER_ID: "VUL-IN",     // map BROS/PROJECTEN/A SJABLOON
};

function doPost(e) {
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || "{}");
    if (!body.secret || body.secret !== CONFIG.SECRET) return json({ ok: false, error: "Geen toegang (secret klopt niet)." });
    if (body.action === "ping") return json({ ok: true, info: "Verbinding en secret in orde.", projecten: DriveApp.getFolderById(CONFIG.PROJECTEN_FOLDER_ID).getName(), sjabloon: DriveApp.getFolderById(CONFIG.SJABLOON_FOLDER_ID).getName() });
    if (body.action === "create") return json(createOrLink(String(body.klant || "").trim(), true));
    if (body.action === "link") return json(createOrLink(String(body.klant || "").trim(), false));
    if (body.action === "list") return json(listById(String(body.folderId || "")));
    return json({ ok: false, error: "Onbekende actie." });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}
function doGet() { return json({ ok: true, info: "BROS Planbord Drive-script actief." }); }
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/** Maakt de projectmap aan uit het sjabloon (create=true) of koppelt een bestaande map met die naam. */
function createOrLink(klant, create) {
  if (!klant) return { ok: false, error: "Geen klantnaam." };
  const existing = driveQuery("mimeType='application/vnd.google-apps.folder' and trashed=false and '" + CONFIG.PROJECTEN_FOLDER_ID + "' in parents and name='" + klant.replace(/'/g, "\\'") + "'", "id,name,webViewLink");
  if (existing.length) { const f = existing[0]; return { ok: true, created: false, folder: { id: f.id, url: f.webViewLink, name: f.name }, files: listFiles(f.id, "") }; }
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
  return { ok: true, folder: { id: f.id, url: f.webViewLink, name: f.name }, files: listFiles(f.id, "") };
}

/* ---- Snel oplijsten via de Drive REST API (DriveApp is te traag per map) ---- */
const MAX_FILES = 800;
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
function listFiles(rootId, path) {
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
    if (allIds.length > 300) break;
  }
  // bestanden van alle mappen (foto's en video's overslaan; die blijven in Drive)
  let out = [];
  chunks(allIds, 20).forEach(ids => {
    if (out.length >= MAX_FILES) return;
    const q = "mimeType!='application/vnd.google-apps.folder' and trashed=false and not mimeType contains 'image/' and not mimeType contains 'video/' and (" + ids.map(i => "'" + i + "' in parents").join(" or ") + ")";
    driveQuery(q, "id,name,mimeType,size,modifiedTime,webViewLink,parents").forEach(f => {
      if (f.name.indexOf("~$") === 0 || f.name.indexOf("._") === 0 || f.name.indexOf("Icon") === 0 || f.name === ".DS_Store") return;
      const parent = (f.parents || []).find(p => paths[p] !== undefined);
      out.push({ id: f.id, name: f.name, path: parent !== undefined ? paths[parent] : "", url: f.webViewLink, mime: f.mimeType, size: Number(f.size) || 0, updated: f.modifiedTime });
    });
  });
  return out.slice(0, MAX_FILES);
}

/** Eenmalig uitvoeren vanuit de editor (Uitvoeren ▷) om alle rechten te verlenen: Drive én de Drive-API. */
function autoriseer() {
  DriveApp.getRootFolder().getName();
  const r = UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/about?fields=user", { headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() } });
  Logger.log("OK — rechten in orde voor " + JSON.parse(r.getContentText()).user.emailAddress);
}
