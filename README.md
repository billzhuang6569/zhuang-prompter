# 庄Sir 的提词器

This is the formal code repository for the online shooting teleprompter room.

Before changing product behavior, read the handoff package first:

- `dev-handoff/README_developer_start_here.md`
- `dev-handoff/09_milestone_task_breakdown.md`
- `dev-handoff/10_cross_review_gate.md`

The original product documents are preserved in `docs/`.

## Current Milestone

M0 is implemented and M1 has started: room foundation, ScriptEngine parsing, RenderBundle contract tests, and shared control/player rendering demo are present.

Next milestone work should move toward M1 closure or M2 only after the handoff gates are satisfied. Do not implement ScrollClock playback, versioning, or voice following before their milestones.

## Getting Started

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test:contracts
pnpm smoke:m0
pnpm smoke:m2
pnpm smoke:m3
pnpm smoke:m4
pnpm acceptance:local
```

Run smoke tests while `pnpm dev` is running.
