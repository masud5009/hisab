const CACHE_NAME = "hisab-pwa-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./user-login.html",
  "./user-dashboard.html",
  "./admin-login.html",
  "./admin-dashboard.html",
  "./auth.js",
  "./calculation.js",
  "./firebase-config.js",
  "./user.js",
  "./admin.js",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./pwa-icon.svg",
  "./pwa-icon-192.png",
  "./pwa-icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const pathname = url.pathname.toLowerCase();
  const shouldRefreshFromNetwork =
    pathname.endsWith(".html") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".webmanifest");

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  if (url.origin === self.location.origin) {
    if (shouldRefreshFromNetwork) {
      event.respondWith(networkFirst(request));
      return;
    }

    event.respondWith(
      caches.match(request).then((cached) => {
        return cached || fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        });
      })
    );
    return;
  }

  if (url.hostname === "cdn.jsdelivr.net" || url.hostname === "cdnjs.cloudflare.com" || url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com" || url.hostname === "www.gstatic.com") {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fresh = fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        }).catch(() => cached);
        return cached || fresh;
      })
    );
  }
});

function networkFirst(request) {
  return fetch(request)
    .then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      return response;
    })
    .catch(() => caches.match(request));
}
