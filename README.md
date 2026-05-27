# 庄Sir 的提词器

This is the formal code repository for the online shooting teleprompter room.

Before changing product behavior, read the handoff package first:

- `dev-handoff/README_developer_start_here.md`
- `dev-handoff/09_milestone_task_breakdown.md`
- `dev-handoff/10_cross_review_gate.md`

The original product documents are preserved in `docs/`.

## Current Milestone

P0 local foundation is implemented through M5:

- M0 room, role, device identity, presence, HTTP join, and WebSocket welcome.
- M1 Markdown RenderBundle parsing, speech/marker/anchor indexes, and control/player rendering.
- M2 ScrollClock playback intent and player PlaybackState report loop.
- M3 script draft save, version save/list, and restore.
- M4 simulated voice transcript matching and voice-follow ScrollClock handoff.
- M5 reconnect full-state recovery and configurable session stability smoke.

The remaining local acceptance gap is a longer human-operated shooting session plus device/browser passes.

## Getting Started

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

The dev server listens on the local network by default and prints LAN URLs in the terminal. For iPad or another device, create a room on the Mac, then use the room page's `同网设备加入` links or the printed LAN URL. Follow [docs/local-browser-acceptance.md](docs/local-browser-acceptance.md) for the manual pass.

The player route opens in shooting-first mode: the teleprompter stage fills the first screen, while device and debug panels remain below the stage. The player also has local-only stage controls for font size, fullscreen, and hiding the status overlay.

Control and player clients automatically retry the WebSocket connection after a transient disconnect, then rejoin with the latest known room revision.

Script draft, version save, and version restore actions broadcast the updated RoomState to connected room clients so the player can refresh without a manual reload.

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
pnpm smoke:m5:session:10min
pnpm acceptance:local
```

Run smoke tests while `pnpm dev` is running.
