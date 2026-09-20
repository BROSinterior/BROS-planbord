/* =====================================================================
   BROS Klantenportaal — alleen-lezen zicht van de bouwheer op zijn project
   Leest uitsluitend de klant_*-views (databasescript 011): geen kostprijzen, marges of interne notities.
   ===================================================================== */
const PORTAAL_VERSION = "1.24.0";
const todayLocal = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; };
const safeUrl = (u) => /^https?:\/\//i.test(String(u || "")) ? u : "#";
const cfg = window.PLANBORD_CONFIG || {};
const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = (n, dec = 2) => Number(n || 0).toLocaleString("nl-BE", { style: "currency", currency: "EUR", minimumFractionDigits: dec, maximumFractionDigits: dec });
const nl = (n, dec = 2) => Number(n || 0).toLocaleString("nl-BE", { minimumFractionDigits: 0, maximumFractionDigits: dec });
const pct = (x) => nl(Math.round(x * 1000) / 10, 1) + " %";
const fmt = (s) => { if (!s) return "—"; const [y, m, d] = s.slice(0, 10).split("-"); return `${d}/${m}/${y}`; };
const tijd = (t) => t ? String(t).slice(0, 5) : "";
const MAAND = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const fmtLang = (s) => { if (!s) return "—"; const d = new Date(s.slice(0, 10) + "T00:00:00"); return `${d.getDate()} ${MAAND[d.getMonth()]} ${d.getFullYear()}`; };
const PROJ_STATUS = { offerte: "In offerte", lopend: "In uitvoering", on_hold: "Even gepauzeerd", afgerond: "Opgeleverd", verloren: "Niet doorgegaan" };
const MS_STATUS = { offerte: "Offerte", akkoord: "Akkoord", meerwerk: "Meerwerk", minwerk: "Minwerk" };
const VORD_SOORT = { voorschot: "Voorschot", vordering: "Vordering", slotfactuur: "Slotfactuur", meerwerk: "Meerwerkfactuur" };
const VORD_STATUS = { verzonden: "Te betalen", betaald: "Betaald" };
const URL_AUTH = (() => {
  const h = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  const q = location.search.startsWith("?") ? location.search.slice(1) : "";
  const p = new URLSearchParams(h.includes("=") ? h : q);
  const err = p.get("error_description") || p.get("error_code") || p.get("error") || "";
  if (err) history.replaceState(null, "", location.pathname);
  return { type: p.get("type") || "", error: err };
})();

const S = { session: null, me: null, ready: false, loadError: null, setPassword: false, passwordForced: false, tab: "welkom", project: null, data: null };
let loginNotice = URL_AUTH.error ? (/expired|invalid|otp/i.test(URL_AUTH.error) ? "Deze link is vervallen of al gebruikt. Log in met je wachtwoord, of vraag hieronder een nieuwe link aan." : "Er ging iets mis met de link: " + URL_AUTH.error) : "";

function toast(msg, ms = 3500) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), ms); }

/* ---------- gegevens ---------- */
async function loadAll() {
  const q = (v, sel = "*") => sb.from(v).select(sel).then(r => { if (r.error) throw new Error(v + ": " + r.error.message); return r.data || []; });
  const [me, projecten, meetstaat, vorderingen, regels, planning, uren, documenten, team, ik, fasen, loten, inst, goedkeuringen, notities, notitieTaken, mijnTaken, planTaken, werfverslagen, assistent, chat] = await Promise.all([
    sb.from("profiles").select("id,name,email,role").eq("id", S.session.user.id).maybeSingle().then(r => r.data),
    q("klant_project"), q("klant_meetstaat"), q("klant_vorderingen"), q("klant_vordering_regels"), q("klant_planning"), q("klant_uren"),
    q("klant_documenten"), q("klant_team"), q("klant_ik"), q("fasen"), sb.from("loten_v").select("*").then(r => r.error || !(r.data || []).length ? q("loten") : r.data),
    sb.from("instellingen").select("value").eq("key", "portaal").maybeSingle().then(r => r.data?.value || {}),
    sb.from("klant_goedkeuringen").select("*").then(r => r.error ? [] : (r.data || [])),
    sb.from("klant_notities").select("*").then(r => r.error ? [] : (r.data || [])),
    sb.from("klant_notitie_taken").select("*").then(r => r.error ? [] : (r.data || [])),
    sb.from("klant_taken").select("*").then(r => r.error ? [] : (r.data || [])),
    sb.from("klant_planning_taken").select("*").then(r => r.error ? [] : (r.data || [])),
    sb.from("klant_werfverslagen").select("*").then(r => r.error ? [] : (r.data || [])),
    sb.from("instellingen").select("value").eq("key", "assistent").maybeSingle().then(r => r.data?.value || null),
    sb.from("klant_assistent_berichten").select("*").order("created_at").then(r => r.error ? [] : (r.data || [])),
  ]);
  S.me = me;
  S.data = { assistent, chat, werfverslagen, planTaken, projecten: projecten.sort((a, b) => (b.nummer || "").localeCompare(a.nummer || "")), meetstaat, vorderingen, regels, planning, uren, documenten, team, ik, fasen: fasen.filter(f => f.actief !== false).sort((a, b) => a.nr - b.nr), loten: Object.fromEntries(loten.map(l => [l.nr, l])), inst, goedkeuringen: goedkeuringen.sort((a, b) => (b.voorgelegd_op || "").localeCompare(a.voorgelegd_op || "")), notities: notities.sort((a, b) => (b.datum || "").localeCompare(a.datum || "")), notitieTaken, mijnTaken: mijnTaken.sort((a, b) => (a.status === "done") - (b.status === "done") || (a.eind || "9").localeCompare(b.eind || "9")) };
  if (!S.project || !projecten.some(p => p.id === S.project)) S.project = projecten[0]?.id || null;
  S.eersteBezoek = ik.length > 0 && ik.every(x => !x.portaal_login);
  sb.rpc("portaal_bezoek").then(() => { });
}
const D = () => S.data;
const P = () => D().projecten.find(p => p.id === S.project);
const voornaam = () => { const ik = D().ik[0]; const n = (ik?.naam || S.me?.name || "").trim(); return n.split(/\s+/)[0] || n; };
const lotNaam = (nr) => D().loten[nr] ? `${nr}. ${D().loten[nr].naam}` : String(nr);
const faseNaam = (nr) => D().fasen.find(f => f.nr === nr)?.naam || "";
const isMw = (r) => r.status === "meerwerk" || r.status === "minwerk";
const telt = (r) => r.status !== "vervallen";
const signed = (r) => Number(r.totaal) * (r.status === "minwerk" ? -1 : 1);
const msRows = () => D().meetstaat.filter(r => r.project_id === S.project && telt(r)).sort((a, b) => a.lot - b.lot || (a.volgorde ?? 0) - (b.volgorde ?? 0) || (a.code || "").localeCompare(b.code || ""));

/* ---------- vorderingen: zelfde rekenregels als het Planbord (post-% overschrijft lot-%) ---------- */
function vordCalc(v) {
  const lot = {}, post = {}; D().regels.filter(r => r.vordering_id === v.id).forEach(r => { if (r.post_id) post[r.post_id] = Number(r.pct); else lot[r.lot] = Number(r.pct); });
  let excl = 0, btw = 0; const perLot = {};
  msRows().filter(r => isMw(r) === (v.soort === "meerwerk")).forEach(r => { const p = post[r.id] ?? lot[r.lot]; if (p == null) return; const a = p * signed(r); excl += a; btw += a * (Number(r.btw) || 0); perLot[r.lot] = (perLot[r.lot] || 0) + a; });
  const locked = v.status !== "opgemaakt"; const bedrag = locked && v.bedrag_excl != null ? Number(v.bedrag_excl) : excl;
  const btw2 = excl ? bedrag * (btw / excl) : btw;
  return { excl: bedrag, btw: btw2, incl: bedrag + btw2, perLot, loten: Object.keys(perLot).filter(l => Math.abs(perLot[l]) > 0.005).map(Number) };
}

/* ---------- weergave ---------- */
function render() {
  if (!S.session) return renderLogin();
  if (S.setPassword) return renderSetPassword();
  if (!S.ready) { $("#app").innerHTML = S.loadError ? `<div class="login"><div class="card"><h1>Even geen verbinding</h1><p>${esc(S.loadError)}</p><button class="btn primary" onclick="location.reload()">Opnieuw proberen</button></div></div>` : `<div class="loading">Je portaal wordt geladen…</div>`; return; }
  if (S.me && S.me.role !== "klant") { $("#app").innerHTML = `<div class="login"><div class="card"><div class="brand" style="margin-bottom:14px"><span class="mark">BROS</span><span class="name">Klantenportaal</span></div><h1>Dit is het klantenportaal</h1><p>Je bent ingelogd als ${S.me.role === "aannemer" ? "aannemer" : "teamlid"} (${esc(S.me.email || "")}).</p><p><a class="btn primary" href="${S.me.role === "aannemer" ? "../aannemer/" : "../"}">${S.me.role === "aannemer" ? "Naar het aannemersportaal" : "Naar het Planbord"}</a> <button class="btn ghost" data-act="logout">Uitloggen</button></p></div></div>`; return; }
  if (!D().projecten.length) { $("#app").innerHTML = `<div class="login"><div class="card"><div class="brand" style="margin-bottom:14px"><span class="mark">BROS</span><span class="name">Klantenportaal</span></div><h1>Nog geen project gekoppeld</h1><p>Je login werkt, maar er is nog geen project aan je gekoppeld. Laat het ons even weten via ${esc(D().inst.contact_email || "info@bros.be")}.</p><p><button class="btn ghost" data-act="logout">Uitloggen</button></p></div></div>`; return; }
  const p = P();
  const openGk = D().goedkeuringen.filter(g => g.project_id === p.id && g.status === "open" && !(g.geldig_tot && g.geldig_tot < todayLocal())).length;
  const tabs = [["welkom", "Welkom"], ["akkoord", "Akkoord" + (openGk ? ` <span class="badge">${openGk}</span>` : "")], ["meetstaat", "Meetstaat"], ["facturatie", "Facturatie"], ["planning", "Planning"], ["verslagen", "Verslagen" + (D().mijnTaken.filter(t => t.project_id === p.id && t.status !== "done").length ? ` <span class="badge">${D().mijnTaken.filter(t => t.project_id === p.id && t.status !== "done").length}</span>` : "")], ["documenten", "Documenten"], ["team", "Wie is wie"]].concat(assistentAan(p) ? [["vragen", "Vragen"]] : []);
  $("#app").innerHTML = `<header class="top"><div class="top-in"><div class="brand"><span class="mark">BROS</span><span class="name">Klantenportaal</span></div>
      <div class="who">${D().projecten.length > 1 ? `<select id="projSel" class="btn sm">${D().projecten.map(x => `<option value="${x.id}" ${x.id === p.id ? "selected" : ""}>${esc(x.nummer ? x.nummer + " · " : "")}${esc(x.naam || x.klant)}</option>`).join("")}</select>` : ""}<span>${esc(S.me?.name || "")}</span><button class="btn ghost sm" data-act="logout">Uitloggen</button></div></div>
    <nav class="tabs">${tabs.map(([k, l]) => `<button class="${S.tab === k ? "on" : ""}" data-tab="${k}">${l}</button>`).join("")}</nav></header>
    <main>${(({ welkom: vWelkom, akkoord: vAkkoord, meetstaat: vMeetstaat, facturatie: vFacturatie, planning: vPlanning, verslagen: vVerslagen, documenten: vDocumenten, team: vTeam, vragen: vVragen })[S.tab] || vWelkom)(p)}</main>`;
  window.scrollTo({ top: 0 });
}

function vWelkom(p) {
  const inst = D().inst; const fasen = D().fasen; const nu = p.fase_nr;
  const plan = Object.fromEntries(D().planning.filter(x => x.project_id === p.id).map(x => [x.fase_nr, x]));
  const lead = D().team.find(t => t.id === p.lead);
  const status = p.status === "afgerond" ? "Je project is opgeleverd." : nu ? `Je project zit in stap ${nu}: <b>${esc(faseNaam(nu))}</b>.` : `Status: ${PROJ_STATUS[p.status] || p.status}.`;
  const open = D().goedkeuringen.filter(g => g.project_id === p.id && g.status === "open" && !(g.geldig_tot && g.geldig_tot < todayLocal()));
  return `<div class="hero"><div class="eyebrow">${esc(p.nummer || "")} · ${esc(p.naam || "")}</div><h1>Welkom, ${esc(voornaam())}</h1>
      <p class="lead">${esc(inst.welkom || "")}</p></div>
    ${(() => { const mt = D().mijnTaken.filter(t => t.project_id === p.id && t.status !== "done"); return mt.length ? `<div class="notice" style="border-color:var(--blue);background:var(--blue-soft)"><div><b>${mt.length === 1 ? "Er staat een actiepunt voor jou open" : `Er staan ${mt.length} actiepunten voor jou open`}</b><div class="muted" style="font-size:13px">${mt.slice(0, 3).map(t => esc(t.titel) + (t.eind ? " · vóór " + fmt(t.eind) : "")).join(" · ")}${mt.length > 3 ? " · …" : ""}</div></div><button class="btn primary" data-tab="verslagen">Bekijken →</button></div>` : ""; })()}
    ${open.length ? `<div class="notice"><div><b>${open.length === 1 ? "Er wacht een voorstel op je akkoord" : `Er wachten ${open.length} voorstellen op je akkoord`}</b><div class="muted" style="font-size:13px">${open.map(g => esc(g.titel) + " · " + eur(g.totaal_incl, 0) + " incl. btw" + (g.geldig_tot ? " · vóór " + fmt(g.geldig_tot) : "")).join(" · ")}</div></div><button class="btn primary" data-tab="akkoord">Bekijken en goedkeuren →</button></div>` : ""}
    <div class="two"><div class="stack">
      <div class="panel"><div class="panel-head"><h2>Waar staat je project?</h2><span class="pill grijs">${PROJ_STATUS[p.status] || esc(p.status)}</span></div><div class="panel-body">
        <p>${status}</p>
        <p class="muted" style="font-size:13px">${esc([p.adres, [p.postcode, p.gemeente].filter(Boolean).join(" ")].filter(Boolean).join(", "))}${p.start ? ` · gestart ${fmtLang(p.start)}` : ""}${p.eind ? ` · verwachte oplevering ${fmtLang(p.eind)}` : ""}</p></div></div>
      <div class="panel"><div class="panel-head"><h2>Zo werkt het bij BROS</h2></div><div class="panel-body">
        <p class="muted" style="font-size:14px">${esc(inst.werkwijze || "")}</p>
        <ol class="steps">${fasen.map(f => { const st = p.status === "afgerond" || (nu != null && f.nr < nu) ? "done" : f.nr === nu ? "now" : "todo"; const pl = plan[f.nr];
          return `<li class="${st}"><span class="n">${st === "done" ? "✓" : f.nr}</span><span class="nm">${esc(f.naam)}</span><span class="when">${st === "now" ? "nu bezig" : pl && pl.start && st !== "done" ? "vanaf " + fmt(pl.start) : pl && pl.eind && st === "done" ? "klaar" : ""}</span></li>`; }).join("")}</ol></div></div>
    </div><div class="stack">
      ${lead ? `<div class="panel"><div class="panel-head"><h2>Je aanspreekpunt</h2></div><div class="panel-body"><div class="person">${avatar(lead, 56)}<div><b>${esc(lead.name)}</b><div class="muted" style="font-size:13px">${esc(lead.functie || "BROS")}</div>${lead.bio ? `<p style="font-size:13px;color:var(--ink-2);margin-top:6px;white-space:pre-line">${esc(lead.bio.slice(0, 220))}${lead.bio.length > 220 ? "…" : ""}</p>` : ""}</div></div></div></div>` : ""}
      <div class="panel"><div class="panel-head"><h2>Vragen?</h2></div><div class="panel-body"><p style="white-space:pre-line">${esc(inst.contact || "")}</p></div></div>
      <div class="panel"><div class="panel-head"><h2>Snel naar</h2></div><div class="panel-body" style="display:flex;flex-wrap:wrap;gap:8px">${[["meetstaat", "Meetstaat"], ["facturatie", "Facturatie"], ["planning", "Planning"], ["documenten", "Documenten"]].map(([k, l]) => `<button class="btn" data-tab="${k}">${l} →</button>`).join("")}</div></div>
    </div></div>`;
}
const GK_STATUS = { open: "Wacht op je akkoord", akkoord: "Goedgekeurd", geweigerd: "Niet akkoord", ingetrokken: "Ingetrokken door BROS" };
function gkTabel(g) {
  const ps = g.posten || []; let lot = null;
  return `<div class="tw"><table class="t"><thead><tr><th style="width:60px">Nr</th><th>Omschrijving</th><th class="r">Hoev.</th><th class="r">Prijs</th><th class="r">Totaal</th></tr></thead><tbody>
    ${ps.map(x => { let h = ""; if (x.lot !== lot) { lot = x.lot; h = `<tr class="groep"><td colspan="5">${esc(lotNaam(x.lot))}</td></tr>`; }
      return h + `<tr><td class="num muted" style="font-size:12px">${esc(x.code)}</td><td>${esc(x.omschrijving).replace(/\n/g, "<br>")}${x.locatie ? `<div class="muted" style="font-size:12px">${esc(x.locatie)}</div>` : ""}${x.status === "minwerk" ? ` <span class="pill minwerk">Minwerk</span>` : ""}</td><td class="r num">${nl(x.hoeveelheid, 2)} ${esc(x.eenheid)}</td><td class="r num">${eur(x.prijs)}</td><td class="r num">${eur(x.totaal)}</td></tr>`; }).join("")}
    <tr class="tot"><td colspan="4">Totaal excl. btw</td><td class="r num">${eur(g.totaal_excl)}</td></tr><tr><td colspan="4">Btw</td><td class="r num">${eur(g.btw)}</td></tr><tr class="tot"><td colspan="4">Totaal incl. btw</td><td class="r num">${eur(g.totaal_incl)}</td></tr></tbody></table></div>`;
}
function vAkkoord(p) {
  const today = todayLocal();
  const gs = D().goedkeuringen.filter(g => g.project_id === p.id); const verlopen = (g) => g.status === "open" && g.geldig_tot && g.geldig_tot < today;
  const open = gs.filter(g => g.status === "open" && !verlopen(g)), rest = gs.filter(g => g.status !== "open" || verlopen(g));
  const naam = (D().ik[0]?.naam || S.me?.name || "");
  return `<h1 style="margin-bottom:6px">Akkoord</h1><p class="muted" style="margin-bottom:16px">Voorstellen die BROS je voorlegt: de offerte en eventuele meerwerken. Je akkoord wordt vastgelegd met je naam en het tijdstip.</p>
    ${open.length ? open.map(g => `<div class="panel approve" style="margin-bottom:16px"><div class="panel-head"><div><h2>${esc(g.titel)}</h2><div class="muted" style="font-size:13px">${g.soort === "meerwerk" ? "Meerwerkvoorstel" : "Offerte"} · voorgelegd op ${fmtLang(g.voorgelegd_op)}${g.voorgelegd_door_naam ? " door " + esc(g.voorgelegd_door_naam) : ""}</div></div><div style="text-align:right"><span class="pill verzonden">${GK_STATUS.open}</span>${g.geldig_tot ? `<div class="deadline ${g.geldig_tot <= new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10) ? "soon" : ""}">Reageren vóór ${fmtLang(g.geldig_tot)}</div>` : ""}</div></div>
      ${g.toelichting ? `<div class="panel-body" style="border-bottom:1px solid var(--line);white-space:pre-line">${esc(g.toelichting)}</div>` : ""}
      ${gkTabel(g)}
      <div class="panel-body" style="border-top:1px solid var(--line)"><form class="gk-form" data-gk="${g.id}">
        <div class="field"><label for="gk_naam_${g.id}">Je naam</label><input id="gk_naam_${g.id}" name="naam" required value="${esc(naam)}" style="max-width:360px"></div>
        <label class="check"><input type="checkbox" name="ok" required> <span>Ik heb dit voorstel nagekeken en ga akkoord met de vermelde posten, hoeveelheden en prijzen (${eur(g.totaal_incl)} incl. btw).</span></label>
        <div class="gk-actions"><button class="btn primary" type="submit" data-beslissing="akkoord">Akkoord geven</button><button class="btn" type="button" data-act="gk-nee" data-id="${g.id}">Ik heb een vraag / niet akkoord</button></div>
        <div class="gk-nee" id="gk_nee_${g.id}" hidden><div class="field"><label for="gk_opm_${g.id}">Wat wil je aanpassen of vragen?</label><textarea id="gk_opm_${g.id}" name="opmerking" rows="3" placeholder="bv. Kunnen we de plinten in eik doen in plaats van MDF?"></textarea></div><button class="btn" type="submit" data-beslissing="geweigerd">Verstuur naar BROS</button></div>
        <div class="msg" id="gk_msg_${g.id}"></div></form></div></div>`).join("") : `<div class="panel" style="margin-bottom:16px"><div class="empty"><b>Niets dat op je akkoord wacht</b>Zodra BROS je een offerte of meerwerk voorlegt, verschijnt het hier en krijg je een mail.</div></div>`}
    ${rest.length ? `<div class="panel"><div class="panel-head"><h2>Eerdere beslissingen</h2></div><div class="tw"><table class="t"><thead><tr><th>Voorstel</th><th>Voorgelegd</th><th class="r">Incl. btw</th><th>Status</th><th>Beslist</th><th></th></tr></thead><tbody>
      ${rest.map(g => `<tr><td><b>${esc(g.titel)}</b><div class="muted" style="font-size:12px">${g.soort === "meerwerk" ? "Meerwerk" : "Offerte"} · ${(g.posten || []).length} posten</div></td><td class="num">${fmt(g.voorgelegd_op)}</td><td class="r num">${eur(g.totaal_incl)}</td><td><span class="pill ${g.status === "akkoord" ? "akkoord" : g.status === "geweigerd" || verlopen(g) ? "minwerk" : "grijs"}">${verlopen(g) ? "Termijn verstreken" : GK_STATUS[g.status]}</span>${verlopen(g) ? `<div class="muted" style="font-size:11px">vraag BROS om het opnieuw voor te leggen</div>` : ""}</td><td style="font-size:12px">${g.beslist_op ? `${fmt(g.beslist_op)} · ${esc(g.beslist_naam)}` : "—"}${g.opmerking ? `<div class="muted">“${esc(g.opmerking)}”</div>` : ""}</td><td class="r"><button class="btn sm" data-act="gk-toon" data-id="${g.id}">Details</button></td></tr>${S.gkOpen === g.id ? `<tr><td colspan="6" style="padding:0">${gkTabel(g)}</td></tr>` : ""}`).join("")}</tbody></table></div></div>` : ""}`;
}
async function gkBeslis(id, akkoord, naam, opmerking, form) {
  const m = form.querySelector(".msg"); m.className = "msg"; m.textContent = "Even geduld…"; form.querySelectorAll("button").forEach(b => b.disabled = true);
  const { data, error } = await sb.rpc("goedkeuring_beslis", { p_id: id, p_akkoord: akkoord, p_naam: naam, p_opmerking: opmerking || "" });
  if (error) { m.className = "msg err"; m.textContent = "Dat lukte niet: " + error.message; form.querySelectorAll("button").forEach(b => b.disabled = false); return; }
  if (cfg.driveScriptUrl) { try { const r = await fetch(cfg.driveScriptUrl, { method: "POST", body: JSON.stringify({ action: "gkmail", id, soort: "beslist", token: S.session?.access_token || "" }), redirect: "follow" }); await r.json(); } catch (e) { } }
  try { await loadAll(); } catch (e) { console.warn(e); }
  render();
  toast(akkoord ? "Bedankt — je akkoord is vastgelegd. Je krijgt een bevestiging per mail." : "Verstuurd — BROS neemt contact met je op.", 6000);
  if (akkoord) vuurwerk(null, "Bedankt!");
}
function avatar(t, size = 40) { return t.foto_url ? `<img class="avatar" style="width:${size}px;height:${size}px" src="${esc(safeUrl(t.foto_url))}" alt="">` : `<span class="avatar" style="width:${size}px;height:${size}px;background:${esc(t.color || "#2A4DD0")};font-size:${Math.round(size / 3)}px">${esc(t.initials || "")}</span>`; }

function vMeetstaat(p) {
  const rows = msRows(); if (!rows.length) return `<h1 style="margin-bottom:16px">Meetstaat</h1><div class="panel"><div class="empty"><b>Nog geen meetstaat</b>Zodra we de meetstaat van je project opmaken, verschijnt ze hier.</div></div>`;
  const contract = rows.filter(r => !isMw(r)).reduce((s, r) => s + Number(r.totaal), 0), mw = rows.filter(isMw).reduce((s, r) => s + signed(r), 0);
  const btwTot = rows.reduce((s, r) => s + signed(r) * (Number(r.btw) || 0), 0);
  const offerteOpen = rows.some(r => r.status === "offerte");
  const lots = [...new Set(rows.map(r => r.lot))];
  const lotBlok = (lot) => { const rs = rows.filter(r => r.lot === lot); const som = rs.reduce((s, r) => s + signed(r), 0); let groep = null;
    return `<div class="panel"><div class="panel-head"><h3>${esc(lotNaam(lot))}</h3><span class="num" style="font-weight:700">${eur(som)}</span></div><div class="tw"><table class="t"><thead><tr><th style="width:60px">Nr</th><th>Omschrijving</th><th class="r">Hoev.</th><th class="r">Prijs</th><th class="r">Totaal</th><th>Status</th></tr></thead><tbody>
      ${rs.map(r => { const isGroep = !Number(r.hoeveelheid) && !Number(r.prijs) && !r.code && (r.groep || r.omschrijving); let g = ""; if (r.groep && r.groep !== groep) { groep = r.groep; g = `<tr class="groep"><td colspan="6">${esc(r.groep)}</td></tr>`; }
        if (isGroep && !r.groep) return `<tr class="groep"><td colspan="6">${esc(r.omschrijving)}</td></tr>`;
        return g + `<tr><td class="num muted" style="font-size:12px">${esc(r.code)}</td><td>${esc(r.omschrijving).replace(/\n/g, "<br>")}${r.locatie ? `<div class="muted" style="font-size:12px">${esc(r.locatie)}</div>` : ""}</td><td class="r num">${Number(r.hoeveelheid) ? nl(r.hoeveelheid, 2) + " " + esc(r.eenheid) : ""}</td><td class="r num">${Number(r.prijs) ? eur(r.prijs) : ""}</td><td class="r num">${Number(r.totaal) ? eur(signed(r)) : ""}</td><td><span class="pill ${r.status}">${MS_STATUS[r.status] || esc(r.status)}</span>${r.akkoord_op ? `<div class="muted" style="font-size:11px">✓ ${fmt(r.akkoord_op)}</div>` : ""}</td></tr>`; }).join("")}
    </tbody></table></div></div>`; };
  return `<h1 style="margin-bottom:6px">Meetstaat</h1><p class="muted" style="margin-bottom:16px">Alle posten van je project met de afgesproken prijzen (excl. btw). ${offerteOpen ? "Posten met status <b>Offerte</b> wachten nog op je akkoord; " : ""}<b>Meerwerk</b> en <b>minwerk</b> zijn wijzigingen na het contract.</p>
    <div class="kpis"><div class="kpi"><div class="k">Contract excl. btw</div><div class="v num">${eur(contract, 0)}</div></div><div class="kpi"><div class="k">Meer-/minwerk</div><div class="v num">${mw ? eur(mw, 0) : "—"}</div></div><div class="kpi"><div class="k">Btw</div><div class="v num">${eur(btwTot, 0)}</div><div class="muted" style="font-size:12px">${p.btw_tarief ? p.btw_tarief + " % op je project" : ""}</div></div><div class="kpi"><div class="k">Totaal incl. btw</div><div class="v num">${eur(contract + mw + btwTot, 0)}</div></div></div>
    <div class="stack">${lots.map(lotBlok).join("")}</div>`;
}

function vFacturatie(p) {
  const rows = msRows(); const contract = rows.filter(r => !isMw(r)).reduce((s, r) => s + Number(r.totaal), 0), mw = rows.filter(isMw).reduce((s, r) => s + signed(r), 0);
  const vs = D().vorderingen.filter(v => v.project_id === p.id && v.status !== "opgemaakt").sort((a, b) => a.nr - b.nr);
  const calcs = vs.map(v => ({ v, c: vordCalc(v) }));
  const gefact = calcs.reduce((s, x) => s + x.c.excl, 0), betaald = calcs.filter(x => x.v.status === "betaald").reduce((s, x) => s + x.c.incl, 0), open = calcs.filter(x => x.v.status !== "betaald").reduce((s, x) => s + x.c.incl, 0);
  return `<h1 style="margin-bottom:6px">Facturatie</h1><p class="muted" style="margin-bottom:16px">Je facturen en wat er nog volgt. We factureren een voorschot bij ondertekening en daarna per afgewerkt onderdeel; meerwerk factureren we apart.</p>
    <div class="kpis"><div class="kpi"><div class="k">Contract + meerwerk</div><div class="v num">${eur(contract + mw, 0)}</div><div class="muted" style="font-size:12px">excl. btw</div></div><div class="kpi"><div class="k">Gefactureerd</div><div class="v num">${eur(gefact, 0)}</div><div class="muted" style="font-size:12px">${contract + mw ? pct(gefact / (contract + mw)) : "—"} excl. btw</div></div><div class="kpi"><div class="k">Nog te factureren</div><div class="v num">${eur(contract + mw - gefact, 0)}</div><div class="muted" style="font-size:12px">excl. btw</div></div><div class="kpi"><div class="k">Open te betalen</div><div class="v num" style="${open > 0.5 ? "color:var(--warn)" : ""}">${open > 0.5 ? eur(open, 0) : "—"}</div><div class="muted" style="font-size:12px">betaald ${eur(betaald, 0)} incl. btw</div></div></div>
    <div class="panel"><div class="panel-head"><h2>Facturen</h2></div>${vs.length ? `<div class="tw"><table class="t"><thead><tr><th>Nr</th><th>Datum</th><th>Omschrijving</th><th>Onderdelen</th><th class="r">Excl. btw</th><th class="r">Btw</th><th class="r">Incl. btw</th><th>Status</th></tr></thead><tbody>
      ${calcs.map(({ v, c }) => `<tr><td class="num">${v.nr === 0 ? "V" : v.nr}</td><td class="num">${fmt(v.datum)}</td><td><b>${esc(v.omschrijving || VORD_SOORT[v.soort])}</b>${v.factuurnummer ? `<div class="muted" style="font-size:12px">factuur ${esc(v.factuurnummer)}</div>` : ""}</td><td class="muted" style="font-size:12px;max-width:260px">${v.soort === "voorschot" ? "alle onderdelen" : esc(c.loten.map(lotNaam).join(", "))}</td><td class="r num">${eur(c.excl)}</td><td class="r num">${eur(c.btw)}</td><td class="r num"><b>${eur(c.incl)}</b></td><td><span class="pill ${v.status}">${VORD_STATUS[v.status] || esc(v.status)}</span></td></tr>`).join("")}
      <tr class="tot"><td colspan="4">Totaal gefactureerd</td><td class="r num">${eur(gefact)}</td><td class="r num">${eur(calcs.reduce((s, x) => s + x.c.btw, 0))}</td><td class="r num">${eur(calcs.reduce((s, x) => s + x.c.incl, 0))}</td><td></td></tr></tbody></table></div>` : `<div class="empty"><b>Nog geen facturen</b>Zodra we een factuur versturen, vind je ze hier terug.</div>`}</div>`;
}

function vPlanning(p) {
  const fasen = D().fasen; const plan = Object.fromEntries(D().planning.filter(x => x.project_id === p.id).map(x => [x.fase_nr, x])); const nu = p.fase_nr;
  const dates = Object.values(plan).flatMap(x => [x.start, x.eind]).concat((D().planTaken || []).filter(t => t.project_id === p.id).flatMap(t => [t.start, t.eind])).filter(Boolean).sort(); const t0 = dates[0] ? new Date(dates[0]) : null, t1 = dates[dates.length - 1] ? new Date(dates[dates.length - 1]) : null; const span = t0 && t1 ? Math.max(1, t1 - t0) : 1;
  const uren = D().uren.filter(u => u.project_id === p.id).sort((a, b) => (b.datum || "").localeCompare(a.datum || "") || (b.tijd_van || "").localeCompare(a.tijd_van || "")); const totU = uren.reduce((s, u) => s + Number(u.uren), 0);
  return `<h1 style="margin-bottom:6px">Planning</h1><p class="muted" style="margin-bottom:16px">De stappen van je project met hun timing. Data zijn een planning en kunnen nog schuiven.</p>
    <div class="panel" style="margin-bottom:16px"><div class="tw"><table class="t"><thead><tr><th>Stap</th><th>Van</th><th>Tot</th><th style="min-width:180px">Verloop</th><th>Status</th></tr></thead><tbody>
      ${fasen.map(f => { const pl = plan[f.nr]; const st = p.status === "afgerond" || (nu != null && f.nr < nu) ? "done" : f.nr === nu ? "now" : "todo";
        const bar = pl && pl.start && pl.eind && t0 ? `<div class="bar"><i class="${st === "done" ? "done" : ""}" style="left:${Math.round((new Date(pl.start) - t0) / span * 100)}%;width:${Math.max(2, Math.round((new Date(pl.eind) - new Date(pl.start)) / span * 100))}%"></i></div>` : "";
        const taken = (D().planTaken || []).filter(t => t.project_id === p.id && (t.fase_nr || 0) === f.nr).sort((a, b) => (a.volgorde ?? 0) - (b.volgorde ?? 0) || (a.start || "9").localeCompare(b.start || "9"));
        const tbar = (t) => t.start && t.eind && t0 ? `<div class="bar"><i class="${t.status === "done" ? "done" : ""}" style="left:${Math.round((new Date(t.start) - t0) / span * 100)}%;width:${Math.max(2, Math.round((new Date(t.eind) - new Date(t.start)) / span * 100))}%;opacity:.55"></i></div>` : "";
        return `<tr style="${st === "todo" ? "color:var(--muted)" : ""}"><td><b style="${st === "now" ? "" : "font-weight:600"}">${f.nr}. ${esc(f.naam)}</b>${pl && pl.opmerking ? `<div class="muted" style="font-size:12px">${esc(pl.opmerking)}</div>` : ""}${pl && pl.taken ? `<div class="muted" style="font-size:12px">${pl.klaar} van ${pl.taken} taken klaar</div>` : ""}</td><td class="num">${pl ? fmt(pl.start) : "—"}</td><td class="num">${pl ? fmt(pl.eind) : "—"}</td><td>${bar}</td><td>${st === "done" ? `<span class="pill akkoord">Klaar</span>` : st === "now" ? `<span class="pill meerwerk">Nu bezig</span>` : `<span class="pill grijs">Nog te doen</span>`}</td></tr>` +
          taken.map(t => `<tr class="sub" style="${t.status === "done" ? "color:var(--muted)" : ""}"><td style="padding-left:28px">↳ ${esc(t.titel)}</td><td class="num">${fmt(t.start)}</td><td class="num">${fmt(t.eind)}</td><td>${tbar(t)}</td><td>${t.status === "done" ? `<span class="pill akkoord">Klaar</span>` : t.status === "busy" ? `<span class="pill meerwerk">Bezig</span>` : `<span class="pill grijs">Gepland</span>`}</td></tr>`).join(""); }).join("")}
    </tbody></table></div></div>
    <div class="panel"><div class="panel-head"><h2>Gepresteerde uren</h2><span class="num" style="font-weight:700">${nl(totU)} u</span></div>${uren.length ? `<div class="tw"><table class="t"><thead><tr><th>Datum</th><th>Tijd</th><th>Wat</th><th>Wie</th><th class="r">Uren</th></tr></thead><tbody>
      ${uren.map(u => `<tr><td class="num">${fmt(u.datum)}</td><td class="num">${u.tijd_van ? tijd(u.tijd_van) + (u.tijd_tot ? " – " + tijd(u.tijd_tot) : "") : ""}</td><td>${esc(u.taak)}${u.fase_nr ? `<div class="muted" style="font-size:12px">${esc(faseNaam(u.fase_nr))}</div>` : ""}</td><td>${esc(u.medewerker || "")}</td><td class="r num">${nl(u.uren)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><b>Nog geen uren gedeeld</b>Hier zie je de uren die we voor je project presteren, zodra we ze met je delen.</div>`}</div>`;
}

const NOTE_SOORT = { vergadering: "Vergadering", werfverslag: "Werfverslag", bespreking: "Bespreking", feedback: "Feedback", notitie: "Notitie" };
function vVerslagen(p) {
  const ns = D().notities.filter(n => n.project_id === p.id);
  const mt = D().mijnTaken.filter(t => t.project_id === p.id);
  const wvs = (D().werfverslagen || []).filter(w => w.project_id === p.id).sort((a, b) => (b.nr || 0) - (a.nr || 0));
  return `<h1 style="margin-bottom:6px">Verslagen</h1><p class="muted" style="margin-bottom:16px">Verslagen van vergaderingen en werfbezoeken die BROS met je deelt, met de afgesproken actiepunten.</p>
    ${wvs.length ? `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h2>Werfverslagen</h2><span class="muted" style="font-size:13px">pdf met de vaststellingen en de plannen</span></div><table class="t"><tbody>${wvs.map(w => `<tr><td class="num" style="width:60px">${w.nr}</td><td><b>${esc(w.titel || "Werfverslag " + w.nr)}</b><div class="muted" style="font-size:13px">${fmtLang(w.datum)} · ${w.punten} punt${w.punten === 1 ? "" : "en"}</div></td><td class="r"><a class="btn sm" href="${esc(safeUrl(w.pdf_url))}" target="_blank" rel="noopener">Pdf openen</a></td></tr>`).join("")}</tbody></table></div>` : ""}
    ${mt.length ? `<div class="panel" style="margin-bottom:16px;border-color:var(--blue)"><div class="panel-head"><h2>Jouw actiepunten</h2><span class="muted" style="font-size:13px">${mt.filter(t => t.status !== "done").length} open · vink af wat gedaan is</span></div><table class="t"><tbody>${mt.map(t => `<tr style="${t.status === "done" ? "opacity:.55" : ""}"><td style="width:34px"><input type="checkbox" data-mijntaak="${t.id}" ${t.status === "done" ? "checked" : ""} style="width:18px;height:18px"></td><td>${esc(t.titel)}${t.notitie_titel ? `<div class="muted" style="font-size:12px">uit: ${esc(t.notitie_titel)}</div>` : ""}</td><td class="num muted" style="font-size:13px;${t.status !== "done" && t.eind && t.eind < todayLocal() ? "color:var(--crit)" : ""}">${t.eind ? fmt(t.eind) : ""}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${ns.length ? `<div class="stack">${ns.map(n => { const ts = D().notitieTaken.filter(t => t.notitie_id === n.id).sort((a, b) => (a.eind || "9").localeCompare(b.eind || "9")); const open = S.noteOpen === n.id || ns.length <= 3;
      return `<div class="panel"><div class="panel-head" style="cursor:pointer" data-act="note-toggle" data-id="${n.id}"><div><h2 style="font-size:17px">${esc(n.titel || NOTE_SOORT[n.soort])}</h2><div class="muted" style="font-size:13px">${NOTE_SOORT[n.soort] || esc(n.soort)} · ${fmtLang(n.datum)}${n.auteur_naam ? " · " + esc(n.auteur_naam) : ""}${n.deelnemers ? " · aanwezig: " + esc(n.deelnemers) : ""}</div></div><span class="muted">${open ? "▾" : "▸"}</span></div>
        ${open ? `<div class="panel-body" style="white-space:pre-line;font-size:14px">${esc(n.inhoud)}</div>${ts.length ? `<div class="panel-body" style="border-top:1px solid var(--line)"><h3 style="margin-bottom:8px">Actiepunten</h3><table class="t"><tbody>${ts.map(t => `<tr><td style="width:28px">${t.voor_mij ? `<input type="checkbox" data-mijntaak="${t.id}" ${t.status === "done" ? "checked" : ""} style="width:18px;height:18px">` : t.status === "done" ? "✅" : "◻︎"}</td><td>${esc(t.titel)}${t.voor_mij ? ` <span class="pill verzonden">voor jou</span>` : ""}</td><td class="muted" style="font-size:13px">${esc(t.wie || "")}</td><td class="num muted" style="font-size:13px">${t.eind ? fmt(t.eind) : ""}</td></tr>`).join("")}</tbody></table></div>` : ""}` : ""}</div>`; }).join("")}</div>` : `<div class="panel"><div class="empty"><b>Nog geen verslagen gedeeld</b>Zodra we een verslag met je delen, staat het hier.</div></div>`}`;
}
/* ---------- AI-assistent: vragen over het eigen dossier ---------- */
const assistentAan = (p) => !!(D().assistent && D().assistent.actief !== false && p && p.assistent !== false);
function vVragen(p) {
  const msgs = (D().chat || []).filter(m => m.project_id === p.id); const cfg = D().assistent || {};
  return `<h1 style="margin-bottom:6px">Vragen</h1><p class="muted" style="margin-bottom:16px">${esc(cfg.begroeting || "Vraag gerust iets over je project. Een medewerker van BROS kijkt mee.")}</p>
    <div class="panel"><div class="chat" id="chat">${msgs.length ? msgs.map(m => `<div class="msg ${m.rol}"><div class="bubble">${esc(m.tekst)}</div><div class="when">${m.rol === "assistent" ? "Assistent · " : ""}${fmtLang(m.created_at.slice(0, 10))} ${m.created_at.slice(11, 16)}</div></div>`).join("") : `<div class="muted" style="padding:20px;text-align:center">Nog geen vragen gesteld. Bijvoorbeeld: <i>wanneer start de uitvoering?</i>, <i>hoeveel is er al gefactureerd?</i>, <i>welke documenten staan er klaar?</i></div>`}${S.chatBezig ? `<div class="msg assistent"><div class="bubble muted">…</div></div>` : ""}</div>
      <form class="chat-form" id="chatForm"><input name="vraag" placeholder="Stel je vraag over dit project…" autocomplete="off" maxlength="1500" ${S.chatBezig ? "disabled" : ""} required><button class="btn primary" type="submit" ${S.chatBezig ? "disabled" : ""}>Vragen</button></form>
      <p class="muted" style="font-size:12px;padding:0 18px 14px;margin:0">Antwoorden worden automatisch opgesteld op basis van je dossier en kunnen een vergissing bevatten; bij twijfel geldt wat BROS je bevestigt. Vragen die actie vragen, komen bij het team terecht.</p></div>`;
}
async function vraagStellen(p, vraag) {
  S.chatBezig = true; D().chat.push({ id: "tmp" + Date.now(), project_id: p.id, rol: "klant", tekst: vraag, created_at: new Date().toISOString() }); render();
  try {
    const r = await fetch(cfg.supabaseUrl + "/functions/v1/" + ((D().assistent && D().assistent.functie) || "assistent"), { method: "POST", headers: { "Content-Type": "application/json", apikey: cfg.supabaseAnonKey, Authorization: "Bearer " + (S.session?.access_token || "") }, body: JSON.stringify({ project_id: p.id, vraag }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || ("fout " + r.status));
    D().chat.push({ id: "tmp" + Date.now(), project_id: p.id, rol: "assistent", tekst: j.antwoord || "", created_at: new Date().toISOString() });
    if (j.voorstel) toast("Je vraag is doorgegeven aan het team van BROS.", 4000);
  } catch (e) {
    const fn = (D().assistent && D().assistent.functie) || "assistent";
    const msg = /failed to fetch|load failed|networkerror/i.test(String(e.message || e)) ? "de assistent is niet bereikbaar — functie '" + fn + "' niet gevonden of geen internet" : (e.message || e);
    D().chat.push({ id: "tmp" + Date.now(), project_id: p.id, rol: "assistent", tekst: "Sorry, dat lukte niet (" + msg + "). Probeer het straks opnieuw of mail BROS.", created_at: new Date().toISOString() });
  }
  S.chatBezig = false; render(); const c = $("#chat"); if (c) c.scrollTop = c.scrollHeight; const inp = $("#chatForm input"); if (inp) inp.focus();
}
function vDocumenten(p) {
  const docs = D().documenten.filter(d => d.project_id === p.id).sort((a, b) => (a.pad || "").localeCompare(b.pad || "") || (b.gewijzigd || "").localeCompare(a.gewijzigd || ""));
  const ext = (n) => (n.match(/\.([a-z0-9]{2,5})$/i) || [, "doc"])[1].toUpperCase();
  const size = (b) => !b ? "" : b > 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.round(b / 1e3) + " kB";
  const groups = [...new Set(docs.map(d => d.pad || ""))];
  return `<h1 style="margin-bottom:6px">Documenten</h1><p class="muted" style="margin-bottom:16px">Plannen, presentaties en documenten die we met je delen — altijd de laatste versie.</p>
    ${docs.length ? `<div class="stack">${groups.map(g => `<div class="panel"><div class="panel-head"><h3>${esc(g.replace(/\//g, " › ") || "Algemeen")}</h3></div><div class="panel-body" style="padding-top:4px;padding-bottom:4px">${docs.filter(d => (d.pad || "") === g).map(d => `<a class="doc" href="${esc(safeUrl(d.url))}" target="_blank" rel="noopener"><span class="ic">${esc(ext(d.naam))}</span><span><div class="nm">${esc(d.naam)}</div><small>${d.gewijzigd ? fmt(d.gewijzigd) : ""}${d.grootte ? " · " + size(d.grootte) : ""}</small></span></a>`).join("")}</div></div>`).join("")}</div>` : `<div class="panel"><div class="empty"><b>Nog geen documenten gedeeld</b>Zodra we plannen of documenten voor je klaarzetten, verschijnen ze hier.</div></div>`}`;
}

function vTeam() {
  const team = D().team.slice().sort((a, b) => a.name.localeCompare(b.name));
  return `<h1 style="margin-bottom:6px">Wie is wie</h1><p class="muted" style="margin-bottom:16px">Het team dat aan je project werkt.</p>
    ${team.length ? `<div class="team">${team.map(t => `<div class="card">${t.foto_url ? `<img class="foto" src="${esc(safeUrl(t.foto_url))}" alt="${esc(t.name)}">` : `<div class="nofoto" style="background:${esc(t.color || "#2A4DD0")}">${esc(t.initials)}</div>`}<div class="body"><h3>${esc(t.name)}</h3><div class="fn">${esc(t.functie || "BROS")}</div><div class="bio">${esc(t.bio || "")}</div></div></div>`).join("")}</div>` : `<div class="panel"><div class="empty">Binnenkort stellen we het team hier aan je voor.</div></div>`}`;
}

/* ---------- login / wachtwoord ---------- */
function renderLogin() {
  $("#app").innerHTML = `<div class="login"><div class="card">
    <div class="brand" style="margin-bottom:14px"><span class="mark">BROS</span><span class="name">Klantenportaal</span></div>
    <h1>Inloggen</h1><p>Volg je project: meetstaat, facturen, planning en documenten.</p>
    <form id="loginForm"><div class="field"><label for="email">E-mailadres</label><input id="email" type="email" required autocomplete="username" placeholder="naam@voorbeeld.be"></div>
    <div class="field"><label for="password">Wachtwoord</label><input id="password" type="password" required autocomplete="current-password"></div>
    <button class="btn primary" type="submit" id="loginBtn" style="width:100%;justify-content:center">Inloggen</button></form>
    <div class="msg${loginNotice ? " err" : ""}" id="loginMsg">${esc(loginNotice)}</div>
    <p style="margin:14px 0 0;font-size:13px"><button class="btn ghost sm" type="button" id="loginForgot">Wachtwoord vergeten of nog geen wachtwoord?</button></p></div></div>`;
  $("#loginForgot").onclick = async () => {
    loginNotice = ""; const email = $("#email").value.trim(); const m = $("#loginMsg"); m.className = "msg"; m.textContent = "";
    if (!email) { m.className = "msg err"; m.textContent = "Vul eerst je e-mailadres in."; $("#email").focus(); return; }
    $("#loginForgot").disabled = true;
    let error = null;
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
    <div class="brand" style="margin-bottom:14px"><span class="mark">BROS</span><span class="name">Klantenportaal</span></div>
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
    history.replaceState(null, "", location.pathname); S.setPassword = false; S.passwordForced = false; start();
  };
}

/* ---------- vuurwerk bij het eerste bezoek ---------- */
function vuurwerk(naam, kop) {
  const fx = $("#fx"), cv = fx.querySelector("canvas"), ctx = cv.getContext("2d"); $("#fxTxt").innerHTML = kop ? `${esc(kop)}<small>Je akkoord is vastgelegd. We gaan ermee aan de slag.</small>` : `Welkom${naam ? ", " + esc(naam) : ""}!<small>Fijn dat je er bent. Dit is jouw plek om je project te volgen.</small>`;
  fx.classList.add("show"); cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio; ctx.scale(devicePixelRatio, devicePixelRatio);
  const parts = []; const kleuren = ["#2A4DD0", "#E2A84C", "#2E7D4F", "#D0413A", "#8A4BC7", "#0F7C8C"];
  const knal = (x, y) => { const k = kleuren[Math.floor(Math.random() * kleuren.length)]; for (let i = 0; i < 70; i++) { const a = Math.random() * Math.PI * 2, v = 2 + Math.random() * 5; parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 60 + Math.random() * 40, k }); } };
  let t = 0; const timer = setInterval(() => { knal(innerWidth * (0.15 + Math.random() * 0.7), innerHeight * (0.15 + Math.random() * 0.5)); if (++t > 7) clearInterval(timer); }, 450);
  const loop = () => { ctx.clearRect(0, 0, innerWidth, innerHeight); for (const p of parts) { p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.vx *= 0.985; p.vy *= 0.985; p.life--; ctx.globalAlpha = Math.max(0, p.life / 80); ctx.fillStyle = p.k; ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2); ctx.fill(); }
    for (let i = parts.length - 1; i >= 0; i--) if (parts[i].life <= 0) parts.splice(i, 1); if (fx.classList.contains("show")) requestAnimationFrame(loop); };
  loop(); setTimeout(() => { fx.classList.remove("show"); ctx.clearRect(0, 0, innerWidth, innerHeight); }, 5400);
  fx.onclick = () => { fx.classList.remove("show"); clearInterval(timer); };
}

/* ---------- gebeurtenissen ---------- */
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-tab],[data-act]"); if (!el) return;
  if (el.dataset.tab) { S.tab = el.dataset.tab; render(); }
  if (el.dataset.act === "logout") sb.auth.signOut().then(() => location.reload());
  if (el.dataset.act === "gk-nee") { const box = $("#gk_nee_" + el.dataset.id); box.hidden = !box.hidden; if (!box.hidden) box.querySelector("textarea").focus(); }
  if (el.dataset.act === "gk-toon") { S.gkOpen = S.gkOpen === el.dataset.id ? null : el.dataset.id; render(); }
  if (el.dataset.act === "note-toggle") { S.noteOpen = S.noteOpen === el.dataset.id ? null : el.dataset.id; render(); }
});
document.addEventListener("submit", (e) => {
  if (e.target.id === "chatForm") { e.preventDefault(); const v = e.target.vraag.value.trim(); if (!v || S.chatBezig) return; vraagStellen(P(), v); return; }
  const form = e.target.closest("form.gk-form"); if (!form) return; e.preventDefault();
  const id = form.dataset.gk; const beslissing = e.submitter?.dataset.beslissing || "akkoord"; const naam = form.querySelector('[name="naam"]').value.trim();
  const m = form.querySelector(".msg");
  if (!naam) { m.className = "msg err"; m.textContent = "Vul je naam in."; return; }
  if (beslissing === "akkoord") { if (!form.querySelector('[name="ok"]').checked) { m.className = "msg err"; m.textContent = "Vink aan dat je akkoord gaat."; return; } gkBeslis(id, true, naam, "", form); }
  else { const opm = form.querySelector('[name="opmerking"]').value.trim(); if (!opm) { m.className = "msg err"; m.textContent = "Schrijf kort wat je wil aanpassen of vragen."; return; } gkBeslis(id, false, naam, opm, form); }
});
document.addEventListener("change", async (e) => {
  if (e.target.id === "projSel") { S.project = e.target.value; render(); }
  if (e.target.dataset.mijntaak) { const id = e.target.dataset.mijntaak, klaar = e.target.checked; e.target.disabled = true;
    const { error } = await sb.rpc("klant_taak_klaar", { p_id: id, p_klaar: klaar });
    if (error) { toast("Dat lukte niet: " + error.message); e.target.checked = !klaar; e.target.disabled = false; return; }
    D().mijnTaken.forEach(t => { if (t.id === id) t.status = klaar ? "done" : "todo"; }); D().notitieTaken.forEach(t => { if (t.id === id) t.status = klaar ? "done" : "todo"; }); render(); toast(klaar ? "Afgevinkt — bedankt!" : "Weer open gezet"); }
});

async function start() {
  S.ready = false; render();
  try { await loadAll(); S.ready = true; S.loadError = null; render(); if (S.eersteBezoek && S.me?.role === "klant" && D().projecten.length) vuurwerk(voornaam()); }
  catch (e) { S.loadError = e.message || String(e); render(); }
}
async function boot() {
  render();
  const { data: { session } } = await sb.auth.getSession(); S.session = session;
  if (session && (URL_AUTH.type === "invite" || URL_AUTH.type === "recovery" || URL_AUTH.type === "magiclink")) { S.setPassword = true; S.passwordForced = true; }
  render();
  sb.auth.onAuthStateChange((evt, sess) => {
    const had = !!S.session; S.session = sess;
    if (evt === "PASSWORD_RECOVERY" && sess) { S.setPassword = true; S.passwordForced = true; render(); return; }
    if (sess && !had && !S.setPassword) start();
    if (!sess) { S.ready = false; S.setPassword = false; render(); }
  });
  if (session && !S.setPassword) start();
}
boot();
