import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship compiled ESM from dist/, so Next can consume them
  // directly. Listed here so a future package that ships raw TS still works.
  transpilePackages: ["@ap-emp-ai/calc", "@ap-emp-ai/rag"],
};

export default nextConfig;
