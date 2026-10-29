import { wgslTurbopackRule } from "@vgpu/wgsl/next";
import type { NextConfig } from "next";

const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  reactStrictMode: true,
  // Inline the (tiny) stylesheet: no render-blocking CSS request.
  experimental: { inlineCss: true },
  // WebGPU shaders (vgpu) import as modules: the loader prepares them at build time.
  turbopack: { rules: { "*.wgsl": wgslTurbopackRule({ minify: true }) } },
};

export default config;
