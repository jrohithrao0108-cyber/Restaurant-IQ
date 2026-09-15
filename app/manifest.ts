import { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RestaurantIQ - POS & Analytics",
    short_name: "RestaurantIQ",
    description: "Intelligent POS, KOT Printing & Restaurant Analytics Platform",
    start_url: "/",
    display: "standalone",
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
