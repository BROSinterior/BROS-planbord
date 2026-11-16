/* =====================================================================
   BROS Planbord — Mijn werk (v1.73)
   Eén lijst per persoon met alles wat op hem/haar wacht, uit alle projecten, gesorteerd op datum:
     taken · to-do's (de open punten van een to-do-taak) · werfpunten · afspraken (taken op jouw naam)
     keuzes, vragen van klanten en meerwerkaanvragen (op projecten waar je lead bent; beheer: alle projecten)
   Groepen: Te laat · Deze week · Volgende week · Later · Zonder datum. "Wacht op jou" (Overzicht) blijft het
   korte lijstje voor vandaag en morgen; de aparte lijsten per project blijven voor de detailopvolging.
   Geladen vóór app.js; app.js toont dit als hoofdtabblad "Mijn werk".
   ===================================================================== */
const MW = { wie: null, soort: "" };
const MW_SOORT = { taak: ["Taak", "✓"], todo: ["To-do", "☑"], werf: ["Werfpunt", "⚑"], afspraak: ["Afspraak", "📅"], keuze: ["Keuze", "◇"], vraag: ["Vraag", "?"], meerwerk: ["Meerwerk", "＋"] };
const MW_MEERV = { taak: "Taken", todo: "To-do's", werf: "Werfpunten", keuze: "Keuzes", vraag: "Vragen", meerwerk: "Meerwerk" };
const mwWie = () => (MW.wie && isBeheer() && S.profiles[MW.wie]) ? MW.wie : S.me.id;
const mwProj = (pid) => { const p = S.projecten[pid]; return p ? (p.nummer ? p.nummer + " · " : "") + projName(p) : ""; };
const mwLead = (pid, uid) => { const p = S.projecten[pid]; return !!p && (p.lead === uid || (uid === S.me.id && isBeheer() && !p.lead)); };

/** alle items voor persoon uid: { soort, titel, sub, datum, laat, taak?, pid, tab } */
function mwItems(uid) {
  const uit = [];
  Object.values(S.taken || {}).filter(t => t.status !== "done" && t.assignee === uid).forEach(t => {
    const punten = typeof tdPunten === "function" ? tdPunten(t.id).filter(x => !x.klaar) : [];
    const soort = t.vaststelling_id ? "werf" : t.afspraak ? "afspraak" : (t.bundel || punten.length) ? "todo" : "taak";
    const pDl = punten.map(x => x.deadline).filter(Boolean).sort()[0];
    const datum = t.afspraak ? (t.start || t.eind) : [t.eind, pDl].filter(Boolean).sort()[0] || null;
    const sub = punten.length ? punten.slice(0, 3).map(x => x.tekst.split("\n")[0].slice(0, 60)).join(" · ") + (punten.length > 3 ? ` · +${punten.length - 3}` : "") : (t.notitie || "").split("\n")[0].slice(0, 80);
    uit.push({ soort, titel: t.titel, sub, datum, tijd: t.afspraak ? t.afspraak_van : null, taak: t, pid: t.project_id, tab: soort === "werf" ? "werf" : "taken", n: punten.length });
  });
  const lead = (r) => r && mwLead(r.project_id, uid);
  Object.values(S.keuzes || {}).filter(k => lead(k) && (k.status === "gekozen" || k.status === "open")).forEach(k => uit.push({ soort: "keuze",
    titel: (k.status === "gekozen" ? "Bevestigen: " : "Klant kiest: ") + (k.onderwerp || ""), sub: k.status === "gekozen" ? "gekozen" + (k.gekozen_naam ? " door " + k.gekozen_naam : "") : "nog niet gekozen door de klant", datum: k.status === "gekozen" ? (typeof lokDag === "function" && k.gekozen_op ? lokDag(k.gekozen_op) : todayIso) : k.deadline || null, pid: k.project_id, tab: "keuzes" }));
  (typeof voorstellenOpen === "function" ? voorstellenOpen() : []).filter(v => v.voorgestelde_user === uid || (!v.voorgestelde_user && lead(v))).forEach(v => uit.push({ soort: "vraag",
    titel: (v.onderwerp === "klacht" ? "Klacht: " : "") + (v.titel || "Vraag van de klant"), sub: v.urgentie === "hoog" ? "dringend" : "vraag van de klant", datum: typeof lokDag === "function" && v.created_at ? lokDag(v.created_at) : null, pid: v.project_id, tab: "vragen", dringend: v.urgentie === "hoog" }));
  Object.values(S.meerwerk_aanvragen || {}).filter(a => lead(a) && a.status === "ingediend").forEach(a => uit.push({ soort: "meerwerk",
    titel: a.titel || "Meerwerk aangevraagd", sub: "aangevraagd door de klant" + (a.ruimte ? " · " + a.ruimte : ""), datum: typeof lokDag === "function" && a.created_at ? lokDag(a.created_at) : null, pid: a.project_id, tab: "meetstaat" }));
  uit.forEach(it => { it.laat = !!it.datum && it.datum < todayIso && ["taak", "todo", "werf", "keuze"].includes(it.soort); });
  return uit.sort((a, b) => (a.datum ? 0 : 1) - (b.datum ? 0 : 1) || String(a.datum || "").localeCompare(String(b.datum || "")) || String(a.tijd || "").localeCompare(String(b.tijd || "")) || (a.titel || "").localeCompare(b.titel || ""));
}
function mwGroep(it) {
  if (it.laat) return "laat";
  if (!it.datum) return "zonder";
  const zo = addDays(mondayOf(todayIso), 6), zo2 = addDays(zo, 7);
  return it.datum <= zo ? "week" : it.datum <= zo2 ? "volgende" : "later";
}
const MW_GROEPEN = [["laat", "Te laat"], ["week", "Deze week"], ["volgende", "Volgende week"], ["later", "Later"], ["zonder", "Zonder datum"]];
function mwRij(it, eigen) {
  const [lbl, ic] = MW_SOORT[it.soort]; const t = it.taak;
  const dag = it.datum ? (it.datum === todayIso ? "vandaag" : it.datum === addDays(todayIso, 1) ? "morgen" : fmt(it.datum)) + (it.tijd ? " " + String(it.tijd).slice(0, 5) : "") : "";
  const open = t ? `data-edit-task="${t.id}"` : `data-open="${esc(it.pid)}" data-optab="${esc(it.tab)}"`;
  const vink = t && eigen && !t.afspraak ? `<input type="checkbox" class="task-check" data-toggle="${t.id}" aria-label="Klaar: ${esc(t.titel)}">` : `<span class="mw-ic" aria-hidden="true">${ic}</span>`;
  return `<div class="mw-it${it.laat ? " mw-laat" : ""}">${vink}
    <div class="mw-tx"><button type="button" class="mw-t" ${open}>${esc(it.titel)}</button><small><span class="mw-soort mw-s-${it.soort}">${lbl}${it.n ? " " + it.n : ""}</span> ${esc(mwProj(it.pid))}${it.sub ? " · " + esc(it.sub) : ""}</small></div>
    <div class="mw-dag${it.laat || it.dringend ? " crit" : ""}">${esc(dag)}</div>
    <button class="btn sm ghost" data-open="${esc(it.pid)}" data-optab="${esc(it.tab)}" title="Project openen">Project</button></div>`;
}
function vMijnWerk() {
  const uid = mwWie(); const eigen = uid === S.me.id; const alles = mwItems(uid);
  const lijst = alles.filter(it => !MW.soort || it.soort === MW.soort || (MW.soort === "taak" && it.soort === "afspraak"));
  const tel = (s) => alles.filter(it => it.soort === s || (s === "taak" && it.soort === "afspraak")).length;
  const chips = [["", "Alles", alles.length], ...["taak", "todo", "werf", "keuze", "vraag", "meerwerk"].map(s => [s, MW_MEERV[s], tel(s)])].filter(([s, , n]) => !s || n);
  const kiezer = isBeheer() ? `<select data-mw="wie" aria-label="Van wie">${Object.values(S.profiles).filter(u => u.active !== false && ["beheer", "medewerker"].includes(u.role)).sort((a, b) => (a.name || "").localeCompare(b.name || "")).map(u => `<option value="${u.id}" ${u.id === uid ? "selected" : ""}>${esc(u.id === S.me.id ? "Mijn werk" : u.name)}</option>`).join("")}</select>` : "";
  const nLaat = alles.filter(it => it.laat).length;
  const groepen = MW_GROEPEN.map(([g, titel]) => { const r = lijst.filter(it => mwGroep(it) === g); return r.length ? `<section class="mw-g"><h4>${titel} <span class="cnt"${g === "laat" ? ' style="background:var(--crit);color:#fff"' : ""}>${r.length}</span></h4>${r.map(it => mwRij(it, eigen)).join("")}</section>` : ""; }).join("");
  return `<div class="page-head"><div><h1>${eigen ? "Mijn werk" : "Werk van " + esc(userById(uid).name)}</h1><div class="sub">${alles.length ? `${alles.length} open punten${nLaat ? ` · <b style="color:var(--crit)">${nLaat} te laat</b>` : ""} — taken, to-do's, werfpunten, keuzes en vragen uit alle projecten` : "Niets open — alles bij."}</div></div><div class="actions">${kiezer}</div></div>
    <div class="mw-chips" role="group" aria-label="Soort">${chips.map(([s, l, n]) => `<button type="button" data-mw="soort" data-v="${s}" aria-pressed="${MW.soort === s}">${l} <span class="cnt">${n}</span></button>`).join("")}</div>
    <div class="panel"><div class="panel-body mw">${groepen || `<div class="empty"><b>Niets in deze lijst</b>${MW.soort ? "Kies een andere soort." : "Alles bij."}</div>`}</div></div>`;
}
const mwTeller = () => S.me ? mwItems(S.me.id).filter(it => it.laat).length : 0;
document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("[data-mw='soort']"); if (!b) return;
  MW.soort = b.dataset.v || ""; render();
});
document.addEventListener("change", (e) => {
  const s = e.target.closest && e.target.closest("select[data-mw='wie']"); if (!s) return;
  MW.wie = s.value; MW.soort = ""; render();
});
