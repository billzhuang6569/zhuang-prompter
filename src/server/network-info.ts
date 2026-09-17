import { hostname, networkInterfaces } from "node:os";

export type NetworkOrigin = {
  label: string;
  origin: string;
  kind: "local" | "lan" | "mdns";
};

// mDNS/Bonjour 主机名（如 Bill-3.local）：同一局域网内可直接解析，
// 比裸 IP 更好记，作为 §12.2 “<主机>.local:<端口>” 的记忆型地址。
// 说明：不存在受控的 p.tan 之类自定义短域名——那需要我们无法保证的
// 局域网 DNS 注册；.local 由系统 Bonjour 提供，是可落地的记忆型主机形式。
function getMdnsHost(): string | null {
  const raw = hostname().trim();
  if (!raw || raw === "localhost") {
    return null;
  }
  if (raw.endsWith(".local")) {
    return raw;
  }
  // 仅在单段主机名（不含点）时补 .local，避免污染已带域名的主机。
  if (!raw.includes(".")) {
    return `${raw}.local`;
  }
  return null;
}

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

  const mdnsHost = getMdnsHost();
  if (mdnsHost) {
    origins.push({
      label: "好记网址",
      origin: `${protocol}://${mdnsHost}:${port}`,
      kind: "mdns",
    });
  }

  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (process.platform === "darwin" && !/^en\d+$/.test(name)) {
      continue;
    }
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal || address.address.startsWith("169.254.")) {
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
