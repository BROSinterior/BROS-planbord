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
    if (body.action === "template") return json(getTemplate(String(body.match || "MEETSTAAT")));
    if (body.action === "put") return json(putFile(body));
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

/* ---- Sjabloonbestand ophalen en een bestand in de projectmap wegschrijven (voor de meetstaat-export) ---- */
/** Zoekt in A SJABLOON het Excel-bestand waarvan de naam `match` bevat en geeft het terug als base64. */
function getTemplate(match) {
  const files = listFiles(CONFIG.SJABLOON_FOLDER_ID, "").filter(f => f.name.toUpperCase().indexOf(match.toUpperCase()) >= 0 && /\.xlsx$/i.test(f.name) && f.name.indexOf("~$") !== 0);
  if (!files.length) return { ok: false, error: "Geen sjabloon gevonden met \"" + match + "\" in de naam (map A SJABLOON)." };
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
  let name = String(body.name || "bestand.xlsx"); const base = name.replace(/\.xlsx$/i, ""); let k = 2;
  while (folder.getFilesByName(name).hasNext()) { name = base + " (" + (k++) + ").xlsx"; }
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
  BOT_PASSWORD: "VUL-IN",
  REPORT_TO: "info@bros.be",       // samenvatting na elke run met resultaat
  QUERY: 'subject:"Factuur van BROS" newer_than:60d -label:planbord-verwerkt',   // Yuki verstuurt "namens" accounting@bros.be via yukiworks.be
  LABEL: "Planbord/verwerkt",
  TOL: 1.0,                        // toegelaten verschil in euro tussen factuur en berekend bedrag
};
function yukiInstall() {
  GmailApp.createLabel(YUKI.LABEL);
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "yukiSync").forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("yukiSync").timeBased().everyHours(1).create();
  Logger.log("OK — label en uurlijkse trigger aangemaakt. Test nu met yukiSync().");
}
function yukiSync() {
  const label = GmailApp.getUserLabelByName(YUKI.LABEL) || GmailApp.createLabel(YUKI.LABEL);
  const threads = GmailApp.search(YUKI.QUERY, 0, 30);
  if (!threads.length) return Logger.log("Geen nieuwe Yuki-facturen.");
  const facturen = [];
  threads.forEach(t => t.getMessages().forEach(m => {
    if (m.getFrom().indexOf("yukiworks") < 0 && m.getReplyTo().indexOf("yukiworks") < 0 && m.getSubject().indexOf("Factuur van BROS") < 0) return;
    const f = yukiParse(m); if (f) { f.thread = t; facturen.push(f); }
  }));
  if (!facturen.length) return Logger.log("Geen facturen herkend in " + threads.length + " mails.");
  const rapport = yukiKoppel(facturen);
  rapport.forEach(r => { if (r.resultaat === "gekoppeld" || r.resultaat === "al gekoppeld") r.thread.addLabel(label); });
  yukiRapporteer(rapport);
}
/** Haalt nummer, datum, klant en bedragen uit de mail (en de pdf-bijlage als die leesbaar is). */
function yukiParse(m) {
  const body = m.getPlainBody() || ""; const subj = m.getSubject() || "";
  const nr = (body.match(/Factuurnummer\s*:\s*([0-9A-Za-z\-\/]+)/) || [])[1];
  const dat = (body.match(/Datum\s*:\s*(\d{2})-(\d{2})-(\d{4})/) || []);
  const tot = (body.match(/Totaalbedrag\s*:\s*EUR\s*([0-9\.\s]+,\d{2})/) || [])[1];
  if (!nr || !tot) return null;
  const f = { factuurnummer: nr.trim(), datum: dat.length ? dat[3] + "-" + dat[2] + "-" + dat[1] : null, totaal_incl: yukiNum(tot), klant: (subj.match(/Factuur voor\s+(.+)$/) || [])[1] || "", onderwerp: subj, mail: m.getId() };
  // pdf lezen via Drive (OCR/conversie naar Google Doc): klant, maatstaf, btw, omschrijvingen
  try {
    const pdf = m.getAttachments().find(a => /\.pdf$/i.test(a.getName()) && /factuur/i.test(a.getName()));
    if (pdf) { const txt = yukiPdfText(pdf); if (txt) { f.pdf_tekst = txt.slice(0, 4000);
      const tot2 = txt.match(/Totaal\s+€\s*([0-9\.\s]+,\d{2})\s+€\s*([0-9\.\s]+,\d{2})\s+€\s*([0-9\.\s]+,\d{2})/);
      if (tot2) { f.excl = yukiNum(tot2[1]); f.btw = yukiNum(tot2[2]); }
      const first = txt.split("\n").map(s => s.trim()).filter(Boolean)[0]; if (first && !f.klant) f.klant = first;
      const pn = txt.match(/\b(2[5-9]\d{4})\b/); if (pn) f.projectnummer = pn[1]; } }
  } catch (e) { f.pdf_fout = String(e); }
  return f;
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
  const opt = { method: method || "get", contentType: "application/json", headers: { apikey: YUKI.PLANBORD_KEY, Authorization: "Bearer " + (token || YUKI.PLANBORD_KEY) }, muteHttpExceptions: true };
  if (prefer) opt.headers.Prefer = prefer; if (body) opt.payload = JSON.stringify(body);
  const r = UrlFetchApp.fetch(YUKI.PLANBORD_URL + path, opt); const t = r.getContentText();
  if (r.getResponseCode() >= 300) throw new Error("Planbord " + r.getResponseCode() + ": " + t.slice(0, 200));
  return t ? JSON.parse(t) : null;
}
function pbLogin() { return pbReq("/auth/v1/token?grant_type=password", "post", { email: YUKI.BOT_EMAIL, password: YUKI.BOT_PASSWORD }).access_token; }
function yukiNorm(s) { return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\b(bv|bvba|nv|vof|cv|srl|sa|invest|group)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim(); }
/* dezelfde rekenregels als app.js (vordCalc) */
function yukiCalc(v, rows, regels, loten) {
  const mw = v.soort === "meerwerk"; const lotRg = {}, postRg = {};
  regels.filter(r => r.vordering_id === v.id).forEach(r => { if (r.post_id) postRg[r.post_id] = Number(r.pct); else lotRg[r.lot] = Number(r.pct); });
  let excl = 0, btw = 0;
  rows.forEach(r => { if (r.project_id !== v.project_id || r.status === "vervallen") return; if ((r.status === "meerwerk" || r.status === "minwerk") !== mw) return;
    const pct = postRg[r.id] != null ? postRg[r.id] : lotRg[r.lot]; if (pct == null) return;
    const marge = r.marge != null && r.marge !== "" ? Number(r.marge) : Number((loten[r.lot] || {}).marge) || 0;
    const a = pct * Number(r.hoeveelheid || 0) * Number(r.eenheidsprijs || 0) * (1 + marge) * (r.status === "minwerk" ? -1 : 1);
    excl += a; btw += a * (Number(r.btw) || 0); });
  return { excl: Math.round(excl * 100) / 100, btw: Math.round(btw * 100) / 100, incl: Math.round((excl + btw) * 100) / 100 };
}
function yukiKoppel(facturen) {
  const token = pbLogin();
  const projecten = pbReq("/rest/v1/projecten?select=id,nummer,klant,naam,bedrijf,status", "get", null, token);
  const vorderingen = pbReq("/rest/v1/vorderingen?select=*", "get", null, token);
  const regels = pbReq("/rest/v1/vordering_regels?select=*", "get", null, token);
  const rows = pbReq("/rest/v1/meetstaat_posten?select=id,project_id,lot,status,hoeveelheid,eenheidsprijs,marge,btw", "get", null, token);
  const loten = {}; pbReq("/rest/v1/loten?select=nr,marge", "get", null, token).forEach(l => loten[l.nr] = l);
  const calc = {}; vorderingen.forEach(v => calc[v.id] = yukiCalc(v, rows, regels, loten));
  const bestaand = {}; vorderingen.forEach(v => { if (v.factuurnummer) bestaand[String(v.factuurnummer).trim()] = v; });
  const TOL = YUKI.TOL; const rapport = [];
  facturen.forEach(f => {
    const nr = f.factuurnummer, incl = f.totaal_incl; const out = Object.assign({}, f);
    if (bestaand[nr]) { out.resultaat = "al gekoppeld"; rapport.push(out); return; }
    let proj = null; const pn = f.projectnummer || ((f.klant + " " + f.onderwerp).match(/\b(2[5-9]\d{4})\b/) || [])[1];
    if (pn) proj = projecten.find(p => p.nummer === pn) || null;
    if (!proj) { const k = yukiNorm(f.klant); const kand = projecten.filter(p => k && [p.klant, p.bedrijf, p.naam].map(yukiNorm).some(n => n && (k.indexOf(n) >= 0 || n.indexOf(k) >= 0)));
      if (kand.length === 1) proj = kand[0];
      else if (kand.length > 1) { const fit = kand.filter(p => vorderingen.some(v => v.project_id === p.id && v.status === "opgemaakt" && Math.abs(calc[v.id].incl - incl) <= TOL)); if (fit.length === 1) proj = fit[0]; else { out.resultaat = "twijfel"; out.reden = "meerdere projecten passen: " + kand.map(p => p.klant).join(", "); rapport.push(out); return; } } }
    const kandV = vorderingen.filter(v => v.status === "opgemaakt" && (!proj || v.project_id === proj.id));
    let v = null, opm = "";
    const exact = kandV.filter(x => Math.abs(calc[x.id].incl - incl) <= TOL);
    if (exact.length === 1) v = exact[0];
    else if (!exact.length && f.excl != null) { const e2 = kandV.filter(x => Math.abs(calc[x.id].excl - f.excl) <= TOL); if (e2.length === 1) v = e2[0]; }
    if (!v && proj && kandV.length === 1) { v = kandV[0]; opm = "verschil: berekend " + calc[v.id].incl.toFixed(2) + " incl. vs factuur " + incl.toFixed(2); }
    if (!v) { out.resultaat = "niet gevonden"; out.project = proj ? proj.klant : null; out.reden = proj ? "geen openstaande vordering met dit bedrag" : "project niet herkend"; rapport.push(out); return; }
    const c = calc[v.id];
    const bedrag = f.excl != null ? f.excl : (Math.abs(c.incl - incl) <= TOL ? c.excl : Math.round(incl / (1 + (c.excl ? c.btw / c.excl : 0.06)) * 100) / 100);
    const patch = { factuurnummer: nr, datum: f.datum || v.datum, bedrag_excl: bedrag, status: "verzonden" };
    if (opm) patch.opmerking = ((v.opmerking || "") + " " + opm).trim();
    pbReq("/rest/v1/vorderingen?id=eq." + v.id, "patch", patch, token, "return=minimal");
    Object.assign(v, patch); bestaand[nr] = v;
    const p = projecten.find(x => x.id === v.project_id) || {};
    Object.assign(out, { resultaat: "gekoppeld", project: p.klant, projectnummer: p.nummer, vordering_nr: v.nr, vordering_soort: v.soort, berekend_incl: c.incl, bedrag_excl: bedrag, opmerking: opm });
    rapport.push(out);
  });
  return rapport;
}
function yukiRapporteer(rapport) {
  const lijn = r => "• Factuur " + r.factuurnummer + " (" + (r.klant || "?") + ", € " + (r.totaal_incl || 0).toFixed(2) + " incl.): " + r.resultaat +
    (r.resultaat === "gekoppeld" ? " → " + r.project + " (" + r.projectnummer + "), " + (r.vordering_nr === 0 ? "voorschot" : r.vordering_soort + " #" + r.vordering_nr) + ", bedrag excl. € " + r.bedrag_excl.toFixed(2) + (r.opmerking ? " — LET OP: " + r.opmerking : "") : r.reden ? " — " + r.reden : "") + (r.pdf_fout ? " (pdf niet gelezen)" : "");
  const nieuw = rapport.filter(r => r.resultaat !== "al gekoppeld"); if (!nieuw.length) return;
  const txt = "Yuki-facturen verwerkt in het Planbord:\n\n" + nieuw.map(lijn).join("\n") + "\n\nNiet-gekoppelde facturen koppel je manueel: projectfiche → Facturatie → factuurnummer en bedrag invullen bij de juiste vordering.";
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
