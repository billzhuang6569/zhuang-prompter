const base = process.env.M0_BASE_URL ?? "http://localhost:3000";

async function main() {
  const response = await fetch(`${base}/api/network-info`);
  if (!response.ok) {
    throw new Error(`network-info returned ${response.status}`);
  }

  const data = await response.json();
  const origins = Array.isArray(data.origins) ? data.origins : [];
  const local = origins.find((origin) => origin.kind === "local" && origin.origin === base);

  if (!Number.isInteger(data.port) || data.port <= 0) {
    throw new Error("network-info did not include a valid port.");
  }
  if (!local) {
    throw new Error("network-info did not include the localhost origin.");
  }
  for (const origin of origins) {
    if (typeof origin.label !== "string" || typeof origin.origin !== "string" || !origin.origin.startsWith("http://")) {
      throw new Error("network-info included an invalid origin.");
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        port: data.port,
        host: data.host,
        originCount: origins.length,
        lanCount: origins.filter((origin) => origin.kind === "lan").length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
