// Code.gs (1.66) in een vm met stubs: yukiBewaar, yukiBewaarVerdacht, factuurPdf
const fs = require("fs"), vm = require("vm");
const src = fs.readFileSync(require("path").join(process.env.PB_REPO || require("path").join(__dirname, ".."), "drive/Code.gs"), "utf8");
const calls = []; let R = {}; const ok = (k, c, x) => { R[k] = c ? "OK" : "FOUT " + JSON.stringify(x).slice(0, 400); };
let nid = 0; const mkFile = (naam) => ({ id: "F" + (++nid), naam, map: null, sharing: null, getId() { return this.id; }, getName() { return this.naam; }, setName(n) { this.naam = n; return this; }, moveTo(m) { this.map = m; }, setSharing(a, p) { this.sharing = a + "/" + p; }, getUrl() { return "https://drive/" + this.id; }, getSize() { return 1234; }, isTrashed() { return false; } });
const mkFolder = (naam) => ({ naam, subs: [], files: [], getName() { return this.naam; }, getFolders() { let i = 0; const s = this.subs; return { hasNext: () => i < s.length, next: () => s[i++] }; }, createFolder(n) { const f = mkFolder(n); this.subs.push(f); return f; },
  getFilesByName(n) { const l = this.files.filter(f => f.naam === n); let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; }, createFile(blob) { const f = mkFile(blob.getName()); f.map = this; this.files.push(f); return f; } });
const projecten = mkFolder("PROJECTEN"); const projMap = mkFolder("Delta"); projecten.subs.push(projMap);
const files = {}; const blob = (naam, bytes) => ({ naam, bytes: bytes || [37, 80, 68, 70, 45], getName() { return this.naam; }, setName(n) { this.naam = n; return this; }, getBytes() { return this.bytes; }, copyBlob() { return blob(this.naam, this.bytes); } });
let db = { yuki: [], vord: [{ id: "V3", project_id: "P", nr: 3, factuurnummer: "2026-031", status: "verzonden", factuur_document: null }], proj: [{ id: "P", drive_folder_id: "PM" }] };
const ctx = {
  console, JSON, Math, Date, String, Number, Array, Object, RegExp, Error, encodeURIComponent, parseInt, isNaN,
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => k === "SERVICE_KEY" ? "sb_secret_test" : null, getProperties: () => ({ SERVICE_KEY: "sb_secret_test" }), setProperty() { }, deleteProperty() { } }) },
  DriveApp: { getFolderById: (id) => id === "PM" ? projMap : projecten, getFileById: (id) => { if (!files[id]) throw new Error("niet gevonden"); return files[id]; }, Access: { ANYONE_WITH_LINK: "LINK" }, Permission: { VIEW: "VIEW" } },
  Utilities: { newBlob: (bytes, mime, naam) => blob(naam, Array.from(bytes)), base64Decode: (s) => Array.from(Buffer.from(s, "base64")) },
  GmailApp: { getMessageById: () => null }, ScriptApp: {}, LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() { } }) }, ContentService: {}, UrlFetchApp: {}, Logger: { log() { } }, Session: {},
};
vm.createContext(ctx);
vm.runInContext(src + "\n;this.__t = { yukiBewaar, yukiBewaarVerdacht, factuurPdf, CONFIG, PORTAAL, YUKI_WACHTMAP };", ctx);
const T = ctx.__t;
// stubs die het script zelf definieert, overschrijven
vm.runInContext(`
  Object.defineProperty(CONFIG, "PROJECTEN_FOLDER_ID", { value: "ROOT" });
  onderProjecten = function () { };
  caller = function (token, beheer) { if (token !== "beheer-token") throw new Error("Geen toegang."); return { id: "B", role: "beheer" }; };
  yukiPdfVerdacht = function (f) { return f.verdacht || ""; };
`, ctx);
ctx.pbAdmin = function (path, method, body, prefer) {
  calls.push({ path, method, body, prefer });
  if (/^\/rest\/v1\/yuki_facturen\?select=id&limit=1/.test(path)) return [];
  if (/^\/rest\/v1\/yuki_facturen\?factuurnummer=eq\.([^&]+)&select/.test(path)) { const nr = decodeURIComponent(RegExp.$1); return db.yuki.filter(y => y.factuurnummer === nr); }
  if (/^\/rest\/v1\/yuki_facturen\?on_conflict/.test(path)) { if (/ignore-duplicates/.test(prefer) && db.yuki.some(y => y.factuurnummer === body.factuurnummer)) return null; const i = db.yuki.findIndex(y => y.factuurnummer === body.factuurnummer); if (i >= 0) Object.assign(db.yuki[i], body); else db.yuki.push(Object.assign({ id: "Y" + db.yuki.length }, body)); return null; }
  if (/^\/rest\/v1\/yuki_facturen\?id=eq\.([^&]+)&select/.test(path)) { const id = RegExp.$1; return db.yuki.filter(y => y.id === id); }
  if (/^\/rest\/v1\/yuki_facturen\?id=eq\.([^&]+)$/.test(path)) { const y = db.yuki.find(y => y.id === RegExp.$1); Object.assign(y, body); return null; }
  if (/^\/rest\/v1\/vorderingen\?id=eq\.([^&]+)&select/.test(path)) { const id = RegExp.$1; return db.vord.filter(v => v.id === id); }
  if (/^\/rest\/v1\/vorderingen\?id=eq\.([^&]+)$/.test(path)) { Object.assign(db.vord.find(v => v.id === RegExp.$1), body); return null; }
  if (/^\/rest\/v1\/projecten\?id=eq\.([^&]+)/.test(path)) { const id = RegExp.$1; return db.proj.filter(p => p.id === id); }
  if (/^\/rest\/v1\/documenten/.test(path)) return [{ id: "DOC1" }];
  throw new Error("onverwacht: " + path);
};
vm.runInContext("pbAdmin = this.pbAdmin;", ctx);
// uuid() accepteert enkel uuid's: geef echte vorm
const U = (x) => "aaaaaaaa-0000-0000-0000-00000000000" + x;
// 1. niet gevonden → rij + pdf in de wachtmap
T.yukiBewaar({ factuurnummer: "2026-031", datum: "2026-11-10", klant: "Delta", onderwerp: "Factuur van BROS", totaal_incl: 178.08, mededeling: "+++1+++", vervaldag: "2026-12-10", projectnummers: ["260099"], mail: "m1", pdfBlob: blob("factuur.pdf") },
  { resultaat: "niet gevonden", reden: "bedrag wijkt af", project_id: "P" });
const y1 = db.yuki[0]; const wacht = projecten.subs.find(f => f.naam === T.YUKI_WACHTMAP);
ok("niet gevonden: rij met resultaat niet_gevonden, reden, voorstel_project, mail_id", y1 && y1.resultaat === "niet_gevonden" && y1.reden === "bedrag wijkt af" && y1.voorstel_project === "P" && y1.mail_id === "m1" && !y1.vordering_id, y1);
ok("pdf wacht in PROJECTEN/_Yuki facturen te koppelen", wacht && wacht.files.length === 1 && wacht.files[0].naam === "Factuur 2026-031.pdf" && y1.pdf_drive_id === wacht.files[0].id, wacht && wacht.files);
// zelfde factuur opnieuw: geen tweede pdf, rij bijgewerkt (upsert)
T.yukiBewaar({ factuurnummer: "2026-031", totaal_incl: 178.08, pdfBlob: blob("factuur.pdf") }, { resultaat: "twijfel", reden: "meerdere projecten" });
ok("opnieuw: geen dubbele pdf, resultaat twijfel", wacht.files.length === 1 && db.yuki.length === 1 && db.yuki[0].resultaat === "twijfel", db.yuki);
// 2. automatisch gekoppeld mét gedeelde pdf → geen wachtende pdf
db.vord.push({ id: "V9", project_id: "P", nr: 9, factuurnummer: "2026-050", status: "verzonden", factuur_document: "DOCX" });
T.yukiBewaar({ factuurnummer: "2026-050", totaal_incl: 10, pdfBlob: blob("f.pdf") }, { resultaat: "gekoppeld", vordering_id: "V9", project_id: "P" });
const y2 = db.yuki.find(y => y.factuurnummer === "2026-050");
ok("gekoppeld met pdf: rij gekoppeld + vordering_id, geen wachtende pdf", y2.resultaat === "gekoppeld" && y2.vordering_id === "V9" && !y2.pdf_drive_id && wacht.files.length === 1, y2);
// 3. gekoppeld maar pdf niet gedeeld (verdacht) → pdf wacht + reden
db.vord.push({ id: "V8", project_id: "P", nr: 8, factuurnummer: "2026-051", status: "verzonden", factuur_document: null });
T.yukiBewaar({ factuurnummer: "2026-051", totaal_incl: 10, pdfBlob: blob("f.pdf"), verdacht: "de factuur-pdf vermeldt een andere rekening" }, { resultaat: "gekoppeld", vordering_id: "V8" });
const y3 = db.yuki.find(y => y.factuurnummer === "2026-051");
ok("gekoppeld zonder gedeelde pdf: pdf wacht, pdf_verdacht ingevuld", y3.resultaat === "gekoppeld" && y3.pdf_drive_id && /andere rekening/.test(y3.pdf_verdacht), y3);
// 4. verdacht: enkel als er nog geen rij is
T.yukiBewaarVerdacht({ factuurnummer: "2026-031", klant: "X" });
ok("verdacht overschrijft een bestaande rij niet", db.yuki.find(y => y.factuurnummer === "2026-031").resultaat === "twijfel");
T.yukiBewaarVerdacht({ factuurnummer: "2026-077", klant: "Vreemd" });
ok("verdacht: nieuwe rij met resultaat verdacht", (db.yuki.find(y => y.factuurnummer === "2026-077") || {}).resultaat === "verdacht");
// 4b. manueel gekoppeld → later opnieuw verwerkt als 'niet gevonden': niet terugdraaien
db.yuki.push({ id: "YM", factuurnummer: "2026-060", resultaat: "gekoppeld", vordering_id: "VM", handmatig: true, mail_id: "m60", datum: "2026-11-01" });
T.yukiBewaar({ factuurnummer: "2026-060", totaal_incl: 5 }, { resultaat: "niet gevonden" });
const ym = db.yuki.find(y => y.id === "YM"); ok("manuele koppeling wordt niet teruggedraaid", ym.resultaat === "gekoppeld" && ym.vordering_id === "VM", ym);
// 4c. bestaande rij: lege waarden overschrijven niets (archief zonder datum)
T.yukiBewaar({ factuurnummer: "2026-031", totaal_incl: 178.08, mailId: "archief-xyz" }, { resultaat: "niet gevonden" });
const y1b = db.yuki.find(y => y.factuurnummer === "2026-031"); ok("lege datum en klant overschrijven bestaande niet; geen tweede pdf", y1b.datum === "2026-11-10" && y1b.klant === "Delta" && wacht.files.filter(f => f.naam === "Factuur 2026-031.pdf").length === 1, y1b);
// 4d. verdacht uit het archief: totaal uit de tekst
T.yukiBewaarVerdacht({ factuurnummer: "2026-078", klant: "Z", tekst: "Factuurnummer: 2026-078\nTotaalbedrag : EUR 1.234,56" });
ok("verdacht (archief): totaal uit de mailtekst", (db.yuki.find(y => y.factuurnummer === "2026-078") || {}).totaal_incl === 1234.56, db.yuki.find(y => y.factuurnummer === "2026-078"));
// 5. factuurPdf: wachtende pdf naar de projectmap
y1.id = U(1); y1.vordering_id = "V3"; y1.resultaat = "niet_gevonden"; files[y1.pdf_drive_id] = wacht.files[0];
let jj = T.factuurPdf({ token: "beheer-token", yuki: U(1) }); ok("factuurPdf: niet gekoppelde yuki-rij → geweigerd", jj.ok === false, jj);
y1.resultaat = "gekoppeld";
let j = T.factuurPdf({ token: "x", yuki: U(1) }); ok("factuurPdf: enkel beheer", j.ok === false && /beheerder/.test(j.error), j);
j = T.factuurPdf({ token: "beheer-token", yuki: U(1) });
const fac = projMap.subs.find(f => f.naam === "Documenten"); const factMap = fac && fac.subs.find(f => f.naam === "Facturen");
ok("factuurPdf (yuki): pdf verplaatst naar Documenten/Facturen, hernoemd, NIET openbaar (1.71)", j.ok && wacht.files[0].map === factMap && wacht.files[0].naam === "Factuur 2026-031.pdf" && wacht.files[0].sharing === null, { j, m: wacht.files[0].map && wacht.files[0].map.naam });
db.vord.find(v => v.id === "V3").factuurnummer = "ANDER"; y1.id = U(5); const jx = T.factuurPdf({ token: "beheer-token", yuki: U(5) }); ok("factuurPdf: ander factuurnummer op de vordering → geweigerd", jx.ok === false && /verschilt/.test(jx.error), jx); db.vord.find(v => v.id === "V3").factuurnummer = "2026-031"; y1.id = U(1);
ok("factuurPdf: document geregistreerd (gedeeld) en aan de factuur gehangen", db.vord.find(v => v.id === "V3").factuur_document === "DOC1" && calls.some(c => /documenten/.test(c.path) && c.body.gedeeld === true && c.body.pad === "Documenten/Facturen"), calls.slice(-3));
// 6. upload
db.vord.push({ id: U(2), project_id: "P", nr: 2, factuurnummer: "2026-020", status: "verzonden", factuur_document: null });
j = T.factuurPdf({ token: "beheer-token", vordering: U(2), base64: Buffer.from("niet pdf").toString("base64") }); ok("upload: geen pdf → geweigerd", j.ok === false && /geen pdf/.test(j.error), j);
j = T.factuurPdf({ token: "beheer-token", vordering: U(2), base64: Buffer.from("%PDF-1.4 test").toString("base64") });
ok("upload: pdf in Documenten/Facturen als 'Factuur 2026-020.pdf'", j.ok && factMap.files.some(f => f.naam === "Factuur 2026-020.pdf" && f.sharing === null), j);
db.vord.push({ id: U(3), project_id: "P", nr: 3, factuurnummer: "", status: "opgemaakt" });
j = T.factuurPdf({ token: "beheer-token", vordering: U(3), base64: Buffer.from("%PDF-1.4").toString("base64") }); ok("niet verstuurde vordering → geweigerd", j.ok === false, j);
for (const [k, v] of Object.entries(R)) console.log((v === "OK" ? "  " : "✗ ") + k + (v === "OK" ? "" : "  → " + v));
console.log(`\n${Object.values(R).filter(v => v === "OK").length}/${Object.keys(R).length} OK`);
