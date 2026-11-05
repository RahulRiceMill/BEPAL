var CACHE = "bepal-v3";
var FILES = ["./", "./index.html", "./style.css", "./script.js", "./manifest.json", "./icon-192.png", "./icon-512.png", "./logo.png"];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(FILES.map(function (f) { return c.add(f).catch(function () {}); }));
  }));
  self.skipWaiting();
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
// Online: fetch the newest files. Offline: use the saved copy.
// Saves this app's files and the Firebase code files (gstatic.com) so the app can start offline after one online visit.
self.addEventListener("fetch", function (e) {
  var r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || (u.origin !== self.location.origin && u.hostname !== "www.gstatic.com")) return;
  e.respondWith(fetch(r, { cache: "no-cache" }).then(function (res) {
    if (res.ok) { var c = res.clone(); caches.open(CACHE).then(function (h) { h.put(r, c); }); }
    return res;
  }).catch(function () { return caches.match(r); }));
});
