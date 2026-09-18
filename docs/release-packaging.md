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

There are **two** independent problems here; both must be handled.

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
corepack pnpm@11.1.0 install --frozen-lockfile   # expect exit 0
ls -d node_modules/ms node_modules/debug         # real dirs, not .pnpm symlinks
```
The afterPack hard gate covers problem #2 automatically, but confirm the packaged
app after building (see `docs/RELEASE.md` step 4 for the DMG-mount check):
```bash
APP="<mounted-or-built>/庄Sir的提词器.app/Contents/Resources/app/node_modules"
ls -d "$APP/ms" "$APP/electron-updater/node_modules/builder-util-runtime" \
      "$APP/next" "$APP/react" "$APP/multicast-dns"   # all must exist
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
- The afterPack hook runs per-arch, so the Intel app gets the same closure repair
  and hard gate as arm64. The `@electron/rebuild` step installs native deps for
  `arch=x64` correctly on the arm64 host.
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
