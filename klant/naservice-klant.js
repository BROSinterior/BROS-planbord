/* =====================================================================
   BROS Klantenportaal — Naservice (v1.77, script 069)
   Na de voorlopige oplevering: de lijn tot de definitieve oplevering, een probleem melden met foto's, en per punt
   de stappen en de volledige opvolging (wie deed wat en wanneer). Reageren of een foto toevoegen kan per punt.
   Geladen na portaal.js; gebruikt naservice-weergave.js (NSW) en de helpers van portaal.js.
   ===================================================================== */
const nsOplVan = (p) => (D().nsOpl || []).find(o => o.project_id === p.id) || null;
const nsProj = (p) => { const o = nsOplVan(p); return o ? { ...p, voorlopig_opgeleverd_op: o.voorlopig_opgeleverd_op, oplevering_termijn_maanden: o.oplevering_termijn_maanden, definitief_opgeleverd_op: o.definitief_opgeleverd_op } : null; };
const nsPuntenVan = (p) => (D().nsPunten || []).filter(n => n.project_id === p.id).sort((a, b) => (b.nr || 0) - (a.nr || 0));
const nsTlVan = (f) => (D().nsTijdlijn || []).filter(f);
const nsKlantOpen = (n) => n.status !== "afgesloten" && n.status !== "geweigerd";
function nsKlantTab(p) {
  if (!nsOplVan(p) || typeof NSW !== "object") return [];
  const n = nsPuntenVan(p).filter(nsKlantOpen).length;
  return [["naservice", "Naservice" + (n ? ` <span class="badge" style="background:var(--muted)">${n}</span>` : "")]];
}
function nsWelkom(p) {
  const o = nsOplVan(p); if (!o || typeof NSW !== "object" || o.definitief_opgeleverd_op) return "";
  return `<div class="notice" style="border-color:var(--blue);background:var(--blue-soft)"><div><b>Je woning is voorlopig opgeleverd</b><div class="muted" style="font-size:13px">Zie je iets dat niet in orde is? Meld het met een foto — je volgt hier elke stap tot het opgelost is.</div></div><button class="btn primary" data-tab="naservice">Naservice →</button></div>`;
}
function vNaserviceKlant(p) {
  const pp = nsProj(p); if (!pp || typeof NSW !== "object") return vWelkom(p);
  const ps = nsPuntenVan(p); const o = NSW.oplevering(pp); const ruimtes = [...new Set(ps.map(n => n.ruimte).filter(Boolean))].sort();
  const pv = nsOplVan(p).definitief_pv_document && D().documenten.find(d => d.id === nsOplVan(p).definitief_pv_document);
  const groep = (titel, lijst) => lijst.length ? `<h3 style="margin:22px 0 10px">${titel} <span class="muted" style="font-weight:400">${lijst.length}</span></h3><div class="stack">${lijst.map(nsKlantKaart).join("")}</div>` : "";
  return `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap"><div><h1 style="margin-bottom:6px">Naservice</h1>
      <p class="muted" style="margin-bottom:16px;max-width:640px">${o.loopt ? "Je woning is voorlopig opgeleverd. Zie je iets dat niet in orde is, meld het hier met een foto. BROS bekijkt het, schakelt zo nodig de juiste vakman in en je volgt hier elke stap." : "Je woning is definitief opgeleverd. Zie je toch nog iets, meld het hier: BROS bekijkt het."}</p></div>
      ${S.nsNieuw ? "" : `<button class="btn primary" data-act="ns-nieuw">Probleem melden</button>`}</div>
    ${NSW.balk(pp, ps, { attr: (n) => `data-act="ns-ga" data-id="${n.id}"` })}
    ${pv ? `<p style="margin:10px 0 0"><a class="btn sm" href="${esc(safeUrl(pv.url))}" target="_blank" rel="noopener" data-doc-open="${esc(pv.id)}">Proces-verbaal van de definitieve oplevering (pdf)</a></p>` : ""}
    ${S.nsNieuw ? `<div class="panel" style="margin:16px 0"><div class="panel-head"><h2>Probleem melden</h2></div><form id="nsForm" class="panel-body kp-form" style="max-width:640px">
      <label class="field">Wat is er? (korte titel)<input name="titel" maxlength="160" required placeholder="bv. De lade van de keukenkast sluit niet meer"></label>
      <label class="field">Omschrijving — waar, sinds wanneer, wat zie je?<textarea name="omschrijving" rows="3" maxlength="4000"></textarea></label>
      <label class="field">Ruimte<input name="ruimte" maxlength="120" list="ns_ruimtes" placeholder="bv. Keuken"><datalist id="ns_ruimtes">${ruimtes.map(r => `<option value="${esc(r)}">`).join("")}</datalist></label>
      <label class="field">Foto's — een foto maakt het voor iedereen duidelijk (max. 6)<input type="file" name="fotos" accept="image/*" multiple capture="environment"></label>
      <div class="gk-actions"><button class="btn primary" type="submit">Versturen</button><button class="btn" type="button" data-act="ns-nieuw">Annuleren</button></div><div class="msg"></div></form></div>` : ""}
    ${ps.length ? groep("Wordt opgevolgd", ps.filter(nsKlantOpen)) + groep("Afgehandeld", ps.filter(n => !nsKlantOpen(n)))
      : `<div class="panel" style="margin-top:16px"><div class="empty"><b>Nog niets gemeld</b>Alles wat je hier meldt — en wat je ons per mail of telefoon laat weten — vind je hier terug met de volledige opvolging.</div></div>`}
    ${nsTlVan(x => x.project_id === p.id && !x.punt_id).length ? `<h3 style="margin:26px 0 8px">Oplevering</h3><div class="panel"><div class="panel-body">${NSW.tijdlijn(nsTlVan(x => x.project_id === p.id && !x.punt_id), { foto: (f) => fotoUrl(f.url) })}</div></div>` : ""}`;
}
function nsKlantKaart(n) {
  const evs = nsTlVan(x => x.punt_id === n.id); const open = S.nsOpen && S.nsOpen[n.id];
  return `<div class="panel" id="ns-${esc(n.id)}"><div class="panel-body">
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><div><b>${nt(n.titel)}</b> <span class="muted num" style="font-size:12px">${NSW.nr(n)}</span>${n.door_mij ? ` <span class="pill grijs" style="font-size:11px">door jou gemeld</span>` : ""}
      <div class="muted" style="font-size:13px">${esc([n.ruimte, "gemeld " + NSW.bronTekst(n.bron) + " op " + NSW.fmtKort(n.ontvangen_op)].filter(Boolean).join(" · "))}${n.uitvoerder && nsKlantOpen(n) ? " · vakman: " + esc(n.uitvoerder) : ""}${n.gepland_op && n.status === "ingepland" ? ` · <b>herstelling op ${esc(NSW.fmt(n.gepland_op))}</b>` : ""}</div></div>${NSW.pill(n.status)}</div>
    ${NSW.stappen(n, evs)}
    ${n.omschrijving ? `<div style="font-size:14px;white-space:pre-line;margin-top:8px">${nt(n.omschrijving)}</div>` : ""}${fotoStrip(n.fotos)}
    <details style="margin-top:10px" ${open ? "open" : ""} data-ns-det="${esc(n.id)}"><summary style="cursor:pointer;font-weight:600;font-size:14px">Opvolging (${evs.length})</summary>
      ${NSW.tijdlijn(evs, { foto: (f) => fotoUrl(f.url) })}
      <form class="ns-reactie kp-form" data-id="${esc(n.id)}" style="margin-top:6px"><label class="field">${n.status === "opgelost" ? "Is het in orde? Laat het weten" : "Iets toevoegen (bericht of foto)"}<textarea name="tekst" rows="2" maxlength="4000"></textarea></label>
        <label class="field">Foto's (optioneel)<input type="file" name="fotos" accept="image/*" multiple></label>
        <div class="gk-actions"><button class="btn sm" type="submit">Versturen</button></div><div class="msg"></div></form>
    </details></div></div>`;
}
function nsKlantMail(id) { if (!cfg.driveScriptUrl) return; fetch(cfg.driveScriptUrl, { method: "POST", body: JSON.stringify({ action: "naservicemail", id, token: S.session?.access_token || "" }), redirect: "follow" }).catch(() => { }); }
document.addEventListener("toggle", (e) => { const d = e.target; if (d && d.dataset && d.dataset.nsDet) { S.nsOpen = S.nsOpen || {}; S.nsOpen[d.dataset.nsDet] = d.open; } }, true);
document.addEventListener("click", (e) => {
  const el = e.target.closest && e.target.closest("[data-act]"); if (!el || !S.ready) return;
  if (el.dataset.act === "ns-nieuw") { S.nsNieuw = !S.nsNieuw; render(true); if (S.nsNieuw) setTimeout(() => { const i = document.querySelector("#nsForm input[name=titel]"); if (i) i.focus(); }, 30); }
  if (el.dataset.act === "ns-ga") { S.nsOpen = S.nsOpen || {}; S.nsOpen[el.dataset.id] = true; render(true); const k = document.getElementById("ns-" + el.dataset.id); if (k) k.scrollIntoView({ behavior: "smooth", block: "start" }); }
});
document.addEventListener("submit", async (e) => {
  const f = e.target; const p = S.ready ? P() : null; if (!p || !f) return;
  if (f.id !== "nsForm" && !(f.classList && f.classList.contains("ns-reactie"))) return;
  e.preventDefault(); const m = f.querySelector(".msg");
  if (f.id === "nsForm" && f.titel.value.trim().length < 3) { m.className = "msg err"; m.textContent = "Geef een korte titel (minstens 3 tekens)."; return; }
  if (f.id !== "nsForm" && f.tekst.value.trim().length < 2 && !(f.querySelector('input[type="file"]').files || []).length) { m.className = "msg err"; m.textContent = "Schrijf een bericht of voeg een foto toe."; return; }
  f.querySelectorAll("button").forEach(b => b.disabled = true); m.className = "msg"; m.textContent = "Even geduld…"; S.gkBezig = true;
  try {
    const fotos = await fotosUit(f, p, m); let id;
    if (f.id === "nsForm") {
      const { data, error } = await sb.rpc("naservice_melden", { p_project: p.id, p_titel: f.titel.value.trim(), p_omschrijving: f.omschrijving.value.trim(), p_ruimte: f.ruimte.value.trim(), p_fotos: fotos });
      if (error) throw new Error(error.message); id = data; S.nsNieuw = false;
    } else {
      id = f.dataset.id;
      const { error } = await sb.rpc("naservice_actie", { p_punt: id, p_actie: "bericht", p_tekst: f.tekst.value.trim(), p_fotos: fotos });
      if (error) throw new Error(error.message); S.nsOpen = S.nsOpen || {}; S.nsOpen[id] = true;
    }
    nsKlantMail(id);
    try { await loadAll(true); } catch (x) { } render(true);
    toast(f.id === "nsForm" ? "Je melding is verstuurd — BROS bekijkt ze. Je krijgt een bevestiging per mail." : "Verstuurd — BROS ziet je bericht.", 6000);
  } catch (err) { m.className = "msg err"; m.textContent = "Dat lukte niet: " + (err.message || err); f.querySelectorAll("button").forEach(b => b.disabled = false); }
  finally { S.gkBezig = false; }
});
