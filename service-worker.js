/* Family Day Planner service worker */
const CACHE_NAME = "fdp-cache-v2025-12-28-1";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE_NAME) ? caches.delete(k) : Promise.resolve()));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith((async () => {
    const url = new URL(req.url);

    // Only handle same-origin; let Supabase/CDNs go to network.
    if (url.origin !== self.location.origin) {
      return fetch(req);
    }

    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;

    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) {
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (e) {
      const shell = await cache.match("./index.html");
      return shell || new Response("Offline", { status: 503, statusText: "Offline" });
    }
  })());
});
