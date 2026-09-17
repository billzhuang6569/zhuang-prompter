/* eslint-disable @typescript-eslint/no-require-imports */

// 内置 mDNS responder：让固定短链 ptan.local 在整个局域网内可解析。
//
// 所有机器广播同一个固定主机名（MDNS_SHORT_HOST），responder 监听针对该名字的
// A 查询并回一条 A 记录，data = 本机当前的局域网 IPv4（每次应答时现算，IP 可能变）。
// 选择逻辑与 src/server/network-info.ts 的 getLanIPv4() 保持一致：
//   darwin 上仅取 en\d+ 接口；排除 internal 回环与 169.254 链路本地地址。
//
// Electron 主进程为 CommonJS，故用 require() 引入 multicast-dns。

const os = require("node:os");
const makeMdns = require("multicast-dns");

// 固定的 mDNS 短链主机名（与 network-info.ts 的 MDNS_SHORT_HOST 一致）。
const MDNS_SHORT_HOST = "ptan.local";
const TTL_SECONDS = 120;

// 计算本机局域网 IPv4，与 network-info.ts 的 getLanIPv4() 逻辑保持一致。
function getLanIPv4() {
  const interfaces = os.networkInterfaces();
  for (const [name, addresses] of Object.entries(interfaces)) {
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

/**
 * 启动 mDNS responder。返回一个带 destroy() 的句柄，供退出时调用。
 * @param {object} [options]
 * @param {() => (string|null)} [options.getIp] 可注入的 IP 获取函数（测试用），默认现算局域网 IPv4。
 * @param {string} [options.host] 要应答的主机名，默认 MDNS_SHORT_HOST。
 * @param {object} [options.mdns] 可注入的 multicast-dns 实例（测试用），默认现建。
 */
function startMdnsResponder(options = {}) {
  const host = (options.host ?? MDNS_SHORT_HOST).toLowerCase();
  const getIp = options.getIp ?? getLanIPv4;

  const mdns = options.mdns ?? makeMdns();

  const onQuery = (query) => {
    const questions = query?.questions ?? [];
    const wants = questions.some((question) => {
      if (!question || typeof question.name !== "string") {
        return false;
      }
      if (question.name.toLowerCase() !== host) {
        return false;
      }
      // 只处理 IPv4/A（也处理 ANY）。AAAA 忽略。
      return question.type === "A" || question.type === "ANY";
    });

    if (!wants) {
      return;
    }

    const ip = getIp();
    if (!ip) {
      return;
    }

    mdns.respond({
      answers: [
        {
          name: options.host ?? MDNS_SHORT_HOST,
          type: "A",
          ttl: TTL_SECONDS,
          data: ip,
        },
      ],
    });
  };

  mdns.on("query", onQuery);

  return {
    host: options.host ?? MDNS_SHORT_HOST,
    destroy() {
      try {
        mdns.removeListener("query", onQuery);
        mdns.destroy();
      } catch {
        // 退出阶段销毁失败无碍。
      }
    },
  };
}

module.exports = { startMdnsResponder, getLanIPv4, MDNS_SHORT_HOST };
