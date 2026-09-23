/* =====================================================================
   BROS Planbord — Tekenmodule (tabblad Plannen op de projectfiche)
   Fase 1: onderlegger (pdf / afbeelding / dxf) op schaal, zoom en pan, lagen,
           meten en kalibreren. Fase 2 (symbolen, tekst, pdf-export) bouwt hierop verder.

   Coördinaten: wereld = millimeter, y naar boven (zoals in CAD).
   Onderlegger → wereld:  w = t + s · R(rot) · (u, ±v)    (± : beeld/pdf heeft y naar beneden, dxf naar boven)
   Wereld → scherm:       X = W/2 + (x − cx)·z,  Y = H/2 − (y − cy)·z   (z = schermpixels per mm)
   Nodig: databasescript 028.
   ===================================================================== */
const TK_LAGEN = [
  ["onderlegger", "Onderlegger", "#8E8E93"],
  ["bestaand", "Bestaand", "#1F5FD6"],
  ["afbraak", "Afbraak", "#D42A20"],
  ["nieuw", "Nieuw", "#1D1D1F"],
  ["elektro", "Elektro", "#D42A20"],
  ["verlichting", "Verlichting", "#C77700"],
  ["sanitair", "Sanitair", "#1F5FD6"],
  ["hvac", "HVAC / ventilatie", "#2E9E4F"],
  ["tekst", "Tekst", "#1D1D1F"],
  ["maatvoering", "Maatvoering", "#D42A20"],
];
const TK_PT_MM = 25.4 / 72;                 // 1 pdf-punt in mm
const TK_BEELD_MAX = 4800;                  // langste zijde van de basisafbeelding (onder de canvaslimiet van iPad/iPhone)
const TK_SCHALEN = [10, 20, 25, 50, 100, 200, 500];
const tkOk = () => schemaV() >= 28;
const tkPlansOf = (pid) => Object.values(S.tekenplannen || {}).filter(x => x.project_id === pid).sort((a, b) => (a.volgorde ?? 0) - (b.volgorde ?? 0) || (a.naam || "").localeCompare(b.naam || ""));
const tkOnSchaal = (pl) => !!(pl.kalibratie && pl.kalibratie.bron);
const tkBronTekst = (pl) => {
  const k = pl.kalibratie || {};
  if (k.bron === "pdf-schaal") return `op schaal · pdf 1:${k.pdf_schaal}`;
  if (k.bron === "dxf-eenheden") return `op schaal · dxf in ${pl.onderlegger?.eenheid || "mm"}`;
  if (k.bron === "twee-punten") return `gekalibreerd op ${nl(k.controle_mm || 0)} mm`;
  return "nog niet op schaal";
};
const tkSoortTekst = { pdf: "PDF", beeld: "Afbeelding", dxf: "DXF", werfplan: "Werfplan" };

/* ---------- tabblad Plannen ---------- */
function vTekenen(p) {
  if (!tkOk()) return SCHEMA_HINT(28);
  const pls = tkPlansOf(p.id);
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Plannen</h3><div class="muted" style="font-size:12px;margin-top:2px">Tekenmodule — zet een plan van de architect (pdf, dxf, foto) op schaal als onderlegger; meten en kalibreren. Technieken intekenen volgt in de volgende versie.</div></div><div class="actions"><button class="btn sm primary" data-act="tk-new" data-pid="${p.id}">+ Plan</button></div></div>
    ${pls.length ? `<div class="plan-grid">${pls.map(pl => { const o = pl.onderlegger || {}; const img = o.beeld_url || o.thumb_url || o.url; return `<div class="plan-card" data-act="tk-open" data-id="${pl.id}">${img && o.soort !== "dxf" || o.thumb_url ? `<img src="${esc(o.soort === "dxf" ? o.thumb_url : img)}" alt="" loading="lazy">` : `<div class="tk-noimg">${esc(tkSoortTekst[o.soort] || "Leeg plan")}</div>`}<div class="plan-name"><span>${esc(pl.naam || "Plan")}</span><span class="pill ${tkOnSchaal(pl) ? "done" : "vs-open"}" title="${esc(tkBronTekst(pl))}">${tkOnSchaal(pl) ? "1:" + (pl.schaal || 50) : "kalibreren"}</span></div></div>`; }).join("")}</div>`
      : `<div class="empty" style="padding:16px"><b>Nog geen plannen</b>Voeg een plan van de architect toe als onderlegger: een pdf (vectorplan of scan), een dxf (bv. uit Plan2CAD) of een foto. Werkt het best op een computer.</div>`}</div>`;
}

/* ---------- nieuw plan ---------- */
function tkPlanForm(pid) {
  const p = S.projecten[pid]; if (!p) return;
  const wps = typeof plansOf === "function" ? plansOf(pid) : [];
  openModal("Plan toevoegen — " + p.klant, `<div class="form-grid">
    <div class="field span2"><label for="tk_file">Onderlegger</label><input id="tk_file" type="file" accept="application/pdf,.pdf,.dxf,image/*"><small class="muted" data-tk-info>PDF (vector of scan), DXF (bv. uit Plan2CAD of een DWG van de architect, bewaard als DXF) of een foto/afbeelding.</small></div>
    ${wps.length ? `<div class="field span2"><label for="tk_wp">…of een plan uit Werf › Plannen</label><select id="tk_wp" name="werfplan"><option value="">—</option>${opts(wps.map(w => [w.id, w.naam]), "")}</select></div>` : ""}
    <div class="field span2"><label for="tk_naam">Naam</label><input id="tk_naam" name="naam" placeholder="bv. Technieken gelijkvloers"></div>
    <div class="field" data-tk-pdf style="display:none"><label for="tk_pag">Pagina's</label><input id="tk_pag" name="paginas" value="1" placeholder="bv. 1 of 1-3 of alle"><small class="muted">Elke pagina wordt een apart plan.</small></div>
    <div class="field" data-tk-pdf style="display:none"><label for="tk_pschaal">Schaal van de pdf</label><select id="tk_pschaal" name="pdf_schaal">${opts([["50", "1:50"], ["20", "1:20"], ["100", "1:100"], ["25", "1:25"], ["10", "1:10"], ["200", "1:200"], ["", "Onbekend — ik kalibreer zelf"]], "50")}</select><small class="muted">Staat op het titelblok. Afgedrukt op ware grootte (niet 'passend').</small></div>
    <div class="field" data-tk-dxf style="display:none"><label for="tk_eenh">Eenheden van de dxf</label><select id="tk_eenh" name="eenheid">${opts([["", "Automatisch (uit het bestand)"], ["mm", "millimeter"], ["cm", "centimeter"], ["m", "meter"]], "")}</select></div>
    <div class="field"><label for="tk_schaal">Tekenschaal (afdruk)</label><select id="tk_schaal" name="schaal">${opts([["50", "1:50"], ["20", "1:20"], ["100", "1:100"]], "50")}</select></div>
    <div class="field"><label for="tk_pap">Papier</label><select id="tk_pap" name="papier">${opts([["A1", "A1"], ["A3", "A3"], ["A2", "A2"], ["A0", "A0"]], "A1")}</select></div>
  </div>`, {
    saveLabel: "Toevoegen",
    onSave: async (d) => {
      const f = $("#tk_file").files[0]; const wp = d.werfplan ? S.werfplannen[d.werfplan] : null;
      if (!f && !wp) { toast("Kies een bestand of een werfplan"); return false; }
      const btn = $("#mform button[type=submit]"); const stap = (t) => { btn.textContent = t; };
      try {
        const nieuw = await tkMaakPlannen(pid, f, wp, d, stap); const n = nieuw.length;
        toast(`${n} plan${n === 1 ? "" : "nen"} toegevoegd`); S.ptab = "tekenen"; render();
        if (n === 1) setTimeout(() => { tkOpen(nieuw[0].id); if (TK && !tkOnSchaal(nieuw[0])) tkSetTool("kalibreren"); }, 60);
      } catch (e) { toast(e.message || String(e), 7000); btn.textContent = "Toevoegen"; return false; }
    },
  });
  const inp = $("#tk_file");
  inp.onchange = async () => {
    const f = inp.files[0]; const info = $("[data-tk-info]"); const isPdf = f && /\.pdf$/i.test(f.name); const isDxf = f && /\.dxf$/i.test(f.name);
    document.querySelectorAll("[data-tk-pdf]").forEach(el => el.style.display = isPdf ? "" : "none"); document.querySelectorAll("[data-tk-dxf]").forEach(el => el.style.display = isDxf ? "" : "none");
    if (f && !$("#tk_naam").value) $("#tk_naam").value = f.name.replace(/\.[^.]+$/, "");
    if (f && /\.dwg$/i.test(f.name)) info.textContent = "DWG kan de browser niet lezen: bewaar het plan als DXF (Vectorworks: Exporteren › DXF/DWG, formaat DXF) of zet het om met de ODA File Converter.";
    if (isPdf) { try { const pdfjs = await loadPdfJs(); const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise; const pg = await doc.getPage(1); const v = pg.getViewport({ scale: 1 });
      info.textContent = `${doc.numPages} pagina${doc.numPages === 1 ? "" : "'s"} · ${tkPapierNaam(v.width * TK_PT_MM, v.height * TK_PT_MM)} (${Math.round(v.width * TK_PT_MM)} × ${Math.round(v.height * TK_PT_MM)} mm)`; } catch (e) { info.textContent = "Pdf niet leesbaar: " + e.message; } }
  };
}
function tkPapierNaam(w, h) {
  const [a, b] = [Math.max(w, h), Math.min(w, h)];
  const fmt = [["A0", 1189, 841], ["A1", 841, 594], ["A2", 594, 420], ["A3", 420, 297], ["A4", 297, 210]].find(([, x, y]) => Math.abs(a - x) < 6 && Math.abs(b - y) < 6);
  return fmt ? fmt[0] : "eigen formaat";
}
function tkPaginas(txt, max) {
  const t = String(txt || "1").trim().toLowerCase(); if (!t || t === "alle") return Array.from({ length: max }, (_, i) => i + 1);
  const out = new Set(); t.split(/[,; ]+/).forEach(part => { const m = part.match(/^(\d+)(?:-(\d+))?$/); if (!m) return; const a = +m[1], b = m[2] ? +m[2] : a; for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= max) out.add(i); });
  return [...out].sort((a, b) => a - b);
}
async function tkUpload(path, blob, type) {
  const { error } = await sb.storage.from("werf").upload(path, blob, { contentType: type, upsert: false });
  if (error) throw new Error("Upload mislukt: " + error.message);
  return sb.storage.from("werf").getPublicUrl(path).data.publicUrl;
}
async function tkMaakPlannen(pid, f, wp, d, stap) {
  const base = (d.naam || "").trim() || (f ? f.name.replace(/\.[^.]+$/, "") : wp.naam);
  const common = { project_id: pid, schaal: Number(d.schaal) || 50, papier: d.papier || "A1", created_by: S.me.id, updated_by: S.me.id, lagen: { dekking: 0.55, grijs: true } };
  const n0 = tkPlansOf(pid).length; const ts = Date.now(); const rows = [];
  if (!f && wp) {
    rows.push({ ...common, naam: base, volgorde: n0 + 1, onderlegger: { soort: "beeld", url: wp.url, w: wp.w, h: wp.h, werfplan_id: wp.id, bestand: wp.naam }, kalibratie: { s: 1, rot: 0, tx: 0, ty: 0 } });
  } else if (/\.pdf$/i.test(f.name) || /pdf$/i.test(f.type)) {
    stap("Pdf lezen…");
    const pdfjs = await loadPdfJs(); const buf = await f.arrayBuffer(); const doc = await pdfjs.getDocument({ data: buf.slice(0) }).promise;
    const pages = tkPaginas(d.paginas, Math.min(doc.numPages, 20)); if (!pages.length) throw new Error("Geen geldige pagina gekozen (1–" + doc.numPages + ").");
    stap("Pdf uploaden…");
    const pdfPath = `${pid}/tekenen/${ts}-origineel.pdf`; const pdfUrl = await tkUpload(pdfPath, new Blob([buf], { type: "application/pdf" }), "application/pdf");
    const N = Number(d.pdf_schaal) || 0;
    for (const nr of pages) {
      stap(`Pagina ${nr} omzetten…`);
      const page = await doc.getPage(nr); const v1 = page.getViewport({ scale: 1 }); const sc = TK_BEELD_MAX / Math.max(v1.width, v1.height); const vp = page.getViewport({ scale: sc });
      const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height); const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.85)); c.width = c.height = 1;
      stap(`Pagina ${nr} uploaden…`);
      const bPath = `${pid}/tekenen/${ts}-p${nr}.jpg`; const bUrl = await tkUpload(bPath, blob, "image/jpeg");
      const w = Math.round(vp.width), h = Math.round(vp.height);
      const kal = N ? { s: v1.width * TK_PT_MM / w * N, rot: 0, tx: 0, ty: 0, bron: "pdf-schaal", pdf_schaal: N } : { s: v1.width * TK_PT_MM / w * 50, rot: 0, tx: 0, ty: 0 };
      rows.push({ ...common, naam: pages.length > 1 ? `${base} · p${nr}` : base, volgorde: n0 + rows.length + 1,
        onderlegger: { soort: "pdf", path: pdfPath, url: pdfUrl, pagina: nr, pw: v1.width, ph: v1.height, w, h, beeld_path: bPath, beeld_url: bUrl, bestand: f.name, papier_pdf: tkPapierNaam(v1.width * TK_PT_MM, v1.height * TK_PT_MM) }, kalibratie: kal });
    }
  } else if (/\.dxf$/i.test(f.name)) {
    stap("Dxf lezen…");
    const txt = await f.text(); const dx = tkDxfLees(txt); if (!dx.prims.lijnen.length && !dx.prims.teksten.length) throw new Error("Geen tekening gevonden in de dxf.");
    const eenh = d.eenheid || dx.eenheid || "mm"; const fac = { mm: 1, cm: 10, m: 1000 }[eenh] || 1;
    stap("Dxf uploaden…");
    const path = `${pid}/tekenen/${ts}.dxf`; const url = await tkUpload(path, new Blob([txt], { type: "application/octet-stream" }), "application/octet-stream");
    const thumb = await tkDxfThumb(dx); const tPath = `${pid}/tekenen/${ts}-thumb.png`; const tUrl = await tkUpload(tPath, thumb, "image/png");
    rows.push({ ...common, naam: base, volgorde: n0 + 1, onderlegger: { soort: "dxf", path, url, thumb_path: tPath, thumb_url: tUrl, eenheid: eenh, bbox: dx.bbox, bestand: f.name }, kalibratie: { s: fac, rot: 0, tx: 0, ty: 0, bron: "dxf-eenheden" } });
  } else {
    stap("Afbeelding omzetten…");
    const r = await fotoVerklein(f, TK_BEELD_MAX, 0.88); const bPath = `${pid}/tekenen/${ts}.jpg`; const bUrl = await tkUpload(bPath, r.blob, "image/jpeg");
    rows.push({ ...common, naam: base, volgorde: n0 + 1, onderlegger: { soort: "beeld", beeld_path: bPath, beeld_url: bUrl, url: bUrl, w: r.w, h: r.h, bestand: f.name }, kalibratie: { s: 1, rot: 0, tx: 0, ty: 0 } });
  }
  stap("Bewaren…");
  const { data, error } = await sb.from("tekenplannen").insert(rows).select(); if (error) throw new Error("Bewaren mislukt: " + error.message);
  (data || []).forEach(r => S.tekenplannen[r.id] = r);
  return data || [];
}
async function tkVerwijder(pl) {
  await dbDelete("tekenplannen", pl.id);
  const o = pl.onderlegger || {}; const paden = [o.beeld_path, o.thumb_path];
  if (o.path && !Object.values(S.tekenplannen).some(x => x.id !== pl.id && x.onderlegger?.path === o.path)) paden.push(o.path);
  const weg = paden.filter(Boolean); if (weg.length) sb.storage.from("werf").remove(weg).catch(() => { });
}

/* ---------- dxf lezen: alles naar polylijnen + teksten (in dxf-eenheden) ---------- */
function tkDxfLees(txt) {
  if (!window.DxfParser) throw new Error("Dxf-lezer niet geladen — herlaad de pagina.");
  const P = window.DxfParser.default || window.DxfParser; let dxf;
  try { dxf = new P().parseSync(txt); } catch (e) { throw new Error("Dxf niet leesbaar: " + (e.message || e)); }
  const eenheid = { 4: "mm", 5: "cm", 6: "m" }[dxf.header && dxf.header.$INSUNITS] || "";
  const lijnen = [], teksten = [], punten = []; const blocks = dxf.blocks || {};
  const bb = [Infinity, Infinity, -Infinity, -Infinity];
  const T = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const add = (m, pts, gesloten) => { if (pts.length < 4) return; const o = []; for (let i = 0; i < pts.length; i += 2) { const q = T(m, pts[i], pts[i + 1]); o.push(q[0], q[1]); if (q[0] < bb[0]) bb[0] = q[0]; if (q[1] < bb[1]) bb[1] = q[1]; if (q[0] > bb[2]) bb[2] = q[0]; if (q[1] > bb[3]) bb[3] = q[1]; } if (gesloten) o.push(o[0], o[1]); lijnen.push(o); };
  const key = (m, x, y) => { const q = T(m, x, y); punten.push(q[0], q[1]); };
  const boog = (cx, cy, r, a0, a1) => { let da = a1 - a0; while (da <= 0) da += Math.PI * 2; const n = Math.max(6, Math.min(96, Math.ceil(da / (Math.PI / 24)))); const o = []; for (let i = 0; i <= n; i++) { const a = a0 + da * i / n; o.push(cx + r * Math.cos(a), cy + r * Math.sin(a)); } return o; };
  const ocs = (e) => (e.extrusionDirectionZ ?? e.extrusionDirection?.z ?? 1) < 0;   // gespiegeld objectassenstelsel
  // bulge = tan(θ/4): een boog van θ (tegen de klok in als bulge > 0) tussen twee opeenvolgende hoekpunten
  const bulgePts = (vs, gesloten) => { const o = []; const n = vs.length; for (let i = 0; i < n; i++) { const a = vs[i], b = vs[(i + 1) % n]; o.push(a.x, a.y); if ((i < n - 1 || gesloten) && a.bulge) { const th = 4 * Math.atan(a.bulge); const dx = b.x - a.x, dy = b.y - a.y, c = Math.hypot(dx, dy); if (c > 0) { const R = c / (2 * Math.abs(Math.sin(th / 2))); const h = (c / 2) / Math.tan(th / 2); const cx = (a.x + b.x) / 2 - dy / c * h, cy = (a.y + b.y) / 2 + dx / c * h; const s0 = Math.atan2(a.y - cy, a.x - cx); const steps = Math.max(4, Math.ceil(Math.abs(th) / (Math.PI / 24))); for (let k = 1; k < steps; k++) { const an = s0 + th * k / steps; o.push(cx + R * Math.cos(an), cy + R * Math.sin(an)); } } } } return o; };
  const walk = (ents, m, diepte) => {
    if (diepte > 6) return;
    for (const e of ents || []) {
      try {
        const mo = ocs(e) ? mul(m, [-1, 0, 0, 1, 0, 0]) : m;
        switch (e.type) {
          case "LINE": add(m, [e.vertices[0].x, e.vertices[0].y, e.vertices[1].x, e.vertices[1].y]); key(m, e.vertices[0].x, e.vertices[0].y); key(m, e.vertices[1].x, e.vertices[1].y); break;
          case "LWPOLYLINE": case "POLYLINE": { const vs = (e.vertices || []).filter(v => v && isFinite(v.x)); if (vs.length < 2) break; const g = !!(e.shape || e.closed); add(mo, bulgePts(vs, g), g); vs.forEach(v => key(mo, v.x, v.y)); break; }
          case "CIRCLE": add(mo, boog(e.center.x, e.center.y, e.radius, 0, Math.PI * 2)); key(mo, e.center.x, e.center.y); break;
          case "ARC": { const pts = boog(e.center.x, e.center.y, e.radius, e.startAngle, e.endAngle); add(mo, pts); key(mo, pts[0], pts[1]); key(mo, pts[pts.length - 2], pts[pts.length - 1]); key(mo, e.center.x, e.center.y); break; }
          case "ELLIPSE": { const mx = e.majorAxisEndPoint.x, my = e.majorAxisEndPoint.y; const ra = Math.hypot(mx, my), rb = ra * e.axisRatio, rot = Math.atan2(my, mx); let a0 = e.startAngle || 0, a1 = e.endAngle ?? Math.PI * 2; let da = a1 - a0; while (da <= 0) da += Math.PI * 2; const n = 48, o = []; for (let i = 0; i <= n; i++) { const t = a0 + da * i / n; const x = ra * Math.cos(t), y = rb * Math.sin(t); o.push(e.center.x + x * Math.cos(rot) - y * Math.sin(rot), e.center.y + x * Math.sin(rot) + y * Math.cos(rot)); } add(mo, o); break; }
          case "SPLINE": { const vs = (e.fitPoints && e.fitPoints.length > 1 ? e.fitPoints : e.controlPoints) || []; if (vs.length > 1) add(m, vs.flatMap(v => [v.x, v.y])); break; }
          case "SOLID": case "3DFACE": { const vs = (e.points || e.vertices || []).filter(Boolean); if (vs.length > 2) add(m, vs.flatMap(v => [v.x, v.y]), true); break; }
          case "TEXT": case "MTEXT": case "ATTDEF": {
            const pos = e.startPoint || e.position; if (!pos) break; let t = String(e.text || "");
            if (e.type === "MTEXT") t = t.replace(/\\P/g, " ").replace(/\\[A-Za-z][^;\\]*;/g, "").replace(/[{}]/g, "").replace(/\\~/g, " ");
            if (!t.trim()) break; const q = T(m, pos.x, pos.y); const sc = Math.hypot(m[0], m[1]);
            const det = m[0] * m[3] - m[1] * m[2];   // gespiegeld blok: tekst leesbaar houden (zoals MIRRTEXT = 0)
            teksten.push({ x: q[0], y: q[1], h: (e.textHeight || e.height || 2.5) * sc, t: t.slice(0, 200), rot: (e.rotation || 0) + (det < 0 ? Math.atan2(-m[1], -m[0]) : Math.atan2(m[1], m[0])) * 180 / Math.PI }); break; }
          case "INSERT": case "DIMENSION": {
            const b = blocks[e.type === "INSERT" ? e.name : e.block]; if (!b || !b.entities) break;
            if (e.type === "DIMENSION") { walk(b.entities, m, diepte + 1); break; }
            const r = (e.rotation || 0) * Math.PI / 180, sx = e.xScale ?? 1, sy = e.yScale ?? 1, bp = b.position || { x: 0, y: 0 };
            const cols = Math.min(e.columnCount || 1, 50), rows = Math.min(e.rowCount || 1, 50);
            for (let ci = 0; ci < cols; ci++) for (let ri = 0; ri < rows; ri++) {
              const ox = ci * (e.columnSpacing || 0), oy = ri * (e.rowSpacing || 0);
              const loc = [Math.cos(r) * sx, Math.sin(r) * sx, -Math.sin(r) * sy, Math.cos(r) * sy, 0, 0];
              const tr = [1, 0, 0, 1, e.position.x + Math.cos(r) * ox - Math.sin(r) * oy, e.position.y + Math.sin(r) * ox + Math.cos(r) * oy];
              const m2 = mul(mo, mul(tr, mul(loc, [1, 0, 0, 1, -bp.x, -bp.y])));
              walk(b.entities, m2, diepte + 1);
            }
            break; }
        }
      } catch (err) { /* één kapotte entiteit mag de rest niet tegenhouden */ }
    }
  };
  walk(dxf.entities, [1, 0, 0, 1, 0, 0], 0);
  const bbox = isFinite(bb[0]) ? bb : [0, 0, 1000, 1000];
  return { eenheid, bbox, prims: { lijnen, teksten, punten } };
}
function tkDxfPad(prims) { const p = new Path2D(); for (const l of prims.lijnen) { p.moveTo(l[0], l[1]); for (let i = 2; i < l.length; i += 2) p.lineTo(l[i], l[i + 1]); } return p; }
async function tkDxfThumb(dx) {
  const [x0, y0, x1, y1] = dx.bbox; const W = 1200, H = 900; const k = Math.min(W / (x1 - x0 || 1), H / (y1 - y0 || 1)) * 0.92;
  const c = document.createElement("canvas"); c.width = W; c.height = H; const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  ctx.setTransform(k, 0, 0, -k, W / 2 - (x0 + x1) / 2 * k, H / 2 + (y0 + y1) / 2 * k); ctx.lineWidth = 1 / k; ctx.strokeStyle = "#333"; ctx.stroke(tkDxfPad(dx.prims));
  return new Promise(r => c.toBlob(r, "image/png"));
}

/* ---------- editor ---------- */
let TK = null;
function tkOpen(id) {
  const pl = S.tekenplannen[id]; if (!pl) return toast("Dit plan bestaat niet meer.");
  tkClose();
  const lg = pl.lagen || {};
  TK = { id, pl, lagen: { zichtbaar: { ...(lg.zichtbaar || {}) }, kleur: { ...(lg.kleur || {}) }, dekking: lg.dekking ?? 0.55, grijs: lg.grijs !== false },
    view: null, tool: "hand", pts: [], mouse: null, snap: null, space: false, drag: null, ol: { status: "laden" }, sharp: null, sharpKey: "", sharpTask: null, pointers: new Map(), meting: null };
  const el = document.createElement("div"); el.id = "tk"; el.className = "tk"; el.innerHTML = tkShell(pl); document.body.appendChild(el); document.documentElement.classList.add("tk-open");
  TK.el = el; TK.cv = el.querySelector("canvas"); TK.ctx = TK.cv.getContext("2d");
  tkBindUi(); tkResize(); tkLoadOnderlegger().then(() => { if (!tkViewRestore()) tkFit(); tkIndexSnap(); tkDraw(); tkSideRender(); });
  TK.ro = new ResizeObserver(() => { tkResize(); tkDraw(); }); TK.ro.observe(el.querySelector(".tk-cw"));
}
function tkClose() {
  if (!TK) return; tkSaveLagen(true); tkViewSave();
  try { TK.ro && TK.ro.disconnect(); } catch (e) { }
  if (TK.sharpTask) try { TK.sharpTask.cancel(); } catch (e) { }
  document.removeEventListener("keydown", tkKey, true); document.removeEventListener("keyup", tkKeyUp, true);
  TK.el.remove(); document.documentElement.classList.remove("tk-open"); TK = null; render();
}
function tkShell(pl) {
  const p = S.projecten[pl.project_id] || {};
  const tools = [["hand", "✋", "Hand — slepen om te verschuiven (H, of spatie ingedrukt)"], ["meten", "📏", "Meten — klik twee punten (M), Shift = recht"], ["kalibreren", "📐", "Kalibreren — klik twee punten met een gekende afstand (K)"]];
  return `<div class="tk-top">
      <button class="btn sm" data-tk="sluit" title="Terug naar het project">← ${esc(p.klant || "Terug")}</button>
      <input class="tk-naam" data-tk-naam value="${esc(pl.naam || "")}" title="Naam van het plan">
      <span class="tk-badges"><span class="pill">${esc(tkSoortTekst[pl.onderlegger?.soort] || "Leeg")}</span><span class="pill" data-tk-schaalpill></span></span>
      <span class="tk-sp"></span><span class="muted tk-save" data-tk-save></span>
      <button class="btn ghost sm" data-tk="hulp" title="Sneltoetsen">?</button>
    </div>
    <div class="tk-main">
      <div class="tk-tools">${tools.map(([k, i, t]) => `<button data-tk-tool="${k}" title="${esc(t)}" aria-pressed="false">${i}</button>`).join("")}
        <hr><button data-tk="fit" title="Passend (F)">⤢</button><button data-tk="in" title="Inzoomen (+)">＋</button><button data-tk="uit" title="Uitzoomen (−)">－</button></div>
      <div class="tk-cw"><canvas></canvas><div class="tk-hint" data-tk-hint></div><div class="tk-dlg" data-tk-dlg hidden></div></div>
      <div class="tk-side" data-tk-side></div>
    </div>
    <div class="tk-status"><span data-tk-xy>—</span><span data-tk-zoom></span><span data-tk-ol></span></div>`;
}
function tkSideRender() {
  if (!TK) return; const pl = TK.pl; const o = pl.onderlegger || {}; const k = pl.kalibratie || {};
  const zb = (l) => TK.lagen.zichtbaar[l] !== false; const kl = (l, d) => TK.lagen.kleur[l] || d;
  TK.el.querySelector("[data-tk-side]").innerHTML = `
    <div class="tk-sec"><div class="tk-h">Lagen</div>${TK_LAGEN.map(([key, naam, d]) => `<label class="tk-laag"><input type="checkbox" data-tk-laag="${key}" ${zb(key) ? "checked" : ""}><span class="tk-dot" style="background:${esc(kl(key, d))}"></span>${esc(naam)}</label>`).join("")}
      <div class="muted" style="font-size:11px;margin-top:4px">De tekenlagen krijgen inhoud vanaf de volgende versie (symbolen en tekst).</div></div>
    <div class="tk-sec"><div class="tk-h">Onderlegger</div>
      <div class="muted" style="font-size:12px;margin-bottom:6px">${esc(o.bestand || "—")}${o.pagina ? " · p" + o.pagina : ""}${o.papier_pdf ? " · " + esc(o.papier_pdf) : ""}</div>
      <label class="tk-row">Dekking <input type="range" min="0.1" max="1" step="0.05" value="${TK.lagen.dekking}" data-tk-dek></label>
      ${o.soort !== "dxf" ? `<label class="tk-row"><input type="checkbox" data-tk-grijs ${TK.lagen.grijs ? "checked" : ""}> in grijstinten</label>` : ""}
      ${o.url && o.soort !== "werfplan" ? `<a class="btn sm" href="${esc(o.url)}" target="_blank" rel="noopener" style="margin-top:6px">Origineel openen ↗</a>` : ""}</div>
    <div class="tk-sec"><div class="tk-h">Schaal</div>
      <div style="font-size:13px;margin-bottom:6px">${tkOnSchaal(pl) ? "✓ " : "⚠ "}${esc(tkBronTekst(pl))}</div>
      ${o.soort === "pdf" ? `<label class="tk-row">Pdf-schaal <select data-tk-pdfschaal>${opts([["", "—"], ...TK_SCHALEN.map(n => [String(n), "1:" + n])], k.bron === "pdf-schaal" ? String(k.pdf_schaal) : "")}</select></label>` : ""}
      <button class="btn sm" data-tk-tool="kalibreren" style="margin-top:6px">Kalibreren met twee punten</button>
      <div class="muted" style="font-size:11px;margin-top:6px">Tip: meet na het kalibreren een tweede gekende maat na met 📏.</div></div>
    <div class="tk-sec"><div class="tk-h">Afdruk</div>
      <label class="tk-row">Tekenschaal <select data-tk-schaal>${opts(TK_SCHALEN.map(n => [String(n), "1:" + n]), String(pl.schaal || 50))}</select></label>
      <label class="tk-row">Papier <select data-tk-papier>${opts(["A0", "A1", "A2", "A3", "A4"].map(x => [x, x]), pl.papier || "A1")}</select></label></div>
    <div class="tk-sec"><button class="btn ghost sm danger" data-tk="verwijder">Plan verwijderen</button></div>`;
  TK.el.querySelector("[data-tk-schaalpill]").textContent = tkOnSchaal(pl) ? tkBronTekst(pl) : "⚠ nog niet op schaal";
  TK.el.querySelector("[data-tk-schaalpill]").className = "pill " + (tkOnSchaal(pl) ? "done" : "vs-open");
  tkToolUi();
}
function tkBindUi() {
  const el = TK.el;
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tk],[data-tk-tool]"); if (!b) return; const a = b.dataset.tk;
    if (b.dataset.tkTool) return tkSetTool(b.dataset.tkTool);
    if (a === "sluit") return tkClose();
    if (a === "fit") { tkFit(); return tkDraw(); }
    if (a === "in" || a === "uit") { const W = TK.W, H = TK.H; tkZoomAt(W / 2, H / 2, a === "in" ? 1.4 : 1 / 1.4); return; }
    if (a === "hulp") return tkHulp();
    if (a === "verwijder") { if (!confirm(`Plan "${TK.pl.naam}" verwijderen? De onderlegger wordt ook verwijderd.`)) return; const pl = TK.pl; tkClose(); tkVerwijder(pl).then(() => toast("Plan verwijderd")).catch(() => { }); return; }
  });
  el.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.tkLaag) { TK.lagen.zichtbaar[t.dataset.tkLaag] = t.checked; tkSaveLagen(); tkDraw(); }
    else if (t.matches("[data-tk-grijs]")) { TK.lagen.grijs = t.checked; TK.sharpKey = ""; tkSaveLagen(); tkDraw(); }
    else if (t.matches("[data-tk-pdfschaal]")) tkZetPdfSchaal(Number(t.value));
    else if (t.matches("[data-tk-schaal]")) tkPlanPatch({ schaal: Number(t.value) });
    else if (t.matches("[data-tk-papier]")) tkPlanPatch({ papier: t.value });
    else if (t.matches("[data-tk-naam]")) { const v = t.value.trim(); if (v && v !== TK.pl.naam) tkPlanPatch({ naam: v }); }
  });
  el.addEventListener("input", (e) => { if (e.target.matches("[data-tk-dek]")) { TK.lagen.dekking = Number(e.target.value); tkSaveLagen(); tkDraw(); } });
  const cv = TK.cv;
  cv.addEventListener("pointerdown", tkDown); cv.addEventListener("pointermove", tkMove); cv.addEventListener("pointerup", tkUp); cv.addEventListener("pointercancel", tkUp);
  cv.addEventListener("pointerleave", () => { if (TK) { TK.mouse = null; tkDraw(); } });
  cv.addEventListener("wheel", tkWheel, { passive: false });
  cv.addEventListener("gesturestart", (e) => { e.preventDefault(); TK.gz = TK.view.z; }); // Safari: knijpen op het trackpad
  cv.addEventListener("gesturechange", (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(); tkZoomAt(e.clientX - r.left, e.clientY - r.top, (TK.gz * e.scale) / TK.view.z); });
  cv.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("keydown", tkKey, true); document.addEventListener("keyup", tkKeyUp, true);
}
function tkResize() {
  const box = TK.el.querySelector(".tk-cw"); const r = box.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
  TK.W = Math.max(50, r.width); TK.H = Math.max(50, r.height); TK.dpr = dpr;
  TK.cv.width = Math.round(TK.W * dpr); TK.cv.height = Math.round(TK.H * dpr); TK.cv.style.width = TK.W + "px"; TK.cv.style.height = TK.H + "px";
  if (!TK.view) TK.view = { cx: 0, cy: 0, z: 0.1 };
  TK.sharpKey = "";
}

/* ---------- transformaties ---------- */
const tkFlip = () => { const s = TK.pl.onderlegger?.soort; return s !== "dxf"; };            // beeld/pdf: y naar beneden
function tkOlToWorld(u, v) { const k = TK.pl.kalibratie || {}; const s = k.s || 1, r = k.rot || 0, c = Math.cos(r), sn = Math.sin(r); const lx = u, ly = tkFlip() ? -v : v; return [(k.tx || 0) + s * (c * lx - sn * ly), (k.ty || 0) + s * (sn * lx + c * ly)]; }
function tkW2S(x, y) { const v = TK.view; return [TK.W / 2 + (x - v.cx) * v.z, TK.H / 2 - (y - v.cy) * v.z]; }
function tkS2W(X, Y) { const v = TK.view; return [v.cx + (X - TK.W / 2) / v.z, v.cy - (Y - TK.H / 2) / v.z]; }
function tkOlMatrix() {   // canvas-matrix van onderlegger-eenheden naar schermpixels (CSS)
  const k = TK.pl.kalibratie || {}; const v = TK.view; const s = k.s || 1, r = k.rot || 0, c = Math.cos(r), sn = Math.sin(r), z = v.z;
  const e = TK.W / 2 + ((k.tx || 0) - v.cx) * z, f = TK.H / 2 - ((k.ty || 0) - v.cy) * z;
  return tkFlip() ? [z * s * c, -z * s * sn, z * s * sn, z * s * c, e, f] : [z * s * c, -z * s * sn, -z * s * sn, -z * s * c, e, f];
}
function tkOlBBox() {   // omhullende van de onderlegger in wereldcoördinaten
  const o = TK.pl.onderlegger || {}; let pts;
  if (o.soort === "dxf") { const b = TK.ol.bbox || o.bbox || [0, 0, 1000, 1000]; pts = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]]; }
  else { const w = o.w || TK.ol.img?.naturalWidth || 1000, h = o.h || TK.ol.img?.naturalHeight || 700; pts = [[0, 0], [w, 0], [w, h], [0, h]]; }
  const ws = pts.map(p => tkOlToWorld(p[0], p[1])); const xs = ws.map(p => p[0]), ys = ws.map(p => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
function tkFit() { const b = tkOlBBox(); const bw = b[2] - b[0] || 1, bh = b[3] - b[1] || 1; TK.view = { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, z: Math.min(TK.W / bw, TK.H / bh) * 0.94 }; TK.sharpKey = ""; }
function tkZoomAt(X, Y, f) { const v = TK.view; const [wx, wy] = tkS2W(X, Y); const z = Math.max(1e-5, Math.min(200, v.z * f)); v.z = z; v.cx = wx - (X - TK.W / 2) / z; v.cy = wy + (Y - TK.H / 2) / z; tkDraw(); tkViewSaveLater(); }
function tkViewSave() { if (!TK || !TK.view) return; try { localStorage.setItem("bros.tk.view." + TK.id, JSON.stringify({ ...TK.view, k: tkKalKey() })); } catch (e) { } }
let tkViewT; function tkViewSaveLater() { clearTimeout(tkViewT); tkViewT = setTimeout(tkViewSave, 600); }
function tkViewRestore() { try { const v = JSON.parse(localStorage.getItem("bros.tk.view." + TK.id) || "null"); if (v && v.k === tkKalKey() && v.z > 0) { TK.view = { cx: v.cx, cy: v.cy, z: v.z }; return true; } } catch (e) { } return false; }
const tkKalKey = () => { const k = TK.pl.kalibratie || {}; return [k.s, k.tx, k.ty, k.rot].map(x => Number(x || 0).toFixed(6)).join("|"); };

/* ---------- onderlegger laden ---------- */
async function tkLoadOnderlegger() {
  const o = TK.pl.onderlegger || {}; const me = TK;
  const zet = (t) => { if (me === TK) { TK.ol.status = t; const s = TK.el.querySelector("[data-tk-ol]"); if (s) s.textContent = t; } };
  try {
    if (o.soort === "dxf") {
      zet("dxf laden…"); if (!window.DxfParser) throw new Error("dxf-lezer ontbreekt");
      const txt = await (await fetch(o.url)).text(); const dx = tkDxfLees(txt); if (me !== TK) return;
      TK.ol.dxf = dx; TK.ol.pad = tkDxfPad(dx.prims); TK.ol.bbox = dx.bbox; zet(`${nl(dx.prims.lijnen.length)} lijnen · ${nl(dx.prims.teksten.length)} teksten`);
    } else if (o.beeld_url || o.url) {
      zet("onderlegger laden…");
      const img = new Image(); img.decoding = "async"; img.src = o.beeld_url || o.url;
      await img.decode().catch(() => new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("afbeelding niet geladen")); }));
      if (me !== TK) return; TK.ol.img = img; zet(o.soort === "pdf" ? "pdf wordt scherp gemaakt bij inzoomen" : `${img.naturalWidth} × ${img.naturalHeight} px`);
      if (o.soort === "pdf" && o.url) tkLoadPdf(o).catch(e => zet("pdf niet geladen — enkel basisbeeld (" + e.message + ")"));
    } else zet("geen onderlegger");
  } catch (e) { zet("onderlegger niet geladen: " + e.message); }
}
async function tkLoadPdf(o) {
  const me = TK; const pdfjs = await loadPdfJs(); const doc = await pdfjs.getDocument({ url: o.url }).promise; const page = await doc.getPage(o.pagina || 1);
  if (me !== TK) return; TK.ol.pdf = doc; TK.ol.page = page; TK.sharpKey = ""; tkDraw();
}
function tkSharpPlan() {   // scherpe weergave van de zichtbare zone rechtstreeks uit de pdf (vector) — pas bij stilstand
  if (!TK || !TK.ol.page) return; const o = TK.pl.onderlegger; const k = TK.pl.kalibratie || {}; if (k.rot) return;
  const z = TK.view.z, s = k.s || 1; const dpr = TK.dpr; const devPerBase = z * s * dpr; if (devPerBase < 1.05) { TK.sharp = null; return; }
  const key = [TK.view.cx, TK.view.cy, z, TK.W, TK.H, s, k.tx, k.ty, TK.lagen.grijs].map(String).join("|"); if (key === TK.sharpKey) return;
  TK.sharpKey = key; TK.sharp = null; clearTimeout(TK.sharpT);
  TK.sharpT = setTimeout(async () => {
    if (!TK || TK.sharpKey !== key) return;
    if (TK.sharpTask) try { TK.sharpTask.cancel(); } catch (e) { }
    const m = tkOlMatrix(); const B = z * s * (o.w / o.pw);
    const vp = TK.ol.page.getViewport({ scale: B * dpr, offsetX: m[4] * dpr, offsetY: m[5] * dpr });
    const c = document.createElement("canvas"); c.width = TK.cv.width; c.height = TK.cv.height; const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    const st = TK.el.querySelector("[data-tk-ol]"); if (st) st.textContent = "scherp maken…";
    const task = TK.ol.page.render({ canvasContext: ctx, viewport: vp }); TK.sharpTask = task;
    try { await task.promise; } catch (e) { return; }
    if (!TK || TK.sharpKey !== key) return; TK.sharp = c; TK.sharpTask = null; if (st) st.textContent = "pdf scherp"; tkDraw(true);
  }, 260);
}

/* ---------- vangen (snap) op punten van de dxf ---------- */
function tkIndexSnap() {
  TK.grid = null; const dx = TK.ol.dxf; if (!dx) return; const pts = dx.prims.punten; const cell = 50 / (TK.pl.kalibratie?.s || 1); const g = new Map();
  for (let i = 0; i < pts.length; i += 2) { const k = Math.floor(pts[i] / cell) + "," + Math.floor(pts[i + 1] / cell); let a = g.get(k); if (!a) g.set(k, a = []); a.push(pts[i], pts[i + 1]); }
  TK.grid = { g, cell };
}
function tkSnap(X, Y) {   // → {x, y, soort} in wereld-mm, of null
  if (!TK.grid || TK.lagen.zichtbaar.onderlegger === false) return null;
  const k = TK.pl.kalibratie || {}; const s = k.s || 1; const [wx, wy] = tkS2W(X, Y);
  // wereld → dxf-eenheden (rot = 0 in fase 1; bij rotatie: inverse)
  const r = k.rot || 0, c = Math.cos(-r), sn = Math.sin(-r); const dx0 = (wx - (k.tx || 0)) / s, dy0 = (wy - (k.ty || 0)) / s; const u = c * dx0 - sn * dy0, v = sn * dx0 + c * dy0;
  const tol = 10 / (TK.view.z * s); const { g, cell } = TK.grid; let best = null, bd = tol * tol;
  const n = Math.ceil(tol / cell); const ci = Math.floor(u / cell), cj = Math.floor(v / cell);
  for (let i = ci - n; i <= ci + n; i++) for (let j = cj - n; j <= cj + n; j++) { const a = g.get(i + "," + j); if (!a) continue; for (let q = 0; q < a.length; q += 2) { const d = (a[q] - u) ** 2 + (a[q + 1] - v) ** 2; if (d < bd) { bd = d; best = [a[q], a[q + 1]]; } } }
  if (!best) return null; const w = tkOlToWorld(best[0], best[1]); return { x: w[0], y: w[1], soort: "eindpunt" };
}
function tkPunt(e, shift) {   // wereldpunt onder de muis, met vangen en Shift = recht
  const r = TK.cv.getBoundingClientRect(); const X = e.clientX - r.left, Y = e.clientY - r.top;
  let sn = tkSnap(X, Y); let [x, y] = sn ? [sn.x, sn.y] : tkS2W(X, Y);
  if (shift && TK.pts.length) { const a = TK.pts[TK.pts.length - 1]; if (Math.abs(x - a[0]) > Math.abs(y - a[1])) y = a[1]; else x = a[0]; sn = null; }
  return { x, y, X, Y, snap: sn };
}

/* ---------- invoer ---------- */
function tkSetTool(t) { if (!TK) return; TK.tool = t; TK.pts = []; TK.meting = null; tkDlg(null); tkToolUi(); tkDraw(); }
function tkToolUi() {
  if (!TK) return; TK.el.querySelectorAll(".tk-tools [data-tk-tool]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tkTool === TK.tool)));
  const hint = { hand: "Slepen = verschuiven · scrollen/knijpen = zoomen · F = passend", meten: "Klik het eerste punt — Shift = recht, Esc = stoppen", kalibreren: "Klik het begin van een gekende maat (bv. een maatlijn of een muur)" }[TK.tool];
  const h = TK.el.querySelector("[data-tk-hint]"); if (h) h.textContent = TK.pts.length && TK.tool === "kalibreren" ? "Klik het einde van de gekende maat" : TK.pts.length && TK.tool === "meten" ? "Klik het tweede punt" : hint;
  TK.cv.style.cursor = TK.tool === "hand" || TK.space ? "grab" : "crosshair";
}
function tkDown(e) {
  if (!TK || TK.dlgOpen) return; TK.cv.setPointerCapture(e.pointerId); TK.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (TK.pointers.size === 2) { const [a, b] = [...TK.pointers.values()]; TK.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; TK.drag = null; return; }
  if (e.button === 1 || e.button === 2 || TK.tool === "hand" || TK.space) { TK.drag = { x: e.clientX, y: e.clientY, cx: TK.view.cx, cy: TK.view.cy }; TK.cv.style.cursor = "grabbing"; return; }
  if (e.button !== 0) return;
  const p = tkPunt(e, e.shiftKey);
  if (TK.tool === "meten") { if (TK.pts.length >= 2) TK.pts = []; TK.pts.push([p.x, p.y]); if (TK.pts.length === 2) TK.meting = tkAfstand(TK.pts[0], TK.pts[1]); tkToolUi(); tkDraw(); }
  else if (TK.tool === "kalibreren") { TK.pts.push([p.x, p.y]); tkToolUi(); tkDraw(); if (TK.pts.length === 2) tkKalibreerDlg(); }
}
function tkMove(e) {
  if (!TK) return; if (TK.pointers.has(e.pointerId)) TK.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (TK.pinch && TK.pointers.size === 2) { const [a, b] = [...TK.pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; const r = TK.cv.getBoundingClientRect();
    TK.view.cx -= (mx - TK.pinch.mx) / TK.view.z; TK.view.cy += (my - TK.pinch.my) / TK.view.z; tkZoomAt(mx - r.left, my - r.top, d / TK.pinch.d); TK.pinch = { d, mx, my }; return; }
  if (TK.drag) { TK.view.cx = TK.drag.cx - (e.clientX - TK.drag.x) / TK.view.z; TK.view.cy = TK.drag.cy + (e.clientY - TK.drag.y) / TK.view.z; tkDraw(); return; }
  const p = tkPunt(e, e.shiftKey); TK.mouse = p;
  const xy = TK.el.querySelector("[data-tk-xy]"); if (xy) xy.textContent = `X ${nl(Math.round(p.x))}  ·  Y ${nl(Math.round(p.y))} mm${p.snap ? "  ·  ▪ eindpunt" : ""}`;
  tkDraw();
}
function tkUp(e) {
  if (!TK) return; TK.pointers.delete(e.pointerId); if (TK.pointers.size < 2) TK.pinch = null;
  if (TK.drag) { TK.drag = null; tkToolUi(); tkViewSaveLater(); tkDraw(); }
}
function tkWheel(e) {
  e.preventDefault(); if (!TK) return; const r = TK.cv.getBoundingClientRect(); const X = e.clientX - r.left, Y = e.clientY - r.top;
  const lijnen = e.deltaMode === 1; const muis = lijnen || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50);
  if (e.ctrlKey || e.metaKey) tkZoomAt(X, Y, Math.exp(-e.deltaY * 0.01));
  else if (muis) tkZoomAt(X, Y, e.deltaY < 0 ? 1.2 : 1 / 1.2);
  else { TK.view.cx += e.deltaX / TK.view.z; TK.view.cy -= e.deltaY / TK.view.z; tkDraw(); tkViewSaveLater(); }
}
function tkKey(e) {
  if (!TK) return; if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) { if (e.key === "Escape") document.activeElement.blur(); return; }
  if ($("#modalBg")?.classList.contains("show")) return;
  const k = e.key;
  if (k === " ") { if (!TK.space) { TK.space = true; tkToolUi(); } e.preventDefault(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (k === "Escape") { if (TK.dlgOpen) { tkDlg(null); TK.pts = []; } else if (TK.pts.length || TK.meting) { TK.pts = []; TK.meting = null; } else if (TK.tool !== "hand") TK.tool = "hand"; tkToolUi(); tkDraw(); e.preventDefault(); return; }
  if (TK.dlgOpen) return;
  const map = { h: "hand", m: "meten", k: "kalibreren" }; if (map[k.toLowerCase()]) { tkSetTool(map[k.toLowerCase()]); e.preventDefault(); return; }
  if (k === "f" || k === "F") { tkFit(); tkDraw(); e.preventDefault(); return; }
  if (k === "+" || k === "=") { tkZoomAt(TK.W / 2, TK.H / 2, 1.4); e.preventDefault(); return; }
  if (k === "-" || k === "_") { tkZoomAt(TK.W / 2, TK.H / 2, 1 / 1.4); e.preventDefault(); return; }
  if (k === "?") { tkHulp(); e.preventDefault(); }
}
function tkKeyUp(e) { if (TK && e.key === " ") { TK.space = false; tkToolUi(); } }
const tkAfstand = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/* ---------- kalibreren ---------- */
function tkDlg(html) {
  const d = TK.el.querySelector("[data-tk-dlg]"); if (!html) { d.hidden = true; d.innerHTML = ""; TK.dlgOpen = false; return; }
  d.innerHTML = html; d.hidden = false; TK.dlgOpen = true; setTimeout(() => d.querySelector("input")?.focus(), 20);
}
function tkKalibreerDlg() {
  const [a, b] = TK.pts; const d = tkAfstand(a, b); const hoek = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
  tkDlg(`<div class="tk-h">Kalibreren</div><div class="muted" style="font-size:12px;margin-bottom:8px">Nu gemeten: <b class="num">${nl(Math.round(d))} mm</b> (hoek ${Math.round(hoek)}°). Wat is de werkelijke afstand?</div>
    <form data-tk-kal><label class="tk-row">Werkelijk <input name="mm" type="number" min="1" step="any" inputmode="decimal" placeholder="bv. 3400" required style="width:120px"> mm</label>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button type="button" class="btn sm" data-tk-kal-nee>Annuleren</button><button class="btn sm primary">Toepassen</button></div></form>`);
  const f = TK.el.querySelector("[data-tk-kal]");
  f.onsubmit = (e) => { e.preventDefault(); const mm = Number(String(f.mm.value).replace(",", ".")); if (!(mm > 0)) return; tkKalibreer(a, b, mm); };
  TK.el.querySelector("[data-tk-kal-nee]").onclick = () => { tkDlg(null); TK.pts = []; tkToolUi(); tkDraw(); };
}
function tkKalibreer(a, b, mm) {
  const d = tkAfstand(a, b); if (!(d > 0)) return; const f = mm / d; const k = { ...(TK.pl.kalibratie || {}) };
  // schalen rond punt a: a blijft op zijn plaats
  k.s = (k.s || 1) * f; k.tx = a[0] + f * ((k.tx || 0) - a[0]); k.ty = a[1] + f * ((k.ty || 0) - a[1]);
  k.bron = "twee-punten"; k.controle_mm = mm; k.datum = todayIso; delete k.pdf_schaal;
  // beeld blijft op dezelfde plek op het scherm
  const [vx, vy] = [TK.view.cx, TK.view.cy]; TK.view.cx = a[0] + f * (vx - a[0]); TK.view.cy = a[1] + f * (vy - a[1]); TK.view.z = TK.view.z / f;
  tkDlg(null); TK.pts = []; TK.tool = "meten"; tkPlanPatch({ kalibratie: k }); tkIndexSnap(); TK.sharpKey = "";
  toast(`Gekalibreerd: ${nl(Math.round(d))} → ${nl(mm)} mm (factor ${f.toFixed(4)}). Meet nu een tweede maat ter controle.`, 6000);
  tkSideRender(); tkDraw();
}
function tkZetPdfSchaal(N) {
  const o = TK.pl.onderlegger || {}; if (!N || !o.pw || !o.w) return;
  const k = { s: o.pw * TK_PT_MM / o.w * N, rot: 0, tx: 0, ty: 0, bron: "pdf-schaal", pdf_schaal: N };
  tkPlanPatch({ kalibratie: k }); tkFit(); tkIndexSnap(); tkSideRender(); tkDraw(); toast(`Pdf op schaal 1:${N} gezet`);
}

/* ---------- bewaren ---------- */
async function tkPlanPatch(patch) {
  if (!TK) return; const id = TK.id; Object.assign(TK.pl, patch); const s = TK.el.querySelector("[data-tk-save]"); if (s) s.textContent = "bewaren…";
  try { await dbUpdate("tekenplannen", id, { ...patch, updated_by: S.me.id, updated_at: new Date().toISOString() }); if (TK && TK.id === id) { TK.pl = { ...S.tekenplannen[id] }; if (s) s.textContent = "bewaard"; } }
  catch (e) { if (s) s.textContent = "niet bewaard"; }
}
let tkLagenT;
function tkSaveLagen(nu) {
  if (!TK) return; clearTimeout(tkLagenT); const id = TK.id, val = { zichtbaar: { ...TK.lagen.zichtbaar }, kleur: { ...TK.lagen.kleur }, dekking: TK.lagen.dekking, grijs: TK.lagen.grijs };
  const doe = () => { if (JSON.stringify(S.tekenplannen[id]?.lagen || {}) === JSON.stringify(val)) return; sb.from("tekenplannen").update({ lagen: val }).eq("id", id).then(({ error }) => { if (!error && S.tekenplannen[id]) S.tekenplannen[id].lagen = val; }); };
  if (nu) doe(); else tkLagenT = setTimeout(doe, 900);
}

/* ---------- tekenen ---------- */
let tkRaf = 0;
function tkDraw(nu) { if (!TK) return; if (nu) { cancelAnimationFrame(tkRaf); tkRaf = 0; return tkPaint(); } if (!tkRaf) tkRaf = requestAnimationFrame(() => { tkRaf = 0; tkPaint(); }); }
function tkPaint() {
  if (!TK) return; const ctx = TK.ctx, dpr = TK.dpr, W = TK.W, H = TK.H; const o = TK.pl.onderlegger || {};
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  if (TK.lagen.zichtbaar.onderlegger !== false) {
    ctx.save(); ctx.globalAlpha = TK.lagen.dekking;
    const grijs = TK.lagen.grijs && o.soort !== "dxf" && "filter" in ctx; if (grijs) ctx.filter = "grayscale(1)";
    const m = tkOlMatrix();
    if (TK.ol.img) {
      tkSharpPlan();
      if (TK.sharp) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(TK.sharp, 0, 0); }
      else { ctx.setTransform(m[0] * dpr, m[1] * dpr, m[2] * dpr, m[3] * dpr, m[4] * dpr, m[5] * dpr); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; ctx.drawImage(TK.ol.img, 0, 0, o.w || TK.ol.img.naturalWidth, o.h || TK.ol.img.naturalHeight); }
    } else if (TK.ol.pad) {
      ctx.setTransform(m[0] * dpr, m[1] * dpr, m[2] * dpr, m[3] * dpr, m[4] * dpr, m[5] * dpr);
      const sc = Math.hypot(m[0], m[1]); ctx.lineWidth = 1 / sc; ctx.strokeStyle = TK.lagen.kleur.onderlegger || "#3A3A3C"; ctx.stroke(TK.ol.pad);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = TK.lagen.kleur.onderlegger || "#3A3A3C";
      for (const t of TK.ol.dxf.prims.teksten) { const hpx = t.h * sc; if (hpx < 4 || hpx > 400) continue; const w = tkOlToWorld(t.x, t.y); const [X, Y] = tkW2S(w[0], w[1]); if (X < -500 || Y < -200 || X > W + 50 || Y > H + 200) continue;
        ctx.save(); ctx.translate(X, Y); ctx.rotate(-(t.rot || 0) * Math.PI / 180 - (TK.pl.kalibratie?.rot || 0)); ctx.font = `${hpx}px -apple-system, Arial, sans-serif`; ctx.fillText(t.t, 0, 0); ctx.restore(); }
    }
    ctx.restore();
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  tkPaintMeting(ctx);
  if (TK.mouse && TK.mouse.snap) { const [X, Y] = tkW2S(TK.mouse.snap.x, TK.mouse.snap.y); ctx.strokeStyle = "#0071E3"; ctx.lineWidth = 1.5; ctx.strokeRect(X - 5, Y - 5, 10, 10); }
  tkPaintSchaalbalk(ctx);
  const zs = TK.el.querySelector("[data-tk-zoom]"); if (zs) { const N = 1 / (TK.view.z * 0.2646); zs.textContent = `scherm ≈ 1:${N >= 10 ? Math.round(N) : N.toFixed(1)}`; }
}
function tkPaintMeting(ctx) {
  if (TK.tool !== "meten" && TK.tool !== "kalibreren") return; const pts = TK.pts.slice(); if (!pts.length) return;
  if (pts.length === 1 && TK.mouse) pts.push([TK.mouse.x, TK.mouse.y]); if (pts.length < 2) return;
  const [a, b] = pts; const A = tkW2S(a[0], a[1]), B = tkW2S(b[0], b[1]); const kal = TK.tool === "kalibreren";
  ctx.save(); ctx.strokeStyle = kal ? "#0071E3" : "#D42A20"; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 1.5; if (kal) ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke(); ctx.setLineDash([]);
  const tick = (P) => { const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1; const nx = -dy / L * 6, ny = dx / L * 6; ctx.beginPath(); ctx.moveTo(P[0] - nx, P[1] - ny); ctx.lineTo(P[0] + nx, P[1] + ny); ctx.stroke(); };
  tick(A); tick(B);
  const d = tkAfstand(a, b); const txt = `${nl(Math.round(d))} mm`; const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
  ctx.font = "600 13px -apple-system, Arial, sans-serif"; const tw = ctx.measureText(txt).width;
  ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.fillRect(mx - tw / 2 - 5, my - 22, tw + 10, 18); ctx.fillStyle = kal ? "#0071E3" : "#D42A20"; ctx.textAlign = "center"; ctx.fillText(txt, mx, my - 8);
  ctx.restore();
}
function tkPaintSchaalbalk(ctx) {   // schaalbalk linksonder: 1, 2, 5 × 10ⁿ mm
  const z = TK.view.z; const doel = 120 / z; const p = Math.pow(10, Math.floor(Math.log10(doel))); const m = [1, 2, 5, 10].map(f => f * p).filter(v => v <= doel).pop() || p; const L = m * z;
  const x = 14, y = TK.H - 16; ctx.save(); ctx.strokeStyle = "#1D1D1F"; ctx.fillStyle = "#1D1D1F"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x, y); ctx.lineTo(x + L, y); ctx.lineTo(x + L, y - 5); ctx.stroke();
  ctx.font = "11px -apple-system, Arial, sans-serif"; ctx.fillText(m >= 1000 ? `${nl(m / 1000)} m` : `${nl(m)} mm`, x + 4, y - 7); ctx.restore();
}
function tkHulp() {
  tkDlg(`<div class="tk-h">Sneltoetsen</div><table class="tk-keys">
    <tr><td>H</td><td>Hand (verschuiven)</td></tr><tr><td>spatie + slepen</td><td>verschuiven vanuit elk gereedschap</td></tr>
    <tr><td>M</td><td>Meten — Shift = horizontaal/verticaal</td></tr><tr><td>K</td><td>Kalibreren met twee punten</td></tr>
    <tr><td>F</td><td>Passend in beeld</td></tr><tr><td>+ / −</td><td>Zoomen</td></tr><tr><td>Esc</td><td>Stoppen / terug naar Hand</td></tr>
    <tr><td>trackpad</td><td>twee vingers = verschuiven, knijpen = zoomen</td></tr><tr><td>muiswiel</td><td>zoomen rond de cursor</td></tr></table>
    <div style="text-align:right;margin-top:8px"><button class="btn sm" data-tk-dlg-ok>OK</button></div>`);
  TK.el.querySelector("[data-tk-dlg-ok]").onclick = () => tkDlg(null);
}
