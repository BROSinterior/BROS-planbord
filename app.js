/* =====================================================================
   BROS Planbord — app v1.0
   Statische webapp op Supabase (login, live-synchronisatie, rechten)
   ===================================================================== */
const APP_VERSION = "1.0.0";
const PROJ_STATUS = { lopend: "Lopend", offerte: "In offerte", on_hold: "On hold", afgerond: "Afgerond" };
const TASK_STATUS = { todo: "Te doen", busy: "Bezig", done: "Klaar" };
const PALETTE = ["#2A4DD0", "#1E8A5C", "#B8720F", "#8A4BC7", "#C2452F", "#0F7C8C", "#6B6B7B"];

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- datums: altijd op UTC-middernacht rekenen (geen zomer-/wintertijdproblemen) ---------- */
const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const pd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const _n = new Date();
const todayIso = `${_n.getFullYear()}-${String(_n.getMonth() + 1).padStart(2, "0")}-${String(_n.getDate()).padStart(2, "0")}`;
const addDays = (s, n) => iso(new Date(pd(s).getTime() + n * DAY));
const diffDays = (a, b) => Math.round((pd(b) - pd(a)) / DAY);
const mondayOf = (s) => { const d = pd(s); const w = (d.getUTCDay() + 6) % 7; return addDays(s, -w); };
const fmt = (s) => { if (!s) return "—"; const d = pd(s); return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
const fmtLong = (s) => { if (!s) return "—"; const d = pd(s); return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`; };
const weekNr = (s) => { const t = pd(s); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y0) / DAY + 1) / 7); };
const MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const DAYS = ["ma", "di", "wo", "do", "vr", "za", "zo"];
const nl = (n, dec = 1) => (Math.round((Number(n) || 0) * 10 ** dec) / 10 ** dec).toLocaleString("nl-BE", { minimumFractionDigits: 0, maximumFractionDigits: dec });
const eur = (n) => n == null || n === "" ? "—" : Number(n).toLocaleString("nl-BE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const workdays = (a, b) => { let n = 0; for (let s = a; s <= b; s = addDays(s, 1)) { const d = pd(s).getUTCDay(); if (d !== 0 && d !== 6) n++; } return Math.max(n, 1); };

/* ---------- state ---------- */
const S = {
  session: null, me: null,
  profiles: {}, tarieven: {}, fasen: {}, standaardtaken: [], projecten: {}, taken: {}, uren: {},
  view: "overzicht", project: null, ptab: "taken",
  filters: { user: "", status: "", project: "", q: "" },
  ganttStart: addDays(mondayOf(todayIso), -14), ganttDays: 112, ganttOpen: {},
  weekStart: mondayOf(todayIso), hoursUser: null,
  ready: false, loadError: null,
};
const cfg = window.PLANBORD_CONFIG || {};
const configured = cfg.supabaseUrl && !cfg.supabaseUrl.includes("VUL-IN") && cfg.supabaseAnonKey && cfg.supabaseAnonKey !== "VUL-IN";
const sb = configured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;

/* ---------- helpers ---------- */
const isBeheer = () => S.me?.role === "beheer";
const users = () => Object.values(S.profiles).filter(u => u.active !== false).sort((a, b) => a.name.localeCompare(b.name));
const projects = () => Object.values(S.projecten).sort((a, b) => (a.klant || "").localeCompare(b.klant || ""));
const tasksOf = (pid) => Object.values(S.taken).filter(t => t.project_id === pid).sort((a, b) => (a.volgorde ?? 0) - (b.volgorde ?? 0) || (a.start || "9").localeCompare(b.start || "9"));
const hoursOf = (pred) => Object.values(S.uren).filter(pred).reduce((s, h) => s + (Number(h.uren) || 0), 0);
const taskDone = (tid) => hoursOf(h => h.taak_id === tid);
const projDone = (pid) => hoursOf(h => h.project_id === pid);
const projPlanned = (pid) => tasksOf(pid).reduce((s, t) => s + (Number(t.uren_gepland) || 0), 0);
const isLate = (t) => t.status !== "done" && t.eind && t.eind < todayIso;
const userById = (id) => S.profiles[id] || { name: "—", initials: "?", color: "#999" };
const projName = (p) => p ? (p.klant + (p.naam ? " · " + p.naam : "")) : "—";
const faseName = (nr) => nr ? (S.fasen[nr] ? `${nr} · ${S.fasen[nr].naam}` : String(nr)) : "";
const faseShort = (nr) => nr && S.fasen[nr] ? S.fasen[nr].naam : "";
const fasenList = () => Object.values(S.fasen).filter(f => f.actief !== false).sort((a, b) => a.nr - b.nr);
const projSpan = (p) => { const ts = tasksOf(p.id); const st = [p.start, ...ts.map(t => t.start)].filter(Boolean).sort()[0]; const en = [p.eind, ...ts.map(t => t.eind)].filter(Boolean).sort().pop(); return [st, en]; };
const avatar = (id) => { const u = userById(id); return `<span class="avatar" style="background:${u.color}" title="${esc(u.name)}">${esc(u.initials)}</span>`; };
const pill = (t) => isLate(t) ? `<span class="pill late">Te laat</span>` : `<span class="pill ${t.status}">${TASK_STATUS[t.status] || t.status}</span>`;
const kost = (uid, uren, soort) => (Number(S.tarieven[uid]?.[soort]) || 0) * uren;
const projKost = (pid, soort) => Object.values(S.uren).filter(h => h.project_id === pid).reduce((s, h) => s + kost(h.user_id, Number(h.uren) || 0, soort), 0);
let toastT; function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2800); }

/* ---------- data laden en live houden ---------- */
const TABLES = { profiles: "profiles", tarieven: "tarieven", fasen: "fasen", standaardtaken: "standaardtaken", projecten: "projecten", taken: "taken", uren: "uren" };
function ingest(table, rows) {
  if (table === "standaardtaken") { S.standaardtaken = rows.sort((a, b) => a.fase_nr - b.fase_nr || a.volgorde - b.volgorde); return; }
  const key = table === "fasen" ? "nr" : table === "tarieven" ? "user_id" : "id";
  const o = {}; rows.forEach(r => o[r[key]] = r); S[table] = o;
}
async function loadAll() {
  const res = await Promise.all(Object.keys(TABLES).map(t => sb.from(t).select("*").limit(5000)));
  Object.keys(TABLES).forEach((t, i) => { if (res[i].error) { if (t !== "tarieven") throw res[i].error; } else ingest(t, res[i].data || []); });
  S.me = S.profiles[S.session.user.id] || null;
}
function subscribe() {
  const ch = sb.channel("planbord");
  ["profiles", "tarieven", "fasen", "standaardtaken", "projecten", "taken", "uren"].forEach(t => {
    ch.on("postgres_changes", { event: "*", schema: "public", table: t }, (payload) => {
      if (t === "standaardtaken") { refetch(t); return; }
      const key = t === "fasen" ? "nr" : t === "tarieven" ? "user_id" : "id";
      if (payload.eventType === "DELETE") { delete S[t][payload.old[key]]; }
      else { S[t][payload.new[key]] = payload.new; }
      if (t === "profiles") S.me = S.profiles[S.session.user.id] || S.me;
      render();
    });
  });
  ch.subscribe((status) => { if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setTimeout(() => refetchAll(), 3000); });
  // Veiligheidsnet: bij terugkeer naar het tabblad alles verversen
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refetchAll(); });
}
async function refetch(t) { const { data, error } = await sb.from(t).select("*").limit(5000); if (!error) { ingest(t, data || []); render(); } }
async function refetchAll() { try { await loadAll(); render(); } catch (e) { } }

/* ---------- schrijven (optimistisch: eerst lokaal, dan database) ---------- */
async function dbInsert(table, row) {
  const { data, error } = await sb.from(table).insert(row).select().single();
  if (error) { toast("Bewaren mislukt: " + error.message); throw error; }
  const key = table === "tarieven" ? "user_id" : "id"; S[table][data[key]] = data; render(); return data;
}
async function dbUpdate(table, id, patch) {
  const key = table === "tarieven" ? "user_id" : "id";
  const prev = S[table][id]; S[table][id] = { ...prev, ...patch }; render();
  const { data, error } = await sb.from(table).update(patch).eq(key, id).select().single();
  if (error) { S[table][id] = prev; render(); toast("Bewaren mislukt: " + error.message); throw error; }
  S[table][id] = data; render(); return data;
}
async function dbUpsert(table, row) {
  const key = table === "tarieven" ? "user_id" : "id";
  const { data, error } = await sb.from(table).upsert(row).select().single();
  if (error) { toast("Bewaren mislukt: " + error.message); throw error; }
  S[table][data[key]] = data; render(); return data;
}
async function dbDelete(table, id) {
  const prev = S[table][id]; delete S[table][id]; render();
  const { error } = await sb.from(table).delete().eq("id", id);
  if (error) { S[table][id] = prev; render(); toast("Verwijderen mislukt: " + error.message); throw error; }
}

/* ---------- render root ---------- */
const TABS = [["overzicht", "Overzicht"], ["projecten", "Projecten"], ["taken", "Taken"], ["planning", "Planning"], ["uren", "Uren"], ["team", "Team"]];
function render() {
  const app = $("#app");
  if (!configured) { app.innerHTML = `<div class="login"><div class="card"><h1>BROS Planbord</h1><p>De app is nog niet gekoppeld aan de database. Vul <code>config.js</code> in (Project URL en anon public-sleutel uit Supabase) en herlaad.</p></div></div>`; return; }
  if (!S.session) { renderLogin(); return; }
  if (S.loadError) { app.innerHTML = `<div class="login"><div class="card"><h1>Kon de gegevens niet laden</h1><p class="err">${esc(S.loadError)}</p><button class="btn" data-act="logout">Uitloggen</button> <button class="btn primary" data-act="reload">Opnieuw proberen</button></div></div>`; return; }
  if (!S.ready) { app.innerHTML = `<div class="login"><div class="card"><h1>BROS Planbord</h1><p>Gegevens laden…</p></div></div>`; return; }
  if (!S.me) { app.innerHTML = `<div class="login"><div class="card"><h1>Nog geen profiel</h1><p>Je login werkt, maar er is nog geen medewerkersprofiel gekoppeld. Vraag de beheerder om je uit te nodigen, of herlaad de pagina.</p><button class="btn" data-act="logout">Uitloggen</button> <button class="btn primary" data-act="reload">Herladen</button></div></div>`; return; }
  const views = { overzicht: vOverzicht, projecten: vProjecten, taken: vTaken, planning: vPlanning, uren: vUren, team: vTeam };
  app.innerHTML = `
  <header class="top">
    <div class="top-in">
      <div class="brand"><span class="mark">BROS</span><span class="name">Planbord</span></div>
      <nav class="tabs" aria-label="Hoofdnavigatie">${TABS.map(([k, l]) => `<button data-nav="${k}" ${S.view === k ? 'aria-current="page"' : ""}>${l}</button>`).join("")}</nav>
      <div class="who"><span class="who-cell">${avatar(S.me.id)}<span style="font-weight:600">${esc(S.me.name)}</span></span><button class="btn ghost sm" data-act="logout" title="Uitloggen">Uitloggen</button></div>
    </div>
    <div class="update" id="updateBar"><span>Er is een nieuwe versie van het Planbord.</span><button class="btn sm primary" data-act="reload">Nu herladen</button><button class="btn sm ghost" data-act="update-later">Later</button></div>
  </header>
  <main>${(views[S.view] || vOverzicht)()}</main>
  <footer>BROS Planbord v${APP_VERSION}</footer>`;
  if (updateAvailable) $("#updateBar").classList.add("show");
}
let loginMode = "password";
function renderLogin() {
  const pw = loginMode === "password";
  $("#app").innerHTML = `<div class="login"><div class="card">
    <div class="brand" style="margin-bottom:14px"><span class="mark">BROS</span><span class="name">Planbord</span></div>
    <h1>Inloggen</h1><p>${pw ? "Log in met je e-mailadres en wachtwoord." : "Vul je e-mailadres in; je krijgt een link in je mailbox waarmee je meteen binnen bent."}</p>
    <form id="loginForm"><div class="field"><label for="email">E-mailadres</label><input id="email" type="email" required autocomplete="username" placeholder="naam@bros.be"></div>
    ${pw ? `<div class="field"><label for="password">Wachtwoord</label><input id="password" type="password" required autocomplete="current-password"></div>` : ""}
    <button class="btn primary" type="submit" id="loginBtn">${pw ? "Inloggen" : "Stuur mij een inloglink"}</button></form>
    <div class="msg" id="loginMsg"></div>
    <p style="margin:16px 0 0;font-size:13px"><button class="btn ghost sm" type="button" id="loginSwitch">${pw ? "Liever een inloglink per e-mail?" : "Liever met wachtwoord inloggen?"}</button></p></div></div>`;
  $("#loginSwitch").onclick = () => { loginMode = pw ? "otp" : "password"; renderLogin(); };
  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault(); const email = $("#email").value.trim(); const btn = $("#loginBtn"); btn.disabled = true; const m = $("#loginMsg"); m.className = "msg"; m.textContent = "";
    if (pw) {
      const { error } = await sb.auth.signInWithPassword({ email, password: $("#password").value });
      if (error) { m.className = "msg err"; m.textContent = /invalid/i.test(error.message) ? "E-mailadres of wachtwoord klopt niet." : "Dat lukte niet: " + error.message; btn.disabled = false; }
    } else {
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
      if (error) { m.className = "msg err"; m.textContent = "Dat lukte niet: " + error.message + (/signup/i.test(error.message) ? " — dit adres is nog niet uitgenodigd of nog niet bevestigd." : ""); btn.disabled = false; }
      else { m.textContent = "Link verstuurd naar " + email + ". Kijk in je mailbox (ook bij spam) en klik op de link."; }
    }
  };
}

/* ---------- Overzicht ---------- */
function vOverzicht() {
  const ps = projects(), lopend = ps.filter(p => p.status === "lopend");
  const ts = Object.values(S.taken), open = ts.filter(t => t.status !== "done"), late = open.filter(isLate);
  const wk0 = mondayOf(todayIso), wk1 = addDays(wk0, 6);
  const weekHours = hoursOf(h => h.datum >= wk0 && h.datum <= wk1);
  const mine = open.filter(t => t.assignee === S.me.id).sort((a, b) => (a.eind || "9").localeCompare(b.eind || "9")).slice(0, 10);
  return `
  <div class="page-head"><div><div class="eyebrow">Week ${weekNr(todayIso)} · ${fmtLong(todayIso)}</div><h1>Overzicht</h1></div>
    <div class="actions"><button class="btn" data-act="new-task">+ Taak</button><button class="btn" data-act="log-hours">+ Uren</button>${isBeheer() ? `<button class="btn primary" data-act="new-project">+ Project</button>` : ""}</div></div>
  <div class="grid kpi" style="margin-bottom:16px">
    <div class="panel kpi-tile"><div class="eyebrow">Lopende projecten</div><div class="v">${lopend.length}<small>/ ${ps.length}</small></div><div class="d">${ps.filter(p => p.status === "offerte").length} in offerte</div></div>
    <div class="panel kpi-tile"><div class="eyebrow">Open taken</div><div class="v">${open.length}</div><div class="d">${open.filter(t => t.status === "busy").length} bezig</div></div>
    <div class="panel kpi-tile ${late.length ? "crit" : ""}"><div class="eyebrow">Te laat</div><div class="v">${late.length}</div><div class="d">einddatum verstreken</div></div>
    <div class="panel kpi-tile"><div class="eyebrow">Uren deze week</div><div class="v">${nl(weekHours)}<small>u</small></div><div class="d">team, wk ${weekNr(todayIso)}</div></div>
  </div>
  <div class="grid two">
    <div class="panel"><div class="panel-head"><h3>Mijn taken</h3><button class="btn ghost sm" data-nav="taken">Alle taken →</button></div>
      ${mine.length ? `<div class="tw"><table class="t"><thead><tr><th></th><th>Taak</th><th>Project</th><th>Deadline</th><th class="r">Uren</th><th>Status</th></tr></thead><tbody>${mine.map(t => taskRow(t, true)).join("")}</tbody></table></div>` : `<div class="empty"><b>Niets open voor jou</b>Maak een taak aan of laat er een aan jou toewijzen.</div>`}
    </div>
    <div class="panel"><div class="panel-head"><h3>Uren per project</h3><span class="muted" style="font-size:12px">gepresteerd / gepland</span></div>
      <div class="panel-body" style="display:grid;gap:12px">
      ${lopend.concat(ps.filter(p => p.status === "offerte")).map(p => { const pl = projPlanned(p.id), dn = projDone(p.id), pct = pl ? Math.min(dn / pl, 1) * 100 : 0; return `
        <div><div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px"><button class="btn ghost sm" style="padding-left:0" data-open="${p.id}">${esc(projName(p))}</button><span class="num">${nl(dn)} / ${nl(pl)} u</span></div><div class="bar"><i class="${dn > pl && pl ? "over" : ""}" style="width:${pct}%"></i></div></div>`; }).join("") || `<div class="empty">Nog geen projecten.</div>`}
      </div></div>
  </div>
  <div style="margin-top:16px">${ganttHtml(ps.filter(p => p.status !== "afgerond"), { compact: true, title: "Timing alle projecten" })}</div>`;
}
function taskRow(t, withProject) {
  const p = S.projecten[t.project_id];
  return `<tr class="click" data-edit-task="${t.id}">
    <td style="width:28px"><input type="checkbox" class="task-check" data-toggle="${t.id}" ${t.status === "done" ? "checked" : ""} aria-label="Klaar"></td>
    <td><div class="row-title">${esc(t.titel)}<small>${esc(faseName(t.fase_nr))}</small></div></td>
    ${withProject ? `<td>${esc(p ? p.klant : "—")}</td>` : ""}
    <td class="num" style="color:${isLate(t) ? "var(--crit)" : "inherit"}">${fmt(t.eind)}</td>
    <td class="r num">${nl(taskDone(t.id))} / ${nl(t.uren_gepland)}</td>
    <td>${pill(t)}</td></tr>`;
}

/* ---------- Projecten ---------- */
function vProjecten() {
  if (S.project && S.projecten[S.project]) return vProjectDetail(S.projecten[S.project]);
  const ps = projects().filter(p => !S.filters.status || p.status === S.filters.status);
  return `
  <div class="page-head"><div><div class="eyebrow">${ps.length} projecten</div><h1>Projecten</h1></div>
    <div class="actions"><select data-filter="status"><option value="">Alle statussen</option>${Object.entries(PROJ_STATUS).map(([k, v]) => `<option value="${k}" ${S.filters.status === k ? "selected" : ""}>${v}</option>`).join("")}</select>${isBeheer() ? `<button class="btn primary" data-act="new-project">+ Nieuw project</button>` : ""}</div></div>
  <div class="panel tw"><table class="t"><thead><tr><th>Klant · project</th><th>Status</th><th>Fase</th><th>Lead</th><th>Timing</th>${isBeheer() ? `<th class="r">Forfait</th>` : ""}<th class="r">Taken</th><th style="min-width:140px">Uren</th></tr></thead><tbody>
  ${ps.map(p => { const ts = tasksOf(p.id), pl = projPlanned(p.id), dn = projDone(p.id), [st, en] = projSpan(p); return `<tr class="click" data-open="${p.id}">
    <td><div class="row-title">${esc(p.klant)}<small>${esc(p.naam || "")}${p.gemeente ? " · " + esc(p.gemeente) : ""}</small></div></td>
    <td><span class="pill st-${p.status}">${PROJ_STATUS[p.status] || p.status}</span></td>
    <td><span class="pill phase">${esc(faseName(p.fase_nr) || "—")}</span></td>
    <td>${p.lead ? avatar(p.lead) : "—"}</td>
    <td class="num">${fmt(st)} → ${fmt(en)}</td>
    ${isBeheer() ? `<td class="r num">${eur(p.forfait)}</td>` : ""}
    <td class="r num">${ts.filter(t => t.status === "done").length}/${ts.length}</td>
    <td><div class="num" style="font-size:12px;margin-bottom:3px">${nl(dn)} / ${nl(pl)} u</div><div class="bar"><i class="${dn > pl && pl ? "over" : ""}" style="width:${pl ? Math.min(dn / pl, 1) * 100 : 0}%"></i></div></td></tr>`; }).join("") || `<tr><td colspan="8"><div class="empty"><b>Nog geen projecten</b>${isBeheer() ? "Maak het eerste project aan met de knop rechtsboven." : "De beheerder maakt projecten aan."}</div></td></tr>`}
  </tbody></table></div>`;
}
function vProjectDetail(p) {
  const ts = tasksOf(p.id), pl = projPlanned(p.id), dn = projDone(p.id);
  const [st, en] = projSpan(p);
  const tabs = [["taken", "Taken"], ["planning", "Planning"], ["uren", "Uren"], ["dossier", "Dossier"]];
  let body = "";
  if (S.ptab === "taken") {
    const byFase = {}; ts.forEach(t => { (byFase[t.fase_nr || 0] = byFase[t.fase_nr || 0] || []).push(t); });
    const groups = Object.keys(byFase).map(Number).sort((a, b) => a - b);
    body = `<div class="panel"><div class="panel-head"><h3>Taken</h3><div class="actions"><button class="btn sm" data-act="add-fase" data-pid="${p.id}">+ Fase toevoegen</button><button class="btn sm primary" data-act="new-task" data-pid="${p.id}">+ Taak</button></div></div>
      ${ts.length ? `<div class="tw"><table class="t"><thead><tr><th></th><th>Taak</th><th>Wie</th><th>Start</th><th>Einde</th><th class="r">Uren</th><th>Status</th></tr></thead><tbody>
      ${groups.map(nr => { const g = byFase[nr]; const done = g.filter(t => t.status === "done").length; return `<tr><td colspan="7" style="background:var(--surface-2);font-weight:700;font-family:var(--font-display)">${esc(faseName(nr) || "Zonder fase")} <span class="muted num" style="font-weight:400">${done}/${g.length}</span></td></tr>` + g.map(t => `<tr class="click" data-edit-task="${t.id}"><td style="width:28px"><input type="checkbox" class="task-check" data-toggle="${t.id}" ${t.status === "done" ? "checked" : ""} aria-label="Klaar"></td>
        <td><div class="row-title">${esc(t.titel)}${t.notitie ? `<small>${esc(t.notitie)}</small>` : ""}</div></td><td><span class="who-cell">${t.assignee ? avatar(t.assignee) : ""}${esc(userById(t.assignee).name)}</span></td>
        <td class="num">${fmt(t.start)}</td><td class="num" style="color:${isLate(t) ? "var(--crit)" : "inherit"}">${fmt(t.eind)}</td><td class="r num">${nl(taskDone(t.id))} / ${nl(t.uren_gepland)}</td><td>${pill(t)}</td></tr>`).join(""); }).join("")}</tbody></table></div>` : `<div class="empty"><b>Nog geen taken</b>Voeg een fase toe (met de standaardtaken) of maak een losse taak.</div>`}</div>`;
  } else if (S.ptab === "planning") {
    body = ganttHtml([p], { expanded: true, title: "Timing " + p.klant });
  } else if (S.ptab === "uren") {
    const byTask = ts.map(t => ({ t, d: taskDone(t.id) })).filter(x => x.d > 0 || x.t.uren_gepland > 0);
    const byUser = users().map(u => ({ u, d: hoursOf(h => h.project_id === p.id && h.user_id === u.id) })).filter(x => x.d > 0);
    const logs = Object.values(S.uren).filter(h => h.project_id === p.id).sort((a, b) => b.datum.localeCompare(a.datum)).slice(0, 30);
    const rend = isBeheer() ? (() => { const ki = projKost(p.id, "intern"), ke = projKost(p.id, "extern"), f = Number(p.forfait) || 0; return `<div class="rend">
        <div class="panel"><div class="k">Forfait</div><div class="v">${eur(p.forfait)}</div></div>
        <div class="panel"><div class="k">Interne kost</div><div class="v">${eur(ki)}</div></div>
        <div class="panel"><div class="k">Externe waarde uren</div><div class="v">${eur(ke)}</div></div>
        <div class="panel"><div class="k">Marge t.o.v. interne kost</div><div class="v ${f ? (f - ki >= 0 ? "pos" : "neg") : ""}">${f ? eur(f - ki) : "—"}</div></div></div>`; })() : "";
    body = rend + `<div class="grid two">
      <div class="panel"><div class="panel-head"><h3>Per taak</h3><button class="btn sm" data-act="log-hours" data-pid="${p.id}">+ Uren</button></div><div class="tw"><table class="t"><thead><tr><th>Taak</th><th class="r">Gepresteerd</th><th class="r">Gepland</th><th style="min-width:120px"></th></tr></thead><tbody>
        ${byTask.map(({ t, d }) => `<tr><td>${esc(t.titel)}<small class="muted" style="display:block">${esc(faseShort(t.fase_nr))}</small></td><td class="r num">${nl(d)} u</td><td class="r num">${nl(t.uren_gepland)} u</td><td><div class="bar"><i class="${d > t.uren_gepland && t.uren_gepland ? "over" : t.status === "done" ? "done" : ""}" style="width:${t.uren_gepland ? Math.min(d / t.uren_gepland, 1) * 100 : 0}%"></i></div></td></tr>`).join("") || `<tr><td class="muted" colspan="4">Nog geen uren of geplande uren.</td></tr>`}
        <tr><td><b>Totaal</b></td><td class="r num"><b>${nl(dn)} u</b></td><td class="r num"><b>${nl(pl)} u</b></td><td></td></tr></tbody></table></div></div>
      <div style="display:grid;gap:16px;align-content:start">
        <div class="panel"><div class="panel-head"><h3>Per persoon</h3></div><div class="tw"><table class="t"><tbody>${byUser.map(({ u, d }) => `<tr><td><span class="who-cell">${avatar(u.id)}${esc(u.name)}</span></td><td class="r num">${nl(d)} u</td></tr>`).join("") || `<tr><td class="muted">Nog geen uren.</td></tr>`}</tbody></table></div></div>
        <div class="panel"><div class="panel-head"><h3>Laatste registraties</h3></div><div class="tw"><table class="t"><tbody>${logs.map(h => `<tr class="click" data-edit-hours="${h.id}"><td class="num">${fmt(h.datum)}</td><td>${avatar(h.user_id)}</td><td>${esc(S.taken[h.taak_id]?.titel || "—")}${h.notitie ? `<small class="muted"> · ${esc(h.notitie)}</small>` : ""}</td><td class="r num">${nl(h.uren)} u</td></tr>`).join("") || `<tr><td class="muted">Nog geen registraties.</td></tr>`}</tbody></table></div></div>
      </div></div>`;
  } else {
    const map = p.drive_map || ("BROS-PROJECTEN-" + (p.klant || "").toUpperCase());
    body = `<div class="panel"><div class="panel-head"><h3>Dossier</h3><span class="pill st-offerte">Drive-koppeling volgt in een latere update</span></div>
      <div class="panel-body"><div class="meta">
        <div><div class="k">Drive-map</div><div class="v"><span class="drive-path">${esc(map)}</span></div></div>
        <div><div class="k">Adres werf</div><div class="v">${esc(p.adres || "—")}${p.gemeente ? ", " + esc(p.gemeente) : ""}</div></div>
        <div><div class="k">Contact</div><div class="v">${esc(p.contact || "—")}</div></div>
        <div style="grid-column:1/-1"><div class="k">Notities</div><div class="v" style="white-space:pre-wrap">${esc(p.notities || "—")}</div></div>
      </div></div></div>`;
  }
  return `
  <div class="crumb"><button data-back="1">Projecten</button><span>›</span><span>${esc(p.klant)}</span></div>
  <div class="page-head"><div><h1>${esc(projName(p))}</h1><div class="sub">${esc(p.gemeente || "")}${p.adres ? " · " + esc(p.adres) : ""}</div></div>
    <div class="actions"><span class="pill st-${p.status}">${PROJ_STATUS[p.status] || p.status}</span>${isBeheer() ? `<button class="btn" data-act="edit-project" data-pid="${p.id}">Bewerken</button>` : ""}<button class="btn" data-act="log-hours" data-pid="${p.id}">+ Uren</button><button class="btn primary" data-act="new-task" data-pid="${p.id}">+ Taak</button></div></div>
  <div class="panel" style="margin-bottom:16px"><div class="panel-body meta">
    <div><div class="k">Fase</div><div class="v">${esc(faseName(p.fase_nr) || "—")}</div></div>
    <div><div class="k">Lead</div><div class="v"><span class="who-cell">${p.lead ? avatar(p.lead) : ""}${esc(userById(p.lead).name)}</span></div></div>
    <div><div class="k">Timing</div><div class="v num">${fmtLong(st)} → ${fmtLong(en)}</div></div>
    ${isBeheer() ? `<div><div class="k">Forfait</div><div class="v num">${eur(p.forfait)}</div></div>` : ""}
    <div><div class="k">Uren</div><div class="v num">${nl(dn)} / ${nl(pl)} u</div></div>
    <div><div class="k">Taken</div><div class="v num">${ts.filter(t => t.status === "done").length} / ${ts.length} klaar</div></div>
  </div></div>
  <div class="subtabs">${tabs.map(([k, l]) => `<button data-ptab="${k}" aria-current="${S.ptab === k}">${l}</button>`).join("")}</div>
  ${body}`;
}

/* ---------- Taken ---------- */
function vTaken() {
  const f = S.filters;
  let ts = Object.values(S.taken);
  if (f.user) ts = ts.filter(t => t.assignee === f.user);
  if (f.project) ts = ts.filter(t => t.project_id === f.project);
  if (f.status === "late") ts = ts.filter(isLate); else if (f.status) ts = ts.filter(t => t.status === f.status); else ts = ts.filter(t => t.status !== "done");
  if (f.q) ts = ts.filter(t => (t.titel + " " + (S.projecten[t.project_id]?.klant || "")).toLowerCase().includes(f.q.toLowerCase()));
  ts.sort((a, b) => (a.eind || "9").localeCompare(b.eind || "9") || (a.volgorde ?? 0) - (b.volgorde ?? 0));
  return `
  <div class="page-head"><div><div class="eyebrow">${ts.length} taken</div><h1>Taken</h1></div><div class="actions"><button class="btn primary" data-act="new-task">+ Nieuwe taak</button></div></div>
  <div class="filters">
    <input type="search" placeholder="Zoeken…" value="${esc(f.q)}" data-filter="q" aria-label="Zoeken">
    <select data-filter="project"><option value="">Alle projecten</option>${projects().map(p => `<option value="${p.id}" ${f.project === p.id ? "selected" : ""}>${esc(p.klant)}</option>`).join("")}</select>
    <select data-filter="user"><option value="">Iedereen</option>${users().map(u => `<option value="${u.id}" ${f.user === u.id ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select>
    <select data-filter="status"><option value="">Open</option><option value="late" ${f.status === "late" ? "selected" : ""}>Te laat</option>${Object.entries(TASK_STATUS).map(([k, v]) => `<option value="${k}" ${f.status === k ? "selected" : ""}>${v}</option>`).join("")}</select>
  </div>
  <div class="panel">${ts.length ? `<div class="tw"><table class="t"><thead><tr><th></th><th>Taak</th><th>Project</th><th>Wie</th><th>Start</th><th>Einde</th><th class="r">Uren</th><th>Status</th></tr></thead><tbody>
    ${ts.map(t => `<tr class="click" data-edit-task="${t.id}"><td style="width:28px"><input type="checkbox" class="task-check" data-toggle="${t.id}" ${t.status === "done" ? "checked" : ""} aria-label="Klaar"></td>
      <td><div class="row-title">${esc(t.titel)}<small>${esc(faseName(t.fase_nr))}</small></div></td><td>${esc(S.projecten[t.project_id]?.klant || "—")}</td><td>${t.assignee ? avatar(t.assignee) : "—"}</td>
      <td class="num">${fmt(t.start)}</td><td class="num" style="color:${isLate(t) ? "var(--crit)" : "inherit"}">${fmt(t.eind)}</td><td class="r num">${nl(taskDone(t.id))} / ${nl(t.uren_gepland)}</td><td>${pill(t)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><b>Geen taken gevonden</b>Pas de filters aan of maak een nieuwe taak.</div>`}</div>`;
}

/* ---------- Planning (Gantt) ---------- */
function vPlanning() {
  const ps = projects().filter(p => p.status !== "afgerond" && (!S.filters.project || p.id === S.filters.project));
  return `
  <div class="page-head"><div><div class="eyebrow">${ps.length} projecten · ${Object.values(S.taken).filter(t => ps.some(p => p.id === t.project_id) && t.status !== "done").length} open taken</div><h1>Planning</h1></div>
    <div class="actions"><select data-filter="project"><option value="">Alle projecten</option>${projects().map(p => `<option value="${p.id}" ${S.filters.project === p.id ? "selected" : ""}>${esc(p.klant)}</option>`).join("")}</select><button class="btn primary" data-act="new-task">+ Taak</button></div></div>
  ${ganttHtml(ps, { title: "Timing van alle projecten" })}`;
}
function ganttHtml(ps, opt = {}) {
  const dw = opt.compact ? 9 : 14;
  const start = S.ganttStart, days = S.ganttDays, end = addDays(start, days - 1);
  const x = (d) => Math.max(0, Math.min(days, diffDays(start, d))) * dw;
  let months = "", weeks = "", grid = "";
  let cur = start;
  while (cur <= end) {
    const d = pd(cur);
    if (d.getUTCDate() === 1 || cur === start) {
      const mEnd = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
      const w = (Math.min(diffDays(cur, mEnd) + 1, diffDays(cur, end) + 1)) * dw;
      if (w >= 60) months += `<div class="m" style="left:${x(cur)}px;width:${w}px">${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}</div>`;
    }
    if (d.getUTCDay() === 1) { weeks += `<div class="w" style="left:${x(cur)}px;width:${7 * dw}px">wk ${weekNr(cur)}${opt.compact ? "" : " · " + fmt(cur)}</div>`; grid += `<div class="wk" style="left:${x(cur)}px"></div>`; }
    if (d.getUTCDay() === 6) grid += `<div class="we" style="left:${x(cur)}px;width:${2 * dw}px"></div>`;
    cur = addDays(cur, 1);
  }
  if (todayIso >= start && todayIso <= end) grid += `<div class="today" style="left:${x(todayIso) + dw / 2}px"></div>`;
  const rows = [];
  ps.forEach(p => {
    const ts = tasksOf(p.id), open = opt.expanded || (S.ganttOpen[p.id] !== false && !opt.compact);
    const [st, en] = projSpan(p); const pl = projPlanned(p.id), dn = projDone(p.id);
    const pct = ts.length ? ts.filter(t => t.status === "done").length / ts.length * 100 : 0;
    const label = opt.compact
      ? `<div class="g-row group" data-open="${p.id}"><span class="t">${esc(p.klant)}</span><span class="h">${nl(dn)}/${nl(pl)}u</span></div>`
      : `<div class="g-row group" data-gtoggle="${p.id}"><span class="caret">${opt.expanded ? "" : (open ? "▾" : "▸")}</span><span class="t">${esc(p.klant)}</span><span class="h">${ts.length} taken · ${nl(dn)}/${nl(pl)}u</span></div>`;
    const bar = st && en ? `<div class="g-bar" data-open="${p.id}" style="left:${x(st)}px;width:${Math.max(x(addDays(en, 1)) - x(st), 4)}px"><div class="p" style="width:${pct}%"></div><span>${esc(p.naam || p.klant)}${p.fase_nr ? " · " + esc(faseShort(p.fase_nr)) : ""}</span></div>` : `<div class="g-empty">Nog geen timing</div>`;
    rows.push({ label, body: `<div class="g-row group">${bar}</div>` });
    if (open) ts.filter(t => !opt.expanded ? t.status !== "done" || (t.eind && t.eind >= start) : true).forEach(t => {
      const u = userById(t.assignee), done = taskDone(t.id), pct = t.uren_gepland ? Math.min(done / t.uren_gepland, 1) * 100 : 0;
      const l = `<div class="g-row" data-edit-task="${t.id}" style="cursor:pointer">${t.assignee ? avatar(t.assignee) : `<span class="avatar" style="background:var(--line-2)">?</span>`}<span class="t">${esc(t.titel)}</span><span class="h">${t.start ? fmt(t.start) + "–" + fmt(t.eind) : ""}</span></div>`;
      const inRange = t.start && t.eind && t.eind >= start && t.start <= end;
      const b = inRange ? `<div class="g-bar ${t.status} ${isLate(t) ? "late" : ""}" data-edit-task="${t.id}" style="left:${x(t.start)}px;width:${Math.max(x(addDays(t.eind, 1)) - x(t.start), 6)}px;background:${t.assignee ? u.color : "#8a8f8b"}" title="${esc(t.titel)} · ${esc(u.name)} · ${nl(done)}/${nl(t.uren_gepland)}u"><div class="p" style="width:${pct}%"></div><span>${esc(t.titel)}</span></div>` : `<div class="g-empty">${t.start ? "buiten venster" : "geen datum — klik om in te plannen"}</div>`;
      rows.push({ label: l, body: `<div class="g-row">${b}</div>` });
    });
  });
  return `<div class="gantt">
    <div class="gantt-tools"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h3>${esc(opt.title || "Timing")}</h3><span class="week-nav"><button class="btn sm" data-gnav="-28" aria-label="4 weken terug">‹</button><button class="btn sm" data-gnav="today">Vandaag</button><button class="btn sm" data-gnav="28" aria-label="4 weken verder">›</button></span></div>
      <div class="legend">${users().map(u => `<span><i style="background:${u.color}"></i>${esc(u.name)}</span>`).join("")}<span><i style="background:var(--today)"></i>vandaag</span></div></div>
    <div class="gantt-scroll"><div class="gantt-in">
      <div class="g-label"><div class="g-head" style="display:flex;align-items:center;padding:0 12px"><span class="eyebrow">${fmt(start)} → ${fmt(end)}</span></div>${rows.map(r => r.label).join("")}</div>
      <div><div class="g-head" style="width:${days * dw}px">${months}${weeks}</div>
        <div class="g-body" style="width:${days * dw}px"><div class="g-grid">${grid}</div>${rows.map(r => r.body).join("")}${rows.length ? "" : `<div class="g-row"><div class="g-empty">Geen projecten om te tonen.</div></div>`}</div></div>
    </div></div></div>`;
}

/* ---------- Uren ---------- */
function vUren() {
  const u = S.hoursUser || S.me.id, ws = S.weekStart, we = addDays(ws, 6);
  const entries = Object.values(S.uren).filter(h => h.user_id === u && h.datum >= ws && h.datum <= we).sort((a, b) => a.datum.localeCompare(b.datum));
  const perDay = Array.from({ length: 7 }, (_, i) => { const d = addDays(ws, i); return { d, sum: entries.filter(h => h.datum === d).reduce((s, h) => s + Number(h.uren || 0), 0) }; });
  const tot = perDay.reduce((s, x) => s + x.sum, 0);
  const perProj = projects().map(p => ({ p, d: entries.filter(h => h.project_id === p.id).reduce((s, h) => s + Number(h.uren || 0), 0) })).filter(x => x.d > 0);
  const allTot = users().map(x => ({ u: x, d: hoursOf(h => h.user_id === x.id && h.datum >= ws && h.datum <= we) }));
  return `
  <div class="page-head"><div><div class="eyebrow">Urenregistratie</div><h1>Uren</h1></div>
    <div class="actions"><select data-hours-user>${users().map(x => `<option value="${x.id}" ${x.id === u ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
      <span class="week-nav"><button class="btn sm" data-wnav="-7" aria-label="Vorige week">‹</button><span class="lbl">wk ${weekNr(ws)} · ${fmt(ws)} – ${fmt(we)}</span><button class="btn sm" data-wnav="7" aria-label="Volgende week">›</button></span>
      <button class="btn" data-act="export-hours" title="Alle uren als CSV (opent in Excel)">Exporteren</button>
      <button class="btn primary" data-act="log-hours">+ Uren registreren</button></div></div>
  <div class="hour-grid" style="margin-bottom:16px">${perDay.map(x => `<div class="day ${x.d === todayIso ? "today" : ""}"><div class="dn">${DAYS[(pd(x.d).getUTCDay() + 6) % 7]} ${fmt(x.d)}</div><div class="dh">${nl(x.sum)}<small> u</small></div></div>`).join("")}
    <div class="day" style="background:var(--surface-2)"><div class="dn">Week</div><div class="dh">${nl(tot)}<small> u</small></div></div></div>
  <div class="grid two">
    <div class="panel"><div class="panel-head"><h3>Registraties · ${esc(userById(u).name)}</h3></div>
      ${entries.length ? `<div class="tw"><table class="t"><thead><tr><th>Datum</th><th>Project</th><th>Taak</th><th>Notitie</th><th class="r">Uren</th></tr></thead><tbody>
      ${entries.map(h => `<tr class="click" data-edit-hours="${h.id}"><td class="num">${DAYS[(pd(h.datum).getUTCDay() + 6) % 7]} ${fmt(h.datum)}</td><td>${esc(S.projecten[h.project_id]?.klant || "—")}</td><td>${esc(S.taken[h.taak_id]?.titel || "—")}</td><td class="muted">${esc(h.notitie || "")}</td><td class="r num">${nl(h.uren)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><b>Geen uren deze week</b>Registreer uren met de knop rechtsboven.</div>`}</div>
    <div style="display:grid;gap:16px;align-content:start">
      <div class="panel"><div class="panel-head"><h3>Per project deze week</h3></div><div class="tw"><table class="t"><tbody>${perProj.map(x => `<tr><td>${esc(projName(x.p))}</td><td class="r num">${nl(x.d)} u</td></tr>`).join("") || `<tr><td class="muted">—</td></tr>`}</tbody></table></div></div>
      <div class="panel"><div class="panel-head"><h3>Team deze week</h3></div><div class="tw"><table class="t"><tbody>${allTot.map(x => `<tr><td><span class="who-cell">${avatar(x.u.id)}${esc(x.u.name)}</span></td><td class="r num">${nl(x.d)} u</td></tr>`).join("")}</tbody></table></div></div>
    </div></div>`;
}
function exportHours() {
  const rows = Object.values(S.uren).sort((a, b) => a.datum.localeCompare(b.datum));
  const head = ["Datum", "Week", "Medewerker", "Klant", "Project", "Fase", "Taak", "Uren", "Notitie"];
  const lines = [head.join(";")].concat(rows.map(h => { const p = S.projecten[h.project_id] || {}, t = S.taken[h.taak_id] || {}; return [fmtLong(h.datum), weekNr(h.datum), userById(h.user_id).name, p.klant || "", p.naam || "", faseShort(t.fase_nr), t.titel || "", String(h.uren).replace(".", ","), (h.notitie || "").replace(/[;\r\n]/g, " ")].map(v => `"${String(v).replace(/"/g, '""')}"`).join(";"); }));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `bros-uren-${todayIso}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

/* ---------- Team ---------- */
function vTeam() {
  const wk = Array.from({ length: 4 }, (_, i) => addDays(mondayOf(todayIso), i * 7));
  const load = (uid, ws) => { const we = addDays(ws, 6); return Object.values(S.taken).filter(t => t.assignee === uid && t.status !== "done" && t.start && t.eind && t.eind >= ws && t.start <= we).reduce((s, t) => { const a = t.start > ws ? t.start : ws, b = t.eind < we ? t.eind : we; return s + (Number(t.uren_gepland) || 0) * workdays(a, b) / workdays(t.start, t.eind); }, 0); };
  const all = Object.values(S.profiles).sort((a, b) => (a.active === false) - (b.active === false) || a.name.localeCompare(b.name));
  return `
  <div class="page-head"><div><div class="eyebrow">${users().length} medewerkers</div><h1>Team</h1></div>${isBeheer() ? `<div class="actions"><span class="muted" style="font-size:13px">Nieuwe medewerkers nodig je uit via Supabase (Authentication → Users → Invite); daarna verschijnen ze hier.</span></div>` : ""}</div>
  <div class="panel tw"><table class="t"><thead><tr><th>Naam</th><th>Rol</th><th class="r">Open taken</th><th class="r">Uren dit jaar</th>${wk.map(w => `<th class="r">wk ${weekNr(w)}</th>`).join("")}${isBeheer() ? `<th class="r">Tarief int / ext</th>` : ""}<th></th></tr></thead><tbody>
  ${all.map(u => `<tr style="${u.active === false ? "opacity:.5" : ""}"><td><span class="who-cell">${avatar(u.id)}<b>${esc(u.name)}</b>${u.id === S.me.id ? `<span class="muted" style="font-size:12px">(ik)</span>` : ""}</span><small class="muted" style="display:block">${esc(u.email || "")}</small></td><td class="muted">${u.role === "beheer" ? "Beheer" : "Medewerker"}${u.active === false ? " · inactief" : ""}</td>
    <td class="r num">${Object.values(S.taken).filter(t => t.assignee === u.id && t.status !== "done").length}</td>
    <td class="r num">${nl(hoursOf(h => h.user_id === u.id && h.datum.slice(0, 4) === todayIso.slice(0, 4)))} u</td>
    ${wk.map(w => { const l = load(u.id, w); return `<td class="r num" style="color:${l > 40 ? "var(--crit)" : l > 32 ? "var(--warn)" : "inherit"}">${nl(l, 0)} u</td>`; }).join("")}
    ${isBeheer() ? `<td class="r num">${S.tarieven[u.id] ? `${nl(S.tarieven[u.id].intern, 0)} / ${nl(S.tarieven[u.id].extern, 0)}` : "—"}</td>` : ""}
    <td class="r">${(isBeheer() || u.id === S.me.id) ? `<button class="btn ghost sm" data-act="edit-user" data-uid="${u.id}">Bewerken</button>` : ""}</td></tr>`).join("")}</tbody></table>
  <div class="panel-body muted" style="font-size:12px;border-top:1px solid var(--line)">Geplande uren per week = geplande uren van open taken, verdeeld over de werkdagen van de taak. Oranje vanaf 32 u, rood boven 40 u.</div></div>`;
}

/* ---------- modals ---------- */
function openModal(title, bodyHtml, { onSave, onDelete, saveLabel = "Bewaren", wide } = {}) {
  $("#modal").innerHTML = `<div class="mh"><h2>${esc(title)}</h2><button class="btn ghost sm" data-close type="button">✕</button></div><form id="mform"><div class="mb">${bodyHtml}</div>
    <div class="mf"><div>${onDelete ? `<button type="button" class="btn ghost danger" data-mdelete>Verwijderen</button>` : ""}</div><div style="display:flex;gap:8px"><button type="button" class="btn" data-close>Annuleren</button><button type="submit" class="btn primary">${saveLabel}</button></div></div></form>`;
  $("#modal").style.width = wide ? "min(820px, 100%)" : "";
  $("#modalBg").classList.add("show");
  const form = $("#mform");
  form.onsubmit = async (e) => { e.preventDefault(); const btn = form.querySelector('button[type=submit]'); btn.disabled = true; try { const d = Object.fromEntries(new FormData(form).entries()); d._fasen = [...form.querySelectorAll('input[name="fase"]:checked')].map(i => Number(i.value)); const ok = await onSave(d); if (ok !== false) closeModal(); } catch (err) { } btn.disabled = false; };
  if (onDelete) $("[data-mdelete]").onclick = async () => { if (confirm("Zeker verwijderen?")) { try { await onDelete(); closeModal(); } catch (e) { } } };
  setTimeout(() => form.querySelector("input:not([type=checkbox]),select,textarea")?.focus(), 30);
}
function closeModal() { $("#modalBg").classList.remove("show"); }
const opts = (arr, sel) => arr.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel) ? "selected" : ""}>${esc(l)}</option>`).join("");
const userOpts = (sel, allowEmpty) => (allowEmpty ? `<option value="">— niemand —</option>` : "") + opts(users().map(u => [u.id, u.name]), sel);
const projOpts = (sel) => opts(projects().map(p => [p.id, projName(p)]), sel);
const faseOpts = (sel, allowEmpty) => (allowEmpty ? `<option value="">— geen fase —</option>` : "") + opts(fasenList().map(f => [f.nr, `${f.nr} · ${f.naam}`]), sel);

function projectForm(p = {}) {
  const isNew = !p.id;
  openModal(isNew ? "Nieuw project" : "Project bewerken", `<div class="form-grid">
    <div class="field"><label for="f_klant">Klant (naam van de projectmap)</label><input id="f_klant" name="klant" required value="${esc(p.klant || "")}" placeholder="bv. Familie Janssens"></div>
    <div class="field"><label for="f_naam">Projectnaam</label><input id="f_naam" name="naam" value="${esc(p.naam || "")}" placeholder="bv. Renovatie gelijkvloers"></div>
    <div class="field"><label for="f_adres">Adres werf</label><input id="f_adres" name="adres" value="${esc(p.adres || "")}"></div>
    <div class="field"><label for="f_gem">Gemeente</label><input id="f_gem" name="gemeente" value="${esc(p.gemeente || "")}"></div>
    <div class="field"><label for="f_contact">Contact (naam · tel · mail)</label><input id="f_contact" name="contact" value="${esc(p.contact || "")}"></div>
    <div class="field"><label for="f_lead">Projectlead</label><select id="f_lead" name="lead">${userOpts(p.lead || S.me.id)}</select></div>
    <div class="field"><label for="f_status">Status</label><select id="f_status" name="status">${opts(Object.entries(PROJ_STATUS), p.status || "offerte")}</select></div>
    <div class="field"><label for="f_fase">Huidige fase</label><select id="f_fase" name="fase_nr">${faseOpts(p.fase_nr || 1, true)}</select></div>
    <div class="field"><label for="f_start">Start</label><input id="f_start" type="date" name="start" value="${esc(p.start || todayIso)}"></div>
    <div class="field"><label for="f_eind">Geplande oplevering</label><input id="f_eind" type="date" name="eind" value="${esc(p.eind || "")}"></div>
    <div class="field"><label for="f_forfait">Forfait (€, excl. btw)</label><input id="f_forfait" type="number" step="1" name="forfait" value="${esc(p.forfait ?? "")}"></div>
    <div class="field"><label for="f_map">Drive-map</label><input id="f_map" name="drive_map" value="${esc(p.drive_map || "")}" placeholder="BROS-PROJECTEN-… (automatisch)"></div>
    <div class="field span2"><label for="f_not">Notities</label><textarea id="f_not" name="notities">${esc(p.notities || "")}</textarea></div>
    ${isNew ? `<div class="field span2"><label>Fasen voor dit project <span class="muted" style="font-weight:400">— vink uit wat niet van toepassing is; elke fase brengt zijn standaardtaken mee</span></label>
      <div class="fase-list">${fasenList().map(f => `<label><input type="checkbox" name="fase" value="${f.nr}" checked><span class="n">${f.nr}</span><span class="nm">${esc(f.naam)}</span><span class="c">${S.standaardtaken.filter(t => t.fase_nr === f.nr).length} taken</span></label>`).join("")}</div></div>` : ""}
  </div>`, {
    wide: isNew,
    onSave: async (d) => {
      const row = { klant: d.klant.trim(), naam: d.naam.trim(), adres: d.adres, gemeente: d.gemeente, contact: d.contact, lead: d.lead || null, status: d.status, fase_nr: d.fase_nr ? Number(d.fase_nr) : null, start: d.start || null, eind: d.eind || null, forfait: d.forfait === "" ? null : Number(d.forfait), drive_map: d.drive_map || ("BROS-PROJECTEN-" + d.klant.trim().toUpperCase()), notities: d.notities };
      if (isNew) {
        row.created_by = S.me.id;
        const created = await dbInsert("projecten", row);
        const tasks = S.standaardtaken.filter(t => d._fasen.includes(t.fase_nr)).map(t => ({ project_id: created.id, titel: t.titel, fase_nr: t.fase_nr, assignee: row.lead, volgorde: t.fase_nr * 100 + t.volgorde, status: "todo", uren_gepland: 0 }));
        if (tasks.length) { const { data, error } = await sb.from("taken").insert(tasks).select(); if (error) toast("Standaardtaken niet aangemaakt: " + error.message); else (data || []).forEach(t => S.taken[t.id] = t); }
        toast(`Project aangemaakt met ${tasks.length} standaardtaken`);
        S.view = "projecten"; S.project = created.id; S.ptab = "taken"; render();
      } else { await dbUpdate("projecten", p.id, row); toast("Project bewaard"); }
    },
    onDelete: isNew ? null : async () => { await dbDelete("projecten", p.id); Object.values(S.taken).filter(t => t.project_id === p.id).forEach(t => delete S.taken[t.id]); Object.values(S.uren).filter(h => h.project_id === p.id).forEach(h => delete S.uren[h.id]); S.project = null; render(); toast("Project verwijderd"); },
  });
}
function addFaseForm(pid) {
  const p = S.projecten[pid]; const present = new Set(tasksOf(pid).map(t => t.fase_nr));
  openModal("Fase toevoegen aan " + p.klant, `<div class="field"><label for="af_fase">Fase</label><select id="af_fase" name="fase_nr">${opts(fasenList().map(f => [f.nr, `${f.nr} · ${f.naam}${present.has(f.nr) ? " (al aanwezig)" : ""} — ${S.standaardtaken.filter(t => t.fase_nr === f.nr).length} taken`]), fasenList().find(f => !present.has(f.nr))?.nr)}</select></div>
    <p class="muted" style="font-size:13px;margin:10px 0 0">De standaardtaken van deze fase worden toegevoegd, toegewezen aan de projectlead en zonder datum.</p>`, {
    saveLabel: "Toevoegen",
    onSave: async (d) => {
      const nr = Number(d.fase_nr);
      const tasks = S.standaardtaken.filter(t => t.fase_nr === nr).map(t => ({ project_id: pid, titel: t.titel, fase_nr: nr, assignee: p.lead, volgorde: nr * 100 + t.volgorde, status: "todo", uren_gepland: 0 }));
      const { data, error } = await sb.from("taken").insert(tasks).select();
      if (error) { toast("Mislukt: " + error.message); return false; }
      (data || []).forEach(t => S.taken[t.id] = t); render(); toast(`${tasks.length} taken toegevoegd`);
    },
  });
}
function taskForm(t = {}, pid) {
  const isNew = !t.id;
  const projectId = t.project_id || pid || S.project || projects()[0]?.id;
  if (!projectId) { toast("Maak eerst een project aan."); return; }
  openModal(isNew ? "Nieuwe taak" : "Taak bewerken", `<div class="form-grid">
    <div class="field span2"><label for="t_titel">Taak</label><input id="t_titel" name="titel" required value="${esc(t.titel || "")}" placeholder="bv. Meetstaat opmaken"></div>
    <div class="field"><label for="t_proj">Project</label><select id="t_proj" name="project_id">${projOpts(projectId)}</select></div>
    <div class="field"><label for="t_fase">Fase</label><select id="t_fase" name="fase_nr">${faseOpts(t.fase_nr ?? S.projecten[projectId]?.fase_nr ?? "", true)}</select></div>
    <div class="field"><label for="t_who">Toegewezen aan</label><select id="t_who" name="assignee">${userOpts(t.assignee ?? S.me.id, true)}</select></div>
    <div class="field"><label for="t_status">Status</label><select id="t_status" name="status">${opts(Object.entries(TASK_STATUS), t.status || "todo")}</select></div>
    <div class="field"><label for="t_start">Start</label><input id="t_start" type="date" name="start" value="${esc(t.start || "")}"></div>
    <div class="field"><label for="t_eind">Einde</label><input id="t_eind" type="date" name="eind" value="${esc(t.eind || "")}"></div>
    <div class="field"><label for="t_uren">Geplande uren</label><input id="t_uren" type="number" step="0.5" min="0" name="uren_gepland" value="${esc(t.uren_gepland ?? 0)}"></div>
    <div class="field"><label for="t_not">Notitie</label><input id="t_not" name="notitie" value="${esc(t.notitie || "")}"></div>
  </div>`, {
    onSave: async (d) => {
      const row = { titel: d.titel.trim(), project_id: d.project_id, fase_nr: d.fase_nr ? Number(d.fase_nr) : null, assignee: d.assignee || null, status: d.status, start: d.start || null, eind: d.eind || null, uren_gepland: Number(d.uren_gepland) || 0, notitie: d.notitie };
      if (row.start && !row.eind) row.eind = row.start; if (row.eind && !row.start) row.start = row.eind; if (row.eind < row.start) row.eind = row.start;
      if (isNew) { row.volgorde = (row.fase_nr || 99) * 100 + 90; await dbInsert("taken", row); toast("Taak aangemaakt"); }
      else { await dbUpdate("taken", t.id, row); toast("Taak bewaard"); }
    },
    onDelete: isNew ? null : async () => { await dbDelete("taken", t.id); toast("Taak verwijderd"); },
  });
}
function hoursForm(h = {}, pid) {
  const isNew = !h.id;
  const projectId = h.project_id || pid || S.project || projects()[0]?.id;
  if (!projectId) { toast("Maak eerst een project aan."); return; }
  const taskOptsFor = (p, sel) => { const ts = tasksOf(p).filter(t => t.status !== "done" || t.id === sel); return `<option value="">— algemeen (geen taak) —</option>` + opts(ts.map(t => [t.id, (t.fase_nr ? t.fase_nr + " · " : "") + t.titel]), sel); };
  openModal(isNew ? "Uren registreren" : "Registratie bewerken", `<div class="form-grid">
    <div class="field"><label for="h_who">Wie</label><select id="h_who" name="user_id" ${isBeheer() ? "" : "disabled"}>${userOpts(h.user_id || S.me.id)}</select></div>
    <div class="field"><label for="h_datum">Datum</label><input id="h_datum" type="date" name="datum" required value="${esc(h.datum || todayIso)}"></div>
    <div class="field"><label for="h_proj">Project</label><select id="h_proj" name="project_id">${projOpts(projectId)}</select></div>
    <div class="field"><label for="h_task">Taak</label><select id="h_task" name="taak_id">${taskOptsFor(projectId, h.taak_id)}</select></div>
    <div class="field"><label for="h_uren">Uren</label><input id="h_uren" type="number" step="0.25" min="0.25" name="uren" required value="${esc(h.uren ?? 1)}"></div>
    <div class="field"><label for="h_not">Notitie</label><input id="h_not" name="notitie" value="${esc(h.notitie || "")}" placeholder="wat heb je gedaan?"></div>
  </div>`, {
    onSave: async (d) => {
      const row = { user_id: isBeheer() ? d.user_id : (h.user_id || S.me.id), datum: d.datum, project_id: d.project_id, taak_id: d.taak_id || null, uren: Number(d.uren) || 0, notitie: d.notitie };
      if (isNew) await dbInsert("uren", row); else await dbUpdate("uren", h.id, row);
      toast(`${nl(row.uren)} u geregistreerd`);
    },
    onDelete: isNew ? null : async () => { await dbDelete("uren", h.id); toast("Registratie verwijderd"); },
  });
  $("#h_proj").onchange = (e) => { $("#h_task").innerHTML = taskOptsFor(e.target.value); };
}
function userForm(u) {
  const self = u.id === S.me.id, tar = S.tarieven[u.id] || {};
  openModal(self ? "Mijn profiel" : "Medewerker bewerken", `<div class="form-grid">
    <div class="field"><label for="u_name">Naam</label><input id="u_name" name="name" required value="${esc(u.name || "")}"></div>
    <div class="field"><label for="u_ini">Initialen</label><input id="u_ini" name="initials" maxlength="3" value="${esc(u.initials || "")}"></div>
    <div class="field"><label for="u_color">Kleur</label><select id="u_color" name="color">${opts(PALETTE.map((c, i) => [c, "Kleur " + (i + 1)]), u.color)}</select></div>
    ${isBeheer() ? `<div class="field"><label for="u_role">Rol</label><select id="u_role" name="role">${opts([["medewerker", "Medewerker"], ["beheer", "Beheer"]], u.role)}</select></div>
    <div class="field"><label for="u_active">Actief</label><select id="u_active" name="active"><option value="1" ${u.active !== false ? "selected" : ""}>Ja</option><option value="0" ${u.active === false ? "selected" : ""}>Nee (verbergen)</option></select></div>
    <div class="field"><label for="u_ti">Uurtarief intern (€)</label><input id="u_ti" type="number" step="1" name="intern" value="${esc(tar.intern ?? 0)}"></div>
    <div class="field"><label for="u_te">Uurtarief extern (€)</label><input id="u_te" type="number" step="1" name="extern" value="${esc(tar.extern ?? 0)}"></div>` : ""}
  </div>`, {
    onSave: async (d) => {
      const patch = { name: d.name.trim(), initials: (d.initials || d.name.slice(0, 2)).toUpperCase(), color: d.color };
      if (isBeheer()) { patch.role = d.role; patch.active = d.active === "1"; }
      await dbUpdate("profiles", u.id, patch);
      if (isBeheer()) await dbUpsert("tarieven", { user_id: u.id, intern: Number(d.intern) || 0, extern: Number(d.extern) || 0 });
      toast("Profiel bewaard");
    },
  });
}

/* ---------- events ---------- */
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-nav],[data-act],[data-open],[data-back],[data-ptab],[data-edit-task],[data-edit-hours],[data-gnav],[data-wnav],[data-gtoggle],[data-close]");
  if (!el) { if (e.target === $("#modalBg")) closeModal(); return; }
  if (e.target.matches(".task-check")) return;
  const d = el.dataset;
  if (d.close != null) return closeModal();
  if (d.nav) { S.view = d.nav; S.project = null; if (d.nav === "planning") S.filters.project = ""; return render(); }
  if (d.open) { S.view = "projecten"; S.project = d.open; S.ptab = S.ptab || "taken"; return render(); }
  if (d.back) { S.project = null; return render(); }
  if (d.ptab) { S.ptab = d.ptab; return render(); }
  if (d.gtoggle) { S.ganttOpen[d.gtoggle] = S.ganttOpen[d.gtoggle] === false; return render(); }
  if (d.gnav) { S.ganttStart = d.gnav === "today" ? addDays(mondayOf(todayIso), -14) : addDays(S.ganttStart, Number(d.gnav)); return render(); }
  if (d.wnav) { S.weekStart = addDays(S.weekStart, Number(d.wnav)); return render(); }
  if (d.editTask) { e.stopPropagation(); return taskForm(S.taken[d.editTask]); }
  if (d.editHours) { const h = S.uren[d.editHours]; if (h && (isBeheer() || h.user_id === S.me.id)) return hoursForm(h); return toast("Alleen je eigen uren kun je bewerken."); }
  if (d.act === "new-project") return projectForm();
  if (d.act === "edit-project") return projectForm(S.projecten[d.pid]);
  if (d.act === "add-fase") return addFaseForm(d.pid);
  if (d.act === "new-task") return taskForm({}, d.pid);
  if (d.act === "log-hours") return hoursForm({}, d.pid);
  if (d.act === "edit-user") return userForm(S.profiles[d.uid]);
  if (d.act === "export-hours") return exportHours();
  if (d.act === "logout") return sb.auth.signOut().then(() => location.reload());
  if (d.act === "reload") return location.reload();
  if (d.act === "update-later") { updateAvailable = false; $("#updateBar")?.classList.remove("show"); }
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset.filter) { S.filters[el.dataset.filter] = el.value; return render(); }
  if (el.dataset.hoursUser != null) { S.hoursUser = el.value; return render(); }
  if (el.dataset.toggle) { const t = S.taken[el.dataset.toggle]; if (t) dbUpdate("taken", t.id, { status: el.checked ? "done" : "todo" }).catch(() => { }); }
});
document.addEventListener("input", (e) => { if (e.target.dataset.filter === "q") { S.filters.q = e.target.value; render(); const i = $("[data-filter=q]"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

/* ---------- versiecontrole: melden als er een nieuwe versie online staat ---------- */
let updateAvailable = false;
async function checkVersion() {
  try { const r = await fetch("version.json?t=" + Date.now(), { cache: "no-store" }); const j = await r.json(); if (j.version && j.version !== APP_VERSION && !updateAvailable) { updateAvailable = true; $("#updateBar")?.classList.add("show"); } } catch (e) { }
}

/* ---------- start ---------- */
async function boot() {
  render();
  if (!configured) return;
  const { data: { session } } = await sb.auth.getSession();
  S.session = session; render();
  sb.auth.onAuthStateChange((_evt, sess) => { const had = !!S.session; S.session = sess; if (sess && !had) start(); if (!sess) { S.ready = false; render(); } });
  if (session) start();
}
async function start() {
  try { await loadAll(); S.ready = true; S.loadError = null; render(); subscribe(); setInterval(checkVersion, 5 * 60 * 1000); setTimeout(checkVersion, 20000); }
  catch (e) { S.loadError = e.message || String(e); render(); }
}
boot();
