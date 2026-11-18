/* =====================================================================
   BROS Planbord — app v1.0
   Statische webapp op Supabase (login, live-synchronisatie, rechten)
   ===================================================================== */
if (window.top !== window.self) { try { window.top.location.replace(window.location.href); } catch (e) { document.documentElement.innerHTML = ""; } }   // niet in een vreemd frame (clickjacking)
const APP_VERSION = "1.78.0";
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
/* 1.48: tijdstempels (timestamptz, in UTC opgeslagen) in Belgische tijd tonen — anders is een bericht om 00:30 "gisteren 22:30" */
const lokDag = (ts) => { if (!ts) return ""; const d = new Date(ts); if (isNaN(d)) return String(ts).slice(0, 10); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const lokUur = (ts) => { if (!ts) return ""; const d = new Date(ts); return isNaN(d) ? String(ts).slice(11, 16) : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const weekNr = (s) => { const t = pd(s); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y0) / DAY + 1) / 7); };
const MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const DAYS = ["ma", "di", "wo", "do", "vr", "za", "zo"];
const nl = (n, dec = 1) => { const v = Number(n) || 0; if (dec === 1 && Math.abs(v * 4 - Math.round(v * 4)) < 1e-9 && Math.abs(v * 2 - Math.round(v * 2)) > 1e-9) dec = 2; /* kwartieren (2,25 / 2,75) niet afronden */ return (Math.round(v * 10 ** dec) / 10 ** dec).toLocaleString("nl-BE", { minimumFractionDigits: 0, maximumFractionDigits: dec }); };
const eur = (n) => n == null || n === "" ? "—" : Number(n).toLocaleString("nl-BE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const workdays = (a, b) => { let n = 0; for (let s = a; s <= b; s = addDays(s, 1)) { const d = pd(s).getUTCDay(); if (d !== 0 && d !== 6) n++; } return Math.max(n, 1); };

/* ---------- state ---------- */
const S = {
  session: null, me: null, setPassword: false, passwordForced: false,
  profiles: {}, tarieven: {}, fasen: {}, standaardtaken: [], projecten: {}, taken: {}, uren: {}, documenten: {}, instellingen: {}, loten: {}, posten: {}, meetstaat_posten: {}, vorderingen: {}, vordering_regels: {}, contacten: {}, project_contacten: {}, goedkeuringen: {}, notities: {}, werfbezoeken: {}, vaststellingen: {}, klant_timing: {}, werfplannen: {}, werfverslagen: {}, tekenplannen: {}, aannemer_meetstaten: {}, aannemer_meetstaat_posten: {}, keuzes: {}, keuze_opties: {}, meerwerk_aanvragen: {}, werf_fotos: {}, werf_updates: {}, woningdossier: {}, taak_voorstellen: {}, assistent_berichten: {}, aannemer_facturen: {}, betaalherinneringen: {}, fin_plan: {}, fin_vaste_kosten: {}, fin_instellingen: {}, vergaderingen: {}, vergadering_punten: {}, verwerkingen: {}, verwerker_status: {}, ms_raming: {}, document_aannemers: {}, plan_omzettingen: {}, render_beelden: {}, render_opdrachten: {}, render_afspraken: {}, render_presentaties: {}, render_ruimtes: {}, render_standpunten: {}, taak_punten: {}, ontwerp_rondes: {}, ontwerp_documenten: {}, ontwerp_feedback: {},
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
if (configured && !window.supabase) { document.body.innerHTML = '<div style="font-family:system-ui;padding:40px;text-align:center"><h2>Het Planbord kon niet starten</h2><p>Een onderdeel (vendor/supabase-2.45.4.js) laadde niet. Controleer je verbinding en herlaad de pagina.</p><button onclick="location.reload()">Opnieuw laden</button></div>'; throw new Error("supabase-js niet geladen"); }   // 1.48
const sb = configured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;

/* ---------- helpers ---------- */
const isBeheer = () => S.me?.role === "beheer";
const EXTERN = ["klant", "aannemer", "verwerker"]; const users = () => Object.values(S.profiles).filter(u => u.active !== false && !EXTERN.includes(u.role)).sort((a, b) => a.name.localeCompare(b.name));
const projects = () => Object.values(S.projecten).sort((a, b) => (b.nummer || "").localeCompare(a.nummer || "") || (a.klant || "").localeCompare(b.klant || ""));
/* index per render: uren per taak/project en taken per project (vermijdt een volledige scan per rij in grote lijsten) */
let IDX = null;
function buildIndex() {
  const byTask = {}, byProj = {}, tasksByProj = {}, mijnDag = {}; const ik = S.me && S.me.id;
  for (const h of Object.values(S.uren)) { const u = Number(h.uren) || 0; byTask[h.taak_id] = (byTask[h.taak_id] || 0) + u; byProj[h.project_id] = (byProj[h.project_id] || 0) + u; if (ik && h.user_id === ik && h.datum) mijnDag[h.datum] = (mijnDag[h.datum] || 0) + u; }
  for (const t of Object.values(S.taken)) (tasksByProj[t.project_id] = tasksByProj[t.project_id] || []).push(t);
  for (const k in tasksByProj) tasksByProj[k].sort((a, b) => (a.volgorde ?? 0) - (b.volgorde ?? 0) || (a.start || "9").localeCompare(b.start || "9"));
  IDX = { byTask, byProj, tasksByProj, mijnDag };
}
const idx = () => { if (!IDX) buildIndex(); return IDX; };
const tasksOf = (pid) => (idx().tasksByProj[pid] || []).slice();
const hoursOf = (pred) => Object.values(S.uren).filter(pred).reduce((s, h) => s + (Number(h.uren) || 0), 0);
const taskDone = (tid) => idx().byTask[tid] || 0;
const projDone = (pid) => idx().byProj[pid] || 0;
const projPlanned = (pid) => tasksOf(pid).reduce((s, t) => s + (Number(t.uren_gepland) || 0), 0);
const isLate = (t) => t.status !== "done" && t.eind && t.eind < todayIso;
const userById = (id) => S.profiles[id] || { name: "—", initials: "?", color: "#999" };
const projName = (p) => p ? (p.intern ? "BROS — Interne werking" : p.klant + (p.naam && p.naam !== p.klant ? " · " + p.naam : "")) : "—";   // 1.54: het interne project (script 051) toont zijn functie
const projCode = (p) => p ? [p.nummer, KLANTCODE[p.klanttype]].filter(Boolean).join(" · ") : "";
const faseName = (nr) => nr ? (S.fasen[nr] ? `${nr} · ${S.fasen[nr].naam}` : String(nr)) : "";
const faseShort = (nr) => nr && S.fasen[nr] ? S.fasen[nr].naam : "";
const fasenList = () => Object.values(S.fasen).filter(f => f.actief !== false).sort((a, b) => a.nr - b.nr);
// 1.64 (script 060): wat de klant in het portaal ziet — "stap" = plaats in de lijst actieve fasen, net als in het portaal
const klantStap = (p) => { if (!p) return ""; if (p.status === "afgerond") return "Opgeleverd"; const i = fasenList().findIndex(f => f.nr === p.fase_nr); return i >= 0 ? `stap ${i + 1} · ${fasenList()[i].naam}` : (PROJ_STATUS[p.status] || p.status || "—"); };
const faseBron = (p) => { if (!p) return ""; const op = p.fase_sinds ? " · " + fmtLong(lokDag(p.fase_sinds)) : "";
  if (p.fase_vast) return "🔒 vastgezet" + op; if (p.fase_bron === "auto") return "automatisch" + (p.fase_reden ? ": " + p.fase_reden : "") + op; if (p.fase_bron === "manueel") return "zelf gekozen" + op + " · schuift verder mee met het werk"; return "schuift automatisch mee met het werk"; };
// na het afvinken: is de projectfase mee opgeschoven? → project herladen en kort melden
async function faseNa(pid, f0) {
  if (!pid || !S.projecten[pid]) return;
  const { data } = await sb.from("projecten").select("*").eq("id", pid).maybeSingle(); if (!data) return;
  S.projecten[pid] = { ...S.projecten[pid], ...data }; renderSoon();
  if (data.fase_nr !== f0 && data.fase_bron === "auto") toast(`${S.projecten[pid].klant || "Project"}: fase → ${faseName(data.fase_nr)} — de klant ziet nu ${klantStap(data)}`, 5000);
}
const projSpan = (p) => { const ts = tasksOf(p.id); const st = [p.start, ...ts.map(t => t.start)].filter(Boolean).sort()[0]; const en = [p.eind, ...ts.map(t => t.eind)].filter(Boolean).sort().pop(); return [st, en]; };
/* toegewezen aan: teamlid (assignee) of contact zoals de klant of een aannemer (contact_id, sinds script 015) */
const contactAvatar = (c) => `<span class="avatar" style="background:var(--surface-2);color:var(--ink-2);border:1px solid var(--line-2)" title="${esc(c.naam)}">${esc((c.naam || "?").trim().split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase())}</span>`;
const wieCell = (t) => t.contact_id && S.contacten[t.contact_id] ? `<span class="who-cell">${contactAvatar(S.contacten[t.contact_id])}${esc(S.contacten[t.contact_id].naam)} <span class="pill kl">${S.contacten[t.contact_id].soort === "klant" ? "klant" : CONTACT_SOORT[S.contacten[t.contact_id].soort] || "contact"}</span></span>` : `${!t.assignee && t.vergadering_id ? `<span class="pill late" title="Uit een vergadering: verantwoordelijke nog te bepalen">nog te bepalen</span>` : `<span class="who-cell">${t.assignee ? avatar(t.assignee) : ""}${esc(userById(t.assignee).name)}</span>`}`;
const wieNaam = (t) => t.contact_id && S.contacten[t.contact_id] ? S.contacten[t.contact_id].naam : userById(t.assignee).name;
/* keuzelijst "toegewezen aan": team + contacten van het project (waarde "c:<id>" voor een contact) */
const wieOpts = (pid, t) => { const cur = t.contact_id ? "c:" + t.contact_id : (t.assignee ?? S.me.id); const pcs = pid ? contactsOf(pid) : []; return `<option value="">— niemand —</option><optgroup label="Team">${opts(users().map(u => [u.id, u.name]), cur)}</optgroup>${pcs.length ? `<optgroup label="Klant en contacten van dit project">${opts(pcs.map(x => ["c:" + x.c.id, x.c.naam + " · " + (CONTACT_ROL[x.rol] || x.rol)]), cur)}</optgroup>` : ""}`; };
const wieSplit = (v) => v && v.startsWith("c:") ? { assignee: null, contact_id: v.slice(2) } : { assignee: v || null, contact_id: null };
/* getallen zoals een Belg ze typt: 2,5 · 1.234,50 · 12.75 · € 15 — leeg = null, onleesbaar = NaN (nooit stilletjes 0 of 25) */
const leesGetal = (raw) => { let t = String(raw ?? "").trim().replace(/[\s€%\u00a0]/g, ""); if (!t) return null; if (t.includes(",") && t.includes(".")) { t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, ""); } else if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ""); /* 1.250 en 12.500 = duizendtallen (Belgische schrijfwijze); 12.75 en 0.125 blijven decimaal */ else t = t.replace(",", "."); const n = Number(t); return Number.isFinite(n) ? n : NaN; };
/* afronden op de cent zoals de database (half weg van nul) en zonder zwevendekommafouten: 1,005 → 1,01 */
const r2 = (n) => { const v = Number(n) || 0; return Math.sign(v) * Math.round(Number((Math.abs(v) * 100).toFixed(6))) / 100; };
/* marge (fractie) als % in een invoerveld: tot 4 decimalen, nooit afgerond op een geheel getal */
const pctVeld = (m) => m == null || m === "" ? "" : String(Math.round(Number(m) * 1e6) / 1e4).replace(".", ",");
/* "2.375" kan 2375 (Belgisch duizendtal) of 2,375 zijn: bij hoeveelheden en bedragen even vragen */
const duizendKeuze = (raw, n) => { const t = String(raw ?? "").trim().replace(/[\s€\u00a0]/g, ""); if (n == null || Number.isNaN(n) || !/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(t)) return n; const dec = Number(t.replace(/\./g, (m, i) => i === t.indexOf(".") ? "." : "")); return confirm(`Je typte ${t}.\n\nOK = ${nl(n, 0)} (duizendtal)\nAnnuleren = ${String(dec).replace(".", ",")}`) ? n : dec; };
const getalVeld = (v) => v == null || v === "" ? "" : String(Number(v)).replace(".", ",");
/* links en afbeeldingen uit de database: enkel https (en blob:/data:image voor lokale voorbeelden) — nooit javascript: */
const safeUrl = (u) => /^(https:|blob:)/i.test(String(u || "")) ? String(u) : "#";
const safeSrc = (u) => /^(https:|blob:|data:image\/)/i.test(String(u || "")) ? String(u) : "";
const safeColor = (c) => /^#[0-9a-fA-F]{3,8}$/.test(String(c || "")) ? c : "#6B6B7B";
const avatar = (id) => { const u = userById(id); return `<span class="avatar" style="background:${safeColor(u.color)}" title="${esc(u.name)}">${esc(u.initials)}</span>`; };
const vsTag = (t) => t.vaststelling_id && S.vaststellingen[t.vaststelling_id] ? ` <span class="pill kl" data-vs="${t.vaststelling_id}" title="Uit een vaststelling op de werf — klik om ze te openen" style="cursor:pointer">📍 ${vsNr(S.vaststellingen[t.vaststelling_id])}</span>` : "";
/* actiepunt uit een verslag: klik opent het verslag */
const noteTag = (t) => { const n = t.notitie_id && S.notities && S.notities[t.notitie_id]; return n ? ` <span class="pill kl" data-act="note-open" data-id="${n.id}" title="Actiepunt uit ${esc(n.titel || "dit verslag")} — klik om het verslag te openen" style="cursor:pointer">📝 ${esc(NOTE_SOORT[n.soort] || "Verslag")} ${esc(fmt(n.datum))}</span>` : ""; };
const klantTag = (t) => (typeof tdTag === "function" ? tdTag(t) : "") + (typeof afsTag === "function" ? afsTag(t) : "") + vsTag(t) + noteTag(t) + (t.uren_klant ? ` <span class="pill kl" title="Uren van deze taak zijn zichtbaar voor de klant">uren → klant</span>` : "") + (t.timing_klant ? ` <span class="pill kl" title="Titel en timing van deze taak staan in de planning van de klant">timing → klant</span>` : "");
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
const TABLES = { profiles: "profiles", tarieven: "tarieven", fasen: "fasen", standaardtaken: "standaardtaken", projecten: "projecten", taken: "taken", uren: "uren", documenten: "documenten", instellingen: "instellingen", loten: "loten", posten: "posten", meetstaat_posten: "meetstaat_posten", vorderingen: "vorderingen", yuki_facturen: "yuki_facturen", vordering_regels: "vordering_regels", contacten: "contacten", project_contacten: "project_contacten", goedkeuringen: "goedkeuringen", notities: "notities", werfbezoeken: "werfbezoeken", vaststellingen: "vaststellingen", klant_timing: "klant_timing", werfplannen: "werfplannen", werfverslagen: "werfverslagen", taak_voorstellen: "taak_voorstellen", assistent_berichten: "assistent_berichten", prijsaanvragen: "prijsaanvragen", prijsaanvraag_regels: "prijsaanvraag_regels", tekenplannen: "tekenplannen", aannemer_meetstaten: "aannemer_meetstaten", aannemer_meetstaat_posten: "aannemer_meetstaat_posten", keuzes: "keuzes", keuze_opties: "keuze_opties", meerwerk_aanvragen: "meerwerk_aanvragen", werf_fotos: "werf_fotos", werf_updates: "werf_updates", woningdossier: "woningdossier", prijsvragen: "prijsvragen", prijsvraag_gunningen: "prijsvraag_gunningen", goedkeuring_tekenaars: "goedkeuring_tekenaars", aannemer_facturen: "aannemer_facturen", betaalherinneringen: "betaalherinneringen", fin_plan: "fin_plan", fin_vaste_kosten: "fin_vaste_kosten", fin_instellingen: "fin_instellingen", vergaderingen: "vergaderingen", vergadering_punten: "vergadering_punten", verwerkingen: "verwerkingen", verwerker_status: "verwerker_status", ms_raming: "ms_raming", document_aannemers: "document_aannemers", plan_omzettingen: "plan_omzettingen", render_beelden: "render_beelden", render_opdrachten: "render_opdrachten", render_afspraken: "render_afspraken", render_presentaties: "render_presentaties", render_ruimtes: "render_ruimtes", render_standpunten: "render_standpunten", taak_punten: "taak_punten", ontwerp_rondes: "ontwerp_rondes", ontwerp_documenten: "ontwerp_documenten", ontwerp_feedback: "ontwerp_feedback", mijn_markeringen: "mijn_markeringen", goedkeuring_aannemers: "goedkeuring_aannemers", naservice_punten: "naservice_punten", naservice_gebeurtenissen: "naservice_gebeurtenissen" };   // 1.77: naservice (script 069)   // 1.59: renders (script 055) · 1.63: to-do's en ontwerptraject (script 059)
const OPTIONAL_TABLES = ["yuki_facturen", "tarieven", "documenten", "instellingen", "loten", "posten", "meetstaat_posten", "vorderingen", "vordering_regels", "contacten", "project_contacten", "goedkeuringen", "notities", "werfbezoeken", "vaststellingen", "klant_timing", "werfplannen", "werfverslagen", "taak_voorstellen", "assistent_berichten", "prijsaanvragen", "prijsaanvraag_regels", "tekenplannen", "aannemer_meetstaten", "aannemer_meetstaat_posten", "keuzes", "keuze_opties", "meerwerk_aanvragen", "werf_fotos", "werf_updates", "woningdossier", "prijsvragen", "prijsvraag_gunningen", "goedkeuring_tekenaars", "aannemer_facturen", "betaalherinneringen", "fin_plan", "fin_vaste_kosten", "fin_instellingen", "vergaderingen", "vergadering_punten", "verwerkingen", "verwerker_status", "ms_raming", "document_aannemers", "plan_omzettingen", "render_beelden", "render_opdrachten", "render_afspraken", "render_presentaties", "render_ruimtes", "render_standpunten", "taak_punten", "ontwerp_rondes", "ontwerp_documenten", "ontwerp_feedback", "mijn_markeringen", "goedkeuring_aannemers", "naservice_punten", "naservice_gebeurtenissen"]; // ontbreken zolang het bijbehorende sql-script niet is uitgevoerd
const rowKey = (t, r) => t === "mijn_markeringen" ? r.user_id + "|" + r.soort + "|" + r.sleutel : t === "fasen" || t === "loten" ? r.nr : t === "klant_timing" ? r.project_id + "|" + r.fase_nr : t === "tarieven" ? r.user_id : t === "instellingen" ? r.key : t === "prijsvraag_gunningen" ? r.prijsvraag_id + "|" + r.post_id : t === "vordering_regels" ? (r.id || r.vordering_id + "|" + r.lot + "|" + (r.post_id || "")) : t === "verwerker_status" ? r.naam : t === "document_aannemers" ? r.document_id + "|" + r.contact_id : r.id;
function ingest(table, rows) {
  if (table === "standaardtaken") { S.standaardtaken = rows.sort((a, b) => a.fase_nr - b.fase_nr || a.volgorde - b.volgorde); return; }
  const o = {}; rows.forEach(r => o[rowKey(table, r)] = r); S[table] = o; IDX = null;
}
// Sinds script 012 leest het team de meetstaat, loten en postenbibliotheek via views: kostprijs, marge en richtprijs
// zijn daarin leeg voor medewerkers en de verkoopprijs (verkoop_ep) komt berekend mee. Bestaat de view nog niet → de tabel.
const VIEW_OF = { meetstaat_posten: "meetstaat_posten_v", loten: "loten_v", posten: "posten_v" };
const srcOf = (t) => VIEW_OF[t] && S.viewsOk !== false ? VIEW_OF[t] : t;
// Supabase geeft max. 1000 rijen per aanvraag terug: in pagina's ophalen tot alles binnen is.
// Altijd sorteren op een unieke kolom: zonder vaste volgorde geeft de database bij elke pagina een andere volgorde terug
// en vallen er rijen tussen twee pagina's weg (zo misten posten in de meetstaat zodra er > 1000 rijen waren — fix v1.33.1).
const ORDER_OF = { verwerker_status: ["naam"], fasen: ["nr"], loten: ["nr"], tarieven: ["user_id"], instellingen: ["key"], klant_timing: ["project_id", "fase_nr"], prijsvraag_gunningen: ["prijsvraag_id", "post_id"], document_aannemers: ["document_id", "contact_id"], mijn_markeringen: ["user_id", "soort", "sleutel"] };
// 1.48: tabellen gesorteerd op id bladeren met een sleutel (id > laatste) i.p.v. OFFSET — blijft even snel als de tabel groeit
const pagina = (src, t, from, PAGE, na) => { let q = sb.from(src).select("*"); (ORDER_OF[t] || ["id"]).forEach(c => { q = q.order(c, { ascending: true }); });
  if (!ORDER_OF[t]) { if (na != null) q = q.gt("id", na); return q.limit(PAGE); } return q.range(from, from + PAGE - 1); };
async function fetchAllRows(t) {
  const PAGE = 1000; let from = 0, all = [], na = null; let src = srcOf(t);
  for (; ;) {
    let { data, error } = await pagina(src, t, from, PAGE, na);
    if (error && src !== t && /does not exist|42P01|schema cache/i.test(error.message || "")) {
      for (let i = 0; i < 2 && error; i++) { await new Promise(res => setTimeout(res, 1500)); ({ data, error } = await pagina(src, t, from, PAGE, na)); }   // vlak na een databasescript: even opnieuw
      if (error) return { error, prijsFout: true };   // geen prijzen → niets laden i.p.v. bedragen van € 0
      if (error) { S.viewsOk = false; src = t; ({ data, error } = await pagina(src, t, from, PAGE, na)); }
    }
    if (error) return { error };
    all = all.concat(data || []);
    if (!data || data.length < PAGE) return { data: all };
    from += PAGE; na = data[data.length - 1].id;
  }
}
/* 1.72: zware tabellen (veel rijen, niet nodig voor het eerste scherm) komen bij het opstarten pas ná de eerste weergave binnen.
   Overzicht, Taken, Planning, Uren en de projectenlijst staan er zo meteen; de andere schermen tonen heel even "Laden…". */
const ZWAAR = ["documenten", "assistent_berichten", "verwerkingen", "werf_fotos", "werf_updates", "vergadering_punten", "render_beelden", "render_opdrachten", "render_standpunten", "render_presentaties", "render_afspraken", "render_ruimtes", "plan_omzettingen", "ontwerp_feedback", "ontwerp_documenten", "aannemer_meetstaat_posten", "prijsaanvraag_regels", "taak_punten", "document_aannemers", "woningdossier", "tekenplannen", "naservice_gebeurtenissen"];
// 1.72: modules die pas geladen worden wanneer nodig (modules.js); zonder modules.js gewoon doorgaan zoals vroeger
const modOk = (n) => typeof moduleKlaar !== "function" || moduleKlaar(n);
const modLaad = (n) => typeof laadModule === "function" ? laadModule(n) : Promise.resolve();
const ZWAAR_VRIJ =["overzicht", "taken", "planning", "uren"];   // deze schermen wachten niet op de zware tabellen
const zwaarWacht = () => S.zwaarKlaar === false && !(ZWAAR_VRIJ.includes(S.view) || (S.view === "projecten" && !S.project));
async function laadTabellen(lijst) {
  const res = await Promise.all(lijst.map(t => fetchAllRows(t)));
  lijst.forEach((t, i) => { if (res[i].error) { if (res[i].prijsFout) { S.prijsFout = true; return; } if (!OPTIONAL_TABLES.includes(t)) throw res[i].error; } else ingest(t, res[i].data || []); });
}
async function loadAll(opts) {
  S.viewsOk = undefined;   // opnieuw proberen via de views
  S.prijsFout = false;
  // 1.72: stand van het wijzigingenlogboek vóór het laden (wat daarna wijzigt, komt via het logboek). Bij de eerste keer is de
  // schemaversie nog niet gekend (instellingen nog niet geladen) → gewoon proberen; zonder script 065 geeft dat een fout = null.
  const wz = schemaV() >= 65 || !Object.keys(S.instellingen || {}).length ? await wzStand().catch(() => null) : null;
  const gefaseerd = !!(opts && opts.gefaseerd);
  await laadTabellen(Object.keys(TABLES).filter(t => !gefaseerd || !ZWAAR.includes(t)));
  S.me = S.profiles[S.session.user.id] || null;
  // sinds script 012 staan de prijzen enkel in de views: zonder views kloppen de bedragen niet → duidelijk melden
  S.prijsFout = S.prijsFout || S.viewsOk === false;
  if (wz) { S.wzTs = wz; S.wzLokaal = Date.now(); }
  if (gefaseerd) { S.zwaarKlaar = false; zwaarLaden(); } else S.zwaarKlaar = true;
}
async function zwaarLaden() {
  try { await laadTabellen(Object.keys(TABLES).filter(t => ZWAAR.includes(t))); }
  catch (e) { console.warn("Niet alle gegevens geladen:", e && e.message); toast("Niet alle gegevens konden geladen worden — herlaad de pagina als iets ontbreekt.", 6000); }
  S.zwaarKlaar = true; IDX = null; render();
}

/* ---------- 1.72 (script 065): één realtime-kanaal + bijwerken na een pauze via het wijzigingenlogboek ---------- */
// pb_wijzigingen bevat per wijziging enkel tabel, sleutel en soort (I/U/D). Het Planbord haalt dan alleen die rijen op.
const KEYCOL = { loten: "nr", fasen: "nr", tarieven: "user_id", instellingen: "key", verwerker_status: "naam" };
const WZ_MAX = 3000;          // meer wijzigingen sinds de vorige keer → gewoon alles herladen
const WZ_NIEUW = {};          // nieuwe aannemersfacturen: melding na het ophalen
async function wzStand() {
  const { data, error } = await sb.from("pb_wijzigingen").select("ts").order("id", { ascending: false }).limit(1);
  if (error) return null;
  return (data && data[0] && data[0].ts) || "1970-01-01T00:00:00Z";   // leeg logboek: alles wat er (nog) in komt, is nieuw
}
function wzVerwerk(rows) {
  for (const w of rows) {
    if (!w) continue;
    if (w.ts && (!S.wzTs || new Date(w.ts) > new Date(S.wzTs))) { S.wzTs = w.ts; S.wzLokaal = Date.now(); }
    const t = w.tabel; if (!TABLES[t] || !S[t]) continue;
    if (S.bulk) { (S.bulkGemist = S.bulkGemist || new Set()).add(t); continue; }   // tijdens een bulkactie: achteraf de hele tabel (bulkKlaar)
    if (t === "standaardtaken" || w.sleutel === "*") { rtQueue(t, "*"); continue; }
    if (w.op === "D") { if (S[t][w.sleutel] !== undefined) { delete S[t][w.sleutel]; IDX = null; renderSoon(); } if (rtQ[t]) rtQ[t].delete(w.sleutel); continue; }
    if (t === "aannemer_facturen" && w.op === "I") (WZ_NIEUW[t] = WZ_NIEUW[t] || new Set()).add(w.sleutel);
    rtQueue(t, w.sleutel);
  }
}
/** na een pauze: enkel wat er sindsdien wijzigde (met 2 min overlap: dubbel ophalen kan geen kwaad). false = toch alles herladen */
async function wzDelta() {
  if (schemaV() < 65 || !S.wzTs || !S.zwaarKlaar || Date.now() - (S.wzLokaal || 0) > 2 * 864e5) return false;   // logboek bewaart 3 dagen
  const van = new Date(new Date(S.wzTs).getTime() - 120000).toISOString();
  const { data, error } = await sb.from("pb_wijzigingen").select("id,tabel,sleutel,op,ts").gte("ts", van).order("id", { ascending: true }).limit(WZ_MAX);
  if (error || !data || data.length >= WZ_MAX) return false;
  S.wzLokaal = Date.now(); wzVerwerk(data);
  clearTimeout(rtT); await rtFlush(); return true;
}
function subscribe() {
  if (schemaV() >= 65) {   // 1.72: één kanaal voor alles
    const ch = sb.channel("pb-wijzigingen");
    ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "pb_wijzigingen" }, (payload) => wzVerwerk([payload.new]));
    ch.on("system", {}, (msg) => { if (msg && msg.status === "error") console.warn("Realtime niet actief — voer het laatste databasescript uit.", msg.message); });
    ch.subscribe((status) => { if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") { S.rtGemist = true; setTimeout(refetchAll, 3000); } });
  } else
  // Eén kanaal per tabel: als één tabel niet in de realtime-publicatie zit, blijven de andere werken.
  ["profiles", "tarieven", "fasen", "standaardtaken", "projecten", "taken", "uren", "documenten", "loten", "posten", "meetstaat_posten", "meetstaat_prijzen", "vorderingen", ...(isBeheer() ? ["yuki_facturen"] : []), "vordering_regels", "contacten", "project_contacten", "goedkeuringen", "notities", "werfbezoeken", "vaststellingen", "klant_timing", "werfplannen", "werfverslagen", "taak_voorstellen", "assistent_berichten", "prijsaanvragen", "prijsaanvraag_regels", "tekenplannen", "aannemer_meetstaten", "keuzes", "keuze_opties", "meerwerk_aanvragen", "werf_fotos", "werf_updates", "woningdossier", "prijsvragen", "prijsvraag_gunningen", "goedkeuring_tekenaars", "aannemer_facturen", "betaalherinneringen", "fin_plan", "fin_vaste_kosten", "fin_instellingen", "vergaderingen", "vergadering_punten", "verwerkingen", "verwerker_status", "ms_raming", "document_aannemers", "plan_omzettingen", "render_beelden", "render_opdrachten", "render_afspraken", "render_presentaties", "render_ruimtes", "render_standpunten", "taak_punten", "ontwerp_rondes", "ontwerp_documenten", "ontwerp_feedback", ...(schemaV() >= 64 ? ["mijn_markeringen"] : []), ...(schemaV() >= 68 ? ["goedkeuring_aannemers"] : []), ...(schemaV() >= 69 ? ["naservice_punten", "naservice_gebeurtenissen"] : [])].forEach(t => {
    const ch = sb.channel("pb-" + t);
    ch.on("postgres_changes", { event: "*", schema: "public", table: t }, (payload) => {
      if (S.bulk) { (S.bulkGemist = S.bulkGemist || new Set()).add(t === "meetstaat_prijzen" ? "meetstaat_posten" : t); return; }   // tijdens een bulkactie niet per rij herbouwen; erna worden de gemiste tabellen herladen (bulkKlaar)
      if (t === "standaardtaken") { refetch(t); return; }
      if (t === "meetstaat_prijzen") { const pid = (payload.new || payload.old || {}).post_id; if (pid && S.meetstaat_posten[pid]) rtQueue("meetstaat_posten", pid); return; }
      if (VIEW_OF[t] && S.viewsOk !== false) { if (payload.eventType === "DELETE") { delete S[t][rowKey(t, payload.old)]; render(); } else rtQueue(t, rowKey(t, payload.new)); return; }
      if (payload.eventType === "DELETE") { delete S[t][rowKey(t, payload.old)]; }
      else { S[t][rowKey(t, payload.new)] = payload.new; }
      if (t === "aannemer_facturen" && payload.eventType === "INSERT" && payload.new && typeof afbAannemer === "function") toast(`Nieuwe factuur van ${afbAannemer(payload.new)}: ${payload.new.nummer || ""} · ${eur2(payload.new.bedrag_excl)} excl. btw`, 6000);   // 1.49 (script 047)
      IDX = null;
      if (t === "profiles") S.me = S.profiles[S.session.user.id] || S.me;
      renderSoon();   // 1.48: veel wijzigingen na elkaar (Drive-sync, nieuw project) → één keer tekenen per beeld
    });
    ch.on("system", {}, (msg) => { if (msg && msg.status === "error") console.warn("Realtime niet actief voor tabel " + t + " — voer het laatste databasescript uit.", msg.message); });
    ch.subscribe((status) => { if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") { S.rtGemist = true; setTimeout(() => refetch(t), 3000); } });
  });
  // Veiligheidsnet: bij terugkeer naar het tabblad alles verversen — 1.48: enkel na meer dan 2 minuten weg (of na een realtime-fout), niet bij elke korte wissel
  let wegSinds = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { wegSinds = Date.now(); return; }
    if (S.rtGemist || !wegSinds || Date.now() - wegSinds > (schemaV() >= 65 ? 30000 : 120000)) { S.rtGemist = false; refetchAll(); }   // 1.72: bijwerken is nu goedkoop (enkel de wijzigingen) → al na 30 s weg
  });
}
let renderRaf = 0;
function renderSoon() { if (renderRaf) return; renderRaf = requestAnimationFrame(() => { renderRaf = 0; render(); }); }
/* na een bulkactie: tabellen herladen waarvan realtime-wijzigingen (van collega's) tijdens de bulk genegeerd werden */
function bulkKlaar() { S.bulk = false; const t = S.bulkGemist; S.bulkGemist = null; if (t) t.forEach(x => refetch(x)); }
async function refetch(t) { const { data, error } = await fetchAllRows(t); if (!error) { ingest(t, data || []); render(); } }
/* realtime-meldingen voor views bundelen: per tabel één aanvraag (of alles herladen bij veel rijen) i.p.v. één per rij */
const rtQ = {}; let rtT = null;
function rtQueue(t, key) { (rtQ[t] = rtQ[t] || new Set()).add(key); if (!rtT) rtT = setTimeout(rtFlush, 300); }
async function rtFlush() {
  rtT = null; const werk = Object.entries(rtQ).map(([t, keys]) => [t, [...keys]]); Object.keys(rtQ).forEach(k => delete rtQ[k]);
  for (const [t, keys] of werk) {
    try {
      if (keys.includes("*") || keys.length > 60) { const { data, error } = await fetchAllRows(t); if (!error) ingest(t, data || []); continue; }
      const col = KEYCOL[t] || "id"; const { data, error } = await sb.from(srcOf(t)).select("*").in(col, keys);
      if (error) continue;
      const terug = new Set(); (data || []).forEach(r => { const k = rowKey(t, r); S[t][k] = r; terug.add(String(k)); });
      keys.forEach(k => { if (!terug.has(String(k))) delete S[t][k]; });   // 1.72: niet meer terug = verwijderd of niet meer zichtbaar voor jou
      if (WZ_NIEUW[t]) { (data || []).filter(r => WZ_NIEUW[t].has(String(r.id))).forEach(r => { if (t === "aannemer_facturen" && typeof afbAannemer === "function") toast(`Nieuwe factuur van ${afbAannemer(r)}: ${r.nummer || ""} · ${eur2(r.bedrag_excl)} excl. btw`, 6000); }); delete WZ_NIEUW[t]; }
      if (t === "profiles") S.me = S.profiles[S.session.user.id] || S.me;
    } catch (e) { }
  }
  IDX = null; render();
}
/* één rij opnieuw uit de view halen (na een wijziging: verkoopprijs en beheer-kolommen komen zo mee) */
async function rowRefetch(t, key) {
  const col = t === "loten" ? "nr" : "id";
  const { data, error } = await sb.from(srcOf(t)).select("*").eq(col, key).maybeSingle();
  if (!error && data) { S[t][rowKey(t, data)] = data; render(); }
}
async function msRefetch(ids) {
  if (!ids.length) return;
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await sb.from(srcOf("meetstaat_posten")).select("*").in("id", ids.slice(i, i + 100));
    if (!error) (data || []).forEach(r => S.meetstaat_posten[r.id] = r);
  }
  render();
}
async function refetchAll() { try { if (await wzDelta().catch(() => false)) return; await loadAll(); render(); } catch (e) { } }   // 1.72: eerst enkel de wijzigingen

/* ---------- schrijven (optimistisch: eerst lokaal, dan database) ---------- */
async function dbInsert(table, row) {
  const { data, error } = await sb.from(table).insert(row).select().single();
  if (error) { toast("Bewaren mislukt: " + error.message, 5000); error.__toasted = true; throw error; }
  const key = table === "tarieven" ? "user_id" : table === "loten" ? "nr" : "id"; S[table][data[key]] = data; render();
  if (table === "taken" && (data.status === "busy" || data.status === "done") && data.fase_nr != null) faseNa(data.project_id, S.projecten[data.project_id]?.fase_nr).catch(() => { });   // 1.64: fase schuift mee
  if (table === "taken" && typeof afsNaWijziging === "function") afsNaWijziging(null, data);   // afspraak → agenda + mail (afspraken.js, script 041)
  return data;
}
async function dbUpdate(table, id, patch) {
  const key = table === "tarieven" ? "user_id" : table === "loten" ? "nr" : "id";
  const prev = S[table][id]; const vorig = table === "taken" && prev ? { ...prev } : null; const f0 = prev && (table === "taken" || table === "ontwerp_rondes") ? S.projecten[prev.project_id]?.fase_nr : null; S[table][id] = { ...prev, ...patch }; render();
  const { data, error } = await sb.from(table).update(patch).eq(key, id).select().single();
  if (error) { if (prev === undefined) delete S[table][id]; else S[table][id] = prev; render(); toast("Bewaren mislukt: " + error.message, 5000); error.__toasted = true; throw error; }
  S[table][id] = VIEW_OF[table] ? { ...prev, ...data } : data; render();
  if (VIEW_OF[table] && S.viewsOk !== false) rowRefetch(table, id);
  if (vorig && (data.status === "busy" || data.status === "done") && data.fase_nr != null && (data.status !== vorig.status || data.fase_nr !== vorig.fase_nr)) faseNa(data.project_id, f0).catch(() => { });   // 1.64: fase schuift mee
  if (table === "ontwerp_rondes" && prev && prev.status === "concept" && data.status === "gepubliceerd") faseNa(data.project_id, f0).catch(() => { });
  if (table === "taken" && typeof afsNaWijziging === "function") afsNaWijziging(vorig, S[table][id]);   // afspraak gewijzigd (ook via de planning) → agenda + mail
  return data;
}
async function dbUpsert(table, row) {
  const key = table === "tarieven" ? "user_id" : "id";
  const { data, error } = await sb.from(table).upsert(row).select().single();
  if (error) { toast("Bewaren mislukt: " + error.message, 5000); error.__toasted = true; throw error; }
  S[table][data[key]] = data; render(); return data;
}
async function dbDelete(table, id) {
  if (table === "taken" && typeof afsVoorVerwijderen === "function") await afsVoorVerwijderen(S[table][id]);   // afspraak: agenda-item weg + annulering mailen
  const prev = S[table][id]; delete S[table][id]; render();
  const { error } = await sb.from(table).delete().eq("id", id);
  if (error) { if (prev === undefined) delete S[table][id]; else S[table][id] = prev; render(); toast("Verwijderen mislukt: " + error.message, 5000); error.__toasted = true; throw error; }
}


/* ---------- Drive-koppeling (Google Apps Script als brosburo@gmail.com) ---------- */
const driveCfg = () => (S.instellingen.drive && S.instellingen.drive.value) || {};
const schemaV = () => Number(S.instellingen.app?.value?.versie_schema) || 0;   // welk databasescript is al uitgevoerd
const SCHEMA_MIN = 63;   // 1.73: code voor oudere databanken is opgeruimd — het Planbord vraagt minstens script 063
const SCHEMA_HINT = (n) => `<div class="empty" style="padding:10px 12px;margin-bottom:12px"><b>Databasescript ${String(n).padStart(3, "0")} nog niet uitgevoerd</b>Voer <code>sql/${String(n).padStart(3, "0")}_*.sql</code> uit in Supabase om deze functie te activeren.</div>`;
const driveReady = () => !!(driveCfg().url && driveCfg().secret);
/* na uitloggen niets van de vorige gebruiker laten rondslingeren (gedeelde computer) */
function opruimenNaUitloggen() {
  try { Object.keys(localStorage).filter(k => /^bros\.(zoek|fx\.ring)/.test(k)).forEach(k => localStorage.removeItem(k)); } catch (e) { }
  try { Object.keys(sessionStorage).filter(k => /^pb-/.test(k)).forEach(k => sessionStorage.removeItem(k)); } catch (e) { }
}
async function driveCall(action, payload) {
  const c = driveCfg(); if (!c.url) throw new Error("Drive-koppeling niet ingesteld (Instellingen → Drive).");
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(c.url)) throw new Error("De Drive-URL in Instellingen is geen geldige Apps Script-webapp (https://script.google.com/macros/s/…/exec).");
  /* tijdslimiet: een hangend Drive-script mag het Planbord niet eindeloos laten wachten (laadbalk op 92 %) */
  const limiet = ["list", "create", "link", "put", "template", "factuurpdf"].includes(action) ? 90000 : 45000;   // 1.67: factuurpdf kan een projectmap aanmaken
  const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), limiet);
  let j;
  try {
    const r = await fetch(c.url, { method: "POST", body: JSON.stringify({ token: S.session?.access_token || "", ...payload, action, secret: c.secret }), redirect: "follow", signal: ac.signal });
    j = await r.json().catch((e) => { if (e && e.name === "AbortError") throw e; return { ok: false, error: "Onleesbaar antwoord van het Drive-script." }; });
  } catch (e) {
    if (e && e.name === "AbortError") throw new Error(`Het Drive-script antwoordt niet (na ${limiet / 1000} s). Probeer het zo opnieuw; blijft het hangen, kijk dan in de scripteditor bij Uitvoeringen.`);
    throw new Error("Drive-script niet bereikbaar: " + (e && e.message || e));
  } finally { clearTimeout(tm); }
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
/* ---------- Afvinken voelt goed: kleine bevestiging bij elke vink, betekenis (x van y), en zelden een mijlpaal ----------
   Voorkeuren per browser (Dagring in de kopbalk → klik): animaties aan/uit, geluid aan/uit (standaard uit), dagdoel in uren.
   'Minder beweging' in het systeem → geen deeltjes of vul-animatie, enkel rustige meldingen. */
const FX = (() => {
  const reduce = () => !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const pref = (k, d) => { try { const v = localStorage.getItem("bros.fx." + k); return v == null ? d : v === "1"; } catch (e) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem("bros.fx." + k, v ? "1" : "0"); } catch (e) { } };
  const doel = () => { try { const v = Number(localStorage.getItem("bros.fx.doel")); return v >= 1 && v <= 16 ? v : 8; } catch (e) { return 8; } };
  const setDoel = (v) => { try { localStorage.setItem("bros.fx.doel", String(v)); } catch (e) { } };
  let ac = null;
  /* zachte tonen, synthetisch (geen geluidsbestanden): kort en laag volume */
  const toon = (freqs, dur = 0.09, gap = 0.07, vol = 0.05, forceer) => {
    if (!(forceer ?? pref("geluid", false))) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === "suspended") ac.resume();
      const t0 = ac.currentTime + 0.01;
      freqs.forEach((f, i) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = "sine"; o.frequency.value = f; const st = t0 + i * gap;
        g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(vol, st + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, st + dur);
        o.connect(g); g.connect(ac.destination); o.start(st); o.stop(st + dur + 0.03); });
    } catch (e) { }
  };
  const layer = () => { let l = document.getElementById("fxLayer"); if (!l) { l = document.createElement("div"); l.id = "fxLayer"; l.setAttribute("aria-hidden", "true"); document.body.appendChild(l); } return l; };
  const weg = (el, ms) => setTimeout(() => el.remove(), ms);
  function burst(x, y, groot, geluid) {
    if (!pref("aan", true)) return;
    const l = layer();
    if (!reduce()) {
      const ring = document.createElement("i"); ring.className = "fx-ring" + (groot ? " groot" : ""); ring.style.left = x + "px"; ring.style.top = y + "px"; l.appendChild(ring); weg(ring, 750);
      l.insertAdjacentHTML("beforeend", `<svg class="fx-check" viewBox="0 0 24 24" style="left:${x}px;top:${y}px"><path d="M5 12.5l4.2 4.2L19 7"/></svg>`); weg(l.lastElementChild, 950);
      const n = groot ? 14 : 7;
      for (let i = 0; i < n; i++) {
        const p = document.createElement("i"); p.className = "fx-dot" + (groot && i % 3 === 0 ? " alt" : "");
        const a = Math.PI * 2 * i / n + Math.random() * 0.6, d = (groot ? 30 : 18) + Math.random() * (groot ? 28 : 12);
        p.style.left = x + "px"; p.style.top = y + "px"; p.style.setProperty("--dx", (Math.cos(a) * d).toFixed(1) + "px"); p.style.setProperty("--dy", (Math.sin(a) * d).toFixed(1) + "px");
        l.appendChild(p); weg(p, 850);
      }
    }
    toon(groot ? [988, 1319] : [1175], 0.08, 0.06, 0.05, geluid);
  }
  function chip(x, y, html, onder) {
    if (!pref("aan", true)) return false;
    const l = layer(); l.querySelectorAll(".fx-chip").forEach(c => c.remove());
    const c = document.createElement("div"); c.className = "fx-chip"; c.innerHTML = html; l.appendChild(c);
    const w = c.offsetWidth || 200, vw = window.innerWidth;
    const left = onder ? x - w / 2 : x + 16; c.style.left = Math.max(8, Math.min(left, vw - w - 8)) + "px";
    c.style.top = Math.max(8, onder ? y + 18 : y - 15) + "px";
    setTimeout(() => c.classList.add("weg"), 1900); weg(c, 2500); return true;
  }
  function mijlpaal(titel, sub) {
    if (!pref("aan", true)) { toast(titel + (sub ? " — " + sub : "")); return; }
    const l = layer(); l.querySelectorAll(".fx-mijl").forEach(e => e.remove());
    const m = document.createElement("div"); m.className = "fx-mijl" + (reduce() ? " rustig" : ""); m.setAttribute("role", "status");
    m.innerHTML = `<div class="kaart"><div class="logo"><i class="base"></i><i class="fill"></i></div><div class="t">${esc(titel)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ""}</div>`;
    m.onclick = () => m.remove(); l.appendChild(m);
    requestAnimationFrame(() => requestAnimationFrame(() => m.classList.add("in")));
    toon([784, 988, 1175, 1568], 0.24, 0.09, 0.045);
    setTimeout(() => m.classList.add("uit"), 2700); weg(m, 3200);
  }
  return { burst, chip, mijlpaal, pref, setPref, doel, setDoel, toon, reduce };
})();
const fxPick = (a) => a[Math.floor(Math.random() * a.length)];
/* taak t (nog in de oude toestand) wordt nu afgevinkt; el = het aangeklikte vinkje (of null vanuit een formulier) */
function vierTaak(t, el) {
  try {
    const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    const x = r ? r.left + r.width / 2 : window.innerWidth / 2, y = r ? r.top + r.height / 2 : 96;
    const p = S.projecten[t.project_id]; const projTxt = p ? p.klant + (p.naam && p.naam !== p.klant ? " · " + p.naam : "") : "";
    const ts = Object.values(S.taken).filter(x => x.project_id === t.project_id);
    const klaar = (x) => x.id === t.id || x.status === "done";
    const fase = t.fase_nr ? ts.filter(x => x.fase_nr === t.fase_nr) : [];
    const projRond = ts.length >= 2 && ts.every(klaar), faseRond = fase.length >= 2 && fase.every(klaar);
    const verrassing = Math.random() < 1 / 7;   // af en toe net iets meer — zo went het niet
    FX.burst(x, y, verrassing || faseRond || projRond);
    if (projRond) { setTimeout(() => FX.mijlpaal(fxPick(["Alles afgevinkt", "Alle taken afgewerkt"]), `${projTxt} · ${ts.length} taken`), 380); return; }
    if (faseRond) { setTimeout(() => FX.mijlpaal(fxPick([`Fase ${faseShort(t.fase_nr)} rond`, `${faseShort(t.fase_nr)}: afgerond`]), projTxt), 380); return; }
    if (t.assignee === S.me?.id) setTimeout(() => vierWeekritme("taak"), 1500);   // 1.48: na het bewaren (updated_at van de server)
    const basis = fase.length ? fase : ts, n = basis.filter(klaar).length;
    FX.chip(x, y, `${verrassing ? fxPick(["Netjes.", "Goed bezig.", "Weer eentje.", "Mooi zo."]) + " " : ""}<b>${n} van ${basis.length}</b> ${fase.length ? esc(faseShort(t.fase_nr)) : "taken"}${p ? ` · ${esc(p.klant)}` : ""}`);
  } catch (e) { }
}
/* ---------- Dagring: eigen uren van vandaag t.o.v. het dagdoel ---------- */
let RING_LAST = null;
const mijnUrenOp = (datum) => S.me ? Object.values(S.uren).filter(h => h.user_id === S.me.id && h.datum === datum).reduce((s, h) => s + (Number(h.uren) || 0), 0) : 0;
/* ---------- 1.48: Weekritme — je reeks (werkdagen op rij met uren), vijf dagringen per week en kleine onderscheidingen ---------- */
const isWerkdag = (s) => { const w = pd(s).getUTCDay(); return w >= 1 && w <= 5; };
const mijnUrenPerDag = () => (S.me ? idx().mijnDag : {}) || {};   // uit de index (één keer per render opgebouwd, samen met de andere urentotalen)
/* reeks = werkdagen op rij waarop je uren invulde (weekends tellen niet mee; vandaag telt pas mee zodra je iets invulde) */
function reeksInfo(per) {
  per = per || mijnUrenPerDag(); let n = 0, d = todayIso;
  if (!(per[d] > 0)) d = addDays(d, -1);
  for (let i = 0; i < 800; i++) { if (isWerkdag(d)) { if (per[d] > 0) n++; else break; } d = addDays(d, -1); }
  let best = 0; try { best = Number(localStorage.getItem("bros.fx.reeksBest")) || 0; if (n > best) { best = n; localStorage.setItem("bros.fx.reeksBest", String(n)); } } catch (e) { best = Math.max(best, n); }
  return { n, best };
}
function weekInfo() {
  const per = mijnUrenPerDag(), doel = FX.doel(), wk0 = mondayOf(todayIso);
  const dagen = [0, 1, 2, 3, 4].map(i => { const d = addDays(wk0, i); const u = per[d] || 0; return { d, u, pct: Math.min(1, u / doel), rond: u >= doel, toekomst: d > todayIso, vandaag: d === todayIso }; });
  const afgevinkt = S.me ? Object.values(S.taken).filter(t => t.assignee === S.me.id && t.status === "done" && t.updated_at && lokDag(t.updated_at) >= wk0).length : 0;
  const laat = S.me ? Object.values(S.taken).filter(t => t.assignee === S.me.id && t.status !== "done" && isLate(t)).length : 0;
  const r = reeksInfo(per);
  const badges = [
    { k: "week", ok: dagen.every(x => x.rond), t: "Volle week", h: "vijf dagringen rond" },
    { k: "bij", ok: laat === 0, t: "Bij", h: laat ? `${laat} taak${laat === 1 ? "" : "en"} over de datum` : "geen taken over de datum" },
    { k: "opruimer", ok: afgevinkt >= 10, t: "Opruimer", h: `${afgevinkt}/10 taken afgevinkt` },
    { k: "reeks", ok: r.n >= 10, t: "Reeks 10", h: `${r.n}/10 werkdagen op rij` }];
  return { dagen, afgevinkt, laat, reeks: r, badges, uren: dagen.reduce((s, x) => s + x.u, 0), doel };
}
const miniRing = (pct, cls = "") => { const C = 2 * Math.PI * 9; return `<svg class="mr ${cls}" viewBox="0 0 24 24" aria-hidden="true"><circle class="bg" cx="12" cy="12" r="9"/><circle class="fg" cx="12" cy="12" r="9" style="stroke-dasharray:${C.toFixed(2)};stroke-dashoffset:${(C * (1 - pct)).toFixed(2)}"/></svg>`; };
const DAGKORT = ["ma", "di", "wo", "do", "vr"];
function vWeekkaart() {
  if (!S.me || !FX.pref("aan", true)) return "";
  const w = weekInfo(); const behaald = w.badges.filter(b => b.ok).length;
  return `<div class="panel weekkaart" data-act="dagring" title="Jouw week — klik voor je dagdoel">
    <div class="wk-l"><div class="eyebrow">Jouw week</div>
      <div class="wk-dagen">${w.dagen.map((x, i) => `<div class="wk-dag ${x.rond ? "rond" : ""} ${x.toekomst ? "later" : ""} ${x.vandaag ? "nu" : ""}">${miniRing(x.pct)}<span>${DAGKORT[i]}</span><small class="num">${x.u ? nl(x.u) : "·"}</small></div>`).join("")}</div></div>
    <div class="wk-m"><div class="wk-reeks"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c.6 3-1.4 4.6-2.7 6.2C7.8 10.5 7 12 7 14a5 5 0 0 0 10 0c0-2.2-1.2-3.6-2-4.6-.3 1.4-1 2.3-2 2.6.6-2.8.4-6.2-1-9.5z"/></svg><b class="num">${w.reeks.n}</b><span>werkdag${w.reeks.n === 1 ? "" : "en"} op rij${w.reeks.best > w.reeks.n ? ` · beste ${w.reeks.best}` : w.reeks.n >= 2 ? " · je record" : ""}</span></div>
      <div class="muted" style="font-size:12.5px">${nl(w.uren)} van ${nl(w.doel * 5)} u · ${w.afgevinkt} ta${w.afgevinkt === 1 ? "ak" : "ken"} afgevinkt</div></div>
    <div class="wk-r"><div class="wk-badges">${w.badges.map(b => `<span class="wk-badge ${b.ok ? "ok" : ""}" title="${esc(b.h)}">${b.ok ? "✓ " : ""}${esc(b.t)}</span>`).join("")}</div><div class="muted" style="font-size:11.5px;margin-top:4px">${behaald} van ${w.badges.length} deze week</div></div>
  </div>`;
}
/* na een volle dagring of een afgevinkte taak: grotere momenten (één keer per moment) */
function vierWeekritme(soort) {
  try {
    const w = weekInfo(); const eens = (k) => { try { if (localStorage.getItem("bros.fx.m." + k)) return false; localStorage.setItem("bros.fx.m." + k, "1"); return true; } catch (e) { return true; } };
    const wk = mondayOf(todayIso);
    if (soort === "uren" && w.dagen.every(x => x.rond) && eens("week." + wk)) { FX.mijlpaal("Volle week", "vijf dagringen rond · week " + weekNr(todayIso)); return true; }
    if (soort === "uren" && [5, 10, 20, 40, 60, 100].includes(w.reeks.n) && eens("reeks." + w.reeks.n + "." + todayIso)) { FX.mijlpaal(`${w.reeks.n} werkdagen op rij`, w.reeks.n >= w.reeks.best ? "je langste reeks tot nu toe" : "je uren elke dag ingevuld"); return true; }
    if (soort === "taak" && w.afgevinkt >= 10 && eens("opruimer." + wk)) { setTimeout(() => FX.mijlpaal("Opruimer", "10 taken afgevinkt deze week"), 400); return true; }
  } catch (e) { }
  return false;
}
function dagRing() {
  if (!S.me || !S.ready) return "";
  const u = mijnUrenOp(todayIso), doel = FX.doel(), pct = Math.min(1, u / doel);
  const van = FX.reduce() ? pct : (RING_LAST == null ? 0 : RING_LAST); RING_LAST = pct;
  const C = 2 * Math.PI * 9;
  return `<button class="dagring ${pct >= 1 ? "vol" : ""}" type="button" data-act="dagring" title="Vandaag ${nl(u)} van ${nl(doel)} u ingevuld — klik voor je dagdoel en de instellingen" aria-label="Uren vandaag: ${nl(u)} van ${nl(doel)}"><svg viewBox="0 0 24 24"><circle class="bg" cx="12" cy="12" r="9"/><circle class="fg" cx="12" cy="12" r="9" style="--c:${C.toFixed(2)};--van:${(C * (1 - van)).toFixed(2)};--naar:${(C * (1 - pct)).toFixed(2)}"/></svg><span>${nl(u)} u</span>${(() => { const r = FX.pref("aan", true) ? reeksInfo() : { n: 0 }; return r.n >= 2 ? `<span class="reeks-b" title="${r.n} werkdagen op rij je uren ingevuld">${r.n}</span>` : ""; })()}</button>`;
}
/* na het bewaren van een (nieuwe) urenregistratie; voor = eigen uren vandaag vóór het bewaren */
function vierUren(row, voor) {
  if (!S.me || row.user_id !== S.me.id || row.datum !== todayIso) return false;
  const el = document.querySelector('[data-act="dagring"]'); const r = el ? el.getBoundingClientRect() : null;
  const x = r ? r.left + r.width / 2 : window.innerWidth - 140, y = r ? r.top + r.height / 2 : 30;
  const na = mijnUrenOp(todayIso), doel = FX.doel(); let al = false;
  try { al = localStorage.getItem("bros.fx.ring." + todayIso) === "1"; } catch (e) { }
  FX.burst(x, y, false);
  if (voor < doel && na >= doel && !al) {
    try { localStorage.setItem("bros.fx.ring." + todayIso, "1"); } catch (e) { }
    setTimeout(() => { if (!vierWeekritme("uren")) FX.mijlpaal(fxPick(["Je dag zit erop", "Dagring rond"]), `${nl(na)} u ingevuld vandaag`); }, 500); return true;
  }
  return FX.chip(x, y, `+${nl(row.uren)} u · <b>${nl(na)} van ${nl(doel)} u</b> vandaag`, true);
}
function dagForm() {
  const u = mijnUrenOp(todayIso); const per = {};
  Object.values(S.uren).filter(h => h.user_id === S.me.id && h.datum === todayIso).forEach(h => { const k = h.project_id || ""; per[k] = (per[k] || 0) + (Number(h.uren) || 0); });
  const lijst = Object.entries(per).sort((a, b) => b[1] - a[1]).map(([pid, n]) => `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line)"><span>${esc(S.projecten[pid]?.klant || "Algemeen")}</span><span class="num">${nl(n)} u</span></div>`).join("");
  openModal("Jouw dag", `<div class="form-grid">
    <div class="field span2"><div style="font-size:28px;font-weight:700;font-family:var(--font-display)" class="num">${nl(u)} <span class="muted" style="font-size:16px;font-weight:500">van ${nl(FX.doel())} u vandaag</span></div>${(() => { const r = reeksInfo(); return r.n ? `<div class="muted" style="font-size:13px;margin-top:2px">Reeks: <b>${r.n}</b> werkdag${r.n === 1 ? "" : "en"} op rij je uren ingevuld${r.best > r.n ? ` · beste ${r.best}` : ""}</div>` : ""; })()}${lijst ? `<div style="margin-top:8px;font-size:13px">${lijst}</div>` : `<p class="muted" style="margin:6px 0 0">Nog geen uren ingevuld vandaag.</p>`}</div>
    <div class="field"><label for="fx_doel">Dagdoel (uren)</label><input id="fx_doel" name="doel" type="number" min="1" max="16" step="0.5" value="${FX.doel()}"><small class="muted">De ring sluit als je dit haalt — één keer per dag een klein feestje.</small></div>
    <div class="field"></div>
    <div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" name="fx_aan" ${FX.pref("aan", true) ? "checked" : ""}><span><b>Animaties bij afvinken en uren</b><small class="muted" style="display:block">Vinkje, voortgang (x van y) en af en toe een mijlpaal: fase rond, project rond, dagring rond.</small></span></label></div>
    <div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" name="fx_geluid" ${FX.pref("geluid", false) ? "checked" : ""}><span><b>Zacht geluid</b><small class="muted" style="display:block">Een korte tik bij elke vink en een akkoord bij een mijlpaal. Enkel op dit toestel.</small></span></label></div>
    <div class="field span2" style="display:block"><button type="button" class="btn sm" data-act="fx-demo" style="width:auto">Even proberen</button></div>
  </div>`, {
    saveLabel: "Bewaren", onSave: async (d) => {
      const f = $("#mform"); FX.setPref("aan", f.querySelector('[name="fx_aan"]').checked); FX.setPref("geluid", f.querySelector('[name="fx_geluid"]').checked);
      const v = Number(String(d.doel || "").replace(",", ".")); if (v >= 1 && v <= 16) FX.setDoel(v);
      render(); toast("Bewaard");
    },
  });
}
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
    if (error) toast("Documenten niet bewaard: " + error.message);
    else {
      (data || []).forEach(d => S.documenten[d.id] = d);
      // 1.48: verdwenen bestanden echt opruimen — enkel als de Drive-lijst volledig was (geen limiet geraakt) en nooit een document waar een factuur, overeenkomst of woningdossier naar verwijst
      const gebruikt = new Set([...Object.values(S.vorderingen || {}).map(v => v.factuur_document), ...Object.values(S.woningdossier || {}).map(w => w.document_id), ...Object.values(S.goedkeuringen || {}).flatMap(g => [g.document_id, g.getekend_document])].filter(Boolean));
      const weg = j.volledig === true && rows.length ? Object.values(S.documenten).filter(d => d.project_id === p.id && !rows.some(r => r.drive_id === d.drive_id) && !gebruikt.has(d.id)) : [];
      if (weg.length) { const { error: e2 } = await sb.from("documenten").delete().in("id", weg.map(d => d.id)); if (e2) toast("Verdwenen bestanden niet opgeruimd: " + e2.message); else weg.forEach(d => delete S.documenten[d.id]); }
    }
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
/* Delen: de schakelaar springt meteen om en wordt meteen bewaard; de Drive-rechten (link leesbaar) volgen op de achtergrond.
   Zolang dat loopt, staat de schakelaar van dat bestand even vast (geen dubbele klikken die elkaar kruisen). */
const DOC_BUSY = new Set();
async function docShare(id, on, wie = "klant") {
  const d = S.documenten[id]; if (!d) return;
  if (DOC_BUSY.has(id)) { render(); return; }
  const veld = wie === "aannemers" ? "gedeeld_aannemers" : "gedeeld";
  // de link moet leesbaar zijn zolang het bestand met iemand (klant of aannemers) gedeeld is
  const wasLink = !!d.gedeeld || !!d.gedeeld_aannemers;
  const andere = wie === "aannemers" ? !!d.gedeeld : !!d.gedeeld_aannemers; const linkAan = on || andere;
  DOC_BUSY.add(id);
  try { await dbUpdate("documenten", id, { [veld]: on }); }
  catch (e) { DOC_BUSY.delete(id); render(); return; }
  try {
    if (driveReady() && linkAan !== wasLink) await driveCall("share", { fileId: d.drive_id, on: linkAan, token: S.session?.access_token || "" });
    toast(on ? (wie === "aannemers" ? "Gedeeld met de aannemers van dit project" : "Gedeeld met de klant") : "Niet meer gedeeld" + (wie === "aannemers" ? " met de aannemers" : " met de klant"));
  } catch (e) {
    if (on) { await dbUpdate("documenten", id, { [veld]: false }).catch(() => { }); toast("Niet gedeeld — de Drive-link kon niet opengezet worden: " + e.message, 7000); }
    else toast("Niet meer gedeeld in het portaal, maar de Drive-link staat mogelijk nog open: " + e.message, 7000);
  } finally { DOC_BUSY.delete(id); render(); }
}
const docsOf = (pid) => Object.values(S.documenten).filter(d => d.project_id === pid).sort((a, b) => (a.pad || "").localeCompare(b.pad || "") || a.naam.localeCompare(b.naam));
/* 1.56 (script 053): een document deel je bewust met gekozen aannemers — een aannemer ziet enkel wat met hém gedeeld is */
const docPerAannemer = () => !!S.document_aannemers;
const docAannOf = (did) => Object.values(S.document_aannemers || {}).filter(x => x.document_id === did).map(x => x.contact_id);
const projAannemers = (pid) => contactsOf(pid).filter(x => x.rol !== "bouwheer" && x.rol !== "contactpersoon").filter((x, i, a) => a.findIndex(y => y.c.id === x.c.id) === i);
function docAannForm(id) {
  const d = S.documenten[id]; if (!d) return; const lijst = projAannemers(d.project_id); const nu = new Set(docAannOf(id));
  openModal("Delen met aannemers · " + d.naam, `<p class="muted" style="margin-top:0">Kies met welke aannemers je dit bestand deelt. Een aannemer ziet enkel de bestanden die met hém gedeeld zijn — niet met wie je ze nog deelt, en niet wie er nog aan het project werkt. Wie later aan het project gekoppeld wordt, ziet ze niet vanzelf.</p><p class="muted" style="font-size:12px">Let op: het portaal opent het bestand via de Drive-link. Haal je een aannemer weg, dan verdwijnt het uit zijn portaal, maar wie de link bewaarde kan hem blijven openen zolang het bestand nog met iemand gedeeld is.</p>
    ${lijst.length ? `<div class="fase-list" id="da_lijst">${lijst.map(x => `<label class="chk"><input type="checkbox" name="da" value="${x.c.id}" ${nu.has(x.c.id) ? "checked" : ""}> <span>${esc(x.c.naam)}<small class="muted" style="display:block">${esc(CONTACT_ROL[x.rol] || x.rol)}${x.c.vakgebied ? " · " + esc(x.c.vakgebied) : ""}${x.c.user_id ? "" : " · nog geen toegang tot het portaal"}</small></span></label>`).join("")}</div>
      <div style="display:flex;gap:8px;margin-top:8px"><button type="button" class="btn sm" data-da-alle="1">Alles aanvinken</button><button type="button" class="btn sm ghost" data-da-alle="0">Niemand</button></div>`
      : `<div class="empty" style="padding:16px"><b>Nog geen aannemers bij dit project</b>Koppel ze eerst via Dossier › Contacten.</div>`}
    <p class="muted" style="font-size:12px">Nieuw gedeelde bestanden worden gebundeld gemeld: elke aannemer krijgt enkel een mail over zijn eigen bestanden.</p>`, {
    saveLabel: "Bewaren",
    onSave: async () => {
      const gekozen = [...$("#mform").querySelectorAll('input[name="da"]:checked')].map(i => i.value);
      const d = S.documenten[id]; if (!d) return; const nu = new Set(docAannOf(id));   // vers: een collega kan intussen gedeeld hebben
      const bij = gekozen.filter(c => !nu.has(c)), af = [...nu].filter(c => !gekozen.includes(c));
      if (!bij.length && !af.length) return;
      if (DOC_BUSY.has(id)) { toast("Even geduld — dit bestand wordt nog gedeeld."); return false; }
      const wasLink = !!d.gedeeld || !!d.gedeeld_aannemers; const linkAan = !!d.gedeeld || gekozen.length > 0;
      DOC_BUSY.add(id);
      try {
        // eerst de Drive-link openzetten (anders zou de aannemer een bestand zien dat hij niet kan openen)
        if (driveReady() && linkAan && !wasLink) await driveCall("share", { fileId: d.drive_id, on: true, token: S.session?.access_token || "" });
        if (af.length) { const { error } = await sb.from("document_aannemers").delete().eq("document_id", id).in("contact_id", af); if (error) throw error; af.forEach(c => delete S.document_aannemers[id + "|" + c]); }
        if (bij.length) { const { data, error } = await sb.from("document_aannemers").upsert(bij.map(c => ({ document_id: id, contact_id: c })), { onConflict: "document_id,contact_id", ignoreDuplicates: true }).select(); if (error) throw error; [].concat(data || []).forEach(r => S.document_aannemers[r.document_id + "|" + r.contact_id] = r); }
        S.documenten[id] = { ...S.documenten[id], gedeeld_aannemers: gekozen.length > 0 };
        if (driveReady() && !linkAan && wasLink) await driveCall("share", { fileId: d.drive_id, on: false, token: S.session?.access_token || "" }).catch(e => toast("Niet meer gedeeld in het portaal, maar de Drive-link staat mogelijk nog open: " + e.message, 7000));
        toast(gekozen.length ? `Gedeeld met ${gekozen.length} aannemer${gekozen.length === 1 ? "" : "s"}` : "Met geen enkele aannemer meer gedeeld");
      } catch (e) { toast("Niet bewaard: " + (e.message || e), 7000); refetch("document_aannemers"); refetch("documenten"); return false; }
      finally { DOC_BUSY.delete(id); render(); }
    },
  });
  $("#mform").querySelectorAll("[data-da-alle]").forEach(b => b.onclick = () => $("#mform").querySelectorAll('input[name="da"]').forEach(i => { i.checked = b.dataset.daAlle === "1"; }));
}


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
    <div class="field"><label for="c_taal">Taal portaal en mails</label><select id="c_taal" name="taal">${opts([["nl", "Nederlands"], ["en", "English"]], c.taal || "nl")}</select></div>
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
      const row = { soort: d.soort, naam: d.naam.trim(), bedrijf: (d.bedrijf || "").trim(), contactpersoon: (d.contactpersoon || "").trim(), klanttype: d.klanttype || "particulier", btw_nummer: (d.btw_nummer || "").trim(), email: (d.email || "").trim(), email2: (d.email2 || "").trim(), gsm: telFmt(d.gsm), tel: telFmt(d.tel), adres: (d.adres || "").trim(), postcode: (d.postcode || "").trim(), gemeente: (d.gemeente || "").trim(), vakgebied: (d.vakgebied || "").trim(), loten: [...$("#mform").querySelectorAll('input[name="lot"]:checked')].map(i => Number(i.value)), notities: d.notities || "", updated_at: new Date().toISOString(), ...(d.taal ? { taal: d.taal === "en" ? "en" : "nl" } : {}) };
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
    ${driveReady() ? `<div class="field span2 lc-mail"><label class="chk"><input type="checkbox" name="mail" checked> <span>Verwittigen per mail — <span class="muted">de partij krijgt een mail dat ze aan dit project gekoppeld is (met de loten en de notitie); zonder portaallogin zit de uitnodiging voor het aannemersportaal erbij</span></span></label></div>` : ""}
  </div>`, {
    saveLabel: "Koppelen", wide: true,
    onSave: async (d) => {
      if (!d.contact_id) { toast("Kies een contact."); return false; }
      if (present.has(d.contact_id + "|" + d.rol)) { toast("Dit contact is al met die rol gekoppeld."); return false; }
      const row = { project_id: pid, contact_id: d.contact_id, rol: d.rol, intern: ROL_INTERN[d.rol] !== false, loten: [...$("#mform").querySelectorAll('input[name="lot"]:checked')].map(i => Number(i.value)), notitie: (d.notitie || "").trim() };
      const mail = !!$("#mform").querySelector('input[name="mail"]:checked'); const c = S.contacten[d.contact_id];
      const nieuw = await dbInsert("project_contacten", row);
      if (mail && !KLANT_ROLLEN.includes(d.rol) && c && c.soort !== "klant" && driveReady()) {
        if (!c.email) { toast("Contact gekoppeld — niet gemaild: geen e-mailadres bij dit contact.", 6000); return; }
        loader.start("pc.mail", "Aannemer verwittigen…", 6000);
        try { const j = await driveCall("koppelmail", { id: nieuw.id, token: S.session?.access_token || "" }); loader.done("pc.mail"); toast(`Contact gekoppeld en gemaild naar ${j.naar || c.email}${j.uitgenodigd ? " (met uitnodiging voor het aannemersportaal)" : ""}`, 6000); if (S.project_contacten[nieuw.id]) S.project_contacten[nieuw.id].verwittigd_op = new Date().toISOString(); }
        catch (e) { loader.fail(); toast("Contact gekoppeld, maar mailen mislukte: " + e.message, 8000); }
      } else toast("Contact gekoppeld");
    },
  });
  const form = $("#mform"); const sel = $("#lc_c"), q = $("#lc_q"), rolSel = $("#lc_rol");
  const sync = () => { const soort = soortFor(rolSel.value); const qq = q.value.trim().toLowerCase(); let first = null;
    [...sel.options].forEach(o => { const c = S.contacten[o.value]; const hit = (!qq || o.textContent.toLowerCase().includes(qq)) && (!soort || c.soort === soort || qq); o.hidden = !hit; if (hit && !first) first = o; });
    if (![...sel.selectedOptions].some(o => !o.hidden) && first) first.selected = true;
    form.querySelectorAll(".field.lot").forEach(el => el.style.display = ["aannemer", "leverancier", "studiebureau"].includes(rolSel.value) ? "" : "none");
    form.querySelectorAll(".field.lc-mail").forEach(el => el.style.display = KLANT_ROLLEN.includes(rolSel.value) ? "none" : ""); };
  q.addEventListener("input", sync); rolSel.addEventListener("change", sync); sync();
  form.querySelector("[data-act=contact-new-inline]").onclick = () => { const rolNow = rolSel.value; if (!closeModal()) return; contactForm({ soort: soortFor(rolNow) || "andere" }, () => linkContactForm(pid, rolNow)); };
}
/* portaalkolom bij een contact: toegang geven (beheer, via het Drive-script), status en laatste bezoek */
const KLANT_ROLLEN = ["bouwheer", "contactpersoon"];
function portaalCel(x) {
  const c = x.c; const klantRol = KLANT_ROLLEN.includes(x.rol); const rol = klantRol ? "klant" : "aannemer";
  if (!klantRol && c.soort === "klant") return `<span class="muted">—</span>`;
  const lbl = klantRol ? "" : `<small class="muted" style="display:block">aannemersportaal</small>`;
  const verw = x.verwittigd_op ? `<small class="muted" style="display:block">verwittigd ${fmtLong(lokDag(x.verwittigd_op))}</small>` : "";
  if (c.user_id) return `<span class="pill st-afgerond">actief</span>${lbl}<small class="muted" style="display:block">${c.portaal_login ? "laatst " + fmtLong(lokDag(c.portaal_login)) : "nog niet ingelogd"}</small>${verw}${isBeheer() && driveReady() ? `<button class="btn ghost sm" data-act="portaal-invite" data-cid="${c.id}" data-pid="${x.project_id}" data-rol="${rol}" title="Nieuwe link om (opnieuw) een wachtwoord te kiezen">Link opnieuw sturen</button>` : ""}`;
  if (!c.email) return `<span class="muted">geen e-mail</span>`;
  if (!isBeheer()) return `<span class="muted">geen toegang</span>`;
  return driveReady() ? `<button class="btn sm" data-act="portaal-invite" data-cid="${c.id}" data-pid="${x.project_id}" data-rol="${rol}">${klantRol ? "Portaal-toegang geven" : "Aannemersportaal"}</button>${verw}` : `<span class="muted">Drive-script nodig</span>`;
}
function portaalInviteForm(cid, pid, rol = "klant") {
  const c = S.contacten[cid], p = S.projecten[pid]; if (!c || !p) return;
  const opnieuw = !!c.user_id; const aan = rol === "aannemer";
  const nProj = Object.values(S.project_contacten).filter(x => x.contact_id === cid && (aan ? !KLANT_ROLLEN.includes(x.rol) : KLANT_ROLLEN.includes(x.rol))).length;
  openModal(opnieuw ? "Portaallink opnieuw sturen" : aan ? "Toegang tot het aannemersportaal geven" : "Portaal-toegang geven", `<div class="form-grid">
    <div class="field span2"><p style="margin:0">${opnieuw ? `<b>${esc(c.naam)}</b> heeft al toegang. We sturen een nieuwe mail met een link om een (nieuw) wachtwoord te kiezen.` : `<b>${esc(c.naam)}</b> krijgt een e-mail van BROS (archief@bros.be) met een persoonlijke link naar het ${aan ? "aannemersportaal" : "klantenportaal"}. Daar kiest hij/zij een wachtwoord en ziet daarna het project <b>${esc(p.klant)}${p.naam && p.naam !== p.klant ? " · " + esc(p.naam) : ""}</b>${nProj > 1 ? ` (en de andere projecten waar dit contact aan gekoppeld is${aan ? "" : " als bouwheer of contactpersoon"})` : ""}.`}</p></div>
    <div class="field"><label for="pi_email">E-mailadres</label><input id="pi_email" name="email" type="email" required value="${esc(c.email)}"></div>
    <div class="field"><label for="pi_naam">Aanspreking in de mail</label><input id="pi_naam" name="naam" value="${esc(c.contactpersoon || c.naam)}"></div>
    <div class="field span2"><p class="muted" style="margin:0;font-size:12px">${aan ? "Wat de aannemer ziet: enkel zijn eigen projecten en loten — de vaststellingen die aan hem toegewezen zijn (opgelost melden met bewijsfoto), de werfplannen, de verslagen die hij ontving, documenten met de schakelaar 'aannemers', de gedeelde planning, de prijsaanvragen die jullie hem sturen en — als jullie die delen — de meetstaat met zijn eigen prijzen ter goedkeuring. Nooit kostprijzen, marges, klantprijzen of prijzen van andere aannemers. Vragen die hij stelt komen als voorstel in de wachtrij." : "Wat de klant ziet: meetstaat met verkoopprijzen, facturen, planning, gedeelde documenten en het team. Geen kostprijzen, marges, forfait of interne notities. De uren van een taak zijn enkel zichtbaar als de schakelaar Klant bij die taak aanstaat."}</p></div>
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
  const rows = contactsOf(p.id); const beheer = isBeheer(); const v11 = true;
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Contacten bij dit project</h3><div class="muted" style="font-size:12px;margin-top:2px">Bouwheer en contactpersonen zijn zichtbaar voor de klant in het portaal; aannemers, leveranciers en studiebureaus zijn intern en zien in het aannemersportaal enkel hun eigen projecten en loten.</div></div>
      <div class="actions"><button class="btn sm" data-act="contact-link" data-pid="${p.id}" data-rol="aannemer">+ Aannemer</button><button class="btn sm" data-act="contact-link" data-pid="${p.id}" data-rol="leverancier">+ Leverancier</button><button class="btn sm" data-act="contact-link" data-pid="${p.id}" data-rol="contactpersoon">+ Contact</button></div></div>
    ${rows.length ? `<div class="tw"><table class="t"><thead><tr><th>Rol</th><th>Contact</th><th>E-mail · GSM</th><th>Loten</th><th>Zichtbaar</th>${v11 ? `<th>Portaal</th>` : ""}<th></th></tr></thead><tbody>
      ${rows.map(x => `<tr class="click" data-contact="${x.c.id}"><td><span class="pill ${x.rol === "bouwheer" ? "st-lopend" : x.intern ? "st-on_hold" : "st-offerte"}">${CONTACT_ROL[x.rol] || x.rol}</span></td><td><div class="row-title">${esc(x.c.naam)}<small>${[x.c.bedrijf && x.c.bedrijf !== x.c.naam ? x.c.bedrijf : "", x.c.contactpersoon, x.c.vakgebied].filter(Boolean).map(esc).join(" · ")}${x.notitie ? " · " + esc(x.notitie) : ""}</small></div></td>
        <td style="font-size:12px">${x.c.email ? `<a href="mailto:${esc(x.c.email)}">${esc(x.c.email)}</a>` : ""}${x.c.gsm ? `<br><a href="tel:${esc(x.c.gsm)}">${esc(x.c.gsm)}</a>` : ""}</td><td class="muted" style="font-size:12px">${(x.loten || []).map(l => esc(lotName(l))).join("<br>") || "—"}</td><td class="muted" style="font-size:12px">${x.intern ? "intern" : "klant + intern"}</td>
        ${v11 ? `<td style="font-size:12px">${portaalCel(x)}</td>` : ""}
        <td class="r"><button class="btn ghost sm danger" data-act="contact-unlink" data-id="${x.id}" aria-label="Ontkoppelen">✕</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><b>Nog geen contacten gekoppeld</b>Koppel de bouwheer, aannemers en leveranciers van dit project.</div>`}</div>`;
}

/* 1.72: meetstaat → meetstaat.js · notities, werf, werfverslagen, assistent → werf.js · goedkeuringen en facturatie → facturatie.js */
/* ---------- render root ---------- */
const TABS = [["overzicht", "Overzicht"], ["mijnwerk", "Mijn werk"], ["projecten", "Projecten"], ["aankoop", "Facturen", "beheer"], ["taken", "Taken"], ["planning", "Planning"], ["uren", "Uren"], ["contacten", "Contacten"], ["notities", "Notities"], ["voorstellen", "Voorstellen"], ["team", "Team"], ["rapporten", "Rapporten"], ["instellingen", "Instellingen", "beheer"]];
const ACCT_TABS = ["team", "instellingen"];   // 1.51: in het accountmenu (wacht.js) i.p.v. de bovenbalk
const factTeDoen = () => (typeof afbTeDoen === "function" ? afbTeDoen().length : 0) + (typeof debTeDoen === "function" ? debTeDoen().length : 0) + (typeof yukiTeDoen === "function" ? yukiTeDoen() : 0);   // 1.66: + Yuki-koppeling   // 1.50: badge op Facturen
let renderPending = false;
function render() {
  // niet herbouwen terwijl iemand in een inline-veld typt (realtime-update van een collega zou de invoer wissen); zoekvelden regelen hun eigen focus
  const a = document.activeElement;
  if (a && a.classList && a.classList.contains("inline") && !a.hasAttribute("data-noteq") && !a.hasAttribute("data-werff") && !a.hasAttribute("data-filter") && !a.hasAttribute("data-cfilter") && !a.hasAttribute("data-projq") && $("#app").contains(a)) { renderPending = true; return; }
  if (typeof uwBezig === "function" && uwBezig()) { renderPending = true; return; }   // 1.69: niet hertekenen terwijl er een urenblok gesleept wordt
  renderPending = false; refreshToday(); buildIndex();
  const app = $("#app");
  if (!configured) { app.innerHTML = `<div class="login"><div class="card"><h1>BROS Planbord</h1><p>De app is nog niet gekoppeld aan de database. Vul <code>config.js</code> in (Project URL en anon public-sleutel uit Supabase) en herlaad.</p></div></div>`; return; }
  if (!S.session) { renderLogin(); return; }
  if (S.setPassword) { renderSetPassword(); return; }
  if (S.loadError) { app.innerHTML = `<div class="login"><div class="card"><h1>Kon de gegevens niet laden</h1><p class="err">${esc(S.loadError)}</p><button class="btn" data-act="logout">Uitloggen</button> <button class="btn primary" data-act="reload">Opnieuw proberen</button></div></div>`; return; }
  if (!S.ready) { app.innerHTML = `<div class="login"><div class="card"><h1>BROS Planbord</h1><p>Gegevens laden…</p></div></div>`; return; }
  if (!S.me) { app.innerHTML = `<div class="login"><div class="card"><h1>Nog geen profiel</h1><p>Je login werkt, maar er is nog geen medewerkersprofiel gekoppeld. Vraag de beheerder om je uit te nodigen, of herlaad de pagina.</p><button class="btn" data-act="logout">Uitloggen</button> <button class="btn primary" data-act="reload">Herladen</button></div></div>`; return; }
  if (schemaV() < SCHEMA_MIN) { app.innerHTML = `<div class="login"><div class="card"><h1>Databank bijwerken</h1><p>Deze versie van het Planbord heeft minstens databasescript ${String(SCHEMA_MIN).padStart(3, "0")} nodig (nu: ${schemaV() ? String(schemaV()).padStart(3, "0") : "onbekend"}). Voer de scripts in de map <code>sql/</code> uit in Supabase (SQL Editor), in volgorde, en herlaad.</p><button class="btn" data-act="logout">Uitloggen</button> <button class="btn primary" data-act="reload">Herladen</button></div></div>`; return; }   // 1.73
  const views = { overzicht: vOverzicht, mijnwerk: (typeof vMijnWerk === "function" ? vMijnWerk : vOverzicht), projecten: vProjecten, taken: vTaken, planning: vPlanning, uren: vUren, contacten: vContacten, notities: vNotitiesAlle, voorstellen: vVoorstellen, aankoop: (typeof vFactuurTab === "function" ? vFactuurTab : typeof vAankoop === "function" ? vAankoop : vOverzicht), team: vTeam, rapporten: vRapporten, instellingen: vInstellingen, naservice: (typeof vNaserviceAlle === "function" ? vNaserviceAlle : vOverzicht) };   // 1.77: naservice   // 1.50: aankoop = tabblad Facturen (klanten + aannemers)
  // 1.48.3: horizontale/verticale scrollpositie van tabellen (.tw, bv. de vorderingsstaat) bewaren bij het hertekenen — anders springt de tabel terug naar links
  const acctI = typeof acctFocusIndex === "function" ? acctFocusIndex() : -1;   // 1.51: focus in het accountmenu bewaren
  const scrollSleutel = [S.view, S.project, S.ptab].join("|"); const scrolls = app.dataset.scroll === scrollSleutel ? [...app.querySelectorAll(".tw")].map(e => [e.scrollLeft, e.scrollTop]) : [];
  app.innerHTML = `
  <header class="top">
    <div class="top-in">
      <div class="brand"><span class="mark">BROS</span><span class="name">Planbord</span></div>
      <nav class="tabs" aria-label="Hoofdnavigatie">${TABS.filter(([, , r]) => !r || isBeheer()).filter(([k]) => typeof acctMenu !== "function" || !ACCT_TABS.includes(k)).filter(([k]) => k !== "aankoop" || ((typeof vAankoop === "function"))).filter(([k]) => typeof navMeer !== "function" || !MEER_TABS.includes(k)).map(([k, l]) => `<button data-nav="${k}" ${S.view === k ? 'aria-current="page"' : ""}>${l}${k === "voorstellen" && voorstellenOpen().length ? ` <span class="cnt" style="background:var(--crit);color:#fff">${voorstellenOpen().length}</span>` : ""}${k === "mijnwerk" && typeof mwTeller === "function" && mwTeller() ? ` <span class="cnt" style="background:var(--crit);color:#fff" title="te laat">${mwTeller()}</span>` : ""}${k === "aankoop" && factTeDoen() ?` <span class="cnt" style="background:var(--crit);color:#fff">${factTeDoen()}</span>` : ""}</button>`).join("")}</nav>${typeof navMeer === "function" ? navMeer() : ""}
      <div class="who"><button class="zk-knop" type="button" data-act="zoek" title="Snel zoeken — ⌘K of /"><span>⌕</span><span class="zk-lbl">Zoeken</span><kbd>${/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl "}K</kbd></button>${dagRing()}${typeof acctMenu === "function" ? acctMenu() : `<span class="who-cell">${avatar(S.me.id)}<span style="font-weight:600">${esc(S.me.name)}</span></span>${typeof tmKnop === "function" ? tmKnop() : ""}<button class="btn ghost sm" data-act="change-password" title="Wachtwoord wijzigen">Wachtwoord</button><button class="btn ghost sm" data-act="logout" title="Uitloggen">Uitloggen</button>`}</div>
    </div>
    <div class="update" id="updateBar"><span>Er is een nieuwe versie van het Planbord.</span><button class="btn sm primary" data-act="reload">Nu herladen</button><button class="btn sm ghost" data-act="update-later">Later</button></div>
  </header>
  ${typeof gsmBalk === "function" ? gsmBalk() : ""}
  <main>${zwaarWacht() ? `<div class="panel" style="margin-top:24px"><div class="empty"><b>Laden…</b><span class="muted">nog even de documenten, verslagen en beelden ophalen</span></div></div>` : (views[S.view] || vOverzicht)()}</main>
  <footer>BROS Planbord v${APP_VERSION}</footer>`;
  app.dataset.scroll = scrollSleutel;
  if (scrolls.length) app.querySelectorAll(".tw").forEach((e, i) => { const k = scrolls[i]; if (k && (k[0] || k[1])) { e.scrollLeft = k[0]; e.scrollTop = k[1]; } });
  if (updateAvailable) $("#updateBar").classList.add("show");
  if (acctI >= 0 && typeof acctFocus === "function") acctFocus(acctI);
  if (typeof vgNaRender === "function") vgNaRender();   // 1.54: de vaste opnamespeler verbergen buiten de vergadering
  if (typeof uitlegInklappen === "function") uitlegInklappen();   // 1.71: lange uitleg in panelen achter een ⓘ
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
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: false } });
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
/* 1.48: het Drive-script laat elk uur een hartslag achter (onderhoud: Supabase wakker houden, back-up, bewaking); valt die stil, dan zie je het hier */
function hartslagMelding() {
  if (!isBeheer()) return "";
  const h = S.instellingen && S.instellingen.hartslag && S.instellingen.hartslag.value; if (!h || !h.drive) return "";   // nog geen script 1.48 online: niets tonen
  const uur = (Date.now() - new Date(h.drive).getTime()) / 3600000; if (!(uur > 6)) return "";
  return `<div class="notice" style="margin-bottom:16px;border-color:var(--warn)"><b>Het Drive-script draait niet meer</b> — laatste teken van leven ${fmtLong(lokDag(h.drive))} om ${lokUur(h.drive)}. Daardoor gebeuren mails, de back-up en het wakker houden van de database niet. Open het script (script.google.com, als brosburo@gmail.com) en voer <code>onderhoudInstall</code> uit; vraagt Google om toestemming, geef die dan opnieuw.</div>`;
}
function vOverzicht() {
  const ps = projects(), lopend = ps.filter(p => p.status === "lopend");
  const ts = Object.values(S.taken), open = ts.filter(t => t.status !== "done"), late = open.filter(isLate);
  const wk0 = mondayOf(todayIso), wk1 = addDays(wk0, 6);
  const weekHours = hoursOf(h => h.datum >= wk0 && h.datum <= wk1), mijnWeek = hoursOf(h => h.user_id === S.me.id && h.datum >= wk0 && h.datum <= wk1);
  const mijnOpen = open.filter(t => t.assignee === S.me.id), mijnLaat = mijnOpen.filter(isLate).length;   // 1.70: tegels voor jezelf, het team klein eronder
  const wj = typeof vWachtOpJou === "function";   // 1.51: wat al in "Wacht op jou" staat (te laat, vandaag en morgen) niet nog eens tonen
  const mineVol = open.filter(t => t.assignee === S.me.id && !(wj && wjInLijst(t))).sort((a, b) => (a.eind || "9").localeCompare(b.eind || "9")), mineAll = mineVol.length, mine = mineVol.slice(0, 10);
  return `
  <div class="page-head"><div><div class="eyebrow">Week ${weekNr(todayIso)} · ${fmtLong(todayIso)}</div><h1>Overzicht</h1></div>
    <div class="actions"><button class="btn" data-act="new-task">+ Taak</button><button class="btn" data-act="log-hours">+ Uren</button>${isBeheer() ? `<button class="btn primary" data-act="new-project">+ Project</button>` : ""}</div></div>
  ${typeof vWachtOpJou === "function" ? vWachtOpJou() : ""}
  <div class="grid kpi" style="margin-bottom:16px">
    <div class="panel kpi-tile kpi-klik" data-nav="projecten" role="button" tabindex="0" title="Naar Projecten"><div class="eyebrow">Lopende projecten</div><div class="v">${lopend.length}<small>/ ${ps.length}</small></div><div class="d">${ps.filter(p => p.status === "offerte").length} in offerte</div></div>
    <div class="panel kpi-tile kpi-klik" data-nav="taken" role="button" tabindex="0" title="Naar Taken"><div class="eyebrow">Mijn open taken</div><div class="v">${mijnOpen.length}</div><div class="d">${mijnOpen.filter(t => t.status === "busy").length} bezig · team ${open.length}</div></div>
    <div class="panel kpi-tile ${mijnLaat ? "crit" : ""}${typeof vWachtOpJou === "function" ? " kpi-klik" : ""}" ${typeof vWachtOpJou === "function" ? `data-wj-act="naar-laat" role="button" tabindex="0" title="Naar de te late taken"` : ""}><div class="eyebrow">Te laat</div><div class="v">${mijnLaat}</div><div class="d">van jou · team ${late.length}</div></div>
    <div class="panel kpi-tile kpi-klik" data-nav="uren" role="button" tabindex="0" title="Naar Uren"><div class="eyebrow">Mijn uren deze week</div><div class="v">${nl(mijnWeek)}<small>u</small></div><div class="d">wk ${weekNr(todayIso)} · team ${nl(weekHours)} u</div></div>
  </div>
  ${hartslagMelding()}${vWeekkaart()}
  <div class="grid two">
    <div class="panel" id="mijn-taken"><div class="panel-head"><h3>${wj ? "Mijn volgende taken" : "Mijn taken"}${mineAll > mine.length ? ` <span class="muted" style="font-size:12px;font-weight:400">${mine.length} van ${mineAll}</span>` : ""}</h3><button class="btn ghost sm" data-nav="taken">Alle taken →</button></div>
      ${mine.length ? `<div class="tw"><table class="t"><thead><tr><th></th><th>Taak</th><th>Project</th><th>Deadline</th><th class="r">Uren</th><th>Status</th></tr></thead><tbody>${mine.map(t => taskRow(t, true)).join("")}</tbody></table></div>` : `<div class="empty"><b>${wj ? "Niets meer gepland voor jou" : "Niets open voor jou"}</b>${wj ? "Wat te laat is of vandaag en morgen valt, staat hierboven bij Wacht op jou." : "Maak een taak aan of laat er een aan jou toewijzen."}</div>`}
    </div>
    <div class="panel"><div class="panel-head"><h3>Uren per project</h3><span class="muted" style="font-size:12px">gepresteerd / gepland · ${nl(weekHours)} u deze week</span></div>
      <div class="panel-body" style="display:grid;gap:12px">
      ${lopend.concat(ps.filter(p => p.status === "offerte")).map(p => ({ p, pl: projPlanned(p.id), dn: projDone(p.id), wk: hoursOf(h => h.project_id === p.id && h.datum >= wk0 && h.datum <= wk1) })).filter(x => x.pl > 0 || x.wk > 0).sort((a, b) => b.wk - a.wk || b.dn - a.dn).slice(0, 8).map(({ p, pl, dn }) => { const pct = pl ? Math.min(dn / pl, 1) * 100 : 0; return `
        <div><div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px"><button class="btn ghost sm" style="padding-left:0" data-open="${p.id}">${esc(projName(p))}</button><span class="num">${nl(dn)} / ${nl(pl)} u</span></div><div class="bar"><i class="${dn > pl && pl ? "over" : ""}" style="width:${pct}%"></i></div></div>`; }).join("") || `<div class="empty">Nog geen geplande of gepresteerde uren.</div>`}
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
/* 1.75: tabblad Projecten toont standaard enkel "In offerte" en "Lopend"; de andere statussen vink je aan (onthouden per browser) */
const PROJ_ZICHT_STD = ["offerte", "lopend"];
function projZicht() {
  if (S.projZicht) return S.projZicht;
  let v = null; try { v = JSON.parse(localStorage.getItem("bros.proj.zicht") || "null"); } catch (e) { }
  S.projZicht = Array.isArray(v) ? v.filter(k => PROJ_STATUS[k]) : PROJ_ZICHT_STD.slice(); return S.projZicht;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("[data-projzicht]"); if (!b) return; e.preventDefault();
  const k = b.dataset.projzicht; let z = projZicht().slice();
  z = k === "*" ? PROJ_ZICHT_STD.slice() : z.includes(k) ? z.filter(x => x !== k) : z.concat(k);
  S.projZicht = z; try { localStorage.setItem("bros.proj.zicht", JSON.stringify(z)); } catch (x) { } render();
});
function vProjecten() {
  if (S.project && S.projecten[S.project]) return vProjectDetail(S.projecten[S.project]);
  const beheer = isBeheer();
  const zicht = projZicht(); const alle = projects(); const nSt = (k) => alle.filter(p => p.status === k).length;
  const std = zicht.length === PROJ_ZICHT_STD.length && PROJ_ZICHT_STD.every(k => zicht.includes(k));
  const ps = alle.filter(p => zicht.includes(p.status)).map(p => { const ts = tasksOf(p.id); const [st, en] = projSpan(p); return { p, ts, pl: projPlanned(p.id), dn: projDone(p.id), st, en }; });
  const STATUS_ORDER = { offerte: 0, lopend: 1, on_hold: 2, afgerond: 3, verloren: 4 };
  const val = (r, k) => ({ nummer: r.p.nummer || "", klant: (r.p.klant || "").toLowerCase(), status: STATUS_ORDER[r.p.status] ?? 9, fase: r.p.fase_nr || 0, lead: userById(r.p.lead).name.toLowerCase(), timing: r.st || "9999", forfait: Number(r.p.forfait) || 0, taken: r.ts.length, uren: r.dn })[k];
  const { key, dir } = S.sort; const m = dir === "asc" ? 1 : -1;
  ps.sort((a, b) => { const x = val(a, key), y = val(b, key); return (x < y ? -1 : x > y ? 1 : 0) * m || (a.p.klant || "").localeCompare(b.p.klant || ""); });
  const th = (k, label, cls = "") => `<th class="sortable ${cls} ${key === k ? "on" : ""}" data-sort="${k}">${label}<span class="arrow">${key === k ? (dir === "asc" ? "↑" : "↓") : ""}</span></th>`;
  return `
  <div class="page-head"><div><div class="eyebrow">${ps.length === alle.length ? ps.length + " projecten" : ps.length + " van " + alle.length + " projecten"}</div><h1>Projecten</h1></div>
    <div class="actions">${beheer ? `<button class="btn primary" data-act="new-project">+ Nieuw project</button>` : ""}</div></div>
  <div class="mw-chips proj-zicht" role="group" aria-label="Welke projecten tonen">${Object.entries(PROJ_STATUS).map(([k, v]) => `<button type="button" data-projzicht="${k}" aria-pressed="${zicht.includes(k)}" title="${zicht.includes(k) ? "Verbergen" : "Ook tonen"}">${v} <span class="cnt">${nSt(k)}</span></button>`).join("")}${std ? "" : `<button type="button" class="proj-zicht-std" data-projzicht="*" title="Terug naar In offerte en Lopend">standaard</button>`}</div>
  <div class="panel tw"><table class="t"><thead><tr>${th("nummer", "Nr")}${th("klant", "Klant · project")}${th("status", "Status")}${th("fase", "Fase")}${th("lead", "Lead")}${th("timing", "Timing")}${beheer ? th("forfait", "Forfait", "r") : ""}${th("taken", "Taken", "r")}<th class="sortable ${key === "uren" ? "on" : ""}" data-sort="uren" style="min-width:140px">Uren<span class="arrow">${key === "uren" ? (dir === "asc" ? "↑" : "↓") : ""}</span></th></tr></thead><tbody>
  ${ps.map(({ p, ts, pl, dn, st, en }) => `<tr class="click" data-open="${p.id}">
    <td class="num muted">${esc(p.nummer || "")}</td>
    <td><div class="row-title">${esc(p.klant)}${p.drive_url ? ` <a class="drive-ico" href="${esc(safeUrl(p.drive_url))}" target="_blank" rel="noopener" title="Projectmap openen in Google Drive">📁</a>` : ""}<small>${KLANTCODE[p.klanttype] || ""}${p.naam && p.naam !== p.klant ? " · " + esc(p.naam) : ""}${p.gemeente ? " · " + esc(p.gemeente) : ""}</small></div></td>
    <td>${projStatusKnop(p)}</td>
    <td><span class="pill phase">${esc(faseName(p.fase_nr) || "—")}</span></td>
    <td>${p.lead ? avatar(p.lead) : "—"}</td>
    <td class="num">${fmt(st)} → ${fmt(en)}</td>
    ${beheer ? `<td class="r num">${eur(p.forfait)}</td>` : ""}
    <td class="r num">${ts.filter(t => t.status === "done").length}/${ts.length}</td>
    <td><div class="num" style="font-size:12px;margin-bottom:3px">${nl(dn)} / ${nl(pl)} u</div><div class="bar"><i class="${dn > pl && pl ? "over" : ""}" style="width:${pl ? Math.min(dn / pl, 1) * 100 : 0}%"></i></div></td></tr>`).join("") || `<tr><td colspan="9"><div class="empty">${alle.length ? `<b>Geen projecten met deze status</b>Vink hierboven aan welke projecten je wilt zien.` : `<b>Nog geen projecten</b>${beheer ? "Maak het eerste project aan met de knop rechtsboven." : "De beheerder maakt projecten aan."}`}</div></td></tr>`}
  </tbody></table></div>`;
}
function vProjectDetail(p) {
  const ts = tasksOf(p.id), pl = projPlanned(p.id), dn = projDone(p.id);
  const [st, en] = projSpan(p);
  const tabs = [["taken", "Taken"], ["notities", "Notities" + (notesOf(p.id).length ? ` <span class="cnt">${notesOf(p.id).length}</span>` : "")], ["meetstaat", "Meetstaat"], ["facturatie", "Facturatie"], ["werf", "Werf" + (vsOf(p.id).some(v => v.status === "open") ? ` <span class="cnt">${vsOf(p.id).filter(v => v.status === "open").length}</span>` : "")], ["tekenen", "Plannen"]].concat((typeof vKeuzes === "function") ? [["keuzes", "Keuzes" + (kzOf(p.id).filter(k => k.status === "gekozen").length ? ` <span class="cnt">${kzOf(p.id).filter(k => k.status === "gekozen").length}</span>` : "")]] : []).concat([["planning", "Planning"], ["uren", "Uren"], ["dossier", "Dossier"]]).concat([["vragen", "Vragen" + (voorstellenOpen().some(v => v.project_id === p.id) ? ` <span class="cnt" style="background:var(--crit);color:#fff">${voorstellenOpen().filter(v => v.project_id === p.id).length}</span>` : "")]]);
  if (typeof vVergaderingen === "function") { const nC = vgOf(p.id).filter(v => v.status === "controle").length; tabs.splice(1, 0, ["vergaderingen", "Vergaderingen" + (nC ? ` <span class="cnt">${nC}</span>` : "")]); }   // 1.54 (script 051)
  { const i = tabs.findIndex(t => t[0] === "tekenen"); const nB = Object.values(S.render_opdrachten || {}).filter(o => o.project_id === p.id && (o.status === "wachtrij" || o.status === "bezig")).length;   /* 1.72: renders.js wordt pas bij het openen geladen */ tabs.splice(i >= 0 ? i + 1 : tabs.length, 0, ["renders", "Renders" + (nB ? ` <span class="cnt">${nB}</span>` : "")]); }   // 1.59: renders (renders.js, script 055)
  if (typeof vOntwerp === "function" && typeof oOk === "function" && oOk() && !p.intern) { const i = tabs.findIndex(t => t[0] === "meetstaat"); const nO = oOpenFb(p.id).length; tabs.splice(i >= 0 ? i : tabs.length, 0, ["ontwerp", "Ontwerp" + (nO ? ` <span class="cnt">${nO}</span>` : "")]); }   // 1.63: ontwerptraject + Budgetkompas (ontwerp.js, script 059)
  if (typeof vNaservice === "function" && typeof nsKlaar === "function" && nsKlaar() && !p.intern) { const i = tabs.findIndex(t => t[0] === "werf"); const nN = nsTeller(p.id); tabs.splice(i >= 0 ? i + 1 : tabs.length, 0, ["naservice", "Naservice" + (nN ? ` <span class="cnt" style="background:var(--crit);color:#fff">${nN}</span>` : p.voorlopig_opgeleverd_op && !p.definitief_opgeleverd_op ? ` <span class="cnt">●</span>` : "")]); }   // 1.77: naservice (naservice.js, script 069)
  if (p.intern && typeof vgIntern === "function") tabs.unshift(["intern", "Overzicht"]);
  let body = "";
  if (S.ptab === "taken") {
    const byFase = {}; ts.forEach(t => { (byFase[t.fase_nr || 0] = byFase[t.fase_nr || 0] || []).push(t); });
    const groups = Object.keys(byFase).map(Number).sort((a, b) => a - b);
    body = `<div class="panel"><div class="panel-head"><h3>Taken</h3><div class="actions"><button class="btn sm" data-act="add-fase" data-pid="${p.id}">+ Fase toevoegen</button><button class="btn sm primary" data-act="new-task" data-pid="${p.id}">+ Taak</button></div></div>
      ${ts.length ? `<div class="tw"><table class="t"><thead><tr><th></th><th>Taak</th><th>Wie</th><th>Start</th><th>Einde</th><th class="r">Uren</th><th>Status</th></tr></thead><tbody>
      ${groups.map(nr => { const g = byFase[nr]; const done = g.filter(t => t.status === "done").length; return `<tr><td colspan="7" style="background:var(--surface-2);font-weight:700;font-family:var(--font-display)">${esc(faseName(nr) || "Zonder fase")} <span class="muted num" style="font-weight:400">${done}/${g.length}</span></td></tr>` + g.map(t => `<tr class="click" data-edit-task="${t.id}"><td style="width:28px"><input type="checkbox" class="task-check" data-toggle="${t.id}" ${t.status === "done" ? "checked" : ""} aria-label="Klaar"></td>
        <td><div class="row-title">${esc(t.titel)}${klantTag(t)}${t.notitie ? `<small>${esc(t.notitie)}</small>` : ""}</div></td><td>${wieCell(t)}</td>
        <td class="num">${fmt(t.start)}</td><td class="num" style="color:${isLate(t) ? "var(--crit)" : "inherit"}">${fmt(t.eind)}</td><td class="r num">${nl(taskDone(t.id))} / ${nl(t.uren_gepland)}</td><td>${pill(t)}</td></tr>`).join(""); }).join("")}</tbody></table></div>` : `<div class="empty"><b>Nog geen taken</b>Voeg een fase toe (met de standaardtaken) of maak een losse taak.</div>`}</div>`;
  } else if (S.ptab === "notities") {
    body = vNotities(p);
  } else if (S.ptab === "vergaderingen" && typeof vVergaderingen === "function") {   // 1.54: vergaderingen & opnames (vergaderingen.js, script 051)
    body = vVergaderingen(p);
  } else if (S.ptab === "intern" && p.intern && typeof vgIntern === "function") {
    body = vgIntern(p);
  } else if (S.ptab === "meetstaat") {
    body = vMeetstaat(p);
  } else if (S.ptab === "facturatie") {
    body = vFacturatie(p);
  } else if (S.ptab === "werf") {
    body = vWerf(p);
  } else if (S.ptab === "naservice" && typeof vNaservice === "function") {   // 1.77: naservice (naservice.js, script 069)
    body = vNaservice(p);
  } else if (S.ptab === "tekenen") {   // tekenmodule (tekenen.js) — NIET verwijderen bij een update
    // 1.72: tekenmodule + Plan2CAD worden geladen wanneer je dit tabblad opent (modules.js, groep "teken")
    body = !modOk("teken") ? moduleLaden("Tekenmodule") : (typeof p2cSectie === "function" ? p2cSectie(p) : "") + (typeof vTekenen === "function" ? vTekenen(p) : "");   // 1.57: Plannen omzetten met Plan2CAD (plan2cad.js, script 054) boven de tekenmodule — niet verwijderen
  } else if (S.ptab === "renders") {   // 1.59: renders (renders.js, script 055) — 1.72: geladen bij het openen
    body = modOk("renders") && typeof vRenders === "function" ? vRenders(p) : moduleLaden("Renders");
  } else if (S.ptab === "ontwerp" && typeof vOntwerp === "function") {   // 1.63: ontwerptraject + Budgetkompas (ontwerp.js, script 059)
    body = vOntwerp(p);
  } else if (S.ptab === "keuzes") {   // klantenportaal fase 2 (kp-beheer.js)
    body = typeof vKeuzes === "function" ? vKeuzes(p) : "";
  } else if (S.ptab === "vragen") {
    body = vVragenProject(p);
  } else if (S.ptab === "planning") {
    body = ganttHtml([p], { expanded: true, title: "Timing " + p.klant }) + vKlantTiming(p);
  } else if (S.ptab === "uren") {
    const byTask = ts.map(t => ({ t, d: taskDone(t.id) })).filter(x => x.d > 0 || x.t.uren_gepland > 0 || x.t.status === "done");
    const byUser = users().map(u => ({ u, d: hoursOf(h => h.project_id === p.id && h.user_id === u.id) })).filter(x => x.d > 0);
    const logs = Object.values(S.uren).filter(h => h.project_id === p.id).sort((a, b) => b.datum.localeCompare(a.datum) || String(b.tijd_van || "").localeCompare(String(a.tijd_van || ""))).slice(0, 30);
    const v10 = true;
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
    body = vProjectContacten(p) + (typeof vOvereenkomsten === "function" ? vOvereenkomsten(p) : "") + (typeof vWoningdossier === "function" ? vWoningdossier(p) : "") + `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Projectmap op Google Drive</h3><div class="muted" style="font-size:12px;margin-top:2px"><span class="drive-path">${esc(map)}</span></div></div>
      <div class="actions">${p.drive_url ? `<a class="btn" href="${esc(safeUrl(p.drive_url))}" target="_blank" rel="noopener">Open map in Drive ↗</a><button class="btn sm" data-act="drive-list" data-pid="${p.id}">Vernieuwen</button>` : driveReady() ? `<button class="btn sm" data-act="drive-link" data-pid="${p.id}">Bestaande map koppelen</button><button class="btn sm primary" data-act="drive-create" data-pid="${p.id}">Map aanmaken uit sjabloon</button>` : `<span class="pill st-offerte">Drive-koppeling nog niet ingesteld</span>`}</div></div>
      ${docs.length ? `<div class="panel-body"><p class="muted" style="font-size:12px;margin:0 0 10px">Schakelaars bij een bestand: <b>klant</b> = zichtbaar in het klantenportaal${docPerAannemer() ? `, <b>aannemers</b> = zichtbaar voor de aannemers die je kiest (elk ziet enkel wat met hem gedeeld is)` : `, <b>aannemers</b> = zichtbaar voor de aannemers van dit project in hun portaal`} (het bestand wordt dan leesbaar via de link). ${docs.filter(d => d.gedeeld).length} met de klant, ${docs.filter(d => d.gedeeld_aannemers).length} met aannemers gedeeld.</p><div class="docs">${groups.map(g => `${g ? `<div style="grid-column:1/-1" class="eyebrow">${esc(g)}</div>` : ""}${docs.filter(d => (d.pad || "") === g).map(d => `<div class="doc-wrap ${d.gedeeld ? "shared" : ""}"><a class="doc" href="${esc(safeUrl(d.url))}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit"><div class="ico ${docIcon(d.mime, d.naam)}">${docIcon(d.mime, d.naam) === "map" ? "DOC" : docIcon(d.mime, d.naam).toUpperCase()}</div><div style="min-width:0"><div class="n" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.naam)}</div><div class="s">${d.gewijzigd ? "gewijzigd " + fmtLong(d.gewijzigd.slice(0, 10)) : ""}${d.gedeeld ? ` · <span style="color:var(--ok)">klant</span>` : ""}${d.gedeeld_aannemers ? ` · <span style="color:var(--ok)">${docPerAannemer() ? (docAannOf(d.id).length === 1 ? "1 aannemer" : docAannOf(d.id).length + " aannemers") : "aannemers"}</span>` : ""}</div></div></a><label class="sw-lbl" title="${d.gedeeld ? "Gedeeld met de klant" : "Delen met de klant"}"><input type="checkbox" class="sw" data-dshare="${d.id}" ${d.gedeeld ? "checked" : ""} ${DOC_BUSY.has(d.id) ? "disabled" : ""} aria-label="Delen met de klant"><small>klant</small></label>${docPerAannemer() ? `<button type="button" class="btn sm ${docAannOf(d.id).length ? "" : "ghost"} doc-aann" data-act="doc-aann" data-id="${d.id}" ${DOC_BUSY.has(d.id) ? "disabled" : ""} title="${docAannOf(d.id).length ? "Gedeeld met: " + esc(docAannOf(d.id).map(c => S.contacten[c]?.naam || "?").join(", ")) + " — klik om te wijzigen" : "Delen met gekozen aannemers"}">${docAannOf(d.id).length ? "aannemers · " + docAannOf(d.id).length : "+ aannemers"}</button>` : `<label class="sw-lbl" title="${d.gedeeld_aannemers ? "Gedeeld met de aannemers van dit project" : "Delen met de aannemers van dit project"}"><input type="checkbox" class="sw" data-dshare-a="${d.id}" ${d.gedeeld_aannemers ? "checked" : ""} ${DOC_BUSY.has(d.id) ? "disabled" : ""} aria-label="Delen met aannemers"><small>aannemers</small></label>`}</div>`).join("")}`).join("")}</div>
        <p class="muted" style="font-size:12px;margin:12px 0 0">Laatst gesynchroniseerd ${docs[0].gesynct_op ? fmtLong(lokDag(docs[0].gesynct_op)) + " " + lokUur(docs[0].gesynct_op) : "—"}${S.driveAuto && S.driveAuto[p.id] && Date.now() - S.driveAuto[p.id] < 15000 ? " · wordt vernieuwd…" : ""}. Bij het openen van dit tabblad wordt de lijst automatisch vernieuwd als ze ouder is dan een uur; anders via "Vernieuwen"; foto's en video's worden niet opgesomd (die open je via de map).</p></div>` : `<div class="empty">${p.drive_url ? "Nog geen bestanden gevonden — klik op Vernieuwen." : "Nog geen map gekoppeld. \"Bestaande map koppelen\" zoekt in PROJECTEN naar een map met de naam uit het veld Drive-map (of de klantnaam)."}</div>`}</div>
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
    <div class="actions">${projStatusKnop(p)}${p.drive_url ? `<a class="btn" href="${esc(safeUrl(p.drive_url))}" target="_blank" rel="noopener" title="Projectmap openen in Google Drive">📁 Drive-map ↗</a>` : (driveReady() ? `<button class="btn" data-act="drive-link" data-pid="${p.id}" title="Bestaande map op Drive koppelen of zoeken">📁 Drive-map koppelen</button>` : "")}${isBeheer() ? `<button class="btn" data-act="edit-project" data-pid="${p.id}">Bewerken</button>` : ""}<button class="btn" data-act="log-hours" data-pid="${p.id}">+ Uren</button>${msReady() && !msRows(p.id).length ? `<button class="btn" data-act="ms-open" data-pid="${p.id}" title="Meetstaat aanmaken: loten en posten kiezen">+ Meetstaat</button>` : ""}<button class="btn primary" data-act="new-task" data-pid="${p.id}">+ Taak</button></div></div>
  <div class="pmeta">
    ${faseName(p.fase_nr) || (!p.intern) ? `<span>${faseName(p.fase_nr) ? `<span class="k">Fase</span> ${esc(faseName(p.fase_nr))}` : ""}${!p.intern ? ` <span class="fase-klant-k" title="${esc(faseBron(p))}">${faseName(p.fase_nr) ? "· " : ""}klant ziet <b>${esc(klantStap(p))}</b></span>` : ""}</span>` : ""}
    ${p.lead ? `<span><span class="k">Lead</span> <span class="who-cell">${avatar(p.lead)}${esc(userById(p.lead).name)}</span></span>` : ""}
    ${st || en ? `<span><span class="k">Timing</span> <span class="num">${st && en ? fmtLong(st) + " → " + fmtLong(en) : st ? "vanaf " + fmtLong(st) : "tot " + fmtLong(en)}</span></span>` : ""}
    ${isBeheer() && Number(p.forfait) ? `<span><span class="k">Forfait</span> <span class="num">${eur(p.forfait)}</span></span>` : ""}
    ${pl || dn ? `<span><span class="k">Uren</span> <span class="num">${nl(dn)} / ${nl(pl)} u</span></span>` : ""}
    ${ts.length ? `<span><span class="k">Taken</span> <span class="num">${ts.filter(t => t.status === "done").length} / ${ts.length}</span></span>` : ""}
    ${p.klanttype === "zakelijk" && p.bedrijf ? `<span><span class="k">Bedrijf</span> ${esc(p.bedrijf)}${p.btw_nummer ? ` <span class="num muted">${esc(p.btw_nummer)}</span>` : ""}</span>` : ""}
    ${p.contact || p.gsm1 || p.email1 ? `<span><span class="k">Contact</span> ${esc(p.contact || "")}${p.gsm1 ? ` <a href="tel:${esc(p.gsm1)}">${esc(p.gsm1)}</a>` : ""}${p.gsm2 ? ` · <a href="tel:${esc(p.gsm2)}">${esc(p.gsm2)}</a>` : ""}${[["email1", "factuur_email1"], ["email2", "factuur_email2"]].filter(([e]) => p[e]).map(([e, f]) => ` <a href="mailto:${esc(p[e])}">${esc(p[e])}</a>${p[f] ? ` <span class="pill st-offerte" style="font-size:10px">facturatie</span>` : ""}`).join("")}</span>` : ""}
  </div>
  ${typeof projGroepNav === "function" ? projGroepNav(tabs) : `<div class="subtabs">${tabs.map(([k, l]) => `<button data-ptab="${k}" aria-current="${S.ptab === k}">${l}</button>`).join("")}</div>`}
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
    <select data-filter="project"><option value="">Alle projecten</option>${projects().slice().sort((a, b) => (a.klant || "").localeCompare(b.klant || "", "nl", { sensitivity: "base" })).map(p => `<option value="${p.id}" ${f.project === p.id ? "selected" : ""}>${esc(p.klant)}</option>`).join("")}</select>
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
    <div class="actions"><select data-filter="project"><option value="">Alle projecten</option>${projects().slice().sort((a, b) => (a.klant || "").localeCompare(b.klant || "", "nl", { sensitivity: "base" })).map(p => `<option value="${p.id}" ${S.filters.project === p.id ? "selected" : ""}>${esc(p.klant)}</option>`).join("")}</select><button class="btn primary" data-act="new-task">+ Taak</button></div></div>
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
      <div class="legend">${users().map(u => `<span><i style="background:${safeColor(u.color)}"></i>${esc(u.name)}</span>`).join("")}<span><i style="background:var(--today)"></i>vandaag</span></div></div>
    <div class="gantt-scroll"><div class="gantt-in">
      <div class="g-label"><div class="g-head" style="display:flex;align-items:center;padding:0 12px"><span class="eyebrow">${fmt(start)} → ${fmt(end)}</span></div>${rows.map(r => r.label).join("")}</div>
      <div><div class="g-head" style="width:${days * dw}px">${months}${weeks}</div>
        <div class="g-body" style="width:${days * dw}px"><div class="g-grid">${grid}</div>${rows.map(r => r.body).join("")}${rows.length ? "" : `<div class="g-row"><div class="g-empty">Geen projecten om te tonen.</div></div>`}</div></div>
    </div></div></div>`;
}

/* ---------- Uren ---------- */
/* 1.69: Uren = weekagenda (uren-week.js); "Lijst" is de vroegere weergave hieronder */
function vUren() { return typeof vUrenWeek === "function" ? vUrenWeek() : vUrenLijst(""); }
function vUrenLijst(extra) {
  const u = S.hoursUser || S.me.id, ws = S.weekStart, we = addDays(ws, 6);
  const entries = Object.values(S.uren).filter(h => h.user_id === u && h.datum >= ws && h.datum <= we).sort((a, b) => a.datum.localeCompare(b.datum) || String(a.tijd_van || "").localeCompare(String(b.tijd_van || "")));
  const perDay = Array.from({ length: 7 }, (_, i) => { const d = addDays(ws, i); return { d, sum: entries.filter(h => h.datum === d).reduce((s, h) => s + Number(h.uren || 0), 0) }; });
  const tot = perDay.reduce((s, x) => s + x.sum, 0);
  const perProj = projects().map(p => ({ p, d: entries.filter(h => h.project_id === p.id).reduce((s, h) => s + Number(h.uren || 0), 0) })).filter(x => x.d > 0);
  const allTot = users().map(x => ({ u: x, d: hoursOf(h => h.user_id === x.id && h.datum >= ws && h.datum <= we) }));
  return `
  <div class="page-head"><div><div class="eyebrow">Urenregistratie</div><h1>Uren</h1></div>
    <div class="actions">${extra || ""}<select data-hours-user>${users().map(x => `<option value="${x.id}" ${x.id === u ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
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
/* tekst die met = + - @ begint, voert Excel uit als formule: een ' ervoor maakt er gewone tekst van */
const csvVeilig = (v) => { const t = String(v ?? ""); return /^[=+\-@\t\r]/.test(t) && !/^-?\d+([.,]\d+)?$/.test(t) ? "'" + t : t; };
function exportHours() {
  const rows = Object.values(S.uren).sort((a, b) => a.datum.localeCompare(b.datum));
  const head = ["Datum", "Week", "Van", "Tot", "Medewerker", "Projectnummer", "Klant", "Project", "Fase", "Taak", "Uren", "Zichtbaar klant", "Notitie"];
  const lines = [head.join(";")].concat(rows.map(h => { const p = S.projecten[h.project_id] || {}, t = S.taken[h.taak_id] || {}; return [fmtLong(h.datum), weekNr(h.datum), tijd(h.tijd_van), tijd(h.tijd_tot), userById(h.user_id).name, p.nummer || "", p.klant || "", p.naam || "", faseShort(t.fase_nr), t.titel || "", String(h.uren).replace(".", ","), t.uren_klant ? "ja" : "nee", (h.notitie || "").replace(/[;\r\n]/g, " ")].map(v => `"${csvVeilig(v).replace(/"/g, '""')}"`).join(";"); }));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `bros-uren-${todayIso}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
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
  if (S.rapTab === "fin" && isBeheer() && typeof vFinPlanning === "function") return vFinPlanning();   // 1.52: Rapporten › Financiële planning (fin-planning.js)
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
  return `${typeof finTabs === "function" ? finTabs("cijfers") : ""}
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
  const q = (v) => `"${csvVeilig(v).replace(/"/g, '""')}"`; const n = (v) => v == null || v === "" ? "" : String(v).replace(".", ",");
  const lines = [head.join(";")].concat(projects().map(p => [p.nummer, p.klant, KLANTTYPE[p.klanttype], p.bedrijf, p.btw_nummer, p.naam, p.adres, p.postcode, p.gemeente, p.contact, p.gsm1, p.gsm2, p.email1, p.factuur_email1 ? "ja" : "", p.email2, p.factuur_email2 ? "ja" : "", PROJ_STATUS[p.status], faseName(p.fase_nr), userById(p.lead).name, p.projecttype, p.bron, n(p.oppervlakte_m2), n(p.btw_tarief), n(p.forfait), n(projDone(p.id)), n(projPlanned(p.id)), n(Math.round(projKost(p.id, "intern"))), n(Math.round(projKost(p.id, "extern"))), fmtLong(p.start), fmtLong(p.eind), fmtLong(p.offerte_datum), fmtLong(p.contract_datum), fmtLong(p.opgeleverd_op), p.verloren_reden, p.tags, p.drive_map].map(q).join(";")));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `bros-projecten-${todayIso}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

/* ---------- Instellingen (beheer): fasen en standaardtaken ---------- */
/* 1.70: lopende projecten zonder Drive-map (zonder map komt er geen factuur-pdf bij de klant) — één klik koppelt een bestaande map met die naam of maakt ze aan */
const zonderMap = () => projects().filter(p => (p.status === "lopend" || p.status === "offerte") && !p.intern && !p.drive_folder_id).sort((a, b) => (b.nummer || "").localeCompare(a.nummer || ""));
function zonderMapPaneel() {
  const l = zonderMap(); if (!l.length || !driveReady()) return "";
  return `<div class="panel" style="margin-bottom:16px;border-color:var(--warn)"><div class="panel-head"><div><h3>Projecten zonder Drive-map <span class="cnt" style="background:var(--warn);color:#fff">${l.length}</span></h3><div class="muted" style="font-size:12px;margin-top:2px">Zonder map kan een factuur-pdf niet bij de klant en zie je de documenten niet in het dossier. De knop koppelt een bestaande map in PROJECTEN met die naam, of maakt ze aan uit het sjabloon.</div></div></div>
    <div class="tw"><table class="t"><tbody>${l.map(p => `<tr><td><a href="#" data-open="${p.id}" data-optab="dossier">${esc(p.nummer ? p.nummer + " · " : "")}${esc(projName(p))}</a></td><td class="muted">${esc(PROJ_STATUS[p.status] || p.status)}</td><td class="r"><button class="btn sm" data-act="drive-create" data-pid="${p.id}">Map koppelen of aanmaken</button></td></tr>`).join("")}</tbody></table></div></div>`;
}
function vInstellingen() {
  if (!isBeheer()) return `<div class="empty">Alleen voor beheerders.</div>`;
  const fs = Object.values(S.fasen).sort((a, b) => a.nr - b.nr);
  if (!S.selFase || !S.fasen[S.selFase]) S.selFase = fs[0]?.nr;
  const f = S.fasen[S.selFase]; const ts = S.standaardtaken.filter(t => t.fase_nr === S.selFase);
  return `
  <div class="page-head"><div><div class="eyebrow">Beheer</div><h1>Instellingen</h1><div class="sub">Drive-koppeling, postenbibliotheek voor meetstaten, fasen en standaardtaken. Wijzigingen gelden voor wat je hierna aanmaakt; bestaande projecten houden hun taken en meetstaatregels.</div></div></div>
  ${zonderMapPaneel()}
  <div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Weergave</h3></div></div><div class="panel-body"><label class="sw-row"><input type="checkbox" class="sw" data-act-uitleg="1" ${(() => { try { return localStorage.getItem("bros.uitleg") === "1"; } catch (e) { return false; } })() ? "checked" : ""}><span><b>Uitleg in panelen altijd tonen</b><small class="muted" style="display:block">Anders staat lange uitleg achter een ⓘ naast de titel. Geldt voor deze browser.</small></span></label></div></div>
  <div class="panel" style="margin-bottom:16px"><div class="panel-head"><h3>Drive-koppeling</h3><span class="pill ${driveReady() ? "st-afgerond" : "st-offerte"}">${driveReady() ? "ingesteld" : "niet ingesteld"}</span></div>
    <div class="panel-body"><div class="form-grid">
      <div class="field"><label for="dr_url">Web app-URL van het Drive-script</label><input id="dr_url" value="${esc(driveCfg().url || "")}" placeholder="https://script.google.com/macros/s/…/exec"></div>
      <div class="field"><label for="dr_secret">Secret (zelfde als in het script)</label><input id="dr_secret" type="password" value="${esc(driveCfg().secret || "")}"></div>
      <div class="field span2"><div class="actions"><button class="btn primary" data-act="drive-save">Bewaren</button><button class="btn" data-act="drive-test">Verbinding testen</button><button class="btn" data-act="agenda-test" title="Kan het Drive-script afspraken in de Google Agenda van brosburo zetten?">Agenda testen</button><span class="muted" style="font-size:12px">Het script staat in de map <code>drive/Code.gs</code>; de installatie staat bovenaan in dat bestand. Nieuwe projecten krijgen daarna automatisch hun map met de sjabloonbestanden.</span></div></div>
    </div></div></div>
  ${vPortaalBeheer()}
  ${vAssistentBeheer()}
  ${typeof vVergaderInstellingen === "function" ? vVergaderInstellingen() : ""}
  ${modOk("renders") && typeof vRenderInstellingen === "function" ? vRenderInstellingen() : ""}
  ${vPostenBeheer()}
  ${vStandaardWie()}
  <div class="grid two" style="grid-template-columns: 1fr 1.4fr">
    <div class="panel"><div class="panel-head"><h3>Fasen</h3><button class="btn sm" data-act="fase-new">+ Fase</button></div>
      <div class="tw"><table class="t"><tbody>${fs.map(x => `<tr class="click ${x.nr === S.selFase ? "sel" : ""}" data-selfase="${x.nr}"><td class="num" style="width:40px;color:var(--muted)">${x.nr}</td><td><span style="${x.actief === false ? "color:var(--muted);text-decoration:line-through" : ""}">${esc(x.naam)}</span><small class="muted" style="display:block">${S.standaardtaken.filter(t => t.fase_nr === x.nr).length} taken${swReady() ? " · " + esc(swNaam(x.standaard_wie)) : ""}${x.actief === false ? " · verborgen" : ""}</small></td><td class="r"><button class="btn ghost sm" data-act="fase-edit" data-nr="${x.nr}">Bewerken</button></td></tr>`).join("")}</tbody></table></div>
      <div class="panel-body muted" style="font-size:12px;border-top:1px solid var(--line)">Het nummer bepaalt de volgorde. Een fase die je niet meer gebruikt zet je op "verborgen" — verwijderen kan alleen als geen enkel project ernaar verwijst.</div></div>
    <div class="panel"><div class="panel-head"><div><h3>${f ? `${f.nr} · ${esc(f.naam)}` : "Standaardtaken"}</h3>${f && swReady() ? `<label class="muted" style="font-size:12px;display:flex;gap:6px;align-items:center;margin-top:4px">Standaard verantwoordelijke van deze fase <select class="inline" data-fase-wie="${f.nr}" style="width:auto" aria-label="Standaard verantwoordelijke van de fase">${opts(swKeuzes(false, null, f.standaard_wie), f.standaard_wie || "")}</select></label>` : ""}</div>${f ? `<button class="btn sm primary" data-act="st-new" data-nr="${f.nr}">+ Standaardtaak</button>` : ""}</div>
      ${ts.length ? `<div class="tw"><table class="t"><tbody>${ts.map((t, i) => `<tr><td class="num" style="width:40px;color:var(--muted)">${t.volgorde}</td><td><input class="inline" data-st-title="${t.id}" value="${esc(t.titel)}" aria-label="Titel"></td>${swReady() ? `<td style="width:190px"><select class="inline" data-st-wie="${t.id}" aria-label="Verantwoordelijke" title="Wie deze taak standaard krijgt">${opts(swKeuzes(true, f && f.standaard_wie, t.standaard_wie), t.standaard_wie || "")}</select></td>` : ""}<td class="r" style="white-space:nowrap"><button class="btn ghost sm" data-act="st-move" data-id="${t.id}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Omhoog">↑</button><button class="btn ghost sm" data-act="st-move" data-id="${t.id}" data-dir="1" ${i === ts.length - 1 ? "disabled" : ""} aria-label="Omlaag">↓</button><button class="btn ghost sm danger" data-act="st-del" data-id="${t.id}" aria-label="Verwijderen">✕</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><b>Geen standaardtaken</b>Voeg er een toe voor deze fase.</div>`}
      <div class="panel-body muted" style="font-size:12px;border-top:1px solid var(--line)">Klik in een titel om ze te wijzigen; de wijziging wordt bewaard zodra je het veld verlaat.</div></div>
  </div>`;
}
/* Betaalgegevens (script 034): IBAN-controle (ISO 13616, modulo 97) en Belgische gestructureerde mededeling */
const ibanNorm = (x) => String(x || "").replace(/\s+/g, "").toUpperCase();
const ibanOk = (x) => { const v = ibanNorm(x); if (!/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(v)) return false; const r = (v.slice(4) + v.slice(0, 4)).replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55)); let m = 0; for (const ch of r) m = (m * 10 + Number(ch)) % 97; return m === 1; };
const ibanFmt = (x) => ibanNorm(x).replace(/(.{4})/g, "$1 ").trim();
/* "123456789002", "+++123/4567/89002+++" of "***123/4567/89002***" → +++123/4567/89002+++ (null = leeg, NaN = ongeldig) */
const ogmLees = (raw) => { const d = String(raw || "").replace(/[^0-9]/g, ""); if (!String(raw || "").trim()) return null; if (d.length !== 12) return NaN; const ok = (Number(d.slice(0, 10)) % 97 || 97) === Number(d.slice(10)); return ok ? `+++${d.slice(0, 3)}/${d.slice(3, 7)}/${d.slice(7)}+++` : NaN; };
/* Klantenportaal: teksten en overzicht van wie toegang heeft */
const portaalCfg = () => (S.instellingen.portaal && S.instellingen.portaal.value) || {};
function vPortaalBeheer() {
  const c = portaalCfg(); const url = c.url || (location.origin + location.pathname.replace(/[^/]*$/, "") + "klant/");
  const metLogin = Object.values(S.contacten).filter(x => x.user_id).sort((a, b) => a.naam.localeCompare(b.naam));
  const rolVan = (k) => S.profiles[k.user_id]?.role || (k.soort === "klant" ? "klant" : "aannemer");
  const klanten = metLogin.filter(k => rolVan(k) !== "aannemer"), aannemers = metLogin.filter(k => rolVan(k) === "aannemer"); const urlA = c.url_aannemer || url.replace(/klant\/?$/, "aannemer/");
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Klantenportaal en aannemersportaal</h3><div class="muted" style="font-size:12px;margin-top:2px">Klanten loggen in op <a href="${esc(safeUrl(url))}" target="_blank" rel="noopener">${esc(url)}</a>, aannemers op <a href="${esc(safeUrl(urlA))}" target="_blank" rel="noopener">${esc(urlA)}</a>. Toegang geef je per project: Dossier → Contacten → knop in de kolom Portaal.</div></div><span class="pill st-afgerond">${klanten.length} klant${klanten.length === 1 ? "" : "en"} · ${aannemers.length} aannemer${aannemers.length === 1 ? "" : "s"} met toegang</span></div>
    <div class="panel-body"><div class="form-grid">
      <div class="field span2"><label for="po_welkom">Welkomtekst (bovenaan de startpagina)</label><textarea id="po_welkom" rows="2">${esc(c.welkom || "")}</textarea></div>
      <div class="field span2"><label for="po_werk">Inleiding bij "Zo werkt het bij BROS" (de fasen uit Instellingen staan eronder)</label><textarea id="po_werk" rows="2">${esc(c.werkwijze || "")}</textarea></div>
      <div class="field span2"><label for="po_contact">Contactblok ("Vragen?")</label><textarea id="po_contact" rows="2">${esc(c.contact || "")}</textarea></div>
      <div class="field span2" style="border-top:1px solid var(--line);padding-top:10px"><label>In het Engels (voor klanten met taal English — leeg = de Nederlandse tekst)</label></div>
      <div class="field span2"><label for="po_welkom_en">Welcome text</label><textarea id="po_welkom_en" rows="2">${esc(c.welkom_en || "")}</textarea></div>
      <div class="field span2"><label for="po_werk_en">"How we work at BROS"</label><textarea id="po_werk_en" rows="2">${esc(c.werkwijze_en || "")}</textarea></div>
      <div class="field span2"><label for="po_contact_en">"Questions?"</label><textarea id="po_contact_en" rows="2">${esc(c.contact_en || "")}</textarea></div>
      <div class="field span2" style="border-top:1px solid var(--line);padding-top:10px"><label>Betalen in het portaal</label><div class="muted" style="font-size:12px">Bij een factuur die nog te betalen is, toont het portaal het rekeningnummer, het bedrag, de gestructureerde mededeling en een QR-code die de klant met zijn bankapp scant. Mededeling, vervaldag en pdf komen uit de Yuki-mail (of vul je in bij Facturatie).</div></div>
      <div class="field"><label for="po_iban">IBAN</label><input id="po_iban" autocomplete="off" spellcheck="false" placeholder="BE.. .... .... ...." value="${esc(c.iban ? ibanFmt(c.iban) : "")}"></div>
      <div class="field"><label for="po_bic">BIC (optioneel)</label><input id="po_bic" autocomplete="off" spellcheck="false" value="${esc(c.bic || "")}"></div>
      <div class="field"><label for="po_begunstigde">Begunstigde (naam op de rekening)</label><input id="po_begunstigde" autocomplete="off" value="${esc(c.begunstigde || "")}" placeholder="bv. BROS BV"></div>
      <div class="field span2" style="border-top:1px solid var(--line);padding-top:10px"><label>Bedrijfsgegevens op het bankdossier</label><div class="muted" style="font-size:12px">De klant downloadt in het portaal (Facturatie) een dossier voor zijn bank bij een verbouwlening: per factuur de vorderingsstaat met de factuur-pdf. Deze gegevens staan bovenaan, samen met de verklaring van de projectverantwoordelijke.</div></div>
      <div class="field"><label for="po_bnaam">Bedrijfsnaam</label><input id="po_bnaam" autocomplete="off" value="${esc(c.bedrijf_naam || "")}" placeholder="bv. BROS BV"></div>
      <div class="field"><label for="po_bbtw">Ondernemings-/btw-nummer</label><input id="po_bbtw" autocomplete="off" value="${esc(c.bedrijf_btw || "")}" placeholder="BE 0123.456.789"></div>
      <div class="field span2"><label for="po_badres">Adres</label><input id="po_badres" autocomplete="off" value="${esc(c.bedrijf_adres || "")}" placeholder="bv. Kloosterstraat 165, 2000 Antwerpen"></div>
      <div class="field span2"><div class="actions"><button class="btn primary" data-act="portaal-save">Bewaren</button><span class="muted" style="font-size:12px">Teamfoto's, functie en biografie voor "Wie is wie": Team → Bewerken.</span></div></div>
    </div>${metLogin.length ? `<div class="tw" style="margin-top:12px"><table class="t"><thead><tr><th>Wie</th><th>Portaal</th><th>E-mail</th><th>Projecten</th><th>Uitgenodigd</th><th>Laatste bezoek</th></tr></thead><tbody>${metLogin.map(k => { const aan = rolVan(k) === "aannemer"; return `<tr class="click" data-contact="${k.id}"><td>${esc(k.naam)}</td><td><span class="pill ${aan ? "st-on_hold" : "st-lopend"}">${aan ? "aannemer" : "klant"}</span></td><td class="muted" style="font-size:12px">${esc(k.email)}</td><td class="muted" style="font-size:12px">${projectsOfContact(k.id).filter(x => aan ? !KLANT_ROLLEN.includes(x.rol) : KLANT_ROLLEN.includes(x.rol)).map(x => esc(x.p.klant)).join(", ") || "—"}</td><td class="num">${k.portaal_sinds ? fmtLong(lokDag(k.portaal_sinds)) : "—"}</td><td class="num">${k.portaal_login ? fmtLong(lokDag(k.portaal_login)) : "nog niet"}</td></tr>`; }).join("")}</tbody></table></div>` : ""}</div></div>`;
}
async function portaalSaveSettings() {
  const value = { ...portaalCfg(), welkom: $("#po_welkom").value.trim(), werkwijze: $("#po_werk").value.trim(), contact: $("#po_contact").value.trim() };
  if ($("#po_welkom_en")) Object.assign(value, { welkom_en: $("#po_welkom_en").value.trim(), werkwijze_en: $("#po_werk_en").value.trim(), contact_en: $("#po_contact_en").value.trim() });
  if ($("#po_iban")) {   // betaalgegevens: enkel geldige waarden bewaren
    const iban = ibanNorm($("#po_iban").value), bic = $("#po_bic").value.replace(/\s+/g, "").toUpperCase(), ben = $("#po_begunstigde").value.trim();
    if (iban && !ibanOk(iban)) { toast("Dit IBAN klopt niet (controlegetal) — kijk het even na.", 6000); return; }
    if (bic && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) { toast("Deze BIC klopt niet (8 of 11 tekens, bv. GEBABEBB).", 6000); return; }
    if (iban && !ben) { toast("Vul ook de begunstigde in (de naam op de rekening).", 6000); return; }
    Object.assign(value, { iban, bic, begunstigde: ben.slice(0, 70) });
  }
  if ($("#po_bnaam")) Object.assign(value, { bedrijf_naam: $("#po_bnaam").value.trim().slice(0, 120), bedrijf_btw: $("#po_bbtw").value.trim().slice(0, 40), bedrijf_adres: $("#po_badres").value.trim().slice(0, 200) });   // 1.66: bankdossier
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

/* ---------- Standaardverantwoordelijken (script 040): wie krijgt een standaardtaak? taak → fase → projectlead ---------- */
const swReady = () => true;
const swNaam = (v) => !v || v === "lead" ? "Projectlead" : (S.profiles[v]?.name || "onbekend");
const swActief = (id) => { const u = S.profiles[id]; return !!u && u.active !== false && !EXTERN.includes(u.role); };
/* keuzelijst: bij een taak ook "zoals de fase" ("" = volgt de fase, "lead" = projectlead); bij een fase is "" = projectlead */
const swKeuzes = (taak, faseWie, huidig) => [...(taak ? [["", `Zoals de fase (${swNaam(faseWie)})`], ["lead", "Projectlead"]] : [["", "Projectlead"]]), ...users().map(u => [u.id, u.name]),
  ...(huidig && huidig !== "lead" && !users().some(u => u.id === huidig) ? [[huidig, `${swNaam(huidig)} (inactief → projectlead)`]] : [])];   // een ingestelde, intussen inactieve medewerker blijft zichtbaar (en wordt niet stil overschreven)
function standaardWie(st, lead) {
  if (!swReady()) return lead || null;
  const v = st.standaard_wie || S.fasen[st.fase_nr]?.standaard_wie || "lead";
  return v !== "lead" && swActief(v) ? v : (lead || null);   // inactieve medewerker → projectlead
}
function stTaakRij(st, pid, lead) {
  const r = { project_id: pid, titel: st.titel, fase_nr: st.fase_nr, assignee: standaardWie(st, lead), volgorde: st.fase_nr * 100 + st.volgorde, status: "todo", uren_gepland: 0 };
  if (swReady()) r.standaard_taak = st.id;
  return r;
}
async function swZetFase(nr, v) {
  const { data, error } = await sb.from("fasen").update({ standaard_wie: v || null }).eq("nr", nr).select().single();
  if (error) { toast("Mislukt: " + error.message); return render(); }
  S.fasen[nr] = data; render(); toast(`Fase ${nr}: standaard ${swNaam(v)}`);
}
async function swZetTaak(id, v) {
  const t = S.standaardtaken.find(x => x.id === id); if (!t) return;
  const { error } = await sb.from("standaardtaken").update({ standaard_wie: v || null }).eq("id", id);
  if (error) { toast("Mislukt: " + error.message); return render(); }
  t.standaard_wie = v || null; render(); toast(v ? `"${t.titel}": ${v === "lead" ? "projectlead" : swNaam(v)}` : `"${t.titel}" volgt de fase`);
}
function vStandaardWie() {
  if (!isBeheer()) return "";
  if (!swReady()) return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h3>Standaardverantwoordelijken</h3></div><div class="panel-body">${SCHEMA_HINT(40)}</div></div>`;
  const tel = {}; S.standaardtaken.filter(st => S.fasen[st.fase_nr]?.actief !== false).forEach(st => { const v = st.standaard_wie || S.fasen[st.fase_nr]?.standaard_wie || "lead"; const k = v !== "lead" && swActief(v) ? swNaam(v) : "Projectlead"; tel[k] = (tel[k] || 0) + 1; });
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Standaardverantwoordelijken</h3><div class="muted" style="font-size:12px;margin-top:2px">Wie een standaardtaak krijgt bij een nieuw project of een toegevoegde fase: de keuze bij de taak, anders die van de fase, anders de projectlead. Stel het hieronder in per fase en per taak.</div></div>
    <div class="actions"><button class="btn sm" data-act="sw-voorstel">Voorstel invullen…</button><button class="btn sm" data-act="sw-toepassen">Toepassen op lopende projecten…</button></div></div>
    <div class="panel-body" style="font-size:13px">${Object.entries(tel).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<span class="pill grijs" style="margin-right:6px">${esc(k)} · ${n} ta${n === 1 ? "ak" : "ken"}</span>`).join("") || `<span class="muted">Nog geen standaardtaken.</span>`}</div></div>`;
}
/* voorstel op basis van de namen (Phil = commercieel/ontwerp/klant, Thomas = uitvoering/werf/planning, Noa = tekenwerk) — eerst tonen, dan bewaren */
const SW_FASE_REGELS = [[/maatwerk|ruwbouw|schrijnwerk|techniek|bezetting|vloer|installatie|afwerking|werf|uitvoering|oplevering/, "thomas"], [/offerte|contract|onderteken|bespreking|voorontwerp/, "phil"], [/opmeting|ontwerp/, "noa"]];
const SW_TAAK_REGELS = [[/definitief vastleggen|ontdekking|moodboard|materialis|\bfuncties\b|^organigram$|contract|offerte|meetstaat|afspra|afspreken/, "phil"], [/inplannen/, null], [/planning|werf|budget|controle|oplevering|bijwonen/, "thomas"], [/\bplan(nen)?\b|tekening|\bteken|vwx|vectorworks|\b3d\b|render|presentatie|indeling|grondplan|\bmodel\b|naar ontwerp|aanzicht/, "noa"]];
function swWieVoor(tekst, regels) {
  const t = String(tekst || "").toLowerCase().trim();
  for (const [re, wie] of regels) if (re.test(t)) { if (!wie) return null; const u = users().find(x => x.name.toLowerCase().startsWith(wie)); return u ? u.id : null; }
  return null;
}
function swVoorstel() {
  const fs = fasenList(); const vf = {}, vt = {};
  fs.forEach(f => { vf[f.nr] = f.standaard_wie || swWieVoor(f.naam, SW_FASE_REGELS) || ""; });
  S.standaardtaken.filter(st => vf[st.fase_nr] !== undefined).forEach(st => { if (st.standaard_wie) { vt[st.id] = st.standaard_wie; return; } const w = swWieVoor(st.titel, SW_TAAK_REGELS); vt[st.id] = w && w !== vf[st.fase_nr] ? w : ""; });
  const nieuw = fs.filter(f => !f.standaard_wie && vf[f.nr]).length + S.standaardtaken.filter(st => !st.standaard_wie && vt[st.id]).length;
  openModal("Voorstel standaardverantwoordelijken", `<p class="muted" style="margin-top:0;font-size:13px">Voorstel op basis van de namen: <b>Phil</b> commercieel, ontwerpkeuzes en klantafspraken · <b>Thomas</b> uitvoering, werf en planning · <b>Noa</b> tekenwerk (plannen, VWX, 3D, renders). Wat al ingesteld was, blijft staan. Pas aan waar nodig en bewaar — je kan het later nog per fase en taak wijzigen.${nieuw ? "" : " <b>Er valt niets nieuws voor te stellen.</b>"}</p>
    <div class="tw" style="max-height:60vh;overflow:auto"><table class="t"><tbody>${fs.map(f => `<tr style="background:var(--surface-2,rgba(0,0,0,.03))"><td class="num" style="width:36px"><b>${f.nr}</b></td><td><b>${esc(f.naam)}</b></td><td style="width:220px"><select class="inline" name="f_${f.nr}" data-swv-fase="${f.nr}">${opts(swKeuzes(false, null, vf[f.nr]), vf[f.nr])}</select></td></tr>`
      + S.standaardtaken.filter(st => st.fase_nr === f.nr).map(st => `<tr><td></td><td style="padding-left:18px">${esc(st.titel)}</td><td><select class="inline" name="t_${st.id}" data-swv-fnr="${f.nr}">${opts(swKeuzes(true, vf[f.nr], vt[st.id]), vt[st.id])}</select></td></tr>`).join("")).join("")}</tbody></table></div>`, {
    wide: true, saveLabel: "Bewaren",
    onSave: async (d) => {
      const jobs = [];
      fs.forEach(f => { const v = d["f_" + f.nr] || null; if ((f.standaard_wie || null) !== v) jobs.push(sb.from("fasen").update({ standaard_wie: v }).eq("nr", f.nr).then(r => { if (r.error) throw r.error; f.standaard_wie = v; })); });
      S.standaardtaken.forEach(st => { if (!(("t_" + st.id) in d)) return; const v = d["t_" + st.id] || null; if ((st.standaard_wie || null) !== v) jobs.push(sb.from("standaardtaken").update({ standaard_wie: v }).eq("id", st.id).then(r => { if (r.error) throw r.error; st.standaard_wie = v; })); });
      try { await Promise.all(jobs); } catch (e) { toast("Niet alles bewaard: " + (e.message || e), 7000); await refetch("fasen"); await refetch("standaardtaken"); render(); return false; }
      render(); toast(jobs.length ? `${jobs.length} instelling${jobs.length === 1 ? "" : "en"} bewaard` : "Niets gewijzigd");
    },
  });
  // fase gewijzigd in het voorstel → het label "Zoals de fase (…)" bij de taken volgt mee
  $("#mform").querySelectorAll("[data-swv-fase]").forEach(sel => sel.addEventListener("change", () => { $("#mform").querySelectorAll(`[data-swv-fnr="${sel.dataset.swvFase}"]`).forEach(x => { if (x.options[0]) x.options[0].textContent = `Zoals de fase (${swNaam(sel.value)})`; }); }));
}
/* de verdeling toepassen op open taken van lopende projecten (offerte, lopend, on hold) — eerst een overzicht om aan te vinken */
function swToepassen() {
  const norm = (x) => String(x || "").toLowerCase().trim();
  const rijen = [];
  Object.values(S.projecten).filter(p => !["afgerond", "verloren"].includes(p.status)).forEach(p => {
    Object.values(S.taken).filter(t => t.project_id === p.id && t.status !== "done").forEach(t => {
      const st = (t.standaard_taak && S.standaardtaken.find(x => x.id === t.standaard_taak)) || S.standaardtaken.find(x => x.fase_nr === t.fase_nr && norm(x.titel) === norm(t.titel));
      if (!st) return; const wil = standaardWie(st, p.lead);
      if (!wil || wil === t.assignee) return;
      rijen.push({ p, t, wil, aan: !t.assignee || t.assignee === p.lead || !swActief(t.assignee) });   // al met de hand aan iemand anders gegeven → standaard niet aangevinkt
    });
  });
  if (!rijen.length) return toast("De open taken van de lopende projecten volgen de standaardverdeling al.");
  const perP = {}; rijen.forEach(r => (perP[r.p.id] = perP[r.p.id] || []).push(r));
  const pnaam = (p) => [p.nummer, p.klant].filter(Boolean).join(" · ");
  openModal("Toepassen op lopende projecten", `<p class="muted" style="margin-top:0;font-size:13px">${rijen.length} open ta${rijen.length === 1 ? "ak" : "ken"} in ${Object.keys(perP).length} project${Object.keys(perP).length === 1 ? "" : "en"} wijken af van de standaardverdeling. Aangevinkt zijn de taken die nu bij de projectlead, niemand of een inactieve medewerker staan; taken die al aan iemand anders gegeven werden, zijn niet aangevinkt. Afgewerkte taken en afgeronde of verloren projecten blijven ongemoeid.</p>
    <p style="margin:0 0 8px"><button type="button" class="btn ghost sm" data-swt="alle">Alles aanvinken</button> <button type="button" class="btn ghost sm" data-swt="geen">Niets aanvinken</button></p>
    <div class="tw" style="max-height:60vh;overflow:auto"><table class="t"><tbody>${Object.values(perP).sort((a, b) => pnaam(a[0].p).localeCompare(pnaam(b[0].p))).map(l => `<tr style="background:var(--surface-2,rgba(0,0,0,.03))"><td colspan="3"><b>${esc(pnaam(l[0].p))}</b> <span class="muted" style="font-size:12px">· lead ${esc(swNaam(l[0].p.lead))}</span></td></tr>`
      + l.sort((a, b) => (a.t.volgorde || 0) - (b.t.volgorde || 0)).map(r => `<tr><td style="width:28px"><input type="checkbox" name="sw" value="${r.t.id}" ${r.aan ? "checked" : ""} aria-label="${esc(r.t.titel)}"></td><td>${esc(r.t.titel)}<small class="muted" style="display:block">fase ${r.t.fase_nr}</small></td><td style="white-space:nowrap;font-size:13px">${esc(r.t.assignee ? swNaam(r.t.assignee) : "niemand")} → <b>${esc(swNaam(r.wil))}</b></td></tr>`).join("")).join("")}</tbody></table></div>`, {
    wide: true, saveLabel: "Toewijzen",
    onSave: async () => {
      const ids = [...$("#mform").querySelectorAll('input[name="sw"]:checked')].map(i => i.value);
      if (!ids.length) { toast("Niets aangevinkt."); return false; }
      const perWie = {}; ids.forEach(id => { const r = rijen.find(x => String(x.t.id) === String(id)); if (r) (perWie[r.wil] = perWie[r.wil] || []).push(r.t.id); });
      try {
        const jobs = []; Object.entries(perWie).forEach(([wie, l]) => { for (let i = 0; i < l.length; i += 100) { const deel = l.slice(i, i + 100);   // per 100 (lengte van de URL)
          jobs.push(sb.from("taken").update({ assignee: wie }).in("id", deel).then(r => { if (r.error) throw r.error; deel.forEach(id => { if (S.taken[id]) S.taken[id].assignee = wie; }); })); } });
        await Promise.all(jobs);
      } catch (e) { toast("Niet alles toegewezen: " + (e.message || e), 7000); await refetch("taken"); render(); return false; }
      render(); toast(`${ids.length} ta${ids.length === 1 ? "ak" : "ken"} opnieuw toegewezen`);
      if (typeof afsSync === "function") ids.map(id => S.taken[id]).filter(t => t && (t.afspraak || t.agenda_event_id)).forEach(t => afsSync(t.id, false, true));   // initialen in de agendatitel volgen mee
    },
  });
  $("#mform").querySelectorAll("[data-swt]").forEach(b => b.addEventListener("click", () => $("#mform").querySelectorAll('input[name="sw"]').forEach(i => i.checked = b.dataset.swt === "alle")));
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
  const form = $("#mform"); MODAL.dirty = false; MODAL.title = title; MODAL.saved = false;
  // niet-bewaarde invoer bewaren (per formuliertitel) zodat een per ongeluk gesloten of herladen formulier te herstellen is
  const snapshot = () => { const o = {}; form.querySelectorAll("input[name],select[name],textarea[name]").forEach(el => { if (el.type === "checkbox" || el.type === "radio") { if (el.checked) (o[el.name] = o[el.name] || []).push(el.value); } else o[el.name] = el.value; }); return o; };
  const isSame = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const initial = snapshot();
  // sleutel = titel + vingerafdruk van de beginwaarden: een concept hoort bij precies dit record (of bij een leeg nieuw formulier)
  const hash = (str) => { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  const draftKey = "pb-draft:" + title + ":" + hash(JSON.stringify(initial)); let draft = null; try { draft = JSON.parse(sessionStorage.getItem(draftKey) || "null"); } catch (e) { }
  if (draft && draft.v && !isSame(draft.v, initial) && Date.now() - (draft.t || 0) < 12 * 3600000) {
    const bar = document.createElement("div"); bar.className = "draft-bar"; bar.innerHTML = `<span>Er staat nog niet-bewaarde invoer van ${new Date(draft.t).toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" })} klaar.</span><span><button type="button" class="btn sm primary" data-draft="ja">Herstellen</button> <button type="button" class="btn sm ghost" data-draft="nee">Weg</button></span>`;
    form.querySelector(".mb").prepend(bar);
    bar.querySelector('[data-draft="ja"]').onclick = () => { Object.entries(draft.v).forEach(([k, v]) => { if (k === "ok") return; /* 1.61: een bevestiging (bv. betaalde beeldgeneratie) nooit herstellen */ form.querySelectorAll(`[name="${CSS.escape(k)}"]`).forEach(el => { if (el.type === "checkbox" || el.type === "radio") el.checked = Array.isArray(v) && v.includes(el.value); else el.value = v; el.dispatchEvent(new Event("change", { bubbles: true })); }); }); MODAL.dirty = true; bar.remove(); toast("Invoer hersteld"); };
    bar.querySelector('[data-draft="nee"]').onclick = () => { try { sessionStorage.removeItem(draftKey); } catch (e) { } bar.remove(); };
  }
  form.addEventListener("input", () => { MODAL.dirty = true; clearTimeout(MODAL.t); MODAL.t = setTimeout(() => { try { sessionStorage.setItem(draftKey, JSON.stringify({ t: Date.now(), v: snapshot() })); } catch (e) { } }, 400); });
  form.addEventListener("change", () => { MODAL.dirty = true; });
  form.onsubmit = async (e) => { e.preventDefault(); const btn = form.querySelector('button[type=submit]'); btn.disabled = true; try { const d = Object.fromEntries(new FormData(form).entries()); d._fasen = [...form.querySelectorAll('input[name="fase"]:checked')].map(i => Number(i.value)); const ok = await onSave(d); if (ok !== false) { MODAL.dirty = false; MODAL.saved = true; try { sessionStorage.removeItem(draftKey); } catch (x) { } closeModal(); } } catch (err) { console.error(err); if (!(err && err.__toasted)) toast("Bewaren mislukt: " + ((err && err.message) || err), 6000); } btn.disabled = false; };
  if (onDelete) $("[data-mdelete]").onclick = async () => { if (confirm("Zeker verwijderen?")) { try { await onDelete(); MODAL.dirty = false; closeModal(); } catch (e) { } } };
  setTimeout(() => form.querySelector("input:not([type=checkbox]),select,textarea")?.focus(), 30);
}
/* sluiten: met onbewaarde invoer eerst bevestigen; een klik die in het formulier begon (tekst selecteren) en buiten eindigt, sluit niets */
const MODAL = { dirty: false, title: "", t: null, downOnBg: false, saved: false };
function closeModal(force) {
  const bg = $("#modalBg"); if (!bg.classList.contains("show")) return true;
  if (!force && MODAL.dirty && !confirm("Dit formulier heeft niet-bewaarde wijzigingen. Toch sluiten? (Je invoer blijft klaarstaan als je het formulier opnieuw opent.)")) return false;
  MODAL.dirty = false; bg.classList.remove("show"); return true;
}
document.addEventListener("mousedown", (e) => { MODAL.downOnBg = e.target === $("#modalBg"); });
window.addEventListener("beforeunload", (e) => { if ($("#modalBg")?.classList.contains("show") && MODAL.dirty) { e.preventDefault(); e.returnValue = ""; } });
const opts = (arr, sel) => arr.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel) ? "selected" : ""}>${esc(l)}</option>`).join("");
const userOpts = (sel, allowEmpty) => (allowEmpty ? `<option value="">— niemand —</option>` : "") + opts(users().map(u => [u.id, u.name]), sel);
/* 1.49.1: projectkeuze alfabetisch op klantnaam (met nummer erachter); lopende projecten bovenaan, afgeronde en verloren apart onderaan */
const projOpts = (sel) => {
  const abc = (a, b) => projName(a).localeCompare(projName(b), "nl", { sensitivity: "base", numeric: true }) || (b.nummer || "").localeCompare(a.nummer || "");
  const lbl = (p) => projName(p) + (p.nummer ? " · " + p.nummer : "");
  const ps = projects(), dicht = (p) => p.status === "afgerond" || p.status === "verloren";
  const open = ps.filter(p => !dicht(p)).sort(abc), toe = ps.filter(dicht).sort(abc);
  if (!toe.length) return opts(open.map(p => [p.id, lbl(p)]), sel);
  return `<optgroup label="Lopend en in offerte">${opts(open.map(p => [p.id, lbl(p)]), sel)}</optgroup><optgroup label="Afgerond of niet doorgegaan">${opts(toe.map(p => [p.id, lbl(p)]), sel)}</optgroup>`;
};
const faseOpts = (sel, allowEmpty) => { const l = fasenList().map(f => [f.nr, `${f.nr} · ${f.naam}`]); if (sel && S.fasen[sel] && !l.some(x => x[0] == sel)) l.push([Number(sel), `${sel} · ${S.fasen[sel].naam} (niet actief)`]);   // 1.64: een niet-actieve huidige fase niet stil wissen bij bewaren
  return (allowEmpty ? `<option value="">— geen fase —</option>` : "") + opts(l, sel); };

/* 1.53: de status van een project wijzigen met een klik op de statusknop (projectenlijst, projectkop, financiële planning) — beheer,
   zoals het projectformulier. Verloren vraagt de reden; een andere status maakt die reden leeg (zoals het formulier). */
function projStatusKnop(p) {
  const lbl = esc(PROJ_STATUS[p.status] || p.status || "—");
  if (!isBeheer()) return `<span class="pill st-${esc(p.status)}">${lbl}</span>`;
  return `<button type="button" class="pill st-${esc(p.status)} pst-knop" data-act="pst-menu" data-pid="${p.id}" aria-haspopup="menu" aria-expanded="false" title="Status wijzigen">${lbl}<span class="pst-pijl" aria-hidden="true">▾</span></button>`;
}
function pstSluit(terug) {
  const m = document.getElementById("pstMenu"); if (!m) return false;
  const pid = m.dataset.pid; m.remove();
  document.querySelectorAll(".pst-knop[aria-expanded='true']").forEach(b => b.setAttribute("aria-expanded", "false"));
  if (terug) { const k = document.querySelector(`.pst-knop[data-pid="${pid}"]`); if (k) k.focus(); }
  return true;
}
function pstMenu(knop) {
  const open = document.getElementById("pstMenu"); const zelfde = open && open.dataset.pid === knop.dataset.pid; pstSluit(); if (zelfde) return;
  const p = S.projecten[knop.dataset.pid]; if (!p || !isBeheer()) return;
  const m = document.createElement("div"); m.id = "pstMenu"; m.className = "pst-menu"; m.setAttribute("role", "menu"); m.setAttribute("aria-label", "Status van " + (p.klant || "het project")); m.dataset.pid = p.id;
  m.innerHTML = Object.entries(PROJ_STATUS).map(([k, l]) => `<button type="button" role="menuitemradio" aria-checked="${p.status === k}" data-act="pst-zet" data-pid="${p.id}" data-st="${k}"><span class="pill st-${k}">${esc(l)}</span>${p.status === k ? `<span class="pst-v" aria-hidden="true">✓</span>` : ""}</button>`).join("");
  document.body.appendChild(m); knop.setAttribute("aria-expanded", "true");
  const r = knop.getBoundingClientRect(); const h = m.offsetHeight, w = m.offsetWidth;
  m.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + "px";
  m.style.top = (r.bottom + 4 + h > innerHeight - 8 && r.top - 4 - h > 8 ? r.top - 4 - h : r.bottom + 4) + "px";
  (m.querySelector('[aria-checked="true"]') || m.querySelector("button")).focus();
}
async function pstZet(pid, st) {
  const viaToets = !!(document.getElementById("pstMenu") && document.getElementById("pstMenu").contains(document.activeElement));
  pstSluit(viaToets); const p = S.projecten[pid]; if (!p || !PROJ_STATUS[st] || p.status === st || !isBeheer()) return;
  if (st === "verloren") {
    openModal("Project verloren — " + (p.klant || ""), `<div class="form-grid"><div class="field span2"><label for="pst_vr">Reden verloren</label><input id="pst_vr" name="verloren_reden" value="${esc(p.verloren_reden || "")}" placeholder="bv. prijs, timing, ander bureau"><small class="muted">Optioneel — handig voor de rapporten.</small></div></div>`, {
      saveLabel: "Op verloren zetten",
      onSave: async (d) => { await dbUpdate("projecten", pid, { status: "verloren", verloren_reden: (d.verloren_reden || "").trim() }); toast("Status: Verloren"); },
    });
    return;
  }
  const vorig = p.status;
  try { await dbUpdate("projecten", pid, { status: st, verloren_reden: "" }); } catch (e) { return; }
  if (viaToets && (!document.activeElement || document.activeElement === document.body)) { const k = document.querySelector(`.pst-knop[data-pid="${pid}"]`); if (k) k.focus(); }   // na render: focus terug op de (nieuwe) knop
  toast(`Status: ${PROJ_STATUS[st]} (was ${PROJ_STATUS[vorig] || vorig})`, 4000);
}
document.addEventListener("keydown", (e) => {
  const m = document.getElementById("pstMenu"); if (!m) return;
  if (!m.contains(document.activeElement)) { pstSluit(); return; }   // focus elders (bv. snel zoeken): menu dicht, toets niet afvangen
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); pstSluit(true); return; }
  if (e.key === "Tab") { pstSluit(true); return; }   // focus terug op de knop, Tab gaat van daar verder
  if (!["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { pstSluit(true); return; }   // bv. ⌘K of /: menu dicht, de sneltoets werkt gewoon
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const bs = [...m.querySelectorAll("button")]; const i = bs.indexOf(document.activeElement); bs[(i + (e.key === "ArrowDown" ? 1 : -1) + bs.length) % bs.length].focus(); }
}, true);
document.addEventListener("click", (e) => { const m = document.getElementById("pstMenu"); if (m && !m.contains(e.target) && !(e.target.closest && e.target.closest(".pst-knop"))) pstSluit(); }, true);
window.addEventListener("resize", () => pstSluit());
document.addEventListener("scroll", () => pstSluit(), true);
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
    <div class="field"><label for="f_fase">Huidige fase</label><select id="f_fase" name="fase_nr">${faseOpts(p.fase_nr || 1, true)}</select>${!isNew ? `<label class="chk"><input type="checkbox" name="fase_vast" id="f_fase_vast" ${p.fase_vast ? "checked" : ""}> vastzetten (niet automatisch laten opschuiven)</label><span class="muted" id="f_fase_hint" style="font-size:12px">${p.fase_vast ? "Vastgezet: de fase blijft staan tot je dit uitvinkt." : "Schuift vanzelf vooruit met het werk: taken bezig/klaar, overeenkomst goedgekeurd, ontwerpronde gepubliceerd."}</span>` : ""}</div>
    <div class="field"><label for="f_forfait">Forfait (€, excl. btw)</label><input id="f_forfait" type="number" step="1" name="forfait" value="${esc(p.forfait ?? "")}"></div>
    <div class="field"><label for="f_start">Start</label><input id="f_start" type="date" name="start" value="${esc(p.start || todayIso)}"></div>
    <div class="field"><label for="f_eind">Geplande oplevering</label><input id="f_eind" type="date" name="eind" value="${esc(p.eind || "")}"></div>
    <div class="field"><label for="f_map">Drive-map</label><input id="f_map" name="drive_map" value="${esc(p.drive_map || "")}" placeholder="PROJECTEN/klantnaam (automatisch)"></div>
    <div class="field verloren"><label for="f_vr">Reden verloren</label><input id="f_vr" name="verloren_reden" value="${esc(p.verloren_reden || "")}" placeholder="bv. prijs, timing, ander bureau"></div>
    ${isBeheer() ? `<div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" name="intern" value="1" ${p.intern ? "checked" : ""}><span><b>Intern project (BROS — Interne werking)</b><small class="muted" style="display:block">Het interne project van BROS: eigen vergaderingen en de interne takenlijst, zichtbaar voor het hele team en nooit voor klanten. Er is er maar één.</small></span></label></div>` : ""}
    <div class="field span2"><label for="f_not">Notities</label><textarea id="f_not" name="notities">${esc(p.notities || "")}</textarea></div>
    <div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" name="assistent" ${p.assistent !== false ? "checked" : ""}><span><b>AI-assistent in het klantenportaal</b><small class="muted" style="display:block">Uit bij een moeilijk dossier of geschil: het tabblad Vragen verdwijnt dan voor deze klant.</small></span></label></div>
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
      row.assistent = d.assistent === "on";
      if (!isNew) {   // 1.64: fase enkel meesturen als ze echt gewijzigd werd (anders overschrijft een open formulier een automatisch opgeschoven fase)
        row.fase_vast = d.fase_vast === "on";
        if (!$("#f_fase")?.dataset.gewijzigd) delete row.fase_nr;
      }
      if (isBeheer() && !!d.intern !== !!p.intern) {   // 1.54 (script 051): er is maar één intern project
        const ander = Object.values(S.projecten).find(x => x.intern && x.id !== p.id);
        if (d.intern && ander) { toast(`"${ander.klant}" is al het interne project. Zet het daar eerst uit.`, 6000); return false; }
        row.intern = !!d.intern;
      }
      if (d.nummer && d.nummer.trim()) row.nummer = d.nummer.trim(); else if (!isNew) row.nummer = p.nummer || null;
      if (isNew) {
        row.created_by = S.me.id;
        const created = await dbInsert("projecten", row);
        const tasks = S.standaardtaken.filter(t => d._fasen.includes(t.fase_nr)).map(t => stTaakRij(t, created.id, row.lead));   // verantwoordelijke: taak → fase → projectlead (script 040)
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
    onDelete: isNew ? null : async () => { if (typeof afsVoorVerwijderen === "function") for (const t of Object.values(S.taken).filter(t => t.project_id === p.id && (t.afspraak || t.agenda_event_id))) await afsVoorVerwijderen(t); await dbDelete("projecten", p.id); Object.values(S.taken).filter(t => t.project_id === p.id).forEach(t => delete S.taken[t.id]); Object.values(S.uren).filter(h => h.project_id === p.id).forEach(h => delete S.uren[h.id]); S.project = null; render(); toast("Project verwijderd"); },
  });
  wirePostcode();
  const fSel = $("#f_fase"), fVast = $("#f_fase_vast"), fHint = $("#f_fase_hint");
  if (fSel && fVast && fHint) {   // 1.64: lager kiezen dan nu → vastzetten, anders schuift ze bij het volgende afgevinkte werk weer op
    const nu = () => Number(S.projecten[p.id]?.fase_nr ?? p.fase_nr ?? 0);   // de fase kan intussen automatisch opgeschoven zijn
    const lager = () => fSel.dataset.gewijzigd && Number(fSel.value || 0) < nu();
    const tip = () => { fHint.textContent = fVast.checked ? "Vastgezet: de fase blijft staan tot je dit uitvinkt." : lager() ? "Let op: niet vastgezet → schuift bij het volgende afgevinkte werk weer op." : "Schuift vanzelf vooruit met het werk: taken bezig/klaar, overeenkomst goedgekeurd, ontwerpronde gepubliceerd."; };
    fSel.addEventListener("change", () => { fSel.dataset.gewijzigd = "1"; if (lager()) fVast.checked = true; tip(); });
    fVast.addEventListener("change", tip);
  }
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
    <p class="muted" style="font-size:13px;margin:10px 0 0">De standaardtaken van deze fase worden toegevoegd zonder datum, toegewezen ${swReady() ? "volgens de standaardverantwoordelijken (Instellingen; anders de projectlead)" : "aan de projectlead"}.</p>`, {
    saveLabel: "Toevoegen",
    onSave: async (d) => {
      const nr = Number(d.fase_nr);
      const tasks = S.standaardtaken.filter(t => t.fase_nr === nr).map(t => stTaakRij(t, pid, p.lead));
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
    <div class="field"><label for="t_who">Toegewezen aan</label><select id="t_who" name="assignee">${wieOpts(projectId, t)}</select></div>
    <div class="field"><label for="t_status">Status</label><select id="t_status" name="status" ${t.bundel && typeof tdOk === "function" && tdOk() ? `disabled title="Een to-dotaak volgt haar checklist"` : ""}>${opts(Object.entries(TASK_STATUS), t.status || "todo")}</select>${t.bundel && typeof tdOk === "function" && tdOk() ? `<small class="muted">Volgt de checklist hieronder.</small>` : ""}</div>
    <div class="field"><label for="t_start">Start</label><input id="t_start" type="date" name="start" value="${esc(t.start || "")}"></div>
    <div class="field"><label for="t_eind">Einde</label><input id="t_eind" type="date" name="eind" value="${esc(t.eind || "")}"></div>
    <div class="field"><label for="t_uren">Geplande uren</label><input id="t_uren" type="number" step="0.5" min="0" name="uren_gepland" value="${esc(t.uren_gepland ?? 0)}"></div>
    <div class="field"><label for="t_note">Uit verslag</label><select id="t_note" name="notitie_id"><option value="">— geen —</option>${opts(notesOf(projectId).map(n => [n.id, `${fmt(n.datum)} · ${n.titel || NOTE_SOORT[n.soort]}`]), t.notitie_id || "")}</select>${t.notitie_id && S.notities[t.notitie_id] ? `<button type="button" class="btn ghost sm" data-act="note-open" data-id="${t.notitie_id}" style="align-self:flex-start;margin-top:4px">Verslag openen →</button>` : ""}</div>
    <div class="field"><label for="t_not">Notitie</label><input id="t_not" name="notitie" value="${esc(t.notitie || "")}"></div>
    <div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" name="uren_klant" value="1" ${t.uren_klant ? "checked" : ""}><span><b>Gepresteerde uren zichtbaar voor de klant</b><small class="muted" style="display:block">De klant ziet de geregistreerde uren van deze taak, met datum en tijdstip. Staat standaard uit.</small></span></label></div>
    <div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" name="timing_klant" value="1" ${t.timing_klant ? "checked" : ""}><span><b>Timing delen met de klant</b><small class="muted" style="display:block">Titel en van–tot van deze taak verschijnen onder de fase in de planning van het portaal (geen uren, geen wie). Staat standaard uit.</small></span></label></div>
    ${typeof afsVelden === "function" ? afsVelden(t, projectId) : ""}
    ${typeof vgTaakLink === "function" ? vgTaakLink(t) : ""}
    ${typeof tdVelden === "function" ? tdVelden(t) : ""}
  </div>`, {
    onSave: async (d) => {
      const row = { titel: d.titel.trim(), project_id: d.project_id, fase_nr: d.fase_nr ? Number(d.fase_nr) : null, ...(wieSplit(d.assignee)), status: d.status, start: d.start || null, eind: d.eind || null, uren_gepland: Number(d.uren_gepland) || 0, notitie: d.notitie , ...(("notitie_id" in d) ? { notitie_id: d.notitie_id || null } : {}) };
      row.uren_klant = !!d.uren_klant;
      row.timing_klant = !!d.timing_klant;
      if (t.bundel && typeof tdOk === "function" && tdOk()) { const tl = S.taken[t.id] || t; row.status = tl.status; if (!d.eind || d.eind === (t.eind || "")) { row.eind = tl.eind || null; if (!d.start) row.start = tl.start || null; } }   // 1.63: de status van een to-dotaak volgt de checklist
      if (row.start && !row.eind) row.eind = row.start; if (row.eind && !row.start) row.start = row.eind; if (row.eind < row.start) row.eind = row.start;
      if (typeof afsUitForm === "function") { const fout = afsUitForm(d, row, t); if (fout) { toast(fout, 6000); return false; } }   // afspraak ter plaatse (script 041)
      if (isNew) { row.volgorde = (row.fase_nr || 99) * 100 + 90; await dbInsert("taken", row); toast("Taak aangemaakt"); }
      else { const wasKlaar = t.status === "done"; if (row.status === "done" && !wasKlaar) vierTaak(t, null); await dbUpdate("taken", t.id, row); toast("Taak bewaard"); }
    },
    onDelete: isNew ? null : async () => { await dbDelete("taken", t.id); toast("Taak verwijderd"); },
  });
  if (typeof afsWire === "function") afsWire(t);
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
    <div class="field"><label for="h_van">Van <span class="muted">(optioneel)</span></label><input id="h_van" type="time" name="tijd_van" step="900" value="${esc(tijd(h.tijd_van))}"></div>
    <div class="field"><label for="h_tot">Tot</label><input id="h_tot" type="time" name="tijd_tot" step="900" value="${esc(tijd(h.tijd_tot))}"></div>
    <div class="field"><label for="h_uren">Uren</label><input id="h_uren" type="number" step="0.25" min="0.25" name="uren" required value="${esc(h.uren ?? 1)}"><small class="muted" id="h_hint">Vul van/tot in en de uren worden berekend.</small></div>
    <div class="field"><label for="h_not">Notitie</label><input id="h_not" name="notitie" value="${esc(h.notitie || "")}" placeholder="wat heb je gedaan?"></div>
  </div>`, {
    onSave: async (d) => {
      const row = { user_id: isBeheer() ? d.user_id : (h.user_id || S.me.id), datum: d.datum, project_id: d.project_id, taak_id: d.taak_id || null, uren: Number(d.uren) || 0, notitie: d.notitie };
      row.tijd_van = d.tijd_van || null; row.tijd_tot = d.tijd_tot || null; if (row.tijd_van && row.tijd_tot && row.tijd_tot <= row.tijd_van) { toast("Het einduur moet na het beginuur liggen."); return false; }
      const voor = mijnUrenOp(todayIso) - (!isNew && h.user_id === S.me.id && h.datum === todayIso ? Number(h.uren) || 0 : 0);
      if (isNew) await dbInsert("uren", row); else await dbUpdate("uren", h.id, row);
      if (!(isNew && vierUren(row, voor))) toast(`${nl(row.uren)} u geregistreerd`);
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
    <div class="field span2" style="border-top:1px solid var(--line);padding-top:10px"><label>Klantenportaal — pagina "Wie is wie"</label></div>
    <div class="field"><label for="u_functie">Functie</label><input id="u_functie" name="functie" value="${esc(u.functie || "")}" placeholder="bv. Co-founder · Creative Director"></div>
    <div class="field"><label for="u_foto">Foto</label><div style="display:flex;gap:10px;align-items:center">${u.foto_url ? `<img src="${esc(safeSrc(u.foto_url))}" alt="" style="width:44px;height:44px;border-radius:50%;object-fit:cover">` : avatar(u.id)}<input id="u_foto" name="foto" type="file" accept="image/*" style="font-size:12px"></div></div>
    <div class="field span2"><label for="u_bio">Korte biografie (2–3 zinnen)</label><textarea id="u_bio" name="bio" rows="3">${esc(u.bio || "")}</textarea></div>
    <div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" name="portaal_zichtbaar" ${u.portaal_zichtbaar !== false ? "checked" : ""}><span>Tonen op de pagina "Wie is wie" in het klantenportaal</span></label></div>
    ${isBeheer() ? `<div class="field"><label for="u_role">Rol</label><select id="u_role" name="role">${opts([["medewerker", "Medewerker"], ["beheer", "Beheer"]], u.role)}</select></div>
    <div class="field"><label for="u_active">Actief</label><select id="u_active" name="active"><option value="1" ${u.active !== false ? "selected" : ""}>Ja</option><option value="0" ${u.active === false ? "selected" : ""}>Nee (verbergen)</option></select></div>
    <div class="field"><label for="u_ti">Uurtarief intern (€)</label><input id="u_ti" type="number" step="1" name="intern" value="${esc(tar.intern ?? 0)}"></div>
    <div class="field"><label for="u_te">Uurtarief extern (€)</label><input id="u_te" type="number" step="1" name="extern" value="${esc(tar.extern ?? 0)}"></div>` : ""}
  </div>`, {
    onSave: async (d) => {
      const patch = { name: d.name.trim(), initials: (d.initials || d.name.slice(0, 2)).toUpperCase(), color: d.color };
      if (isBeheer()) { patch.role = d.role; patch.active = d.active === "1"; }
      {
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


/* =====================================================================
   Snel zoeken & springen — ⌘K / Ctrl+K (of /): projecten (ook rechtstreeks naar een tabblad), taken, contacten,
   verslagen, werfpunten, documenten, meetstaatposten en acties. Alles lokaal en meteen; recent gebruikte items bovenaan.
   ===================================================================== */
const ZK = { open: false, q: "", sel: 0, lijst: [], el: null };
const zkNorm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[·•|/\\,;:()]+/g, " ");
const zkRecent = {
  get() { try { return JSON.parse(localStorage.getItem("bros.zoek.recent") || "[]"); } catch (e) { return []; } },
  add(k) { try { const a = this.get().filter(x => x !== k); a.unshift(k); localStorage.setItem("bros.zoek.recent", JSON.stringify(a.slice(0, 10))); } catch (e) { } },
};
const zkTel = (...ts) => ts.map(t => { const d = String(t || "").replace(/\D/g, ""); return d ? d + (d.startsWith("32") ? " 0" + d.slice(2) : "") : ""; }).join(" ");   // 0471 93 06 33 vindt +32/471.93.06.33
const ZK_PTABS = [["taken", "Taken"], ["notities", "Notities verslagen"], ["meetstaat", "Meetstaat"], ["facturatie", "Facturatie vorderingen"], ["werf", "Werf werfpunten"], ["planning", "Planning"], ["uren", "Uren"], ["dossier", "Dossier documenten contacten"]];
function zkOpenProject(pid, tab) { S.view = "projecten"; S.project = pid; S.ptab = tab || S.ptab || "taken"; render(); window.scrollTo({ top: 0 }); }
function zkIndex() {
  const it = []; const add = (o) => { o.hay = zkNorm(o.titel + " " + (o.extra || "") + " " + (o.sub || "")); o.tn = zkNorm(o.titel); it.push(o); };
  const proj = (pid) => S.projecten[pid];
  // acties
  const hier = S.project && S.projecten[S.project] ? S.project : null;
  add({ k: "a:uren", type: "actie", ic: "⏱", titel: "Uren registreren", extra: "uren invullen tijd registratie", go: () => hoursForm({}, hier) });
  add({ k: "a:taak", type: "actie", ic: "＋", titel: "Nieuwe taak", extra: "taak toevoegen todo", go: () => taskForm({}, hier) });
  if (hier) add({ k: "a:verslag", type: "actie", ic: "📝", titel: "Nieuw verslag", sub: projName(S.projecten[hier]), extra: "notitie vergadering werfverslag", go: () => noteForm({}, hier) });
  add({ k: "a:contact", type: "actie", ic: "＋", titel: "Nieuw contact", extra: "aannemer leverancier klant toevoegen", go: () => contactForm({}) });
  if (isBeheer()) add({ k: "a:project", type: "actie", ic: "＋", titel: "Nieuw project", extra: "project aanmaken", go: () => projectForm({}) });
  add({ k: "a:dag", type: "actie", ic: "◔", titel: "Jouw dag", extra: "dagring dagdoel uren vandaag geluid animaties", go: () => dagForm() });
  TABS.filter(([, , r]) => !r || isBeheer()).forEach(([k, l]) => add({ k: "n:" + k, type: "ga naar", ic: "→", titel: l, extra: "ga naar open scherm", go: () => { S.view = k; S.project = null; render(); window.scrollTo({ top: 0 }); } }));
  // projecten (+ rechtstreeks naar een tabblad)
  Object.values(S.projecten).forEach(p => {
    const sub = [p.nummer, p.gemeente, PROJ_STATUS[p.status] || p.status].filter(Boolean).join(" · ");
    const extra = [p.klant, p.naam, p.nummer, p.adres, p.postcode, p.gemeente, p.email1, p.email2, zkTel(p.gsm1, p.gsm2)].join(" ");
    add({ k: "p:" + p.id, type: "project", ic: "📁", titel: projName(p), sub, extra, pid: p.id, go: () => zkOpenProject(p.id, "taken"), w: p.status === "lopend" ? 5 : p.status === "offerte" ? 4 : 2 });
    ZK_PTABS.forEach(([tab, lbl]) => it.push({ k: "pt:" + p.id + ":" + tab, type: "tabblad", ic: "↳", titel: `${projName(p)} › ${lbl.split(" ")[0]}`, sub, tabWoorden: zkNorm(lbl), hay: zkNorm(extra + " " + lbl), tn: zkNorm(projName(p)), alleenMetTab: true, go: () => zkOpenProject(p.id, tab), w: 3 }));
  });
  // taken
  Object.values(S.taken).forEach(t => { const p = proj(t.project_id); const wie = t.assignee ? userById(t.assignee)?.name : t.contact_id ? S.contacten[t.contact_id]?.naam : "";
    add({ k: "t:" + t.id, type: "taak", ic: t.status === "done" ? "✓" : "○", titel: t.titel, sub: [p ? projName(p) : "", faseShort(t.fase_nr), wie, TASK_STATUS[t.status]].filter(Boolean).join(" · "), extra: t.notitie || "", go: () => taskForm(t), w: t.status === "done" ? -2 : 1 }); });
  // contacten
  Object.values(S.contacten).filter(c => c.actief !== false).forEach(c => add({ k: "c:" + c.id, type: "contact", ic: "👤", titel: contactLabel(c), sub: [CONTACT_SOORT[c.soort], c.vakgebied, c.gsm || c.tel, c.email].filter(Boolean).join(" · "), extra: [c.contactpersoon, c.gemeente, c.gsm, c.tel, c.email, c.btw_nummer, zkTel(c.gsm, c.tel)].join(" "), tel: c.gsm || c.tel || "", mail: c.email || "", go: () => contactForm(c), w: 2 }));
  // verslagen
  Object.values(S.notities || {}).forEach(n => { const p = proj(n.project_id); add({ k: "v:" + n.id, type: "verslag", ic: "📝", titel: n.titel || NOTE_SOORT[n.soort] || "Verslag", sub: [NOTE_SOORT[n.soort], fmt(n.datum), p ? projName(p) : ""].filter(Boolean).join(" · "), extra: String(n.inhoud || "").slice(0, 400), go: () => noteForm(n), w: 1 }); });
  // werfpunten
  Object.values(S.vaststellingen || {}).forEach(v => { const p = proj(v.project_id); add({ k: "w:" + v.id, type: "werfpunt", ic: "📍", titel: `${vsNr(v)} ${v.titel || String(v.omschrijving || "").slice(0, 80)}`, sub: [p ? projName(p) : "", v.ruimte, v.status].filter(Boolean).join(" · "), extra: v.omschrijving || "", go: () => vsForm(v), w: v.status === "open" ? 1 : -1 }); });
  // documenten
  Object.values(S.documenten || {}).forEach(d => { const p = proj(d.project_id); add({ k: "d:" + d.id, type: "document", ic: "📄", titel: d.naam, sub: [p ? projName(p) : "", (d.pad || "").replace(/\//g, " › ")].filter(Boolean).join(" · "), go: () => { if (d.url) window.open(safeUrl(d.url), "_blank", "noopener"); else zkOpenProject(d.project_id, "dossier"); }, w: -1 }); });
  // meetstaatposten
  Object.values(S.meetstaat_posten || {}).forEach(r => { if (r.status === "vervallen") return; const p = proj(r.project_id);
    add({ k: "m:" + r.id, type: "post", ic: "≡", titel: `${r.code || ""} ${r.omschrijving}`.trim(), sub: [p ? projName(p) : "", lotName(r.lot), r.locatie].filter(Boolean).join(" · "), go: () => { zkOpenProject(r.project_id, "meetstaat"); setTimeout(() => { const tr = document.querySelector(`tr[data-msrow="${r.id}"]`); if (tr) { tr.scrollIntoView({ block: "center" }); tr.classList.add("zk-flash"); setTimeout(() => tr.classList.remove("zk-flash"), 2200); } }, 80); }, w: -2 }); });
  return it;
}
let ZK_IDX = null;
function zkZoek(q) {
  const toks = zkNorm(q).split(/\s+/).filter(Boolean).map(t => /^[\d+.\-]{3,}$/.test(t) ? t.replace(/\D/g, "") : t).filter(Boolean); const rec = zkRecent.get();
  if (!toks.length) {
    const byK = Object.fromEntries(ZK_IDX.map(i => [i.k, i]));
    const recent = rec.map(k => byK[k]).filter(Boolean).map(i => ({ ...i, kop: "Recent" }));
    const acties = ZK_IDX.filter(i => i.type === "actie").map(i => ({ ...i, kop: "Acties" }));
    return recent.concat(acties);
  }
  const qn = toks.join(" "); const uit = [];
  for (const i of ZK_IDX) {
    let sc = 0, ok = true, tabHit = false;
    for (const t of toks) {
      const pos = i.hay.indexOf(t); if (pos < 0) { ok = false; break; }
      sc += (pos === 0 || i.hay[pos - 1] === " ") ? 3 : 1;
      if (i.tabWoorden && (" " + i.tabWoorden).includes(" " + t)) tabHit = true;
    }
    if (!ok || (i.alleenMetTab && !tabHit)) continue;
    if (i.tn.startsWith(qn)) sc += 8; else if (i.tn.includes(qn)) sc += 4;
    if (i.type === "actie" || i.type === "ga naar") { if (!toks.every(t => i.tn.includes(t) || i.hay.includes(t))) continue; sc += 2; }
    sc += (i.w || 0); const r = rec.indexOf(i.k); if (r >= 0) sc += 6 - r * 0.4;
    uit.push({ ...i, sc });
  }
  return uit.sort((a, b) => b.sc - a.sc || a.titel.localeCompare(b.titel)).slice(0, 40);
}
function zkTeken() {
  const box = ZK.el.querySelector(".zk-lijst"); const L = ZK.lijst;
  if (!L.length) { box.innerHTML = `<div class="zk-leeg">Niets gevonden voor “${esc(ZK.q)}”. Probeer een deel van een naam, een projectnummer, een postcode of een gsm-nummer.</div>`; return; }
  let vorigeKop = null;
  box.innerHTML = L.map((i, n) => { const kop = i.kop && i.kop !== vorigeKop ? `<div class="zk-kop">${esc(i.kop)}</div>` : ""; vorigeKop = i.kop || vorigeKop;
    const p = i.type === "project" ? i.pid : null;
    return kop + `<div class="zk-item ${n === ZK.sel ? "on" : ""}" data-zk="${n}" role="option" aria-selected="${n === ZK.sel}"><span class="zk-ic">${i.ic}</span><span class="zk-tx"><b>${esc(i.titel)}</b>${i.sub ? `<small>${esc(i.sub)}</small>` : ""}</span>`
      + (p ? `<span class="zk-chips">${ZK_PTABS.slice(0, 6).map(([t, l]) => `<button type="button" data-zkpt="${t}" data-zkp="${p}">${esc(l.split(" ")[0])}</button>`).join("")}</span>` : "")
      + (i.tel ? `<a class="zk-chip" href="tel:${esc(String(i.tel).replace(/[^\d+]/g, ""))}" title="Bellen">☎</a>` : "") + (i.mail ? `<a class="zk-chip" href="mailto:${esc(i.mail)}" title="Mailen">✉</a>` : "")
      + `<span class="zk-type">${esc(i.type)}</span></div>`; }).join("");
  const on = box.querySelector(".zk-item.on"); if (on) on.scrollIntoView({ block: "nearest" });
}
function zkUpdate() { ZK.lijst = zkZoek(ZK.q); ZK.sel = 0; zkTeken(); }
function zkKies(n) { const i = ZK.lijst[n]; if (!i) return; if (!closeModal()) return; zkSluit(); zkRecent.add(i.k); i.go(); }
function zkOpen() {
  if (!S.ready || !S.me || ZK.open) return; ZK.open = true; ZK.q = ""; ZK_IDX = zkIndex();
  if (!ZK.el) {
    ZK.el = document.createElement("div"); ZK.el.className = "zk"; ZK.el.innerHTML = `<div class="zk-paneel" role="dialog" aria-label="Snel zoeken"><div class="zk-in"><span>⌕</span><input type="text" placeholder="Zoek een project, taak, contact, verslag, werfpunt, document, post… of een actie" autocomplete="off" spellcheck="false"><kbd>esc</kbd></div><div class="zk-lijst" role="listbox"></div><div class="zk-voet"><span><kbd>↑</kbd><kbd>↓</kbd> kiezen</span><span><kbd>↵</kbd> openen</span><span>tip: “appel fact” springt naar Facturatie van Appelmans</span></div></div>`;
    document.body.appendChild(ZK.el);
    const inp = ZK.el.querySelector("input");
    inp.addEventListener("input", () => { ZK.q = inp.value; zkUpdate(); });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); ZK.sel = Math.min(ZK.lijst.length - 1, ZK.sel + 1); zkTeken(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); ZK.sel = Math.max(0, ZK.sel - 1); zkTeken(); }
      else if (e.key === "Enter") { e.preventDefault(); zkKies(ZK.sel); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); zkSluit(); }
    });
    ZK.el.addEventListener("mousedown", (e) => { if (e.target === ZK.el) zkSluit(); });
    ZK.el.addEventListener("click", (e) => {
      const pt = e.target.closest("[data-zkpt]"); if (pt) { e.stopPropagation(); if (!closeModal()) return; zkSluit(); zkRecent.add("p:" + pt.dataset.zkp); zkOpenProject(pt.dataset.zkp, pt.dataset.zkpt); return; }
      if (e.target.closest("a.zk-chip")) return;
      const it = e.target.closest("[data-zk]"); if (it) zkKies(Number(it.dataset.zk)); });
    ZK.el.addEventListener("mousemove", (e) => { const it = e.target.closest("[data-zk]"); if (it && Number(it.dataset.zk) !== ZK.sel) { ZK.sel = Number(it.dataset.zk); ZK.el.querySelectorAll(".zk-item").forEach((x, n) => x.classList.toggle("on", n === ZK.sel)); } });
  }
  const inp = ZK.el.querySelector("input"); inp.value = ""; ZK.el.classList.add("show"); zkUpdate(); setTimeout(() => inp.focus(), 0);
}
function zkSluit() { if (!ZK.el) return; ZK.open = false; ZK.el.classList.remove("show"); }
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "k" || e.key === "K")) { if (!S.ready) return; e.preventDefault(); e.stopPropagation(); ZK.open ? zkSluit() : zkOpen(); return; }
  if (e.key === "/" && !ZK.open && !e.metaKey && !e.ctrlKey && !e.altKey) { const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return; if ($("#modalBg")?.classList.contains("show")) return; if (!S.ready) return; e.preventDefault(); zkOpen(); }
}, true);
/* komma in een getalveld (type=number): als punt invoegen, ook bij plakken — anders maakt Chrome van 2,5 → 25 en Safari → leeg */
document.addEventListener("keydown", (e) => { const t = e.target; if ((e.key === "," || e.key === "Decimal") && t && t.matches && t.matches('input[type="number"]')) { e.preventDefault(); if (!String(t.value).includes(".")) document.execCommand("insertText", false, "."); } }, true);
document.addEventListener("paste", (e) => { const t = e.target; if (!t || !t.matches || !t.matches('input[type="number"]')) return; const n = leesGetal(e.clipboardData && e.clipboardData.getData("text")); if (n == null || Number.isNaN(n)) return; e.preventDefault(); t.value = String(n); t.dispatchEvent(new Event("input", { bubbles: true })); }, true);
/* ---------- events ---------- */
document.addEventListener("click", (e) => {
  if (e.target.closest("a[href][target=_blank]")) return; // externe links (bv. Drive-map) gewoon laten openen
  const el = e.target.closest("[data-vs],[data-nav],[data-act],[data-open],[data-back],[data-ptab],[data-edit-task],[data-edit-hours],[data-gnav],[data-wnav],[data-gtoggle],[data-close],[data-selfase],[data-sellot],[data-sort],[data-vtoggle],[data-contact]");
  if (el && el.matches('a[href="#"]')) e.preventDefault();   // 1.48: niet naar boven springen
  if (S.acctOpen && !(el && el.dataset.act === "acct") && typeof acctSluit === "function") acctSluit();   // 1.51: accountmenu dicht bij elke andere klik
  if (el && el.dataset.act === "acct") { S.acctOpen = !S.acctOpen; render(); if (S.acctOpen && e.detail === 0 && typeof acctFocus === "function") acctFocus(); return; }   // met het toetsenbord geopend: focus op het eerste menu-item
  if (!el) { if (e.target === $("#modalBg")) { if (MODAL.downOnBg) closeModal(); } else if (e.target.dataset && e.target.dataset.foto) fotoLightbox(e.target.dataset.foto); return; }
  if (e.target.matches(".task-check") || e.target.matches("input,select")) { if (!e.target.closest("[data-act]")) return; }
  const d = el.dataset;
  if (d.close != null && d.open) { if (!closeModal()) return; S.view = "projecten"; S.project = d.open; S.ptab = S.ptab || "taken"; return render(); }
  if (d.close != null) return closeModal();
  if (d.sort) { S.sort = { key: d.sort, dir: S.sort.key === d.sort && S.sort.dir === "asc" ? "desc" : S.sort.key === d.sort ? "asc" : (["klant", "lead", "status", "fase"].includes(d.sort) ? "asc" : "desc") }; try { localStorage.setItem("bros.sort", JSON.stringify(S.sort)); } catch (err) { } return render(); }
  if (d.nav) { S.view = d.nav; S.project = null; if (d.nav === "planning") S.filters.project = ""; return render(); }
  if (d.open) { S.view = "projecten"; S.project = d.open; S.ptab = d.optab || S.ptab || "taken"; return render(); }
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
  if (d.act === "vt-antw") { const v = S.taak_voorstellen[d.id]; if (v) voorstelAntwoordForm(v); return; }
  if (d.act === "portaal-invite") return portaalInviteForm(d.cid, d.pid, d.rol || "klant");
  if (d.act === "agenda-test") return driveCall("agendatest", {}).then(j => toast(`Agenda in orde — afspraken komen in "${j.agenda}"${j.account ? " (Drive-script draait als " + j.account + ")" : ""}.`, 8000)).catch(err => toast("Agenda: " + (/Onbekende actie/.test(err.message) ? "het Drive-script is nog een oudere versie — plak het nieuwe Code.ingevuld.gs en zet een nieuwe versie online." : err.message), 20000));   // 1.47
  if (d.act === "drive-test") return driveCall("ping", {}).then(j => toast(`OK — mappen: ${j.projecten} / ${j.sjabloon}`)).catch(err => toast("Drive: " + err.message));
  if (d.selfase) { S.selFase = Number(d.selfase); return render(); }
  if (d.act === "fase-new") return faseForm(null);
  if (d.act === "fase-edit") { e.stopPropagation(); return faseForm(S.fasen[d.nr]); }
  if (d.act === "st-new") return stAdd(Number(d.nr));
  if (d.act === "sw-voorstel") return swVoorstel();
  if (d.act === "sw-toepassen") return swToepassen();
  if (d.act === "st-move") return stMove(d.id, Number(d.dir));
  if (d.act === "st-del") return stDel(d.id);
  if (d.sellot) { S.selLot = Number(d.sellot); return render(); }
  if (d.vtoggle) { S.vordOpen = S.vordOpen || {}; S.vordOpen[d.vtoggle] = !S.vordOpen[d.vtoggle]; return render(); }
  if (d.act === "ms-ruimte") { S.msRuimte = !S.msRuimte; try { localStorage.setItem("bros.msRuimte", S.msRuimte ? "1" : ""); } catch (x) { } return render(); }
  if (d.act === "doc-aann") return docAannForm(d.id);   // 1.56
  if (d.act === "ms-marges") { S.msMarges = !S.msMarges; try { localStorage.setItem("bros.msMarges", S.msMarges ? "1" : ""); } catch (x) { } return render(); }
  if (d.act === "ms-klant") { S.msKlant = !S.msKlant; try { localStorage.setItem("bros.msKlant", S.msKlant ? "1" : ""); } catch (x) { } toast(S.msKlant ? "Klantweergave: kostprijs en marge verborgen" : "Volledige weergave"); return render(); }
  if (d.act === "ms-add-lot") return msAddLotForm(d.pid);
  if (d.act === "ms-open") { S.ptab = "meetstaat"; render(); if (!msRows(d.pid).length) msAddLotForm(d.pid); return; }
  if (d.act === "ms-add-post") return msAddPostForm(d.pid, d.lot ? Number(d.lot) : null);
  if (d.act === "ms-wijzig") return msWijzigForm(d.id);
  if (d.act === "ms-del") { const r = S.meetstaat_posten[d.id]; if (msVast(r)) { toast(`Post ${r.code} is goedgekeurd door de klant en ligt vast. Schrappen gaat via minwerk (± op de post).`, 7000); return; } if (r && msGefactureerd([d.id])) { toast("Deze post staat al in een vordering — verwijderen zou de factuur wijzigen. Zet hem op Vervallen.", 8000); return; } if (r && confirm(`"${r.omschrijving}" verwijderen?`)) dbDelete("meetstaat_posten", d.id).catch(() => { }); return; }
  if (d.act === "ms-del-lot") return msDelLot(d.pid, Number(d.lot));
  if (d.act && /^(kz|mwa)-/.test(d.act) && typeof kpBeheerAct === "function") return kpBeheerAct(d);
  if (d.act && /^(vg|wd)-/.test(d.act) && typeof kpFase3Act === "function" && kpFase3Act(d, el)) return;
  if (d.act && /^pv-/.test(d.act) && typeof pvAct === "function" && pvAct(d, el, e)) return;
  if (d.act && /^ov-/.test(d.act) && typeof ovAct === "function" && ovAct(d, el, e)) return;
  if (d.act === "tm-open" && typeof tmForm === "function") return tmForm();
  if (d.act === "ms-import") { if (!isBeheer()) return toast("Enkel beheer kan een meetstaat importeren"); return msImportPick(d.pid); }
  if (d.act === "gk-new") return gkForm(d.pid, d.soort || null);
  if (d.act === "note-new") return noteForm({}, d.pid);
  if (d.act === "vs-new") return vsForm({}, d.pid);
  if (d.act === "tk-new") return modLaad("teken").then(() => tkPlanForm(d.pid));   // tekenmodule — niet verwijderen (1.72: eerst laden indien nodig)
  if (d.act === "tk-open") return modLaad("teken").then(() => tkOpen(d.id));
  if (d.act === "am-open") return amOpen(d.pid, d.cid);   // meetstaat met prijzen voor de aannemer (script 032)
  if (d.vs) { e.stopPropagation(); if (!closeModal()) return; return vsForm(S.vaststellingen[d.vs]); }
  if (d.act === "kt-fill") { const [a, b] = ktTaskSpan(d.pid, Number(d.nr)); return ktSave(d.pid, Number(d.nr), { start: a, eind: b }); }
  if (d.act === "kt-clear") return ktClear(d.pid, Number(d.nr));
  if (d.act === "vs-open") { if (e.target.dataset.foto) return fotoLightbox(e.target.dataset.foto); const v = S.vaststellingen[d.id]; if (!v) return toast("Deze vaststelling bestaat niet meer."); return vsForm(v); }
  if (d.act === "wb-new") return wbForm({}, d.pid);
  if (d.act === "plan-new") return planForm(d.pid);
  if (d.act === "wv-new") return wvForm(d.pid);
  if (d.act === "ms-pdf") return msPdfForm(d.pid);
  if (d.act === "ms-move") { const r = S.meetstaat_posten[d.id]; if (!r) return; const rows = msRows(r.project_id).filter(x => x.lot === r.lot); const i = rows.findIndex(x => x.id === r.id); const j = i + Number(d.dir); if (j < 0 || j >= rows.length) return; return msReorder(r.project_id, r.lot, r.id, rows[j].id, Number(d.dir) < 0); }
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
  if (d.act === "note-open") { e.stopPropagation(); const n = S.notities[d.id]; if (!n) return toast("Dit verslag bestaat niet meer."); if (!closeModal()) return; return noteForm(n); }
  if (d.act === "gk-view") return gkView(d.id);
  if (d.act === "gk-withdraw") return gkWithdraw(d.id);
  if (d.act === "gk-annuleer") return gkAnnuleerForm(d.id);
  if (d.act === "gk-aann") return gkAannemersForm(d.id);          // 1.76: aannemer bij meer-/minderwerk
  if (d.act === "gk-bev") return mwBevestiging(d.id, false);
  if (d.act === "gk-mwmail") return mwMail(d.id, false);
  if (d.act === "pst-menu") return pstMenu(el);
  if (d.act === "pst-zet") return pstZet(d.pid, d.st);
  if (d.act === "ms-export") return exportMeetstaat(S.projecten[d.pid]).catch(err => { loader.fail(); toast("Export: " + err.message); });
  if (d.act === "post-new") return postAdd(Number(d.lot));
  if (d.act === "vord-new") return vordForm(d.pid, d.soort);
  if (d.act === "contact-new") return contactForm({});
  if (d.act === "contact-link") return linkContactForm(d.pid, d.rol);
  if (d.act === "contact-unlink") { const x = S.project_contacten[d.id]; if (x && confirm(`${S.contacten[x.contact_id]?.naam || "Contact"} ontkoppelen van dit project?`)) dbDelete("project_contacten", d.id).catch(() => { }); return; }
  if (d.contact) { e.stopPropagation(); const c = S.contacten[d.contact]; if (!c) return toast("Dit contact bestaat niet meer."); return contactForm(c); }
  if (d.act === "vord-del") return vordDel(d.id);
  if (d.act === "vord-fit") return vordFit(d.id);
  if (d.act === "vord-vast") return vordVastzetten(d.id, true);
  if (d.act === "vord-los") return vordVastzetten(d.id, false);
  if (d.act === "vord-kopie") return vordKopieYuki(d.id);
  if (d.act === "vord-yuki") return vordNaarYuki(d.id);   // 1.73: rechtstreeks in Yuki (proefmodus)
  if (d.act === "post-del") return postDel(d.id);
  if (d.act === "logout") return sb.auth.signOut().then(() => { opruimenNaUitloggen(); location.reload(); });
  if (d.act === "dagring") { dagForm(); return; }
  if (d.act === "zoek") { zkOpen(); return; }
  if (d.act === "fx-demo") { const r = el.getBoundingClientRect(); const f = $("#mform"); const g = f ? f.querySelector('[name="fx_geluid"]').checked : undefined; FX.burst(r.left + 24, r.top + r.height / 2, true, g); return; }
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
  if ((d.vr || d.ms || d.post || d.vf || (d.lot && d.f === "marge")) && e.target.tagName === "INPUT" && !["checkbox", "date"].includes(e.target.type) && d.getypt !== "1") return;   // enkel aangeklikt: niets bewaren
  if (d.mwa && e.target.tagName === "TEXTAREA" && typeof mwaEdit === "function") return mwaEdit(d.mwa, d.f, e.target.value);
  if (d.vgweek && e.target.tagName === "TEXTAREA" && typeof vgTekst === "function") return vgTekst(d.pid, d.vgweek, e.target.value);
  if (d.wd && e.target.tagName === "INPUT" && e.target.type !== "date" && typeof wdEdit === "function") return wdEdit(d.wd, d.f, e.target.value);
  if (d.vr) return vordEditPct(d.vr, Number(d.lot), e.target.value, d.vpost || null);
  if (d.ms && e.target.tagName !== "SELECT") return msEdit(d.ms, d.f, e.target.value);
  if (d.post && e.target.type !== "checkbox" && e.target.tagName !== "SELECT") return postEdit(d.post, d.f, e.target.value);
  if (d.lot && d.f === "marge") return lotEdit(Number(d.lot), d.f, e.target.value);
  if ((d.msrPost || d.msrLot) && d.msrf === "marge" && e.target.tagName === "INPUT") { if (d.getypt === "1") msrVeld(e.target); return; }   // 1.55: geraamde marge
  if (d.msrStd && e.target.tagName === "INPUT") { if (d.getypt === "1") msrProjectStd(d.msrStd, e.target.value); return; }

  if (d.vf && e.target.tagName !== "SELECT" && e.target.type !== "date") return vordEdit(d.vf, d.f, e.target.value);
});
document.addEventListener("input", (e) => { if (e.target && e.target.tagName === "INPUT" && e.target.dataset) e.target.dataset.getypt = "1"; }, true);   // veld echt gewijzigd (zie focusout)
document.addEventListener("input", (e) => { if (e.target.dataset && e.target.dataset.werff === "q") { S.werfF.q = e.target.value; const pos = e.target.selectionStart; render(); const el = document.querySelector('[data-werff="q"]'); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (x) { } } return; }
  if (e.target.dataset && e.target.hasAttribute("data-noteq")) { S.noteQ = e.target.value; const pos = e.target.selectionStart; render(); const el = document.querySelector("[data-noteq]"); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (x) { } } } });
document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.tagName === "SELECT" && el.dataset.msrf === "bron" && (el.dataset.msrPost || el.dataset.msrLot)) return msrVeld(el);   // 1.55: bron van de kostprijs (offerte aannemer / raming)
  if (el.dataset.filter) { S.filters[el.dataset.filter] = el.value; return render(); }
  if (el.dataset.cfilter) { S.cfilters[el.dataset.cfilter] = el.value; return render(); }
  if (el.dataset.werff) { S.werfF = S.werfF || { status: "actief", wie: "", q: "", groep: false }; S.werfF[el.dataset.werff] = el.type === "checkbox" ? el.checked : el.value; return render(); }
  if (el.dataset.hoursUser != null) { S.hoursUser = el.value; return render(); }
  if (el.dataset.actUitleg) { try { localStorage.setItem("bros.uitleg", el.checked ? "1" : "0"); } catch (x) { } return render(); }
  if (el.dataset.rapjaar != null) { S.rapJaar = el.value; return render(); }
  if (el.dataset.toggle) { const t = S.taken[el.dataset.toggle]; if (t && typeof tdToggle === "function" && tdToggle(t, el)) return; if (t) { if (el.checked && t.status !== "done") vierTaak(t, el); dbUpdate("taken", t.id, { status: el.checked ? "done" : "todo" }).catch(() => { }); } }
  if (el.dataset.kt && el.type === "date") { const cur = ktOf(el.dataset.pid, Number(el.dataset.kt)); if ((cur?.[el.dataset.f] || "") !== el.value) ktSave(el.dataset.pid, Number(el.dataset.kt), { [el.dataset.f]: el.value || null }); return; }
  if (el.dataset.ttoggle) { const t = S.taken[el.dataset.ttoggle]; if (t) dbUpdate("taken", t.id, { timing_klant: el.checked }).then(() => toast(el.checked ? "Timing van deze taak staat in de klantplanning" : "Timing niet meer gedeeld")).catch(() => { }); return; }
  if (el.dataset.ktoggle) { const t = S.taken[el.dataset.ktoggle]; if (t) dbUpdate("taken", t.id, { uren_klant: el.checked }).then(() => toast(el.checked ? "Uren van deze taak zijn zichtbaar voor de klant" : "Uren verborgen voor de klant")).catch(() => { }); }
  if (el.dataset.act === "ms-marge-alles") { const v = el.value; el.value = ""; if (v === "") return; return msMargeAlles(el.dataset.pid, v); }
  if (el.dataset.act === "ms-btw-alles") { const v = el.value; el.value = ""; if (v === "") return; return msBtwAlles(el.dataset.pid, Number(v)); }
  if (el.dataset.ms && el.tagName === "SELECT") return msEdit(el.dataset.ms, el.dataset.f, el.value);
  if (el.dataset.post && (el.type === "checkbox" || el.tagName === "SELECT")) return postEdit(el.dataset.post, el.dataset.f, el.value, el.checked);
  if (el.dataset.lot && el.type === "checkbox") return lotEdit(Number(el.dataset.lot), el.dataset.f, null, el.checked);
  if (el.dataset.vf && (el.tagName === "SELECT" || el.type === "date")) return vordEdit(el.dataset.vf, el.dataset.f, el.value);
  if (el.dataset.mwa && el.tagName === "SELECT" && typeof mwaEdit === "function") return mwaEdit(el.dataset.mwa, el.dataset.f, el.value);
  if (el.dataset.vgfile && typeof vgOpladen === "function") { const files = el.files; vgOpladen(el.dataset.vgfile, files).finally(() => { el.value = ""; }); return; }
  if (el.dataset.vgdeel) return dbUpdate("werf_fotos", el.dataset.vgdeel, { gedeeld_klant: el.checked }).catch(() => { });
  if (el.dataset.wd && (el.tagName === "SELECT" || el.type === "date") && typeof wdEdit === "function") return wdEdit(el.dataset.wd, el.dataset.f, el.value);
  if (el.dataset.dshare) return docShare(el.dataset.dshare, el.checked);
  if (el.dataset.faseWie != null) return swZetFase(Number(el.dataset.faseWie), el.value);   // standaardverantwoordelijken (script 040)
  if (el.dataset.stWie != null) return swZetTaak(Number(el.dataset.stWie), el.value);
  if (el.dataset.dshareA) { if (docPerAannemer()) { render(); return docAannForm(el.dataset.dshareA); } return docShare(el.dataset.dshareA, el.checked, "aannemers"); }
});
document.addEventListener("input", (e) => {
  if (e.target.dataset.filter === "q") { S.filters.q = e.target.value; render(); const i = $("[data-filter=q]"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  if (e.target.dataset.cfilter === "q") { S.cfilters.q = e.target.value; render(); const i = $("[data-cfilter=q]"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !/^(SELECT)$/.test(document.activeElement?.tagName || "")) closeModal(); if (e.key === "Enter" && e.target.classList && e.target.classList.contains("inline") && e.target.tagName === "INPUT") { e.preventDefault(); e.target.blur(); } });

/* ---------- versiecontrole: melden als er een nieuwe versie online staat ---------- */
let updateAvailable = false;
const APP_FILES = ["index.html", "app.js", "config.js", "vendor/supabase-2.45.4.js", "postcodes.js", "meetstaat-export.js", "meetstaat-import.js", "tekenen.js", "symbolen.js", "vendor/dxf-parser.js", "version.json", "klant/index.html", "klant/portaal.js", "klant/i18n-en.js", "kp-beheer.js", "pv-beheer.js", "portaal-voorbeeld.js", "agenda.js", "afspraken.js", "logo-mark.svg", "werf/index.html", "werf/werf.js", "werf/sw.js", "aannemer/index.html", "aannemer/aannemer.js", "aannemer/handleiding.json", "af-beheer.js", "deb-beheer.js", "wacht.js", "fin-planning.js", "vergaderingen.js", "plan2cad.js", "renders.js"];
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
    const bezig = $("#modalBg")?.classList.contains("show") || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") || (typeof vgOpnameBezig === "function" && vgOpnameBezig());   // 1.58: nooit herladen tijdens een opname of upload
    if (tried !== j.version && !bezig) { try { sessionStorage.setItem("pb-refetch", j.version); } catch (e) { } return hardReload(); }
    if (!updateAvailable) { updateAvailable = true; $("#updateBar")?.classList.add("show"); }
  } catch (e) { }
}

/* ---------- start ---------- */
async function boot() {
  try { const sv = JSON.parse(localStorage.getItem("bros.sort") || "null"); if (sv && sv.key) S.sort = sv; S.msKlant = localStorage.getItem("bros.msKlant") === "1"; S.msMarges = localStorage.getItem("bros.msMarges") === "1"; S.msRuimte = localStorage.getItem("bros.msRuimte") === "1"; } catch (e) { }
  if (location.hash === "#voorstellen") { S.view = "voorstellen"; history.replaceState(null, "", location.pathname); }
  if (location.hash === "#aankoop" || location.hash === "#aankoop-aannemers" || location.hash === "#aankoop-yuki") { S.view = "aankoop"; if (location.hash === "#aankoop-aannemers") S.factTab = "aannemers"; if (location.hash === "#aankoop-yuki") S.factTab = "yuki"; history.replaceState(null, "", location.pathname); }   // links uit de mails over facturen (1.49/1.50)
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
  try { await loadAll({ gefaseerd: true }); if (S.me && S.me.role === "klant") { location.replace("klant/"); return; } if (S.me && S.me.role === "aannemer") { location.replace("aannemer/"); return; } if (S.me && S.me.role === "verwerker") { loader.done("app.load"); $("#app").innerHTML = `<div class="login"><div class="card"><h1>Login van de verwerkingscomputer</h1><p>Deze login is enkel voor de verwerkingscomputer (Mac mini) en kan het Planbord niet gebruiken.</p><button class="btn" data-act="logout">Uitloggen</button></div></div>`; return; } S.ready = true; S.loadError = null; S.laadPoging = 0; render(); loader.done("app.load");
    if (!S.gestart) { S.gestart = true; subscribe(); if (typeof modulesVoorladen === "function") modulesVoorladen(); if (typeof ovAuto === "function") { setTimeout(ovAuto, 5000); setInterval(ovAuto, 120000); } if (typeof mwAuto === "function") { setTimeout(mwAuto, 8000); setInterval(mwAuto, 120000); } setInterval(checkVersion, 5 * 60 * 1000); setTimeout(checkVersion, 20000); setInterval(() => { if (document.visibilityState === "visible") refetch("instellingen"); }, 30 * 60000); } }   // 1.48.2: instellingen (o.a. de hartslag van het Drive-script) elk half uur vers   // 1.48: na opnieuw inloggen niet dubbel abonneren
  catch (e) {
    loader.fail(); S.loadError = e.message || String(e); render();
    // 1.48: even geen verbinding (Supabase/netwerk): zelf opnieuw proberen na 5 s, 15 s, 60 s, daarna elke 2 min.
    const wacht = [5000, 15000, 60000][S.laadPoging || 0] || 120000; S.laadPoging = (S.laadPoging || 0) + 1;
    clearTimeout(S.laadTimer); S.laadTimer = setTimeout(() => { if (!S.ready && S.session) start(); }, wacht);
  }
}
window.addEventListener("online", () => { if (!S.ready && S.session && S.loadError) start(); });
boot();
