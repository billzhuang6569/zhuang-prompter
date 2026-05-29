import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

function getLanDevOrigins() {
  const origins = new Set<string>();

  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal) {
      continue;
    }
    origins.add(address.address);
    origins.add(`http://${address.address}:3000`);
    origins.add(`https://${address.address}:3000`);
  }
  }

  return Array.from(origins);
}

const nextConfig: NextConfig = {
  allowedDevOrigins: getLanDevOrigins(),
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
