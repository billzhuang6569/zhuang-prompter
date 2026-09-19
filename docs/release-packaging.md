# Release Packaging

This project ships in two forms:

- Source repository for developers.
- Desktop application packages for non-technical users.

## Desktop App Model

The Electron app starts the same local teleprompter server inside the desktop app, then opens the control UI in a native window.

- Control machine: Mac or Windows desktop app.
- Player devices: browser on the same local network using the player URL or QR code.
- Local data: saved under the user's app data folder, not inside the installed app.
- Microphone: works in the desktop control window because the app uses a local `localhost` origin.

## Local Build

```bash
pnpm install
pnpm dist:mac
```

On Windows:

```bash
pnpm install
pnpm dist:win
```

Generated files are written to `release/`.

## GitHub Release

Push a version tag to trigger the release workflow:

```bash
git tag v0.1.0
git push origin main --tags
```

The workflow builds four installers and attaches them to the GitHub Release: Apple Silicon Mac (arm64), Intel Mac (x64), Windows x64, and Windows arm64.

The Intel Mac (x64) installer is **cross-built on the arm64 `macos-latest` runner** via `electron-builder --mac --x64` with `CSC_IDENTITY_AUTO_DISCOVERY=false`. No Electron code changes are needed — the updater already selects the artifact by `process.arch`, so an Intel Mac naturally picks the `macos-x64` DMG.

## pnpm + electron-builder: the packaged dependency closure (critical)

The packaged app crashed on launch with `Error: Cannot find module 'ms'` on
**0.1.8, 0.1.9 AND 0.1.10** (architecture-independent — all four platforms). The
missing module is `ms`, a grandchild dep (`electron-updater → builder-util-runtime
→ debug → ms`) that electron-builder's dependency collector dropped from the
packaged `node_modules`. The drop set is broader than `ms` alone — 50+ packages
including deps the runtime genuinely needs (see "What must be in the packaged
node_modules" below).

There are **three** independent problems here; all must be handled.

### 1. The source `node_modules` must be flat/hoisted

Under pnpm's default *isolated* layout, transitive deps live under
`node_modules/.pnpm/` with only top-level symlinks; electron-builder's collector
mis-traverses it. Force a flat, npm-style tree — **and the config key depends on
the pnpm version, which is the trap:**

- **pnpm 11 (what CI uses → decides the shipped artifacts)** reads `nodeLinker`
  from `pnpm-workspace.yaml`, NOT from `.npmrc`:
  ```yaml
  # pnpm-workspace.yaml
  nodeLinker: hoisted
  # keep allowBuilds / ignoredBuiltDependencies — removing them makes pnpm 11
  # fail install with [ERR_PNPM_IGNORED_BUILDS]
  ```
- pnpm 10 (local dev default) reads `node-linker=hoisted` from `.npmrc`. We keep
  `.npmrc` too, but it does **not** affect CI. 0.1.9 changed only `.npmrc`,
  passed a local pnpm-10 build, and still shipped broken from CI's pnpm 11.

### 2. electron-builder's collector is non-deterministic even when hoisted — the afterPack repair

`nodeLinker: hoisted` is **necessary but NOT sufficient.** 0.1.10 had a correct
hoisted tree in both CI and local, yet CI's electron-builder *still* dropped `ms`
+ 50 packages during packaging while the identical local build kept them. The
collector's behavior is non-deterministic and could not be reproduced locally —
so we stopped trusting it and repair its output instead.

**`scripts/ensure-app-deps.cjs` (wired as `build.afterPack`)** runs after each
platform's app is packed, before the DMG/installer is built:

1. Recompute the full production closure from the project's own `node_modules`
   (which always runs correctly from source), using classic node resolution and
   **mirroring pnpm's nesting** — a package's private copy of a transitive dep
   lands at `<pkg>/node_modules/<dep>` so node resolves it inside the app exactly
   as from source (e.g. `electron-updater/node_modules/builder-util-runtime`).
2. Copy any closure member missing from the packaged app.
3. **Hard gate:** throw (fail the build) if any closure member is unmaterialized
   or a critical runtime dep (`ms`, `debug`, `builder-util-runtime`,
   `electron-updater`, `multicast-dns`, `next`, `react`, `react-dom`) is absent.
   A broken installer can no longer be produced silently.

The hook is idempotent and self-verifying, so it protects local `dist:*` builds
too — even a clean local pack was observed dropping ~6 packages that the hook
restored.

### 3. Cross-builds ship WRONG-ARCH native binaries — supportedArchitectures + arch-aware afterPack

**Symptom (0.1.11 Intel Mac + ARM64 Windows only):** the installed app opens a
window but the local server never boots; after ~30s `waitForServer` times out
with **"The local server did not start in time / 本机服务未能及时启动."** Apple
Silicon Mac and x64 Windows are unaffected. This is a *different* failure from
problems #1/#2 (which crashed all four platforms with `Cannot find module 'ms'`).

**Root cause.** Two of the four targets are **cross-built on a heterogeneous
runner**: Intel Mac (x64) on the arm64 `macos-latest`, ARM64 Windows on the x64
`windows-latest`. `pnpm install --frozen-lockfile` installs only the **runner
host arch** of platform-specific optional deps (`@next/swc-*`, `@img/sharp-*`).
So the x64 Mac app got `@next/swc-darwin-arm64` (an arm64 `.node`) with **no x64
build present**. At server boot the x64 Electron process (running as node) tries
to `dlopen` the arm64 SWC binding → it hangs → `waitForServer` times out. The
Next.js production server loads its SWC binding at startup, so a wrong-arch or
absent binding stalls the boot rather than throwing cleanly.

Problem #2's afterPack hook made this *worse*: being arch-blind, it re-copied the
arm64-only closure into the x64 app, actively reintroducing wrong-arch natives.

**Fix, two parts:**

1. **Install every target arch in the source tree.** `pnpm-workspace.yaml` adds:
   ```yaml
   supportedArchitectures:
     os: [current, darwin, win32]
     cpu: [current, x64, arm64]
   ```
   This materializes all darwin+win32 × x64+arm64 optional native binaries
   regardless of the build host, so the cross-build's target arch is on disk.
   ⚠️ It must live in `pnpm-workspace.yaml` (the CLI flag
   `--config.supportedArchitectures.cpu=x64` does **not** work) and `current`
   must be included. Changing this config triggers a node_modules purge prompt on
   the next install; CI's `pnpm install --frozen-lockfile` runs non-interactively
   (`CI=true`) and auto-proceeds — verified to install all 4 swc variants +
   both sharp darwin variants.

2. **Make `scripts/ensure-app-deps.cjs` arch-aware.** `context.arch` is the
   numeric app-builder-lib `Arch` enum (`ia32=0, x64=1, arm64=3, universal=4`);
   `context.electronPlatformName` is `darwin|win32|linux`. The hook now copies
   only closure members whose declared npm `cpu`/`os` match the TARGET (honoring
   `!negations`), **strips** wrong-arch members electron-builder may have
   included, and adds a **hard gate**: the packaged app must contain a
   `@next/swc-*` binding matching the target arch/os *with a `.node` on disk*, or
   the build fails. That gate would have caught this bug at package time.

**Verified locally:** the cross-built x64 Mac app contains ONLY x86_64 native
binaries (`swc-darwin-x64`, `sharp-darwin-x64`, no arm64 leftovers), and its
local server boots in ~6s under Rosetta returning HTTP 200 (the old build hung to
the 30s timeout).

### What must be in the packaged node_modules (and what need not)

`asar: false`, so packaged deps live at `Contents/Resources/app/node_modules/`
(no asar to extract). Only two consumers read from there at runtime:

- **The Electron main process** — `electron/*.cjs` externally `require()` only
  `electron-updater` (→ `builder-util-runtime` → `debug` → `ms`) and
  `multicast-dns`; everything else is a node built-in.
- **The desktop server bundle** — `scripts/build-desktop-server.mjs` esbuilds
  with `external: ["next"]`, so the app `require('next')` at runtime and needs
  `next` + `react` + `react-dom` and their closures on disk.

Renderer dependencies are webpack-bundled into `.next` and do **not** need to be
in the packaged `node_modules`. The afterPack closure walk starts from
`package.json` `dependencies`, which covers both consumers above.

### Pre-tag verification

**Always reproduce CI's exact pnpm version before tagging** — default pnpm 10
will not reveal problem #1:
```bash
CI=true corepack pnpm@11.1.0 install --frozen-lockfile   # expect exit 0 (CI=true auto-proceeds the purge prompt)
ls -d node_modules/ms node_modules/debug                 # problem #1: real dirs, not .pnpm symlinks
# problem #3: all four swc variants present (cross-arch installed)
ls -d node_modules/@next/swc-darwin-arm64 node_modules/@next/swc-darwin-x64 \
      node_modules/@next/swc-win32-arm64-msvc node_modules/@next/swc-win32-x64-msvc
```
The afterPack hard gates cover problems #2 and #3 automatically, but confirm the
packaged app after building (see `docs/RELEASE.md` step 4 for the DMG-mount
check). For the closure (all platforms):
```bash
APP="<mounted-or-built>/庄Sir的提词器.app/Contents/Resources/app/node_modules"
ls -d "$APP/ms" "$APP/electron-updater/node_modules/builder-util-runtime" \
      "$APP/next" "$APP/react" "$APP/multicast-dns"   # all must exist
```
For a cross-built package (Intel Mac / ARM64 Windows), also confirm the packaged
native binaries are the TARGET arch and there are no wrong-arch leftovers:
```bash
find "$APP/@next" "$APP/@img" -name '*.node' -exec file {} \;   # must be the target arch only
```

## Intel (x64) Mac installer packaging practice

The Intel Mac `.dmg` is the **fourth** target output format and is
**cross-built on the arm64 `macos-latest` runner** — there is no Intel runner and
none is needed:

- CI matrix carries a `mac/x64` entry alongside `mac/arm64`; both run on
  `macos-latest`. The x64 job runs `electron-builder --mac --x64` with
  `CSC_IDENTITY_AUTO_DISCOVERY=false` (unsigned).
- **No Electron code changes** are ever needed for Intel: the updater selects the
  artifact by `process.arch`, so an Intel Mac naturally downloads the `macos-x64`
  DMG and self-updates from it.
- The afterPack hook runs per-arch and is **arch-aware** (see problem #3 above):
  the Intel app gets the closure repair plus only x64 native binaries, with the
  wrong-arch ones stripped and a hard gate requiring an x64 `@next/swc` `.node`.
- **The cross-build's target-arch native binaries must be installed in the source
  tree first** (`supportedArchitectures` in `pnpm-workspace.yaml`). `pnpm install`
  alone installs only the runner host arch — this is exactly what broke 0.1.11's
  Intel/ARM64-Windows builds ("The local server did not start in time"). There is
  no `@electron/rebuild` of these prebuilt bindings; they come from pnpm.
- The Intel DMG that reaches the 编导/director MUST be byte-identical to what the
  server and website serve. Do not hand out a locally-rebuilt DMG: take the exact
  artifact from the tagged CI run (`gh run download … desktop-mac-x64`), pass it
  through `scripts/prepare-public-release.mjs` + `SHA256SUMS`, and share **that**
  file with its `shasum -a 256`. The website's `macos-x64.dmg` download alias is
  a hardlink to the same file, so the hashes match by construction.
- Cross-built Intel binaries cannot be launch-tested on an arm64 CI host or an
  Apple-Silicon dev machine; Intel launch/in-app-update is verified by a human on
  real Intel hardware. The afterPack hard gate is what guarantees the closure is
  complete without a live Intel launch in the pipeline.

## Signing Status

The first public release is unsigned.

- macOS may show a Gatekeeper warning. Users can open it from System Settings > Privacy & Security or right-click > Open.
- Windows may show a SmartScreen warning. Users can choose "More info" > "Run anyway".

Code signing and notarization can be added later without changing the app architecture.

## Local Mac installation

Run `npm run install:mac -- --dry-run` to inspect the destination, then `npm run install:mac` after closing the app. It builds the current source, installs one copy in `/Applications/庄Sir的提词器.app`, archives the previous installed version under `release/backups.noindex`, and removes only old bundles with the exact app identifier from this project's release directories. Application data stays in its existing user-data folder. Compressed release archives are retained. The build staging directory is excluded from Spotlight. This installs the current checkout; it does not fetch or automatically publish releases.

## Reading synchronization

The primary display reports a normalized spoken-text character offset and a fraction of the current line at its viewport center. The controller maps that position to its editor DOM; guide dragging sends the same semantic anchor back. Font or viewport reflow preserves that anchor. Do not substitute total-height ratios or fixed paragraph heights. Voice matching supplies text positions; only the effective primary display adjusts the clock using actual layout. A manual pause must never be resumed by ASR callbacks.

Players can bookmark `http://<control-machine>:<port>/join` and enter a room number. This remains a LAN service; the computer address may change when switching networks.
