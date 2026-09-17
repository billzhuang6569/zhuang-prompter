import { networkInterfaces } from "node:os";

export type NetworkOrigin = {
  label: string;
  origin: string;
  kind: "local" | "lan" | "mdns";
};

// 固定 mDNS 短链 + 内置 responder 方案：
// 所有机器统一广播同一个固定的 mDNS 主机名（见 MDNS_SHORT_HOST），
// 因此同一局域网内的任意用户都通过同一个好记地址（如 http://ptan.local:<端口>）进入，
// 而不再随机器名（Bill-3.local 之类）变化。
// 关键：仅返回这个字符串并不足以让它可解析——Electron 主进程会启动一个
// multicast-dns responder（见 electron/mdns-responder.cjs），对局域网内针对
// MDNS_SHORT_HOST 的 A 查询作出应答，把它解析到本机的局域网 IPv4
// （复用下方 getLanIPv4() 的选择逻辑，保持一致）。

// 固定的 mDNS 短链主机名，所有机器统一广播这个名字。
export const MDNS_SHORT_HOST = "ptan.local";

function getMdnsHost(): string {
  return MDNS_SHORT_HOST;
}

/**
 * 返回本机的局域网 IPv4 地址（供 mDNS responder 复用）。
 * 选择逻辑：darwin 上仅取 `en\d+` 接口；排除 internal 回环与 169.254 链路本地地址。
 * 找不到合适地址时返回 null。
 */
export function getLanIPv4(): string | null {
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (process.platform === "darwin" && !/^en\d+$/.test(name)) {
      continue;
    }
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal || address.address.startsWith("169.254.")) {
        continue;
      }
      return address.address;
    }
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
      label: "统一短链",
      origin: `${protocol}://${mdnsHost}:${port}`,
      kind: "mdns",
    });
  }

  const lanIp = getLanIPv4();
  if (lanIp) {
    origins.push({
      label: "播放端网址",
      origin: `${protocol}://${lanIp}:${port}`,
      kind: "lan",
    });
  }

  return { port, host, origins };
}
