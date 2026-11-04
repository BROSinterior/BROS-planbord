/* =====================================================================
   BROS Klantenportaal — Ontwerp, Budget en to-do-checklists (v1.63, databasescript 059)
   Ontwerp: per ontwerpgesprek een ronde met het verslag en de presentatie. De klant tikt op een plek in een beeld of
   pagina en zet daar een speld met zijn opmerking; hij beantwoordt de vragen, verstuurt zijn feedback naar BROS en
   bevestigt de ronde. Wat hij nog niet verstuurde, ziet enkel hijzelf (concept).
   Budget (als BROS het deelt): richtbudget of goedgekeurde offerte, wat vastligt, wat nog open staat ("wat als"),
   en hoe het budget veranderde. Bedragen excl. btw; indicatief tot een keuze of voorstel goedgekeurd is.
   Gebruikt de views klant_ontwerp_* en klant_taak_punten en de functies klant_ontwerp_* / budgetkompas.
   ===================================================================== */
const KO = { pop: null, urls: {}, pdf: {}, kompas: {}, watals: {}, bezig: false };
const koRondes = (p) => (D().ontwerpRondes || []).filter(r => r.project_id === p.id).sort((a, b) => b.nummer - a.nummer);
const koDocs = (rid) => (D().ontwerpDocs || []).filter(d => d.ronde_id === rid).sort((a, b) => (a.volgorde || 0) - (b.volgorde || 0));
const koFb = (rid) => (D().ontwerpFeedback || []).filter(f => f.ronde_id === rid).sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
const koConcepten = (rid) => koFb(rid).filter(f => f.eigen && !f.verstuurd_op);
const koEurS = (n) => n == null ? "—" : (Number(n) > 0 ? "+ " : Number(n) < 0 ? "− " : "") + eur(Math.abs(Number(n)), 0);
const koVork = (a, b) => Number(a) === Number(b) ? koEurS(a) : `${koEurS(a)} à ${koEurS(b)}`;
const koWacht = (p) => koRondes(p).filter(r => r.status === "gepubliceerd" && !r.bevestigd_op && !koFb(r.id).some(f => f.eigen && f.verstuurd_op)).length;
const koReactie = { aangepast: "Aangepast", niet_mogelijk: "Niet mogelijk", afspraak: "Afspraak", genoteerd: "Genoteerd" };
function koStatus(r) {
  if (r.status === "afgesloten") return `<span class="pill grijs">Afgesloten</span>`;
  if (r.bevestigd_op) return `<span class="pill akkoord">Bevestigd</span>`;
  if (koFb(r.id).some(f => f.eigen && f.verstuurd_op)) return `<span class="pill verzonden">Feedback verstuurd</span>`;
  return `<span class="pill open">Wacht op je feedback</span>`;
}
function koUrl(pad) {
  const c = KO.urls[pad]; if (c && c.url && c.tot > Date.now() + 60000) return Promise.resolve(c.url); if (c && c.p) return c.p;
  const pr = sb.storage.from("ontwerp").createSignedUrl(pad, 3600).then(({ data, error }) => { if (error || !data) { delete KO.urls[pad]; throw error || new Error("geen link"); } KO.urls[pad] = { url: data.signedUrl, tot: Date.now() + 3500000 }; return data.signedUrl; });
  KO.urls[pad] = { p: pr }; return pr;
}

/* ---------- Budgetkompas ---------- */
function koKompas(p) {
  const k = KO.kompas[p.id];
  if (k && (Date.now() - k.t < 90000 || k.laden)) return k.data;
  KO.kompas[p.id] = { t: Date.now(), data: k ? k.data : null, laden: true };
  sb.rpc("budgetkompas", { p_project: p.id }, { get: true }).then(({ data, error }) => { const was = k && k.data; KO.kompas[p.id] = { t: Date.now(), data: error ? null : data, laden: false }; if (!!was !== !!(error ? null : data) || S.tab === "budget" || S.tab === "ontwerp") render(true); });
  return k ? k.data : null;
}
function koMeter(k, vmin, vmax) {
  if (!k || k.basis == null) return "";
  const lo = Number(k.huidig), grens = k.budgetgrens != null ? Number(k.budgetgrens) : null, basis = Number(k.basis);
  const top = Math.max(lo, vmax, basis, grens || 0) * 1.06 || 1; const pc = (x) => Math.max(0, Math.min(100, x / top * 100)); const over = grens != null && vmax > grens;
  return `<div class="ko-meter${over ? " over" : ""}"><div class="ko-bar"><i class="ko-basis" style="width:${pc(Math.min(basis, lo))}%"></i><i class="ko-vast" style="left:${pc(Math.min(basis, lo))}%;width:${pc(Math.abs(lo - basis))}%"></i>
      <i class="ko-open" style="left:${pc(Math.min(vmin, lo))}%;width:${Math.max(0.6, pc(vmax) - pc(Math.min(vmin, lo)))}%"></i>${grens != null ? `<b class="ko-grens" style="left:${pc(grens)}%"></b>` : ""}</div>
    <div class="ko-leg"><span><i class="ko-basis"></i>${k.basis_soort === "offerte" ? "Offerte" : "Richtbudget"} ${eur(basis, 0)}</span>${Math.abs(lo - basis) > 0.005 ? `<span><i class="ko-vast"></i>Vastgelegd ${koEurS(lo - basis)}</span>` : ""}<span><i class="ko-open"></i>Nog open ${vmin === vmax ? koEurS(vmin - lo) : koEurS(vmin - lo) + " à " + koEurS(vmax - lo)}</span>${grens != null ? `<span><i class="ko-grens"></i>Je budgetgrens ${eur(grens, 0)}</span>` : ""}</div></div>`;
}
/* wat als: open punten aan/uit (keuze: een optie), enkel om te proberen — er verandert niets */
function koWatAls(k, pid) {
  const w = KO.watals[pid] = KO.watals[pid] || {}; let mn = 0, mx = 0;
  (k.open || []).forEach(o => { const s = w[o.ref];
    if (o.soort === "keuze") { const opt = s && (o.opties || []).find(x => x.id === s); if (opt) { mn += Number(opt.bedrag); mx += Number(opt.bedrag); } else { mn += Number(o.min); mx += Number(o.max); } }
    else if (s === undefined ? o.standaard : s) { mn += Number(o.min); mx += Number(o.max); } });
  return { min: Number(k.huidig) + mn, max: Number(k.huidig) + mx };
}
function vBudget(p) {
  const k = koKompas(p);
  if (!k) return `<h1>Budget</h1><div class="panel"><div class="empty"><b>Even laden…</b></div></div>`;
  if (k.basis == null) return `<h1>Budget</h1><div class="panel"><div class="empty"><b>Nog geen budget</b>Zodra BROS het richtbudget invult, zie je hier hoe je keuzes het eindbudget beïnvloeden.</div></div>`;
  const wa = koWatAls(k, p.id); const w = KO.watals[p.id] || {}; const grens = k.budgetgrens != null ? Number(k.budgetgrens) : null;
  const rij = (l, v, sub) => `<div class="ko-kpi"><div class="muted" style="font-size:12px">${l}</div><div class="ko-v">${v}</div>${sub ? `<div class="muted" style="font-size:12px">${sub}</div>` : ""}</div>`;
  const open = k.open || [];
  return `<h1 style="margin-bottom:6px">Budget</h1><p class="muted" style="margin-bottom:16px">Hoe de keuzes tijdens het ontwerp en de werf je eindbudget beïnvloeden. Alle bedragen zijn <b>excl. btw</b>. Wat nog open staat, is een inschatting van BROS; bindend wordt het pas bij een keuze of een voorstel dat je goedkeurt.${k.toelichting ? `<br>${nt(k.toelichting)}` : ""}</p>
    <div class="panel" style="margin-bottom:16px"><div class="panel-body">${koMeter(k, wa.min, wa.max)}
      <div class="ko-kpis">${rij(k.basis_soort === "offerte" ? "Goedgekeurde offerte" : "Richtbudget", eur(k.basis, 0))}${rij("Vastgelegd sindsdien", koEurS(k.som_vast))}${rij("Huidig budget", `<b>${eur(k.huidig, 0)}</b>`)}
        ${rij("Verwacht eindbudget", eur(wa.min, 0) + (Math.abs(wa.max - wa.min) > 0.5 ? " – " + eur(wa.max, 0) : ""), open.length ? "met de open punten zoals hieronder aangeduid" : "")}${grens != null ? rij("Je budgetgrens", `<span style="${wa.max > grens ? "color:var(--crit)" : ""}">${eur(grens, 0)}</span>`, wa.max > grens ? `${eur(wa.max - grens, 0)} erboven — bespreek het gerust met BROS` : "binnen je budget") : ""}</div></div></div>
    ${open.length ? `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h2>Wat als?</h2><div class="muted" style="font-size:13px">Zet punten aan of uit en zie het eindbudget meebewegen. Proberen verandert niets aan je project.</div></div></div>
      <div class="panel-body ko-wa">${open.map(o => o.soort === "keuze"
        ? `<label class="ko-wa-r"><span><b>${nt(o.titel)}</b><small class="muted" style="display:block">keuze nog te maken (tabblad Keuzes)</small></span><select data-ko-wa="${o.ref}" data-pid="${p.id}"><option value="">nog niet gekozen (${koVork(o.min, o.max)})</option>${(o.opties || []).map(x => `<option value="${x.id}" ${w[o.ref] === x.id ? "selected" : ""}>${esc(x.naam)} · ${Number(x.bedrag) ? koEurS(x.bedrag) : "inbegrepen"}</option>`).join("")}</select></label>`
        : `<label class="ko-wa-r"><span><b>${nt(o.titel)}</b><small class="muted" style="display:block">${o.soort === "voorstel" ? "voorstel ter goedkeuring (tabblad Akkoord)" : o.klant_keuze === "niet" ? "jij gaf aan: liever niet" : o.klant_keuze === "doorvoeren" ? "jij gaf aan: doorvoeren" : "indicatief, uit het ontwerp"}${o.toelichting ? " · " + nt(o.toelichting) : ""}</small></span><span class="ko-wa-b">${koVork(o.min, o.max)}</span><input type="checkbox" data-ko-wa="${o.ref}" data-pid="${p.id}" ${(w[o.ref] === undefined ? o.standaard : w[o.ref]) ? "checked" : ""}></label>`).join("")}</div></div>` : ""}
    ${(k.vast || []).length ? `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h2>Wat vastligt</h2></div><table class="t"><tbody>${k.vast.map(v => `<tr><td>${nt(v.titel)}<div class="muted" style="font-size:12px">${({ meerwerk: "meer- of minwerk", keuze: "jouw keuze", ontwerp: "ontwerpbeslissing" })[v.soort] || ""} · ${fmt(v.datum)}</div></td><td class="r num"><b>${koEurS(v.bedrag)}</b></td></tr>`).join("")}</tbody></table></div>` : ""}
    ${(k.verloop || []).length ? `<div class="panel"><div class="panel-head"><h2>Hoe je budget evolueerde</h2></div><table class="t"><tbody>${k.verloop.map(v => `<tr><td class="num muted" style="width:96px">${fmt(v.datum)}</td><td>${nt(v.titel)}</td><td class="r num">${koEurS(v.delta)}</td><td class="r num"><b>${eur(v.totaal, 0)}</b></td></tr>`).join("")}</tbody></table></div>` : ""}`;
}

/* ---------- Ontwerp ---------- */
function vOntwerp(p) {
  const r = S.oOpen && (D().ontwerpRondes || []).find(x => x.id === S.oOpen && x.project_id === p.id);
  if (r) return koRonde(p, r);
  const rs = koRondes(p); const afs = koAfspraken(p);
  return `<h1 style="margin-bottom:6px">Ontwerp</h1><p class="muted" style="margin-bottom:16px">Na elk ontwerpgesprek vind je hier het verslag en de presentatie. Geef je feedback rechtstreeks op het ontwerp: tik op de plek waar je iets over wil zeggen. Zo blijft helder wat we samen beslisten.</p>
    ${rs.length ? `<div class="ko-tijdlijn">${rs.map(x => { const fb = koFb(x.id); const docs = koDocs(x.id);
      return `<button type="button" class="ko-ronde" data-act="ko-open" data-id="${x.id}"><span class="ko-v">V${x.nummer}</span><span style="flex:1;min-width:0"><b>${nt(x.titel || "Ontwerpronde " + x.nummer)}</b> ${koStatus(x)}
        <span class="muted" style="display:block;font-size:13px">Gesprek van ${fmtLang(x.datum)} · ${docs.length} document${docs.length === 1 ? "" : "en"}${x.status === "gepubliceerd" && !x.bevestigd_op && x.feedback_tot ? ` · feedback graag vóór ${fmtLang(x.feedback_tot)}` : ""}${x.bevestigd_op ? ` · bevestigd door ${esc(x.bevestigd_naam)}` : ""}${koConcepten(x.id).length ? ` · <b>${koConcepten(x.id).length} nog niet verstuurd</b>` : ""}</span></span><span class="muted">›</span></button>`; }).join("")}</div>`
      : `<div class="panel"><div class="empty"><b>Nog geen ontwerp gedeeld</b>Na het eerste ontwerpgesprek vind je hier de presentatie.</div></div>`}
    ${afs.length ? `<div class="panel" style="margin-top:16px"><div class="panel-head"><h2>Gemaakte afspraken</h2><span class="muted" style="font-size:13px">${afs.length}</span></div><table class="t"><tbody>${afs.map(f => { const r2 = (D().ontwerpRondes || []).find(x => x.id === f.ronde_id);
      return `<tr><td class="num muted" style="width:44px">V${r2 ? r2.nummer : "?"}</td><td>${nt(f.door_klant ? (f.reactie || f.tekst) : f.tekst)}${f.door_klant ? `<div class="muted" style="font-size:12px">op je feedback: “${nt(f.tekst.slice(0, 100))}”</div>` : ""}</td><td class="num muted" style="font-size:13px">${fmt(f.reactie_op || f.created_at)}</td></tr>`; }).join("")}</tbody></table></div>` : ""}`;
}
const koAfspraken = (p) => (D().ontwerpFeedback || []).filter(f => f.project_id === p.id && f.verstuurd_op && (f.soort === "afspraak" || f.reactie_status === "afspraak"))
  .sort((a, b) => (a.reactie_op || a.created_at || "").localeCompare(b.reactie_op || b.created_at || ""));
function koImpact(f, p, kan) {
  if (!f.impact_status || f.impact_status === "geen") return "";
  if (f.impact_status === "vervallen") return `<div class="ko-imp muted">Budgetimpact: vervallen</div>`;
  if (f.impact_status === "akkoord") return `<div class="ko-imp">Afgesproken: <b>${koVork(f.impact_min, f.impact_max)}</b> <span class="muted">excl. btw${f.impact_toelichting ? " · " + nt(f.impact_toelichting) : ""}</span></div>`;
  if (f.impact_status === "in_voorstel") return `<div class="ko-imp">In een meerwerkvoorstel: <b>${koVork(f.impact_min, f.impact_max)}</b> <span class="muted">excl. btw — keur het goed onder Akkoord</span></div>`;
  return `<div class="ko-imp">Indicatieve impact: <b>${koVork(f.impact_min, f.impact_max)}</b> <span class="muted">excl. btw${f.impact_toelichting ? " · " + nt(f.impact_toelichting) : ""}</span>
    ${kan ? `<div class="ko-kz"><button class="btn sm ${f.klant_keuze === "doorvoeren" ? "primary" : ""}" data-act="ko-imp" data-id="${f.id}" data-k="doorvoeren">Graag doorvoeren</button><button class="btn sm ${f.klant_keuze === "niet" ? "primary" : ""}" data-act="ko-imp" data-id="${f.id}" data-k="niet">Liever niet</button></div><div class="muted" style="font-size:12px">Geen verbintenis: BROS maakt er een keuze of voorstel van dat je nog goedkeurt.</div>` : f.klant_keuze ? `<div class="muted" style="font-size:12px">Je gaf aan: ${f.klant_keuze === "niet" ? "liever niet" : "graag doorvoeren"}</div>` : ""}</div>`;
}
function koFbItem(f, p, nr, r) {
  const d = f.document_id && (D().ontwerpDocs || []).find(x => x.id === f.document_id);
  const kan = r && r.status === "gepubliceerd";
  return `<div class="ko-fb${f.eigen && !f.verstuurd_op ? " concept" : ""}" id="kofb-${f.id}">${nr ? `<button type="button" class="ko-pin sm${f.eigen && !f.verstuurd_op ? " concept" : f.reactie_status && f.reactie_status !== "open" ? " ok" : ""}" data-act="ko-toon" data-id="${f.id}">${nr}</button>` : ""}<div style="flex:1;min-width:0">
    <div class="muted" style="font-size:12px">${f.door_klant ? esc(f.auteur_naam || "") : f.soort === "afspraak" ? "Afspraak · BROS" : "Ontwerpwijziging · BROS"}${d ? " · " + nt(d.titel || "document") + (d.paginas > 1 ? " p." + (f.pagina || 1) : "") : ""} · ${fmt(f.verstuurd_op || f.created_at)}${f.eigen && !f.verstuurd_op ? ` · <b style="color:var(--blue)">nog niet verstuurd</b>` : ""}</div>
    <div style="white-space:pre-line">${nt(f.tekst)}</div>
    ${f.eigen && !f.verstuurd_op && kan ? `<div class="ko-kz"><button class="btn ghost sm" data-act="ko-bewerk" data-id="${f.id}">Aanpassen</button><button class="btn ghost sm" data-act="ko-weg" data-id="${f.id}">Verwijderen</button></div>` : ""}
    ${f.reactie ? `<div class="ko-reactie"><b>BROS${koReactie[f.reactie_status] ? " · " + koReactie[f.reactie_status] : ""}:</b> ${nt(f.reactie)}</div>` : f.door_klant && f.verstuurd_op ? `<div class="muted" style="font-size:12px">BROS bekijkt je feedback.</div>` : ""}
    ${koImpact(f, p, kan && f.verstuurd_op)}</div></div>`;
}
function koRonde(p, r) {
  const docs = koDocs(r.id); const fb = koFb(r.id); const kan = r.status === "gepubliceerd";
  const pins = fb.filter(f => f.document_id); const nr = {}; pins.forEach((f, i) => nr[f.id] = i + 1);
  const conc = koConcepten(r.id); const vragen = Array.isArray(r.vragen) ? r.vragen : [];
  const vorige = koRondes(p).find(x => x.nummer === r.nummer - 1);
  const aangepast = vorige ? koFb(vorige.id).filter(f => f.door_klant && f.reactie && f.reactie_status !== "open") : [];
  const algemeen = fb.filter(f => f.door_klant && !f.document_id && !f.vraag_id); const bros = fb.filter(f => !f.door_klant);
  const naam = D().ik[0]?.naam || S.me?.name || "";
  return `<div style="margin-bottom:10px"><button class="btn ghost sm" data-act="ko-lijst">‹ Alle ontwerprondes</button></div>
    <h1 style="margin-bottom:4px">Ontwerp V${r.nummer}${r.titel ? " — " + nt(r.titel) : ""}</h1><p class="muted" style="margin-bottom:14px">Gesprek van ${fmtLang(r.datum)} ${koStatus(r)}${kan && r.feedback_tot && !r.bevestigd_op ? ` · feedback graag vóór ${fmtLang(r.feedback_tot)}` : ""}</p>
    ${aangepast.length ? `<div class="panel" style="margin-bottom:16px;border-color:var(--ok)"><div class="panel-head"><h2>Wat we aanpasten na je feedback op V${vorige.nummer}</h2></div><div class="panel-body ko-lijst">${aangepast.map(f => `<div><div class="muted" style="font-size:12px">Jij: “${nt(f.tekst.slice(0, 160))}”</div><div><b>${koReactie[f.reactie_status] || ""}:</b> ${nt(f.reactie)}</div></div>`).join("")}</div></div>` : ""}
    ${r.verslag ? `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h2>Verslag van het gesprek</h2></div><div class="panel-body" style="white-space:pre-line;font-size:15px">${nt(r.verslag)}</div></div>` : ""}
    ${docs.length ? `${kan ? `<div class="notice" style="margin-bottom:12px"><div><b>Tik op het ontwerp</b> waar je iets wil zeggen en schrijf je opmerking. Je feedback blijft van jou tot je ze verstuurt.</div></div>` : ""}${docs.map(d => koDoc(d, pins, nr, kan)).join("")}` : ""}
    ${vragen.length ? `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h2>Vragen van BROS</h2></div><div class="panel-body">${vragen.map(q => { const mijn = fb.find(f => f.vraag_id === q.id && f.eigen); const ander = fb.filter(f => f.vraag_id === q.id && !f.eigen);
      return `<form class="ko-vraag" data-ko-vraag="${esc(q.id)}" data-ronde="${r.id}"><label class="field"><b>${nt(q.tekst)}</b>${mijn && mijn.verstuurd_op ? `<div style="white-space:pre-line;margin-top:4px">${nt(mijn.tekst)} <span class="muted" style="font-size:12px">— verstuurd ${fmt(mijn.verstuurd_op)}</span></div>${mijn.reactie ? `<div class="ko-reactie"><b>BROS:</b> ${nt(mijn.reactie)}</div>` : ""}` : kan ? `<textarea name="tekst" rows="2" maxlength="4000" placeholder="Je antwoord">${esc(mijn ? mijn.tekst : "")}</textarea>` : `<div class="muted">—</div>`}</label>
        ${ander.map(f => `<div class="muted" style="font-size:13px">${esc(f.auteur_naam)}: ${nt(f.tekst)}</div>`).join("")}${kan && !(mijn && mijn.verstuurd_op) ? `<div class="gk-actions"><button class="btn sm" type="submit">${mijn ? "Antwoord aanpassen" : "Antwoord bewaren"}</button></div>` : ""}</form>`; }).join("")}</div></div>` : ""}
    ${pins.length ? `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h2>Feedback op het ontwerp</h2><span class="muted" style="font-size:13px">${pins.length}</span></div><div class="panel-body ko-lijst">${pins.map(f => koFbItem(f, p, nr[f.id], r)).join("")}</div></div>` : ""}
    <div class="panel" style="margin-bottom:16px"><div class="panel-head"><h2>Algemene opmerkingen</h2></div><div class="panel-body ko-lijst">${algemeen.map(f => koFbItem(f, p, null, r)).join("")}
      ${kan ? `<form class="ko-alg" data-ronde="${r.id}"><label class="field">Iets wat niet op één plek hoort?<textarea name="tekst" rows="3" maxlength="4000" placeholder="bv. De sfeer is mooi, maar graag iets warmer licht"></textarea></label><div class="gk-actions"><button class="btn sm" type="submit">Toevoegen</button></div></form>` : algemeen.length ? "" : `<div class="muted">—</div>`}</div></div>
    ${bros.length ? `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h2>Afspraken en wijzigingen</h2></div><div class="panel-body ko-lijst">${bros.map(f => koFbItem(f, p, null, r)).join("")}</div></div>` : ""}
    ${kan && !r.bevestigd_op ? `<div class="panel" style="margin-bottom:90px"><div class="panel-head"><div><h2>Ontwerp bevestigen</h2><div class="muted" style="font-size:13px">Ben je akkoord met dit ontwerp als basis om verder te werken? Bevestig met je naam. Dit is geen goedkeuring van een prijs.</div></div></div>
      <form class="ko-bev panel-body kp-form" data-ronde="${r.id}" style="max-width:560px"><label class="field">Je naam<input name="naam" value="${esc(naam)}" autocomplete="name"></label><label class="check"><input type="checkbox" name="ok"> <span>Ik bevestig ontwerp V${r.nummer} als basis om verder te werken.</span></label><div class="gk-actions"><button class="btn primary" type="submit">Bevestigen</button></div><div class="msg"></div></form></div>`
      : r.bevestigd_op ? `<div class="notice" style="margin-bottom:90px;border-color:var(--ok)"><div>✓ Bevestigd door <b>${esc(r.bevestigd_naam)}</b> op ${fmtLang(r.bevestigd_op)}.</div></div>` : `<div style="height:60px"></div>`}
    ${conc.length && kan ? `<div class="ko-balk"><span><b>${conc.length}</b> ${conc.length === 1 ? "opmerking" : "opmerkingen"} nog niet verstuurd</span><button class="btn primary" data-act="ko-verstuur" data-id="${r.id}">Versturen naar BROS</button></div>` : ""}`;
}
function koDoc(d, pins, nr, kan) {
  const pp = pins.filter(f => f.document_id === d.id); const paginas = d.soort === "pdf" ? Array.from({ length: Math.max(1, d.paginas || 1) }, (_, i) => i + 1) : [1];
  return `<div class="panel ko-doc" style="margin-bottom:16px"><div class="panel-head"><h2 style="font-size:16px">${nt(d.titel || "Document")}</h2><span class="muted" style="font-size:13px">${d.soort === "pdf" ? d.paginas + " pagina" + (d.paginas === 1 ? "" : "'s") : ""}</span></div>
    <div class="ko-pags">${paginas.map(n => `<div class="ko-pg${kan ? " kan" : ""}" data-ko-pg="${d.id}" data-p="${n}" ${d.breedte && d.hoogte && d.soort !== "pdf" ? `style="aspect-ratio:${d.breedte}/${d.hoogte}"` : ""}>${d.soort === "pdf" ? `<canvas></canvas>${paginas.length > 1 ? `<span class="ko-pnr">${n}</span>` : ""}` : `<img alt="" loading="lazy">`}
      ${pp.filter(f => (f.pagina || 1) === n && f.x != null).map(f => `<button type="button" class="ko-pin${f.eigen && !f.verstuurd_op ? " concept" : f.reactie_status && f.reactie_status !== "open" ? " ok" : ""}" style="left:${Number(f.x) * 100}%;top:${Number(f.y) * 100}%" data-act="ko-pin" data-id="${f.id}" title="${esc(f.tekst.slice(0, 100))}">${nr[f.id]}</button>`).join("")}
      ${KO.pop && KO.pop.doc === d.id && KO.pop.p === n ? koPop() : ""}</div>`).join("")}</div></div>`;
}
function koPop() {
  const o = KO.pop; const f = o.id && (D().ontwerpFeedback || []).find(x => x.id === o.id);
  const links = o.x > 0.6; const onder = o.y < 0.35;
  if (f && (!f.eigen || f.verstuurd_op)) return `<div class="ko-pop${links ? " l" : ""}${onder ? " o" : ""}" style="left:${o.x * 100}%;top:${o.y * 100}%"><div style="white-space:pre-line">${nt(f.tekst)}</div><div class="muted" style="font-size:12px">${esc(f.auteur_naam || "")} · ${fmt(f.verstuurd_op || f.created_at)}</div>${f.reactie ? `<div class="ko-reactie"><b>BROS:</b> ${nt(f.reactie)}</div>` : ""}<div class="gk-actions"><button type="button" class="btn sm" data-act="ko-pop-dicht">Sluiten</button></div></div>`;
  return `<form class="ko-pop${links ? " l" : ""}${onder ? " o" : ""}" style="left:${o.x * 100}%;top:${o.y * 100}%" data-ko-pop><textarea name="tekst" rows="3" maxlength="4000" placeholder="Wat wil je hier aanpassen of vragen?">${esc(f ? f.tekst : "")}</textarea>
    <div class="gk-actions"><button type="submit" class="btn primary sm">Bewaren</button>${f ? `<button type="button" class="btn ghost sm" data-act="ko-weg" data-id="${f.id}">Verwijderen</button>` : ""}<button type="button" class="btn ghost sm" data-act="ko-pop-dicht">Annuleren</button></div></form>`;
}
/* beelden en pdf-pagina's laden zodra ze in beeld komen */
let koObs = null;
function koLaad() {
  const els = document.querySelectorAll(".ko-pg:not([data-geladen])"); if (!els.length) return;
  if (!koObs && "IntersectionObserver" in window) koObs = new IntersectionObserver((es) => es.forEach(e => { if (e.isIntersecting) { koObs.unobserve(e.target); koLaadPg(e.target); } }), { rootMargin: "400px" });
  els.forEach(el => { el.setAttribute("data-geladen", "1"); if (koObs) koObs.observe(el); else koLaadPg(el); });
}
const koPdfJs = () => laadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", "pdfjsLib").then(x => { x.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; return x; });
async function koLaadPg(el) {
  const d = (D().ontwerpDocs || []).find(x => x.id === el.dataset.koPg); if (!d) return;
  try {
    const url = await koUrl(d.pad);
    if (d.soort !== "pdf") { const img = el.querySelector("img"); if (img) img.src = url; return; }
    const pdfjs = await koPdfJs(); KO.pdf[d.pad] = KO.pdf[d.pad] || pdfjs.getDocument({ url, isEvalSupported: false }).promise;
    const doc = await KO.pdf[d.pad]; const page = await doc.getPage(Number(el.dataset.p) || 1);
    const v1 = page.getViewport({ scale: 1 }); el.style.aspectRatio = `${v1.width}/${v1.height}`;
    const w = Math.max(300, el.clientWidth || 800); const dpr = Math.min(2, window.devicePixelRatio || 1); const vp = page.getViewport({ scale: w / v1.width * dpr });
    const c = el.querySelector("canvas"); c.width = vp.width; c.height = vp.height; await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
  } catch (e) { el.classList.add("fout"); }
}

/* ---------- acties ---------- */
async function koBewaar(args, ok) {
  if (KO.bezig) return null; KO.bezig = true;
  const { data, error } = await sb.rpc("klant_ontwerp_feedback", args); KO.bezig = false;
  if (error) { toast("Dat lukte niet: " + error.message, 6000); return null; }
  const l = D().ontwerpFeedback = D().ontwerpFeedback || [];
  if (data && data.verwijderd) { const i = l.findIndex(x => x.id === args.p_id); if (i >= 0) l.splice(i, 1); }
  else if (data) { const rij = Object.assign({}, data, { eigen: true }); const i = l.findIndex(x => x.id === data.id); if (i >= 0) l[i] = Object.assign(l[i], rij); else l.push(rij); }
  if (ok) toast(ok); return data;
}
async function koVerstuur(rid) {
  const n = koConcepten(rid).length; if (!n || KO.bezig) return;
  if (!confirm(`${n} ${n === 1 ? "opmerking" : "opmerkingen"} versturen naar BROS? Daarna kan je ze niet meer aanpassen (wel nieuwe toevoegen).`)) return;
  KO.bezig = true; const { data, error } = await sb.rpc("klant_ontwerp_versturen", { p_ronde: rid }); KO.bezig = false;
  if (error) { toast("Dat lukte niet: " + error.message, 6000); return; }
  const nu = new Date().toISOString(); koConcepten(rid).forEach(f => { f.verstuurd_op = nu; });
  klantMelding("ontwerp", rid); render(true); toast(`Verstuurd — BROS bekijkt je feedback (${data.verstuurd})`, 5000);
}
document.addEventListener("click", async (e) => {
  const el = e.target.closest && e.target.closest("[data-act^='ko-']");
  if (!el) {   // tikken op een pagina = nieuwe speld (enkel bij een open ronde)
    const pg = e.target.closest && e.target.closest(".ko-pg.kan"); if (!pg || e.target.closest(".ko-pop")) return;
    const rc = pg.getBoundingClientRect(); const x = (e.clientX - rc.left) / rc.width, y = (e.clientY - rc.top) / rc.height; if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return;
    KO.pop = { doc: pg.dataset.koPg, p: Number(pg.dataset.p) || 1, x: Math.round(x * 100000) / 100000, y: Math.round(y * 100000) / 100000 }; render(true);
    setTimeout(() => { const t = document.querySelector(".ko-pop textarea"); if (t) t.focus(); }, 30); return;
  }
  const a = el.dataset.act, id = el.dataset.id;
  if (a === "ko-open") { S.oOpen = id; KO.pop = null; render(); return; }
  if (a === "ko-lijst") { S.oOpen = null; KO.pop = null; render(); return; }
  if (a === "ko-pop-dicht") { KO.pop = null; render(true); return; }
  if (a === "ko-pin" || a === "ko-bewerk") { const f = (D().ontwerpFeedback || []).find(x => x.id === id); if (!f) return;
    if (f.document_id && f.x != null) { KO.pop = { doc: f.document_id, p: f.pagina || 1, x: Number(f.x), y: Number(f.y), id }; render(true); const t = document.querySelector(".ko-pop"); if (t) t.scrollIntoView({ block: "center", behavior: "smooth" }); }
    else if (a === "ko-bewerk") { const t = prompt("Je opmerking:", f.tekst); if (t == null) return; if (await koBewaar({ p_id: id, p_ronde: null, p_document: null, p_pagina: null, p_x: null, p_y: null, p_vraag: "", p_tekst: t }, t.trim() ? "Aangepast" : "Verwijderd")) render(true); }
    return; }
  if (a === "ko-toon") { const t = document.querySelector(`.ko-pin[data-id="${id}"]`); if (t) { t.scrollIntoView({ block: "center", behavior: "smooth" }); t.classList.add("hl"); setTimeout(() => t.classList.remove("hl"), 1600); } return; }
  if (a === "ko-weg") { if (!confirm("Deze opmerking verwijderen?")) return; if (await koBewaar({ p_id: id, p_ronde: null, p_document: null, p_pagina: null, p_x: null, p_y: null, p_vraag: "", p_tekst: "" }, "Verwijderd")) { KO.pop = null; render(true); } return; }
  if (a === "ko-verstuur") return koVerstuur(id);
  if (a === "ko-imp") { const k = el.dataset.k; const f = (D().ontwerpFeedback || []).find(x => x.id === id); const nieuw = f && f.klant_keuze === k ? null : k;
    const { error } = await sb.rpc("klant_ontwerp_impact", { p_feedback: id, p_keuze: nieuw }); if (error) { toast("Dat lukte niet: " + error.message); return; }
    if (f) f.klant_keuze = nieuw; const p = P(); if (p) delete KO.kompas[p.id]; render(true); toast(nieuw === "doorvoeren" ? "Genoteerd: je wil dit graag" : nieuw === "niet" ? "Genoteerd: liever niet" : "Je keuze is gewist"); return; }
});
document.addEventListener("submit", async (e) => {
  const f = e.target;
  if (f.matches && f.matches("form[data-ko-pop]")) { e.preventDefault(); const o = KO.pop; if (!o) return; const t = f.querySelector("textarea").value.trim(); if (!t && !o.id) { KO.pop = null; render(true); return; }
    const r = (D().ontwerpDocs || []).find(x => x.id === o.doc);
    if (await koBewaar({ p_id: o.id || null, p_ronde: r ? r.ronde_id : null, p_document: o.doc, p_pagina: o.p, p_x: o.x, p_y: o.y, p_vraag: "", p_tekst: t }, o.id ? (t ? "Aangepast" : "Verwijderd") : "Bewaard — verstuur je feedback als je klaar bent")) { KO.pop = null; render(true); } return; }
  if (f.matches && f.matches("form.ko-vraag")) { e.preventDefault(); const t = f.querySelector("textarea"); if (!t) return; const mijn = (D().ontwerpFeedback || []).find(x => x.vraag_id === f.dataset.koVraag && x.ronde_id === f.dataset.ronde && x.eigen);
    if (!t.value.trim() && !mijn) { toast("Schrijf je antwoord."); return; }
    if (await koBewaar({ p_id: mijn ? mijn.id : null, p_ronde: f.dataset.ronde, p_document: null, p_pagina: null, p_x: null, p_y: null, p_vraag: f.dataset.koVraag, p_tekst: t.value }, "Antwoord bewaard — nog te versturen")) render(true); return; }
  if (f.matches && f.matches("form.ko-alg")) { e.preventDefault(); const t = f.querySelector("textarea").value.trim(); if (!t) { toast("Schrijf je opmerking."); return; }
    if (await koBewaar({ p_id: null, p_ronde: f.dataset.ronde, p_document: null, p_pagina: null, p_x: null, p_y: null, p_vraag: "", p_tekst: t }, "Bewaard — nog te versturen")) render(true); return; }
  if (f.matches && f.matches("form.ko-bev")) { e.preventDefault(); const m = f.querySelector(".msg"); const naam = f.querySelector("[name=naam]").value.trim();
    if (!naam) { m.className = "msg err"; m.textContent = "Vul je naam in."; return; } if (!f.querySelector("[name=ok]").checked) { m.className = "msg err"; m.textContent = "Vink aan dat je het ontwerp bevestigt."; return; }
    const { error } = await sb.rpc("klant_ontwerp_bevestigen", { p_ronde: f.dataset.ronde, p_naam: naam }); if (error) { m.className = "msg err"; m.textContent = error.message; return; }
    const r = (D().ontwerpRondes || []).find(x => x.id === f.dataset.ronde); if (r) { r.bevestigd_op = new Date().toISOString(); r.bevestigd_naam = naam; }
    klantMelding("ontwerp_bevestigd", f.dataset.ronde); render(true); toast("Bevestigd — dank je!"); return; }
}, true);
document.addEventListener("change", (e) => {
  const el = e.target; if (!el.dataset || !el.dataset.koWa) return;
  const w = KO.watals[el.dataset.pid] = KO.watals[el.dataset.pid] || {}; w[el.dataset.koWa] = el.type === "checkbox" ? el.checked : (el.value || undefined);
  const y = window.scrollY; render(true); window.scrollTo({ top: y });
});

/* ---------- to-do's met een checklist (script 059): punten afvinken ---------- */
const koPunten = (tid) => (D().taakPunten || []).filter(x => x.taak_id === tid).sort((a, b) => (a.volgorde || 0) - (b.volgorde || 0));
function koTdLijst(tid) {
  const ps = koPunten(tid); if (!ps.length) return "";
  return `<ul class="ko-td">${ps.map(x => `<li class="${x.klaar ? "klaar" : ""}"><label>${x.voor_mij ? `<input type="checkbox" data-mijnpunt="${x.id}" ${x.klaar ? "checked" : ""}>` : `<span class="ko-td-s">${x.klaar ? "✅" : "◻︎"}</span>`}<span>${nt(x.tekst)}${x.deadline ? ` <span class="muted" style="font-size:12px;${!x.klaar && x.deadline < todayLocal() ? "color:var(--crit)" : ""}">· vóór ${fmt(x.deadline)}</span>` : ""}</span></label></li>`).join("")}</ul>`;
}
document.addEventListener("change", async (e) => {
  const el = e.target; if (!el.dataset || !el.dataset.mijnpunt) return;
  const id = el.dataset.mijnpunt, klaar = el.checked; el.disabled = true;
  const { data, error } = await sb.rpc("klant_taak_punt_klaar", { p_punt: id, p_klaar: klaar });
  if (error) { toast("Dat lukte niet: " + error.message); el.checked = !klaar; el.disabled = false; return; }
  const x = (D().taakPunten || []).find(q => q.id === id); if (x) x.klaar = klaar;
  if (x && data && data.status) { D().mijnTaken.forEach(t => { if (t.id === x.taak_id) t.status = data.status; }); D().notitieTaken.forEach(t => { if (t.id === x.taak_id) t.status = data.status; }); }
  render(true); toast(klaar ? "Afgevinkt — bedankt!" : "Weer open gezet");
}, true);

(function () {
  const mo = new MutationObserver(() => { if (document.querySelector(".ko-pg:not([data-geladen])")) koLaad(); });
  const start = () => { const app = document.getElementById("app"); if (app) mo.observe(app, { childList: true, subtree: true }); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  const st = document.createElement("style");
  st.textContent = `.ko-tijdlijn{display:grid;gap:10px}.ko-ronde{display:flex;gap:14px;align-items:center;text-align:left;width:100%;border:1px solid var(--line);background:var(--surface);border-radius:16px;padding:14px 16px;cursor:pointer;font:inherit;color:inherit;box-shadow:var(--card)}
  .ko-v{font-family:var(--font-display);font-size:24px;font-weight:700;min-width:46px}
  .ko-pags{display:grid;gap:10px;padding:10px}.ko-pg{position:relative;background:var(--surface-2);border-radius:8px;overflow:visible;min-height:120px}.ko-pg.kan{cursor:crosshair}
  .ko-pg img,.ko-pg canvas{display:block;width:100%;height:auto;border-radius:8px}.ko-pnr{position:absolute;right:8px;bottom:6px;font-size:11px;background:rgba(255,255,255,.85);color:#000;border-radius:8px;padding:1px 6px}
  .ko-pg.fout::after{content:"Kon niet geladen worden";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--crit)}
  .ko-pin{position:absolute;transform:translate(-50%,-100%);min-width:28px;height:28px;border-radius:14px 14px 14px 2px;border:2px solid #fff;background:var(--ink);color:var(--surface);font-weight:700;font-size:13px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.35);padding:0 7px;z-index:2}
  .ko-pin.concept{background:var(--blue);color:#fff}.ko-pin.ok{background:var(--ok);color:#fff}.ko-pin.hl{outline:3px solid var(--warn)}.ko-pin.sm{position:static;transform:none;flex:0 0 auto}
  .ko-pop{position:absolute;z-index:4;width:min(320px,80vw);transform:translate(12px,8px);background:var(--surface);border:1px solid var(--line-2);border-radius:14px;box-shadow:var(--shadow);padding:10px;cursor:auto}
  .ko-pop.l{transform:translate(calc(-100% - 12px),8px)}.ko-pop textarea{width:100%;font:inherit;border:1px solid var(--line-2);border-radius:10px;padding:8px;background:var(--surface);color:var(--ink);box-sizing:border-box}
  @media (max-width:640px){.ko-pop,.ko-pop.l{position:fixed;left:12px !important;right:12px;top:auto !important;bottom:12px;width:auto;transform:none}}
  .ko-lijst{display:grid;gap:12px}.ko-fb{display:flex;gap:10px;align-items:flex-start;border-bottom:1px solid var(--line);padding-bottom:10px}.ko-fb:last-child{border-bottom:0}.ko-fb.concept{background:var(--blue-soft);border-radius:10px;padding:8px}
  .ko-reactie{margin-top:6px;padding:8px 10px;background:var(--surface-2);border-radius:8px;font-size:14px;white-space:pre-line}.ko-imp{margin-top:6px;font-size:14px}.ko-kz{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
  .ko-vraag{margin-bottom:12px}.ko-vraag textarea,.ko-alg textarea{font:inherit;padding:10px 12px;border:1px solid var(--line-2);border-radius:10px;background:var(--surface);color:var(--ink);width:100%;box-sizing:border-box;margin-top:6px}
  .ko-balk{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);display:flex;gap:14px;align-items:center;background:var(--surface);border:1px solid var(--line-2);border-radius:999px;box-shadow:var(--shadow);padding:8px 8px 8px 18px;z-index:6;max-width:calc(100vw - 24px)}
  .ko-meter{margin:4px 0 12px}.ko-bar{position:relative;height:20px;background:var(--surface-2);border-radius:10px}.ko-bar i{position:absolute;top:0;bottom:0;border-radius:10px}.ko-basis{background:var(--ink);left:0}.ko-vast{background:#8a6d3b}
  .ko-open{background:repeating-linear-gradient(45deg,color-mix(in srgb,var(--blue) 40%,transparent) 0 6px,color-mix(in srgb,var(--blue) 12%,transparent) 6px 12px);border:1px dashed var(--blue)}
  .ko-grens{position:absolute;top:-6px;bottom:-6px;width:3px;background:var(--crit);border-radius:2px}.ko-meter.over .ko-open{background:repeating-linear-gradient(45deg,color-mix(in srgb,var(--crit) 40%,transparent) 0 6px,color-mix(in srgb,var(--crit) 12%,transparent) 6px 12px);border-color:var(--crit)}
  .ko-leg{display:flex;flex-wrap:wrap;gap:14px;margin-top:10px;font-size:13px}.ko-leg span{display:flex;align-items:center;gap:6px}.ko-leg i{display:inline-block;width:14px;height:10px;border-radius:3px;position:static}.ko-leg i.ko-grens{width:3px;height:12px}
  .ko-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px}.ko-v{font-size:18px}.ko-kpi .ko-v{font-family:var(--font-display);font-variant-numeric:tabular-nums}
  .ko-wa{display:grid;gap:10px}.ko-wa-r{display:flex;gap:12px;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:8px;cursor:pointer}.ko-wa-r:last-child{border-bottom:0}.ko-wa-r input[type=checkbox]{width:20px;height:20px}.ko-wa-r select{max-width:52%;font:inherit;padding:6px;border-radius:8px;border:1px solid var(--line-2);background:var(--surface);color:var(--ink)}.ko-wa-b{white-space:nowrap;font-variant-numeric:tabular-nums}
  .ko-td{list-style:none;margin:6px 0 0;padding:0}.ko-td li{padding:3px 0}.ko-td label{display:flex;gap:8px;align-items:flex-start;cursor:pointer}.ko-td input{width:18px;height:18px;flex:0 0 auto;margin-top:2px}.ko-td li.klaar span{color:var(--muted);text-decoration:line-through}.ko-td-s{flex:0 0 auto}`;
  document.head.appendChild(st);
})();
