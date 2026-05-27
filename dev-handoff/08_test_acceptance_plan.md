# Test And Acceptance Plan

**Status**: Draft v0.1  
**Purpose**: Define evidence required before implementation is considered usable for MVP.

## Acceptance Gates

The MVP is not accepted because screens render. It is accepted only when these room workflows pass:

- Create/join/select role works.
- Same Markdown produces stable control preview and player output.
- ScrollClock drives player local execution.
- Player reports observed state and control UI displays it.
- Version save/diff/restore works without deleting history.
- Voice following advances only when confidence is sufficient.
- Disconnect never clears player screen.

## P0 Browser Targets

Acceptance target:

- Chrome desktop.
- Safari desktop.
- iPad Safari.

Compatibility observation:

- iPhone Safari.
- Android Chrome.

## Required Fixtures

Use the complete example from `docs/02_markdown-extension-spec.md` as the required parser/render fixture.

Additional fixtures:

- Long CJK script with punctuation.
- Mixed CJK/English terms such as `Final Cut Pro`, `API`, `GPU`, `AI agent`.
- Long URL and long English token.
- Duplicate marker ID.
- Script with no markers.
- Script with only headings and paragraphs.

## Room And Role Tests

- Create room returns room code, room ID, device ID, join token, and WS URL.
- Join room validates room code and returns room state.
- Role can be set to `control` or `player`.
- Switching role preserves room and device identity.
- Closed/nonexistent room produces clear error.

## Markdown Contract Tests

- Bound Stage Cue renders spoken text plus cue line.
- Standalone Stage Cue renders cue and does not enter speech text.
- Block Stage Cue renders multi-line cue and does not enter speech text.
- Independent Marker enters marker index and jump list.
- Inline Marker renders but navigation prefers independent marker.
- Duplicate marker ID becomes parse warning.
- Marker hidden in display remains available for jump.
- Stage Cue hidden in display does not change speech index.

## ScrollClock And Playback Tests

- Play sends ScrollClock and player starts local scrolling.
- Pause sends paused ScrollClock and player reports final position.
- Speed change creates a new ScrollClock.
- Jump marker resolves by marker ID.
- Old sequence/revision is ignored.
- Cross-version ScrollClock is rejected or frozen until relocation.
- Player reports every 250-500ms during play.
- Player reports immediately on pause, jump, manual scroll, and reconnect.

## Sync And Drift Tests

- Control UI distinguishes sent, acked, and player-reported state.
- Player manual scroll in manual mode updates control position.
- Player manual scroll in fixed-speed mode is shown as drift unless accepted.
- Version mismatch shows highest-priority warning.
- Position drift over threshold shows drift prompt.
- "Sync to player" sends a corrective ScrollClock.
- "Use player as truth" accepts observed state.

## Version Tests

- Save version stores Markdown, display config snapshot, marker snapshot, author, timestamp, and message.
- Version list shows time/message/diff summary.
- Diff identifies text add/delete/change and marker/stage cue changes.
- Restore creates new current draft.
- Restore does not delete historical versions.
- Current draft and current playing version are distinguishable.

## Voice Following Tests

- Only one active voice source is allowed.
- Non-active devices do not request microphone.
- Permission denied keeps the device usable as normal player/control.
- Partial transcript displays but does not cause large advancement.
- Final transcript with high confidence advances near current anchor.
- Low confidence does not advance.
- Matching searches nearby first and does not jump across distant sections.
- Manual pause/scroll/jump enters cooldown.
- Re-lock happens near manual takeover position.
- Stage Cue and Marker metadata do not match as speech text.

## Disconnect And Recovery Tests

- Player disconnect does not clear text.
- Player may continue local scrolling if it has valid ScrollClock.
- Control device list shows offline/reconnecting and last sync time.
- Reconnect uses same `deviceId` with new `sessionId`.
- Reconnect restores script version, display config, ScrollClock, and reports PlaybackState.
- If replay window is missed, full room state sync works.
- Server restart restores durable room snapshot and waits for devices to reconnect.

## Performance Targets

| Metric | Target |
| --- | --- |
| Entry to playback | Under 60 seconds in normal flow |
| Local extension-screen response | p95 <= 150ms from server ack to player report for play/pause/speed |
| Player state report while playing | 250-500ms interval |
| WebSocket offline marker | 30s without response |
| Version save | Under 10 seconds from click to saved state |
| Version restore discovery | User can find and restore within 30 seconds |
| 10-minute session | No screen clear, no unhandled disconnect, no uncontrolled jump |

## Non-Acceptance Triggers

- Player clears screen on disconnect.
- Control UI shows only optimistic local state and hides player-reported reality.
- Remote manual scroll is implemented as unthrottled per-wheel-event broadcast.
- Voice match can jump from one distant section to another on low confidence.
- Markdown parser makes Stage Cue / Marker text part of speech matching.
- Restore overwrites or deletes version history.
- New version reuses old pixel offset without anchor relocation.

## Protocol-Level Tests

- Duplicate `eventId` returns the same ack result.
- Duplicate `deviceId + sessionId + clientSeq` is ignored or acked as duplicate.
- `serverSeq` gap triggers `room.resyncRequest`.
- Replay window miss returns full `room.state`.
- HTTP version save broadcasts version change after durable save.
- `STALE_SCRIPT_VERSION` freezes playback intent and starts anchor relocation.

## Visual And Device Tests

- CJK punctuation does not start a rendered line in the required fixture.
- Protected English phrases prefer not to split across lines when space allows.
- Long URL does not overflow safe area.
- iPad Safari font fallback triggers anchor remeasurement.
- Player text mirrors when mirror is on.
- Control preview is not mirrored by default.
- Overlay controls and exit fullscreen button are not mirrored.
- iPad Safari fullscreen fallback shows a usable immersive-mode prompt.

## Voice Fixture Tests

Use deterministic transcript fixtures for:

- `locked`: nearby final transcript with confidence >= 0.85 creates ScrollClock.
- `probable`: confidence 0.65-0.84 only permits small correction in current viewport.
- `uncertain`: confidence 0.40-0.64 displays transcript but does not advance.
- `lost`: confidence < 0.40 prompts manual takeover.
- Distant section match with high text overlap is rejected unless user has jumped nearby.
- Manual takeover blocks auto-advance for 2-5 seconds.
