/* =====================================================================
   BROS Klantenportaal — alleen-lezen zicht van de bouwheer op zijn project
   Leest uitsluitend de klant_*-views (databasescript 011): geen kostprijzen, marges of interne notities.
   ===================================================================== */
const PORTAAL_VERSION = "1.12.0";
const cfg = window.PLANBORD_CONFIG || {};
const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = (n, dec = 2) => Number(n || 0).toLocaleString("nl-BE", { style: "currency", currency: "EUR", minimumFractionDigits: dec, maximumFractionDigits: dec });
const nl = (n, dec = 2) => Number(n || 0).toLocaleString("nl-BE", { minimumFractionDigits: 0, maximumFractionDigits: dec });
const pct = (x) => nl(Math.round(x * 1000) / 10, 1) + " %";
const fmt = (s) => { if (!s) return "—"; const [y, m, d] = s.slice(0, 10).split("-"); return `${d}/${m}/${y}`; };
const tijd = (t) => t ? String(t).slice(0, 5) : "";
const MAAND = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
const fmtLang = (s) => { if (!s) return "—"; const d = new Date(s.slice(0, 10) + "T00:00:00"); return `${d.getDate()} ${MAAND[d.getMonth()]} ${d.getFullYear()}`; };
const PROJ_STATUS = { offerte: "In offerte", lopend: "In uitvoering", on_hold: "Even gepauzeerd", afgerond: "Opgeleverd", verloren: "Niet doorgegaan" };
const MS_STATUS = { offerte: "Offerte", akkoord: "Akkoord", meerwerk: "Meerwerk", minwerk: "Minwerk" };
const VORD_SOORT = { voorschot: "Voorschot", vordering: "Vordering", slotfactuur: "Slotfactuur", meerwerk: "Meerwerkfactuur" };
const VORD_STATUS = { verzonden: "Te betalen", betaald: "Betaald" };
const URL_AUTH = (() => {
  const h = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  const q = location.search.startsWith("?") ? location.search.slice(1) : "";
  const p = new URLSearchParams(h.includes("=") ? h : q);
  const err = p.get("error_description") || p.get("error_code") || p.get("error") || "";
  if (err) history.replaceState(null, "", location.pathname);
  return { type: p.get("type") || "", error: err };
})();

const S = { session: null, me: null, ready: false, loadError: null, setPassword: false, passwordForced: false, tab: "welkom", project: null, data: null };
let loginNotice = URL_AUTH.error ? (/expired|invalid|otp/i.test(URL_AUTH.error) ? "Deze link is vervallen of al gebruikt. Log in met je wachtwoord, of vraag hieronder een nieuwe link aan." : "Er ging iets mis met de link: " + URL_AUTH.error) : "";

function toast(msg, ms = 3500) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), ms); }

/* ---------- gegevens ---------- */
async function loadAll() {
  const q = (v, sel = "*") => sb.from(v).select(sel).then(r => { if (r.error) throw new Error(v + ": " + r.error.message); return r.data || []; });
  const [me, projecten, meetstaat, vorderingen, regels, planning, uren, documenten, team, ik, fasen, loten, inst] = await Promise.all([
    sb.from("profiles").select("id,name,email,role").eq("id", S.session.user.id).maybeSingle().then(r => r.data),
    q("klant_project"), q("klant_meetstaat"), q("klant_vorderingen"), q("klant_vordering_regels"), q("klant_planning"), q("klant_uren"),
    q("klant_documenten"), q("klant_team"), q("klant_ik"), q("fasen"), q("loten"),
    sb.from("instellingen").select("value").eq("key", "portaal").maybeSingle().then(r => r.data?.value || {}),
  ]);
  S.me = me;
  S.data = { projecten: projecten.sort((a, b) => (b.nummer || "").localeCompare(a.nummer || "")), meetstaat, vorderingen, regels, planning, uren, documenten, team, ik, fasen: fasen.filter(f => f.actief !== false).sort((a, b) => a.nr - b.nr), loten: Object.fromEntries(loten.map(l => [l.nr, l])), inst };
  if (!S.project || !projecten.some(p => p.id === S.project)) S.project = projecten[0]?.id || null;
  S.eersteBezoek = ik.length > 0 && ik.every(x => !x.portaal_login);
  sb.rpc("portaal_bezoek").then(() => { });
}
const D = () => S.data;
const P = () => D().projecten.find(p => p.id === S.project);
const voornaam = () => { const ik = D().ik[0]; const n = (ik?.naam || S.me?.name || "").trim(); return n.split(/\s+/)[0] || n; };
const lotNaam = (nr) => D().loten[nr] ? `${nr}. ${D().loten[nr].naam}` : String(nr);
const faseNaam = (nr) => D().fasen.find(f => f.nr === nr)?.naam || "";
const isMw = (r) => r.status === "meerwerk" || r.status === "minwerk";
const telt = (r) => r.status !== "vervallen";
const signed = (r) => Number(r.totaal) * (r.status === "minwerk" ? -1 : 1);
const msRows = () => D().meetstaat.filter(r => r.project_id === S.project && telt(r)).sort((a, b) => a.lot - b.lot || (a.volgorde ?? 0) - (b.volgorde ?? 0) || (a.code || "").localeCompare(b.code || ""));

/* ---------- vorderingen: zelfde rekenregels als het Planbord (post-% overschrijft lot-%) ---------- */
function vordCalc(v) {
  const lot = {}, post = {}; D().regels.filter(r => r.vordering_id === v.id).forEach(r => { if (r.post_id) post[r.post_id] = Number(r.pct); else lot[r.lot] = Number(r.pct); });
  let excl = 0, btw = 0; const perLot = {};
  msRows().filter(r => isMw(r) === (v.soort === "meerwerk")).forEach(r => { const p = post[r.id] ?? lot[r.lot]; if (p == null) return; const a = p * signed(r); excl += a; btw += a * (Number(r.btw) || 0); perLot[r.lot] = (perLot[r.lot] || 0) + a; });
  const locked = v.status !== "opgemaakt"; const bedrag = locked && v.bedrag_excl != null ? Number(v.bedrag_excl) : excl;
  const btw2 = excl ? bedrag * (btw / excl) : btw;
  return { excl: bedrag, btw: btw2, incl: bedrag + btw2, perLot, loten: Object.keys(perLot).filter(l => Math.abs(perLot[l]) > 0.005).map(Number) };
}

/* ---------- weergave ---------- */
function render() {
  if (!S.session) return renderLogin();
  if (S.setPassword) return renderSetPassword();
  if (!S.ready) { $("#app").innerHTML = S.loadError ? `<div class="login"><div class="card"><h1>Even geen verbinding</h1><p>${esc(S.loadError)}</p><button class="btn primary" onclick="location.reload()">Opnieuw proberen</button></div></div>` : `<div class="loading">Je portaal wordt geladen…</div>`; return; }
  if (S.me && S.me.role !== "klant") { $("#app").innerHTML = `<div class="login"><div class="card"><div class="brand" style="margin-bottom:14px"><span class="mark">BROS</span><span class="name">Klantenportaal</span></div><h1>Dit is het klantenportaal</h1><p>Je bent ingelogd als teamlid (${esc(S.me.email || "")}). Het Planbord vind je hier:</p><p><a class="btn primary" href="../">Naar het Planbord</a> <button class="btn ghost" data-act="logout">Uitloggen</button></p></div></div>`; return; }
  if (!D().projecten.length) { $("#app").innerHTML = `<div class="login"><div class="card"><div class="brand" style="margin-bottom:14px"><span class="mark">BROS</span><span class="name">Klantenportaal</span></div><h1>Nog geen project gekoppeld</h1><p>Je login werkt, maar er is nog geen project aan je gekoppeld. Laat het ons even weten via ${esc(D().inst.contact_email || "info@bros.be")}.</p><p><button class="btn ghost" data-act="logout">Uitloggen</button></p></div></div>`; return; }
  const p = P();
  const tabs = [["welkom", "Welkom"], ["meetstaat", "Meetstaat"], ["facturatie", "Facturatie"], ["planning", "Planning"], ["documenten", "Documenten"], ["team", "Wie is wie"]];
  $("#app").innerHTML = `<header class="top"><div class="top-in"><div class="brand"><span class="mark">BROS</span><span class="name">Klantenportaal</span></div>
      <div class="who">${D().projecten.length > 1 ? `<select id="projSel" class="btn sm">${D().projecten.map(x => `<option value="${x.id}" ${x.id === p.id ? "selected" : ""}>${esc(x.nummer ? x.nummer + " · " : "")}${esc(x.naam || x.klant)}</option>`).join("")}</select>` : ""}<span>${esc(S.me?.name || "")}</span><button class="btn ghost sm" data-act="logout">Uitloggen</button></div></div>
    <nav class="tabs">${tabs.map(([k, l]) => `<button class="${S.tab === k ? "on" : ""}" data-tab="${k}">${l}</button>`).join("")}</nav></header>
    <main>${({ welkom: vWelkom, meetstaat: vMeetstaat, facturatie: vFacturatie, planning: vPlanning, documenten: vDocumenten, team: vTeam })[S.tab](p)}</main>`;
  window.scrollTo({ top: 0 });
}

function vWelkom(p) {
  const inst = D().inst; const fasen = D().fasen; const nu = p.fase_nr;
  const plan = Object.fromEntries(D().planning.filter(x => x.project_id === p.id).map(x => [x.fase_nr, x]));
  const lead = D().team.find(t => t.id === p.lead);
  const status = p.status === "afgerond" ? "Je project is opgeleverd." : nu ? `Je project zit in stap ${nu}: <b>${esc(faseNaam(nu))}</b>.` : `Status: ${PROJ_STATUS[p.status] || p.status}.`;
  return `<div class="hero"><div class="eyebrow">${esc(p.nummer || "")} · ${esc(p.naam || "")}</div><h1>Welkom, ${esc(voornaam())}</h1>
      <p class="lead">${esc(inst.welkom || "")}</p></div>
    <div class="two"><div class="stack">
      <div class="panel"><div class="panel-head"><h2>Waar staat je project?</h2><span class="pill grijs">${PROJ_STATUS[p.status] || esc(p.status)}</span></div><div class="panel-body">
        <p>${status}</p>
        <p class="muted" style="font-size:13px">${esc([p.adres, [p.postcode, p.gemeente].filter(Boolean).join(" ")].filter(Boolean).join(", "))}${p.start ? ` · gestart ${fmtLang(p.start)}` : ""}${p.eind ? ` · verwachte oplevering ${fmtLang(p.eind)}` : ""}</p></div></div>
      <div class="panel"><div class="panel-head"><h2>Zo werkt het bij BROS</h2></div><div class="panel-body">
        <p class="muted" style="font-size:14px">${esc(inst.werkwijze || "")}</p>
        <ol class="steps">${fasen.map(f => { const st = p.status === "afgerond" || (nu != null && f.nr < nu) ? "done" : f.nr === nu ? "now" : "todo"; const pl = plan[f.nr];
          return `<li class="${st}"><span class="n">${st === "done" ? "✓" : f.nr}</span><span class="nm">${esc(f.naam)}</span><span class="when">${st === "now" ? "nu bezig" : pl && pl.start && st !== "done" ? "vanaf " + fmt(pl.start) : pl && pl.eind && st === "done" ? "klaar" : ""}</span></li>`; }).join("")}</ol></div></div>
    </div><div class="stack">
      ${lead ? `<div class="panel"><div class="panel-head"><h2>Je aanspreekpunt</h2></div><div class="panel-body"><div class="person">${avatar(lead, 56)}<div><b>${esc(lead.name)}</b><div class="muted" style="font-size:13px">${esc(lead.functie || "BROS")}</div>${lead.bio ? `<p style="font-size:13px;color:var(--ink-2);margin-top:6px;white-space:pre-line">${esc(lead.bio.slice(0, 220))}${lead.bio.length > 220 ? "…" : ""}</p>` : ""}</div></div></div></div>` : ""}
      <div class="panel"><div class="panel-head"><h2>Vragen?</h2></div><div class="panel-body"><p style="white-space:pre-line">${esc(inst.contact || "")}</p></div></div>
      <div class="panel"><div class="panel-head"><h2>Snel naar</h2></div><div class="panel-body" style="display:flex;flex-wrap:wrap;gap:8px">${[["meetstaat", "Meetstaat"], ["facturatie", "Facturatie"], ["planning", "Planning"], ["documenten", "Documenten"]].map(([k, l]) => `<button class="btn" data-tab="${k}">${l} →</button>`).join("")}</div></div>
    </div></div>`;
}
function avatar(t, size = 40) { return t.foto_url ? `<img class="avatar" style="width:${size}px;height:${size}px" src="${esc(t.foto_url)}" alt="">` : `<span class="avatar" style="width:${size}px;height:${size}px;background:${esc(t.color || "#2A4DD0")};font-size:${Math.round(size / 3)}px">${esc(t.initials || "")}</span>`; }

function vMeetstaat(p) {
  const rows = msRows(); if (!rows.length) return `<h1 style="margin-bottom:16px">Meetstaat</h1><div class="panel"><div class="empty"><b>Nog geen meetstaat</b>Zodra we de meetstaat van je project opmaken, verschijnt ze hier.</div></div>`;
  const contract = rows.filter(r => !isMw(r)).reduce((s, r) => s + Number(r.totaal), 0), mw = rows.filter(isMw).reduce((s, r) => s + signed(r), 0);
  const btwTot = rows.reduce((s, r) => s + signed(r) * (Number(r.btw) || 0), 0);
  const offerteOpen = rows.some(r => r.status === "offerte");
  const lots = [...new Set(rows.map(r => r.lot))];
  const lotBlok = (lot) => { const rs = rows.filter(r => r.lot === lot); const som = rs.reduce((s, r) => s + signed(r), 0); let groep = null;
    return `<div class="panel"><div class="panel-head"><h3>${esc(lotNaam(lot))}</h3><span class="num" style="font-weight:700">${eur(som)}</span></div><div class="tw"><table class="t"><thead><tr><th style="width:60px">Nr</th><th>Omschrijving</th><th class="r">Hoev.</th><th class="r">Prijs</th><th class="r">Totaal</th><th>Status</th></tr></thead><tbody>
      ${rs.map(r => { const isGroep = !Number(r.hoeveelheid) && !Number(r.prijs) && !r.code && (r.groep || r.omschrijving); let g = ""; if (r.groep && r.groep !== groep) { groep = r.groep; g = `<tr class="groep"><td colspan="6">${esc(r.groep)}</td></tr>`; }
        if (isGroep && !r.groep) return `<tr class="groep"><td colspan="6">${esc(r.omschrijving)}</td></tr>`;
        return g + `<tr><td class="num muted" style="font-size:12px">${esc(r.code)}</td><td>${esc(r.omschrijving).replace(/\n/g, "<br>")}${r.locatie ? `<div class="muted" style="font-size:12px">${esc(r.locatie)}</div>` : ""}</td><td class="r num">${Number(r.hoeveelheid) ? nl(r.hoeveelheid, 2) + " " + esc(r.eenheid) : ""}</td><td class="r num">${Number(r.prijs) ? eur(r.prijs) : ""}</td><td class="r num">${Number(r.totaal) ? eur(signed(r)) : ""}</td><td><span class="pill ${r.status}">${MS_STATUS[r.status] || esc(r.status)}</span></td></tr>`; }).join("")}
    </tbody></table></div></div>`; };
  return `<h1 style="margin-bottom:6px">Meetstaat</h1><p class="muted" style="margin-bottom:16px">Alle posten van je project met de afgesproken prijzen (excl. btw). ${offerteOpen ? "Posten met status <b>Offerte</b> wachten nog op je akkoord; " : ""}<b>Meerwerk</b> en <b>minwerk</b> zijn wijzigingen na het contract.</p>
    <div class="kpis"><div class="kpi"><div class="k">Contract excl. btw</div><div class="v num">${eur(contract, 0)}</div></div><div class="kpi"><div class="k">Meer-/minwerk</div><div class="v num">${mw ? eur(mw, 0) : "—"}</div></div><div class="kpi"><div class="k">Btw</div><div class="v num">${eur(btwTot, 0)}</div><div class="muted" style="font-size:12px">${p.btw_tarief ? p.btw_tarief + " % op je project" : ""}</div></div><div class="kpi"><div class="k">Totaal incl. btw</div><div class="v num">${eur(contract + mw + btwTot, 0)}</div></div></div>
    <div class="stack">${lots.map(lotBlok).join("")}</div>`;
}

function vFacturatie(p) {
  const rows = msRows(); const contract = rows.filter(r => !isMw(r)).reduce((s, r) => s + Number(r.totaal), 0), mw = rows.filter(isMw).reduce((s, r) => s + signed(r), 0);
  const vs = D().vorderingen.filter(v => v.project_id === p.id && v.status !== "opgemaakt").sort((a, b) => a.nr - b.nr);
  const calcs = vs.map(v => ({ v, c: vordCalc(v) }));
  const gefact = calcs.reduce((s, x) => s + x.c.excl, 0), betaald = calcs.filter(x => x.v.status === "betaald").reduce((s, x) => s + x.c.incl, 0), open = calcs.filter(x => x.v.status !== "betaald").reduce((s, x) => s + x.c.incl, 0);
  return `<h1 style="margin-bottom:6px">Facturatie</h1><p class="muted" style="margin-bottom:16px">Je facturen en wat er nog volgt. We factureren een voorschot bij ondertekening en daarna per afgewerkt onderdeel; meerwerk factureren we apart.</p>
    <div class="kpis"><div class="kpi"><div class="k">Contract + meerwerk</div><div class="v num">${eur(contract + mw, 0)}</div><div class="muted" style="font-size:12px">excl. btw</div></div><div class="kpi"><div class="k">Gefactureerd</div><div class="v num">${eur(gefact, 0)}</div><div class="muted" style="font-size:12px">${contract + mw ? pct(gefact / (contract + mw)) : "—"} excl. btw</div></div><div class="kpi"><div class="k">Nog te factureren</div><div class="v num">${eur(contract + mw - gefact, 0)}</div><div class="muted" style="font-size:12px">excl. btw</div></div><div class="kpi"><div class="k">Open te betalen</div><div class="v num" style="${open > 0.5 ? "color:var(--warn)" : ""}">${open > 0.5 ? eur(open, 0) : "—"}</div><div class="muted" style="font-size:12px">betaald ${eur(betaald, 0)} incl. btw</div></div></div>
    <div class="panel"><div class="panel-head"><h2>Facturen</h2></div>${vs.length ? `<div class="tw"><table class="t"><thead><tr><th>Nr</th><th>Datum</th><th>Omschrijving</th><th>Onderdelen</th><th class="r">Excl. btw</th><th class="r">Btw</th><th class="r">Incl. btw</th><th>Status</th></tr></thead><tbody>
      ${calcs.map(({ v, c }) => `<tr><td class="num">${v.nr === 0 ? "V" : v.nr}</td><td class="num">${fmt(v.datum)}</td><td><b>${esc(v.omschrijving || VORD_SOORT[v.soort])}</b>${v.factuurnummer ? `<div class="muted" style="font-size:12px">factuur ${esc(v.factuurnummer)}</div>` : ""}</td><td class="muted" style="font-size:12px;max-width:260px">${v.soort === "voorschot" ? "alle onderdelen" : esc(c.loten.map(lotNaam).join(", "))}</td><td class="r num">${eur(c.excl)}</td><td class="r num">${eur(c.btw)}</td><td class="r num"><b>${eur(c.incl)}</b></td><td><span class="pill ${v.status}">${VORD_STATUS[v.status] || esc(v.status)}</span></td></tr>`).join("")}
      <tr class="tot"><td colspan="4">Totaal gefactureerd</td><td class="r num">${eur(gefact)}</td><td class="r num">${eur(calcs.reduce((s, x) => s + x.c.btw, 0))}</td><td class="r num">${eur(calcs.reduce((s, x) => s + x.c.incl, 0))}</td><td></td></tr></tbody></table></div>` : `<div class="empty"><b>Nog geen facturen</b>Zodra we een factuur versturen, vind je ze hier terug.</div>`}</div>`;
}

function vPlanning(p) {
  const fasen = D().fasen; const plan = Object.fromEntries(D().planning.filter(x => x.project_id === p.id).map(x => [x.fase_nr, x])); const nu = p.fase_nr;
  const dates = Object.values(plan).flatMap(x => [x.start, x.eind]).filter(Boolean).sort(); const t0 = dates[0] ? new Date(dates[0]) : null, t1 = dates[dates.length - 1] ? new Date(dates[dates.length - 1]) : null; const span = t0 && t1 ? Math.max(1, t1 - t0) : 1;
  const uren = D().uren.filter(u => u.project_id === p.id).sort((a, b) => (b.datum || "").localeCompare(a.datum || "") || (b.tijd_van || "").localeCompare(a.tijd_van || "")); const totU = uren.reduce((s, u) => s + Number(u.uren), 0);
  return `<h1 style="margin-bottom:6px">Planning</h1><p class="muted" style="margin-bottom:16px">De stappen van je project met hun timing. Data zijn een planning en kunnen nog schuiven.</p>
    <div class="panel" style="margin-bottom:16px"><div class="tw"><table class="t"><thead><tr><th>Stap</th><th>Van</th><th>Tot</th><th style="min-width:180px">Verloop</th><th>Status</th></tr></thead><tbody>
      ${fasen.map(f => { const pl = plan[f.nr]; const st = p.status === "afgerond" || (nu != null && f.nr < nu) ? "done" : f.nr === nu ? "now" : "todo";
        const bar = pl && pl.start && pl.eind && t0 ? `<div class="bar"><i class="${st === "done" ? "done" : ""}" style="left:${Math.round((new Date(pl.start) - t0) / span * 100)}%;width:${Math.max(2, Math.round((new Date(pl.eind) - new Date(pl.start)) / span * 100))}%"></i></div>` : "";
        return `<tr style="${st === "todo" ? "color:var(--muted)" : ""}"><td><b style="${st === "now" ? "" : "font-weight:600"}">${f.nr}. ${esc(f.naam)}</b>${pl && pl.taken ? `<div class="muted" style="font-size:12px">${pl.klaar} van ${pl.taken} taken klaar</div>` : ""}</td><td class="num">${pl ? fmt(pl.start) : "—"}</td><td class="num">${pl ? fmt(pl.eind) : "—"}</td><td>${bar}</td><td>${st === "done" ? `<span class="pill akkoord">Klaar</span>` : st === "now" ? `<span class="pill meerwerk">Nu bezig</span>` : `<span class="pill grijs">Nog te doen</span>`}</td></tr>`; }).join("")}
    </tbody></table></div></div>
    <div class="panel"><div class="panel-head"><h2>Gepresteerde uren</h2><span class="num" style="font-weight:700">${nl(totU)} u</span></div>${uren.length ? `<div class="tw"><table class="t"><thead><tr><th>Datum</th><th>Tijd</th><th>Wat</th><th>Wie</th><th class="r">Uren</th></tr></thead><tbody>
      ${uren.map(u => `<tr><td class="num">${fmt(u.datum)}</td><td class="num">${u.tijd_van ? tijd(u.tijd_van) + (u.tijd_tot ? " – " + tijd(u.tijd_tot) : "") : ""}</td><td>${esc(u.taak)}${u.fase_nr ? `<div class="muted" style="font-size:12px">${esc(faseNaam(u.fase_nr))}</div>` : ""}</td><td>${esc(u.medewerker || "")}</td><td class="r num">${nl(u.uren)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><b>Nog geen uren gedeeld</b>Hier zie je de uren die we voor je project presteren, zodra we ze met je delen.</div>`}</div>`;
}

function vDocumenten(p) {
  const docs = D().documenten.filter(d => d.project_id === p.id).sort((a, b) => (a.pad || "").localeCompare(b.pad || "") || (b.gewijzigd || "").localeCompare(a.gewijzigd || ""));
  const ext = (n) => (n.match(/\.([a-z0-9]{2,5})$/i) || [, "doc"])[1].toUpperCase();
  const size = (b) => !b ? "" : b > 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.round(b / 1e3) + " kB";
  const groups = [...new Set(docs.map(d => d.pad || ""))];
  return `<h1 style="margin-bottom:6px">Documenten</h1><p class="muted" style="margin-bottom:16px">Plannen, presentaties en documenten die we met je delen — altijd de laatste versie.</p>
    ${docs.length ? `<div class="stack">${groups.map(g => `<div class="panel"><div class="panel-head"><h3>${esc(g.replace(/\//g, " › ") || "Algemeen")}</h3></div><div class="panel-body" style="padding-top:4px;padding-bottom:4px">${docs.filter(d => (d.pad || "") === g).map(d => `<a class="doc" href="${esc(d.url)}" target="_blank" rel="noopener"><span class="ic">${esc(ext(d.naam))}</span><span><div class="nm">${esc(d.naam)}</div><small>${d.gewijzigd ? fmt(d.gewijzigd) : ""}${d.grootte ? " · " + size(d.grootte) : ""}</small></span></a>`).join("")}</div></div>`).join("")}</div>` : `<div class="panel"><div class="empty"><b>Nog geen documenten gedeeld</b>Zodra we plannen of documenten voor je klaarzetten, verschijnen ze hier.</div></div>`}`;
}

function vTeam() {
  const team = D().team.slice().sort((a, b) => a.name.localeCompare(b.name));
  return `<h1 style="margin-bottom:6px">Wie is wie</h1><p class="muted" style="margin-bottom:16px">Het team dat aan je project werkt.</p>
    ${team.length ? `<div class="team">${team.map(t => `<div class="card">${t.foto_url ? `<img class="foto" src="${esc(t.foto_url)}" alt="${esc(t.name)}">` : `<div class="nofoto" style="background:${esc(t.color || "#2A4DD0")}">${esc(t.initials)}</div>`}<div class="body"><h3>${esc(t.name)}</h3><div class="fn">${esc(t.functie || "BROS")}</div><div class="bio">${esc(t.bio || "")}</div></div></div>`).join("")}</div>` : `<div class="panel"><div class="empty">Binnenkort stellen we het team hier aan je voor.</div></div>`}`;
}

/* ---------- login / wachtwoord ---------- */
function renderLogin() {
  $("#app").innerHTML = `<div class="login"><div class="card">
    <div class="brand" style="margin-bottom:14px"><span class="mark">BROS</span><span class="name">Klantenportaal</span></div>
    <h1>Inloggen</h1><p>Volg je project: meetstaat, facturen, planning en documenten.</p>
    <form id="loginForm"><div class="field"><label for="email">E-mailadres</label><input id="email" type="email" required autocomplete="username" placeholder="naam@voorbeeld.be"></div>
    <div class="field"><label for="password">Wachtwoord</label><input id="password" type="password" required autocomplete="current-password"></div>
    <button class="btn primary" type="submit" id="loginBtn" style="width:100%;justify-content:center">Inloggen</button></form>
    <div class="msg${loginNotice ? " err" : ""}" id="loginMsg">${esc(loginNotice)}</div>
    <p style="margin:14px 0 0;font-size:13px"><button class="btn ghost sm" type="button" id="loginForgot">Wachtwoord vergeten of nog geen wachtwoord?</button></p></div></div>`;
  $("#loginForgot").onclick = async () => {
    loginNotice = ""; const email = $("#email").value.trim(); const m = $("#loginMsg"); m.className = "msg"; m.textContent = "";
    if (!email) { m.className = "msg err"; m.textContent = "Vul eerst je e-mailadres in."; $("#email").focus(); return; }
    $("#loginForgot").disabled = true;
    let error = null;
    if (cfg.driveScriptUrl) { try { const r = await fetch(cfg.driveScriptUrl, { method: "POST", body: JSON.stringify({ action: "reset", email }), redirect: "follow" }); const j = await r.json(); if (!j.ok) error = { message: j.error || "onbekende fout" }; } catch (e) { error = e; } }
    else ({ error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }));
    if (error) { m.className = "msg err"; m.textContent = "Dat lukte niet: " + error.message; $("#loginForgot").disabled = false; }
    else m.textContent = "Als dit adres bij ons bekend is, krijg je zo een mail (kijk ook bij ongewenste mail). Klik op de link en kies een wachtwoord.";
  };
  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault(); loginNotice = ""; const btn = $("#loginBtn"); btn.disabled = true; const m = $("#loginMsg"); m.className = "msg"; m.textContent = "";
    const { error } = await sb.auth.signInWithPassword({ email: $("#email").value.trim(), password: $("#password").value });
    if (error) { m.className = "msg err"; m.textContent = /invalid/i.test(error.message) ? "E-mailadres of wachtwoord klopt niet." : "Dat lukte niet: " + error.message; btn.disabled = false; }
  };
}
function renderSetPassword() {
  const email = S.session?.user?.email || "";
  $("#app").innerHTML = `<div class="login"><div class="card">
    <div class="brand" style="margin-bottom:14px"><span class="mark">BROS</span><span class="name">Klantenportaal</span></div>
    <h1>Kies een wachtwoord</h1><p>Welkom${email ? ", " + esc(email) : ""}. Kies een wachtwoord waarmee je voortaan inlogt.</p>
    <form id="pwForm"><div class="field"><label for="pw1">Nieuw wachtwoord</label><input id="pw1" type="password" required minlength="8" autocomplete="new-password" placeholder="minstens 8 tekens"></div>
      <div class="field"><label for="pw2">Nog eens, ter controle</label><input id="pw2" type="password" required minlength="8" autocomplete="new-password"></div>
      <button class="btn primary" type="submit" id="pwBtn" style="width:100%;justify-content:center">Opslaan en binnengaan</button></form>
    <div class="msg" id="pwMsg"></div></div></div>`;
  $("#pw1").focus();
  $("#pwForm").onsubmit = async (e) => {
    e.preventDefault(); const m = $("#pwMsg"); m.className = "msg"; m.textContent = ""; const a = $("#pw1").value, b = $("#pw2").value;
    if (a.length < 8) { m.className = "msg err"; m.textContent = "Kies minstens 8 tekens."; return; }
    if (a !== b) { m.className = "msg err"; m.textContent = "De twee wachtwoorden zijn niet gelijk."; return; }
    $("#pwBtn").disabled = true;
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) { m.className = "msg err"; m.textContent = "Dat lukte niet: " + error.message; $("#pwBtn").disabled = false; return; }
    history.replaceState(null, "", location.pathname); S.setPassword = false; S.passwordForced = false; start();
  };
}

/* ---------- vuurwerk bij het eerste bezoek ---------- */
function vuurwerk(naam) {
  const fx = $("#fx"), cv = fx.querySelector("canvas"), ctx = cv.getContext("2d"); $("#fxTxt").innerHTML = `Welkom${naam ? ", " + esc(naam) : ""}!<small>Fijn dat je er bent. Dit is jouw plek om je project te volgen.</small>`;
  fx.classList.add("show"); cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio; ctx.scale(devicePixelRatio, devicePixelRatio);
  const parts = []; const kleuren = ["#2A4DD0", "#E2A84C", "#2E7D4F", "#D0413A", "#8A4BC7", "#0F7C8C"];
  const knal = (x, y) => { const k = kleuren[Math.floor(Math.random() * kleuren.length)]; for (let i = 0; i < 70; i++) { const a = Math.random() * Math.PI * 2, v = 2 + Math.random() * 5; parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 60 + Math.random() * 40, k }); } };
  let t = 0; const timer = setInterval(() => { knal(innerWidth * (0.15 + Math.random() * 0.7), innerHeight * (0.15 + Math.random() * 0.5)); if (++t > 7) clearInterval(timer); }, 450);
  const loop = () => { ctx.clearRect(0, 0, innerWidth, innerHeight); for (const p of parts) { p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.vx *= 0.985; p.vy *= 0.985; p.life--; ctx.globalAlpha = Math.max(0, p.life / 80); ctx.fillStyle = p.k; ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2); ctx.fill(); }
    for (let i = parts.length - 1; i >= 0; i--) if (parts[i].life <= 0) parts.splice(i, 1); if (fx.classList.contains("show")) requestAnimationFrame(loop); };
  loop(); setTimeout(() => { fx.classList.remove("show"); ctx.clearRect(0, 0, innerWidth, innerHeight); }, 5400);
  fx.onclick = () => { fx.classList.remove("show"); clearInterval(timer); };
}

/* ---------- gebeurtenissen ---------- */
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-tab],[data-act]"); if (!el) return;
  if (el.dataset.tab) { S.tab = el.dataset.tab; render(); }
  if (el.dataset.act === "logout") sb.auth.signOut().then(() => location.reload());
});
document.addEventListener("change", (e) => { if (e.target.id === "projSel") { S.project = e.target.value; render(); } });

async function start() {
  S.ready = false; render();
  try { await loadAll(); S.ready = true; S.loadError = null; render(); if (S.eersteBezoek && S.me?.role === "klant" && D().projecten.length) vuurwerk(voornaam()); }
  catch (e) { S.loadError = e.message || String(e); render(); }
}
async function boot() {
  render();
  const { data: { session } } = await sb.auth.getSession(); S.session = session;
  if (session && (URL_AUTH.type === "invite" || URL_AUTH.type === "recovery" || URL_AUTH.type === "magiclink")) { S.setPassword = true; S.passwordForced = true; }
  render();
  sb.auth.onAuthStateChange((evt, sess) => {
    const had = !!S.session; S.session = sess;
    if (evt === "PASSWORD_RECOVERY" && sess) { S.setPassword = true; S.passwordForced = true; render(); return; }
    if (sess && !had && !S.setPassword) start();
    if (!sess) { S.ready = false; S.setPassword = false; render(); }
  });
  if (session && !S.setPassword) start();
}
boot();
