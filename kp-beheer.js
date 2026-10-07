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
  const gks = Object.values(S.goedkeuringen || {}).filter(g => g.project_id === p.id && g.soort !== "overeenkomst").sort((a, b) => (b.voorgelegd_op || "").localeCompare(a.voorgelegd_op || ""));
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

/* =====================================================================
   Klantenportaal fase 3 (script 036): voortgang (werffoto's per week) en woningdossier
   ===================================================================== */
const vgReady = () => schemaV() >= 36 && !!S.werf_fotos;
const maandagVan = (d) => {   // maandag (lokale datum) van de week van een datum of tijdstip
  const x = !d ? new Date() : /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T12:00:00") : new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - (x.getDay() + 6) % 7);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const vgFotos = (pid) => Object.values(S.werf_fotos || {}).filter(f => f.project_id === pid).sort((a, b) => (b.genomen_op || "").localeCompare(a.genomen_op || ""));
const vgUpdate = (pid, week) => Object.values(S.werf_updates || {}).find(u => u.project_id === pid && u.week === week);
function vVoortgang(p) {
  if (!vgReady()) return "";
  const fotos = vgFotos(p.id); const nu = maandagVan();
  const weken = [...new Set([nu].concat(fotos.map(f => maandagVan(f.genomen_op)), Object.values(S.werf_updates || {}).filter(u => u.project_id === p.id).map(u => u.week)))].sort().reverse().slice(0, S.vgAlle ? 200 : 6);
  const gedeeld = fotos.filter(f => f.gedeeld_klant).length;
  const weekLabel = (w) => { const d = new Date(w + "T12:00:00"); const e = new Date(d); e.setDate(e.getDate() + 6); return `Week van ${fmtLong(w)} tot ${fmtLong(e.toISOString().slice(0, 10))}`; };
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Voortgang voor de klant</h3><div class="muted" style="font-size:12px;margin-top:2px">Werffoto's die je deelt, met per week een korte tekst — de klant ziet ze op het tabblad Werf van zijn portaal. Foto's neem je in de werfmodus (📸 Voortgang) of laad je hier op. ${fotos.length} foto's · ${gedeeld} gedeeld</div></div>
      <div class="actions"><label class="btn sm primary">📸 Foto's opladen<input type="file" accept="image/*" multiple hidden data-vgfile="${p.id}"></label></div></div>
    ${weken.map(w => { const fs = fotos.filter(f => maandagVan(f.genomen_op) === w); const u = vgUpdate(p.id, w);
      return `<div class="panel-body" style="border-top:1px solid var(--line)"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><b>${weekLabel(w)}${w === nu ? ` <span class="pill vs-open">deze week</span>` : ""}</b>
          <span class="muted" style="font-size:12px">${fs.filter(f => f.gedeeld_klant).length}/${fs.length} gedeeld${u && u.tekst ? ` · tekst ${u.gedeeld ? "gedeeld" : "niet gedeeld"}` : ""}</span></div>
        <textarea class="inline" data-vgweek="${w}" data-pid="${p.id}" rows="2" placeholder="Korte tekst voor de klant, bv. Deze week werden de tegels in de badkamer geplaatst." style="width:100%;margin-top:6px">${esc(u ? u.tekst : "")}</textarea>
        ${fs.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin-top:8px">${fs.map(f => `<div style="position:relative;border-radius:8px;overflow:hidden;border:2px solid ${f.gedeeld_klant ? "var(--ok)" : "transparent"}">
            <img src="${esc(safeSrc(f.url))}" alt="" loading="lazy" style="width:100%;height:96px;object-fit:cover;display:block;cursor:zoom-in" data-foto="${esc(safeUrl(f.url))}">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 6px;background:var(--surface);font-size:11px"><label style="display:flex;gap:4px;align-items:center;cursor:pointer"><input type="checkbox" data-vgdeel="${f.id}" ${f.gedeeld_klant ? "checked" : ""}> klant</label><button class="btn ghost sm danger" data-act="vg-del" data-id="${f.id}" style="padding:0 4px" aria-label="Foto verwijderen">✕</button></div></div>`).join("")}</div>` : `<div class="muted" style="font-size:12px;margin-top:6px">Nog geen foto's deze week.</div>`}</div>`; }).join("")}
    <div class="panel-body" style="border-top:1px solid var(--line)"><button class="btn ghost sm" data-act="vg-alle">${S.vgAlle ? "Enkel de laatste weken" : "Alle weken tonen"}</button></div></div>`;
}
async function vgOpladen(pid, files) {
  const lijst = [...files].filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|heic|webp)$/i.test(f.name)); if (!lijst.length) return;
  const delen = confirm(`${lijst.length} foto${lijst.length === 1 ? "" : "'s"} opladen. Meteen delen met de klant?\n\nOK = delen · Annuleren = enkel intern (later aan te vinken)`);
  let n = 0, i = 0; const fout = [];
  for (const file of lijst) {
    let path = null;
    try {
      toast(`Foto ${++i}/${lijst.length} opladen…`, 1500);
      const id = crypto.randomUUID(); const { blob, w, h } = await fotoVerklein(file, 2000, 0.84);
      const p = `${pid}/voortgang/${id}.jpg`;
      const { error } = await sb.storage.from("werf").upload(p, blob, { contentType: "image/jpeg", upsert: false }); if (error) throw error; path = p;
      const genomen = file.lastModified ? new Date(file.lastModified).toISOString() : new Date().toISOString();
      await dbInsert("werf_fotos", { id, project_id: pid, path, url: sb.storage.from("werf").getPublicUrl(path).data.publicUrl, w, h, genomen_op: genomen, gedeeld_klant: delen, created_by: S.me.id });
      n++;
    } catch (e) { fout.push(file.name + ": " + (e.message || e)); if (path) sb.storage.from("werf").remove([path]).catch(() => { }); }   // geen los bestand achterlaten
  }
  if (fout.length) toast(`${n} van ${lijst.length} foto's opgeladen — niet gelukt: ${fout.join(" · ")}`, 9000);
  else toast(`${n} foto${n === 1 ? "" : "'s"} opgeladen${delen ? " en gedeeld met de klant" : ""}`);
}
const vgBezig = {};   // per project+week één bewaring tegelijk (anders botst een tweede invoeging op unique(project_id, week))
function vgTekst(pid, week, tekst) {
  const k = pid + "|" + week; const vorige = vgBezig[k] || Promise.resolve();
  const nu = vorige.then(() => vgTekstBewaar(pid, week, tekst)).catch(() => { }); vgBezig[k] = nu; return nu;
}
async function vgTekstBewaar(pid, week, tekst) {
  const u = vgUpdate(pid, week); const t = String(tekst || "").trim().slice(0, 4000);
  if (u) { if ((u.tekst || "") === t) return; await dbUpdate("werf_updates", u.id, { tekst: t }).catch(() => { }); }
  else if (t) await dbInsert("werf_updates", { project_id: pid, week, tekst: t, gedeeld: true, created_by: S.me.id }).catch(() => { });
}
async function vgDelete(id) {
  const f = S.werf_fotos[id]; if (!f || !confirm("Deze foto verwijderen?")) return;
  try { await dbDelete("werf_fotos", id); } catch (e) { return; }
  if (f.path && f.path.startsWith(f.project_id + "/voortgang/") && !f.path.includes("..")) sb.storage.from("werf").remove([f.path]).catch(() => { });
}

/* ---------- woningdossier (tabblad Dossier) ---------- */
const wdOf = (pid) => Object.values(S.woningdossier || {}).filter(r => r.project_id === pid).sort((a, b) => (a.ruimte || "").localeCompare(b.ruimte || "", "nl") || (a.volgorde || 0) - (b.volgorde || 0) || (a.created_at || "").localeCompare(b.created_at || ""));
const WD_VELDEN = [["ruimte", "Ruimte", 110], ["onderdeel", "Onderdeel", 120], ["materiaal", "Materiaal / product", 170], ["kleur", "Kleur / afwerking", 130], ["leverancier", "Leverancier", 120], ["referentie", "Referentie", 110]];
function vWoningdossier(p) {
  if (!vgReady() || !S.woningdossier) return "";
  const rows = wdOf(p.id); const docs = Object.values(S.documenten).filter(d => d.project_id === p.id).sort((a, b) => (a.naam || "").localeCompare(b.naam || ""));
  const kz = kzReady() ? kzOf(p.id).filter(k => (k.status === "gekozen" || k.status === "bevestigd") && !rows.some(r => r.keuze_id === k.id)) : [];
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Woningdossier</h3><div class="muted" style="font-size:12px;margin-top:2px">Wat er in de woning zit: materialen, kleuren, leveranciers, garanties en onderhoud, met handleidingen als document. Handig voor de klant na de oplevering — en voor jullie bij een vraag jaren later.</div></div>
      <div class="actions"><label class="sw-row" style="margin:0;font-size:13px"><input type="checkbox" class="sw" data-act="wd-klant" data-pid="${p.id}" ${p.dossier_klant ? "checked" : ""}><span>Zichtbaar voor de klant</span></label>${kz.length ? `<button class="btn sm" data-act="wd-keuzes" data-pid="${p.id}" title="De gekozen opties van het tabblad Keuzes toevoegen">Overnemen uit keuzes (${kz.length})</button>` : ""}<button class="btn sm primary" data-act="wd-new" data-pid="${p.id}">+ Rij</button></div></div>
    ${rows.length ? `<div class="tw"><table class="t"><thead><tr>${WD_VELDEN.map(([, l]) => `<th>${l}</th>`).join("")}<th>Garantie tot</th><th>Onderhoud</th><th>Document</th><th></th></tr></thead><tbody>${rows.map(r => `<tr>
        ${WD_VELDEN.map(([f, , w]) => `<td style="min-width:${w}px"><input class="inline" data-wd="${r.id}" data-f="${f}" value="${esc(r[f] || "")}"></td>`).join("")}
        <td style="width:130px"><input class="inline num" type="date" data-wd="${r.id}" data-f="garantie_tot" value="${esc(r.garantie_tot || "")}"></td>
        <td style="min-width:180px"><input class="inline" data-wd="${r.id}" data-f="onderhoud" value="${esc(r.onderhoud || "")}" placeholder="bv. 1×/jaar ontkalken"></td>
        <td style="width:170px"><select class="inline" data-wd="${r.id}" data-f="document_id"><option value="">—</option>${opts(docs.map(d => [d.id, (d.gedeeld ? "" : "🔒 ") + d.naam]), r.document_id || "")}</select></td>
        <td class="r" style="width:36px"><button class="btn ghost sm danger" data-act="wd-del" data-id="${r.id}" aria-label="Verwijderen">✕</button></td></tr>`).join("")}</tbody></table></div>
      <div class="panel-body muted" style="font-size:12px;border-top:1px solid var(--line)">🔒 = document nog niet gedeeld met de klant: de klant ziet het pas als je het deelt (schakelaar klant hieronder bij de bestanden).</div>`
      : `<div class="empty"><b>Nog leeg</b>Voeg rijen toe of neem de gekozen opties over uit het tabblad Keuzes.</div>`}</div>`;
}
async function wdEdit(id, f, val) {
  const r = S.woningdossier[id]; if (!r) return; const v = f === "garantie_tot" || f === "document_id" ? (val || null) : String(val || "").trim().slice(0, f === "onderhoud" ? 2000 : 300);
  if (String(r[f] ?? "") === String(v ?? "")) return;
  await dbUpdate("woningdossier", id, { [f]: v }).catch(() => { });
}
let wdBezig = false;
async function wdKeuzes(pid) {
  if (wdBezig) return; wdBezig = true;
  try { await wdKeuzesDoe(pid); } finally { wdBezig = false; }
}
async function wdKeuzesDoe(pid) {
  const rows = wdOf(pid); const kz = kzOf(pid).filter(k => (k.status === "gekozen" || k.status === "bevestigd") && !rows.some(r => r.keuze_id === k.id)); let n = 0;
  for (const k of kz) { const o = S.keuze_opties[k.gekozen_optie]; if (!o) continue;
    await dbInsert("woningdossier", { project_id: pid, ruimte: k.ruimte || "", onderdeel: k.onderwerp, materiaal: o.naam, leverancier: o.leverancier || "", referentie: o.referentie || "", keuze_id: k.id, volgorde: n, created_by: S.me.id }).then(() => n++).catch(() => { }); }
  toast(`${n} rij${n === 1 ? "" : "en"} overgenomen uit de keuzes`);
}
function kpFase3Act(d, el) {
  if (d.act === "vg-alle") { S.vgAlle = !S.vgAlle; render(); return true; }
  if (d.act === "vg-del") { vgDelete(d.id); return true; }
  if (d.act === "wd-new") { dbInsert("woningdossier", { project_id: d.pid, volgorde: wdOf(d.pid).length, created_by: S.me.id }).catch(() => { }); return true; }
  if (d.act === "wd-del") { if (confirm("Deze rij verwijderen?")) dbDelete("woningdossier", d.id).catch(() => { }); return true; }
  if (d.act === "wd-keuzes") { wdKeuzes(d.pid); return true; }
  if (d.act === "wd-klant") { const p = S.projecten[d.pid]; if (!p) return true; const aan = !!el.checked;
    if (aan && !confirm("Het woningdossier zichtbaar maken in het klantenportaal?")) { el.checked = false; return true; }
    dbUpdate("projecten", p.id, { dossier_klant: aan }).then(() => toast(aan ? "Woningdossier zichtbaar voor de klant" : "Woningdossier niet meer zichtbaar voor de klant")).catch(() => { }); return true; }
  return false;
}

/* =====================================================================
   Testmodus (script 038): het klanten- of aannemersportaal bekijken zoals een contact het ziet — alleen lezen.
   Enkel voor een beheerder bij wie profiles.testmodus aan staat (in te stellen in de SQL-editor).
   ===================================================================== */
const tmReady = () => schemaV() >= 38 && isBeheer() && !!(S.me && (S.profiles[S.me.id] || S.me).testmodus);
function tmKnop() { return tmReady() ? `<button class="btn ghost sm" data-act="tm-open" title="Testmodus: een portaal bekijken zoals een klant of aannemer het ziet">🧪 Testmodus</button>` : ""; }
function tmContacten(pid, rol) {
  const kl = ["bouwheer", "contactpersoon"];
  const pcs = Object.values(S.project_contacten).filter(x => x.project_id === pid && (rol === "klant" ? kl.includes(x.rol) : !kl.includes(x.rol)));
  const eigen = [...new Map(pcs.map(x => [x.contact_id, x])).values()].map(x => ({ c: S.contacten[x.contact_id], rol: x.rol, loten: x.loten || [] })).filter(x => x.c && x.c.actief !== false);
  const andere = rol === "aannemer" ? Object.values(S.contacten).filter(c => c.soort !== "klant" && c.actief !== false && !eigen.some(x => x.c.id === c.id)).sort((a, b) => (a.naam || "").localeCompare(b.naam || "", "nl")) : [];
  return `${eigen.length ? `<optgroup label="Gekoppeld aan dit project">${eigen.map(x => `<option value="${x.c.id}">${esc(contactLabel(x.c))} — ${esc(x.rol)}${x.loten.length ? " · lot " + x.loten.join(", ") : ""}${x.c.user_id ? "" : " · nog geen login"}</option>`).join("")}</optgroup>` : ""}
    ${andere.length ? `<optgroup label="Andere (ziet enkel zijn prijsvragen)">${andere.map(c => `<option value="${c.id}">${esc(contactLabel(c))}${c.vakgebied ? " · " + esc(c.vakgebied) : ""}</option>`).join("")}</optgroup>` : ""}`;
}
function tmForm() {
  if (!tmReady()) return;
  const ps = Object.values(S.projecten).sort((a, b) => (b.nummer || "").localeCompare(a.nummer || ""));
  let pid = S.project && S.projecten[S.project] ? S.project : (ps.find(p => p.status === "lopend") || ps[0])?.id; let rol = "klant";
  openModal("Testmodus", `<p class="muted" style="margin-top:0;font-size:13px">Opent het portaal in een nieuw tabblad, zoals het gekozen contact het ziet (ook zonder login). <b>Alleen bekijken</b>: niets wordt bewaard of gemaild, ook niet als je op knoppen drukt. Stoppen kan met de oranje balk bovenaan of met Uitloggen in dat portaal; na 12 uur vervalt de testmodus vanzelf.</p>
    <div class="form-grid">
      <div class="field"><label>Portaal</label><label class="chk"><input type="radio" name="tmrol" value="klant" checked> <span>Klantenportaal</span></label><label class="chk"><input type="radio" name="tmrol" value="aannemer"> <span>Aannemersportaal</span></label></div>
      <div class="field"><label for="tm_p">Project</label><select id="tm_p">${ps.map(p => `<option value="${p.id}" ${p.id === pid ? "selected" : ""}>${esc(projName(p))}</option>`).join("")}</select></div>
      <div class="field span2"><label for="tm_c">Bekijken als</label><select id="tm_c"></select><small class="muted" id="tm_hint"></small></div>
    </div>`, { saveLabel: "Portaal openen", onSave: async () => {
      const cid = $("#tm_c").value; if (!cid) { toast("Kies een contact."); return false; }
      const w = window.open("about:blank", "_blank");
      const { error } = await sb.rpc("voorbeeld_start", { p_contact: cid, p_rol: rol });
      if (error) { if (w) w.close(); toast("Testmodus niet gestart: " + error.message, 7000); return false; }
      const url = (rol === "klant" ? "klant/" : "aannemer/") + "?voorbeeld=" + rol + "&c=" + encodeURIComponent(cid);
      if (w) w.location = url; else window.open(url, "_blank");
      toast(`Testmodus: ${rol === "klant" ? "klantenportaal" : "aannemersportaal"} als ${S.contacten[cid]?.naam || "contact"}`);
    } });
  const vul = () => { pid = $("#tm_p").value; rol = $("#mform").querySelector('input[name="tmrol"]:checked').value; const html = tmContacten(pid, rol); $("#tm_c").innerHTML = html || `<option value="">— geen contacten —</option>`;
    $("#tm_hint").textContent = rol === "klant" ? (html ? "De klant ziet al zijn projecten." : "Koppel eerst een bouwheer of contactpersoon bij Dossier › Contacten.") : "Ontbreekt de aannemer? Koppel hem bij Dossier › Contacten (vinkje ‘Verwittigen per mail’ uit) of kies hem bij ‘Andere’."; };
  $("#tm_p").addEventListener("change", vul); $("#mform").querySelectorAll('input[name="tmrol"]').forEach(i => i.addEventListener("change", vul)); vul();
}

/* =====================================================================
   Overeenkomsten (script 039): een pdf uit de projectmap (of opgeladen) laten goedkeuren in het klantenportaal.
   Iedere gekozen bouwheer keurt zelf goed met naam, vinkje en een code per mail. Na het laatste akkoord maakt het
   Planbord de getekende pdf (overeenkomst + akkoordpagina) en bewaart die in Documenten/Overeenkomsten (gedeeld met de klant).
   ===================================================================== */
const ovReady = () => schemaV() >= 39 && !!S.goedkeuring_tekenaars;
const ovOf = (pid) => Object.values(S.goedkeuringen || {}).filter(g => g.project_id === pid && g.soort === "overeenkomst").sort((a, b) => (b.voorgelegd_op || "").localeCompare(a.voorgelegd_op || ""));
const ovTek = (gid) => Object.values(S.goedkeuring_tekenaars || {}).filter(t => t.goedkeuring_id === gid).sort((a, b) => (S.contacten[a.contact_id]?.naam || "").localeCompare(S.contacten[b.contact_id]?.naam || "", "nl"));
const ovB64 = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
const ovSha = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
function vOvereenkomsten(p) {
  if (!ovReady()) return "";
  const os = ovOf(p.id);
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Overeenkomsten</h3><div class="muted" style="font-size:12px;margin-top:2px">Leg een pdf uit de projectmap voor in het klantenportaal. Iedere gekozen bouwheer keurt zelf goed (naam, vinkje en een code per mail). Daarna komt de getekende pdf met akkoordpagina in Documenten/Overeenkomsten, gedeeld met de klant.</div></div>
      <div class="actions"><button class="btn sm primary" data-act="ov-new" data-pid="${p.id}">+ Overeenkomst</button></div></div>
    ${os.length ? `<div class="tw"><table class="t"><thead><tr><th>Overeenkomst</th><th>Voorgelegd</th><th>Bouwheren</th><th>Status</th><th></th></tr></thead><tbody>${os.map(g => { const ts = ovTek(g.id); const doc = g.getekend_document && S.documenten[g.getekend_document]; const docUrl = doc ? doc.url : g.getekend_drive_id ? `https://drive.google.com/file/d/${encodeURIComponent(g.getekend_drive_id)}/view` : ""; const verlopen = g.status === "open" && g.geldig_tot && g.geldig_tot < todayIso;
      return `<tr><td><b>${esc(g.titel)}</b><small class="muted" style="display:block"><a href="#" data-act="ov-open" data-id="${g.id}">📄 ${esc(g.bestand_naam || "pdf")}</a> · <span title="SHA-256-vingerafdruk van de voorgelegde versie" class="num">${esc((g.bestand_sha256 || "").slice(0, 12))}…</span></small></td>
        <td class="num">${fmtLong((g.voorgelegd_op || "").slice(0, 10))}${g.geldig_tot ? `<small class="muted ${verlopen ? "late" : ""}" style="display:block">vóór ${fmtLong(g.geldig_tot)}</small>` : ""}</td>
        <td style="font-size:12px">${ts.map(t => `${esc(S.contacten[t.contact_id]?.naam || "?")}: ${t.status === "akkoord" ? `<b style="color:var(--ok)">akkoord</b> ${fmtLong((t.beslist_op || "").slice(0, 10))}` : t.status === "geweigerd" ? `<b style="color:var(--crit)">niet akkoord</b>${t.opmerking ? ` — “${esc(t.opmerking.slice(0, 80))}”` : ""}` : `<span class="muted">wacht${t.code_tot ? " · code gevraagd" : ""}</span>`}`).join("<br>") || "—"}</td>
        <td><span class="pill ${g.status === "akkoord" ? "done" : g.status === "open" ? (verlopen ? "late" : "st-offerte") : "kl"}">${verlopen ? "Termijn verstreken" : GK_STATUS[g.status] || esc(g.status)}</span>${docUrl ? `<small style="display:block"><a href="${esc(safeUrl(docUrl))}" target="_blank" rel="noopener">getekende pdf ↗</a></small>` : g.status === "akkoord" ? `<small class="muted" style="display:block">${g.getekend_op ? "getekende pdf wordt gemaakt…" : "getekende pdf nog te maken"}</small>` : ""}</td>
        <td class="r" style="white-space:nowrap">${g.status === "akkoord" && !docUrl ? `<button class="btn ghost sm" data-act="ov-teken" data-id="${g.id}">Getekende pdf maken</button>` : ""}${g.status === "akkoord" ? `<button class="btn ghost sm" data-act="ov-details" data-id="${g.id}">Details</button>` : ""}${g.status === "open" ? `<button class="btn ghost sm" data-act="ov-mail" data-id="${g.id}" title="De mail opnieuw sturen naar wie nog moet goedkeuren">Opnieuw mailen</button><button class="btn ghost sm danger" data-act="ov-weg" data-id="${g.id}">Intrekken</button>` : ""}</td></tr>`; }).join("")}</tbody></table></div>`
      : `<div class="empty"><b>Nog geen overeenkomsten</b>Bv. de architectenovereenkomst of de aannemingsovereenkomst — als pdf in de projectmap.</div>`}</div>`;
}
function ovForm(pid) {
  const p = S.projecten[pid]; if (!p) return;
  const pdfs = Object.values(S.documenten || {}).filter(d => d.project_id === pid && (/pdf/i.test(d.mime || "") || /\.pdf$/i.test(d.naam || ""))).sort((a, b) => (a.pad || "").localeCompare(b.pad || "") || (a.naam || "").localeCompare(b.naam || ""));
  const bh = Object.values(S.project_contacten).filter(x => x.project_id === pid && ["bouwheer", "contactpersoon"].includes(x.rol)).map(x => ({ x, c: S.contacten[x.contact_id] })).filter(y => y.c && y.c.actief !== false);
  const uniek = [...new Map(bh.map(y => [y.c.id, y])).values()];
  openModal("Overeenkomst ter goedkeuring", `<div class="form-grid">
    <div class="field span2"><label for="ov_t">Titel (ziet de klant)</label><input id="ov_t" name="titel" value="Overeenkomst ${esc(p.klant || "")}" required></div>
    <div class="field span2"><label for="ov_doc">Pdf uit de projectmap</label><select id="ov_doc" name="doc"><option value="">— kies een pdf —</option>${pdfs.map(d => `<option value="${d.id}">${esc((d.pad ? d.pad + " › " : "") + d.naam)}</option>`).join("")}</select>
      <small class="muted">${pdfs.length ? "" : "Geen pdf's gevonden in de projectmap (vernieuw eventueel de bestanden bij Dossier). "}Of laad er een op: <input type="file" accept="application/pdf,.pdf" id="ov_file" style="width:auto;padding:2px"></small></div>
    <div class="field"><label for="ov_tot">Goedkeuren vóór</label><input id="ov_tot" name="geldig_tot" type="date" value="${addDays(todayIso, 14)}"></div>
    <div class="field"><label>Wie moet goedkeuren?</label>${uniek.length ? uniek.map(y => `<label class="chk"><input type="checkbox" name="tek" value="${y.c.id}" ${y.c.user_id ? (y.x.rol === "bouwheer" ? "checked" : "") : "disabled"}> <span>${esc(y.c.naam)} <small class="muted">${esc(y.x.rol)}${y.c.user_id ? "" : " · nog geen portaaltoegang"}</small></span></label>`).join("") : `<span class="muted">Koppel eerst een bouwheer (Dossier › Contacten) en geef hem portaaltoegang.</span>`}</div>
    <div class="field span2"><label for="ov_toel">Toelichting voor de klant (optioneel)</label><textarea id="ov_toel" name="toelichting" rows="2" placeholder="bv. Zoals besproken: de architectenovereenkomst voor de verbouwing."></textarea></div>
    <div class="field span2"><p class="muted" style="font-size:12px;margin:0">Het Planbord bewaart een vaste kopie van de pdf met zijn vingerafdruk (SHA-256): de klant keurt precies die versie goed. Iedere aangevinkte persoon krijgt een mail en keurt zelf goed met naam, vinkje en een code per mail.</p></div>
  </div>`, { wide: true, saveLabel: "Voorleggen", onSave: async (d) => ovVoorleggen(pid, d) });
}
async function ovVoorleggen(pid, d) {
  const p = S.projecten[pid]; const f = $("#mform"); const tek = [...f.querySelectorAll('input[name="tek"]:checked')].map(i => i.value);
  const file = $("#ov_file")?.files?.[0]; const docId = d.doc || "";
  if (!(d.titel || "").trim()) { toast("Geef een titel."); return false; }
  if (!docId && !file) { toast("Kies een pdf uit de projectmap of laad er een op."); return false; }
  if (!tek.length) { toast("Vink minstens één bouwheer met portaaltoegang aan."); return false; }
  const logins = tek.map(c => S.contacten[c]?.user_id).filter(Boolean);
  if (new Set(logins).size < logins.length) { toast("Twee gekozen bouwheren delen dezelfde login (hetzelfde e-mailadres). Iedere bouwheer heeft een eigen login nodig — vink er één aan of geef de andere een eigen e-mailadres.", 9000); return false; }
  loader.start("ov.nieuw", "Pdf ophalen…", 12000);
  try {
    let bytes, naam;
    if (file) { if (file.size > 30 * 1024 * 1024) throw new Error("De pdf is groter dan 30 MB."); bytes = new Uint8Array(await file.arrayBuffer()); naam = file.name; }
    else { const j = await driveCall("bestand", { id: docId, token: S.session?.access_token || "" }); if (!j.ok || !j.b64) throw new Error(j.error || "pdf niet gelezen"); if (j.mime !== "application/pdf") throw new Error("Dit is geen pdf."); const bin = atob(j.b64); bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); naam = j.naam || S.documenten[docId]?.naam || "overeenkomst.pdf"; }
    if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") throw new Error("Dit bestand is geen geldige pdf.");
    if (!/\.pdf$/i.test(naam)) naam += ".pdf";
    loader.step("Vaste kopie bewaren…");
    const sha = await ovSha(bytes); const gid = crypto.randomUUID(); const path = `${pid}/${gid}.pdf`;
    const up = await sb.storage.from("overeenkomsten").upload(path, new Blob([bytes], { type: "application/pdf" }), { contentType: "application/pdf", upsert: false });
    if (up.error) throw up.error;
    let g;
    try {
    g = await dbInsert("goedkeuringen", { id: gid, project_id: pid, soort: "overeenkomst", titel: d.titel.trim(), toelichting: (d.toelichting || "").trim(), geldig_tot: d.geldig_tot || null, status: "open", posten: [],
      totaal_excl: 0, btw: 0, totaal_incl: 0, voorgelegd_door: S.me.id, document_id: docId || null, bestand_path: path, bestand_naam: naam, bestand_sha256: sha, bestand_grootte: bytes.length });
    const { error } = await sb.from("goedkeuring_tekenaars").insert(tek.map(c => ({ goedkeuring_id: g.id, contact_id: c })));
    if (error) throw error;
    } catch (e) {   // alles of niets: geen open overeenkomst zonder bouwheren, geen losse kopie in de opslag
      if (g && g.id) { await sb.from("goedkeuringen").delete().eq("id", g.id); delete S.goedkeuringen[g.id]; }
      await sb.storage.from("overeenkomsten").remove([path]).catch(() => { });
      throw e;
    }
    await refetch("goedkeuring_tekenaars"); loader.done("ov.nieuw");
    if (driveReady()) driveCall("ovmail", { id: g.id, soort: "voorgelegd", token: S.session?.access_token || "" }).then(j => toast(`Mail gestuurd naar ${(j.naar || []).join(", ") || "niemand (geen portaaltoegang?)"}`, 6000)).catch(e => toast("Voorgelegd, maar mailen mislukte: " + e.message, 7000));
    else toast("Voorgelegd (niet gemaild: Drive-script niet ingesteld).");
  } catch (e) { loader.fail(); toast("Niet voorgelegd: " + (e.message || e), 8000); return false; }
}
async function ovOpen(gid) {
  const g = S.goedkeuringen[gid]; if (!g || !g.bestand_path) return; const w = window.open("", "_blank");
  const { data, error } = await sb.storage.from("overeenkomsten").createSignedUrl(g.bestand_path, 900);
  if (error || !data) { if (w) w.close(); toast("Pdf niet te openen: " + (error?.message || "onbekend"), 6000); return; }
  if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
}
function ovDetails(gid) {
  const g = S.goedkeuringen[gid]; if (!g) return; const ts = ovTek(gid);
  const wanneer = (x) => x ? new Date(x).toLocaleString("nl-BE", { timeZone: "Europe/Brussels" }) : "—";
  openModal("Akkoord — " + g.titel, `<p style="margin-top:0">Document: <b>${esc(g.bestand_naam)}</b> (${Math.round((g.bestand_grootte || 0) / 1024)} kB)<br><span class="muted" style="font-size:12px">SHA-256: <span class="num">${esc(g.bestand_sha256)}</span></span></p>
    <div class="tw"><table class="t"><thead><tr><th>Bouwheer</th><th>Naam (getypt)</th><th>Login</th><th>Tijdstip</th><th>IP-adres</th></tr></thead><tbody>${ts.map(t => `<tr><td>${esc(S.contacten[t.contact_id]?.naam || "?")}</td><td>${esc(t.beslist_naam)}</td><td>${esc(t.beslist_email)}</td><td class="num">${wanneer(t.beslist_op)}</td><td class="num" title="${esc(t.beslist_agent)}">${esc(t.beslist_ip || "—")}</td></tr>`).join("")}</tbody></table></div>
    <p class="muted" style="font-size:12px">Bevestigd met een eenmalige code per mail naar de login van elke bouwheer.</p>`, { saveLabel: "Sluiten", onSave: async () => { } });
}
async function ovIntrekken(gid) {
  const g = S.goedkeuringen[gid]; if (!g || !confirm(`"${g.titel}" intrekken? De klant kan ze dan niet meer goedkeuren.`)) return;
  try { await dbUpdate("goedkeuringen", gid, { status: "ingetrokken" }); toast("Ingetrokken"); } catch (e) { }
}
/* getekende pdf: de vaste kopie + akkoordpagina → Documenten/Overeenkomsten (gedeeld met de klant) */
const OV_BEZIG = new Set();
const ovTxt = (s) => String(s == null ? "" : s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...").replace(/[^\x20-\x7E\xA0-\xFF€]/g, "?");
async function ovGetekend(gid, stil) {
  const g = S.goedkeuringen[gid]; const p = g && S.projecten[g.project_id]; if (!g || !p || g.status !== "akkoord" || g.getekend_drive_id || OV_BEZIG.has(gid)) return;
  const alle = ovTek(gid); if (!alle.length || alle.some(t => t.status !== "akkoord")) { if (!stil) toast("Nog niet iedere bouwheer gaf zijn akkoord."); return; }
  if (!p.drive_folder_id || !driveReady()) { if (!stil) toast("Geen projectmap op Drive gekoppeld (of Drive-script niet ingesteld)."); return; }
  OV_BEZIG.add(gid);
  // claimen: maar één Planbord maakt de pdf
  const nu = new Date().toISOString();
  const claim = await sb.from("goedkeuringen").update({ getekend_op: nu }).eq("id", gid).is("getekend_drive_id", null).or(`getekend_op.is.null,getekend_op.lt.${new Date(Date.now() - 10 * 60000).toISOString()}`).select();
  if (claim.error || !(claim.data || []).length) { OV_BEZIG.delete(gid); if (!stil) toast("De getekende pdf wordt al gemaakt (door een ander Planbord)."); return; }
  if (!stil) loader.start("ov.teken", "Getekende pdf maken…", 15000);
  try {
    const dl = await sb.storage.from("overeenkomsten").download(g.bestand_path); if (dl.error) throw dl.error;
    const bytes = new Uint8Array(await dl.data.arrayBuffer());
    if (await ovSha(bytes) !== g.bestand_sha256) throw new Error("De bewaarde pdf komt niet overeen met de goedgekeurde versie (vingerafdruk).");
    const PDFLib = typeof tkLaadPdfLib === "function" ? await tkLaadPdfLib() : window.PDFLib; if (!PDFLib) throw new Error("pdf-lib niet geladen");
    const doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica), vet = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold), mono = await doc.embedFont(PDFLib.StandardFonts.Courier);
    const ts = ovTek(gid).filter(t => t.status === "akkoord").sort((a, b) => (a.beslist_op || "").localeCompare(b.beslist_op || ""));
    const blz = doc.getPageCount(); let pg = doc.addPage([595.28, 841.89]); let y = 790; const m = 56; const grijs = PDFLib.rgb(0.42, 0.44, 0.43);
    const regel = (t, o = {}) => { pg.drawText(ovTxt(t), { x: o.x || m, y, size: o.size || 10, font: o.font || font, color: o.color }); y -= o.na || 15; };
    const wanneer = (x) => x && !isNaN(new Date(x)) ? new Date(x).toLocaleString("nl-BE", { timeZone: "Europe/Brussels", dateStyle: "long", timeStyle: "medium" }) : "onbekend";
    const maker = S.profiles[g.voorgelegd_door];
    regel("BROS", { font: vet, size: 16, na: 26 }); regel("Akkoordverklaring", { font: vet, size: 18, na: 28 });
    regel("Overeenkomst: " + g.titel, { font: vet, size: 11, na: 17 });
    regel("Project: " + [p.nummer, p.klant, p.naam && p.naam !== p.klant ? p.naam : ""].filter(Boolean).join(" - "));
    regel("Document: " + g.bestand_naam + " (" + blz + " blz.)");
    regel("Voorgelegd door " + (maker ? maker.name : "BROS") + (g.voorgelegd_op ? " op " + wanneer(g.voorgelegd_op) : ""), { na: 22 });
    regel("Controlecode van het goedgekeurde document (SHA-256):", { color: grijs, size: 9, na: 13 });
    regel(g.bestand_sha256, { font: mono, size: 8.5, na: 28 });
    ts.forEach((t, i) => {
      if (y < 135) { pg = doc.addPage([595.28, 841.89]); y = 790; }   // meer bouwheren: verder op een volgende pagina
      regel((i + 1) + ". " + (S.contacten[t.contact_id]?.naam || ""), { font: vet, size: 11, na: 16 });
      regel("Naam zoals getypt: " + t.beslist_naam, { x: m + 14 });
      regel("Login (e-mail): " + t.beslist_email, { x: m + 14 });
      regel("Akkoord gegeven op: " + wanneer(t.beslist_op), { x: m + 14 });
      regel("IP-adres: " + (t.beslist_ip || "onbekend"), { x: m + 14 });
      regel("Browser: " + (t.beslist_agent || "onbekend").slice(0, 95), { x: m + 14, size: 8, color: grijs, na: 13 });
      regel("Bevestigd met een eenmalige code per mail en het vinkje 'Ik heb de overeenkomst gelezen en ga ermee akkoord'.", { x: m + 14, size: 8.5, color: grijs, na: 22 });
    });
    if (y < 50) { pg = doc.addPage([595.28, 841.89]); y = 790; } y = Math.min(y, 120);
    regel("Elektronisch goedgekeurd in het BROS-klantenportaal. Deze pagina hoort bij het voorgaande document; de controlecode", { size: 8.5, color: grijs, na: 12 });
    regel("hierboven identificeert de goedgekeurde versie (elke wijziging aan het document geeft een andere code).", { size: 8.5, color: grijs, na: 12 });
    const uit = await doc.save(); const datum = new Date().toLocaleDateString("nl-BE").replace(/\//g, "-");
    const naam = `${(g.titel || "Overeenkomst").replace(/[\\/:*?"<>|]/g, "-").slice(0, 120)} - goedgekeurd ${datum}.pdf`;
    if (!stil) loader.step("Bewaren in Documenten/Overeenkomsten…");
    const j = await driveCall("put", { folderId: p.drive_folder_id, subpath: "Documenten/Overeenkomsten", name: naam, base64: ovB64(uit), mime: "application/pdf" });
    const f = j.file; if (!f || !f.id) throw new Error("Drive gaf geen bestand terug.");
    // meteen als klaar markeren (Drive-id): ook als hierna iets mislukt of dit documentrecord later wegvalt (bestand verplaatst), komt er geen tweede pdf
    await dbUpdate("goedkeuringen", gid, { getekend_drive_id: f.id, getekend_op: new Date().toISOString() });
    const { data, error } = await sb.from("documenten").upsert([{ project_id: p.id, drive_id: f.id, naam: f.name, pad: f.path || "Documenten/Overeenkomsten", url: f.url, mime: "application/pdf", grootte: f.size || null, gewijzigd: f.updated || null, gesynct_op: new Date().toISOString() }], { onConflict: "project_id,drive_id" }).select();
    if (error) throw error; const d = data[0]; S.documenten[d.id] = d;
    await dbUpdate("goedkeuringen", gid, { getekend_document: d.id });
    // delen met de klant: zichtbaar in het portaal én de Drive-link leesbaar maken (zoals Documenten › Delen)
    await dbUpdate("documenten", d.id, { gedeeld: true }).catch(() => { });
    await driveCall("share", { fileId: f.id, on: true, token: S.session?.access_token || "" }).catch(e => toast("Getekende pdf bewaard, maar de link delen mislukte: " + e.message + " — deel ze via Dossier › Documenten.", 9000));
    if (!stil) { loader.done("ov.teken"); toast("Getekende pdf bewaard in Documenten/Overeenkomsten en gedeeld met de klant"); }
  } catch (e) {
    await sb.from("goedkeuringen").update({ getekend_op: null }).eq("id", gid).is("getekend_drive_id", null);
    if (!stil) { loader.fail(); toast("Getekende pdf niet gemaakt: " + (e.message || e), 8000); } else console.warn("Getekende pdf", gid, e);
  } finally { OV_BEZIG.delete(gid); }
}
/* automatisch: zodra het Planbord open staat en een overeenkomst volledig goedgekeurd is */
function ovAuto() {
  if (!ovReady() || !S.me || !["beheer", "medewerker"].includes(S.me.role) || !driveReady()) return;
  Object.values(S.goedkeuringen || {}).filter(g => g.soort === "overeenkomst" && g.status === "akkoord" && !g.getekend_drive_id && !(g.getekend_op && Date.now() - new Date(g.getekend_op).getTime() < 10 * 60000))
    .forEach(g => ovGetekend(g.id, true));
}
function ovAct(d, el, e) {
  if (d.act === "ov-new") { ovForm(d.pid); return true; }
  if (d.act === "ov-open") { if (e) e.preventDefault(); ovOpen(d.id); return true; }
  if (d.act === "ov-teken") { ovGetekend(d.id, false); return true; }
  if (d.act === "ov-details") { ovDetails(d.id); return true; }
  if (d.act === "ov-weg") { ovIntrekken(d.id); return true; }
  if (d.act === "ov-mail") { driveCall("ovmail", { id: d.id, soort: "voorgelegd", token: S.session?.access_token || "" }).then(j => toast(`Mail gestuurd naar ${(j.naar || []).join(", ") || "niemand"}`)).catch(err => toast("Mailen mislukt: " + err.message, 6000)); return true; }
  return false;
}
