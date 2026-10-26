/* =====================================================================
   BROS Planbord — Vergaderingen & opnames (script 051, v1.54)
   Per project een tabblad Vergaderingen: vergadering aanmaken (onderwerp, datum, deelnemers, controleur), een opname
   opladen (telefoon of computer), de verwerking volgen, en het AI-concept controleren: transcript met tijdsaanduidingen,
   bewerkbaar conceptverslag in de BROS-indeling, beslissingen / open vragen / actiepunten / mogelijk meerwerk / kritieke
   gegevens — elk met afspeelbaar bronfragment — en pas na bevestiging taken in de bestaande takenlijst.
   Alles wat de AI maakte, is een CONCEPT tot een bevoegde gebruiker het controleert. Er wordt nooit automatisch iets
   gewijzigd in offertes, bestellingen, meetstaten of facturatie.
   1.58: rechtstreeks opnemen via de microfoon (knop ● Opnemen, laptop en telefoon) — zelfde weg: vgOpnameOpladen(v, bestand, "microfoon").
   Laden vóór app.js.
   ===================================================================== */
const VG = { open: null, tab: "verslag", upload: {}, uitvoer: {}, uitvoerLaden: {}, versies: {}, feedback: {}, audio: {}, bewerk: null, toevoegen: null, concept: {}, zoek: "", stopBij: null, metingen: null, laatsteProject: null };
const VG_STATUS = { concept: ["Geen opname", "st-offerte"], wachtrij: ["In wachtrij", "st-lopend"], verwerking: ["Wordt verwerkt", "st-lopend"], controle: ["Klaar voor controle", "st-on_hold"], gecontroleerd: ["Gecontroleerd", "st-afgerond"], mislukt: ["Mislukt", "late"] };
const VG_SECTIE = [["beslissing", "Beslissingen", "Expliciet besloten, voorgesteld of enkel besproken — met de voorwaarden erbij."], ["vraag", "Open vragen", ""], ["actie", "Actiepunten", "Een actiepunt komt pas in de takenlijst als je het bevestigt. Ontbreekt een verantwoordelijke of deadline, dan blijft die leeg (nog te bepalen)."],
  ["meerwerk", "Mogelijk meerwerk", "Enkel ter info: er wordt niets aangepast in de offerte, meetstaat of facturatie."], ["gegeven", "Kritieke gegevens", "Bedragen, maten, hoeveelheden, namen, codes en datums: controleer elk gegeven tegen de opname, ook als er geen waarschuwing staat."]];
const VG_AARD = { besloten: ["besloten", "st-afgerond"], voorgesteld: ["voorgesteld", "st-lopend"], besproken: ["besproken", "st-offerte"] };
const vgOk = () => schemaV() >= 51 && !!S.vergaderingen;
const vgN = (x) => { const n = Number(x); return x !== null && x !== "" && isFinite(n) ? n : ""; };   // getal veilig in een attribuut of tekst
const vgTijd = (sec) => { if (sec == null || sec === "") return ""; const s = Math.max(0, Math.floor(Number(sec))); return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
const vgOf = (pid) => Object.values(S.vergaderingen || {}).filter(v => v.project_id === pid).sort((a, b) => (b.datum || "").localeCompare(a.datum || "") || (b.created_at || "").localeCompare(a.created_at || ""));
const vgPunten = (vid) => Object.values(S.vergadering_punten || {}).filter(p => p.vergadering_id === vid && !p.verborgen).sort((a, b) => (a.volgorde || 0) - (b.volgorde || 0) || (a.bron_start ?? 1e9) - (b.bron_start ?? 1e9) || (a.created_at || "").localeCompare(b.created_at || ""));
const vgTeDoen = (vid) => vgPunten(vid).filter(p => p.status === "voorstel");
const vgJob = (vid) => Object.values(S.verwerkingen || {}).filter(j => j.vergadering_id === vid).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0] || null;
const vgMagAfronden = (v) => !!v && (isBeheer() || v.controleur === S.me?.id);
const vgNaam = (d) => d.soort === "team" ? userById(d.id).name : d.soort === "contact" ? (S.contacten[d.id]?.naam || "contact") : (d.naam || "");
const vgWoorden = (t) => new Set(String(t || "").toLowerCase().match(/[a-zà-ÿ0-9]{3,}/g) || []);
const vgLijkt = (a, b) => { const x = vgWoorden(a), y = vgWoorden(b); if (!x.size || !y.size) return 0; let n = 0; x.forEach(w => { if (y.has(w)) n++; }); return n / (x.size + y.size - n); };
function vgVerwerker() {
  const r = Object.values(S.verwerker_status || {}).sort((a, b) => (b.laatst_gezien || "").localeCompare(a.laatst_gezien || ""))[0];
  if (!r) return { bekend: false, online: false };
  const min = (Date.now() - new Date(r.laatst_gezien).getTime()) / 60000;
  return { bekend: true, online: min < 3, min, r };
}
const vgWachtrij = () => Object.values(S.verwerkingen || {}).filter(j => j.status === "wachtrij" || j.status === "bezig");
function vgSignaal(kort) {
  const w = vgVerwerker(); const n = vgWachtrij().length;
  if (!w.bekend) return `<span class="vg-sig vg-sig-uit" title="Instellingen › Vergaderingen & opnames">● Nog geen verwerkingscomputer gekoppeld${n ? ` — ${n} ${n === 1 ? "opname wacht" : "opnames wachten"}` : ""}</span>`;
  if (w.online) return `<span class="vg-sig vg-sig-aan" title="Laatst gemeld ${esc(lokUur(w.r.laatst_gezien))}">● Verwerkingscomputer online${w.r.info && w.r.info.bezig ? " · bezig" : ""}${n ? ` · ${n} in de wachtrij` : ""}</span>`;
  return `<span class="vg-sig vg-sig-uit">● Verwerkingscomputer niet bereikbaar sinds ${esc(fmtLong(lokDag(w.r.laatst_gezien)))} ${esc(lokUur(w.r.laatst_gezien))}${kort ? "" : " — opdrachten blijven bewaard en worden verwerkt zodra hij weer online is"}${n ? ` · ${n} ${n === 1 ? "opname wacht" : "opnames wachten"}` : ""}</span>`;
}
function vgStatusPill(v) { const [l, c] = VG_STATUS[v.status] || [v.status, "st-offerte"]; return `<span class="pill ${c}">${esc(l)}</span>`; }
const vgTakenVan = (pid) => { const ids = new Set(vgOf(pid).map(v => v.id)); const via = new Set(Object.values(S.vergadering_punten || {}).filter(p => ids.has(p.vergadering_id) && p.taak_id).map(p => p.taak_id));
  return Object.values(S.taken).filter(t => t.project_id === pid && (ids.has(t.vergadering_id) || via.has(t.id))); };
const vgOpenPunten = (pid) => { const ids = new Set(vgOf(pid).filter(v => v.status === "gecontroleerd" || v.status === "controle").map(v => v.id));
  return Object.values(S.vergadering_punten || {}).filter(p => ids.has(p.vergadering_id) && !p.verborgen && (p.status === "bevestigd" || p.status === "gecorrigeerd") && !p.taak_id
    && (p.soort === "vraag" || (p.soort === "beslissing" && (p.aard !== "besloten" || (p.voorwaarden || "").trim())))); };

/* ---------- lijst per project + overzicht ---------- */
function vVergaderingen(p) {
  if (schemaV() < 51) return SCHEMA_HINT(51);
  if (VG.laatsteProject !== p.id) { VG.laatsteProject = p.id; VG.bewerk = null; VG.toevoegen = null; if (VG.open && S.vergaderingen[VG.open]?.project_id !== p.id) VG.open = null; }
  const open = VG.open && S.vergaderingen[VG.open];
  if (open && open.project_id === p.id) return vVergadering(open);
  const vs = vgOf(p.id);
  const rij = (v) => { const n = vgTeDoen(v.id).length; return `<tr class="click" data-vg-act="open" data-id="${v.id}"><td class="num">${fmtLong(v.datum)}${v.tijd ? `<small class="muted" style="display:block">${esc(String(v.tijd).slice(0, 5))}</small>` : ""}</td>
    <td><div class="row-title">${esc(v.onderwerp)}<small>${esc((v.deelnemers || []).map(vgNaam).filter(Boolean).join(", ") || "geen deelnemers ingevuld")}</small></div></td>
    <td>${v.controleur ? `<span class="who-cell">${avatar(v.controleur)}${esc(userById(v.controleur).name)}</span>` : `<span class="muted">nog te bepalen</span>`}</td>
    <td>${vgStatusPill(v)}${v.status === "controle" && n ? `<small class="muted" style="display:block">${n} te beoordelen</small>` : ""}${v.klant_gedeeld_op ? `<small style="display:block;color:var(--ok)">gedeeld met klant</small>` : ""}</td></tr>`; };
  const herstel = Object.values(VGR.herstel).filter(m => m.pid === p.id && S.vergaderingen[m.vid]);
  const herstelHtml = herstel.length ? `<div class="notice" style="border-color:var(--warn);margin:0 0 16px"><b>Onafgewerkte opname op dit toestel</b> — nog niet (volledig) opgeladen: ${herstel.map(m => `<button type="button" class="wj-t" data-vg-act="open" data-id="${m.vid}">${esc(S.vergaderingen[m.vid].onderwerp)}</button>`).join(", ")}. Open de vergadering om ze op te laden.</div>` : "";
  return vgOverzicht(p) + herstelHtml + `<div class="panel"><div class="panel-head"><div><h3>Vergaderingen &amp; opnames</h3><div class="muted" style="font-size:12px;margin-top:2px">${vgSignaal()}</div></div>
      <div class="actions">${vs.length ? `<button class="btn sm" data-vg-act="volgende" data-pid="${p.id}" title="Nieuwe vergadering met de open taken en beslissingen van eerdere vergaderingen als agenda">+ Opvolgvergadering</button>` : ""}<button class="btn sm" data-vg-act="nieuw" data-pid="${p.id}">+ Vergadering</button>${vgrKan() ? `<button class="btn sm primary vg-rec-knop" data-vg-act="rec-snel" data-pid="${p.id}" title="Nu een vergadering opnemen met de microfoon van dit toestel (vandaag, nu) — deelnemers en agenda vul je achteraf aan"><span class="vg-rec-dot"></span> Opnemen</button>` : ""}</div></div>
    ${vs.length ? `<div class="tw"><table class="t"><thead><tr><th>Datum</th><th>Onderwerp</th><th>Controle door</th><th>Status</th></tr></thead><tbody>${vs.map(rij).join("")}</tbody></table></div>`
      : `<div class="empty"><b>Nog geen vergaderingen</b>Klik op ● Opnemen om een vergadering meteen op te nemen met dit toestel, of maak een vergadering aan en laad een opname op (van je telefoon of computer). De verwerkingscomputer maakt er een transcript en een conceptverslag van dat jullie daarna controleren.</div>`}</div>`;
}
function vgOverzicht(p) {
  const vs = vgOf(p.id); if (!vs.length && !p.intern) return "";
  const komend = vs.filter(v => v.datum >= todayIso && v.status === "concept").sort((a, b) => a.datum.localeCompare(b.datum));
  const controle = vs.filter(v => v.status === "controle");
  const open = vgOpenPunten(p.id); const taken = vgTakenVan(p.id).filter(t => t.status !== "done");
  const kaart = (titel, n, inhoud, leeg) => `<div class="panel vg-kaart"><div class="panel-head"><h3>${titel} <span class="muted num" style="font-weight:400">${n}</span></h3></div><div class="panel-body">${n ? inhoud : `<span class="muted">${leeg}</span>`}</div></div>`;
  const vgLink = (v, extra) => `<button type="button" class="wj-t" data-vg-act="open" data-id="${v.id}">${esc(v.onderwerp)}</button><small class="muted"> · ${fmtLong(v.datum)}${extra || ""}</small>`;
  return `<div class="vg-kaarten" style="margin-bottom:16px">
    ${kaart("Komende vergaderingen", komend.length, komend.slice(0, 5).map(v => `<div>${vgLink(v)}</div>`).join(""), "Niets gepland.")}
    ${kaart("Te controleren verslagen", controle.length, controle.slice(0, 5).map(v => `<div>${vgLink(v, ` · ${vgTeDoen(v.id).length} te beoordelen`)}</div>`).join(""), "Alles gecontroleerd.")}
    ${kaart("Open beslissingen en vragen", open.length, open.slice(0, 6).map(x => `<div><span class="pill ${x.soort === "vraag" ? "st-lopend" : "st-on_hold"}">${x.soort === "vraag" ? "vraag" : (VG_AARD[x.aard] || ["beslissing"])[0]}</span> ${esc(x.tekst.slice(0, 90))}${(x.voorwaarden || "").trim() ? ` <small class="muted">— ${esc(x.voorwaarden.slice(0, 60))}</small>` : ""}</div>`).join(""), "Geen open punten uit gecontroleerde verslagen.")}
    ${kaart("Open taken uit vergaderingen", taken.length, taken.sort((a, b) => (a.eind || "9").localeCompare(b.eind || "9")).slice(0, 6).map(t => `<div><button type="button" class="wj-t" data-edit-task="${t.id}">${esc(t.titel)}</button><small class="muted"> · ${t.assignee ? esc(userById(t.assignee).name) : "wie: nog te bepalen"} · ${t.eind ? fmt(t.eind) : "deadline nog te bepalen"}</small></div>`).join(""), "Geen open taken.")}
  </div>`;
}
/* het interne project 'BROS — Interne werking': overzicht met vergaderingen én de bestaande interne takenlijst */
function vgIntern(p) {
  const taken = tasksOf(p.id).filter(t => t.status !== "done").sort((a, b) => (a.eind || "9999").localeCompare(b.eind || "9999") || (a.titel || "").localeCompare(b.titel || ""));
  return `<div class="notice" style="margin:0 0 16px">Het interne project van BROS: eigen vergaderingen, beslissingen en de interne takenlijst. Zichtbaar voor het hele team, nooit voor klanten.</div>`
    + (schemaV() >= 51 ? vgOverzicht(p) : SCHEMA_HINT(51))
    + `<div class="panel"><div class="panel-head"><h3>Interne takenlijst <span class="muted num" style="font-weight:400">${taken.length} open</span></h3><div class="actions">${schemaV() >= 51 ? `<button class="btn sm" data-ptab="vergaderingen">Vergaderingen</button>` : ""}<button class="btn sm" data-ptab="taken">Alle taken</button><button class="btn sm primary" data-act="new-task" data-pid="${p.id}">+ Taak</button></div></div>
      ${taken.length ? `<div class="tw"><table class="t"><tbody>${taken.slice(0, 25).map(t => `<tr class="click" data-edit-task="${t.id}"><td><div class="row-title">${esc(t.titel)}${t.vergadering_id && S.vergaderingen?.[t.vergadering_id] ? `<small>uit vergadering “${esc(S.vergaderingen[t.vergadering_id].onderwerp)}”</small>` : ""}</div></td><td>${wieCell(t)}</td><td class="num" style="color:${isLate(t) ? "var(--crit)" : "inherit"}">${t.eind ? fmt(t.eind) : "—"}</td><td>${pill(t)}</td></tr>`).join("")}</tbody></table></div>${taken.length > 25 ? `<div class="panel-body muted" style="font-size:12px">+ ${taken.length - 25} meer in het tabblad Taken.</div>` : ""}` : `<div class="empty"><b>Geen open interne taken</b></div>`}</div>`;
}

/* ---------- één vergadering ---------- */
function vgLaadUitvoer(v) {
  const id = v.huidige_uitvoer; if (!id || VG.uitvoer[id] || VG.uitvoerLaden[id]) return;
  VG.uitvoerLaden[id] = true;
  sb.from("vergadering_uitvoer").select("id,vergadering_id,versie,soort,transcript,modellen,metingen,waarschuwing,controles,created_at").eq("id", id).single().then(({ data, error }) => {
    VG.uitvoerLaden[id] = false; if (error) { toast("Transcript laden mislukt: " + error.message, 5000); return; } VG.uitvoer[id] = data; render();
  });
}
function vVergadering(v) {
  const p = S.projecten[v.project_id]; const job = vgJob(v.id); const pts = vgPunten(v.id); const tedoen = pts.filter(x => x.status === "voorstel").length;
  const vast = v.status === "gecontroleerd"; const u = v.huidige_uitvoer ? VG.uitvoer[v.huidige_uitvoer] : null; vgLaadUitvoer(v);
  const kanSpelen = !!(v.afspeel_pad || (v.opname && (v.opname.delen || []).length === 1 && !v.inbox_leeg));
  const deeln = (v.deelnemers || []).map(d => `<span class="pill kl">${esc(vgNaam(d))}</span>`).join(" ") || `<span class="muted">geen deelnemers ingevuld</span>`;
  let banner = "";
  if (v.status === "wachtrij" || v.status === "verwerking") {
    const pct = job && job.status === "bezig" ? Math.round((Number(job.voortgang) || 0) * 100) : 0;
    banner = `<div class="notice vg-banner"><div><b>${v.status === "wachtrij" ? "In de wachtrij" : "Wordt verwerkt"}</b>${job && job.stap && v.status === "verwerking" ? ` — ${esc(job.stap)}` : ""}${job && job.pogingen > 1 ? ` <small class="muted">(poging ${job.pogingen} van ${job.max_pogingen})</small>` : ""}<div style="margin-top:4px">${vgSignaal()}</div>${v.fout ? `<div style="color:var(--warn);margin-top:4px">${esc(v.fout)}</div>` : ""}
      ${v.status === "verwerking" ? `<div class="bar" style="margin-top:8px;max-width:420px"><i style="width:${pct}%"></i></div>` : ""}</div><div class="actions"><button class="btn sm" data-vg-act="stop" data-id="${v.id}">Stoppen</button></div></div>`;
  } else if (v.status === "mislukt") {
    banner = `<div class="notice vg-banner" style="border-color:var(--crit)"><div><b>Verwerking mislukt</b><div>${esc(v.fout || job?.fout || "Onbekende fout.")}</div>${job && job.fout_detail && isBeheer() ? `<details style="margin-top:4px"><summary class="muted" style="font-size:12px">Technische details</summary><pre class="vg-pre">${esc(job.fout_detail.slice(-1500))}</pre></details>` : ""}</div>
      <div class="actions">${v.opname ? `<button class="btn sm primary" data-vg-act="opnieuw" data-id="${v.id}">Opnieuw proberen</button>` : ""}</div></div>`;
  } else if (v.status === "controle") {
    banner = `<div class="notice vg-banner vg-concept"><div><b>Concept — nog niet gecontroleerd.</b> Alles hieronder komt van de AI en is een voorstel tot iemand het bevestigt. ${tedoen ? `<b>${tedoen}</b> ${tedoen === 1 ? "punt" : "punten"} te beoordelen.` : "Alle punten zijn beoordeeld."}${u && u.waarschuwing ? `<div style="color:var(--warn);margin-top:4px">${esc(u.waarschuwing)}</div>` : ""}</div></div>`;
  } else if (vast) {
    banner = `<div class="notice vg-banner" style="border-color:var(--ok)"><div><b>Gecontroleerd</b> door ${esc(userById(v.gecontroleerd_door).name)} op ${fmtLong(lokDag(v.gecontroleerd_op))} ${esc(lokUur(v.gecontroleerd_op))}.${v.klant_gedeeld_op ? ` Gedeeld met de klant op ${fmtLong(lokDag(v.klant_gedeeld_op))}.` : p && p.intern ? "" : " Niet gedeeld met de klant."}</div>
      <div class="actions">${vgMagAfronden(v) ? `${p && !p.intern ? (v.klant_gedeeld_op ? `<button class="btn sm" data-vg-act="deel-stop" data-id="${v.id}">Delen stoppen</button>` : `<button class="btn sm primary" data-vg-act="deel" data-id="${v.id}">Delen met de klant…</button>`) : ""}<button class="btn sm" data-vg-act="heropen" data-id="${v.id}">Heropenen</button>` : ""}</div></div>`;
  }
  const agenda = (v.agenda || []).length ? `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h3>Agenda</h3></div><div class="panel-body"><ul class="vg-agenda">${v.agenda.map(a => `<li>${a.soort === "taak" && S.taken[a.id] ? `<button type="button" class="wj-t" data-edit-task="${a.id}">${esc(a.tekst || S.taken[a.id].titel)}</button> <small class="muted">taak · ${esc(TASK_STATUS[S.taken[a.id].status] || "")}</small>` : esc(a.tekst || "")}${a.soort === "punt" ? ` <small class="muted">uit een vorige vergadering</small>` : ""}</li>`).join("")}</ul></div></div>` : "";
  const tabs = [["verslag", "Verslag" + (tedoen && !vast ? ` <span class="cnt">${tedoen}</span>` : "")], ["transcript", "Transcript"], ["logboek", "Logboek"]];
  let body = "";
  if (!v.opname) body = vgUploadPaneel(v);
  else if (VG.tab === "transcript") body = vgTranscript(v, u);
  else if (VG.tab === "logboek") body = vgLogboek(v);
  else body = vgVerslag(v, pts, u);
  if (v.opname && (VGR.herstel[v.id] || (VGR.noodkopie && VGR.noodkopie.vid === v.id))) body = vgrPaneel(v) + body;   // 1.58: oude kopie op dit toestel
  return `<div class="crumb"><button data-vg-act="lijst">Vergaderingen</button><span>›</span><span>${esc(v.onderwerp)}</span></div>
    <div class="page-head" style="margin-bottom:12px"><div><div class="eyebrow">${esc(fmtLong(v.datum))}${v.tijd ? " · " + esc(String(v.tijd).slice(0, 5)) : ""} · ${esc(projName(p))}</div><h2 style="margin:2px 0 6px">${esc(v.onderwerp)}</h2>
      <div class="vg-meta">${vgStatusPill(v)} <span class="muted">Deelnemers:</span> ${deeln} <span class="muted">· Controle door:</span> ${v.controleur ? esc(userById(v.controleur).name) : `<span class="pill late">nog te bepalen</span>`}</div></div>
      <div class="actions">${kanSpelen ? `<button class="btn" data-vg-act="speel" data-id="${v.id}" data-s="0">▶ Opname afspelen</button>` : ""}${v.drive_url ? `<a class="btn" href="${esc(safeUrl(v.drive_url))}" target="_blank" rel="noopener" title="Het origineel in de projectmap (Vergaderingen)">Origineel op Drive ↗</a>` : ""}
        ${!vast ? `<button class="btn" data-vg-act="bewerk-vg" data-id="${v.id}">Bewerken</button>` : ""}${v.opname && (v.status === "controle" || v.status === "mislukt") ? `<button class="btn" data-vg-act="opnieuw" data-id="${v.id}">Opnieuw verwerken…</button>` : ""}
        <button class="btn" data-vg-act="volgende" data-pid="${v.project_id}" data-id="${v.id}" title="Nieuwe vergadering met de open taken en beslissingen als agenda">Volgende vergadering</button>
        ${v.status === "concept" && !v.opname ? `<button class="btn ghost danger" data-vg-act="weg" data-id="${v.id}">Verwijderen</button>` : ""}</div></div>
    ${banner}${agenda}
    ${v.opname ? `<div class="subtabs">${tabs.map(([k, l]) => `<button data-vg-act="tab" data-t="${k}" aria-current="${VG.tab === k}">${l}</button>`).join("")}</div>` : ""}${body}`;
}

/* ---------- opname opladen (telefoon of computer) ---------- */
function vgUploadPaneel(v) {
  const up = VG.upload[v.id]; const rec = VGR.actief && VGR.actief.vid === v.id; const herstel = VGR.herstel[v.id] || (VGR.noodkopie && VGR.noodkopie.vid === v.id);
  return `<div class="panel"><div class="panel-head"><h3>Opname</h3></div><div class="panel-body">
    ${up && up.bezig ? `<p><b>${esc(up.tekst || "Bezig…")}</b> — laat deze pagina open tot het opladen klaar is.</p><div class="bar" style="max-width:420px"><i style="width:${Math.round((up.pct || 0) * 100)}%"></i></div>` : `
    ${up && up.fout ? `<div class="notice" style="border-color:var(--crit);margin:0 0 12px">${esc(up.fout)}</div>` : ""}
    <h4 class="vg-rec-kop">Rechtstreeks opnemen</h4>${vgrPaneel(v)}
    ${rec || herstel ? "" : `<h4 class="vg-rec-kop" style="margin-top:20px">Of een bestaande opname opladen</h4>
    <p class="muted" style="margin-top:0">Een bestaande opname van je telefoon (bv. Dictafoon / Voice Memos, WhatsApp-audio) of computer: m4a, mp3, wav, aac, ogg, opus, webm, mp4 of mov. Lange vergaderingen kunnen; het bestand wordt in delen opgeladen.</p>
    <div class="form-grid"><div class="field span2"><label for="vg_file">Bestand</label><input id="vg_file" type="file" accept="audio/*,video/*,.m4a,.mp3,.wav,.aac,.ogg,.opus,.webm,.mp4,.mov,.amr,.3gp,.caf,.flac,.wma"></div>
    <div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" id="vg_ok"><span><b>De deelnemers weten dat de vergadering opgenomen werd</b><small class="muted" style="display:block">Verplicht. De opname, het transcript en het concept zijn enkel zichtbaar voor de projectleden van BROS, nooit automatisch voor de klant.</small></span></label></div>
    <div class="field span2"><div class="actions"><button class="btn" data-vg-act="upload" data-id="${v.id}">Opladen en verwerken</button><span class="muted" style="font-size:12px">${vgSignaal(true)}</span></div></div></div>`}`}
  </div></div>`;
}
async function vgSha256(buf) { if (!(window.crypto && crypto.subtle)) throw new Error("Opladen kan enkel via een beveiligde verbinding (https)."); const h = await crypto.subtle.digest("SHA-256", buf); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join(""); }
/** bron: 'bestand' (nu) of later 'microfoon' (MediaRecorder-blob) — zelfde weg. */
async function vgOpnameOpladen(v, bestand, bron) {
  if (VG.upload[v.id]?.bezig) return false;
  if (!bestand || !bestand.size) { toast("Kies eerst een opname."); return false; }
  if (bestand.size > 4 * 1024 * 1024 * 1024) { toast("Dit bestand is groter dan 4 GB."); return false; }
  const mic = bron === "microfoon";
  const DEEL = 20 * 1024 * 1024, n = Math.max(1, Math.ceil(bestand.size / DEEL));
  const uid = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  VG.upload[v.id] = { bezig: true, mic, pct: 0, tekst: "Voorbereiden…" }; render();
  try {
    const delen = [];
    for (let i = 0; i < n; i++) {
      const blob = bestand.slice(i * DEEL, Math.min(bestand.size, (i + 1) * DEEL)); const buf = await blob.arrayBuffer(); const sha = await vgSha256(buf);
      const pad = `${v.id}/inbox/${uid}-${i + 1}.part`; let fout = null;
      for (let poging = 0; poging < 3; poging++) {
        const { error } = await sb.storage.from("opnames").upload(pad, new Blob([buf], { type: "application/octet-stream" }), { contentType: "application/octet-stream", upsert: false });
        fout = error || null; if (!fout || /exist|duplicate/i.test(fout.message || "")) { fout = null; break; }
        await new Promise(r => setTimeout(r, 2000 * (poging + 1)));
      }
      if (fout) throw new Error(`Deel ${i + 1} van ${n} kon niet opgeladen worden (${fout.message}). Controleer de verbinding en probeer opnieuw.`);
      delen.push({ pad, grootte: blob.size, sha256: sha });
      VG.upload[v.id] = { bezig: true, mic, pct: (i + 1) / n, tekst: n > 1 ? `Opgeladen: deel ${i + 1} van ${n}` : "Opgeladen" }; render();
    }
    const { data, error } = await sb.rpc("vergadering_opname", { p_id: v.id, p_meta: { naam: bestand.name || "opname", mime: String(bestand.type || "").split(";")[0].trim(), grootte: bestand.size, toestemming: true, bron: bron || "bestand", delen } });
    if (error) throw new Error(error.message);
    if (data && data.id) S.vergaderingen[data.id] = data;
    delete VG.upload[v.id]; refetch("verwerkingen"); toast("Opname opgeladen — de verwerkingscomputer neemt ze op.", 5000); render(); return true;
  } catch (e) { VG.upload[v.id] = { fout: ((e && e.message) || String(e)) + (mic ? " De opname blijft op dit toestel bewaard: probeer ‘Opnieuw opladen’." : "") }; render(); return false; }
}
window.addEventListener("beforeunload", (e) => { if (vgOpnameBezig()) { e.preventDefault(); e.returnValue = ""; } });   // ook tijdens een opname (1.58)

/* ---------- 1.58: rechtstreeks opnemen met de microfoon (laptop en telefoon) ----------
   Eén opname tegelijk. De opname loopt door als je in het Planbord naar een ander scherm gaat (balk onderaan).
   Elke 5 seconden gaat een stukje naar de opslag van dit toestel (IndexedDB): sluit de browser of valt de verbinding weg,
   dan blijft de opname bewaard en kan je ze later alsnog opladen. Na een geslaagde upload wordt die kopie gewist.
   Bij het stoppen gaat de opname langs dezelfde weg als een opgeladen bestand (vgOpnameOpladen, bron 'microfoon'). */
const VGR = { actief: null, herstel: {}, herstelGeladen: false, timer: null, lock: null };
const VGR_MIMES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/ogg;codecs=opus"];
const vgrKan = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
const vgrBezig = () => !!VGR.actief;
const vgrExt = (mime) => /mp4|aac|m4a/i.test(mime) ? ".m4a" : /ogg/i.test(mime) ? ".ogg" : ".webm";
const vgrDuur = (r) => { if (!r) return 0; return Math.floor((r.opgenomen + (r.gepauzeerd || !r.sinds ? 0 : Date.now() - r.sinds)) / 1000); };
const vgrMb = (b) => (b / 1048576).toLocaleString("nl-BE", { maximumFractionDigits: 1 }) + " MB";
/* IndexedDB: kopie van de stukjes op dit toestel */
function vgrDb() {
  if (VGR.db) return VGR.db;
  VGR.db = new Promise((ok, nok) => { try { const r = indexedDB.open("bros-opnames", 1);
    r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "vid" }); if (!db.objectStoreNames.contains("delen")) db.createObjectStore("delen", { keyPath: ["vid", "i"] }); };
    r.onsuccess = () => ok(r.result); r.onerror = () => nok(r.error); } catch (e) { nok(e); } });
  VGR.db.catch(() => { VGR.db = null; });
  return VGR.db;
}
async function vgrTx(stores, modus, werk) { const db = await vgrDb(); return new Promise((ok, nok) => { const tx = db.transaction(stores, modus); let uit; try { uit = werk(tx); } catch (e) { nok(e); return; } tx.oncomplete = () => ok(uit); tx.onerror = () => nok(tx.error); tx.onabort = () => nok(tx.error); }); }
const vgrReq = (q) => new Promise((ok, nok) => { q.onsuccess = () => ok(q.result); q.onerror = () => nok(q.error); });
async function vgrMetaBewaar(m) { try { await vgrTx(["meta"], "readwrite", tx => tx.objectStore("meta").put(m)); } catch (e) { } }
async function vgrDeelBewaar(vid, i, blob) { try { await vgrTx(["delen"], "readwrite", tx => tx.objectStore("delen").put({ vid, i, blob })); return true; } catch (e) { return false; } }
async function vgrWis(vid) { try { await vgrTx(["meta", "delen"], "readwrite", tx => { tx.objectStore("meta").delete(vid); tx.objectStore("delen").delete(IDBKeyRange.bound([vid, -Infinity], [vid, Infinity])); }); } catch (e) { } delete VGR.herstel[vid]; }
async function vgrHerstelLaden() {
  try { const db = await vgrDb(); const tx = db.transaction(["meta"], "readonly"); const alle = await vgrReq(tx.objectStore("meta").getAll());
    VGR.herstel = {}; (alle || []).forEach(m => { if (!VGR.actief || VGR.actief.vid !== m.vid) VGR.herstel[m.vid] = m; }); } catch (e) { VGR.herstel = {}; }
  VGR.herstelGeladen = true;
}
async function vgrHerstelBlob(vid) {
  const db = await vgrDb(); const tx = db.transaction(["delen"], "readonly");
  const delen = await vgrReq(tx.objectStore("delen").getAll(IDBKeyRange.bound([vid, -Infinity], [vid, Infinity])));
  const m = VGR.herstel[vid] || {}; delen.sort((a, b) => a.i - b.i);
  return new Blob(delen.map(d => d.blob), { type: m.mime || (delen[0] && delen[0].blob.type) || "audio/webm" });
}
/* microfoon openen — meteen bij de klik (sommige browsers vragen de toestemming enkel binnen een klik) */
async function vgrMic() {
  if (!vgrKan()) { toast("Deze browser kan niet rechtstreeks opnemen. Neem op met je telefoon of computer en laad het bestand op.", 7000); return null; }
  if (!window.isSecureContext) { toast("Opnemen kan enkel via een beveiligde verbinding (https).", 6000); return null; }
  try { return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }); }
  catch (e) {
    const n = e && e.name;
    toast(n === "NotAllowedError" || n === "SecurityError" ? "De browser kreeg geen toegang tot de microfoon. Sta de microfoon toe (slotje of ‘aA’ naast het adres) en probeer opnieuw."
      : n === "NotFoundError" ? "Geen microfoon gevonden op dit toestel." : "De microfoon kon niet gestart worden: " + ((e && e.message) || n || e), 9000);
    return null;
  }
}
/* starten */
async function vgrStart(v, stream) {
  const los = () => { if (stream) stream.getTracks().forEach(t => t.stop()); };
  if (VGR.actief) { los(); toast(VGR.actief.vid === v.id ? "Deze opname loopt al." : "Er loopt al een opname — stop die eerst."); return false; }
  if (VGR.herstel[v.id]) { los(); toast("Er staat nog een onafgewerkte opname van deze vergadering op dit toestel — laad die eerst op of gooi ze weg.", 7000); return false; }
  if (!stream) stream = await vgrMic(); if (!stream) return false;
  if (VGR.actief) { los(); return false; }
  const mime = VGR_MIMES.find(m => { try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; } }) || "";
  let rec; try { rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 48000 } : { audioBitsPerSecond: 48000 }); }
  catch (e) { stream.getTracks().forEach(t => t.stop()); toast("Opnemen lukt niet in deze browser: " + ((e && e.message) || e), 8000); return false; }
  const r = { vid: v.id, pid: v.project_id, onderwerp: v.onderwerp, rec, stream, mime: rec.mimeType || mime || "audio/webm", delen: [], bytes: 0, i: 0, start: Date.now(), sinds: Date.now(), opgenomen: 0, gepauzeerd: false, opslagOk: true, stoppen: null, onderbroken: "" };
  VGR.actief = r;
  await vgrMetaBewaar({ vid: v.id, pid: v.project_id, onderwerp: v.onderwerp, mime: r.mime, start: r.start, duur: 0, bytes: 0 });
  rec.ondataavailable = async (ev) => {
    if (!ev.data || !ev.data.size || r.weg) return; const i = r.i++; r.delen.push(ev.data); r.bytes += ev.data.size;
    if (r.opslagOk && !(await vgrDeelBewaar(r.vid, i, ev.data))) r.opslagOk = false;
    if (r.weg) return vgrWis(r.vid);   // weggegooid terwijl dit stukje bewaard werd
    if (r.opslagOk) vgrMetaBewaar({ vid: r.vid, pid: r.pid, onderwerp: r.onderwerp, mime: r.mime, start: r.start, duur: vgrDuur(r), bytes: r.bytes });
  };
  rec.onstop = () => { r.stream.getTracks().forEach(t => t.stop()); if (r.stoppen) r.stoppen(); };
  rec.onerror = (ev) => { r.onderbroken = "De opname werd onderbroken" + (ev && ev.error && ev.error.message ? " (" + ev.error.message + ")" : "") + "."; vgrStop(true); };
  stream.getAudioTracks().forEach(t => { t.onmute = () => { r.stil = true; vgrBalk(); }; t.onunmute = () => { r.stil = false; vgrBalk(); }; t.onended = () => { if (VGR.actief === r && !r.klaar) { r.onderbroken = "De microfoon viel weg (bv. scherm vergrendeld, ander programma of oproep)."; vgrStop(true); } }; });
  try { rec.start(5000); } catch (e) { stream.getTracks().forEach(t => t.stop()); VGR.actief = null; await vgrWis(v.id); toast("Opnemen lukt niet: " + ((e && e.message) || e), 8000); return false; }
  vgrNiveau(r); vgrWaak(true); vgrBalk(); clearInterval(VGR.timer); VGR.timer = setInterval(vgrBalk, 500);
  toast("Opname gestart — laat dit venster open" + (/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? " en het scherm aan" : "") + ".", 5000);
  render(); return true;
}
/* microfoonniveau (klein meterbalkje) */
function vgrNiveau(r) {
  try { const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return; const ctx = new Ctx(); const src = ctx.createMediaStreamSource(r.stream); const an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
    const buf = new Uint8Array(an.fftSize); r.ctx = ctx; r.niveau = () => { an.getByteTimeDomainData(buf); let m = 0; for (let k = 0; k < buf.length; k++) m = Math.max(m, Math.abs(buf[k] - 128)); return Math.min(1, m / 64); };
    if (ctx.state === "suspended") ctx.resume().catch(() => { }); } catch (e) { }
}
/* scherm wakker houden (telefoon): anders stopt de opname vaak bij het vergrendelen */
async function vgrWaak(aan) {
  try { if (aan && "wakeLock" in navigator && document.visibilityState === "visible" && !VGR.lock) { VGR.lock = await navigator.wakeLock.request("screen"); VGR.lock.addEventListener("release", () => { VGR.lock = null; }); }
    if (!aan && VGR.lock) { await VGR.lock.release(); VGR.lock = null; } } catch (e) { }
}
document.addEventListener("visibilitychange", () => { if (VGR.actief && document.visibilityState === "visible") { vgrWaak(true); if (VGR.actief.ctx && VGR.actief.ctx.state === "suspended") VGR.actief.ctx.resume().catch(() => { }); } });
function vgrPauze() {
  const r = VGR.actief; if (!r || r.klaar) return;
  try { if (!r.gepauzeerd) { r.rec.pause(); r.opgenomen += Date.now() - r.sinds; r.gepauzeerd = true; } else { r.rec.resume(); r.sinds = Date.now(); r.gepauzeerd = false; } } catch (e) { toast("Pauzeren lukt niet in deze browser."); }
  vgrBalk(); render();
}
/* stoppen: alles samenvoegen en opladen (onderbroken = automatisch gestopt, wat er is blijft bewaard) */
async function vgrStop(onderbroken) {
  const r = VGR.actief; if (!r || r.klaar) return; r.klaar = true;
  if (!r.gepauzeerd) r.opgenomen += Date.now() - r.sinds; r.gepauzeerd = true;
  await new Promise(ok => { r.stoppen = ok; try { if (r.rec.state !== "inactive") r.rec.stop(); else ok(); } catch (e) { ok(); } setTimeout(ok, 4000); });
  await new Promise(ok => setTimeout(ok, 300));   // laatste stukje (dataavailable) eerst laten bewaren
  try { r.ctx && r.ctx.close(); } catch (e) { } vgrWaak(false); clearInterval(VGR.timer); VGR.timer = null;
  const duur = Math.round(r.opgenomen / 1000);
  VGR.actief = null;
  if (!r.bytes) { await vgrWis(r.vid); vgrBalk(); render(); toast(onderbroken ? (r.onderbroken || "De opname werd onderbroken.") + " Er werd niets opgenomen." : "Er werd niets opgenomen.", 7000); return; }
  if (r.opslagOk) { await vgrMetaBewaar({ vid: r.vid, pid: r.pid, onderwerp: r.onderwerp, mime: r.mime, start: r.start, duur, bytes: r.bytes }); VGR.herstel[r.vid] = { vid: r.vid, pid: r.pid, onderwerp: r.onderwerp, mime: r.mime, start: r.start, duur, bytes: r.bytes }; }
  if (onderbroken) toast((r.onderbroken || "De opname werd onderbroken.") + " Wat er al opgenomen was (" + vgTijd(duur) + "), wordt nu opgeladen.", 9000);
  const blob = new Blob(r.delen, { type: r.mime });
  vgrBalk(); return vgrOpladen(r.vid, blob, r.mime, r.start, !r.opslagOk);
}
async function vgrOpladen(vid, blob, mime, start, geenKopie) {
  if (geenKopie) VGR.noodkopie = { vid, blob, mime, start };   // geen kopie op het toestel: in het geheugen houden tot het opladen lukt
  const v = S.vergaderingen && S.vergaderingen[vid];
  if (!v) { toast("De vergadering bestaat niet meer. De opname blijft op dit toestel bewaard.", 8000); render(); return; }
  if (!["concept", "mislukt"].includes(v.status) || (v.opname && v.status !== "mislukt")) { toast("Deze vergadering heeft al een opname. De nieuwe opname blijft op dit toestel bewaard (Vergaderingen › deze vergadering).", 9000); render(); return; }
  const d = new Date(start || Date.now()); const p2 = (n) => String(n).padStart(2, "0");
  const naam = `opname ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}u${p2(d.getMinutes())}${vgrExt(mime)}`;
  const f = new File([blob], naam, { type: String(mime || "").split(";")[0] || "audio/webm" });   // zonder ';codecs=…' (het Drive-script aanvaardt enkel type/subtype)
  const ok = await vgOpnameOpladen(v, f, "microfoon");
  if (ok) { await vgrWis(vid); if (VGR.noodkopie && VGR.noodkopie.vid === vid) VGR.noodkopie = null; }
  else if (geenKopie) toast("Opladen mislukt en dit toestel kon geen kopie bewaren — laat dit venster open en probeer ‘Opnieuw opladen’.", 10000);
  render(); return ok;
}
async function vgrAnnuleer() {
  const r = VGR.actief; if (!r) return;
  if (!confirm("Opname stoppen en weggooien? Wat opgenomen werd, gaat verloren.")) return;
  r.klaar = true; r.weg = true;
  await new Promise(ok => { r.stoppen = ok; try { if (r.rec.state !== "inactive") r.rec.stop(); else ok(); } catch (e) { ok(); } setTimeout(ok, 4000); });
  r.stream.getTracks().forEach(t => t.stop()); try { r.ctx && r.ctx.close(); } catch (e) { }
  vgrWaak(false); clearInterval(VGR.timer); VGR.timer = null; VGR.actief = null; await new Promise(ok => setTimeout(ok, 300)); await vgrWis(r.vid); vgrBalk(); render(); toast("Opname weggegooid.");
}
/* vaste balk onderaan (in elk scherm zolang de opname loopt of oplaadt) */
function vgrBalk() {
  let el = document.getElementById("vgRec"); const r = VGR.actief;
  const up = r ? null : Object.entries(VG.upload).find(([id, u]) => u && u.bezig && u.mic);
  const wees = r || up || !S.vergaderingen ? null : Object.values(VGR.herstel).find(m => !S.vergaderingen[m.vid]);   // kopie van een vergadering die niet (meer) bestaat
  const groot = document.querySelector(".vg-rec-groot .num"); if (groot && r) groot.textContent = vgTijd(vgrDuur(r));
  if (!r && !up && !wees) { if (el) el.hidden = true; return; }
  if (!el) { el = document.createElement("div"); el.id = "vgRec"; el.className = "vg-rec"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.hidden = false;
  if (wees) {
    const sleutel = "w:" + wees.vid;
    if (el.dataset.k !== sleutel) { el.dataset.k = sleutel; el.innerHTML = `<span class="vg-rec-dot pauze"></span><span class="vg-rec-t">Onafgewerkte opname op dit toestel</span><span class="muted" style="font-size:12px">${esc(wees.onderwerp || "")}${wees.duur ? " · " + vgTijd(wees.duur) : ""} — de vergadering bestaat niet meer</span><button type="button" class="btn sm" data-vg-act="rec-wees-dl" data-vid="${esc(wees.vid)}">Downloaden</button><button type="button" class="btn sm ghost danger" data-vg-act="rec-wees-weg" data-vid="${esc(wees.vid)}">Weggooien</button>`; }
    return;
  }
  if (r) {
    const sleutel = "r:" + r.vid + ":" + r.gepauzeerd + ":" + !!r.klaar;
    if (el.dataset.k !== sleutel) {
      el.dataset.k = sleutel;
      el.innerHTML = `<span class="vg-rec-dot${r.gepauzeerd ? " pauze" : ""}"></span><span class="vg-rec-t num"></span><span class="vg-rec-meter"><i></i></span><button type="button" class="vg-rec-ond" data-vg-goto="${r.vid}" title="Naar de vergadering">${esc(r.onderwerp || "Opname")}</button>
        ${r.klaar ? `<span class="muted">Afronden…</span>` : `<button type="button" class="btn sm" data-vg-act="rec-pauze">${r.gepauzeerd ? "▶ Verder" : "❚❚ Pauze"}</button><button type="button" class="btn sm primary vg-rec-stop" data-vg-act="rec-stop">■ Stop &amp; opladen</button>`}`;
    }
    el.querySelector(".vg-rec-t").textContent = vgTijd(vgrDuur(r)) + (r.gepauzeerd ? " · gepauzeerd" : r.stil ? " · ⚠ geen geluid van de microfoon (scherm vergrendeld of oproep?)" : "");
    const m = el.querySelector(".vg-rec-meter i"); if (m) m.style.width = Math.round((r.gepauzeerd || !r.niveau ? 0 : r.niveau()) * 100) + "%";
  } else {
    const [id, u] = up; const v = S.vergaderingen && S.vergaderingen[id]; const sleutel = "u:" + id;
    if (el.dataset.k !== sleutel) { el.dataset.k = sleutel; el.innerHTML = `<span class="vg-rec-dot pauze"></span><button type="button" class="vg-rec-ond" data-vg-goto="${id}">${esc(v ? v.onderwerp : "Opname")}</button><span class="vg-rec-t"></span><span class="vg-rec-meter up"><i></i></span>`; }
    el.querySelector(".vg-rec-t").textContent = u.tekst || "Opladen…"; el.querySelector(".vg-rec-meter i").style.width = Math.round((u.pct || 0) * 100) + "%";
  }
}
/* paneel in de vergadering (geen opname): rechtstreeks opnemen, of een onafgewerkte opname van dit toestel opladen */
function vgrPaneel(v) {
  const r = VGR.actief && VGR.actief.vid === v.id ? VGR.actief : null; const h = VGR.herstel[v.id]; const nood = VGR.noodkopie && VGR.noodkopie.vid === v.id;
  if (r) return `<div class="vg-rec-paneel"><div class="vg-rec-groot"><span class="vg-rec-dot${r.gepauzeerd ? " pauze" : ""}"></span><b>${r.gepauzeerd ? "Gepauzeerd" : "Opname loopt"}</b> <span class="num">${vgTijd(vgrDuur(r))}</span></div>
    <p class="muted" style="margin:6px 0 12px">Laat dit venster open${/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? " en het scherm aan (niet vergrendelen)" : ""}. Je mag wel naar andere schermen van het Planbord gaan: de balk onderaan blijft staan.${r.opslagOk ? "" : " <b>Let op:</b> dit toestel kan geen reservekopie bewaren — sluit de browser niet voor het opladen klaar is."}</p>
    <div class="actions"><button class="btn primary vg-rec-stop" data-vg-act="rec-stop">■ Stoppen en opladen</button><button class="btn" data-vg-act="rec-pauze">${r.gepauzeerd ? "▶ Verder opnemen" : "❚❚ Pauze"}</button><button class="btn ghost danger" data-vg-act="rec-weg">Weggooien</button></div></div>`;
  if (h || nood) {
    const m = h || { duur: 0, bytes: VGR.noodkopie.blob.size, start: VGR.noodkopie.start };
    return `<div class="notice vg-rec-paneel" style="border-color:var(--warn)"><div><b>Onafgewerkte opname op dit toestel</b> — gestart ${esc(fmtLong(lokDag(new Date(m.start).toISOString())))} ${esc(lokUur(new Date(m.start).toISOString()))}${m.duur ? `, ${vgTijd(m.duur)}` : ""} (${vgrMb(m.bytes || 0)}). Ze werd nog niet (volledig) opgeladen.</div>
      ${v.opname && v.status !== "mislukt" ? `<p class="muted" style="margin:6px 0 0">Deze vergadering heeft intussen al een opname; deze kopie kan je weggooien.</p>` : ""}
      <div class="actions" style="margin-top:10px">${v.opname && v.status !== "mislukt" ? "" : `<button class="btn primary" data-vg-act="rec-herstel" data-id="${v.id}">Opnieuw opladen</button>`}<button class="btn ghost danger" data-vg-act="rec-herstel-weg" data-id="${v.id}">Weggooien</button></div></div>`;
  }
  if (v.opname && v.status !== "mislukt") return "";
  if (!vgrKan()) return `<p class="muted" style="margin-top:0">Rechtstreeks opnemen kan niet in deze browser — laad hieronder een opname op.</p>`;
  return `<div class="vg-rec-paneel"><div class="field"><label class="sw-row"><input type="checkbox" class="sw" id="vg_ok_rec"><span><b>De deelnemers weten dat de vergadering opgenomen wordt</b><small class="muted" style="display:block">Verplicht. De opname, het transcript en het concept zijn enkel zichtbaar voor de projectleden van BROS, nooit automatisch voor de klant.</small></span></label></div>
    <div class="actions" style="margin-top:10px"><button class="btn primary vg-rec-knop" data-vg-act="rec-start" data-id="${v.id}"><span class="vg-rec-dot"></span> Opname starten</button><span class="muted" style="font-size:12px">${VGR.actief ? "Er loopt al een andere opname." : "De microfoon van dit toestel neemt op; bij het stoppen gaat de opname meteen naar het Planbord."}</span></div></div>`;
}
/* snel starten vanuit de lijst: vergadering aanmaken (vandaag, nu) en meteen opnemen */
function vgrSnelForm(pid) {
  if (VGR.actief) { toast("Er loopt al een opname — stop die eerst."); return; }
  if (!vgrKan()) { toast("Deze browser kan niet rechtstreeks opnemen. Maak een vergadering aan en laad een opname op.", 7000); return; }
  const p = S.projecten[pid]; const n = new Date(); const p2 = (x) => String(x).padStart(2, "0");
  openModal("Opname starten — " + projName(p), `<div class="form-grid">
    <div class="field span2"><label for="vgr_ond">Onderwerp</label><input id="vgr_ond" name="onderwerp" required value="${esc("Vergadering " + p2(n.getDate()) + "/" + p2(n.getMonth() + 1))}"></div>
    <div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" name="ok" value="1" required><span><b>De deelnemers weten dat de vergadering opgenomen wordt</b><small class="muted" style="display:block">Verplicht. Deelnemers, agenda en controleur vul je achteraf aan met ‘Bewerken’.</small></span></label></div></div>`, {
    saveLabel: "● Opname starten",
    onSave: async (d) => {
      if (!d.ok) { toast("Bevestig eerst dat de deelnemers weten dat er opgenomen wordt."); return false; }
      const stream = await vgrMic(); if (!stream) return false;
      const row = { project_id: pid, onderwerp: String(d.onderwerp || "").trim() || "Vergadering", datum: todayIso, tijd: p2(n.getHours()) + ":" + p2(n.getMinutes()), deelnemers: [{ soort: "team", id: S.me.id }], agenda: [], controleur: p.lead || S.me.id };
      let nv; try { nv = await dbInsert("vergaderingen", row); } catch (e) { stream.getTracks().forEach(t => t.stop()); throw e; }
      VG.open = nv.id; VG.tab = "verslag"; VG.laatsteProject = pid; S.view = "projecten"; S.project = pid; S.ptab = "vergaderingen";
      setTimeout(() => vgrStart(nv, stream), 0);
    },
  });
}
/* niet herladen of sluiten tijdens een opname of upload */
window.vgOpnameBezig = () => vgrBezig() || Object.values(VG.upload).some(u => u && u.bezig);
(function vgrInit() { const t = setInterval(() => { if (typeof S !== "undefined" && S.ready && S.me) { clearInterval(t); vgrHerstelLaden().then(() => { const ids = Object.keys(VGR.herstel); if (ids.length) { const v = S.vergaderingen && S.vergaderingen[ids[0]]; if (typeof render === "function") render();
  toast(ids.length === 1 && v ? `Er staat nog een onafgewerkte opname op dit toestel (${v.onderwerp}) — open de vergadering om ze op te laden.` : `Er staan nog ${ids.length} onafgewerkte opnames op dit toestel — open de vergadering om ze op te laden.`, 9000); } }); } }, 1500); })();


/* ---------- afspelen: één vaste speler (blijft spelen als het scherm hertekent) ---------- */
function vgSpeler() {
  let el = document.getElementById("vgSpeler");
  if (!el) {
    el = document.createElement("div"); el.id = "vgSpeler"; el.className = "vg-speler"; el.hidden = true;
    el.innerHTML = `<span class="vg-sp-t"></span><audio controls preload="metadata"></audio><button type="button" class="btn sm ghost" data-vg-act="speler-sluit" aria-label="Speler sluiten">✕</button>`;
    document.body.appendChild(el);
    const a = el.querySelector("audio");
    a.addEventListener("timeupdate", () => { if (VG.stopBij != null && a.currentTime >= VG.stopBij) { a.pause(); VG.stopBij = null; } });
  }
  return el;
}
async function vgAudioUrl(v) {
  const pad = v.afspeel_pad || (v.opname && (v.opname.delen || []).length === 1 && !v.inbox_leeg ? v.opname.delen[0].pad : null);
  if (!pad) return null;
  const c = VG.audio[v.id]; if (c && c.pad === pad && c.tot > Date.now() + 120000) return c.url;
  const { data, error } = await sb.storage.from("opnames").createSignedUrl(pad, 3600);   // de opslag controleert of je projectlid bent
  if (error || !data) { toast("Afspelen niet mogelijk: " + (error?.message || "geen toegang"), 5000); return null; }
  VG.audio[v.id] = { pad, url: data.signedUrl, tot: Date.now() + 3600 * 1000 }; return data.signedUrl;
}
async function vgSpeel(v, s, e) {
  const el = vgSpeler(); const a = el.querySelector("audio"); const url = await vgAudioUrl(v);
  if (!url) { toast("Er is nog geen afspeelbare opname (die maakt de verwerkingscomputer)."); return; }
  if (el.dataset.vg !== v.id || el.dataset.url !== url) { a.src = url; el.dataset.vg = v.id; el.dataset.url = url; }
  el.hidden = false; el.querySelector(".vg-sp-t").textContent = v.onderwerp + (s ? " · " + vgTijd(s) : "");
  const start = () => { a.currentTime = Math.max(0, (Number(s) || 0) - (s ? 1.5 : 0)); VG.stopBij = e != null && e !== "" ? Number(e) + 1.5 : null; a.play().catch(() => { }); };
  if (a.readyState >= 1) start(); else a.addEventListener("loadedmetadata", start, { once: true });
}
const vgSpeeltijd = () => { const el = document.getElementById("vgSpeler"); if (!el || el.hidden) return null; const a = el.querySelector("audio"); return a && a.currentTime ? Math.round(a.currentTime * 10) / 10 : null; };
/* na elke render (app.js): speler verbergen als je de vergadering verlaat */
function vgNaRender() {
  vgrBalk();   // 1.58: opnamebalk bijwerken (ook buiten de vergadering)
  const el = document.getElementById("vgSpeler"); if (!el || el.hidden) return;
  if (!(S.view === "projecten" && S.ptab === "vergaderingen" && VG.open === el.dataset.vg)) { el.hidden = true; el.querySelector("audio").pause(); }
}

/* ---------- transcript ---------- */
function vgTranscript(v, u) {
  if (!v.huidige_uitvoer) return `<div class="panel"><div class="empty"><b>Nog geen transcript</b>Dat maakt de verwerkingscomputer.</div></div>`;
  if (!u) return `<div class="panel"><div class="empty">Transcript laden…</div></div>`;
  const q = (VG.zoek || "").trim().toLowerCase(); const seg = u.transcript || [];
  const rijen = seg.filter(s => !q || String(s.t).toLowerCase().includes(q));
  const nOnd = seg.filter(s => s.onduidelijk).length;
  return `<div class="panel"><div class="panel-head"><div><h3>Transcript</h3><div class="muted" style="font-size:12px;margin-top:2px">Automatisch (lokaal op de verwerkingscomputer), niet gecontroleerd · ${seg.length} fragmenten${nOnd ? ` · <span style="color:var(--warn)">${nOnd} onduidelijk gemarkeerd</span>` : ""} · Een fragment zonder markering is daarom nog niet juist.</div></div>
    <div class="actions"><input class="inline" data-vg-zoek placeholder="Zoeken in het transcript" value="${esc(VG.zoek || "")}" style="width:220px"></div></div>
    <div class="vg-tr">${rijen.map(s => `<div class="vg-seg${s.onduidelijk ? " vg-ond" : ""}" id="vgseg-${vgN(s.i)}"><button type="button" class="vg-bron" data-vg-act="speel" data-id="${v.id}" data-s="${vgN(s.s)}" data-e="${vgN(s.e)}" title="Afspelen vanaf hier">▶ ${vgTijd(s.s)}</button><span>${esc(s.t)}${s.onduidelijk ? ` <span class="vg-w" title="${esc(s.reden || "")}">⚠ ${esc(s.reden || "onduidelijk")}</span>` : ""}</span></div>`).join("") || `<div class="empty">Niets gevonden.</div>`}</div></div>`;
}

/* ---------- verslag in de BROS-indeling ---------- */
function vgVerslag(v, pts, u) {
  const vast = v.status === "gecontroleerd" || v.status === "wachtrij" || v.status === "verwerking";
  const vs = v.verslag || {}; const ond = Array.isArray(vs.onderwerpen) ? vs.onderwerpen : [];
  const aiConcept = vs.bron === "ai" && !v.verslag_bewerkt_op;
  const ro = vast ? "disabled" : "";
  const samenv = `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>1. Korte samenvatting</h3>${aiConcept ? `<div class="muted" style="font-size:12px;margin-top:2px">AI-concept — lees na en pas aan</div>` : v.verslag_bewerkt_op ? `<div class="muted" style="font-size:12px;margin-top:2px">Laatst aangepast door ${esc(userById(v.verslag_bewerkt_door).name)} · ${fmtLong(lokDag(v.verslag_bewerkt_op))} ${esc(lokUur(v.verslag_bewerkt_op))}</div>` : ""}</div></div>
    <div class="panel-body"><textarea class="inline vg-ta" rows="4" data-vg-veld="samenvatting" data-id="${v.id}" ${ro} placeholder="${vs.opmerking ? esc(vs.opmerking) : "Schrijf hier de korte samenvatting."}">${esc(vs.samenvatting || "")}</textarea></div></div>`;
  const onderw = `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h3>2. Besproken onderwerpen</h3>${vast ? "" : `<button class="btn sm" data-vg-act="ond-plus" data-id="${v.id}">+ Onderwerp</button>`}</div><div class="panel-body">
    ${ond.length ? ond.map((o, i) => `<div class="vg-ond-rij"><div class="vg-ond-kop"><input class="inline" data-vg-ond="${i}" data-f="titel" data-id="${v.id}" value="${esc(o.titel || "")}" placeholder="Onderwerp" ${ro}>${o.bron_start != null ? `<button type="button" class="vg-bron" data-vg-act="speel" data-id="${v.id}" data-s="${vgN(o.bron_start)}">▶ ${vgTijd(vgN(o.bron_start))}</button>` : ""}${vast ? "" : `<button class="btn ghost sm danger" data-vg-act="ond-weg" data-id="${v.id}" data-i="${i}" aria-label="Onderwerp verwijderen">✕</button>`}</div>
      <textarea class="inline vg-ta" rows="2" data-vg-ond="${i}" data-f="tekst" data-id="${v.id}" ${ro}>${esc(o.tekst || "")}</textarea></div>`).join("") : `<span class="muted">Nog geen onderwerpen.</span>`}</div></div>`;
  const nr = { beslissing: 3, vraag: 4, actie: 5, meerwerk: 6, gegeven: 7 };
  const secties = VG_SECTIE.map(([soort, titel, uitleg]) => {
    const l = pts.filter(x => x.soort === soort); const open = l.filter(x => x.status === "voorstel").length;
    return `<div class="panel vg-sectie" style="margin-bottom:16px"><div class="panel-head"><div><h3>${nr[soort]}. ${titel} <span class="muted num" style="font-weight:400">${l.length}${open ? ` · <span style="color:var(--warn)">${open} te beoordelen</span>` : ""}</span></h3>${uitleg ? `<div class="muted" style="font-size:12px;margin-top:2px">${uitleg}</div>` : ""}</div>
      ${vast ? "" : `<button class="btn sm" data-vg-act="plus" data-id="${v.id}" data-soort="${soort}" title="Een punt dat de AI miste">+ Toevoegen</button>`}</div>
      <div class="vg-pts">${l.map(x => vgPuntRij(x, v, vast)).join("") || (VG.toevoegen === v.id + ":" + soort ? "" : `<div class="vg-leeg muted">Geen ${titel.toLowerCase()} gevonden${v.huidige_uitvoer ? " — controleer in het transcript of er niets gemist werd" : ""}.</div>`)}
      ${VG.toevoegen === v.id + ":" + soort ? vgToevoegForm(v, soort) : ""}</div></div>`;
  }).join("");
  const notitie = `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Interne opmerking</h3><div class="muted" style="font-size:12px;margin-top:2px">Enkel voor BROS — wordt nooit met de klant gedeeld.</div></div></div><div class="panel-body"><textarea class="inline vg-ta" rows="2" data-vg-veld="interne_notitie" data-id="${v.id}" ${v.status === "gecontroleerd" ? "disabled" : ""}>${esc(v.interne_notitie || "")}</textarea></div></div>`;
  const tedoen = pts.filter(x => x.status === "voorstel").length;
  const afronden = v.status === "controle" ? `<div class="panel vg-afronden"><div class="panel-body"><div>${tedoen ? `<b>Nog ${tedoen} ${tedoen === 1 ? "punt" : "punten"} te beoordelen.</b> Bevestig, corrigeer of wijs elk punt af.` : `<b>Alle punten zijn beoordeeld.</b> Lees de samenvatting nog eens na.`}<div class="muted" style="font-size:12px">${vgMagAfronden(v) ? "Na de controle liggen het verslag en de punten vast (heropenen kan). Ook een tweede AI-controle vervangt deze menselijke controle niet." : `Enkel de controleur (${esc(userById(v.controleur).name || "nog te bepalen")}) of een beheerder kan de controle afronden.`}</div></div>
    <button class="btn primary" data-vg-act="controle" data-id="${v.id}" ${tedoen || !vgMagAfronden(v) ? "disabled" : ""}>Verslag als gecontroleerd markeren</button></div></div>` : "";
  return samenv + onderw + secties + notitie + afronden;
}
function vgPuntRij(x, v, vast) {
  const bewerk = VG.bewerk === x.id && !vast; const ai = !!x.uitvoer_id; const o = x.origineel || {};
  const bron = x.bron_start != null ? `<button type="button" class="vg-bron" data-vg-act="speel" data-id="${v.id}" data-s="${vgN(x.bron_start)}" data-e="${vgN(x.bron_eind)}" title="Bronfragment afspelen">▶ ${vgTijd(x.bron_start)}</button>` : `<span class="vg-bron vg-geenbron" title="Geen tijdsaanduiding">—</span>`;
  const aard = x.aard && (x.soort === "beslissing" || x.soort === "actie") ? `<span class="pill ${VG_AARD[x.aard][1]}">${x.soort === "actie" && x.aard === "besloten" ? "afgesproken" : VG_AARD[x.aard][0]}</span>` : "";
  const tags = [aard, x.soort === "gegeven" && x.gegeven_soort ? `<span class="pill kl">${esc(x.gegeven_soort)}</span>` : "", x.kritiek && x.status === "voorstel" ? `<span class="pill late" title="Expliciet controleren tegen de opname">controleren</span>` : "", !ai ? `<span class="pill kl" title="Door iemand toegevoegd">toegevoegd</span>` : ""].join("");
  const wie = x.soort === "actie" ? `<div class="vg-wie"><span class="muted">Wie:</span> ${x.verantwoordelijke ? esc(userById(x.verantwoordelijke).name) : `<span class="pill late">nog te bepalen</span>`}${x.verantwoordelijke_tekst && (!x.verantwoordelijke || userById(x.verantwoordelijke).name.toLowerCase().indexOf(x.verantwoordelijke_tekst.toLowerCase().split(" ")[0]) < 0) ? ` <small class="muted">(genoemd: “${esc(x.verantwoordelijke_tekst)}”)</small>` : ""}
      · <span class="muted">Tegen:</span> ${x.deadline ? fmtLong(x.deadline) : `<span class="pill late">nog te bepalen</span>`}${x.deadline_tekst ? ` <small class="muted">(genoemd: “${esc(x.deadline_tekst)}”)</small>` : ""}</div>` : "";
  const status = x.status === "voorstel" ? "" : `<div class="vg-oordeel vg-o-${x.status}">${x.status === "afgewezen" ? "✕ Afgewezen" : x.status === "gecorrigeerd" ? "✎ Gecorrigeerd" : "✓ Juist"}${x.beoordeeld_door ? ` · ${esc(userById(x.beoordeeld_door).name)} ${fmtLong(lokDag(x.beoordeeld_op))}` : ""}${x.reden ? ` · “${esc(x.reden)}”` : ""}${x.status === "gecorrigeerd" && ai && o.tekst && o.tekst !== x.tekst ? `<div class="muted">AI-versie: “${esc(String(o.tekst).slice(0, 300))}”${o.voorwaarden && o.voorwaarden !== x.voorwaarden ? ` — voorwaarde “${esc(o.voorwaarden)}”` : ""}</div>` : ""}</div>`;
  const taak = x.taak_id ? (S.taken[x.taak_id] ? `<div class="vg-taak">→ ${x.taak_koppeling === "bestaand" ? "Gekoppeld aan taak" : "Taak"}: <button type="button" class="wj-t" data-edit-task="${x.taak_id}">${esc(S.taken[x.taak_id].titel)}</button> <small class="muted">${esc(TASK_STATUS[S.taken[x.taak_id].status] || "")}</small></div>` : `<div class="vg-taak muted">→ taak (niet zichtbaar)</div>`) : "";
  const w = (x.waarschuwingen || []).length ? `<ul class="vg-wl">${x.waarschuwingen.map(t => `<li>⚠ ${esc(t)}</li>`).join("")}</ul>` : "";
  let knoppen = "";
  if (!vast) {
    if (x.status === "voorstel" && x.soort === "actie") knoppen = vgActieForm(x, v);
    else if (x.status === "voorstel") knoppen = `<div class="vg-knop"><button class="btn sm primary" data-vg-act="ok" data-id="${x.id}">✓ Juist</button><button class="btn sm" data-vg-act="pas" data-id="${x.id}">✎ Aanpassen</button><button class="btn sm ghost danger" data-vg-act="nee" data-id="${x.id}">✕ Afwijzen</button></div>`;
    else if (!x.taak_id) knoppen = `<div class="vg-knop">${x.soort === "actie" && x.status !== "afgewezen" ? `<button class="btn sm" data-vg-act="taak-alsnog" data-id="${x.id}">Toch een taak maken</button>` : ""}<button class="btn sm ghost" data-vg-act="terug" data-id="${x.id}">Opnieuw beoordelen</button></div>`;
  }
  const inhoud = bewerk ? vgBewerkForm(x) : `<div class="vg-tekst${x.status === "afgewezen" ? " vg-weg" : ""}">${esc(x.tekst)}</div>${(x.voorwaarden || "").trim() ? `<div class="vg-vw"><b>Voorwaarde:</b> ${esc(x.voorwaarden)}</div>` : ""}`;
  return `<div class="vg-pt vg-st-${x.status}${x.kritiek && x.status === "voorstel" ? " vg-kritiek" : ""}" id="vgpt-${x.id}">${bron}<div class="vg-pt-in"><div class="vg-tags">${tags}</div>${inhoud}${wie}
    ${x.citaat ? `<div class="vg-cit">“${esc(x.citaat.slice(0, 400))}”${(x.segmenten || []).length ? ` <button type="button" class="vg-link" data-vg-act="toon" data-id="${v.id}" data-seg="${vgN(x.segmenten[0])}">in transcript</button>` : ""}</div>` : ""}
    ${w}${status}${taak}${bewerk ? "" : knoppen}</div></div>`;
}
const vgC = (x, f, def) => (VG.concept[x.id] && VG.concept[x.id][f] !== undefined) ? VG.concept[x.id][f] : def;
function vgActieForm(x, v) {
  const lijkt = Object.values(S.taken).filter(t => t.project_id === v.project_id && t.status !== "done").map(t => ({ t, s: vgLijkt(t.titel, x.tekst) })).filter(o => o.s >= 0.4).sort((a, b) => b.s - a.s).slice(0, 2);
  const wieSel = `<select class="inline" data-vg-concept="${x.id}" data-f="wie" aria-label="Verantwoordelijke"><option value="">— nog te bepalen —</option>${opts(users().map(u => [u.id, u.name]), vgC(x, "wie", x.verantwoordelijke || ""))}</select>`;
  return `<div class="vg-actie"><div class="vg-actie-velden"><input class="inline" data-vg-concept="${x.id}" data-f="titel" value="${esc(vgC(x, "titel", x.tekst))}" aria-label="Taak">${wieSel}<input class="inline" type="date" data-vg-concept="${x.id}" data-f="eind" value="${esc(vgC(x, "eind", x.deadline || ""))}" aria-label="Deadline" title="Leeg = deadline nog te bepalen"></div>
    ${lijkt.length ? `<div class="vg-lijkt">Lijkt op een bestaande taak: ${lijkt.map(o => `<button class="btn sm" data-vg-act="koppel" data-id="${x.id}" data-taak="${o.t.id}" title="Geen nieuwe taak: dit punt koppelen aan de bestaande taak (er komt een notitie bij)">Koppel aan “${esc(o.t.titel.slice(0, 50))}”</button>`).join(" ")}</div>` : ""}
    <div class="vg-knop"><button class="btn sm primary" data-vg-act="taak" data-id="${x.id}">✓ Taak maken</button><button class="btn sm" data-vg-act="ok" data-id="${x.id}" title="Juist, maar geen taak nodig">✓ Juist, geen taak</button><button class="btn sm ghost danger" data-vg-act="nee" data-id="${x.id}">✕ Afwijzen</button></div></div>`;
}
function vgBewerkForm(x) {
  return `<div class="vg-bewerk"><textarea class="inline vg-ta" rows="2" data-vg-concept="${x.id}" data-f="tekst">${esc(vgC(x, "tekst", x.tekst))}</textarea>
    ${x.soort === "beslissing" || x.soort === "actie" ? `<label class="muted" style="font-size:12px">Aard <select class="inline" data-vg-concept="${x.id}" data-f="aard">${opts(x.soort === "actie" ? [["besloten", "afgesproken"], ["voorgesteld", "voorgesteld"]] : Object.keys(VG_AARD).map(k => [k, k]), vgC(x, "aard", x.aard || "besproken"))}</select></label>` : ""}
    ${x.soort === "beslissing" ? `<input class="inline" data-vg-concept="${x.id}" data-f="voorwaarden" value="${esc(vgC(x, "voorwaarden", x.voorwaarden || ""))}" placeholder="Voorwaarde (bv. als de prijs onder … blijft) — leeg als er geen is">` : ""}
    <div class="vg-knop"><button class="btn sm primary" data-vg-act="pas-ok" data-id="${x.id}">Bewaren als gecorrigeerd</button><button class="btn sm ghost" data-vg-act="pas-weg" data-id="${x.id}">Annuleren</button></div></div>`;
}
function vgToevoegForm(v, soort) {
  const k = "nieuw:" + v.id + ":" + soort; const c = VG.concept[k] || {};
  return `<div class="vg-pt vg-nieuw"><span class="vg-bron vg-geenbron">+</span><div class="vg-pt-in"><textarea class="inline vg-ta" rows="2" data-vg-nieuw="${esc(k)}" data-f="tekst" placeholder="${soort === "gegeven" ? "bv. Nis 3,20 m breed" : "Wat werd er gezegd of besloten?"}">${esc(c.tekst || "")}</textarea>
    <div class="vg-actie-velden">${soort === "beslissing" ? `<select class="inline" data-vg-nieuw="${esc(k)}" data-f="aard">${opts(Object.keys(VG_AARD).map(a => [a, a]), c.aard || "besloten")}</select><input class="inline" data-vg-nieuw="${esc(k)}" data-f="voorwaarden" value="${esc(c.voorwaarden || "")}" placeholder="Voorwaarde (optioneel)">` : ""}
      ${soort === "actie" ? `<select class="inline" data-vg-nieuw="${esc(k)}" data-f="wie"><option value="">— nog te bepalen —</option>${opts(users().map(u => [u.id, u.name]), c.wie || "")}</select><input class="inline" type="date" data-vg-nieuw="${esc(k)}" data-f="eind" value="${esc(c.eind || "")}">` : ""}
      <label class="muted" style="font-size:12px;display:flex;gap:6px;align-items:center"><input type="checkbox" data-vg-nieuw="${esc(k)}" data-f="tijd" ${c.tijd !== false ? "checked" : ""}> huidige afspeeltijd als bron${vgSpeeltijd() != null ? ` (${vgTijd(vgSpeeltijd())})` : " (speel eerst het fragment af)"}</label></div>
    <div class="vg-knop"><button class="btn sm primary" data-vg-act="plus-ok" data-id="${v.id}" data-soort="${soort}">Toevoegen</button><button class="btn sm ghost" data-vg-act="plus-weg">Annuleren</button></div></div></div>`;
}

/* ---------- logboek (proefperiode) ---------- */
function vgLogboek(v) {
  if (!VG.feedback[v.id]) {
    VG.feedback[v.id] = { laden: true, rijen: [] };
    Promise.all([sb.from("vergadering_feedback").select("*").eq("vergadering_id", v.id).order("op", { ascending: false }).limit(500),
      sb.from("vergadering_uitvoer").select("id,versie,soort,modellen,metingen,waarschuwing,created_at").eq("vergadering_id", v.id).order("versie")]).then(([f, u]) => {
      VG.feedback[v.id] = { rijen: f.data || [], versies: u.data || [], fout: f.error?.message || u.error?.message }; render(); });
  }
  const fb = VG.feedback[v.id];
  if (fb.laden) return `<div class="panel"><div class="empty">Logboek laden…</div></div>`;
  const pts = Object.values(S.vergadering_punten || {}).filter(x => x.vergadering_id === v.id);
  const telling = (st) => pts.filter(x => x.uitvoer_id && !x.verborgen && x.status === st).length;
  const ai = pts.filter(x => x.uitvoer_id && !x.verborgen).length, handm = pts.filter(x => !x.uitvoer_id).length;
  const ACT = { bevestigd: "bevestigd", gecorrigeerd: "gecorrigeerd", afgewezen: "afgewezen", voorstel: "terug naar voorstel", toegevoegd: "toegevoegd (gemist door de AI)", aangepast: "aangepast", taak: "taak", vervangen: "vervangen door nieuwe verwerking", verslag_bewerkt: "verslag aangepast", gecontroleerd: "gecontroleerd", heropend: "heropend", gedeeld: "gedeeld met de klant", gedeeld_stop: "delen gestopt", opname: "opname opgeladen", verwerking_aangevraagd: "opnieuw verwerken gevraagd", verwerking_gestopt: "verwerking gestopt" };
  const kort = (o) => !o ? "" : esc(String(o.tekst || o.samenvatting || o.reden || o.naam || "").slice(0, 140));
  const m = (x) => x || {};
  return `<div class="grid two"><div class="panel"><div class="panel-head"><h3>Beoordeling van de AI-punten</h3></div><div class="panel-body"><div class="rend">
      <div class="panel"><div class="k">AI-voorstellen</div><div class="v">${ai}</div></div><div class="panel"><div class="k">Juist</div><div class="v">${telling("bevestigd")}</div></div>
      <div class="panel"><div class="k">Gecorrigeerd</div><div class="v">${telling("gecorrigeerd")}</div></div><div class="panel"><div class="k">Afgewezen</div><div class="v">${telling("afgewezen")}</div></div>
      <div class="panel"><div class="k">Gemist (toegevoegd)</div><div class="v">${handm}</div></div><div class="panel"><div class="k">Nog te beoordelen</div><div class="v">${telling("voorstel")}</div></div></div>
      <p class="muted" style="font-size:12px;margin:10px 0 0">Telt per vergadering; het totaal voor de proefperiode staat bij Instellingen › Vergaderingen &amp; opnames.</p></div></div>
    <div class="panel"><div class="panel-head"><h3>Verwerkingen</h3></div><div class="tw"><table class="t"><thead><tr><th>Versie</th><th>Wanneer</th><th class="r">Opname</th><th class="r">Verwerking</th><th class="r">Geheugen</th><th>Modellen</th></tr></thead><tbody>
      ${(fb.versies || []).map(x => `<tr><td>${vgN(x.versie)} <small class="muted">${x.soort === "verslag" ? "enkel verslag" : "volledig"}</small></td><td class="num">${fmtLong(lokDag(x.created_at))} ${esc(lokUur(x.created_at))}</td><td class="r num">${m(x.metingen).duur_opname_s ? vgTijd(m(x.metingen).duur_opname_s) : "—"}</td>
        <td class="r num">${m(x.metingen).totaal_s ? vgTijd(m(x.metingen).totaal_s) : "—"}${m(x.metingen).snelheid_x_realtime ? `<small class="muted" style="display:block">${nl(m(x.metingen).snelheid_x_realtime, 1)}× realtime</small>` : ""}</td>
        <td class="r num">${m(x.metingen).piek_geheugen_spraakmodel_mb ? nl(m(x.metingen).piek_geheugen_spraakmodel_mb / 1024, 1) + " GB" : "—"}</td><td style="font-size:12px">${esc(m(x.modellen).transcriptie || "")}${m(x.modellen).taalmodel ? " · " + esc(m(x.modellen).taalmodel) : " · geen taalmodel"}${m(x.metingen).tokens_in ? `<small class="muted" style="display:block">${vgN(m(x.metingen).tokens_in)} + ${vgN(m(x.metingen).tokens_uit)} tokens ≈ $ ${nl(m(x.metingen).geschatte_kost_usd || 0, 3)}</small>` : ""}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">Nog geen verwerking.</td></tr>`}</tbody></table></div></div></div>
    <div class="panel" style="margin-top:16px"><div class="panel-head"><h3>Logboek</h3><span class="muted" style="font-size:12px">wie wat bevestigde, corrigeerde, afwees of toevoegde</span></div><div class="tw"><table class="t"><tbody>
      ${fb.rijen.map(r => { const pt = r.punt_id && S.vergadering_punten?.[r.punt_id]; return `<tr><td class="num" style="white-space:nowrap">${fmtLong(lokDag(r.op))} ${esc(lokUur(r.op))}</td><td>${esc(userById(r.door).name || "—")}</td><td>${esc(ACT[r.actie] || r.actie)}${pt ? ` <small class="muted">${esc(pt.soort)}</small>` : ""}</td><td style="font-size:12px">${r.voor && r.na && kort(r.voor) !== kort(r.na) ? `<span class="muted">${kort(r.voor)}</span> → ${kort(r.na)}` : kort(r.na)}</td></tr>`; }).join("") || `<tr><td class="muted">Nog niets.</td></tr>`}</tbody></table></div></div>`;
}

/* ---------- formulieren ---------- */
function vgForm(pid, v, preset) {
  const p = S.projecten[pid]; const isNew = !v || !v.id; v = v || {}; preset = preset || {};
  const deel = new Set((v.deelnemers || preset.deelnemers || []).filter(d => d.soort === "team").map(d => d.id));
  const cdeel = new Set((v.deelnemers || preset.deelnemers || []).filter(d => d.soort === "contact").map(d => d.id));
  const vrij = (v.deelnemers || preset.deelnemers || []).filter(d => d.soort === "vrij").map(d => d.naam).join(", ");
  const contacten = typeof contactsOf === "function" ? contactsOf(pid) : [];
  const agendaVrij = (v.agenda || []).filter(a => a.soort === "vrij").map(a => a.tekst).join("\n");
  const kand = preset.kandidaten || [];
  const magCtrl = isNew || isBeheer() || v.created_by === S.me.id || p.lead === S.me.id;
  openModal(isNew ? "Nieuwe vergadering — " + projName(p) : "Vergadering bewerken", `<div class="form-grid">
    <div class="field span2"><label for="vg_ond">Onderwerp</label><input id="vg_ond" name="onderwerp" required value="${esc(v.onderwerp || preset.onderwerp || "")}" placeholder="bv. Werfvergadering keuken"></div>
    <div class="field"><label for="vg_dat">Datum</label><input id="vg_dat" type="date" name="datum" required value="${esc(v.datum || preset.datum || todayIso)}"></div>
    <div class="field"><label for="vg_tijd">Uur (optioneel)</label><input id="vg_tijd" type="time" name="tijd" value="${esc(v.tijd ? String(v.tijd).slice(0, 5) : "")}"></div>
    <div class="field span2"><label for="vg_ctrl">Verantwoordelijke voor de controle van het verslag</label><select id="vg_ctrl" name="controleur" ${magCtrl ? "" : "disabled"}><option value="">— nog te bepalen —</option>${opts(users().map(u => [u.id, u.name]), v.controleur || preset.controleur || p.lead || S.me.id)}</select>${magCtrl ? "" : `<small class="muted">Enkel een beheerder, wie de vergadering aanmaakte of de projectlead kiest de controleur.</small>`}</div>
    <div class="field span2"><label>Deelnemers van BROS <small class="muted" style="font-weight:400">— zij (en de projectlead) zien de opname en het verslag</small></label><div class="fase-list" style="max-height:160px;overflow:auto">${users().map(u => `<label class="chk"><input type="checkbox" name="team" value="${u.id}" ${deel.has(u.id) || (isNew && !preset.deelnemers && u.id === S.me.id) ? "checked" : ""}> <span>${esc(u.name)}</span></label>`).join("")}</div></div>
    ${contacten.length ? `<div class="field span2"><label>Andere deelnemers uit het project</label><div class="fase-list" style="max-height:140px;overflow:auto">${contacten.map(c => `<label class="chk"><input type="checkbox" name="contact" value="${c.c.id}" ${cdeel.has(c.c.id) ? "checked" : ""}> <span>${esc(c.c.naam)} <small class="muted">${esc(c.rol || "")}</small></span></label>`).join("")}</div></div>` : ""}
    <div class="field span2"><label for="vg_vrij">Nog andere deelnemers (namen, gescheiden door komma's)</label><input id="vg_vrij" name="vrij" value="${esc(vrij)}" placeholder="bv. Jan Peeters (elektricien)"></div>
    ${kand.length ? `<div class="field span2"><label>Op de agenda: open punten uit eerdere vergaderingen</label><div class="fase-list" style="max-height:200px;overflow:auto">${kand.map((a, i) => `<label class="chk"><input type="checkbox" name="kand" value="${i}" checked> <span>${esc(a.tekst)} <small class="muted">${a.soort === "taak" ? "open taak" : "open punt"}</small></span></label>`).join("")}</div></div>` : ""}
    <div class="field span2"><label for="vg_ag">Agenda (één punt per regel, optioneel)</label><textarea id="vg_ag" name="agenda" rows="3">${esc(agendaVrij)}</textarea></div>
  </div>`, {
    saveLabel: isNew ? "Aanmaken" : "Bewaren", wide: true,
    onSave: async (d) => {
      const f = $("#mform");
      const deelnemers = [...f.querySelectorAll('input[name="team"]:checked')].map(i => ({ soort: "team", id: i.value }))
        .concat([...f.querySelectorAll('input[name="contact"]:checked')].map(i => ({ soort: "contact", id: i.value })))
        .concat(String(d.vrij || "").split(",").map(s => s.trim()).filter(Boolean).map(naam => ({ soort: "vrij", naam: naam.slice(0, 120) })));
      const gekozen = [...f.querySelectorAll('input[name="kand"]:checked')].map(i => kand[Number(i.value)]).filter(Boolean);
      const agenda = gekozen.concat((v.agenda || []).filter(a => a.soort !== "vrij")).concat(String(d.agenda || "").split("\n").map(s => s.trim()).filter(Boolean).map(t => ({ soort: "vrij", tekst: t.slice(0, 300) })));
      const row = { onderwerp: d.onderwerp.trim(), datum: d.datum, tijd: d.tijd || null, deelnemers, agenda };
      if (magCtrl) row.controleur = d.controleur || null;
      if (isNew) { const n = await dbInsert("vergaderingen", { ...row, project_id: pid, vorige_id: preset.vorige_id || null }); VG.open = n.id; VG.tab = "verslag"; S.view = "projecten"; S.project = pid; S.ptab = "vergaderingen"; render(); toast("Vergadering aangemaakt — laad nu de opname op."); }
      else { await dbUpdate("vergaderingen", v.id, row); toast("Bewaard"); }
    },
  });
}
/* volgende vergadering: open taken en open beslissingen/vragen van eerdere vergaderingen als agenda */
function vgVolgende(pid, vorigeId) {
  const vorige = vorigeId ? S.vergaderingen[vorigeId] : vgOf(pid)[0];
  const kand = vgTakenVan(pid).filter(t => t.status !== "done").map(t => ({ soort: "taak", id: t.id, tekst: t.titel }))
    .concat(vgOpenPunten(pid).map(x => ({ soort: "punt", id: x.id, tekst: (x.soort === "vraag" ? "Open vraag: " : "Beslissing nog open: ") + x.tekst + ((x.voorwaarden || "").trim() ? " (" + x.voorwaarden + ")" : "") })));
  vgForm(pid, null, { onderwerp: vorige ? "Opvolging: " + vorige.onderwerp : "", deelnemers: vorige ? vorige.deelnemers : null, controleur: vorige ? vorige.controleur : null, vorige_id: vorige ? vorige.id : null, kandidaten: kand });
}
function vgVerslagBewaar(v, mut) {
  const vs = JSON.parse(JSON.stringify(v.verslag || {})); mut(vs);
  return dbUpdate("vergaderingen", v.id, { verslag: vs }).catch(() => { });
}
async function vgRpc(naam, args, ok) {
  const { data, error } = await sb.rpc(naam, args);
  if (error) { toast(error.message, 7000); return null; }
  if (data && data.id && data.project_id) S.vergaderingen[data.id] = data;
  if (ok) toast(ok, 4000);
  render(); return data;
}
async function vgHerlaadPunt(id) { const { data } = await sb.from("vergadering_punten").select("*").eq("id", id).single(); if (data) S.vergadering_punten[id] = data; }
async function vgPuntPatch(x, patch, ok) {
  try { await dbUpdate("vergadering_punten", x.id, patch); if (ok) toast(ok); } catch (e) { }
}
async function vgNaarTaak(x, bestaande) {
  const c = VG.concept[x.id] || {};
  const titel = (c.titel ?? x.tekst ?? "").trim(); const wie = c.wie !== undefined ? c.wie : (x.verantwoordelijke || ""); const eind = c.eind !== undefined ? c.eind : (x.deadline || "");
  if (!bestaande && titel.length < 2) { toast("Geef de taak een titel."); return; }
  const { data, error } = await sb.rpc("vergadering_punt_taak", { p_punt: x.id, p_titel: titel, p_assignee: wie || null, p_eind: eind || null, p_bestaande: bestaande || null });
  if (error) { toast(error.message, 7000); return; }
  if (data && data.taak_id) { const t = await sb.from("taken").select("*").eq("id", data.taak_id).single(); if (t.data) S.taken[t.data.id] = t.data; }
  await vgHerlaadPunt(x.id); delete VG.concept[x.id];
  toast(data.al ? "Dit punt was al een taak — er is geen tweede taak gemaakt." : data.gekoppeld ? "Gekoppeld aan de bestaande taak (notitie toegevoegd)." : (wie && eind ? "Taak aangemaakt in de takenlijst" : "Taak aangemaakt — " + [!wie && "verantwoordelijke", !eind && "deadline"].filter(Boolean).join(" en ") + " nog te bepalen"), 5000);
  render();
}
function vgDeelForm(v) {
  const pts = vgPunten(v.id).filter(x => x.status === "bevestigd" || x.status === "gecorrigeerd");
  const besl = pts.filter(x => x.soort === "beslissing"), act = pts.filter(x => x.soort === "actie"), vr = pts.filter(x => x.soort === "vraag");
  const vs = (v.verslag_gecontroleerd && v.verslag_gecontroleerd.verslag) || v.verslag || {};
  const cb = (n, l, aan, n2) => `<label class="chk"><input type="checkbox" name="${n}" ${aan ? "checked" : ""}> <span>${l}${n2 != null ? ` <small class="muted">(${n2})</small>` : ""}</span></label>`;
  openModal("Verslag delen met de klant", `<p style="margin-top:0">De klant ziet dit in het klantenportaal (Verslagen). <b>Nooit</b>: de opname, het transcript, de interne opmerking, afgewezen punten of kritieke gegevens die je niet hieronder kiest.</p>
    <div class="fase-list">${cb("samenvatting", "Korte samenvatting", true)}${cb("onderwerpen", "Besproken onderwerpen", true, (vs.onderwerpen || []).length)}${cb("beslissingen", "Beslissingen (bevestigd, met voorwaarden)", true, besl.length)}${cb("voorstellen", "Ook beslissingen die enkel voorgesteld of besproken werden", false)}${cb("acties", "Actiepunten (wat en tegen wanneer)", true, act.length)}${cb("wie", "…met de naam van wie het doet", false)}${cb("vragen", "Open vragen", true, vr.length)}</div>
    <p class="muted" style="font-size:12px">Na het delen kan je het altijd weer stoppen. Heropen je het verslag, dan stopt het delen vanzelf.</p>`, {
    saveLabel: "Delen met de klant",
    onSave: async () => {   // de inhoud stelt de databank samen uit de gecontroleerde versie (script 051): hier enkel de keuze
      const f = $("#mform"); const aan = (n) => !!f.querySelector(`input[name="${n}"]`)?.checked;
      const onderdelen = { samenvatting: aan("samenvatting"), onderwerpen: aan("onderwerpen"), beslissingen: aan("beslissingen"), voorstellen: aan("voorstellen"), acties: aan("acties"), wie: aan("wie"), vragen: aan("vragen") };
      const r = await vgRpc("vergadering_deel_klant", { p_id: v.id, p_onderdelen: onderdelen }, "Gedeeld met de klant");
      if (!r) return false;
    },
  });
}

/* ---------- Wacht op jou (wacht.js) ---------- */
function vgWachtItems() {
  if (!vgOk() || !S.me) return [];
  const uit = [];
  Object.values(S.vergaderingen).forEach(v => {
    const p = S.projecten[v.project_id]; const pn = p ? projName(p) : "";
    if (v.status === "controle" && (v.controleur === S.me.id || (!v.controleur && isBeheer()))) {
      const n = vgTeDoen(v.id).length;
      uit.push({ k: "vgc:" + v.id, stempel: v.huidige_uitvoer || v.updated_at, ic: "✎", toon: "warn", titel: "Verslag te controleren: " + v.onderwerp, sub: pn + (n ? " · " + n + " punten te beoordelen" : " · klaar om af te ronden"), wanneer: v.updated_at, pid: v.project_id, tab: "vergaderingen", vg: v.id });
    }
    if (v.status === "mislukt" && v.opname && (v.controleur === S.me.id || v.created_by === S.me.id || isBeheer()))
      uit.push({ k: "vgm:" + v.id, stempel: v.fout, ic: "!", toon: "crit", titel: "Verwerking mislukt: " + v.onderwerp, sub: pn + " · " + (v.fout || "").slice(0, 80), wanneer: v.updated_at, pid: v.project_id, tab: "vergaderingen", vg: v.id });
  });
  const w = vgVerwerker(); const wacht = vgWachtrij();
  if (isBeheer() && wacht.length && !w.online) uit.push({ k: "vgoff", stempel: wacht.length, ic: "●", toon: "crit", titel: w.bekend ? "Verwerkingscomputer niet bereikbaar" : "Nog geen verwerkingscomputer gekoppeld", sub: wacht.length + (wacht.length === 1 ? " opname wacht" : " opnames wachten") + (w.bekend ? " · laatst gezien " + fmtLong(lokDag(w.r.laatst_gezien)) + " " + lokUur(w.r.laatst_gezien) : " · Instellingen › Vergaderingen"), nav: "instellingen" });
  return uit;
}

/* ---------- takenlijst: link naar de vergadering (app.js › taakformulier) ---------- */
function vgTaakLink(t) {
  if (!t || !t.id || !vgOk()) return "";
  const pts = Object.values(S.vergadering_punten || {}).filter(x => x.taak_id === t.id);
  const v = t.vergadering_id && S.vergaderingen[t.vergadering_id];
  const links = [];
  if (v) links.push({ v, s: t.bron_sec });
  pts.forEach(x => { const vv = S.vergaderingen[x.vergadering_id]; if (vv && !links.some(l => l.v.id === vv.id && l.s === x.bron_start)) links.push({ v: vv, s: x.bron_start }); });
  if (!links.length) return t.vergadering_id ? `<div class="field span2"><label>Uit vergadering</label><div class="muted" style="font-size:13px">Deze taak komt uit een vergadering waar je geen toegang toe hebt. Vraag de controleur of projectlead om je als deelnemer toe te voegen.</div></div>` : "";
  return `<div class="field span2"><label>Uit vergadering</label><div>${links.map(l => `<div><button type="button" class="wj-t" data-vg-goto="${l.v.id}" data-s="${vgN(l.s)}">${esc(l.v.onderwerp)}</button> <small class="muted">${fmtLong(l.v.datum)}${l.s != null ? " · bron " + vgTijd(l.s) : ""}</small></div>`).join("")}</div></div>`;
}

/* ---------- Instellingen › Vergaderingen & opnames (beheer) ---------- */
function vVergaderInstellingen() {
  if (schemaV() < 51) return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h3>Vergaderingen &amp; opnames</h3><span class="pill st-offerte">nog niet geactiveerd</span></div><div class="panel-body">${SCHEMA_HINT(51)}</div></div>`;
  const w = vgVerwerker(); const i = (w.r && w.r.info) || {};
  const vs = Object.values(S.vergaderingen || {});
  const opslag = vs.reduce((s, v) => s + (Number(v.afspeel_grootte) || 0) + (v.opname && !v.inbox_leeg ? Number(v.opname.grootte) || 0 : 0), 0);
  const pts = Object.values(S.vergadering_punten || {}); const ai = pts.filter(x => x.uitvoer_id && !x.verborgen);
  const per = (s) => { const l = ai.filter(x => x.soort === s); const b = (st) => l.filter(x => x.status === st).length; return { n: l.length, ok: b("bevestigd"), cor: b("gecorrigeerd"), weg: b("afgewezen"), open: b("voorstel"), gemist: pts.filter(x => !x.uitvoer_id && x.soort === s).length }; };
  const pct = (a, n) => n ? Math.round(a / n * 100) + " %" : "—";
  const rij = (l, s) => { const r = per(s); return `<tr><td>${l}</td><td class="r num">${r.n}</td><td class="r num">${r.ok} <small class="muted">${pct(r.ok, r.n - r.open)}</small></td><td class="r num">${r.cor} <small class="muted">${pct(r.cor, r.n - r.open)}</small></td><td class="r num">${r.weg} <small class="muted">${pct(r.weg, r.n - r.open)}</small></td><td class="r num">${r.gemist}</td><td class="r num">${r.open}</td></tr>`; };
  const met = VG.metingen;
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Vergaderingen &amp; opnames</h3><div class="muted" style="font-size:12px;margin-top:2px">${vgSignaal()}</div></div></div>
    <div class="panel-body"><div class="meta">
      <div><div class="k">Verwerkingscomputer</div><div class="v">${w.bekend ? `${esc(w.r.naam)} · v${esc(w.r.versie || "?")}<small class="muted" style="display:block">laatst gemeld ${fmtLong(lokDag(w.r.laatst_gezien))} ${esc(lokUur(w.r.laatst_gezien))}</small>` : "nog niet gekoppeld"}</div></div>
      <div><div class="k">Spraakmodel (lokaal)</div><div class="v">${esc(i.model || "—")}${i.model_ok === false ? ` <span class="pill late">ontbreekt</span>` : ""}${i.vad ? `<small class="muted" style="display:block">met stiltedetectie (VAD)</small>` : ""}</div></div>
      <div><div class="k">Conceptverslag (cloud)</div><div class="v">${w.bekend ? (i.samenvatting ? esc(i.taalmodel || "aan") : `uit <small class="muted" style="display:block">geen API-sleutel — enkel transcript</small>`) : "—"}</div></div>
      <div><div class="k">Originelen naar Drive</div><div class="v">${w.bekend ? (i.drive ? "aan" : `<span class="pill late">uit</span>`) : "—"}</div></div>
      <div><div class="k">Schijf / geheugen Mac</div><div class="v num">${i.schijf_vrij_gb != null ? nl(i.schijf_vrij_gb, 1) + " GB vrij" : "—"}${i.geheugen && i.geheugen.beschikbaar_gb != null ? `<small class="muted" style="display:block">${nl(i.geheugen.beschikbaar_gb, 1)} van ${nl(i.geheugen.totaal_gb || 0, 0)} GB beschikbaar</small>` : ""}</div></div>
      <div><div class="k">Opslag Planbord (opnames)</div><div class="v num">${nl(opslag / 1048576, 0)} MB<small class="muted" style="display:block">uploads die nog niet op Drive staan + afspeelkopieën</small></div></div>
    </div>
    <div class="form-grid" style="margin-top:14px"><div class="field"><label for="vg_vw">Login van de verwerkingscomputer koppelen</label><input id="vg_vw" type="email" placeholder="verwerker@bros.be"><small class="muted">Maak de login eerst aan in Supabase › Authentication › Add user (eigen e-mailadres, sterk wachtwoord). Die login ziet enkel de opdrachten in de wachtrij.</small></div>
      <div class="field"><label>&nbsp;</label><button class="btn" data-vg-act="vw-koppel">Koppelen</button></div></div></div></div>
  <div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Evaluatie proefperiode</h3><div class="muted" style="font-size:12px;margin-top:2px">Hoe vaak waren de AI-punten juist, gecorrigeerd of afgewezen, en wat werd gemist (handmatig toegevoegd)? % = van de beoordeelde punten.</div></div>
      <div class="actions"><button class="btn sm" data-vg-act="metingen">Verwerkingsmetingen laden</button><button class="btn sm" data-vg-act="csv">Logboek exporteren (CSV)</button></div></div>
    <div class="tw"><table class="t"><thead><tr><th></th><th class="r">AI-voorstellen</th><th class="r">Juist</th><th class="r">Gecorrigeerd</th><th class="r">Afgewezen</th><th class="r">Gemist</th><th class="r">Open</th></tr></thead><tbody>
      ${rij("Beslissingen", "beslissing")}${rij("Open vragen", "vraag")}${rij("Actiepunten", "actie")}${rij("Mogelijk meerwerk", "meerwerk")}${rij("Kritieke gegevens", "gegeven")}</tbody></table></div>
    ${met ? `<div class="tw" style="border-top:1px solid var(--line)"><table class="t"><thead><tr><th>Verwerking</th><th class="r">Duur opname</th><th class="r">Verwerkingstijd</th><th class="r">× realtime</th><th class="r">Piek geheugen spraakmodel</th><th class="r">Vrij na</th><th class="r">Kost taalmodel</th></tr></thead><tbody>
      ${met.length ? met.map(x => { const m = x.metingen || {}; return `<tr><td>${fmtLong(lokDag(x.created_at))} <small class="muted">${esc((x.modellen || {}).transcriptie || "")}</small></td><td class="r num">${m.duur_opname_s ? vgTijd(m.duur_opname_s) : "—"}</td><td class="r num">${m.totaal_s ? vgTijd(m.totaal_s) : "—"}</td><td class="r num">${m.snelheid_x_realtime ? nl(m.snelheid_x_realtime, 1) : "—"}</td><td class="r num">${m.piek_geheugen_spraakmodel_mb ? nl(m.piek_geheugen_spraakmodel_mb / 1024, 2) + " GB" : "—"}</td><td class="r num">${m.vrij_gb_na != null ? nl(m.vrij_gb_na, 0) + " GB" : "—"}</td><td class="r num">${m.geschatte_kost_usd != null ? "$ " + nl(m.geschatte_kost_usd, 3) : "—"}</td></tr>`; }).join("") : `<tr><td colspan="7" class="muted">Nog geen verwerkingen.</td></tr>`}</tbody></table></div>` : ""}</div>`;
}
async function vgCsv() {
  const { data, error } = await sb.from("vergadering_feedback").select("*").order("op").limit(10000);
  if (error) { toast("Exporteren mislukt: " + error.message, 5000); return; }
  const q = (s) => '"' + String(s ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ") + '"';
  const kop = ["op", "project", "vergadering", "datum vergadering", "actie", "soort punt", "status voor", "status na", "tekst voor", "tekst na", "door"];
  const rijen = (data || []).map(r => { const v = S.vergaderingen[r.vergadering_id] || {}; const pt = r.punt_id && S.vergadering_punten[r.punt_id];
    return [r.op, projName(S.projecten[v.project_id]), v.onderwerp, v.datum, r.actie, pt ? pt.soort : "", r.voor && r.voor.status, r.na && r.na.status, r.voor && (r.voor.tekst || ""), r.na && (r.na.tekst || r.na.samenvatting || ""), userById(r.door).name].map(q).join(";"); });
  const blob = new Blob(["﻿" + kop.map(q).join(";") + "\n" + rijen.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "vergaderingen-feedback-" + todayIso + ".csv"; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ---------- gebeurtenissen ---------- */
document.addEventListener("click", (e) => {   // vóór app.js (capture): vanuit 'Wacht op jou' of een taak meteen de juiste vergadering openen
  const g = e.target.closest && e.target.closest("[data-vg-open],[data-vg-goto]"); if (!g) return;
  const id = g.dataset.vgOpen || g.dataset.vgGoto; const v = S.vergaderingen && S.vergaderingen[id]; if (!v) return;
  VG.open = id; VG.tab = "verslag"; VG.laatsteProject = v.project_id;
  if (g.dataset.vgGoto !== undefined) { e.preventDefault(); e.stopPropagation(); if (typeof closeModal === "function") closeModal(true); S.view = "projecten"; S.project = v.project_id; S.ptab = "vergaderingen"; render(); if (g.dataset.s) setTimeout(() => vgSpeel(v, Number(g.dataset.s)), 50); }
}, true);
document.addEventListener("click", async (e) => {
  const el = e.target.closest && e.target.closest("[data-vg-act]"); if (!el) return;
  const a = el.dataset.vgAct, id = el.dataset.id; const v = id && S.vergaderingen ? S.vergaderingen[id] : null; const x = id && S.vergadering_punten ? S.vergadering_punten[id] : null;
  const vx = x ? S.vergaderingen[x.vergadering_id] : null;
  if (a === "open") { VG.open = id; VG.tab = "verslag"; VG.bewerk = null; VG.toevoegen = null; render(); window.scrollTo(0, 0); return; }
  if (a === "lijst") { VG.open = null; render(); return; }
  if (a === "tab") { VG.tab = el.dataset.t; render(); return; }
  if (a === "nieuw") return vgForm(el.dataset.pid);
  if (a === "rec-snel") return vgrSnelForm(el.dataset.pid);
  if (a === "rec-start" && v) { if (!$("#vg_ok_rec")?.checked) { toast("Bevestig eerst dat de deelnemers weten dat er opgenomen wordt."); return; } return vgrStart(v); }
  if (a === "rec-pauze") return vgrPauze();
  if (a === "rec-stop") return vgrStop(false);
  if (a === "rec-weg") return vgrAnnuleer();
  if (a === "rec-herstel" && v) {
    if (VGR.noodkopie && VGR.noodkopie.vid === v.id) { const n = VGR.noodkopie; return vgrOpladen(v.id, n.blob, n.mime, n.start, true); }
    try { const m = VGR.herstel[v.id]; const b = await vgrHerstelBlob(v.id); if (!b.size) { toast("Deze kopie is leeg."); return; } return vgrOpladen(v.id, b, m.mime, m.start, false); } catch (x2) { toast("De kopie op dit toestel kon niet gelezen worden: " + ((x2 && x2.message) || x2), 8000); return; }
  }
  if (a === "rec-wees-dl") { const vid = el.dataset.vid; try { const m = VGR.herstel[vid] || {}; const b = await vgrHerstelBlob(vid); const d = new Date(m.start || Date.now()); const l = document.createElement("a"); l.href = URL.createObjectURL(b); l.download = "opname " + d.toISOString().slice(0, 16).replace("T", " ").replace(":", "u") + vgrExt(m.mime || b.type); document.body.appendChild(l); l.click(); setTimeout(() => { URL.revokeObjectURL(l.href); l.remove(); }, 2000); } catch (x2) { toast("Downloaden mislukt: " + ((x2 && x2.message) || x2), 7000); } return; }
  if (a === "rec-wees-weg") { if (!confirm("Deze opname op dit toestel weggooien? Ze kan niet hersteld worden.")) return; await vgrWis(el.dataset.vid); vgrBalk(); return; }
  if (a === "rec-herstel-weg" && v) { if (!confirm("De onafgewerkte opname op dit toestel weggooien? Ze kan niet hersteld worden.")) return; if (VGR.noodkopie && VGR.noodkopie.vid === v.id) VGR.noodkopie = null; await vgrWis(v.id); render(); return; }
  if (a === "volgende") return vgVolgende(el.dataset.pid, id || null);
  if (a === "bewerk-vg" && v) return vgForm(v.project_id, v);
  if (a === "weg" && v) { if (VGR.actief && VGR.actief.vid === v.id) { toast("Stop of gooi eerst de opname weg."); return; } if (!confirm(`Vergadering "${v.onderwerp}" verwijderen?`)) return; try { await dbDelete("vergaderingen", v.id); await vgrWis(v.id); VG.open = null; render(); } catch (x2) { } return; }
  if (a === "upload" && v) {
    const f = $("#vg_file")?.files?.[0]; if (!f) { toast("Kies eerst een opname."); return; }
    if (!$("#vg_ok")?.checked) { toast("Bevestig eerst dat de deelnemers weten dat er opgenomen werd."); return; }
    return vgOpnameOpladen(v, f, "bestand");
  }
  if (a === "speel") { const vv = v || (x && vx); if (vv) vgSpeel(vv, el.dataset.s, el.dataset.e); return; }
  if (a === "speler-sluit") { const sp = document.getElementById("vgSpeler"); if (sp) { sp.hidden = true; sp.querySelector("audio").pause(); } return; }
  if (a === "toon") { VG.tab = "transcript"; VG.zoek = ""; render(); setTimeout(() => { const s = document.getElementById("vgseg-" + el.dataset.seg); if (s) { s.scrollIntoView({ block: "center" }); s.classList.add("vg-flits"); } }, 30); return; }
  if (a === "stop" && v) { if (!confirm("De verwerking van deze opname stoppen?")) return; return vgRpc("vergadering_stop", { p_id: v.id }, "Gestopt"); }
  if (a === "opnieuw" && v) {
    if (v.status === "mislukt") return vgRpc("vergadering_verwerk", { p_id: v.id, p_soort: "volledig" }, "Opnieuw in de wachtrij");
    openModal("Opnieuw verwerken", `<p style="margin-top:0">Wat al beoordeeld is (juist, gecorrigeerd, afgewezen, taken) blijft staan; dezelfde punten komen niet dubbel terug en er komen geen dubbele taken. De eerste AI-uitvoer blijft bewaard.</p>
      <div class="fase-list"><label class="chk"><input type="radio" name="soort" value="verslag" checked> <span><b>Enkel het verslag opnieuw maken</b><small class="muted" style="display:block">Zelfde transcript, nieuw conceptverslag (cloud). Snel.</small></span></label>
      <label class="chk"><input type="radio" name="soort" value="volledig"> <span><b>Alles opnieuw</b><small class="muted" style="display:block">Opnieuw transcriberen en een nieuw verslag. Duurt even lang als de eerste keer.</small></span></label></div>${v.verslag_bewerkt_op ? `<p class="muted" style="font-size:12px">De samenvatting en onderwerpen die jullie aanpasten, worden niet overschreven.</p>` : ""}`, {
      saveLabel: "In de wachtrij", onSave: async (d) => { const r = await vgRpc("vergadering_verwerk", { p_id: v.id, p_soort: d.soort || "verslag" }, "In de wachtrij"); if (!r) return false; refetch("verwerkingen"); } });
    return;
  }
  if (a === "ok" && x) return vgPuntPatch(x, { status: "bevestigd" });
  if (a === "nee" && x) { const reden = prompt("Waarom afwijzen? (optioneel — helpt bij de evaluatie)", "") ; if (reden === null) return; return vgPuntPatch(x, { status: "afgewezen", reden: reden.trim().slice(0, 500) }); }
  if (a === "terug" && x) return vgPuntPatch(x, { status: "voorstel", reden: "" });
  if (a === "pas" && x) { VG.bewerk = x.id; render(); return; }
  if (a === "pas-weg") { VG.bewerk = null; delete VG.concept[id]; render(); return; }
  if (a === "pas-ok" && x) {
    const c = VG.concept[x.id] || {}; const patch = { status: "gecorrigeerd", tekst: (c.tekst ?? x.tekst).trim() };
    if (!patch.tekst) { toast("De tekst mag niet leeg zijn — wijs het punt af als het niet klopt."); return; }
    if (c.aard !== undefined) patch.aard = c.aard; if (c.voorwaarden !== undefined) patch.voorwaarden = c.voorwaarden.trim();
    VG.bewerk = null; delete VG.concept[x.id]; return vgPuntPatch(x, patch);
  }
  if (a === "taak" && x) return vgNaarTaak(x, null);
  if (a === "taak-alsnog" && x) { await vgPuntPatch(x, { status: "voorstel" }); return; }
  if (a === "koppel" && x) { const t = S.taken[el.dataset.taak]; if (!t || !confirm(`Geen nieuwe taak maken, maar dit punt koppelen aan "${t.titel}"? Er komt een notitie bij die taak.`)) return; return vgNaarTaak(x, t.id); }
  if (a === "plus") { VG.toevoegen = id + ":" + el.dataset.soort; render(); setTimeout(() => document.querySelector(`[data-vg-nieuw="nieuw:${id}:${el.dataset.soort}"][data-f="tekst"]`)?.focus(), 30); return; }
  if (a === "plus-weg") { VG.toevoegen = null; render(); return; }
  if (a === "plus-ok" && v) {
    const soort = el.dataset.soort; const k = "nieuw:" + v.id + ":" + soort; const c = VG.concept[k] || {};
    if (!(c.tekst || "").trim()) { toast("Vul eerst in wat er gezegd of besloten werd."); return; }
    const t = c.tijd !== false ? vgSpeeltijd() : null;
    const row = { vergadering_id: v.id, soort, tekst: c.tekst.trim().slice(0, 2000), aard: soort === "beslissing" ? (c.aard || "besloten") : soort === "actie" ? "besloten" : null, voorwaarden: (c.voorwaarden || "").trim(), bron_start: t, kritiek: soort === "gegeven", verantwoordelijke: soort === "actie" ? (c.wie || null) : null, deadline: soort === "actie" ? (c.eind || null) : null, volgorde: 9999 };
    try { await dbInsert("vergadering_punten", row); VG.toevoegen = null; delete VG.concept[k]; toast(soort === "actie" ? "Toegevoegd — maak er nu een taak van met ‘Toch een taak maken’." : "Toegevoegd"); render(); } catch (x2) { }
    return;
  }
  if (a === "ond-plus" && v) return vgVerslagBewaar(v, vs => { vs.onderwerpen = (vs.onderwerpen || []).concat([{ titel: "", tekst: "" }]); });
  if (a === "ond-weg" && v) { if (!confirm("Dit onderwerp verwijderen?")) return; return vgVerslagBewaar(v, vs => { (vs.onderwerpen || []).splice(Number(el.dataset.i), 1); }); }
  if (a === "controle" && v) { if (!confirm("Het verslag als gecontroleerd markeren? Daarna liggen verslag en punten vast.")) return; return vgRpc("vergadering_controleer", { p_id: v.id }, "Verslag gecontroleerd"); }
  if (a === "heropen" && v) { const r = prompt("Waarom heropen je dit verslag?" + (v.klant_gedeeld_op ? " (het delen met de klant stopt)" : ""), ""); if (!r) return; return vgRpc("vergadering_heropen", { p_id: v.id, p_reden: r }, "Heropend"); }
  if (a === "deel" && v) return vgDeelForm(v);
  if (a === "deel-stop" && v) { if (!confirm("Stoppen met delen? De klant ziet het verslag dan niet meer.")) return; return vgRpc("vergadering_deel_stop", { p_id: v.id }, "Delen gestopt"); }
  if (a === "vw-koppel") { const m = ($("#vg_vw")?.value || "").trim(); if (!m) { toast("Vul het e-mailadres in."); return; } const { data, error } = await sb.rpc("verwerker_instellen", { p_email: m }); if (error) { toast(error.message, 7000); return; } toast(data, 6000); refetch("profiles"); return; }
  if (a === "metingen") { const { data, error } = await sb.from("vergadering_uitvoer").select("id,vergadering_id,soort,modellen,metingen,created_at").order("created_at", { ascending: false }).limit(200); if (error) { toast(error.message, 5000); return; } VG.metingen = data || []; render(); return; }
  if (a === "csv") return vgCsv();
});
document.addEventListener("input", (e) => {
  const el = e.target; if (!el || !el.dataset) return;
  if (el.dataset.vgConcept) { (VG.concept[el.dataset.vgConcept] = VG.concept[el.dataset.vgConcept] || {})[el.dataset.f] = el.type === "checkbox" ? el.checked : el.value; return; }
  if (el.dataset.vgNieuw) { (VG.concept[el.dataset.vgNieuw] = VG.concept[el.dataset.vgNieuw] || {})[el.dataset.f] = el.type === "checkbox" ? el.checked : el.value; return; }
  if (el.matches("[data-vg-zoek]")) { VG.zoek = el.value; clearTimeout(VG.zoekT); VG.zoekT = setTimeout(() => { const pos = el.selectionStart; render(); const n = document.querySelector("[data-vg-zoek]"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) { } } }, 250); }
});
document.addEventListener("change", (e) => {
  const el = e.target; if (!el || !el.dataset) return;
  if (el.dataset.vgConcept || el.dataset.vgNieuw) { const k = el.dataset.vgConcept || el.dataset.vgNieuw; (VG.concept[k] = VG.concept[k] || {})[el.dataset.f] = el.type === "checkbox" ? el.checked : el.value; return; }
  const v = el.dataset.id && S.vergaderingen ? S.vergaderingen[el.dataset.id] : null; if (!v) return;
  if (el.dataset.vgVeld === "samenvatting") return vgVerslagBewaar(v, vs => { vs.samenvatting = el.value; });
  if (el.dataset.vgVeld === "interne_notitie") return dbUpdate("vergaderingen", v.id, { interne_notitie: el.value }).catch(() => { });
  if (el.dataset.vgOnd !== undefined) { const i = Number(el.dataset.vgOnd), f = el.dataset.f; return vgVerslagBewaar(v, vs => { vs.onderwerpen = vs.onderwerpen || []; vs.onderwerpen[i] = Object.assign({}, vs.onderwerpen[i], { [f]: el.value }); }); }
});
