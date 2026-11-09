const CACHE_NAME = "hisab-pwa-v3";
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
  "./push-config.js",
  "./i18n.js",
  "./pwa.js",
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

// ─── Web Push Notification Handler ───
self.addEventListener("push", (event) => {
  let data = {
    title: "হিসাব - মিল রিমাইন্ডার 🍽️",
    body: "আজকের মিল এন্ট্রি এখনো দেননি! অনুগ্রহ করে অ্যাপে গিয়ে আজকের মিল যোগ করুন।",
    icon: "./pwa-icon-192.png",
    badge: "./favicon.svg",
    tag: "meal-reminder",
    data: { url: "./user-dashboard.html#section-meals" }
  };

  if (event.data) {
    try {
      const json = event.data.json();
      data = { ...data, ...json };
    } catch (e) {
      const text = event.data.text();
      if (text) data.body = text;
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || "./pwa-icon-192.png",
    badge: data.badge || "./favicon.svg",
    tag: data.tag || "meal-reminder",
    renotify: true,
    vibrate: [200, 100, 200],
    data: data.data || { url: "./user-dashboard.html#section-meals" }
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// ─── Notification Click Handler ───
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "./user-dashboard.html#section-meals";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes("user-dashboard.html") && "focus" in client) {
          if ("navigate" in client && targetUrl) {
            client.navigate(targetUrl);
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
