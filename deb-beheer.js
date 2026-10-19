/* =====================================================================
   BROS Planbord — opvolging van klantfacturen (script 048, v1.50)
   Hoofdtabblad Facturen (beheer): Klanten (openstaande facturen, betalingen uit Yuki, betalingsherinneringen ter goedkeuring)
   en Aannemers (facturen van aannemers, af-beheer.js). Het Drive-script stelt elke werkdag herinneringen voor; ze vertrekken
   pas als je ze hier goedkeurt (tekst aanpasbaar). Geladen vóór app.js; app.js roept vFactuurTab / debTeDoen aan.
   ===================================================================== */
const debOk = () => schemaV() >= 48 && isBeheer() && !!S.betaalherinneringen;
const debAlle = () => Object.values(S.betaalherinneringen || {});
const debTeDoen = () => debOk() ? debAlle().filter(h => (h.status === "voorgesteld" || h.status === "mislukt") && (S.vorderingen[h.vordering_id] || {}).status === "verzonden" && (S.vorderingen[h.vordering_id] || {}).herinneren !== false) : [];
const debDagen = (a, b) => Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 86400000);
const debIncl = (v) => { try { return vordCalc(v).incl; } catch (e) { return Number(v.bedrag_excl || 0) + Number(v.btw_bedrag || 0); } };
const debOpen = (v) => v.open_bedrag != null && v.open_bedrag !== "" ? Number(v.open_bedrag) : debIncl(v);
const debNr = (v) => v.factuurnummer || (v.nr === 0 ? "voorschot" : "#" + v.nr);
const debProj = (pid) => { const p = S.projecten[pid]; return p ? `<a href="#" data-open="${esc(p.id)}" data-optab="facturatie">${esc(p.nummer ? p.nummer + " · " : "")}${esc(projName(p))}</a>` : "—"; };
const debEd = () => (S.debEdit = S.debEdit || {});   // niet-bewaarde aanpassingen aan een herinnering (blijven bij een nieuwe weergave)
function vFactuurTab() {
  const sub = S.factTab = S.factTab || (debOk() && (debTeDoen().length || !(typeof afbTeDoen === "function" && afbTeDoen().length)) ? "klanten" : "aannemers");   // eenmaal gekozen blijft het staan (niet verspringen na goedkeuren)
  const nK = debTeDoen().length, nA = typeof afbTeDoen === "function" ? afbTeDoen().length : 0;
  const knop = (k, l, n) => `<button class="btn sm ${sub === k ? "primary" : ""}" data-deb-act="tab" data-t="${k}">${l}${n ? ` <span class="cnt" style="background:var(--crit);color:#fff">${n}</span>` : ""}</button>`;
  return `<div class="page-head"><div><div class="eyebrow">Opvolging</div><h1>Facturen</h1><div class="sub">${sub === "klanten" ? "Je facturen aan klanten: wat openstaat, wat Yuki als betaald ziet, en betalingsherinneringen die op je goedkeuring wachten — niets vertrekt zonder jouw klik." : "Facturen die aannemers in hun portaal opladen."}</div></div></div>
    <div style="display:flex;gap:8px;margin-bottom:16px">${knop("klanten", "Klanten", nK)}${knop("aannemers", "Aannemers", nA)}</div>
    ${sub === "aannemers" ? (typeof vAankoop === "function" ? vAankoop(true) : "") : vDebiteuren()}`;
}
function vDebiteuren() {
  if (!debOk()) return `<div class="panel"><div class="empty"><b>${isBeheer() ? "Nog niet beschikbaar" : "Enkel voor beheerders"}</b>${isBeheer() ? "Voer databasescript <code>sql/048_debiteuren.sql</code> uit." : ""}</div></div>`;
  const vs = Object.values(S.vorderingen); const open = vs.filter(v => v.status === "verzonden").sort((a, b) => (a.vervaldag || "9999").localeCompare(b.vervaldag || "9999"));
  const laat = open.filter(v => v.vervaldag && v.vervaldag < todayIso);
  const maand = todayIso.slice(0, 7); const betaaldM = vs.filter(v => v.status === "betaald" && (v.betaald_op || "").startsWith(maand));
  const som = (l, f) => l.reduce((t, v) => t + f(v), 0);
  const herVan = (vid) => debAlle().filter(h => h.vordering_id === vid).sort((a, b) => a.niveau - b.niveau);
  const wacht = debAlle().filter(h => (h.status === "voorgesteld" || h.status === "mislukt" || h.status === "goedgekeurd") && (S.vorderingen[h.vordering_id] || {}).status === "verzonden" && (S.vorderingen[h.vordering_id] || {}).herinneren !== false).sort((a, b) => (b.dagen_te_laat || 0) - (a.dagen_te_laat || 0));
  const yukiAan = vs.some(v => v.yuki_gecheckt_op);
  const kaart = (h) => { const v = S.vorderingen[h.vordering_id] || {}; const e = debEd()[h.id] || {}; const val = (k) => e[k] != null ? e[k] : (h[k] || "");
    const lees = h.status === "goedgekeurd";
    return `<div class="panel deb-h" style="margin-bottom:12px;${h.status === "mislukt" ? "border-color:var(--crit)" : h.niveau === 2 ? "border-color:var(--warn)" : ""}"><div class="panel-head"><div><h3>${h.niveau === 1 ? "1e herinnering" : "2e herinnering (steviger)"} · factuur ${esc(debNr(v))}</h3>
        <div class="muted" style="font-size:12px;margin-top:2px">${debProj(h.project_id)} · open ${eur2(h.open_bedrag != null ? h.open_bedrag : debOpen(v))} · vervaldag ${fmtLong(v.vervaldag)}${h.dagen_te_laat != null ? ` · ${h.dagen_te_laat} dagen te laat` : ""} · voorgesteld ${fmtLong(lokDag(h.voorgesteld_op))}</div></div>
        <span class="pill ${h.status === "mislukt" ? "st-verloren" : h.status === "goedgekeurd" ? "st-lopend" : "st-offerte"}">${h.status === "mislukt" ? "Versturen mislukt" : h.status === "goedgekeurd" ? "Goedgekeurd — vertrekt zo" : "Wacht op goedkeuring"}</span></div>
      <div class="panel-body">${h.status === "mislukt" && h.fout ? `<div style="color:var(--crit);font-size:13px;margin-bottom:8px">${esc(h.fout)}</div>` : ""}
        <div class="form-grid"><div class="field span2"><label>Aan</label><input class="inline" data-deb-veld="aan" data-id="${h.id}" value="${esc(val("aan"))}" placeholder="e-mailadres van de klant" ${lees ? "disabled" : ""}>${!val("aan") ? `<small style="color:var(--crit)">Geen e-mailadres gevonden bij de bouwheer — vul het in.</small>` : ""}</div>
        <div class="field span2"><label>Onderwerp</label><input class="inline" data-deb-veld="onderwerp" data-id="${h.id}" value="${esc(val("onderwerp"))}" ${lees ? "disabled" : ""}></div>
        <div class="field span2"><label>Bericht</label><textarea class="inline" rows="9" data-deb-veld="tekst" data-id="${h.id}" ${lees ? "disabled" : ""}>${esc(val("tekst"))}</textarea><small class="muted">Onder het bericht komen automatisch het bedrag, de rekening, de mededeling en een knop naar het klantenportaal. BROS krijgt een kopie (bcc).</small></div></div>
        ${lees ? "" : `<div class="actions" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" data-deb-act="send" data-id="${h.id}">${h.status === "mislukt" ? "Opnieuw versturen" : "Goedkeuren en versturen"}</button><button class="btn" data-deb-act="nee" data-id="${h.id}" title="Deze herinnering niet versturen (7 dagen na de vervaldag kan nog een tweede voorgesteld worden; wil je dat niet, kies dan 'Niet meer herinneren')">Niet versturen</button><button class="btn ghost" data-deb-act="stop" data-vid="${h.vordering_id}" title="Voor deze factuur geen herinneringen meer voorstellen (bv. afspraak met de klant)">Niet meer herinneren</button></div>`}</div></div>`; };
  const herTxt = (vid) => herVan(vid).map(h => `${h.niveau}e ${h.status === "verstuurd" ? fmtLong(lokDag(h.verstuurd_op)) : h.status === "geannuleerd" ? "niet verstuurd" : h.status === "goedgekeurd" ? "vertrekt" : h.status === "mislukt" ? "mislukt" : "voorgesteld"}`).join(" · ");
  return `<div class="rend" style="margin-bottom:16px"><div class="panel"><div class="k">Openstaand</div><div class="v">${eur2(som(open, debOpen))}</div><div class="muted" style="font-size:12px">${open.length} factu${open.length === 1 ? "ur" : "ren"} incl. btw</div></div>
      <div class="panel"><div class="k">Vervallen</div><div class="v ${laat.length ? "neg" : ""}">${eur2(som(laat, debOpen))}</div><div class="muted" style="font-size:12px">${laat.length} factu${laat.length === 1 ? "ur" : "ren"}</div></div>
      <div class="panel"><div class="k">Herinneringen ter goedkeuring</div><div class="v ${debTeDoen().length ? "neg" : ""}">${debTeDoen().length}</div><div class="muted" style="font-size:12px">${DEB_SCHEMA}</div></div>
      <div class="panel"><div class="k">Betaald deze maand</div><div class="v">${eur2(som(betaaldM, debIncl))}</div><div class="muted" style="font-size:12px">${betaaldM.length} factu${betaaldM.length === 1 ? "ur" : "ren"}${yukiAan ? " · uit Yuki" : ""}</div></div></div>
    ${yukiAan ? "" : `<div class="notice" style="margin-bottom:16px;border-color:var(--line-2);background:var(--surface)"><div><b>Betalingen komen nog niet uit Yuki.</b> <span class="muted">Zet in het Drive-script de scripteigenschap <code>YUKI_API_KEY</code> (toegangscode van de Yuki-webservice) en voer één keer <code>yukiApiTest</code> uit. Tot dan zet je betaalde facturen zelf op betaald; herinneringen worden enkel voorgesteld, nooit zonder jouw goedkeuring verstuurd.</span></div></div>`}
    ${wacht.length ? `<h2 style="margin:4px 0 10px">Herinneringen</h2>${wacht.map(kaart).join("")}` : ""}
    <div class="panel" style="margin-bottom:16px"><div class="panel-head"><h3>Openstaande facturen</h3><span class="muted" style="font-size:12px">${yukiAan ? "Open bedrag volgens Yuki (dagelijks bijgewerkt)" : ""}</span></div>
      ${open.length ? `<div class="tw"><table class="t"><thead><tr><th>Project</th><th>Factuur</th><th>Vervaldag</th><th class="r">Bedrag incl.</th><th class="r">Nog open</th><th>Herinneringen</th><th class="c" title="Herinneringen voorstellen voor deze factuur">Herinneren</th><th></th></tr></thead><tbody>
        ${open.map(v => { const d = v.vervaldag ? debDagen(v.vervaldag, todayIso) : null;
          return `<tr><td>${debProj(v.project_id)}</td><td><b class="num">${esc(debNr(v))}</b><div class="muted" style="font-size:11px">${fmtLong(v.datum)}${v.omschrijving ? " · " + esc(v.omschrijving) : ""}</div></td>
            <td class="num" style="white-space:nowrap;${d > 0 ? "color:var(--crit);font-weight:600" : ""}">${v.vervaldag ? fmtLong(v.vervaldag) : "—"}${d > 0 ? `<div style="font-size:11px">${d} dagen te laat</div>` : d != null && d > -8 ? `<div class="muted" style="font-size:11px">over ${-d} dag${d === -1 ? "" : "en"}</div>` : ""}</td>
            <td class="r num">${eur2(debIncl(v))}</td><td class="r num">${v.open_bedrag != null ? eur2(v.open_bedrag) : `<span class="muted">—</span>`}${v.yuki_gecheckt_op ? `<div class="muted" style="font-size:11px">Yuki ${fmtLong(lokDag(v.yuki_gecheckt_op))}</div>` : ""}</td>
            <td style="font-size:12px">${esc(herTxt(v.id)) || `<span class="muted">—</span>`}${v.opvolging_gemeld_op ? `<div style="color:var(--crit)">zelf opvolgen</div>` : ""}</td>
            <td class="c"><input type="checkbox" data-deb="herinneren" data-vid="${v.id}" ${v.herinneren !== false ? "checked" : ""}></td>
            <td class="r"><button class="btn ghost sm" data-deb-act="betaald" data-vid="${v.id}" title="Zelf op betaald zetten">Betaald</button></td></tr>`; }).join("")}</tbody></table></div>`
      : `<div class="empty"><b>Niets openstaand</b>Alle verzonden facturen zijn betaald.</div>`}</div>
    ${(() => { const rec = vs.filter(v => v.status === "betaald" && v.betaald_op && debDagen(v.betaald_op, todayIso) <= 30).sort((a, b) => b.betaald_op.localeCompare(a.betaald_op)); return rec.length ? `<details class="panel" style="margin-bottom:16px"><summary class="panel-head" style="cursor:pointer"><h3 style="display:inline">Betaald de laatste 30 dagen (${rec.length})</h3></summary><div class="tw"><table class="t"><tbody>${rec.map(v => `<tr><td>${debProj(v.project_id)}</td><td class="num">${esc(debNr(v))}</td><td class="r num">${eur2(debIncl(v))}</td><td class="num">betaald ${fmtLong(v.betaald_op)}</td></tr>`).join("")}</tbody></table></div></details>` : ""; })()}`;
}
const DEB_SCHEMA = "voorgesteld 3 en 7 dagen na de vervaldag";
async function debVersturen(id) {
  const h = S.betaalherinneringen[id]; if (!h) return; const e = debEd()[id] || {};
  const patch = { aan: (e.aan != null ? e.aan : h.aan || "").trim(), onderwerp: (e.onderwerp != null ? e.onderwerp : h.onderwerp || "").trim(), tekst: e.tekst != null ? e.tekst : h.tekst || "", status: "goedgekeurd", fout: "" };
  const adressen = patch.aan.split(/[,;]/).map(a => a.trim()).filter(Boolean);
  if (!adressen.length) return toast("Vul het e-mailadres van de klant in.");
  if (adressen.some(a => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a))) return toast("Controleer het e-mailadres (meerdere adressen scheiden met een komma).", 5000);
  if (!patch.tekst.trim()) return toast("Het bericht is leeg.");
  if (!confirm(`Herinnering versturen naar ${patch.aan}?`)) return;
  patch.aan = adressen.join(", ");
  try { await dbUpdate("betaalherinneringen", id, patch); } catch (x) { return; }
  delete debEd()[id];
  try { const r = await driveCall("herinneringen", {}); toast(r && r.verstuurd ? "Herinnering verstuurd (BROS kreeg een kopie)" : r && r.mislukt ? "Versturen mislukt — zie de foutmelding op de kaart" : r && r.bezig ? "Wordt nu verstuurd" : "Goedgekeurd — vertrekt binnen het uur", 6000); }
  catch (x) { toast("Goedgekeurd — het Drive-script verstuurt ze binnen het uur (" + (/Onbekende actie/.test(x.message) ? "plak eerst het nieuwe Drive-script" : x.message) + ")", 8000); }
  try { await refetch("betaalherinneringen"); } catch (x) { }
}
async function debNiet(id) { if (!confirm("Deze herinnering niet versturen?")) return; delete debEd()[id]; try { await dbUpdate("betaalherinneringen", id, { status: "geannuleerd" }); toast("Niet verstuurd"); } catch (x) { } }
async function debStop(vid) {
  const v = S.vorderingen[vid]; if (!v || !confirm(`Voor factuur ${debNr(v)} geen herinneringen meer voorstellen? (Zet je later het vinkje 'Herinneren' terug aan, dan stelt het script de volgende herinnering weer voor.)`)) return;
  try { await dbUpdate("vorderingen", vid, { herinneren: false }); } catch (x) { return; }
  for (const h of debAlle().filter(x => x.vordering_id === vid && (x.status === "voorgesteld" || x.status === "mislukt"))) { try { await dbUpdate("betaalherinneringen", h.id, { status: "geannuleerd" }); } catch (x) { } }
  toast("Geen herinneringen meer voor deze factuur");
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-deb-act]"); if (!el) return; const d = el.dataset;
  if (d.debAct === "tab") { S.factTab = d.t; render(); }
  if (d.debAct === "send") debVersturen(d.id);
  if (d.debAct === "nee") debNiet(d.id);
  if (d.debAct === "stop") debStop(d.vid);
  if (d.debAct === "betaald") { const v = S.vorderingen[d.vid]; if (v && confirm(`Factuur ${debNr(v)} op betaald zetten?`)) vordEdit(d.vid, "status", "betaald"); }
});
document.addEventListener("input", (e) => { const el = e.target; if (!el.dataset || !el.dataset.debVeld) return; (debEd()[el.dataset.id] = debEd()[el.dataset.id] || {})[el.dataset.debVeld] = el.value; });
document.addEventListener("change", async (e) => { const el = e.target; if (!el.dataset || el.dataset.deb !== "herinneren") return; const vid = el.dataset.vid, aan = el.checked;
  try { await dbUpdate("vorderingen", vid, { herinneren: aan }); } catch (x) { return; }
  if (!aan) for (const h of debAlle().filter(x => x.vordering_id === vid && (x.status === "voorgesteld" || x.status === "mislukt"))) { try { await dbUpdate("betaalherinneringen", h.id, { status: "geannuleerd" }); } catch (x) { } }
  toast(aan ? "Herinneringen weer aan: het Drive-script stelt ze voor bij de volgende ronde (werkdagen, 's ochtends)" : "Geen herinneringen meer voor deze factuur"); });
