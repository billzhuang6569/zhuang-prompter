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
