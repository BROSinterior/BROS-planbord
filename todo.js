/* =====================================================================
   BROS Planbord — to-do's per verantwoordelijke (v1.63, databasescript 059)
   De actiepunten van een notitie of vergadering worden per verantwoordelijke één taak ("To do's · <verslag>")
   met de punten als checklist (taak_punten). Alle punten afgevinkt = taak klaar (de databank houdt dat bij);
   de taak zelf afvinken = alle open punten af. Een groot punt maak je los tot een aparte taak.
   Hooks in app.js: klantTag (☑ 2/5 in takenlijsten), taakformulier (checklist), notitieformulier (per persoon),
   afvinken in een takenlijst. vergaderingen.js: punt → to-do, verslag → notitie.
   ===================================================================== */
const tdOk = () => (typeof schemaV === "function") && !!S.taak_punten;
const tdPunten = (tid) => Object.values(S.taak_punten || {}).filter(p => p.taak_id === tid && !p.los_taak_id)
  .sort((a, b) => (a.volgorde || 0) - (b.volgorde || 0) || (a.created_at || "").localeCompare(b.created_at || ""));
const tdLos = (tid) => Object.values(S.taak_punten || {}).filter(p => p.taak_id === tid && p.los_taak_id);
const tdTel = (tid) => { const ps = tdPunten(tid); return { tot: ps.length, klaar: ps.filter(p => p.klaar).length }; };
function tdTag(t) {
  if (!t || !t.bundel || !tdOk()) return "";
  const c = tdTel(t.id);
  return ` <span class="pill td-tel${c.tot && c.klaar === c.tot ? " af" : ""}" title="To-dotaak: ${c.klaar} van ${c.tot} punten afgevinkt">☑ ${c.klaar}/${c.tot}</span>`;
}
/* aantal open / totaal actiepunten van een notitie: punten van de to-dotaken + gewone taken */
function tdNoteTel(nid) {
  const ts = Object.values(S.taken).filter(t => t.notitie_id === nid);
  let tot = 0, open = 0;
  ts.forEach(t => { if (t.bundel && tdOk()) { const c = tdTel(t.id); tot += c.tot; open += c.tot - c.klaar; } else { tot += 1; if (t.status !== "done") open += 1; } });
  return { tot, open };
}
const tdWie = (t) => t.assignee ? (userById(t.assignee).name || "?") : t.contact_id ? ((S.contacten[t.contact_id] || {}).naam || "contact") : "nog te bepalen";

/* de checklist zelf (in het taakformulier, de notitie en het vergaderverslag) */
function tdLijst(t, o = {}) {
  const ps = tdPunten(t.id); const los = tdLos(t.id);
  const rij = (p) => `<li class="td-p${p.klaar ? " klaar" : ""}" data-td-p="${p.id}"><label><input type="checkbox" data-td-klaar="${p.id}" ${p.klaar ? "checked" : ""} aria-label="Klaar"><span class="td-t">${esc(p.tekst)}</span></label>
      <span class="td-m">${p.deadline ? `<span class="num${!p.klaar && p.deadline < todayIso ? " td-laat" : ""}">${fmt(p.deadline)}</span>` : ""}${p.bron_sec != null && t.vergadering_id ? ` <span class="muted" title="bronfragment in de opname">▶ ${Math.floor(p.bron_sec / 60)}:${String(Math.floor(p.bron_sec % 60)).padStart(2, "0")}</span>` : ""}${p.ontwerp_feedback_id ? ` <span class="pill kl" title="Feedback van de klant in het ontwerptraject">feedback</span>` : ""}
      ${o.alleenLezen ? "" : `<button type="button" class="td-k" data-td-los="${p.id}" title="Losmaken tot een aparte taak (bv. een groot werk)">Losmaken</button>${p.vergader_punt_id || p.ontwerp_feedback_id ? "" : `<button type="button" class="td-k" data-td-weg="${p.id}" title="Punt verwijderen" aria-label="Verwijderen">✕</button>`}`}</span></li>`;
  return `<div class="td-box" data-td-box="${t.id}"><ul class="td-lijst">${ps.map(rij).join("") || `<li class="muted" style="font-size:12px">Nog geen punten.</li>`}</ul>
    ${los.length ? `<div class="muted" style="font-size:12px;margin:4px 0 0">Losgemaakt: ${los.map(p => S.taken[p.los_taak_id] ? `<button type="button" class="wj-t" data-edit-task="${p.los_taak_id}">${esc(p.tekst.slice(0, 60))}</button>` : esc(p.tekst.slice(0, 60))).join(" · ")}</div>` : ""}
    ${o.alleenLezen ? "" : `<div class="td-nieuw"><input class="inline" data-td-nieuw-t="${t.id}" placeholder="+ punt toevoegen" maxlength="1000"><input class="inline" type="date" data-td-nieuw-d="${t.id}" title="Deadline (optioneel)"><button type="button" class="btn sm" data-td-nieuw="${t.id}">Toevoegen</button></div>`}</div>`;
}
const tdTelPill = (t) => { const c = tdTel(t.id); return `<span class="pill ${c.tot && c.klaar === c.tot ? "done" : c.klaar ? "busy" : "todo"}" style="font-size:11px" data-td-tel="${t.id}">${c.klaar}/${c.tot}</span>`; };
/* in het taakformulier van een to-dotaak */
function tdVelden(t) {
  if (!t || !t.bundel || !tdOk()) return "";
  const c = tdTel(t.id);
  return `<div class="field span2"><label>Checklist ${tdTelPill(t)} <span class="muted" style="font-weight:400">— de taak is klaar als alle punten afgevinkt zijn</span></label>${tdLijst(t)}</div>`;
}
/* per verantwoordelijke, in het notitieformulier (en het vergaderverslag) */
function tdBlokken(taken, o = {}) {
  const bs = taken.filter(t => t.bundel).sort((a, b) => tdWie(a).localeCompare(tdWie(b)));
  if (!bs.length || !tdOk()) return "";
  return `<div class="td-blokken">${bs.map(t => { const c = tdTel(t.id);
    return `<div class="td-blok"><div class="td-kop"><b>${esc(tdWie(t))}</b>${t.contact_id ? ` <span class="pill kl">${esc(CONTACT_ROL[(contactsOf(t.project_id).find(x => x.c.id === t.contact_id) || {}).rol] || "contact")}</span>` : ""}
      ${tdTelPill(t)}${t.eind ? `<span class="muted num" style="font-size:12px">tegen ${fmt(t.eind)}</span>` : ""}
      <button type="button" class="btn ghost sm" data-edit-task="${t.id}" style="margin-left:auto">Taak openen</button></div>${tdLijst(t, o)}</div>`; }).join("")}</div>`;
}

/* ---------- acties ---------- */
async function tdHerlaad(tid) {
  const [a, b] = await Promise.all([sb.from("taken").select("*").eq("id", tid).maybeSingle(), sb.from("taak_punten").select("*").eq("taak_id", tid)]);
  if (a.data) S.taken[a.data.id] = a.data; else if (!a.error) delete S.taken[tid];
  if (!b.error) { Object.values(S.taak_punten).filter(p => p.taak_id === tid).forEach(p => delete S.taak_punten[p.id]); (b.data || []).forEach(p => S.taak_punten[p.id] = p); }
  IDX = null; tdTeken(tid);
}
/* alle open checklists van die taak opnieuw tekenen (ook in een geopend formulier), en de pagina erachter */
function tdTeken(tid) {
  const t = S.taken[tid];
  document.querySelectorAll(`[data-td-tel="${tid}"]`).forEach(el => { if (t) { const tmp = document.createElement("div"); tmp.innerHTML = tdTelPill(t); el.replaceWith(tmp.firstElementChild); } });
  document.querySelectorAll(`[data-td-box="${tid}"]`).forEach(el => { if (!t) { el.remove(); return; } const tmp = document.createElement("div"); tmp.innerHTML = tdLijst(t, { alleenLezen: el.closest("[data-td-ro]") != null }); el.replaceWith(tmp.firstElementChild); });
  render();
}
async function tdKlaar(pid, klaar) {
  const p = S.taak_punten[pid]; if (!p) return;
  const t = S.taken[p.taak_id]; const c0 = tdTel(p.taak_id);
  try { await dbUpdate("taak_punten", pid, { klaar }); } catch (e) { return tdTeken(p.taak_id); }
  await tdHerlaad(p.taak_id);
  const c = tdTel(p.taak_id);
  if (klaar && c.tot && c.klaar === c.tot && c0.klaar < c0.tot) { if (typeof vierTaak === "function") vierTaak(t, null); toast("Alle punten af — de taak is klaar"); }
}
async function tdNieuw(tid) {
  const ti = document.querySelector(`[data-td-nieuw-t="${tid}"]`), di = document.querySelector(`[data-td-nieuw-d="${tid}"]`);
  const tekst = (ti && ti.value || "").trim(); if (!tekst) { if (ti) ti.focus(); return; }
  const vol = Math.max(0, ...tdPunten(tid).map(p => p.volgorde || 0), ...tdLos(tid).map(p => p.volgorde || 0)) + 1;
  try { await dbInsert("taak_punten", { taak_id: tid, tekst, deadline: (di && di.value) || null, volgorde: vol, notitie_id: (S.taken[tid] || {}).notitie_id || null }); } catch (e) { return; }
  await tdHerlaad(tid);
  const n = document.querySelector(`[data-td-nieuw-t="${tid}"]`); if (n) n.focus();
}
async function tdWeg(pid) {
  const p = S.taak_punten[pid]; if (!p || !confirm(`Punt "${p.tekst.slice(0, 80)}" verwijderen?`)) return;
  try { await dbDelete("taak_punten", pid); } catch (e) { return; }
  await tdHerlaad(p.taak_id);
}
async function tdMaakLos(pid) {
  const p = S.taak_punten[pid]; if (!p) return;
  if (!confirm(`"${p.tekst.slice(0, 80)}" losmaken tot een aparte taak? Het punt verdwijnt uit de checklist (en blijft gekoppeld aan het verslag).`)) return;
  const { data, error } = await sb.rpc("todo_punt_los", { p_punt: pid });
  if (error) { toast(error.message, 6000); return; }
  const nt = await sb.from("taken").select("*").eq("id", data.taak_id).single(); if (nt.data) S.taken[nt.data.id] = nt.data;
  if (p.vergader_punt_id && typeof vgHerlaadPunt === "function") await vgHerlaadPunt(p.vergader_punt_id);
  await tdHerlaad(p.taak_id); toast("Losgemaakt: er is een aparte taak", 4000);
}
/* punten toevoegen (notitie/vergadering/los) — gegroepeerd per verantwoordelijke in de databank */
async function tdToevoegen(pid, nid, vid, punten) {
  const { data, error } = await sb.rpc("todo_toevoegen", { p_project: pid, p_notitie: nid || null, p_vergadering: vid || null, p_punten: punten });
  if (error) { toast("To-do's niet aangemaakt: " + error.message, 7000); return null; }
  await Promise.all((data.taken || []).map(id => tdHerlaad(id)));
  return data;
}
/* de to-dotaak in een takenlijst afvinken = alle open punten af; terug open zetten gaat per punt */
function tdToggle(t, el) {
  if (!t || !t.bundel || !tdOk()) return false;
  const c = tdTel(t.id);
  if (!el.checked) { el.checked = t.status === "done"; toast("Vink in de checklist het punt af dat nog open is."); taskForm(t); return true; }
  if (c.tot - c.klaar > 0 && !confirm(`Alle ${c.tot - c.klaar} open punten van "${t.titel}" afvinken?`)) { el.checked = false; return true; }
  if (typeof vierTaak === "function") vierTaak(t, el);
  dbUpdate("taken", t.id, { status: "done" }).then(() => tdHerlaad(t.id)).catch(() => { });
  return true;
}

document.addEventListener("change", (e) => {
  const el = e.target; if (!el.dataset) return;
  if (el.dataset.tdKlaar) { e.stopPropagation(); tdKlaar(el.dataset.tdKlaar, el.checked); }
}, true);
document.addEventListener("click", (e) => {
  const el = e.target.closest && e.target.closest("[data-td-nieuw],[data-td-weg],[data-td-los]"); if (!el) return;
  e.preventDefault(); e.stopPropagation();
  if (el.dataset.tdNieuw) return tdNieuw(el.dataset.tdNieuw);
  if (el.dataset.tdWeg) return tdWeg(el.dataset.tdWeg);
  if (el.dataset.tdLos) return tdMaakLos(el.dataset.tdLos);
}, true);
document.addEventListener("keydown", (e) => {
  const el = e.target; if (e.key !== "Enter" || !el.dataset || !el.dataset.tdNieuwT) return;
  e.preventDefault(); e.stopPropagation(); tdNieuw(el.dataset.tdNieuwT);
}, true);

(function () {
  const st = document.createElement("style");
  st.textContent = `.td-box{margin:2px 0 0}.td-lijst{list-style:none;margin:0;padding:0}
  .td-p{display:flex;align-items:flex-start;gap:8px;padding:5px 0;border-bottom:1px solid var(--line)}.td-p:last-child{border-bottom:0}
  .td-p label{display:flex;gap:8px;align-items:flex-start;flex:1;min-width:0;cursor:pointer;margin:0;font-weight:400}
  .td-p input[type=checkbox]{width:17px;height:17px;flex:0 0 auto;margin-top:2px}.td-t{white-space:pre-line;word-break:break-word}
  .td-p.klaar .td-t{text-decoration:line-through;color:var(--muted)}.td-m{display:flex;gap:6px;align-items:center;font-size:12px;flex:0 0 auto}
  .td-laat{color:var(--crit)}.td-k{border:0;background:none;color:var(--muted);font-size:12px;cursor:pointer;padding:2px 4px}.td-k:hover{color:var(--ink)}
  .td-nieuw{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap}.td-nieuw input:first-child{flex:1;min-width:160px}
  .td-blokken{display:grid;gap:10px;margin-bottom:10px}.td-blok{border:1px solid var(--line);border-radius:10px;padding:8px 12px}
  .td-kop{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:2px}.pill.td-tel{font-size:11px}.pill.td-tel.af{opacity:.7}
  @media (max-width:640px){.td-p{flex-wrap:wrap}.td-m{padding-left:25px}}`;
  document.head.appendChild(st);
})();
