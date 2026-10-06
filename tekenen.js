/* =====================================================================
   BROS Planbord — Tekenmodule (tabblad Plannen op de projectfiche)
   Fase 1 (v1.31): onderlegger (pdf / afbeelding / dxf) op schaal, zoom en pan, lagen, meten en kalibreren.
   Fase 2 (v1.32): techniekenlaag — symbolen, labels (kring, hoogte), tekst met pijl, leidingen, schakelverbindingen,
           maatlijnen, selecteren/bewerken met Vectorworks-sneltoetsen, ongedaan maken, live samenwerken,
           bladen (Technieken / ELEK / HVAC) met titelblok en legende, vectorpdf. Zie het blok FASE 2 onderaan.

   Coördinaten: wereld = millimeter, y naar boven (zoals in CAD).
   Onderlegger → wereld:  w = t + s · R(rot) · (u, ±v)    (± : beeld/pdf heeft y naar beneden, dxf naar boven)
   Wereld → scherm:       X = W/2 + (x − cx)·z,  Y = H/2 − (y − cy)·z   (z = schermpixels per mm)
   Nodig: databasescript 030 (zelfde inhoud als het vroegere 028_tekenen).
   ===================================================================== */
const TK_LAGEN = [
  ["onderlegger", "Onderlegger", "#8E8E93"],
  ["bestaand", "Bestaand", "#1F5FD6"],
  ["afbraak", "Afbraak", "#D42A20"],
  ["nieuw", "Nieuw", "#1D1D1F"],
  ["elektro", "Elektro", "#D42A20"],
  ["verlichting", "Verlichting", "#D42A20"],
  ["sanitair", "Sanitair", "#1F5FD6"],
  ["hvac", "HVAC / ventilatie", "#2E9E4F"],
  ["tekst", "Tekst", "#1D1D1F"],
  ["maatvoering", "Maatvoering", "#D42A20"],
];
const TK_PT_MM = 25.4 / 72;                 // 1 pdf-punt in mm
const TK_BEELD_MAX = 4800;                  // langste zijde van de basisafbeelding (onder de canvaslimiet van iPad/iPhone)
const TK_SCHALEN = [10, 20, 25, 50, 100, 200, 500];
const tkOk = () => schemaV() >= 30;
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
  if (!tkOk()) return SCHEMA_HINT(30);
  const pls = tkPlansOf(p.id);
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Plannen</h3><div class="muted" style="font-size:12px;margin-top:2px">Tekenmodule — zet een plan van de architect (pdf, dxf, foto) op schaal en teken er de technieken op: symbolen, leidingen, tekst en maten; bladen ELEK/HVAC als pdf met titelblok en legende.</div></div><div class="actions"><button class="btn sm primary" data-act="tk-new" data-pid="${p.id}">+ Plan</button></div></div>
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
    // de bucket 'werf' aanvaardt max. 25 MB per bestand (script 031): een grotere pdf bewaren we niet als origineel;
    // het plan werkt dan met de basisafbeelding (4800 px), zonder scherpe weergave bij inzoomen
    let pdfPath = null, pdfUrl = null;
    if (buf.byteLength <= 24 * 1024 * 1024) { stap("Pdf uploaden…"); pdfPath = `${pid}/tekenen/${ts}-origineel.pdf`; pdfUrl = await tkUpload(pdfPath, new Blob([buf], { type: "application/pdf" }), "application/pdf"); }
    else toast(`De pdf is ${Math.round(buf.byteLength / 1048576)} MB (max. 24 MB): het plan wordt bewaard zonder origineel — inzoomen blijft wat minder scherp. Tip: exporteer enkel de nodige bladen.`, 8000);
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
/* ---------- invoer ---------- */
function tkWheel(e) {
  e.preventDefault(); if (!TK) return; const r = TK.cv.getBoundingClientRect(); const X = e.clientX - r.left, Y = e.clientY - r.top;
  const lijnen = e.deltaMode === 1; const muis = lijnen || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50);
  if (e.ctrlKey || e.metaKey) tkZoomAt(X, Y, Math.exp(-e.deltaY * 0.01));
  else if (muis) tkZoomAt(X, Y, e.deltaY < 0 ? 1.2 : 1 / 1.2);
  else { TK.view.cx += e.deltaX / TK.view.z; TK.view.cy -= e.deltaY / TK.view.z; tkDraw(); tkViewSaveLater(); }
}
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
/* ---------- tekenen ---------- */
let tkRaf = 0;
function tkDraw(nu) { if (!TK) return; if (nu) { cancelAnimationFrame(tkRaf); tkRaf = 0; return tkPaint(); } if (!tkRaf) tkRaf = requestAnimationFrame(() => { tkRaf = 0; tkPaint(); }); }
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

/* =====================================================================
   FASE 2 — techniekenlaag (v1.32.0)
   Elk getekend object is één rij in plan_objecten (wereld-mm, y naar boven):
     symbool  geo {x, y}                    props {code, rot, spiegel, hoogte, kring, label, bestaand, lo:[dx,dy]}
     tekst    geo {x, y, px?, py?}          props {tekst, h, pijl: "pijl" | "punt", bestaand}   (x, y = linksboven; px, py = pijlpunt)
     lijn     geo {pts: [x, y, x, y, …]}     props {stijl, diam, label, lengte, bestaand}
     schakel  geo {pts: [x1, y1, x2, y2]}    props {bocht}
     maat     geo {a: [x, y], b: [x, y], off}
   Tekst, symbolen en lijndiktes zijn in papier-mm; op het plan × tekenschaal (1:50 → × 50).
   Bladen = laagcombinaties (Technieken / ELEK / HVAC) in tekenplannen.lagen.bladen; pdf via pdf-lib (vector).
   Sneltoetsen volgen Vectorworks (zie tkHulp).
   ===================================================================== */
const TK_SYM_STD = {   // groep en standaardhoogte (mm) — zelfde als plan_symbolen in script 030
  stopcontact: ["elektro", 200], stopcontact_gesch: ["elektro", 200], vloerstopcontact: ["elektro", null], data: ["data", 200], tv: ["data", 200],
  schakelaar: ["elektro", 1000], schakelaar_gesch: ["elektro", 1000], voeding: ["elektro", null], lichtpunt: ["verlichting", null], hanglamp: ["verlichting", null],
  spot: ["verlichting", null], spot_richtbaar: ["verlichting", null], applique: ["verlichting", 1800], applique_richtbaar: ["verlichting", 1800], applique_inbouw: ["verlichting", 300],
  tl: ["verlichting", null], ledstrip: ["verlichting", null], ventiel: ["hvac", null], prado: ["hvac", null], muziekbox: ["data", null], rookmelder: ["beveiliging", null],
  gas: ["hvac", null], wifi_versterker: ["data", null], wifi_ap: ["data", null], alarmdetector: ["beveiliging", null], alarmcontact: ["beveiliging", null], camera: ["beveiliging", null],
  bewegingssensor: ["elektro", null], thermostaat: ["hvac", 1500], parlofoon: ["beveiliging", 1600], alarmbediening: ["beveiliging", 1600], deurbel: ["beveiliging", 1600],
  aircobediening: ["hvac", 1500], kw: ["sanitair", null], ww: ["sanitair", null], afvoer: ["sanitair", null], airco_unit: ["hvac", null], radiator: ["hvac", null],
};
const TK_GROEPEN = [["elektro", "Elektro"], ["verlichting", "Verlichting"], ["data", "Data en multimedia"], ["beveiliging", "Beveiliging"], ["sanitair", "Sanitair"], ["hvac", "HVAC en ventilatie"]];
const TK_STIJLEN = {   // lw en dash in papier-mm
  lijn:      { naam: "Lijn", laag: null, kleur: null, lw: 0.25 },
  kw:        { naam: "Koud water (KW)", laag: "sanitair", kleur: "#1F5FD6", lw: 0.35, tag: "KW", groep: "san" },
  ww:        { naam: "Warm water (WW)", laag: "sanitair", kleur: "#D42A20", lw: 0.35, tag: "WW", groep: "san" },
  afvoer:    { naam: "Afvoer", laag: "sanitair", kleur: "#5E5E63", lw: 0.5, dash: [2.4, 0.8, 0.4, 0.8], tag: "afvoer", groep: "san" },
  led:       { naam: "LED-strip", laag: "verlichting", kleur: null, lw: 0.6, lengte: true, groep: "elek" },
  wachtbuis: { naam: "Wachtbuis", laag: "elektro", kleur: null, lw: 0.25, dash: [1.4, 0.8], groep: "elek" },
  schakel:   { naam: "Schakelverbinding", laag: "verlichting", kleur: null, lw: 0.18, dash: [0.9, 0.7], groep: "elek" },
};
const TK_BLAUW = "#1F5FD6";
const TK_LBL_H = 1.6;                                   // labelhoogte (kring, H=…) in papier-mm
const TK_PAPIER = { A0: [1189, 841], A1: [841, 594], A2: [594, 420], A3: [420, 297], A4: [297, 210] };
const TK_ELEK_LAGEN = ["elektro", "verlichting"], TK_SAN_LAGEN = ["sanitair", "hvac"];
let TK_PREF = (() => { try { return JSON.parse(localStorage.getItem("bros.tk.pref") || "{}") || {}; } catch (e) { return {}; } })();
let TK_KLEMBORD = null, TK_SYMDB = null, TK_LOGO = null;
const tkN = () => Number(TK && TK.pl && TK.pl.schaal) || 50;
const tkUid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });
const tkKopie = (o) => JSON.parse(JSON.stringify(o));
const tkLaagKleur = (k) => (TK && TK.lagen.kleur[k]) || (TK_LAGEN.find(l => l[0] === k) || [])[2] || "#1D1D1F";
const tkLaagNaam = (k) => (TK_LAGEN.find(l => l[0] === k) || [])[1] || k;
const tkGetal = (v) => { if (v == null || String(v).trim() === "") return null; const n = typeof leesGetal === "function" ? leesGetal(v) : Number(String(v).replace(",", ".")); return Number.isFinite(n) ? n : null; };
const tkIso = () => new Date().toISOString();
function tkPrefBewaar() { if (!TK) return; TK_PREF = { symCode: TK.symCode, stijl: TK.stijl, diam: TK.diam, tekstH: TK.tekstH, laag: TK.laag, open: TK.open }; try { localStorage.setItem("bros.tk.pref", JSON.stringify(TK_PREF)); } catch (e) { } }
function tkSymInfo(code) {
  const s = SYMBOLEN[code] || {}; const db = TK_SYMDB && TK_SYMDB[code]; const std = TK_SYM_STD[code] || [];
  return { naam: (db && db.naam) || s.naam || code, laag: s.laag || (db && db.laag) || "elektro", groep: (db && db.groep) || std[0] || s.laag || "elektro", hoogte: db ? (db.hoogte_mm ?? null) : (std[1] ?? null), wand: !!s.wand, actief: !db || db.actief !== false };
}
function tkBlad() { return TK && TK.blad ? (TK.lagen.bladen || []).find(b => b.id === TK.blad) || null : null; }
function tkZichtbaar(l) { const b = tkBlad(); if (b) return (b.lagen || []).includes(l); return TK.lagen.zichtbaar[l] !== false; }
function tkStdBladen() {
  const alle = TK_LAGEN.map(l => l[0]); const basis = ["onderlegger", "bestaand", "afbraak", "nieuw", "tekst"];
  return [
    { id: "alles", naam: "Technieken", titel: "Grondplan technieken", soort: "Grondplan", lagen: alle, legende: true, hoogteregel: true },
    { id: "elek", naam: "ELEK", titel: "Grondplan elektriciteit", soort: "Grondplan", lagen: [...basis, "elektro", "verlichting", "maatvoering"], legende: true, hoogteregel: true },
    { id: "hvac", naam: "HVAC", titel: "Grondplan sanitair en HVAC", soort: "Grondplan", lagen: [...basis, "sanitair", "hvac", "maatvoering"], legende: true, hoogteregel: false },
  ];
}
function tkObjKleur(o) {
  const p = o.props || {}; if (p.bestaand) return TK_BLAUW;
  if (o.soort === "lijn" || o.soort === "schakel") { const st = TK_STIJLEN[o.soort === "schakel" ? "schakel" : (p.stijl || "lijn")]; if (st && st.kleur) return st.kleur; }
  return tkLaagKleur(o.laag);
}

/* ---------- editor openen / sluiten ---------- */
function tkOpen(id) {
  const pl = S.tekenplannen[id]; if (!pl) return toast("Dit plan bestaat niet meer.");
  tkClose(); tkCss();
  const lg = pl.lagen || {}; const P = TK_PREF || {};
  TK = { id, pl, lagen: { zichtbaar: { ...(lg.zichtbaar || {}) }, kleur: { ...(lg.kleur || {}) }, dekking: lg.dekking ?? 0.55, grijs: lg.grijs !== false, bladen: tkKopie(lg.bladen && lg.bladen.length ? lg.bladen : tkStdBladen()) },
    view: null, tool: "selectie", pts: [], mouse: null, snap: null, space: false, drag: null, ol: { status: "laden" }, sharp: null, sharpKey: "", sharpTask: null, pointers: new Map(), meting: null,
    objs: new Map(), sel: new Set(), dirty: new Set(), weg: new Set(), undo: [], redo: [], op: null, orde: null, views: [],
    symCode: SYMBOLEN[P.symCode] ? P.symCode : "stopcontact", symRot: 0, symSpiegel: false, stijl: TK_STIJLEN[P.stijl] ? P.stijl : "kw", diam: P.diam || "", tekstH: P.tekstH || 2, laag: P.laag || "elektro",
    kring: "", bestaand: false, blad: null, open: { ...(P.open || {}) }, geladen: false, verworven: [] };
  const el = document.createElement("div"); el.id = "tk"; el.className = "tk"; el.innerHTML = tkShell(pl); document.body.appendChild(el); document.documentElement.classList.add("tk-open");
  TK.el = el; TK.cv = el.querySelector("canvas"); TK.ctx = TK.cv.getContext("2d");
  tkBindUi(); tkResize(); tkSideRender();
  tkLoadOnderlegger().then(() => { if (!TK || TK.id !== id) return; if (!tkViewRestore()) tkFit(); tkIndexSnap(); tkDraw(); tkSideRender(); });
  tkLaadObjecten(); tkLaadSymDb(); tkRtStart();
  if (!TK_LOGO) { TK_LOGO = new Image(); TK_LOGO.src = "logo.png"; TK_LOGO.onload = () => tkDraw(); }
  TK.ro = new ResizeObserver(() => { tkResize(); tkDraw(); }); TK.ro.observe(el.querySelector(".tk-cw"));
}
function tkClose() {
  if (!TK) return; tkSaveLagen(true); tkViewSave(); tkPrefBewaar(); tkFlush(true); tkRtStop();
  try { TK.ro && TK.ro.disconnect(); } catch (e) { }
  if (TK.sharpTask) try { TK.sharpTask.cancel(); } catch (e) { }
  document.removeEventListener("keydown", tkKey, true); document.removeEventListener("keyup", tkKeyUp, true);
  TK.el.remove(); document.documentElement.classList.remove("tk-open"); TK = null; render();
}
window.addEventListener("beforeunload", (e) => { if (TK && (TK.dirty.size || TK.weg.size)) { tkFlush(true); e.preventDefault(); e.returnValue = ""; } });
async function tkLaadObjecten() {
  const T = TK; const rows = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await sb.from("plan_objecten").select("*").eq("plan_id", T.id).order("id", { ascending: true }).range(from, from + 999);   // vaste volgorde: anders vallen rijen tussen pagina's weg
    if (error) { toast("Getekende objecten niet geladen: " + error.message, 6000); break; }
    rows.push(...(data || [])); if (!data || data.length < 1000) break;
  }
  if (T !== TK) return;
  rows.forEach(r => { if (tkGeldig(r) && !T.weg.has(r.id) && !T.dirty.has(r.id)) T.objs.set(r.id, r); }); T.orde = null; T.geladen = true; tkIndexSnap(); tkSideRender(); tkDraw();
}
function tkGeldig(r) {   // rij uit de database of realtime controleren en aanvullen
  if (!r || !r.id) return null; r.props = r.props && typeof r.props === "object" ? r.props : {}; r.geo = r.geo && typeof r.geo === "object" ? r.geo : {}; const g = r.geo; const f = Number.isFinite;
  const ptsOk = (a, n) => Array.isArray(a) && a.length >= n && a.length % 2 === 0 && a.every(f);
  if (r.soort === "symbool") return f(g.x) && f(g.y) ? r : null;
  if (r.soort === "tekst") return f(g.x) && f(g.y) ? r : null;
  if (r.soort === "lijn") return ptsOk(g.pts, 4) ? r : null;
  if (r.soort === "schakel") return ptsOk(g.pts, 4) && g.pts.length === 4 ? r : null;
  if (r.soort === "maat") return ptsOk(g.a, 2) && ptsOk(g.b, 2) ? r : null;
  return null;
}
async function tkLaadSymDb() {
  if (TK_SYMDB) return; try { const { data, error } = await sb.from("plan_symbolen").select("*"); if (!error && data && data.length) { TK_SYMDB = {}; data.forEach(r => TK_SYMDB[r.code] = r); if (TK) tkSideRender(); } } catch (e) { }
}

/* ---------- live samenwerken (realtime) ---------- */
function tkRtStart() {
  try {
    const id = TK.id;
    TK.rt = sb.channel("tk-" + id + "-" + Math.random().toString(36).slice(2, 8))
      .on("postgres_changes", { event: "*", schema: "public", table: "plan_objecten", filter: "plan_id=eq." + id }, tkRt)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "plan_objecten" }, tkRt)
      .subscribe();
  } catch (e) { }
}
function tkRtStop() { try { if (TK && TK.rt) { (sb.removeChannel ? sb.removeChannel(TK.rt) : TK.rt.unsubscribe && TK.rt.unsubscribe()); } } catch (e) { } }
function tkRt(payload) {
  const T = TK; if (!T || !payload) return; const nw = payload.new, old = payload.old; const ev = payload.eventType || payload.type;
  if (ev === "DELETE") { const id = old && old.id; if (id && T.objs.has(id) && !T.dirty.has(id)) { T.objs.delete(id); T.sel.delete(id); T.orde = null; tkSideLater(); tkDraw(); } return; }
  if (!nw || nw.plan_id !== T.id || T.dirty.has(nw.id) || T.weg.has(nw.id) || !tkGeldig(nw)) return;
  if (T.op && T.op.ids && T.op.ids.has(nw.id)) return;
  const cur = T.objs.get(nw.id); if (cur && nw.updated_by === S.me.id && Date.parse(cur.updated_at || 0) >= Date.parse(nw.updated_at || 0)) return;   // eigen echo
  T.objs.set(nw.id, nw); T.orde = null; if (T.sel.has(nw.id)) tkSideLater(); tkDraw();
}

/* ---------- bewaren per wijziging (met ongedaan maken) ---------- */
function tkDoe(voor, na, opt = {}) {
  if (!TK || !na.length) return; TK.undo.push({ voor, na }); if (TK.undo.length > 300) TK.undo.shift(); TK.redo = [];
  tkPas(na); if (opt.selecteer) { TK.sel = new Set(na.filter(([, r]) => r).map(([id]) => id)); }
  tkNaWijziging();
}
function tkPas(lijst) {
  for (const [id, row] of lijst) {
    if (row) { const r = tkKopie(row); r.updated_at = tkIso(); r.updated_by = S.me.id; TK.objs.set(id, r); TK.dirty.add(id); TK.weg.delete(id); }
    else { TK.objs.delete(id); TK.sel.delete(id); TK.dirty.delete(id); TK.weg.add(id); }
  }
  TK.orde = null;
}
function tkNaWijziging() { tkIndexSnap(); tkBewaarLater(); tkSideRender(); tkDraw(); }
function tkUndo() { if (!TK || !TK.undo.length) return toast("Niets om ongedaan te maken"); const st = TK.undo.pop(); TK.redo.push(st); tkPas(st.voor); TK.sel = new Set(st.voor.filter(([, r]) => r).map(([id]) => id)); tkNaWijziging(); }
function tkRedo() { if (!TK || !TK.redo.length) return toast("Niets om opnieuw te doen"); const st = TK.redo.pop(); TK.undo.push(st); tkPas(st.na); TK.sel = new Set(st.na.filter(([, r]) => r).map(([id]) => id)); tkNaWijziging(); }
let tkBewaarT;
function tkBewaarLater() { clearTimeout(tkBewaarT); tkSaveStatus("wijzigingen…"); tkBewaarT = setTimeout(() => tkFlush(), 700); }
function tkSaveStatus(t) { const s = TK && TK.el.querySelector("[data-tk-save]"); if (s) s.textContent = t; }
async function tkFlush(nu, T = TK) {
  if (!T) return; if (T === TK) clearTimeout(tkBewaarT);
  if (T.flushing) { T.nogEens = true; return; }
  const ids = [...T.dirty], weg = [...T.weg]; if (!ids.length && !weg.length) return;
  T.dirty.clear(); T.weg.clear(); T.flushing = true; if (TK === T) tkSaveStatus("bewaren…");
  const rows = ids.map(id => T.objs.get(id)).filter(Boolean).map(r => ({ id: r.id, plan_id: T.id, laag: r.laag, soort: r.soort, geo: r.geo, props: r.props, z: r.z || 0, created_by: r.created_by || S.me.id, updated_by: S.me.id, updated_at: r.updated_at || tkIso() }));
  try {
    if (rows.length) { const { error } = await sb.from("plan_objecten").upsert(rows); if (error) throw error; }
    if (weg.length) { const { error } = await sb.from("plan_objecten").delete().in("id", weg); if (error) throw error; }
    T.fouten = 0; if (TK === T) tkSaveStatus("bewaard");
  } catch (e) {
    ids.forEach(id => { if (T.objs.has(id) && !T.weg.has(id)) T.dirty.add(id); }); weg.forEach(id => { if (!T.objs.has(id)) T.weg.add(id); }); T.fouten = (T.fouten || 0) + 1;
    if (TK === T) tkSaveStatus("niet bewaard — opnieuw proberen…"); if (T.fouten === 1 || TK !== T) toast("Tekening niet bewaard: " + (e.message || e) + " — ik probeer opnieuw.", 6000);
    if (T.fouten < 12) setTimeout(() => tkFlush(false, T), Math.min(30000, 3000 * T.fouten));
  } finally {
    T.flushing = false; const meer = T.dirty.size || T.weg.size;
    if (meer && (T.nogEens || TK !== T) && !T.fouten) { T.nogEens = false; tkFlush(false, T); } else if (meer && TK === T && !T.fouten) tkBewaarLater(); T.nogEens = false;
  }
}
function tkNieuw(rows, opt = {}) {
  if (!TK) return []; let z = Math.max(0, ...[...TK.objs.values()].map(o => o.z || 0));
  const na = rows.map(r => { const id = r.id || tkUid(); return [id, { id, plan_id: TK.id, laag: r.laag || "nieuw", soort: r.soort, geo: r.geo, props: r.props || {}, z: r.z ?? ++z, created_by: S.me.id, created_at: tkIso() }]; });
  tkDoe(na.map(([id]) => [id, null]), na, { selecteer: opt.selecteer !== false }); return na.map(([id]) => id);
}
function tkWijzig(fn, ids = TK.sel) {   // fn(kopie) → gewijzigde kopie (of null = verwijderen)
  const voor = [], na = [];
  for (const id of ids) { const o = TK.objs.get(id); if (!o) continue; const n = fn(tkKopie(o)); if (n === undefined) continue; if (n !== null && JSON.stringify(n) === JSON.stringify(o)) continue; voor.push([id, tkKopie(o)]); na.push([id, n]); }
  if (na.length) tkDoe(voor, na); return na.length;
}
function tkOrde() { if (!TK.orde) TK.orde = [...TK.objs.values()].sort((a, b) => (a.z || 0) - (b.z || 0) || String(a.created_at || "").localeCompare(String(b.created_at || ""))); return TK.orde; }

/* ---------- geometrie ---------- */
let tkMeetCtx = null;
function tkTxtW(s, h, bold, serif) { if (!tkMeetCtx) tkMeetCtx = document.createElement("canvas").getContext("2d"); tkMeetCtx.font = `${bold ? "700 " : ""}100px ${serif ? '"Times New Roman", Times, serif' : "Helvetica, Arial, sans-serif"}`; return tkMeetCtx.measureText(String(s)).width * h / 100; }
const TK_SYM_BB = {};
function tkSymBB(code) {   // omhullende van een symbool in papier-mm (lokaal)
  if (TK_SYM_BB[code]) return TK_SYM_BB[code]; const s = SYMBOLEN[code]; let b = [Infinity, Infinity, -Infinity, -Infinity];
  const add = (x, y) => { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; };
  for (const o of (s && s.d) || []) {
    const t = o[0];
    if (t === "l") { add(o[1], o[2]); add(o[3], o[4]); } else if (t === "p") { for (let i = 0; i < o[1].length; i += 2) add(o[1][i], o[1][i + 1]); }
    else if (t === "c" || t === "a") { add(o[1] - o[3], o[2] - o[3]); add(o[1] + o[3], o[2] + o[3]); } else if (t === "r") { add(o[1], o[2]); add(o[1] + o[3], o[2] + o[4]); }
    else if (t === "t") { const w = tkTxtW(o[3], o[4], true); const x = o[5] === "c" ? o[1] - w / 2 : o[5] === "r" ? o[1] - w : o[1]; add(x, o[2] - o[4] * 0.2); add(x + w, o[2] + o[4] * 0.75); }
  }
  if (!isFinite(b[0])) b = [-1.5, -1.5, 1.5, 1.5]; return (TK_SYM_BB[code] = b);
}
function tkSymM(o, N = tkN()) {   // lokale papier-mm → wereld-mm
  const p = o.props || {}; const a = (p.rot || 0) * Math.PI / 180; const sp = p.spiegel ? -1 : 1; const ca = Math.cos(a), sa = Math.sin(a); const x0 = o.geo.x, y0 = o.geo.y;
  return (px, py) => [x0 + N * (px * sp * ca - py * sa), y0 + N * (px * sp * sa + py * ca)];
}
function tkLabelRegels(o) {
  const p = o.props || {}; const r = []; if (p.kring) r.push(String(p.kring));
  const std = tkSymInfo(p.code).hoogte; const h = tkGetal(p.hoogte); if (h != null && h !== std) r.push("H=" + Math.round(h));
  if (p.label) String(p.label).split("\n").forEach(l => { if (l.trim()) r.push(l.trim()); }); return r;
}
function tkLabelPos(o) {   // linksboven van het labelblok (wereld-mm)
  const N = tkN(); let lo = o.props && o.props.lo;
  if (!lo) { const bb = tkBBox(o, true); lo = [(bb[2] - o.geo.x) / N + 0.6, (bb[3] - o.geo.y) / N + 0.4]; }
  return [o.geo.x + lo[0] * N, o.geo.y + lo[1] * N];
}
function tkLabelBB(o) { const rg = tkLabelRegels(o); if (!rg.length) return null; const N = tkN(); const h = TK_LBL_H * N; const [x, y] = tkLabelPos(o); const w = Math.max(...rg.map(s => tkTxtW(s, h))); return [x, y - h * (0.95 + (rg.length - 1) * 1.25) - h * 0.25, x + w, y]; }
function tkTekstInfo(o) {   // regels, hoogte, breedte, omhullende
  const N = tkN(); const h = (Number(o.props && o.props.h) || 2) * N; const rg = String((o.props && o.props.tekst) || "").split("\n");
  const w = Math.max(h, ...rg.map(s => tkTxtW(s, h))); const x = o.geo.x, y = o.geo.y;
  return { rg, h, w, bb: [x, y - h * (0.95 + (rg.length - 1) * 1.3) - h * 0.3, x + w, y] };
}
function tkLeaderStart(o, ti) { const t = ti || tkTekstInfo(o); const links = o.geo.px < o.geo.x + t.w / 2; return [links ? o.geo.x - t.h * 0.35 : o.geo.x + t.w + t.h * 0.35, o.geo.y - t.h * 0.6]; }
function tkSchakelPts(o, n = 28) {
  const [ax, ay, bx, by] = o.geo.pts; const dx = bx - ax, dy = by - ay; const b = (o.props && o.props.bocht) ?? 0.22;
  const cx = (ax + bx) / 2 - dy * b * 2, cy = (ay + by) / 2 + dx * b * 2; const pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; pts.push(u * u * ax + 2 * u * t * cx + t * t * bx, u * u * ay + 2 * u * t * cy + t * t * by); } return pts;
}
function tkMaatGeo(o) { const [ax, ay] = o.geo.a, [bx, by] = o.geo.b; const dx = bx - ax, dy = by - ay; const L = Math.hypot(dx, dy) || 1e-9; const nx = -dy / L, ny = dx / L; const off = o.geo.off || 0; return { L, nx, ny, ux: dx / L, uy: dy / L, A: [ax + nx * off, ay + ny * off], B: [bx + nx * off, by + ny * off] }; }
const tkLijnLengte = (pts) => { let L = 0; for (let i = 2; i < pts.length; i += 2) L += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]); return L; };
function tkLijnTekst(o) {
  const p = o.props || {}; const st = TK_STIJLEN[p.stijl] || TK_STIJLEN.lijn; const d = [];
  if (st.tag) d.push(st.tag); if (p.diam) d.push("Ø" + p.diam); if (p.label) d.push(p.label);
  if (p.lengte ?? st.lengte) d.push(Math.round(tkLijnLengte(o.geo.pts || [])) + " mm"); return d.join(" ");
}
function tkBBox(o, zonderLabel) {
  const b = [Infinity, Infinity, -Infinity, -Infinity]; const add = (x, y) => { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; };
  if (o.soort === "symbool") { const s = tkSymBB(o.props.code); const M = tkSymM(o); [[s[0], s[1]], [s[2], s[1]], [s[2], s[3]], [s[0], s[3]]].forEach(([u, v]) => add(...M(u, v))); if (!zonderLabel) { const lb = tkLabelBB(o); if (lb) { add(lb[0], lb[1]); add(lb[2], lb[3]); } } }
  else if (o.soort === "tekst") { const t = tkTekstInfo(o); add(t.bb[0], t.bb[1]); add(t.bb[2], t.bb[3]); if (o.geo.px != null) add(o.geo.px, o.geo.py); }
  else if (o.soort === "lijn") { const p = o.geo.pts || []; for (let i = 0; i < p.length; i += 2) add(p[i], p[i + 1]); }
  else if (o.soort === "schakel") { const p = tkSchakelPts(o, 12); for (let i = 0; i < p.length; i += 2) add(p[i], p[i + 1]); }
  else if (o.soort === "maat") { const g = tkMaatGeo(o); add(...o.geo.a); add(...o.geo.b); add(...g.A); add(...g.B); }
  return isFinite(b[0]) ? b : [0, 0, 0, 0];
}
function tkSegDist(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay; const L2 = dx * dx + dy * dy; let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - ax - t * dx, py - ay - t * dy); }
function tkPolyDist(px, py, pts) { let d = Infinity; for (let i = 2; i < pts.length; i += 2) d = Math.min(d, tkSegDist(px, py, pts[i - 2], pts[i - 1], pts[i], pts[i + 1])); return d; }
const tkIn = (b, x, y, t = 0) => x >= b[0] - t && x <= b[2] + t && y >= b[1] - t && y <= b[3] + t;
function tkHit(x, y, tol) {   // bovenste object onder het punt → {id, deel}
  const N = tkN(); const lijst = tkOrde();
  for (let i = lijst.length - 1; i >= 0; i--) {
    const o = lijst[i]; if (!tkZichtbaar(o.laag)) continue;
    if (o.soort === "symbool") {
      const lb = tkLabelBB(o); if (lb && tkIn(lb, x, y, tol * 0.5)) return { id: o.id, deel: "label" };
      const p = o.props; const a = (p.rot || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a); const dx = (x - o.geo.x) / N, dy = (y - o.geo.y) / N;
      let u = dx * ca + dy * sa; const v = -dx * sa + dy * ca; if (p.spiegel) u = -u; const s = tkSymBB(p.code); const t = tol / N;
      if (u >= Math.min(0, s[0]) - t && u <= Math.max(0, s[2]) + t && v >= Math.min(0, s[1]) - t && v <= Math.max(0, s[3]) + t) return { id: o.id, deel: "obj" };
    } else if (o.soort === "tekst") {
      const ti = tkTekstInfo(o); if (tkIn(ti.bb, x, y, tol)) return { id: o.id, deel: "obj" };
      if (o.geo.px != null) { const s = tkLeaderStart(o, ti); if (tkSegDist(x, y, s[0], s[1], o.geo.px, o.geo.py) < tol) return { id: o.id, deel: "obj" }; }
    } else if (o.soort === "lijn") { if (tkPolyDist(x, y, o.geo.pts || []) < tol) return { id: o.id, deel: "obj" }; }
    else if (o.soort === "schakel") { if (tkPolyDist(x, y, tkSchakelPts(o)) < tol) return { id: o.id, deel: "obj" }; }
    else if (o.soort === "maat") { const g = tkMaatGeo(o); if (tkSegDist(x, y, g.A[0], g.A[1], g.B[0], g.B[1]) < tol || tkSegDist(x, y, ...o.geo.a, ...g.A) < tol || tkSegDist(x, y, ...o.geo.b, ...g.B) < tol) return { id: o.id, deel: "obj" }; }
  }
  return null;
}
/* transformaties van objecten (verplaatsen, roteren, spiegelen) */
function tkVerschuif(o, dx, dy) {
  const g = o.geo;
  if (o.soort === "symbool") { g.x += dx; g.y += dy; }
  else if (o.soort === "tekst") { g.x += dx; g.y += dy; if (g.px != null) { g.px += dx; g.py += dy; } }
  else if (o.soort === "lijn" || o.soort === "schakel") { for (let i = 0; i < g.pts.length; i += 2) { g.pts[i] += dx; g.pts[i + 1] += dy; } }
  else if (o.soort === "maat") { g.a = [g.a[0] + dx, g.a[1] + dy]; g.b = [g.b[0] + dx, g.b[1] + dy]; }
  return o;
}
function tkRoteer(o, cx, cy, graden) {
  const a = graden * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); const R = (x, y) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]; const g = o.geo;
  if (o.soort === "symbool") { [g.x, g.y] = R(g.x, g.y); o.props.rot = ((((o.props.rot || 0) + graden) % 360) + 360) % 360; delete o.props.lo; }
  else if (o.soort === "tekst") { const ti = tkTekstInfo(o); const [mx, my] = R(g.x + ti.w / 2, g.y - ti.h / 2); g.x = mx - ti.w / 2; g.y = my + ti.h / 2; if (g.px != null) [g.px, g.py] = R(g.px, g.py); }
  else if (o.soort === "lijn" || o.soort === "schakel") { for (let i = 0; i < g.pts.length; i += 2) [g.pts[i], g.pts[i + 1]] = R(g.pts[i], g.pts[i + 1]); }
  else if (o.soort === "maat") { g.a = R(...g.a); g.b = R(...g.b); }
  return o;
}
function tkSpiegel(o, cx, cy, as) {   // as: "h" = spiegelen rond een verticale as, "v" = rond een horizontale as
  const M = (x, y) => as === "h" ? [2 * cx - x, y] : [x, 2 * cy - y]; const g = o.geo;
  if (o.soort === "symbool") { [g.x, g.y] = M(g.x, g.y); const r = o.props.rot || 0; o.props.rot = (((as === "h" ? -r : 180 - r) % 360) + 360) % 360; o.props.spiegel = !o.props.spiegel; delete o.props.lo; }
  else if (o.soort === "tekst") { const ti = tkTekstInfo(o); const [mx, my] = M(g.x + ti.w / 2, g.y - ti.h / 2); g.x = mx - ti.w / 2; g.y = my + ti.h / 2; if (g.px != null) [g.px, g.py] = M(g.px, g.py); }
  else if (o.soort === "lijn" || o.soort === "schakel") { for (let i = 0; i < g.pts.length; i += 2) [g.pts[i], g.pts[i + 1]] = M(g.pts[i], g.pts[i + 1]); if (o.soort === "schakel") o.props.bocht = -((o.props.bocht ?? 0.22)); }
  else if (o.soort === "maat") { g.a = M(...g.a); g.b = M(...g.b); g.off = -(g.off || 0); }
  return o;
}
function tkSelBBox(ids = TK.sel) { const b = [Infinity, Infinity, -Infinity, -Infinity]; for (const id of ids) { const o = TK.objs.get(id); if (!o) continue; const q = tkBBox(o, true); b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[2]); b[3] = Math.max(b[3], q[3]); } return isFinite(b[0]) ? b : null; }
function tkSelMidden() { if (TK.sel.size === 1) { const o = TK.objs.get([...TK.sel][0]); if (o && o.soort === "symbool") return [o.geo.x, o.geo.y]; } const b = tkSelBBox(); return b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : null; }

/* ---------- tekenen via een "pen": hetzelfde tekenwerk voor het scherm (canvas) en de pdf (pdf-lib) ---------- */
const TK_FONT = (o) => `${o.italic ? "italic " : ""}${o.bold || o.semi ? "700 " : ""}${o.h}px ${o.serif ? '"Times New Roman", Times, serif' : "Helvetica, Arial, sans-serif"}`;
function tkCanvasPen(ctx, kp) {   // kp = schermpixels per papier-mm
  const lw = (o) => Math.max(0.6, (o.lw ?? 0.18) * kp);
  return {
    kp,
    poly(pts, o = {}) {
      if (pts.length < 4) return; ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); if (o.closed) ctx.closePath();
      if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(); }
      if (o.kleur) { ctx.strokeStyle = o.kleur; ctx.lineWidth = lw(o); ctx.setLineDash(o.dash ? o.dash.map(d => Math.max(1, d * kp)) : []); ctx.stroke(); ctx.setLineDash([]); }
    },
    circle(x, y, r, o = {}) { ctx.beginPath(); ctx.arc(x, y, Math.max(0.4, r), 0, Math.PI * 2); if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(); } if (o.kleur) { ctx.strokeStyle = o.kleur; ctx.lineWidth = lw(o); ctx.setLineDash([]); ctx.stroke(); } },
    text(x, y, s, o = {}) {
      if (!s || o.h < 1.5) return; ctx.save(); ctx.translate(x, y); if (o.rot) ctx.rotate(-o.rot); ctx.font = TK_FONT(o);
      ctx.textAlign = o.align === "c" ? "center" : o.align === "r" ? "right" : "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = o.kleur || "#000"; ctx.fillText(s, 0, 0); ctx.restore();
    },
    logo(img, bl, tr) { if (img && img.complete && img.naturalWidth) ctx.drawImage(img, bl[0], tr[1], tr[0] - bl[0], bl[1] - tr[1]); },
  };
}
const tkRgb = (hex) => { const h = String(hex || "#000").replace("#", ""); const f = h.length === 3 ? h.split("").map(c => c + c).join("") : h; return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16) / 255); };
const TK_WIN = /[^\x20-\x7E\xA0-\xFF€–—‘’“”•…‰ŒœŠšŸŽžƒˆ˜†‡‹›™]/g;
const tkWin = (s) => String(s).replace(/[−]/g, "-").replace(/[·]/g, "·").replace(TK_WIN, "?");
function tkPdfPen(L, page, F) {   // pdf-lib, eenheden in pt, y naar boven
  const kp = 72 / 25.4; const ops = (...a) => page.pushOperators(...a);
  const kring = (x, y, r) => { const k = 0.5523 * r; return [L.moveTo(x + r, y), L.appendBezierCurve(x + r, y + k, x + k, y + r, x, y + r), L.appendBezierCurve(x - k, y + r, x - r, y + k, x - r, y), L.appendBezierCurve(x - r, y - k, x - k, y - r, x, y - r), L.appendBezierCurve(x + k, y - r, x + r, y - k, x + r, y), L.closePath()]; };
  const stijl = (o) => { const a = []; if (o.fill) a.push(L.setFillingRgbColor(...tkRgb(o.fill))); if (o.kleur) a.push(L.setStrokingRgbColor(...tkRgb(o.kleur)), L.setLineWidth((o.lw ?? 0.18) * kp), L.setLineCap(L.LineCapStyle.Round), L.setLineJoin(L.LineJoinStyle.Round), L.setDashPattern(o.dash ? o.dash.map(d => d * kp) : [], 0)); return a; };
  const verf = (o) => o.fill && o.kleur ? L.fillAndStroke() : o.fill ? L.fill() : L.stroke();
  const font = (o) => o.serif ? (o.bold ? F.tb : F.t) : (o.bold || o.semi ? F.hb : o.italic ? F.hi : F.h);
  return {
    kp, pdf: true,
    poly(pts, o = {}) { if (pts.length < 4 || (!o.fill && !o.kleur)) return; const a = [L.pushGraphicsState(), ...stijl(o), L.moveTo(pts[0], pts[1])]; for (let i = 2; i < pts.length; i += 2) a.push(L.lineTo(pts[i], pts[i + 1])); if (o.closed) a.push(L.closePath()); a.push(verf(o), L.popGraphicsState()); ops(...a); },
    circle(x, y, r, o = {}) { if (!o.fill && !o.kleur) return; ops(L.pushGraphicsState(), ...stijl(o), ...kring(x, y, r), verf(o), L.popGraphicsState()); },
    text(x, y, s, o = {}) {
      s = tkWin(s); if (!s || !(o.h > 0)) return; const f = font(o); let w = 0; try { w = f.widthOfTextAtSize(s, o.h); } catch (e) { return; }
      const r = o.rot || 0; const sh = o.align === "c" ? w / 2 : o.align === "r" ? w : 0;
      try { page.drawText(s, { x: x - sh * Math.cos(r), y: y - sh * Math.sin(r), size: o.h, font: f, color: L.rgb(...tkRgb(o.kleur || "#000")), rotate: L.degrees(r * 180 / Math.PI) }); } catch (e) { }
    },
    logo(emb, bl, tr) { if (emb) page.drawImage(emb, { x: bl[0], y: bl[1], width: tr[0] - bl[0], height: tr[1] - bl[1] }); },
  };
}
/* een symbool tekenen; T = wereld → doel, kp = doeleenheden per papier-mm */
function tkSymTeken(pen, o, T, kp, basis, N = tkN(), opt = {}) {
  const s = SYMBOLEN[o.props.code]; const M = tkSymM(o, N); const P = (x, y) => T(...M(x, y)); const best = !!o.props.bestaand;
  if (!s) { const [X, Y] = P(0, 0); pen.circle(X, Y, 1.2 * kp, { kleur: basis }); pen.text(X, Y + (pen.pdf ? -0.5 : 0.5) * kp, "?", { h: 1.6 * kp, kleur: basis, align: "c" }); return; }
  for (const d of s.d) {
    const t = d[0]; const n0 = t === "p" ? (d[3] === "fill" ? 4 : 3) : SYM_BASIS[t]; const last = d.length > n0 ? d[d.length - 1] : null;
    let kl = typeof last === "string" && SYM_KLEUR[last] ? SYM_KLEUR[last] : basis; if (best && kl !== SYM_KLEUR.w) kl = TK_BLAUW; if (opt.kleur) kl = opt.kleur;
    if (t === "l") pen.poly([...P(d[1], d[2]), ...P(d[3], d[4])], { kleur: kl });
    else if (t === "p") { const pts = []; for (let i = 0; i < d[1].length; i += 2) pts.push(...P(d[1][i], d[1][i + 1])); if (d[3] === "fill") pen.poly(pts, { closed: true, fill: kl }); else pen.poly(pts, { closed: !!d[2], kleur: kl }); }
    else if (t === "c") { const [X, Y] = P(d[1], d[2]); const r = d[3] * kp; if (d[4] === 1) pen.circle(X, Y, r, { fill: kl }); else if (d[4] === 2) pen.circle(X, Y, r, { fill: "#FFFFFF", kleur: kl }); else pen.circle(X, Y, r, { kleur: kl }); }
    else if (t === "a") { const pts = []; const a0 = d[4]; let a1 = d[5]; while (a1 <= a0) a1 += 360; const n = Math.max(6, Math.ceil((a1 - a0) / 10)); for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; pts.push(...P(d[1] + d[3] * Math.cos(a), d[2] + d[3] * Math.sin(a))); } pen.poly(pts, { kleur: kl }); }
    else if (t === "r") { const pts = [...P(d[1], d[2]), ...P(d[1] + d[3], d[2]), ...P(d[1] + d[3], d[2] + d[4]), ...P(d[1], d[2] + d[4])]; pen.poly(pts, d[5] === 1 ? { closed: true, fill: kl } : { closed: true, kleur: kl }); }
    else if (t === "t") { const [X, Y] = P(d[1], d[2]); pen.text(X, Y, String(d[3]), { h: d[4] * kp, kleur: kl, align: d[5], semi: true }); }
  }
}
const tkLeesbaar = (a) => { while (a > Math.PI / 2 + 1e-6) a -= Math.PI; while (a <= -Math.PI / 2 + 1e-6) a += Math.PI; return a; };
function tkTekstLangs(pen, T, kp, N, ax, ay, bx, by, txt, kleur, h = TK_LBL_H, opt = {}) {   // tekst gecentreerd boven een lijnstuk
  const a = tkLeesbaar(Math.atan2(by - ay, bx - ax)); const off = (opt.off ?? 0.7) * N; const mx = (ax + bx) / 2 - Math.sin(a) * off, my = (ay + by) / 2 + Math.cos(a) * off;
  const [X, Y] = T(mx, my); pen.text(X, Y, txt, { h: h * kp, kleur, align: "c", rot: a, italic: opt.italic });
}
function tkObjTeken(pen, o, T, kw) {
  const N = tkN(); const kp = kw * N; const kl = tkObjKleur(o); const p = o.props || {}; const g = o.geo || {};
  if (o.soort === "symbool") {
    tkSymTeken(pen, o, T, kp, kl, N);
    const rg = tkLabelRegels(o); if (rg.length) { const [lx, ly] = tkLabelPos(o); const h = TK_LBL_H * N; rg.forEach((s, i) => { const [X, Y] = T(lx, ly - h * (0.95 + i * 1.25)); pen.text(X, Y, s, { h: TK_LBL_H * kp, kleur: kl }); }); }
  } else if (o.soort === "tekst") {
    const ti = tkTekstInfo(o); const hp = ti.h * kw;
    ti.rg.forEach((s, i) => { const [X, Y] = T(g.x, g.y - ti.h * (0.95 + i * 1.3)); pen.text(X, Y, s, { h: hp, kleur: kl }); });
    if (g.px != null) {
      const s = tkLeaderStart(o, ti); const A = T(...s), B = T(g.px, g.py); pen.poly([...A, ...B], { kleur: kl, lw: 0.18 });
      if (p.pijl === "punt") pen.circle(B[0], B[1], 0.45 * kp, { fill: kl });
      else { const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, l = 1.6 * kp, w = 0.55 * kp; pen.poly([B[0], B[1], B[0] - ux * l - uy * w, B[1] - uy * l + ux * w, B[0] - ux * l + uy * w, B[1] - uy * l - ux * w], { closed: true, fill: kl }); }
    }
  } else if (o.soort === "lijn") {
    const st = TK_STIJLEN[p.stijl] || TK_STIJLEN.lijn; const pts = g.pts || []; const tp = []; for (let i = 0; i < pts.length; i += 2) tp.push(...T(pts[i], pts[i + 1]));
    pen.poly(tp, { kleur: kl, lw: st.lw, dash: st.dash });
    const txt = tkLijnTekst(o); if (txt && pts.length >= 4) { let bi = 2, bl = -1; for (let i = 2; i < pts.length; i += 2) { const l = Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]); if (l > bl) { bl = l; bi = i; } } tkTekstLangs(pen, T, kp, N, pts[bi - 2], pts[bi - 1], pts[bi], pts[bi + 1], txt, kl); }
  } else if (o.soort === "schakel") {
    const pts = tkSchakelPts(o); const tp = []; for (let i = 0; i < pts.length; i += 2) tp.push(...T(pts[i], pts[i + 1])); const st = TK_STIJLEN.schakel; pen.poly(tp, { kleur: kl, lw: st.lw, dash: st.dash });
  } else if (o.soort === "maat") {
    const m = tkMaatGeo(o); const ext = (P, Q) => { const L = Math.hypot(Q[0] - P[0], Q[1] - P[1]); if (L < 1e-6) return; const ux = (Q[0] - P[0]) / L, uy = (Q[1] - P[1]) / L; const gap = Math.min(0.6 * N, L * 0.3), over = 1 * N; pen.poly([...T(P[0] + ux * gap, P[1] + uy * gap), ...T(Q[0] + ux * over, Q[1] + uy * over)], { kleur: kl, lw: 0.13 }); };
    ext(o.geo.a, m.A); ext(o.geo.b, m.B);
    pen.poly([...T(m.A[0] - m.ux * 0.8 * N, m.A[1] - m.uy * 0.8 * N), ...T(m.B[0] + m.ux * 0.8 * N, m.B[1] + m.uy * 0.8 * N)], { kleur: kl, lw: 0.18 });
    const t = 0.8 * N, dxs = (m.ux + m.nx) * t * 0.7071, dys = (m.uy + m.ny) * t * 0.7071;
    [m.A, m.B].forEach(P => pen.poly([...T(P[0] - dxs, P[1] - dys), ...T(P[0] + dxs, P[1] + dys)], { kleur: kl, lw: 0.35 }));
    tkTekstLangs(pen, T, kp, N, m.A[0], m.A[1], m.B[0], m.B[1], String(Math.round(m.L)), kl, 1.8, { off: 0.6, italic: true });
  }
}

/* ---------- blad: kader, titelblok, legende, hoogteregel ---------- */
function tkPapierMaat(b) { const p = TK_PAPIER[(b && b.papier) || TK.pl.papier || "A1"] || TK_PAPIER.A1; return [p[0], p[1]]; }
function tkPapierF(b) { return { A0: 1.2, A1: 1, A2: 0.85, A3: 0.7, A4: 0.6 }[(b && b.papier) || TK.pl.papier || "A1"] || 1; }
function tkKader(b) {   // {x0, y0, x1, y1} in wereld-mm
  const [W, H] = tkPapierMaat(b); const N = tkN(); let c = b.kader;
  if (!c) { const ob = tkOlBBox(); c = { cx: (ob[0] + ob[2]) / 2, cy: (ob[1] + ob[3]) / 2 }; }
  return { x0: c.cx - W * N / 2, y0: c.cy - H * N / 2, x1: c.cx + W * N / 2, y1: c.cy + H * N / 2, cx: c.cx, cy: c.cy };
}
function tkLegendeItems(b) {
  const tel = new Map();
  for (const o of TK.objs.values()) {
    if (!(b.lagen || []).includes(o.laag)) continue; const p = o.props || {}; let key, it;
    if (o.soort === "symbool") { const si = tkSymInfo(p.code); key = "s:" + p.code; it = { soort: "sym", code: p.code, naam: si.naam, groep: TK_SAN_LAGEN.includes(SYMBOLEN[p.code]?.laag || si.laag) ? "san" : "elek", volg: Object.keys(SYMBOLEN).indexOf(p.code) }; }
    else if (o.soort === "lijn" && p.stijl && p.stijl !== "lijn") { const st = TK_STIJLEN[p.stijl]; key = "l:" + p.stijl; it = { soort: "lijn", stijl: p.stijl, naam: st.naam, groep: st.groep || "elek", volg: 900 + Object.keys(TK_STIJLEN).indexOf(p.stijl) }; }
    else if (o.soort === "schakel") { key = "l:schakel"; it = { soort: "lijn", stijl: "schakel", naam: TK_STIJLEN.schakel.naam, groep: "elek", volg: 990 }; }
    else continue;
    const cur = tel.get(key) || { ...it, n: 0, lengte: 0, bestaand: false, laag: o.laag }; cur.n++; if (p.bestaand) cur.bestaand = true; if (o.soort === "lijn") cur.lengte += tkLijnLengte(o.geo.pts || []); tel.set(key, cur);
  }
  return [...tel.values()].sort((a, c) => a.volg - c.volg);
}
function tkSymVasteKleur(code) {   // een symbool dat volledig in één vaste kleur getekend is (bv. groen) → die kleur voor het legendelabel
  const s = SYMBOLEN[code]; if (!s) return null; let k = null;
  for (const d of s.d) { const t = d[0]; const n0 = t === "p" ? (d[3] === "fill" ? 4 : 3) : SYM_BASIS[t]; const last = d.length > n0 ? d[d.length - 1] : null; const c = typeof last === "string" && SYM_KLEUR[last] ? last : null; if (!c) return null; if (k && k !== c) return null; k = c; }
  return k ? SYM_KLEUR[k] : null;
}
function tkPapierTeken(pen, b, P, kp, opt = {}) {   // P(px, py): papier-mm (linksboven, y naar onder) → doel
  const [W, H] = tkPapierMaat(b); const f = tkPapierF(b); const p = S.projecten[TK.pl.project_id] || {};
  const rect = (x, y, w, h, o) => pen.poly([...P(x, y), ...P(x + w, y), ...P(x + w, y + h), ...P(x, y + h)], { closed: true, ...o });
  const tekst = (x, y, s, h, o = {}) => { const [X, Y] = P(x, y); pen.text(X, Y, s, { h: h * kp, ...o }); };
  const m = 16 * f, tw = 50 * f, th = 20 * f;
  // titelblok (stijl Hens Didier)
  rect(m, m, tw, th, { fill: "#FFFFFF", kleur: "#000000", lw: 0.25 });
  const adres = [p.adres, [p.postcode, p.gemeente].filter(Boolean).join(" ")].filter(Boolean).join(" - ");
  const regels = [[String(p.klant || "").toUpperCase(), 3.3, true], [adres, 2.5], [b.soort || "Grondplan", 2.5], ["Schaal 1/" + tkN(), 2.5]].filter(r => r[0]);
  let y = m + th / 2 - (regels.length * 3.1 * f) / 2 + 2.6 * f; regels.forEach(([t, h, vet]) => { tekst(m + tw / 2, y, t, h * f, { align: "c", bold: vet, serif: true, kleur: "#000000" }); y += 3.1 * f; });
  const titel = b.titel || b.naam; const titelW = Math.max(tw, tkTxtW(titel, 5 * f, true, true) * 1.04);
  tekst(m, m + th + 12.5 * f, titel, 5 * f, { bold: true, serif: true, kleur: "#000000" });
  pen.poly([...P(m, m + th + 15 * f), ...P(m + titelW, m + th + 15 * f)], { kleur: "#000000", lw: 0.25 });
  // legende
  let lx = m + titelW + 10 * f; const ly = m; const lw = 57 * f; let lh = 0;
  if (b.legende !== false) {
    const items = tkLegendeItems(b); const groepen = [["elek", "LEGENDE ELEKTRICITEIT", "blauw = bestaande elektriciteit"], ["san", "LEGENDE SANITAIR / HVAC", "blauw = bestaande leidingen"]];
    const blokken = groepen.map(([k, t, bt]) => ({ t, bt, items: items.filter(i => i.groep === k) })).filter(x => x.items.length);
    if (blokken.length) {
      const rij = 4 * f; let h = 5 * f; blokken.forEach(bl => { h += 7 * f + (bl.items.some(i => i.bestaand) ? 4 * f : 0) + bl.items.length * rij + 3 * f; }); lh = h;
      rect(lx, ly, lw, h, { fill: "#FFFFFF", kleur: "#D42A20", lw: 0.35 });
      let yy = ly + 5 * f;
      for (const bl of blokken) {
        tekst(lx + 5 * f, yy + 2.6 * f, bl.t, 3.3 * f, { bold: true, kleur: "#D42A20" }); yy += 7 * f;
        if (bl.items.some(i => i.bestaand)) { tekst(lx + 5 * f, yy - 1.2 * f, bl.bt, 1.9 * f, { semi: true, kleur: TK_BLAUW }); yy += 4 * f; }
        for (const it of bl.items) {
          const cy = yy - 0.7 * f, cx = lx + 10.5 * f; let kl;
          if (it.soort === "sym") {
            const bb = tkSymBB(it.code); const sc = Math.min(1, 6.5 * f / Math.max(0.1, bb[2] - bb[0]), 3.4 * f / Math.max(0.1, bb[3] - bb[1]));
            const ox = cx - (bb[0] + bb[2]) / 2 * sc, oy = cy + (bb[1] + bb[3]) / 2 * sc;
            kl = tkSymVasteKleur(it.code) || tkLaagKleur(SYMBOLEN[it.code]?.laag || "elektro");
            tkSymTeken(pen, { geo: { x: 0, y: 0 }, props: { code: it.code } }, (x, y) => P(ox + x, oy - y), kp * sc, tkLaagKleur(SYMBOLEN[it.code]?.laag || "elektro"), sc);
          } else {
            const st = TK_STIJLEN[it.stijl]; kl = st.kleur || tkLaagKleur(st.laag || "elektro");
            if (it.stijl === "schakel") { const o = { geo: { pts: [cx - 3.5 * f, -(cy + 0.8 * f), cx + 3.5 * f, -(cy + 0.8 * f)] }, props: { bocht: 0.22 } }; const pts = tkSchakelPts(o, 16); const tp = []; for (let i = 0; i < pts.length; i += 2) tp.push(...P(pts[i], -pts[i + 1])); pen.poly(tp, { kleur: kl, lw: st.lw, dash: st.dash }); }
            else pen.poly([...P(cx - 4 * f, cy), ...P(cx + 4 * f, cy)], { kleur: kl, lw: st.lw, dash: st.dash });
          }
          const extra = b.aantallen ? (it.soort === "lijn" && it.lengte ? `  (${nl(it.lengte / 1000, 1)} m)` : `  (${it.n}×)`) : "";
          tekst(lx + 17 * f, yy, it.naam.toLowerCase() + extra, 2 * f, { semi: true, kleur: kl }); yy += rij;
        }
        yy += 3 * f;
      }
    }
  }
  // hoogteregel
  if (b.hoogteregel !== false) {
    const items = tkLegendeItems(b).filter(i => i.soort === "sym"); const per = new Map();
    items.forEach(i => { const h = tkSymInfo(i.code).hoogte; if (h == null) return; const a = per.get(h) || []; a.push(i.naam.toLowerCase()); per.set(h, a); });
    if (per.size) {
      const rg = [...per.entries()].sort((a, c) => a[0] - c[0]); const hh = 9 * f + rg.length * 3.6 * f; const hx = lh ? lx + lw : lx; const hy = lh ? ly + lh - hh : ly;
      rect(hx, hy, lw, hh, { fill: "#FFFFFF", kleur: "#D42A20", lw: 0.35 });
      tekst(hx + 4 * f, hy + 5 * f, "in geval van geen maataanduiding op plan geldt :", 1.9 * f, { semi: true, kleur: "#D42A20" });
      rg.forEach(([h, namen], i) => { const s = namen.join(", "); const max = 44; tekst(hx + 4 * f, hy + 9.4 * f + i * 3.6 * f, `H=${h}  ${s.length > max ? s.slice(0, max - 1) + "…" : s}`, 1.9 * f, { kleur: TK_BLAUW }); });
    }
  }
  // logo
  if (opt.logo) { const lwm = 34 * f, lhm = lwm * 313 / 900; pen.logo(opt.logo, P(m * 0.8, H - m * 0.8), P(m * 0.8 + lwm, H - m * 0.8 - lhm)); }
}

/* ---------- schermweergave ---------- */
function tkPaintObjecten(ctx) {
  const z = TK.view.z; const pen = tkCanvasPen(ctx, z * tkN()); const T = tkW2S;
  const [vx0, vy1] = tkS2W(-40, -40), [vx1, vy0] = tkS2W(TK.W + 40, TK.H + 40);
  for (const o of tkOrde()) { if (!tkZichtbaar(o.laag)) continue; const b = tkBBox(o); if (b[2] < vx0 || b[0] > vx1 || b[3] < vy0 || b[1] > vy1) continue; tkObjTeken(pen, o, T, z); }
}
function tkPaintBlad(ctx) {
  const b = tkBlad(); if (!b) return; const k = tkKader(b); const N = tkN(); const z = TK.view.z;
  const A = tkW2S(k.x0, k.y1), B = tkW2S(k.x1, k.y0);
  ctx.save(); ctx.fillStyle = "rgba(29,29,31,.07)"; ctx.beginPath(); ctx.rect(0, 0, TK.W, TK.H); ctx.rect(A[0], A[1], B[0] - A[0], B[1] - A[1]); ctx.fill("evenodd");
  ctx.strokeStyle = "#8E8E93"; ctx.lineWidth = 1; ctx.setLineDash([6, 4]); ctx.strokeRect(A[0], A[1], B[0] - A[0], B[1] - A[1]); ctx.setLineDash([]); ctx.restore();
  const pen = tkCanvasPen(ctx, z * N); tkPapierTeken(pen, b, (px, py) => tkW2S(k.x0 + px * N, k.y1 - py * N), z * N, { logo: TK_LOGO });
  ctx.save(); ctx.font = "600 11px -apple-system, Arial, sans-serif"; ctx.fillStyle = "#636366"; ctx.fillText(`${b.naam} · ${b.papier || TK.pl.papier || "A1"} · 1:${N}`, A[0] + 4, A[1] - 6); ctx.restore();
}
function tkPaintSelectie(ctx) {
  ctx.save(); ctx.strokeStyle = "#0071E3"; ctx.fillStyle = "#fff"; ctx.lineWidth = 1;
  if (TK.hover && !TK.sel.has(TK.hover) && TK.tool === "selectie" && !TK.op) { const o = TK.objs.get(TK.hover); if (o) { const b = tkBBox(o); const A = tkW2S(b[0], b[3]), B = tkW2S(b[2], b[1]); ctx.globalAlpha = 0.45; ctx.strokeRect(A[0] - 3, A[1] - 3, B[0] - A[0] + 6, B[1] - A[1] + 6); ctx.globalAlpha = 1; } }
  ctx.setLineDash([4, 3]);
  for (const id of TK.sel) { const o = TK.objs.get(id); if (!o) continue; const b = tkBBox(o, true); const A = tkW2S(b[0], b[3]), B = tkW2S(b[2], b[1]); ctx.strokeRect(A[0] - 3, A[1] - 3, B[0] - A[0] + 6, B[1] - A[1] + 6);
    if (o.soort === "symbool") { const lb = tkLabelBB(o); if (lb) { const C = tkW2S(lb[0], lb[3]), D = tkW2S(lb[2], lb[1]); ctx.globalAlpha = 0.6; ctx.strokeRect(C[0] - 2, C[1] - 2, D[0] - C[0] + 4, D[1] - C[1] + 4); ctx.globalAlpha = 1; } } }
  ctx.setLineDash([]);
  for (const h of tkHandles()) { const [X, Y] = tkW2S(h.x, h.y); ctx.fillRect(X - 4, Y - 4, 8, 8); ctx.strokeRect(X - 4, Y - 4, 8, 8); }
  if (TK.op && TK.op.soort === "kader") { const [a, b] = [TK.op.a, TK.op.b]; const kruis = b[0] < a[0]; ctx.fillStyle = kruis ? "rgba(46,158,79,.08)" : "rgba(0,113,227,.08)"; ctx.strokeStyle = kruis ? "#2E9E4F" : "#0071E3"; if (kruis) ctx.setLineDash([5, 3]); ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); ctx.setLineDash([]); }
  if (TK.op && TK.op.soort === "zoomkader") { const [a, b] = [TK.op.a, TK.op.b]; ctx.strokeStyle = "#636366"; ctx.setLineDash([4, 3]); ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); ctx.setLineDash([]); }
  ctx.restore();
}
function tkHandles() {   // grepen van één geselecteerd object
  if (TK.sel.size !== 1 || TK.tool !== "selectie") return []; const o = TK.objs.get([...TK.sel][0]); if (!o) return []; const g = o.geo; const h = [];
  if (o.soort === "lijn") for (let i = 0; i < g.pts.length; i += 2) h.push({ id: o.id, k: i, x: g.pts[i], y: g.pts[i + 1] });
  if (o.soort === "schakel") { h.push({ id: o.id, k: 0, x: g.pts[0], y: g.pts[1] }, { id: o.id, k: 2, x: g.pts[2], y: g.pts[3] }); const p = tkSchakelPts(o, 2); h.push({ id: o.id, k: "bocht", x: p[2], y: p[3] }); }
  if (o.soort === "maat") { const m = tkMaatGeo(o); h.push({ id: o.id, k: "a", x: g.a[0], y: g.a[1] }, { id: o.id, k: "b", x: g.b[0], y: g.b[1] }, { id: o.id, k: "off", x: (m.A[0] + m.B[0]) / 2, y: (m.A[1] + m.B[1]) / 2 }); }
  if (o.soort === "tekst" && g.px != null) h.push({ id: o.id, k: "tip", x: g.px, y: g.py });
  return h;
}
function tkPaintPreview(ctx) {
  const m = TK.mouse; const z = TK.view.z; const N = tkN(); const pen = tkCanvasPen(ctx, z * N);
  ctx.save(); ctx.globalAlpha = 0.6;
  const pts = TK.pts; const cur = m ? [m.x, m.y] : null;
  if (TK.tool === "symbool" && (cur || TK.op)) {
    const pp = TK.op && TK.op.soort === "plaats" ? TK.op.pp : tkPlaatsPunt(m); if (pp) { const o = { geo: { x: pp.x, y: pp.y }, props: { code: TK.symCode, rot: pp.rot, spiegel: TK.symSpiegel, bestaand: TK.bestaand } }; tkSymTeken(pen, o, tkW2S, z * N, tkLaagKleur(tkSymInfo(TK.symCode).laag)); }
  }
  if ((TK.tool === "lijn" || TK.tool === "polylijn") && pts.length && cur) { const st = TK_STIJLEN[TK.stijl] || TK_STIJLEN.lijn; const kl = st.kleur || tkLaagKleur(st.laag || TK.laag); const tp = []; [...pts, cur].forEach(p => tp.push(...tkW2S(p[0], p[1]))); pen.poly(tp, { kleur: kl, lw: st.lw, dash: st.dash }); const a = pts[pts.length - 1]; tkMaatTip(ctx, a, cur); }
  if (TK.tool === "schakel" && pts.length && cur) { const o = { geo: { pts: [...pts[0], ...cur] }, props: { bocht: 0.22 } }; tkObjTeken(pen, { ...o, soort: "schakel", laag: "verlichting" }, tkW2S, z); }
  if (TK.tool === "maat" && pts.length && cur) { const a = pts[0], b = pts[1] || cur; let off = 0; if (pts[1]) { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; off = ((cur[0] - a[0]) * -(b[1] - a[1]) + (cur[1] - a[1]) * (b[0] - a[0])) / L; } tkObjTeken(pen, { soort: "maat", laag: TK.laag, geo: { a, b, off }, props: {} }, tkW2S, z); }
  if (TK.tool === "callout" && pts.length && cur) { const A = tkW2S(...pts[0]), B = tkW2S(...cur); pen.poly([...A, ...B], { kleur: tkLaagKleur(TK.laag), lw: 0.18 }); }
  if ((TK.tool === "roteren" || TK.tool === "verplaats") && pts.length && cur) {
    ctx.globalAlpha = 0.9; ctx.strokeStyle = "#0071E3"; ctx.setLineDash([5, 4]); ctx.lineWidth = 1; const A = tkW2S(...pts[0]); ctx.beginPath(); ctx.moveTo(A[0], A[1]); const B = tkW2S(...cur); ctx.lineTo(B[0], B[1]); ctx.stroke(); ctx.setLineDash([]);
    const ids = TK.sel; let fn = null;
    if (TK.tool === "verplaats") { const dx = cur[0] - pts[0][0], dy = cur[1] - pts[0][1]; fn = (o) => tkVerschuif(o, dx, dy); }
    else if (pts.length === 2) { const a0 = Math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0]), a1 = Math.atan2(cur[1] - pts[0][1], cur[0] - pts[0][0]); let d = (a1 - a0) * 180 / Math.PI; if (m.shift) d = Math.round(d / 15) * 15; fn = (o) => tkRoteer(o, pts[0][0], pts[0][1], d); ctx.font = "600 12px -apple-system, Arial"; ctx.fillStyle = "#0071E3"; ctx.fillText(`${Math.round(((d % 360) + 540) % 360 - 180)}°`, B[0] + 10, B[1] - 10); }
    if (fn) { ctx.globalAlpha = 0.5; for (const id of ids) { const o = TK.objs.get(id); if (o && tkZichtbaar(o.laag)) tkObjTeken(pen, fn(tkKopie(o)), tkW2S, z); } }
  }
  ctx.restore();
}
function tkMaatTip(ctx, a, b) {   // lengte en hoek naast de cursor tijdens het tekenen
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1) return; const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI; const [X, Y] = tkW2S(...b);
  ctx.save(); ctx.globalAlpha = 1; ctx.font = "600 11px -apple-system, Arial"; const t = `L ${Math.round(L)} mm · A ${Math.round(ang * 10) / 10}°  (Tab)`; const w = ctx.measureText(t).width;
  ctx.fillStyle = "rgba(29,29,31,.82)"; ctx.fillRect(X + 12, Y + 10, w + 10, 18); ctx.fillStyle = "#fff"; ctx.fillText(t, X + 17, Y + 23); ctx.restore();
}

/* ---------- gereedschap ---------- */
const TK_SVG = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const TK_TOOLS = [
  ["selectie", "Selectie", "X", TK_SVG('<path d="M6 3l12 9-5.5 1L10 19z"/>')],
  ["hand", "Hand — verschuiven", "H of spatie", "✋"],
  ["zoom", "Zoom — klik = in, ⌥-klik = uit, sleep = kader", "C", TK_SVG('<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5L20 20M7.5 10h5M10 7.5v5"/>')],
  "|",
  ["symbool", "Symbool plaatsen — klik, of klik en sleep om te draaien", "S", TK_SVG('<circle cx="12" cy="12" r="7"/><path d="M7 7l10 10M17 7L7 17"/>')],
  ["tekst", "Tekst", "1", TK_SVG('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>')],
  ["callout", "Tekst met pijl — klik de pijlpunt, dan de tekst", "⌥1", TK_SVG('<path d="M4 20l7-7"/><circle cx="4" cy="20" r="1.6" fill="currentColor"/><path d="M13 7h8M13 11h6"/>')],
  ["lijn", "Lijn of leiding (één stuk)", "2", TK_SVG('<path d="M4 20L20 4"/>')],
  ["polylijn", "Polylijn of leiding — dubbelklik of Enter om te stoppen", "5", TK_SVG('<path d="M3 18l6-9 5 6 7-11"/>')],
  ["schakel", "Schakelverbinding — klik schakelaar, dan lichtpunt", "3", TK_SVG('<path d="M4 18Q12 2 20 18" stroke-dasharray="3 2.4"/>')],
  ["maat", "Maatlijn — twee punten, dan de afstand", "N", TK_SVG('<path d="M3 7v10M21 7v10M3 12h18"/><path d="M5 10l-2 2 2 2M19 10l2 2-2 2"/>')],
  "|",
  ["roteren", "Roteren — middelpunt, beginhoek, eindhoek", "⌥=", TK_SVG('<path d="M19.5 12a7.5 7.5 0 1 1-2.6-5.7"/><path d="M19 3.5v4.5h-4.5"/>')],
  ["verplaats", "Verplaatsen met punten — van, naar (⌥ = kopie)", "⇧M", TK_SVG('<path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>')],
  "|",
  ["meten", "Meten", "M", "📏"],
  ["kalibreren", "Kalibreren met twee punten", "K", "📐"],
];
const TK_HINT = {
  selectie: "Klik = selecteren · sleep = verplaatsen (⌥ = kopie) · sleep in het leeg = kader · ? = sneltoetsen",
  hand: "Slepen = verschuiven · scrollen/knijpen = zoomen", zoom: "Klik = inzoomen · ⌥-klik = uitzoomen · sleep een kader",
  symbool: "Klik = plaatsen · klik en sleep = draaien · ⌘L / ⌘⇧R = 90° · = spiegelen · Esc = stoppen", tekst: "Klik waar de tekst begint", callout: "Klik de pijlpunt",
  lijn: "Klik het beginpunt — Shift = recht, Tab = lengte en hoek", polylijn: "Klik de punten — dubbelklik of Enter = klaar, Backspace = laatste punt weg",
  schakel: "Klik de schakelaar", maat: "Klik het eerste punt", roteren: "Klik het middelpunt", verplaats: "Klik het beginpunt",
  meten: "Klik het eerste punt — Shift = recht, Esc = stoppen", kalibreren: "Klik het begin van een gekende maat (bv. een maatlijn of een muur)", kader: "Sleep het kader van het blad naar de juiste plaats",
};
function tkSetTool(t) {
  if (!TK) return; if (["roteren", "verplaats"].includes(t) && !TK.sel.size) { toast("Selecteer eerst wat je wil " + (t === "roteren" ? "roteren" : "verplaatsen") + " (X)"); return; }
  if (TK.op) tkOpAnnuleer(); TK.tool = t; TK.pts = []; TK.meting = null; TK.op = null; tkDlg(null); tkToolUi(); tkSideRender(); tkDraw();
}
function tkToolUi() {
  if (!TK) return; TK.el.querySelectorAll(".tk-tools [data-tk-tool]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tkTool === TK.tool)));
  const n = TK.pts.length; let hint = TK_HINT[TK.tool] || "";
  if (TK.tool === "kalibreren" && n) hint = "Klik het einde van de gekende maat"; else if (TK.tool === "meten" && n) hint = "Klik het tweede punt";
  else if (TK.tool === "lijn" && n) hint = "Klik het eindpunt — Shift = recht, Tab = lengte en hoek"; else if (TK.tool === "polylijn" && n) hint = `Volgend punt (${n} geplaatst) — dubbelklik of Enter = klaar · Tab = lengte en hoek`;
  else if (TK.tool === "schakel" && n) hint = "Klik het lichtpunt"; else if (TK.tool === "maat" && n === 1) hint = "Klik het tweede punt"; else if (TK.tool === "maat" && n === 2) hint = "Klik waar de maatlijn moet komen";
  else if (TK.tool === "callout" && n) hint = "Klik waar de tekst moet komen"; else if (TK.tool === "roteren" && n === 1) hint = "Klik de beginhoek"; else if (TK.tool === "roteren" && n === 2) hint = "Klik de eindhoek — Shift = per 15°";
  else if (TK.tool === "verplaats" && n) hint = "Klik het eindpunt — Shift = recht"; else if (TK.tool === "symbool") hint = `${tkSymInfo(TK.symCode).naam} — ` + hint;
  const h = TK.el.querySelector("[data-tk-hint]"); if (h) h.textContent = hint;
  TK.cv.style.cursor = TK.tool === "hand" || TK.space ? "grab" : TK.tool === "zoom" ? "zoom-in" : TK.tool === "selectie" ? (TK.hoverCursor || "default") : "crosshair";
}
function tkPlaatsPunt(p) {   // invoegpunt (+ draaiing) voor een symbool: wandsymbolen vangen op een muur van de dxf
  if (!p) return null; const s = SYMBOLEN[TK.symCode];
  if (s && s.wand && TK.segGrid && tkZichtbaar("onderlegger") && !p.snapObj) { const w = tkWandVang(p.X, p.Y, p.x, p.y); if (w) return w; }
  return { x: p.x, y: p.y, rot: TK.symRot };
}
function tkWandVang(X, Y, x, y) {
  const k = TK.pl.kalibratie || {}; const s = k.s || 1; const tol = 14 / TK.view.z; const { g, cell } = TK.segGrid; const r = k.rot || 0, c = Math.cos(-r), sn = Math.sin(-r);
  const dx0 = (x - (k.tx || 0)) / s, dy0 = (y - (k.ty || 0)) / s; const u = c * dx0 - sn * dy0, v = sn * dx0 + c * dy0; const tu = tol / s;
  let best = null, bd = tu; const ci = Math.floor(u / cell), cj = Math.floor(v / cell); const n = Math.ceil(tu / cell);
  for (let i = ci - n; i <= ci + n; i++) for (let j = cj - n; j <= cj + n; j++) { const a = g.get(i + "," + j); if (!a) continue; for (const sg of a) { const d = tkSegDist(u, v, sg[0], sg[1], sg[2], sg[3]); if (d < bd) { bd = d; best = sg; } } }
  if (!best) return null;
  const A = tkOlToWorld(best[0], best[1]), B = tkOlToWorld(best[2], best[3]); const dx = B[0] - A[0], dy = B[1] - A[1]; const L2 = dx * dx + dy * dy; if (!L2) return null;
  const t = Math.max(0, Math.min(1, ((x - A[0]) * dx + (y - A[1]) * dy) / L2)); const fx = A[0] + t * dx, fy = A[1] + t * dy;
  let nx = x - fx, ny = y - fy; const nl0 = Math.hypot(nx, ny); if (nl0 < 1e-6) { nx = -dy; ny = dx; } const rot = Math.round(Math.atan2(ny, nx) * 180 / Math.PI * 10) / 10;
  return { x: fx, y: fy, rot: ((rot % 360) + 360) % 360, wand: true };
}
function tkKlik(p, e) {   // een klik met een tekengereedschap (ook via de databalk)
  const pt = [p.x, p.y]; const T = TK.tool; const N = tkN();
  if (T === "tekst") { tkTekstDlg({ x: p.x, y: p.y }); return; }
  if (T === "callout") { if (!TK.pts.length) { TK.pts = [pt]; tkToolUi(); tkDraw(); return; } const tip = TK.pts[0]; TK.pts = []; tkTekstDlg({ x: p.x, y: p.y, px: tip[0], py: tip[1] }); return; }
  if (T === "lijn") { if (!TK.pts.length) { TK.pts = [pt]; tkToolUi(); tkDraw(); return; } const a = TK.pts[0]; TK.pts = []; if (Math.hypot(pt[0] - a[0], pt[1] - a[1]) < 0.5) return tkToolUi(); tkNieuwLijn([...a, ...pt]); tkToolUi(); return; }
  if (T === "polylijn") { const l = TK.pts[TK.pts.length - 1]; if (l && Math.hypot(pt[0] - l[0], pt[1] - l[1]) * TK.view.z < 4) { tkPolyKlaar(); return; } TK.pts.push(pt); tkToolUi(); tkDraw(); return; }
  if (T === "schakel") { if (!TK.pts.length) { TK.pts = [pt]; tkToolUi(); tkDraw(); return; } const a = TK.pts[0]; TK.pts = []; if (Math.hypot(pt[0] - a[0], pt[1] - a[1]) < 1) return tkToolUi(); tkNieuw([{ soort: "schakel", laag: TK_STIJLEN.schakel.laag, geo: { pts: [...a, ...pt] }, props: { bocht: 0.22 } }]); tkToolUi(); return; }
  if (T === "maat") {
    if (TK.pts.length < 2) { if (TK.pts.length === 1 && Math.hypot(pt[0] - TK.pts[0][0], pt[1] - TK.pts[0][1]) < 1) return; TK.pts.push(pt); tkToolUi(); tkDraw(); return; }
    const [a, b] = TK.pts; const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; const off = ((pt[0] - a[0]) * -(b[1] - a[1]) + (pt[1] - a[1]) * (b[0] - a[0])) / L; TK.pts = [];
    tkNieuw([{ soort: "maat", laag: TK.laag, geo: { a, b, off: Math.round(off) }, props: {} }]); tkToolUi(); return;
  }
  if (T === "roteren") {
    if (TK.pts.length < 2) { if (TK.pts.length === 1 && Math.hypot(pt[0] - TK.pts[0][0], pt[1] - TK.pts[0][1]) * TK.view.z < 3) return; TK.pts.push(pt); tkToolUi(); tkDraw(); return; }
    const [c, r] = TK.pts; const a0 = Math.atan2(r[1] - c[1], r[0] - c[0]), a1 = Math.atan2(pt[1] - c[1], pt[0] - c[0]); let d = (a1 - a0) * 180 / Math.PI; if (e && e.shiftKey) d = Math.round(d / 15) * 15;
    TK.pts = []; tkWijzig(o => tkRoteer(o, c[0], c[1], d)); tkSetTool("selectie"); return;
  }
  if (T === "verplaats") {
    if (!TK.pts.length) { TK.pts = [pt]; tkToolUi(); tkDraw(); return; } const a = TK.pts[0]; TK.pts = []; const dx = pt[0] - a[0], dy = pt[1] - a[1];
    if (e && e.altKey) tkKopieMet(dx, dy); else tkWijzig(o => tkVerschuif(o, dx, dy)); tkSetTool("selectie"); return;
  }
}
function tkNieuwLijn(pts) {
  const st = TK_STIJLEN[TK.stijl] || TK_STIJLEN.lijn; const props = { stijl: TK.stijl }; if (TK.diam && ["kw", "ww", "afvoer"].includes(TK.stijl)) props.diam = TK.diam; if (TK.bestaand) props.bestaand = true;
  tkNieuw([{ soort: "lijn", laag: st.laag || TK.laag, geo: { pts }, props }]);
}
function tkPolyKlaar() { const pts = TK.pts; TK.pts = []; if (pts.length >= 2) tkNieuwLijn(pts.flat()); tkToolUi(); tkDraw(); }
function tkKopieMet(dx, dy, ids = TK.sel) { const rows = [...ids].map(id => TK.objs.get(id)).filter(Boolean).map(o => { const n = tkVerschuif(tkKopie(o), dx, dy); delete n.id; return n; }); return tkNieuw(rows); }
function tkPlaatsSymbool(pp) {
  const props = { code: TK.symCode, rot: Math.round((pp.rot || 0) * 10) / 10 }; if (TK.symSpiegel) props.spiegel = true; if (TK.kring) props.kring = TK.kring; if (TK.bestaand) props.bestaand = true;
  tkNieuw([{ soort: "symbool", laag: tkSymInfo(TK.symCode).laag, geo: { x: pp.x, y: pp.y }, props }], { selecteer: false });   // zijpaneel blijft rustig tijdens het plaatsen
}

/* ---------- invoer: muis ---------- */
function tkDown(e) {
  if (!TK || TK.dlgOpen) return; TK.cv.setPointerCapture(e.pointerId); TK.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (TK.pointers.size === 2) { const [a, b] = [...TK.pointers.values()]; TK.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; TK.drag = null; return; }
  if (e.button === 1 || e.button === 2 || TK.tool === "hand" || TK.space) { TK.drag = { x: e.clientX, y: e.clientY, cx: TK.view.cx, cy: TK.view.cy }; TK.cv.style.cursor = "grabbing"; return; }
  if (e.button !== 0) return;
  const p = tkPunt(e, e.shiftKey && tkOrtho()); TK.down = { X: p.X, Y: p.Y, x: p.x, y: p.y, t: Date.now() };
  const T = TK.tool;
  if (T === "selectie") return tkSelDown(e, p);
  if (T === "zoom") { TK.op = { soort: "zoomkader", a: [p.X, p.Y], b: [p.X, p.Y], alt: e.altKey }; return; }
  if (T === "kader") { const b = tkBlad(); if (b) { const k = tkKader(b); TK.op = { soort: "blad", start: [p.x, p.y], c0: [k.cx, k.cy], k0: b.kader ? { ...b.kader } : null }; } return; }
  if (T === "symbool") { const pp = tkPlaatsPunt(p); TK.op = { soort: "plaats", pp, start: [p.X, p.Y] }; tkDraw(); return; }
  if (T === "meten") { if (TK.pts.length >= 2) TK.pts = []; TK.pts.push([p.x, p.y]); if (TK.pts.length === 2) TK.meting = tkAfstand(TK.pts[0], TK.pts[1]); tkToolUi(); tkDraw(); return; }
  if (T === "kalibreren") { TK.pts.push([p.x, p.y]); tkToolUi(); tkDraw(); if (TK.pts.length === 2) tkKalibreerDlg(); return; }
  tkKlik(p, e);
}
const tkOrtho = () => !(TK.tool === "roteren" || (TK.tool === "maat" && TK.pts.length === 2) || TK.tool === "symbool");
function tkSelDown(e, p) {
  const tol = 6 / TK.view.z;
  const h = tkHandles().find(q => { const [X, Y] = tkW2S(q.x, q.y); return Math.abs(X - p.X) < 7 && Math.abs(Y - p.Y) < 7; });
  if (h) { const o = TK.objs.get(h.id); TK.op = { soort: "punt", id: h.id, k: h.k, orig: tkKopie(o), ids: new Set([h.id]) }; return; }
  const hit = tkHit(p.x, p.y, tol);
  if (hit) {
    if (hit.deel === "label" && TK.sel.has(hit.id) && TK.sel.size === 1) { const o = TK.objs.get(hit.id); const [lx, ly] = tkLabelPos(o); TK.op = { soort: "label", id: hit.id, start: [p.x, p.y], l0: [lx, ly], orig: tkKopie(o), ids: new Set([hit.id]) }; return; }
    if (e.shiftKey) { TK.sel.has(hit.id) ? TK.sel.delete(hit.id) : TK.sel.add(hit.id); tkSelGewijzigd(); return; }
    if (!TK.sel.has(hit.id)) { TK.sel = new Set([hit.id]); tkSelGewijzigd(); }
    TK.op = { soort: "verplaats", start: [p.x, p.y], kopie: e.altKey, orig: null, ids: new Set(TK.sel) };
  } else {
    if (!e.shiftKey && TK.sel.size) { TK.sel.clear(); tkSelGewijzigd(); }
    TK.op = { soort: "kader", a: [p.X, p.Y], b: [p.X, p.Y], shift: e.shiftKey };
  }
}
function tkMove(e) {
  if (!TK) return; if (TK.pointers.has(e.pointerId)) TK.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (TK.pinch && TK.pointers.size === 2) { const [a, b] = [...TK.pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; const r = TK.cv.getBoundingClientRect();
    TK.view.cx -= (mx - TK.pinch.mx) / TK.view.z; TK.view.cy += (my - TK.pinch.my) / TK.view.z; tkZoomAt(mx - r.left, my - r.top, d / TK.pinch.d); TK.pinch = { d, mx, my }; return; }
  if (TK.drag) { TK.view.cx = TK.drag.cx - (e.clientX - TK.drag.x) / TK.view.z; TK.view.cy = TK.drag.cy + (e.clientY - TK.drag.y) / TK.view.z; tkDraw(); return; }
  const op = TK.op; const p = tkPunt(e, e.shiftKey && !(op && op.soort === "verplaats") && tkOrtho()); p.shift = e.shiftKey; TK.mouse = p; if (p.snap) tkVerwerf(p.snap);
  const xy = TK.el.querySelector("[data-tk-xy]"); if (xy) xy.textContent = `X ${nl(Math.round(p.x))}  ·  Y ${nl(Math.round(p.y))} mm${p.snap ? "  ·  ▪ " + p.snap.soort : p.gids ? "  ·  ┆ uitgelijnd" : ""}`;
  if (op) {
    if (op.soort === "verplaats") {
      let dx = p.x - op.start[0], dy = p.y - op.start[1]; if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      if (!op.orig) { if (Math.hypot(p.X - TK.down.X, p.Y - TK.down.Y) < 4) return;
        if (op.kopie) { const ids = tkKopieMet(0, 0); op.nieuw = true; op.ids = new Set(ids); TK.undo.pop(); }   // kopie maken, maar als één stap bewaren bij loslaten
        op.orig = new Map([...op.ids].map(id => [id, tkKopie(TK.objs.get(id))])); op.refs = [...op.orig.values()].flatMap(o => tkObjPunten(o)).slice(0, 120); }
      op.gids = null;
      if (!p.snap && !(e.metaKey || e.ctrlKey) && op.refs && op.refs.length) {   // slimme hulplijnen: de punten van wat je versleept, lijnen uit op andere grijppunten
        TK.uitlijnC = null; const vast = e.shiftKey ? (dy === 0 ? { y: true } : { x: true }) : {}; const u = tkUitlijn(op.refs, dx, dy, vast); dx += u.cx; dy += u.cy; op.gids = u.gids.length ? u.gids : null;
      }
      for (const [id, o] of op.orig) TK.objs.set(id, tkVerschuif(tkKopie(o), dx, dy)); TK.orde = null; op.d = [dx, dy];
    } else if (op.soort === "kader" || op.soort === "zoomkader") op.b = [p.X, p.Y];
    else if (op.soort === "blad") { const b = tkBlad(); if (b) { b.kader = { cx: op.c0[0] + (p.x - op.start[0]), cy: op.c0[1] + (p.y - op.start[1]) }; } }
    else if (op.soort === "label") { const o = TK.objs.get(op.id); const N = tkN(); const nx = op.l0[0] + p.x - op.start[0], ny = op.l0[1] + p.y - op.start[1]; o.props.lo = [(nx - o.geo.x) / N, (ny - o.geo.y) / N]; }
    else if (op.soort === "punt") { TK.objs.set(op.id, tkGreep(tkKopie(op.orig), op.k, p)); TK.orde = null; }
    else if (op.soort === "plaats") { const d = Math.hypot(p.X - op.start[0], p.Y - op.start[1]); if (d > 8) { let a = Math.atan2(-(p.Y - op.start[1]), p.X - op.start[0]) * 180 / Math.PI; if (!e.altKey) a = Math.round(a / 15) * 15; op.pp = { ...op.pp, rot: ((a % 360) + 360) % 360 }; op.gedraaid = true; } }
  } else if (TK.tool === "selectie") {
    const hit = tkHit(p.x, p.y, 6 / TK.view.z); const h = tkHandles().some(q => { const [X, Y] = tkW2S(q.x, q.y); return Math.abs(X - p.X) < 7 && Math.abs(Y - p.Y) < 7; });
    TK.hover = hit ? hit.id : null; const c = h ? "crosshair" : hit ? (hit.deel === "label" && TK.sel.has(hit.id) ? "move" : "pointer") : "default"; if (c !== TK.hoverCursor) { TK.hoverCursor = c; TK.cv.style.cursor = c; }
  }
  tkDraw();
}
function tkGreep(o, k, p) {
  const g = o.geo;
  if (o.soort === "lijn" || (o.soort === "schakel" && k !== "bocht")) { g.pts[k] = p.x; g.pts[k + 1] = p.y; }
  else if (o.soort === "schakel") { const [ax, ay, bx, by] = g.pts; const dx = bx - ax, dy = by - ay; const L2 = dx * dx + dy * dy || 1; o.props.bocht = Math.max(-1, Math.min(1, ((p.x - (ax + bx) / 2) * -dy + (p.y - (ay + by) / 2) * dx) / L2)); o.props.bocht = Math.round(o.props.bocht * 100) / 100; }
  else if (o.soort === "maat") { if (k === "a") g.a = [p.x, p.y]; else if (k === "b") g.b = [p.x, p.y]; else { const m = tkMaatGeo(o); g.off = Math.round((p.x - g.a[0]) * m.nx + (p.y - g.a[1]) * m.ny); } }
  else if (o.soort === "tekst") { g.px = p.x; g.py = p.y; }
  return o;
}
function tkUp(e) {
  if (!TK) return; TK.pointers.delete(e.pointerId); if (TK.pointers.size < 2) TK.pinch = null;
  if (TK.drag) { TK.drag = null; tkToolUi(); tkViewSaveLater(); tkDraw(); return; }
  const op = TK.op; const p = TK.mouse;
  if (op) {
    TK.op = null;
    if (op.soort === "verplaats") { if (op.orig) { const voor = [...op.orig].map(([id, o]) => [id, op.nieuw ? null : o]); const na = [...op.orig.keys()].map(id => [id, TK.objs.get(id)]); for (const [id, o] of op.orig) TK.objs.set(id, o); tkDoe(voor, na); TK.sel = new Set(op.ids); tkSideRender(); } }
    else if (op.soort === "kader") {
      const [a, b] = [op.a, op.b]; if (Math.abs(b[0] - a[0]) > 3 || Math.abs(b[1] - a[1]) > 3) {
        const w1 = tkS2W(Math.min(a[0], b[0]), Math.max(a[1], b[1])), w2 = tkS2W(Math.max(a[0], b[0]), Math.min(a[1], b[1])); const R = [w1[0], w1[1], w2[0], w2[1]]; const kruis = b[0] < a[0];
        for (const o of TK.objs.values()) { if (!tkZichtbaar(o.laag)) continue; const q = tkBBox(o, true); const binnen = q[0] >= R[0] && q[2] <= R[2] && q[1] >= R[1] && q[3] <= R[3]; const raakt = !(q[2] < R[0] || q[0] > R[2] || q[3] < R[1] || q[1] > R[3]); if (kruis ? raakt : binnen) TK.sel.add(o.id); }
        tkSelGewijzigd();
      }
    }
    else if (op.soort === "zoomkader") {
      const [a, b] = [op.a, op.b]; tkViewPush();
      if (Math.abs(b[0] - a[0]) < 6 && Math.abs(b[1] - a[1]) < 6) tkZoomAt(a[0], a[1], op.alt || (e && e.altKey) ? 0.5 : 2);
      else { const w1 = tkS2W(Math.min(a[0], b[0]), Math.max(a[1], b[1])), w2 = tkS2W(Math.max(a[0], b[0]), Math.min(a[1], b[1])); TK.view = { cx: (w1[0] + w2[0]) / 2, cy: (w1[1] + w2[1]) / 2, z: Math.min(TK.W / ((w2[0] - w1[0]) || 1), TK.H / ((w2[1] - w1[1]) || 1)) * 0.96 }; TK.sharpKey = ""; tkViewSaveLater(); }
    }
    else if (op.soort === "blad") tkSaveLagen();
    else if (op.soort === "label" || op.soort === "punt") { const n = tkKopie(TK.objs.get(op.id)); TK.objs.set(op.id, op.orig); if (JSON.stringify(n) !== JSON.stringify(op.orig)) tkDoe([[op.id, op.orig]], [[op.id, n]]); }
    else if (op.soort === "plaats") { if (op.pp) { if (op.gedraaid) TK.symRot = op.pp.rot; tkPlaatsSymbool(op.pp); } }
    tkDraw(); return;
  }
  // klik en sleep met lijn, schakelverbinding of maat: loslaten = tweede punt
  if (p && TK.down && TK.pts.length === 1 && ["lijn", "schakel"].includes(TK.tool) && Math.hypot(p.X - TK.down.X, p.Y - TK.down.Y) > 10) tkKlik(p, e);
}
function tkOpAnnuleer() {
  const op = TK.op; if (!op) return; TK.op = null;
  if (op.soort === "verplaats" && op.orig) {
    for (const [id, o] of op.orig) {
      if (op.nieuw) { TK.objs.delete(id); TK.dirty.delete(id); TK.sel.delete(id); TK.weg.add(id); }   // kopie kan al bewaard zijn → ook in de database weg
      else { TK.objs.set(id, o); if (TK.dirty.has(id)) TK.dirty.add(id); }
    }
    TK.orde = null; if (op.nieuw) tkBewaarLater();
  }
  if ((op.soort === "label" || op.soort === "punt") && op.orig) { TK.objs.set(op.id, op.orig); TK.orde = null; }
  if (op.soort === "blad") { const b = tkBlad(); if (b) { if (op.k0) b.kader = op.k0; else delete b.kader; } }
  tkSideLater();
}
function tkDbl(e) {
  if (!TK || TK.dlgOpen) return; const r = TK.cv.getBoundingClientRect(); const [x, y] = tkS2W(e.clientX - r.left, e.clientY - r.top);
  if (TK.tool === "polylijn") { if (TK.pts.length >= 2) tkPolyKlaar(); return; }
  if (TK.tool !== "selectie") return; const hit = tkHit(x, y, 6 / TK.view.z); if (!hit) return; const o = TK.objs.get(hit.id);
  if (o.soort === "tekst") tkTekstDlg(null, o);
  else { TK.sel = new Set([o.id]); TK.open.selectie = true; tkSideRender(); const f = TK.el.querySelector(o.soort === "symbool" ? "[data-tk-prop=kring]" : "[data-tk-prop]"); if (f) f.focus(); }
}
function tkSelGewijzigd() { tkSideLater(); tkDraw(); }
let tkSideRaf = 0; function tkSideLater() { if (tkSideRaf) return; tkSideRaf = requestAnimationFrame(() => { tkSideRaf = 0; tkSideRender(); }); }
const tkViewPush = () => { TK.views.push({ ...TK.view }); if (TK.views.length > 30) TK.views.shift(); };
function tkFitAlles() {
  tkViewPush(); const b = tkOlBBox(); for (const o of TK.objs.values()) { if (!tkZichtbaar(o.laag)) continue; const q = tkBBox(o); b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[2]); b[3] = Math.max(b[3], q[3]); }
  const bw = b[2] - b[0] || 1, bh = b[3] - b[1] || 1; TK.view = { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, z: Math.min(TK.W / bw, TK.H / bh) * 0.94 }; TK.sharpKey = ""; tkViewSaveLater(); tkDraw();
}
function tkFitBlad() { const b = tkBlad(); if (!b) return tkFitAlles(); tkViewPush(); const k = tkKader(b); TK.view = { cx: k.cx, cy: k.cy, z: Math.min(TK.W / (k.x1 - k.x0), TK.H / (k.y1 - k.y0)) * 0.94 }; TK.sharpKey = ""; tkViewSaveLater(); tkDraw(); }

/* ---------- invoer: toetsenbord (zoals Vectorworks) ---------- */
function tkKey(e) {
  if (!TK) return; const ae = document.activeElement;
  if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) { if (e.key === "Escape") { ae.blur(); if (TK.dlgOpen) tkDlgSluit(); e.preventDefault(); } return; }
  if ($("#modalBg")?.classList.contains("show")) return;
  const k = e.key, c = e.code, mod = e.metaKey || e.ctrlKey, kl = (k || "").toLowerCase();
  if (k === " ") { if (!TK.space) { TK.space = true; tkToolUi(); } e.preventDefault(); return; }
  if (TK.dlgOpen) { if (k === "Escape") { tkDlgSluit(); e.preventDefault(); } return; }
  const stop = () => { e.preventDefault(); e.stopPropagation(); };
  if (TK.op && TK.op.soort !== "plaats" && k !== "Escape") { stop(); return; }   // eerst de sleepbeweging afmaken
  if (k === "Escape") {
    if (TK.op) { tkOpAnnuleer(); }
    else if (TK.tool === "polylijn" && TK.pts.length >= 2) tkPolyKlaar();
    else if (TK.pts.length || TK.meting) { TK.pts = []; TK.meting = null; }
    else if (TK.sel.size) { TK.sel.clear(); tkSideRender(); }
    else if (TK.tool !== "selectie") return tkSetTool("selectie");
    tkToolUi(); tkDraw(); stop(); return;
  }
  if (mod) {
    const sh = e.shiftKey, alt = e.altKey; let ok = true;
    if (kl === "z" && !sh) tkUndo(); else if (kl === "y" || (kl === "z" && sh)) tkRedo();
    else if (kl === "a") tkSelAlles(); else if (kl === "c") tkKopieer(false); else if (kl === "x") tkKopieer(true);
    else if (kl === "v" && sh) tkSpiegelSel("v"); else if (kl === "v" || c === "KeyV") tkPlak(alt);
    else if (kl === "d") tkDupliceer(); else if (kl === "m" || (alt && c === "KeyM")) tkVerplaatsDlg();
    else if (kl === "l" && !sh) tkDraai90(90); else if (kl === "r" && sh) tkDraai90(-90); else if (kl === "h" && sh) tkSpiegelSel("h");
    else if (kl === "f" && !sh) tkVolgorde(1); else if (kl === "b" && !sh) tkVolgorde(-1);
    else if (c === "Digit6") tkFitAlles(); else if (c === "Digit4") tkFitBlad();
    else if (c === "Digit1" || k === "=" || k === "+") { tkViewPush(); tkZoomAt(TK.W / 2, TK.H / 2, 2); } else if (c === "Digit2" || k === "-") { tkViewPush(); tkZoomAt(TK.W / 2, TK.H / 2, 0.5); }
    else if (sh && (k === "," || k === "<" || k === "?" || c === "Comma")) tkVorigeView();
    else if (k.startsWith("Arrow") && sh) tkNudge(k, 100);
    else if (kl === "s") tkFlush(true);
    else ok = false;
    if (ok) stop(); return;
  }
  if (e.altKey) {
    if (c === "Digit1") { tkSetTool("callout"); stop(); } else if (c === "Equal" || k === "≠" || k === "=") { tkSetTool("roteren"); stop(); } return;
  }
  if (k === "Enter") { if (TK.tool === "polylijn") tkPolyKlaar(); else if (TK.sel.size === 1) { const o = TK.objs.get([...TK.sel][0]); if (o && o.soort === "tekst") tkTekstDlg(null, o); } stop(); return; }
  if (k === "Backspace" || k === "Delete") { if (TK.tool === "polylijn" && TK.pts.length) { TK.pts.pop(); tkToolUi(); tkDraw(); } else if (TK.sel.size) tkVerwijderSel(); stop(); return; }
  if (k === "Tab") { if (TK.pts.length && ["lijn", "polylijn", "schakel", "maat", "verplaats"].includes(TK.tool) && !(TK.tool === "maat" && TK.pts.length > 1)) tkDatabalk(""); stop(); return; }
  const cm = /^(Digit|Numpad)(\d)$/.exec(c || "");
  if (cm && !e.altKey && TK.pts.length && ["lijn", "polylijn", "maat", "verplaats"].includes(TK.tool) && !(TK.tool === "maat" && TK.pts.length > 1)) { tkDatabalk(cm[2]); stop(); return; }
  if (k.startsWith("Arrow")) { if (e.shiftKey && TK.sel.size) tkNudge(k, 10); else { const d = 80 / TK.view.z; if (k === "ArrowLeft") TK.view.cx -= d; if (k === "ArrowRight") TK.view.cx += d; if (k === "ArrowUp") TK.view.cy += d; if (k === "ArrowDown") TK.view.cy -= d; tkViewSaveLater(); tkDraw(); } stop(); return; }
  const cijfer = { Digit1: "tekst", Digit2: "lijn", Digit3: "schakel", Digit5: "polylijn" }[c];
  if (cijfer && !e.shiftKey) { tkSetTool(cijfer); stop(); return; }
  if (e.shiftKey && kl === "m") { tkSetTool("verplaats"); stop(); return; }
  const map = { x: "selectie", h: "hand", c: "zoom", s: "symbool", n: "maat", m: "meten", k: "kalibreren" };
  if (map[kl] && !e.shiftKey) { if (kl === "x" && TK.tool === "selectie" && TK.sel.size) { TK.sel.clear(); tkSideRender(); tkDraw(); } else tkSetTool(map[kl]); stop(); return; }
  if (k === "=") { if (TK.tool === "symbool") { TK.symSpiegel = !TK.symSpiegel; tkDraw(); } else tkSpiegelSel("h"); stop(); return; }
  if (kl === "f") { tkFitAlles(); stop(); return; }
  if (k === "+") { tkZoomAt(TK.W / 2, TK.H / 2, 1.4); stop(); return; }
  if (k === "-" || k === "_") { tkZoomAt(TK.W / 2, TK.H / 2, 1 / 1.4); stop(); return; }
  if (k === "?") { tkHulp(); stop(); }
}
function tkKeyUp(e) { if (TK && e.key === " ") { TK.space = false; tkToolUi(); } }
function tkNudge(k, mm) { if (!TK.sel.size) return; const dx = k === "ArrowLeft" ? -mm : k === "ArrowRight" ? mm : 0, dy = k === "ArrowUp" ? mm : k === "ArrowDown" ? -mm : 0; tkWijzig(o => tkVerschuif(o, dx, dy)); }
function tkVorigeView() { const v = TK.views.pop(); if (!v) return; TK.view = v; TK.sharpKey = ""; tkViewSaveLater(); tkDraw(); }
function tkSelAlles() { TK.sel = new Set([...TK.objs.values()].filter(o => tkZichtbaar(o.laag)).map(o => o.id)); if (TK.tool !== "selectie") TK.tool = "selectie"; tkToolUi(); tkSideRender(); tkDraw(); }
function tkVerwijderSel() { const n = TK.sel.size; tkWijzig(() => null); TK.sel.clear(); tkSideRender(); if (n > 1) toast(`${n} objecten verwijderd — ⌘Z = ongedaan maken`); }
function tkKopieer(knip) {
  if (!TK.sel.size) return; const rows = [...TK.sel].map(id => tkKopie(TK.objs.get(id))).filter(Boolean); const b = tkSelBBox(); TK_KLEMBORD = { rows, c: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], N: tkN() };
  try { localStorage.setItem("bros.tk.klembord", JSON.stringify(TK_KLEMBORD)); } catch (e) { }
  if (knip) tkVerwijderSel(); else toast(`${rows.length} gekopieerd`);
}
function tkPlak(opPlaats) {
  let kb = TK_KLEMBORD; if (!kb) try { kb = JSON.parse(localStorage.getItem("bros.tk.klembord") || "null"); } catch (e) { } if (!kb || !kb.rows.length) return toast("Niets om te plakken");
  let dx = 0, dy = 0; if (!opPlaats) { const m = TK.mouse ? [TK.mouse.x, TK.mouse.y] : [TK.view.cx, TK.view.cy]; dx = m[0] - kb.c[0]; dy = m[1] - kb.c[1]; }
  tkNieuw(kb.rows.map(r => { const n = tkVerschuif(tkKopie(r), dx, dy); delete n.id; delete n.z; return n; })); TK.tool = "selectie"; tkToolUi();
}
function tkDupliceer() { if (!TK.sel.size) return; const d = 4 * tkN(); tkKopieMet(d, -d); TK.tool = "selectie"; tkToolUi(); }
function tkDraai90(gr) { if (!TK.sel.size) { if (TK.tool === "symbool") { TK.symRot = (((TK.symRot + gr) % 360) + 360) % 360; tkDraw(); } return; } const c = tkSelMidden(); if (TK.sel.size === 1) { const o = TK.objs.get([...TK.sel][0]); if (o.soort === "symbool") return tkWijzig(n => { n.props.rot = ((((n.props.rot || 0) + gr) % 360) + 360) % 360; delete n.props.lo; return n; }); } tkWijzig(o => tkRoteer(o, c[0], c[1], gr)); }
function tkSpiegelSel(as) { if (!TK.sel.size) { if (TK.tool === "symbool") { TK.symSpiegel = !TK.symSpiegel; tkDraw(); } return; } const c = tkSelMidden(); tkWijzig(o => tkSpiegel(o, c[0], c[1], as)); }
function tkVolgorde(r) { const zs = [...TK.objs.values()].map(o => o.z || 0); let z = r > 0 ? Math.max(0, ...zs) : Math.min(0, ...zs); tkWijzig(o => { z += r; o.z = z; return o; }); }
function tkVerplaatsDlg() {
  if (!TK.sel.size) return toast("Selecteer eerst iets (X)");
  tkDlg(`<div class="tk-h">Verplaatsen (⌘M)</div><form data-tk-mv><div class="tk-f"><label>X</label><input name="x" inputmode="decimal" value="0" autocomplete="off"><label>Y</label><input name="y" inputmode="decimal" value="0" autocomplete="off"><label></label><label><input type="checkbox" name="kopie"> als kopie</label></div>
    <div class="tk-btns" style="justify-content:flex-end"><button type="button" class="btn sm" data-tk-dlg-nee>Annuleren</button><button class="btn sm primary">Verplaatsen</button></div><div class="muted" style="font-size:11px;margin-top:6px">In mm; X naar rechts, Y naar boven.</div></form>`);
  const f = TK.el.querySelector("[data-tk-mv]"); f.x.select();
  f.onsubmit = (e) => { e.preventDefault(); const dx = tkGetal(f.x.value) || 0, dy = tkGetal(f.y.value) || 0; const kopie = f.kopie.checked; tkDlgSluit(); if (!dx && !dy) return; if (kopie) tkKopieMet(dx, dy); else tkWijzig(o => tkVerschuif(o, dx, dy)); };
}
function tkDlgSluit() { tkDlg(null); if (TK.tool === "kalibreren") TK.pts = []; tkToolUi(); tkDraw(); }
function tkDatabalk(begin) {   // Vectorworks-databalk: lengte en hoek intikken
  const a = TK.pts[TK.pts.length - 1]; const m = TK.mouse ? [TK.mouse.x, TK.mouse.y] : a; const L0 = Math.round(Math.hypot(m[0] - a[0], m[1] - a[1])); const A0 = Math.round(Math.atan2(m[1] - a[1], m[0] - a[0]) * 1800 / Math.PI) / 10;
  tkDlg(`<form data-tk-db><div class="tk-h">Lengte en hoek</div><div class="tk-f"><label>L (mm)</label><input name="l" inputmode="decimal" value="${begin || L0}" autocomplete="off"><label>A (°)</label><input name="a" inputmode="decimal" value="${A0}" autocomplete="off"></div>
    <div class="tk-btns" style="justify-content:flex-end"><button type="button" class="btn sm" data-tk-dlg-nee>Annuleren</button><button class="btn sm primary">OK (Enter)</button></div><div class="muted" style="font-size:11px;margin-top:6px">Hoek: 0° = rechts, 90° = boven. Tab = volgend veld.</div></form>`);
  const f = TK.el.querySelector("[data-tk-db]"); setTimeout(() => { f.l.focus(); if (begin) { const v = f.l.value; f.l.setSelectionRange(v.length, v.length); } else f.l.select(); }, 20);
  f.onsubmit = (e) => { e.preventDefault(); const L = tkGetal(f.l.value), A = tkGetal(f.a.value) ?? 0; if (!(L > 0)) return; tkDlg(null); const r = A * Math.PI / 180; const x = a[0] + L * Math.cos(r), y = a[1] + L * Math.sin(r); const [X, Y] = tkW2S(x, y); tkKlik({ x, y, X, Y }, { shiftKey: false, altKey: false }); tkDraw(); };
}
function tkTekstDlg(pos, bestaand) {
  const p = bestaand ? bestaand.props : { h: TK.tekstH, pijl: "pijl" }; const callout = bestaand ? bestaand.geo.px != null : pos && pos.px != null;
  tkDlg(`<form data-tk-tx><div class="tk-h">${bestaand ? "Tekst wijzigen" : callout ? "Tekst met pijl" : "Tekst"}</div>
    <textarea name="t" rows="3" style="width:100%;font:inherit;font-size:14px;padding:6px 8px;border:1px solid var(--line-2);border-radius:8px;resize:vertical" placeholder="bv. voeding LED in sokkel kast voorzien door schrijnwerker">${esc(p.tekst || "")}</textarea>
    <div class="tk-f" style="margin-top:8px"><label>Grootte</label><select name="h">${opts([["1.6", "1,6 mm (klein)"], ["2", "2 mm"], ["2.5", "2,5 mm"], ["3.5", "3,5 mm"], ["5", "5 mm (titel)"]], String(p.h || 2))}</select>
    ${callout ? `<label>Pijlpunt</label><select name="pijl">${opts([["pijl", "pijl"], ["punt", "punt"]], p.pijl || "pijl")}</select>` : ""}<label>Laag</label><select name="laag">${opts(TK_LAGEN.filter(l => l[0] !== "onderlegger"), bestaand ? bestaand.laag : TK.laag)}</select></div>
    <div class="tk-btns" style="justify-content:flex-end"><button type="button" class="btn sm" data-tk-dlg-nee>Annuleren</button><button class="btn sm primary">${bestaand ? "Bewaren" : "Plaatsen"} (⌘Enter)</button></div></form>`);
  const f = TK.el.querySelector("[data-tk-tx]"); setTimeout(() => f.t.focus(), 20);
  f.t.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); f.requestSubmit(); } });
  f.onsubmit = (e) => {
    e.preventDefault(); const t = f.t.value.replace(/\s+$/, ""); const h = Number(f.h.value) || 2; const laag = f.laag.value; tkDlg(null); TK.tekstH = h; TK.laag = laag;
    if (bestaand) { if (!t.trim()) { tkWijzig(() => null, [bestaand.id]); return; } tkWijzig(o => { o.props.tekst = t; o.props.h = h; o.laag = laag; if (f.pijl) o.props.pijl = f.pijl.value; return o; }, [bestaand.id]); return; }
    if (!t.trim()) return; const geo = { x: pos.x, y: pos.y };
    if (callout) { geo.px = pos.px; geo.py = pos.py; const N = tkN(); const w = Math.max(...t.split("\n").map(s => tkTxtW(s, h * N))); if (pos.px > pos.x) geo.x = pos.x - w; geo.y = pos.y + h * N * 0.6; }
    tkNieuw([{ soort: "tekst", laag, geo, props: { tekst: t, h, ...(callout ? { pijl: f.pijl ? f.pijl.value : "pijl" } : {}) } }]); tkToolUi(); tkDraw();
  };
}

/* ---------- zijpaneel ---------- */
const tkSec = (key, titel, inhoud, std = true) => `<details class="tk-sec" data-tk-sec="${key}" ${(TK.open[key] ?? std) ? "open" : ""}><summary class="tk-h">${titel}</summary>${inhoud}</details>`;
function tkSideRender() {
  if (!TK) return; const side = TK.el.querySelector("[data-tk-side]"); if (!side) return; const st = side.scrollTop; const pl = TK.pl;
  if (side.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName) && !TK.forceSide) { TK.sideUitgesteld = true; return; }
  side.innerHTML = [tkSecSelectie(), tkSecSymbolen(), tkSecTekenen(), tkSecBladen(), tkSecLagen(), tkSecTelling(), tkSecOnderlegger(), tkSecSchaal(),
    `<div class="tk-sec"><button class="btn ghost sm danger" data-tk="verwijder">Plan verwijderen</button></div>`].join("");
  side.scrollTop = st; tkPaletIconen();
  const pill = TK.el.querySelector("[data-tk-schaalpill]"); if (pill) { pill.textContent = tkOnSchaal(pl) ? tkBronTekst(pl) : "⚠ nog niet op schaal"; pill.className = "pill " + (tkOnSchaal(pl) ? "done" : "vs-open"); }
  const sl = TK.el.querySelector("[data-tk-sel]"); if (sl) sl.textContent = TK.sel.size ? `${TK.sel.size} geselecteerd` : `${TK.objs.size} object${TK.objs.size === 1 ? "" : "en"}`;
  tkToolUi();
}
const tkLaagOpts = (sel, alleen) => opts(TK_LAGEN.filter(l => l[0] !== "onderlegger" && (!alleen || alleen.includes(l[0]))).map(l => [l[0], l[1]]), sel);
function tkSecSelectie() {
  if (!TK.sel.size) return "";
  const os = [...TK.sel].map(id => TK.objs.get(id)).filter(Boolean); if (!os.length) return ""; const een = os.length === 1 ? os[0] : null; const soorten = new Set(os.map(o => o.soort));
  const knoppen = `<div class="tk-btns"><button class="btn sm" data-tk="r90" title="90° naar links (⌘L)">⟲ 90°</button><button class="btn sm" data-tk="r-90" title="90° naar rechts (⌘⇧R)">⟳ 90°</button><button class="btn sm" data-tk="spiegel" title="Spiegelen (= of ⌘⇧H)">⇋</button><button class="btn sm" data-tk="dupl" title="Dupliceren (⌘D)">⧉</button><button class="btn sm" data-tk="mv" title="Verplaatsen met X/Y in mm (⌃M — in Safari minimaliseert ⌘M het venster)">X/Y</button><button class="btn sm danger" data-tk="wis" title="Verwijderen (Backspace)">🗑</button></div>`;
  const best = (o) => `<label>Status</label><select data-tk-prop="bestaand">${opts([["0", "nieuw"], ["1", "bestaand (blauw)"]], (o ? o.props?.bestaand : os.every(x => x.props?.bestaand)) ? "1" : "0")}</select>`;
  let f = "";
  if (een && een.soort === "symbool") {
    const p = een.props; const si = tkSymInfo(p.code);
    const symOpts = TK_GROEPEN.map(([g, gn]) => `<optgroup label="${esc(gn)}">${opts(Object.keys(SYMBOLEN).filter(c => tkSymInfo(c).groep === g).map(c => [c, tkSymInfo(c).naam]), p.code)}</optgroup>`).join("");
    f = `<div class="tk-f"><label>Symbool</label><select data-tk-prop="code">${symOpts}</select>${best(een)}
      <label>Kring</label><input data-tk-prop="kring" value="${esc(p.kring || "")}" placeholder="bv. C0.1" autocomplete="off">
      <label>Hoogte</label><input data-tk-prop="hoogte" value="${p.hoogte ?? ""}" inputmode="decimal" placeholder="${si.hoogte != null ? "standaard " + si.hoogte : "—"}" autocomplete="off">
      <label>Label</label><textarea data-tk-prop="label" rows="2" placeholder="bv. type K1">${esc(p.label || "")}</textarea>
      <label>Rotatie</label><input data-tk-prop="rot" value="${nl(p.rot || 0, 1)}" inputmode="decimal" autocomplete="off">
      <label>Gespiegeld</label><input type="checkbox" data-tk-prop="spiegel" ${p.spiegel ? "checked" : ""} style="width:auto;justify-self:start">
      <label>Laag</label><select data-tk-prop="laag">${tkLaagOpts(een.laag)}</select></div>
      ${p.lo ? `<button class="btn ghost sm" data-tk="lblreset" style="margin-top:6px">Label terug naast het symbool</button>` : `<div class="muted" style="font-size:11px;margin-top:6px">Sleep het label om het te verplaatsen.</div>`}`;
  } else if (een && een.soort === "tekst") {
    const p = een.props;
    f = `<div class="tk-f"><label>Tekst</label><textarea data-tk-prop="tekst" rows="3">${esc(p.tekst || "")}</textarea><label>Grootte</label><select data-tk-prop="h">${opts([["1.6", "1,6 mm"], ["2", "2 mm"], ["2.5", "2,5 mm"], ["3.5", "3,5 mm"], ["5", "5 mm"]], String(p.h || 2))}</select>
      ${een.geo.px != null ? `<label>Pijlpunt</label><select data-tk-prop="pijl">${opts([["pijl", "pijl"], ["punt", "punt"]], p.pijl || "pijl")}</select>` : ""}${best(een)}<label>Laag</label><select data-tk-prop="laag">${tkLaagOpts(een.laag)}</select></div>`;
  } else if (een && een.soort === "lijn") {
    const p = een.props; const st = TK_STIJLEN[p.stijl] || TK_STIJLEN.lijn;
    f = `<div class="tk-f"><label>Stijl</label><select data-tk-prop="stijl">${opts(Object.entries(TK_STIJLEN).filter(([k]) => k !== "schakel").map(([k, s]) => [k, s.naam]), p.stijl || "lijn")}</select>
      ${["kw", "ww", "afvoer"].includes(p.stijl) ? `<label>Diameter</label><input data-tk-prop="diam" value="${esc(p.diam || "")}" placeholder="bv. 16 of 110" autocomplete="off">` : ""}
      <label>Label</label><input data-tk-prop="label" value="${esc(p.label || "")}" autocomplete="off"><label>Lengte tonen</label><input type="checkbox" data-tk-prop="lengte" ${(p.lengte ?? st.lengte) ? "checked" : ""} style="width:auto;justify-self:start">
      ${best(een)}<label>Laag</label><select data-tk-prop="laag">${tkLaagOpts(een.laag)}</select></div><div class="muted" style="font-size:12px;margin-top:6px">Lengte: <b>${nl(tkLijnLengte(een.geo.pts) / 1000, 2)} m</b> · ${een.geo.pts.length / 2} punten</div>`;
  } else if (een && een.soort === "schakel") {
    f = `<div class="tk-f"><label>Bocht</label><input type="range" min="-0.6" max="0.6" step="0.02" data-tk-prop="bocht" value="${een.props.bocht ?? 0.22}"><label>Laag</label><select data-tk-prop="laag">${tkLaagOpts(een.laag)}</select></div><div class="muted" style="font-size:11px;margin-top:6px">Sleep de middelste greep om de bocht te wijzigen.</div>`;
  } else if (een && een.soort === "maat") {
    f = `<div class="tk-f"><label>Laag</label><select data-tk-prop="laag">${tkLaagOpts(een.laag)}</select></div><div class="muted" style="font-size:12px;margin-top:6px">Maat: <b>${Math.round(tkMaatGeo(een).L)} mm</b> · sleep de grepen om aan te passen.</div>`;
  } else {
    const alleSym = [...soorten].every(s => s === "symbool");
    f = `<div class="muted" style="font-size:12px;margin-bottom:6px">${os.length} objecten (${[...soorten].map(s => ({ symbool: "symbolen", tekst: "teksten", lijn: "lijnen", schakel: "verbindingen", maat: "maten" }[s])).join(", ")})</div>
      <div class="tk-f">${alleSym ? `<label>Kring</label><input data-tk-prop="kring" value="${esc(os.every(o => o.props.kring === os[0].props.kring) ? os[0].props.kring || "" : "")}" placeholder="${os.every(o => o.props.kring === os[0].props.kring) ? "bv. C0.1" : "verschillend"}" autocomplete="off"><label>Hoogte</label><input data-tk-prop="hoogte" inputmode="decimal" placeholder="standaard" autocomplete="off">` : ""}
      ${best(null)}<label>Laag</label><select data-tk-prop="laag"><option value="">— verschillend —</option>${tkLaagOpts(os.every(o => o.laag === os[0].laag) ? os[0].laag : "")}</select></div>`;
  }
  return tkSec("selectie", een ? { symbool: "Symbool", tekst: "Tekst", lijn: "Lijn", schakel: "Schakelverbinding", maat: "Maatlijn" }[een.soort] : "Selectie", f + knoppen);
}
function tkSecSymbolen() {
  const per = TK_GROEPEN.map(([g, gn]) => { const cs = Object.keys(SYMBOLEN).filter(c => tkSymInfo(c).groep === g && tkSymInfo(c).actief); if (!cs.length) return ""; return `<div class="tk-pal-g">${esc(gn)}</div><div class="tk-pal">${cs.map(c => `<button data-tk-sym="${c}" title="${esc(tkSymInfo(c).naam)}" aria-pressed="${TK.tool === "symbool" && TK.symCode === c}"><canvas data-tk-ico="${c}" width="68" height="60"></canvas></button>`).join("")}</div>`; }).join("");
  return tkSec("symbolen", "Symbolen", `<div class="tk-f" style="margin-bottom:4px"><label>Kring</label><input data-tk-pref="kring" value="${esc(TK.kring)}" placeholder="voor nieuwe symbolen, bv. C0.1" autocomplete="off"><label>Status</label><select data-tk-pref="bestaand">${opts([["0", "nieuw"], ["1", "bestaand (blauw)"]], TK.bestaand ? "1" : "0")}</select></div>${per}<div class="muted" style="font-size:11px;margin-top:8px">Klik een symbool en klik op het plan (S). Klik en sleep = draaien, ⌘L = 90°, = = spiegelen. Wandsymbolen vangen op de muren van een dxf.</div>`);
}
function tkPaletIconen() {
  TK.el.querySelectorAll("canvas[data-tk-ico]").forEach(c => {
    const code = c.dataset.tkIco; const ctx = c.getContext("2d"); const bb = tkSymBB(code); const w = bb[2] - bb[0] || 1, h = bb[3] - bb[1] || 1; const k = Math.min(56 / w, 46 / h, 9);
    ctx.clearRect(0, 0, c.width, c.height); const pen = tkCanvasPen(ctx, k); const ox = c.width / 2 - (bb[0] + bb[2]) / 2 * k, oy = c.height / 2 + (bb[1] + bb[3]) / 2 * k;
    tkSymTeken(pen, { geo: { x: 0, y: 0 }, props: { code } }, (x, y) => [ox + x * k, oy - y * k], k, tkLaagKleur(SYMBOLEN[code].laag), 1);
  });
}
function tkSecTekenen() {
  const st = TK_STIJLEN[TK.stijl] || TK_STIJLEN.lijn;
  return tkSec("tekenen", "Tekenen", `<div class="tk-f"><label>Actieve laag</label><select data-tk-pref="laag">${tkLaagOpts(TK.laag)}</select>
    <label>Leiding</label><select data-tk-pref="stijl">${opts(Object.entries(TK_STIJLEN).filter(([k]) => k !== "schakel").map(([k, s]) => [k, s.naam]), TK.stijl)}</select>
    ${["kw", "ww", "afvoer"].includes(TK.stijl) ? `<label>Diameter</label><input data-tk-pref="diam" value="${esc(TK.diam)}" placeholder="bv. 16 of 110" autocomplete="off">` : ""}
    <label>Tekst</label><select data-tk-pref="tekstH">${opts([["1.6", "1,6 mm"], ["2", "2 mm"], ["2.5", "2,5 mm"], ["3.5", "3,5 mm"], ["5", "5 mm"]], String(TK.tekstH))}</select></div>
    <div class="muted" style="font-size:11px;margin-top:6px">Tekst, maten en gewone lijnen komen op de actieve laag; leidingen op hun eigen laag (${esc(tkLaagNaam(st.laag || TK.laag))}).</div>`, TK.tool !== "selectie" && TK.tool !== "hand");
}
function tkSecBladen() {
  const b = tkBlad(); const bl = TK.lagen.bladen || [];
  let inhoud = `<select data-tk-blad style="width:100%;font:inherit;padding:5px 6px;border:1px solid var(--line-2);border-radius:7px;background:var(--surface);color:var(--ink)"><option value="">Werkweergave (vrije lagen)</option>${opts(bl.map(x => [x.id, `${x.naam} — ${x.titel || ""}`]), TK.blad || "")}</select>`;
  if (b) inhoud += `<div class="tk-f" style="margin-top:8px"><label>Naam</label><input data-tk-bladveld="naam" value="${esc(b.naam)}" autocomplete="off"><label>Bladtitel</label><input data-tk-bladveld="titel" value="${esc(b.titel || "")}" autocomplete="off"><label>Soort</label><input data-tk-bladveld="soort" value="${esc(b.soort || "Grondplan")}" autocomplete="off">
      <label>Papier</label><select data-tk-bladveld="papier">${opts(["A0", "A1", "A2", "A3", "A4"].map(x => [x, x]), b.papier || TK.pl.papier || "A1")}</select>
      <label>Legende</label><input type="checkbox" data-tk-bladveld="legende" ${b.legende !== false ? "checked" : ""} style="width:auto;justify-self:start"><label>Aantallen</label><input type="checkbox" data-tk-bladveld="aantallen" ${b.aantallen ? "checked" : ""} style="width:auto;justify-self:start"><label>Hoogteregel</label><input type="checkbox" data-tk-bladveld="hoogteregel" ${b.hoogteregel !== false ? "checked" : ""} style="width:auto;justify-self:start"></div>
    <div class="tk-btns"><button class="btn sm" data-tk-tool="kader">⤧ Kader verplaatsen</button><button class="btn sm" data-tk="kaderfit" title="Zoom op het blad (⌘4)">⤢ Blad</button><button class="btn sm primary" data-tk="pdf">⤓ Pdf maken</button></div>
    <div class="tk-btns"><button class="btn ghost sm" data-tk="bladweg">Blad verwijderen</button></div>
    <div class="muted" style="font-size:11px;margin-top:6px">De lagen hieronder gelden voor dit blad. Titelblok, legende en hoogteregel vullen zich vanzelf.</div>`;
  else inhoud += `<div class="muted" style="font-size:11px;margin-top:6px">Een blad is een combinatie van lagen (bv. ELEK of HVAC) op papier, met titelblok en legende. Kies een blad om het kader te zien en de pdf te maken.</div>`;
  inhoud += `<div class="tk-btns"><button class="btn ghost sm" data-tk="bladnieuw">+ Blad</button></div>`;
  return tkSec("bladen", "Bladen en pdf", inhoud);
}
function tkSecLagen() {
  const n = {}; for (const o of TK.objs.values()) n[o.laag] = (n[o.laag] || 0) + 1; const b = tkBlad();
  return tkSec("lagen", b ? `Lagen — blad ${esc(b.naam)}` : "Lagen", TK_LAGEN.map(([key, naam, d]) => `<label class="tk-laag"><input type="checkbox" data-tk-laag="${key}" ${tkZichtbaar(key) ? "checked" : ""}><span class="tk-dot" style="background:${esc(TK.lagen.kleur[key] || d)}"></span>${esc(naam)}${n[key] ? ` <span class="muted" style="margin-left:auto;font-size:11px">${n[key]}</span>` : ""}</label>`).join(""));
}
function tkSecTelling() {
  const items = tkLegendeItems({ lagen: TK_LAGEN.map(l => l[0]).filter(tkZichtbaar) }); if (!items.length) return "";
  return tkSec("telling", "Aantallen", `<table class="tk-tel">${items.map(i => `<tr><td>${esc(i.naam)}</td><td>${i.soort === "lijn" && i.lengte ? nl(i.lengte / 1000, 1) + " m" : i.n + "×"}</td></tr>`).join("")}</table><div class="muted" style="font-size:11px;margin-top:6px">Enkel zichtbare lagen. De koppeling met de meetstaat volgt in fase 3.</div>`, false);
}
function tkSecOnderlegger() {
  const o = TK.pl.onderlegger || {};
  return tkSec("onderlegger", "Onderlegger", `<div class="muted" style="font-size:12px;margin-bottom:6px">${esc(o.bestand || "—")}${o.pagina ? " · p" + o.pagina : ""}${o.papier_pdf ? " · " + esc(o.papier_pdf) : ""}</div>
    <label class="tk-row">Dekking <input type="range" min="0.1" max="1" step="0.05" value="${TK.lagen.dekking}" data-tk-dek></label>
    ${o.soort !== "dxf" ? `<label class="tk-row"><input type="checkbox" data-tk-grijs ${TK.lagen.grijs ? "checked" : ""}> in grijstinten</label>` : ""}
    ${o.url && o.soort !== "werfplan" ? `<a class="btn sm" href="${esc(o.url)}" target="_blank" rel="noopener" style="margin-top:6px">Origineel openen ↗</a>` : ""}`, false);
}
function tkSecSchaal() {
  const pl = TK.pl; const o = pl.onderlegger || {}; const k = pl.kalibratie || {};
  return tkSec("schaal", "Schaal en afdruk", `<div style="font-size:13px;margin-bottom:6px">${tkOnSchaal(pl) ? "✓ " : "⚠ "}${esc(tkBronTekst(pl))}</div>
    ${o.soort === "pdf" ? `<label class="tk-row">Pdf-schaal <select data-tk-pdfschaal>${opts([["", "—"], ...TK_SCHALEN.map(n => [String(n), "1:" + n])], k.bron === "pdf-schaal" ? String(k.pdf_schaal) : "")}</select></label>` : ""}
    <button class="btn sm" data-tk-tool="kalibreren" style="margin-top:6px">Kalibreren met twee punten</button>
    <label class="tk-row" style="margin-top:10px">Tekenschaal <select data-tk-schaal>${opts(TK_SCHALEN.map(n => [String(n), "1:" + n]), String(pl.schaal || 50))}</select></label>
    <label class="tk-row">Papier <select data-tk-papier>${opts(["A0", "A1", "A2", "A3", "A4"].map(x => [x, x]), pl.papier || "A1")}</select></label>
    <div class="muted" style="font-size:11px;margin-top:4px">De tekenschaal bepaalt hoe groot symbolen en tekst op het plan staan (zoals in Vectorworks).</div>`, !tkOnSchaal(pl));
}
function tkPropZet(naam, el) {
  const v = el.type === "checkbox" ? el.checked : el.value; if (naam === "laag" && !v) return;
  tkWijzig(o => {
    const p = o.props = o.props || {};
    switch (naam) {
      case "laag": o.laag = v; break;
      case "bestaand": if (v === "1") p.bestaand = true; else delete p.bestaand; break;
      case "code": if (o.soort === "symbool") { p.code = v; o.laag = tkSymInfo(v).laag; delete p.lo; } break;
      case "kring": if (o.soort === "symbool") { if (String(v).trim()) p.kring = String(v).trim(); else delete p.kring; } break;
      case "hoogte": if (o.soort === "symbool") { const h = tkGetal(v); if (h == null) delete p.hoogte; else p.hoogte = Math.round(h); } break;
      case "label": if (String(v).trim()) p.label = String(v).trim(); else delete p.label; break;
      case "rot": { const r = tkGetal(v); if (r != null) p.rot = ((r % 360) + 360) % 360; delete p.lo; break; }
      case "spiegel": if (v) p.spiegel = true; else delete p.spiegel; delete p.lo; break;
      case "tekst": if (o.soort === "tekst") { if (!String(v).trim()) return null; p.tekst = String(v).replace(/\s+$/, ""); } break;
      case "h": p.h = Number(v) || 2; break;
      case "pijl": p.pijl = v; break;
      case "stijl": if (o.soort === "lijn") { p.stijl = v; const st = TK_STIJLEN[v]; if (st && st.laag) o.laag = st.laag; } break;
      case "diam": if (String(v).trim()) p.diam = String(v).trim(); else delete p.diam; break;
      case "lengte": p.lengte = !!v; break;
      case "bocht": p.bocht = Number(v); break;
    }
    return o;
  });
}
function tkBladZet(veld, el) {
  const b = tkBlad(); if (!b) return; const v = el.type === "checkbox" ? el.checked : el.value.trim();
  if ((veld === "naam") && !v) return; b[veld] = v; tkSaveLagen(); tkSideRender(); tkDraw();
}
function tkBladNieuw() {
  const bl = TK.lagen.bladen; const id = "b" + Date.now().toString(36); const cur = tkBlad();
  const b = { id, naam: "Blad " + (bl.length + 1), titel: "Grondplan", soort: "Grondplan", lagen: cur ? [...cur.lagen] : TK_LAGEN.map(l => l[0]).filter(tkZichtbaar), legende: true, hoogteregel: true, kader: cur ? cur.kader : undefined, papier: cur ? cur.papier : undefined };
  bl.push(b); TK.blad = id; tkSaveLagen(); tkSideRender(); tkDraw();
}
function tkBladWeg() { const b = tkBlad(); if (!b) return; if (!confirm(`Blad "${b.naam}" verwijderen? De tekening zelf blijft.`)) return; TK.lagen.bladen = TK.lagen.bladen.filter(x => x.id !== b.id); TK.blad = null; tkSaveLagen(); tkSideRender(); tkDraw(); }

/* ---------- pdf-export (vector, pdf-lib) ---------- */
let tkPdfLibP = null;
function tkLaadPdfLib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  return tkPdfLibP || (tkPdfLibP = new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js"; s.onload = () => window.PDFLib ? res(window.PDFLib) : rej(new Error("pdf-lib niet geladen")); s.onerror = () => { tkPdfLibP = null; rej(new Error("pdf-lib kon niet geladen worden — controleer de internetverbinding")); }; document.head.appendChild(s); }));
}
function tkPdfNaam(b) {
  const p = S.projecten[TK.pl.project_id] || {}; const d = new Date(); const dd = String(d.getDate()).padStart(2, "0") + String(d.getMonth() + 1).padStart(2, "0") + String(d.getFullYear()).slice(2);
  const klant = String(p.klant || "Project").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").map(w => w ? w[0].toUpperCase() + w.slice(1) : "").join("");
  return `${dd}_${klant}_${String(b.naam || "blad").replace(/[\\/:*?"<>|]+/g, "-")}.pdf`;
}
function tkPdfDlg() {
  const b = tkBlad(); if (!b) return toast("Kies eerst een blad"); const p = S.projecten[TK.pl.project_id] || {}; const drive = !!p.drive_folder_id && typeof driveCall === "function";
  tkDlg(`<form data-tk-pdf><div class="tk-h">Pdf maken — ${esc(b.naam)}</div><div style="font-size:13px;margin-bottom:8px">${esc(b.papier || TK.pl.papier || "A1")} liggend · schaal 1:${tkN()} · ${esc(b.titel || "")}</div>
    <div class="tk-f"><label>Bestand</label><input name="naam" value="${esc(tkPdfNaam(b))}" autocomplete="off">${drive ? `<label>Drive</label><label style="color:var(--ink)"><input type="checkbox" name="drive" checked> ook bewaren in Plannen/PDF</label>` : ""}</div>
    <div class="muted" style="font-size:11px;margin-top:6px">Vectorpdf: lijnen, symbolen en tekst blijven scherp; een pdf-onderlegger wordt als vector meegenomen.</div>
    <div class="tk-btns" style="justify-content:flex-end"><button type="button" class="btn sm" data-tk-dlg-nee>Annuleren</button><button class="btn sm primary">Maken</button></div></form>`);
  const f = TK.el.querySelector("[data-tk-pdf]");
  f.onsubmit = async (e) => {
    e.preventDefault(); const knop = f.querySelector("button.primary"); knop.disabled = true; knop.textContent = "Bezig…"; let naam = f.naam.value.trim() || tkPdfNaam(b); if (!/\.pdf$/i.test(naam)) naam += ".pdf"; const naarDrive = f.drive && f.drive.checked;
    try {
      const bytes = await tkPdfMaak(b, (t) => { knop.textContent = t; }); const blob = new Blob([bytes], { type: "application/pdf" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = naam; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      tkDlg(null);
      if (naarDrive) {
        toast("Pdf gedownload — bewaren in Drive…", 4000);
        try {
          const b64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(",")[1]); fr.readAsDataURL(blob); });
          const j = await driveCall("put", { folderId: p.drive_folder_id, subpath: "Plannen/PDF", name: naam, base64: b64, mime: "application/pdf" });
          if (j && j.file) { const row = { project_id: p.id, drive_id: j.file.id, naam: j.file.name, pad: j.file.path || "Plannen/PDF", url: j.file.url, mime: "application/pdf", grootte: j.file.size || blob.size, gewijzigd: j.file.updated || tkIso(), gesynct_op: tkIso() }; try { const { data } = await sb.from("documenten").upsert(row, { onConflict: "project_id,drive_id" }).select().maybeSingle(); if (data && S.documenten) S.documenten[data.id] = data; } catch (er) { } }
          toast("Pdf bewaard in Drive › Plannen/PDF", 5000);
        } catch (er) { toast("Pdf gedownload, maar niet in Drive bewaard: " + (er.message || er), 7000); }
      } else toast("Pdf gedownload", 3000);
    } catch (er) { console.error(er); toast("Pdf maken mislukt: " + (er.message || er), 8000); knop.disabled = false; knop.textContent = "Maken"; }
  };
}
async function tkPdfMaak(b, stap = () => { }) {
  stap("pdf-lib laden…"); const L = await tkLaadPdfLib(); const [W, H] = tkPapierMaat(b); const c = 72 / 25.4; const N = tkN(); const k = tkKader(b);
  const doc = await L.PDFDocument.create(); const p = S.projecten[TK.pl.project_id] || {};
  doc.setTitle(`${p.klant || ""} — ${b.titel || b.naam}`); doc.setAuthor("BROS interior architects"); doc.setCreator("BROS Planbord — tekenmodule"); doc.setCreationDate(new Date());
  const page = doc.addPage([W * c, H * c]);
  const F = { h: await doc.embedFont(L.StandardFonts.Helvetica), hb: await doc.embedFont(L.StandardFonts.HelveticaBold), hi: await doc.embedFont(L.StandardFonts.HelveticaOblique), t: await doc.embedFont(L.StandardFonts.TimesRoman), tb: await doc.embedFont(L.StandardFonts.TimesRomanBold) };
  const kw = c / N; const T = (x, y) => [(x - k.x0) * kw, (y - k.y0) * kw]; const ED = TK; const nogOpen = () => { if (TK !== ED) throw new Error("de tekening werd gesloten tijdens het maken van de pdf"); };
  if (b.lagen.includes("onderlegger")) { stap("Onderlegger…"); await tkPdfOnderlegger(L, doc, page, T, kw, W * c, H * c); nogOpen(); }
  stap("Tekening…"); const pen = tkPdfPen(L, page, F);
  for (const o of tkOrde()) { if (!b.lagen.includes(o.laag)) continue; const q = tkBBox(o); if (q[2] < k.x0 || q[0] > k.x1 || q[3] < k.y0 || q[1] > k.y1) continue; tkObjTeken(pen, o, T, kw); }
  stap("Titelblok…"); let logo = null; try { const lb = await (await fetch("logo.png")).arrayBuffer(); logo = await doc.embedPng(lb); } catch (e) { } nogOpen();
  tkPapierTeken(pen, b, (px, py) => [px * c, (H - py) * c], c, { logo });
  stap("Bewaren…"); return await doc.save();
}
async function tkPdfOnderlegger(L, doc, page, T, kw, PW, PH) {
  const o = TK.pl.onderlegger || {}; const k = TK.pl.kalibratie || {}; const s = k.s || 1; const dek = TK.lagen.dekking ?? 0.55; const grijs = TK.lagen.grijs && o.soort !== "dxf";
  let ok = false;
  if (o.soort === "dxf" && TK.ol.dxf) {
    const base = tkRgb(TK.lagen.kleur.onderlegger || "#3A3A3C").map(v => 1 - dek * (1 - v)); page.pushOperators(L.pushGraphicsState(), L.setStrokingRgbColor(...base), L.setLineWidth(0.13 * 72 / 25.4), L.setLineCap(L.LineCapStyle.Round), L.setLineJoin(L.LineJoinStyle.Round));
    for (const l of TK.ol.dxf.prims.lijnen) {
      const pts = []; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < l.length; i += 2) { const w = tkOlToWorld(l[i], l[i + 1]); const [X, Y] = T(w[0], w[1]); pts.push(X, Y); if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y; }
      if (x1 < 0 || y1 < 0 || x0 > PW || y0 > PH) continue; const ops = [L.moveTo(pts[0], pts[1])]; for (let i = 2; i < pts.length; i += 2) ops.push(L.lineTo(pts[i], pts[i + 1])); ops.push(L.stroke());
      for (let i = 0; i < ops.length; i += 4000) page.pushOperators(...ops.slice(i, i + 4000));
    }
    page.pushOperators(L.popGraphicsState());
    const F = await doc.embedFont(L.StandardFonts.Helvetica); const kl = L.rgb(...base);
    for (const t of TK.ol.dxf.prims.teksten) { const w = tkOlToWorld(t.x, t.y); const [X, Y] = T(w[0], w[1]); const size = t.h * s * kw; if (size < 0.8 || X < -200 || Y < -50 || X > PW + 20 || Y > PH + 50) continue; try { page.drawText(tkWin(t.t), { x: X, y: Y, size, font: F, color: kl, rotate: L.degrees((t.rot || 0) + (k.rot || 0) * 180 / Math.PI) }); } catch (e) { } }
    return;
  }
  if (o.soort === "pdf" && o.url && !k.rot) {
    try {
      const bytes = await (await fetch(o.url)).arrayBuffer(); const src = await L.PDFDocument.load(bytes, { ignoreEncryption: true }); const sp = src.getPage((o.pagina || 1) - 1);
      if (((sp.getRotation().angle || 0) % 360) === 0) {
        const cb = sp.getCropBox(); const emb = await doc.embedPage(sp, { left: cb.x, bottom: cb.y, right: cb.x + cb.width, top: cb.y + cb.height });
        const kk = o.w / o.pw; const sc = s * kk * kw; const [X0, Y0] = T(k.tx || 0, (k.ty || 0) - s * kk * o.ph);
        page.drawPage(emb, { x: X0, y: Y0, xScale: sc, yScale: sc, opacity: dek }); ok = true;
      }
    } catch (e) { console.warn("pdf-onderlegger als vector mislukt, val terug op het beeld", e); }
  }
  if (!ok && (o.beeld_url || o.url) && o.soort !== "dxf" && !k.rot) {
    try {
      const bytes = new Uint8Array(await (await fetch(o.beeld_url || o.url)).arrayBuffer()); const png = bytes[0] === 0x89 && bytes[1] === 0x50; const img = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      const w = o.w || img.width, h = o.h || img.height; const [X0, Y0] = T(k.tx || 0, (k.ty || 0) - s * h); page.drawImage(img, { x: X0, y: Y0, width: s * w * kw, height: s * h * kw, opacity: dek }); ok = true;
    } catch (e) { console.warn("onderlegger niet in de pdf", e); toast("De onderlegger kon niet in de pdf — de tekening zelf wel.", 6000); }
  }
  if (ok && grijs) {   // grijstinten: wit vlak met mengmodus "Saturation" over de onderlegger
    const gs = doc.context.obj({ Type: "ExtGState", BM: "Saturation", ca: 1, CA: 1 }); const naam = page.node.newExtGState("GSgrijs", doc.context.register(gs));
    page.pushOperators(L.pushGraphicsState(), L.setGraphicsState(naam), L.setFillingRgbColor(1, 1, 1), L.rectangle(0, 0, PW, PH), L.fill(), L.popGraphicsState());
  }
}

/* ---------- stijl (aanvulling op index.html) ---------- */
function tkCss() {
  if (document.getElementById("tk2-css")) return; const s = document.createElement("style"); s.id = "tk2-css";
  s.textContent = `
  .tk-tools { overflow-y: auto; overflow-x: hidden; }
  .tk-tools button { height: 34px; display: grid; place-items: center; padding: 0; flex: none; }
  .tk-tools button svg { width: 19px; height: 19px; stroke: currentColor; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  .tk-side details.tk-sec > summary { cursor: pointer; list-style: none; display: flex; justify-content: space-between; align-items: center; margin-bottom: 0; }
  .tk-side details.tk-sec[open] > summary { margin-bottom: 8px; }
  .tk-side details.tk-sec > summary::-webkit-details-marker { display: none; }
  .tk-side details.tk-sec > summary::after { content: "▸"; font-size: 11px; }
  .tk-side details.tk-sec[open] > summary::after { content: "▾"; }
  .tk-pal { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
  .tk-pal button { height: 36px; border: 1px solid var(--line); border-radius: 8px; background: #fff; cursor: pointer; padding: 0; display: grid; place-items: center; }
  .tk-pal button:hover { border-color: var(--line-2); }
  .tk-pal button[aria-pressed="true"] { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
  .tk-pal canvas { width: 34px; height: 30px; }
  .tk-pal-g { font-size: 11px; color: var(--muted); margin: 8px 0 4px; }
  .tk-f { display: grid; grid-template-columns: 78px minmax(0, 1fr); gap: 6px 8px; align-items: center; }
  .tk-f > label { font-size: 12px; color: var(--ink-2); }
  .tk-f input:not([type=checkbox]):not([type=range]), .tk-f select, .tk-f textarea { font: inherit; font-size: 13px; padding: 4px 6px; border: 1px solid var(--line-2); border-radius: 7px; background: var(--surface); color: var(--ink); min-width: 0; width: 100%; box-sizing: border-box; }
  .tk-f textarea { resize: vertical; min-height: 40px; }
  .tk-btns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .tk-btns .btn { min-width: 0; }
  .tk-tel { width: 100%; border-collapse: collapse; font-size: 12px; }
  .tk-tel td { padding: 3px 4px; border-bottom: 1px solid var(--line); }
  .tk-tel td:last-child { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .tk-laag { gap: 8px; }
  .tk-dlg { width: min(400px, 92%); }
  .tk-dlg .tk-keys td:first-child { width: 1%; padding-right: 14px; }
  @media (min-width: 761px) { .tk-main { grid-template-columns: 50px minmax(0, 1fr) 280px; } }`;
  document.head.appendChild(s);
}

/* ---------- schil van de editor ---------- */
function tkShell(pl) {
  const p = S.projecten[pl.project_id] || {};
  const tools = TK_TOOLS.map(t => t === "|" ? "<hr>" : `<button data-tk-tool="${t[0]}" title="${esc(t[1] + " (" + t[2] + ")")}" aria-pressed="false">${t[3]}</button>`).join("");
  const SV = TK_SVG;
  return `<div class="tk-top">
      <button class="btn sm" data-tk="sluit" title="Terug naar het project">← ${esc(p.klant || "Terug")}</button>
      <input class="tk-naam" data-tk-naam value="${esc(pl.naam || "")}" title="Naam van het plan">
      <span class="tk-badges"><span class="pill">${esc(tkSoortTekst[pl.onderlegger?.soort] || "Leeg")}</span><span class="pill" data-tk-schaalpill></span></span>
      <span class="tk-sp"></span><span class="muted tk-save" data-tk-save></span>
      <button class="btn ghost sm" data-tk="hulp" title="Sneltoetsen (?)">?</button>
    </div>
    <div class="tk-main">
      <div class="tk-tools">${tools}
        <hr><button data-tk="undo" title="Ongedaan maken (⌘Z)">${SV('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>')}</button><button data-tk="redo" title="Opnieuw (⌘Y)">${SV('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>')}</button>
        <hr><button data-tk="fit" title="Passend (⌘6 of F)">⤢</button><button data-tk="in" title="Inzoomen (+)">＋</button><button data-tk="uit" title="Uitzoomen (−)">－</button></div>
      <div class="tk-cw"><canvas></canvas><div class="tk-hint" data-tk-hint></div><div class="tk-dlg" data-tk-dlg hidden></div></div>
      <div class="tk-side" data-tk-side></div>
    </div>
    <div class="tk-status"><span data-tk-xy>—</span><span data-tk-sel></span><span data-tk-zoom></span><span data-tk-ol></span></div>`;
}
function tkBindUi() {
  const el = TK.el;
  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-tk-dlg-nee]")) { tkDlgSluit(); return; }
    const sym = e.target.closest("[data-tk-sym]"); if (sym) { TK.symCode = sym.dataset.tkSym; TK.symRot = 0; TK.symSpiegel = false; TK.sel.clear(); tkPrefBewaar(); tkSetTool("symbool"); return; }
    const b = e.target.closest("[data-tk],[data-tk-tool]"); if (!b) return; const a = b.dataset.tk;
    if (b.dataset.tkTool) { if (b.dataset.tkTool === "kader" && TK.tool === "kader") return tkSetTool("selectie"); return tkSetTool(b.dataset.tkTool); }
    if (a === "sluit") return tkClose();
    if (a === "fit") return tkFitAlles();
    if (a === "in" || a === "uit") { tkZoomAt(TK.W / 2, TK.H / 2, a === "in" ? 1.4 : 1 / 1.4); return; }
    if (a === "undo") return tkUndo(); if (a === "redo") return tkRedo();
    if (a === "hulp") return tkHulp();
    if (a === "r90") return tkDraai90(90); if (a === "r-90") return tkDraai90(-90); if (a === "spiegel") return tkSpiegelSel("h"); if (a === "dupl") return tkDupliceer(); if (a === "mv") return tkVerplaatsDlg(); if (a === "wis") return tkVerwijderSel();
    if (a === "lblreset") return tkWijzig(o => { delete o.props.lo; return o; });
    if (a === "pdf") return tkPdfDlg(); if (a === "kaderfit") return tkFitBlad(); if (a === "bladnieuw") return tkBladNieuw(); if (a === "bladweg") return tkBladWeg();
    if (a === "verwijder") { if (!confirm(`Plan "${TK.pl.naam}" verwijderen? De onderlegger en alles wat erop getekend is, wordt ook verwijderd.`)) return; const pl = TK.pl; tkClose(); tkVerwijder(pl).then(() => toast("Plan verwijderd")).catch(() => { }); return; }
  });
  el.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.tkProp) return tkPropZet(t.dataset.tkProp, t);
    if (t.dataset.tkPref) { const k = t.dataset.tkPref; let v = t.value; if (k === "bestaand") v = v === "1"; if (k === "tekstH") v = Number(v) || 2; if (k === "kring") v = v.trim(); TK[k] = v; tkPrefBewaar(); if (k === "stijl") { tkSideRender(); if (!["lijn", "polylijn"].includes(TK.tool)) tkSetTool("polylijn"); } tkDraw(); return; }
    if (t.dataset.tkBladveld) return tkBladZet(t.dataset.tkBladveld, t);
    if (t.matches("[data-tk-blad]")) { TK.blad = t.value || null; tkSideRender(); if (TK.blad) tkFitBlad(); else tkDraw(); return; }
    if (t.dataset.tkLaag) { const l = t.dataset.tkLaag; const b = tkBlad(); if (b) { b.lagen = t.checked ? [...new Set([...b.lagen, l])] : b.lagen.filter(x => x !== l); } else TK.lagen.zichtbaar[l] = t.checked; [...TK.sel].forEach(id => { const o = TK.objs.get(id); if (o && !tkZichtbaar(o.laag)) TK.sel.delete(id); }); tkSaveLagen(); tkSideRender(); tkDraw(); return; }
    if (t.matches("[data-tk-grijs]")) { TK.lagen.grijs = t.checked; TK.sharpKey = ""; tkSaveLagen(); tkDraw(); }
    else if (t.matches("[data-tk-pdfschaal]")) tkZetPdfSchaal(Number(t.value));
    else if (t.matches("[data-tk-schaal]")) { tkPlanPatch({ schaal: Number(t.value) }); setTimeout(() => { tkIndexSnap(); tkDraw(); }, 30); }
    else if (t.matches("[data-tk-papier]")) tkPlanPatch({ papier: t.value });
    else if (t.matches("[data-tk-naam]")) { const v = t.value.trim(); if (v && v !== TK.pl.naam) tkPlanPatch({ naam: v }); }
  });
  el.addEventListener("input", (e) => { if (e.target.matches("[data-tk-dek]")) { TK.lagen.dekking = Number(e.target.value); tkSaveLagen(); tkDraw(); } });
  el.addEventListener("focusout", () => { setTimeout(() => { if (TK && TK.sideUitgesteld && !(TK.el.querySelector("[data-tk-side]").contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName))) { TK.sideUitgesteld = false; tkSideRender(); } }, 0); });
  el.addEventListener("toggle", (e) => { const d = e.target; if (d.dataset && d.dataset.tkSec) { TK.open[d.dataset.tkSec] = d.open; tkPrefBewaar(); } }, true);
  el.querySelector("[data-tk-side]").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("input[data-tk-prop],input[data-tk-pref],input[data-tk-bladveld]")) { e.preventDefault(); e.target.blur(); } });
  const cv = TK.cv;
  cv.addEventListener("pointerdown", tkDown); cv.addEventListener("pointermove", tkMove); cv.addEventListener("pointerup", tkUp); cv.addEventListener("pointercancel", tkUp);
  cv.addEventListener("dblclick", tkDbl);
  cv.addEventListener("pointerleave", () => { if (TK && !TK.op) { TK.mouse = null; TK.hover = null; tkDraw(); } });
  cv.addEventListener("wheel", tkWheel, { passive: false });
  cv.addEventListener("gesturestart", (e) => { e.preventDefault(); TK.gz = TK.view.z; });
  cv.addEventListener("gesturechange", (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(); tkZoomAt(e.clientX - r.left, e.clientY - r.top, (TK.gz * e.scale) / TK.view.z); });
  cv.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("keydown", tkKey, true); document.addEventListener("keyup", tkKeyUp, true);
}

/* ---------- vangen: eindpunten van de dxf, punten van getekende objecten; muren voor wandsymbolen ---------- */
function tkIndexSnap() {
  if (!TK) return; TK.grid = null; TK.segGrid = null; const dx = TK.ol.dxf; if (!dx) return; const s = TK.pl.kalibratie?.s || 1;
  if (!TK.gridVoor || TK.gridVoor !== dx || TK.gridS !== s) {
    const pts = dx.prims.punten; const cell = 50 / s; const g = new Map();
    for (let i = 0; i < pts.length; i += 2) { const k = Math.floor(pts[i] / cell) + "," + Math.floor(pts[i + 1] / cell); let a = g.get(k); if (!a) g.set(k, a = []); a.push(pts[i], pts[i + 1]); }
    const scell = 250 / s; const sg = new Map(); let n = 0;
    for (const l of dx.prims.lijnen) for (let i = 2; i < l.length; i += 2) {
      const ax = l[i - 2], ay = l[i - 1], bx = l[i], by = l[i + 1]; if (ax === bx && ay === by) continue;
      const i0 = Math.floor(Math.min(ax, bx) / scell), i1 = Math.floor(Math.max(ax, bx) / scell), j0 = Math.floor(Math.min(ay, by) / scell), j1 = Math.floor(Math.max(ay, by) / scell);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > 400) continue; const seg = [ax, ay, bx, by];
      for (let ii = i0; ii <= i1; ii++) for (let jj = j0; jj <= j1; jj++) { const k = ii + "," + jj; let a = sg.get(k); if (!a) sg.set(k, a = []); a.push(seg); n++; }
      if (n > 3e6) break;
    }
    TK.gridCache = { grid: { g, cell }, segGrid: { g: sg, cell: scell } }; TK.gridVoor = dx; TK.gridS = s;
  }
  TK.grid = TK.gridCache.grid; TK.segGrid = TK.gridCache.segGrid;
}
function tkObjPunten(o) {
  const g = o.geo || {};
  if (o.soort === "symbool") return [g.x, g.y]; if (o.soort === "lijn" || o.soort === "schakel") return g.pts || [];
  if (o.soort === "maat") return [...g.a, ...g.b]; if (o.soort === "tekst") return g.px != null ? [g.px, g.py] : []; return [];
}
function tkSnap(X, Y) {   // → {x, y, soort} in wereld-mm, of null
  const [wx, wy] = tkS2W(X, Y); const tolW = 10 / TK.view.z; let best = null, bd = tolW * tolW;
  const uitgesloten = TK.op && TK.op.ids ? TK.op.ids : null;
  for (const o of TK.objs.values()) { if (uitgesloten && uitgesloten.has(o.id)) continue; if (!tkZichtbaar(o.laag)) continue; const p = tkObjPunten(o); for (let i = 0; i < p.length; i += 2) { const d = (p[i] - wx) ** 2 + (p[i + 1] - wy) ** 2; if (d < bd) { bd = d; best = { x: p[i], y: p[i + 1], soort: o.soort === "symbool" ? "symbool" : "punt", obj: true }; } } }
  if (best) return best;
  for (const o of TK.objs.values()) { if (uitgesloten && uitgesloten.has(o.id)) continue; if (!tkZichtbaar(o.laag)) continue; const p = tkObjMiddens(o); for (let i = 0; i < p.length; i += 2) { const d = (p[i] - wx) ** 2 + (p[i + 1] - wy) ** 2; if (d < bd) { bd = d; best = { x: p[i], y: p[i + 1], soort: "midden", obj: true }; } } }
  if (best) return best;
  if (!TK.grid || !tkZichtbaar("onderlegger")) return null;
  const k = TK.pl.kalibratie || {}; const s = k.s || 1;
  const r = k.rot || 0, c = Math.cos(-r), sn = Math.sin(-r); const dx0 = (wx - (k.tx || 0)) / s, dy0 = (wy - (k.ty || 0)) / s; const u = c * dx0 - sn * dy0, v = sn * dx0 + c * dy0;
  const tol = 10 / (TK.view.z * s); const { g, cell } = TK.grid; let bp = null; let bd2 = tol * tol;
  const n = Math.ceil(tol / cell); const ci = Math.floor(u / cell), cj = Math.floor(v / cell);
  for (let i = ci - n; i <= ci + n; i++) for (let j = cj - n; j <= cj + n; j++) { const a = g.get(i + "," + j); if (!a) continue; for (let q = 0; q < a.length; q += 2) { const d = (a[q] - u) ** 2 + (a[q + 1] - v) ** 2; if (d < bd2) { bd2 = d; bp = [a[q], a[q + 1]]; } } }
  if (bp) { const w = tkOlToWorld(bp[0], bp[1]); return { x: w[0], y: w[1], soort: "eindpunt" }; }
  if (TK.segGrid) {   // middelpunt van een muur of lijn van de dxf
    const sg = TK.segGrid; const m = Math.ceil(tol / sg.cell); const si = Math.floor(u / sg.cell), sj = Math.floor(v / sg.cell); let bm = null; let bdm = tol * tol;
    for (let i = si - m; i <= si + m; i++) for (let j = sj - m; j <= sj + m; j++) { const a = sg.g.get(i + "," + j); if (!a) continue; for (const q of a) { const mx = (q[0] + q[2]) / 2, my = (q[1] + q[3]) / 2; const d = (mx - u) ** 2 + (my - v) ** 2; if (d < bdm) { bdm = d; bm = [mx, my]; } } }
    if (bm) { const w = tkOlToWorld(bm[0], bm[1]); return { x: w[0], y: w[1], soort: "midden" }; }
  }
  return null;
}
function tkObjMiddens(o) {
  const g = o.geo || {}; const r = [];
  if (o.soort === "lijn" && g.pts) for (let i = 2; i < g.pts.length; i += 2) r.push((g.pts[i - 2] + g.pts[i]) / 2, (g.pts[i - 1] + g.pts[i + 1]) / 2);
  if (o.soort === "maat" && g.a && g.b) r.push((g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2);
  return r;
}
/* ---------- slimme hulplijnen (zoals de smart points van Vectorworks) ----------
   Elk grijppunt waar je over beweegt, wordt "onthouden" (max. 8). Kom je daarna horizontaal of verticaal in lijn met
   zo'n punt of met een punt van een getekend object op het scherm, dan verschijnt een stippellijn en vangt de cursor
   (of het object dat je versleept) op die lijn. Op het kruispunt van twee hulplijnen vang je op beide. ⌥ = uit (bij slepen: ⌘). */
const TK_UITLIJN_PX = 6;
function tkVerwerf(sn) {
  if (!sn) return; const v = TK.verworven; const i = v.findIndex(q => Math.abs(q[0] - sn.x) < 1e-6 && Math.abs(q[1] - sn.y) < 1e-6); if (i === 0) return; if (i > 0) v.splice(i, 1);
  v.unshift([sn.x, sn.y]); if (v.length > 8) v.length = 8;
}
function tkUitlijnKandidaten() {
  const uit = TK.op && TK.op.ids ? TK.op.ids : null; const [x0, y1] = tkS2W(-20, -20), [x1, y0] = tkS2W(TK.W + 20, TK.H + 20); const c = [];
  const voeg = (x, y) => { if (x >= x0 && x <= x1 && y >= y0 && y <= y1) c.push(x, y); };
  for (const o of TK.objs.values()) { if (uit && uit.has(o.id)) continue; if (!tkZichtbaar(o.laag)) continue; const p = tkObjPunten(o); for (let i = 0; i < p.length; i += 2) voeg(p[i], p[i + 1]); }
  if (TK.op && TK.op.soort === "punt" && TK.op.orig) { const p = tkObjPunten(TK.op.orig); for (let i = 0; i < p.length; i += 2) voeg(p[i], p[i + 1]); }   // greep: ook de andere punten van hetzelfde object
  TK.verworven.forEach(q => voeg(q[0], q[1])); TK.pts.forEach(q => voeg(q[0], q[1]));
  return c;
}
function tkUitlijn(refs, dx, dy, vast = {}) {   // refs = [x, y, …] (wereld); geeft de correctie {cx, cy, gids}
  const c = TK.uitlijnC || tkUitlijnKandidaten(); const tol = TK_UITLIJN_PX / TK.view.z; let bx = null, by = null;
  for (let r = 0; r < refs.length && r < 120; r += 2) {
    const rx = refs[r] + dx, ry = refs[r + 1] + dy;
    for (let i = 0; i < c.length; i += 2) {
      if (!vast.x) { const d = c[i] - rx; if (Math.abs(d) < tol && Math.abs(c[i + 1] - ry) > 1e-6 && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, c: [c[i], c[i + 1]], r }; }
      if (!vast.y) { const d = c[i + 1] - ry; if (Math.abs(d) < tol && Math.abs(c[i] - rx) > 1e-6 && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, c: [c[i], c[i + 1]], r }; }
    }
  }
  const cx = bx ? bx.d : 0, cy = by ? by.d : 0; const gids = [];
  if (bx) gids.push({ van: bx.c, naar: [refs[bx.r] + dx + cx, refs[bx.r + 1] + dy + cy] });
  if (by) gids.push({ van: by.c, naar: [refs[by.r] + dx + cx, refs[by.r + 1] + dy + cy] });
  return { cx, cy, gids };
}
const TK_UITLIJN_TOOLS = ["symbool", "tekst", "callout", "lijn", "polylijn", "schakel", "maat", "roteren", "verplaats", "meten"];
function tkPaintGids(ctx) {
  const gids = (TK.op && TK.op.gids) || (TK.mouse && TK.mouse.gids); if (!gids || !gids.length) return;
  ctx.save(); ctx.strokeStyle = "#E0367A"; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
  for (const g of gids) { const A = tkW2S(...g.van), B = tkW2S(...g.naar); ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke(); }
  ctx.setLineDash([]); ctx.lineWidth = 1.5;
  for (const g of gids) { const [X, Y] = tkW2S(...g.van); ctx.beginPath(); ctx.moveTo(X - 4, Y - 4); ctx.lineTo(X + 4, Y + 4); ctx.moveTo(X - 4, Y + 4); ctx.lineTo(X + 4, Y - 4); ctx.stroke(); }
  ctx.restore();
}
function tkPunt(e, shift) {   // wereldpunt onder de muis, met vangen en Shift = recht
  const r = TK.cv.getBoundingClientRect(); const X = e.clientX - r.left, Y = e.clientY - r.top;
  let sn = e.altKey && TK.tool !== "symbool" ? null : tkSnap(X, Y); let [x, y] = sn ? [sn.x, sn.y] : tkS2W(X, Y); let gids = null;
  const uitlijnen = !sn && !e.altKey && (TK_UITLIJN_TOOLS.includes(TK.tool) || (TK.op && (TK.op.soort === "punt" || TK.op.soort === "label")));
  if (uitlijnen) { TK.uitlijnC = null; const u = tkUitlijn([x, y], 0, 0); x += u.cx; y += u.cy; gids = u.gids; }
  if (shift && TK.pts.length) { const a = TK.pts[TK.pts.length - 1]; if (Math.abs(x - a[0]) > Math.abs(y - a[1])) { y = a[1]; if (gids) gids = gids.filter(g => Math.abs(g.van[1] - g.naar[1]) > 1e-6); } else { x = a[0]; if (gids) gids = gids.filter(g => Math.abs(g.van[0] - g.naar[0]) > 1e-6); } sn = null; if (gids) gids.forEach(g => g.naar = [x, y]); }
  return { x, y, X, Y, snap: sn, snapObj: !!(sn && sn.obj), gids: gids && gids.length ? gids : null };
}

/* ---------- lagen en bladen bewaren ---------- */
function tkSaveLagen(nu) {
  if (!TK) return; clearTimeout(tkLagenT); const id = TK.id, val = { zichtbaar: { ...TK.lagen.zichtbaar }, kleur: { ...TK.lagen.kleur }, dekking: TK.lagen.dekking, grijs: TK.lagen.grijs, bladen: tkKopie(TK.lagen.bladen || []) };
  const doe = () => { if (JSON.stringify(S.tekenplannen[id]?.lagen || {}) === JSON.stringify(val)) return; sb.from("tekenplannen").update({ lagen: val }).eq("id", id).then(({ error }) => { if (!error && S.tekenplannen[id]) S.tekenplannen[id].lagen = val; }); };
  if (nu) doe(); else tkLagenT = setTimeout(doe, 900);
}

/* ---------- scherm ---------- */
function tkPaint() {
  if (!TK) return; const ctx = TK.ctx, dpr = TK.dpr, W = TK.W, H = TK.H; const o = TK.pl.onderlegger || {};
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  if (tkZichtbaar("onderlegger")) {
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
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.lineCap = "round"; ctx.lineJoin = "round";
  tkPaintObjecten(ctx);
  tkPaintBlad(ctx);
  tkPaintSelectie(ctx);
  tkPaintGids(ctx);
  tkPaintPreview(ctx);
  tkPaintMeting(ctx);
  if (TK.mouse && TK.mouse.snap) { const [X, Y] = tkW2S(TK.mouse.snap.x, TK.mouse.snap.y); ctx.strokeStyle = "#0071E3"; ctx.lineWidth = 1.5; ctx.strokeRect(X - 5, Y - 5, 10, 10); }
  tkPaintSchaalbalk(ctx);
  const zs = TK.el.querySelector("[data-tk-zoom]"); if (zs) { const N = 1 / (TK.view.z * 0.2646); zs.textContent = `scherm ≈ 1:${N >= 10 ? Math.round(N) : N.toFixed(1)}`; }
  const sl = TK.el.querySelector("[data-tk-sel]"); if (sl) sl.textContent = TK.sel.size ? `${TK.sel.size} geselecteerd` : `${TK.objs.size} object${TK.objs.size === 1 ? "" : "en"}`;
}
function tkHulp() {
  const rij = (k, t) => `<tr><td>${k}</td><td>${t}</td></tr>`;
  tkDlg(`<div class="tk-h">Sneltoetsen — zoals in Vectorworks</div><div style="max-height:60vh;overflow:auto"><table class="tk-keys">
    ${rij("X", "Selectie (X nog eens = alles deselecteren)")}${rij("H · spatie", "Hand / tijdelijk verschuiven")}${rij("C", "Zoom (⌥-klik = uit, sleep = kader)")}
    ${rij("S", "Symbool plaatsen (klik en sleep = draaien)")}${rij("1", "Tekst")}${rij("⌥1", "Tekst met pijl (callout)")}${rij("2", "Lijn / leiding")}${rij("5", "Polylijn / leiding")}${rij("3", "Schakelverbinding")}${rij("N", "Maatlijn")}
    ${rij("⌥=", "Roteren (middelpunt, begin, eind)")}${rij("⇧M", "Verplaatsen met punten (⌥ = kopie)")}${rij("=", "Spiegelen")}${rij("M · K", "Meten · kalibreren")}
    ${rij("Tab", "Lengte en hoek intikken tijdens het tekenen")}${rij("Shift", "Recht (0/90°) · roteren per 15°")}${rij("⌥ ingedrukt", "Niet vangen · ⌥-slepen = kopie")}${rij("hulplijnen", "Beweeg over een grijppunt: daarna vang je horizontaal/verticaal in lijn ermee (roze stippellijn). Bij slepen: ⌘ = uit")}
    ${rij("Enter · dubbelklik", "Polylijn klaar · tekst wijzigen")}${rij("Backspace", "Verwijderen")}${rij("Esc", "Stoppen / deselecteren")}
    ${rij("⌘Z · ⌘Y", "Ongedaan maken · opnieuw")}${rij("⌘C ⌘X ⌘V", "Kopiëren, knippen, plakken (⌘⌥V = op dezelfde plaats)")}${rij("⌘D", "Dupliceren")}${rij("⌘A", "Alles selecteren")}
    ${rij("⌃M (of ⌘M)", "Verplaatsen (X/Y in mm) — in Safari ⌃M, want ⌘M minimaliseert het venster")}${rij("⌘L · ⌘⇧R", "90° links · 90° rechts")}${rij("⌘⇧H · ⌘⇧V", "Horizontaal · verticaal spiegelen")}${rij("⌘F · ⌘B", "Naar voor · naar achter")}
    ${rij("⇧ pijltje", "Duwen 10 mm (⌘⇧ pijltje = 100 mm)")}${rij("pijltjes", "Verschuiven")}${rij("⌘6 · ⌘4 · F", "Passend · blad passend · passend")}${rij("⌘1 · ⌘2", "Inzoomen · uitzoomen")}${rij("⌘⇧,", "Vorige weergave")}
    ${rij("trackpad", "twee vingers = verschuiven, knijpen = zoomen")}</table></div>
    <div class="muted" style="font-size:11px;margin-top:6px">Sommige ⌘-toetsen neemt de browser zelf (bv. ⌘1/⌘2 in Chrome): gebruik dan + en −.</div>
    <div style="text-align:right;margin-top:8px"><button class="btn sm" data-tk-dlg-nee>OK</button></div>`);
}
