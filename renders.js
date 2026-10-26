/* =====================================================================
   BROS Planbord — Renders (script 055, v1.59) — BROS Render in het Planbord
   Per project een tabblad Renders: ontwerpbeelden opladen en meteen laten renderen. De verwerkingscomputer (Mac mini) doet
   de betaalde OpenAI-beeldgeneratie (de sleutel staat enkel daar, in de sleutelhanger) en zet het resultaat in het Planbord
   en in de projectmap › Renders/<ruimte> op Drive. Optionele sfeerbeelden (max. 4) sturen enkel licht en sfeer; de
   architectuur en de materiaalafspraken van het project blijven leidend. A3-presentatie in de BROS-huisstijl.
   Dubbel betalen kan niet: elk beeld krijgt bij het kiezen een vast aanvraagnummer (request_id); opnieuw versturen na een
   netwerkfout geeft de bestaande opdracht terug (de databank bewaakt dat, script 055).
   1.60 (script 056): stalenbord per ruimte — een fotorealistische foto van echte stalen (enkel de materialen van die ruimte)
   met dezelfde wachtrij, toestemming, daglimiet en bescherming tegen dubbel betalen; versies, keuze voor de presentatie en
   de optie "Stalenborden per ruimte opnemen" in de A3-presentatie (nooit een beeldgeneratie bij het maken van de pdf).
   Laden vóór app.js. Gebruikt uit app.js: S, sb, esc, toast, render, openModal, closeModal, opts, schemaV, isBeheer,
   userById, fmtLong, lokDag, lokUur, todayIso, dbInsert, dbUpdate, dbDelete, nl, projName; uit vergaderingen.js: vgVerwerker.
   ===================================================================== */
const RD = { batch: null, urls: {}, laden: {}, filter: "", sfeerKeuze: null };
const RD_STATUS = { wachtrij: ["In wachtrij", "st-lopend"], bezig: ["Wordt gerenderd", "st-lopend"], klaar: ["Klaar", "st-afgerond"], mislukt: ["Mislukt", "late"], onzeker: ["Controle nodig", "st-on_hold"], geannuleerd: ["Geannuleerd", "st-offerte"] };
const RD_KWALITEIT = [["low", "Snel (laag)"], ["medium", "Standaard"], ["high", "Hoog"]];
const RD_MAX = 48 * 1024 * 1024;   // OpenAI aanvaardt max. 50 MB per beeld
const RD_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const rdOk = () => schemaV() >= 55 && !!S.render_opdrachten;
const rdSbOk = () => schemaV() >= 56;   // stalenborden (script 056)
const MODAL_OPEN = () => { const bg = document.getElementById("modalBg"); return !!(bg && bg.classList.contains("show")); };
const rdSleutel = (r) => String(r || "").trim().toLowerCase();
const rdIsRender = (o) => (o.soort || "render") === "render";
const rdCfg = () => { const v = (S.instellingen && S.instellingen.render && S.instellingen.render.value) || {};
  return { model: v.model || "gpt-image-2", kwaliteit: ["low", "medium", "high"].includes(v.kwaliteit) ? v.kwaliteit : "medium", lange_zijde: [1536, 2048, 2560].includes(Number(v.lange_zijde)) ? Number(v.lange_zijde) : 2048, daglimiet: Number.isFinite(Number(v.daglimiet)) ? Number(v.daglimiet) : 20 }; };
const rdBeelden = (pid, soort) => Object.values(S.render_beelden || {}).filter(b => b.project_id === pid && (!soort || b.soort === soort)).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
const rdOpdrachten = (pid) => Object.values(S.render_opdrachten || {}).filter(o => o.project_id === pid).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
const rdAfspraken = (pid) => Object.values(S.render_afspraken || {}).filter(a => a.project_id === pid).sort((a, b) => (a.ruimte || "").localeCompare(b.ruimte || "") || (a.created_at || "").localeCompare(b.created_at || ""));
const rdPresentaties = (pid) => Object.values(S.render_presentaties || {}).filter(r => r.project_id === pid).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
const rdRuimtes = (pid) => { const m = new Map(); rdBeelden(pid).filter(b => b.soort !== "sfeer").map(b => b.ruimte).concat(rdOpdrachten(pid).map(o => o.ruimte), rdAfspraken(pid).map(a => a.ruimte))   // schrijfwijze: eerst die van de beelden
  .forEach(r => { const t = String(r || "").trim(); if (t && t !== "*" && !m.has(t.toLowerCase())) m.set(t.toLowerCase(), t); }); return [...m.values()].sort((a, b) => a.localeCompare(b, "nl", { sensitivity: "base" })); };
const rdVandaag = () => { const n = new Date(); const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(n); return Object.values(S.render_opdrachten || {}).filter(o => o.dag === d && o.status !== "geannuleerd").length; };
const rdHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, "0")).join("");
const rdNetFout = (e) => Number(e && (e.statusCode || e.status)) >= 500 || /fetch|network|timeout|load failed|connection|502|503|504/i.test(String((e && (e.message || e.error)) || e || ""));   // tijdelijk: opnieuw proberen

/* ---------- miniaturen: getekende links (1 uur), per bundel opgehaald ---------- */
function rdUrl(pad) { const c = RD.urls[pad]; if (c && (c.fout ? c.tot > Date.now() : c.tot > Date.now() + 120000)) return c.url; RD.laden[pad] = true; rdUrlsLaden(); return ""; }
let rdUrlT = null;
function rdUrlsLaden() {
  if (rdUrlT) return;
  rdUrlT = setTimeout(async () => {
    rdUrlT = null; const paden = Object.keys(RD.laden); RD.laden = {}; if (!paden.length) return;
    let nieuw = 0;
    paden.forEach(p => { RD.urls[p] = { url: "", fout: true, tot: Date.now() + 60000 }; });   // mislukt of ontbrekend: pas na een minuut opnieuw vragen
    for (let i = 0; i < paden.length; i += 50) {
      try {
        const { data, error } = await sb.storage.from("renders").createSignedUrls(paden.slice(i, i + 50), 3600);
        if (error) continue;
        (data || []).forEach(d => { if (d.signedUrl) { RD.urls[d.path] = { url: d.signedUrl, tot: Date.now() + 3600 * 1000 }; nieuw++; } });
      } catch (e) { }
    }
    if (nieuw) render();
  }, 30);
}
const rdImg = (b, cls) => { if (!b) return `<div class="rd-img leeg ${cls || ""}"></div>`; const u = rdUrl(b.pad); const c = RD.urls[b.pad]; return u ? `<img class="rd-img ${cls || ""}" src="${esc(u)}" alt="${esc(b.naam || "")}" loading="lazy">` : `<div class="rd-img ${c && c.fout ? "leeg" : "laden"} ${cls || ""}"></div>`; };

function rdSignaal() {
  if (typeof vgVerwerker !== "function") return "";
  const w = vgVerwerker(); const i = (w.r && w.r.info) || {};
  if (!w.bekend) return `<span class="vg-sig vg-sig-uit">● Nog geen verwerkingscomputer gekoppeld (Instellingen › Vergaderingen &amp; opnames)</span>`;
  if (!w.online) return `<span class="vg-sig vg-sig-uit">● Verwerkingscomputer niet bereikbaar sinds ${esc(fmtLong(lokDag(w.r.laatst_gezien)))} — renders blijven in de wachtrij tot hij weer online is</span>`;
  if (i.renders === false) return `<span class="vg-sig vg-sig-uit">● Verwerkingscomputer online, maar er staat nog geen OpenAI-sleutel op (installeer.sh op de Mac mini)</span>`;
  if (i.renders === undefined) return `<span class="vg-sig vg-sig-uit">● Verwerkingscomputer online, maar nog zonder rendermodule — voer installeer.sh opnieuw uit op de Mac mini</span>`;
  return `<span class="vg-sig vg-sig-aan">● Verwerkingscomputer online${i.bezig ? " · bezig" : ""}</span>`;
}

/* ---------- het tabblad ---------- */
function vRenders(p) {
  if (schemaV() < 55) return typeof SCHEMA_HINT === "function" ? SCHEMA_HINT(55) : "Voer eerst sql/055_renders.sql uit.";
  const cfg = rdCfg(); const ops = rdOpdrachten(p.id).filter(rdIsRender); const nV = rdVandaag();
  const ruimtes = [...new Set(ops.map(o => o.ruimte))].sort((a, b) => a.localeCompare(b));
  const zicht = RD.filter && ruimtes.includes(RD.filter) ? ops.filter(o => o.ruimte === RD.filter) : ops;
  const batch = RD.batch && RD.batch.pid === p.id ? rdBatchHtml() : "";
  return `<div class="panel"><div class="panel-head"><div><h3>Renders</h3><div class="muted" style="font-size:12px;margin-top:2px">${rdSignaal()} · ${esc(cfg.model)} · vandaag ${nV}/${cfg.daglimiet} renders</div></div>
      <div class="actions"><button class="btn sm" data-rd-act="pres-nieuw" data-pid="${p.id}" ${rdBeelden(p.id).some(b => b.soort === "render" || b.soort === "ontwerp") ? "" : "disabled"}>A3-presentatie</button><button class="btn sm primary" data-rd-act="nieuw" data-pid="${p.id}">Uploaden en renderen</button></div></div>
    ${batch}
    ${ruimtes.length > 1 ? `<div class="rd-chips"><button class="${RD.filter ? "" : "on"}" data-rd-act="filter" data-r="">Alle ruimtes</button>${ruimtes.map(r => `<button class="${RD.filter === r ? "on" : ""}" data-rd-act="filter" data-r="${esc(r)}">${esc(r)}</button>`).join("")}</div>` : ""}
    ${zicht.length ? `<div class="rd-grid">${zicht.map(rdKaart).join("")}</div>` : `<div class="empty"><b>Nog geen renders</b>Klik op <b>Uploaden en renderen</b>: kies de ruimte en je ontwerpbeelden (bv. uit SketchUp of Vectorworks), eventueel sfeerbeelden, en de verwerkingscomputer maakt er fotorealistische renders van.</div>`}
  </div>
  ${rdSbOk() ? rdStalenPaneel(p) : ""}
  <div class="grid two rd-onder">${rdSfeerPaneel(p)}${rdAfsprakenPaneel(p)}</div>
  ${rdPresentatiesPaneel(p)}`;
}

function rdKaart(o) {
  const bron = S.render_beelden[o.bron_id]; const res = o.resultaat_id ? S.render_beelden[o.resultaat_id] : null;
  const [l, c] = RD_STATUS[o.status] || [o.status, "st-offerte"];
  const wie = o.aangevraagd_door ? userById(o.aangevraagd_door).name : "";
  const goed = res && res.goedgekeurd_op;
  return `<div class="rd-kaart${goed ? " goed" : ""}"><div class="rd-duo">${rdImg(bron, "bron")}${res ? `<button type="button" class="rd-res" data-rd-act="vergelijk" data-id="${o.id}" title="Vergelijken">${rdImg(res)}</button>` : `<div class="rd-img rd-wacht"><span>${esc(l)}${o.status === "bezig" && o.stap ? `<small>${esc(o.stap)}</small>` : ""}</span></div>`}</div>
    <div class="rd-info"><div><span class="pill ${c}">${esc(l)}</span>${goed ? ` <span class="pill done">goedgekeurd</span>` : ""} <b>${esc(o.ruimte)}</b></div>
      <div class="rd-instr" title="${esc(o.instructie)}">${esc(o.instructie)}</div>
      <small class="muted">${esc(wie)} · ${esc(fmtLong(lokDag(o.created_at)))} ${esc(lokUur(o.created_at))} · ${esc(o.model)} · ${esc((RD_KWALITEIT.find(k => k[0] === o.kwaliteit) || [0, o.kwaliteit])[1])}${(o.sfeer_ids || []).length ? ` · ${o.sfeer_ids.length} sfeerbeeld${o.sfeer_ids.length > 1 ? "en" : ""}` : ""}</small>
      ${o.fout && o.status !== "klaar" ? `<div class="rd-fout">${esc(o.fout)}</div>` : o.fout ? `<small class="muted" style="display:block">${esc(o.fout)}</small>` : ""}
      <div class="actions">${res ? `<button class="btn sm" data-rd-act="vergelijk" data-id="${o.id}">Vergelijken</button><button class="btn sm" data-rd-act="goed" data-id="${res.id}" data-v="${goed ? "0" : "1"}">${goed ? "Goedkeuring intrekken" : "Goedkeuren"}</button><button class="btn sm" data-rd-act="download" data-id="${res.id}">Downloaden</button>${res.drive && res.drive.url ? `<a class="btn sm" href="${esc(safeUrl(res.drive.url))}" target="_blank" rel="noopener">Drive ↗</a>` : ""}<button class="btn sm" data-rd-act="corrigeer" data-id="${res.id}" title="Een nieuwe render op basis van deze render (gerichte correctie)">Corrigeren…</button>${rdSbOk() ? `<button class="btn sm ghost" data-rd-act="ruimte" data-id="${res.id}" title="Deze render aan een andere ruimte koppelen (stalenbord en presentatie volgen de ruimte)">Ruimte…</button>` : ""}` : ""}
        ${o.status === "wachtrij" && (isBeheer() || o.aangevraagd_door === S.me.id) ? `<button class="btn sm ghost danger" data-rd-act="annuleer" data-id="${o.id}">Annuleren</button>` : ""}
        ${["mislukt", "onzeker", "geannuleerd"].includes(o.status) && bron ? `<button class="btn sm" data-rd-act="opnieuw" data-id="${o.id}">Opnieuw…</button>` : ""}</div></div></div>`;
}

/* ---------- uploaden en renderen ---------- */
function rdForm(pid, preset) {
  preset = preset || {};
  const p = S.projecten[pid]; const cfg = rdCfg(); const sferen = rdBeelden(pid, "sfeer");
  const bestaand = preset.bron ? S.render_beelden[preset.bron] : null;
  const gekozen = new Set(preset.sfeer || []);
  const nV = rdVandaag();
  openModal((bestaand ? "Opnieuw renderen — " : "Uploaden en renderen — ") + projName(p), `<div class="form-grid">
    <div class="field"><label for="rd_ruimte">Ruimte</label><input id="rd_ruimte" name="ruimte" list="rd_ruimtes" required maxlength="120" value="${esc(preset.ruimte || (bestaand && bestaand.ruimte) || "")}" placeholder="bv. Leefruimte"><datalist id="rd_ruimtes">${rdRuimtes(pid).map(r => `<option value="${esc(r)}">`).join("")}</datalist></div>
    <div class="field"><label for="rd_kw">Kwaliteit</label><select id="rd_kw" name="kwaliteit">${opts(RD_KWALITEIT, preset.kwaliteit || cfg.kwaliteit)}</select></div>
    ${bestaand ? `<div class="field span2"><label>Bron</label><div class="rd-bron">${rdImg(bestaand)}<small class="muted">${bestaand.soort === "render" ? "Een eerdere render: enkel wat je hieronder vraagt, verandert." : "Het eerder opgeladen ontwerp."}</small></div></div>`
      : `<div class="field span2"><label for="rd_files">Ontwerpbeelden <small class="muted" style="font-weight:400">— één render per beeld · PNG, JPEG of WebP, max. 48 MB</small></label><input id="rd_files" type="file" accept="image/png,image/jpeg,image/webp" multiple></div>`}
    <div class="field span2"><label for="rd_instr">Wat moet er gebeuren?</label><textarea id="rd_instr" name="instructie" rows="3" required maxlength="4000" placeholder="bv. Fotorealistische render met zacht ochtendlicht. Behoud architectuur, camerastandpunt en materialen.">${esc(preset.instructie || "")}</textarea></div>
    <div class="field span2"><label>Sfeerbeelden <small class="muted" style="font-weight:400">— optioneel, max. 4: enkel licht, contrast, kleurtemperatuur en sfeer worden overgenomen</small></label>
      ${sferen.length ? `<div class="rd-sfeerkeuze">${sferen.map(s => `<label class="rd-sk"><input type="checkbox" name="sfeer" value="${s.id}" ${gekozen.has(s.id) ? "checked" : ""}>${rdImg(s)}</label>`).join("")}</div>` : `<small class="muted">Nog geen sfeerbeelden in dit project — voeg ze toe onder Sfeerbibliotheek.</small>`}</div>
    <div class="field span2" id="rd_afspr_vak">${rdAfsprakenInfo(pid, preset.ruimte || (bestaand && bestaand.ruimte) || "")}</div>
    <div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" name="ok" value="1"><span><b id="rd_ok_t">Ik start betaalde beeldgeneratie</b><small class="muted" style="display:block">Model ${esc(cfg.model)} · elke render is één betaalde aanvraag bij OpenAI · vandaag al ${nV} van max. ${cfg.daglimiet}. Een mislukte of onzekere render wordt nooit automatisch opnieuw betaald.</small></span></label></div>
  </div>`, {
    saveLabel: bestaand ? "Renderen" : "Uploaden en renderen", wide: true,
    onSave: async (d) => {
      const f = $("#mform");
      const ruimte = String(d.ruimte || "").trim(); const instructie = String(d.instructie || "").trim();
      const sfeer = [...f.querySelectorAll('input[name="sfeer"]:checked')].map(i => i.value);
      if (!ruimte) { toast("Vul de ruimte in."); return false; }
      if (!instructie) { toast("Beschrijf wat er moet gebeuren."); return false; }
      if (sfeer.length > 4) { toast("Kies maximaal vier sfeerbeelden."); return false; }
      if (!d.ok) { toast("Bevestig eerst de betaalde beeldgeneratie."); return false; }
      const files = bestaand ? [] : [...(($("#rd_files") || {}).files || [])];
      if (!bestaand && !files.length) { toast("Kies minstens één ontwerpbeeld."); return false; }
      const fout = files.find(x => !RD_TYPES[x.type] || x.size > RD_MAX || !x.size);
      if (fout) { toast(`${fout.name}: enkel PNG, JPEG of WebP tot 48 MB.`, 6000); return false; }
      const aantal = bestaand ? 1 : files.length;
      if (nV + aantal > cfg.daglimiet) { toast(`Daglimiet: vandaag kunnen nog ${Math.max(0, cfg.daglimiet - nV)} renders. Een beheerder kan dat verhogen in Instellingen › Renders.`, 7000); return false; }
      if (aantal > 1 && !confirm(`${aantal} beelden: dat zijn ${aantal} betaalde renders met ${cfg.model}. Starten?`)) return false;
      // vast vanaf hier: project, ruimte, instructie, sfeer, kwaliteit en model voor de hele reeks; elk beeld een vast aanvraagnummer
      const vast = { pid, ruimte, instructie, sfeer, kwaliteit: d.kwaliteit || cfg.kwaliteit, model: cfg.model };
      const items = bestaand ? [{ rid: rdHex(16), naam: bestaand.naam || "bron", bron: { id: bestaand.id }, st: "wacht" }]
        : files.map(file => ({ rid: rdHex(16), naam: file.name, file, st: "wacht" }));
      RD.batch = { pid, vast, items, bezig: true };
      setTimeout(() => rdBatch(), 0);
    },
  });
  const ri = $("#rd_ruimte"); if (ri) ri.addEventListener("input", () => { const v = $("#rd_afspr_vak"); if (v) v.innerHTML = rdAfsprakenInfo(pid, ri.value); });
  const fi = $("#rd_files"); if (fi) fi.addEventListener("change", () => { const n = fi.files.length; const t = $("#rd_ok_t"); if (t) t.textContent = n > 1 ? `Ik start ${n} betaalde beeldgeneraties` : "Ik start betaalde beeldgeneratie"; });
  const box = $("#mform"); if (box) box.addEventListener("change", (e) => { if (e.target.name === "sfeer" && box.querySelectorAll('input[name="sfeer"]:checked').length > 4) { e.target.checked = false; toast("Maximaal vier sfeerbeelden."); } });
}
function rdAfsprakenInfo(pid, ruimte) {
  const r = String(ruimte || "").trim().toLowerCase();
  const l = rdAfspraken(pid).filter(a => a.ruimte === "*" || (r && a.ruimte.trim().toLowerCase() === r));
  return `<label>Materiaalafspraken die meegaan</label>${l.length ? `<ul class="rd-afspr">${l.map(a => `<li><small class="muted">${a.ruimte === "*" ? "heel project" : esc(a.ruimte)}:</small> ${esc(a.tekst)}</li>`).join("")}</ul>` : `<small class="muted">Geen afspraken voor ${r ? "deze ruimte" : "het project"} — voeg ze toe onder Materiaalafspraken (bv. "vloer: eiken visgraat, natuurgeolied").</small>`}`;
}

/* de reeks: per beeld opladen → aanvragen; bij een netwerkfout dezelfde aanvraag opnieuw (nooit een tweede betaalde opdracht) */
async function rdMaat(file) {
  try { if (window.createImageBitmap) { const b = await createImageBitmap(file); const r = { w: b.width, h: b.height }; b.close && b.close(); return r; } } catch (e) { }
  return await new Promise((ok) => { const u = URL.createObjectURL(file); const im = new Image(); im.onload = () => { ok({ w: im.naturalWidth, h: im.naturalHeight }); URL.revokeObjectURL(u); }; im.onerror = () => { ok(null); URL.revokeObjectURL(u); }; im.src = u; });
}
async function rdPoging(fn) {
  let laatste;
  for (let i = 0; i < 3; i++) {
    try { return await fn(); } catch (e) { laatste = e; if (!rdNetFout(e)) throw e; await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
  }
  throw laatste;
}
async function rdItem(b, it) {
  const v = b.vast;
  if (it.file && !it.bron) {
    it.st = "opladen"; render();
    const buf = await it.file.arrayBuffer(); const sha = typeof vgSha256 === "function" ? await vgSha256(buf) : null;
    if (!sha) throw new Error("Opladen kan enkel via een beveiligde verbinding (https).");
    const m = await rdMaat(it.file);
    if (!m) throw new Error("Dit bestand is geen leesbaar beeld.");
    const ext = RD_TYPES[it.file.type]; const pad = `${v.pid}/ontwerp/${it.rid}.${ext}`;
    await rdPoging(async () => {
      const { error } = await sb.storage.from("renders").upload(pad, new Blob([buf], { type: it.file.type }), { contentType: it.file.type, upsert: false });
      if (error && !/exist|duplicate/i.test(error.message || "")) throw error;   // al opgeladen bij een vorige poging van ditzelfde beeld
    });
    it.bron = { pad, naam: it.file.name.slice(0, 200), mime: it.file.type, grootte: it.file.size, sha256: sha, breedte: m.w, hoogte: m.h };
  }
  it.st = "aanvragen"; render();
  const r = await rdPoging(async () => {
    const { data, error } = await sb.rpc("render_aanvragen", { p_project: v.pid, p_request_id: it.rid, p_ruimte: v.ruimte, p_instructie: v.instructie, p_bron: it.bron, p_sfeer_ids: v.sfeer, p_kwaliteit: v.kwaliteit, p_model: v.model, p_toestemming: true });
    if (error) throw error; return data;
  });
  if (r && r.opdracht) S.render_opdrachten[r.opdracht.id] = r.opdracht;
  if (r && r.bron) S.render_beelden[r.bron.id] = r.bron;
  it.st = "ok"; it.fout = ""; it.hergebruikt = !!(r && r.hergebruikt);
}
async function rdBatch() {
  const b = RD.batch; if (!b) return;
  b.bezig = true; render();
  for (const it of b.items) {
    if (it.st === "ok") continue;
    try { await rdItem(b, it); } catch (e) { it.st = "fout"; it.fout = (e && (e.message || e.error_description)) || String(e); }
    render();
  }
  b.bezig = false;
  const nOk = b.items.filter(i => i.st === "ok").length, nF = b.items.length - nOk;
  toast(nF ? `${nOk} van ${b.items.length} in de wachtrij — ${nF} niet gelukt (zie Renders).` : (nOk > 1 ? `${nOk} renders in de wachtrij.` : "Render in de wachtrij."), 6000);
  if (!nF) setTimeout(() => { if (RD.batch === b && !b.bezig) { RD.batch = null; render(); } }, 8000);
  render();
}
function rdBatchHtml() {
  const b = RD.batch; const nOk = b.items.filter(i => i.st === "ok").length;
  const lbl = { wacht: "wacht", opladen: "opladen…", aanvragen: "in de wachtrij zetten…", ok: "in de wachtrij", fout: "niet gelukt" };
  return `<div class="notice rd-batch"><div style="flex:1"><b>${b.bezig ? "Bezig met opladen" : nOk === b.items.length ? "Alles in de wachtrij" : "Niet alles is gelukt"}</b> — ${esc(b.vast.ruimte)} · ${nOk}/${b.items.length}
      <ul>${b.items.map(i => `<li><span class="${i.st === "ok" ? "ok" : i.st === "fout" ? "nok" : ""}">${i.st === "ok" ? "✓" : i.st === "fout" ? "✕" : "…"}</span> ${esc(i.naam)} <small class="muted">${esc(lbl[i.st] || "")}${i.hergebruikt ? " (al ontvangen)" : ""}</small>${i.fout ? `<div class="rd-fout">${esc(i.fout)}</div>` : ""}</li>`).join("")}</ul>
      ${b.bezig ? `<small class="muted">Laat deze pagina open tot alles opgeladen is.</small>` : ""}</div>
    <div class="actions">${!b.bezig && b.items.some(i => i.st === "fout") ? `<button class="btn sm primary" data-rd-act="batch-opnieuw" title="Dezelfde aanvragen opnieuw versturen — wat al ontvangen is, wordt niet dubbel gerenderd">Opnieuw proberen</button>` : ""}${b.bezig ? "" : `<button class="btn sm" data-rd-act="batch-sluit">Sluiten</button>`}</div></div>`;
}
window.addEventListener("beforeunload", (e) => { if (RD.batch && RD.batch.bezig) { e.preventDefault(); e.returnValue = ""; } });

/* ---------- vergelijken ---------- */
function rdVergelijk(o) {
  const bron = S.render_beelden[o.bron_id], res = S.render_beelden[o.resultaat_id]; if (!bron || !res) return;
  const sferen = (o.sfeer_ids || []).map(id => S.render_beelden[id]).filter(Boolean);
  openModal("Vergelijken — " + o.ruimte, `<div class="rd-vgl"><figure>${rdImg(bron)}<figcaption>Ontwerp${bron.soort === "render" ? " (eerdere render)" : ""}</figcaption></figure><figure>${rdImg(res)}<figcaption>Render · ${esc(fmtLong(lokDag(o.klaar_op || o.created_at)))}${res.breedte ? ` · ${res.breedte}×${res.hoogte}` : ""}</figcaption></figure></div>
    <p style="margin:10px 0 4px"><b>Opdracht:</b> ${esc(o.instructie)}</p>
    ${(o.afspraken || []).length ? `<p class="muted" style="margin:0 0 4px;font-size:12.5px">Afspraken: ${o.afspraken.map(a => esc(a.tekst)).join(" · ")}</p>` : ""}
    ${sferen.length ? `<div class="rd-sfeerkeuze klein">${sferen.map(s => rdImg(s)).join("")}</div>` : ""}
    <p class="muted" style="font-size:12px">Controleer architectuur, openingen en materialen tegen het ontwerp: de beeldgeneratie garandeert geen pixelvaste geometrie. Goedkeuren is een menselijke beoordeling.</p>`, {
    saveLabel: res.goedgekeurd_op ? "Goedkeuring intrekken" : "Goedkeuren", wide: true,
    onSave: async () => rdGoed(res.id, !res.goedgekeurd_op),
  });
}
async function rdGoed(id, aan) { const { data, error } = await sb.rpc("render_goedkeur", { p_beeld: id, p_goed: aan }); if (error) { toast(error.message, 6000); return false; } S.render_beelden[data.id] = data; render(); toast(aan ? "Goedgekeurd" : "Goedkeuring ingetrokken"); }
async function rdDownload(b, naam) {
  const { data, error } = await sb.storage.from("renders").createSignedUrl(b.pad, 600, { download: naam || true });
  if (error) { toast("Downloaden lukt niet: " + error.message, 6000); return; }
  const a = document.createElement("a"); a.href = data.signedUrl; a.rel = "noopener"; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 1000);
}

/* ---------- sfeerbibliotheek ---------- */
function rdSfeerPaneel(p) {
  const l = rdBeelden(p.id, "sfeer");
  return `<div class="panel"><div class="panel-head"><div><h3>Sfeerbibliotheek</h3><div class="muted" style="font-size:12px;margin-top:2px">Enkel voor licht en sfeer — nooit voor vormen of materialen.</div></div><div class="actions"><label class="btn sm">+ Sfeerbeelden<input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden data-rd-sfeer="${p.id}"></label></div></div>
    <div class="panel-body">${l.length ? `<div class="rd-sfeer">${l.map(s => `<div class="rd-sf">${rdImg(s)}<button class="btn ghost sm danger" data-rd-act="sfeer-weg" data-id="${s.id}" title="Verwijderen" aria-label="Sfeerbeeld verwijderen">✕</button></div>`).join("")}</div>` : `<span class="muted">Nog geen sfeerbeelden.</span>`}</div></div>`;
}
async function rdSfeerOpladen(pid, files) {
  let n = 0;
  for (const file of files) {
    if (!RD_TYPES[file.type] || file.size > RD_MAX) { toast(`${file.name}: enkel PNG, JPEG of WebP tot 48 MB.`, 5000); continue; }
    try {
      const buf = await file.arrayBuffer(); const sha = await vgSha256(buf); const m = await rdMaat(file);
      const pad = `${pid}/sfeer/${rdHex(16)}.${RD_TYPES[file.type]}`;
      await rdPoging(async () => { const { error } = await sb.storage.from("renders").upload(pad, new Blob([buf], { type: file.type }), { contentType: file.type, upsert: false }); if (error && !/exist|duplicate/i.test(error.message || "")) throw error; });
      const { data, error } = await sb.rpc("render_sfeer_bewaar", { p_project: pid, p_pad: pad, p_naam: file.name.slice(0, 200), p_mime: file.type, p_grootte: file.size, p_sha256: sha, p_breedte: m ? m.w : null, p_hoogte: m ? m.h : null });
      if (error) throw error;
      S.render_beelden[data.id] = data; n++;
    } catch (e) { toast(file.name + ": " + ((e && e.message) || e), 6000); }
  }
  if (n) toast(n === 1 ? "Sfeerbeeld toegevoegd" : n + " sfeerbeelden toegevoegd");
  render();
}

/* ---------- materiaalafspraken per ruimte ---------- */
function rdAfsprakenPaneel(p) {
  const l = rdAfspraken(p.id);
  return `<div class="panel"><div class="panel-head"><div><h3>Materiaalafspraken</h3><div class="muted" style="font-size:12px;margin-top:2px">Per ruimte (of * voor het hele project). Elke render krijgt de afspraken van zijn ruimte mee.</div></div><div class="actions"><button class="btn sm" data-rd-act="afspr-nieuw" data-pid="${p.id}">+ Afspraak</button></div></div>
    ${l.length ? `<div class="tw"><table class="t"><tbody>${l.map(a => `<tr class="click" data-rd-act="afspr-bewerk" data-id="${a.id}"><td style="width:30%"><b>${a.ruimte === "*" ? "Heel project" : esc(a.ruimte)}</b></td><td>${esc(a.tekst)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="panel-body"><span class="muted">Nog geen afspraken.</span></div>`}</div>`;
}
function rdAfsprForm(pid, a) {
  a = a || {};
  openModal(a.id ? "Afspraak bewerken" : "Nieuwe materiaalafspraak", `<div class="form-grid">
    <div class="field span2"><label for="ra_r">Ruimte (* = heel project)</label><input id="ra_r" name="ruimte" list="ra_rs" required maxlength="120" value="${esc(a.ruimte || "")}" placeholder="bv. Keuken"><datalist id="ra_rs"><option value="*">${rdRuimtes(pid).map(r => `<option value="${esc(r)}">`).join("")}</datalist></div>
    <div class="field span2"><label for="ra_t">Afspraak</label><textarea id="ra_t" name="tekst" rows="3" required maxlength="2000" placeholder="bv. Kasten: eiken fineer, natuurlijk geolied, verticale draad. Werkblad: travertin, gezoet.">${esc(a.tekst || "")}</textarea></div></div>`, {
    onSave: async (d) => {
      const row = { ruimte: String(d.ruimte || "").trim() || "*", tekst: String(d.tekst || "").trim() };
      if (!row.tekst) { toast("Vul de afspraak in."); return false; }
      if (a.id) await dbUpdate("render_afspraken", a.id, row); else await dbInsert("render_afspraken", { ...row, project_id: pid });
    },
    onDelete: a.id ? async () => { await dbDelete("render_afspraken", a.id); } : null,
  });
}

/* ---------- stalenborden per ruimte (script 056, v1.60) ---------- */
// Een stalenbord is een betaalde beeldgeneratie zoals een render (zelfde wachtrij, toestemming, daglimiet en aanvraagnummer).
// Enkel de materialen die Phil bevestigt; de ruimtenaam en legende komen in de presentatie via de opmaak, nooit in het beeld.
const RD_SB_MAX_REF = 6;
const rdSbVersies = (pid, ruimte) => rdBeelden(pid, "stalenbord").filter(b => rdSleutel(b.ruimte) === rdSleutel(ruimte)).sort((a, b) => (b.versie || 0) - (a.versie || 0) || (b.created_at || "").localeCompare(a.created_at || ""));
const rdSbGekozen = (pid, ruimte) => rdSbVersies(pid, ruimte).find(b => b.geselecteerd) || null;
const rdSbOpdrachten = (pid, ruimte) => rdOpdrachten(pid).filter(o => o.soort === "stalenbord" && rdSleutel(o.ruimte) === rdSleutel(ruimte));
const rdSbLabels = (mat) => (mat || []).map(m => String(m || "").trim()).filter(Boolean).map(m => (m.includes(":") ? m.split(":")[0].trim() || m : m).slice(0, 60));
// past een beeld bij de ruimte? ruimte van het beeld, of de ruimtenaam als woord in de bestandsnaam (enkel een voorstel)
function rdSbPast(b, ruimte) {
  const k = rdSleutel(ruimte); if (!k) return false;
  if (rdSleutel(b.ruimte) === k) return true;
  const naam = String(b.naam || "").toLowerCase().replace(/\.[a-z0-9]{2,4}$/, "");
  const w = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9à-ÿ])${w}([^a-z0-9à-ÿ]|$)`, "i").test(naam);
}
// mogelijk verouderd: de afspraken van de ruimte zijn gewijzigd, een referentiebeeld is weg, of er is een nieuwere goedgekeurde render
function rdSbVerouderd(b) {
  const o = b && S.render_opdrachten[b.opdracht_id]; if (!o) return [];
  const redenen = []; const k = rdSleutel(o.ruimte);
  const nu = rdAfspraken(o.project_id).filter(a => a.ruimte === "*" || rdSleutel(a.ruimte) === k).map(a => rdSleutel(a.ruimte) + "|" + String(a.tekst || "").trim()).sort();
  const toen = (o.afspraken || []).map(a => rdSleutel(a.ruimte) + "|" + String(a.tekst || "").trim()).sort();
  if (JSON.stringify(nu) !== JSON.stringify(toen)) redenen.push("de materiaalafspraken van deze ruimte zijn gewijzigd");
  const refs = o.referentie_ids || [];
  if (refs.some(id => !S.render_beelden[id])) redenen.push("een referentiebeeld werd verwijderd");
  if (rdBeelden(o.project_id, "render").some(r => rdSleutel(r.ruimte) === k && r.goedgekeurd_op && r.goedgekeurd_op > (o.created_at || "") && !refs.includes(r.id))) redenen.push("er is een nieuwere goedgekeurde render van deze ruimte");
  return redenen;
}
function rdSbSignaal() {
  if (typeof vgVerwerker !== "function") return "";
  const w = vgVerwerker(); const i = (w.r && w.r.info) || {};
  return w.bekend && i.renders !== undefined && !i.stalenborden ? `<div class="rd-fout" style="margin:0 0 8px">De verwerkingscomputer kent nog geen stalenborden: voer installeer.sh opnieuw uit op de Mac mini. Tot dan blijven stalenborden in de wachtrij (er wordt niets betaald).</div>` : "";
}
function rdStalenPaneel(p) {
  const ruimtes = rdRuimtes(p.id); const heeftBeelden = rdBeelden(p.id).some(b => b.soort === "render" || b.soort === "ontwerp");
  const rij = (r) => {
    const versies = rdSbVersies(p.id, r); const gekozen = versies.find(b => b.geselecteerd); const toon = gekozen || versies[0];
    const ops = rdSbOpdrachten(p.id, r); const laatste = ops[0]; const loopt = ops.find(o => o.status === "wachtrij" || o.status === "bezig");
    const oud = toon ? rdSbVerouderd(toon) : [];
    const [l, c] = laatste ? (RD_STATUS[laatste.status] || [laatste.status, ""]) : ["", ""];
    return `<div class="rd-sbrij">${toon ? `<button type="button" class="rd-sbimg" data-rd-act="sb-bekijk" data-id="${toon.id}" title="Bekijken">${rdImg(toon)}</button>` : `<div class="rd-img leeg rd-sbimg"></div>`}
      <div class="rd-info"><div><b>${esc(r)}</b> ${gekozen ? `<span class="pill done">v${gekozen.versie || "?"} in presentatie</span>` : toon ? `<span class="pill st-offerte">nog geen versie gekozen</span>` : ""}${toon && toon.goedgekeurd_op ? ` <span class="pill done">goedgekeurd</span>` : ""}${oud.length ? ` <span class="pill st-on_hold" title="${esc(oud.join("; "))}">mogelijk verouderd</span>` : ""}${laatste && laatste.status !== "klaar" ? ` <span class="pill ${c}">${esc(l)}</span>` : ""}</div>
        <small class="muted">${versies.length ? `${versies.length} versie${versies.length > 1 ? "s" : ""} · laatste ${esc(fmtLong(lokDag(versies[0].created_at)))}` : "Nog geen stalenbord"}${oud.length ? ` · ${esc(oud.join("; "))} — bijwerken is een bewuste keuze (betaald)` : ""}</small>
        ${laatste && ["mislukt", "onzeker"].includes(laatste.status) && laatste.fout ? `<div class="rd-fout">${esc(laatste.fout)}</div>` : ""}
        <div class="actions">${toon ? `<button class="btn sm" data-rd-act="sb-bekijk" data-id="${toon.id}">Bekijken</button>` : ""}
          ${loopt ? "" : `<button class="btn sm ${toon ? "" : "primary"}" data-rd-act="sb-nieuw" data-pid="${p.id}" data-r="${esc(r)}" ${heeftBeelden ? "" : "disabled"}>${toon ? "Bijwerken…" : "Stalenbord maken"}</button>`}
          ${laatste && ["mislukt", "onzeker", "geannuleerd"].includes(laatste.status) && !loopt ? `<button class="btn sm" data-rd-act="sb-opnieuw" data-id="${laatste.id}">Opnieuw…</button>` : ""}
          ${laatste && laatste.status === "wachtrij" && (isBeheer() || laatste.aangevraagd_door === S.me.id) ? `<button class="btn sm ghost danger" data-rd-act="annuleer" data-id="${laatste.id}">Annuleren</button>` : ""}</div></div></div>`;
  };
  return `<div class="panel" style="margin-top:16px"><div class="panel-head"><div><h3>Stalenborden per ruimte</h3><div class="muted" style="font-size:12px;margin-top:2px">Eén fotorealistisch stalenbord per ruimte met enkel de materialen van die ruimte. Ruimtenaam en legende komen via de presentatie-opmaak.</div></div>
      <div class="actions"><button class="btn sm" data-rd-act="sb-nieuw" data-pid="${p.id}" data-r="" ${heeftBeelden ? "" : "disabled"}>+ Andere ruimte</button></div></div>
    <div class="panel-body">${rdSbSignaal()}${ruimtes.length ? `<div class="rd-sblijst">${ruimtes.map(rij).join("")}</div>` : `<span class="muted">${heeftBeelden ? "Nog geen ruimtes — klik op + Andere ruimte." : "Laad eerst renders of ontwerpbeelden op."}</span>`}</div></div>`;
}

function rdSbForm(pid, preset) {
  preset = preset || {};
  const p = S.projecten[pid]; const cfg = rdCfg(); const nV = rdVandaag();
  const basis = preset.basis ? S.render_beelden[preset.basis] : null;
  const vorigeOp = basis ? S.render_opdrachten[basis.opdracht_id] : (preset.ruimte ? rdSbOpdrachten(pid, preset.ruimte).find(o => o.status === "klaar") : null);
  const kandidaten = rdBeelden(pid).filter(b => b.soort === "render" || b.soort === "ontwerp");
  const rid = rdHex(16);   // vast aanvraagnummer voor dit formulier: opnieuw bewaren na een netwerkfout = dezelfde aanvraag
  const st = { handRef: false, handMat: false, afspraakBewaard: false, gekoppeld: false };
  const voorstelRefs = (ruimte) => {
    const l = kandidaten.filter(b => rdSbPast(b, ruimte));
    return l.sort((a, b) => (b.goedgekeurd_op ? 1 : 0) - (a.goedgekeurd_op ? 1 : 0) || (a.soort === "render" ? 0 : 1) - (b.soort === "render" ? 0 : 1) || (a.created_at || "").localeCompare(b.created_at || "")).slice(0, RD_SB_MAX_REF).map(b => b.id);
  };
  const voorstelMat = (ruimte) => {
    const k = rdSleutel(ruimte); const l = [];
    // enkel toewijzingen "Materiaal: details" uit de afspraken (bv. "Kasten: eiken fineer"); kleur- of verbodsregels ("geen olijfgroen") zijn geen staal en gaan als afspraak mee
    rdAfspraken(pid).filter(a => k && (rdSleutel(a.ruimte) === k || a.ruimte === "*")).forEach(a => String(a.tekst || "").split(/\n|;|\.\s+(?=[A-ZÀ-Ý])/).map(x => x.trim().replace(/\.$/, ""))
      .filter(x => { const i = x.indexOf(":"); return i > 0 && i <= 40 && x.slice(i + 1).trim(); }).forEach(x => { if (!l.includes(x)) l.push(x); }));
    return l.slice(0, 12).join("\n");
  };
  const ruimte0 = preset.ruimte || (basis && basis.ruimte) || "";
  const refs0 = preset.referenties || (vorigeOp && vorigeOp.referentie_ids && vorigeOp.referentie_ids.filter(id => S.render_beelden[id])) || voorstelRefs(ruimte0);
  const mat0 = preset.materialen ? preset.materialen.join("\n") : vorigeOp && (vorigeOp.materialen || []).length ? vorigeOp.materialen.join("\n") : voorstelMat(ruimte0);
  const grid = (gekozen) => kandidaten.slice().sort((a, b) => (gekozen.includes(b.id) ? 1 : 0) - (gekozen.includes(a.id) ? 1 : 0) || (rdSbPast(b, ruimte0) ? 1 : 0) - (rdSbPast(a, ruimte0) ? 1 : 0) || (a.created_at || "").localeCompare(b.created_at || ""))
    .map(b => `<label class="rd-pk"><input type="checkbox" name="ref" value="${b.id}" ${gekozen.includes(b.id) ? "checked" : ""}>${rdImg(b)}<small>${esc(b.naam || "")}<br><span class="muted" data-rd-sbr="${b.id}">${esc(b.ruimte || "geen ruimte")}${b.soort === "ontwerp" ? " · ontwerp" : ""}${b.goedgekeurd_op ? " · ✓" : ""}</span></small></label>`).join("");
  openModal((basis ? "Stalenbord corrigeren — " : "Stalenbord maken — ") + projName(p), `<div class="form-grid">
    <div class="field"><label for="sb_r">Ruimte</label><input id="sb_r" name="ruimte" list="sb_rs" required maxlength="120" value="${esc(ruimte0)}" placeholder="bv. Freya"><datalist id="sb_rs">${rdRuimtes(pid).map(r => `<option value="${esc(r)}">`).join("")}</datalist><small class="muted">Controleer de naam: hij komt zo in de presentatie.</small></div>
    <div class="field"><label for="sb_kw">Kwaliteit</label><select id="sb_kw" name="kwaliteit">${opts(RD_KWALITEIT, preset.kwaliteit || (vorigeOp && vorigeOp.kwaliteit) || cfg.kwaliteit)}</select></div>
    ${basis ? `<div class="field span2"><label>Te corrigeren versie</label><div class="rd-bron">${rdImg(basis)}<small class="muted">Versie ${basis.versie || "?"} — enkel wat je hieronder vraagt, verandert. De vorige versie blijft bewaard.</small></div></div>` : ""}
    <div class="field span2"><label>Referentiebeelden van deze ruimte <small class="muted" style="font-weight:400">— max. ${RD_SB_MAX_REF}; meerdere zichten van dezelfde ruimte horen samen. Voorstel op basis van ruimte en bestandsnaam: pas aan waar nodig.</small></label>
      ${kandidaten.length ? `<div class="rd-pres" id="sb_refs">${grid(refs0)}</div>` : `<small class="muted">Nog geen renders of ontwerpen in dit project.</small>`}
      <label class="sw-row" style="margin-top:6px"><input type="checkbox" class="sw" name="koppel" value="1" checked><span>Aangevinkte beelden ook aan deze ruimte koppelen <small class="muted" style="display:block">Zo komen ze in de presentatie na het stalenbord van deze ruimte. Kosteloos. <b id="sb_kop"></b></small></span></label></div>
    <div class="field span2"><label for="sb_m">Materialen op het stalenbord <small class="muted" style="font-weight:400">— één per regel, enkel wat echt in deze ruimte voorkomt. "Naam: details" → enkel de naam komt in de legende.</small></label>
      <textarea id="sb_m" name="materialen" rows="5" required maxlength="2400" placeholder="Groen-wit gestreept behang: vlak bedrukt, verticale strepen&#10;Groene lak: kastfronten&#10;Eiken: natuurlijk geolied&#10;Textiel: groen linnen">${esc(mat0)}</textarea>
      <small class="muted">Geen merk, productcode, hout- of steensoort tenzij afgesproken. Deze lijst en de afspraken gaan altijd voor op kleuren uit de beelden.</small></div>
    <div class="field span2" id="sb_afspr">${rdAfsprakenInfo(pid, ruimte0)}</div>
    <div class="field span2"><label for="sb_a">${basis ? "Wat moet er anders?" : "Aandachtspunten / correcties"} <small class="muted" style="font-weight:400">${basis ? "" : "— optioneel"}</small></label>
      <textarea id="sb_a" name="punten" rows="2" maxlength="2000" ${basis ? "required" : ""} placeholder="bv. Alle kastfronten hetzelfde zachtgeel — er is geen olijfgroen. De strepen onderaan de wand zijn vlak behang, geen latten.">${esc(preset.punten || "")}</textarea>
      <label class="sw-row" style="margin-top:6px"><input type="checkbox" class="sw" name="als_afspraak" value="1"><span>Ook bewaren als materiaalafspraak van deze ruimte <small class="muted" style="display:block">Dan geldt de correctie ook voor latere renders en stalenborden van deze ruimte.</small></span></label></div>
    <div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" name="legende" value="1" ${preset.legende === false || (vorigeOp && vorigeOp.legende === false) ? "" : "checked"}><span>Materiaallegende onder het stalenbord in de presentatie</span></label></div>
    <div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" name="ok" value="1"><span><b>Ik start betaalde beeldgeneratie</b><small class="muted" style="display:block">Model ${esc(cfg.model)} · één betaalde aanvraag bij OpenAI · telt mee in de daglimiet: vandaag al ${nV} van max. ${cfg.daglimiet}. Een mislukte of onzekere aanvraag wordt nooit automatisch opnieuw betaald.</small></span></label></div>
  </div>`, {
    saveLabel: basis ? "Corrigeren" : "Stalenbord maken", wide: true,
    onSave: async (d) => {
      const f = $("#mform");
      const ruimte = String(d.ruimte || "").replace(/\s+/g, " ").trim(); const punten = String(d.punten || "").trim();
      const refs = [...f.querySelectorAll('input[name="ref"]:checked')].map(i => i.value);
      const materialen = String(d.materialen || "").split("\n").map(x => x.trim()).filter(Boolean);
      if (!ruimte || ruimte === "*") { toast("Vul de ruimte in."); return false; }
      if (!refs.length) { toast("Kies minstens één referentiebeeld van deze ruimte."); return false; }
      if (refs.length > RD_SB_MAX_REF) { toast(`Kies maximaal ${RD_SB_MAX_REF} referentiebeelden.`); return false; }
      if (!materialen.length) { toast("Vul minstens één materiaal in (één per regel)."); return false; }
      if (materialen.length > 12) { toast("Maximaal 12 materialen per stalenbord."); return false; }
      if (basis && !punten) { toast("Beschrijf wat er aan het stalenbord moet veranderen."); return false; }
      if (!d.ok) { toast("Bevestig eerst de betaalde beeldgeneratie."); return false; }
      if (rdVandaag() + 1 > cfg.daglimiet) { toast(`Daglimiet bereikt (${cfg.daglimiet} beelden vandaag). Een beheerder kan dat verhogen in Instellingen › Renders.`, 7000); return false; }
      // 1. kosteloos vooraf: beelden aan de ruimte koppelen, correctie als afspraak bewaren (één keer, ook als je opnieuw bewaart)
      if (d.koppel && !st.gekoppeld) {
        for (const id of refs) { const b = S.render_beelden[id]; if (!b || rdSleutel(b.ruimte) === rdSleutel(ruimte)) continue;
          const { data, error } = await sb.rpc("render_beeld_ruimte", { p_beeld: id, p_ruimte: ruimte }); if (error) { toast("Koppelen mislukt: " + error.message, 6000); return false; } S.render_beelden[data.id] = data; }
        st.gekoppeld = true;
      }
      if (d.als_afspraak && punten && !st.afspraakBewaard) { await dbInsert("render_afspraken", { project_id: pid, ruimte, tekst: punten.slice(0, 2000) }); st.afspraakBewaard = true; }
      // 2. de betaalde aanvraag (idempotent op het aanvraagnummer)
      let r;
      try {
        r = await rdPoging(async () => {
          const { data, error } = await sb.rpc("render_stalenbord_aanvragen", { p_project: pid, p_request_id: rid, p_ruimte: ruimte, p_referenties: refs, p_materialen: materialen, p_aandachtspunten: punten,
            p_basis: basis ? basis.id : null, p_legende: !!d.legende, p_kwaliteit: d.kwaliteit || cfg.kwaliteit, p_model: cfg.model, p_toestemming: true });
          if (error) throw error; return data;
        });
      } catch (e) { toast((e && e.message) || String(e), 8000); return false; }
      if (r && r.opdracht) S.render_opdrachten[r.opdracht.id] = r.opdracht;
      toast(r && r.hergebruikt ? "Deze aanvraag was al ontvangen — niet dubbel aangerekend." : `Stalenbord ${ruimte} in de wachtrij.`, 6000); render();
    },
  });
  const ri = $("#sb_r"), mi = $("#sb_m"), box = $("#mform");
  if (mi) mi.addEventListener("input", () => { st.handMat = true; });
  if (ri) ri.addEventListener("input", () => {
    const v = $("#sb_afspr"); if (v) v.innerHTML = rdAfsprakenInfo(pid, ri.value);
    if (!st.handRef && !basis) { const voorstel = voorstelRefs(ri.value); box.querySelectorAll('input[name="ref"]').forEach(i => { i.checked = voorstel.includes(i.value); }); }
    if (!st.handMat && !basis && mi && !(vorigeOp && (vorigeOp.materialen || []).length)) mi.value = voorstelMat(ri.value);
  });
  const kop = () => { const el = $("#sb_kop"); if (!el || !box) return; const r = String((ri && ri.value) || "").trim();
    const anders = [...box.querySelectorAll('input[name="ref"]:checked')].map(i => S.render_beelden[i.value]).filter(b => b && rdSleutel(b.ruimte) !== rdSleutel(r));
    el.textContent = !anders.length ? "Alle aangevinkte beelden horen al bij deze ruimte." : `${anders.length} beeld${anders.length > 1 ? "en verhuizen" : " verhuist"} naar ${r || "deze ruimte"}: ${anders.map(b => `${b.naam || "beeld"} (nu ${b.ruimte || "geen ruimte"})`).join(", ")}.`; };
  kop(); if (box) { box.addEventListener("change", kop); box.addEventListener("input", kop); }
  if (box) box.addEventListener("change", (e) => { if (e.target.name === "ref") { st.handRef = true; if (box.querySelectorAll('input[name="ref"]:checked').length > RD_SB_MAX_REF) { e.target.checked = false; toast(`Maximaal ${RD_SB_MAX_REF} referentiebeelden.`); } } });
}

function rdSbBekijk(id) {
  const b = S.render_beelden[id]; if (!b) return;
  const o = S.render_opdrachten[b.opdracht_id] || {}; const versies = rdSbVersies(b.project_id, b.ruimte); const oud = rdSbVerouderd(b);
  const refs = (o.referentie_ids || []).map(x => S.render_beelden[x]);
  const knop = (act, label, extra) => `<button type="button" class="btn sm ${extra || ""}" data-rd-act="${act}" data-id="${b.id}">${label}</button>`;
  openModal(`Stalenbord — ${b.ruimte} · versie ${b.versie || "?"}`, `<div class="rd-sbgroot">${rdImg(b)}</div>
    <div class="actions" style="margin:8px 0">${knop("sb-kies", b.geselecteerd ? "✓ Gekozen voor de presentatie — intrekken" : "Gebruiken in de presentatie", b.geselecteerd ? "" : "primary")}${knop("sb-goed", b.goedgekeurd_op ? "Goedkeuring intrekken" : "Goedkeuren")}${knop("sb-download", "Downloaden")}${b.drive && b.drive.url ? `<a class="btn sm" href="${esc(safeUrl(b.drive.url))}" target="_blank" rel="noopener">Drive ↗</a>` : ""}${knop("sb-corrigeer", "Corrigeren…")}${knop("sb-bijwerken", "Bijwerken…")}</div>
    ${oud.length ? `<div class="notice" style="margin:0 0 8px"><b>Mogelijk verouderd:</b> ${esc(oud.join("; "))}. Bijwerken start een nieuwe, betaalde versie — enkel als jij daarvoor kiest.</div>` : ""}
    <p class="muted" style="font-size:12.5px;margin:0 0 6px">${esc(fmtLong(lokDag(b.created_at)))} ${esc(lokUur(b.created_at))} · ${esc(o.model || "")} · ${esc((RD_KWALITEIT.find(k => k[0] === o.kwaliteit) || [0, o.kwaliteit || ""])[1])}${b.breedte ? ` · ${b.breedte}×${b.hoogte}` : ""}${b.goedgekeurd_op ? ` · goedgekeurd door ${esc(userById(b.goedgekeurd_door).name || "")}` : ""}${o.basis_id ? ` · correctie van versie ${esc(String((S.render_beelden[o.basis_id] || {}).versie || "?"))}` : ""}</p>
    <p style="margin:0 0 4px"><b>Materialen:</b> ${(o.materialen || []).map(esc).join(" · ") || "—"}</p>
    ${o.legende === false ? `<p class="muted" style="margin:0 0 4px;font-size:12px">Zonder legende in de presentatie.</p>` : `<p class="muted" style="margin:0 0 4px;font-size:12px">Legende in de presentatie: ${rdSbLabels(o.materialen).map(esc).join(" · ")}</p>`}
    ${o.instructie ? `<p style="margin:0 0 4px"><b>Aandachtspunten:</b> ${esc(o.instructie)}</p>` : ""}
    ${(o.afspraken || []).length ? `<p class="muted" style="margin:0 0 4px;font-size:12.5px">Afspraken toen: ${o.afspraken.map(a => esc(a.tekst)).join(" · ")}</p>` : ""}
    <div class="rd-sfeerkeuze klein" title="Referentiebeelden">${refs.map(r => r ? rdImg(r) : `<div class="rd-img leeg" title="verwijderd"></div>`).join("")}</div>
    ${versies.length > 1 ? `<p style="margin:10px 0 4px"><b>Versies</b> <small class="muted">— eerdere versies blijven bewaard</small></p><div class="rd-sfeerkeuze klein">${versies.map(v => `<button type="button" class="rd-sbv${v.id === b.id ? " on" : ""}" data-rd-act="sb-bekijk" data-id="${v.id}" title="Versie ${v.versie || "?"}${v.geselecteerd ? " (gekozen)" : ""}">${rdImg(v)}<span>v${v.versie || "?"}${v.geselecteerd ? " ✓" : ""}</span></button>`).join("")}</div>` : ""}
    <p class="muted" style="font-size:12px;margin-top:8px">Controleer of enkel de materialen van deze ruimte erop staan, met de afgesproken kleuren. De ruimtenaam en legende komen via de presentatie, niet in het beeld.</p>`, {
    saveLabel: "Sluiten", wide: true, onSave: async () => { },
  });
}
async function rdSbKies(id, aan) { const { data, error } = await sb.rpc("render_stalenbord_kies", { p_beeld: id, p_aan: aan }); if (error) { toast(error.message, 6000); return; }
  rdBeelden(data.project_id, "stalenbord").forEach(x => { if (aan && x.id !== data.id && rdSleutel(x.ruimte) === rdSleutel(data.ruimte)) x.geselecteerd = false; }); S.render_beelden[data.id] = data;
  toast(aan ? `Versie ${data.versie || ""} gaat in de presentatie.` : "Niet meer gekozen voor de presentatie."); render(); }
function rdRuimteForm(b) {
  openModal("Ruimte van deze render", `<div class="form-grid"><div class="field span2"><label for="rr_r">Ruimte</label><input id="rr_r" name="ruimte" list="rr_rs" required maxlength="120" value="${esc(b.ruimte || "")}"><datalist id="rr_rs">${rdRuimtes(b.project_id).map(r => `<option value="${esc(r)}">`).join("")}</datalist>
    <small class="muted">Kosteloos. Stalenborden en de presentatie volgen de ruimte; de afspraken die bij het renderen golden, blijven bewaard.</small></div></div>`, {
    onSave: async (d) => { const r = String(d.ruimte || "").trim(); if (!r || r === "*") { toast("Vul de ruimte in."); return false; }
      const { data, error } = await sb.rpc("render_beeld_ruimte", { p_beeld: b.id, p_ruimte: r }); if (error) { toast(error.message, 6000); return false; }
      S.render_beelden[data.id] = data; Object.values(S.render_opdrachten).forEach(o => { if (o.resultaat_id === data.id && rdIsRender(o)) o.ruimte = data.ruimte; }); render(); },
  });
}

/* ---------- A3-presentatie ---------- */
function rdPresentatiesPaneel(p) {
  const l = rdPresentaties(p.id); if (!l.length) return "";
  const st = { wachtrij: ["In wachtrij", "st-lopend"], bezig: ["Wordt opgemaakt", "st-lopend"], klaar: ["Klaar", "st-afgerond"], mislukt: ["Mislukt", "late"] };
  return `<div class="panel" style="margin-top:16px"><div class="panel-head"><h3>A3-presentaties</h3></div><div class="tw"><table class="t"><tbody>${l.map(r => { const [lb, c] = st[r.status] || [r.status, ""]; return `<tr><td><b>${esc(r.klant)}</b> <small class="muted">· Ontwerp ${esc(r.versie)} · ${esc(fmtLong(r.datum))} · ${r.liggend ? "liggend" : "staand"} · ${(r.render_ids || []).length} beelden${r.stalenborden ? ` + ${(r.stalenbord_ids || []).length} stalenbord${(r.stalenbord_ids || []).length === 1 ? "" : "en"}` : ""}${r.paginas ? ` · ${r.paginas} p.` : ""}</small>${r.fout ? `<div class="${r.status === "mislukt" ? "rd-fout" : "muted"}" style="font-size:12px">${esc(r.fout)}</div>` : ""}</td>
    <td><span class="pill ${c}">${esc(lb)}</span></td><td class="r"><div class="actions" style="justify-content:flex-end">${r.status === "klaar" && r.pad ? `<button class="btn sm" data-rd-act="pres-dl" data-id="${r.id}">Pdf</button>` : ""}${r.drive && r.drive.url ? `<a class="btn sm" href="${esc(safeUrl(r.drive.url))}" target="_blank" rel="noopener">Drive ↗</a>` : ""}${r.status === "mislukt" ? `<button class="btn sm" data-rd-act="pres-opnieuw" data-id="${r.id}">Opnieuw</button>` : ""}${r.status !== "bezig" ? `<button class="btn ghost sm danger" data-rd-act="pres-weg" data-id="${r.id}" aria-label="Verwijderen">✕</button>` : ""}</div></td></tr>`; }).join("")}</tbody></table></div></div>`;
}
function rdPresForm(pid) {
  const p = S.projecten[pid];
  const l = rdBeelden(pid).filter(b => b.soort === "render" || b.soort === "ontwerp").sort((a, b) => (b.goedgekeurd_op ? 1 : 0) - (a.goedgekeurd_op ? 1 : 0) || (a.soort === "render" ? 0 : 1) - (b.soort === "render" ? 0 : 1) || (a.created_at || "").localeCompare(b.created_at || ""));
  const vorige = rdPresentaties(pid)[0];
  RD.pres = { pid, volgorde: l.filter(b => b.goedgekeurd_op).map(b => b.id) };
  if (!RD.pres.volgorde.length) RD.pres.volgorde = l.filter(b => b.soort === "render").slice(-6).map(b => b.id);
  openModal("A3-presentatie — " + projName(p), `<div class="form-grid">
    <div class="field"><label for="rp_k">Klant</label><input id="rp_k" name="klant" required maxlength="100" value="${esc((vorige && vorige.klant) || p.klant || "")}"></div>
    <div class="field"><label for="rp_v">Ontwerpversie</label><input id="rp_v" name="versie" required maxlength="40" value="${esc(vorige ? vorige.versie : "V1 - Voorontwerp")}" placeholder="bv. V2 - Voorontwerp"></div>
    <div class="field"><label for="rp_d">Datum</label><input id="rp_d" type="date" name="datum" required value="${esc(todayIso)}"></div>
    <div class="field"><label for="rp_o">Formaat</label><select id="rp_o" name="liggend">${opts([["0", "A3 staand (huisstijl)"], ["1", "A3 liggend"]], vorige && vorige.liggend ? "1" : "0")}</select></div>
    <div class="field span2"><label>Beelden <small class="muted" style="font-weight:400">— aanvinken in de volgorde waarin ze in de presentatie komen; de eerste drie vormen de cover</small></label>
      <div class="rd-pres">${l.map(b => `<label class="rd-pk"><input type="checkbox" data-rd-pk="${b.id}" ${RD.pres.volgorde.includes(b.id) ? "checked" : ""}>${rdImg(b)}<span class="rd-nr" data-rd-nr="${b.id}">${RD.pres.volgorde.indexOf(b.id) + 1 || ""}</span><small>${esc(b.ruimte || "")}${b.soort === "ontwerp" ? " · ontwerp" : ""}${b.goedgekeurd_op ? " · ✓" : ""}</small></label>`).join("")}</div></div>
    ${rdSbOk() ? `<div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" name="stalen" value="1" ${vorige && vorige.stalenborden ? "checked" : ""}><span><b>Stalenborden per ruimte opnemen</b><small class="muted" style="display:block">Per ruimte eerst het gekozen stalenbord, dan de gekozen beelden van die ruimte. De cover blijft hetzelfde. Er wordt niets gegenereerd.</small><small id="rp_sb" style="display:block;margin-top:4px">${rdPresStalen(pid)}</small></span></label></div>` : ""}
    <p class="muted span2" style="font-size:12px;margin:0">Geen betaalde generatie: de verwerkingscomputer zet de gekozen beelden in de BROS-huisstijl (beige papier, logo, cover met drie stroken, klantnaam, ontwerpversie en datum). De pdf komt hier en in de projectmap › Renders/Presentaties.</p></div>`, {
    saveLabel: "Presentatie maken", wide: true,
    onSave: async (d) => {
      const ids = RD.pres.volgorde.filter(id => S.render_beelden[id]);
      if (!ids.length) { toast("Kies minstens één beeld."); return false; }
      const args = { p_project: pid, p_klant: String(d.klant || "").trim(), p_versie: String(d.versie || "").trim(), p_datum: d.datum, p_liggend: d.liggend === "1", p_render_ids: ids };
      if (rdSbOk()) args.p_stalenborden = !!d.stalen;   // script 056; zonder vinkje exact zoals vroeger
      const { data, error } = await sb.rpc("render_presentatie_maak", args);
      if (error) { toast(error.message, 7000); return false; }
      S.render_presentaties[data.id] = data; toast("Presentatie in de wachtrij — de pdf verschijnt onderaan zodra ze klaar is.", 6000); render();
    },
  });
}
// welke stalenborden komen mee (per ruimte van de aangevinkte beelden, in volgorde van eerste voorkomen)
function rdPresStalen(pid) {
  const gezien = new Map(); (RD.pres ? RD.pres.volgorde : []).forEach(id => { const b = S.render_beelden[id]; if (b && String(b.ruimte || "").trim() && !gezien.has(rdSleutel(b.ruimte))) gezien.set(rdSleutel(b.ruimte), b.ruimte.trim()); });
  if (!gezien.size) return `<span class="muted">Vink eerst beelden aan.</span>`;
  return [...gezien.values()].map(r => { const g = rdSbGekozen(pid, r); return g ? `<span class="pill done">${esc(r)} · v${g.versie || "?"}</span>` : `<span class="pill st-offerte" title="Geen gekozen stalenbord: enkel de renders van deze ruimte">${esc(r)} · geen stalenbord</span>`; }).join(" ");
}
function rdPresNummers() { document.querySelectorAll("[data-rd-nr]").forEach(el => { const i = RD.pres.volgorde.indexOf(el.dataset.rdNr); el.textContent = i >= 0 ? String(i + 1) : ""; }); const sbv = $("#rp_sb"); if (sbv && RD.pres) sbv.innerHTML = rdPresStalen(RD.pres.pid); }

/* ---------- Instellingen › Renders (beheer) ---------- */
function vRenderInstellingen() {
  if (!isBeheer()) return "";
  if (schemaV() < 55) return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h3>Renders</h3><span class="pill st-offerte">nog niet geactiveerd</span></div><div class="panel-body">${typeof SCHEMA_HINT === "function" ? SCHEMA_HINT(55) : "Voer sql/055_renders.sql uit."}</div></div>`;
  const c = rdCfg(); const w = typeof vgVerwerker === "function" ? vgVerwerker() : { bekend: false }; const i = (w.r && w.r.info) || {};
  const alle = Object.values(S.render_opdrachten || {}); const maand = new Date().toISOString().slice(0, 7);
  const dezeMaand = alle.filter(o => (o.dag || "").startsWith(maand));
  const tel = (st) => dezeMaand.filter(o => o.status === st).length;
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Renders</h3><div class="muted" style="font-size:12px;margin-top:2px">${rdSignaal()}</div></div></div>
    <div class="panel-body"><div class="meta">
      <div><div class="k">OpenAI-sleutel</div><div class="v">${!w.bekend ? "—" : i.renders ? "op de Mac mini (sleutelhanger)" : `<span class="pill late">ontbreekt</span>`}</div></div>
      <div><div class="k">A3-presentaties</div><div class="v">${!w.bekend ? "—" : i.presentaties ? "klaar" : `<span class="pill late">niet geïnstalleerd</span>`}</div></div>
      <div><div class="k">Deze maand</div><div class="v num">${dezeMaand.length} renders<small class="muted" style="display:block">${tel("klaar")} klaar · ${tel("mislukt")} mislukt · ${tel("onzeker")} controle nodig</small></div></div>
    </div>
    <div class="form-grid" style="margin-top:14px">
      <div class="field"><label for="ri_m">Beeldmodel</label><input id="ri_m" list="ri_ms" value="${esc(c.model)}" maxlength="80"><datalist id="ri_ms">${["gpt-image-2", "gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-1.5"].map(m => `<option value="${m}">`).join("")}</datalist><small class="muted">Wijzig enkel na één proefrender: een ander model kan andere kosten en een ander resultaat geven. Lopende aanvragen met het oude model worden geweigerd (opnieuw bevestigen).</small></div>
      <div class="field"><label for="ri_k">Standaardkwaliteit</label><select id="ri_k">${opts(RD_KWALITEIT, c.kwaliteit)}</select></div>
      <div class="field"><label for="ri_l">Formaat (lange zijde)</label><select id="ri_l">${opts([["1536", "1536 px (snel)"], ["2048", "2048 px (standaard)"], ["2560", "2560 px (afdruk A3)"]], String(c.lange_zijde))}</select><small class="muted">Enkel voor modellen met eigen formaat (gpt-image-2 en 2.5); de verhouding volgt het ontwerp.</small></div>
      <div class="field"><label for="ri_d">Daglimiet (hele team)</label><input id="ri_d" type="number" min="0" max="500" value="${c.daglimiet}"><small class="muted">Inclusief mislukte en onzekere renders.</small></div>
      <div class="field span2"><div class="actions"><button class="btn primary" data-rd-act="inst-bewaar">Bewaren</button></div></div>
    </div></div></div>`;
}
async function rdInstBewaar() {
  const model = ($("#ri_m").value || "").trim(); const d = Number($("#ri_d").value);
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/i.test(model)) { toast("Ongeldige modelnaam."); return; }
  if (!Number.isInteger(d) || d < 0 || d > 500) { toast("Daglimiet tussen 0 en 500."); return; }
  const value = { model, kwaliteit: $("#ri_k").value, lange_zijde: Number($("#ri_l").value), daglimiet: d };
  const oud = rdCfg();
  if (model !== oud.model && !confirm(`Beeldmodel wijzigen van ${oud.model} naar ${model}? Doe eerst één proefrender: kosten en resultaat kunnen verschillen.`)) return;
  const { data, error } = await sb.from("instellingen").upsert({ key: "render", value, updated_at: new Date().toISOString() }).select().single();
  if (error) { toast("Bewaren mislukt: " + error.message, 6000); return; }
  S.instellingen.render = data; toast("Bewaard"); render();
}

/* ---------- gebeurtenissen ---------- */
document.addEventListener("click", async (e) => {
  const el = e.target.closest && e.target.closest("[data-rd-act]"); if (!el) return;
  const a = el.dataset.rdAct, id = el.dataset.id;
  if (a === "nieuw") return rdForm(el.dataset.pid);
  if (a === "filter") { RD.filter = el.dataset.r || ""; render(); return; }
  if (a === "batch-opnieuw") { if (RD.batch && !RD.batch.bezig) rdBatch(); return; }
  if (a === "batch-sluit") { RD.batch = null; render(); return; }
  if (a === "vergelijk") { const o = S.render_opdrachten[id]; if (o) rdVergelijk(o); return; }
  if (a === "goed") return rdGoed(id, el.dataset.v === "1");
  if (a === "download") { const b = S.render_beelden[id]; const o = b && S.render_opdrachten[b.opdracht_id]; const p = b && S.projecten[b.project_id];
    if (b) rdDownload(b, `${(p && p.klant) || "render"} - ${(o && o.ruimte) || b.ruimte || ""} - ${(b.created_at || "").slice(0, 10)}.${(b.pad.split(".").pop() || "png")}`.replace(/[\\/:*?"<>|]+/g, " ")); return; }
  if (a === "corrigeer") { const b = S.render_beelden[id]; if (b) rdForm(b.project_id, { bron: b.id, ruimte: b.ruimte }); return; }
  if (a === "opnieuw") { const o = S.render_opdrachten[id]; if (!o) return;
    if (o.status === "onzeker" && !confirm("Deze render vertrok misschien al naar OpenAI (en is dan misschien al aangerekend). Kijk bij twijfel eerst het verbruik na. Toch een nieuwe render starten?")) return;
    return rdForm(o.project_id, { bron: o.bron_id, ruimte: o.ruimte, instructie: o.instructie, sfeer: o.sfeer_ids, kwaliteit: o.kwaliteit }); }
  if (a === "annuleer") { if (!confirm("Deze render annuleren? Er wordt niets aangerekend.")) return; const { data, error } = await sb.rpc("render_annuleer", { p_id: id }); if (error) { toast(error.message, 6000); return; } S.render_opdrachten[data.id] = data; render(); return; }
  if (a === "sfeer-weg") { const b = S.render_beelden[id]; if (!b || !confirm("Dit sfeerbeeld verwijderen? (Renders die het al gebruikten, blijven bestaan.)")) return;
    try { await dbDelete("render_beelden", id); await sb.storage.from("renders").remove([b.pad]); } catch (x) { } return; }
  if (a === "afspr-nieuw") return rdAfsprForm(el.dataset.pid);
  if (a === "afspr-bewerk") { const r = S.render_afspraken[id]; if (r) rdAfsprForm(r.project_id, r); return; }
  if (a === "pres-nieuw") return rdPresForm(el.dataset.pid);
  if (a === "pres-dl") { const r = S.render_presentaties[id]; if (r && r.pad) rdDownload({ pad: r.pad }, ((r.drive && r.drive.naam) || `Presentatie ${r.klant} ${r.versie}.pdf`).replace(/[\\/:*?"<>|]+/g, " ")); return; }
  if (a === "pres-opnieuw") { const { data, error } = await sb.rpc("render_presentatie_opnieuw", { p_id: id }); if (error) { toast(error.message, 6000); return; } S.render_presentaties[data.id] = data; render(); return; }
  if (a === "pres-weg") { if (!confirm("Deze presentatie uit de lijst verwijderen? (De pdf op Drive blijft staan.)")) return; const r = S.render_presentaties[id]; try { await dbDelete("render_presentaties", id); } catch (x) { } return; }
  if (a === "inst-bewaar") return rdInstBewaar();
  // stalenborden (1.60)
  if (a === "sb-nieuw") { if (MODAL_OPEN()) closeModal(true); return rdSbForm(el.dataset.pid, { ruimte: el.dataset.r || "" }); }
  if (a === "sb-bekijk") return rdSbBekijk(id);
  if (a === "sb-kies") { const b = S.render_beelden[id]; if (!b) return; await rdSbKies(id, !b.geselecteerd); return rdSbBekijk(id); }
  if (a === "sb-goed") { await rdGoed(id, !(S.render_beelden[id] || {}).goedgekeurd_op); return rdSbBekijk(id); }
  if (a === "sb-download") { const b = S.render_beelden[id]; const p = b && S.projecten[b.project_id];
    if (b) rdDownload(b, `${(p && p.klant) || "project"} - Stalenbord ${b.ruimte} v${b.versie || ""}.${(b.pad.split(".").pop() || "png")}`.replace(/[\\/:*?"<>|]+/g, " ")); return; }
  if (a === "sb-corrigeer") { const b = S.render_beelden[id]; if (!b) return; closeModal(true); return rdSbForm(b.project_id, { basis: b.id, ruimte: b.ruimte }); }
  if (a === "sb-bijwerken") { const b = S.render_beelden[id]; if (!b) return; closeModal(true); return rdSbForm(b.project_id, { ruimte: b.ruimte }); }
  if (a === "sb-opnieuw") { const o = S.render_opdrachten[id]; if (!o) return;
    if (o.status === "onzeker" && !confirm("Dit stalenbord vertrok misschien al naar OpenAI (en is dan misschien al aangerekend). Kijk bij twijfel eerst het verbruik na. Toch een nieuw stalenbord starten?")) return;
    return rdSbForm(o.project_id, { ruimte: o.ruimte, referenties: (o.referentie_ids || []).filter(x => S.render_beelden[x]), materialen: o.materialen, punten: o.instructie || "", basis: o.basis_id && S.render_beelden[o.basis_id] ? o.basis_id : null, kwaliteit: o.kwaliteit, legende: o.legende }); }
  if (a === "ruimte") { const b = S.render_beelden[id]; if (b) rdRuimteForm(b); return; }
});
document.addEventListener("change", (e) => {
  const el = e.target; if (!el || !el.dataset) return;
  if (el.dataset.rdSfeer) { const files = [...(el.files || [])]; el.value = ""; if (files.length) rdSfeerOpladen(el.dataset.rdSfeer, files); return; }
  if (el.dataset.rdPk && RD.pres) { const id = el.dataset.rdPk; RD.pres.volgorde = RD.pres.volgorde.filter(x => x !== id); if (el.checked) RD.pres.volgorde.push(id); rdPresNummers(); }
});
