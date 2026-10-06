/* BROS Klantenportaal — service worker: enkel de app-schil (pagina, script, logo) bewaren zodat het portaal als app
   snel opent. Gegevens (Supabase), inloggen en Drive-bestanden gaan altijd rechtstreeks: nooit uit een cache. */
const VERSION = "1.35.0";
const SHELL = "bros-klant-" + VERSION;
const SCHIL = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(SHELL).then(c => Promise.all(SCHIL.map(f => c.add(f).catch(() => null)))).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("bros-klant-") && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // Supabase, Drive, CDN's: nooit onderscheppen
  // eigen bestanden: altijd eerst het netwerk (updates komen meteen door), enkel zonder verbinding uit de cache
  // bewaren onder een vaste sleutel zonder parameters (geen ?code=… van een login in de cache, geen eindeloos groeiende cache)
  const sleutel = req.mode === "navigate" ? new URL("./index.html", location.href).href : url.origin + url.pathname;
  const bewaar = url.pathname.startsWith(new URL("./", location.href).pathname) && (!url.search || /^\?v=[\w.]+$/.test(url.search) || req.mode === "navigate");
  e.respondWith(fetch(req).then(r => { if (r.ok && bewaar) { const kopie = r.clone(); caches.open(SHELL).then(c => c.put(sleutel, kopie)); } return r; })
    .catch(async () => (await caches.match(sleutel)) || (req.mode === "navigate" ? caches.match(new URL("./index.html", location.href).href) : Response.error())));
});
