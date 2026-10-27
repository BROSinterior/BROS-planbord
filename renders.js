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
  return { model: v.model || "gpt-image-2", kwaliteit: ["low", "medium", "high"].includes(v.kwaliteit) ? v.kwaliteit : "medium", lange_zijde: [1536, 2048, 2560].includes(Number(v.lange_zijde)) ? Number(v.lange_zijde) : 2048, daglimiet: Number.isFinite(Number(v.daglimiet)) ? Number(v.daglimiet) : 20, controle: v.controle !== false }; };
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
  if (rdStdOk()) return vRendersStd(p);   // 1.61: per ruimte en standpunt (script 057)
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
  return `<div class="rd-kaart${goed ? " goed" : ""}"><div class="rd-duo">${rdImg(bron, "bron")}${res ? `<button type="button" class="rd-res" data-rd-act="groot" data-id="${o.id}" title="Vergelijken op volledig scherm, met zoom">${rdImg(res)}</button>` : `<div class="rd-img rd-wacht"><span>${esc(l)}${o.status === "bezig" && o.stap ? `<small>${esc(o.stap)}</small>` : ""}</span></div>`}</div>
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
  if (v.std) {   // 1.61: per standpunt, met rollen (script 057)
    const r = await rdPoging(async () => {
      const { data, error } = await sb.rpc("render_standpunt_aanvragen", { p_project: v.pid, p_request_id: it.rid, p_modus: v.modus, p_ruimte: v.ruimte, p_standpunt: v.standpunt || null, p_standpunt_naam: it.standpunt || "",
        p_bron: it.bron, p_instructie: v.instructie, p_sfeer_ids: v.sfeer, p_kwaliteit: v.kwaliteit, p_model: v.model, p_toestemming: true, p_correctie_bewaren: v.bewaar !== false });
      if (error) throw error; return data;
    });
    if (r && r.opdracht) S.render_opdrachten[r.opdracht.id] = r.opdracht;
    if (r && r.bron) S.render_beelden[r.bron.id] = r.bron;
    if (r && r.standpunt) S.render_standpunten[r.standpunt.id] = r.standpunt;
    it.st = "ok"; it.fout = ""; it.hergebruikt = !!(r && r.hergebruikt);
    if (typeof refetch === "function" && S.render_ruimtes && r && r.standpunt && !S.render_ruimtes[r.standpunt.ruimte_id]) { try { await refetch("render_ruimtes"); } catch (e) { } }
    return;
  }
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

/* ---------- volledig scherm vergelijken met zoom (1.60.1) ----------
   Naast elkaar (zoom en verschuiven lopen gelijk), schuifregelaar (ontwerp onder, render boven) of één beeld (spatie wisselt).
   Zoomen: scrollwiel/trackpad naar de cursor, knijpen op gsm/tablet, dubbelklik, + / − / 0 (passend) / 1 (100 %). Esc sluit. */
const RDV = { open: false, s: 1, x: 0, y: 0, modus: "naast", split: 0.5, beelden: [], wijzers: new Map(), knijp: null };
async function rdvUrl(b) {
  const c = RD.urls[b.pad]; if (c && !c.fout && c.tot > Date.now() + 60000) return c.url;
  try { const { data } = await sb.storage.from("renders").createSignedUrl(b.pad, 3600); if (data && data.signedUrl) { RD.urls[b.pad] = { url: data.signedUrl, tot: Date.now() + 3600 * 1000 }; return data.signedUrl; } } catch (e) { }
  return "";
}
// beelden: [{ b, label }], opt: { titel, opdracht (voor goedkeuren), modus }
async function rdViewer(beelden, opt) {
  opt = opt || {}; beelden = beelden.filter(x => x && x.b); if (!beelden.length) return;
  let modus = opt.modus; try { modus = modus || localStorage.getItem("rdv-modus") || ""; } catch (e) { }
  if (beelden.length < 2) modus = "een0"; else if (!["naast", "schuif", "een0", "een1"].includes(modus)) modus = "naast";
  Object.assign(RDV, { open: true, s: 1, x: 0, y: 0, modus, split: 0.5, beelden, opt, wijzers: new Map(), knijp: null, volScherm: false });
  let el = document.getElementById("rdv"); if (el) el.remove();
  el = document.createElement("div"); el.id = "rdv"; el.className = "rdv"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", opt.titel || "Beeld");
  document.body.appendChild(el);
  const urls = await Promise.all(beelden.map(x => rdvUrl(x.b)));
  beelden.forEach((x, i) => { x.url = urls[i]; });
  rdvTeken();
  try { if (el.requestFullscreen && !document.fullscreenElement && !/iPhone|iPad|iPod/.test(navigator.userAgent)) await el.requestFullscreen({ navigationUI: "hide" }); } catch (e) { }
  document.body.classList.add("rdv-aan");
}
function rdvTeken() {
  const el = document.getElementById("rdv"); if (!el) return;
  const B = RDV.beelden, m = RDV.modus, twee = B.length > 1;
  const img = (i) => B[i].url ? `<img src="${esc(B[i].url)}" alt="${esc(B[i].label || "")}" draggable="false">` : `<div class="rdv-leeg">Beeld niet beschikbaar</div>`;
  const doek = (i) => `<div class="rdv-doek">${img(i)}</div>`;
  const label = (t) => `<span class="rdv-label">${esc(t || "")}</span>`;
  let podium;
  if (m === "naast") podium = `<div class="rdv-pane">${doek(0)}${label(B[0].label)}</div><div class="rdv-pane">${doek(1)}${label(B[1].label)}</div>`;
  else if (m === "schuif") podium = `<div class="rdv-pane">${doek(0)}<div class="rdv-clip">${doek(1)}</div><div class="rdv-split" title="Versleep om te vergelijken"><span>⟷</span></div>${label(B[0].label)}<span class="rdv-label r">${esc(B[1].label || "")}</span></div>`;
  else { const i = m === "een1" ? 1 : 0; podium = `<div class="rdv-pane">${doek(i)}${label(B[i].label)}</div>`; }
  const o = RDV.opt.opdracht; const res = o && S.render_beelden[o.resultaat_id];
  const knop = (mm, t, tip) => `<button type="button" class="${m === mm ? "on" : ""}" data-rdv="modus" data-m="${mm}" title="${esc(tip)}">${t}</button>`;
  setTimeout(() => document.querySelectorAll("#rdv .rdv-doek img").forEach(i => { if (!i.complete) i.addEventListener("load", rdvToepassen, { once: true }); }), 0);
  el.innerHTML = `<div class="rdv-bar"><b class="rdv-titel">${esc(RDV.opt.titel || "")}</b>
      ${twee ? `<div class="rdv-groep">${knop("naast", "Naast elkaar", "Naast elkaar — zoom en verschuiven lopen gelijk")}${knop("schuif", "Schuif", "Schuifregelaar: ontwerp en render over elkaar")}${knop("een0", esc(B[0].label || "1"), "Enkel dit beeld (spatie wisselt)")}${knop("een1", esc(B[1].label || "2"), "Enkel dit beeld (spatie wisselt)")}</div>` : ""}
      <div class="rdv-groep"><button type="button" data-rdv="uit" title="Uitzoomen (−)" aria-label="Uitzoomen">−</button><button type="button" data-rdv="pas" title="Passend (0)" class="rdv-pct" id="rdv_pct">Passend</button><button type="button" data-rdv="in" title="Inzoomen (+)" aria-label="Inzoomen">+</button><button type="button" data-rdv="echt" title="Werkelijke grootte, 1 pixel = 1 pixel (1)">100 %</button></div>
      ${res ? `<button type="button" class="rdv-goed${res.goedgekeurd_op ? " on" : ""}" data-rdv="goed">${res.goedgekeurd_op ? "✓ Goedgekeurd" : "Goedkeuren"}</button>` : ""}
      <button type="button" class="rdv-sluit" data-rdv="sluit" title="Sluiten (Esc)" aria-label="Sluiten">✕</button></div>
    <div class="rdv-podium${m === "naast" ? " naast" : ""}">${podium}</div>
    <div class="rdv-hulp">Scrollen of knijpen = zoomen · slepen = verschuiven · dubbelklik = in/uit${twee ? " · spatie = wisselen" : ""} · Esc = sluiten</div>`;
  rdvToepassen();
}
// naast elkaar: links/rechts of boven/onder — wat het grootste beeld geeft (brede renders op een breed scherm: boven elkaar)
function rdvSchikking() {
  const pod = document.querySelector("#rdv .rdv-podium.naast"); if (!pod) return;
  const im = document.querySelector("#rdv .rdv-doek img"); const b0 = RDV.beelden[0] && RDV.beelden[0].b;
  const ar = im && im.naturalWidth ? im.naturalWidth / im.naturalHeight : b0 && b0.breedte && b0.hoogte ? b0.breedte / b0.hoogte : 1.5;
  const W = pod.clientWidth, H = pod.clientHeight; if (!W || !H) return;
  const opp = (w, h) => { const bw = Math.min(w, h * ar); return bw * bw / ar; };
  const boven = opp(W, H / 2) > opp(W / 2, H) * 1.05;
  if (pod.classList.contains("boven") !== boven) pod.classList.toggle("boven", boven);
}
function rdvPane() { return document.querySelector("#rdv .rdv-pane"); }
function rdvToepassen() {
  rdvSchikking();
  const p = rdvPane(); if (!p) return;
  const w = p.clientWidth, h = p.clientHeight;
  RDV.s = Math.min(16, Math.max(1, RDV.s));
  if (RDV.s <= 1.0001) { RDV.s = 1; RDV.x = 0; RDV.y = 0; }
  RDV.x = Math.min(0, Math.max(w * (1 - RDV.s), RDV.x)); RDV.y = Math.min(0, Math.max(h * (1 - RDV.s), RDV.y));
  const t = `translate(${RDV.x}px, ${RDV.y}px) scale(${RDV.s})`;
  document.querySelectorAll("#rdv .rdv-doek").forEach(d => { d.style.transform = t; });
  const sx = Math.round(RDV.split * w);
  const clip = document.querySelector("#rdv .rdv-clip"); if (clip) clip.style.clipPath = `inset(0 0 0 ${sx}px)`;
  const sp = document.querySelector("#rdv .rdv-split"); if (sp) sp.style.left = sx + "px";
  const pct = document.getElementById("rdv_pct"); if (pct) { const e = rdvEcht(); pct.textContent = RDV.s === 1 ? "Passend" : (e ? Math.round(RDV.s / e * 100) + " %" : Math.round(RDV.s * 100) + " %"); }
}
// schaal waarbij 1 beeldpixel = 1 schermpixel
function rdvEcht() {
  const p = rdvPane(); const im = document.querySelector("#rdv .rdv-doek img"); if (!p || !im || !im.naturalWidth) return 0;
  const ar = im.naturalWidth / im.naturalHeight; const bw = Math.min(p.clientWidth, p.clientHeight * ar);
  return im.naturalWidth / bw * (1 / (window.devicePixelRatio || 1));
}
function rdvZoom(k, px, py) {
  const p = rdvPane(); if (!p) return;
  if (px == null) { px = p.clientWidth / 2; py = p.clientHeight / 2; }
  const s2 = Math.min(16, Math.max(1, RDV.s * k)); const f = s2 / RDV.s;
  RDV.x = px - (px - RDV.x) * f; RDV.y = py - (py - RDV.y) * f; RDV.s = s2; rdvToepassen();
}
function rdvPunt(e) { const pane = (e.target.closest && e.target.closest(".rdv-pane")) || rdvPane(); const r = pane.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
function rdvSluit() {
  const el = document.getElementById("rdv"); if (!el) return;
  RDV.open = false; el.remove(); document.body.classList.remove("rdv-aan");
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { }
}
document.addEventListener("click", async (e) => {
  const k = e.target.closest && e.target.closest("[data-rdv]"); if (!k || !RDV.open) return;
  const a = k.dataset.rdv;
  if (a === "sluit") return rdvSluit();
  if (a === "in") return rdvZoom(1.5);
  if (a === "uit") return rdvZoom(1 / 1.5);
  if (a === "pas") { RDV.s = 1; return rdvToepassen(); }
  if (a === "echt") { const e2 = rdvEcht(); if (e2) { RDV.s = 1; rdvZoom(Math.max(1, e2)); } return; }
  if (a === "modus") { RDV.modus = k.dataset.m; if (RDV.modus === "naast" || RDV.modus === "schuif") { try { localStorage.setItem("rdv-modus", RDV.modus); } catch (x) { } } const s = RDV.s, x = RDV.x, y = RDV.y; rdvTeken(); Object.assign(RDV, { s, x, y }); rdvToepassen(); return; }
  if (a === "goed") { const o = RDV.opt.opdracht; const res = o && S.render_beelden[o.resultaat_id]; if (!res) return; await rdGoed(res.id, !res.goedgekeurd_op); const s = RDV.s, x = RDV.x, y = RDV.y; rdvTeken(); Object.assign(RDV, { s, x, y }); rdvToepassen(); }
});
document.addEventListener("wheel", (e) => {
  if (!RDV.open || !e.target.closest || !e.target.closest(".rdv-podium")) return;
  e.preventDefault(); const [px, py] = rdvPunt(e); rdvZoom(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), px, py);
}, { passive: false });
document.addEventListener("dblclick", (e) => {
  if (!RDV.open || !e.target.closest || !e.target.closest(".rdv-podium") || e.target.closest(".rdv-split")) return;
  const [px, py] = rdvPunt(e); if (RDV.s > 1.05) { RDV.s = 1; rdvToepassen(); } else rdvZoom(3, px, py);
});
document.addEventListener("pointerdown", (e) => {
  if (!RDV.open || !e.target.closest) return;
  const split = e.target.closest(".rdv-split"); const pod = e.target.closest(".rdv-podium"); if (!pod) return;
  e.preventDefault();
  RDV.wijzers.set(e.pointerId, { x: e.clientX, y: e.clientY, split: !!split && RDV.wijzers.size === 0 });
  try { e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId); } catch (x) { }
  if (RDV.wijzers.size === 2) { const [a, b] = [...RDV.wijzers.values()]; RDV.knijp = { d: Math.hypot(a.x - b.x, a.y - b.y), s: RDV.s }; }
});
document.addEventListener("pointermove", (e) => {
  if (!RDV.open) return; const w = RDV.wijzers.get(e.pointerId); if (!w) return;
  const dx = e.clientX - w.x, dy = e.clientY - w.y;
  if (w.split) { const p = rdvPane(); const r = p.getBoundingClientRect(); RDV.split = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); w.x = e.clientX; rdvToepassen(); return; }
  w.x = e.clientX; w.y = e.clientY;
  if (RDV.wijzers.size >= 2 && RDV.knijp) {
    const [a, b] = [...RDV.wijzers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
    const pane = rdvPane(); const r = pane.getBoundingClientRect(); const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
    if (RDV.knijp.d > 0) rdvZoom((RDV.knijp.s * d / RDV.knijp.d) / RDV.s, mx, my);
    RDV.x += dx / 2; RDV.y += dy / 2; rdvToepassen(); return;
  }
  RDV.x += dx; RDV.y += dy; rdvToepassen();
});
const rdvLos = (e) => { if (!RDV.open) return; RDV.wijzers.delete(e.pointerId); if (RDV.wijzers.size < 2) RDV.knijp = null; };
document.addEventListener("pointerup", rdvLos); document.addEventListener("pointercancel", rdvLos);
document.addEventListener("keydown", (e) => {
  if (!RDV.open) return;
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); return rdvSluit(); }
  if (e.key === "+" || e.key === "=") { e.preventDefault(); return rdvZoom(1.5); }
  if (e.key === "-" || e.key === "_") { e.preventDefault(); return rdvZoom(1 / 1.5); }
  if (e.key === "0") { RDV.s = 1; return rdvToepassen(); }
  if (e.key === "1") { const e2 = rdvEcht(); if (e2) { RDV.s = 1; rdvZoom(Math.max(1, e2)); } return; }
  if (e.key === " " && RDV.beelden.length > 1) { e.preventDefault(); RDV.modus = RDV.modus === "een0" ? "een1" : "een0"; const s = RDV.s, x = RDV.x, y = RDV.y; rdvTeken(); Object.assign(RDV, { s, x, y }); rdvToepassen(); }
}, true);
document.addEventListener("fullscreenchange", () => { if (RDV.open && !document.fullscreenElement && document.getElementById("rdv") && RDV.volScherm) rdvSluit(); RDV.volScherm = !!document.fullscreenElement; setTimeout(rdvToepassen, 50); });
window.addEventListener("resize", () => { if (RDV.open) rdvToepassen(); });
function rdvVergelijk(o) {
  const bron = S.render_beelden[o.bron_id], res = S.render_beelden[o.resultaat_id]; if (!bron || !res) return;
  rdViewer([{ b: bron, label: bron.soort === "render" ? "Eerdere render" : "Ontwerp" }, { b: res, label: "Render" }], { titel: `${o.ruimte} — ${fmtLong(lokDag(o.klaar_op || o.created_at))}`, opdracht: o });
}

/* ---------- vergelijken ---------- */
function rdVergelijk(o) {
  const bron = S.render_beelden[o.bron_id], res = S.render_beelden[o.resultaat_id]; if (!bron || !res) return;
  const sferen = (o.sfeer_ids || []).map(id => S.render_beelden[id]).filter(Boolean);
  openModal("Vergelijken — " + o.ruimte, `<div class="actions" style="margin:0 0 8px"><button type="button" class="btn sm primary" data-rd-act="groot" data-id="${o.id}">⤢ Volledig scherm met zoom</button></div>
    <div class="rd-vgl"><figure><button type="button" class="rd-res" data-rd-act="groot" data-id="${o.id}" title="Volledig scherm met zoom">${rdImg(bron)}</button><figcaption>Ontwerp${bron.soort === "render" ? " (eerdere render)" : ""}</figcaption></figure><figure><button type="button" class="rd-res" data-rd-act="groot" data-id="${o.id}" title="Volledig scherm met zoom">${rdImg(res)}</button><figcaption>Render · ${esc(fmtLong(lokDag(o.klaar_op || o.created_at)))}${res.breedte ? ` · ${res.breedte}×${res.hoogte}` : ""}</figcaption></figure></div>
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
  // 1.61: de gekozen versie van een standpunt in deze ruimte veranderde na het stalenbord
  if (rdStdOk()) { const ru = rdRuimteVan(o.project_id, o.ruimte);
    if (ru && rdStandpunten(o.project_id, ru.id).some(sp => sp.keuze_op && sp.keuze_op > (o.created_at || "") && (() => { const v = rdPresVersie(sp); return v && !refs.includes(v.id); })())) redenen.push("de gekozen render van een standpunt in deze ruimte is gewijzigd"); }
  return redenen;
}
function rdSbSignaal() {
  if (typeof vgVerwerker !== "function") return "";
  const w = vgVerwerker(); const i = (w.r && w.r.info) || {};
  return w.bekend && i.renders !== undefined && !i.stalenborden ? `<div class="rd-fout" style="margin:0 0 8px">De verwerkingscomputer kent nog geen stalenborden: voer installeer.sh opnieuw uit op de Mac mini. Tot dan blijven stalenborden in de wachtrij (er wordt niets betaald).</div>` : "";
}
function rdSbRij(p, r, heeftBeelden) {
    if (heeftBeelden === undefined) heeftBeelden = rdBeelden(p.id).some(b => b.soort === "render" || b.soort === "ontwerp");
    const versies = rdSbVersies(p.id, r); const gekozen = versies.find(b => b.geselecteerd); const toon = gekozen || versies[0];
    const ops = rdSbOpdrachten(p.id, r); const laatste = ops[0]; const loopt = ops.find(o => o.status === "wachtrij" || o.status === "bezig");
    const oud = toon ? rdSbVerouderd(toon) : [];
    const [l, c] = laatste ? (RD_STATUS[laatste.status] || [laatste.status, ""]) : ["", ""];
    return `<div class="rd-sbrij">${toon ? `<button type="button" class="rd-sbimg" data-rd-act="sb-bekijk" data-id="${toon.id}" title="Bekijken">${rdImg(toon)}</button>` : `<div class="rd-img leeg rd-sbimg"></div>`}
      <div class="rd-info"><div><b>${esc(r)}</b> ${gekozen ? `<span class="pill done">v${gekozen.versie || "?"} in presentatie</span>` : toon ? `<span class="pill st-offerte">nog geen versie gekozen</span>` : ""}${toon && toon.goedgekeurd_op ? ` <span class="pill done">goedgekeurd</span>` : ""}${oud.length ? ` <span class="pill st-on_hold" title="${esc(oud.join("; "))}">mogelijk verouderd</span>` : ""}${laatste && laatste.status !== "klaar" ? ` <span class="pill ${c}">${esc(l)}</span>` : ""}</div>
        <small class="muted">${versies.length ? `${versies.length} versie${versies.length > 1 ? "s" : ""} · laatste ${esc(fmtLong(lokDag(versies[0].created_at)))}` : "Nog geen stalenbord"}${oud.length ? ` · ${esc(oud.join("; "))} — bijwerken is een bewuste keuze (betaald)` : ""}</small>
        ${laatste && ["mislukt", "onzeker"].includes(laatste.status) && laatste.fout ? `<div class="rd-fout">${esc(laatste.fout)}</div>` : ""}
        <div class="actions">${toon && !gekozen ? `<button class="btn sm primary" data-rd-act="sb-kies-rij" data-id="${toon.id}" title="Versie ${toon.versie || "?"} in de A3-presentatie gebruiken">Gebruiken in presentatie</button>` : ""}${toon ? `<button class="btn sm" data-rd-act="sb-bekijk" data-id="${toon.id}">Bekijken</button>` : ""}
          ${loopt ? "" : `<button class="btn sm ${toon ? "" : "primary"}" data-rd-act="sb-nieuw" data-pid="${p.id}" data-r="${esc(r)}" ${heeftBeelden ? "" : "disabled"}>${toon ? "Bijwerken…" : "Stalenbord maken"}</button>`}
          ${laatste && ["mislukt", "onzeker", "geannuleerd"].includes(laatste.status) && !loopt ? `<button class="btn sm" data-rd-act="sb-opnieuw" data-id="${laatste.id}">Opnieuw…</button>` : ""}
          ${laatste && laatste.status === "wachtrij" && (isBeheer() || laatste.aangevraagd_door === S.me.id) ? `<button class="btn sm ghost danger" data-rd-act="annuleer" data-id="${laatste.id}">Annuleren</button>` : ""}</div></div></div>`;
}
function rdStalenPaneel(p) {
  const ruimtes = rdRuimtes(p.id); const heeftBeelden = rdBeelden(p.id).some(b => b.soort === "render" || b.soort === "ontwerp");
  const rij = (r) => rdSbRij(p, r, heeftBeelden);
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
    // 1.61: per standpunt van de ruimte de gekozen versie (presentatie- of hoofdversie, anders de nieuwste)
    const ru = rdStdOk() ? rdRuimteVan(pid, ruimte) : null;
    if (ru) { const v = rdStandpunten(pid, ru.id).map(sp => rdPresVersie(sp) || rdVersies(sp.id)[0]).filter(Boolean).map(b => b.id); if (v.length) return v.slice(0, RD_SB_MAX_REF); }
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
      ${rdStdOk() ? "" : `<label class="sw-row" style="margin-top:6px"><input type="checkbox" class="sw" name="koppel" value="1" checked><span>Aangevinkte beelden ook aan deze ruimte koppelen <small class="muted" style="display:block">Zo komen ze in de presentatie na het stalenbord van deze ruimte. Kosteloos. <b id="sb_kop"></b></small></span></label>`}</div>
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
  openModal(`Stalenbord — ${b.ruimte} · versie ${b.versie || "?"}`, `<button type="button" class="rd-sbgroot rd-res" data-rd-act="sb-groot" data-id="${b.id}" title="Volledig scherm met zoom">${rdImg(b)}</button>
    <div class="actions" style="margin:8px 0">${knop("sb-kies", b.geselecteerd ? "✓ Gekozen voor de presentatie — intrekken" : "Gebruiken in de presentatie", b.geselecteerd ? "" : "primary")}${knop("sb-goed", b.goedgekeurd_op ? "Goedkeuring intrekken" : "Goedkeuren")}${knop("sb-groot", "⤢ Volledig scherm")}${knop("sb-download", "Downloaden")}${b.drive && b.drive.url ? `<a class="btn sm" href="${esc(safeUrl(b.drive.url))}" target="_blank" rel="noopener">Drive ↗</a>` : ""}${knop("sb-corrigeer", "Corrigeren…")}${knop("sb-bijwerken", "Bijwerken…")}</div>
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

/* ---------- renders per ruimte en standpunt, met volledige historiek (script 057, v1.61) ----------
   Project → ruimte (vaste id: hernoemen breekt niets) → standpunt (één camerastandpunt met zijn oorspronkelijk ontwerp) →
   versies. Een correctie is een nieuwe versie binnen hetzelfde standpunt (ook vanaf een oudere versie: de vertakking blijft
   bewaard). Hoofdversie, presentatieversie en goedkeuring zijn drie aparte keuzes. Een mislukte aanvraag maakt geen versie. */
const rdStdOk = () => schemaV() >= 57 && !!S.render_standpunten && !!S.render_ruimtes;
const RD_SOORTEN = [["opening", "Opening (raam/deur)"], ["wand", "Wandvlak"], ["dak", "Dakhelling"], ["kast", "Kast(indeling)"], ["schab", "Schab"], ["meubel", "Meubel"], ["armatuur", "Armatuur"], ["decoratie", "Decoratie"], ["ander", "Ander"]];
const RD_LICHT = [["helder", "Helder en natuurlijk (standaard)"], ["neutraal", "Neutraal daglicht"], ["gedempt", "Gedempt, maar leesbaar"]];
const rdRuimteRijen = (pid) => Object.values(S.render_ruimtes || {}).filter(r => r.project_id === pid).sort((a, b) => (a.volgorde || 0) - (b.volgorde || 0) || a.naam.localeCompare(b.naam, "nl", { sensitivity: "base" }));
const rdRuimteVan = (pid, naam) => rdRuimteRijen(pid).find(r => rdSleutel(r.naam) === rdSleutel(naam)) || null;
const rdStandpunten = (pid, rid) => Object.values(S.render_standpunten || {}).filter(s => s.project_id === pid && (!rid || s.ruimte_id === rid)).sort((a, b) => (a.volgorde || 0) - (b.volgorde || 0) || (a.created_at || "").localeCompare(b.created_at || ""));
const rdVersies = (sid) => Object.values(S.render_beelden || {}).filter(b => b.standpunt_id === sid && b.soort === "render").sort((a, b) => (b.versie || 0) - (a.versie || 0) || (b.created_at || "").localeCompare(a.created_at || ""));
const rdSpOpdrachten = (sid) => Object.values(S.render_opdrachten || {}).filter(o => o.standpunt_id === sid && rdIsRender(o)).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
const rdToon = (sp) => (sp.hoofdversie_id && S.render_beelden[sp.hoofdversie_id]) || rdVersies(sp.id)[0] || null;
const rdPresVersie = (sp) => (sp.presentatie_id && S.render_beelden[sp.presentatie_id]) || (sp.hoofdversie_id && S.render_beelden[sp.hoofdversie_id]) || null;
const rdControleNodig = (b) => !!(b && b.controle && b.controle.status === "controle_nodig");
const rdLos = (pid) => rdBeelden(pid).filter(b => (b.soort === "render" || b.soort === "ontwerp") && !b.standpunt_id);
const rdStNaam = (f) => String(f || "").replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[_]+/g, " ").trim().slice(0, 120) || "Standpunt";
function rdCtxOntbreekt(r) {
  const l = []; if (!r) return ["ruimte"];
  if (!String(r.verdieping || "").trim()) l.push("verdieping");
  if (!String(r.zijde || "").trim()) l.push("zijde (straat/tuin)");
  if (!(r.achtergronden || []).length) l.push("achtergrondreferentie");
  return l;
}
function rdCtxRegel(p, r) {
  const adres = [p.adres, [p.postcode, p.gemeente].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const delen = [adres ? `werf: ${esc(adres)}` : `<span class="rd-let">geen werfadres in het project</span>`];
  if (r) {
    if (r.verdieping) delen.push(esc(r.verdieping)); if (r.zijde) delen.push(esc(r.zijde)); if (r.kijkrichting) delen.push("kijkt " + esc(r.kijkrichting));
    delen.push("licht: " + esc((RD_LICHT.find(x => x[0] === r.licht) || [0, r.licht || "helder"])[1].replace(" (standaard)", "")));
    delen.push(`${(r.achtergronden || []).length} achtergrondreferentie${(r.achtergronden || []).length === 1 ? "" : "s"}`);
  }
  const mis = rdCtxOntbreekt(r);
  return delen.join(" · ") + (mis.length ? ` <span class="rd-let">· ontbreekt: ${esc(mis.join(", "))}${mis.includes("achtergrondreferentie") ? " — buitenzicht blijft neutraal" : ""}</span>` : "");
}

/* het tabblad in de nieuwe structuur */
function vRendersStd(p) {
  const cfg = rdCfg(); const nV = rdVandaag();
  const ruimtes = rdRuimteRijen(p.id).filter(r => rdStandpunten(p.id, r.id).length || rdAfspraken(p.id).some(a => a.ruimte_id === r.id) || rdSbVersies(p.id, r.naam).length || rdSbOpdrachten(p.id, r.naam).length);
  const zicht = RD.filter && ruimtes.some(r => r.id === RD.filter) ? ruimtes.filter(r => r.id === RD.filter) : RD.filter === "nakijken" ? [] : ruimtes;
  const onzeker = rdStandpunten(p.id).filter(s => s.koppeling === "onzeker"); const los = rdLos(p.id);
  const batch = RD.batch && RD.batch.pid === p.id ? rdBatchHtml() : "";
  return `<div class="panel"><div class="panel-head"><div><h3>Renders</h3><div class="muted" style="font-size:12px;margin-top:2px">${rdSignaal()} · ${esc(cfg.model)} · vandaag ${nV}/${cfg.daglimiet} beelden</div></div>
      <div class="actions"><button class="btn sm" data-rd-act="pres-nieuw" data-pid="${p.id}" ${rdBeelden(p.id).some(b => b.soort === "render" || b.soort === "ontwerp") ? "" : "disabled"}>A3-presentatie</button><button class="btn sm" data-rd-act="sb-nieuw" data-pid="${p.id}" data-r="">+ Stalenbord</button><button class="btn sm primary" data-rd-act="nieuw" data-pid="${p.id}">Nieuw standpunt renderen</button></div></div>
    ${batch}
    ${ruimtes.length > 1 || onzeker.length || los.length ? `<div class="rd-chips"><button class="${RD.filter ? "" : "on"}" data-rd-act="filter" data-r="">Alle ruimtes</button>${ruimtes.map(r => `<button class="${RD.filter === r.id ? "on" : ""}" data-rd-act="filter" data-r="${r.id}">${esc(r.naam)}</button>`).join("")}${onzeker.length || los.length ? `<button class="${RD.filter === "nakijken" ? "on" : ""} rd-chip-let" data-rd-act="filter" data-r="nakijken">Nakijken (${onzeker.length + los.length})</button>` : ""}</div>` : ""}
    ${onzeker.length || los.length ? `<div class="notice rd-batch" style="display:block"><b>Historiek nakijken.</b> De bestaande renders werden automatisch per standpunt gegroepeerd op basis van hun opdrachten (niet op bestandsnaam). ${onzeker.length ? `${onzeker.length} standpunt${onzeker.length > 1 ? "en hebben" : " heeft"} een onzekere koppeling` : ""}${onzeker.length && los.length ? " en " : ""}${los.length ? `${los.length} beeld${los.length > 1 ? "en zijn" : " is"} niet gekoppeld` : ""}. <button class="btn sm" data-rd-act="filter" data-r="nakijken">Nakijken</button></div>` : ""}
    ${!ruimtes.length && !los.length ? `<div class="empty"><b>Nog geen renders</b>Klik op <b>Nieuw standpunt renderen</b>: kies de ruimte en je ontwerpbeelden (één standpunt per beeld).</div>` : ""}
  </div>
  ${rdSbSignaal() ? `<div style="margin-top:12px">${rdSbSignaal()}</div>` : ""}
  ${RD.filter === "nakijken" ? rdNakijken(p, onzeker, los) : zicht.map(r => rdRuimteSectie(p, r)).join("")}
  ${!RD.filter && los.length ? rdLosPaneel(p, los) : ""}
  <div class="grid two rd-onder">${rdSfeerPaneel(p)}${rdAfsprakenPaneel(p)}</div>
  ${rdPresentatiesPaneel(p)}`;
}
function rdRuimteSectie(p, r) {
  const sps = rdStandpunten(p.id, r.id);
  const afspr = rdAfspraken(p.id).filter(a => a.ruimte_id === r.id || rdSleutel(a.ruimte) === rdSleutel(r.naam));
  const alg = rdAfspraken(p.id).filter(a => a.ruimte === "*");
  const ag = (r.achtergronden || []).map(x => S.render_beelden[x.id]).filter(Boolean);
  return `<div class="panel rd-ruimte" style="margin-top:16px"><div class="panel-head"><div><h3>${esc(r.naam)}</h3><div class="muted" style="font-size:12px;margin-top:2px">${rdCtxRegel(p, r)}</div></div>
      <div class="actions"><button class="btn sm" data-rd-act="ru-inst" data-id="${r.id}">Ruimte-instellingen…</button><button class="btn sm primary" data-rd-act="nieuw" data-pid="${p.id}" data-r="${esc(r.naam)}">+ Standpunt</button></div></div>
    <div class="rd-ruimte-boven"><div class="rd-ctx">
        <div><b>Materiaalafspraken</b> <button class="btn ghost sm" data-rd-act="afspr-nieuw" data-pid="${p.id}" data-r="${esc(r.naam)}">+ Afspraak</button>${afspr.length ? `<ul class="rd-afspr">${afspr.map(a => `<li class="click" data-rd-act="afspr-bewerk" data-id="${a.id}">${esc(a.tekst)}</li>`).join("")}</ul>` : `<div class="muted" style="font-size:12.5px">Nog geen afspraken voor deze ruimte.</div>`}${alg.length ? `<div class="muted" style="font-size:12px;margin-top:4px">Heel project: ${alg.map(a => esc(a.tekst)).join(" · ")}</div>` : ""}</div>
        <div style="margin-top:8px"><b>Buitenzicht</b> ${ag.length ? `<div class="rd-agrij">${ag.map(b => `<figure>${rdImg(b)}<figcaption>${esc(((r.achtergronden || []).find(x => x.id === b.id) || {}).omschrijving || "")}</figcaption></figure>`).join("")}</div>` : `<div class="muted" style="font-size:12.5px">Geen vastgelegde achtergrond: door de ramen blijft het neutraal. Leg een foto of een gekozen render vast via Ruimte-instellingen.</div>`}</div></div>
      <div class="rd-sbmini">${rdSbRij(p, r.naam)}</div></div>
    ${sps.length ? `<div class="rd-grid">${sps.map(rdSpKaart).join("")}</div>` : `<div class="panel-body"><span class="muted">Nog geen standpunten in deze ruimte.</span></div>`}</div>`;
}
function rdSpKaart(sp) {
  const ontwerp = sp.ontwerp_id && S.render_beelden[sp.ontwerp_id]; const versies = rdVersies(sp.id); const toon = rdToon(sp);
  const ops = rdSpOpdrachten(sp.id); const loopt = ops.find(o => o.status === "wachtrij" || o.status === "bezig"); const laatste = ops[0];
  const pres = rdPresVersie(sp); const hoofd = sp.hoofdversie_id && S.render_beelden[sp.hoofdversie_id];
  const [l, c] = loopt ? (RD_STATUS[loopt.status] || [loopt.status, ""]) : ["", ""];
  const mislukt = laatste && ["mislukt", "onzeker"].includes(laatste.status) ? laatste : null;
  return `<div class="rd-kaart rd-sp${toon && toon.goedgekeurd_op ? " goed" : ""}"><div class="rd-duo">${rdImg(ontwerp, "bron")}${toon ? `<button type="button" class="rd-res" data-rd-act="sp-groot" data-id="${sp.id}" data-v="${toon.id}" title="Vergelijken met het ontwerp — volledig scherm">${rdImg(toon)}</button>` : `<div class="rd-img rd-wacht"><span>${loopt ? esc(l) : "Nog geen versie"}${loopt && loopt.stap ? `<small>${esc(loopt.stap)}</small>` : ""}</span></div>`}</div>
    <div class="rd-info"><div><b>${esc(sp.naam || "Standpunt")}</b> ${toon ? `<span class="pill ${hoofd ? "done" : "st-offerte"}">v${toon.versie || "?"} ${hoofd ? "hoofdversie" : "nieuwste — geen hoofdversie"}</span>` : ""}${versies.length > 1 ? ` <span class="pill">${versies.length} versies</span>` : ""}${pres ? ` <span class="pill st-lopend">presentatie v${pres.versie || "?"}</span>` : ""}${toon && toon.goedgekeurd_op ? ` <span class="pill done">goedgekeurd</span>` : ""}${rdControleNodig(toon) ? ` <span class="pill st-on_hold" title="Vermoede afwijking volgens de automatische controle — geen garantie">Controle nodig</span>` : ""}${sp.koppeling === "onzeker" ? ` <span class="pill st-on_hold" title="${esc(sp.koppeling_reden || "")}">Koppeling nakijken</span>` : ""}${loopt && toon ? ` <span class="pill ${c}">${esc(l)}</span>` : ""}</div>
      ${toon && S.render_opdrachten[toon.opdracht_id] ? `<div class="rd-instr" title="${esc(S.render_opdrachten[toon.opdracht_id].instructie)}">${esc(S.render_opdrachten[toon.opdracht_id].instructie)}</div>` : ""}
      ${mislukt ? `<div class="rd-fout">${esc(RD_STATUS[mislukt.status][0])}: ${esc(mislukt.fout || "")}${toon ? ` — v${toon.versie || "?"} blijft de bruikbare versie.` : ""}</div>` : ""}
      <div class="actions"><button class="btn sm" data-rd-act="sp-open" data-id="${sp.id}">Openen${versies.length ? ` (${versies.length})` : ""}</button>${toon && ontwerp ? `<button class="btn sm" data-rd-act="sp-groot" data-id="${sp.id}" data-v="${toon.id}">Vergelijken</button>` : ""}${toon && !loopt ? `<button class="btn sm" data-rd-act="sp-corr" data-id="${toon.id}" title="Gerichte correctie: enkel wat je vraagt verandert">Corrigeren…</button>` : ""}${!toon && ontwerp && !loopt ? `<button class="btn sm primary" data-rd-act="sp-render" data-id="${sp.id}">Renderen…</button>` : ""}${mislukt && !loopt ? `<button class="btn sm" data-rd-act="sp-opnieuw" data-id="${mislukt.id}">Opnieuw…</button>` : ""}${loopt && loopt.status === "wachtrij" && (isBeheer() || loopt.aangevraagd_door === S.me.id) ? `<button class="btn sm ghost danger" data-rd-act="annuleer" data-id="${loopt.id}">Annuleren</button>` : ""}</div></div></div>`;
}
function rdLosPaneel(p, los) {
  return `<div class="panel" style="margin-top:16px"><div class="panel-head"><div><h3>Niet gekoppelde beelden</h3><div class="muted" style="font-size:12px;margin-top:2px">Hun opdrachtreeks kon niet teruggevonden worden. Koppel ze aan een standpunt of maak er een eigen standpunt van.</div></div></div>
    <div class="rd-grid">${los.map(b => `<div class="rd-kaart"><button type="button" class="rd-res" data-rd-act="los-groot" data-id="${b.id}">${rdImg(b)}</button><div class="rd-info"><div><b>${esc(b.naam || "")}</b> <span class="pill">${b.soort === "ontwerp" ? "ontwerp" : "render"}</span></div><small class="muted">${esc(b.ruimte || "geen ruimte")} · ${esc(fmtLong(lokDag(b.created_at)))}</small>
      <div class="actions"><button class="btn sm" data-rd-act="los-koppel" data-id="${b.id}">Koppelen aan standpunt…</button><button class="btn sm" data-rd-act="los-eigen" data-id="${b.id}">Eigen standpunt</button></div></div></div>`).join("")}</div></div>`;
}
function rdNakijken(p, onzeker, los) {
  return `${onzeker.length ? `<div class="panel" style="margin-top:16px"><div class="panel-head"><div><h3>Onzekere koppelingen</h3><div class="muted" style="font-size:12px;margin-top:2px">Open het standpunt, kijk de versies na en bevestig, verplaats, maak los of voeg samen.</div></div></div>
    <div class="rd-grid">${onzeker.map(sp => rdSpKaart(sp).replace('<div class="rd-info">', () => `<div class="rd-info"><div class="rd-fout" style="color:var(--warn)">${esc(sp.koppeling_reden || "Automatisch hersteld — nakijken.")} <small class="muted">(${esc((S.render_ruimtes[sp.ruimte_id] || {}).naam || "")})</small></div>`)).join("")}</div></div>` : ""}
    ${los.length ? rdLosPaneel(p, los) : ""}${!onzeker.length && !los.length ? `<div class="panel" style="margin-top:16px"><div class="panel-body">Alles is gekoppeld.</div></div>` : ""}`;
}

/* standpunt openen: ontwerp, alle versies (met vertakking), details per versie */
function rdSpOpen(sid, vid) {
  const sp = S.render_standpunten[sid]; if (!sp) return;
  const r = S.render_ruimtes[sp.ruimte_id] || {}; const ontwerp = sp.ontwerp_id && S.render_beelden[sp.ontwerp_id];
  const versies = rdVersies(sid); const ops = rdSpOpdrachten(sid).filter(o => o.status !== "klaar");
  const sel = (vid && S.render_beelden[vid]) || rdToon(sp) || null; RD.spSel = { sid, vid: sel && sel.id };
  const o = sel && S.render_opdrachten[sel.opdracht_id]; const basis = sel && sel.basis_beeld_id && S.render_beelden[sel.basis_beeld_id];
  const isH = sel && sp.hoofdversie_id === sel.id, isP = sel && sp.presentatie_id === sel.id;
  const knop = (act, label, extra, d) => `<button type="button" class="btn sm ${extra || ""}" data-rd-act="${act}" data-id="${sid}" ${d || ""}>${label}</button>`;
  const ctrl = sel && sel.controle;
  const refs = o ? [["Bron", o.bron_id], ...(o.ontwerp_id && o.ontwerp_id !== o.bron_id ? [["Ontwerp (geometrie)", o.ontwerp_id]] : []), ...(o.achtergrond_ids || []).map(x => ["Achtergrond", x]), ...(o.sfeer_ids || []).map(x => ["Sfeer", x])] : [];
  const rij = (v) => `<button type="button" class="rd-vrij${sel && v.id === sel.id ? " on" : ""}" data-rd-act="sp-sel" data-id="${sid}" data-v="${v.id}">${rdImg(v)}<span><b>v${v.versie || "?"}</b>${v.basis_beeld_id && S.render_beelden[v.basis_beeld_id] ? ` ← v${S.render_beelden[v.basis_beeld_id].versie || "?"}` : " ← ontwerp"}${sp.hoofdversie_id === v.id ? " · hoofd" : ""}${sp.presentatie_id === v.id ? " · presentatie" : ""}${v.goedgekeurd_op ? " · ✓" : ""}${rdControleNodig(v) ? ` · <span class="rd-let">controle nodig</span>` : ""}<small>${esc(fmtLong(lokDag(v.created_at)))} ${esc(lokUur(v.created_at))} — ${esc((S.render_opdrachten[v.opdracht_id] || {}).instructie || "")}</small></span></button>`;
  openModal(`${sp.naam || "Standpunt"} — ${r.naam || ""}`, `
    ${sp.koppeling === "onzeker" ? `<div class="notice" style="margin:0 0 10px;display:block"><b>Koppeling nakijken:</b> ${esc(sp.koppeling_reden || "automatisch hersteld uit de bestaande opdrachten")}. ${knop("sp-bevestig", "Klopt zo", "primary")} ${knop("sp-bewerk", "Verplaatsen / samenvoegen…")}</div>` : ""}
    <div class="rd-spkop">${sel ? `<button type="button" class="rd-sbgroot rd-res" data-rd-act="sp-groot" data-id="${sid}" data-v="${sel.id}" title="Vergelijken met het ontwerp — volledig scherm">${rdImg(sel)}</button>` : ontwerp ? `<button type="button" class="rd-sbgroot rd-res" data-rd-act="los-groot" data-id="${ontwerp.id}">${rdImg(ontwerp)}</button>` : ""}</div>
    ${sel ? `<div class="actions" style="margin:8px 0">${knop("sp-groot", "⤢ Met ontwerp", "", `data-v="${sel.id}"`)}${basis ? knop("sp-groot-vorig", `⤢ Met v${basis.versie || "?"}`, "", `data-v="${sel.id}"`) : ""}
      ${knop("sp-kies", isH ? "✓ Hoofdversie" : "Hoofdversie maken", isH ? "" : "primary", `data-v="${sel.id}" data-rol="hoofd" data-aan="${isH ? 0 : 1}"`)}${knop("sp-kies", isP ? "✓ In presentatie" : "In presentatie", "", `data-v="${sel.id}" data-rol="presentatie" data-aan="${isP ? 0 : 1}"`)}
      <button type="button" class="btn sm" data-rd-act="sp-goed" data-id="${sel.id}" data-sid="${sid}">${sel.goedgekeurd_op ? "Goedkeuring intrekken" : "Goedkeuren"}</button><button type="button" class="btn sm" data-rd-act="download" data-id="${sel.id}">Downloaden</button>${sel.drive && sel.drive.url ? `<a class="btn sm" href="${esc(safeUrl(sel.drive.url))}" target="_blank" rel="noopener">Drive ↗</a>` : ""}
      <button type="button" class="btn sm" data-rd-act="sp-corr" data-id="${sel.id}">Corrigeren vanaf v${sel.versie || "?"}…</button><button type="button" class="btn sm ghost danger" data-rd-act="sp-los" data-id="${sel.id}" data-sid="${sid}">Losmaken…</button></div>
    <p style="margin:0 0 4px"><b>v${sel.versie || "?"}</b> · ${esc(fmtLong(lokDag(sel.created_at)))} ${esc(lokUur(sel.created_at))} · ${basis ? `correctie op v${basis.versie || "?"}` : "vanaf het ontwerp"}${sel.goedgekeurd_op ? ` · goedgekeurd door ${esc(userById(sel.goedgekeurd_door).name || "")}` : ""} · ${isH ? "hoofdversie" : "geen hoofdversie"} · ${isP ? "presentatieversie" : "niet in presentatie"}</p>
    ${o ? `<p style="margin:0 0 4px"><b>Instructie:</b> ${esc(o.instructie)}</p>${(o.afspraken || []).length ? `<p class="muted" style="margin:0 0 4px;font-size:12.5px">Afspraken toen: ${o.afspraken.map(a => esc(a.tekst)).join(" · ")}</p>` : ""}${o.context && (o.context.correcties || []).length ? `<p class="muted" style="margin:0 0 4px;font-size:12.5px">Geldende correcties toen: ${o.context.correcties.map(esc).join(" · ")}</p>` : ""}
      <div class="rd-refs">${refs.map(([t, id]) => { const b = S.render_beelden[id]; return `<figure>${b ? rdImg(b) : `<div class="rd-img leeg"></div>`}<figcaption>${esc(t)}</figcaption></figure>`; }).join("")}</div>` : ""}
    ${ctrl ? `<div class="rd-ctrl ${ctrl.status === "controle_nodig" ? "let" : ""}"><b>Automatische controle</b> — ${ctrl.status === "controle_nodig" ? "Controle nodig: vermoede afwijkingen" : ctrl.status === "geen_afwijking_gevonden" ? "geen afwijking gevonden" : "niet gecontroleerd" + (ctrl.reden ? " (" + esc(ctrl.reden) + ")" : "")}${(ctrl.afwijkingen || []).length ? `<ul>${ctrl.afwijkingen.map(a => `<li>${esc(a.element || a.soort || "")}: ${esc(a.beschrijving || "")} <small class="muted">(zekerheid ${esc(a.zekerheid || "?")})</small></li>`).join("")}</ul>` : ""}<small class="muted" style="display:block">Een automatische controle is een hulpmiddel, geen garantie: vergelijk zelf met het ontwerp. Er wordt nooit automatisch opnieuw gerenderd.</small></div>` : ""}` : `<p class="muted">Nog geen versie van dit standpunt.${ontwerp ? " " + knop("sp-render", "Renderen…", "primary") : ""}</p>`}
    <h4 style="margin:14px 0 6px">Historiek</h4><div class="rd-vlijst">
      ${ops.map(x => { const [lb] = RD_STATUS[x.status] || [x.status]; return `<div class="rd-vrij op"><div class="rd-img rd-wacht"><span>${esc(lb)}</span></div><span><b>${x.modus === "correctie" ? "Correctie" : "Render"}</b>${S.render_beelden[x.bron_id] && S.render_beelden[x.bron_id].soort === "render" ? ` op v${S.render_beelden[x.bron_id].versie || "?"}` : ""} — ${esc(lb)}<small>${esc(fmtLong(lokDag(x.created_at)))} — ${esc(x.instructie)}${x.fout ? ` · <span class="rd-let">${esc(x.fout)}</span>` : ""}</small></span></div>`; }).join("")}
      ${versies.map(rij).join("")}
      ${ontwerp ? `<button type="button" class="rd-vrij" data-rd-act="los-groot" data-id="${ontwerp.id}">${rdImg(ontwerp)}<span><b>Oorspronkelijk ontwerp</b><small>${esc(ontwerp.naam || "")} · geometrische hoofdbron van dit standpunt</small></span></button>` : `<div class="rd-fout">Dit standpunt heeft geen oorspronkelijk ontwerp — koppel er een via Bewerken.</div>`}</div>
    <h4 style="margin:14px 0 6px">Controlelijst en geldende correcties <button type="button" class="btn ghost sm" data-rd-act="sp-bewerk" data-id="${sid}">Bewerken…</button></h4>
    ${(sp.controlelijst || []).length ? `<ul class="rd-afspr">${sp.controlelijst.map(x => `<li><small class="muted">${esc((RD_SOORTEN.find(s => s[0] === x.soort) || [0, x.soort])[1])}:</small> ${esc(x.tekst)} ${x.bevestigd ? `<span class="pill done">bevestigd</span>` : `<span class="pill st-offerte">${x.bron === "voorstel" ? "voorstel — niet bevestigd" : "niet bevestigd"}</span>`}</li>`).join("")}</ul>` : `<p class="muted" style="margin:0;font-size:12.5px">Nog geen controlelijst. Na de eerste render stelt de automatische controle er een voor; enkel wat jij bevestigt gaat als vaste regel mee.</p>`}
    ${(sp.correcties || []).length ? `<ul class="rd-afspr">${sp.correcties.map(x => { const q = x.opdracht_id && S.render_opdrachten[x.opdracht_id]; const telt = !(q && ["mislukt", "geannuleerd", "onzeker"].includes(q.status));
      return `<li${x.actief === false ? ' class="muted" style="text-decoration:line-through"' : ""}>${esc(x.tekst)} <small class="muted">${esc(String(x.datum || "").slice(0, 10))}${telt ? "" : " · opdracht niet gelukt — telt niet mee"}</small></li>`; }).join("")}</ul>` : ""}
    ${sp.omgeving_notitie ? `<p class="muted" style="font-size:12.5px;margin:6px 0 0">Omgeving: ${esc(sp.omgeving_notitie)}</p>` : ""}`, { saveLabel: "Sluiten", wide: true, onSave: async () => { } });
  const m = document.getElementById("modal"); if (m) m.style.width = "min(1100px, 100%)";
}

/* standpunt bewerken: naam, ruimte, omgeving, achtergrondkeuze, controlelijst, correcties, samenvoegen */
function rdSpBewerk(sid) {
  const sp = S.render_standpunten[sid]; if (!sp) return;
  const r = S.render_ruimtes[sp.ruimte_id] || {}; const andere = rdStandpunten(sp.project_id).filter(x => x.id !== sid);
  const lijst = (sp.controlelijst || []).concat([{ id: "", soort: "armatuur", tekst: "", bevestigd: true, bron: "team" }]);
  const regel = (x, i) => `<div class="rd-clr" data-i="${i}"><select name="cl_soort_${i}">${opts(RD_SOORTEN, x.soort || "ander")}</select><input name="cl_tekst_${i}" value="${esc(x.tekst || "")}" maxlength="300" placeholder="${i === lijst.length - 1 ? "Nieuw punt, bv. papieren hanglamp midden boven het bed, 80 cm onder plafond" : ""}"><label class="chk"><input type="checkbox" name="cl_ok_${i}" value="1" ${x.bevestigd ? "checked" : ""}> bevestigd</label><input type="hidden" name="cl_id_${i}" value="${esc(x.id || "")}"><input type="hidden" name="cl_bron_${i}" value="${esc(x.bron || "team")}">${x.bron === "voorstel" ? `<small class="muted">voorstel</small>` : ""}</div>`;
  openModal(`Standpunt bewerken — ${sp.naam || ""}`, `<div class="form-grid">
    <div class="field"><label for="sp_n">Naam</label><input id="sp_n" name="naam" maxlength="120" value="${esc(sp.naam || "")}"></div>
    <div class="field"><label for="sp_r">Ruimte</label><select id="sp_r" name="ruimte_id">${opts(rdRuimteRijen(sp.project_id).map(x => [x.id, x.naam]), sp.ruimte_id)}</select><small class="muted">Verplaatsen neemt alle versies mee.</small></div>
    <div class="field span2"><label for="sp_o">Omgeving van dit standpunt</label><input id="sp_o" name="omgeving_notitie" maxlength="1000" value="${esc(sp.omgeving_notitie || "")}" placeholder="bv. raam rechts = tuinzijde; deur links kijkt naar de gang"></div>
    ${(r.achtergronden || []).length ? `<div class="field span2"><label>Achtergronden voor dit standpunt <small class="muted" style="font-weight:400">— niets aangevinkt = alle achtergronden van de ruimte</small></label><div class="rd-agrij">${r.achtergronden.map(x => { const b = S.render_beelden[x.id]; return `<label class="rd-pk"><input type="checkbox" name="ag" value="${x.id}" ${(sp.achtergrond_keuze || []).includes(x.id) ? "checked" : ""}>${b ? rdImg(b) : ""}<small>${esc(x.omschrijving || "")}</small></label>`; }).join("")}</div></div>` : ""}
    <div class="field span2"><label>Controlelijst <small class="muted" style="font-weight:400">— openingen, wandvlakken, dakhellingen, kastindeling, schabben, meubels, armaturen en decoratie. Enkel bevestigde punten gaan als vaste regel mee; een voorstel van de automatische controle is een vermoeden.</small></label><div class="rd-cl">${lijst.map(regel).join("")}</div></div>
    <div class="field span2"><label>Geldende correcties <small class="muted" style="font-weight:400">— gaan mee in elke volgende versie; vink uit wat niet meer geldt</small></label>${(sp.correcties || []).length ? sp.correcties.map((x, i) => `<label class="chk" style="display:flex;gap:6px;align-items:flex-start"><input type="checkbox" name="co_${i}" value="1" ${x.actief === false ? "" : "checked"}> <span>${esc(x.tekst)} <small class="muted">${esc(String(x.datum || "").slice(0, 10))}</small></span></label>`).join("") : `<small class="muted">Nog geen correcties.</small>`}</div>
    ${andere.length ? `<div class="field span2"><label for="sp_m">Samenvoegen met een ander standpunt <small class="muted" style="font-weight:400">— bv. hetzelfde ontwerp twee keer opgeladen; alle versies gaan naar het gekozen standpunt</small></label><select id="sp_m" name="samen"><option value="">— niet samenvoegen —</option>${andere.map(x => `<option value="${x.id}">${esc((S.render_ruimtes[x.ruimte_id] || {}).naam || "")} · ${esc(x.naam || "Standpunt")}</option>`).join("")}</select></div>` : ""}
  </div>`, {
    saveLabel: "Bewaren", wide: true,
    onSave: async (d) => {
      const f = $("#mform");
      const cl = lijst.map((x, i) => ({ id: d["cl_id_" + i] || "", soort: d["cl_soort_" + i], tekst: String(d["cl_tekst_" + i] || "").trim(), bevestigd: !!d["cl_ok_" + i], bron: d["cl_bron_" + i] === "voorstel" && !d["cl_ok_" + i] ? "voorstel" : "team" })).filter(x => x.tekst);
      const velden = { naam: String(d.naam || "").trim(), ruimte_id: d.ruimte_id, omgeving_notitie: String(d.omgeving_notitie || "").trim(), achtergrond_keuze: [...f.querySelectorAll('input[name="ag"]:checked')].map(i => i.value) };
      // enkel wat gewijzigd is: een correctie of controlevoorstel dat intussen bijkwam, gaat zo niet verloren
      const voor = (sp.controlelijst || []).map(x => ({ id: x.id, soort: x.soort, tekst: x.tekst, bevestigd: !!x.bevestigd, bron: x.bron === "voorstel" && !x.bevestigd ? "voorstel" : "team" }));
      if (JSON.stringify(voor) !== JSON.stringify(cl)) velden.controlelijst = cl;
      const actief = {}; (sp.correcties || []).forEach((x, i) => { if ((x.actief !== false) !== !!d["co_" + i]) actief[x.id] = !!d["co_" + i]; });
      if (Object.keys(actief).length) velden.correcties_actief = actief;
      const { data, error } = await sb.rpc("render_standpunt_bewaar", { p_standpunt: sid, p_velden: velden });
      if (error) { toast(error.message, 7000); return false; }
      S.render_standpunten[data.id] = data;
      if (d.samen) {
        if (!confirm("Alle versies van dit standpunt naar het gekozen standpunt verplaatsen? Niets wordt verwijderd.")) return false;
        const x = await sb.rpc("render_standpunt_samenvoegen", { p_van: sid, p_naar: d.samen });
        if (x.error) { toast(x.error.message, 7000); return false; }
        delete S.render_standpunten[sid]; S.render_standpunten[x.data.id] = x.data; await rdHerlaadBeelden();
      } else if (d.ruimte_id !== sp.ruimte_id) await rdHerlaadBeelden();
      toast("Bewaard"); render();
    },
  });
}
async function rdHerlaadBeelden() { if (typeof refetch === "function") { try { await Promise.all(["render_beelden", "render_opdrachten", "render_standpunten"].map(t => refetch(t))); } catch (e) { } } }

/* ruimte-instellingen: naam, verdieping, zijde, kijkrichting, licht, achtergrondreferenties */
function rdRuimteInst(rid) {
  const r = S.render_ruimtes[rid]; if (!r) return; const p = S.projecten[r.project_id];
  const adres = [p.adres, [p.postcode, p.gemeente].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const renders = rdStandpunten(r.project_id, rid).flatMap(sp => rdVersies(sp.id));
  openModal(`Ruimte-instellingen — ${r.naam}`, `<div class="form-grid">
    <div class="field"><label for="ru_n">Naam</label><input id="ru_n" name="naam" required maxlength="120" value="${esc(r.naam)}"><small class="muted">Hernoemen houdt alle standpunten, versies, afspraken en stalenborden gekoppeld.</small></div>
    <div class="field"><label for="ru_l">Licht</label><select id="ru_l" name="licht">${opts(RD_LICHT, r.licht || "helder")}</select><small class="muted">Geldt voor nieuwe renders van deze ruimte; een correctie behoudt de belichting van de vorige versie.</small></div>
    <div class="field span2"><label for="ru_ln">Lichtnotitie <small class="muted" style="font-weight:400">— optioneel</small></label><input id="ru_ln" name="licht_notitie" maxlength="500" value="${esc(r.licht_notitie || "")}" placeholder="bv. ochtendzon langs het dakraam"></div>
    <div class="field span2"><label>Werfadres</label><div>${adres ? esc(adres) : `<span class="rd-let">Geen adres in het project (Dossier).</span>`}</div><small class="muted">Gaat als context mee. Een adres bewijst niet wat door een raam zichtbaar is: zonder vastgelegde achtergrond blijft het buitenzicht neutraal.</small></div>
    <div class="field"><label for="ru_v">Verdieping</label><input id="ru_v" name="verdieping" list="ru_vs" maxlength="60" value="${esc(r.verdieping || "")}"><datalist id="ru_vs">${["kelder", "gelijkvloers", "1e verdieping", "2e verdieping", "3e verdieping", "zolder"].map(x => `<option value="${x}">`).join("")}</datalist></div>
    <div class="field"><label for="ru_z">Zijde</label><input id="ru_z" name="zijde" list="ru_zs" maxlength="120" value="${esc(r.zijde || "")}"><datalist id="ru_zs">${["straatzijde", "tuinzijde", "zijgevel", "binnenkoer", "straat- en tuinzijde"].map(x => `<option value="${x}">`).join("")}</datalist></div>
    <div class="field"><label for="ru_k">Kijkrichting <small class="muted" style="font-weight:400">— optioneel</small></label><input id="ru_k" name="kijkrichting" maxlength="200" value="${esc(r.kijkrichting || "")}" placeholder="bv. naar het zuiden, naar de tuin"></div>
    <div class="field"><label for="ru_o">Omgeving <small class="muted" style="font-weight:400">— optioneel</small></label><input id="ru_o" name="omgeving_notitie" maxlength="1000" value="${esc(r.omgeving_notitie || "")}" placeholder="bv. dakraam kijkt naar de lucht en de boomtoppen"></div>
    <div class="field span2"><label>Vastgelegde achtergronden <small class="muted" style="font-weight:400">— max. 6; per foto de gevel of raamgroep. Alle standpunten en correcties van deze ruimte gebruiken dezelfde omgeving.</small></label>
      ${(r.achtergronden || []).length ? `<div class="rd-agbew">${r.achtergronden.map((x, i) => { const b = S.render_beelden[x.id]; return `<div class="rd-agb">${b ? rdImg(b) : `<div class="rd-img leeg"></div>`}<input name="ago_${i}" maxlength="200" value="${esc(x.omschrijving || "")}" placeholder="bv. tuinzijde, raamgroep links"><label class="chk"><input type="checkbox" name="agweg_${i}" value="1"> weghalen</label></div>`; }).join("")}</div>` : `<div class="muted" style="font-size:12.5px">Nog geen achtergrond vastgelegd.</div>`}
      <div style="margin-top:8px"><label class="btn sm">+ Achtergrondfoto's<input id="ru_files" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden></label> <span id="ru_fn" class="muted" style="font-size:12px"></span>
        <input name="ag_nieuw_oms" maxlength="200" placeholder="Gevel of raamgroep voor de nieuwe foto's, bv. straatzijde" style="margin-top:6px"></div>
      ${renders.length ? `<div style="margin-top:8px"><label for="ru_rr">Of het buitenzicht van een render vastleggen</label><select id="ru_rr" name="ag_render"><option value="">— geen —</option>${renders.map(v => `<option value="${v.id}">${esc((S.render_standpunten[v.standpunt_id] || {}).naam || "")} · v${v.versie || "?"}</option>`).join("")}</select><input name="ag_render_oms" maxlength="200" placeholder="Gevel of raamgroep van dat buitenzicht" style="margin-top:6px"><small class="muted">Een gegenereerd buitenzicht wordt pas een vaste referentie als jij het hier kiest.</small></div>` : ""}</div>
  </div>`, {
    saveLabel: "Bewaren", wide: true,
    onSave: async (d) => {
      const files = [...(($("#ru_files") || {}).files || [])];
      const bestaand = (r.achtergronden || []).map((x, i) => ({ id: x.id, omschrijving: String(d["ago_" + i] || "").trim(), weg: !!d["agweg_" + i] })).filter(x => !x.weg).map(({ id, omschrijving }) => ({ id, omschrijving }));
      const nieuwOms = String(d.ag_nieuw_oms || "").trim();
      if (bestaand.length + files.length + (d.ag_render ? 1 : 0) > 6) { toast("Maximaal 6 achtergrondreferenties per ruimte."); return false; }
      const fout = files.find(x => !RD_TYPES[x.type] || x.size > RD_MAX || !x.size);
      if (fout) { toast(`${fout.name}: enkel PNG, JPEG of WebP tot 48 MB.`, 6000); return false; }
      // eerst de weggehaalde uit de ruimte (zodat er plaats is), dan de nieuwe foto's opladen, dan alles in één keer bewaren
      let lijst = bestaand;
      if (lijst.length !== (r.achtergronden || []).length) { const x = await sb.rpc("render_ruimte_bewaar", { p_ruimte: rid, p_velden: { achtergronden: lijst } }); if (x.error) { toast(x.error.message, 7000); return false; } }
      for (const file of files) {
        try {
          const buf = await file.arrayBuffer(); const sha = await vgSha256(buf); const m = await rdMaat(file);
          const pad = `${r.project_id}/achtergrond/${rdHex(16)}.${RD_TYPES[file.type]}`;
          await rdPoging(async () => { const { error } = await sb.storage.from("renders").upload(pad, new Blob([buf], { type: file.type }), { contentType: file.type, upsert: false }); if (error && !/exist|duplicate/i.test(error.message || "")) throw error; });
          const { data, error } = await sb.rpc("render_achtergrond_bewaar", { p_ruimte: rid, p_pad: pad, p_naam: file.name.slice(0, 200), p_mime: file.type, p_grootte: file.size, p_sha256: sha, p_breedte: m ? m.w : null, p_hoogte: m ? m.h : null, p_omschrijving: nieuwOms });
          if (error) throw error; S.render_beelden[data.id] = data; lijst = lijst.concat([{ id: data.id, omschrijving: nieuwOms }]);
        } catch (e) { toast(file.name + ": " + ((e && e.message) || e), 7000); return false; }
      }
      if (d.ag_render && !lijst.some(x => x.id === d.ag_render)) lijst = lijst.concat([{ id: d.ag_render, omschrijving: String(d.ag_render_oms || "").trim() }]);
      const velden = { naam: String(d.naam || "").trim(), licht: d.licht, licht_notitie: d.licht_notitie || "", verdieping: d.verdieping || "", zijde: d.zijde || "", kijkrichting: d.kijkrichting || "", omgeving_notitie: d.omgeving_notitie || "", achtergronden: lijst };
      const { data, error } = await sb.rpc("render_ruimte_bewaar", { p_ruimte: rid, p_velden: velden });
      if (error) { toast(error.message, 7000); return false; }
      const hernoemd = data.naam !== r.naam; S.render_ruimtes[data.id] = data;
      if (hernoemd) { await rdHerlaadBeelden(); if (typeof refetch === "function") { try { await refetch("render_afspraken"); } catch (e) { } } }
      toast("Ruimte bewaard"); render();
    },
  });
  const fi = $("#ru_files"); if (fi) fi.addEventListener("change", () => { const n = fi.files.length; const t = $("#ru_fn"); if (t) t.textContent = n ? `${n} foto${n > 1 ? "'s" : ""} gekozen — worden opgeladen bij Bewaren` : ""; });
}

/* nieuw standpunt renderen, opnieuw vanaf het ontwerp, of een gerichte correctie op een versie */
function rdStdForm(pid, preset) {
  preset = preset || {};
  const p = S.projecten[pid]; const cfg = rdCfg(); const sferen = rdBeelden(pid, "sfeer"); const nV = rdVandaag();
  const bron = preset.bron ? S.render_beelden[preset.bron] : null;
  const corr = !!(bron && bron.soort === "render");
  const sp = bron && bron.standpunt_id ? S.render_standpunten[bron.standpunt_id] : null;
  const ontwerp = sp && sp.ontwerp_id ? S.render_beelden[sp.ontwerp_id] : null;
  const ruimte0 = preset.ruimte || (sp && (S.render_ruimtes[sp.ruimte_id] || {}).naam) || (bron && bron.ruimte) || "";
  const gekozen = new Set(preset.sfeer || []);
  const titel = corr ? `Corrigeren — ${sp ? sp.naam : ""} v${bron.versie || "?"}` : bron ? `Opnieuw renderen vanaf het ontwerp — ${sp ? sp.naam : ""}` : "Nieuw standpunt renderen — " + projName(p);
  const ctx = (naam) => { const r = rdRuimteVan(pid, naam); return `<div class="muted" style="font-size:12.5px">${rdCtxRegel(p, r)}</div>${r ? "" : `<small class="muted">Nieuwe ruimte: vul na het renderen de ruimte-instellingen aan (verdieping, zijde, achtergrond).</small>`}`; };
  openModal(titel, `<div class="form-grid">
    ${corr || bron ? `<div class="field span2"><label>${corr ? "Bewerkingsdoel en geometrische referentie" : "Ontwerp"}</label><div class="rd-bron">${rdImg(bron)}${corr && ontwerp ? rdImg(ontwerp) : ""}<small class="muted">${corr ? `Links v${bron.versie || "?"}: enkel wat je hieronder vraagt, verandert (geometrie, objecten, materialen en belichting blijven). Rechts het oorspronkelijke ontwerp: gaat apart mee als geometrische referentie. Het resultaat wordt een nieuwe versie van dit standpunt.` : "Een nieuwe versie binnen hetzelfde standpunt, vanaf het oorspronkelijke ontwerp."}</small></div></div>`
      : `<div class="field"><label for="rd_ruimte">Ruimte</label><input id="rd_ruimte" name="ruimte" list="rd_ruimtes" required maxlength="120" value="${esc(ruimte0)}" placeholder="bv. Leefruimte"><datalist id="rd_ruimtes">${rdRuimteRijen(pid).map(r => `<option value="${esc(r.naam)}">`).join("")}</datalist></div>`}
    <div class="field"><label for="rd_kw">Kwaliteit</label><select id="rd_kw" name="kwaliteit">${opts(RD_KWALITEIT, preset.kwaliteit || cfg.kwaliteit)}</select></div>
    ${!bron ? `<div class="field span2"><label for="rd_files">Ontwerpbeelden <small class="muted" style="font-weight:400">— elk beeld wordt een eigen standpunt (camerastandpunt) · PNG, JPEG of WebP, max. 48 MB</small></label><input id="rd_files" type="file" accept="image/png,image/jpeg,image/webp" multiple><small class="muted">Een correctie van een bestaand standpunt doe je met Corrigeren… op dat standpunt, niet met een nieuw beeld.</small></div>` : ""}
    <div class="field span2" id="rd_ctx_vak">${ctx(ruimte0)}</div>
    <div class="field span2"><label for="rd_instr">${corr ? "Wat moet er veranderen? <small class=\"muted\" style=\"font-weight:400\">— enkel dit verandert</small>" : "Wat moet er gebeuren?"}</label><textarea id="rd_instr" name="instructie" rows="3" required maxlength="4000" placeholder="${corr ? "bv. Alle kastfronten zachtgeel. Kasten, grepen en indeling niet wijzigen." : "bv. Fotorealistische render, helder daglicht. Behoud architectuur, camerastandpunt, armaturen en decoratie."}">${esc(preset.instructie || "")}</textarea></div>
    ${corr ? `<div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" name="bewaar" value="1" checked><span>Blijft gelden voor volgende versies van dit standpunt <small class="muted" style="display:block">Aanpasbaar via Openen › Bewerken.</small></span></label></div>`
      : `<div class="field span2"><label>Sfeerbeelden <small class="muted" style="font-weight:400">— optioneel, max. 4: enkel licht, contrast en sfeer; nooit architectuur, materialen, meubels of lampen</small></label>
      ${sferen.length ? `<div class="rd-sfeerkeuze">${sferen.map(s => `<label class="rd-sk"><input type="checkbox" name="sfeer" value="${s.id}" ${gekozen.has(s.id) ? "checked" : ""}>${rdImg(s)}</label>`).join("")}</div>` : `<small class="muted">Nog geen sfeerbeelden in dit project.</small>`}</div>`}
    <div class="field span2" id="rd_afspr_vak">${rdAfsprakenInfo(pid, ruimte0)}</div>
    <div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" name="ok" value="1"><span><b id="rd_ok_t">Ik start betaalde beeldgeneratie</b><small class="muted" style="display:block">Model ${esc(cfg.model)} · elke render is één betaalde aanvraag bij OpenAI · vandaag al ${nV} van max. ${cfg.daglimiet}. Een mislukte of onzekere render wordt nooit automatisch opnieuw betaald.</small></span></label></div>
  </div>`, {
    saveLabel: corr ? "Corrigeren" : bron ? "Renderen" : "Uploaden en renderen", wide: true,
    onSave: async (d) => {
      const f = $("#mform");
      const ruimte = bron ? ruimte0 : String(d.ruimte || "").replace(/\s+/g, " ").trim(); const instructie = String(d.instructie || "").trim();
      const sfeer = [...f.querySelectorAll('input[name="sfeer"]:checked')].map(i => i.value);
      if (!ruimte && !bron) { toast("Vul de ruimte in."); return false; }
      if (!instructie) { toast(corr ? "Beschrijf wat er moet veranderen." : "Beschrijf wat er moet gebeuren."); return false; }
      if (sfeer.length > 4) { toast("Kies maximaal vier sfeerbeelden."); return false; }
      if (!d.ok) { toast("Bevestig eerst de betaalde beeldgeneratie."); return false; }
      const files = bron ? [] : [...(($("#rd_files") || {}).files || [])];
      if (!bron && !files.length) { toast("Kies minstens één ontwerpbeeld."); return false; }
      const fout = files.find(x => !RD_TYPES[x.type] || x.size > RD_MAX || !x.size);
      if (fout) { toast(`${fout.name}: enkel PNG, JPEG of WebP tot 48 MB.`, 6000); return false; }
      const aantal = bron ? 1 : files.length;
      if (nV + aantal > cfg.daglimiet) { toast(`Daglimiet: vandaag kunnen nog ${Math.max(0, cfg.daglimiet - nV)} renders. Een beheerder kan dat verhogen in Instellingen › Renders.`, 7000); return false; }
      if (aantal > 1 && !confirm(`${aantal} beelden: dat zijn ${aantal} nieuwe standpunten en ${aantal} betaalde renders met ${cfg.model}. Starten?`)) return false;
      const vast = { pid, std: true, modus: corr ? "correctie" : "nieuw", ruimte, instructie, sfeer: corr ? [] : sfeer, kwaliteit: d.kwaliteit || cfg.kwaliteit, model: cfg.model, bewaar: !!d.bewaar, standpunt: sp ? sp.id : null };
      const items = bron ? [{ rid: rdHex(16), naam: corr ? `${sp ? sp.naam : ""} v${bron.versie || "?"}` : (sp ? sp.naam : bron.naam), bron: { id: bron.id }, st: "wacht" }]
        : files.map(file => ({ rid: rdHex(16), naam: file.name, standpunt: rdStNaam(file.name), file, st: "wacht" }));
      RD.batch = { pid, vast, items, bezig: true };
      setTimeout(() => rdBatch(), 0);
    },
  });
  const ri = $("#rd_ruimte"); if (ri) ri.addEventListener("input", () => { const v = $("#rd_afspr_vak"); if (v) v.innerHTML = rdAfsprakenInfo(pid, ri.value); const c = $("#rd_ctx_vak"); if (c) c.innerHTML = ctx(ri.value); });
  const fi = $("#rd_files"); if (fi) fi.addEventListener("change", () => { const n = fi.files.length; const t = $("#rd_ok_t"); if (t) t.textContent = n > 1 ? `Ik start ${n} betaalde beeldgeneraties` : "Ik start betaalde beeldgeneratie"; });
  const box = $("#mform"); if (box) box.addEventListener("change", (e) => { if (e.target.name === "sfeer" && box.querySelectorAll('input[name="sfeer"]:checked').length > 4) { e.target.checked = false; toast("Maximaal vier sfeerbeelden."); } });
}

/* koppelen van een los beeld */
function rdLosKoppel(bid) {
  const b = S.render_beelden[bid]; if (!b) return; const sps = rdStandpunten(b.project_id);
  openModal("Koppelen aan een standpunt", `<div class="form-grid"><div class="field span2"><div class="rd-bron">${rdImg(b)}<small class="muted">${esc(b.naam || "")} · ${esc(b.ruimte || "geen ruimte")}</small></div></div>
    <div class="field span2"><label for="lk_s">Standpunt</label><select id="lk_s" name="standpunt">${sps.map(s => `<option value="${s.id}">${esc((S.render_ruimtes[s.ruimte_id] || {}).naam || "")} · ${esc(s.naam || "Standpunt")}</option>`).join("")}</select>
    <small class="muted">${b.soort === "render" ? "De render wordt de nieuwste versie van dat standpunt." : "Heeft het standpunt nog geen ontwerp, dan wordt dit zijn oorspronkelijk ontwerp."}</small></div></div>`, {
    saveLabel: "Koppelen",
    onSave: async (d) => { const { data, error } = await sb.rpc("render_beeld_koppel", { p_beeld: bid, p_standpunt: d.standpunt }); if (error) { toast(error.message, 7000); return false; } S.render_beelden[data.id] = data; await rdHerlaadBeelden(); render(); toast("Gekoppeld"); },
  });
}

/* presentatie: per ruimte en standpunt de gekozen versie (presentatie- of hoofdversie) */
function rdPresStdLijst(pid) {
  const rijen = [];
  rdRuimteRijen(pid).forEach(r => rdStandpunten(pid, r.id).forEach(sp => {
    const keuze = rdPresVersie(sp); const versies = rdVersies(sp.id); const ontwerp = sp.ontwerp_id && S.render_beelden[sp.ontwerp_id];
    const zicht = RD.pres.alle ? versies.concat(ontwerp ? [ontwerp] : []) : (keuze ? [keuze] : versies.slice(0, 1));
    zicht.forEach(b => rijen.push({ b, r, sp, standaard: keuze && b.id === keuze.id }));
  }));
  rdLos(pid).filter(b => b.soort === "render" && RD.pres.alle).forEach(b => rijen.push({ b, r: null, sp: null }));
  return rijen;
}
function rdPresStdHtml(pid) {
  return rdPresStdLijst(pid).map(({ b, r, sp, standaard }) => `<label class="rd-pk"><input type="checkbox" data-rd-pk="${b.id}" ${RD.pres.volgorde.includes(b.id) ? "checked" : ""}>${rdImg(b)}<span class="rd-nr" data-rd-nr="${b.id}">${RD.pres.volgorde.indexOf(b.id) + 1 || ""}</span><small>${esc(r ? r.naam : b.ruimte || "")}${sp ? " · " + esc(sp.naam || "") : ""}${b.soort === "ontwerp" ? " · ontwerp" : ` · v${b.versie || "?"}`}${standaard ? " · gekozen" : ""}${b.goedgekeurd_op ? " · ✓" : ""}</small></label>`).join("") || `<span class="muted">Nog geen gekozen versies — kies per standpunt een presentatie- of hoofdversie, of toon alle versies.</span>`;
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
  const std = rdStdOk();
  RD.pres = { pid, std, alle: false, volgorde: l.filter(b => b.goedgekeurd_op).map(b => b.id) };
  if (std) RD.pres.volgorde = rdPresStdLijst(pid).filter(x => x.standaard).map(x => x.b.id);   // 1.61: per standpunt de gekozen versie, per ruimte
  else if (!RD.pres.volgorde.length) RD.pres.volgorde = l.filter(b => b.soort === "render").slice(-6).map(b => b.id);
  openModal("A3-presentatie — " + projName(p), `<div class="form-grid">
    <div class="field"><label for="rp_k">Klant</label><input id="rp_k" name="klant" required maxlength="100" value="${esc((vorige && vorige.klant) || p.klant || "")}"></div>
    <div class="field"><label for="rp_v">Ontwerpversie</label><input id="rp_v" name="versie" required maxlength="40" value="${esc(vorige ? vorige.versie : "V1 - Voorontwerp")}" placeholder="bv. V2 - Voorontwerp"></div>
    <div class="field"><label for="rp_d">Datum</label><input id="rp_d" type="date" name="datum" required value="${esc(todayIso)}"></div>
    <div class="field"><label for="rp_o">Formaat</label><select id="rp_o" name="liggend">${opts([["0", "A3 staand (huisstijl)"], ["1", "A3 liggend"]], vorige && vorige.liggend ? "1" : "0")}</select></div>
    <div class="field span2"><label>Beelden <small class="muted" style="font-weight:400">— aanvinken in de volgorde waarin ze in de presentatie komen; de eerste drie vormen de cover${std ? ". Standaard per standpunt de gekozen presentatie- of hoofdversie, per ruimte." : ""}</small></label>
      ${std ? `<label class="chk" style="margin:0 0 6px"><input type="checkbox" data-rd-pres-alle="1"> Alle versies tonen (ook oudere en ontwerpen)</label><div class="rd-pres" id="rp_lijst">${rdPresStdHtml(pid)}</div>` : `<div class="rd-pres">${l.map(b => `<label class="rd-pk"><input type="checkbox" data-rd-pk="${b.id}" ${RD.pres.volgorde.includes(b.id) ? "checked" : ""}>${rdImg(b)}<span class="rd-nr" data-rd-nr="${b.id}">${RD.pres.volgorde.indexOf(b.id) + 1 || ""}</span><small>${esc(b.ruimte || "")}${b.soort === "ontwerp" ? " · ontwerp" : ""}${b.goedgekeurd_op ? " · ✓" : ""}</small></label>`).join("")}</div>`}</div>
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
      ${rdStdOk() ? `<div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" id="ri_c" ${c.controle ? "checked" : ""}><span><b>Automatische controle na elke render</b><small class="muted" style="display:block">De Mac mini vergelijkt de render met het ontwerp (en bij een correctie met de vorige versie) via Claude en markeert vermoede afwijkingen als "Controle nodig". Klein verbruik bij Anthropic, geen beeldgeneratie, nooit een automatische herstelronde, geen garantie.</small></span></label></div>` : ""}
      <div class="field span2"><div class="actions"><button class="btn primary" data-rd-act="inst-bewaar">Bewaren</button></div></div>
    </div></div></div>`;
}
async function rdInstBewaar() {
  const model = ($("#ri_m").value || "").trim(); const d = Number($("#ri_d").value);
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/i.test(model)) { toast("Ongeldige modelnaam."); return; }
  if (!Number.isInteger(d) || d < 0 || d > 500) { toast("Daglimiet tussen 0 en 500."); return; }
  const value = { model, kwaliteit: $("#ri_k").value, lange_zijde: Number($("#ri_l").value), daglimiet: d, controle: $("#ri_c") ? $("#ri_c").checked : rdCfg().controle };
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
  if (a === "nieuw") return rdStdOk() ? rdStdForm(el.dataset.pid, { ruimte: el.dataset.r || "" }) : rdForm(el.dataset.pid);
  // 1.61: ruimtes en standpunten (script 057)
  if (a === "ru-inst") return rdRuimteInst(id);
  if (a === "sp-open") return rdSpOpen(id);
  if (a === "sp-sel") return rdSpOpen(id, el.dataset.v);
  if (a === "sp-bewerk") { closeModal(true); return rdSpBewerk(id); }
  if (a === "sp-groot" || a === "sp-groot-vorig") { const sp = S.render_standpunten[id]; const v = S.render_beelden[el.dataset.v]; if (!sp || !v) return;
    const ref = a === "sp-groot" ? (sp.ontwerp_id && S.render_beelden[sp.ontwerp_id]) : (v.basis_beeld_id && S.render_beelden[v.basis_beeld_id]);
    return rdViewer([{ b: ref || v, label: a === "sp-groot" ? "Ontwerp" : `v${(ref || {}).versie || "?"}` }, ...(ref ? [{ b: v, label: `v${v.versie || "?"}` }] : [])], { titel: `${(S.render_ruimtes[sp.ruimte_id] || {}).naam || ""} · ${sp.naam || ""} — v${v.versie || "?"}`, opdracht: S.render_opdrachten[v.opdracht_id] }); }
  if (a === "los-groot") { const b = S.render_beelden[id]; if (b) rdViewer([{ b, label: b.soort === "ontwerp" ? "Ontwerp" : "Render" }], { titel: b.naam || "" }); return; }
  if (a === "sp-kies") { const { data, error } = await sb.rpc("render_standpunt_kies", { p_standpunt: id, p_beeld: el.dataset.v, p_rol: el.dataset.rol, p_aan: el.dataset.aan === "1" }); if (error) { toast(error.message, 6000); return; }
    S.render_standpunten[data.id] = data; render(); toast(el.dataset.rol === "hoofd" ? (el.dataset.aan === "1" ? "Hoofdversie gekozen" : "Geen hoofdversie meer") : (el.dataset.aan === "1" ? "Gaat in de presentatie" : "Niet meer in de presentatie")); return rdSpOpen(id, el.dataset.v); }
  if (a === "sp-goed") { const b = S.render_beelden[id]; if (!b) return; await rdGoed(id, !b.goedgekeurd_op); return rdSpOpen(el.dataset.sid, id); }
  if (a === "sp-corr") { const b = S.render_beelden[id]; if (!b) return; closeModal(true); return rdStdForm(b.project_id, { bron: b.id }); }
  if (a === "sp-render") { const sp = S.render_standpunten[id]; if (!sp || !sp.ontwerp_id) return; closeModal(true); return rdStdForm(sp.project_id, { bron: sp.ontwerp_id }); }
  if (a === "sp-opnieuw") { const o = S.render_opdrachten[id]; if (!o || !S.render_beelden[o.bron_id]) return;
    if (o.status === "onzeker" && !confirm("Deze render vertrok misschien al naar OpenAI (en is dan misschien al aangerekend). Kijk bij twijfel eerst het verbruik na. Toch opnieuw starten?")) return;
    return rdStdForm(o.project_id, { bron: o.bron_id, instructie: o.instructie, sfeer: o.sfeer_ids, kwaliteit: o.kwaliteit }); }
  if (a === "sp-los") { if (!confirm("Deze versie losmaken van het standpunt? Ze blijft bewaard bij de niet-gekoppelde beelden en kan opnieuw gekoppeld worden.")) return;
    const { data, error } = await sb.rpc("render_beeld_koppel", { p_beeld: id, p_standpunt: null }); if (error) { toast(error.message, 6000); return; } S.render_beelden[data.id] = data; await rdHerlaadBeelden(); closeModal(true); render(); return; }
  if (a === "sp-bevestig") { const { data, error } = await sb.rpc("render_koppeling_bevestig", { p_standpunt: id }); if (error) { toast(error.message, 6000); return; } S.render_standpunten[data.id] = data; render(); toast("Koppeling bevestigd"); return rdSpOpen(id); }
  if (a === "los-koppel") return rdLosKoppel(id);
  if (a === "los-eigen") { const b = S.render_beelden[id]; if (!b) return; const { data, error } = await sb.rpc("render_standpunt_nieuw", { p_beeld: id, p_ruimte: b.ruimte_id || null, p_naam: rdStNaam(b.naam) });
    if (error) { toast(error.message, 6000); return; } S.render_standpunten[data.id] = data; await rdHerlaadBeelden(); render(); toast("Eigen standpunt gemaakt"); return; }
  if (a === "filter") { RD.filter = el.dataset.r || ""; render(); return; }
  if (a === "batch-opnieuw") { if (RD.batch && !RD.batch.bezig) rdBatch(); return; }
  if (a === "batch-sluit") { RD.batch = null; render(); return; }
  if (a === "vergelijk") { const o = S.render_opdrachten[id]; if (o) rdVergelijk(o); return; }
  if (a === "groot") { const o = S.render_opdrachten[id]; if (o) rdvVergelijk(o); return; }   // 1.60.1: volledig scherm met zoom
  if (a === "sb-groot") { const b = S.render_beelden[id]; if (b) rdViewer([{ b, label: `Stalenbord ${b.ruimte} · v${b.versie || "?"}` }], { titel: `Stalenbord — ${b.ruimte}` }); return; }
  if (a === "goed") return rdGoed(id, el.dataset.v === "1");
  if (a === "download") { const b = S.render_beelden[id]; const o = b && S.render_opdrachten[b.opdracht_id]; const p = b && S.projecten[b.project_id];
    const sp = b && b.standpunt_id && S.render_standpunten && S.render_standpunten[b.standpunt_id];
    if (b) rdDownload(b, (sp ? `${(p && p.klant) || "render"} - ${b.ruimte || ""} - ${sp.naam || "standpunt"} v${b.versie || ""}.${(b.pad.split(".").pop() || "png")}` : `${(p && p.klant) || "render"} - ${(o && o.ruimte) || b.ruimte || ""} - ${(b.created_at || "").slice(0, 10)}.${(b.pad.split(".").pop() || "png")}`).replace(/[\\/:*?"<>|]+/g, " ")); return; }
  if (a === "corrigeer") { const b = S.render_beelden[id]; if (b) rdForm(b.project_id, { bron: b.id, ruimte: b.ruimte }); return; }
  if (a === "opnieuw") { const o = S.render_opdrachten[id]; if (!o) return;
    if (o.status === "onzeker" && !confirm("Deze render vertrok misschien al naar OpenAI (en is dan misschien al aangerekend). Kijk bij twijfel eerst het verbruik na. Toch een nieuwe render starten?")) return;
    return rdForm(o.project_id, { bron: o.bron_id, ruimte: o.ruimte, instructie: o.instructie, sfeer: o.sfeer_ids, kwaliteit: o.kwaliteit }); }
  if (a === "annuleer") { if (!confirm("Deze render annuleren? Er wordt niets aangerekend.")) return; const { data, error } = await sb.rpc("render_annuleer", { p_id: id }); if (error) { toast(error.message, 6000); return; } S.render_opdrachten[data.id] = data; render(); return; }
  if (a === "sfeer-weg") { const b = S.render_beelden[id]; if (!b || !confirm("Dit sfeerbeeld verwijderen? (Renders die het al gebruikten, blijven bestaan.)")) return;
    try { await dbDelete("render_beelden", id); await sb.storage.from("renders").remove([b.pad]); } catch (x) { } return; }
  if (a === "afspr-nieuw") return rdAfsprForm(el.dataset.pid, el.dataset.r ? { ruimte: el.dataset.r } : null);
  if (a === "afspr-bewerk") { const r = S.render_afspraken[id]; if (r) rdAfsprForm(r.project_id, r); return; }
  if (a === "pres-nieuw") return rdPresForm(el.dataset.pid);
  if (a === "pres-dl") { const r = S.render_presentaties[id]; if (r && r.pad) rdDownload({ pad: r.pad }, ((r.drive && r.drive.naam) || `Presentatie ${r.klant} ${r.versie}.pdf`).replace(/[\\/:*?"<>|]+/g, " ")); return; }
  if (a === "pres-opnieuw") { const { data, error } = await sb.rpc("render_presentatie_opnieuw", { p_id: id }); if (error) { toast(error.message, 6000); return; } S.render_presentaties[data.id] = data; render(); return; }
  if (a === "pres-weg") { if (!confirm("Deze presentatie uit de lijst verwijderen? (De pdf op Drive blijft staan.)")) return; const r = S.render_presentaties[id]; try { await dbDelete("render_presentaties", id); } catch (x) { } return; }
  if (a === "inst-bewaar") return rdInstBewaar();
  // stalenborden (1.60)
  if (a === "sb-nieuw") { if (MODAL_OPEN()) closeModal(true); return rdSbForm(el.dataset.pid, { ruimte: el.dataset.r || "" }); }
  if (a === "sb-bekijk") return rdSbBekijk(id);
  if (a === "sb-kies-rij") return rdSbKies(id, true);   // 1.60.1: rechtstreeks vanuit de rij
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
  if (el.dataset.rdPresAlle && RD.pres) { RD.pres.alle = el.checked; const l = $("#rp_lijst"); if (l) l.innerHTML = rdPresStdHtml(RD.pres.pid); return; }
  if (el.dataset.rdPk && RD.pres) { const id = el.dataset.rdPk; RD.pres.volgorde = RD.pres.volgorde.filter(x => x !== id); if (el.checked) RD.pres.volgorde.push(id); rdPresNummers(); }
});
