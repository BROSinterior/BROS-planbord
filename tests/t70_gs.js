// Code.gs 1.70: vaste instellingen uit de scripteigenschappen (instelling, instellingenBewaren)
const fs = require("fs"), vm = require("vm"), path = require("path");
const src = fs.readFileSync(path.join(process.env.PB_REPO || path.join(__dirname, ".."), "drive/Code.gs"), "utf8");
const R = {}; const ok = (k, c, x) => { R[k] = c ? "OK" : "FOUT " + JSON.stringify(x === undefined ? null : x).slice(0, 300); };
const props = {};
const ctx = { console, JSON, Math, Date, String, Number, Array, Object, RegExp, Error, Set, Map, encodeURIComponent,
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] == null ? null : props[k], getProperties: () => Object.assign({}, props), setProperty(k, v) { props[k] = v; }, deleteProperty(k) { delete props[k]; } }) },
  Logger: { log() { } }, Utilities: {}, DriveApp: {}, GmailApp: {}, ScriptApp: {}, LockService: {}, CacheService: {}, ContentService: {}, UrlFetchApp: {}, Session: {} };
vm.createContext(ctx); vm.runInContext(src + "\n;this.__t = { CONFIG, YUKI, instelling, instellingenBewaren };", ctx); const T = ctx.__t;
ok("zonder scripteigenschap en met VUL-IN in de code → leeg", T.CONFIG.PROJECTEN_FOLDER_ID === "" && T.YUKI.PLANBORD_URL === "");
let fout = ""; try { T.instellingenBewaren(); } catch (e) { fout = e.message; }
ok("instellingenBewaren zonder waarden → duidelijke fout, niets bewaard", /Niet ingevuld/.test(fout) && !Object.keys(props).length, fout);
// zoals Code.ingevuld.gs: de waarden staan in de code
const ingevuld = src.replace('instelling("PROJECTEN_FOLDER_ID", "VUL-IN")', 'instelling("PROJECTEN_FOLDER_ID", "map-projecten")').replace('instelling("SJABLOON_FOLDER_ID", "VUL-IN")', 'instelling("SJABLOON_FOLDER_ID", "map-sjabloon")')
  .replace('instelling("PLANBORD_URL", "VUL-IN")', 'instelling("PLANBORD_URL", "https://test.supabase.co")').replace('instelling("PLANBORD_KEY", "VUL-IN")', 'instelling("PLANBORD_KEY", "sb_publishable_test")').replace('instelling("BOT_EMAIL", "VUL-IN")', 'instelling("BOT_EMAIL", "bot@test.local")');
const c2 = Object.assign({}, ctx); vm.createContext(c2); vm.runInContext(ingevuld + "\n;this.__t = { CONFIG, YUKI, instellingenBewaren };", c2);
c2.__t.instellingenBewaren();
ok("instellingenBewaren met de ingevulde versie → 5 scripteigenschappen", props.PROJECTEN_FOLDER_ID === "map-projecten" && props.SJABLOON_FOLDER_ID === "map-sjabloon" && props.PLANBORD_URL === "https://test.supabase.co" && props.PLANBORD_KEY === "sb_publishable_test" && props.BOT_EMAIL === "bot@test.local", props);
const c3 = Object.assign({}, ctx); vm.createContext(c3); vm.runInContext(src + "\n;this.__t = { CONFIG, YUKI };", c3);
ok("daarna: de gewone Code.gs (met VUL-IN) leest de scripteigenschappen", c3.__t.CONFIG.PROJECTEN_FOLDER_ID === "map-projecten" && c3.__t.YUKI.BOT_EMAIL === "bot@test.local");
props.PROJECTEN_FOLDER_ID = "andere-map"; const c4 = Object.assign({}, ctx); vm.createContext(c4); vm.runInContext(ingevuld + "\n;this.__t = { CONFIG };", c4);
ok("scripteigenschap wint van een waarde in de code", c4.__t.CONFIG.PROJECTEN_FOLDER_ID === "andere-map");
const c5 = Object.assign({}, ctx); vm.createContext(c5); vm.runInContext(src + "\n;this.__t = { docPrive, docPortaalBaar };", c5);
ok("1.71: documenten standaard privé; pdf, jpg en Google-documenten kan het portaal tonen, dwg niet", c5.__t.docPrive() === true && c5.__t.docPortaalBaar("application/pdf") && c5.__t.docPortaalBaar("image/jpeg") && c5.__t.docPortaalBaar("application/vnd.google-apps.document") && !c5.__t.docPortaalBaar("image/vnd.dwg") && !c5.__t.docPortaalBaar("application/vnd.ms-excel"));
props.DOCUMENTEN_PRIVE = "nee"; const c6 = Object.assign({}, ctx); vm.createContext(c6); vm.runInContext(src + "\n;this.__t = { docPrive };", c6);
ok("1.71: DOCUMENTEN_PRIVE = nee zet het oude gedrag terug", c6.__t.docPrive() === false);
Object.entries(R).forEach(([k, v]) => console.log((v === "OK" ? "  " : "✗ ") + k + (v === "OK" ? "" : " → " + v)));
console.log(`\n${Object.values(R).filter(x => x === "OK").length}/${Object.keys(R).length} OK`);
