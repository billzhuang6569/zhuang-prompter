import { networkInterfaces } from "node:os";

export type NetworkOrigin = {
  label: string;
  origin: string;
  kind: "local" | "lan";
};

export type NetworkInfo = {
  port: number;
  host: string;
  origins: NetworkOrigin[];
};

export function getServerPort() {
  return Number.parseInt(process.env.PORT ?? "3000", 10);
}

export function getServerHost() {
  return process.env.HOST ?? "0.0.0.0";
}

export function isHttpsEnabled() {
  return process.env.HTTPS === "1" || process.env.HTTPS === "true" || process.env.PROMPTER_HTTPS === "1";
}

export function getNetworkInfo(port = getServerPort(), host = getServerHost()): NetworkInfo {
  const protocol = isHttpsEnabled() ? "https" : "http";
  const origins: NetworkOrigin[] = [
    {
      label: "本机",
      origin: `${protocol}://localhost:${port}`,
      kind: "local",
    },
  ];

  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (!/^en\d+$/.test(name)) {
      continue;
    }
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal) {
        continue;
      }
      origins.push({
        label: "播放端网址",
        origin: `${protocol}://${address.address}:${port}`,
        kind: "lan",
      });
    }
  }

  return { port, host, origins };
}
