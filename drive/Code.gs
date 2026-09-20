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
    if (body.action === "reset") return json(portaalReset(body));   // klantenportaal: "wachtwoord vergeten" — bewust zonder secret, stuurt enkel een mail naar een bestaande klantlogin
    if (body.action === "gkmail") return json(goedkeuringMail(body)); // portaal (klant beslist) én Planbord: identiteit en rol via het meegestuurde login-token
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
    return json({ ok: false, error: "Onbekende actie." });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}
function doGet() { return json({ ok: true, info: "BROS Planbord Drive-script actief." }); }
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
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
  QUERY: 'subject:"Factuur van BROS" newer_than:60d -label:planbord-verwerkt -label:planbord-te-bekijken',   // Yuki verstuurt "namens" accounting@bros.be via yukiworks.be
  LABEL: "Planbord/verwerkt",
  LABEL_CHECK: "Planbord/te bekijken",   // niet gekoppeld: één keer gemeld; label weghalen in Gmail = opnieuw proberen
  TOL: 1.0,                        // toegelaten verschil in euro tussen factuur en berekend bedrag
};
/* =====================================================================
   Klantenportaal — uitnodigen en bestanden delen (vanuit het Planbord, actie "invite" en "share")
   Vereist PORTAAL.SERVICE_KEY: Supabase → Project Settings → API → service_role (secret). Die sleutel mag
   ALLEEN hier staan (Code.ingevuld.gs, buiten git) — nooit in de app of in config.js.
   De uitnodigingsmail vertrekt uit de Gmail van het script (brosburo@gmail.com), zodat er geen SMTP-instelling nodig is.
   ===================================================================== */
const PORTAAL = {
  SERVICE_KEY: "VUL-IN",
  URL: "https://brosinterior.github.io/BROS-planbord/klant/",   // ook toevoegen bij Supabase → Authentication → URL Configuration → Redirect URLs
  AFZENDER: "BROS",
  VAN: "archief@bros.be",   // afzender van de mails naar klanten — moet in Gmail van brosburo@gmail.com ingesteld staan als "E-mail verzenden als"-alias; anders vertrekt de mail van brosburo met dit adres als antwoordadres
  ONDERWERP: "Welkom in je BROS-klantenportaal",
};
/** Mail naar de klant: vanuit PORTAAL.VAN als dat een Gmail-alias is, anders vanuit het scriptaccount met PORTAAL.VAN als reply-to. */
function portaalMail(to, subject, text, html) {
  const opt = { htmlBody: html, name: PORTAAL.AFZENDER };
  if (PORTAAL.VAN) { const aliases = GmailApp.getAliases(); if (aliases.indexOf(PORTAAL.VAN) >= 0) opt.from = PORTAAL.VAN; else opt.replyTo = PORTAAL.VAN; }
  GmailApp.sendEmail(to, subject, text, opt);
}
/** Controle: welke afzenders kan dit account gebruiken? (Uitvoeren in de editor → Logboek.) */
function portaalAliassen() { Logger.log("Aliassen van " + Session.getActiveUser().getEmail() + ": " + JSON.stringify(GmailApp.getAliases()) + " — PORTAAL.VAN = " + PORTAAL.VAN); }
function pbAdmin(path, method, body) {
  if (!PORTAAL.SERVICE_KEY || PORTAAL.SERVICE_KEY === "VUL-IN") throw new Error("PORTAAL.SERVICE_KEY is niet ingevuld in het Drive-script.");
  const opt = { method: method || "get", contentType: "application/json", headers: { apikey: PORTAAL.SERVICE_KEY, Authorization: "Bearer " + PORTAAL.SERVICE_KEY }, muteHttpExceptions: true };
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
function portaalInvite(body) {
  const wie = caller(body.token, true);
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Geen geldig e-mailadres: " + email };
  const naam = String(body.naam || "").trim(); const contactId = String(body.contact_id || "");
  let j, bestaand = false;
  try { j = pbAdmin("/auth/v1/admin/generate_link", "post", { type: "invite", email: email, data: { name: naam, rol: "klant", contact_id: contactId }, redirect_to: PORTAAL.URL }); }
  catch (e) {
    if (!/already|exists|registered|duplicate/i.test(String(e))) throw e;
    bestaand = true;
    j = pbAdmin("/auth/v1/admin/generate_link", "post", { type: "recovery", email: email, redirect_to: PORTAAL.URL });
  }
  const link = j.action_link || (j.properties && j.properties.action_link); const userId = j.id || (j.user && j.user.id);
  if (!link) throw new Error("Geen uitnodigingslink gekregen van Supabase.");
  if (bestaand && userId) {
    const prof = pbAdmin("/rest/v1/profiles?id=eq." + userId + "&select=role", "get");
    if (prof && prof[0] && prof[0].role !== "klant") return { ok: false, error: "Dit e-mailadres hoort bij een teamlid van het Planbord; een klant heeft een ander adres nodig." };
  }
  if (contactId && userId) pbAdmin("/rest/v1/contacten?id=eq." + contactId, "patch", { user_id: userId, portaal_sinds: new Date().toISOString() });
  const aanhef = naam ? "Beste " + naam : "Beste";
  const tekst = aanhef + ",\n\nWelkom in je persoonlijke BROS-klantenportaal. Daar volg je je project op de voet: de meetstaat, de facturatie, de planning en de documenten die we met je delen.\n\nKies je wachtwoord via deze link:\n" + link + "\n\nDaarna log je altijd in op " + PORTAAL.URL + " met je e-mailadres en wachtwoord.\nDe link hierboven is beperkt geldig; is hij vervallen, klik dan op het portaal op \"Wachtwoord vergeten\" en je krijgt een nieuwe.\n\nTot snel,\n" + wie.name + " — BROS";
  const html = "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1B1E1C\"><p>" + aanhef + ",</p><p>Welkom in je persoonlijke <b>BROS-klantenportaal</b>. Daar volg je je project op de voet: de meetstaat, de facturatie, de planning en de documenten die we met je delen.</p>"
    + "<p style=\"margin:24px 0\"><a href=\"" + link + "\" style=\"background:#1B1E1C;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block\">Kies je wachtwoord</a></p>"
    + "<p>Daarna log je altijd in op <a href=\"" + PORTAAL.URL + "\">" + PORTAAL.URL + "</a> met je e-mailadres en wachtwoord.<br><span style=\"color:#767D78;font-size:13px\">De knop hierboven is beperkt geldig; is hij vervallen, klik dan op het portaal op \"Wachtwoord vergeten\" en je krijgt een nieuwe link.</span></p>"
    + "<p>Tot snel,<br>" + wie.name + " — BROS</p></div>";
  portaalMail(email, PORTAAL.ONDERWERP, tekst, html);
  return { ok: true, bestaand: bestaand, user_id: userId || null };
}
/** "Wachtwoord vergeten" op het portaal: herstellink per Gmail, enkel voor klantlogins; geeft nooit prijs of een adres bestaat. */
function portaalReset(body) {
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: true };
  const cache = CacheService.getScriptCache(); const key = "reset:" + email;
  if (cache.get(key)) return { ok: true };            // max. één mail per 10 minuten per adres
  cache.put(key, "1", 600);
  try {
    const prof = pbAdmin("/rest/v1/profiles?email=eq." + encodeURIComponent(email) + "&role=eq.klant&select=id,name", "get");
    if (!prof || !prof.length) return { ok: true };
    const j = pbAdmin("/auth/v1/admin/generate_link", "post", { type: "recovery", email: email, redirect_to: PORTAAL.URL });
    const link = j.action_link || (j.properties && j.properties.action_link); if (!link) return { ok: true };
    const naam = prof[0].name || "";
    portaalMail(email, "Nieuw wachtwoord voor je BROS-klantenportaal", "Beste " + naam + ",\n\nVia deze link kies je een nieuw wachtwoord voor het BROS-klantenportaal:\n" + link + "\n\nVroeg je dit niet aan, dan mag je deze mail negeren.\n\nBROS",
      "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1B1E1C\"><p>Beste " + naam + ",</p><p>Via de knop hieronder kies je een nieuw wachtwoord voor het BROS-klantenportaal.</p><p style=\"margin:24px 0\"><a href=\"" + link + "\" style=\"background:#1B1E1C;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block\">Nieuw wachtwoord kiezen</a></p><p style=\"color:#767D78;font-size:13px\">Vroeg je dit niet aan, dan mag je deze mail negeren.</p><p>BROS</p></div>");
  } catch (e) { Logger.log("reset: " + e); }
  return { ok: true };
}
/** Wie roept aan (team of klant)? Geeft {id, name, role}; gooit als het token niet klopt. */
function callerAny(token) {
  if (!token) throw new Error("Geen login meegestuurd.");
  const u = pbReq("/auth/v1/user", "get", null, token);
  const prof = pbReq("/rest/v1/profiles?id=eq." + u.id + "&select=role,name,email", "get", null, token);
  if (!prof || !prof[0]) throw new Error("Geen profiel.");
  return { id: u.id, name: prof[0].name, role: prof[0].role, email: prof[0].email || u.email };
}
/** Goedkeuringsmails: "voorgelegd" (team → klant: er wacht een voorstel) en "beslist" (klant → BROS-melding + bevestiging aan de klant). */
function goedkeuringMail(body) {
  const wie = callerAny(body.token); const soort = String(body.soort || "");
  const g = (pbAdmin("/rest/v1/goedkeuringen?id=eq." + encodeURIComponent(String(body.id || "")) + "&select=*", "get") || [])[0];
  if (!g) return { ok: false, error: "Voorstel niet gevonden." };
  if (soort === "voorgelegd" && wie.role !== "beheer" && wie.role !== "medewerker") return { ok: false, error: "Geen toegang." };
  if (soort === "beslist" && (wie.role !== "klant" || g.beslist_door !== wie.id)) return { ok: false, error: "Geen toegang." };
  const p = (pbAdmin("/rest/v1/projecten?id=eq." + g.project_id + "&select=nummer,klant,naam,lead", "get") || [])[0] || {};
  const pcs = pbAdmin("/rest/v1/project_contacten?project_id=eq." + g.project_id + "&rol=in.(bouwheer,contactpersoon)&select=contact_id", "get") || [];
  const klanten = pcs.length ? (pbAdmin("/rest/v1/contacten?id=in.(" + pcs.map(x => x.contact_id).join(",") + ")&user_id=not.is.null&select=naam,email", "get") || []).filter(c => c.email) : [];
  const eur = (n) => "€ " + Number(n || 0).toLocaleString("nl-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nl = (n) => Number(n || 0).toLocaleString("nl-BE", { maximumFractionDigits: 2 });
  const rows = (g.posten || []).map(x => "<tr><td style=\"padding:4px 8px;color:#767D78;font-family:monospace\">" + x.code + "</td><td style=\"padding:4px 8px\">" + String(x.omschrijving || "").replace(/</g, "&lt;") + (x.locatie ? " <span style=\"color:#767D78\">· " + x.locatie + "</span>" : "") + "</td><td style=\"padding:4px 8px;text-align:right;white-space:nowrap\">" + nl(x.hoeveelheid) + " " + x.eenheid + "</td><td style=\"padding:4px 8px;text-align:right;white-space:nowrap\">" + eur(x.prijs) + "</td><td style=\"padding:4px 8px;text-align:right;white-space:nowrap\">" + eur(x.totaal) + "</td></tr>").join("");
  const tabel = "<table style=\"border-collapse:collapse;width:100%;font-size:13px\"><thead><tr style=\"color:#767D78;font-size:11px;text-transform:uppercase\"><th align=\"left\" style=\"padding:4px 8px\">Nr</th><th align=\"left\" style=\"padding:4px 8px\">Omschrijving</th><th align=\"right\" style=\"padding:4px 8px\">Hoev.</th><th align=\"right\" style=\"padding:4px 8px\">Prijs</th><th align=\"right\" style=\"padding:4px 8px\">Totaal</th></tr></thead><tbody>" + rows
    + "<tr><td colspan=\"4\" style=\"padding:6px 8px;border-top:2px solid #C6C3B9\"><b>Totaal excl. btw</b></td><td style=\"padding:6px 8px;text-align:right;border-top:2px solid #C6C3B9\"><b>" + eur(g.totaal_excl) + "</b></td></tr><tr><td colspan=\"4\" style=\"padding:2px 8px\">Btw</td><td style=\"padding:2px 8px;text-align:right\">" + eur(g.btw) + "</td></tr><tr><td colspan=\"4\" style=\"padding:2px 8px\"><b>Totaal incl. btw</b></td><td style=\"padding:2px 8px;text-align:right\"><b>" + eur(g.totaal_incl) + "</b></td></tr></tbody></table>";
  const kop = (g.soort === "meerwerk" ? "Meerwerkvoorstel" : "Offerte") + " · " + (p.klant || "") + (p.naam && p.naam !== p.klant ? " · " + p.naam : "");
  const wrap = (inner) => "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1B1E1C;max-width:720px\">" + inner + "</div>";
  const naar = [];
  if (soort === "voorgelegd") {
    klanten.forEach(c => {
      const tot = g.geldig_tot ? " Graag je reactie vóór <b>" + g.geldig_tot.split("-").reverse().join("/") + "</b>." : "";
      const html = wrap("<p>Beste " + (c.naam || "") + ",</p><p>Er staat een voorstel voor je klaar in je BROS-klantenportaal: <b>" + g.titel + "</b>." + tot + (g.toelichting ? "</p><p style=\"white-space:pre-line\">" + g.toelichting.replace(/</g, "&lt;") : "") + "</p><p style=\"margin:24px 0\"><a href=\"" + PORTAAL.URL + "\" style=\"background:#1B1E1C;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block\">Bekijken en goedkeuren</a></p>" + tabel + "<p style=\"margin-top:20px\">Vragen? Antwoord gerust op deze mail.<br>" + wie.name + " — BROS</p>");
      portaalMail(c.email, "Voorstel ter goedkeuring: " + g.titel, "Beste " + (c.naam || "") + ",\n\nEr staat een voorstel voor je klaar in je BROS-klantenportaal: " + g.titel + " (" + eur(g.totaal_incl) + " incl. btw).\nBekijken en goedkeuren: " + PORTAAL.URL + "\n\n" + wie.name + " — BROS", html); naar.push(c.email);
    });
  } else {
    const ok = g.status === "akkoord"; const wanneer = g.beslist_op ? new Date(g.beslist_op).toLocaleString("nl-BE", { timeZone: "Europe/Brussels" }) : "";
    const melding = wrap("<p>" + (ok ? "<b>Akkoord</b> van de klant" : "<b>Niet akkoord</b> / vraag van de klant") + " voor <b>" + kop + "</b>.</p><p>Voorstel: <b>" + g.titel + "</b> (" + eur(g.totaal_incl) + " incl. btw)<br>Beslist door: " + g.beslist_naam + " (" + g.beslist_email + ") op " + wanneer + "</p>" + (g.opmerking ? "<p style=\"padding:10px 14px;border-left:3px solid #B93A34;background:#F7DEDC\">“" + g.opmerking.replace(/</g, "&lt;") + "”</p>" : "") + tabel + "<p style=\"color:#767D78;font-size:13px\">Automatische melding uit het BROS Planbord — de posten staan " + (ok ? "op Akkoord" : "ongewijzigd") + " in de meetstaat van project " + (p.nummer || "") + ".</p>");
    portaalMail(YUKI.REPORT_TO, (ok ? "✔ Akkoord" : "✖ Niet akkoord") + " — " + kop + " — " + g.titel, (ok ? "Akkoord" : "Niet akkoord") + " van " + g.beslist_naam + " voor " + g.titel + " (" + kop + ")" + (g.opmerking ? "\n\nOpmerking: " + g.opmerking : ""), melding); naar.push(YUKI.REPORT_TO);
    if (g.beslist_email) {
      const bevestiging = wrap("<p>Beste " + g.beslist_naam + ",</p>" + (ok ? "<p>Bedankt voor je akkoord op <b>" + g.titel + "</b>. Dit is je bevestiging; hieronder staat wat je hebt goedgekeurd.</p>" : "<p>We hebben je reactie op <b>" + g.titel + "</b> goed ontvangen en nemen contact met je op.</p><p style=\"padding:10px 14px;border-left:3px solid #C6C3B9;background:#ECEAE3\">“" + (g.opmerking || "").replace(/</g, "&lt;") + "”</p>") + tabel + "<p style=\"color:#767D78;font-size:13px\">Vastgelegd op " + wanneer + " door " + g.beslist_naam + " (" + g.beslist_email + ").</p><p>BROS</p>");
      portaalMail(g.beslist_email, (ok ? "Bevestiging van je akkoord: " : "Je reactie op: ") + g.titel, (ok ? "Bedankt voor je akkoord op " : "We ontvingen je reactie op ") + g.titel + " (" + eur(g.totaal_incl) + " incl. btw).\n\nBROS", bevestiging); naar.push(g.beslist_email);
    }
  }
  return { ok: true, naar: naar };
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
  const punten = taken.length ? "<h3 style=\"font-size:15px;margin:18px 0 6px\">Actiepunten</h3><ul style=\"padding-left:18px;margin:0\">" + taken.map(t => "<li>" + (t.status === "done" ? "✅ " : "") + String(t.titel).replace(/</g, "&lt;") + (t.assignee && namen[t.assignee] ? " <span style=\"color:#767D78\">· " + namen[t.assignee] + "</span>" : "") + (t.eind ? " <span style=\"color:#767D78\">· " + String(t.eind).split("-").reverse().join("/") + "</span>" : "") + "</li>").join("") + "</ul>" : "";
  const html = "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1B1E1C;max-width:720px\"><p>Beste,</p><p>Hierbij het verslag <b>" + String(n.titel || SOORT[n.soort]).replace(/</g, "&lt;") + "</b> (" + (SOORT[n.soort] || n.soort) + " van " + datum + ") voor " + (p.klant || "") + (p.naam && p.naam !== p.klant ? " · " + p.naam : "") + "." + (n.deelnemers ? "<br><span style=\"color:#767D78\">Aanwezig: " + String(n.deelnemers).replace(/</g, "&lt;") + "</span>" : "") + "</p>"
    + "<div style=\"white-space:pre-line;padding:14px 16px;border:1px solid #DAD8D0;border-radius:10px;background:#F5F4F0\">" + String(n.inhoud || "").replace(/</g, "&lt;") + "</div>" + punten
    + "<p style=\"margin-top:20px\">Je vindt dit verslag ook terug in je klantenportaal: <a href=\"" + PORTAAL.URL + "\">" + PORTAAL.URL + "</a></p><p>" + wie.name + " — BROS</p></div>";
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
  const r = UrlFetchApp.fetch(w.pdf_url, { muteHttpExceptions: true }); if (r.getResponseCode() >= 300) throw new Error("Pdf niet gevonden (" + r.getResponseCode() + ").");
  const naam = "Werfverslag " + w.nr + " - " + (p.klant || "") + " - " + String(w.datum || "").split("-").reverse().join("-") + ".pdf";
  const pdf = r.getBlob().setName(naam).setContentType("application/pdf");
  const datum = String(w.datum || "").split("-").reverse().join("/"); const proj = (p.klant || "") + (p.naam && p.naam !== p.klant ? " · " + p.naam : "");
  const aan = (body.aan || []).map(e => String(e).trim()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  const bericht = String(w.bericht || "").trim();
  const html = "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1B1E1C;max-width:720px\"><p>Beste,</p>"
    + (bericht ? "<p style=\"white-space:pre-line\">" + bericht.replace(/</g, "&lt;") + "</p>" : "<p>In bijlage het werfverslag " + w.nr + " van " + datum + " voor <b>" + proj.replace(/</g, "&lt;") + "</b>" + (p.adres ? " (" + p.adres + (p.gemeente ? ", " + p.gemeente : "") + ")" : "") + ".</p>")
    + "<p>Het verslag bevat " + w.punten + " vaststelling" + (w.punten === 1 ? "" : "en") + " met foto's, verantwoordelijke en uiterste datum, en de plannen met de locatie van elk punt. Gelieve de open punten die aan jou toegewezen zijn tegen de vermelde datum in orde te brengen en ons te verwittigen zodra dat gebeurd is.</p>"
    + (w.klant_zichtbaar ? "<p>Als klant vind je dit verslag ook terug in je portaal: <a href=\"" + PORTAAL.URL + "\">" + PORTAAL.URL + "</a></p>" : "")
    + "<p>" + wie.name + " — BROS</p></div>";
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
  const p = (pbAdmin("/rest/v1/projecten?id=eq." + v.project_id + "&select=nummer,klant,naam", "get") || [])[0] || {};
  const profs = pbAdmin("/rest/v1/profiles?select=id,name,email,role,active&active=eq.true", "get") || [];
  const naar = profs.find(x => x.id === v.voorgestelde_user); const beheer = profs.filter(x => x.role === "beheer" && x.email);
  const to = naar && naar.email ? naar.email : (beheer[0] ? beheer[0].email : "");
  if (!to) return { ok: false, error: "Geen e-mailadres voor de verantwoordelijke." };
  const cc = beheer.map(x => x.email).filter(e => e && e !== to).join(",");
  const proj = (p.klant || "") + (p.naam && p.naam !== p.klant ? " · " + p.naam : "");
  const link = PORTAAL.URL.replace(/klant\/?$/, "") + "#voorstellen";
  const esc = (t) => String(t || "").replace(/</g, "&lt;");
  const html = "<div style=\"font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1B1E1C;max-width:720px\"><p>Dag " + esc(naar ? naar.name : "team") + ",</p>"
    + "<p>De assistent in het klantenportaal stelt een taak voor bij <b>" + esc(proj) + "</b>" + (v.urgentie === "hoog" ? " <span style=\"color:#B93A34;font-weight:700\">(hoge urgentie)</span>" : "") + ":</p>"
    + "<div style=\"padding:12px 16px;border:1px solid #DAD8D0;border-radius:10px;background:#F5F4F0\"><b>" + esc(v.titel) + "</b><br><span style=\"color:#767D78\">" + esc(v.onderwerp) + (v.eind ? " · tegen " + String(v.eind).split("-").reverse().join("/") : "") + "</span>" + (v.omschrijving ? "<p style=\"margin:8px 0 0\">" + esc(v.omschrijving) + "</p>" : "") + "</div>"
    + "<p style=\"margin-top:14px\"><b>Vraag van de klant:</b><br>" + esc(v.vraag) + "</p><p><b>Antwoord van de assistent:</b><br>" + esc(v.antwoord) + "</p>"
    + "<p><a href=\"" + link + "\" style=\"display:inline-block;padding:10px 16px;background:#1D1D1F;color:#fff;border-radius:8px;text-decoration:none\">Voorstel bekijken in het Planbord</a></p><p style=\"color:#767D78;font-size:13px\">Bevestig, pas aan of weiger het voorstel in het Planbord; pas dan wordt het een taak.</p></div>";
  const tekst = "De assistent stelt een taak voor bij " + proj + ": " + v.titel + "\n\nVraag van de klant: " + v.vraag + "\nAntwoord: " + v.antwoord + "\n\nBekijken: " + link;
  const opt = { htmlBody: html, name: PORTAAL.AFZENDER }; if (cc) opt.cc = cc;
  if (PORTAAL.VAN) { const al = GmailApp.getAliases(); if (al.indexOf(PORTAAL.VAN) >= 0) opt.from = PORTAAL.VAN; else opt.replyTo = PORTAAL.VAN; }
  GmailApp.sendEmail(to, (v.urgentie === "hoog" ? "[Dringend] " : "") + "Taakvoorstel · " + proj + " · " + v.titel, tekst, opt);
  return { ok: true, naar: [to].concat(cc ? cc.split(",") : []) };
}
/** Bestand delen met de klant: "iedereen met de link mag lezen" aan- of uitzetten. */
function portaalShare(body) {
  caller(body.token, false);
  const id = String(body.fileId || ""); if (!id) return { ok: false, error: "Geen bestand." };
  onderProjecten(id);
  const token = ScriptApp.getOAuthToken(); const base = "https://www.googleapis.com/drive/v3/files/" + id;
  if (body.on) {
    const r = UrlFetchApp.fetch(base + "/permissions?supportsAllDrives=true", { method: "post", contentType: "application/json", payload: JSON.stringify({ role: "reader", type: "anyone" }), headers: { Authorization: "Bearer " + token }, muteHttpExceptions: true });
    if (r.getResponseCode() >= 300) throw new Error("Drive: " + r.getContentText().slice(0, 200));
  } else {
    const r = UrlFetchApp.fetch(base + "/permissions/anyoneWithLink?supportsAllDrives=true", { method: "delete", headers: { Authorization: "Bearer " + token }, muteHttpExceptions: true });
    if (r.getResponseCode() >= 300 && r.getResponseCode() !== 404) throw new Error("Drive: " + r.getContentText().slice(0, 200));
  }
  return { ok: true };
}

function yukiInstall() {
  GmailApp.createLabel(YUKI.LABEL); GmailApp.createLabel(YUKI.LABEL_CHECK);
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "yukiSync").forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("yukiSync").timeBased().everyHours(1).create();
  Logger.log("OK — label en uurlijkse trigger aangemaakt. Test nu met yukiSync().");
}
function yukiSync() {
  const label = GmailApp.getUserLabelByName(YUKI.LABEL) || GmailApp.createLabel(YUKI.LABEL);
  const labelCheck = GmailApp.getUserLabelByName(YUKI.LABEL_CHECK) || GmailApp.createLabel(YUKI.LABEL_CHECK);
  const threads = GmailApp.search(YUKI.QUERY, 0, 30);
  if (!threads.length) return Logger.log("Geen nieuwe Yuki-facturen.");
  const facturen = [];
  threads.forEach(t => t.getMessages().forEach(m => {
    if (m.getFrom().indexOf("yukiworks") < 0 && m.getReplyTo().indexOf("yukiworks") < 0 && m.getSubject().indexOf("Factuur van BROS") < 0) return;
    const f = yukiParse(m); if (f) { f.thread = t; facturen.push(f); }
  }));
  if (!facturen.length) return Logger.log("Geen facturen herkend in " + threads.length + " mails.");
  // zelfde factuur in meerdere mails (bv. doorgestuurd én via filter): één keer verwerken, alle mails labelen
  const perNr = {}; facturen.forEach(f => { (perNr[f.factuurnummer] = perNr[f.factuurnummer] || []).push(f); });
  const uniek = Object.keys(perNr).map(nr => perNr[nr][0]);
  const rapport = yukiKoppel(uniek);
  rapport.forEach(r => { const ok = r.resultaat === "gekoppeld" || r.resultaat === "al gekoppeld"; perNr[r.factuurnummer].forEach(f => f.thread.addLabel(ok ? label : labelCheck)); });
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
function yukiNorm(s) { return String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\b(bv|bvba|nv|vof|cv|srl|sa|invest|group)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim(); }
/* dezelfde rekenregels als app.js (vordCalc) */
function yukiCalc(v, rows, regels, loten) {
  const mw = v.soort === "meerwerk"; const lotRg = {}, postRg = {};
  regels.filter(r => r.vordering_id === v.id).forEach(r => { if (r.post_id) postRg[r.post_id] = Number(r.pct); else lotRg[r.lot] = Number(r.pct); });
  let excl = 0, btw = 0;
  rows.forEach(r => { if (r.project_id !== v.project_id || r.status === "vervallen") return; if ((r.status === "meerwerk" || r.status === "minwerk") !== mw) return;
    const pct = postRg[r.id] != null ? postRg[r.id] : lotRg[r.lot]; if (pct == null) return;
    // verkoopprijs: sinds script 012 berekend in de view (verkoop_ep); daarvoor kostprijs × (1 + marge)
    const marge = r.marge != null && r.marge !== "" ? Number(r.marge) : Number((loten[r.lot] || {}).marge) || 0;
    const ep = r.verkoop_ep != null ? Number(r.verkoop_ep) : Number(r.eenheidsprijs || 0) * (1 + marge);
    const a = pct * Number(r.hoeveelheid || 0) * ep * (r.status === "minwerk" ? -1 : 1);
    excl += a; btw += a * (Number(r.btw) || 0); });
  return { excl: Math.round(excl * 100) / 100, btw: Math.round(btw * 100) / 100, incl: Math.round((excl + btw) * 100) / 100 };
}
function yukiKoppel(facturen) {
  const token = pbLogin();
  const projecten = pbReq("/rest/v1/projecten?select=id,nummer,klant,naam,bedrijf,status", "get", null, token);
  const vorderingen = pbReq("/rest/v1/vorderingen?select=*", "get", null, token);
  const regels = pbReq("/rest/v1/vordering_regels?select=*", "get", null, token);
  let rows, loten = {};
  try { rows = pbReq("/rest/v1/meetstaat_posten_v?select=id,project_id,lot,status,hoeveelheid,verkoop_ep,btw", "get", null, token); }
  catch (e) { rows = pbReq("/rest/v1/meetstaat_posten?select=id,project_id,lot,status,hoeveelheid,eenheidsprijs,marge,btw", "get", null, token); pbReq("/rest/v1/loten?select=nr,marge", "get", null, token).forEach(l => loten[l.nr] = l); }
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
