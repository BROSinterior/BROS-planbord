// Code.gs 1.77: naservice — mails gebundeld per punt en ontvanger, automatische definitieve oplevering met proces-verbaal
const fs = require("fs"), vm = require("vm"), path = require("path");
const src = fs.readFileSync(path.join(process.env.PB_REPO || path.join(__dirname, ".."), "drive/Code.gs"), "utf8");
const R = {}; const ok = (k, c, x) => { R[k] = c ? "OK" : "FOUT " + JSON.stringify(x === undefined ? null : x).slice(0, 500); };
const cache = {}; let mails = [], gmails = [], patches = [], posts = [], bestanden = [];
const vandaag = new Date().toISOString().slice(0, 10);
const ctx = { console, JSON, Math, Date, String, Number, Array, Object, RegExp, Error, encodeURIComponent, Set,
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, getProperties: () => ({}), setProperty() { }, deleteProperty() { } }) },
  CacheService: { getScriptCache: () => ({ get: (k) => cache[k] || null, put(k, v) { cache[k] = v; }, remove(k) { delete cache[k]; } }) }, LockService: { getScriptLock: () => ({ waitLock() { }, releaseLock() { } }) },
  Utilities: { formatDate: (d, tz, f) => { const x = new Date(d); const p = (n) => String(n).padStart(2, "0"); return f === "yyyy-MM-dd" ? vandaag : p(x.getUTCDate()) + "/" + p(x.getUTCMonth() + 1) + "/" + x.getUTCFullYear() + (/HH/.test(f) ? " " + p(x.getUTCHours()) + ":" + p(x.getUTCMinutes()) : ""); },
    newBlob: (html, type, naam) => ({ html, getAs: (t) => ({ type: t, html, setName(n) { this.naam = n; return this; } }) }) },
  Logger: { log: (x) => { ctx.__log = (ctx.__log || []).concat(String(x)); } }, ContentService: {}, Session: {},
  MailApp: { getRemainingDailyQuota: () => 100 },
  DriveApp: { getFolderById: (id) => ({ id }) },
  GmailApp: { getAliases: () => [], sendEmail: (to, subject, text, opt) => (opt && opt.name === "BROS Planbord" ? gmails : mails).push({ to, subject, text, opt: opt || {} }) } };
vm.createContext(ctx); vm.runInContext(src + "\n;this.__t = { naserviceMeldingen, naserviceOpleveringen, opleveringPv, nsPlusMaanden, naserviceMail };", ctx); const T = ctx.__t;
// maanden optellen zoals Postgres
ok("plus maanden: 31/01 + 1 = 28/02, schrikkeljaar 29/02, 12 maanden", T.nsPlusMaanden("2026-01-31", 1) === "2026-02-28" && T.nsPlusMaanden("2027-01-31", 13) === "2028-02-29" && T.nsPlusMaanden("2026-11-18", 12) === "2027-11-18" && T.nsPlusMaanden("2026-12-15", -1) === "2026-11-15", [T.nsPlusMaanden("2026-01-31", 1), T.nsPlusMaanden("2027-01-31", 13)]);
const P = "aaaaaaaa-0000-0000-0000-000000000001", N1 = "bbbbbbbb-0000-0000-0000-000000000001", N2 = "bbbbbbbb-0000-0000-0000-000000000002";
const CK = "cccccccc-0000-0000-0000-000000000001", CA = "cccccccc-0000-0000-0000-00000000000a", LEAD = "33333333-3333-3333-3333-333333333333";
const oud = new Date(Date.now() - 600000).toISOString();
let EV = [
  { id: "e1", project_id: P, punt_id: N1, soort: "ontvangen", door_rol: "klant", door_naam: "Delta Daan", op: oud, created_at: oud, tekst: "Gemeld in het klantenportaal", fotos: [], zichtbaar_klant: true, zichtbaar_aannemer: true, melden: true },
  { id: "e2", project_id: P, punt_id: N2, soort: "aanvaard", door_rol: "bros", door_naam: "Noa", op: oud, created_at: oud, tekst: "", fotos: [], zichtbaar_klant: true, zichtbaar_aannemer: true, melden: true },
  { id: "e3", project_id: P, punt_id: N2, soort: "toegewezen", door_rol: "bros", door_naam: "Noa", op: oud, created_at: oud, tekst: "Toegewezen aan Omega Olaf\nGraag deze week", fotos: [], zichtbaar_klant: true, zichtbaar_aannemer: true, melden: true },
  { id: "e4", project_id: P, punt_id: N2, soort: "bericht", door_rol: "bros", door_naam: "Noa", op: oud, created_at: oud, tekst: "Intern voor de aannemer", fotos: [], zichtbaar_klant: false, zichtbaar_aannemer: true, melden: true },
  { id: "e5", project_id: P, punt_id: null, soort: "voorlopig", door_rol: "bros", door_naam: "Phil", op: oud, created_at: oud, tekst: "", fotos: [], zichtbaar_klant: true, zichtbaar_aannemer: false, melden: true },
];
const PUNTEN = [{ id: N1, project_id: P, nr: 1, titel: "Lade sluit niet", ruimte: "Keuken", status: "ontvangen", klant_zichtbaar: true, contact_id: null },
  { id: N2, project_id: P, nr: 2, titel: "Silicone douche", ruimte: "Badkamer", status: "aanvaard", klant_zichtbaar: true, contact_id: CA }];
let PROJ = { id: P, nummer: "260099", klant: "Delta Daan", naam: "Renovatie", adres: "Teststraat 12", postcode: "2018", gemeente: "Antwerpen", lead: LEAD, drive_folder_id: "fld",
  voorlopig_opgeleverd_op: "2025-11-01", oplevering_termijn_maanden: 12, oplevering_opmerking: "", definitief_opgeleverd_op: null, definitief_automatisch: false, definitief_pv_drive_id: null };
ctx.pbReq = (p) => p.includes("klant_naservice_punten") && p.includes(N1) ? [{ id: N1 }] : [];
ctx.callerAny = (tok) => { if (tok !== "ok") throw new Error("Geen login meegestuurd."); return { id: "k", name: "Delta Daan", role: "klant" }; };
ctx.pbAdmin = (p, m, b, prefer) => {
  if (m === "patch") { patches.push([p, b]); if (p.startsWith("/rest/v1/projecten")) Object.assign(PROJ, b); return []; }
  if (m === "post") { posts.push([p, b]); return [{ id: "doc1" }]; }
  if (p.startsWith("/rest/v1/naservice_gebeurtenissen")) { const m2 = /punt_id=eq\.([0-9a-f-]+)/.exec(p); if (p.includes("soort=eq.definitief")) return [{ id: "edef" }]; return EV.filter(e => !m2 || e.punt_id === m2[1]); }
  if (p.startsWith("/rest/v1/naservice_punten")) return PUNTEN.slice();
  if (p.startsWith("/rest/v1/projecten?voorlopig")) return [Object.assign({}, PROJ)];
  if (p.startsWith("/rest/v1/projecten")) return [Object.assign({}, PROJ)];
  if (p.startsWith("/rest/v1/project_contacten")) return [{ project_id: P, contact_id: CK, rol: "bouwheer" }, { project_id: P, contact_id: CA, rol: "aannemer" }];
  if (p.startsWith("/rest/v1/contacten")) return [{ id: CK, naam: "Delta Daan", contactpersoon: "", email: "klant@test.local", user_id: "u", actief: true }, { id: CA, naam: "Omega Olaf", contactpersoon: "Olaf", email: "olaf@test.local", user_id: "a", actief: true }].filter(c => p.includes(c.id));
  if (p.startsWith("/rest/v1/profiles")) return [{ id: LEAD, name: "Noa", email: "noa@test.local" }];
  return [];
};
ctx.pbIn = (voor, kol, ids, na) => ctx.pbAdmin(voor + kol + "=in.(" + [...new Set((ids || []).filter(Boolean))].join(",") + ")" + (na || ""), "get");
ctx.subfolder = (root, pad) => ({ pad, createFile: (blob) => { bestanden.push({ pad, blob }); return { getId: () => "drvPV", getName: () => blob.naam, getUrl: () => "https://drive.google.com/x", getSize: () => 1234 }; } });
let r = T.naserviceMeldingen();
const naar = (adres) => mails.concat(gmails).filter(m => m.to === adres);
ok("klant meldt → BROS (projectlead) krijgt een mail", naar("noa@test.local").length === 1 && /Lade sluit niet/.test(naar("noa@test.local")[0].subject), gmails.map(m => m.to + " " + m.subject));
ok("klant krijgt een ontvangstbevestiging", naar("klant@test.local").some(m => /goed ontvangen/.test(m.text) && /NS-001/.test(m.subject)), naar("klant@test.local").map(m => m.subject));
ok("gebundeld: één mail per punt en ontvanger (aanvaard + toegewezen samen)", naar("klant@test.local").filter(m => /NS-002/.test(m.subject)).length === 1 && /Aanvaard als naservice/.test(naar("klant@test.local").find(m => /NS-002/.test(m.subject)).text) && /Vakman ingeschakeld/.test(naar("klant@test.local").find(m => /NS-002/.test(m.subject)).text));
ok("klant ziet de interne opdracht voor de aannemer niet", !naar("klant@test.local").some(m => /Intern voor de aannemer/.test(m.text)));
ok("aannemer krijgt de toewijzing + het bericht, met uitleg en portaalknop", naar("olaf@test.local").length === 1 && /plan een datum/i.test(naar("olaf@test.local")[0].text) && /Intern voor de aannemer/.test(naar("olaf@test.local")[0].text) && naar("olaf@test.local")[0].opt.htmlBody.includes("BROS-planbord/aannemer/"), naar("olaf@test.local").map(m => m.text.slice(0, 200)));
ok("voorlopige oplevering: de klant krijgt uitleg met de datum van de definitieve oplevering", naar("klant@test.local").some(m => /voorlopig opgeleverd/.test(m.text) && /01\/11\/2026/.test(m.text)), naar("klant@test.local").map(m => m.subject));
ok("geen prijzen of interne velden in de mails", mails.concat(gmails).every(m => !/€/.test(m.text)));
ok("elke gebeurtenis gemarkeerd als gemeld (met wie)", ["e1", "e2", "e3", "e4", "e5"].every(id => patches.some(([p, b]) => p.includes("id=eq." + id) && b.gemeld_op)) && patches.find(([p]) => p.includes("id=eq.e3"))[1].gemeld_naar.includes("aannemer: olaf@test.local"), patches.map(x => x[0] + " " + (x[1].gemeld_naar || "")));
// direct vanuit het portaal: enkel een punt dat de klant zelf ziet
mails = []; gmails = []; let fout; try { T.naserviceMail({ id: N1, token: "x" }); } catch (e) { fout = e.message; }
ok("naservicemail vraagt een geldige login", fout && /login/.test(fout), fout);
r = T.naserviceMail({ id: N2, token: "ok" });
ok("naservicemail: enkel een punt dat de klant zelf ziet", r.ok === false && /Niet gevonden/.test(r.error), r);
// automatische definitieve oplevering (termijn verstreken)
mails = []; gmails = []; patches = []; posts = []; bestanden = [];
T.naserviceOpleveringen();
ok("termijn verstreken → definitief op de einddatum, automatisch", PROJ.definitief_opgeleverd_op === "2026-11-01" && PROJ.definitief_automatisch === true, PROJ);
ok("proces-verbaal (pdf) in Documenten/Oplevering", bestanden.length === 1 && bestanden[0].pad === "Documenten/Oplevering" && bestanden[0].blob.type === "application/pdf" && /^PV definitieve oplevering 260099/.test(bestanden[0].blob.naam), bestanden.map(b => b.pad + " " + b.blob.naam));
const html = bestanden[0] ? bestanden[0].blob.html : "";
ok("pv: voorbehoud met de open punten, termijn en datums", /Voorbehoud/.test(html) && /NS-001/.test(html) && /NS-002/.test(html) && /12 maanden/.test(html) && /01\/11\/2025/.test(html) && /01\/11\/2026/.test(html) && /na afloop van de termijn/.test(html), html.slice(0, 300));
ok("pv: geen prijzen", !/€/.test(html));
ok("pv gekoppeld en gedeeld met de klant (zonder dubbele documentmail)", PROJ.definitief_pv_drive_id === "drvPV" && posts.some(([p, b]) => /documenten/.test(p) && b[0].gedeeld === true) && patches.some(([p, b]) => /documenten\?id=eq\.doc1/.test(p) && b.gemeld_klant === true), [posts, patches.map(x => x[0])]);
ok("recente oplevering: klant gemaild met het pv als bijlage, BROS ook", mails.some(m => m.to === "klant@test.local" && /Definitieve oplevering/.test(m.subject) && m.opt.attachments && m.opt.attachments.length === 1) && gmails.some(m => m.to === "noa@test.local" && /Definitief opgeleverd/.test(m.subject)), mails.map(m => m.to).concat(gmails.map(m => m.to)));
// nog eens: geen tweede pv
bestanden = []; cache["q:1:pv:" + P] = undefined; delete cache["q:1:pv:" + P]; T.naserviceOpleveringen();
ok("geen tweede pv als het er al is", bestanden.length === 0);
// oude oplevering (nu pas aangevinkt): pv wel, klantmail niet
PROJ = Object.assign(PROJ, { voorlopig_opgeleverd_op: "2023-03-01", definitief_opgeleverd_op: null, definitief_pv_drive_id: null, definitief_automatisch: false }); mails = []; gmails = []; bestanden = []; Object.keys(cache).forEach(k => delete cache[k]);
T.naserviceOpleveringen();
ok("oude oplevering: pv gemaakt, klant niet gemaild, BROS wel (met uitleg)", bestanden.length === 1 && PROJ.definitief_opgeleverd_op === "2024-03-01" && !mails.length && gmails.some(m => /niet gemaild/.test(m.text)), [PROJ.definitief_opgeleverd_op, mails.length, gmails.map(m => m.text.slice(-80))]);
// termijn nog niet verstreken: niets
PROJ = Object.assign(PROJ, { voorlopig_opgeleverd_op: vandaag, definitief_opgeleverd_op: null, definitief_pv_drive_id: null }); bestanden = []; Object.keys(cache).forEach(k => delete cache[k]); patches = [];
T.naserviceOpleveringen();
ok("termijn loopt nog: niets gewijzigd", bestanden.length === 0 && !patches.length && PROJ.definitief_opgeleverd_op === null);
Object.entries(R).forEach(([k, v]) => console.log((v === "OK" ? "  " : "✗ ") + k + (v === "OK" ? "" : " → " + v)));
console.log(`\n${Object.values(R).filter(x => x === "OK").length}/${Object.keys(R).length} OK`);
