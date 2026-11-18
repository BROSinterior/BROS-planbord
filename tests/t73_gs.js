// Code.gs 1.73: rechtstreeks factureren in Yuki (proefmodus, yukiFactuur) en afspraken uit de Google Agenda (agendaWeek)
const fs = require("fs"), vm = require("vm"), path = require("path");
const src = fs.readFileSync(path.join(process.env.PB_REPO || path.join(__dirname, ".."), "drive/Code.gs"), "utf8");
const R = {}; const ok = (k, c, x) => { R[k] = c ? "OK" : "FOUT " + JSON.stringify(x === undefined ? null : x).slice(0, 400); };
const props = {}; const cache = {}; const calls = []; const patches = [];
const ctx = { console, JSON, Math, Date, String, Number, Array, Object, RegExp, Error, Set, Map, encodeURIComponent, isFinite,
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] == null ? null : props[k], getProperties: () => Object.assign({}, props), setProperty(k, v) { props[k] = v; }, deleteProperty(k) { delete props[k]; } }) },
  CacheService: { getScriptCache: () => ({ get: (k) => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
  LockService: { getScriptLock: () => ({ waitLock() { }, releaseLock() { } }) },
  Utilities: { formatDate: (d, tz, f) => { const x = new Date(d); const iso = x.toISOString(); return f === "yyyy-MM-dd" ? iso.slice(0, 10) : f === "HH:mm" ? iso.slice(11, 16) : iso; } },
  Session: { getScriptTimeZone: () => "UTC" },
  UrlFetchApp: { fetch: (url, o) => { calls.push({ url, o }); const m = /<(\w+) xmlns/.exec(o.payload.split("<soap:Body>")[1]) || []; const meth = m[1];
    const body = meth === "Authenticate" ? "<AuthenticateResult>SID-123</AuthenticateResult>" : "<ProcessSalesInvoicesResult>&lt;SalesInvoicesImportResponse&gt;&lt;TotalSucceeded&gt;1&lt;/TotalSucceeded&gt;&lt;TotalFailed&gt;0&lt;/TotalFailed&gt;&lt;Invoice&gt;&lt;Succeeded&gt;true&lt;/Succeeded&gt;&lt;Message&gt;Factuur aangemaakt&lt;/Message&gt;&lt;/Invoice&gt;&lt;/SalesInvoicesImportResponse&gt;</ProcessSalesInvoicesResult>";
    return { getResponseCode: () => 200, getContentText: () => `<?xml version="1.0"?><soap:Envelope><soap:Body><${meth}Response>${body}</${meth}Response></soap:Body></soap:Envelope>` }; } },
  Logger: { log() { } }, DriveApp: {}, GmailApp: {}, ScriptApp: {}, ContentService: {} };
vm.createContext(ctx);
vm.runInContext(src + "\n;this.__t = { yukiFactuur, agendaWeek, yukiFactuurXml };", ctx); const T = ctx.__t;
const V = { id: "eeeeeeee-0000-0000-0000-000000000003", project_id: "p1", status: "opgemaakt", vast_op: "2026-11-16T10:00:00Z", bedrag_excl: 1168, btw_bedrag: 220.08, yuki_verstuurd_op: null };
const P = { nummer: "260099", klant: "Alfa Annie", bedrijf: "", btw_nummer: "", adres: "Teststraat 1", postcode: "2000", gemeente: "Antwerpen", email1: "klant@test.local", factuur_email1: false };
ctx.caller = () => ({ id: "b", role: "beheer" });
ctx.pbAdmin = (p, m, b) => { if (m === "patch") { patches.push([p, b]); return []; } if (p.startsWith("/rest/v1/vorderingen")) return [Object.assign({}, V)]; if (p.startsWith("/rest/v1/projecten")) return [P]; if (p.startsWith("/rest/v1/taken")) return [{ agenda_event_id: "ev-planbord" }]; return []; };
const regels = [{ tarief: 6, excl: 168 }, { tarief: 21, excl: 1000 }];
// ---- proef ----
let r = T.yukiFactuur({ token: "t", id: V.id, regels, omschrijving: "Vordering 3 (project 260099)" });
ok("proef (geen YUKI_FACTUUR_ADMIN_ID): niets naar Yuki, wel de xml terug", r.ok && r.proef && calls.length === 0 && /<Process>false<\/Process>/.test(r.xml) && /<EmailToCustomer>false/.test(r.xml), r);
ok("proef: 2 regels (6 % en 21 %) met de juiste bedragen", /<SalesPrice>168\.00<\/SalesPrice><VATPercentage>6\.00/.test(r.xml) && /<SalesPrice>1000\.00<\/SalesPrice><VATPercentage>21\.00/.test(r.xml) && r.regels.length === 2, r.xml);
ok("proef: klant, adres en vervaldag (15 dagen)", /<FullName>Alfa Annie<\/FullName>/.test(r.xml) && /<Zipcode>2000/.test(r.xml) && r.vervaldag > r.datum, r);
ok("1.79: btw-codes volgens Yuki Support (21 % = 1, 6 % = 2), geen waarschuwing", /<SalesPrice>168\.00<\/SalesPrice><VATPercentage>6\.00<\/VATPercentage><VATIncluded>false<\/VATIncluded><VATType>2<\/VATType>/.test(r.xml) && /<VATPercentage>21\.00<\/VATPercentage><VATIncluded>false<\/VATIncluded><VATType>1<\/VATType>/.test(r.xml) && !r.waarschuwingen.some(w => /YUKI_BTW/.test(w)), [r.xml, r.waarschuwingen]);
ok("1.79: omzetrekening 700000", (r.xml.match(/<GLAccountCode>700000<\/GLAccountCode>/g) || []).length === 2 && r.rekening === "700000", r.xml);
ok("1.79: bij 6 % de wettelijke vermelding in de opmerkingen (met het projectnummer)", /<Remarks>Project 260099\n\nBtw-tarief: Bij gebrek aan schriftelijke betwisting/.test(r.xml) && /geldboeten\.<\/Remarks>/.test(r.xml) && /Btw-tarief/.test(r.opmerking), r.xml.slice(0, 900));
ok("1.79: geen verwijzing meer naar een proefadministratie", !r.waarschuwingen.some(w => /proefadministratie/.test(w)), r.waarschuwingen);
const v21 = Object.assign({}, V); V.btw_bedrag = 245.28; let r21 = T.yukiFactuur({ token: "t", id: V.id, regels: [{ tarief: 21, excl: 1168 }], omschrijving: "x" }); V.btw_bedrag = v21.btw_bedrag;
ok("1.79: zonder 6 % geen btw-vermelding, enkel het project", r21.ok && /<Remarks>Project 260099<\/Remarks>/.test(r21.xml), r21.xml && r21.xml.slice(0, 500));
props.YUKI_BTW_21 = "99"; props.YUKI_OMZET_REKENING = "700003"; let rx = T.yukiFactuur({ token: "t", id: V.id, regels, omschrijving: "x" }); delete props.YUKI_BTW_21; delete props.YUKI_OMZET_REKENING;
ok("1.79: scripteigenschappen gaan voor op de standaard", /<VATType>99<\/VATType>/.test(rx.xml) && /<GLAccountCode>700003/.test(rx.xml), rx.xml);
ok("xml: tekens worden ge-escaped", /&lt;b&gt;/.test(T.yukiFactuurXml({ onderwerp: "<b>", regels: [], klant: "x" })));
// ---- controles ----
r = T.yukiFactuur({ token: "t", id: V.id, regels: [{ tarief: 6, excl: 100 }], omschrijving: "x" });
ok("bedrag ≠ vastgezet bedrag → geweigerd", !r.ok && /vastgezette bedrag/.test(r.error), r);
r = T.yukiFactuur({ token: "t", id: V.id, regels: [{ tarief: 7, excl: 1168 }], omschrijving: "x" });
ok("onbekend btw-tarief → geweigerd", !r.ok, r);
const oud = Object.assign({}, V); V.vast_op = null;
r = T.yukiFactuur({ token: "t", id: V.id, regels, omschrijving: "x" }); ok("niet vastgezet → geweigerd", !r.ok && /klaar staat voor Yuki/.test(r.error), r); V.vast_op = oud.vast_op;
let fout = ""; ctx.caller = () => { throw new Error("Alleen beheerders"); }; try { T.yukiFactuur({ token: "t", id: V.id, regels }); } catch (e) { fout = e.message; } ok("enkel beheer", /beheer/i.test(fout), fout); ctx.caller = () => ({ id: "b", role: "beheer" });
// ---- echt (proefadministratie) ----
props.YUKI_FACTUUR_ADMIN_ID = "ADMIN-PROEF"; props.YUKI_API_KEY = "sleutel";
V.btw_bedrag = 0; r = T.yukiFactuur({ token: "t", id: V.id, regels: [{ tarief: 0, excl: 1168 }], omschrijving: "x" }); V.btw_bedrag = 220.08;
ok("met administratie: 0 % (verlegd) zonder code → geweigerd, niets verstuurd", !r.ok && /YUKI_BTW_0/.test(r.error) && calls.length === 0, r);
props.YUKI_API_URL = "https://api.yukiworks.be/ws/Accounting.asmx";
r = T.yukiFactuur({ token: "t", id: V.id, regels, omschrijving: "Vordering 3" });
const proc = calls.find(c => /ProcessSalesInvoices/.test(c.o.payload));
ok("echt: aanmelden + ProcessSalesInvoices op Sales.asmx", r.ok && calls.length === 2 && calls.every(c => c.url === "https://api.yukiworks.be/ws/Sales.asmx") && !!proc, [r, calls.map(c => c.url)]);
ok("echt: xmlDoc als xml (niet ge-escaped), administratie en sessie mee, Process=false", proc && /<xmlDoc><SalesInvoices xmlns="urn:xmlns:http:\/\/www.theyukicompany.com:salesinvoices"/.test(proc.o.payload) && /<administrationId>ADMIN-PROEF<\/administrationId>/.test(proc.o.payload) && /<sessionID>SID-123<\/sessionID>/.test(proc.o.payload) && /<Process>false/.test(proc.o.payload), proc && proc.o.payload.slice(0, 600));
ok("echt: btw-codes in de regels", proc && /<VATType>2<\/VATType>/.test(proc.o.payload) && /<VATType>1<\/VATType>/.test(proc.o.payload));
ok("echt: vordering gemarkeerd als doorgestuurd", patches.length === 1 && patches[0][1].yuki_verstuurd_op && /aangemaakt/.test(patches[0][1].yuki_bericht), patches);
r = T.yukiFactuur({ token: "t", id: V.id, regels, omschrijving: "x" });
ok("meteen opnieuw → geweigerd (één keer per vordering)", !r.ok && calls.length === 2, r);
V.yuki_verstuurd_op = "2026-11-16T10:05:00Z"; cache["q:1:yukifactuur:" + V.id] = null;
r = T.yukiFactuur({ token: "t", id: V.id, regels, omschrijving: "x" }); ok("al doorgestuurd → geweigerd", !r.ok && /al naar Yuki/.test(r.error), r);
// ---- agendaWeek ----
const ev = (id, titel, s, e, o) => Object.assign({ getId: () => id, getTitle: () => titel, getLocation: () => "", isAllDayEvent: () => false, getStartTime: () => new Date(s), getEndTime: () => new Date(e), getGuestList: () => [], getCreators: () => ["kantoor@test.local"], getVisibility: () => "DEFAULT" }, o || {});
ctx.agendaKalender = () => ({ getEvents: () => [ev("ev-planbord", "PB/ Werfbezoek", "2026-11-16T09:00:00Z", "2026-11-16T10:00:00Z"), ev("ev-1", "NDK/ Showroom Alfa", "2026-11-17T13:00:00Z", "2026-11-17T14:30:00Z"),
  ev("ev-2", "Tandarts", "2026-11-18T08:00:00Z", "2026-11-18T09:00:00Z", { getVisibility: () => "PRIVATE", getGuestList: () => [{ getEmail: () => "Medewerker@test.local" }] })] });
r = T.agendaWeek({ token: "t", van: "2026-11-16", tot: "2026-11-22" });
ok("agenda: afspraken van het Planbord zelf weggelaten", r.ok && r.items.length === 2 && !r.items.some(i => i.id === "ev-planbord"), r);
const a1 = r.items.find(i => i.id === "ev-1"), a2 = r.items.find(i => i.id === "ev-2");
ok("agenda: dag, van en tot", a1 && a1.dag === "2026-11-17" && a1.van === "13:00" && a1.tot === "14:30", a1);
ok("agenda: privé → 'Bezet', deelnemers in kleine letters", a2 && a2.titel === "Bezet" && a2.gasten[0] === "medewerker@test.local", a2);
ok("agenda: ongeldige periode → geweigerd", !T.agendaWeek({ token: "t", van: "x", tot: "2026-11-22" }).ok && !T.agendaWeek({ token: "t", van: "2026-01-01", tot: "2026-12-31" }).ok);
Object.entries(R).forEach(([k, v]) => console.log((v === "OK" ? "  " : "✗ ") + k + (v === "OK" ? "" : " → " + v)));
console.log(`\n${Object.values(R).filter(x => x === "OK").length}/${Object.keys(R).length} OK`);
