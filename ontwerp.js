/* =====================================================================
   BROS Planbord — Ontwerptraject en Budgetkompas (v1.63, databasescript 059)
   Tabblad Ontwerp op de projectfiche: per ontwerpgesprek een ronde (V1, V2, …) met een verslag voor de klant, vaste
   documenten (pdf of beelden: kopie in de opslag 'ontwerp'), open vragen en een feedbacktermijn. Publiceren = zichtbaar in
   het klantenportaal (tabblad Ontwerp) + mail. De klant zet spelden met feedback op een plek in een beeld of pagina,
   beantwoordt de vragen, verstuurt en bevestigt. BROS antwoordt per punt (aangepast / niet mogelijk / afspraak / genoteerd)
   en geeft de budgetimpact (excl. btw): indicatief (vork), akkoord (één bedrag) of in een meerwerkvoorstel.
   Budgetkompas: richtbudget → na de goedgekeurde offerte die offerte; + vastgelegd (meer-/minwerk, keuzes, akkoorden);
   + open (indicatief, open keuzes en voorstellen) = verwacht eindbudget, met de budgetgrens van de klant.
   Niets wijzigt vanzelf de meetstaat: bindend wordt het via de bestaande keuzes en de akkoord-knop.
   ===================================================================== */
const O = { open: null, urls: {}, pdf: {}, kompas: {}, kLaden: {}, sel: null, hl: null, asp: {}, doek: {} };
const oOk = () => (typeof schemaV === "function") && !!S.ontwerp_rondes;
const O_REACTIE = { open: "Nog te beantwoorden", aangepast: "Aangepast", niet_mogelijk: "Niet mogelijk", afspraak: "Afspraak", genoteerd: "Genoteerd" };
const O_IMPACT = { geen: "Geen budgetimpact", indicatief: "Indicatief (vork)", akkoord: "Akkoord (bedrag ligt vast)", in_voorstel: "In een meerwerkvoorstel", vervallen: "Vervallen" };
const O_TYPES = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const oRondes = (pid) => Object.values(S.ontwerp_rondes || {}).filter(r => r.project_id === pid).sort((a, b) => b.nummer - a.nummer);
const oDocs = (rid) => Object.values(S.ontwerp_documenten || {}).filter(d => d.ronde_id === rid).sort((a, b) => (a.volgorde || 0) - (b.volgorde || 0) || (a.created_at || "").localeCompare(b.created_at || ""));
/* wat het team ziet: alles van BROS en wat de klant verstuurde (concepten van de klant blijven van hem) */
const oFb = (rid) => Object.values(S.ontwerp_feedback || {}).filter(f => f.ronde_id === rid && (!f.door_klant || f.verstuurd_op)).sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
const oOpenFb = (pid) => Object.values(S.ontwerp_feedback || {}).filter(f => f.project_id === pid && f.door_klant && f.verstuurd_op && f.reactie_status === "open");
const oEur = (n) => n == null ? "—" : (Number(n) < 0 ? "− " : "") + eur2(Math.abs(Number(n))).replace(/,00(?=\D*$)/, "");
const oEurS = (n) => n == null ? "—" : (Number(n) > 0 ? "+ " : Number(n) < 0 ? "− " : "") + eur2(Math.abs(Number(n))).replace(/,00(?=\D*$)/, "");
const oVork = (a, b) => Number(a) === Number(b) ? oEurS(a) : `${oEurS(a)} à ${oEurS(b)}`;
const oStatus = (r) => {
  if (r.status === "concept") return `<span class="pill st-offerte">Concept</span>`;
  if (r.status === "afgesloten") return `<span class="pill st-afgerond">Afgesloten</span>`;
  if (r.bevestigd_op) return `<span class="pill st-afgerond" title="Bevestigd door ${esc(r.bevestigd_naam)}">Bevestigd</span>`;
  const n = oFb(r.id).filter(f => f.door_klant).length;
  return n ? `<span class="pill st-lopend">Feedback ontvangen</span>` : `<span class="pill st-on_hold">Wacht op feedback${r.feedback_tot ? " tot " + fmt(r.feedback_tot) : ""}</span>`;
};
const oKlanten = (pid) => typeof contactsOf === "function" ? contactsOf(pid).filter(x => ["bouwheer", "contactpersoon"].includes(x.rol) && x.c.user_id) : [];

/* ---------- opslag: tijdelijke links (gecachet) ---------- */
function oUrl(pad) {
  const c = O.urls[pad]; if (c && c.tot > Date.now() + 60000) return Promise.resolve(c.url);
  if (c && c.p) return c.p;
  const p = sb.storage.from("ontwerp").createSignedUrl(pad, 3600).then(({ data, error }) => { if (error || !data) { delete O.urls[pad]; throw error || new Error("geen link"); } O.urls[pad] = { url: data.signedUrl, tot: Date.now() + 3500000 }; return data.signedUrl; });
  O.urls[pad] = { p, tot: 0 }; return p;
}

/* ---------- Budgetkompas ---------- */
function oKompasLaad(pid, forceer) {
  const k = O.kompas[pid];
  if (!forceer && k && Date.now() - k.t < 60000) return k.data;
  if (O.kLaden[pid]) return k ? k.data : null;
  O.kLaden[pid] = true;
  sb.rpc("budgetkompas", { p_project: pid }).then(({ data, error }) => { O.kLaden[pid] = false; O.kompas[pid] = { t: Date.now(), data: error ? { fout: error.message } : data }; render(); });
  return k ? k.data : null;
}
/* de meter (ook in het portaal, zelfde opbouw): basis, vastgelegd, open band, budgetgrens */
function oMeter(k, extra) {
  if (!k || k.basis == null) return "";
  const lo = Number(k.huidig), vmin = Number(extra ? extra.min : k.verwacht_min), vmax = Number(extra ? extra.max : k.verwacht_max), grens = k.budgetgrens != null ? Number(k.budgetgrens) : null, basis = Number(k.basis);
  const top = Math.max(lo, vmax, basis, grens || 0) * 1.06 || 1; const pc = (x) => Math.max(0, Math.min(100, x / top * 100));
  const over = grens != null && vmax > grens;
  return `<div class="o-meter${over ? " over" : ""}" role="img" aria-label="Budget: huidig ${oEur(lo)}, verwacht ${oEur(vmin)} tot ${oEur(vmax)}${grens != null ? ", budgetgrens " + oEur(grens) : ""}">
    <div class="o-m-bar"><i class="o-m-basis" style="width:${pc(Math.min(basis, lo))}%"></i><i class="o-m-vast" style="left:${pc(Math.min(basis, lo))}%;width:${pc(Math.abs(lo - basis))}%"></i>
      <i class="o-m-open" style="left:${pc(Math.min(vmin, lo))}%;width:${Math.max(0.6, pc(vmax) - pc(Math.min(vmin, lo)))}%"></i>${grens != null ? `<b class="o-m-grens" style="left:${pc(grens)}%" title="Budgetgrens ${oEur(grens)}"></b>` : ""}</div>
    <div class="o-m-leg"><span><i class="o-m-basis"></i>${k.basis_soort === "offerte" ? "Offerte" : "Richtbudget"} ${oEur(basis)}</span>${Math.abs(lo - basis) > 0.005 ? `<span><i class="o-m-vast"></i>Vastgelegd ${oEurS(lo - basis)}</span>` : ""}<span><i class="o-m-open"></i>Open ${vmin === vmax ? oEurS(vmin - lo) : oEurS(vmin - lo) + " à " + oEurS(vmax - lo)}</span>${grens != null ? `<span><i class="o-m-grens"></i>Budgetgrens ${oEur(grens)}</span>` : ""}</div></div>`;
}
function oKompasPaneel(p) {
  const k = oKompasLaad(p.id);
  const knop = `<button class="btn sm" data-o-act="budget" data-pid="${p.id}">Budget instellen</button>`;
  if (!k) return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h3>Budgetkompas</h3>${knop}</div><div class="panel-body muted">Laden…</div></div>`;
  if (k.fout) return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h3>Budgetkompas</h3>${knop}</div><div class="panel-body" style="color:var(--crit)">${esc(k.fout)}</div></div>`;
  const zicht = k.zichtbaar_klant ? `<span class="pill st-afgerond" title="De klant ziet het Budgetkompas in het portaal">zichtbaar voor de klant</span>` : `<span class="pill st-offerte" title="Enkel het team ziet dit">niet gedeeld</span>`;
  if (k.basis == null) return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Budgetkompas ${zicht}</h3><div class="muted" style="font-size:12px;margin-top:2px">Toon de klant hoe keuzes tijdens het ontwerp het eindbudget beïnvloeden (excl. btw).</div></div>${knop}</div><div class="panel-body"><div class="empty" style="padding:10px"><b>Nog geen richtbudget</b>Vul het richtbudget in (en eventueel de budgetgrens van de klant). Na een goedgekeurde offerte telt de offerte als basis.</div></div></div>`;
  const over = k.budgetgrens != null && Number(k.verwacht_max) > Number(k.budgetgrens);
  const rij = (l, v, sub) => `<div><div class="k">${l}</div><div class="v num">${v}${sub ? `<small class="muted" style="display:block">${sub}</small>` : ""}</div></div>`;
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Budgetkompas ${zicht}</h3><div class="muted" style="font-size:12px;margin-top:2px">Excl. btw · basis: ${k.basis_soort === "offerte" ? "goedgekeurde offerte" + (k.basis_titel ? " (" + esc(k.basis_titel) + ")" : "") : "richtbudget"}${k.toelichting ? " · " + esc(k.toelichting) : ""}</div></div>${knop}</div>
    <div class="panel-body">${oMeter(k)}
      <div class="meta" style="margin-top:12px">${rij(k.basis_soort === "offerte" ? "Offerte" : "Richtbudget", oEur(k.basis))}${rij("Vastgelegd", oEurS(k.som_vast), (k.vast || []).length + " beslissing" + ((k.vast || []).length === 1 ? "" : "en"))}${rij("Huidig budget", `<b>${oEur(k.huidig)}</b>`)}
        ${rij("Verwacht eindbudget", oEur(k.verwacht_min) + (Number(k.verwacht_min) !== Number(k.verwacht_max) ? " – " + oEur(k.verwacht_max) : ""), (k.open || []).length + " open punt" + ((k.open || []).length === 1 ? "" : "en"))}${k.budgetgrens != null ? rij("Budgetgrens klant", `<span style="${over ? "color:var(--crit)" : ""}">${oEur(k.budgetgrens)}</span>`, over ? "verwachting gaat erover" : "") : ""}</div>
      <details style="margin-top:10px"><summary class="muted" style="cursor:pointer;font-size:13px">Details: vastgelegd, open en verloop</summary>
        <div class="o-kol">${(k.vast || []).length ? `<div><h4>Vastgelegd</h4><ul class="o-lijst">${k.vast.map(v => `<li><span>${esc(v.titel)} <small class="muted">${esc({ meerwerk: "meer-/minwerk", keuze: "keuze", ontwerp: "ontwerp" }[v.soort] || v.soort)} · ${fmtLong(lokDag(v.datum))}</small></span><b class="num">${oEurS(v.bedrag)}</b></li>`).join("")}</ul></div>` : ""}
          ${(k.open || []).length ? `<div><h4>Open (wat als)</h4><ul class="o-lijst">${k.open.map(v => `<li class="${v.standaard ? "" : "muted"}"><span>${esc(v.titel)} <small class="muted">${esc({ ontwerp: "ontwerp", keuze: "open keuze", voorstel: "voorstel ter goedkeuring" }[v.soort] || v.soort)}${v.klant_keuze ? " · klant: " + (v.klant_keuze === "niet" ? "liever niet" : "doorvoeren") : ""}</small></span><b class="num">${oVork(v.min, v.max)}</b></li>`).join("")}</ul></div>` : ""}
          ${(k.verloop || []).length ? `<div><h4>Verloop</h4><ul class="o-lijst">${k.verloop.map(v => `<li><span>${fmtLong(lokDag(v.datum))} · ${esc(v.titel)}</span><span class="num">${oEurS(v.delta)} → <b>${oEur(v.totaal)}</b></span></li>`).join("")}</ul></div>` : ""}</div></details></div></div>`;
}
function oBudgetForm(pid) {
  const p = S.projecten[pid]; if (!p) return;
  openModal("Budget — " + projName(p), `<div class="form-grid">
    <div class="field"><label for="ob_rb">Richtbudget (excl. btw)</label><input id="ob_rb" name="richtbudget" type="number" step="100" min="0" value="${esc(p.richtbudget ?? "")}" placeholder="bv. 185000"><small class="muted">Startpunt tot er een goedgekeurde offerte is.</small></div>
    <div class="field"><label for="ob_op">Afgesproken op</label><input id="ob_op" name="budget_op" type="date" value="${esc(p.budget_op || todayIso)}"></div>
    <div class="field"><label for="ob_gr">Budgetgrens van de klant (excl. btw, optioneel)</label><input id="ob_gr" name="budgetgrens" type="number" step="100" min="0" value="${esc(p.budgetgrens ?? "")}"><small class="muted">Wat de klant maximaal wil uitgeven: de meter waarschuwt als de verwachting erover gaat.</small></div>
    <div class="field span2"><label for="ob_to">Toelichting voor de klant (optioneel)</label><input id="ob_to" name="budget_toelichting" value="${esc(p.budget_toelichting || "")}" maxlength="300" placeholder="bv. Richtbudget voor keuken, dressing en badkamer, zonder technieken"></div>
    <div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" name="budget_klant" ${p.budget_klant ? "checked" : ""}><span><b>Budgetkompas tonen in het klantenportaal</b><small class="muted" style="display:block">De klant ziet de meter, het verloop en bij elk feedbackpunt de indicatieve impact die jij invult — nooit kostprijzen of marges. Hij kan bij open punten "wat als" uitproberen en aangeven of hij een indicatieve wijziging wil doorvoeren (geen verbintenis: bindend wordt het via een keuze of meerwerkvoorstel).</small></span></label></div>
  </div>`, { saveLabel: "Bewaren", onSave: async (d) => {
    const num = (v) => v === "" || v == null ? null : Math.round(Number(v) * 100) / 100;
    const patch = { richtbudget: num(d.richtbudget), budgetgrens: num(d.budgetgrens), budget_op: d.budget_op || null, budget_toelichting: (d.budget_toelichting || "").trim(), budget_klant: d.budget_klant === "on" };
    if ((patch.richtbudget != null && !(patch.richtbudget >= 0)) || (patch.budgetgrens != null && !(patch.budgetgrens >= 0))) { toast("Vul geldige bedragen in."); return false; }
    if (patch.budget_klant && patch.richtbudget == null && !Object.values(S.goedkeuringen || {}).some(g => g.project_id === pid && g.soort === "offerte" && g.status === "akkoord")) { toast("Vul eerst een richtbudget in voor je het kompas met de klant deelt."); return false; }
    await dbUpdate("projecten", pid, patch); oKompasLaad(pid, true); toast("Budget bewaard");
  } });
}

/* ---------- tabblad Ontwerp ---------- */
function vOntwerp(p) {
  if (!oOk()) return typeof SCHEMA_HINT === "function" ? SCHEMA_HINT(59) : "";
  const r = O.open && S.ontwerp_rondes[O.open];
  if (r && r.project_id === p.id) return oRondeView(p, r);
  const rs = oRondes(p.id);
  const afspr = oAfspraken(p.id);
  return oKompasPaneel(p) + `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Ontwerptraject</h3><div class="muted" style="font-size:12px;margin-top:2px">Na elk ontwerpgesprek een ronde met het verslag en de presentatie. De klant geeft rechtstreeks feedback in het portaal — los van het dossier.</div></div>
      <button class="btn sm primary" data-o-act="nieuw" data-pid="${p.id}">+ Ontwerpronde</button></div>
    ${rs.length ? `<div class="o-tijdlijn">${rs.map(x => { const fb = oFb(x.id).filter(f => f.door_klant); const open = fb.filter(f => f.reactie_status === "open").length; const sig = fb.filter(f => f.signaal && f.impact_status === "geen").length; const docs = oDocs(x.id);
      return `<button type="button" class="o-ronde" data-o-act="open" data-id="${x.id}"><span class="o-v">V${x.nummer}</span><span class="o-r-in"><b>${esc(x.titel || "Ontwerpronde " + x.nummer)}</b> ${oStatus(x)}
        <small class="muted" style="display:block">gesprek ${fmtLong(x.datum)} · ${docs.length} document${docs.length === 1 ? "" : "en"}${fb.length ? ` · ${fb.length} feedbackpunt${fb.length === 1 ? "" : "en"}` : ""}${open ? ` · <b style="color:var(--warn)">${open} te beantwoorden</b>` : ""}${sig ? ` · <span title="Feedback die waarschijnlijk iets kost of bespaart, nog zonder budgetimpact">€? ${sig}</span>` : ""}${x.bevestigd_op ? ` · bevestigd door ${esc(x.bevestigd_naam)} ${fmtLong(lokDag(x.bevestigd_op))}` : ""}</small></span></button>`; }).join("")}</div>`
      : `<div class="empty"><b>Nog geen ontwerprondes</b>Maak na het eerste ontwerpgesprek een ronde: verslag, presentatie (uit Renders of een pdf) en de vragen voor de klant.</div>`}</div>
    ${afspr.length ? `<div class="panel"><div class="panel-head"><h3>Gemaakte afspraken <span class="muted num" style="font-weight:400">${afspr.length}</span></h3></div><ul class="o-lijst" style="padding:0 16px 12px">${afspr.map(f => `<li><span><b>V${S.ontwerp_rondes[f.ronde_id]?.nummer || "?"}</b> · ${esc(f.soort === "afspraak" ? f.tekst : (f.reactie || f.tekst))}${f.soort !== "afspraak" ? ` <small class="muted">(feedback: “${esc(f.tekst.slice(0, 80))}”)</small>` : ""}</span><small class="muted">${fmtLong(lokDag(f.reactie_op || f.created_at))}</small></li>`).join("")}</ul></div>` : ""}`;
}
const oAfspraken = (pid) => Object.values(S.ontwerp_feedback || {}).filter(f => f.project_id === pid && (f.soort === "afspraak" || f.reactie_status === "afspraak") && (!f.door_klant || f.verstuurd_op))
  .sort((a, b) => (a.reactie_op || a.created_at || "").localeCompare(b.reactie_op || b.created_at || ""));

function oRondeView(p, r) {
  const docs = oDocs(r.id); const fb = oFb(r.id); const concept = r.status === "concept";
  const pins = fb.filter(f => f.document_id); const nr = {}; pins.forEach((f, i) => nr[f.id] = i + 1);
  const vragen = Array.isArray(r.vragen) ? r.vragen : [];
  const kl = oKlanten(p.id);
  const vorige = oRondes(p.id).find(x => x.nummer === r.nummer - 1);
  return `<div class="crumb"><button data-o-act="lijst">Ontwerp</button><span>›</span><span>V${r.nummer}</span></div>
    <div class="page-head" style="margin-bottom:12px"><div><div class="eyebrow">Ontwerpronde V${r.nummer} · gesprek ${fmtLong(r.datum)}${r.gepubliceerd_op ? " · gepubliceerd " + fmtLong(lokDag(r.gepubliceerd_op)) : ""}</div><h2 style="margin:2px 0 6px">${esc(r.titel || "Ontwerpronde " + r.nummer)} ${oStatus(r)}</h2>
      ${r.bevestigd_op ? `<div class="muted" style="font-size:13px">✓ Bevestigd door ${esc(r.bevestigd_naam)} op ${fmtLong(lokDag(r.bevestigd_op))} ${esc(lokUur(r.bevestigd_op))}</div>` : ""}</div>
      <div class="actions"><button class="btn" data-o-act="bewerk" data-id="${r.id}">Bewerken</button>${concept ? `<button class="btn" data-o-act="docs" data-id="${r.id}">+ Documenten</button><button class="btn primary" data-o-act="publiceer" data-id="${r.id}">Publiceren naar de klant…</button><button class="btn ghost danger" data-o-act="weg" data-id="${r.id}">Verwijderen</button>`
        : `<button class="btn" data-o-act="plus" data-id="${r.id}" data-soort="afspraak">+ Afspraak</button><button class="btn" data-o-act="plus" data-id="${r.id}" data-soort="wijziging">+ Ontwerpwijziging</button>${r.status === "gepubliceerd" ? `<button class="btn" data-o-act="sluit" data-id="${r.id}" title="Geen feedback meer (de ronde blijft zichtbaar)">Afsluiten</button>` : `<button class="btn" data-o-act="heropen" data-id="${r.id}">Heropenen</button>`}`}</div></div>
    ${concept ? `<div class="notice" style="margin:0 0 14px">Concept — de klant ziet deze ronde pas na publiceren. ${kl.length ? `Dan krijgt ${kl.map(x => esc(x.c.naam)).join(", ")} een mail.` : `<span style="color:var(--warn)">Niemand van dit project heeft portaaltoegang: geef die eerst via Dossier › Contacten.</span>`} Na publiceren liggen de documenten vast (chronologie); nieuwe documenten = een nieuwe ronde.</div>` : ""}
    <div class="o-grid"><div class="o-links">
      ${r.verslag ? `<div class="panel" style="margin-bottom:14px"><div class="panel-head"><h3>Verslag van het gesprek <small class="muted" style="font-weight:400">(ziet de klant)</small></h3></div><div class="panel-body" style="white-space:pre-line">${esc(r.verslag)}</div></div>` : ""}
      ${r.intern ? `<div class="panel" style="margin-bottom:14px"><div class="panel-head"><h3>Intern <small class="muted" style="font-weight:400">(nooit voor de klant)</small></h3></div><div class="panel-body" style="white-space:pre-line">${esc(r.intern)}</div></div>` : ""}
      ${docs.length ? oViewer(docs, pins, { nr, beheer: concept }) : `<div class="panel"><div class="empty"><b>Nog geen documenten</b>${concept ? `Voeg de presentatie toe (uit Renders of een pdf/beeld van je computer).` : ""}</div></div>`}
    </div><div class="o-rechts">
      ${vragen.length ? `<div class="panel" style="margin-bottom:14px"><div class="panel-head"><h3>Vragen aan de klant</h3></div><div class="panel-body">${vragen.map(q => { const an = fb.filter(f => f.vraag_id === q.id);
        return `<div class="o-vraag"><b>${esc(q.tekst)}</b>${an.length ? an.map(f => `<div class="o-antw">${esc(f.tekst)} <small class="muted">— ${esc(f.auteur_naam)} ${fmtLong(lokDag(f.verstuurd_op))}</small>${oFbForm(f, p)}</div>`).join("") : `<div class="muted" style="font-size:13px">${concept ? "" : "Nog geen antwoord."}</div>`}</div>`; }).join("")}</div></div>` : ""}
      ${oFbLijst("Feedback op het ontwerp", pins, p, nr)}
      ${oFbLijst("Algemene feedback", fb.filter(f => f.door_klant && !f.document_id && !f.vraag_id), p)}
      ${oFbLijst("Afspraken en wijzigingen van BROS", fb.filter(f => !f.door_klant), p)}
      ${!concept && !fb.length ? `<div class="panel"><div class="empty"><b>Nog geen feedback</b>De klant ziet deze ronde in zijn portaal${r.feedback_tot ? " en geeft feedback tot " + fmtLong(r.feedback_tot) : ""}.</div></div>` : ""}
      ${vorige ? `<div class="muted" style="font-size:12px;margin-top:6px">De antwoorden op de feedback van V${vorige.nummer} ziet de klant bovenaan deze ronde ("Wat we aanpasten").</div>` : ""}
    </div></div>`;
}
function oFbLijst(titel, l, p, nr) {
  if (!l.length) return "";
  return `<div class="panel" style="margin-bottom:14px"><div class="panel-head"><h3>${titel} <span class="muted num" style="font-weight:400">${l.length}</span></h3></div><div class="panel-body o-fbl">${l.map(f => {
    const d = f.document_id && S.ontwerp_documenten[f.document_id];
    return `<div class="o-fb${O.hl === f.id ? " hl" : ""}" id="ofb-${f.id}">${nr && nr[f.id] ? `<button type="button" class="o-pin sm" data-o-act="toon" data-id="${f.id}" title="Toon op het ontwerp">${nr[f.id]}</button>` : ""}<div class="o-fb-in">
      <div class="o-fb-kop">${f.door_klant ? `<b>${esc(f.auteur_naam || "Klant")}</b>` : `<span class="pill ${f.soort === "afspraak" ? "st-afgerond" : "kl"}">${f.soort === "afspraak" ? "Afspraak" : "Ontwerpwijziging"}</span> <small class="muted">${esc(f.auteur_naam)}</small>`}
        <small class="muted">${fmtLong(lokDag(f.verstuurd_op || f.created_at))}${d ? " · " + esc(d.titel || "document") + (f.pagina > 1 || d.paginas > 1 ? " p." + (f.pagina || 1) : "") : ""}</small>${f.signaal && f.impact_status === "geen" ? `<span class="pill late" title="De tekst wijst op meer of minder kosten — vul de budgetimpact in (of 'geen')">€? mogelijk budgetimpact</span>` : ""}</div>
      <div class="o-fb-t">${esc(f.tekst)}</div>${oFbForm(f, p)}</div></div>`; }).join("")}</div></div>`;
}
/* antwoord + budgetimpact van BROS bij één punt */
function oFbForm(f, p) {
  const gks = Object.values(S.goedkeuringen || {}).filter(g => g.project_id === f.project_id && g.soort === "meerwerk").sort((a, b) => (b.voorgelegd_op || "").localeCompare(a.voorgelegd_op || ""));
  const toonImp = f.impact_status !== "geen" || f.signaal || f.soort === "wijziging";
  return `<form class="o-fbf" data-o-fb="${f.id}">
    ${f.door_klant ? `<div class="o-fbf-r"><select name="reactie_status" class="inline">${opts(Object.entries(O_REACTIE), f.reactie_status)}</select><textarea name="reactie" class="inline" rows="2" placeholder="Antwoord aan de klant (ziet hij in het portaal)">${esc(f.reactie || "")}</textarea></div>` : ""}
    <details ${toonImp ? "open" : ""}><summary class="muted" style="cursor:pointer;font-size:12px">Budgetimpact${f.impact_status !== "geen" ? `: <b>${esc(O_IMPACT[f.impact_status])}</b>${f.impact_min != null ? " " + oVork(f.impact_min, f.impact_max) : ""}` : ""}${f.klant_keuze ? ` · klant: <b>${f.klant_keuze === "niet" ? "liever niet" : "doorvoeren"}</b>` : ""}</summary>
      <div class="o-fbf-i"><select name="impact_status" class="inline">${opts(Object.entries(O_IMPACT), f.impact_status)}</select>
        <input name="impact_min" class="inline" type="number" step="10" placeholder="van €" value="${esc(f.impact_min ?? "")}" title="Excl. btw; negatief = minder"><input name="impact_max" class="inline" type="number" step="10" placeholder="tot €" value="${esc(f.impact_max ?? "")}" title="Leeg = hetzelfde bedrag">
        <select name="goedkeuring_id" class="inline" title="Meerwerkvoorstel (bij 'In een meerwerkvoorstel')"><option value="">— voorstel —</option>${opts(gks.map(g => [g.id, `${g.titel || "Meerwerk"} · ${eur2(g.totaal_excl)} · ${({ open: "open", akkoord: "akkoord", geweigerd: "geweigerd", ingetrokken: "ingetrokken", geannuleerd: "geannuleerd" })[g.status] || g.status}`]), f.goedkeuring_id || "")}</select>
        <input name="impact_toelichting" class="inline" maxlength="300" placeholder="Toelichting (ziet de klant als het kompas gedeeld is)" value="${esc(f.impact_toelichting || "")}"></div></details>
    <div class="o-fbf-r"><input name="intern" class="inline" placeholder="Interne opmerking (nooit voor de klant)" value="${esc(f.intern || "")}"><button type="submit" class="btn sm">Bewaren</button></div>
    ${f.reactie_op ? `<small class="muted">Beantwoord door ${esc(userById(f.reactie_door).name || "")} ${fmtLong(lokDag(f.reactie_op))}</small>` : ""}</form>`;
}
async function oFbBewaar(form) {
  const id = form.dataset.oFb; const f = S.ontwerp_feedback[id]; if (!f) return;
  const d = Object.fromEntries(new FormData(form).entries()); const num = (v) => v === "" || v == null ? null : Math.round(Number(v) * 100) / 100;
  const patch = { impact_status: d.impact_status, impact_min: num(d.impact_min), impact_max: num(d.impact_max), impact_toelichting: (d.impact_toelichting || "").trim(), goedkeuring_id: d.goedkeuring_id || null, intern: (d.intern || "").trim() };
  if (patch.impact_status === "geen" || patch.impact_status === "vervallen") { if (patch.impact_status === "geen") { patch.impact_min = null; patch.impact_max = null; } }
  if (patch.impact_status === "akkoord" && patch.impact_min != null && patch.impact_max != null && patch.impact_min !== patch.impact_max) { toast("Bij 'Akkoord' hoort één bedrag: vul enkel 'van' in (of hetzelfde bedrag)."); return; }
  if (f.door_klant) { patch.reactie_status = d.reactie_status; patch.reactie = (d.reactie || "").trim(); if (patch.reactie_status !== "open" && !patch.reactie && patch.reactie_status !== "genoteerd") { toast("Schrijf een kort antwoord voor de klant."); return; } }
  try { await dbUpdate("ontwerp_feedback", id, patch); } catch (e) { return; }
  oKompasLaad(f.project_id, true); toast("Bewaard");
}

/* ---------- document met spelden (beelden en pdf-pagina's) ---------- */
function oViewer(docs, pins, o = {}) {
  return docs.map(d => { const pp = pins.filter(f => f.document_id === d.id);
    const paginas = d.soort === "pdf" ? Array.from({ length: Math.max(1, d.paginas || 1) }, (_, i) => i + 1) : [1];
    return `<div class="panel o-doc" style="margin-bottom:14px" data-o-doc="${d.id}"><div class="panel-head"><h3>${esc(d.titel || "Document")} <small class="muted" style="font-weight:400">${d.soort === "pdf" ? d.paginas + " pagina" + (d.paginas === 1 ? "" : "'s") : "beeld"}${pp.length ? " · " + pp.length + " speld" + (pp.length === 1 ? "" : "en") : ""}</small></h3>
      <div class="actions"><button class="btn ghost sm" data-o-act="titel" data-id="${d.id}">Titel</button>${o.beheer ? `<button class="btn ghost sm danger" data-o-act="doc-weg" data-id="${d.id}">Verwijderen</button>` : ""}</div></div>
      <div class="o-pags">${paginas.map(n => { const asp = O.asp[d.pad + "#" + n] || (d.breedte && d.hoogte ? `${d.breedte}/${d.hoogte}` : ""); return `<div class="o-pg" data-o-pg="${d.id}" data-p="${n}" ${asp ? `style="aspect-ratio:${asp}"` : ""}>${d.soort === "pdf" ? `<canvas></canvas>${paginas.length > 1 ? `<span class="o-pnr">${n}</span>` : ""}` : `<img alt="${esc(d.titel)}" loading="lazy">`}
        ${pp.filter(f => (f.pagina || 1) === n && f.x != null).map(f => `<button type="button" class="o-pin${f.reactie_status !== "open" ? " ok" : ""}${O.hl === f.id ? " hl" : ""}" style="left:${Number(f.x) * 100}%;top:${Number(f.y) * 100}%" data-o-act="speld" data-id="${f.id}" title="${esc(f.tekst.slice(0, 120))}">${o.nr && o.nr[f.id] || "•"}</button>`).join("")}</div>`; }).join("")}</div></div>`; }).join("");
}
/* na elke weergave: beelden en pdf-pagina's laden (enkel wat zichtbaar wordt) */
let oObs = null;
function oLaadZichtbaar() {
  const els = document.querySelectorAll(".o-pg:not([data-geladen])"); if (!els.length) return;
  if (!oObs && "IntersectionObserver" in window) oObs = new IntersectionObserver((es) => es.forEach(e => { if (e.isIntersecting) { oObs.unobserve(e.target); oLaadPg(e.target); } }), { rootMargin: "400px" });
  els.forEach(el => { el.setAttribute("data-geladen", "1"); if (oObs) oObs.observe(el); else oLaadPg(el); });
}
async function oLaadPg(el) {
  const d = S.ontwerp_documenten[el.dataset.oPg]; if (!d) return;
  try {
    const url = await oUrl(d.pad);
    if (d.soort !== "pdf") { const img = el.querySelector("img"); if (img) img.src = url; return; }
    const pk = d.pad + "#" + (Number(el.dataset.p) || 1); const c = el.querySelector("canvas"); if (!c) return;
    const klaar = O.doek[pk];
    if (klaar && klaar !== c && klaar.width >= Math.max(320, el.clientWidth || 0) * 0.9) { c.replaceWith(klaar); return; }   // al getekend: hetzelfde doek terugzetten (geen tweede kopie in het geheugen)
    const pdfjs = await loadPdfJs(); const key = d.pad;
    O.pdf[key] = O.pdf[key] || pdfjs.getDocument({ url, isEvalSupported: false }).promise;
    const doc = await O.pdf[key]; const page = await doc.getPage(Number(el.dataset.p) || 1);
    const v1 = page.getViewport({ scale: 1 }); O.asp[pk] = `${v1.width}/${v1.height}`; el.style.aspectRatio = O.asp[pk];
    const w = Math.max(320, el.clientWidth || 800); const dpr = Math.min(1.75, window.devicePixelRatio || 1); const vp = page.getViewport({ scale: w / v1.width * dpr });
    const off = document.createElement("canvas"); off.width = vp.width; off.height = vp.height; await page.render({ canvasContext: off.getContext("2d"), viewport: vp }).promise;
    O.doek[pk] = off; const nu = el.isConnected ? el.querySelector("canvas") : document.querySelector(`.o-pg[data-o-pg="${d.id}"][data-p="${el.dataset.p}"] canvas`);
    if (nu && nu !== off) nu.replaceWith(off);
  } catch (e) { el.classList.add("fout"); el.setAttribute("title", "Kon niet geladen worden: " + (e && e.message || e)); }
}

/* ---------- ronde maken / bewerken / publiceren ---------- */
function oRondeForm(pid, r) {
  const isNew = !r; r = r || {}; const p = S.projecten[pid]; if (!p) return;
  const concept = !r.status || r.status === "concept"; const vragen = Array.isArray(r.vragen) ? r.vragen : [];
  const vgs = typeof vgOf === "function" ? vgOf(pid).filter(v => v.status === "gecontroleerd" || !v.opname) : [];
  const vrRij = (q, i) => `<div class="ap-row"><input name="vr_${i}" data-qid="${esc(q.id || "")}" value="${esc(q.tekst || "")}" placeholder="Open vraag aan de klant" style="flex:1" ${!concept && q.id ? "readonly" : ""}></div>`;
  openModal(isNew ? "Nieuwe ontwerpronde — " + projName(p) : `Ontwerpronde V${r.nummer} bewerken`, `<div class="form-grid">
    ${concept ? "" : `<div class="field span2"><div class="notice" style="margin:0">Gepubliceerd: titel, datum en verslag liggen vast (de klant heeft ze gezien). Een aanvulling zet je als afspraak; iets nieuws in een nieuwe ronde. Vragen kan je nog toevoegen.</div></div>`}
    <div class="field span2"><label for="or_t">Titel (ziet de klant)</label><input id="or_t" name="titel" required maxlength="200" value="${esc(r.titel || "")}" placeholder="bv. Eerste schetsontwerp keuken en leefruimte" ${concept ? "" : "readonly"}></div>
    <div class="field"><label for="or_d">Datum van het ontwerpgesprek</label><input id="or_d" name="datum" type="date" value="${esc(r.datum || todayIso)}" ${concept ? "" : "readonly"}></div>
    <div class="field"><label for="or_f">Feedback graag tegen</label><input id="or_f" name="feedback_tot" type="date" value="${esc(r.feedback_tot || (isNew ? addDays(todayIso, 14) : ""))}"></div>
    ${vgs.length && concept ? `<div class="field span2"><label for="or_v">Uit een vergadering (optioneel)</label><select id="or_v" name="vergadering_id"><option value="">— geen —</option>${opts(vgs.map(v => [v.id, fmtLong(v.datum) + " · " + v.onderwerp]), r.vergadering_id || "")}</select><button type="button" class="btn ghost sm" data-o-vg-neem style="align-self:flex-start;margin-top:4px">Samenvatting en beslissingen overnemen in het verslag</button></div>` : ""}
    <div class="field span2"><label for="or_vs">Verslag van het gesprek (ziet de klant)</label><textarea id="or_vs" name="verslag" rows="8" placeholder="Wat we bespraken, wat beslist werd en wat we nu voorstellen." ${concept ? "" : "readonly"}>${esc(r.verslag || "")}</textarea></div>
    <div class="field span2"><label for="or_i">Interne notitie (nooit voor de klant)</label><textarea id="or_i" name="intern" rows="2">${esc(r.intern || "")}</textarea></div>
    <div class="field span2"><label>Open vragen aan de klant <span class="muted" style="font-weight:400">— hij antwoordt in het portaal${concept ? "" : "; bestaande vragen liggen vast, nieuwe kan je toevoegen"}</span></label><div id="or_vr">${vragen.map(vrRij).join("")}${vrRij({}, vragen.length)}${vrRij({}, vragen.length + 1)}</div><button type="button" class="btn ghost sm" data-o-vr-plus>+ Nog een vraag</button></div>
  </div>`, { wide: true, saveLabel: "Bewaren", onSave: async (d) => {
    const f = $("#mform"); const qs = [];
    f.querySelectorAll("#or_vr input").forEach(i => { const t = i.value.trim(); if (t) qs.push({ id: i.dataset.qid || ("q" + Math.random().toString(36).slice(2, 9)), tekst: t.slice(0, 500) }); });
    if (!concept) vragen.forEach(q => { if (!qs.some(x => x.id === q.id)) qs.unshift(q); });   // gepubliceerd: bestaande vragen blijven
    const row = { feedback_tot: d.feedback_tot || null, intern: (d.intern || "").trim(), vragen: qs };
    if (concept) Object.assign(row, { titel: d.titel.trim(), datum: d.datum || todayIso, verslag: (d.verslag || "").trim() });
    if ("vergadering_id" in d) row.vergadering_id = d.vergadering_id || null;
    if (isNew) { const n = await dbInsert("ontwerp_rondes", { project_id: pid, ...row }); O.open = n.id; toast(`Ronde V${n.nummer} aangemaakt — voeg nu de documenten toe`); render(); setTimeout(() => oDocsForm(n.id), 60); }
    else { await dbUpdate("ontwerp_rondes", r.id, row); toast("Bewaard"); }
  } });
  const f = $("#mform"); let n = vragen.length + 2;
  f.querySelector("[data-o-vr-plus]").onclick = () => { $("#or_vr").insertAdjacentHTML("beforeend", vrRij({}, n++)); };
  const vb = f.querySelector("[data-o-vg-neem]"); if (vb) vb.onclick = () => { const v = S.vergaderingen[$("#or_v").value]; if (!v) { toast("Kies eerst een vergadering."); return; }
    const vs = (v.verslag_gecontroleerd && v.verslag_gecontroleerd.verslag) || v.verslag || {};
    const besl = (typeof vgPunten === "function" ? vgPunten(v.id) : []).filter(x => !x.verborgen && x.soort === "beslissing" && (x.status === "bevestigd" || x.status === "gecorrigeerd")).map(x => "- " + x.tekst + ((x.voorwaarden || "").trim() ? " (" + x.voorwaarden.trim() + ")" : ""));
    const t = [(vs.samenvatting || "").trim(), besl.length ? "Beslist:\n" + besl.join("\n") : ""].filter(Boolean).join("\n\n");
    const ta = $("#or_vs"); if (ta.value.trim() && !confirm("Het huidige verslag aanvullen met de samenvatting en beslissingen van de vergadering?")) return; ta.value = (ta.value.trim() ? ta.value.trim() + "\n\n" : "") + t; };
}
async function oDocMaat(file) {
  if (file.type === "application/pdf") { const pdfjs = await loadPdfJs(); const doc = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise; const pg = await doc.getPage(1); const v = pg.getViewport({ scale: 1 }); return { paginas: doc.numPages, w: Math.round(v.width), h: Math.round(v.height) }; }
  if (typeof laadModule === "function") await laadModule("renders").catch(() => { });   // 1.72: renders.js (met rdMaat) wordt pas geladen wanneer nodig
  const m = typeof rdMaat === "function" ? await rdMaat(file) : null; if (!m) throw new Error("Dit bestand is geen leesbaar beeld."); return { paginas: 1, w: m.w, h: m.h };
}
async function oDocOpladen(r, file, titel, bron, bronId) {
  const ext = O_TYPES[file.type]; if (!ext) throw new Error(`${file.name || "bestand"}: enkel pdf, jpg, png of webp.`);
  if (file.size > 60 * 1024 * 1024) throw new Error(`${file.name || "bestand"} is groter dan 60 MB.`);
  const buf = await file.arrayBuffer(); const sha = typeof vgSha256 === "function" ? await vgSha256(buf) : "";
  const m = await oDocMaat(file); const id = crypto.randomUUID(); const pad = `${r.project_id}/${r.id}/${id}.${ext}`;
  const { error } = await sb.storage.from("ontwerp").upload(pad, new Blob([buf], { type: file.type }), { contentType: file.type, upsert: false });
  if (error) throw new Error("Opladen mislukt: " + error.message);
  const vol = Math.max(0, ...oDocs(r.id).map(d => d.volgorde || 0)) + 1;
  try { return await dbInsert("ontwerp_documenten", { id, ronde_id: r.id, project_id: r.project_id, soort: ext === "pdf" ? "pdf" : "beeld", titel: (titel || file.name || "Document").replace(/\.(pdf|jpe?g|png|webp)$/i, "").slice(0, 200), pad, mime: file.type, grootte: file.size, sha256: sha || "", breedte: m.w, hoogte: m.h, paginas: m.paginas, bron, bron_id: bronId || "", volgorde: vol }); }
  catch (e) { await sb.storage.from("ontwerp").remove([pad]).catch(() => { }); throw e; }
}
function oDocsForm(rid) {
  const r = S.ontwerp_rondes[rid]; if (!r) return;
  const pres = Object.values(S.render_presentaties || {}).filter(x => x.project_id === r.project_id && x.status === "klaar" && x.pad).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const keuzeIds = new Set(Object.values(S.render_standpunten || {}).filter(s => s.project_id === r.project_id).flatMap(s => [s.presentatie_id, s.hoofdversie_id]).filter(Boolean));
  const rds = Object.values(S.render_beelden || {}).filter(b => b.project_id === r.project_id && b.soort === "render").sort((a, b) => (keuzeIds.has(b.id) - keuzeIds.has(a.id)) || (b.created_at || "").localeCompare(a.created_at || "")).slice(0, 40);
  openModal(`Documenten voor V${r.nummer}`, `<div class="form-grid">
    <div class="field span2"><label for="od_f">Van je computer (pdf, jpg, png of webp — max. 60 MB)</label><input id="od_f" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp"></div>
    ${pres.length ? `<div class="field span2"><label>A3-presentaties uit Renders</label><div class="fase-list">${pres.slice(0, 8).map(x => `<label class="chk"><input type="checkbox" name="pres" value="${x.id}"> <span>${esc(x.klant)} · ${esc(x.versie)} <small class="muted">${fmtLong(x.datum)} · ${x.paginas || "?"} pagina's</small></span></label>`).join("")}</div></div>` : ""}
    ${rds.length ? `<div class="field span2"><label>Renders <span class="muted" style="font-weight:400">(hoofd- en presentatieversies eerst)</span></label><div class="fase-list" style="max-height:240px;overflow:auto">${rds.map(b => { const sp = b.standpunt_id && S.render_standpunten?.[b.standpunt_id];
      return `<label class="chk"><input type="checkbox" name="rd" value="${b.id}"> <span>${esc(sp ? sp.naam || b.ruimte : b.ruimte || "render")} · v${b.versie || "?"}${keuzeIds.has(b.id) ? ` <span class="pill st-afgerond">gekozen</span>` : ""} <small class="muted">${fmtLong(lokDag(b.created_at))}</small></span></label>`; }).join("")}</div></div>` : ""}
    <div class="field span2"><div class="muted" style="font-size:12px">Het Planbord bewaart een vaste kopie: wijzig je later het origineel, dan blijft deze ronde zoals de klant ze zag.</div><div id="od_st" class="muted" style="font-size:13px"></div></div>
  </div>`, { saveLabel: "Toevoegen", onSave: async () => {
    const f = $("#mform"); const files = [...($("#od_f").files || [])]; const pr = [...f.querySelectorAll('input[name="pres"]:checked')].map(i => i.value); const rd = [...f.querySelectorAll('input[name="rd"]:checked')].map(i => i.value);
    if (!files.length && !pr.length && !rd.length) { toast("Kies minstens één document."); return false; }
    const st = $("#od_st"); let ok = 0; const fouten = [];
    const stap = (t) => { if (st) st.textContent = t; };
    for (const file of files) { stap(`Opladen: ${file.name}…`); try { await oDocOpladen(r, file, file.name, "upload"); ok++; } catch (e) { fouten.push(e.message || String(e)); } }
    for (const id of pr) { const x = S.render_presentaties[id]; stap(`Presentatie ${x.versie} kopiëren…`); try { const { data, error } = await sb.storage.from("renders").download(x.pad); if (error) throw error; await oDocOpladen(r, new File([data], "presentatie.pdf", { type: "application/pdf" }), `Presentatie ${x.versie}`, "presentatie", id); ok++; } catch (e) { fouten.push("Presentatie " + x.versie + ": " + (e.message || e)); } }
    for (const id of rd) { const b = S.render_beelden[id]; const sp = b.standpunt_id && S.render_standpunten?.[b.standpunt_id]; stap(`Render kopiëren…`); try { const { data, error } = await sb.storage.from("renders").download(b.pad); if (error) throw error; await oDocOpladen(r, new File([data], "render", { type: b.mime || data.type || "image/png" }), `${sp ? sp.naam || b.ruimte : b.ruimte || "Render"}${b.versie ? " v" + b.versie : ""}`, "render", id); ok++; } catch (e) { fouten.push("Render: " + (e.message || e)); } }
    render();
    if (fouten.length) { toast(`${ok} toegevoegd · ${fouten.length} niet: ${fouten[0]}`, 8000); return false; }
    toast(`${ok} document${ok === 1 ? "" : "en"} toegevoegd`);
  } });
}
function oPubliceerForm(rid) {
  const r = S.ontwerp_rondes[rid]; if (!r) return; const docs = oDocs(rid); const kl = oKlanten(r.project_id);
  openModal(`V${r.nummer} publiceren naar de klant`, `<p style="margin-top:0">De klant ziet in het portaal (tabblad <b>Ontwerp</b>): het verslag, ${docs.length} document${docs.length === 1 ? "" : "en"}${(r.vragen || []).length ? `, ${(r.vragen || []).length} vra${(r.vragen || []).length === 1 ? "ag" : "gen"}` : ""}${r.feedback_tot ? ` en de vraag om feedback tegen ${fmtLong(r.feedback_tot)}` : ""}. <b>Nooit</b> de interne notitie.</p>
    <p>${kl.length ? `Mail naar: ${kl.map(x => esc(x.c.naam)).join(", ")}.` : `<span style="color:var(--warn)">Niemand van dit project heeft portaaltoegang — de ronde staat klaar, maar niemand krijgt een mail.</span>`}</p>
    <p class="muted" style="font-size:13px">Na publiceren liggen de documenten vast. Iets vergeten? Maak een nieuwe ronde: zo blijft de chronologie van het ontwerp helder.</p>`, { saveLabel: "Publiceren", onSave: async () => {
    try { await dbUpdate("ontwerp_rondes", rid, { status: "gepubliceerd" }); } catch (e) { return false; }
    if (typeof driveReady === "function" && driveReady() && kl.length) driveCall("ontwerpmail", { id: rid, soort: "gepubliceerd" }).then(j => toast((j.naar || []).length ? "Gemaild naar " + j.naar.join(", ") : "Gepubliceerd (geen mail verstuurd)", 5000)).catch(e => toast("Gepubliceerd, maar de mail ging niet weg: " + e.message, 7000));
    else toast("Gepubliceerd");
  } });
}
function oPlusForm(rid, soort) {
  const r = S.ontwerp_rondes[rid]; if (!r) return; const w = soort === "wijziging";
  openModal(w ? `Ontwerpwijziging — V${r.nummer}` : `Afspraak — V${r.nummer}`, `<div class="form-grid">
    <div class="field span2"><label for="op_t">${w ? "Wat wijzigt er in het ontwerp?" : "Wat werd afgesproken?"} (ziet de klant)</label><textarea id="op_t" name="tekst" rows="3" required maxlength="4000" placeholder="${w ? "bv. Dakraam vergroten naar 114 × 118 cm" : "bv. Kastfronten in gelakte eik, kleur volgt in V2"}"></textarea></div>
    <div class="field"><label for="op_s">Budgetimpact</label><select id="op_s" name="impact_status">${opts(Object.entries(O_IMPACT).filter(([k]) => k !== "in_voorstel"), w ? "indicatief" : "geen")}</select></div>
    <div class="field"><label>Bedrag of vork (excl. btw)</label><div style="display:flex;gap:6px"><input name="impact_min" type="number" step="10" placeholder="van €"><input name="impact_max" type="number" step="10" placeholder="tot €"></div></div>
    <div class="field span2"><label for="op_to">Toelichting bij het bedrag (optioneel)</label><input id="op_to" name="impact_toelichting" maxlength="300"></div>
  </div>`, { saveLabel: "Toevoegen", onSave: async (d) => {
    const num = (v) => v === "" || v == null ? null : Math.round(Number(v) * 100) / 100;
    const row = { ronde_id: rid, project_id: r.project_id, soort, tekst: d.tekst.trim(), impact_status: d.impact_status, impact_min: num(d.impact_min), impact_max: num(d.impact_max), impact_toelichting: (d.impact_toelichting || "").trim() };
    if (row.impact_status === "geen") { row.impact_min = null; row.impact_max = null; }
    try { await dbInsert("ontwerp_feedback", row); } catch (e) { return false; }
    oKompasLaad(r.project_id, true); toast(w ? "Ontwerpwijziging toegevoegd" : "Afspraak toegevoegd");
  } });
}

/* ---------- gebeurtenissen ---------- */
document.addEventListener("click", async (e) => {
  const el = e.target.closest && e.target.closest("[data-o-act]"); if (!el) return;
  const a = el.dataset.oAct, id = el.dataset.id; const r = id && S.ontwerp_rondes ? S.ontwerp_rondes[id] : null;
  if (a === "open") { O.open = id; O.hl = null; render(); window.scrollTo(0, 0); return; }
  if (a === "lijst") { O.open = null; render(); return; }
  if (a === "nieuw") return oRondeForm(el.dataset.pid);
  if (a === "budget") return oBudgetForm(el.dataset.pid);
  if (a === "bewerk" && r) return oRondeForm(r.project_id, r);
  if (a === "docs" && r) return oDocsForm(id);
  if (a === "publiceer" && r) return oPubliceerForm(id);
  if (a === "plus" && r) return oPlusForm(id, el.dataset.soort);
  if (a === "sluit" && r) { if (!confirm(`V${r.nummer} afsluiten? De klant kan dan geen feedback meer geven (de ronde blijft zichtbaar).`)) return; await dbUpdate("ontwerp_rondes", id, { status: "afgesloten" }).catch(() => { }); toast("Afgesloten"); return; }
  if (a === "heropen" && r) { await dbUpdate("ontwerp_rondes", id, { status: "gepubliceerd" }).catch(() => { }); toast("Heropend: de klant kan weer feedback geven"); return; }
  if (a === "weg" && r) { if (!confirm(`Concept V${r.nummer} verwijderen (met de documenten)?`)) return; const paden = oDocs(id).map(d => d.pad); try { await dbDelete("ontwerp_rondes", id); } catch (x) { return; } if (paden.length) sb.storage.from("ontwerp").remove(paden).catch(() => { }); O.open = null; toast("Verwijderd"); render(); return; }
  if (a === "doc-weg") { const d = S.ontwerp_documenten[id]; if (!d || !confirm(`"${d.titel}" verwijderen?`)) return; try { await dbDelete("ontwerp_documenten", id); } catch (x) { return; } sb.storage.from("ontwerp").remove([d.pad]).catch(() => { }); toast("Verwijderd"); return; }
  if (a === "titel") { const d = S.ontwerp_documenten[id]; if (!d) return; const t = prompt("Titel van het document (ziet de klant):", d.titel || ""); if (t == null || !t.trim()) return; await dbUpdate("ontwerp_documenten", id, { titel: t.trim().slice(0, 200) }).catch(() => { }); return; }
  if (a === "speld" || a === "toon") { O.hl = id; render(); const t = document.getElementById(a === "speld" ? "ofb-" + id : null) || document.querySelector(`.o-pin[data-id="${id}"]`); if (t) t.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
});
document.addEventListener("submit", (e) => {
  const f = e.target; if (!f.dataset || !f.dataset.oFb) return;
  e.preventDefault(); e.stopPropagation(); oFbBewaar(f);
}, true);
/* na het tekenen van de pagina: beelden/pdf laden */
(function () {
  const mo = new MutationObserver(() => { if (document.querySelector(".o-pg:not([data-geladen])")) oLaadZichtbaar(); });
  const start = () => { const app = document.getElementById("app"); if (app) mo.observe(app, { childList: true, subtree: true }); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  const st = document.createElement("style");
  st.textContent = `.o-tijdlijn{display:grid;gap:8px;padding:0 16px 14px}.o-ronde{display:flex;gap:14px;align-items:flex-start;text-align:left;border:1px solid var(--line);background:var(--surface);border-radius:12px;padding:10px 14px;cursor:pointer;font:inherit;color:inherit}
  .o-ronde:hover{border-color:var(--ink)}.o-v{font-family:var(--font-display);font-size:22px;font-weight:700;min-width:44px}.o-r-in{flex:1;min-width:0}
  .o-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(300px,1fr);gap:16px;align-items:start}@media (max-width:980px){.o-grid{grid-template-columns:1fr}}
  .o-pags{display:grid;gap:10px;padding:10px}.o-pg{position:relative;background:var(--surface-2);border-radius:6px;overflow:hidden;min-height:120px}.o-pg img,.o-pg canvas{display:block;width:100%;height:auto}
  .o-pg.fout::after{content:"Kon niet geladen worden";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--crit);font-size:13px}
  .o-pnr{position:absolute;right:8px;bottom:6px;font-size:11px;background:rgba(255,255,255,.85);border-radius:8px;padding:1px 6px}
  .o-pin{position:absolute;transform:translate(-50%,-100%);min-width:26px;height:26px;border-radius:13px 13px 13px 2px;border:2px solid #fff;background:var(--crit,#c0392b);color:#fff;font-weight:700;font-size:12px;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.35);padding:0 6px}
  .o-pin.ok{background:var(--ok,#2e7d32)}.o-pin.hl{outline:3px solid var(--blue,#2A4DD0)}.o-pin.sm{position:static;transform:none;flex:0 0 auto;margin-top:2px}
  .o-fbl{display:grid;gap:12px}.o-fb{display:flex;gap:10px;align-items:flex-start;border-bottom:1px solid var(--line);padding-bottom:10px}.o-fb:last-child{border-bottom:0}.o-fb.hl{background:var(--surface-2);border-radius:8px}
  .o-fb-in{flex:1;min-width:0}.o-fb-kop{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.o-fb-t{white-space:pre-line;margin:4px 0 6px}
  .o-fbf{display:grid;gap:6px}.o-fbf-r{display:flex;gap:6px;align-items:flex-start;flex-wrap:wrap}.o-fbf-r textarea,.o-fbf-r input{flex:1;min-width:180px}.o-fbf-i{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.o-fbf-i input[type=number]{width:110px}.o-fbf-i input[name=impact_toelichting]{flex:1;min-width:180px}
  .o-vraag{margin-bottom:10px}.o-antw{border-left:3px solid var(--line);padding-left:10px;margin:6px 0}
  .o-lijst{list-style:none;margin:0;padding:0}.o-lijst li{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid var(--line)}.o-lijst li:last-child{border-bottom:0}
  .o-kol{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-top:8px}.o-kol h4{margin:6px 0}
  .o-meter{margin:4px 0}.o-m-bar{position:relative;height:18px;background:var(--surface-2);border-radius:9px;overflow:visible}
  .o-m-bar i{position:absolute;top:0;bottom:0;border-radius:9px}.o-m-basis{background:var(--ink,#1B1E1C);left:0}.o-m-vast{background:#8a6d3b}
  .o-m-open{background:repeating-linear-gradient(45deg,rgba(42,77,208,.35) 0 6px,rgba(42,77,208,.12) 6px 12px);border:1px dashed rgba(42,77,208,.6)}
  .o-m-grens{position:absolute;top:-5px;bottom:-5px;width:3px;background:var(--crit,#c0392b);border-radius:2px}.o-meter.over .o-m-open{background:repeating-linear-gradient(45deg,rgba(192,57,43,.4) 0 6px,rgba(192,57,43,.12) 6px 12px);border-color:rgba(192,57,43,.7)}
  .o-m-leg{display:flex;flex-wrap:wrap;gap:14px;margin-top:8px;font-size:12px}.o-m-leg span{display:flex;align-items:center;gap:6px}.o-m-leg i{display:inline-block;width:14px;height:10px;border-radius:3px;position:static}.o-m-leg i.o-m-grens{width:3px;height:12px}`;
  document.head.appendChild(st);
})();
