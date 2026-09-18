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

## pnpm + electron-builder: transitive deps MUST be hoisted (critical)

Under pnpm's default *isolated* `node_modules` layout, transitive dependencies live deep in `node_modules/.pnpm/` with only symlinks at the top level. electron-builder's dependency collector does not traverse this correctly and **silently drops** grandchild deps — notably `ms` (a child of `debug`, itself pulled in by `electron-updater → builder-util-runtime`). The packaged app then crashes on launch with `Error: Cannot find module 'ms'`. This bit **0.1.8 and 0.1.9** on all four platforms (the bug is architecture-independent). It is a well-known electron-builder limitation (issue #6289 and friends).

**Fix: force a flat, npm-style `node_modules` so the collector sees every dep. The config location depends on the pnpm version — this is the trap:**

- **pnpm 11 (what CI uses, so this is what decides the shipped artifacts)** reads `nodeLinker` from `pnpm-workspace.yaml`, NOT from `.npmrc`:
  ```yaml
  # pnpm-workspace.yaml
  nodeLinker: hoisted
  # keep the existing allowBuilds / ignoredBuiltDependencies — removing them
  # makes pnpm 11 fail install with [ERR_PNPM_IGNORED_BUILDS]
  ```
- pnpm 10 (local dev default) reads `node-linker=hoisted` from `.npmrc`. We keep `.npmrc` too, but it does **not** affect CI. 0.1.9 changed only `.npmrc`, passed on a local pnpm-10 build, and still shipped broken from CI's pnpm 11.

**Always reproduce CI's exact pnpm version before tagging** — a local `pnpm install` with the default pnpm 10 will not reveal the problem:
```bash
corepack pnpm@11.1.0 install --frozen-lockfile   # expect exit 0
ls -d node_modules/ms node_modules/debug         # expect real dirs, not .pnpm symlinks
```
After building, verify the packaged app actually contains `ms` (this project sets `asar: false`, so look directly under `resources/app/node_modules/ms`; there is no asar to extract). See `docs/RELEASE.md` step 4 for the DMG-mount check.

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
