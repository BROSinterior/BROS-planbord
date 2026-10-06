/* =====================================================================
   BROS Planbord — klantenportaal fase 2 (script 035): beheer in het Planbord
   - Keuzes en materialen per project (tabblad Keuzes): keuzes met opties (foto's, meerprijs), openzetten voor de klant,
     de keuze van de klant opvolgen, bevestigen of heropenen.
   - Meerwerkaanvragen van de klant (paneel bovenaan het tabblad Meetstaat): behandelen, antwoorden, voorstel koppelen.
   - Werfpunten gemeld door de klant: "te beoordelen" in de werfopvolging (zie app.js: vsCard / vsForm).
   Wordt vóór app.js geladen; gebruikt de functies van app.js pas bij het tekenen (S, sb, openModal, dbInsert …).
   ===================================================================== */
const KZ_STATUS = { concept: "Concept (enkel intern)", open: "Wacht op de klant", gekozen: "Gekozen door de klant", bevestigd: "Bevestigd / besteld", vervallen: "Vervallen" };
const KZ_PILL = { concept: "st-offerte", open: "vs-open", gekozen: "st-lopend", bevestigd: "done", vervallen: "" };
const MWA_STATUS = { ingediend: "Nieuw", in_behandeling: "In behandeling", voorstel: "Voorstel klaar", geweigerd: "Niet mogelijk", ingetrokken: "Ingetrokken door de klant" };
const MWA_PILL = { ingediend: "late", in_behandeling: "vs-open", voorstel: "done", geweigerd: "", ingetrokken: "" };
const kzReady = () => schemaV() >= 35 && !!S.keuzes;
const kzOf = (pid) => Object.values(S.keuzes || {}).filter(k => k.project_id === pid).sort((a, b) => (a.ruimte || "").localeCompare(b.ruimte || "", "nl") || (a.volgorde || 0) - (b.volgorde || 0) || (a.created_at || "").localeCompare(b.created_at || ""));
const kzOpties = (kid) => Object.values(S.keuze_opties || {}).filter(o => o.keuze_id === kid).sort((a, b) => (a.volgorde || 0) - (b.volgorde || 0) || (a.created_at || "").localeCompare(b.created_at || ""));
const kzPrijs = (n) => Number(n) ? (Number(n) > 0 ? "+ " : "− ") + eur2(Math.abs(Number(n))) + " excl. btw" : "inbegrepen";
const mwaOf = (pid) => Object.values(S.meerwerk_aanvragen || {}).filter(a => a.project_id === pid).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
const mwaOpen = (pid) => mwaOf(pid).filter(a => a.status === "ingediend" || a.status === "in_behandeling");
/* foto's uit de opslag van dit Planbord (nooit een url naar een andere server, ook niet als een klant er een meegeeft) */
const werfFotoUrl = (u) => { const base = String((window.PLANBORD_CONFIG || {}).supabaseUrl || "").replace(/\/+$/, ""); return base && String(u || "").startsWith(base + "/storage/v1/object/public/werf/") ? String(u) : ""; };
const vsTeBeoordelen = (pid) => Object.values(S.vaststellingen || {}).filter(v => v.project_id === pid && v.te_beoordelen && v.status === "open");

/* ---------- tabblad Keuzes ---------- */
function vKeuzes(p) {
  if (!kzReady()) return SCHEMA_HINT(35);
  const ks = kzOf(p.id); const groepen = {}; ks.forEach(k => (groepen[k.ruimte || ""] = groepen[k.ruimte || ""] || []).push(k));
  const n = { open: ks.filter(k => k.status === "open").length, gekozen: ks.filter(k => k.status === "gekozen").length, laat: ks.filter(k => k.status === "open" && k.deadline && k.deadline < todayIso).length };
  const kaart = (k) => { const os = kzOpties(k.id); const g = os.find(o => o.id === k.gekozen_optie); const post = k.meerwerk_post && S.meetstaat_posten[k.meerwerk_post];
    return `<div class="panel" style="margin-bottom:12px"><div class="panel-head"><div><h3 style="font-size:15px">${esc(k.onderwerp)} <span class="pill ${KZ_PILL[k.status] || ""}">${KZ_STATUS[k.status] || esc(k.status)}</span>${k.status === "open" && k.deadline && k.deadline < todayIso ? ` <span class="pill late">deadline voorbij</span>` : ""}</h3>
        <div class="muted" style="font-size:12px;margin-top:2px">${os.length} optie${os.length === 1 ? "" : "s"}${k.deadline ? ` · kiezen vóór ${fmtLong(k.deadline)}` : ""}${k.lot ? ` · ${esc(lotName(k.lot))}` : ""}</div></div>
        <div class="actions">${k.status === "concept" ? `<button class="btn sm primary" data-act="kz-status" data-id="${k.id}" data-st="open" ${os.length ? "" : "disabled title=\"Voeg eerst opties toe\""}>Voorleggen aan de klant</button>` : ""}${k.status === "gekozen" ? `<button class="btn sm primary" data-act="kz-status" data-id="${k.id}" data-st="bevestigd">Bevestigen</button><button class="btn sm" data-act="kz-heropen" data-id="${k.id}" title="De klant kan opnieuw kiezen; een meer-/minwerkpost uit deze keuze wordt verwijderd">Heropenen</button>` : ""}${k.status === "open" ? `<button class="btn sm" data-act="kz-status" data-id="${k.id}" data-st="concept" title="Niet meer tonen in het portaal">Terugtrekken</button>` : ""}<button class="btn sm" data-act="kz-edit" data-id="${k.id}">Bewerken</button></div></div>
      ${k.toelichting ? `<div class="panel-body muted" style="font-size:13px;white-space:pre-line">${esc(k.toelichting)}</div>` : ""}
      <div class="panel-body" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px">${os.map(o => `<div style="border:1px solid ${g && g.id === o.id ? "var(--ok)" : "var(--line)"};border-radius:10px;overflow:hidden;background:var(--surface)">
          ${(o.fotos || [])[0] ? `<img src="${esc(safeSrc(o.fotos[0].url))}" alt="" loading="lazy" style="width:100%;height:120px;object-fit:cover;display:block;cursor:zoom-in" data-foto="${esc(safeUrl(o.fotos[0].url))}">` : `<div class="muted" style="height:60px;display:flex;align-items:center;justify-content:center;font-size:12px;background:var(--surface-2)">geen foto</div>`}
          <div style="padding:8px 10px"><b style="font-size:13px">${esc(o.naam)}</b>${g && g.id === o.id ? ` <span class="pill done">gekozen</span>` : ""}<div class="num" style="font-size:12px;${Number(o.meerprijs) ? "" : "color:var(--muted)"}">${kzPrijs(o.meerprijs)}</div>${o.leverancier || o.referentie ? `<div class="muted" style="font-size:11px">${esc([o.leverancier, o.referentie].filter(Boolean).join(" · "))}</div>` : ""}</div></div>`).join("") || `<div class="muted" style="font-size:13px">Nog geen opties — klik Bewerken.</div>`}</div>
      ${g ? `<div class="panel-body" style="border-top:1px solid var(--line);font-size:13px">✓ <b>${esc(g.naam)}</b> gekozen door ${esc(k.gekozen_naam || "de klant")} op ${fmtLong((k.gekozen_op || "").slice(0, 10))}${k.gekozen_opmerking ? ` — “${esc(k.gekozen_opmerking)}”` : ""}${post ? ` · <a href="#" data-act="kz-post" data-pid="${p.id}">${post.status === "minwerk" ? "minwerk" : "meerwerk"} ${esc(post.code || "")} in de meetstaat (${eur2(rowSigned(post))})</a>` : Number(g.meerprijs) ? ` · <span style="color:var(--warn)">meerwerkpost niet (meer) gevonden</span>` : ""}</div>` : ""}</div>`; };
  return `<div class="rend">
      <div class="panel"><div class="k">Wacht op de klant</div><div class="v">${n.open}</div></div>
      <div class="panel"><div class="k">Deadline voorbij</div><div class="v ${n.laat ? "neg" : ""}">${n.laat}</div></div>
      <div class="panel"><div class="k">Gekozen · te bevestigen</div><div class="v">${n.gekozen}</div></div>
      <div class="panel"><div class="k">Meer-/minwerk uit keuzes</div><div class="v">${eur2(ks.map(k => k.meerwerk_post && S.meetstaat_posten[k.meerwerk_post]).filter(Boolean).reduce((s, r) => s + rowSigned(r), 0))}</div></div></div>
    <div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Keuzes en materialen</h3><div class="muted" style="font-size:12px;margin-top:2px">Leg de klant keuzes voor (tegels, kranen, kleuren …) met foto's en een meerprijs. Hij kiest in het portaal met naam en vinkje; een optie met meer- of minprijs wordt meteen een meer-/minwerkpost (met akkoord) in de meetstaat.</div></div>
      <div class="actions"><button class="btn sm primary" data-act="kz-new" data-pid="${p.id}">+ Keuze</button></div></div></div>
    ${ks.length ? Object.keys(groepen).sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b, "nl")).map(r => `<h4 style="margin:18px 0 8px">${esc(r || "Zonder ruimte")}</h4>${groepen[r].map(kaart).join("")}`).join("")
      : `<div class="panel"><div class="empty"><b>Nog geen keuzes</b>Maak een keuze aan per beslissing die de klant moet nemen, met de opties die hij krijgt.</div></div>`}`;
}

/* keuze bewerken: velden + opties (naam, meerprijs, leverancier, referentie, link, omschrijving, foto's) */
function kzForm(k, pid) {
  const isNew = !k; const projectId = k ? k.project_id : pid; const p = S.projecten[projectId]; if (!p) return;
  const gekozen = k && (k.status === "gekozen" || k.status === "bevestigd");
  let opties = (k ? kzOpties(k.id) : []).map(o => ({ ...o, fotos: [...(o.fotos || [])], nieuw: [] }));
  if (!opties.length) opties = [{ naam: "", meerprijs: 0, leverancier: "", referentie: "", link: "", omschrijving: "", fotos: [], nieuw: [] }];
  const weg = []; let bewaard = k || null;   // na een eerste (deels mislukte) bewaring: bijwerken i.p.v. opnieuw aanmaken
  const ruimtes = [...new Set(kzOf(projectId).map(x => x.ruimte).concat(Object.values(S.vaststellingen || {}).filter(v => v.project_id === projectId).map(v => v.ruimte), msRows(projectId).map(r => r.locatie)).filter(Boolean).map(x => x.trim()))].sort();
  const lots = lotenList().map(l => [l.nr, lotName(l.nr)]);
  openModal(isNew ? "Nieuwe keuze — " + p.klant : "Keuze — " + k.onderwerp, `<div class="form-grid">
      <div class="field"><label for="kz_ruimte">Ruimte</label><input id="kz_ruimte" name="ruimte" list="kz_ruimtes" value="${esc(k?.ruimte || "")}" placeholder="bv. Badkamer"><datalist id="kz_ruimtes">${ruimtes.map(r => `<option value="${esc(r)}">`).join("")}</datalist></div>
      <div class="field"><label for="kz_onderwerp">Onderwerp</label><input id="kz_onderwerp" name="onderwerp" required value="${esc(k?.onderwerp || "")}" placeholder="bv. Kraan lavabo"></div>
      <div class="field span2"><label for="kz_toel">Toelichting voor de klant</label><textarea id="kz_toel" name="toelichting" rows="2" placeholder="bv. Alle opties passen op het gekozen meubel; levertijd 3 weken.">${esc(k?.toelichting || "")}</textarea></div>
      <div class="field"><label for="kz_deadline">Kiezen vóór</label><input id="kz_deadline" name="deadline" type="date" value="${esc(k?.deadline || "")}"></div>
      <div class="field"><label for="kz_lot">Lot voor meer-/minwerk</label><select id="kz_lot" name="lot"><option value="">— eerste lot —</option>${opts(lots, k?.lot ?? "")}</select></div>
      ${isNew || k.status === "concept" || k.status === "open" ? `<div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" name="open" ${k?.status === "open" ? "checked" : ""}><span><b>Meteen voorleggen aan de klant</b> — anders blijft het een concept dat enkel jullie zien.</span></label></div>` : ""}
      <div class="field span2"><label>Opties ${gekozen ? `<span class="muted" style="font-weight:400">— de klant heeft al gekozen; prijzen wijzigen verandert de meerwerkpost niet</span>` : ""}</label><div id="kz_opties"></div>
        <button type="button" class="btn sm" id="kz_optie_add" style="margin-top:8px">+ Optie</button></div>
    </div>`, {
    wide: true,
    onSave: async (d) => {
      kzLees(); const btn = $("#mform button[type=submit]");
      const geldig = opties.filter(o => (o.naam || "").trim());
      if (!geldig.length) { toast("Geef minstens één optie een naam."); return false; }
      for (const o of geldig) { const m = leesGetal(o.meerprijs); if (Number.isNaN(m)) { toast(`Meerprijs "${o.meerprijs}" bij ${o.naam} is geen geldig bedrag.`); return false; } o.meerprijsN = m == null ? 0 : r2(m); }
      if (geldig.some(o => o.meerprijsN) && !d.lot) { toast("Kies het lot voor het meer-/minwerk (een optie heeft een meerprijs)."); return false; }
      const row = { project_id: projectId, ruimte: (d.ruimte || "").trim(), onderwerp: (d.onderwerp || "").trim(), toelichting: (d.toelichting || "").trim(), deadline: d.deadline || null, lot: d.lot ? Number(d.lot) : null };
      // verse stand uit de databank: kiest de klant net terwijl dit venster open staat, dan nooit zijn keuze terugdraaien
      let vers = null; if (bewaard) { const { data } = await sb.from("keuzes").select("*").eq("id", bewaard.id).maybeSingle(); vers = data || bewaard; }
      if (!vers || vers.status === "concept" || vers.status === "open") row.status = d.open === "on" ? "open" : "concept";
      else if (k && k.status !== vers.status) toast("Let op: de klant heeft intussen gekozen — de keuze blijft staan.", 6000);
      let kk;
      if (!bewaard) { row.created_by = S.me.id; kk = await dbInsert("keuzes", row); bewaard = kk; } else { kk = await dbUpdate("keuzes", bewaard.id, row); }
      const gekozenId = vers ? vers.gekozen_optie : null;
      for (const [i, o] of geldig.entries()) {
        btn.textContent = `Optie ${i + 1}/${geldig.length} bewaren…`;
        const fotos = [...o.fotos];
        for (const f of o.nieuw) { try { fotos.push(await kzFotoUpload(projectId, f)); } catch (e) { toast("Foto niet geüpload: " + e.message); } }
        const orow = { keuze_id: kk.id, naam: o.naam.trim(), omschrijving: (o.omschrijving || "").trim(), leverancier: (o.leverancier || "").trim(), referentie: (o.referentie || "").trim(), link: /^https:\/\//i.test((o.link || "").trim()) ? o.link.trim() : "", meerprijs: o.meerprijsN, fotos, volgorde: i };
        if (o.id) await dbUpdate("keuze_opties", o.id, orow); else { const n = await dbInsert("keuze_opties", orow); o.id = n.id; }
        o.fotos = fotos; o.nieuw = [];
      }
      for (const o of weg.concat(opties.filter(o => o.id && !(o.naam || "").trim()))) {
        if (gekozenId === o.id) { toast(`"${o.naam || "optie"}" is gekozen door de klant en blijft staan.`); continue; }
        await dbDelete("keuze_opties", o.id).catch(() => { });
      }
      toast(isNew ? "Keuze aangemaakt" : "Keuze bewaard");
    },
    onDelete: isNew ? null : async () => {
      if (k.meerwerk_post && S.meetstaat_posten[k.meerwerk_post] && !confirm("Uit deze keuze kwam een meer-/minwerkpost in de meetstaat. Die blijft staan — verwijder ze zelf als dat nodig is. Doorgaan?")) throw new Error("geannuleerd");
      await dbDelete("keuzes", k.id); toast("Keuze verwijderd");
    },
  });
  const box = $("#kz_opties");
  function kzLees() { box.querySelectorAll("[data-oi]").forEach(el => { const o = opties[Number(el.dataset.oi)]; if (o) o[el.dataset.of] = el.value; }); }
  function teken() {
    box.innerHTML = opties.map((o, i) => `<div style="border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:8px">
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr auto;gap:8px;align-items:end">
        <label style="font-size:12px">Naam<input data-oi="${i}" data-of="naam" value="${esc(o.naam || "")}" placeholder="bv. Geborsteld messing"></label>
        <label style="font-size:12px">Meerprijs excl. btw<input data-oi="${i}" data-of="meerprijs" inputmode="decimal" value="${esc(typeof o.meerprijs === "number" ? (o.meerprijs ? getalVeld(o.meerprijs) : "") : (o.meerprijs || ""))}" placeholder="0 = inbegrepen"></label>
        <label style="font-size:12px">Leverancier<input data-oi="${i}" data-of="leverancier" value="${esc(o.leverancier || "")}"></label>
        <label style="font-size:12px">Referentie<input data-oi="${i}" data-of="referentie" value="${esc(o.referentie || "")}"></label>
        <button type="button" class="btn ghost sm danger" data-kzweg="${i}" aria-label="Optie verwijderen">✕</button></div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:8px;margin-top:6px">
        <label style="font-size:12px">Omschrijving<input data-oi="${i}" data-of="omschrijving" value="${esc(o.omschrijving || "")}" placeholder="kort, voor de klant"></label>
        <label style="font-size:12px">Link (https://…)<input data-oi="${i}" data-of="link" value="${esc(o.link || "")}" placeholder="productpagina"></label></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px">${o.fotos.map((f, j) => `<span style="position:relative"><img src="${esc(safeSrc(f.url))}" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:6px"><button type="button" class="btn ghost sm" data-kzfotoweg="${i}:${j}" style="position:absolute;top:-6px;right:-6px;padding:0 4px" aria-label="Foto weg">✕</button></span>`).join("")}${o.nieuw.map(f => `<span class="pill kl">${esc(f.name.slice(0, 18))}</span>`).join("")}
        <label class="btn sm">📷 Foto's<input type="file" accept="image/*" multiple hidden data-kzfile="${i}"></label></div></div>`).join("");
  }
  teken();
  box.addEventListener("click", (e) => {
    const w = e.target.closest("[data-kzweg]"); if (w) { kzLees(); const i = Number(w.dataset.kzweg); const o = opties[i]; if (k && o.id && k.gekozen_optie === o.id) { toast("Deze optie is gekozen door de klant — heropen eerst de keuze."); return; } if (o.id) weg.push(o); opties.splice(i, 1); if (!opties.length) opties.push({ naam: "", meerprijs: 0, fotos: [], nieuw: [] }); teken(); MODAL.dirty = true; return; }
    const fw = e.target.closest("[data-kzfotoweg]"); if (fw) { kzLees(); const [i, j] = fw.dataset.kzfotoweg.split(":").map(Number); opties[i].fotos.splice(j, 1); teken(); MODAL.dirty = true; }
  });
  box.addEventListener("change", (e) => { const f = e.target.closest("[data-kzfile]"); if (f) { kzLees(); const o = opties[Number(f.dataset.kzfile)]; o.nieuw.push(...[...f.files].filter(x => /^image\//.test(x.type) || /\.(jpe?g|png|heic|webp)$/i.test(x.name))); teken(); MODAL.dirty = true; } });
  $("#kz_optie_add").addEventListener("click", () => { kzLees(); opties.push({ naam: "", meerprijs: 0, leverancier: "", referentie: "", link: "", omschrijving: "", fotos: [], nieuw: [] }); teken(); MODAL.dirty = true; box.querySelector(`[data-oi="${opties.length - 1}"][data-of="naam"]`)?.focus(); });
}
async function kzFotoUpload(pid, file) {
  const { blob, w, h } = await fotoVerklein(file, 1600, 0.82);
  const path = `${pid}/keuzes/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await sb.storage.from("werf").upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;
  return { path, url: sb.storage.from("werf").getPublicUrl(path).data.publicUrl, w, h };
}
async function kzHeropen(id) {
  const k = S.keuzes[id]; if (!k) return;
  const post = k.meerwerk_post && S.meetstaat_posten[k.meerwerk_post];
  if (post && Object.values(S.vordering_regels || {}).some(r => r.post_id === post.id)) return toast(`De post ${post.code} uit deze keuze staat al in een vordering. Zet ze zelf op vervallen of maak een minwerk; heropenen kan dan niet automatisch.`, 8000);
  if (!confirm(`De klant opnieuw laten kiezen voor "${k.onderwerp}"?${post ? `\n\nDe ${post.status} post ${post.code} (${eur2(rowSigned(post))}) uit deze keuze wordt uit de meetstaat verwijderd.` : ""}`)) return;
  try { await dbUpdate("keuzes", id, { status: "open", gekozen_optie: null, gekozen_op: null, gekozen_naam: "", gekozen_door: null, gekozen_opmerking: "", meerwerk_post: null }); } catch (e) { return; }
  if (post) { const { error } = await sb.from("meetstaat_posten").delete().eq("id", post.id); if (error) toast("Keuze heropend, maar de post " + post.code + " kon niet verwijderd worden: " + error.message, 8000); else delete S.meetstaat_posten[post.id]; }
  render(); toast("Keuze staat weer open voor de klant");
}

/* ---------- meerwerkaanvragen van de klant (tabblad Meetstaat) ---------- */
function vMeerwerkAanvragen(p) {
  if (!kzReady()) return "";
  const lijst = mwaOf(p.id); if (!lijst.length) return "";
  const toon = S.mwaAlle ? lijst : lijst.filter(a => a.status !== "ingetrokken" && a.status !== "geweigerd" && a.status !== "voorstel" || (Date.now() - new Date(a.updated_at || a.created_at).getTime()) < 14 * 864e5);
  const gks = Object.values(S.goedkeuringen || {}).filter(g => g.project_id === p.id).sort((a, b) => (b.voorgelegd_op || "").localeCompare(a.voorgelegd_op || ""));
  return `<div class="panel" style="margin-bottom:16px;${mwaOpen(p.id).length ? "border-color:var(--warn)" : ""}"><div class="panel-head"><div><h3>Meerwerkaanvragen van de klant ${mwaOpen(p.id).length ? `<span class="cnt" style="background:var(--crit);color:#fff">${mwaOpen(p.id).length}</span>` : ""}</h3><div class="muted" style="font-size:12px;margin-top:2px">Wat de klant extra vraagt in het portaal. Maak de posten op (status meerwerk), leg ze ter goedkeuring voor en koppel het voorstel hier — de klant ziet de status en je antwoord.</div></div>
      <div class="actions"><button class="btn sm ghost" data-act="mwa-alle">${S.mwaAlle ? "Enkel lopende" : "Alles tonen"}</button></div></div>
    <div class="tw"><table class="t"><tbody>${toon.map(a => `<tr><td style="min-width:260px"><b>${esc(a.titel)}</b>${a.ruimte ? ` <span class="muted">· ${esc(a.ruimte)}</span>` : ""}<div class="muted" style="font-size:12px;white-space:pre-line">${esc(a.omschrijving || "")}</div>
        ${(a.fotos || []).filter(f => werfFotoUrl(f.url)).length ? `<div style="display:flex;gap:4px;margin-top:4px">${a.fotos.filter(f => werfFotoUrl(f.url)).map(f => `<img src="${esc(werfFotoUrl(f.url))}" alt="" loading="lazy" style="width:44px;height:44px;object-fit:cover;border-radius:6px;cursor:zoom-in" data-foto="${esc(werfFotoUrl(f.url))}">`).join("")}</div>` : ""}
        <small class="muted">${fmtLong((a.created_at || "").slice(0, 10))}${a.contact_id && S.contacten[a.contact_id] ? " · " + esc(S.contacten[a.contact_id].naam) : ""}</small></td>
      <td style="width:170px"><select class="inline" data-mwa="${a.id}" data-f="status" ${a.status === "ingetrokken" ? "disabled" : ""}>${opts(Object.entries(MWA_STATUS).filter(([kk]) => kk !== "ingetrokken" || a.status === "ingetrokken"), a.status)}</select>
        <select class="inline" data-mwa="${a.id}" data-f="goedkeuring_id" style="margin-top:4px" title="Voorstel (ter goedkeuring) dat bij deze aanvraag hoort"><option value="">— geen voorstel —</option>${opts(gks.map(g => [g.id, g.titel + " · " + eur2(g.totaal_incl)]), a.goedkeuring_id || "")}</select></td>
      <td><textarea class="inline" data-mwa="${a.id}" data-f="antwoord" rows="2" placeholder="Antwoord voor de klant (verschijnt in het portaal)" style="width:100%;min-width:220px">${esc(a.antwoord || "")}</textarea></td></tr>`).join("") || `<tr><td class="muted">Geen lopende aanvragen.</td></tr>`}</tbody></table></div></div>`;
}
async function mwaEdit(id, f, val) {
  const a = S.meerwerk_aanvragen[id]; if (!a || String(a[f] ?? "") === String(val ?? "")) return;
  const patch = { [f]: f === "goedkeuring_id" ? (val || null) : f === "antwoord" ? String(val).slice(0, 4000) : val, behandeld_door: S.me.id, behandeld_op: new Date().toISOString() };
  if (f === "goedkeuring_id" && val && (a.status === "ingediend" || a.status === "in_behandeling")) patch.status = "voorstel";
  if (f === "antwoord" && a.status === "ingediend" && val.trim()) patch.status = "in_behandeling";
  await dbUpdate("meerwerk_aanvragen", id, patch).catch(() => { });
}

/* ---------- acties (aangeroepen vanuit de klikafhandeling van app.js) ---------- */
function kpBeheerAct(d) {
  if (d.act === "kz-new") return kzForm(null, d.pid);
  if (d.act === "kz-edit") return kzForm(S.keuzes[d.id]);
  if (d.act === "kz-heropen") return kzHeropen(d.id);
  if (d.act === "kz-status") { const k = S.keuzes[d.id]; if (!k) return; if (d.st === "open" && !kzOpties(k.id).length) return toast("Voeg eerst opties toe."); return dbUpdate("keuzes", k.id, { status: d.st }).then(() => toast(d.st === "open" ? "Voorgelegd aan de klant" : d.st === "bevestigd" ? "Keuze bevestigd" : "Teruggetrokken uit het portaal")).catch(() => { }); }
  if (d.act === "kz-post") { S.ptab = "meetstaat"; render(); return; }
  if (d.act === "mwa-alle") { S.mwaAlle = !S.mwaAlle; render(); return; }
}
