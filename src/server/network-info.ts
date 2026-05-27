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

export function getNetworkInfo(port = getServerPort(), host = getServerHost()): NetworkInfo {
  const origins: NetworkOrigin[] = [
    {
      label: "本机",
      origin: `http://localhost:${port}`,
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
        label: `局域网 ${name}`,
        origin: `http://${address.address}:${port}`,
        kind: "lan",
      });
    }
  }

  return { port, host, origins };
}
