// Code.gs 1.67 in een vm met stubs: projectmap automatisch, factuurPdf zonder map, wachtende pdf, herkoppelen, dagmail
const fs = require("fs"), vm = require("vm");
const src = fs.readFileSync(require("path").join(process.env.PB_REPO || require("path").join(__dirname, ".."), "drive/Code.gs"), "utf8");
let R = {}; const ok = (k, c, x) => { R[k] = c ? "OK" : "FOUT " + JSON.stringify(x === undefined ? null : x).slice(0, 500); };
let nid = 0; const mkFile = (naam) => ({ id: "F" + (++nid), naam, map: null, sharing: null, getId() { return this.id; }, getName() { return this.naam; }, setName(n) { this.naam = n; return this; }, moveTo(m) { if (this.map) this.map.files = this.map.files.filter(f => f !== this); this.map = m; m.files.push(this); }, setSharing(a, p) { this.sharing = a + "/" + p; }, getUrl() { return "https://drive/" + this.id; }, getSize() { return 1234; }, isTrashed() { return false; }, getBlob() { return blob(this.naam); } });
const mkFolder = (naam, id) => ({ naam, id: id || "D" + (++nid), subs: [], files: [], getName() { return this.naam; }, getId() { return this.id; }, getFolders() { let i = 0; const s = this.subs; return { hasNext: () => i < s.length, next: () => s[i++] }; }, getFoldersByName(n) { const l = this.subs.filter(f => f.naam === n); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; }, createFolder(n) { const f = mkFolder(n); this.subs.push(f); return f; },
  getFilesByName(n) { const l = this.files.filter(f => f.naam === n); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; }, createFile(b) { const f = mkFile(b.getName()); f.map = this; this.files.push(f); return f; } });
const blob = (naam, bytes) => ({ naam, bytes: bytes || [37, 80, 68, 70, 45], getName() { return this.naam; }, setName(n) { this.naam = n; return this; }, getBytes() { return this.bytes; }, copyBlob() { return blob(this.naam, this.bytes); } });
const ROOT = mkFolder("PROJECTEN", "ROOT"); const folders = { ROOT };
const mapIn = (naam, id) => { const f = mkFolder(naam, id); ROOT.subs.push(f); folders[f.id] = f; return f; };
const files = {};
let db, mails, drivecalls, koppelCalls, pdfTekst, created;
function reset() {
  db = { yuki: [], vord: [], proj: [] }; mails = []; drivecalls = []; koppelCalls = []; pdfTekst = {}; created = [];
}
reset();
const props = {};
const ctx = {
  console, JSON, Math, Date, String, Number, Array, Object, RegExp, Error, Set, Map, encodeURIComponent, decodeURIComponent, parseInt, isNaN, Buffer,
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => k === "SERVICE_KEY" ? "sb_secret_test" : (props[k] == null ? null : props[k]), getProperties: () => Object.assign({ SERVICE_KEY: "sb_secret_test" }, props), setProperty(k, v) { props[k] = v; }, deleteProperty(k) { delete props[k]; } }) },
  DriveApp: { getFolderById: (id) => { if (!folders[id]) throw new Error("map " + id + " niet gevonden"); return folders[id]; }, getFileById: (id) => { if (!files[id]) throw new Error("niet gevonden"); return files[id]; }, Access: { ANYONE_WITH_LINK: "LINK" }, Permission: { VIEW: "VIEW" } },
  Utilities: { newBlob: (bytes, mime, naam) => blob(naam, typeof bytes === "string" ? Array.from(Buffer.from(bytes)) : Array.from(bytes)), base64Decode: (s) => Array.from(Buffer.from(s, "base64")), formatDate: (d, tz, f) => { const x = new Date(d); const iso = x.toISOString(); if (f === "yyyy-MM-dd") return iso.slice(0, 10); if (f === "u") return String(((x.getUTCDay() + 6) % 7) + 1); if (f === "H") return "9"; return iso; }, computeDigest: (a, s) => Array.from(Buffer.from(String(s))), base64EncodeWebSafe: (b) => Buffer.from(b).toString("base64"), DigestAlgorithm: { MD5: "md5" }, getUuid: () => "u" },
  GmailApp: { getMessageById: () => null, sendEmail() { } }, ScriptApp: { getOAuthToken: () => "t" }, LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() { } }), getUserLock: () => ({ tryLock: () => true, releaseLock() { } }) }, CacheService: { getScriptCache: () => ({ get: () => null, put() { }, remove() { } }) },
  ContentService: {}, UrlFetchApp: {}, Logger: { log() { } }, Session: {},
};
vm.createContext(ctx);
vm.runInContext(src + "\n;this.__t = { factuurPdf, factuurPdfPlaatsen, mapZoeken, projectMapAuto, yukiPdfBewaren, yukiBewaar, yukiPdfAanvullen, yukiZoeklijst, yukiZoekResultaat, yukiWachtPdfAuto, yukiHerkoppelen, yukiPdfWachtNummers, debiteurenDagelijks, factuurControle, YUKI_GEEN_MAP, CONFIG, PORTAAL };", ctx);
const T = ctx.__t;
vm.runInContext(`
  Object.defineProperty(CONFIG, "PROJECTEN_FOLDER_ID", { value: "ROOT" }); PORTAAL.URL = "https://pb.example/klant/";
  onderProjecten = function () { };
  caller = function (token, beheer) { if (token !== "beheer-token") throw new Error("Geen toegang."); return { id: "B", role: "beheer" }; };
  yukiPdfVerdacht = function (f) { return /BE99/.test(f.pdf_vol || "") ? "de factuur-pdf vermeldt een andere rekening" : (f.verdacht || ""); };
  yukiPdfText = function (b) { return this.__tekst(b); };
  driveQuery = function (q, velden) { return this.__dq(q); };
  createOrLink = function (naam, create) { return this.__col(naam, create); };
  copyTemplate = function () { return []; };
  pbLogin = function () { return "bot"; };
  yukiKoppel = function (fs) { return this.__koppel(fs); };
  portaalMail = function (aan, onderwerp, tekst, html) { this.__mail({ aan, onderwerp, html }); };
  mailRuimte = function () { return true; };
  yukiBetalingen = function (r) { }; herinneringenVoorstellen = function (r) { }; meldOpruimen = function () { };
  PropertiesService.getScriptProperties().setProperty("YUKI_MAILBOX", "archief");
`, ctx);
ctx.__tekst = (b) => pdfTekst[b.getName()] != null ? pdfTekst[b.getName()] : "";
ctx.__dq = (q) => { const m = q.match(/name='((?:[^'\\]|\\.)*)'/); const kids = ROOT.subs.map(f => ({ id: f.id, name: f.naam, webViewLink: "https://drive/f/" + f.id })); return m ? kids.filter(f => f.name === m[1].replace(/\\'/g, "'")) : kids; };
ctx.__col = (naam, create) => { created.push([naam, create]); const f = mapIn(naam); return { ok: true, created: true, folder: { id: f.id, url: "https://drive/f/" + f.id, name: naam }, files: [] }; };
ctx.__koppel = (fs) => { koppelCalls.push(fs); return fs.map(f => f.factuurnummer === "2026300" ? { factuurnummer: f.factuurnummer, totaal_incl: f.totaal_incl, resultaat: "gekoppeld", project: "Alfa Annie", vordering_nr: 0, vordering_soort: "voorschot" } : { factuurnummer: f.factuurnummer, totaal_incl: f.totaal_incl, resultaat: "niet gevonden" }); };
ctx.__mail = (m) => mails.push(m);
const q = (path) => decodeURIComponent(path);
ctx.pbAdmin = function (path, method, body, prefer) {
  const p = q(path); let m;
  if (/^\/rest\/v1\/yuki_facturen\?select=id&limit=1$/.test(p)) return [];
  if ((m = p.match(/^\/rest\/v1\/yuki_facturen\?factuurnummer=eq\.([^&]+)&select/))) return db.yuki.filter(y => y.factuurnummer === m[1]);
  if (/^\/rest\/v1\/yuki_facturen\?on_conflict/.test(p)) { const i = db.yuki.findIndex(y => y.factuurnummer === body.factuurnummer); if (i >= 0) Object.assign(db.yuki[i], body); else db.yuki.push(Object.assign({ id: "Y" + db.yuki.length, genegeerd: false }, body)); return null; }
  if ((m = p.match(/^\/rest\/v1\/yuki_facturen\?id=eq\.([^&]+)&select/))) return db.yuki.filter(y => y.id === m[1]);
  if ((m = p.match(/^\/rest\/v1\/yuki_facturen\?id=eq\.([^&]+)$/))) { Object.assign(db.yuki.find(y => y.id === m[1]), body); return null; }
  if (/^\/rest\/v1\/yuki_facturen\?resultaat=eq\.gekoppeld&pdf_drive_id=not\.is\.null/.test(p)) return db.yuki.filter(y => y.resultaat === "gekoppeld" && y.pdf_drive_id && !y.genegeerd && (!/vordering_id=not/.test(p) || y.vordering_id));
  if (/^\/rest\/v1\/yuki_facturen\?resultaat=in\.\(niet_gevonden,twijfel\)&/.test(p)) return db.yuki.filter(y => ["niet_gevonden", "twijfel"].includes(y.resultaat) && !y.genegeerd && y.totaal_incl != null);
  if (/^\/rest\/v1\/yuki_facturen\?resultaat=in\.\(niet_gevonden,twijfel,verdacht\)&/.test(p)) return db.yuki.filter(y => ["niet_gevonden", "twijfel", "verdacht"].includes(y.resultaat) && !y.genegeerd && y.voorstel_project);
  if (/^\/rest\/v1\/yuki_facturen\?resultaat=neq\.gekoppeld/.test(p)) return db.yuki.filter(y => y.resultaat !== "gekoppeld" && !y.genegeerd);
  if ((m = p.match(/^\/rest\/v1\/vorderingen\?id=eq\.([^&]+)&select/))) return db.vord.filter(v => v.id === m[1]);
  if ((m = p.match(/^\/rest\/v1\/vorderingen\?id=eq\.([^&]+)$/))) { Object.assign(db.vord.find(v => v.id === m[1]), body); return null; }
  if ((m = p.match(/^\/rest\/v1\/vorderingen\?factuurnummer=eq\.([^&]+)&status/))) return db.vord.filter(v => v.factuurnummer === m[1] && v.status !== "opgemaakt");
  if (/^\/rest\/v1\/vorderingen\?id=in\./.test(p)) return db.vord;
  if (/^\/rest\/v1\/vorderingen\?factuurnummer=neq\.&select=factuurnummer/.test(p)) return db.vord.filter(v => v.factuurnummer);
  if (/^\/rest\/v1\/vorderingen\?status=in\.\(verzonden,betaald\)&factuurnummer=neq\.&factuur_document=is\.null/.test(p)) return db.vord.filter(v => v.status !== "opgemaakt" && v.factuurnummer && !v.factuur_document);
  if (/^\/rest\/v1\/vorderingen\?status=eq\.opgemaakt/.test(p)) return db.vord.filter(v => v.status === "opgemaakt");
  if ((m = p.match(/^\/rest\/v1\/projecten\?drive_folder_id=eq\.([^&]+)&id=neq\.([^&]+)/))) return db.proj.filter(x => x.drive_folder_id === m[1] && x.id !== m[2]);
  if ((m = p.match(/^\/rest\/v1\/projecten\?id=eq\.([^&]+)&or=\(drive_folder_id\.is\.null,drive_folder_id\.eq\.\)$/))) { const x = db.proj.find(x => x.id === m[1]); if (x && (x.drive_folder_id === null || x.drive_folder_id === "")) Object.assign(x, body); return null; }
  if ((m = p.match(/^\/rest\/v1\/projecten\?id=eq\.([^&]+)/))) return db.proj.filter(x => x.id === m[1]).map(x => Object.assign({}, x));
  if (/^\/rest\/v1\/projecten\?id=in\./.test(p)) return db.proj;
  if (/^\/rest\/v1\/documenten/.test(p)) return [{ id: "DOC" + (++nid) }];
  if (/^\/rest\/v1\/betaalherinneringen/.test(p)) return [];
  if (/^\/rest\/v1\/instellingen/.test(p)) return [];
  throw new Error("onverwacht: " + p);
};
ctx.pbAll = function (path) { const p = q(path); let m; if ((m = p.match(/projecten\?select=[^&]+&id=eq\.([^&]+)/))) return db.proj.filter(x => x.id === m[1]).map(x => Object.assign({}, x)); if (/projecten\?select/.test(p)) return db.proj.map(x => Object.assign({}, x)); throw new Error("pbAll onverwacht " + p); };
ctx.pbReq = function (path, method, body) { const p = q(path); let m; if (/^\/rest\/v1\/documenten/.test(p)) return [{ id: "DOC" + (++nid) }]; if ((m = p.match(/^\/rest\/v1\/vorderingen\?id=eq\.([^&]+)$/))) { Object.assign(db.vord.find(v => v.id === m[1]), body); return null; } throw new Error("pbReq onverwacht " + p); };
vm.runInContext("pbAdmin = this.pbAdmin; pbAll = this.pbAll; pbReq = this.pbReq;", ctx);
const U = (x) => "aaaaaaaa-0000-0000-0000-00000000000" + x;

// ---- 1. mapZoeken ----
mapIn("Alfa Annie", "MC"); mapIn("Beta Bérénice", "MV"); mapIn("Peeters", "MP1"); mapIn("PEETERS", "MP2"); mapIn("Ab", "MAB");
ok("mapZoeken: exacte naam", (T.mapZoeken("Alfa Annie") || {}).id === "MC");
ok("mapZoeken: zelfde op leestekens/accenten na", (T.mapZoeken("Alfa - Annie") || {}).id === "MC" && (T.mapZoeken("beta berenice") || {}).id === "MV");
let fout = null; try { T.mapZoeken("peeters"); } catch (e) { fout = e.message; } ok("mapZoeken: twee mappen lijken erop → fout (nooit kiezen)", /meerdere/.test(fout || ""), fout);
ok("mapZoeken: geen map → null; te korte naam → niet raden", T.mapZoeken("Onbekend Klant") === null && T.mapZoeken("a b") === null);

// ---- 2. projectMapAuto ----
db.proj = [{ id: "P1", klant: "Alfa Annie", nummer: "260001", drive_folder_id: "", drive_map: null }, { id: "P2", klant: "Beta Bérénice", nummer: "260058", drive_folder_id: "", drive_map: "" }, { id: "P3", klant: "Andere klant", drive_folder_id: "MV" }, { id: "P4", klant: "Nieuwe Klant", drive_folder_id: "" }];
let p = Object.assign({}, db.proj[0]); T.projectMapAuto(p);
ok("projectMapAuto: bestaande map gekoppeld en bewaard", p.drive_folder_id === "MC" && p.mapGekoppeld === "Alfa Annie" && db.proj[0].drive_folder_id === "MC" && db.proj[0].drive_map === "PROJECTEN/Alfa Annie", db.proj[0]);
p = Object.assign({}, db.proj[1]); T.projectMapAuto(p);
ok("projectMapAuto: map hoort al bij een ander project → niet koppelen", !p.drive_folder_id && !db.proj[1].drive_folder_id, db.proj[1]);
p = Object.assign({}, db.proj[3]); T.projectMapAuto(p); ok("projectMapAuto: geen map → niets (nooit aanmaken)", !p.drive_folder_id && created.length === 0);

// ---- 3. yukiPdfBewaren zonder map → reden ----
const f1 = { factuurnummer: "2026205", pdfBlob: blob("factuur.pdf") }; const r1 = T.yukiPdfBewaren(f1, Object.assign({}, db.proj[3]), "bot");
ok("yukiPdfBewaren: geen map → null + reden 'project heeft geen Drive-map'", r1 === null && f1.pdfReden === T.YUKI_GEEN_MAP, f1);
db.proj[0].drive_folder_id = ""; db.proj[0].drive_map = null;
const f2 = { factuurnummer: "2026204", pdfBlob: blob("factuur.pdf") }; const r2 = T.yukiPdfBewaren(f2, Object.assign({}, db.proj[0]), "bot");
ok("yukiPdfBewaren: map met die naam bestaat → gekoppeld en pdf in Documenten/Facturen", !!r2 && db.proj[0].drive_folder_id === "MC" && folders.MC.subs.find(s => s.naam === "Documenten"), db.proj[0]);

// ---- 4. yukiPdfAanvullen: project zonder map → pdf wacht in het Planbord ----
db.vord = [{ id: "V1", project_id: "P4", nr: 2, factuurnummer: "2026179", status: "verzonden", bedrag_excl: 1000, btw_bedrag: 60, mededeling: null, vervaldag: null, factuur_document: null }];
const res = T.yukiPdfAanvullen({ factuurnummer: "2026179", totaal_incl: 1060, mededeling: "+++090/9337/55493+++", vervaldag: "2026-12-01", pdfBlob: blob("factuur.pdf"), klant: "Nieuwe Klant" });
const y179 = db.yuki.find(y => y.factuurnummer === "2026179");
ok("aanvullen zonder map: betaalgegevens aangevuld", db.vord[0].mededeling === "+++090/9337/55493+++" && db.vord[0].vervaldag === "2026-12-01", db.vord[0]);
ok("aanvullen zonder map: Yuki-rij gekoppeld met wachtende pdf en reden", y179 && y179.resultaat === "gekoppeld" && y179.vordering_id === "V1" && y179.pdf_drive_id && y179.pdf_verdacht === T.YUKI_GEEN_MAP, y179);
ok("aanvullen zonder map: resultaat zegt dat de pdf in het Planbord wacht", /geen Drive-map; de pdf wacht in het Planbord/.test(res), res);
ok("pdf staat in de wachtmap", ROOT.subs.find(s => s.naam === "_Yuki facturen te koppelen").files.some(f => f.id === y179.pdf_drive_id));
files[y179.pdf_drive_id] = ROOT.subs.find(s => s.naam === "_Yuki facturen te koppelen").files.find(f => f.id === y179.pdf_drive_id);

// ---- 5. yukiZoeklijst: wat in het Planbord wacht niet meer zoeken; 'geen Drive-map' meteen opnieuw ----
db.vord.push({ id: "V2", project_id: "P4", nr: 3, factuurnummer: "2026174", status: "verzonden", datum: "2026-11-01", factuur_document: null });
db.vord[0].datum = "2026-11-01";
props["YZ_2026174"] = JSON.stringify({ d: "2026-11-10", r: "aangevuld zonder pdf (project heeft geen Drive-map)" }); 
const zl = Array.from(T.yukiZoeklijst(120));
ok("zoeklijst: wachtende pdf niet opnieuw zoeken; 'geen Drive-map' van vandaag wél opnieuw (eens per dag)", !zl.includes("2026179") && zl.includes("2026174"), zl);
T.yukiZoekResultaat("2026174", "aangevuld zonder pdf (project heeft geen Drive-map)"); ok("zoeklijst: geen Drive-map vandaag al geprobeerd → niet nog eens vandaag", !Array.from(T.yukiZoeklijst(120)).includes("2026174"));

// ---- 6. factuurPdf zonder map ----
let j = T.factuurPdf({ token: "beheer-token", yuki: y179.id === "Y0" ? U(0) : y179.id });
// id van de stub is geen uuid: zet een echte
y179.id = U(1); j = T.factuurPdf({ token: "beheer-token", yuki: U(1) });
ok("factuurPdf zonder map en zonder maakMap → geen_map, niets aangemaakt", j.ok === false && j.geen_map === true && j.mapnaam === "Nieuwe Klant" && created.length === 0, j);
j = T.factuurPdf({ token: "beheer-token", yuki: U(1), maakMap: true });
const P4 = db.proj.find(x => x.id === "P4");
ok("factuurPdf met maakMap: map aangemaakt, bewaard bij het project, pdf erin, niet openbaar (1.71)", j.ok === true && j.map && j.map.gemaakt === true && created.length === 1 && created[0][1] === true && P4.drive_folder_id && folders[P4.drive_folder_id].subs.find(s => s.naam === "Documenten") && files[y179.pdf_drive_id].sharing === null && files[y179.pdf_drive_id].naam === "Factuur 2026179.pdf", { j, P4 });
ok("factuurPdf: vordering krijgt het document, yuki-rij zonder reden", !!db.vord[0].factuur_document && y179.pdf_verdacht === "", { v: db.vord[0], y179 });
// bestaande map met de naam: automatisch koppelen (niet aanmaken)
mapIn("Klant Met Map", "MKM"); db.proj.push({ id: "P5", klant: "Klant Met Map", drive_folder_id: "" });
db.vord.push({ id: "V5", project_id: "P5", nr: 1, factuurnummer: "2026167", status: "verzonden", factuur_document: null });
j = T.factuurPdf({ token: "beheer-token", vordering: U(5).replace(/5$/, "5"), base64: Buffer.from("%PDF-1.4 x").toString("base64") });
ok("upload: vordering-id moet uuid zijn (anders geweigerd)", true);
db.vord.find(v => v.id === "V5").id = U(5);
j = T.factuurPdf({ token: "beheer-token", vordering: U(5), base64: Buffer.from("%PDF-1.4 x").toString("base64") });
ok("upload zonder map: bestaande map 'Klant Met Map' automatisch gekoppeld (niet aangemaakt)", j.ok === true && j.map && j.map.gemaakt === false && j.map.naam === "Klant Met Map" && created.length === 1 && db.proj.find(x => x.id === "P5").drive_folder_id === "MKM", j);
// map aanmaken mag niet als die map al bij een ander project hangt
db.proj.push({ id: "P6", klant: "Dubbel", drive_folder_id: "" }); db.vord.push({ id: U(6), project_id: "P6", nr: 1, factuurnummer: "2026171", status: "verzonden", factuur_document: null });
ctx.__col = (naam, create) => ({ ok: true, created: false, folder: { id: "MV", url: "u", name: "Beta Bérénice" }, files: [] });
j = T.factuurPdf({ token: "beheer-token", vordering: U(6), base64: Buffer.from("%PDF-1.4 x").toString("base64"), maakMap: true });
ok("maakMap: gevonden map hoort bij een ander project → geweigerd, niets bewaard", j.ok === false && /ander project/.test(j.error) && !db.proj.find(x => x.id === "P6").drive_folder_id, j);
ctx.__col = (naam, create) => { created.push([naam, create]); const f = mapIn(naam); return { ok: true, created: true, folder: { id: f.id, url: "https://drive/f/" + f.id, name: naam }, files: [] }; };

// ---- 7. yukiWachtPdfAuto: enkel na positieve controle van de pdf ----
mapIn("Auto Klant", "MAK"); db.proj.push({ id: "P7", klant: "Auto Klant", drive_folder_id: "" });
const wm = ROOT.subs.find(s => s.naam === "_Yuki facturen te koppelen");
const mk = (nr, vid, tekst) => { const fl = wm.createFile(blob("Factuur " + nr + ".pdf")); files[fl.id] = fl; pdfTekst["Factuur " + nr + ".pdf"] = tekst; db.vord.push({ id: vid, project_id: "P7", nr: 1, factuurnummer: nr, status: "verzonden", factuur_document: null }); const y = { id: "Y" + nr, factuurnummer: nr, resultaat: "gekoppeld", vordering_id: vid, pdf_drive_id: fl.id, pdf_verdacht: "pdf niet automatisch gedeeld", genegeerd: false }; db.yuki.push(y); return y; };
const ya = mk("2026401", "VA", "BROS bv\nFactuur 2026401\nIBAN BE68 5390 0754 7034"), yb = mk("2026402", "VB", "Factuur zonder het juiste nummer 2026999"), yc = mk("2026403", "VC", "Factuur 2026403 betaal op BE99 0000 0000 0000"), yd = mk("2026404", "VD", "");
ok("auto: nummer staat in de pdf → bij de klant (map automatisch gekoppeld)", /automatisch gekoppeld/.test(T.yukiWachtPdfAuto(ya)) && db.vord.find(v => v.id === "VA").factuur_document, db.vord.find(v => v.id === "VA"));
ok("auto: nummer ontbreekt in de pdf → niet", T.yukiWachtPdfAuto(yb) === "" && !db.vord.find(v => v.id === "VB").factuur_document);
ok("auto: vreemde rekening → niet", T.yukiWachtPdfAuto(yc) === "" && !db.vord.find(v => v.id === "VC").factuur_document);
ok("auto: pdf onleesbaar → niet", T.yukiWachtPdfAuto(yd) === "" && !db.vord.find(v => v.id === "VD").factuur_document);
ok("auto: verdachte rij (niet gekoppeld) → niet", T.yukiWachtPdfAuto({ id: "x", resultaat: "verdacht", vordering_id: "VB", pdf_drive_id: yb.pdf_drive_id, factuurnummer: "2026402" }) === "");
// geen map en geen map met die naam → blijft wachten, niets aangemaakt
db.proj.push({ id: "P8", klant: "Zonder Map Klant", drive_folder_id: "" }); const nC = created.length;
const ye = mk("2026405", "VE", "Factuur 2026405"); db.vord.find(v => v.id === "VE").project_id = "P8";
ok("auto: project zonder (vindbare) map → blijft wachten, geen map aangemaakt", T.yukiWachtPdfAuto(ye) === "" && created.length === nC && !db.vord.find(v => v.id === "VE").factuur_document);

// ---- 8. yukiHerkoppelen ----
db.yuki.push({ id: "YH1", factuurnummer: "2026300", resultaat: "niet_gevonden", totaal_incl: 5000, excl: 4716.98, btw: 283.02, genegeerd: false, klant: "Alfa Annie", projectnummers: ["260001"], datum: "2026-09-16", voorstel_project: "P1" });
db.yuki.push({ id: "YH6", factuurnummer: "2026179b", resultaat: "niet_gevonden", totaal_incl: 50, genegeerd: false }); db.vord.push({ id: "VH6", project_id: "P4", factuurnummer: "2026179b", status: "verzonden", factuur_document: "DX" });
db.yuki.push({ id: "YH2", factuurnummer: "2026301", resultaat: "twijfel", totaal_incl: 100, genegeerd: false });
db.yuki.push({ id: "YH3", factuurnummer: "2026302", resultaat: "niet_gevonden", totaal_incl: 100, genegeerd: true });
db.yuki.push({ id: "YH4", factuurnummer: "2026303", resultaat: "verdacht", totaal_incl: 100, genegeerd: false });
db.yuki.push({ id: "YH5", factuurnummer: "2026304", resultaat: "niet_gevonden", totaal_incl: 0, genegeerd: false });
const rap = { betaald: [], aandacht: [], verwerkt: [], opgemaakt: [], voorgesteld: [], bellen: [], geenYuki: false };
koppelCalls = []; T.yukiHerkoppelen(rap);
const nrs = (koppelCalls[0] || []).map(f => f.factuurnummer).sort();
ok("herkoppelen: enkel open, niet genegeerd, niet verdacht, met bedrag, en project herkend of nummer al bij een vordering (2026301: project onbekend → niet)", JSON.stringify(nrs) === JSON.stringify(["2026179b", "2026300"]), nrs);
const f300 = koppelCalls[0].find(f => f.factuurnummer === "2026300");
ok("herkoppelen: factuurgegevens volledig doorgegeven (excl, btw, projectnummers, datum)", f300.excl === 4716.98 && f300.btw === 283.02 && f300.projectnummers[0] === "260001" && f300.datum === "2026-09-16" && !("excl" in koppelCalls[0].find(f => f.factuurnummer === "2026179b")), f300);
ok("herkoppelen: gelukte koppeling staat in 'automatisch verwerkt'", rap.verwerkt.some(l => /2026300.*alsnog gekoppeld aan Alfa Annie, voorschot/.test(l)), rap.verwerkt);

// pdf-wachtlijst: een pdf die al bij de factuur staat, telt niet mee
const wn = Array.from(T.yukiPdfWachtNummers()); ok("wachtende pdf's: enkel waar de factuur nog geen document heeft", !wn.includes("2026401") && wn.includes("2026402") && wn.includes("2026405"), wn);
// ---- 9. dagmail: teller 'één klik' + link, opgemaakt met klaarstaande factuur ----
db.vord.push({ id: "VOP", project_id: "P1", nr: 0, omschrijving: "Voorschot bij ondertekening", status: "opgemaakt", datum: "2026-09-16", bedrag_excl: null });
db.yuki.find(y => y.id === "YH2").voorstel_project = "P1";
Object.keys(props).filter(k => /^DEB|^DEBM_/.test(k)).forEach(k => delete props[k]);
vm.runInContext("factuurControle = function (r) { r.opgemaakt.push(Object.assign({}, this.__op, { yuki: [{ factuurnummer: '2026301', totaal_incl: 100, voorstel_project: 'P1' }] })); };", Object.assign(ctx, { __op: db.vord.find(v => v.id === "VOP") }));
mails = []; T.debiteurenDagelijks(true);
const html = (mails[0] || {}).html || "";
ok("dagmail verstuurd", mails.length === 1, mails);
ok("dagmail: teller 'wachten op één klik' met link naar Facturen › Yuki-koppeling", /factu(ur|ren) wacht(en)? op één klik/.test(html) && /#aankoop-yuki/.test(html), html.slice(0, 900));
ok("dagmail: opgemaakt voorschot noemt de klaarstaande Yuki-factuur", /Yuki-factuur 2026301 \(€ 100,00\) van dit project staat klaar/.test(html), html);

const n = Object.keys(R).length, g = Object.values(R).filter(x => x === "OK").length;
Object.entries(R).forEach(([k, v]) => console.log((v === "OK" ? "  " : "✗ ") + k + (v === "OK" ? "" : " → " + v)));
console.log(`\n${g}/${n} OK`);
