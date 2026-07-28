import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const productionTargets = Array.isArray(packageJson.browserslist)
  ? packageJson.browserslist
  : packageJson.browserslist?.production;

if (!Array.isArray(productionTargets)) {
  throw new Error("package.json does not define production browser targets.");
}

for (const requiredTarget of ["safari >= 15", "ios_saf >= 15"]) {
  if (!productionTargets.some((target) => String(target).toLowerCase() === requiredTarget)) {
    throw new Error(`Missing required browser target: ${requiredTarget}`);
  }
}

const chunksRoot = path.join(projectRoot, ".next", "static", "chunks");
const chunkFiles = await listJavaScriptFiles(chunksRoot);
if (chunkFiles.length === 0) {
  throw new Error("No Next.js client chunks found. Run `pnpm build` first.");
}

const incompatibleChunks = [];
for (const filePath of chunkFiles) {
  const source = await readFile(filePath, "utf8");
  const staticBlocks = source.match(/\bstatic\s*\{/g);
  if (staticBlocks) {
    incompatibleChunks.push({
      file: path.relative(projectRoot, filePath),
      classStaticBlockCount: staticBlocks.length,
    });
  }
}

if (incompatibleChunks.length > 0) {
  throw new Error(
    `Safari 15-incompatible class static blocks remain in client bundles:\n${JSON.stringify(incompatibleChunks, null, 2)}`,
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      browserTargets: productionTargets,
      checkedClientChunks: chunkFiles.length,
      classStaticBlocks: 0,
    },
    null,
    2,
  ),
);

async function listJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listJavaScriptFiles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(entryPath);
    }
  }

  return files;
}
