import { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "RestaurantIQ - POS & Analytics",
    short_name: "RestaurantIQ",
    description: "Intelligent POS, KOT Printing & Restaurant Analytics Platform",
    start_url: "/",
    display: "standalone",
    // A POS terminal is a fixed, landscape screen — locks the installed
    // window/orientation instead of leaving it to whatever the device
    // defaults to.
    orientation: "landscape",
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
