/* =====================================================================
   BROS Planbord — meetstaat.js (v1.72: uit app.js gehaald, ongewijzigd)
   Inhoud: meetstaat: loten, posten, marge, pdf, verslepen, prijsaanvragen, meetstaat voor aannemers, Excel-import.
   Geladen vóór app.js; gebruikt de helpers en de state (S) van app.js pas bij het aanroepen.
   ===================================================================== */
/* ---------- Meetstaat: loten, postenbibliotheek en meetstaatregels per project ---------- */
const MS_STATUS = { offerte: "Offerte", akkoord: "Akkoord", meerwerk: "Meerwerk", minwerk: "Minwerk", vervallen: "Vervallen" };
// 1.65 (script 061): een post die de klant in het portaal goedkeurde, ligt vast; na een goedgekeurde offerte is de meetstaat 'vast'
// (nieuwe posten = meerwerk/minwerk, wijzigen via ± op de post). Posten die met de hand op Akkoord staan, blijven vrij.
const msVast = (r) => !!r && !!r.akkoord_op && true;
const msVastAkkoord = (pid) => Object.values(S.goedkeuringen || {}).filter(g => g.project_id === pid && g.status === "akkoord" && (g.soort === "offerte" || g.soort === "overeenkomst") && (g.posten || []).length > 0).sort((a, b) => (a.beslist_op || "").localeCompare(b.beslist_op || ""))[0] || null;
const msProjVast = (pid) => !!msVastAkkoord(pid);
const MS_VAST_F = ["omschrijving", "locatie", "hoeveelheid", "eenheid", "btw", "status", "marge", "code", "lot", "prijstype"];
const msKinderen = (r) => Object.values(S.meetstaat_posten).filter(x => x.herkomst_post_id === r.id && x.status !== "vervallen" && x.herkomst_soort !== "nieuw");   // (een vervangende post telt niet mee)
const msHuidig = (r) => (Number(r.hoeveelheid) || 0) + msKinderen(r).reduce((s, x) => s + (x.status === "meerwerk" ? Number(x.hoeveelheid) || 0 : x.status === "minwerk" ? -Math.abs(Number(x.hoeveelheid) || 0) : 0), 0);
const EENHEDEN = ["m2", "lm", "m3", "stk", "sog", "uur", "dag", "week", "rol", "zak", "%", "PM"];
const msReady = () => Object.keys(S.loten).length > 0;
const lotenList = () => Object.values(S.loten).filter(l => l.actief !== false).sort((a, b) => a.nr - b.nr);
const lotName = (nr) => S.loten[nr] ? `${nr}. ${S.loten[nr].naam}` : String(nr);
const postenOf = (lot) => Object.values(S.posten).filter(x => x.lot === lot && x.actief !== false).sort((a, b) => a.volgorde - b.volgorde);
const msRows = (pid) => Object.values(S.meetstaat_posten).filter(r => r.project_id === pid).sort((a, b) => a.lot - b.lot || (a.volgorde ?? 0) - (b.volgorde ?? 0) || (a.code || "").localeCompare(b.code || ""));
const msMarge = (r) => r.marge != null && r.marge !== "" ? Number(r.marge) : Number(S.loten[r.lot]?.marge) || 0;
/* Eén rekenregel overal (Planbord, pdf, Excel, vorderingen én klantenportaal — zie sql/033):
   klant-EP = kost × (1 + marge) afgerond op de cent · totaal = hoeveelheid × klant-EP afgerond op de cent */
const msKost = (r) => r2((Number(r.hoeveelheid) || 0) * (Number(r.eenheidsprijs) || 0));
const msVerkoopEP = (r) => r2(r.verkoop_ep != null ? Number(r.verkoop_ep) : (Number(r.eenheidsprijs) || 0) * (1 + msMarge(r)));
const msVerkoop = (r) => r2((Number(r.hoeveelheid) || 0) * msVerkoopEP(r));
/* bedrag met teken: minwerk is altijd een vermindering, ook als de hoeveelheid al negatief ingevuld is (nooit min × min = plus) */
const rowSigned = (r) => r.status === "minwerk" ? -Math.abs(msVerkoop(r)) : msVerkoop(r);
const kostSigned = (r) => r.status === "minwerk" ? -Math.abs(msKost(r)) : msKost(r);
const msTelt = (r) => r.status !== "vervallen";
const eur2 = (n) => Number(n || 0).toLocaleString("nl-BE", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
function msTotals(pid, raVooraf) {
  const rows = msRows(pid).filter(msTelt); const ra = raVooraf !== undefined ? raVooraf : msRaming(pid);
  const t = { kost: 0, verkoop: 0, btw: 0, meerwerk: 0, n: rows.length, kostRaming: 0, verkoopRaming: 0, nRaming: 0 };
  rows.forEach(r => { const v = rowSigned(r); const x = ra && ra.rij[r.id]; if (x && x.bron === "raming") { t.kost += x.kost; t.kostRaming += x.kost; t.verkoopRaming += v; t.nRaming++; } else t.kost += kostSigned(r); if (isMw(r)) t.meerwerk += v; else t.verkoop += v; t.btw += v * (Number(r.btw) || 0); });
  t.kost = r2(t.kost); t.kostRaming = r2(t.kostRaming); t.verkoopRaming = r2(t.verkoopRaming);
  t.marge = t.verkoop + t.meerwerk - t.kost; t.margeRaming = r2(t.verkoopRaming - t.kostRaming); t.incl = t.verkoop + t.meerwerk + t.btw; return t;
}
/* ---------- 1.55 (script 052): geraamde marge voor posten zonder offerte van een aannemer ----------
   De klantprijs blijft altijd zoals hij is; de marge bepaalt enkel de geraamde kostprijs (voor de marge in de meetstaat
   en de financiële planning): kost = klantprijs / (1 + marge %) of klantprijs − marge in €.
   Welke marge: post › lot (% of € verdeeld over de geraamde posten van het lot) › standaard van het project (Financiële
   planning) › algemene standaard. Bron 'auto': gegund via een prijsvraag of met een eigen kostprijs/marge (≠ 0 %) = offerte
   aannemer, al de rest (kostprijs = klantprijs, zoals na een import uit Excel) = raming. Enkel voor beheer. */
const msRamingKlaar = () => isBeheer() && !!S.ms_raming;
const msrPost = (id) => Object.values(S.ms_raming || {}).find(x => x.post_id === id) || null;
const msrLot = (pid, lot) => Object.values(S.ms_raming || {}).find(x => x.project_id === pid && x.post_id == null && Number(x.lot) === Number(lot)) || null;
function msRamingStd(pid) {
  const f = typeof finPlanVan === "function" ? finPlanVan(pid) : null;
  if (f && f.marge_pct != null && f.marge_pct !== "") return { pct: Number(f.marge_pct), bron: "project" };
  const I = typeof finInst === "function" ? finInst() : { marge: 0.25 };
  return { pct: Number.isFinite(Number(I.marge)) ? Number(I.marge) : 0.25, bron: "standaard" };
}
function msRaming(pid) {
  if (!msRamingKlaar()) return null;
  const rows = msRows(pid).filter(msTelt); const std = msRamingStd(pid);
  const gegund = new Set(Object.values(S.prijsvraag_gunningen || {}).map(g => g.post_id));
  const eigen = Object.values(S.ms_raming || {}).filter(x => x.project_id === pid); const pMap = {}, lMap = {};
  eigen.forEach(x => { if (x.post_id) pMap[x.post_id] = x; else lMap[Number(x.lot)] = x; });
  const rij = {}; const perLot = {}; const viaLotBedrag = {};
  const zet = (r, o) => { rij[r.id] = o; const L = perLot[r.lot] = perLot[r.lot] || { verkoop: 0, kost: 0, n: 0, nAannemer: 0, verkoopA: 0, kostA: 0 }; if (o.bron === "raming") { L.verkoop += o.v; L.kost += o.kost; L.n++; } else { L.nAannemer++; L.verkoopA += o.v; L.kostA += o.kost; } };
  rows.forEach(r => {
    const v = rowSigned(r); const pr = pMap[r.id] || null; const lr = lMap[Number(r.lot)] || null;
    const autoA = gegund.has(r.id) || Math.abs(msMarge(r)) > 1e-9 || Number(r.lot) === 21;   // lot 21 = extra budget bouwheer: doorgerekend, geen marge verzinnen
    const keuze = pr && pr.bron !== "auto" ? pr.bron : lr && lr.bron !== "auto" ? lr.bron : null;
    const bron = keuze || (autoA ? "aannemer" : "raming");
    const basis = { v, bron, auto: !keuze, autoBron: autoA ? "aannemer" : "raming" };
    if (bron === "aannemer") return zet(r, { ...basis, kost: kostSigned(r), via: "kostprijs" });
    const s = v < 0 ? -1 : 1;
    if (Math.abs(v) < 0.005) return zet(r, { ...basis, kost: 0, via: "nul", pct: std.pct });   // klantprijs 0 (bv. PM-post): geen marge
    if (pr && pr.bedrag != null) return zet(r, { ...basis, kost: msrKap(v, r2(v - s * Number(pr.bedrag))), via: "post€", bedrag: Number(pr.bedrag) });
    if (pr && pr.marge != null) return zet(r, { ...basis, kost: r2(v / (1 + Number(pr.marge))), via: "post%", pct: Number(pr.marge) });
    if (lr && lr.bedrag != null) { (viaLotBedrag[r.lot] = viaLotBedrag[r.lot] || []).push([r, basis]); return; }
    if (lr && lr.marge != null) return zet(r, { ...basis, kost: r2(v / (1 + Number(lr.marge))), via: "lot%", pct: Number(lr.marge) });
    zet(r, { ...basis, kost: r2(v / (1 + std.pct)), via: std.bron, pct: std.pct });
  });
  // marge in € op lotniveau: evenredig met de klantprijs verdeeld over de geraamde posten van dat lot (centen kloppen op het totaal)
  Object.entries(viaLotBedrag).forEach(([lot, l]) => {
    // verdeeld naar het gewicht |klantprijs|; minwerk krijgt zijn deel met het teken van de post (zoals een bedrag per post)
    const bedrag = Number(lMap[Number(lot)].bedrag); const tot = l.reduce((s, [, b]) => s + Math.abs(b.v), 0);
    if (tot < 0.005) { l.forEach(([r, b]) => zet(r, { ...b, kost: 0, via: "lot€", bedrag: 0 })); return; }
    let rest = r2(bedrag);
    l.forEach(([r, b], i) => { const deel = i === l.length - 1 ? rest : r2(bedrag * Math.abs(b.v) / tot); rest = r2(rest - deel); const s = b.v < 0 ? -1 : 1; zet(r, { ...b, kost: msrKap(b.v, r2(b.v - s * deel)), via: "lot€", bedrag: deel }); });
  });
  Object.values(perLot).forEach(L => { L.verkoop = r2(L.verkoop); L.kost = r2(L.kost); L.marge = r2(L.verkoop - L.kost); L.verkoopA = r2(L.verkoopA); L.kostA = r2(L.kostA); });
  return { rij, perLot, std, pMap, lMap };
}
/* een marge groter dan de klantprijs zou een negatieve kostprijs geven: de kost wordt dan 0 (marge = de hele klantprijs) */
const msrKap = (v, kost) => (v >= 0 ? kost < 0 : kost > 0) ? 0 : kost;
/* invoer "25", "25 %" = marge op de kostprijs · "€ 500", "500 €", "500 eur" = marge in euro · leeg = overerven */
function msrLees(raw) {
  const t = String(raw ?? "").trim(); if (!t) return { marge: null, bedrag: null };
  const euro = /€|eur/i.test(t); const n = leesGetal(t.replace(/eur(o)?/i, ""));
  if (n == null || Number.isNaN(n)) return { fout: `"${t}" is geen geldig getal — bv. 25 (= 25 %) of € 1.500` };
  if (euro) { if (Math.abs(n) >= 1e8) return { fout: "Dat bedrag is te groot." }; return { marge: null, bedrag: r2(n) }; }
  if (n < -99 || n > 1000) return { fout: `Een marge van ${nl(n, 2)} % kan niet — geef een % tussen -99 en 1000 (of een bedrag met €)` };
  return { marge: Math.round(n * 1e4) / 1e6, bedrag: null };
}
const msrToon = (x) => !x ? "" : x.bedrag != null ? "€ " + nl(x.bedrag, 2) : x.marge != null ? pctVeld(x.marge) + " %" : "";
async function msrBewaar(pid, waar, patch) {
  // waar = { post: id } of { lot: nr }; patch = { bron } en/of { marge, bedrag }
  if (!msRamingKlaar()) return;
  const oud = waar.post ? msrPost(waar.post) : msrLot(pid, waar.lot);
  const nieuw = { bron: (oud && oud.bron) || "auto", marge: oud && oud.marge != null ? Number(oud.marge) : null, bedrag: oud && oud.bedrag != null ? Number(oud.bedrag) : null, ...patch };
  const leeg = nieuw.bron === "auto" && nieuw.marge == null && nieuw.bedrag == null;
  try {
    if (oud && leeg) { await dbDelete("ms_raming", oud.id); return; }
    if (oud) { await dbUpdate("ms_raming", oud.id, { bron: nieuw.bron, marge: nieuw.marge, bedrag: nieuw.bedrag }); return; }
    if (leeg) return;
    // enkel de gewijzigde kolommen: bestaat de rij intussen al (andere beheerder), dan blijft de rest staan
    const rij = { project_id: pid, ...patch, ...(waar.post ? { post_id: waar.post } : { lot: Number(waar.lot) }) };
    const { data, error } = await sb.from("ms_raming").upsert(rij, { onConflict: waar.post ? "post_id" : "project_id,lot" }).select().single();
    if (error) { toast("Marge niet bewaard: " + error.message, 6000); render(); return; }
    S.ms_raming[data.id] = data; render();
  } catch (e) { }
}
/* weergave Marges in de meetstaat: per lot en per post de bron en de marge (% of €) */
const MSR_BRON = [["auto", "Automatisch"], ["aannemer", "Offerte aannemer"], ["raming", "Geen offerte (raming)"]];
const msrViaTekst = (x) => !x ? "" : x.bron === "aannemer" ? "kostprijs van de aannemer" : ({ "post€": "bedrag van deze post", "post%": "% van deze post", "lot€": "deel van het bedrag van het lot", "lot%": "% van het lot", project: "standaard van dit project", standaard: "algemene standaard" })[x.via] || "";
function msrInfo(p, t, ra) {
  const f = finPlanVan(p.id); const I = typeof finInst === "function" ? finInst() : { marge: 0.25 };
  return `<div class="msr-info"><div><b>Marges zonder offerte van een aannemer</b> — de klantprijs blijft altijd zoals hij is; de marge die je hier aanduidt bepaalt enkel de geraamde kostprijs (voor de marge hierboven en de financiële planning). Typ een % (bv. <i>25</i>) of een bedrag (bv. <i>€ 1.500</i>); leeg = overerven (post › lot › project › algemeen).</div>
    <div class="msr-tot"><label>Standaardmarge van dit project <input class="inline num" data-msr-std="${p.id}" type="text" inputmode="decimal" autocomplete="off" value="${f && f.marge_pct != null ? pctVeld(f.marge_pct) : ""}" placeholder="${pctVeld(I.marge)}" aria-label="Standaardmarge van dit project in %" style="width:64px"> %</label>
    <span class="muted">${t.nRaming ? `${t.nRaming} geraamde post${t.nRaming === 1 ? "" : "en"}: klantprijs ${eur(t.verkoopRaming)} · marge <b>${eur(t.margeRaming)}</b>${t.kostRaming ? " (" + nl(t.margeRaming / t.kostRaming * 100, 1) + " % op de kost)" : ""}` : "Geen geraamde posten: overal zit een offerte van een aannemer achter."}</span></div></div>`;
}
function msrLotCtl(pid, nr, ra) {
  const lr = msrLot(pid, nr); const L = ra.perLot[nr] || { n: 0, nAannemer: 0, marge: 0 };
  return `<span class="msr-lot" title="Marge voor de posten van dit lot zonder offerte van een aannemer (de klantprijs verandert niet)"><select class="inline" data-msr-lot="${nr}" data-pid="${pid}" data-msrf="bron" aria-label="Bron lot ${nr}">${opts(MSR_BRON.map(([v, l]) => [v, v === "auto" ? "Automatisch per post" : l]), lr ? lr.bron : "auto")}</select>
    <input class="inline num" data-msr-lot="${nr}" data-pid="${pid}" data-msrf="marge" type="text" autocomplete="off" value="${esc(msrToon(lr))}" placeholder="${pctVeld(ra.std.pct)} %" aria-label="Marge lot ${nr} (% of €)" style="width:84px" ${lr && lr.bron === "aannemer" ? "disabled" : ""}>
    <span class="muted num">${L.n ? `${L.n} geraamd · marge ${eur(L.marge)}` : "geen geraamde posten"}${L.nAannemer ? ` · ${L.nAannemer} met offerte` : ""}</span></span>`;
}
function msrPostCellen(r, ra) {
  const x = ra.rij[r.id]; const pr = ra.pMap[r.id] || null;
  if (!x) return `<td class="muted" style="width:124px">vervallen</td><td style="width:64px"></td>`;
  const autoTekst = x.autoBron === "aannemer" ? "Auto: offerte" : "Auto: raming";
  const marge = x.bron === "aannemer" ? `<span class="num" title="Echte marge op de kostprijs van de aannemer">${eur2(r2(x.v - x.kost))}</span>` : `<input class="inline num" data-msr-post="${r.id}" data-pid="${r.project_id}" data-msrf="marge" type="text" autocomplete="off" value="${esc(msrToon(pr))}" placeholder="${x.via === "post€" || x.via === "lot€" ? "€ " + nl(x.bedrag, 0) : pctVeld(x.pct) + " %"}" title="Marge van deze post (% of €) — nu: ${esc(msrViaTekst(x))}. Leeg = overerven." aria-label="Marge ${esc(r.code)}"><small class="muted num" style="display:block">${eur2(r2(x.v - x.kost))}</small>`;
  return `<td style="width:124px"><select class="inline msr-bron ${x.bron}" data-msr-post="${r.id}" data-pid="${r.project_id}" data-msrf="bron" title="${x.auto ? (x.autoBron === "aannemer" ? "Automatisch: gegund via een prijsvraag of met een eigen kostprijs/marge" : "Automatisch: kostprijs = klantprijs (bv. geïmporteerd uit Excel)") : "Zelf gekozen"}" aria-label="Bron ${esc(r.code)}">${opts([["auto", autoTekst], ["aannemer", "Offerte"], ["raming", "Raming"]], pr ? pr.bron : "auto")}</select></td><td style="width:64px">${marge}</td>`;
}
async function msrVeld(el) {
  const d = el.dataset; const pid = d.pid; const waar = d.msrPost ? { post: d.msrPost } : { lot: Number(d.msrLot) };
  if (d.msrf === "bron") return msrBewaar(pid, waar, { bron: el.value });
  const oud = waar.post ? msrPost(waar.post) : msrLot(pid, waar.lot); const v = msrLees(el.value);
  if (v.fout) { toast(v.fout, 6000); render(); return; }
  if ((oud && oud.marge != null ? Number(oud.marge) : null) === v.marge && (oud && oud.bedrag != null ? Number(oud.bedrag) : null) === v.bedrag) return;
  return msrBewaar(pid, waar, { marge: v.marge, bedrag: v.bedrag });
}
async function msrProjectStd(pid, raw) {
  const t = String(raw ?? "").trim(); const n = t ? leesGetal(t) : null;
  if (/€|eur/i.test(t) || Number.isNaN(n) || (n != null && (n < -99 || n >= 1000))) { toast(`"${t}" kan niet als standaardmarge — geef een % op de kostprijs (bv. 25); een bedrag kan per lot of per post`, 6000); render(); return; }
  const m = n == null ? null : Math.round(n * 100) / 1e4; const f = finPlanVan(pid);
  try { if (f) { if ((f.marge_pct == null ? null : Number(f.marge_pct)) !== m) await dbUpdate("fin_plan", f.id, { marge_pct: m }); } else if (m != null) await dbInsert("fin_plan", { project_id: pid, marge_pct: m }); } catch (e) { }
}
function vMeetstaat(p) {
  if (!msReady()) return `<div class="panel"><div class="empty"><b>Meetstaat nog niet beschikbaar</b>Voer eerst databasescript <code>sql/007_meetstaat.sql</code> uit in Supabase (SQL Editor). Daarna verschijnen hier de loten en de postenbibliotheek.</div></div>`;
  // klantweergave: kostprijs, marge en btw-kolom verbergen (bv. tijdens een bespreking met de klant) — onthouden per browser
  if (S.prijsFout) return `<div class="panel"><div class="empty"><b>Prijzen niet correct geladen</b>De prijzen van de meetstaat konden niet opgehaald worden (de databank was even niet bereikbaar of er liep net een databasescript). Herlaad de pagina (⌘⌥R) — tot dan worden er geen bedragen getoond om fouten te vermijden.</div></div>`;
  const rows = msRows(p.id); const beheer = isBeheer() && !S.msKlant; const projVast = msProjVast(p.id); const vastG = projVast ? msVastAkkoord(p.id) : null;
  const ra = msRaming(p.id); const t = msTotals(p.id, ra); const marges = !!(ra && beheer && S.msMarges);   // 1.55: geraamde marges (script 052)
  const byLot = {}; rows.forEach(r => (byLot[r.lot] = byLot[r.lot] || []).push(r));
  const lots = Object.keys(byLot).map(Number).sort((a, b) => a - b);
  const kpi = `<div class="rend">
    ${beheer ? `<div class="panel"><div class="k">Kostprijs excl. btw</div><div class="v">${eur(t.kost)}${t.nRaming ? `<small class="muted" style="font-size:12px;font-weight:400;display:block">waarvan geraamd ${eur(t.kostRaming)}</small>` : ""}</div></div>` : ""}
    <div class="panel"><div class="k">Offerte excl. btw</div><div class="v">${eur(t.verkoop)}</div></div>
    <div class="panel"><div class="k">Meer-/minwerk excl. btw</div><div class="v ${t.meerwerk < 0 ? "neg" : ""}">${t.meerwerk ? eur(t.meerwerk) : "—"}</div></div>
    ${beheer ? `<div class="panel"><div class="k">Marge${t.nRaming ? ` <span class="muted" title="Deels geraamd: ${t.nRaming} post${t.nRaming === 1 ? "" : "en"} zonder offerte van een aannemer (zie Marges)">≈</span>` : ""}</div><div class="v ${t.marge >= 0 ? "pos" : "neg"}">${eur(t.marge)}<small class="muted" style="font-size:12px;font-weight:400"> · ${t.kost ? nl(t.marge / t.kost * 100, 1) : "0"} %</small></div></div>` : ""}
    <div class="panel"><div class="k">Btw</div><div class="v">${eur(t.btw)}</div></div>
    <div class="panel"><div class="k">Totaal incl. btw</div><div class="v">${eur(t.incl)}</div></div></div>`;
  const inp = (r, f, cls = "", attrs = "") => `<input class="inline ${cls}" data-ms="${r.id}" data-f="${f}" value="${esc(r[f] ?? "")}" ${attrs}>`;
  const num = (r, f, cls = "") => `<input class="inline num ${cls}" data-ms="${r.id}" data-f="${f}" type="text" inputmode="decimal" autocomplete="off" value="${getalVeld(r[f])}">`;
  const sel = (r, f, options) => `<select class="inline" data-ms="${r.id}" data-f="${f}">${options}</select>`;
  const cols = 9 + (beheer ? 3 : 0);
  const perRuimte = !!S.msRuimte; const ruimteKey = (r) => (r.locatie || "").trim().toLowerCase();
  if (perRuimte) lots.forEach(nr => byLot[nr].sort((a, b) => (ruimteKey(a) === "" ? 1 : 0) - (ruimteKey(b) === "" ? 1 : 0) || ruimteKey(a).localeCompare(ruimteKey(b), "nl") || (a.volgorde ?? 0) - (b.volgorde ?? 0) || (a.code || "").localeCompare(b.code || "")));
  const body = lots.map(nr => { const g = byLot[nr]; const sub = g.filter(msTelt).reduce((s, r) => s + rowSigned(r), 0); const subk = g.filter(msTelt).reduce((s, r) => s + (ra && beheer && ra.rij[r.id] ? ra.rij[r.id].kost : kostSigned(r)), 0); let lastGroep = null;
    return `<tr class="ms-lot"><td colspan="${cols}"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><span>${esc(lotName(nr))} <span class="muted num" style="font-weight:400">${g.length} posten${beheer ? ` · kost ${eur(subk)}` : ""} · <b>${eur(sub)}</b> excl. btw</span></span>${marges ? msrLotCtl(p.id, nr, ra) : ""}<span class="actions"><button class="btn ghost sm" data-act="ms-add-post" data-pid="${p.id}" data-lot="${nr}">+ Post</button><button class="btn ghost sm danger" data-act="ms-del-lot" data-pid="${p.id}" data-lot="${nr}" title="Alle posten van dit lot verwijderen">✕</button></span></div></td></tr>` +
      g.map((r, i) => { const kop = perRuimte ? ((r.locatie || "").trim() || "Zonder ruimte") : r.groep; const gh = kop && kop !== lastGroep ? `<tr class="ms-groep"><td></td><td colspan="${cols - 1}">${esc(kop)}${perRuimte ? ` <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">· ${g.filter(x => (perRuimte ? ((x.locatie || "").trim() || "Zonder ruimte") : x.groep) === kop).length} posten · ${eur(g.filter(x => msTelt(x) && ((x.locatie || "").trim() || "Zonder ruimte") === kop).reduce((s, x) => s + rowSigned(x), 0))}</span>` : ""}</td></tr>` : ""; lastGroep = kop || lastGroep; const dead = r.status === "vervallen";
        const vast = msVast(r); const ouder = r.herkomst_post_id ? S.meetstaat_posten[r.herkomst_post_id] : null; const kids = vast ? msKinderen(r) : [];
        const tekst = (v, cls = "") => `<span class="ms-vast-t ${cls}" title="Goedgekeurd door de klant — ligt vast">${v}</span>`;
        return gh + `<tr class="${dead ? "ms-dead" : ""}${vast ? " ms-vast" : ""}" data-msrow="${r.id}" data-lot="${nr}"><td class="drag" style="width:26px">${perRuimte ? `<span class="muted" title="Volgorde wijzigen kan in de gewone weergave (Per ruimte uit)">·</span>` : `<span class="grip" draggable="true" data-drag="${r.id}" title="Sleep om de volgorde te wijzigen">⋮⋮</span>`}<span class="updown">${perRuimte ? "" : `<button class="btn ghost sm" data-act="ms-move" data-id="${r.id}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Omhoog">▲</button>`}${perRuimte ? "" : `<button class="btn ghost sm" data-act="ms-move" data-id="${r.id}" data-dir="1" ${i === g.length - 1 ? "disabled" : ""} aria-label="Omlaag">▼</button>`}</span></td><td class="num muted" style="width:52px;white-space:nowrap">${esc(r.code)}</td>
        <td style="min-width:260px">${vast ? tekst(esc(r.omschrijving)) : inp(r, "omschrijving", "wide")}${ouder ? `<small class="muted ms-herkomst">↳ ${r.herkomst_soort === "nieuw" ? "vervangt" : esc(MS_STATUS[r.status] || r.status).toLowerCase() + " op"} post ${esc(ouder.code)}</small>` : ""}</td>
        <td style="width:110px">${vast ? tekst(esc(r.locatie || "")) : inp(r, "locatie", "", 'placeholder="locatie"')}</td>
        <td style="width:84px">${vast ? tekst(nl(r.hoeveelheid, 2), "num") + (kids.length ? `<small class="muted ms-herkomst" title="Na de meer- en minwerken op deze post">nu ${nl(msHuidig(r), 2)}</small>` : "") : num(r, "hoeveelheid")}</td>
        <td style="width:82px">${vast ? tekst(esc(r.eenheid)) : sel(r, "eenheid", opts(EENHEDEN.map(e => [e, e]), r.eenheid))}</td>
        ${marges ? msrPostCellen(r, ra) : beheer ? `<td style="width:96px">${num(r, "eenheidsprijs")}</td><td style="width:64px">${vast ? tekst(pctVeld(r.marge != null && r.marge !== "" ? r.marge : Number(S.loten[r.lot]?.marge) || 0), "num") : `<input class="inline num" data-ms="${r.id}" data-f="marge" type="text" inputmode="decimal" autocomplete="off" placeholder="${pctVeld(Number(S.loten[r.lot]?.marge) || 0)}" value="${pctVeld(r.marge)}" title="Marge % (leeg = marge van het lot)">`}</td>` : ""}
        <td class="r num" style="width:96px" title="Eenheidsprijs voor de klant">${eur2(msVerkoopEP(r))}</td>
        <td class="r num" style="width:104px"><b>${eur2(rowSigned(r))}</b></td>
        ${beheer ? `<td style="width:76px">${vast ? tekst(Math.round(Number(r.btw) * 100) + " %") : sel(r, "btw", opts([[0.06, "6 %"], [0.21, "21 %"], [0, "0 %"]], Number(r.btw)))}</td>` : ""}
        <td style="width:104px">${vast ? `<span class="pill ms-slot" title="Goedgekeurd door de klant — ligt vast">🔒 ${esc(MS_STATUS[r.status] || r.status)}</span>` : sel(r, "status", opts(Object.entries(MS_STATUS).filter(([k]) => !projVast || !["offerte", "akkoord"].includes(k) || k === r.status), r.status))}${r.akkoord_op ? `<small class="muted" style="display:block;color:var(--ok)" title="Goedgekeurd door de klant in het portaal">✓ klant ${fmt(lokDag(r.akkoord_op))}</small>` : ""}</td>
        <td class="r" style="width:36px">${vast ? (["akkoord", "meerwerk"].includes(r.status) ? `<button class="btn ghost sm" data-act="ms-wijzig" data-id="${r.id}" title="Wijzigen via meer- of minwerk (hoeveelheid, schrappen of vervangen)" aria-label="Wijzigen via meer- of minwerk">±</button>` : "") : `<button class="btn ghost sm danger" data-act="ms-del" data-id="${r.id}" aria-label="Verwijderen">✕</button>`}</td></tr>`; }).join(""); }).join("");
  return kpi + (typeof vMeerwerkAanvragen === "function" ? vMeerwerkAanvragen(p) : "") + vGoedkeuringen(p) + (typeof vPrijsvragen === "function" ? vPrijsvragen(p) : vPrijsaanvragen(p)) + vAanMeetstaten(p) + `<div class="panel"><div class="panel-head"><div><h3>Meetstaat</h3><div class="muted" style="font-size:12px;margin-top:2px">${rows.length ? `${rows.length} posten in ${lots.length} loten` : "Nog leeg"} · klik in een veld om het te wijzigen, bewaard bij verlaten van het veld</div>${projVast ? `<div class="ms-vast-banner">🔒 <b>Goedgekeurd door de klant${vastG && vastG.beslist_op ? " op " + fmtLong(lokDag(vastG.beslist_op)) : ""}.</b> De goedgekeurde posten liggen vast: een wijziging gaat via meer- of minwerk (knop ± op de post), nieuwe posten worden meerwerk.</div>` : ""}</div>
      <div class="actions">${isBeheer() && rows.length ? `<select class="btn sm" data-act="ms-btw-alles" data-pid="${p.id}" title="Het btw-tarief van alle posten van dit project in één keer zetten"><option value="">Btw alles…</option><option value="0.06">alles op 6 %</option><option value="0.21">alles op 21 %</option><option value="0">alles op 0 %</option></select><select class="btn sm" data-act="ms-marge-alles" data-pid="${p.id}" title="De marge van alle posten van dit project in één keer zetten (goedgekeurde posten houden hun klantprijs, tenzij je kiest om ze mee te nemen)"><option value="">Marge alles…</option><option value="10">alles op 10 %</option><option value="15">alles op 15 %</option><option value="20">alles op 20 %</option><option value="ander">ander %…</option><option value="lot">lotmarge (eigen marge leegmaken)</option></select>` : ""}<button class="btn sm ${S.msRuimte ? "primary" : ""}" data-act="ms-ruimte" title="Posten per lot groeperen per ruimte (alfabetisch), enkel in deze weergave — de nummering en de export veranderen niet">${S.msRuimte ? "Per ruimte ✓" : "Per ruimte"}</button>${msRamingKlaar() && rows.length && !S.msKlant ? `<button class="btn sm ${S.msMarges ? "primary" : ""}" data-act="ms-marges" title="Per lot en per post aanduiden of er een offerte van een aannemer achter zit, en hoeveel marge BROS heeft op de rest (de klantprijs verandert niet)">${S.msMarges ? "Marges ✓" : "Marges"}</button>` : ""}${isBeheer() ? `<button class="btn sm ${S.msKlant ? "primary" : ""}" data-act="ms-klant" title="Kostprijs, marge en btw-kolom verbergen, bv. als je de meetstaat met de klant overloopt (sneltoets: K)">${S.msKlant ? "👁 Klantweergave aan" : "Klantweergave"}</button>` : ""}${rows.some(r => gkKandidaat(r)) ? `<button class="btn sm" data-act="gk-new" data-pid="${p.id}" title="Offerte of meerwerk bevroren ter goedkeuring in het klantenportaal zetten">Ter goedkeuring voorleggen</button>` : ""}${isBeheer() ? `<button class="btn sm" data-act="ms-import" data-pid="${p.id}" title="Een bestaande meetstaat (Excel, elk BROS-sjabloon) inlezen als posten">Importeren uit Excel</button>` : ""}${rows.length ? `<button class="btn sm" data-act="ms-export" data-pid="${p.id}" title="Excel in het BROS-sjabloon aanmaken in Documenten/Meetstaat van de projectmap">Exporteren naar Drive (Excel)</button><button class="btn sm" data-act="ms-pdf" data-pid="${p.id}" title="Meetstaat als pdf: klantversie of interne versie, per lot of per ruimte">Pdf</button>` : ""}<button class="btn sm" data-act="ms-add-post" data-pid="${p.id}">+ Post</button><button class="btn sm primary" data-act="ms-add-lot" data-pid="${p.id}">+ Lot toevoegen</button></div></div>
    ${marges && rows.length ? msrInfo(p, t, ra) : ""}${rows.length ? `<div class="tw"><table class="t ms${marges ? " ms-marges" : ""}"><thead><tr><th></th><th>Nr</th><th>Omschrijving</th><th>Locatie</th><th>Hoev.</th><th>Eenh.</th>${marges ? `<th title="Zit er een offerte van een aannemer achter deze post?">Bron</th><th title="Marge zonder aannemersofferte: % op de kostprijs of een bedrag in €">Marge</th>` : beheer ? `<th title="Kostprijs / aannemersprijs excl. btw">Kost EP</th><th>Marge</th>` : ""}<th class="r">Klant EP</th><th class="r">Totaal excl.</th>${beheer ? `<th>Btw</th>` : ""}<th>Status</th><th></th></tr></thead><tbody>${body}</tbody></table></div>` : `<div class="empty"><b>Nog geen posten</b>Voeg een lot toe (met de standaardposten) of kies losse posten uit de bibliotheek.</div>`}</div>`;
}
/* ---------- Meetstaat als pdf (jsPDF): klantversie (verkoopprijzen) of interne versie (kost, marge, verkoop) ---------- */
async function msBuildPdf(p, o) {
  const jsPDF = await loadJsPdf(); const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const W = 210, H = 297, M = 14, CW = W - 2 * M; let y = M; const logo = await logoData();
  const ink = [29, 29, 31], muted = [134, 134, 139], line = [220, 220, 224], soft = [240, 240, 242];
  const clean = (t) => String(t || "").replace(/→/g, "->").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/•/g, "-").replace(/ /g, " ");
  const geld = (n) => clean(eur2(n)); const q = (r) => Number(r.hoeveelheid) ? nl(r.hoeveelheid, 2) + " " + (r.eenheid || "") : "";
  const intern = o.versie === "intern";
  const rows = msRows(p.id).filter(r => o.filter === "akkoord" ? ["akkoord", "meerwerk", "minwerk"].includes(r.status) : o.filter === "actief" ? r.status !== "vervallen" : true);
  const rk = (r) => (r.locatie || "").trim();
  // kolommen: [label, breedte, uitlijning, waarde]
  const cols = intern
    ? [["Nr", 12, "l", r => r.code], ["Omschrijving", 66, "l", r => r.omschrijving], ["Hoev.", 20, "r", q], ["Kost EP", 20, "r", r => Number(r.eenheidsprijs) ? geld(r.eenheidsprijs) : ""], ["Marge", 13, "r", r => Number(r.hoeveelheid) ? nl(msMarge(r) * 100, 1) + " %" : ""], ["Klant EP", 20, "r", r => Number(msVerkoopEP(r)) ? geld(msVerkoopEP(r)) : ""], ["Totaal", 22, "r", r => Number(r.hoeveelheid) ? geld(rowSigned(r)) : ""], ["Status", 9, "l", r => ({ offerte: "OFF", akkoord: "OK", meerwerk: "MW", minwerk: "MIN", vervallen: "X" })[r.status] || ""]]
    : [["Nr", 13, "l", r => r.code], ["Omschrijving", 84, "l", r => r.omschrijving], ["Hoev.", 22, "r", q], ["Eenheidsprijs", 24, "r", r => Number(msVerkoopEP(r)) ? geld(msVerkoopEP(r)) : ""], ["Totaal", 24, "r", r => Number(r.hoeveelheid) ? geld(rowSigned(r)) : ""], ["Status", 15, "l", r => ({ offerte: "Offerte", akkoord: "Akkoord", meerwerk: "Meerwerk", minwerk: "Minwerk", vervallen: "Vervallen" })[r.status] || ""]];
  const xs = []; let x = M; cols.forEach(c => { xs.push(x); x += c[1]; });
  const header = () => { if (logo) doc.addImage(logo, "PNG", M, 10, 26, 7.8); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...muted); doc.text(`${clean(projName(p))} · Meetstaat${intern ? " (intern)" : ""} · ${fmtLong(o.datum)}`, W - M, 15, { align: "right" }); doc.setDrawColor(...line); doc.line(M, 20, W - M, 20); y = 26; };
  const footer = () => { const n = doc.getNumberOfPages(); for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(...muted); doc.text(intern ? "BROS · intern document, niet voor de klant" : "BROS · prijzen excl. btw, tenzij anders vermeld", M, H - 8); doc.text(`${i} / ${n}`, W - M, H - 8, { align: "right" }); } };
  const need = (h) => { if (y + h > H - 16) { doc.addPage(); header(); colHead(); } };
  const colHead = () => { doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...muted); cols.forEach((c, i) => doc.text(c[0].toUpperCase(), c[2] === "r" ? xs[i] + c[1] - 1 : xs[i] + 1, y + 3, { align: c[2] === "r" ? "right" : "left" })); doc.setDrawColor(...line); doc.line(M, y + 4.5, W - M, y + 4.5); y += 6.5; };
  header();
  doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(...ink); doc.text(clean(o.titel || "Meetstaat"), M, y + 5); y += 9;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...muted); doc.text(clean(`${projName(p)}${p.adres ? " · " + p.adres + (p.gemeente ? ", " + [p.postcode, p.gemeente].filter(Boolean).join(" ") : "") : ""}${p.nummer ? " · " + p.nummer : ""}`), M, y + 4); y += 7;
  if (o.inleiding) { doc.setFontSize(9.5); doc.setTextColor(...ink); const ls = doc.splitTextToSize(clean(o.inleiding), CW); doc.text(ls, M, y + 4); y += ls.length * 4.6 + 3; }
  y += 2;
  const lots = [...new Set(rows.map(r => r.lot))].sort((a, b) => a - b); let totVerkoop = 0, totKost = 0, totMw = 0, totBtw = 0;
  lots.forEach(lot => {
    let lr = rows.filter(r => r.lot === lot);
    if (o.perRuimte) lr = lr.slice().sort((a, b) => (rk(a) === "" ? 1 : 0) - (rk(b) === "" ? 1 : 0) || rk(a).localeCompare(rk(b), "nl", { sensitivity: "base" }) || (a.volgorde ?? 0) - (b.volgorde ?? 0));
    const sub = lr.filter(msTelt).reduce((s, r) => s + rowSigned(r), 0);
    need(22); y += 3; doc.setFillColor(...soft); doc.roundedRect(M, y, CW, 8, 2, 2, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...ink); doc.text(clean(lotName(lot)), M + 3, y + 5.5); doc.text(geld(sub), W - M - 3, y + 5.5, { align: "right" }); y += 10; colHead();
    let kop = null;
    lr.forEach(r => {
      const k = o.perRuimte ? (rk(r) || "Zonder ruimte") : (r.groep || "");
      if (k && k !== kop) { kop = k; need(8); doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...muted); doc.text(clean(k).toUpperCase(), M + 1, y + 3.2); if (o.perRuimte) { const sk = lr.filter(x => msTelt(x) && (rk(x) || "Zonder ruimte") === k).reduce((s, x) => s + rowSigned(x), 0); doc.text(geld(sk), W - M - 1, y + 3.2, { align: "right" }); } y += 5.5; }
      const oms = doc.splitTextToSize(clean(r.omschrijving) + (r.locatie && !o.perRuimte ? "  (" + clean(r.locatie) + ")" : ""), cols[1][1] - 2); const h = Math.max(1, oms.length) * 3.9 + 2.2;
      need(h); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...(r.status === "vervallen" ? muted : ink));
      cols.forEach((c, i) => { if (i === 1) doc.text(oms, xs[i] + 1, y + 3.2); else doc.text(clean(c[3](r)), c[2] === "r" ? xs[i] + c[1] - 1 : xs[i] + 1, y + 3.2, { align: c[2] === "r" ? "right" : "left" }); });
      doc.setDrawColor(...line); doc.line(M, y + h, W - M, y + h); y += h;
      if (msTelt(r)) { const v = rowSigned(r); if (r.status === "meerwerk" || r.status === "minwerk") totMw += v; else totVerkoop += v; totBtw += v * (Number(r.btw) || 0); totKost += kostSigned(r); }
    });
  });
  // totalen
  need(40); y += 6; const tot = [["Contract excl. btw", totVerkoop], ["Meer-/minwerk excl. btw", totMw], ["Totaal excl. btw", totVerkoop + totMw], [`Btw${p.btw_tarief ? " (" + p.btw_tarief + " %)" : ""}`, totBtw], ["Totaal incl. btw", totVerkoop + totMw + totBtw]];
  if (intern) tot.splice(3, 0, ["Kostprijs excl. btw", totKost], ["Marge", totVerkoop + totMw - totKost]);
  tot.forEach(([k, v], i) => { const bold = /^Totaal/.test(k) || k === "Marge"; doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(bold ? 10.5 : 9.5); doc.setTextColor(...ink); doc.text(clean(k), W - M - 70, y + 4, { align: "left" }); doc.text(geld(v), W - M - 1, y + 4, { align: "right" }); if (k === "Totaal excl. btw" || k === "Marge") { doc.setDrawColor(...line); doc.line(W - M - 70, y + 6, W - M, y + 6); } y += 6.5; });
  if (o.slot) { y += 4; need(20); doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...muted); const ls = doc.splitTextToSize(clean(o.slot), CW); doc.text(ls, M, y + 4); y += ls.length * 4.4; }
  footer();
  return doc.output("blob");
}
function msPdfForm(pid) {
  const p = S.projecten[pid]; if (!p) return; const beheer = isBeheer();
  const rows = msRows(pid); if (!rows.length) { toast("De meetstaat is nog leeg."); return; }
  const inst = (S.instellingen.portaal && S.instellingen.portaal.value) || {};
  openModal("Meetstaat als pdf", `<div class="form-grid">
    <div class="field"><label for="mp_versie">Versie</label><select id="mp_versie" name="versie">${opts([["klant", "Voor de klant — verkoopprijzen, zonder kostprijs en marge"]].concat(beheer ? [["intern", "Intern — kostprijs, marge en verkoopprijs"]] : []), "klant")}</select></div>
    <div class="field"><label for="mp_filter">Welke posten</label><select id="mp_filter" name="filter">${opts([["actief", "Alle posten behalve vervallen"], ["akkoord", "Enkel goedgekeurd (akkoord, meer-/minwerk)"], ["alle", "Alles, ook vervallen"]], "actief")}</select></div>
    <div class="field span2"><label for="mp_titel">Titel</label><input id="mp_titel" name="titel" value="Meetstaat ${esc(p.klant)}"></div>
    <div class="field"><label for="mp_datum">Datum</label><input id="mp_datum" name="datum" type="date" value="${todayIso}"></div>
    <div class="field"><label class="sw-row" style="margin-top:22px"><input type="checkbox" class="sw" name="perRuimte" ${S.msRuimte ? "checked" : ""}><span><b>Per ruimte groeperen</b><small class="muted" style="display:block">Binnen elk lot alfabetisch per ruimte, met subtotaal.</small></span></label></div>
    <div class="field span2"><label for="mp_inl">Inleiding (optioneel, bovenaan)</label><textarea id="mp_inl" name="inleiding" rows="2" placeholder="bv. Meetstaat bij de offerte van ${esc(fmtLong(todayIso))}. Prijzen excl. btw, geldig 30 dagen."></textarea></div>
    <div class="field span2"><label for="mp_slot">Slottekst (optioneel, onder de totalen)</label><textarea id="mp_slot" name="slot" rows="2">${esc(inst.meetstaat_slot || "Hoeveelheden zijn vermoedelijk; de afrekening gebeurt op basis van de werkelijk uitgevoerde hoeveelheden volgens de vorderingsstaat.")}</textarea></div>
    ${p.drive_folder_id && driveReady() ? `<div class="field span2"><label class="chk" style="font-size:13px"><input type="checkbox" name="drive" checked> Ook bewaren in de Drive-map (Documenten/Meetstaat)</label></div>` : ""}
  </div>`, {
    wide: true, saveLabel: "Pdf maken", onSave: async (d) => {
      const btn = $("#mform").querySelector("button[type=submit]"); btn.textContent = "Pdf maken…";
      const o = { versie: d.versie === "intern" && beheer ? "intern" : "klant", filter: d.filter, titel: d.titel.trim(), datum: d.datum || todayIso, perRuimte: d.perRuimte === "on", inleiding: (d.inleiding || "").trim(), slot: (d.slot || "").trim() };
      try {
        const blob = await msBuildPdf(p, o);
        const naam = `${o.datum.split("-").reverse().join("")} MEETSTAAT ${p.klant.toUpperCase()}${o.versie === "intern" ? " INTERN" : ""}.pdf`;
        const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = naam; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
        if (d.drive === "on") { btn.textContent = "Bewaren in Drive…"; const b64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(",")[1]); fr.readAsDataURL(blob); }); try { const j = await driveCall("put", { folderId: p.drive_folder_id, subpath: "Documenten/Meetstaat", name: naam, base64: b64, mime: "application/pdf" }); if (j.file) { const row = { project_id: pid, drive_id: j.file.id, naam: j.file.name, pad: j.file.path || "Documenten/Meetstaat", url: j.file.url, mime: "application/pdf", grootte: j.file.size || blob.size, gewijzigd: j.file.updated || new Date().toISOString(), gesynct_op: new Date().toISOString() }; const { data } = await sb.from("documenten").upsert(row, { onConflict: "project_id,drive_id" }).select().maybeSingle(); if (data) S.documenten[data.id] = data; } toast("Pdf gedownload en bewaard in Documenten/Meetstaat", 5000); } catch (e) { toast("Pdf gedownload, maar niet in Drive bewaard: " + e.message, 7000); } }
        else toast("Pdf gedownload");
      } catch (e) { toast("Pdf mislukt: " + e.message, 7000); btn.textContent = "Pdf maken"; return false; }
    },
  });
}
/* btw van alle posten van een project in één keer (beheer): ook het btw-tarief op de projectfiche volgt mee */
async function msBtwAlles(pid, btw) {
  const nVast = msRows(pid).filter(r => Number(r.btw) !== btw && msVast(r)).length;   // 1.65: goedgekeurde posten liggen vast
  const rows = msRows(pid).filter(r => Number(r.btw) !== btw && !msVast(r)); const p = S.projecten[pid];
  if (!rows.length) { toast(nVast ? `De overige ${nVast} posten zijn goedgekeurd door de klant en liggen vast (btw inbegrepen).` : "Alle posten staan al op " + Math.round(btw * 100) + " %", 6000); return; }
  if (!confirm(`Btw van alle ${msRows(pid).length} posten van ${p.klant} op ${Math.round(btw * 100)} % zetten? (${rows.length} posten veranderen; verzonden facturen blijven bevroren.)${nVast ? `\n\n${nVast} post${nVast === 1 ? "" : "en"} die de klant goedkeurde, blijven zoals ze zijn.` : ""}`)) return;
  S.bulk = true;
  try {
    for (let i = 0; i < rows.length; i += 100) { const ids = rows.slice(i, i + 100).map(r => r.id); const { error } = await sb.from("meetstaat_posten").update({ btw, updated_at: new Date().toISOString() }).in("id", ids); if (error) throw error; ids.forEach(id => { if (S.meetstaat_posten[id]) S.meetstaat_posten[id].btw = btw; }); }
    const tarief = btw === 0.06 ? 6 : btw === 0.21 ? 21 : 0; if (p && p.btw_tarief !== tarief) await dbUpdate("projecten", pid, { btw_tarief: tarief }).catch(() => { });
    toast(`Btw op ${Math.round(btw * 100)} % gezet voor ${rows.length} posten`);
  } catch (e) { toast("Btw niet aangepast: " + e.message, 6000); }
  finally { bulkKlaar(); await msRefetch(rows.map(r => r.id)); }
}
/* 1.48.1: marge van alle posten van een project in één keer (bv. na een import uit Excel, waar elke post 0 % kreeg) */
async function msMargeAlles(pid, keuze) {
  const p = S.projecten[pid]; let pct = null;
  if (keuze === "ander") { const t = prompt("Marge voor alle posten van " + p.klant + " (in %):", "10"); if (t == null) return; pct = leesGetal(t); if (pct == null || Number.isNaN(pct) || pct <= -100 || pct > 1000) { toast("Geef een geldig % (bv. 10)."); return; } }
  else if (keuze !== "lot") pct = Number(keuze);
  const marge = pct == null ? null : Math.round(pct * MARGE_DEC / 100) / MARGE_DEC;
  const alle = msRows(pid).filter(r => r.status !== "vervallen" && !msVast(r));   // 1.65: door de klant goedgekeurde posten liggen vast (klantprijs blijft)
  const goed = alle.filter(r => ["akkoord", "meerwerk", "minwerk"].includes(r.status));
  const label = pct == null ? "de lotmarge" : nl(pct, 2) + " %";
  const open = alle.length - goed.length;
  if (open && !confirm(`Marge van ${open} post${open === 1 ? "" : "en"} van ${p.klant} op ${label} zetten?${goed.length ? `\n\n${goed.length} goedgekeurde post${goed.length === 1 ? "" : "en"} (akkoord, meer- of minwerk) blijven op hun klantprijs.` : ""}`)) return;
  let rows = alle.filter(r => !goed.includes(r));
  if (goed.length && confirm(`Ook de ${goed.length} goedgekeurde post${goed.length === 1 ? "" : "en"} op ${label} zetten?\n\nLet op: hun klantprijs verandert dan, terwijl de klant een andere prijs goedkeurde.\n\nOK = ook die · Annuleren = enkel de andere posten`)) rows = alle;
  rows = rows.filter(r => !((r.marge == null || r.marge === "") && marge == null) && !(r.marge != null && r.marge !== "" && marge != null && Math.abs(Number(r.marge) - marge) < 1e-9));
  if (!rows.length) { toast("Alle posten staan al op " + label); return; }
  S.bulk = true;
  try {
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100).map(r => ({ post_id: r.id, marge }));
      const { error } = await sb.from("meetstaat_prijzen").upsert(chunk, { onConflict: "post_id" }); if (error) throw error;
    }
    toast(`Marge op ${label} gezet voor ${rows.length} posten — klantprijzen herrekend`, 5000);
  } catch (e) { toast("Marge niet aangepast: " + e.message, 6000); }
  finally { bulkKlaar(); await msRefetch(rows.map(r => r.id)); }
}
/* ---------- Meetstaat: posten verslepen binnen een lot; nummers (lot.n) en volgorde volgen automatisch ---------- */
async function msReorder(pid, lot, movedId, targetId, before) {
  const rows = msRows(pid).filter(r => r.lot === lot); const from = rows.findIndex(r => r.id === movedId); if (from < 0) return;
  const [moved] = rows.splice(from, 1);
  let to = targetId ? rows.findIndex(r => r.id === targetId) : (before ? 0 : rows.length); if (to < 0) to = rows.length; if (!before && targetId) to += 1;
  rows.splice(to, 0, moved);
  // groep van de nieuwe buur overnemen, zodat de post niet als losse groepskop verschijnt
  const buur = rows[to - 1] || rows[to + 1]; const groep = buur ? (buur.groep || "") : (moved.groep || "");
  const patches = [];
  const codesVast = rows.some(msVast);   // 1.65: de klant keurde posten met hun nummer goed → nummers blijven, enkel de volgorde schuift
  rows.forEach((r, i) => { const code = codesVast ? r.code : `${lot}.${i + 1}`; const volg = (i + 1) * 10; const g = r.id === moved.id ? groep : (r.groep || "");
    if (r.code !== code || (r.volgorde ?? 0) !== volg || (r.groep || "") !== g) patches.push({ id: r.id, code, volgorde: volg, groep: g }); });
  if (!patches.length) return;
  S.bulk = true;
  patches.forEach(x => Object.assign(S.meetstaat_posten[x.id], x)); render();
  try { await Promise.all(patches.map(x => sb.from("meetstaat_posten").update({ ...(codesVast ? {} : { code: x.code }), volgorde: x.volgorde, groep: x.groep, updated_at: new Date().toISOString() }).eq("id", x.id).then(r => { if (r.error) throw r.error; }))); toast(codesVast ? "Volgorde aangepast (de nummers blijven: dit lot bevat goedgekeurde posten)" : "Volgorde en nummers aangepast"); }
  catch (e) { toast("Volgorde niet bewaard: " + e.message, 6000); }
  finally { bulkKlaar(); await msRefetch(rows.map(r => r.id)); }
}
let msDrag = null;
document.addEventListener("dragstart", (e) => { const h = e.target.closest && e.target.closest("[data-drag]"); if (!h) return; const tr = h.closest("tr"); msDrag = { id: h.dataset.drag, lot: Number(tr.dataset.lot), pid: S.project }; tr.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", h.dataset.drag); } catch (x) { } });
document.addEventListener("dragover", (e) => { if (!msDrag) return; const tr = e.target.closest && e.target.closest("tr[data-msrow]"); document.querySelectorAll("tr.drop-before, tr.drop-after").forEach(x => x.classList.remove("drop-before", "drop-after")); if (!tr || Number(tr.dataset.lot) !== msDrag.lot || tr.dataset.msrow === msDrag.id) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; const r = tr.getBoundingClientRect(); tr.classList.add(e.clientY < r.top + r.height / 2 ? "drop-before" : "drop-after"); });
document.addEventListener("drop", (e) => { if (!msDrag) return; const tr = e.target.closest && e.target.closest("tr[data-msrow]"); const d = msDrag; msDrag = null; document.querySelectorAll("tr.dragging, tr.drop-before, tr.drop-after").forEach(x => x.classList.remove("dragging", "drop-before", "drop-after")); if (!tr || Number(tr.dataset.lot) !== d.lot || tr.dataset.msrow === d.id) return; e.preventDefault(); const r = tr.getBoundingClientRect(); msReorder(d.pid, d.lot, d.id, tr.dataset.msrow, e.clientY < r.top + r.height / 2); });
document.addEventListener("dragend", () => { msDrag = null; document.querySelectorAll("tr.dragging, tr.drop-before, tr.drop-after").forEach(x => x.classList.remove("dragging", "drop-before", "drop-after")); });
/* ---------- Prijsaanvragen (script 025): eenheidsprijzen opvragen bij aannemers via het aannemersportaal, vergelijken en overnemen als kostprijs ---------- */
const PA_STATUS = { open: "In te vullen", ingediend: "Ingediend", gekozen: "Gekozen", afgesloten: "Afgesloten" };
const paOf = (pid) => Object.values(S.prijsaanvragen || {}).filter(a => a.project_id === pid).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
const paRegels = (aid) => Object.values(S.prijsaanvraag_regels || {}).filter(r => r.aanvraag_id === aid);
const paPosten = (a) => msRows(a.project_id).filter(r => (a.loten || []).includes(r.lot) && r.status !== "vervallen");
function vPrijsaanvragen(p) {
  if (!isBeheer() || S.msKlant) return "";
  const as = paOf(p.id); const aannemers = contactsOf(p.id).filter(x => !KLANT_ROLLEN.includes(x.rol) && x.c.soort !== "klant");
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Prijsaanvragen bij aannemers</h3><div class="muted" style="font-size:12px;margin-top:2px">De aannemer krijgt een mail (met uitnodiging voor het portaal als hij nog geen login heeft) en vult per post een eenheidsprijs in via zijn portaal (hij ziet enkel hoeveelheden, nooit jullie prijzen); daarna vergelijk je en neem je de gekozen prijzen over als kostprijs.${" Zolang een aanvraag open staat, stuurt het Drive-script elke week automatisch een herinnering (op werkdagen; na 4 herinneringen krijg jij een seintje). Indienen of afsluiten stopt dat."}</div></div>
      <div class="actions">${as.some(a => a.status !== "afgesloten") ? `<button class="btn sm" data-act="pa-cmp" data-pid="${p.id}">Vergelijken</button>` : ""}<button class="btn sm primary" data-act="pa-new" data-pid="${p.id}" ${aannemers.length ? "" : `title="Koppel eerst een aannemer aan dit project (Dossier › Contacten)"`}>+ Prijsaanvraag</button></div></div>
    ${as.length ? `<div class="tw"><table class="t"><thead><tr><th>Aanvraag</th><th>Aannemer</th><th>Loten</th><th class="r">Ingevuld</th><th class="r">Totaal</th><th>Reageren vóór</th><th>Status</th><th></th></tr></thead><tbody>
      ${as.map(a => { const c = S.contacten[a.contact_id]; const ps = paPosten(a); const rs = paRegels(a.id).filter(r => r.eenheidsprijs != null); const byPost = Object.fromEntries(rs.map(r => [r.post_id, r])); const tot = ps.reduce((s, r) => s + (byPost[r.id] ? Number(byPost[r.id].eenheidsprijs) * Number(r.hoeveelheid || 0) : 0), 0);
        return `<tr class="${a.status === "afgesloten" ? "ms-dead" : ""}"><td><div class="row-title">${esc(a.titel || "Prijsaanvraag")}<small>${fmtLong(lokDag(a.created_at))}${a.ingediend_op ? " · ingediend " + fmtLong(lokDag(a.ingediend_op)) : ""}${a.herinneringen ? ` · ${Math.min(a.herinneringen, 4)}× herinnerd${a.herinnerd_op ? ", laatst " + fmtLong(lokDag(a.herinnerd_op)) : ""}${a.herinneringen > 4 ? " — gestopt" : ""}` : ""}${a.opmerking ? ` · “${esc(a.opmerking)}”` : ""}</small></div></td><td>${c ? `<a href="#" data-contact="${c.id}">${esc(c.naam)}</a>${c.user_id ? "" : ` <span class="pill st-offerte" title="Nog geen login voor het aannemersportaal; de uitnodiging zit in de mail">geen login</span>`}` : "—"}</td><td class="muted" style="font-size:12px">${(a.loten || []).map(l => esc(lotName(l))).join("<br>")}</td><td class="r num">${ps.filter(r => byPost[r.id]).length} / ${ps.length}</td><td class="r num">${rs.length ? eur(tot) : "—"}</td><td class="num ${a.status === "open" && a.deadline && a.deadline < todayIso ? "late" : ""}">${a.deadline ? fmtLong(a.deadline) : "—"}</td><td><span class="pill ${a.status === "gekozen" ? "done" : a.status === "ingediend" ? "st-lopend" : a.status === "open" ? "st-offerte" : "kl"}">${PA_STATUS[a.status]}</span></td>
          <td class="r" style="white-space:nowrap">${a.status !== "afgesloten" && rs.length ? `<button class="btn ghost sm" data-act="pa-take" data-id="${a.id}" title="De ingevulde prijzen van deze aannemer overnemen als kostprijs in de meetstaat">Overnemen</button>` : ""}${a.status === "open" && driveReady() ? `<button class="btn ghost sm" data-act="pa-remind" data-id="${a.id}" title="Herinnering mailen">Herinneren</button>` : ""}${a.status !== "afgesloten" ? `<button class="btn ghost sm" data-act="pa-close" data-id="${a.id}" title="Afsluiten (de aannemer kan niets meer invullen)">Afsluiten</button>` : ""}<button class="btn ghost sm danger" data-act="pa-del" data-id="${a.id}" aria-label="Verwijderen">✕</button></td></tr>`; }).join("")}
    </tbody></table></div>` : `<div class="empty"><b>Nog geen prijsaanvragen</b>Stuur een aannemer de posten van zijn lot(en); hij vult de prijzen in via het aannemersportaal.</div>`}</div>`;
}
function paForm(pid) {
  const p = S.projecten[pid]; if (!p) return;
  const aannemers = contactsOf(pid).filter(x => !KLANT_ROLLEN.includes(x.rol) && x.c.soort !== "klant");
  if (!aannemers.length) { toast("Koppel eerst een aannemer aan dit project (Dossier › Contacten)."); return; }
  const lots = [...new Set(msRows(pid).filter(r => r.status !== "vervallen").map(r => r.lot))].sort((a, b) => a - b);
  if (!lots.length) { toast("De meetstaat is nog leeg."); return; }
  const dl = addDays(todayIso, 14);
  openModal("Prijsaanvraag versturen", `<div class="form-grid">
    <div class="field"><label for="pa_c">Aannemer</label><select id="pa_c" name="contact_id">${aannemers.map(x => `<option value="${x.c.id}" data-loten="${(x.loten || []).length ? x.loten.join(",") : (x.c.loten || []).join(",")}">${esc(x.c.naam)}${x.c.vakgebied ? " · " + esc(x.c.vakgebied) : ""}${x.c.email ? "" : " (geen e-mail!)"}${x.c.user_id ? "" : " · nog geen portaallogin"}</option>`).join("")}</select><small class="muted">Zonder login krijgt hij in dezelfde mail een uitnodiging voor het aannemersportaal.</small></div>
    <div class="field"><label for="pa_dl">Reageren vóór</label><input id="pa_dl" name="deadline" type="date" value="${dl}"><small class="muted">Staat in de mail en in zijn portaal${"; na een week zonder indiening volgt automatisch elke week een herinnering"}. Leeg = geen datum.</small></div>
    <div class="field span2"><label for="pa_t">Titel</label><input id="pa_t" name="titel" value="Prijsaanvraag ${esc(p.klant)}"></div>
    <div class="field span2"><label>Loten <span class="muted" style="font-weight:400">— de aannemer ziet de posten van deze loten met hoeveelheden en eenheden</span></label><div class="fase-list">${lots.map(l => `<label class="chk"><input type="checkbox" name="lot" value="${l}"> <span>${esc(lotName(l))} <small class="muted">${msRows(pid).filter(r => r.lot === l && r.status !== "vervallen").length} posten</small></span></label>`).join("")}</div></div>
    <div class="field span2"><label for="pa_b">Bericht aan de aannemer</label><textarea id="pa_b" name="bericht" rows="3">Beste, graag je eenheidsprijzen (excl. btw, inclusief levering en plaatsing) voor onderstaande posten. Opmerkingen of alternatieven kan je per post toevoegen.</textarea></div>
  </div>`, {
    wide: true, saveLabel: "Versturen", onSave: async (d) => {
      const loten = [...$("#mform").querySelectorAll('input[name="lot"]:checked')].map(i => Number(i.value)); if (!loten.length) { toast("Kies minstens één lot."); return false; }
      const c = S.contacten[d.contact_id]; if (!c || !c.email) { toast("Dit contact heeft geen e-mailadres."); return false; }
      const row = await dbInsert("prijsaanvragen", { project_id: pid, contact_id: d.contact_id, loten, titel: d.titel.trim(), bericht: (d.bericht || "").trim(), deadline: d.deadline || null, created_by: S.me.id });
      if (driveReady()) { try { const j = await driveCall("prijsaanvraagmail", { id: row.id, soort: "nieuw", token: S.session?.access_token || "" }); toast(`Prijsaanvraag gemaild naar ${j.naar || c.email}${j.uitgenodigd ? " (met uitnodiging voor het portaal)" : ""}`, 6000); } catch (e) { toast("Aanvraag bewaard, maar mailen mislukte: " + e.message, 8000); } }
      else toast("Prijsaanvraag bewaard (niet gemaild: Drive-script niet ingesteld)");
    },
  });
  const sel = $("#pa_c"); const syncLots = () => { const ls = (sel.selectedOptions[0]?.dataset.loten || "").split(",").filter(Boolean).map(Number); $("#mform").querySelectorAll('input[name="lot"]').forEach(i => i.checked = ls.includes(Number(i.value))); }; sel.addEventListener("change", syncLots); syncLots();
}
function paVergelijk(pid) {
  const as = paOf(pid).filter(a => a.status !== "afgesloten"); if (!as.length) return;
  const lots = [...new Set(as.flatMap(a => a.loten || []))].sort((a, b) => a - b);
  const prijs = (a, postId) => { const r = paRegels(a.id).find(x => x.post_id === postId); return r && r.eenheidsprijs != null ? Number(r.eenheidsprijs) : null; };
  const opm = (a, postId) => { const r = paRegels(a.id).find(x => x.post_id === postId); return r ? r.opmerking : ""; };
  const naam = (a) => S.contacten[a.contact_id]?.naam || "?";
  let html = `<div class="tw"><table class="t ms"><thead><tr><th>Nr</th><th>Omschrijving</th><th class="r">Hoev.</th><th class="r" title="Huidige kostprijs in de meetstaat">Kost nu</th>${as.map(a => `<th class="r">${esc(naam(a))}<small class="muted" style="display:block;font-weight:400">${PA_STATUS[a.status]}</small></th>`).join("")}</tr></thead><tbody>`;
  const tot = { nu: 0 }; as.forEach(a => tot[a.id] = 0);
  lots.forEach(lot => {
    const rows = msRows(pid).filter(r => r.lot === lot && r.status !== "vervallen"); const sub = { nu: 0 }; as.forEach(a => sub[a.id] = 0);
    html += `<tr class="ms-lot"><td colspan="${4 + as.length}">${esc(lotName(lot))}</td></tr>`;
    rows.forEach(r => { const h = Number(r.hoeveelheid || 0); const nu = Number(r.eenheidsprijs) || 0; sub.nu += nu * h; const ps = as.map(a => prijs(a, r.id)); const min = Math.min(...ps.filter(x => x != null));
      html += `<tr><td class="num muted">${esc(r.code)}</td><td>${esc(r.omschrijving)}${r.locatie ? `<small class="muted" style="display:block">${esc(r.locatie)}</small>` : ""}</td><td class="r num" style="white-space:nowrap">${h ? nl(h, 2) + " " + esc(r.eenheid) : ""}</td><td class="r num muted">${nu ? eur2(nu) : "—"}</td>${as.map((a, i) => { const x = ps[i]; if (x != null) sub[a.id] += x * h; const o = opm(a, r.id); return `<td class="r num" style="${x != null && x === min && ps.filter(y => y != null).length > 1 ? "color:var(--ok);font-weight:600" : ""}" title="${esc(o)}">${x == null ? "—" : eur2(x)}${o ? ` <span title="${esc(o)}">💬</span>` : ""}</td>`; }).join("")}</tr>`; });
    html += `<tr class="ms-groep"><td></td><td>Subtotaal ${esc(lotName(lot))}</td><td></td><td class="r num">${eur(sub.nu)}</td>${as.map(a => `<td class="r num"><b>${eur(sub[a.id])}</b></td>`).join("")}</tr>`;
    tot.nu += sub.nu; as.forEach(a => tot[a.id] += sub[a.id]);
  });
  html += `<tr class="ms-lot"><td></td><td>Totaal (posten met prijs)</td><td></td><td class="r num">${eur(tot.nu)}</td>${as.map(a => `<td class="r num">${eur(tot[a.id])}</td>`).join("")}</tr></tbody></table></div>
    <div class="actions" style="margin-top:12px;flex-wrap:wrap">${as.map(a => `<button type="button" class="btn sm" data-act="pa-take" data-id="${a.id}" data-fromcmp="1">Prijzen van ${esc(naam(a))} overnemen</button>`).join("")}</div><p class="muted" style="font-size:12px;margin:8px 0 0">Overnemen zet de ingevulde eenheidsprijzen als kostprijs in de meetstaat (enkel de posten waarvoor die aannemer een prijs gaf); de klantprijs volgt via de marge. Groen = laagste prijs.</p>`;
  openModal("Prijzen vergelijken", html, { wide: true, saveLabel: "Sluiten", onSave: async () => { } });
  $("#mform").querySelector(".mf button.btn:not(.primary)")?.remove();
}
async function paOvernemen(id) {
  const a = S.prijsaanvragen[id]; if (!a) return; const n = paRegels(id).filter(r => r.eenheidsprijs != null).length;
  if (!n) { toast("Deze aannemer heeft nog geen prijzen ingevuld."); return; }
  if (!confirm(`${n} prijzen van ${S.contacten[a.contact_id]?.naam || "deze aannemer"} overnemen als kostprijs in de meetstaat? Bestaande kostprijzen van die posten worden overschreven.`)) return;
  const { data, error } = await sb.rpc("prijsaanvraag_overnemen", { p_id: id });
  if (error) { toast("Overnemen mislukt: " + error.message, 6000); return; }
  await msRefetch(paPosten(a).map(r => r.id)); await refetch("prijsaanvragen"); toast(`${data} kostprijzen overgenomen`);
  if (driveReady()) driveCall("prijsaanvraagmail", { id, soort: "gekozen", token: S.session?.access_token || "" }).catch(() => { });
}
/* ---------- Meetstaat voor aannemers: met prijzen, ter goedkeuring (script 032, alleen beheer) ----------
   Per aannemer: zijn loten (zonder binnenschrijnwerk, tenzij aangevinkt), aannemersprijs = klantprijs × (1 − marge),
   standaardmarge 10 %, per post aan te passen of een vaste prijs. Delen = een vaste momentopname in zijn portaal;
   bij akkoord worden zijn prijzen de kostprijs (klantprijs blijft gelijk, de marge wordt herrekend). */
const AM_STATUS = { concept: "Concept", gedeeld: "Gedeeld — wacht op akkoord", akkoord: "Akkoord", tegenvoorstel: "Tegenvoorstel", ingetrokken: "Niet meer gedeeld" };
const AM_PILL = { concept: "st-offerte", gedeeld: "vs-open", akkoord: "done", tegenvoorstel: "late", ingetrokken: "" };
const amReady = () => isBeheer();
const amOf = (pid) => Object.values(S.aannemer_meetstaten || {}).filter(a => a.project_id === pid);
const amPostRows = (amId) => Object.values(S.aannemer_meetstaat_posten || {}).filter(r => r.am_id === amId);
const amBinnen = (lot) => /binnenschrijnwerk/i.test(S.loten[lot]?.naam || "");
const amAannemers = (pid) => contactsOf(pid).filter(x => !KLANT_ROLLEN.includes(x.rol) && x.c.soort !== "klant");
const amLoten = (x) => ((x.loten || []).length ? x.loten : (x.c.loten || [])).map(Number);
const amRond = (n) => Math.round((Number(n) || 0) * 100) / 100;
const amTxt = (n) => amRond(n).toFixed(2).replace(".", ",");
function amRegel(r, marge, ov, loten) {   // berekende regel voor één meetstaatpost
  const std = loten.includes(r.lot) && !amBinnen(r.lot) && r.status !== "vervallen";
  const tonen = r.status === "vervallen" ? false : (ov && ov.tonen != null ? !!ov.tonen : std);
  const m = ov && ov.marge != null && ov.marge !== "" ? Number(ov.marge) : Number(marge);
  const klant = msVerkoopEP(r); const vast = ov && ov.prijs != null && ov.prijs !== "";
  const prijs = vast ? amRond(ov.prijs) : amRond(klant * (1 - m));
  return { r, std, tonen, marge: m, eigenMarge: !!(ov && ov.marge != null && ov.marge !== ""), klant, prijs, vast };
}
function amBereken(pid, a, ovs, loten) {   // alle regels + momentopname + totalen
  const regels = msRows(pid).map(r => amRegel(r, a.marge ?? 0.1, ovs[r.id], loten));
  const zicht = regels.filter(x => x.tonen);
  const snap = zicht.map(x => ({ post_id: x.r.id, lot: x.r.lot, code: x.r.code || "", groep: x.r.groep || "", omschrijving: x.r.omschrijving || "", locatie: x.r.locatie || "", eenheid: x.r.eenheid || "", prijstype: x.r.prijstype || "EP", hoeveelheid: Number(x.r.hoeveelheid) || 0, status: x.r.status, prijs: x.prijs }));
  const tot = zicht.reduce((s, x) => { const h = Number(x.r.hoeveelheid) || 0; const t = (v) => x.r.status === "minwerk" ? -Math.abs(r2(v * h)) : r2(v * h); s.klant += t(x.klant); s.aan += t(x.prijs); return s; }, { klant: 0, aan: 0 });
  return { regels, snap, tot };
}
const amSnapKey = (snap) => JSON.stringify((snap || []).map(x => [x.post_id, Number(x.hoeveelheid) || 0, amRond(x.prijs), x.omschrijving, x.eenheid]).sort((a, b) => a[0].localeCompare(b[0])));
function amOvsVan(a) { const o = {}; if (a && a.id) amPostRows(a.id).forEach(r => o[r.post_id] = { id: r.id, tonen: r.tonen, marge: r.marge, prijs: r.prijs }); return o; }
function vAanMeetstaten(p) {
  if (!amReady() || S.msKlant || !msRows(p.id).length) return "";
  const lijst = amAannemers(p.id);
  const rij = (x) => {
    const a = amOf(p.id).find(m => m.contact_id === x.c.id); const loten = amLoten(x);
    const { snap, tot } = amBereken(p.id, a || { marge: 0.1 }, amOvsVan(a), loten);
    const gewijzigd = a && a.gedeeld && ["gedeeld", "akkoord", "tegenvoorstel"].includes(a.status) && amSnapKey(snap) !== amSnapKey(a.regels);
    const st = a ? a.status : "";
    return `<tr><td><a href="#" data-contact="${x.c.id}">${esc(x.c.naam)}</a>${x.c.user_id ? "" : ` <span class="pill st-offerte" title="Nog geen login voor het aannemersportaal; bij delen krijgt hij een uitnodiging">geen login</span>`}<small class="muted" style="display:block">${esc(CONTACT_ROL[x.rol] || x.rol || "")}</small></td>
      <td>${loten.length ? loten.map(l => esc(lotName(l))).join(", ") : `<span class="muted">geen loten gekoppeld</span>`}</td>
      <td class="r num">${snap.length}</td><td class="r num">${eur(tot.aan)}</td><td class="r num">${tot.klant ? nl((1 - tot.aan / tot.klant) * 100, 1) + " %" : "—"}</td>
      <td>${st ? `<span class="pill ${AM_PILL[st] || ""}">${esc(AM_STATUS[st] || st)}${a.versie ? " · v" + a.versie : ""}</span>` : `<span class="muted">—</span>`}${a && a.beslist_op && ["akkoord", "tegenvoorstel"].includes(st) ? `<small class="muted" style="display:block">${esc(a.beslist_naam || "")} · ${fmtLong(lokDag(a.beslist_op))}</small>` : ""}${gewijzigd ? `<small style="display:block;color:var(--crit)">gewijzigd sinds delen</small>` : ""}</td>
      <td class="r"><button class="btn sm ${st === "tegenvoorstel" || gewijzigd ? "primary" : ""}" data-act="am-open" data-pid="${p.id}" data-cid="${x.c.id}">${a ? "Openen" : "Prijzen opmaken"}</button></td></tr>`;
  };
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Meetstaat voor aannemers</h3><div class="muted" style="font-size:12px;margin-top:2px">Per aannemer zijn posten met zijn prijs: klantprijs min marge (standaard 10 %, per post aan te passen of een vaste prijs). Binnenschrijnwerk staat er niet in, tenzij je het aanvinkt. Na delen keurt hij goed in zijn portaal; bij akkoord worden zijn prijzen de kostprijs en blijft de klantprijs gelijk.</div></div></div>
    ${lijst.length ? `<div class="tw"><table class="t"><thead><tr><th>Aannemer</th><th>Loten</th><th class="r">Posten</th><th class="r">Totaal aannemer</th><th class="r">Marge</th><th>Status</th><th></th></tr></thead><tbody>${lijst.map(rij).join("")}</tbody></table></div>`
      : `<div class="empty"><b>Nog geen aannemers gekoppeld</b>Koppel een aannemer met zijn loten in Dossier › Contacten.</div>`}</div>`;
}
let AM = null;
function amOpen(pid, cid) {
  const p = S.projecten[pid]; const x = amAannemers(pid).find(y => y.c.id === cid); if (!p || !x) return;
  const a = amOf(pid).find(m => m.contact_id === cid) || null;
  AM = { pid, cid, x, a, marge: a ? Number(a.marge) : 0.1, bericht: a ? a.bericht || "" : "", ovs: amOvsVan(a), loten: amLoten(x), open: {} };
  const reactie = a && ["gedeeld", "tegenvoorstel", "akkoord"].includes(a.status) ? a : null;
  openModal(`Meetstaat met prijzen — ${x.c.naam}`, `
    <div class="form-grid">
      <div class="field"><label for="am_marge">Marge BROS (% van de klantprijs)</label><input id="am_marge" type="text" inputmode="decimal" autocomplete="off" value="${nl(AM.marge * 100, 2)}"><small class="muted">Aannemersprijs = klantprijs × (1 − marge). Per post kan je een eigen marge of een vaste prijs zetten.</small></div>
      <div class="field"><label>Status</label><div style="padding-top:6px" id="am_status"></div></div>
      <div class="field span2"><label for="am_bericht">Bericht aan de aannemer (bovenaan in zijn portaal en in de mail)</label><textarea id="am_bericht" rows="2" placeholder="bv. Prijzen excl. btw, inclusief levering en plaatsing. Graag je akkoord tegen vrijdag.">${esc(AM.bericht)}</textarea></div>
      ${reactie && reactie.opmerking ? `<div class="field span2"><div class="notice" style="margin:0"><div><b>Opmerking van ${esc(reactie.beslist_naam || x.c.naam)}:</b> ${esc(reactie.opmerking)}</div></div></div>` : ""}
      ${a && a.status === "akkoord" && Array.isArray(a.niet_toegepast) && a.niet_toegepast.length ? `<div class="field span2"><div class="notice" style="margin:0;border-color:var(--warn)"><div><b>${a.niet_toegepast.length} post${a.niet_toegepast.length > 1 ? "en" : ""} niet automatisch overgenomen als kostprijs</b> — de prijs of marge werd na het delen nog gewijzigd, of er was geen klantprijs. Controleer en vul de kostprijs zelf in de meetstaat in:<ul style="margin:6px 0 0 18px">${a.niet_toegepast.map(id => { const g = (a.regels || []).find(q => q.post_id === id) || {}; const r = S.meetstaat_posten[id]; return `<li>${esc(g.code || r?.code || "")} ${esc(g.omschrijving || r?.omschrijving || "(verwijderde post)")} — aannemersprijs ${eur2(g.prijs)}${r ? ` · nu kost ${eur2(r.eenheidsprijs)}, klant ${eur2(msVerkoopEP(r))}` : ""}</li>`; }).join("")}</ul></div></div></div>` : ""}
    </div>
    <div id="am_tabel"></div>
    <div class="actions" style="margin-top:12px;justify-content:space-between;flex-wrap:wrap;gap:8px"><span class="muted" style="font-size:12px" id="am_tot"></span>
      <span style="display:flex;gap:8px;flex-wrap:wrap">${a && a.gedeeld ? `<button type="button" class="btn sm ghost danger" data-am="intrekken">Niet meer delen</button>` : ""}<button type="button" class="btn sm" data-am="delen">${a && a.gedeeld ? "Bewaren en opnieuw delen" : "Bewaren en delen met aannemer"}</button></span></div>`,
    { wide: true, saveLabel: "Bewaren", onSave: async () => { try { await amBewaar(false); toast("Bewaard"); } catch (e) { if (!e.__toasted) toast("Bewaren mislukt: " + (e.message || e), 6000); return false; } } });
  $("#modal").style.width = "min(1180px, 100%)";
  amTekenTabel();
  const m = $("#mform");   // het formulier wordt bij elke modal opnieuw gemaakt: geen dubbele luisteraars
  m.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "am_marge") { const v = leesGetal(t.value); if (v == null || Number.isNaN(v) || v < 0 || v >= 100) { toast("Geef een marge tussen 0 en 100 %."); t.value = nl(AM.marge * 100, 2); return; } AM.marge = v / 100; return setTimeout(() => amTekenTabel(), 0); }
    if (t.id === "am_bericht") { AM.bericht = t.value; return; }
    const post = t.dataset.amPost; if (!post) { if (t.dataset.amLot) { const lot = Number(t.dataset.amLot); msRows(pid).filter(r => r.lot === lot && r.status !== "vervallen").forEach(r => { const o = AM.ovs[r.id] = AM.ovs[r.id] || {}; const std = AM.loten.includes(r.lot) && !amBinnen(r.lot); o.tonen = t.checked === std ? null : t.checked; }); amTekenTabel(); } return; }
    const o = AM.ovs[post] = AM.ovs[post] || {}; const r = S.meetstaat_posten[post];
    if (t.dataset.f === "tonen") { const std = AM.loten.includes(r.lot) && !amBinnen(r.lot); o.tonen = t.checked === std ? null : t.checked; }
    else if (t.dataset.f === "marge") { const v = t.value.trim() === "" ? null : leesGetal(t.value); if (v != null && (Number.isNaN(v) || v < -100 || v >= 100)) { toast(Number.isNaN(v) ? `"${t.value}" is geen geldig getal.` : "Geef een marge tussen −100 en 100 %."); } else o.marge = v == null ? null : v / 100; }
    else if (t.dataset.f === "prijs") { const v = t.value.trim() === "" ? null : leesGetal(t.value); if (v != null && (Number.isNaN(v) || v < 0)) toast(Number.isNaN(v) ? `"${t.value}" is geen geldig getal — niet bewaard.` : "Geef een positieve prijs."); else o.prijs = v == null ? null : amRond(v); }
    setTimeout(() => amTekenTabel(), 0);   // na het verplaatsen van de focus (Tab), zodat die bewaard blijft
  });
  m.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-am],[data-am-neem],[data-am-open]"); if (!b) return;
    if (b.dataset.amOpen) { AM.open[b.dataset.amOpen] = !AM.open[b.dataset.amOpen]; return amTekenTabel(); }
    if (b.dataset.amNeem) { const post = b.dataset.amNeem; const tp = AM.a?.reactie?.[post]?.tegenprijs; if (tp == null) return; const o = AM.ovs[post] = AM.ovs[post] || {}; o.prijs = amRond(tp); return amTekenTabel(); }
    const act = b.dataset.am; b.disabled = true;
    try {
      if (act === "delen") {
        const { snap } = amBereken(pid, { marge: AM.marge }, AM.ovs, AM.loten); if (!snap.length) { toast("Er staat geen enkele post aangevinkt."); return; }
        if (!x.c.email) { toast("Deze aannemer heeft geen e-mailadres (Dossier › Contacten)."); }
        if (!confirm(`${snap.length} posten delen met ${x.c.naam}${AM.a && AM.a.gedeeld ? ` als versie ${(AM.a.versie || 0) + 1} (zijn vorige akkoord of reactie vervalt)` : ""}? Hij ziet enkel zijn eigen prijzen, nooit de klantprijs of jullie marge.`)) return;
        await amBewaar(true); MODAL.dirty = false; closeModal();
      } else if (act === "intrekken") {
        if (!confirm(`De meetstaat niet meer delen met ${x.c.naam}? Hij ziet ze dan niet meer in zijn portaal.`)) return;
        await dbUpdate("aannemer_meetstaten", AM.a.id, { gedeeld: false, status: "ingetrokken" }); MODAL.dirty = false; closeModal(); toast("Niet meer gedeeld");
      }
    } catch (er) { if (!er.__toasted) toast("Mislukt: " + (er.message || er), 6000); } finally { b.disabled = false; }
  });
}
function amTekenTabel(focusEl) {
  if (!AM) return; const box = $("#am_tabel"); if (!box) return; const pid = AM.pid; const a = AM.a;
  const act = document.activeElement; const ak = act && act.dataset && act.dataset.amPost ? [act.dataset.amPost, act.dataset.f] : null;
  const { regels, snap, tot } = amBereken(pid, { marge: AM.marge }, AM.ovs, AM.loten);
  const reactie = a && ["gedeeld", "tegenvoorstel", "akkoord"].includes(a.status) ? (a.reactie || {}) : {};
  const gedeeldPrijs = Object.fromEntries((a && a.gedeeld ? a.regels || [] : []).map(x => [x.post_id, x.prijs]));
  const lots = [...new Set(regels.map(x => x.r.lot))].sort((p, q) => (AM.loten.includes(q) - AM.loten.includes(p)) || p - q);
  const body = lots.map(lot => {
    const rs = regels.filter(x => x.r.lot === lot); const zijn = AM.loten.includes(lot); const binnen = amBinnen(lot); const aan = rs.filter(x => x.tonen).length;
    const open = AM.open[lot] ?? ((zijn && !binnen) || aan > 0); const levend = rs.filter(x => x.r.status !== "vervallen");
    const kop = `<tr class="ms-lot"><td style="width:30px"><input type="checkbox" data-am-lot="${lot}" ${levend.length && levend.every(x => x.tonen) ? "checked" : ""} title="Alle posten van dit lot tonen of verbergen"></td><td colspan="8"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center"><span>${esc(lotName(lot))} ${zijn ? `<span class="pill done" style="font-weight:500">zijn lot</span>` : `<span class="pill" style="font-weight:500">ander lot</span>`}${binnen ? ` <span class="pill st-offerte" style="font-weight:500">binnenschrijnwerk — standaard niet</span>` : ""} <span class="muted num" style="font-weight:400">${aan} / ${rs.length} getoond</span></span><button type="button" class="btn ghost sm" data-am-open="${lot}">${open ? "Verbergen ▴" : "Posten tonen ▾"}</button></div></td></tr>`;
    if (!open) return kop;
    let groep = null;
    return kop + rs.map(x => {
      const r = x.r; const ov = AM.ovs[r.id] || {}; const h = Number(r.hoeveelheid) || 0; const re = reactie[r.id]; const dood = r.status === "vervallen";
      const gh = r.groep && r.groep !== groep ? ((groep = r.groep), `<tr class="ms-groep"><td></td><td colspan="8">${esc(r.groep)}</td></tr>`) : "";
      const veranderd = a && a.gedeeld && x.tonen && gedeeldPrijs[r.id] != null && amRond(gedeeldPrijs[r.id]) !== x.prijs;
      return gh + `<tr class="${x.tonen ? "" : "ms-dead"}"><td><input type="checkbox" data-am-post="${r.id}" data-f="tonen" ${x.tonen ? "checked" : ""} ${dood ? "disabled" : ""} title="${x.std ? "Standaard getoond" : "Standaard niet getoond"}"></td>
        <td class="num muted" style="width:48px">${esc(r.code || "")}</td><td style="min-width:200px">${esc(r.omschrijving || "")}${r.locatie ? `<small class="muted" style="display:block">${esc(r.locatie)}</small>` : ""}${dood ? ` <span class="pill">vervallen</span>` : ""}</td>
        <td class="r num" style="white-space:nowrap">${h ? nl(h, 2) + " " + esc(r.eenheid || "") : esc(r.prijstype && r.prijstype !== "EP" ? r.prijstype : r.eenheid || "")}</td>
        <td class="r num muted" title="Klantprijs per eenheid">${eur2(x.klant)}</td>
        <td style="width:70px"><input class="inline num" data-am-post="${r.id}" data-f="marge" type="text" inputmode="decimal" autocomplete="off" placeholder="${nl(AM.marge * 100, 2)}" value="${x.eigenMarge ? nl(x.marge * 100, 2) : ""}" ${x.vast ? `disabled title="Vaste prijs ingevuld"` : `title="Marge % voor deze post (leeg = ${nl(AM.marge * 100, 2)} %)"`}></td>
        <td style="width:100px"><input class="inline num" data-am-post="${r.id}" data-f="prijs" type="text" inputmode="decimal" autocomplete="off" placeholder="${amTxt(x.klant * (1 - x.marge))}" value="${x.vast ? amTxt(x.prijs) : ""}" title="Vaste aannemersprijs per eenheid (leeg = klantprijs − marge)"></td>
        <td class="r num" style="white-space:nowrap"><b>${x.tonen && h ? eur2(r.status === "minwerk" ? -Math.abs(r2(x.prijs * h)) : r2(x.prijs * h)) : ""}</b>${veranderd ? `<small style="display:block;color:var(--crit)" title="Gedeeld: ${eur2(gedeeldPrijs[r.id])}">was ${eur2(gedeeldPrijs[r.id])}</small>` : ""}</td>
        <td style="min-width:120px;font-size:12px">${re ? `${re.opmerking ? `<span title="${esc(re.opmerking)}">💬 ${esc(re.opmerking.length > 60 ? re.opmerking.slice(0, 58) + "…" : re.opmerking)}</span>` : ""}${re.tegenprijs != null ? `<div style="white-space:nowrap">tegenprijs <b>${eur2(re.tegenprijs)}</b> <button type="button" class="btn ghost sm" data-am-neem="${r.id}" title="Deze prijs overnemen als vaste prijs">Overnemen</button></div>` : ""}` : ""}</td></tr>`;
    }).join("");
  }).join("");
  box.innerHTML = `<div class="tw" style="max-height:58vh;overflow:auto;margin-top:10px"><table class="t ms"><thead><tr><th></th><th>Nr</th><th>Omschrijving</th><th class="r">Hoev.</th><th class="r">Klant EP</th><th>Marge %</th><th>Aannemer EP</th><th class="r">Totaal</th><th>Reactie aannemer</th></tr></thead><tbody>${body}</tbody></table></div>`;
  const st = $("#am_status"); if (st) { const gew = a && a.gedeeld && ["gedeeld", "akkoord", "tegenvoorstel"].includes(a.status) && amSnapKey(snap) !== amSnapKey(a.regels); st.innerHTML = a ? `<span class="pill ${AM_PILL[a.status] || ""}">${esc(AM_STATUS[a.status] || a.status)}${a.versie ? " · versie " + a.versie : ""}</span>${a.gedeeld_op ? ` <small class="muted">gedeeld ${fmtLong(lokDag(a.gedeeld_op))}</small>` : ""}${a.beslist_op ? ` <small class="muted">· ${a.status === "akkoord" ? "akkoord" : "gereageerd"} door ${esc(a.beslist_naam || "")} op ${fmtLong(lokDag(a.beslist_op))}</small>` : ""}${gew ? `<div style="color:var(--crit);font-size:12px;margin-top:4px">Gewijzigd sinds delen — deel opnieuw om zijn akkoord te vragen.</div>` : ""}` : `<span class="muted">Nog niet gedeeld</span>`; }
  const nul = snap.filter(x => !(Number(x.prijs) > 0) && Number(x.hoeveelheid)).length;
  const tt = $("#am_tot"); if (tt) tt.innerHTML = `${nul ? `<span style="color:var(--crit)">${nul} post${nul === 1 ? "" : "en"} zonder prijs</span> · ` : ""}<b>${snap.length}</b> posten · klant ${eur(tot.klant)} · aannemer <b>${eur(tot.aan)}</b> · marge BROS <b>${eur(tot.klant - tot.aan)}</b>${tot.klant ? ` (${nl((1 - tot.aan / tot.klant) * 100, 1)} %)` : ""} — excl. btw`;
  const terug = (k) => k && box.querySelector(`[data-am-post="${k[0]}"][data-f="${k[1]}"]`);
  const el = terug(ak); if (el) el.focus();
}
async function amBewaar(delen) {
  const pid = AM.pid, cid = AM.cid; let a = AM.a && S.aannemer_meetstaten[AM.a.id] ? S.aannemer_meetstaten[AM.a.id] : AM.a;
  const bericht = ($("#am_bericht")?.value ?? AM.bericht).trim();
  const basis = { marge: Math.round(AM.marge * 10000) / 10000, bericht };
  if (!a) a = await dbInsert("aannemer_meetstaten", { project_id: pid, contact_id: cid, ...basis, created_by: S.me.id });
  else await dbUpdate("aannemer_meetstaten", a.id, basis);
  // afwijkingen per post: enkel bewaren wat afwijkt van de standaard
  const bestaand = amPostRows(a.id); const upsert = [], weg = [];
  msRows(pid).forEach(r => { const o = AM.ovs[r.id]; const leeg = !o || (o.tonen == null && (o.marge == null || o.marge === "") && (o.prijs == null || o.prijs === "")); const ex = bestaand.find(b => b.post_id === r.id);
    if (leeg) { if (ex) weg.push(ex.id); return; }
    upsert.push({ am_id: a.id, post_id: r.id, tonen: o.tonen == null ? null : !!o.tonen, marge: o.marge == null || o.marge === "" ? null : Math.round(Number(o.marge) * 10000) / 10000, prijs: o.prijs == null || o.prijs === "" ? null : amRond(o.prijs) }); });
  if (upsert.length) { const { error } = await sb.from("aannemer_meetstaat_posten").upsert(upsert, { onConflict: "am_id,post_id" }); if (error) { toast("Bewaren mislukt: " + error.message, 6000); error.__toasted = true; throw error; } }
  if (weg.length) { const { error } = await sb.from("aannemer_meetstaat_posten").delete().in("id", weg); if (error) { toast("Bewaren mislukt: " + error.message, 6000); error.__toasted = true; throw error; } }
  await refetch("aannemer_meetstaat_posten");
  if (delen) {
    const { snap } = amBereken(pid, { marge: AM.marge }, AM.ovs, AM.loten);
    const cur = S.aannemer_meetstaten[a.id] || a;
    a = await dbUpdate("aannemer_meetstaten", a.id, { gedeeld: true, versie: (Number(cur.versie) || 0) + 1, status: "gedeeld", regels: snap, gedeeld_op: new Date().toISOString(), gedeeld_door: S.me.id, reactie: {}, opmerking: "", beslist_op: null, beslist_naam: "", beslist_door: null });
    const c = S.contacten[cid];
    if (driveReady() && c && c.email) { try { const j = await driveCall("aanprijsmail", { id: a.id, soort: "gedeeld", token: S.session?.access_token || "" }); toast(`Gedeeld en gemaild naar ${j.naar || c.email}${j.uitgenodigd ? " (met uitnodiging voor het portaal)" : ""}`, 6000); } catch (e) { toast("Gedeeld, maar mailen mislukte: " + e.message + " — de aannemer ziet het wel in zijn portaal.", 8000); } }
    else toast(`Gedeeld met ${c ? c.naam : "de aannemer"} — zichtbaar in zijn portaal${c && !c.email ? " (geen e-mailadres, dus geen mail)" : ""}`, 6000);
  }
  AM.a = S.aannemer_meetstaten[a.id] || a; return AM.a;
}
/* ---------- Meetstaat importeren uit een bestaand Excel-bestand ---------- */
function msImportPick(pid) {
  modLaad("excel").catch(() => { });   // 1.72: de Excel-module alvast laden terwijl je een bestand kiest (msImportFile wacht erop)
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) msImportFile(pid, f).catch(err => { loader.fail(); toast("Import: " + err.message); }); };
  inp.click();
}
async function msImportPlaceholders() {
  // regels van het lege sjabloon: onaangeroerde sjabloonregels (zonder cijfers) worden niet geïmporteerd
  if (msImportPlaceholders.cache) return msImportPlaceholders.cache;
  try {
    await modLaad("excel");   // 1.72
    if (!templateCache && driveReady()) { const j = await driveCall("template", { match: "MEETSTAAT" }); const bin = atob(j.base64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); templateCache = { name: j.name, bytes }; }
    if (!templateCache) return [];
    const t = await window.MeetstaatImport.parse(templateCache.bytes, window.JSZip, []);
    msImportPlaceholders.cache = t.lots.flatMap(l => l.posts.filter(p => !p._groep).map(p => p.omschrijving.split("\n")[0]));
  } catch (e) { msImportPlaceholders.cache = []; }
  return msImportPlaceholders.cache;
}
async function msImportFile(pid, file) {
  const p = S.projecten[pid]; if (!p) return;
  loader.start("ms.import", "Excel lezen…", 3000);
  await modLaad("excel");   // 1.72
  if (!window.JSZip || !window.MeetstaatImport) throw new Error("Importmodule niet geladen — herlaad de pagina.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  // sjabloonregels ophalen via het Drive-script; duurt dat te lang (of hapert het script), dan zonder verder
  const ph = await Promise.race([msImportPlaceholders(), new Promise(r => setTimeout(() => r(msImportPlaceholders.cache || []), 8000))]);
  loader.step("Posten herkennen…");
  const parsed = await window.MeetstaatImport.parse(bytes, window.JSZip, ph);
  loader.done("ms.import");
  if (!parsed.lots.length) return toast("Geen loten met posten gevonden in dit bestand.");
  const existing = msRows(pid).length;
  const ov = parsed.overzicht.onvoorzien;
  const lotRows = parsed.lots.map(l => `<tr><td class="num">${l.lot}</td><td>${esc(l.naam)}${S.loten[l.lot] ? "" : ` <span class="pill late">lot ${l.lot} bestaat niet in het Planbord</span>`}</td><td class="r num">${l.posts.filter(x => !x._groep).length}</td><td class="r num">${eur(l.som)}</td></tr>`).join("");
  openModal("Meetstaat importeren", `<div class="muted" style="margin-bottom:10px"><b>${esc(file.name)}</b>${parsed.head.titel ? ` · ${esc(parsed.head.titel)}` : ""}</div>
    <div class="tw" style="max-height:300px;overflow:auto"><table class="t"><thead><tr><th>Lot</th><th>Naam in Excel</th><th class="r">Posten</th><th class="r">Excl. btw</th></tr></thead><tbody>${lotRows}
    ${ov ? `<tr><td class="num">21</td><td>Onvoorziene kost / extra budget (10 %) <span class="muted">uit het blad OVERZICHT</span></td><td class="r num">1</td><td class="r num">${eur(ov)}</td></tr>` : ""}
    <tr class="tot"><td></td><td><b>Totaal</b></td><td class="r num"><b>${parsed.posts}</b></td><td class="r num"><b>${eur(parsed.totaal + (ov || 0))}</b></td></tr></tbody></table></div>
    <div class="form-grid" style="margin-top:12px">
      ${msProjVast(pid) ? `<div class="field span2"><div class="ms-vast-banner" style="margin:0">🔒 De meetstaat is goedgekeurd door de klant: de posten uit dit bestand komen erbij als <b>meerwerk</b>; de bestaande posten blijven staan.</div><input type="hidden" name="status" value="meerwerk"><input type="hidden" name="mode" value="append"></div>` : `<div class="field"><label for="mi_status">Status van de posten</label><select id="mi_status" name="status"><option value="akkoord">Akkoord (getekend contract)</option><option value="offerte">Offerte</option></select></div>`}
      ${msProjVast(pid) ? "" : msRows(pid).some(msVast) ? `<div class="field"><label>Dit project heeft al ${existing} posten</label><div class="muted" style="padding:7px 0;font-size:13px">De nieuwe posten komen erbij — vervangen kan niet: de klant keurde al posten goed.</div><input type="hidden" name="mode" value="append"></div>` : existing ? `<div class="field"><label for="mi_mode">Dit project heeft al ${existing} posten</label><select id="mi_mode" name="mode"><option value="replace">Bestaande posten vervangen</option><option value="append">Toevoegen aan de bestaande posten</option></select></div>` : `<div class="field"><label>Bestaande posten</label><div class="muted" style="padding:7px 0">Nog geen — alles wordt nieuw aangemaakt.</div></div>`}
      ${ov ? `<div class="field span2"><label class="chk"><input type="checkbox" name="budget21" value="1" checked> Onvoorziene kost (10 %) overnemen als post in lot 21</label></div>` : ""}
    </div>
    <div class="muted" style="font-size:12px;margin-top:10px">De eenheidsprijs in de Excel is de klantprijs: die komt binnen als prijs met marge 0 %, zodat de totalen exact gelijk blijven. Vul daarna per post de echte kost en marge in. Lege sjabloonregels worden overgeslagen.</div>
    ${parsed.warnings.length ? `<details style="margin-top:10px"><summary class="muted" style="cursor:pointer">${parsed.warnings.length} opmerking${parsed.warnings.length === 1 ? "" : "en"} bij het inlezen</summary><ul class="muted" style="font-size:12px;margin:6px 0 0 16px">${parsed.warnings.slice(0, 40).map(w => `<li>${esc(w)}</li>`).join("")}</ul></details>` : ""}`, {
    saveLabel: "Importeren", wide: true,
    onSave: async (d) => {
      const rows = window.MeetstaatImport.toRows(parsed, pid, { status: d.status, budget21: !!d.budget21, opmerking: `Import uit ${file.name} · ${fmtLong(todayIso)}` });
      const missing = [...new Set(rows.map(r => r.lot))].filter(l => !S.loten[l]);
      if (missing.length) { toast(`Lot ${missing.join(", ")} bestaat niet in het Planbord — voeg dat lot eerst toe onder Instellingen › Loten.`); return false; }
      if (existing && d.mode !== "replace") {   // 1.48.2: dezelfde meetstaat nog eens toevoegen verdubbelt alles — eerst vragen
        const sleutel = (r) => r.lot + "|" + String(r.omschrijving || "").trim().toLowerCase().slice(0, 80) + "|" + (Number(r.hoeveelheid) || 0);
        const al = new Set(msRows(pid).filter(r => r.status !== "vervallen").map(sleutel)); const dubbel = rows.filter(r => al.has(sleutel(r))).length;
        if (dubbel >= 5 && dubbel >= rows.length * 0.3 && !confirm(`${dubbel} van de ${rows.length} posten in dit bestand staan al in de meetstaat (zelfde lot, omschrijving en hoeveelheid).\n\nToevoegen maakt ze dubbel. Wil je de meetstaat vervangen, kies dan "Bestaande posten vervangen".\n\nOK = toch toevoegen · Annuleren = terug`)) return false;
      }
      loader.start("ms.import2", "Posten bewaren…", 4000);
      let nieuwIds = [], oudWeg = 0;
      try {
        // eerst de nieuwe posten bewaren, pas daarna de oude weghalen: mislukt het bewaren, dan blijft de bestaande meetstaat staan
        const oude = existing && d.mode === "replace" ? msRows(pid).map(r => r.id) : [];
        const gf = msGefactureerd(oude); if (gf) { loader.fail(); toast(`${gf} bestaande post${gf === 1 ? "" : "en"} sta${gf === 1 ? "at" : "an"} al in een vordering — vervangen zou die facturen wijzigen. Kies "Toevoegen aan de bestaande posten".`, 10000); return false; }
        S.bulk = true; nieuwIds = [];
        // sinds script 012 staan kostprijs en marge in meetstaat_prijzen: msInsert splitst dat (klantprijs = prijs met marge 0 %)
        for (let i = 0; i < rows.length; i += 200) { const ins = await msInsert(rows.slice(i, i + 200), true); nieuwIds.push(...ins.map(r => r.id)); }
        for (let i = 0; i < oude.length; i += 200) { const { error } = await sb.from("meetstaat_posten").delete().in("id", oude.slice(i, i + 200)); if (error) throw error; oudWeg += Math.min(200, oude.length - i); }
        bulkKlaar(); await refetch("meetstaat_posten"); loader.done("ms.import2");
        toast(`${rows.length} posten geïmporteerd uit ${file.name}`);
      } catch (e) {
        // half mislukt: zolang er nog geen oude post weg is, de al bewaarde nieuwe posten terug weghalen (geen verdubbeling); anders de nieuwe houden (niets kwijt)
        if (e && e.ids) nieuwIds.push(...e.ids.filter(id => !nieuwIds.includes(id)));   // posten van de mislukte reeks (prijzen niet bewaard) ook opruimen
        if (!oudWeg) for (let i = 0; i < nieuwIds.length; i += 200) { try { await sb.from("meetstaat_posten").delete().in("id", nieuwIds.slice(i, i + 200)); } catch (x) { } }
        bulkKlaar(); loader.fail(); toast(oudWeg ? "Import onderbroken: de nieuwe posten staan erin, maar niet alle oude posten konden weg — kijk de meetstaat na (" + e.message + ")" : "Import mislukt (niets gewijzigd): " + e.message, 9000); await refetch("meetstaat_posten"); return false; }
    },
  });
}
async function exportMeetstaat(p) {
  if (!driveReady()) throw new Error("Drive-koppeling niet ingesteld (Instellingen → Drive).");
  if (!p.drive_folder_id) throw new Error("Dit project heeft nog geen Drive-map (Dossier → map koppelen of aanmaken).");
  await modLaad("excel");   // 1.72
  if (!window.JSZip || !window.MeetstaatExport) throw new Error("Exportmodule niet geladen — herlaad de pagina.");
  loader.start("ms.export", "Sjabloon ophalen…", 9000);
  if (!templateCache) { const j = await driveCall("template", { match: "MEETSTAAT" }); const bin = atob(j.base64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); templateCache = { name: j.name, bytes }; }
  loader.step("Meetstaat opbouwen…");
  const rows = msRows(p.id).filter(msTelt).map(r => ({ lot: r.lot, groep: r.groep, omschrijving: r.omschrijving, locatie: r.locatie, artikelnr: r.artikelnr, hoeveelheid: r.status === "minwerk" ? -Math.abs(Number(r.hoeveelheid) || 0) : Number(r.hoeveelheid) || 0 /* minwerk negatief: in het sjabloon is eindsaldo = hoeveelheid × prijs + kolom T, de tekst WEGGELATEN telt niet mee */, eenheid: r.eenheid, prijs: msVerkoopEP(r), btw: Number(r.btw) || 0, status: r.status }));
  const { bytes } = await window.MeetstaatExport.build(templateCache.bytes, { project: p, rows, titel: "MEETSTAAT", date: new Date(), vorderingen: vordExportData(p) });
  loader.step("Wegschrijven in Documenten/Meetstaat…");
  let b64 = ""; for (let i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); b64 = btoa(b64);
  const name = `MEETSTAAT ${(p.klant || "").toUpperCase()}.xlsx`;
  // nieuwe versie komt in Documenten/Meetstaat/DEF; de vorige versie verhuist naar Documenten/Meetstaat met haar datum in de naam (logboek)
  const j = await driveCall("put", { folderId: p.drive_folder_id, subpath: "Documenten/Meetstaat/DEF", archiveTo: "Documenten/Meetstaat", name, base64: b64 });
  const f = j.file; const now = new Date().toISOString();
  const docs = [{ project_id: p.id, drive_id: f.id, naam: f.name, pad: f.path || "Documenten/Meetstaat/DEF", url: f.url, mime: f.mime || "", grootte: f.size || null, gewijzigd: f.updated || null, gesynct_op: now }]
    .concat((j.archived || []).map(a => ({ project_id: p.id, drive_id: a.id, naam: a.name, pad: a.path || "Documenten/Meetstaat", url: a.url, mime: a.mime || "", grootte: a.size || null, gewijzigd: a.updated || null, gesynct_op: now })));
  const { data } = await sb.from("documenten").upsert(docs, { onConflict: "project_id,drive_id" }).select(); (data || []).forEach(d => S.documenten[d.id] = d);
  loader.done("ms.export"); render(); toast(j.archived && j.archived.length ? `Nieuwe versie bewaard in DEF · vorige versie gearchiveerd als "${j.archived[0].name}"` : `Meetstaat bewaard: ${f.name}`);
  window.open(f.url, "_blank", "noopener");
}
/* bibliotheek beheren (Instellingen) */
function vPostenBeheer() {
  if (!msReady()) return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h3>Postenbibliotheek meetstaat</h3></div><div class="empty">Voer eerst <code>sql/007_meetstaat.sql</code> uit in Supabase.</div></div>`;
  const ls = lotenList(); if (S.selLot == null || !S.loten[S.selLot]) S.selLot = ls[0]?.nr;
  const l = S.loten[S.selLot]; const ps = Object.values(S.posten).filter(x => x.lot === S.selLot).sort((a, b) => a.volgorde - b.volgorde);
  return `<div class="grid two" style="grid-template-columns: 1fr 2fr;margin-bottom:16px">
    <div class="panel"><div class="panel-head"><h3>Loten meetstaat</h3></div>
      <div class="tw"><table class="t"><thead><tr><th></th><th>Lot</th><th class="r" title="Standaardmarge op de kostprijs">Marge</th><th></th></tr></thead><tbody>${ls.map(x => `<tr class="click ${x.nr === S.selLot ? "sel" : ""}" data-sellot="${x.nr}"><td class="num" style="width:36px;color:var(--muted)">${x.nr}</td><td>${esc(x.naam)}<small class="muted" style="display:block">${postenOf(x.nr).filter(p => p.standaard_aan).length} standaard · ${postenOf(x.nr).length} posten${x.buildwise ? " · BBW " + esc(x.buildwise) : ""}</small></td><td class="r" style="width:90px;white-space:nowrap"><input class="inline num" style="width:52px;text-align:right" data-lot="${x.nr}" data-f="marge" type="text" inputmode="decimal" autocomplete="off" value="${pctVeld(Number(x.marge) || 0)}" aria-label="Marge %"> %</td><td style="width:40px"><input type="checkbox" data-lot="${x.nr}" data-f="standaard_aan" ${x.standaard_aan ? "checked" : ""} title="Standaard aan bij nieuw project"></td></tr>`).join("")}</tbody></table></div>
      <div class="panel-body muted" style="font-size:12px;border-top:1px solid var(--line)">Marge = standaardopslag op de kostprijs voor alle posten van het lot (per post te overschrijven in de meetstaat). Vinkje = lot staat standaard aangevinkt bij "+ Lot toevoegen".</div></div>
    <div class="panel"><div class="panel-head"><h3>${l ? esc(lotName(l.nr)) : "Posten"}</h3>${l ? `<button class="btn sm primary" data-act="post-new" data-lot="${l.nr}">+ Post</button>` : ""}</div>
      ${ps.length ? `<div class="tw"><table class="t"><thead><tr><th title="Standaard aan">Std</th><th>Groep</th><th>Omschrijving</th><th>Eenh.</th><th class="r">Richtprijs</th><th>Btw</th><th title="Actief">Act.</th><th></th></tr></thead><tbody>${ps.map(x => `<tr class="${x.actief === false ? "ms-dead" : ""}"><td style="width:32px"><input type="checkbox" data-post="${x.id}" data-f="standaard_aan" ${x.standaard_aan ? "checked" : ""}></td><td style="width:130px"><input class="inline" data-post="${x.id}" data-f="groep" value="${esc(x.groep || "")}"></td><td><input class="inline wide" data-post="${x.id}" data-f="omschrijving" value="${esc(x.omschrijving)}"></td><td style="width:84px"><select class="inline" data-post="${x.id}" data-f="eenheid">${opts(EENHEDEN.map(e => [e, e]), x.eenheid)}</select></td><td style="width:100px"><input class="inline num" data-post="${x.id}" data-f="richtprijs" type="text" inputmode="decimal" autocomplete="off" value="${getalVeld(x.richtprijs)}" title="${x.n ? `mediaan uit ${x.n} waarneming(en), ${eur2(x.prijs_min)} – ${eur2(x.prijs_max)}` : "nog geen data"}"></td><td style="width:78px"><select class="inline" data-post="${x.id}" data-f="btw">${opts([[0.06, "6 %"], [0.21, "21 %"], [0, "0 %"]], Number(x.btw))}</select></td><td style="width:32px"><input type="checkbox" data-post="${x.id}" data-f="actief" ${x.actief !== false ? "checked" : ""}></td><td class="r" style="width:36px"><button class="btn ghost sm danger" data-act="post-del" data-id="${x.id}" aria-label="Verwijderen">✕</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><b>Geen posten in dit lot</b>Voeg er een toe.</div>`}
      <div class="panel-body muted" style="font-size:12px;border-top:1px solid var(--line)">Std = komt standaard mee bij "+ Lot toevoegen". Act. uit = blijft bewaard maar verschijnt niet meer in de keuzelijst. Richtprijs = kostprijs excl. btw die als startwaarde in nieuwe meetstaten komt.</div></div></div>`;
}
async function postEdit(id, f, raw, checked) {
  const x = S.posten[id]; if (!x) return; let v = raw;
  if (f === "standaard_aan" || f === "actief") v = !!checked;
  else if (f === "richtprijs") { const n = duizendKeuze(raw, leesGetal(raw)); if (Number.isNaN(n) || (n != null && n < 0)) { toast(`"${raw}" is geen geldige prijs`, 5000); render(); return; } v = n == null ? null : r2(n); }
  else if (f === "btw") v = Number(raw);
  if (String(x[f] ?? "") === String(v ?? "")) return;
  await dbUpdate("posten", id, { [f]: v, updated_at: new Date().toISOString() }).catch(() => { });
}
async function lotEdit(nr, f, raw, checked) {
  const l = S.loten[nr]; if (!l) return;
  if (f !== "marge") { const v = !!checked; if (l[f] === v) return; await dbUpdate("loten", nr, { [f]: v }).catch(() => { }); return; }
  const n = leesGetal(raw);
  if (n == null || Number.isNaN(n) || n <= -100 || n > 1000) { toast(n == null ? "Vul een marge in (bv. 15 of 12,5) — leeg laten kan niet bij een lot." : `"${raw}" is geen geldige marge — geef een % tussen -99 en 1000, bv. 15 of 12,5`, 6000); render(); return; }
  const v = Math.round(n * 100) / 10000;   // % → fractie (de lotmarge heeft 4 decimalen: 12,35 % = 0,1235)
  if (Math.abs((Number(l.marge) || 0) - v) < 1e-9) return;
  // posten die de klant al goedkeurde en geen eigen marge hebben, krijgen anders stilletjes een andere klantprijs
  const geraakt = Object.values(S.meetstaat_posten).filter(r => r.lot === nr && msTelt(r) && !msVast(r) && (r.marge == null || r.marge === "") && ["akkoord", "meerwerk", "minwerk"].includes(r.status));   // 1.65: posten met een goedkeuring uit het portaal houden hun klantprijs (de databank zet hun marge vast)
  if (geraakt.length) { const np = new Set(geraakt.map(r => r.project_id)).size;
    if (!confirm(`Let op: ${geraakt.length} goedgekeurde post${geraakt.length > 1 ? "en" : ""} (akkoord, meer- of minwerk) in ${np} project${np > 1 ? "en" : ""} volg${geraakt.length > 1 ? "en" : "t"} de marge van dit lot. Hun klantprijs verandert dan mee, terwijl de klant een andere prijs goedkeurde.\n\nGeef die posten eerst een eigen marge in de meetstaat als hun prijs moet blijven.\n\nToch de marge van ${lotName(nr)} wijzigen naar ${nl(n, 2)} %?`)) { render(); return; } }
  try { await dbUpdate("loten", nr, { marge: v }); } catch (e) { return; }
  await refetch("meetstaat_posten"); toast(`Marge ${lotName(nr)}: ${nl(n, 2)} % — klantprijzen herrekend`);
}
async function postAdd(lot) {
  const oms = prompt("Omschrijving van de nieuwe post:"); if (!oms || !oms.trim()) return;
  const volgorde = Math.max(0, ...postenOf(lot).map(x => x.volgorde)) + 1; const code = `${String(lot).padStart(2, "0")}.${String(postenOf(lot).length + 1).padStart(2, "0")}`;
  try { await dbInsert("posten", { code, lot, omschrijving: oms.trim(), eenheid: "stk", prijstype: "EP", btw: 0.06, standaard_aan: false, actief: true, volgorde }); toast("Post toegevoegd"); } catch (e) { }
}
async function postDel(id) {
  const x = S.posten[id]; if (!x || !confirm(`"${x.omschrijving}" verwijderen uit de bibliotheek? (Bestaande meetstaten behouden hun regels.)`)) return;
  await dbDelete("posten", id).catch(() => { });
}
const docIcon = (m, n) => /spreadsheet|excel/.test(m) ? "xls" : /word|document/.test(m) ? "doc" : /pdf/.test(m) ? "pdf" : /^image\//.test(m) || /\.(jpe?g|png|heic|gif|webp|tiff?)$/i.test(n) ? "img" : /skp|sketchup|vwx|dwg|dxf/i.test(n) ? "dwg" : "map";

