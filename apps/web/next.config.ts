import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev badge would sit on top of the tab bar while building the phone UI.
  devIndicators: false,
  // Cross-origin isolation lets the on-device AI use several CPU threads (much faster without a GPU).
  // "credentialless" keeps the map tiles and weather requests working.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
};

export default nextConfig;
