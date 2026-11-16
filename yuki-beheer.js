/* =====================================================================
   BROS Planbord — Yuki-koppeling (script 062, v1.66; v1.67: voorstellen, één klik, projectmap) — enkel beheer
   Elke factuur van BROS (uit Yuki) hoort bij een vordering: dan staat ze bij de klant in het portaal, met de pdf, in de
   betaalgegevens en in het bankdossier. Het Drive-script koppelt automatisch als nummer en bedrag kloppen; wat niet lukt,
   verschijnt hier (Facturen › Yuki-koppeling) om manueel te koppelen. Daarnaast: verstuurde facturen zonder factuurnummer
   of zonder pdf. Geladen vóór app.js; deb-beheer.js toont het tabblad, app.js telt mee in de badge van Facturen.
   1.67: per factuur een voorstel (project + vordering) met hoe zeker het is; "Alle zekere koppelen" in één keer; een project zonder
   Drive-map krijgt bij het koppelen of delen meteen zijn map (bestaande map met die naam, anders aangemaakt); vorderingen die al
   lang op "Op te maken" staan, met de Yuki-factuur die erbij lijkt te horen. Het Drive-script probeert elke werkdag zelf opnieuw.
   ===================================================================== */
const yukiOk = () => schemaV() >= 62 && isBeheer();
const yukiAlle = () => Object.values(S.yuki_facturen || {});
const yukiOpen = () => yukiAlle().filter(y => y.resultaat !== "gekoppeld" && !y.genegeerd).sort((a, b) => (b.datum || "").localeCompare(a.datum || "") || (b.factuurnummer || "").localeCompare(a.factuurnummer || ""));
const yukiPdfWacht = () => yukiAlle().filter(y => y.resultaat === "gekoppeld" && y.pdf_drive_id && y.vordering_id && S.vorderingen[y.vordering_id] && !S.vorderingen[y.vordering_id].factuur_document && !y.genegeerd);
const YUKI_DAGEN = 120;   // meldingen over verstuurde facturen: enkel recente (oude facturen van vóór de koppeling blijven buiten beeld)
const vordVerstuurd = () => Object.values(S.vorderingen || {}).filter(v => (v.status === "verzonden" || v.status === "betaald") && S.projecten[v.project_id] && !S.projecten[v.project_id].intern && (v.datum || "") >= addDays(todayIso, -YUKI_DAGEN));
const vordZonderNr = () => vordVerstuurd().filter(v => !String(v.factuurnummer || "").trim());
const vordZonderPdf = () => { const wacht = new Set(yukiPdfWacht().map(y => y.vordering_id)); return vordVerstuurd().filter(v => String(v.factuurnummer || "").trim() && !v.factuur_document && !wacht.has(v.id)); };
const yukiTeDoen = () => yukiOk() ? yukiOpen().length + yukiPdfWacht().length + vordZonderNr().length + vordZonderPdf().length : 0;
const YUKI_RES = { niet_gevonden: ["Niet gevonden", "st-offerte"], twijfel: ["Twijfel", "st-on_hold"], verdacht: ["Verdacht", "st-verloren"], gekoppeld: ["Gekoppeld", "st-lopend"] };
const yukiKeuze = () => (S.yukiKeuze = S.yukiKeuze || {});   // per Yuki-factuur: gekozen project en vordering (blijft bij een nieuwe weergave)
/* vorderingen die een Yuki-factuur kunnen krijgen: nog niet verstuurd, of verstuurd zonder factuurnummer */
const yukiKandidaten = (pid) => Object.values(S.vorderingen || {}).filter(v => v.project_id === pid && !String(v.factuurnummer || "").trim() && ["opgemaakt", "verzonden", "betaald"].includes(v.status)).sort((a, b) => a.nr - b.nr);
const yukiCalc = (v) => { try { return vordCalc(v); } catch (e) { return { excl: Number(v.bedrag_excl) || 0, btw: Number(v.btw_bedrag) || 0, incl: (Number(v.bedrag_excl) || 0) + (Number(v.btw_bedrag) || 0) }; } };
/* excl.-bedrag voor de koppeling: dat van Yuki als het gekend is; anders het berekende als het totaal klopt; anders afgeleid uit het totaal met de btw-verhouding van de vordering */
function yukiExcl(y, v) {
  if (y.excl != null && y.excl !== "") return Number(y.excl);
  const c = yukiCalc(v); const incl = Number(y.totaal_incl);
  if (Math.abs(c.incl - incl) <= 1) return r2(c.excl);
  const t = Math.abs(c.excl) > 0.005 ? c.btw / c.excl : (Number(S.projecten[v.project_id]?.btw_tarief) || 6) / 100;
  return r2(incl / (1 + t));
}
const yukiVordLabel = (v) => `${v.nr === 0 ? "Voorschot" : (VORD_SOORT[v.soort] || v.soort) + " #" + v.nr}${v.omschrijving ? " · " + v.omschrijving : ""} — ${VORD_STATUS[v.status] || v.status}`;
const YK_TOL = 1;   // zelfde marge als het Drive-script (YUKI.TOL): verschil in euro dat nog als "zelfde bedrag" telt
const YK_GEEN_MAP = "project heeft geen Drive-map";   // reden die het Drive-script noteert (1.67)
const ykKiesbaar = (p) => p && !p.intern && p.status !== "verloren";
const ykGeenMap = (pid) => { const p = S.projecten[pid]; return !!p && !p.drive_folder_id; };
const ykMapNaam = (p) => String((p && p.drive_map) || "").replace(/^PROJECTEN\//, "").trim() || String((p && p.klant) || "").trim();
/* project van een Yuki-factuur: { pid, bron } — door het script herkend, via het projectnummer in de pdf, of een klantnaam die op één project past */
function yukiRaad(y) {
  if (y.voorstel_project && ykKiesbaar(S.projecten[y.voorstel_project])) return { pid: y.voorstel_project, bron: "door het script herkend" };
  const nrs = y.projectnummers || []; const pn = Object.values(S.projecten).find(p => ykKiesbaar(p) && p.nummer && nrs.includes(p.nummer)); if (pn) return { pid: pn.id, bron: "projectnummer " + pn.nummer + " op de factuur" };
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const k = norm(y.klant); if (!k) return null;
  const kand = Object.values(S.projecten).filter(p => ykKiesbaar(p) && [p.klant, p.bedrijf, p.naam].map(norm).some(n => n && (k.includes(n) || n.includes(k))));
  return kand.length === 1 ? { pid: kand[0].id, bron: "klantnaam" } : null;
}
/* voorstel per factuur: { pid, vid, niveau, uitleg } — niveau "zeker" (project herkend + bedrag klopt, enige), "bedrag" (project niet herkend, maar
   precies één vordering in alle projecten met dit bedrag), "enige" (enige open vordering van het project, bedrag wijkt af), "later" (zeker, maar
   de vordering werd pas lang na de factuur aangemaakt) of "" (zelf kiezen). Wordt nooit automatisch gekoppeld: jij klikt. */
function yukiVoorstel(y) {
  const tot = Number(y.totaal_incl); const r = yukiRaad(y);
  const laterGemaakt = (v) => !!(y.datum && v.created_at && lokDag(v.created_at) > addDays(y.datum, 14));
  if (r) {
    const kand = yukiKandidaten(r.pid);
    if (!tot) return { pid: r.pid, vid: "", niveau: "", uitleg: "" };
    const exact = kand.filter(v => Math.abs(yukiCalc(v).incl - tot) <= YK_TOL);
    if (exact.length === 1) return laterGemaakt(exact[0]) ? { pid: r.pid, vid: exact[0].id, niveau: "later", uitleg: `Project (${r.bron}) en bedrag kloppen, maar deze vordering werd pas ${fmtLong(lokDag(exact[0].created_at))} aangemaakt — kijk na of ze echt bij deze factuur hoort.` }
      : { pid: r.pid, vid: exact[0].id, niveau: "zeker", uitleg: `Project (${r.bron}) en bedrag kloppen.` };
    if (exact.length > 1) return { pid: r.pid, vid: "", niveau: "", uitleg: `${exact.length} vorderingen van dit project hebben precies dit bedrag — kies de juiste.` };
    if (kand.length === 1) return { pid: r.pid, vid: kand[0].id, niveau: "enige", uitleg: `Enige vordering zonder factuurnummer in dit project (${r.bron}) — het bedrag wijkt af.` };
    return { pid: r.pid, vid: "", niveau: "", uitleg: kand.length ? `Project ${r.bron}; kies de vordering.` : "" };
  }
  if (!tot) return { pid: "", vid: "", niveau: "", uitleg: "" };
  const alle = Object.values(S.vorderingen || {}).filter(v => ykKiesbaar(S.projecten[v.project_id]) && !String(v.factuurnummer || "").trim() && ["opgemaakt", "verzonden", "betaald"].includes(v.status) && Math.abs(yukiCalc(v).incl - tot) <= 0.02);
  if (alle.length === 1) return { pid: alle[0].project_id, vid: alle[0].id, niveau: "bedrag", uitleg: `Het project werd niet herkend, maar enkel deze vordering heeft precies dit bedrag — kijk na of de klant (${y.klant || "?"}) klopt.` };
  return { pid: "", vid: "", niveau: "", uitleg: alle.length > 1 ? `${alle.length} vorderingen in verschillende projecten hebben precies dit bedrag — kies het project.` : "" };
}
const YK_NIVEAU = { zeker: ["✓ Zeker", "done", "Project en bedrag kloppen — één klik op Koppelen."], bedrag: ["Voorstel op bedrag", "st-on_hold", ""], enige: ["Voorstel — bedrag wijkt af", "st-offerte", ""], later: ["Voorstel — controleer", "st-offerte", ""] };
/* de "zekere" voorstellen die samen gekoppeld mogen worden: niet verdacht, en geen twee facturen op dezelfde vordering */
function yukiZeker() {
  const l = yukiOpen().filter(y => y.resultaat !== "verdacht" && Number(y.totaal_incl)).map(y => ({ y, vs: yukiVoorstel(y) })).filter(x => x.vs.niveau === "zeker" && x.vs.vid);
  const tel = {}; l.forEach(x => tel[x.vs.vid] = (tel[x.vs.vid] || 0) + 1);
  return l.filter(x => tel[x.vs.vid] === 1);
}
function vYukiKoppeling() {
  if (!yukiOk()) return `<div class="panel"><div class="empty"><b>${isBeheer() ? "Nog niet beschikbaar" : "Enkel voor beheerders"}</b>${isBeheer() ? "Voer databasescript <code>sql/062_bankdossier_yuki.sql</code> uit en zet het nieuwe <code>drive/Code.gs</code> online." : ""}</div></div>`;
  const open = yukiOpen(), pdfW = yukiPdfWacht(), zonderNr = vordZonderNr(), zonderPdf = vordZonderPdf(), lang = vordOpTeMakenLang(), zeker = yukiZeker();
  const recent = yukiAlle().filter(y => y.resultaat === "gekoppeld" && y.vordering_id && (y.updated_at || "") >= addDays(todayIso, -30)).sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  const genegeerd = yukiAlle().filter(y => y.genegeerd);
  const projOpts = (sel) => `<option value="">— kies het project —</option>` + Object.values(S.projecten).filter(ykKiesbaar).sort((a, b) => (b.nummer || "").localeCompare(a.nummer || "")).map(p => `<option value="${p.id}" ${p.id === sel ? "selected" : ""}>${esc(p.nummer ? p.nummer + " · " : "")}${esc(projName(p))}</option>`).join("");
  const kaart = (y) => {
    const vs = yukiVoorstel(y);
    const k = yukiKeuze()[y.id] || (yukiKeuze()[y.id] = { pid: vs.pid, vid: vs.vid, auto: true });
    const kand = k.pid ? yukiKandidaten(k.pid) : []; if (k.vid && !kand.some(v => v.id === k.vid)) k.vid = "";
    if (!k.vid && kand.length) { const pas = kand.filter(v => Math.abs(yukiCalc(v).incl - Number(y.totaal_incl)) <= YK_TOL); if (pas.length === 1) k.vid = pas[0].id; }
    const v = k.vid ? S.vorderingen[k.vid] : null; const c = v ? yukiCalc(v) : null; const verschil = c ? r2(Number(y.totaal_incl) - c.incl) : null;
    const [lbl, cls] = YUKI_RES[y.resultaat] || [y.resultaat, ""];
    const eigen = k.pid === vs.pid && k.vid === vs.vid; const nv = eigen && YK_NIVEAU[vs.niveau];
    return `<div class="panel yk-kaart" style="margin-bottom:12px;${y.resultaat === "verdacht" ? "border-color:var(--crit)" : vs.niveau === "zeker" && eigen ? "border-color:var(--ok)" : ""}" data-yuki="${y.id}"><div class="panel-head"><div><h3>Factuur ${esc(y.factuurnummer)} <span class="pill ${cls}">${lbl}</span>${nv ? ` <span class="pill ${nv[1]}">${nv[0]}</span>` : ""}</h3>
        <div class="muted" style="font-size:12px;margin-top:2px">${y.datum ? fmtLong(y.datum) + " · " : ""}${esc(y.klant || "klant onbekend")} · <b>${eur2(y.totaal_incl)}</b> incl. btw${y.excl != null ? ` (${eur2(y.excl)} excl. + ${eur2(y.btw)} btw)` : ""}${y.vervaldag ? " · vervalt " + fmtLong(y.vervaldag) : ""}${y.pdf_drive_id ? ` · <a href="https://drive.google.com/file/d/${encodeURIComponent(y.pdf_drive_id)}/view" target="_blank" rel="noopener">pdf bekijken ↗</a>` : " · <span style='color:var(--warn)'>geen pdf</span>"}</div>
        ${eigen && vs.uitleg ? `<div style="font-size:13px;margin-top:6px"><b>Voorstel:</b> ${esc(vs.uitleg)}</div>` : ""}
        ${y.reden ? `<div class="muted" style="font-size:12px;margin-top:4px;${y.resultaat === "verdacht" ? "color:var(--crit)" : ""}">Script: ${esc(y.reden)}</div>` : ""}</div>
        <button class="btn ghost sm" data-yk-act="negeer" data-id="${y.id}" title="Deze factuur hoort niet bij een vordering (bv. een creditnota of een factuur buiten een project): niet meer tonen">Negeren</button></div>
      <div class="panel-body"><div class="form-grid">
        <div class="field"><label>Project</label><select data-yk="pid" data-id="${y.id}">${projOpts(k.pid)}</select></div>
        <div class="field"><label>Vordering</label><select data-yk="vid" data-id="${y.id}" ${k.pid ? "" : "disabled"}>${!k.pid ? `<option value="">— eerst het project —</option>` : kand.length ? `<option value="">— kies de vordering —</option>` + kand.map(x => `<option value="${x.id}" ${x.id === k.vid ? "selected" : ""}>${esc(yukiVordLabel(x))} · ${eur2(yukiCalc(x).incl)} incl.</option>`).join("") : `<option value="">geen vordering zonder factuurnummer</option>`}</select>
          ${k.pid && !kand.length ? `<small class="muted">Maak eerst de vordering aan in de <a href="#" data-open="${k.pid}" data-optab="facturatie">facturatie van het project</a> — het script koppelt de factuur daarna zelf (elke werkdag), of je klikt hier op Koppelen.</small>` : ""}</div>
        ${!Number(y.totaal_incl) ? `<div class="field span2"><div class="yk-vergelijk afw">Van deze factuur is geen totaalbedrag gekend: kijk ze na in Yuki en vul het factuurnummer en bedrag zelf in bij de facturatie van het project (of negeer ze hier).</div></div>` : ""}
        ${v && Math.abs(c.incl) < 0.005 && Number(y.totaal_incl) ? `<div class="field span2"><div class="yk-vergelijk afw">Deze vordering heeft nog geen percentages per onderdeel: vul ze in bij de facturatie van het project, anders toont de vorderingsstaat in het portaal het bedrag als "niet over de onderdelen verdeeld".</div></div>` : ""}
        ${v && Number(y.totaal_incl) ? `<div class="field span2"><div class="yk-vergelijk ${Math.abs(verschil) > YK_TOL ? "afw" : ""}">Yuki <b>${eur2(y.totaal_incl)}</b> · Planbord berekend <b>${eur2(c.incl)}</b> incl. btw${Math.abs(verschil) > YK_TOL ? ` · <b>verschil ${eur2(verschil)}</b> — het bedrag van Yuki wordt het factuurbedrag (excl. ${eur2(yukiExcl(y, v))})` : " · klopt"}${ykGeenMap(v.project_id) && y.pdf_drive_id ? ` · <span style="color:var(--warn)">project zonder Drive-map: die wordt bij het koppelen gekoppeld of aangemaakt</span>` : ""}</div></div>` : ""}
        <div class="field span2"><div class="actions"><button class="btn ${vs.niveau === "zeker" && eigen ? "primary" : ""} sm" data-yk-act="koppel" data-id="${y.id}" ${v && Number(y.totaal_incl) ? "" : "disabled"}>Koppelen${y.pdf_drive_id && !y.pdf_verdacht ? " en pdf delen met de klant" : ""}</button>${k.pid ? `<a class="btn ghost sm" href="#" data-open="${k.pid}" data-optab="facturatie">Facturatie van het project</a>` : ""}</div></div>
      </div></div></div>`;
  };
  const rij = (v, knop) => { const p = S.projecten[v.project_id]; return `<tr><td>${p ? `<a href="#" data-open="${p.id}" data-optab="facturatie">${esc(p.nummer ? p.nummer + " · " : "")}${esc(projName(p))}</a>` : "—"}</td><td>${esc(yukiVordLabel(v))}</td><td class="num">${v.factuurnummer ? esc(v.factuurnummer) : "—"}</td><td class="num">${fmtLong(v.datum)}</td><td class="r num">${eur2(yukiCalc(v).incl)}</td><td class="r">${knop}</td></tr>`; };
  const tabel = (titel, uitleg, rows, extra) => rows ? `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>${titel}</h3><div class="muted" style="font-size:12px;margin-top:2px">${uitleg}</div></div></div><div class="tw"><table class="t"><thead><tr><th>Project</th><th>Vordering</th><th>Factuurnr</th><th>Datum</th><th class="r">Incl. btw</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>${extra || ""}</div>` : "";
  const pdfKnop = (y) => { const v = S.vorderingen[y.vordering_id]; const geenMap = v && ykGeenMap(v.project_id);
    return `${y.pdf_verdacht && y.pdf_verdacht !== YK_GEEN_MAP ? `<span class="muted" style="font-size:12px">${esc(y.pdf_verdacht)}</span> ` : ""}<a class="btn ghost sm" href="https://drive.google.com/file/d/${encodeURIComponent(y.pdf_drive_id)}/view" target="_blank" rel="noopener">Bekijken</a> <button class="btn sm ${geenMap || y.pdf_verdacht === YK_GEEN_MAP || !y.pdf_verdacht ? "primary" : ""}" data-yk-act="pdf" data-id="${y.id}">${geenMap ? "Map koppelen of aanmaken en pdf delen" : "Pdf delen"}</button>`; };
  const passend = (v) => yukiOpen().filter(y => Number(y.totaal_incl) && (yukiRaad(y) || {}).pid === v.project_id);
  const naarFactuur = (v, y) => `<button class="btn sm" data-yk-act="koppel-op" data-id="${y.id}" data-vid="${v.id}" title="${esc(y.klant || "")}">Koppelen aan factuur ${esc(y.factuurnummer)} (${eur2(y.totaal_incl)})</button>`;
  const niets = !open.length && !pdfW.length && !zonderNr.length && !zonderPdf.length;
  const uitlegOud = `<details class="panel-body" style="border-top:1px solid var(--line);font-size:13px"><summary style="cursor:pointer"><b>Al gefactureerd in Yuki, maar de factuur staat hier niet?</b></summary><p style="margin:8px 0 0">Dan kwam de factuurmail binnen vóór deze koppeling bestond, of ze kreeg in archief@bros.be het label <b>Planbord/te bekijken</b>. Zo biedt het script ze opnieuw aan (één keer, niets in te vullen):</p><ol style="margin:6px 0 0;padding-left:20px"><li>Open Gmail als archief@bros.be, klik links op het label <b>Planbord/te bekijken</b>, selecteer alle mails en haal het label weg (label-icoon › vinkje uit).</li><li>Is de factuur ouder dan twee maanden: open het script "BROS Yuki-mails" (script.google.com als archief@bros.be) en voer <code>archiefInhalen</code> uit.</li></ol><p style="margin:6px 0 0">Binnen het uur staan ze hier — met een voorstel om te koppelen. Wat precies past, koppelt het script zelf.</p></details>`;
  return `<div class="muted" style="font-size:13px;margin:-6px 0 14px">Elke factuur van BROS hoort bij een vordering: dan ziet de klant ze in het portaal (met pdf, betaalgegevens en bankdossier). Het Drive-script koppelt zelf als nummer en bedrag kloppen, en probeert het elke werkdag opnieuw. Wat overblijft, staat hier klaar met een voorstel: nakijken en klikken, niets in te vullen.</div>
    ${niets ? `<div class="panel" style="margin-bottom:16px"><div class="empty"><b>Alles gekoppeld ✓</b>Elke verstuurde factuur heeft een factuurnummer en een pdf.</div></div>` : ""}
    ${open.length ? `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 10px"><h3 style="margin:0">Yuki-facturen om te koppelen <span class="cnt">${open.length}</span></h3>${zeker.length > 1 ? `<button class="btn primary sm" data-yk-act="alles" style="margin-left:auto">Alle ${zeker.length} zekere koppelen</button>` : ""}</div>${open.map(kaart).join("")}` : ""}
    ${tabel("Gekoppeld — de pdf wacht op één klik", "De factuur hangt aan de vordering, maar de pdf staat nog niet bij de klant: het project heeft geen Drive-map, of het script wilde ze niet zonder jouw blik delen (reden ernaast). Bekijk de pdf en klik. Het script probeert het ook zelf elke werkdag.", pdfW.map(y => rij(S.vorderingen[y.vordering_id], pdfKnop(y))).join(""))}
    ${tabel("Verstuurd zonder factuurnummer", "Staat als verstuurd of betaald, maar er hangt geen Yuki-factuur aan.", zonderNr.map(v => { const pas = passend(v).filter(y => Math.abs(yukiCalc(v).incl - Number(y.totaal_incl)) <= YK_TOL); return rij(v, pas.length === 1 ? naarFactuur(v, pas[0]) : `<a class="btn ghost sm" href="#" data-open="${v.project_id}" data-optab="facturatie">Openen</a>`); }).join(""))}
    ${tabel("Factuur zonder pdf", "De klant ziet deze factuur zonder pdf (ook niet in het bankdossier). Laad de pdf op: ze komt in Documenten/Facturen en wordt gedeeld met de klant.", zonderPdf.map(v => rij(v, `<button class="btn sm" data-yk-act="upload" data-vid="${v.id}">${ykGeenMap(v.project_id) ? "Map koppelen/aanmaken en pdf opladen" : "Pdf opladen"}</button>`)).join(""))}
    ${tabel(`Al lang "Op te maken" <span class="cnt">${lang.length}</span>`, "Vorderingen die al meer dan een week op Op te maken staan. Hoort er een Yuki-factuur van dat project bij, dan staat de knop klaar.", lang.map(v => { const ys = passend(v); return rij(v, ys.length ? ys.slice(0, 2).map(y => naarFactuur(v, y)).join(" ") : `<span class="muted" style="font-size:12px">geen Yuki-factuur van dit project</span>`); }).join(""), lang.length ? uitlegOud : "")}
    ${!lang.length && !open.length ? `<div class="panel" style="margin-bottom:16px">${uitlegOud}</div>` : ""}
    ${recent.length ? `<details class="panel" style="margin-bottom:16px"><summary class="panel-head" style="cursor:pointer"><h3>Gekoppeld (laatste 30 dagen) <span class="cnt">${recent.length}</span></h3></summary><div class="tw"><table class="t"><thead><tr><th>Factuur</th><th>Klant (Yuki)</th><th class="r">Incl. btw</th><th>Project</th><th>Hoe</th></tr></thead><tbody>${recent.map(y => { const v = S.vorderingen[y.vordering_id]; const p = v && S.projecten[v.project_id]; return `<tr><td class="num">${esc(y.factuurnummer)}</td><td>${esc(y.klant)}</td><td class="r num">${eur2(y.totaal_incl)}</td><td>${p ? esc(projName(p)) : "—"}</td><td>${y.handmatig ? "manueel" : "automatisch"}</td></tr>`; }).join("")}</tbody></table></div></details>` : ""}
    ${genegeerd.length ? `<details class="panel"><summary class="panel-head" style="cursor:pointer"><h3>Genegeerd <span class="cnt">${genegeerd.length}</span></h3></summary><div class="tw"><table class="t"><tbody>${genegeerd.map(y => `<tr><td class="num">${esc(y.factuurnummer)}</td><td>${esc(y.klant)}</td><td class="r num">${eur2(y.totaal_incl)}</td><td class="muted">${esc(y.notitie || "")}</td><td class="r"><button class="btn ghost sm" data-yk-act="terug" data-id="${y.id}">Terugzetten</button></td></tr>`).join("")}</tbody></table></div></details>` : ""}
    <input type="file" id="yk_file" accept="application/pdf,.pdf" style="display:none">`;
}
/* vorderingen die al meer dan een week op "Op te maken" staan (enkel ter info; telt niet mee in de badge) */
const vordOpTeMakenLang = () => Object.values(S.vorderingen || {}).filter(v => v.status === "opgemaakt" && v.datum && v.datum <= addDays(todayIso, -7) && ykKiesbaar(S.projecten[v.project_id])).sort((a, b) => (a.datum || "").localeCompare(b.datum || ""));
const ykMapZin = (pid) => { const p = S.projecten[pid]; return `Het project heeft nog geen Drive-map: het Planbord koppelt de bestaande map "PROJECTEN/${ykMapNaam(p)}" of maakt ze aan uit het sjabloon (heet de map anders, koppel ze dan eerst in de projectfiche › Dossier).`; };
/* de pdf van een gekoppelde Yuki-factuur naar het project (met de map erbij als die ontbreekt) */
async function ykPdfNaarProject(y, v) {
  const maakMap = ykGeenMap(v.project_id);
  const j = await driveCall("factuurpdf", { yuki: y.id, maakMap });
  await Promise.all([rowRefetch("vorderingen", v.id), rowRefetch("yuki_facturen", y.id), maakMap || (j && j.map) ? rowRefetch("projecten", v.project_id) : null]);
  if (j && j.document && !S.documenten[j.document]) refetch("documenten");
  return j;
}
async function yukiKoppelen(id, stil) {
  const y = S.yuki_facturen[id]; const k = yukiKeuze()[id] || {}; const v = k.vid && S.vorderingen[k.vid]; if (!y || !v) return false;
  const c = yukiCalc(v); const excl = yukiExcl(y, v); const verschil = r2(Number(y.totaal_incl) - c.incl);
  const delen = !!y.pdf_drive_id && !y.pdf_verdacht && driveReady();
  if (!stil) {
    const vraag = `Factuur ${y.factuurnummer} (${eur2(y.totaal_incl)} incl.) koppelen aan ${projName(S.projecten[v.project_id])} — ${yukiVordLabel(v)}?` +
      (Math.abs(verschil) > YK_TOL ? `\n\nHet Planbord berekende ${eur2(c.incl)}: het factuurbedrag wordt dat van Yuki (${eur2(excl)} excl. btw).` : "") +
      (y.resultaat === "verdacht" ? "\n\nLET OP: deze mail werd niet bevestigd als afkomstig van Yuki. Kijk de factuur na in Yuki voor je koppelt." : "") +
      (delen ? "\n\nDe pdf gaat naar Documenten/Facturen van het project en wordt meteen gedeeld met de klant — kijk ze eerst na (pdf bekijken)." + (ykGeenMap(v.project_id) ? "\n\n" + ykMapZin(v.project_id) : "")
        : y.pdf_drive_id ? `\n\nDe pdf wordt nog NIET gedeeld (${y.pdf_verdacht}): na het koppelen staat ze bij "de pdf wacht op één klik".` : "\n\nEr is geen pdf: laad ze daarna op.");
    if (!confirm(vraag)) return false;
  }
  const { data, error } = await sb.rpc("yuki_koppel", { p_yuki: id, p_vordering: v.id, p_bedrag_excl: excl });
  if (error) { toast(`Factuur ${y.factuurnummer} niet gekoppeld: ${error.message}`, 8000); return false; }
  await Promise.all([rowRefetch("vorderingen", v.id), rowRefetch("yuki_facturen", id)]);
  delete yukiKeuze()[id];
  if (delen) {
    if (!stil) toast("Gekoppeld — pdf delen…", 4000);
    try { const j = await ykPdfNaarProject(y, v); if (!stil) toast(`Factuur ${y.factuurnummer} gekoppeld en de pdf staat bij de klant${j && j.map ? ` (map PROJECTEN/${j.map.naam} ${j.map.gemaakt ? "aangemaakt" : "gekoppeld"})` : ""}`, 6000); }
    catch (e) { toast(`Factuur ${y.factuurnummer} gekoppeld, maar de pdf niet gedeeld: ${e.message}. Probeer het opnieuw bij "de pdf wacht op één klik".`, 9000); }
  } else if (!stil) toast(`Factuur ${y.factuurnummer} gekoppeld${data && data.herinneren_uit ? " (oude factuur: herinneringen staan uit)" : ""}`, 5000);
  render(); return true;
}
/* alle zekere voorstellen in één keer (één bevestiging met de volledige lijst) */
async function yukiAllesKoppelen() {
  const l = yukiZeker(); if (!l.length) return;
  const zin = (x) => { const v = S.vorderingen[x.vs.vid]; return `• ${x.y.factuurnummer} (${eur2(x.y.totaal_incl)}) → ${projName(S.projecten[v.project_id])} · ${yukiVordLabel(v)}`; };
  const metMap = l.filter(x => x.y.pdf_drive_id && !x.y.pdf_verdacht && ykGeenMap(S.vorderingen[x.vs.vid].project_id)).length;
  if (!confirm(`Deze ${l.length} facturen koppelen? Project en bedrag kloppen telkens.\n\n${l.map(zin).join("\n")}\n\nDe pdf's (waar ze klaarstaan en nagekeken zijn door het script) gaan naar Documenten/Facturen en worden gedeeld met de klant.${metMap ? `\n\n${metMap} project(en) hebben nog geen Drive-map: het Planbord koppelt de bestaande map met die naam of maakt ze aan.` : ""}`)) return;
  let ok = 0; toast(`Koppelen… (0/${l.length})`, 60000);
  for (const x of l) { yukiKeuze()[x.y.id] = { pid: x.vs.pid, vid: x.vs.vid }; if (await yukiKoppelen(x.y.id, true)) ok++; toast(`Koppelen… (${ok}/${l.length})`, 60000); }
  toast(ok === l.length ? `${ok} facturen gekoppeld` : `${ok} van ${l.length} gekoppeld — de rest staat er nog (zie de melding)`, 7000); render();
}
async function yukiPdfDelen(id) {
  const y = S.yuki_facturen[id]; if (!y) return; const v = S.vorderingen[y.vordering_id]; if (!v) return;
  const geenMap = ykGeenMap(v.project_id) || y.pdf_verdacht === YK_GEEN_MAP;
  if (y.pdf_verdacht && y.pdf_verdacht !== YK_GEEN_MAP && y.pdf_verdacht !== "pdf niet automatisch gedeeld" && !confirm(`Het script deelde deze pdf niet: ${y.pdf_verdacht}.\n\nHeb je de pdf nagekeken (knop Bekijken) en mag de klant ze zien?`)) return;
  if ((!y.pdf_verdacht || y.pdf_verdacht === YK_GEEN_MAP || y.pdf_verdacht === "pdf niet automatisch gedeeld") && !confirm(`Factuur ${y.factuurnummer} delen met de klant van ${projName(S.projecten[v.project_id])}? Ze komt in Documenten/Facturen en in het portaal.${ykGeenMap(v.project_id) ? "\n\n" + ykMapZin(v.project_id) : ""}`)) return;
  toast(geenMap ? "Projectmap zoeken of aanmaken en pdf delen…" : "Pdf delen…", 30000);
  try { const j = await ykPdfNaarProject(y, v); toast(`Pdf gedeeld met de klant${j && j.map ? ` · map PROJECTEN/${j.map.naam} ${j.map.gemaakt ? "aangemaakt" : "gekoppeld"}` : ""}`, 6000); }
  catch (e) { toast("Pdf niet gedeeld: " + e.message, 9000); }
  render();
}
async function yukiUpload(vid, file) {
  const v = S.vorderingen[vid]; if (!v || !file) return;
  if (!/pdf$/i.test(file.type || "") && !/\.pdf$/i.test(file.name)) return toast("Kies een pdf.");
  if (file.size > 20e6) return toast("De pdf is te groot (max. 20 MB).");
  const maakMap = ykGeenMap(v.project_id);
  if (!confirm(`${file.name} als factuur ${v.factuurnummer} bij ${projName(S.projecten[v.project_id])} zetten? De pdf komt in Documenten/Facturen en wordt gedeeld met de klant.${maakMap ? "\n\n" + ykMapZin(v.project_id) : ""}`)) return;
  toast("Pdf opladen…", 30000);
  try {
    const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.onerror = rej; fr.readAsDataURL(file); });
    const j = await driveCall("factuurpdf", { vordering: vid, base64: b64, maakMap });
    await Promise.all([rowRefetch("vorderingen", vid), maakMap || (j && j.map) ? rowRefetch("projecten", v.project_id) : null]); refetch("documenten"); toast(`Pdf staat bij de factuur en is gedeeld met de klant${j && j.map ? ` · map PROJECTEN/${j.map.naam} ${j.map.gemaakt ? "aangemaakt" : "gekoppeld"}` : ""}`, 6000);
  } catch (e) { toast("Pdf niet opgeladen: " + e.message, 8000); }
  render();
}
let ykUploadVid = null;
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-yk-act]"); if (!el) return; const d = el.dataset; e.preventDefault();
  if (d.ykAct === "koppel") return yukiKoppelen(d.id);
  if (d.ykAct === "koppel-op") { const v = S.vorderingen[d.vid]; if (!v) return; yukiKeuze()[d.id] = { pid: v.project_id, vid: v.id }; return yukiKoppelen(d.id); }
  if (d.ykAct === "alles") return yukiAllesKoppelen();
  if (d.ykAct === "pdf") return yukiPdfDelen(d.id);
  if (d.ykAct === "upload") { ykUploadVid = d.vid; const f = document.getElementById("yk_file"); if (f) { f.value = ""; f.click(); } return; }
  if (d.ykAct === "negeer") { const y = S.yuki_facturen[d.id]; if (!y) return; const n = prompt(`Factuur ${y.factuurnummer} negeren (hoort bij geen vordering)? Waarom? (bv. creditnota, factuur buiten een project)`, ""); if (n == null) return;
    dbUpdate("yuki_facturen", d.id, { genegeerd: true, notitie: n.trim().slice(0, 300), updated_at: new Date().toISOString() }).then(() => toast("Genegeerd")).catch(() => { }); return; }
  if (d.ykAct === "terug") { dbUpdate("yuki_facturen", d.id, { genegeerd: false, updated_at: new Date().toISOString() }).catch(() => { }); return; }
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.id === "yk_file" && ykUploadVid) { const f = el.files && el.files[0]; const vid = ykUploadVid; ykUploadVid = null; if (f) yukiUpload(vid, f); return; }
  if (!el.dataset || !el.dataset.yk) return; const k = yukiKeuze()[el.dataset.id] = yukiKeuze()[el.dataset.id] || {};
  if (el.dataset.yk === "pid") { k.pid = el.value; k.vid = ""; } else k.vid = el.value;
  render();
});
