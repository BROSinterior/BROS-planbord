/* =====================================================================
   Afspraken ter plaatse (script 041) — Planbord-kant. Geladen vóór app.js (gebruikt agenda.js).
   In het taakformulier: "Afspraak ter plaatse" (werf, kantoor BROS of ander adres), uur, onderwerp en deelnemers.
   Na bewaren/verwijderen zet het Drive-script (actie 'afspraak') ze in de Google Agenda van brosburo
   ("PB/Klant, onderwerp" + adres) en mailt het de deelnemers een agendabestand. De deelnemers zien de afspraak
   in hun portaal (klant_afspraken / aan_afspraken) en zetten ze daar in hun eigen agenda.
   ===================================================================== */
const afsReady = () => typeof schemaV === "function" && schemaV() >= 41;
const AFS_PLAATS = { werf: "Op de werf", kantoor: "Op kantoor BROS", elders: "Ander adres" };
const AFS_BROS_ADRES = (window.BROS_AGENDA && window.BROS_AGENDA.BROS_ADRES) || "BROS, Kloosterstraat 165, 2000 Antwerpen";
const afsWerfAdres = (p) => p ? [p.adres, [p.postcode, p.gemeente].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";
const afsTijd = (x) => String(x || "").slice(0, 5);
/* label in de takenlijsten */
const afsTag = (t) => t && t.afspraak ? ` <span class="pill" style="background:var(--blue-soft,#e6efff);color:var(--blue,#1d5bd8)" title="${esc(AFS_PLAATS[t.afspraak] + (t.afspraak_adres ? " · " + t.afspraak_adres : ""))}${t.agenda_event_id ? " · staat in de agenda" : ""}">📍 ${esc(afsTijd(t.afspraak_van))}${t.afspraak_tot ? "–" + esc(afsTijd(t.afspraak_tot)) : ""} ${t.afspraak === "werf" ? "werf" : t.afspraak === "kantoor" ? "kantoor" : "afspraak"}</span>` : "";

/* deelnemers: klant(en) en aannemers van dit project (+ wie al aangevinkt was) */
function afsKandidaten(pid, t) {
  const pcs = (typeof contactsOf === "function" ? contactsOf(pid) : []).filter(x => x.c && x.c.actief !== false);
  const ids = new Set(pcs.map(x => x.c.id)); const extra = (t.afspraak_contacten || []).filter(id => !ids.has(id) && S.contacten[id]).map(id => ({ c: S.contacten[id], rol: "" }));
  return [...new Map([...pcs, ...extra].map(x => [x.c.id, x])).values()];
}
function afsDeelnemersHtml(pid, t) {
  const l = afsKandidaten(pid, t); const sel = new Set(t.afspraak_contacten || (t.contact_id ? [t.contact_id] : []));
  if (!l.length) return `<span class="muted" style="font-size:12px">Nog geen contacten bij dit project (Dossier › Contacten).</span>`;
  return l.map(x => `<label class="chk" style="display:flex;gap:8px;align-items:flex-start;margin:2px 0"><input type="checkbox" name="afs_c" value="${x.c.id}" ${sel.has(x.c.id) ? "checked" : ""}> <span>${esc(x.c.naam)} <small class="muted">${esc(typeof CONTACT_ROL !== "undefined" && CONTACT_ROL[x.rol] ? CONTACT_ROL[x.rol] : x.rol || x.c.soort || "")}${x.c.email ? "" : " · geen e-mail"}${x.c.user_id ? "" : " · geen portaaltoegang (enkel mail)"}</small></span></label>`).join("");
}
function afsVelden(t, pid) {
  if (!afsReady()) return "";
  const aan = !!t.afspraak; const plaats = t.afspraak || "werf";
  return `<div class="field span2" id="afs_box"><label class="sw-row"><input type="checkbox" class="sw" name="afs_aan" value="1" ${aan ? "checked" : ""}><span><b>Afspraak ter plaatse</b><small class="muted" style="display:block">Op de werf, op kantoor van BROS of een ander adres. Komt in de Google Agenda van BROS; de aangevinkte klanten en aannemers krijgen een mail met agendabestand en zien de afspraak in hun portaal.</small></span></label>
    <div id="afs_det" style="${aan ? "" : "display:none;"}margin-top:10px;padding:12px;border:1px solid var(--line);border-radius:10px"><div class="form-grid">
      <div class="field span2"><label>Waar?</label><div style="display:flex;gap:14px;flex-wrap:wrap">${Object.entries(AFS_PLAATS).map(([k, l]) => `<label class="chk" style="display:flex;gap:6px;align-items:center"><input type="radio" name="afs_plaats" value="${k}" ${plaats === k ? "checked" : ""}> ${l}</label>`).join("")}</div>
        <input id="afs_adres" name="afs_adres" value="${esc(t.afspraak === "elders" ? t.afspraak_adres || "" : "")}" placeholder="Adres (straat nr, postcode gemeente)" style="margin-top:6px">
        <small class="muted" id="afs_adres_toon"></small></div>
      <div class="field"><label for="afs_van">Van</label><input id="afs_van" type="time" name="afs_van" step="900" value="${esc(afsTijd(t.afspraak_van))}"></div>
      <div class="field"><label for="afs_tot">Tot</label><input id="afs_tot" type="time" name="afs_tot" step="900" value="${esc(afsTijd(t.afspraak_tot))}"><small class="muted">Leeg = 1 uur. De datum is de startdatum hierboven.</small></div>
      <div class="field span2"><label for="afs_ond">Onderwerp in de agenda en het portaal</label><input id="afs_ond" name="afs_onderwerp" value="${esc(t.afspraak_onderwerp || "")}" placeholder="${esc(t.titel || "bv. Bespreking voorontwerp")}"><small class="muted" id="afs_titel_toon"></small></div>
      <div class="field span2"><label>Deelnemers (klant en aannemers)</label><div id="afs_deeln">${afsDeelnemersHtml(pid, t)}</div></div>
      <div class="field span2"><label class="chk" style="display:flex;gap:8px"><input type="checkbox" name="afs_agenda" value="1" ${t.afspraak_agenda === false ? "" : "checked"}> In de Google Agenda van BROS (brosburo) zetten</label>
        <label class="chk" style="display:flex;gap:8px"><input type="checkbox" name="afs_mailen" value="1" ${t.afspraak_mailen === false ? "" : "checked"}> Deelnemers mailen bij een nieuwe, gewijzigde of geannuleerde afspraak (met agendabestand)</label>
        ${t.agenda_event_id ? `<small class="muted">Staat in de agenda van BROS.</small>` : ""}</div>
    </div></div></div>`;
}
/* initialen voor de agendatitel: "PB/Klant, onderwerp" */
const afsInitialen = (uid) => { const u = uid && S.profiles[uid]; return (u && (u.initials || (u.name || "").slice(0, 2)).toUpperCase()) || "BROS"; };
function afsWire(t) {
  const f = $("#mform"); if (!f || !f.querySelector("#afs_box")) return;
  const sync = () => {
    const aan = f.querySelector('[name="afs_aan"]').checked; f.querySelector("#afs_det").style.display = aan ? "" : "none";
    const pl = f.querySelector('[name="afs_plaats"]:checked')?.value || "werf"; const p = S.projecten[f.querySelector('[name="project_id"]').value];
    f.querySelector("#afs_adres").style.display = pl === "elders" ? "" : "none";
    const adr = pl === "werf" ? afsWerfAdres(p) : pl === "kantoor" ? AFS_BROS_ADRES : "";
    f.querySelector("#afs_adres_toon").textContent = pl === "elders" ? "" : (adr || (pl === "werf" ? "⚠ Geen werfadres bij dit project — vul het adres in bij het project of kies 'Ander adres'." : ""));
    const wie = (typeof wieSplit === "function" ? wieSplit(f.querySelector('[name="assignee"]').value) : { assignee: f.querySelector('[name="assignee"]').value }).assignee;
    f.querySelector("#afs_titel_toon").textContent = "In de agenda van BROS: " + afsInitialen(wie) + "/" + (p ? p.klant || "" : "") + ", " + (f.querySelector("#afs_ond").value.trim() || f.querySelector('[name="titel"]').value.trim());
  };
  f.addEventListener("input", sync); f.addEventListener("change", (e) => {
    if (e.target.name === "project_id") { const pid = e.target.value; f.querySelector("#afs_deeln").innerHTML = afsDeelnemersHtml(pid, { afspraak_contacten: [] }); }
    sync();
  }); sync();
}
/* uit het formulier → velden van de taak; geeft een foutmelding terug of null */
function afsUitForm(d, row, t) {
  if (!afsReady()) return null;
  const f = $("#mform");
  if (!d.afs_aan) { row.afspraak = null; return null; }
  const pl = d.afs_plaats || "werf"; const p = S.projecten[row.project_id];
  if (!row.start) return "Een afspraak heeft een datum nodig: vul de startdatum in.";
  if (!d.afs_van) return "Vul het beginuur van de afspraak in.";
  if (d.afs_tot && d.afs_tot <= d.afs_van) return "Het einduur moet na het beginuur liggen.";
  const adres = pl === "werf" ? afsWerfAdres(p) : pl === "kantoor" ? AFS_BROS_ADRES : (d.afs_adres || "").trim();
  if (!adres) return pl === "werf" ? "Dit project heeft geen werfadres. Vul het in bij het project, of kies 'Ander adres'." : "Vul het adres van de afspraak in.";
  Object.assign(row, { afspraak: pl, afspraak_van: d.afs_van, afspraak_tot: d.afs_tot || null, afspraak_adres: adres, afspraak_onderwerp: (d.afs_onderwerp || "").trim(),
    afspraak_contacten: [...f.querySelectorAll('input[name="afs_c"]:checked')].map(i => i.value), afspraak_agenda: !!d.afs_agenda, afspraak_mailen: !!d.afs_mailen, eind: row.start });
  return null;
}
/* het Drive-script bijwerken (agenda + mails) */
const AFS_VELDEN = ["afspraak", "start", "afspraak_van", "afspraak_tot", "afspraak_adres", "afspraak_onderwerp", "afspraak_contacten", "afspraak_agenda", "afspraak_mailen", "assignee", "titel", "project_id"];
async function afsSync(id, weg, stil) {
  if (!afsReady() || typeof driveReady !== "function" || !driveReady()) { if (!stil) toast("Niet in de agenda gezet: het Drive-script is niet ingesteld (Instellingen › Drive).", 7000); return null; }
  try {
    const j = await driveCall("afspraak", { id, weg: !!weg });
    const delen = [];
    if (j.agenda === "gezet") delen.push("in de agenda van BROS gezet"); else if (j.agenda === "gewijzigd") delen.push("agenda bijgewerkt"); else if (j.agenda === "verwijderd") delen.push("uit de agenda gehaald");
    if ((j.gemaild || []).length) delen.push("gemaild naar " + j.gemaild.join(", ")); if ((j.geannuleerd || []).length) delen.push("annulering gemaild naar " + j.geannuleerd.join(", "));
    if (j.waarschuwing) delen.push(j.waarschuwing);
    if (delen.length && !stil) setTimeout(() => toast("Afspraak: " + delen.join(" · "), 7000), 1200);   // na de melding "Taak bewaard"
    return j;
  } catch (e) { toast("Afspraak niet bijgewerkt in de agenda/mail: " + (e.message || e), 9000); return null; }
}
/* na elke wijziging aan een taak via dbInsert/dbUpdate (taakformulier, …) */
function afsNaWijziging(prev, nu) {
  if (!afsReady() || !nu) return;
  if (!(prev && (prev.afspraak || prev.agenda_event_id)) && !nu.afspraak) return;
  const anders = !prev || AFS_VELDEN.some(k => JSON.stringify(prev[k] ?? null) !== JSON.stringify(nu[k] ?? null));
  if (anders) afsSync(nu.id, false);
}
/* vóór het verwijderen van een taak: agenda-item weg en annulering mailen */
async function afsVoorVerwijderen(t) {
  if (!afsReady() || !t) return;
  const gemaild = t.afspraak_mail && (t.afspraak_mail.aan || []).length;
  if (!(t.agenda_event_id || gemaild || t.afspraak)) return;
  const j = await afsSync(t.id, true, true);
  if (j && j.ok !== false && !j.waarschuwing) return;
  // mislukt: niet stil verwijderen (anders blijft het agenda-item staan en krijgt niemand een annulering)
  if (!(t.agenda_event_id || gemaild)) return;
  if (!confirm(`De afspraak "${t.titel}" kon niet uit de agenda gehaald${gemaild ? " en niet geannuleerd" : ""} worden (Drive-script niet bereikbaar).\n\nToch verwijderen? Dan moet je het agenda-item zelf verwijderen${gemaild ? " en de deelnemers zelf verwittigen" : ""}.`)) throw new Error("Niet verwijderd.");
}
