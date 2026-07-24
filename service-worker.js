/* Makan Split — service worker (offline app shell)
   Bump CACHE whenever you change any cached file, to force an update. */
var CACHE = "makan-split-v1";
var ASSETS = [
  "index.html",
  "app.js",
  "manifest.json",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-512-maskable.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // Add individually so one missing asset doesn't fail the whole install.
      return Promise.all(ASSETS.map(function (url) {
        return c.add(url).catch(function () { /* ignore */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  // App-shell navigation: try network, fall back to cached index.html (offline).
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(function () { return caches.match("index.html"); }));
    return;
  }

  // Everything else: cache-first, then network (and cache the response).
  e.respondWith(
    caches.match(req).then(function (cached) {
      return cached || fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () { return cached; });
    })
  );
});
