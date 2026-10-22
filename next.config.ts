import type { NextConfig } from "next";

const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  reactStrictMode: true,
  // Inline the (tiny) stylesheet: no render-blocking CSS request.
  experimental: { inlineCss: true },
};

export default config;
