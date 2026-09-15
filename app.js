/* =====================================================================
   BROS Planbord — app v1.0
   Statische webapp op Supabase (login, live-synchronisatie, rechten)
   ===================================================================== */
const APP_VERSION = "1.7.0";
const PROJ_STATUS = { offerte: "In offerte", lopend: "Lopend", on_hold: "On hold", afgerond: "Afgerond", verloren: "Verloren" };
const KLANTTYPE = { particulier: "Particulier", zakelijk: "Zakelijk" };
const KLANTCODE = { particulier: "PAR", zakelijk: "ZAK" };
const PROJECTTYPES = ["Renovatie", "Nieuwbouw", "Interieur", "Maatwerk", "Advies", "Andere"];
const BRONNEN = ["Website", "Doorverwijzing", "Sociale media", "Bestaande klant", "Architect", "Aannemer", "Andere"];
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
  profiles: {}, tarieven: {}, fasen: {}, standaardtaken: [], projecten: {}, taken: {}, uren: {}, documenten: {}, instellingen: {}, loten: {}, posten: {}, meetstaat_posten: {}, vorderingen: {}, vordering_regels: {},
  view: "overzicht", project: null, ptab: "taken",
  filters: { user: "", status: "", project: "", q: "" },
  ganttStart: addDays(mondayOf(todayIso), -14), ganttDays: 112, ganttOpen: {},
  weekStart: mondayOf(todayIso), hoursUser: null, sort: { key: "nummer", dir: "desc" },
  ready: false, loadError: null,
};
const cfg = window.PLANBORD_CONFIG || {};
const configured = cfg.supabaseUrl && !cfg.supabaseUrl.includes("VUL-IN") && cfg.supabaseAnonKey && cfg.supabaseAnonKey !== "VUL-IN";
const sb = configured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;

/* ---------- helpers ---------- */
const isBeheer = () => S.me?.role === "beheer";
const users = () => Object.values(S.profiles).filter(u => u.active !== false).sort((a, b) => a.name.localeCompare(b.name));
const projects = () => Object.values(S.projecten).sort((a, b) => (b.nummer || "").localeCompare(a.nummer || "") || (a.klant || "").localeCompare(b.klant || ""));
const tasksOf = (pid) => Object.values(S.taken).filter(t => t.project_id === pid).sort((a, b) => (a.volgorde ?? 0) - (b.volgorde ?? 0) || (a.start || "9").localeCompare(b.start || "9"));
const hoursOf = (pred) => Object.values(S.uren).filter(pred).reduce((s, h) => s + (Number(h.uren) || 0), 0);
const taskDone = (tid) => hoursOf(h => h.taak_id === tid);
const projDone = (pid) => hoursOf(h => h.project_id === pid);
const projPlanned = (pid) => tasksOf(pid).reduce((s, t) => s + (Number(t.uren_gepland) || 0), 0);
const isLate = (t) => t.status !== "done" && t.eind && t.eind < todayIso;
const userById = (id) => S.profiles[id] || { name: "—", initials: "?", color: "#999" };
const projName = (p) => p ? (p.klant + (p.naam && p.naam !== p.klant ? " · " + p.naam : "")) : "—";
const projCode = (p) => p ? [p.nummer, KLANTCODE[p.klanttype]].filter(Boolean).join(" · ") : "";
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
const TABLES = { profiles: "profiles", tarieven: "tarieven", fasen: "fasen", standaardtaken: "standaardtaken", projecten: "projecten", taken: "taken", uren: "uren", documenten: "documenten", instellingen: "instellingen", loten: "loten", posten: "posten", meetstaat_posten: "meetstaat_posten", vorderingen: "vorderingen", vordering_regels: "vordering_regels" };
const OPTIONAL_TABLES = ["tarieven", "documenten", "instellingen", "loten", "posten", "meetstaat_posten", "vorderingen", "vordering_regels"]; // ontbreken zolang het bijbehorende sql-script niet is uitgevoerd
const rowKey = (t, r) => t === "fasen" || t === "loten" ? r.nr : t === "tarieven" ? r.user_id : t === "instellingen" ? r.key : t === "vordering_regels" ? (r.id || r.vordering_id + "|" + r.lot + "|" + (r.post_id || "")) : r.id;
function ingest(table, rows) {
  if (table === "standaardtaken") { S.standaardtaken = rows.sort((a, b) => a.fase_nr - b.fase_nr || a.volgorde - b.volgorde); return; }
  const o = {}; rows.forEach(r => o[rowKey(table, r)] = r); S[table] = o;
}
async function loadAll() {
  const res = await Promise.all(Object.keys(TABLES).map(t => sb.from(t).select("*").limit(5000)));
  Object.keys(TABLES).forEach((t, i) => { if (res[i].error) { if (!OPTIONAL_TABLES.includes(t)) throw res[i].error; } else ingest(t, res[i].data || []); });
  S.me = S.profiles[S.session.user.id] || null;
}
function subscribe() {
  const ch = sb.channel("planbord");
  ["profiles", "tarieven", "fasen", "standaardtaken", "projecten", "taken", "uren", "documenten", "loten", "posten", "meetstaat_posten", "vorderingen", "vordering_regels"].forEach(t => {
    ch.on("postgres_changes", { event: "*", schema: "public", table: t }, (payload) => {
      if (t === "standaardtaken") { refetch(t); return; }
      if (payload.eventType === "DELETE") { delete S[t][rowKey(t, payload.old)]; }
      else { S[t][rowKey(t, payload.new)] = payload.new; }
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
  const key = table === "tarieven" ? "user_id" : table === "loten" ? "nr" : "id"; S[table][data[key]] = data; render(); return data;
}
async function dbUpdate(table, id, patch) {
  const key = table === "tarieven" ? "user_id" : table === "loten" ? "nr" : "id";
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


/* ---------- Drive-koppeling (Google Apps Script als brosburo@gmail.com) ---------- */
const driveCfg = () => (S.instellingen.drive && S.instellingen.drive.value) || {};
const driveReady = () => !!(driveCfg().url && driveCfg().secret);
async function driveCall(action, payload) {
  const c = driveCfg(); if (!c.url) throw new Error("Drive-koppeling niet ingesteld (Instellingen → Drive).");
  const r = await fetch(c.url, { method: "POST", body: JSON.stringify({ ...payload, action, secret: c.secret }), redirect: "follow" });
  const j = await r.json().catch(() => ({ ok: false, error: "Onleesbaar antwoord van het Drive-script." }));
  if (!j.ok) throw new Error(j.error || "Drive-script gaf een fout.");
  return j;
}
/* Laadscherm met het BROS-logo dat volloopt. Het Drive-script geeft geen tussenstand,
   dus de balk loopt op volgens de duur van de vorige keer (bewaard per actie) en springt op 100% zodra het antwoord er is. */
const loader = (() => {
  let timer, start, expect, pct = 0;
  const set = (v, msg) => { pct = v; $("#loaderFill").style.clipPath = `inset(0 ${100 - v}% 0 0)`; $("#loaderPct").textContent = Math.round(v) + "%"; if (msg) $("#loaderMsg").textContent = msg; };
  const expected = (k) => { try { return Number(localStorage.getItem("bros.duur." + k)) || 0; } catch (e) { return 0; } };
  return {
    start(key, msg, fallbackMs) {
      clearInterval(timer); start = Date.now(); expect = expected(key) || fallbackMs || 10000;
      $("#loader").classList.add("show"); set(2, msg);
      timer = setInterval(() => { const t = (Date.now() - start) / expect; set(Math.min(92, 2 + 90 * (1 - Math.exp(-2.2 * t)))); }, 120);
    },
    step(msg) { if (msg) $("#loaderMsg").textContent = msg; },
    done(key) {
      clearInterval(timer);
      if (key) { try { localStorage.setItem("bros.duur." + key, String(Math.round((Date.now() - start) * 0.7 + expect * 0.3))); } catch (e) { } }
      set(100, "Klaar"); setTimeout(() => $("#loader").classList.remove("show"), 450);
    },
    fail() { clearInterval(timer); $("#loader").classList.remove("show"); },
  };
})();
async function driveSync(p, action) {
  const label = action === "create" ? "Projectmap aanmaken op Drive" : action === "link" ? "Map zoeken op Drive" : "Bestanden vernieuwen";
  loader.start("drive." + action, label + "…", action === "create" ? 12000 : 7000);
  try {
    const mapnaam = ((p.drive_map || "").replace(/^PROJECTEN\//, "").trim()) || p.klant;
    const j = await driveCall(action, action === "list" ? { folderId: p.drive_folder_id } : { klant: mapnaam });
    loader.step("Bestanden bewaren…");
    await dbUpdate("projecten", p.id, { drive_folder_id: j.folder.id, drive_url: j.folder.url, drive_map: "PROJECTEN/" + j.folder.name });
    const rows = (j.files || []).filter(f => !/^\._|^Icon|^~\$|^\.DS_Store$|~\.skp$/i.test(f.name)).map(f => ({ project_id: p.id, drive_id: f.id, naam: f.name, pad: f.path || "", url: f.url, mime: f.mime || "", grootte: f.size || null, gewijzigd: f.updated || null, gesynct_op: new Date().toISOString() }));
    const { data, error } = await sb.from("documenten").upsert(rows, { onConflict: "project_id,drive_id" }).select();
    if (error) toast("Documenten niet bewaard: " + error.message); else { Object.values(S.documenten).filter(d => d.project_id === p.id && !rows.some(r => r.drive_id === d.drive_id)).forEach(d => { sb.from("documenten").delete().eq("id", d.id); delete S.documenten[d.id]; }); (data || []).forEach(d => S.documenten[d.id] = d); }
    loader.done("drive." + action);
    render(); toast(j.created ? `Map aangemaakt met ${rows.length} bestanden` : `Map gekoppeld · ${rows.length} bestanden`);
  } catch (e) { loader.fail(); throw e; }
}
const docsOf = (pid) => Object.values(S.documenten).filter(d => d.project_id === pid).sort((a, b) => (a.pad || "").localeCompare(b.pad || "") || a.naam.localeCompare(b.naam));

/* ---------- Meetstaat: loten, postenbibliotheek en meetstaatregels per project ---------- */
const MS_STATUS = { offerte: "Offerte", akkoord: "Akkoord", meerwerk: "Meerwerk", minwerk: "Minwerk", vervallen: "Vervallen" };
const EENHEDEN = ["m2", "lm", "m3", "stk", "sog", "uur", "dag", "week", "rol", "zak", "%", "PM"];
const msReady = () => Object.keys(S.loten).length > 0;
const lotenList = () => Object.values(S.loten).filter(l => l.actief !== false).sort((a, b) => a.nr - b.nr);
const lotName = (nr) => S.loten[nr] ? `${nr}. ${S.loten[nr].naam}` : String(nr);
const postenOf = (lot) => Object.values(S.posten).filter(x => x.lot === lot && x.actief !== false).sort((a, b) => a.volgorde - b.volgorde);
const msRows = (pid) => Object.values(S.meetstaat_posten).filter(r => r.project_id === pid).sort((a, b) => a.lot - b.lot || (a.volgorde ?? 0) - (b.volgorde ?? 0) || (a.code || "").localeCompare(b.code || ""));
const msMarge = (r) => r.marge != null && r.marge !== "" ? Number(r.marge) : Number(S.loten[r.lot]?.marge) || 0;
const msKost = (r) => (Number(r.hoeveelheid) || 0) * (Number(r.eenheidsprijs) || 0);
const msVerkoopEP = (r) => (Number(r.eenheidsprijs) || 0) * (1 + msMarge(r));
const msVerkoop = (r) => (Number(r.hoeveelheid) || 0) * msVerkoopEP(r);
const msTelt = (r) => r.status !== "vervallen";
const eur2 = (n) => Number(n || 0).toLocaleString("nl-BE", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
function msTotals(pid) {
  const rows = msRows(pid).filter(msTelt);
  const t = { kost: 0, verkoop: 0, btw: 0, meerwerk: 0, n: rows.length };
  rows.forEach(r => { const v = msVerkoop(r); t.kost += msKost(r); if (r.status === "meerwerk") t.meerwerk += v; else if (r.status === "minwerk") t.meerwerk -= v; else t.verkoop += v; t.btw += v * (Number(r.btw) || 0) * (r.status === "minwerk" ? -1 : 1); });
  t.marge = t.verkoop + t.meerwerk - t.kost; t.incl = t.verkoop + t.meerwerk + t.btw; return t;
}
function vMeetstaat(p) {
  if (!msReady()) return `<div class="panel"><div class="empty"><b>Meetstaat nog niet beschikbaar</b>Voer eerst databasescript <code>sql/007_meetstaat.sql</code> uit in Supabase (SQL Editor). Daarna verschijnen hier de loten en de postenbibliotheek.</div></div>`;
  const rows = msRows(p.id); const beheer = isBeheer(); const t = msTotals(p.id);
  const byLot = {}; rows.forEach(r => (byLot[r.lot] = byLot[r.lot] || []).push(r));
  const lots = Object.keys(byLot).map(Number).sort((a, b) => a - b);
  const kpi = `<div class="rend">
    ${beheer ? `<div class="panel"><div class="k">Kostprijs excl. btw</div><div class="v">${eur(t.kost)}</div></div>` : ""}
    <div class="panel"><div class="k">Offerte excl. btw</div><div class="v">${eur(t.verkoop)}</div></div>
    <div class="panel"><div class="k">Meer-/minwerk excl. btw</div><div class="v ${t.meerwerk < 0 ? "neg" : ""}">${t.meerwerk ? eur(t.meerwerk) : "—"}</div></div>
    ${beheer ? `<div class="panel"><div class="k">Marge</div><div class="v ${t.marge >= 0 ? "pos" : "neg"}">${eur(t.marge)}<small class="muted" style="font-size:12px;font-weight:400"> · ${t.kost ? nl(t.marge / t.kost * 100, 1) : "0"} %</small></div></div>` : ""}
    <div class="panel"><div class="k">Btw</div><div class="v">${eur(t.btw)}</div></div>
    <div class="panel"><div class="k">Totaal incl. btw</div><div class="v">${eur(t.incl)}</div></div></div>`;
  const inp = (r, f, cls = "", attrs = "") => `<input class="inline ${cls}" data-ms="${r.id}" data-f="${f}" value="${esc(r[f] ?? "")}" ${attrs}>`;
  const num = (r, f, cls = "") => `<input class="inline num ${cls}" data-ms="${r.id}" data-f="${f}" type="number" step="any" inputmode="decimal" value="${r[f] == null || r[f] === "" ? "" : Number(r[f])}">`;
  const sel = (r, f, options) => `<select class="inline" data-ms="${r.id}" data-f="${f}">${options}</select>`;
  const cols = 8 + (beheer ? 3 : 0);
  const body = lots.map(nr => { const g = byLot[nr]; const sub = g.filter(msTelt).reduce((s, r) => s + msVerkoop(r), 0); const subk = g.filter(msTelt).reduce((s, r) => s + msKost(r), 0); let lastGroep = null;
    return `<tr class="ms-lot"><td colspan="${cols}"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><span>${esc(lotName(nr))} <span class="muted num" style="font-weight:400">${g.length} posten${beheer ? ` · kost ${eur(subk)}` : ""} · <b>${eur(sub)}</b> excl. btw</span></span><span class="actions"><button class="btn ghost sm" data-act="ms-add-post" data-pid="${p.id}" data-lot="${nr}">+ Post</button><button class="btn ghost sm danger" data-act="ms-del-lot" data-pid="${p.id}" data-lot="${nr}" title="Alle posten van dit lot verwijderen">✕</button></span></div></td></tr>` +
      g.map(r => { const gh = r.groep && r.groep !== lastGroep ? `<tr class="ms-groep"><td></td><td colspan="${cols - 1}">${esc(r.groep)}</td></tr>` : ""; lastGroep = r.groep || lastGroep; const dead = r.status === "vervallen";
        return gh + `<tr class="${dead ? "ms-dead" : ""}"><td class="num muted" style="width:52px">${esc(r.code)}</td>
        <td style="min-width:260px">${inp(r, "omschrijving", "wide")}</td>
        <td style="width:110px">${inp(r, "locatie", "", 'placeholder="locatie"')}</td>
        <td style="width:84px">${num(r, "hoeveelheid")}</td>
        <td style="width:82px">${sel(r, "eenheid", opts(EENHEDEN.map(e => [e, e]), r.eenheid))}</td>
        ${beheer ? `<td style="width:96px">${num(r, "eenheidsprijs")}</td><td style="width:64px"><input class="inline num" data-ms="${r.id}" data-f="marge" type="number" step="1" inputmode="numeric" placeholder="${Math.round((Number(S.loten[r.lot]?.marge) || 0) * 100)}" value="${r.marge == null || r.marge === "" ? "" : Math.round(Number(r.marge) * 100)}" title="Marge % (leeg = marge van het lot)"></td>` : ""}
        <td class="r num" style="width:96px" title="Eenheidsprijs voor de klant">${eur2(msVerkoopEP(r))}</td>
        <td class="r num" style="width:104px"><b>${eur2(msVerkoop(r))}</b></td>
        ${beheer ? `<td style="width:76px">${sel(r, "btw", opts([[0.06, "6 %"], [0.21, "21 %"], [0, "0 %"]], Number(r.btw)))}</td>` : ""}
        <td style="width:104px">${sel(r, "status", opts(Object.entries(MS_STATUS), r.status))}</td>
        <td class="r" style="width:36px"><button class="btn ghost sm danger" data-act="ms-del" data-id="${r.id}" aria-label="Verwijderen">✕</button></td></tr>`; }).join(""); }).join("");
  return kpi + `<div class="panel"><div class="panel-head"><div><h3>Meetstaat</h3><div class="muted" style="font-size:12px;margin-top:2px">${rows.length ? `${rows.length} posten in ${lots.length} loten` : "Nog leeg"} · klik in een veld om het te wijzigen, bewaard bij verlaten van het veld</div></div>
      <div class="actions">${rows.length ? `<button class="btn sm" data-act="ms-export" data-pid="${p.id}" title="Excel in het BROS-sjabloon aanmaken in Documenten/Meetstaat van de projectmap">Exporteren naar Drive (Excel)</button>` : ""}<button class="btn sm" data-act="ms-add-post" data-pid="${p.id}">+ Post</button><button class="btn sm primary" data-act="ms-add-lot" data-pid="${p.id}">+ Lot toevoegen</button></div></div>
    ${rows.length ? `<div class="tw"><table class="t ms"><thead><tr><th>Nr</th><th>Omschrijving</th><th>Locatie</th><th>Hoev.</th><th>Eenh.</th>${beheer ? `<th title="Kostprijs / aannemersprijs excl. btw">Kost EP</th><th>Marge</th>` : ""}<th class="r">Klant EP</th><th class="r">Totaal excl.</th>${beheer ? `<th>Btw</th>` : ""}<th>Status</th><th></th></tr></thead><tbody>${body}</tbody></table></div>` : `<div class="empty"><b>Nog geen posten</b>Voeg een lot toe (met de standaardposten) of kies losse posten uit de bibliotheek.</div>`}</div>`;
}
function msNextCode(pid, lot) { const n = msRows(pid).filter(r => r.lot === lot).length + 1; return `${lot}.${n}`; }
function msRowFromPost(pid, x, lot, i) {
  const sog = x.prijstype !== "EP";
  return { project_id: pid, post_id: x.id || null, lot, code: `${lot}.${i}`, groep: x.groep || "", omschrijving: x.omschrijving, eenheid: x.eenheid || (sog ? "sog" : "stk"), prijstype: x.prijstype || "EP", hoeveelheid: sog ? 1 : 0, eenheidsprijs: Number(x.richtprijs) || 0, marge: null, btw: x.btw ?? 0.06, status: "offerte", volgorde: x.volgorde ?? 0, created_by: S.me?.id || null };
}
async function msInsert(rows) {
  if (!rows.length) return [];
  const { data, error } = await sb.from("meetstaat_posten").insert(rows).select();
  if (error) { toast("Mislukt: " + error.message); throw error; }
  (data || []).forEach(r => S.meetstaat_posten[r.id] = r); render(); return data || [];
}
function msAddLotForm(pid) {
  const p = S.projecten[pid]; const present = new Set(msRows(pid).map(r => r.lot));
  openModal("Lot toevoegen aan " + p.klant, `<div class="fase-list">${lotenList().map(l => { const all = postenOf(l.nr), std = all.filter(x => x.standaard_aan); return `<label class="chk"><input type="checkbox" name="lot" value="${l.nr}" ${present.has(l.nr) ? "disabled" : (l.standaard_aan && !present.size ? "checked" : "")}> <span>${esc(lotName(l.nr))}<small class="muted" style="display:block">${present.has(l.nr) ? "al aanwezig" : `${std.length} standaardposten · ${all.length} in bibliotheek`}</small></span></label>`; }).join("")}</div>
    <div class="field" style="margin-top:12px"><label for="al_mode">Welke posten</label><select id="al_mode" name="mode"><option value="std">Alleen de standaardposten (aanbevolen)</option><option value="all">Alle posten van het lot</option><option value="none">Geen posten — alleen het lot klaarzetten</option></select></div>
    <p class="muted" style="font-size:13px;margin:10px 0 0">Richtprijzen uit de bibliotheek worden als kostprijs ingevuld; hoeveelheden staan op 0 (forfaits op 1). Alles is daarna in de tabel aan te passen.</p>`, {
    saveLabel: "Toevoegen", wide: true,
    onSave: async (d) => {
      const lots = [...$("#mform").querySelectorAll('input[name="lot"]:checked')].map(i => Number(i.value)); if (!lots.length) { toast("Kies minstens één lot."); return false; }
      const rows = [];
      lots.forEach(lot => { const src = d.mode === "none" ? [] : postenOf(lot).filter(x => d.mode === "all" || x.standaard_aan); src.forEach((x, i) => rows.push(msRowFromPost(pid, x, lot, i + 1))); if (!src.length) rows.push({ ...msRowFromPost(pid, { omschrijving: S.loten[lot].naam, eenheid: "sog", prijstype: "SOG", richtprijs: 0, btw: 0.06 }, lot, 1), groep: "" }); });
      await msInsert(rows); toast(`${rows.length} posten toegevoegd`);
    },
  });
}
function msAddPostForm(pid, lot) {
  const p = S.projecten[pid]; let curLot = lot || lotenList()[0]?.nr;
  const listHtml = (lotNr, q) => { const qq = (q || "").toLowerCase(); const src = qq ? Object.values(S.posten).filter(x => x.actief !== false && (x.omschrijving.toLowerCase().includes(qq) || (x.groep || "").toLowerCase().includes(qq))).sort((a, b) => a.lot - b.lot || a.volgorde - b.volgorde).slice(0, 80) : postenOf(lotNr);
    return src.map(x => `<label class="chk"><input type="checkbox" name="post" value="${x.id}"> <span>${esc(x.omschrijving)}<small class="muted" style="display:block">${qq ? esc(lotName(x.lot)) + " · " : ""}${esc(x.groep || "")}${x.groep ? " · " : ""}${esc(x.eenheid)}${x.richtprijs ? " · " + eur2(x.richtprijs) : ""}</small></span></label>`).join("") || `<div class="muted" style="padding:8px">Geen posten gevonden.</div>`; };
  openModal("Post toevoegen aan " + p.klant, `<div class="form-grid">
      <div class="field"><label for="ap_lot">Lot</label><select id="ap_lot" name="lot">${opts(lotenList().map(l => [l.nr, lotName(l.nr)]), curLot)}</select></div>
      <div class="field"><label for="ap_q">Zoeken in de bibliotheek</label><input id="ap_q" placeholder="bv. plint, spot, chape…" autocomplete="off"></div>
      <div class="field span2"><div id="ap_list" class="fase-list" style="max-height:300px;overflow:auto">${listHtml(curLot)}</div></div>
      <div class="field span2"><label for="ap_vrij">Of een vrije post (omschrijving)</label><input id="ap_vrij" name="vrij" placeholder="eigen omschrijving — komt in het gekozen lot"></div>
      <div class="field"><label for="ap_een">Eenheid vrije post</label><select id="ap_een" name="eenheid">${opts(EENHEDEN.map(e => [e, e]), "stk")}</select></div>
      <div class="field"><label for="ap_prijs">Kostprijs vrije post (excl. btw)</label><input id="ap_prijs" name="prijs" type="number" step="any" placeholder="0"></div>
    </div>`, {
    saveLabel: "Toevoegen", wide: true,
    onSave: async (d) => {
      const lotNr = Number(d.lot); const ids = [...$("#mform").querySelectorAll('input[name="post"]:checked')].map(i => i.value);
      const rows = []; const cnt = {}; const next = (l) => { cnt[l] = (cnt[l] ?? msRows(pid).filter(r => r.lot === l).length) + 1; return cnt[l]; };
      const zoekend = !!$("#ap_q").value.trim();
      ids.forEach(id => { const x = S.posten[id]; const l = zoekend ? x.lot : lotNr; rows.push(msRowFromPost(pid, x, l, next(l))); });
      if (d.vrij && d.vrij.trim()) { const n = next(lotNr); rows.push(msRowFromPost(pid, { omschrijving: d.vrij.trim(), eenheid: d.eenheid, prijstype: d.eenheid === "sog" ? "SOG" : "EP", richtprijs: Number(d.prijs) || 0, btw: 0.06, volgorde: 9000 + n }, lotNr, n)); }
      if (!rows.length) { toast("Vink een post aan of typ een vrije post."); return false; }
      await msInsert(rows); toast(`${rows.length} post${rows.length > 1 ? "en" : ""} toegevoegd`);
    },
  });
  const sync = () => { $("#ap_list").innerHTML = listHtml(Number($("#ap_lot").value), $("#ap_q").value.trim()); };
  $("#ap_lot").addEventListener("change", sync); $("#ap_q").addEventListener("input", sync);
}
async function msEdit(id, f, raw) {
  const r = S.meetstaat_posten[id]; if (!r) return;
  let v = raw;
  if (["hoeveelheid", "eenheidsprijs", "btw"].includes(f)) v = raw === "" ? 0 : Number(String(raw).replace(",", "."));
  if (f === "marge") v = raw === "" ? null : Number(String(raw).replace(",", ".")) / 100;
  if (String(r[f] ?? "") === String(v ?? "")) return;
  const active = document.activeElement; const keep = active && active.dataset ? { ms: active.dataset.ms, f: active.dataset.f, sel: active.selectionStart } : null;
  try { await dbUpdate("meetstaat_posten", id, { [f]: v, updated_at: new Date().toISOString() }); } catch (e) { return; }
  if (keep && keep.ms) { const el = document.querySelector(`[data-ms="${keep.ms}"][data-f="${keep.f}"]`); if (el) { el.focus(); try { if (keep.sel != null) el.setSelectionRange(keep.sel, keep.sel); } catch (e) { } } }
}
async function msDelLot(pid, lot) {
  const ids = msRows(pid).filter(r => r.lot === lot).map(r => r.id);
  if (!confirm(`${lotName(lot)}: alle ${ids.length} posten verwijderen uit deze meetstaat?`)) return;
  const { error } = await sb.from("meetstaat_posten").delete().in("id", ids);
  if (error) return toast("Mislukt: " + error.message);
  ids.forEach(id => delete S.meetstaat_posten[id]); render(); toast("Lot verwijderd");
}
/* ---------- Facturatie: vorderingsstaat per project (percentages per lot én per post) ---------- */
const VORD_SOORT = { voorschot: "Voorschot", vordering: "Vordering", slotfactuur: "Slotfactuur", meerwerk: "Meerwerk" };
const VORD_STATUS = { opgemaakt: "Op te maken", verzonden: "Verzonden", betaald: "Betaald" };
const vordOf = (pid) => Object.values(S.vorderingen).filter(v => v.project_id === pid).sort((a, b) => a.nr - b.nr || (a.created_at || "").localeCompare(b.created_at || ""));
const vordLocked = (v) => v.status !== "opgemaakt";
const isMw = (r) => r.status === "meerwerk" || r.status === "minwerk";
const rowSigned = (r) => msVerkoop(r) * (r.status === "minwerk" ? -1 : 1);
/* regels van een vordering: lot-niveau (post_id leeg) en post-niveau */
function vordRegels(vid) { const lot = {}, post = {}; Object.values(S.vordering_regels).filter(r => r.vordering_id === vid).forEach(r => { if (r.post_id) post[r.post_id] = r; else lot[r.lot] = r; }); return { lot, post }; }
const vordPct = (rg, r) => rg.post[r.id] ? Number(rg.post[r.id].pct) : rg.lot[r.lot] ? Number(rg.lot[r.lot].pct) : null;
/* rijen van de meetstaat die bij een soort vordering horen (contract vs. meerwerk) */
const vordRows = (pid, soort) => msRows(pid).filter(msTelt).filter(r => isMw(r) === (soort === "meerwerk"));
/* basis per lot: contract (offerte+akkoord) en meerwerk (meerwerk − minwerk) */
function lotBasis(pid) {
  const b = {}; msRows(pid).filter(msTelt).forEach(r => { const x = b[r.lot] = b[r.lot] || { offerte: 0, meerwerk: 0 }; if (isMw(r)) x.meerwerk += rowSigned(r); else x.offerte += msVerkoop(r); }); return b;
}
const vordBase = (basis, lot, soort) => soort === "meerwerk" ? (basis[lot]?.meerwerk || 0) : (basis[lot]?.offerte || 0);
/* berekening van één vordering: per post en per lot */
function vordCalc(v) {
  const rg = vordRegels(v.id); const perLot = {}, perPost = {}; let excl = 0, btw = 0;
  vordRows(v.project_id, v.soort).forEach(r => { const pct = vordPct(rg, r); if (pct == null) return; const a = pct * rowSigned(r); perPost[r.id] = { pct, excl: a }; const L = perLot[r.lot] = perLot[r.lot] || { excl: 0 }; L.excl += a; excl += a; btw += a * (Number(r.btw) || 0); });
  return { excl, btw, incl: excl + btw, perLot, perPost, rg };
}
const vordBedrag = (v, c) => v.bedrag_excl != null && v.bedrag_excl !== "" && vordLocked(v) ? Number(v.bedrag_excl) : c.excl;
/* cumulatief per post over alle vorderingen van dezelfde soort */
function cumPost(pid, calcs, r) { return vordOf(pid).filter(v => (v.soort === "meerwerk") === isMw(r)).reduce((s, v) => s + (calcs[v.id].perPost[r.id]?.pct || 0), 0); }
function vFacturatie(p) {
  if (!msReady()) return `<div class="panel"><div class="empty"><b>Facturatie nog niet beschikbaar</b>Voer eerst databasescript <code>sql/007_meetstaat.sql</code> uit.</div></div>`;
  const beheer = isBeheer(); const basis = lotBasis(p.id); const vs = vordOf(p.id); const calcs = {}; vs.forEach(v => calcs[v.id] = vordCalc(v));
  const lots = Object.keys(basis).map(Number).sort((a, b) => a - b);
  const contract = lots.reduce((s, l) => s + basis[l].offerte, 0), meerwerk = lots.reduce((s, l) => s + basis[l].meerwerk, 0);
  const gefact = vs.filter(vordLocked).reduce((s, v) => s + vordBedrag(v, calcs[v.id]), 0);
  const betaald = vs.filter(v => v.status === "betaald").reduce((s, v) => s + vordBedrag(v, calcs[v.id]), 0);
  const open = vs.filter(v => !vordLocked(v)).reduce((s, v) => s + calcs[v.id].excl, 0);
  const kpi = `<div class="rend">
    <div class="panel"><div class="k">Contract excl. btw</div><div class="v">${eur(contract)}</div></div>
    <div class="panel"><div class="k">Meer-/minwerk</div><div class="v ${meerwerk < 0 ? "neg" : ""}">${meerwerk ? eur(meerwerk) : "—"}</div></div>
    <div class="panel"><div class="k">Gefactureerd excl. btw</div><div class="v">${eur(gefact)}</div><div class="muted" style="font-size:12px">${contract + meerwerk ? nl(gefact / (contract + meerwerk) * 100, 0) : 0} % · betaald ${eur(betaald)}</div></div>
    <div class="panel"><div class="k">Op te maken</div><div class="v">${open ? eur(open) : "—"}</div></div>
    <div class="panel"><div class="k">Nog te factureren</div><div class="v ${contract + meerwerk - gefact - open < -0.5 ? "neg" : ""}">${eur(contract + meerwerk - gefact - open)}</div></div></div>`;
  if (!lots.length) return kpi + `<div class="panel"><div class="empty"><b>Nog geen meetstaat</b>Maak eerst de meetstaat op (tabblad Meetstaat); de vorderingsstaat rekent op de loten en posten daarvan.</div></div>`;
  const heeftVoorschot = vs.some(v => v.soort === "voorschot");
  S.vordOpen = S.vordOpen || {};
  const pctFmt = (x) => Math.round(x * 1000) / 10;
  /* cel voor een lot: invoerveld als het lot-% geldt, anders het gewogen % (per post ingesteld) */
  const lotCell = (v, lot, soort) => { const c = calcs[v.id]; const base = vordBase(basis, lot, soort); if ((v.soort === "meerwerk") !== (soort === "meerwerk") || !base) return `<td class="c muted">·</td>`;
    const L = c.perLot[lot]; const overrides = vordRows(p.id, soort).some(r => r.lot === lot && c.rg.post[r.id]); const lotPct = c.rg.lot[lot] ? Number(c.rg.lot[lot].pct) : null;
    const amt = L ? L.excl : 0; const w = base ? amt / base : 0;
    if (overrides || vordLocked(v) || !beheer) return `<td class="c num">${(L || lotPct != null) ? pctFmt(w) + " %" : ""}${overrides ? `<small class="muted" style="display:block">per post</small>` : ""}<small class="muted" style="display:block">${L ? eur(amt) : ""}</small></td>`;
    return `<td class="c"><input class="inline num" style="width:58px;text-align:right" data-vr="${v.id}" data-lot="${lot}" type="number" step="any" min="0" max="100" value="${lotPct == null ? "" : pctFmt(lotPct)}" placeholder="0"> <span class="muted">%</span><small class="muted" style="display:block">${L ? eur(amt) : ""}</small></td>`; };
  const postCell = (v, r) => { const c = calcs[v.id]; if ((v.soort === "meerwerk") !== isMw(r)) return `<td class="c muted">·</td>`; const P = c.perPost[r.id]; const own = !!c.rg.post[r.id];
    if (vordLocked(v) || !beheer) return `<td class="c num">${P ? pctFmt(P.pct) + " %" : ""}<small class="muted" style="display:block">${P ? eur(P.excl) : ""}</small></td>`;
    return `<td class="c"><input class="inline num ${own ? "" : "muted"}" style="width:58px;text-align:right" data-vr="${v.id}" data-lot="${r.lot}" data-vpost="${r.id}" type="number" step="any" min="0" max="100" value="${P ? pctFmt(P.pct) : ""}" placeholder="0" title="${own ? "eigen % voor deze post" : "volgt het lot-%"}"> <span class="muted">%</span><small class="muted" style="display:block">${P ? eur(P.excl) : ""}</small></td>`; };
  const lotRows = (soort) => lots.filter(l => Math.abs(vordBase(basis, l, soort)) > 0.005).map(l => { const base = vordBase(basis, l, soort); const rows = vordRows(p.id, soort).filter(r => r.lot === l); const inv = vs.reduce((s, v) => s + (calcs[v.id].perLot[l]?.excl || 0) * ((v.soort === "meerwerk") === (soort === "meerwerk") ? 1 : 0), 0); const cum = base ? inv / base : 0; const rest = base - inv; const key = soort + l; const openL = !!S.vordOpen[key];
    return `<tr class="${soort === "meerwerk" ? "ms-mw" : ""}"><td class="sticky"><button class="btn ghost sm" data-vtoggle="${key}" aria-label="Posten tonen" style="padding:0 4px">${openL ? "▾" : "▸"}</button> <b>${esc(lotName(l))}</b>${soort === "meerwerk" ? ` <span class="pill st-offerte" style="font-size:10px">meerwerk</span>` : ""}<small class="muted" style="display:block;margin-left:22px">${rows.length} posten</small></td><td class="r num">${eur(base)}</td>${vs.map(v => lotCell(v, l, soort)).join("")}<td class="c num"><b>${pctFmt(cum)} %</b></td><td class="r num ${Math.abs(rest) < 0.005 ? "muted" : ""}">${eur(rest)}</td></tr>` +
      (openL ? rows.map(r => { const amt = rowSigned(r); const invP = vs.reduce((s, v) => s + (calcs[v.id].perPost[r.id]?.excl || 0), 0); const cumP = amt ? invP / amt : 0;
        return `<tr class="vpost"><td class="sticky" style="padding-left:30px"><span class="muted num" style="font-size:11px">${esc(r.code)}</span> ${esc(r.omschrijving)}${r.locatie ? ` <small class="muted">· ${esc(r.locatie)}</small>` : ""}</td><td class="r num">${eur(amt)}</td>${vs.map(v => postCell(v, r)).join("")}<td class="c num">${pctFmt(cumP)} %</td><td class="r num ${Math.abs(amt - invP) < 0.005 ? "muted" : ""}">${eur(amt - invP)}</td></tr>`; }).join("") : ""); }).join("");
  const totRow = (label, base, f, rest) => `<tr class="tot"><td class="sticky"><b>${label}</b></td><td class="r num"><b>${eur(base)}</b></td>${vs.map(v => `<td class="c num"><b>${eur(f(v))}</b></td>`).join("")}<td></td><td class="r num"><b>${eur(rest)}</b></td></tr>`;
  const sumInv = (soort) => vs.filter(v => (v.soort === "meerwerk") === (soort === "meerwerk")).reduce((s, v) => s + calcs[v.id].excl, 0);
  const head = vs.map(v => { const c = calcs[v.id]; const frozen = vordLocked(v) && v.bedrag_excl != null && v.bedrag_excl !== ""; const diff = frozen ? Number(v.bedrag_excl) - c.excl : 0;
    return `<th class="vh"><div class="vh-top"><span class="pill st-${v.status === "betaald" ? "afgerond" : v.status === "verzonden" ? "lopend" : "offerte"}">${v.nr === 0 ? "Voorschot" : "#" + v.nr}${v.soort === "meerwerk" ? " · MW" : ""}</span>${beheer && !vordLocked(v) ? `<button class="btn ghost sm danger" data-act="vord-del" data-id="${v.id}" aria-label="Verwijderen">✕</button>` : ""}</div>
      <div class="vh-body">${beheer ? `<input class="inline" data-vf="${v.id}" data-f="omschrijving" value="${esc(v.omschrijving || "")}" placeholder="${esc(VORD_SOORT[v.soort])}">` : `<div>${esc(v.omschrijving || VORD_SOORT[v.soort])}</div>`}
      <div class="vh-row"><span class="muted">Datum</span>${beheer ? `<input class="inline num" data-vf="${v.id}" data-f="datum" type="date" value="${v.datum || ""}">` : `<span class="num">${fmtLong(v.datum)}</span>`}</div>
      <div class="vh-row"><span class="muted">Yuki-nr</span>${beheer ? `<input class="inline num" data-vf="${v.id}" data-f="factuurnummer" value="${esc(v.factuurnummer || "")}" placeholder="—">` : `<span class="num">${esc(v.factuurnummer || "—")}</span>`}</div>
      <div class="vh-row"><span class="muted">Berekend</span><span class="num">${eur(c.excl)}</span></div>
      <div class="vh-row"><span class="muted">Btw · incl.</span><span class="num">${eur(c.btw)} · <b>${eur(c.incl)}</b></span></div>
      ${beheer ? `<div class="vh-row"><span class="muted" title="Bedrag op de factuur in Yuki (excl. btw) — wordt bevroren zodra de status verzonden of betaald is">Factuur excl.</span><input class="inline num" data-vf="${v.id}" data-f="bedrag_excl" type="number" step="any" value="${v.bedrag_excl == null ? "" : Number(v.bedrag_excl)}" placeholder="${Math.round(c.excl)}"></div>` : ""}
      ${frozen && Math.abs(diff) > 0.5 ? `<div class="vh-row" style="color:var(--warn)"><span>Verschil</span><span class="num">${eur(diff)}</span></div>` : ""}
      <div class="vh-row"><span class="muted">Status</span>${beheer ? `<select class="inline" data-vf="${v.id}" data-f="status">${opts(Object.entries(VORD_STATUS), v.status)}</select>` : `<span>${VORD_STATUS[v.status]}</span>`}</div></div></th>`; }).join("");
  const grid = `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Vorderingsstaat</h3><div class="muted" style="font-size:12px;margin-top:2px">Per lot het % dat je in elke vordering factureert; klap een lot open (▸) om per post te werken — een post-% overschrijft het lot-%. Het voorschot telt overal mee. Meerwerk staat apart en zit niet in het voorschot.</div></div>
      <div class="actions">${beheer ? `${heeftVoorschot ? "" : `<button class="btn sm" data-act="vord-new" data-pid="${p.id}" data-soort="voorschot">+ Voorschot</button>`}<button class="btn sm primary" data-act="vord-new" data-pid="${p.id}" data-soort="vordering">+ Vordering</button>${meerwerk ? `<button class="btn sm" data-act="vord-new" data-pid="${p.id}" data-soort="meerwerk">+ Meerwerkfactuur</button>` : ""}<button class="btn sm" data-act="vord-new" data-pid="${p.id}" data-soort="slotfactuur" title="Alles wat nog openstaat, per post">+ Slotfactuur</button>` : ""}</div></div>
    ${vs.length ? `<div class="tw"><table class="t vord"><thead><tr><th class="sticky">Lot / post</th><th class="r">Basis excl.</th>${head}<th class="c">Cumul.</th><th class="r">Rest</th></tr></thead><tbody>
      ${lotRows("vordering")}${totRow("Contract", contract, (v) => v.soort === "meerwerk" ? 0 : calcs[v.id].excl, contract - sumInv("vordering"))}
      ${meerwerk ? lotRows("meerwerk") + totRow("Meer-/minwerk", meerwerk, (v) => v.soort === "meerwerk" ? calcs[v.id].excl : 0, meerwerk - sumInv("meerwerk")) : ""}
      ${totRow("Totaal excl. btw", contract + meerwerk, (v) => calcs[v.id].excl, contract + meerwerk - sumInv("vordering") - sumInv("meerwerk"))}
      <tr class="tot"><td class="sticky"><b>Totaal incl. btw</b></td><td></td>${vs.map(v => `<td class="c num"><b>${eur(calcs[v.id].incl)}</b></td>`).join("")}<td></td><td></td></tr></tbody></table></div>` : `<div class="empty"><b>Nog geen vorderingen</b>Begin met het voorschot (bv. 30 % op het contract), daarna een vordering per afgewerkt lot of per post.</div>`}</div>`;
  const klant = `<div class="panel"><div class="panel-head"><div><h3>Overzicht voor de klant</h3><div class="muted" style="font-size:12px;margin-top:2px">Zo ziet de klant het straks in het portaal: geen percentages of kostprijzen, wel wat gefactureerd is en wat nog komt.</div></div></div>
    <div class="tw"><table class="t"><thead><tr><th>Nr</th><th>Datum</th><th>Omschrijving</th><th>Loten</th><th class="r">Excl. btw</th><th class="r">Btw</th><th class="r">Incl. btw</th><th>Status</th></tr></thead><tbody>
      ${vs.map(v => { const c = calcs[v.id]; const excl = vordBedrag(v, c); const btw = c.excl ? excl * (c.btw / c.excl) : c.btw; const lotsTxt = v.soort === "voorschot" ? "alle loten" : Object.keys(c.perLot).filter(l => Math.abs(c.perLot[l].excl) > 0.005).map(l => lotName(Number(l))).join(", ");
        return `<tr><td class="num">${v.nr === 0 ? "V" : v.nr}</td><td class="num">${fmtLong(v.datum)}</td><td>${esc(v.omschrijving || VORD_SOORT[v.soort])}${v.factuurnummer ? `<small class="muted" style="display:block">factuur ${esc(v.factuurnummer)}</small>` : ""}</td><td class="muted" style="font-size:12px;max-width:260px">${esc(lotsTxt)}</td><td class="r num">${eur(excl)}</td><td class="r num">${eur(btw)}</td><td class="r num"><b>${eur(excl + btw)}</b></td><td><span class="pill st-${v.status === "betaald" ? "afgerond" : v.status === "verzonden" ? "lopend" : "offerte"}">${VORD_STATUS[v.status]}</span></td></tr>`; }).join("") || `<tr><td class="muted" colspan="8">Nog geen facturen.</td></tr>`}
      <tr class="tot"><td colspan="4"><b>Nog te factureren (contract + meerwerk − gefactureerd/opgemaakt)</b></td><td class="r num"><b>${eur(contract + meerwerk - gefact - open)}</b></td><td></td><td></td><td></td></tr></tbody></table></div></div>`;
  return kpi + grid + klant;
}
/* regels voor "de rest" van gekozen loten: lot-% als alle posten gelijk staan, anders per post */
function restRegels(pid, soort, lots, calcs) {
  const out = [];
  lots.forEach(l => { const rows = vordRows(pid, soort).filter(r => r.lot === l && Math.abs(rowSigned(r)) > 0.005); if (!rows.length) return;
    const rests = rows.map(r => Math.max(0, 1 - cumPost(pid, calcs, r)));
    const uniform = rests.every(x => Math.abs(x - rests[0]) < 1e-6);
    if (uniform) { if (rests[0] > 1e-6) out.push({ lot: l, post_id: null, pct: rests[0] }); }
    else rows.forEach((r, i) => { if (rests[i] > 1e-6) out.push({ lot: l, post_id: r.id, pct: rests[i] }); }); });
  return out;
}
function vordForm(pid, soort) {
  const p = S.projecten[pid]; const basis = lotBasis(pid); const vs = vordOf(pid); const calcs = {}; vs.forEach(v => calcs[v.id] = vordCalc(v));
  const lots = Object.keys(basis).map(Number).sort((a, b) => a - b).filter(l => Math.abs(vordBase(basis, l, soort === "slotfactuur" ? "vordering" : soort)) > 0.005);
  const nextNr = soort === "voorschot" ? 0 : Math.max(0, ...vs.map(v => v.nr)) + 1;
  const isVoorschot = soort === "voorschot", isSlot = soort === "slotfactuur";
  const restLot = (l, srt) => { const base = vordBase(basis, l, srt); const inv = vs.reduce((s, v) => s + ((v.soort === "meerwerk") === (srt === "meerwerk") ? (calcs[v.id].perLot[l]?.excl || 0) : 0), 0); return base - inv; };
  openModal({ voorschot: "Voorschotfactuur", vordering: "Nieuwe vordering", slotfactuur: "Slotfactuur", meerwerk: "Meerwerkfactuur" }[soort] + " — " + p.klant, `<div class="form-grid">
      <div class="field"><label for="vo_oms">Omschrijving</label><input id="vo_oms" name="omschrijving" value="${esc(isVoorschot ? "Voorschot bij ondertekening" : isSlot ? "Slotfactuur bij oplevering" : "")}" placeholder="bv. Afwerking lot 8 en 9"></div>
      <div class="field"><label for="vo_datum">Datum</label><input id="vo_datum" name="datum" type="date" value="${todayIso}"></div>
      ${isVoorschot ? `<div class="field"><label for="vo_pct">Voorschot % op het contract</label><input id="vo_pct" name="pct" type="number" step="any" min="0" max="100" value="30"></div><div class="field"><label>Contract excl. btw</label><div class="num" style="padding:8px 0">${eur(lots.reduce((s, l) => s + basis[l].offerte, 0))}</div></div>`
      : isSlot ? `<div class="field span2"><p class="muted" style="margin:0">Alles wat nog openstaat wordt gefactureerd: per post het resterende % op het contract${lots.some(l => basis[l].meerwerk) ? " (meerwerk factureer je apart via + Meerwerkfactuur)" : ""}. Nog open: <b>${eur(lots.reduce((s, l) => s + restLot(l, "vordering"), 0))}</b> excl. btw.</p></div>`
      : `<div class="field span2"><label>Loten die je nu factureert — het resterende % wordt voorgesteld; daarna per lot of per post aanpasbaar in de tabel</label><div class="fase-list">${lots.map(l => { const rest = restLot(l, soort); const base = vordBase(basis, l, soort); return `<label class="chk"><input type="checkbox" name="lot" value="${l}" ${Math.abs(rest) <= 0.005 ? "disabled" : ""}> <span>${esc(lotName(l))}<small class="muted" style="display:block">rest ${base ? nl(rest / base * 100, 0) : 0} % · ${eur(rest)}</small></span></label>`; }).join("")}</div></div>`}
    </div>`, {
    saveLabel: "Aanmaken", wide: !isVoorschot,
    onSave: async (d) => {
      const sel = isVoorschot || isSlot ? lots : [...$("#mform").querySelectorAll('input[name="lot"]:checked')].map(i => Number(i.value));
      if (!sel.length) { toast("Kies minstens één lot."); return false; }
      const regels = isVoorschot ? sel.map(l => ({ lot: l, post_id: null, pct: (Number(d.pct) || 0) / 100 })) : restRegels(pid, isSlot ? "vordering" : soort, sel, calcs);
      if (!regels.length) { toast("Er staat niets meer open voor deze loten."); return false; }
      const { data: v, error } = await sb.from("vorderingen").insert({ project_id: pid, nr: nextNr, soort, omschrijving: d.omschrijving.trim(), datum: d.datum || null, status: "opgemaakt" }).select().single();
      if (error) { toast("Mislukt: " + error.message); return false; }
      S.vorderingen[v.id] = v;
      const r2 = await sb.from("vordering_regels").insert(regels.map(r => ({ vordering_id: v.id, lot: r.lot, post_id: r.post_id, pct: r.pct }))).select();
      if (r2.error) { toast("Regels niet bewaard: " + r2.error.message + (/post_id/.test(r2.error.message) ? " — voer sql/008_vordering_posten.sql uit" : "")); } else (r2.data || []).forEach(r => S.vordering_regels[rowKey("vordering_regels", r)] = r);
      render(); toast(`${VORD_SOORT[soort]} aangemaakt`);
    },
  });
}
/* % wijzigen: op lot-niveau (post_id leeg → post-regels van dat lot worden gewist) of op post-niveau */
async function vordEditPct(vid, lot, raw, postId) {
  const v = S.vorderingen[vid]; if (!v || vordLocked(v)) return;
  const pct = raw === "" ? null : Math.min(1, Math.max(0, Number(String(raw).replace(",", ".")) / 100));
  const all = Object.values(S.vordering_regels).filter(r => r.vordering_id === vid && r.lot === lot);
  const cur = all.find(r => (postId ? r.post_id === postId : !r.post_id));
  if (cur && pct != null && Math.abs(Number(cur.pct) - pct) < 1e-6) return;
  if (!cur && pct == null) return;
  if (pct == null) { const { error } = await sb.from("vordering_regels").delete().eq("id", cur.id); if (error) return toast("Mislukt: " + error.message); delete S.vordering_regels[rowKey("vordering_regels", cur)]; }
  else if (cur) { const { data, error } = await sb.from("vordering_regels").update({ pct }).eq("id", cur.id).select().single(); if (error) return toast("Mislukt: " + error.message); S.vordering_regels[rowKey("vordering_regels", data)] = data; }
  else { const { data, error } = await sb.from("vordering_regels").insert({ vordering_id: vid, lot, post_id: postId || null, pct }).select().single(); if (error) return toast("Mislukt: " + error.message + (/post_id|column/.test(error.message) ? " — voer sql/008_vordering_posten.sql uit" : "")); S.vordering_regels[rowKey("vordering_regels", data)] = data; }
  if (!postId) { const posts = all.filter(r => r.post_id); if (posts.length) { await sb.from("vordering_regels").delete().in("id", posts.map(r => r.id)); posts.forEach(r => delete S.vordering_regels[rowKey("vordering_regels", r)]); } }
  render();
}
async function vordEdit(vid, f, raw) {
  const v = S.vorderingen[vid]; if (!v) return; let val = raw;
  if (f === "bedrag_excl") val = raw === "" ? null : Number(String(raw).replace(",", "."));
  if (f === "datum") val = raw || null;
  if (String(v[f] ?? "") === String(val ?? "")) return;
  const patch = { [f]: val };
  if (f === "status" && val !== "opgemaakt" && (v.bedrag_excl == null || v.bedrag_excl === "")) patch.bedrag_excl = Math.round(vordCalc(v).excl * 100) / 100; // bevriezen op het berekende bedrag
  await dbUpdate("vorderingen", vid, patch).catch(() => { });
}
/* gegevens voor het tabblad VORDERINGSSTAAT in de Excel-export (klantversie: bevroren bedragen, geen kostprijzen) */
function vordExportData(p) {
  const vs = vordOf(p.id); if (!vs.length) return null;
  const basis = lotBasis(p.id); const lots = Object.keys(basis).map(Number).sort((a, b) => a - b); const calcs = {}; vs.forEach(v => calcs[v.id] = vordCalc(v));
  const list = vs.map(v => { const c = calcs[v.id]; const excl = vordBedrag(v, c); const btw = c.excl ? excl * (c.btw / c.excl) : c.btw;
    return { nr: v.nr, soort: v.soort, datum: fmtLong(v.datum), omschrijving: v.omschrijving || VORD_SOORT[v.soort], factuurnummer: v.factuurnummer || "", loten: v.soort === "voorschot" ? "alle loten" : Object.keys(c.perLot).filter(l => Math.abs(c.perLot[l].excl) > 0.005).map(l => lotName(Number(l))).join(", "), excl: Math.round(excl * 100) / 100, btw: Math.round(btw * 100) / 100, incl: Math.round((excl + btw) * 100) / 100, status: VORD_STATUS[v.status] || v.status }; });
  const loten = [];
  ["vordering", "meerwerk"].forEach(soort => lots.forEach(l => { const base = vordBase(basis, l, soort); if (Math.abs(base) < 0.005) return;
    loten.push({ naam: lotName(l), basis: base, meerwerk: soort === "meerwerk", pcts: vs.map(v => (v.soort === "meerwerk") !== (soort === "meerwerk") ? null : (calcs[v.id].perLot[l] ? calcs[v.id].perLot[l].excl / base : null)) });
    vordRows(p.id, soort).filter(r => r.lot === l).forEach(r => loten.push({ naam: "   " + r.code + " " + r.omschrijving + (r.locatie ? " · " + r.locatie : ""), basis: rowSigned(r), meerwerk: soort === "meerwerk", post: true, pcts: vs.map(v => (v.soort === "meerwerk") !== (soort === "meerwerk") ? null : (calcs[v.id].perPost[r.id]?.pct ?? null)) })); }));
  return { list, loten, contract: lots.reduce((s, l) => s + basis[l].offerte, 0), meerwerk: lots.reduce((s, l) => s + basis[l].meerwerk, 0) };
}
async function vordDel(vid) {
  const v = S.vorderingen[vid]; if (!v || vordLocked(v) || !confirm(`${VORD_SOORT[v.soort]} ${v.nr ? "#" + v.nr : ""} verwijderen?`)) return;
  Object.values(S.vordering_regels).filter(r => r.vordering_id === vid).forEach(r => delete S.vordering_regels[rowKey("vordering_regels", r)]);
  await dbDelete("vorderingen", vid).catch(() => { });
}

/* export naar het Excel-sjabloon in de projectmap (Documenten/Meetstaat) */
let templateCache = null; // { name, bytes } — sjabloon één keer per sessie ophalen
async function exportMeetstaat(p) {
  if (!driveReady()) throw new Error("Drive-koppeling niet ingesteld (Instellingen → Drive).");
  if (!p.drive_folder_id) throw new Error("Dit project heeft nog geen Drive-map (Dossier → map koppelen of aanmaken).");
  if (!window.JSZip || !window.MeetstaatExport) throw new Error("Exportmodule niet geladen — herlaad de pagina.");
  loader.start("ms.export", "Sjabloon ophalen…", 9000);
  if (!templateCache) { const j = await driveCall("template", { match: "MEETSTAAT" }); const bin = atob(j.base64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); templateCache = { name: j.name, bytes }; }
  loader.step("Meetstaat opbouwen…");
  const rows = msRows(p.id).filter(msTelt).map(r => ({ lot: r.lot, groep: r.groep, omschrijving: r.omschrijving, locatie: r.locatie, artikelnr: r.artikelnr, hoeveelheid: Number(r.hoeveelheid) || 0, eenheid: r.eenheid, prijs: Math.round(msVerkoopEP(r) * 100) / 100, btw: Number(r.btw) || 0, status: r.status }));
  const { bytes } = await window.MeetstaatExport.build(templateCache.bytes, { project: p, rows, titel: "MEETSTAAT", date: new Date(), vorderingen: vordExportData(p) });
  loader.step("Wegschrijven in Documenten/Meetstaat…");
  let b64 = ""; for (let i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); b64 = btoa(b64);
  const name = `MEETSTAAT ${(p.klant || "").toUpperCase()}.xlsx`;
  // nieuwe versie komt in Documenten/Meetstaat/DEF; de vorige versie verhuist naar Documenten/Meetstaat met haar datum in de naam (logboek)
  const j = await driveCall("put", { folderId: p.drive_folder_id, subpath: "Documenten/Meetstaat/DEF", archiveTo: "Documenten/Meetstaat", name, base64: b64 });
  const f = j.file; const now = new Date().toISOString();
  const docs = [{ project_id: p.id, drive_id: f.id, naam: f.name, pad: f.path || "Documenten/Meetstaat/DEF", url: f.url, mime: f.mime || "", grootte: f.size || null, gewijzigd: f.updated || null, gesynct_op: now }]
    .concat((j.archived || []).map(a => ({ project_id: p.id, drive_id: a.id, naam: a.name, pad: a.path || "Documenten/Meetstaat", url: a.url, mime: a.mime || "", grootte: a.size || null, gewijzigd: a.updated || null, gesynct_op: now })));
  const { data } = await sb.from("documenten").upsert(docs, { onConflict: "project_id,drive_id" }).select(); (data || []).forEach(d => S.documenten[d.id] = d);
  loader.done("ms.export"); render(); toast(j.archived && j.archived.length ? `Nieuwe versie bewaard in DEF · vorige versie gearchiveerd als "${j.archived[0].name}"` : `Meetstaat bewaard: ${f.name}`);
  window.open(f.url, "_blank", "noopener");
}
/* bibliotheek beheren (Instellingen) */
function vPostenBeheer() {
  if (!msReady()) return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h3>Postenbibliotheek meetstaat</h3></div><div class="empty">Voer eerst <code>sql/007_meetstaat.sql</code> uit in Supabase.</div></div>`;
  const ls = lotenList(); if (S.selLot == null || !S.loten[S.selLot]) S.selLot = ls[0]?.nr;
  const l = S.loten[S.selLot]; const ps = Object.values(S.posten).filter(x => x.lot === S.selLot).sort((a, b) => a.volgorde - b.volgorde);
  return `<div class="grid two" style="grid-template-columns: 1fr 2fr;margin-bottom:16px">
    <div class="panel"><div class="panel-head"><h3>Loten meetstaat</h3></div>
      <div class="tw"><table class="t"><thead><tr><th></th><th>Lot</th><th class="r" title="Standaardmarge op de kostprijs">Marge</th><th></th></tr></thead><tbody>${ls.map(x => `<tr class="click ${x.nr === S.selLot ? "sel" : ""}" data-sellot="${x.nr}"><td class="num" style="width:36px;color:var(--muted)">${x.nr}</td><td>${esc(x.naam)}<small class="muted" style="display:block">${postenOf(x.nr).filter(p => p.standaard_aan).length} standaard · ${postenOf(x.nr).length} posten${x.buildwise ? " · BBW " + esc(x.buildwise) : ""}</small></td><td class="r" style="width:90px;white-space:nowrap"><input class="inline num" style="width:52px;text-align:right" data-lot="${x.nr}" data-f="marge" type="number" step="1" value="${Math.round((Number(x.marge) || 0) * 100)}" aria-label="Marge %"> %</td><td style="width:40px"><input type="checkbox" data-lot="${x.nr}" data-f="standaard_aan" ${x.standaard_aan ? "checked" : ""} title="Standaard aan bij nieuw project"></td></tr>`).join("")}</tbody></table></div>
      <div class="panel-body muted" style="font-size:12px;border-top:1px solid var(--line)">Marge = standaardopslag op de kostprijs voor alle posten van het lot (per post te overschrijven in de meetstaat). Vinkje = lot staat standaard aangevinkt bij "+ Lot toevoegen".</div></div>
    <div class="panel"><div class="panel-head"><h3>${l ? esc(lotName(l.nr)) : "Posten"}</h3>${l ? `<button class="btn sm primary" data-act="post-new" data-lot="${l.nr}">+ Post</button>` : ""}</div>
      ${ps.length ? `<div class="tw"><table class="t"><thead><tr><th title="Standaard aan">Std</th><th>Groep</th><th>Omschrijving</th><th>Eenh.</th><th class="r">Richtprijs</th><th>Btw</th><th title="Actief">Act.</th><th></th></tr></thead><tbody>${ps.map(x => `<tr class="${x.actief === false ? "ms-dead" : ""}"><td style="width:32px"><input type="checkbox" data-post="${x.id}" data-f="standaard_aan" ${x.standaard_aan ? "checked" : ""}></td><td style="width:130px"><input class="inline" data-post="${x.id}" data-f="groep" value="${esc(x.groep || "")}"></td><td><input class="inline wide" data-post="${x.id}" data-f="omschrijving" value="${esc(x.omschrijving)}"></td><td style="width:84px"><select class="inline" data-post="${x.id}" data-f="eenheid">${opts(EENHEDEN.map(e => [e, e]), x.eenheid)}</select></td><td style="width:100px"><input class="inline num" data-post="${x.id}" data-f="richtprijs" type="number" step="any" value="${x.richtprijs == null ? "" : Number(x.richtprijs)}" title="${x.n ? `mediaan uit ${x.n} waarneming(en), ${eur2(x.prijs_min)} – ${eur2(x.prijs_max)}` : "nog geen data"}"></td><td style="width:78px"><select class="inline" data-post="${x.id}" data-f="btw">${opts([[0.06, "6 %"], [0.21, "21 %"], [0, "0 %"]], Number(x.btw))}</select></td><td style="width:32px"><input type="checkbox" data-post="${x.id}" data-f="actief" ${x.actief !== false ? "checked" : ""}></td><td class="r" style="width:36px"><button class="btn ghost sm danger" data-act="post-del" data-id="${x.id}" aria-label="Verwijderen">✕</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><b>Geen posten in dit lot</b>Voeg er een toe.</div>`}
      <div class="panel-body muted" style="font-size:12px;border-top:1px solid var(--line)">Std = komt standaard mee bij "+ Lot toevoegen". Act. uit = blijft bewaard maar verschijnt niet meer in de keuzelijst. Richtprijs = kostprijs excl. btw die als startwaarde in nieuwe meetstaten komt.</div></div></div>`;
}
async function postEdit(id, f, raw, checked) {
  const x = S.posten[id]; if (!x) return; let v = raw;
  if (f === "standaard_aan" || f === "actief") v = !!checked;
  else if (f === "richtprijs") v = raw === "" ? null : Number(String(raw).replace(",", "."));
  else if (f === "btw") v = Number(raw);
  if (String(x[f] ?? "") === String(v ?? "")) return;
  await dbUpdate("posten", id, { [f]: v, updated_at: new Date().toISOString() }).catch(() => { });
}
async function lotEdit(nr, f, raw, checked) {
  const l = S.loten[nr]; if (!l) return; const v = f === "marge" ? (Number(String(raw).replace(",", ".")) || 0) / 100 : !!checked;
  if (String(l[f] ?? "") === String(v)) return;
  await dbUpdate("loten", nr, { [f]: v }).catch(() => { });
}
async function postAdd(lot) {
  const oms = prompt("Omschrijving van de nieuwe post:"); if (!oms || !oms.trim()) return;
  const volgorde = Math.max(0, ...postenOf(lot).map(x => x.volgorde)) + 1; const code = `${String(lot).padStart(2, "0")}.${String(postenOf(lot).length + 1).padStart(2, "0")}`;
  await dbInsert("posten", { code, lot, omschrijving: oms.trim(), eenheid: "stk", prijstype: "EP", btw: 0.06, standaard_aan: false, actief: true, volgorde }).catch(() => { }); toast("Post toegevoegd");
}
async function postDel(id) {
  const x = S.posten[id]; if (!x || !confirm(`"${x.omschrijving}" verwijderen uit de bibliotheek? (Bestaande meetstaten behouden hun regels.)`)) return;
  await dbDelete("posten", id).catch(() => { });
}
const docIcon = (m, n) => /spreadsheet|excel/.test(m) ? "xls" : /word|document/.test(m) ? "doc" : /pdf/.test(m) ? "pdf" : /skp|sketchup|vwx|dwg|dxf/i.test(n) ? "dwg" : "map";

/* ---------- render root ---------- */
const TABS = [["overzicht", "Overzicht"], ["projecten", "Projecten"], ["taken", "Taken"], ["planning", "Planning"], ["uren", "Uren"], ["team", "Team"], ["rapporten", "Rapporten"], ["instellingen", "Instellingen", "beheer"]];
function render() {
  const app = $("#app");
  if (!configured) { app.innerHTML = `<div class="login"><div class="card"><h1>BROS Planbord</h1><p>De app is nog niet gekoppeld aan de database. Vul <code>config.js</code> in (Project URL en anon public-sleutel uit Supabase) en herlaad.</p></div></div>`; return; }
  if (!S.session) { renderLogin(); return; }
  if (S.loadError) { app.innerHTML = `<div class="login"><div class="card"><h1>Kon de gegevens niet laden</h1><p class="err">${esc(S.loadError)}</p><button class="btn" data-act="logout">Uitloggen</button> <button class="btn primary" data-act="reload">Opnieuw proberen</button></div></div>`; return; }
  if (!S.ready) { app.innerHTML = `<div class="login"><div class="card"><h1>BROS Planbord</h1><p>Gegevens laden…</p></div></div>`; return; }
  if (!S.me) { app.innerHTML = `<div class="login"><div class="card"><h1>Nog geen profiel</h1><p>Je login werkt, maar er is nog geen medewerkersprofiel gekoppeld. Vraag de beheerder om je uit te nodigen, of herlaad de pagina.</p><button class="btn" data-act="logout">Uitloggen</button> <button class="btn primary" data-act="reload">Herladen</button></div></div>`; return; }
  const views = { overzicht: vOverzicht, projecten: vProjecten, taken: vTaken, planning: vPlanning, uren: vUren, team: vTeam, rapporten: vRapporten, instellingen: vInstellingen };
  app.innerHTML = `
  <header class="top">
    <div class="top-in">
      <div class="brand"><span class="mark">BROS</span><span class="name">Planbord</span></div>
      <nav class="tabs" aria-label="Hoofdnavigatie">${TABS.filter(([, , r]) => !r || isBeheer()).map(([k, l]) => `<button data-nav="${k}" ${S.view === k ? 'aria-current="page"' : ""}>${l}</button>`).join("")}</nav>
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
  <div style="margin-top:16px">${ganttHtml(ps.filter(p => p.status !== "afgerond" && p.status !== "verloren"), { compact: true, title: "Timing alle projecten" })}</div>`;
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
  const beheer = isBeheer();
  const ps = projects().filter(p => !S.filters.status || p.status === S.filters.status).map(p => { const ts = tasksOf(p.id); const [st, en] = projSpan(p); return { p, ts, pl: projPlanned(p.id), dn: projDone(p.id), st, en }; });
  const STATUS_ORDER = { offerte: 0, lopend: 1, on_hold: 2, afgerond: 3, verloren: 4 };
  const val = (r, k) => ({ nummer: r.p.nummer || "", klant: (r.p.klant || "").toLowerCase(), status: STATUS_ORDER[r.p.status] ?? 9, fase: r.p.fase_nr || 0, lead: userById(r.p.lead).name.toLowerCase(), timing: r.st || "9999", forfait: Number(r.p.forfait) || 0, taken: r.ts.length, uren: r.dn })[k];
  const { key, dir } = S.sort; const m = dir === "asc" ? 1 : -1;
  ps.sort((a, b) => { const x = val(a, key), y = val(b, key); return (x < y ? -1 : x > y ? 1 : 0) * m || (a.p.klant || "").localeCompare(b.p.klant || ""); });
  const th = (k, label, cls = "") => `<th class="sortable ${cls} ${key === k ? "on" : ""}" data-sort="${k}">${label}<span class="arrow">${key === k ? (dir === "asc" ? "↑" : "↓") : ""}</span></th>`;
  return `
  <div class="page-head"><div><div class="eyebrow">${ps.length} projecten</div><h1>Projecten</h1></div>
    <div class="actions"><select data-filter="status"><option value="">Alle statussen</option>${Object.entries(PROJ_STATUS).map(([k, v]) => `<option value="${k}" ${S.filters.status === k ? "selected" : ""}>${v}</option>`).join("")}</select>${beheer ? `<button class="btn primary" data-act="new-project">+ Nieuw project</button>` : ""}</div></div>
  <div class="panel tw"><table class="t"><thead><tr>${th("nummer", "Nr")}${th("klant", "Klant · project")}${th("status", "Status")}${th("fase", "Fase")}${th("lead", "Lead")}${th("timing", "Timing")}${beheer ? th("forfait", "Forfait", "r") : ""}${th("taken", "Taken", "r")}<th class="sortable ${key === "uren" ? "on" : ""}" data-sort="uren" style="min-width:140px">Uren<span class="arrow">${key === "uren" ? (dir === "asc" ? "↑" : "↓") : ""}</span></th></tr></thead><tbody>
  ${ps.map(({ p, ts, pl, dn, st, en }) => `<tr class="click" data-open="${p.id}">
    <td class="num muted">${esc(p.nummer || "")}</td>
    <td><div class="row-title">${esc(p.klant)}${p.drive_url ? ` <a class="drive-ico" href="${esc(p.drive_url)}" target="_blank" rel="noopener" title="Projectmap openen in Google Drive">📁</a>` : ""}<small>${KLANTCODE[p.klanttype] || ""}${p.naam && p.naam !== p.klant ? " · " + esc(p.naam) : ""}${p.gemeente ? " · " + esc(p.gemeente) : ""}</small></div></td>
    <td><span class="pill st-${p.status}">${PROJ_STATUS[p.status] || p.status}</span></td>
    <td><span class="pill phase">${esc(faseName(p.fase_nr) || "—")}</span></td>
    <td>${p.lead ? avatar(p.lead) : "—"}</td>
    <td class="num">${fmt(st)} → ${fmt(en)}</td>
    ${beheer ? `<td class="r num">${eur(p.forfait)}</td>` : ""}
    <td class="r num">${ts.filter(t => t.status === "done").length}/${ts.length}</td>
    <td><div class="num" style="font-size:12px;margin-bottom:3px">${nl(dn)} / ${nl(pl)} u</div><div class="bar"><i class="${dn > pl && pl ? "over" : ""}" style="width:${pl ? Math.min(dn / pl, 1) * 100 : 0}%"></i></div></td></tr>`).join("") || `<tr><td colspan="9"><div class="empty"><b>Nog geen projecten</b>${beheer ? "Maak het eerste project aan met de knop rechtsboven." : "De beheerder maakt projecten aan."}</div></td></tr>`}
  </tbody></table></div>`;
}
function vProjectDetail(p) {
  const ts = tasksOf(p.id), pl = projPlanned(p.id), dn = projDone(p.id);
  const [st, en] = projSpan(p);
  const tabs = [["taken", "Taken"], ["meetstaat", "Meetstaat"], ["facturatie", "Facturatie"], ["planning", "Planning"], ["uren", "Uren"], ["dossier", "Dossier"]];
  let body = "";
  if (S.ptab === "taken") {
    const byFase = {}; ts.forEach(t => { (byFase[t.fase_nr || 0] = byFase[t.fase_nr || 0] || []).push(t); });
    const groups = Object.keys(byFase).map(Number).sort((a, b) => a - b);
    body = `<div class="panel"><div class="panel-head"><h3>Taken</h3><div class="actions"><button class="btn sm" data-act="add-fase" data-pid="${p.id}">+ Fase toevoegen</button><button class="btn sm primary" data-act="new-task" data-pid="${p.id}">+ Taak</button></div></div>
      ${ts.length ? `<div class="tw"><table class="t"><thead><tr><th></th><th>Taak</th><th>Wie</th><th>Start</th><th>Einde</th><th class="r">Uren</th><th>Status</th></tr></thead><tbody>
      ${groups.map(nr => { const g = byFase[nr]; const done = g.filter(t => t.status === "done").length; return `<tr><td colspan="7" style="background:var(--surface-2);font-weight:700;font-family:var(--font-display)">${esc(faseName(nr) || "Zonder fase")} <span class="muted num" style="font-weight:400">${done}/${g.length}</span></td></tr>` + g.map(t => `<tr class="click" data-edit-task="${t.id}"><td style="width:28px"><input type="checkbox" class="task-check" data-toggle="${t.id}" ${t.status === "done" ? "checked" : ""} aria-label="Klaar"></td>
        <td><div class="row-title">${esc(t.titel)}${t.notitie ? `<small>${esc(t.notitie)}</small>` : ""}</div></td><td><span class="who-cell">${t.assignee ? avatar(t.assignee) : ""}${esc(userById(t.assignee).name)}</span></td>
        <td class="num">${fmt(t.start)}</td><td class="num" style="color:${isLate(t) ? "var(--crit)" : "inherit"}">${fmt(t.eind)}</td><td class="r num">${nl(taskDone(t.id))} / ${nl(t.uren_gepland)}</td><td>${pill(t)}</td></tr>`).join(""); }).join("")}</tbody></table></div>` : `<div class="empty"><b>Nog geen taken</b>Voeg een fase toe (met de standaardtaken) of maak een losse taak.</div>`}</div>`;
  } else if (S.ptab === "meetstaat") {
    body = vMeetstaat(p);
  } else if (S.ptab === "facturatie") {
    body = vFacturatie(p);
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
    const map = p.drive_map || ("PROJECTEN/" + (p.klant || ""));
    const docs = docsOf(p.id); const groups = [...new Set(docs.map(d => d.pad || ""))];
    body = `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Projectmap op Google Drive</h3><div class="muted" style="font-size:12px;margin-top:2px"><span class="drive-path">${esc(map)}</span></div></div>
      <div class="actions">${p.drive_url ? `<a class="btn" href="${esc(p.drive_url)}" target="_blank" rel="noopener">Open map in Drive ↗</a><button class="btn sm" data-act="drive-list" data-pid="${p.id}">Vernieuwen</button>` : driveReady() ? `<button class="btn sm" data-act="drive-link" data-pid="${p.id}">Bestaande map koppelen</button><button class="btn sm primary" data-act="drive-create" data-pid="${p.id}">Map aanmaken uit sjabloon</button>` : `<span class="pill st-offerte">Drive-koppeling nog niet ingesteld</span>`}</div></div>
      ${docs.length ? `<div class="panel-body"><div class="docs">${groups.map(g => `${g ? `<div style="grid-column:1/-1" class="eyebrow">${esc(g)}</div>` : ""}${docs.filter(d => (d.pad || "") === g).map(d => `<a class="doc" href="${esc(d.url)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit"><div class="ico ${docIcon(d.mime, d.naam)}">${docIcon(d.mime, d.naam) === "map" ? "DOC" : docIcon(d.mime, d.naam).toUpperCase()}</div><div style="min-width:0"><div class="n" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.naam)}</div><div class="s">${d.gewijzigd ? "gewijzigd " + fmtLong(d.gewijzigd.slice(0, 10)) : ""}</div></div></a>`).join("")}`).join("")}</div>
        <p class="muted" style="font-size:12px;margin:12px 0 0">Laatst gesynchroniseerd ${docs[0].gesynct_op ? fmtLong(docs[0].gesynct_op.slice(0, 10)) : "—"}. Nieuwe bestanden in Drive verschijnen hier na "Vernieuwen"; foto's en video's worden niet opgesomd (die open je via de map).</p></div>` : `<div class="empty">${p.drive_url ? "Nog geen bestanden gevonden — klik op Vernieuwen." : "Nog geen map gekoppeld. \"Bestaande map koppelen\" zoekt in PROJECTEN naar een map met de naam uit het veld Drive-map (of de klantnaam)."}</div>`}</div>
      <div class="panel"><div class="panel-head"><h3>Gegevens</h3></div>
      <div class="panel-body"><div class="meta">
        <div><div class="k">Adres werf</div><div class="v">${esc(p.adres || "—")}${(p.postcode || p.gemeente) ? ", " + esc([p.postcode, p.gemeente].filter(Boolean).join(" ")) : ""}</div></div>
        <div><div class="k">Contact</div><div class="v">${esc(p.contact || "—")}${p.gsm1 ? " · " + esc(p.gsm1) : ""}${p.gsm2 ? " · " + esc(p.gsm2) : ""}</div></div>
        <div><div class="k">Type klant</div><div class="v">${KLANTTYPE[p.klanttype] || "—"}${p.btw_tarief ? ` · btw ${p.btw_tarief} %` : ""}</div></div>
        <div><div class="k">Bron</div><div class="v">${esc(p.bron || "—")}</div></div>
        <div><div class="k">Oppervlakte</div><div class="v num">${p.oppervlakte_m2 ? nl(p.oppervlakte_m2) + " m²" : "—"}</div></div>
        <div><div class="k">Offerte / contract / opgeleverd</div><div class="v num">${fmtLong(p.offerte_datum)} · ${fmtLong(p.contract_datum)} · ${fmtLong(p.opgeleverd_op)}</div></div>
        ${p.status === "verloren" ? `<div><div class="k">Reden verloren</div><div class="v">${esc(p.verloren_reden || "—")}</div></div>` : ""}
        ${p.tags ? `<div><div class="k">Tags</div><div class="v">${esc(p.tags)}</div></div>` : ""}
        <div><div class="k">Facturatie naar</div><div class="v">${[p.factuur_email1 && p.email1, p.factuur_email2 && p.email2].filter(Boolean).map(esc).join(", ") || "—"}</div></div>
        <div style="grid-column:1/-1"><div class="k">Notities</div><div class="v" style="white-space:pre-wrap">${esc(p.notities || "—")}</div></div>
      </div></div></div>`;
  }
  return `
  <div class="crumb"><button data-back="1">Projecten</button><span>›</span><span>${esc(p.klant)}</span></div>
  <div class="page-head"><div>${projCode(p) ? `<div class="eyebrow">${esc(projCode(p))}${p.projecttype ? " · " + esc(p.projecttype) : ""}</div>` : ""}<h1>${esc(projName(p))}</h1><div class="sub">${esc(p.adres || "")}${(p.postcode || p.gemeente) ? (p.adres ? ", " : "") + esc([p.postcode, p.gemeente].filter(Boolean).join(" ")) : ""}</div></div>
    <div class="actions"><span class="pill st-${p.status}">${PROJ_STATUS[p.status] || p.status}</span>${p.drive_url ? `<a class="btn" href="${esc(p.drive_url)}" target="_blank" rel="noopener" title="Projectmap openen in Google Drive">📁 Drive-map ↗</a>` : (driveReady() ? `<button class="btn" data-act="drive-link" data-pid="${p.id}" title="Bestaande map op Drive koppelen of zoeken">📁 Drive-map koppelen</button>` : "")}${isBeheer() ? `<button class="btn" data-act="edit-project" data-pid="${p.id}">Bewerken</button>` : ""}<button class="btn" data-act="log-hours" data-pid="${p.id}">+ Uren</button>${msReady() ? `<button class="btn" data-act="ms-open" data-pid="${p.id}" title="${msRows(p.id).length ? "Meetstaat openen" : "Meetstaat aanmaken: loten en posten kiezen"}">${msRows(p.id).length ? "Meetstaat" : "+ Meetstaat"}</button>` : ""}<button class="btn primary" data-act="new-task" data-pid="${p.id}">+ Taak</button></div></div>
  <div class="panel" style="margin-bottom:16px"><div class="panel-body meta">
    <div><div class="k">Fase</div><div class="v">${esc(faseName(p.fase_nr) || "—")}</div></div>
    <div><div class="k">Lead</div><div class="v"><span class="who-cell">${p.lead ? avatar(p.lead) : ""}${esc(userById(p.lead).name)}</span></div></div>
    <div><div class="k">Timing</div><div class="v num">${fmtLong(st)} → ${fmtLong(en)}</div></div>
    ${isBeheer() ? `<div><div class="k">Forfait</div><div class="v num">${eur(p.forfait)}</div></div>` : ""}
    <div><div class="k">Uren</div><div class="v num">${nl(dn)} / ${nl(pl)} u</div></div>
    <div><div class="k">Taken</div><div class="v num">${ts.filter(t => t.status === "done").length} / ${ts.length} klaar</div></div>
    ${p.klanttype === "zakelijk" ? `<div><div class="k">Bedrijf</div><div class="v">${esc(p.bedrijf || "—")}${p.btw_nummer ? `<br><span class="num">${esc(p.btw_nummer)}</span>` : ""}</div></div>` : ""}
    <div><div class="k">Contact</div><div class="v">${esc(p.contact || "—")}${p.gsm1 ? `<br><a href="tel:${esc(p.gsm1)}">${esc(p.gsm1)}</a>` : ""}${p.gsm2 ? ` · <a href="tel:${esc(p.gsm2)}">${esc(p.gsm2)}</a>` : ""}</div></div>
    <div><div class="k">E-mail</div><div class="v">${[["email1", "factuur_email1"], ["email2", "factuur_email2"]].filter(([e]) => p[e]).map(([e, f]) => `<a href="mailto:${esc(p[e])}">${esc(p[e])}</a>${p[f] ? ` <span class="pill st-offerte" style="font-size:10px">facturatie</span>` : ""}`).join("<br>") || "—"}</div></div>
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
  const ps = projects().filter(p => p.status !== "afgerond" && p.status !== "verloren" && (!S.filters.project || p.id === S.filters.project));
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
  const head = ["Datum", "Week", "Medewerker", "Projectnummer", "Klant", "Project", "Fase", "Taak", "Uren", "Notitie"];
  const lines = [head.join(";")].concat(rows.map(h => { const p = S.projecten[h.project_id] || {}, t = S.taken[h.taak_id] || {}; return [fmtLong(h.datum), weekNr(h.datum), userById(h.user_id).name, p.nummer || "", p.klant || "", p.naam || "", faseShort(t.fase_nr), t.titel || "", String(h.uren).replace(".", ","), (h.notitie || "").replace(/[;\r\n]/g, " ")].map(v => `"${String(v).replace(/"/g, '""')}"`).join(";"); }));
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



/* ---------- Rapporten ---------- */
function vRapporten() {
  const jaar = S.rapJaar || todayIso.slice(0, 4);
  const jaren = [...new Set([todayIso.slice(0, 4), ...Object.values(S.uren).map(h => h.datum.slice(0, 4)), ...Object.values(S.projecten).map(p => (p.created_at || "").slice(0, 4)).filter(Boolean)])].sort().reverse();
  const ps = projects(); const beheer = isBeheer();
  const inJaar = (d) => d && d.slice(0, 4) === jaar;
  const won = ps.filter(p => ["lopend", "afgerond"].includes(p.status)), lost = ps.filter(p => p.status === "verloren"), off = ps.filter(p => p.status === "offerte"), lopend = ps.filter(p => p.status === "lopend");
  const conv = won.length + lost.length ? Math.round(won.length / (won.length + lost.length) * 100) : null;
  const urenJaar = hoursOf(h => inJaar(h.datum));
  const sum = (arr, f) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
  // per project
  const rows = ps.filter(p => p.status !== "verloren").map(p => { const d = projDone(p.id), g = projPlanned(p.id), ki = beheer ? projKost(p.id, "intern") : 0, ke = beheer ? projKost(p.id, "extern") : 0, f = Number(p.forfait) || 0, m2 = Number(p.oppervlakte_m2) || 0; return { p, d, g, ki, ke, f, m2, marge: f && beheer ? f - ki : null }; });
  // per fase
  const perFase = fasenList().map(f => { const ts = Object.values(S.taken).filter(t => t.fase_nr === f.nr && S.projecten[t.project_id]?.status !== "verloren"); const ids = new Set(ts.map(t => t.id)); return { f, g: sum(ts, t => t.uren_gepland), d: hoursOf(h => ids.has(h.taak_id)) }; }).filter(x => x.g || x.d);
  const maxFase = Math.max(1, ...perFase.map(x => Math.max(x.g, x.d)));
  // bron
  const bronnen = [...new Set(ps.map(p => p.bron || "(onbekend)"))].sort();
  const perBron = bronnen.map(b => { const g = ps.filter(p => (p.bron || "(onbekend)") === b); return { b, n: g.length, won: g.filter(p => ["lopend", "afgerond"].includes(p.status)).length, lost: g.filter(p => p.status === "verloren").length, off: g.filter(p => p.status === "offerte").length, forfait: sum(g.filter(p => p.status !== "verloren"), p => p.forfait) }; });
  // per medewerker per maand
  const us = users(); const maanden = Array.from({ length: 12 }, (_, i) => i);
  const cell = (u, m) => hoursOf(h => h.user_id === u.id && inJaar(h.datum) && Number(h.datum.slice(5, 7)) === m + 1);
  // doorlooptijden
  const dl = (a, b) => { const v = ps.filter(p => p[a] && p[b]).map(p => diffDays(p[a], p[b])).filter(x => x >= 0); return v.length ? { avg: Math.round(v.reduce((x, y) => x + y, 0) / v.length), n: v.length } : null; };
  const d1 = dl("offerte_datum", "contract_datum"), d2 = dl("contract_datum", "opgeleverd_op"), d3 = dl("start", "opgeleverd_op");
  const money = (n) => beheer ? eur(n) : "";
  return `
  <div class="page-head"><div><div class="eyebrow">Rapporten</div><h1>Cijfers</h1><div class="sub">Live berekend uit projecten, taken en uren${beheer ? "" : " — bedragen zijn enkel zichtbaar voor beheer"}.</div></div>
    <div class="actions"><select data-rapjaar>${jaren.map(j => `<option ${j === jaar ? "selected" : ""}>${j}</option>`).join("")}</select>${beheer ? `<button class="btn" data-act="export-projects">Projecten exporteren</button>` : ""}<button class="btn" data-act="export-hours">Uren exporteren</button></div></div>
  <div class="grid kpi" style="margin-bottom:16px">
    <div class="panel kpi-tile"><div class="eyebrow">Lopend</div><div class="v">${lopend.length}</div><div class="d">${beheer ? "forfait " + eur(sum(lopend, p => p.forfait)) : "projecten in uitvoering"}</div></div>
    <div class="panel kpi-tile"><div class="eyebrow">In offerte</div><div class="v">${off.length}</div><div class="d">${beheer ? "forfait " + eur(sum(off, p => p.forfait)) : "offertes open"}</div></div>
    <div class="panel kpi-tile"><div class="eyebrow">Conversie</div><div class="v">${conv == null ? "—" : conv + "<small>%</small>"}</div><div class="d">${won.length} gewonnen · ${lost.length} verloren</div></div>
    <div class="panel kpi-tile"><div class="eyebrow">Uren ${jaar}</div><div class="v">${nl(urenJaar, 0)}<small>u</small></div><div class="d">${beheer ? "interne kost " + eur(Object.values(S.uren).filter(h => inJaar(h.datum)).reduce((a, h) => a + kost(h.user_id, Number(h.uren) || 0, "intern"), 0)) : "geregistreerd door het team"}</div></div>
  </div>
  <div class="panel" style="margin-bottom:16px"><div class="panel-head"><h3>Per project</h3><span class="muted" style="font-size:12px">zonder verloren offertes</span></div>
    <div class="tw"><table class="t"><thead><tr><th>Nr</th><th>Klant</th><th>Type</th><th>Status</th><th class="r">m²</th>${beheer ? `<th class="r">Forfait</th>` : ""}<th class="r">Uren</th>${beheer ? `<th class="r">Interne kost</th><th class="r">Marge</th><th class="r">€/m²</th>` : ""}<th class="r">u/m²</th></tr></thead><tbody>
    ${rows.map(r => `<tr class="click" data-open="${r.p.id}"><td class="num">${esc(r.p.nummer || "")}</td><td>${esc(r.p.klant)}</td><td class="muted">${esc(r.p.projecttype || "")}</td><td><span class="pill st-${r.p.status}">${PROJ_STATUS[r.p.status]}</span></td><td class="r num">${r.m2 ? nl(r.m2, 0) : "—"}</td>${beheer ? `<td class="r num">${eur(r.p.forfait)}</td>` : ""}<td class="r num">${nl(r.d)} / ${nl(r.g)}</td>${beheer ? `<td class="r num">${eur(r.ki)}</td><td class="r num" style="color:${r.marge == null ? "inherit" : r.marge < 0 ? "var(--crit)" : "var(--ok)"}">${r.marge == null ? "—" : eur(r.marge)}</td><td class="r num">${r.m2 && r.f ? eur(r.f / r.m2) : "—"}</td>` : ""}<td class="r num">${r.m2 && r.d ? nl(r.d / r.m2, 2) : "—"}</td></tr>`).join("") || `<tr><td colspan="11" class="muted">Nog geen projecten.</td></tr>`}
    ${rows.length ? `<tr><td colspan="4"><b>Totaal</b></td><td class="r num"><b>${nl(sum(rows, r => r.m2), 0)}</b></td>${beheer ? `<td class="r num"><b>${eur(sum(rows, r => r.f))}</b></td>` : ""}<td class="r num"><b>${nl(sum(rows, r => r.d))} / ${nl(sum(rows, r => r.g))}</b></td>${beheer ? `<td class="r num"><b>${eur(sum(rows, r => r.ki))}</b></td><td class="r num"><b>${eur(sum(rows.filter(r => r.marge != null), r => r.marge))}</b></td><td></td>` : ""}<td></td></tr>` : ""}</tbody></table></div></div>
  <div class="grid two" style="margin-bottom:16px">
    <div class="panel"><div class="panel-head"><h3>Uren per fase</h3><span class="muted" style="font-size:12px">gepresteerd · gepland, alle projecten</span></div>
      ${perFase.length ? `<div class="tw"><table class="t"><tbody>${perFase.map(x => `<tr><td style="width:38%">${x.f.nr} · ${esc(x.f.naam)}</td><td style="width:42%"><div class="bar" style="height:8px"><i style="width:${Math.min(x.d / maxFase, 1) * 100}%"></i></div><div class="bar" style="height:4px;margin-top:2px"><i style="width:${Math.min(x.g / maxFase, 1) * 100}%;background:var(--line-2)"></i></div></td><td class="r num" style="white-space:nowrap">${nl(x.d)} · ${nl(x.g)} u</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">Nog geen uren of geplande uren.</div>`}</div>
    <div class="panel"><div class="panel-head"><h3>Waar komen klanten vandaan?</h3></div>
      <div class="tw"><table class="t"><thead><tr><th>Bron</th><th class="r">Projecten</th><th class="r">Gewonnen</th><th class="r">Verloren</th><th class="r">Offerte</th>${beheer ? `<th class="r">Forfait</th>` : ""}</tr></thead><tbody>${perBron.map(x => `<tr><td>${esc(x.b)}</td><td class="r num">${x.n}</td><td class="r num">${x.won}</td><td class="r num">${x.lost}</td><td class="r num">${x.off}</td>${beheer ? `<td class="r num">${eur(x.forfait)}</td>` : ""}</tr>`).join("") || `<tr><td class="muted">Nog geen projecten.</td></tr>`}</tbody></table></div>
      <div class="panel-body" style="border-top:1px solid var(--line)"><div class="eyebrow" style="margin-bottom:6px">Doorlooptijd (gemiddeld)</div><div class="meta">
        <div><div class="k">Offerte → contract</div><div class="v num">${d1 ? d1.avg + " dagen (" + d1.n + ")" : "—"}</div></div>
        <div><div class="k">Contract → oplevering</div><div class="v num">${d2 ? d2.avg + " dagen (" + d2.n + ")" : "—"}</div></div>
        <div><div class="k">Start → oplevering</div><div class="v num">${d3 ? d3.avg + " dagen (" + d3.n + ")" : "—"}</div></div></div></div></div>
  </div>
  <div class="panel"><div class="panel-head"><h3>Uren per medewerker per maand · ${jaar}</h3></div>
    <div class="tw"><table class="t"><thead><tr><th>Medewerker</th>${maanden.map(m => `<th class="r">${MONTHS[m]}</th>`).join("")}<th class="r">Totaal</th></tr></thead><tbody>
    ${us.map(u => { const vals = maanden.map(m => cell(u, m)); return `<tr><td><span class="who-cell">${avatar(u.id)}${esc(u.name)}</span></td>${vals.map(v => `<td class="r num" style="color:${v ? "inherit" : "var(--line-2)"}">${v ? nl(v, 0) : "·"}</td>`).join("")}<td class="r num"><b>${nl(vals.reduce((a, b) => a + b, 0), 0)}</b></td></tr>`; }).join("")}
    <tr><td><b>Team</b></td>${maanden.map(m => { const v = us.reduce((a, u) => a + cell(u, m), 0); return `<td class="r num"><b>${v ? nl(v, 0) : "·"}</b></td>`; }).join("")}<td class="r num"><b>${nl(urenJaar, 0)}</b></td></tr></tbody></table></div></div>`;
}
function exportProjects() {
  const fmtLong = (d) => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "";
  const head = ["Nummer", "Klant", "Type klant", "Bedrijf", "BTW-nummer", "Projectnaam", "Adres", "Postcode", "Gemeente", "Contact", "GSM 1", "GSM 2", "E-mail 1", "Factuur e-mail 1", "E-mail 2", "Factuur e-mail 2", "Status", "Fase", "Lead", "Type project", "Bron", "m²", "BTW-tarief", "Forfait", "Uren gepresteerd", "Uren gepland", "Interne kost", "Externe waarde", "Start", "Geplande oplevering", "Offerte", "Contract", "Opgeleverd", "Reden verloren", "Tags", "Drive-map"];
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`; const n = (v) => v == null || v === "" ? "" : String(v).replace(".", ",");
  const lines = [head.join(";")].concat(projects().map(p => [p.nummer, p.klant, KLANTTYPE[p.klanttype], p.bedrijf, p.btw_nummer, p.naam, p.adres, p.postcode, p.gemeente, p.contact, p.gsm1, p.gsm2, p.email1, p.factuur_email1 ? "ja" : "", p.email2, p.factuur_email2 ? "ja" : "", PROJ_STATUS[p.status], faseName(p.fase_nr), userById(p.lead).name, p.projecttype, p.bron, n(p.oppervlakte_m2), n(p.btw_tarief), n(p.forfait), n(projDone(p.id)), n(projPlanned(p.id)), n(Math.round(projKost(p.id, "intern"))), n(Math.round(projKost(p.id, "extern"))), fmtLong(p.start), fmtLong(p.eind), fmtLong(p.offerte_datum), fmtLong(p.contract_datum), fmtLong(p.opgeleverd_op), p.verloren_reden, p.tags, p.drive_map].map(q).join(";")));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `bros-projecten-${todayIso}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

/* ---------- Instellingen (beheer): fasen en standaardtaken ---------- */
function vInstellingen() {
  if (!isBeheer()) return `<div class="empty">Alleen voor beheerders.</div>`;
  const fs = Object.values(S.fasen).sort((a, b) => a.nr - b.nr);
  if (!S.selFase || !S.fasen[S.selFase]) S.selFase = fs[0]?.nr;
  const f = S.fasen[S.selFase]; const ts = S.standaardtaken.filter(t => t.fase_nr === S.selFase);
  return `
  <div class="page-head"><div><div class="eyebrow">Beheer</div><h1>Instellingen</h1><div class="sub">Drive-koppeling, postenbibliotheek voor meetstaten, fasen en standaardtaken. Wijzigingen gelden voor wat je hierna aanmaakt; bestaande projecten houden hun taken en meetstaatregels.</div></div></div>
  <div class="panel" style="margin-bottom:16px"><div class="panel-head"><h3>Drive-koppeling</h3><span class="pill ${driveReady() ? "st-afgerond" : "st-offerte"}">${driveReady() ? "ingesteld" : "niet ingesteld"}</span></div>
    <div class="panel-body"><div class="form-grid">
      <div class="field"><label for="dr_url">Web app-URL van het Drive-script</label><input id="dr_url" value="${esc(driveCfg().url || "")}" placeholder="https://script.google.com/macros/s/…/exec"></div>
      <div class="field"><label for="dr_secret">Secret (zelfde als in het script)</label><input id="dr_secret" type="password" value="${esc(driveCfg().secret || "")}"></div>
      <div class="field span2"><div class="actions"><button class="btn primary" data-act="drive-save">Bewaren</button><button class="btn" data-act="drive-test">Verbinding testen</button><span class="muted" style="font-size:12px">Het script staat in de map <code>drive/Code.gs</code>; de installatie staat bovenaan in dat bestand. Nieuwe projecten krijgen daarna automatisch hun map met de sjabloonbestanden.</span></div></div>
    </div></div></div>
  ${vPostenBeheer()}
  <div class="grid two" style="grid-template-columns: 1fr 1.4fr">
    <div class="panel"><div class="panel-head"><h3>Fasen</h3><button class="btn sm" data-act="fase-new">+ Fase</button></div>
      <div class="tw"><table class="t"><tbody>${fs.map(x => `<tr class="click ${x.nr === S.selFase ? "sel" : ""}" data-selfase="${x.nr}"><td class="num" style="width:40px;color:var(--muted)">${x.nr}</td><td><span style="${x.actief === false ? "color:var(--muted);text-decoration:line-through" : ""}">${esc(x.naam)}</span><small class="muted" style="display:block">${S.standaardtaken.filter(t => t.fase_nr === x.nr).length} taken${x.actief === false ? " · verborgen" : ""}</small></td><td class="r"><button class="btn ghost sm" data-act="fase-edit" data-nr="${x.nr}">Bewerken</button></td></tr>`).join("")}</tbody></table></div>
      <div class="panel-body muted" style="font-size:12px;border-top:1px solid var(--line)">Het nummer bepaalt de volgorde. Een fase die je niet meer gebruikt zet je op "verborgen" — verwijderen kan alleen als geen enkel project ernaar verwijst.</div></div>
    <div class="panel"><div class="panel-head"><h3>${f ? `${f.nr} · ${esc(f.naam)}` : "Standaardtaken"}</h3>${f ? `<button class="btn sm primary" data-act="st-new" data-nr="${f.nr}">+ Standaardtaak</button>` : ""}</div>
      ${ts.length ? `<div class="tw"><table class="t"><tbody>${ts.map((t, i) => `<tr><td class="num" style="width:40px;color:var(--muted)">${t.volgorde}</td><td><input class="inline" data-st-title="${t.id}" value="${esc(t.titel)}" aria-label="Titel"></td><td class="r" style="white-space:nowrap"><button class="btn ghost sm" data-act="st-move" data-id="${t.id}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Omhoog">↑</button><button class="btn ghost sm" data-act="st-move" data-id="${t.id}" data-dir="1" ${i === ts.length - 1 ? "disabled" : ""} aria-label="Omlaag">↓</button><button class="btn ghost sm danger" data-act="st-del" data-id="${t.id}" aria-label="Verwijderen">✕</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><b>Geen standaardtaken</b>Voeg er een toe voor deze fase.</div>`}
      <div class="panel-body muted" style="font-size:12px;border-top:1px solid var(--line)">Klik in een titel om ze te wijzigen; de wijziging wordt bewaard zodra je het veld verlaat.</div></div>
  </div>`;
}
async function driveSaveSettings() {
  const value = { url: $("#dr_url").value.trim(), secret: $("#dr_secret").value.trim() };
  const { data, error } = await sb.from("instellingen").upsert({ key: "drive", value, updated_at: new Date().toISOString() }).select().single();
  if (error) { toast("Bewaren mislukt: " + error.message); return; } S.instellingen.drive = data; render(); toast("Drive-instellingen bewaard");
}
function faseForm(f) {
  const isNew = !f; const nrs = Object.keys(S.fasen).map(Number); const nextNr = nrs.length ? Math.max(...nrs) + 1 : 1;
  openModal(isNew ? "Nieuwe fase" : "Fase bewerken", `<div class="form-grid">
    <div class="field"><label for="fa_nr">Nummer</label><input id="fa_nr" name="nr" type="number" min="1" required value="${isNew ? nextNr : f.nr}" ${isNew ? "" : "readonly"}></div>
    <div class="field"><label for="fa_naam">Naam</label><input id="fa_naam" name="naam" required value="${esc(f?.naam || "")}"></div>
    ${isNew ? "" : `<div class="field"><label for="fa_act">Zichtbaar bij nieuwe projecten</label><select id="fa_act" name="actief"><option value="1" ${f.actief !== false ? "selected" : ""}>Ja</option><option value="0" ${f.actief === false ? "selected" : ""}>Nee (verborgen)</option></select></div>`}
  </div>`, {
    onSave: async (d) => {
      const nr = Number(d.nr);
      if (isNew) { if (S.fasen[nr]) { toast("Nummer " + nr + " bestaat al."); return false; } const { data, error } = await sb.from("fasen").insert({ nr, naam: d.naam.trim() }).select().single(); if (error) { toast("Mislukt: " + error.message); return false; } S.fasen[nr] = data; S.selFase = nr; render(); toast("Fase toegevoegd"); }
      else { const { data, error } = await sb.from("fasen").update({ naam: d.naam.trim(), actief: d.actief === "1" }).eq("nr", f.nr).select().single(); if (error) { toast("Mislukt: " + error.message); return false; } S.fasen[f.nr] = data; render(); toast("Fase bewaard"); }
    },
    onDelete: isNew ? null : async () => {
      const { error } = await sb.from("fasen").delete().eq("nr", f.nr);
      if (error) { toast(/foreign key|violates/i.test(error.message) ? "Deze fase wordt nog gebruikt door een project — zet ze op verborgen." : "Mislukt: " + error.message); throw error; }
      delete S.fasen[f.nr]; S.standaardtaken = S.standaardtaken.filter(t => t.fase_nr !== f.nr); S.selFase = null; render(); toast("Fase verwijderd");
    },
  });
}
async function stAdd(nr) {
  const titel = prompt("Titel van de standaardtaak:"); if (!titel || !titel.trim()) return;
  const volgorde = Math.max(0, ...S.standaardtaken.filter(t => t.fase_nr === nr).map(t => t.volgorde)) + 1;
  const { data, error } = await sb.from("standaardtaken").insert({ fase_nr: nr, volgorde, titel: titel.trim() }).select().single();
  if (error) { toast("Mislukt: " + error.message); return; } S.standaardtaken.push(data); render(); toast("Toegevoegd");
}
async function stRename(id, titel) {
  const t = S.standaardtaken.find(x => x.id === Number(id)); if (!t || t.titel === titel.trim() || !titel.trim()) return;
  const { error } = await sb.from("standaardtaken").update({ titel: titel.trim() }).eq("id", t.id);
  if (error) { toast("Mislukt: " + error.message); return; } t.titel = titel.trim(); toast("Bewaard");
}
async function stMove(id, dir) {
  const t = S.standaardtaken.find(x => x.id === Number(id)); if (!t) return;
  const list = S.standaardtaken.filter(x => x.fase_nr === t.fase_nr).sort((a, b) => a.volgorde - b.volgorde);
  const i = list.indexOf(t), j = i + dir; if (j < 0 || j >= list.length) return;
  const o = list[j]; const a = t.volgorde, b = o.volgorde;
  // via een tijdelijk nummer, want (fase, volgorde) moet uniek blijven
  const r1 = await sb.from("standaardtaken").update({ volgorde: 9999 }).eq("id", t.id); if (r1.error) return toast("Mislukt: " + r1.error.message);
  const r2 = await sb.from("standaardtaken").update({ volgorde: a }).eq("id", o.id); if (r2.error) return toast("Mislukt: " + r2.error.message);
  const r3 = await sb.from("standaardtaken").update({ volgorde: b }).eq("id", t.id); if (r3.error) return toast("Mislukt: " + r3.error.message);
  t.volgorde = b; o.volgorde = a; S.standaardtaken.sort((x, y) => x.fase_nr - y.fase_nr || x.volgorde - y.volgorde); render();
}
async function stDel(id) {
  const t = S.standaardtaken.find(x => x.id === Number(id)); if (!t || !confirm(`"${t.titel}" verwijderen uit de standaardtaken?`)) return;
  const { error } = await sb.from("standaardtaken").delete().eq("id", t.id);
  if (error) { toast("Mislukt: " + error.message); return; } S.standaardtaken = S.standaardtaken.filter(x => x.id !== t.id); render(); toast("Verwijderd");
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
    <div class="field"><label for="f_klant">Klant (naam van de projectmap)</label><input id="f_klant" name="klant" required value="${esc(p.klant || "")}" placeholder="bv. Chantor - Mansi"></div>
    <div class="field"><label for="f_naam">Projectnaam</label><input id="f_naam" name="naam" value="${esc(p.naam || "")}" placeholder="bv. Renovatie gelijkvloers"></div>
    <div class="field span2"><div class="eyebrow" style="margin-top:4px">Klantgegevens</div></div>
    <div class="field"><label>Type klant</label><div class="seg"><label><input type="radio" name="klanttype" value="particulier" ${(p.klanttype || "particulier") === "particulier" ? "checked" : ""}> Particulier</label><label><input type="radio" name="klanttype" value="zakelijk" ${p.klanttype === "zakelijk" ? "checked" : ""}> Zakelijk</label></div></div>
    <div class="field"><label for="f_contact">Contactpersoon</label><input id="f_contact" name="contact" value="${esc(p.contact || "")}" placeholder="naam"></div>
    <div class="field zak"><label for="f_bedrijf">Bedrijfsnaam</label><input id="f_bedrijf" name="bedrijf" value="${esc(p.bedrijf || "")}"></div>
    <div class="field zak"><label for="f_btw">BTW-nummer</label><input id="f_btw" name="btw_nummer" value="${esc(p.btw_nummer || "")}" placeholder="BE 0123.456.789"></div>
    <div class="field"><label for="f_adres">Adres (straat + nr)</label><input id="f_adres" name="adres" value="${esc(p.adres || "")}"></div>
    <div class="field"><label for="f_pc">Postcode</label><input id="f_pc" name="postcode" inputmode="numeric" maxlength="4" value="${esc(p.postcode || "")}" list="pc_list" autocomplete="off"><datalist id="pc_list"></datalist></div>
    <div class="field"><label for="f_gem">Gemeente</label><input id="f_gem" name="gemeente" value="${esc(p.gemeente || "")}" list="gem_list" autocomplete="off"><datalist id="gem_list"></datalist></div>
    <div class="field"><label for="f_gsm1">GSM 1</label><input id="f_gsm1" name="gsm1" type="tel" value="${esc(p.gsm1 || "")}"></div>
    <div class="field"><label for="f_gsm2">GSM 2</label><input id="f_gsm2" name="gsm2" type="tel" value="${esc(p.gsm2 || "")}"></div>
    <div class="field"><label for="f_email1">E-mailadres 1</label><input id="f_email1" name="email1" type="email" value="${esc(p.email1 || "")}"><label class="chk"><input type="checkbox" name="factuur_email1" ${p.factuur_email1 ? "checked" : ""}> facturatie naar dit adres</label></div>
    <div class="field"><label for="f_email2">E-mailadres 2</label><input id="f_email2" name="email2" type="email" value="${esc(p.email2 || "")}"><label class="chk"><input type="checkbox" name="factuur_email2" ${p.factuur_email2 ? "checked" : ""}> facturatie naar dit adres</label></div>
    <div class="field span2"><div class="eyebrow" style="margin-top:4px">Project</div></div>
    <div class="field"><label for="f_nr">Projectnummer</label><input id="f_nr" name="nummer" value="${esc(p.nummer || "")}" placeholder="automatisch (jaar + volgnummer)" ${isNew ? "" : ""}><span class="muted" style="font-size:12px">${isNew ? "Leeg laten = automatisch volgend nummer" : "Enkel wijzigen als het echt moet"}</span></div>
    <div class="field"><label for="f_lead">Projectlead</label><select id="f_lead" name="lead">${userOpts(p.lead || S.me.id)}</select></div>
    <div class="field"><label for="f_status">Status</label><select id="f_status" name="status">${opts(Object.entries(PROJ_STATUS), p.status || "offerte")}</select></div>
    <div class="field"><label for="f_fase">Huidige fase</label><select id="f_fase" name="fase_nr">${faseOpts(p.fase_nr || 1, true)}</select></div>
    <div class="field"><label for="f_forfait">Forfait (€, excl. btw)</label><input id="f_forfait" type="number" step="1" name="forfait" value="${esc(p.forfait ?? "")}"></div>
    <div class="field"><label for="f_start">Start</label><input id="f_start" type="date" name="start" value="${esc(p.start || todayIso)}"></div>
    <div class="field"><label for="f_eind">Geplande oplevering</label><input id="f_eind" type="date" name="eind" value="${esc(p.eind || "")}"></div>
    <div class="field"><label for="f_map">Drive-map</label><input id="f_map" name="drive_map" value="${esc(p.drive_map || "")}" placeholder="PROJECTEN/klantnaam (automatisch)"></div>
    <div class="field verloren"><label for="f_vr">Reden verloren</label><input id="f_vr" name="verloren_reden" value="${esc(p.verloren_reden || "")}" placeholder="bv. prijs, timing, ander bureau"></div>
    <div class="field span2"><label for="f_not">Notities</label><textarea id="f_not" name="notities">${esc(p.notities || "")}</textarea></div>
    <div class="field span2"><div class="eyebrow" style="margin-top:4px">Extra gegevens <span class="muted" style="font-weight:400;letter-spacing:0;text-transform:none">— niet verplicht, handig voor rapportage en nacalculatie</span></div></div>
    <div class="field"><label for="f_ptype">Type project</label><select id="f_ptype" name="projecttype"><option value="">—</option>${opts(PROJECTTYPES.map(x => [x, x]), p.projecttype || "")}</select></div>
    <div class="field"><label for="f_bron">Hoe kwam de klant bij BROS?</label><select id="f_bron" name="bron"><option value="">—</option>${opts(BRONNEN.map(x => [x, x]), p.bron || "")}</select></div>
    <div class="field"><label for="f_m2">Oppervlakte (m²)</label><input id="f_m2" type="number" step="0.5" min="0" name="oppervlakte_m2" value="${esc(p.oppervlakte_m2 ?? "")}"></div>
    <div class="field"><label for="f_btwt">BTW-tarief</label><select id="f_btwt" name="btw_tarief"><option value="">—</option>${opts([[6, "6 % (renovatie, woning > 10 jaar)"], [21, "21 %"]], p.btw_tarief ?? "")}</select></div>
    <div class="field"><label for="f_od">Datum offerte</label><input id="f_od" type="date" name="offerte_datum" value="${esc(p.offerte_datum || "")}"></div>
    <div class="field"><label for="f_cd">Datum contract</label><input id="f_cd" type="date" name="contract_datum" value="${esc(p.contract_datum || "")}"></div>
    <div class="field"><label for="f_op">Werkelijk opgeleverd op</label><input id="f_op" type="date" name="opgeleverd_op" value="${esc(p.opgeleverd_op || "")}"></div>
    <div class="field"><label for="f_tags">Tags (komma-gescheiden)</label><input id="f_tags" name="tags" value="${esc(p.tags || "")}" placeholder="bv. keuken, badkamer, showroom"></div>
    ${isNew ? `<div class="field span2"><label>Fasen voor dit project <span class="muted" style="font-weight:400">— vink uit wat niet van toepassing is; elke fase brengt zijn standaardtaken mee</span></label>
      <div class="fase-list">${fasenList().map(f => `<label><input type="checkbox" name="fase" value="${f.nr}" checked><span class="n">${f.nr}</span><span class="nm">${esc(f.naam)}</span><span class="c">${S.standaardtaken.filter(t => t.fase_nr === f.nr).length} taken</span></label>`).join("")}</div></div>` : ""}
  </div>`, {
    wide: true,
    onSave: async (d) => {
      const row = { klant: d.klant.trim(), naam: d.naam.trim(), klanttype: d.klanttype || "particulier", bedrijf: (d.bedrijf || "").trim(), btw_nummer: (d.btw_nummer || "").trim(), projecttype: d.projecttype || "", bron: d.bron || "", oppervlakte_m2: d.oppervlakte_m2 === "" ? null : Number(d.oppervlakte_m2), btw_tarief: d.btw_tarief === "" ? null : Number(d.btw_tarief), offerte_datum: d.offerte_datum || null, contract_datum: d.contract_datum || null, opgeleverd_op: d.opgeleverd_op || null, verloren_reden: d.status === "verloren" ? d.verloren_reden.trim() : "", tags: d.tags.trim(), contact: d.contact.trim(), adres: d.adres.trim(), postcode: d.postcode.trim(), gemeente: d.gemeente.trim(), gsm1: d.gsm1.trim(), gsm2: d.gsm2.trim(), email1: d.email1.trim(), email2: d.email2.trim(), factuur_email1: d.factuur_email1 === "on", factuur_email2: d.factuur_email2 === "on", lead: d.lead || null, status: d.status, fase_nr: d.fase_nr ? Number(d.fase_nr) : null, start: d.start || null, eind: d.eind || null, forfait: d.forfait === "" ? null : Number(d.forfait), drive_map: d.drive_map || ("PROJECTEN/" + d.klant.trim()), notities: d.notities };
      if (d.nummer && d.nummer.trim()) row.nummer = d.nummer.trim(); else if (!isNew) row.nummer = p.nummer || null;
      if (isNew) {
        row.created_by = S.me.id;
        const created = await dbInsert("projecten", row);
        const tasks = S.standaardtaken.filter(t => d._fasen.includes(t.fase_nr)).map(t => ({ project_id: created.id, titel: t.titel, fase_nr: t.fase_nr, assignee: row.lead, volgorde: t.fase_nr * 100 + t.volgorde, status: "todo", uren_gepland: 0 }));
        if (tasks.length) { const { data, error } = await sb.from("taken").insert(tasks).select(); if (error) toast("Standaardtaken niet aangemaakt: " + error.message); else (data || []).forEach(t => S.taken[t.id] = t); }
        toast(`Project aangemaakt met ${tasks.length} standaardtaken`);
        S.view = "projecten"; S.project = created.id; S.ptab = "taken"; render();
        if (driveReady()) { try { await driveSync(S.projecten[created.id], "create"); } catch (e) { toast("Drive-map niet aangemaakt: " + e.message); } }
      } else { await dbUpdate("projecten", p.id, row); toast("Project bewaard"); }
    },
    onDelete: isNew ? null : async () => { await dbDelete("projecten", p.id); Object.values(S.taken).filter(t => t.project_id === p.id).forEach(t => delete S.taken[t.id]); Object.values(S.uren).filter(h => h.project_id === p.id).forEach(h => delete S.uren[h.id]); S.project = null; render(); toast("Project verwijderd"); },
  });
  wirePostcode();
  const form = $("#mform"); const sync = () => { const zak = form.querySelector('input[name="klanttype"]:checked')?.value === "zakelijk"; form.querySelectorAll(".field.zak").forEach(el => el.style.display = zak ? "" : "none"); form.querySelectorAll(".field.verloren").forEach(el => el.style.display = form.querySelector("#f_status").value === "verloren" ? "" : "none"); };
  form.addEventListener("change", sync); sync();
}
/* Postcode ⇄ gemeente: invullen zodra het ene veld bekend is; bij meerdere mogelijkheden een keuzelijstje */
function wirePostcode() {
  const PC = window.BE_POSTCODES || []; const pc = $("#f_pc"), gem = $("#f_gem"), pcl = $("#pc_list"), geml = $("#gem_list");
  if (!pc || !gem) return;
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  pc.addEventListener("input", () => {
    const v = pc.value.trim(); if (v.length !== 4) return;
    const hits = PC.filter(r => r[0] === v); if (!hits.length) return;
    geml.innerHTML = hits.map(r => `<option value="${esc(r[1])}">`).join("");
    if (!hits.some(r => norm(r[1]) === norm(gem.value))) gem.value = hits[0][1];
    choices(hits.map(r => r[1]));
  });
  function choices(names) {
    let box = $("#gem_choices");
    if (!box) { box = document.createElement("div"); box.id = "gem_choices"; box.className = "choices"; gem.parentNode.appendChild(box); }
    box.innerHTML = names.length > 1 ? `<span class="muted">Deelgemeente:</span> ` + names.map(n => `<button type="button" class="btn sm ${n === gem.value ? "primary" : ""}" data-gem="${esc(n)}">${esc(n)}</button>`).join(" ") : "";
    box.querySelectorAll("[data-gem]").forEach(b => b.onclick = () => { gem.value = b.dataset.gem; choices(names); });
  }
  gem.addEventListener("input", () => {
    const v = norm(gem.value); if (v.length < 3) return;
    const hits = PC.filter(r => norm(r[1]).startsWith(v));
    geml.innerHTML = [...new Set(hits.map(r => r[1]))].slice(0, 12).map(c => `<option value="${esc(c)}">`).join("");
    const exact = PC.filter(r => norm(r[1]) === v); const zips = [...new Set(exact.map(r => r[0]))];
    pcl.innerHTML = zips.map(z => `<option value="${z}">`).join("");
    if (zips.length && !zips.includes(pc.value.trim())) pc.value = zips[0];
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
  if (e.target.closest("a[href][target=_blank]")) return; // externe links (bv. Drive-map) gewoon laten openen
  const el = e.target.closest("[data-nav],[data-act],[data-open],[data-back],[data-ptab],[data-edit-task],[data-edit-hours],[data-gnav],[data-wnav],[data-gtoggle],[data-close],[data-selfase],[data-sellot],[data-sort],[data-vtoggle]");
  if (!el) { if (e.target === $("#modalBg")) closeModal(); return; }
  if (e.target.matches(".task-check") || e.target.matches("input,select")) { if (!e.target.closest("[data-act]")) return; }
  const d = el.dataset;
  if (d.close != null) return closeModal();
  if (d.sort) { S.sort = { key: d.sort, dir: S.sort.key === d.sort && S.sort.dir === "asc" ? "desc" : S.sort.key === d.sort ? "asc" : (["klant", "lead", "status", "fase"].includes(d.sort) ? "asc" : "desc") }; try { localStorage.setItem("bros.sort", JSON.stringify(S.sort)); } catch (err) { } return render(); }
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
  if (d.act === "export-projects") return exportProjects();
  if (d.act === "drive-create" || d.act === "drive-link" || d.act === "drive-list") { const p = S.projecten[d.pid]; const a = d.act.replace("drive-", ""); driveSync(p, a).catch(err => toast("Drive: " + err.message)); return; }
  if (d.act === "drive-save") return driveSaveSettings();
  if (d.act === "drive-test") return driveCall("ping", {}).then(j => toast(`OK — mappen: ${j.projecten} / ${j.sjabloon}`)).catch(err => toast("Drive: " + err.message));
  if (d.selfase) { S.selFase = Number(d.selfase); return render(); }
  if (d.act === "fase-new") return faseForm(null);
  if (d.act === "fase-edit") { e.stopPropagation(); return faseForm(S.fasen[d.nr]); }
  if (d.act === "st-new") return stAdd(Number(d.nr));
  if (d.act === "st-move") return stMove(d.id, Number(d.dir));
  if (d.act === "st-del") return stDel(d.id);
  if (d.sellot) { S.selLot = Number(d.sellot); return render(); }
  if (d.vtoggle) { S.vordOpen = S.vordOpen || {}; S.vordOpen[d.vtoggle] = !S.vordOpen[d.vtoggle]; return render(); }
  if (d.act === "ms-add-lot") return msAddLotForm(d.pid);
  if (d.act === "ms-open") { S.ptab = "meetstaat"; render(); if (!msRows(d.pid).length) msAddLotForm(d.pid); return; }
  if (d.act === "ms-add-post") return msAddPostForm(d.pid, d.lot ? Number(d.lot) : null);
  if (d.act === "ms-del") { const r = S.meetstaat_posten[d.id]; if (r && confirm(`"${r.omschrijving}" verwijderen?`)) dbDelete("meetstaat_posten", d.id).catch(() => { }); return; }
  if (d.act === "ms-del-lot") return msDelLot(d.pid, Number(d.lot));
  if (d.act === "ms-export") return exportMeetstaat(S.projecten[d.pid]).catch(err => { loader.fail(); toast("Export: " + err.message); });
  if (d.act === "post-new") return postAdd(Number(d.lot));
  if (d.act === "vord-new") return vordForm(d.pid, d.soort);
  if (d.act === "vord-del") return vordDel(d.id);
  if (d.act === "post-del") return postDel(d.id);
  if (d.act === "logout") return sb.auth.signOut().then(() => location.reload());
  if (d.act === "reload") return location.reload();
  if (d.act === "update-later") { updateAvailable = false; $("#updateBar")?.classList.remove("show"); }
});
document.addEventListener("focusout", (e) => {
  const d = e.target.dataset || {};
  if (d.stTitle) return stRename(d.stTitle, e.target.value);
  if (d.vr) return vordEditPct(d.vr, Number(d.lot), e.target.value, d.vpost || null);
  if (d.ms && e.target.tagName !== "SELECT") return msEdit(d.ms, d.f, e.target.value);
  if (d.post && e.target.type !== "checkbox" && e.target.tagName !== "SELECT") return postEdit(d.post, d.f, e.target.value);
  if (d.lot && d.f === "marge") return lotEdit(Number(d.lot), d.f, e.target.value);

  if (d.vf && e.target.tagName !== "SELECT" && e.target.type !== "date") return vordEdit(d.vf, d.f, e.target.value);
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset.filter) { S.filters[el.dataset.filter] = el.value; return render(); }
  if (el.dataset.hoursUser != null) { S.hoursUser = el.value; return render(); }
  if (el.dataset.rapjaar != null) { S.rapJaar = el.value; return render(); }
  if (el.dataset.toggle) { const t = S.taken[el.dataset.toggle]; if (t) dbUpdate("taken", t.id, { status: el.checked ? "done" : "todo" }).catch(() => { }); }
  if (el.dataset.ms && el.tagName === "SELECT") return msEdit(el.dataset.ms, el.dataset.f, el.value);
  if (el.dataset.post && (el.type === "checkbox" || el.tagName === "SELECT")) return postEdit(el.dataset.post, el.dataset.f, el.value, el.checked);
  if (el.dataset.lot && el.type === "checkbox") return lotEdit(Number(el.dataset.lot), el.dataset.f, null, el.checked);
  if (el.dataset.vf && (el.tagName === "SELECT" || el.type === "date")) return vordEdit(el.dataset.vf, el.dataset.f, el.value);
});
document.addEventListener("input", (e) => { if (e.target.dataset.filter === "q") { S.filters.q = e.target.value; render(); const i = $("[data-filter=q]"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); if (e.key === "Enter" && e.target.classList && e.target.classList.contains("inline") && e.target.tagName === "INPUT") { e.preventDefault(); e.target.blur(); } });

/* ---------- versiecontrole: melden als er een nieuwe versie online staat ---------- */
let updateAvailable = false;
async function checkVersion() {
  try { const r = await fetch("version.json?t=" + Date.now(), { cache: "no-store" }); const j = await r.json(); if (j.version && j.version !== APP_VERSION && !updateAvailable) { updateAvailable = true; $("#updateBar")?.classList.add("show"); } } catch (e) { }
}

/* ---------- start ---------- */
async function boot() {
  try { const sv = JSON.parse(localStorage.getItem("bros.sort") || "null"); if (sv && sv.key) S.sort = sv; } catch (e) { }
  render();
  if (!configured) return;
  const { data: { session } } = await sb.auth.getSession();
  S.session = session; render();
  sb.auth.onAuthStateChange((_evt, sess) => { const had = !!S.session; S.session = sess; if (sess && !had) start(); if (!sess) { S.ready = false; render(); } });
  if (session) start();
}
async function start() {
  loader.start("app.load", "Planbord laden…", 2500);
  try { await loadAll(); S.ready = true; S.loadError = null; render(); loader.done("app.load"); subscribe(); setInterval(checkVersion, 5 * 60 * 1000); setTimeout(checkVersion, 20000); }
  catch (e) { loader.fail(); S.loadError = e.message || String(e); render(); }
}
boot();
