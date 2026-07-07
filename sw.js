// Service worker: cache-first offline shell for the CCA-F study PWA.
// Release procedure: bump CACHE_VERSION on every deploy that changes any
// precached file. A stale CACHE_VERSION means users keep old assets forever.

const CACHE_VERSION = "ccaf-v5";

// Every relative URL that must be available offline. Keep this list in sync
// with the filesystem — scripts/validate.mjs cross-checks it both directions.
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/dashboard.js",
  "./js/data.js",
  "./js/exam.js",
  "./js/flashcards.js",
  "./js/history.js",
  "./js/question-card.js",
  "./js/quiz.js",
  "./js/review.js",
  "./js/router.js",
  "./js/settings.js",
  "./js/srs.js",
  "./js/store.js",
  "./js/util.js",
  "./data/flashcards.json",
  "./data/questions-agentic.json",
  "./data/questions-claude-code.json",
  "./data/questions-context.json",
  "./data/questions-mcp.json",
  "./data/questions-prompting.json",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon.ico",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle same-origin GET requests; let everything else pass through
  // to the network untouched (POST, cross-origin, etc.).
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
