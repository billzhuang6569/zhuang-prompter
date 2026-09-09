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

The workflow builds macOS and Windows packages and attaches them to the GitHub Release.

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
