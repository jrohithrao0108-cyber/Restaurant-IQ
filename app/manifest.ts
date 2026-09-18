import { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "RestaurantIQ - POS & Analytics",
    short_name: "RestaurantIQ",
    description: "Intelligent POS, KOT Printing & Restaurant Analytics Platform",
    start_url: "/",
    display: "standalone",
    // No sitewide lock: the manifest orientation applies to the whole
    // installed PWA, but only the admin analytics dashboard should be
    // forced to portrait on phones — POC/POS is always used on a PC, so
    // it doesn't need one. That per-view lock is done at runtime instead
    // (see the screen.orientation.lock("portrait") effect in
    // RestaurantIQDashboard).
    orientation: "any",
    background_color: "#faf7f2",
    theme_color: "#d99726",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
