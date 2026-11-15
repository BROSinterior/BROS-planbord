/* =====================================================================
   BROS Planbord — Yuki-koppeling (script 062, v1.66) — enkel beheer
   Elke factuur van BROS (uit Yuki) hoort bij een vordering: dan staat ze bij de klant in het portaal, met de pdf, in de
   betaalgegevens en in het bankdossier. Het Drive-script koppelt automatisch als nummer en bedrag kloppen; wat niet lukt,
   verschijnt hier (Facturen › Yuki-koppeling) om manueel te koppelen. Daarnaast: verstuurde facturen zonder factuurnummer
   of zonder pdf. Geladen vóór app.js; deb-beheer.js toont het tabblad, app.js telt mee in de badge van Facturen.
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
function yukiRaad(y) {   // voorstel: herkend project, anders een project met hetzelfde nummer of een klantnaam die erop lijkt
  const kiesbaar = (p) => p && !p.intern && p.status !== "verloren";
  if (y.voorstel_project && kiesbaar(S.projecten[y.voorstel_project])) return y.voorstel_project;
  const nrs = y.projectnummers || []; const pn = Object.values(S.projecten).find(p => kiesbaar(p) && p.nummer && nrs.includes(p.nummer)); if (pn) return pn.id;
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const k = norm(y.klant); if (!k) return "";
  const kand = Object.values(S.projecten).filter(p => kiesbaar(p) && [p.klant, p.bedrijf, p.naam].map(norm).some(n => n && (k.includes(n) || n.includes(k))));
  return kand.length === 1 ? kand[0].id : "";
}
function vYukiKoppeling() {
  if (!yukiOk()) return `<div class="panel"><div class="empty"><b>${isBeheer() ? "Nog niet beschikbaar" : "Enkel voor beheerders"}</b>${isBeheer() ? "Voer databasescript <code>sql/062_bankdossier_yuki.sql</code> uit en zet het nieuwe <code>drive/Code.gs</code> online." : ""}</div></div>`;
  const open = yukiOpen(), pdfW = yukiPdfWacht(), zonderNr = vordZonderNr(), zonderPdf = vordZonderPdf();
  const recent = yukiAlle().filter(y => y.resultaat === "gekoppeld" && y.vordering_id && (y.updated_at || "") >= addDays(todayIso, -30)).sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  const genegeerd = yukiAlle().filter(y => y.genegeerd);
  const projOpts = (sel) => `<option value="">— kies het project —</option>` + Object.values(S.projecten).filter(p => !p.intern && p.status !== "verloren").sort((a, b) => (b.nummer || "").localeCompare(a.nummer || "")).map(p => `<option value="${p.id}" ${p.id === sel ? "selected" : ""}>${esc(p.nummer ? p.nummer + " · " : "")}${esc(projName(p))}</option>`).join("");
  const kaart = (y) => {
    const k = yukiKeuze()[y.id] || (yukiKeuze()[y.id] = { pid: yukiRaad(y), vid: "" });
    const kand = k.pid ? yukiKandidaten(k.pid) : []; if (k.vid && !kand.some(v => v.id === k.vid)) k.vid = "";
    if (!k.vid && kand.length) { const pas = kand.filter(v => Math.abs(yukiCalc(v).incl - Number(y.totaal_incl)) <= 1); if (pas.length === 1) k.vid = pas[0].id; }
    const v = k.vid ? S.vorderingen[k.vid] : null; const c = v ? yukiCalc(v) : null; const verschil = c ? r2(Number(y.totaal_incl) - c.incl) : null;
    const [lbl, cls] = YUKI_RES[y.resultaat] || [y.resultaat, ""];
    return `<div class="panel yk-kaart" style="margin-bottom:12px;${y.resultaat === "verdacht" ? "border-color:var(--crit)" : ""}" data-yuki="${y.id}"><div class="panel-head"><div><h3>Factuur ${esc(y.factuurnummer)} <span class="pill ${cls}">${lbl}</span></h3>
        <div class="muted" style="font-size:12px;margin-top:2px">${y.datum ? fmtLong(y.datum) + " · " : ""}${esc(y.klant || "klant onbekend")} · <b>${eur2(y.totaal_incl)}</b> incl. btw${y.excl != null ? ` (${eur2(y.excl)} excl. + ${eur2(y.btw)} btw)` : ""}${y.vervaldag ? " · vervalt " + fmtLong(y.vervaldag) : ""}${y.pdf_drive_id ? ` · <a href="https://drive.google.com/file/d/${encodeURIComponent(y.pdf_drive_id)}/view" target="_blank" rel="noopener">pdf bekijken ↗</a>` : " · <span style='color:var(--warn)'>geen pdf</span>"}</div>
        ${y.reden ? `<div style="font-size:13px;margin-top:6px;${y.resultaat === "verdacht" ? "color:var(--crit)" : ""}">${esc(y.reden)}</div>` : ""}</div>
        <button class="btn ghost sm" data-yk-act="negeer" data-id="${y.id}" title="Deze factuur hoort niet bij een vordering (bv. een creditnota of een factuur buiten een project): niet meer tonen">Negeren</button></div>
      <div class="panel-body"><div class="form-grid">
        <div class="field"><label>Project</label><select data-yk="pid" data-id="${y.id}">${projOpts(k.pid)}</select></div>
        <div class="field"><label>Vordering</label><select data-yk="vid" data-id="${y.id}" ${k.pid ? "" : "disabled"}>${!k.pid ? `<option value="">— eerst het project —</option>` : kand.length ? `<option value="">— kies de vordering —</option>` + kand.map(x => `<option value="${x.id}" ${x.id === k.vid ? "selected" : ""}>${esc(yukiVordLabel(x))} · ${eur2(yukiCalc(x).incl)} incl.</option>`).join("") : `<option value="">geen vordering zonder factuurnummer</option>`}</select>
          ${k.pid && !kand.length ? `<small class="muted">Maak eerst de vordering aan in de <a href="#" data-open="${k.pid}" data-optab="facturatie">facturatie van het project</a>.</small>` : ""}</div>
        ${!Number(y.totaal_incl) ? `<div class="field span2"><div class="yk-vergelijk afw">Van deze factuur is geen totaalbedrag gekend: kijk ze na in Yuki en vul het factuurnummer en bedrag zelf in bij de facturatie van het project (of negeer ze hier).</div></div>` : ""}
        ${v && Math.abs(c.incl) < 0.005 && Number(y.totaal_incl) ? `<div class="field span2"><div class="yk-vergelijk afw">Deze vordering heeft nog geen percentages per onderdeel: vul ze in bij de facturatie van het project, anders toont de vorderingsstaat in het portaal het bedrag als "niet over de onderdelen verdeeld".</div></div>` : ""}
        ${v && Number(y.totaal_incl) ? `<div class="field span2"><div class="yk-vergelijk ${Math.abs(verschil) > 1 ? "afw" : ""}">Yuki <b>${eur2(y.totaal_incl)}</b> · Planbord berekend <b>${eur2(c.incl)}</b> incl. btw${Math.abs(verschil) > 1 ? ` · <b>verschil ${eur2(verschil)}</b> — het bedrag van Yuki wordt het factuurbedrag (excl. ${eur2(yukiExcl(y, v))})` : " · klopt"}</div></div>` : ""}
        <div class="field span2"><div class="actions"><button class="btn primary sm" data-yk-act="koppel" data-id="${y.id}" ${v && Number(y.totaal_incl) ? "" : "disabled"}>Koppelen${y.pdf_drive_id ? " en pdf delen met de klant" : ""}</button>${k.pid ? `<a class="btn ghost sm" href="#" data-open="${k.pid}" data-optab="facturatie">Facturatie van het project</a>` : ""}</div></div>
      </div></div></div>`;
  };
  const rij = (v, knop) => { const p = S.projecten[v.project_id]; return `<tr><td>${p ? `<a href="#" data-open="${p.id}" data-optab="facturatie">${esc(p.nummer ? p.nummer + " · " : "")}${esc(projName(p))}</a>` : "—"}</td><td>${esc(yukiVordLabel(v))}</td><td class="num">${v.factuurnummer ? esc(v.factuurnummer) : "—"}</td><td class="num">${fmtLong(v.datum)}</td><td class="r num">${eur2(yukiCalc(v).incl)}</td><td class="r">${knop}</td></tr>`; };
  const tabel = (titel, uitleg, rows) => rows ? `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>${titel}</h3><div class="muted" style="font-size:12px;margin-top:2px">${uitleg}</div></div></div><div class="tw"><table class="t"><thead><tr><th>Project</th><th>Vordering</th><th>Factuurnr</th><th>Datum</th><th class="r">Incl. btw</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>` : "";
  const niets = !open.length && !pdfW.length && !zonderNr.length && !zonderPdf.length;
  return `<div class="muted" style="font-size:13px;margin:-6px 0 14px">Elke factuur van BROS hoort bij een vordering: dan ziet de klant ze in het portaal (met pdf, betaalgegevens en bankdossier). Het Drive-script koppelt automatisch als nummer en bedrag kloppen; wat niet lukte, koppel je hier.</div>
    ${niets ? `<div class="panel" style="margin-bottom:16px"><div class="empty"><b>Alles gekoppeld ✓</b>Elke verstuurde factuur heeft een factuurnummer en een pdf.</div></div>` : ""}
    ${open.length ? `<h3 style="margin:0 0 10px">Yuki-facturen om te koppelen <span class="cnt">${open.length}</span></h3>${open.map(kaart).join("")}` : ""}
    ${tabel("Gekoppeld, maar de pdf is niet gedeeld", "Het script deelde de pdf niet automatisch (ander factuurnummer of rekening in de pdf, of geen Drive-map). Kijk de pdf na en deel ze dan.", pdfW.map(y => rij(S.vorderingen[y.vordering_id], `${y.pdf_verdacht ? `<span class="muted" style="font-size:12px">${esc(y.pdf_verdacht)}</span> ` : ""}<button class="btn sm" data-yk-act="pdf" data-id="${y.id}">Pdf delen</button>`)).join(""))}
    ${tabel("Verstuurd zonder factuurnummer", "Staat als verstuurd of betaald, maar er hangt geen Yuki-factuur aan. Koppel de Yuki-factuur hierboven, of vul het factuurnummer in bij de facturatie van het project.", zonderNr.map(v => rij(v, `<a class="btn ghost sm" href="#" data-open="${v.project_id}" data-optab="facturatie">Openen</a>`)).join(""))}
    ${tabel("Factuur zonder pdf", "De klant ziet deze factuur zonder pdf (ook niet in het bankdossier). Laad de pdf op: ze komt in Documenten/Facturen en wordt gedeeld met de klant.", zonderPdf.map(v => rij(v, `<button class="btn sm" data-yk-act="upload" data-vid="${v.id}">Pdf opladen</button>`)).join(""))}
    ${recent.length ? `<details class="panel" style="margin-bottom:16px"><summary class="panel-head" style="cursor:pointer"><h3>Gekoppeld (laatste 30 dagen) <span class="cnt">${recent.length}</span></h3></summary><div class="tw"><table class="t"><thead><tr><th>Factuur</th><th>Klant (Yuki)</th><th class="r">Incl. btw</th><th>Project</th><th>Hoe</th></tr></thead><tbody>${recent.map(y => { const v = S.vorderingen[y.vordering_id]; const p = v && S.projecten[v.project_id]; return `<tr><td class="num">${esc(y.factuurnummer)}</td><td>${esc(y.klant)}</td><td class="r num">${eur2(y.totaal_incl)}</td><td>${p ? esc(projName(p)) : "—"}</td><td>${y.handmatig ? "manueel" : "automatisch"}</td></tr>`; }).join("")}</tbody></table></div></details>` : ""}
    ${genegeerd.length ? `<details class="panel"><summary class="panel-head" style="cursor:pointer"><h3>Genegeerd <span class="cnt">${genegeerd.length}</span></h3></summary><div class="tw"><table class="t"><tbody>${genegeerd.map(y => `<tr><td class="num">${esc(y.factuurnummer)}</td><td>${esc(y.klant)}</td><td class="r num">${eur2(y.totaal_incl)}</td><td class="muted">${esc(y.notitie || "")}</td><td class="r"><button class="btn ghost sm" data-yk-act="terug" data-id="${y.id}">Terugzetten</button></td></tr>`).join("")}</tbody></table></div></details>` : ""}
    <input type="file" id="yk_file" accept="application/pdf,.pdf" style="display:none">`;
}
async function yukiKoppelen(id) {
  const y = S.yuki_facturen[id]; const k = yukiKeuze()[id] || {}; const v = k.vid && S.vorderingen[k.vid]; if (!y || !v) return;
  const c = yukiCalc(v); const excl = yukiExcl(y, v); const verschil = r2(Number(y.totaal_incl) - c.incl);
  const vraag = `Factuur ${y.factuurnummer} (${eur2(y.totaal_incl)} incl.) koppelen aan ${projName(S.projecten[v.project_id])} — ${yukiVordLabel(v)}?` +
    (Math.abs(verschil) > 1 ? `\n\nHet Planbord berekende ${eur2(c.incl)}: het factuurbedrag wordt dat van Yuki (${eur2(excl)} excl. btw).` : "") +
    (y.resultaat === "verdacht" ? "\n\nLET OP: deze mail werd niet bevestigd als afkomstig van Yuki. Kijk de factuur na in Yuki voor je koppelt." : "") +
    (y.pdf_drive_id ? "\n\nDe pdf gaat naar Documenten/Facturen van het project en wordt meteen gedeeld met de klant — kijk ze eerst na (pdf bekijken)." : "\n\nEr is geen pdf: laad ze daarna op.");
  if (!confirm(vraag)) return;
  const { data, error } = await sb.rpc("yuki_koppel", { p_yuki: id, p_vordering: v.id, p_bedrag_excl: excl });
  if (error) return toast("Niet gekoppeld: " + error.message, 8000);
  await Promise.all([rowRefetch("vorderingen", v.id), rowRefetch("yuki_facturen", id)]);
  delete yukiKeuze()[id];
  if (y.pdf_drive_id && driveReady()) {
    toast("Gekoppeld — pdf delen…", 4000);
    try { const j = await driveCall("factuurpdf", { yuki: id }); await Promise.all([rowRefetch("vorderingen", v.id), rowRefetch("yuki_facturen", id)]); if (j.document && !S.documenten[j.document]) refetch("documenten"); toast(`Factuur ${y.factuurnummer} gekoppeld en de pdf staat bij de klant`, 5000); }
    catch (e) { toast(`Gekoppeld, maar de pdf niet gedeeld: ${e.message}. Probeer "Pdf delen" in de lijst.`, 9000); }
  } else toast(`Factuur ${y.factuurnummer} gekoppeld${data && data.herinneren_uit ? " (oude factuur: herinneringen staan uit)" : ""}`, 5000);
  render();
}
async function yukiPdfDelen(id) {
  const y = S.yuki_facturen[id]; if (!y) return;
  if (y.pdf_verdacht && !confirm(`Het script deelde deze pdf niet: ${y.pdf_verdacht}.\n\nHeb je de pdf nagekeken en mag de klant ze zien?`)) return;
  try { await driveCall("factuurpdf", { yuki: id }); await Promise.all([rowRefetch("vorderingen", y.vordering_id), rowRefetch("yuki_facturen", id)]); refetch("documenten"); toast("Pdf gedeeld met de klant", 4000); }
  catch (e) { toast("Pdf niet gedeeld: " + e.message, 8000); }
  render();
}
async function yukiUpload(vid, file) {
  const v = S.vorderingen[vid]; if (!v || !file) return;
  if (!/pdf$/i.test(file.type || "") && !/\.pdf$/i.test(file.name)) return toast("Kies een pdf.");
  if (file.size > 20e6) return toast("De pdf is te groot (max. 20 MB).");
  if (!confirm(`${file.name} als factuur ${v.factuurnummer} bij ${projName(S.projecten[v.project_id])} zetten? De pdf komt in Documenten/Facturen en wordt gedeeld met de klant.`)) return;
  toast("Pdf opladen…", 6000);
  try {
    const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.onerror = rej; fr.readAsDataURL(file); });
    await driveCall("factuurpdf", { vordering: vid, base64: b64 });
    await rowRefetch("vorderingen", vid); refetch("documenten"); toast("Pdf staat bij de factuur en is gedeeld met de klant", 5000);
  } catch (e) { toast("Pdf niet opgeladen: " + e.message, 8000); }
  render();
}
let ykUploadVid = null;
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-yk-act]"); if (!el) return; const d = el.dataset; e.preventDefault();
  if (d.ykAct === "koppel") return yukiKoppelen(d.id);
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
