/* BROS Planbord — meetstaat importeren uit een bestaand Excel-bestand (alle sjabloonversies 2024 → 2026 DEF).
   Leest het blad MEETSTAAT (kolommen: A code · B/C/E bestel-vinkjes · D leverdatum · F leverancier · G locatie ·
   H omschrijving · I artikelnr · J hoeveelheid · K eenheid · L eenheidsprijs (klantprijs) · M totaal · N btw · U bijgevraagd/weggelaten)
   en het blad OVERZICHT (controle per lot + "onvoorziene kost 10 %").
   Gebruik: window.MeetstaatImport.parse(bytes, JSZip) → { head, lots:[{lot, naam, posts:[…|{_groep}], som, subtotExcel}], overzicht, warnings, posts, postsMetCijfers, totaal }
   Werkt in de browser én in Node (tests). */
(function (root) {
  "use strict";
  const LOT_RE = /^\s*(\d{1,2})\s*\.\s*([A-Za-z].*)$/;
  const CODE_RE = /^\s*(\d{1,2})\s*\.\s*(\d{1,3})\s*$/;
  const COLS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const colIdx = (c) => { let n = 0; for (const ch of c) n = n * 26 + (COLS.indexOf(ch) + 1); return n; };
  const txt = (v) => v == null ? "" : String(v).trim();
  const num = (v) => { if (v == null || v === "") return null; if (typeof v === "number") return v; const n = Number(String(v).replace(",", ".")); return isNaN(n) ? null : n; };
  const norm = (s) => s.replace(/\s+/g, " ").trim().toUpperCase();
  const decodeXml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, "&");
  const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
  const excelDate = (n) => { const d = new Date(EXCEL_EPOCH + Math.round(n) * 86400000); return d.toISOString().slice(0, 10); };

  /* ---------- xlsx lezen (minimaal, zonder bibliotheek buiten JSZip) ---------- */
  async function readWorkbook(bytes, JSZip) {
    const zip = await JSZip.loadAsync(bytes);
    const get = async (p) => { const f = zip.file(p); return f ? await f.async("string") : null; };
    const wb = await get("xl/workbook.xml"); if (!wb) throw new Error("Geen geldig Excel-bestand (xl/workbook.xml ontbreekt).");
    const rels = await get("xl/_rels/workbook.xml.rels") || "";
    const relMap = {}; rels.replace(/<Relationship\b([^>]*)\/?>/g, (m, a) => { const id = /Id="([^"]+)"/.exec(a), t = /Target="([^"]+)"/.exec(a); if (id && t) relMap[id[1]] = t[1].replace(/^\/?(xl\/)?/, "xl/"); return m; });
    const sheets = []; wb.replace(/<sheet\b([^>]*)\/?>/g, (m, a) => { const n = /name="([^"]*)"/.exec(a), r = /r:id="([^"]+)"/.exec(a) || /\bid="([^"]+)"/.exec(a); if (n) sheets.push({ name: decodeXml(n[1]), path: r ? relMap[r[1]] : null }); return m; });
    const sst = []; const ss = await get("xl/sharedStrings.xml");
    if (ss) { const re = /<si>([\s\S]*?)<\/si>/g; let m; while ((m = re.exec(ss))) { const parts = []; m[1].replace(/<t[^>]*>([\s\S]*?)<\/t>/g, (x, t) => { parts.push(t); return x; }); sst.push(decodeXml(parts.join(""))); } }
    const readSheet = async (name) => {
      const s = sheets.find(x => x.name.toUpperCase().includes(name)); if (!s || !s.path) return null;
      const xml = await get(s.path); if (!xml) return null;
      const rows = new Map();
      const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g; let rm;
      while ((rm = rowRe.exec(xml))) {
        const rn = Number((/\br="(\d+)"/.exec(rm[1]) || [])[1]); if (!rn) continue;
        const cells = {}; const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let cm;
        while ((cm = cellRe.exec(rm[2]))) {
          const attrs = cm[1], inner = cm[2] || ""; const ref = /\br="([A-Z]+)\d+"/.exec(attrs); if (!ref) continue;
          const t = (/\bt="([^"]+)"/.exec(attrs) || [])[1]; let v = null;
          if (t === "inlineStr") { const parts = []; inner.replace(/<t[^>]*>([\s\S]*?)<\/t>/g, (x, q) => { parts.push(q); return x; }); v = decodeXml(parts.join("")).replace(/\r\n/g, "\n"); }
          else { const vm = /<v>([\s\S]*?)<\/v>/.exec(inner); if (vm) { const raw = decodeXml(vm[1]); v = t === "s" ? (sst[Number(raw)] ?? "").replace(/\r\n/g, "\n") : t === "b" ? raw === "1" : t === "str" || t === "e" ? raw : Number(raw); } }
          if (v != null) cells[ref[1]] = v;
        }
        rows.set(rn, cells);
      }
      return { name: s.name, rows, max: Math.max(0, ...rows.keys()) };
    };
    return { sheets: sheets.map(s => s.name), readSheet };
  }

  /* ---------- meetstaat interpreteren (zelfde regels als de eenmalige Python-omzetting) ---------- */
  function interpret(ms, ov, placeholders) {
    const lots = [], warnings = []; const head = {};
    let cur = null, inTable = false, prev = null;
    const ph = new Set((placeholders || []).map(norm));
    for (let i = 1; i <= ms.max; i++) {
      const c = ms.rows.get(i) || {};
      const A = txt(c.A), G = txt(c.G), H = txt(c.H), T = txt(c.T), U = txt(c.U);
      if (i === 9) head.titel = A; if (i === 11) head.dossier = A;
      if (i < 30) continue;
      const lm = LOT_RE.exec(A);
      if (lm && !CODE_RE.test(A)) { cur = { lot: Number(lm[1]), naam: lm[2].trim(), row: i, posts: [], notes: [], subtotExcel: null }; lots.push(cur); inTable = false; prev = null; }
      if (!cur) continue;
      if (!inTable && T.toUpperCase().includes("OFFERTE") && num(c.U) != null) cur.subtotExcel = num(c.U);
      if (lm && !CODE_RE.test(A)) continue;
      if (!inTable) { if (H.toUpperCase() === "OMSCHRIJVING") inTable = true; else if (H) cur.notes.push(H); continue; }
      if (txt(c.X).toUpperCase() === "TOTAAL" || T.toUpperCase().startsWith("SUBTOT")) continue;
      const code = CODE_RE.test(A) ? A.trim() : "";
      const j = num(c.J), l = num(c.L), mm = num(c.M);
      const hasNum = [j, l, mm].some(x => x != null && x !== 0);
      if (!H && !G) continue;
      if (!H && G && !hasNum) { cur.posts.push({ _groep: G }); prev = null; continue; }
      if (!hasNum && !code && (norm(H) === norm(G) || (H === H.toUpperCase() && H.length <= 40 && !txt(c.K)))) { cur.posts.push({ _groep: H }); prev = null; continue; }
      if (code && !hasNum && norm(H) === norm(G)) { cur.posts.push({ _groep: H }); prev = null; continue; }
      if (!code && !hasNum) { if (prev) prev.omschrijving += "\n" + H; else cur.notes.push(H); continue; }
      if (!hasNum && ph.has(norm(H))) continue; // onaangeroerde sjabloonregel
      const st = U.toUpperCase();
      const p = { code, locatie: G, omschrijving: H, artikelnr: txt(c.I), hoeveelheid: j || 0, eenheid: txt(c.K), prijs: l || 0,
        totaal: mm != null ? mm : (j || 0) * (l || 0), btw: num(c.N) != null ? num(c.N) : 0.06,
        status: st.includes("BIJGEVRAAGD") ? "meerwerk" : st.includes("WEGGELATEN") ? "minwerk" : "offerte",
        te_bestellen: c.B === true, besteld: c.C === true, geleverd: c.E === true,
        leverdatum: typeof c.D === "number" && c.D > 30000 ? excelDate(c.D) : "", leverancier: txt(c.F), row: i };
      if (p.prijs && p.hoeveelheid && Math.abs(p.hoeveelheid * p.prijs - p.totaal) > 0.05) { warnings.push(`rij ${i}: hoeveelheid × prijs ≠ totaal — totaal uit Excel behouden`); p.prijs = Math.round(p.totaal / p.hoeveelheid * 10000) / 10000; }
      if (p.hoeveelheid && !p.prijs && p.totaal) { p.prijs = Math.round(p.totaal / p.hoeveelheid * 10000) / 10000; warnings.push(`rij ${i}: enkel totaal ingevuld → prijs afgeleid`); }
      if (!p.hoeveelheid && p.prijs && p.totaal) { p.hoeveelheid = Math.round(p.totaal / p.prijs * 1000) / 1000; warnings.push(`rij ${i}: hoeveelheid afgeleid uit totaal`); }
      if (!p.hoeveelheid && !p.prijs && p.totaal) { p.prijs = p.totaal; p.hoeveelheid = 1; p.eenheid = p.eenheid || "sog"; warnings.push(`rij ${i}: enkel totaal ingevuld → 1 × ${p.totaal}`); }
      if (!p.hoeveelheid && p.prijs && !p.totaal) warnings.push(`rij ${i}: prijs zonder hoeveelheid (${p.prijs}) — telt niet mee`);
      cur.posts.push(p); prev = p;
    }
    for (const lot of lots) {
      const cleaned = [];
      lot.posts.forEach((p, k) => { if (p._groep) { if (!lot.posts.slice(k + 1).some(q => !q._groep)) return; if (cleaned.length && cleaned[cleaned.length - 1]._groep) cleaned.pop(); } cleaned.push(p); });
      lot.posts = cleaned;
      lot.som = Math.round(lot.posts.filter(p => !p._groep).reduce((s, p) => s + p.totaal, 0) * 100) / 100;
      if (lot.subtotExcel != null && Math.abs(lot.subtotExcel - lot.som) > 0.5 && lot.posts.some(p => !p._groep)) warnings.push(`lot ${lot.lot}: som posten ${lot.som} ≠ subtotaal in Excel ${lot.subtotExcel}`);
    }
    const overzicht = { loten: {}, totaal: null, onvoorzien: null };
    if (ov) for (let i = 1; i <= Math.min(ov.max, 80); i++) { const c = ov.rows.get(i) || {}; const e = num(c.E); const b = txt(c.B).toUpperCase(), d = txt(c.D).toUpperCase();
      if (typeof c.A === "number" && e != null) overzicht.loten[Math.round(c.A)] = e; else if (d === "TOTAAL" && e != null) overzicht.totaal = e; else if (b.includes("ONVOORZIEN") && e != null) overzicht.onvoorzien = e; }
    // lot 21 (10 %-budget) staat in oudere sjablonen enkel als formule in de lotkop
    if (overzicht.onvoorzien == null) { const l21 = lots.find(l => l.lot === 21); if (l21 && l21.subtotExcel && !l21.posts.some(p => !p._groep)) overzicht.onvoorzien = l21.subtotExcel; }
    const real = lots.filter(l => l.posts.some(p => !p._groep));
    Object.entries(overzicht.loten).forEach(([nr, v]) => { const mine = (real.find(l => l.lot === Number(nr)) || {}).som || 0; if (Math.abs((v || 0) - mine) > 0.5) warnings.push(`OVERZICHT lot ${nr}: ${v} ≠ som posten ${mine}`); });
    const posts = real.reduce((s, l) => s + l.posts.filter(p => !p._groep).length, 0);
    const postsMetCijfers = real.reduce((s, l) => s + l.posts.filter(p => !p._groep && (p.hoeveelheid || p.prijs)).length, 0);
    return { head, lots: real, overzicht, warnings, posts, postsMetCijfers, totaal: Math.round(real.reduce((s, l) => s + l.som, 0) * 100) / 100 };
  }

  async function parse(bytes, JSZip, placeholders) {
    const wb = await readWorkbook(bytes, JSZip);
    const ms = await wb.readSheet("MEETSTAAT"); if (!ms) throw new Error("Geen blad MEETSTAAT gevonden in dit bestand.");
    const ov = await wb.readSheet("OVERZICHT");
    return interpret(ms, ov, placeholders);
  }

  /* rijen voor de tabel meetstaat_posten */
  function toRows(parsed, projectId, opts) {
    const status = opts && opts.status || "akkoord"; const note = opts && opts.opmerking || "";
    const rows = [];
    for (const lot of parsed.lots) {
      let groep = "", seq = 0;
      for (const p of lot.posts) {
        if (p._groep) { groep = p._groep; continue; }
        seq++;
        let een = (p.eenheid || ((p.hoeveelheid === 0 || p.hoeveelheid === 1) && p.prijs ? "sog" : "stk")).trim();
        if (["sog", "forfait", "ff"].includes(een.toLowerCase())) een = "sog";
        rows.push({ project_id: projectId, post_id: null, lot: lot.lot, code: p.code || `${lot.lot}.${seq}`, groep, omschrijving: p.omschrijving.slice(0, 2000), locatie: p.locatie,
          eenheid: een, prijstype: een === "sog" ? "SOG" : "EP", hoeveelheid: Math.round(p.hoeveelheid * 1000) / 1000, eenheidsprijs: Math.round(p.prijs * 100) / 100, marge: 0,
          btw: [0, 0.06, 0.21].includes(p.btw) ? p.btw : 0.06, status: p.status === "offerte" ? status : p.status, vakman: "", te_bestellen: !!p.te_bestellen, besteld: !!p.besteld,
          leverdatum: p.leverdatum || null, geleverd: !!p.geleverd, leverancier: p.leverancier, artikelnr: p.artikelnr, opmerking: note, volgorde: seq });
      }
    }
    const ov = parsed.overzicht.onvoorzien;
    if (opts && opts.budget21 !== false && ov && Math.abs(ov) > 0.5 && !rows.some(r => r.lot === 21)) rows.push({ project_id: projectId, post_id: null, lot: 21, code: "21.1", groep: "", omschrijving: "Onvoorziene kost / extra te voorzien budget door bouwheer (10 %)", locatie: "", eenheid: "sog", prijstype: "SOG", hoeveelheid: 1, eenheidsprijs: Math.round(ov * 100) / 100, marge: 0, btw: 0.06, status, vakman: "", te_bestellen: false, besteld: false, leverdatum: null, geleverd: false, leverancier: "", artikelnr: "", opmerking: note, volgorde: 1 });
    return rows;
  }

  const api = { parse, toRows, interpret, readWorkbook };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.MeetstaatImport = api;
})(typeof window !== "undefined" ? window : globalThis);
