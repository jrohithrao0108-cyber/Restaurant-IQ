// Real service worker for the POS app-shell.
//
// PURPOSE: make the app itself openable with zero internet — not the order
// queue (that's IndexedDB/offlineDB.ts and already works once the app is
// loaded). This file is what lets the app *load* at all after the tab is
// closed, the machine restarts, or the browser crashes while offline.
//
// STRATEGY (no build-time plugin, so this can't precache exact hashed
// Next.js chunk filenames — those change every deploy):
//   - Navigation requests (the HTML document, e.g. opening /pos):
//     network-first, falling back to the last cached copy of that page
//     if the network is unavailable.
//   - Static assets (/_next/static/*, images, fonts): cache-first, since
//     these are content-hashed by Next.js and safe to cache forever once
//     fetched — a new deploy gets new hashes, so this never serves stale
//     code.
//   - Everything else (API calls, Supabase requests): NOT intercepted —
//     goes straight to the network. Order data offline is handled entirely
//     by IndexedDB (see src/lib/offline/*), not by this service worker.
//
// Every successful online visit silently "warms" the cache for the next
// offline visit — no separate build step required.

const CACHE_VERSION = "pos-shell-v1";
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Update this to the real path(s) staff actually open the POS from, so the
// very first offline load (before anything's been cached) still works.
// If unsure, leave just "/" — it'll still work, just won't precache the
// POS route specifically until it's been visited online once.
const APP_SHELL_URLS = ["/", "/pos"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      // Best-effort: if a route 404s or the network is down at install
      // time, don't fail the whole install over it.
      await Promise.all(
        APP_SHELL_URLS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn(`[sw] could not precache ${url} at install:`, err);
          })
        )
      );
    })()
  );
  // Activate this version immediately instead of waiting for old tabs to
  // close — a POS terminal is usually one long-lived tab, so waiting could
  // mean never picking up a fix until a manual reload anyway.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from any previous CACHE_VERSION so old deploys don't
      // pile up in storage forever.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("pos-shell-") && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    /\.(?:png|jpg|jpeg|svg|webp|gif|ico|woff2?|ttf)$/.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle same-origin GET requests. Everything else (Supabase API
  // calls, cross-origin requests, POST/PUT/DELETE) passes straight through
  // untouched — this service worker never interferes with order sync.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations (opening/reloading a page): network-first, cache fallback.
  // This is what makes "reopen the app with zero internet" actually work.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(req, fresh.clone());
          return fresh;
        } catch (err) {
          const cache = await caches.open(RUNTIME_CACHE);
          const cached = await cache.match(req);
          if (cached) return cached;
          // Last resort: the generic app-shell root, if that's cached but
          // this exact route never was.
          const fallback = await cache.match("/");
          if (fallback) return fallback;
          throw err;
        }
      })()
    );
    return;
  }

  // Static, content-hashed assets: cache-first — safe to trust forever,
  // and this is what makes the app's JS/CSS actually available offline.
  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const fresh = await fetch(req);
          cache.put(req, fresh.clone());
          return fresh;
        } catch (err) {
          throw err;
        }
      })()
    );
  }

  // Everything else (API routes, data requests): not intercepted, goes to
  // the network as normal. Offline resilience for order data is IndexedDB's
  // job, not this service worker's.
});
