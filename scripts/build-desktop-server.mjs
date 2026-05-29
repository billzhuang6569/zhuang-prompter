import { rm } from "node:fs/promises";
import { build } from "esbuild";

await rm(".desktop", { force: true, recursive: true });

await build({
  entryPoints: ["server.ts"],
  outfile: ".desktop/server/server.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: false,
  external: ["next"],
  logLevel: "info",
});
