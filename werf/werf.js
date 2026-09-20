/* =====================================================================
   BROS Werf — werfmodus voor op de smartphone (vaststellingen met foto's, ook zonder bereik)
   Zelfde database als het Planbord (Supabase). Werkt offline: foto's en punten wachten in een
   lokale wachtrij (IndexedDB) en worden verzonden zodra er weer verbinding is.
   ===================================================================== */
const WERF_VERSION = "1.24.0";
const cfg = window.PLANBORD_CONFIG || {};
if (!window.supabase) { document.getElementById("app").innerHTML = '<main><div class="empty"><b>De werfmodus is nog niet volledig geladen.</b><br>Open ze één keer met bereik; daarna werkt ze ook offline.<br><br><button class="btn" onclick="location.reload()">Opnieuw proberen</button></div></main>'; throw new Error("supabase-js niet geladen"); }
const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const _n = new Date(); const todayIso = `${_n.getFullYear()}-${String(_n.getMonth() + 1).padStart(2, "0")}-${String(_n.getDate()).padStart(2, "0")}`;
const fmt = (s) => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : "";
const fmtLong = (s) => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "";
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });
const VS_STATUS = { open: "Open", opgelost: "Opgelost", gecontroleerd: "Gecontroleerd", vervallen: "Vervallen" };
const VS_PRIO = { laag: "Laag", normaal: "Normaal", hoog: "Hoog" };
const WEER = ["", "Zonnig", "Bewolkt", "Regen", "Wind", "Vriezend", "Sneeuw"];
const ROL = { aannemer: "Aannemer", leverancier: "Leverancier", architect: "Architect", studiebureau: "Studiebureau", andere: "Andere", bouwheer: "Bouwheer", contactpersoon: "Contactpersoon" };
let toastT; const toast = (m, ms = 2600) => { const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), ms); };
const store = { get: (k, d) => { try { const v = localStorage.getItem("werf." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem("werf." + k, JSON.stringify(v)); } catch (e) { } }, del: (k) => { try { localStorage.removeItem("werf." + k); } catch (e) { } } };

/* ---------- state ---------- */
const S = {
  session: null, me: store.get("me", null), online: navigator.onLine, syncing: false, queue: [],
  project: store.get("p", null), bezoek: store.get("bezoek", null),
  base: store.get("base", { projecten: [], profiles: [], loten: [] }), data: { vaststellingen: [], werfbezoeken: [], contacten: [] },
  view: "list", filter: "open", perLot: store.get("perlot", false), detail: null, form: null, loginErr: "", ready: false,
};
const proj = () => S.base.projecten.find(p => p.id === S.project);
const projName = (p) => p ? (p.klant + (p.naam && p.naam !== p.klant ? " · " + p.naam : "")) : "—";
const contact = (id) => S.data.contacten.find(c => c.c && c.c.id === id)?.c;
const profile = (id) => S.base.profiles.find(u => u.id === id);
const lotName = (nr) => { const l = S.base.loten.find(x => x.nr === nr); return l ? `${nr}. ${l.naam}` : (nr ? String(nr) : ""); };
const isAan = () => !!(S.me && S.me.role === "aannemer");   // aannemer (script 025): enkel eigen punten, enkel opgelost melden
const wie = (v) => v.contact_id ? (contact(v.contact_id)?.naam || (isAan() ? "jij" : "aannemer")) : v.assignee ? (profile(v.assignee)?.name || "team") : "";
const isLate = (v) => v.status === "open" && v.deadline && v.deadline < todayIso;
const vsNr = (v) => v.nr ? "V-" + String(v.nr).padStart(3, "0") : "nieuw";
const pill = (v) => isLate(v) ? `<span class="pill late">Te laat</span>` : `<span class="pill ${v.status}">${VS_STATUS[v.status] || v.status}</span>`;

/* ---------- wachtrij (IndexedDB): items met foto's als blobs ---------- */
const idb = {
  db: null,
  open() { return new Promise((res, rej) => { if (this.db) return res(this.db); const r = indexedDB.open("bros-werf", 1); r.onupgradeneeded = () => { r.result.createObjectStore("queue", { keyPath: "id", autoIncrement: true }); }; r.onsuccess = () => { this.db = r.result; this.db.onclose = this.db.onversionchange = () => { this.db = null; }; res(this.db); }; r.onerror = () => rej(r.error); }); },
  async all() { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction("queue").objectStore("queue").getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); }); },
  async put(item) { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction("queue", "readwrite").objectStore("queue").put(item); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  async del(id) { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction("queue", "readwrite").objectStore("queue").delete(id); q.onsuccess = () => res(); q.onerror = () => rej(q.error); }); },
};
async function loadQueue() { try { S.queue = await idb.all(); } catch (e) { S.queue = []; } }
async function enqueue(item) {
  item.t = Date.now(); item.pid = item.pid || S.project;
  try { item.id = await idb.put(item); } catch (e) { toast("Niet bewaard op dit toestel: " + (e.message || e) + ". Probeer opnieuw met bereik.", 6000); throw e; }
  S.queue.push(item); paint(); if (S.online) sync();
}
/* objectURL per wachtrijfoto één keer aanmaken (geen geheugenlek bij elke render) */
const fotoUrl = (f) => { if (!f._url) f._url = blobUrl(f.blob); return f._url; };
const revokeItem = (q) => { (q.fotos || []).forEach(f => { if (f._url) { try { URL.revokeObjectURL(f._url); } catch (e) { } f._url = null; } }); };
/* alleen de statusbadge verversen zolang een formulier openstaat (anders verliest de gebruiker zijn invoer) */
function paint() { if (S.view === "new" || S.view === "edit" || S.view === "bezoek") { const b = $(".sync"); if (b) b.outerHTML = syncBadge(); } else render(); }

/* ---------- foto's ---------- */
async function verklein(file, max = 1600, q = 0.82) {
  let img = null;
  if (window.createImageBitmap) img = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  let tmp = null;
  if (!img) img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Foto niet leesbaar")); tmp = URL.createObjectURL(file); i.src = tmp; });
  const s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  if (tmp) URL.revokeObjectURL(tmp); if (img.close) img.close();
  return new Promise(r => c.toBlob(b => r({ blob: b, w: c.width, h: c.height }), "image/jpeg", q));
}
async function upload(pid, vid, f) {
  const path = `${pid}/${vid}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
  const { error } = await sb.storage.from("werf").upload(path, f.blob, { contentType: "image/jpeg" });
  if (error) throw error;
  return { path, url: sb.storage.from("werf").getPublicUrl(path).data.publicUrl, w: f.w, h: f.h, op: new Date().toISOString() };
}
const blobUrl = (b) => { try { return URL.createObjectURL(b); } catch (e) { return ""; } };

/* ---------- data ---------- */
async function loadBase() {
  const [p, u, l] = await Promise.all([
    sb.from("projecten").select("id,nummer,klant,naam,status,adres,gemeente").in("status", ["lopend", "on_hold", "offerte"]).order("nummer", { ascending: false }),
    sb.from("profiles").select("id,name,role,active,initials,color"),
    sb.from("loten_v").select("nr,naam").then(r => r.error ? sb.from("loten").select("nr,naam") : r),
  ]);
  const me = (u.data || []).find(x => x.id === S.session?.user?.id); if (me) { S.me = me; store.set("me", me); }
  let projecten = p.data || [];
  if (me && me.role === "aannemer") { const a = await sb.from("aan_project").select("id,nummer,klant,naam,status,adres,gemeente"); if (a.error) throw a.error; projecten = a.data || []; }
  else if (p.error) throw p.error;
  S.base = { projecten, profiles: (u.data || []).filter(x => x.active !== false && x.role !== "klant" && x.role !== "aannemer"), loten: l.data || [] };
  store.set("base", S.base);
}
async function loadProject(pid) {
  if (!pid) return;
  if (isAan()) {
    const [vs, wp] = await Promise.all([sb.from("aan_vaststellingen").select("*").eq("project_id", pid).order("nr", { ascending: false }), sb.from("aan_werfplannen").select("*").eq("project_id", pid).order("volgorde")]);
    if (vs.error) throw vs.error;
    const lots = [...new Set((vs.data || []).map(v => v.lot).filter(Boolean))].sort((a, b) => a - b);
    S.data = { vaststellingen: vs.data || [], werfbezoeken: [], contacten: [], lots, plannen: wp.data || [] };
    (wp.data || []).forEach(pl => { try { fetch(pl.url).catch(() => { }); } catch (e) { } });
    store.set("cache." + pid, S.data); return;
  }
  const [vs, wb, pc, lp, wp] = await Promise.all([
    sb.from("vaststellingen").select("*").eq("project_id", pid).order("nr", { ascending: false }),
    sb.from("werfbezoeken").select("*").eq("project_id", pid).order("datum", { ascending: false }),
    sb.from("project_contacten").select("id,rol,contact_id").eq("project_id", pid),
    sb.from("meetstaat_posten_v").select("lot").eq("project_id", pid).then(r => r.error ? sb.from("meetstaat_posten").select("lot").eq("project_id", pid) : r),
    sb.from("werfplannen").select("*").eq("project_id", pid).order("volgorde").then(r => r.error ? { data: [] } : r),
  ]);
  if (vs.error) throw vs.error;
  let contacten = [];
  if ((pc.data || []).length) { const ids = pc.data.map(x => x.contact_id); const { data } = await sb.from("contacten").select("id,naam,soort,vakgebied,email,gsm").in("id", ids); contacten = pc.data.map(x => ({ rol: x.rol, c: (data || []).find(c => c.id === x.contact_id) })).filter(x => x.c); }
  const lots = [...new Set((lp.data || []).map(x => x.lot).filter(Boolean))].sort((a, b) => a - b);
  S.data = { vaststellingen: vs.data || [], werfbezoeken: wb.data || [], contacten, lots, plannen: wp.data || [] };
  // plannen alvast in de cache van de browser zetten (service worker) zodat ze offline beschikbaar zijn
  (wp.data || []).forEach(pl => { try { fetch(pl.url).catch(() => { }); } catch (e) { } });
  store.set("cache." + pid, S.data);
  if (S.bezoek && !S.data.werfbezoeken.find(b => b.id === S.bezoek) && !S.queue.find(q => q.kind === "wb-new" && q.row.id === S.bezoek)) { S.bezoek = null; store.del("bezoek"); }
}
function useCache(pid) { S.data = store.get("cache." + pid, { vaststellingen: [], werfbezoeken: [], contacten: [], lots: [], plannen: [] }); }
const plan = (id) => (S.data.plannen || []).find(x => x.id === id);
const pinHtml = (v, cls = "") => v.plan_x == null ? "" : `<span class="pin ${cls || v.status}" style="left:${Number(v.plan_x) * 100}%;top:${Number(v.plan_y) * 100}%">${v.nr || "•"}</span>`;
async function refresh() {
  if (!S.online) return;
  try { await loadBase(); await loadProject(S.project); } catch (e) { console.warn(e); toast("Gegevens niet vernieuwd: " + (e.message || e)); }
  paint();
}
/* lijst = gegevens van de server + wat nog in de wachtrij staat (lokaal al zichtbaar) */
function allVs() {
  const rows = S.data.vaststellingen.map(v => ({ ...v }));
  S.queue.forEach(q => {
    if (q.kind === "vs-new" && q.row.project_id === S.project && !rows.find(r => r.id === q.row.id)) rows.unshift({ ...q.row, _pending: true, _err: q.err, fotos: [...(q.done || []), ...q.fotos.map(f => ({ url: fotoUrl(f), _local: true }))] });
    if (q.kind === "vs-update") { const r = rows.find(r => r.id === q.vid); if (r) { Object.assign(r, q.patch, { _pending: true, _err: q.err }); const extra = [...(q.done || []), ...(q.fotos || []).map(f => ({ url: fotoUrl(f), _local: true }))]; if (extra.length) r[q.veld] = [...(r[q.veld] || []), ...extra]; } }
  });
  return rows;
}
function allWb() { const rows = [...S.data.werfbezoeken]; S.queue.forEach(q => { if (q.kind === "wb-new" && q.row.project_id === S.project && !rows.find(r => r.id === q.row.id)) rows.unshift({ ...q.row, _pending: true }); }); return rows; }

/* ---------- synchroniseren ---------- */
const isNetErr = (e) => !e || e.name === "TypeError" || /fetch|network|failed to|load failed|timeout/i.test(String(e.message || e));
async function fotosToevoegen(vid, veld, fotos) {
  // server voegt toe zonder de bestaande lijst te overschrijven (script 022); oudere database: lezen + samenvoegen
  const r = await sb.rpc("vaststelling_fotos_toevoegen", { p_id: vid, p_veld: veld, p_fotos: fotos });
  if (!r.error) return;
  if (!/function|schema cache|not find/i.test(r.error.message || "")) throw r.error;
  const { data } = await sb.from("vaststellingen").select(veld).eq("id", vid).single();
  const cur = (data && data[veld]) || []; const merged = [...cur, ...fotos.filter(f => !cur.some(c => c.path === f.path))];
  const { error } = await sb.from("vaststellingen").update({ [veld]: merged }).eq("id", vid); if (error) throw error;
}
async function sync() {
  if (S.syncing || !S.online || !S.queue.length) return;
  S.syncing = true; paint();
  let netfout = null, fouten = 0;
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { S.session = null; toast("Je bent afgemeld — meld je opnieuw aan om de wachtrij te verzenden.", 5000); return; }
    for (const q of [...S.queue].sort((a, b) => a.id - b.id)) {
      if ((q.tries || 0) >= 5) { fouten++; continue; }   // blijft staan, maar blokkeert de rest niet
      try {
        if (q.kind === "wb-new") { const { error } = await sb.from("werfbezoeken").upsert(q.row, { onConflict: "id" }); if (error) throw error; }
        else if (q.kind === "vs-new") {
          const { error } = await sb.from("vaststellingen").upsert({ ...q.row, fotos: q.done || [] }, { onConflict: "id" }); if (error) throw error;
          while (q.fotos.length) { const f = await upload(q.row.project_id, q.row.id, q.fotos[0]); q.done = [...(q.done || []), f]; q.fotos.shift(); await idb.put(q); }
          if ((q.done || []).length) await fotosToevoegen(q.row.id, "fotos", q.done);
        } else if (q.kind === "vs-update") {
          while (q.fotos.length) { const f = await upload(q.pid || S.project, q.vid, q.fotos[0]); q.done = [...(q.done || []), f]; q.fotos.shift(); await idb.put(q); }
          if (isAan()) {   // aannemer: alles via één functie (opgelost melden, opmerking, bewijsfoto's)
            const { error } = await sb.rpc("aannemer_vaststelling_melden", { p_id: q.vid, p_status: (q.patch || {}).status === "opgelost" ? "opgelost" : null, p_opmerking: (q.patch || {}).opmerking || null, p_fotos: q.done || [] }); if (error) throw error;
          } else {
            if (Object.keys(q.patch || {}).length) { const { error } = await sb.from("vaststellingen").update(q.patch).eq("id", q.vid); if (error) throw error; }
            if ((q.done || []).length) await fotosToevoegen(q.vid, q.veld, q.done);
          }
        }
        await idb.del(q.id); revokeItem(q); S.queue = S.queue.filter(x => x.id !== q.id);
      } catch (e) {
        console.warn("sync", e);
        if (isNetErr(e)) { netfout = e; break; }          // geen verbinding: stoppen, later opnieuw
        q.tries = (q.tries || 0) + 1; q.err = String(e.message || e); await idb.put(q).catch(() => { }); fouten++;   // inhoudelijke fout: overslaan, de rest gaat door
      }
    }
  } finally { S.syncing = false; }
  if (netfout) toast("Verzenden onderbroken (" + (netfout.message || netfout) + ") — probeert later opnieuw", 4000);
  else if (fouten) toast(fouten + " item" + (fouten === 1 ? "" : "s") + " kon niet verzonden worden — tik op de status rechtsboven voor details", 5000);
  else if (S.online) { try { await loadProject(S.project); } catch (e) { } }
  paint();
  if (!netfout && S.online && S.queue.some(q => (q.tries || 0) < 5)) setTimeout(sync, 500);   // intussen bijgekomen items
}
window.addEventListener("online", () => { S.online = true; paint(); sync(); refresh(); });
window.addEventListener("offline", () => { S.online = false; paint(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.online) { sync(); refresh(); } });

/* ---------- weergave ---------- */
const syncBadge = () => { const n = S.queue.length; const nf = S.queue.filter(q => (q.tries || 0) >= 5).length; const cls = S.syncing ? "busy" : !S.online ? "off" : nf ? "off" : n ? "wait" : ""; const txt = S.syncing ? "verzenden…" : !S.online ? (n ? `offline · ${n} wacht` : "offline") : nf ? `⚠ ${nf} mislukt` : n ? `${n} te verzenden` : "gesynchroniseerd"; return `<button class="sync ${cls}" data-act="sync" title="Verbinding en wachtrij"><i></i>${txt}</button>`; };
function render() {
  const app = $("#app");
  if (!S.session && !(S.me && !S.online)) { app.innerHTML = vLogin(); return; }
  if (!S.project || S.view === "projects") { app.innerHTML = topBar("Kies een project") + `<main>${vProjects()}</main>`; return; }
  const p = proj();
  let body = "";
  if (S.view === "new" || S.view === "edit") body = vForm();
  else if (S.view === "detail") body = vDetail();
  else if (S.view === "bezoek") body = vBezoek();
  else body = vList();
  app.innerHTML = topBar(projName(p), p ? `${p.nummer || ""}${p.gemeente ? " · " + p.gemeente : ""}` : "") + `<main>${body}</main>` + (S.view === "list" && !isAan() ? `<button class="fab" data-act="new">📷 Vaststelling</button>` : "");
  if (S.view === "new" || S.view === "edit") bindForm();
}
const topBar = (title, sub) => `<div class="top"><span class="mark"></span><button class="proj" data-act="projects"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)} · wijzigen</small>` : `<small>Werfmodus v${WERF_VERSION}${isAan() ? " · aannemer" : ""}</small>`}</button>${syncBadge()}</div>`;
function vLogin() {
  return `<main><div class="login"><span class="mark"></span><h1 style="text-align:center">Werfmodus</h1><p class="meta" style="text-align:center">Meld je aan met je Planbord-account of je login voor het aannemersportaal.</p>
    <form id="login"><div class="field"><label>E-mail</label><input name="email" type="email" autocomplete="username" required inputmode="email"></div>
    <div class="field"><label>Wachtwoord</label><input name="password" type="password" autocomplete="current-password" required></div>
    ${S.loginErr ? `<div class="err">${esc(S.loginErr)}</div>` : ""}<button class="btn primary" type="submit">Aanmelden</button></form>
    ${!S.online ? `<p class="meta" style="text-align:center;margin-top:16px">Je bent offline. Meld je aan zodra je bereik hebt; daarna werkt de werfmodus ook zonder.</p>` : ""}</div></main>`;
}
function vProjects() {
  const ps = S.base.projecten; const q = (S.projQ || "").toLowerCase();
  const list = ps.filter(p => !q || [p.klant, p.naam, p.nummer, p.gemeente].some(x => (x || "").toLowerCase().includes(q)));
  return `<div class="field"><input data-projq placeholder="Zoeken op klant, naam, nummer…" value="${esc(S.projQ || "")}"></div><div class="list-proj">${list.map(p => { const n = store.get("cache." + p.id, null); const open = n ? n.vaststellingen.filter(v => v.status === "open").length : null; return `<button class="card" data-act="pick" data-id="${p.id}"><div class="bd"><b>${esc(projName(p))}</b><div class="mt">${esc(p.nummer || "")}${p.gemeente ? " · " + esc(p.gemeente) : ""} · ${esc(p.status)}</div></div>${open != null ? `<span class="cnt">${open} open</span>` : ""}</button>`; }).join("") || `<div class="empty">${ps.length ? "Niets gevonden." : S.online ? "Geen lopende projecten gevonden." : "Nog geen projecten geladen — even bereik nodig."}</div>`}</div>
    ${S.session ? `<button class="btn ghost" data-act="logout" style="margin-top:20px">Afmelden</button>` : ""}`;
}
function vList() {
  const all = allVs(); const f = S.filter;
  const list = all.filter(v => f === "open" ? v.status === "open" : f === "opgelost" ? v.status === "opgelost" : true);
  const b = S.bezoek ? allWb().find(x => x.id === S.bezoek) : null;
  const n = (k) => all.filter(v => k === "alle" ? true : v.status === k).length;
  const perLot = S.perLot && list.some(v => v.lot);
  const card = (v) => `<button class="card ${v.status === "gecontroleerd" || v.status === "vervallen" ? "dim" : ""}" data-act="open" data-id="${v.id}">${(v.fotos || [])[0] ? `<img class="th" src="${esc(v.fotos[0].url)}" alt="">` : `<div class="th">geen foto</div>`}<div class="bd"><div class="hd"><span class="nr">${vsNr(v)}</span>${v.prioriteit === "hoog" ? `<span class="pill late">!</span>` : ""}${pill(v)}${v._pending ? `<span class="pill pend">wacht</span>` : ""}</div><div class="tx">${v.titel ? `<b>${esc(v.titel)}</b>${v.omschrijving ? ` <span style="color:var(--muted)">${esc(v.omschrijving)}</span>` : ""}` : esc(v.omschrijving || "—")}</div><div class="mt">${[v.ruimte, !perLot && v.lot ? lotName(v.lot) : "", wie(v), v.deadline ? (isLate(v) ? `<span class="late">tegen ${fmt(v.deadline)}</span>` : "tegen " + fmt(v.deadline)) : ""].filter(Boolean).join(" · ")}</div></div></button>`;
  let body;
  if (perLot) { const g = {}; list.forEach(v => (g[v.lot || 0] = g[v.lot || 0] || []).push(v)); body = Object.keys(g).map(Number).sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a - b).map(nr => `<h2 style="margin:14px 0 8px;font-size:15px">${nr ? esc(lotName(nr)) : "Zonder lot"} <span class="cnt">${g[nr].length}</span></h2>` + g[nr].map(card).join("")).join(""); }
  else body = list.map(card).join("");
  return `${isAan() ? "" : b ? `<div class="bezoek"><div><b>Werfbezoek ${b.nr || "(nieuw)"} · ${b.datum === todayIso ? "vandaag" : fmtLong(b.datum)}</b><small>${esc(b.aanwezigen || "nieuwe vaststellingen hangen aan dit bezoek")}</small></div><button class="btn" style="width:auto;padding:8px 12px;font-size:13px" data-act="bezoek-stop">Afsluiten</button></div>` : `<div class="bezoek"><div><b>Geen werfbezoek gestart</b><small>Start er een om vaststellingen te groeperen per bezoek</small></div><button class="btn" style="width:auto;padding:8px 12px;font-size:13px" data-act="bezoek">Bezoek starten</button></div>`}
    <div class="chips">${[["open", `Open ${n("open")}`], ["opgelost", `Opgelost ${n("opgelost")}`], ["alle", `Alles ${n("alle")}`]].map(([k, l]) => `<button class="chip" data-act="filter" data-f="${k}" aria-current="${f === k}">${l}</button>`).join("")}${all.some(v => v.lot) ? `<button class="chip" data-act="perlot" aria-current="${!!S.perLot}">Per lot</button>` : ""}</div>
    ${body || `<div class="empty">${all.length ? "Niets in deze lijst." : isAan() ? "Nog geen punten aan jou toegewezen." : "Nog geen vaststellingen. Tik op 📷 Vaststelling."}</div>`}`;
}
function vDetail() {
  const v = allVs().find(x => x.id === S.detail); if (!v) { S.view = "list"; return vList(); }
  const fotos = v.fotos || [], bewijs = v.opgelost_fotos || [];
  return `<button class="back" data-act="back">‹ Terug</button>
    ${fotos.length ? `<div class="gallery">${fotos.map(f => `<img src="${esc(f.url)}" alt="" data-lb="${esc(f.url)}">`).join("")}</div>` : ""}
    <div class="hd" style="display:flex;gap:8px;align-items:center;margin-bottom:6px"><span class="nr" style="font-size:18px">${vsNr(v)}</span>${v.prioriteit === "hoog" ? `<span class="pill late">Hoge prioriteit</span>` : ""}${pill(v)}${v._pending ? `<span class="pill pend">nog te verzenden</span>` : ""}</div>
    ${v.titel ? `<h1 style="margin:0 0 6px">${esc(v.titel)}</h1>` : ""}<p style="font-size:17px;margin:0 0 10px;white-space:pre-wrap">${esc(v.omschrijving || (v.titel ? "" : "—"))}</p>
    <div class="meta">${v.ruimte ? `<div>Ruimte: <b>${esc(v.ruimte)}</b></div>` : ""}${v.lot ? `<div>Lot: <b>${esc(lotName(v.lot))}</b></div>` : ""}<div>Verantwoordelijke: <b>${esc(wie(v) || "nog niet toegewezen")}</b></div>${v.deadline ? `<div>Op te lossen tegen: <b class="${isLate(v) ? "late" : ""}">${fmtLong(v.deadline)}</b></div>` : ""}${v.opgelost_op ? `<div>Opgelost op <b>${fmtLong(v.opgelost_op.slice(0, 10))}</b>${v.opgelost_door ? " door " + esc(profile(v.opgelost_door)?.name || "") : ""}</div>` : ""}${v.opmerking ? `<div>Opmerking: <b>${esc(v.opmerking)}</b></div>` : ""}</div>
    ${v.plan_id && plan(v.plan_id) && v.plan_x != null ? `<h2>Op het plan · ${esc(plan(v.plan_id).naam)}</h2><div class="plan-wrap"><img src="${esc(plan(v.plan_id).url)}" alt="">${pinHtml(v)}</div>` : ""}
    ${bewijs.length ? `<h2>Bewijsfoto's</h2><div class="fotos">${bewijs.map(f => `<img src="${esc(f.url)}" alt="" data-lb="${esc(f.url)}">`).join("")}</div>` : ""}
    <div style="margin-top:18px;display:grid;gap:10px">
      ${v.status === "open" ? `<label class="btn ok" style="text-align:center">✓ Opgelost — met bewijsfoto<input type="file" accept="image/*" capture="environment" hidden data-oplos="${v.id}"></label><button class="btn" data-act="oplos" data-id="${v.id}">✓ Opgelost zonder foto</button>` : ""}
      ${isAan() ? (v.status === "opgelost" ? `<p class="meta" style="text-align:center">Gemeld als opgelost — BROS controleert dit bij het volgende werfbezoek.</p>` : "") : `${v.status === "opgelost" ? `<button class="btn ok" data-act="status" data-id="${v.id}" data-s="gecontroleerd">✓ Gecontroleerd en in orde</button><button class="btn" data-act="status" data-id="${v.id}" data-s="open">Heropenen — nog niet in orde</button>` : ""}
      ${v.status === "gecontroleerd" || v.status === "vervallen" ? `<button class="btn" data-act="status" data-id="${v.id}" data-s="open">Heropenen</button>` : ""}`}
      <label class="btn" style="text-align:center">📷 ${isAan() ? "Bewijsfoto toevoegen" : "Foto toevoegen"}<input type="file" accept="image/*" capture="environment" hidden data-addfoto="${v.id}"></label>
      ${isAan() ? `<button class="btn" data-act="opm" data-id="${v.id}">Opmerking toevoegen</button>` : `<button class="btn" data-act="edit" data-id="${v.id}">Bewerken</button>
      ${v.status !== "vervallen" ? `<button class="btn ghost danger" data-act="status" data-id="${v.id}" data-s="vervallen">Vervallen (niet meer van toepassing)</button>` : ""}`}
    </div>`;
}
function vForm() {
  const v = S.form; const pcs = S.data.contacten; const lots = S.data.lots || [];
  const ruimtes = [...new Set(allVs().map(x => x.ruimte).filter(Boolean))].sort();
  const cur = v.contact_id ? "c:" + v.contact_id : (v.assignee || "");
  const opt = (val, label) => `<option value="${esc(val)}" ${String(val) === String(cur) ? "selected" : ""}>${esc(label)}</option>`;
  return `<button class="back" data-act="back">‹ Annuleren</button><h1>${v.id ? "Vaststelling " + vsNr(v) : "Nieuwe vaststelling"}</h1>
    <div class="big"><label>📷<span></span>Foto nemen<input type="file" accept="image/*" capture="environment" hidden data-file></label><label>🖼️<span></span>Uit galerij<input type="file" accept="image/*" multiple hidden data-file></label></div>
    <div class="fotos" id="f_fotos"></div>
    <div class="field" style="margin-top:12px"><label>Titel</label><input id="f_titel" value="${esc(v.titel || "")}" placeholder="Kort, bv. Scharnier kastdeur"></div>
    <div class="field"><label>Omschrijving</label><textarea id="f_oms" placeholder="Wat is er vastgesteld, wat moet er gebeuren?">${esc(v.omschrijving || "")}</textarea></div>
    <div class="field"><label>Ruimte / locatie</label><input id="f_ruimte" list="ruimtes" value="${esc(v.ruimte || "")}" placeholder="bv. Keuken"><datalist id="ruimtes">${ruimtes.map(r => `<option value="${esc(r)}">`).join("")}</datalist></div>
    ${(S.data.plannen || []).length ? `<div class="field"><label>Locatie op plan</label><select id="f_plan"><option value="">— geen plan —</option>${S.data.plannen.map(pl => `<option value="${pl.id}" ${v.plan_id === pl.id ? "selected" : ""}>${esc(pl.naam)}</option>`).join("")}</select><div id="f_planbox" style="margin-top:8px"></div></div>` : ""}
    ${lots.length ? `<div class="field"><label>Lot</label><select id="f_lot"><option value="">—</option>${lots.map(l => `<option value="${l}" ${v.lot === l ? "selected" : ""}>${esc(lotName(l))}</option>`).join("")}</select></div>` : ""}
    <div class="field"><label>Verantwoordelijke</label><select id="f_wie"><option value="">— nog niet toegewezen —</option>${pcs.length ? `<optgroup label="Klant, aannemers en contacten">${pcs.map(x => opt("c:" + x.c.id, x.c.naam + (x.c.vakgebied ? " · " + x.c.vakgebied : "") + " · " + (ROL[x.rol] || x.rol))).join("")}</optgroup>` : ""}<optgroup label="Team">${S.base.profiles.map(u => opt(u.id, u.name)).join("")}</optgroup></select></div>
    <div class="field"><label>Prioriteit</label><div class="seg" id="f_prio">${Object.entries(VS_PRIO).map(([k, l]) => `<button type="button" data-p="${k}" aria-pressed="${(v.prioriteit || "normaal") === k}">${l}</button>`).join("")}</div></div>
    <div class="field"><label>Op te lossen tegen</label><input id="f_deadline" type="date" value="${esc(v.deadline || "")}"></div>
    ${v.id ? `<div class="field"><label>Status</label><select id="f_status">${Object.entries(VS_STATUS).map(([k, l]) => `<option value="${k}" ${v.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></div><div class="field"><label>Opmerking</label><input id="f_opm" value="${esc(v.opmerking || "")}"></div>` : ""}
    <button class="btn primary" id="f_save" style="margin-top:6px;padding:15px">${v.id ? "Bewaren" : "Vaststelling bewaren"}</button>
    <p class="meta" style="text-align:center;margin-top:10px">${S.online ? "Wordt meteen verzonden." : "Geen bereik: wordt bewaard op dit toestel en later verzonden."}</p>`;
}
function bindForm() {
  const v = S.form; v._nieuw = v._nieuw || []; let prio = v.prioriteit || "normaal"; let pin = v.plan_id && v.plan_x != null ? { x: Number(v.plan_x), y: Number(v.plan_y) } : null;
  const planSel = $("#f_plan");
  if (planSel) { const pb = $("#f_planbox");
    const drawPlan = () => { const pl = plan(planSel.value); if (!pl) { pb.innerHTML = ""; return; }
      const others = allVs().filter(x => x.plan_id === pl.id && x.id !== v.id && x.plan_x != null && (x.status === "open" || x.status === "opgelost"));
      pb.innerHTML = `<p class="meta" style="margin:0 0 6px">Tik op het plan om de plek aan te duiden.${pin ? ` <button type="button" class="btn ghost" style="width:auto;padding:2px 8px" data-pin-clear>Pin wissen</button>` : ""}</p><div class="plan-wrap" data-pinnable><img src="${esc(pl.url)}" alt="">${others.map(x => pinHtml(x, x.status + " dim")).join("")}${pin ? `<span class="pin mine" style="left:${pin.x * 100}%;top:${pin.y * 100}%">${v.nr || "●"}</span>` : ""}</div>`;
      pb.querySelector("[data-pinnable]").addEventListener("click", (e) => { const img = pb.querySelector("img"); const r = img.getBoundingClientRect(); pin = { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; drawPlan(); });
      const cl = pb.querySelector("[data-pin-clear]"); if (cl) cl.onclick = () => { pin = null; drawPlan(); }; };
    planSel.addEventListener("change", () => { pin = null; drawPlan(); }); drawPlan(); }
  const box = $("#f_fotos");
  const draw = () => { box.innerHTML = (v.id ? (v.fotos || []).map(f => `<div class="fi"><img src="${esc(f.url)}" alt=""></div>`).join("") : "") + v._nieuw.map((f, i) => `<div class="fi"><img src="${f.url}" alt=""><button type="button" class="x" data-x="${i}">✕</button></div>`).join(""); box.querySelectorAll("[data-x]").forEach(b => b.onclick = () => { v._nieuw.splice(Number(b.dataset.x), 1); draw(); }); };
  draw();
  document.querySelectorAll("[data-file]").forEach(inp => inp.addEventListener("change", async (e) => {
    const sv = $("#f_save"); if (sv) { sv.disabled = true; sv.textContent = "Foto's verwerken…"; }
    for (const file of [...e.target.files]) { try { const r = await verklein(file); v._nieuw.push({ ...r, url: blobUrl(r.blob) }); } catch (err) { toast("Foto niet bruikbaar"); } }
    e.target.value = ""; draw(); if (sv) { sv.disabled = false; sv.textContent = v.id ? "Bewaren" : "Vaststelling bewaren"; }
  }));
  ["f_titel", "f_oms", "f_ruimte", "f_deadline", "f_opm"].forEach(id => { const el = $("#" + id); if (el) el.addEventListener("input", () => { v[{ f_titel: "titel", f_oms: "omschrijving", f_ruimte: "ruimte", f_deadline: "deadline", f_opm: "opmerking" }[id]] = el.value; }); });
  $("#f_prio").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; prio = b.dataset.p; v.prioriteit = prio; $("#f_prio").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)); });
  $("#f_save").onclick = async () => {
    const oms = $("#f_oms").value.trim(); const titel = $("#f_titel").value.trim(); if (!oms && !titel && !v._nieuw.length && !(v.fotos || []).length) { toast("Geef een titel of omschrijving, of neem een foto"); $("#f_titel").focus(); return; }
    const wieV = $("#f_wie").value; const wieP = wieV.startsWith("c:") ? { contact_id: wieV.slice(2), assignee: null } : { contact_id: null, assignee: wieV || null };
    const patch = { titel, omschrijving: oms, ...(planSel ? { plan_id: planSel.value || null, plan_x: planSel.value && pin ? pin.x : null, plan_y: planSel.value && pin ? pin.y : null } : {}), ruimte: $("#f_ruimte").value.trim(), lot: $("#f_lot") && $("#f_lot").value ? Number($("#f_lot").value) : null, ...wieP, prioriteit: prio, deadline: $("#f_deadline").value || null };
    $("#f_save").disabled = true;
    try {
    if (v.id) {
      const st = $("#f_status").value; patch.opmerking = $("#f_opm").value.trim();
      if (st !== v.status) { patch.status = st; if (st === "opgelost") { patch.opgelost_op = new Date().toISOString(); patch.opgelost_door = S.me?.id || null; } if (st === "open") { patch.opgelost_op = null; patch.opgelost_door = null; } }
      await enqueue({ kind: "vs-update", vid: v.id, pid: v.project_id || S.project, patch, veld: "fotos", fotos: v._nieuw.map(f => ({ blob: f.blob, w: f.w, h: f.h })) });
      S.view = "detail"; S.detail = v.id; toast("Bewaard");
    } else {
      const row = { id: uuid(), project_id: S.project, bezoek_id: S.bezoek || null, status: "open", klant_zichtbaar: false, fotos: [], created_by: S.me?.id || null, ...patch };
      await enqueue({ kind: "vs-new", row, fotos: v._nieuw.map(f => ({ blob: f.blob, w: f.w, h: f.h })) });
      S.view = "list"; S.filter = "open"; toast(S.online ? "Vaststelling verzonden" : "Bewaard op dit toestel — wordt verzonden zodra er bereik is", 3500);
    }
    } catch (e) { $("#f_save").disabled = false; return; }
    S.form = null; render();
  };
}
function vBezoek() {
  return `<button class="back" data-act="back">‹ Terug</button><h1>Werfbezoek starten</h1>
    <div class="field"><label>Datum</label><input id="b_datum" type="date" value="${todayIso}"></div>
    <div class="field"><label>Weer</label><select id="b_weer">${WEER.map(w => `<option value="${w}">${w || "—"}</option>`).join("")}</select></div>
    <div class="field"><label>Aanwezig</label><input id="b_aanw" placeholder="bv. Phil, Jo Appelmans, schrijnwerker"></div>
    <div class="field"><label>Algemene opmerkingen / stand van de werken</label><textarea id="b_not"></textarea></div>
    <button class="btn primary" data-act="bezoek-save" style="padding:15px">Bezoek starten</button>
    <p class="meta" style="text-align:center;margin-top:10px">Nieuwe vaststellingen worden aan dit bezoek gekoppeld tot je het afsluit.</p>`;
}

/* ---------- acties ---------- */
async function setStatus(id, s, extra = {}, fotos = []) {
  const v = allVs().find(x => x.id === id); if (!v) return;
  const patch = { status: s, ...extra };
  if (s === "opgelost") { patch.opgelost_op = new Date().toISOString(); patch.opgelost_door = S.me?.id || null; }
  if (s === "open") { patch.opgelost_op = null; patch.opgelost_door = null; }
  try { await enqueue({ kind: "vs-update", vid: id, pid: v.project_id || S.project, patch, veld: "opgelost_fotos", fotos }); } catch (e) { return; }
  toast(s === "opgelost" ? "Gemarkeerd als opgelost" : s === "gecontroleerd" ? "Gecontroleerd ✓" : s === "open" ? "Heropend" : "Vervallen");
}
document.addEventListener("click", async (e) => {
  if (e.target.dataset.lb) { const lb = $("#lb"); lb.innerHTML = `<img src="${esc(e.target.dataset.lb)}" alt="">`; lb.classList.add("show"); return; }
  if (e.target.closest("#lb")) { $("#lb").classList.remove("show"); return; }
  const el = e.target.closest("[data-act]"); if (!el) return; const d = el.dataset;
  if (d.act === "projects") { S.view = "projects"; return render(); }
  if (d.act === "pick") { S.project = d.id; store.set("p", d.id); S.bezoek = null; store.del("bezoek"); S.view = "list"; useCache(d.id); render(); if (S.online) { try { await loadProject(d.id); } catch (err) { toast("Niet geladen: " + err.message); } render(); } return; }
  if (d.act === "filter") { S.filter = d.f; return render(); }
  if (d.act === "perlot") { S.perLot = !S.perLot; store.set("perlot", S.perLot); return render(); }
  if (d.act === "new") { S.form = {}; S.view = "new"; return render(); }
  if (d.act === "open") { S.detail = d.id; S.view = "detail"; return render(); }
  if (d.act === "back") { S.view = S.view === "edit" ? "detail" : "list"; S.form = null; return render(); }
  if (d.act === "edit") { const v = allVs().find(x => x.id === d.id); if (!v) return; S.form = { ...v }; S.view = "edit"; return render(); }
  if (d.act === "status") { await setStatus(d.id, d.s); return render(); }
  if (d.act === "oplos") { await setStatus(d.id, "opgelost"); return render(); }
  if (d.act === "opm") { const t = prompt("Opmerking voor BROS bij dit punt:", ""); if (t === null || !t.trim()) return; try { await enqueue({ kind: "vs-update", vid: d.id, pid: S.project, patch: { opmerking: t.trim() }, veld: "opgelost_fotos", fotos: [] }); toast("Opmerking bewaard"); } catch (e) { } return render(); }
  if (d.act === "bezoek") { S.view = "bezoek"; return render(); }
  if (d.act === "bezoek-save") { const row = { id: uuid(), project_id: S.project, datum: $("#b_datum").value || todayIso, weer: $("#b_weer").value, aanwezigen: $("#b_aanw").value.trim(), notities: $("#b_not").value, auteur: S.me?.id || null }; await enqueue({ kind: "wb-new", row }); S.bezoek = row.id; store.set("bezoek", row.id); S.view = "list"; toast("Werfbezoek gestart"); return render(); }
  if (d.act === "bezoek-stop") { S.bezoek = null; store.del("bezoek"); toast("Werfbezoek afgesloten"); return render(); }
  if (d.act === "sync") {
    const mislukt = S.queue.filter(q => (q.tries || 0) >= 5);
    if (mislukt.length) { const txt = mislukt.map(q => "• " + (q.kind === "vs-new" ? (q.row.titel || q.row.omschrijving || "vaststelling") : q.kind) + ": " + (q.err || "?")).join("\n"); if (confirm(mislukt.length + " item(s) konden niet verzonden worden:\n" + txt + "\n\nOK = nog eens proberen · Annuleren = niets doen")) { mislukt.forEach(q => { q.tries = 0; idb.put(q).catch(() => { }); }); return sync(); } return; }
    if (!S.online) return toast("Geen verbinding — de wachtrij wordt verzonden zodra er bereik is"); if (!S.queue.length) { refresh(); return toast("Alles is verzonden"); } return sync(); }
  if (d.act === "logout") { if (S.queue.length && !confirm(S.queue.length + " item(s) zijn nog niet verzonden. Toch afmelden? Ze worden pas verzonden na een volgende aanmelding.")) return; await sb.auth.signOut(); S.session = null; S.me = null; store.del("me"); return render(); }
});
document.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.dataset.oplos || t.dataset.addfoto) {
    const id = t.dataset.oplos || t.dataset.addfoto; const fotos = [];
    for (const file of [...t.files]) { try { const r = await verklein(file); fotos.push({ blob: r.blob, w: r.w, h: r.h }); } catch (err) { toast("Foto niet bruikbaar"); } }
    t.value = "";
    if (t.dataset.oplos) await setStatus(id, "opgelost", {}, fotos);
    else if (fotos.length) { try { await enqueue({ kind: "vs-update", vid: id, pid: S.project, patch: {}, veld: isAan() ? "opgelost_fotos" : "fotos", fotos }); toast("Foto toegevoegd"); } catch (e) { } }
    render();
  }
});
document.addEventListener("input", (e) => { if (e.target.hasAttribute("data-projq")) { S.projQ = e.target.value; const pos = e.target.selectionStart; render(); const el = $("[data-projq]"); if (el) { el.focus(); el.setSelectionRange(pos, pos); } } });
document.addEventListener("submit", async (e) => {
  if (e.target.id !== "login") return; e.preventDefault();
  const f = new FormData(e.target); S.loginErr = "";
  const { data, error } = await sb.auth.signInWithPassword({ email: f.get("email"), password: f.get("password") });
  if (error) { S.loginErr = /invalid/i.test(error.message) ? "E-mail of wachtwoord klopt niet." : error.message; return render(); }
  S.session = data.session; await start();
});

/* ---------- start ---------- */
async function start() {
  await loadQueue();
  if (S.session && S.online) {
    try { await loadBase(); } catch (e) { console.warn(e); }
    if (S.me && S.me.role === "klant") { await sb.auth.signOut(); S.session = null; S.me = null; store.del("me"); S.loginErr = "De werfmodus is voor het BROS-team en de aannemers; als klant gebruik je het klantenportaal."; return render(); }
    const qp = new URLSearchParams(location.search).get("p"); if (qp && S.base.projecten.find(p => p.id === qp)) { S.project = qp; store.set("p", qp); history.replaceState(null, "", location.pathname); }
    if (S.project) { useCache(S.project); try { await loadProject(S.project); } catch (e) { console.warn(e); } }
  } else if (S.project) useCache(S.project);
  S.ready = true; render();
  if (S.online) sync();
}
(async () => {
  const { data: { session } } = await sb.auth.getSession(); S.session = session;
  sb.auth.onAuthStateChange((ev, s) => { if (ev === "TOKEN_REFRESHED" || ev === "SIGNED_IN") S.session = s; if (ev === "SIGNED_OUT") { S.session = null; if (S.online) render(); } });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { });
  await start();
})();
