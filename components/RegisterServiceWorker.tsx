"use client";

import { useEffect } from "react";

/**
 * Registers the offline-shell service worker.
 *
 * Production only, on purpose: in `next dev`, chunks aren't immutable
 * content-hashed files the way they are in a production build — they get
 * reused/overwritten as you edit code via HMR. A service worker caching
 * them causes exactly the "module factory is not available" error you'd
 * hit after any code change, since the browser keeps serving an old
 * cached chunk that no longer matches the current module graph. None of
 * that applies to a real deployed build, so this only runs there.
 *
 * App Router: render <RegisterServiceWorker /> once inside app/layout.tsx,
 *   e.g. right before {children} in the <body>.
 *
 * Pages Router: the "use client" line above is simply ignored (harmless),
 *   so you can import and render this same component inside pages/_app.tsx
 *   instead — no changes needed to this file.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .catch((err) =>
          console.error("Service worker registration failed:", err)
        );
    }
  }, []);

  return null;
}
