/* MCU Atlas service worker
   - app shell: network first, cache fallback (so deploys show up immediately online)
   - images + fonts + D3: cache first (they never change at the same URL... mostly)
   - the sync API is never cached */

const VERSION = "v3";
const SHELL = `mcu-shell-${VERSION}`;
const ASSETS = `mcu-assets-${VERSION}`;
const SHELL_FILES = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "fx.js",
  "data.js",
  "manifest.webmanifest",
  "images/icons/icon-192.png",
  "images/icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("mcu-") && ![SHELL, ASSETS].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function networkFirst(req) {
  return fetch(req)
    .then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(req, copy));
      }
      return res;
    })
    .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("index.html")));
}

function cacheFirst(req) {
  return caches.match(req).then((hit) =>
    hit ||
    fetch(req).then((res) => {
      if (res.ok || res.type === "opaque") {
        const copy = res.clone();
        caches.open(ASSETS).then((c) => c.put(req, copy));
      }
      return res;
    })
  );
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    if (url.pathname.includes("/api/")) return; // sync: always live
    if (req.mode === "navigate") return e.respondWith(networkFirst(new Request("index.html")));
    if (url.pathname.includes("/images/")) return e.respondWith(cacheFirst(req));
    return e.respondWith(networkFirst(req));
  }
  if (/fonts\.(googleapis|gstatic)\.com$|cdnjs\.cloudflare\.com$/.test(url.hostname)) {
    return e.respondWith(cacheFirst(req));
  }
});
