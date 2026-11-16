// Code.gs 1.73.1: openbareLinksOpruimen — 25 tegelijk, onthoudt waar het was, gaat vanzelf verder
const fs = require("fs"), vm = require("vm"), path = require("path");
const src = fs.readFileSync(path.join(process.env.PB_REPO || path.join(__dirname, ".."), "drive/Code.gs"), "utf8");
const R = {}; const ok = (k, c, x) => { R[k] = c ? "OK" : "FOUT " + JSON.stringify(x === undefined ? null : x).slice(0, 400); };
const props = {}; const triggers = []; let fetchAlls = 0, deletes = []; let klok = 0;
const N = 1234;   // gedeelde documenten: d0000 … d1233; elk 10e is een dwg, elk 3e al privé
const docs = Array.from({ length: N }, (_, i) => ({ drive_id: "d" + String(i).padStart(4, "0") }));
const DateNep = class extends Date { static now() { return klok; } };
const ctx = { console, JSON, Math, Date: DateNep, String, Number, Array, Object, RegExp, Error, encodeURIComponent,
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] == null ? null : props[k], getProperties: () => Object.assign({}, props), setProperty(k, v) { props[k] = String(v); }, deleteProperty(k) { delete props[k]; } }) },
  ScriptApp: { getOAuthToken: () => "tok", getProjectTriggers: () => triggers.slice(), deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
    newTrigger: (f) => ({ timeBased: () => ({ after: (ms) => ({ create: () => triggers.push({ getHandlerFunction: () => f, ms }) }) }) }) },
  UrlFetchApp: { fetchAll: (reqs) => { fetchAlls++; klok += 10000; return reqs.map(q => { const id = decodeURIComponent(q.url.split("/files/")[1].split(/[/?]/)[0]); const i = Number(id.slice(1));
    if (q.method === "delete") { deletes.push(id); return { getResponseCode: () => 204, getContentText: () => "" }; }
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ mimeType: i % 10 === 0 ? "image/vnd.dwg" : "application/pdf", permissions: i % 3 === 0 ? [{ id: "u", type: "user" }] : [{ id: "anyoneWithLink", type: "anyone" }] }) }; }); } },
  Logger: { log(t) { ctx._log = t; } }, Utilities: {}, DriveApp: {}, GmailApp: {}, LockService: {}, CacheService: {}, ContentService: {}, Session: {} };
vm.createContext(ctx); vm.runInContext(src + "\n;this.__t = { openbareLinksOpruimen, openbareLinksProef, openbareLinksVerder };", ctx); const T = ctx.__t;
ctx.pbAdmin = (p) => { const o = Number((/offset=(\d+)/.exec(p) || [])[1] || 0); return docs.slice(o, o + 1000); };
const verwacht = { gelaten: docs.filter((_, i) => i % 10 === 0).length, al: docs.filter((_, i) => i % 10 !== 0 && i % 3 === 0).length };
verwacht.weg = N - verwacht.gelaten - verwacht.al;
// proef
let r = T.openbareLinksProef();
ok("proef: niets verwijderd, maar wel geteld (in delen van 4 min.)", deletes.length === 0 && !r.klaar && r.nagekeken > 0 && !triggers.length, r);
while (!r.klaar) r = T.openbareLinksProef();
ok("proef: na herhalen alle 1234 nagekeken (ook voorbij 1000 → paginering)", r.klaar && r.nagekeken === N && r.weg === verwacht.weg && r.gelaten === verwacht.gelaten && r.al === verwacht.al, [r, verwacht]);
// echt
fetchAlls = 0; r = T.openbareLinksOpruimen();
ok("25 tegelijk (fetchAll) in plaats van één per één", r.nagekeken === 25 * Math.ceil(r.nagekeken / 25) || r.klaar, r);
ok("niet klaar na 4 minuten → onthoudt de plaats en zet één trigger over een minuut", !r.klaar && props.OPENBARE_LINKS_POS === String(r.nagekeken) && triggers.length === 1 && triggers[0].getHandlerFunction() === "openbareLinksVerder" && triggers[0].ms === 60000, [r, props, triggers.length]);
let rondes = 1; while (triggers.length && rondes < 20) { rondes++; r = T.openbareLinksVerder(); }
ok("gaat vanzelf verder tot alles klaar is; dan geen trigger meer en de plaats gewist", r.klaar && !triggers.length && !props.OPENBARE_LINKS_POS && !props.OPENBARE_LINKS_TEL && rondes > 1, [r, rondes, triggers.length]);
ok("precies de openbare links van pdf's weggehaald, elk één keer", deletes.length === verwacht.weg && new Set(deletes).size === deletes.length && r.weg === verwacht.weg && !deletes.includes("d0000") && !deletes.includes("d0003"), [deletes.length, verwacht.weg]);
ok("tellers lopen door over de rondes heen", r.gelaten === verwacht.gelaten && r.al === verwacht.al, r);
ok("logboek zegt KLAAR", /KLAAR/.test(ctx._log), ctx._log);
Object.entries(R).forEach(([k, v]) => console.log((v === "OK" ? "  " : "✗ ") + k + (v === "OK" ? "" : " → " + v)));
console.log(`\n${Object.values(R).filter(x => x === "OK").length}/${Object.keys(R).length} OK`);
