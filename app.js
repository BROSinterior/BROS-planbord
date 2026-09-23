/* =====================================================================
   BROS Planbord — app v1.0
   Statische webapp op Supabase (login, live-synchronisatie, rechten)
   ===================================================================== */
const APP_VERSION = "1.25.0";
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
let todayIso = ""; function refreshToday() { const n = new Date(); todayIso = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; } refreshToday();   // bij elke render herberekend: een tabblad dat 's nachts openblijft rekent zo met de juiste dag
const addDays = (s, n) => iso(new Date(pd(s).getTime() + n * DAY));
const diffDays = (a, b) => Math.round((pd(b) - pd(a)) / DAY);
const mondayOf = (s) => { const d = pd(s); const w = (d.getUTCDay() + 6) % 7; return addDays(s, -w); };
const fmt = (s) => { if (!s) return "—"; const d = pd(s); return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
const fmtLong = (s) => { if (!s) return "—"; const d = pd(s); return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`; };
const weekNr = (s) => { const t = pd(s); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y0) / DAY + 1) / 7); };
const MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const DAYS = ["ma", "di", "wo", "do", "vr", "za", "zo"];
const nl = (n, dec = 1) => { const v = Number(n) || 0; if (dec === 1 && Math.abs(v * 4 - Math.round(v * 4)) < 1e-9 && Math.abs(v * 2 - Math.round(v * 2)) > 1e-9) dec = 2; /* kwartieren (2,25 / 2,75) niet afronden */ return (Math.round(v * 10 ** dec) / 10 ** dec).toLocaleString("nl-BE", { minimumFractionDigits: 0, maximumFractionDigits: dec }); };
const eur = (n) => n == null || n === "" ? "—" : Number(n).toLocaleString("nl-BE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const workdays = (a, b) => { let n = 0; for (let s = a; s <= b; s = addDays(s, 1)) { const d = pd(s).getUTCDay(); if (d !== 0 && d !== 6) n++; } return Math.max(n, 1); };

/* ---------- state ---------- */
const S = {
  session: null, me: null, setPassword: false, passwordForced: false,
  profiles: {}, tarieven: {}, fasen: {}, standaardtaken: [], projecten: {}, taken: {}, uren: {}, documenten: {}, instellingen: {}, loten: {}, posten: {}, meetstaat_posten: {}, vorderingen: {}, vordering_regels: {}, contacten: {}, project_contacten: {}, goedkeuringen: {}, notities: {}, werfbezoeken: {}, vaststellingen: {}, klant_timing: {}, werfplannen: {}, werfverslagen: {}, tekenplannen: {}, taak_voorstellen: {}, assistent_berichten: {},
  view: "overzicht", project: null, ptab: "taken",
  filters: { user: "", status: "", project: "", q: "" }, cfilters: { soort: "", q: "" },
  ganttStart: addDays(mondayOf(todayIso), -14), ganttDays: 112, ganttOpen: {},
  weekStart: mondayOf(todayIso), hoursUser: null, sort: { key: "nummer", dir: "desc" },
  ready: false, loadError: null,
};
const cfg = window.PLANBORD_CONFIG || {};
/* ---------- auth-link in de URL (uitnodiging, wachtwoordherstel, vervallen link) — vóór supabase-js de hash opruimt ---------- */
const URL_AUTH = (() => {
  const h = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  const q = location.search.startsWith("?") ? location.search.slice(1) : "";
  const p = new URLSearchParams(h.includes("=") ? h : q);
  const err = p.get("error_description") || p.get("error_code") || p.get("error") || "";
  if (err) history.replaceState(null, "", location.pathname);
  return { type: p.get("type") || "", error: err };
})();
const configured = cfg.supabaseUrl && !cfg.supabaseUrl.includes("VUL-IN") && cfg.supabaseAnonKey && cfg.supabaseAnonKey !== "VUL-IN";
const sb = configured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;

/* ---------- helpers ---------- */
const isBeheer = () => S.me?.role === "beheer";
const EXTERN = ["klant", "aannemer"]; const users = () => Object.values(S.profiles).filter(u => u.active !== false && !EXTERN.includes(u.role)).sort((a, b) => a.name.localeCompare(b.name));
const projects = () => Object.values(S.projecten).sort((a, b) => (b.nummer || "").localeCompare(a.nummer || "") || (a.klant || "").localeCompare(b.klant || ""));
/* index per render: uren per taak/project en taken per project (vermijdt een volledige scan per rij in grote lijsten) */
let IDX = null;
function buildIndex() {
  const byTask = {}, byProj = {}, tasksByProj = {};
  for (const h of Object.values(S.uren)) { const u = Number(h.uren) || 0; byTask[h.taak_id] = (byTask[h.taak_id] || 0) + u; byProj[h.project_id] = (byProj[h.project_id] || 0) + u; }
  for (const t of Object.values(S.taken)) (tasksByProj[t.project_id] = tasksByProj[t.project_id] || []).push(t);
  for (const k in tasksByProj) tasksByProj[k].sort((a, b) => (a.volgorde ?? 0) - (b.volgorde ?? 0) || (a.start || "9").localeCompare(b.start || "9"));
  IDX = { byTask, byProj, tasksByProj };
}
const idx = () => { if (!IDX) buildIndex(); return IDX; };
const tasksOf = (pid) => (idx().tasksByProj[pid] || []).slice();
const hoursOf = (pred) => Object.values(S.uren).filter(pred).reduce((s, h) => s + (Number(h.uren) || 0), 0);
const taskDone = (tid) => idx().byTask[tid] || 0;
const projDone = (pid) => idx().byProj[pid] || 0;
const projPlanned = (pid) => tasksOf(pid).reduce((s, t) => s + (Number(t.uren_gepland) || 0), 0);
const isLate = (t) => t.status !== "done" && t.eind && t.eind < todayIso;
const userById = (id) => S.profiles[id] || { name: "—", initials: "?", color: "#999" };
const projName = (p) => p ? (p.klant + (p.naam && p.naam !== p.klant ? " · " + p.naam : "")) : "—";
const projCode = (p) => p ? [p.nummer, KLANTCODE[p.klanttype]].filter(Boolean).join(" · ") : "";
const faseName = (nr) => nr ? (S.fasen[nr] ? `${nr} · ${S.fasen[nr].naam}` : String(nr)) : "";
const faseShort = (nr) => nr && S.fasen[nr] ? S.fasen[nr].naam : "";
const fasenList = () => Object.values(S.fasen).filter(f => f.actief !== false).sort((a, b) => a.nr - b.nr);
const projSpan = (p) => { const ts = tasksOf(p.id); const st = [p.start, ...ts.map(t => t.start)].filter(Boolean).sort()[0]; const en = [p.eind, ...ts.map(t => t.eind)].filter(Boolean).sort().pop(); return [st, en]; };
/* toegewezen aan: teamlid (assignee) of contact zoals de klant of een aannemer (contact_id, sinds script 015) */
const contactAvatar = (c) => `<span class="avatar" style="background:var(--surface-2);color:var(--ink-2);border:1px solid var(--line-2)" title="${esc(c.naam)}">${esc((c.naam || "?").trim().split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase())}</span>`;
const wieCell = (t) => t.contact_id && S.contacten[t.contact_id] ? `<span class="who-cell">${contactAvatar(S.contacten[t.contact_id])}${esc(S.contacten[t.contact_id].naam)} <span class="pill kl">${S.contacten[t.contact_id].soort === "klant" ? "klant" : CONTACT_SOORT[S.contacten[t.contact_id].soort] || "contact"}</span></span>` : `<span class="who-cell">${t.assignee ? avatar(t.assignee) : ""}${esc(userById(t.assignee).name)}</span>`;
const wieNaam = (t) => t.contact_id && S.contacten[t.contact_id] ? S.contacten[t.contact_id].naam : userById(t.assignee).name;
/* keuzelijst "toegewezen aan": team + contacten van het project (waarde "c:<id>" voor een contact) */
const wieOpts = (pid, t) => { const cur = t.contact_id ? "c:" + t.contact_id : (t.assignee ?? S.me.id); const pcs = pid ? contactsOf(pid) : []; return `<option value="">— niemand —</option><optgroup label="Team">${opts(users().map(u => [u.id, u.name]), cur)}</optgroup>${pcs.length ? `<optgroup label="Klant en contacten van dit project">${opts(pcs.map(x => ["c:" + x.c.id, x.c.naam + " · " + (CONTACT_ROL[x.rol] || x.rol)]), cur)}</optgroup>` : ""}`; };
const wieSplit = (v) => v && v.startsWith("c:") ? { assignee: null, contact_id: v.slice(2) } : { assignee: v || null, contact_id: null };
const safeColor = (c) => /^#[0-9a-fA-F]{3,8}$/.test(String(c || "")) ? c : "#6B6B7B";
const avatar = (id) => { const u = userById(id); return `<span class="avatar" style="background:${safeColor(u.color)}" title="${esc(u.name)}">${esc(u.initials)}</span>`; };
const vsTag = (t) => t.vaststelling_id && S.vaststellingen[t.vaststelling_id] ? ` <span class="pill kl" data-vs="${t.vaststelling_id}" title="Uit een vaststelling op de werf — klik om ze te openen" style="cursor:pointer">📍 ${vsNr(S.vaststellingen[t.vaststelling_id])}</span>` : "";
const klantTag = (t) => vsTag(t) + (t.uren_klant ? ` <span class="pill kl" title="Uren van deze taak zijn zichtbaar voor de klant">uren → klant</span>` : "") + (t.timing_klant ? ` <span class="pill kl" title="Titel en timing van deze taak staan in de planning van de klant">timing → klant</span>` : "");
const pill = (t) => isLate(t) ? `<span class="pill late">Te laat</span>` : `<span class="pill ${esc(t.status)}">${esc(TASK_STATUS[t.status] || t.status)}</span>`;
const kost = (uid, uren, soort) => (Number(S.tarieven[uid]?.[soort]) || 0) * uren;
const projKost = (pid, soort) => Object.values(S.uren).filter(h => h.project_id === pid).reduce((s, h) => s + kost(h.user_id, Number(h.uren) || 0, soort), 0);
/* Telefoonnummers uniform: +32/471.93.06.33 (mobiel), +32/3.123.45.67 of +32/16.12.34.56 (vast); ander land: +CC/nummer */
function telFmt(s) {
  let t = String(s || "").trim(); if (!t) return "";
  let d = t.replace(/[^\d+]/g, ""); if (!d) return t;
  if (d.startsWith("00")) d = "+" + d.slice(2);
  if (!d.startsWith("+")) { if (d.startsWith("0")) d = "+32" + d.slice(1); else if (d.length === 9 || d.length === 8) d = "+32" + d; else return t; }
  const groep = (n, sizes) => { const out = []; let i = 0; for (const z of sizes) { out.push(n.slice(i, i + z)); i += z; } if (i < n.length) out.push(n.slice(i)); return out.filter(Boolean).join("."); };
  if (d.startsWith("+32")) { const n = d.slice(3).replace(/^0/, ""); if (n.length === 9) return "+32/" + groep(n, [3, 2, 2, 2]); if (n.length === 8) return "+32/" + ("2349".includes(n[0]) ? groep(n, [1, 3, 2, 2]) : groep(n, [2, 2, 2, 2])); return "+32/" + n; }
  const m = d.match(/^\+(\d{1,3})(\d{4,})$/); if (!m) return t;
  const cc = m[1].length > 2 && !/^(1|7)/.test(m[1]) ? m[1].slice(0, 2) : m[1]; const n = d.slice(1 + cc.length).replace(/^0/, "");
  return "+" + cc + "/" + (n.length === 9 ? groep(n, [3, 2, 2, 2]) : n.length === 10 ? groep(n, [3, 3, 2, 2]) : n);
}
let toastT; function toast(msg, ms = 2800) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), Math.max(2800, ms)); }

/* ---------- data laden en live houden ---------- */
const TABLES = { profiles: "profiles", tarieven: "tarieven", fasen: "fasen", standaardtaken: "standaardtaken", projecten: "projecten", taken: "taken", uren: "uren", documenten: "documenten", instellingen: "instellingen", loten: "loten", posten: "posten", meetstaat_posten: "meetstaat_posten", vorderingen: "vorderingen", vordering_regels: "vordering_regels", contacten: "contacten", project_contacten: "project_contacten", goedkeuringen: "goedkeuringen", notities: "notities", werfbezoeken: "werfbezoeken", vaststellingen: "vaststellingen", klant_timing: "klant_timing", werfplannen: "werfplannen", werfverslagen: "werfverslagen", taak_voorstellen: "taak_voorstellen", assistent_berichten: "assistent_berichten", prijsaanvragen: "prijsaanvragen", prijsaanvraag_regels: "prijsaanvraag_regels", tekenplannen: "tekenplannen" };
const OPTIONAL_TABLES = ["tarieven", "documenten", "instellingen", "loten", "posten", "meetstaat_posten", "vorderingen", "vordering_regels", "contacten", "project_contacten", "goedkeuringen", "notities", "werfbezoeken", "vaststellingen", "klant_timing", "werfplannen", "werfverslagen", "taak_voorstellen", "assistent_berichten", "prijsaanvragen", "prijsaanvraag_regels", "tekenplannen"]; // ontbreken zolang het bijbehorende sql-script niet is uitgevoerd
const rowKey = (t, r) => t === "fasen" || t === "loten" ? r.nr : t === "klant_timing" ? r.project_id + "|" + r.fase_nr : t === "tarieven" ? r.user_id : t === "instellingen" ? r.key : t === "vordering_regels" ? (r.id || r.vordering_id + "|" + r.lot + "|" + (r.post_id || "")) : r.id;
function ingest(table, rows) {
  if (table === "standaardtaken") { S.standaardtaken = rows.sort((a, b) => a.fase_nr - b.fase_nr || a.volgorde - b.volgorde); return; }
  const o = {}; rows.forEach(r => o[rowKey(table, r)] = r); S[table] = o; IDX = null;
}
// Sinds script 012 leest het team de meetstaat, loten en postenbibliotheek via views: kostprijs, marge en richtprijs
// zijn daarin leeg voor medewerkers en de verkoopprijs (verkoop_ep) komt berekend mee. Bestaat de view nog niet → de tabel.
const VIEW_OF = { meetstaat_posten: "meetstaat_posten_v", loten: "loten_v", posten: "posten_v" };
const srcOf = (t) => VIEW_OF[t] && S.viewsOk !== false ? VIEW_OF[t] : t;
// Supabase geeft max. 1000 rijen per aanvraag terug: in pagina's ophalen tot alles binnen is.
async function fetchAllRows(t) {
  const PAGE = 1000; let from = 0, all = []; let src = srcOf(t);
  for (; ;) {
    let { data, error } = await sb.from(src).select("*").range(from, from + PAGE - 1);
    if (error && src !== t && /does not exist|42P01|schema cache/i.test(error.message || "")) { S.viewsOk = false; src = t; ({ data, error } = await sb.from(src).select("*").range(from, from + PAGE - 1)); }
    if (error) return { error };
    all = all.concat(data || []);
    if (!data || data.length < PAGE) return { data: all };
    from += PAGE;
  }
}
async function loadAll() {
  const res = await Promise.all(Object.keys(TABLES).map(t => fetchAllRows(t)));
  Object.keys(TABLES).forEach((t, i) => { if (res[i].error) { if (!OPTIONAL_TABLES.includes(t)) throw res[i].error; } else ingest(t, res[i].data || []); });
  S.me = S.profiles[S.session.user.id] || null;
}
function subscribe() {
  // Eén kanaal per tabel: als één tabel niet in de realtime-publicatie zit, blijven de andere werken.
  ["profiles", "tarieven", "fasen", "standaardtaken", "projecten", "taken", "uren", "documenten", "loten", "posten", "meetstaat_posten", "meetstaat_prijzen", "vorderingen", "vordering_regels", "contacten", "project_contacten", "goedkeuringen", "notities", "werfbezoeken", "vaststellingen", "klant_timing", "werfplannen", "werfverslagen", "taak_voorstellen", "assistent_berichten", "prijsaanvragen", "prijsaanvraag_regels", "tekenplannen"].forEach(t => {
    const ch = sb.channel("pb-" + t);
    ch.on("postgres_changes", { event: "*", schema: "public", table: t }, (payload) => {
      if (S.bulk) return;   // tijdens een bulkactie (import, lot wissen) niet per rij herbouwen; op het einde volgt één refetch
      if (t === "standaardtaken") { refetch(t); return; }
      if (t === "meetstaat_prijzen") { const pid = (payload.new || payload.old || {}).post_id; if (pid && S.meetstaat_posten[pid]) msRefetch([pid]); return; }
      if (VIEW_OF[t] && S.viewsOk !== false) { if (payload.eventType === "DELETE") { delete S[t][rowKey(t, payload.old)]; render(); } else rowRefetch(t, rowKey(t, payload.new)); return; }
      if (payload.eventType === "DELETE") { delete S[t][rowKey(t, payload.old)]; }
      else { S[t][rowKey(t, payload.new)] = payload.new; }
      IDX = null;
      if (t === "profiles") S.me = S.profiles[S.session.user.id] || S.me;
      render();
    });
    ch.on("system", {}, (msg) => { if (msg && msg.status === "error") console.warn("Realtime niet actief voor tabel " + t + " — voer het laatste databasescript uit.", msg.message); });
    ch.subscribe((status) => { if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setTimeout(() => refetch(t), 3000); });
  });
  // Veiligheidsnet: bij terugkeer naar het tabblad alles verversen
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refetchAll(); });
}
async function refetch(t) { const { data, error } = await fetchAllRows(t); if (!error) { ingest(t, data || []); render(); } }
/* één rij opnieuw uit de view halen (na een wijziging: verkoopprijs en beheer-kolommen komen zo mee) */
async function rowRefetch(t, key) {
  const col = t === "loten" ? "nr" : "id";
  const { data, error } = await sb.from(srcOf(t)).select("*").eq(col, key).maybeSingle();
  if (!error && data) { S[t][rowKey(t, data)] = data; render(); }
}
async function msRefetch(ids) {
  if (!ids.length) return;
  const { data, error } = await sb.from(srcOf("meetstaat_posten")).select("*").in("id", ids);
  if (!error) { (data || []).forEach(r => S.meetstaat_posten[r.id] = r); render(); }
}
async function refetchAll() { try { await loadAll(); render(); } catch (e) { } }

/* ---------- schrijven (optimistisch: eerst lokaal, dan database) ---------- */
async function dbInsert(table, row) {
  const { data, error } = await sb.from(table).insert(row).select().single();
  if (error) { toast("Bewaren mislukt: " + error.message, 5000); error.__toasted = true; throw error; }
  const key = table === "tarieven" ? "user_id" : table === "loten" ? "nr" : "id"; S[table][data[key]] = data; render(); return data;
}
async function dbUpdate(table, id, patch) {
  const key = table === "tarieven" ? "user_id" : table === "loten" ? "nr" : "id";
  const prev = S[table][id]; S[table][id] = { ...prev, ...patch }; render();
  const { data, error } = await sb.from(table).update(patch).eq(key, id).select().single();
  if (error) { if (prev === undefined) delete S[table][id]; else S[table][id] = prev; render(); toast("Bewaren mislukt: " + error.message, 5000); error.__toasted = true; throw error; }
  S[table][id] = VIEW_OF[table] ? { ...prev, ...data } : data; render();
  if (VIEW_OF[table] && S.viewsOk !== false) rowRefetch(table, id);
  return data;
}
async function dbUpsert(table, row) {
  const key = table === "tarieven" ? "user_id" : "id";
  const { data, error } = await sb.from(table).upsert(row).select().single();
  if (error) { toast("Bewaren mislukt: " + error.message, 5000); error.__toasted = true; throw error; }
  S[table][data[key]] = data; render(); return data;
}
async function dbDelete(table, id) {
  const prev = S[table][id]; delete S[table][id]; render();
  const { error } = await sb.from(table).delete().eq("id", id);
  if (error) { if (prev === undefined) delete S[table][id]; else S[table][id] = prev; render(); toast("Verwijderen mislukt: " + error.message, 5000); error.__toasted = true; throw error; }
}


/* ---------- Drive-koppeling (Google Apps Script als brosburo@gmail.com) ---------- */
const driveCfg = () => (S.instellingen.drive && S.instellingen.drive.value) || {};
const schemaV = () => Number(S.instellingen.app?.value?.versie_schema) || 0;   // welk databasescript is al uitgevoerd
const SCHEMA_HINT = (n) => `<div class="empty" style="padding:10px 12px;margin-bottom:12px"><b>Databasescript ${String(n).padStart(3, "0")} nog niet uitgevoerd</b>Voer <code>sql/${String(n).padStart(3, "0")}_*.sql</code> uit in Supabase om deze functie te activeren.</div>`;
const driveReady = () => !!(driveCfg().url && driveCfg().secret);
async function driveCall(action, payload) {
  const c = driveCfg(); if (!c.url) throw new Error("Drive-koppeling niet ingesteld (Instellingen → Drive).");
  const r = await fetch(c.url, { method: "POST", body: JSON.stringify({ token: S.session?.access_token || "", ...payload, action, secret: c.secret }), redirect: "follow" });
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
async function driveSync(p, action, quiet) {
  const label = action === "create" ? "Projectmap aanmaken op Drive" : action === "link" ? "Map zoeken op Drive" : "Bestanden vernieuwen";
  if (!quiet) loader.start("drive." + action, label + "…", action === "create" ? 12000 : 7000);
  try {
    const mapnaam = ((p.drive_map || "").replace(/^PROJECTEN\//, "").trim()) || p.klant;
    let j;
    if (action === "list") j = await driveCall(action, { folderId: p.drive_folder_id });
    else {
      // Koppelen: probeer de opgeslagen mapnaam, daarna de klantnaam en een opgeschoonde variant (oude koppeltekens, dubbele spaties)
      const clean = (s) => (s || "").replace(/\s*-\s*/g, " ").replace(/\s+/g, " ").trim();
      const kandidaten = [...new Set([mapnaam, p.klant, clean(mapnaam), clean(p.klant)].map(s => (s || "").trim()).filter(Boolean))];
      let fout = null;
      for (const k of kandidaten) {
        try { j = await driveCall(action === "create" ? "create" : "link", { klant: k }); fout = null; break; }
        catch (e) { fout = e; if (action === "create" || !/Geen map gevonden/i.test(String(e.message || e))) throw e; }
      }
      if (fout) throw new Error(`Geen map gevonden in PROJECTEN. Geprobeerd: ${kandidaten.map(k => `"${k}"`).join(", ")}. Pas de Drive-map in het projectformulier aan naar de exacte mapnaam.`);
    }
    if (!quiet) loader.step("Bestanden bewaren…");
    await dbUpdate("projecten", p.id, { drive_folder_id: j.folder.id, drive_url: j.folder.url, drive_map: "PROJECTEN/" + j.folder.name });
    const rows = (j.files || []).filter(f => !/^\._|^Icon|^~\$|^\.DS_Store$|~\.skp$/i.test(f.name)).map(f => ({ project_id: p.id, drive_id: f.id, naam: f.name, pad: f.path || "", url: f.url, mime: f.mime || "", grootte: f.size || null, gewijzigd: f.updated || null, gesynct_op: new Date().toISOString() }));
    const { data, error } = await sb.from("documenten").upsert(rows, { onConflict: "project_id,drive_id" }).select();
    if (error) toast("Documenten niet bewaard: " + error.message); else { Object.values(S.documenten).filter(d => d.project_id === p.id && !rows.some(r => r.drive_id === d.drive_id)).forEach(d => { sb.from("documenten").delete().eq("id", d.id); delete S.documenten[d.id]; }); (data || []).forEach(d => S.documenten[d.id] = d); }
    if (quiet) { render(); return; }
    loader.done("drive." + action);
    render(); toast(j.created ? `Map aangemaakt met ${rows.length} bestanden` : `Map gekoppeld · ${rows.length} bestanden`);
  } catch (e) { if (!quiet) loader.fail(); throw e; }
}
/* Dossier geopend: bestandenlijst stil vernieuwen als de laatste synchronisatie ouder is dan een uur (één keer per project per sessie) */
function driveAutoRefresh(p) {
  if (!driveReady() || !p.drive_folder_id) return;
  S.driveAuto = S.driveAuto || {}; if (S.driveAuto[p.id]) return;
  const docs = docsOf(p.id); const last = docs.map(d => d.gesynct_op || "").sort().pop() || "";
  if (last && Date.now() - new Date(last).getTime() < 3600000) return;
  S.driveAuto[p.id] = Date.now();
  driveSync(p, "list", true).catch(e => console.warn("Drive automatisch vernieuwen:", e.message));
}
/* document delen met de klant: eerst de Drive-rechten (iedereen met de link mag lezen), dan het vinkje in de database */
async function docShare(id, on, wie = "klant") {
  const d = S.documenten[id]; if (!d) return;
  const veld = wie === "aannemers" ? "gedeeld_aannemers" : "gedeeld";
  // de link moet leesbaar zijn zolang het bestand met iemand (klant of aannemers) gedeeld is
  const andere = wie === "aannemers" ? !!d.gedeeld : !!d.gedeeld_aannemers; const linkAan = on || andere;
  try { if (driveReady() && linkAan !== (!!d.gedeeld || !!d.gedeeld_aannemers)) await driveCall("share", { fileId: d.drive_id, on: linkAan, token: S.session?.access_token || "" }); }
  catch (e) { toast("Drive-rechten niet aangepast: " + e.message, 6000); render(); return; }
  await dbUpdate("documenten", id, { [veld]: on }).catch(() => { });
  toast(on ? (wie === "aannemers" ? "Gedeeld met de aannemers van dit project" : "Gedeeld met de klant") : "Niet meer gedeeld" + (wie === "aannemers" ? " met de aannemers" : " met de klant"));
}
const docsOf = (pid) => Object.values(S.documenten).filter(d => d.project_id === pid).sort((a, b) => (a.pad || "").localeCompare(b.pad || "") || a.naam.localeCompare(b.naam));


/* ---------- Contacten: klanten, aannemers, leveranciers, … en hun koppeling aan projecten ---------- */
const CONTACT_SOORT = { klant: "Klant", aannemer: "Aannemer", leverancier: "Leverancier", architect: "Architect", studiebureau: "Studiebureau", andere: "Andere" };
const CONTACT_ROL = { bouwheer: "Bouwheer", contactpersoon: "Contactpersoon", aannemer: "Aannemer", leverancier: "Leverancier", architect: "Architect", studiebureau: "Studiebureau", andere: "Andere" };
const ROL_INTERN = { bouwheer: false, contactpersoon: false, architect: false, aannemer: true, leverancier: true, studiebureau: true, andere: true };
const contactsReady = () => S.contacten && Object.keys(S.contacten).length > 0 || Object.keys(S.project_contacten || {}).length > 0;
const contactsOf = (pid) => Object.values(S.project_contacten).filter(x => x.project_id === pid).map(x => ({ ...x, c: S.contacten[x.contact_id] })).filter(x => x.c).sort((a, b) => Object.keys(CONTACT_ROL).indexOf(a.rol) - Object.keys(CONTACT_ROL).indexOf(b.rol) || a.c.naam.localeCompare(b.c.naam));
const projectsOfContact = (cid) => Object.values(S.project_contacten).filter(x => x.contact_id === cid).map(x => ({ ...x, p: S.projecten[x.project_id] })).filter(x => x.p).sort((a, b) => (b.p.nummer || "").localeCompare(a.p.nummer || ""));
const contactLabel = (c) => c.bedrijf && c.bedrijf !== c.naam ? `${c.naam} · ${c.bedrijf}` : c.naam;
function vContacten() {
  if (!Object.keys(S.contacten).length && !Object.keys(S.project_contacten).length) return `<div class="page-head"><div><div class="eyebrow">0 contacten</div><h1>Contacten</h1></div></div><div class="panel"><div class="empty"><b>Contacten nog niet beschikbaar</b>Voer databasescript <code>sql/009_contacten.sql</code> uit in Supabase; bestaande projecten krijgen dan meteen hun bouwheer als contact.</div></div>`;
  const q = (S.cfilters.q || "").toLowerCase();
  const list = Object.values(S.contacten).filter(c => c.actief !== false || S.cfilters.soort === "inactief").filter(c => !S.cfilters.soort || S.cfilters.soort === "inactief" ? (S.cfilters.soort !== "inactief" || c.actief === false) : c.soort === S.cfilters.soort)
    .filter(c => !q || [c.naam, c.bedrijf, c.contactpersoon, c.gemeente, c.email, c.gsm, c.vakgebied].some(v => (v || "").toLowerCase().includes(q))).sort((a, b) => a.naam.localeCompare(b.naam));
  const beheer = isBeheer();
  return `
  <div class="page-head"><div><div class="eyebrow">${list.length} contacten</div><h1>Contacten</h1><div class="sub">Klanten, aannemers, leveranciers en andere partijen — gekoppeld aan projecten. Aannemers en leveranciers zijn intern; via Dossier › Contacten geef je ze toegang tot het aannemersportaal (elke aannemer ziet enkel zijn eigen projecten en loten).</div></div>
    <div class="actions"><button class="btn primary" data-act="contact-new">+ Contact</button></div></div>
  <div class="filters"><input data-cfilter="q" placeholder="Zoeken op naam, bedrijf, gemeente, e-mail…" value="${esc(S.cfilters.q || "")}" style="min-width:260px"><select data-cfilter="soort"><option value="">Alle soorten</option>${opts(Object.entries(CONTACT_SOORT), S.cfilters.soort)}<option value="inactief" ${S.cfilters.soort === "inactief" ? "selected" : ""}>Inactief</option></select></div>
  <div class="panel tw"><table class="t"><thead><tr><th>Naam</th><th>Soort</th><th>Gemeente</th><th>E-mail</th><th>GSM</th><th>Vakgebied / loten</th><th class="r">Projecten</th></tr></thead><tbody>
    ${list.map(c => { const ps = projectsOfContact(c.id); return `<tr class="click" data-contact="${c.id}"><td><div class="row-title">${esc(c.naam)}<small>${[c.bedrijf && c.bedrijf !== c.naam ? c.bedrijf : "", c.contactpersoon, c.soort === "klant" ? KLANTCODE[c.klanttype] : ""].filter(Boolean).map(esc).join(" · ")}</small></div></td>
      <td><span class="pill ${c.soort === "klant" ? "st-lopend" : c.soort === "aannemer" || c.soort === "leverancier" ? "st-on_hold" : "st-offerte"}">${CONTACT_SOORT[c.soort] || c.soort}</span></td><td>${esc(c.gemeente || "—")}</td>
      <td>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : "—"}</td><td class="num">${c.gsm ? `<a href="tel:${esc(c.gsm)}">${esc(c.gsm)}</a>` : "—"}</td>
      <td class="muted" style="font-size:12px">${esc(c.vakgebied || "")}${(c.loten || []).length ? `<br>loten ${c.loten.join(", ")}` : ""}</td>
      <td class="r num">${ps.length}</td></tr>`; }).join("") || `<tr><td colspan="7"><div class="empty"><b>Geen contacten gevonden</b>Pas de zoekopdracht aan of maak een nieuw contact.</div></td></tr>`}
  </tbody></table></div>`;
}
function contactForm(c = {}, after) {
  const isNew = !c.id; const ps = isNew ? [] : projectsOfContact(c.id);
  openModal(isNew ? "Nieuw contact" : "Contact bewerken", `<div class="form-grid">
    <div class="field"><label for="c_soort">Soort</label><select id="c_soort" name="soort">${opts(Object.entries(CONTACT_SOORT), c.soort || "klant")}</select></div>
    <div class="field klant"><label>Type klant</label><div class="seg"><label><input type="radio" name="klanttype" value="particulier" ${(c.klanttype || "particulier") === "particulier" ? "checked" : ""}> Particulier</label><label><input type="radio" name="klanttype" value="zakelijk" ${c.klanttype === "zakelijk" ? "checked" : ""}> Zakelijk</label></div></div>
    <div class="field"><label for="c_naam">Naam <span class="muted" style="font-weight:400">(persoon of bedrijf, zoals in de projectmap)</span></label><input id="c_naam" name="naam" required value="${esc(c.naam || "")}"></div>
    <div class="field"><label for="c_bedrijf">Bedrijfsnaam</label><input id="c_bedrijf" name="bedrijf" value="${esc(c.bedrijf || "")}"></div>
    <div class="field"><label for="c_cp">Contactpersoon</label><input id="c_cp" name="contactpersoon" value="${esc(c.contactpersoon || "")}"></div>
    <div class="field"><label for="c_btw">BTW-nummer</label><input id="c_btw" name="btw_nummer" value="${esc(c.btw_nummer || "")}" placeholder="BE 0123.456.789"></div>
    <div class="field"><label for="c_email">E-mail</label><input id="c_email" name="email" type="email" value="${esc(c.email || "")}"></div>
    <div class="field"><label for="c_email2">E-mail 2</label><input id="c_email2" name="email2" type="email" value="${esc(c.email2 || "")}"></div>
    <div class="field"><label for="c_gsm">GSM</label><input id="c_gsm" name="gsm" type="tel" value="${esc(c.gsm || "")}"></div>
    <div class="field"><label for="c_tel">Telefoon</label><input id="c_tel" name="tel" type="tel" value="${esc(c.tel || "")}"></div>
    <div class="field"><label for="f_adres">Adres (straat + nr)</label><input id="f_adres" name="adres" value="${esc(c.adres || "")}"></div>
    <div class="field"><label for="f_pc">Postcode</label><input id="f_pc" name="postcode" inputmode="numeric" maxlength="4" value="${esc(c.postcode || "")}" list="pc_list" autocomplete="off"><datalist id="pc_list"></datalist></div>
    <div class="field"><label for="f_gem">Gemeente</label><input id="f_gem" name="gemeente" value="${esc(c.gemeente || "")}" list="gem_list" autocomplete="off"><datalist id="gem_list"></datalist></div>
    <div class="field vak"><label for="c_vak">Vakgebied</label><input id="c_vak" name="vakgebied" value="${esc(c.vakgebied || "")}" placeholder="bv. schrijnwerk, keukens, elektriciteit"></div>
    <div class="field span2 vak"><label>Typische loten <span class="muted" style="font-weight:400">— waarvoor je deze partij inschakelt</span></label><div class="fase-list">${lotenList().map(l => `<label class="chk"><input type="checkbox" name="lot" value="${l.nr}" ${(c.loten || []).includes(l.nr) ? "checked" : ""}> <span>${esc(lotName(l.nr))}</span></label>`).join("")}</div></div>
    <div class="field span2"><label for="c_not">Notities <span class="muted" style="font-weight:400">(intern)</span></label><textarea id="c_not" name="notities">${esc(c.notities || "")}</textarea></div>
    ${isNew ? "" : `<div class="field"><label for="c_act">Actief</label><select id="c_act" name="actief"><option value="1" ${c.actief !== false ? "selected" : ""}>Ja</option><option value="0" ${c.actief === false ? "selected" : ""}>Nee (verborgen)</option></select></div>`}
    ${ps.length ? `<div class="field span2"><label>Projecten</label><div class="tw"><table class="t"><tbody>${ps.map(x => `<tr class="click" data-open="${x.p.id}" data-close="1"><td class="num muted" style="width:70px">${esc(x.p.nummer || "")}</td><td>${esc(projName(x.p))}</td><td><span class="pill st-offerte">${CONTACT_ROL[x.rol] || x.rol}</span>${(x.loten || []).length ? ` <small class="muted">loten ${x.loten.join(", ")}</small>` : ""}</td><td><span class="pill st-${x.p.status}">${PROJ_STATUS[x.p.status] || x.p.status}</span></td></tr>`).join("")}</tbody></table></div></div>` : ""}
  </div>`, {
    wide: true,
    onSave: async (d) => {
      const row = { soort: d.soort, naam: d.naam.trim(), bedrijf: (d.bedrijf || "").trim(), contactpersoon: (d.contactpersoon || "").trim(), klanttype: d.klanttype || "particulier", btw_nummer: (d.btw_nummer || "").trim(), email: (d.email || "").trim(), email2: (d.email2 || "").trim(), gsm: telFmt(d.gsm), tel: telFmt(d.tel), adres: (d.adres || "").trim(), postcode: (d.postcode || "").trim(), gemeente: (d.gemeente || "").trim(), vakgebied: (d.vakgebied || "").trim(), loten: [...$("#mform").querySelectorAll('input[name="lot"]:checked')].map(i => Number(i.value)), notities: d.notities || "", updated_at: new Date().toISOString() };
      if (!isNew) row.actief = d.actief === "1";
      const saved = isNew ? await dbInsert("contacten", row) : await dbUpdate("contacten", c.id, row);
      toast(isNew ? "Contact aangemaakt" : "Contact bewaard"); if (after) after(saved);
    },
    onDelete: isNew ? null : async () => {
      if (projectsOfContact(c.id).length) { toast("Dit contact is aan projecten gekoppeld — zet het op inactief of verwijder eerst de koppelingen."); throw new Error("gekoppeld"); }
      await dbDelete("contacten", c.id); toast("Contact verwijderd");
    },
  });
  wirePostcode();
  const form = $("#mform"); const sync = () => { const soort = form.querySelector("#c_soort").value; form.querySelectorAll(".field.klant").forEach(el => el.style.display = soort === "klant" ? "" : "none"); form.querySelectorAll(".field.vak").forEach(el => el.style.display = soort === "aannemer" || soort === "leverancier" || soort === "studiebureau" ? "" : "none"); };
  form.addEventListener("change", sync); sync();
}
/* koppeling contact ↔ project */
function linkContactForm(pid, rol) {
  const p = S.projecten[pid]; const present = new Set(contactsOf(pid).map(x => x.contact_id + "|" + x.rol));
  const cs = Object.values(S.contacten).filter(c => c.actief !== false).sort((a, b) => a.naam.localeCompare(b.naam));
  const soortFor = (r) => ({ bouwheer: "klant", contactpersoon: "klant", aannemer: "aannemer", leverancier: "leverancier", architect: "architect", studiebureau: "studiebureau" })[r] || "";
  openModal("Contact koppelen aan " + p.klant, `<div class="form-grid">
    <div class="field"><label for="lc_rol">Rol in dit project</label><select id="lc_rol" name="rol">${opts(Object.entries(CONTACT_ROL), rol || "aannemer")}</select></div>
    <div class="field"><label for="lc_q">Zoeken</label><input id="lc_q" placeholder="naam, bedrijf, vakgebied…" autocomplete="off"></div>
    <div class="field span2"><label for="lc_c">Contact</label><select id="lc_c" name="contact_id" size="8" style="height:auto">${cs.map(c => `<option value="${c.id}" data-soort="${c.soort}">${esc(contactLabel(c))} — ${CONTACT_SOORT[c.soort]}${c.vakgebied ? " · " + esc(c.vakgebied) : ""}${c.gemeente ? " · " + esc(c.gemeente) : ""}</option>`).join("")}</select><span class="muted" style="font-size:12px">Staat de partij er nog niet bij? <button type="button" class="btn ghost sm" data-act="contact-new-inline">+ Nieuw contact</button></span></div>
    <div class="field span2 lot"><label>Loten van dit project voor deze partij</label><div class="fase-list">${lotenList().map(l => `<label class="chk"><input type="checkbox" name="lot" value="${l.nr}"> <span>${esc(lotName(l.nr))}</span></label>`).join("")}</div></div>
    <div class="field span2"><label for="lc_not">Notitie</label><input id="lc_not" name="notitie" placeholder="bv. offerte gevraagd op 12/09"></div>
  </div>`, {
    saveLabel: "Koppelen", wide: true,
    onSave: async (d) => {
      if (!d.contact_id) { toast("Kies een contact."); return false; }
      if (present.has(d.contact_id + "|" + d.rol)) { toast("Dit contact is al met die rol gekoppeld."); return false; }
      const row = { project_id: pid, contact_id: d.contact_id, rol: d.rol, intern: ROL_INTERN[d.rol] !== false, loten: [...$("#mform").querySelectorAll('input[name="lot"]:checked')].map(i => Number(i.value)), notitie: (d.notitie || "").trim() };
      await dbInsert("project_contacten", row); toast("Contact gekoppeld");
    },
  });
  const form = $("#mform"); const sel = $("#lc_c"), q = $("#lc_q"), rolSel = $("#lc_rol");
  const sync = () => { const soort = soortFor(rolSel.value); const qq = q.value.trim().toLowerCase(); let first = null;
    [...sel.options].forEach(o => { const c = S.contacten[o.value]; const hit = (!qq || o.textContent.toLowerCase().includes(qq)) && (!soort || c.soort === soort || qq); o.hidden = !hit; if (hit && !first) first = o; });
    if (![...sel.selectedOptions].some(o => !o.hidden) && first) first.selected = true;
    form.querySelectorAll(".field.lot").forEach(el => el.style.display = ["aannemer", "leverancier", "studiebureau"].includes(rolSel.value) ? "" : "none"); };
  q.addEventListener("input", sync); rolSel.addEventListener("change", sync); sync();
  form.querySelector("[data-act=contact-new-inline]").onclick = () => { const rolNow = rolSel.value; closeModal(); contactForm({ soort: soortFor(rolNow) || "andere" }, () => linkContactForm(pid, rolNow)); };
}
/* portaalkolom bij een contact: toegang geven (beheer, via het Drive-script), status en laatste bezoek */
const KLANT_ROLLEN = ["bouwheer", "contactpersoon"];
function portaalCel(x) {
  const c = x.c; const klantRol = KLANT_ROLLEN.includes(x.rol); const rol = klantRol ? "klant" : "aannemer";
  if (!klantRol && (schemaV() < 25 || c.soort === "klant")) return `<span class="muted">—</span>`;
  const lbl = klantRol ? "" : `<small class="muted" style="display:block">aannemersportaal</small>`;
  if (c.user_id) return `<span class="pill st-afgerond">actief</span>${lbl}<small class="muted" style="display:block">${c.portaal_login ? "laatst " + fmtLong(c.portaal_login.slice(0, 10)) : "nog niet ingelogd"}</small>${isBeheer() && driveReady() ? `<button class="btn ghost sm" data-act="portaal-invite" data-cid="${c.id}" data-pid="${x.project_id}" data-rol="${rol}" title="Nieuwe link om (opnieuw) een wachtwoord te kiezen">Link opnieuw sturen</button>` : ""}`;
  if (!c.email) return `<span class="muted">geen e-mail</span>`;
  if (!isBeheer()) return `<span class="muted">geen toegang</span>`;
  return driveReady() ? `<button class="btn sm" data-act="portaal-invite" data-cid="${c.id}" data-pid="${x.project_id}" data-rol="${rol}">${klantRol ? "Portaal-toegang geven" : "Aannemersportaal"}</button>` : `<span class="muted">Drive-script nodig</span>`;
}
function portaalInviteForm(cid, pid, rol = "klant") {
  const c = S.contacten[cid], p = S.projecten[pid]; if (!c || !p) return;
  const opnieuw = !!c.user_id; const aan = rol === "aannemer";
  const nProj = Object.values(S.project_contacten).filter(x => x.contact_id === cid && (aan ? !KLANT_ROLLEN.includes(x.rol) : KLANT_ROLLEN.includes(x.rol))).length;
  openModal(opnieuw ? "Portaallink opnieuw sturen" : aan ? "Toegang tot het aannemersportaal geven" : "Portaal-toegang geven", `<div class="form-grid">
    <div class="field span2"><p style="margin:0">${opnieuw ? `<b>${esc(c.naam)}</b> heeft al toegang. We sturen een nieuwe mail met een link om een (nieuw) wachtwoord te kiezen.` : `<b>${esc(c.naam)}</b> krijgt een e-mail van BROS (archief@bros.be) met een persoonlijke link naar het ${aan ? "aannemersportaal" : "klantenportaal"}. Daar kiest hij/zij een wachtwoord en ziet daarna het project <b>${esc(p.klant)}${p.naam && p.naam !== p.klant ? " · " + esc(p.naam) : ""}</b>${nProj > 1 ? ` (en de andere projecten waar dit contact aan gekoppeld is${aan ? "" : " als bouwheer of contactpersoon"})` : ""}.`}</p></div>
    <div class="field"><label for="pi_email">E-mailadres</label><input id="pi_email" name="email" type="email" required value="${esc(c.email)}"></div>
    <div class="field"><label for="pi_naam">Aanspreking in de mail</label><input id="pi_naam" name="naam" value="${esc(c.contactpersoon || c.naam)}"></div>
    <div class="field span2"><p class="muted" style="margin:0;font-size:12px">${aan ? "Wat de aannemer ziet: enkel zijn eigen projecten en loten — de vaststellingen die aan hem toegewezen zijn (opgelost melden met bewijsfoto), de werfplannen, de verslagen die hij ontving, documenten met de schakelaar 'aannemers', de gedeelde planning en de prijsaanvragen die jullie hem sturen. Nooit kostprijzen, marges, klantprijzen of prijzen van andere aannemers. Vragen die hij stelt komen als voorstel in de wachtrij." : "Wat de klant ziet: meetstaat met verkoopprijzen, facturen, planning, gedeelde documenten en het team. Geen kostprijzen, marges, forfait of interne notities. De uren van een taak zijn enkel zichtbaar als de schakelaar Klant bij die taak aanstaat."}</p></div>
  </div>`, {
    saveLabel: opnieuw ? "Link sturen" : "Uitnodigen", onSave: async (d) => {
      loader.start("portaal.invite", "Uitnodiging versturen…", 6000);
      try {
        const j = await driveCall("invite", { email: d.email.trim(), naam: d.naam.trim(), contact_id: cid, rol, token: S.session?.access_token || "" });
        const { data } = await sb.from("contacten").select("*").eq("id", cid).single(); if (data) S.contacten[cid] = data; if (j.user_id && !S.contacten[cid].user_id) S.contacten[cid] = { ...S.contacten[cid], user_id: j.user_id, portaal_sinds: new Date().toISOString() };
        loader.done("portaal.invite"); render(); toast(j.bestaand ? `Nieuwe link gestuurd naar ${d.email.trim()}` : `Uitnodiging gestuurd naar ${d.email.trim()}`);
      } catch (e) { loader.fail(); toast("Uitnodigen mislukt: " + e.message, 6000); return false; }
    },
  });
}
function vProjectContacten(p) {
  const rows = contactsOf(p.id); const beheer = isBeheer(); const v11 = schemaV() >= 11;
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Contacten bij dit project</h3><div class="muted" style="font-size:12px;margin-top:2px">Bouwheer en contactpersonen zijn zichtbaar voor de klant in het portaal; aannemers, leveranciers en studiebureaus zijn intern en zien in het aannemersportaal enkel hun eigen projecten en loten.</div></div>
      <div class="actions"><button class="btn sm" data-act="contact-link" data-pid="${p.id}" data-rol="aannemer">+ Aannemer</button><button class="btn sm" data-act="contact-link" data-pid="${p.id}" data-rol="leverancier">+ Leverancier</button><button class="btn sm" data-act="contact-link" data-pid="${p.id}" data-rol="contactpersoon">+ Contact</button></div></div>
    ${rows.length ? `<div class="tw"><table class="t"><thead><tr><th>Rol</th><th>Contact</th><th>E-mail · GSM</th><th>Loten</th><th>Zichtbaar</th>${v11 ? `<th>Portaal</th>` : ""}<th></th></tr></thead><tbody>
      ${rows.map(x => `<tr class="click" data-contact="${x.c.id}"><td><span class="pill ${x.rol === "bouwheer" ? "st-lopend" : x.intern ? "st-on_hold" : "st-offerte"}">${CONTACT_ROL[x.rol] || x.rol}</span></td><td><div class="row-title">${esc(x.c.naam)}<small>${[x.c.bedrijf && x.c.bedrijf !== x.c.naam ? x.c.bedrijf : "", x.c.contactpersoon, x.c.vakgebied].filter(Boolean).map(esc).join(" · ")}${x.notitie ? " · " + esc(x.notitie) : ""}</small></div></td>
        <td style="font-size:12px">${x.c.email ? `<a href="mailto:${esc(x.c.email)}">${esc(x.c.email)}</a>` : ""}${x.c.gsm ? `<br><a href="tel:${esc(x.c.gsm)}">${esc(x.c.gsm)}</a>` : ""}</td><td class="muted" style="font-size:12px">${(x.loten || []).map(l => esc(lotName(l))).join("<br>") || "—"}</td><td class="muted" style="font-size:12px">${x.intern ? "intern" : "klant + intern"}</td>
        ${v11 ? `<td style="font-size:12px">${portaalCel(x)}</td>` : ""}
        <td class="r"><button class="btn ghost sm danger" data-act="contact-unlink" data-id="${x.id}" aria-label="Ontkoppelen">✕</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><b>Nog geen contacten gekoppeld</b>Koppel de bouwheer, aannemers en leveranciers van dit project.</div>`}</div>`;
}

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
const msVerkoopEP = (r) => r.verkoop_ep != null ? Number(r.verkoop_ep) : (Number(r.eenheidsprijs) || 0) * (1 + msMarge(r));
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
  // klantweergave: kostprijs, marge en btw-kolom verbergen (bv. tijdens een bespreking met de klant) — onthouden per browser
  const rows = msRows(p.id); const beheer = isBeheer() && !S.msKlant; const t = msTotals(p.id);
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
        <td style="width:104px">${sel(r, "status", opts(Object.entries(MS_STATUS), r.status))}${r.akkoord_op ? `<small class="muted" style="display:block;color:var(--ok)" title="Goedgekeurd door de klant in het portaal">✓ klant ${fmt(r.akkoord_op.slice(0, 10))}</small>` : ""}</td>
        <td class="r" style="width:36px"><button class="btn ghost sm danger" data-act="ms-del" data-id="${r.id}" aria-label="Verwijderen">✕</button></td></tr>`; }).join(""); }).join("");
  return kpi + vGoedkeuringen(p) + vPrijsaanvragen(p) + `<div class="panel"><div class="panel-head"><div><h3>Meetstaat</h3><div class="muted" style="font-size:12px;margin-top:2px">${rows.length ? `${rows.length} posten in ${lots.length} loten` : "Nog leeg"} · klik in een veld om het te wijzigen, bewaard bij verlaten van het veld</div></div>
      <div class="actions">${isBeheer() ? `<button class="btn sm ${S.msKlant ? "primary" : ""}" data-act="ms-klant" title="Kostprijs, marge en btw-kolom verbergen, bv. als je de meetstaat met de klant overloopt (sneltoets: K)">${S.msKlant ? "👁 Klantweergave aan" : "Klantweergave"}</button>` : ""}${schemaV() >= 13 && rows.some(r => gkKandidaat(r)) ? `<button class="btn sm" data-act="gk-new" data-pid="${p.id}" title="Offerte of meerwerk bevroren ter goedkeuring in het klantenportaal zetten">Ter goedkeuring voorleggen</button>` : ""}<button class="btn sm" data-act="ms-import" data-pid="${p.id}" title="Een bestaande meetstaat (Excel, elk BROS-sjabloon) inlezen als posten">Importeren uit Excel</button>${rows.length ? `<button class="btn sm" data-act="ms-export" data-pid="${p.id}" title="Excel in het BROS-sjabloon aanmaken in Documenten/Meetstaat van de projectmap">Exporteren naar Drive (Excel)</button>` : ""}<button class="btn sm" data-act="ms-add-post" data-pid="${p.id}">+ Post</button><button class="btn sm primary" data-act="ms-add-lot" data-pid="${p.id}">+ Lot toevoegen</button></div></div>
    ${rows.length ? `<div class="tw"><table class="t ms"><thead><tr><th>Nr</th><th>Omschrijving</th><th>Locatie</th><th>Hoev.</th><th>Eenh.</th>${beheer ? `<th title="Kostprijs / aannemersprijs excl. btw">Kost EP</th><th>Marge</th>` : ""}<th class="r">Klant EP</th><th class="r">Totaal excl.</th>${beheer ? `<th>Btw</th>` : ""}<th>Status</th><th></th></tr></thead><tbody>${body}</tbody></table></div>` : `<div class="empty"><b>Nog geen posten</b>Voeg een lot toe (met de standaardposten) of kies losse posten uit de bibliotheek.</div>`}</div>`;
}
/* ---------- Prijsaanvragen (script 025): eenheidsprijzen opvragen bij aannemers via het aannemersportaal, vergelijken en overnemen als kostprijs ---------- */
const PA_STATUS = { open: "In te vullen", ingediend: "Ingediend", gekozen: "Gekozen", afgesloten: "Afgesloten" };
const paOf = (pid) => Object.values(S.prijsaanvragen || {}).filter(a => a.project_id === pid).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
const paRegels = (aid) => Object.values(S.prijsaanvraag_regels || {}).filter(r => r.aanvraag_id === aid);
const paPosten = (a) => msRows(a.project_id).filter(r => (a.loten || []).includes(r.lot) && r.status !== "vervallen");
function vPrijsaanvragen(p) {
  if (schemaV() < 25 || !isBeheer() || S.msKlant) return "";
  const as = paOf(p.id); const aannemers = contactsOf(p.id).filter(x => !KLANT_ROLLEN.includes(x.rol) && x.c.soort !== "klant");
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Prijsaanvragen bij aannemers</h3><div class="muted" style="font-size:12px;margin-top:2px">De aannemer vult per post een eenheidsprijs in via zijn portaal (hij ziet enkel hoeveelheden, nooit jullie prijzen); daarna vergelijk je en neem je de gekozen prijzen over als kostprijs.</div></div>
      <div class="actions">${as.some(a => a.status !== "afgesloten") ? `<button class="btn sm" data-act="pa-cmp" data-pid="${p.id}">Vergelijken</button>` : ""}<button class="btn sm primary" data-act="pa-new" data-pid="${p.id}" ${aannemers.length ? "" : `title="Koppel eerst een aannemer aan dit project (Dossier › Contacten)"`}>+ Prijsaanvraag</button></div></div>
    ${as.length ? `<div class="tw"><table class="t"><thead><tr><th>Aanvraag</th><th>Aannemer</th><th>Loten</th><th class="r">Ingevuld</th><th class="r">Totaal</th><th>Reageren vóór</th><th>Status</th><th></th></tr></thead><tbody>
      ${as.map(a => { const c = S.contacten[a.contact_id]; const ps = paPosten(a); const rs = paRegels(a.id).filter(r => r.eenheidsprijs != null); const byPost = Object.fromEntries(rs.map(r => [r.post_id, r])); const tot = ps.reduce((s, r) => s + (byPost[r.id] ? Number(byPost[r.id].eenheidsprijs) * Number(r.hoeveelheid || 0) : 0), 0);
        return `<tr class="${a.status === "afgesloten" ? "ms-dead" : ""}"><td><div class="row-title">${esc(a.titel || "Prijsaanvraag")}<small>${fmtLong((a.created_at || "").slice(0, 10))}${a.ingediend_op ? " · ingediend " + fmtLong(a.ingediend_op.slice(0, 10)) : ""}${a.opmerking ? ` · “${esc(a.opmerking)}”` : ""}</small></div></td><td>${c ? `<a href="#" data-contact="${c.id}">${esc(c.naam)}</a>${c.user_id ? "" : ` <span class="pill st-offerte" title="Nog geen login voor het aannemersportaal; de uitnodiging zit in de mail">geen login</span>`}` : "—"}</td><td class="muted" style="font-size:12px">${(a.loten || []).map(l => esc(lotName(l))).join("<br>")}</td><td class="r num">${ps.filter(r => byPost[r.id]).length} / ${ps.length}</td><td class="r num">${rs.length ? eur(tot) : "—"}</td><td class="num ${a.status === "open" && a.deadline && a.deadline < todayIso ? "late" : ""}">${a.deadline ? fmtLong(a.deadline) : "—"}</td><td><span class="pill ${a.status === "gekozen" ? "done" : a.status === "ingediend" ? "st-lopend" : a.status === "open" ? "st-offerte" : "kl"}">${PA_STATUS[a.status]}</span></td>
          <td class="r" style="white-space:nowrap">${a.status !== "afgesloten" && rs.length ? `<button class="btn ghost sm" data-act="pa-take" data-id="${a.id}" title="De ingevulde prijzen van deze aannemer overnemen als kostprijs in de meetstaat">Overnemen</button>` : ""}${a.status === "open" && driveReady() ? `<button class="btn ghost sm" data-act="pa-remind" data-id="${a.id}" title="Herinnering mailen">Herinneren</button>` : ""}${a.status !== "afgesloten" ? `<button class="btn ghost sm" data-act="pa-close" data-id="${a.id}" title="Afsluiten (de aannemer kan niets meer invullen)">Afsluiten</button>` : ""}<button class="btn ghost sm danger" data-act="pa-del" data-id="${a.id}" aria-label="Verwijderen">✕</button></td></tr>`; }).join("")}
    </tbody></table></div>` : `<div class="empty"><b>Nog geen prijsaanvragen</b>Stuur een aannemer de posten van zijn lot(en); hij vult de prijzen in via het aannemersportaal.</div>`}</div>`;
}
function paForm(pid) {
  const p = S.projecten[pid]; if (!p) return;
  const aannemers = contactsOf(pid).filter(x => !KLANT_ROLLEN.includes(x.rol) && x.c.soort !== "klant");
  if (!aannemers.length) { toast("Koppel eerst een aannemer aan dit project (Dossier › Contacten)."); return; }
  const lots = [...new Set(msRows(pid).filter(r => r.status !== "vervallen").map(r => r.lot))].sort((a, b) => a - b);
  if (!lots.length) { toast("De meetstaat is nog leeg."); return; }
  const d0 = new Date(); d0.setDate(d0.getDate() + 14); const dl = d0.toISOString().slice(0, 10);
  openModal("Prijsaanvraag versturen", `<div class="form-grid">
    <div class="field"><label for="pa_c">Aannemer</label><select id="pa_c" name="contact_id">${aannemers.map(x => `<option value="${x.c.id}" data-loten="${(x.loten || []).length ? x.loten.join(",") : (x.c.loten || []).join(",")}">${esc(x.c.naam)}${x.c.vakgebied ? " · " + esc(x.c.vakgebied) : ""}${x.c.email ? "" : " (geen e-mail!)"}${x.c.user_id ? "" : " · nog geen portaallogin"}</option>`).join("")}</select><small class="muted">Zonder login krijgt hij in dezelfde mail een uitnodiging voor het aannemersportaal.</small></div>
    <div class="field"><label for="pa_dl">Reageren vóór</label><input id="pa_dl" name="deadline" type="date" value="${dl}"></div>
    <div class="field span2"><label for="pa_t">Titel</label><input id="pa_t" name="titel" value="Prijsaanvraag ${esc(p.klant)}"></div>
    <div class="field span2"><label>Loten <span class="muted" style="font-weight:400">— de aannemer ziet de posten van deze loten met hoeveelheden en eenheden</span></label><div class="fase-list">${lots.map(l => `<label class="chk"><input type="checkbox" name="lot" value="${l}"> <span>${esc(lotName(l))} <small class="muted">${msRows(pid).filter(r => r.lot === l && r.status !== "vervallen").length} posten</small></span></label>`).join("")}</div></div>
    <div class="field span2"><label for="pa_b">Bericht aan de aannemer</label><textarea id="pa_b" name="bericht" rows="3">Beste, graag je eenheidsprijzen (excl. btw, inclusief levering en plaatsing) voor onderstaande posten. Opmerkingen of alternatieven kan je per post toevoegen.</textarea></div>
  </div>`, {
    wide: true, saveLabel: "Versturen", onSave: async (d) => {
      const loten = [...$("#mform").querySelectorAll('input[name="lot"]:checked')].map(i => Number(i.value)); if (!loten.length) { toast("Kies minstens één lot."); return false; }
      const c = S.contacten[d.contact_id]; if (!c || !c.email) { toast("Dit contact heeft geen e-mailadres."); return false; }
      const row = await dbInsert("prijsaanvragen", { project_id: pid, contact_id: d.contact_id, loten, titel: d.titel.trim(), bericht: (d.bericht || "").trim(), deadline: d.deadline || null, created_by: S.me.id });
      if (driveReady()) { try { const j = await driveCall("prijsaanvraagmail", { id: row.id, soort: "nieuw", token: S.session?.access_token || "" }); toast(`Prijsaanvraag gemaild naar ${j.naar || c.email}${j.uitgenodigd ? " (met uitnodiging voor het portaal)" : ""}`, 6000); } catch (e) { toast("Aanvraag bewaard, maar mailen mislukte: " + e.message, 8000); } }
      else toast("Prijsaanvraag bewaard (niet gemaild: Drive-script niet ingesteld)");
    },
  });
  const sel = $("#pa_c"); const syncLots = () => { const ls = (sel.selectedOptions[0]?.dataset.loten || "").split(",").filter(Boolean).map(Number); $("#mform").querySelectorAll('input[name="lot"]').forEach(i => i.checked = ls.includes(Number(i.value))); }; sel.addEventListener("change", syncLots); syncLots();
}
function paVergelijk(pid) {
  const as = paOf(pid).filter(a => a.status !== "afgesloten"); if (!as.length) return;
  const lots = [...new Set(as.flatMap(a => a.loten || []))].sort((a, b) => a - b);
  const prijs = (a, postId) => { const r = paRegels(a.id).find(x => x.post_id === postId); return r && r.eenheidsprijs != null ? Number(r.eenheidsprijs) : null; };
  const opm = (a, postId) => { const r = paRegels(a.id).find(x => x.post_id === postId); return r ? r.opmerking : ""; };
  const naam = (a) => S.contacten[a.contact_id]?.naam || "?";
  let html = `<div class="tw"><table class="t ms"><thead><tr><th>Nr</th><th>Omschrijving</th><th class="r">Hoev.</th><th class="r" title="Huidige kostprijs in de meetstaat">Kost nu</th>${as.map(a => `<th class="r">${esc(naam(a))}<small class="muted" style="display:block;font-weight:400">${PA_STATUS[a.status]}</small></th>`).join("")}</tr></thead><tbody>`;
  const tot = { nu: 0 }; as.forEach(a => tot[a.id] = 0);
  lots.forEach(lot => {
    const rows = msRows(pid).filter(r => r.lot === lot && r.status !== "vervallen"); const sub = { nu: 0 }; as.forEach(a => sub[a.id] = 0);
    html += `<tr class="ms-lot"><td colspan="${4 + as.length}">${esc(lotName(lot))}</td></tr>`;
    rows.forEach(r => { const h = Number(r.hoeveelheid || 0); const nu = Number(r.eenheidsprijs) || 0; sub.nu += nu * h; const ps = as.map(a => prijs(a, r.id)); const min = Math.min(...ps.filter(x => x != null));
      html += `<tr><td class="num muted">${esc(r.code)}</td><td>${esc(r.omschrijving)}${r.locatie ? `<small class="muted" style="display:block">${esc(r.locatie)}</small>` : ""}</td><td class="r num" style="white-space:nowrap">${h ? nl(h, 2) + " " + esc(r.eenheid) : ""}</td><td class="r num muted">${nu ? eur2(nu) : "—"}</td>${as.map((a, i) => { const x = ps[i]; if (x != null) sub[a.id] += x * h; const o = opm(a, r.id); return `<td class="r num" style="${x != null && x === min && ps.filter(y => y != null).length > 1 ? "color:var(--ok);font-weight:600" : ""}" title="${esc(o)}">${x == null ? "—" : eur2(x)}${o ? ` <span title="${esc(o)}">💬</span>` : ""}</td>`; }).join("")}</tr>`; });
    html += `<tr class="ms-groep"><td></td><td>Subtotaal ${esc(lotName(lot))}</td><td></td><td class="r num">${eur(sub.nu)}</td>${as.map(a => `<td class="r num"><b>${eur(sub[a.id])}</b></td>`).join("")}</tr>`;
    tot.nu += sub.nu; as.forEach(a => tot[a.id] += sub[a.id]);
  });
  html += `<tr class="ms-lot"><td></td><td>Totaal (posten met prijs)</td><td></td><td class="r num">${eur(tot.nu)}</td>${as.map(a => `<td class="r num">${eur(tot[a.id])}</td>`).join("")}</tr></tbody></table></div>
    <div class="actions" style="margin-top:12px;flex-wrap:wrap">${as.map(a => `<button type="button" class="btn sm" data-act="pa-take" data-id="${a.id}" data-fromcmp="1">Prijzen van ${esc(naam(a))} overnemen</button>`).join("")}</div><p class="muted" style="font-size:12px;margin:8px 0 0">Overnemen zet de ingevulde eenheidsprijzen als kostprijs in de meetstaat (enkel de posten waarvoor die aannemer een prijs gaf); de klantprijs volgt via de marge. Groen = laagste prijs.</p>`;
  openModal("Prijzen vergelijken", html, { wide: true, saveLabel: "Sluiten", onSave: async () => { } });
  $("#mform").querySelector(".mf button.btn:not(.primary)")?.remove();
}
async function paOvernemen(id) {
  const a = S.prijsaanvragen[id]; if (!a) return; const n = paRegels(id).filter(r => r.eenheidsprijs != null).length;
  if (!n) { toast("Deze aannemer heeft nog geen prijzen ingevuld."); return; }
  if (!confirm(`${n} prijzen van ${S.contacten[a.contact_id]?.naam || "deze aannemer"} overnemen als kostprijs in de meetstaat? Bestaande kostprijzen van die posten worden overschreven.`)) return;
  const { data, error } = await sb.rpc("prijsaanvraag_overnemen", { p_id: id });
  if (error) { toast("Overnemen mislukt: " + error.message, 6000); return; }
  await msRefetch(paPosten(a).map(r => r.id)); await refetch("prijsaanvragen"); toast(`${data} kostprijzen overgenomen`);
  if (driveReady()) driveCall("prijsaanvraagmail", { id, soort: "gekozen", token: S.session?.access_token || "" }).catch(() => { });
}
/* ---------- Notities / verslagen per project: vergaderingen, werfverslagen, feedback — met verantwoordelijken en actiepunten (taken) ---------- */
const NOTE_SOORT = { vergadering: "Vergadering", werfverslag: "Werfverslag", bespreking: "Bespreking", feedback: "Feedback klant", notitie: "Notitie" };
const NOTE_SJABLOON = {
  vergadering: "AANWEZIG\n- \n\nBESPROKEN\n1. \n2. \n\nBESLISSINGEN\n- \n\nVOLGENDE STAPPEN\n- \n\nVOLGENDE VERGADERING\n",
  werfverslag: "AANWEZIG OP DE WERF\n- \n\nSTAND VAN DE WERKEN\n- \n\nVASTSTELLINGEN / OPMERKINGEN\n- \n\nAFSPRAKEN\n- \n\nPLANNING VOLGENDE WEEK\n- \n\nVOLGEND WERFBEZOEK\n",
  bespreking: "ONDERWERP\n\n\nBESPROKEN\n- \n\nAFSPRAKEN\n- \n",
  feedback: "FEEDBACK VAN DE KLANT\n- \n\nWAT WE ERMEE DOEN\n- \n",
  notitie: "",
};
const notesOf = (pid) => Object.values(S.notities).filter(n => n.project_id === pid).sort((a, b) => (b.datum || "").localeCompare(a.datum || "") || (b.created_at || "").localeCompare(a.created_at || ""));
const noteTasks = (nid) => Object.values(S.taken).filter(t => t.notitie_id === nid).sort((a, b) => (a.eind || "9").localeCompare(b.eind || "9"));
const noteWie = (n) => [...(n.verantwoordelijken || []).map(id => S.profiles[id]?.name).filter(Boolean), ...(n.contact_ids || []).map(id => S.contacten[id]?.naam).filter(Boolean)];
const noteExcerpt = (t, n = 160) => { const s = String(t || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };
function noteCard(n, withProject) {
  const ts = noteTasks(n.id), open = ts.filter(t => t.status !== "done").length; const wie = noteWie(n);
  return `<div class="note" data-act="note-open" data-id="${n.id}">
    <div class="note-head"><span class="pill phase">${NOTE_SOORT[n.soort] || esc(n.soort)}</span><span class="num muted">${fmtLong(n.datum)}</span>${n.klant_zichtbaar ? `<span class="pill st-afgerond" title="Zichtbaar voor de klant in het portaal">klant</span>` : ""}${withProject && S.projecten[n.project_id] ? `<span class="muted">· ${esc(projName(S.projecten[n.project_id]))}</span>` : ""}</div>
    <div class="note-title">${esc(n.titel || NOTE_SOORT[n.soort])}</div>
    <div class="note-body muted">${esc(noteExcerpt(n.inhoud))}</div>
    <div class="note-foot"><span class="who-cell">${n.auteur ? avatar(n.auteur) : ""}<span class="muted" style="font-size:12px">${esc(userById(n.auteur).name)}</span></span>${wie.length ? `<span class="muted" style="font-size:12px">→ ${wie.map(esc).join(", ")}</span>` : ""}${ts.length ? `<span class="pill ${open ? "busy" : "done"}" style="font-size:11px">${open ? `${open} open` : "alles klaar"} · ${ts.length} actiepunt${ts.length === 1 ? "" : "en"}</span>` : ""}</div></div>`;
}
function vNotities(p) {
  if (schemaV() < 14) return SCHEMA_HINT(14);
  const ns = notesOf(p.id); const q = (S.noteQ || "").toLowerCase();
  const list = ns.filter(n => !q || [n.titel, n.inhoud, n.deelnemers, NOTE_SOORT[n.soort]].some(v => (v || "").toLowerCase().includes(q)));
  const openPunten = Object.values(S.taken).filter(t => t.project_id === p.id && t.notitie_id && t.status !== "done").sort((a, b) => (a.eind || "9").localeCompare(b.eind || "9"));
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Notities en verslagen</h3><div class="muted" style="font-size:12px;margin-top:2px">Vergaderingen, werfverslagen, besprekingen en feedback van dit project. Actiepunten worden taken; een verslag kan je delen met de klant.</div></div>
      <div class="actions"><input class="inline" data-noteq placeholder="Zoeken…" value="${esc(S.noteQ || "")}" style="width:160px"><button class="btn sm primary" data-act="note-new" data-pid="${p.id}">+ Notitie</button></div></div>
    ${list.length ? `<div class="notes">${list.map(n => noteCard(n)).join("")}</div>` : `<div class="empty"><b>${q ? "Niets gevonden" : "Nog geen notities"}</b>${q ? "" : "Maak een verslag van een vergadering of werfbezoek; de actiepunten komen automatisch als taken op dit project."}</div>`}</div>
    ${openPunten.length ? `<div class="panel"><div class="panel-head"><h3>Open actiepunten uit verslagen</h3><span class="muted" style="font-size:12px">${openPunten.length}</span></div><div class="tw"><table class="t"><tbody>${openPunten.map(t => `<tr class="click" data-edit-task="${t.id}"><td style="width:28px"><input type="checkbox" class="task-check" data-toggle="${t.id}" aria-label="Klaar"></td><td>${esc(t.titel)}<small class="muted" style="display:block">📝 ${esc(S.notities[t.notitie_id]?.titel || "")} · ${fmtLong(S.notities[t.notitie_id]?.datum)}</small></td><td>${wieCell(t)}</td><td class="num" style="color:${isLate(t) ? "var(--crit)" : "inherit"}">${fmt(t.eind)}</td><td>${pill(t)}</td></tr>`).join("")}</tbody></table></div></div>` : ""}`;
}
function vNotitiesAlle() {
  if (schemaV() < 14) return `<div class="page-head"><div><h1>Notities</h1></div></div>` + SCHEMA_HINT(14);
  const q = (S.noteQ || "").toLowerCase(); const ns = Object.values(S.notities).sort((a, b) => (b.datum || "").localeCompare(a.datum || "") || (b.created_at || "").localeCompare(a.created_at || ""));
  const list = ns.filter(n => !q || [n.titel, n.inhoud, n.deelnemers, NOTE_SOORT[n.soort], S.projecten[n.project_id]?.klant].some(v => (v || "").toLowerCase().includes(q))).slice(0, 60);
  const mine = Object.values(S.taken).filter(t => t.notitie_id && t.status !== "done" && t.assignee === S.me.id).sort((a, b) => (a.eind || "9").localeCompare(b.eind || "9"));
  return `<div class="page-head"><div><div class="eyebrow">${ns.length} notities</div><h1>Notities</h1><div class="sub">Alle verslagen over alle projecten. Nieuwe notities maak je op de projectfiche (tabblad Notities).</div></div><div class="actions"><input class="inline" data-noteq placeholder="Zoeken in titel, inhoud, project…" value="${esc(S.noteQ || "")}" style="width:260px"></div></div>
    ${mine.length ? `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h3>Mijn open actiepunten</h3><span class="muted" style="font-size:12px">${mine.length}</span></div><div class="tw"><table class="t"><tbody>${mine.map(t => `<tr class="click" data-edit-task="${t.id}"><td style="width:28px"><input type="checkbox" class="task-check" data-toggle="${t.id}" aria-label="Klaar"></td><td>${esc(t.titel)}<small class="muted" style="display:block">${esc(projName(S.projecten[t.project_id] || {}))} · 📝 ${esc(S.notities[t.notitie_id]?.titel || "")}</small></td><td class="num" style="color:${isLate(t) ? "var(--crit)" : "inherit"}">${fmt(t.eind)}</td><td>${pill(t)}</td></tr>`).join("")}</tbody></table></div></div>` : ""}
    ${list.length ? `<div class="notes">${list.map(n => noteCard(n, true)).join("")}</div>` : `<div class="panel"><div class="empty"><b>${q ? "Niets gevonden" : "Nog geen notities"}</b></div></div>`}`;
}
function noteForm(n = {}, pid) {
  const isNew = !n.id; const projectId = n.project_id || pid; const p = S.projecten[projectId]; if (!p) return;
  const soort = n.soort || "vergadering"; const ts = isNew ? [] : noteTasks(n.id);
  const vorige = isNew ? Object.values(S.taken).filter(t => t.project_id === projectId && t.notitie_id && t.status !== "done") : [];
  const team = users(); const pcs = contactsOf(projectId);
  const vr = new Set(n.verantwoordelijken || []), cr = new Set(n.contact_ids || []);
  const taakRij = (i) => `<div class="ap-row"><input name="ap_titel_${i}" placeholder="Actiepunt / taak" style="flex:2"><select name="ap_wie_${i}">${schemaV() >= 15 ? wieOpts(projectId, { assignee: S.me.id }) : userOpts(S.me.id, true)}</select><input name="ap_eind_${i}" type="date" title="Deadline"></div>`;
  openModal(isNew ? "Nieuwe notitie — " + p.klant : (n.titel || NOTE_SOORT[n.soort]), `<div class="form-grid">
    <div class="field"><label for="n_soort">Soort</label><select id="n_soort" name="soort">${opts(Object.entries(NOTE_SOORT), soort)}</select></div>
    <div class="field"><label for="n_datum">Datum</label><input id="n_datum" name="datum" type="date" value="${esc(n.datum || todayIso)}"></div>
    <div class="field span2"><label for="n_titel">Titel</label><input id="n_titel" name="titel" required value="${esc(n.titel || "")}" placeholder="bv. Werfvergadering 3 · keuken en badkamer"></div>
    <div class="field span2"><label for="n_deel">Aanwezig / betrokken (vrije tekst)</label><input id="n_deel" name="deelnemers" value="${esc(n.deelnemers || "")}" placeholder="bv. Phil, Noa, Jo Appelmans, schrijnwerker Peeters"></div>
    <div class="field span2"><label for="n_inhoud">Verslag ${isNew ? `<button type="button" class="btn ghost sm" data-note-sjabloon>Sjabloon invullen</button>` : ""}</label><textarea id="n_inhoud" name="inhoud" rows="14" style="font-family:var(--font-body);line-height:1.5">${esc(n.inhoud || "")}</textarea></div>
    <div class="field"><label>Verantwoordelijken — team</label><div class="fase-list">${team.map(u => `<label class="chk"><input type="checkbox" name="vr" value="${u.id}" ${vr.has(u.id) ? "checked" : ""}> <span>${esc(u.name)}</span></label>`).join("")}</div></div>
    <div class="field"><label>Verantwoordelijken — klant, aannemers en andere contacten</label>${pcs.length ? `<div class="fase-list">${pcs.map(x => `<label class="chk"><input type="checkbox" name="cr" value="${x.c.id}" ${cr.has(x.c.id) ? "checked" : ""}> <span>${esc(x.c.naam)}<small class="muted" style="display:block">${CONTACT_ROL[x.rol] || x.rol}${x.c.vakgebied ? " · " + esc(x.c.vakgebied) : ""}</small></span></label>`).join("")}</div>` : `<div class="muted" style="font-size:12px;padding:6px 0">Koppel de klant en aannemers aan dit project via Dossier › Contacten; dan kan je ze hier aanduiden.</div>`}</div>
    <div class="field span2"><label>Actiepunten → taken op dit project <span class="muted" style="font-weight:400">— ook toe te wijzen aan de klant of een aannemer; die ziet ze in het portaal</span></label>
      ${ts.length ? `<div class="tw" style="margin-bottom:8px"><table class="t"><tbody>${ts.map(t => `<tr><td style="width:28px"><input type="checkbox" name="ap_done_${t.id}" ${t.status === "done" ? "checked" : ""} title="Klaar"></td><td>${esc(t.titel)}</td><td>${wieCell(t)}</td><td class="num">${fmt(t.eind)}</td><td class="r"><button type="button" class="btn ghost sm" data-act="edit-task-from-note" data-tid="${t.id}">Bewerken</button></td></tr>`).join("")}</tbody></table></div>` : ""}
      <div id="ap_rows">${taakRij(0)}${taakRij(1)}${taakRij(2)}</div><button type="button" class="btn ghost sm" data-ap-more>+ Nog een actiepunt</button>
      ${vorige.length ? `<details style="margin-top:10px"><summary class="muted" style="cursor:pointer;font-size:12px">Nog ${vorige.length} open actiepunt${vorige.length === 1 ? "" : "en"} uit vorige verslagen</summary><ul style="margin:6px 0 0;padding-left:18px;font-size:13px">${vorige.map(t => `<li>${esc(t.titel)} <span class="muted">· ${esc(wieNaam(t))}${t.eind ? " · " + fmt(t.eind) : ""} · 📝 ${esc(S.notities[t.notitie_id]?.titel || "")}</span></li>`).join("")}</ul></details>` : ""}</div>
    <div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" name="klant_zichtbaar" ${n.klant_zichtbaar ? "checked" : ""}><span><b>Delen met de klant</b> — het verslag en zijn actiepunten verschijnen in het klantenportaal onder "Verslagen"${isNew || !n.klant_zichtbaar ? "; de klant krijgt een mail" : ""}. Interne opmerkingen horen dan niet in dit verslag.</span></label></div>
  </div>`, {
    wide: true, saveLabel: isNew ? "Bewaren" : "Bewaren",
    onSave: async (d) => {
      const f = $("#mform"); const vrs = [...f.querySelectorAll('input[name="vr"]:checked')].map(i => i.value), crs = [...f.querySelectorAll('input[name="cr"]:checked')].map(i => i.value);
      const wasShared = !!n.klant_zichtbaar; const shared = d.klant_zichtbaar === "on";
      const row = { project_id: projectId, soort: d.soort, titel: d.titel.trim(), datum: d.datum || todayIso, deelnemers: (d.deelnemers || "").trim(), inhoud: d.inhoud || "", verantwoordelijken: vrs, contact_ids: crs, klant_zichtbaar: shared };
      if (shared && !wasShared) row.gedeeld_op = new Date().toISOString();
      let saved;
      if (isNew) { row.auteur = S.me.id; saved = await dbInsert("notities", row); } else { saved = await dbUpdate("notities", n.id, row); }
      // bestaande actiepunten: klaar-vinkjes
      for (const t of ts) { const done = f.querySelector(`input[name="ap_done_${t.id}"]`)?.checked; if (done !== (t.status === "done")) await dbUpdate("taken", t.id, { status: done ? "done" : "todo" }).catch(() => { }); }
      // nieuwe actiepunten → taken
      const nieuw = []; f.querySelectorAll("#ap_rows .ap-row").forEach((r, i) => { const titel = r.querySelector(`[name^="ap_titel_"]`).value.trim(); if (!titel) return; nieuw.push({ project_id: projectId, titel, ...(schemaV() >= 15 ? wieSplit(r.querySelector(`[name^="ap_wie_"]`).value) : { assignee: r.querySelector(`[name^="ap_wie_"]`).value || null }), eind: r.querySelector(`[name^="ap_eind_"]`).value || null, start: r.querySelector(`[name^="ap_eind_"]`).value ? null : null, fase_nr: p.fase_nr || null, status: "todo", uren_gepland: 0, volgorde: 9000 + i, notitie_id: saved.id }); });
      if (nieuw.length) { const { data, error } = await sb.from("taken").insert(nieuw).select(); if (error) toast("Actiepunten niet aangemaakt: " + error.message); else (data || []).forEach(t => S.taken[t.id] = t); }
      render(); toast(isNew ? `Notitie bewaard${nieuw.length ? ` · ${nieuw.length} actiepunt${nieuw.length === 1 ? "" : "en"} als taak` : ""}` : "Notitie bewaard");
      if (shared && !wasShared && driveReady()) driveCall("notitiemail", { id: saved.id, token: S.session?.access_token || "" }).then(j => { if ((j.naar || []).length) toast("Verslag gemaild naar " + j.naar.join(", ")); }).catch(e => toast("Mail niet verstuurd: " + e.message, 6000));
    },
    onDelete: isNew ? null : async () => { await dbDelete("notities", n.id); toast("Notitie verwijderd"); },
  });
  const f = $("#mform"); let apN = 3;
  f.querySelector("[data-ap-more]").onclick = () => { $("#ap_rows").insertAdjacentHTML("beforeend", taakRij(apN++)); };
  const sj = f.querySelector("[data-note-sjabloon]"); if (sj) sj.onclick = () => { const ta = $("#n_inhoud"); if (ta.value.trim() && !confirm("De huidige tekst vervangen door het sjabloon?")) return; ta.value = NOTE_SJABLOON[$("#n_soort").value] || ""; ta.focus(); };
  $("#n_soort").addEventListener("change", () => { if (isNew && !$("#n_inhoud").value.trim()) $("#n_inhoud").value = NOTE_SJABLOON[$("#n_soort").value] || ""; });
  if (isNew && !$("#n_inhoud").value) $("#n_inhoud").value = NOTE_SJABLOON[soort] || "";
  f.querySelectorAll("[data-act=edit-task-from-note]").forEach(b => b.onclick = (e) => { e.preventDefault(); const t = S.taken[b.dataset.tid]; closeModal(); if (t) taskForm(t); });
}
/* ---------- Werfopvolging (stap 1): werfbezoeken en vaststellingen met foto's, aannemer, deadline en status ---------- */
const VS_STATUS = { open: "Open", opgelost: "Opgelost", gecontroleerd: "Gecontroleerd", vervallen: "Vervallen" };
const VS_PRIO = { laag: "Laag", normaal: "Normaal", hoog: "Hoog" };
const WEER = ["", "Zonnig", "Bewolkt", "Regen", "Wind", "Vriezend", "Sneeuw"];
const vsNr = (v) => "V-" + String(v.nr || 0).padStart(3, "0");
const vsOf = (pid) => Object.values(S.vaststellingen).filter(v => v.project_id === pid).sort((a, b) => (b.nr || 0) - (a.nr || 0));
const wbOf = (pid) => Object.values(S.werfbezoeken).filter(b => b.project_id === pid).sort((a, b) => (b.datum || "").localeCompare(a.datum || "") || (b.nr || 0) - (a.nr || 0));
const vsLate = (v) => v.status === "open" && v.deadline && v.deadline < todayIso;
const vsActief = (v) => v.status === "open" || v.status === "opgelost";
const vsWie = (v) => v.contact_id && S.contacten[v.contact_id] ? S.contacten[v.contact_id].naam : v.assignee ? userById(v.assignee).name : "";
const vsWieCell = (v) => v.contact_id || v.assignee ? wieCell(v) : `<span class="muted">niet toegewezen</span>`;
const vsPill = (v) => vsLate(v) ? `<span class="pill late">Te laat</span>` : `<span class="pill vs-${v.status}">${VS_STATUS[v.status] || esc(v.status)}</span>`;
const vsThumb = (f, cls = "") => `<img class="vs-thumb ${cls}" src="${esc(f.url)}" alt="" loading="lazy" data-foto="${esc(f.url)}">`;
const werfUrl = (pid) => new URL("werf/" + (pid ? "?p=" + pid : ""), location.href).href;
/* keuzelijst "verantwoordelijke": aannemers en andere contacten van het project, daarna het team */
const vsWieOpts = (pid, v) => { const cur = v.contact_id ? "c:" + v.contact_id : (v.assignee || ""); const pcs = contactsOf(pid); return `<option value="">— nog niet toegewezen —</option>${pcs.length ? `<optgroup label="Klant, aannemers en contacten van dit project">${opts(pcs.map(x => ["c:" + x.c.id, x.c.naam + (x.c.vakgebied ? " · " + x.c.vakgebied : "") + " · " + (CONTACT_ROL[x.rol] || x.rol)]), cur)}</optgroup>` : ""}<optgroup label="Team">${opts(users().map(u => [u.id, u.name]), cur)}</optgroup>`; };
/* foto's: verkleinen in de browser (max. 1600 px, jpeg) en uploaden naar de bucket 'werf' */
async function fotoVerklein(file, max = 1600, q = 0.82) {
  let img = null;
  if (window.createImageBitmap) img = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (!img) img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Foto niet leesbaar")); i.src = URL.createObjectURL(file); });
  const w = img.width, h = img.height, s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", q));
  return { blob, w: c.width, h: c.height };
}
async function fotoUpload(pid, vid, file) {
  const { blob, w, h } = await fotoVerklein(file);
  const path = `${pid}/${vid}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
  const { error } = await sb.storage.from("werf").upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;
  return { path, url: sb.storage.from("werf").getPublicUrl(path).data.publicUrl, w, h, op: new Date().toISOString() };
}
function fotoLightbox(url) {
  let lb = $("#lightbox"); if (!lb) { lb = document.createElement("div"); lb.id = "lightbox"; lb.className = "lightbox"; lb.onclick = () => lb.classList.remove("show"); document.body.appendChild(lb); }
  lb.innerHTML = `<img src="${esc(url)}" alt=""><a class="btn sm" href="${esc(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Origineel openen</a>`; lb.classList.add("show");
}
function vsCard(v, withProject) {
  const fotos = v.fotos || []; const wie = vsWie(v);
  return `<div class="vs ${vsActief(v) ? "" : "vs-dim"}" data-act="vs-open" data-id="${v.id}">
    ${fotos.length ? `<div class="vs-fotos"><img class="vs-thumb main" src="${esc(fotos[0].url)}" alt="" loading="lazy">${fotos.length > 1 ? `<span class="vs-more">+${fotos.length - 1}</span>` : ""}</div>` : `<div class="vs-fotos vs-nofoto"><span>geen foto</span></div>`}
    <div class="vs-body">
      <div class="vs-head"><b class="num">${vsNr(v)}</b>${v.prioriteit === "hoog" ? `<span class="pill late" title="Hoge prioriteit">!</span>` : v.prioriteit === "laag" ? `<span class="pill kl">laag</span>` : ""}${vsPill(v)}${v.klant_zichtbaar ? `<span class="pill st-afgerond" title="Zichtbaar voor de klant">klant</span>` : ""}${withProject && S.projecten[v.project_id] ? `<span class="muted">· ${esc(projName(S.projecten[v.project_id]))}</span>` : ""}</div>
      ${v.titel ? `<div class="vs-title">${esc(v.titel)}</div>` : ""}<div class="vs-text ${v.titel ? "muted" : ""}">${esc(v.omschrijving || (v.titel ? "" : "—"))}</div>
      <div class="vs-meta muted">${[v.ruimte, v.lot ? lotName(v.lot) : ""].filter(Boolean).map(esc).join(" · ")}${v.plan_id && S.werfplannen[v.plan_id] ? ` <span class="pill kl" title="Aangeduid op ${esc(S.werfplannen[v.plan_id].naam)}">📍 ${esc(S.werfplannen[v.plan_id].naam)}</span>` : ""}</div>
      <div class="vs-foot"><span>${vsWieCell(v)}</span><span class="num ${vsLate(v) ? "late-txt" : "muted"}">${v.deadline ? "tegen " + fmt(v.deadline) : ""}</span></div>
    </div></div>`;
}
function vWerf(p) {
  if (schemaV() < 16) return SCHEMA_HINT(16);
  const all = vsOf(p.id); const f = S.werfF = S.werfF || { status: "actief", wie: "", q: "", groep: false };
  const q = (f.q || "").toLowerCase();
  const list = all.filter(v => (f.status === "actief" ? vsActief(v) : f.status === "alle" ? true : v.status === f.status) && (!f.wie || (f.wie.startsWith("c:") ? v.contact_id === f.wie.slice(2) : v.assignee === f.wie)) && (!q || [v.titel, v.omschrijving, v.ruimte, vsNr(v), vsWie(v), v.lot ? lotName(v.lot) : ""].some(x => (x || "").toLowerCase().includes(q))))
    .sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || (b.nr || 0) - (a.nr || 0));
  const n = { open: all.filter(v => v.status === "open").length, laat: all.filter(vsLate).length, opgelost: all.filter(v => v.status === "opgelost").length, klaar: all.filter(v => v.status === "gecontroleerd").length };
  const wieKeys = [...new Set(all.map(v => v.contact_id ? "c:" + v.contact_id : v.assignee || ""))].filter(Boolean);
  const wieLabel = (k) => k.startsWith("c:") ? (S.contacten[k.slice(2)]?.naam || "?") : userById(k).name;
  const bezoeken = wbOf(p.id);
  const kpi = `<div class="rend">
    <div class="panel"><div class="k">Open</div><div class="v">${n.open}</div></div>
    <div class="panel"><div class="k">Te laat</div><div class="v ${n.laat ? "neg" : ""}">${n.laat}</div></div>
    <div class="panel"><div class="k">Opgelost · te controleren</div><div class="v">${n.opgelost}</div></div>
    <div class="panel"><div class="k">Gecontroleerd</div><div class="v pos">${n.klaar}</div></div></div>`;
  let cards;
  const groep = f.groep === true ? "wie" : f.groep;
  if (groep === "wie") {
    const groups = {}; list.forEach(v => { const k = v.contact_id ? "c:" + v.contact_id : v.assignee || ""; (groups[k] = groups[k] || []).push(v); });
    cards = Object.keys(groups).sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || wieLabel(a).localeCompare(wieLabel(b))).map(k => `<div class="vs-group"><h4>${k ? esc(wieLabel(k)) : "Nog niet toegewezen"} <span class="muted num" style="font-weight:400">${groups[k].filter(v => v.status === "open").length} open · ${groups[k].length}</span>${k.startsWith("c:") && S.contacten[k.slice(2)]?.email ? ` <a class="muted" href="mailto:${esc(S.contacten[k.slice(2)].email)}" target="_blank" rel="noopener" style="font-weight:400;font-size:12px">${esc(S.contacten[k.slice(2)].email)}</a>` : ""}</h4><div class="vs-grid">${groups[k].map(v => vsCard(v)).join("")}</div></div>`).join("");
  } else if (groep === "lot" || groep === "ruimte") {
    const key = (v) => groep === "lot" ? (v.lot ? String(v.lot) : "") : (v.ruimte || "").trim();
    const label = (k) => !k ? (groep === "lot" ? "Zonder lot" : "Zonder ruimte") : groep === "lot" ? lotName(Number(k)) : k;
    const groups = {}; list.forEach(v => { const k = key(v); (groups[k] = groups[k] || []).push(v); });
    cards = Object.keys(groups).sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || (groep === "lot" ? Number(a) - Number(b) : a.localeCompare(b))).map(k => `<div class="vs-group"><h4>${esc(label(k))} <span class="muted num" style="font-weight:400">${groups[k].filter(v => v.status === "open").length} open · ${groups[k].length}</span></h4><div class="vs-grid">${groups[k].map(v => vsCard(v)).join("")}</div></div>`).join("");
  } else cards = `<div class="vs-grid">${list.map(v => vsCard(v)).join("")}</div>`;
  return kpi + vPlannen(p) + `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Vaststellingen</h3><div class="muted" style="font-size:12px;margin-top:2px">Punten van de werf met foto's, verantwoordelijke aannemer en deadline · ${all.length} in totaal</div></div>
      <div class="actions"><a class="btn sm" href="${esc(werfUrl(p.id))}" target="_blank" rel="noopener" title="Werfmodus voor op de smartphone: foto's nemen, ook zonder bereik">📱 Werfmodus</a><button class="btn sm" data-act="wb-new" data-pid="${p.id}">+ Werfbezoek</button><button class="btn sm primary" data-act="vs-new" data-pid="${p.id}">+ Vaststelling</button></div></div>
    <div class="filters" style="padding:10px 16px;border-bottom:1px solid var(--line)"><select data-werff="status">${opts([["actief", "Open en opgelost"], ["open", "Alleen open"], ["opgelost", "Opgelost · te controleren"], ["gecontroleerd", "Gecontroleerd"], ["vervallen", "Vervallen"], ["alle", "Alles"]], f.status)}</select><select data-werff="wie"><option value="">Alle verantwoordelijken</option>${opts(wieKeys.map(k => [k, wieLabel(k)]), f.wie)}</select><input data-werff="q" placeholder="Zoeken: omschrijving, ruimte, nummer…" value="${esc(f.q || "")}" style="min-width:220px"><select data-werff="groep">${opts([["", "Niet groeperen"], ["wie", "Per verantwoordelijke"], ["lot", "Per lot"], ["ruimte", "Per ruimte"]], f.groep === true ? "wie" : (f.groep || ""))}</select></div>
    ${list.length ? cards : `<div class="empty"><b>${all.length ? "Niets gevonden met deze filter" : "Nog geen vaststellingen"}</b>${all.length ? "" : "Maak een vaststelling met foto's, of open de werfmodus op je smartphone tijdens het werfbezoek."}</div>`}</div>
    <div class="panel"><div class="panel-head"><div><h3>Werfbezoeken</h3><div class="muted" style="font-size:12px;margin-top:2px">Datum, aanwezigen en algemene opmerkingen; vaststellingen hangen aan een bezoek</div></div><div class="actions"><button class="btn sm" data-act="wb-new" data-pid="${p.id}">+ Werfbezoek</button></div></div>
      ${bezoeken.length ? `<div class="tw"><table class="t"><thead><tr><th>Nr</th><th>Datum</th><th>Aanwezig</th><th>Weer</th><th>Opmerkingen</th><th class="r">Vaststellingen</th></tr></thead><tbody>${bezoeken.map(b => { const vs = all.filter(v => v.bezoek_id === b.id); return `<tr class="click" data-act="wb-open" data-id="${b.id}"><td class="num muted">${b.nr}</td><td class="num">${fmtLong(b.datum)}</td><td>${esc(b.aanwezigen || "—")}</td><td>${esc(b.weer || "—")}</td><td class="muted">${esc(noteExcerpt(b.notities, 90) || "—")}</td><td class="r num">${vs.length}${vs.filter(v => v.status === "open").length ? ` <span class="pill busy">${vs.filter(v => v.status === "open").length} open</span>` : ""}</td></tr>`; }).join("")}</tbody></table></div>` : `<div class="empty">Nog geen werfbezoeken geregistreerd.</div>`}</div>` + vWerfverslagen(p);
}
function vsForm(v = {}, pid, bezoekId) {
  const isNew = !v.id; const projectId = v.project_id || pid; const p = S.projecten[projectId]; if (!p) return;
  const fotos = [...(v.fotos || [])]; let nieuw = []; let pin = v.plan_id && v.plan_x != null ? { x: Number(v.plan_x), y: Number(v.plan_y) } : null;   // nieuw: File-objecten die bij bewaren geüpload worden
  const ruimtes = [...new Set(vsOf(projectId).map(x => x.ruimte).filter(Boolean))].sort();
  const lots = [...new Set(msRows(projectId).map(r => r.lot))].sort((a, b) => a - b);
  const bezoeken = wbOf(projectId);
  openModal(isNew ? "Nieuwe vaststelling — " + p.klant : `${vsNr(v)} — ${p.klant}`, `<div class="form-grid">
    <div class="field span2"><label>Foto's</label><div class="vs-foto-edit" id="vs_fotos"></div>
      <div class="actions" style="margin-top:8px"><label class="btn sm">📷 Foto's toevoegen<input type="file" accept="image/*" multiple hidden id="vs_file"></label><span class="muted" style="font-size:12px;align-self:center">Worden verkleind tot 1600 px vóór het uploaden.</span></div></div>
    ${schemaV() >= 20 ? `<div class="field span2"><label for="vs_plan">Locatie op plan</label>${plansOf(projectId).length ? `<select id="vs_plan" name="plan_id" style="max-width:360px"><option value="">— geen plan —</option>${opts(plansOf(projectId).map(x => [x.id, x.naam]), v.plan_id || "")}</select><div id="vs_planbox" style="margin-top:8px"></div>` : `<div class="muted" style="font-size:12px">Nog geen plannen voor dit project — voeg er een toe in het paneel Plannen op het tabblad Werf.</div>`}</div>` : ""}
    ${schemaV() >= 19 ? `<div class="field span2"><label for="vs_titel">Titel <span class="muted" style="font-weight:400">— kort, voor het overzicht</span></label><input id="vs_titel" name="titel" value="${esc(v.titel || "")}" placeholder="bv. Scharnier kastdeur keuken"></div>` : ""}
    <div class="field span2"><label for="vs_oms">Omschrijving</label><textarea id="vs_oms" name="omschrijving" rows="3" ${schemaV() >= 19 ? "" : "required"} placeholder="Wat is er vastgesteld en wat moet er gebeuren?">${esc(v.omschrijving || "")}</textarea></div>
    <div class="field"><label for="vs_ruimte">Ruimte / locatie</label><input id="vs_ruimte" name="ruimte" list="vs_ruimtes" value="${esc(v.ruimte || "")}" placeholder="bv. Keuken, badkamer 1e verd."><datalist id="vs_ruimtes">${ruimtes.map(r => `<option value="${esc(r)}">`).join("")}</datalist></div>
    <div class="field"><label for="vs_lot">Lot</label><select id="vs_lot" name="lot"><option value="">—</option>${opts(lots.map(l => [l, lotName(l)]), v.lot ?? "")}</select></div>
    <div class="field"><label for="vs_wie">Verantwoordelijke</label><select id="vs_wie" name="wie">${vsWieOpts(projectId, v)}</select>${schemaV() >= 18 ? `<small class="muted">Wordt automatisch een taak in de takenlijst van die persoon (klant: in het portaal).</small>` : ""}</div>
    <div class="field"><label for="vs_deadline">Op te lossen tegen</label><input id="vs_deadline" name="deadline" type="date" value="${esc(v.deadline || "")}"></div>
    <div class="field"><label for="vs_prio">Prioriteit</label><select id="vs_prio" name="prioriteit">${opts(Object.entries(VS_PRIO), v.prioriteit || "normaal")}</select></div>
    <div class="field"><label for="vs_status">Status</label><select id="vs_status" name="status">${opts(Object.entries(VS_STATUS), v.status || "open")}</select>${v.opgelost_op ? `<small class="muted">Opgelost op ${fmtLong(v.opgelost_op.slice(0, 10))}${v.opgelost_door ? " door " + esc(userById(v.opgelost_door).name) : ""}</small>` : ""}</div>
    <div class="field"><label for="vs_bezoek">Werfbezoek</label><select id="vs_bezoek" name="bezoek_id"><option value="">—</option>${opts(bezoeken.map(b => [b.id, `Bezoek ${b.nr} · ${fmtLong(b.datum)}`]), v.bezoek_id || bezoekId || "")}</select></div>
    <div class="field"><label for="vs_opm">Opmerking / reactie</label><input id="vs_opm" name="opmerking" value="${esc(v.opmerking || "")}" placeholder="bv. antwoord van de aannemer"></div>
    ${(v.opgelost_fotos || []).length ? `<div class="field span2"><label>Bewijsfoto's bij de oplossing</label><div class="vs-foto-edit">${v.opgelost_fotos.map(f => vsThumb(f)).join("")}</div></div>` : ""}
    <div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" name="klant_zichtbaar" ${v.klant_zichtbaar ? "checked" : ""}><span><b>Zichtbaar voor de klant</b> — deze vaststelling verschijnt (later) in het werfverslag voor de klant in het portaal.</span></label></div>
  </div>`, {
    wide: true,
    onSave: async (d) => {
      const f = $("#mform"); const btn = f.querySelector("button[type=submit]");
      if (!(d.titel || "").trim() && !(d.omschrijving || "").trim()) { toast("Geef een titel of omschrijving"); return false; }
      const row = { project_id: projectId, ...(schemaV() >= 19 ? { titel: (d.titel || "").trim() } : {}), ...(schemaV() >= 20 && $("#vs_plan") ? { plan_id: d.plan_id || null, plan_x: d.plan_id && pin ? pin.x : null, plan_y: d.plan_id && pin ? pin.y : null } : {}), omschrijving: (d.omschrijving || "").trim(), ruimte: (d.ruimte || "").trim(), lot: d.lot ? Number(d.lot) : null, ...wieSplit(d.wie), deadline: d.deadline || null, prioriteit: d.prioriteit, status: d.status, bezoek_id: d.bezoek_id || null, opmerking: (d.opmerking || "").trim(), klant_zichtbaar: d.klant_zichtbaar === "on" };
      if (row.status === "opgelost" && v.status !== "opgelost" && v.status !== "gecontroleerd") { row.opgelost_op = new Date().toISOString(); row.opgelost_door = S.me.id; }
      if (row.status === "open") { row.opgelost_op = null; row.opgelost_door = null; }
      let saved;
      if (isNew) { row.created_by = S.me.id; row.fotos = fotos; saved = await dbInsert("vaststellingen", row); }
      else { saved = v; }
      const geupload = [];
      for (let i = 0; i < nieuw.length; i++) {
        btn.textContent = `Foto ${i + 1}/${nieuw.length} uploaden…`;
        try { geupload.push(await fotoUpload(projectId, saved.id, nieuw[i])); } catch (e) { toast("Foto niet geüpload: " + e.message); }
      }
      const alle = [...fotos, ...geupload];
      if (isNew) { if (geupload.length) await dbUpdate("vaststellingen", saved.id, { fotos: alle }); }
      else await dbUpdate("vaststellingen", v.id, { ...row, fotos: alle });
      toast(isNew ? `${vsNr(S.vaststellingen[saved.id] || saved)} bewaard${geupload.length ? ` · ${geupload.length} foto${geupload.length === 1 ? "" : "'s"}` : ""}` : "Vaststelling bewaard");
    },
    onDelete: isNew ? null : async () => { const paths = [...(v.fotos || []), ...(v.opgelost_fotos || [])].map(f => f.path).filter(Boolean); await dbDelete("vaststellingen", v.id); if (paths.length) sb.storage.from("werf").remove(paths).catch(() => { }); toast("Vaststelling verwijderd"); },
  });
  const box = $("#vs_fotos");
  const draw = () => { box.innerHTML = fotos.map((f, i) => `<span class="vs-foto-item">${vsThumb(f)}<button type="button" class="vs-foto-x" data-rm="${i}" title="Verwijderen">✕</button></span>`).join("") + nieuw.map((f, i) => `<span class="vs-foto-item"><img class="vs-thumb" src="${URL.createObjectURL(f)}" alt=""><button type="button" class="vs-foto-x" data-rmn="${i}" title="Verwijderen">✕</button><span class="vs-new">nieuw</span></span>`).join("") || `<span class="muted" style="font-size:12px">Nog geen foto's.</span>`;
    box.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { fotos.splice(Number(b.dataset.rm), 1); draw(); }); box.querySelectorAll("[data-rmn]").forEach(b => b.onclick = () => { nieuw.splice(Number(b.dataset.rmn), 1); draw(); }); };
  draw();
  $("#vs_file").addEventListener("change", (e) => { nieuw = nieuw.concat([...e.target.files]); e.target.value = ""; draw(); });
  const planSel = $("#vs_plan");
  if (planSel) {
    const box = $("#vs_planbox");
    const drawPlan = () => { const pl = S.werfplannen[planSel.value]; if (!pl) { box.innerHTML = ""; return; }
      const others = vsOf(projectId).filter(x => x.plan_id === pl.id && x.id !== v.id && x.plan_x != null && vsActief(x));
      box.innerHTML = `<div class="muted" style="font-size:12px;margin-bottom:6px">Klik op het plan om de locatie aan te duiden${pin ? ` · <button type="button" class="btn ghost sm" data-pin-clear>Pin wissen</button>` : ""}</div><div class="plan-wrap" data-pinnable><img src="${esc(pl.url)}" alt="">${others.map(x => planPin(x, true).replace(' data-act="vs-open"', "")).join("")}${pin ? `<span class="pin mine" style="left:${pin.x * 100}%;top:${pin.y * 100}%">${v.nr || "●"}</span>` : ""}</div>`;
      box.querySelector("[data-pinnable]").onclick = (e) => { if (e.target.closest(".pin") && !e.target.classList.contains("mine")) return; const img = box.querySelector("img"); const r = img.getBoundingClientRect(); pin = { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; drawPlan(); };
      const cl = box.querySelector("[data-pin-clear]"); if (cl) cl.onclick = () => { pin = null; drawPlan(); }; };
    planSel.addEventListener("change", () => { pin = null; drawPlan(); }); drawPlan();
  }
}
/* ---------- Werfplannen (stap 2): plannen per project, pin per vaststelling ---------- */
const plansOf = (pid) => Object.values(S.werfplannen).filter(x => x.project_id === pid).sort((a, b) => (a.volgorde ?? 0) - (b.volgorde ?? 0) || (a.naam || "").localeCompare(b.naam || ""));
const planPin = (v, dim) => `<span class="pin vs-${v.status} ${dim ? "dim" : ""}" style="left:${Number(v.plan_x) * 100}%;top:${Number(v.plan_y) * 100}%" data-act="vs-open" data-id="${v.id}" title="${esc(vsNr(v) + " · " + (v.titel || v.omschrijving || ""))}">${v.nr || "•"}</span>`;
async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  await new Promise((res, rej) => { const el = document.createElement("script"); el.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"; el.onload = res; el.onerror = () => rej(new Error("pdf.js kon niet geladen worden")); document.head.appendChild(el); });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  return window.pdfjsLib;
}
/* pdf → één jpeg per pagina (max. 10 pagina's, langste zijde 2600 px); afbeelding → verkleind */
async function planToImages(file, max = 2600) {
  if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
    const pdfjs = await loadPdfJs(); const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise; const out = [];
    for (let i = 1; i <= Math.min(doc.numPages, 10); i++) {
      const page = await doc.getPage(i); const v1 = page.getViewport({ scale: 1 }); const scale = max / Math.max(v1.width, v1.height); const vp = page.getViewport({ scale });
      const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height); const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      out.push({ blob: await new Promise(r => c.toBlob(r, "image/jpeg", 0.86)), w: c.width, h: c.height, page: i, pages: doc.numPages });
    }
    return out;
  }
  const r = await fotoVerklein(file, max, 0.86); return [{ ...r, page: 1, pages: 1 }];
}
function planForm(pid) {
  const p = S.projecten[pid]; if (!p) return;
  openModal("Plan toevoegen — " + p.klant, `<div class="form-grid">
    <div class="field span2"><label for="pl_file">Bestand (pdf of afbeelding)</label><input id="pl_file" name="file" type="file" accept="application/pdf,image/*" required><small class="muted">Van een pdf worden de pagina's (max. 10) elk als plan opgeslagen. Tip: één plan per verdieping.</small></div>
    <div class="field span2"><label for="pl_naam">Naam</label><input id="pl_naam" name="naam" placeholder="bv. Gelijkvloers, 1e verdieping"></div>
  </div>`, {
    saveLabel: "Toevoegen",
    onSave: async (d) => {
      const f = $("#pl_file").files[0]; if (!f) { toast("Kies een bestand"); return false; }
      const btn = $("#mform button[type=submit]"); btn.textContent = "Plan omzetten…";
      let pages; try { pages = await planToImages(f); } catch (e) { toast("Plan niet leesbaar: " + e.message, 6000); return false; }
      const base = (d.naam || "").trim() || f.name.replace(/\.[^.]+$/, ""); const n0 = plansOf(pid).length; const rows = [];
      for (let i = 0; i < pages.length; i++) {
        btn.textContent = `Pagina ${i + 1}/${pages.length} uploaden…`;
        const path = `${pid}/plannen/${Date.now()}-${i + 1}.jpg`;
        const { error } = await sb.storage.from("werf").upload(path, pages[i].blob, { contentType: "image/jpeg" });
        if (error) { toast("Upload mislukt: " + error.message, 6000); return false; }
        rows.push({ project_id: pid, naam: pages.length > 1 ? `${base} · p${pages[i].page}` : base, path, url: sb.storage.from("werf").getPublicUrl(path).data.publicUrl, w: pages[i].w, h: pages[i].h, volgorde: n0 + i + 1, created_by: S.me.id });
      }
      const { data, error } = await sb.from("werfplannen").insert(rows).select(); if (error) { toast("Bewaren mislukt: " + error.message, 6000); return false; }
      (data || []).forEach(r => S.werfplannen[r.id] = r); render(); toast(`${rows.length} plan${rows.length === 1 ? "" : "nen"} toegevoegd`);
    },
  });
}
function vPlannen(p) {
  if (schemaV() < 20) return "";
  const pls = plansOf(p.id); const all = vsOf(p.id);
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Plannen</h3><div class="muted" style="font-size:12px;margin-top:2px">Duid per vaststelling de locatie aan op een plan; klik op een plan voor het overzicht van de punten.</div></div><div class="actions"><button class="btn sm" data-act="plan-new" data-pid="${p.id}">+ Plan</button></div></div>
    ${pls.length ? `<div class="plan-grid">${pls.map(pl => { const n = all.filter(v => v.plan_id === pl.id && v.plan_x != null && v.status === "open").length; return `<div class="plan-card" data-act="plan-view" data-id="${pl.id}"><img src="${esc(pl.url)}" alt="" loading="lazy"><div class="plan-name"><span>${esc(pl.naam)}</span>${n ? `<span class="pill vs-open">${n} open</span>` : ""}</div></div>`; }).join("")}</div>` : `<div class="empty" style="padding:16px">Nog geen plannen. Voeg een pdf (grondplan per verdieping) of afbeelding toe.</div>`}</div>`;
}
function planView(id) {
  const pl = S.werfplannen[id]; if (!pl) return; const p = S.projecten[pl.project_id];
  const f = S.werfF || { status: "actief" };
  const pts = vsOf(pl.project_id).filter(v => v.plan_id === id && v.plan_x != null).filter(v => f.status === "actief" ? vsActief(v) : f.status === "alle" ? true : v.status === f.status);
  openModal(`${pl.naam} — ${p ? p.klant : ""}`, `<div class="muted" style="font-size:12px;margin-bottom:8px">${pts.length} punt${pts.length === 1 ? "" : "en"} op dit plan (filter van het tabblad Werf) · klik op een pin om de vaststelling te openen</div>
    <div class="plan-wrap big"><img src="${esc(pl.url)}" alt="">${pts.map(v => planPin(v)).join("")}</div>
    ${pts.length ? `<div class="tw" style="margin-top:10px"><table class="t"><tbody>${pts.sort((a, b) => (a.nr || 0) - (b.nr || 0)).map(v => `<tr class="click" data-act="vs-open" data-id="${v.id}"><td class="num" style="width:60px">${vsNr(v)}</td><td>${esc(v.titel || noteExcerpt(v.omschrijving, 80))}<small class="muted" style="display:block">${esc(v.ruimte || "")}</small></td><td>${esc(vsWie(v) || "—")}</td><td>${vsPill(v)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    <div style="margin-top:12px;display:flex;gap:8px;align-items:center"><input class="inline" data-plan-naam value="${esc(pl.naam)}" style="max-width:260px" title="Naam van het plan"><a class="btn sm" href="${esc(pl.url)}" target="_blank" rel="noopener">Origineel openen</a></div>`, {
    wide: true, saveLabel: "Sluiten",
    onSave: async () => { const naam = $("[data-plan-naam]").value.trim(); if (naam && naam !== pl.naam) await dbUpdate("werfplannen", id, { naam }); },
    onDelete: async () => { const n = vsOf(pl.project_id).filter(v => v.plan_id === id).length; if (n && !confirm(`${n} vaststelling${n === 1 ? " verwijst" : "en verwijzen"} naar dit plan; die pins gaan verloren. Toch verwijderen?`)) throw new Error("geannuleerd"); await dbDelete("werfplannen", id); if (pl.path) sb.storage.from("werf").remove([pl.path]).catch(() => { }); Object.values(S.vaststellingen).forEach(v => { if (v.plan_id === id) { v.plan_id = null; } }); toast("Plan verwijderd"); },
  });
  $("#mform").querySelectorAll("[data-act=vs-open]").forEach(el => el.onclick = (e) => { e.preventDefault(); e.stopPropagation(); closeModal(); vsForm(S.vaststellingen[el.dataset.id]); });
}
function wbForm(b = {}, pid) {
  const isNew = !b.id; const projectId = b.project_id || pid; const p = S.projecten[projectId]; if (!p) return;
  const vs = isNew ? [] : vsOf(projectId).filter(v => v.bezoek_id === b.id).sort((a, c) => (a.lot || 999) - (c.lot || 999) || (a.nr || 0) - (c.nr || 0));
  openModal(isNew ? "Werfbezoek — " + p.klant : `Werfbezoek ${b.nr} — ${p.klant}`, `<div class="form-grid">
    <div class="field"><label for="wb_datum">Datum</label><input id="wb_datum" name="datum" type="date" value="${esc(b.datum || todayIso)}" required></div>
    <div class="field"><label for="wb_weer">Weer</label><select id="wb_weer" name="weer">${opts(WEER.map(w => [w, w || "—"]), b.weer || "")}</select></div>
    <div class="field span2"><label for="wb_aanw">Aanwezig</label><input id="wb_aanw" name="aanwezigen" value="${esc(b.aanwezigen || "")}" placeholder="bv. Phil, Jo Appelmans, schrijnwerker Peeters"></div>
    <div class="field span2"><label for="wb_not">Algemene opmerkingen / stand van de werken</label><textarea id="wb_not" name="notities" rows="6">${esc(b.notities || "")}</textarea></div>
    ${isNew || schemaV() < 21 ? "" : `<div class="field span2"><button type="button" class="btn sm primary" data-wb-verslag>Werfverslag maken van dit bezoek</button></div>`}
    ${isNew ? "" : `<div class="field span2"><label>Vaststellingen bij dit bezoek <span class="muted" style="font-weight:400">${vs.length}</span> <button type="button" class="btn ghost sm" data-wb-vs>+ Vaststelling</button></label>${vs.length ? (() => { const byLot = {}; vs.forEach(v => (byLot[v.lot || 0] = byLot[v.lot || 0] || []).push(v)); const lots = Object.keys(byLot).map(Number).sort((a, c) => (a ? 0 : 1) - (c ? 0 : 1) || a - c);
        return `<div class="tw"><table class="t"><tbody>${lots.map(nr => `<tr><td colspan="4" style="background:var(--surface-2);font-weight:600;font-size:12px">${nr ? esc(lotName(nr)) : "Zonder lot"} <span class="muted num" style="font-weight:400">${byLot[nr].filter(v => v.status === "open").length} open · ${byLot[nr].length}</span></td></tr>` + byLot[nr].map(v => `<tr class="click" data-wb-open="${v.id}"><td class="num" style="width:60px">${vsNr(v)}</td><td>${v.titel ? `<b>${esc(v.titel)}</b><small class="muted" style="display:block">${esc(noteExcerpt(v.omschrijving, 80))}${v.ruimte ? " · " + esc(v.ruimte) : ""}</small>` : `${esc(noteExcerpt(v.omschrijving, 80))}<small class="muted" style="display:block">${esc(v.ruimte || "")}</small>`}</td><td>${esc(vsWie(v) || "—")}</td><td>${vsPill(v)}</td></tr>`).join("")).join("")}</tbody></table></div>`; })() : `<div class="muted" style="font-size:12px">Nog geen vaststellingen aan dit bezoek gekoppeld.</div>`}</div>`}
  </div>`, {
    wide: true,
    onSave: async (d) => {
      const row = { project_id: projectId, datum: d.datum || todayIso, weer: d.weer || "", aanwezigen: (d.aanwezigen || "").trim(), notities: d.notities || "" };
      if (isNew) { row.auteur = S.me.id; const saved = await dbInsert("werfbezoeken", row); toast(`Werfbezoek ${saved.nr} bewaard`); }
      else { await dbUpdate("werfbezoeken", b.id, row); toast("Werfbezoek bewaard"); }
    },
    onDelete: isNew ? null : async () => { await dbDelete("werfbezoeken", b.id); toast("Werfbezoek verwijderd"); },
  });
  const f = $("#mform");
  const add = f.querySelector("[data-wb-vs]"); if (add) add.onclick = () => { closeModal(); vsForm({}, projectId, b.id); };
  const wv = f.querySelector("[data-wb-verslag]"); if (wv) wv.onclick = () => { closeModal(); wvForm(projectId, b.id); };
  f.querySelectorAll("[data-wb-open]").forEach(r => r.onclick = () => { closeModal(); vsForm(S.vaststellingen[r.dataset.wbOpen]); });
}
/* ---------- Werfverslagen (stap 2b): pdf in de browser (jsPDF), bewaard in de bucket 'werf', gemaild via het Drive-script ---------- */
const wvOf = (pid) => Object.values(S.werfverslagen).filter(w => w.project_id === pid).sort((a, b) => (b.nr || 0) - (a.nr || 0));
async function loadJsPdf() {
  if (window.jspdf && window.jspdf.jsPDF) return window.jspdf.jsPDF;
  await new Promise((res, rej) => { const el = document.createElement("script"); el.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"; el.onload = res; el.onerror = () => rej(new Error("jsPDF kon niet geladen worden")); document.head.appendChild(el); });
  return window.jspdf.jsPDF;
}
/* afbeelding van een url → jpeg-dataURL (verkleind), via canvas; mislukt → null */
async function imgData(url, max = 900, q = 0.8) {
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => rej(new Error("img")); i.src = url; });
    const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s));
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    return { data: c.toDataURL("image/jpeg", q), w: c.width, h: c.height, canvas: c };
  } catch (e) { return null; }
}
/* plan met pins getekend → jpeg-dataURL */
async function planData(pl, pts) {
  const r = await imgData(pl.url, 1800, 0.85); if (!r) return null;
  const ctx = r.canvas.getContext("2d"); const R = Math.max(12, Math.round(r.w / 70));
  const kleur = { open: "#B93A34", opgelost: "#B8720F", gecontroleerd: "#2E7D4F", vervallen: "#86868B" };
  pts.forEach(v => { const x = Number(v.plan_x) * r.w, y = Number(v.plan_y) * r.h; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fillStyle = kleur[v.status] || "#B93A34"; ctx.fill(); ctx.lineWidth = Math.max(2, R / 6); ctx.strokeStyle = "#fff"; ctx.stroke(); ctx.fillStyle = "#fff"; ctx.font = `bold ${Math.round(R * 1.1)}px Helvetica, Arial, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(v.nr || "•"), x, y + R * 0.05); });
  return { data: r.canvas.toDataURL("image/jpeg", 0.85), w: r.w, h: r.h };
}
async function logoData() {
  try { const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = "logo-mark.svg"; }); const c = document.createElement("canvas"); c.width = 600; c.height = 181; c.getContext("2d").drawImage(img, 0, 0, 600, 181); return c.toDataURL("image/png"); } catch (e) { return null; }
}
/* Het pdf-document. opts: { punten, groep: "lot"|"wie", bezoek, bericht } */
async function wvBuildPdf(p, opts, progress = () => { }) {
  const jsPDF = await loadJsPdf(); const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const W = 210, H = 297, M = 15, CW = W - 2 * M; let y = M; const logo = await logoData();
  const ink = [29, 29, 31], muted = [134, 134, 139], line = [220, 220, 224];
  const kleur = { open: [185, 58, 52], opgelost: [184, 114, 15], gecontroleerd: [46, 125, 79], vervallen: [134, 134, 139] };
  const clean = (s) => String(s || "").replace(/→/g, "->").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/•/g, "-");
  const header = () => { if (logo) doc.addImage(logo, "PNG", M, 10, 26, 7.8); doc.setFontSize(8); doc.setTextColor(...muted); doc.text(`${clean(projName(p))} · Werfverslag ${opts.nr}`, W - M, 15, { align: "right" }); doc.setDrawColor(...line); doc.line(M, 20, W - M, 20); y = 26; };
  const footer = () => { const n = doc.getNumberOfPages(); for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(...muted); doc.text(`BROS · ${fmtLong(opts.datum)}`, M, H - 8); doc.text(`${i} / ${n}`, W - M, H - 8, { align: "right" }); } };
  const need = (h) => { if (y + h > H - 16) { doc.addPage(); header(); } };
  const text = (s, size, style = "normal", color = ink, width = CW, x = M, lh = 1.35) => { doc.setFont("helvetica", style); doc.setFontSize(size); doc.setTextColor(...color); const lines = doc.splitTextToSize(clean(s), width); const h = lines.length * size * 0.3528 * lh; need(h); doc.text(lines, x, y + size * 0.3528 * 0.85); y += h; return h; };
  header();
  // titel
  doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.setTextColor(...ink); doc.text(`Werfverslag ${opts.nr}`, M, y + 6); y += 10;
  text(`${projName(p)}${p.adres ? " · " + p.adres + (p.gemeente ? ", " + [p.postcode, p.gemeente].filter(Boolean).join(" ") : "") : ""}`, 11, "normal", muted); y += 2;
  const b = opts.bezoek; const meta = [["Datum", fmtLong(opts.datum)], b && b.aanwezigen ? ["Aanwezig", b.aanwezigen] : null, b && b.weer ? ["Weer", b.weer] : null, ["Opgemaakt door", userById(S.me.id).name]].filter(Boolean);
  meta.forEach(([k, v]) => { doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...muted); doc.text(k.toUpperCase(), M, y + 3); doc.setFont("helvetica", "normal"); doc.setTextColor(...ink); doc.setFontSize(10); const lines = doc.splitTextToSize(clean(v), CW - 38); doc.text(lines, M + 38, y + 3); y += Math.max(5, lines.length * 4.2); });
  y += 2;
  if (opts.bericht) { y += 2; text(opts.bericht, 10.5, "normal", ink); y += 2; }
  if (b && b.notities) { y += 3; text("Stand van de werken", 12, "bold"); y += 1; text(b.notities, 10, "normal", ink); y += 2; }
  // samenvatting
  const pts = opts.punten; const nOpen = pts.filter(v => v.status === "open").length, nOpg = pts.filter(v => v.status === "opgelost").length, nGec = pts.filter(v => v.status === "gecontroleerd").length;
  y += 4; text("Vaststellingen", 14, "bold"); text(`${pts.length} punten in dit verslag · ${nOpen} open · ${nOpg} opgelost (te controleren) · ${nGec} gecontroleerd`, 9.5, "normal", muted); y += 3;
  // groepen
  const groups = {}; const gkey = (v) => opts.groep === "wie" ? (v.contact_id ? "c:" + v.contact_id : v.assignee || "") : String(v.lot || 0);
  const glabel = (k) => opts.groep === "wie" ? (!k ? "Nog niet toegewezen" : k.startsWith("c:") ? (S.contacten[k.slice(2)]?.naam || "?") : userById(k).name) : (k === "0" ? "Zonder lot" : lotName(Number(k)));
  pts.forEach(v => (groups[gkey(v)] = groups[gkey(v)] || []).push(v));
  const keys = Object.keys(groups).sort((a, c) => opts.groep === "wie" ? ((a ? 0 : 1) - (c ? 0 : 1) || glabel(a).localeCompare(glabel(c))) : ((a === "0" ? 1 : 0) - (c === "0" ? 1 : 0) || Number(a) - Number(c)));
  let done = 0;
  for (const k of keys) {
    need(14); y += 3; doc.setFillColor(240, 240, 242); doc.roundedRect(M, y, CW, 8, 2, 2, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(...ink); doc.text(clean(glabel(k)), M + 3, y + 5.5); doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...muted); doc.text(`${groups[k].filter(v => v.status === "open").length} open · ${groups[k].length}`, W - M - 3, y + 5.5, { align: "right" }); y += 11;
    for (const v of groups[k].sort((a, c) => (a.nr || 0) - (c.nr || 0))) {
      progress(`Punt ${++done}/${pts.length}…`);
      const fotos = (v.fotos || []).slice(0, 3); const imgs = []; for (const f of fotos) { const d = await imgData(f.url, 700, 0.78); if (d) imgs.push(d); }
      const ph = imgs.length ? 42 : 0; const pw = imgs.length ? Math.min(56, (CW - (imgs.length - 1) * 3) / imgs.length) : 0;
      need(16 + ph);
      // kop: nummer + titel + status
      const y0 = y; doc.setFillColor(...(kleur[v.status] || kleur.open)); doc.roundedRect(M, y + 0.5, 13, 6, 3, 3, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(255, 255, 255); doc.text(vsNr(v), M + 6.5, y + 4.6, { align: "center" });
      doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...ink); const titel = clean(v.titel || noteExcerpt(v.omschrijving, 90) || "(zonder titel)"); doc.text(doc.splitTextToSize(titel, CW - 50)[0], M + 16, y + 4.8);
      const st = (vsLate(v) ? "TE LAAT" : VS_STATUS[v.status].toUpperCase()) + (v.prioriteit === "hoog" ? " · PRIORITEIT" : ""); doc.setFontSize(8); doc.setTextColor(...(kleur[v.status] || kleur.open)); doc.text(st, W - M, y + 4.6, { align: "right" }); y += 8;
      const meta2 = [vsWie(v) ? "Verantwoordelijke: " + vsWie(v) : "Nog niet toegewezen", v.ruimte ? "Ruimte: " + v.ruimte : "", v.deadline ? "Tegen: " + fmtLong(v.deadline) : "", v.plan_id && S.werfplannen[v.plan_id] ? "Plan: " + S.werfplannen[v.plan_id].naam : "", v.opgelost_op ? "Opgelost op " + fmtLong(v.opgelost_op.slice(0, 10)) : ""].filter(Boolean).join("   ·   ");
      text(meta2, 8.5, "normal", muted);
      if (v.omschrijving && v.titel) text(v.omschrijving, 9.5, "normal", ink);
      if (v.opmerking) text("Opmerking: " + v.opmerking, 9, "italic", muted);
      if (imgs.length) { y += 1.5; need(ph + 2); imgs.forEach((im, i) => { const r = im.w / im.h; let w = pw, h = ph; if (w / h > r) w = h * r; else h = w / r; doc.addImage(im.data, "JPEG", M + i * (pw + 3), y, w, h); }); y += ph + 1.5; }
      y += 2; doc.setDrawColor(...line); doc.line(M, y, W - M, y); y += 3;
      if (y0 > y) { /* nooit */ }
    }
  }
  // plannen
  const plannen = plansOf(p.id).filter(pl => pts.some(v => v.plan_id === pl.id && v.plan_x != null));
  for (const pl of plannen) {
    progress(`Plan ${pl.naam}…`); const d = await planData(pl, pts.filter(v => v.plan_id === pl.id && v.plan_x != null)); if (!d) continue;
    doc.addPage(); header(); text("Plan · " + pl.naam, 14, "bold"); text("Nummers = vaststellingen · rood open, oranje opgelost, groen gecontroleerd", 9, "normal", muted); y += 3;
    const r = d.w / d.h; let w = CW, h = CW / r; const maxH = H - y - 14; if (h > maxH) { h = maxH; w = h * r; }
    doc.addImage(d.data, "JPEG", M + (CW - w) / 2, y, w, h);
  }
  footer();
  return doc.output("blob");
}
function wvForm(pid, bezoekId) {
  const p = S.projecten[pid]; if (!p) return; if (schemaV() < 21) { toast("Voer eerst databasescript 021 uit."); return; }
  const bez = wbOf(pid); const all = vsOf(pid);
  const pcs = contactsOf(pid).filter(x => x.c.email); const nr = (wvOf(pid)[0]?.nr || 0) + 1;
  const puntenVoor = (sel, bid, klant) => all.filter(v => sel === "bezoek" ? v.bezoek_id === bid : sel === "open" ? v.status === "open" : vsActief(v)).filter(v => !klant || v.klant_zichtbaar);
  const betrokken = (pts) => new Set(pts.map(v => v.contact_id).filter(Boolean));
  openModal(`Werfverslag ${nr} — ${p.klant}`, `<div class="form-grid">
    <div class="field"><label for="wv_bezoek">Werfbezoek</label><select id="wv_bezoek" name="bezoek_id"><option value="">— geen (los verslag) —</option>${opts(bez.map(x => [x.id, `Bezoek ${x.nr} · ${fmtLong(x.datum)}${x.aanwezigen ? " · " + x.aanwezigen : ""}`]), bezoekId || bez[0]?.id || "")}</select></div>
    <div class="field"><label for="wv_datum">Datum verslag</label><input id="wv_datum" name="datum" type="date" value="${todayIso}"></div>
    <div class="field"><label for="wv_sel">Welke punten</label><select id="wv_sel" name="sel">${opts([["actief", "Alle open en opgeloste punten van het project"], ["open", "Alleen open punten"], ["bezoek", "Alleen de punten van dit werfbezoek"]], "actief")}</select></div>
    <div class="field"><label for="wv_groep">Groeperen</label><select id="wv_groep" name="groep">${opts([["lot", "Per lot"], ["wie", "Per verantwoordelijke"]], "lot")}</select></div>
    <div class="field span2"><label for="wv_bericht">Bericht bovenaan het verslag en in de mail</label><textarea id="wv_bericht" name="bericht" rows="3" placeholder="bv. Beste, hierbij de vaststellingen van het werfbezoek van vandaag. Graag de open punten tegen de vermelde datum in orde brengen."></textarea></div>
    <div class="field span2"><label>Versturen naar</label>${pcs.length ? `<div class="fase-list" id="wv_aan">${pcs.map(x => `<label class="chk"><input type="checkbox" name="aan" value="${esc(x.c.email)}" data-cid="${x.c.id}" data-rol="${esc(x.rol)}"> <span>${esc(x.c.naam)}<small class="muted" style="display:block">${CONTACT_ROL[x.rol] || x.rol} · ${esc(x.c.email)}</small></span></label>`).join("")}</div>` : `<div class="muted" style="font-size:12px">Geen contacten met e-mailadres gekoppeld aan dit project (Dossier › Contacten).</div>`}<input name="extra" placeholder="Extra e-mailadressen, gescheiden door komma's" style="margin-top:8px"></div>
    <div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" name="klant_zichtbaar"><span><b>Delen met de klant in het portaal</b> — het verslag (pdf) verschijnt onder Verslagen. Tip: kies dan "Alleen punten zichtbaar voor de klant" hieronder als er interne punten in zitten.</span></label></div>
    <div class="field span2"><label class="chk" style="font-size:13px"><input type="checkbox" name="alleen_klant"> Alleen punten met "zichtbaar voor de klant" opnemen</label></div>
    ${p.drive_folder_id && driveReady() ? `<div class="field span2"><label class="chk" style="font-size:13px"><input type="checkbox" name="drive" checked> Ook bewaren in de Drive-map (Werfcontrole)</label></div>` : ""}
    <div class="field span2"><div class="muted" id="wv_info" style="font-size:12px"></div></div>
  </div>`, {
    wide: true, saveLabel: "Verslag maken en versturen",
    onSave: async (d) => {
      const f = $("#mform"); const btn = f.querySelector("button[type=submit]");
      const bid = d.bezoek_id || null; const pts = puntenVoor(d.sel, bid, d.alleen_klant === "on");
      if (!pts.length) { toast("Geen punten voor dit verslag"); return false; }
      const aan = [...new Set([...f.querySelectorAll('input[name="aan"]:checked')].map(i => i.value).concat((d.extra || "").split(/[,;\s]+/).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))))];
      const b = bid ? S.werfbezoeken[bid] : null; const datum = d.datum || todayIso;
      try {
        const blob = await wvBuildPdf(p, { nr, datum, bezoek: b, bericht: (d.bericht || "").trim(), punten: pts, groep: d.groep }, (m) => { btn.textContent = m; });
        btn.textContent = "Pdf bewaren…";
        const path = `${pid}/verslagen/werfverslag-${String(nr).padStart(2, "0")}-${datum}.pdf`;
        const { error } = await sb.storage.from("werf").upload(path, blob, { contentType: "application/pdf", upsert: true }); if (error) throw error;
        const url = sb.storage.from("werf").getPublicUrl(path).data.publicUrl;
        const titel = `Werfverslag ${nr} · ${fmtLong(datum)}`;
        const row = await dbInsert("werfverslagen", { project_id: pid, bezoek_id: bid, nr, datum, titel, pdf_path: path, pdf_url: url, punten: pts.length, aan, bericht: (d.bericht || "").trim(), klant_zichtbaar: d.klant_zichtbaar === "on", created_by: S.me.id });
        window.open(url, "_blank");
        if (aan.length || d.drive === "on") {
          if (!driveReady()) toast("Pdf gemaakt; niet gemaild (Drive-script niet ingesteld).", 6000);
          else { btn.textContent = "Versturen…"; try { const j = await driveCall("werfverslagmail", { id: row.id, aan, drive: d.drive === "on", folderId: p.drive_folder_id || "", token: S.session?.access_token || "" }); toast(`Werfverslag ${nr} gemaakt${(j.naar || []).length ? " en gemaild naar " + j.naar.join(", ") : ""}${j.drive_url ? " · in Drive" : ""}`, 7000); } catch (e) { toast("Pdf gemaakt, maar mailen mislukte: " + e.message, 8000); } }
        } else toast(`Werfverslag ${nr} gemaakt`);
      } catch (e) { toast("Verslag mislukt: " + e.message, 8000); btn.textContent = "Verslag maken en versturen"; return false; }
    },
  });
  const f = $("#mform");
  const sync = () => { const bid = f.querySelector("#wv_bezoek").value; const sel = f.querySelector("#wv_sel").value; const ak = f.querySelector('[name="alleen_klant"]').checked; const pts = puntenVoor(sel, bid, ak); const bt = betrokken(pts);
    f.querySelectorAll('input[name="aan"]').forEach(i => { i.parentElement.querySelector("small").textContent = i.parentElement.querySelector("small").textContent.replace(/ · \d+ punt(en)?$/, "") + (bt.has(i.dataset.cid) ? ` · ${pts.filter(v => v.contact_id === i.dataset.cid).length} punt${pts.filter(v => v.contact_id === i.dataset.cid).length === 1 ? "" : "en"}` : ""); });
    $("#wv_info").textContent = `${pts.length} punt${pts.length === 1 ? "" : "en"} in dit verslag · ${pts.filter(v => v.status === "open").length} open · plannen met pins: ${plansOf(pid).filter(pl => pts.some(v => v.plan_id === pl.id && v.plan_x != null)).length}`; };
  ["#wv_bezoek", "#wv_sel", '[name="alleen_klant"]'].forEach(q => f.querySelector(q).addEventListener("change", sync)); sync();
  // aannemers met punten standaard aanvinken
  const bt = betrokken(puntenVoor("actief", null, false)); f.querySelectorAll('input[name="aan"]').forEach(i => { if (bt.has(i.dataset.cid)) i.checked = true; });
  f.querySelector('[name="klant_zichtbaar"]').addEventListener("change", (e) => { f.querySelectorAll('input[name="aan"]').forEach(i => { if (i.dataset.rol === "bouwheer" || i.dataset.rol === "contactpersoon") i.checked = e.target.checked; }); });
}
function vWerfverslagen(p) {
  if (schemaV() < 21) return "";
  const ws = wvOf(p.id);
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Werfverslagen</h3><div class="muted" style="font-size:12px;margin-top:2px">Pdf met de vaststellingen (foto's, verantwoordelijke, deadline) en de plannen met pins; gemaild naar aannemers en klant.</div></div><div class="actions"><button class="btn sm primary" data-act="wv-new" data-pid="${p.id}">Werfverslag maken</button></div></div>
    ${ws.length ? `<div class="tw"><table class="t"><thead><tr><th>Nr</th><th>Datum</th><th>Bezoek</th><th class="r">Punten</th><th>Verstuurd naar</th><th></th></tr></thead><tbody>${ws.map(w => `<tr><td class="num">${w.nr}</td><td class="num">${fmtLong(w.datum)}</td><td>${w.bezoek_id && S.werfbezoeken[w.bezoek_id] ? `Bezoek ${S.werfbezoeken[w.bezoek_id].nr}` : "—"}</td><td class="r num">${w.punten}</td><td>${(w.aan || []).length ? esc((w.aan || []).join(", ")) : `<span class="muted">niet gemaild</span>`}${w.klant_zichtbaar ? ` <span class="pill st-afgerond">klant</span>` : ""}${w.aannemer_zichtbaar ? ` <span class="pill st-afgerond">aannemers</span>` : ""}${w.drive_url ? ` <a class="muted" href="${esc(w.drive_url)}" target="_blank" rel="noopener">Drive</a>` : ""}</td><td class="r" style="white-space:nowrap"><a class="btn ghost sm" href="${esc(w.pdf_url)}" target="_blank" rel="noopener">Pdf</a><button class="btn ghost sm" data-act="wv-share" data-id="${w.id}" title="${w.klant_zichtbaar ? "Niet meer tonen in het klantenportaal" : "Tonen in het klantenportaal"}">${w.klant_zichtbaar ? "Klant ✓" : "Klant"}</button>${schemaV() >= 25 ? `<button class="btn ghost sm" data-act="wv-share-a" data-id="${w.id}" title="${w.aannemer_zichtbaar ? "Niet meer tonen aan alle aannemers van dit project (wie het per mail kreeg, ziet het wel)" : "Tonen aan alle aannemers van dit project in hun portaal (wie het per mail kreeg, ziet het sowieso)"}">${w.aannemer_zichtbaar ? "Aannemers ✓" : "Aannemers"}</button>` : ""}<button class="btn ghost sm danger" data-act="wv-del" data-id="${w.id}">✕</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty" style="padding:16px">Nog geen werfverslagen.</div>`}</div>`;
}
/* ---------- AI-assistent (script 023): gesprekken uit het klantenportaal en taakvoorstellen die BROS beoordeelt ---------- */
const ONDERWERP = { planning: "Planning", facturatie: "Facturatie", ontwerp: "Ontwerp", documenten: "Documenten", klacht: "Klacht", overig: "Overig" };
const AI_MODELLEN = [["gpt-4o-mini", "OpenAI gpt-4o-mini (goedkoop, aanbevolen)"], ["gpt-4.1-mini", "OpenAI gpt-4.1-mini"], ["gpt-4.1-nano", "OpenAI gpt-4.1-nano (goedkoopst)"], ["claude-haiku-4-5", "Anthropic Claude Haiku 4.5"], ["claude-3-5-haiku-latest", "Anthropic Claude 3.5 Haiku"]];
const aiCfg = () => (S.instellingen.assistent && S.instellingen.assistent.value) || {};
const voorstellenOpen = () => schemaV() >= 23 ? Object.values(S.taak_voorstellen).filter(v => v.status === "open") : [];
const vsMijn = () => voorstellenOpen().filter(v => v.voorgestelde_user === S.me.id);
const berichtenOf = (pid) => Object.values(S.assistent_berichten).filter(b => b.project_id === pid).sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
const maandStart = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; };
function voorstelCard(v, withProject) {
  const p = S.projecten[v.project_id]; const wie = v.voorgestelde_user ? userById(v.voorgestelde_user).name : "—";
  return `<div class="panel voorstel ${v.urgentie === "hoog" ? "urgent" : ""}" style="margin-bottom:12px">
    <div class="panel-head"><div><div class="eyebrow">${v.urgentie === "hoog" ? `<span class="pill late">Dringend</span> ` : ""}${v.bron === "aannemer" ? `<span class="pill st-on_hold">Aannemer${v.contact_id && S.contacten[v.contact_id] ? " · " + esc(S.contacten[v.contact_id].naam) : ""}</span> ` : ""}${ONDERWERP[v.onderwerp] || esc(v.onderwerp)} · ${fmtLong((v.created_at || "").slice(0, 10))}${withProject && p ? ` · <a href="#" data-open="${p.id}">${esc(projName(p))}</a>` : ""}</div><h3 style="margin-top:4px">${esc(v.titel)}</h3>${v.omschrijving ? `<div class="muted" style="font-size:13px;margin-top:4px">${esc(v.omschrijving)}</div>` : ""}</div>
      <div class="actions" style="align-self:flex-start">${v.status === "open" ? `<button class="btn sm primary" data-act="vt-ok" data-id="${v.id}">Bevestigen</button><button class="btn sm" data-act="vt-edit" data-id="${v.id}">Aanpassen…</button><button class="btn sm ghost danger" data-act="vt-nee" data-id="${v.id}">Weigeren</button>` : `<span class="pill ${v.status === "bevestigd" ? "done" : "kl"}">${v.status === "bevestigd" ? "Bevestigd" : "Geweigerd"}${v.beoordeeld_door ? " · " + esc(userById(v.beoordeeld_door).name) : ""}</span>`}</div></div>
    <div class="panel-body" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px">
      ${v.bron === "aannemer" ? `<div style="grid-column:1/-1"><div class="eyebrow">Vraag of melding van de aannemer</div><div style="white-space:pre-wrap;margin-top:4px">${esc(v.vraag) || "<span class='muted'>(geen toelichting)</span>"}</div><div class="muted" style="font-size:12px;margin-top:6px">Bevestigen maakt er een taak van; weigeren met een reden = je antwoord aan de aannemer (hij leest het in zijn portaal).</div></div>` : `<div><div class="eyebrow">Vraag van de klant</div><div style="white-space:pre-wrap;margin-top:4px">${esc(v.vraag)}</div></div>
      <div><div class="eyebrow">Antwoord van de assistent</div><div style="white-space:pre-wrap;margin-top:4px;color:var(--ink-2)">${esc(v.antwoord)}</div></div>`}
      <div class="muted" style="grid-column:1/-1">Voorgesteld: <b>${esc(wie)}</b>${v.eind ? ` · tegen ${fmtLong(v.eind)}` : ""}${v.taak_id && S.taken[v.taak_id] ? ` · <a href="#" data-edit-task="${v.taak_id}">taak openen</a>` : ""}${v.reden ? ` · reden: ${esc(v.reden)}` : ""}</div>
    </div></div>`;
}
function vVoorstellen() {
  if (schemaV() < 23) return `<div class="page-head"><div><h1>Voorstellen</h1></div></div>` + SCHEMA_HINT(23);
  const open = voorstellenOpen().sort((a, b) => (a.urgentie === "hoog" ? 0 : 1) - (b.urgentie === "hoog" ? 0 : 1) || (a.created_at || "").localeCompare(b.created_at || ""));
  const rest = Object.values(S.taak_voorstellen).filter(v => v.status !== "open").sort((a, b) => (b.beoordeeld_op || "").localeCompare(a.beoordeeld_op || "")).slice(0, 30);
  return `<div class="page-head"><div><div class="eyebrow">${open.length} open</div><h1>Voorstellen</h1><div class="sub">Vragen van klanten aan de assistent en vragen of meldingen van aannemers uit hun portaal, waar BROS iets voor moet doen. Bevestigen maakt er een taak van; aanpassen laat je titel, wie en datum kiezen; weigeren sluit het af (bij een aannemer is je reden meteen het antwoord dat hij te zien krijgt).</div></div></div>
    ${open.length ? open.map(v => voorstelCard(v, true)).join("") : `<div class="panel"><div class="empty"><b>Geen open voorstellen</b>Alles is beoordeeld.</div></div>`}
    ${rest.length ? `<details style="margin-top:16px"><summary class="muted" style="cursor:pointer">Beoordeeld (${rest.length})</summary><div style="margin-top:10px">${rest.map(v => voorstelCard(v, true)).join("")}</div></details>` : ""}`;
}
function vVragenProject(p) {
  if (schemaV() < 23) return SCHEMA_HINT(23);
  const msgs = berichtenOf(p.id); const vs = Object.values(S.taak_voorstellen).filter(v => v.project_id === p.id).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const cfg = aiCfg(); const nMaand = msgs.filter(m => m.rol === "klant" && (m.created_at || "") >= maandStart()).length; const kost = msgs.reduce((s, m) => s + (Number(m.kost) || 0), 0);
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Vragen van de klant aan de assistent</h3><div class="muted" style="font-size:12px;margin-top:2px">${msgs.length ? `${msgs.filter(m => m.rol === "klant").length} vragen · ${nMaand} deze maand${cfg.plafond_project ? ` van ${cfg.plafond_project}` : ""} · ca. € ${kost.toFixed(2)} modelkost` : "Nog geen vragen gesteld"}${p.assistent === false ? ` · <span class="pill late">assistent uit voor dit project</span>` : ""}</div></div></div>
    ${msgs.length ? `<div class="chat">${msgs.map(m => `<div class="msg ${m.rol}"><div class="bubble">${esc(m.tekst)}</div><div class="when">${m.rol === "assistent" ? "Assistent · " : "Klant · "}${fmtLong((m.created_at || "").slice(0, 10))} ${(m.created_at || "").slice(11, 16)}</div></div>`).join("")}</div>` : `<div class="empty">De klant heeft nog niets gevraagd in het portaal.</div>`}</div>
    ${vs.length ? `<h3 style="margin:0 0 10px">Taakvoorstellen (${vs.filter(v => v.status === "open").length} open)</h3>` + vs.map(v => voorstelCard(v)).join("") : ""}`;
}
async function voorstelBevestig(id, extra = {}) {
  const { data, error } = await sb.rpc("voorstel_bevestig", { p_id: id, p_titel: extra.titel || null, p_assignee: extra.assignee || null, p_eind: extra.eind || null, p_fase: extra.fase || null });
  if (error) { toast("Bevestigen mislukt: " + error.message, 5000); throw error; }
  if (data) S.taak_voorstellen[data.id] = data; if (data && data.taak_id) rowRefetch("taken", data.taak_id).catch(() => refetch("taken")); render(); toast("Bevestigd — de taak staat op het project");
}
function voorstelForm(v) {
  const p = S.projecten[v.project_id];
  openModal("Voorstel aanpassen en bevestigen", `<div class="form-grid">
    <div class="field span2"><label for="vt_titel">Taak</label><input id="vt_titel" name="titel" value="${esc(v.titel)}" required></div>
    <div class="field"><label for="vt_wie">Wie</label><select id="vt_wie" name="assignee">${userOpts(v.voorgestelde_user || S.me.id)}</select></div>
    <div class="field"><label for="vt_eind">Tegen</label><input id="vt_eind" name="eind" type="date" value="${esc(v.eind || "")}"></div>
    <div class="field"><label for="vt_fase">Fase</label><select id="vt_fase" name="fase"><option value="">— huidige fase van het project —</option>${opts(fasenList().map(f => [f.nr, f.nr + " · " + f.naam]), p?.fase_nr || "")}</select></div>
    <div class="field span2"><div class="muted" style="font-size:13px"><b>Vraag:</b> ${esc(v.vraag)}<br><b>Antwoord:</b> ${esc(v.antwoord)}</div></div>
  </div>`, { saveLabel: "Bevestigen", onSave: async (d) => { await voorstelBevestig(v.id, { titel: d.titel.trim(), assignee: d.assignee || null, eind: d.eind || null, fase: d.fase ? Number(d.fase) : null }); } });
}
async function voorstelWeiger(id) {
  const v = S.taak_voorstellen[id]; const reden = prompt(v && v.bron === "aannemer" ? "Antwoord aan de aannemer (hij leest dit in zijn portaal):" : "Reden (optioneel, komt in het logboek):", ""); if (reden === null) return;
  const { data, error } = await sb.rpc("voorstel_weiger", { p_id: id, p_reden: reden || "" });
  if (error) { toast("Weigeren mislukt: " + error.message, 5000); return; }
  if (data) S.taak_voorstellen[data.id] = data; render(); toast("Voorstel geweigerd");
}
function vAssistentBeheer() {
  if (schemaV() < 23) return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h3>AI-assistent (klantenportaal)</h3><span class="pill st-offerte">nog niet geactiveerd</span></div><div class="panel-body">${SCHEMA_HINT(23)}</div></div>`;
  const c = aiCfg(); const r = c.routering || {}; const ms = maandStart();
  const maand = Object.values(S.assistent_berichten).filter(m => (m.created_at || "") >= ms); const vragen = maand.filter(m => m.rol === "klant").length; const kost = maand.reduce((s, m) => s + (Number(m.kost) || 0), 0);
  const perProj = {}; maand.filter(m => m.rol === "klant").forEach(m => perProj[m.project_id] = (perProj[m.project_id] || 0) + 1);
  const pct = c.plafond_globaal ? Math.round(vragen / c.plafond_globaal * 100) : 0;
  const sel = (k) => `<select data-ai-route="${k}">${userOpts(r[k] || "", true)}</select>`;
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>AI-assistent (klantenportaal)</h3><div class="muted" style="font-size:12px;margin-top:2px">Klanten stellen vragen over hun dossier; de assistent antwoordt uit de klant-views en maakt taakvoorstellen die jullie beoordelen.</div></div><span class="pill ${c.actief !== false ? "st-afgerond" : "st-offerte"}">${c.actief !== false ? "aan" : "uit"}</span></div>
    <div class="panel-body"><div class="form-grid">
      <div class="field"><label class="sw-row"><input type="checkbox" class="sw" id="ai_actief" ${c.actief !== false ? "checked" : ""}><span><b>Assistent aan</b><small class="muted" style="display:block">Per project uit te zetten in het projectformulier.</small></span></label></div>
      <div class="field"><label for="ai_model">Model</label><select id="ai_model">${opts(AI_MODELLEN, c.model || "gpt-4o-mini")}</select></div>
      <div class="field"><label for="ai_functie">Naam (slug) van de Edge Function in Supabase</label><input id="ai_functie" value="${esc(c.functie || "assistent")}" placeholder="assistent"><small class="muted">Het deel na <code>/functions/v1/</code> in het adres van de functie, bv. <code>dynamic-handler</code>.</small></div>
      <div class="field"><label for="ai_pp">Plafond per project per maand (vragen)</label><input id="ai_pp" type="number" min="0" value="${Number(c.plafond_project) || 0}"><small class="muted">0 = geen plafond. Erboven geeft de assistent de vraag door zonder modeloproep.</small></div>
      <div class="field"><label for="ai_pg">Globaal plafond per maand (vragen)</label><input id="ai_pg" type="number" min="0" value="${Number(c.plafond_globaal) || 0}"><small class="muted">Harde stop voor alle projecten samen.</small></div>
      <div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" id="ai_datums" ${c.datums !== false ? "checked" : ""}><span><b>Data uit de planning noemen</b><small class="muted" style="display:block">Aan: de assistent noemt de data uit de klantplanning, met de nuance dat ze kunnen schuiven. Uit: enkel de fase.</small></span></label></div>
      <div class="field span2"><label for="ai_begroeting">Zin bovenaan het tabblad Vragen</label><input id="ai_begroeting" value="${esc(c.begroeting || "")}"></div>
      <div class="field span2"><label>Routering van taakvoorstellen</label><div class="tw"><table class="t"><tbody>${Object.entries(ONDERWERP).map(([k, l]) => `<tr><td style="width:160px">${l}${k === "klacht" ? ' <span class="muted">(altijd dringend)</span>' : ""}</td><td>${sel(k)}</td></tr>`).join("")}</tbody></table></div><small class="muted">Leeg = naar de beheerder.</small></div>
      <div class="field span2"><div class="actions"><button class="btn primary" data-act="ai-save">Bewaren</button><span class="muted" style="font-size:12px">De API-sleutel staat niet hier maar als secret bij de Edge Function in Supabase (zie README).</span></div></div>
    </div>
    <div class="rend" style="margin-top:14px"><div class="panel"><div class="k">Vragen deze maand</div><div class="v ${pct >= 80 ? "neg" : ""}">${vragen}${c.plafond_globaal ? ` <small class="muted" style="font-size:12px;font-weight:400">/ ${c.plafond_globaal}${pct >= 80 ? " · " + pct + " %" : ""}</small>` : ""}</div></div><div class="panel"><div class="k">Geschatte modelkost</div><div class="v">€ ${kost.toFixed(2)}</div></div><div class="panel"><div class="k">Open voorstellen</div><div class="v">${voorstellenOpen().length}</div></div><div class="panel"><div class="k">Projecten met vragen</div><div class="v">${Object.keys(perProj).length}</div></div></div>
    ${Object.keys(perProj).length ? `<div class="tw" style="margin-top:10px"><table class="t"><tbody>${Object.entries(perProj).sort((a, b) => b[1] - a[1]).map(([pid, n]) => `<tr><td>${esc(projName(S.projecten[pid]))}</td><td class="r num">${n}${c.plafond_project ? ` / ${c.plafond_project}` : ""}${c.plafond_project && n >= c.plafond_project * 0.8 ? ` <span class="pill late">bijna vol</span>` : ""}</td></tr>`).join("")}</tbody></table></div>` : ""}</div></div>`;
}
async function aiSaveSettings() {
  const r = {}; document.querySelectorAll("[data-ai-route]").forEach(s => r[s.dataset.aiRoute] = s.value || null);
  const value = { ...aiCfg(), actief: $("#ai_actief").checked, model: $("#ai_model").value, functie: ($("#ai_functie").value.trim().replace(/^.*\/functions\/v1\//, "").replace(/\/.*$/, "") || "assistent"), plafond_project: Number($("#ai_pp").value) || 0, plafond_globaal: Number($("#ai_pg").value) || 0, datums: $("#ai_datums").checked, begroeting: $("#ai_begroeting").value.trim(), routering: r };
  const { data, error } = await sb.from("instellingen").upsert({ key: "assistent", value, updated_at: new Date().toISOString() }).select().single();
  if (error) { toast("Bewaren mislukt: " + error.message, 5000); return; } S.instellingen.assistent = data; render(); toast("Assistent-instellingen bewaard");
}
/* ---------- Goedkeuringen: BROS legt de offerte of een meerwerkvoorstel voor, de klant beslist in het portaal ---------- */
const GK_STATUS = { open: "Wacht op klant", akkoord: "Goedgekeurd", geweigerd: "Niet akkoord", ingetrokken: "Ingetrokken" };
const gkOf = (pid) => Object.values(S.goedkeuringen).filter(g => g.project_id === pid).sort((a, b) => (b.voorgelegd_op || "").localeCompare(a.voorgelegd_op || ""));
const gkOpenIds = (pid) => new Set(gkOf(pid).filter(g => g.status === "open" && !(g.geldig_tot && g.geldig_tot < todayIso)).flatMap(g => (g.posten || []).map(x => x.id)));
/* post die nog voorgelegd kan worden: offerte zonder akkoord, of meer-/minwerk zonder akkoord, en niet in een open voorstel */
const gkKandidaat = (r) => msTelt(r) && !r.akkoord_op && (r.status === "offerte" || isMw(r)) && !gkOpenIds(r.project_id).has(r.id);
const gkSnapshot = (r) => ({ id: r.id, lot: r.lot, code: r.code, omschrijving: r.omschrijving, locatie: r.locatie || "", hoeveelheid: Number(r.hoeveelheid) || 0, eenheid: r.eenheid, prijs: Math.round(msVerkoopEP(r) * 100) / 100, totaal: Math.round(rowSigned(r) * 100) / 100, btw: Number(r.btw) || 0, status: r.status });
function vGoedkeuringen(p) {
  if (schemaV() < 13) return "";
  const gs = gkOf(p.id); if (!gs.length) return "";
  const klanten = contactsOf(p.id).filter(x => ["bouwheer", "contactpersoon"].includes(x.rol) && x.c.user_id);
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Goedkeuringen door de klant</h3><div class="muted" style="font-size:12px;margin-top:2px">${klanten.length ? `Zichtbaar in het portaal voor ${klanten.map(x => esc(x.c.naam)).join(", ")}.` : `<span style="color:var(--warn)">Nog niemand van dit project heeft portaal-toegang (Dossier › Contacten).</span>`}</div></div></div>
    <div class="tw"><table class="t"><thead><tr><th>Voorstel</th><th>Voorgelegd</th><th>Reageren vóór</th><th class="r">Excl. btw</th><th class="r">Incl. btw</th><th>Status</th><th>Beslist</th><th></th></tr></thead><tbody>
    ${gs.map(g => { const verlopen = g.status === "open" && g.geldig_tot && g.geldig_tot < todayIso; return `<tr><td><b>${esc(g.titel || (g.soort === "meerwerk" ? "Meerwerk" : "Offerte"))}</b><small class="muted" style="display:block">${(g.posten || []).length} posten${g.toelichting ? " · " + esc(g.toelichting.slice(0, 80)) : ""}</small></td><td class="num">${fmtLong((g.voorgelegd_op || "").slice(0, 10))}<small class="muted" style="display:block">${esc(userById(g.voorgelegd_door).name)}</small></td><td class="num" style="${verlopen ? "color:var(--crit)" : ""}">${g.geldig_tot ? fmtLong(g.geldig_tot) : "—"}</td><td class="r num">${eur(g.totaal_excl)}</td><td class="r num">${eur(g.totaal_incl)}</td><td><span class="pill ${g.status === "akkoord" ? "st-afgerond" : verlopen ? "late" : g.status === "open" ? "st-lopend" : g.status === "geweigerd" ? "late" : "st-on_hold"}">${verlopen ? "Termijn verstreken" : GK_STATUS[g.status]}</span></td><td style="font-size:12px">${g.beslist_op ? `${fmtLong(g.beslist_op.slice(0, 10))} · ${esc(g.beslist_naam)}${g.opmerking ? `<div style="color:var(--crit)">“${esc(g.opmerking)}”</div>` : ""}` : "—"}</td>
      <td class="r" style="white-space:nowrap"><button class="btn ghost sm" data-act="gk-view" data-id="${g.id}">Bekijken</button>${g.status === "open" ? `<button class="btn ghost sm danger" data-act="gk-withdraw" data-id="${g.id}">Intrekken</button>` : ""}${g.status === "geweigerd" || g.status === "ingetrokken" || verlopen ? `<button class="btn ghost sm" data-act="gk-new" data-pid="${p.id}" data-soort="${g.soort}">Opnieuw voorleggen</button>` : ""}</td></tr>`; }).join("")}</tbody></table></div></div>`;
}
function gkForm(pid, soortVoorkeur) {
  const p = S.projecten[pid]; const rows = msRows(pid).filter(gkKandidaat);
  const off = rows.filter(r => r.status === "offerte"), mw = rows.filter(isMw);
  const soort = soortVoorkeur && (soortVoorkeur === "meerwerk" ? mw.length : off.length) ? soortVoorkeur : (off.length ? "offerte" : "meerwerk");
  const klanten = contactsOf(pid).filter(x => ["bouwheer", "contactpersoon"].includes(x.rol) && x.c.user_id);
  const lijst = (rs) => rs.map(r => `<label class="chk"><input type="checkbox" name="post" value="${r.id}" checked> <span>${esc(r.code)} ${esc(r.omschrijving)}${r.locatie ? ` <small class="muted">· ${esc(r.locatie)}</small>` : ""}<small class="muted" style="display:block">${nl(r.hoeveelheid, 2)} ${esc(r.eenheid)} × ${eur2(msVerkoopEP(r))} = <b>${eur2(rowSigned(r))}</b>${isMw(r) ? ` · ${MS_STATUS[r.status]}` : ""}</small></span></label>`).join("");
  openModal("Ter goedkeuring voorleggen — " + p.klant, `<div class="form-grid">
    <div class="field"><label for="gk_soort">Wat leg je voor?</label><select id="gk_soort" name="soort">${off.length ? `<option value="offerte" ${soort === "offerte" ? "selected" : ""}>Offerte (${off.length} posten in status Offerte)</option>` : ""}${mw.length ? `<option value="meerwerk" ${soort === "meerwerk" ? "selected" : ""}>Meerwerkvoorstel (${mw.length} meer-/minwerkposten)</option>` : ""}</select></div>
    <div class="field"><label for="gk_titel">Titel (ziet de klant)</label><input id="gk_titel" name="titel" value="${esc(soort === "meerwerk" ? "Meerwerk " + fmtLong(todayIso) : "Offerte " + (p.naam && p.naam !== p.klant ? p.naam : p.klant))}"></div>
    <div class="field"><label for="gk_tot">Reageren vóór</label><input id="gk_tot" name="geldig_tot" type="date" value="${addDays(todayIso, 14)}"><small class="muted">Na deze datum kan de klant niet meer goedkeuren; leeg = geen deadline.</small></div>
    <div class="field span2"><label for="gk_toel">Toelichting voor de klant (optioneel)</label><textarea id="gk_toel" name="toelichting" rows="2" placeholder="bv. Zoals besproken op de werf van 12/09: extra stopcontacten in de keuken."></textarea></div>
    <div class="field span2"><label>Posten in dit voorstel</label><div class="fase-list" id="gk_list" style="max-height:320px;overflow:auto">${lijst(soort === "meerwerk" ? mw : off)}</div></div>
    <div class="field span2"><p class="muted" style="font-size:12px;margin:0">Het Planbord bewaart een bevroren kopie van deze posten met hoeveelheden en klantprijzen; latere wijzigingen in de meetstaat veranderen het voorstel niet. ${klanten.length ? `De klant (${klanten.map(x => esc(x.c.naam)).join(", ")}) krijgt een mail en ziet het voorstel in het portaal.` : `<span style="color:var(--warn)">Let op: niemand van dit project heeft nog portaal-toegang — geef die eerst via Dossier › Contacten, anders kan de klant niet reageren.</span>`}</p></div>
  </div>`, {
    saveLabel: "Voorleggen", wide: true,
    onSave: async (d) => {
      const ids = [...$("#mform").querySelectorAll('input[name="post"]:checked')].map(i => i.value); if (!ids.length) { toast("Vink minstens één post aan."); return false; }
      const sel = ids.map(id => S.meetstaat_posten[id]).filter(Boolean); const posten = sel.map(gkSnapshot);
      const excl = posten.reduce((s, x) => s + x.totaal, 0), btw = sel.reduce((s, r) => s + rowSigned(r) * (Number(r.btw) || 0), 0);
      const row = { project_id: pid, soort: d.soort, titel: d.titel.trim(), toelichting: (d.toelichting || "").trim(), status: "open", geldig_tot: d.geldig_tot || null, posten, totaal_excl: Math.round(excl * 100) / 100, btw: Math.round(btw * 100) / 100, totaal_incl: Math.round((excl + btw) * 100) / 100, voorgelegd_door: S.me.id };
      const g = await dbInsert("goedkeuringen", row);
      toast("Voorstel staat klaar in het portaal");
      if (driveReady() && klanten.length) driveCall("gkmail", { id: g.id, soort: "voorgelegd", token: S.session?.access_token || "" }).then(j => toast(`Mail gestuurd naar ${(j.naar || []).join(", ") || "de klant"}`)).catch(e => toast("Mail niet verstuurd: " + e.message, 6000));
    },
  });
  $("#gk_soort").addEventListener("change", () => { const srt = $("#gk_soort").value; $("#gk_list").innerHTML = lijst(srt === "meerwerk" ? mw : off); $("#gk_titel").value = srt === "meerwerk" ? "Meerwerk " + fmtLong(todayIso) : "Offerte " + (p.naam && p.naam !== p.klant ? p.naam : p.klant); });
}
function gkView(id) {
  const g = S.goedkeuringen[id]; if (!g) return; const ps = g.posten || [];
  openModal(`${g.titel || GK_STATUS[g.status]} — ${GK_STATUS[g.status]}`, `<div class="form-grid"><div class="field span2">
    <p style="margin:0 0 8px">${g.toelichting ? esc(g.toelichting) + "<br>" : ""}<span class="muted" style="font-size:12px">Voorgelegd ${fmtLong((g.voorgelegd_op || "").slice(0, 10))} door ${esc(userById(g.voorgelegd_door).name)}${g.geldig_tot ? ` · reageren vóór ${fmtLong(g.geldig_tot)}` : ""}${g.beslist_op ? ` · ${GK_STATUS[g.status]} op ${fmtLong(g.beslist_op.slice(0, 10))} door ${esc(g.beslist_naam)} (${esc(g.beslist_email)})` : ""}</span>${g.opmerking ? `<p style="margin:8px 0 0;color:var(--crit)">Opmerking van de klant: “${esc(g.opmerking)}”</p>` : ""}</p>
    <div class="tw"><table class="t"><thead><tr><th>Nr</th><th>Omschrijving</th><th class="r">Hoev.</th><th class="r">Prijs</th><th class="r">Totaal</th></tr></thead><tbody>${ps.map(x => `<tr><td class="num muted">${esc(x.code)}</td><td>${esc(x.omschrijving)}${x.locatie ? ` <small class="muted">· ${esc(x.locatie)}</small>` : ""}</td><td class="r num">${nl(x.hoeveelheid, 2)} ${esc(x.eenheid)}</td><td class="r num">${eur2(x.prijs)}</td><td class="r num">${eur2(x.totaal)}</td></tr>`).join("")}
    <tr class="tot"><td colspan="4"><b>Totaal excl. btw</b></td><td class="r num"><b>${eur2(g.totaal_excl)}</b></td></tr><tr><td colspan="4">Btw</td><td class="r num">${eur2(g.btw)}</td></tr><tr><td colspan="4"><b>Totaal incl. btw</b></td><td class="r num"><b>${eur2(g.totaal_incl)}</b></td></tr></tbody></table></div></div></div>`, { saveLabel: "Sluiten", wide: true, onSave: async () => { } });
}
async function gkWithdraw(id) {
  const g = S.goedkeuringen[id]; if (!g || g.status !== "open" || !confirm("Dit voorstel intrekken? De klant ziet het dan niet meer in het portaal.")) return;
  await dbUpdate("goedkeuringen", id, { status: "ingetrokken" }).catch(() => { });
}
function msNextCode(pid, lot) { const n = msRows(pid).filter(r => r.lot === lot).length + 1; return `${lot}.${n}`; }
function msRowFromPost(pid, x, lot, i) {
  const sog = x.prijstype !== "EP";
  return { project_id: pid, post_id: x.id || null, lot, code: `${lot}.${i}`, groep: x.groep || "", omschrijving: x.omschrijving, eenheid: x.eenheid || (sog ? "sog" : "stk"), prijstype: x.prijstype || "EP", hoeveelheid: sog ? 1 : 0, eenheidsprijs: Number(x.richtprijs) || 0, marge: null, btw: x.btw ?? 0.06, status: "offerte", volgorde: x.volgorde ?? 0, created_by: S.me?.id || null };
}
async function msInsert(rows) {
  if (!rows.length) return [];
  const v12 = schemaV() >= 12;
  const clean = v12 ? rows.map(({ eenheidsprijs, marge, ...r }) => r) : rows;
  const { data, error } = await sb.from("meetstaat_posten").insert(clean).select();
  if (error) { toast("Mislukt: " + error.message); throw error; }
  (data || []).forEach(r => S.meetstaat_posten[r.id] = r);
  if (v12 && data) {
    // vrije posten en geïmporteerde regels: prijs expliciet bewaren (bibliotheekposten krijgen hun richtprijs via de trigger)
    const prijzen = !isBeheer() ? [] : data.map((r, i) => ({ post_id: r.id, eenheidsprijs: Number(rows[i].eenheidsprijs) || 0, marge: rows[i].marge == null || rows[i].marge === "" ? null : Number(rows[i].marge) })).filter((p, i) => !rows[i].post_id || Number(rows[i].eenheidsprijs) > 0 && isBeheer());
    for (let i = 0; i < prijzen.length; i += 200) { const chunk = prijzen.slice(i, i + 200); const { error: e2 } = await (isBeheer() ? sb.from("meetstaat_prijzen").upsert(chunk) : sb.from("meetstaat_prijzen").insert(chunk)); if (e2) toast("Prijzen niet bewaard: " + e2.message); }
    await msRefetch(data.map(r => r.id));
  }
  render(); return data || [];
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
      ${isBeheer() ? `<div class="field"><label for="ap_prijs">Kostprijs vrije post (excl. btw)</label><input id="ap_prijs" name="prijs" type="number" step="any" placeholder="0"></div>` : `<div class="field"><label>Prijs</label><div class="muted" style="font-size:13px;padding:8px 0">Prijzen vult beheer in.</div></div>`}
    </div>`, {
    saveLabel: "Toevoegen", wide: true,
    onSave: async (d) => {
      const lotNr = Number(d.lot); const ids = [...$("#mform").querySelectorAll('input[name="post"]:checked')].map(i => i.value);
      const rows = []; const cnt = {}; const next = (l) => { cnt[l] = (cnt[l] ?? msRows(pid).filter(r => r.lot === l).length) + 1; return cnt[l]; };
      const zoekend = !!$("#ap_q").value.trim();
      ids.forEach(id => { const x = S.posten[id]; const l = zoekend ? x.lot : lotNr; rows.push(msRowFromPost(pid, x, l, next(l))); });
      if (d.vrij && d.vrij.trim()) { const n = next(lotNr); const row = msRowFromPost(pid, { omschrijving: d.vrij.trim(), eenheid: d.eenheid, prijstype: d.eenheid === "sog" ? "SOG" : "EP", richtprijs: Number(d.prijs) || 0, btw: 0.06, volgorde: 9000 + n }, lotNr, n); row.hoeveelheid = 1; rows.push(row); }
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
  try {
    if (schemaV() >= 12 && (f === "eenheidsprijs" || f === "marge")) {
      const { error } = await sb.from("meetstaat_prijzen").upsert({ post_id: id, eenheidsprijs: f === "eenheidsprijs" ? v : (Number(r.eenheidsprijs) || 0), marge: f === "marge" ? v : (r.marge == null || r.marge === "" ? null : Number(r.marge)), updated_at: new Date().toISOString() });
      if (error) { toast("Bewaren mislukt: " + error.message); return; }
      S.meetstaat_posten[id] = { ...r, [f]: v }; await msRefetch([id]);
    } else await dbUpdate("meetstaat_posten", id, { [f]: v, updated_at: new Date().toISOString() });
  } catch (e) { return; }
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
function cumPost(pid, calcs, r) { return vordOf(pid).filter(v => (v.soort === "meerwerk") === isMw(r)).reduce((s, v) => s + (calcs[v.id]?.perPost[r.id]?.pct || 0), 0); }
/* bedrag → %: de regels van een vordering herschalen zodat de berekende som precies op een bedrag (excl. btw) uitkomt.
   Elke regel wordt begrensd op wat er voor die post(en) nog openstaat; lukt het niet volledig, dan geeft `tekort` het verschil. */
const regelsExcl = (rows, regels) => { const lot = {}, post = {}; regels.forEach(g => { if (g.post_id) post[g.post_id] = g; else lot[g.lot] = g; }); return rows.reduce((s, r) => { const g = post[r.id] || lot[r.lot]; return s + (g ? Number(g.pct) * rowSigned(r) : 0); }, 0); };
function fitRegels(pid, soort, regels, bedrag, calcs) {
  const rows = vordRows(pid, soort); const post = {}; regels.forEach(g => { if (g.post_id) post[g.post_id] = g; });
  let base = regels.map(g => ({ ...g, pct: Number(g.pct) })); let excl0 = regelsExcl(rows, base);
  if (!(Math.abs(excl0) > 0.005)) { base = base.map(g => ({ ...g, pct: 1 })); excl0 = regelsExcl(rows, base); }
  if (!(Math.abs(excl0) > 0.005)) return { regels: base, excl: 0, tekort: bedrag };
  const f = bedrag / excl0;
  const capOf = (g) => { const rs = g.post_id ? rows.filter(r => r.id === g.post_id) : rows.filter(r => r.lot === g.lot && !post[r.id]); return rs.length ? Math.max(0, Math.min(...rs.map(r => 1 - cumPost(pid, calcs, r)))) : 1; };
  const out = base.map(g => ({ ...g, pct: Math.max(0, Math.min(capOf(g), g.pct * f)) }));
  const excl = regelsExcl(rows, out); return { regels: out, excl, tekort: bedrag - excl };
}
/* bestaande, nog open vordering: percentages afleiden uit het ingevulde factuurbedrag */
async function vordFit(vid) {
  const v = S.vorderingen[vid]; if (!v || vordLocked(v) || v.bedrag_excl == null || v.bedrag_excl === "") return;
  const bedrag = Number(v.bedrag_excl); const pid = v.project_id;
  const calcs = {}; vordOf(pid).filter(x => x.id !== vid).forEach(x => calcs[x.id] = vordCalc(x));
  let regels = Object.values(S.vordering_regels).filter(r => r.vordering_id === vid).map(r => ({ id: r.id, lot: r.lot, post_id: r.post_id, pct: Number(r.pct) }));
  if (!regels.length) { const basis = lotBasis(pid); const lots = Object.keys(basis).map(Number).filter(l => Math.abs(vordBase(basis, l, v.soort)) > 0.005); regels = restRegels(pid, v.soort, lots, calcs); }
  if (!regels.length) return toast("Er staat niets meer open om te verdelen.");
  const fit = fitRegels(pid, v.soort, regels, bedrag, calcs);
  for (const g of fit.regels) {
    if (g.id) { const { data, error } = await sb.from("vordering_regels").update({ pct: g.pct }).eq("id", g.id).select().single(); if (error) return toast("Mislukt: " + error.message); S.vordering_regels[rowKey("vordering_regels", data)] = data; }
    else { const { data, error } = await sb.from("vordering_regels").insert({ vordering_id: vid, lot: g.lot, post_id: g.post_id || null, pct: g.pct }).select().single(); if (error) return toast("Mislukt: " + error.message); S.vordering_regels[rowKey("vordering_regels", data)] = data; }
  }
  render(); toast(Math.abs(fit.tekort) > 0.5 ? `Percentages op het maximum gezet — ${eur(fit.tekort)} meer dan er nog openstaat voor deze loten` : `Percentages afgeleid uit ${eur(bedrag)}`);
}
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
  const zonderHoev = msRows(p.id).filter(r => msTelt(r) && !(Number(r.hoeveelheid) > 0) && Number(r.eenheidsprijs) > 0);
  const waarschuwing = zonderHoev.length ? `<div class="banner show" style="border:1px solid var(--line);border-radius:8px;margin-bottom:16px">${zonderHoev.length} post${zonderHoev.length > 1 ? "en" : ""} in de meetstaat ${zonderHoev.length > 1 ? "hebben" : "heeft"} wel een prijs maar nog geen hoeveelheid (${zonderHoev.slice(0, 3).map(r => esc(r.code + " " + r.omschrijving.slice(0, 30))).join(", ")}${zonderHoev.length > 3 ? ", …" : ""}) — die tellen voor € 0 mee in het contract. Vul de hoeveelheid in op het tabblad Meetstaat.</div>` : "";
  if (!lots.length || contract + Math.abs(meerwerk) < 0.005) return kpi + waarschuwing + `<div class="panel"><div class="empty"><b>${lots.length ? "Het contract staat op € 0" : "Nog geen meetstaat"}</b>${lots.length ? "De vorderingsstaat rekent op hoeveelheid × prijs van de posten in de meetstaat; vul eerst de hoeveelheden in." : "Maak eerst de meetstaat op (tabblad Meetstaat); de vorderingsstaat rekent op de loten en posten daarvan."}</div></div>`;
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
      ${beheer ? `<div class="vh-row"><span class="muted" title="Bedrag op de factuur in Yuki (excl. btw) — wordt bevroren zodra de status verzonden of betaald is. Wijkt het af van de berekening, dan kan je de percentages eruit laten afleiden.">Factuur excl.</span><input class="inline num" data-vf="${v.id}" data-f="bedrag_excl" type="number" step="any" value="${v.bedrag_excl == null ? "" : Number(v.bedrag_excl)}" placeholder="${Math.round(c.excl)}"></div>` : ""}
      ${frozen && Math.abs(diff) > 0.5 ? `<div class="vh-row" style="color:var(--warn)"><span>Verschil</span><span class="num">${eur(diff)}</span></div>` : ""}
      ${beheer && !vordLocked(v) && v.bedrag_excl != null && v.bedrag_excl !== "" && Math.abs(Number(v.bedrag_excl) - c.excl) > 0.5 ? `<div class="vh-row"><button class="btn ghost sm" data-act="vord-fit" data-id="${v.id}" title="De percentages van deze vordering zo herrekenen dat de berekening precies op het factuurbedrag uitkomt (verschil nu ${eur(Number(v.bedrag_excl) - c.excl)})">Percentages afleiden uit ${eur(Number(v.bedrag_excl))}</button></div>` : ""}
      <div class="vh-row"><span class="muted">Status</span>${beheer ? `<select class="inline" data-vf="${v.id}" data-f="status">${opts(Object.entries(VORD_STATUS), v.status)}</select>` : `<span>${VORD_STATUS[v.status]}</span>`}</div></div></th>`; }).join("");
  const grid = `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Vorderingsstaat</h3><div class="muted" style="font-size:12px;margin-top:2px">Per lot het % dat je in elke vordering factureert; klap een lot open (▸) om per post te werken — een post-% overschrijft het lot-%. Het voorschot telt overal mee. Meerwerk staat apart en zit niet in het voorschot.</div></div>
      <div class="actions">${beheer ? `${heeftVoorschot ? "" : `<button class="btn sm" data-act="vord-new" data-pid="${p.id}" data-soort="voorschot">+ Voorschot</button>`}<button class="btn sm primary" data-act="vord-new" data-pid="${p.id}" data-soort="vordering">+ Vordering</button>${meerwerk ? `<button class="btn sm" data-act="vord-new" data-pid="${p.id}" data-soort="meerwerk">+ Meerwerkfactuur</button>` : ""}<button class="btn sm" data-act="vord-new" data-pid="${p.id}" data-soort="slotfactuur" title="Alles wat nog openstaat, per post">+ Slotfactuur</button>` : ""}</div></div>
    ${vs.length ? `<div class="tw"><table class="t vord"><thead><tr><th class="sticky">Lot / post</th><th class="r">Basis excl.</th>${head}<th class="c">Cumul.</th><th class="r">Rest</th></tr></thead><tbody>
      ${lotRows("vordering")}${totRow("Contract", contract, (v) => v.soort === "meerwerk" ? 0 : calcs[v.id].excl, contract - sumInv("vordering"))}
      ${meerwerk ? lotRows("meerwerk") + totRow("Meer-/minwerk", meerwerk, (v) => v.soort === "meerwerk" ? calcs[v.id].excl : 0, meerwerk - sumInv("meerwerk")) : ""}
      ${totRow("Totaal excl. btw", contract + meerwerk, (v) => calcs[v.id].excl, contract + meerwerk - sumInv("vordering") - sumInv("meerwerk"))}
      <tr class="tot"><td class="sticky"><b>Totaal incl. btw</b></td><td></td>${vs.map(v => `<td class="c num"><b>${eur(calcs[v.id].incl)}</b></td>`).join("")}<td></td><td></td></tr></tbody></table></div>` : `<div class="empty"><b>Nog geen vorderingen</b>Begin met het voorschot (bv. 30 % op het contract), daarna een vordering per afgewerkt lot of per post.</div>`}</div>`;
  const klant = `<div class="panel"><div class="panel-head"><div><h3>Overzicht voor de klant</h3><div class="muted" style="font-size:12px;margin-top:2px">Zo ziet de klant het in het portaal: de facturen en, per lot en post, welk aandeel in welke factuur zat (cumulatief en rest) — zonder kostprijzen, berekend-versus-factuurverschillen of Yuki-details.</div></div></div>
    <div class="tw"><table class="t"><thead><tr><th>Nr</th><th>Datum</th><th>Omschrijving</th><th>Loten</th><th class="r">Excl. btw</th><th class="r">Btw</th><th class="r">Incl. btw</th><th>Status</th></tr></thead><tbody>
      ${vs.map(v => { const c = calcs[v.id]; const excl = vordBedrag(v, c); const btw = c.excl ? excl * (c.btw / c.excl) : c.btw; const lotsTxt = v.soort === "voorschot" ? "alle loten" : Object.keys(c.perLot).filter(l => Math.abs(c.perLot[l].excl) > 0.005).map(l => lotName(Number(l))).join(", ");
        return `<tr><td class="num">${v.nr === 0 ? "V" : v.nr}</td><td class="num">${fmtLong(v.datum)}</td><td>${esc(v.omschrijving || VORD_SOORT[v.soort])}${v.factuurnummer ? `<small class="muted" style="display:block">factuur ${esc(v.factuurnummer)}</small>` : ""}</td><td class="muted" style="font-size:12px;max-width:260px">${esc(lotsTxt)}</td><td class="r num">${eur(excl)}</td><td class="r num">${eur(btw)}</td><td class="r num"><b>${eur(excl + btw)}</b></td><td><span class="pill st-${v.status === "betaald" ? "afgerond" : v.status === "verzonden" ? "lopend" : "offerte"}">${VORD_STATUS[v.status]}</span></td></tr>`; }).join("") || `<tr><td class="muted" colspan="8">Nog geen facturen.</td></tr>`}
      <tr class="tot"><td colspan="4"><b>Nog te factureren (contract + meerwerk − gefactureerd/opgemaakt)</b></td><td class="r num"><b>${eur(contract + meerwerk - gefact - open)}</b></td><td></td><td></td><td></td></tr></tbody></table></div></div>`;
  return kpi + waarschuwing + grid + klant;
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
      : `<div class="field span2"><label>Loten die je nu factureert — het resterende % wordt voorgesteld (of vul hieronder een bedrag in); daarna per lot of per post aanpasbaar in de tabel</label><div class="fase-list">${lots.map(l => { const rest = restLot(l, soort); const base = vordBase(basis, l, soort); return `<label class="chk"><input type="checkbox" name="lot" value="${l}" ${Math.abs(rest) <= 0.005 ? "disabled" : ""}> <span>${esc(lotName(l))}<small class="muted" style="display:block">rest ${base ? nl(rest / base * 100, 0) : 0} % · ${eur(rest)}</small></span></label>`; }).join("")}</div></div>`}
      ${isSlot ? "" : `<div class="field span2"><label for="vo_bedrag">${isVoorschot ? "Of een bedrag excl. btw" : "Bedrag excl. btw (optioneel)"}</label><input id="vo_bedrag" name="bedrag" type="number" step="any" min="0" placeholder="${isVoorschot ? "leeg = het % hierboven" : "leeg = het resterende % van de gekozen loten"}" style="max-width:220px"><small class="muted" style="display:block;margin-top:4px">Vul je een bedrag in — bv. een factuur die al verstuurd is — dan worden de percentages zo berekend dat deze vordering precies op dat bedrag uitkomt en wordt het van de rest afgehouden.</small></div>`}
    </div>`, {
    saveLabel: "Aanmaken", wide: !isVoorschot,
    onSave: async (d) => {
      const sel = isVoorschot || isSlot ? lots : [...$("#mform").querySelectorAll('input[name="lot"]:checked')].map(i => Number(i.value));
      if (!sel.length) { toast("Kies minstens één lot."); return false; }
      let regels = isVoorschot ? sel.map(l => ({ lot: l, post_id: null, pct: (Number(d.pct) || 0) / 100 })) : restRegels(pid, isSlot ? "vordering" : soort, sel, calcs);
      if (!regels.length) { toast("Er staat niets meer open voor deze loten."); return false; }
      const bedrag = d.bedrag == null || String(d.bedrag).trim() === "" ? null : Number(String(d.bedrag).replace(",", "."));
      let fitMsg = "";
      if (bedrag != null && !isSlot) { if (!(bedrag > 0)) { toast("Vul een bedrag groter dan 0 in, of laat het veld leeg."); return false; } const fit = fitRegels(pid, soort, regels, bedrag, calcs); regels = fit.regels; if (Math.abs(fit.tekort) > 0.5) fitMsg = ` — let op: ${eur(fit.tekort)} meer dan er nog openstaat voor deze loten; percentages op het maximum gezet`; else fitMsg = ` — percentages afgeleid uit ${eur(bedrag)}`; }
      const { data: v, error } = await sb.from("vorderingen").insert({ project_id: pid, nr: nextNr, soort, omschrijving: d.omschrijving.trim(), datum: d.datum || null, status: "opgemaakt", bedrag_excl: bedrag }).select().single();
      if (error) { toast("Mislukt: " + error.message); return false; }
      S.vorderingen[v.id] = v;
      const r2 = await sb.from("vordering_regels").insert(regels.map(r => ({ vordering_id: v.id, lot: r.lot, post_id: r.post_id, pct: r.pct }))).select();
      if (r2.error) { toast("Regels niet bewaard: " + r2.error.message + (/post_id/.test(r2.error.message) ? " — voer sql/008_vordering_posten.sql uit" : "")); } else (r2.data || []).forEach(r => S.vordering_regels[rowKey("vordering_regels", r)] = r);
      render(); toast(`${VORD_SOORT[soort]} aangemaakt${fitMsg}`);
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
/* ---------- Meetstaat importeren uit een bestaand Excel-bestand ---------- */
function msImportPick(pid) {
  if (!window.JSZip || !window.MeetstaatImport) return toast("Importmodule niet geladen — herlaad de pagina.");
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) msImportFile(pid, f).catch(err => { loader.fail(); toast("Import: " + err.message); }); };
  inp.click();
}
async function msImportPlaceholders() {
  // regels van het lege sjabloon: onaangeroerde sjabloonregels (zonder cijfers) worden niet geïmporteerd
  if (msImportPlaceholders.cache) return msImportPlaceholders.cache;
  try {
    if (!templateCache && driveReady()) { const j = await driveCall("template", { match: "MEETSTAAT" }); const bin = atob(j.base64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); templateCache = { name: j.name, bytes }; }
    if (!templateCache) return [];
    const t = await window.MeetstaatImport.parse(templateCache.bytes, window.JSZip, []);
    msImportPlaceholders.cache = t.lots.flatMap(l => l.posts.filter(p => !p._groep).map(p => p.omschrijving.split("\n")[0]));
  } catch (e) { msImportPlaceholders.cache = []; }
  return msImportPlaceholders.cache;
}
async function msImportFile(pid, file) {
  const p = S.projecten[pid]; if (!p) return;
  loader.start("ms.import", "Excel lezen…", 3000);
  const bytes = new Uint8Array(await file.arrayBuffer());
  // sjabloonregels ophalen via het Drive-script; duurt dat te lang (of hapert het script), dan zonder verder
  const ph = await Promise.race([msImportPlaceholders(), new Promise(r => setTimeout(() => r(msImportPlaceholders.cache || []), 8000))]);
  loader.step("Posten herkennen…");
  const parsed = await window.MeetstaatImport.parse(bytes, window.JSZip, ph);
  loader.done("ms.import");
  if (!parsed.lots.length) return toast("Geen loten met posten gevonden in dit bestand.");
  const existing = msRows(pid).length;
  const ov = parsed.overzicht.onvoorzien;
  const lotRows = parsed.lots.map(l => `<tr><td class="num">${l.lot}</td><td>${esc(l.naam)}${S.loten[l.lot] ? "" : ` <span class="pill late">lot ${l.lot} bestaat niet in het Planbord</span>`}</td><td class="r num">${l.posts.filter(x => !x._groep).length}</td><td class="r num">${eur(l.som)}</td></tr>`).join("");
  openModal("Meetstaat importeren", `<div class="muted" style="margin-bottom:10px"><b>${esc(file.name)}</b>${parsed.head.titel ? ` · ${esc(parsed.head.titel)}` : ""}</div>
    <div class="tw" style="max-height:300px;overflow:auto"><table class="t"><thead><tr><th>Lot</th><th>Naam in Excel</th><th class="r">Posten</th><th class="r">Excl. btw</th></tr></thead><tbody>${lotRows}
    ${ov ? `<tr><td class="num">21</td><td>Onvoorziene kost / extra budget (10 %) <span class="muted">uit het blad OVERZICHT</span></td><td class="r num">1</td><td class="r num">${eur(ov)}</td></tr>` : ""}
    <tr class="tot"><td></td><td><b>Totaal</b></td><td class="r num"><b>${parsed.posts}</b></td><td class="r num"><b>${eur(parsed.totaal + (ov || 0))}</b></td></tr></tbody></table></div>
    <div class="form-grid" style="margin-top:12px">
      <div class="field"><label for="mi_status">Status van de posten</label><select id="mi_status" name="status"><option value="akkoord">Akkoord (getekend contract)</option><option value="offerte">Offerte</option></select></div>
      ${existing ? `<div class="field"><label for="mi_mode">Dit project heeft al ${existing} posten</label><select id="mi_mode" name="mode"><option value="replace">Bestaande posten vervangen</option><option value="append">Toevoegen aan de bestaande posten</option></select></div>` : `<div class="field"><label>Bestaande posten</label><div class="muted" style="padding:7px 0">Nog geen — alles wordt nieuw aangemaakt.</div></div>`}
      ${ov ? `<div class="field span2"><label class="chk"><input type="checkbox" name="budget21" value="1" checked> Onvoorziene kost (10 %) overnemen als post in lot 21</label></div>` : ""}
    </div>
    <div class="muted" style="font-size:12px;margin-top:10px">De eenheidsprijs in de Excel is de klantprijs: die komt binnen als prijs met marge 0 %, zodat de totalen exact gelijk blijven. Vul daarna per post de echte kost en marge in. Lege sjabloonregels worden overgeslagen.</div>
    ${parsed.warnings.length ? `<details style="margin-top:10px"><summary class="muted" style="cursor:pointer">${parsed.warnings.length} opmerking${parsed.warnings.length === 1 ? "" : "en"} bij het inlezen</summary><ul class="muted" style="font-size:12px;margin:6px 0 0 16px">${parsed.warnings.slice(0, 40).map(w => `<li>${esc(w)}</li>`).join("")}</ul></details>` : ""}`, {
    saveLabel: "Importeren", wide: true,
    onSave: async (d) => {
      const rows = window.MeetstaatImport.toRows(parsed, pid, { status: d.status, budget21: !!d.budget21, opmerking: `Import uit ${file.name} · ${fmtLong(todayIso)}` });
      const missing = [...new Set(rows.map(r => r.lot))].filter(l => !S.loten[l]);
      if (missing.length) { toast(`Lot ${missing.join(", ")} bestaat niet in het Planbord — voeg dat lot eerst toe onder Instellingen › Loten.`); return false; }
      loader.start("ms.import2", "Posten bewaren…", 4000);
      try {
        // eerst de nieuwe posten bewaren, pas daarna de oude weghalen: mislukt het bewaren, dan blijft de bestaande meetstaat staan
        const oude = existing && d.mode === "replace" ? msRows(pid).map(r => r.id) : []; S.bulk = true;
        // sinds script 012 staan kostprijs en marge in meetstaat_prijzen: msInsert splitst dat (klantprijs = prijs met marge 0 %)
        for (let i = 0; i < rows.length; i += 200) await msInsert(rows.slice(i, i + 200));
        for (let i = 0; i < oude.length; i += 200) { const { error } = await sb.from("meetstaat_posten").delete().in("id", oude.slice(i, i + 200)); if (error) throw error; }
        S.bulk = false; await refetch("meetstaat_posten"); loader.done("ms.import2");
        toast(`${rows.length} posten geïmporteerd uit ${file.name}`);
      } catch (e) { S.bulk = false; loader.fail(); toast("Import mislukt: " + e.message, 6000); await refetch("meetstaat_posten"); return false; }
    },
  });
}
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
const docIcon = (m, n) => /spreadsheet|excel/.test(m) ? "xls" : /word|document/.test(m) ? "doc" : /pdf/.test(m) ? "pdf" : /^image\//.test(m) || /\.(jpe?g|png|heic|gif|webp|tiff?)$/i.test(n) ? "img" : /skp|sketchup|vwx|dwg|dxf/i.test(n) ? "dwg" : "map";

/* ---------- render root ---------- */
const TABS = [["overzicht", "Overzicht"], ["projecten", "Projecten"], ["taken", "Taken"], ["planning", "Planning"], ["uren", "Uren"], ["contacten", "Contacten"], ["notities", "Notities"], ["voorstellen", "Voorstellen"], ["team", "Team"], ["rapporten", "Rapporten"], ["instellingen", "Instellingen", "beheer"]];
let renderPending = false;
function render() {
  // niet herbouwen terwijl iemand in een inline-veld typt (realtime-update van een collega zou de invoer wissen); zoekvelden regelen hun eigen focus
  const a = document.activeElement;
  if (a && a.classList && a.classList.contains("inline") && !a.hasAttribute("data-noteq") && !a.hasAttribute("data-werff") && !a.hasAttribute("data-filter") && !a.hasAttribute("data-cfilter") && !a.hasAttribute("data-projq") && $("#app").contains(a)) { renderPending = true; return; }
  renderPending = false; refreshToday(); buildIndex();
  const app = $("#app");
  if (!configured) { app.innerHTML = `<div class="login"><div class="card"><h1>BROS Planbord</h1><p>De app is nog niet gekoppeld aan de database. Vul <code>config.js</code> in (Project URL en anon public-sleutel uit Supabase) en herlaad.</p></div></div>`; return; }
  if (!S.session) { renderLogin(); return; }
  if (S.setPassword) { renderSetPassword(); return; }
  if (S.loadError) { app.innerHTML = `<div class="login"><div class="card"><h1>Kon de gegevens niet laden</h1><p class="err">${esc(S.loadError)}</p><button class="btn" data-act="logout">Uitloggen</button> <button class="btn primary" data-act="reload">Opnieuw proberen</button></div></div>`; return; }
  if (!S.ready) { app.innerHTML = `<div class="login"><div class="card"><h1>BROS Planbord</h1><p>Gegevens laden…</p></div></div>`; return; }
  if (!S.me) { app.innerHTML = `<div class="login"><div class="card"><h1>Nog geen profiel</h1><p>Je login werkt, maar er is nog geen medewerkersprofiel gekoppeld. Vraag de beheerder om je uit te nodigen, of herlaad de pagina.</p><button class="btn" data-act="logout">Uitloggen</button> <button class="btn primary" data-act="reload">Herladen</button></div></div>`; return; }
  const views = { overzicht: vOverzicht, projecten: vProjecten, taken: vTaken, planning: vPlanning, uren: vUren, contacten: vContacten, notities: vNotitiesAlle, voorstellen: vVoorstellen, team: vTeam, rapporten: vRapporten, instellingen: vInstellingen };
  app.innerHTML = `
  <header class="top">
    <div class="top-in">
      <div class="brand"><span class="mark">BROS</span><span class="name">Planbord</span></div>
      <nav class="tabs" aria-label="Hoofdnavigatie">${TABS.filter(([, , r]) => !r || isBeheer()).filter(([k]) => k !== "voorstellen" || schemaV() >= 23).map(([k, l]) => `<button data-nav="${k}" ${S.view === k ? 'aria-current="page"' : ""}>${l}${k === "voorstellen" && voorstellenOpen().length ? ` <span class="cnt" style="background:var(--crit);color:#fff">${voorstellenOpen().length}</span>` : ""}</button>`).join("")}</nav>
      <div class="who"><span class="who-cell">${avatar(S.me.id)}<span style="font-weight:600">${esc(S.me.name)}</span></span><button class="btn ghost sm" data-act="change-password" title="Wachtwoord wijzigen">Wachtwoord</button><button class="btn ghost sm" data-act="logout" title="Uitloggen">Uitloggen</button></div>
    </div>
    <div class="update" id="updateBar"><span>Er is een nieuwe versie van het Planbord.</span><button class="btn sm primary" data-act="reload">Nu herladen</button><button class="btn sm ghost" data-act="update-later">Later</button></div>
  </header>
  <main>${(views[S.view] || vOverzicht)()}</main>
  <footer>BROS Planbord v${APP_VERSION}</footer>`;
  if (updateAvailable) $("#updateBar").classList.add("show");
}
let loginMode = "password";
let loginNotice = URL_AUTH.error ? (/expired|invalid|otp/i.test(URL_AUTH.error) ? "Deze link is vervallen of al gebruikt. Log in met je wachtwoord, of vraag hieronder een nieuwe link aan." : "Inloggen via de link lukte niet: " + URL_AUTH.error.replace(/\+/g, " ")) : "";
function renderLogin() {
  const pw = loginMode === "password";
  $("#app").innerHTML = `<div class="login"><div class="card">
    <div class="brand" style="margin-bottom:14px"><span class="mark">BROS</span><span class="name">Planbord</span></div>
    <h1>Inloggen</h1><p>${pw ? "Log in met je e-mailadres en wachtwoord." : "Vul je e-mailadres in; je krijgt een link in je mailbox waarmee je meteen binnen bent."}</p>
    <form id="loginForm"><div class="field"><label for="email">E-mailadres</label><input id="email" type="email" required autocomplete="username" placeholder="naam@bros.be"></div>
    ${pw ? `<div class="field"><label for="password">Wachtwoord</label><input id="password" type="password" required autocomplete="current-password"></div>` : ""}
    <button class="btn primary" type="submit" id="loginBtn">${pw ? "Inloggen" : "Stuur mij een inloglink"}</button></form>
    <div class="msg${loginNotice ? " err" : ""}" id="loginMsg">${esc(loginNotice)}</div>
    <p style="margin:16px 0 0;font-size:13px;display:flex;gap:6px;flex-wrap:wrap"><button class="btn ghost sm" type="button" id="loginSwitch">${pw ? "Liever een inloglink per e-mail?" : "Liever met wachtwoord inloggen?"}</button>${pw ? `<button class="btn ghost sm" type="button" id="loginForgot">Wachtwoord vergeten?</button>` : ""}</p></div></div>`;
  $("#loginSwitch").onclick = () => { loginMode = pw ? "otp" : "password"; renderLogin(); };
  if (pw) $("#loginForgot").onclick = async () => {
    loginNotice = ""; const email = $("#email").value.trim(); const m = $("#loginMsg"); m.className = "msg"; m.textContent = "";
    if (!email) { m.className = "msg err"; m.textContent = "Vul eerst je e-mailadres in."; $("#email").focus(); return; }
    $("#loginForgot").disabled = true;
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) { m.className = "msg err"; m.textContent = "Dat lukte niet: " + error.message; $("#loginForgot").disabled = false; }
    else m.textContent = "Mail verstuurd naar " + email + " (kijk ook bij spam). Klik op de link en kies een nieuw wachtwoord.";
  };
  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault(); loginNotice = ""; const email = $("#email").value.trim(); const btn = $("#loginBtn"); btn.disabled = true; const m = $("#loginMsg"); m.className = "msg"; m.textContent = "";
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

/* ---------- wachtwoord kiezen (na uitnodiging/herstellink) of wijzigen ---------- */
function renderSetPassword() {
  const forced = S.passwordForced, email = S.session?.user?.email || "";
  $("#app").innerHTML = `<div class="login"><div class="card">
    <div class="brand" style="margin-bottom:14px"><span class="mark">BROS</span><span class="name">Planbord</span></div>
    <h1>${forced ? "Kies een wachtwoord" : "Wachtwoord wijzigen"}</h1>
    <p>${forced ? `Welkom${email ? ", " + esc(email) : ""}. Kies een wachtwoord waarmee je voortaan inlogt.` : `Kies een nieuw wachtwoord voor ${esc(email)}.`}</p>
    <form id="pwForm">
      <div class="field"><label for="pw1">Nieuw wachtwoord</label><input id="pw1" type="password" required minlength="8" autocomplete="new-password" placeholder="minstens 8 tekens"></div>
      <div class="field"><label for="pw2">Nog eens, ter controle</label><input id="pw2" type="password" required minlength="8" autocomplete="new-password"></div>
      <div class="actions" style="margin-top:4px"><button class="btn primary" type="submit" id="pwBtn">Opslaan</button>${forced ? "" : `<button class="btn ghost" type="button" id="pwCancel">Annuleren</button>`}</div>
    </form>
    <div class="msg" id="pwMsg"></div>
    ${forced ? `<p style="margin:16px 0 0;font-size:13px"><button class="btn ghost sm" type="button" data-act="logout">Toch niet — uitloggen</button></p>` : ""}
  </div></div>`;
  $("#pw1").focus();
  if (!forced) $("#pwCancel").onclick = () => { S.setPassword = false; render(); };
  $("#pwForm").onsubmit = async (e) => {
    e.preventDefault(); const m = $("#pwMsg"); m.className = "msg"; m.textContent = "";
    const a = $("#pw1").value, b = $("#pw2").value;
    if (a.length < 8) { m.className = "msg err"; m.textContent = "Kies minstens 8 tekens."; return; }
    if (a !== b) { m.className = "msg err"; m.textContent = "De twee wachtwoorden zijn niet gelijk."; return; }
    const btn = $("#pwBtn"); btn.disabled = true;
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) { m.className = "msg err"; m.textContent = "Dat lukte niet: " + error.message; btn.disabled = false; return; }
    history.replaceState(null, "", location.pathname);
    S.setPassword = false; S.passwordForced = false;
    if (S.ready) { render(); toast("Wachtwoord opgeslagen."); } else start();
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
    <td><div class="row-title">${esc(t.titel)}${klantTag(t)}<small>${esc(faseName(t.fase_nr))}</small></div></td>
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
  const tabs = [["taken", "Taken"], ["notities", "Notities" + (schemaV() >= 14 && notesOf(p.id).length ? ` <span class="cnt">${notesOf(p.id).length}</span>` : "")], ["meetstaat", "Meetstaat"], ["facturatie", "Facturatie"], ["werf", "Werf" + (schemaV() >= 16 && vsOf(p.id).some(v => v.status === "open") ? ` <span class="cnt">${vsOf(p.id).filter(v => v.status === "open").length}</span>` : "")], ["tekenen", "Plannen"], ["planning", "Planning"], ["uren", "Uren"], ["dossier", "Dossier"]].concat(schemaV() >= 23 ? [["vragen", "Vragen" + (voorstellenOpen().some(v => v.project_id === p.id) ? ` <span class="cnt" style="background:var(--crit);color:#fff">${voorstellenOpen().filter(v => v.project_id === p.id).length}</span>` : "")]] : []);
  let body = "";
  if (S.ptab === "taken") {
    const byFase = {}; ts.forEach(t => { (byFase[t.fase_nr || 0] = byFase[t.fase_nr || 0] || []).push(t); });
    const groups = Object.keys(byFase).map(Number).sort((a, b) => a - b);
    body = `<div class="panel"><div class="panel-head"><h3>Taken</h3><div class="actions"><button class="btn sm" data-act="add-fase" data-pid="${p.id}">+ Fase toevoegen</button><button class="btn sm primary" data-act="new-task" data-pid="${p.id}">+ Taak</button></div></div>
      ${ts.length ? `<div class="tw"><table class="t"><thead><tr><th></th><th>Taak</th><th>Wie</th><th>Start</th><th>Einde</th><th class="r">Uren</th><th>Status</th></tr></thead><tbody>
      ${groups.map(nr => { const g = byFase[nr]; const done = g.filter(t => t.status === "done").length; return `<tr><td colspan="7" style="background:var(--surface-2);font-weight:700;font-family:var(--font-display)">${esc(faseName(nr) || "Zonder fase")} <span class="muted num" style="font-weight:400">${done}/${g.length}</span></td></tr>` + g.map(t => `<tr class="click" data-edit-task="${t.id}"><td style="width:28px"><input type="checkbox" class="task-check" data-toggle="${t.id}" ${t.status === "done" ? "checked" : ""} aria-label="Klaar"></td>
        <td><div class="row-title">${esc(t.titel)}${klantTag(t)}${t.notitie_id && S.notities[t.notitie_id] ? ` <span class="pill kl" title="Actiepunt uit een verslag">📝 ${esc(S.notities[t.notitie_id].titel || "verslag")}</span>` : ""}${t.notitie ? `<small>${esc(t.notitie)}</small>` : ""}</div></td><td>${wieCell(t)}</td>
        <td class="num">${fmt(t.start)}</td><td class="num" style="color:${isLate(t) ? "var(--crit)" : "inherit"}">${fmt(t.eind)}</td><td class="r num">${nl(taskDone(t.id))} / ${nl(t.uren_gepland)}</td><td>${pill(t)}</td></tr>`).join(""); }).join("")}</tbody></table></div>` : `<div class="empty"><b>Nog geen taken</b>Voeg een fase toe (met de standaardtaken) of maak een losse taak.</div>`}</div>`;
  } else if (S.ptab === "notities") {
    body = vNotities(p);
  } else if (S.ptab === "meetstaat") {
    body = vMeetstaat(p);
  } else if (S.ptab === "facturatie") {
    body = vFacturatie(p);
  } else if (S.ptab === "werf") {
    body = vWerf(p);
  } else if (S.ptab === "tekenen") {
    body = typeof vTekenen === "function" ? vTekenen(p) : "";
  } else if (S.ptab === "vragen") {
    body = vVragenProject(p);
  } else if (S.ptab === "planning") {
    body = ganttHtml([p], { expanded: true, title: "Timing " + p.klant }) + vKlantTiming(p);
  } else if (S.ptab === "uren") {
    const byTask = ts.map(t => ({ t, d: taskDone(t.id) })).filter(x => x.d > 0 || x.t.uren_gepland > 0 || x.t.status === "done");
    const byUser = users().map(u => ({ u, d: hoursOf(h => h.project_id === p.id && h.user_id === u.id) })).filter(x => x.d > 0);
    const logs = Object.values(S.uren).filter(h => h.project_id === p.id).sort((a, b) => b.datum.localeCompare(a.datum) || String(b.tijd_van || "").localeCompare(String(a.tijd_van || ""))).slice(0, 30);
    const v10 = schemaV() >= 10;
    const klantRows = v10 ? Object.values(S.uren).filter(h => h.project_id === p.id && S.taken[h.taak_id]?.uren_klant).sort((a, b) => a.datum.localeCompare(b.datum) || String(a.tijd_van || "").localeCompare(String(b.tijd_van || ""))) : [];
    const klantTot = klantRows.reduce((s, h) => s + (Number(h.uren) || 0), 0);
    const klantPanel = v10 ? `<div class="panel"><div class="panel-head"><div><h3>Wat de klant ziet</h3><div class="muted" style="font-size:12px;margin-top:2px">Uren van taken met de schakelaar <b>Klant</b> aan · ${ts.filter(t => t.uren_klant).length} ${ts.filter(t => t.uren_klant).length === 1 ? "taak" : "taken"}</div></div><div class="actions">${klantRows.length ? `<button class="btn sm" data-act="uren-klant-print" data-pid="${p.id}">Afdrukken / pdf</button>` : ""}</div></div>
        ${klantRows.length ? `<div class="tw"><table class="t"><thead><tr><th>Datum</th><th>Tijd</th><th>Taak</th><th>Wie</th><th class="r">Uren</th></tr></thead><tbody>${klantRows.map(h => `<tr><td class="num">${fmt(h.datum)}</td><td class="num muted">${tijdSpan(h) || "—"}</td><td>${esc(S.taken[h.taak_id]?.titel || "")}${h.notitie ? `<small class="muted" style="display:block">${esc(h.notitie)}</small>` : ""}</td><td>${esc(userById(h.user_id).name)}</td><td class="r num">${nl(h.uren)} u</td></tr>`).join("")}<tr><td colspan="4"><b>Totaal</b></td><td class="r num"><b>${nl(klantTot)} u</b></td></tr></tbody></table></div>` : `<div class="empty">Nog niets zichtbaar voor de klant. Zet per taak de schakelaar <b>Klant</b> aan (hiernaast of in de taak zelf).</div>`}</div>` : "";
    const rend = isBeheer() ? (() => { const ki = projKost(p.id, "intern"), ke = projKost(p.id, "extern"), f = Number(p.forfait) || 0; return `<div class="rend">
        <div class="panel"><div class="k">Forfait</div><div class="v">${eur(p.forfait)}</div></div>
        <div class="panel"><div class="k">Interne kost</div><div class="v">${eur(ki)}</div></div>
        <div class="panel"><div class="k">Externe waarde uren</div><div class="v">${eur(ke)}</div></div>
        <div class="panel"><div class="k">Marge t.o.v. interne kost</div><div class="v ${f ? (f - ki >= 0 ? "pos" : "neg") : ""}">${f ? eur(f - ki) : "—"}</div></div></div>`; })() : "";
    body = rend + `<div class="grid two">
      <div class="panel"><div class="panel-head"><div><h3>Per taak</h3>${v10 ? `<div class="muted" style="font-size:12px;margin-top:2px">Schakelaar <b>Klant</b>: uren van die taak (met datum/tijd) zichtbaar voor de klant</div>` : ""}</div><button class="btn sm" data-act="log-hours" data-pid="${p.id}">+ Uren</button></div><div class="tw"><table class="t"><thead><tr><th>Taak</th><th class="r">Gepresteerd</th><th class="r">Gepland</th><th style="min-width:100px"></th>${v10 ? `<th class="c" title="Zichtbaar voor de klant">Klant</th>` : ""}<th></th></tr></thead><tbody>
        ${byTask.map(({ t, d }) => `<tr><td>${esc(t.titel)}${t.status === "done" ? ` <span class="pill done" style="margin-left:4px">Klaar</span>` : ""}<small class="muted" style="display:block">${esc(faseShort(t.fase_nr))}</small></td><td class="r num">${nl(d)} u</td><td class="r num">${nl(t.uren_gepland)} u</td><td><div class="bar"><i class="${d > t.uren_gepland && t.uren_gepland ? "over" : t.status === "done" ? "done" : ""}" style="width:${t.uren_gepland ? Math.min(d / t.uren_gepland, 1) * 100 : 0}%"></i></div></td>${v10 ? `<td class="c"><input type="checkbox" class="sw" data-ktoggle="${t.id}" ${t.uren_klant ? "checked" : ""} title="${t.uren_klant ? "Klant ziet de uren van deze taak" : "Verborgen voor de klant"}" aria-label="Zichtbaar voor klant"></td>` : ""}<td class="r"><button class="btn ghost sm" data-act="log-hours" data-pid="${p.id}" data-tid="${t.id}" title="Uren registreren op deze taak">+ Uren</button></td></tr>`).join("") || `<tr><td class="muted" colspan="6">Nog geen uren of geplande uren.</td></tr>`}
        <tr><td><b>Totaal</b></td><td class="r num"><b>${nl(dn)} u</b></td><td class="r num"><b>${nl(pl)} u</b></td><td colspan="${v10 ? 3 : 2}"></td></tr></tbody></table></div></div>
      <div style="display:grid;gap:16px;align-content:start">
        <div class="panel"><div class="panel-head"><h3>Per persoon</h3></div><div class="tw"><table class="t"><tbody>${byUser.map(({ u, d }) => `<tr><td><span class="who-cell">${avatar(u.id)}${esc(u.name)}</span></td><td class="r num">${nl(d)} u</td></tr>`).join("") || `<tr><td class="muted">Nog geen uren.</td></tr>`}</tbody></table></div></div>
        <div class="panel"><div class="panel-head"><h3>Laatste registraties</h3></div><div class="tw"><table class="t"><tbody>${logs.map(h => `<tr class="click" data-edit-hours="${h.id}"><td class="num">${fmt(h.datum)}${tijdSpan(h) ? `<small class="muted" style="display:block">${tijdSpan(h)}</small>` : ""}</td><td>${avatar(h.user_id)}</td><td>${esc(S.taken[h.taak_id]?.titel || "—")}${h.notitie ? `<small class="muted"> · ${esc(h.notitie)}</small>` : ""}</td><td class="r num">${nl(h.uren)} u</td></tr>`).join("") || `<tr><td class="muted">Nog geen registraties.</td></tr>`}</tbody></table></div></div>
      </div></div>` + (klantPanel ? `<div style="margin-top:16px">${klantPanel}</div>` : "");
  } else {
    driveAutoRefresh(p);
    const map = p.drive_map || ("PROJECTEN/" + (p.klant || ""));
    const docs = docsOf(p.id); const groups = [...new Set(docs.map(d => d.pad || ""))];
    body = vProjectContacten(p) + `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Projectmap op Google Drive</h3><div class="muted" style="font-size:12px;margin-top:2px"><span class="drive-path">${esc(map)}</span></div></div>
      <div class="actions">${p.drive_url ? `<a class="btn" href="${esc(p.drive_url)}" target="_blank" rel="noopener">Open map in Drive ↗</a><button class="btn sm" data-act="drive-list" data-pid="${p.id}">Vernieuwen</button>` : driveReady() ? `<button class="btn sm" data-act="drive-link" data-pid="${p.id}">Bestaande map koppelen</button><button class="btn sm primary" data-act="drive-create" data-pid="${p.id}">Map aanmaken uit sjabloon</button>` : `<span class="pill st-offerte">Drive-koppeling nog niet ingesteld</span>`}</div></div>
      ${docs.length ? `<div class="panel-body">${schemaV() >= 11 ? `<p class="muted" style="font-size:12px;margin:0 0 10px">Schakelaars bij een bestand: <b>klant</b> = zichtbaar in het klantenportaal${schemaV() >= 25 ? `, <b>aannemers</b> = zichtbaar voor de aannemers van dit project in hun portaal` : ""} (het bestand wordt dan leesbaar via de link). ${docs.filter(d => d.gedeeld).length} met de klant${schemaV() >= 25 ? `, ${docs.filter(d => d.gedeeld_aannemers).length} met aannemers` : ""} gedeeld.</p>` : ""}<div class="docs">${groups.map(g => `${g ? `<div style="grid-column:1/-1" class="eyebrow">${esc(g)}</div>` : ""}${docs.filter(d => (d.pad || "") === g).map(d => `<div class="doc-wrap ${d.gedeeld ? "shared" : ""}"><a class="doc" href="${esc(d.url)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit"><div class="ico ${docIcon(d.mime, d.naam)}">${docIcon(d.mime, d.naam) === "map" ? "DOC" : docIcon(d.mime, d.naam).toUpperCase()}</div><div style="min-width:0"><div class="n" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.naam)}</div><div class="s">${d.gewijzigd ? "gewijzigd " + fmtLong(d.gewijzigd.slice(0, 10)) : ""}${d.gedeeld ? ` · <span style="color:var(--ok)">klant</span>` : ""}${d.gedeeld_aannemers ? ` · <span style="color:var(--ok)">aannemers</span>` : ""}</div></div></a>${schemaV() >= 11 ? `<label class="sw-lbl" title="${d.gedeeld ? "Gedeeld met de klant" : "Delen met de klant"}"><input type="checkbox" class="sw" data-dshare="${d.id}" ${d.gedeeld ? "checked" : ""} aria-label="Delen met de klant"><small>klant</small></label>` : ""}${schemaV() >= 25 ? `<label class="sw-lbl" title="${d.gedeeld_aannemers ? "Gedeeld met de aannemers van dit project" : "Delen met de aannemers van dit project"}"><input type="checkbox" class="sw" data-dshare-a="${d.id}" ${d.gedeeld_aannemers ? "checked" : ""} aria-label="Delen met aannemers"><small>aannemers</small></label>` : ""}</div>`).join("")}`).join("")}</div>
        <p class="muted" style="font-size:12px;margin:12px 0 0">Laatst gesynchroniseerd ${docs[0].gesynct_op ? fmtLong(docs[0].gesynct_op.slice(0, 10)) + " " + docs[0].gesynct_op.slice(11, 16) : "—"}${S.driveAuto && S.driveAuto[p.id] && Date.now() - S.driveAuto[p.id] < 15000 ? " · wordt vernieuwd…" : ""}. Bij het openen van dit tabblad wordt de lijst automatisch vernieuwd als ze ouder is dan een uur; anders via "Vernieuwen"; foto's en video's worden niet opgesomd (die open je via de map).</p></div>` : `<div class="empty">${p.drive_url ? "Nog geen bestanden gevonden — klik op Vernieuwen." : "Nog geen map gekoppeld. \"Bestaande map koppelen\" zoekt in PROJECTEN naar een map met de naam uit het veld Drive-map (of de klantnaam)."}</div>`}</div>
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
      <td><div class="row-title">${esc(t.titel)}${klantTag(t)}<small>${esc(faseName(t.fase_nr))}</small></div></td><td>${esc(S.projecten[t.project_id]?.klant || "—")}</td><td>${t.contact_id && S.contacten[t.contact_id] ? contactAvatar(S.contacten[t.contact_id]) : t.assignee ? avatar(t.assignee) : "—"}</td>
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
  const entries = Object.values(S.uren).filter(h => h.user_id === u && h.datum >= ws && h.datum <= we).sort((a, b) => a.datum.localeCompare(b.datum) || String(a.tijd_van || "").localeCompare(String(b.tijd_van || "")));
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
      ${entries.length ? `<div class="tw"><table class="t"><thead><tr><th>Datum</th><th>Tijd</th><th>Project</th><th>Taak</th><th>Notitie</th><th class="r">Uren</th></tr></thead><tbody>
      ${entries.map(h => `<tr class="click" data-edit-hours="${h.id}"><td class="num">${DAYS[(pd(h.datum).getUTCDay() + 6) % 7]} ${fmt(h.datum)}</td><td class="num muted">${tijdSpan(h)}</td><td>${esc(S.projecten[h.project_id]?.klant || "—")}</td><td>${esc(S.taken[h.taak_id]?.titel || "—")}</td><td class="muted">${esc(h.notitie || "")}</td><td class="r num">${nl(h.uren)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><b>Geen uren deze week</b>Registreer uren met de knop rechtsboven.</div>`}</div>
    <div style="display:grid;gap:16px;align-content:start">
      <div class="panel"><div class="panel-head"><h3>Per project deze week</h3></div><div class="tw"><table class="t"><tbody>${perProj.map(x => `<tr><td>${esc(projName(x.p))}</td><td class="r num">${nl(x.d)} u</td></tr>`).join("") || `<tr><td class="muted">—</td></tr>`}</tbody></table></div></div>
      <div class="panel"><div class="panel-head"><h3>Team deze week</h3></div><div class="tw"><table class="t"><tbody>${allTot.map(x => `<tr><td><span class="who-cell">${avatar(x.u.id)}${esc(x.u.name)}</span></td><td class="r num">${nl(x.d)} u</td></tr>`).join("")}</tbody></table></div></div>
    </div></div>`;
}
function exportHours() {
  const rows = Object.values(S.uren).sort((a, b) => a.datum.localeCompare(b.datum));
  const head = ["Datum", "Week", "Van", "Tot", "Medewerker", "Projectnummer", "Klant", "Project", "Fase", "Taak", "Uren", "Zichtbaar klant", "Notitie"];
  const lines = [head.join(";")].concat(rows.map(h => { const p = S.projecten[h.project_id] || {}, t = S.taken[h.taak_id] || {}; return [fmtLong(h.datum), weekNr(h.datum), tijd(h.tijd_van), tijd(h.tijd_tot), userById(h.user_id).name, p.nummer || "", p.klant || "", p.naam || "", faseShort(t.fase_nr), t.titel || "", String(h.uren).replace(".", ","), t.uren_klant ? "ja" : "nee", (h.notitie || "").replace(/[;\r\n]/g, " ")].map(v => `"${String(v).replace(/"/g, '""')}"`).join(";"); }));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `bros-uren-${todayIso}.csv`; a.click(); URL.revokeObjectURL(a.href);
}
/* Klantversie van de gepresteerde uren: alleen taken met de schakelaar "Klant" aan, met datum en tijd. Opent als afdrukbare pagina. */
function printKlantUren(p) {
  const rows = Object.values(S.uren).filter(h => h.project_id === p.id && S.taken[h.taak_id]?.uren_klant).sort((a, b) => a.datum.localeCompare(b.datum) || String(a.tijd_van || "").localeCompare(String(b.tijd_van || "")));
  if (!rows.length) return toast("Geen uren zichtbaar voor de klant.");
  const tot = rows.reduce((s, h) => s + (Number(h.uren) || 0), 0);
  const perTaak = {}; rows.forEach(h => { const k = S.taken[h.taak_id]?.titel || "—"; perTaak[k] = (perTaak[k] || 0) + (Number(h.uren) || 0); });
  const html = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Gepresteerde uren · ${esc(p.klant)}</title>
  <style>body{font:13px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111;margin:40px;max-width:820px}h1{font-size:20px;margin:0 0 2px}h2{font-size:13px;font-weight:600;margin:24px 0 8px;text-transform:uppercase;letter-spacing:.06em;color:#666}.sub{color:#666;margin-bottom:24px}table{width:100%;border-collapse:collapse}th,td{padding:7px 8px;border-bottom:1px solid #e5e5e5;text-align:left;vertical-align:top}th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#666}td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}tr.tot td{border-top:2px solid #111;font-weight:700}small{color:#666;display:block}.foot{margin-top:32px;color:#888;font-size:11px}@media print{body{margin:16mm}}</style></head><body>
  <h1>Gepresteerde uren</h1><div class="sub">${esc(projName(p))}${p.adres ? ` · ${esc(p.adres)}, ${esc(p.postcode || "")} ${esc(p.gemeente || "")}` : ""} · stand ${fmtLong(todayIso)}</div>
  <h2>Detail</h2><table><thead><tr><th>Datum</th><th>Tijd</th><th>Taak</th><th>Uitgevoerd door</th><th class="r">Uren</th></tr></thead><tbody>
  ${rows.map(h => `<tr><td>${fmtLong(h.datum)}</td><td>${tijdSpan(h) || "—"}</td><td>${esc(S.taken[h.taak_id]?.titel || "")}${h.notitie ? `<small>${esc(h.notitie)}</small>` : ""}</td><td>${esc(userById(h.user_id).name)}</td><td class="r">${nl(h.uren)}</td></tr>`).join("")}
  <tr class="tot"><td colspan="4">Totaal</td><td class="r">${nl(tot)} u</td></tr></tbody></table>
  <h2>Per taak</h2><table><tbody>${Object.entries(perTaak).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${nl(v)} u</td></tr>`).join("")}</tbody></table>
  <div class="foot">BROS · overzicht van gepresteerde uren, gegenereerd uit het BROS Planbord.</div>
  <script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`;
  const w = window.open("", "_blank"); if (!w) return toast("Pop-up geblokkeerd — sta pop-ups toe voor het Planbord."); w.document.write(html); w.document.close();
}

/* ---------- Team ---------- */
function vTeam() {
  const wk = Array.from({ length: 4 }, (_, i) => addDays(mondayOf(todayIso), i * 7));
  const load = (uid, ws) => { const we = addDays(ws, 6); return Object.values(S.taken).filter(t => t.assignee === uid && t.status !== "done" && t.start && t.eind && t.eind >= ws && t.start <= we).reduce((s, t) => { const a = t.start > ws ? t.start : ws, b = t.eind < we ? t.eind : we; return s + (Number(t.uren_gepland) || 0) * workdays(a, b) / workdays(t.start, t.eind); }, 0); };
  const all = Object.values(S.profiles).filter(u => !EXTERN.includes(u.role)).sort((a, b) => (a.active === false) - (b.active === false) || a.name.localeCompare(b.name));
  return `
  <div class="page-head"><div><div class="eyebrow">${users().length} medewerkers</div><h1>Team</h1></div>${isBeheer() ? `<div class="actions"><span class="muted" style="font-size:13px">Nieuwe medewerkers nodig je uit via Supabase (Authentication → Users → Invite user). Ze krijgen een mail, kiezen bij de eerste keer een wachtwoord en verschijnen daarna hier.</span></div>` : ""}</div>
  <div class="panel tw"><table class="t"><thead><tr><th>Naam</th><th>Rol</th><th class="r">Open taken</th><th class="r">Uren dit jaar</th>${wk.map(w => `<th class="r">wk ${weekNr(w)}</th>`).join("")}${isBeheer() ? `<th class="r">Tarief int / ext</th>` : ""}<th></th></tr></thead><tbody>
  ${all.map(u => `<tr style="${u.active === false ? "opacity:.5" : ""}"><td><span class="who-cell">${avatar(u.id)}<b>${esc(u.name)}</b>${u.id === S.me.id ? `<span class="muted" style="font-size:12px">(ik)</span>` : ""}</span><small class="muted" style="display:block">${esc(u.email || "")}${u.functie ? " · " + esc(u.functie) : ""}</small></td><td class="muted">${u.role === "beheer" ? "Beheer" : "Medewerker"}${u.active === false ? " · inactief" : ""}</td>
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
  ${vPortaalBeheer()}
  ${vAssistentBeheer()}
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
/* Klantenportaal: teksten en overzicht van wie toegang heeft */
const portaalCfg = () => (S.instellingen.portaal && S.instellingen.portaal.value) || {};
function vPortaalBeheer() {
  if (schemaV() < 11) return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h3>Klantenportaal</h3><span class="pill st-offerte">nog niet geactiveerd</span></div><div class="panel-body">${SCHEMA_HINT(11)}<p class="muted" style="font-size:12px;margin:0">Daarna: in het Drive-script de <code>PORTAAL.SERVICE_KEY</code> invullen en opnieuw deployen, en in Supabase de portaal-URL toevoegen bij Redirect URLs (zie README).</p></div></div>`;
  const c = portaalCfg(); const url = c.url || (location.origin + location.pathname.replace(/[^/]*$/, "") + "klant/");
  const metLogin = Object.values(S.contacten).filter(x => x.user_id).sort((a, b) => a.naam.localeCompare(b.naam));
  const rolVan = (k) => S.profiles[k.user_id]?.role || (k.soort === "klant" ? "klant" : "aannemer");
  const klanten = metLogin.filter(k => rolVan(k) !== "aannemer"), aannemers = metLogin.filter(k => rolVan(k) === "aannemer"); const urlA = c.url_aannemer || url.replace(/klant\/?$/, "aannemer/");
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Klantenportaal en aannemersportaal</h3><div class="muted" style="font-size:12px;margin-top:2px">Klanten loggen in op <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>${schemaV() >= 25 ? `, aannemers op <a href="${esc(urlA)}" target="_blank" rel="noopener">${esc(urlA)}</a>` : ""}. Toegang geef je per project: Dossier → Contacten → knop in de kolom Portaal.</div></div><span class="pill st-afgerond">${klanten.length} klant${klanten.length === 1 ? "" : "en"}${schemaV() >= 25 ? ` · ${aannemers.length} aannemer${aannemers.length === 1 ? "" : "s"}` : ""} met toegang</span></div>
    <div class="panel-body"><div class="form-grid">
      <div class="field span2"><label for="po_welkom">Welkomtekst (bovenaan de startpagina)</label><textarea id="po_welkom" rows="2">${esc(c.welkom || "")}</textarea></div>
      <div class="field span2"><label for="po_werk">Inleiding bij "Zo werkt het bij BROS" (de fasen uit Instellingen staan eronder)</label><textarea id="po_werk" rows="2">${esc(c.werkwijze || "")}</textarea></div>
      <div class="field span2"><label for="po_contact">Contactblok ("Vragen?")</label><textarea id="po_contact" rows="2">${esc(c.contact || "")}</textarea></div>
      <div class="field span2"><div class="actions"><button class="btn primary" data-act="portaal-save">Bewaren</button><span class="muted" style="font-size:12px">Teamfoto's, functie en biografie voor "Wie is wie": Team → Bewerken.</span></div></div>
    </div>${metLogin.length ? `<div class="tw" style="margin-top:12px"><table class="t"><thead><tr><th>Wie</th><th>Portaal</th><th>E-mail</th><th>Projecten</th><th>Uitgenodigd</th><th>Laatste bezoek</th></tr></thead><tbody>${metLogin.map(k => { const aan = rolVan(k) === "aannemer"; return `<tr class="click" data-contact="${k.id}"><td>${esc(k.naam)}</td><td><span class="pill ${aan ? "st-on_hold" : "st-lopend"}">${aan ? "aannemer" : "klant"}</span></td><td class="muted" style="font-size:12px">${esc(k.email)}</td><td class="muted" style="font-size:12px">${projectsOfContact(k.id).filter(x => aan ? !KLANT_ROLLEN.includes(x.rol) : KLANT_ROLLEN.includes(x.rol)).map(x => esc(x.p.klant)).join(", ") || "—"}</td><td class="num">${k.portaal_sinds ? fmtLong(k.portaal_sinds.slice(0, 10)) : "—"}</td><td class="num">${k.portaal_login ? fmtLong(k.portaal_login.slice(0, 10)) : "nog niet"}</td></tr>`; }).join("")}</tbody></table></div>` : ""}</div></div>`;
}
async function portaalSaveSettings() {
  const value = { ...portaalCfg(), welkom: $("#po_welkom").value.trim(), werkwijze: $("#po_werk").value.trim(), contact: $("#po_contact").value.trim() };
  const { data, error } = await sb.from("instellingen").upsert({ key: "portaal", value, updated_at: new Date().toISOString() }).select().single();
  if (error) { toast("Bewaren mislukt: " + error.message); return; } S.instellingen.portaal = data; render(); toast("Portaalteksten bewaard");
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
      const projs = Object.values(S.projecten).filter(p => p.fase_nr === f.nr), tasks = Object.values(S.taken).filter(t => t.fase_nr === f.nr);
      if (projs.length || tasks.length) { setTimeout(() => faseMoveForm(f, projs, tasks), 50); return; }   // eerst verhuizen, dan verwijderen
      await faseDelete(f);
    },
  });
}
async function faseDelete(f) {
  const { error } = await sb.from("fasen").delete().eq("nr", f.nr);
  if (error) { toast(/foreign key|violates/i.test(error.message) ? "Deze fase wordt nog gebruikt — verhuis eerst de projecten en taken." : "Mislukt: " + error.message); throw error; }
  delete S.fasen[f.nr]; S.standaardtaken = S.standaardtaken.filter(t => t.fase_nr !== f.nr); if (S.selFase === f.nr) S.selFase = null; render(); toast("Fase verwijderd");
}
/* fase in gebruik: projecten en taken naar een andere fase verplaatsen en daarna de fase verwijderen */
function faseMoveForm(f, projs, tasks) {
  const andere = Object.values(S.fasen).filter(x => x.nr !== f.nr).sort((a, b) => a.nr - b.nr);
  if (!andere.length) return toast("Er is geen andere fase om naar te verhuizen.");
  const std = S.standaardtaken.filter(t => t.fase_nr === f.nr).length;
  openModal(`Fase ${f.nr} · ${f.naam} verwijderen`, `<div class="form-grid">
    <div class="field span2"><p style="margin:0">Deze fase wordt nog gebruikt door <b>${projs.length} project${projs.length === 1 ? "" : "en"}</b> en <b>${tasks.length} ta${tasks.length === 1 ? "ak" : "ken"}</b>${std ? ` (en heeft ${std} standaardta${std === 1 ? "ak" : "ken"}, die mee verdwijnen)` : ""}. Kies naar welke fase die verhuizen; daarna wordt fase ${f.nr} verwijderd.</p>
      ${projs.length ? `<p class="muted" style="font-size:12px;margin:8px 0 0">Projecten: ${projs.slice(0, 8).map(p => esc(p.klant)).join(", ")}${projs.length > 8 ? ", …" : ""}</p>` : ""}</div>
    <div class="field span2"><label for="fm_naar">Verhuizen naar</label><select id="fm_naar" name="naar">${opts(andere.map(x => [x.nr, `${x.nr} · ${x.naam}`]), andere.find(x => x.nr > f.nr)?.nr ?? andere[andere.length - 1].nr)}</select></div>
    <div class="field span2"><p class="muted" style="font-size:12px;margin:0">Liever niets verhuizen? Annuleer en zet de fase via Bewerken op "Zichtbaar bij nieuwe projecten: Nee"; ze blijft dan bestaan maar verdwijnt uit de keuzelijsten.</p></div>
  </div>`, {
    saveLabel: "Verhuizen en verwijderen", onSave: async (d) => {
      const naar = Number(d.naar); if (!S.fasen[naar]) { toast("Kies een fase."); return false; }
      if (projs.length) { const { error } = await sb.from("projecten").update({ fase_nr: naar }).eq("fase_nr", f.nr); if (error) { toast("Projecten niet verplaatst: " + error.message); return false; } projs.forEach(p => { if (S.projecten[p.id]) S.projecten[p.id].fase_nr = naar; }); }
      if (tasks.length) { const { error } = await sb.from("taken").update({ fase_nr: naar }).eq("fase_nr", f.nr); if (error) { toast("Taken niet verplaatst: " + error.message); return false; } tasks.forEach(t => { if (S.taken[t.id]) S.taken[t.id].fase_nr = naar; }); }
      try { await faseDelete(f); } catch (e) { return false; }
      toast(`Fase ${f.nr} verwijderd · ${projs.length} project${projs.length === 1 ? "" : "en"} en ${tasks.length} ta${tasks.length === 1 ? "ak" : "ken"} verhuisd naar fase ${naar}`);
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

/* ---------- Timing voor de klant (script 017): handmatige van–tot per fase + taken met gedeelde timing ---------- */
const ktOf = (pid, nr) => S.klant_timing[pid + "|" + nr] || null;
const ktTaskSpan = (pid, nr) => { const ts = tasksOf(pid).filter(t => (t.fase_nr || 0) === nr); return [ts.map(t => t.start).filter(Boolean).sort()[0] || null, ts.map(t => t.eind).filter(Boolean).sort().pop() || null]; };
async function ktSave(pid, nr, patch) {
  const cur = ktOf(pid, nr) || { project_id: pid, fase_nr: nr, start: null, eind: null, opmerking: "" };
  const row = { ...cur, ...patch }; delete row.updated_at;
  if (row.start && row.eind && row.eind < row.start) row.eind = row.start;
  const { data, error } = await sb.from("klant_timing").upsert(row, { onConflict: "project_id,fase_nr" }).select().single();
  if (error) { toast("Bewaren mislukt: " + error.message); return; }
  S.klant_timing[rowKey("klant_timing", data)] = data; render();
}
async function ktClear(pid, nr) {
  const { error } = await sb.from("klant_timing").delete().eq("project_id", pid).eq("fase_nr", nr);
  if (error) { toast("Wissen mislukt: " + error.message); return; }
  delete S.klant_timing[pid + "|" + nr]; render();
}
function vKlantTiming(p) {
  if (schemaV() < 17) return `<div class="panel" style="margin-top:16px"><div class="panel-head"><h3>Timing voor de klant</h3></div>${SCHEMA_HINT(17)}</div>`;
  const fs = fasenList(); const ts = tasksOf(p.id); const shared = ts.filter(t => t.timing_klant);
  const rows = fs.map(f => { const kt = ktOf(p.id, f.nr); const [ts0, ts1] = ktTaskSpan(p.id, f.nr); const n = ts.filter(t => (t.fase_nr || 0) === f.nr).length; const vast = !!(kt && (kt.start || kt.eind));
    const toon = vast ? `${fmt(kt.start || ts0)} → ${fmt(kt.eind || ts1)}` : ts0 ? `${fmt(ts0)} → ${fmt(ts1)}` : "—";
    return `<tr class="${vast ? "" : "kt-auto"}"><td><b>${f.nr}. ${esc(f.naam)}</b>${p.fase_nr === f.nr ? ` <span class="pill busy">nu</span>` : ""}<small class="muted" style="display:block">${n ? `${n} ${n === 1 ? "taak" : "taken"}${ts0 ? ` · ${fmt(ts0)} → ${fmt(ts1)}` : ""}` : "geen taken"}</small></td>
      <td style="width:210px;white-space:nowrap">${vast ? `<span class="pill kl" style="background:var(--warn-soft);color:var(--warn)">vast</span>` : ts0 ? `<span class="pill kl">automatisch</span>` : `<span class="muted">—</span>`} <span class="num">${toon}</span></td>
      <td style="width:150px"><input class="inline" type="date" data-kt="${f.nr}" data-pid="${p.id}" data-f="start" value="${esc(kt?.start || "")}" title="Leeg = volgt de taken"></td>
      <td style="width:150px"><input class="inline" type="date" data-kt="${f.nr}" data-pid="${p.id}" data-f="eind" value="${esc(kt?.eind || "")}" title="Leeg = volgt de taken"></td>
      <td><input class="inline wide" data-kt="${f.nr}" data-pid="${p.id}" data-f="opmerking" value="${esc(kt?.opmerking || "")}" placeholder="toelichting voor de klant (optioneel)"></td>
      <td class="r" style="white-space:nowrap">${!vast && ts0 ? `<button class="btn ghost sm" data-act="kt-fill" data-pid="${p.id}" data-nr="${f.nr}" title="De huidige taaktiming vastzetten: verschuift daarna niet meer mee met de taken">Vastzetten</button>` : ""}${kt ? `<button class="btn ghost sm danger" data-act="kt-clear" data-pid="${p.id}" data-nr="${f.nr}" title="Vaste timing en toelichting wissen → volgt weer de taken">✕</button>` : ""}</td></tr>`; }).join("");
  const nVast = fs.filter(f => { const kt = ktOf(p.id, f.nr); return kt && (kt.start || kt.eind); }).length;
  return `<div class="panel" style="margin-top:16px"><div class="panel-head"><div><h3>Timing voor de klant</h3><div class="muted" style="font-size:12px;margin-top:2px">Wat de klant onder Planning ziet. Elke fase volgt automatisch haar taken (vroegste start → laatste einde); vul Van/Tot in om een fase <b>vast te zetten</b> — die schuift dan niet meer mee. ${nVast ? `${nVast} ${nVast === 1 ? "fase" : "fasen"} vast.` : "Niets vastgezet."}</div></div></div>
    <div class="tw"><table class="t"><thead><tr><th>Fase</th><th>Klant ziet</th><th>Van (vast)</th><th>Tot (vast)</th><th>Toelichting</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="panel-head" style="border-top:1px solid var(--line)"><div><h3 style="font-size:14px">Taken met gedeelde timing</h3><div class="muted" style="font-size:12px;margin-top:2px">Vink per taak aan: titel en van–tot verschijnen onder de fase in de klantplanning (geen uren, geen wie). ${shared.length} gedeeld.</div></div></div>
    ${ts.length ? `<div class="tw"><table class="t"><tbody>${ts.map(t => `<tr><td style="width:28px"><input type="checkbox" data-ttoggle="${t.id}" ${t.timing_klant ? "checked" : ""} aria-label="Timing delen met de klant"></td><td><span class="row-title">${esc(t.titel)}</span><small class="muted" style="display:block">${esc(faseShort(t.fase_nr) || "zonder fase")}</small></td><td class="num">${fmt(t.start)} → ${fmt(t.eind)}</td><td>${pill(t)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">Nog geen taken op dit project.</div>`}</div>`;
}
/* ---------- modals ---------- */
function openModal(title, bodyHtml, { onSave, onDelete, saveLabel = "Bewaren", wide } = {}) {
  $("#modal").innerHTML = `<div class="mh"><h2>${esc(title)}</h2><button class="btn ghost sm" data-close type="button">✕</button></div><form id="mform"><div class="mb">${bodyHtml}</div>
    <div class="mf"><div>${onDelete ? `<button type="button" class="btn ghost danger" data-mdelete>Verwijderen</button>` : ""}</div><div style="display:flex;gap:8px"><button type="button" class="btn" data-close>Annuleren</button><button type="submit" class="btn primary">${saveLabel}</button></div></div></form>`;
  $("#modal").style.width = wide ? "min(820px, 100%)" : "";
  $("#modalBg").classList.add("show");
  const form = $("#mform");
  form.onsubmit = async (e) => { e.preventDefault(); const btn = form.querySelector('button[type=submit]'); btn.disabled = true; try { const d = Object.fromEntries(new FormData(form).entries()); d._fasen = [...form.querySelectorAll('input[name="fase"]:checked')].map(i => Number(i.value)); const ok = await onSave(d); if (ok !== false) closeModal(); } catch (err) { console.error(err); if (!(err && err.__toasted)) toast("Bewaren mislukt: " + ((err && err.message) || err), 6000); } btn.disabled = false; };
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
  const klanten = Object.values(S.contacten).filter(c => c.soort === "klant" && c.actief !== false).sort((a, b) => a.naam.localeCompare(b.naam));
  openModal(isNew ? "Nieuw project" : "Project bewerken", `<div class="form-grid">
    ${isNew && klanten.length ? `<div class="field span2"><label for="f_cid">Bouwheer (contact)</label><select id="f_cid" name="contact_id"><option value="">— nieuw contact aanmaken uit de klantgegevens hieronder —</option>${opts(klanten.map(c => [c.id, contactLabel(c) + (c.gemeente ? " · " + c.gemeente : "")]), "")}</select><span class="muted" style="font-size:12px">Kies een bestaand contact om de gegevens over te nemen; het project wordt eraan gekoppeld. Aannemers en leveranciers koppel je daarna op de projectfiche (Dossier).</span></div>` : ""}
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
    ${schemaV() >= 23 ? `<div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" name="assistent" ${p.assistent !== false ? "checked" : ""}><span><b>AI-assistent in het klantenportaal</b><small class="muted" style="display:block">Uit bij een moeilijk dossier of geschil: het tabblad Vragen verdwijnt dan voor deze klant.</small></span></label></div>` : ""}
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
      const row = { klant: d.klant.trim(), naam: d.naam.trim(), klanttype: d.klanttype || "particulier", bedrijf: (d.bedrijf || "").trim(), btw_nummer: (d.btw_nummer || "").trim(), projecttype: d.projecttype || "", bron: d.bron || "", oppervlakte_m2: d.oppervlakte_m2 === "" ? null : Number(d.oppervlakte_m2), btw_tarief: d.btw_tarief === "" ? null : Number(d.btw_tarief), offerte_datum: d.offerte_datum || null, contract_datum: d.contract_datum || null, opgeleverd_op: d.opgeleverd_op || null, verloren_reden: d.status === "verloren" ? d.verloren_reden.trim() : "", tags: d.tags.trim(), contact: d.contact.trim(), adres: d.adres.trim(), postcode: d.postcode.trim(), gemeente: d.gemeente.trim(), gsm1: telFmt(d.gsm1), gsm2: telFmt(d.gsm2), email1: d.email1.trim(), email2: d.email2.trim(), factuur_email1: d.factuur_email1 === "on", factuur_email2: d.factuur_email2 === "on", lead: d.lead || null, status: d.status, fase_nr: d.fase_nr ? Number(d.fase_nr) : null, start: d.start || null, eind: d.eind || null, forfait: d.forfait === "" ? null : Number(d.forfait), drive_map: d.drive_map.trim() || ("PROJECTEN/" + d.klant.trim()), notities: d.notities };
      // Klantnaam gewijzigd terwijl er nog geen Drive-map gekoppeld is en de mapnaam niet zelf aangepast werd → mapnaam volgt de klantnaam
      if (!isNew && !p.drive_folder_id && row.klant !== (p.klant || "") && row.drive_map === (p.drive_map || "")) row.drive_map = "PROJECTEN/" + row.klant;
      if (schemaV() >= 23) row.assistent = d.assistent === "on";
      if (d.nummer && d.nummer.trim()) row.nummer = d.nummer.trim(); else if (!isNew) row.nummer = p.nummer || null;
      if (isNew) {
        row.created_by = S.me.id;
        const created = await dbInsert("projecten", row);
        const tasks = S.standaardtaken.filter(t => d._fasen.includes(t.fase_nr)).map(t => ({ project_id: created.id, titel: t.titel, fase_nr: t.fase_nr, assignee: row.lead, volgorde: t.fase_nr * 100 + t.volgorde, status: "todo", uren_gepland: 0 }));
        if (tasks.length) { const { data, error } = await sb.from("taken").insert(tasks).select(); if (error) toast("Standaardtaken niet aangemaakt: " + error.message); else (data || []).forEach(t => S.taken[t.id] = t); }
        // bouwheer koppelen: bestaand contact of nieuw contact uit de klantgegevens
        try { if (Object.keys(S.contacten).length || Object.keys(S.project_contacten).length || d.contact_id) {
          let cid = d.contact_id || null;
          if (!cid) { const c = await dbInsert("contacten", { soort: "klant", naam: row.klant, bedrijf: row.bedrijf, contactpersoon: row.contact, klanttype: row.klanttype, btw_nummer: row.btw_nummer, email: row.email1, email2: row.email2, gsm: row.gsm1, tel: row.gsm2, adres: row.adres, postcode: row.postcode, gemeente: row.gemeente }); cid = c.id; }
          await dbInsert("project_contacten", { project_id: created.id, contact_id: cid, rol: "bouwheer", intern: false }); } } catch (e) { }
        toast(`Project aangemaakt met ${tasks.length} standaardtaken`);
        S.view = "projecten"; S.project = created.id; S.ptab = "taken"; render();
        if (driveReady()) { try { await driveSync(S.projecten[created.id], "create"); } catch (e) { toast("Drive-map niet aangemaakt: " + e.message); } }
      } else { await dbUpdate("projecten", p.id, row); toast("Project bewaard"); }
    },
    onDelete: isNew ? null : async () => { await dbDelete("projecten", p.id); Object.values(S.taken).filter(t => t.project_id === p.id).forEach(t => delete S.taken[t.id]); Object.values(S.uren).filter(h => h.project_id === p.id).forEach(h => delete S.uren[h.id]); S.project = null; render(); toast("Project verwijderd"); },
  });
  wirePostcode();
  const cidSel = $("#f_cid"); if (cidSel) cidSel.addEventListener("change", () => { const c = S.contacten[cidSel.value]; if (!c) return; const f = $("#mform"); const set = (n, v) => { const el = f.querySelector(`[name="${n}"]`); if (el) el.value = v || ""; };
    set("klant", c.naam); set("bedrijf", c.bedrijf); set("btw_nummer", c.btw_nummer); set("contact", c.contactpersoon); set("adres", c.adres); set("postcode", c.postcode); set("gemeente", c.gemeente); set("gsm1", c.gsm); set("gsm2", c.tel); set("email1", c.email); set("email2", c.email2);
    const kt = f.querySelector(`input[name="klanttype"][value="${c.klanttype || "particulier"}"]`); if (kt) kt.checked = true; f.dispatchEvent(new Event("change")); });
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
    <div class="field"><label for="t_who">Toegewezen aan</label><select id="t_who" name="assignee">${schemaV() >= 15 ? wieOpts(projectId, t) : userOpts(t.assignee ?? S.me.id, true)}</select></div>
    <div class="field"><label for="t_status">Status</label><select id="t_status" name="status">${opts(Object.entries(TASK_STATUS), t.status || "todo")}</select></div>
    <div class="field"><label for="t_start">Start</label><input id="t_start" type="date" name="start" value="${esc(t.start || "")}"></div>
    <div class="field"><label for="t_eind">Einde</label><input id="t_eind" type="date" name="eind" value="${esc(t.eind || "")}"></div>
    <div class="field"><label for="t_uren">Geplande uren</label><input id="t_uren" type="number" step="0.5" min="0" name="uren_gepland" value="${esc(t.uren_gepland ?? 0)}"></div>
    ${schemaV() >= 14 ? `<div class="field"><label for="t_note">Uit verslag</label><select id="t_note" name="notitie_id"><option value="">— geen —</option>${opts(notesOf(projectId).map(n => [n.id, `${fmt(n.datum)} · ${n.titel || NOTE_SOORT[n.soort]}`]), t.notitie_id || "")}</select></div>` : ""}
    <div class="field"><label for="t_not">Notitie</label><input id="t_not" name="notitie" value="${esc(t.notitie || "")}"></div>
    ${schemaV() >= 10 ? `<div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" name="uren_klant" value="1" ${t.uren_klant ? "checked" : ""}><span><b>Gepresteerde uren zichtbaar voor de klant</b><small class="muted" style="display:block">De klant ziet de geregistreerde uren van deze taak, met datum en tijdstip. Staat standaard uit.</small></span></label></div>` : ""}
    ${schemaV() >= 17 ? `<div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" name="timing_klant" value="1" ${t.timing_klant ? "checked" : ""}><span><b>Timing delen met de klant</b><small class="muted" style="display:block">Titel en van–tot van deze taak verschijnen onder de fase in de planning van het portaal (geen uren, geen wie). Staat standaard uit.</small></span></label></div>` : ""}
  </div>`, {
    onSave: async (d) => {
      const row = { titel: d.titel.trim(), project_id: d.project_id, fase_nr: d.fase_nr ? Number(d.fase_nr) : null, ...(schemaV() >= 15 ? wieSplit(d.assignee) : { assignee: d.assignee || null }), status: d.status, start: d.start || null, eind: d.eind || null, uren_gepland: Number(d.uren_gepland) || 0, notitie: d.notitie , ...(schemaV() >= 14 && "notitie_id" in d ? { notitie_id: d.notitie_id || null } : {}) };
      if (schemaV() >= 10) row.uren_klant = !!d.uren_klant;
      if (schemaV() >= 17) row.timing_klant = !!d.timing_klant;
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
  // Ook afgewerkte taken zijn kiesbaar (bv. uren achteraf inboeken); ze staan onderaan met een vinkje.
  const taskOptsFor = (p, sel) => { const ts = tasksOf(p); const open = ts.filter(t => t.status !== "done"), done = ts.filter(t => t.status === "done"); const lbl = t => (t.fase_nr ? t.fase_nr + " · " : "") + t.titel; return `<option value="">— algemeen (geen taak) —</option>` + opts(open.map(t => [t.id, lbl(t)]), sel) + (done.length ? `<optgroup label="Afgewerkte taken">${opts(done.map(t => [t.id, "✓ " + lbl(t)]), sel)}</optgroup>` : ""); };
  openModal(isNew ? "Uren registreren" : "Registratie bewerken", `<div class="form-grid">
    <div class="field"><label for="h_who">Wie</label><select id="h_who" name="user_id" ${isBeheer() ? "" : "disabled"}>${userOpts(h.user_id || S.me.id)}</select></div>
    <div class="field"><label for="h_datum">Datum</label><input id="h_datum" type="date" name="datum" required value="${esc(h.datum || todayIso)}"></div>
    <div class="field"><label for="h_proj">Project</label><select id="h_proj" name="project_id">${projOpts(projectId)}</select></div>
    <div class="field"><label for="h_task">Taak</label><select id="h_task" name="taak_id">${taskOptsFor(projectId, h.taak_id)}</select></div>
    ${schemaV() >= 10 ? `<div class="field"><label for="h_van">Van <span class="muted">(optioneel)</span></label><input id="h_van" type="time" name="tijd_van" step="900" value="${esc(tijd(h.tijd_van))}"></div>
    <div class="field"><label for="h_tot">Tot</label><input id="h_tot" type="time" name="tijd_tot" step="900" value="${esc(tijd(h.tijd_tot))}"></div>` : ""}
    <div class="field"><label for="h_uren">Uren</label><input id="h_uren" type="number" step="0.25" min="0.25" name="uren" required value="${esc(h.uren ?? 1)}">${schemaV() >= 10 ? `<small class="muted" id="h_hint">Vul van/tot in en de uren worden berekend.</small>` : ""}</div>
    <div class="field"><label for="h_not">Notitie</label><input id="h_not" name="notitie" value="${esc(h.notitie || "")}" placeholder="wat heb je gedaan?"></div>
  </div>`, {
    onSave: async (d) => {
      const row = { user_id: isBeheer() ? d.user_id : (h.user_id || S.me.id), datum: d.datum, project_id: d.project_id, taak_id: d.taak_id || null, uren: Number(d.uren) || 0, notitie: d.notitie };
      if (schemaV() >= 10) { row.tijd_van = d.tijd_van || null; row.tijd_tot = d.tijd_tot || null; if (row.tijd_van && row.tijd_tot && row.tijd_tot <= row.tijd_van) { toast("Het einduur moet na het beginuur liggen."); return false; } }
      if (isNew) await dbInsert("uren", row); else await dbUpdate("uren", h.id, row);
      toast(`${nl(row.uren)} u geregistreerd`);
    },
    onDelete: isNew ? null : async () => { await dbDelete("uren", h.id); toast("Registratie verwijderd"); },
  });
  $("#h_proj").onchange = (e) => { $("#h_task").innerHTML = taskOptsFor(e.target.value); };
  if ($("#h_van")) { const calc = () => { const a = $("#h_van").value, b = $("#h_tot").value; if (a && b && b > a) { const u = Math.round(tijdDiff(a, b) * 4) / 4; if (u > 0) { $("#h_uren").value = u; $("#h_hint").textContent = `${a} – ${b} = ${nl(u, 2)} u`; } } }; $("#h_van").onchange = calc; $("#h_tot").onchange = calc; }
}
const tijd = (t) => (t || "").slice(0, 5);
const tijdDiff = (a, b) => { const [h1, m1] = a.split(":").map(Number), [h2, m2] = b.split(":").map(Number); return (h2 * 60 + m2 - h1 * 60 - m1) / 60; };
const tijdSpan = (h) => h.tijd_van && h.tijd_tot ? `${tijd(h.tijd_van)}–${tijd(h.tijd_tot)}` : h.tijd_van ? `vanaf ${tijd(h.tijd_van)}` : "";
function userForm(u) {
  const self = u.id === S.me.id, tar = S.tarieven[u.id] || {};
  openModal(self ? "Mijn profiel" : "Medewerker bewerken", `<div class="form-grid">
    <div class="field"><label for="u_name">Naam</label><input id="u_name" name="name" required value="${esc(u.name || "")}"></div>
    <div class="field"><label for="u_ini">Initialen</label><input id="u_ini" name="initials" maxlength="3" value="${esc(u.initials || "")}"></div>
    <div class="field"><label for="u_color">Kleur</label><select id="u_color" name="color">${opts(PALETTE.map((c, i) => [c, "Kleur " + (i + 1)]), u.color)}</select></div>
    ${schemaV() >= 11 ? `<div class="field span2" style="border-top:1px solid var(--line);padding-top:10px"><label>Klantenportaal — pagina "Wie is wie"</label></div>
    <div class="field"><label for="u_functie">Functie</label><input id="u_functie" name="functie" value="${esc(u.functie || "")}" placeholder="bv. Co-founder · Creative Director"></div>
    <div class="field"><label for="u_foto">Foto</label><div style="display:flex;gap:10px;align-items:center">${u.foto_url ? `<img src="${esc(u.foto_url)}" alt="" style="width:44px;height:44px;border-radius:50%;object-fit:cover">` : avatar(u.id)}<input id="u_foto" name="foto" type="file" accept="image/*" style="font-size:12px"></div></div>
    <div class="field span2"><label for="u_bio">Korte biografie (2–3 zinnen)</label><textarea id="u_bio" name="bio" rows="3">${esc(u.bio || "")}</textarea></div>
    <div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" name="portaal_zichtbaar" ${u.portaal_zichtbaar !== false ? "checked" : ""}><span>Tonen op de pagina "Wie is wie" in het klantenportaal</span></label></div>` : ""}
    ${isBeheer() ? `<div class="field"><label for="u_role">Rol</label><select id="u_role" name="role">${opts([["medewerker", "Medewerker"], ["beheer", "Beheer"]], u.role)}</select></div>
    <div class="field"><label for="u_active">Actief</label><select id="u_active" name="active"><option value="1" ${u.active !== false ? "selected" : ""}>Ja</option><option value="0" ${u.active === false ? "selected" : ""}>Nee (verbergen)</option></select></div>
    <div class="field"><label for="u_ti">Uurtarief intern (€)</label><input id="u_ti" type="number" step="1" name="intern" value="${esc(tar.intern ?? 0)}"></div>
    <div class="field"><label for="u_te">Uurtarief extern (€)</label><input id="u_te" type="number" step="1" name="extern" value="${esc(tar.extern ?? 0)}"></div>` : ""}
  </div>`, {
    onSave: async (d) => {
      const patch = { name: d.name.trim(), initials: (d.initials || d.name.slice(0, 2)).toUpperCase(), color: d.color };
      if (isBeheer()) { patch.role = d.role; patch.active = d.active === "1"; }
      if (schemaV() >= 11) {
        patch.functie = (d.functie || "").trim(); patch.bio = (d.bio || "").trim(); patch.portaal_zichtbaar = d.portaal_zichtbaar === "on";
        const f = $("#u_foto")?.files?.[0];
        if (f) { const ext = (f.name.match(/\.([a-z0-9]+)$/i) || [, "jpg"])[1].toLowerCase(); const path = `team/${u.id}.${ext}`;
          const up = await sb.storage.from("portaal").upload(path, f, { upsert: true, contentType: f.type || "image/jpeg" });
          if (up.error) { toast("Foto niet opgeladen: " + up.error.message + " — is databasescript 011 uitgevoerd?", 6000); return false; }
          patch.foto_url = sb.storage.from("portaal").getPublicUrl(path).data.publicUrl + "?t=" + Date.now(); }
      }
      await dbUpdate("profiles", u.id, patch);
      if (isBeheer()) await dbUpsert("tarieven", { user_id: u.id, intern: Number(d.intern) || 0, extern: Number(d.extern) || 0 });
      toast("Profiel bewaard");
    },
  });
}

/* ---------- events ---------- */
document.addEventListener("click", (e) => {
  if (e.target.closest("a[href][target=_blank]")) return; // externe links (bv. Drive-map) gewoon laten openen
  const el = e.target.closest("[data-vs],[data-nav],[data-act],[data-open],[data-back],[data-ptab],[data-edit-task],[data-edit-hours],[data-gnav],[data-wnav],[data-gtoggle],[data-close],[data-selfase],[data-sellot],[data-sort],[data-vtoggle],[data-contact]");
  if (!el) { if (e.target === $("#modalBg")) closeModal(); else if (e.target.dataset && e.target.dataset.foto) fotoLightbox(e.target.dataset.foto); return; }
  if (e.target.matches(".task-check") || e.target.matches("input,select")) { if (!e.target.closest("[data-act]")) return; }
  const d = el.dataset;
  if (d.close != null && d.open) { closeModal(); S.view = "projecten"; S.project = d.open; S.ptab = S.ptab || "taken"; return render(); }
  if (d.close != null) return closeModal();
  if (d.sort) { S.sort = { key: d.sort, dir: S.sort.key === d.sort && S.sort.dir === "asc" ? "desc" : S.sort.key === d.sort ? "asc" : (["klant", "lead", "status", "fase"].includes(d.sort) ? "asc" : "desc") }; try { localStorage.setItem("bros.sort", JSON.stringify(S.sort)); } catch (err) { } return render(); }
  if (d.nav) { S.view = d.nav; S.project = null; if (d.nav === "planning") S.filters.project = ""; return render(); }
  if (d.open) { S.view = "projecten"; S.project = d.open; S.ptab = S.ptab || "taken"; return render(); }
  if (d.back) { S.project = null; return render(); }
  if (d.ptab) { S.ptab = d.ptab; return render(); }
  if (d.gtoggle) { S.ganttOpen[d.gtoggle] = S.ganttOpen[d.gtoggle] === false; return render(); }
  if (d.gnav) { S.ganttStart = d.gnav === "today" ? addDays(mondayOf(todayIso), -14) : addDays(S.ganttStart, Number(d.gnav)); return render(); }
  if (d.wnav) { S.weekStart = addDays(S.weekStart, Number(d.wnav)); return render(); }
  if (d.editTask) { e.stopPropagation(); const t = S.taken[d.editTask]; if (!t) return toast("Deze taak bestaat niet meer."); return taskForm(t); }
  if (d.editHours) { const h = S.uren[d.editHours]; if (h && (isBeheer() || h.user_id === S.me.id)) return hoursForm(h); return toast("Alleen je eigen uren kun je bewerken."); }
  if (d.act === "new-project") return projectForm();
  if (d.act === "edit-project") { const pj = S.projecten[d.pid]; if (!pj) return toast("Dit project bestaat niet meer."); return projectForm(pj); }
  if (d.act === "add-fase") return addFaseForm(d.pid);
  if (d.act === "new-task") return taskForm({}, d.pid);
  if (d.act === "log-hours") return hoursForm(d.tid ? { taak_id: d.tid, project_id: d.pid } : {}, d.pid);
  if (d.act === "uren-klant-print") return printKlantUren(S.projecten[d.pid]);
  if (d.act === "edit-user") { const u = S.profiles[d.uid]; if (!u) return toast("Dit profiel bestaat niet meer."); return userForm(u); }
  if (d.act === "export-hours") return exportHours();
  if (d.act === "export-projects") return exportProjects();
  if (d.act === "drive-create" || d.act === "drive-link" || d.act === "drive-list") { const p = S.projecten[d.pid]; const a = d.act.replace("drive-", ""); driveSync(p, a).catch(err => toast("Drive: " + err.message)); return; }
  if (d.act === "drive-save") return driveSaveSettings();
  if (d.act === "portaal-save") return portaalSaveSettings();
  if (d.act === "ai-save") return aiSaveSettings();
  if (d.act === "vt-ok") { voorstelBevestig(d.id).catch(() => { }); return; }
  if (d.act === "vt-edit") { const v = S.taak_voorstellen[d.id]; if (v) voorstelForm(v); return; }
  if (d.act === "vt-nee") return voorstelWeiger(d.id);
  if (d.act === "portaal-invite") return portaalInviteForm(d.cid, d.pid, d.rol || "klant");
  if (d.act === "drive-test") return driveCall("ping", {}).then(j => toast(`OK — mappen: ${j.projecten} / ${j.sjabloon}`)).catch(err => toast("Drive: " + err.message));
  if (d.selfase) { S.selFase = Number(d.selfase); return render(); }
  if (d.act === "fase-new") return faseForm(null);
  if (d.act === "fase-edit") { e.stopPropagation(); return faseForm(S.fasen[d.nr]); }
  if (d.act === "st-new") return stAdd(Number(d.nr));
  if (d.act === "st-move") return stMove(d.id, Number(d.dir));
  if (d.act === "st-del") return stDel(d.id);
  if (d.sellot) { S.selLot = Number(d.sellot); return render(); }
  if (d.vtoggle) { S.vordOpen = S.vordOpen || {}; S.vordOpen[d.vtoggle] = !S.vordOpen[d.vtoggle]; return render(); }
  if (d.act === "ms-klant") { S.msKlant = !S.msKlant; try { localStorage.setItem("bros.msKlant", S.msKlant ? "1" : ""); } catch (x) { } toast(S.msKlant ? "Klantweergave: kostprijs en marge verborgen" : "Volledige weergave"); return render(); }
  if (d.act === "ms-add-lot") return msAddLotForm(d.pid);
  if (d.act === "ms-open") { S.ptab = "meetstaat"; render(); if (!msRows(d.pid).length) msAddLotForm(d.pid); return; }
  if (d.act === "ms-add-post") return msAddPostForm(d.pid, d.lot ? Number(d.lot) : null);
  if (d.act === "ms-del") { const r = S.meetstaat_posten[d.id]; if (r && confirm(`"${r.omschrijving}" verwijderen?`)) dbDelete("meetstaat_posten", d.id).catch(() => { }); return; }
  if (d.act === "ms-del-lot") return msDelLot(d.pid, Number(d.lot));
  if (d.act === "ms-import") return msImportPick(d.pid);
  if (d.act === "gk-new") return gkForm(d.pid, d.soort || null);
  if (d.act === "note-new") return noteForm({}, d.pid);
  if (d.act === "vs-new") return vsForm({}, d.pid);
  if (d.act === "tk-new") return tkPlanForm(d.pid);
  if (d.act === "tk-open") return tkOpen(d.id);
  if (d.vs) { e.stopPropagation(); closeModal(); return vsForm(S.vaststellingen[d.vs]); }
  if (d.act === "kt-fill") { const [a, b] = ktTaskSpan(d.pid, Number(d.nr)); return ktSave(d.pid, Number(d.nr), { start: a, eind: b }); }
  if (d.act === "kt-clear") return ktClear(d.pid, Number(d.nr));
  if (d.act === "vs-open") { if (e.target.dataset.foto) return fotoLightbox(e.target.dataset.foto); const v = S.vaststellingen[d.id]; if (!v) return toast("Deze vaststelling bestaat niet meer."); return vsForm(v); }
  if (d.act === "wb-new") return wbForm({}, d.pid);
  if (d.act === "plan-new") return planForm(d.pid);
  if (d.act === "wv-new") return wvForm(d.pid);
  if (d.act === "pa-new") return paForm(d.pid);
  if (d.act === "pa-cmp") return paVergelijk(d.pid);
  if (d.act === "pa-take") { if (d.fromcmp) closeModal(); return paOvernemen(d.id); }
  if (d.act === "pa-remind") { loader.start("pa.mail", "Herinnering versturen…", 6000); driveCall("prijsaanvraagmail", { id: d.id, soort: "herinnering", token: S.session?.access_token || "" }).then(j => { loader.done("pa.mail"); toast("Herinnering gemaild naar " + (j.naar || "")); }).catch(e => { loader.fail(); toast("Mailen mislukt: " + e.message, 6000); }); return; }
  if (d.act === "pa-close") { dbUpdate("prijsaanvragen", d.id, { status: "afgesloten" }).then(() => toast("Prijsaanvraag afgesloten")).catch(() => { }); return; }
  if (d.act === "pa-del") { if (!confirm("Deze prijsaanvraag en de ingevulde prijzen verwijderen?")) return; dbDelete("prijsaanvragen", d.id).then(() => toast("Verwijderd")).catch(() => { }); return; }
  if (d.act === "wv-share") { const w = S.werfverslagen[d.id]; if (w) dbUpdate("werfverslagen", w.id, { klant_zichtbaar: !w.klant_zichtbaar }).then(() => toast(!w.klant_zichtbaar ? "Werfverslag zichtbaar in het portaal" : "Werfverslag verborgen voor de klant")).catch(() => { }); return; }
  if (d.act === "wv-share-a") { const w = S.werfverslagen[d.id]; if (w) dbUpdate("werfverslagen", w.id, { aannemer_zichtbaar: !w.aannemer_zichtbaar }).then(() => toast(!w.aannemer_zichtbaar ? "Werfverslag zichtbaar voor alle aannemers van dit project" : "Werfverslag enkel nog voor wie het per mail kreeg")).catch(() => { }); return; }
  if (d.act === "wv-del") { const w = S.werfverslagen[d.id]; if (w && confirm(`Werfverslag ${w.nr} verwijderen? De pdf wordt ook gewist.`)) dbDelete("werfverslagen", d.id).then(() => { if (w.pdf_path) sb.storage.from("werf").remove([w.pdf_path]).catch(() => { }); }).catch(() => { }); return; }
  if (d.act === "plan-view") return planView(d.id);
  if (d.act === "wb-open") { const b = S.werfbezoeken[d.id]; if (!b) return toast("Dit werfbezoek bestaat niet meer."); return wbForm(b); }
  if (d.act === "note-open") { const n = S.notities[d.id]; if (!n) return toast("Deze notitie bestaat niet meer."); return noteForm(n); }
  if (d.act === "gk-view") return gkView(d.id);
  if (d.act === "gk-withdraw") return gkWithdraw(d.id);
  if (d.act === "ms-export") return exportMeetstaat(S.projecten[d.pid]).catch(err => { loader.fail(); toast("Export: " + err.message); });
  if (d.act === "post-new") return postAdd(Number(d.lot));
  if (d.act === "vord-new") return vordForm(d.pid, d.soort);
  if (d.act === "contact-new") return contactForm({});
  if (d.act === "contact-link") return linkContactForm(d.pid, d.rol);
  if (d.act === "contact-unlink") { const x = S.project_contacten[d.id]; if (x && confirm(`${S.contacten[x.contact_id]?.naam || "Contact"} ontkoppelen van dit project?`)) dbDelete("project_contacten", d.id).catch(() => { }); return; }
  if (d.contact) { e.stopPropagation(); const c = S.contacten[d.contact]; if (!c) return toast("Dit contact bestaat niet meer."); return contactForm(c); }
  if (d.act === "vord-del") return vordDel(d.id);
  if (d.act === "vord-fit") return vordFit(d.id);
  if (d.act === "post-del") return postDel(d.id);
  if (d.act === "logout") return sb.auth.signOut().then(() => location.reload());
  if (d.act === "change-password") { S.setPassword = true; S.passwordForced = false; render(); return; }
  if (d.act === "reload") return hardReload();
  if (d.act === "update-later") { updateAvailable = false; $("#updateBar")?.classList.remove("show"); }
});
document.addEventListener("focusout", (e) => { const t = e.target; if (t && t.matches && t.matches('input[type="tel"]') && t.value.trim()) { const v = telFmt(t.value); if (v !== t.value) t.value = v; } });
document.addEventListener("keydown", (e) => { if ((e.key === "k" || e.key === "K") && !e.metaKey && !e.ctrlKey && !e.altKey && S.view === "projecten" && S.project && S.ptab === "meetstaat" && isBeheer() && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") && !$("#modalBg").classList.contains("show")) { S.msKlant = !S.msKlant; try { localStorage.setItem("bros.msKlant", S.msKlant ? "1" : ""); } catch (x) { } render(); } });
document.addEventListener("focusout", (e) => {
  if (renderPending) setTimeout(() => { if (renderPending) render(); }, 0);
  const d = e.target.dataset || {};
  if (d.stTitle) return stRename(d.stTitle, e.target.value);
  if (d.kt && e.target.type !== "date") { const cur = ktOf(d.pid, Number(d.kt)); if ((cur?.[d.f] || "") !== e.target.value) ktSave(d.pid, Number(d.kt), { [d.f]: e.target.value }); return; }
  if (d.vr) return vordEditPct(d.vr, Number(d.lot), e.target.value, d.vpost || null);
  if (d.ms && e.target.tagName !== "SELECT") return msEdit(d.ms, d.f, e.target.value);
  if (d.post && e.target.type !== "checkbox" && e.target.tagName !== "SELECT") return postEdit(d.post, d.f, e.target.value);
  if (d.lot && d.f === "marge") return lotEdit(Number(d.lot), d.f, e.target.value);

  if (d.vf && e.target.tagName !== "SELECT" && e.target.type !== "date") return vordEdit(d.vf, d.f, e.target.value);
});
document.addEventListener("input", (e) => { if (e.target.dataset && e.target.dataset.werff === "q") { S.werfF.q = e.target.value; const pos = e.target.selectionStart; render(); const el = document.querySelector('[data-werff="q"]'); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (x) { } } return; }
  if (e.target.dataset && e.target.hasAttribute("data-noteq")) { S.noteQ = e.target.value; const pos = e.target.selectionStart; render(); const el = document.querySelector("[data-noteq]"); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (x) { } } } });
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset.filter) { S.filters[el.dataset.filter] = el.value; return render(); }
  if (el.dataset.cfilter) { S.cfilters[el.dataset.cfilter] = el.value; return render(); }
  if (el.dataset.werff) { S.werfF = S.werfF || { status: "actief", wie: "", q: "", groep: false }; S.werfF[el.dataset.werff] = el.type === "checkbox" ? el.checked : el.value; return render(); }
  if (el.dataset.hoursUser != null) { S.hoursUser = el.value; return render(); }
  if (el.dataset.rapjaar != null) { S.rapJaar = el.value; return render(); }
  if (el.dataset.toggle) { const t = S.taken[el.dataset.toggle]; if (t) dbUpdate("taken", t.id, { status: el.checked ? "done" : "todo" }).catch(() => { }); }
  if (el.dataset.kt && el.type === "date") { const cur = ktOf(el.dataset.pid, Number(el.dataset.kt)); if ((cur?.[el.dataset.f] || "") !== el.value) ktSave(el.dataset.pid, Number(el.dataset.kt), { [el.dataset.f]: el.value || null }); return; }
  if (el.dataset.ttoggle) { const t = S.taken[el.dataset.ttoggle]; if (t) dbUpdate("taken", t.id, { timing_klant: el.checked }).then(() => toast(el.checked ? "Timing van deze taak staat in de klantplanning" : "Timing niet meer gedeeld")).catch(() => { }); return; }
  if (el.dataset.ktoggle) { const t = S.taken[el.dataset.ktoggle]; if (t) dbUpdate("taken", t.id, { uren_klant: el.checked }).then(() => toast(el.checked ? "Uren van deze taak zijn zichtbaar voor de klant" : "Uren verborgen voor de klant")).catch(() => { }); }
  if (el.dataset.ms && el.tagName === "SELECT") return msEdit(el.dataset.ms, el.dataset.f, el.value);
  if (el.dataset.post && (el.type === "checkbox" || el.tagName === "SELECT")) return postEdit(el.dataset.post, el.dataset.f, el.value, el.checked);
  if (el.dataset.lot && el.type === "checkbox") return lotEdit(Number(el.dataset.lot), el.dataset.f, null, el.checked);
  if (el.dataset.vf && (el.tagName === "SELECT" || el.type === "date")) return vordEdit(el.dataset.vf, el.dataset.f, el.value);
  if (el.dataset.dshare) return docShare(el.dataset.dshare, el.checked);
  if (el.dataset.dshareA) return docShare(el.dataset.dshareA, el.checked, "aannemers");
});
document.addEventListener("input", (e) => {
  if (e.target.dataset.filter === "q") { S.filters.q = e.target.value; render(); const i = $("[data-filter=q]"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  if (e.target.dataset.cfilter === "q") { S.cfilters.q = e.target.value; render(); const i = $("[data-cfilter=q]"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); if (e.key === "Enter" && e.target.classList && e.target.classList.contains("inline") && e.target.tagName === "INPUT") { e.preventDefault(); e.target.blur(); } });

/* ---------- versiecontrole: melden als er een nieuwe versie online staat ---------- */
let updateAvailable = false;
const APP_FILES = ["index.html", "app.js", "config.js", "postcodes.js", "meetstaat-export.js", "meetstaat-import.js", "tekenen.js", "symbolen.js", "vendor/dxf-parser.js", "version.json", "klant/index.html", "klant/portaal.js", "logo-mark.svg", "werf/index.html", "werf/werf.js", "werf/sw.js", "aannemer/index.html", "aannemer/aannemer.js"];
/* de browser-cache omzeilen: alle bestanden van de app vers ophalen (cache: "reload" ververst de HTTP-cache) en dan herladen */
async function hardReload() {
  try { sessionStorage.setItem("pb-state", JSON.stringify({ view: S.view, project: S.project, ptab: S.ptab })); } catch (e) { }
  try { await Promise.all(APP_FILES.map(f => fetch(f + (f.endsWith(".json") ? "" : "?v=" + APP_VERSION), { cache: "reload" }).catch(() => { }))); } catch (e) { }
  location.reload();
}
async function checkVersion() {
  try {
    const r = await fetch("version.json?t=" + Date.now(), { cache: "no-store" }); const j = await r.json();
    if (!j.version || j.version === APP_VERSION) return;
    // eerste keer: stil vers ophalen en herladen (één poging per versie, zodat het nooit blijft herladen als app.js nog niet online staat)
    let tried = ""; try { tried = sessionStorage.getItem("pb-refetch") || ""; } catch (e) { }
    const bezig = $("#modalBg")?.classList.contains("show") || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
    if (tried !== j.version && !bezig) { try { sessionStorage.setItem("pb-refetch", j.version); } catch (e) { } return hardReload(); }
    if (!updateAvailable) { updateAvailable = true; $("#updateBar")?.classList.add("show"); }
  } catch (e) { }
}

/* ---------- start ---------- */
async function boot() {
  try { const sv = JSON.parse(localStorage.getItem("bros.sort") || "null"); if (sv && sv.key) S.sort = sv; S.msKlant = localStorage.getItem("bros.msKlant") === "1"; } catch (e) { }
  if (location.hash === "#voorstellen") { S.view = "voorstellen"; history.replaceState(null, "", location.pathname); }
  try { const st = JSON.parse(sessionStorage.getItem("pb-state") || "null"); sessionStorage.removeItem("pb-state"); if (st && st.view) { S.view = st.view; S.project = st.project || null; S.ptab = st.ptab || "taken"; } } catch (e) { }
  render();
  if (!configured) return;
  const { data: { session } } = await sb.auth.getSession();
  S.session = session;
  if (session && (URL_AUTH.type === "invite" || URL_AUTH.type === "recovery")) { S.setPassword = true; S.passwordForced = true; }
  render();
  sb.auth.onAuthStateChange((evt, sess) => {
    const had = !!S.session; S.session = sess;
    if (evt === "PASSWORD_RECOVERY" && sess) { S.setPassword = true; S.passwordForced = true; render(); return; }
    if (sess && !had && !S.setPassword) start();
    if (!sess) { S.ready = false; S.setPassword = false; render(); }
  });
  if (session && !S.setPassword) start();
}
async function start() {
  loader.start("app.load", "Planbord laden…", 2500);
  try { await loadAll(); if (S.me && S.me.role === "klant") { location.replace("klant/"); return; } if (S.me && S.me.role === "aannemer") { location.replace("aannemer/"); return; } S.ready = true; S.loadError = null; render(); loader.done("app.load"); subscribe(); setInterval(checkVersion, 5 * 60 * 1000); setTimeout(checkVersion, 20000); }
  catch (e) { loader.fail(); S.loadError = e.message || String(e); render(); }
}
boot();
