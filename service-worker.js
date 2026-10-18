// Minimal service worker: caches the app shell so it installs cleanly
// and still opens (from cache) with a spotty connection. Not a real
// offline data strategy, just enough for a demo/beta build to qualify
// as an installable PWA on iOS and Android.

const CACHE_NAME = "third-space-demo-v85";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./places.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./stamps/silver-lake.png",
  "./stamps/echo-park.png",
  "./stamps/los-feliz.png",
  "./stamps/downtown.png",
  "./stamps/santa-monica.png",
  "./stamps/venice.png",
  "./stamps/beverly-hills.png",
  "./stamps/west-hollywood.png",
  "./stamps/culver-city.png",
  "./stamps/burbank.png",
  "./stamps/hollywood.png",
  "./stamps/pasadena.png",
  "./stamps/koreatown.png",
  "./stamps/highland-park.png",
  "./stamps/glendale.png",
  "./stamps/mid-wilshire.png",
  "./stamps/westwood.png",
  "./stamps/brentwood.png",
  "./stamps/sawtelle.png",
  "./stamps/fairfax.png",
  "./stamps/studio-city.png",
  "./stamps/eagle-rock.png",
  "./stamps/sherman-oaks.png",
  "./stamps/leimert-park.png",
  "./stamps/griffith-park.png",
  "./stamps/north-hollywood.png",
  "./stamps/exposition-park.png",
  "./stamps/east-hollywood.png",
  "./stamps/inglewood.png",
  "./stamps/beverly-grove.png",
  "./stamps/atwater-village.png",
  "./stamps/mar-vista.png",
  "./stamps/long-beach.png",
  "./stamps/santa-monica-light.png",
  "./stamps/silver-lake-light.png",
  "./stamps/west-hollywood-light.png",
  "./stamps/passport-stamp.webp",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // fetch with {cache:"reload"} so a bumped CACHE_NAME always repopulates
      // from the network — GitHub Pages' CDN caches app-shell files for a
      // few minutes, and a default fetch() here could silently re-cache the
      // stale copy right after a deploy.
      Promise.all(
        APP_SHELL.map((url) =>
          fetch(url, { cache: "reload" }).then((res) => cache.put(url, res))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only handle our own files; Supabase, Mapbox, Google Sheets etc. always go straight to the network.
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  // The page itself: network first, so a new deploy shows up on the next open; cached copy only when offline.
  if (req.mode === "navigate" || req.url.endsWith("/index.html")) {
    event.respondWith(
      fetch(req, { cache: "no-cache" })
        .then((res) => { const copy = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(req, copy)); return res; })
        .catch(() => caches.match(req).then((r) => r || caches.match("./index.html")))
    );
    return;
  }
  // Icons, stamps etc.: cache first.
  event.respondWith(caches.match(req).then((cached) => cached || fetch(req)));
});
