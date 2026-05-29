import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { hostname, networkInterfaces } from "node:os";

const certDir = ".cert";
const keyFile = `${certDir}/local-key.pem`;
const certFile = `${certDir}/local-cert.pem`;
const shouldInstallCa = process.argv.includes("--install-ca");

function getLanAddresses() {
  const addresses = new Set();
  for (const items of Object.values(networkInterfaces())) {
    for (const item of items ?? []) {
      if (item.family === "IPv4" && !item.internal) {
        addresses.add(item.address);
      }
    }
  }
  return Array.from(addresses).sort();
}

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}

function tryRun(command, args) {
  try {
    execFileSync(command, args, { stdio: "inherit" });
    return true;
  } catch {
    return false;
  }
}

try {
  execFileSync("mkcert", ["-version"], { stdio: "ignore" });
} catch {
  console.error("mkcert is not installed. On macOS, install it with: brew install mkcert");
  process.exit(1);
}

const lanAddresses = getLanAddresses();
const localHostname = hostname();
const names = Array.from(
  new Set(["localhost", "127.0.0.1", "::1", localHostname, `${localHostname}.local`, ...lanAddresses]),
);

mkdirSync(certDir, { recursive: true });
const trusted = shouldInstallCa ? tryRun("mkcert", ["-install"]) : false;
run("mkcert", ["-key-file", keyFile, "-cert-file", certFile, ...names]);

writeFileSync(
  `${certDir}/local-hosts.json`,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      keyFile,
      certFile,
      names,
      trusted,
    },
    null,
    2,
  )}\n`,
);

console.log(`Local HTTPS certificate ready: ${certFile}`);
if (!trusted) {
  console.log("If you have not already trusted the local CA, run this once in a normal Terminal window:");
  console.log("pnpm cert:trust");
}
