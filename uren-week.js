/* =====================================================================
   BROS Planbord — Uren als weekagenda (v1.69, geen databasescript)
   Tabblad Uren toont per medewerker een weekagenda (tijdsrooster ma–vr, per kwartier):
   - geregistreerde uren als blokken in de kleur van het project: slepen = verschuiven (ook naar een andere dag),
     onderrand slepen = langer/korter, klikken = bewerken;
   - slepen over een leeg stuk = nieuwe registratie voor dat tijdvak (op een aanraakscherm: tikken = één uur);
   - afspraken uit het Planbord (taken met een afspraak, voor wie verantwoordelijk is) staan er al in als stippellijn:
     "✓ Uren" boekt ze in één klik (project, taak, datum, van–tot), "Aanpassen…" opent het formulier, "✕" = niet gewerkt;
   - uren zonder tijdstip staan als kaartje boven de dag.
   Iedereen kan de week van een collega bekijken (alleen lezen) en het teamoverzicht; invullen enkel voor jezelf
   (beheer ook voor anderen — zoals de databank toelaat). Weergave "Lijst" = de vroegere tabel.
   Geladen vóór app.js; app.js roept vUrenWeek, uwBezig en uwWachtItems aan (via typeof).
   ===================================================================== */
const UW = { drag: null, modus: null };
const UW_PX = 1;                    // pixels per minuut (60 px per uur)
const UW_SNAP = 15;                 // minuten
const UW_KLEUR = ["#2A4DD0", "#1E8A5C", "#B8720F", "#8A4BC7", "#C2452F", "#0F7C8C", "#9C3D78", "#4F6B12", "#B04A0E", "#3B5B92", "#6B6B7B", "#0E7A4F"];
const uwModus = () => { if (UW.modus) return UW.modus; try { return localStorage.getItem("bros.uw.modus") || "agenda"; } catch (e) { return "agenda"; } };
const uwZetModus = (m) => { UW.modus = m; try { localStorage.setItem("bros.uw.modus", m); } catch (e) { } };
const uwWeekend = () => { try { return localStorage.getItem("bros.uw.weekend") === "1"; } catch (e) { return false; } };
const uwHash = (s) => { let h = 0; s = String(s || ""); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
const uwKleur = (pid) => UW_KLEUR[uwHash(pid) % UW_KLEUR.length];
const uwMin = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const uwTijd = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const uwMag = (uid) => !!S.me && (uid === S.me.id || isBeheer());
/** Sleept er iets? Dan niet hertekenen (app.js render) — het blok zou onder de muis verdwijnen. */
function uwBezig() { return !!(UW.drag && UW.drag.actief); }

/* ---------- afspraken die als uren klaarstaan ---------- */
const uwVerborgenSleutel = (uid) => "bros.uw.weg." + uid;
/* 1.70 (script 064): "niet gewerkt" in de databank (mijn_markeringen, soort uw) — ook zichtbaar in het teamoverzicht en op elk toestel */
const uwDbOk = () => typeof schemaV === "function" && schemaV() >= 64 && !!S.mijn_markeringen;
function uwLokaal(uid) { try { return JSON.parse(localStorage.getItem(uwVerborgenSleutel(uid)) || "[]") || []; } catch (e) { return []; } }
function uwVerborgen(uid) {
  const l = new Set(uwLokaal(uid)); if (!uwDbOk()) return l;
  if (S.me && uid === S.me.id && l.size) { const vlag = "bros.uw.db." + uid; let al = false; try { al = !!localStorage.getItem(vlag); if (!al) localStorage.setItem(vlag, "1"); } catch (e) { al = true; }
    if (!al) { const rijen = [...l].slice(-200).map(t => ({ user_id: uid, soort: "uw", sleutel: t })); sb.from("mijn_markeringen").upsert(rijen).then(({ error }) => { if (!error) rijen.forEach(r => S.mijn_markeringen[rowKey("mijn_markeringen", r)] = r); }); } }
  Object.values(S.mijn_markeringen).forEach(m => { if (m.user_id === uid && m.soort === "uw") l.add(m.sleutel); });
  return l;
}
function uwVerberg(uid, tid) {
  if (uwDbOk()) { const rij = { user_id: uid, soort: "uw", sleutel: tid, updated_at: new Date().toISOString() }; S.mijn_markeringen[rowKey("mijn_markeringen", rij)] = rij;
    sb.from("mijn_markeringen").upsert(rij).then(({ error }) => { if (error) { toast("Niet bewaard: " + error.message, 5000); delete S.mijn_markeringen[rowKey("mijn_markeringen", rij)]; render(); } }); return; }
  try { const l = [...uwVerborgen(uid)].filter(x => x !== tid).concat(tid).slice(-400); localStorage.setItem(uwVerborgenSleutel(uid), JSON.stringify(l)); } catch (e) { }
}
/** de afspraak (taak) als tijdvak: { d, van, tot } in minuten; zonder einduur = 1 uur */
function uwAfsVak(t) {
  const van = uwMin(t.afspraak_van); if (!t.start || van == null) return null;
  let tot = uwMin(t.afspraak_tot); if (tot == null || tot <= van) tot = Math.min(van + 60, 24 * 60);
  return { d: t.start, van, tot };
}
/* ---------- 1.73: afspraken uit de Google Agenda die niet via het Planbord gemaakt zijn (Drive-script, actie agendaweek) ---------- */
const UW_GA = {};   // week → { t, items, bezig, fout }
function uwGaWeek(ws) {
  if (typeof driveReady !== "function" || !driveReady()) return [];
  const c = UW_GA[ws];
  if (c && (c.bezig || Date.now() - c.t < 5 * 60000)) return (c && c.items) || [];
  UW_GA[ws] = { t: Date.now(), bezig: true, items: c && c.items };
  driveCall("agendaweek", { van: ws, tot: addDays(ws, 6) })
    .then(j => { UW_GA[ws] = { t: Date.now(), items: Array.isArray(j.items) ? j.items : [] }; if (S.view === "uren") render(); })
    .catch(e => { UW_GA[ws] = { t: Date.now(), items: (c && c.items) || [], fout: e.message }; });
  return (c && c.items) || [];
}
/** de agenda-afspraken van deze persoon: deelnemer, maker, of initialen vooraan in de titel ("PB/ …", "PB + NDK/ …") */
function uwGaVan(uid, items) {
  const p = S.profiles[uid] || {}; const mail = String(p.email || "").toLowerCase(); const ini = String(p.initials || String(p.name || "").slice(0, 2)).toUpperCase();
  return items.filter(e => { if (e.heledag || !e.van) return false;
    const m = String(e.titel || "").match(/^\s*([A-Z]{1,4}(?:\s*\+\s*[A-Z]{1,4})*)\s*\//); const inis = m ? m[1].split("+").map(x => x.trim()) : [];
    return (!!mail && ((e.gasten || []).includes(mail) || e.maker === mail)) || (!!ini && inis.includes(ini)); });
}
const uwGaVak = (e) => { const van = uwMin(e.van); let tot = uwMin(e.tot); if (van == null) return null; if (tot == null || tot <= van) tot = Math.min(van + 60, 24 * 60); return { van, tot }; };
/** al uren in dat tijdvak (minstens de helft overlapt) → de agenda-afspraak hoeft er niet meer te staan */
function uwGaGeboekt(e, uid) {
  const x = uwGaVak(e); if (!x) return true; const duur = x.tot - x.van;
  return Object.values(S.uren || {}).some(h => { if (h.user_id !== uid || h.datum !== e.dag) return false; const v = uwMin(h.tijd_van), t = uwMin(h.tijd_tot); if (v == null || t == null) return false; return Math.min(t, x.tot) - Math.max(v, x.van) >= duur / 2; });
}
/** project raden uit de titel (klantnaam of projectnummer), anders het laatst gebruikte project */
function uwGaProject(e, uid) {
  const t = String(e.titel || "").toLowerCase() + " " + String(e.plaats || "").toLowerCase();
  const p = Object.values(S.projecten || {}).filter(x => ["lopend", "offerte"].includes(x.status) && ((x.nummer && t.includes(String(x.nummer))) || (x.klant && x.klant.length >= 4 && t.includes(x.klant.toLowerCase().split(/\s+/)[0]))))[0];
  return (p && p.id) || uwLaatsteProject(uid);
}
const uwAfspraken = (uid, van, tot) => Object.values(S.taken || {}).filter(t => t.afspraak && (t.assignee === uid || (t.afspraak_team || []).includes(uid)) && t.start && t.start >= van && t.start <= tot && uwAfsVak(t));
const uwGeboekt = (t, uid) => Object.values(S.uren || {}).some(h => h.taak_id === t.id && h.user_id === uid && h.datum === t.start);
/** nog te bevestigen: voorbij of vandaag, niet geboekt, niet weggeklikt */
function uwTeBevestigen(uid, van, tot) {
  const weg = uwVerborgen(uid);
  return uwAfspraken(uid, van, tot).filter(t => t.start <= todayIso && !uwGeboekt(t, uid) && !weg.has(t.id));
}
/** voor "Wacht op jou": eigen afspraken van de laatste 4 weken die nog geen uren hebben */
function uwWachtItems() {
  if (!S.me) return [];
  const l = uwTeBevestigen(S.me.id, addDays(todayIso, -28), todayIso).sort((a, b) => a.start.localeCompare(b.start));
  if (!l.length) return [];
  return [{ k: "uw", stempel: l.map(t => t.id).join(","), ic: "⏱", toon: "accent", titel: l.length === 1 ? "1 afspraak nog als uren te bevestigen" : l.length + " afspraken nog als uren te bevestigen",
    sub: "Uren › weekagenda — één klik per afspraak (vanaf " + fmt(l[0].start) + ")", nav: "uren", week: mondayOf(l[0].start) }];
}

/* ---------- weergave ---------- */
function uwKnoppen() {
  const m = uwModus(); const k = (v, l) => `<button class="${m === v ? "on" : ""}" aria-pressed="${m === v}" data-uw-modus="${v}">${l}</button>`;
  return `<span class="wj-seg uw-seg" role="group" aria-label="Weergave">${k("agenda", "Agenda")}${k("team", "Team")}${k("lijst", "Lijst")}</span>`;
}
function vUrenWeek() {
  const m = uwModus();
  if (m === "lijst" && typeof vUrenLijst === "function") return vUrenLijst(uwKnoppen());
  return m === "team" ? uwTeam() : uwAgenda();
}
function uwKop(titel, u, ws, we, extra) {
  return `<div class="page-head"><div><div class="eyebrow">Urenregistratie · wk ${weekNr(ws)}</div><h1>${titel}</h1></div>
    <div class="actions">${uwKnoppen()}${u ? `<select data-hours-user aria-label="Medewerker">${users().map(x => `<option value="${x.id}" ${x.id === u ? "selected" : ""}>${esc(x.name)}${x.id === S.me.id ? " (ik)" : ""}</option>`).join("")}</select>` : ""}
      <span class="week-nav"><button class="btn sm" data-wnav="-7" aria-label="Vorige week">‹</button><span class="lbl">${fmt(ws)} – ${fmt(we)}</span><button class="btn sm" data-wnav="7" aria-label="Volgende week">›</button></span>
      ${ws !== mondayOf(todayIso) ? `<button class="btn sm" data-uw-vandaag>Deze week</button>` : ""}${extra || ""}</div></div>`;
}
/* overlappende blokken naast elkaar (per groep die elkaar raakt: zoveel kolommen als nodig) */
function uwSchik(items) {
  items.sort((a, b) => a.van - b.van || b.tot - a.tot);
  let groep = [], eind = -1; const groepen = [];
  items.forEach(it => { if (it.van >= eind && groep.length) { groepen.push(groep); groep = []; } groep.push(it); eind = Math.max(eind, it.tot); });
  if (groep.length) groepen.push(groep);
  groepen.forEach(g => { const kol = []; g.forEach(it => { let i = kol.findIndex(e => e <= it.van); if (i < 0) { i = kol.length; kol.push(0); } kol[i] = it.tot; it.kol = i; }); g.forEach(it => it.n = kol.length); });
  return items;
}
function uwAgenda() {
  const u = S.hoursUser || S.me.id, mag = uwMag(u), ws = S.weekStart, we = addDays(ws, 6);
  const uren = Object.values(S.uren || {}).filter(h => h.user_id === u && h.datum >= ws && h.datum <= we);
  const afs = uwAfspraken(u, ws, we); const weg = uwVerborgen(u);
  const ga = uwGaVan(u, uwGaWeek(ws)).filter(e => e.dag >= ws && e.dag <= we && !weg.has("ga:" + e.id) && !uwGaGeboekt(e, u));   // 1.73
  const weekend = uwWeekend() || uren.some(h => (pd(h.datum).getUTCDay() + 6) % 7 >= 5) || afs.some(t => (pd(t.start).getUTCDay() + 6) % 7 >= 5) || ga.some(e => (pd(e.dag).getUTCDay() + 6) % 7 >= 5);   // 1.74: ook agenda-afspraken in het weekend
  const dagen = Array.from({ length: weekend ? 7 : 5 }, (_, i) => addDays(ws, i));
  const vak = (h) => { const v = uwMin(h.tijd_van); if (v == null) return null; let t = uwMin(h.tijd_tot); if (t == null || t <= v) t = Math.min(v + Math.round((Number(h.uren) || 1) * 60), 24 * 60); return { van: v, tot: t }; };
  // zichtbaar bereik: 7–19 u, ruimer als er iets buiten valt
  let h0 = 7 * 60, h1 = 19 * 60;
  uren.forEach(h => { const x = vak(h); if (x) { h0 = Math.min(h0, Math.floor(x.van / 60) * 60); h1 = Math.max(h1, Math.ceil(x.tot / 60) * 60); } });
  afs.forEach(t => { const x = uwAfsVak(t); h0 = Math.min(h0, Math.floor(x.van / 60) * 60); h1 = Math.max(h1, Math.ceil(x.tot / 60) * 60); });
  ga.forEach(e => { const x = uwGaVak(e); h0 = Math.min(h0, Math.floor(x.van / 60) * 60); h1 = Math.max(h1, Math.ceil(x.tot / 60) * 60); });
  UW.bereik = { h0, h1 };
  const hoogte = (h1 - h0) * UW_PX; const doel = typeof FX !== "undefined" && FX.doel ? FX.doel() : 8;
  const perDag = (d) => uren.filter(h => h.datum === d).reduce((s, h) => s + (Number(h.uren) || 0), 0);
  const tot = uren.reduce((s, h) => s + (Number(h.uren) || 0), 0);
  const open = afs.filter(t => t.start <= todayIso && !uwGeboekt(t, u) && !weg.has(t.id));
  // andere weken met afspraken zonder uren (laatste 8 weken)
  const elders = mag ? uwTeBevestigen(u, addDays(todayIso, -56), todayIso).filter(t => t.start < ws || t.start > we) : [];
  const wkn = [...new Map(elders.map(t => [mondayOf(t.start), 0])).keys()].sort().map(w => ({ w, n: elders.filter(t => mondayOf(t.start) === w).length }));
  const nu = new Date(); const nuMin = nu.getHours() * 60 + nu.getMinutes();
  const kolom = (d) => {
    const items = uwSchik(uren.filter(h => h.datum === d && vak(h)).map(h => Object.assign({ h, soort: "uur" }, vak(h)))
      .concat(afs.filter(t => t.start === d && !uwGeboekt(t, u) && !weg.has(t.id)).map(t => Object.assign({ t, soort: "afs" }, uwAfsVak(t))))
      .concat(ga.filter(e => e.dag === d).map(e => Object.assign({ e, soort: "ga" }, uwGaVak(e)))));
    const pos = (it) => `top:${(it.van - h0) * UW_PX}px;height:${Math.max(18, (it.tot - it.van) * UW_PX - 2)}px;left:calc(${(100 / it.n) * it.kol}% + 2px);width:calc(${100 / it.n}% - 4px)`;
    return `<div class="uw-dag${d === todayIso ? " vandaag" : ""}${mag ? " mag" : ""}" data-uw-dag="${d}" style="height:${hoogte}px">
      ${items.map(it => {
        if (it.soort === "uur") { const h = it.h; const p = S.projecten[h.project_id]; const kort = it.tot - it.van < 45;
          return `<div class="uw-b${kort ? " kort" : ""}${mag ? " mag" : ""}" data-uw-h="${h.id}" style="${pos(it)};--k:${uwKleur(h.project_id)}" title="${esc((p ? projName(p) : "") + (S.taken[h.taak_id] ? " · " + S.taken[h.taak_id].titel : "") + " · " + uwTijd(it.van) + "–" + uwTijd(it.tot) + (h.notitie ? "\n" + h.notitie : ""))}">
            <b>${esc(p ? p.klant || p.nummer || "" : "—")}</b><small>${uwTijd(it.van)}–${uwTijd(it.tot)} · ${nl(h.uren)} u${S.taken[h.taak_id] ? " · " + esc(S.taken[h.taak_id].titel) : ""}${h.notitie && h.notitie !== (S.taken[h.taak_id] || {}).titel ? " · " + esc(h.notitie) : ""}</small>${mag ? `<span class="uw-rek" data-uw-rek="${h.id}" aria-hidden="true"></span>` : ""}</div>`; }
        if (it.soort === "ga") { const e = it.e; const voorbij = e.dag <= todayIso;   // 1.73: uit de Google Agenda
          return `<div class="uw-a uw-ga${voorbij ? " open" : ""}" style="${pos(it)}" data-uw-ga="${esc(e.id)}" title="${esc("Google Agenda: " + e.titel + (e.plaats ? "\n" + e.plaats : ""))}">
            <b>🗓 ${esc(e.titel || "Afspraak")}</b><small>${uwTijd(it.van)}–${uwTijd(it.tot)}${e.plaats ? " · " + esc(e.plaats) : ""}</small>
            ${mag && voorbij ? `<span class="uw-a-k"><button type="button" class="btn sm primary" data-uw-ga-ok="${esc(e.id)}" data-dag="${e.dag}">✓ Uren…</button><button type="button" class="btn sm ghost" data-uw-ga-weg="${esc(e.id)}" title="Niet gewerkt / hoort niet bij een project: niet meer tonen" aria-label="Niet tonen">✕</button></span>` : voorbij ? "" : `<span class="uw-gepland">agenda</span>`}</div>`; }
        const t = it.t; const p = S.projecten[t.project_id]; const voorbij = t.start <= todayIso;
        return `<div class="uw-a${voorbij ? " open" : ""}" style="${pos(it)};--k:${uwKleur(t.project_id)}" data-uw-afs="${t.id}">
          <b>📅 ${esc(p ? p.klant || "" : "")}</b><small>${uwTijd(it.van)}–${uwTijd(it.tot)} · ${esc(t.titel || "afspraak")}</small>
          ${mag && voorbij ? `<span class="uw-a-k"><button type="button" class="btn sm primary" data-uw-ok="${t.id}" title="Boek ${nl((it.tot - it.van) / 60)} u op ${esc(p ? p.klant : "")}">✓ Uren</button><button type="button" class="btn sm" data-uw-aanpas="${t.id}">Aanpassen…</button><button type="button" class="btn sm ghost" data-uw-weg="${t.id}" title="Niet gewerkt / niet gegaan: niet meer tonen" aria-label="Niet gewerkt">✕</button></span>` : voorbij ? "" : `<span class="uw-gepland">gepland</span>`}</div>`;
      }).join("")}
      ${d === todayIso && nuMin >= h0 && nuMin <= h1 ? `<div class="uw-nu" style="top:${(nuMin - h0) * UW_PX}px"></div>` : ""}</div>`;
  };
  const zonder = (d) => uren.filter(h => h.datum === d && !vak(h)).map(h => { const p = S.projecten[h.project_id];
    return `<button type="button" class="uw-z" data-edit-hours="${h.id}" style="--k:${uwKleur(h.project_id)}" title="${esc(h.notitie || "")}"><b>${nl(h.uren)} u</b> ${esc(p ? p.klant || "" : "—")}</button>`; }).join("");
  const heeftZonder = dagen.some(d => uren.some(h => h.datum === d && !vak(h)));
  const perProj = {}; uren.forEach(h => { perProj[h.project_id] = (perProj[h.project_id] || 0) + (Number(h.uren) || 0); });
  const legende = Object.entries(perProj).sort((a, b) => b[1] - a[1]).map(([pid, n]) => { const p = S.projecten[pid]; return `<span class="uw-leg" style="--k:${uwKleur(pid)}"><i></i>${esc(p ? projName(p) : "—")} <b class="num">${nl(n)} u</b></span>`; }).join("");
  const naam = u === S.me.id ? "Mijn week" : "Week van " + (userById(u).name || "");
  return `${uwKop(naam, u, ws, we, mag ? `<button class="btn primary" data-act="log-hours">+ Uren</button>` : "")}
    ${open.length && mag ? `<div class="notice uw-melding"><b>${open.length === 1 ? "1 afspraak" : open.length + " afspraken"} deze week nog zonder uren.</b> Klik <b>✓ Uren</b> om ze te boeken zoals gepland, <b>Aanpassen…</b> als het anders liep, of <b>✕</b> als je niet ging. ${open.length > 1 ? `<button class="btn sm" data-uw-allesok="${u}">Alle ${open.length} boeken zoals gepland</button>` : ""}</div>` : ""}
    ${wkn.length ? `<div class="uw-elders muted">Ook nog afspraken zonder uren in ${wkn.map(x => `<button class="btn ghost sm" data-uw-week="${x.w}">wk ${weekNr(x.w)} (${x.n})</button>`).join(" ")}</div>` : ""}
    ${!mag ? `<div class="muted" style="font-size:13px;margin:-4px 0 10px">Alleen lezen — je bekijkt de week van ${esc(userById(u).name || "")}.</div>` : ""}
    <div class="panel uw-panel"><div class="uw-scroll"><div class="uw" style="--n:${dagen.length}">
      <div class="uw-hoek"><span class="num">${nl(tot)} u</span></div>
      ${dagen.map(d => { const s = perDag(d); const wd = (pd(d).getUTCDay() + 6) % 7; return `<div class="uw-dk${d === todayIso ? " vandaag" : ""}"><b>${DAYS[wd]} ${fmt(d)}</b><span class="num">${s ? nl(s) + " u" : "—"}</span><i style="width:${Math.min(100, (s / doel) * 100)}%" class="${s >= doel ? "vol" : ""}"></i></div>`; }).join("")}
      ${heeftZonder ? `<div class="uw-hoek uw-zl">zonder<br>tijdstip</div>${dagen.map(d => `<div class="uw-zr">${zonder(d)}</div>`).join("")}` : ""}
      <div class="uw-uren" style="height:${hoogte}px">${Array.from({ length: (h1 - h0) / 60 }, (_, i) => `<span style="top:${i * 60 * UW_PX}px">${String(h0 / 60 + i).padStart(2, "0")}:00</span>`).join("")}</div>
      ${dagen.map(kolom).join("")}
    </div></div>
    <div class="uw-voet">${legende || `<span class="muted">Nog geen uren deze week.</span>`}<span class="muted uw-tip">${mag ? "Sleep over een leeg vak om uren toe te voegen · sleep een blok om het te verplaatsen · trek aan de onderrand om het langer te maken" : ""}</span>
      ${!weekend ? `<button class="btn ghost sm" data-uw-weekend="1">Weekend tonen</button>` : uwWeekend() ? `<button class="btn ghost sm" data-uw-weekend="0">Weekend verbergen</button>` : ""}</div></div>`;
}
function uwTeam() {
  const ws = S.weekStart, we = addDays(ws, 6); const doel = 8;
  const ploeg = users().filter(x => x.active !== false);
  const alle = Object.values(S.uren || {}).filter(h => h.datum >= ws && h.datum <= we);
  const weekend = alle.some(h => (pd(h.datum).getUTCDay() + 6) % 7 >= 5);
  const dagen = Array.from({ length: weekend ? 7 : 5 }, (_, i) => addDays(ws, i));
  const cel = (uid, d) => {
    const l = alle.filter(h => h.user_id === uid && h.datum === d); const s = l.reduce((a, h) => a + (Number(h.uren) || 0), 0);
    const pp = {}; l.forEach(h => pp[h.project_id] = (pp[h.project_id] || 0) + (Number(h.uren) || 0));
    const leeg = !s && d < todayIso && (pd(d).getUTCDay() + 6) % 7 < 5;
    return `<td class="uw-tc-td"><button type="button" class="uw-tc${leeg ? " leeg" : ""}" data-uw-zie="${uid}" data-week="${ws}" title="${esc(Object.entries(pp).map(([pid, n]) => (S.projecten[pid] ? projName(S.projecten[pid]) : "—") + ": " + nl(n) + " u").join("\n") || "geen uren")}">
      <span class="num">${s ? nl(s) : leeg ? "0" : "·"}</span><span class="uw-st">${Object.entries(pp).map(([pid, n]) => `<i style="width:${Math.min(100, (n / doel) * 100)}%;background:${uwKleur(pid)}"></i>`).join("")}</span></button></td>`;
  };
  const projTot = {}; alle.forEach(h => projTot[h.project_id] = (projTot[h.project_id] || 0) + (Number(h.uren) || 0));
  return `${uwKop("Uren van het team", null, ws, we, `<button class="btn" data-act="export-hours" title="Alle uren als CSV (opent in Excel)">Exporteren</button>`)}
    <div class="panel"><div class="tw"><table class="t uw-team"><thead><tr><th>Wie</th>${dagen.map(d => `<th class="${d === todayIso ? "vandaag" : ""}">${DAYS[(pd(d).getUTCDay() + 6) % 7]} ${fmt(d)}</th>`).join("")}<th class="r">Week</th><th class="r" title="Afspraken die voorbij zijn maar nog geen uren hebben">Te bevestigen</th></tr></thead>
      <tbody>${ploeg.map(x => { const s = alle.filter(h => h.user_id === x.id).reduce((a, h) => a + (Number(h.uren) || 0), 0); const tb = uwTeBevestigen(x.id, ws, we).length;
        return `<tr><td><button type="button" class="btn ghost sm uw-wie" data-uw-zie="${x.id}" data-week="${ws}">${avatar(x.id)} ${esc(x.name)}</button></td>${dagen.map(d => cel(x.id, d)).join("")}<td class="r num"><b>${nl(s)} u</b></td><td class="r">${tb ? `<span class="pill st-offerte">${tb}</span>` : `<span class="muted">—</span>`}</td></tr>`; }).join("")}</tbody></table></div>
      <div class="uw-voet">${Object.entries(projTot).sort((a, b) => b[1] - a[1]).map(([pid, n]) => `<span class="uw-leg" style="--k:${uwKleur(pid)}"><i></i>${esc(S.projecten[pid] ? projName(S.projecten[pid]) : "—")} <b class="num">${nl(n)} u</b></span>`).join("") || `<span class="muted">Nog geen uren deze week.</span>`}
        <span class="muted uw-tip">Klik op een cel of naam om die week te openen. Een rode 0 = werkdag zonder uren.</span></div></div>`;
}

/* ---------- acties ---------- */
/** voorstel voor een nieuw blok: het project waar deze persoon het laatst uren op schreef (anders het open project) */
function uwLaatsteProject(uid) {
  const l = Object.values(S.uren || {}).filter(h => h.user_id === uid && S.projecten[h.project_id]).sort((a, b) => (b.datum + (b.created_at || "")).localeCompare(a.datum + (a.created_at || "")));
  return (l[0] && l[0].project_id) || S.project || "";
}
function uwNieuw(uid, d, van, tot) {
  van = Math.max(0, van); tot = Math.min(24 * 60, Math.max(van + UW_SNAP, tot));
  const pid = uwLaatsteProject(uid);
  hoursForm({ user_id: uid, datum: d, tijd_van: uwTijd(van), tijd_tot: tot >= 24 * 60 ? "23:59" : uwTijd(tot), uren: Math.round(((tot - van) / 60) * 4) / 4, project_id: pid || undefined }, pid || undefined);
}
async function uwBoekAfspraak(tid, uid, stil) {
  const t = S.taken[tid]; const x = t && uwAfsVak(t); if (!x) return false;
  if (uwGeboekt(t, uid)) { if (!stil) toast("Deze afspraak heeft al uren."); return false; }
  const row = { user_id: uid, datum: x.d, project_id: t.project_id, taak_id: t.id, tijd_van: uwTijd(x.van), tijd_tot: x.tot >= 24 * 60 ? "23:59" : uwTijd(x.tot), uren: Math.round(((x.tot - x.van) / 60) * 4) / 4, notitie: "" };   // de taak (afspraak) staat er al bij
  try { await dbInsert("uren", row); } catch (e) { return false; }
  if (!stil) toast(`${nl(row.uren)} u geboekt op ${S.projecten[t.project_id] ? S.projecten[t.project_id].klant : "het project"}`);
  return true;
}
function uwAanpassen(tid, uid) {
  const t = S.taken[tid]; const x = t && uwAfsVak(t); if (!x) return;
  hoursForm({ user_id: uid, datum: x.d, project_id: t.project_id, taak_id: t.id, tijd_van: uwTijd(x.van), tijd_tot: x.tot >= 24 * 60 ? "23:59" : uwTijd(x.tot), uren: Math.round(((x.tot - x.van) / 60) * 4) / 4, notitie: "" }, t.project_id);
}
/* minuten in de dagkolom onder de muis (afgerond op een kwartier) */
function uwMinuut(dag, y) { const r = dag.getBoundingClientRect(); const m = UW.bereik.h0 + (y - r.top) / UW_PX; return Math.max(UW.bereik.h0, Math.min(UW.bereik.h1, Math.round(m / UW_SNAP) * UW_SNAP)); }
function uwDagOnder(x, y) { const el = document.elementFromPoint(x, y); return el && el.closest ? el.closest(".uw-dag.mag") : null; }

document.addEventListener("pointerdown", (e) => {
  if (S.view !== "uren" || e.button > 0) return;
  const rek = e.target.closest && e.target.closest("[data-uw-rek]"); const blok = !rek && e.target.closest && e.target.closest(".uw-b.mag");
  const dag = e.target.closest && e.target.closest(".uw-dag.mag");
  if (!dag || (e.target.closest(".uw-a") && !blok)) return;
  const uid = S.hoursUser || S.me.id; if (!uwMag(uid)) return;
  if (rek || blok) {
    const h = S.uren[(rek || blok).dataset.uwRek || blok.dataset.uwH]; if (!h) return;
    const el = rek ? rek.closest(".uw-b") : blok; const v = uwMin(h.tijd_van); let t = uwMin(h.tijd_tot); if (t == null || t <= v) t = v + Math.round((Number(h.uren) || 1) * 60);
    UW.drag = { soort: rek ? "rek" : "schuif", id: h.id, el, x0: e.clientX, y0: e.clientY, van: v, tot: t, d: h.datum, nVan: v, nTot: t, nD: h.datum, actief: false, punt: e.pointerType };
    if (e.pointerType !== "touch") e.preventDefault();
    return;
  }
  if (e.target.closest(".uw-b")) return;
  const m = uwMinuut(dag, e.clientY);
  UW.drag = { soort: "nieuw", dag, d: dag.dataset.uwDag, m0: m, m1: m + UW_SNAP, x0: e.clientX, y0: e.clientY, actief: false, punt: e.pointerType, t0: Date.now() };
  if (e.pointerType !== "touch") e.preventDefault();
});
document.addEventListener("pointermove", (e) => {
  const g = UW.drag; if (!g) return;
  const ver = Math.abs(e.clientX - g.x0) + Math.abs(e.clientY - g.y0);
  if (!g.actief) { if (ver < 5 || g.punt === "touch") return; g.actief = true; document.body.classList.add("uw-sleept"); }
  if (g.soort === "nieuw") {
    const m = uwMinuut(g.dag, e.clientY); g.m1 = m; const a = Math.min(g.m0, m), b = Math.max(g.m0, m) + (m >= g.m0 ? UW_SNAP : 0);
    let gh = g.dag.querySelector(".uw-geest"); if (!gh) { gh = document.createElement("div"); gh.className = "uw-geest"; g.dag.appendChild(gh); }
    gh.style.top = (a - UW.bereik.h0) * UW_PX + "px"; gh.style.height = Math.max(UW_SNAP, b - a) * UW_PX + "px"; gh.textContent = `${uwTijd(a)}–${uwTijd(Math.min(b, 24 * 60))} · ${nl((b - a) / 60)} u`;
    return;
  }
  const dm = Math.round(((e.clientY - g.y0) / UW_PX) / UW_SNAP) * UW_SNAP;
  if (g.soort === "rek") { g.nTot = Math.max(g.van + UW_SNAP, Math.min(24 * 60, g.tot + dm)); g.el.style.height = Math.max(18, (g.nTot - g.van) * UW_PX - 2) + "px"; }
  else {
    const duur = g.tot - g.van; g.nVan = Math.max(0, Math.min(24 * 60 - duur, g.van + dm)); g.nTot = g.nVan + duur;
    const doel = uwDagOnder(e.clientX, e.clientY); if (doel && doel !== g.el.parentElement) { doel.appendChild(g.el); g.el.style.left = "2px"; g.el.style.width = "calc(100% - 4px)"; }
    if (doel) g.nD = doel.dataset.uwDag;
    g.el.style.top = (g.nVan - UW.bereik.h0) * UW_PX + "px";
  }
  const s = g.el.querySelector("small"); if (s) s.textContent = `${uwTijd(g.nVan)}–${uwTijd(Math.min(g.nTot, 24 * 60))} · ${nl((g.nTot - g.nVan) / 60)} u`;
  g.el.classList.add("sleept");
});
async function uwLos(e) {
  const g = UW.drag; if (!g) return; UW.drag = null; document.body.classList.remove("uw-sleept");
  const gh = document.querySelector(".uw-geest"); if (gh) gh.remove();
  const uid = S.hoursUser || S.me.id;
  if (e.type === "pointercancel") { if (g.actief) render(); return; }
  if (g.soort === "nieuw") {
    if (g.actief) { const a = Math.min(g.m0, g.m1), b = Math.max(g.m0, g.m1) + (g.m1 >= g.m0 ? UW_SNAP : 0); return uwNieuw(uid, g.d, a, b); }
    if (g.punt === "touch" ? Date.now() - g.t0 < 600 : true) return uwNieuw(uid, g.d, g.m0, g.m0 + 60);   // tik of klik: één uur
    return;
  }
  if (!g.actief) { const h = S.uren[g.id]; if (h) hoursForm(h); return; }   // klikken = bewerken
  const h = S.uren[g.id]; if (!h) return render();
  if (g.nVan === g.van && g.nTot === g.tot && g.nD === g.d) return render();
  const patch = { datum: g.nD, tijd_van: uwTijd(g.nVan), tijd_tot: g.nTot >= 24 * 60 ? "23:59" : uwTijd(g.nTot) };
  if (g.soort === "rek") patch.uren = Math.round(((g.nTot - g.nVan) / 60) * 4) / 4;
  try { await dbUpdate("uren", h.id, patch); toast(g.soort === "rek" ? `${nl(patch.uren)} u` : `Verplaatst naar ${DAYS[(pd(patch.datum).getUTCDay() + 6) % 7]} ${fmt(patch.datum)} ${patch.tijd_van}`, 2200); } catch (x) { }
  render();
}
document.addEventListener("pointerup", uwLos);
document.addEventListener("pointercancel", uwLos);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && UW.drag) { UW.drag = null; document.body.classList.remove("uw-sleept"); const gh = document.querySelector(".uw-geest"); if (gh) gh.remove(); render(); } });
document.addEventListener("click", async (e) => {
  const ga = e.target.closest && e.target.closest("[data-uw-ga-ok],[data-uw-ga-weg]");   // 1.73: Google Agenda
  if (ga) { e.preventDefault(); e.stopPropagation(); const u = S.hoursUser || S.me.id; const id = ga.dataset.uwGaOk || ga.dataset.uwGaWeg;
    const ev = Object.values(UW_GA).flatMap(c => c.items || []).find(x => x.id === id); if (!ev) return;
    if (ga.dataset.uwGaWeg) { uwVerberg(u, "ga:" + id); render(); return; }
    const x = uwGaVak(ev); const pid = uwGaProject(ev, u);
    hoursForm({ user_id: u, datum: ev.dag, tijd_van: uwTijd(x.van), tijd_tot: x.tot >= 24 * 60 ? "23:59" : uwTijd(x.tot), uren: Math.round(((x.tot - x.van) / 60) * 4) / 4, notitie: String(ev.titel || "").slice(0, 200), project_id: pid || undefined }, pid || undefined);
    return; }
  const el = e.target.closest && e.target.closest("[data-uw-modus],[data-uw-ok],[data-uw-aanpas],[data-uw-weg],[data-uw-allesok],[data-uw-week],[data-uw-zie],[data-uw-weekend],[data-uw-vandaag]"); if (!el) return;
  const d = el.dataset; const uid = S.hoursUser || S.me.id; e.preventDefault(); e.stopPropagation();
  if (d.uwModus) { uwZetModus(d.uwModus); return render(); }
  if (d.uwOk) { el.disabled = true; await uwBoekAfspraak(d.uwOk, uid); return render(); }
  if (d.uwAanpas) return uwAanpassen(d.uwAanpas, uid);
  if (d.uwWeg) { const t = S.taken[d.uwWeg]; if (!confirm(`"${(t && t.titel) || "Afspraak"}" niet als uren boeken (niet gegaan of geen tijd aan besteed)? Ze verdwijnt uit je agenda en uit Wacht op jou.`)) return; uwVerberg(uid, d.uwWeg); return render(); }
  if (d.uwAllesok) { const l = uwTeBevestigen(uid, S.weekStart, addDays(S.weekStart, 6)); if (!l.length || !confirm(`Deze ${l.length} afspraken boeken zoals gepland?\n\n${l.map(t => `• ${fmt(t.start)} ${String(t.afspraak_van || "").slice(0, 5)} · ${S.projecten[t.project_id] ? S.projecten[t.project_id].klant : ""} · ${t.titel || ""}`).join("\n")}`)) return;
    let n = 0; for (const t of l) if (await uwBoekAfspraak(t.id, uid, true)) n++; toast(`${n} afspraken geboekt`); return render(); }
  if (d.uwWeek) { S.weekStart = d.uwWeek; return render(); }
  if (d.uwZie) { S.hoursUser = d.uwZie; if (d.week) S.weekStart = d.week; uwZetModus("agenda"); return render(); }
  if (d.uwWeekend) { try { localStorage.setItem("bros.uw.weekend", d.uwWeekend); } catch (x) { } return render(); }
  if (d.uwVandaag != null) { S.weekStart = mondayOf(todayIso); return render(); }
}, true);
