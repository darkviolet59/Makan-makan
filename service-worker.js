/* Makan Split — service worker (offline support + always-fresh code)

   Strategy:
   - App CODE (index.html, app.js) is served NETWORK-FIRST: the newest version
     always loads when you're online, so uploading a new app.js takes effect on
     the next reload — no need to bump a version by hand. Offline falls back to
     the last cached copy.
   - Static assets (icons, manifest) are cache-first for speed.

   Bump CACHE only if you want to force a fully clean re-cache. */
var CACHE = "makan-split-v3";
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
      return Promise.all(ASSETS.map(function (url) { return c.add(url).catch(function () {}); }));
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

  var path = new URL(req.url).pathname;
  var isCode = req.mode === "navigate" || /\.(?:html|js)$/.test(path);

  if (isCode) {
    // Network-first: fetch the freshest code (bypassing the HTTP cache), update
    // the cache, and fall back to the cached copy (or index.html) when offline.
    e.respondWith(
      fetch(new Request(req.url, { cache: "reload", credentials: "same-origin" }))
        .then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return res;
        })
        .catch(function () {
          return caches.match(req).then(function (c) { return c || caches.match("index.html"); });
        })
    );
    return;
  }

  // Cache-first for static assets.
  e.respondWith(
    caches.match(req).then(function (cached) {
      return cached || fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      });
    })
  );
});
