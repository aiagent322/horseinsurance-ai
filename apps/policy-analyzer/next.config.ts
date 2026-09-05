import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  serverExternalPackages: ["pdf-parse", "tesseract.js", "tesseract.js-core", "@napi-rs/canvas"],
  async headers() {
    return [
      {
        source: "/analysis/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "private, no-store" }
        ]
      },
      {
        source: "/api/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "private, no-store" }
        ]
      }
    ];
  }
};

export default nextConfig;
