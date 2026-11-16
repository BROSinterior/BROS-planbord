/* =====================================================================
   BROS Planbord — modules laden wanneer ze nodig zijn (v1.72)
   De grote onderdelen die je niet bij elk bezoek gebruikt, laadt het Planbord pas wanneer je ze opent (en anders
   stilletjes enkele seconden na het opstarten, zodat ze klaarstaan):
     teken   → vendor/dxf-parser.js, symbolen.js, tekenen.js, plan2cad.js   (tab Plannen: tekenmodule + Plan2CAD)
     renders → renders.js                                                  (tab Renders, Instellingen › Renders)
     excel   → jszip, meetstaat-export.js, meetstaat-import.js             (meetstaat importeren/exporteren, Excel-export)
   De bestanden zelf zijn ongewijzigd; enkel het moment van laden verschuift. Geladen vóór app.js.
   ===================================================================== */
const MODULES = {
  teken: ["vendor/dxf-parser.js", "symbolen.js", "tekenen.js", "plan2cad.js"],
  renders: ["renders.js"],
  excel: ["https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js", "meetstaat-export.js", "meetstaat-import.js"],
};
const MOD = { bezig: {}, klaar: {} };
function laadScript(src) {
  return new Promise((ok, nok) => {
    const s = document.createElement("script");
    s.src = /^https?:/.test(src) ? src : src + "?v=" + (typeof APP_VERSION !== "undefined" ? APP_VERSION : "");
    s.async = false; s.onload = () => ok(); s.onerror = () => { s.remove(); nok(new Error("Kon " + src + " niet laden — controleer de verbinding.")); };
    document.head.appendChild(s);
  });
}
/** module laden (één keer; scripts in volgorde) → Promise */
function laadModule(naam) {
  if (MOD.klaar[naam]) return Promise.resolve();
  if (MOD.bezig[naam]) return MOD.bezig[naam];
  MOD.bezig[naam] = (async () => { for (const src of MODULES[naam]) await laadScript(src); MOD.klaar[naam] = true; })()
    .catch((e) => { delete MOD.bezig[naam]; throw e; });
  return MOD.bezig[naam];
}
/** voor in een render-functie: true als de module er is; anders starten met laden en daarna opnieuw tekenen */
function moduleKlaar(naam) {
  if (MOD.klaar[naam]) return true;
  laadModule(naam).then(() => { if (typeof render === "function") render(); }, (e) => { if (typeof toast === "function") toast(e.message, 6000); });
  return false;
}
const moduleLaden = (wat) => `<div class="panel"><div class="empty"><b>${wat} laden…</b></div></div>`;
/* na het opstarten: de modules stilletjes alvast ophalen, zodat ze klaarstaan als je ze opent */
function modulesVoorladen() {
  const doe = () => ["renders", "teken", "excel"].reduce((p, n) => p.then(() => laadModule(n).catch(() => { })), Promise.resolve());
  if ("requestIdleCallback" in window) setTimeout(() => requestIdleCallback(doe, { timeout: 10000 }), 4000); else setTimeout(doe, 6000);
}
