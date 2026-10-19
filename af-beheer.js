/* =====================================================================
   BROS Planbord — facturen van aannemers (script 047, v1.49)
   De aannemer laadt zijn factuur op in het aannemersportaal (pdf + bedrag, optioneel gekoppeld aan loten/posten).
   BROS (beheer) volgt ze hier op: per project in Facturatie (met kostprijs per lot versus wat aannemers factureerden)
   en over alle projecten in het tabblad Aankoop. Status: ontvangen → goedgekeurd → betaald, of een vraag aan de aannemer.
   Per factuur kies je of de klant ze in zijn portaal ziet.
   Geladen vóór app.js; app.js roept vAfPanel / vAankoop / afbTeDoen aan via typeof-controles.
   ===================================================================== */
const AFB_STATUS = { ontvangen: "Ontvangen", goedgekeurd: "Goedgekeurd", betaald: "Betaald", betwist: "Vraag aan aannemer" };
const AFB_PILL = { ontvangen: "st-offerte", goedgekeurd: "st-lopend", betaald: "st-afgerond", betwist: "st-verloren" };
const afbOk = () => schemaV() >= 47 && isBeheer() && !!S.aannemer_facturen;
const afbAlle = () => Object.values(S.aannemer_facturen || {});
const afbSort = (a, b) => (b.datum || "").localeCompare(a.datum || "") || (b.created_at || "").localeCompare(a.created_at || "");
const afbVan = (pid) => afbAlle().filter(f => f.project_id === pid).sort(afbSort);
const afbTeDoen = () => afbOk() ? afbAlle().filter(f => f.status === "ontvangen") : [];
const afbIncl = (f) => Number(f.bedrag_excl || 0) + Number(f.btw_bedrag || 0);
const afbAannemer = (f) => { const c = S.contacten[f.contact_id]; return (c && (c.bedrijf || c.naam)) || f.aannemer_naam || "—"; };
const afbVervallen = (f) => f.vervaldag && f.status !== "betaald" && f.vervaldag < todayIso;
/* bedrag per lot: expliciete bedragen per lot/post; de rest over de koppelingen zonder bedrag naar verhouding van de kostprijs; niets gekoppeld → 'niet' */
function afbVerdeel(f) {
  const perLot = {}; let niet = 0; const excl = Number(f.bedrag_excl || 0);
  const items = (f.koppeling || []).map(k => { const post = k.post_id ? S.meetstaat_posten[k.post_id] : null; const lot = k.lot != null ? Number(k.lot) : post ? post.lot : null; return { lot, post, bedrag: k.bedrag == null || k.bedrag === "" ? null : Number(k.bedrag) }; }).filter(k => k.lot != null);
  if (!items.length) return { perLot, niet: excl };
  let rest = excl; items.filter(k => k.bedrag != null).forEach(k => { perLot[k.lot] = (perLot[k.lot] || 0) + k.bedrag; rest -= k.bedrag; });
  const zonder = items.filter(k => k.bedrag == null);
  if (Math.abs(rest) > 0.005) {
    if (!zonder.length) niet += rest;
    else { const gew = zonder.map(k => Math.max(0, k.post ? msKost(k.post) : msRows(f.project_id).filter(r => r.lot === k.lot && msTelt(r) && r.status !== "minwerk").reduce((s, r) => s + msKost(r), 0)));
      const som = gew.reduce((s, x) => s + x, 0); zonder.forEach((k, i) => { perLot[k.lot] = (perLot[k.lot] || 0) + rest * (som > 0.005 ? gew[i] / som : 1 / zonder.length); }); }
  }
  return { perLot, niet };
}
const afbKoppelTxt = (f) => { const lots = [...new Set((f.koppeling || []).map(k => k.lot != null ? Number(k.lot) : (S.meetstaat_posten[k.post_id] || {}).lot).filter(x => x != null))]; const posten = (f.koppeling || []).filter(k => k.post_id).length;
  return lots.length ? lots.sort((a, b) => a - b).map(lotName).join(", ") + (posten ? ` · ${posten} post${posten === 1 ? "" : "en"}` : "") : ""; };
function afbRij(f, metProject) {
  const p = S.projecten[f.project_id]; const laat = afbVervallen(f);
  return `<tr class="${f.status === "ontvangen" ? "af-nieuw" : ""}">
    <td class="num" style="white-space:nowrap">${fmtLong(f.datum)}<div class="muted" style="font-size:11px">opgeladen ${fmtLong(lokDag(f.created_at))}</div></td>
    ${metProject ? `<td>${p ? `<a href="#" data-open="${esc(p.id)}" data-optab="facturatie">${esc(p.nummer ? p.nummer + " · " : "")}${esc(projName(p))}</a>` : "—"}</td>` : ""}
    <td><b>${esc(afbAannemer(f))}</b></td>
    <td><b class="num">${esc(f.nummer)}</b>${f.omschrijving ? `<div style="font-size:12px">${esc(f.omschrijving)}</div>` : ""}<div class="muted" style="font-size:11px">${esc(afbKoppelTxt(f) || "niet gekoppeld")}</div>
      ${f.bros_opmerking ? `<div style="font-size:12px;margin-top:4px;padding:4px 8px;border-left:3px solid ${f.status === "betwist" ? "var(--crit)" : "var(--line-2)"};background:var(--surface-2);border-radius:4px;white-space:pre-line">${esc(f.bros_opmerking)}</div>` : ""}</td>
    <td class="r num">${eur2(f.bedrag_excl)}</td><td class="r num">${f.btw_bedrag == null ? `<span class="muted">—</span>` : eur2(f.btw_bedrag)}</td><td class="r num"><b>${eur2(afbIncl(f))}</b></td>
    <td class="num" style="white-space:nowrap;${laat ? "color:var(--crit);font-weight:600" : ""}">${f.vervaldag ? fmtLong(f.vervaldag) : "—"}</td>
    <td style="min-width:150px"><select class="inline" data-afb="status" data-id="${f.id}">${Object.entries(AFB_STATUS).map(([k, l]) => `<option value="${k}" ${f.status === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      ${f.status === "betaald" ? `<div style="margin-top:4px"><input class="inline num" type="date" data-afb="betaald_op" data-id="${f.id}" value="${esc(f.betaald_op || "")}" title="Betaald op"></div>` : ""}</td>
    <td class="c"><input type="checkbox" data-afb="klant" data-id="${f.id}" ${f.zichtbaar_klant ? "checked" : ""} title="Zichtbaar in het klantenportaal"></td>
    <td class="r" style="white-space:nowrap"><button class="btn sm" data-afb-act="pdf" data-path="${esc(f.pdf_path)}" title="${esc(f.pdf_naam || "factuur.pdf")}">Pdf</button> <button class="btn ghost sm" data-afb-act="opm" data-id="${f.id}" title="Toelichting voor de aannemer">💬</button></td></tr>`;
}
const afbKop = (metProject) => `<tr><th>Datum</th>${metProject ? "<th>Project</th>" : ""}<th>Aannemer</th><th>Factuur</th><th class="r">Excl. btw</th><th class="r">Btw</th><th class="r">Incl. btw</th><th>Vervalt</th><th>Status</th><th class="c" title="Zichtbaar voor de klant in zijn portaal">Klant</th><th></th></tr>`;
/* per project, onder de vorderingsstaat (tabblad Facturatie) */
function vAfPanel(p) {
  if (!afbOk()) return "";
  const fs = afbVan(p.id);
  const rows = msRows(p.id).filter(msTelt); const kost = {}; rows.forEach(r => { kost[r.lot] = (kost[r.lot] || 0) + (r.status === "minwerk" ? -Math.abs(msKost(r)) : msKost(r)); });
  const gef = {}; let niet = 0; fs.filter(f => f.status !== "betwist").forEach(f => { const v = afbVerdeel(f); Object.entries(v.perLot).forEach(([l, b]) => gef[l] = (gef[l] || 0) + b); niet += v.niet; });
  const lots = [...new Set([...Object.keys(kost), ...Object.keys(gef)].map(Number))].filter(l => Math.abs(kost[l] || 0) > 0.005 || Math.abs(gef[l] || 0) > 0.005).sort((a, b) => a - b);
  const totK = lots.reduce((s, l) => s + (kost[l] || 0), 0), totG = lots.reduce((s, l) => s + (gef[l] || 0), 0);
  const som = (st) => fs.filter(f => st.includes(f.status)).reduce((s, f) => s + afbIncl(f), 0);
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Facturen van aannemers</h3><div class="muted" style="font-size:12px;margin-top:2px">Opgeladen door de aannemers in hun portaal. Zet de status (de aannemer ziet ze, met je toelichting bij een vraag) en kies per factuur of de klant ze in zijn portaal ziet.</div></div>
      ${fs.length ? `<div class="muted" style="font-size:12px;text-align:right">te behandelen ${eur2(som(["ontvangen"]))} · te betalen ${eur2(som(["goedgekeurd"]))} · betaald ${eur2(som(["betaald"]))} <span style="display:block">incl. btw</span></div>` : ""}</div>
    ${fs.length ? `<div class="tw"><table class="t af-t"><thead>${afbKop(false)}</thead><tbody>${fs.map(f => afbRij(f, false)).join("")}</tbody></table></div>
      ${lots.length ? `<div class="panel-head" style="border-top:1px solid var(--line)"><div><h3>Kostprijs per lot versus aannemersfacturen</h3><div class="muted" style="font-size:12px;margin-top:2px">Kostprijs = hoeveelheid × eenheidsprijs (aankoop) in de meetstaat. Een factuur zonder bedragen per lot wordt verdeeld naar verhouding van de kostprijs van de gekoppelde loten/posten; facturen met een open vraag tellen niet mee. Bedragen excl. btw.</div></div></div>
        <div class="tw"><table class="t"><thead><tr><th>Lot</th><th class="r">Kostprijs meetstaat</th><th class="r">Gefactureerd door aannemers</th><th class="r">Nog te verwachten</th><th style="min-width:140px">Verbruikt</th></tr></thead><tbody>
          ${lots.map(l => { const k = kost[l] || 0, g = gef[l] || 0; const pct = k > 0.005 ? g / k : null; const over = pct != null && pct > 1.0001;
            return `<tr><td>${esc(lotName(l))}</td><td class="r num">${eur2(k)}</td><td class="r num">${g ? eur2(g) : "—"}</td><td class="r num ${k - g < -0.5 ? "neg" : ""}">${eur2(k - g)}</td><td>${pct == null ? (g ? `<span class="muted" style="font-size:12px">geen kostprijs</span>` : "") : `<div class="af-bar"><i style="width:${Math.min(100, Math.round(pct * 100))}%;${over ? "background:var(--crit)" : ""}"></i></div><span class="num" style="font-size:12px;${over ? "color:var(--crit);font-weight:600" : ""}">${nl(pct * 100, 0)} %</span>`}</td></tr>`; }).join("")}
          <tr class="tot"><td><b>Totaal</b></td><td class="r num"><b>${eur2(totK)}</b></td><td class="r num"><b>${eur2(totG)}</b></td><td class="r num"><b>${eur2(totK - totG)}</b></td><td>${totK > 0.005 ? `<span class="num" style="font-size:12px">${nl(totG / totK * 100, 0)} %</span>` : ""}</td></tr>
          ${Math.abs(niet) > 0.005 ? `<tr><td colspan="5" class="muted" style="font-size:12px">Niet aan een lot gekoppeld: ${eur2(niet)}</td></tr>` : ""}</tbody></table></div>` : ""}`
    : `<div class="empty"><b>Nog geen facturen van aannemers</b>Aannemers laden hun facturen op in hun portaal (tabblad Facturen); ze verschijnen hier meteen.</div>`}</div>`;
}
/* overzicht over alle projecten (hoofdtabblad Aankoop) */
function vAankoop(sub) {   // sub = als deel van het tabblad Facturen (deb-beheer.js): zonder eigen kop
  if (!afbOk()) return `<div class="panel"><div class="empty"><b>Aankoop ${isBeheer() ? "nog niet beschikbaar" : "is enkel voor beheerders"}</b>${isBeheer() ? "Voer databasescript <code>sql/047_aannemer_facturen.sql</code> uit." : ""}</div></div>`;
  S.afbF = S.afbF || { status: "open", q: "" }; const F = S.afbF; const q = (F.q || "").toLowerCase();
  const alle = afbAlle();
  const lijst = alle.filter(f => F.status === "alle" ? true : F.status === "open" ? (f.status === "ontvangen" || f.status === "betwist") : f.status === F.status)
    .filter(f => !q || [afbAannemer(f), f.nummer, f.omschrijving, projName(S.projecten[f.project_id]), (S.projecten[f.project_id] || {}).nummer].join(" ").toLowerCase().includes(q))
    .sort(F.status === "goedgekeurd" ? (a, b) => (a.vervaldag || "9999").localeCompare(b.vervaldag || "9999") : afbSort);
  const som = (l) => l.reduce((s, f) => s + afbIncl(f), 0); const n = (st) => alle.filter(f => st.includes(f.status));
  const maand = todayIso.slice(0, 7); const betaaldMaand = alle.filter(f => f.status === "betaald" && (f.betaald_op || "").startsWith(maand));
  const teBetalen = n(["goedgekeurd"]), vervallen = teBetalen.filter(afbVervallen);
  return `${sub ? `<p class="muted" style="font-size:13px;margin:0 0 14px">Wat aannemers in hun portaal opladen. Keur goed, stel een vraag (de aannemer ziet je toelichting en kan de factuur aanpassen) of zet op betaald. Per project vind je ze ook onder Facturatie, met de kostprijs per lot ernaast.</p>` : `<div class="page-head"><div><div class="eyebrow">Facturen van aannemers</div><h1>Aankoop</h1><div class="sub">Wat aannemers in hun portaal opladen. Keur goed, stel een vraag (de aannemer ziet je toelichting en kan de factuur aanpassen) of zet op betaald. Per project vind je ze ook onder Facturatie, met de kostprijs per lot ernaast.</div></div></div>`}
    <div class="rend" style="margin-bottom:16px"><div class="panel"><div class="k">Te behandelen</div><div class="v">${n(["ontvangen"]).length}</div><div class="muted" style="font-size:12px">${eur2(som(n(["ontvangen"])))} incl. btw</div></div>
      <div class="panel"><div class="k">Vraag aan aannemer</div><div class="v">${n(["betwist"]).length}</div><div class="muted" style="font-size:12px">${eur2(som(n(["betwist"])))}</div></div>
      <div class="panel"><div class="k">Goedgekeurd, te betalen</div><div class="v ${vervallen.length ? "neg" : ""}">${eur2(som(teBetalen))}</div><div class="muted" style="font-size:12px">${teBetalen.length} factu${teBetalen.length === 1 ? "ur" : "ren"}${vervallen.length ? ` · ${vervallen.length} vervallen` : ""}</div></div>
      <div class="panel"><div class="k">Betaald deze maand</div><div class="v">${eur2(som(betaaldMaand))}</div><div class="muted" style="font-size:12px">${betaaldMaand.length} factu${betaaldMaand.length === 1 ? "ur" : "ren"}</div></div></div>
    <div class="toolbar" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">${[["open", "Te behandelen"], ["goedgekeurd", "Te betalen"], ["betaald", "Betaald"], ["alle", "Alle"]].map(([k, l]) => `<button class="btn sm ${F.status === k ? "primary" : ""}" data-afb-act="filter" data-f="${k}">${l}</button>`).join("")}
      <input class="afb-zoek" data-afb="q" type="search" placeholder="Zoek aannemer, nummer, project…" value="${esc(F.q || "")}" autocomplete="off" style="min-width:240px;margin-left:auto;font:inherit;padding:6px 10px;border:1px solid var(--line-2);border-radius:8px;background:var(--surface);color:var(--ink)"></div>
    <div class="panel">${lijst.length ? `<div class="tw"><table class="t af-t"><thead>${afbKop(true)}</thead><tbody>${lijst.map(f => afbRij(f, true)).join("")}</tbody></table></div>` : `<div class="empty"><b>${alle.length ? "Niets in deze lijst" : "Nog geen facturen van aannemers"}</b>${alle.length ? "" : "Aannemers laden hun facturen op in hun portaal (tabblad Facturen)."}</div>`}</div>`;
}
async function afbPatch(id, patch, melding) {
  try { await dbUpdate("aannemer_facturen", id, patch); if (melding) toast(melding); } catch (e) { /* dbUpdate meldde het al */ }
}
async function afbStatus(id, status, el) {
  const f = S.aannemer_facturen[id]; if (!f) return;
  if (status === "betwist") {
    const t = prompt(`Wat moet ${afbAannemer(f)} aanpassen aan factuur ${f.nummer}? (de aannemer ziet dit in zijn portaal)`, f.bros_opmerking || "");
    if (t === null || !t.trim()) { if (el) el.value = f.status; if (t !== null) toast("Schrijf kort wat er moet veranderen."); return; }
    return afbPatch(id, { status, bros_opmerking: t.trim() }, "Vraag doorgegeven — de aannemer ziet ze in zijn portaal");
  }
  return afbPatch(id, { status }, status === "betaald" ? "Betaald — de aannemer ziet het in zijn portaal" : status === "goedgekeurd" ? "Goedgekeurd" : "Status gewijzigd");
}
async function afbOpm(id) {
  const f = S.aannemer_facturen[id]; if (!f) return;
  const t = prompt(`Toelichting bij factuur ${f.nummer} van ${afbAannemer(f)} (de aannemer ziet dit in zijn portaal; leeg = wissen):`, f.bros_opmerking || "");
  if (t === null) return; return afbPatch(id, { bros_opmerking: t.trim() }, "Toelichting bewaard");
}
async function afbPdf(path) {
  const w = window.open("", "_blank");
  const { data, error } = await sb.storage.from("aannemerfacturen").createSignedUrl(path, 600);
  if (error || !data) { if (w) w.close(); toast("Pdf niet te openen: " + (error?.message || "onbekend"), 5000); return; }
  if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-afb-act]"); if (!el) return; const d = el.dataset;
  if (d.afbAct === "pdf") { e.preventDefault(); afbPdf(d.path); }
  if (d.afbAct === "opm") afbOpm(d.id);
  if (d.afbAct === "filter") { S.afbF = { ...(S.afbF || {}), status: d.f }; render(); }
});
document.addEventListener("change", (e) => {
  const el = e.target; if (!el.dataset || !el.dataset.afb) return; const id = el.dataset.id;
  if (el.dataset.afb === "status") afbStatus(id, el.value, el);
  if (el.dataset.afb === "betaald_op") afbPatch(id, { betaald_op: el.value || null });
  if (el.dataset.afb === "klant") afbPatch(id, { zichtbaar_klant: el.checked }, el.checked ? "De klant ziet deze factuur nu in zijn portaal" : "Niet meer zichtbaar voor de klant");
});
document.addEventListener("input", (e) => {
  const el = e.target; if (!el.dataset || el.dataset.afb !== "q") return;
  S.afbF = { ...(S.afbF || { status: "open" }), q: el.value }; const pos = el.selectionStart; render(); const i = document.querySelector('[data-afb="q"]'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (x) { } }
});
