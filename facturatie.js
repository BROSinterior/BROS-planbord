/* =====================================================================
   BROS Planbord — facturatie.js (v1.72: uit app.js gehaald, ongewijzigd)
   Inhoud: goedkeuringen (offerte/meerwerk) en de facturatie (vorderingsstaat).
   Geladen vóór app.js; gebruikt de helpers en de state (S) van app.js pas bij het aanroepen.
   ===================================================================== */
/* ---------- Goedkeuringen: BROS legt de offerte of een meerwerkvoorstel voor, de klant beslist in het portaal ---------- */
const GK_STATUS = { open: "Wacht op klant", akkoord: "Goedgekeurd", geweigerd: "Niet akkoord", ingetrokken: "Ingetrokken", geannuleerd: "Geannuleerd" };
const gkOf = (pid) => Object.values(S.goedkeuringen).filter(g => g.project_id === pid).sort((a, b) => (b.voorgelegd_op || "").localeCompare(a.voorgelegd_op || ""));
const gkOpenIds = (pid) => new Set(gkOf(pid).filter(g => g.status === "open" && !(g.geldig_tot && g.geldig_tot < todayIso)).flatMap(g => (g.posten || []).map(x => x.id)));
/* post die nog voorgelegd kan worden: offerte zonder akkoord, of meer-/minwerk zonder akkoord, en niet in een open voorstel */
const gkKandidaat = (r) => msTelt(r) && !r.akkoord_op && (r.status === "offerte" || isMw(r)) && !gkOpenIds(r.project_id).has(r.id);
const gkSnapshot = (r) => ({ id: r.id, lot: r.lot, code: r.code, omschrijving: r.omschrijving, locatie: r.locatie || "", hoeveelheid: Number(r.hoeveelheid) || 0, eenheid: r.eenheid, prijs: Math.round(msVerkoopEP(r) * 100) / 100, totaal: Math.round(rowSigned(r) * 100) / 100, btw: Number(r.btw) || 0, status: r.status });
function vGoedkeuringen(p) {
  const gs = gkOf(p.id).filter(g => g.soort !== "overeenkomst"); if (!gs.length) return "";   // overeenkomsten staan bij Dossier
  const klanten = contactsOf(p.id).filter(x => ["bouwheer", "contactpersoon"].includes(x.rol) && x.c.user_id);
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Goedkeuringen door de klant</h3><div class="muted" style="font-size:12px;margin-top:2px">${klanten.length ? `Zichtbaar in het portaal voor ${klanten.map(x => esc(x.c.naam)).join(", ")}.` : `<span style="color:var(--warn)">Nog niemand van dit project heeft portaal-toegang (Dossier › Contacten).</span>`}</div></div></div>
    <div class="tw"><table class="t"><thead><tr><th>Voorstel</th><th>Voorgelegd</th><th>Reageren vóór</th><th class="r">Excl. btw</th><th class="r">Incl. btw</th><th>Status</th><th>Beslist</th><th></th></tr></thead><tbody>
    ${gs.map(g => { const verlopen = g.status === "open" && g.geldig_tot && g.geldig_tot < todayIso; return `<tr><td><b>${esc(g.titel || (g.soort === "meerwerk" ? "Meerwerk" : "Offerte"))}</b><small class="muted" style="display:block">${(g.posten || []).length} posten${g.toelichting ? " · " + esc(g.toelichting.slice(0, 80)) : ""}</small>${g.soort === "meerwerk" && mwKlaar() ? gkAanKort(g) : ""}</td><td class="num">${fmtLong((g.voorgelegd_op || "").slice(0, 10))}<small class="muted" style="display:block">${esc(userById(g.voorgelegd_door).name)}</small></td><td class="num" style="${verlopen ? "color:var(--crit)" : ""}">${g.geldig_tot ? fmtLong(g.geldig_tot) : "—"}</td><td class="r num">${eur(g.totaal_excl)}</td><td class="r num">${eur(g.totaal_incl)}</td><td><span class="pill ${g.status === "akkoord" ? "st-afgerond" : verlopen ? "late" : g.status === "open" ? "st-lopend" : g.status === "geweigerd" ? "late" : "st-on_hold"}">${verlopen ? "Termijn verstreken" : GK_STATUS[g.status] || g.status}</span></td><td style="font-size:12px">${g.beslist_op ? `${fmtLong(lokDag(g.beslist_op))} · ${esc(g.beslist_naam)}${g.opmerking ? `<div style="color:var(--crit)">“${esc(g.opmerking)}”</div>` : ""}` : "—"}${g.status === "geannuleerd" ? `<div class="muted" title="${esc(g.annuleer_reden || "")}">geannuleerd ${g.geannuleerd_op ? fmtLong(lokDag(g.geannuleerd_op)) : ""}${g.geannuleerd_door ? " door " + esc(userById(g.geannuleerd_door).name) : ""}${g.annuleer_reden ? ` · “${esc(g.annuleer_reden.slice(0, 120))}”` : ""}</div>` : ""}</td>
      <td class="r" style="white-space:nowrap"><button class="btn ghost sm" data-act="gk-view" data-id="${g.id}">Bekijken</button>${g.status === "open" ? `<button class="btn ghost sm danger" data-act="gk-withdraw" data-id="${g.id}">Intrekken</button>` : ""}${g.status === "akkoord" && gkKanAnnuleren(g) ? `<button class="btn ghost sm danger" data-act="gk-annuleer" data-id="${g.id}" title="Het akkoord van de klant ongedaan maken: de posten gaan terug naar Offerte en kunnen opnieuw voorgelegd worden">Annuleren</button>` : ""}${g.status === "geweigerd" || g.status === "ingetrokken" || g.status === "geannuleerd" || verlopen ? `<button class="btn ghost sm" data-act="gk-new" data-pid="${p.id}" data-soort="${g.soort}">Opnieuw voorleggen</button>` : ""}</td></tr>`; }).join("")}</tbody></table></div></div>`;
}
function gkAanKort(g) {   // 1.76: wie voert het uit en is het ontvangen?
  const ids = g.aannemers || []; if (!ids.length) return g.status === "akkoord" || g.status === "open" ? `<small style="display:block;color:var(--warn)">Geen aannemer gekoppeld</small>` : "";
  const rijen = gkAanOf(g.id);
  return `<small style="display:block">${ids.map(id => { const a = rijen.find(x => x.contact_id === id); const n = esc(S.contacten[id]?.naam || "?"); return a && a.gezien_op ? `<span style="color:var(--ok)">${n} ✓ ontvangen</span>` : g.status === "akkoord" ? `<span style="color:var(--warn)">${n} · ${a && a.gemeld_op ? "gemeld" : "nog te melden"}</span>` : `<span class="muted">${n}</span>`; }).join(" · ")}</small>`;
}
function gkForm(pid, soortVoorkeur) {
  const p = S.projecten[pid]; const rows = msRows(pid).filter(gkKandidaat);
  const vastM = msProjVast(pid);   // 1.65: na een goedgekeurde offerte enkel nog meerwerkvoorstellen
  const off = vastM ? [] : rows.filter(r => r.status === "offerte"), mw = rows.filter(isMw);
  if (vastM && !mw.length) { toast("De meetstaat is goedgekeurd door de klant: er zijn geen meer- of minwerkposten om voor te leggen. Gebruik ± op een post of voeg een post toe (die wordt meerwerk).", 8000); return; }
  const soort = soortVoorkeur && (soortVoorkeur === "meerwerk" ? mw.length : off.length) ? soortVoorkeur : (off.length ? "offerte" : "meerwerk");
  const klanten = contactsOf(pid).filter(x => ["bouwheer", "contactpersoon"].includes(x.rol) && x.c.user_id);
  const lijst = (rs) => rs.map(r => `<label class="chk"><input type="checkbox" name="post" value="${r.id}" checked> <span>${esc(r.code)} ${esc(r.omschrijving)}${r.locatie ? ` <small class="muted">· ${esc(r.locatie)}</small>` : ""}<small class="muted" style="display:block">${nl(r.hoeveelheid, 2)} ${esc(r.eenheid)} × ${eur2(msVerkoopEP(r))} = <b>${eur2(rowSigned(r))}</b>${isMw(r) ? ` · ${MS_STATUS[r.status]}` : ""}</small></span></label>`).join("");
  openModal("Ter goedkeuring voorleggen — " + p.klant, `<div class="form-grid">
    <div class="field"><label for="gk_soort">Wat leg je voor?</label><select id="gk_soort" name="soort">${off.length ? `<option value="offerte" ${soort === "offerte" ? "selected" : ""}>Offerte (${off.length} posten in status Offerte)</option>` : ""}${mw.length ? `<option value="meerwerk" ${soort === "meerwerk" ? "selected" : ""}>Meerwerkvoorstel (${mw.length} meer-/minwerkposten)</option>` : ""}</select></div>
    <div class="field"><label for="gk_titel">Titel (ziet de klant)</label><input id="gk_titel" name="titel" value="${esc(soort === "meerwerk" ? "Meerwerk " + fmtLong(todayIso) : "Offerte " + (p.naam && p.naam !== p.klant ? p.naam : p.klant))}"></div>
    <div class="field"><label for="gk_tot">Reageren vóór</label><input id="gk_tot" name="geldig_tot" type="date" value="${addDays(todayIso, 14)}"><small class="muted">Na deze datum kan de klant niet meer goedkeuren; leeg = geen deadline.</small></div>
    <div class="field span2"><label for="gk_toel">Toelichting voor de klant (optioneel)</label><textarea id="gk_toel" name="toelichting" rows="2" placeholder="bv. Zoals besproken op de werf van 12/09: extra stopcontacten in de keuken."></textarea></div>
    <div class="field span2"><label>Posten in dit voorstel</label><div class="fase-list" id="gk_list" style="max-height:320px;overflow:auto">${lijst(soort === "meerwerk" ? mw : off)}</div></div>
    ${mwKlaar() ? gkAanBlok(pid, [], soort === "meerwerk") : ""}
    <div class="field span2"><p class="muted" style="font-size:12px;margin:0">Het Planbord bewaart een bevroren kopie van deze posten met hoeveelheden en klantprijzen; latere wijzigingen in de meetstaat veranderen het voorstel niet. ${klanten.length ? `De klant (${klanten.map(x => esc(x.c.naam)).join(", ")}) krijgt een mail en ziet het voorstel in het portaal.` : `<span style="color:var(--warn)">Let op: niemand van dit project heeft nog portaal-toegang — geef die eerst via Dossier › Contacten, anders kan de klant niet reageren.</span>`}</p></div>
  </div>`, {
    saveLabel: "Voorleggen", wide: true,
    onSave: async (d) => {
      const ids = [...$("#mform").querySelectorAll('input[name="post"]:checked')].map(i => i.value); if (!ids.length) { toast("Vink minstens één post aan."); return false; }
      const sel = ids.map(id => S.meetstaat_posten[id]).filter(Boolean); const posten = sel.map(gkSnapshot);
      const excl = posten.reduce((s, x) => s + x.totaal, 0), btw = sel.reduce((s, r) => s + rowSigned(r) * (Number(r.btw) || 0), 0);
      const row = { project_id: pid, soort: d.soort, titel: d.titel.trim(), toelichting: (d.toelichting || "").trim(), status: "open", geldig_tot: d.geldig_tot || null, posten, totaal_excl: Math.round(excl * 100) / 100, btw: Math.round(btw * 100) / 100, totaal_incl: Math.round((excl + btw) * 100) / 100, voorgelegd_door: S.me.id };
      // 1.76: bij meer-/minwerk minstens één aannemer die het uitvoert (krijgt na de goedkeuring de bevestiging in pdf)
      let aan = null;
      if (d.soort === "meerwerk" && mwKlaar()) {
        const k = gkAanKeuze(); if (k.fout) { toast(k.fout, 6000); return false; }
        if (!k.ids.length && !k.nieuw) { toast("Kies minstens één aannemer die dit meer-/minderwerk uitvoert (of voeg er een toe)."); return false; }
        aan = await gkAanKoppel(pid, k); row.aannemers = aan;
      }
      const g = await dbInsert("goedkeuringen", row);
      if (aan && aan.length) await gkAanRijen(g.id, aan).catch(e => toast("Voorstel bewaard, maar de aannemers niet: " + e.message, 7000));
      toast("Voorstel staat klaar in het portaal");
      if (driveReady() && klanten.length) driveCall("gkmail", { id: g.id, soort: "voorgelegd", token: S.session?.access_token || "" }).then(j => toast(`Mail gestuurd naar ${(j.naar || []).join(", ") || "de klant"}`)).catch(e => toast("Mail niet verstuurd: " + e.message, 6000));
    },
  });
  $("#gk_soort").addEventListener("change", () => { const srt = $("#gk_soort").value; $("#gk_list").innerHTML = lijst(srt === "meerwerk" ? mw : off); $("#gk_titel").value = srt === "meerwerk" ? "Meerwerk " + fmtLong(todayIso) : "Offerte " + (p.naam && p.naam !== p.klant ? p.naam : p.klant); const b = $("#gk_aan_blok"); if (b) b.style.display = srt === "meerwerk" ? "" : "none"; });
  gkAanBlokInit(pid);
}
function gkView(id) {
  const g = S.goedkeuringen[id]; if (!g) return; const ps = g.posten || [];
  openModal(`${g.titel || GK_STATUS[g.status]} — ${GK_STATUS[g.status]}`, `<div class="form-grid"><div class="field span2">
    <p style="margin:0 0 8px">${g.toelichting ? esc(g.toelichting) + "<br>" : ""}<span class="muted" style="font-size:12px">Voorgelegd ${fmtLong((g.voorgelegd_op || "").slice(0, 10))} door ${esc(userById(g.voorgelegd_door).name)}${g.geldig_tot ? ` · reageren vóór ${fmtLong(g.geldig_tot)}` : ""}${g.beslist_op ? ` · ${g.status === "geannuleerd" ? "Goedgekeurd" : GK_STATUS[g.status]} op ${fmtLong(lokDag(g.beslist_op))} door ${esc(g.beslist_naam)} (${esc(g.beslist_email)})${g.beslist_ip ? ` · IP ${esc(g.beslist_ip)}` : ""}` : ""}</span>${g.status === "geannuleerd" ? `<p style="margin:8px 0 0;color:var(--crit)">Geannuleerd${g.geannuleerd_op ? " op " + fmtLong(lokDag(g.geannuleerd_op)) : ""}${g.geannuleerd_door ? " door " + esc(userById(g.geannuleerd_door).name) : ""}${g.annuleer_reden ? `: “${esc(g.annuleer_reden)}”` : ""}</p>` : ""}${g.opmerking ? `<p style="margin:8px 0 0;color:var(--crit)">Opmerking van de klant: “${esc(g.opmerking)}”</p>` : ""}</p>
    <div class="tw"><table class="t"><thead><tr><th>Nr</th><th>Omschrijving</th><th class="r">Hoev.</th><th class="r">Prijs</th><th class="r">Totaal</th></tr></thead><tbody>${ps.map(x => `<tr><td class="num muted">${esc(x.code)}</td><td>${esc(x.omschrijving)}${x.locatie ? ` <small class="muted">· ${esc(x.locatie)}</small>` : ""}</td><td class="r num">${nl(x.hoeveelheid, 2)} ${esc(x.eenheid)}</td><td class="r num">${eur2(x.prijs)}</td><td class="r num">${eur2(x.totaal)}</td></tr>`).join("")}
    <tr class="tot"><td colspan="4"><b>Totaal excl. btw</b></td><td class="r num"><b>${eur2(g.totaal_excl)}</b></td></tr><tr><td colspan="4">Btw</td><td class="r num">${eur2(g.btw)}</td></tr><tr><td colspan="4"><b>Totaal incl. btw</b></td><td class="r num"><b>${eur2(g.totaal_incl)}</b></td></tr></tbody></table></div></div>${g.soort === "meerwerk" && mwKlaar() ? gkAanSectie(g) : ""}</div>`, { saveLabel: "Sluiten", wide: true, onSave: async () => { } });
}

/* ---------- 1.76 (script 068): goedgekeurd meer-/minderwerk naar de aannemer(s) ----------
   Bij het voorleggen kies je de aannemer(s) die het uitvoeren (ook al is er maar één; een externe partij kan je meteen toevoegen
   en wordt aannemer op het project). Keurt de klant goed, dan maakt het Planbord een bevestiging in pdf ZONDER prijzen, met de
   volledige goedkeuring van de klant (naam, login, tijdstip, IP-adres, browser, opmerking) en een controlecode (SHA-256).
   Die komt in Documenten/Meerwerk, wordt gedeeld met de aannemer(s) en het Drive-script mailt ze met de pdf in bijlage.
   In het aannemersportaal bevestigt de aannemer de ontvangst ("Ontvangen": naam, login, tijdstip, IP-adres). */
const mwKlaar = () => !!S.goedkeuring_aannemers;   // script 068 uitgevoerd
const gkAanOf = (gid) => Object.values(S.goedkeuring_aannemers || {}).filter(a => a.goedkeuring_id === gid);
const gkAanOpProject = (pid) => { const z = new Map(); contactsOf(pid).filter(x => !["bouwheer", "contactpersoon"].includes(x.rol)).forEach(x => { if (!z.has(x.c.id)) z.set(x.c.id, x); }); return [...z.values()]; };
function gkAanLabel(c, rol, extra) {
  const w = !c.email ? `<small style="display:block;color:var(--crit)">Geen e-mailadres: krijgt geen mail (vul het aan bij Contacten)</small>`
    : !c.user_id ? `<small class="muted" style="display:block">Geen portaaltoegang: krijgt de pdf per mail, maar kan de ontvangst niet bevestigen in het portaal</small>` : "";
  return `<span>${esc(c.naam)}${c.bedrijf && c.bedrijf !== c.naam ? ` <small class="muted">· ${esc(c.bedrijf)}</small>` : ""} <small class="muted">· ${esc(rol ? CONTACT_ROL[rol] || rol : CONTACT_SOORT[c.soort] || c.soort)}</small>${extra ? ` <small style="color:var(--accent)">${extra}</small>` : ""}${w}</span>`;
}
function gkAanBlok(pid, uitsluiten, zichtbaar) {
  const weg = new Set(uitsluiten || []);
  const op = gkAanOpProject(pid).filter(x => !weg.has(x.c.id));
  const opIds = new Set(contactsOf(pid).map(x => x.c.id));
  const anderen = Object.values(S.contacten || {}).filter(c => !opIds.has(c.id) && !weg.has(c.id) && c.soort !== "klant").sort((a, b) => (a.naam || "").localeCompare(b.naam || ""));
  return `<div class="field span2" id="gk_aan_blok"${zichtbaar === false ? ' style="display:none"' : ""}><label>Aannemer(s) die dit uitvoeren <span style="color:var(--crit)">*</span></label>
    <div class="fase-list" id="gk_aan_list">${op.map(x => `<label class="chk"><input type="checkbox" name="gk_aan" value="${x.c.id}"> ${gkAanLabel(x.c, x.rol)}</label>`).join("")}</div>
    ${op.length ? "" : `<p class="muted" id="gk_aan_leeg" style="font-size:12px;margin:4px 0 0">Er staat nog geen aannemer op dit project — voeg er hieronder een toe.</p>`}
    <select id="gk_aan_extra" style="margin-top:8px;max-width:420px"><option value="">+ Andere aannemer toevoegen…</option>${anderen.map(c => `<option value="${c.id}">${esc(c.naam)}${c.bedrijf && c.bedrijf !== c.naam ? " – " + esc(c.bedrijf) : ""} (${esc(CONTACT_SOORT[c.soort] || c.soort)})</option>`).join("")}<option value="__nieuw">Nieuw contact (externe partij)…</option></select>
    <div id="gk_aan_nieuw" style="display:none;margin-top:8px;gap:8px;flex-wrap:wrap"><input id="gk_aan_nnaam" placeholder="Naam (bedrijf of persoon)" style="flex:1;min-width:180px"><input id="gk_aan_nmail" type="email" placeholder="E-mailadres" style="flex:1;min-width:180px"></div>
    <small class="muted">Na de goedkeuring door de klant krijgen zij een bevestiging in pdf (zonder prijzen) per mail en in het aannemersportaal. Een aannemer die nog niet op het project staat, wordt eraan gekoppeld als aannemer.</small></div>`;
}
function gkAanBlokInit(pid) {
  const sel = $("#gk_aan_extra"); if (!sel) return;
  sel.addEventListener("change", () => {
    const v = sel.value; if (!v) return;
    if (v === "__nieuw") { $("#gk_aan_nieuw").style.display = "flex"; $("#gk_aan_nnaam").focus(); sel.value = ""; return; }
    const c = S.contacten[v]; if (!c) return;
    const lab = document.createElement("label"); lab.className = "chk";
    lab.innerHTML = `<input type="checkbox" name="gk_aan" value="${c.id}" checked data-nieuw-op-project="1"> ${gkAanLabel(c, null, "wordt aan het project gekoppeld")}`;
    $("#gk_aan_list").appendChild(lab); const leeg = $("#gk_aan_leeg"); if (leeg) leeg.remove();
    sel.querySelector(`option[value="${v}"]`).remove(); sel.value = "";
  });
}
/** keuze uit het blok: { ids, nieuw: {naam, email} | null, fout } */
function gkAanKeuze() {
  const ids = [...document.querySelectorAll('#gk_aan_list input[name="gk_aan"]:checked')].map(i => i.value);
  const nb = $("#gk_aan_nieuw"); let nieuw = null;
  if (nb && nb.style.display !== "none") {
    const naam = ($("#gk_aan_nnaam").value || "").trim(), email = ($("#gk_aan_nmail").value || "").trim();
    if (naam || email) {
      if (!naam) return { ids, fout: "Geef de naam van de nieuwe aannemer." };
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ids, fout: "Het e-mailadres van de nieuwe aannemer klopt niet." };
      if (!email) return { ids, fout: "Geef het e-mailadres van de nieuwe aannemer: daar gaat de bevestiging naartoe." };
      nieuw = { naam, email };
    }
  }
  return { ids, nieuw };
}
/** nieuw contact aanmaken en wie nog niet op het project staat koppelen als aannemer → lijst contact-id's */
async function gkAanKoppel(pid, k) {
  const ids = [...new Set(k.ids)];
  if (k.nieuw) { const c = await dbInsert("contacten", { soort: "aannemer", naam: k.nieuw.naam, email: k.nieuw.email }); ids.push(c.id); }
  const op = new Set(gkAanOpProject(pid).map(x => x.c.id));
  for (const id of ids) if (!op.has(id)) await dbInsert("project_contacten", { project_id: pid, contact_id: id, rol: "aannemer" });
  return ids;
}
async function gkAanRijen(gid, ids) {
  if (!ids.length) return [];
  const { data, error } = await sb.from("goedkeuring_aannemers").upsert(ids.map(c => ({ goedkeuring_id: gid, contact_id: c })), { onConflict: "goedkeuring_id,contact_id", ignoreDuplicates: true }).select();
  if (error) throw error;
  [].concat(data || []).forEach(r => { S.goedkeuring_aannemers[r.id] = r; }); return data || [];
}
function gkAanStatus(g, a) {
  const wanneer = (x) => new Date(x).toLocaleString("nl-BE", { timeZone: "Europe/Brussels", dateStyle: "short", timeStyle: "short" });
  if (a && a.gezien_op) return `<span style="color:var(--ok)">Ontvangen op ${wanneer(a.gezien_op)}</span><small class="muted" style="display:block">door ${esc(a.gezien_naam)} (${esc(a.gezien_email)})${a.gezien_ip ? " · IP " + esc(a.gezien_ip) : ""}</small>`;
  if (g.status === "open") return `<span class="muted">Wacht op de klant</span>`;
  if (g.status !== "akkoord") return `<span class="muted">—</span>`;
  if (a && a.gemeld_op) return `Gemeld op ${wanneer(a.gemeld_op)}<small class="muted" style="display:block">wacht op "Ontvangen" in het portaal</small>`;
  return g.bevestiging_drive_id ? `<span style="color:var(--warn)">Nog niet gemaild</span>` : `<span class="muted">Bevestiging wordt gemaakt…</span>`;
}
function gkAanSectie(g) {
  const rijen = gkAanOf(g.id); const ids = [...new Set([...(g.aannemers || []), ...rijen.map(a => a.contact_id)])];
  const doc = g.bevestiging_document && S.documenten && S.documenten[g.bevestiging_document];
  const nietGemeld = g.status === "akkoord" && g.bevestiging_drive_id && rijen.some(a => !a.gemeld_op && S.contacten[a.contact_id]?.email);
  return `<div class="field span2" style="margin-top:6px"><label>Aannemers (uitvoering)</label>
    ${ids.length ? `<div class="tw"><table class="t"><tbody>${ids.map(id => { const c = S.contacten[id] || { naam: "?" }; const a = rijen.find(x => x.contact_id === id); return `<tr><td>${esc(c.naam)}${c.email ? `<small class="muted" style="display:block">${esc(c.email)}</small>` : `<small style="display:block;color:var(--crit)">geen e-mailadres</small>`}</td><td>${gkAanStatus(g, a)}</td></tr>`; }).join("")}</tbody></table></div>`
      : `<p class="muted" style="margin:0;font-size:12px">Nog geen aannemer gekoppeld${g.status === "akkoord" ? " — dit voorstel werd goedgekeurd vóór versie 1.76 of zonder aannemer. Voeg er een toe om de bevestiging te maken en te versturen." : "."}</p>`}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
      ${["open", "akkoord"].includes(g.status) ? `<button type="button" class="btn ghost sm" data-act="gk-aann" data-id="${g.id}">+ Aannemer toevoegen</button>` : ""}
      ${g.bevestiging_drive_id ? (doc && doc.url ? `<a class="btn ghost sm" href="${esc(doc.url)}" target="_blank" rel="noopener">Bevestiging (pdf)</a>` : `<span class="muted" style="font-size:12px">Bevestiging bewaard in Documenten/Meerwerk</span>`) : g.status === "akkoord" && ids.length ? `<button type="button" class="btn ghost sm" data-act="gk-bev" data-id="${g.id}">Bevestiging nu maken en mailen</button>` : ""}
      ${nietGemeld ? `<button type="button" class="btn ghost sm" data-act="gk-mwmail" data-id="${g.id}">Mail nu versturen</button>` : ""}
    </div>${g.bevestiging_sha ? `<small class="muted" style="display:block;margin-top:6px">Controlecode (SHA-256): <span class="num">${esc(g.bevestiging_sha)}</span></small>` : ""}</div>`;
}
/* aannemer toevoegen aan een open of goedgekeurd meerwerkvoorstel */
function gkAannemersForm(gid) {
  const g = S.goedkeuringen[gid]; if (!g || !mwKlaar() || !["open", "akkoord"].includes(g.status)) return;
  const al = [...new Set([...(g.aannemers || []), ...gkAanOf(gid).map(a => a.contact_id)])];
  openModal("Aannemer toevoegen — " + (g.titel || "meerwerk"), `<div class="form-grid">${gkAanBlok(g.project_id, al, true)}
    <div class="field span2"><p class="muted" style="font-size:12px;margin:0">${g.status === "akkoord" ? (g.bevestiging_drive_id ? "De klant keurde dit al goed: de nieuwe aannemer(s) krijgen meteen de bevestiging in pdf per mail en in het portaal." : "De klant keurde dit al goed: het Planbord maakt nu de bevestiging in pdf en mailt ze.") : "Na de goedkeuring door de klant krijgen ze de bevestiging in pdf."}</p></div></div>`, {
    saveLabel: "Toevoegen", wide: true,
    onSave: async () => {
      const k = gkAanKeuze(); if (k.fout) { toast(k.fout, 6000); return false; }
      if (!k.ids.length && !k.nieuw) { toast("Vink een aannemer aan of voeg er een toe."); return false; }
      const ids = await gkAanKoppel(g.project_id, k);
      const alle = [...new Set([...(g.aannemers || []), ...ids])];
      await dbUpdate("goedkeuringen", gid, { aannemers: alle });
      await gkAanRijen(gid, ids);
      const g2 = S.goedkeuringen[gid];
      if (g2.status === "akkoord") {
        if (g2.bevestiging_drive_id) { if (g2.bevestiging_document) await mwDelen(g2, g2.bevestiging_document, ids).catch(e => toast("Delen in het portaal mislukte: " + e.message, 7000)); mwMail(gid, false); }
        else mwBevestiging(gid, false);
      } else toast("Aannemer toegevoegd — na de goedkeuring krijgt hij de bevestiging");
    },
  });
  gkAanBlokInit(g.project_id);
}
/* delen in het aannemersportaal: projectkoppeling, document (al gemeld: de mail met de pdf vervangt de verzamelmail) en de meldingsrij */
async function mwDelen(g, docId, ids) {
  const lijst = ids || g.aannemers || []; if (!lijst.length) return;
  const op = new Set(gkAanOpProject(g.project_id).map(x => x.c.id));
  for (const id of lijst) if (!op.has(id) && S.contacten[id]) await dbInsert("project_contacten", { project_id: g.project_id, contact_id: id, rol: "aannemer" });
  const { data, error } = await sb.from("document_aannemers").upsert(lijst.map(c => ({ document_id: docId, contact_id: c, gemeld: true })), { onConflict: "document_id,contact_id", ignoreDuplicates: true }).select();
  if (error) throw error; [].concat(data || []).forEach(r => { if (S.document_aannemers) S.document_aannemers[r.document_id + "|" + r.contact_id] = r; });
  await gkAanRijen(g.id, lijst);
}
const MW_GEMAILD = new Set();
async function mwMail(gid, stil) {
  try {
    const j = await driveCall("mwmail", { id: gid, token: S.session?.access_token || "" });
    MW_GEMAILD.add(gid);
    if (!stil) toast((j.naar || []).length ? `Bevestiging gemaild naar ${j.naar.join(", ")}${(j.zonder || []).length ? ` — geen e-mailadres: ${j.zonder.join(", ")}` : ""}` : (j.zonder || []).length ? `Niet gemaild: geen e-mailadres voor ${j.zonder.join(", ")}` : "Iedereen werd al gemaild.", 7000);
    refetch("goedkeuring_aannemers");
  } catch (e) { if (!stil) toast("Bevestiging bewaard, maar de mail is niet verstuurd: " + e.message, 8000); else console.warn("Meerwerkmail", gid, e); }
}
const MW_BEZIG = new Set();
const mwPdfTekst = (t) => typeof ovTxt === "function" ? ovTxt(t) : String(t == null ? "" : t).replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
/** inhoud die de controlecode bepaalt (zonder prijzen): wat de klant goedkeurde en wanneer/door wie */
const mwCanon = (g) => JSON.stringify({ id: g.id, project_id: g.project_id, titel: g.titel || "", toelichting: g.toelichting || "", posten: (g.posten || []).map(x => [x.code || "", x.omschrijving || "", x.locatie || "", Number(x.hoeveelheid) || 0, x.eenheid || "", x.status || ""]), beslist_op: g.beslist_op, beslist_naam: g.beslist_naam || "", beslist_email: g.beslist_email || "", beslist_ip: g.beslist_ip || "", opmerking: g.opmerking || "" });
async function mwBevestiging(gid, stil) {
  const g = S.goedkeuringen[gid]; const p = g && S.projecten[g.project_id];
  if (!g || !p || g.soort !== "meerwerk" || g.status !== "akkoord" || g.bevestiging_drive_id || MW_BEZIG.has(gid)) return;
  if (!(g.aannemers || []).length) { if (!stil) toast("Koppel eerst een aannemer aan dit meerwerk."); return; }
  if (!p.drive_folder_id || !driveReady()) { if (!stil) toast("Geen projectmap op Drive gekoppeld (of Drive-script niet ingesteld)."); return; }
  MW_BEZIG.add(gid);
  /* claimen: maar één Planbord maakt de pdf */
  if (!(await pbClaim("goedkeuringen", gid, "bevestiging_op", "bevestiging_drive_id", 10))) { MW_BEZIG.delete(gid); if (!stil) toast("De bevestiging wordt al gemaakt (door een ander Planbord)."); return; }
  if (!stil) loader.start("mw.bev", "Bevestiging meer-/minderwerk maken…", 15000);
  try {
    if (typeof laadModule === "function") await laadModule("teken");
    const PDFLib = typeof tkLaadPdfLib === "function" ? await tkLaadPdfLib() : window.PDFLib; if (!PDFLib) throw new Error("pdf-lib niet geladen");
    const doc = await PDFLib.PDFDocument.create();
    doc.setTitle(mwPdfTekst("Bevestiging meer-/minderwerk - " + (g.titel || ""))); doc.setAuthor("BROS"); doc.setCreator("BROS Planbord");
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica), vet = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold), mono = await doc.embedFont(PDFLib.StandardFonts.Courier);
    const grijs = PDFLib.rgb(0.42, 0.44, 0.43), lijn = PDFLib.rgb(0.82, 0.83, 0.82);
    const W = 595.28, H = 841.89, m = 50, br = W - 2 * m;
    let pg, y; const nieuwePagina = () => { pg = doc.addPage([W, H]); y = H - 56; };
    nieuwePagina();
    const wrap = (t, w, f, sz) => { const out = []; mwPdfTekst(t).split(/\n/).forEach(par => { let ln = ""; par.split(/\s+/).filter(Boolean).forEach(wd => { const pr = ln ? ln + " " + wd : wd; if (f.widthOfTextAtSize(pr, sz) <= w) { ln = pr; return; } if (ln) out.push(ln); while (f.widthOfTextAtSize(wd, sz) > w && wd.length > 1) { let k = wd.length; while (k > 1 && f.widthOfTextAtSize(wd.slice(0, k), sz) > w) k--; out.push(wd.slice(0, k)); wd = wd.slice(k); } ln = wd; }); out.push(ln); }); return out; };
    const plaats = (n) => { if (y - n < 60) nieuwePagina(); };
    const regel = (t, o = {}) => { const f = o.font || font, sz = o.size || 10; wrap(t, o.w || br - ((o.x || m) - m), f, sz).forEach(l => { plaats(sz + 4); pg.drawText(l, { x: o.x || m, y, size: sz, font: f, color: o.color }); y -= o.lh || sz + 4.5; }); y -= o.na || 0; };
    const wanneer = (x) => x && !isNaN(new Date(x)) ? new Date(x).toLocaleString("nl-BE", { timeZone: "Europe/Brussels", dateStyle: "long", timeStyle: "medium" }) : "onbekend";
    const maker = S.profiles[g.voorgelegd_door];
    regel("BROS", { font: vet, size: 16, na: 8 }); regel("Bevestiging meer-/minderwerk", { font: vet, size: 18, na: 4 });
    regel("Goedgekeurd door de klant - bestemd voor de uitvoerder(s). Deze bevestiging vermeldt geen prijzen.", { size: 9.5, color: grijs, na: 12 });
    regel("Project: " + [p.nummer, p.klant, p.naam && p.naam !== p.klant ? p.naam : ""].filter(Boolean).join(" - "), { font: vet, size: 11 });
    if (p.adres || p.gemeente) regel("Adres: " + [p.adres, p.gemeente].filter(Boolean).join(", "));
    regel("Voorstel: " + (g.titel || "Meer-/minderwerk"), { font: vet, size: 11 });
    regel("Voorgelegd door " + (maker ? maker.name : "BROS") + (g.voorgelegd_op ? " op " + wanneer(g.voorgelegd_op) : ""), { na: g.toelichting ? 2 : 10 });
    if (g.toelichting) regel("Toelichting: " + g.toelichting, { color: grijs, na: 10 });
    // posten
    const kol = { nr: m, oms: m + 52, hv: m + br - 110, st: m + br - 52 };
    const kop = () => { plaats(30); pg.drawText("Nr", { x: kol.nr, y, size: 9, font: vet }); pg.drawText("Omschrijving", { x: kol.oms, y, size: 9, font: vet }); pg.drawText("Hoeveelheid", { x: kol.hv, y, size: 9, font: vet }); pg.drawText("Soort", { x: kol.st, y, size: 9, font: vet }); y -= 5; pg.drawLine({ start: { x: m, y }, end: { x: m + br, y }, thickness: 0.7, color: lijn }); y -= 12; };
    kop();
    (g.posten || []).forEach(x => {
      const oms = wrap((x.omschrijving || "") + (x.locatie ? " - " + x.locatie : ""), kol.hv - kol.oms - 10, font, 9.5);
      const h = oms.length * 12 + 4; if (y - h < 60) { nieuwePagina(); kop(); }
      const hv = mwPdfTekst(nl(x.hoeveelheid, 2) + " " + (x.eenheid || ""));
      pg.drawText(mwPdfTekst(x.code || ""), { x: kol.nr, y, size: 9.5, font: mono });
      oms.forEach((l, i) => pg.drawText(l, { x: kol.oms, y: y - i * 12, size: 9.5, font }));
      pg.drawText(hv, { x: kol.st - 10 - font.widthOfTextAtSize(hv, 9.5), y, size: 9.5, font });
      pg.drawText(mwPdfTekst((typeof MS_STATUS === "object" && MS_STATUS[x.status]) || x.status || ""), { x: kol.st, y, size: 9.5, font });
      y -= h - 4; pg.drawLine({ start: { x: m, y: y + 6 }, end: { x: m + br, y: y + 6 }, thickness: 0.4, color: lijn }); y -= 4;
    });
    y -= 10;
    // goedkeuring door de klant
    plaats(120); regel("Goedkeuring door de klant", { font: vet, size: 12, na: 2 });
    const i = m + 12;
    regel("Naam zoals getypt: " + (g.beslist_naam || "-"), { x: i });
    regel("Login (e-mail): " + (g.beslist_email || "-"), { x: i });
    regel("Goedgekeurd op: " + wanneer(g.beslist_op), { x: i });
    regel("IP-adres: " + (g.beslist_ip || "niet geregistreerd"), { x: i });
    regel("Browser: " + (g.beslist_agent || "niet geregistreerd").slice(0, 160), { x: i, size: 8, color: grijs });
    if (g.opmerking) regel("Opmerking van de klant: " + g.opmerking, { x: i });
    regel("Goedgekeurd met de knop 'Akkoord geven' in het BROS-klantenportaal, na aanmelden met de persoonlijke login van de klant.", { x: i, size: 8.5, color: grijs, na: 12 });
    // bestemd voor
    const aan = (g.aannemers || []).map(id => S.contacten[id]).filter(Boolean);
    plaats(40 + aan.length * 15); regel("Bestemd voor (uitvoering)", { font: vet, size: 12, na: 2 });
    aan.forEach(c => regel("- " + c.naam + (c.bedrijf && c.bedrijf !== c.naam ? " (" + c.bedrijf + ")" : "") + (c.email ? " - " + c.email : ""), { x: i }));
    y -= 10;
    const sha = await ovSha(new TextEncoder().encode(mwCanon(g)));
    plaats(60); regel("Controlecode van de goedgekeurde inhoud (SHA-256):", { size: 9, color: grijs });
    regel(sha, { font: mono, size: 8.5, na: 10 });
    regel("Gemaakt door het BROS Planbord op " + wanneer(new Date().toISOString()) + ". De controlecode wordt bewaard in het Planbord; elke wijziging aan de goedgekeurde posten of aan de gegevens van de goedkeuring geeft een andere code.", { size: 8, color: grijs });
    const n = doc.getPageCount(); doc.getPages().forEach((pp, k) => pp.drawText(mwPdfTekst(`BROS - bevestiging meer-/minderwerk - blz. ${k + 1}/${n}`), { x: m, y: 30, size: 7.5, font, color: grijs }));
    const uit = await doc.save(); const datum = new Date().toLocaleDateString("nl-BE").replace(/\//g, "-");
    const naam = `${(g.titel || "Meerwerk").replace(/[\\/:*?"<>|]/g, "-").slice(0, 110)} - bevestiging ${datum}.pdf`;
    if (!stil) loader.step("Bewaren in Documenten/Meerwerk…");
    const j = await driveCall("put", { folderId: p.drive_folder_id, subpath: "Documenten/Meerwerk", name: naam, base64: ovB64(uit), mime: "application/pdf" });
    const f = j.file; if (!f || !f.id) throw new Error("Drive gaf geen bestand terug.");
    // meteen als klaar markeren (Drive-id): ook als hierna iets mislukt, komt er geen tweede pdf
    await dbUpdate("goedkeuringen", gid, { bevestiging_drive_id: f.id, bevestiging_op: new Date().toISOString(), bevestiging_sha: sha });
    const { data, error } = await sb.from("documenten").upsert([{ project_id: p.id, drive_id: f.id, naam: f.name, pad: f.path || "Documenten/Meerwerk", url: f.url, mime: "application/pdf", grootte: f.size || null, gewijzigd: f.updated || null, gesynct_op: new Date().toISOString() }], { onConflict: "project_id,drive_id" }).select();
    if (error) throw error; const d = data[0]; S.documenten[d.id] = d;
    await dbUpdate("goedkeuringen", gid, { bevestiging_document: d.id });
    await mwDelen(S.goedkeuringen[gid], d.id);
    if (!stil) loader.done("mw.bev");
    await mwMail(gid, stil);
  } catch (e) {
    await sb.from("goedkeuringen").update({ bevestiging_op: null }).eq("id", gid).is("bevestiging_drive_id", null);
    if (!stil) { loader.fail(); toast("Bevestiging niet gemaakt: " + (e.message || e), 8000); } else console.warn("Bevestiging meerwerk", gid, e);
  } finally { MW_BEZIG.delete(gid); }
}
/* automatisch (elke 2 min zolang het Planbord open staat): goedgekeurd meerwerk met aannemer(s) → bevestiging maken en mailen;
   een bevestiging waarvan de mail mislukte, wordt per sessie één keer opnieuw gemaild */
function mwAuto() {
  if (!mwKlaar() || !S.me || !["beheer", "medewerker"].includes(S.me.role) || !driveReady()) return;
  Object.values(S.goedkeuringen || {}).filter(g => g.soort === "meerwerk" && g.status === "akkoord" && (g.aannemers || []).length).forEach(g => {
    if (!g.bevestiging_drive_id) { if (!(g.bevestiging_op && Date.now() - new Date(g.bevestiging_op).getTime() < 10 * 60000)) mwBevestiging(g.id, true); return; }
    if (!MW_GEMAILD.has(g.id) && Date.now() - new Date(g.bevestiging_op || 0).getTime() > 5 * 60000 && gkAanOf(g.id).some(a => !a.gemeld_op && S.contacten[a.contact_id]?.email)) { MW_GEMAILD.add(g.id); mwMail(g.id, true); }
  });
}
/* 1.53 (script 050): een goedgekeurde offerte of goedgekeurd meerwerk annuleren — enkel beheer, via de databankfunctie
   (die zet het voorstel op geannuleerd én haalt het akkoord van de posten: Akkoord → Offerte, meer-/minwerk houdt zijn status) */
const gkKanAnnuleren = (g) => !!g && g.status === "akkoord" && g.soort !== "overeenkomst" && isBeheer() && true;
function gkAnnuleerForm(id) {
  const g = S.goedkeuringen[id]; if (!gkKanAnnuleren(g)) return;
  const posten = Object.values(S.meetstaat_posten).filter(r => r.akkoord_goedkeuring === g.id && r.project_id === g.project_id);
  const naarOfferte = posten.filter(r => r.status === "akkoord").length, mw = posten.filter(isMw).length;
  const facturen = Object.values(S.vorderingen || {}).filter(v => v.project_id === g.project_id && (v.status === "verzonden" || v.status === "betaald"));
  const klanten = contactsOf(g.project_id).filter(x => ["bouwheer", "contactpersoon"].includes(x.rol) && x.c.user_id && x.c.email);
  const kanMailen = driveReady() && klanten.length;
  openModal("Goedgekeurd voorstel annuleren — " + (g.titel || GK_STATUS[g.status]), `<div class="form-grid">
    <div class="field span2"><p style="margin:0">Goedgekeurd op ${fmtLong(lokDag(g.beslist_op))} door ${esc(g.beslist_naam || "de klant")} · ${eur(g.totaal_incl)} incl. btw.</p>
      <ul style="margin:8px 0 0;padding-left:18px;font-size:13px">
        <li>Het voorstel krijgt de status <b>Geannuleerd</b>; het akkoord van de klant blijft zichtbaar als historiek.</li>
        <li>${posten.length ? `${posten.length} ${posten.length === 1 ? "post verliest" : "posten verliezen"} het akkoord${naarOfferte ? ` — ${naarOfferte} ${naarOfferte === 1 ? "gaat" : "gaan"} terug naar <b>Offerte</b>` : ""}${mw ? `${naarOfferte ? ";" : " —"} ${mw} meer-/minwerk${mw === 1 ? "post houdt zijn" : "posten houden hun"} status` : ""}. Daarna kan je ze opnieuw voorleggen.` : "Geen posten meer gekoppeld aan dit akkoord."}</li>
        <li>De klant ziet in het portaal dat het voorstel geannuleerd werd, met je reden.</li>
      </ul>
      ${facturen.length ? `<div class="notice" style="margin:10px 0 0;border-color:var(--warn)"><b>Let op:</b> voor dit project ${facturen.length === 1 ? "is al 1 factuur" : "zijn al " + facturen.length + " facturen"} verstuurd of betaald. Die blijven ongewijzigd — maak zo nodig een creditnota in Yuki.</div>` : ""}</div>
    <div class="field span2"><label for="gka_reden">Reden (ziet de klant)</label><textarea id="gka_reden" name="reden" rows="3" required minlength="3" placeholder="bv. Zoals telefonisch besproken: de keuken wordt opnieuw uitgewerkt; je krijgt een nieuw voorstel."></textarea></div>
    ${kanMailen ? `<div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" name="mail" checked><span><b>De klant verwittigen per mail</b><small class="muted" style="display:block">naar ${klanten.map(x => esc(x.c.naam)).join(", ")}</small></span></label></div>` : `<div class="field span2"><p class="muted" style="font-size:12px;margin:0">Er gaat geen mail naar de klant (${driveReady() ? "niemand van dit project heeft portaal-toegang" : "Drive-script niet ingesteld"}); laat het hem zelf weten.</p></div>`}
  </div>`, {
    saveLabel: "Voorstel annuleren", wide: true,
    onSave: async (d) => {
      const reden = String(d.reden || "").trim(); if (reden.length < 3) { toast("Schrijf kort waarom je het voorstel annuleert."); return false; }
      const { data, error } = await sb.rpc("goedkeuring_annuleer", { p_id: g.id, p_reden: reden });
      if (error) { toast("Annuleren mislukt: " + error.message, 7000); return false; }
      if (data && data.id) S.goedkeuringen[data.id] = data;
      await msRefetch(posten.map(r => r.id));
      render(); toast("Voorstel geannuleerd — de posten kunnen opnieuw voorgelegd worden", 5000);
      if (kanMailen && d.mail) driveCall("gkmail", { id: g.id, soort: "geannuleerd", token: S.session?.access_token || "" }).then(j => toast(`Mail gestuurd naar ${(j.naar || []).join(", ") || "de klant"}`)).catch(e => toast("Geannuleerd, maar de mail is niet verstuurd: " + e.message, 7000));
    },
  });
  const terug = $("#mform [data-close]"); if (terug) terug.textContent = "Terug";   // niet verwarren met "Voorstel annuleren"
}
async function gkWithdraw(id) {
  const g = S.goedkeuringen[id]; if (!g || g.status !== "open" || !confirm("Dit voorstel intrekken? De klant ziet het dan niet meer in het portaal.")) return;
  await dbUpdate("goedkeuringen", id, { status: "ingetrokken" }).catch(() => { });
}
const msMaxNr = (pid, lot) => Math.max(0, ...msRows(pid).filter(r => r.lot === lot).map(r => { const m = String(r.code || "").match(/\.(\d+)$/); return m ? Number(m[1]) : 0; }));
function msNextCode(pid, lot) { return `${lot}.${msMaxNr(pid, lot) + 1}`; }
function msRowFromPost(pid, x, lot, i) {
  const sog = x.prijstype !== "EP";
  return { project_id: pid, post_id: x.id || null, lot, code: `${lot}.${i}`, groep: x.groep || "", omschrijving: x.omschrijving, eenheid: x.eenheid || (sog ? "sog" : "stk"), prijstype: x.prijstype || "EP", hoeveelheid: sog ? 1 : 0, eenheidsprijs: Number(x.richtprijs) || 0, marge: null, btw: x.btw ?? 0.06, status: "offerte", volgorde: x.volgorde ?? 0, created_by: S.me?.id || null };
}
async function msInsert(rows, strikt) {
  if (!rows.length) return [];
  const naarMw = rows.filter(r => ["offerte", "akkoord"].includes(r.status) && msProjVast(r.project_id)).length;   // 1.65: goedgekeurde meetstaat → nieuwe posten zijn meerwerk
  if (naarMw) { rows = rows.map(r => ["offerte", "akkoord"].includes(r.status) && msProjVast(r.project_id) ? { ...r, status: "meerwerk" } : r); setTimeout(() => toast(`De meetstaat is goedgekeurd door de klant: ${naarMw === 1 ? "de nieuwe post staat" : `de ${naarMw} nieuwe posten staan`} op Meerwerk.`, 6000), 400); }
  const v12 = true;
  const clean = v12 ? rows.map(({ eenheidsprijs, marge, ...r }) => r) : rows;
  const { data, error } = await sb.from("meetstaat_posten").insert(clean).select();
  if (error) { toast("Mislukt: " + error.message); throw error; }
  (data || []).forEach(r => S.meetstaat_posten[r.id] = r);
  if (v12 && data) {
    // vrije posten en geïmporteerde regels: prijs expliciet bewaren (bibliotheekposten krijgen hun richtprijs via de trigger)
    const prijzen = !isBeheer() ? [] : data.map((r, i) => ({ post_id: r.id, eenheidsprijs: Number(rows[i].eenheidsprijs) || 0, marge: rows[i].marge == null || rows[i].marge === "" ? null : Number(rows[i].marge) })).filter((p, i) => !rows[i].post_id || Number(rows[i].eenheidsprijs) > 0 && isBeheer());
    for (let i = 0; i < prijzen.length; i += 200) { const chunk = prijzen.slice(i, i + 200); const { error: e2 } = await (isBeheer() ? sb.from("meetstaat_prijzen").upsert(chunk) : sb.from("meetstaat_prijzen").insert(chunk)); if (e2) { toast("Prijzen niet bewaard: " + e2.message); if (strikt) { e2.ids = data.map(r => r.id); throw e2; } } }
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
      const rows = []; const cnt = {}; const next = (l) => { cnt[l] = (cnt[l] ?? msMaxNr(pid, l)) + 1; return cnt[l]; };   // 1.48: na het hoogste bestaande nummer (geen dubbele code na een verwijderde post)
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
/* 1.65 (script 061): een goedgekeurde post wijzigen via meer- of minwerk — de databank maakt de post(en) voor het verschil,
   met dezelfde klantprijs en een verwijzing naar de originele post; de klant keurt ze daarna goed in een meerwerkvoorstel */
function msWijzigForm(id) {
  const r = S.meetstaat_posten[id]; if (!r || !msVast(r)) return;
  if (!["akkoord", "meerwerk"].includes(r.status)) return toast("Enkel een goedgekeurde offerte- of meerwerkpost kan je zo wijzigen.");
  const nu = msHuidig(r), ep = msVerkoopEP(r), kids = msKinderen(r), eh = esc(r.eenheid);
  openModal(`Post ${r.code} wijzigen via meer- of minwerk`, `<div class="form-grid">
    <div class="field span2"><div class="ms-vast-banner" style="margin:0">🔒 <b>${esc(r.omschrijving)}</b>${r.locatie ? ` · ${esc(r.locatie)}` : ""}<br>Goedgekeurd door de klant op ${fmtLong(lokDag(r.akkoord_op))}: ${nl(r.hoeveelheid, 2)} ${eh} × ${eur2(ep)}${kids.length ? ` · na ${kids.length} wijziging${kids.length === 1 ? "" : "en"} nu <b>${nl(nu, 2)} ${eh}</b>` : ""}.</div></div>
    <div class="field span2"><label>Wat verandert er?</label>
      <label class="chk"><input type="radio" name="soort" value="hoeveelheid" checked> Andere hoeveelheid</label>
      <label class="chk"><input type="radio" name="soort" value="schrappen" ${nu <= 0 ? "disabled" : ""}> Schrappen (alles als minwerk)</label>
      <label class="chk"><input type="radio" name="soort" value="vervangen"> Vervangen door iets anders (minwerk + een nieuwe meerwerkpost)</label></div>
    <div class="field" data-w="hoeveelheid"><label for="mw_h">Nieuwe hoeveelheid (${eh})</label><input id="mw_h" name="hoeveelheid" type="text" inputmode="decimal" autocomplete="off" value="${getalVeld(nu)}"></div>
    <div class="field span2" data-w="vervangen" style="display:none"><label for="mw_o">Omschrijving van de nieuwe post</label><input id="mw_o" name="omschrijving" value="${esc(r.omschrijving)}"></div>
    <div class="field" data-w="vervangen" style="display:none"><label for="mw_vh">Hoeveelheid van de nieuwe post (${eh})</label><input id="mw_vh" name="vhoeveelheid" type="text" inputmode="decimal" autocomplete="off" value="${getalVeld(nu > 0 ? nu : r.hoeveelheid)}"></div>
    <div class="field span2"><div id="mw_res" class="mw-res"></div>
      <p class="muted" style="font-size:12px;margin:6px 0 0">De nieuwe posten krijgen de goedgekeurde klantprijs en een verwijzing naar post ${esc(r.code)}. Ze zijn nog niet goedgekeurd: leg ze voor via <b>Ter goedkeuring voorleggen › Meerwerkvoorstel</b>.</p></div>
  </div>`, {
    saveLabel: "Meer-/minwerk aanmaken",
    onSave: async (d) => {
      const soort = d.soort || "hoeveelheid"; const args = { p_post: id, p_soort: soort, p_hoeveelheid: null, p_omschrijving: null };
      if (soort === "hoeveelheid") { const h = leesGetal(d.hoeveelheid); if (h == null || Number.isNaN(h) || h < 0) { toast("Geef de nieuwe hoeveelheid (0 of meer), bv. 12,5"); return false; } if (Math.abs(h - nu) < 1e-9) { toast("Dat is de huidige hoeveelheid."); return false; } args.p_hoeveelheid = h; }
      if (soort === "vervangen") { const h = leesGetal(d.vhoeveelheid); if (h == null || Number.isNaN(h) || h <= 0) { toast("Geef de hoeveelheid van de nieuwe post."); return false; } args.p_hoeveelheid = h; args.p_omschrijving = (d.omschrijving || "").trim() || r.omschrijving; }
      const { data, error } = await sb.rpc("meetstaat_wijziging", args);
      if (error) { toast("Niet gelukt: " + error.message, 7000); return false; }
      const ids = (data && data.ids) || []; await msRefetch(ids);
      const nieuw = ids.map(x => S.meetstaat_posten[x]).filter(Boolean);
      toast(nieuw.map(x => `${MS_STATUS[x.status]} ${x.code}: ${eur2(rowSigned(x))}`).join(" · ") + (soort === "vervangen" ? " — kijk de prijs van de nieuwe post na" : ""), 7000);
    },
  });
  const f = $("#mform"); const res = $("#mw_res");
  const toon = () => {
    const soort = f.querySelector('input[name="soort"]:checked')?.value || "hoeveelheid";
    f.querySelectorAll("[data-w]").forEach(el => { el.style.display = el.dataset.w === soort ? "" : "none"; });
    const regel = (st, h, oms) => `<div><span class="pill ${st === "minwerk" ? "late" : "st-offerte"}">${MS_STATUS[st]}</span> ${nl(h, 2)} ${eh} × ${eur2(ep)} = <b>${eur2((st === "minwerk" ? -1 : 1) * r2(h * ep))}</b>${oms ? ` <span class="muted">· ${esc(oms)}</span>` : ""}</div>`;
    let html = "";
    if (soort === "hoeveelheid") { const h = leesGetal($("#mw_h").value); if (h == null || Number.isNaN(h) || h < 0) html = `<span class="muted">Geef een hoeveelheid.</span>`; else { const dlt = Math.round((h - nu) * 1000) / 1000; html = !dlt ? `<span class="muted">Geen verschil met nu (${nl(nu, 2)} ${eh}).</span>` : regel(dlt > 0 ? "meerwerk" : "minwerk", Math.abs(dlt)); } }
    else if (soort === "schrappen") html = regel("minwerk", nu);
    else { const h = leesGetal($("#mw_vh").value); html = (nu > 0 ? regel("minwerk", nu) : "") + (h == null || Number.isNaN(h) || h <= 0 ? `<span class="muted">Geef de hoeveelheid van de nieuwe post.</span>` : regel("meerwerk", h, ($("#mw_o").value || "").trim() || r.omschrijving).replace("</div>", ` <span class="muted">(voorlopig dezelfde prijs)</span></div>`)); }
    res.innerHTML = html;
  };
  f.addEventListener("input", toon); f.addEventListener("change", toon); toon();
}
let MARGE_DEC = 1e4;   // decimalen van de marge per post: 8 sinds script 033 (gezet bij elke bewerking)
async function msEdit(id, f, raw) {
  MARGE_DEC = 1e8;
  const r = S.meetstaat_posten[id]; if (!r) return;
  const terug = (msg) => { toast(msg, 6000); renderPending = false; document.activeElement?.blur?.(); render(); };
  if (msVast(r) && MS_VAST_F.includes(f)) return terug(`Post ${r.code} is goedgekeurd door de klant en ligt vast. Een wijziging gaat via meer- of minwerk: knop ± op de post.`);
  if (f === "status" && !msVast(r) && ["offerte", "akkoord"].includes(raw) && msProjVast(r.project_id)) return terug("De meetstaat is goedgekeurd door de klant: deze post kan enkel meerwerk, minwerk of vervallen zijn.");
  let v = raw;
  if (["hoeveelheid", "eenheidsprijs", "btw", "marge"].includes(f)) {
    const n = leesGetal(raw);
    if (Number.isNaN(n)) return terug(`"${raw}" is geen geldig getal — gebruik bv. 2,5 of 1.250,75`);
    if (f === "marge" && n != null && (n <= -100 || n > 1000)) return terug(`Een marge van ${nl(n, 2)} % kan niet — geef een % tussen -99 en 1000`);
    if (f === "eenheidsprijs" && n != null && n < 0) return terug("Een negatieve kostprijs kan niet — zet de post op minwerk of gebruik een negatieve hoeveelheid");
    const m = f === "hoeveelheid" || f === "eenheidsprijs" ? duizendKeuze(raw, n) : n;
    v = f === "marge" ? (m == null ? null : Math.round(m * MARGE_DEC / 100) / MARGE_DEC) : f === "eenheidsprijs" ? r2(m ?? 0) : (m == null ? 0 : m);
  }
  const zelfde = typeof v === "number" ? r[f] != null && r[f] !== "" && Math.abs(Number(r[f]) - v) < 1e-10 : String(r[f] ?? "") === String(v ?? "");
  if (zelfde) return;
  // door de klant goedgekeurde posten: de klantprijs mag niet ongemerkt veranderen
  const goed = ["akkoord", "meerwerk", "minwerk"].includes(r.status); const ep = msVerkoopEP(r); let extra = null;
  if (goed && f === "eenheidsprijs") {
    // nieuwe kostprijs (bv. een andere aannemer): klantprijs behouden door de marge te herrekenen
    if (v > 0 && ep > 0) { const m = Math.round((ep / v - 1) * MARGE_DEC) / MARGE_DEC; if (m >= -1 && m <= 10 && r2(v * (1 + m)) === ep) extra = { marge: m }; }
    if (!extra && msVast(r)) return terug(`Post ${r.code} is goedgekeurd aan ${eur2(ep)} per ${r.eenheid}: die klantprijs ligt vast en kan met deze kostprijs niet behouden blijven. Een andere klantprijs gaat via meer- of minwerk (±).`);
    if (!extra && !confirm(`${r.code} ${r.omschrijving}\n\nDeze post is goedgekeurd aan ${eur2(ep)} per ${r.eenheid}. Met deze kostprijs kan die klantprijs niet behouden blijven — de klantprijs verandert. Doorgaan?`)) { render(); return; }
  }
  if (goed && f === "marge" && !confirm(`${r.code} ${r.omschrijving}\n\nDeze post is goedgekeurd aan ${eur2(ep)} per ${r.eenheid}. Een andere marge verandert die klantprijs. Doorgaan?`)) { render(); return; }
  if (goed && r.akkoord_op && f === "hoeveelheid" && !confirm(`${r.code} ${r.omschrijving}\n\nDe klant keurde deze post goed met ${nl(r.hoeveelheid, 2)} ${r.eenheid}. De hoeveelheid wijzigen verandert het goedgekeurde bedrag (een wijziging na akkoord hoort meestal als meer- of minwerk). Toch wijzigen naar ${nl(v, 2)}?`)) { render(); return; }
  const active = document.activeElement; const keep = active && active.dataset ? { ms: active.dataset.ms, f: active.dataset.f, sel: active.selectionStart } : null;
  try {
    if (f === "eenheidsprijs" || f === "marge") {
      // enkel de gewijzigde kolom bijwerken: wie tegelijk de andere kolom wijzigt, verliest zijn wijziging niet
      const patch = { [f]: v, ...(extra || {}) };
      let { data, error } = await sb.from("meetstaat_prijzen").update({ ...patch, updated_at: new Date().toISOString() }).eq("post_id", id).select("post_id");
      if (!error && !(data || []).length) {   // nog geen prijsrij voor deze post
        ({ error } = await sb.from("meetstaat_prijzen").insert({ post_id: id, eenheidsprijs: 0, marge: null, ...patch }));
        if (error && /duplicate|23505/i.test((error.code || "") + " " + (error.message || ""))) ({ error } = await sb.from("meetstaat_prijzen").update(patch).eq("post_id", id));
      }
      if (error) { toast("Bewaren mislukt: " + error.message, 6000); render(); return; }
      S.meetstaat_posten[id] = { ...r, ...patch }; await msRefetch([id]);
      if (extra) toast(`Klantprijs blijft ${eur2(ep)} (goedgekeurd) — marge herrekend naar ${nl(extra.marge * 100, 2)} %`, 5000);
    } else await dbUpdate("meetstaat_posten", id, { [f]: v, updated_at: new Date().toISOString() });
  } catch (e) { return; }
  if (keep && keep.ms) { const el = document.querySelector(`[data-ms="${keep.ms}"][data-f="${keep.f}"]`); if (el) { el.focus(); try { if (keep.sel != null) el.setSelectionRange(keep.sel, keep.sel); } catch (e) { } } }
}
/* 1.48: posten die al in een vordering staan (vordering_regels.post_id cascade) */
const msGefactureerd = (ids) => { const set = new Set(Object.values(S.vordering_regels || {}).map(r => r.post_id).filter(Boolean)); return ids.filter(id => set.has(id)).length; };
async function msDelLot(pid, lot) {
  const ids = msRows(pid).filter(r => r.lot === lot).map(r => r.id);
  const nVast = msRows(pid).filter(r => r.lot === lot && msVast(r)).length;
  if (nVast) { toast(`${lotName(lot)} bevat ${nVast} post${nVast === 1 ? "" : "en"} die de klant goedkeurde — die liggen vast. Schrappen gaat via minwerk (± op de post).`, 8000); return; }
  const gf = msGefactureerd(ids); if (gf) { toast(`${gf} post${gf === 1 ? "" : "en"} van dit lot sta${gf === 1 ? "at" : "an"} al in een vordering — verwijderen zou die facturen wijzigen. Zet ze op Vervallen.`, 9000); return; }
  if (!confirm(`${lotName(lot)}: alle ${ids.length} posten verwijderen uit deze meetstaat?`)) return;
  const { error } = await sb.from("meetstaat_posten").delete().in("id", ids);
  if (error) return toast("Mislukt: " + error.message);
  ids.forEach(id => delete S.meetstaat_posten[id]); render(); toast("Lot verwijderd");
  const lr = msRamingKlaar() ? msrLot(pid, lot) : null; if (lr) dbDelete("ms_raming", lr.id).catch(() => { });   // 1.55: geen oude lotmarge laten staan
}
/* ---------- Facturatie: vorderingsstaat per project (percentages per lot én per post) ---------- */
const VORD_SOORT = { voorschot: "Voorschot", vordering: "Vordering", slotfactuur: "Slotfactuur", meerwerk: "Meerwerk" };
const VORD_STATUS = { opgemaakt: "Op te maken", verzonden: "Verzonden", betaald: "Betaald" };
const vordOf = (pid) => Object.values(S.vorderingen).filter(v => v.project_id === pid).sort((a, b) => a.nr - b.nr || (a.created_at || "").localeCompare(b.created_at || ""));
const vordLocked = (v) => v.status !== "opgemaakt";
const vordVast = (v) => vordLocked(v) || !!v.vast_op;   // 1.70 (script 064): "klaar voor Yuki" = bedrag en percentages liggen vast
const isMw = (r) => r.status === "meerwerk" || r.status === "minwerk";
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
  const calcExcl = excl, calcBtw = btw;
  // Verzonden of betaald: de factuur is wat telt. Wijzigt de meetstaat nadien, dan worden de bedragen per lot en per post
  // herschaald naar het factuurbedrag — zo rekenen cumul, rest en slotfactuur met wat echt gefactureerd is (zoals het klantenportaal).
  const vast = vordVast(v) && v.bedrag_excl != null && v.bedrag_excl !== "";
  if (vast) {
    const B = Number(v.bedrag_excl);
    if (Math.abs(calcExcl) > 0.005) { const f = B / calcExcl; if (Math.abs(f - 1) > 1e-12) { Object.values(perPost).forEach(P => { P.excl *= f; P.pct *= f; }); Object.values(perLot).forEach(L => { L.excl *= f; }); } btw = calcBtw * f; }
    excl = B;
    if (v.btw_bedrag != null && v.btw_bedrag !== "") btw = Number(v.btw_bedrag);
  }
  return { excl, btw, incl: excl + btw, calcExcl, calcBtw, vast, perLot, perPost, rg };
}
const vordBedrag = (v, c) => c.excl;   /* verzonden/betaald = bevroren factuurbedrag (zie vordCalc) */
/* cumulatief per post over alle vorderingen van dezelfde soort */
function cumPost(pid, calcs, r) { return vordOf(pid).filter(v => (v.soort === "meerwerk") === isMw(r)).reduce((s, v) => s + (calcs[v.id]?.perPost[r.id]?.pct || 0), 0); }
/* bedrag → %: de regels van een vordering herschalen zodat de berekende som precies op een bedrag (excl. btw) uitkomt.
   Elke regel wordt begrensd op wat er voor die post(en) nog openstaat; lukt het niet volledig, dan geeft `tekort` het verschil. */
const regelsExcl = (rows, regels) => { const lot = {}, post = {}; regels.forEach(g => { if (g.post_id) post[g.post_id] = g; else lot[g.lot] = g; }); return rows.reduce((s, r) => { const g = post[r.id] || lot[r.lot]; return s + (g ? Number(g.pct) * rowSigned(r) : 0); }, 0); };
function fitRegels(pid, soort, regels, bedrag, calcs) {
  const rows = vordRows(pid, soort); const restOf = (r) => Math.max(0, 1 - cumPost(pid, calcs, r));
  let r1 = fitKern(pid, rows, regels, bedrag, restOf); if (!(r1.tekort > 0.005)) return { ...r1, weg: [] };
  // 1.48.4: een lot-% is begrensd door de post met het minst open; staan de posten van dat lot ongelijk, dan per post verdelen (alleen als het nodig is)
  const post = {}; regels.forEach(g => { if (g.post_id) post[g.post_id] = g; });
  const split = [], weg = [];
  r1.regels.forEach(g => { if (g.post_id) return split.push(g); const rs = rows.filter(r => r.lot === g.lot && !post[r.id] && Math.abs(rowSigned(r)) > 0.005); const rests = rs.map(restOf);
    if (rs.length > 1 && Math.max(...rests) - Math.min(...rests) > 1e-6) { if (g.id) weg.push(g); rs.forEach(r => split.push({ lot: g.lot, post_id: r.id, pct: g.pct })); } else split.push(g); });
  if (!weg.length && split.length === r1.regels.length) return { ...r1, weg: [] };
  const r2 = fitKern(pid, rows, split, bedrag, restOf); return r2.tekort < r1.tekort - 0.005 ? { ...r2, weg } : { ...r1, weg: [] };
}
function fitKern(pid, rows, regels, bedrag, restOf) {
  const post = {}; regels.forEach(g => { if (g.post_id) post[g.post_id] = g; });
  let base = regels.map(g => ({ ...g, pct: Number(g.pct) })); let excl0 = regelsExcl(rows, base);
  if (!(Math.abs(excl0) > 0.005)) { base = base.map(g => ({ ...g, pct: 1 })); excl0 = regelsExcl(rows, base); }
  if (!(Math.abs(excl0) > 0.005)) return { regels: base, excl: 0, tekort: bedrag };
  const capOf = (g) => { const rs = g.post_id ? rows.filter(r => r.id === g.post_id) : rows.filter(r => r.lot === g.lot && !post[r.id]); return rs.length ? Math.min(...rs.map(restOf)) : 1; };
  // 1.48.4: bijvullen — botst een regel op zijn maximum, dan gaat het verschil naar de regels die nog ruimte hebben (vroeger bleef het daar steken)
  const caps = base.map(capOf); const unit = base.map(g => regelsExcl(rows, [{ ...g, pct: 1 }].concat(g.post_id ? [] : base.filter(x => x.post_id).map(x => ({ ...x, pct: 0 })))));
  const f0 = bedrag / excl0;   // minwerk (negatief bedrag) niet mee omhoog trekken als er meer gefactureerd moet worden
  let out = base.map((g, i) => ({ ...g, pct: Math.max(0, Math.min(caps[i], unit[i] < 0 && bedrag > excl0 && f0 > 1 ? g.pct : g.pct * f0)) }));
  for (let k = 0; k < 25; k++) {
    const excl = out.reduce((s, g, i) => s + g.pct * unit[i], 0), nodig = bedrag - excl; if (Math.abs(nodig) < 0.005) break;
    const vrij = out.map((g, i) => i).filter(i => unit[i] > 0.005 && (nodig > 0 ? out[i].pct < caps[i] - 1e-9 : out[i].pct > 1e-9));
    if (!vrij.length) {   // geen ruimte meer bij de gewone posten: minwerk in deze factuur verlagen
      const neg = nodig > 0 ? out.map((g, i) => i).filter(i => unit[i] < -0.005 && out[i].pct > 1e-9) : []; if (!neg.length) break;
      const kan = neg.reduce((s, i) => s - out[i].pct * unit[i], 0); const f = Math.min(1, nodig / kan); neg.forEach(i => out[i].pct = Math.max(0, out[i].pct * (1 - f))); continue; }
    const som = vrij.reduce((s, i) => s + out[i].pct * unit[i], 0);
    if (som > 0.005) { const f = (som + nodig) / som; vrij.forEach(i => out[i].pct = Math.max(0, Math.min(caps[i], out[i].pct * f))); }
    else if (nodig > 0) { const ruimte = vrij.reduce((s, i) => s + (caps[i] - out[i].pct) * unit[i], 0); if (!(ruimte > 0.005)) break; const f = Math.min(1, nodig / ruimte); vrij.forEach(i => out[i].pct = Math.max(0, Math.min(caps[i], out[i].pct + (caps[i] - out[i].pct) * f))); }
    else break;
  }
  const excl = regelsExcl(rows, out); return { regels: out, excl, tekort: bedrag - excl };
}
/* 1.48.4: wat er per lot nog openstaat buiten deze vordering (calcs zonder de vordering zelf) */
const lotOpen = (pid, soort, lot, calcs) => regelsExcl(vordRows(pid, soort), restRegels(pid, soort, [lot], calcs));
/* bestaande, nog open vordering: percentages afleiden uit het ingevulde factuurbedrag */
async function vordFit(vid, naFormulier) {
  const v = S.vorderingen[vid]; if (!v || v.bedrag_excl == null || v.bedrag_excl === "") return;
  if (!naFormulier && vordLocked(v) && !confirm("Deze vordering is al verzonden of betaald. Het factuurbedrag blijft hetzelfde; enkel de verdeling in percentages over de loten en posten wordt herrekend zodat de vorderingsstaat (ook voor de klant) weer precies op het factuurbedrag uitkomt. Doorgaan?")) return;
  const bedrag = Number(v.bedrag_excl); const pid = v.project_id;
  const calcs = {}; vordOf(pid).filter(x => x.id !== vid).forEach(x => calcs[x.id] = vordCalc(x));
  let regels = Object.values(S.vordering_regels).filter(r => r.vordering_id === vid).map(r => ({ id: r.id, lot: r.lot, post_id: r.post_id, pct: Number(r.pct) }));
  if (!regels.length) { const basis = lotBasis(pid); const lots = Object.keys(basis).map(Number).filter(l => Math.abs(vordBase(basis, l, v.soort)) > 0.005); regels = restRegels(pid, v.soort, lots, calcs); }
  const fit = regels.length ? fitRegels(pid, v.soort, regels, bedrag, calcs) : { regels: [], excl: 0, tekort: bedrag };
  // 1.48.4: volstaan de loten van deze vordering niet voor het factuurbedrag, dan kies je over welke andere loten de rest gaat
  const soortR = v.soort === "meerwerk" ? "meerwerk" : "vordering"; const basis = lotBasis(pid);
  const eigenLots = [...new Set(regels.map(g => g.lot))];
  const andere = Object.keys(basis).map(Number).sort((a, b) => a - b).filter(l => !eigenLots.includes(l) && Math.abs(vordBase(basis, l, soortR)) > 0.005).map(l => ({ l, open: lotOpen(pid, soortR, l, calcs) })).filter(x => x.open > 0.5);
  if (fit.tekort > 0.5 && andere.length) { vordFitKies(v, regels, fit, calcs, andere, eigenLots); if (naFormulier) toast(`${eur(fit.tekort)} meer dan er nog openstaat voor de gekozen loten — kies over welke andere loten de rest gaat`, 7000); return; }
  if (naFormulier) return;   // nieuwe vordering: de regels zijn net bewaard, er valt niets te kiezen
  if (!fit.regels.length) return toast("Er staat niets meer open om te verdelen.");
  await vordFitBewaar(v, fit.regels, fit.weg || [], fit.tekort);
}
async function vordFitBewaar(v, nieuw, weg, tekort) {
  const vid = v.id, bedrag = Number(v.bedrag_excl);
  const mis = (e) => { render(); toast("Mislukt: " + e.message + " — kijk de verdeling van deze vordering na", 8000); };
  for (const g of nieuw) {   // eerst bewaren/toevoegen, pas daarna weghalen (een fout halverwege laat geen loten weg)
    if (g.id) { const { data, error } = await sb.from("vordering_regels").update({ pct: g.pct }).eq("id", g.id).select().single(); if (error) return mis(error); S.vordering_regels[rowKey("vordering_regels", data)] = data; }
    else { const { data, error } = await sb.from("vordering_regels").insert({ vordering_id: vid, lot: g.lot, post_id: g.post_id || null, pct: g.pct }).select().single(); if (error) return mis(error); S.vordering_regels[rowKey("vordering_regels", data)] = data; }
  }
  if (weg.length) { const { error } = await sb.from("vordering_regels").delete().in("id", weg.map(g => g.id)); if (error) return mis(error); const ids = new Set(weg.map(g => g.id)); Object.keys(S.vordering_regels).forEach(k => { if (ids.has(S.vordering_regels[k].id)) delete S.vordering_regels[k]; }); }
  // verstuurde factuur zonder (geldige) bevroren btw: de databank berekent ze nu opnieuw op de nieuwe verdeling
  if (vordLocked(v) && (v.btw_bedrag == null || (Number(v.btw_bedrag) === 0 && Math.abs(bedrag) > 0.005))) await dbUpdate("vorderingen", vid, { btw_bedrag: null }).catch(() => { });
  render(); toast(Math.abs(tekort) > 0.5 ? `Percentages op het maximum gezet — ${eur(tekort)} meer dan er nog openstaat voor deze loten` : `Percentages afgeleid uit ${eur(bedrag)}`, Math.abs(tekort) > 0.5 ? 8000 : undefined);
}
/* 1.48.4: kiezer — eerst de aangevinkte loten van de vordering tot hun maximum, het verschil over de gekozen andere loten (naar wat er per lot openstaat) */
function vordFitKies(v, regels, fit, calcs, andere, eigenLots) {
  const pid = v.project_id, bedrag = Number(v.bedrag_excl), soortR = v.soort === "meerwerk" ? "meerwerk" : "vordering";
  const eigen = eigenLots.sort((a, b) => a - b).map(l => ({ l, open: lotOpen(pid, soortR, l, calcs) }));
  const rij = (x, aan, naam) => `<label class="chk"><input type="checkbox" name="${naam}" value="${x.l}" ${aan ? "checked" : ""}> <span>${esc(lotName(x.l))}<small class="muted" style="display:block">nog open ${eur2(x.open)}</small></span></label>`;
  openModal(`Factuurbedrag verdelen — ${v.nr === 0 ? "voorschot" : "#" + v.nr}${v.omschrijving ? " " + v.omschrijving : ""}`, `<div class="form-grid">
    <div class="field span2"><p style="margin:0">De factuur is <b>${eur2(bedrag)}</b> excl. btw, maar in ${eigen.length ? `de loten van deze vordering staat nog maar <b>${eur2(eigen.reduce((s, x) => s + x.open, 0))}</b>` : "deze vordering staan nog geen loten"} open. Kies over welke andere loten het verschil gaat. De loten van de vordering worden eerst tot hun maximum gevuld, de rest wordt over de gekozen loten verdeeld naar verhouding van wat er per lot nog openstaat. Nadien kan je per lot of per post bijsturen in de tabel.</p>${vordLocked(v) ? `<p style="margin:8px 0 0;color:var(--warn)">Deze factuur is al ${v.status === "betaald" ? "betaald" : "verzonden"}: ook de klant ziet dan deze nieuwe verdeling over de loten.</p>` : ""}</div>
    ${eigen.length ? `<div class="field span2"><label>Loten van deze vordering (vink af om ze eruit te halen)</label><div class="fase-list">${eigen.map(x => rij(x, true, "fk_eigen")).join("")}</div></div>` : ""}
    <div class="field span2"><label>Andere loten met een open bedrag</label><div class="fase-list">${andere.map(x => rij(x, false, "fk_lot")).join("")}</div></div>
    <div class="field span2"><div id="fk_sam" class="muted"></div></div></div>`, {
    saveLabel: "Verdelen", wide: true,
    onSave: async () => {
      const f = $("#mform"); const kies = (n) => [...f.querySelectorAll(`input[name="${n}"]:checked`)].map(i => Number(i.value));
      const houd = kies("fk_eigen"), extra = kies("fk_lot");
      const r = vordFitPlan(v, regels, calcs, houd, extra);
      if (!r.nieuw.length) { toast("Vink minstens één lot aan."); return false; }
      await vordFitBewaar(v, r.nieuw, r.weg, r.tekort);
    },
  });
  const f = $("#mform");
  const sam = () => { const kies = (n) => [...f.querySelectorAll(`input[name="${n}"]:checked`)].map(i => Number(i.value)); const houd = kies("fk_eigen"), extra = kies("fk_lot");
    const open = eigen.filter(x => houd.includes(x.l)).concat(andere.filter(x => extra.includes(x.l))).reduce((s, x) => s + x.open, 0);
    $("#fk_sam").innerHTML = open + 0.5 >= bedrag ? `Gekozen loten: ${eur2(open)} open — volstaat voor ${eur2(bedrag)}.` : `<span style="color:var(--warn)">Gekozen loten: ${eur2(open)} open — nog ${eur2(bedrag - open)} te kort voor ${eur2(bedrag)}.</span>`; };
  f.addEventListener("change", sam); sam();
}
/* plan: behouden regels eerst tot het bedrag (bijvullen tot hun maximum), het tekort over de nieuwe loten */
function vordFitPlan(v, regels, calcs, houd, extra) {
  const pid = v.project_id, bedrag = Number(v.bedrag_excl), soortR = v.soort === "meerwerk" ? "meerwerk" : "vordering";
  const blijft = regels.filter(g => houd.includes(g.lot)), weg = regels.filter(g => g.id && !houd.includes(g.lot));
  let nieuw = [], tekort = bedrag;
  if (blijft.length) { const a = fitRegels(pid, v.soort, blijft, bedrag, calcs); nieuw = a.regels; tekort = a.tekort; weg.push(...a.weg); }
  // nieuwe loten: enkel wat echt gebruikt wordt (geen regels van 0 %)
  if (extra.length && tekort > 0.005) { const rr = restRegels(pid, soortR, extra, calcs); if (rr.length) { const b = fitRegels(pid, v.soort, rr, tekort, calcs); nieuw = nieuw.concat(b.regels.filter(g => g.pct > 1e-9)); tekort = b.tekort; } }
  return { nieuw, weg, tekort };
}
function vFacturatie(p) {
  if (S.prijsFout) return `<div class="panel"><div class="empty"><b>Prijzen niet correct geladen</b>Herlaad de pagina (⌘⌥R) — tot dan worden er geen bedragen getoond om fouten te vermijden.</div></div>`;
  if (!msReady()) return `<div class="panel"><div class="empty"><b>Facturatie nog niet beschikbaar</b>Voer eerst databasescript <code>sql/007_meetstaat.sql</code> uit.</div></div>`;
  const beheer = isBeheer(); const basis = lotBasis(p.id); const vs = vordOf(p.id); const calcs = {}; vs.forEach(v => calcs[v.id] = vordCalc(v));
  const lots = Object.keys(basis).map(Number).sort((a, b) => a - b);
  const contract = lots.reduce((s, l) => s + basis[l].offerte, 0), meerwerk = lots.reduce((s, l) => s + basis[l].meerwerk, 0);
  const gefact = vs.filter(vordLocked).reduce((s, v) => s + vordBedrag(v, calcs[v.id]), 0);
  const betaald = vs.filter(v => v.status === "betaald").reduce((s, v) => s + vordBedrag(v, calcs[v.id]), 0);
  const open = vs.filter(v => !vordLocked(v)).reduce((s, v) => s + calcs[v.id].excl, 0);
  const kpi = `<div class="rend">
    <div class="panel"><div class="k">Contract excl. btw</div><div class="v">${eur2(contract)}</div></div>
    <div class="panel"><div class="k">Meer-/minwerk</div><div class="v ${meerwerk < 0 ? "neg" : ""}">${meerwerk ? eur2(meerwerk) : "—"}</div></div>
    <div class="panel"><div class="k">Gefactureerd excl. btw</div><div class="v">${eur2(gefact)}</div><div class="muted" style="font-size:12px">${contract + meerwerk ? nl(gefact / (contract + meerwerk) * 100, 0) : 0} % · betaald ${eur2(betaald)}</div></div>
    <div class="panel"><div class="k">Op te maken</div><div class="v">${open ? eur2(open) : "—"}</div></div>
    <div class="panel"><div class="k">Nog te factureren</div><div class="v ${contract + meerwerk - gefact - open < -0.5 ? "neg" : ""}">${eur2(contract + meerwerk - gefact - open)}</div></div></div>`;
  const zonderHoev = msRows(p.id).filter(r => msTelt(r) && !(Number(r.hoeveelheid) > 0) && Number(r.eenheidsprijs) > 0);
  const waarschuwing = zonderHoev.length ? `<div class="banner show" style="border:1px solid var(--line);border-radius:8px;margin-bottom:16px">${zonderHoev.length} post${zonderHoev.length > 1 ? "en" : ""} in de meetstaat ${zonderHoev.length > 1 ? "hebben" : "heeft"} wel een prijs maar nog geen hoeveelheid (${zonderHoev.slice(0, 3).map(r => esc(r.code + " " + r.omschrijving.slice(0, 30))).join(", ")}${zonderHoev.length > 3 ? ", …" : ""}) — die tellen voor € 0 mee in het contract. Vul de hoeveelheid in op het tabblad Meetstaat.</div>` : "";
  if (!lots.length || contract + Math.abs(meerwerk) < 0.005) return kpi + waarschuwing + `<div class="panel" style="margin-bottom:16px"><div class="empty"><b>${lots.length ? "Het contract staat op € 0" : "Nog geen meetstaat"}</b>${lots.length ? "De vorderingsstaat rekent op hoeveelheid × prijs van de posten in de meetstaat; vul eerst de hoeveelheden in." : "Maak eerst de meetstaat op (tabblad Meetstaat); de vorderingsstaat rekent op de loten en posten daarvan."}</div></div>` + (typeof vAfPanel === "function" ? vAfPanel(p) : "");
  const heeftVoorschot = vs.some(v => v.soort === "voorschot");
  S.vordOpen = S.vordOpen || {};
  const pctFmt = (x) => Math.round(x * 10000) / 100; /* 2 decimalen: na "Percentages herrekenen" zijn de percentages niet rond (31,33 %) en moet % × basis het getoonde bedrag geven */
  const pctTxt = (x) => nl(pctFmt(x), 2) + " %";
  /* cel voor een lot: invoerveld als het lot-% geldt, anders het gewogen % (per post ingesteld) */
  const lotCell = (v, lot, soort) => { const c = calcs[v.id]; const base = vordBase(basis, lot, soort); if ((v.soort === "meerwerk") !== (soort === "meerwerk") || !base) return `<td class="c muted">·</td>`;
    const L = c.perLot[lot]; const overrides = vordRows(p.id, soort).some(r => r.lot === lot && c.rg.post[r.id]); const lotPct = c.rg.lot[lot] ? Number(c.rg.lot[lot].pct) : null;
    const amt = L ? L.excl : 0; const w = base ? amt / base : 0;
    if (overrides || vordVast(v) || !beheer) return `<td class="c num">${(L || lotPct != null) ? pctTxt(w) : ""}${overrides ? `<small class="muted" style="display:block">per post</small>` : ""}<small class="muted" style="display:block">${L ? eur2(amt) : ""}</small></td>`;
    return `<td class="c"><input class="inline num" style="width:58px;text-align:right" data-vr="${v.id}" data-lot="${lot}" type="text" inputmode="decimal" autocomplete="off" value="${getalVeld(lotPct == null ? "" : pctFmt(lotPct))}" placeholder="0"> <span class="muted">%</span><small class="muted" style="display:block">${L ? eur2(amt) : ""}</small></td>`; };
  const postCell = (v, r) => { const c = calcs[v.id]; if ((v.soort === "meerwerk") !== isMw(r)) return `<td class="c muted">·</td>`; const P = c.perPost[r.id]; const own = !!c.rg.post[r.id];
    if (vordVast(v) || !beheer) return `<td class="c num">${P ? pctTxt(P.pct) : ""}<small class="muted" style="display:block">${P ? eur2(P.excl) : ""}</small></td>`;
    return `<td class="c"><input class="inline num ${own ? "" : "muted"}" style="width:58px;text-align:right" data-vr="${v.id}" data-lot="${r.lot}" data-vpost="${r.id}" type="text" inputmode="decimal" autocomplete="off" value="${P ? getalVeld(pctFmt(P.pct)) : ""}" placeholder="0" title="${own ? "eigen % voor deze post" : "volgt het lot-%"}"> <span class="muted">%</span><small class="muted" style="display:block">${P ? eur2(P.excl) : ""}</small></td>`; };
  const lotRows = (soort) => lots.filter(l => Math.abs(vordBase(basis, l, soort)) > 0.005).map(l => { const base = vordBase(basis, l, soort); const rows = vordRows(p.id, soort).filter(r => r.lot === l); const inv = vs.reduce((s, v) => s + (calcs[v.id].perLot[l]?.excl || 0) * ((v.soort === "meerwerk") === (soort === "meerwerk") ? 1 : 0), 0); const cum = base ? inv / base : 0; const rest = base - inv; const key = soort + l; const openL = !!S.vordOpen[key];
    return `<tr class="${soort === "meerwerk" ? "ms-mw" : ""}"><td class="sticky"><button class="btn ghost sm" data-vtoggle="${key}" aria-label="Posten tonen" style="padding:0 4px">${openL ? "▾" : "▸"}</button> <b>${esc(lotName(l))}</b>${soort === "meerwerk" ? ` <span class="pill st-offerte" style="font-size:10px">meerwerk</span>` : ""}<small class="muted" style="display:block;margin-left:22px">${rows.length} posten</small></td><td class="r num">${eur2(base)}</td>${vs.map(v => lotCell(v, l, soort)).join("")}<td class="c num" style="white-space:nowrap"><b>${pctTxt(cum)}</b></td><td class="r num ${Math.abs(rest) < 0.005 ? "muted" : ""}">${eur2(rest)}</td></tr>` +
      (openL ? rows.map(r => { const amt = rowSigned(r); const invP = vs.reduce((s, v) => s + (calcs[v.id].perPost[r.id]?.excl || 0), 0); const cumP = amt ? invP / amt : 0;
        return `<tr class="vpost"><td class="sticky" style="padding-left:30px"><span class="muted num" style="font-size:11px">${esc(r.code)}</span> ${esc(r.omschrijving)}${r.locatie ? ` <small class="muted">· ${esc(r.locatie)}</small>` : ""}</td><td class="r num">${eur2(amt)}</td>${vs.map(v => postCell(v, r)).join("")}<td class="c num" style="white-space:nowrap">${pctTxt(cumP)}</td><td class="r num ${Math.abs(amt - invP) < 0.005 ? "muted" : ""}">${eur2(amt - invP)}</td></tr>`; }).join("") : ""); }).join("");
  const totRow = (label, base, f, rest) => `<tr class="tot"><td class="sticky"><b>${label}</b></td><td class="r num"><b>${eur2(base)}</b></td>${vs.map(v => `<td class="c num"><b>${eur2(f(v))}</b></td>`).join("")}<td></td><td class="r num"><b>${eur2(rest)}</b></td></tr>`;
  const sumInv = (soort) => vs.filter(v => (v.soort === "meerwerk") === (soort === "meerwerk")).reduce((s, v) => s + calcs[v.id].excl, 0);
  const head = vs.map(v => { const c = calcs[v.id]; const frozen = c.vast; const diff = frozen ? Number(v.bedrag_excl) - c.calcExcl : 0;
    return `<th class="vh"><div class="vh-top"><span class="pill st-${v.status === "betaald" ? "afgerond" : v.status === "verzonden" ? "lopend" : "offerte"}">${v.nr === 0 ? "Voorschot" : "#" + v.nr}${v.soort === "meerwerk" ? " · MW" : ""}</span>${beheer && !vordVast(v) ? `<button class="btn ghost sm danger" data-act="vord-del" data-id="${v.id}" aria-label="Verwijderen">✕</button>` : ""}</div>
      <div class="vh-body">${beheer ? `<input class="inline" data-vf="${v.id}" data-f="omschrijving" value="${esc(v.omschrijving || "")}" placeholder="${esc(VORD_SOORT[v.soort])}">` : `<div>${esc(v.omschrijving || VORD_SOORT[v.soort])}</div>`}
      <div class="vh-row"><span class="muted">Datum</span>${beheer ? `<input class="inline num" data-vf="${v.id}" data-f="datum" type="date" value="${v.datum || ""}">` : `<span class="num">${fmtLong(v.datum)}</span>`}</div>
      <div class="vh-row"><span class="muted">Yuki-nr</span>${beheer ? `<input class="inline num" data-vf="${v.id}" data-f="factuurnummer" value="${esc(v.factuurnummer || "")}" placeholder="—">` : `<span class="num">${esc(v.factuurnummer || "—")}</span>`}</div>
      ${beheer ? `<div class="vh-row"><span class="muted" title="Gestructureerde mededeling voor de betaling (komt normaal uit de Yuki-mail)">Mededeling</span><input class="inline num" data-vf="${v.id}" data-f="mededeling" value="${esc(v.mededeling || "")}" placeholder="+++…+++" style="width:150px"></div>
      <div class="vh-row"><span class="muted">Vervaldag</span><input class="inline num" data-vf="${v.id}" data-f="vervaldag" type="date" value="${v.vervaldag || ""}"></div>
      <div class="vh-row"><span class="muted" title="De factuur als pdf voor de klant (een gedeeld document van dit project)">Factuur-pdf</span><select class="inline" data-vf="${v.id}" data-f="factuur_document" style="max-width:150px"><option value="">—</option>${opts(Object.values(S.documenten).filter(d => d.project_id === p.id && /pdf/i.test(d.mime || d.naam || "")).sort((a, b) => (b.gewijzigd || "").localeCompare(a.gewijzigd || "")).map(d => [d.id, d.naam]), v.factuur_document || "")}</select></div>` : ""}
      <div class="vh-row"><span class="muted">Berekend</span><span class="num">${eur2(c.calcExcl)}</span></div>
      <div class="vh-row"><span class="muted">Btw · incl.</span><span class="num">${eur2(c.btw)} · <b>${eur2(c.incl)}</b></span></div>
      ${beheer ? `<div class="vh-row"><span class="muted" title="Bedrag op de factuur in Yuki (excl. btw) — wordt bevroren zodra de status verzonden of betaald is. Wijkt het af van de berekening, dan kan je de percentages eruit laten afleiden.">Factuur excl.</span><input class="inline num" data-vf="${v.id}" data-f="bedrag_excl" type="text" inputmode="decimal" autocomplete="off" value="${getalVeld(v.bedrag_excl)}" placeholder="${Math.round(c.calcExcl)}" ${v.vast_op && !vordLocked(v) ? "disabled" : ""}></div>` : ""}
      ${beheer && !vordLocked(v) && schemaV() >= 64 ? (v.vast_op ? `<div class="vh-row vh-yuki"><span class="pill done" title="Vastgezet ${esc(fmtLong(lokDag(v.vast_op)))}: bedrag en percentages veranderen niet meer, ook niet als de meetstaat wijzigt">🔒 Klaar voor Yuki</span></div><div class="vh-row vh-yuki"><button class="btn sm primary" data-act="vord-kopie" data-id="${v.id}" title="Klant, omschrijving en bedragen per btw-tarief kopiëren om in Yuki te plakken">Kopiëren voor Yuki</button>${yfOk() ? (v.yuki_verstuurd_op ? `<span class="pill st-lopend" title="${esc("Doorgestuurd " + fmtLong(lokDag(v.yuki_verstuurd_op)) + (v.yuki_bericht ? " — " + v.yuki_bericht : ""))}">In Yuki · te verzenden</span>` : `<button class="btn sm" data-act="vord-yuki" data-id="${v.id}" title="De factuur rechtstreeks in Yuki aanmaken (proefmodus zolang het Drive-script geen Yuki-administratie voor facturen heeft)">Naar Yuki…</button>`) : ""}<button class="btn ghost sm" data-act="vord-los" data-id="${v.id}">Losmaken</button></div>`
        : `<div class="vh-row vh-yuki"><button class="btn sm" data-act="vord-vast" data-id="${v.id}" title="Bedrag (${eur2(c.incl)} incl.) vastzetten: zo is het bedrag in Yuki altijd exact hetzelfde en koppelt het script de factuur automatisch" ${Math.abs(c.calcExcl) < 0.005 && !(v.bedrag_excl != null && v.bedrag_excl !== "") ? "disabled" : ""}>Klaar voor Yuki</button></div>`) : ""}
      ${frozen && Math.abs(diff) > 0.5 ? `<div class="vh-row" style="color:var(--warn)"><span>Verschil</span><span class="num">${eur2(diff)}</span></div>` : ""}
      ${beheer && v.bedrag_excl != null && v.bedrag_excl !== "" && Math.abs(Number(v.bedrag_excl) - c.calcExcl) > 0.5 ? `<div class="vh-row"><button class="btn ghost sm" data-act="vord-fit" data-id="${v.id}" title="De percentages van deze vordering zo herrekenen dat de berekening precies op het factuurbedrag uitkomt (verschil nu ${eur2(Number(v.bedrag_excl) - c.calcExcl)})${vordLocked(v) ? " — het factuurbedrag verandert niet, enkel de verdeling" : ""}">Percentages herrekenen op ${eur2(Number(v.bedrag_excl))}</button></div>` : ""}
      <div class="vh-row"><span class="muted">Status</span>${beheer ? `<select class="inline" data-vf="${v.id}" data-f="status">${opts(Object.entries(VORD_STATUS), v.status)}</select>` : `<span>${VORD_STATUS[v.status]}</span>`}</div></div></th>`; }).join("");
  const grid = `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Vorderingsstaat</h3><div class="muted" style="font-size:12px;margin-top:2px">Per lot het % dat je in elke vordering factureert; klap een lot open (▸) om per post te werken — een post-% overschrijft het lot-%. Het voorschot telt overal mee. Meerwerk staat apart en zit niet in het voorschot.</div></div>
      <div class="actions">${beheer ? `${heeftVoorschot ? "" : `<button class="btn sm" data-act="vord-new" data-pid="${p.id}" data-soort="voorschot">+ Voorschot</button>`}<button class="btn sm primary" data-act="vord-new" data-pid="${p.id}" data-soort="vordering">+ Vordering</button>${meerwerk ? `<button class="btn sm" data-act="vord-new" data-pid="${p.id}" data-soort="meerwerk">+ Meerwerkfactuur</button>` : ""}<button class="btn sm" data-act="vord-new" data-pid="${p.id}" data-soort="slotfactuur" title="Alles wat nog openstaat, per post">+ Slotfactuur</button>` : ""}</div></div>
    ${vs.length ? `<div class="tw"><table class="t vord"><thead><tr><th class="sticky">Lot / post</th><th class="r">Basis excl.</th>${head}<th class="c">Cumul.</th><th class="r">Rest</th></tr></thead><tbody>
      ${lotRows("vordering")}${totRow("Contract", contract, (v) => v.soort === "meerwerk" ? 0 : calcs[v.id].excl, contract - sumInv("vordering"))}
      ${meerwerk ? lotRows("meerwerk") + totRow("Meer-/minwerk", meerwerk, (v) => v.soort === "meerwerk" ? calcs[v.id].excl : 0, meerwerk - sumInv("meerwerk")) : ""}
      ${totRow("Totaal excl. btw", contract + meerwerk, (v) => calcs[v.id].excl, contract + meerwerk - sumInv("vordering") - sumInv("meerwerk"))}
      <tr class="tot"><td class="sticky"><b>Totaal incl. btw</b></td><td></td>${vs.map(v => `<td class="c num"><b>${eur2(calcs[v.id].incl)}</b></td>`).join("")}<td></td><td></td></tr></tbody></table></div>` : `<div class="empty"><b>Nog geen vorderingen</b>Begin met het voorschot (bv. 30 % op het contract), daarna een vordering per afgewerkt lot of per post.</div>`}</div>`;
  const klant = `<div class="panel"><div class="panel-head"><div><h3>Overzicht voor de klant</h3><div class="muted" style="font-size:12px;margin-top:2px">Zo ziet de klant het in het portaal: de facturen en, per lot en post, welk aandeel in welke factuur zat (cumulatief en rest) — zonder kostprijzen, berekend-versus-factuurverschillen of Yuki-details.</div></div></div>
    <div class="tw"><table class="t"><thead><tr><th>Nr</th><th>Datum</th><th>Omschrijving</th><th>Loten</th><th class="r">Excl. btw</th><th class="r">Btw</th><th class="r">Incl. btw</th><th>Status</th></tr></thead><tbody>
      ${vs.map(v => { const c = calcs[v.id]; const excl = c.excl; const btw = c.btw; const lotsTxt = v.soort === "voorschot" ? "alle loten" : Object.keys(c.perLot).filter(l => Math.abs(c.perLot[l].excl) > 0.005).map(l => lotName(Number(l))).join(", ");
        return `<tr><td class="num">${v.nr === 0 ? "V" : v.nr}</td><td class="num">${fmtLong(v.datum)}</td><td>${esc(v.omschrijving || VORD_SOORT[v.soort])}${v.factuurnummer ? `<small class="muted" style="display:block">factuur ${esc(v.factuurnummer)}</small>` : ""}</td><td class="muted" style="font-size:12px;max-width:260px">${esc(lotsTxt)}</td><td class="r num">${eur2(excl)}</td><td class="r num">${eur2(btw)}</td><td class="r num"><b>${eur2(excl + btw)}</b></td><td><span class="pill st-${v.status === "betaald" ? "afgerond" : v.status === "verzonden" ? "lopend" : "offerte"}">${VORD_STATUS[v.status]}</span></td></tr>`; }).join("") || `<tr><td class="muted" colspan="8">Nog geen facturen.</td></tr>`}
      ${(() => {   // 1.48.3: ook wat al gefactureerd en betaald is (niet enkel wat nog moet)
        const som = (lijst) => lijst.reduce((t, v) => { const c = calcs[v.id]; t.excl += c.excl; t.btw += c.btw; t.incl += c.incl; return t; }, { excl: 0, btw: 0, incl: 0 });
        const rij = (label, t, extra = "") => `<tr class="tot"><td colspan="4"><b>${label}</b>${extra}</td><td class="r num"><b>${eur2(t.excl)}</b></td><td class="r num">${eur2(t.btw)}</td><td class="r num"><b>${eur2(t.incl)}</b></td><td></td></tr>`;
        const verst = vs.filter(vordLocked), betaaldL = vs.filter(v => v.status === "betaald"), opg = vs.filter(v => !vordLocked(v));
        return (verst.length ? rij("Gefactureerd (verzonden en betaald)", som(verst), ` <span class="muted" style="font-weight:400">· ${verst.length} factu${verst.length === 1 ? "ur" : "ren"} · ${contract + meerwerk ? nl(gefact / (contract + meerwerk) * 100, 0) : 0} % van contract + meerwerk</span>`) : "")
          + (betaaldL.length ? rij("waarvan betaald", som(betaaldL)) : "")
          + (verst.length - betaaldL.length > 0 ? rij("Nog te betalen (verzonden)", som(verst.filter(v => v.status !== "betaald"))) : "")
          + (opg.length ? rij("Opgemaakt, nog niet verzonden", som(opg)) : ""); })()}
      <tr class="tot"><td colspan="4"><b>Nog te factureren (contract + meerwerk − gefactureerd/opgemaakt)</b></td><td class="r num"><b>${eur2(contract + meerwerk - gefact - open)}</b></td><td></td><td></td><td></td></tr></tbody></table></div></div>`;
  return kpi + waarschuwing + grid + (typeof vAfPanel === "function" ? vAfPanel(p) : "") + klant;   // 1.49: facturen van aannemers (af-beheer.js, script 047)
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
  /* per post invullen (vordering en meerwerk): alle posten in één tabel, per lot een veld 'alle', live totaal */
  const perPost = !isVoorschot && !isSlot;
  const pf = (x) => nl(Math.round(x * 10000) / 100, 2) + " %";
  const rowsAll = perPost ? vordRows(pid, soort).filter(r => Math.abs(rowSigned(r)) > 0.005) : [];
  const ppHtml = !perPost ? "" : `<div class="field span2 pp-wrap" hidden>
      <div class="pp-modus"><span class="muted">Wat typ je in?</span>
        <label class="chk"><input type="radio" name="pp_modus" value="factuur" checked> <span>% van de post <b>in deze factuur</b></span></label>
        <label class="chk"><input type="radio" name="pp_modus" value="totaal"> <span>% <b>klaar in totaal</b> (stand van de werken)</span></label></div>
      <div class="tw pp-tw"><table class="t pp"><thead><tr><th>Post</th><th class="r">Bedrag</th><th class="r">Al gefactureerd</th><th class="r" id="pp_kop">Deze factuur</th><th class="r">Excl. btw</th></tr></thead>
      ${lots.map(l => { const rs = rowsAll.filter(r => r.lot === l); if (!rs.length) return "";
        return `<tbody><tr class="pp-lot"><td><b>${esc(lotName(l))}</b> <small class="muted">${rs.length} post${rs.length === 1 ? "" : "en"}</small></td><td class="r num">${eur2(rs.reduce((t, r) => t + rowSigned(r), 0))}</td><td></td><td class="r" style="white-space:nowrap"><input class="inline num pp-all" data-pplot="${l}" inputmode="decimal" autocomplete="off" placeholder="alle" title="Zelfde % voor alle posten van dit lot"> %</td><td class="r num" data-pplotsum="${l}">—</td></tr>`
          + rs.map(r => { const amt = rowSigned(r), cum = cumPost(pid, calcs, r), dicht = 1 - cum < 1e-6;
            return `<tr class="${dicht ? "pp-dicht" : ""}"><td><span class="muted num" style="font-size:11px">${esc(r.code || "")}</span> ${esc(r.omschrijving)}${r.locatie ? ` <small class="muted">· ${esc(r.locatie)}</small>` : ""}</td><td class="r num">${eur2(amt)}</td><td class="r num muted">${cum > 1e-6 ? pf(cum) : "—"}</td><td class="r" style="white-space:nowrap"><input class="inline num pp-in" name="pp_${r.id}" data-pp="${r.id}" data-lot="${l}" data-amt="${amt}" data-cum="${cum}" inputmode="decimal" autocomplete="off" ${dicht ? `disabled title="Volledig gefactureerd"` : ""}> %</td><td class="r num" data-ppeur="${r.id}">—</td></tr>`; }).join("") + `</tbody>`; }).join("")}
      <tfoot><tr><td><b>Totaal deze factuur</b></td><td></td><td></td><td></td><td class="r num"><b id="pp_tot">—</b></td></tr></tfoot></table></div>
      <small class="muted">Tab of Enter springt naar de volgende post. Een veld 'alle' in de lotrij vult elke post van dat lot. Rood = meer dan wat nog openstaat (of, bij 'klaar in totaal', minder dan wat al gefactureerd is).</small></div>`;
  openModal({ voorschot: "Voorschotfactuur", vordering: "Nieuwe vordering", slotfactuur: "Slotfactuur", meerwerk: "Meerwerkfactuur" }[soort] + " — " + p.klant, `<div class="form-grid">
      <div class="field"><label for="vo_oms">Omschrijving</label><input id="vo_oms" name="omschrijving" value="${esc(isVoorschot ? "Voorschot bij ondertekening" : isSlot ? "Slotfactuur bij oplevering" : "")}" placeholder="bv. Afwerking lot 8 en 9"></div>
      <div class="field"><label for="vo_datum">Datum</label><input id="vo_datum" name="datum" type="date" value="${todayIso}"></div>
      ${isVoorschot ? `<div class="field"><label for="vo_pct">Voorschot % op het contract</label><input id="vo_pct" name="pct" type="number" step="any" min="0" max="100" value="30"></div><div class="field"><label>Contract excl. btw</label><div class="num" style="padding:8px 0">${eur(lots.reduce((s, l) => s + basis[l].offerte, 0))}</div></div>`
      : isSlot ? `<div class="field span2"><p class="muted" style="margin:0">Alles wat nog openstaat wordt gefactureerd: per post het resterende % op het contract${lots.some(l => basis[l].meerwerk) ? " (meerwerk factureer je apart via + Meerwerkfactuur)" : ""}. Nog open: <b>${eur(lots.reduce((s, l) => s + restLot(l, "vordering"), 0))}</b> excl. btw.</p></div>`
      : `<div class="field span2 vo-keuze"><div class="seg-row"><button type="button" class="btn sm primary" data-vomode="lot">Per lot</button><button type="button" class="btn sm" data-vomode="post">Per post</button></div></div>${ppHtml}<div class="field span2 vo-lot"><label>Loten die je nu factureert — het resterende % wordt voorgesteld (of vul hieronder een bedrag in); daarna per lot of per post aanpasbaar in de tabel</label><div class="fase-list">${lots.map(l => { const rest = restLot(l, soort); const base = vordBase(basis, l, soort); return `<label class="chk"><input type="checkbox" name="lot" value="${l}" ${Math.abs(rest) <= 0.005 ? "disabled" : ""}> <span>${esc(lotName(l))}<small class="muted" style="display:block">rest ${base ? nl(rest / base * 100, 0) : 0} % · ${eur(rest)}</small></span></label>`; }).join("")}</div></div>`}
      ${isSlot ? "" : `<div class="field span2 vo-lot"><label for="vo_bedrag">${isVoorschot ? "Of een bedrag excl. btw" : "Bedrag excl. btw (optioneel)"}</label><input id="vo_bedrag" name="bedrag" type="number" step="any" min="0" placeholder="${isVoorschot ? "leeg = het % hierboven" : "leeg = het resterende % van de gekozen loten"}" style="max-width:220px"><small class="muted" style="display:block;margin-top:4px">Vul je een bedrag in — bv. een factuur die al verstuurd is — dan worden de percentages zo berekend dat deze vordering precies op dat bedrag uitkomt en wordt het van de rest afgehouden.</small></div>`}
    </div>`, {
    saveLabel: "Aanmaken", wide: !isVoorschot,
    onSave: async (d) => {
      const f = $("#mform"); const modusPost = perPost && f.dataset.mode === "post";
      let regels, bedrag = null, fitMsg = "", kiesNa = false;
      if (modusPost) {
        const per = {}; let fout = 0;
        f.querySelectorAll(".pp-in").forEach(inp => { const x = ppInc(inp); if (x === 0) return; if (ppBad(inp, x)) { fout++; return; } (per[inp.dataset.lot] = per[inp.dataset.lot] || []).push({ id: inp.dataset.pp, pct: x }); });
        if (fout) { toast(`${fout} post${fout > 1 ? "en hebben" : " heeft"} een ongeldig percentage (in het rood).`, 6000); return false; }
        regels = [];
        Object.entries(per).forEach(([l, arr]) => { const lot = Number(l), alle = rowsAll.filter(r => r.lot === lot);
          if (arr.length === alle.length && arr.every(a => Math.abs(a.pct - arr[0].pct) < 1e-9)) regels.push({ lot, post_id: null, pct: arr[0].pct });   // overal hetzelfde: één lot-%
          else arr.forEach(a => regels.push({ lot, post_id: a.id, pct: a.pct })); });
        if (!regels.length) { toast("Vul bij minstens één post een percentage in."); return false; }
      } else {
      const sel = isVoorschot || isSlot ? lots : [...$("#mform").querySelectorAll('input[name="lot"]:checked')].map(i => Number(i.value));
      if (!sel.length) { toast("Kies minstens één lot."); return false; }
      regels = isVoorschot ? sel.map(l => ({ lot: l, post_id: null, pct: (Number(d.pct) || 0) / 100 })) : restRegels(pid, isSlot ? "vordering" : soort, sel, calcs);
      if (!regels.length) { toast("Er staat niets meer open voor deze loten."); return false; }
      bedrag = d.bedrag == null || String(d.bedrag).trim() === "" ? null : Number(String(d.bedrag).replace(",", "."));
      if (bedrag != null && !isSlot) { if (!(bedrag > 0)) { toast("Vul een bedrag groter dan 0 in, of laat het veld leeg."); return false; } const fit = fitRegels(pid, soort, regels, bedrag, calcs); regels = fit.regels; if (Math.abs(fit.tekort) > 0.5) { fitMsg = ` — let op: ${eur(fit.tekort)} meer dan er nog openstaat voor deze loten; percentages op het maximum gezet`; kiesNa = fit.tekort > 0.5; } else fitMsg = ` — percentages afgeleid uit ${eur(bedrag)}`; }
      }
      const { data: v, error } = await sb.from("vorderingen").insert({ project_id: pid, nr: nextNr, soort, omschrijving: d.omschrijving.trim(), datum: d.datum || null, status: "opgemaakt", bedrag_excl: bedrag }).select().single();
      if (error) { toast("Mislukt: " + error.message); return false; }
      S.vorderingen[v.id] = v;
      const r2 = await sb.from("vordering_regels").insert(regels.map(r => ({ vordering_id: v.id, lot: r.lot, post_id: r.post_id, pct: r.pct }))).select();
      if (r2.error) { toast("Regels niet bewaard: " + r2.error.message + (/post_id/.test(r2.error.message) ? " — voer sql/008_vordering_posten.sql uit" : "")); } else (r2.data || []).forEach(r => S.vordering_regels[rowKey("vordering_regels", r)] = r);
      render(); toast(`${VORD_SOORT[soort]} aangemaakt${fitMsg}`, kiesNa ? 7000 : undefined);
      if (kiesNa && !r2.error) setTimeout(() => vordFit(v.id, true), 80);   // 1.48.4: meteen de lotkiezer (na het sluiten van dit formulier)
    },
  });
  if (!perPost) return;
  const f = $("#mform"); f.dataset.mode = "lot";
  const modus = () => f.querySelector('[name="pp_modus"]:checked').value;
  const parse = (v) => { const t = String(v || "").replace(",", ".").replace("%", "").trim(); if (!t) return null; const x = Number(t); return isFinite(x) ? x / 100 : NaN; };
  const ins = [...f.querySelectorAll(".pp-in")]; const eurCel = {}; f.querySelectorAll("[data-ppeur]").forEach(td => eurCel[td.dataset.ppeur] = td);
  ppInc = (inp) => { const v = parse(inp.value); if (v == null) return 0; if (isNaN(v)) return NaN; return modus() === "totaal" ? v - Number(inp.dataset.cum) : v; };
  ppBad = (inp, x) => isNaN(x) || x < -1e-9 || x > Math.max(0, 1 - Number(inp.dataset.cum)) + 1e-6;
  const recalc = () => { let tot = 0; const lotSum = {};
    ins.forEach(inp => { const x = ppInc(inp), bad = !!inp.value.trim() && ppBad(inp, x); inp.classList.toggle("bad", bad); const e = !bad && x ? x * Number(inp.dataset.amt) : 0; eurCel[inp.dataset.pp].textContent = e ? eur2(e) : "—"; tot += e; lotSum[inp.dataset.lot] = (lotSum[inp.dataset.lot] || 0) + e; });
    f.querySelectorAll("[data-pplotsum]").forEach(td => { const v = lotSum[td.dataset.pplotsum] || 0; td.textContent = v ? eur2(v) : "—"; }); $("#pp_tot").textContent = eur2(tot); };
  f.addEventListener("input", (e) => { const t = e.target;
    if (t.classList.contains("pp-all")) ins.filter(i => i.dataset.lot === t.dataset.pplot && !i.disabled).forEach(i => i.value = t.value);
    if (t.classList.contains("pp-in") || t.classList.contains("pp-all")) recalc(); });
  f.querySelectorAll('[name="pp_modus"]').forEach(rb => rb.addEventListener("change", () => {
    const naarTotaal = modus() === "totaal"; $("#pp_kop").textContent = naarTotaal ? "Klaar in totaal" : "Deze factuur";
    ins.forEach(i => { const v = parse(i.value); if (v == null || isNaN(v)) return; const n = naarTotaal ? v + Number(i.dataset.cum) : v - Number(i.dataset.cum); i.value = String(Math.round(n * 10000) / 100).replace(".", ","); });
    f.querySelectorAll(".pp-all").forEach(a => a.value = ""); recalc(); }));
  f.addEventListener("keydown", (e) => { if (e.key !== "Enter" || !e.target.matches(".pp-in,.pp-all")) return; e.preventDefault();
    const alle = [...f.querySelectorAll(".pp-all,.pp-in")].filter(i => !i.disabled); const k = alle.indexOf(e.target); if (alle[k + 1]) { alle[k + 1].focus(); alle[k + 1].select(); } });
  f.querySelectorAll("[data-vomode]").forEach(b => b.onclick = () => { const post = b.dataset.vomode === "post"; f.dataset.mode = post ? "post" : "lot";
    f.querySelectorAll("[data-vomode]").forEach(x => x.classList.toggle("primary", x === b)); f.querySelectorAll(".vo-lot").forEach(x => x.hidden = post); f.querySelector(".pp-wrap").hidden = !post;
    if (post) { const eerste = ins.find(i => !i.disabled); if (eerste) eerste.focus(); } });
  recalc();
}
let ppInc = () => 0, ppBad = () => false;
/* % wijzigen: op lot-niveau (post_id leeg → post-regels van dat lot worden gewist) of op post-niveau */
async function vordEditPct(vid, lot, raw, postId) {
  const v = S.vorderingen[vid]; if (!v || vordVast(v)) return;
  const n = leesGetal(raw); if (Number.isNaN(n)) { toast(`"${raw}" is geen geldig percentage`, 5000); render(); return; }
  if (n != null && (n < 0 || n > 100)) { toast("Geef een percentage tussen 0 en 100", 5000); render(); return; }
  const P = 1e9; const pct = n == null ? null : Math.round(n / 100 * P) / P;
  if (pct) {   // samen met de andere vorderingen van dezelfde soort nooit ongemerkt meer dan 100 % factureren
    const calcs = {}; vordOf(v.project_id).filter(x => x.id !== vid).forEach(x => calcs[x.id] = vordCalc(x));
    const rows = vordRows(v.project_id, v.soort).filter(r => postId ? r.id === postId : r.lot === lot);
    const over = rows.map(r => ({ r, al: cumPost(v.project_id, calcs, r) })).filter(x => x.al + pct > 1 + 1e-6);
    if (over.length && !confirm(`Met ${nl(n, 2)} % wordt ${over.length === 1 ? `post ${over[0].r.code}` : `bij ${over.length} posten`} meer dan 100 % gefactureerd (al ${nl(over[0].al * 100, 2)} % in andere vorderingen). Toch bewaren?`)) { render(); return; }
  }
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
  if (f === "bedrag_excl") { const n = duizendKeuze(raw, leesGetal(raw)); if (Number.isNaN(n)) { toast(`"${raw}" is geen geldig bedrag`, 5000); render(); return; } val = n == null ? null : r2(n); }
  if (f === "datum" || f === "vervaldag" || f === "factuur_document") val = raw || null;
  if (f === "mededeling") { const o = ogmLees(raw); if (Number.isNaN(o)) { toast(`"${raw}" is geen geldige gestructureerde mededeling (12 cijfers met een kloppend controlegetal)`, 6000); render(); return; } val = o; }
  if (f === "factuur_document" && val) { const d = S.documenten[val]; if (d && !d.gedeeld && !confirm(`"${d.naam}" is nog niet gedeeld met de klant. Nu delen, zodat de klant de factuur in het portaal kan openen?`)) { render(); return; } if (d && !d.gedeeld) await docShare(d.id, true).catch(() => { }); }
  const heeftB = v.bedrag_excl != null && v.bedrag_excl !== "";
  if (f === "bedrag_excl" ? (val == null ? !heeftB : heeftB && Math.abs(Number(v.bedrag_excl) - val) < 0.005) : String(v[f] ?? "") === String(val ?? "")) return;
  if (S.prijsFout && (f === "status" || f === "bedrag_excl")) { toast("De prijzen zijn niet correct geladen — herlaad de pagina (⌘⌥R) vóór je een factuur verstuurt.", 6000); render(); return; }
  const patch = { [f]: val }; const btwKol = true; const c = vordCalc(v);
  const btwVoor = (B) => Math.abs(c.calcExcl) > 0.005 ? r2(c.calcBtw * B / c.calcExcl) : Math.abs(B) < 0.005 ? 0 : null;   // btw volgens de tarieven van de posten, op het factuurbedrag (nog geen percentages → later)
  if (f === "status" && val !== "opgemaakt" && (!vordLocked(v) || (btwKol && v.btw_bedrag == null))) {
    const B = heeftB ? Number(v.bedrag_excl) : r2(c.calcExcl);
    if (!heeftB) patch.bedrag_excl = B;   // bevriezen op het berekende bedrag
    if (btwKol) patch.btw_bedrag = btwVoor(B);   // en de btw mee bevriezen (wijzigt de meetstaat nadien, dan blijft de factuur gelijk)
  }
  if (f === "status" && val === "opgemaakt" && vordLocked(v)) {
    if (btwKol) patch.btw_bedrag = null;
    if (heeftB && confirm(`De factuur gaat terug naar 'Op te maken'. Het bevroren factuurbedrag (${eur2(v.bedrag_excl)}) ook wissen, zodat het opnieuw uit de percentages berekend wordt?\n\nOK = wissen · Annuleren = bewaren (bv. om de percentages erop af te stemmen)`)) patch.bedrag_excl = null;
  }
  if (f === "bedrag_excl" && vordLocked(v)) {
    if (val == null) { toast("Een verzonden of betaalde factuur moet een bedrag hebben", 5000); render(); return; }
    if (!confirm(`Deze factuur is al ${VORD_STATUS[v.status].toLowerCase()}. Het factuurbedrag wijzigen van ${eur2(v.bedrag_excl)} naar ${eur2(val)} excl. btw?\n\nDoe dit enkel als het bedrag in Yuki ook zo is. De btw wordt mee herrekend en het klantenportaal toont het nieuwe bedrag.`)) { render(); return; }
    if (btwKol) patch.btw_bedrag = btwVoor(val);
  }
  await dbUpdate("vorderingen", vid, patch).catch(() => { });
}
/* gegevens voor het tabblad VORDERINGSSTAAT in de Excel-export (klantversie: bevroren bedragen, geen kostprijzen) */
function vordExportData(p) {
  const vs = vordOf(p.id); if (!vs.length) return null;
  const basis = lotBasis(p.id); const lots = Object.keys(basis).map(Number).sort((a, b) => a - b); const calcs = {}; vs.forEach(v => calcs[v.id] = vordCalc(v));
  const list = vs.map(v => { const c = calcs[v.id]; const excl = c.excl; const btw = c.btw;
    return { nr: v.nr, soort: v.soort, datum: fmtLong(v.datum), omschrijving: v.omschrijving || VORD_SOORT[v.soort], factuurnummer: v.factuurnummer || "", loten: v.soort === "voorschot" ? "alle loten" : Object.keys(c.perLot).filter(l => Math.abs(c.perLot[l].excl) > 0.005).map(l => lotName(Number(l))).join(", "), excl: Math.round(excl * 100) / 100, btw: Math.round(btw * 100) / 100, incl: Math.round((excl + btw) * 100) / 100, status: VORD_STATUS[v.status] || v.status }; });
  const loten = [];
  ["vordering", "meerwerk"].forEach(soort => lots.forEach(l => { const base = vordBase(basis, l, soort); if (Math.abs(base) < 0.005) return;
    loten.push({ naam: lotName(l), basis: base, meerwerk: soort === "meerwerk", pcts: vs.map(v => (v.soort === "meerwerk") !== (soort === "meerwerk") ? null : (calcs[v.id].perLot[l] ? calcs[v.id].perLot[l].excl / base : null)) });
    vordRows(p.id, soort).filter(r => r.lot === l).forEach(r => loten.push({ naam: "   " + r.code + " " + r.omschrijving + (r.locatie ? " · " + r.locatie : ""), basis: rowSigned(r), meerwerk: soort === "meerwerk", post: true, pcts: vs.map(v => (v.soort === "meerwerk") !== (soort === "meerwerk") ? null : (calcs[v.id].perPost[r.id]?.pct ?? null)) })); }));
  return { list, loten, contract: lots.reduce((s, l) => s + basis[l].offerte, 0), meerwerk: lots.reduce((s, l) => s + basis[l].meerwerk, 0) };
}
/* 1.70 (script 064): klaar voor Yuki — het bedrag (zoals nu getoond) en de btw vastzetten; losmaken zet het terug op berekend */
async function vordVastzetten(vid, aan) {
  const v = S.vorderingen[vid]; if (!v || vordLocked(v)) return;
  if (S.prijsFout) { toast("De prijzen zijn niet correct geladen — herlaad de pagina vóór je een factuur vastzet.", 6000); return; }
  if (!aan) {
    if (!confirm(`${VORD_SOORT[v.soort]}${v.nr ? " #" + v.nr : ""} losmaken? Het bedrag wordt weer berekend uit de percentages en de meetstaat.\n\nStaat de factuur al in Yuki, laat ze dan vast: anders koppelt het script ze misschien niet meer automatisch.`)) return;
    await dbUpdate("vorderingen", vid, { vast_op: null, bedrag_excl: null, btw_bedrag: null }).catch(() => { }); toast("Losgemaakt"); return;
  }
  const c = vordCalc(v); const heeftB = v.bedrag_excl != null && v.bedrag_excl !== "";
  const B = heeftB ? Number(v.bedrag_excl) : r2(c.calcExcl);
  if (Math.abs(B) < 0.005) { toast("Deze vordering heeft nog geen bedrag: vul eerst de percentages in."); return; }
  const btw = Math.abs(c.calcExcl) > 0.005 ? r2(c.calcBtw * B / c.calcExcl) : 0;
  if (heeftB && Math.abs(B - c.calcExcl) > 0.5 && !confirm(`Het ingevulde factuurbedrag (${eur2(B)}) verschilt van de berekening (${eur2(c.calcExcl)}). Vastzetten op ${eur2(B)} excl. btw?\n\nTip: met "Percentages herrekenen" stemt de vorderingsstaat precies af op dat bedrag.`)) return;
  await dbUpdate("vorderingen", vid, { vast_op: new Date().toISOString(), bedrag_excl: B, btw_bedrag: btw }).catch(() => { });
  toast(`Klaar voor Yuki: ${eur2(B)} excl. + ${eur2(btw)} btw = ${eur2(B + btw)}`, 5000);
}
/* klant, omschrijving en bedragen per btw-tarief op het klembord, om in Yuki te plakken */
/** bedragen per btw-tarief, opgeteld tot exact het (vastgezette) factuurbedrag + de omschrijving zoals in Yuki */
function vordYukiRegels(v) {
  const p = S.projecten[v.project_id] || {}; const c = vordCalc(v); const per = {};
  vordRows(v.project_id, v.soort).forEach(r => { const P = c.perPost[r.id]; if (!P) return; const t = Math.round((Number(r.btw) || 0) * 100); per[t] = (per[t] || 0) + P.excl; });
  const tarieven = Object.keys(per).map(Number).sort((a, b) => a - b).filter(t => Math.abs(per[t]) > 0.005);
  const som = tarieven.reduce((s, t) => s + r2(per[t]), 0); if (tarieven.length) per[tarieven.at(-1)] += c.excl - som;   // afronding: optellen tot exact het factuurbedrag
  const omschrijving = `${(v.nr === 0 ? "Voorschot" : (VORD_SOORT[v.soort] || "Vordering") + " " + v.nr)}${v.omschrijving ? " — " + v.omschrijving : ""}${p.nummer ? " (project " + p.nummer + ")" : ""}`;
  return { c, per, tarieven, omschrijving };
}
async function vordKopieYuki(vid) {
  const v = S.vorderingen[vid]; const p = v && S.projecten[v.project_id]; if (!v || !p) return;
  const { c, per, tarieven } = vordYukiRegels(v);
  const bt = (n) => Number(n).toLocaleString("nl-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const regels = [`Klant: ${p.klant || ""}${p.bedrijf && p.bedrijf !== p.klant ? " (" + p.bedrijf + ")" : ""}`, `Project: ${p.nummer ? p.nummer + " · " : ""}${projName(p)}`,
    `Omschrijving: ${vordYukiRegels(v).omschrijving}`]
    .concat(tarieven.length > 1 ? tarieven.map(t => `Bedrag ${t} % btw: € ${bt(r2(per[t]))} excl.`) : [])
    .concat([`Totaal excl. btw: € ${bt(c.excl)}${tarieven.length === 1 ? " (" + tarieven[0] + " % btw)" : ""}`, `Btw: € ${bt(c.btw)}`, `Totaal incl. btw: € ${bt(c.excl + c.btw)}`]);
  const tekst = regels.join("\n");
  try { await navigator.clipboard.writeText(tekst); toast("Gekopieerd — plak het in Yuki. Vermeld het projectnummer in de omschrijving: zo herkent het script de factuur.", 6000); }
  catch (e) { prompt("Kopieer deze tekst (Ctrl/⌘ C):", tekst); }
}
/* ---------- 1.73: rechtstreeks factureren in Yuki (Drive-script, actie yukifactuur) ----------
   Proefmodus: zolang het Drive-script geen YUKI_FACTUUR_ADMIN_ID heeft, gaat er niets naar Yuki en toont het Planbord
   wat Yuki zou krijgen. Daarna: de factuur komt in Yuki bij "Te verzenden" (Process = false) — jij verwerkt ze in Yuki. */
const yfOk = () => schemaV() >= 66 && isBeheer() && typeof driveReady === "function" && driveReady();
async function vordNaarYuki(vid) {
  const v = S.vorderingen[vid]; const p = v && S.projecten[v.project_id]; if (!v || !p || !v.vast_op || vordLocked(v)) return;
  const { per, tarieven, omschrijving } = vordYukiRegels(v);
  const regels = tarieven.map(t => ({ tarief: t, excl: r2(per[t]) }));
  if (!regels.length) { toast("Deze vordering heeft geen bedragen per btw-tarief."); return; }
  loader.start("yuki.factuur", "Factuur voorbereiden voor Yuki…", 6000);
  let j; try { j = await driveCall("yukifactuur", { id: vid, regels, omschrijving }); loader.done("yuki.factuur"); }
  catch (e) { loader.fail(); toast("Yuki: " + e.message, 8000); return; }
  if (j.proef) {
    yfProefTonen(j);
    return;
  }
  toast(`In Yuki aangemaakt bij "Te verzenden"${j.bericht ? " — " + j.bericht : ""}. Verwerk ze in Yuki; het script koppelt de factuur daarna zoals gewoonlijk.`, 9000);
}
function yfProefTonen(j) {
  const html = `<p class="muted" style="font-size:13px">Er ging <b>niets</b> naar Yuki. Het Drive-script staat in proefmodus zolang de scripteigenschap <code>YUKI_FACTUUR_ADMIN_ID</code> niet ingevuld is.
      Vul daar eerst het id van een <b>proefadministratie</b> in, en pas als alles klopt dat van BROS. De factuur komt in Yuki bij <b>Te verzenden</b>: je kijkt ze na en verwerkt ze zelf.</p>
      <div class="tw"><table class="t yf-regels" style="margin:10px 0"><tbody>${(j.regels || []).map(r => `<tr><td>${esc(r.omschrijving)}</td><td class="r num">${eur2(r.excl)} excl.</td><td class="r">${esc(r.tarief)} % btw</td><td class="r muted">btw-code ${esc(r.btwcode || "— (nog in te vullen)")}</td></tr>`).join("")}</tbody></table></div>
      <p style="font-size:13px">Klant in Yuki: <b>${esc(j.klant || "")}</b>${j.klantcode ? " (code " + esc(j.klantcode) + ")" : " — zonder klantcode zoekt Yuki de klant op naam"} · factuurdatum ${esc(fmtLong(j.datum))} · vervalt ${esc(fmtLong(j.vervaldag))}</p>
      ${(j.waarschuwingen || []).length ? `<div class="notice" style="font-size:13px">${j.waarschuwingen.map(esc).join("<br>")}</div>` : ""}
      <details style="margin-top:8px"><summary class="muted" style="cursor:pointer;font-size:12px">Technisch: de xml voor Yuki</summary><pre style="max-height:240px;overflow:auto;font-size:11px;white-space:pre-wrap">${esc(j.xml || "")}</pre></details>`;
  if (typeof openModal === "function") openModal("Proef: dit zou naar Yuki gaan", html, { saveLabel: "Sluiten", wide: true, onSave: () => true }); else alert("Proef — er ging niets naar Yuki.\n\n" + (j.regels || []).map(r => r.omschrijving + ": " + r.excl + " excl. (" + r.tarief + " %)").join("\n"));
}
async function vordDel(vid) {
  const v = S.vorderingen[vid]; if (!v || vordVast(v) || !confirm(`${VORD_SOORT[v.soort]} ${v.nr ? "#" + v.nr : ""} verwijderen?`)) return;
  Object.values(S.vordering_regels).filter(r => r.vordering_id === vid).forEach(r => delete S.vordering_regels[rowKey("vordering_regels", r)]);
  await dbDelete("vorderingen", vid).catch(() => { });
}

/* export naar het Excel-sjabloon in de projectmap (Documenten/Meetstaat) */
let templateCache = null; // { name, bytes } — sjabloon één keer per sessie ophalen
