import type { NextConfig } from "next";

// خطاهای TypeScript بیلد production را نباید رد کنند
const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
};

export default nextConfig;
