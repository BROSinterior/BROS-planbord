/* =====================================================================
   BROS Planbord — Prijsvragen (script 037): prijzen opvragen bij meerdere aannemers, vergelijken en per post gunnen.
   Bouwt op de prijsaanvragen (script 025): elke deelnemer van een prijsvraag is een prijsaanvraag.
   Twee soorten: zonder prijzen (enkel posten, hoeveelheden en eenheden) of met onze prijzen (klantprijs − afslag) als voorstel.
   Geladen vóór app.js; app.js roept vPrijsvragen / pvAct aan via typeof-controles.
   ===================================================================== */
const pvReady = () => schemaV() >= 37 && !!S.prijsvragen && !!S.prijsvraag_gunningen;
const PV_STATUS = { open: "Loopt", gesloten: "Gesloten", gegund: "Afgerond" };
const PVA_STATUS = { open: "In te vullen", ingediend: "Ingediend", gekozen: "Gegund", afgesloten: "Niet ingediend", niet_weerhouden: "Niet weerhouden" };
const PVA_PILL = { open: "st-offerte", ingediend: "st-lopend", gekozen: "done", afgesloten: "kl", niet_weerhouden: "kl" };
const pvKop = (r) => !Number(r.hoeveelheid) && !r.code;                       // titelregel in de meetstaat: niet te prijzen
const pvOf = (pid) => Object.values(S.prijsvragen || {}).filter(v => v.project_id === pid).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
const pvDeelnemers = (vid) => Object.values(S.prijsaanvragen || {}).filter(a => a.prijsvraag_id === vid).sort((a, b) => (S.contacten[a.contact_id]?.naam || "").localeCompare(S.contacten[b.contact_id]?.naam || "", "nl"));
const pvGunningen = (vid) => Object.values(S.prijsvraag_gunningen || {}).filter(g => g.prijsvraag_id === vid);
const pvInScope = (x, r) => r.status !== "vervallen" && (x.posten ? x.posten.includes(r.id) : (x.loten || []).includes(r.lot));
const pvPostenVan = (x) => msRows(x.project_id).filter(r => pvInScope(x, r));
const pvIngediend = (a) => !!a.ingediend_op;
const pvRegelIndex = () => { const m = new Map(); Object.values(S.prijsaanvraag_regels || {}).forEach(r => m.set(r.aanvraag_id + "|" + r.post_id, r)); return m; };
const pvPct = (v) => v.richtprijs_marge == null ? null : Math.round(Number(v.richtprijs_marge) * 1000) / 10;
const pvSoort = (v) => v.richtprijs_marge == null ? "zonder prijzen" : `met onze prijzen (−${String(pvPct(v)).replace(".", ",")} %)`;
const pvRicht = (r, marge) => { const k = msVerkoopEP(r); const v = r2(k * (1 - marge)); return v > 0 ? v : null; };
/* posten die nog geen kostprijs hebben en niet in een lopende prijsvraag zitten */
function pvZonderKost(pid) {
  const lopend = pvOf(pid).filter(v => v.status !== "gegund");
  return msRows(pid).filter(r => r.status !== "vervallen" && !pvKop(r) && !(Number(r.eenheidsprijs) > 0) && !lopend.some(v => pvInScope(v, r)));
}

/* ---------- paneel op het tabblad Meetstaat ---------- */
function vPrijsvragen(p) {
  if (!isBeheer() || S.msKlant) return "";
  if (!pvReady()) return typeof vPrijsaanvragen === "function" ? vPrijsaanvragen(p) : "";
  const vs = pvOf(p.id); const zonder = pvZonderKost(p.id); const idx = pvRegelIndex();
  return `<div class="panel" style="margin-bottom:16px"><div class="panel-head"><div><h3>Prijsvragen</h3><div class="muted" style="font-size:12px;margin-top:2px">Zo komen prijzen binnen: kies posten en aannemers (ook wie nog niet aan het project gekoppeld is — die ziet enkel deze vraag), stuur ze <b>zonder prijzen</b> of <b>met onze prijzen</b> (klantprijs min een afslag). Ze vullen in via het aannemersportaal, jij vergelijkt en gunt per post. Herinneringen gaan automatisch: wekelijks en kort vóór de deadline.</div></div>
      <div class="actions">${zonder.length ? `<button class="btn sm" data-act="pv-new" data-pid="${p.id}" data-zonder="1" title="Een prijsvraag met de posten die nog geen kostprijs hebben">Prijsvraag voor ${zonder.length} post${zonder.length === 1 ? "" : "en"} zonder kostprijs</button>` : ""}<button class="btn sm primary" data-act="pv-new" data-pid="${p.id}">+ Prijsvraag</button></div></div>
    ${vs.length ? vs.map(v => pvBlok(v, idx)).join("") : `<div class="empty"><b>Nog geen prijsvragen</b>Vraag prijzen op bij één of meer aannemers; zij vullen in via het aannemersportaal.</div>`}</div>`;
}
function pvBlok(v, idx) {
  const ds = pvDeelnemers(v.id); const ps = pvPostenVan(v).filter(r => !pvKop(r)); const gun = pvGunningen(v.id);
  const nIn = ds.filter(pvIngediend).length; const lots = [...new Set(ps.map(r => r.lot))];
  return `<div class="panel-body" style="border-top:1px solid var(--line)">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
      <div><b>${esc(v.titel || "Prijsvraag")}</b> <span class="pill ${v.status === "gegund" ? "done" : v.status === "open" ? "st-lopend" : "kl"}">${PV_STATUS[v.status] || esc(v.status)}</span>
        <div class="muted" style="font-size:12px;margin-top:2px">${esc(pvSoort(v))} · ${ps.length} post${ps.length === 1 ? "" : "en"} uit ${lots.map(l => esc(lotName(l))).join(", ") || "—"}${v.deadline ? ` · reageren vóór <span class="${v.status === "open" && v.deadline < todayIso ? "late" : ""}">${fmtLong(v.deadline)}</span>` : ""} · ${nIn}/${ds.length} ingediend${gun.length ? ` · ${gun.length} post${gun.length === 1 ? "" : "en"} gegund` : ""}</div></div>
      <div class="actions" style="flex-wrap:wrap">${nIn || gun.length ? `<button class="btn sm primary" data-act="pv-cmp" data-id="${v.id}">Vergelijken en gunnen</button>` : ""}${v.status === "open" ? `<button class="btn sm" data-act="pv-add" data-id="${v.id}">+ Aannemer</button><button class="btn ghost sm" data-act="pv-edit" data-id="${v.id}" title="Titel, deadline of bericht aanpassen">Bewerken</button><button class="btn ghost sm" data-act="pv-sluit" data-id="${v.id}" title="Niemand kan nog invullen; herinneringen stoppen">Sluiten</button>` : ""}<button class="btn ghost sm danger" data-act="pv-del" data-id="${v.id}" aria-label="Prijsvraag verwijderen">✕</button></div></div>
    ${ds.length ? `<div class="tw" style="margin-top:8px"><table class="t"><thead><tr><th>Aannemer</th><th class="r">Ingevuld</th><th class="r">Totaal</th><th>Status</th><th>Offerte</th><th></th></tr></thead><tbody>
      ${ds.map(a => { const c = S.contacten[a.contact_id]; const aps = pvPostenVan(a).filter(r => !pvKop(r)); let n = 0, na = 0, tot = 0;
        aps.forEach(r => { const x = idx.get(a.id + "|" + r.id); if (!x) return; if (x.niet_aangeboden) na++; else if (x.eenheidsprijs != null) { n++; tot += Number(x.eenheidsprijs) * Number(r.hoeveelheid || 0); } });
        const gekoppeld = Object.values(S.project_contacten).some(pc => pc.project_id === v.project_id && pc.contact_id === a.contact_id);
        return `<tr><td>${c ? `<a href="#" data-contact="${c.id}">${esc(c.naam)}</a>${c.vakgebied ? `<small class="muted" style="display:block">${esc(c.vakgebied)}</small>` : ""}` : "—"}${c && !c.user_id ? ` <span class="pill st-offerte" title="Nog geen login; de uitnodiging zat in de mail">geen login</span>` : ""}${gekoppeld ? "" : ` <span class="pill kl" title="Niet aan het project gekoppeld: ziet enkel deze prijsvraag">kandidaat</span>`}</td>
          <td class="r num">${n}/${aps.length}${na ? `<small class="muted" style="display:block">${na} niet aangeboden</small>` : ""}</td><td class="r num">${n ? eur(tot) : "—"}</td>
          <td><span class="pill ${PVA_PILL[a.status] || "kl"}">${PVA_STATUS[a.status] || esc(a.status)}</span>${a.ingediend_op ? `<small class="muted" style="display:block">${fmtLong(a.ingediend_op.slice(0, 10))}</small>` : a.herinneringen ? `<small class="muted" style="display:block">${Math.min(a.herinneringen, 4)}× herinnerd</small>` : ""}${a.opmerking ? `<small class="muted" style="display:block" title="${esc(a.opmerking)}">💬 ${esc(a.opmerking.slice(0, 60))}${a.opmerking.length > 60 ? "…" : ""}</small>` : ""}</td>
          <td>${(a.bijlagen || []).map(b => `<a href="#" data-act="pv-bijlage" data-path="${esc(b.path)}" title="${esc(b.naam)}">📎 ${esc((b.naam || "offerte.pdf").slice(0, 28))}</a>`).join("<br>") || `<span class="muted">—</span>`}</td>
          <td class="r" style="white-space:nowrap">${a.status === "open" && v.status === "open" && driveReady() ? `<button class="btn ghost sm" data-act="pa-remind" data-id="${a.id}">Herinneren</button>` : ""}${!pvIngediend(a) && v.status === "open" && !pvGunningen(v.id).some(g => g.aanvraag_id === a.id) ? `<button class="btn ghost sm danger" data-act="pv-weg" data-id="${a.id}" aria-label="Deelnemer verwijderen">✕</button>` : ""}</td></tr>`; }).join("")}
    </tbody></table></div>` : `<p class="muted" style="font-size:13px;margin:8px 0 0">Nog geen aannemers in deze prijsvraag.</p>`}</div>`;
}

/* ---------- kiezen: posten en aannemers ---------- */
function pvPostKiezer(pid, voorkeuze) {
  const rows = msRows(pid).filter(r => r.status !== "vervallen"); const lots = [...new Set(rows.map(r => r.lot))].sort((a, b) => a - b);
  return `<div class="pv-lots pv-pick" style="max-height:300px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:4px 10px">${lots.map(l => { const rs = rows.filter(r => r.lot === l); const kies = rs.filter(r => !pvKop(r));
    return `<details style="padding:4px 0;border-bottom:1px solid var(--line)"><summary style="cursor:pointer"><label style="display:inline-flex;gap:6px;align-items:center" onclick="event.stopPropagation()"><input type="checkbox" data-pvlot="${l}"> <b>${esc(lotName(l))}</b></label> <small class="muted">${kies.length} posten${kies.some(r => !(Number(r.eenheidsprijs) > 0)) ? ` · ${kies.filter(r => !(Number(r.eenheidsprijs) > 0)).length} zonder kostprijs` : ""}</small></summary>
      <div style="padding:4px 0 6px 22px;display:grid;gap:2px">${rs.map(r => pvKop(r) ? `<div class="muted" style="font-size:12px;font-weight:600;margin-top:4px">${esc(r.omschrijving || r.groep || "")}</div>`
        : `<label style="display:flex;gap:6px;align-items:flex-start;font-size:13px"><input type="checkbox" name="pvpost" value="${r.id}" data-lot="${l}" ${voorkeuze.has(r.id) ? "checked" : ""}><span><span class="num muted">${esc(r.code || "")}</span> ${esc((r.omschrijving || "").split("\n")[0].slice(0, 90))} <small class="muted">${Number(r.hoeveelheid) ? nl(r.hoeveelheid, 2) + " " + esc(r.eenheid || "") : esc(r.prijstype || r.eenheid || "")}${Number(r.eenheidsprijs) > 0 ? "" : " · geen kostprijs"}</small></span></label>`).join("")}</div></details>`; }).join("")}</div>
    <small class="muted" id="pv_teller"></small>`;
}
function pvAannemerKiezer(pid, uitsluiten) {
  const linked = (cid) => Object.values(S.project_contacten).filter(pc => pc.project_id === pid && pc.contact_id === cid);
  const cs = Object.values(S.contacten).filter(c => c.soort !== "klant" && c.actief !== false && !uitsluiten.has(c.id))
    .sort((a, b) => (linked(b.id).length ? 1 : 0) - (linked(a.id).length ? 1 : 0) || (a.vakgebied || "~").localeCompare(b.vakgebied || "~", "nl") || (a.naam || "").localeCompare(b.naam || "", "nl"));
  return `<input id="pv_zoek" placeholder="Zoeken op naam, firma, vakgebied, gemeente…" style="width:100%;margin-bottom:6px">
    <div id="pv_cs" class="pv-pick" style="max-height:240px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:4px 10px">${cs.map(c => { const l = linked(c.id); const lots = [...new Set(l.flatMap(x => x.loten || []))];
      return `<label data-zoek="${esc([c.naam, c.bedrijf, c.vakgebied, c.gemeente, c.email].filter(Boolean).join(" ").toLowerCase())}" style="display:flex;gap:6px;align-items:flex-start;padding:3px 0;font-size:13px;${c.email ? "" : "opacity:.5"}"><input type="checkbox" name="pvc" value="${c.id}" ${c.email ? "" : "disabled"}><span><b>${esc(contactLabel(c))}</b> <small class="muted">${esc(CONTACT_SOORT[c.soort] || c.soort || "")}${c.vakgebied ? " · " + esc(c.vakgebied) : ""}${c.gemeente ? " · " + esc(c.gemeente) : ""}${c.email ? "" : " · geen e-mail"}${c.user_id ? "" : " · nog geen portaallogin"}</small>${l.length ? ` <span class="pill st-lopend" style="font-size:11px">gekoppeld${lots.length ? " · lot " + lots.join(", ") : ""}</span>` : ""}</span></label>`; }).join("") || `<p class="muted">Geen contacten — voeg ze toe bij Contacten.</p>`}</div>
    <small class="muted">Wie nog niet aan het project gekoppeld is, ziet in zijn portaal enkel deze prijsvraag (projectnummer en gemeente). Na de gunning koppelt het Planbord de winnaar aan zijn lot.</small>`;
}
function pvKiezersKoppelen() {
  const f = $("#mform"); if (!f) return;
  const tel = () => { const n = f.querySelectorAll('input[name="pvpost"]:checked').length; const t = $("#pv_teller"); if (t) t.textContent = n ? `${n} post${n === 1 ? "" : "en"} gekozen` : "Nog geen posten gekozen"; };
  const lotSync = (l) => { const all = [...f.querySelectorAll(`input[name="pvpost"][data-lot="${l}"]`)]; const n = all.filter(i => i.checked).length; const lb = f.querySelector(`input[data-pvlot="${l}"]`); if (lb) { lb.checked = all.length > 0 && n === all.length; lb.indeterminate = n > 0 && n < all.length; } };
  f.querySelectorAll("input[data-pvlot]").forEach(lb => { lotSync(lb.dataset.pvlot); lb.addEventListener("change", () => { f.querySelectorAll(`input[name="pvpost"][data-lot="${lb.dataset.pvlot}"]`).forEach(i => i.checked = lb.checked); tel(); }); });
  f.querySelectorAll('input[name="pvpost"]').forEach(i => i.addEventListener("change", () => { lotSync(i.dataset.lot); tel(); }));
  const z = $("#pv_zoek"); if (z) z.addEventListener("input", () => { const q = z.value.trim().toLowerCase(); f.querySelectorAll("#pv_cs label[data-zoek]").forEach(l => { l.style.display = !q || l.dataset.zoek.includes(q) ? "" : "none"; }); });
  tel();
}
const PV_BERICHT = {
  zonder: "Beste, graag je eenheidsprijzen (excl. btw, inclusief levering en plaatsing) voor onderstaande posten. Kan je een post niet aanbieden, vink dan 'niet aangeboden' aan; opmerkingen of alternatieven zet je per post. Je eigen offerte kan je als pdf toevoegen.",
  met: "Beste, hieronder staan onze prijzen voor deze posten (excl. btw, inclusief levering en plaatsing). Kijk ze na en pas aan waar nodig; kan je een post niet aanbieden, vink dan 'niet aangeboden' aan. Opmerkingen zet je per post, je eigen offerte kan je als pdf toevoegen.",
};

/* ---------- nieuwe prijsvraag ---------- */
function pvForm(pid, zonder) {
  const p = S.projecten[pid]; if (!p) return;
  if (!msRows(pid).some(r => r.status !== "vervallen" && !pvKop(r))) { toast("De meetstaat is nog leeg."); return; }
  const voor = new Set(zonder ? pvZonderKost(pid).map(r => r.id) : []);
  const d0 = new Date(); d0.setDate(d0.getDate() + 14); const dl = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, "0")}-${String(d0.getDate()).padStart(2, "0")}`;
  let laatste = "zonder"; try { laatste = localStorage.getItem("bros.pvSoort") || "zonder"; } catch (e) { }
  openModal("Prijsvraag versturen", `<div class="form-grid">
    <div class="field span2"><label for="pv_t">Titel</label><input id="pv_t" name="titel" value="Prijsvraag ${esc(p.nummer || "")}${p.gemeente ? " · " + esc(p.gemeente) : ""}"><small class="muted">De aannemer ziet deze titel; gebruik geen klantnaam als je kandidaten zonder koppeling uitnodigt.</small></div>
    <div class="field"><label for="pv_dl">Reageren vóór</label><input id="pv_dl" name="deadline" type="date" value="${dl}"></div>
    <div class="field"><label>Wat sturen we mee?</label>
      <label class="chk"><input type="radio" name="soort" value="zonder" ${laatste !== "met" ? "checked" : ""}> <span>Enkel posten, hoeveelheden en eenheden (geen prijzen)</span></label>
      <label class="chk"><input type="radio" name="soort" value="met" ${laatste === "met" ? "checked" : ""}> <span>Onze prijzen uit de meetstaat, min <input name="afslag" type="text" inputmode="decimal" value="10" style="width:52px;padding:2px 6px"> % marge</span></label>
      <small class="muted">Met onze prijzen ziet hij per post een voorstel (klantprijs × (1 − afslag)) dat hij kan aanpassen. Bij gunnen blijft dan standaard de klantprijs staan.</small></div>
    <div class="field span2"><label>Posten</label>${pvPostKiezer(pid, voor)}</div>
    <div class="field span2"><label>Aannemers</label>${pvAannemerKiezer(pid, new Set())}</div>
    <div class="field span2"><label for="pv_b">Bericht</label><textarea id="pv_b" name="bericht" rows="3">${esc(PV_BERICHT[laatste === "met" ? "met" : "zonder"])}</textarea></div>
  </div>`, { wide: true, saveLabel: "Versturen", onSave: async () => pvVersturen(pid) });
  pvKiezersKoppelen();
  const f = $("#mform"); f.querySelectorAll('input[name="soort"]').forEach(i => i.addEventListener("change", () => { const b = $("#pv_b"); if (Object.values(PV_BERICHT).includes(b.value.trim())) b.value = PV_BERICHT[i.value]; }));
  f.querySelector('input[name="afslag"]').addEventListener("focus", () => { f.querySelector('input[name="soort"][value="met"]').checked = true; });
}
async function pvVersturen(pid) {
  const f = $("#mform"); const ids = [...f.querySelectorAll('input[name="pvpost"]:checked')].map(i => i.value); const cids = [...f.querySelectorAll('input[name="pvc"]:checked')].map(i => i.value);
  if (!ids.length) { toast("Kies minstens één post."); return false; }
  if (!cids.length) { toast("Kies minstens één aannemer."); return false; }
  const met = f.querySelector('input[name="soort"]:checked')?.value === "met"; let marge = null;
  if (met) { const pct = leesGetal(f.querySelector('input[name="afslag"]').value); if (pct == null || isNaN(pct) || pct < 0 || pct >= 90) { toast("Geef een afslag tussen 0 en 90 %."); return false; } marge = Math.round(pct * 100) / 10000; }
  try { localStorage.setItem("bros.pvSoort", met ? "met" : "zonder"); } catch (e) { }
  // hele loten gekozen → per lot (nieuwe posten in dat lot komen er later bij); anders de losse posten
  const rows = msRows(pid).filter(r => r.status !== "vervallen" && !pvKop(r)); const lots = [...new Set(rows.filter(r => ids.includes(r.id)).map(r => r.lot))].sort((a, b) => a - b);
  const heel = lots.every(l => rows.filter(r => r.lot === l).every(r => ids.includes(r.id)));
  const v = await dbInsert("prijsvragen", { project_id: pid, titel: (f.querySelector('[name="titel"]').value || "").trim() || "Prijsvraag", bericht: (f.querySelector('[name="bericht"]').value || "").trim(),
    deadline: f.querySelector('[name="deadline"]').value || null, loten: lots, posten: heel ? null : ids, richtprijs_marge: marge, created_by: S.me.id });
  await pvDeelnemersMaken(v, cids);
}
async function pvDeelnemersMaken(v, cids) {
  const scope = pvPostenVan(v).filter(r => !pvKop(r)); let fout = 0; const nieuw = [];
  S.bulk = true;
  try {
    for (const cid of cids) {
      try {
        const a = await dbInsert("prijsaanvragen", { project_id: v.project_id, contact_id: cid, prijsvraag_id: v.id, loten: v.loten, posten: v.posten, titel: v.titel, bericht: v.bericht, deadline: v.deadline, created_by: S.me.id });
        if (v.richtprijs_marge != null) {
          const regels = scope.map(r => ({ r, p: pvRicht(r, Number(v.richtprijs_marge)) })).filter(x => x.p != null).map(x => ({ aanvraag_id: a.id, post_id: x.r.id, eenheidsprijs: x.p, richtprijs: x.p }));
          for (let i = 0; i < regels.length; i += 500) { const { error } = await sb.from("prijsaanvraag_regels").insert(regels.slice(i, i + 500)); if (error) throw error; }
        }
        nieuw.push(a);
      } catch (e) { fout++; if (!e.__toasted) toast("Niet aangemaakt: " + (e.message || e), 6000); }
      finally { const half = Object.values(S.prijsaanvragen || {}).find(x => x.prijsvraag_id === v.id && x.contact_id === cid && !nieuw.some(n => n.id === x.id)); if (half) await dbDelete("prijsaanvragen", half.id).catch(() => { }); }
    }
  } finally { S.bulk = false; }
  await refetch("prijsaanvraag_regels"); await refetch("prijsaanvragen");
  if (!nieuw.length) return;
  if (!driveReady()) { toast(`Prijsvraag bewaard voor ${nieuw.length} aannemer${nieuw.length === 1 ? "" : "s"} — niet gemaild: Drive-script niet ingesteld`, 7000); return; }
  let ok = 0, uit = 0; const mis = [];
  loader.start("pv.mail", `Mail 1/${nieuw.length} versturen…`, 6000 * nieuw.length);
  for (let i = 0; i < nieuw.length; i++) {
    loader.step(`Mail ${i + 1}/${nieuw.length} versturen…`);
    try { const j = await driveCall("prijsaanvraagmail", { id: nieuw[i].id, soort: "nieuw", token: S.session?.access_token || "" }); ok++; if (j.uitgenodigd) uit++; }
    catch (e) { mis.push((S.contacten[nieuw[i].contact_id]?.naam || "?") + ": " + e.message); }
  }
  loader.done();
  toast(`Prijsvraag gemaild naar ${ok} aannemer${ok === 1 ? "" : "s"}${uit ? ` (${uit} met uitnodiging voor het portaal)` : ""}${mis.length ? ` — niet gelukt: ${mis.join(" · ")}` : ""}${fout ? ` — ${fout} niet aangemaakt` : ""}`, mis.length ? 10000 : 6000);
}
function pvToevoegen(vid) {
  const v = S.prijsvragen[vid]; if (!v) return;
  const al = new Set(pvDeelnemers(vid).map(a => a.contact_id));
  openModal("Aannemers toevoegen", `<p class="muted" style="margin-top:0;font-size:13px">Zelfde posten, deadline en bericht als de andere deelnemers (${esc(pvSoort(v))}).</p>${pvAannemerKiezer(v.project_id, al)}`, {
    wide: true, saveLabel: "Toevoegen en mailen", onSave: async () => {
      const cids = [...$("#mform").querySelectorAll('input[name="pvc"]:checked')].map(i => i.value); if (!cids.length) { toast("Kies minstens één aannemer."); return false; }
      await pvDeelnemersMaken(v, cids);
    } });
  pvKiezersKoppelen();
}
function pvBewerk(vid) {
  const v = S.prijsvragen[vid]; if (!v) return;
  openModal("Prijsvraag bewerken", `<div class="form-grid">
    <div class="field span2"><label for="pve_t">Titel</label><input id="pve_t" name="titel" value="${esc(v.titel || "")}"></div>
    <div class="field"><label for="pve_dl">Reageren vóór</label><input id="pve_dl" name="deadline" type="date" value="${esc(v.deadline || "")}"><small class="muted">Een nieuwe datum geldt voor alle deelnemers die nog niet afgerond zijn (de herinnering vóór de deadline volgt opnieuw).</small></div>
    <div class="field span2"><label for="pve_b">Bericht</label><textarea id="pve_b" name="bericht" rows="4">${esc(v.bericht || "")}</textarea></div></div>`, {
    saveLabel: "Bewaren", onSave: async (d) => { await dbUpdate("prijsvragen", vid, { titel: (d.titel || "").trim() || "Prijsvraag", deadline: d.deadline || null, bericht: (d.bericht || "").trim() }); await refetch("prijsaanvragen"); toast("Prijsvraag bijgewerkt"); } });
}
async function pvSluiten(vid) {
  const v = S.prijsvragen[vid]; if (!v) return; const open = pvDeelnemers(vid).filter(a => a.status === "open").length;
  if (!confirm(`Prijsvraag sluiten? Niemand kan nog prijzen invullen of wijzigen${open ? `; ${open} aannemer${open === 1 ? " die nog niet indiende, krijgt" : "s die nog niet indienden, krijgen"} geen herinneringen meer` : ""}. Vergelijken en gunnen blijft mogelijk.`)) return;
  try { await dbUpdate("prijsvragen", vid, { status: "gesloten" }); await refetch("prijsaanvragen"); toast("Prijsvraag gesloten"); } catch (e) { }
}
async function pvVerwijder(vid) {
  const v = S.prijsvragen[vid]; if (!v) return; const n = pvDeelnemers(vid).length;
  if (!confirm(`"${v.titel || "Prijsvraag"}" verwijderen, met ${n} aanvra${n === 1 ? "ag" : "gen"} en alle ingevulde prijzen? Kostprijzen die al gegund zijn, blijven in de meetstaat staan.`)) return;
  const paden = pvDeelnemers(vid).flatMap(a => (a.bijlagen || []).map(b => b.path)).filter(Boolean);
  try { await dbDelete("prijsvragen", vid); if (paden.length) sb.storage.from("offertes").remove(paden).catch(() => { }); await refetch("prijsaanvragen"); await refetch("prijsaanvraag_regels"); await refetch("prijsvraag_gunningen"); toast("Prijsvraag verwijderd"); } catch (e) { }
}
async function pvBijlage(path) {
  const w = window.open("", "_blank");
  const { data, error } = await sb.storage.from("offertes").createSignedUrl(path, 600);
  if (error || !data) { if (w) w.close(); toast("Bijlage niet te openen: " + (error?.message || "onbekend"), 6000); return; }
  if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
}

/* ---------- vergelijken en gunnen ---------- */
const PVK = { vid: null, keuze: {} };
function pvVergelijk(vid) {
  const v = S.prijsvragen[vid]; if (!v) return;
  PVK.vid = vid; PVK.keuze = Object.fromEntries(pvGunningen(vid).map(g => [g.post_id, g.aanvraag_id]));
  openModal("Vergelijken en gunnen", `<div id="pv_cmp"></div>`, { wide: true, saveLabel: "Gunning toepassen", onSave: async () => pvGunnen(vid) });
  $("#modal").style.width = "min(1280px, 100%)";
  pvCmpTeken();
}
function pvCmpData(v) {
  const ds = pvDeelnemers(v.id); const idx = pvRegelIndex();
  const posten = msRows(v.project_id).filter(r => ds.some(a => pvInScope(a, r)) || pvInScope(v, r));
  const cel = (a, r) => { if (!pvInScope(a, r)) return { buiten: true }; const x = idx.get(a.id + "|" + r.id); return { prijs: x && x.eenheidsprijs != null && !x.niet_aangeboden ? Number(x.eenheidsprijs) : null, na: !!(x && x.niet_aangeboden), opm: x ? x.opmerking || "" : "", richt: x && x.richtprijs != null ? Number(x.richtprijs) : null }; };
  return { ds, posten, cel };
}
function pvCmpTeken() {
  const v = S.prijsvragen[PVK.vid]; const box = $("#pv_cmp"); if (!v || !box) return;
  const { ds, posten, cel } = pvCmpData(v); const gun = Object.fromEntries(pvGunningen(v.id).map(g => [g.post_id, g.aanvraag_id]));
  const kan = ds.filter(a => pvIngediend(a)); const lots = [...new Set(posten.map(r => r.lot))];
  const tot = {}; ds.forEach(a => tot[a.id] = { som: 0, mis: 0, na: 0 });
  let html = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px"><button type="button" class="btn sm" data-act="pv-laagst">Laagste per post</button><button type="button" class="btn ghost sm" data-act="pv-wis">Keuze wissen</button>
      <span class="muted" style="font-size:12px">Klik op een prijs om die post aan die aannemer te gunnen (nogmaals klikken = niet meer). Enkel ingediende prijzen. <span style="color:var(--ok);font-weight:600">Groen</span> = laagste, <span style="color:var(--warn,#B7791F);font-weight:600">oranje</span> = meer dan 50 % boven de laagste.</span></div>
    <div class="tw" style="max-height:58vh;overflow:auto"><table class="t ms pv-cmp"><thead><tr><th>Nr</th><th>Omschrijving</th><th class="r">Hoev.</th><th class="r" title="Huidige kostprijs in de meetstaat">Kost nu</th>${v.richtprijs_marge != null ? `<th class="r" title="Ons voorstel aan de aannemers">Voorstel</th>` : ""}
      ${ds.map(a => { const c = S.contacten[a.contact_id]; return `<th class="r" style="min-width:120px;vertical-align:top">${esc(c?.naam || "?")}<small class="muted" style="display:block;font-weight:400">${PVA_STATUS[a.status] || esc(a.status)}${a.opmerking ? ` <span title="${esc(a.opmerking)}">💬</span>` : ""}${(a.bijlagen || []).length ? ` <a href="#" data-act="pv-bijlage" data-path="${esc(a.bijlagen[0].path)}" title="${esc(a.bijlagen.map(b => b.naam).join(", "))}">📎${a.bijlagen.length > 1 ? a.bijlagen.length : ""}</a>` : ""}</small>${pvIngediend(a) ? `<button type="button" class="btn ghost sm" data-act="pv-alles" data-aid="${a.id}" style="padding:0 6px;font-size:11px" title="Alle posten met een prijs van ${esc(c?.naam || "")} kiezen">alles</button>` : ""}</th>`; }).join("")}</tr></thead><tbody>`;
  lots.forEach(lot => {
    const rs = posten.filter(r => r.lot === lot); const sub = {}; ds.forEach(a => sub[a.id] = { som: 0, mis: 0 });
    html += `<tr class="ms-lot"><td colspan="${(v.richtprijs_marge != null ? 5 : 4) + ds.length}">${esc(lotName(lot))}</td></tr>`;
    rs.forEach(r => {
      if (pvKop(r)) { html += `<tr class="ms-groep"><td></td><td colspan="${(v.richtprijs_marge != null ? 4 : 3) + ds.length}">${esc(r.omschrijving || r.groep || "")}</td></tr>`; return; }
      const h = Number(r.hoeveelheid || 0); const cs = ds.map(a => cel(a, r)); const geldig = ds.map((a, i) => pvIngediend(a) && cs[i].prijs != null ? cs[i].prijs : null).filter(x => x != null); const min = geldig.length ? Math.min(...geldig) : null;
      const richt = cs.find(x => x.richt != null)?.richt ?? null;
      html += `<tr><td class="num muted">${esc(r.code || "")}</td><td>${esc((r.omschrijving || "").split("\n")[0])}${r.locatie ? `<small class="muted" style="display:block">${esc(r.locatie)}</small>` : ""}${["akkoord", "meerwerk", "minwerk"].includes(r.status) ? ` <span class="pill done" style="font-size:10px" title="Klantakkoord: de klantprijs blijft bij gunnen">akkoord</span>` : ""}</td><td class="r num" style="white-space:nowrap">${h ? nl(h, 2) + " " + esc(r.eenheid || "") : esc(r.prijstype || "")}</td><td class="r num muted">${Number(r.eenheidsprijs) > 0 ? eur2(r.eenheidsprijs) : "—"}</td>${v.richtprijs_marge != null ? `<td class="r num muted">${richt != null ? eur2(richt) : "—"}</td>` : ""}
        ${ds.map((a, i) => { const x = cs[i]; const t = tot[a.id]; const s = sub[a.id];
          if (x.buiten) return `<td class="r muted">·</td>`;
          if (x.na) { t.na++; return `<td class="r muted" title="${esc(x.opm || "Niet aangeboden")}">n.a.${x.opm ? " 💬" : ""}</td>`; }
          if (x.prijs == null) { t.mis++; s.mis++; return `<td class="r muted">—</td>`; }
          t.som += x.prijs * h; s.som += x.prijs * h;
          const ok = pvIngediend(a); const gekozen = PVK.keuze[r.id] === a.id; const was = gun[r.id] === a.id;
          const kleur = ok && min != null && x.prijs === min && geldig.length > 1 ? "color:var(--ok);font-weight:600" : ok && min != null && min > 0 && x.prijs > min * 1.5 ? "color:var(--warn,#B7791F)" : "";
          return `<td class="r num${ok ? " pv-cel" : ""}" ${ok ? `data-act="pv-kies" data-post="${r.id}" data-aid="${a.id}"` : ""} style="${ok ? "cursor:pointer;" : "opacity:.55;font-style:italic;"}${gekozen ? "background:var(--ok-soft,#E6F4EA);box-shadow:inset 0 0 0 2px var(--ok);" : ""}" title="${esc((ok ? "" : "Nog niet ingediend. ") + (x.opm ? "Opmerking: " + x.opm : ""))}"><span style="${kleur}">${eur2(x.prijs)}</span>${x.opm ? " 💬" : ""}${was ? " ✓" : ""}<small class="muted" style="display:block">${h ? eur(x.prijs * h) : ""}</small></td>`; }).join("")}</tr>`;
    });
    html += `<tr class="ms-groep"><td></td><td>Subtotaal ${esc(lotName(lot))}</td><td></td><td></td>${v.richtprijs_marge != null ? "<td></td>" : ""}${ds.map(a => `<td class="r num"><b>${eur(sub[a.id].som)}</b>${sub[a.id].mis ? `<small class="late" style="display:block">${sub[a.id].mis} zonder prijs</small>` : ""}</td>`).join("")}</tr>`;
  });
  html += `<tr class="ms-lot"><td></td><td>Totaal</td><td></td><td></td>${v.richtprijs_marge != null ? "<td></td>" : ""}${ds.map(a => `<td class="r num">${eur(tot[a.id].som)}${tot[a.id].mis || tot[a.id].na ? `<small class="late" style="display:block">onvolledig: ${[tot[a.id].mis ? tot[a.id].mis + " zonder prijs" : "", tot[a.id].na ? tot[a.id].na + " n.a." : ""].filter(Boolean).join(", ")}</small>` : ""}</td>`).join("")}</tr></tbody></table></div>
    <div id="pv_sum" style="margin-top:12px"></div>
    <div style="display:grid;gap:4px;margin-top:10px;font-size:13px">
      <label class="chk"><input type="checkbox" id="pv_houd" ${v.richtprijs_marge != null ? "checked" : ""}> <span>Klantprijs behouden (de marge wordt herrekend) — uit: de marge blijft en de klantprijs volgt de nieuwe kostprijs. Posten met klantakkoord houden altijd hun klantprijs.</span></label>
      <label class="chk"><input type="checkbox" id="pv_koppel" checked> <span>Gegunde aannemers koppelen aan het lot van hun posten (Dossier › Contacten) — bij het afronden</span></label>
      <label class="chk"><input type="checkbox" id="pv_mail" checked> <span>De gegunde aannemers mailen</span></label>
      <label class="chk"><input type="checkbox" id="pv_rond" ${v.status === "gegund" ? "checked disabled" : v.oud ? "" : "checked"}> <span>Prijsvraag afronden: wie indiende maar niets kreeg, staat op <i>niet weerhouden</i>${v.oud ? " (let op: deze prijsvraag bundelt de prijsaanvragen van vóór v1.38)" : ""}</span></label>
      <label class="chk" style="padding-left:22px"><input type="checkbox" id="pv_mailnw" ${v.oud ? "" : "checked"}> <span>en krijgt daarover een korte mail</span></label>
      <p class="muted" style="margin:2px 0 0;font-size:12px">De gegunde aannemers krijgen hun mail bij het afronden; zolang de prijsvraag loopt, kunnen ze nog verder invullen.</p>
    </div>`;
  if (!kan.length) html = `<div class="notice" style="margin-bottom:10px"><div>Nog niemand heeft ingediend: je kan pas gunnen als er ingediende prijzen zijn.</div></div>` + html;
  box.innerHTML = html; pvCmpSom();
}
function pvCmpSom() {
  const v = S.prijsvragen[PVK.vid]; const el = $("#pv_sum"); if (!v || !el) return;
  const { ds, cel } = pvCmpData(v); const per = {}; let som = 0, nu = 0, n = 0;
  Object.entries(PVK.keuze).forEach(([pid, aid]) => { const r = S.meetstaat_posten[pid]; const a = ds.find(x => x.id === aid); if (!r || !a) return; const x = cel(a, r); if (x.prijs == null) return; const h = Number(r.hoeveelheid || 0);
    n++; som += x.prijs * h; nu += (Number(r.eenheidsprijs) || 0) * h; per[aid] = per[aid] || { n: 0, som: 0 }; per[aid].n++; per[aid].som += x.prijs * h; });
  const totaal = pvCmpData(v).posten.filter(r => !pvKop(r)).length;
  const blok = (k, v, m) => `<div style="flex:1 1 180px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--surface-2)"><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em">${k}</div><div style="font-size:18px;font-weight:700;margin-top:2px">${v}</div>${m ? `<div class="muted" style="font-size:12px">${m}</div>` : ""}</div>`;
  el.innerHTML = `<div style="display:flex;gap:10px;flex-wrap:wrap">${blok("Gekozen", `${n} / ${totaal}`, "posten")}${blok("Kostprijs van de keuze", eur(som), `nu ${eur(nu)}${nu ? ` · ${som - nu >= 0 ? "+" : "−"}${eur(Math.abs(som - nu))}` : ""}`)}
    <div style="flex:2 1 280px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--surface-2)"><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em">Per aannemer</div><div style="font-size:13px;margin-top:4px">${Object.entries(per).map(([aid, x]) => `${esc(S.contacten[ds.find(a => a.id === aid)?.contact_id]?.naam || "?")}: ${x.n} post${x.n === 1 ? "" : "en"} · ${eur(x.som)}`).join("<br>") || `<span class="muted">nog niets gekozen</span>`}</div></div></div>`;
}
function pvKies(postId, aid) { if (PVK.keuze[postId] === aid) delete PVK.keuze[postId]; else PVK.keuze[postId] = aid; MODAL.dirty = true; pvCmpTeken(); }
function pvLaagst() {
  const v = S.prijsvragen[PVK.vid]; if (!v) return; const { ds, posten, cel } = pvCmpData(v);
  posten.filter(r => !pvKop(r)).forEach(r => { let best = null; ds.filter(pvIngediend).forEach(a => { const x = cel(a, r); if (x.prijs != null && (best == null || x.prijs < best.p)) best = { a: a.id, p: x.prijs }; }); if (best) PVK.keuze[r.id] = best.a; });
  MODAL.dirty = true; pvCmpTeken();
}
function pvAlles(aid) {
  const v = S.prijsvragen[PVK.vid]; if (!v) return; const { ds, posten, cel } = pvCmpData(v); const a = ds.find(x => x.id === aid); if (!a) return;
  posten.filter(r => !pvKop(r)).forEach(r => { if (cel(a, r).prijs != null) PVK.keuze[r.id] = aid; }); MODAL.dirty = true; pvCmpTeken();
}
async function pvGunnen(vid) {
  const v = S.prijsvragen[vid]; if (!v) return;
  const oud = Object.fromEntries(pvGunningen(vid).map(g => [g.post_id, g.aanvraag_id]));
  const nieuw = Object.entries(PVK.keuze).filter(([p, a]) => oud[p] !== a).map(([post_id, aanvraag_id]) => ({ post_id, aanvraag_id }));
  const weg = Object.keys(oud).filter(p => !PVK.keuze[p]);
  const afronden = !!$("#pv_rond")?.checked && v.status !== "gegund"; const houd = !!$("#pv_houd")?.checked;
  const koppel = !!$("#pv_koppel")?.checked, mail = !!$("#pv_mail")?.checked, mailNw = !!$("#pv_mailnw")?.checked;
  if (!nieuw.length && !weg.length && !afronden) { toast("Er is niets gewijzigd."); return false; }
  const ds = pvDeelnemers(vid); const naam = (aid) => S.contacten[ds.find(a => a.id === aid)?.contact_id]?.naam || "?";
  const perA = {}; nieuw.forEach(k => perA[k.aanvraag_id] = (perA[k.aanvraag_id] || 0) + 1);
  const akk = nieuw.filter(k => ["akkoord", "meerwerk", "minwerk"].includes(S.meetstaat_posten[k.post_id]?.status)).length;
  const verliezers = afronden ? ds.filter(a => !Object.values(PVK.keuze).includes(a.id) && a.ingediend_op && ["open", "ingediend"].includes(a.status)) : [];
  const nwVoor = new Set(ds.filter(a => a.status === "niet_weerhouden").map(a => a.id));
  if (!confirm([nieuw.length ? `${nieuw.length} post${nieuw.length === 1 ? "" : "en"} gunnen: ${Object.entries(perA).map(([a, n]) => `${naam(a)} ${n}`).join(", ")}.` : "",
    nieuw.length ? (houd ? "De klantprijs blijft; de marge wordt herrekend." : `De marge blijft; de klantprijs volgt de nieuwe kostprijs${akk ? ` (behalve ${akk} post${akk === 1 ? "" : "en"} met klantakkoord: die houden hun klantprijs)` : ""}.`) : "",
    weg.length ? `${weg.length} eerdere gunning${weg.length === 1 ? "" : "en"} intrekken (de kostprijs blijft staan).` : "",
    afronden ? `Prijsvraag afronden${verliezers.length ? `: ${verliezers.map(a => naam(a.id)).join(", ")} → niet weerhouden${mailNw ? " (met mail)" : ""}` : ""}.` : "",
    "Doorgaan?"].filter(Boolean).join("\n\n"))) return false;
  loader.start("pv.gun", "Gunnen…", 20000);
  try {
    for (const p of weg) { const { error } = await sb.rpc("prijsvraag_gunning_weg", { p_prijsvraag: vid, p_post: p }); if (error) throw error; }
    const { error } = await sb.rpc("prijsvraag_gunnen", { p_prijsvraag: vid, p_keuzes: nieuw, p_afronden: afronden, p_koppelen: koppel, p_klantprijs_blijft: houd });
    if (error) throw error;
  } catch (e) { loader.fail(); toast("Gunnen mislukt: " + (e.message || e), 8000); return false; }
  loader.done();
  await msRefetch([...new Set(nieuw.map(k => k.post_id).concat(weg))]);
  for (const t of ["prijsvraag_gunningen", "prijsaanvragen", "prijsvragen", "project_contacten"]) await refetch(t);
  toast(`${nieuw.length} post${nieuw.length === 1 ? "" : "en"} gegund${afronden ? " · prijsvraag afgerond" : ""}`);
  if (driveReady()) {
    // winnaars pas mailen als de prijsvraag afgerond is; niet-weerhouden: wie nu (na de databank) op 'niet weerhouden' staat en het daarvoor nog niet was
    const rond = afronden || v.status === "gegund"; const nu = pvDeelnemers(vid);
    const winnaars = rond ? nu.filter(a => a.status === "gekozen" && (perA[a.id] || afronden)).map(a => a.id) : [];
    const nw = nu.filter(a => a.status === "niet_weerhouden" && !nwVoor.has(a.id)).map(a => a.id);
    const lijst = (mail ? winnaars.map(id => ({ id, soort: "gekozen" })) : []).concat(mailNw ? nw.map(id => ({ id, soort: "niet_weerhouden" })) : []);
    for (const m of lijst) { try { await driveCall("prijsaanvraagmail", { id: m.id, soort: m.soort, token: S.session?.access_token || "" }); } catch (e) { toast("Mail aan " + naam(m.id) + " mislukt: " + e.message, 6000); } }
  }
}

/* ---------- klikken (vanuit de dispatcher in app.js) ---------- */
function pvAct(d, el, e) {
  if (d.act === "pv-new") { pvForm(d.pid, !!d.zonder); return true; }
  if (d.act === "pv-cmp") { pvVergelijk(d.id); return true; }
  if (d.act === "pv-add") { pvToevoegen(d.id); return true; }
  if (d.act === "pv-edit") { pvBewerk(d.id); return true; }
  if (d.act === "pv-sluit") { pvSluiten(d.id); return true; }
  if (d.act === "pv-del") { pvVerwijder(d.id); return true; }
  if (d.act === "pv-weg") { const a = S.prijsaanvragen[d.id]; if (a && confirm(`${S.contacten[a.contact_id]?.naam || "Deze aannemer"} uit de prijsvraag halen?`)) { const paden = (a.bijlagen || []).map(b => b.path).filter(Boolean); dbDelete("prijsaanvragen", d.id).then(() => { if (paden.length) sb.storage.from("offertes").remove(paden).catch(() => { }); toast("Verwijderd"); }).catch(() => { }); } return true; }
  if (d.act === "pv-bijlage") { if (e) e.preventDefault(); pvBijlage(d.path); return true; }
  if (d.act === "pv-kies") { pvKies(d.post, d.aid); return true; }
  if (d.act === "pv-laagst") { pvLaagst(); return true; }
  if (d.act === "pv-wis") { PVK.keuze = {}; MODAL.dirty = true; pvCmpTeken(); return true; }
  if (d.act === "pv-alles") { pvAlles(d.aid); return true; }
  return false;
}
