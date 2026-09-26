/* =====================================================================
   BROS Aannemersportaal — wat een aannemer/leverancier van zijn projecten ziet en doet
   Leest uitsluitend de aan_*-views (databasescript 025): enkel de projecten en loten waaraan hij gekoppeld is,
   nooit prijzen van BROS of van andere aannemers. Schrijven gaat via functies (opgelost melden, prijzen, vragen).
   ===================================================================== */
const PORTAAL_VERSION = "1.24.12";
const todayLocal = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; };
const safeUrl = (u) => /^https?:\/\//i.test(String(u || "")) ? u : "#";
const cfg = window.PLANBORD_CONFIG || {};
const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = (n, dec = 2) => Number(n || 0).toLocaleString("nl-BE", { style: "currency", currency: "EUR", minimumFractionDigits: dec, maximumFractionDigits: dec });
const nl = (n, dec = 2) => Number(n || 0).toLocaleString("nl-BE", { minimumFractionDigits: 0, maximumFractionDigits: dec });
const fmt = (s) => { if (!s) return "—"; const [y, m, d] = s.slice(0, 10).split("-"); return `${d}/${m}/${y}`; };
const MAAND = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const fmtLang = (s) => { if (!s) return "—"; const d = new Date(s.slice(0, 10) + "T00:00:00"); return `${d.getDate()} ${MAAND[d.getMonth()]} ${d.getFullYear()}`; };
const PROJ_STATUS = { offerte: "In offerte", lopend: "In uitvoering", on_hold: "Even gepauzeerd", afgerond: "Opgeleverd", verloren: "Niet doorgegaan" };
const VS_STATUS = { open: "Open", opgelost: "Opgelost — wacht op controle", gecontroleerd: "Gecontroleerd", vervallen: "Vervallen" };
const PA_STATUS = { open: "In te vullen", ingediend: "Ingediend", gekozen: "Gekozen", afgesloten: "Afgesloten" };
const VR_STATUS = { open: "In behandeling", bevestigd: "Opgenomen als taak", geweigerd: "Beantwoord / niet weerhouden" };
const ONDERWERP = { planning: "Planning en uitvoering", documenten: "Plannen en documenten", ontwerp: "Ontwerp en materialen", facturatie: "Facturatie", klacht: "Probleem op de werf", overig: "Iets anders" };
const ROL = { aannemer: "Aannemer", leverancier: "Leverancier", architect: "Architect", studiebureau: "Studiebureau", andere: "Andere" };
const URL_AUTH = (() => {
  const h = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  const q = location.search.startsWith("?") ? location.search.slice(1) : "";
  const p = new URLSearchParams(h.includes("=") ? h : q);
  const err = p.get("error_description") || p.get("error_code") || p.get("error") || "";
  if (err) history.replaceState(null, "", location.pathname);
  return { type: p.get("type") || "", error: err };
})();

const S = { session: null, me: null, ready: false, loadError: null, setPassword: false, tab: "overzicht", project: null, data: null, vsFilter: "open", detail: null, aanvraag: null, nieuw: [], bezig: false };
let loginNotice = URL_AUTH.error ? (/expired|invalid|otp/i.test(URL_AUTH.error) ? "Deze link is vervallen of al gebruikt. Log in met je wachtwoord, of vraag hieronder een nieuwe link aan." : "Er ging iets mis met de link: " + URL_AUTH.error) : "";
function toast(msg, ms = 3500) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), ms); }

/* ---------- gegevens ---------- */
async function loadAll() {
  const q = (v, sel = "*", opt = false) => sb.from(v).select(sel).then(r => { if (r.error) { if (opt) return []; throw new Error(v + ": " + r.error.message); } return r.data || []; });
  const [me, projecten, vs, plannen, verslagen, documenten, planning, planTaken, taken, aanvragen, aanvraagPosten, vragen, team, ik, fasen, loten, inst] = await Promise.all([
    sb.from("profiles").select("id,name,email,role").eq("id", S.session.user.id).maybeSingle().then(r => r.data),
    q("aan_project"), q("aan_vaststellingen"), q("aan_werfplannen"), q("aan_werfverslagen"), q("aan_documenten"), q("aan_planning"), q("aan_planning_taken"),
    q("aan_taken"), q("aan_prijsaanvragen"), q("aan_prijsaanvraag_posten"), q("aan_vragen"), q("klant_team", "*", true), q("klant_ik", "*", true),
    q("fasen"), sb.from("loten_v").select("nr,naam").then(r => r.error ? [] : (r.data || [])),
    sb.from("instellingen").select("value").eq("key", "portaal").maybeSingle().then(r => r.data?.value || {}),
  ]);
  S.me = me;
  S.data = { projecten: projecten.sort((a, b) => (b.nummer || "").localeCompare(a.nummer || "")), vs: vs.sort((a, b) => (b.nr || 0) - (a.nr || 0)), plannen: plannen.sort((a, b) => (a.volgorde || 0) - (b.volgorde || 0)),
    verslagen: verslagen.sort((a, b) => (b.nr || 0) - (a.nr || 0)), documenten, planning, planTaken, taken, aanvragen: aanvragen.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")), aanvraagPosten, vragen: vragen.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    team, ik, fasen: fasen.filter(f => f.actief !== false).sort((a, b) => a.nr - b.nr), loten: Object.fromEntries(loten.map(l => [l.nr, l])), inst };
  if (!S.project || !projecten.some(p => p.id === S.project)) S.project = projecten[0]?.id || null;
  sb.rpc("portaal_bezoek").then(() => { });
}
const D = () => S.data;
const P = () => D().projecten.find(p => p.id === S.project);
const voornaam = () => { const n = (S.me?.name || D().ik[0]?.naam || "").trim(); return n.split(/\s+/)[0] || n; };
const lotNaam = (nr) => D().loten[nr] ? `${nr}. ${D().loten[nr].naam}` : String(nr);
const faseNaam = (nr) => D().fasen.find(f => f.nr === nr)?.naam || "";
const vsOf = (pid) => D().vs.filter(v => v.project_id === pid);
const vsNr = (v) => "V-" + String(v.nr || 0).padStart(3, "0");
const isLate = (v) => v.status === "open" && v.deadline && v.deadline < todayLocal();
const vsPill = (v) => isLate(v) ? `<span class="pill late">Te laat · ${fmt(v.deadline)}</span>` : `<span class="pill ${v.status}">${VS_STATUS[v.status] || v.status}</span>`;
const plan = (id) => D().plannen.find(x => x.id === id);
const pinHtml = (v, cls = "") => v.plan_x == null ? "" : `<span class="pin ${cls || v.status}" data-vs="${v.id}" style="left:${Number(v.plan_x) * 100}%;top:${Number(v.plan_y) * 100}%" title="${esc(vsNr(v))}">${v.nr || "•"}</span>`;

/* ---------- foto's (verkleind naar max 1600 px, jpeg) ---------- */
async function verklein(file, max = 1600, q = 0.82) {
  let img = null, tmp = null;
  if (window.createImageBitmap) img = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (!img) img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Foto niet leesbaar")); tmp = URL.createObjectURL(file); i.src = tmp; });
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  if (tmp) URL.revokeObjectURL(tmp); if (img.close) img.close();
  return new Promise(r => c.toBlob(b => r({ blob: b, w: c.width, h: c.height, url: URL.createObjectURL(b) }), "image/jpeg", q));
}
async function upload(pid, vid, f) {
  const path = `${pid}/${vid}/aannemer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
  const { error } = await sb.storage.from("werf").upload(path, f.blob, { contentType: "image/jpeg" });
  if (error) throw error;
  return { path, url: sb.storage.from("werf").getPublicUrl(path).data.publicUrl, w: f.w, h: f.h, op: new Date().toISOString(), door: "aannemer" };
}

/* ---------- weergave ---------- */
function render() {
  if (!S.session) return renderLogin();
  if (S.setPassword) return renderSetPassword();
  if (!S.ready) { $("#app").innerHTML = S.loadError ? `<div class="login"><div class="card"><h1>Even geen verbinding</h1><p>${esc(S.loadError)}</p><button class="btn primary" onclick="location.reload()">Opnieuw proberen</button></div></div>` : `<div class="loading">Je portaal wordt geladen…</div>`; return; }
  if (S.me && S.me.role !== "aannemer") { $("#app").innerHTML = `<div class="login"><div class="card"><div class="brand" style="margin-bottom:14px"><span class="mark">BROS</span><span class="name">Aannemersportaal</span></div><h1>Dit is het aannemersportaal</h1><p>Je bent ingelogd als ${S.me.role === "klant" ? "klant" : "teamlid"} (${esc(S.me.email || "")}).</p><p><a class="btn primary" href="${S.me.role === "klant" ? "../klant/" : "../"}">${S.me.role === "klant" ? "Naar het klantenportaal" : "Naar het Planbord"}</a> <button class="btn ghost" data-act="logout">Uitloggen</button></p></div></div>`; return; }
  if (!D().projecten.length) { $("#app").innerHTML = `<div class="login"><div class="card"><div class="brand" style="margin-bottom:14px"><span class="mark">BROS</span><span class="name">Aannemersportaal</span></div><h1>Nog geen project gekoppeld</h1><p>Je login werkt, maar er is nog geen project aan je gekoppeld. Laat het ons weten via ${esc(D().inst.contact_email || "info@bros.be")}.</p><p><button class="btn ghost" data-act="logout">Uitloggen</button></p></div></div>`; return; }
  const p = P(); const vs = vsOf(p.id);
  const nOpen = vs.filter(v => v.status === "open").length, nPa = D().aanvragen.filter(a => a.project_id === p.id && a.status === "open").length, nTk = D().taken.filter(t => t.project_id === p.id && !t.vaststelling_id && t.status !== "done").length;
  const badge = (n) => n ? ` <span class="badge">${n}</span>` : "";
  const tabs = [["overzicht", "Overzicht"], ["werf", "Werfpunten" + badge(nOpen)], ["prijzen", "Prijsaanvragen" + badge(nPa)], ["plannen", "Plannen"], ["documenten", "Documenten"], ["planning", "Planning"], ["vragen", "Vragen" + badge(nTk)], ["team", "Wie is wie"]];
  $("#app").innerHTML = `<header class="top"><div class="top-in"><div class="brand"><span class="mark">BROS</span><span class="name">Aannemersportaal</span></div>
      <div class="who">${D().projecten.length > 1 ? `<select id="projSel" class="btn sm">${D().projecten.map(x => `<option value="${x.id}" ${x.id === p.id ? "selected" : ""}>${esc(x.nummer ? x.nummer + " · " : "")}${esc(x.klant || x.naam)}</option>`).join("")}</select>` : ""}<span>${esc(S.me?.name || "")}</span><button class="btn ghost sm" data-act="logout">Uitloggen</button></div></div>
    <nav class="tabs">${tabs.map(([k, l]) => `<button class="${S.tab === k ? "on" : ""}" data-tab="${k}">${l}</button>`).join("")}</nav></header>
    <main>${(({ overzicht: vOverzicht, werf: vWerf, prijzen: vPrijzen, plannen: vPlannen, documenten: vDocumenten, planning: vPlanning, vragen: vVragen, team: vTeam })[S.tab] || vOverzicht)(p)}</main>`;
  window.scrollTo({ top: 0 });
}
const projTitel = (p) => `${esc(p.klant || "")}${p.naam && p.naam !== p.klant ? " · " + esc(p.naam) : ""}`;
function vOverzicht(p) {
  const vs = vsOf(p.id); const open = vs.filter(v => v.status === "open"), late = open.filter(isLate), wacht = vs.filter(v => v.status === "opgelost");
  const pa = D().aanvragen.filter(a => a.project_id === p.id && a.status === "open"); const tk = D().taken.filter(t => t.project_id === p.id && !t.vaststelling_id && t.status !== "done");
  const lead = D().team.find(t => t.id === p.lead); const inst = D().inst;
  return `<div class="hero"><div class="eyebrow">${esc(p.nummer || "")} · ${projTitel(p)}${(p.mijn_loten || []).length ? ` · ${p.mijn_loten.map(lotNaam).map(esc).join(", ")}` : ""}</div><h1>Dag ${esc(voornaam())}</h1>
      <p class="lead">${esc(inst.welkom_aannemer || "Hier vind je alles voor jouw werk op dit project: de open werfpunten, de plannen, de verslagen en de prijsaanvragen van BROS.")}</p></div>
    <div class="kpis"><button class="kpi" data-tab="werf" style="text-align:left;cursor:pointer;font:inherit;color:inherit"><div class="k">Open werfpunten</div><div class="v num" style="${late.length ? "color:var(--crit)" : ""}">${open.length}</div><div class="muted" style="font-size:12px">${late.length ? late.length + " over de datum" : wacht.length ? wacht.length + " wacht op controle door BROS" : "niets dringend"}</div></button>
      <button class="kpi" data-tab="prijzen" style="text-align:left;cursor:pointer;font:inherit;color:inherit"><div class="k">Prijsaanvragen</div><div class="v num">${pa.length}</div><div class="muted" style="font-size:12px">${pa.length ? "in te vullen" + (pa.some(a => a.deadline) ? " · vóór " + fmt(pa.filter(a => a.deadline).sort((a, b) => a.deadline.localeCompare(b.deadline))[0].deadline) : "") : "geen open aanvragen"}</div></button>
      <button class="kpi" data-tab="vragen" style="text-align:left;cursor:pointer;font:inherit;color:inherit"><div class="k">Actiepunten</div><div class="v num">${tk.length}</div><div class="muted" style="font-size:12px">${tk.length ? "uit verslagen en afspraken" : "alles afgewerkt"}</div></button>
      <div class="kpi"><div class="k">Project</div><div class="v" style="font-size:16px">${PROJ_STATUS[p.status] || esc(p.status)}</div><div class="muted" style="font-size:12px">${p.fase_nr ? "stap " + p.fase_nr + " · " + esc(faseNaam(p.fase_nr)) : ""}</div></div></div>
    <div class="two"><div class="stack">
      <div class="panel"><div class="panel-head"><h2>Open werfpunten</h2><button class="btn sm" data-tab="werf">Alles →</button></div>${open.length ? `<div class="panel-body" style="display:grid;gap:8px">${open.slice(0, 5).map(vsCard).join("")}</div>` : `<div class="empty"><b>Geen open punten</b>Nieuwe vaststellingen van BROS verschijnen hier.</div>`}</div>
      ${pa.length ? `<div class="panel" style="border-color:var(--blue)"><div class="panel-head"><h2>Prijsaanvraag in te vullen</h2></div><div class="panel-body">${pa.map(a => `<p><b>${esc(a.titel || "Prijsaanvraag")}</b> · ${a.loten.map(lotNaam).map(esc).join(", ")}${a.deadline ? ` · vóór ${fmt(a.deadline)}` : ""} <button class="btn sm primary" data-act="pa-open" data-id="${a.id}">Invullen →</button></p>`).join("")}</div></div>` : ""}
    </div><div class="stack">
      <div class="panel"><div class="panel-head"><h2>Werf</h2></div><div class="panel-body"><p><b>${projTitel(p)}</b></p><p class="muted" style="font-size:14px">${esc([p.adres, [p.postcode, p.gemeente].filter(Boolean).join(" ")].filter(Boolean).join(", "))}</p>${p.start || p.eind ? `<p class="muted" style="font-size:13px">${p.start ? "gestart " + fmtLang(p.start) : ""}${p.eind ? " · geplande oplevering " + fmtLang(p.eind) : ""}</p>` : ""}</div></div>
      ${lead ? `<div class="panel"><div class="panel-head"><h2>Je aanspreekpunt bij BROS</h2></div><div class="panel-body"><div class="person">${avatar(lead, 56)}<div><b>${esc(lead.name)}</b><div class="muted" style="font-size:13px">${esc(lead.functie || "BROS")}</div></div></div></div></div>` : ""}
      <div class="panel"><div class="panel-head"><h2>Op de werf?</h2></div><div class="panel-body"><p style="font-size:14px">Open de <a href="../werf/">werfmodus</a> op je smartphone: je punten met foto, ook zonder bereik. Zet ze op je beginscherm als app.</p><p class="muted" style="font-size:13px;white-space:pre-line">${esc(inst.contact || "")}</p></div></div>
    </div></div>`;
}
function vsCard(v) {
  return `<button class="vs ${v.status === "gecontroleerd" || v.status === "vervallen" ? "dim" : ""}" data-act="vs-open" data-id="${v.id}">${(v.fotos || [])[0] ? `<img class="th" src="${esc(safeUrl(v.fotos[0].url))}" alt="">` : `<div class="th">geen foto</div>`}<div class="bd"><div class="hd"><span class="nr">${vsNr(v)}</span>${v.prioriteit === "hoog" ? `<span class="pill late">dringend</span>` : ""}${vsPill(v)}</div><div class="tx">${v.titel ? `<b>${esc(v.titel)}</b>${v.omschrijving ? ` <span class="muted">${esc(v.omschrijving.slice(0, 140))}${v.omschrijving.length > 140 ? "…" : ""}</span>` : ""}` : esc(v.omschrijving || "—")}</div><div class="mt">${[v.ruimte, v.lot ? lotNaam(v.lot) : "", v.deadline && !isLate(v) ? "tegen " + fmt(v.deadline) : "", v.bezoek_datum ? "werfbezoek " + fmt(v.bezoek_datum) : ""].filter(Boolean).map(esc).join(" · ")}</div></div></button>`;
}
function vWerf(p) {
  if (S.detail) return vDetail(p);
  const all = vsOf(p.id); const f = S.vsFilter;
  const list = all.filter(v => f === "open" ? v.status === "open" : f === "opgelost" ? v.status === "opgelost" : true);
  const n = (k) => all.filter(v => k === "alle" ? true : v.status === k).length;
  return `<h1 style="margin-bottom:6px">Werfpunten</h1><p class="muted" style="margin-bottom:16px">Vaststellingen die BROS aan jou toewees. Meld een punt als opgelost met een bewijsfoto; BROS controleert het daarna op de werf.</p>
    <div class="chips">${[["open", `Open ${n("open")}`], ["opgelost", `Wacht op controle ${n("opgelost")}`], ["alle", `Alles ${n("alle")}`]].map(([k, l]) => `<button class="chip" data-act="vs-filter" data-f="${k}" aria-current="${f === k}">${l}</button>`).join("")}</div>
    ${list.length ? `<div style="display:grid;gap:8px">${list.map(vsCard).join("")}</div>` : `<div class="panel"><div class="empty"><b>${all.length ? "Niets in deze lijst" : "Nog geen werfpunten"}</b>${all.length ? "" : "Zodra BROS je een vaststelling toewijst, staat ze hier."}</div></div>`}`;
}
function vDetail(p) {
  const v = vsOf(p.id).find(x => x.id === S.detail); if (!v) { S.detail = null; return vWerf(p); }
  const fotos = v.fotos || [], bewijs = v.opgelost_fotos || []; const pl = v.plan_id ? plan(v.plan_id) : null;
  return `<button class="back" data-act="vs-back">‹ Alle werfpunten</button>
    ${fotos.length ? `<div class="gallery">${fotos.map(f => `<img src="${esc(safeUrl(f.url))}" alt="" data-lb="${esc(safeUrl(f.url))}">`).join("")}</div>` : ""}
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap"><span class="nr" style="font-size:18px">${vsNr(v)}</span>${v.prioriteit === "hoog" ? `<span class="pill late">Dringend</span>` : ""}${vsPill(v)}</div>
    ${v.titel ? `<h1 style="margin:0 0 6px">${esc(v.titel)}</h1>` : ""}<p style="font-size:16px;white-space:pre-wrap">${esc(v.omschrijving || "")}</p>
    <div class="meta" style="margin-bottom:16px">${v.ruimte ? `<div>Ruimte: <b>${esc(v.ruimte)}</b></div>` : ""}${v.lot ? `<div>Lot: <b>${esc(lotNaam(v.lot))}</b></div>` : ""}${v.deadline ? `<div>Op te lossen tegen: <b class="${isLate(v) ? "late" : ""}">${fmtLang(v.deadline)}</b></div>` : ""}${v.bezoek_datum ? `<div>Vastgesteld bij het werfbezoek van <b>${fmtLang(v.bezoek_datum)}</b></div>` : ""}${v.opgelost_op ? `<div>Opgelost gemeld op <b>${fmtLang(v.opgelost_op.slice(0, 10))}</b></div>` : ""}${v.opmerking ? `<div>Opmerking: <b>${esc(v.opmerking)}</b></div>` : ""}</div>
    <div class="two"><div class="stack">
      ${v.status === "open" ? `<div class="panel" style="border-color:var(--ink)"><div class="panel-head"><h2>Opgelost melden</h2></div><div class="panel-body">
        <div class="big"><label>📷<span></span>Foto nemen<input type="file" accept="image/*" capture="environment" hidden data-file></label><label>🖼️<span></span>Uit galerij<input type="file" accept="image/*" multiple hidden data-file></label></div>
        <div class="fotos" id="f_fotos">${S.nieuw.map((f, i) => `<div class="fi"><img src="${f.url}" alt=""><button type="button" class="x" data-x="${i}">✕</button></div>`).join("")}</div>
        <div class="field" style="margin-top:12px"><label for="f_opm">Opmerking (optioneel)</label><textarea id="f_opm" rows="2" placeholder="bv. Scharnier vervangen en deur bijgesteld">${esc(S.opm || "")}</textarea></div>
        <div class="gk-actions"><button class="btn primary" data-act="vs-opgelost" data-id="${v.id}" ${S.bezig ? "disabled" : ""}>${S.bezig ? "Bezig…" : "✓ Opgelost melden"}</button><button class="btn" data-act="vs-foto" data-id="${v.id}" ${S.bezig || !S.nieuw.length && !(S.opm || "").trim() ? "disabled" : ""}>Enkel foto/opmerking toevoegen</button></div>
        <p class="muted" style="font-size:12px;margin:10px 0 0">Een bewijsfoto is niet verplicht, maar helpt BROS om het punt sneller af te sluiten.</p></div></div>` : v.status === "opgelost" ? `<div class="panel"><div class="panel-body"><b>Gemeld als opgelost.</b> BROS controleert dit punt bij het volgende werfbezoek. Wil je nog een foto of opmerking toevoegen?
        <div class="big" style="margin-top:12px"><label>📷<span></span>Foto toevoegen<input type="file" accept="image/*" multiple hidden data-file></label></div><div class="fotos" id="f_fotos">${S.nieuw.map((f, i) => `<div class="fi"><img src="${f.url}" alt=""><button type="button" class="x" data-x="${i}">✕</button></div>`).join("")}</div>
        <div class="field" style="margin-top:12px"><label for="f_opm">Opmerking</label><textarea id="f_opm" rows="2">${esc(S.opm || "")}</textarea></div><button class="btn" data-act="vs-foto" data-id="${v.id}" ${S.bezig ? "disabled" : ""}>Toevoegen</button></div></div>` : ""}
      ${bewijs.length ? `<div class="panel"><div class="panel-head"><h2>Bewijsfoto's</h2></div><div class="panel-body"><div class="fotos">${bewijs.map(f => `<img src="${esc(safeUrl(f.url))}" alt="" data-lb="${esc(safeUrl(f.url))}">`).join("")}</div></div></div>` : ""}
    </div><div class="stack">
      ${pl && v.plan_x != null ? `<div class="panel"><div class="panel-head"><h2>Op het plan</h2><span class="muted" style="font-size:13px">${esc(pl.naam)}</span></div><div class="panel-body"><div class="plan-wrap"><img src="${esc(safeUrl(pl.url))}" alt="">${pinHtml(v)}</div></div></div>` : ""}
    </div></div>`;
}
function vPlannen(p) {
  const pls = D().plannen.filter(x => x.project_id === p.id); const vs = vsOf(p.id);
  return `<h1 style="margin-bottom:6px">Plannen</h1><p class="muted" style="margin-bottom:16px">De werfplannen van dit project met de plaats van jouw punten (rood open, oranje opgelost, groen gecontroleerd). Klik op een nummer om het punt te openen; klik op het plan om het groot te bekijken.</p>
    ${pls.length ? `<div class="plans">${pls.map(pl => { const pins = vs.filter(v => v.plan_id === pl.id && v.plan_x != null && v.status !== "vervallen"); return `<div class="panel"><div class="panel-head"><h3>${esc(pl.naam)}</h3><span class="muted" style="font-size:13px">${pins.length} punt${pins.length === 1 ? "" : "en"}</span></div><div class="panel-body"><div class="plan-wrap"><img src="${esc(safeUrl(pl.url))}" alt="" data-lb="${esc(safeUrl(pl.url))}" style="cursor:zoom-in">${pins.map(v => pinHtml(v)).join("")}</div></div></div>`; }).join("")}</div>` : `<div class="panel"><div class="empty"><b>Nog geen plannen</b>Zodra BROS plannen toevoegt aan de werfopvolging, vind je ze hier.</div></div>`}`;
}
function vDocumenten(p) {
  const ws = D().verslagen.filter(w => w.project_id === p.id);
  const docs = D().documenten.filter(d => d.project_id === p.id).sort((a, b) => (a.pad || "").localeCompare(b.pad || "") || (b.gewijzigd || "").localeCompare(a.gewijzigd || ""));
  const ext = (n) => (n.match(/\.([a-z0-9]{2,5})$/i) || [, "doc"])[1].toUpperCase(); const size = (b) => !b ? "" : b > 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.round(b / 1e3) + " kB";
  const groups = [...new Set(docs.map(d => d.pad || ""))];
  return `<h1 style="margin-bottom:6px">Documenten en verslagen</h1><p class="muted" style="margin-bottom:16px">Werfverslagen die je ontving en de plannen en documenten die BROS met de aannemers deelt — altijd de laatste versie.</p>
    ${ws.length ? `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h2>Werfverslagen</h2></div><table class="t"><tbody>${ws.map(w => `<tr><td class="num" style="width:60px">${w.nr}</td><td><b>${esc(w.titel || "Werfverslag " + w.nr)}</b><div class="muted" style="font-size:13px">${fmtLang(w.datum)} · ${w.punten} punt${w.punten === 1 ? "" : "en"}</div></td><td class="r"><a class="btn sm" href="${esc(safeUrl(w.pdf_url))}" target="_blank" rel="noopener">Pdf openen</a></td></tr>`).join("")}</tbody></table></div>` : ""}
    ${docs.length ? `<div class="stack">${groups.map(g => `<div class="panel"><div class="panel-head"><h3>${esc(g.replace(/\//g, " › ") || "Algemeen")}</h3></div><div class="panel-body" style="padding-top:4px;padding-bottom:4px">${docs.filter(d => (d.pad || "") === g).map(d => `<a class="doc" href="${esc(safeUrl(d.url))}" target="_blank" rel="noopener"><span class="ic">${esc(ext(d.naam))}</span><span><div class="nm">${esc(d.naam)}</div><small>${d.gewijzigd ? fmt(d.gewijzigd) : ""}${d.grootte ? " · " + size(d.grootte) : ""}</small></span></a>`).join("")}</div></div>`).join("")}</div>` : `<div class="panel"><div class="empty"><b>Nog geen documenten gedeeld</b>Zodra BROS plannen of documenten voor de aannemers klaarzet, verschijnen ze hier.</div></div>`}`;
}
function vPlanning(p) {
  const fasen = D().fasen; const plan = Object.fromEntries(D().planning.filter(x => x.project_id === p.id).map(x => [x.fase_nr, x])); const nu = p.fase_nr;
  const dates = Object.values(plan).flatMap(x => [x.start, x.eind]).concat(D().planTaken.filter(t => t.project_id === p.id).flatMap(t => [t.start, t.eind])).filter(Boolean).sort(); const t0 = dates[0] ? new Date(dates[0]) : null, t1 = dates[dates.length - 1] ? new Date(dates[dates.length - 1]) : null; const span = t0 && t1 ? Math.max(1, t1 - t0) : 1;
  const bar = (a, b, done, op = "") => a && b && t0 ? `<div class="bar"><i class="${done ? "done" : ""}" style="left:${Math.round((new Date(a) - t0) / span * 100)}%;width:${Math.max(2, Math.round((new Date(b) - new Date(a)) / span * 100))}%;${op}"></i></div>` : "";
  return `<h1 style="margin-bottom:6px">Planning</h1><p class="muted" style="margin-bottom:16px">De stappen van het project en de timing die BROS deelt. Data zijn een planning en kunnen nog schuiven; je eigen start- en einddatum spreek je af met je aanspreekpunt.</p>
    <div class="panel"><div class="tw"><table class="t"><thead><tr><th>Stap</th><th>Van</th><th>Tot</th><th style="min-width:180px">Verloop</th><th>Status</th></tr></thead><tbody>
      ${fasen.map(f => { const pl = plan[f.nr]; const st = p.status === "afgerond" || (nu != null && f.nr < nu) ? "done" : f.nr === nu ? "now" : "todo";
        const taken = D().planTaken.filter(t => t.project_id === p.id && (t.fase_nr || 0) === f.nr).sort((a, b) => (a.volgorde ?? 0) - (b.volgorde ?? 0) || (a.start || "9").localeCompare(b.start || "9"));
        return `<tr style="${st === "todo" ? "color:var(--muted)" : ""}"><td><b>${f.nr}. ${esc(f.naam)}</b>${pl && pl.opmerking ? `<div class="muted" style="font-size:12px">${esc(pl.opmerking)}</div>` : ""}</td><td class="num">${pl ? fmt(pl.start) : "—"}</td><td class="num">${pl ? fmt(pl.eind) : "—"}</td><td>${pl ? bar(pl.start, pl.eind, st === "done") : ""}</td><td>${st === "done" ? `<span class="pill akkoord">Klaar</span>` : st === "now" ? `<span class="pill meerwerk">Nu bezig</span>` : `<span class="pill grijs">Nog te doen</span>`}</td></tr>` +
          taken.map(t => `<tr class="sub" style="${t.status === "done" ? "color:var(--muted)" : ""}"><td style="padding-left:28px">↳ ${esc(t.titel)}</td><td class="num">${fmt(t.start)}</td><td class="num">${fmt(t.eind)}</td><td>${bar(t.start, t.eind, t.status === "done", "opacity:.55")}</td><td>${t.status === "done" ? `<span class="pill akkoord">Klaar</span>` : t.status === "busy" ? `<span class="pill meerwerk">Bezig</span>` : `<span class="pill grijs">Gepland</span>`}</td></tr>`).join(""); }).join("")}
    </tbody></table></div></div>`;
}
/* ---------- prijsaanvragen ---------- */
function vPrijzen(p) {
  const as = D().aanvragen.filter(a => a.project_id === p.id);
  if (S.aanvraag) { const a = as.find(x => x.id === S.aanvraag); if (a) return vAanvraag(p, a); S.aanvraag = null; }
  return `<h1 style="margin-bottom:6px">Prijsaanvragen</h1><p class="muted" style="margin-bottom:16px">BROS vraagt je per lot een eenheidsprijs per post (excl. btw, inclusief levering en plaatsing tenzij anders vermeld). Je vult in, bewaart tussendoor en dient in zodra alles klopt.</p>
    ${as.length ? `<div class="panel"><table class="t"><thead><tr><th>Aanvraag</th><th>Loten</th><th>Reageren vóór</th><th>Status</th><th></th></tr></thead><tbody>${as.map(a => { const ps = D().aanvraagPosten.filter(x => x.aanvraag_id === a.id); const ing = ps.filter(x => x.eenheidsprijs != null).length; return `<tr><td><b>${esc(a.titel || "Prijsaanvraag")}</b><div class="muted" style="font-size:12px">${fmt(a.created_at)} · ${ing} van ${ps.length} posten ingevuld</div></td><td>${a.loten.map(lotNaam).map(esc).join("<br>")}</td><td class="num ${a.status === "open" && a.deadline && a.deadline < todayLocal() ? "late" : ""}">${a.deadline ? fmt(a.deadline) : "—"}</td><td><span class="pill ${a.status}">${PA_STATUS[a.status]}</span></td><td class="r"><button class="btn sm ${a.status === "open" ? "primary" : ""}" data-act="pa-open" data-id="${a.id}">${a.status === "open" ? "Invullen" : "Bekijken"}</button></td></tr>`; }).join("")}</tbody></table></div>` : `<div class="panel"><div class="empty"><b>Nog geen prijsaanvragen</b>Zodra BROS je een prijsaanvraag stuurt, vul je ze hier in.</div></div>`}`;
}
function vAanvraag(p, a) {
  const ps = D().aanvraagPosten.filter(x => x.aanvraag_id === a.id).sort((x, y) => x.lot - y.lot || (x.volgorde ?? 0) - (y.volgorde ?? 0) || (x.code || "").localeCompare(y.code || ""));
  const rw = a.status === "open" || a.status === "ingediend"; const lots = [...new Set(ps.map(x => x.lot))];
  const tot = ps.reduce((s, x) => s + (x.eenheidsprijs != null ? Number(x.eenheidsprijs) * Number(x.hoeveelheid || 0) : 0), 0); const ing = ps.filter(x => x.eenheidsprijs != null).length;
  return `<button class="back" data-act="pa-back">‹ Alle prijsaanvragen</button>
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start;margin-bottom:12px"><div><h1 style="margin-bottom:4px">${esc(a.titel || "Prijsaanvraag")}</h1><div class="muted">${projTitel(p)} · ${a.loten.map(lotNaam).map(esc).join(", ")}${a.deadline ? ` · reageren vóór <b class="${a.status === "open" && a.deadline < todayLocal() ? "late" : ""}">${fmtLang(a.deadline)}</b>` : ""}</div></div><span class="pill ${a.status}" style="font-size:13px">${PA_STATUS[a.status]}</span></div>
    ${a.bericht ? `<div class="panel" style="margin-bottom:16px"><div class="panel-body" style="white-space:pre-line">${esc(a.bericht)}</div></div>` : ""}
    ${a.status === "gekozen" ? `<div class="notice" style="border-color:var(--ok);background:var(--ok-soft)"><div><b>BROS heeft je prijzen weerhouden.</b> Bedankt — je aanspreekpunt neemt contact op over de verdere afspraken.</div></div>` : a.status === "ingediend" ? `<div class="notice" style="border-color:var(--blue);background:var(--blue-soft)"><div><b>Ingediend op ${fmt(a.ingediend_op)}.</b> Je kan je prijzen nog aanpassen tot BROS een keuze maakt; dien dan opnieuw in.</div></div>` : ""}
    <div class="kpis"><div class="kpi"><div class="k">Ingevuld</div><div class="v num">${ing} / ${ps.length}</div></div><div class="kpi"><div class="k">Totaal van je prijzen</div><div class="v num">${eur(tot, 0)}</div><div class="muted" style="font-size:12px">excl. btw, op basis van de vermoedelijke hoeveelheden</div></div></div>
    ${lots.map(lot => { const rs = ps.filter(x => x.lot === lot); let groep = null; const som = rs.reduce((s, x) => s + (x.eenheidsprijs != null ? Number(x.eenheidsprijs) * Number(x.hoeveelheid || 0) : 0), 0);
      return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h3>${esc(lotNaam(lot))}</h3><span class="num" style="font-weight:700">${eur(som)}</span></div><div class="tw"><table class="t"><thead><tr><th style="width:60px">Nr</th><th>Omschrijving</th><th class="r">Hoev.</th><th class="r">Eenheidsprijs</th><th class="r">Totaal</th><th>Opmerking</th></tr></thead><tbody>
        ${rs.map(r => { const isGroep = !Number(r.hoeveelheid) && !r.code && (r.groep || r.omschrijving); let g = ""; if (r.groep && r.groep !== groep) { groep = r.groep; g = `<tr class="groep"><td colspan="6">${esc(r.groep)}</td></tr>`; } if (isGroep && !r.groep) return `<tr class="groep"><td colspan="6">${esc(r.omschrijving)}</td></tr>`;
          return g + `<tr><td class="num muted" style="font-size:12px">${esc(r.code)}</td><td>${esc(r.omschrijving).replace(/\n/g, "<br>")}${r.locatie ? `<div class="muted" style="font-size:12px">${esc(r.locatie)}</div>` : ""}</td><td class="r num">${Number(r.hoeveelheid) ? nl(r.hoeveelheid, 2) + " " + esc(r.eenheid) : esc(r.eenheid || "")}</td><td class="r">${rw ? `<input class="prijs" type="number" step="0.01" min="0" inputmode="decimal" data-pa="${a.id}" data-post="${r.post_id}" data-f="prijs" value="${r.eenheidsprijs == null ? "" : Number(r.eenheidsprijs)}" placeholder="€">` : `<span class="num">${r.eenheidsprijs == null ? "—" : eur(r.eenheidsprijs)}</span>`}</td><td class="r num">${r.eenheidsprijs != null && Number(r.hoeveelheid) ? eur(Number(r.eenheidsprijs) * Number(r.hoeveelheid)) : ""}</td><td>${rw ? `<input class="opm" data-pa="${a.id}" data-post="${r.post_id}" data-f="opm" value="${esc(r.opmerking || "")}" placeholder="bv. andere afmeting, alternatief…">` : esc(r.opmerking || "")}</td></tr>`; }).join("")}
      </tbody></table></div></div>`; }).join("")}
    ${rw ? `<div class="panel" style="border-color:var(--ink)"><div class="panel-body"><h2 style="margin-bottom:8px">${a.status === "ingediend" ? "Opnieuw indienen" : "Indienen bij BROS"}</h2><p class="muted" style="font-size:14px">Prijzen worden bewaard zodra je een veld verlaat. Klaar? Dien in — BROS krijgt dan een melding.</p>
      <div class="field"><label for="pa_opm">Opmerking bij je prijsopgave (levertermijn, voorwaarden, geldigheid…)</label><textarea id="pa_opm" rows="3">${esc(a.opmerking || "")}</textarea></div>
      <button class="btn primary" data-act="pa-indienen" data-id="${a.id}" ${S.bezig ? "disabled" : ""}>${S.bezig ? "Bezig…" : a.status === "ingediend" ? "Opnieuw indienen" : "Prijsopgave indienen"}</button><span class="msg" id="pa_msg" style="margin-left:10px"></span></div></div>` : a.opmerking ? `<div class="panel"><div class="panel-body"><b>Je opmerking:</b> ${esc(a.opmerking)}</div></div>` : ""}`;
}
async function prijsBewaar(inp) {
  const r = D().aanvraagPosten.find(x => x.aanvraag_id === inp.dataset.pa && x.post_id === inp.dataset.post); if (!r) return;
  const row = $(`input.prijs[data-pa="${inp.dataset.pa}"][data-post="${inp.dataset.post}"]`), opm = $(`input.opm[data-pa="${inp.dataset.pa}"][data-post="${inp.dataset.post}"]`);
  const prijs = row && row.value !== "" ? Number(row.value) : null; const o = opm ? opm.value.trim() : "";
  if (prijs === (r.eenheidsprijs == null ? null : Number(r.eenheidsprijs)) && o === (r.opmerking || "")) return;
  if (prijs != null && (isNaN(prijs) || prijs < 0)) { toast("Geef een geldige prijs."); return; }
  const { error } = await sb.rpc("prijs_invullen", { p_aanvraag: inp.dataset.pa, p_post: inp.dataset.post, p_prijs: prijs, p_opmerking: o });
  if (error) { toast("Niet bewaard: " + error.message, 5000); return; }
  r.eenheidsprijs = prijs; r.opmerking = o;
  // totalen verversen zonder de invoer te verstoren
  const focus = document.activeElement; const id = focus && focus.dataset ? focus.dataset.pa + "|" + focus.dataset.post + "|" + focus.dataset.f : null;
  render(); if (id) { const el = document.querySelector(`input[data-pa="${focus.dataset.pa}"][data-post="${focus.dataset.post}"][data-f="${focus.dataset.f}"]`); if (el) { el.focus(); } }
}
/* ---------- vragen en actiepunten ---------- */
function vVragen(p) {
  const tk = D().taken.filter(t => t.project_id === p.id && !t.vaststelling_id).sort((a, b) => (a.status === "done") - (b.status === "done") || (a.eind || "9").localeCompare(b.eind || "9"));
  const vr = D().vragen.filter(v => v.project_id === p.id);
  return `<h1 style="margin-bottom:6px">Vragen en actiepunten</h1><p class="muted" style="margin-bottom:16px">Stel een vraag of meld iets aan BROS: het komt bij de juiste persoon terecht. Hieronder ook de actiepunten die BROS voor jou noteerde.</p>
    <div class="two"><div class="stack">
      <div class="panel"><div class="panel-head"><h2>Vraag of melding voor BROS</h2></div><div class="panel-body"><form id="vraagForm">
        <div class="field"><label for="vr_onderwerp">Waarover gaat het?</label><select id="vr_onderwerp" name="onderwerp">${Object.entries(ONDERWERP).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></div>
        <div class="field"><label for="vr_titel">Kort samengevat</label><input id="vr_titel" name="titel" required maxlength="120" placeholder="bv. Startdatum plaatsing keuken bevestigen"></div>
        <div class="field"><label for="vr_tekst">Toelichting</label><textarea id="vr_tekst" name="tekst" rows="4" placeholder="Wat wil je weten of melden? Vermeld ruimte, lot of plan als dat helpt."></textarea></div>
        <button class="btn primary" type="submit" ${S.bezig ? "disabled" : ""}>${S.bezig ? "Bezig…" : "Versturen naar BROS"}</button></form></div></div>
      ${vr.length ? `<div class="panel"><div class="panel-head"><h2>Je eerdere vragen</h2></div><table class="t"><tbody>${vr.map(v => `<tr><td><b>${esc(v.titel)}</b><div class="muted" style="font-size:13px">${fmt(v.created_at)} · ${ONDERWERP[v.onderwerp] || esc(v.onderwerp)}</div>${v.vraag ? `<div style="font-size:13px;margin-top:4px;white-space:pre-line">${esc(v.vraag)}</div>` : ""}${v.status === "geweigerd" && v.reden ? `<div style="font-size:13px;margin-top:6px;padding:8px 10px;background:var(--surface-2);border-radius:8px"><b>Antwoord van BROS:</b> ${esc(v.reden)}</div>` : ""}</td><td style="width:1%"><span class="pill ${v.status}">${VR_STATUS[v.status] || esc(v.status)}</span></td></tr>`).join("")}</tbody></table></div>` : ""}
    </div><div class="stack">
      <div class="panel"><div class="panel-head"><h2>Jouw actiepunten</h2><span class="muted" style="font-size:13px">${tk.filter(t => t.status !== "done").length} open</span></div>${tk.length ? `<table class="t"><tbody>${tk.map(t => `<tr style="${t.status === "done" ? "opacity:.55" : ""}"><td style="width:34px"><input type="checkbox" data-taak="${t.id}" ${t.status === "done" ? "checked" : ""} style="width:18px;height:18px"></td><td>${esc(t.titel)}${t.notitie_titel ? `<div class="muted" style="font-size:12px">uit: ${esc(t.notitie_titel)}</div>` : ""}</td><td class="num muted" style="font-size:13px;${t.status !== "done" && t.eind && t.eind < todayLocal() ? "color:var(--crit)" : ""}">${t.eind ? fmt(t.eind) : ""}</td></tr>`).join("")}</tbody></table>` : `<div class="empty"><b>Geen actiepunten</b>Afspraken uit verslagen die BROS aan jou toewijst, staan hier.</div>`}</div>
    </div></div>`;
}
async function vraagVersturen(p, d) {
  S.bezig = true; render();
  const { data, error } = await sb.rpc("aannemer_vraag", { p_project: p.id, p_titel: d.titel, p_tekst: d.tekst, p_onderwerp: d.onderwerp });
  if (error) { S.bezig = false; render(); toast("Dat lukte niet: " + error.message, 5000); return; }
  if (cfg.driveScriptUrl && data) { try { await fetch(cfg.driveScriptUrl, { method: "POST", body: JSON.stringify({ action: "voorstelmail", id: data.id, token: S.session?.access_token || "" }), redirect: "follow" }); } catch (e) { } }
  try { await loadAll(); } catch (e) { }
  S.bezig = false; render(); toast("Verstuurd — BROS neemt het op en komt bij je terug.", 5000);
}
async function vsMelden(id, opgelost) {
  const v = D().vs.find(x => x.id === id); if (!v) return;
  S.bezig = true; render();
  try {
    const fotos = []; for (const f of S.nieuw) fotos.push(await upload(v.project_id, v.id, f));
    const { error } = await sb.rpc("aannemer_vaststelling_melden", { p_id: id, p_status: opgelost ? "opgelost" : null, p_opmerking: (S.opm || "").trim() || null, p_fotos: fotos });
    if (error) throw error;
    S.nieuw.forEach(f => URL.revokeObjectURL(f.url)); S.nieuw = []; S.opm = "";
    await loadAll(); toast(opgelost ? "Gemeld als opgelost — BROS controleert het bij het volgende werfbezoek." : "Toegevoegd.", 5000);
  } catch (e) { toast("Dat lukte niet: " + (e.message || e), 6000); }
  S.bezig = false; render();
}
function vTeam() {
  const team = D().team.slice().sort((a, b) => a.name.localeCompare(b.name));
  return `<h1 style="margin-bottom:6px">Wie is wie</h1><p class="muted" style="margin-bottom:16px">Het BROS-team van dit project.</p>
    ${team.length ? `<div class="team">${team.map(t => `<div class="card">${t.foto_url ? `<img class="foto" src="${esc(safeUrl(t.foto_url))}" alt="${esc(t.name)}">` : `<div class="nofoto" style="background:${esc(t.color || "#2A4DD0")}">${esc(t.initials)}</div>`}<div class="body"><h3>${esc(t.name)}</h3><div class="fn">${esc(t.functie || "BROS")}</div><div class="bio">${esc(t.bio || "")}</div></div></div>`).join("")}</div>` : `<div class="panel"><div class="empty">Binnenkort stellen we het team hier aan je voor.</div></div>`}`;
}
function avatar(t, size = 40) { return t.foto_url ? `<img class="avatar" style="width:${size}px;height:${size}px" src="${esc(safeUrl(t.foto_url))}" alt="">` : `<span class="avatar" style="width:${size}px;height:${size}px;background:${esc(t.color || "#2A4DD0")};font-size:${Math.round(size / 3)}px">${esc(t.initials || "")}</span>`; }

/* ---------- login / wachtwoord ---------- */
function renderLogin() {
  $("#app").innerHTML = `<div class="login"><div class="card">
    <div class="brand" style="margin-bottom:14px"><span class="mark">BROS</span><span class="name">Aannemersportaal</span></div>
    <h1>Inloggen</h1><p>Je werfpunten, plannen, verslagen en prijsaanvragen van BROS.</p>
    <form id="loginForm"><div class="field"><label for="email">E-mailadres</label><input id="email" type="email" required autocomplete="username" placeholder="naam@bedrijf.be"></div>
    <div class="field"><label for="password">Wachtwoord</label><input id="password" type="password" required autocomplete="current-password"></div>
    <button class="btn primary" type="submit" id="loginBtn" style="width:100%;justify-content:center">Inloggen</button></form>
    <div class="msg${loginNotice ? " err" : ""}" id="loginMsg">${esc(loginNotice)}</div>
    <p style="margin:14px 0 0;font-size:13px"><button class="btn ghost sm" type="button" id="loginForgot">Wachtwoord vergeten of nog geen wachtwoord?</button></p></div></div>`;
  $("#loginForgot").onclick = async () => {
    loginNotice = ""; const email = $("#email").value.trim(); const m = $("#loginMsg"); m.className = "msg"; m.textContent = "";
    if (!email) { m.className = "msg err"; m.textContent = "Vul eerst je e-mailadres in."; $("#email").focus(); return; }
    $("#loginForgot").disabled = true; let error = null;
    if (cfg.driveScriptUrl) { try { const r = await fetch(cfg.driveScriptUrl, { method: "POST", body: JSON.stringify({ action: "reset", email }), redirect: "follow" }); const j = await r.json(); if (!j.ok) error = { message: j.error || "onbekende fout" }; } catch (e) { error = e; } }
    else ({ error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }));
    if (error) { m.className = "msg err"; m.textContent = "Dat lukte niet: " + error.message; $("#loginForgot").disabled = false; }
    else m.textContent = "Als dit adres bij ons bekend is, krijg je zo een mail (kijk ook bij ongewenste mail). Klik op de link en kies een wachtwoord.";
  };
  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault(); loginNotice = ""; const btn = $("#loginBtn"); btn.disabled = true; const m = $("#loginMsg"); m.className = "msg"; m.textContent = "";
    const { error } = await sb.auth.signInWithPassword({ email: $("#email").value.trim(), password: $("#password").value });
    if (error) { m.className = "msg err"; m.textContent = /invalid/i.test(error.message) ? "E-mailadres of wachtwoord klopt niet." : "Dat lukte niet: " + error.message; btn.disabled = false; }
  };
}
function renderSetPassword() {
  const email = S.session?.user?.email || "";
  $("#app").innerHTML = `<div class="login"><div class="card">
    <div class="brand" style="margin-bottom:14px"><span class="mark">BROS</span><span class="name">Aannemersportaal</span></div>
    <h1>Kies een wachtwoord</h1><p>Welkom${email ? ", " + esc(email) : ""}. Kies een wachtwoord waarmee je voortaan inlogt.</p>
    <form id="pwForm"><div class="field"><label for="pw1">Nieuw wachtwoord</label><input id="pw1" type="password" required minlength="8" autocomplete="new-password" placeholder="minstens 8 tekens"></div>
      <div class="field"><label for="pw2">Nog eens, ter controle</label><input id="pw2" type="password" required minlength="8" autocomplete="new-password"></div>
      <button class="btn primary" type="submit" id="pwBtn" style="width:100%;justify-content:center">Opslaan en binnengaan</button></form>
    <div class="msg" id="pwMsg"></div></div></div>`;
  $("#pw1").focus();
  $("#pwForm").onsubmit = async (e) => {
    e.preventDefault(); const m = $("#pwMsg"); m.className = "msg"; m.textContent = ""; const a = $("#pw1").value, b = $("#pw2").value;
    if (a.length < 8) { m.className = "msg err"; m.textContent = "Kies minstens 8 tekens."; return; }
    if (a !== b) { m.className = "msg err"; m.textContent = "De twee wachtwoorden zijn niet gelijk."; return; }
    $("#pwBtn").disabled = true;
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) { m.className = "msg err"; m.textContent = "Dat lukte niet: " + error.message; $("#pwBtn").disabled = false; return; }
    history.replaceState(null, "", location.pathname); S.setPassword = false; start();
  };
}

/* ---------- gebeurtenissen ---------- */
document.addEventListener("click", async (e) => {
  if (e.target.dataset && e.target.dataset.lb) { const lb = $("#lb"); lb.innerHTML = `<img src="${esc(e.target.dataset.lb)}" alt="">`; lb.classList.add("show"); return; }
  if (e.target.closest("#lb")) { $("#lb").classList.remove("show"); return; }
  const pin = e.target.closest(".pin[data-vs]"); if (pin) { S.tab = "werf"; S.detail = pin.dataset.vs; S.nieuw = []; S.opm = ""; render(); return; }
  const el = e.target.closest("[data-tab],[data-act]"); if (!el) return; const d = el.dataset;
  if (d.tab) { S.tab = d.tab; S.detail = null; S.aanvraag = null; render(); return; }
  if (d.act === "logout") sb.auth.signOut().then(() => location.reload());
  if (d.act === "vs-filter") { S.vsFilter = d.f; render(); }
  if (d.act === "vs-open") { S.tab = "werf"; S.detail = d.id; S.nieuw = []; S.opm = ""; render(); }
  if (d.act === "vs-back") { S.detail = null; S.nieuw.forEach(f => URL.revokeObjectURL(f.url)); S.nieuw = []; render(); }
  if (d.act === "vs-opgelost") { if (S.bezig) return; if (!S.nieuw.length && !confirm("Geen bewijsfoto toegevoegd. Toch als opgelost melden?")) return; await vsMelden(d.id, true); }
  if (d.act === "vs-foto") { if (S.bezig) return; await vsMelden(d.id, false); }
  if (d.act === "pa-open") { S.tab = "prijzen"; S.aanvraag = d.id; render(); }
  if (d.act === "pa-back") { S.aanvraag = null; render(); }
  if (d.act === "pa-indienen") {
    if (S.bezig) return; const a = D().aanvragen.find(x => x.id === d.id); if (!a) return;
    const ps = D().aanvraagPosten.filter(x => x.aanvraag_id === a.id && Number(x.hoeveelheid)); const leeg = ps.filter(x => x.eenheidsprijs == null).length;
    if (leeg && !confirm(`${leeg} van ${ps.length} posten hebben nog geen prijs. Toch indienen? (Posten zonder prijs neemt BROS niet mee.)`)) return;
    S.bezig = true; render();
    const { error } = await sb.rpc("prijsaanvraag_indienen", { p_id: a.id, p_opmerking: ($("#pa_opm") ? $("#pa_opm").value : a.opmerking || "").trim() });
    if (error) { S.bezig = false; render(); toast("Dat lukte niet: " + error.message, 5000); return; }
    if (cfg.driveScriptUrl) { try { await fetch(cfg.driveScriptUrl, { method: "POST", body: JSON.stringify({ action: "prijsaanvraagmail", id: a.id, soort: "ingediend", token: S.session?.access_token || "" }), redirect: "follow" }); } catch (x) { } }
    try { await loadAll(); } catch (x) { } S.bezig = false; render(); toast("Ingediend — bedankt! BROS bekijkt je prijzen.", 5000);
  }
  if (e.target.closest(".x[data-x]")) { const i = Number(e.target.closest(".x").dataset.x); URL.revokeObjectURL(S.nieuw[i].url); S.nieuw.splice(i, 1); render(); }
});
document.addEventListener("submit", (e) => {
  if (e.target.id === "vraagForm") { e.preventDefault(); if (S.bezig) return; const f = new FormData(e.target); const titel = String(f.get("titel") || "").trim(); if (!titel) return; vraagVersturen(P(), { titel, tekst: String(f.get("tekst") || "").trim(), onderwerp: String(f.get("onderwerp") || "overig") }); }
});
document.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.id === "projSel") { S.project = t.value; S.detail = null; S.aanvraag = null; render(); return; }
  if (t.hasAttribute("data-file")) {
    for (const file of [...t.files]) { try { S.nieuw.push(await verklein(file)); } catch (err) { toast("Foto niet bruikbaar"); } }
    t.value = ""; S.opm = $("#f_opm") ? $("#f_opm").value : S.opm; render(); return;
  }
  if (t.dataset.pa) { await prijsBewaar(t); return; }
  if (t.dataset.taak) { const id = t.dataset.taak, klaar = t.checked; t.disabled = true;
    const { error } = await sb.rpc("klant_taak_klaar", { p_id: id, p_klaar: klaar });
    if (error) { toast("Dat lukte niet: " + error.message); t.checked = !klaar; t.disabled = false; return; }
    D().taken.forEach(x => { if (x.id === id) x.status = klaar ? "done" : "todo"; }); render(); toast(klaar ? "Afgevinkt — bedankt!" : "Weer open gezet"); }
});
document.addEventListener("input", (e) => { if (e.target.id === "f_opm") S.opm = e.target.value; });
document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches && e.target.matches("input.prijs, input.opm")) { e.preventDefault(); e.target.blur(); } });

async function start() {
  S.ready = false; render();
  try { await loadAll(); S.ready = true; S.loadError = null; render(); }
  catch (e) { S.loadError = e.message || String(e); render(); }
}
async function boot() {
  render();
  const { data: { session } } = await sb.auth.getSession(); S.session = session;
  if (session && (URL_AUTH.type === "invite" || URL_AUTH.type === "recovery" || URL_AUTH.type === "magiclink")) S.setPassword = true;
  render();
  sb.auth.onAuthStateChange((evt, sess) => {
    const had = !!S.session; S.session = sess;
    if (evt === "PASSWORD_RECOVERY" && sess) { S.setPassword = true; render(); return; }
    if (sess && !had && !S.setPassword) start();
    if (!sess) { S.ready = false; S.setPassword = false; render(); }
  });
  if (session && !S.setPassword) start();
}
boot();
