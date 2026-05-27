# 庄Sir 的提词器

This is the formal code repository for the online shooting teleprompter room.

Before changing product behavior, read the handoff package first:

- `dev-handoff/README_developer_start_here.md`
- `dev-handoff/09_milestone_task_breakdown.md`
- `dev-handoff/10_cross_review_gate.md`

The original product documents are preserved in `docs/`.

## Current Milestone

M0 only: room creation, room join, role selection, WebSocket hello/welcome, RoomState snapshot, and device presence.

Do not implement Markdown rendering, ScrollClock playback, versioning, or voice following in M0.

## Getting Started

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm smoke:m0
```

Run `pnpm smoke:m0` while `pnpm dev` is running.
