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
  const parent = DriveApp.getFolderById(CONFIG.PROJECTEN_FOLDER_ID);
  const existing = parent.getFoldersByName(klant);
  let folder, created = false;
  if (existing.hasNext()) folder = existing.next();
  else if (create) { folder = parent.createFolder(klant); copyFolder(DriveApp.getFolderById(CONFIG.SJABLOON_FOLDER_ID), folder, klant); created = true; }
  else return { ok: false, error: "Geen map gevonden met de naam \"" + klant + "\" in PROJECTEN." };
  return { ok: true, created: created, folder: { id: folder.getId(), url: folder.getUrl(), name: folder.getName() }, files: listFiles(folder, "") };
}

/** Kopieert submappen en bestanden recursief; slaat tijdelijke Office-bestanden en Finder-iconen over. */
function copyFolder(src, dst, klant) {
  const files = src.getFiles();
  while (files.hasNext()) {
    const f = files.next(); const name = f.getName();
    if (name.indexOf("~$") === 0 || name.indexOf("Icon") === 0 || name === ".DS_Store") continue;
    f.makeCopy(renameFor(name, klant), dst);
  }
  const subs = src.getFolders();
  while (subs.hasNext()) { const s = subs.next(); copyFolder(s, dst.createFolder(s.getName()), klant); }
}
/** "SJABLOON MEETSTAAT 2026 DEF.xlsx" → "MEETSTAAT 2026 DEF Chantor Mansi.xlsx"; "TEMPLATE_BROS.skp" → "Chantor Mansi.skp" */
function renameFor(name, klant) {
  const dot = name.lastIndexOf("."); const base = dot > 0 ? name.slice(0, dot) : name; const ext = dot > 0 ? name.slice(dot) : "";
  let b = base.replace(/SJABLOON/ig, "").replace(/TEMPLATE_?BROS/ig, "").replace(/TEMPLATE/ig, "").replace(/[\s_]+/g, " ").trim();
  return (b ? b + " " : "") + klant + ext;
}
function listById(folderId) {
  if (!folderId) return { ok: false, error: "Geen map-id." };
  const folder = DriveApp.getFolderById(folderId);
  return { ok: true, folder: { id: folder.getId(), url: folder.getUrl(), name: folder.getName() }, files: listFiles(folder, "") };
}
function listFiles(folder, path) {
  let out = [];
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next(); const name = f.getName();
    if (name.indexOf("~$") === 0 || name.indexOf("Icon") === 0 || name === ".DS_Store") continue;
    out.push({ id: f.getId(), name: name, path: path, url: f.getUrl(), mime: f.getMimeType(), size: f.getSize(), updated: f.getLastUpdated().toISOString() });
  }
  const subs = folder.getFolders();
  while (subs.hasNext()) { const s = subs.next(); out = out.concat(listFiles(s, path ? path + "/" + s.getName() : s.getName())); }
  return out;
}
