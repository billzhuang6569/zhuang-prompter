# 庄Sir 的提词器

Markdown-first teleprompter for recorded video production.

庄Sir 的提词器 lets one control computer manage a script while one or more player screens display the teleprompter on the same local network. It is designed for solo creators, small production teams, and script-heavy recording sessions.

## What It Does

- Create a local room for each shooting project.
- Edit a script in a friendly rendered Markdown editor.
- Add simple `marker` and `notes` directives for jump points and production cues.
- Open a player screen from a QR code or local network URL.
- Control play, pause, speed, start/end, marker jumps, mirror mode, and player display.
- Save local drafts and versions.
- Use experimental voice-assisted scrolling that adjusts playback while you speak.

## Who It Is For

- Creators recording talking-head videos.
- Teams that need one control screen and one teleprompter screen.
- Local/offline-first workflows where the script should stay on the control computer.

## Download

Use the latest GitHub Release:

[Releases](https://github.com/billzhuang6569/zhuang-prompter/releases)

The first release is unsigned. macOS and Windows may show standard security warnings the first time you open the app.

## Desktop App Usage

1. Open `庄Sir的提词器`.
2. Create or open a room.
3. Use the control window on the main computer.
4. Open the player URL or scan the QR code on another screen in the same local network.
5. Start playback from the control window.

The desktop app starts a local web server inside the app. Player devices join through your local network; there is no cloud account or server required.

## Local Network Notes

- Keep the control computer and player device on the same Wi-Fi or hotspot.
- The app prints and displays the player URL, usually like `http://192.168.x.x:3000/room/123456/player`.
- If another app already uses port `3000`, the desktop app will try nearby ports automatically.
- For browser-based development with microphone testing over LAN HTTPS, see [docs/local-network-usage.md](docs/local-network-usage.md).

## Data Storage

Room data, drafts, versions, and display settings are stored locally.

- Development mode: `.local-data/rooms.json`
- Desktop app: the operating system app-data folder

No database or cloud service is required for the current local-first release.

## Development

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

For trusted local HTTPS during development:

```bash
brew install mkcert
pnpm cert:trust
pnpm dev:https
```

## Build Desktop Packages

macOS:

```bash
pnpm dist:mac
```

Windows:

```bash
pnpm dist:win
```

Build output is written to `release/`.

More details: [docs/release-packaging.md](docs/release-packaging.md)

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test:contracts
pnpm smoke:network
pnpm smoke:m0
pnpm smoke:m2
pnpm smoke:m3
pnpm smoke:m4
pnpm smoke:m5:reconnect
pnpm smoke:m5:session
pnpm acceptance:local
```

Run smoke tests while the local server is running.

## Project Documents

Development handoff documents live in `dev-handoff/`.

Original product documents live in `docs/`.

## License

MIT
