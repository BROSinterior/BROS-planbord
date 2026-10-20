/* =====================================================================
   BROS Aannemersportaal — wat een aannemer/leverancier van zijn projecten ziet en doet
   Leest uitsluitend de aan_*-views (databasescript 025): enkel de projecten en loten waaraan hij gekoppeld is,
   nooit prijzen van BROS of van andere aannemers. Schrijven gaat via functies (opgelost melden, prijzen, vragen).
   ===================================================================== */
if (window.top !== window.self) { try { window.top.location.replace(window.location.href); } catch (e) { document.documentElement.innerHTML = ""; } }   // niet in een vreemd frame (clickjacking)
const PORTAAL_VERSION = "1.49.0";
const todayLocal = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; };
const safeUrl = (u) => /^https?:\/\//i.test(String(u || "")) ? u : "#";
const cfg = window.PLANBORD_CONFIG || {};
const VB = window.BROS_VOORBEELD || { start: () => undefined, installeer: () => { }, rol: null };   // testmodus (script 038)
const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, VB.start("aannemer")); VB.installeer(sb, cfg);
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = (n, dec = 2) => Number(n || 0).toLocaleString("nl-BE", { style: "currency", currency: "EUR", minimumFractionDigits: dec, maximumFractionDigits: dec });
const nl = (n, dec = 2) => Number(n || 0).toLocaleString("nl-BE", { minimumFractionDigits: 0, maximumFractionDigits: dec });
/* bedragen zoals een Belg ze typt: 12,50 · 1.250,75 · 12.5 — leeg = null, onleesbaar = NaN */
const leesGetal = (raw) => { let t = String(raw ?? "").trim().replace(/[\s€\u00a0]/g, ""); if (!t) return null; if (t.includes(",") && t.includes(".")) { t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, ""); } else if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ""); /* 1.250 = duizendtal (Belgische schrijfwijze) */ else t = t.replace(",", "."); const n = Number(t); return Number.isFinite(n) ? n : NaN; };
/* "2.375" kan 2375 (Belgisch duizendtal) of 2,375 zijn: even vragen */
const duizendKeuze = (raw, n) => { const t = String(raw ?? "").trim().replace(/[\s€\u00a0]/g, ""); if (n == null || Number.isNaN(n) || !/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(t)) return n; const dec = Number(t.replace(/\./g, (m, i) => i === t.indexOf(".") ? "." : "")); return confirm(`Je typte ${t}.\n\nOK = ${n.toLocaleString("nl-BE")} (duizendtal)\nAnnuleren = ${String(dec).replace(".", ",")}`) ? n : dec; };
const fmt = (s) => { if (!s) return "—"; const [y, m, d] = s.slice(0, 10).split("-"); return `${d}/${m}/${y}`; };
const MAAND = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const fmtLang = (s) => { if (!s) return "—"; const d = new Date(s.slice(0, 10) + "T00:00:00"); return `${d.getDate()} ${MAAND[d.getMonth()]} ${d.getFullYear()}`; };
const PROJ_STATUS = { offerte: "In offerte", lopend: "In uitvoering", on_hold: "Even gepauzeerd", afgerond: "Opgeleverd", verloren: "Niet doorgegaan" };
const VS_STATUS = { open: "Open", opgelost: "Opgelost — wacht op controle", gecontroleerd: "Gecontroleerd", vervallen: "Vervallen" };
const PA_STATUS = { open: "In te vullen", ingediend: "Ingediend", gekozen: "Gegund", afgesloten: "Afgesloten", niet_weerhouden: "Niet weerhouden" };
const VR_STATUS = { open: "In behandeling", bevestigd: "Opgenomen als taak", geweigerd: "Niet weerhouden", beantwoord: "Beantwoord" };
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

const START_T = (() => { const v = new URLSearchParams(location.search).get("t") || ""; return /^(overzicht|werf|prijzen|meetstaat|facturen|plannen|documenten|planning|vragen|team)$/.test(v) ? v : null; })();   // 1.49: ?p=<project>&t=facturen opent meteen dat tabblad
const START_P = (() => { const v = new URLSearchParams(location.search).get("p") || ""; return /^[\w-]{1,64}$/.test(v) ? v : null; })();   // ?p=<project> opent meteen dat project
const S = { session: null, me: null, ready: false, loadError: null, setPassword: false, tab: "overzicht", project: START_P, data: null, vsFilter: "open", detail: null, aanvraag: null, nieuw: [], bezig: false };
let loginNotice = URL_AUTH.error ? (/expired|invalid|otp/i.test(URL_AUTH.error) ? "Deze link is vervallen of al gebruikt. Log in met je wachtwoord, of vraag hieronder een nieuwe link aan." : "Er ging iets mis met de link: " + URL_AUTH.error) : "";
function toast(msg, ms = 3500) { document.querySelectorAll(".toast").forEach(x => x.remove()); const t = document.createElement("div");   // 1.49: één melding tegelijk (niet over elkaar)
  t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), ms); }

/* ---------- gegevens ---------- */
async function loadAll() {
  // per 1000 rijen ophalen, altijd in een vaste volgorde (anders vallen er bij grote meetstaten posten weg)
  const ORDE = { fasen: ["nr"], aan_planning: ["project_id", "fase_nr"], aan_prijsaanvraag_posten: ["aanvraag_id", "post_id"] };
  const q = async (v, sel = "*", opt = false) => { const PAGE = 1000; let all = [];
    for (let from = 0; ; from += PAGE) {
      let r = sb.from(v).select(sel); (ORDE[v] || ["id"]).forEach(c => { r = r.order(c, { ascending: true }); }); r = await r.range(from, from + PAGE - 1);
      if (r.error) { if (opt) return []; throw new Error(v + ": " + r.error.message); }
      all = all.concat(r.data || []); if (!r.data || r.data.length < PAGE) return all;
    } };
  const [me, projecten, vs, plannen, verslagen, documenten, planning, planTaken, taken, aanvragen, aanvraagPosten, vragen, team, ik, meetstaat, prijzenMs, fasen, loten, inst, pvProj, afspraken, facturen] = await Promise.all([
    sb.from("profiles").select("id,name,email,role").eq("id", S.session.user.id).maybeSingle().then(r => r.data),
    q("aan_project"), q("aan_vaststellingen"), q("aan_werfplannen"), q("aan_werfverslagen"), q("aan_documenten"), q("aan_planning"), q("aan_planning_taken"),
    q("aan_taken"), q("aan_prijsaanvragen"), q("aan_prijsaanvraag_posten"), q("aan_vragen"), q("klant_team", "*", true), q("klant_ik", "*", true), q("aan_meetstaat", "*", true), q("aan_meetstaat_prijzen", "*", true),
    q("fasen"), sb.from("loten_v").select("nr,naam").then(r => r.error ? [] : (r.data || [])),
    sb.from("instellingen").select("value").eq("key", "portaal").maybeSingle().then(r => r.data?.value || {}),
    q("aan_prijsvraag_projecten", "*", true),   // script 037: projecten waarvoor hij enkel een prijsvraag kreeg
    q("aan_afspraken", "*", true),              // script 041: afspraken waarvoor hij uitgenodigd is
    q("aan_facturen", "*", true),               // script 047: zijn facturen
  ]);
  pvProj.filter(x => !projecten.some(p => p.id === x.id)).forEach(x => projecten.push({ id: x.id, nummer: x.nummer, gemeente: x.gemeente, klant: "", naam: "", kandidaat: true, mijn_loten: [] }));
  S.me = me; S.voorbeeldFout = false;
  if (VB.rol) { const vb = await VB.laad(sb); if (vb && me && me.role === "beheer") { S.me = { ...me, role: "aannemer", name: vb.naam }; VB.balk(); } else S.voorbeeldFout = true; }
  S.data = { projecten: projecten.sort((a, b) => (b.nummer || "").localeCompare(a.nummer || "")), vs: vs.sort((a, b) => (b.nr || 0) - (a.nr || 0)), plannen: plannen.sort((a, b) => (a.volgorde || 0) - (b.volgorde || 0)),
    verslagen: verslagen.sort((a, b) => (b.nr || 0) - (a.nr || 0)), documenten, planning, planTaken, taken, aanvragen: aanvragen.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")), aanvraagPosten, vragen: vragen.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    afspraken, facturen, team, ik, meetstaat, prijzenMs, fasen: fasen.filter(f => f.actief !== false).sort((a, b) => a.nr - b.nr), loten: Object.fromEntries(loten.map(l => [l.nr, l])), inst };
  // 1.46: met meer dan één project start het portaal op de projectenlijst (S.project = null); met één project meteen dat project
  if (S.project && !projecten.some(p => p.id === S.project)) { S.project = null; S.detail = null; S.aanvraag = null; }
  if (!S.project && projecten.length === 1) S.project = projecten[0].id;
  if (START_T && !S.startTGedaan) { if (S.project) S.tab = START_T; S.startTGedaan = true; }   // enkel bij de eerste keer laden
  sb.rpc("portaal_bezoek").then(() => { });
}
const D = () => S.data;
const P = () => D().projecten.find(p => p.id === S.project);
const voornaam = () => { const n = (S.me?.name || D().ik[0]?.naam || "").trim(); return n.split(/\s+/)[0] || n; };
const msOf = (pid) => D().meetstaat.filter(r => r.project_id === pid).sort((a, b) => a.lot - b.lot || (a.volgorde ?? 0) - (b.volgorde ?? 0) || String(a.code).localeCompare(String(b.code), "nl", { numeric: true }));
const lotNaam = (nr) => D().loten[nr] ? `${nr}. ${D().loten[nr].naam}` : String(nr);
const faseNaam = (nr) => D().fasen.find(f => f.nr === nr)?.naam || "";
const vsOf = (pid) => D().vs.filter(v => v.project_id === pid);
const vsNr = (v) => "V-" + String(v.nr || 0).padStart(3, "0");
const isLate = (v) => v.status === "open" && v.deadline && v.deadline < todayLocal();
const vsPill = (v) => v.te_beoordelen && v.status === "open" ? `<span class="pill ingediend">Voorgelegd aan BROS</span>` : v.door_mij && v.status === "vervallen" ? `<span class="pill vervallen">Niet weerhouden</span>` : isLate(v) ? `<span class="pill late">Te laat · ${fmt(v.deadline)}</span>` : `<span class="pill ${v.status}">${VS_STATUS[v.status] || v.status}</span>`;
const vsAntwoord = (v) => v.bros_antwoord ? `<div style="font-size:14px;margin:8px 0 14px;padding:10px 12px;background:var(--blue-soft);border-left:3px solid var(--blue);border-radius:8px"><b>Antwoord van BROS${v.beantwoord_naam ? " (" + esc(v.beantwoord_naam) + ")" : ""}${v.beantwoord_op ? " · " + fmt(v.beantwoord_op) : ""}:</b><div style="white-space:pre-line;margin-top:2px">${esc(v.bros_antwoord)}</div></div>` : "";   // script 043
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
  if (S.voorbeeldFout) { $("#app").innerHTML = VB.foutHtml("Aannemersportaal"); return; }
  if (S.me && S.me.role !== "aannemer") { $("#app").innerHTML = `<div class="login"><div class="card"><div class="brand" style="margin-bottom:14px"><span class="mark">BROS</span><span class="name">Aannemersportaal</span></div><h1>Dit is het aannemersportaal</h1><p>Je bent ingelogd als ${S.me.role === "klant" ? "klant" : "teamlid"} (${esc(S.me.email || "")}).</p><p><a class="btn primary" href="${S.me.role === "klant" ? "../klant/" : "../"}">${S.me.role === "klant" ? "Naar het klantenportaal" : "Naar het Planbord"}</a> <button class="btn ghost" data-act="logout">Uitloggen</button></p></div></div>`; return; }
  if (!D().projecten.length) { $("#app").innerHTML = `<div class="login"><div class="card"><div class="brand" style="margin-bottom:14px"><span class="mark">BROS</span><span class="name">Aannemersportaal</span></div><h1>Nog geen project gekoppeld</h1><p>Je login werkt, maar er is nog geen project aan je gekoppeld. Laat het ons weten via ${esc(D().inst.contact_email || "info@bros.be")}.</p><p><button class="btn ghost" data-act="logout">Uitloggen</button></p></div></div>`; return; }
  if (!P()) { renderHome(); return navBewaar(); }
  const p = P(); const vs = vsOf(p.id);
  const nAf = afOf(p.id).filter(f => f.status === "betwist").length;
  const nOpen = vs.filter(v => v.status === "open" && !v.te_beoordelen && v.aan_mij !== false).length, nPa = D().aanvragen.filter(a => a.project_id === p.id && a.status === "open").length, nTk = D().taken.filter(t => t.project_id === p.id && !t.vaststelling_id && t.status !== "done").length;
  const badge = (n) => n ? ` <span class="badge">${n}</span>` : "";
  if (p.kandidaat) S.tab = "prijzen";
  const tabs = p.kandidaat ? [["prijzen", "Prijsaanvragen" + badge(nPa)]] : [["overzicht", "Overzicht"], ["werf", "Werfpunten" + badge(nOpen)], ["prijzen", "Prijsaanvragen" + badge(nPa)], ...(msOf(p.id).length || mpOf(p.id).length ? [["meetstaat", "Meetstaat" + badge(mpOf(p.id).filter(m => m.status === "gedeeld").length)]] : []), ["facturen", "Facturen" + badge(nAf)], ["plannen", "Plannen"], ["documenten", "Documenten"], ["planning", "Planning"], ["vragen", "Vragen" + badge(nTk)], ["team", "Wie is wie"]];
  $("#app").innerHTML = `<header class="top"><div class="top-in"><div class="brand"><span class="mark">BROS</span><span class="name">Aannemersportaal</span></div>
      <div class="who"><span>${esc(S.me?.name || "")}</span><button class="btn ghost sm" data-act="vernieuw" title="Vernieuwen">↻<span class="hide-sm"> Vernieuwen</span></button><button class="btn sm ${S.hulp ? "primary" : ""}" data-act="hulp">Hulp</button><button class="btn ghost sm" data-act="logout">Uitloggen</button></div></div>
    ${D().projecten.length > 1 ? `<div class="projbar"><button class="terug" data-act="home">‹ Alle projecten <span class="muted">(${D().projecten.length})</span></button><span class="pt">${esc(p.nummer || "")}${p.nummer ? " · " : ""}${projTitel(p)}</span></div>` : ""}
    <nav class="tabs">${tabs.map(([k, l]) => `<button class="${S.tab === k && !S.hulp ? "on" : ""}" data-tab="${k}">${l}</button>`).join("")}</nav></header>
    <main>${S.hulp ? vHulp() : (({ overzicht: vOverzicht, werf: vWerf, prijzen: vPrijzen, meetstaat: vMeetstaat, facturen: vFacturen, plannen: vPlannen, documenten: vDocumenten, planning: vPlanning, vragen: vVragen, team: vTeam })[S.tab] || vOverzicht)(p)}</main>`;
  window.scrollTo({ top: 0 });
  navBewaar();
}
/* ---------- 1.46: projectenlijst + terugknop van de telefoon/browser ---------- */
const navNu = () => ({ project: S.project || null, tab: S.project ? S.tab : null, detail: S.project ? S.detail || null : null, aanvraag: S.project ? S.aanvraag || null : null });
const navSleutel = (n) => [n.project, n.tab, n.detail, n.aanvraag].join("|");
function navBewaar() {   // elke stap (project, tabblad, punt) wordt een stap in de geschiedenis: "terug" brengt je terug i.p.v. het portaal te verlaten
  try {
    const nu = navNu(), oud = history.state && history.state.bros;
    if (!oud || S.navHerstel) history.replaceState({ ...(history.state || {}), bros: nu }, "");
    else if (navSleutel(oud) !== navSleutel(nu)) history.pushState({ bros: nu }, "");
  } catch (e) { }
  S.navHerstel = false;
}
window.addEventListener("popstate", (e) => {
  const n = e.state && e.state.bros; if (!n || !S.ready || !S.data) return;
  try { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); } catch (x) { }   // een net getypte prijs of opmerking eerst bewaren (change-event)
  S.nieuw.forEach(f => URL.revokeObjectURL(f.url)); S.nieuw = []; S.opm = "";
  S.project = n.project && D().projecten.some(p => p.id === n.project) ? n.project : (D().projecten.length === 1 ? D().projecten[0].id : null);
  S.tab = n.tab || "overzicht"; S.detail = n.detail || null; S.aanvraag = n.aanvraag || null; S.navHerstel = true; render();
});
function projectOpenen(id, tab) {
  if (!D().projecten.some(p => p.id === id)) return;
  S.nieuw.forEach(f => URL.revokeObjectURL(f.url)); S.nieuw = []; S.opm = "";
  S.project = id; S.tab = tab || "overzicht"; S.detail = null; S.aanvraag = null; S.vsFilter = "open"; render();
}
function projTellers(p) {
  const vs = vsOf(p.id), open = vs.filter(v => v.status === "open" && !v.te_beoordelen && v.aan_mij !== false);
  return { open: open.length, laat: open.filter(isLate).length, wacht: vs.filter(v => v.status === "opgelost" && v.aan_mij !== false).length, voorgelegd: vs.filter(v => v.te_beoordelen && v.status === "open" && v.door_mij).length,
    pa: D().aanvragen.filter(a => a.project_id === p.id && a.status === "open").length, tk: D().taken.filter(t => t.project_id === p.id && !t.vaststelling_id && t.status !== "done").length,
    mp: mpOf(p.id).filter(m => m.status === "gedeeld").length, af: afOf(p.id).filter(f => f.status === "betwist").length, afs: window.BROS_AGENDA ? BROS_AGENDA.komend((D().afspraken || []).filter(a => a.project_id === p.id)).length : 0 };
}
function projKaart(p) {
  const t = projTellers(p), id = esc(p.id);
  const knop = (tab, n, label, cls = "") => n ? `<button class="chip ${cls}" data-act="proj" data-id="${id}" data-t="${tab}">${label}</button>` : "";
  const chips = p.kandidaat ? knop("prijzen", t.pa, `${t.pa} prijsaanvra${t.pa === 1 ? "ag" : "gen"} in te vullen`, "let")
    : [knop("werf", t.open, `${t.open} open werfpunt${t.open === 1 ? "" : "en"}${t.laat ? ` · ${t.laat} te laat` : ""}`, t.laat ? "laat" : "let"), knop("vragen", t.tk, `${t.tk} actiepunt${t.tk === 1 ? "" : "en"}`, "let"),
       knop("prijzen", t.pa, `${t.pa} prijsaanvra${t.pa === 1 ? "ag" : "gen"}`, "let"), knop("meetstaat", t.mp, "meetstaat ter goedkeuring", "let"), knop("facturen", t.af, `vraag over ${t.af === 1 ? "een factuur" : t.af + " facturen"}`, "laat"), knop("werf", t.wacht, `${t.wacht} wacht${t.wacht === 1 ? "" : "en"} op controle`),
       knop("werf", t.voorgelegd, `${t.voorgelegd} voorgelegd aan BROS`), knop("overzicht", t.afs, `${t.afs} afspra${t.afs === 1 ? "ak" : "ken"}`)].join("");
  const sub = p.kandidaat ? "Prijsvraag" + (p.gemeente ? " · " + esc(p.gemeente) : "") : [esc(p.gemeente || ""), PROJ_STATUS[p.status] || esc(p.status || ""), p.fase_nr ? "stap " + p.fase_nr + " · " + esc(faseNaam(p.fase_nr)) : ""].filter(Boolean).join(" · ");
  return `<div class="pcard${t.laat ? " laat" : ""}"><button class="pk" data-act="proj" data-id="${id}" data-t="${p.kandidaat ? "prijzen" : "overzicht"}"><span class="nr">${esc(p.nummer || "")}</span><b>${projTitel(p)}</b><small>${sub}</small>${(p.mijn_loten || []).length ? `<small>${p.mijn_loten.map(lotNaam).map(esc).join(", ")}</small>` : ""}<span class="pijl" aria-hidden="true">›</span></button>
    <div class="pchips">${chips || `<span class="muted" style="font-size:13px">${p.kandidaat ? "niets in te vullen" : "niets open — alles afgewerkt"}</span>`}</div></div>`;
}
function renderHome() {
  const ps = D().projecten, lopend = ps.filter(p => !p.kandidaat && !["afgerond", "verloren"].includes(p.status)), pv = ps.filter(p => p.kandidaat), af = ps.filter(p => !p.kandidaat && ["afgerond", "verloren"].includes(p.status));
  const tot = ps.reduce((s, p) => { const t = projTellers(p); s.open += t.open; s.laat += t.laat; s.tk += t.tk; s.pa += t.pa; return s; }, { open: 0, laat: 0, tk: 0, pa: 0 });
  const samen = [tot.open ? `${tot.open} open werfpunt${tot.open === 1 ? "" : "en"}${tot.laat ? ` (${tot.laat} te laat)` : ""}` : "", tot.tk ? `${tot.tk} actiepunt${tot.tk === 1 ? "" : "en"}` : "", tot.pa ? `${tot.pa} prijsaanvra${tot.pa === 1 ? "ag" : "gen"} in te vullen` : ""].filter(Boolean);
  const sectie = (titel, lijst) => lijst.length ? `<h2 style="margin:22px 0 10px">${titel}</h2><div class="pcards">${lijst.map(projKaart).join("")}</div>` : "";
  $("#app").innerHTML = `<header class="top"><div class="top-in"><div class="brand"><span class="mark">BROS</span><span class="name">Aannemersportaal</span></div>
      <div class="who"><span>${esc(S.me?.name || "")}</span><button class="btn ghost sm" data-act="vernieuw" title="Vernieuwen">↻<span class="hide-sm"> Vernieuwen</span></button><button class="btn sm ${S.hulp ? "primary" : ""}" data-act="hulp">Hulp</button><button class="btn ghost sm" data-act="logout">Uitloggen</button></div></div></header>
    <main>${S.hulp ? vHulp() : `<div class="hero"><div class="eyebrow">Je projecten bij BROS</div><h1>Dag ${esc(voornaam())}</h1>
      <p class="lead">Kies een project: per project vind je de werfpunten, actiepunten, prijsaanvragen, plannen en documenten.${samen.length ? ` In totaal staan er ${samen.join(", ")} voor je klaar.` : ""}</p></div>
      ${ps.length > 1 || teDoen().length ? teDoenHtml() : ""}
      ${window.BROS_AGENDA ? BROS_AGENDA.paneel(D().afspraken || [], { esc, datum: fmtLang, project: (a) => [a.project_nummer, a.project_klant || a.project_gemeente].filter(Boolean).join(" · ") }) : ""}
      ${sectie("Lopende projecten", lopend)}${sectie("Prijsvragen", pv)}
      ${af.length ? `<details class="afg"><summary>Afgeronde projecten (${af.length})</summary><div class="pcards" style="margin-top:10px">${af.map(projKaart).join("")}</div></details>` : ""}`}</main>`;
  window.scrollTo({ top: 0 });
}
const projTitel = (p) => p.kandidaat ? `Project ${esc(p.nummer || "")}${p.gemeente ? " · " + esc(p.gemeente) : ""}` : `${esc(p.klant || "")}${p.naam && p.naam !== p.klant ? " · " + esc(p.naam) : ""}`;
function vOverzicht(p) {
  const vs = vsOf(p.id); const open = vs.filter(v => v.status === "open" && !v.te_beoordelen && v.aan_mij !== false), late = open.filter(isLate), wacht = vs.filter(v => v.status === "opgelost");
  const pa = D().aanvragen.filter(a => a.project_id === p.id && a.status === "open"); const tk = D().taken.filter(t => t.project_id === p.id && !t.vaststelling_id && t.status !== "done");
  const lead = D().team.find(t => t.id === p.lead); const inst = D().inst;
  return `<div class="hero"><div class="eyebrow">${esc(p.nummer || "")} · ${projTitel(p)}${(p.mijn_loten || []).length ? ` · ${p.mijn_loten.map(lotNaam).map(esc).join(", ")}` : ""}</div><h1>Dag ${esc(voornaam())}</h1>
      <p class="lead">${esc(inst.welkom_aannemer || "Hier vind je alles voor jouw werk op dit project: de open werfpunten, de plannen, de verslagen en de prijsaanvragen van BROS.")}</p></div>
    <div class="kpis"><button class="kpi" data-tab="werf" style="text-align:left;cursor:pointer;font:inherit;color:inherit"><div class="k">Open werfpunten</div><div class="v num" style="${late.length ? "color:var(--crit)" : ""}">${open.length}</div><div class="muted" style="font-size:12px">${late.length ? late.length + " over de datum" : wacht.length ? wacht.length + " wacht op controle door BROS" : "niets dringend"}</div></button>
      <button class="kpi" data-tab="prijzen" style="text-align:left;cursor:pointer;font:inherit;color:inherit"><div class="k">Prijsaanvragen</div><div class="v num">${pa.length}</div><div class="muted" style="font-size:12px">${pa.length ? "in te vullen" + (pa.some(a => a.deadline) ? " · vóór " + fmt(pa.filter(a => a.deadline).sort((a, b) => a.deadline.localeCompare(b.deadline))[0].deadline) : "") : "geen open aanvragen"}</div></button>
      <button class="kpi" data-tab="vragen" style="text-align:left;cursor:pointer;font:inherit;color:inherit"><div class="k">Actiepunten</div><div class="v num">${tk.length}</div><div class="muted" style="font-size:12px">${tk.length ? "uit verslagen en afspraken" : "alles afgewerkt"}</div></button>
      <div class="kpi"><div class="k">Project</div><div class="v" style="font-size:16px">${PROJ_STATUS[p.status] || esc(p.status)}</div><div class="muted" style="font-size:12px">${p.fase_nr ? "stap " + p.fase_nr + " · " + esc(faseNaam(p.fase_nr)) : ""}</div></div></div>
    ${window.BROS_AGENDA ? BROS_AGENDA.paneel((D().afspraken || []).filter(a => a.project_id === p.id), { esc, datum: fmtLang }) : ""}
    <div class="two"><div class="stack">
      <div class="panel"><div class="panel-head"><h2>Open werfpunten</h2><button class="btn sm" data-tab="werf">Alles →</button></div>${open.length ? `<div class="panel-body" style="display:grid;gap:8px">${open.slice(0, 5).map(vsCard).join("")}</div>` : `<div class="empty"><b>Geen open punten</b>Nieuwe vaststellingen van BROS verschijnen hier.</div>`}</div>
      ${mpOf(p.id).filter(m => m.status === "gedeeld").map(m => `<div class="panel" style="border-color:var(--blue)"><div class="panel-head"><h2>Meetstaat met prijzen ter goedkeuring</h2></div><div class="panel-body"><p>BROS deelde versie ${m.versie} van de meetstaat met jouw prijzen: ${(m.regels || []).length} posten, samen <b>${eur(mpTot(m))}</b> excl. btw. <button class="btn sm primary" data-tab="meetstaat">Bekijken en goedkeuren →</button></p></div></div>`).join("")}
      ${pa.length ? `<div class="panel" style="border-color:var(--blue)"><div class="panel-head"><h2>Prijsaanvraag in te vullen</h2></div><div class="panel-body">${pa.map(a => `<p><b>${esc(a.titel || "Prijsaanvraag")}</b> · ${a.loten.map(lotNaam).map(esc).join(", ")}${a.deadline ? (a.deadline < todayLocal() ? ` · <span class="pill late">gevraagd tegen ${fmt(a.deadline)}</span>` : ` · vóór ${fmt(a.deadline)}`) : ""} <button class="btn sm primary" data-act="pa-open" data-id="${a.id}">Invullen →</button></p>`).join("")}</div></div>` : ""}
    </div><div class="stack">
      <div class="panel"><div class="panel-head"><h2>Werf</h2></div><div class="panel-body"><p><b>${projTitel(p)}</b></p><p class="muted" style="font-size:14px">${esc([p.adres, [p.postcode, p.gemeente].filter(Boolean).join(" ")].filter(Boolean).join(", "))}</p>${p.start || p.eind ? `<p class="muted" style="font-size:13px">${p.start ? "gestart " + fmtLang(p.start) : ""}${p.eind ? " · geplande oplevering " + fmtLang(p.eind) : ""}</p>` : ""}</div></div>
      ${lead ? `<div class="panel"><div class="panel-head"><h2>Je aanspreekpunt bij BROS</h2></div><div class="panel-body"><div class="person">${avatar(lead, 56)}<div><b>${esc(lead.name)}</b><div class="muted" style="font-size:13px">${esc(lead.functie || "BROS")}</div></div></div></div></div>` : ""}
      <div class="panel"><div class="panel-head"><h2>Op de werf?</h2></div><div class="panel-body"><p style="font-size:14px">Open de <a href="../werf/?p=${esc(p.id)}">werfmodus</a> op je smartphone: je punten met foto, ook zonder bereik. Zet ze op je beginscherm als app.</p><p class="muted" style="font-size:13px;white-space:pre-line">${esc(inst.contact || "")}</p></div></div>
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
  return `<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start"><div><h1 style="margin-bottom:6px">Werfpunten</h1><p class="muted" style="margin-bottom:16px">Vaststellingen die BROS aan jou toewees, en de punten die je zelf meldde. Meld een punt als opgelost met een bewijsfoto; BROS controleert het daarna op de werf.</p></div>
    <a class="btn primary" href="../werf/?p=${esc(p.id)}" title="Werfmodus op je smartphone: foto's nemen, ook zonder bereik">📷 Nieuw punt melden</a></div>
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
    ${v.door_mij ? `<p class="muted" style="font-size:13px;margin:-4px 0 8px">${v.te_beoordelen && v.status === "open" ? "Door jou gemeld — BROS bekijkt het en wijst het daarna toe." : v.status === "vervallen" ? "Door jou gemeld — niet weerhouden door BROS." : v.aan_mij === false ? "Door jou gemeld — BROS nam het op en wees het toe aan een andere uitvoerder of het team." : "Door jou gemeld."}</p>` : ""}${vsAntwoord(v)}
    <div class="meta" style="margin-bottom:16px">${v.ruimte ? `<div>Ruimte: <b>${esc(v.ruimte)}</b></div>` : ""}${v.lot ? `<div>Lot: <b>${esc(lotNaam(v.lot))}</b></div>` : ""}${v.deadline ? `<div>Op te lossen tegen: <b class="${isLate(v) ? "late" : ""}">${fmtLang(v.deadline)}</b></div>` : ""}${v.bezoek_datum ? `<div>Vastgesteld bij het werfbezoek van <b>${fmtLang(v.bezoek_datum)}</b></div>` : ""}${v.opgelost_op ? `<div>Opgelost gemeld op <b>${fmtLang(v.opgelost_op.slice(0, 10))}</b></div>` : ""}</div>
    ${v.opmerking ? `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h2>Opmerkingen</h2></div><div class="panel-body" style="white-space:pre-line;font-size:14px">${esc(v.opmerking)}</div></div>` : ""}
    <div class="two"><div class="stack">
      ${v.status === "open" && !v.te_beoordelen && v.aan_mij !== false ? `<div class="panel" style="border-color:var(--ink)"><div class="panel-head"><h2>Opgelost melden</h2></div><div class="panel-body">
        <div class="big"><label>📷<span></span>Foto nemen<input type="file" accept="image/*" capture="environment" hidden data-file></label><label>🖼️<span></span>Uit galerij<input type="file" accept="image/*" multiple hidden data-file></label></div>
        <div class="fotos" id="f_fotos">${S.nieuw.map((f, i) => `<div class="fi"><img src="${f.url}" alt=""><button type="button" class="x" data-x="${i}">✕</button></div>`).join("")}</div>
        <div class="field" style="margin-top:12px"><label for="f_opm">Opmerking voor BROS (optioneel)</label><textarea id="f_opm" rows="3" placeholder="bv. Scharnier vervangen en deur bijgesteld — of: nog niet klaar, we wachten op …">${esc(S.opm || "")}</textarea></div>
        <div class="gk-actions"><button class="btn primary" data-act="vs-opgelost" data-id="${v.id}" ${S.bezig ? "disabled" : ""}>${S.bezig ? "Bezig…" : "✓ Opgelost melden"}</button><button class="btn" data-act="vs-foto" data-id="${v.id}" ${S.bezig || !S.nieuw.length && !(S.opm || "").trim() ? "disabled" : ""}>💬 Bewaren — nog niet opgelost</button></div>
        <p class="muted" style="font-size:12px;margin:10px 0 0">Klaar? Meld het als opgelost (een bewijsfoto helpt BROS om het punt sneller af te sluiten). Nog niet klaar of heb je een vraag? Schrijf het hierboven en kies <i>Bewaren — nog niet opgelost</i>: BROS krijgt je opmerking en kan erop reageren.</p></div></div>` : v.status === "opgelost" && !v.te_beoordelen && v.aan_mij !== false ? `<div class="panel"><div class="panel-body"><b>Gemeld als opgelost.</b> BROS controleert dit punt bij het volgende werfbezoek. Wil je nog een foto of opmerking toevoegen?
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
  return `<h1 style="margin-bottom:6px">Documenten en verslagen</h1><p class="muted" style="margin-bottom:16px">Werfverslagen die je ontving en de plannen en documenten die BROS met jou deelt — altijd de laatste versie.</p>
    ${ws.length ? `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h2>Werfverslagen</h2></div><table class="t"><tbody>${ws.map(w => `<tr><td class="num" style="width:60px">${w.nr}</td><td><b>${esc(w.titel || "Werfverslag " + w.nr)}</b><div class="muted" style="font-size:13px">${fmtLang(w.datum)} · ${w.punten} punt${w.punten === 1 ? "" : "en"}</div></td><td class="r"><a class="btn sm" href="${esc(safeUrl(w.pdf_url))}" target="_blank" rel="noopener">Pdf openen</a></td></tr>`).join("")}</tbody></table></div>` : ""}
    ${docs.length ? `<div class="stack">${groups.map(g => `<div class="panel"><div class="panel-head"><h3>${esc(g.replace(/\//g, " › ") || "Algemeen")}</h3></div><div class="panel-body" style="padding-top:4px;padding-bottom:4px">${docs.filter(d => (d.pad || "") === g).map(d => `<a class="doc" href="${esc(safeUrl(d.url))}" target="_blank" rel="noopener"><span class="ic">${esc(ext(d.naam))}</span><span><div class="nm">${esc(d.naam)}</div><small>${d.gewijzigd ? fmt(d.gewijzigd) : ""}${d.grootte ? " · " + size(d.grootte) : ""}</small></span></a>`).join("")}</div></div>`).join("")}</div>` : `<div class="panel"><div class="empty"><b>Nog geen documenten gedeeld</b>Zodra BROS plannen of documenten met jou deelt, verschijnen ze hier.</div></div>`}`;
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
/* ---------- Meetstaat: de posten van mijn loten (zonder prijzen) + pdf om door te sturen ---------- */
const MS_TAG = { meerwerk: "meerwerk", minwerk: "minwerk" };
const msHoev = (r) => Number(r.hoeveelheid) ? nl(r.hoeveelheid, 2) : (r.prijstype && r.prijstype !== "EP" ? r.prijstype : "");
function vMeetstaat(p) {
  const prijzen = vPrijzenMs(p);
  const rows = msOf(p.id); const lots = [...new Set(rows.map(r => r.lot))];
  if (!rows.length) return `<h1 style="margin-bottom:16px">Meetstaat</h1>` + prijzen;
  const chk = (id, label, on, uitleg) => `<label style="display:flex;gap:8px;align-items:flex-start;margin:6px 0;cursor:pointer"><input type="checkbox" id="${id}" ${on ? "checked" : ""} style="margin-top:3px"><span>${label}${uitleg ? `<small class="muted" style="display:block">${uitleg}</small>` : ""}</span></label>`;
  return `<h1 style="margin-bottom:6px">Meetstaat</h1>${prijzen}<p class="muted" style="margin-bottom:16px">${prijzen ? "Hieronder: " : ""}De posten van ${lots.length === 1 ? "jouw lot" : "jouw loten"} in dit project, met hoeveelheden en eenheden — zonder prijzen. Maak er een pdf van om door te sturen naar je eigen onderaannemers of leveranciers.</p>
    <div class="panel" style="margin-bottom:16px"><div class="panel-head"><h2>Pdf maken</h2><button class="btn primary" data-act="ms-pdf">Pdf downloaden</button></div><div class="panel-body" style="padding:12px 18px 16px">
      ${lots.length > 1 ? `<div style="margin-bottom:8px"><div class="muted" style="font-size:13px;margin-bottom:2px">Loten</div>${lots.map(l => chk("msp_lot_" + l, esc(lotNaam(l)), true)).join("")}</div>` : ""}
      ${chk("msp_leeg", "Lege kolommen voor eenheidsprijs en totaal", true, "Zo kan je onderaannemer zijn prijzen meteen invullen; onderaan staan velden voor firma, datum en handtekening.")}
      ${chk("msp_ruimte", "Per ruimte groeperen", false, "Anders per lot in de volgorde van de meetstaat.")}
      ${chk("msp_klant", "Naam en adres van de klant vermelden", false, "Standaard staat enkel het projectnummer en de gemeente op de pdf.")}
      <label for="msp_bericht" class="muted" style="display:block;font-size:13px;margin:10px 0 4px">Bericht bovenaan (optioneel)</label>
      <textarea id="msp_bericht" rows="2" style="width:100%;font:inherit;padding:8px 10px;border:1px solid var(--line-2,#ccc);border-radius:8px" placeholder="bv. Graag je prijs voor deze posten tegen vrijdag."></textarea>
    </div></div>
    ${lots.map(l => { const rs = rows.filter(r => r.lot === l);
      return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h3>${esc(lotNaam(l))}</h3><span class="muted" style="font-size:13px">${rs.length} post${rs.length === 1 ? "" : "en"}</span></div><div class="tw"><table class="t"><thead><tr><th>Nr</th><th>Omschrijving</th><th style="text-align:right">Hoeveelheid</th><th>Eenheid</th></tr></thead><tbody>${rs.map(r => `<tr><td class="num muted" style="white-space:nowrap">${esc(r.code || "")}</td><td>${esc(r.omschrijving)}${r.locatie ? ` <small class="muted">· ${esc(r.locatie)}</small>` : ""}${MS_TAG[r.status] ? ` <span class="pill">${MS_TAG[r.status]}</span>` : ""}</td><td class="num" style="text-align:right">${esc(msHoev(r))}</td><td>${esc(r.eenheid || "")}</td></tr>`).join("")}</tbody></table></div></div>`; }).join("")}`;
}
async function loadJsPdf() {
  if (window.jspdf && window.jspdf.jsPDF) return window.jspdf.jsPDF;
  await new Promise((res, rej) => { const el = document.createElement("script"); el.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"; el.onload = res; el.onerror = () => rej(new Error("De pdf-module kon niet geladen worden.")); document.head.appendChild(el); });
  return window.jspdf.jsPDF;
}
async function logoPng() {
  try { const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = "../logo-mark.svg"; }); const c = document.createElement("canvas"); c.width = 600; c.height = 181; c.getContext("2d").drawImage(img, 0, 0, 600, 181); return c.toDataURL("image/png"); } catch (e) { return null; }
}
async function msPdf(p) {
  const alle = msOf(p.id); const lotsAlle = [...new Set(alle.map(r => r.lot))];
  const lots = lotsAlle.length > 1 ? lotsAlle.filter(l => $("#msp_lot_" + l)?.checked) : lotsAlle;
  if (!lots.length) { toast("Kies minstens één lot."); return; }
  const o = { leeg: !!$("#msp_leeg")?.checked, ruimte: !!$("#msp_ruimte")?.checked, klant: !!$("#msp_klant")?.checked, bericht: ($("#msp_bericht")?.value || "").trim() };
  const rows = alle.filter(r => lots.includes(r.lot));
  const btn = $('[data-act="ms-pdf"]'); if (btn) { btn.disabled = true; btn.textContent = "Pdf maken…"; }
  try {
    const jsPDF = await loadJsPdf(); const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
    const W = 210, H = 297, M = 14, CW = W - 2 * M; let y = M; const logo = await logoPng();
    const ink = [29, 29, 31], muted = [134, 134, 139], line = [220, 220, 224], soft = [240, 240, 242];
    const clean = (t) => String(t || "").replace(/→/g, "->").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[•·]/g, "-").replace(/\u00a0|\u202f/g, " ");
    const projLabel = o.klant ? `${p.klant || ""}${p.naam && p.naam !== p.klant ? " - " + p.naam : ""}${p.adres ? ", " + p.adres : ""}${p.gemeente ? ", " + [p.postcode, p.gemeente].filter(Boolean).join(" ") : ""}` : `Project ${p.nummer || ""}${p.gemeente ? " - " + p.gemeente : ""}`;
    const cols = o.leeg
      ? [["Nr", 14, "l"], ["Omschrijving", 88, "l"], ["Hoev.", 18, "r"], ["Eenh.", 14, "l"], ["Eenheidsprijs", 24, "r"], ["Totaal", 24, "r"]]
      : [["Nr", 14, "l"], ["Omschrijving", 132, "l"], ["Hoev.", 22, "r"], ["Eenh.", 14, "l"]];
    const xs = []; let x = M; cols.forEach(c => { xs.push(x); x += c[1]; });
    const datum = fmt(todayLocal());
    const header = () => { if (logo) doc.addImage(logo, "PNG", M, 10, 26, 7.8); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...muted); doc.text(clean(`Meetstaat - ${projLabel} - ${datum}`), W - M, 15, { align: "right" }); doc.setDrawColor(...line); doc.line(M, 20, W - M, 20); y = 26; };
    const colHead = () => { doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...muted); cols.forEach((c, i) => doc.text(c[0].toUpperCase(), c[2] === "r" ? xs[i] + c[1] - 1 : xs[i] + 1, y + 3, { align: c[2] === "r" ? "right" : "left" })); doc.setDrawColor(...line); doc.line(M, y + 4.5, W - M, y + 4.5); y += 6; };
    const need = (h, metKop) => { if (y + h > H - 18) { doc.addPage(); header(); if (metKop) colHead(); } };
    header();
    doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(...ink); doc.text("Meetstaat", M, y + 5); y += 9;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...muted); doc.text(doc.splitTextToSize(clean(`${lots.map(lotNaam).join(", ")} - ${projLabel}`), CW), M, y + 4); y += 7 + (lots.length > 3 ? 4 : 0);
    if (o.bericht) { doc.setFontSize(9.5); doc.setTextColor(...ink); const ls = doc.splitTextToSize(clean(o.bericht), CW); doc.text(ls, M, y + 4); y += ls.length * 4.6 + 3; }
    if (o.leeg) { doc.setFontSize(8.5); doc.setTextColor(...muted); doc.text("Prijzen excl. btw, inclusief levering en plaatsing, tenzij anders vermeld. Hoeveelheden ter indicatie - te controleren ter plaatse.", M, y + 4); y += 7; }
    y += 2;
    lots.forEach(lot => {
      let lr = rows.filter(r => r.lot === lot); const rk = (r) => (r.locatie || "").trim();
      if (o.ruimte) lr = lr.slice().sort((a, b) => (rk(a) === "" ? 1 : 0) - (rk(b) === "" ? 1 : 0) || rk(a).localeCompare(rk(b), "nl", { sensitivity: "base" }) || (a.volgorde ?? 0) - (b.volgorde ?? 0));
      need(22); y += 3; doc.setFillColor(...soft); doc.roundedRect(M, y, CW, 8, 2, 2, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...ink); doc.text(clean(lotNaam(lot)), M + 3, y + 5.5); y += 10; colHead();
      let kop = null;
      lr.forEach(r => {
        const k = o.ruimte ? (rk(r) || "Zonder ruimte") : (r.groep || "");
        if (k && k !== kop) { kop = k; need(9, true); doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...muted); doc.text(clean(k).toUpperCase(), M + 1, y + 3.2); y += 5; }
        const tekst = clean(r.omschrijving) + (r.locatie && !o.ruimte ? "  (" + clean(r.locatie) + ")" : "") + (MS_TAG[r.status] ? "  [" + MS_TAG[r.status] + "]" : "");
        const oms = doc.splitTextToSize(tekst, cols[1][1] - 2); const h = Math.max(1, oms.length) * 3.9 + 2.4;
        need(h, true); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...ink);
        doc.text(clean(r.code || ""), xs[0] + 1, y + 3.2); doc.text(oms, xs[1] + 1, y + 3.2);
        doc.text(clean(msHoev(r)), xs[2] + cols[2][1] - 1, y + 3.2, { align: "right" }); doc.text(clean(r.eenheid || ""), xs[3] + 1, y + 3.2);
        if (o.leeg) { doc.setDrawColor(...line); doc.line(xs[4] + 3, y + h - 1.2, xs[4] + cols[4][1] - 1, y + h - 1.2); doc.line(xs[5] + 3, y + h - 1.2, xs[5] + cols[5][1] - 1, y + h - 1.2); }
        doc.setDrawColor(...line); doc.line(M, y + h, W - M, y + h); y += h;
      });
      if (o.leeg) { need(9); doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...ink); doc.text(clean("Totaal " + lotNaam(lot)), xs[4] - 2, y + 5, { align: "right" }); doc.setDrawColor(...muted); doc.line(xs[5] + 3, y + 5.6, W - M - 1, y + 5.6); y += 9; }
    });
    if (o.leeg) {
      need(46); y += 6; doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(...ink); doc.text("Totaal excl. btw", xs[4] - 2, y + 4, { align: "right" }); doc.setDrawColor(...ink); doc.line(xs[5] + 3, y + 4.8, W - M - 1, y + 4.8); y += 14;
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...muted); doc.setDrawColor(...line);
      [["Firma", M, 70], ["Naam", M + 76, 52], ["Datum", M + 134, 48]].forEach(([l, x0, w]) => { doc.text(l, x0, y); doc.line(x0, y + 8, x0 + w, y + 8); }); y += 16;
      doc.text("Handtekening", M, y); doc.line(M, y + 12, M + 70, y + 12);
    }
    const n = doc.getNumberOfPages(); for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(...muted); doc.text("Meetstaat opgemaakt door BROS - zonder prijzen van BROS", M, H - 8); doc.text(`${i} / ${n}`, W - M, H - 8, { align: "right" }); }
    const naam = `Meetstaat ${p.nummer || ""} ${lots.length === 1 ? lotNaam(lots[0]) : lots.length + " loten"}`.replace(/[^\w\s.-]+/g, "").replace(/\s+/g, " ").trim() + ".pdf";
    const url = URL.createObjectURL(doc.output("blob")); const a = document.createElement("a"); a.href = url; a.download = naam; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast("Pdf gedownload: " + naam);
  } catch (e) { toast("Pdf maken mislukt: " + (e.message || e), 6000); }
  finally { if (btn) { btn.disabled = false; btn.textContent = "Pdf downloaden"; } }
}
function vPrijzen(p) {
  const as = D().aanvragen.filter(a => a.project_id === p.id);
  if (S.aanvraag) { const a = as.find(x => x.id === S.aanvraag); if (a) return vAanvraag(p, a); S.aanvraag = null; }
  return `<h1 style="margin-bottom:6px">Prijsaanvragen</h1><p class="muted" style="margin-bottom:16px">BROS vraagt je een eenheidsprijs per post (excl. btw, inclusief levering en plaatsing tenzij anders vermeld). Je vult in, bewaart tussendoor en dient in zodra alles klopt. Je ziet nooit de prijzen van anderen.</p>
    ${as.length ? `<div class="panel"><table class="t"><thead><tr><th>Aanvraag</th><th>Loten</th><th>Reageren vóór</th><th>Status</th><th></th></tr></thead><tbody>${as.map(a => { const ps = paPosten(a).filter(x => !paKop(x)); const ing = ps.filter(x => x.eenheidsprijs != null || x.niet_aangeboden).length; const open = paOpen(a);
      return `<tr><td><b>${esc(a.titel || "Prijsaanvraag")}</b><div class="muted" style="font-size:12px">${fmt(a.created_at)} · ${ing} van ${ps.length} posten ingevuld${a.gegund_posten ? ` · ${a.gegund_posten} gegund` : ""}</div></td><td>${(a.loten || []).map(lotNaam).map(esc).join("<br>")}</td><td class="num ${open && a.status === "open" && a.deadline && a.deadline < todayLocal() ? "late" : ""}">${a.deadline ? fmt(a.deadline) : "—"}</td><td><span class="pill ${a.status === "niet_weerhouden" ? "afgesloten" : a.status}">${PA_STATUS[a.status] || esc(a.status)}</span></td><td class="r"><button class="btn sm ${open && a.status === "open" ? "primary" : ""}" data-act="pa-open" data-id="${a.id}">${open && a.status === "open" ? "Invullen" : "Bekijken"}</button></td></tr>`; }).join("")}</tbody></table></div>` : `<div class="panel"><div class="empty"><b>Nog geen prijsaanvragen</b>Zodra BROS je een prijsaanvraag stuurt, vul je ze hier in.</div></div>`}`;
}
const paKop = (r) => !Number(r.hoeveelheid) && !r.code && (r.groep || r.omschrijving);
const paPosten = (a) => D().aanvraagPosten.filter(x => x.aanvraag_id === a.id).sort((x, y) => x.lot - y.lot || (x.volgorde ?? 0) - (y.volgorde ?? 0) || (x.code || "").localeCompare(y.code || ""));
const paOpen = (a) => (a.status === "open" || a.status === "ingediend") && (a.prijsvraag_status || "open") === "open";
const paPrijsTxt = (v) => v == null ? "" : String(Number(v)).replace(".", ",");
function vAanvraag(p, a) {
  const ps = paPosten(a); const rw = paOpen(a); const lots = [...new Set(ps.map(x => x.lot))]; const echte = ps.filter(x => !paKop(x));
  const telt = (x) => x.eenheidsprijs != null && !x.niet_aangeboden;
  const tot = ps.reduce((s, x) => s + (telt(x) ? Number(x.eenheidsprijs) * Number(x.hoeveelheid || 0) : 0), 0); const ing = echte.filter(x => telt(x) || x.niet_aangeboden).length; const na = echte.filter(x => x.niet_aangeboden).length;
  const bij = a.bijlagen || [];
  return `<button class="back" data-act="pa-back">‹ Alle prijsaanvragen</button>
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start;margin-bottom:12px"><div><h1 style="margin-bottom:4px">${esc(a.titel || "Prijsaanvraag")}</h1><div class="muted">${projTitel(p)} · ${(a.loten || []).map(lotNaam).map(esc).join(", ")}${a.deadline ? ` · reageren vóór <b class="${rw && a.status === "open" && a.deadline < todayLocal() ? "late" : ""}">${fmtLang(a.deadline)}</b>` : ""}</div></div><span class="pill ${a.status === "niet_weerhouden" ? "afgesloten" : a.status}" style="font-size:13px">${PA_STATUS[a.status] || esc(a.status)}</span></div>
    ${a.bericht ? `<div class="panel" style="margin-bottom:16px"><div class="panel-body" style="white-space:pre-line">${esc(a.bericht)}</div></div>` : ""}
    ${a.status === "gekozen" ? `<div class="notice" style="border-color:var(--ok);background:var(--ok-soft)"><div><b>BROS heeft ${a.gegund_posten ? `je prijs voor ${a.gegund_posten} post${a.gegund_posten === 1 ? "" : "en"} weerhouden (✓ hieronder)` : "je prijzen weerhouden"}.</b> Bedankt — je aanspreekpunt neemt contact op over de verdere afspraken.</div></div>`
      : a.status === "niet_weerhouden" ? `<div class="notice"><div><b>BROS heeft deze keer voor een andere offerte gekozen.</b> Bedankt voor je prijs — we nemen je graag opnieuw mee bij een volgende vraag.</div></div>`
      : !rw ? `<div class="notice"><div><b>Deze prijsaanvraag is afgesloten.</b> Je kan niets meer invullen of wijzigen.</div></div>`
      : a.status === "ingediend" ? `<div class="notice" style="border-color:var(--blue);background:var(--blue-soft)"><div><b>Ingediend op ${fmt(a.ingediend_op)}.</b> Je kan je prijzen nog aanpassen tot BROS de prijsvraag afsluit; dien dan opnieuw in.</div></div>`
      : a.met_richtprijs ? `<div class="notice" style="border-color:var(--blue);background:var(--blue-soft)"><div><b>BROS stelt per post een prijs voor.</b> Kijk ze na en pas aan waar nodig; kan je een post niet aanbieden, vink dan <i>n.a.</i> aan. Daarna dien je in.</div></div>` : ""}
    <div class="kpis"><div class="kpi"><div class="k">Ingevuld</div><div class="v num">${ing} / ${echte.length}</div>${na ? `<div class="muted" style="font-size:12px">waarvan ${na} niet aangeboden</div>` : ""}</div><div class="kpi"><div class="k">Totaal van je prijzen</div><div class="v num">${eur(tot, 0)}</div><div class="muted" style="font-size:12px">excl. btw, op basis van de vermoedelijke hoeveelheden</div></div></div>
    ${lots.map(lot => { const rs = ps.filter(x => x.lot === lot); let groep = null; const som = rs.reduce((s, x) => s + (telt(x) ? Number(x.eenheidsprijs) * Number(x.hoeveelheid || 0) : 0), 0);
      return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h3>${esc(lotNaam(lot))}</h3><span class="num" style="font-weight:700">${eur(som)}</span></div><div class="tw"><table class="t"><thead><tr><th style="width:60px">Nr</th><th>Omschrijving</th><th class="r">Hoev.</th><th class="r">Eenheidsprijs</th><th class="c" title="Niet aangeboden">n.a.</th><th class="r">Totaal</th><th>Opmerking</th></tr></thead><tbody>
        ${rs.map(r => { const isGroep = paKop(r); let g = ""; if (r.groep && r.groep !== groep) { groep = r.groep; g = `<tr class="groep"><td colspan="7">${esc(r.groep)}</td></tr>`; } if (isGroep && !r.groep) return `<tr class="groep"><td colspan="7">${esc(r.omschrijving)}</td></tr>`; if (isGroep) return g;
          const k = `data-pa="${a.id}" data-post="${r.post_id}"`; const afw = r.richtprijs != null && r.eenheidsprijs != null && Number(r.eenheidsprijs) !== Number(r.richtprijs);
          return g + `<tr style="${r.niet_aangeboden ? "opacity:.6" : ""}"><td class="num muted" style="font-size:12px">${esc(r.code)}${r.gegund ? ` <span title="Gegund" style="color:var(--ok);font-weight:700">✓</span>` : ""}</td><td>${esc(r.omschrijving).replace(/\n/g, "<br>")}${r.locatie ? `<div class="muted" style="font-size:12px">${esc(r.locatie)}</div>` : ""}</td><td class="r num">${Number(r.hoeveelheid) ? nl(r.hoeveelheid, 2) + " " + esc(r.eenheid) : esc(r.eenheid || "")}</td>
            <td class="r">${rw ? `<input class="prijs" type="text" inputmode="decimal" autocomplete="off" ${k} data-f="prijs" value="${r.niet_aangeboden ? "" : paPrijsTxt(r.eenheidsprijs)}" placeholder="€" style="width:96px;text-align:right" ${r.niet_aangeboden ? "disabled" : ""}>` : `<span class="num">${telt(r) ? eur(r.eenheidsprijs) : "—"}</span>`}${afw ? `<div class="muted" style="font-size:11px">voorstel BROS ${eur(r.richtprijs)}</div>` : ""}</td>
            <td class="c">${rw ? `<input class="niet" type="checkbox" ${k} data-f="niet" ${r.niet_aangeboden ? "checked" : ""} title="Niet aangeboden">` : r.niet_aangeboden ? "✓" : ""}</td>
            <td class="r num">${telt(r) && Number(r.hoeveelheid) ? eur(Number(r.eenheidsprijs) * Number(r.hoeveelheid)) : ""}</td>
            <td>${rw ? `<input class="opm" type="text" ${k} data-f="opm" value="${esc(r.opmerking || "")}" placeholder="bv. alternatief, voorwaarde…" style="width:100%;min-width:160px">` : esc(r.opmerking || "")}</td></tr>`; }).join("")}
      </tbody></table></div></div>`; }).join("")}
    <div class="panel" style="margin-bottom:16px"><div class="panel-head"><h3>Je offerte (pdf)</h3><span class="muted" style="font-size:12px">optioneel · max. 5 bestanden van 15 MB</span></div><div class="panel-body">
      ${bij.length ? bij.map(b => `<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px"><a href="#" data-act="pa-bijlage-open" data-path="${esc(b.path)}">📎 ${esc(b.naam || "offerte.pdf")}</a><span class="muted" style="font-size:12px">${b.grootte ? Math.round(b.grootte / 1024) + " kB" : ""}</span>${rw ? `<button class="btn ghost sm" data-act="pa-bijlage-weg" data-id="${a.id}" data-path="${esc(b.path)}" aria-label="Verwijderen">✕</button>` : ""}</div>`).join("") : `<p class="muted" style="margin:0 0 8px">Nog geen bijlage.</p>`}
      ${rw && bij.length < 5 ? `<label class="drop drop-sm" data-drop="pa:${a.id}"><input type="file" accept="application/pdf,.pdf" multiple hidden data-pabijlage="${a.id}"><span>📎 Sleep je offerte (pdf) hierheen of <u>klik om te kiezen</u></span></label>` : ""}</div></div>
    ${rw ? `<div class="panel" style="border-color:var(--ink)"><div class="panel-body"><h2 style="margin-bottom:8px">${a.status === "ingediend" ? "Opnieuw indienen" : "Indienen bij BROS"}</h2><p class="muted" style="font-size:14px">Prijzen worden bewaard zodra je een veld verlaat. Klaar? Dien in — BROS krijgt dan een melding.</p>
      <div class="field"><label for="pa_opm">Opmerking bij je prijsopgave (levertermijn, voorwaarden, geldigheid…)</label><textarea id="pa_opm" rows="3">${esc(a.opmerking || "")}</textarea></div>
      <button class="btn primary" data-act="pa-indienen" data-id="${a.id}" ${S.bezig ? "disabled" : ""}>${S.bezig ? "Bezig…" : a.status === "ingediend" ? "Opnieuw indienen" : "Prijsopgave indienen"}</button><span class="msg" id="pa_msg" style="margin-left:10px"></span></div></div>` : a.opmerking ? `<div class="panel"><div class="panel-body"><b>Je opmerking:</b> ${esc(a.opmerking)}</div></div>` : ""}`;
}
async function prijsBewaar(inp) {
  const r = D().aanvraagPosten.find(x => x.aanvraag_id === inp.dataset.pa && x.post_id === inp.dataset.post); if (!r) return;
  const sel = (c) => $(`input.${c}[data-pa="${inp.dataset.pa}"][data-post="${inp.dataset.post}"]`);
  const row = sel("prijs"), opm = sel("opm"), niet = sel("niet");
  const isNiet = niet ? niet.checked : !!r.niet_aangeboden;
  const p0 = isNiet ? null : row ? duizendKeuze(row.value, leesGetal(row.value)) : null; const prijs = p0 == null || isNaN(p0) ? p0 : r2(p0); const o = opm ? opm.value.trim() : "";
  if (prijs === (r.eenheidsprijs == null ? null : Number(r.eenheidsprijs)) && o === (r.opmerking || "") && isNiet === !!r.niet_aangeboden) return;
  if (prijs != null && (isNaN(prijs) || prijs < 0)) { toast("Geef een geldige prijs."); return; }
  const args = { p_aanvraag: inp.dataset.pa, p_post: inp.dataset.post, p_prijs: prijs, p_opmerking: o }; if ("niet_aangeboden" in r) args.p_niet = isNiet;   // vóór script 037 bestaat p_niet niet
  const { error } = await sb.rpc("prijs_invullen", args);
  if (error) { toast("Niet bewaard: " + error.message, 5000); return; }
  r.eenheidsprijs = prijs; r.opmerking = o; r.niet_aangeboden = isNiet;
  const a = D().aanvragen.find(x => x.id === inp.dataset.pa);
  if (a && a.status === "ingediend" && "prijsvraag_id" in a) { a.status = "open"; a.ingediend_op = null; toast("Gewijzigd na indienen — dien opnieuw in, dan ziet BROS je nieuwe prijzen.", 6000); }
  // totalen verversen zonder de invoer te verstoren
  const focus = document.activeElement; const id = focus && focus.dataset ? focus.dataset.pa + "|" + focus.dataset.post + "|" + focus.dataset.f : null;
  render(); if (id) { const el = document.querySelector(`input[data-pa="${focus.dataset.pa}"][data-post="${focus.dataset.post}"][data-f="${focus.dataset.f}"]`); if (el) { el.focus(); } }
}
/* offerte (pdf) bij de prijsaanvraag: private opslag 'offertes' (script 037) */
async function paBijlagen(aid, files) {
  const a = D().aanvragen.find(x => x.id === aid); if (!a) return;
  for (const f of files) {
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") { toast(f.name + ": enkel pdf"); continue; }
    if (f.size > 15 * 1024 * 1024) { toast(f.name + ": groter dan 15 MB"); continue; }
    if ((a.bijlagen || []).length >= 5) { toast("Maximaal 5 bijlagen."); break; }
    const id = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g, "");
    const path = `${aid}/${id}.pdf`;
    const up = await sb.storage.from("offertes").upload(path, f, { contentType: "application/pdf", upsert: false });
    if (up.error) { toast("Opladen mislukt: " + up.error.message, 6000); continue; }
    const { data, error } = await sb.rpc("prijsaanvraag_bijlage", { p_id: aid, p_path: path, p_naam: f.name, p_grootte: f.size });
    if (error) { sb.storage.from("offertes").remove([path]).catch(() => { }); toast("Niet bewaard: " + error.message, 6000); continue; }
    a.bijlagen = data || []; toast(f.name + " toegevoegd");
  }
  render();
}
async function paBijlageWeg(aid, path) {
  const a = D().aanvragen.find(x => x.id === aid); if (!a || !confirm("Deze bijlage verwijderen?")) return;
  const { data, error } = await sb.rpc("prijsaanvraag_bijlage", { p_id: aid, p_path: path, p_weg: true });
  if (error) { toast("Dat lukte niet: " + error.message, 5000); return; }
  sb.storage.from("offertes").remove([path]).catch(() => { }); a.bijlagen = data || []; render();
}
async function paBijlageOpen(path) {
  const w = window.open("", "_blank");
  const { data, error } = await sb.storage.from("offertes").createSignedUrl(path, 600);
  if (error || !data) { if (w) w.close(); toast("Niet te openen: " + (error?.message || "onbekend"), 5000); return; }
  if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
}
/* ---------- Meetstaat met prijzen van BROS: bekijken, opmerkingen/tegenvoorstel, akkoord (script 032) ---------- */
const MP_STATUS = { gedeeld: "Wacht op je akkoord", tegenvoorstel: "Tegenvoorstel ingediend", akkoord: "Akkoord" };
const mpOf = (pid) => (D().prijzenMs || []).filter(m => m.project_id === pid);
/* bedrag van één regel: op de cent, minwerk (weggelaten) altijd als vermindering */
const r2 = (n) => { const v = Number(n) || 0; return Math.sign(v) * Math.round(Number((Math.abs(v) * 100).toFixed(6))) / 100; };   // op de cent, half weg van nul (zoals het Planbord)
const mpLijn = (r) => { const v = r2((Number(r.prijs) || 0) * (Number(r.hoeveelheid) || 0)); return r.status === "minwerk" ? -Math.abs(v) : v; };
const mpTot = (m) => (m.regels || []).reduce((s, r) => s + mpLijn(r), 0);
function vPrijzenMs(p) {
  return mpOf(p.id).map(m => {
    const open = m.status === "gedeeld" || m.status === "tegenvoorstel"; const rs = (m.regels || []).slice(); const lots = [...new Set(rs.map(r => r.lot))].sort((a, b) => a - b); const re = m.reactie || {};
    const pill = m.status === "akkoord" ? "opgelost" : m.status === "tegenvoorstel" ? "late" : "open";
    return `<div class="panel" style="margin-bottom:16px;border-color:${m.status === "gedeeld" ? "var(--blue)" : "var(--line)"}"><div class="panel-head"><div><h2>Meetstaat met prijzen van BROS</h2><div class="muted" style="font-size:13px">Versie ${m.versie} · gedeeld op ${fmt(m.gedeeld_op)} · ${rs.length} posten · totaal <b>${eur(mpTot(m))}</b> excl. btw</div></div><span class="pill ${pill}">${esc(MP_STATUS[m.status] || m.status)}</span></div>
      <div class="panel-body">
        ${m.bericht ? `<p style="white-space:pre-line;margin-top:0">${esc(m.bericht)}</p>` : ""}
        ${m.status === "akkoord" ? `<div class="notice" style="border-color:var(--ok);background:var(--ok-soft)"><div><b>Akkoord op ${fmt(m.beslist_op)}</b> door ${esc(m.beslist_naam)}. Bedankt — deze prijzen gelden voor de uitvoering.${m.opmerking ? `<br><span class="muted">Je opmerking: ${esc(m.opmerking)}</span>` : ""}</div></div>`
          : m.status === "tegenvoorstel" ? `<div class="notice"><div><b>Tegenvoorstel ingediend op ${fmt(m.beslist_op)}</b> door ${esc(m.beslist_naam)}. BROS bekijkt het en deelt een aangepaste versie; je kan intussen nog aanpassen of toch akkoord gaan.</div></div>`
          : `<p class="muted" style="font-size:14px;margin-top:0">Dit zijn de eenheidsprijzen (excl. btw) die BROS voor jouw werk voorstelt. Klopt er iets niet, zet dan bij die post een opmerking of een tegenprijs. Daarna ga je akkoord, of dien je je tegenvoorstel in.</p>`}
      </div>
      ${lots.map(lot => { const lr = rs.filter(r => r.lot === lot); let groep = null; const som = lr.reduce((s, r) => s + mpLijn(r), 0);
        return `<div class="panel-head" style="border-top:1px solid var(--line)"><h3>${esc(lotNaam(lot))}</h3><span class="num" style="font-weight:700">${eur(som)}</span></div><div class="tw"><table class="t"><thead><tr><th style="width:56px">Nr</th><th>Omschrijving</th><th class="r">Hoev.</th><th class="r">Eenheidsprijs</th><th class="r">Totaal</th><th>${open ? "Opmerking / tegenprijs" : "Opmerking"}</th></tr></thead><tbody>
          ${lr.map(r => { const g = r.groep && r.groep !== groep ? ((groep = r.groep), `<tr class="groep"><td colspan="6">${esc(r.groep)}</td></tr>`) : ""; const x = re[r.post_id] || {}; const h = Number(r.hoeveelheid) || 0;
            return g + `<tr><td class="num muted" style="font-size:12px">${esc(r.code)}</td><td>${esc(r.omschrijving).replace(/\n/g, "<br>")}${r.locatie ? `<div class="muted" style="font-size:12px">${esc(r.locatie)}</div>` : ""}${MS_TAG[r.status] ? ` <span class="pill">${MS_TAG[r.status]}</span>` : ""}</td>
              <td class="r num" style="white-space:nowrap">${h ? nl(h, 2) + " " + esc(r.eenheid) : esc(r.prijstype && r.prijstype !== "EP" ? r.prijstype : r.eenheid || "")}</td><td class="r num">${eur(r.prijs)}</td><td class="r num"><b>${h ? eur(mpLijn(r)) : ""}</b></td>
              <td style="min-width:200px">${open ? `<div style="display:flex;gap:6px"><input class="mp-opm" data-mp="${m.id}" data-post="${r.post_id}" value="${esc(x.opmerking || "")}" placeholder="opmerking" style="flex:1;min-width:0"><input class="mp-tp" data-mp="${m.id}" data-post="${r.post_id}" type="text" inputmode="decimal" autocomplete="off" value="${x.tegenprijs != null ? String(x.tegenprijs).replace(".", ",") : ""}" placeholder="tegenprijs" style="width:90px;text-align:right" title="Jouw eenheidsprijs als tegenvoorstel (leeg = akkoord met de prijs van BROS)"></div>` : `${x.opmerking ? esc(x.opmerking) : ""}${x.tegenprijs != null ? ` <span class="muted">(tegenprijs ${eur(x.tegenprijs)})</span>` : ""}`}</td></tr>`; }).join("")}
        </tbody></table></div>`; }).join("")}
      ${open ? `<div class="panel-body" style="border-top:1px solid var(--line)"><h2 style="margin-bottom:8px">Je beslissing</h2>
        <div class="field"><label for="mp_opm_${m.id}">Algemene opmerking (optioneel)</label><textarea id="mp_opm_${m.id}" data-mp-opm="${m.id}" rows="2">${esc(m.opmerking || "")}</textarea></div>
        <div class="field"><label for="mp_naam_${m.id}">Je naam</label><input id="mp_naam_${m.id}" value="${esc(S.me?.name || "")}" autocomplete="name" style="max-width:320px"></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><button class="btn primary" data-act="mp-akkoord" data-id="${m.id}" ${S.bezig ? "disabled" : ""}>Akkoord met deze prijzen</button><button class="btn" data-act="mp-tegen" data-id="${m.id}" ${S.bezig ? "disabled" : ""}>Tegenvoorstel indienen</button><span class="muted" style="font-size:13px">Opmerkingen en tegenprijzen worden bewaard zodra je een veld verlaat.</span></div></div>` : ""}
    </div>`;
  }).join("");
}
function mpReactieUitScherm(id) {   // reactie uit de invulvelden (alle posten van deze meetstaat)
  const o = {}; let fout = null;
  document.querySelectorAll(`input.mp-opm[data-mp="${id}"]`).forEach(inp => { const post = inp.dataset.post; const tpEl = document.querySelector(`input.mp-tp[data-mp="${id}"][data-post="${post}"]`);
    const opm = inp.value.trim(); const raw = tpEl ? tpEl.value.trim() : ""; const tp = raw ? duizendKeuze(raw, leesGetal(raw)) : null; if (raw && (tp == null || isNaN(tp) || tp < 0)) fout = "Geef een geldige tegenprijs (bv. 125,50)."; 
    if (opm || tp != null) o[post] = { opmerking: opm, tegenprijs: tp == null ? null : tp }; });
  return { o, fout };
}
async function mpBewaar(id) {
  const m = (D().prijzenMs || []).find(x => x.id === id); if (!m) return false; const { o, fout } = mpReactieUitScherm(id); if (fout) { toast(fout, 5000); return false; }
  const opm = ($("#mp_opm_" + id)?.value ?? m.opmerking ?? "").trim();
  const { error } = await sb.rpc("aannemer_mp_reactie", { p_id: id, p_versie: m.versie, p_reactie: o, p_opmerking: opm });
  if (error) { toast("Niet bewaard: " + error.message, 6000); return false; }
  m.reactie = o; m.opmerking = opm; return true;
}
async function mpBeslis(id, akkoord) {
  if (S.bezig) return; const m = (D().prijzenMs || []).find(x => x.id === id); if (!m) return;
  const naam = ($("#mp_naam_" + id)?.value || "").trim(); if (naam.length < 2) { toast("Vul je naam in."); $("#mp_naam_" + id)?.focus(); return; }
  if (!(await mpBewaar(id))) return;
  const n = Object.keys(m.reactie || {}).length; const tegen = Object.values(m.reactie || {}).filter(x => x.tegenprijs != null).length;
  if (akkoord && tegen) { toast(`Je hebt bij ${tegen} post${tegen === 1 ? "" : "en"} een tegenprijs gezet: dien ze in als tegenvoorstel, of maak die velden leeg om akkoord te gaan.`, 7000); return; }
  if (!akkoord && !n && !(m.opmerking || "").trim()) { toast("Zet bij minstens één post een opmerking of tegenprijs, of schrijf een algemene opmerking."); return; }
  if (!confirm(akkoord ? `Akkoord met deze ${(m.regels || []).length} prijzen (totaal ${eur(mpTot(m))} excl. btw) als ${naam}?` : `Je tegenvoorstel indienen bij BROS (${n} post${n === 1 ? "" : "en"} met een opmerking of tegenprijs)?`)) return;
  S.bezig = true; render();
  const { error } = await sb.rpc("aannemer_mp_beslis", { p_id: id, p_versie: m.versie, p_akkoord: !!akkoord, p_naam: naam, p_opmerking: (m.opmerking || "").trim() });
  if (error) { S.bezig = false; render(); toast("Dat lukte niet: " + error.message, 6000); return; }
  if (cfg.driveScriptUrl) { try { await fetch(cfg.driveScriptUrl, { method: "POST", body: JSON.stringify({ action: "aanprijsmail", id, soort: akkoord ? "akkoord" : "tegenvoorstel", token: S.session?.access_token || "" }), redirect: "follow" }); } catch (x) { } }
  try { await loadAll(); } catch (x) { } S.bezig = false; render(); toast(akkoord ? "Akkoord bevestigd — bedankt!" : "Tegenvoorstel ingediend — BROS krijgt een melding.", 5000);
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
      ${vr.length ? `<div class="panel"><div class="panel-head"><h2>Je eerdere vragen</h2></div><table class="t"><tbody>${vr.map(v => `<tr><td><b>${esc(v.titel)}</b><div class="muted" style="font-size:13px">${fmt(v.created_at)} · ${ONDERWERP[v.onderwerp] || esc(v.onderwerp)}</div>${v.vraag ? `<div style="font-size:13px;margin-top:4px;white-space:pre-line">${esc(v.vraag)}</div>` : ""}${v.bros_antwoord ? `<div style="font-size:13px;margin-top:6px;padding:8px 10px;background:var(--blue-soft);border-left:3px solid var(--blue);border-radius:8px"><b>Antwoord van BROS${v.beantwoord_naam ? " (" + esc(v.beantwoord_naam) + ")" : ""}${v.beantwoord_op ? " · " + fmt(v.beantwoord_op) : ""}:</b><div style="white-space:pre-line;margin-top:2px">${esc(v.bros_antwoord)}</div></div>` : ""}${v.status === "geweigerd" && v.reden ? `<div style="font-size:13px;margin-top:6px;padding:8px 10px;background:var(--surface-2);border-radius:8px"><b>${v.bros_antwoord ? "Reden" : "Antwoord van BROS"}:</b> ${esc(v.reden)}</div>` : ""}</td><td style="width:1%"><span class="pill ${v.status}">${VR_STATUS[v.status] || esc(v.status)}</span></td></tr>`).join("")}</tbody></table></div>` : ""}
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
    S.nieuw.forEach(f => URL.revokeObjectURL(f.url)); S.nieuw = [];
    const opm = (S.opm || "").trim(); S.opm = "";
    if (cfg.driveScriptUrl && opm) { try { fetch(cfg.driveScriptUrl, { method: "POST", body: JSON.stringify({ action: "werfpuntfeedback", id, token: S.session?.access_token || "" }), redirect: "follow" }).catch(() => { }); } catch (e) { } }   // BROS verwittigen (script 044)
    await loadAll(); toast(opgelost ? "Gemeld als opgelost — BROS controleert het bij het volgende werfbezoek." : "Bewaard — BROS krijgt je opmerking en kan erop reageren.", 5000);
  } catch (e) { toast("Dat lukte niet: " + (e.message || e), 6000); }
  S.bezig = false; render();
}
function vTeam() {
  const team = D().team.slice().sort((a, b) => a.name.localeCompare(b.name));
  return `<h1 style="margin-bottom:6px">Wie is wie</h1><p class="muted" style="margin-bottom:16px">Het BROS-team van dit project.</p>
    ${team.length ? `<div class="team">${team.map(t => `<div class="card">${t.foto_url ? `<img class="foto" src="${esc(safeUrl(t.foto_url))}" alt="${esc(t.name)}">` : `<div class="nofoto" style="background:${esc(t.color || "#2A4DD0")}">${esc(t.initials)}</div>`}<div class="body"><h3>${esc(t.name)}</h3><div class="fn">${esc(t.functie || "BROS")}</div><div class="bio">${esc(t.bio || "")}</div></div></div>`).join("")}</div>` : `<div class="panel"><div class="empty">Binnenkort stellen we het team hier aan je voor.</div></div>`}`;
}
function avatar(t, size = 40) { return t.foto_url ? `<img class="avatar" style="width:${size}px;height:${size}px" src="${esc(safeUrl(t.foto_url))}" alt="">` : `<span class="avatar" style="width:${size}px;height:${size}px;background:${esc(t.color || "#2A4DD0")};font-size:${Math.round(size / 3)}px">${esc(t.initials || "")}</span>`; }

/* ---------- 1.49: facturen van de aannemer (script 047) ---------- */
const AF_STATUS = { ontvangen: "Ontvangen", goedgekeurd: "Goedgekeurd", betaald: "Betaald", betwist: "Vraag van BROS" };
const AF_PILL = { ontvangen: "ingediend", goedgekeurd: "gekozen", betaald: "betaald", betwist: "late" };
const afOf = (pid) => (D().facturen || []).filter(f => f.project_id === pid).sort((a, b) => (b.datum || "").localeCompare(a.datum || "") || (b.created_at || "").localeCompare(a.created_at || ""));
const afIncl = (f) => Number(f.bedrag_excl || 0) + Number(f.btw_bedrag || 0);
const afBewerkbaar = (f) => f.status === "ontvangen" || f.status === "betwist";
const plusDagen = (iso, n) => { const d = new Date((iso || todayLocal()) + "T12:00:00"); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const getalTxt = (v) => v == null || v === "" ? "" : typeof v === "string" ? v : String(Number(v)).replace(".", ",");   // tekst (al getypt) blijft zoals getypt
/* loten en posten waaraan hij kan koppelen: zijn loten (Dossier › Contacten) en de posten die hij in zijn meetstaat ziet */
function afLoten(p) {
  const rows = msOf(p.id); const lots = [...new Set([...(p.mijn_loten || []), ...rows.map(r => r.lot)])].sort((a, b) => a - b);
  return lots.map(l => ({ lot: l, posten: rows.filter(r => r.lot === l && Number(r.hoeveelheid) !== 0 && (r.code || r.omschrijving)) }));
}
function afKoppelTxt(f) {
  const k = f.koppeling || []; if (!k.length) return "";
  const lots = [...new Set(k.map(x => x.lot != null ? x.lot : (D().meetstaat.find(r => r.id === x.post_id) || {}).lot).filter(x => x != null))].sort((a, b) => a - b); const posten = k.filter(x => x.post_id).length;
  return lots.map(lotNaam).join(", ") + (posten ? ` · ${posten} post${posten === 1 ? "" : "en"}` : "");
}
function vFacturen(p) {
  const fs = afOf(p.id); const f0 = S.fForm; const tot = (lijst) => lijst.reduce((s, f) => s + afIncl(f), 0);
  const vraag = fs.filter(f => f.status === "betwist"), open = fs.filter(f => f.status === "ontvangen" || f.status === "goedgekeurd"), betaald = fs.filter(f => f.status === "betaald");
  return `<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start"><div><h1 style="margin-bottom:6px">Facturen</h1><p class="muted" style="margin-bottom:16px;max-width:640px">Laad hier je facturen voor dit project op. BROS kijkt ze na en je volgt hier de status op: ontvangen, goedgekeurd en betaald. <button class="btn ghost sm" data-act="hl" data-id="facturen" style="padding:0 4px;color:var(--blue)">Uitleg</button></p></div>
    ${f0 || VB.rol ? "" : `<button class="btn primary" data-act="af-nieuw">+ Factuur opladen</button>`}</div>
    ${vraag.length ? `<div class="notice" style="border-color:var(--crit);background:var(--crit-soft)"><div><b>BROS heeft een vraag over ${vraag.length === 1 ? "een factuur" : vraag.length + " facturen"}.</b> <span class="muted">Lees de toelichting hieronder en pas de factuur aan — ze gaat dan opnieuw naar BROS.</span></div></div>` : ""}
    ${fs.length ? `<div class="kpis"><div class="kpi"><div class="k">Opgeladen</div><div class="v num">${fs.length}</div><div class="muted" style="font-size:12px">${eur(tot(fs))} incl. btw</div></div><div class="kpi"><div class="k">In behandeling</div><div class="v num">${open.length}</div><div class="muted" style="font-size:12px">${eur(tot(open))} incl. btw</div></div><div class="kpi"><div class="k">Betaald</div><div class="v num">${betaald.length}</div><div class="muted" style="font-size:12px">${eur(tot(betaald))} incl. btw</div></div>${vraag.length ? `<div class="kpi"><div class="k">Vraag van BROS</div><div class="v num" style="color:var(--crit)">${vraag.length}</div><div class="muted" style="font-size:12px">${eur(tot(vraag))} incl. btw</div></div>` : ""}</div>` : ""}
    ${f0 ? afFormHtml(p, f0.id ? fs.find(f => f.id === f0.id) : null) : ""}
    ${fs.length ? `<div class="panel"><div class="tw"><table class="t"><thead><tr><th>Factuur</th><th>Datum</th><th class="r">Excl. btw</th><th class="r">Incl. btw</th><th>Status</th><th></th></tr></thead><tbody>
      ${fs.map(f => `<tr id="af_${esc(f.id)}" class="${S.fFlits === f.id ? "flits" : ""}"><td><b>${esc(f.nummer)}</b>${f.omschrijving ? `<div style="font-size:13px">${esc(f.omschrijving)}</div>` : ""}<div class="muted" style="font-size:12px">${esc(afKoppelTxt(f) || "niet gekoppeld aan een lot")}</div>${f.status === "betwist" && f.bros_opmerking ? `<div style="font-size:13px;margin-top:6px;padding:8px 10px;background:var(--crit-soft);border-left:3px solid var(--crit);border-radius:8px"><b>Vraag van BROS${f.beoordeeld_op ? " · " + fmt(f.beoordeeld_op) : ""}:</b><div style="white-space:pre-line;margin-top:2px">${esc(f.bros_opmerking)}</div></div>` : f.bros_opmerking && f.status !== "ontvangen" ? `<div class="muted" style="font-size:12px;margin-top:4px">BROS: ${esc(f.bros_opmerking)}</div>` : ""}</td>
        <td class="num" style="font-size:13px">${fmt(f.datum)}${f.vervaldag ? `<div class="muted" style="font-size:12px">vervalt ${fmt(f.vervaldag)}</div>` : ""}</td>
        <td class="r num">${eur(f.bedrag_excl)}</td><td class="r num"><b>${eur(afIncl(f))}</b>${f.btw_bedrag == null ? `<div class="muted" style="font-size:11px">btw niet ingevuld</div>` : ""}</td>
        <td><span class="pill ${AF_PILL[f.status] || ""}">${AF_STATUS[f.status] || esc(f.status)}</span>${f.status === "betaald" && f.betaald_op ? `<div class="muted" style="font-size:12px">op ${fmt(f.betaald_op)}</div>` : f.status === "goedgekeurd" && f.beoordeeld_op ? `<div class="muted" style="font-size:12px">op ${fmt(f.beoordeeld_op)}</div>` : `<div class="muted" style="font-size:12px">opgeladen ${fmt(f.created_at)}</div>`}</td>
        <td class="r" style="white-space:nowrap"><button class="btn sm" data-act="af-pdf" data-path="${esc(f.pdf_path)}" title="${esc(f.pdf_naam || "factuur.pdf")}">Pdf</button>${afBewerkbaar(f) && !VB.rol ? ` <button class="btn sm ${f.status === "betwist" ? "primary" : ""}" data-act="af-wijzig" data-id="${f.id}">Wijzigen</button> <button class="btn ghost sm" data-act="af-weg" data-id="${f.id}" aria-label="Intrekken" title="Intrekken">✕</button>` : ""}</td></tr>`).join("")}
      </tbody></table></div></div>` : f0 ? "" : `<div class="panel"><div class="empty"><b>Nog geen facturen opgeladen</b>Kies '+ Factuur opladen' en sleep je pdf in het vak. Koppelen aan loten of posten mag, maar hoeft niet.</div></div>`}`;
}
function afFormHtml(p, f0) {
  const v = S.fForm && S.fForm.v;   // invoer die al getypt was (bv. na Hulp of een verversing) gaat voor op de bewaarde factuur
  const f = v ? { ...(f0 || {}), nummer: v.nummer, datum: v.datum, vervaldag: v.verval, bedrag_excl: v.excl, btw_bedrag: v.btw, omschrijving: v.oms } : f0;
  const kop = {}; if (v) { v.kop.forEach(k => { kop[k.id] = k; }); } else (f?.koppeling || []).forEach(k => { if (k.post_id) kop["p" + k.post_id] = k; else kop["l" + k.lot] = k; });
  const lots = afLoten(p); const heeftKop = v ? v.kopOpen : !!(f?.koppeling || []).length;
  const btwTarief = (() => { try { return localStorage.getItem("bros.af.btw") || ""; } catch (e) { return ""; } })();
  return `<div class="panel" id="afForm" data-id="${esc(f?.id || "")}" style="margin-bottom:16px;border-color:var(--ink)"><div class="panel-head"><h2>${f ? "Factuur " + esc(f.nummer) + " wijzigen" : "Factuur opladen"}</h2><button class="btn ghost sm" data-act="af-annuleer">Annuleren</button></div><div class="panel-body">
    ${f && f.status === "betwist" && f.bros_opmerking ? `<div style="font-size:14px;margin:0 0 14px;padding:10px 12px;background:var(--crit-soft);border-left:3px solid var(--crit);border-radius:8px"><b>Vraag van BROS:</b> ${esc(f.bros_opmerking)}</div>` : ""}
    <label class="drop" data-drop="factuur"><input type="file" id="af_file" accept="application/pdf,.pdf" hidden><span class="drop-ic">📄</span><span id="af_file_naam">${S.fBestand ? `📎 <b>${esc(S.fBestand.name)}</b> <span class="muted">(${Math.round(S.fBestand.size / 1024)} kB) — klik om een andere te kiezen</span>` : f0 ? `Huidige pdf: <b>${esc(f0.pdf_naam || "factuur.pdf")}</b> — sleep een nieuwe pdf hierheen of klik om ze te vervangen` : "Sleep je factuur (pdf) hierheen of <u>klik om te kiezen</u>"}</span><small class="muted">pdf, max. 15 MB</small></label>
    <div class="grid2" style="margin-top:14px">
      <div class="field"><label for="af_nummer">Factuurnummer</label><input id="af_nummer" maxlength="60" value="${esc(f?.nummer || "")}" placeholder="bv. 2026-0142" autocomplete="off"></div>
      <div class="field"><label for="af_datum">Factuurdatum</label><input id="af_datum" type="date" value="${esc(f?.datum || todayLocal())}"></div>
      <div class="field"><label for="af_verval">Vervaldag <span class="muted" style="font-weight:400"><button type="button" class="linkje" data-af-dagen="30">+30 d</button> <button type="button" class="linkje" data-af-dagen="60">+60 d</button></span></label><input id="af_verval" type="date" value="${esc(f?.vervaldag || "")}"></div>
      <div class="field"><label for="af_excl">Bedrag excl. btw (€)</label><input id="af_excl" inputmode="decimal" autocomplete="off" value="${esc(getalTxt(f?.bedrag_excl))}" placeholder="0,00"></div>
      <div class="field"><label for="af_btw">Btw (€) <span class="muted" style="font-weight:400">${["21", "6", "0"].map(t => `<button type="button" class="linkje ${btwTarief === t ? "on" : ""}" data-af-btw="${t}">${t} %</button>`).join(" ")}</span></label><input id="af_btw" inputmode="decimal" autocomplete="off" value="${esc(getalTxt(f?.btw_bedrag))}" placeholder="0,00"></div>
      <div class="field"><label>Totaal incl. btw</label><div class="num" id="af_incl" style="padding:11px 0;font-weight:700">—</div></div>
    </div>
    <div class="field"><label for="af_oms">Omschrijving (optioneel)</label><textarea id="af_oms" rows="2" maxlength="1000" placeholder="bv. Schrijnwerk keuken — schijf 2 na plaatsing">${esc(f?.omschrijving || "")}</textarea></div>
    ${lots.length ? `<details id="af_kop" class="af-kop" ${heeftKop ? "open" : ""}><summary><b>Koppelen aan loten of posten</b> <span class="muted">(optioneel)</span></summary>
      <p class="muted" style="font-size:13px;margin:8px 0 10px">Vink de loten aan waarop deze factuur betrekking heeft, of open een lot om posten te kiezen. Een bedrag per lot of post mag, maar hoeft niet.</p>
      ${lots.map(({ lot, posten }) => { const kl = kop["l" + lot]; const aan = (k) => !!k && k.aan !== false; const kps = posten.filter(r => aan(kop["p" + r.id]));
        return `<div class="kl"><div class="kl-r"><label class="chk"><input type="checkbox" data-kl="${lot}" ${aan(kl) ? "checked" : ""}> <span>${esc(lotNaam(lot))}</span></label><input class="kb" data-klb="${lot}" inputmode="decimal" autocomplete="off" placeholder="bedrag" value="${esc(getalTxt(kl?.bedrag))}"></div>
          ${posten.length ? `<details class="kp" ${kps.length ? "open" : ""}><summary>${posten.length} post${posten.length === 1 ? "" : "en"}${kps.length ? ` · ${kps.length} gekozen` : ""}</summary>${posten.map(r => { const k = kop["p" + r.id]; return `<div class="kl-r sub"><label class="chk"><input type="checkbox" data-kp="${r.id}" ${aan(k) ? "checked" : ""}> <span><span class="muted num" style="font-size:11px">${esc(r.code || "")}</span> ${esc(r.omschrijving.slice(0, 90))}${r.omschrijving.length > 90 ? "…" : ""}</span></label><input class="kb" data-kpb="${r.id}" inputmode="decimal" autocomplete="off" placeholder="bedrag" value="${esc(getalTxt(k?.bedrag))}"></div>`; }).join("")}</details>` : ""}</div>`; }).join("")}
      <div class="muted" id="af_ksom" style="font-size:13px;margin-top:8px"></div></details>` : ""}
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:16px"><button class="btn primary" data-act="af-bewaar" ${S.bezig ? "disabled" : ""}>${S.bezig ? "Bezig…" : f ? (f.status === "betwist" ? "Aangepast — opnieuw naar BROS" : "Wijzigingen bewaren") : "Factuur versturen naar BROS"}</button><span class="muted" style="font-size:13px">BROS krijgt ze in het Planbord en kijkt ze na.</span></div>
  </div></div>`;
}
/* de getypte invoer bijhouden, zodat een nieuwe weergave (Hulp, verversen, ander tabblad en terug) niets wist */
function afSnap() {
  const form = $("#afForm"); if (!form || !S.fForm) return; const val = (id) => ($("#" + id) || {}).value || "";
  const kop = []; form.querySelectorAll("input[data-kl]").forEach(c => { const b = form.querySelector(`[data-klb="${c.dataset.kl}"]`).value; if (c.checked || b.trim()) kop.push({ id: "l" + c.dataset.kl, aan: c.checked, bedrag: b }); });
  form.querySelectorAll("input[data-kp]").forEach(c => { const b = form.querySelector(`[data-kpb="${c.dataset.kp}"]`).value; if (c.checked || b.trim()) kop.push({ id: "p" + c.dataset.kp, aan: c.checked, bedrag: b }); });
  S.fForm.v = { nummer: val("af_nummer"), datum: val("af_datum"), verval: val("af_verval"), excl: val("af_excl"), btw: val("af_btw"), oms: val("af_oms"), kop, kopOpen: !!($("#af_kop") && $("#af_kop").open) };
}
function afLees(veld) { const el = $("#" + veld); if (!el) return null; const raw = el.value.trim(); if (!raw) return null; return duizendKeuze(raw, leesGetal(raw)); }
function afHerreken() {
  const form = $("#afForm"); if (!form) return;
  const ex = leesGetal($("#af_excl").value), bt = leesGetal($("#af_btw").value);
  $("#af_incl").textContent = ex == null || isNaN(ex) ? "—" : eur(ex + (bt && !isNaN(bt) ? bt : 0));
  const som = $("#af_ksom"); if (!som) return; let s = 0, n = 0;
  form.querySelectorAll("input[data-kl]:checked").forEach(c => { n++; const v = leesGetal(form.querySelector(`[data-klb="${c.dataset.kl}"]`).value); if (v && !isNaN(v)) s += v; });
  form.querySelectorAll("input[data-kp]:checked").forEach(c => { n++; const v = leesGetal(form.querySelector(`[data-kpb="${c.dataset.kp}"]`).value); if (v && !isNaN(v)) s += v; });
  som.innerHTML = !n ? "Nog niets gekoppeld — dat mag." : `${n} gekoppeld${s ? ` · bedragen samen ${eur(s)}${ex && !isNaN(ex) ? (Math.abs(s - ex) < 0.01 ? " — gelijk aan het factuurbedrag ✓" : ` van ${eur(ex)} excl. btw`) : ""}` : " · zonder bedragen"}`;
}
function afBestandKies(file) {
  if (!file) return; const naam = $("#af_file_naam");
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { toast("Enkel een pdf, aub."); return; }
  if (file.size > 15 * 1024 * 1024) { toast("Deze pdf is groter dan 15 MB."); return; }
  S.fBestand = file; if (naam) naam.innerHTML = `📎 <b>${esc(file.name)}</b> <span class="muted">(${Math.round(file.size / 1024)} kB) — klik om een andere te kiezen</span>`;
  const nr = $("#af_nummer"); if (nr && !nr.value.trim()) { const m = file.name.replace(/\.pdf$/i, "").match(/(\d[\d\-\/._]{2,}\d)/); if (m) nr.value = m[1]; }   // factuurnummer uit de bestandsnaam voorstellen
  afSnap();
}
async function afBewaar(p) {
  if (S.bezig) return; const form = $("#afForm"); if (!form) return; const id = form.dataset.id || null; const oud = id ? (D().facturen || []).find(f => f.id === id) : null;
  const nummer = $("#af_nummer").value.trim(), datum = $("#af_datum").value || null, verval = $("#af_verval").value || null, oms = $("#af_oms").value.trim();
  const excl = afLees("af_excl"), btw = afLees("af_btw");
  if (!id && !S.fBestand) return toast("Kies eerst de pdf van je factuur.");
  if (!nummer) { $("#af_nummer").focus(); return toast("Vul het factuurnummer in."); }
  if (excl == null || isNaN(excl) || excl === 0) { $("#af_excl").focus(); return toast("Vul het bedrag excl. btw in."); }
  if (btw != null && isNaN(btw)) { $("#af_btw").focus(); return toast("Het btw-bedrag is geen geldig getal."); }
  if (verval && datum && verval < datum) return toast("De vervaldag ligt vóór de factuurdatum.");
  const koppeling = []; let fout = "";
  form.querySelectorAll("input[data-kl]:checked").forEach(c => { const raw = form.querySelector(`[data-klb="${c.dataset.kl}"]`).value.trim(); const b = raw ? leesGetal(raw) : null; if (b != null && isNaN(b)) fout = "Een bedrag bij de loten is geen geldig getal."; koppeling.push({ lot: Number(c.dataset.kl), post_id: null, bedrag: b }); });
  form.querySelectorAll("input[data-kp]:checked").forEach(c => { const raw = form.querySelector(`[data-kpb="${c.dataset.kp}"]`).value.trim(); const b = raw ? leesGetal(raw) : null; if (b != null && isNaN(b)) fout = "Een bedrag bij de posten is geen geldig getal."; koppeling.push({ lot: null, post_id: c.dataset.kp, bedrag: b }); });
  if (fout) return toast(fout);
  S.bezig = true; const knop = form.querySelector('[data-act="af-bewaar"]'); if (knop) { knop.disabled = true; knop.textContent = "Bezig…"; }
  let pad = null;
  try {
    if (S.fBestand) {
      const { data: map, error: me } = await sb.rpc("aannemer_factuur_map", { p_project: p.id }); if (me) throw me;
      const rnd = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g, "");
      pad = `${map}/${rnd}.pdf`;
      const up = await sb.storage.from("aannemerfacturen").upload(pad, S.fBestand, { contentType: "application/pdf", upsert: false });
      if (up.error) { pad = null; throw new Error("Opladen mislukt: " + up.error.message); }
    }
    const { error } = await sb.rpc("aannemer_factuur", { p_id: id, p_project: p.id, p_path: pad, p_naam: S.fBestand ? S.fBestand.name : null, p_nummer: nummer, p_datum: datum, p_vervaldag: verval, p_excl: excl, p_btw: btw, p_omschrijving: oms, p_koppeling: koppeling });
    if (error) throw error;
    if (pad && oud && oud.pdf_path && oud.pdf_path !== pad) sb.storage.from("aannemerfacturen").remove([oud.pdf_path]).catch(() => { });   // vervangen: de oude pdf opruimen
    S.fForm = null; S.fBestand = null; S.bezig = false;
    try { await loadAll(); } catch (e) { }
    render(); toast(oud ? (oud.status === "betwist" ? "Aangepast — BROS kijkt je factuur opnieuw na." : "Bewaard.") : "Verstuurd — BROS kijkt je factuur na. Je volgt de status hier op.", 5000);
  } catch (e) {
    if (pad) sb.storage.from("aannemerfacturen").remove([pad]).catch(() => { });
    S.bezig = false; if (knop) { knop.disabled = false; knop.textContent = oud ? "Wijzigingen bewaren" : "Factuur versturen naar BROS"; }
    toast("Dat lukte niet: " + (e.message || e), 7000);
  }
}
async function afWeg(id) {
  const f = (D().facturen || []).find(x => x.id === id); if (!f || !confirm(`Factuur ${f.nummer} intrekken? Ze verdwijnt uit het portaal en BROS ziet ze niet meer.`)) return;
  const { data, error } = await sb.rpc("aannemer_factuur_weg", { p_id: id });
  if (error) return toast("Dat lukte niet: " + error.message, 6000);
  if (data) sb.storage.from("aannemerfacturen").remove([data]).catch(() => { });
  if (S.fForm && S.fForm.id === id) { S.fForm = null; S.fBestand = null; }
  D().facturen = (D().facturen || []).filter(x => x.id !== id); render(); toast("Factuur ingetrokken.");
}
async function afPdf(path) {
  const w = window.open("", "_blank");
  const { data, error } = await sb.storage.from("aannemerfacturen").createSignedUrl(path, 600);
  if (error || !data) { if (w) w.close(); toast("Niet te openen: " + (error?.message || "onbekend"), 5000); return; }
  if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
}

/* ---------- 1.49: 'Te doen' over alle projecten (startscherm) ---------- */
function teDoen() {
  const nu = todayLocal(); const items = [];
  const projOk = (pid) => D().projecten.find(p => p.id === pid);
  D().vs.filter(v => v.status === "open" && !v.te_beoordelen && v.aan_mij !== false).forEach(v => { const p = projOk(v.project_id); if (!p) return;
    items.push({ p, datum: v.deadline || "", laat: isLate(v), wat: "Werfpunt " + vsNr(v), tekst: v.titel || v.omschrijving || "", act: `data-act="todo" data-p="${esc(p.id)}" data-t="werf" data-id="${esc(v.id)}"`, prio: v.prioriteit === "hoog" ? 1 : 2 }); });
  D().aanvragen.filter(a => a.status === "open" && paOpen(a)).forEach(a => { const p = projOk(a.project_id); if (!p) return;
    items.push({ p, datum: a.deadline || "", laat: !!(a.deadline && a.deadline < nu), wat: "Prijsaanvraag", tekst: a.titel || "In te vullen", act: `data-act="todo" data-p="${esc(p.id)}" data-t="prijzen" data-id="${esc(a.id)}"`, prio: 2 }); });
  D().taken.filter(t => !t.vaststelling_id && t.status !== "done").forEach(t => { const p = projOk(t.project_id); if (!p) return;
    items.push({ p, datum: t.eind || "", laat: !!(t.eind && t.eind < nu), wat: "Actiepunt", tekst: t.titel, act: `data-act="todo" data-p="${esc(p.id)}" data-t="vragen"`, prio: 3 }); });
  (D().prijzenMs || []).filter(m => m.status === "gedeeld").forEach(m => { const p = projOk(m.project_id); if (!p) return;
    items.push({ p, datum: "", laat: false, wat: "Meetstaat met prijzen", tekst: "Wacht op je akkoord", act: `data-act="todo" data-p="${esc(p.id)}" data-t="meetstaat"`, prio: 1 }); });
  (D().facturen || []).filter(f => f.status === "betwist").forEach(f => { const p = projOk(f.project_id); if (!p) return;
    items.push({ p, datum: "", laat: false, wat: "Factuur " + f.nummer, tekst: "Vraag van BROS: " + (f.bros_opmerking || "bekijk de toelichting"), act: `data-act="todo" data-p="${esc(p.id)}" data-t="facturen" data-id="${esc(f.id)}"`, prio: 0 }); });
  return items.sort((a, b) => (b.laat - a.laat) || (a.prio - b.prio) || (a.datum || "9999").localeCompare(b.datum || "9999"));
}
function teDoenHtml() {
  const items = teDoen(); if (!items.length) return `<div class="panel todo-leeg"><div class="panel-body"><b>Niets te doen</b> <span class="muted">— alles is afgewerkt. Nieuwe werfpunten, prijsaanvragen en vragen van BROS verschijnen hier.</span></div></div>`;
  const toon = S.todoAlles ? items : items.slice(0, 6);
  return `<div class="panel todo"><div class="panel-head"><h2>Te doen <span class="muted" style="font-weight:500;font-size:15px">${items.length}</span></h2></div>
    ${toon.map(i => `<button class="todo-i ${i.laat ? "laat" : ""}" ${i.act}><span class="todo-w">${esc(i.wat)}${i.laat ? ` <span class="pill late">te laat</span>` : ""}</span><span class="todo-t">${esc(String(i.tekst).slice(0, 120))}</span><span class="todo-m">${esc(pNaamKort(i.p))}${i.datum ? ` · ${i.laat ? "was" : "tegen"} ${fmt(i.datum)}` : ""}</span><span class="pijl" aria-hidden="true">›</span></button>`).join("")}
    ${items.length > toon.length ? `<div class="panel-body" style="padding:8px 18px"><button class="btn ghost sm" data-act="todo-alles">Toon alles (${items.length})</button></div>` : ""}</div>`;
}
const pNaamKort = (p) => (p.nummer ? p.nummer + " · " : "") + (p.kandidaat ? "Prijsvraag" + (p.gemeente ? " " + p.gemeente : "") : (p.klant || p.naam || ""));

/* ---------- 1.49: hulp — handleiding + assistent (Edge Function 'assistent', modus hulp) ---------- */
async function hlLaad() {
  if (S.hl || S.hlLaden) return; S.hlLaden = true;
  try { const r = await fetch("handleiding.json?v=" + PORTAAL_VERSION, { cache: "no-cache" }); if (!r.ok) throw new Error("status " + r.status); S.hl = await r.json(); }
  catch (e) { S.hlFout = "De handleiding kon niet geladen worden (" + (e.message || e) + ")."; }
  S.hlLaden = false; if (S.hulp) render();
}
const hlTekst = (t) => esc(t).split(/\n{2,}/).map(par => `<p>${par.replace(/\n/g, "<br>").replace(/&#39;([^&<]{2,60}?)&#39;/g, "<b>$1</b>")}</p>`).join("");
function vHulp() {
  if (!S.hl && !S.hlFout) hlLaad();
  const h = S.hl; const zoek = (S.hlZoek || "").toLowerCase();
  const vragen = ["Hoe laad ik een factuur op?", "Wat betekent 'Vraag van BROS' bij mijn factuur?", "Hoe meld ik een werfpunt als opgelost?", "Hoe dien ik een prijsaanvraag in?", "Ik ben mijn wachtwoord vergeten"];
  return `<button class="back" data-act="hulp-dicht">‹ Terug${S.project && P() ? " naar " + projTitel(P()) : " naar je projecten"}</button>
    <div class="hero" style="padding-bottom:14px"><div class="eyebrow">Hulp</div><h1>Hoe werkt het portaal?</h1><p class="lead">Stel je vraag aan de assistent of zoek in de handleiding. Voor vragen over een concreet project (prijs, betaling, datum) gebruik je het tabblad Vragen in dat project.</p></div>
    <div class="two top"><div class="stack">
      <div class="panel"><div class="panel-head"><h2>Vraag het aan de assistent</h2></div>
        <div class="hchat" id="hchat">${(S.hulpChat || []).length ? S.hulpChat.map(m => `<div class="hb ${m.rol}">${esc(m.tekst)}</div>`).join("") : `<div class="muted" style="font-size:14px">Bijvoorbeeld:</div><div class="hsug">${vragen.map(v => `<button class="chip" data-act="hulp-sug">${esc(v)}</button>`).join("")}</div>`}</div>
        <form id="hulpForm" class="hform"><input id="hulp_vraag" maxlength="800" placeholder="Typ je vraag…" autocomplete="off"><button class="btn primary" type="submit">Vragen</button></form>
        <div class="muted" style="font-size:12px;padding:0 18px 14px">De assistent kent enkel deze handleiding, niet je dossier. Antwoorden kunnen fouten bevatten; bij twijfel vraag je het aan BROS.</div></div>
    </div><div class="stack">
      <div class="panel"><div class="panel-head"><h2>Handleiding</h2></div><div class="panel-body" style="padding-bottom:6px"><input id="hl_zoek" class="hl-zoek" type="search" placeholder="Zoeken in de handleiding…" value="${esc(S.hlZoek || "")}" autocomplete="off"></div>
        ${S.hlFout ? `<div class="empty">${esc(S.hlFout)}</div>` : !h ? `<div class="empty">Laden…</div>` : `<div class="hl">${h.intro ? `<p class="muted hl-intro" style="font-size:14px;padding:0 18px">${esc(h.intro)}</p>` : ""}${(h.secties || []).map(s => { const hit = !zoek || (s.titel + " " + s.tekst).toLowerCase().includes(zoek);
          return `<details class="hl-sec" id="hl_${esc(s.id)}" ${S.hlOpen === s.id || (zoek && hit) ? "open" : ""} ${hit ? "" : "hidden"}><summary>${esc(s.titel)}</summary><div class="hl-tx">${hlTekst(s.tekst)}</div></details>`; }).join("")}<div class="empty hl-niets" ${zoek && !(h.secties || []).some(s => (s.titel + " " + s.tekst).toLowerCase().includes(zoek)) ? "" : "hidden"}>Niets gevonden — stel je vraag aan de assistent.</div></div>`}</div>
    </div></div>`;
}
function hlFilter(q) {
  S.hlZoek = q; const z = q.toLowerCase(); let n = 0;
  document.querySelectorAll(".hl-sec").forEach(el => { const s = (S.hl?.secties || []).find(x => "hl_" + x.id === el.id); const hit = !z || (s && (s.titel + " " + s.tekst).toLowerCase().includes(z)); el.hidden = !hit; if (hit) n++; if (z && hit) el.open = true; });
  const leeg = document.querySelector(".hl-niets"); if (leeg) leeg.hidden = !(z && !n);
}
async function hulpVraag(vraag) {
  vraag = String(vraag || "").trim(); if (!vraag || S.hulpBezig) return;
  S.hulpChat = S.hulpChat || []; S.hulpChat.push({ rol: "ik", tekst: vraag }); S.hulpBezig = true;
  const box = $("#hchat"); const teken = () => { if (!box) return; box.innerHTML = S.hulpChat.map(m => `<div class="hb ${m.rol}">${esc(m.tekst)}</div>`).join("") + (S.hulpBezig ? `<div class="hb hulp denkt">Even denken…</div>` : ""); box.scrollTop = box.scrollHeight; };
  teken();
  try {
    const r = await fetch(cfg.supabaseUrl + "/functions/v1/assistent", { method: "POST", headers: { "Content-Type": "application/json", apikey: cfg.supabaseAnonKey, Authorization: "Bearer " + (S.session?.access_token || "") }, body: JSON.stringify({ modus: "hulp", vraag }) });
    const j = await r.json().catch(() => ({}));
    S.hulpChat.push({ rol: "hulp", tekst: r.ok && j.antwoord ? j.antwoord : (j.error || "De assistent is even niet bereikbaar. Zoek in de handleiding hiernaast of stel je vraag via het tabblad Vragen.") });
  } catch (e) { S.hulpChat.push({ rol: "hulp", tekst: "Geen verbinding met de assistent. Zoek in de handleiding hiernaast of probeer het straks opnieuw." }); }
  S.hulpBezig = false; teken();
}
function hulpOpen(sectie) { S.hulp = true; S.hlOpen = sectie || null; S.hlZoek = ""; render(); if (sectie) setTimeout(() => { const el = document.getElementById("hl_" + sectie); if (el) el.scrollIntoView({ block: "start", behavior: "smooth" }); }, 120); }

/* ---------- 1.49: vernieuwen (knop en automatisch na een tijd weg) ---------- */
async function vernieuw(stil) {
  if (S.vernieuwBezig || !S.ready) return; S.vernieuwBezig = true;
  try { await loadAll(); S.laatstGeladen = Date.now();
    const bezigMetInvoer = [...document.querySelectorAll("main input, main textarea")].some(el => el.type === "file" ? false : el.type === "checkbox" || el.type === "radio" ? el.checked !== el.defaultChecked : el.value !== el.defaultValue);
    if (!stil || (!S.fForm && !bezigMetInvoer && !(document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)))) { afSnap(); render(); if (S.fForm) afHerreken(); }   // stil (na terugkomen) nooit over niet-bewaarde invoer heen tekenen
    if (!stil) toast("Bijgewerkt"); }
  catch (e) { if (!stil) toast("Vernieuwen lukte niet: " + (e.message || e), 5000); }
  S.vernieuwBezig = false;
}

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
  const bk = e.target.closest("[data-af-btw],[data-af-dagen]");
  if (bk && $("#afForm")) {
    if (bk.dataset.afBtw != null) { const ex = leesGetal($("#af_excl").value); if (ex == null || isNaN(ex)) { toast("Vul eerst het bedrag excl. btw in."); return; } $("#af_btw").value = String(Math.round(ex * Number(bk.dataset.afBtw)) / 100).replace(".", ","); try { localStorage.setItem("bros.af.btw", bk.dataset.afBtw); } catch (x) { } document.querySelectorAll("[data-af-btw]").forEach(b => b.classList.toggle("on", b === bk)); afHerreken(); }
    else { $("#af_verval").value = plusDagen($("#af_datum").value || todayLocal(), Number(bk.dataset.afDagen)); }
    afSnap(); return;
  }
  const el = e.target.closest("[data-tab],[data-act]"); if (!el) return; const d = el.dataset;
  if (d.tab) { if (S.fForm && d.tab !== "facturen" && !confirm("Je factuur is nog niet verstuurd. Toch weggaan?")) return; S.tab = d.tab; S.detail = null; S.aanvraag = null; S.hulp = false; if (d.tab !== "facturen") { S.fForm = null; S.fBestand = null; } render(); return; }
  if (d.act === "logout") sb.auth.signOut().then(() => location.reload());
  if (d.act === "home") { S.nieuw.forEach(f => URL.revokeObjectURL(f.url)); S.nieuw = []; S.opm = ""; S.project = null; S.detail = null; S.aanvraag = null; S.hulp = false; S.fForm = null; S.fBestand = null; render(); return; }
  if (d.act === "proj") { S.hulp = false; S.fForm = null; S.fBestand = null; projectOpenen(d.id, d.t); return; }
  // 1.49: hulp, vernieuwen, 'Te doen' en facturen
  if (d.act === "vernieuw") { await vernieuw(false); return; }
  if (d.act === "hulp") { if (S.hulp) { S.hulp = false; render(); } else hulpOpen(); return; }
  if (d.act === "hulp-dicht") { S.hulp = false; render(); return; }
  if (d.act === "hl") { hulpOpen(d.id); return; }
  if (d.act === "hulp-sug") { await hulpVraag(el.textContent); return; }
  if (d.act === "todo-alles") { S.todoAlles = true; render(); return; }
  if (d.act === "todo") {
    S.hulp = false; projectOpenen(d.p, d.t);
    if (d.t === "werf" && d.id) { S.detail = d.id; S.nieuw = []; S.opm = ""; }
    if (d.t === "prijzen" && d.id) S.aanvraag = d.id;
    if (d.t === "facturen" && d.id) S.fFlits = d.id;
    render(); if (S.fFlits) setTimeout(() => { document.getElementById("af_" + S.fFlits)?.scrollIntoView({ block: "center", behavior: "smooth" }); S.fFlits = null; }, 80);
    return;
  }
  if (d.act === "af-nieuw") { S.fForm = {}; S.fBestand = null; render(); afHerreken(); return; }
  if (d.act === "af-wijzig") { S.fForm = { id: d.id }; S.fBestand = null; render(); afHerreken(); return; }
  if (d.act === "af-annuleer") { S.fForm = null; S.fBestand = null; render(); return; }
  if (d.act === "af-bewaar") { const p = P(); if (p) await afBewaar(p); return; }
  if (d.act === "af-weg") { await afWeg(d.id); return; }
  if (d.act === "af-pdf") { await afPdf(d.path); return; }
  if (d.act === "afs-ics" && window.BROS_AGENDA) { const a = (D().afspraken || []).find(x => String(x.id) === d.id); if (a) BROS_AGENDA.download(a); return; }   // afspraak → eigen agenda (script 041)
  if (d.act === "vs-filter") { S.vsFilter = d.f; render(); }
  if (d.act === "vs-open") { S.tab = "werf"; S.detail = d.id; S.nieuw = []; S.opm = ""; render(); }
  if (d.act === "vs-back") { S.detail = null; S.nieuw.forEach(f => URL.revokeObjectURL(f.url)); S.nieuw = []; render(); }
  if (d.act === "vs-opgelost") { if (S.bezig) return; if (!S.nieuw.length && !confirm("Geen bewijsfoto toegevoegd. Toch als opgelost melden?")) return; await vsMelden(d.id, true); }
  if (d.act === "vs-foto") { if (S.bezig) return; await vsMelden(d.id, false); }
  if (d.act === "ms-pdf") { const p = P(); if (p) await msPdf(p); return; }
  if (d.act === "mp-akkoord" || d.act === "mp-tegen") { await mpBeslis(d.id, d.act === "mp-akkoord"); return; }
  if (d.act === "pa-open") { S.tab = "prijzen"; S.aanvraag = d.id; render(); }
  if (d.act === "pa-back") { S.aanvraag = null; render(); }
  if (d.act === "pa-bijlage-open") { e.preventDefault(); await paBijlageOpen(d.path); return; }
  if (d.act === "pa-bijlage-weg") { await paBijlageWeg(d.id, d.path); return; }
  if (d.act === "pa-indienen") {
    if (S.bezig) return; const a = D().aanvragen.find(x => x.id === d.id); if (!a) return;
    const ps = D().aanvraagPosten.filter(x => x.aanvraag_id === a.id && Number(x.hoeveelheid)); const leeg = ps.filter(x => x.eenheidsprijs == null && !x.niet_aangeboden).length;
    if (leeg && !confirm(`${leeg} van ${ps.length} posten hebben nog geen prijs en staan niet op 'niet aangeboden'. Toch indienen? (Posten zonder prijs neemt BROS niet mee.)`)) return;
    S.bezig = true; render();
    const { error } = await sb.rpc("prijsaanvraag_indienen", { p_id: a.id, p_opmerking: ($("#pa_opm") ? $("#pa_opm").value : a.opmerking || "").trim() });
    if (error) { S.bezig = false; render(); toast("Dat lukte niet: " + error.message, 5000); return; }
    if (cfg.driveScriptUrl) { try { await fetch(cfg.driveScriptUrl, { method: "POST", body: JSON.stringify({ action: "prijsaanvraagmail", id: a.id, soort: "ingediend", token: S.session?.access_token || "" }), redirect: "follow" }); } catch (x) { } }
    try { await loadAll(); } catch (x) { } S.bezig = false; render(); toast("Ingediend — bedankt! BROS bekijkt je prijzen.", 5000);
  }
  if (e.target.closest(".x[data-x]")) { const i = Number(e.target.closest(".x").dataset.x); URL.revokeObjectURL(S.nieuw[i].url); S.nieuw.splice(i, 1); render(); }
});
document.addEventListener("submit", (e) => {
  if (e.target.id === "hulpForm") { e.preventDefault(); const i = $("#hulp_vraag"); const v = i.value; i.value = ""; hulpVraag(v); return; }
  if (e.target.id === "vraagForm") { e.preventDefault(); if (S.bezig) return; const f = new FormData(e.target); const titel = String(f.get("titel") || "").trim(); if (!titel) return; vraagVersturen(P(), { titel, tekst: String(f.get("tekst") || "").trim(), onderwerp: String(f.get("onderwerp") || "overig") }); }
});
document.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.matches("input.mp-opm, input.mp-tp")) { await mpBewaar(t.dataset.mp); return; }
  if (t.dataset && t.dataset.mpOpm) { await mpBewaar(t.dataset.mpOpm); return; }
  if (t.hasAttribute("data-file")) {
    for (const file of [...t.files]) { try { S.nieuw.push(await verklein(file)); } catch (err) { toast("Foto niet bruikbaar"); } }
    t.value = ""; S.opm = $("#f_opm") ? $("#f_opm").value : S.opm; render(); return;
  }
  if (t.id === "af_file") { afBestandKies(t.files && t.files[0]); t.value = ""; return; }
  if (t.closest && t.closest("#afForm")) { afHerreken(); afSnap(); return; }
  if (t.dataset.pabijlage) { const fs = [...t.files]; t.value = ""; await paBijlagen(t.dataset.pabijlage, fs); return; }
  if (t.dataset.pa) { await prijsBewaar(t); return; }
  if (t.dataset.taak) { const id = t.dataset.taak, klaar = t.checked; t.disabled = true;
    const { error } = await sb.rpc("klant_taak_klaar", { p_id: id, p_klaar: klaar });
    if (error) { toast("Dat lukte niet: " + error.message); t.checked = !klaar; t.disabled = false; return; }
    D().taken.forEach(x => { if (x.id === id) x.status = klaar ? "done" : "todo"; }); render(); toast(klaar ? "Afgevinkt — bedankt!" : "Weer open gezet"); }
});
document.addEventListener("input", (e) => {   // 1.49: factuurformulier (bedrag bij een lot/post vinkt het aan) en zoeken in de handleiding
  const t = e.target; if (t.id === "hl_zoek") { hlFilter(t.value); return; }
  if (t.closest && t.closest("#afForm")) { const k = t.dataset.klb ? `[data-kl="${t.dataset.klb}"]` : t.dataset.kpb ? `[data-kp="${t.dataset.kpb}"]` : null; if (k && t.value.trim()) { const c = $("#afForm").querySelector(k); if (c) c.checked = true; } afHerreken(); afSnap(); }
});
document.addEventListener("input", (e) => { if (e.target.id === "f_opm") { S.opm = e.target.value; const b = document.querySelector('[data-act="vs-foto"]'); if (b && !S.bezig) b.disabled = !S.nieuw.length && !S.opm.trim(); } });   // knop meteen bruikbaar zodra er tekst staat
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
// 1.49: pdf's slepen — in het factuurvak of bij een prijsaanvraag; elders losgelaten opent de browser de pdf niet (anders ben je je invoer kwijt)
const heeftBestand = (e) => !!(e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files"));
document.addEventListener("dragover", (e) => { if (!heeftBestand(e)) return; e.preventDefault(); const z = e.target.closest && e.target.closest("[data-drop]"); document.querySelectorAll("[data-drop].over").forEach(x => { if (x !== z) x.classList.remove("over"); }); if (z) z.classList.add("over"); e.dataTransfer.dropEffect = z ? "copy" : "none"; });
document.addEventListener("dragleave", (e) => { const z = e.target.closest && e.target.closest("[data-drop]"); if (z && !z.contains(e.relatedTarget)) z.classList.remove("over"); });
document.addEventListener("drop", async (e) => {
  if (!heeftBestand(e)) return; e.preventDefault(); const z = e.target.closest && e.target.closest("[data-drop]"); document.querySelectorAll("[data-drop].over").forEach(x => x.classList.remove("over"));
  const files = [...(e.dataTransfer.files || [])]; if (!files.length) return;
  if (!z) { if ($("#afForm") || document.querySelector("[data-drop]")) toast("Sleep de pdf in het vak."); return; }
  if (z.dataset.drop === "factuur") afBestandKies(files[0]);
  else if (z.dataset.drop.startsWith("pa:")) await paBijlagen(z.dataset.drop.slice(3), files);
});
// 1.49: terug na meer dan 5 minuten weg → stil de laatste stand ophalen (nieuwe werfpunten, antwoorden, status van facturen)
let wegSinds = 0;
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { wegSinds = Date.now(); return; } if (wegSinds && Date.now() - wegSinds > 300000 && S.ready && !S.bezig) vernieuw(true); });
// 1.48: na slaap/terugkeer meteen een geldig (ververst) token, zodat mails naar BROS niet mislukken met een verlopen login
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.session) sb.auth.getSession().then(r => { if (r && r.data && r.data.session) S.session = r.data.session; }).catch(() => { }); });
boot();
