// Code.gs 1.74.1: afspraak met meerdere mensen van BROS — initialen in de titel, collega's als gast via de Calendar-API
// met sendUpdates=none: GEEN uitnodigings-, wijzigings- of annuleringsmails (CalendarApp.addGuest wordt niet meer gebruikt).
const fs = require("fs"), vm = require("vm"), path = require("path");
const src = fs.readFileSync(path.join(process.env.PB_REPO || path.join(__dirname, ".."), "drive/Code.gs"), "utf8");
const R = {}; const ok = (k, c, x) => { R[k] = c ? "OK" : "FOUT " + JSON.stringify(x === undefined ? null : x).slice(0, 400); };
const props = {}; const patches = []; const api = []; let apiUit = false;
// nagebootste agenda: één item, met gasten en een agenda-API
let ev = null;
const mkEv = (titel) => ({ id: "ev1@google.com", summary: titel, attendees: [{ email: "fotograaf@extern.local", responseStatus: "accepted" }], getId() { return this.id; },
  getGuestList() { return this.attendees.map(a => ({ getEmail: () => a.email })); },
  addGuest() { throw new Error("addGuest gebruikt (stuurt uitnodigingen)"); }, removeGuest() { throw new Error("removeGuest gebruikt"); },
  setTitle(t) { this.summary = t; }, setTime() { }, setLocation() { }, setDescription(d) { this.description = d; }, deleteEvent() { ev = null; ctx.__wegCalApp = true; } });
const ctx = { console, JSON, Math, Date, String, Number, Array, Object, RegExp, Error, encodeURIComponent,
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] == null ? null : props[k], getProperties: () => Object.assign({}, props), setProperty(k, v) { props[k] = v; }, deleteProperty(k) { delete props[k]; } }) },
  Utilities: { parseDate: (s) => new Date(s.replace(" ", "T") + ":00Z"), formatDate: (d) => new Date(d).toISOString().slice(0, 10) },
  CacheService: { getScriptCache: () => ({ get: () => null, put() { } }) }, LockService: { getScriptLock: () => ({ waitLock() { }, releaseLock() { } }) },
  ScriptApp: { getOAuthToken: () => "tok" },
  UrlFetchApp: { fetch: (url, o) => { api.push({ url, methode: o.method, body: o.payload ? JSON.parse(o.payload) : null });
    if (apiUit) return { getResponseCode: () => 403, getContentText: () => '{"error":{"message":"Google Calendar API has not been used in project 123 before or it is disabled.","status":"PERMISSION_DENIED","details":[{"reason":"SERVICE_DISABLED"}]}}' };
    if (o.method === "get") return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ attendees: ev.attendees }) };
    if (o.method === "patch") { const b = JSON.parse(o.payload); Object.assign(ev, b); return { getResponseCode: () => 200, getContentText: () => "{}" }; }
    if (o.method === "delete") { ev = null; return { getResponseCode: () => 204, getContentText: () => "" }; }
  } },
  Logger: { log() { } }, DriveApp: {}, GmailApp: { sendEmail() { throw new Error("geen mail verwacht"); } }, ContentService: {}, Session: {} };
vm.createContext(ctx); vm.runInContext(src + "\n;this.__t = { afspraakSyncIn };", ctx); const T = ctx.__t;
const B = "11111111-1111-1111-1111-111111111111", M = "33333333-3333-3333-3333-333333333333", N = "55555555-5555-5555-5555-555555555555";
const PROF = [{ id: B, name: "Phil", initials: "PB", email: "info@test.local", role: "beheer" }, { id: M, name: "Noa", initials: "NDK", email: "noa@test.local", role: "medewerker" },
  { id: N, name: "Thomas", initials: "", email: "Thomas@Test.local", role: "medewerker" }];
let taak = { id: "aaaaaaaa-1111-0000-0000-000000000001", project_id: "p1", titel: "Bespreking", afspraak: "kantoor", start: "2026-11-20", afspraak_van: "10:00:00", afspraak_tot: "11:30:00",
  afspraak_adres: "BROS", afspraak_onderwerp: "Voorontwerp", assignee: B, afspraak_team: [M, N], afspraak_agenda: true, afspraak_mailen: false, afspraak_contacten: [], agenda_event_id: null };
ctx.pbAdmin = (p, m, b) => {
  if (m === "patch") { patches.push([p, b]); return []; }
  if (p.startsWith("/rest/v1/taken")) return [Object.assign({}, taak)];
  if (p.startsWith("/rest/v1/projecten")) return [{ nummer: "260099", klant: "Alfa", naam: "Renovatie" }];
  if (p.startsWith("/rest/v1/profiles?id=")) return PROF.filter(r => p.includes(r.id));
  if (p.startsWith("/rest/v1/profiles?role=in.")) return PROF.map(r => ({ email: r.email }));
  return [];
};
ctx.agendaKalender = () => ({ getId: () => "kantoor@test.local", getEventById: () => ev, createEvent: (t, b, e, o) => { ev = mkEv(t); ev.attendees = []; ev.description = o.description; return ev; } });
const gasten = () => (ev.attendees || []).map(a => a.email.toLowerCase()).sort();
const stil = () => api.every(a => /[?&]sendUpdates=none(&|$)/.test(a.url));
let r = T.afspraakSyncIn({}, taak.id);
ok("nieuw: titel met ieders initialen (PB + NDK + TH)", r.agenda === "gezet" && ev && ev.summary === "PB + NDK + TH/Alfa, Voorontwerp", [r, ev && ev.summary]);
ok("nieuw: iedereen die meegaat als gast (ook de verantwoordelijke), niet de eigenaar van de agenda", JSON.stringify(gasten()) === JSON.stringify(["info@test.local", "noa@test.local", "thomas@test.local"]), gasten());
ok("GEEN mails: elke aanroep met sendUpdates=none, nooit addGuest", stil() && api.length === 2 && api[1].methode === "patch" && api[0].url.includes("/events/ev1?"), api.map(a => a.methode + " " + a.url));
ok("beschrijving noemt de namen", /BROS: Phil, Noa, Thomas/.test(ev.description), ev.description);
// wijzigen: een collega gaat niet meer mee; een gast die je zelf toevoegde blijft (met zijn antwoord)
ev.attendees.push({ email: "fotograaf@extern.local", responseStatus: "accepted" });
taak.agenda_event_id = "ev1@google.com"; taak.afspraak_team = [M]; api.length = 0;
r = T.afspraakSyncIn({}, taak.id);
ok("collega uitgevinkt → als gast weg, eigen gast blijft met zijn antwoord, titel bijgewerkt", r.agenda === "gewijzigd" && JSON.stringify(gasten()) === JSON.stringify(["fotograaf@extern.local", "info@test.local", "noa@test.local"]) && ev.attendees.find(a => a.email === "fotograaf@extern.local").responseStatus === "accepted" && ev.summary === "PB + NDK/Alfa, Voorontwerp", [gasten(), ev.summary]);
ok("wijzigen: ook stil (sendUpdates=none)", stil() && api.length === 2, api.map(a => a.url));
// verwijderen: stil via de API
taak.afspraak = null; api.length = 0;
r = T.afspraakSyncIn({ weg: true }, taak.id);
ok("afspraak weg → item stil verwijderd via de API (geen annuleringsmail)", r.agenda === "verwijderd" && ev === null && api.length === 1 && api[0].methode === "delete" && stil() && !ctx.__wegCalApp, [r, api]);
// Calendar-API niet aangezet: duidelijke melding, en zeker geen mails
taak.afspraak = "kantoor"; taak.agenda_event_id = null; ev = null; apiUit = true; api.length = 0;
r = T.afspraakSyncIn({}, taak.id);
ok("Calendar-API niet aan → afspraak staat wel in de BROS-agenda, melding hoe je ze aanzet, geen gasten", r.agenda === "gezet" && /Services/.test(r.waarschuwing || "") && gasten().length === 0, r);
Object.entries(R).forEach(([k, v]) => console.log((v === "OK" ? "  " : "✗ ") + k + (v === "OK" ? "" : " → " + v)));
console.log(`\n${Object.values(R).filter(x => x === "OK").length}/${Object.keys(R).length} OK`);
