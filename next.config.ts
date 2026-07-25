import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained .next/standalone server so the Docker runtime stage
  // needs neither node_modules nor the Next CLI — smaller image, non-root.
  output: "standalone",
};

export default nextConfig;
