import type { MetadataRoute } from "next";

/** Makes the site installable as a phone app ("Add to Home Screen"). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "EcoMAB Heilbronn",
    short_name: "EcoMAB",
    description: "The best time and place in Heilbronn to run, ride or walk.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#075b4a",
    lang: "en",
    categories: ["health", "sports", "weather"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
