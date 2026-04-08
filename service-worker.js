const CACHE_NAME = "itassettrack-shell-v1";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./itassettrack.css",
  "./itassettrack.js",
  "./manifest.webmanifest",
  "./vendor/chart.umd.min.js",
  "./vendor/qrcode.min.js",
  "./vendor/xlsx.full.min.js",
  "./icons/ITAssetTrack-appicon-cyan-256px.png",
  "./icons/ITAssetTrack-appicon-cyan-512px.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
          return Promise.resolve();
        }),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (!response || response.status !== 200) return response;
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match("./index.html"));
    }),
  );
});
