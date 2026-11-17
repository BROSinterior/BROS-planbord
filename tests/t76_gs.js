// Code.gs 1.76: goedgekeurd meer-/minderwerk → mail met de bevestiging (pdf, zonder prijzen) aan de gekoppelde aannemer(s)
const fs = require("fs"), vm = require("vm"), path = require("path");
const src = fs.readFileSync(path.join(process.env.PB_REPO || path.join(__dirname, ".."), "drive/Code.gs"), "utf8");
const R = {}; const ok = (k, c, x) => { R[k] = c ? "OK" : "FOUT " + JSON.stringify(x === undefined ? null : x).slice(0, 400); };
const cache = {}; const mails = []; const patches = []; let quota = 100;
const ctx = { console, JSON, Math, Date, String, Number, Array, Object, RegExp, Error, encodeURIComponent,
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, getProperties: () => ({}), setProperty() { }, deleteProperty() { } }) },
  CacheService: { getScriptCache: () => ({ get: (k) => cache[k] || null, put(k, v) { cache[k] = v; } }) }, LockService: { getScriptLock: () => ({ waitLock() { }, releaseLock() { } }) },
  Utilities: {}, Logger: { log() { } }, ContentService: {}, Session: {},
  MailApp: { getRemainingDailyQuota: () => quota },
  DriveApp: { getFileById: (id) => ({ getBlob: () => ({ id, setContentType(t) { this.type = t; return this; } }) }) },
  GmailApp: { getAliases: () => [], sendEmail: (to, subject, text, opt) => mails.push({ to, subject, text, opt }) } };
vm.createContext(ctx); vm.runInContext(src + "\n;this.__t = { meerwerkMail, portaalMail };", ctx); const T = ctx.__t;
const G = "aaaaaaaa-7600-0000-0000-000000000001", C1 = "cccccccc-7600-0000-0000-000000000001", C2 = "cccccccc-7600-0000-0000-000000000002", C3 = "cccccccc-7600-0000-0000-000000000003";
let g = { id: G, project_id: "p1", soort: "meerwerk", status: "akkoord", titel: "Meerwerk badkamer", toelichting: "Zoals besproken op de werf", beslist_op: "2026-11-17T09:30:00Z", beslist_naam: "Delta Daan", bevestiging_drive_id: "drvMW",
  posten: [{ code: "1.3", omschrijving: "Extra tegels badkamer", locatie: "badkamer", hoeveelheid: 2, eenheid: "m2", prijs: 123.45, totaal: 246.9, status: "meerwerk" }, { code: "1.4", omschrijving: "Plinten <weg>", hoeveelheid: 3, eenheid: "lm", prijs: 9.87, totaal: -29.61, status: "minwerk" }] };
let rijen = [{ id: "r1", contact_id: C1 }, { id: "r2", contact_id: C2 }, { id: "r3", contact_id: C3 }];
const CONT = [{ id: C1, naam: "Omega Olaf", contactpersoon: "", email: " olaf@test.local ", user_id: "u1" }, { id: C2, naam: "Kappa Kris", contactpersoon: "Kris", email: "kris@test.local", user_id: null }, { id: C3, naam: "Zonder Mail", email: "", user_id: null }];
ctx.caller = (tok) => { if (tok !== "ok") throw new Error("Geen toegang."); return { id: "b", name: "Phil", role: "beheer" }; };
ctx.pbAdmin = (p, m, b) => {
  if (m === "patch") { patches.push([p, b]); return []; }
  if (p.startsWith("/rest/v1/goedkeuringen")) return [Object.assign({}, g)];
  if (p.startsWith("/rest/v1/goedkeuring_aannemers")) return rijen.slice();
  if (p.startsWith("/rest/v1/contacten")) return CONT.filter(c => p.includes(c.id));
  if (p.startsWith("/rest/v1/projecten")) return [{ nummer: "260099", klant: "Delta Daan", naam: "Renovatie", adres: "Teststraat 12", gemeente: "Antwerpen" }];
  return [];
};
let r; try { T.meerwerkMail({ id: G, token: "fout" }); r = "geen fout"; } catch (e) { r = e.message; }
ok("zonder geldige login (team) geen mail", r === "Geen toegang." && mails.length === 0, r);
r = T.meerwerkMail({ id: G, token: "ok" });
ok("mail naar elke aannemer met een e-mailadres", r.ok && JSON.stringify(r.naar) === JSON.stringify(["olaf@test.local", "kris@test.local"]) && mails.length === 2, [r, mails.map(m => m.to)]);
ok("zonder e-mailadres: gemeld als 'zonder'", JSON.stringify(r.zonder) === JSON.stringify(["Zonder Mail"]), r.zonder);
ok("pdf als bijlage (uit Drive, application/pdf)", mails.every(m => m.opt.attachments && m.opt.attachments.length === 1 && m.opt.attachments[0].id === "drvMW" && m.opt.attachments[0].type === "application/pdf"), mails.map(m => m.opt.attachments));
ok("geen prijzen in de mail (geen € of bedragen)", mails.every(m => !/€|123[,.]45|246[,.]9|9[,.]87|29[,.]61/.test(m.opt.htmlBody + m.text)), mails[0].opt.htmlBody.slice(0, 300));
ok("posten met hoeveelheid en soort, escaped", /Extra tegels badkamer/.test(mails[0].opt.htmlBody) && /Plinten &lt;weg&gt;/.test(mails[0].opt.htmlBody) && /Minwerk/.test(mails[0].opt.htmlBody) && /2 m2/.test(mails[0].text), mails[0].text);
ok("goedkeuring van de klant vermeld", /Delta Daan/.test(mails[0].opt.htmlBody) && /goedgekeurd/i.test(mails[0].subject), mails[0].subject);
ok("met login: knop naar het aannemersportaal; zonder login: antwoorden op de mail", mails[0].opt.htmlBody.includes("BROS-planbord/aannemer/") && /Ontvangen/.test(mails[0].opt.htmlBody) && !mails[1].opt.htmlBody.includes("BROS-planbord/aannemer/") && /antwoorden/.test(mails[1].opt.htmlBody));
ok("aanhef met de contactpersoon", /Beste Kris,/.test(mails[1].text), mails[1].text.slice(0, 40));
ok("gemeld_op enkel gezet voor wie gemaild werd", patches.length === 2 && patches[0][0].includes("id=eq.r1") && patches[1][0].includes("id=eq.r2") && patches.every(x => x[1].gemeld_op), patches);
const n0 = mails.length; r = T.meerwerkMail({ id: G, token: "ok" });
ok("meteen opnieuw (zelfde rijen) → geweigerd, geen dubbele mail", !r.ok && /net al/.test(r.error) && mails.length === n0, r);
rijen = []; r = T.meerwerkMail({ id: G, token: "ok" });
ok("iedereen al gemeld → niets te doen", r.ok && r.naar.length === 0 && mails.length === n0, r);
rijen = [{ id: "r9", contact_id: C1 }]; g.status = "geannuleerd"; r = T.meerwerkMail({ id: G, token: "ok" });
ok("niet (meer) goedgekeurd → geen mail", !r.ok && /niet \(meer\) goedgekeurd/.test(r.error) && mails.length === n0, r);
g.status = "akkoord"; g.bevestiging_drive_id = null; r = T.meerwerkMail({ id: G, token: "ok" });
ok("nog geen pdf → geen mail", !r.ok && /pdf/.test(r.error) && mails.length === n0, r);
g.bevestiging_drive_id = "drvMW"; g.soort = "offerte"; r = T.meerwerkMail({ id: G, token: "ok" });
ok("enkel meer-/minderwerk", !r.ok && mails.length === n0, r);
g.soort = "meerwerk"; quota = 5; rijen = [{ id: "r10", contact_id: C1 }]; r = T.meerwerkMail({ id: G, token: "ok" });
ok("dagquotum op → duidelijke fout, niet als gemeld gezet", !r.ok && /quotum/.test(r.error) && mails.length === n0, r);
T.portaalMail("x@test.local", "Onderwerp", "t", "<p>h</p>");
ok("portaalMail zonder bijlagen: zoals vroeger", !("attachments" in mails[mails.length - 1].opt));
Object.entries(R).forEach(([k, v]) => console.log((v === "OK" ? "  " : "✗ ") + k + (v === "OK" ? "" : " → " + v)));
console.log(`\n${Object.values(R).filter(x => x === "OK").length}/${Object.keys(R).length} OK`);
