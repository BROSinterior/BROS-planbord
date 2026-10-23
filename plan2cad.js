/* =====================================================================
   BROS Planbord — Plannen omzetten met Plan2CAD (script 054, v1.57)
   In het tabblad Plannen van een project: sleep een plan (pdf, scan, foto) in het vak. De verwerkingscomputer (Mac mini)
   zet het om naar DXF (en DWG) op ware grootte en zet origineel + resultaat in de projectmap › Plannen/DXF op Drive.
   Een schaal waar Plan2CAD niet zeker van is, wordt nooit stil gebruikt: het resultaat staat dan op 'Schaal controleren'.
   Controleren kan op drie manieren: een voorgestelde schaal kiezen, zelf een schaal ingeven, of het resultaat openen in de
   tekenmodule en daar twee punten aanduiden (zoomen + vastklikken) — 'Kalibratie overnemen' zet die schaal dan in de DXF.
   Laden vóór app.js. Gebruikt uit app.js: S, sb, esc, toast, render, openModal, opts, schemaV, isBeheer, userById,
   fmtLong, lokDag; uit tekenen.js: tkMaakPlannen, tkOpen, tkSetTool (de koppeling met de tekenmodule — niet verwijderen).
   ===================================================================== */
const P2C = { bezig: {}, open: {} };
const P2C_STATUS = { wachtrij: ["In wachtrij", "st-lopend"], bezig: ["Wordt omgezet", "st-lopend"], klaar: ["Klaar", "st-afgerond"], controle: ["Schaal controleren", "st-on_hold"], mislukt: ["Mislukt", "late"], geannuleerd: ["Gestopt", "st-offerte"] };
const P2C_KEUZE = { automatisch: "automatisch gevonden", opgegeven: "opgegeven", voorlopig: "voorlopig — beste gok", papiermaat: "nog niet op schaal (papiermaat)", kalibratie: "gekalibreerd met twee punten", voorstel: "gekozen voorstel" };
const P2C_MAX = 50 * 1024 * 1024;   // max. 50 MB per bestand (opslag 'plan2cad', script 054)
const p2cOk = () => schemaV() >= 54 && !!S.plan_omzettingen;
const p2cOf = (pid) => Object.values(S.plan_omzettingen || {}).filter(o => o.project_id === pid).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
const p2cNaam = (n) => String(n || "plan").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "").slice(-120) || "plan";
const p2cGetal = (x) => { const n = Number(String(x ?? "").replace(",", ".").replace(/^\s*1\s*[:/]\s*/, "")); return isFinite(n) && n > 0 ? n : null; };
const p2cSchaal = (n) => { const v = Math.round(Number(n) * 10) / 10; return "1:" + (Number.isInteger(v) ? v : String(v).replace(".", ",")); };

function p2cVerwerker() {
  if (typeof vgVerwerker !== "function") return "";
  const w = vgVerwerker();
  if (!w.bekend) return `<span class="vg-sig vg-sig-uit">● Nog geen verwerkingscomputer gekoppeld (Instellingen › Vergaderingen &amp; opnames)</span>`;
  if (w.online) return `<span class="vg-sig vg-sig-aan">● Verwerkingscomputer online${w.r.info && w.r.info.plan2cad === false ? " — maar Plan2CAD is er nog niet geïnstalleerd" : ""}</span>`;
  return `<span class="vg-sig vg-sig-uit">● Verwerkingscomputer niet bereikbaar sinds ${esc(fmtLong(lokDag(w.r.laatst_gezien)))} — plannen blijven in de wachtrij tot hij weer online is</span>`;
}

/* het tekenplan (tekenmodule) bij een resultaat, en wat zijn kalibratie zegt over de echte schaal */
function p2cPlan(r) { return r && r.tekenplan_id && S.tekenplannen ? S.tekenplannen[r.tekenplan_id] || null : null; }
function p2cUitKalibratie(r) {
  const pl = p2cPlan(r); if (!pl) return null;
  const k = pl.kalibratie || {}; const o = pl.onderlegger || {};
  if (k.bron !== "twee-punten" || !(k.s > 0) || !(o.p2c_noemer > 0)) return null;
  const fac = { mm: 1, cm: 10, m: 1000 }[o.eenheid || "mm"] || 1;
  return { noemer: o.p2c_noemer * k.s / fac, controle_mm: k.controle_mm };
}

/* ---------- het vak in het tabblad Plannen ---------- */
function p2cSectie(p) {
  if (schemaV() < 54) return "";
  const lijst = p2cOf(p.id);
  const up = Object.values(P2C.bezig).filter(u => u.pid === p.id);
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Plannen omzetten naar DXF/DWG</h3><div class="muted" style="font-size:12px;margin-top:2px">Plan2CAD op de verwerkingscomputer: pdf (vector of scan) of foto van een plan → DXF en DWG op ware grootte (mm, 1:1), in de projectmap › Plannen/DXF. ${p2cVerwerker()}</div></div></div>
    <label class="p2c-drop" data-p2c-drop="${p.id}" style="display:block;border:2px dashed var(--line, #DAD8D0);border-radius:10px;padding:18px;text-align:center;cursor:pointer;margin-bottom:${lijst.length || up.length ? "12px" : "0"}">
      <input type="file" multiple accept="application/pdf,.pdf,image/*,.heic" data-p2c-file="${p.id}" style="display:none">
      <b>Sleep hier een plan</b> <span class="muted">— of klik om te kiezen. PDF (ook verslagen met geplakte plannen) of een foto, max. 50 MB.</span>
    </label>
    ${up.map(u => `<div class="notice" style="margin-bottom:8px">${esc(u.naam)} — ${u.fout ? `<span style="color:var(--crit)">${esc(u.fout)}</span>` : esc(u.tekst || "opladen…")}</div>`).join("")}
    ${lijst.map(o => p2cRij(o)).join("")}</div>`;
}

function p2cRij(o) {
  const [stTxt, stCls] = P2C_STATUS[o.status] || [o.status, ""];
  const loopt = o.status === "wachtrij" || o.status === "bezig";
  const res = Array.isArray(o.resultaten) ? o.resultaten : [];
  const mag = isBeheer() || o.aangevraagd_door === S.me?.id;
  const opt = o.opties || {};
  const optTxt = [opt.paginas && opt.paginas !== "alle" ? "pagina " + opt.paginas : "", opt.papier ? "papier " + opt.papier : "", opt.schaal ? "schaal " + p2cSchaal(opt.schaal) : ""].filter(Boolean).join(" · ");
  return `<div class="p2c-rij" style="border-top:1px solid var(--line, #E5E3DC);padding:10px 0">
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <b style="word-break:break-all">${esc(o.bestand)}</b><span class="pill ${stCls}">${esc(stTxt)}${o.status === "bezig" && o.soort === "herschaal" ? " (nieuwe schaal)" : ""}</span>
      <span class="muted" style="font-size:12px">${esc(fmtLong(lokDag(o.created_at)))} · ${esc(userById(o.aangevraagd_door).name || "—")}${optTxt ? " · " + esc(optTxt) : ""}${o.pogingen > 1 && loopt ? ` · poging ${o.pogingen} van ${o.max_pogingen}` : ""}</span>
      <span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">
        ${o.drive_map_url ? `<a class="btn sm" href="${esc(o.drive_map_url)}" target="_blank" rel="noopener">Map Plannen/DXF</a>` : ""}
        ${loopt ? `<button class="btn sm" data-p2c-act="stop" data-id="${o.id}">Stoppen</button>` : `<button class="btn sm" data-p2c-act="opnieuw" data-id="${o.id}" title="Opnieuw omzetten, eventueel met andere opties">Opnieuw…</button>`}
        ${!loopt && mag ? `<button class="btn sm ghost" data-p2c-act="weg" data-id="${o.id}" title="Uit het Planbord verwijderen (de bestanden op Drive blijven)">✕</button>` : ""}
      </span></div>
    ${o.status === "bezig" ? `<div style="margin-top:6px"><div class="muted" style="font-size:12px">${esc(o.stap || "")}</div><div class="bar"><i style="width:${Math.round((Number(o.voortgang) || 0) * 100)}%"></i></div></div>` : ""}
    ${o.fout && !loopt ? `<div style="color:${o.status === "mislukt" ? "var(--crit)" : "var(--warn)"};font-size:12px;margin-top:4px">${esc(o.fout)}</div>` : ""}
    ${res.length ? `<div style="margin-top:6px">${res.map((r, i) => p2cResultaat(o, r, i, loopt)).join("")}</div>` : ""}</div>`;
}

function p2cResultaat(o, r, i, loopt) {
  if (!r.ok) return `<div class="p2c-res" style="padding:6px 0 6px 12px;border-left:3px solid var(--crit)"><b>${esc(r.label || "Pagina")}</b> — <span style="color:var(--crit)">niet omgezet: ${esc(r.fout || "")}</span></div>`;
  const pl = p2cPlan(r); const kal = !r.zeker ? p2cUitKalibratie(r) : null;
  const maat = r.breedte_mm ? `${(r.breedte_mm / 1000).toLocaleString("nl-BE", { maximumFractionDigits: 2 })} × ${(r.hoogte_mm / 1000).toLocaleString("nl-BE", { maximumFractionDigits: 2 })} m` : "";
  const sleutel = o.id + ":" + i; const open = !!P2C.open[sleutel];
  return `<div class="p2c-res" style="padding:6px 0 6px 12px;border-left:3px solid ${r.zeker ? "var(--ok, #2E7D4F)" : "var(--warn, #C77700)"};margin-bottom:6px">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <b>${esc(r.label || "Pagina")}</b>
      <span class="num">${esc(r.noemer && r.noemer !== 1 ? p2cSchaal(r.noemer) : "geen schaal")}</span>
      <span class="muted" style="font-size:12px">${esc(P2C_KEUZE[r.keuze] || r.keuze || "")}${r.keuze === "automatisch" || r.keuze === "voorlopig" ? ` (${Math.round((r.vertrouwen || 0) * 100)}% zeker)` : ""}${maat ? " · tekening " + esc(maat) : ""}</span>
      ${!r.zeker ? `<span class="pill st-on_hold" title="De maten in deze DXF zijn nog niet betrouwbaar">schaal controleren</span>` : ""}
      <span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">
        ${r.drive_dxf ? `<a class="btn sm" href="${esc(r.drive_dxf.url)}" target="_blank" rel="noopener" title="${esc(r.drive_dxf.naam || "")}">DXF</a>` : r.dxf_pad ? `<button class="btn sm" data-p2c-act="dxf" data-id="${o.id}" data-i="${i}">DXF</button>` : ""}
        ${r.drive_dwg ? `<a class="btn sm" href="${esc(r.drive_dwg.url)}" target="_blank" rel="noopener" title="${esc(r.drive_dwg.naam || "")}">DWG</a>` : ""}
        ${pl ? `<button class="btn sm" data-act="tk-open" data-id="${pl.id}">Open in Plannen</button>` : r.dxf_pad && !loopt ? `<button class="btn sm" data-p2c-act="plan" data-id="${o.id}" data-i="${i}" title="Als onderlegger in de tekenmodule — daar kan je ook inzoomen en twee punten aanduiden">${r.zeker ? "Openen in Plannen" : "Twee punten aanduiden…"}</button>` : ""}
        ${kal && !loopt ? `<button class="btn sm primary" data-p2c-act="kal" data-id="${o.id}" data-i="${i}" title="De kalibratie uit de tekenmodule in de DXF zetten">Kalibratie overnemen (${esc(p2cSchaal(kal.noemer))})</button>` : ""}
        ${!loopt ? `<button class="btn sm${r.zeker ? "" : " primary"}" data-p2c-act="schaal" data-id="${o.id}" data-i="${i}">${r.zeker ? "Andere schaal…" : "Schaal kiezen…"}</button>` : ""}
        <button class="btn sm ghost" data-p2c-act="info" data-id="${o.id}" data-i="${i}" aria-expanded="${open}">${open ? "Minder" : "Details"}</button>
      </span></div>
    ${open ? `<div class="muted" style="font-size:12px;margin-top:6px">${(r.meldingen || []).concat(r.waarschuwingen || []).map(m => `<div>· ${esc(m)}</div>`).join("")}
      ${(r.kandidaten || []).length ? `<div style="margin-top:4px"><b>Schaalvoorstellen</b>${r.kandidaten.map(k => `<div>· ${esc(k.tekst)}<br><span style="padding-left:10px">${esc(k.toelichting || "")}</span></div>`).join("")}</div>` : ""}
      ${r.polylijnen != null ? `<div style="margin-top:4px">${r.polylijnen} lijnobjecten, ${r.vlakken || 0} vlakken, ${r.teksten || 0} teksten${r.dxf_naam ? " · " + esc(r.dxf_naam) : ""}</div>` : ""}</div>` : ""}</div>`;
}

/* ---------- opladen ---------- */
async function p2cSha256(buf) { const h = await crypto.subtle.digest("SHA-256", buf); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join(""); }
function p2cKies(pid, files) {
  files = [...(files || [])].filter(f => f && f.size);
  if (!files.length) return;
  const te = files.filter(f => f.size > P2C_MAX); if (te.length) toast(`${te.map(f => f.name).join(", ")}: groter dan 50 MB — exporteer enkel de nodige bladen.`, 7000);
  const geldig = files.filter(f => f.size <= P2C_MAX && (/\.(pdf|jpe?g|png|tiff?|bmp|webp|heic)$/i.test(f.name) || /^(application\/pdf|image\/)/.test(f.type)));
  const anders = files.filter(f => f.size <= P2C_MAX && !geldig.includes(f));
  if (anders.length) toast(`${anders.map(f => f.name).join(", ")}: geen pdf of foto. Een DXF voeg je rechtstreeks toe met + Plan.`, 7000);
  if (!geldig.length) return;
  const pdf = geldig.some(f => /\.pdf$/i.test(f.name) || f.type === "application/pdf"); const foto = geldig.some(f => !(/\.pdf$/i.test(f.name) || f.type === "application/pdf"));
  openModal(geldig.length === 1 ? "Plan omzetten — " + geldig[0].name : `${geldig.length} plannen omzetten`, `<div class="form-grid">
    ${pdf ? `<div class="field"><label for="p2c_pag">Pagina's</label><input id="p2c_pag" name="paginas" value="alle" placeholder="alle, 1, 2-4"><small class="muted">'alle' = elke pagina met een plan (voorbladen met enkel tekst worden overgeslagen); een verslag met geplakte plannen geeft één DXF per plannetje.</small></div>` : ""}
    ${foto ? `<div class="field"><label for="p2c_pap">Papierformaat (foto)</label><select id="p2c_pap" name="papier">${opts([["", "automatisch"], ["A4", "A4"], ["A3", "A3"], ["A2", "A2"], ["A1", "A1"], ["A0", "A0"]], "")}</select><small class="muted">Het formaat van het gefotografeerde blad: dat trekt de foto exact recht.</small></div>` : ""}
    <div class="field"><label for="p2c_sch">Schaal</label><input id="p2c_sch" name="schaal" placeholder="automatisch" inputmode="decimal"><small class="muted">Leeg = Plan2CAD zoekt ze zelf (maatlijnen, vermelding). Weet je ze zeker, geef ze in: 50 of 1:50.</small></div>
    <div class="field"><label class="sw-row"><input type="checkbox" class="sw" name="dwg" value="1" checked><span>Ook een DWG <small class="muted" style="display:block">als de ODA File Converter op de verwerkingscomputer staat</small></span></label></div>
  </div>`, {
    saveLabel: "Omzetten",
    onSave: (d) => {
      const schaal = String(d.schaal || "").trim() ? p2cGetal(d.schaal) : null;
      if (String(d.schaal || "").trim() && !schaal) { toast("Die schaal kan ik niet lezen — geef bv. 50 of 1:50 in."); return false; }
      const opties = { paginas: String(d.paginas || "alle").trim() || "alle", papier: d.papier || "", schaal, dwg: d.dwg === "1" };
      geldig.forEach(f => p2cOpladen(pid, f, opties));
    },
  });
}
async function p2cOpladen(pid, f, opties) {
  const id = (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); }));
  P2C.bezig[id] = { pid, naam: f.name, tekst: "opladen…" }; render();
  try {
    const buf = await f.arrayBuffer(); const sha = await p2cSha256(buf);
    const pad = `${id}/bron/${p2cNaam(f.name)}`;
    const { error } = await sb.storage.from("plan2cad").upload(pad, new Blob([buf], { type: f.type || "application/octet-stream" }), { contentType: f.type || "application/octet-stream", upsert: false });
    if (error) throw new Error("Opladen mislukt: " + error.message);
    P2C.bezig[id].tekst = "in de wachtrij zetten…"; render();
    const { data, error: e2 } = await sb.rpc("plan_omzetting_maak", { p_id: id, p_project: pid, p_bestand: f.name, p_pad: pad, p_grootte: f.size, p_sha256: sha, p_opties: opties });
    if (e2) { await sb.storage.from("plan2cad").remove([pad]); throw new Error(e2.message); }
    if (data && data.id) S.plan_omzettingen[data.id] = data;
    delete P2C.bezig[id]; toast(`${f.name} staat in de wachtrij — de verwerkingscomputer zet het om.`, 4500); render();
  } catch (e) { P2C.bezig[id] = { pid, naam: f.name, fout: (e && e.message) || String(e) }; render(); setTimeout(() => { delete P2C.bezig[id]; render(); }, 15000); }
}
window.addEventListener("beforeunload", (e) => { if (Object.values(P2C.bezig).some(u => !u.fout)) { e.preventDefault(); e.returnValue = ""; } });

/* ---------- acties ---------- */
async function p2cRpc(naam, args, melding) {
  const { data, error } = await sb.rpc(naam, args);
  if (error) { toast(error.message, 6000); return null; }
  if (data && data.id) S.plan_omzettingen[data.id] = data;
  if (melding) toast(melding, 4000);
  render(); return data;
}
function p2cSchaalDlg(o, i) {
  const r = o.resultaten[i]; const kal = p2cUitKalibratie(r);
  const kand = (r.kandidaten || []).filter(k => k.noemer > 0);
  const huidig = r.noemer && r.noemer !== 1 ? r.noemer : null;
  openModal("Schaal — " + (r.label || o.bestand), `<div class="form-grid">
    <div class="field span2"><div class="muted" style="font-size:12px">Nu: <b>${esc(huidig ? p2cSchaal(huidig) : "geen schaal")}</b> (${esc(P2C_KEUZE[r.keuze] || r.keuze || "")}). De DXF en DWG worden opnieuw gemaakt op de schaal die je kiest; de vorige gaan naar de prullenbak van Drive.</div></div>
    ${kal ? `<div class="field span2"><label class="sw-row"><input type="radio" name="keuze" value="kal:${kal.noemer}" checked><span><b>${esc(p2cSchaal(kal.noemer))}</b> — uit je kalibratie in de tekenmodule${kal.controle_mm ? ` (${Number(kal.controle_mm).toLocaleString("nl-BE")} mm)` : ""}</span></label></div>` : ""}
    ${kand.map((k, n) => `<div class="field span2"><label class="sw-row"><input type="radio" name="keuze" value="vs:${k.noemer}" ${!kal && n === 0 ? "checked" : ""}><span><b>${esc(p2cSchaal(k.noemer))}</b>${k.standaard && Math.abs(k.standaard - k.noemer) / k.standaard > 0.0015 ? ` <span class="muted">(gemeten; dichtst bij ${esc(p2cSchaal(k.standaard))})</span>` : ""} — ${Math.round(k.vertrouwen * 100)}% zeker<small class="muted" style="display:block">${esc(k.toelichting || "")}</small></span></label></div>`).join("")}
    ${kand.some(k => k.standaard && Math.abs(k.standaard - k.noemer) / k.standaard > 0.0015) ? `<div class="field span2"><small class="muted">Tip: de gemeten waarde doet de maten van dít blad kloppen (ook als het verkleind afgedrukt of gefotografeerd is); de nette schaal enkel als het plan op ware papiergrootte staat.</small></div>` : ""}
    <div class="field span2"><label class="sw-row"><input type="radio" name="keuze" value="eigen" ${!kal && !kand.length ? "checked" : ""}><span>Zelf ingeven: <input name="eigen" placeholder="bv. 50 of 1:50" inputmode="decimal" style="width:120px;margin-left:6px" data-p2c-eigen></span></label></div>
    ${!kal ? `<div class="field span2"><small class="muted">Geen enkele klopt? Kies <b>Twee punten aanduiden…</b>: het plan opent in de tekenmodule, waar je inzoomt en op twee punten van een gekende maat klikt (de cursor klikt vast op hoekpunten en lijnen). Daarna verschijnt hier <b>Kalibratie overnemen</b>.</small></div>` : ""}
  </div>`, {
    saveLabel: "DXF opnieuw maken",
    onSave: async (d) => {
      const k = String(d.keuze || ""); let noemer = null, bron = "opgegeven";
      if (k.startsWith("kal:")) { noemer = Number(k.slice(4)); bron = "kalibratie"; }
      else if (k.startsWith("vs:")) { noemer = Number(k.slice(3)); bron = "voorstel"; }
      else noemer = p2cGetal(d.eigen);
      if (!(noemer > 0)) { toast("Kies een schaal of geef er een in (bv. 50 of 1:50)."); return false; }
      const ok = await p2cRpc("plan_omzetting_herschaal", { p_id: o.id, p_index: i, p_noemer: Math.round(noemer * 10000) / 10000, p_bron: bron }, `De DXF wordt opnieuw gemaakt op ${p2cSchaal(noemer)}.`);
      if (!ok) return false;
    },
  });
  const eigen = document.querySelector("[data-p2c-eigen]"); if (eigen) eigen.addEventListener("focus", () => { const rb = document.querySelector('input[name="keuze"][value="eigen"]'); if (rb) rb.checked = true; });
}
function p2cOpnieuwDlg(o) {
  const opt = o.opties || {}; const pdf = /\.pdf$/i.test(o.bestand);
  openModal("Opnieuw omzetten — " + o.bestand, `<div class="form-grid">
    ${pdf ? `<div class="field"><label for="p2c_pag2">Pagina's</label><input id="p2c_pag2" name="paginas" value="${esc(opt.paginas || "alle")}"></div>` : `<div class="field"><label for="p2c_pap2">Papierformaat (foto)</label><select id="p2c_pap2" name="papier">${opts([["", "automatisch"], ["A4", "A4"], ["A3", "A3"], ["A2", "A2"], ["A1", "A1"], ["A0", "A0"]], opt.papier || "")}</select></div>`}
    <div class="field"><label for="p2c_sch2">Schaal</label><input id="p2c_sch2" name="schaal" value="${opt.schaal ? esc(String(opt.schaal).replace(".", ",")) : ""}" placeholder="automatisch" inputmode="decimal"></div>
    <div class="field"><label class="sw-row"><input type="checkbox" class="sw" name="dwg" value="1" ${opt.dwg !== false ? "checked" : ""}><span>Ook een DWG</span></label></div>
    <div class="field span2"><small class="muted">Alle resultaten van dit bestand worden opnieuw gemaakt; de DXF's met dezelfde naam op Drive gaan naar de prullenbak.</small></div></div>`, {
    saveLabel: "Opnieuw omzetten",
    onSave: async (d) => {
      const schaal = String(d.schaal || "").trim() ? p2cGetal(d.schaal) : null;
      if (String(d.schaal || "").trim() && !schaal) { toast("Die schaal kan ik niet lezen — geef bv. 50 of 1:50 in."); return false; }
      const ok = await p2cRpc("plan_omzetting_opnieuw", { p_id: o.id, p_opties: { paginas: d.paginas || opt.paginas || "alle", papier: d.papier ?? opt.papier ?? "", schaal, dwg: d.dwg === "1" } }, "Opnieuw in de wachtrij gezet.");
      if (!ok) return false;
    },
  });
}
async function p2cDxfBlob(r) {
  const { data, error } = await sb.storage.from("plan2cad").download(r.dxf_pad);
  if (error || !data) throw new Error("DXF niet gevonden in het Planbord" + (error ? ": " + error.message : "") + ".");
  return data;
}
async function p2cAlsPlan(o, i) {
  const r = o.resultaten[i]; if (typeof tkMaakPlannen !== "function") { toast("De tekenmodule is niet geladen."); return; }
  const sleutel = o.id + ":" + i; if (P2C.bezig[sleutel]) return;
  P2C.bezig[sleutel] = { pid: o.project_id, naam: r.dxf_naam || r.label, tekst: "plan maken in de tekenmodule…" }; render();
  try {
    const blob = await p2cDxfBlob(r);
    const f = new File([blob], r.dxf_naam || "plan.dxf", { type: "application/octet-stream" });
    const n = r.zeker && r.noemer ? r.noemer : 50; const tekenschaal = [20, 50, 100].reduce((a, b) => Math.abs(b - n) < Math.abs(a - n) ? b : a, 50);
    const naam = (o.bestand.replace(/\.[^.]+$/, "") + (o.resultaten.length > 1 ? " · " + (r.label || "") : "")).slice(0, 120);
    const nieuw = await tkMaakPlannen(o.project_id, f, null, { naam, schaal: String(tekenschaal), papier: "A1", eenheid: "mm" }, (t) => { P2C.bezig[sleutel].tekst = t; render(); });
    const pl = nieuw && nieuw[0]; if (!pl) throw new Error("Het plan kon niet gemaakt worden.");
    // onthouden op welke schaal deze DXF geschreven is: zo volgt de echte schaal uit een kalibratie met twee punten
    const ond = { ...(pl.onderlegger || {}), p2c_omzetting: o.id, p2c_index: i, p2c_noemer: r.noemer || 1 };
    const { data: upd, error } = await sb.from("tekenplannen").update({ onderlegger: ond }).eq("id", pl.id).select().single();
    if (!error && upd) S.tekenplannen[upd.id] = upd; else S.tekenplannen[pl.id] = { ...pl, onderlegger: ond };
    await p2cRpc("plan_omzetting_koppel", { p_id: o.id, p_index: i, p_tekenplan: pl.id });
    delete P2C.bezig[sleutel]; S.ptab = "tekenen"; render();
    setTimeout(() => {
      tkOpen(pl.id);
      if (!r.zeker && typeof tkSetTool === "function") { tkSetTool("kalibreren"); toast("Zoom in en klik op het begin en het einde van een maat die je kent. Daarna in het tabblad Plannen: Kalibratie overnemen.", 9000); }
    }, 60);
  } catch (e) { P2C.bezig[sleutel] = { pid: o.project_id, naam: r.dxf_naam || r.label, fout: (e && e.message) || String(e) }; render(); setTimeout(() => { delete P2C.bezig[sleutel]; render(); }, 15000); }
}
async function p2cDownload(o, i) {
  const r = o.resultaten[i];
  try { const blob = await p2cDxfBlob(r); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = r.dxf_naam || "plan_1op1.dxf"; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
  catch (e) { toast(e.message || String(e), 6000); }
}
async function p2cVerwijder(o) {
  if (!confirm(`"${o.bestand}" uit het Planbord verwijderen? De bestanden in Plannen/DXF op Drive en een plan in de tekenmodule blijven staan.`)) return;
  const paden = [o.bron_pad].concat((o.resultaten || []).map(r => r && r.dxf_pad)).filter(Boolean);
  if (paden.length) { const { error } = await sb.storage.from("plan2cad").remove(paden); if (error) console.warn("opslag niet opgeruimd", error); }
  const { error } = await sb.from("plan_omzettingen").delete().eq("id", o.id);
  if (error) { toast(error.message, 6000); return; }
  delete S.plan_omzettingen[o.id]; render();
}

document.addEventListener("click", (e) => {
  const el = e.target.closest && e.target.closest("[data-p2c-act]"); if (!el) return;
  e.preventDefault();
  const o = S.plan_omzettingen && S.plan_omzettingen[el.dataset.id]; if (!o) return;
  const i = Number(el.dataset.i); const a = el.dataset.p2cAct;
  if (a === "info") { const k = o.id + ":" + i; P2C.open[k] = !P2C.open[k]; render(); return; }
  if (a === "schaal") return p2cSchaalDlg(o, i);
  if (a === "kal") { const kal = p2cUitKalibratie(o.resultaten[i]); if (!kal) return; if (!confirm(`De DXF opnieuw maken op ${p2cSchaal(kal.noemer)} (uit je kalibratie in de tekenmodule)?`)) return; p2cRpc("plan_omzetting_herschaal", { p_id: o.id, p_index: i, p_noemer: Math.round(kal.noemer * 10000) / 10000, p_bron: "kalibratie" }, `De DXF wordt opnieuw gemaakt op ${p2cSchaal(kal.noemer)}.`); return; }
  if (a === "plan") return p2cAlsPlan(o, i);
  if (a === "dxf") return p2cDownload(o, i);
  if (a === "opnieuw") return p2cOpnieuwDlg(o);
  if (a === "stop") { if (confirm(`Het omzetten van "${o.bestand}" stoppen?`)) p2cRpc("plan_omzetting_stop", { p_id: o.id }, "Gestopt."); return; }
  if (a === "weg") return p2cVerwijder(o);
});
document.addEventListener("change", (e) => {
  const inp = e.target.closest && e.target.closest("[data-p2c-file]"); if (!inp) return;
  const files = [...inp.files]; inp.value = ""; p2cKies(inp.dataset.p2cFile, files);
});
["dragenter", "dragover"].forEach(t => document.addEventListener(t, (e) => {
  const z = e.target.closest && e.target.closest("[data-p2c-drop]"); if (!z) return;
  e.preventDefault(); z.style.background = "var(--surface-2, #F3F2EE)";
}));
document.addEventListener("dragleave", (e) => { const z = e.target.closest && e.target.closest("[data-p2c-drop]"); if (z && !z.contains(e.relatedTarget)) z.style.background = ""; });
document.addEventListener("drop", (e) => {
  const z = e.target.closest && e.target.closest("[data-p2c-drop]"); if (!z) return;
  e.preventDefault(); z.style.background = ""; p2cKies(z.dataset.p2cDrop, e.dataTransfer && e.dataTransfer.files);
});
