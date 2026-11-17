// Code.gs 1.74: afspraak met meerdere mensen van BROS — initialen in de titel, collega's als gast op het agenda-item
const fs = require("fs"), vm = require("vm"), path = require("path");
const src = fs.readFileSync(path.join(process.env.PB_REPO || path.join(__dirname, ".."), "drive/Code.gs"), "utf8");
const R = {}; const ok = (k, c, x) => { R[k] = c ? "OK" : "FOUT " + JSON.stringify(x === undefined ? null : x).slice(0, 400); };
const props = {}; const patches = [];
const ctx = { console, JSON, Math, Date, String, Number, Array, Object, RegExp, Error, encodeURIComponent,
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] == null ? null : props[k], getProperties: () => Object.assign({}, props), setProperty(k, v) { props[k] = v; }, deleteProperty(k) { delete props[k]; } }) },
  Utilities: { parseDate: (s) => new Date(s.replace(" ", "T") + ":00Z"), formatDate: (d, tz, f) => new Date(d).toISOString().slice(0, 10) },
  CacheService: { getScriptCache: () => ({ get: () => null, put() { } }) }, LockService: { getScriptLock: () => ({ waitLock() { }, releaseLock() { } }) },
  Logger: { log() { } }, DriveApp: {}, GmailApp: { sendEmail() { throw new Error("geen mail verwacht"); } }, ScriptApp: {}, ContentService: {}, Session: {}, UrlFetchApp: {} };
vm.createContext(ctx); vm.runInContext(src + "\n;this.__t = { afspraakSyncIn, afsGastenBijwerken };", ctx); const T = ctx.__t;
const B = "11111111-1111-1111-1111-111111111111", M = "33333333-3333-3333-3333-333333333333", N = "55555555-5555-5555-5555-555555555555";
const PROF = [{ id: B, name: "Phil", initials: "PB", email: "kantoor@test.local", role: "beheer" }, { id: M, name: "Noa", initials: "NDK", email: "noa@test.local", role: "medewerker" },
  { id: N, name: "Thomas", initials: "", email: "Thomas@Test.local", role: "medewerker" }];
let taak = { id: "aaaaaaaa-1111-0000-0000-000000000001", project_id: "p1", titel: "Bespreking", afspraak: "kantoor", start: "2026-11-20", afspraak_van: "10:00:00", afspraak_tot: "11:30:00",
  afspraak_adres: "BROS", afspraak_onderwerp: "Voorontwerp", assignee: B, afspraak_team: [M, N], afspraak_agenda: true, afspraak_mailen: false, afspraak_contacten: [], agenda_event_id: null };
ctx.pbAdmin = (p, m, b) => {
  if (m === "patch") { patches.push([p, b]); return []; }
  if (p.startsWith("/rest/v1/taken")) return [Object.assign({}, taak)];
  if (p.startsWith("/rest/v1/projecten")) return [{ nummer: "260099", klant: "Alfa", naam: "Renovatie" }];
  if (p.startsWith("/rest/v1/profiles?id=eq.")) return PROF.filter(r => p.includes(r.id));
  if (p.startsWith("/rest/v1/profiles?id=in.")) return PROF.filter(r => p.includes(r.id));
  if (p.startsWith("/rest/v1/profiles?role=in.")) return PROF.map(r => ({ email: r.email }));
  return [];
};
// nagebootst agenda-item
let ev = null; const mkEv = (titel) => { const g = [{ getEmail: () => "fotograaf@extern.local" }]; return { id: "ev1", titel, gasten: g, getId: () => "ev1", setTitle(t) { this.titel = t; }, setTime() { }, setLocation() { }, setDescription(d) { this.besch = d; },
  getGuestList() { return this.gasten.slice(); }, addGuest(m) { this.gasten.push({ getEmail: () => m }); }, removeGuest(m) { this.gasten = this.gasten.filter(x => x.getEmail().toLowerCase() !== m); }, deleteEvent() { ev = null; } }; };
ctx.agendaKalender = () => ({ getId: () => "kantoor@test.local", getEventById: () => ev, createEvent: (t, b, e, o) => { ev = mkEv(t); ev.besch = o.description; return ev; } });
let r = T.afspraakSyncIn({}, taak.id);
ok("agenda-item gezet met de initialen van iedereen (PB + NDK + TH)", r.agenda === "gezet" && ev && ev.titel === "PB + NDK + TH/Alfa, Voorontwerp", [r, ev && ev.titel]);
const gasten = () => ev.getGuestList().map(g => g.getEmail().toLowerCase()).sort();
ok("collega's als gast (kleine letters), niet de eigenaar van de agenda; andere gast blijft", JSON.stringify(gasten()) === JSON.stringify(["fotograaf@extern.local", "noa@test.local", "thomas@test.local"]), gasten());
ok("beschrijving noemt de namen", /BROS: Phil, Noa, Thomas/.test(ev.besch), ev.besch);
taak.agenda_event_id = "ev1"; taak.afspraak_team = [M];
r = T.afspraakSyncIn({}, taak.id);
ok("collega niet meer mee → als gast weggehaald; titel bijgewerkt", r.agenda === "gewijzigd" && JSON.stringify(gasten()) === JSON.stringify(["fotograaf@extern.local", "noa@test.local"]) && ev.titel === "PB + NDK/Alfa, Voorontwerp", [gasten(), ev.titel]);
taak.afspraak_onderwerp = "PB/ Voorontwerp"; r = T.afspraakSyncIn({}, taak.id);
ok("zelf initialen in het onderwerp → die blijven voorrang krijgen", ev.titel === "PB/Alfa, Voorontwerp", ev.titel);
taak.afspraak_onderwerp = "Voorontwerp"; taak.afspraak_team = []; r = T.afspraakSyncIn({}, taak.id);
ok("zonder team: zoals vroeger (enkel de verantwoordelijke), collega's weg als gast", ev.titel === "PB/Alfa, Voorontwerp" && JSON.stringify(gasten()) === JSON.stringify(["fotograaf@extern.local"]), [ev.titel, gasten()]);
Object.entries(R).forEach(([k, v]) => console.log((v === "OK" ? "  " : "✗ ") + k + (v === "OK" ? "" : " → " + v)));
console.log(`\n${Object.values(R).filter(x => x === "OK").length}/${Object.keys(R).length} OK`);
