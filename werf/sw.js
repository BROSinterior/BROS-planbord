/* BROS Werf — service worker: de app-schil offline beschikbaar houden en werffoto's cachen.
   Databaseverkeer (Supabase) gaat altijd rechtstreeks; de wachtrij zit in werf.js (IndexedDB). */
const VERSION = "1.19.1";
const SHELL = "bros-werf-" + VERSION;
const FOTOS = "bros-werf-fotos";
const SHELL_FILES = ["./", "./index.html", "./werf.js?v=" + VERSION, "./manifest.json", "./icon-192.png", "./icon-512.png", "../config.js?v=" + VERSION, "../logo-mark.svg", "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(SHELL).then(c => Promise.all(SHELL_FILES.map(f => c.add(f).catch(() => null)))).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL && k !== FOTOS).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  // werffoto's uit de storage-bucket: eerst uit de cache, anders ophalen en bewaren
  if (url.pathname.includes("/storage/v1/object/public/werf/")) {
    e.respondWith(caches.open(FOTOS).then(async c => { const hit = await c.match(req); if (hit) return hit; const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; }).catch(() => new Response("", { status: 504 })));
    return;
  }
  // databaseverkeer: nooit onderscheppen
  if (url.pathname.includes("/rest/v1/") || url.pathname.includes("/auth/v1/") || url.pathname.includes("/realtime/")) return;
  // app-schil: netwerk eerst (updates komen zo door), anders cache
  e.respondWith(fetch(req).then(r => { if (r.ok && (url.origin === location.origin || url.hostname === "cdn.jsdelivr.net")) caches.open(SHELL).then(c => c.put(req, r.clone())); return r; })
    .catch(async () => (await caches.match(req)) || (req.mode === "navigate" ? caches.match("./index.html") : Response.error())));
});
