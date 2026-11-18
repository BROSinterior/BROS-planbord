/* =====================================================================
   BROS Planbord — naservice.js (v1.77, script 069)
   - Projecttabblad Naservice (groep Werf): voorlopige oplevering aanvinken, de lijn tot de definitieve oplevering,
     een bord met alle punten (te beoordelen · in behandeling · opgelost · afgesloten) en per punt de volledige historiek.
   - Hoofdscherm Naservice (Meer ▾): alle projecten in naservice en alle openstaande punten, oudste eerst.
   - Punten registreren die per mail of telefoon binnenkwamen (met de datum van ontvangst), beoordelen, toewijzen aan
     een aannemer, inplannen, afsluiten, berichten (klant/aannemer/intern) en zelf acties registreren met een datum.
   Alle statuswijzigingen lopen via de databankfunctie naservice_actie: elke stap komt in de tijdlijn (wie, wat, wanneer).
   Geladen na facturatie.js en vóór app.js; gebruikt naservice-weergave.js (NSW).
   ===================================================================== */
const nsKlaar = () => !!S.naservice_punten && typeof NSW === "object";
const nsPunten = (pid) => Object.values(S.naservice_punten || {}).filter(n => !pid || n.project_id === pid).sort((a, b) => (b.nr || 0) - (a.nr || 0));
const nsEvs = (f) => Object.values(S.naservice_gebeurtenissen || {}).filter(f);
const nsOpen = (n) => n.status !== "afgesloten" && n.status !== "geweigerd";
const nsActieNodig = (n) => n.status === "ontvangen" || n.status === "opgelost";   // BROS moet iets doen
const nsProjecten = () => projects().filter(p => p.voorlopig_opgeleverd_op);
const nsTeller = (pid) => nsKlaar() ? nsPunten(pid).filter(nsActieNodig).length : 0;
const nsAannemers = (pid) => { const z = new Map(); contactsOf(pid).filter(x => !["bouwheer", "contactpersoon"].includes(x.rol)).forEach(x => { if (!z.has(x.c.id)) z.set(x.c.id, x); }); return [...z.values()]; };
/* 1.78 (script 070): een beheerder past de datum aan van een geregistreerde actie of van de ontvangst van een door BROS geregistreerde melding */
const nsDatumAanpasbaar = (x) => isBeheer() && schemaV() >= 70 && (x.soort === "registratie" || (x.soort === "ontvangen" && x.punt_id && S.naservice_punten[x.punt_id] && S.naservice_punten[x.punt_id].bron !== "klant"));
const nsLokaal = (ts) => { const d = new Date(ts); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const NS_NU_LOKAAL = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

/* ---------- projecttabblad ---------- */
function vNaservice(p) {
  if (!nsKlaar()) return `<div class="panel"><div class="empty"><b>Naservice nog niet actief</b>Voer databasescript 069 uit in Supabase.</div></div>`;
  const o = NSW.oplevering(p);
  if (!o) return `<div class="panel ns-start"><div class="panel-head"><div><h3>Naservice</h3><div class="muted" style="font-size:12px;margin-top:2px">Alles wat na de voorlopige oplevering gemeld wordt, volg je hier op: met foto's, wie wat deed en wanneer.</div></div></div>
    <div class="panel-body" style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:22px;align-items:start">
      <div><p style="margin:0 0 10px;font-size:15px"><b>Is dit project voorlopig opgeleverd?</b> Vink het aan: vanaf dan</p>
        <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.7"><li>kan de klant problemen melden in zijn portaal (met foto's),</li><li>registreer jij wat per mail of telefoon binnenkomt,</li><li>loopt de termijn tot de <b>definitieve oplevering</b> — die gebeurt automatisch, met een proces-verbaal; wat dan nog openstaat, komt erin als voorbehoud.</li></ul></div>
      <div style="border:1px solid var(--line);border-radius:14px;padding:16px">${nsOpleverVelden(p)}<div style="margin-top:12px"><button class="btn primary" type="button" data-ns="voorlopig" data-pid="${p.id}">Voorlopig opgeleverd</button></div></div>
    </div></div>`;
  const ps = nsPunten(p.id); const evs = nsEvs(x => x.project_id === p.id);
  const kol = (titel, lijst, leeg) => `<div class="ns-kol"><h4>${titel} <span>${lijst.length}</span></h4>${lijst.length ? lijst.map(nsKaart).join("") : `<div class="ns-leeg" style="padding:4px">${leeg}</div>`}</div>`;
  const teb = ps.filter(n => n.status === "ontvangen"), beh = ps.filter(n => n.status === "aanvaard" || n.status === "ingepland"), opg = ps.filter(n => n.status === "opgelost"), af = ps.filter(n => n.status === "afgesloten" || n.status === "geweigerd");
  const doorloop = ps.filter(n => n.status === "afgesloten"); const gem = doorloop.length ? Math.round(doorloop.reduce((s, n) => s + NSW.leeftijd(n), 0) / doorloop.length) : null;
  const pv = p.definitief_pv_document && S.documenten[p.definitief_pv_document];
  return `${NSW.balk(p, ps, { attr: (n) => `data-ns="punt" data-id="${n.id}"` })}
    <div class="ns-tellers">
      <div class="ns-teller"><b style="color:var(--warn)">${teb.length}</b><span>te beoordelen</span></div>
      <div class="ns-teller"><b style="color:var(--accent)">${beh.length}</b><span>in behandeling</span></div>
      <div class="ns-teller"><b style="color:var(--ok)">${opg.length}</b><span>opgelost — nakijken</span></div>
      <div class="ns-teller"><b>${af.length}</b><span>afgesloten</span></div>
      ${gem != null ? `<div class="ns-teller"><b>${gem} d</b><span>gem. doorlooptijd</span></div>` : ""}
      <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn primary" type="button" data-ns="nieuw" data-pid="${p.id}">+ Punt registreren</button>
        ${o.loopt ? `<button class="btn" type="button" data-ns="oplevering" data-pid="${p.id}">Oplevering aanpassen</button>${isBeheer() ? `<button class="btn ghost" type="button" data-ns="definitief" data-pid="${p.id}">Nu definitief opleveren…</button>` : ""}`
          : pv && pv.url ? `<a class="btn" href="${esc(pv.url)}" target="_blank" rel="noopener">Proces-verbaal (pdf)</a>` : isBeheer() && !p.definitief_pv_drive_id ? `<button class="btn" type="button" data-ns="pv" data-pid="${p.id}">Proces-verbaal maken</button>` : `<span class="muted" style="font-size:12px">Proces-verbaal in Documenten/Oplevering</span>`}
      </div></div>
    <div class="ns-bord">${kol("Te beoordelen", teb, "Niets nieuw.")}${kol("In behandeling", beh, "Niets in behandeling.")}${kol("Opgelost — nakijken", opg, "Niets na te kijken.")}${kol("Afgesloten", af.slice(0, S.nsAlleAf ? 999 : 6), "Nog niets afgesloten.")}</div>
    ${af.length > 6 && !S.nsAlleAf ? `<p style="text-align:right;margin:6px 0 0"><button class="btn sm ghost" type="button" data-ns="alle-af">Alle ${af.length} afgesloten punten tonen</button></p>` : ""}
    <div class="panel" style="margin-top:18px"><div class="panel-head"><div><h3>Historiek van de oplevering</h3><div class="muted" style="font-size:12px;margin-top:2px">Voorlopige en definitieve oplevering en wijzigingen aan de termijn. De historiek per punt zie je in het punt zelf.</div></div></div>
      <div class="panel-body">${NSW.tijdlijn(evs.filter(x => !x.punt_id), { intern: true, leeg: "Nog niets." })}</div></div>`;
}
function nsKaart(n) {
  const [, c] = NSW.STATUS[n.status] || ["", "ontv"]; const d = NSW.leeftijd(n); const f = (n.fotos || [])[0];
  const aan = n.contact_id && S.contacten[n.contact_id];
  return `<button type="button" class="ns-kaart ns-k-${c}" data-ns="punt" data-id="${n.id}"><div class="ns-kaart-t"><div style="min-width:0"><span class="muted num" style="font-size:11px">${NSW.nr(n)}</span> ${n.prioriteit === "dringend" ? `<span class="pill late" style="font-size:10px">dringend</span>` : ""}<br><b>${esc(n.titel)}</b>
      <small>${esc([n.ruimte, NSW.bronTekst(n.bron)].filter(Boolean).join(" · "))}</small>
      ${aan ? `<small>→ ${esc(aan.naam)}${n.gepland_op && n.status === "ingepland" ? " · " + esc(NSW.fmtKort(n.gepland_op)) : ""}</small>` : ""}</div>
      ${f && f.url ? `<img src="${esc(f.url)}" alt="" loading="lazy">` : ""}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">${NSW.pill(n.status)}<span class="ns-leeftijd${nsOpen(n) && d > 30 ? " lang" : ""}" title="${nsOpen(n) ? "open sinds de melding" : "doorlooptijd"}">${d} d</span></div></button>`;
}
function nsOpleverVelden(p) {
  return `<div class="form-grid" style="grid-template-columns:1fr 1fr">
    <div class="field"><label for="ns_vo">Voorlopig opgeleverd op</label><input id="ns_vo" type="date" value="${esc(p.voorlopig_opgeleverd_op || p.opgeleverd_op || todayIso)}" max="${todayIso}"></div>
    <div class="field"><label for="ns_tm">Termijn tot definitief</label><select id="ns_tm">${[6, 12, 18, 24].concat([Number(p.oplevering_termijn_maanden) || 12]).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b).map(m => `<option value="${m}" ${m === (Number(p.oplevering_termijn_maanden) || 12) ? "selected" : ""}>${m} maanden${m === 12 ? " (standaard)" : ""}</option>`).join("")}</select></div>
    <div class="field span2"><label for="ns_opm">Opmerking (komt in de historiek en op het proces-verbaal)</label><textarea id="ns_opm" rows="2" placeholder="bv. Voorlopige oplevering samen met de klant overlopen; pv ondertekend.">${esc(p.oplevering_opmerking || "")}</textarea></div>
    <div class="field span2"><small class="muted">Woningbouw (Wet Breyne): minstens 1 jaar tussen voorlopige en definitieve oplevering. Anders volgt de termijn de overeenkomst — gebruikelijk is 1 jaar. De klant krijgt een mail met uitleg en kan vanaf dan melden in zijn portaal.</small></div></div>`;
}
async function nsOpleverBewaar(pid, eerste) {
  const vo = $("#ns_vo").value, tm = Number($("#ns_tm").value) || 12, opm = ($("#ns_opm").value || "").trim();
  if (!vo) { toast("Kies de datum van de voorlopige oplevering."); return false; }
  if (vo > todayIso) { toast("De voorlopige oplevering kan niet in de toekomst liggen."); return false; }
  const p = S.projecten[pid]; const patch = { voorlopig_opgeleverd_op: vo, oplevering_termijn_maanden: tm, oplevering_opmerking: opm };
  if (!p.opgeleverd_op) patch.opgeleverd_op = vo;   // zelfde datum als "werkelijk opgeleverd op" in het projectformulier
  if (eerste && NSW.plusMaanden(vo, tm) <= todayIso && !confirm(`De termijn van ${tm} maanden na ${NSW.fmtKort(vo)} is al verstreken: het Planbord zet dit project binnen het uur op definitief opgeleverd (met proces-verbaal; de klant wordt niet gemaild omdat het al meer dan een maand geleden is). Doorgaan?`)) return false;
  try { await dbUpdate("projecten", pid, patch); } catch (e) { toast("Niet bewaard: " + (e.message || e), 7000); return false; }
  refetch("naservice_gebeurtenissen"); toast(eerste ? "Voorlopig opgeleverd — de naservice loopt. De klant krijgt binnen het uur een mail met uitleg." : "Oplevering aangepast"); return true;
}
function nsOpleverForm(pid) {
  const p = S.projecten[pid]; if (!p) return;
  openModal("Oplevering — " + projName(p), nsOpleverVelden(p) + (isBeheer() ? `<p style="margin:12px 0 0"><button type="button" class="btn ghost danger sm" data-ns="voorlopig-weg" data-pid="${pid}">Voorlopige oplevering uitvinken</button></p>` : ""), { saveLabel: "Bewaren", onSave: () => nsOpleverBewaar(pid, false) });
}
function nsDefinitiefForm(pid) {
  const p = S.projecten[pid]; const o = NSW.oplevering(p); if (!p || !o || !isBeheer()) return;
  const open = nsPunten(pid).filter(n => nsOpen(n) && n.klant_zichtbaar !== false);
  openModal("Definitief opleveren — " + projName(p), `<div class="form-grid">
    <div class="field"><label for="ns_df">Definitief opgeleverd op</label><input id="ns_df" type="date" value="${todayIso}" min="${o.voorlopig}" max="${todayIso}"></div>
    <div class="field"><label>Gepland</label><div style="padding:8px 0">${esc(NSW.fmt(o.gepland))} (na ${o.termijn} maanden)</div></div>
    <div class="field span2"><label for="ns_dopm">Opmerking (op het proces-verbaal)</label><textarea id="ns_dopm" rows="2" placeholder="bv. Definitieve oplevering samen met de klant overlopen op de werf."></textarea></div>
    <div class="field span2"><p style="margin:0;font-size:13px">${open.length ? `<b>${open.length} ${open.length === 1 ? "punt staat" : "punten staan"} nog open</b> — ${open.length === 1 ? "dat komt" : "die komen"} als voorbehoud op het proces-verbaal: ${open.map(n => esc(NSW.nr(n) + " " + n.titel)).join(", ")}.` : "Er staan geen punten meer open."}</p>
      <p class="muted" style="margin:8px 0 0;font-size:12px">Het Planbord maakt het proces-verbaal (pdf) in Documenten/Oplevering, deelt het met de klant en mailt het. ${o.dagenTot > 0 ? `<b>Let op:</b> de afgesproken termijn loopt nog ${o.dagenTot} dagen; doe dit enkel als de klant ermee akkoord gaat.` : ""}</p></div></div>`, {
    saveLabel: "Definitief opleveren", wide: true,
    onSave: async () => {
      const df = $("#ns_df").value; if (!df) { toast("Kies een datum."); return false; }
      const opm = ($("#ns_dopm").value || "").trim();
      try { await dbUpdate("projecten", pid, { definitief_opgeleverd_op: df, oplevering_opmerking: [p.oplevering_opmerking, opm].filter(Boolean).join("\n") }); } catch (e) { toast("Niet gelukt: " + (e.message || e), 7000); return false; }
      refetch("naservice_gebeurtenissen"); nsPv(pid);
    },
  });
}
function nsPv(pid) {
  if (!driveReady()) { toast("Definitief opgeleverd. Het proces-verbaal volgt binnen het uur (Drive-script).", 7000); return; }
  loader.start("ns.pv", "Proces-verbaal maken…", 20000);
  driveCall("oplevering", { id: pid, token: S.session?.access_token || "" }).then(async j => {
    loader.done("ns.pv"); if (!j.ok) { toast("Proces-verbaal niet gemaakt: " + (j.error || "?") + " — het Drive-script probeert het binnen het uur opnieuw.", 9000); return; }
    await refetch("projecten"); await refetch("documenten"); refetch("naservice_gebeurtenissen");
    toast(j.al ? "Het proces-verbaal bestond al." : `Proces-verbaal bewaard in Documenten/Oplevering${(j.naar || []).length ? " en gemaild naar " + j.naar.join(", ") : ""}.`, 7000);
  }).catch(e => { loader.fail(); toast("Proces-verbaal niet gemaakt: " + e.message + " — het Drive-script probeert het binnen het uur opnieuw.", 9000); });
}

/* ---------- een punt registreren (mail, telefoon, bezoek) ---------- */
function nsPuntForm(pid) {
  const p = S.projecten[pid]; if (!p) return;
  const klanten = contactsOf(pid).filter(x => ["bouwheer", "contactpersoon"].includes(x.rol));
  const ruimtes = [...new Set(nsPunten(pid).map(n => n.ruimte).filter(Boolean))].sort();
  openModal("Naservicepunt registreren — " + projName(p), `<div class="form-grid">
    <div class="field"><label for="nsp_bron">Hoe kwam het binnen?</label><select id="nsp_bron" name="bron">${[["mail", "Per mail"], ["telefoon", "Telefonisch"], ["werfbezoek", "Tijdens een bezoek"], ["aannemer", "Gemeld door een aannemer"], ["bros", "Zelf vastgesteld (BROS)"]].map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></div>
    <div class="field"><label for="nsp_op">Ontvangen op</label><input id="nsp_op" name="ontvangen_op" type="datetime-local" value="${NS_NU_LOKAAL()}" max="${NS_NU_LOKAAL()}"><small class="muted">bij een mail: de datum en het uur van de mail</small></div>
    <div class="field"><label for="nsp_wie">Gemeld door</label><input id="nsp_wie" name="gemeld_naam" list="nsp_wies" value="${esc(klanten[0] ? klanten[0].c.naam : "")}"><datalist id="nsp_wies">${klanten.map(x => `<option value="${esc(x.c.naam)}">`).join("")}</datalist></div>
    <div class="field"><label for="nsp_ruimte">Ruimte</label><input id="nsp_ruimte" name="ruimte" list="nsp_ruimtes" placeholder="bv. Keuken"><datalist id="nsp_ruimtes">${ruimtes.map(r => `<option value="${esc(r)}">`).join("")}</datalist></div>
    <div class="field span2"><label for="nsp_titel">Wat is het probleem? (korte titel)</label><input id="nsp_titel" name="titel" maxlength="160" required placeholder="bv. Lade van de keukenkast sluit niet meer"></div>
    <div class="field span2"><label for="nsp_oms">Omschrijving — plak gerust de mail</label><textarea id="nsp_oms" name="omschrijving" rows="4"></textarea></div>
    <div class="field"><label for="nsp_fotos">Foto's (uit de mail of eigen foto's)</label><input id="nsp_fotos" type="file" accept="image/*" multiple></div>
    <div class="field"><label for="nsp_prio">Prioriteit</label><select id="nsp_prio" name="prioriteit"><option value="normaal">Normaal</option><option value="dringend">Dringend</option></select></div>
    <div class="field span2"><label class="chk"><input type="checkbox" id="nsp_klant" checked> Zichtbaar voor de klant in het portaal (met de volledige opvolging)</label><label class="chk"><input type="checkbox" id="nsp_aanv"> Meteen aanvaarden als naservice</label></div>
  </div>`, {
    saveLabel: "Registreren", wide: true,
    onSave: async () => {
      const titel = ($("#nsp_titel").value || "").trim(); if (titel.length < 3) { toast("Geef het punt een korte titel."); return false; }
      const op = $("#nsp_op").value ? new Date($("#nsp_op").value) : new Date(); if (op > new Date(Date.now() + 3600000)) { toast("Ontvangen op kan niet in de toekomst liggen."); return false; }
      const files = [...($("#nsp_fotos").files || [])].slice(0, 10); const fotos = [];
      try { for (const f of files) fotos.push(await fotoUpload(pid, "naservice", f)); } catch (e) { toast("Foto uploaden mislukte: " + (e.message || e), 7000); return false; }
      const aanv = $("#nsp_aanv").checked;
      const row = { project_id: pid, titel, omschrijving: ($("#nsp_oms").value || "").trim(), ruimte: ($("#nsp_ruimte").value || "").trim(), fotos: fotos.map(({ path, url, w, h }) => ({ path, url, w, h })),
        bron: $("#nsp_bron").value, ontvangen_op: op.toISOString(), gemeld_naam: ($("#nsp_wie").value || "").trim(), prioriteit: $("#nsp_prio").value, klant_zichtbaar: $("#nsp_klant").checked };
      const k = klanten.find(x => x.c.naam === row.gemeld_naam); if (k) row.gemeld_door = k.c.id;
      let n; try { n = await dbInsert("naservice_punten", row); } catch (e) { return false; }
      if (aanv) await nsActie(n.id, "aanvaard", {}, true);
      await nsVers(n.id); toast(`${NSW.nr(n)} geregistreerd${row.klant_zichtbaar ? " — de klant krijgt binnen het uur een bevestiging" : ""}`, 5000);
      setTimeout(() => nsDetail(n.id), 50);
    },
  });
}

/* ---------- detail van een punt: stappen, acties en de volledige historiek ---------- */
function nsDetail(id, open) {
  const n = S.naservice_punten[id]; if (!n) return; const p = S.projecten[n.project_id];
  const evs = nsEvs(x => x.punt_id === id); const aan = n.contact_id && S.contacten[n.contact_id];
  const aannemers = nsAannemers(n.project_id); const opIds = new Set(contactsOf(n.project_id).map(x => x.c.id));
  const anderen = Object.values(S.contacten || {}).filter(c => !opIds.has(c.id) && c.soort !== "klant").sort((a, b) => (a.naam || "").localeCompare(b.naam || ""));
  const knop = (act, lbl, cls = "") => `<button type="button" class="btn sm ${cls}" data-ns="toon" data-act2="${act}">${lbl}</button>`;
  const acties = n.status === "ontvangen" ? knop("aanvaard", "✓ Aanvaarden", "primary") + knop("toewijzen", "→ Toewijzen aan aannemer") + knop("geweigerd", "✕ Niet onder naservice…", "ghost danger")
    : n.status === "aanvaard" ? knop("toewijzen", aan ? "→ Andere aannemer" : "→ Toewijzen aan aannemer", aan ? "" : "primary") + knop("ingepland", "◷ Inplannen") + knop("opgelost", "✔ Opgelost") + knop("afgesloten", "■ Afsluiten")
    : n.status === "ingepland" ? knop("ingepland", "◷ Andere datum") + knop("opgelost", "✔ Opgelost", "primary") + knop("toewijzen", "→ Andere aannemer") + knop("afgesloten", "■ Afsluiten")
    : n.status === "opgelost" ? knop("afgesloten", "■ Goedgekeurd — afsluiten", "primary") + knop("heropend", "↺ Niet in orde — heropenen", "ghost danger")
    : knop("heropend", "↺ Heropenen");
  const fotos = (n.fotos || []).filter(f => f.url);
  openModal(NSW.nr(n) + " · " + n.titel, `<div class="ns-detail">
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:6px"><div>${NSW.pill(n.status)} ${n.prioriteit === "dringend" ? `<span class="pill late">dringend</span>` : ""} <span class="muted" style="font-size:13px">${esc(projName(p))}</span></div>
      <span class="muted" style="font-size:12px">${n.klant_zichtbaar ? "zichtbaar voor de klant" : "intern — de klant ziet dit punt niet"} · <a href="#" data-ns="zichtbaar" data-id="${n.id}">${n.klant_zichtbaar ? "verbergen" : "tonen"}</a></span></div>
    ${NSW.stappen(n, evs)}
    <div style="display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:18px;margin-top:12px">
      <div><div class="muted" style="font-size:12px">Gemeld ${esc(NSW.bronTekst(n.bron))}${n.gemeld_naam ? " door " + esc(n.gemeld_naam) : ""} · ${esc(NSW.fmtTijd(n.ontvangen_op))}${n.ruimte ? " · " + esc(n.ruimte) : ""}</div>
        ${n.omschrijving ? `<div style="white-space:pre-line;margin-top:6px;font-size:14px">${esc(n.omschrijving)}</div>` : ""}
        ${fotos.length ? `<div class="ns-tl-fotos">${fotos.map(f => `<a href="${esc(f.url)}" target="_blank" rel="noopener"><img src="${esc(f.url)}" alt=""></a>`).join("")}</div>` : ""}</div>
      <div style="border:1px solid var(--line);border-radius:12px;padding:12px"><div class="muted" style="font-size:12px;margin-bottom:4px">Aannemer</div><div style="font-size:14px">${aan ? `<b>${esc(aan.naam)}</b>${aan.email ? `<div class="muted" style="font-size:12px">${esc(aan.email)}${aan.user_id ? "" : " · geen portaaltoegang"}</div>` : `<div style="font-size:12px;color:var(--crit)">geen e-mailadres</div>`}` : `<span class="muted">nog niemand</span>`}</div>
        ${n.gepland_op ? `<div style="margin-top:8px;font-size:14px">Ingepland op <b>${esc(NSW.fmt(n.gepland_op))}</b></div>` : ""}</div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:16px 0 4px">${acties}</div>
    <div id="ns_inv"></div>
    <h3 style="margin:18px 0 6px;font-size:15px">Historiek</h3>
    ${NSW.tijdlijn(evs, { intern: true, aanpas: nsDatumAanpasbaar })}
    <div style="border:1px solid var(--line);border-radius:12px;padding:12px;margin-top:6px">
      <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:13px;margin-bottom:8px"><label class="chk" style="margin:0"><input type="radio" name="ns_soort" value="bericht" checked> Bericht</label><label class="chk" style="margin:0"><input type="radio" name="ns_soort" value="registratie"> Actie registreren (bv. telefoon, bezoek) met datum</label></div>
      <textarea id="ns_tekst" rows="2" style="width:100%" placeholder="bv. Klant gebeld: de aannemer komt dinsdag langs."></textarea>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:8px;font-size:13px">
        <label class="chk" style="margin:0"><input type="checkbox" id="ns_zk" ${n.klant_zichtbaar ? "checked" : "disabled"}> klant ziet dit</label>
        <label class="chk" style="margin:0"><input type="checkbox" id="ns_za" ${aan ? "" : "disabled"}> aannemer ziet dit</label>
        <input id="ns_op" type="datetime-local" value="${NS_NU_LOKAAL()}" max="${NS_NU_LOKAAL()}" style="display:none">
        <input id="ns_fotos" type="file" accept="image/*" multiple style="max-width:220px">
        <button type="button" class="btn sm primary" data-ns="bericht" data-id="${n.id}" style="margin-left:auto">Toevoegen</button></div>
      <small class="muted">Een bericht dat de klant of de aannemer ziet, krijgen ze ook per mail (binnen het uur). De historiek kan niet gewijzigd worden; enkel een beheerder kan de datum van een geregistreerde actie aanpassen (dat blijft zichtbaar).</small></div>
  </div>`, { saveLabel: "Sluiten", wide: true, onSave: async () => { } });
  $("#mform").dataset.nsPunt = id;
  if (open) nsToon(open);
  const dl = (el) => el && el.addEventListener("change", () => { const reg = $('#mform input[name="ns_soort"]:checked').value === "registratie"; $("#ns_op").style.display = reg ? "" : "none"; });
  document.querySelectorAll('#mform input[name="ns_soort"]').forEach(dl);
  NS.aannemers = aannemers; NS.anderen = anderen;
}
const NS = {};
function nsToon(act) {
  const id = $("#mform") && $("#mform").dataset.nsPunt; const n = id && S.naservice_punten[id]; if (!n) return;
  const vak = (inhoud, lbl, cls = "primary") => `<div style="border:1px solid var(--accent);background:var(--accent-soft);border-radius:12px;padding:12px;margin:8px 0">${inhoud}<div style="display:flex;gap:8px;margin-top:10px"><button type="button" class="btn sm ${cls}" data-ns="doe" data-act2="${act}" data-id="${n.id}">${lbl}</button><button type="button" class="btn sm ghost" data-ns="toon-weg">Annuleren</button></div></div>`;
  const tekst = (ph, req) => `<textarea id="ns_a_tekst" rows="2" style="width:100%;margin-top:6px" placeholder="${esc(ph)}"></textarea>${req ? "" : ""}`;
  const zicht = `<label class="chk" style="margin-top:6px"><input type="checkbox" id="ns_a_klant" ${n.klant_zichtbaar ? "checked" : "disabled"}> de klant ziet dit (en krijgt een mail)</label>`;
  let h = "";
  if (act === "aanvaard") h = vak(`<b>Aanvaarden als naservice</b>${tekst("Toelichting voor de klant (optioneel)")}${zicht}`, "Aanvaarden");
  else if (act === "geweigerd") h = vak(`<b>Valt niet onder de naservice</b><div class="muted" style="font-size:12px">bv. normaal gebruik, onderhoud, schade door derden — de klant ziet je uitleg.</div>${tekst("Waarom niet? (verplicht)")}`, "Bevestigen", "danger");
  else if (act === "toewijzen") h = vak(`<b>Toewijzen aan een aannemer</b><select id="ns_a_contact" style="width:100%;margin-top:6px"><option value="">— kies —</option>${NS.aannemers.length ? `<optgroup label="Op dit project">${NS.aannemers.map(x => `<option value="${x.c.id}">${esc(x.c.naam)}${x.c.email ? "" : " (geen e-mail)"}</option>`).join("")}</optgroup>` : ""}<optgroup label="Andere (wordt aan het project gekoppeld)">${NS.anderen.map(c => `<option value="${c.id}">${esc(c.naam)}${c.bedrijf && c.bedrijf !== c.naam ? " – " + esc(c.bedrijf) : ""}</option>`).join("")}</optgroup></select>${tekst("Opdracht voor de aannemer (optioneel) — bv. graag deze week, sleutel bij de buren")}<div class="muted" style="font-size:12px;margin-top:4px">De aannemer krijgt een mail en ziet het punt (met foto's en historiek) in zijn portaal. Hij plant zelf een datum en meldt het als opgelost.</div>`, "Toewijzen");
  else if (act === "ingepland") h = vak(`<b>Herstelling inplannen</b><input id="ns_a_datum" type="date" value="${esc(n.gepland_op || addDays(todayIso, 7))}" style="margin-top:6px;display:block">${tekst("Opmerking (optioneel)")}${zicht}`, "Inplannen");
  else if (act === "opgelost") h = vak(`<b>Opgelost</b>${tekst("Wat werd er gedaan? (optioneel)")}<input id="ns_a_fotos" type="file" accept="image/*" multiple style="margin-top:6px">${zicht}`, "Opgelost melden");
  else if (act === "afgesloten") h = vak(`<b>Afsluiten</b>${tekst("Toelichting (optioneel)")}${zicht}`, "Afsluiten");
  else if (act === "heropend") h = vak(`<b>Heropenen</b>${tekst("Waarom? (verplicht)")}${zicht}`, "Heropenen", "danger");
  $("#ns_inv").innerHTML = h; const t = $("#ns_a_tekst") || $("#ns_a_contact"); if (t) t.focus();
}
async function nsActie(id, actie, o, stil) {
  const { data, error } = await sb.rpc("naservice_actie", { p_punt: id, p_actie: actie, p_tekst: o.tekst || "", p_datum: o.datum || null, p_contact: o.contact || null, p_fotos: o.fotos || [], p_klant: o.klant !== false, p_aannemer: o.aannemer !== false, p_op: o.op || null });
  if (error) { toast(error.message, 7000); return null; }
  if (data && data.id) S.naservice_punten[data.id] = data;
  if (!stil) await nsVers(id);
  return data;
}
/* na een actie: het punt, zijn historiek en (bij toewijzen) de projectcontacten vers ophalen */
async function nsVers(id) {
  const [p, g] = await Promise.all([sb.from("naservice_punten").select("*").eq("id", id).maybeSingle(), sb.from("naservice_gebeurtenissen").select("*").eq("punt_id", id)]);
  if (p.data) S.naservice_punten[id] = p.data; (g.data || []).forEach(x => { S.naservice_gebeurtenissen[x.id] = x; });
  render();
}
document.addEventListener("click", async (e) => {
  const el = e.target.closest && e.target.closest("[data-ns]"); if (!el) return;
  const d = el.dataset; e.preventDefault();
  if (d.ns === "punt") return nsDetail(d.id);
  if (d.ns === "nieuw") return nsPuntForm(d.pid);
  if (d.ns === "oplevering") return nsOpleverForm(d.pid);
  if (d.ns === "definitief") return nsDefinitiefForm(d.pid);
  if (d.ns === "pv") return nsPv(d.pid);
  if (d.ns === "alle-af") { S.nsAlleAf = true; return render(); }
  if (d.ns === "voorlopig") { el.disabled = true; const ok = await nsOpleverBewaar(d.pid, true); el.disabled = false; if (ok) render(); return; }
  if (d.ns === "voorlopig-weg") {
    if (nsPunten(d.pid).length) { toast("Er zijn al naservicepunten geregistreerd: de voorlopige oplevering blijft staan. Pas eventueel de datum aan."); return; }
    if (!confirm("De voorlopige oplevering uitvinken? De klant kan dan geen naservice meer melden.")) return;
    try { await dbUpdate("projecten", d.pid, { voorlopig_opgeleverd_op: null }); closeModal(true); refetch("naservice_gebeurtenissen"); } catch (x) { } return;
  }
  if (d.ns === "proj") { S.view = "projecten"; S.project = d.pid; S.ptab = "naservice"; return render(); }
  if (d.ns === "zichtbaar") { const n = S.naservice_punten[d.id]; try { await dbUpdate("naservice_punten", d.id, { klant_zichtbaar: !n.klant_zichtbaar }); } catch (x) { return; } return nsDetail(d.id); }
  if (d.ns === "toon") return nsToon(d.act2);
  if (d.ns === "toon-weg") { $("#ns_inv").innerHTML = ""; return; }
  if (d.ns === "datum") {   // 1.78: datum aanpassen (beheer)
    const x = S.naservice_gebeurtenissen[d.ev]; const vak = document.querySelector(`[data-ev-vak="${d.ev}"]`); if (!x || !vak || !nsDatumAanpasbaar(x)) return;
    document.querySelectorAll(".ns-datumvak").forEach(v => { v.innerHTML = ""; });
    vak.innerHTML = `<div style="border:1px solid var(--warn);background:var(--warn-soft);border-radius:10px;padding:10px;margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <b style="font-size:13px">${x.soort === "ontvangen" ? "Ontvangen op" : "Datum van de actie"}</b><input type="datetime-local" id="ns_dt" value="${nsLokaal(x.op)}" max="${NS_NU_LOKAAL()}">
      <input id="ns_dt_reden" placeholder="Reden (optioneel), bv. verkeerde dag ingevuld" style="flex:1;min-width:200px">
      <button type="button" class="btn sm primary" data-ns="datum-bewaar" data-ev="${x.id}">Bewaren</button><button type="button" class="btn sm ghost" data-ns="datum-weg">Annuleren</button>
      <small class="muted" style="flex-basis:100%">De oorspronkelijke datum en wie ze aanpaste blijven zichtbaar in de historiek.${x.soort === "ontvangen" ? " De ontvangstdatum van het punt verandert mee." : ""}</small></div>`;
    const i = $("#ns_dt"); if (i) i.focus(); return;
  }
  if (d.ns === "datum-weg") { document.querySelectorAll(".ns-datumvak").forEach(v => { v.innerHTML = ""; }); return; }
  if (d.ns === "datum-bewaar") {
    const x = S.naservice_gebeurtenissen[d.ev]; const v = $("#ns_dt") && $("#ns_dt").value; if (!x) return; if (!v) { toast("Kies een datum."); return; }
    el.disabled = true;
    const { data, error } = await sb.rpc("naservice_datum", { p_id: x.id, p_op: new Date(v).toISOString(), p_reden: ($("#ns_dt_reden").value || "").trim() });
    el.disabled = false; if (error) { toast(error.message, 7000); return; }
    if (data && data.id) S.naservice_gebeurtenissen[data.id] = data;
    if (x.punt_id) { await nsVers(x.punt_id); toast("Datum aangepast"); return nsDetail(x.punt_id); }
    render(); toast("Datum aangepast"); return;
  }
  if (d.ns === "doe") {
    const n = S.naservice_punten[d.id]; const act = d.act2; const o = { tekst: ($("#ns_a_tekst") && $("#ns_a_tekst").value || "").trim(), klant: $("#ns_a_klant") ? $("#ns_a_klant").checked : true };
    if (act === "toewijzen") { o.contact = $("#ns_a_contact").value; if (!o.contact) { toast("Kies een aannemer."); return; } }
    if (act === "ingepland") { o.datum = $("#ns_a_datum").value; if (!o.datum) { toast("Kies een datum."); return; } }
    if ((act === "geweigerd" || act === "heropend") && o.tekst.length < 3) { toast("Schrijf kort waarom."); return; }
    el.disabled = true;
    if (act === "opgelost" && $("#ns_a_fotos")) { try { o.fotos = []; for (const f of [...$("#ns_a_fotos").files].slice(0, 10)) { const x = await fotoUpload(n.project_id, "naservice", f); o.fotos.push({ path: x.path, url: x.url, w: x.w, h: x.h }); } } catch (x) { el.disabled = false; toast("Foto uploaden mislukte: " + (x.message || x), 7000); return; } }
    const r = await nsActie(d.id, act, o); el.disabled = false; if (!r) return;
    if (act === "toewijzen") refetch("project_contacten");
    toast({ aanvaard: "Aanvaard", geweigerd: "Niet onder naservice — de klant krijgt je uitleg", toewijzen: "Toegewezen — de aannemer krijgt binnen het uur een mail", ingepland: "Ingepland", opgelost: "Opgelost gemeld", afgesloten: "Afgesloten", heropend: "Heropend" }[act] || "Bewaard");
    return nsDetail(d.id);
  }
  if (d.ns === "bericht") {
    const n = S.naservice_punten[d.id]; const reg = ($('#mform input[name="ns_soort"]:checked') || {}).value === "registratie";
    const o = { tekst: ($("#ns_tekst").value || "").trim(), klant: $("#ns_zk").checked && !$("#ns_zk").disabled, aannemer: $("#ns_za").checked && !$("#ns_za").disabled };
    if (reg) { const v = $("#ns_op").value; if (!v) { toast("Kies wanneer de actie gebeurde."); return; } o.op = new Date(v).toISOString(); }
    el.disabled = true;
    try { o.fotos = []; for (const f of [...($("#ns_fotos").files || [])].slice(0, 10)) { const x = await fotoUpload(n.project_id, "naservice", f); o.fotos.push({ path: x.path, url: x.url, w: x.w, h: x.h }); } } catch (x) { el.disabled = false; toast("Foto uploaden mislukte: " + (x.message || x), 7000); return; }
    const r = await nsActie(d.id, reg ? "registratie" : "bericht", o); el.disabled = false; if (!r) return;
    toast(reg ? "Actie geregistreerd" : (o.klant || o.aannemer ? "Bericht toegevoegd — mail volgt binnen het uur" : "Interne notitie toegevoegd")); return nsDetail(d.id);
  }
});

/* ---------- hoofdscherm: alle projecten in naservice ---------- */
function vNaserviceAlle() {
  if (!nsKlaar()) return `<div class="page-head"><div><div class="eyebrow">Naservice</div><h1>Naservice</h1></div></div><div class="panel"><div class="empty"><b>Nog niet actief</b>Voer databasescript 069 uit in Supabase.</div></div>`;
  const ps = nsProjecten(); const lopend = ps.filter(p => !p.definitief_opgeleverd_op).sort((a, b) => NSW.oplevering(a).einde.localeCompare(NSW.oplevering(b).einde));
  const klaar = ps.filter(p => p.definitief_opgeleverd_op).sort((a, b) => String(b.definitief_opgeleverd_op).localeCompare(String(a.definitief_opgeleverd_op)));
  const open = nsPunten().filter(nsOpen).sort((a, b) => String(a.ontvangen_op).localeCompare(String(b.ontvangen_op)));
  const rij = (p) => { const o = NSW.oplevering(p); const pts = nsPunten(p.id); const n = pts.filter(nsOpen).length, act = pts.filter(nsActieNodig).length;
    const pct = o.loopt ? Math.max(0, Math.min(100, (1 - o.dagenTot / Math.max(1, (new Date(o.einde) - new Date(o.voorlopig)) / 864e5)) * 100)) : 100;
    return `<tr class="click" data-ns="proj" data-pid="${p.id}"><td><b>${esc(projName(p))}</b><small class="muted" style="display:block">${esc(p.nummer || "")}</small></td><td class="num">${esc(NSW.fmtKort(o.voorlopig))}</td>
      <td style="min-width:180px"><div class="bar"><i style="width:${pct.toFixed(1)}%;${o.loopt ? "" : "background:var(--ok)"}"></i></div><small class="muted">${o.loopt ? (o.dagenTot > 0 ? "nog " + o.dagenTot + " d · " : "termijn verstreken · ") + "definitief " + esc(NSW.fmtKort(o.einde)) : "definitief op " + esc(NSW.fmtKort(o.einde))}</small></td>
      <td class="r num">${n ? `<b>${n}</b> open` : `<span class="muted">—</span>`}${act ? ` <span class="cnt" style="background:var(--crit);color:#fff">${act}</span>` : ""}</td></tr>`; };
  return `<div class="page-head"><div><div class="eyebrow">${lopend.length} ${lopend.length === 1 ? "project" : "projecten"} in naservice · ${open.length} open ${open.length === 1 ? "punt" : "punten"}</div><h1>Naservice</h1></div></div>
    ${open.length ? `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Openstaande punten</h3><div class="muted" style="font-size:12px;margin-top:2px">Alle projecten, oudste melding eerst.</div></div></div><div class="panel-body" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px">${open.map(n => `<div><div class="muted" style="font-size:11px;margin:0 0 2px 2px">${esc(projName(S.projecten[n.project_id]))}</div>${nsKaart(n)}</div>`).join("")}</div></div>` : ""}
    <div class="panel"><div class="panel-head"><h3>Projecten in naservice</h3></div>${lopend.length ? `<div class="tw"><table class="t"><thead><tr><th>Project</th><th>Voorlopig</th><th>Tot de definitieve oplevering</th><th class="r">Punten</th></tr></thead><tbody>${lopend.map(rij).join("")}</tbody></table></div>` : `<div class="empty"><b>Geen projecten in naservice</b>Vink de voorlopige oplevering aan in een project › Werf › Naservice.</div>`}</div>
    ${klaar.length ? `<div class="panel" style="margin-top:16px"><div class="panel-head"><h3>Definitief opgeleverd</h3></div><div class="tw"><table class="t"><tbody>${klaar.slice(0, S.nsAlleKlaar ? 999 : 10).map(rij).join("")}</tbody></table></div></div>` : ""}`;
}
