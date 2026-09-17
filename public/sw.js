// Real service worker for the POS app-shell.
//
// PURPOSE: make the app itself openable with zero internet — not the order
// queue (that's IndexedDB/offlineDB.ts and already works once the app is
// loaded). This file is what lets the app *load* at all after the tab is
// closed, the machine restarts, or the browser crashes while offline.
//
// CACHE_VERSION IS CRITICAL AND MUST CHANGE ON EVERY DEPLOY.
// If it doesn't, old cached HTML/JS from a previous build never gets
// evicted — the activate handler below only deletes caches from an OLDER
// version string, so a version string that never changes means nothing
// old is ever cleaned up. Every deploy you've ever tested keeps
// accumulating in the same bucket forever, and an offline refresh can
// silently resurrect an arbitrarily old build (old bugs included) with no
// errors and no visible sign anything's stale.
//
// Bump this to something that changes automatically, not a string you
// have to remember to edit. Easiest reliable option without extra build
// tooling: the current date+time, updated by hand right before each
// deploy. Better option if you want it fully automatic: read Next.js's
// own generated .next/BUILD_ID at build time and inline it here via a
// small prebuild script — ask if you want that wired up.
const CACHE_VERSION = "pos-shell-2026-09-17-01"; // <-- CHANGE THIS EVERY DEPLOY
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
      // pile up in storage forever. This only actually does anything if
      // CACHE_VERSION was bumped since the last deploy — see the warning
      // above.
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
  // This is what makes "reopen the app with zero internet" actually work
  // — but ONLY serves genuinely CURRENT content, because activate() above
  // just purged every older cache. The fallback here can only ever be as
  // fresh as your last deploy's CACHE_VERSION bump.
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
  // Safe specifically because Next.js content-hashes these filenames, so a
  // new deploy's files never collide with old ones under the same name —
  // the risk here is purely stale HTML pointing at chunks that no longer
  // exist after a version bump, which activate()'s cleanup prevents.
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
