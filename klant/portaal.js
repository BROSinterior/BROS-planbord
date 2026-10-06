/* =====================================================================
   BROS Klantenportaal — alleen-lezen zicht van de bouwheer op zijn project
   Leest uitsluitend de klant_*-views (databasescript 011): geen kostprijzen, marges of interne notities.
   ===================================================================== */
if (window.top !== window.self) { try { window.top.location.replace(window.location.href); } catch (e) { document.documentElement.innerHTML = ""; } }   // niet in een vreemd frame (clickjacking)
const PORTAAL_VERSION = "1.36.0";
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

const S = { session: null, me: null, ready: false, loadError: null, setPassword: false, passwordForced: false, tab: "welkom", project: null, data: null, msRuimte: (() => { try { return localStorage.getItem("bros.klant.msRuimte") !== "0"; } catch (e) { return true; } })() };
let loginNotice = URL_AUTH.error ? (/expired|invalid|otp/i.test(URL_AUTH.error) ? "Deze link is vervallen of al gebruikt. Log in met je wachtwoord, of vraag hieronder een nieuwe link aan." : "Er ging iets mis met de link: " + URL_AUTH.error) : "";

function toast(msg, ms = 3500) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), ms); }

/* ---------- gegevens ---------- */
async function loadAll(stil) {
  // per 1000 rijen ophalen, altijd in een vaste volgorde (anders vallen er bij grote meetstaten posten weg en klopt het totaal niet)
  const ORDE = { fasen: ["nr"], loten: ["nr"], klant_planning: ["project_id", "fase_nr"] };
  const q = async (v, sel = "*") => { const PAGE = 1000; let all = [];
    for (let from = 0; ; from += PAGE) {
      let r = sb.from(v).select(sel); (ORDE[v] || ["id"]).forEach(c => { r = r.order(c, { ascending: true }); }); r = await r.range(from, from + PAGE - 1);
      if (r.error) throw new Error(v + ": " + r.error.message);
      all = all.concat(r.data || []); if (!r.data || r.data.length < PAGE) return all;
    } };
  const opt = (v) => q(v).catch(() => []);   // views van recente databasescripts: ontbreken ze nog, dan gewoon leeg
  const [me, projecten, meetstaat, vorderingen, regels, planning, uren, documenten, team, ik, fasen, loten, inst, goedkeuringen, notities, notitieTaken, mijnTaken, planTaken, werfverslagen, assistent, chat, keuzes, keuzeOpties, mwAanvragen, werfpunten] = await Promise.all([
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
    opt("klant_keuzes"), opt("klant_keuze_opties"), opt("klant_meerwerk_aanvragen"), opt("klant_vaststellingen"),
  ]);
  S.me = me;
  S.data = { keuzes, keuzeOpties, mwAanvragen, werfpunten, assistent, chat, werfverslagen, planTaken, projecten: projecten.sort((a, b) => (b.nummer || "").localeCompare(a.nummer || "")), meetstaat, vorderingen, regels, planning, uren, documenten, team, ik, fasen: fasen.filter(f => f.actief !== false).sort((a, b) => a.nr - b.nr), loten: Object.fromEntries(loten.map(l => [l.nr, l])), inst, goedkeuringen: goedkeuringen.sort((a, b) => (b.voorgelegd_op || "").localeCompare(a.voorgelegd_op || "")), notities: notities.sort((a, b) => (b.datum || "").localeCompare(a.datum || "")), notitieTaken, mijnTaken: mijnTaken.sort((a, b) => (a.status === "done") - (b.status === "done") || (a.eind || "9").localeCompare(b.eind || "9")) };
  if (!S.project || !projecten.some(p => p.id === S.project)) S.project = projecten[0]?.id || null;
  S.eersteBezoek = ik.length > 0 && ik.every(x => !x.portaal_login);
  if (!stil) sb.rpc("portaal_bezoek").then(() => { });
}
const D = () => S.data;
const P = () => D().projecten.find(p => p.id === S.project);
const voornaam = () => { const ik = D().ik[0]; const n = (ik?.naam || S.me?.name || "").trim(); return n.split(/\s+/)[0] || n; };
const lotNaam = (nr) => D().loten[nr] ? `${nr}. ${D().loten[nr].naam}` : String(nr);
const faseNaam = (nr) => D().fasen.find(f => f.nr === nr)?.naam || "";
const isMw = (r) => r.status === "meerwerk" || r.status === "minwerk";
const telt = (r) => r.status !== "vervallen";
/* minwerk is altijd een vermindering, ook als de hoeveelheid al negatief ingevuld is (zelfde regel als het Planbord) */
const signed = (r) => r.status === "minwerk" ? -Math.abs(Number(r.totaal) || 0) : Number(r.totaal) || 0;
const msRows = () => D().meetstaat.filter(r => r.project_id === S.project && telt(r)).sort((a, b) => a.lot - b.lot || (a.volgorde ?? 0) - (b.volgorde ?? 0) || (a.code || "").localeCompare(b.code || ""));

/* ---------- vorderingen: zelfde rekenregels als het Planbord (post-% overschrijft lot-%) ---------- */
function vordCalc(v) {
  const lot = {}, post = {}; D().regels.filter(r => r.vordering_id === v.id).forEach(r => { if (r.post_id) post[r.post_id] = Number(r.pct); else lot[r.lot] = Number(r.pct); });
  let excl = 0, btw = 0; const perLot = {};
  msRows().filter(r => isMw(r) === (v.soort === "meerwerk")).forEach(r => { const p = post[r.id] ?? lot[r.lot]; if (p == null) return; const a = p * signed(r); excl += a; btw += a * (Number(r.btw) || 0); perLot[r.lot] = (perLot[r.lot] || 0) + a; });
  const locked = v.status !== "opgemaakt"; const bedrag = locked && v.bedrag_excl != null ? Number(v.bedrag_excl) : excl;
  // verstuurde factuur: de bevroren btw (sinds script 033), anders de btw van de posten op het factuurbedrag
  const btw2 = locked && v.btw_bedrag != null ? Number(v.btw_bedrag) : Math.abs(excl) > 0.005 ? bedrag * (btw / excl) : btw;
  return { excl: bedrag, btw: btw2, incl: bedrag + btw2, perLot, loten: Object.keys(perLot).filter(l => Math.abs(perLot[l]) > 0.005).map(Number) };
}

/* ---------- weergave ---------- */
function render(houdScroll) {
  if (!S.session) return renderLogin();
  if (S.setPassword) return renderSetPassword();
  if (!S.ready) { $("#app").innerHTML = S.loadError ? `<div class="login"><div class="card"><h1>Even geen verbinding</h1><p>${esc(S.loadError)}</p><button class="btn primary" onclick="location.reload()">Opnieuw proberen</button></div></div>` : `<div class="loading">Je portaal wordt geladen…</div>`; return; }
  if (S.me && S.me.role !== "klant") { $("#app").innerHTML = `<div class="login"><div class="card"><div class="brand" style="margin-bottom:14px"><span class="mark">BROS</span><span class="name">Klantenportaal</span></div><h1>Dit is het klantenportaal</h1><p>Je bent ingelogd als ${S.me.role === "aannemer" ? "aannemer" : "teamlid"} (${esc(S.me.email || "")}).</p><p><a class="btn primary" href="${S.me.role === "aannemer" ? "../aannemer/" : "../"}">${S.me.role === "aannemer" ? "Naar het aannemersportaal" : "Naar het Planbord"}</a> <button class="btn ghost" data-act="logout">Uitloggen</button></p></div></div>`; return; }
  if (!D().projecten.length) { $("#app").innerHTML = `<div class="login"><div class="card"><div class="brand" style="margin-bottom:14px"><span class="mark">BROS</span><span class="name">Klantenportaal</span></div><h1>Nog geen project gekoppeld</h1><p>Je login werkt, maar er is nog geen project aan je gekoppeld. Laat het ons even weten via ${esc(D().inst.contact_email || "info@bros.be")}.</p><p><button class="btn ghost" data-act="logout">Uitloggen</button></p></div></div>`; return; }
  const p = P();
  const openGk = D().goedkeuringen.filter(g => g.project_id === p.id && g.status === "open" && !(g.geldig_tot && g.geldig_tot < todayLocal())).length;
  const kzOpen = kzVanProject(p).filter(k => k.status === "open").length;
  const tabs = [["welkom", "Welkom"], ["akkoord", "Akkoord" + (openGk ? ` <span class="badge">${openGk}</span>` : "")]].concat(kzVanProject(p).length ? [["keuzes", "Keuzes" + (kzOpen ? ` <span class="badge">${kzOpen}</span>` : "")]] : []).concat([["meetstaat", "Meetstaat"], ["facturatie", "Facturatie"], ["planning", "Planning"], ...(werfTab(p) ? [["werf", "Werf" + (wpVanProject(p).filter(v => v.door_klant && v.status === "open").length ? ` <span class="badge" style="background:var(--muted)">${wpVanProject(p).filter(v => v.door_klant && v.status === "open").length}</span>` : "")]] : []), ["verslagen", "Verslagen" + (D().mijnTaken.filter(t => t.project_id === p.id && t.status !== "done").length ? ` <span class="badge">${D().mijnTaken.filter(t => t.project_id === p.id && t.status !== "done").length}</span>` : "")], ["documenten", "Documenten"], ["team", "Wie is wie"]]).concat(assistentAan(p) ? [["vragen", "Vragen"]] : []);
  $("#app").innerHTML = `<header class="top"><div class="top-in"><div class="brand"><span class="mark">BROS</span><span class="name">Klantenportaal</span></div>
      <div class="who">${D().projecten.length > 1 ? `<select id="projSel" class="btn sm">${D().projecten.map(x => `<option value="${x.id}" ${x.id === p.id ? "selected" : ""}>${esc(x.nummer ? x.nummer + " · " : "")}${esc(x.naam || x.klant)}</option>`).join("")}</select>` : ""}<span>${esc(S.me?.name || "")}</span><button class="btn ghost sm" data-act="logout">Uitloggen</button></div></div>
    <nav class="tabs">${tabs.map(([k, l]) => `<button class="${S.tab === k ? "on" : ""}" data-tab="${k}">${l}</button>`).join("")}</nav></header>
    <main>${(({ welkom: vWelkom, akkoord: vAkkoord, meetstaat: vMeetstaat, facturatie: vFacturatie, planning: vPlanning, keuzes: vKeuzes, werf: vWerf, verslagen: vVerslagen, documenten: vDocumenten, team: vTeam, vragen: vVragen })[S.tab] || vWelkom)(p)}</main>`;
  if (!houdScroll) window.scrollTo({ top: 0 });
  if (S.betaal) tekenQr(S.betaal);
  liveStart();
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
    ${(() => { const tb = teBetalen(p).filter(v => vordCalc(v).incl > 0.005); if (!tb.length) return ""; const vv = tb.filter(vervallen); const tot = tb.reduce((s, v) => s + vordCalc(v).incl, 0);
      return `<div class="notice" style="${vv.length ? "border-color:var(--crit);background:var(--crit-soft)" : "border-color:var(--line-2);background:var(--surface)"}"><div><b>${tb.length === 1 ? "Er staat een factuur open" : `Er staan ${tb.length} facturen open`} · ${eur(tot)}</b><div class="muted" style="font-size:13px">${tb.map(v => esc(v.factuurnummer ? "factuur " + v.factuurnummer : VORD_SOORT[v.soort]) + (v.vervaldag ? (vervallen(v) ? " · vervallen sinds " : " · vóór ") + fmt(v.vervaldag) : "")).join(" · ")}</div></div><button class="btn primary" data-act="betaal" data-id="${tb[0].id}" data-ga="facturatie">Betalen</button></div>`; })()}
    ${(() => { const kz = kzVanProject(p).filter(k => k.status === "open"); if (!kz.length) return ""; const eerst = kz.filter(k => k.deadline).sort((a, b) => a.deadline.localeCompare(b.deadline))[0];
      return `<div class="notice" style="border-color:var(--blue);background:var(--blue-soft)"><div><b>${kz.length === 1 ? "Er wacht een keuze op jou" : `Er wachten ${kz.length} keuzes op jou`}</b><div class="muted" style="font-size:13px">${kz.slice(0, 4).map(k => esc(k.onderwerp)).join(" · ")}${eerst ? ` · eerste deadline ${fmt(eerst.deadline)}` : ""}</div></div><button class="btn primary" data-tab="keuzes">Kiezen</button></div>`; })()}
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
      ${D().ik.length && D().ik.some(x => x.weekmail !== undefined) ? `<div class="panel"><div class="panel-head"><h2>Op de hoogte blijven</h2></div><div class="panel-body"><label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer"><input type="checkbox" id="weekmail" ${D().ik.some(x => x.weekmail !== false) ? "checked" : ""} style="margin-top:3px"><span>Elke maandag een korte samenvatting per mail<div class="muted" style="font-size:13px">Nieuwe verslagen, documenten en facturen, en wat op je wacht. Enkel als er iets nieuws is.</div></span></label><p class="muted" style="font-size:12px;margin:10px 0 0">Tip: zet dit portaal op het beginscherm van je gsm (deelknop › "Zet op beginscherm") — dan open je het als een app.</p></div></div>` : ""}
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
function vAkkoord(p) { return vAkkoordBasis(p) + vMeerwerk(p); }
function vAkkoordBasis(p) {
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
  S.gkBezig = true; try { return await gkBeslisIn(id, akkoord, naam, opmerking, form, m); } finally { S.gkBezig = false; }
}
async function gkBeslisIn(id, akkoord, naam, opmerking, form, m) {
  const { data, error } = await sb.rpc("goedkeuring_beslis", { p_id: id, p_akkoord: akkoord, p_naam: naam, p_opmerking: opmerking || "" });
  if (error) { m.className = "msg err"; m.textContent = "Dat lukte niet: " + error.message; form.querySelectorAll("button").forEach(b => b.disabled = false); return; }
  if (cfg.driveScriptUrl) { try { const r = await fetch(cfg.driveScriptUrl, { method: "POST", body: JSON.stringify({ action: "gkmail", id, soort: "beslist", token: S.session?.access_token || "" }), redirect: "follow" }); await r.json(); } catch (e) { } }
  try { await loadAll(true); } catch (e) { console.warn(e); }
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
  const perRuimte = S.msRuimte !== false; const rk = (r) => (r.locatie || "").trim();
  const lotBlok = (lot) => { let rs = rows.filter(r => r.lot === lot); const som = rs.reduce((s, r) => s + signed(r), 0); let groep = null;
    if (perRuimte) rs = rs.slice().sort((a, b) => (rk(a) === "" ? 1 : 0) - (rk(b) === "" ? 1 : 0) || rk(a).localeCompare(rk(b), "nl", { sensitivity: "base" }) || (a.volgorde ?? 0) - (b.volgorde ?? 0) || (a.code || "").localeCompare(b.code || ""));
    const kopVan = (r) => perRuimte ? (rk(r) || "Zonder ruimte") : r.groep;
    return `<div class="panel"><div class="panel-head"><h3>${esc(lotNaam(lot))}</h3><span class="num" style="font-weight:700">${eur(som)}</span></div><div class="tw"><table class="t"><thead><tr><th style="width:60px">Nr</th><th>Omschrijving</th><th class="r">Hoev.</th><th class="r">Prijs</th><th class="r">Totaal</th><th>Status</th></tr></thead><tbody>
      ${rs.map(r => { const isGroep = !Number(r.hoeveelheid) && !Number(r.prijs) && !r.code && (r.groep || r.omschrijving); let g = ""; const kop = kopVan(r); if (kop && kop !== groep) { groep = kop; const sub = perRuimte ? rs.filter(x => kopVan(x) === kop).reduce((s, x) => s + signed(x), 0) : null; g = `<tr class="groep"><td colspan="5">${esc(kop)}</td><td class="r num" style="text-transform:none;letter-spacing:0">${perRuimte ? eur(sub) : ""}</td></tr>`; }
        if (isGroep && !r.groep && !perRuimte) return `<tr class="groep"><td colspan="6">${esc(r.omschrijving)}</td></tr>`;
        return g + `<tr><td class="num muted" style="font-size:12px">${esc(r.code)}</td><td>${esc(r.omschrijving).replace(/\n/g, "<br>")}${r.locatie && !perRuimte ? `<div class="muted" style="font-size:12px">${esc(r.locatie)}</div>` : ""}</td><td class="r num">${Number(r.hoeveelheid) ? nl(r.hoeveelheid, 2) + " " + esc(r.eenheid) : ""}</td><td class="r num">${Number(r.prijs) ? eur(r.prijs) : ""}</td><td class="r num">${Number(r.totaal) ? eur(signed(r)) : ""}</td><td><span class="pill ${r.status}">${MS_STATUS[r.status] || esc(r.status)}</span>${r.akkoord_op ? `<div class="muted" style="font-size:11px">✓ ${fmt(r.akkoord_op)}</div>` : ""}</td></tr>`; }).join("")}
    </tbody></table></div></div>`; };
  return `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap"><h1 style="margin-bottom:6px">Meetstaat</h1><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn sm" data-act="ms-pdf" title="De meetstaat zoals je ze hier ziet, als pdf">⤓ Pdf</button><div class="seg-btn"><button class="btn sm ${perRuimte ? "primary" : ""}" data-act="ms-ruimte" data-on="1">Per ruimte</button><button class="btn sm ${perRuimte ? "" : "primary"}" data-act="ms-ruimte" data-on="0">Per nummer</button></div></div></div><p class="muted" style="margin-bottom:16px">Alle posten van je project met de afgesproken prijzen (excl. btw)${perRuimte ? ", per lot gegroepeerd per ruimte" : ""}. ${offerteOpen ? "Posten met status <b>Offerte</b> wachten nog op je akkoord; " : ""}<b>Meerwerk</b> en <b>minwerk</b> zijn wijzigingen na het contract.</p>
    <div class="kpis"><div class="kpi"><div class="k">Contract excl. btw</div><div class="v num">${eur(contract, 0)}</div></div><div class="kpi"><div class="k">Meer-/minwerk</div><div class="v num">${mw ? eur(mw, 0) : "—"}</div></div><div class="kpi"><div class="k">Btw</div><div class="v num">${eur(btwTot, 0)}</div><div class="muted" style="font-size:12px">${p.btw_tarief ? p.btw_tarief + " % op je project" : ""}</div></div><div class="kpi"><div class="k">Totaal incl. btw</div><div class="v num">${eur(contract + mw + btwTot, 0)}</div></div></div>
    <div class="stack">${lots.map(lotBlok).join("")}</div>`;
}

/* ---------- betalen (script 034): rekeningnummer, mededeling, vervaldag, QR-code voor de bankapp, factuur-pdf ---------- */
const teBetalen = (p) => D().vorderingen.filter(v => v.project_id === p.id && v.status === "verzonden").sort((a, b) => (a.vervaldag || "9999").localeCompare(b.vervaldag || "9999") || a.nr - b.nr);
const vervallen = (v) => !!(v.vervaldag && v.vervaldag < todayLocal());
const factuurDoc = (v) => v.factuur_document ? D().documenten.find(d => d.id === v.factuur_document) : null;
const ibanFmt = (x) => String(x || "").replace(/\s+/g, "").toUpperCase().replace(/(.{4})/g, "$1 ").trim();
const kanQr = () => !!(D().inst.iban && D().inst.begunstigde);
/* EPC-QR (versie 002, Febelfin): de Belgische gestructureerde mededeling op de plaats van de gestructureerde referentie */
function epcPayload(v, bedrag) {
  const i = D().inst;
  return ["BCD", "002", "1", "SCT", String(i.bic || "").replace(/\s+/g, ""), String(i.begunstigde || "").slice(0, 70), String(i.iban || "").replace(/\s+/g, "").toUpperCase(), "EUR" + bedrag.toFixed(2), "",
    v.mededeling || "", v.mededeling ? "" : ("Factuur " + (v.factuurnummer || v.nr)).slice(0, 140)]
    .join("\n").replace(/\n+$/, "");   // niets na het laatste ingevulde veld (EPC069-12)
}
const laadQr = () => laadScript("https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js", "qrcode");
async function tekenQr(id) {
  const box = document.getElementById("qr_" + id); const v = D().vorderingen.find(x => x.id === id); if (!box || !v || !kanQr()) return;
  const bedrag = Math.round(vordCalc(v).incl * 100) / 100; if (!(bedrag > 0)) { box.innerHTML = ""; return; }
  try {
    const qrcode = await laadQr(); qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];
    const qr = qrcode(0, "M"); qr.addData(epcPayload(v, bedrag), "Byte"); qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
  } catch (e) { box.innerHTML = `<div class="muted" style="font-size:12px">De QR-code kon niet geladen worden. Gebruik de gegevens hiernaast.</div>`; }
}
function vBetalen(v) {
  const c = vordCalc(v); const i = D().inst; const bedrag = Math.round(c.incl * 100) / 100; const doc = factuurDoc(v);
  const lijn = (k, waarde, kopie) => `<div class="b-row"><span class="muted">${k}</span><span class="num"><b>${waarde}</b>${kopie ? ` <button class="btn ghost sm" data-act="kopieer" data-v="${esc(kopie)}" title="Kopiëren">Kopieer</button>` : ""}</span></div>`;
  return `<div class="panel betaal" id="betaal_${v.id}" style="margin-bottom:16px"><div class="panel-head"><h2>Factuur ${esc(v.factuurnummer || (v.nr === 0 ? "voorschot" : "#" + v.nr))} betalen</h2><button class="btn ghost sm" data-act="betaal" data-id="${v.id}">Sluiten</button></div>
    <div class="panel-body betaal-in">${kanQr() && bedrag > 0 ? `<div class="qr-box"><div id="qr_${v.id}" class="qr">QR-code laden…</div><div class="muted" style="font-size:12px;text-align:center;margin-top:6px">Scan met de app van je bank</div></div>` : ""}
      <div class="b-lijst">
        ${lijn("Bedrag", eur(bedrag), bedrag.toFixed(2).replace(".", ","))}
        ${i.iban ? lijn("Rekening", esc(ibanFmt(i.iban)), ibanFmt(i.iban)) : ""}
        ${i.begunstigde ? lijn("Begunstigde", esc(i.begunstigde)) : ""}
        ${i.bic ? lijn("BIC", esc(i.bic)) : ""}
        ${v.mededeling ? lijn("Mededeling", esc(v.mededeling), v.mededeling) : lijn("Vermeld", "Factuur " + esc(v.factuurnummer || v.nr), "Factuur " + (v.factuurnummer || v.nr))}
        ${v.vervaldag ? `<div class="b-row"><span class="muted">Te betalen vóór</span><span class="num" style="${vervallen(v) ? "color:var(--crit)" : ""}"><b>${fmtLang(v.vervaldag)}</b>${vervallen(v) ? " · vervallen" : ""}</span></div>` : ""}
        ${doc ? `<p style="margin:12px 0 0"><a class="btn sm" href="${esc(safeUrl(doc.url))}" target="_blank" rel="noopener">Factuur openen (pdf)</a></p>` : ""}
        ${!i.iban ? `<p class="muted" style="font-size:13px;margin-top:10px">Je vindt de betaalgegevens op de factuur${doc ? "" : " die we je mailden"}.</p>` : `<p class="muted" style="font-size:12px;margin-top:10px">${v.mededeling ? "Gebruik zeker de gestructureerde mededeling: zo wordt je betaling automatisch aan deze factuur gekoppeld." : "Vermeld het factuurnummer bij je betaling."} Al betaald? Dan verschijnt de factuur hier als betaald zodra we je betaling ontvangen hebben.</p>`}
      </div></div></div>`;
}

function vFacturatie(p) {
  const rows = msRows(); const contract = rows.filter(r => !isMw(r)).reduce((s, r) => s + Number(r.totaal), 0), mw = rows.filter(isMw).reduce((s, r) => s + signed(r), 0);
  const vs = D().vorderingen.filter(v => v.project_id === p.id && v.status !== "opgemaakt").sort((a, b) => a.nr - b.nr);
  const calcs = vs.map(v => ({ v, c: vordCalc(v) }));
  const gefact = calcs.reduce((s, x) => s + x.c.excl, 0), betaald = calcs.filter(x => x.v.status === "betaald").reduce((s, x) => s + x.c.incl, 0), open = calcs.filter(x => x.v.status !== "betaald").reduce((s, x) => s + x.c.incl, 0);
  return `<h1 style="margin-bottom:6px">Facturatie</h1><p class="muted" style="margin-bottom:16px">Je facturen en wat er nog volgt. We factureren een voorschot bij ondertekening en daarna per afgewerkt onderdeel; meerwerk factureren we apart.</p>
    <div class="kpis"><div class="kpi"><div class="k">Contract + meerwerk</div><div class="v num">${eur(contract + mw, 0)}</div><div class="muted" style="font-size:12px">excl. btw</div></div><div class="kpi"><div class="k">Gefactureerd</div><div class="v num">${eur(gefact, 0)}</div><div class="muted" style="font-size:12px">${contract + mw ? pct(gefact / (contract + mw)) : "—"} excl. btw</div></div><div class="kpi"><div class="k">Nog te factureren</div><div class="v num">${eur(contract + mw - gefact, 0)}</div><div class="muted" style="font-size:12px">excl. btw</div></div><div class="kpi"><div class="k">Open te betalen</div><div class="v num" style="${open > 0.5 ? "color:var(--warn)" : ""}">${open > 0.5 ? eur(open, 0) : "—"}</div><div class="muted" style="font-size:12px">betaald ${eur(betaald, 0)} incl. btw</div></div></div>
    <div class="panel" style="margin-bottom:16px"><div class="panel-head"><h2>Facturen</h2></div>${vs.length ? `<div class="tw"><table class="t"><thead><tr><th>Nr</th><th>Datum</th><th>Omschrijving</th><th>Onderdelen</th><th class="r">Excl. btw</th><th class="r">Btw</th><th class="r">Incl. btw</th><th>Status</th></tr></thead><tbody>
      ${calcs.map(({ v, c }) => `<tr><td class="num">${v.nr === 0 ? "V" : v.nr}</td><td class="num">${fmt(v.datum)}</td><td><b>${esc(v.omschrijving || VORD_SOORT[v.soort])}</b>${v.factuurnummer ? `<div class="muted" style="font-size:12px">factuur ${esc(v.factuurnummer)}${factuurDoc(v) ? ` · <a href="${esc(safeUrl(factuurDoc(v).url))}" target="_blank" rel="noopener">pdf</a>` : ""}</div>` : ""}</td><td class="muted" style="font-size:12px;max-width:260px">${v.soort === "voorschot" ? "alle onderdelen" : esc(c.loten.map(lotNaam).join(", "))}</td><td class="r num">${eur(c.excl)}</td><td class="r num">${eur(c.btw)}</td><td class="r num"><b>${eur(c.incl)}</b></td><td><span class="pill ${v.status}">${VORD_STATUS[v.status] || esc(v.status)}</span>${v.status === "verzonden" ? `${v.vervaldag ? `<div class="muted" style="font-size:12px;${vervallen(v) ? "color:var(--crit)" : ""}">${vervallen(v) ? "vervallen sinds" : "vóór"} ${fmt(v.vervaldag)}</div>` : ""}${c.incl > 0.005 ? `<div><button class="btn sm ${S.betaal === v.id ? "" : "primary"}" style="margin-top:4px" data-act="betaal" data-id="${v.id}">Betalen</button></div>` : ""}` : ""}</td></tr>`).join("")}
      <tr class="tot"><td colspan="4">Totaal gefactureerd</td><td class="r num">${eur(gefact)}</td><td class="r num">${eur(calcs.reduce((s, x) => s + x.c.btw, 0))}</td><td class="r num">${eur(calcs.reduce((s, x) => s + x.c.incl, 0))}</td><td></td></tr></tbody></table></div>` : `<div class="empty"><b>Nog geen facturen</b>Zodra we een factuur versturen, vind je ze hier terug.</div>`}</div>
    ${S.betaal && vs.some(v => v.id === S.betaal && v.status === "verzonden") ? vBetalen(vs.find(v => v.id === S.betaal)) : ""}
    ${vs.length ? vordMatrix(p, vs) : ""}`;
}
/* vorderingsstaat per onderdeel: welk deel van elk lot (en elke post) in welke factuur zat, wat cumulatief gefactureerd is en wat nog rest */
function vordMatrix(p, vs) {
  const rows = msRows(); if (!rows.length) return "";
  const pct1 = (x) => nl(Math.round(x * 10000) / 100, 2) + " %"; /* 2 decimalen, zodat % × bedrag klopt met het getoonde bedrag */
  // per vordering: % per post (post-% overschrijft lot-%)
  // per vordering: % per post (post-% overschrijft lot-%). Is de factuur bevroren op een ander bedrag dan de berekening (meetstaat later gewijzigd),
  // dan worden de percentages evenredig geschaald zodat de kolom precies op het factuurbedrag uitkomt — zo kloppen matrix, facturenlijst en 'nog te factureren' met elkaar.
  const rg = {}; vs.forEach(v => { const lot = {}, post = {}; D().regels.filter(r => r.vordering_id === v.id).forEach(r => { if (r.post_id) post[r.post_id] = Number(r.pct); else lot[r.lot] = Number(r.pct); });
    const berekend = rows.filter(r => (v.soort === "meerwerk") === isMw(r)).reduce((s, r) => { const x = post[r.id] ?? lot[r.lot]; return s + (x == null ? 0 : x * signed(r)); }, 0);
    const vast = v.status !== "opgemaakt" && v.bedrag_excl != null; const f = vast && Math.abs(berekend) > 0.005 ? Number(v.bedrag_excl) / berekend : 1;   // zelfde schaling als het Planbord
    rg[v.id] = { lot, post, f }; });
  const pctVan = (v, r) => { if ((v.soort === "meerwerk") !== isMw(r)) return null; const x = rg[v.id].post[r.id] ?? rg[v.id].lot[r.lot]; return x == null ? null : x * rg[v.id].f; };
  S.vlOpen = S.vlOpen || {};
  const blok = (soort) => { const rs = rows.filter(r => isMw(r) === (soort === "meerwerk") && Number(r.totaal)); if (!rs.length) return ""; const lots = [...new Set(rs.map(r => r.lot))];
    return lots.map(l => { const lr = rs.filter(r => r.lot === l); const base = lr.reduce((s, r) => s + signed(r), 0); const key = soort + l; const open = !!S.vlOpen[key];
      const cel = (v, items) => { let amt = 0, any = false; items.forEach(r => { const x = pctVan(v, r); if (x != null) { any = true; amt += x * signed(r); } }); const b = items.reduce((s, r) => s + signed(r), 0); return `<td class="c num">${any && b ? `${pct1(amt / b)}<div class="muted" style="font-size:11px">${eur(amt)}</div>` : `<span class="muted">·</span>`}</td>`; };
      const inv = lr.reduce((s, r) => s + vs.reduce((t, v) => t + (pctVan(v, r) || 0) * signed(r), 0), 0);
      return `<tr style="cursor:pointer" data-act="vl-toggle" data-key="${key}"><td><span class="muted" style="display:inline-block;width:14px">${open ? "▾" : "▸"}</span><b>${esc(lotNaam(l))}</b>${soort === "meerwerk" ? ` <span class="pill meerwerk">meerwerk</span>` : ""}<div class="muted" style="font-size:12px;margin-left:14px">${lr.length} post${lr.length === 1 ? "" : "en"}</div></td><td class="r num">${eur(base)}</td>${vs.map(v => cel(v, lr)).join("")}<td class="c num"><b>${pct1(base ? inv / base : 0)}</b></td><td class="r num ${Math.abs(base - inv) < 0.5 ? "muted" : ""}">${eur(base - inv)}</td></tr>` +
        (open ? lr.map(r => { const amt = signed(r); const invP = vs.reduce((t, v) => t + (pctVan(v, r) || 0) * amt, 0); return `<tr class="sub"><td style="padding-left:28px"><span class="muted num" style="font-size:11px">${esc(r.code)}</span> ${esc(r.omschrijving)}${r.locatie ? ` <span class="muted">· ${esc(r.locatie)}</span>` : ""}</td><td class="r num">${eur(amt)}</td>${vs.map(v => cel(v, [r])).join("")}<td class="c num">${pct1(amt ? invP / amt : 0)}</td><td class="r num ${Math.abs(amt - invP) < 0.5 ? "muted" : ""}">${eur(amt - invP)}</td></tr>`; }).join("") : ""); }).join(""); };
  const tot = (soort) => rows.filter(r => isMw(r) === (soort === "meerwerk")).reduce((s, r) => s + signed(r), 0);
  const totRow = (label, soort) => { const base = tot(soort); const perV = vs.map(v => rows.filter(r => isMw(r) === (soort === "meerwerk")).reduce((s, r) => s + (pctVan(v, r) || 0) * signed(r), 0)); const inv = perV.reduce((a, b) => a + b, 0); return `<tr class="tot"><td>${label}</td><td class="r num">${eur(base)}</td>${perV.map(x => `<td class="c num">${x ? eur(x) : ""}</td>`).join("")}<td class="c num">${pct1(base ? inv / base : 0)}</td><td class="r num">${eur(base - inv)}</td></tr>`; };
  const heeftMw = rows.some(r => isMw(r) && Number(r.totaal));
  return `<div class="panel"><div class="panel-head"><div><h2>Wat is per onderdeel gefactureerd?</h2><div class="muted" style="font-size:13px">Per lot het aandeel dat in elke factuur zat; klik op een lot voor de posten. Bedragen excl. btw.</div></div></div>
    <div class="tw"><table class="t"><thead><tr><th>Lot / post</th><th class="r">Basis</th>${vs.map(v => `<th class="c" style="min-width:110px"><span class="pill ${v.status}">${v.nr === 0 ? "Voorschot" : "#" + v.nr}</span><div style="font-weight:600;margin-top:4px">${esc(v.omschrijving || VORD_SOORT[v.soort])}</div><div class="muted" style="font-weight:400">${fmt(v.datum)}${v.factuurnummer ? " · " + esc(v.factuurnummer) : ""}</div></th>`).join("")}<th class="c">Cumul.</th><th class="r">Rest</th></tr></thead><tbody>
      ${blok("vordering")}${totRow("Contract", "vordering")}${heeftMw ? blok("meerwerk") + totRow("Meer-/minwerk", "meerwerk") : ""}
    </tbody></table></div></div>`;
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
/* ---------- Pdf: meetstaat en dossier (documenten, foto's, werfverslagen) ---------- */
const pdfBaar = (d) => /pdf|image\/|google-apps\.(document|presentation|spreadsheet|drawing)/i.test(d.mime || "") || /\.(pdf|jpe?g|png|heic|webp)$/i.test(d.naam || "");
function laadScript(src, glob) {
  if (window[glob]) return Promise.resolve(window[glob]);
  return new Promise((res, rej) => { const el = document.createElement("script"); el.src = src; el.onload = () => res(window[glob]); el.onerror = () => rej(new Error("De pdf-module kon niet geladen worden. Probeer opnieuw.")); document.head.appendChild(el); });
}
const laadJsPdf = () => laadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", "jspdf").then(x => x.jsPDF);
const laadPdfLib = () => laadScript("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js", "PDFLib");
async function logoPng() {
  try { const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = "../logo-mark.svg"; }); const c = document.createElement("canvas"); c.width = 600; c.height = 181; c.getContext("2d").drawImage(img, 0, 0, 600, 181); return c.toDataURL("image/png"); } catch (e) { return null; }
}
const pdfTekst = (t) => String(t ?? "").replace(/→/g, "->").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[•·]/g, "-").replace(/[\u00a0\u202f]/g, " ").replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\u00ff€]/g, "");
const projTitel = (p) => `${p.klant || ""}${p.naam && p.naam !== p.klant ? " - " + p.naam : ""}`;
function bewaarPdf(bytesOfBlob, naam) {
  const blob = bytesOfBlob instanceof Blob ? bytesOfBlob : new Blob([bytesOfBlob], { type: "application/pdf" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = naam.replace(/[\\/:*?"<>|]+/g, "-"); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 8000);
}
/* de meetstaat zoals de klant ze ziet (verkoopprijzen), per ruimte of per nummer */
async function msPdfDoc(p) {
  const jsPDF = await laadJsPdf(); const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const W = 210, H = 297, M = 14, CW = W - 2 * M; let y = M; const logo = await logoPng();
  const ink = [29, 29, 31], muted = [134, 134, 139], line = [220, 220, 224], soft = [240, 240, 242];
  const rows = msRows(); const perRuimte = S.msRuimte !== false; const rk = (r) => (r.locatie || "").trim();
  const cols = [["Nr", 13, "l"], ["Omschrijving", 88, "l"], ["Hoev.", 22, "r"], ["Prijs", 22, "r"], ["Totaal", 24, "r"], ["Status", 13, "l"]];
  const xs = []; let x = M; cols.forEach(c => { xs.push(x); x += c[1]; });
  const datum = fmt(todayLocal());
  const header = () => { if (logo) doc.addImage(logo, "PNG", M, 10, 26, 7.8); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...muted); doc.text(pdfTekst(`${projTitel(p)} - Meetstaat - ${datum}`), W - M, 15, { align: "right" }); doc.setDrawColor(...line); doc.line(M, 20, W - M, 20); y = 26; };
  const colHead = () => { doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...muted); cols.forEach((c, i) => doc.text(c[0].toUpperCase(), c[2] === "r" ? xs[i] + c[1] - 1 : xs[i] + 1, y + 3, { align: c[2] === "r" ? "right" : "left" })); doc.setDrawColor(...line); doc.line(M, y + 4.5, W - M, y + 4.5); y += 6; };
  const need = (h, kop) => { if (y + h > H - 18) { doc.addPage(); header(); if (kop) colHead(); } };
  header();
  doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(...ink); doc.text("Meetstaat", M, y + 5); y += 9;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...muted); doc.text(doc.splitTextToSize(pdfTekst(`${projTitel(p)}${p.adres ? " - " + p.adres : ""}${p.gemeente ? ", " + p.gemeente : ""}${p.nummer ? " - project " + p.nummer : ""}`), CW), M, y + 4); y += 10;
  const lots = [...new Set(rows.map(r => r.lot))];
  lots.forEach(lot => {
    let lr = rows.filter(r => r.lot === lot);
    if (perRuimte) lr = lr.slice().sort((a, b) => (rk(a) === "" ? 1 : 0) - (rk(b) === "" ? 1 : 0) || rk(a).localeCompare(rk(b), "nl", { sensitivity: "base" }) || (a.volgorde ?? 0) - (b.volgorde ?? 0));
    const sub = lr.reduce((t, r) => t + signed(r), 0);
    need(22); y += 3; doc.setFillColor(...soft); doc.roundedRect(M, y, CW, 8, 2, 2, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(...ink); doc.text(pdfTekst(lotNaam(lot)), M + 3, y + 5.5); doc.text(pdfTekst(eur(sub)), W - M - 3, y + 5.5, { align: "right" }); y += 10; colHead();
    let kop = null;
    lr.forEach(r => {
      const k = perRuimte ? (rk(r) || "Zonder ruimte") : (r.groep || "");
      if (k && k !== kop) { kop = k; need(9, true); doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...muted); doc.text(pdfTekst(k).toUpperCase(), M + 1, y + 3.2); if (perRuimte) doc.text(pdfTekst(eur(lr.filter(z => (rk(z) || "Zonder ruimte") === k).reduce((t, z) => t + signed(z), 0))), W - M - 1, y + 3.2, { align: "right" }); y += 5; }
      const oms = doc.splitTextToSize(pdfTekst(r.omschrijving) + (r.locatie && !perRuimte ? "  (" + pdfTekst(r.locatie) + ")" : ""), cols[1][1] - 2); const h = Math.max(1, oms.length) * 3.9 + 2.2;
      need(h, true); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...ink);
      const waarden = [r.code || "", null, Number(r.hoeveelheid) ? nl(r.hoeveelheid, 2) + " " + (r.eenheid || "") : "", Number(r.prijs) ? eur(r.prijs) : "", Number(r.totaal) ? eur(signed(r)) : "", MS_STATUS[r.status] || ""];
      cols.forEach((c, i) => { if (i === 1) doc.text(oms, xs[i] + 1, y + 3.2); else doc.text(pdfTekst(waarden[i]), c[2] === "r" ? xs[i] + c[1] - 1 : xs[i] + 1, y + 3.2, { align: c[2] === "r" ? "right" : "left" }); });
      doc.setDrawColor(...line); doc.line(M, y + h, W - M, y + h); y += h;
    });
  });
  const contract = rows.filter(r => !isMw(r)).reduce((t, r) => t + Number(r.totaal), 0), mw = rows.filter(isMw).reduce((t, r) => t + signed(r), 0), btw = rows.reduce((t, r) => t + signed(r) * (Number(r.btw) || 0), 0);
  need(36); y += 6;
  [["Contract excl. btw", contract], ["Meer-/minwerk excl. btw", mw], ["Totaal excl. btw", contract + mw], [`Btw${p.btw_tarief ? " (" + p.btw_tarief + " %)" : ""}`, btw], ["Totaal incl. btw", contract + mw + btw]].forEach(([k, v]) => { const vet = /^Totaal/.test(k); doc.setFont("helvetica", vet ? "bold" : "normal"); doc.setFontSize(vet ? 10.5 : 9.5); doc.setTextColor(...ink); doc.text(pdfTekst(k), W - M - 72, y + 4); doc.text(pdfTekst(eur(v)), W - M - 1, y + 4, { align: "right" }); y += 6.2; });
  const n = doc.getNumberOfPages(); for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(...muted); doc.text("BROS - prijzen excl. btw, tenzij anders vermeld", M, H - 8); doc.text(`${i} / ${n}`, W - M, H - 8, { align: "right" }); }
  return doc.output("arraybuffer");
}
async function msPdf(p, knop) {
  const oud = knop ? knop.textContent : ""; if (knop) { knop.disabled = true; knop.textContent = "Pdf maken…"; }
  try { bewaarPdf(await msPdfDoc(p), `Meetstaat ${projTitel(p)} ${todayLocal()}.pdf`); toast("Pdf gedownload"); }
  catch (e) { toast("Pdf maken mislukt: " + (e.message || e), 6000); }
  finally { if (knop) { knop.disabled = false; knop.textContent = oud; } }
}
/* één gedeeld document ophalen via het Drive-script (controleert login en toegang) */
async function haalDocument(d) {
  if (!cfg.driveScriptUrl) throw new Error("Documenten ophalen is nog niet ingesteld bij BROS.");
  const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 120000);
  try {
    const r = await fetch(cfg.driveScriptUrl, { method: "POST", body: JSON.stringify({ action: "bestand", id: d.id, token: S.session?.access_token || "" }), redirect: "follow", signal: ac.signal });
    const j = await r.json(); if (!j.ok) { const e = new Error(j.error || "Document niet beschikbaar"); e.overslaan = !!j.overslaan; throw e; }
    const bin = atob(j.b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return { mime: j.mime, bytes: u8 };
  } finally { clearTimeout(tm); }
}
async function dossierPdf(p, knop) {
  const K = S.dossier; if (!K) return;
  const docs = D().documenten.filter(d => d.project_id === p.id && K.sel.has(d.id)).sort((a, b) => (a.pad || "").localeCompare(b.pad || "") || a.naam.localeCompare(b.naam));
  const wvs = (D().werfverslagen || []).filter(w => w.project_id === p.id && K.wv.has(w.id)).sort((a, b) => (a.nr || 0) - (b.nr || 0));
  const stappen = (K.ms ? 1 : 0) + docs.length + wvs.length; if (!stappen) return;
  const zet = (t) => { if (knop) knop.textContent = t; }; if (knop) knop.disabled = true;
  try {
    const PDFLib = await laadPdfLib(); const uit = await PDFLib.PDFDocument.create(); const font = await uit.embedFont(PDFLib.StandardFonts.Helvetica);
    const inhoud = []; const fouten = []; let stap = 0;
    // voorblad
    const jsPDF = await laadJsPdf(); const vb = new jsPDF({ unit: "mm", format: "a4" }); const logo = await logoPng();
    const lijst = [...(K.ms ? ["Meetstaat"] : []), ...docs.map(d => (d.pad ? d.pad.replace(/\//g, " > ") + " > " : "") + d.naam), ...wvs.map(w => w.titel || "Werfverslag " + w.nr)];
    if (logo) vb.addImage(logo, "PNG", 14, 18, 40, 12);
    vb.setFont("helvetica", "bold"); vb.setFontSize(24); vb.setTextColor(29, 29, 31); vb.text("Dossier", 14, 52);
    vb.setFont("helvetica", "normal"); vb.setFontSize(12); vb.setTextColor(90, 90, 96); vb.text(vb.splitTextToSize(pdfTekst(`${projTitel(p)}${p.gemeente ? " - " + p.gemeente : ""}`), 182), 14, 61); vb.text(pdfTekst("Samengesteld op " + fmtLang(todayLocal())), 14, 68);
    vb.setFontSize(10); vb.setTextColor(29, 29, 31); let yy = 84; vb.setFont("helvetica", "bold"); vb.text("Inhoud", 14, yy); yy += 7; vb.setFont("helvetica", "normal");
    lijst.forEach((t, i) => { const ls = vb.splitTextToSize(pdfTekst(`${i + 1}.  ${t}`), 180); if (yy + ls.length * 5 > 280) { vb.addPage(); yy = 20; } vb.text(ls, 14, yy); yy += ls.length * 5 + 1; });
    const vbDoc = await PDFLib.PDFDocument.load(vb.output("arraybuffer")); (await uit.copyPages(vbDoc, vbDoc.getPageIndices())).forEach(pg => uit.addPage(pg));
    const voegPdfToe = async (bytes) => { const src = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true }); (await uit.copyPages(src, src.getPageIndices())).forEach(pg => uit.addPage(pg)); };
    const voegBeeldToe = async (bytes, mime, titel) => {
      const img = mime === "image/png" ? await uit.embedPng(bytes) : await uit.embedJpg(bytes);
      const liggend = img.width > img.height; const [PW, PH] = liggend ? [841.89, 595.28] : [595.28, 841.89]; const m = 28, onder = 22;
      const sc = Math.min((PW - 2 * m) / img.width, (PH - 2 * m - onder) / img.height, 1.5); const w = img.width * sc, h = img.height * sc;
      const pg = uit.addPage([PW, PH]); pg.drawImage(img, { x: (PW - w) / 2, y: onder + m + (PH - 2 * m - onder - h) / 2, width: w, height: h });
      pg.drawText(pdfTekst(titel).slice(0, 120), { x: m, y: 16, size: 8, font, color: PDFLib.rgb(0.45, 0.45, 0.48) });
    };
    if (K.ms) { zet(`Meetstaat… (${++stap}/${stappen})`); await voegPdfToe(await msPdfDoc(p)); }
    for (const d of docs) {
      zet(`${d.naam.slice(0, 28)}… (${++stap}/${stappen})`);
      try { const f = await haalDocument(d); if (f.mime === "application/pdf") await voegPdfToe(f.bytes); else await voegBeeldToe(f.bytes, f.mime, d.naam); }
      catch (e) { fouten.push(d.naam + (e.overslaan ? " (bestandstype)" : "")); }
    }
    for (const w of wvs) {
      zet(`Werfverslag ${w.nr}… (${++stap}/${stappen})`);
      try { const r = await fetch(safeUrl(w.pdf_url)); if (!r.ok) throw new Error(); await voegPdfToe(new Uint8Array(await r.arrayBuffer())); }
      catch (e) { fouten.push(w.titel || "Werfverslag " + w.nr); }
    }
    zet("Pdf bewaren…");
    bewaarPdf(await uit.save(), `Dossier ${projTitel(p)} ${todayLocal()}.pdf`);
    toast(fouten.length ? `Pdf gedownload — niet opgenomen: ${fouten.join(", ")}` : "Pdf gedownload", fouten.length ? 9000 : 3500);
    S.dossier = null; render();
  } catch (e) { toast("Pdf maken mislukt: " + (e.message || e), 7000); if (knop) { knop.disabled = false; render(); } }
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
  const K = S.dossier; const wvs = (D().werfverslagen || []).filter(w => w.project_id === p.id && w.pdf_url);
  const kies = (d) => K ? (pdfBaar(d) ? `<input type="checkbox" class="dos-chk" data-dos="${d.id}" ${K.sel.has(d.id) ? "checked" : ""} aria-label="Opnemen in de pdf">` : `<span class="dos-chk muted" title="Dit bestandstype kan niet in een pdf">—</span>`) : "";
  const docRij = (d) => K ? `<label class="doc">${kies(d)}<span class="ic">${esc(ext(d.naam))}</span><span><div class="nm">${esc(d.naam)}</div><small>${d.gewijzigd ? fmt(d.gewijzigd) : ""}${d.grootte ? " · " + size(d.grootte) : ""}${pdfBaar(d) ? "" : " · kan niet in een pdf"}</small></span></label>` : `<a class="doc" href="${esc(safeUrl(d.url))}" target="_blank" rel="noopener"><span class="ic">${esc(ext(d.naam))}</span><span><div class="nm">${esc(d.naam)}</div><small>${d.gewijzigd ? fmt(d.gewijzigd) : ""}${d.grootte ? " · " + size(d.grootte) : ""}</small></span></a>`;
  const nKeuze = K ? K.sel.size + (K.ms ? 1 : 0) + K.wv.size : 0;
  return `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap"><h1 style="margin-bottom:6px">Documenten</h1>${(docs.length || msRows().length) ? (K ? `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" data-act="dos-alles">${docs.filter(pdfBaar).every(d => K.sel.has(d.id)) ? "Niets" : "Alles"} selecteren</button><button class="btn sm" data-act="dos-stop">Annuleren</button><button class="btn sm primary" data-act="dos-maak" ${nKeuze ? "" : "disabled"}>Pdf downloaden (${nKeuze})</button></div>` : `<button class="btn sm" data-act="dos-start" title="Kies documenten, foto's, de meetstaat en werfverslagen en bundel ze in één pdf">⤓ Pdf maken</button>`) : ""}</div><p class="muted" style="margin-bottom:16px">${K ? "Vink aan wat in je pdf moet. Plannen en documenten komen er volledig in, foto's en renders elk op een eigen pagina." : "Plannen, presentaties en documenten die we met je delen — altijd de laatste versie."}</p>
    ${K ? `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h3>Ook opnemen</h3></div><div class="panel-body" style="padding-top:4px;padding-bottom:4px">${msRows().length ? `<label class="doc"><input type="checkbox" class="dos-chk" data-dosms="1" ${K.ms ? "checked" : ""}><span class="ic">€</span><span><div class="nm">Meetstaat</div><small>met de afgesproken prijzen, ${S.msRuimte !== false ? "per ruimte" : "per nummer"}</small></span></label>` : ""}${wvs.map(w => `<label class="doc"><input type="checkbox" class="dos-chk" data-doswv="${w.id}" ${K.wv.has(w.id) ? "checked" : ""}><span class="ic">PDF</span><span><div class="nm">${esc(w.titel || "Werfverslag " + w.nr)}</div><small>werfverslag · ${fmt(w.datum)}</small></span></label>`).join("")}</div></div>` : ""}
    ${docs.length ? `<div class="stack">${groups.map(g => `<div class="panel"><div class="panel-head"><h3>${esc(g.replace(/\//g, " › ") || "Algemeen")}</h3></div><div class="panel-body" style="padding-top:4px;padding-bottom:4px">${docs.filter(d => (d.pad || "") === g).map(docRij).join("")}</div></div>`).join("")}</div>` : `<div class="panel"><div class="empty"><b>Nog geen documenten gedeeld</b>Zodra we plannen of documenten voor je klaarzetten, verschijnen ze hier.</div></div>`}`;
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
  if (el.dataset.tab) { S.tab = el.dataset.tab; S.dossier = null; render(); }
  if (el.dataset.act === "logout") sb.auth.signOut().then(() => location.reload());
  if (el.dataset.act === "betaal") { const zelfde = S.betaal === el.dataset.id && !el.dataset.ga; S.betaal = zelfde ? null : el.dataset.id; if (el.dataset.ga) S.tab = el.dataset.ga; render(!el.dataset.ga); if (S.betaal) setTimeout(() => document.getElementById("betaal_" + S.betaal)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); return; }
  if (el.dataset.act === "kopieer") { const t = el.dataset.v || ""; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast("Gekopieerd: " + t)).catch(() => toast(t, 6000)); return; }
  if (el.dataset.act === "gk-nee") { const box = $("#gk_nee_" + el.dataset.id); box.hidden = !box.hidden; if (!box.hidden) box.querySelector("textarea").focus(); }
  if (el.dataset.act === "gk-toon") { S.gkOpen = S.gkOpen === el.dataset.id ? null : el.dataset.id; render(); }
  if (el.dataset.act === "note-toggle") { S.noteOpen = S.noteOpen === el.dataset.id ? null : el.dataset.id; render(); }
  if (el.dataset.act === "ms-pdf") { const p = D().projecten.find(x => x.id === S.project); if (p) msPdf(p, el); return; }
  if (el.dataset.act === "dos-start") { const p = D().projecten.find(x => x.id === S.project); S.dossier = { sel: new Set(D().documenten.filter(d => d.project_id === p.id && pdfBaar(d)).map(d => d.id)), ms: msRows().length > 0, wv: new Set() }; render(); return; }
  if (el.dataset.act === "dos-stop") { S.dossier = null; render(); return; }
  if (el.dataset.act === "dos-alles") { const p = D().projecten.find(x => x.id === S.project); const alle = D().documenten.filter(d => d.project_id === p.id && pdfBaar(d)); const aan = !alle.every(d => S.dossier.sel.has(d.id)); S.dossier.sel = new Set(aan ? alle.map(d => d.id) : []); render(); return; }
  if (el.dataset.act === "dos-maak") { const p = D().projecten.find(x => x.id === S.project); if (p) dossierPdf(p, el); return; }
  if (el.dataset.act === "ms-ruimte") { S.msRuimte = el.dataset.on === "1"; try { localStorage.setItem("bros.klant.msRuimte", S.msRuimte ? "1" : "0"); } catch (x) { } render(); }
  if (el.dataset.act === "vl-toggle") { S.vlOpen = S.vlOpen || {}; S.vlOpen[el.dataset.key] = !S.vlOpen[el.dataset.key]; const y = window.scrollY; render(); window.scrollTo({ top: y }); }
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
  if (S.dossier && e.target.classList && e.target.classList.contains("dos-chk")) {
    const t = e.target, K = S.dossier;
    if (t.dataset.dos) K.sel[t.checked ? "add" : "delete"](t.dataset.dos);
    else if (t.dataset.doswv) K.wv[t.checked ? "add" : "delete"](t.dataset.doswv);
    else if (t.dataset.dosms) K.ms = t.checked;
    const n = K.sel.size + K.wv.size + (K.ms ? 1 : 0); const b = document.querySelector('[data-act="dos-maak"]'); if (b) { b.textContent = `Pdf downloaden (${n})`; b.disabled = !n; }
    return;
  }
  if (e.target.id === "projSel") { S.project = e.target.value; S.dossier = null; S.betaal = null; render(); }
  if (e.target.id === "weekmail") { const aan = e.target.checked; e.target.disabled = true; const { error } = await sb.rpc("klant_weekmail", { p_aan: aan });
    e.target.disabled = false; if (error) { e.target.checked = !aan; toast("Dat lukte niet: " + error.message); return; } D().ik.forEach(x => x.weekmail = aan); toast(aan ? "Je krijgt elke maandag een korte samenvatting." : "Je krijgt geen wekelijkse samenvatting meer."); }
  if (e.target.dataset.mijntaak) { const id = e.target.dataset.mijntaak, klaar = e.target.checked; e.target.disabled = true;
    const { error } = await sb.rpc("klant_taak_klaar", { p_id: id, p_klaar: klaar });
    if (error) { toast("Dat lukte niet: " + error.message); e.target.checked = !klaar; e.target.disabled = false; return; }
    D().mijnTaken.forEach(t => { if (t.id === id) t.status = klaar ? "done" : "todo"; }); D().notitieTaken.forEach(t => { if (t.id === id) t.status = klaar ? "done" : "todo"; }); render(); toast(klaar ? "Afgevinkt — bedankt!" : "Weer open gezet"); }
});

/* ---------- klantenportaal fase 2 (script 035): keuzes, meerwerk aanvragen, werfpunten melden ---------- */
const kzVanProject = (p) => (D().keuzes || []).filter(k => k.project_id === p.id).sort((a, b) => (a.ruimte || "").localeCompare(b.ruimte || "", "nl") || (a.volgorde || 0) - (b.volgorde || 0));
const kzOptiesVan = (k) => (D().keuzeOpties || []).filter(o => o.keuze_id === k.id).sort((a, b) => (a.volgorde || 0) - (b.volgorde || 0));
const mwVanProject = (p) => (D().mwAanvragen || []).filter(a => a.project_id === p.id).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
const wpVanProject = (p) => (D().werfpunten || []).filter(v => v.project_id === p.id).sort((a, b) => (b.nr || 0) - (a.nr || 0));
const werfTab = (p) => p.status === "lopend" || p.status === "afgerond" || wpVanProject(p).length > 0;
const kzBtw = (p) => (p.btw_tarief == null || p.btw_tarief === "" ? 6 : Number(p.btw_tarief) || 0) / 100;   // 0 % (btw verlegd) blijft 0 %
const kzMeer = (o, p) => { const m = Number(o.meerprijs) || 0; if (!m) return `<span class="muted">inbegrepen</span>`; return `<b>${m > 0 ? "+ " : "− "}${eur(Math.abs(m))}</b> <span class="muted">excl. btw · ${eur(Math.abs(m) * (1 + kzBtw(p)))} incl.</span>`; };
const fotoUrl = (u) => { const base = String(cfg.supabaseUrl || "").replace(/\/+$/, ""); return base && String(u || "").startsWith(base + "/storage/v1/object/public/werf/") ? String(u) : ""; };   // enkel foto's uit de eigen opslag
const fotoStrip = (fotos, h = 56) => (fotos || []).filter(f => fotoUrl(f.url)).length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${fotos.filter(f => fotoUrl(f.url)).map(f => `<a href="${esc(fotoUrl(f.url))}" target="_blank" rel="noopener"><img src="${esc(fotoUrl(f.url))}" alt="" loading="lazy" style="width:${h}px;height:${h}px;object-fit:cover;border-radius:8px;display:block"></a>`).join("")}</div>` : "";

function vKeuzes(p) {
  const ks = kzVanProject(p); const groepen = {}; ks.forEach(k => (groepen[k.ruimte || ""] = groepen[k.ruimte || ""] || []).push(k));
  const naam = D().ik[0]?.naam || S.me?.name || ""; const vandaag = todayLocal();
  const kaart = (k) => { const os = kzOptiesVan(k); const gekozen = os.find(o => o.id === k.gekozen_optie); const open = k.status === "open"; const laat = open && k.deadline && k.deadline < vandaag;
    return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h2 style="font-size:18px">${esc(k.onderwerp)}</h2><div class="muted" style="font-size:13px">${open ? (k.deadline ? `<span style="${laat ? "color:var(--crit)" : ""}">Graag kiezen vóór ${fmtLang(k.deadline)}</span>` : "Wacht op je keuze") : k.status === "gekozen" ? `Gekozen op ${fmtLang((k.gekozen_op || "").slice(0, 10))} — BROS bevestigt je keuze` : k.status === "bevestigd" ? `Gekozen op ${fmtLang((k.gekozen_op || "").slice(0, 10))} · bevestigd door BROS` : "Vervallen"}</div></div>
        <span class="pill ${open ? "open" : k.status === "vervallen" ? "grijs" : "akkoord"}">${open ? "Te kiezen" : k.status === "vervallen" ? "Vervallen" : "Gekozen"}</span></div>
      ${k.toelichting ? `<div class="panel-body" style="white-space:pre-line;font-size:14px">${esc(k.toelichting)}</div>` : ""}
      <form class="kz-form panel-body" data-kz="${k.id}" style="${k.toelichting ? "border-top:1px solid var(--line)" : ""}">
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">${os.map(o => { const isG = gekozen && gekozen.id === o.id;
          return `<label class="kz-optie ${isG ? "gekozen" : ""} ${!open && !isG ? "dim" : ""}" style="display:block;border:2px solid ${isG ? "var(--ok)" : "var(--line)"};border-radius:14px;overflow:hidden;cursor:${open ? "pointer" : "default"};background:var(--surface)">
            ${(o.fotos || [])[0] && fotoUrl(o.fotos[0].url) ? `<img src="${esc(fotoUrl(o.fotos[0].url))}" alt="" loading="lazy" style="width:100%;height:160px;object-fit:cover;display:block">` : ""}
            <div style="padding:10px 12px">${open ? `<input type="radio" name="optie" value="${o.id}" style="margin-right:6px">` : isG ? "✓ " : ""}<b>${esc(o.naam)}</b>
              <div style="font-size:13px;margin-top:2px">${kzMeer(o, p)}</div>
              ${o.omschrijving ? `<div class="muted" style="font-size:13px;margin-top:4px">${esc(o.omschrijving)}</div>` : ""}
              ${o.leverancier || o.referentie ? `<div class="muted" style="font-size:12px;margin-top:4px">${esc([o.leverancier, o.referentie].filter(Boolean).join(" · "))}</div>` : ""}
              ${o.link ? `<div style="font-size:12px;margin-top:4px"><a href="${esc(safeUrl(o.link))}" target="_blank" rel="noopener">Meer info ↗</a></div>` : ""}
              ${(o.fotos || []).length > 1 ? fotoStrip(o.fotos.slice(1), 44) : ""}</div></label>`; }).join("")}</div>
        ${open ? `<div class="kp-form" style="margin-top:14px;max-width:560px"><label class="field">Je naam<input name="naam" value="${esc(naam)}" autocomplete="name"></label>
          <label class="field">Opmerking (optioneel)<input name="opmerking" placeholder="bv. graag in mat zwart als dat kan"></label>
          <label class="check"><input type="checkbox" name="ok"> <span>Ik kies de aangeduide optie${os.some(o => Number(o.meerprijs)) ? " en ga akkoord met de vermelde meer- of minprijs (die wordt meerwerk in je meetstaat)" : ""}.</span></label>
          <div class="gk-actions"><button class="btn primary" type="submit">Keuze bevestigen</button></div><div class="msg"></div></div>`
        : gekozen && k.gekozen_opmerking ? `<p class="muted" style="font-size:13px;margin:10px 0 0">Je opmerking: “${esc(k.gekozen_opmerking)}”</p>` : ""}
      </form></div>`; };
  return `<h1 style="margin-bottom:6px">Keuzes</h1><p class="muted" style="margin-bottom:16px">Materialen en afwerkingen die je zelf kiest. Kies per onderwerp één optie en bevestig met je naam. Een meer- of minprijs komt automatisch in je meetstaat. Twijfel je? Stel je vraag aan je aanspreekpunt.</p>
    ${ks.length ? Object.keys(groepen).sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b, "nl")).map(r => `${r ? `<h3 style="margin:18px 0 10px">${esc(r)}</h3>` : ""}${groepen[r].map(kaart).join("")}`).join("") : `<div class="panel"><div class="empty"><b>Geen keuzes</b>Zodra BROS je iets laat kiezen, verschijnt het hier.</div></div>`}`;
}

function vMeerwerk(p) {
  const lijst = mwVanProject(p); const st = { ingediend: ["Ontvangen", "open"], in_behandeling: ["In behandeling", "open"], voorstel: ["Voorstel klaar", "akkoord"], geweigerd: ["Niet mogelijk", "grijs"], ingetrokken: ["Ingetrokken", "grijs"] };
  return `<div class="panel" style="margin-top:16px"><div class="panel-head"><div><h2>Iets extra nodig?</h2><div class="muted" style="font-size:13px">Vraag hier een meerwerk aan: beschrijf wat je wil (eventueel met foto's). BROS maakt er een prijsvoorstel van dat je hierboven goedkeurt.</div></div>${S.mwNieuw ? "" : `<button class="btn primary sm" data-act="mw-nieuw">Meerwerk aanvragen</button>`}</div>
    ${S.mwNieuw ? `<form id="mwForm" class="panel-body kp-form" style="border-top:1px solid var(--line);max-width:620px">
      <label class="field">Wat wil je extra? (korte titel)<input name="titel" maxlength="160" required placeholder="bv. Extra stopcontact in de garage"></label>
      <label class="field">Omschrijving<textarea name="omschrijving" rows="3" maxlength="4000" placeholder="Zo concreet mogelijk: waar, hoeveel, welke uitvoering …"></textarea></label>
      <label class="field">Ruimte (optioneel)<input name="ruimte" maxlength="120"></label>
      <label class="field">Foto's (optioneel, max. 6)<input type="file" name="fotos" accept="image/*" multiple></label>
      <div class="gk-actions"><button class="btn primary" type="submit">Aanvraag versturen</button><button class="btn" type="button" data-act="mw-nieuw">Annuleren</button></div><div class="msg"></div></form>` : ""}
    ${lijst.length ? `<div class="tw"><table class="t"><tbody>${lijst.map(a => { const [lbl, cls] = st[a.status] || [a.status, "grijs"]; const g = a.goedkeuring_id && D().goedkeuringen.find(x => x.id === a.goedkeuring_id);
      return `<tr><td><b>${esc(a.titel)}</b>${a.ruimte ? ` <span class="muted">· ${esc(a.ruimte)}</span>` : ""}<div class="muted" style="font-size:12px">aangevraagd op ${fmt(a.created_at)}</div>${a.omschrijving ? `<div style="font-size:13px;white-space:pre-line;margin-top:4px">${esc(a.omschrijving)}</div>` : ""}${fotoStrip(a.fotos, 44)}
        ${a.antwoord ? `<div style="margin-top:8px;padding:8px 10px;background:var(--surface-2);border-radius:8px;font-size:13px;white-space:pre-line"><b>BROS:</b> ${esc(a.antwoord)}</div>` : ""}</td>
        <td style="white-space:nowrap"><span class="pill ${cls}">${esc(lbl)}</span>${g ? `<div style="margin-top:6px"><button class="btn sm" data-act="gk-toon" data-id="${g.id}">Voorstel bekijken</button></div>` : ""}${a.status === "ingediend" || a.status === "in_behandeling" ? `<div style="margin-top:6px"><button class="btn ghost sm" data-act="mw-intrek" data-id="${a.id}">Intrekken</button></div>` : ""}</td></tr>`; }).join("")}</tbody></table></div>` : ""}</div>`;
}

const WP_STATUS = (v) => v.te_beoordelen && v.status === "open" ? ["Ontvangen — BROS bekijkt het", "open"] : ({ open: ["In behandeling", "open"], opgelost: ["Opgelost — wordt nagekeken", "akkoord"], gecontroleerd: ["Afgewerkt", "akkoord"], vervallen: ["Vervallen", "grijs"] })[v.status] || [v.status, "grijs"];
function vWerf(p) {
  const ps = wpVanProject(p); const ruimtes = [...new Set(ps.map(v => v.ruimte).filter(Boolean))].sort();
  const groep = (titel, lijst) => lijst.length ? `<h3 style="margin:18px 0 10px">${titel} <span class="muted" style="font-weight:400">${lijst.length}</span></h3><div class="stack">${lijst.map(v => { const [lbl, cls] = WP_STATUS(v);
    return `<div class="panel"><div class="panel-body"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><div><b>${esc(v.titel || "Werfpunt")}</b> <span class="muted num" style="font-size:12px">V-${String(v.nr || 0).padStart(3, "0")}</span>${v.door_klant ? ` <span class="pill grijs" style="font-size:11px">door jou gemeld</span>` : ""}<div class="muted" style="font-size:13px">${esc([v.ruimte, "gemeld " + fmt(v.created_at)].filter(Boolean).join(" · "))}${v.deadline && v.status === "open" && !v.te_beoordelen ? ` · op te lossen tegen ${fmt(v.deadline)}` : ""}</div></div><span class="pill ${cls}">${esc(lbl)}</span></div>
      ${v.omschrijving ? `<div style="font-size:14px;white-space:pre-line;margin-top:6px">${esc(v.omschrijving)}</div>` : ""}${fotoStrip(v.fotos)}
      ${(v.opgelost_fotos || []).length ? `<div class="muted" style="font-size:12px;margin-top:8px">Na de herstelling${v.opgelost_op ? " (" + fmt(v.opgelost_op) + ")" : ""}:</div>${fotoStrip(v.opgelost_fotos)}` : ""}</div></div>`; }).join("")}</div>` : "";
  return `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap"><div><h1 style="margin-bottom:6px">Werf</h1><p class="muted" style="margin-bottom:16px">Zie je iets dat niet in orde is, of bij de oplevering iets dat nog moet gebeuren? Meld het hier met een foto: BROS bekijkt het en zorgt dat de juiste vakman het oplost. Je volgt hier de status.</p></div>${S.wpNieuw ? "" : `<button class="btn primary" data-act="wp-nieuw">Punt melden</button>`}</div>
    ${S.wpNieuw ? `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h2>Nieuw punt</h2></div><form id="wpForm" class="panel-body kp-form" style="max-width:620px">
      <label class="field">Wat is er? (korte titel)<input name="titel" maxlength="160" required placeholder="bv. Kras in het parket bij de voordeur"></label>
      <label class="field">Omschrijving (optioneel)<textarea name="omschrijving" rows="3" maxlength="4000"></textarea></label>
      <label class="field">Ruimte<input name="ruimte" maxlength="120" list="wp_ruimtes" placeholder="bv. Living"><datalist id="wp_ruimtes">${ruimtes.map(r => `<option value="${esc(r)}">`).join("")}</datalist></label>
      <label class="field">Foto's (max. 6)<input type="file" name="fotos" accept="image/*" multiple capture="environment"></label>
      <div class="gk-actions"><button class="btn primary" type="submit">Punt versturen</button><button class="btn" type="button" data-act="wp-nieuw">Annuleren</button></div><div class="msg"></div></form></div>` : ""}
    ${ps.length ? groep("Ontvangen", ps.filter(v => v.te_beoordelen && v.status === "open")) + groep("In behandeling", ps.filter(v => !v.te_beoordelen && v.status === "open")) + groep("Opgelost", ps.filter(v => v.status === "opgelost")) + groep("Afgewerkt", ps.filter(v => v.status === "gecontroleerd")) + groep("Vervallen", ps.filter(v => v.status === "vervallen"))
      : `<div class="panel"><div class="empty"><b>Nog niets gemeld</b>Hier volg je de punten die je zelf meldt. De punten die BROS tijdens een werfbezoek noteert, vind je in de werfverslagen onder Verslagen.</div></div>`}`;
}

/* foto's van de klant: verkleinen in de browser (max. 1600 px, jpeg) en uploaden in <project>/klant/ */
async function klantFoto(pid, file) {
  let img = null;
  if (window.createImageBitmap) img = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (!img) img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Deze foto kan niet gelezen worden.")); i.src = URL.createObjectURL(file); });
  const s = Math.min(1, 1600 / Math.max(img.width, img.height)); const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.82));
  const path = `${pid}/klant/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await sb.storage.from("werf").upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw new Error("Foto uploaden mislukte: " + error.message);
  return { path, url: sb.storage.from("werf").getPublicUrl(path).data.publicUrl, w: c.width, h: c.height };
}
/* BROS verwittigen (mail naar de projectverantwoordelijke via het Drive-script); mislukt dit, dan ziet BROS het toch in het Planbord */
function klantMelding(soort, id) { if (!cfg.driveScriptUrl) return; fetch(cfg.driveScriptUrl, { method: "POST", body: JSON.stringify({ action: "klantmelding", soort, id, token: S.session?.access_token || "" }), redirect: "follow" }).catch(() => { }); }
async function fotosUit(form, p, msg) {
  const files = [...(form.querySelector('input[type="file"]')?.files || [])].filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|heic|webp)$/i.test(f.name)).slice(0, 6); const out = [];
  for (let i = 0; i < files.length; i++) { msg.textContent = `Foto ${i + 1}/${files.length} uploaden…`; out.push(await klantFoto(p.id, files[i])); }
  return out;
}
document.addEventListener("submit", async (e) => {
  const f = e.target; const p = S.ready ? P() : null; if (!p) return;
  if (f.classList && f.classList.contains("kz-form")) {
    e.preventDefault(); const m = f.querySelector(".msg"); const k = (D().keuzes || []).find(x => x.id === f.dataset.kz); if (!k || !m) return;
    const optie = f.querySelector('input[name="optie"]:checked')?.value; const naam = f.querySelector('[name="naam"]').value.trim();
    if (!optie) { m.className = "msg err"; m.textContent = "Duid eerst een optie aan."; return; }
    if (naam.length < 2) { m.className = "msg err"; m.textContent = "Vul je naam in."; return; }
    if (!f.querySelector('[name="ok"]').checked) { m.className = "msg err"; m.textContent = "Vink aan dat je deze optie kiest."; return; }
    f.querySelectorAll("button").forEach(b => b.disabled = true); m.className = "msg"; m.textContent = "Even geduld…"; S.gkBezig = true;
    try {
      const gezien = (D().keuzeOpties || []).find(o => o.id === optie);   // de prijs die de klant zag: wijzigde ze intussen, dan weigert de databank
      const { error } = await sb.rpc("klant_keuze_maken", { p_keuze: k.id, p_optie: optie, p_naam: naam, p_opmerking: f.querySelector('[name="opmerking"]').value.trim(), p_meerprijs: gezien ? Number(gezien.meerprijs) || 0 : null });
      if (error) { m.className = "msg err"; m.textContent = "Dat lukte niet: " + error.message; f.querySelectorAll("button").forEach(b => b.disabled = false); if (/prijs/.test(error.message)) { try { await loadAll(true); render(true); } catch (x) { } } return; }
      klantMelding("keuze", k.id); try { await loadAll(true); } catch (x) { } render(true); toast("Bedankt — je keuze is doorgegeven aan BROS.", 5000);
    } finally { S.gkBezig = false; }
    return;
  }
  if (f.id === "mwForm" || f.id === "wpForm") {
    e.preventDefault(); const m = f.querySelector(".msg"); const titel = f.titel.value.trim();
    if (titel.length < 3) { m.className = "msg err"; m.textContent = "Geef een korte titel (minstens 3 tekens)."; return; }
    f.querySelectorAll("button").forEach(b => b.disabled = true); m.className = "msg"; m.textContent = "Even geduld…"; S.gkBezig = true;
    try {
      const fotos = await fotosUit(f, p, m);
      const args = { p_project: p.id, p_titel: titel, p_omschrijving: f.omschrijving.value.trim(), p_ruimte: f.ruimte.value.trim(), p_fotos: fotos };
      const { data, error } = await sb.rpc(f.id === "mwForm" ? "klant_meerwerk_aanvragen" : "klant_werfpunt_melden", args);
      if (error) throw new Error(error.message);
      klantMelding(f.id === "mwForm" ? "meerwerk" : "werfpunt", f.id === "mwForm" ? data?.id : data);
      if (f.id === "mwForm") S.mwNieuw = false; else S.wpNieuw = false;
      try { await loadAll(true); } catch (x) { } render(true); toast(f.id === "mwForm" ? "Je aanvraag is verstuurd — BROS neemt ze op." : "Je punt is gemeld — BROS bekijkt het.", 5000);
    } catch (err) { m.className = "msg err"; m.textContent = "Dat lukte niet: " + (err.message || err); f.querySelectorAll("button").forEach(b => b.disabled = false); }
    finally { S.gkBezig = false; }
  }
});
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]"); if (!el || !S.ready) return;
  if (el.dataset.act === "mw-nieuw") { S.mwNieuw = !S.mwNieuw; render(true); if (S.mwNieuw) setTimeout(() => $("#mwForm input[name=titel]")?.focus(), 30); }
  if (el.dataset.act === "wp-nieuw") { S.wpNieuw = !S.wpNieuw; render(true); if (S.wpNieuw) setTimeout(() => $("#wpForm input[name=titel]")?.focus(), 30); }
  if (el.dataset.act === "mw-intrek") { if (!confirm("Deze aanvraag intrekken?")) return; const { error } = await sb.rpc("klant_meerwerk_intrekken", { p_id: el.dataset.id }); if (error) return toast("Dat lukte niet: " + error.message, 5000); await loadAll(true); render(true); toast("Aanvraag ingetrokken"); }
  if (el.dataset.act === "gk-toon" && S.tab !== "akkoord") { S.tab = "akkoord"; S.gkOpen = el.dataset.id; render(); }
});

/* ---------- live bijwerken (script 034): bij elke wijziging aan het project herlaadt het portaal stil ---------- */
let liveKanaal = null, liveT = null, liveLaatst = Date.now();
function liveStart() {
  if (liveKanaal || !S.ready || !S.session) return;
  liveKanaal = sb.channel("portaal-live").on("postgres_changes", { event: "*", schema: "public", table: "portaal_pings" }, (payload) => {
    if (payload.eventType === "DELETE") return; liveHerlaad(1200);   // de databank stuurt enkel meldingen van eigen projecten (ook een net gekoppeld project)
  }).subscribe();
}
/* niet herladen terwijl de klant iets invult, een dossier samenstelt of een vraag stelt: even later opnieuw proberen */
const liveBezig = () => {
  const a = document.activeElement; if (S.dossier || S.chatBezig || S.gkBezig) return true;
  if (a && a.closest && a.closest("#app") && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.id !== "weekmail") return true;
  // half ingevuld akkoordformulier, reden of chatvraag: niet wegvegen
  return [...document.querySelectorAll("#app form input, #app form textarea")].some(el => el.type === "checkbox" || el.type === "radio" ? el.checked !== el.defaultChecked : el.type !== "hidden" && String(el.value || "").trim() !== "" && el.defaultValue !== el.value);
};
function liveHerlaad(ms) {
  clearTimeout(liveT);
  liveT = setTimeout(async () => {
    if (!S.ready) return; if (liveBezig()) return liveHerlaad(5000);
    try { const y = window.scrollY; await loadAll(true); liveLaatst = Date.now(); if (liveBezig()) return liveHerlaad(5000); render(true); window.scrollTo({ top: y }); } catch (e) { }
  }, ms);
}
// vangnet: terug naar het tabblad na meer dan 2 minuten, of elke 10 minuten zolang het portaal open staat
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.ready && Date.now() - liveLaatst > 120000) liveHerlaad(200); });
setInterval(() => { if (document.visibilityState === "visible" && S.ready && Date.now() - liveLaatst > 600000) liveHerlaad(0); }, 60000);
// als app op het beginscherm (service worker): de app-schil blijft zo ook bij een zwak signaal snel beschikbaar
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => { });

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
