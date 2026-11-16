/* =====================================================================
   BROS Planbord — werf.js (v1.72: uit app.js gehaald, ongewijzigd)
   Inhoud: notities, werfopvolging, werfplannen, werfverslagen en de AI-assistent.
   Geladen vóór app.js; gebruikt de helpers en de state (S) van app.js pas bij het aanroepen.
   ===================================================================== */
/* ---------- Notities / verslagen per project: vergaderingen, werfverslagen, feedback — met verantwoordelijken en actiepunten (taken) ---------- */
const NOTE_SOORT = { vergadering: "Vergadering", werfverslag: "Werfverslag", bespreking: "Bespreking", feedback: "Feedback klant", notitie: "Notitie" };
const NOTE_SJABLOON = {
  vergadering: "AANWEZIG\n- \n\nBESPROKEN\n1. \n2. \n\nBESLISSINGEN\n- \n\nVOLGENDE STAPPEN\n- \n\nVOLGENDE VERGADERING\n",
  werfverslag: "AANWEZIG OP DE WERF\n- \n\nSTAND VAN DE WERKEN\n- \n\nVASTSTELLINGEN / OPMERKINGEN\n- \n\nAFSPRAKEN\n- \n\nPLANNING VOLGENDE WEEK\n- \n\nVOLGEND WERFBEZOEK\n",
  bespreking: "ONDERWERP\n\n\nBESPROKEN\n- \n\nAFSPRAKEN\n- \n",
  feedback: "FEEDBACK VAN DE KLANT\n- \n\nWAT WE ERMEE DOEN\n- \n",
  notitie: "",
};
const notesOf = (pid) => Object.values(S.notities).filter(n => n.project_id === pid).sort((a, b) => (b.datum || "").localeCompare(a.datum || "") || (b.created_at || "").localeCompare(a.created_at || ""));
const noteTasks = (nid) => Object.values(S.taken).filter(t => t.notitie_id === nid).sort((a, b) => (a.eind || "9").localeCompare(b.eind || "9"));
const noteWie = (n) => [...(n.verantwoordelijken || []).map(id => S.profiles[id]?.name).filter(Boolean), ...(n.contact_ids || []).map(id => S.contacten[id]?.naam).filter(Boolean)];
const noteExcerpt = (t, n = 160) => { const s = String(t || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };
function noteCard(n, withProject) {
  const ts = noteTasks(n.id); const tl = typeof tdNoteTel === "function" ? tdNoteTel(n.id) : { tot: ts.length, open: ts.filter(t => t.status !== "done").length }; const open = tl.open; const wie = noteWie(n);
  return `<div class="note" data-act="note-open" data-id="${n.id}">
    <div class="note-head"><span class="pill phase">${NOTE_SOORT[n.soort] || esc(n.soort)}</span><span class="num muted">${fmtLong(n.datum)}</span>${n.klant_zichtbaar ? `<span class="pill st-afgerond" title="Zichtbaar voor de klant in het portaal">klant</span>` : ""}${withProject && S.projecten[n.project_id] ? `<span class="muted">· ${esc(projName(S.projecten[n.project_id]))}</span>` : ""}</div>
    <div class="note-title">${esc(n.titel || NOTE_SOORT[n.soort])}</div>
    <div class="note-body muted">${esc(noteExcerpt(n.inhoud))}</div>
    <div class="note-foot"><span class="who-cell">${n.auteur ? avatar(n.auteur) : ""}<span class="muted" style="font-size:12px">${esc(userById(n.auteur).name)}</span></span>${wie.length ? `<span class="muted" style="font-size:12px">→ ${wie.map(esc).join(", ")}</span>` : ""}${tl.tot ? `<span class="pill ${open ? "busy" : "done"}" style="font-size:11px">${open ? `${open} open` : "alles klaar"} · ${tl.tot} actiepunt${tl.tot === 1 ? "" : "en"}</span>` : ""}${n.vergadering_id ? `<span class="pill kl" title="Gemaakt uit een vergadering (opname en controle in het tabblad Vergaderingen)">🎙 vergadering</span>` : ""}</div></div>`;
}
function vNotities(p) {
  const ns = notesOf(p.id); const q = (S.noteQ || "").toLowerCase();
  const list = ns.filter(n => !q || [n.titel, n.inhoud, n.deelnemers, NOTE_SOORT[n.soort]].some(v => (v || "").toLowerCase().includes(q)));
  const openPunten = Object.values(S.taken).filter(t => t.project_id === p.id && t.notitie_id && t.status !== "done").sort((a, b) => (a.eind || "9").localeCompare(b.eind || "9"));
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Notities en verslagen</h3><div class="muted" style="font-size:12px;margin-top:2px">Vergaderingen, werfverslagen, besprekingen en feedback van dit project. Actiepunten worden taken; een verslag kan je delen met de klant.</div></div>
      <div class="actions"><input class="inline" data-noteq placeholder="Zoeken…" value="${esc(S.noteQ || "")}" style="width:160px"><button class="btn sm primary" data-act="note-new" data-pid="${p.id}">+ Notitie</button></div></div>
    ${list.length ? `<div class="notes">${list.map(n => noteCard(n)).join("")}</div>` : `<div class="empty"><b>${q ? "Niets gevonden" : "Nog geen notities"}</b>${q ? "" : "Maak een verslag van een vergadering of werfbezoek; de actiepunten komen automatisch als taken op dit project."}</div>`}</div>
    ${openPunten.length ? `<div class="panel"><div class="panel-head"><h3>Open actiepunten uit verslagen</h3><span class="muted" style="font-size:12px">${openPunten.length}</span></div><div class="tw"><table class="t"><tbody>${openPunten.map(t => `<tr class="click" data-edit-task="${t.id}"><td style="width:28px"><input type="checkbox" class="task-check" data-toggle="${t.id}" aria-label="Klaar"></td><td>${esc(t.titel)}${typeof tdTag === "function" ? tdTag(t) : ""}<small class="muted" style="display:block">📝 ${esc(S.notities[t.notitie_id]?.titel || "")} · ${fmtLong(S.notities[t.notitie_id]?.datum)}</small></td><td>${wieCell(t)}</td><td class="num" style="color:${isLate(t) ? "var(--crit)" : "inherit"}">${fmt(t.eind)}</td><td>${pill(t)}</td></tr>`).join("")}</tbody></table></div></div>` : ""}`;
}
function vNotitiesAlle() {
  const q = (S.noteQ || "").toLowerCase(); const ns = Object.values(S.notities).sort((a, b) => (b.datum || "").localeCompare(a.datum || "") || (b.created_at || "").localeCompare(a.created_at || ""));
  const list = ns.filter(n => !q || [n.titel, n.inhoud, n.deelnemers, NOTE_SOORT[n.soort], S.projecten[n.project_id]?.klant].some(v => (v || "").toLowerCase().includes(q))).slice(0, 60);
  const mine = Object.values(S.taken).filter(t => t.notitie_id && t.status !== "done" && t.assignee === S.me.id).sort((a, b) => (a.eind || "9").localeCompare(b.eind || "9"));
  return `<div class="page-head"><div><div class="eyebrow">${ns.length} notities</div><h1>Notities</h1><div class="sub">Alle verslagen over alle projecten. Nieuwe notities maak je op de projectfiche (tabblad Notities).</div></div><div class="actions"><input class="inline" data-noteq placeholder="Zoeken in titel, inhoud, project…" value="${esc(S.noteQ || "")}" style="width:260px"></div></div>
    ${mine.length ? `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><h3>Mijn open actiepunten</h3><span class="muted" style="font-size:12px">${mine.length}</span></div><div class="tw"><table class="t"><tbody>${mine.map(t => `<tr class="click" data-edit-task="${t.id}"><td style="width:28px"><input type="checkbox" class="task-check" data-toggle="${t.id}" aria-label="Klaar"></td><td>${esc(t.titel)}${typeof tdTag === "function" ? tdTag(t) : ""}<small class="muted" style="display:block">${esc(projName(S.projecten[t.project_id] || {}))} · 📝 ${esc(S.notities[t.notitie_id]?.titel || "")}</small></td><td class="num" style="color:${isLate(t) ? "var(--crit)" : "inherit"}">${fmt(t.eind)}</td><td>${pill(t)}</td></tr>`).join("")}</tbody></table></div></div>` : ""}
    ${list.length ? `<div class="notes">${list.map(n => noteCard(n, true)).join("")}</div>` : `<div class="panel"><div class="empty"><b>${q ? "Niets gevonden" : "Nog geen notities"}</b></div></div>`}`;
}
function noteForm(n = {}, pid) {
  const isNew = !n.id; const projectId = n.project_id || pid; const p = S.projecten[projectId]; if (!p) return;
  const soort = n.soort || "vergadering"; const alleTs = isNew ? [] : noteTasks(n.id); const td = typeof tdOk === "function" && tdOk(); const ts = alleTs.filter(t => !(td && t.bundel));
  const vorige = isNew ? Object.values(S.taken).filter(t => t.project_id === projectId && t.notitie_id && t.status !== "done") : [];
  const team = users(); const pcs = contactsOf(projectId);
  const vr = new Set(n.verantwoordelijken || []), cr = new Set(n.contact_ids || []);
  const taakRij = (i) => `<div class="ap-row"><input name="ap_titel_${i}" placeholder="Actiepunt / taak" style="flex:2"><select name="ap_wie_${i}">${wieOpts(projectId, { assignee: S.me.id })}</select><input name="ap_eind_${i}" type="date" title="Deadline"></div>`;
  openModal(isNew ? "Nieuwe notitie — " + p.klant : (n.titel || NOTE_SOORT[n.soort]), `<div class="form-grid">
    <div class="field"><label for="n_soort">Soort</label><select id="n_soort" name="soort">${opts(Object.entries(NOTE_SOORT), soort)}</select></div>
    <div class="field"><label for="n_datum">Datum</label><input id="n_datum" name="datum" type="date" value="${esc(n.datum || todayIso)}"></div>
    <div class="field span2"><label for="n_titel">Titel</label><input id="n_titel" name="titel" required value="${esc(n.titel || "")}" placeholder="bv. Werfvergadering 3 · keuken en badkamer"></div>
    <div class="field span2"><label for="n_deel">Aanwezig / betrokken (vrije tekst)</label><input id="n_deel" name="deelnemers" value="${esc(n.deelnemers || "")}" placeholder="bv. Phil, Noa, Jo Appelmans, schrijnwerker Peeters"></div>
    <div class="field span2"><label for="n_inhoud">Verslag ${isNew ? `<button type="button" class="btn ghost sm" data-note-sjabloon>Sjabloon invullen</button>` : ""}</label><textarea id="n_inhoud" name="inhoud" rows="14" style="font-family:var(--font-body);line-height:1.5">${esc(n.inhoud || "")}</textarea></div>
    <div class="field"><label>Verantwoordelijken — team</label><div class="fase-list">${team.map(u => `<label class="chk"><input type="checkbox" name="vr" value="${u.id}" ${vr.has(u.id) ? "checked" : ""}> <span>${esc(u.name)}</span></label>`).join("")}</div></div>
    <div class="field"><label>Verantwoordelijken — klant, aannemers en andere contacten</label>${pcs.length ? `<div class="fase-list">${pcs.map(x => `<label class="chk"><input type="checkbox" name="cr" value="${x.c.id}" ${cr.has(x.c.id) ? "checked" : ""}> <span>${esc(x.c.naam)}<small class="muted" style="display:block">${CONTACT_ROL[x.rol] || x.rol}${x.c.vakgebied ? " · " + esc(x.c.vakgebied) : ""}</small></span></label>`).join("")}</div>` : `<div class="muted" style="font-size:12px;padding:6px 0">Koppel de klant en aannemers aan dit project via Dossier › Contacten; dan kan je ze hier aanduiden.</div>`}</div>
    ${n.vergadering_id && S.vergaderingen && S.vergaderingen[n.vergadering_id] ? `<div class="field span2"><div class="muted" style="font-size:13px">🎙 Gemaakt uit de vergadering <button type="button" class="wj-t" data-vg-goto="${n.vergadering_id}">${esc(S.vergaderingen[n.vergadering_id].onderwerp)}</button> — opname, transcript en controle staan daar.</div></div>` : ""}
    <div class="field span2"><label>${td ? `To do's — één taak per verantwoordelijke, met de punten als checklist <span class="muted" style="font-weight:400">— ook voor de klant of een aannemer (die vinkt af in het portaal)</span>` : `Actiepunten → taken op dit project <span class="muted" style="font-weight:400">— ook toe te wijzen aan de klant of een aannemer; die ziet ze in het portaal</span>`}</label>
      ${td ? tdBlokken(alleTs) : ""}
      ${ts.length ? `<div class="tw" style="margin-bottom:8px"><table class="t"><tbody>${ts.map(t => `<tr><td style="width:28px"><input type="checkbox" name="ap_done_${t.id}" ${t.status === "done" ? "checked" : ""} title="Klaar"></td><td>${esc(t.titel)}</td><td>${wieCell(t)}</td><td class="num">${fmt(t.eind)}</td><td class="r"><button type="button" class="btn ghost sm" data-act="edit-task-from-note" data-tid="${t.id}">Bewerken</button></td></tr>`).join("")}</tbody></table></div>` : ""}
      <div id="ap_rows">${taakRij(0)}${taakRij(1)}${taakRij(2)}</div><button type="button" class="btn ghost sm" data-ap-more>+ Nog een actiepunt</button>
      ${vorige.length ? `<details style="margin-top:10px"><summary class="muted" style="cursor:pointer;font-size:12px">Nog ${vorige.length} open actiepunt${vorige.length === 1 ? "" : "en"} uit vorige verslagen</summary><ul style="margin:6px 0 0;padding-left:18px;font-size:13px">${vorige.map(t => `<li>${esc(t.titel)} <span class="muted">· ${esc(wieNaam(t))}${t.eind ? " · " + fmt(t.eind) : ""} · 📝 ${esc(S.notities[t.notitie_id]?.titel || "")}</span></li>`).join("")}</ul></details>` : ""}</div>
    <div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" name="klant_zichtbaar" ${n.klant_zichtbaar ? "checked" : ""}><span><b>Delen met de klant</b> — het verslag en zijn actiepunten verschijnen in het klantenportaal onder "Verslagen"${isNew || !n.klant_zichtbaar ? "; de klant krijgt een mail" : ""}. Interne opmerkingen horen dan niet in dit verslag.</span></label></div>
  </div>`, {
    wide: true, saveLabel: isNew ? "Bewaren" : "Bewaren",
    onSave: async (d) => {
      const f = $("#mform"); const vrs = [...f.querySelectorAll('input[name="vr"]:checked')].map(i => i.value), crs = [...f.querySelectorAll('input[name="cr"]:checked')].map(i => i.value);
      const wasShared = !!n.klant_zichtbaar; const shared = d.klant_zichtbaar === "on";
      const row = { project_id: projectId, soort: d.soort, titel: d.titel.trim(), datum: d.datum || todayIso, deelnemers: (d.deelnemers || "").trim(), inhoud: d.inhoud || "", verantwoordelijken: vrs, contact_ids: crs, klant_zichtbaar: shared };
      if (shared && !wasShared) row.gedeeld_op = new Date().toISOString();
      let saved;
      if (isNew) { row.auteur = S.me.id; saved = await dbInsert("notities", row); } else { saved = await dbUpdate("notities", n.id, row); }
      // bestaande actiepunten: klaar-vinkjes
      for (const t of ts) { const done = f.querySelector(`input[name="ap_done_${t.id}"]`)?.checked; if (done !== (t.status === "done")) await dbUpdate("taken", t.id, { status: done ? "done" : "todo" }).catch(() => { }); }
      // nieuwe actiepunten → taken
      const nieuw = []; f.querySelectorAll("#ap_rows .ap-row").forEach((r, i) => { const titel = r.querySelector(`[name^="ap_titel_"]`).value.trim(); if (!titel) return; nieuw.push({ project_id: projectId, titel, ...(wieSplit(r.querySelector(`[name^="ap_wie_"]`).value)), eind: r.querySelector(`[name^="ap_eind_"]`).value || null, start: r.querySelector(`[name^="ap_eind_"]`).value ? null : null, fase_nr: p.fase_nr || null, status: "todo", uren_gepland: 0, volgorde: 9000 + i, notitie_id: saved.id }); });
      let nTaken = nieuw.length;
      if (nieuw.length && td) {   // 1.63 (script 059): één to-dotaak per verantwoordelijke, de punten als checklist
        const r = await tdToevoegen(projectId, saved.id, null, nieuw.map(x => ({ tekst: x.titel, assignee: x.assignee || null, contact_id: x.contact_id || null, deadline: x.eind })));
        nTaken = r ? (r.taken || []).length : 0;
      } else if (nieuw.length) { const { data, error } = await sb.from("taken").insert(nieuw).select(); if (error) toast("Actiepunten niet aangemaakt: " + error.message); else (data || []).forEach(t => S.taken[t.id] = t); }
      render(); toast(isNew || nieuw.length ? `Notitie bewaard${nieuw.length ? td ? ` · ${nieuw.length} punt${nieuw.length === 1 ? "" : "en"} in ${nTaken} to-dotaak${nTaken === 1 ? "" : "en"}` : ` · ${nieuw.length} actiepunt${nieuw.length === 1 ? "" : "en"} als taak` : ""}` : "Notitie bewaard");
      if (shared && !wasShared && driveReady()) driveCall("notitiemail", { id: saved.id, token: S.session?.access_token || "" }).then(j => { if ((j.naar || []).length) toast("Verslag gemaild naar " + j.naar.join(", ")); }).catch(e => toast("Mail niet verstuurd: " + e.message, 6000));
    },
    onDelete: isNew ? null : async () => { await dbDelete("notities", n.id); toast("Notitie verwijderd"); },
  });
  const f = $("#mform"); let apN = 3;
  f.querySelector("[data-ap-more]").onclick = () => { $("#ap_rows").insertAdjacentHTML("beforeend", taakRij(apN++)); };
  const sj = f.querySelector("[data-note-sjabloon]"); if (sj) sj.onclick = () => { const ta = $("#n_inhoud"); if (ta.value.trim() && !confirm("De huidige tekst vervangen door het sjabloon?")) return; ta.value = NOTE_SJABLOON[$("#n_soort").value] || ""; ta.focus(); };
  $("#n_soort").addEventListener("change", () => { if (isNew && !$("#n_inhoud").value.trim()) $("#n_inhoud").value = NOTE_SJABLOON[$("#n_soort").value] || ""; });
  if (isNew && !$("#n_inhoud").value) $("#n_inhoud").value = NOTE_SJABLOON[soort] || "";
  f.querySelectorAll("[data-act=edit-task-from-note]").forEach(b => b.onclick = (e) => { e.preventDefault(); const t = S.taken[b.dataset.tid]; closeModal(); if (t) taskForm(t); });
}
/* ---------- Werfopvolging (stap 1): werfbezoeken en vaststellingen met foto's, aannemer, deadline en status ---------- */
const VS_STATUS = { open: "Open", opgelost: "Opgelost", gecontroleerd: "Gecontroleerd", vervallen: "Vervallen" };
const VS_PRIO = { laag: "Laag", normaal: "Normaal", hoog: "Hoog" };
const WEER = ["", "Zonnig", "Bewolkt", "Regen", "Wind", "Vriezend", "Sneeuw"];
const vsNr = (v) => "V-" + String(v.nr || 0).padStart(3, "0");
const vsOf = (pid) => Object.values(S.vaststellingen).filter(v => v.project_id === pid).sort((a, b) => (b.nr || 0) - (a.nr || 0));
const wbOf = (pid) => Object.values(S.werfbezoeken).filter(b => b.project_id === pid).sort((a, b) => (b.datum || "").localeCompare(a.datum || "") || (b.nr || 0) - (a.nr || 0));
const vsLate = (v) => v.status === "open" && v.deadline && v.deadline < todayIso;
const vsActief = (v) => v.status === "open" || v.status === "opgelost";
const vsWie = (v) => v.contact_id && S.contacten[v.contact_id] ? S.contacten[v.contact_id].naam : v.assignee ? userById(v.assignee).name : "";
const vsWieCell = (v) => v.contact_id || v.assignee ? wieCell(v) : `<span class="muted">niet toegewezen</span>`;
const vsPill = (v) => vsLate(v) ? `<span class="pill late">Te laat</span>` : `<span class="pill vs-${v.status}">${VS_STATUS[v.status] || esc(v.status)}</span>`;
const vsThumb = (f, cls = "") => `<img class="vs-thumb ${cls}" src="${esc(safeSrc(f.url))}" alt="" loading="lazy" data-foto="${esc(safeUrl(f.url))}">`;
const werfUrl = (pid) => new URL("werf/" + (pid ? "?p=" + pid : ""), location.href).href;
/* keuzelijst "verantwoordelijke": aannemers en andere contacten van het project, daarna het team */
const vsWieOpts = (pid, v) => { const cur = v.contact_id ? "c:" + v.contact_id : (v.assignee || ""); const pcs = contactsOf(pid); return `<option value="">— nog niet toegewezen —</option>${pcs.length ? `<optgroup label="Klant, aannemers en contacten van dit project">${opts(pcs.map(x => ["c:" + x.c.id, x.c.naam + (x.c.vakgebied ? " · " + x.c.vakgebied : "") + " · " + (CONTACT_ROL[x.rol] || x.rol)]), cur)}</optgroup>` : ""}<optgroup label="Team">${opts(users().map(u => [u.id, u.name]), cur)}</optgroup>`; };
/* foto's: verkleinen in de browser (max. 1600 px, jpeg) en uploaden naar de bucket 'werf' */
async function fotoVerklein(file, max = 1600, q = 0.82) {
  let img = null;
  if (window.createImageBitmap) img = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (!img) img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Foto niet leesbaar")); i.src = URL.createObjectURL(file); });
  const w = img.width, h = img.height, s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", q));
  return { blob, w: c.width, h: c.height };
}
async function fotoUpload(pid, vid, file) {
  const { blob, w, h } = await fotoVerklein(file);
  const path = `${pid}/${vid}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
  const { error } = await sb.storage.from("werf").upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;
  return { path, url: sb.storage.from("werf").getPublicUrl(path).data.publicUrl, w, h, op: new Date().toISOString() };
}
function fotoLightbox(url) {
  let lb = $("#lightbox"); if (!lb) { lb = document.createElement("div"); lb.id = "lightbox"; lb.className = "lightbox"; lb.onclick = () => lb.classList.remove("show"); document.body.appendChild(lb); }
  lb.innerHTML = `<img src="${esc(safeSrc(url))}" alt=""><a class="btn sm" href="${esc(safeUrl(url))}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Origineel openen</a>`; lb.classList.add("show");
}
function vsCard(v, withProject) {
  const fotos = v.fotos || []; const wie = vsWie(v);
  return `<div class="vs ${vsActief(v) ? "" : "vs-dim"}" data-act="vs-open" data-id="${v.id}">
    ${fotos.length ? `<div class="vs-fotos"><img class="vs-thumb main" src="${esc((v.gemeld_door_klant || v.gemeld_door_aannemer) && typeof werfFotoUrl === "function" ? werfFotoUrl(fotos[0].url) : safeSrc(fotos[0].url))}" alt="" loading="lazy">${fotos.length > 1 ? `<span class="vs-more">+${fotos.length - 1}</span>` : ""}</div>` : `<div class="vs-fotos vs-nofoto"><span>geen foto</span></div>`}
    <div class="vs-body">
      <div class="vs-head"><b class="num">${vsNr(v)}</b>${v.prioriteit === "hoog" ? `<span class="pill late" title="Hoge prioriteit">!</span>` : v.prioriteit === "laag" ? `<span class="pill kl">laag</span>` : ""}${v.te_beoordelen && v.status === "open" ? `<span class="pill late" title="Gemeld in het portaal of de werfmodus — de verantwoordelijke ziet het pas na goedkeuring">te beoordelen</span>` : vsPill(v)}${v.gemeld_door_aannemer ? `<span class="pill st-on_hold" title="Gemeld door ${esc(S.contacten[v.gemeld_door_aannemer]?.naam || "een aannemer")} in de werfmodus">van aannemer</span>` : ""}${v.bros_antwoord ? `<span class="pill kl" title="${esc("Antwoord: " + v.bros_antwoord.slice(0, 200))}">beantwoord</span>` : ""}${(() => { const l = String(v.opmerking || "").split("\n").filter(Boolean).pop() || ""; return /^\d\d\/\d\d \d\d:\d\d · /.test(l) && !/^\d\d\/\d\d \d\d:\d\d · BROS \(/.test(l) && vsActief(v) ? `<span class="pill late" title="${esc(l.slice(0, 240))}">💬 reactie</span>` : ""; })()}${v.gemeld_door_klant ? `<span class="pill kl" title="Gemeld door de klant">van klant</span>` : v.klant_zichtbaar ? `<span class="pill st-afgerond" title="Zichtbaar voor de klant">klant</span>` : ""}${withProject && S.projecten[v.project_id] ? `<span class="muted">· ${esc(projName(S.projecten[v.project_id]))}</span>` : ""}</div>
      ${v.titel ? `<div class="vs-title">${esc(v.titel)}</div>` : ""}<div class="vs-text ${v.titel ? "muted" : ""}">${esc(v.omschrijving || (v.titel ? "" : "—"))}</div>
      <div class="vs-meta muted">${[v.ruimte, v.lot ? lotName(v.lot) : ""].filter(Boolean).map(esc).join(" · ")}${v.plan_id && S.werfplannen[v.plan_id] ? ` <span class="pill kl" title="Aangeduid op ${esc(S.werfplannen[v.plan_id].naam)}">📍 ${esc(S.werfplannen[v.plan_id].naam)}</span>` : ""}</div>
      <div class="vs-foot"><span>${vsWieCell(v)}</span><span class="num ${vsLate(v) ? "late-txt" : "muted"}">${v.deadline ? "tegen " + fmt(v.deadline) : ""}</span></div>
    </div></div>`;
}
function vWerf(p) {
  const all = vsOf(p.id); const f = S.werfF = S.werfF || { status: "actief", wie: "", q: "", groep: false };
  const q = (f.q || "").toLowerCase();
  const list = all.filter(v => (f.status === "actief" ? vsActief(v) : f.status === "alle" ? true : v.status === f.status) && (!f.wie || (f.wie.startsWith("c:") ? v.contact_id === f.wie.slice(2) : v.assignee === f.wie)) && (!q || [v.titel, v.omschrijving, v.ruimte, vsNr(v), vsWie(v), v.lot ? lotName(v.lot) : ""].some(x => (x || "").toLowerCase().includes(q))))
    .sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || (b.nr || 0) - (a.nr || 0));
  const teBeoordelen = all.filter(v => v.te_beoordelen && v.status === "open");
  const n = { open: all.filter(v => v.status === "open").length, laat: all.filter(vsLate).length, opgelost: all.filter(v => v.status === "opgelost").length, klaar: all.filter(v => v.status === "gecontroleerd").length };
  const wieKeys = [...new Set(all.map(v => v.contact_id ? "c:" + v.contact_id : v.assignee || ""))].filter(Boolean);
  const wieLabel = (k) => k.startsWith("c:") ? (S.contacten[k.slice(2)]?.naam || "?") : userById(k).name;
  const bezoeken = wbOf(p.id);
  const kpi = `<div class="rend">
    <div class="panel"><div class="k">Open</div><div class="v">${n.open}</div></div>
    <div class="panel"><div class="k">Te laat</div><div class="v ${n.laat ? "neg" : ""}">${n.laat}</div></div>
    <div class="panel"><div class="k">Opgelost · te controleren</div><div class="v">${n.opgelost}</div></div>
    <div class="panel"><div class="k">Gecontroleerd</div><div class="v pos">${n.klaar}</div></div></div>`;
  let cards;
  const groep = f.groep === true ? "wie" : f.groep;
  if (groep === "wie") {
    const groups = {}; list.forEach(v => { const k = v.contact_id ? "c:" + v.contact_id : v.assignee || ""; (groups[k] = groups[k] || []).push(v); });
    cards = Object.keys(groups).sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || wieLabel(a).localeCompare(wieLabel(b))).map(k => `<div class="vs-group"><h4>${k ? esc(wieLabel(k)) : "Nog niet toegewezen"} <span class="muted num" style="font-weight:400">${groups[k].filter(v => v.status === "open").length} open · ${groups[k].length}</span>${k.startsWith("c:") && S.contacten[k.slice(2)]?.email ? ` <a class="muted" href="mailto:${esc(S.contacten[k.slice(2)].email)}" target="_blank" rel="noopener" style="font-weight:400;font-size:12px">${esc(S.contacten[k.slice(2)].email)}</a>` : ""}</h4><div class="vs-grid">${groups[k].map(v => vsCard(v)).join("")}</div></div>`).join("");
  } else if (groep === "lot" || groep === "ruimte") {
    const key = (v) => groep === "lot" ? (v.lot ? String(v.lot) : "") : (v.ruimte || "").trim();
    const label = (k) => !k ? (groep === "lot" ? "Zonder lot" : "Zonder ruimte") : groep === "lot" ? lotName(Number(k)) : k;
    const groups = {}; list.forEach(v => { const k = key(v); (groups[k] = groups[k] || []).push(v); });
    cards = Object.keys(groups).sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || (groep === "lot" ? Number(a) - Number(b) : a.localeCompare(b))).map(k => `<div class="vs-group"><h4>${esc(label(k))} <span class="muted num" style="font-weight:400">${groups[k].filter(v => v.status === "open").length} open · ${groups[k].length}</span></h4><div class="vs-grid">${groups[k].map(v => vsCard(v)).join("")}</div></div>`).join("");
  } else cards = `<div class="vs-grid">${list.map(v => vsCard(v)).join("")}</div>`;
  return kpi + (teBeoordelen.length ? `<div class="banner show" style="border:1px solid var(--warn);border-radius:8px;margin-bottom:16px">${teBeoordelen.length === 1 ? "Er is een werfpunt" : teBeoordelen.length + " werfpunten zijn"} gemeld door ${teBeoordelen.every(v => v.gemeld_door_aannemer) ? "een aannemer" : teBeoordelen.some(v => v.gemeld_door_aannemer) ? "de klant of een aannemer" : "de klant"} en ${teBeoordelen.length === 1 ? "wacht" : "wachten"} op jullie beoordeling (goedkeuren, antwoorden of niet weerhouden): ${teBeoordelen.slice(0, 4).map(v => `<a href="#" data-act="vs-open" data-id="${v.id}">${vsNr(v)} ${esc(v.titel || "")}</a>`).join(", ")}${teBeoordelen.length > 4 ? ", …" : ""}</div>` : "") + (typeof vVoortgang === "function" ? vVoortgang(p) : "") + vPlannen(p) + `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Vaststellingen</h3><div class="muted" style="font-size:12px;margin-top:2px">Punten van de werf met foto's, verantwoordelijke aannemer en deadline · ${all.length} in totaal</div></div>
      <div class="actions"><a class="btn sm" href="${esc(werfUrl(p.id))}" target="_blank" rel="noopener" title="Werfmodus voor op de smartphone: foto's nemen, ook zonder bereik">📱 Werfmodus</a><button class="btn sm" data-act="wb-new" data-pid="${p.id}">+ Werfbezoek</button><button class="btn sm primary" data-act="vs-new" data-pid="${p.id}">+ Vaststelling</button></div></div>
    <div class="filters" style="padding:10px 16px;border-bottom:1px solid var(--line)"><select data-werff="status">${opts([["actief", "Open en opgelost"], ["open", "Alleen open"], ["opgelost", "Opgelost · te controleren"], ["gecontroleerd", "Gecontroleerd"], ["vervallen", "Vervallen"], ["alle", "Alles"]], f.status)}</select><select data-werff="wie"><option value="">Alle verantwoordelijken</option>${opts(wieKeys.map(k => [k, wieLabel(k)]), f.wie)}</select><input data-werff="q" placeholder="Zoeken: omschrijving, ruimte, nummer…" value="${esc(f.q || "")}" style="min-width:220px"><select data-werff="groep">${opts([["", "Niet groeperen"], ["wie", "Per verantwoordelijke"], ["lot", "Per lot"], ["ruimte", "Per ruimte"]], f.groep === true ? "wie" : (f.groep || ""))}</select></div>
    ${list.length ? cards : `<div class="empty"><b>${all.length ? "Niets gevonden met deze filter" : "Nog geen vaststellingen"}</b>${all.length ? "" : "Maak een vaststelling met foto's, of open de werfmodus op je smartphone tijdens het werfbezoek."}</div>`}</div>
    <div class="panel"><div class="panel-head"><div><h3>Werfbezoeken</h3><div class="muted" style="font-size:12px;margin-top:2px">Datum, aanwezigen en algemene opmerkingen; vaststellingen hangen aan een bezoek</div></div><div class="actions"><button class="btn sm" data-act="wb-new" data-pid="${p.id}">+ Werfbezoek</button></div></div>
      ${bezoeken.length ? `<div class="tw"><table class="t"><thead><tr><th>Nr</th><th>Datum</th><th>Aanwezig</th><th>Weer</th><th>Opmerkingen</th><th class="r">Vaststellingen</th></tr></thead><tbody>${bezoeken.map(b => { const vs = all.filter(v => v.bezoek_id === b.id); return `<tr class="click" data-act="wb-open" data-id="${b.id}"><td class="num muted">${b.nr}</td><td class="num">${fmtLong(b.datum)}</td><td>${esc(b.aanwezigen || "—")}</td><td>${esc(b.weer || "—")}</td><td class="muted">${esc(noteExcerpt(b.notities, 90) || "—")}</td><td class="r num">${vs.length}${vs.filter(v => v.status === "open").length ? ` <span class="pill busy">${vs.filter(v => v.status === "open").length} open</span>` : ""}</td></tr>`; }).join("")}</tbody></table></div>` : `<div class="empty">Nog geen werfbezoeken geregistreerd.</div>`}</div>` + vWerfverslagen(p);
}
function vsForm(v = {}, pid, bezoekId) {
  const isNew = !v.id; const projectId = v.project_id || pid; const p = S.projecten[projectId]; if (!p) return;
  const fotos = [...(v.fotos || [])]; let nieuw = []; let pin = v.plan_id && v.plan_x != null ? { x: Number(v.plan_x), y: Number(v.plan_y) } : null;   // nieuw: File-objecten die bij bewaren geüpload worden
  const ruimtes = [...new Set(vsOf(projectId).map(x => x.ruimte).filter(Boolean))].sort();
  const lots = [...new Set(msRows(projectId).map(r => r.lot))].sort((a, b) => a - b);
  // 1.57.1: ook loten die (nog) niet in de meetstaat van het project staan — anders was de keuzelijst leeg bij een project zonder meetstaat in het Planbord
  const andereLots = [...new Set(Object.keys(S.loten || {}).map(Number).concat(v.lot != null ? [Number(v.lot)] : []))].filter(n => isFinite(n) && !lots.includes(n)).sort((a, b) => a - b);
  const bezoeken = wbOf(projectId);
  openModal(isNew ? "Nieuwe vaststelling — " + p.klant : `${vsNr(v)} — ${p.klant}`, `<div class="form-grid">
    <div class="field span2"><label>Foto's</label><div class="vs-foto-edit" id="vs_fotos"></div>
      <div class="actions" style="margin-top:8px"><label class="btn sm">📷 Foto's toevoegen<input type="file" accept="image/*" multiple hidden id="vs_file"></label><span class="muted" style="font-size:12px;align-self:center">Worden verkleind tot 1600 px vóór het uploaden.</span></div></div>
    <div class="field span2"><label for="vs_plan">Locatie op plan</label>${plansOf(projectId).length ? `<select id="vs_plan" name="plan_id" style="max-width:360px"><option value="">— geen plan —</option>${opts(plansOf(projectId).map(x => [x.id, x.naam]), v.plan_id || "")}</select><div id="vs_planbox" style="margin-top:8px"></div>` : `<div class="muted" style="font-size:12px">Nog geen plannen voor dit project — voeg er een toe in het paneel Plannen op het tabblad Werf.</div>`}</div>
    <div class="field span2"><label for="vs_titel">Titel <span class="muted" style="font-weight:400">— kort, voor het overzicht</span></label><input id="vs_titel" name="titel" value="${esc(v.titel || "")}" placeholder="bv. Scharnier kastdeur keuken"></div>
    <div class="field span2"><label for="vs_oms">Omschrijving</label><textarea id="vs_oms" name="omschrijving" rows="3"  placeholder="Wat is er vastgesteld en wat moet er gebeuren?">${esc(v.omschrijving || "")}</textarea></div>
    <div class="field"><label for="vs_ruimte">Ruimte / locatie</label><input id="vs_ruimte" name="ruimte" list="vs_ruimtes" value="${esc(v.ruimte || "")}" placeholder="bv. Keuken, badkamer 1e verd."><datalist id="vs_ruimtes">${ruimtes.map(r => `<option value="${esc(r)}">`).join("")}</datalist></div>
    <div class="field"><label for="vs_lot">Lot</label><select id="vs_lot" name="lot"><option value="">—</option>${lots.length ? `<optgroup label="In de meetstaat van dit project">${opts(lots.map(l => [l, lotName(l)]), v.lot ?? "")}</optgroup>` : ""}${andereLots.length ? `<optgroup label="${lots.length ? "Andere loten" : "Alle loten (nog niets in de meetstaat)"}">${opts(andereLots.map(l => [l, lotName(l)]), v.lot ?? "")}</optgroup>` : ""}</select></div>
    <div class="field"><label for="vs_wie">Verantwoordelijke</label><select id="vs_wie" name="wie">${vsWieOpts(projectId, v.te_beoordelen && !v.contact_id && !v.assignee && v.gemeld_door_aannemer ? { ...v, contact_id: v.gemeld_door_aannemer } : v)}</select><small class="muted">Wordt automatisch een taak in de takenlijst van die persoon (klant: in het portaal).</small></div>
    <div class="field"><label for="vs_deadline">Op te lossen tegen</label><input id="vs_deadline" name="deadline" type="date" value="${esc(v.deadline || "")}"></div>
    <div class="field"><label for="vs_prio">Prioriteit</label><select id="vs_prio" name="prioriteit">${opts(Object.entries(VS_PRIO), v.prioriteit || "normaal")}</select></div>
    <div class="field"><label for="vs_status">Status</label><select id="vs_status" name="status">${opts(Object.entries(VS_STATUS), v.status || "open")}</select>${v.opgelost_op ? `<small class="muted">Opgelost op ${fmtLong(lokDag(v.opgelost_op))}${v.opgelost_door ? " door " + esc(userById(v.opgelost_door).name) : ""}</small>` : ""}</div>
    <div class="field"><label for="vs_bezoek">Werfbezoek</label><select id="vs_bezoek" name="bezoek_id"><option value="">—</option>${opts(bezoeken.map(b => [b.id, `Bezoek ${b.nr} · ${fmtLong(b.datum)}`]), v.bezoek_id || bezoekId || "")}</select></div>
    ${!isNew ? `<div class="field span2"><label>Opmerkingen (gesprek met de aannemer)</label>${v.opmerking ? `<div class="vs-gesprek" style="white-space:pre-wrap;font-size:13px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface-2);max-height:180px;overflow:auto">${esc(v.opmerking)}</div>` : `<div class="muted" style="font-size:12px">Nog geen opmerkingen.</div>`}
      <textarea id="vs_reactie" name="reactie" rows="2" style="margin-top:6px" placeholder="${v.contact_id && S.contacten[v.contact_id] ? "Reactie aan " + esc(S.contacten[v.contact_id].naam) + " — komt in zijn werfmodus en portaal, en per mail" : "Opmerking toevoegen aan het gesprek"}"></textarea></div>`
      : `<div class="field"><label for="vs_opm">Opmerking / reactie</label><input id="vs_opm" name="opmerking" value="${esc(v.opmerking || "")}" placeholder="bv. antwoord van de aannemer"></div>`}
    ${(v.opgelost_fotos || []).length ? `<div class="field span2"><label>Bewijsfoto's bij de oplossing</label><div class="vs-foto-edit">${v.opgelost_fotos.map(f => vsThumb(f)).join("")}</div></div>` : ""}
    <div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" name="klant_zichtbaar" ${v.klant_zichtbaar ? "checked" : ""}><span><b>Zichtbaar voor de klant</b> — deze vaststelling verschijnt (later) in het werfverslag voor de klant in het portaal.</span></label></div>
    ${v.te_beoordelen ? `<div class="field span2"><div class="notice" style="margin:0;border-color:var(--warn)"><label class="sw-row" style="margin:0"><input type="checkbox" class="sw" name="goedkeuren" checked><span><b>Punt van ${v.gemeld_door_aannemer ? "de aannemer" : "de klant"} goedkeuren</b> — gemeld ${v.gemeld_door_aannemer ? "in de werfmodus" : "in het portaal"}${v.gemeld_door_klant && S.contacten[v.gemeld_door_klant] ? " door " + esc(S.contacten[v.gemeld_door_klant].naam) : v.gemeld_door_aannemer && S.contacten[v.gemeld_door_aannemer] ? " door " + esc(S.contacten[v.gemeld_door_aannemer].naam) : ""}. Na goedkeuring ziet de verantwoordelijke het (aannemer: in zijn portaal, met een taak). Niet terecht? Zet de status op Vervallen en schrijf je reden hieronder als antwoord.</span></label></div></div>` : ""}
    ${(v.gemeld_door_aannemer || v.gemeld_door_klant) ? `<div class="field span2"><label for="vs_antw">Antwoord aan ${v.gemeld_door_aannemer ? "de aannemer" : "de klant"} die het meldde</label><textarea id="vs_antw" name="bros_antwoord" rows="3" placeholder="bv. Goed gezien — pas het aan volgens plan T03; graag een foto als het klaar is.">${esc(v.bros_antwoord || "")}</textarea><small class="muted">Staat bij het punt in ${v.gemeld_door_aannemer ? "zijn werfmodus en aannemersportaal" : "het klantenportaal"} en gaat per mail${v.beantwoord_op ? ` · vorig antwoord ${fmtLong(lokDag(v.beantwoord_op))}${v.beantwoord_door ? " door " + esc(userById(v.beantwoord_door).name) : ""}` : ""}.</small></div>` : ""}
  </div>`, {
    wide: true,
    onSave: async (d) => {
      const f = $("#mform"); const btn = f.querySelector("button[type=submit]");
      if (!(d.titel || "").trim() && !(d.omschrijving || "").trim()) { toast("Geef een titel of omschrijving"); return false; }
      const row = { project_id: projectId, ...({ titel: (d.titel || "").trim() }), ...($("#vs_plan") ? { plan_id: d.plan_id || null, plan_x: d.plan_id && pin ? pin.x : null, plan_y: d.plan_id && pin ? pin.y : null } : {}), omschrijving: (d.omschrijving || "").trim(), ruimte: (d.ruimte || "").trim(), lot: d.lot ? Number(d.lot) : null, ...wieSplit(d.wie), deadline: d.deadline || null, prioriteit: d.prioriteit, status: d.status, bezoek_id: d.bezoek_id || null, opmerking: (d.opmerking || "").trim(), klant_zichtbaar: d.klant_zichtbaar === "on" };
      if (row.status === "opgelost" && v.status !== "opgelost" && v.status !== "gecontroleerd") { row.opgelost_op = new Date().toISOString(); row.opgelost_door = S.me.id; }
      if (row.status === "open") { row.opgelost_op = null; row.opgelost_door = null; }
      if (!isNew) delete row.opmerking;   // het gesprek niet overschrijven (de aannemer kan intussen gereageerd hebben); reacties via werfpunt_reactie
      if (v.te_beoordelen && row.status === "vervallen" && !v.contact_id && v.gemeld_door_aannemer && row.contact_id === v.gemeld_door_aannemer) row.contact_id = null;   // niet weerhouden: niet aan de melder toewijzen (script 043)
      if (v.te_beoordelen && (d.goedkeuren === "on" || row.status !== "open")) row.te_beoordelen = false;   // goedgekeurd of afgehandeld
      let saved;
      if (isNew) { row.created_by = S.me.id; row.fotos = fotos; saved = await dbInsert("vaststellingen", row); }
      else { saved = v; }
      const geupload = [];
      for (let i = 0; i < nieuw.length; i++) {
        btn.textContent = `Foto ${i + 1}/${nieuw.length} uploaden…`;
        try { geupload.push(await fotoUpload(projectId, saved.id, nieuw[i])); } catch (e) { toast("Foto niet geüpload: " + e.message); }
      }
      const alle = [...fotos, ...geupload];
      if (isNew) { if (geupload.length) await dbUpdate("vaststellingen", saved.id, { fotos: alle }); }
      else {   // 1.48: enkel bewaren wat je in dit formulier wijzigde — intussen gemelde oplossingen/foto's van de aannemer (werfmodus/portaal) blijven staan
        const { data: vers } = await sb.from("vaststellingen").select("*").eq("id", v.id).maybeSingle();
        const patch = Object.fromEntries(Object.entries(row).filter(([k, x]) => JSON.stringify(x ?? null) !== JSON.stringify(v[k] ?? null)));
        const weg = (v.fotos || []).filter(g => !fotos.some(h => h.path === g.path)).map(g => g.path);
        if (geupload.length || weg.length) patch.fotos = [...((vers && vers.fotos) || v.fotos || []).filter(g => !weg.includes(g.path)), ...geupload];
        if (Object.keys(patch).length) await dbUpdate("vaststellingen", v.id, patch);
        else if (vers) { S.vaststellingen[v.id] = vers; render(); }
      }
      if (!isNew && (d.reactie || "").trim()) {   // reactie in het gesprek met de aannemer (script 044)
        const { data: nv, error: re } = await sb.rpc("werfpunt_reactie", { p_id: v.id, p_tekst: d.reactie.trim() });
        if (re) toast("Reactie niet bewaard: " + re.message, 7000);
        else { S.vaststellingen[v.id] = { ...S.vaststellingen[v.id], ...nv }; render();
          if (driveReady()) driveCall("werfpuntreactie", { id: v.id }).then(j => toast(j && j.naar ? "Reactie gemaild naar " + j.naar : j && j.waarschuwing ? "Reactie bewaard · " + j.waarschuwing : "Reactie bewaard", 6000)).catch(e => toast("Reactie bewaard, maar niet gemaild: " + (e.message || e), 7000)); }
      }
      if (!isNew && "bros_antwoord" in d && (d.bros_antwoord || "").trim() !== (v.bros_antwoord || "").trim()) {   // antwoord aan de melder (script 043)
        await dbUpdate("vaststellingen", v.id, { bros_antwoord: (d.bros_antwoord || "").trim() });
        if ((d.bros_antwoord || "").trim() && driveReady()) driveCall("werfpuntantwoord", { id: v.id }).then(j => toast(j && j.naar ? "Antwoord gemaild naar " + j.naar : j && j.waarschuwing ? "Antwoord bewaard · " + j.waarschuwing : "Antwoord bewaard", 6000)).catch(e => toast("Antwoord bewaard, maar niet gemaild: " + (e.message || e), 7000));
      }
      toast(isNew ? `${vsNr(S.vaststellingen[saved.id] || saved)} bewaard${geupload.length ? ` · ${geupload.length} foto${geupload.length === 1 ? "" : "'s"}` : ""}` : "Vaststelling bewaard");
    },
    onDelete: isNew ? null : async () => { const paths = [...(v.fotos || []), ...(v.opgelost_fotos || [])].map(f => f.path).filter(x => x && x.startsWith(`${v.project_id}/${v.id}/`) && !x.includes("..")); await dbDelete("vaststellingen", v.id); if (paths.length) sb.storage.from("werf").remove(paths).catch(() => { }); toast("Vaststelling verwijderd"); },
  });
  const box = $("#vs_fotos");
  const draw = () => { box.innerHTML = fotos.map((f, i) => `<span class="vs-foto-item">${vsThumb(f)}<button type="button" class="vs-foto-x" data-rm="${i}" title="Verwijderen">✕</button></span>`).join("") + nieuw.map((f, i) => `<span class="vs-foto-item"><img class="vs-thumb" src="${URL.createObjectURL(f)}" alt=""><button type="button" class="vs-foto-x" data-rmn="${i}" title="Verwijderen">✕</button><span class="vs-new">nieuw</span></span>`).join("") || `<span class="muted" style="font-size:12px">Nog geen foto's.</span>`;
    box.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { fotos.splice(Number(b.dataset.rm), 1); draw(); }); box.querySelectorAll("[data-rmn]").forEach(b => b.onclick = () => { nieuw.splice(Number(b.dataset.rmn), 1); draw(); }); };
  draw();
  $("#vs_file").addEventListener("change", (e) => { nieuw = nieuw.concat([...e.target.files]); e.target.value = ""; draw(); });
  const planSel = $("#vs_plan");
  if (planSel) {
    const box = $("#vs_planbox");
    const drawPlan = () => { const pl = S.werfplannen[planSel.value]; if (!pl) { box.innerHTML = ""; return; }
      const others = vsOf(projectId).filter(x => x.plan_id === pl.id && x.id !== v.id && x.plan_x != null && vsActief(x));
      box.innerHTML = `<div class="muted" style="font-size:12px;margin-bottom:6px">Klik op het plan om de locatie aan te duiden${pin ? ` · <button type="button" class="btn ghost sm" data-pin-clear>Pin wissen</button>` : ""}</div><div class="plan-wrap" data-pinnable><img src="${esc(safeSrc(pl.url))}" alt="">${others.map(x => planPin(x, true).replace(' data-act="vs-open"', "")).join("")}${pin ? `<span class="pin mine" style="left:${pin.x * 100}%;top:${pin.y * 100}%">${v.nr || "●"}</span>` : ""}</div>`;
      box.querySelector("[data-pinnable]").onclick = (e) => { if (e.target.closest(".pin") && !e.target.classList.contains("mine")) return; const img = box.querySelector("img"); const r = img.getBoundingClientRect(); pin = { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; drawPlan(); };
      const cl = box.querySelector("[data-pin-clear]"); if (cl) cl.onclick = () => { pin = null; drawPlan(); }; };
    planSel.addEventListener("change", () => { pin = null; drawPlan(); }); drawPlan();
  }
}
/* ---------- Werfplannen (stap 2): plannen per project, pin per vaststelling ---------- */
const plansOf = (pid) => Object.values(S.werfplannen).filter(x => x.project_id === pid).sort((a, b) => (a.volgorde ?? 0) - (b.volgorde ?? 0) || (a.naam || "").localeCompare(b.naam || ""));
const planPin = (v, dim) => `<span class="pin vs-${v.status} ${dim ? "dim" : ""}" style="left:${Number(v.plan_x) * 100}%;top:${Number(v.plan_y) * 100}%" data-act="vs-open" data-id="${v.id}" title="${esc(vsNr(v) + " · " + (v.titel || v.omschrijving || ""))}">${v.nr || "•"}</span>`;
async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  await new Promise((res, rej) => { const el = document.createElement("script"); el.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"; el.onload = res; el.onerror = () => rej(new Error("pdf.js kon niet geladen worden")); document.head.appendChild(el); });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  return window.pdfjsLib;
}
/* pdf → één jpeg per pagina (max. 10 pagina's, langste zijde 2600 px); afbeelding → verkleind */
async function planToImages(file, max = 2600) {
  if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
    const pdfjs = await loadPdfJs(); const doc = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise; const out = [];
    for (let i = 1; i <= Math.min(doc.numPages, 10); i++) {
      const page = await doc.getPage(i); const v1 = page.getViewport({ scale: 1 }); const scale = max / Math.max(v1.width, v1.height); const vp = page.getViewport({ scale });
      const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height); const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      out.push({ blob: await new Promise(r => c.toBlob(r, "image/jpeg", 0.86)), w: c.width, h: c.height, page: i, pages: doc.numPages });
    }
    return out;
  }
  const r = await fotoVerklein(file, max, 0.86); return [{ ...r, page: 1, pages: 1 }];
}
function planForm(pid) {
  const p = S.projecten[pid]; if (!p) return;
  openModal("Plan toevoegen — " + p.klant, `<div class="form-grid">
    <div class="field span2"><label for="pl_file">Bestand (pdf of afbeelding)</label><input id="pl_file" name="file" type="file" accept="application/pdf,image/*" required><small class="muted">Van een pdf worden de pagina's (max. 10) elk als plan opgeslagen. Tip: één plan per verdieping.</small></div>
    <div class="field span2"><label for="pl_naam">Naam</label><input id="pl_naam" name="naam" placeholder="bv. Gelijkvloers, 1e verdieping"></div>
  </div>`, {
    saveLabel: "Toevoegen",
    onSave: async (d) => {
      const f = $("#pl_file").files[0]; if (!f) { toast("Kies een bestand"); return false; }
      const btn = $("#mform button[type=submit]"); btn.textContent = "Plan omzetten…";
      let pages; try { pages = await planToImages(f); } catch (e) { toast("Plan niet leesbaar: " + e.message, 6000); return false; }
      const base = (d.naam || "").trim() || f.name.replace(/\.[^.]+$/, ""); const n0 = plansOf(pid).length; const rows = [];
      for (let i = 0; i < pages.length; i++) {
        btn.textContent = `Pagina ${i + 1}/${pages.length} uploaden…`;
        const path = `${pid}/plannen/${Date.now()}-${i + 1}.jpg`;
        const { error } = await sb.storage.from("werf").upload(path, pages[i].blob, { contentType: "image/jpeg" });
        if (error) { toast("Upload mislukt: " + error.message, 6000); return false; }
        rows.push({ project_id: pid, naam: pages.length > 1 ? `${base} · p${pages[i].page}` : base, path, url: sb.storage.from("werf").getPublicUrl(path).data.publicUrl, w: pages[i].w, h: pages[i].h, volgorde: n0 + i + 1, created_by: S.me.id });
      }
      const { data, error } = await sb.from("werfplannen").insert(rows).select(); if (error) { toast("Bewaren mislukt: " + error.message, 6000); return false; }
      (data || []).forEach(r => S.werfplannen[r.id] = r); render(); toast(`${rows.length} plan${rows.length === 1 ? "" : "nen"} toegevoegd`);
    },
  });
}
function vPlannen(p) {
  const pls = plansOf(p.id); const all = vsOf(p.id);
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Plannen</h3><div class="muted" style="font-size:12px;margin-top:2px">Duid per vaststelling de locatie aan op een plan; klik op een plan voor het overzicht van de punten.</div></div><div class="actions"><button class="btn sm" data-act="plan-new" data-pid="${p.id}">+ Plan</button></div></div>
    ${pls.length ? `<div class="plan-grid">${pls.map(pl => { const n = all.filter(v => v.plan_id === pl.id && v.plan_x != null && v.status === "open").length; return `<div class="plan-card" data-act="plan-view" data-id="${pl.id}"><img src="${esc(safeSrc(pl.url))}" alt="" loading="lazy"><div class="plan-name"><span>${esc(pl.naam)}</span>${n ? `<span class="pill vs-open">${n} open</span>` : ""}</div></div>`; }).join("")}</div>` : `<div class="empty" style="padding:16px">Nog geen plannen. Voeg een pdf (grondplan per verdieping) of afbeelding toe.</div>`}</div>`;
}
function planView(id) {
  const pl = S.werfplannen[id]; if (!pl) return; const p = S.projecten[pl.project_id];
  const f = S.werfF || { status: "actief" };
  const pts = vsOf(pl.project_id).filter(v => v.plan_id === id && v.plan_x != null).filter(v => f.status === "actief" ? vsActief(v) : f.status === "alle" ? true : v.status === f.status);
  openModal(`${pl.naam} — ${p ? p.klant : ""}`, `<div class="muted" style="font-size:12px;margin-bottom:8px">${pts.length} punt${pts.length === 1 ? "" : "en"} op dit plan (filter van het tabblad Werf) · klik op een pin om de vaststelling te openen</div>
    <div class="plan-wrap big"><img src="${esc(safeSrc(pl.url))}" alt="">${pts.map(v => planPin(v)).join("")}</div>
    ${pts.length ? `<div class="tw" style="margin-top:10px"><table class="t"><tbody>${pts.sort((a, b) => (a.nr || 0) - (b.nr || 0)).map(v => `<tr class="click" data-act="vs-open" data-id="${v.id}"><td class="num" style="width:60px">${vsNr(v)}</td><td>${esc(v.titel || noteExcerpt(v.omschrijving, 80))}<small class="muted" style="display:block">${esc(v.ruimte || "")}</small></td><td>${esc(vsWie(v) || "—")}</td><td>${vsPill(v)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    <div style="margin-top:12px;display:flex;gap:8px;align-items:center"><input class="inline" data-plan-naam value="${esc(pl.naam)}" style="max-width:260px" title="Naam van het plan"><a class="btn sm" href="${esc(safeUrl(pl.url))}" target="_blank" rel="noopener">Origineel openen</a></div>`, {
    wide: true, saveLabel: "Sluiten",
    onSave: async () => { const naam = $("[data-plan-naam]").value.trim(); if (naam && naam !== pl.naam) await dbUpdate("werfplannen", id, { naam }); },
    onDelete: async () => { const n = vsOf(pl.project_id).filter(v => v.plan_id === id).length; if (n && !confirm(`${n} vaststelling${n === 1 ? " verwijst" : "en verwijzen"} naar dit plan; die pins gaan verloren. Toch verwijderen?`)) throw new Error("geannuleerd"); await dbDelete("werfplannen", id); if (pl.path) sb.storage.from("werf").remove([pl.path]).catch(() => { }); Object.values(S.vaststellingen).forEach(v => { if (v.plan_id === id) { v.plan_id = null; } }); toast("Plan verwijderd"); },
  });
  $("#mform").querySelectorAll("[data-act=vs-open]").forEach(el => el.onclick = (e) => { e.preventDefault(); e.stopPropagation(); if (!closeModal()) return; vsForm(S.vaststellingen[el.dataset.id]); });
}
function wbForm(b = {}, pid) {
  const isNew = !b.id; const projectId = b.project_id || pid; const p = S.projecten[projectId]; if (!p) return;
  const vs = isNew ? [] : vsOf(projectId).filter(v => v.bezoek_id === b.id).sort((a, c) => (a.lot || 999) - (c.lot || 999) || (a.nr || 0) - (c.nr || 0));
  openModal(isNew ? "Werfbezoek — " + p.klant : `Werfbezoek ${b.nr} — ${p.klant}`, `<div class="form-grid">
    <div class="field"><label for="wb_datum">Datum</label><input id="wb_datum" name="datum" type="date" value="${esc(b.datum || todayIso)}" required></div>
    <div class="field"><label for="wb_weer">Weer</label><select id="wb_weer" name="weer">${opts(WEER.map(w => [w, w || "—"]), b.weer || "")}</select></div>
    <div class="field span2"><label for="wb_aanw">Aanwezig</label><input id="wb_aanw" name="aanwezigen" value="${esc(b.aanwezigen || "")}" placeholder="bv. Phil, Jo Appelmans, schrijnwerker Peeters"></div>
    <div class="field span2"><label for="wb_not">Algemene opmerkingen / stand van de werken</label><textarea id="wb_not" name="notities" rows="6">${esc(b.notities || "")}</textarea></div>
    ${isNew ? "" : `<div class="field span2"><button type="button" class="btn sm primary" data-wb-verslag>Werfverslag maken van dit bezoek</button></div>`}
    ${isNew ? "" : `<div class="field span2"><label>Vaststellingen bij dit bezoek <span class="muted" style="font-weight:400">${vs.length}</span> <button type="button" class="btn ghost sm" data-wb-vs>+ Vaststelling</button></label>${vs.length ? (() => { const byLot = {}; vs.forEach(v => (byLot[v.lot || 0] = byLot[v.lot || 0] || []).push(v)); const lots = Object.keys(byLot).map(Number).sort((a, c) => (a ? 0 : 1) - (c ? 0 : 1) || a - c);
        return `<div class="tw"><table class="t"><tbody>${lots.map(nr => `<tr><td colspan="4" style="background:var(--surface-2);font-weight:600;font-size:12px">${nr ? esc(lotName(nr)) : "Zonder lot"} <span class="muted num" style="font-weight:400">${byLot[nr].filter(v => v.status === "open").length} open · ${byLot[nr].length}</span></td></tr>` + byLot[nr].map(v => `<tr class="click" data-wb-open="${v.id}"><td class="num" style="width:60px">${vsNr(v)}</td><td>${v.titel ? `<b>${esc(v.titel)}</b><small class="muted" style="display:block">${esc(noteExcerpt(v.omschrijving, 80))}${v.ruimte ? " · " + esc(v.ruimte) : ""}</small>` : `${esc(noteExcerpt(v.omschrijving, 80))}<small class="muted" style="display:block">${esc(v.ruimte || "")}</small>`}</td><td>${esc(vsWie(v) || "—")}</td><td>${vsPill(v)}</td></tr>`).join("")).join("")}</tbody></table></div>`; })() : `<div class="muted" style="font-size:12px">Nog geen vaststellingen aan dit bezoek gekoppeld.</div>`}</div>`}
  </div>`, {
    wide: true,
    onSave: async (d) => {
      const row = { project_id: projectId, datum: d.datum || todayIso, weer: d.weer || "", aanwezigen: (d.aanwezigen || "").trim(), notities: d.notities || "" };
      if (isNew) { row.auteur = S.me.id; const saved = await dbInsert("werfbezoeken", row); toast(`Werfbezoek ${saved.nr} bewaard`); }
      else { await dbUpdate("werfbezoeken", b.id, row); toast("Werfbezoek bewaard"); }
    },
    onDelete: isNew ? null : async () => { await dbDelete("werfbezoeken", b.id); toast("Werfbezoek verwijderd"); },
  });
  const f = $("#mform");
  const add = f.querySelector("[data-wb-vs]"); if (add) add.onclick = () => { if (!closeModal()) return; vsForm({}, projectId, b.id); };
  const wv = f.querySelector("[data-wb-verslag]"); if (wv) wv.onclick = () => { if (!closeModal()) return; wvForm(projectId, b.id); };
  f.querySelectorAll("[data-wb-open]").forEach(r => r.onclick = () => { if (!closeModal()) return; vsForm(S.vaststellingen[r.dataset.wbOpen]); });
}
/* ---------- Werfverslagen (stap 2b): pdf in de browser (jsPDF), bewaard in de bucket 'werf', gemaild via het Drive-script ---------- */
const wvOf = (pid) => Object.values(S.werfverslagen).filter(w => w.project_id === pid).sort((a, b) => (b.nr || 0) - (a.nr || 0));
async function loadJsPdf() {
  if (window.jspdf && window.jspdf.jsPDF) return window.jspdf.jsPDF;
  await new Promise((res, rej) => { const el = document.createElement("script"); el.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"; el.onload = res; el.onerror = () => rej(new Error("jsPDF kon niet geladen worden")); document.head.appendChild(el); });
  return window.jspdf.jsPDF;
}
/* afbeelding van een url → jpeg-dataURL (verkleind), via canvas; mislukt → null */
async function imgData(url, max = 900, q = 0.8) {
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => rej(new Error("img")); i.src = url; });
    const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s));
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    return { data: c.toDataURL("image/jpeg", q), w: c.width, h: c.height, canvas: c };
  } catch (e) { return null; }
}
/* plan met pins getekend → jpeg-dataURL */
async function planData(pl, pts) {
  const r = await imgData(pl.url, 1800, 0.85); if (!r) return null;
  const ctx = r.canvas.getContext("2d"); const R = Math.max(12, Math.round(r.w / 70));
  const kleur = { open: "#B93A34", opgelost: "#B8720F", gecontroleerd: "#2E7D4F", vervallen: "#86868B" };
  pts.forEach(v => { const x = Number(v.plan_x) * r.w, y = Number(v.plan_y) * r.h; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fillStyle = kleur[v.status] || "#B93A34"; ctx.fill(); ctx.lineWidth = Math.max(2, R / 6); ctx.strokeStyle = "#fff"; ctx.stroke(); ctx.fillStyle = "#fff"; ctx.font = `bold ${Math.round(R * 1.1)}px Helvetica, Arial, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(v.nr || "•"), x, y + R * 0.05); });
  return { data: r.canvas.toDataURL("image/jpeg", 0.85), w: r.w, h: r.h };
}
async function logoData() {
  try { const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = "logo-mark.svg"; }); const c = document.createElement("canvas"); c.width = 600; c.height = 181; c.getContext("2d").drawImage(img, 0, 0, 600, 181); return c.toDataURL("image/png"); } catch (e) { return null; }
}
/* Het pdf-document. opts: { punten, groep: "lot"|"wie", bezoek, bericht } */
async function wvBuildPdf(p, opts, progress = () => { }) {
  const jsPDF = await loadJsPdf(); const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const W = 210, H = 297, M = 15, CW = W - 2 * M; let y = M; const logo = await logoData();
  const ink = [29, 29, 31], muted = [134, 134, 139], line = [220, 220, 224];
  const kleur = { open: [185, 58, 52], opgelost: [184, 114, 15], gecontroleerd: [46, 125, 79], vervallen: [134, 134, 139] };
  const clean = (s) => String(s || "").replace(/→/g, "->").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/•/g, "-");
  const header = () => { if (logo) doc.addImage(logo, "PNG", M, 10, 26, 7.8); doc.setFontSize(8); doc.setTextColor(...muted); doc.text(`${clean(projName(p))} · Werfverslag ${opts.nr}`, W - M, 15, { align: "right" }); doc.setDrawColor(...line); doc.line(M, 20, W - M, 20); y = 26; };
  const footer = () => { const n = doc.getNumberOfPages(); for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(...muted); doc.text(`BROS · ${fmtLong(opts.datum)}`, M, H - 8); doc.text(`${i} / ${n}`, W - M, H - 8, { align: "right" }); } };
  const need = (h) => { if (y + h > H - 16) { doc.addPage(); header(); } };
  const text = (s, size, style = "normal", color = ink, width = CW, x = M, lh = 1.35) => { doc.setFont("helvetica", style); doc.setFontSize(size); doc.setTextColor(...color); const lines = doc.splitTextToSize(clean(s), width); const h = lines.length * size * 0.3528 * lh; need(h); doc.text(lines, x, y + size * 0.3528 * 0.85); y += h; return h; };
  header();
  // titel
  doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.setTextColor(...ink); doc.text(`Werfverslag ${opts.nr}`, M, y + 6); y += 10;
  text(`${projName(p)}${p.adres ? " · " + p.adres + (p.gemeente ? ", " + [p.postcode, p.gemeente].filter(Boolean).join(" ") : "") : ""}`, 11, "normal", muted); y += 2;
  const b = opts.bezoek; const meta = [["Datum", fmtLong(opts.datum)], b && b.aanwezigen ? ["Aanwezig", b.aanwezigen] : null, b && b.weer ? ["Weer", b.weer] : null, ["Opgemaakt door", userById(S.me.id).name]].filter(Boolean);
  meta.forEach(([k, v]) => { doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...muted); doc.text(k.toUpperCase(), M, y + 3); doc.setFont("helvetica", "normal"); doc.setTextColor(...ink); doc.setFontSize(10); const lines = doc.splitTextToSize(clean(v), CW - 38); doc.text(lines, M + 38, y + 3); y += Math.max(5, lines.length * 4.2); });
  y += 2;
  if (opts.bericht) { y += 2; text(opts.bericht, 10.5, "normal", ink); y += 2; }
  if (b && b.notities) { y += 3; text("Stand van de werken", 12, "bold"); y += 1; text(b.notities, 10, "normal", ink); y += 2; }
  // samenvatting
  const pts = opts.punten; const nOpen = pts.filter(v => v.status === "open").length, nOpg = pts.filter(v => v.status === "opgelost").length, nGec = pts.filter(v => v.status === "gecontroleerd").length;
  y += 4; text("Vaststellingen", 14, "bold"); text(`${pts.length} punten in dit verslag · ${nOpen} open · ${nOpg} opgelost (te controleren) · ${nGec} gecontroleerd`, 9.5, "normal", muted); y += 3;
  // groepen
  const groups = {}; const gkey = (v) => opts.groep === "wie" ? (v.contact_id ? "c:" + v.contact_id : v.assignee || "") : String(v.lot || 0);
  const glabel = (k) => opts.groep === "wie" ? (!k ? "Nog niet toegewezen" : k.startsWith("c:") ? (S.contacten[k.slice(2)]?.naam || "?") : userById(k).name) : (k === "0" ? "Zonder lot" : lotName(Number(k)));
  pts.forEach(v => (groups[gkey(v)] = groups[gkey(v)] || []).push(v));
  const keys = Object.keys(groups).sort((a, c) => opts.groep === "wie" ? ((a ? 0 : 1) - (c ? 0 : 1) || glabel(a).localeCompare(glabel(c))) : ((a === "0" ? 1 : 0) - (c === "0" ? 1 : 0) || Number(a) - Number(c)));
  let done = 0;
  for (const k of keys) {
    need(14); y += 3; doc.setFillColor(240, 240, 242); doc.roundedRect(M, y, CW, 8, 2, 2, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(...ink); doc.text(clean(glabel(k)), M + 3, y + 5.5); doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...muted); doc.text(`${groups[k].filter(v => v.status === "open").length} open · ${groups[k].length}`, W - M - 3, y + 5.5, { align: "right" }); y += 11;
    for (const v of groups[k].sort((a, c) => (a.nr || 0) - (c.nr || 0))) {
      progress(`Punt ${++done}/${pts.length}…`);
      const fotos = (v.fotos || []).slice(0, 3); const imgs = []; for (const f of fotos) { const d = await imgData(f.url, 700, 0.78); if (d) imgs.push(d); }
      const ph = imgs.length ? 42 : 0; const pw = imgs.length ? Math.min(56, (CW - (imgs.length - 1) * 3) / imgs.length) : 0;
      need(16 + ph);
      // kop: nummer + titel + status
      const y0 = y; doc.setFillColor(...(kleur[v.status] || kleur.open)); doc.roundedRect(M, y + 0.5, 13, 6, 3, 3, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(255, 255, 255); doc.text(vsNr(v), M + 6.5, y + 4.6, { align: "center" });
      doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...ink); const titel = clean(v.titel || noteExcerpt(v.omschrijving, 90) || "(zonder titel)"); doc.text(doc.splitTextToSize(titel, CW - 50)[0], M + 16, y + 4.8);
      const st = (vsLate(v) ? "TE LAAT" : VS_STATUS[v.status].toUpperCase()) + (v.prioriteit === "hoog" ? " · PRIORITEIT" : ""); doc.setFontSize(8); doc.setTextColor(...(kleur[v.status] || kleur.open)); doc.text(st, W - M, y + 4.6, { align: "right" }); y += 8;
      const meta2 = [vsWie(v) ? "Verantwoordelijke: " + vsWie(v) : "Nog niet toegewezen", v.ruimte ? "Ruimte: " + v.ruimte : "", v.deadline ? "Tegen: " + fmtLong(v.deadline) : "", v.plan_id && S.werfplannen[v.plan_id] ? "Plan: " + S.werfplannen[v.plan_id].naam : "", v.opgelost_op ? "Opgelost op " + fmtLong(lokDag(v.opgelost_op)) : ""].filter(Boolean).join("   ·   ");
      text(meta2, 8.5, "normal", muted);
      if (v.omschrijving && v.titel) text(v.omschrijving, 9.5, "normal", ink);
      if (v.opmerking) text("Opmerking: " + (String(v.opmerking).split("\n").filter(Boolean).pop() || ""), 9, "italic", muted);   // enkel de laatste regel (het gesprek met de aannemer blijft intern, script 044)
      if (imgs.length) { y += 1.5; need(ph + 2); imgs.forEach((im, i) => { const r = im.w / im.h; let w = pw, h = ph; if (w / h > r) w = h * r; else h = w / r; doc.addImage(im.data, "JPEG", M + i * (pw + 3), y, w, h); }); y += ph + 1.5; }
      y += 2; doc.setDrawColor(...line); doc.line(M, y, W - M, y); y += 3;
      if (y0 > y) { /* nooit */ }
    }
  }
  // plannen
  const plannen = plansOf(p.id).filter(pl => pts.some(v => v.plan_id === pl.id && v.plan_x != null));
  for (const pl of plannen) {
    progress(`Plan ${pl.naam}…`); const d = await planData(pl, pts.filter(v => v.plan_id === pl.id && v.plan_x != null)); if (!d) continue;
    doc.addPage(); header(); text("Plan · " + pl.naam, 14, "bold"); text("Nummers = vaststellingen · rood open, oranje opgelost, groen gecontroleerd", 9, "normal", muted); y += 3;
    const r = d.w / d.h; let w = CW, h = CW / r; const maxH = H - y - 14; if (h > maxH) { h = maxH; w = h * r; }
    doc.addImage(d.data, "JPEG", M + (CW - w) / 2, y, w, h);
  }
  footer();
  return doc.output("blob");
}
function wvForm(pid, bezoekId) {
  const p = S.projecten[pid]; if (!p) return; 
  const bez = wbOf(pid); const all = vsOf(pid);
  const pcs = contactsOf(pid).filter(x => x.c.email); const nr = (wvOf(pid)[0]?.nr || 0) + 1;
  const puntenVoor = (sel, bid, klant) => all.filter(v => !(v.te_beoordelen && v.status === "open")).filter(v => sel === "bezoek" ? v.bezoek_id === bid : sel === "open" ? v.status === "open" : vsActief(v)).filter(v => !klant || v.klant_zichtbaar);   // punten van de klant pas na goedkeuring
  const betrokken = (pts) => new Set(pts.map(v => v.contact_id).filter(Boolean));
  openModal(`Werfverslag ${nr} — ${p.klant}`, `<div class="form-grid">
    <div class="field"><label for="wv_bezoek">Werfbezoek</label><select id="wv_bezoek" name="bezoek_id"><option value="">— geen (los verslag) —</option>${opts(bez.map(x => [x.id, `Bezoek ${x.nr} · ${fmtLong(x.datum)}${x.aanwezigen ? " · " + x.aanwezigen : ""}`]), bezoekId || bez[0]?.id || "")}</select></div>
    <div class="field"><label for="wv_datum">Datum verslag</label><input id="wv_datum" name="datum" type="date" value="${todayIso}"></div>
    <div class="field"><label for="wv_sel">Welke punten</label><select id="wv_sel" name="sel">${opts([["actief", "Alle open en opgeloste punten van het project"], ["open", "Alleen open punten"], ["bezoek", "Alleen de punten van dit werfbezoek"]], "actief")}</select></div>
    <div class="field"><label for="wv_groep">Groeperen</label><select id="wv_groep" name="groep">${opts([["lot", "Per lot"], ["wie", "Per verantwoordelijke"]], "lot")}</select></div>
    <div class="field span2"><label for="wv_bericht">Bericht bovenaan het verslag en in de mail</label><textarea id="wv_bericht" name="bericht" rows="3" placeholder="bv. Beste, hierbij de vaststellingen van het werfbezoek van vandaag. Graag de open punten tegen de vermelde datum in orde brengen."></textarea></div>
    <div class="field span2"><label>Versturen naar</label>${pcs.length ? `<div class="fase-list" id="wv_aan">${pcs.map(x => `<label class="chk"><input type="checkbox" name="aan" value="${esc(x.c.email)}" data-cid="${x.c.id}" data-rol="${esc(x.rol)}"> <span>${esc(x.c.naam)}<small class="muted" style="display:block">${CONTACT_ROL[x.rol] || x.rol} · ${esc(x.c.email)}</small></span></label>`).join("")}</div>` : `<div class="muted" style="font-size:12px">Geen contacten met e-mailadres gekoppeld aan dit project (Dossier › Contacten).</div>`}<input name="extra" placeholder="Extra e-mailadressen, gescheiden door komma's" style="margin-top:8px"></div>
    <div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" name="klant_zichtbaar"><span><b>Delen met de klant in het portaal</b> — het verslag (pdf) verschijnt onder Verslagen. Tip: kies dan "Alleen punten zichtbaar voor de klant" hieronder als er interne punten in zitten.</span></label></div>
    <div class="field span2"><label class="chk" style="font-size:13px"><input type="checkbox" name="alleen_klant"> Alleen punten met "zichtbaar voor de klant" opnemen</label></div>
    ${p.drive_folder_id && driveReady() ? `<div class="field span2"><label class="chk" style="font-size:13px"><input type="checkbox" name="drive" checked> Ook bewaren in de Drive-map (Werfcontrole)</label></div>` : ""}
    <div class="field span2"><div class="muted" id="wv_info" style="font-size:12px"></div></div>
  </div>`, {
    wide: true, saveLabel: "Verslag maken en versturen",
    onSave: async (d) => {
      const f = $("#mform"); const btn = f.querySelector("button[type=submit]");
      const bid = d.bezoek_id || null; const pts = puntenVoor(d.sel, bid, d.alleen_klant === "on");
      if (!pts.length) { toast("Geen punten voor dit verslag"); return false; }
      const aan = [...new Set([...f.querySelectorAll('input[name="aan"]:checked')].map(i => i.value).concat((d.extra || "").split(/[,;\s]+/).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))))];
      const b = bid ? S.werfbezoeken[bid] : null; const datum = d.datum || todayIso;
      try {
        const blob = await wvBuildPdf(p, { nr, datum, bezoek: b, bericht: (d.bericht || "").trim(), punten: pts, groep: d.groep }, (m) => { btn.textContent = m; });
        btn.textContent = "Pdf bewaren…";
        const path = `${pid}/verslagen/werfverslag-${String(nr).padStart(2, "0")}-${datum}-${(crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)).replace(/-/g, "").slice(0, 16)}.pdf`;
        const { error } = await sb.storage.from("werf").upload(path, blob, { contentType: "application/pdf", upsert: true }); if (error) throw error;
        const url = sb.storage.from("werf").getPublicUrl(path).data.publicUrl;
        const titel = `Werfverslag ${nr} · ${fmtLong(datum)}`;
        const row = await dbInsert("werfverslagen", { project_id: pid, bezoek_id: bid, nr, datum, titel, pdf_path: path, pdf_url: url, punten: pts.length, aan, bericht: (d.bericht || "").trim(), klant_zichtbaar: d.klant_zichtbaar === "on", created_by: S.me.id });
        window.open(url, "_blank", "noopener");
        if (aan.length || d.drive === "on") {
          if (!driveReady()) toast("Pdf gemaakt; niet gemaild (Drive-script niet ingesteld).", 6000);
          else { btn.textContent = "Versturen…"; try { const j = await driveCall("werfverslagmail", { id: row.id, aan, drive: d.drive === "on", folderId: p.drive_folder_id || "", token: S.session?.access_token || "" }); toast(`Werfverslag ${nr} gemaakt${(j.naar || []).length ? " en gemaild naar " + j.naar.join(", ") : ""}${j.drive_url ? " · in Drive" : ""}`, 7000); } catch (e) { toast("Pdf gemaakt, maar mailen mislukte: " + e.message, 8000); } }
        } else toast(`Werfverslag ${nr} gemaakt`);
      } catch (e) { toast("Verslag mislukt: " + e.message, 8000); btn.textContent = "Verslag maken en versturen"; return false; }
    },
  });
  const f = $("#mform");
  const sync = () => { const bid = f.querySelector("#wv_bezoek").value; const sel = f.querySelector("#wv_sel").value; const ak = f.querySelector('[name="alleen_klant"]').checked; const pts = puntenVoor(sel, bid, ak); const bt = betrokken(pts);
    f.querySelectorAll('input[name="aan"]').forEach(i => { i.parentElement.querySelector("small").textContent = i.parentElement.querySelector("small").textContent.replace(/ · \d+ punt(en)?$/, "") + (bt.has(i.dataset.cid) ? ` · ${pts.filter(v => v.contact_id === i.dataset.cid).length} punt${pts.filter(v => v.contact_id === i.dataset.cid).length === 1 ? "" : "en"}` : ""); });
    $("#wv_info").textContent = `${pts.length} punt${pts.length === 1 ? "" : "en"} in dit verslag · ${pts.filter(v => v.status === "open").length} open · plannen met pins: ${plansOf(pid).filter(pl => pts.some(v => v.plan_id === pl.id && v.plan_x != null)).length}`; };
  ["#wv_bezoek", "#wv_sel", '[name="alleen_klant"]'].forEach(q => f.querySelector(q).addEventListener("change", sync)); sync();
  // aannemers met punten standaard aanvinken
  const bt = betrokken(puntenVoor("actief", null, false)); f.querySelectorAll('input[name="aan"]').forEach(i => { if (bt.has(i.dataset.cid)) i.checked = true; });
  f.querySelector('[name="klant_zichtbaar"]').addEventListener("change", (e) => { f.querySelectorAll('input[name="aan"]').forEach(i => { if (i.dataset.rol === "bouwheer" || i.dataset.rol === "contactpersoon") i.checked = e.target.checked; }); });
}
function vWerfverslagen(p) {
  const ws = wvOf(p.id);
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Werfverslagen</h3><div class="muted" style="font-size:12px;margin-top:2px">Pdf met de vaststellingen (foto's, verantwoordelijke, deadline) en de plannen met pins; gemaild naar aannemers en klant.</div></div><div class="actions"><button class="btn sm primary" data-act="wv-new" data-pid="${p.id}">Werfverslag maken</button></div></div>
    ${ws.length ? `<div class="tw"><table class="t"><thead><tr><th>Nr</th><th>Datum</th><th>Bezoek</th><th class="r">Punten</th><th>Verstuurd naar</th><th></th></tr></thead><tbody>${ws.map(w => `<tr><td class="num">${w.nr}</td><td class="num">${fmtLong(w.datum)}</td><td>${w.bezoek_id && S.werfbezoeken[w.bezoek_id] ? `Bezoek ${S.werfbezoeken[w.bezoek_id].nr}` : "—"}</td><td class="r num">${w.punten}</td><td>${(w.aan || []).length ? esc((w.aan || []).join(", ")) : `<span class="muted">niet gemaild</span>`}${w.klant_zichtbaar ? ` <span class="pill st-afgerond">klant</span>` : ""}${w.aannemer_zichtbaar ? ` <span class="pill st-afgerond">aannemers</span>` : ""}${w.drive_url ? ` <a class="muted" href="${esc(safeUrl(w.drive_url))}" target="_blank" rel="noopener">Drive</a>` : ""}</td><td class="r" style="white-space:nowrap"><a class="btn ghost sm" href="${esc(safeUrl(w.pdf_url))}" target="_blank" rel="noopener">Pdf</a><button class="btn ghost sm" data-act="wv-share" data-id="${w.id}" title="${w.klant_zichtbaar ? "Niet meer tonen in het klantenportaal" : "Tonen in het klantenportaal"}">${w.klant_zichtbaar ? "Klant ✓" : "Klant"}</button><button class="btn ghost sm" data-act="wv-share-a" data-id="${w.id}" title="${w.aannemer_zichtbaar ? "Niet meer tonen aan alle aannemers van dit project (wie het per mail kreeg, ziet het wel)" : "Tonen aan alle aannemers van dit project in hun portaal (wie het per mail kreeg, ziet het sowieso)"}">${w.aannemer_zichtbaar ? "Aannemers ✓" : "Aannemers"}</button><button class="btn ghost sm danger" data-act="wv-del" data-id="${w.id}">✕</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty" style="padding:16px">Nog geen werfverslagen.</div>`}</div>`;
}
/* ---------- AI-assistent (script 023): gesprekken uit het klantenportaal en taakvoorstellen die BROS beoordeelt ---------- */
const ONDERWERP = { planning: "Planning", facturatie: "Facturatie", ontwerp: "Ontwerp", documenten: "Documenten", klacht: "Klacht", overig: "Overig" };
const AI_MODELLEN = [["gpt-4o-mini", "OpenAI gpt-4o-mini (goedkoop, aanbevolen)"], ["gpt-4.1-mini", "OpenAI gpt-4.1-mini"], ["gpt-4.1-nano", "OpenAI gpt-4.1-nano (goedkoopst)"], ["claude-haiku-4-5", "Anthropic Claude Haiku 4.5"], ["claude-3-5-haiku-latest", "Anthropic Claude 3.5 Haiku"]];
const aiCfg = () => (S.instellingen.assistent && S.instellingen.assistent.value) || {};
const voorstellenOpen = () => Object.values(S.taak_voorstellen).filter(v => v.status === "open");
const vsMijn = () => voorstellenOpen().filter(v => v.voorgestelde_user === S.me.id);
const berichtenOf = (pid) => Object.values(S.assistent_berichten).filter(b => b.project_id === pid).sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
const maandStart = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; };
const VT_STATUS = { open: "Open", bevestigd: "Bevestigd", geweigerd: "Geweigerd", beantwoord: "Beantwoord" };
function voorstelCard(v, withProject) {
  const p = S.projecten[v.project_id]; const wie = v.voorgestelde_user ? userById(v.voorgestelde_user).name : "—";
  const vtAntw = v.bron === "aannemer" || !!v.bericht_id;   // antwoorden (script 042): aannemer, of klant met een gesprek
  return `<div class="panel voorstel ${v.urgentie === "hoog" ? "urgent" : ""}" style="margin-bottom:12px">
    <div class="panel-head"><div><div class="eyebrow">${v.urgentie === "hoog" ? `<span class="pill late">Dringend</span> ` : ""}${v.bron === "aannemer" ? `<span class="pill st-on_hold">Aannemer${v.contact_id && S.contacten[v.contact_id] ? " · " + esc(S.contacten[v.contact_id].naam) : ""}</span> ` : ""}${ONDERWERP[v.onderwerp] || esc(v.onderwerp)} · ${fmtLong(lokDag(v.created_at))}${withProject && p ? ` · <a href="#" data-open="${p.id}">${esc(projName(p))}</a>` : ""}</div><h3 style="margin-top:4px">${esc(v.titel)}</h3>${v.omschrijving ? `<div class="muted" style="font-size:13px;margin-top:4px">${esc(v.omschrijving)}</div>` : ""}</div>
      <div class="actions" style="align-self:flex-start">${v.status === "open" ? `${vtAntw ? `<button class="btn sm primary" data-act="vt-antw" data-id="${v.id}">Beantwoorden…</button>` : ""}<button class="btn sm ${vtAntw ? "" : "primary"}" data-act="vt-ok" data-id="${v.id}">Bevestigen</button><button class="btn sm" data-act="vt-edit" data-id="${v.id}">Aanpassen…</button><button class="btn sm ghost danger" data-act="vt-nee" data-id="${v.id}">Weigeren</button>` : `<span class="pill ${v.status === "bevestigd" ? "done" : v.status === "beantwoord" ? "st-afgerond" : "kl"}">${VT_STATUS[v.status] || esc(v.status)}${v.beoordeeld_door ? " · " + esc(userById(v.beoordeeld_door).name) : ""}</span>${vtAntw ? `<button class="btn sm ghost" data-act="vt-antw" data-id="${v.id}" style="margin-left:6px">${v.bros_antwoord ? "Opnieuw antwoorden…" : "Antwoorden…"}</button>` : ""}`}</div></div>
    <div class="panel-body" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px">
      ${v.bron === "aannemer" ? `<div style="grid-column:1/-1"><div class="eyebrow">Vraag of melding van de aannemer</div><div style="white-space:pre-wrap;margin-top:4px">${esc(v.vraag) || "<span class='muted'>(geen toelichting)</span>"}</div><div class="muted" style="font-size:12px;margin-top:6px">${vtAntw ? "Beantwoorden: je antwoord komt in zijn portaal en per mail (met of zonder taak). Bevestigen maakt er enkel een taak van." : "Bevestigen maakt er een taak van; weigeren met een reden = je antwoord aan de aannemer (hij leest het in zijn portaal)."}</div></div>` : `<div><div class="eyebrow">Vraag van de klant</div><div style="white-space:pre-wrap;margin-top:4px">${esc(v.vraag)}</div></div>
      <div><div class="eyebrow">Antwoord van de assistent</div><div style="white-space:pre-wrap;margin-top:4px;color:var(--ink-2)">${esc(v.antwoord)}</div></div>`}
      ${v.bros_antwoord ? `<div style="grid-column:1/-1;border-left:3px solid var(--accent);padding:6px 10px;background:var(--accent-soft);border-radius:6px"><div class="eyebrow">Antwoord van BROS${v.beantwoord_door ? " · " + esc(userById(v.beantwoord_door).name) : ""}${v.beantwoord_op ? " · " + fmtLong(lokDag(v.beantwoord_op)) : ""}</div><div style="white-space:pre-wrap;margin-top:4px">${esc(v.bros_antwoord)}</div></div>` : ""}
      <div class="muted" style="grid-column:1/-1">Voorgesteld: <b>${esc(wie)}</b>${v.eind ? ` · tegen ${fmtLong(v.eind)}` : ""}${v.taak_id && S.taken[v.taak_id] ? ` · <a href="#" data-edit-task="${v.taak_id}">taak openen</a>` : ""}${v.reden ? ` · reden: ${esc(v.reden)}` : ""}</div>
    </div></div>`;
}
function vVoorstellen() {
  const open = voorstellenOpen().sort((a, b) => (a.urgentie === "hoog" ? 0 : 1) - (b.urgentie === "hoog" ? 0 : 1) || (a.created_at || "").localeCompare(b.created_at || ""));
  const rest = Object.values(S.taak_voorstellen).filter(v => v.status !== "open").sort((a, b) => (b.beoordeeld_op || "").localeCompare(a.beoordeeld_op || "")).slice(0, 30);
  return `<div class="page-head"><div><div class="eyebrow">${open.length} open</div><h1>Voorstellen</h1><div class="sub">Vragen van klanten aan de assistent en vragen of meldingen van aannemers uit hun portaal, waar BROS iets voor moet doen. ${"Beantwoorden stuurt je antwoord naar de aannemer of klant (in het portaal én per mail), met of zonder taak; bevestigen maakt er een taak van; aanpassen laat je titel, wie en datum kiezen; weigeren sluit het af."}</div></div></div>
    ${open.length ? open.map(v => voorstelCard(v, true)).join("") : `<div class="panel"><div class="empty"><b>Geen open voorstellen</b>Alles is beoordeeld.</div></div>`}
    ${rest.length ? `<details style="margin-top:16px"><summary class="muted" style="cursor:pointer">Beoordeeld (${rest.length})</summary><div style="margin-top:10px">${rest.map(v => voorstelCard(v, true)).join("")}</div></details>` : ""}`;
}
function vVragenProject(p) {
  const msgs = berichtenOf(p.id); const vs = Object.values(S.taak_voorstellen).filter(v => v.project_id === p.id).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const cfg = aiCfg(); const nMaand = msgs.filter(m => m.rol === "klant" && (m.created_at || "") >= maandStart()).length; const kost = msgs.reduce((s, m) => s + (Number(m.kost) || 0), 0);
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Vragen van de klant aan de assistent</h3><div class="muted" style="font-size:12px;margin-top:2px">${msgs.length ? `${msgs.filter(m => m.rol === "klant").length} vragen · ${nMaand} deze maand${cfg.plafond_project ? ` van ${cfg.plafond_project}` : ""} · ca. € ${kost.toFixed(2)} modelkost` : "Nog geen vragen gesteld"}${p.assistent === false ? ` · <span class="pill late">assistent uit voor dit project</span>` : ""}</div></div></div>
    ${msgs.length ? `<div class="chat">${msgs.map(m => `<div class="msg ${m.rol}"><div class="bubble">${esc(m.tekst)}</div><div class="when">${m.rol === "assistent" ? "Assistent · " : m.rol === "bros" ? "BROS" + (m.afzender ? " (" + esc(m.afzender) + ")" : "") + " · " : "Klant · "}${fmtLong(lokDag(m.created_at))} ${lokUur(m.created_at)}</div></div>`).join("")}</div>` : `<div class="empty">De klant heeft nog niets gevraagd in het portaal.</div>`}</div>
    ${vs.length ? `<h3 style="margin:0 0 10px">Taakvoorstellen (${vs.filter(v => v.status === "open").length} open)</h3>` + vs.map(v => voorstelCard(v)).join("") : ""}`;
}
async function voorstelBevestig(id, extra = {}) {
  const { data, error } = await sb.rpc("voorstel_bevestig", { p_id: id, p_titel: extra.titel || null, p_assignee: extra.assignee || null, p_eind: extra.eind || null, p_fase: extra.fase || null });
  if (error) { toast("Bevestigen mislukt: " + error.message, 5000); throw error; }
  if (data) S.taak_voorstellen[data.id] = data; if (data && data.taak_id) rowRefetch("taken", data.taak_id).catch(() => refetch("taken")); render(); toast("Bevestigd — de taak staat op het project");
}
function voorstelForm(v) {
  const p = S.projecten[v.project_id];
  openModal("Voorstel aanpassen en bevestigen", `<div class="form-grid">
    <div class="field span2"><label for="vt_titel">Taak</label><input id="vt_titel" name="titel" value="${esc(v.titel)}" required></div>
    <div class="field"><label for="vt_wie">Wie</label><select id="vt_wie" name="assignee">${userOpts(v.voorgestelde_user || S.me.id)}</select></div>
    <div class="field"><label for="vt_eind">Tegen</label><input id="vt_eind" name="eind" type="date" value="${esc(v.eind || "")}"></div>
    <div class="field"><label for="vt_fase">Fase</label><select id="vt_fase" name="fase"><option value="">— huidige fase van het project —</option>${opts(fasenList().map(f => [f.nr, f.nr + " · " + f.naam]), p?.fase_nr || "")}</select></div>
    <div class="field span2"><div class="muted" style="font-size:13px"><b>Vraag:</b> ${esc(v.vraag)}<br><b>Antwoord:</b> ${esc(v.antwoord)}</div></div>
  </div>`, { saveLabel: "Bevestigen", onSave: async (d) => { await voorstelBevestig(v.id, { titel: d.titel.trim(), assignee: d.assignee || null, eind: d.eind || null, fase: d.fase ? Number(d.fase) : null }); } });
}
/* antwoorden (script 042): het antwoord gaat naar het portaal (aannemer: onder zijn vraag; klant: in zijn gesprek) en per mail */
function voorstelAntwoordForm(v) {
  const p = S.projecten[v.project_id]; const open = v.status === "open"; const wie = v.bron === "aannemer" ? (S.contacten[v.contact_id]?.naam || "de aannemer") : "de klant";
  openModal((v.bros_antwoord ? "Opnieuw antwoorden" : "Beantwoorden") + " — " + v.titel, `<div class="form-grid">
    <div class="field span2"><div class="muted" style="font-size:13px;white-space:pre-wrap"><b>Vraag van ${esc(wie)}:</b> ${esc(v.vraag || v.titel)}</div>${v.bros_antwoord ? `<div class="muted" style="font-size:13px;margin-top:6px;white-space:pre-wrap"><b>Vorig antwoord:</b> ${esc(v.bros_antwoord)}</div>` : ""}</div>
    <div class="field span2"><label for="va_tekst">Je antwoord aan ${esc(wie)}</label><textarea id="va_tekst" name="antwoord" rows="6" required placeholder="bv. De BA-verzekering staat in de aannemingsmodaliteiten (Documenten). Orde en netheid: dagelijks opruimen, container voorzien door BROS."></textarea>
      <small class="muted">${v.bron === "aannemer" ? "Hij leest het onder zijn vraag in het aannemersportaal en krijgt een mail." : "Het komt als bericht van BROS in zijn gesprek in het klantenportaal, en hij krijgt een mail."}</small></div>
    ${open ? `<div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" name="taak" value="1"><span><b>Maak er ook een taak van</b><small class="muted" style="display:block">Zonder vinkje is de vraag met dit antwoord afgehandeld.</small></span></label></div>
    <div class="field span2 va-taak" hidden><div class="form-grid">
      <div class="field span2"><label for="va_titel">Taak</label><input id="va_titel" name="titel" value="${esc(v.titel)}"></div>
      <div class="field"><label for="va_wie">Wie</label><select id="va_wie" name="assignee">${userOpts(v.voorgestelde_user || S.me.id)}</select></div>
      <div class="field"><label for="va_eind">Tegen</label><input id="va_eind" name="eind" type="date" value="${esc(v.eind || "")}"></div>
      <div class="field"><label for="va_fase">Fase</label><select id="va_fase" name="fase"><option value="">— huidige fase van het project —</option>${opts(fasenList().map(f => [f.nr, f.nr + " · " + f.naam]), p?.fase_nr || "")}</select></div></div></div>` : ""}
  </div>`, { wide: true, saveLabel: "Antwoord versturen", onSave: async (d) => {
    const tekst = (d.antwoord || "").trim(); if (tekst.length < 2) { toast("Schrijf een antwoord."); return false; }
    const taak = open && !!d.taak;
    const { data, error } = await sb.rpc("voorstel_beantwoord", { p_id: v.id, p_antwoord: tekst, p_taak: taak, p_titel: taak ? (d.titel || "").trim() || null : null, p_assignee: taak ? d.assignee || null : null, p_eind: taak ? d.eind || null : null, p_fase: taak && d.fase ? Number(d.fase) : null });
    if (error) { toast("Antwoorden mislukt: " + error.message, 6000); return false; }
    if (data) S.taak_voorstellen[data.id] = data; if (data && data.taak_id) rowRefetch("taken", data.taak_id).catch(() => refetch("taken"));
    if (v.bron !== "aannemer") refetch("assistent_berichten").catch(() => { });
    render();
    let mail = "";
    if (driveReady()) { try { const j = await driveCall("antwoordmail", { id: v.id }); mail = j && j.naar ? " · gemaild naar " + j.naar : j && j.waarschuwing ? " · " + j.waarschuwing : ""; } catch (e) { mail = " · mail niet verstuurd: " + (e.message || e); } }
    else mail = " · niet gemaild (Drive-script niet ingesteld)";
    toast((taak ? "Beantwoord en taak gemaakt" : "Beantwoord") + mail, 7000);
  } });
  const f = $("#mform"); const cb = f.querySelector('[name="taak"]'); if (cb) cb.addEventListener("change", () => { f.querySelector(".va-taak").hidden = !cb.checked; });
}
async function voorstelWeiger(id) {
  const v = S.taak_voorstellen[id]; const reden = prompt(v && v.bron === "aannemer" ? "Antwoord aan de aannemer (hij leest dit in zijn portaal):" : "Reden (optioneel, komt in het logboek):", ""); if (reden === null) return;
  const { data, error } = await sb.rpc("voorstel_weiger", { p_id: id, p_reden: reden || "" });
  if (error) { toast("Weigeren mislukt: " + error.message, 5000); return; }
  if (data) S.taak_voorstellen[data.id] = data; render(); toast("Voorstel geweigerd");
}
function vAssistentBeheer() {
  const c = aiCfg(); const r = c.routering || {}; const ms = maandStart();
  const maand = Object.values(S.assistent_berichten).filter(m => (m.created_at || "") >= ms); const vragen = maand.filter(m => m.rol === "klant").length; const kost = maand.reduce((s, m) => s + (Number(m.kost) || 0), 0);
  const perProj = {}; maand.filter(m => m.rol === "klant").forEach(m => perProj[m.project_id] = (perProj[m.project_id] || 0) + 1);
  const pct = c.plafond_globaal ? Math.round(vragen / c.plafond_globaal * 100) : 0;
  const sel = (k) => `<select data-ai-route="${k}">${userOpts(r[k] || "", true)}</select>`;
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>AI-assistent (klantenportaal)</h3><div class="muted" style="font-size:12px;margin-top:2px">Klanten stellen vragen over hun dossier; de assistent antwoordt uit de klant-views en maakt taakvoorstellen die jullie beoordelen.</div></div><span class="pill ${c.actief !== false ? "st-afgerond" : "st-offerte"}">${c.actief !== false ? "aan" : "uit"}</span></div>
    <div class="panel-body"><div class="form-grid">
      <div class="field"><label class="sw-row"><input type="checkbox" class="sw" id="ai_actief" ${c.actief !== false ? "checked" : ""}><span><b>Assistent aan</b><small class="muted" style="display:block">Per project uit te zetten in het projectformulier.</small></span></label></div>
      <div class="field"><label for="ai_model">Model</label><select id="ai_model">${opts(AI_MODELLEN, c.model || "gpt-4o-mini")}</select></div>
      <div class="field"><label for="ai_functie">Naam (slug) van de Edge Function in Supabase</label><input id="ai_functie" value="${esc(c.functie || "assistent")}" placeholder="assistent"><small class="muted">Het deel na <code>/functions/v1/</code> in het adres van de functie, bv. <code>dynamic-handler</code>.</small></div>
      <div class="field"><label for="ai_pp">Plafond per project per maand (vragen)</label><input id="ai_pp" type="number" min="0" value="${Number(c.plafond_project) || 0}"><small class="muted">0 = geen plafond. Erboven geeft de assistent de vraag door zonder modeloproep.</small></div>
      <div class="field"><label for="ai_pg">Globaal plafond per maand (vragen)</label><input id="ai_pg" type="number" min="0" value="${Number(c.plafond_globaal) || 0}"><small class="muted">Harde stop voor alle projecten samen.</small></div>
      <div class="field span2"><label class="sw-row"><input type="checkbox" class="sw" id="ai_datums" ${c.datums !== false ? "checked" : ""}><span><b>Data uit de planning noemen</b><small class="muted" style="display:block">Aan: de assistent noemt de data uit de klantplanning, met de nuance dat ze kunnen schuiven. Uit: enkel de fase.</small></span></label></div>
      <div class="field"><label class="sw-row"><input type="checkbox" class="sw" id="ai_hulp" ${c.aannemer_hulp !== false ? "checked" : ""}><span><b>Hulp-assistent in het aannemersportaal</b><small class="muted" style="display:block">Beantwoordt enkel vragen over het gebruik van het portaal (uit aannemer/handleiding.json), zonder dossiergegevens. Staat los van de klantassistent.</small></span></label></div>
      <div class="field"><label for="ai_ph">Plafond hulp-assistent per maand (vragen, alle aannemers samen)</label><input id="ai_ph" type="number" min="0" value="${Number(c.plafond_hulp) || 1500}"><small class="muted">Daarnaast max. 5 vragen per minuut en 40 per dag per login.</small></div>
      <div class="field span2"><label for="ai_begroeting">Zin bovenaan het tabblad Vragen</label><input id="ai_begroeting" value="${esc(c.begroeting || "")}"></div>
      <div class="field span2"><label>Routering van taakvoorstellen</label><div class="tw"><table class="t"><tbody>${Object.entries(ONDERWERP).map(([k, l]) => `<tr><td style="width:160px">${l}${k === "klacht" ? ' <span class="muted">(altijd dringend)</span>' : ""}</td><td>${sel(k)}</td></tr>`).join("")}</tbody></table></div><small class="muted">Leeg = naar de beheerder.</small></div>
      <div class="field span2"><div class="actions"><button class="btn primary" data-act="ai-save">Bewaren</button><span class="muted" style="font-size:12px">De API-sleutel staat niet hier maar als secret bij de Edge Function in Supabase (zie README).</span></div></div>
    </div>
    <div class="rend" style="margin-top:14px"><div class="panel"><div class="k">Vragen deze maand</div><div class="v ${pct >= 80 ? "neg" : ""}">${vragen}${c.plafond_globaal ? ` <small class="muted" style="font-size:12px;font-weight:400">/ ${c.plafond_globaal}${pct >= 80 ? " · " + pct + " %" : ""}</small>` : ""}</div></div><div class="panel"><div class="k">Geschatte modelkost</div><div class="v">€ ${kost.toFixed(2)}</div></div><div class="panel"><div class="k">Open voorstellen</div><div class="v">${voorstellenOpen().length}</div></div><div class="panel"><div class="k">Projecten met vragen</div><div class="v">${Object.keys(perProj).length}</div></div></div>
    ${Object.keys(perProj).length ? `<div class="tw" style="margin-top:10px"><table class="t"><tbody>${Object.entries(perProj).sort((a, b) => b[1] - a[1]).map(([pid, n]) => `<tr><td>${esc(projName(S.projecten[pid]))}</td><td class="r num">${n}${c.plafond_project ? ` / ${c.plafond_project}` : ""}${c.plafond_project && n >= c.plafond_project * 0.8 ? ` <span class="pill late">bijna vol</span>` : ""}</td></tr>`).join("")}</tbody></table></div>` : ""}</div></div>`;
}
async function aiSaveSettings() {
  const r = {}; document.querySelectorAll("[data-ai-route]").forEach(s => r[s.dataset.aiRoute] = s.value || null);
  const value = { ...aiCfg(), actief: $("#ai_actief").checked, model: $("#ai_model").value, functie: ($("#ai_functie").value.trim().replace(/^.*\/functions\/v1\//, "").replace(/\/.*$/, "") || "assistent"), plafond_project: Number($("#ai_pp").value) || 0, plafond_globaal: Number($("#ai_pg").value) || 0, datums: $("#ai_datums").checked, begroeting: $("#ai_begroeting").value.trim(), routering: r };
  if ($("#ai_hulp")) { value.aannemer_hulp = $("#ai_hulp").checked; value.plafond_hulp = Number($("#ai_ph").value) || 1500; }   // 1.49 (script 047)
  const { data, error } = await sb.from("instellingen").upsert({ key: "assistent", value, updated_at: new Date().toISOString() }).select().single();
  if (error) { toast("Bewaren mislukt: " + error.message, 5000); return; } S.instellingen.assistent = data; render(); toast("Assistent-instellingen bewaard");
}
