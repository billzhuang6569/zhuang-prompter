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

// electron-builder passes context.arch as the numeric app-builder-lib Arch enum:
// ia32=0, x64=1, armv7l=2, arm64=3, universal=4. Map to the node arch tokens used
// in package.json `cpu` fields.
const ARCH_ENUM = { 0: "ia32", 1: "x64", 2: "arm", 3: "arm64", 4: "universal" };

// npm `os`/`cpu` matching, honoring `!negation` entries. An absent/empty list means
// "any". Used to keep only the platform-specific optional deps (e.g. @next/swc-*,
// @img/sharp-*) that match the TARGET arch/os — never the build host's.
function listMatches(list, value) {
  if (!Array.isArray(list) || list.length === 0) return true;
  const negations = list.filter((entry) => typeof entry === "string" && entry.startsWith("!"));
  if (negations.length) return !negations.some((entry) => entry.slice(1) === value);
  return list.includes(value);
}

function archMatches(meta, targetCpu, targetOs) {
  return listMatches(meta.cpu, targetCpu) && listMatches(meta.os, targetOs);
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
  const targetOs = electronPlatformName; // "darwin" | "win32" | "linux"
  const targetCpu = ARCH_ENUM[context.arch] ?? "x64";
  const isUniversal = targetCpu === "universal";
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
  const closure = []; // { logical, real, cpu, os }

  while (queue.length) {
    const { name, from } = queue.pop();
    const resolved = resolvePkg(name, from, projectDir);
    if (!resolved) continue; // optional/absent dep — skip
    if (seen.has(resolved.real)) continue;
    seen.add(resolved.real);
    let meta;
    try {
      meta = readJson(path.join(resolved.real, "package.json"));
    } catch {
      closure.push({ ...resolved, cpu: undefined, os: undefined });
      continue;
    }
    closure.push({ ...resolved, cpu: meta.cpu, os: meta.os });
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
  // A closure member is WANTED in this build only if its declared cpu/os match the
  // TARGET (not the build host). Cross-builds (mac/x64 on the arm64 runner, win/arm64
  // on the x64 runner) otherwise ship a wrong-arch @next/swc / sharp .node and the
  // local server never boots. Universal builds want everything.
  const wanted = (entry) => isUniversal || archMatches(entry, targetCpu, targetOs);

  let copied = 0;
  let stripped = 0;
  const relOf = (logical) => path.relative(projectNodeModules, logical);
  for (const entry of closure) {
    const dest = path.join(appNodeModules, relOf(entry.logical));
    if (wanted(entry)) {
      if (fs.existsSync(path.join(dest, "package.json"))) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(entry.real, dest, { recursive: true, dereference: true });
      copied += 1;
    } else if (fs.existsSync(dest)) {
      // electron-builder's collector may have copied a wrong-arch optional dep in;
      // remove it so the app contains only the target arch's native binaries.
      fs.rmSync(dest, { recursive: true, force: true });
      stripped += 1;
    }
  }

  console.log(
    `  • ensure-app-deps  closure=${closure.length} copied=${copied} stripped=${stripped} target=${targetOs}/${targetCpu}`
  );

  // Hard gate 1: every WANTED closure member must now be materialized at its
  // mirrored path. (Wrong-arch members are intentionally absent, so they are not
  // required here.) Because the source tree runs correctly, a fully materialized
  // mirror of the target-arch closure is guaranteed runtime-complete.
  const unmaterialized = closure
    .filter(wanted)
    .filter(({ logical }) => !fs.existsSync(path.join(appNodeModules, relOf(logical), "package.json")))
    .map(({ logical }) => relOf(logical));

  // Hard gate 2: each critical package must appear somewhere in the closure —
  // guards against the closure walk itself missing a required dependency edge.
  const closureNames = new Set(closure.map(({ logical }) => path.basename(logical)));
  const missingCritical = CRITICAL.filter((name) => !closureNames.has(name));

  // Hard gate 3: the packaged app MUST contain a @next/swc native binding whose
  // cpu/os match the TARGET, with its .node on disk. The Next.js production server
  // loads this at boot; a wrong-arch or absent binding is exactly what made the
  // 0.1.11 Intel/win-arm64 cross-builds hang and fail waitForServer ("The local
  // server did not start in time"). Skipped for linux/universal (not shipped here).
  let swcProblem = null;
  if (!isUniversal && (targetOs === "darwin" || targetOs === "win32")) {
    const nextScope = path.join(appNodeModules, "@next");
    let ok = false;
    if (fs.existsSync(nextScope)) {
      for (const name of fs.readdirSync(nextScope)) {
        if (!name.startsWith("swc-")) continue;
        const pkgDir = path.join(nextScope, name);
        let m;
        try {
          m = readJson(path.join(pkgDir, "package.json"));
        } catch {
          continue;
        }
        if (!archMatches(m, targetCpu, targetOs)) continue;
        const hasNode = fs
          .readdirSync(pkgDir)
          .some((f) => f.endsWith(".node"));
        if (hasNode) {
          ok = true;
          break;
        }
      }
    }
    if (!ok) {
      swcProblem = `no @next/swc-* native binding for target ${targetOs}/${targetCpu} found in packaged app (with a .node file)`;
    }
  }

  if (missingCritical.length || unmaterialized.length || swcProblem) {
    const parts = [];
    if (missingCritical.length) {
      parts.push(`critical deps absent from source closure: ${missingCritical.join(", ")}`);
    }
    if (unmaterialized.length) {
      const shown = unmaterialized.slice(0, 10).join(", ");
      const more = unmaterialized.length > 10 ? ` (+${unmaterialized.length - 10} more)` : "";
      parts.push(`failed to materialize ${unmaterialized.length} package(s) in app: ${shown}${more}`);
    }
    if (swcProblem) {
      parts.push(
        `${swcProblem}. Install cross-arch optional deps before packaging (supportedArchitectures in pnpm-workspace.yaml)`
      );
    }
    throw new Error(
      `ensure-app-deps: ${parts.join("; ")}. Source node_modules at ${projectNodeModules} is incomplete or wrong-arch — install with nodeLinker: hoisted + supportedArchitectures and retry.`
    );
  }
};
