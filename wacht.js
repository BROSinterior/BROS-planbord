/* =====================================================================
   BROS Planbord — "Wacht op jou" (v1.51)
   Eén lijst bovenaan het Overzicht met alles wat op een actie van jou wacht, uit alle modules samen:
   - Te laat: je taken met een verstreken einddatum — afvinken of in één klik verzetten (volgende werkdag, +1 week,
     volgende maandag), ook allemaal tegelijk; ongedaan maken kan. Beheer kan wisselen naar de taken van het hele team.
     Taken met een afspraak (agenda + mail aan de klant) worden nooit verzet vanuit deze lijst.
   - Vandaag en morgen: je taken en afspraken die nu vallen.
   - Van klanten en aannemers: werfpunten te beoordelen, meerwerk aangevraagd, keuzes gemaakt (te bevestigen) of over de
     deadline, prijzen ontvangen, vragen via de assistent, offertes waarover de klant besliste (beheer: alle projecten;
     medewerkers: de projecten waarvan ze lead zijn).
   - Facturen (beheer): herinneringen ter goedkeuring en aannemersfacturen te behandelen.
   "Later" verbergt een melding 3 dagen; "Gezien" verbergt een melding tot ze verandert (alleen in deze browser).
   Geladen vóór app.js; app.js roept vWachtOpJou en acctMenu aan (via typeof).
   ===================================================================== */
const WJ = { open: {}, undo: null, bezig: false, toonVerborgen: false };
const wjTeam = () => { if (!isBeheer()) return false; if (WJ.teamSessie != null) return WJ.teamSessie; try { return localStorage.getItem("bros.wj.team") === "1"; } catch (e) { return false; } };
const wjSleutel = () => "bros.wj.weg." + (S.me ? S.me.id : "");
function wjWeg() { try { return JSON.parse(localStorage.getItem(wjSleutel()) || "{}") || {}; } catch (e) { return {}; } }
function wjZetWeg(k, stempel, dagen) {
  try {
    const w = wjWeg(); w[k] = { s: String(stempel || ""), tot: dagen ? addDays(todayIso, dagen) : "" };
    const ks = Object.keys(w); if (ks.length > 300) ks.slice(0, ks.length - 300).forEach(x => delete w[x]);
    localStorage.setItem(wjSleutel(), JSON.stringify(w));
  } catch (e) { }
}
const wjVerborgen = (it, w) => { const x = w[it.k]; return !!x && x.s === String(it.stempel || "") && (!x.tot || x.tot > todayIso); };
const wjDag = (s) => { s = String(s || ""); return s.length > 10 && typeof lokDag === "function" ? lokDag(s) : s.slice(0, 10); };   // tijdstempel → lokale datum (01:30 vandaag is niet "gisteren")
const wjDagen = (s) => s ? Math.round((pd(todayIso).getTime() - pd(wjDag(s)).getTime()) / DAY) : 0;
const wjGeleden = (s) => { const n = wjDagen(s); return n <= 0 ? "vandaag" : n === 1 ? "gisteren" : n + " d geleden"; };
const wjWerkdag = (s) => { let d = s; while ([0, 6].includes(pd(d).getUTCDay())) d = addDays(d, 1); return d; };   // zaterdag/zondag → maandag
const wjMorgen = () => wjWerkdag(addDays(todayIso, 1));
const wjVolgendeMaandag = () => addDays(mondayOf(todayIso), 7);
const wjTaakDag = (t) => t.afspraak ? (t.start || t.eind) : t.eind;
const wjBinnenkort = (t) => { const d = wjTaakDag(t); return !!d && d >= todayIso && d <= wjMorgen(); };   // vandaag t.e.m. de volgende werkdag
const WJ_WD = ["zo", "ma", "di", "wo", "do", "vr", "za"];
const wjDagLabel = (d) => d === todayIso ? "vandaag" : d === addDays(todayIso, 1) ? "morgen" : WJ_WD[pd(d).getUTCDay()] + " " + fmt(d);
const wjMijnProject = (pid) => { const p = S.projecten[pid]; return !!p && (isBeheer() || p.lead === S.me.id); };
const wjProj = (pid) => { const p = S.projecten[pid]; return p ? (p.nummer ? p.nummer + " · " : "") + projName(p) : ""; };
const wjContact = (id) => { const c = (S.contacten || {})[id]; return c ? (c.bedrijf || c.naam || "") : ""; };

/* ---------- de bronnen ---------- */
function wjTaken() {
  const team = wjTeam(); const open = Object.values(S.taken).filter(t => t.status !== "done" && (team || t.assignee === S.me.id));
  const laat = open.filter(isLate).sort((a, b) => (a.eind || "").localeCompare(b.eind || "") || (a.titel || "").localeCompare(b.titel || ""));
  const dag = wjTaakDag;
  const nu = Object.values(S.taken).filter(t => t.status !== "done" && t.assignee === S.me.id && wjBinnenkort(t) && !isLate(t))
    .sort((a, b) => (dag(a) || "").localeCompare(dag(b) || "") || (a.afspraak_van || "").localeCompare(b.afspraak_van || ""));
  return { laat, nu, dag };
}
function wjExtern() {
  const uit = []; const mag = (r) => r && wjMijnProject(r.project_id);
  const v16 = schemaV() >= 16, v35 = schemaV() >= 35;
  if (v16) Object.values(S.vaststellingen || {}).filter(v => mag(v) && v.te_beoordelen && v.status === "open").forEach(v => uit.push({ k: "vs:" + v.id, stempel: v.updated_at || v.created_at, ic: "⚑", toon: "warn", titel: "Werfpunt te beoordelen: " + (v.titel || "zonder titel"), sub: wjProj(v.project_id) + (v.gemeld_door_aannemer ? " · gemeld door " + (wjContact(v.gemeld_door_aannemer) || "aannemer") : " · gemeld door de klant"), wanneer: v.created_at, pid: v.project_id, tab: "werf" }));
  if (v35) Object.values(S.meerwerk_aanvragen || {}).filter(a => mag(a) && a.status === "ingediend").forEach(a => uit.push({ k: "mw:" + a.id, stempel: a.updated_at || a.created_at, ic: "＋", toon: "warn", titel: "Meerwerk aangevraagd: " + (a.titel || "zonder titel"), sub: wjProj(a.project_id) + (a.ruimte ? " · " + a.ruimte : ""), wanneer: a.created_at, pid: a.project_id, tab: "meetstaat" }));
  if (v35) Object.values(S.keuzes || {}).filter(k => mag(k) && (k.status === "gekozen" || (k.status === "open" && k.deadline && k.deadline < todayIso))).forEach(k => uit.push(k.status === "gekozen"
    ? { k: "kz:" + k.id, stempel: k.gekozen_op || k.updated_at, ic: "✓", toon: "accent", titel: "Keuze gemaakt — bevestigen: " + (k.onderwerp || ""), sub: wjProj(k.project_id) + (k.gekozen_naam ? " · door " + k.gekozen_naam : ""), wanneer: k.gekozen_op, pid: k.project_id, tab: "keuzes" }
    : { k: "kzl:" + k.id, stempel: k.deadline, ic: "⏱", toon: "warn", titel: "Klant moet nog kiezen: " + (k.onderwerp || ""), sub: wjProj(k.project_id) + " · deadline " + fmt(k.deadline), wanneer: k.deadline, pid: k.project_id, tab: "keuzes" }));
  if (schemaV() >= 25) Object.values(S.prijsaanvragen || {}).filter(a => mag(a) && a.status === "ingediend").forEach(a => uit.push({ k: "pa:" + a.id, stempel: a.ingediend_op || a.updated_at, ic: "€", toon: "accent", titel: "Prijs ontvangen van " + (wjContact(a.contact_id) || "aannemer") + (a.titel ? ": " + a.titel : ""), sub: wjProj(a.project_id), wanneer: a.ingediend_op || a.updated_at, pid: a.project_id, tab: "meetstaat" }));
  if (schemaV() >= 23) voorstellenOpen().filter(v => mag(v) || v.voorgestelde_user === S.me.id).forEach(v => uit.push({ k: "tv:" + v.id, stempel: v.created_at, ic: "?", toon: v.urgentie === "hoog" || v.onderwerp === "klacht" ? "crit" : "accent", titel: (v.onderwerp === "klacht" ? "Klacht: " : "Vraag van de klant: ") + (v.titel || ""), sub: wjProj(v.project_id) + (v.urgentie === "hoog" ? " · dringend" : ""), wanneer: v.created_at, pid: v.project_id, tab: "vragen" }));
  if (schemaV() >= 13) Object.values(S.goedkeuringen || {}).filter(g => mag(g) && (g.status === "akkoord" || g.status === "geweigerd") && g.beslist_op && wjDagen(g.beslist_op) <= 7).forEach(g => uit.push({ k: "gk:" + g.id, stempel: g.beslist_op, ic: g.status === "akkoord" ? "✓" : "✕", toon: g.status === "akkoord" ? "ok" : "crit", titel: g.soort === "overeenkomst" ? "Overeenkomst " + (g.status === "akkoord" ? "ondertekend" : "geweigerd") + (g.titel ? ": " + g.titel : "") : (g.soort === "meerwerk" ? "Meerwerk " : "Offerte ") + (g.status === "akkoord" ? "goedgekeurd" : "geweigerd") + " door de klant" + (g.titel ? ": " + g.titel : ""), sub: wjProj(g.project_id) + (g.beslist_naam ? " · " + g.beslist_naam : ""), wanneer: g.beslist_op, pid: g.project_id, tab: g.soort === "overeenkomst" ? "dossier" : "meetstaat", info: true }));
  return uit.sort((a, b) => ({ crit: 0, warn: 1, accent: 2, ok: 3 }[a.toon] - { crit: 0, warn: 1, accent: 2, ok: 3 }[b.toon]) || String(a.wanneer || "").localeCompare(String(b.wanneer || "")));
}
function wjFacturen() {
  if (!isBeheer()) return [];
  const uit = []; const nK = typeof debTeDoen === "function" ? debTeDoen().length : 0, nA = typeof afbTeDoen === "function" ? afbTeDoen().length : 0;
  if (nK) uit.push({ k: "fk", stempel: nK, ic: "€", toon: "warn", titel: nK === 1 ? "1 betalingsherinnering wacht op je goedkeuring" : nK + " betalingsherinneringen wachten op je goedkeuring", sub: "Facturen › Klanten — er vertrekt niets zonder jouw akkoord", nav: "aankoop", ft: "klanten" });
  if (nA) uit.push({ k: "fa", stempel: nA, ic: "€", toon: "accent", titel: nA === 1 ? "1 aannemersfactuur te behandelen" : nA + " aannemersfacturen te behandelen", sub: "Facturen › Aannemers — goedkeuren, vraag stellen of betaald zetten", nav: "aankoop", ft: "aannemers" });
  return uit;
}

/** Staat deze (eigen) taak al in "Wacht op jou"? (te laat, of vandaag/morgen) — app.js toont ze dan niet nog eens bij Mijn volgende taken. */
function wjInLijst(t) { return isLate(t) || wjBinnenkort(t); }
/* ---------- weergave ---------- */
function wjTaakRij(t, opties) {
  const p = S.projecten[t.project_id]; const laat = isLate(t); const n = laat ? wjDagen(t.eind) : 0;
  const wie = opties && opties.wie && t.assignee !== S.me.id ? (t.assignee ? userById(t.assignee).name : wjContact(t.contact_id) || "niemand") : "";
  const dag = wjTaakDag(t);
  const wanneer = laat ? `<span style="color:var(--crit)">${fmt(t.eind)} · ${n === 1 ? "1 dag" : n + " dagen"} te laat</span>` : t.afspraak ? `📅 ${wjDagLabel(dag)}${t.afspraak_van ? " " + esc(String(t.afspraak_van).slice(0, 5)) : ""}` : wjDagLabel(dag);
  const knoppen = laat && !t.afspraak ? `<button class="btn sm ghost" data-wj-act="verzet" data-id="${t.id}" data-naar="${wjMorgen()}" title="Naar ${fmtLong(wjMorgen())}">${pd(wjMorgen()).getUTCDay() === 1 && wjDagen(wjMorgen()) < -1 ? "Maandag" : "Morgen"}</button><button class="btn sm ghost" data-wj-act="verzet" data-id="${t.id}" data-naar="${wjWerkdag(addDays(todayIso, 7))}" title="Naar ${fmtLong(wjWerkdag(addDays(todayIso, 7)))}">+1 week</button>`
    : laat ? `<span class="muted" style="font-size:12px" title="Een afspraak verzet je in de taak zelf (agenda en mail aan de deelnemers)">afspraak</span>` : "";
  return `<div class="wj-it"><input type="checkbox" class="task-check" data-toggle="${t.id}" aria-label="Klaar: ${esc(t.titel)}">
    <div class="wj-tx"><button type="button" class="wj-t" data-edit-task="${t.id}">${esc(t.titel)}</button><small>${p ? esc(wjProj(p.id)) + " · " : ""}${wie ? `<b class="wj-wie">${esc(wie)}</b> · ` : ""}${wanneer}</small></div>
    <div class="wj-acts">${knoppen}</div></div>`;
}
function wjItemRij(it) {
  const doel = it.nav ? `data-wj-act="nav" data-view="${esc(it.nav)}" data-ft="${esc(it.ft || "")}"` : `data-open="${esc(it.pid)}" data-optab="${esc(it.tab)}"`;
  return `<div class="wj-it wj-${it.toon}"><span class="wj-ic" aria-hidden="true">${esc(it.ic)}</span>
    <div class="wj-tx"><button type="button" class="wj-t" ${doel}>${esc(it.titel)}</button><small>${esc(it.sub)}${it.wanneer ? " · " + esc(wjGeleden(it.wanneer)) : ""}</small></div>
    <div class="wj-acts"><button class="btn sm ghost" ${doel}>Openen</button>${it.nav ? "" : `<button class="btn sm ghost" data-wj-act="weg" data-k="${esc(it.k)}" data-s="${esc(it.stempel || "")}" data-d="${it.info ? "" : "3"}" title="${it.info ? "Verbergen tot er iets verandert" : "3 dagen verbergen"}">${it.info ? "Gezien" : "Later"}</button>`}</div></div>`;
}
function wjGroep(id, titel, rijen, extraKop, voet, leeg) {
  if (!rijen.length && !extraKop && !voet) return "";
  const max = 4, alles = WJ.open[id] || rijen.length <= max + 1; const toon = alles ? rijen : rijen.slice(0, max);
  return `<section class="wj-g" id="wj-${id}"><div class="wj-gk"><h4>${titel} <span class="cnt">${rijen.length}</span></h4>${extraKop || ""}</div>
    ${rijen.length ? toon.join("") : `<div class="wj-leeg">${leeg || "Niets meer."}</div>`}
    ${!alles ? `<button class="wj-meer" data-wj-act="meer" data-g="${id}">Toon nog ${rijen.length - max}</button>` : rijen.length > max + 1 ? `<button class="wj-meer" data-wj-act="minder" data-g="${id}">Minder tonen</button>` : ""}${voet || ""}</section>`;
}
function vWachtOpJou() {
  if (!S.me) return "";
  const { laat, nu } = wjTaken(); const w = wjWeg();
  const allesExtern = wjExtern(), extern = allesExtern.filter(it => WJ.toonVerborgen || !wjVerborgen(it, w)); const fact = wjFacturen();
  const verborgen = allesExtern.length - extern.length; const team = wjTeam();
  const verzetbaar = laat.filter(wjBulkOk); const ma = wjVolgendeMaandag();
  const undo = WJ.undo ? `<div class="wj-undo">${WJ.undo.lijst.length === 1 ? `"${esc(WJ.undo.lijst[0].titel)}" verzet naar ${fmtLong(WJ.undo.naar)}` : `${WJ.undo.lijst.length} taken verzet naar ${fmtLong(WJ.undo.naar)}`}. <button class="btn sm ghost" data-wj-act="undo">Ongedaan maken</button><button class="btn sm ghost" data-wj-act="undo-weg" aria-label="Sluiten">✕</button></div>` : "";
  const teamKnop = isBeheer() ? `<div class="wj-seg" role="group" aria-label="Wiens taken"><button class="${team ? "" : "on"}" aria-pressed="${team ? "false" : "true"}" data-wj-act="team" data-v="0">Mijn</button><button class="${team ? "on" : ""}" aria-pressed="${team ? "true" : "false"}" data-wj-act="team" data-v="1">Team</button></div>` : "";
  const bulk = verzetbaar.length > 1 ? `<div class="wj-bulk"><button class="btn sm" data-wj-act="alles" data-naar="${ma}" ${WJ.bezig ? "disabled" : ""}>${WJ.bezig ? "Bezig…" : `Alle ${verzetbaar.length} naar maandag ${fmt(ma)}`}</button><span class="muted">${laat.length > verzetbaar.length ? (laat.length - verzetbaar.length) + " blijven staan (afspraak of taak van een aannemer/klant) · " : ""}je kan het daarna ongedaan maken</span></div>` : "";
  const totaal = laat.length + nu.length + extern.length + fact.length;
  const groepen = wjGroep("laat", team ? "Te laat — hele team" : "Te laat", laat.map(t => wjTaakRij(t, { wie: team })), teamKnop, laat.length ? undo + bulk : undo, "Niets te laat — mooi zo.")
    + wjGroep("nu", wjMorgen() !== addDays(todayIso, 1) ? "Vandaag tot " + ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"][pd(wjMorgen()).getUTCDay()] : "Vandaag en morgen", nu.map(t => wjTaakRij(t)))
    + wjGroep("extern", "Van klanten en aannemers", extern.map(wjItemRij), "", verborgen && !WJ.toonVerborgen ? `<button class="wj-meer" data-wj-act="verborgen">${verborgen} verborgen — toon</button>` : WJ.toonVerborgen && verborgen ? `<button class="wj-meer" data-wj-act="verborgen">Verborgen weer verbergen</button>` : "")
    + wjGroep("fact", "Facturen", fact.map(wjItemRij));
  return `<div class="panel wj" id="wachtopjou"><div class="panel-head"><h3>Wacht op jou${totaal ? ` <span class="cnt" style="background:var(--crit);color:#fff">${totaal}</span>` : ""}</h3><span class="muted" style="font-size:12px">${totaal ? "alles wat een actie van jou vraagt, uit alle projecten" : ""}</span></div>
    ${totaal ? `<div class="wj-grid">${groepen}</div>` : `<div class="wj-klaar"><span aria-hidden="true">✓</span><div><b>Alles bij.</b> ${team ? "Geen te late taken in het hele team" : "Niets wacht op jou — geen te late taken"}, geen open vragen van klanten of aannemers.${undo ? " " + undo : ""}${isBeheer() ? ` <button class="wj-meer" data-wj-act="team" data-v="${team ? "0" : "1"}">${team ? "Terug naar mijn taken" : "Bekijk het hele team"}</button>` : ""}${verborgen ? ` <button class="wj-meer" data-wj-act="verborgen">${verborgen} verborgen — toon</button>` : ""}</div></div>`}</div>`;
}

/* ---------- acties ---------- */
const wjBulkOk = (t) => !t.afspraak && !!t.assignee && !t.contact_id;   // samen verzetten: enkel gewone taken van het team
/* nieuwe einddatum; de start schuift even ver mee (de taak houdt haar duur) — een taak die al bezig is start vandaag; nooit vóór vandaag of na het einde */
function wjPatch(t, naar) {
  const patch = { eind: naar };
  if (t.start) { let st = t.status === "busy" ? todayIso : t.eind ? addDays(t.start, Math.round((pd(naar).getTime() - pd(t.eind).getTime()) / DAY)) : naar; if (st < todayIso) st = todayIso; if (st > naar) st = naar; if (st !== t.start) patch.start = st; }
  return patch;
}
/* meerdere taken tegelijk bewaren: één keer hertekenen, zes oproepen tegelijk. Mislukt er een, dan enkel eind/start terugzetten
   (niet wat intussen via realtime binnenkwam); een taak die intussen verwijderd werd, komt niet terug. Geeft de mislukte ids terug. */
async function wjBewaarAlles(paren) {
  const vorig = {}; paren.forEach(([id, patch]) => { const t = S.taken[id]; if (!t) return; vorig[id] = { eind: t.eind, start: t.start }; S.taken[id] = { ...t, ...patch }; }); render();
  const mislukt = []; let reden = ""; const rij = paren.filter(([id]) => vorig[id]);
  const werker = async () => { while (rij.length) { const [id, patch] = rij.shift(); let r; try { r = await sb.from("taken").update(patch).eq("id", id).select().single(); } catch (e) { r = { error: e }; }
    if (r.error) { mislukt.push(id); reden = String(r.error.message || r.error); if (S.taken[id]) S.taken[id] = { ...S.taken[id], ...vorig[id] }; }   /* intussen verwijderd (realtime) → niet terugbrengen */
    else if (r.data && S.taken[id]) S.taken[id] = { ...S.taken[id], ...r.data }; } };
  try { await Promise.all([0, 1, 2, 3, 4, 5].map(werker)); } finally { render(); }
  return { fout: mislukt.length, mislukt, reden };
}
async function wjVerzet(ids, naar) {
  const lijst = ids.map(id => S.taken[id]).filter(t => t && t.status !== "done" && !t.afspraak);
  if (!lijst.length) return;
  WJ.undo = { naar, lijst: lijst.map(t => ({ id: t.id, titel: t.titel, eind: t.eind, start: t.start })) };
  if (lijst.length === 1) { try { await dbUpdate("taken", lijst[0].id, wjPatch(lijst[0], naar)); } catch (e) { WJ.undo = null; render(); } return; }   /* dbUpdate toont zelf de foutmelding */
  WJ.bezig = true; render(); let r = { fout: lijst.length, mislukt: lijst.map(t => t.id), reden: "" };
  try { r = await wjBewaarAlles(lijst.map(t => [t.id, wjPatch(t, naar)])); } finally { WJ.bezig = false; }
  if (r.fout === lijst.length) WJ.undo = null; else if (r.fout && WJ.undo) WJ.undo.lijst = WJ.undo.lijst.filter(x => !r.mislukt.includes(x.id));   /* mislukte taken horen niet in "ongedaan maken" */
  if (r.fout) toast(r.fout === lijst.length ? "Verzetten mislukt: " + r.reden : `${lijst.length - r.fout} verzet, ${r.fout} mislukt (${r.reden}).`, 6000);
  render();
}
async function wjOngedaan() {
  const u = WJ.undo; if (!u) return; WJ.undo = null;
  const terug = u.lijst.filter(x => { const t = S.taken[x.id]; return t && t.eind === u.naar; }); const overgeslagen = u.lijst.length - terug.length;
  const paren = terug.map(x => { const t = S.taken[x.id]; const patch = { eind: x.eind }; if ((x.start || null) !== (t.start || null)) patch.start = x.start || null; return [x.id, patch]; });
  WJ.bezig = paren.length > 1; render(); let r = { fout: 0 };
  try { if (paren.length) r = await wjBewaarAlles(paren); } finally { WJ.bezig = false; }
  toast(r.fout ? `${r.fout} taak/taken konden niet teruggezet worden${r.reden ? " (" + r.reden + ")" : ""}.` : overgeslagen ? `Teruggezet; ${overgeslagen} intussen gewijzigd en niet aangeraakt.` : "Teruggezet.", r.fout || overgeslagen ? 5000 : 2800); render();
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-wj-act]"); if (!el || WJ.bezig && ["verzet", "alles", "undo"].includes(el.dataset.wjAct)) return; const d = el.dataset;
  if (d.wjAct === "verzet") return wjVerzet([d.id], d.naar);
  if (d.wjAct === "alles") { const ids = wjTaken().laat.filter(wjBulkOk).map(t => t.id); if (ids.length && confirm(`${ids.length} te late ${wjTeam() ? "taken van het team" : "taken"} verzetten naar maandag ${fmtLong(d.naar)}?`)) wjVerzet(ids, d.naar); return; }
  if (d.wjAct === "undo") return wjOngedaan();
  if (d.wjAct === "undo-weg") { WJ.undo = null; return render(); }
  if (d.wjAct === "meer" || d.wjAct === "minder") { WJ.open[d.g] = d.wjAct === "meer"; return render(); }
  if (d.wjAct === "team") { WJ.teamSessie = null; try { localStorage.setItem("bros.wj.team", d.v); } catch (x) { } WJ.undo = null; return render(); }
  if (d.wjAct === "weg") { wjZetWeg(d.k, d.s, Number(d.d) || 0); return render(); }
  if (d.wjAct === "verborgen") { WJ.toonVerborgen = !WJ.toonVerborgen; return render(); }
  if (d.wjAct === "nav") { S.view = d.view; S.project = null; if (d.ft) S.factTab = d.ft; render(); window.scrollTo({ top: 0 }); return; }
  if (d.wjAct === "naar-laat") { if (isBeheer() && !wjTeam()) { WJ.teamSessie = true; render(); } const g = document.getElementById("wj-laat") || document.getElementById("wachtopjou"); if (g) g.scrollIntoView({ behavior: "smooth", block: "start" }); }
});

/* ---------- accountmenu (onder je naam rechtsboven): Team, Instellingen, Testmodus, Wachtwoord, Uitloggen ---------- */
function acctMenu() {
  const actief = S.view === "team" || S.view === "instellingen";
  const item = (attr, ic, label, on) => `<button type="button" role="menuitem" ${attr} ${on ? 'aria-current="page"' : ""}><span class="acct-ic" aria-hidden="true">${ic}</span>${label}</button>`;
  const menu = S.acctOpen ? `<div class="acct-menu" role="menu" aria-label="Account">
      <div class="acct-kop"><b>${esc(S.me.name || "")}</b><small>${esc(S.me.email || "")}${S.me.role ? " · " + esc(S.me.role) : ""}</small></div>
      ${item('data-nav="team"', "👥", "Team", S.view === "team")}${isBeheer() ? item('data-nav="instellingen"', "⚙︎", "Instellingen", S.view === "instellingen") : ""}${typeof tmReady === "function" && tmReady() ? item('data-act="tm-open"', "🧪", "Testmodus") : ""}
      <hr>${item('data-act="change-password"', "🔑", "Wachtwoord wijzigen")}${item('data-act="logout"', "↩︎", "Uitloggen")}</div>` : "";
  return `<div class="acct"><button type="button" class="acct-knop${actief ? " on" : ""}" data-act="acct" aria-haspopup="menu" aria-expanded="${S.acctOpen ? "true" : "false"}" aria-label="Account: ${esc(S.me.name || "")} — team, instellingen, wachtwoord, uitloggen" title="Account, team en instellingen">${avatar(S.me.id)}<span class="acct-naam">${esc(S.me.name || "")}</span><span class="acct-pijl" aria-hidden="true">▾</span></button>${menu}</div>`;
}
function acctSluit() { if (!S.acctOpen) return; S.acctOpen = false; const m = document.querySelector(".acct-menu"); if (m) m.remove(); const k = document.querySelector(".acct-knop"); if (k) k.setAttribute("aria-expanded", "false"); }
document.addEventListener("keydown", (e) => {
  if (!S.acctOpen) return;
  if (((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) || (e.key === "/" && !e.metaKey && !e.ctrlKey && !(e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || "")))) return acctSluit();   /* snel zoeken opent: menu dicht */
  if (e.key === "Escape") { acctSluit(); const k = document.querySelector(".acct-knop"); if (k) k.focus(); return; }
  const items = [...document.querySelectorAll(".acct-menu button")]; if (!items.length) return;
  const i = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[i < 0 ? (e.key === "ArrowDown" ? 0 : items.length - 1) : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus(); }
  else if (e.key === "Tab" && i >= 0 && ((!e.shiftKey && i === items.length - 1) || (e.shiftKey && i === 0))) acctSluit();
}, true);
function acctFocus(i) { if (!S.acctOpen) return; const items = document.querySelectorAll(".acct-menu button"); const b = items[Math.min(Math.max(i || 0, 0), items.length - 1)]; if (b && !(document.activeElement && document.activeElement.closest && document.activeElement.closest(".acct-menu"))) b.focus(); }
/* vóór het hertekenen: welk menu-item had de focus? (zodat een realtime-update de focus niet wegneemt) */
function acctFocusIndex() { if (!S.acctOpen) return -1; const a = document.activeElement; return a && a.closest && a.closest(".acct-menu") ? [...document.querySelectorAll(".acct-menu button")].indexOf(a) : -1; }
document.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target && e.target.classList && e.target.classList.contains("kpi-klik")) { e.preventDefault(); e.target.click(); } });   // klikbare tegels op het Overzicht
