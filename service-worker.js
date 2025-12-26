// Tiny offline cache so it feels “app-like”
// GitHub Pages often serves your site from a subpath (e.g., /repo-name/).
// So we build cache URLs relative to the service worker's scope.
const CACHE = "family-planner-v3";

function scopedUrl(path) {
  // self.registration.scope ends with a trailing slash
  return new URL(path, self.registration.scope).toString();
}

const ASSETS = [
  scopedUrl("./"),
  scopedUrl("./index.html"),
  scopedUrl("./app.js"),
  scopedUrl("./manifest.json"),
  scopedUrl("./icon-192.png"),
  scopedUrl("./icon-512.png"),
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  // Cache-first for same-origin requests; network fallback.
  const req = e.request;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
  }
});
