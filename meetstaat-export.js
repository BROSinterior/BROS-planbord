/* =====================================================================
   BROS Planbord — meetstaat-export.js
   Schrijft de meetstaatregels van een project in het Excel-sjabloon
   (SJABLOON MEETSTAAT 2026 DEF.xlsx) zonder de opmaak, formules,
   keuzelijsten of het logo aan te raken: het bestand wordt als zip
   geopend en enkel de nodige cellen worden in de XML vervangen.
   Werkt in de browser (window.JSZip) en in Node (require("jszip")).
   ===================================================================== */
(function (root) {
  const COLS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const colIdx = (c) => { let n = 0; for (const ch of c) n = n * 26 + (COLS.indexOf(ch) + 1); return n; };
  const colName = (n) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = COLS[m] + s; n = Math.floor((n - 1) / 26); } return s; };
  const xmlEsc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const unesc = (s) => String(s ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

  /* ---- verwijzingen verschuiven bij het invoegen van rijen ---- */
  // Verschuift rijnummers >= atRow met n in A1-verwijzingen. Enkel verwijzingen zonder bladnaam of met bladnaam `sheet`.
  function shiftRefs(formula, atRow, n, sheet, onlyPrefixed) {
    return formula.replace(/((?:'[^']+'|[A-Za-z0-9_.]+)!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g, (m, pre, d1, col, d2, row) => {
      if (pre) { const name = pre.slice(0, -1).replace(/^'|'$/g, ""); if (name !== sheet) return m; } else if (onlyPrefixed) return m;
      const r = Number(row); if (r < atRow) return m;
      return (pre || "") + d1 + col + d2 + (r + n);
    });
  }
  function shiftSqref(sq, atRow, n) { return sq.split(/\s+/).map(ref => shiftRefs(ref, atRow, n, null, false)).join(" "); }

  /* ---- rijen en cellen uit de sheet-XML ---- */
  function parseCells(inner) {
    const cells = new Map();
    if (!inner) return cells;
    const re = /<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let m;
    while ((m = re.exec(inner))) cells.set(m[1], { col: m[1], attrs: m[3] || "", inner: m[4] || "" });
    return cells;
  }
  function styleOf(cell) { const m = cell && cell.attrs.match(/\ss="(\d+)"/); return m ? m[1] : null; }
  function cellXml(col, row, style, body, type) {
    const s = style != null ? ` s="${style}"` : ""; const t = type ? ` t="${type}"` : "";
    return body ? `<c r="${col}${row}"${s}${t}>${body}</c>` : `<c r="${col}${row}"${s}/>`;
  }
  function serializeRow(r) {
    const cells = [...r.cells.values()].sort((a, b) => colIdx(a.col) - colIdx(b.col)).map(c => c.inner || /t="/.test(c.attrs) ? `<c r="${c.col}${r.r}"${c.attrs}>${c.inner}</c>` : `<c r="${c.col}${r.r}"${c.attrs}/>`).join("");
    const attrs = r.attrs.replace(/\sr="\d+"/, ` r="${r.r}"`);
    return cells ? `<row${attrs}>${cells}</row>` : `<row${attrs}/>`;
  }
  function parseSheet(xml) {
    const a = xml.indexOf("<sheetData>"), b = xml.indexOf("</sheetData>");
    const head = xml.slice(0, a + "<sheetData>".length), tail = xml.slice(b);
    const rows = []; const re = /<row([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g; let m;
    while ((m = re.exec(xml.slice(a, b)))) { const r = Number(m[1].match(/\sr="(\d+)"/)[1]); rows.push({ r, attrs: m[1], cells: parseCells(m[2]) }); }
    return { head, tail, rows };
  }

  /* ---- gedeelde formules uitschrijven (anders kunnen we geen rijen invoegen of cellen vervangen) ---- */
  function expandShared(rows) {
    const masters = {};
    rows.forEach(r => r.cells.forEach(c => { const m = c.inner.match(/<f t="shared" ref="[^"]*" si="(\d+)">([^<]*)<\/f>/); if (m) masters[m[1]] = { col: c.col, row: r.r, f: m[2] }; }));
    rows.forEach(r => r.cells.forEach(c => {
      let m = c.inner.match(/<f t="shared" ref="[^"]*" si="(\d+)">([^<]*)<\/f>/);
      if (m) { c.inner = c.inner.replace(m[0], `<f>${m[2]}</f>`); return; }
      m = c.inner.match(/<f t="shared" si="(\d+)"\/>/);
      if (m && masters[m[1]]) { const M = masters[m[1]]; const dr = r.r - M.row, dc = colIdx(c.col) - colIdx(M.col);
        const f = M.f.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g, (x, d1, col, d2, row) => (d1 ? d1 + col : colName(colIdx(col) + dc)) + (d2 ? d2 + row : String(Number(row) + dr)));
        c.inner = c.inner.replace(m[0], `<f>${f}</f>`); }
    }));
  }

  /* ---- hoofdfunctie ---- */
  async function build(templateBytes, opts) {
    const JSZipLib = opts.JSZip || root.JSZip;
    const zip = await JSZipLib.loadAsync(templateBytes);
    const wbXml = await zip.file("xl/workbook.xml").async("string");
    const rels = await zip.file("xl/_rels/workbook.xml.rels").async("string");
    const sheets = [...wbXml.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map(m => { const t = rels.match(new RegExp(`<Relationship Id="${m[2]}"[^>]*Target="([^"]+)"`)); return { name: m[1], path: "xl/" + t[1].replace(/^\/?xl\//, "").replace(/^\//, "") }; });
    const main = sheets.find(s => s.name.trim().toUpperCase() === "MEETSTAAT"); if (!main) throw new Error("Tabblad MEETSTAAT niet gevonden in het sjabloon.");
    const SHEET = main.name;
    const ssXml = (await zip.file("xl/sharedStrings.xml")?.async("string")) || "";
    const strings = [...ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => unesc([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join("")));
    const sheetXml = await zip.file(main.path).async("string");
    const S = parseSheet(sheetXml);
    expandShared(S.rows);
    const byRow = () => { const o = new Map(); S.rows.forEach(r => o.set(r.r, r)); return o; };
    let rowMap = byRow();
    const textOf = (c) => { if (!c) return ""; if (/t="s"/.test(c.attrs)) { const v = c.inner.match(/<v>(\d+)<\/v>/); return v ? strings[Number(v[1])] || "" : ""; } if (/t="inlineStr"/.test(c.attrs)) return unesc([...c.inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join("")); return ""; };

    // lotkoppen: kolom A met "n. NAAM"
    const headers = []; // {lot, row}
    S.rows.forEach(r => { if (r.r < 30) return; const t = textOf(r.cells.get("A")); const m = t.match(/^\s*(\d{1,2})\s*\.\s*[A-Za-z]/); if (m) headers.push({ lot: Number(m[1]), row: r.r }); });
    if (headers.length < 5) throw new Error("Lotkoppen niet gevonden in het sjabloon.");
    headers.sort((a, b) => a.row - b.row);
    // blok = kop + 6 t.e.m. de laatste rij van het SUM-bereik in de kop (kolom V: SUM(Mx:My)); zo groeit het bereik mee bij invoegen
    const blocks = headers.map((h, i) => { const r = rowMap.get(h.row); let last = i + 1 < headers.length ? headers[i + 1].row - 6 : h.row + 40;
      for (let k = h.row; k <= h.row + 2 && r; k++) { const c = rowMap.get(k)?.cells.get("V"); const m = c && c.inner.match(/<f>SUM\([A-Z]+\d+:[A-Z]+(\d+)\)<\/f>/); if (m) { last = Number(m[1]); break; } }
      return { lot: h.lot, header: h.row, first: h.row + 6, last }; });

    // stijlen en formulepatroon uit lot 0 (rij header+7 = lege gestileerde rij, header+8 = rij met formules)
    const b0 = blocks[0];
    const styleRow = rowMap.get(b0.first + 2) || rowMap.get(b0.first + 1);
    const styles = {}; styleRow.cells.forEach(c => styles[c.col] = styleOf(c));
    const fRow = S.rows.find(r => r.r >= b0.first && r.r <= b0.last && r.cells.get("M") && /<f>/.test(r.cells.get("M").inner));
    if (!fRow) throw new Error("Formulerij niet gevonden in het sjabloon.");
    const pattern = {}; // kolom -> functie(row) => {f | v}
    ["M", "N", "O", "P", "Q", "R", "S", "T", "V", "W", "X"].forEach(col => { const c = fRow.cells.get(col); if (!c) return; const f = c.inner.match(/<f>([^<]*)<\/f>/); const v = c.inner.match(/<v>([^<]*)<\/v>/);
      pattern[col] = f ? { f: f[1].replace(new RegExp(`([A-Z]{1,3})${fRow.r}(?![\\d])`, "g"), "$1{R}"), s: styleOf(c) } : { v: v ? v[1] : "", s: styleOf(c) }; });
    const blankRowXml = serializeRow({ r: 0, attrs: styleRow.attrs, cells: new Map([...styleRow.cells.values()].map(c => [c.col, { col: c.col, attrs: c.attrs.replace(/\st="[^"]*"/, ""), inner: "" }])) });

    // rijen invoegen: alle verwijzingen mee verschuiven
    const tailShifts = []; // [atRow, n]
    function insertRows(atRow, n) {
      S.rows.forEach(r => { if (r.r >= atRow) r.r += n; r.cells.forEach(c => { if (/<f>/.test(c.inner)) c.inner = c.inner.replace(/<f>([^<]*)<\/f>/, (m, f) => `<f>${shiftRefs(f, atRow, n, SHEET, false)}</f>`); }); });
      const idx = S.rows.findIndex(r => r.r >= atRow + n); const news = [];
      for (let i = 0; i < n; i++) { const r = { r: atRow + i, attrs: styleRow.attrs, cells: parseCells(blankRowXml.replace(/<row[^>]*>|<\/row>/g, "")) }; r.cells.forEach(c => { c.attrs = c.attrs.replace(/\st="[^"]*"/, ""); c.inner = ""; }); news.push(r); }
      S.rows.splice(idx < 0 ? S.rows.length : idx, 0, ...news);
      blocks.forEach(b => { if (b.header >= atRow) b.header += n; if (b.first >= atRow) b.first += n; if (b.last >= atRow) b.last += n; });
      tailShifts.push([atRow, n]); rowMap = byRow();
    }

    // celschrijvers
    const setCell = (row, col, body, type, style) => { const r = rowMap.get(row); if (!r) return; const old = r.cells.get(col); const s = style ?? styleOf(old) ?? styles[col]; const attrs = (s != null ? ` s="${s}"` : "") + (type ? ` t="${type}"` : ""); r.cells.set(col, { col, attrs, inner: body || "" }); };
    const setText = (row, col, text, style) => setCell(row, col, text === "" || text == null ? "" : `<is><t xml:space="preserve">${xmlEsc(text)}</t></is>`, text === "" || text == null ? null : "inlineStr", style);
    const setNum = (row, col, v, style) => setCell(row, col, v === "" || v == null ? "" : `<v>${Number(v)}</v>`, null, style);
    const setFormula = (row, col, f, cached, style) => setCell(row, col, `<f>${xmlEsc(f)}</f>${cached != null ? `<v>${cached}</v>` : ""}`, null, style);
    const clearCell = (row, col) => setCell(row, col, "", null);
    const POST_COLS = ["G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X"];

    // koptekst
    const p = opts.project || {}; const d = opts.date || new Date();
    const dd = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    const rich = (parts) => `<is>${parts.map(([t, bold]) => `<r>${bold ? `<rPr><b/><sz val="12"/><color rgb="FF000000"/><rFont val="Arial"/><family val="2"/></rPr>` : `<rPr><sz val="12"/><color rgb="FF000000"/><rFont val="Arial"/><family val="2"/></rPr>`}<t xml:space="preserve">${xmlEsc(t)}</t></r>`).join("")}</is>`;
    setCell(9, "A", rich([[`${opts.titel || "MEETSTAAT"} - `, true], [String(p.naam || p.klant || "").toUpperCase(), true], [` - DATUM ${dd}`, true]]), "inlineStr");
    const adres = [p.adres, [p.postcode, p.gemeente].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    setCell(11, "A", rich([["DOSSIER: ", true], [`${p.nummer || ""}${p.naam && p.naam !== p.klant ? " · " + p.naam : ""}\n\n`, false], ["NAAM KLANT: ", true], [`${p.klant || ""}${p.bedrijf ? " (" + p.bedrijf + ")" : ""}\n\n`, false], ["ADRES KLANT: ", true], [adres + "\n", false]]), "inlineStr");
    setCell(18, "A", rich([["E-MAIL KLANT: ", true], [[p.email1, p.email2].filter(Boolean).join(", "), false]]), "inlineStr");
    if (p.oppervlakte_m2) setNum(23, "J", p.oppervlakte_m2);

    // regels per lot
    const rowsByLot = {}; (opts.rows || []).forEach(r => (rowsByLot[r.lot] = rowsByLot[r.lot] || []).push(r));
    const values = new Map(); // "M45" -> getal (voor gecachte subtotalen)
    const warnings = [];
    for (const b of blocks) {
      const list = rowsByLot[b.lot] || [];
      // slots: groepkoppen tussenvoegen
      const slots = []; let lastG = null;
      list.forEach(r => { if (r.groep && r.groep !== lastG) { slots.push({ _kop: r.groep }); lastG = r.groep; } slots.push(r); });
      const avail = b.last - b.first + 1;
      if (slots.length > avail) insertRows(b.last, slots.length - avail);
      for (let i = 0; i < b.last - b.first + 1; i++) {
        const row = b.first + i; const s = slots[i];
        POST_COLS.forEach(c => clearCell(row, c));
        if (!s) continue;
        if (s._kop) { setText(row, "G", String(s._kop).toUpperCase()); setText(row, "H", String(s._kop).toUpperCase()); continue; }
        setText(row, "G", s.locatie || ""); setText(row, "H", s.omschrijving || ""); setText(row, "I", s.artikelnr || "");
        setNum(row, "J", Number(s.hoeveelheid) || 0); setText(row, "K", s.eenheid || ""); setNum(row, "L", Number(s.prijs) || 0);
        const M = (Number(s.hoeveelheid) || 0) * (Number(s.prijs) || 0); const btw = Number(s.btw) || 0;
        const cached = { M, N: btw, O: btw * M, P: M / 100 * 30, Q: M / 100 * 30, R: M / 100 * 30, S: M / 100 * 10, T: 0, V: M, W: btw, X: btw * M };
        Object.keys(pattern).forEach(col => { const pt = pattern[col]; if (pt.f) setFormula(row, col, pt.f.replace(/\{R\}/g, String(row)), Math.round((cached[col] ?? 0) * 100) / 100, pt.s); else setNum(row, col, col === "N" || col === "W" ? btw : pt.v, pt.s); });
        if (s.status === "meerwerk") setText(row, "U", "BIJGEVRAAGD"); else if (s.status === "minwerk") setText(row, "U", "WEGGELATEN");
        Object.keys(cached).forEach(col => values.set(col + row, cached[col]));
      }
    }
    // gecachte subtotalen in de lotkoppen (SUM over het blok), zodat ook een voorbeeldweergave zonder herberekening klopt
    blocks.forEach(b => { for (let row = b.header; row <= b.header + 2; row++) { const r = rowMap.get(row); if (!r) continue; ["V", "Z"].forEach(col => { const c = r.cells.get(col); if (!c) return; const f = c.inner.match(/<f>SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)<\/f>/); if (!f) return; let sum = 0; for (let k = Number(f[2]); k <= Number(f[4]); k++) sum += values.get(f[1] + k) || 0; c.inner = c.inner.replace(/<v>[^<]*<\/v>|$/, `<v>${Math.round(sum * 100) / 100}</v>`); }); } });

    // sheet opnieuw samenstellen; verwijzingen buiten sheetData verschuiven
    let out = S.head + S.rows.map(serializeRow).join("") + S.tail;
    tailShifts.forEach(([at, n]) => {
      out = out.replace(/<mergeCell ref="([^"]+)"/g, (m, ref) => `<mergeCell ref="${shiftSqref(ref, at, n)}"`)
        .replace(/ sqref="([^"]+)"/g, (m, ref) => ` sqref="${shiftSqref(ref, at, n)}"`)
        .replace(/<xm:sqref>([^<]+)<\/xm:sqref>/g, (m, ref) => `<xm:sqref>${shiftSqref(ref, at, n)}</xm:sqref>`)
        .replace(/<hyperlink ref="([^"]+)"/g, (m, ref) => `<hyperlink ref="${shiftSqref(ref, at, n)}"`)
        .replace(/<brk id="(\d+)"/g, (m, id) => `<brk id="${Number(id) >= at - 1 ? Number(id) + n : id}"`)
        .replace(/<formula1><xm:f>([^<]*)<\/xm:f>/g, (m, f) => `<formula1><xm:f>${shiftRefs(f, at, n, SHEET, false)}</xm:f>`)
        .replace(/<formula1>([^<]*)<\/formula1>/g, (m, f) => `<formula1>${shiftRefs(f, at, n, SHEET, false)}</formula1>`);
    });
    const maxRow = Math.max(...S.rows.map(r => r.r));
    out = out.replace(/<dimension ref="([A-Z]+)\d+:([A-Z]+)\d+"\/>/, (m, a, b) => `<dimension ref="${a}1:${b}${maxRow}"/>`);
    zip.file(main.path, out);
    // andere tabbladen: verwijzingen naar MEETSTAAT!rij mee verschuiven
    for (const sh of sheets) { if (sh === main || !tailShifts.length) continue; let x = await zip.file(sh.path).async("string"); tailShifts.forEach(([at, n]) => { x = x.replace(/<f>([^<]*)<\/f>/g, (m, f) => `<f>${shiftRefs(f, at, n, SHEET, true)}</f>`); }); zip.file(sh.path, x); }
    // workbook: bij openen alles herberekenen; oude calcChain weg
    let wb = wbXml.replace(/<calcPr([^>]*)\/>/, (m, a) => `<calcPr${a.replace(/\sfullCalcOnLoad="[^"]*"/, "")} fullCalcOnLoad="1"/>`);
    if (tailShifts.length) wb = wb.replace(/<definedName([^>]*)>([^<]*)<\/definedName>/g, (m, a, f) => { let g = f; tailShifts.forEach(([at, n]) => g = shiftRefs(g, at, n, SHEET, true)); return `<definedName${a}>${g}</definedName>`; });
    zip.file("xl/workbook.xml", wb);
    if (zip.file("xl/calcChain.xml")) { zip.remove("xl/calcChain.xml"); zip.file("xl/_rels/workbook.xml.rels", rels.replace(/<Relationship [^>]*calcChain[^>]*\/>/, "")); const ct = await zip.file("[Content_Types].xml").async("string"); zip.file("[Content_Types].xml", ct.replace(/<Override PartName="\/xl\/calcChain.xml"[^>]*\/>/, "")); }
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    return { bytes, warnings, blocks };
  }

  const api = { build, shiftRefs };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.MeetstaatExport = api;
})(typeof window !== "undefined" ? window : globalThis);
