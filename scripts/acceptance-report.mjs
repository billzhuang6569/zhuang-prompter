import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

const checks = [
  { name: "contract tests", command: "pnpm", args: ["test:contracts"] },
  { name: "lint", command: "pnpm", args: ["lint"] },
  { name: "typecheck/build", command: "pnpm", args: ["typecheck"] },
];

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ code, output, durationMs: Date.now() - startedAt });
    });
  });
}

async function runSmokeWithServer() {
  const server = spawn("pnpm", ["dev"], { stdio: ["ignore", "pipe", "pipe"] });
  let serverOutput = "";
  server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });

  const ready = await waitForServer(server);
  if (!ready) {
    server.kill();
    return [{ name: "dev server", code: 1, durationMs: 0, output: serverOutput || "Server did not become ready." }];
  }

  const smokeChecks = [];
  for (const script of [
    "smoke:network",
    "smoke:m0",
    "smoke:m2",
    "smoke:m3",
    "smoke:m4",
    "smoke:m5:reconnect",
    "smoke:m5:session",
  ]) {
    const result = await run("pnpm", [script]);
    smokeChecks.push({ name: script, ...result });
  }
  server.kill();
  return smokeChecks;
}

function waitForServer(server) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 15_000);
    function inspect(chunk) {
      if (chunk.toString().includes("Zhuang Prompter ready")) {
        clearTimeout(timeout);
        resolve(true);
      }
    }
    server.stdout.on("data", inspect);
    server.stderr.on("data", inspect);
  });
}

function summarize(check) {
  return `| ${check.name} | ${check.code === 0 ? "PASS" : "FAIL"} | ${Math.round(check.durationMs / 1000)}s |`;
}

async function main() {
  const results = [];
  for (const check of checks) {
    results.push({ name: check.name, ...(await run(check.command, check.args)) });
  }
  results.push(...(await runSmokeWithServer()));

  const ok = results.every((result) => result.code === 0);
  const body = `# Local Acceptance Report

Generated: ${new Date().toISOString()}

Overall: ${ok ? "PASS" : "FAIL"}

| Check | Result | Duration |
| --- | --- | --- |
${results.map(summarize).join("\n")}

## Scope Covered

- M0 room, role, device identity, presence.
- Local network entry discovery for same-Wi-Fi device testing.
- M1 Markdown RenderBundle contract.
- M2 ScrollClock play, pause, nudge intent, and PlaybackState report loop.
- M3 draft save, version save, list, restore, and room broadcast without deleting history.
- M4 active voice source, transcript match, and voice-assisted speed adjustment.
- M5 reconnect full-state recovery and configurable stability session.

## Remaining Before Full Real-Session Acceptance

- Browser-operated 10-minute shooting session.
- Safari desktop and iPad Safari visual/device pass.
- Real weak-network observation beyond automatic client retry and local reconnect smoke.
`;

  await writeFile("local-acceptance-report.md", body);
  console.log(body);

  if (!ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
