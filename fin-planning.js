/* =====================================================================
   BROS Planbord — financiële planning (script 049, v1.52) — enkel beheer
   Rapporten › Financiële planning: jaarplanning, businessplan en dossier voor de bank.
   - Omzet, kostprijs en marge per project uit de meetstaat (marge per post of per lot); zonder meetstaat: een budget
     (of het forfait) met een marge. Geraamde projecten = verwachte opdrachten die nog niet in het Planbord staan.
   - Facturatie: wat al gefactureerd is (vorderingen verzonden/betaald), wat al klaarstaat (op te maken), en voor de rest een
     automatisch voorstel (voorschot bij de start, maandelijkse vorderingen, slotfactuur bij de oplevering) — per project
     aanpasbaar of te vervangen door een eigen plan.
   - Aankopen: de kostprijs van de meetstaat gespreid over de uitvoering (start → einde), met de echte aannemersfacturen
     eerst verrekend; betaald na de betaaltermijn.
   - Vaste kosten per maand/kwartaal/jaar (met indexatie). Per maand: wat binnenkomt en wat gepland buitengaat (geen kaspositie).
   - Scenario's: voorzichtig (enkel offertes met hoge kans, later gestart), verwacht (gewogen met de kans), optimistisch.
   Geladen vóór app.js; app.js roept vFinPlanning aan via vRapporten (typeof).
   ===================================================================== */
const finOk = () => schemaV() >= 49 && isBeheer() && !!S.fin_plan;
const FIN_STD = { voorschot: 0.3, slot: 0.1, klant_termijn: 15, aannemer_termijn: 30, duur: 4, marge: 0.25, kans: 50, index: 0.02, vz_drempel: 75, vz_vertraging: 1, opt_drempel: 25 };
const FIN_SCEN = { voorzichtig: "Voorzichtig", verwacht: "Verwacht", optimistisch: "Optimistisch" };
const FIN_CAT = { lonen: "Lonen en sociale lasten", huur: "Huur en kantoor", wagens: "Wagens en verplaatsingen", verzekeringen: "Verzekeringen", software: "Software en IT", marketing: "Marketing", administratie: "Boekhouding en administratie", financiering: "Leningen en financiering", overig: "Overige" };
const FIN_FREQ = { maand: "per maand", kwartaal: "per kwartaal", jaar: "per jaar" };
function finInst() {
  const v = ((S.fin_instellingen || {})[1] || {}).value || {}; const o = { ...FIN_STD };
  Object.keys(FIN_STD).forEach(k => { if (v[k] != null && v[k] !== "") o[k] = typeof FIN_STD[k] === "number" ? Number(v[k]) : v[k]; });
  return o;
}
/* ---------- maanden ---------- */
const finYm = (d) => String(d || "").slice(0, 7);
const finYmPlus = (ym, n) => { const [y, m] = ym.split("-").map(Number); const t = y * 12 + (m - 1) + n; return Math.floor(t / 12) + "-" + String(t % 12 + 1).padStart(2, "0"); };
const finLaatsteDag = (ym) => { const [y, m] = ym.split("-").map(Number); return iso(new Date(Date.UTC(y, m, 0))); };
const finMaanden = (a, b) => { const out = []; for (let ym = a; ym <= b && out.length < 600; ym = finYmPlus(ym, 1)) out.push(ym); return out; };
const finDagPlusMaanden = (d, n) => { if (!n) return d; const ym = finYmPlus(finYm(d), n); const dag = Math.min(Number(d.slice(8, 10)), Number(finLaatsteDag(ym).slice(8, 10))); return ym + "-" + String(dag).padStart(2, "0"); };
const finSom = (l, f) => l.reduce((s, x) => s + (Number(f ? f(x) : x) || 0), 0);
/* bedrag eerlijk verdelen over n delen (centen kloppen op het totaal) */
/* gewogen delen zonder afrondingsverschil: de som van de gewogen delen = afgerond (som × gewicht) */
const finWeeg = (delen, gewicht) => { if (gewicht === 1) return delen.slice(); const tot = r2(finSom(delen) * gewicht); const out = delen.map(b => r2(b * gewicht)); if (out.length) out[out.length - 1] = r2(tot - finSom(out.slice(0, -1))); return out; };
const finVerdeel = (bedrag, n) => { if (n <= 0) return []; const per = r2(bedrag / n); const out = Array(n).fill(per); out[n - 1] = r2(bedrag - per * (n - 1)); return out; };

/* ---------- rekenmodel per project ---------- */
function finPlanVan(pid) { return Object.values(S.fin_plan || {}).find(x => x.project_id === pid) || null; }
function finProject(p, f, I, scen) {
  const waarsch = []; const geraamd = !p; const status = geraamd ? "geraamd" : p.status;
  const getekend = !geraamd && status !== "offerte";
  const kans = getekend ? 100 : f && f.kans != null ? Number(f.kans) : I.kans;
  // scenario's monotoon: voorzichtig ≤ verwacht ≤ optimistisch
  const gewicht = getekend ? 1 : scen === "voorzichtig" ? (kans >= I.vz_drempel ? kans / 100 : 0) : scen === "optimistisch" ? (kans >= I.opt_drempel ? 1 : kans / 100) : kans / 100;
  const vertraging = !getekend && scen === "voorzichtig" ? Math.max(0, Math.round(I.vz_vertraging)) : 0;
  // nog te ontvangen/betalen: nooit vóór vandaag
  const nogTe = (d) => d < todayIso ? todayIso : d;
  // omzet en kostprijs (excl. btw)
  const mPct = f && f.marge_pct != null ? Number(f.marge_pct) : I.marge;
  const t = p ? msTotals(p.id) : null; let O = 0, K = 0, bron = "geen", raming = null;
  if (t && t.n && Math.abs(t.verkoop + t.meerwerk) > 0.005) { O = r2(t.verkoop + t.meerwerk); K = r2(t.kost); bron = "meetstaat"; if (!(K > 0)) waarsch.push("de meetstaat heeft nog geen kostprijzen — marge onbekend");
    if (t.nRaming) raming = { n: t.nRaming, verkoop: t.verkoopRaming, kost: t.kostRaming, marge: t.margeRaming }; }   // 1.55: posten zonder aannemersofferte met een geraamde marge
  else if (f && f.budget_excl != null) { O = Number(f.budget_excl); K = r2(O / (1 + mPct)); bron = "budget"; }
  else if (p && Number(p.forfait)) { O = Number(p.forfait); K = r2(O / (1 + mPct)); bron = "forfait"; }
  else waarsch.push("geen bedrag — vul een budget in of maak een meetstaat");
  // periode
  let start, eind; const sp = p ? projSpan(p) : [null, null];
  if (p) { start = p.start || sp[0] || null; eind = p.eind || sp[1] || null; } else { start = f.start || null; eind = f.eind || null; }
  const echtStart = start; const afgerond = status === "afgerond";
  if (!start) { start = finYmPlus(finYm(todayIso), 1) + "-01"; if (!afgerond) waarsch.push("geen startdatum — gerekend vanaf volgende maand"); }
  if (!eind || eind < start) { if (!afgerond) waarsch.push(eind ? "geplande einde ligt vóór de start — gerekend met " + Math.round(I.duur) + " maanden" : "geen geplande einddatum — gerekend met " + Math.round(I.duur) + " maanden"); eind = addDays(finDagPlusMaanden(start, Math.max(1, Math.round(I.duur))), -1); }
  if (vertraging) { start = finDagPlusMaanden(start, vertraging); eind = finDagPlusMaanden(eind, vertraging); }
  // facturen aan de klant
  const vs = p ? vordOf(p.id) : []; const inkomsten = [];
  vs.forEach(v => { let c; try { c = vordCalc(v); } catch (e) { return; } const bedrag = r2(c.excl); if (!(Math.abs(bedrag) > 0.005)) return;
    const naam = (v.soort === "voorschot" ? "Voorschot" : v.soort === "slotfactuur" ? "Slotfactuur" : v.soort === "meerwerk" ? "Meerwerk" : "Vordering " + v.nr) + (v.factuurnummer ? " · " + v.factuurnummer : "");
    if (v.status === "verzonden" || v.status === "betaald") {
      const datum = v.datum || String(v.created_at || "").slice(0, 10) || todayIso;
      if (v.status === "betaald") { inkomsten.push({ datum, bedrag, bruto: bedrag, cash: v.betaald_op || v.vervaldag || addDays(datum, I.klant_termijn), naam, soort: "gefactureerd" }); return; }
      // nog niet betaald (deels betaald volgens Yuki: enkel het openstaande deel komt nog binnen)
      const verwacht = nogTe(v.vervaldag || addDays(datum, I.klant_termijn));
      const open = v.open_bedrag != null && v.open_bedrag !== "" && bedrag > 0 ? Math.min(bedrag, Math.max(0, r2(Number(v.open_bedrag) / (1 + (c.excl ? c.btw / c.excl : 0))))) : bedrag;
      if (open < bedrag - 0.005) inkomsten.push({ datum, bedrag: r2(bedrag - open), bruto: r2(bedrag - open), cash: datum, naam: naam + " (al betaald deel)", soort: "gefactureerd" });
      if (Math.abs(open) > 0.005) inkomsten.push({ datum, bedrag: r2(open), bruto: r2(open), cash: verwacht, naam, soort: "gefactureerd" });
    } else {
      const datum = v.datum && v.datum > todayIso ? v.datum : todayIso;
      inkomsten.push({ datum, bedrag: r2(bedrag * gewicht), bruto: bedrag, cash: nogTe(addDays(datum, I.klant_termijn)), naam: naam + " (op te maken)", soort: "klaar" });
    }
  });
  const R = r2(O - finSom(inkomsten, x => x.bruto));
  const voorstel = [];   // wat nog gefactureerd moet worden (ongewogen)
  if (R > 0.5 && afgerond) waarsch.push("nog " + eur(R) + " niet gefactureerd volgens de meetstaat (afgerond project — niet ingepland)");
  else if (R > 0.5) {
    if (eind < todayIso) waarsch.push("geplande einde (" + fmtLong(eind) + ") is voorbij — de rest staat nu ingepland; pas de datum aan");
    const vanaf = start > todayIso ? start : todayIso; const tot = eind > vanaf ? eind : vanaf;
    if (f && Array.isArray(f.plan) && f.plan.length) {
      // eigen plan: % van wat nog te factureren is, over de momenten die nog komen (voorbije momenten zijn gefactureerd of vervallen)
      const alle = f.plan.filter(x => x && x.datum && Number(x.pct) > 0).map(x => ({ ...x, d: finDagPlusMaanden(String(x.datum), vertraging) }));
      // een voorbij moment: gefactureerd (er is sindsdien een vordering) → valt weg; anders achterstallig → nu
      const sindsdien = (d) => vs.some(v => (v.datum || String(v.created_at || "").slice(0, 10)) >= d);
      let achter = 0; let rijen = alle.filter(x => x.d >= todayIso || !sindsdien(x.d)).map(x => { if (x.d < todayIso) { achter++; return { ...x, d: todayIso, naam: (x.naam || "Vordering (eigen plan)") + " — achterstallig" }; } return x; });
      if (achter) waarsch.push(achter + " moment(en) van het eigen plan zijn voorbij zonder factuur — nu ingepland");
      if (!rijen.length) { rijen = [{ d: todayIso, pct: 1, naam: "Rest (eigen plan voorbij)" }]; waarsch.push(alle.length ? "alle momenten van het eigen plan zijn voorbij — de rest staat nu ingepland" : "eigen facturatieplan is leeg"); }
      const totPct = finSom(rijen, x => x.pct); const delen = rijen.map(x => r2(R * Number(x.pct) / (totPct || 1))); delen[delen.length - 1] = r2(R - finSom(delen.slice(0, -1)));
      rijen.forEach((x, i) => voorstel.push({ datum: x.d, bedrag: delen[i], naam: x.naam || "Vordering (eigen plan)" }));
    } else {
      const heeftVord = vs.length > 0, heeftS = vs.some(v => v.soort === "slotfactuur");   // voorschot enkel als er nog niets gefactureerd of klaargezet is
      const vp = f && f.voorschot_pct != null ? Number(f.voorschot_pct) : I.voorschot, spc = f && f.slot_pct != null ? Number(f.slot_pct) : I.slot;
      let rest = R;
      if (!heeftVord && vp > 0) { const a = r2(Math.min(rest, vp * O)); if (a > 0.005) { voorstel.push({ datum: vanaf, bedrag: a, naam: "Voorschot " + Math.round(vp * 100) + " %" }); rest = r2(rest - a); } }
      let slot = 0; if (!heeftS && spc > 0 && rest > 0.005) { slot = r2(Math.min(rest, spc * O)); rest = r2(rest - slot); }
      if (rest > 0.005) { const ms = finMaanden(finYm(vanaf), finYm(tot)); const delen = finVerdeel(rest, ms.length);
        ms.forEach((ym, i) => { let d = finLaatsteDag(ym); if (d > tot) d = tot; if (d < vanaf) d = vanaf; voorstel.push({ datum: d, bedrag: delen[i], naam: "Vordering " + MONTHS[Number(ym.slice(5, 7)) - 1] + " " + ym.slice(0, 4) }); }); }
      if (slot > 0.005) voorstel.push({ datum: tot, bedrag: slot, naam: "Slotfactuur " + Math.round(spc * 100) + " %" });
    }
    const gw = finWeeg(voorstel.map(x => x.bedrag), gewicht);
    voorstel.forEach((x, i) => inkomsten.push({ datum: x.datum, bedrag: gw[i], bruto: x.bedrag, cash: nogTe(addDays(x.datum, I.klant_termijn)), naam: x.naam, soort: "gepland" }));
  } else if (R < -0.5) waarsch.push("meer gefactureerd (" + eur(-R) + ") dan de meetstaat/het budget");
  // aankopen: kostprijs gespreid over de uitvoering; echte aannemersfacturen eerst verrekend (oudste maanden eerst)
  const kosten = []; const af = p ? Object.values(S.aannemer_facturen || {}).filter(x => x.project_id === p.id) : [];
  af.forEach(x => { const datum = x.datum || String(x.created_at || "").slice(0, 10) || todayIso; const b = r2(Number(x.bedrag_excl) || 0);
    const cash = x.status === "betaald" ? (x.betaald_op || x.vervaldag || addDays(datum, I.aannemer_termijn)) : nogTe(x.vervaldag || addDays(datum, I.aannemer_termijn));
    kosten.push({ datum, bedrag: b, bruto: b, cash, naam: (x.aannemer_naam || "Aannemer") + (x.nummer ? " · " + x.nummer : "") + (x.status === "betwist" ? " (betwist)" : ""), soort: "factuur" }); });
  const A = finSom(kosten, x => x.bruto);
  // afgerond project: enkel de echte aannemersfacturen (de rest is buiten het Planbord betaald of was er niet)
  if (K > 0.5 && !afgerond) {
    const ms = finMaanden(finYm(start), finYm(eind)); const delen = finVerdeel(K, ms.length); let teVerrekenen = A; const plan = [];
    ms.forEach((ym, i) => { let d = finLaatsteDag(ym); if (d > eind) d = eind; let b = delen[i]; const af2 = Math.min(b, Math.max(0, teVerrekenen)); b = r2(b - af2); teVerrekenen = r2(teVerrekenen - af2);
      if (b > 0.005) plan.push({ datum: d, bruto: b, naam: "Aankopen " + MONTHS[Number(ym.slice(5, 7)) - 1] + " " + ym.slice(0, 4) }); });
    const gw = finWeeg(plan.map(x => x.bruto), gewicht);
    // betaaldatum al voorbij: telt in het resultaat, maar niet bij "buiten" (geen factuur in het Planbord — vermoedelijk al buiten het Planbord betaald)
    plan.forEach((x, i) => { const c = addDays(x.datum, I.aannemer_termijn); kosten.push({ datum: x.datum, bedrag: gw[i], bruto: x.bruto, cash: c < todayIso ? null : c, naam: x.naam, soort: "gepland" }); });
  }
  if (A > K + 0.5 && K > 0.5) waarsch.push("aannemersfacturen (" + eur(A) + ") hoger dan de kostprijs in de meetstaat (" + eur(K) + ")");
  return { key: p ? p.id : "f:" + f.id, p, f, geraamd, naam: p ? (p.nummer ? p.nummer + " · " : "") + projName(p) : f.naam, status, getekend, kans, gewicht, start, eind, echtStart, O, K, marge: r2(O - K), bron, raming, R, inkomsten, kosten, waarsch, eigenPlan: !!(f && Array.isArray(f.plan) && f.plan.length) };
}
/* 1.53: een project dat je zelf uitzet (fin_plan.meetellen = false) telt nergens mee — enkel de projectlijst toont het (ook = true) */
const finTeltMee = (f) => !(f && f.meetellen === false);
function finModel(scen, ook) {
  const I = finInst(); const uit = [];
  projects().filter(p => p.status !== "verloren" && !p.intern).forEach(p => uit.push(finProject(p, finPlanVan(p.id), I, scen)));   // 1.54: het interne project telt niet mee
  Object.values(S.fin_plan || {}).filter(x => !x.project_id).forEach(f => uit.push(finProject(null, f, I, scen)));
  uit.forEach(x => x.uit = !finTeltMee(x.f));
  return ook ? uit : uit.filter(x => !x.uit);
}
/* vaste kosten: per maand de kost (gespreid: jaarbedrag/12) en de betaling (in de maand dat ze valt) */
function finVast(I, ym) {
  let kost = 0, cash = 0;
  Object.values(S.fin_vaste_kosten || {}).forEach(v => { const k = finVastRij(I, v, ym); if (!k) return; kost += k;
    const n = v.frequentie === "kwartaal" ? 3 : v.frequentie === "jaar" ? 12 : 1; const [y0, m0] = finYm(v.vanaf).split("-").map(Number), [y1, m1] = ym.split("-").map(Number);
    if (((y1 - y0) * 12 + (m1 - m0)) % n === 0) cash += r2(finVastIndex(I, v, ym) * (Number(v.bedrag) || 0)); });
  return { kost: r2(kost), cash: r2(cash) };
}
const finVastIndex = (I, v, ym) => v.indexeren === false ? 1 : Math.pow(1 + (Number(I.index) || 0), Math.max(0, Number(ym.slice(0, 4)) - Number(finYm(v.vanaf).slice(0, 4))));
/* bedrag per maand in een jaar (geïndexeerd); 0 als de kost dat jaar niet loopt */
const finVastPerMaand = (I, v, jaar) => Math.max(0, ...finMaanden(jaar + "-01", jaar + "-12").map(m => finVastRij(I, v, m)));
/* per maand: omzet (gefactureerd/gepland), aankopen, marge, vaste kosten, resultaat — en wat binnenkomt / buitengaat (op betaaldatum) */
function finReeks(model, I, vanYm, totYm) {
  const ms = finMaanden(vanYm, totYm); const idx = {}; ms.forEach((m, i) => idx[m] = i);
  const rij = () => ms.map(() => 0);
  const R = { maanden: ms, gef: rij(), plan: rij(), kost: rij(), vast: rij(), in: rij(), uitA: rij(), uitV: rij() };
  model.forEach(x => {
    x.inkomsten.forEach(i => { const k = idx[finYm(i.datum)]; if (k != null) R[i.soort === "gefactureerd" ? "gef" : "plan"][k] += i.bedrag; const kc = idx[finYm(i.cash)]; if (kc != null) R.in[kc] += i.bedrag; });
    x.kosten.forEach(c => { const k = idx[finYm(c.datum)]; if (k != null) R.kost[k] += c.bedrag; if (!c.cash) return; const kc = idx[finYm(c.cash)]; if (kc != null) R.uitA[kc] += c.bedrag; });
  });
  ms.forEach((m, k) => { const v = finVast(I, m); R.vast[k] = v.kost; R.uitV[k] = v.cash; });
  ["gef", "plan", "kost", "vast", "in", "uitA", "uitV"].forEach(s => R[s] = R[s].map(r2));
  R.omzet = ms.map((m, k) => r2(R.gef[k] + R.plan[k])); R.marge = ms.map((m, k) => r2(R.omzet[k] - R.kost[k])); R.resultaat = ms.map((m, k) => r2(R.marge[k] - R.vast[k]));
  R.uit = ms.map((m, k) => r2(R.uitA[k] + R.uitV[k])); R.verschil = ms.map((m, k) => r2(R.in[k] - R.uit[k]));
  return R;
}
const finTot = (arr) => r2(finSom(arr));
const finMin = (n) => n ? -n : 0;   /* teken omdraaien zonder "−0" */

/* ---------- weergave ---------- */
const finK = (n) => { const a = Math.abs(n); return (n < 0 ? "−" : "") + (a >= 1e6 ? nl(a / 1e6, 1) + " mln" : a >= 1000 ? Math.round(a / 1000) + "k" : String(Math.round(a))); };
const finPct = (n) => n == null || !isFinite(n) ? "—" : nl(n * 100, 1) + " %";
function finTabs(actief) {
  if (!isBeheer() || typeof vFinPlanning !== "function") return "";
  const b = (t, l) => `<button type="button" role="tab" aria-selected="${actief === t}" class="${actief === t ? "on" : ""}" data-fin-act="raptab" data-t="${t}">${l}</button>`;
  return `<div class="fin-tabs" role="tablist" aria-label="Rapporten">${b("cijfers", "Cijfers")}${b("fin", "Financiële planning")}</div>`;
}
/* staafgrafiek per maand: gefactureerd (onder) + gepland (boven), één as */
function finGrafiekOmzet(R) {
  const W = 600, H = 230, L = 46, B = 26, T = 12, Rr = 8, ph = H - T - B, pw = W - L - Rr, n = R.maanden.length, band = pw / n, bw = Math.min(24, band * 0.56);
  const max = Math.max(1, ...R.omzet.map(v => Math.max(0, v))); const stap = finStap(max); const top = Math.ceil(max / stap) * stap; const y = (v) => T + ph - v / top * ph;
  const pad = (x, y0, w, h, rond) => { if (h <= 0.5) return ""; const r = rond ? Math.min(4, h, w / 2) : 0; return `M${x},${y0 + h}V${y0 + r}${r ? `Q${x},${y0} ${x + r},${y0}` : ""}H${x + w - r}${r ? `Q${x + w},${y0} ${x + w},${y0 + r}` : ""}V${y0 + h}Z`; };
  let g = ""; for (let v = 0; v <= top + 0.001; v += stap) g += `<line x1="${L}" x2="${W - Rr}" y1="${y(v)}" y2="${y(v)}" class="fin-grid"/><text x="${L - 6}" y="${y(v) + 4}" class="fin-as" text-anchor="end">${finK(v)}</text>`;
  const kol = R.maanden.map((m, k) => { const x = L + band * k + (band - bw) / 2; const a = Math.max(0, R.gef[k]), b = Math.max(0, R.plan[k]); const ya = y(a), hb = ph * b / top;
    const hA = ph * a / top; const gap = a > 0 && b > 0 ? 2 : 0;
    return `<g class="fin-kol" tabindex="0" aria-label="${MONTHS[Number(m.slice(5, 7)) - 1]}: gefactureerd ${eur(R.gef[k])}, gepland ${eur(R.plan[k])}"><title>${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)} — gefactureerd ${eur(R.gef[k])} · gepland ${eur(R.plan[k])} · totaal ${eur(R.omzet[k])}</title>
      <rect x="${L + band * k}" y="${T}" width="${band}" height="${ph}" class="fin-hit"/>
      <path d="${pad(x, ya, bw, hA, !(b > 0))}" class="fin-s1"/><path d="${pad(x, ya - gap - hb, bw, Math.max(0, hb - 0), true)}" class="fin-s2"/>
      <text x="${L + band * k + band / 2}" y="${H - 8}" class="fin-as" text-anchor="middle">${MONTHS[Number(m.slice(5, 7)) - 1]}</text></g>`; }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="fin-svg" role="group" aria-label="Omzet per maand (de tabel Per maand toont dezelfde cijfers)">${g}<line x1="${L}" x2="${W - Rr}" y1="${y(0)}" y2="${y(0)}" class="fin-base"/>${kol}</svg>`;
}
function finStap(max) { const ruw = max / 4; const p = Math.pow(10, Math.floor(Math.log10(ruw))); return [1, 2, 2.5, 5, 10].map(x => x * p).find(x => x >= ruw) || p * 10; }
/* gegroepeerde kolommen per maand: ontvangsten (groen) en geplande uitgaven (geel), één as */
function finGrafiekKasstroom(R) {
  const W = 600, H = 230, L = 46, B = 26, T = 12, Rr = 8, ph = H - T - B, pw = W - L - Rr, n = R.maanden.length, band = pw / n, bw = Math.min(12, (band - 8) / 2);
  const max = Math.max(1, ...R.in.map(v => Math.max(0, v)), ...R.uit.map(v => Math.max(0, v))); const stap = finStap(max); const top = Math.ceil(max / stap) * stap; const y = (v) => T + ph - v / top * ph;
  const kol = (x, v, cls) => { const h = ph * Math.max(0, v) / top; if (h <= 0.5) return ""; const r = Math.min(4, h, bw / 2); const y0 = y(Math.max(0, v)); return `<path d="M${x},${y0 + h}V${y0 + r}Q${x},${y0} ${x + r},${y0}H${x + bw - r}Q${x + bw},${y0} ${x + bw},${y0 + r}V${y0 + h}Z" class="${cls}"/>`; };
  let g = ""; for (let v = 0; v <= top + 0.001; v += stap) g += `<line x1="${L}" x2="${W - Rr}" y1="${y(v)}" y2="${y(v)}" class="fin-grid"/><text x="${L - 6}" y="${y(v) + 4}" class="fin-as" text-anchor="end">${finK(v)}</text>`;
  const kols = R.maanden.map((m, k) => { const x = L + band * k + (band - 2 * bw - 2) / 2; const mn = MONTHS[Number(m.slice(5, 7)) - 1];
    return `<g class="fin-kol" tabindex="0" aria-label="${mn}: ontvangsten ${eur(R.in[k])}, uitgaven ${eur(R.uit[k])}"><title>${mn} ${m.slice(0, 4)} — binnen ${eur(R.in[k])} · buiten ${eur(R.uit[k])} (aannemers ${eur(R.uitA[k])}, vaste kosten ${eur(R.uitV[k])})</title>
      <rect x="${L + band * k}" y="${T}" width="${band}" height="${ph}" class="fin-hit"/>${kol(x, R.in[k], "fin-s3")}${kol(x + bw + 2, R.uit[k], "fin-s4")}
      <text x="${L + band * k + band / 2}" y="${H - 8}" class="fin-as" text-anchor="middle">${mn}</text></g>`; }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="fin-svg" role="group" aria-label="Ontvangsten en uitgaven per maand (de tabel Per maand toont dezelfde cijfers)">${g}<line x1="${L}" x2="${W - Rr}" y1="${y(0)}" y2="${y(0)}" class="fin-base"/>${kols}</svg>`;
}
function vFinPlanning() {
  const tabs = finTabs("fin");
  if (!isBeheer()) return tabs + `<div class="panel"><div class="empty"><b>Enkel voor beheer</b></div></div>`;
  if (schemaV() < 49 || !S.fin_plan) return tabs + `<div class="page-head"><div><div class="eyebrow">Rapporten</div><h1>Financiële planning</h1></div></div><div class="panel"><div class="empty"><b>Nog niet beschikbaar</b>Voer databasescript <code>sql/049_financiele_planning.sql</code> uit in Supabase (SQL Editor) en herlaad.</div></div>`;
  if (S.prijsFout) return tabs + `<div class="page-head"><div><div class="eyebrow">Rapporten</div><h1>Financiële planning</h1></div></div><div class="panel"><div class="empty"><b>Prijzen niet correct geladen</b>Herlaad de pagina (⌘⌥R) — tot dan wordt er niets berekend, om foute cijfers te vermijden.</div></div>`;
  const I = finInst(); const jaar = S.finJaar || todayIso.slice(0, 4); const scen = S.finScen || "verwacht";
  const alle = finModel(scen, true); const model = alle.filter(x => !x.uit); const R = finReeks(model, I, jaar + "-01", jaar + "-12");
  const omzet = finTot(R.omzet), gef = finTot(R.gef), kost = finTot(R.kost), marge = r2(omzet - kost), vast = finTot(R.vast), res = r2(marge - vast);
  const inT = finTot(R.in), uitT = finTot(R.uit);
  const jaren = [...new Set([Number(todayIso.slice(0, 4)) - 1, Number(todayIso.slice(0, 4)), Number(todayIso.slice(0, 4)) + 1, Number(todayIso.slice(0, 4)) + 2, Number(todayIso.slice(0, 4)) + 3, Number(jaar)])].sort();
  const segm = `<div class="wj-seg" role="group" aria-label="Scenario">${Object.entries(FIN_SCEN).map(([k, l]) => `<button class="${scen === k ? "on" : ""}" aria-pressed="${scen === k}" data-fin-act="scen" data-s="${k}">${l}</button>`).join("")}</div>`;
  const pipeline = model.filter(x => !x.getekend && x.R > 0.5).reduce((s, x) => s + x.R * x.kans / 100, 0);
  const kpi = `<div class="grid kpi fin-kpi" style="margin-bottom:16px">
    <div class="panel kpi-tile"><div class="eyebrow">Omzet ${jaar}</div><div class="v">${eur(omzet)}</div><div class="d">${eur(gef)} gefactureerd · ${eur(r2(omzet - gef))} gepland</div></div>
    <div class="panel kpi-tile"><div class="eyebrow">Brutomarge</div><div class="v">${eur(marge)}</div><div class="d">${omzet ? finPct(marge / omzet) + " van de omzet" : "—"}</div></div>
    <div class="panel kpi-tile"><div class="eyebrow">Bedrijfsresultaat</div><div class="v ${res < 0 ? "neg" : ""}">${eur(res)}</div><div class="d">na ${eur(vast)} vaste kosten</div></div>
    <div class="panel kpi-tile"><div class="eyebrow">Binnen ${jaar}</div><div class="v">${eur(inT)}</div><div class="d">buiten: ${eur(uitT)}</div></div>
  </div>`;
  // meerjarenoverzicht (businessplan)
  const drie = [0, 1, 2].map(i => { const j = String(Number(jaar) + i); const r = finReeks(model, I, j + "-01", j + "-12"); const o = finTot(r.omzet), k = finTot(r.kost), v = finTot(r.vast); return { j, o, k, m: r2(o - k), v, res: r2(o - k - v), in: finTot(r.in), uit: finTot(r.uit), gef: finTot(r.gef) }; });
  const maandTabel = () => { const rij = (lbl, arr, cls) => `<tr class="${cls || ""}"><td>${lbl}</td>${arr.map(v => `<td class="r num${v < 0 ? " neg" : ""}">${finK(v)}</td>`).join("")}<td class="r num"><b>${finK(finTot(arr))}</b></td></tr>`;
    return `<div class="tw"><table class="t fin-mt"><thead><tr><th></th>${R.maanden.map(m => `<th class="r">${MONTHS[Number(m.slice(5, 7)) - 1]}</th>`).join("")}<th class="r">${jaar}</th></tr></thead><tbody>
      <tr class="fin-kop"><td colspan="14">Resultaat (op factuurdatum)</td></tr>
      ${rij("Omzet gefactureerd", R.gef)}${rij("Omzet gepland", R.plan)}${rij("<b>Omzet</b>", R.omzet, "fin-sub")}${rij("Aankopen (aannemers)", R.kost.map(v => -v))}${rij("<b>Brutomarge</b>", R.marge, "fin-sub")}${rij("Vaste kosten", R.vast.map(v => -v))}${rij("<b>Bedrijfsresultaat</b>", R.resultaat, "fin-sub")}
      <tr class="fin-kop"><td colspan="14">Binnen en buiten (op betaaldatum)</td></tr>
      ${rij("<b>Binnen: ontvangsten klanten</b>", R.in, "fin-sub")}${rij("Buiten: betalingen aannemers", R.uitA.map(v => -v))}${rij("Buiten: vaste kosten", R.uitV.map(v => -v))}${rij("<b>Buiten: totaal</b>", R.uit.map(v => -v), "fin-sub")}${rij("Verschil binnen − buiten", R.verschil, "fin-muted")}
    </tbody></table></div>`; };
  // projecten
  const inJaar = (x) => ({ o: r2(finSom(x.inkomsten.filter(i => i.datum.slice(0, 4) === jaar), i => i.bedrag)), k: r2(finSom(x.kosten.filter(c => c.datum.slice(0, 4) === jaar), c => c.bedrag)) });
  const relevant = alle.filter(x => x.status !== "afgerond" || inJaar(x).o || inJaar(x).k);
  const kanUit = schemaV() >= 50; const nUit = relevant.filter(x => x.uit).length;
  const groepen = [["Getekend", relevant.filter(x => x.getekend)], ["Offertes", relevant.filter(x => x.status === "offerte")], ["Geraamde projecten (nog niet in het Planbord)", relevant.filter(x => x.geraamd)]];
  const datumVeld = (x, f) => `<input class="inline fin-datum" type="date" data-fin-d="${f}" data-k="${esc(x.key)}" value="${esc(x.geraamd ? (x.f[f] || "") : (x.p[f] || ""))}" aria-label="${f === "start" ? "Start" : "Geplande einde"} ${esc(x.naam)}">`;
  const projRij = (x) => { const j = inJaar(x); const gefT = r2(finSom(x.inkomsten.filter(i => i.soort === "gefactureerd"), i => i.bruto));
    const schakel = kanUit ? `<td class="fin-in"><input type="checkbox" class="sw" data-fin-in data-k="${esc(x.key)}" ${x.uit ? "" : "checked"} aria-label="${esc(x.naam)} meetellen in de planning" title="${x.uit ? "Telt niet mee — aanvinken om mee te tellen" : "Telt mee — uitvinken om dit project buiten de planning te laten"}"></td>` : "";
    return `<tr class="${x.uit ? "fin-uit" : ""}">${schakel}<td><button type="button" class="wj-t fin-pn" data-fin-act="plan" data-k="${esc(x.key)}" title="Facturatieplan en uitgangspunten van dit project">${esc(x.naam)}</button><small class="muted">${x.bron === "meetstaat" ? "meetstaat" : x.bron === "budget" ? "budget" : x.bron === "forfait" ? "forfait" : "geen bedrag"}${x.eigenPlan ? " · eigen plan" : ""}${x.waarsch.length ? ` · <span class="fin-w" title="${esc(x.waarsch.join(" · "))}">⚠ ${esc(x.waarsch[0])}${x.waarsch.length > 1 ? " (+" + (x.waarsch.length - 1) + ")" : ""}</span>` : ""}</small></td>
      <td>${x.geraamd ? `<span class="pill">Geraamd</span>` : typeof projStatusKnop === "function" ? projStatusKnop(x.p) : `<span class="pill st-${x.status}">${PROJ_STATUS[x.status]}</span>`}</td>
      <td class="r" style="white-space:nowrap">${x.getekend ? `<span class="muted">100 %</span>` : `<input class="inline num fin-kans" data-fin-kans data-k="${esc(x.key)}" type="text" inputmode="numeric" value="${x.f && x.f.kans != null ? x.f.kans : ""}" placeholder="${finInst().kans}" aria-label="Slaagkans ${esc(x.naam)}">%`}</td>
      <td>${datumVeld(x, "start")}</td><td>${datumVeld(x, "eind")}</td>
      <td class="r num">${eur(x.O)}</td><td class="r num" title="Marge op kostprijs: ${x.K ? finPct(x.marge / x.K) : "—"}${x.raming ? ` · waarvan geraamd: ${eur(x.raming.marge)} op ${eur(x.raming.verkoop)} zonder offerte van een aannemer` : ""}">${x.raming ? `<span class="muted" aria-label="deels geraamd">≈ </span>` : ""}${eur(x.marge)}<small class="muted">${x.O ? finPct(x.marge / x.O) : ""}${x.raming ? (Math.abs(x.raming.verkoop - x.O) < 0.5 ? " · geraamd" : " · deels geraamd") : ""}</small></td>
      <td class="r num">${gefT ? eur(gefT) : "—"}</td><td class="r num">${x.R > 0.5 ? eur(x.R) : "—"}</td><td class="r num">${x.uit ? `<span class="muted">—</span><small class="muted">zelf uitgezet</small>` : `<b>${j.o ? eur(j.o) : "—"}</b>`}${x.uit ? "" : !x.getekend && x.gewicht < 1 && x.gewicht > 0 ? `<small class="muted">gewogen ${Math.round(x.gewicht * 100)} %</small>` : !x.getekend && x.gewicht === 0 ? `<small class="muted">telt niet mee</small>` : ""}</td></tr>`; };
  const nk = kanUit ? 11 : 10;
  const projTabel = `<div class="tw"><table class="t fin-pt"><thead><tr>${kanUit ? `<th class="fin-in" title="Zelf kiezen welke projecten meetellen">Telt mee</th>` : ""}<th>Project</th><th>Status</th><th class="r">Kans</th><th>Start</th><th>Geplande einde</th><th class="r">Omzet</th><th class="r">Marge</th><th class="r">Gefactureerd</th><th class="r">Nog te factureren</th><th class="r">In ${jaar}</th></tr></thead><tbody>
    ${groepen.map(([t, l]) => { const u = l.filter(x => x.uit).length; return `<tr class="fin-kop"><td colspan="${nk}">${t} <span class="muted" style="font-weight:400">${l.length}${u ? " · " + u + " uitgezet" : ""}</span></td></tr>` + (l.length ? l.sort((a, b) => (a.uit === b.uit ? 0 : a.uit ? 1 : -1) || (a.start || "").localeCompare(b.start || "")).map(projRij).join("") : `<tr><td colspan="${nk}" class="muted">—</td></tr>`); }).join("")}
  </tbody></table></div>`;
  // vaste kosten
  const vk = Object.values(S.fin_vaste_kosten || {}).sort((a, b) => (a.volgorde || 0) - (b.volgorde || 0) || (a.categorie || "").localeCompare(b.categorie || "") || (a.created_at || "").localeCompare(b.created_at || ""));
  const vkRij = (v) => `<tr><td><select class="inline" data-fvk="categorie" data-id="${v.id}" aria-label="Categorie">${Object.entries(FIN_CAT).map(([k, l]) => `<option value="${k}" ${v.categorie === k ? "selected" : ""}>${l}</option>`).join("")}</select></td>
    <td><input class="inline" data-fvk="omschrijving" data-id="${v.id}" value="${esc(v.omschrijving || "")}" placeholder="omschrijving" aria-label="Omschrijving"></td>
    <td class="r"><input class="inline num" data-fvk="bedrag" data-id="${v.id}" type="text" inputmode="decimal" value="${getalVeld(v.bedrag)}" aria-label="Bedrag" style="width:96px"></td>
    <td><select class="inline" data-fvk="frequentie" data-id="${v.id}" aria-label="Frequentie">${Object.entries(FIN_FREQ).map(([k, l]) => `<option value="${k}" ${v.frequentie === k ? "selected" : ""}>${l}</option>`).join("")}</select></td>
    <td><input class="inline" type="month" data-fvk="vanaf" data-id="${v.id}" value="${esc(finYm(v.vanaf))}" aria-label="Vanaf"></td><td><input class="inline" type="month" data-fvk="tot" data-id="${v.id}" value="${esc(finYm(v.tot))}" aria-label="Tot (leeg = blijvend)"></td>
    <td style="text-align:center"><input type="checkbox" data-fvk="indexeren" data-id="${v.id}" ${v.indexeren !== false ? "checked" : ""} aria-label="Jaarlijks indexeren"></td>
    <td class="r num" title="in ${jaar}, geïndexeerd">${eur(finVastPerMaand(I, v, jaar))}</td>
    <td class="r"><button class="btn ghost sm danger" data-fin-act="vk-weg" data-id="${v.id}" aria-label="Verwijderen">✕</button></td></tr>`;
  const vkTabel = `<div class="tw"><table class="t fin-vk"><thead><tr><th>Categorie</th><th>Omschrijving</th><th class="r">Bedrag excl. btw</th><th>Frequentie</th><th>Vanaf</th><th>Tot</th><th title="Jaarlijks indexeren met ${finPct(I.index)}">Index</th><th class="r">Per maand ${jaar}</th><th></th></tr></thead><tbody>${vk.map(vkRij).join("") || `<tr><td colspan="9" class="muted">Nog geen vaste kosten — voeg lonen, huur, wagens, verzekeringen… toe.</td></tr>`}</tbody></table></div>`;
  const legende = `<div class="fin-leg"><span><i class="fin-sw s1"></i>Gefactureerd</span><span><i class="fin-sw s2"></i>Gepland${scen !== "verwacht" ? "" : " (offertes gewogen met hun kans)"}</span></div>`;
  return tabs + `<div class="page-head"><div><div class="eyebrow">Rapporten · enkel beheer</div><h1>Financiële planning</h1><div class="sub">Alle bedragen excl. btw · scenario ${FIN_SCEN[scen].toLowerCase()}.</div></div>
    <div class="actions"><select data-fin-jaar aria-label="Jaar">${jaren.map(j => `<option ${String(j) === jaar ? "selected" : ""}>${j}</option>`).join("")}</select>${segm}<button class="btn" data-fin-act="inst">Uitgangspunten</button><button class="btn" data-fin-act="xlsx">Excel</button><button class="btn primary" data-fin-act="pdf">Pdf voor de bank</button></div></div>
  ${kpi}
  <div class="fin-twee" style="margin-bottom:16px">
    <div class="panel"><div class="panel-head"><h3>Omzet per maand</h3>${legende}</div><div class="panel-body">${finGrafiekOmzet(R)}</div></div>
    <div class="panel"><div class="panel-head"><h3>Binnen en buiten per maand</h3><div class="fin-leg"><span><i class="fin-sw s3"></i>Binnen (ontvangsten)</span><span><i class="fin-sw s4"></i>Buiten (aannemers + vaste kosten)</span></div></div><div class="panel-body">${finGrafiekKasstroom(R)}</div></div>
  </div>
  <div class="panel" style="margin-bottom:16px"><div class="panel-head"><h3>Per maand · ${jaar}</h3><span class="muted" style="font-size:12px">bedragen in euro (k = duizend)</span></div>${maandTabel()}</div>
  <div class="panel" style="margin-bottom:16px"><div class="panel-head"><h3>Projecten</h3><div class="actions"><span class="muted" style="font-size:12px">klik op een project voor het facturatieplan · ≈ marge (deels) geraamd: pas ze aan in de meetstaat › Marges${kanUit ? " · vink uit wat niet mag meetellen" : ""}</span><button class="btn sm" data-fin-act="geraamd">+ Geraamd project</button></div></div>${projTabel}
    <div class="panel-body muted" style="font-size:12px;border-top:1px solid var(--line)">Pijplijn (offertes en geraamde projecten, gewogen met hun kans): <b>${eur(pipeline)}</b> nog te factureren.${nUit ? ` · <b>${nUit}</b> ${nUit === 1 ? "project staat" : "projecten staan"} zelf uitgezet en ${nUit === 1 ? "telt" : "tellen"} nergens mee (ook niet in Excel en pdf).` : ""}</div></div>
  <div class="fin-onder" style="margin-bottom:16px">
    <div class="panel"><div class="panel-head"><h3>Meerjarenoverzicht</h3><span class="muted" style="font-size:12px">voor een businessplan · scenario ${FIN_SCEN[scen].toLowerCase()}</span></div>
      <div class="tw"><table class="t"><thead><tr><th></th>${drie.map(d => `<th class="r">${d.j}</th>`).join("")}</tr></thead><tbody>
        <tr><td>Omzet</td>${drie.map(d => `<td class="r num">${eur(d.o)}</td>`).join("")}</tr><tr><td class="muted">waarvan al gefactureerd</td>${drie.map(d => `<td class="r num muted">${eur(d.gef)}</td>`).join("")}</tr>
        <tr><td>Aankopen</td>${drie.map(d => `<td class="r num">${eur(finMin(d.k))}</td>`).join("")}</tr><tr><td><b>Brutomarge</b></td>${drie.map(d => `<td class="r num"><b>${eur(d.m)}</b><small class="muted"> ${d.o ? finPct(d.m / d.o) : ""}</small></td>`).join("")}</tr>
        <tr><td>Vaste kosten</td>${drie.map(d => `<td class="r num">${eur(finMin(d.v))}</td>`).join("")}</tr><tr><td><b>Bedrijfsresultaat</b></td>${drie.map(d => `<td class="r num ${d.res < 0 ? "neg" : ""}"><b>${eur(d.res)}</b></td>`).join("")}</tr>
        <tr><td>Binnen (ontvangsten)</td>${drie.map(d => `<td class="r num">${eur(d.in)}</td>`).join("")}</tr><tr><td>Buiten</td>${drie.map(d => `<td class="r num">${eur(finMin(d.uit))}</td>`).join("")}</tr></tbody></table></div>
      <div class="panel-body muted" style="font-size:12px;border-top:1px solid var(--line)">Latere jaren tellen enkel wat nu gekend is (projecten, offertes, geraamde projecten). Voeg geraamde projecten toe om de verwachte groei te tonen.</div></div>
    <div class="panel"><div class="panel-head"><h3>Vaste kosten</h3><button class="btn sm" data-fin-act="vk-nieuw">+ Vaste kost</button></div>${vkTabel}
      <div class="panel-body muted" style="font-size:12px;border-top:1px solid var(--line)">Gemiddeld per maand in ${jaar}: <b>${eur(vast / 12)}</b>. Jaar- en kwartaalbedragen worden in het resultaat gespreid en bij binnen/buiten geteld in de maand waarin ze betaald worden.</div></div>
  </div>`;
}

/* ---------- bewerken ---------- */
const finZoek = (key) => key && key.startsWith("f:") ? { f: (S.fin_plan || {})[key.slice(2)] || null, p: null } : { p: S.projecten[key] || null, f: finPlanVan(key) };
async function finZetPlan(key, patch) {
  const { p, f } = finZoek(key);
  if (f) return dbUpdate("fin_plan", f.id, patch);
  if (p) return dbInsert("fin_plan", { project_id: p.id, ...patch });
}
const finPctLees = (raw) => { const n = leesGetal(raw); return n == null ? null : n / 100; };
function finInstForm() {
  const I = finInst(); const v = ((S.fin_instellingen || {})[1] || {}).value || {};
  const veld = (k, label, hint, soort) => { const w = v[k] != null && v[k] !== "" ? v[k] : ""; const toon = soort === "pct" ? (w === "" ? "" : pctVeld(w)) : soort === "datum" ? w : getalVeld(w);
    const ph = soort === "pct" ? pctVeld(FIN_STD[k]) : soort === "datum" ? "" : getalVeld(FIN_STD[k]);
    return `<div class="field"><label for="fi_${k}">${label}</label><input id="fi_${k}" name="${k}" ${soort === "datum" ? 'type="date"' : 'type="text" inputmode="decimal"'} value="${esc(toon)}" placeholder="${esc(ph)}">${hint ? `<small class="muted">${hint}</small>` : ""}</div>`; };
  openModal("Uitgangspunten financiële planning", `<p class="muted" style="margin-top:0">Leeg = standaardwaarde (grijs). Alle bedragen excl. btw.</p>
    <div class="form-grid">
      ${veld("voorschot", "Voorschot bij de start (%)", "van de omzet, als er nog geen voorschot is", "pct")}${veld("slot", "Slotfactuur bij oplevering (%)", "", "pct")}
      ${veld("klant_termijn", "Betaaltermijn klanten (dagen)", "", "getal")}${veld("aannemer_termijn", "Betaaltermijn aannemers (dagen)", "", "getal")}
      ${veld("duur", "Standaard looptijd (maanden)", "als een project geen einddatum heeft", "getal")}${veld("marge", "Standaard marge op kostprijs (%)", "voor projecten met een budget of forfait, en voor meetstaatposten zonder offerte van een aannemer", "pct")}
      ${veld("kans", "Standaard slaagkans offertes (%)", "", "getal")}${veld("index", "Indexatie vaste kosten per jaar (%)", "", "pct")}
      ${veld("vz_drempel", "Voorzichtig: offertes vanaf kans (%)", "en", "getal")}${veld("vz_vertraging", "Voorzichtig: later gestart (maanden)", "", "getal")}
      ${veld("opt_drempel", "Optimistisch: offertes vanaf kans (%)", "tellen volledig", "getal")}
    </div><p class="muted" style="font-size:12px">Verwacht: elke offerte telt mee in verhouding tot haar kans (60 % kans = 60 % van de bedragen). Voorzichtig: idem, maar enkel offertes vanaf de drempel, en later gestart. Optimistisch: offertes vanaf de drempel tellen volledig, de rest gewogen.</p>`, {
    onSave: async (d) => {
      const out = {}; for (const k of Object.keys(FIN_STD)) { const raw = String(d[k] ?? "").trim(); if (!raw) continue;
        const n = leesGetal(raw); if (n == null || !isFinite(n)) { toast("Ongeldige waarde bij " + k.replace(/_/g, " ") + "."); return false; }
        out[k] = ["voorschot", "slot", "marge", "index"].includes(k) ? n / 100 : n; }
      if (out.voorschot != null && (out.voorschot < 0 || out.voorschot > 1) || out.slot != null && (out.slot < 0 || out.slot > 1) || (out.voorschot ?? FIN_STD.voorschot) + (out.slot ?? FIN_STD.slot) > 1) { toast("Voorschot en slotfactuur samen moeten tussen 0 en 100 % liggen."); return false; }
      if (["klant_termijn", "aannemer_termijn"].some(k => out[k] != null && (out[k] < 0 || out[k] > 365))) { toast("Betaaltermijnen tussen 0 en 365 dagen."); return false; }
      if (out.duur != null && (out.duur < 1 || out.duur > 60)) { toast("Looptijd tussen 1 en 60 maanden."); return false; }
      if (["kans", "vz_drempel", "opt_drempel"].some(k => out[k] != null && (out[k] < 0 || out[k] > 100))) { toast("Kansen en drempels tussen 0 en 100 %."); return false; }
      if (out.vz_vertraging != null && (out.vz_vertraging < 0 || out.vz_vertraging > 24)) { toast("Vertraging tussen 0 en 24 maanden."); return false; }
      if (out.marge != null && (out.marge <= -1 || out.marge > 10) || out.index != null && (out.index < -0.5 || out.index > 1)) { toast("Kijk de marge en de indexatie na."); return false; }
      if (S.fin_instellingen && S.fin_instellingen[1]) await dbUpdate("fin_instellingen", 1, { value: out }); else await dbUpsert("fin_instellingen", { id: 1, value: out });
      toast("Uitgangspunten bewaard.");
    }, wide: true });
}
const finRijHtml = (r, i) => `<tr data-fin-planrij><td><input type="date" name="pd_${i}" value="${esc(r.datum || "")}" aria-label="Datum"></td><td><input type="text" inputmode="decimal" name="pp_${i}" value="${r.pct ? pctVeld(r.pct) : ""}" style="width:80px" aria-label="Deel in %"> %</td><td class="r"><button type="button" class="btn ghost sm danger" data-fin-rijweg aria-label="Moment verwijderen">✕</button></td></tr>`;
/* facturatieplan van één project (of geraamd project) */
function finPlanForm(key, nieuw) {
  const I = finInst(); const { p, f } = nieuw ? { p: null, f: null } : finZoek(key); const geraamd = nieuw || !p;
  const x = !nieuw ? finProject(p, f, I, "verwacht") : null; const eigen = !!(f && Array.isArray(f.plan) && f.plan.length);
  const echte = x ? x.inkomsten.filter(i => i.soort !== "gepland") : []; const auto = x ? x.inkomsten.filter(i => i.soort === "gepland") : [];
  const planRijen = eigen ? f.plan.map(r => ({ datum: r.datum, pct: Number(r.pct) })) : auto.map(i => ({ datum: i.datum, pct: x.R ? i.bruto / x.R : 0 }));
  const rijHtml = finRijHtml;
  const bronTekst = x ? (x.bron === "meetstaat" ? `Omzet en kostprijs komen uit de <a href="#" data-fin-act="naar-ms" data-pid="${p.id}">meetstaat</a> (marge per post of per lot): omzet ${eur(x.O)}, kostprijs ${eur(x.K)}, marge ${eur(x.marge)}.${x.raming ? ` Waarvan <b>geraamd</b>: ${x.raming.n} post${x.raming.n === 1 ? "" : "en"} zonder offerte van een aannemer (${eur(x.raming.verkoop)}) met een marge van ${eur(x.raming.marge)} — <a href="#" data-fin-act="naar-ms" data-marges="1" data-pid="${p.id}">marges aanpassen</a>.` : ""}` : x.bron === "forfait" ? `Omzet = het forfait van het project (${eur(x.O)}); kostprijs volgens de marge hieronder. Zodra er een meetstaat is, telt die.` : x.bron === "budget" ? `Omzet = het budget hieronder; kostprijs volgens de marge. Zodra er een meetstaat is, telt die.` : `Nog geen bedrag: vul een budget in (of maak een meetstaat).`) : "";
  const budgetVelden = (geraamd || (x && x.bron !== "meetstaat")) ? `<div class="field"><label for="fp_budget">${geraamd ? "Verwachte omzet" : "Budget"} (€, excl. btw)</label><input id="fp_budget" name="budget" type="text" inputmode="decimal" value="${f && f.budget_excl != null ? getalVeld(f.budget_excl) : ""}" placeholder="${p && Number(p.forfait) ? getalVeld(p.forfait) : ""}"></div>
      <div class="field"><label for="fp_marge">Marge op kostprijs (%)</label><input id="fp_marge" name="marge" type="text" inputmode="decimal" value="${f && f.marge_pct != null ? pctVeld(f.marge_pct) : ""}" placeholder="${pctVeld(I.marge)}"></div>`
    : x && x.bron === "meetstaat" && typeof msRamingKlaar === "function" && msRamingKlaar() ? `<div class="field"><label for="fp_marge">Standaardmarge zonder aannemersofferte (%)</label><input id="fp_marge" name="marge" type="text" inputmode="decimal" value="${f && f.marge_pct != null ? pctVeld(f.marge_pct) : ""}" placeholder="${pctVeld(I.marge)}"><small class="muted">Op de kostprijs, voor meetstaatposten zonder offerte van een aannemer (de klantprijs verandert niet). Per lot of post aan te passen in de meetstaat › Marges.</small></div>` : "";
  openModal(geraamd ? (nieuw ? "Geraamd project toevoegen" : "Geraamd project") : "Financiële planning · " + (p.nummer ? p.nummer + " " : "") + projName(p), `
    ${geraamd ? `<p class="muted" style="margin-top:0">Een verwachte opdracht die nog niet in het Planbord staat — bv. voor een businessplan ("2 renovaties via architect X in 2027"). Wordt het een echt project, verwijder het dan hier.</p>` : `<p class="muted" style="margin-top:0">${bronTekst}</p>`}
    <div class="form-grid">
      ${geraamd ? `<div class="field span2"><label for="fp_naam">Omschrijving</label><input id="fp_naam" name="naam" required value="${esc(f ? f.naam : "")}" placeholder="bv. Renovatie appartement — via architect X"></div>
        <div class="field"><label for="fp_start">Start</label><input id="fp_start" name="start" type="date" value="${esc(f ? f.start || "" : "")}"></div><div class="field"><label for="fp_eind">Geplande einde</label><input id="fp_eind" name="eind" type="date" value="${esc(f ? f.eind || "" : "")}"></div>` : ""}
      ${budgetVelden}
      ${geraamd || (p && p.status === "offerte") ? `<div class="field"><label for="fp_kans">Slaagkans (%)</label><input id="fp_kans" name="kans" type="text" inputmode="numeric" value="${f && f.kans != null ? f.kans : ""}" placeholder="${I.kans}"></div>` : ""}
      <div class="field"><label for="fp_vs">Voorschot bij de start (%)</label><input id="fp_vs" name="voorschot" type="text" inputmode="decimal" value="${f && f.voorschot_pct != null ? pctVeld(f.voorschot_pct) : ""}" placeholder="${pctVeld(I.voorschot)}"></div>
      <div class="field"><label for="fp_sl">Slotfactuur bij oplevering (%)</label><input id="fp_sl" name="slot" type="text" inputmode="decimal" value="${f && f.slot_pct != null ? pctVeld(f.slot_pct) : ""}" placeholder="${pctVeld(I.slot)}"></div>
      <div class="field span2"><label for="fp_opm">Opmerking</label><input id="fp_opm" name="opmerking" value="${esc(f ? f.opmerking || "" : "")}"></div>
    </div>
    ${x ? `<h3 style="font-size:15px;margin:14px 0 6px">Facturatiemomenten</h3>
      ${echte.length ? `<div class="tw"><table class="t"><tbody>${echte.map(i => `<tr><td>${fmtLong(i.datum)}</td><td>${esc(i.naam)}</td><td class="r num">${eur(i.bruto)}</td><td class="muted">${i.soort === "gefactureerd" ? "gefactureerd" : "klaar in Facturatie"}</td></tr>`).join("")}</tbody></table></div>` : ""}
      <p class="muted" style="font-size:13px">Nog te factureren: <b>${eur(x.R)}</b>${x.waarsch.length ? ` · ⚠ ${esc(x.waarsch.join(" · "))}` : ""}</p>
      ${x.R > 0.5 ? `<div class="sw-row" style="display:flex;gap:16px;margin-bottom:8px"><label><input type="radio" name="modus" value="auto" ${eigen ? "" : "checked"}> Automatisch voorstel</label><label><input type="radio" name="modus" value="eigen" ${eigen ? "checked" : ""}> Eigen plan</label></div>
        <div id="fin-auto" ${eigen ? "hidden" : ""}><div class="tw"><table class="t"><tbody>${(eigen ? [] : auto).map(i => `<tr><td>${fmtLong(i.datum)}</td><td>${esc(i.naam)}</td><td class="r num">${eur(i.bruto)}</td></tr>`).join("") || `<tr><td class="muted">Kies "Automatisch voorstel" en bewaar om het voorstel te zien.</td></tr>`}</tbody></table></div><small class="muted">Voorschot bij de start, gelijke vorderingen per maand, slotfactuur bij het geplande einde. Wijzig start/einde of de percentages hierboven om het voorstel aan te passen.</small></div>
        <div id="fin-eigen" ${eigen ? "" : "hidden"}><div class="tw"><table class="t"><thead><tr><th>Datum</th><th>Deel van wat nog te factureren is</th><th></th></tr></thead><tbody id="fin-planrijen">${planRijen.map(rijHtml).join("")}</tbody></table></div>
          <button type="button" class="btn sm" data-fin-rijplus>+ Moment</button> <small class="muted">De percentages worden herschaald naar 100 %.</small></div>` : ""}` : ""}`, {
    wide: true,
    onSave: async (d) => {
      const patch = {}; const pc = (k) => { const raw = String(d[k] ?? "").trim(); if (!raw) return null; const n = leesGetal(raw); if (n == null || !isFinite(n)) throw new Error("ongeldig getal"); return n; };
      try {
        if (geraamd) { patch.naam = String(d.naam || "").trim(); if (!patch.naam) { toast("Geef een omschrijving."); return false; } patch.start = d.start || null; patch.eind = d.eind || null; if (patch.start && patch.eind && patch.eind < patch.start) { toast("Het einde ligt vóór de start."); return false; } }
        if ("budget" in d) { const b = pc("budget"); patch.budget_excl = b; const m = pc("marge"); patch.marge_pct = m == null ? null : m / 100; }
        else if ("marge" in d) { const m = pc("marge"); if (m != null && (m < -99 || m >= 1000)) { toast("Geef een marge tussen -99 en 1000 %."); return false; } patch.marge_pct = m == null ? null : Math.round(m * 100) / 1e4; }   // 1.55: standaardmarge voor geraamde meetstaatposten
        if ("kans" in d) { const k = pc("kans"); if (k != null && (k < 0 || k > 100)) { toast("Kans tussen 0 en 100 %."); return false; } patch.kans = k == null ? null : Math.round(k); }
        const vs = pc("voorschot"), sl = pc("slot"); patch.voorschot_pct = vs == null ? null : vs / 100; patch.slot_pct = sl == null ? null : sl / 100;
        if ((patch.voorschot_pct || 0) < 0 || (patch.slot_pct || 0) < 0 || (patch.voorschot_pct ?? I.voorschot) + (patch.slot_pct ?? I.slot) > 1) { toast("Voorschot en slotfactuur samen moeten tussen 0 en 100 % liggen."); return false; }
      } catch (e) { toast("Kijk de getallen na (bv. 25 of 12,5)."); return false; }
      patch.opmerking = String(d.opmerking || "");
      if (d.modus === "eigen") { const rijen = [...document.querySelectorAll("#fin-planrijen tr")].map(tr => ({ datum: tr.querySelector('input[type="date"]').value, pct: leesGetal(tr.querySelector('input[inputmode="decimal"]').value) })).filter(r => r.datum && r.pct > 0);
        if (!rijen.length) { toast("Voeg minstens één moment met een datum en een % toe, of kies Automatisch."); return false; }
        patch.plan = rijen.map(r => ({ datum: r.datum, pct: r.pct / 100 })); }
      else if (d.modus === "auto") patch.plan = null;
      if (nieuw) await dbInsert("fin_plan", patch); else if (f) await dbUpdate("fin_plan", f.id, patch); else await dbInsert("fin_plan", { project_id: p.id, ...patch });
      toast("Planning bewaard.");
    },
    onDelete: geraamd && f ? async () => { await dbDelete("fin_plan", f.id); } : null
  });
  const m = document.getElementById("modal");
  m.querySelectorAll('input[name="modus"]').forEach(r => r.addEventListener("change", () => { const e = r.value === "eigen" && r.checked; if (!r.checked) return; m.querySelector("#fin-eigen").hidden = !e; m.querySelector("#fin-auto").hidden = e; }));
}
document.addEventListener("click", async (e) => {
  if (e.target.closest("#modal [data-fin-rijweg]")) { e.target.closest("tr").remove(); MODAL.dirty = true; return; }
  if (e.target.closest("#modal [data-fin-rijplus]")) { const tb = document.querySelector("#fin-planrijen"); if (tb) { tb.insertAdjacentHTML("beforeend", finRijHtml({ datum: "", pct: 0 }, "n" + Date.now())); MODAL.dirty = true; } return; }
  const el = e.target.closest("[data-fin-act]"); if (!el) return; const d = el.dataset;
  if (d.finAct === "naar-ms") { e.preventDefault(); if (closeModal() === false) return; S.view = "projecten"; S.project = d.pid; S.ptab = "meetstaat"; if (d.marges) { S.msMarges = true; S.msKlant = false; try { localStorage.setItem("bros.msMarges", "1"); localStorage.setItem("bros.msKlant", ""); } catch (x) { } } render(); window.scrollTo({ top: 0 }); return; }
  if (d.finAct === "raptab") { S.rapTab = d.t; render(); return; }
  if (d.finAct === "scen") { S.finScen = d.s; render(); return; }
  if (d.finAct === "inst") return finInstForm();
  if (d.finAct === "plan") return finPlanForm(d.k);
  if (d.finAct === "geraamd") return finPlanForm(null, true);
  if (d.finAct === "vk-nieuw") { try { await dbInsert("fin_vaste_kosten", { categorie: "overig", omschrijving: "", bedrag: 0, frequentie: "maand", vanaf: todayIso.slice(0, 7) + "-01", volgorde: Object.keys(S.fin_vaste_kosten || {}).length }); } catch (x) { } return; }
  if (d.finAct === "vk-weg") { const v = (S.fin_vaste_kosten || {})[d.id]; if (v && confirm(`Vaste kost "${v.omschrijving || FIN_CAT[v.categorie]}" verwijderen?`)) { try { await dbDelete("fin_vaste_kosten", d.id); } catch (x) { } } return; }
  if ((d.finAct === "pdf" || d.finAct === "xlsx") && S.prijsFout) return toast("Prijzen niet correct geladen — herlaad de pagina eerst.", 5000);
  if (d.finAct === "pdf") return finPdf();
  if (d.finAct === "xlsx") return finExcel();
});
document.addEventListener("change", async (e) => {
  const el = e.target; if (!el || !el.dataset) return;
  if (el.matches("[data-fin-jaar]")) { S.finJaar = el.value; render(); return; }
  if (el.matches("[data-fin-in]")) { if (schemaV() < 50) return; const aan = el.checked; el.disabled = true;
    try { const r = await finZetPlan(el.dataset.k, { meetellen: aan }); if (!r) { toast("Dit project bestaat niet meer."); render(); return; } toast(aan ? "Telt weer mee in de planning" : "Telt niet meer mee in de planning"); } catch (x) { render(); } return; }
  if (el.matches("[data-fin-kans]")) { const raw = el.value.trim(); const n = raw === "" ? null : leesGetal(raw); if (n != null && (!isFinite(n) || n < 0 || n > 100)) { toast("Kans tussen 0 en 100 %."); el.value = ""; return; } try { await finZetPlan(el.dataset.k, { kans: n == null ? null : Math.round(n) }); } catch (x) { } return; }
  if (el.matches("[data-fin-d]")) { const f = el.dataset.finD, k = el.dataset.k, v = el.value || null; const { p, f: fp } = finZoek(k);
    if (v && !/^(19|20)\d\d-\d\d-\d\d$/.test(v)) return;   /* jaar nog aan het typen (Chrome stuurt 0002-…): niet bewaren */
    const ander = p ? (f === "start" ? p.eind : p.start) : fp ? (f === "start" ? fp.eind : fp.start) : null;
    if (v && ander && (f === "start" ? v > ander : v < ander)) { toast("Het einde ligt vóór de start."); render(); return; }
    try { if (p) await dbUpdate("projecten", p.id, { [f]: v }); else if (fp) await dbUpdate("fin_plan", fp.id, { [f]: v }); } catch (x) { } return; }
  if (el.matches("[data-fvk]")) { const f = el.dataset.fvk, id = el.dataset.id; let v;
    if (f === "bedrag") { v = leesGetal(el.value); if (v == null || !isFinite(v)) { toast("Ongeldig bedrag."); render(); return; } }
    else if (f === "indexeren") v = el.checked;
    else if (f === "vanaf") { if (!el.value) { render(); return; } v = el.value + "-01"; }
    else if (f === "tot") v = el.value ? finLaatsteDag(el.value) : null;
    else v = el.value;
    const rij = (S.fin_vaste_kosten || {})[id]; if (f === "tot" && v && rij && v < rij.vanaf) { toast("'Tot' ligt vóór 'vanaf'."); render(); return; }
    if (f === "vanaf" && rij && rij.tot && v > rij.tot) { toast("'Vanaf' ligt na 'tot'."); render(); return; }
    try { await dbUpdate("fin_vaste_kosten", id, { [f]: v }); } catch (x) { } }
});

/* ---------- export: gemeenschappelijke gegevens ---------- */
function finExportData() {
  const I = finInst(); const jaar = S.finJaar || todayIso.slice(0, 4); const scen = S.finScen || "verwacht";
  const model = finModel(scen); const R = finReeks(model, I, jaar + "-01", jaar + "-12");
  const drie = [0, 1, 2].map(i => { const j = String(Number(jaar) + i); const r = finReeks(model, I, j + "-01", j + "-12"); const o = finTot(r.omzet), k = finTot(r.kost), v = finTot(r.vast); return { j, o, k, m: r2(o - k), v, res: r2(o - k - v), in: finTot(r.in), uit: finTot(r.uit) }; });
  const inJaar = (x) => ({ o: r2(finSom(x.inkomsten.filter(i => i.datum.slice(0, 4) === jaar), i => i.bedrag)), k: r2(finSom(x.kosten.filter(c => c.datum.slice(0, 4) === jaar), c => c.bedrag)) });
  const projecten = model.filter(x => x.status !== "afgerond" || inJaar(x).o || inJaar(x).k).map(x => ({ x, j: inJaar(x), gef: r2(finSom(x.inkomsten.filter(i => i.soort === "gefactureerd"), i => i.bruto)) }))
    .sort((a, b) => (a.x.getekend === b.x.getekend ? 0 : a.x.getekend ? -1 : 1) || (a.x.geraamd === b.x.geraamd ? 0 : a.x.geraamd ? 1 : -1) || (a.x.start || "").localeCompare(b.x.start || ""));
  const vk = Object.values(S.fin_vaste_kosten || {}).sort((a, b) => (a.volgorde || 0) - (b.volgorde || 0) || (a.categorie || "").localeCompare(b.categorie || ""));
  return { I, jaar, scen, model, R, drie, projecten, vk };
}
const finStatusTekst = (x) => x.geraamd ? "Geraamd" : PROJ_STATUS[x.status] || x.status;
const finMethode = (E) => [
  "Alle bedragen zijn exclusief btw. Scenario: " + FIN_SCEN[E.scen].toLowerCase() + ".",
  "Omzet en kostprijs per project komen uit de meetstaat in het Planbord (kostprijs van de aannemers plus de marge van BROS per post of per lot). Voor posten zonder offerte van een aannemer is de kostprijs geraamd: klantprijs min de marge die BROS ervoor aanduidt (standaard " + finPct(E.I.marge) + " op de kostprijs). Projecten zonder meetstaat rekenen met hun budget of forfait en een marge van " + finPct(E.I.marge) + " op de kostprijs.",
  "Gefactureerde omzet = verzonden en betaalde facturen (vorderingen). Wat nog gefactureerd moet worden, is ingepland: voorschot " + finPct(E.I.voorschot) + " bij de start, gelijke vorderingen per maand tijdens de uitvoering en een slotfactuur van " + finPct(E.I.slot) + " bij de oplevering, tenzij er per project een eigen plan is.",
  "Aankopen: de kostprijs wordt gelijk gespreid over de uitvoeringsperiode; ontvangen aannemersfacturen zijn eerst verrekend. Klanten betalen na " + Math.round(E.I.klant_termijn) + " dagen, aannemers worden betaald na " + Math.round(E.I.aannemer_termijn) + " dagen.",
  "Offertes en geraamde projecten: " + (E.scen === "verwacht" ? "meegerekend in verhouding tot hun slaagkans (bv. 60 % kans = 60 % van de bedragen)." : E.scen === "voorzichtig" ? "enkel bij een slaagkans vanaf " + E.I.vz_drempel + " %, in verhouding tot die kans, en " + E.I.vz_vertraging + " maand(en) later gestart dan gepland." : "volledig meegerekend vanaf een slaagkans van " + E.I.opt_drempel + " %, de andere in verhouding tot hun kans."),
  "Binnen en buiten per maand: wat er die maand binnenkomt (betalingen van klanten) en wat er buitengaat (aannemers en vaste kosten), op de (verwachte) betaaldatum. Er wordt geen kaspositie of banksaldo berekend.",
  "Voor voorbije maanden tellen bij binnen en buiten enkel de feiten: betaalde en openstaande facturen en de aannemersfacturen in het Planbord. Geplande aankopen waarvan de betaaldatum al voorbij is, tellen wel in het resultaat maar niet bij buiten (vermoedelijk al betaald buiten het Planbord).",
  "Omzet die volgens de planning in voorbije maanden gefactureerd had moeten zijn, staat nu ingepland. Facturen die verzonden maar nog niet betaald zijn, worden verwacht vanaf vandaag; van een deels betaalde factuur (volgens Yuki) telt het betaalde deel als ontvangen op de factuurdatum.",
  "Binnen en buiten zijn exclusief btw: btw-ontvangsten, -betalingen en de kwartaalafdracht zitten er niet in.",
  "Vaste kosten zoals ingegeven, jaarlijks geïndexeerd met " + finPct(E.I.index) + " waar aangeduid; in het resultaat gespreid over de maanden, bij binnen/buiten in de maand waarin ze betaald worden.",
  "Bedrijfsresultaat = brutomarge min vaste kosten, vóór afschrijvingen, intresten en belastingen."];

/* ---------- Excel (xlsx, met formules) ---------- */
function finXlsxBestand(sheets) {
  const xe = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  const col = (i) => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const blad = (sh) => { const rows = sh.rijen.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => { if (c == null || c === "") return ""; const ref = col(ci) + (ri + 1); const o = typeof c === "object" ? c : { v: c }; const st = o.s != null ? ` s="${o.s}"` : "";
      if (o.f) return `<c r="${ref}"${st}><f>${xe(o.f)}</f></c>`; if (typeof o.v === "number" && isFinite(o.v)) return `<c r="${ref}"${st}><v>${o.v}</v></c>`; return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${xe(o.v)}</t></is></c>`; }).join("")}</row>`).join("");
    const cols = sh.breedtes ? `<cols>${sh.breedtes.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"${sh.vast ? "" : ""}>${sh.vast ? `<pane ySplit="${sh.vast}" topLeftCell="A${sh.vast + 1}" activePane="bottomLeft" state="frozen"/>` : ""}</sheetView></sheetViews>${cols}<sheetData>${rows}</sheetData></worksheet>`; };
  const z = new JSZip();
  z.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
  z.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  z.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xe(s.naam.slice(0, 31).replace(/[\\/?*[\]:]/g, " "))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
  z.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  // stijlen: 0 gewoon · 1 vet · 2 euro · 3 euro vet · 4 % · 5 kop (vet, grijs) · 6 titel · 7 tekst grijs · 8 % vet
  z.file("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0\\ &quot;€&quot;;[Red]\\-#,##0\\ &quot;€&quot;"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>
    <fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="16"/><name val="Calibri"/></font><font><sz val="10"/><color rgb="FF86868B"/><name val="Calibri"/></font></fonts>
    <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0F0F2"/><bgColor indexed="64"/></patternFill></fill></fills>
    <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
    <cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  sheets.forEach((s, i) => z.file(`xl/worksheets/sheet${i + 1}.xml`, blad(s)));
  return z.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
async function finExcel() {
  if (!window.JSZip) return toast("Excel-module niet geladen — herlaad de pagina.");
  const E = finExportData(); const { R, jaar } = E; const M = R.maanden.map(m => MONTHS[Number(m.slice(5, 7)) - 1] + " " + m.slice(2, 4));
  const k = (t) => ({ v: t, s: 5 }), e2 = (v) => ({ v: r2(v), s: 2 }), col = (i) => String.fromCharCode(66 + i);   // B..M
  // 1. per maand (met formules)
  const pm = [[{ v: "Financiële planning " + jaar + " — per maand (excl. btw, scenario " + FIN_SCEN[E.scen].toLowerCase() + ")", s: 6 }], [], [k("")].concat(M.map(k)).concat([k("Totaal " + jaar)])];
  const rij = (lbl, arr, vet) => { pm.push([{ v: lbl, s: vet ? 1 : 0 }].concat(arr.map(v => e2(v))).concat([{ f: `SUM(B${pm.length + 1}:M${pm.length + 1})`, s: 3 }])); return pm.length; };
  const fRij = (lbl, f, vet, tot) => { const n = pm.length + 1; pm.push([{ v: lbl, s: vet ? 1 : 0 }].concat(R.maanden.map((m, i) => ({ f: f(col(i), n), s: vet ? 3 : 2 }))).concat([{ f: tot ? tot(n) : `SUM(B${n}:M${n})`, s: 3 }])); return n; };
  pm.push([k("Resultaat (op factuurdatum)")]);
  const rG = rij("Omzet gefactureerd", R.gef), rP = rij("Omzet gepland", R.plan);
  const rO = fRij("Omzet", (c) => `${c}${rG}+${c}${rP}`, true);
  const rA = rij("Aankopen (aannemers)", R.kost.map(v => -v));
  const rM = fRij("Brutomarge", (c) => `${c}${rO}+${c}${rA}`, true);
  pm.push([{ v: "Brutomarge in % van de omzet" }].concat(R.maanden.map((m, i) => ({ f: `IF(${col(i)}${rO}=0,"",${col(i)}${rM}/${col(i)}${rO})`, s: 4 }))).concat([{ f: `IF(N${rO}=0,"",N${rM}/N${rO})`, s: 8 }]));
  const rV = rij("Vaste kosten", R.vast.map(v => -v));
  fRij("Bedrijfsresultaat", (c) => `${c}${rM}+${c}${rV}`, true);
  pm.push([]); pm.push([k("Binnen en buiten (op betaaldatum)")]);
  const rI = rij("Binnen: ontvangsten klanten", R.in), rU = rij("Buiten: betalingen aannemers", R.uitA.map(v => -v)), rW = rij("Buiten: vaste kosten", R.uitV.map(v => -v));
  const rT = fRij("Buiten: totaal", (c) => `${c}${rU}+${c}${rW}`, true);
  fRij("Verschil binnen − buiten", (c) => `${c}${rI}+${c}${rT}`, false);
  // 2. samenvatting en meerjaren
  const sv = [[{ v: "BROS — financiële planning " + jaar, s: 6 }], [{ v: "Scenario " + FIN_SCEN[E.scen].toLowerCase() + " · opgemaakt " + fmtLong(todayIso) + " · alle bedragen excl. btw", s: 7 }], [],
    [k(""), ...E.drie.map(d => k(d.j))],
    ["Omzet", ...E.drie.map(d => e2(d.o))], ["Aankopen", ...E.drie.map(d => e2(finMin(d.k)))], [{ v: "Brutomarge", s: 1 }, ...E.drie.map((d, i) => ({ f: `${col(i)}5+${col(i)}6`, s: 3 }))],
    ["Brutomarge in %", ...E.drie.map((d, i) => ({ f: `IF(${col(i)}5=0,"",${col(i)}7/${col(i)}5)`, s: 4 }))], ["Vaste kosten", ...E.drie.map(d => e2(finMin(d.v)))],
    [{ v: "Bedrijfsresultaat", s: 1 }, ...E.drie.map((d, i) => ({ f: `${col(i)}7+${col(i)}9`, s: 3 }))], ["Binnen (ontvangsten)", ...E.drie.map(d => e2(d.in))], ["Buiten", ...E.drie.map(d => e2(finMin(d.uit)))], [],
    [k("Uitgangspunten en methode")], ...finMethode(E).map(t => [{ v: t, s: 7 }])];
  // 3. projecten
  const pr = [[k("Project"), k("Status"), k("Kans"), k("Start"), k("Geplande einde"), k("Omzet"), k("Kostprijs"), k("Marge"), k("Marge % omzet"), k("Gefactureerd"), k("Nog te factureren"), k("Omzet " + jaar + " (gewogen)"), k("Aankopen " + jaar), k("Bron"), k("Opmerkingen")]];
  E.projecten.forEach(({ x, j, gef }) => { const n = pr.length + 1; pr.push([x.naam, finStatusTekst(x), { v: x.kans / 100, s: 4 }, fmtLong(x.start), fmtLong(x.eind), e2(x.O), e2(x.K), { f: `F${n}-G${n}`, s: 2 }, { f: `IF(F${n}=0,"",H${n}/F${n})`, s: 4 }, e2(gef), e2(Math.max(0, x.R)), e2(j.o), e2(j.k), x.bron, x.waarsch.join(" · ")]); });
  const n1 = pr.length; pr.push([{ v: "Totaal", s: 1 }, "", "", "", "", { f: `SUM(F2:F${n1})`, s: 3 }, { f: `SUM(G2:G${n1})`, s: 3 }, { f: `SUM(H2:H${n1})`, s: 3 }, { f: `IF(F${n1 + 1}=0,"",H${n1 + 1}/F${n1 + 1})`, s: 8 }, { f: `SUM(J2:J${n1})`, s: 3 }, { f: `SUM(K2:K${n1})`, s: 3 }, { f: `SUM(L2:L${n1})`, s: 3 }, { f: `SUM(M2:M${n1})`, s: 3 }]);
  // 4. facturatieplanning en aankopen (alle bewegingen in het jaar)
  const fp = [[k("Datum"), k("Project"), k("Omschrijving"), k("Soort"), k("Bedrag (gewogen)"), k("Bedrag (100 %)"), k("Betaling verwacht")]];
  E.model.forEach(x => x.inkomsten.filter(i => i.datum.slice(0, 4) === jaar).forEach(i => fp.push([fmtLong(i.datum), x.naam, i.naam, i.soort === "gefactureerd" ? "gefactureerd" : i.soort === "klaar" ? "klaar (op te maken)" : "gepland", e2(i.bedrag), e2(i.bruto), fmtLong(i.cash)])));
  fp.splice(1, fp.length - 1, ...fp.slice(1).sort((a, b) => a[0].split("/").reverse().join("").localeCompare(b[0].split("/").reverse().join(""))));
  fp.push([{ v: "Totaal", s: 1 }, "", "", "", { f: `SUM(E2:E${fp.length})`, s: 3 }, { f: `SUM(F2:F${fp.length})`, s: 3 }]);
  const ak = [[k("Datum"), k("Project"), k("Omschrijving"), k("Soort"), k("Bedrag (gewogen)"), k("Bedrag (100 %)"), k("Betaling verwacht")]];
  E.model.forEach(x => x.kosten.filter(c => c.datum.slice(0, 4) === jaar).forEach(c => ak.push([fmtLong(c.datum), x.naam, c.naam, c.soort === "factuur" ? "aannemersfactuur" : "gepland", e2(c.bedrag), e2(c.bruto), c.cash ? fmtLong(c.cash) : "voorbij (niet bij buiten)"])));
  ak.splice(1, ak.length - 1, ...ak.slice(1).sort((a, b) => a[0].split("/").reverse().join("").localeCompare(b[0].split("/").reverse().join(""))));
  ak.push([{ v: "Totaal", s: 1 }, "", "", "", { f: `SUM(E2:E${ak.length})`, s: 3 }, { f: `SUM(F2:F${ak.length})`, s: 3 }]);
  // 5. vaste kosten
  const vk = [[k("Categorie"), k("Omschrijving"), k("Bedrag"), k("Frequentie"), k("Vanaf"), k("Tot"), k("Geïndexeerd"), k("Per maand " + jaar), k(jaar + " (resultaat)")]];
  E.vk.forEach(v => { const n = vk.length + 1; vk.push([FIN_CAT[v.categorie] || v.categorie, v.omschrijving || "", e2(Number(v.bedrag) || 0), FIN_FREQ[v.frequentie] || v.frequentie, fmtLong(v.vanaf), v.tot ? fmtLong(v.tot) : "blijvend", v.indexeren !== false ? "ja" : "nee", e2(finVastPerMaand(E.I, v, jaar)), e2(R.maanden.reduce((s, m) => { const one = finVastRij(E.I, v, m); return s + one; }, 0))]); });
  vk.push([{ v: "Totaal", s: 1 }, "", "", "", "", "", "", { f: `SUM(H2:H${vk.length})`, s: 3 }, { f: `SUM(I2:I${vk.length})`, s: 3 }]);
  const blob = await finXlsxBestand([
    { naam: "Samenvatting", rijen: sv, breedtes: [34, 16, 16, 16] },
    { naam: "Per maand " + jaar, rijen: pm, breedtes: [30].concat(Array(12).fill(11)).concat([13]), vast: 3 },
    { naam: "Projecten", rijen: pr, breedtes: [36, 12, 8, 12, 14, 13, 13, 13, 11, 13, 14, 16, 14, 11, 50], vast: 1 },
    { naam: "Facturatieplanning " + jaar, rijen: fp, breedtes: [12, 34, 30, 18, 16, 15, 16], vast: 1 },
    { naam: "Aankopen " + jaar, rijen: ak, breedtes: [12, 34, 30, 18, 16, 15, 16], vast: 1 },
    { naam: "Vaste kosten", rijen: vk, breedtes: [26, 30, 13, 14, 12, 12, 11, 13, 15], vast: 1 }]);
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `BROS financiele planning ${jaar} - ${FIN_SCEN[E.scen].toLowerCase()}.xlsx`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  toast("Excel gemaakt.");
}
/* één vaste kost in één maand (resultaat, geïndexeerd) — dezelfde regel als finVast */
function finVastRij(I, v, ym) {
  const van = finYm(v.vanaf); const tot = v.tot ? finYm(v.tot) : "9999-12"; if (!van || ym < van || ym > tot) return 0;
  const jaren = Math.max(0, Number(ym.slice(0, 4)) - Number(van.slice(0, 4))); const f = v.indexeren === false ? 1 : Math.pow(1 + (Number(I.index) || 0), jaren);
  return r2((Number(v.bedrag) || 0) * f / (v.frequentie === "kwartaal" ? 3 : v.frequentie === "jaar" ? 12 : 1));
}

/* ---------- pdf voor de bank (A4 liggend, jsPDF) ---------- */
async function finPdf() {
  let jsPDF; try { jsPDF = await loadJsPdf(); } catch (e) { return toast("Pdf-module kon niet laden — controleer de internetverbinding."); }
  const E = finExportData(); const { R, jaar } = E; const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: true });
  const W = 297, H = 210, M = 14, CW = W - 2 * M; let y = M; let logo = null; try { logo = await logoData(); } catch (e) { }
  const ink = [29, 29, 31], muted = [134, 134, 139], lijn = [220, 220, 224], soft = [240, 240, 242], s1 = [42, 120, 214], s2 = [235, 104, 52], s3 = [27, 175, 122], s4 = [237, 161, 0], crit = [185, 58, 52];
  const clean = (t) => String(t ?? "").replace(/[−‒–]/g, "-").replace(/[   ]/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/→/g, "->").replace(/⚠/g, "!").replace(/≈/g, "~");
  const geld = (n) => clean(eur(n)); const k = (n) => clean(finK(n));
  const kop = () => { if (logo) doc.addImage(logo, "PNG", M, 9, 24, 7.2); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...muted); doc.text(clean(`Financiële planning ${jaar} · scenario ${FIN_SCEN[E.scen].toLowerCase()} · excl. btw`), W - M, 13, { align: "right" }); y = 24; };
  const nieuw = () => { doc.addPage(); kop(); };
  const titel = (t) => { doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(...ink); doc.text(clean(t), M, y + 5); y += 10; };
  const tabel = (kolommen, rijen, opt = {}) => {   // kolommen: [label, breedte, "l"|"r"]
    const xs = []; let x = M; kolommen.forEach(c => { xs.push(x); x += c[1]; }); const rh = opt.rh || 5.6;
    const kopRij = () => { doc.setFillColor(...soft); doc.rect(M, y, CW, 6.5, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...muted); kolommen.forEach((c, i) => doc.text(clean(c[0]).toUpperCase(), c[2] === "r" ? xs[i] + c[1] - 1.5 : xs[i] + 1.5, y + 4.4, { align: c[2] === "r" ? "right" : "left" })); y += 7.5; };
    kopRij();
    rijen.forEach(r => { if (y + rh > H - 14) { nieuw(); kopRij(); }
      if (r.sectie) { doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...muted); doc.text(clean(r.sectie).toUpperCase(), M + 1.5, y + 4); y += rh; return; }
      doc.setFont("helvetica", r.vet ? "bold" : "normal"); doc.setFontSize(r.klein ? 7.5 : 8.5);
      r.cellen.forEach((c, i) => { const neg = typeof c === "object" && c && c.neg; doc.setTextColor(...(neg ? crit : r.grijs ? muted : ink)); const t = clean(typeof c === "object" && c ? c.t : c); const max = kolommen[i][1] - 3; const tt = doc.getTextWidth(t) > max ? doc.splitTextToSize(t, max)[0].replace(/\s*$/, "…") : t;
        doc.text(tt, kolommen[i][2] === "r" ? xs[i] + kolommen[i][1] - 1.5 : xs[i] + 1.5, y + 3.9, { align: kolommen[i][2] === "r" ? "right" : "left" }); });
      if (r.lijn) { doc.setDrawColor(...lijn); doc.setLineWidth(0.2); doc.line(M, y + rh - 0.6, M + CW, y + rh - 0.6); }
      y += rh; });
    y += 3; };
  const omzet = finTot(R.omzet), gef = finTot(R.gef), kost = finTot(R.kost), marge = r2(omzet - kost), vast = finTot(R.vast), res = r2(marge - vast);
  const inT = finTot(R.in), uitT = finTot(R.uit);
  // pagina 1: samenvatting
  kop(); doc.setFont("helvetica", "bold"); doc.setFontSize(24); doc.setTextColor(...ink); doc.text(clean("Financiële planning " + jaar), M, y + 8); y += 13;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(...muted); doc.text(clean(`BROS · scenario ${FIN_SCEN[E.scen].toLowerCase()} · opgemaakt op ${fmtLong(todayIso)} · alle bedragen excl. btw`), M, y + 3); y += 10;
  const tegels = [["Omzet " + jaar, geld(omzet), `${geld(gef)} gefactureerd`], ["Brutomarge", geld(marge), omzet ? finPct(marge / omzet) + " van de omzet" : ""], ["Bedrijfsresultaat", geld(res), `na ${geld(vast)} vaste kosten`], ["Binnen " + jaar, geld(inT), "buiten: " + geld(uitT)]];
  const tw = (CW - 3 * 5) / 4; tegels.forEach((t, i) => { const x = M + i * (tw + 5); doc.setFillColor(...soft); doc.roundedRect(x, y, tw, 24, 3, 3, "F"); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...muted); doc.text(clean(t[0]), x + 5, y + 7);
    doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(...(i === 2 && res < 0 ? crit : ink)); doc.text(clean(t[1]), x + 5, y + 15); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...muted); doc.text(clean(t[2]), x + 5, y + 20.5); });
  y += 32; titel("Meerjarenoverzicht");
  tabel([["", CW - 3 * 62, "l"], ...E.drie.map(d => [d.j, 62, "r"])], [
    { cellen: ["Omzet", ...E.drie.map(d => geld(d.o))], lijn: true }, { cellen: ["Aankopen (aannemers)", ...E.drie.map(d => geld(finMin(d.k)))], lijn: true },
    { cellen: ["Brutomarge", ...E.drie.map(d => geld(d.m) + (d.o ? "  (" + finPct(d.m / d.o) + ")" : ""))], vet: true, lijn: true }, { cellen: ["Vaste kosten", ...E.drie.map(d => geld(finMin(d.v)))], lijn: true },
    { cellen: ["Bedrijfsresultaat", ...E.drie.map(d => ({ t: geld(d.res), neg: d.res < 0 }))], vet: true, lijn: true }, { cellen: ["Binnen (ontvangsten)", ...E.drie.map(d => geld(d.in))], lijn: true }, { cellen: ["Buiten", ...E.drie.map(d => geld(finMin(d.uit)))], lijn: true }]);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...muted); doc.text(clean("Latere jaren bevatten enkel wat vandaag gekend is: lopende projecten, offertes en geraamde projecten."), M, y); y += 6;
  // pagina 2: grafieken
  nieuw(); titel("Omzet per maand · " + jaar);
  const grafiek = (x0, y0, w, h, reeks, opties) => { const n = reeks.length; const band = w / n; const vals = opties.lijn ? reeks.filter(v => v != null) : opties.groep ? reeks.flat() : reeks.map(r => r[0] + r[1]); let lo = opties.lijn ? Math.min(0, ...vals) : 0, hi = Math.max(1, ...vals); const st = finStap(hi - lo); lo = Math.floor(lo / st) * st; hi = Math.ceil(hi / st) * st;
    const yv = (v) => y0 + h - (v - lo) / (hi - lo) * h; doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setLineWidth(0.15);
    for (let v = lo; v <= hi + 0.001; v += st) { doc.setDrawColor(...(Math.abs(v) < 0.001 ? muted : lijn)); doc.line(x0, yv(v), x0 + w, yv(v)); doc.setTextColor(...muted); doc.text(k(v), x0 - 2, yv(v) + 1, { align: "right" }); }
    R.maanden.forEach((m, i) => { doc.setTextColor(...muted); doc.text(MONTHS[Number(m.slice(5, 7)) - 1], x0 + band * i + band / 2, y0 + h + 5, { align: "center" }); });
    if (opties.lijn) { const pts = reeks.map((v, i) => v == null ? null : [x0 + band * i + band / 2, yv(v)]).filter(Boolean); doc.setDrawColor(...s1); doc.setLineWidth(0.6); for (let i = 1; i < pts.length; i++) doc.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]); doc.setFillColor(...s1); pts.forEach(p => doc.circle(p[0], p[1], 0.8, "F"));
      const last = reeks.length - 1; if (reeks[last] != null) { doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...ink); doc.text(k(reeks[last]), pts[pts.length - 1][0] + 2, pts[pts.length - 1][1] - 2); } }
    else if (opties.groep) { const bw = Math.min(5, (band - 3) / 2); reeks.forEach((r, i) => { const x = x0 + band * i + (band - 2 * bw - 0.6) / 2; [[r[0], s3], [r[1], s4]].forEach(([v, kl], j) => { if (v > 0) { doc.setFillColor(...kl); doc.rect(x + j * (bw + 0.6), yv(v), bw, yv(0) - yv(v), "F"); } }); }); }
    else { const bw = Math.min(8, band * 0.56); reeks.forEach((r, i) => { const x = x0 + band * i + (band - bw) / 2; const a = Math.max(0, r[0]), b = Math.max(0, r[1]); if (a > 0) { doc.setFillColor(...s1); doc.rect(x, yv(a), bw, yv(0) - yv(a), "F"); } if (b > 0) { doc.setFillColor(...s2); doc.rect(x, yv(a + b) , bw, yv(a) - yv(a + b) - (a > 0 ? 0.5 : 0), "F"); } }); } };
  grafiek(M + 14, y, CW - 14, 55, R.maanden.map((m, i) => [R.gef[i], R.plan[i]]), {}); y += 64;
  doc.setFillColor(...s1); doc.rect(M + 14, y - 1.5, 3, 3, "F"); doc.setFontSize(8); doc.setTextColor(...ink); doc.text("Gefactureerd", M + 19, y + 1); doc.setFillColor(...s2); doc.rect(M + 48, y - 1.5, 3, 3, "F"); doc.text(clean("Gepland" + (E.scen === "verwacht" ? " (offertes gewogen met hun kans)" : "")), M + 53, y + 1); y += 8;
  titel("Binnen en buiten per maand · " + jaar); grafiek(M + 14, y, CW - 14, 50, R.maanden.map((m, i) => [Math.max(0, R.in[i]), Math.max(0, R.uit[i])]), { groep: true }); y += 58;
  doc.setFillColor(...s3); doc.rect(M + 14, y - 1.5, 3, 3, "F"); doc.setFontSize(8); doc.setTextColor(...ink); doc.text("Binnen (ontvangsten klanten)", M + 19, y + 1); doc.setFillColor(...s4); doc.rect(M + 70, y - 1.5, 3, 3, "F"); doc.text("Buiten (aannemers + vaste kosten)", M + 75, y + 1); y += 6;
  // pagina 3: per maand
  nieuw(); titel("Per maand · " + jaar);
  const mk = [["", 50, "l"], ...R.maanden.map(m => [MONTHS[Number(m.slice(5, 7)) - 1], 16.4, "r"]), ["Totaal", 19.2, "r"]];
  const mr = (lbl, arr, o = {}) => ({ cellen: [lbl, ...arr.map(v => ({ t: k(v), neg: v < 0 })), { t: k(finTot(arr)), neg: finTot(arr) < 0 }], vet: o.vet, grijs: o.grijs, lijn: true });
  tabel(mk, [{ sectie: "Resultaat (op factuurdatum)" }, mr("Omzet gefactureerd", R.gef), mr("Omzet gepland", R.plan), mr("Omzet", R.omzet, { vet: true }), mr("Aankopen (aannemers)", R.kost.map(v => -v)), mr("Brutomarge", R.marge, { vet: true }), mr("Vaste kosten", R.vast.map(v => -v)), mr("Bedrijfsresultaat", R.resultaat, { vet: true }),
    { sectie: "Binnen en buiten (op betaaldatum)" }, mr("Binnen: ontvangsten klanten", R.in, { vet: true }), mr("Buiten: betalingen aannemers", R.uitA.map(v => -v)), mr("Buiten: vaste kosten", R.uitV.map(v => -v)), mr("Buiten: totaal", R.uit.map(v => -v), { vet: true }), mr("Verschil binnen - buiten", R.verschil, { grijs: true })], { rh: 6.2 });
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...muted); doc.text(clean("Bedragen in euro, k = duizend. Geen kaspositie: enkel wat per maand binnenkomt en gepland buitengaat."), M, y); y += 6;
  // pagina 4: projecten
  nieuw(); titel("Projecten");
  const pk = [["Project", 58, "l"], ["Status", 20, "l"], ["Kans", 12, "r"], ["Periode", 33, "l"], ["Omzet", 24, "r"], ["Marge", 23, "r"], ["Marge %", 16, "r"], ["Gefactureerd", 27, "r"], ["Te factureren", 28, "r"], ["In " + jaar, CW - 241, "r"]];
  const prij = (p) => ({ cellen: [p.x.naam, finStatusTekst(p.x), p.x.kans + " %", fmt(p.x.start) + " - " + fmt(p.x.eind) + (p.x.start.slice(0, 4) !== p.x.eind.slice(0, 4) ? "/" + p.x.eind.slice(2, 4) : ""), geld(p.x.O), geld(p.x.marge), p.x.O ? finPct(p.x.marge / p.x.O) : "", p.gef ? geld(p.gef) : "-", p.x.R > 0.5 ? geld(p.x.R) : "-", p.j.o ? geld(p.j.o) : "-"], lijn: true });
  const grp = [["Getekend", E.projecten.filter(p => p.x.getekend)], ["Offertes", E.projecten.filter(p => p.x.status === "offerte")], ["Geraamde projecten", E.projecten.filter(p => p.x.geraamd)]];
  const tot = (l, f) => l.reduce((s, p) => s + f(p), 0);
  tabel(pk, grp.flatMap(([t, l]) => l.length ? [{ sectie: t + " (" + l.length + ")" }, ...l.map(prij), { cellen: ["Subtotaal", "", "", "", geld(tot(l, p => p.x.O)), geld(tot(l, p => p.x.marge)), tot(l, p => p.x.O) ? finPct(tot(l, p => p.x.marge) / tot(l, p => p.x.O)) : "", geld(tot(l, p => p.gef)), geld(tot(l, p => Math.max(0, p.x.R))), geld(tot(l, p => p.j.o))], vet: true, grijs: true }] : []), { rh: 6 });
  // pagina 5: vaste kosten en methode
  nieuw(); titel("Vaste kosten");
  tabel([["Categorie", 55, "l"], ["Omschrijving", 75, "l"], ["Bedrag", 28, "r"], ["Frequentie", 26, "l"], ["Periode", 40, "l"], ["Per maand " + jaar, 26, "r"], [jaar, CW - 250, "r"]],
    E.vk.map(v => ({ cellen: [FIN_CAT[v.categorie] || v.categorie, v.omschrijving || "", geld(v.bedrag), FIN_FREQ[v.frequentie] || "", fmt(v.vanaf) + "/" + v.vanaf.slice(2, 4) + " - " + (v.tot ? fmt(v.tot) + "/" + v.tot.slice(2, 4) : "blijvend"), geld(finVastPerMaand(E.I, v, jaar)), geld(R.maanden.reduce((s, m) => s + finVastRij(E.I, v, m), 0))], lijn: true }))
      .concat([{ cellen: ["Totaal", "", "", "", "", "", geld(vast)], vet: true }]));
  if (y > H - 70) nieuw(); titel("Uitgangspunten en methode");
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.8); doc.setTextColor(...ink);
  finMethode(E).forEach(t => { const ls = doc.splitTextToSize(clean("• " + t), CW); if (y + ls.length * 4.2 > H - 14) nieuw(); doc.text(ls, M, y + 3); y += ls.length * 4.2 + 1.8; });
  const n = doc.getNumberOfPages(); for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...muted); doc.text(clean("BROS · financiële planning " + jaar + " · vertrouwelijk"), M, H - 7); doc.text(i + " / " + n, W - M, H - 7, { align: "right" }); }
  doc.save(`BROS financiele planning ${jaar} - ${FIN_SCEN[E.scen].toLowerCase()}.pdf`); toast("Pdf gemaakt.");
}
