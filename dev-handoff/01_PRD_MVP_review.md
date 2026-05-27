# PRD MVP Review

**Status**: Draft v0.1  
**Sources**: `docs/00_productdesign.md`, `docs/01_prd.md`, `docs/02_markdown-extension-spec.md`

## Confirmed Product Direction

- MVP is a two-side collaborative teleprompter room, not a single-user scrolling page, not a generic editor, and not a subtitle workstation.
- The control side organizes script, versions, style, playback intent, and现场调度.
- The player side renders clean teleprompter output, executes local scrolling, supports local/manual/voice advancement, and reports real state.
- The room synchronizes facts: script version, display config, ScrollClock, PlaybackState, VoiceState, and device state.

## P0 Boundary

P0 must prove these chains end to end:

- Create room, join room, choose `control` or `player`.
- Paste/edit Markdown and render the supported Stage Cue / Cue Marker syntax.
- Send ScrollClock from control side and execute local scrolling on player side.
- Report player position, speed, state, version, and device status back to the control side.
- Save manual snapshots, list versions, diff current draft against a saved version, and restore a version as a new draft.
- Select one active voice source, show real-time transcript, match nearby spoken text, advance safely, and allow manual takeover.
- Keep the player display visible during disconnect and restore room state after reconnect.

## P0 Scope Decisions

| Area | Decision |
| --- | --- |
| Multi-device | P0 proves `1 control + 1 primary player`. Multiple players may join if cheap, but per-player control and multi-player dashboard depth stay P1. |
| Voice | P0 means one active voice source, transcript display, nearby matching, confidence gate, and manual takeover. It does not mean final subtitle-grade accuracy. |
| Markdown | P0 supports the 4 recommended syntaxes in `docs/02_markdown-extension-spec.md`: bound Stage Cue, standalone Stage Cue, retake Marker, section Marker. |
| LLM typography check | Not P0. P0 may show deterministic Markdown syntax warnings only. LLM suggestions, term library, and confirm/apply flow are P1. |
| Import/export | P0 supports paste/edit/save Markdown internally. `.md` import/export is P1 unless trivial. |
| Versions | P0 supports manual Snapshot, list, text diff, marker/stage cue change visibility, and restore-as-current-draft. No branches, merge, approval, or auto-versioning. |
| Reconnect | P0 means player does not clear the screen, then restores script/config/playback state. It does not promise precise control while fully offline. |
| Remote manual scroll | P0 does not promise remote pixel-perfect wheel follow. It validates play/pause/speed/jump/status feedback. |

## Non-Goals Locked For MVP

- No observer view.
- No director-only view.
- No standalone phone remote view.
- No multi-user simultaneous editing.
- No live-broadcast safe edit horizon.
- No full account/team/commercial system.
- No video recording suite.
- No subtitle export or NLE project export.
- No AI script writing or rewriting.

## Open-Gate Product Questions Resolved As Defaults

- **Room persistence**: P0 rooms are shooting sessions that survive refresh/reconnect. They are not a project library.
- **Browser priority**: P0 acceptance targets Chrome desktop, Safari desktop, and iPad Safari. iPhone Safari and Android Chrome are compatibility observation targets.
- **Primary state model**: control side owns script/config intent; player side owns observed playback facts; room confirms shared state.
- **Voice fallback**: if microphone or ASR is unavailable, the device remains usable as a normal control/player side.

## Development Gate

Before full P0 sprint planning, freeze:

- Minimum event set: `room.create`, `room.join`, `role.set`, `script.updateDraft`, `script.saveVersion`, `script.restoreVersion`, `display.updateConfig`, `playback.setScrollClock`, `playback.reportState`, `device.heartbeat`.
- Canonical realtime event names use dot notation, for example `playback.setScrollClock`. Colon notation in upstream PRD is conceptual and not canonical for implementation.
- ScrollClock fields: `scrollClockId`, `scriptVersionId`, `state`, `controlMode`, `anchor`, `offsetPx`, `velocityPxPerSecond`, `issuedAt`, `sourceDeviceId`, `roomRevision`.
- Ordering fields are canonicalized as: `clientSeq` for one WebSocket session, `serverSeq` for broadcast replay, and `roomRevision` for accepted room facts. ScrollClock does not own a separate `sequence`.
- Markdown parser fixture: use the complete example from `docs/02_markdown-extension-spec.md`.
- Acceptance thresholds: local response target, heartbeat interval, offline threshold, reconnect behavior, and stale sequence behavior.

## Main Risks

| Risk | Default mitigation |
| --- | --- |
| Voice following grows too large | Keep P0 matching lightweight and confidence-gated. Do not chase subtitle accuracy. |
| Multi-player orchestration grows too large | Build one primary player loop first; keep deeper per-player operations P1. |
| Remote scroll expectation is too high | Product UI must say remote mode prioritizes stable player execution and state feedback. |
| P0/P1 conflict in docs | Treat this review as the engineering boundary until upstream PRD is updated. |
| Building UI before state model | Enforce the open-gate rules in `README_developer_start_here.md`. |
