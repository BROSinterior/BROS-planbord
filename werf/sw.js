/* BROS Werf — service worker: de app-schil offline beschikbaar houden en werffoto's/plannen cachen.
   Databaseverkeer (Supabase) gaat altijd rechtstreeks; de wachtrij zit in werf.js (IndexedDB). */
const VERSION = "1.57.1";
const SHELL = "bros-werf-" + VERSION;
const FOTOS = "bros-werf-fotos";
const KRITIEK = ["./", "./index.html", "./werf.js?v=" + VERSION, "../config.js?v=" + VERSION, "../vendor/supabase-2.45.4.js"]   // 1.48: bibliotheek zelf gehost (geen CDN meer nodig);
const EXTRA = ["./manifest.json", "./icon-192.png", "./icon-512.png", "../logo-mark.svg"];
const MAX_FOTOS = 400;
const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms));
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then(async c => {
    await c.addAll(KRITIEK);                                   // faalt → oude versie blijft actief
    await Promise.all(EXTRA.map(f => c.add(f).catch(() => null)));
  }).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("bros-werf-") && k !== SHELL && k !== FOTOS).map(k => caches.delete(k)))).then(() => self.clients.claim())); });   // 1.48: enkel de eigen caches (niet die van het klantenportaal)
async function prune(c) { const keys = await c.keys(); if (keys.length > MAX_FOTOS) await Promise.all(keys.slice(0, keys.length - MAX_FOTOS).map(k => c.delete(k))); }
self.addEventListener("fetch", (e) => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  // werffoto's en plannen uit de storage-bucket: eerst uit de cache, anders ophalen (met cors, zodat het antwoord bruikbaar is) en bewaren
  if (url.pathname.includes("/storage/v1/object/public/werf/")) {
    e.respondWith(caches.open(FOTOS).then(async c => {
      const hit = await c.match(req.url); if (hit) return hit;
      const r = await fetch(new Request(req.url, { mode: "cors" })); if (r.ok) { c.put(req.url, r.clone()); prune(c); } return r;
    }).catch(() => new Response("", { status: 504 })));
    return;
  }
  // databaseverkeer: nooit onderscheppen
  if (url.pathname.includes("/rest/v1/") || url.pathname.includes("/auth/v1/") || url.pathname.includes("/realtime/") || url.pathname.includes("/storage/v1/")) return;
  // app-schil: netwerk eerst met korte timeout (updates komen zo door), anders cache
  // 1.48: eigen bestanden bewaren onder het adres zonder ?v= (de cache groeit niet met elke versie); de kopie meteen nemen (anders mislukt clone())
  e.respondWith(Promise.race([fetch(req), timeout(4000)]).then(r => { if (r.ok && (url.origin === location.origin || url.hostname === "cdn.jsdelivr.net")) { const kopie = r.clone(); const sleutel = url.origin === location.origin && /^(\?v=[\w.]+)?$/.test(url.search) ? url.origin + url.pathname : req; caches.open(SHELL).then(c => c.put(sleutel, kopie)); } return r; })
    .catch(async () => (await caches.match(req)) || (await caches.match(req.url.split("?")[0])) || (req.mode === "navigate" ? caches.match("./index.html") : Response.error())));
});
