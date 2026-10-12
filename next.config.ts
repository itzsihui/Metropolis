import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  // Client components label the settlement chain, so mirror the server-side
  // chain selection into the bundle. Rebuild after changing either value.
  env: {
    NEXT_PUBLIC_CHAIN_NETWORK:
      process.env.NEXT_PUBLIC_CHAIN_NETWORK || process.env.CHAIN_NETWORK || "",
    NEXT_PUBLIC_SETTLE_NETWORKS:
      process.env.NEXT_PUBLIC_SETTLE_NETWORKS || process.env.SETTLE_NETWORKS || "",
  },
  // ethers v5 (used by @arbitrum/sdk) breaks on Next's patched fetch when bundled.
  serverExternalPackages: ["@arbitrum/sdk", "ethers"],
  images: {
    // Local only: AVG HTTPS scanning breaks Node's fetch of Unsplash.
    unoptimized: process.env.NODE_ENV === "development",
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "api.dicebear.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
