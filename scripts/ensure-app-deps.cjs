/* eslint-disable @typescript-eslint/no-require-imports */
// electron-builder afterPack hook: guarantee the FULL production dependency
// closure is present inside the packaged app's node_modules.
//
// WHY THIS EXISTS
// ---------------
// electron-builder's own pnpm dependency collector is non-deterministic in CI:
// with an identical hoisted tree it silently drops a subset of transitive
// dependencies during packaging. On 0.1.8/0.1.9/0.1.10 this dropped `ms`
// (child of `debug`, pulled in by electron-updater -> builder-util-runtime),
// so the packaged app crashed on launch with `Cannot find module 'ms'`.
// The drop set is broader than `ms` alone (50+ packages) and includes deps
// the runtime genuinely needs: the desktop server is esbuild-bundled with
// `external: ["next"]`, so the app does `require('next')` at runtime and needs
// next + react + react-dom (and their closures) on disk too.
//
// The project's own node_modules (installed with nodeLinker: hoisted) is always
// complete and runtime-correct — the app runs from source with it. So instead
// of fighting electron-builder's collector, we recompute the production closure
// ourselves and copy any missing package into the packaged app, mirroring the
// project's node_modules layout so multi-version nesting stays correct. Finally
// we hard-assert a critical set is present and throw (failing the build) if not.
//
// This runs after the app is packed but before code signing / DMG creation, so
// a repaired app flows through the rest of the pipeline normally.

const fs = require("node:fs");
const path = require("node:path");

// Packages the MAIN process / bundled server require() at runtime. If any of
// these is missing after repair, the build MUST fail rather than ship broken.
const CRITICAL = [
  "electron-updater",
  "builder-util-runtime",
  "debug",
  "ms",
  "multicast-dns",
  "next",
  "react",
  "react-dom",
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// Classic node resolution walking node_modules dirs up to (and including) the
// project root. Returns { logical, real } or null. `logical` is where node will
// look (mirrored into the app); `real` is the actual on-disk content location.
function resolvePkg(name, fromDir, rootDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return { logical: candidate, real: fs.realpathSync(candidate) };
    }
    if (dir === rootDir) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const rootCandidate = path.join(rootDir, "node_modules", name);
  if (fs.existsSync(path.join(rootCandidate, "package.json"))) {
    return { logical: rootCandidate, real: fs.realpathSync(rootCandidate) };
  }
  return null;
}

exports.default = async function ensureAppDeps(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const projectDir = packager.projectDir || process.cwd();
  const projectNodeModules = path.join(projectDir, "node_modules");
  const rootPkg = readJson(path.join(projectDir, "package.json"));

  const productFilename = packager.appInfo.productFilename;
  const appRoot =
    electronPlatformName === "darwin"
      ? path.join(appOutDir, `${productFilename}.app`, "Contents", "Resources", "app")
      : path.join(appOutDir, "resources", "app");
  const appNodeModules = path.join(appRoot, "node_modules");

  if (!fs.existsSync(appNodeModules)) {
    fs.mkdirSync(appNodeModules, { recursive: true });
  }

  // BFS over the production closure (dependencies + optionalDependencies),
  // resolving each edge relative to the package that declares it so that
  // version-specific nesting is honored exactly as node would at runtime.
  const roots = Object.keys(rootPkg.dependencies || {});
  const seen = new Set(); // real dirs already visited
  const queue = roots.map((name) => ({ name, from: projectDir }));
  const closure = []; // { logical, real }

  while (queue.length) {
    const { name, from } = queue.pop();
    const resolved = resolvePkg(name, from, projectDir);
    if (!resolved) continue; // optional/absent dep — skip
    if (seen.has(resolved.real)) continue;
    seen.add(resolved.real);
    closure.push(resolved);
    let meta;
    try {
      meta = readJson(path.join(resolved.real, "package.json"));
    } catch {
      continue;
    }
    const deps = {
      ...(meta.dependencies || {}),
      ...(meta.optionalDependencies || {}),
    };
    for (const depName of Object.keys(deps)) {
      queue.push({ name: depName, from: resolved.logical });
    }
  }

  // Copy any closure member missing from the packaged app, mirroring its
  // logical path (relative to the project node_modules) into the app. The
  // logical path preserves pnpm's nesting (e.g. a package's own private copy of
  // a transitive dep under `<pkg>/node_modules/<dep>`), so node resolves each
  // dependency inside the app exactly as it does when running from source.
  let copied = 0;
  const relOf = (logical) => path.relative(projectNodeModules, logical);
  for (const { logical, real } of closure) {
    const dest = path.join(appNodeModules, relOf(logical));
    if (fs.existsSync(path.join(dest, "package.json"))) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(real, dest, { recursive: true, dereference: true });
    copied += 1;
  }

  console.log(
    `  • ensure-app-deps  closure=${closure.length} copied=${copied} platform=${electronPlatformName}`
  );

  // Hard gate 1: every closure member must now be materialized at its mirrored
  // path. Because the source tree runs correctly, a fully materialized mirror is
  // guaranteed runtime-complete.
  const unmaterialized = closure
    .filter(({ logical }) => !fs.existsSync(path.join(appNodeModules, relOf(logical), "package.json")))
    .map(({ logical }) => relOf(logical));

  // Hard gate 2: each critical package must appear somewhere in the closure —
  // guards against the closure walk itself missing a required dependency edge.
  const closureNames = new Set(closure.map(({ logical }) => path.basename(logical)));
  const missingCritical = CRITICAL.filter((name) => !closureNames.has(name));

  if (missingCritical.length || unmaterialized.length) {
    const parts = [];
    if (missingCritical.length) {
      parts.push(`critical deps absent from source closure: ${missingCritical.join(", ")}`);
    }
    if (unmaterialized.length) {
      const shown = unmaterialized.slice(0, 10).join(", ");
      const more = unmaterialized.length > 10 ? ` (+${unmaterialized.length - 10} more)` : "";
      parts.push(`failed to materialize ${unmaterialized.length} package(s) in app: ${shown}${more}`);
    }
    throw new Error(
      `ensure-app-deps: ${parts.join("; ")}. Source node_modules at ${projectNodeModules} is incomplete — install with nodeLinker: hoisted and retry.`
    );
  }
};
