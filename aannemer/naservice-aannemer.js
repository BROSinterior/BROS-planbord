/* =====================================================================
   BROS Aannemersportaal — Naservice (v1.77, script 069)
   De naservicepunten die BROS aan jou toewees: foto's en uitleg van de klant, een datum inplannen, het punt als
   opgelost melden (met foto's) en een bericht aan BROS. De volledige opvolging staat erbij.
   Geladen na aannemer.js; gebruikt naservice-weergave.js (NSW) en de helpers van aannemer.js.
   ===================================================================== */
const nsAanVan = (pid) => (D().nsPunten || []).filter(n => n.project_id === pid).sort((a, b) => (b.nr || 0) - (a.nr || 0));
const nsAanOpen = (pid) => nsAanVan(pid).filter(n => n.status === "aanvaard" || n.status === "ingepland");
function nsAanTab(p, badge) { return nsAanVan(p.id).length && typeof NSW === "object" ? [["naservice", "Naservice" + badge(nsAanOpen(p.id).length)]] : []; }
function vNaserviceAan(p) {
  const ps = nsAanVan(p.id); const open = ps.filter(n => n.status !== "afgesloten"), af = ps.filter(n => n.status === "afgesloten");
  return `<h1 style="margin-bottom:6px">Naservice</h1><p class="muted" style="margin-bottom:16px;max-width:680px">Punten die na de oplevering gemeld werden en die BROS aan jou toewees. Plan een datum in (de klant ziet die), en meld het punt als opgelost met een foto zodra het klaar is. BROS kijkt het na en sluit het af.</p>
    ${open.length ? `<div class="stack">${open.map(nsAanKaart).join("")}</div>` : `<div class="panel"><div class="empty"><b>Niets open</b>Er staat geen naservice voor jou open op dit project.</div></div>`}
    ${af.length ? `<h3 style="margin:22px 0 10px">Afgesloten <span class="muted" style="font-weight:400">${af.length}</span></h3><div class="stack">${af.map(nsAanKaart).join("")}</div>` : ""}`;
}
function nsAanKaart(n) {
  const evs = (D().nsTijdlijn || []).filter(x => x.punt_id === n.id); const kan = n.status === "aanvaard" || n.status === "ingepland";
  const fs = (n.fotos || []).filter(f => /^https:\/\//.test(f.url || ""));
  return `<div class="panel" id="nsa-${esc(n.id)}"${kan ? ' style="border-color:var(--blue)"' : ""}><div class="panel-head"><h2 style="font-size:17px">${esc(n.titel)} <span class="muted num" style="font-size:12px;font-weight:400">${NSW.nr(n)}</span></h2>${NSW.pill(n.status)}</div><div class="panel-body">
    <div class="muted" style="font-size:13px">${esc([n.ruimte, "gemeld op " + NSW.fmtKort(n.ontvangen_op)].filter(Boolean).join(" · "))}${n.prioriteit === "dringend" ? ` · <b style="color:var(--crit)">dringend</b>` : ""}${n.gepland_op ? ` · <b>herstelling op ${esc(NSW.fmt(n.gepland_op))}</b>` : ""}</div>
    ${NSW.stappen(n, evs)}
    ${n.omschrijving ? `<div style="white-space:pre-line;font-size:14px;margin-top:8px">${esc(n.omschrijving)}</div>` : ""}
    ${fs.length ? `<div class="ns-tl-fotos">${fs.map(f => `<a href="${esc(f.url)}" target="_blank" rel="noopener"><img src="${esc(f.url)}" alt=""></a>`).join("")}</div>` : ""}
    ${kan ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:14px">
      <form class="nsa-form" data-id="${esc(n.id)}" data-actie="ingepland" style="border:1px solid var(--line);border-radius:12px;padding:12px"><b style="font-size:14px">${n.gepland_op ? "Andere datum" : "Datum inplannen"}</b>
        <input type="date" name="datum" value="${esc(n.gepland_op || "")}" required style="display:block;margin:8px 0;width:100%"><input name="tekst" placeholder="Opmerking (optioneel)" style="width:100%"><button class="btn sm" type="submit" style="margin-top:8px">Inplannen</button><div class="msg"></div></form>
      <form class="nsa-form" data-id="${esc(n.id)}" data-actie="opgelost" style="border:1px solid var(--line);border-radius:12px;padding:12px"><b style="font-size:14px">Opgelost melden</b>
        <textarea name="tekst" rows="2" placeholder="Wat heb je gedaan?" style="width:100%;margin:8px 0"></textarea><input type="file" name="fotos" accept="image/*" multiple capture="environment"><button class="btn sm primary" type="submit" style="margin-top:8px">Opgelost</button><div class="msg"></div></form>
    </div>` : ""}
    <details style="margin-top:12px"${kan ? "" : ""}><summary style="cursor:pointer;font-weight:600;font-size:14px">Opvolging (${evs.length})</summary>${NSW.tijdlijn(evs)}
      ${n.status !== "afgesloten" ? `<form class="nsa-form" data-id="${esc(n.id)}" data-actie="bericht" style="margin-top:6px"><textarea name="tekst" rows="2" placeholder="Bericht aan BROS (bv. klant niet thuis, onderdeel besteld)" style="width:100%"></textarea><button class="btn sm" type="submit" style="margin-top:6px">Versturen</button><div class="msg"></div></form>` : ""}</details>
  </div></div>`;
}
function nsAanMail(id) { if (!cfg.driveScriptUrl) return; fetch(cfg.driveScriptUrl, { method: "POST", body: JSON.stringify({ action: "naservicemail", id, token: S.session?.access_token || "" }), redirect: "follow" }).catch(() => { }); }
document.addEventListener("submit", async (e) => {
  const f = e.target; if (!f || !f.classList || !f.classList.contains("nsa-form")) return; e.preventDefault();
  const n = (D().nsPunten || []).find(x => x.id === f.dataset.id); if (!n) return; const act = f.dataset.actie; const m = f.querySelector(".msg");
  const tekst = (f.tekst && f.tekst.value || "").trim(); const datum = f.datum ? f.datum.value : null;
  if (act === "ingepland" && !datum) { m.textContent = "Kies een datum."; return; }
  if (act === "bericht" && tekst.length < 2) { m.textContent = "Schrijf een bericht."; return; }
  if (act === "opgelost" && !confirm("Je meldt dit punt als opgelost. BROS kijkt het na en sluit het af — de klant ziet je melding.")) return;
  f.querySelectorAll("button").forEach(b => b.disabled = true); m.textContent = "Even geduld…";
  try {
    const fotos = []; const files = f.fotos ? [...(f.fotos.files || [])].slice(0, 10) : [];
    for (let i = 0; i < files.length; i++) { m.textContent = `Foto ${i + 1}/${files.length} uploaden…`; const x = await upload(n.project_id, "aannemer", await verklein(files[i])); fotos.push({ path: x.path, url: x.url, w: x.w, h: x.h }); }
    const { error } = await sb.rpc("naservice_actie", { p_punt: n.id, p_actie: act, p_tekst: tekst, p_datum: datum, p_fotos: fotos });
    if (error) throw new Error(error.message);
    nsAanMail(n.id);
    try { await loadAll(); } catch (x) { } render();   // niet via vernieuw(true): die tekent niet over ingevulde velden heen
    toast({ ingepland: "Ingepland — BROS en de klant zien de datum.", opgelost: "Gemeld als opgelost — BROS kijkt het na.", bericht: "Bericht verstuurd naar BROS." }[act] || "Bewaard", 5000);
  } catch (err) { m.textContent = "Dat lukte niet: " + (err.message || err); f.querySelectorAll("button").forEach(b => b.disabled = false); }
});
