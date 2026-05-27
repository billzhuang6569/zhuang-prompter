# Milestone Task Breakdown

**Status**: Draft v0.1  
**Purpose**: Provide a stable development sequence after the handoff docs are accepted.

## M0: Room, Role, And Realtime Foundation

Goal: two browser windows can join one room and hold a shared room state.

Tasks:

- Create room API.
- Join room API.
- Device ID and session ID handling.
- WebSocket `client.hello` / `server.welcome`.
- Role selection and `role.set`.
- RoomState snapshot and roomRevision/serverSeq.
- Device heartbeat and presence.

Acceptance:

- One control and one player join same room.
- Role switching preserves device identity.
- Device list shows online/offline.
- Refresh/reconnect handshake can fetch full room state. Weak-network replay and 10-minute stability are M5.

## M1: Markdown Parse And Player Rendering

Goal: same Markdown renders predictably in control preview and player display.

Tasks:

- Implement ScriptEngine parser facade.
- Support P0 Stage Cue and Marker syntaxes.
- Generate RenderBundle.
- Generate speechText, markerIndex, scrollAnchorIndex.
- Player formal display with CJK line breaking and safe area.
- Parse warning display for duplicate marker and invalid extension syntax.

Acceptance:

- Required fixture from `docs/02_markdown-extension-spec.md` passes.
- Stage Cue / Marker rendering matches contract.
- Marker jump index exists even when markers are hidden.
- Speech text excludes cue/marker metadata.
- M1 cannot close until `05_markdown_rendering_contract.md` contract tests pass.

## M2: ScrollClock And Playback State Loop

Goal: control sends playback intent; player executes locally and reports facts.

Tasks:

- Define ScrollClock type in code.
- Apply ScrollClock on player with local time.
- Play/pause/speed/jump marker controls.
- Player `playback.reportState`.
- Control UI states for sent/acked/reported.
- Manual player scroll reporting.
- Drift detection.

Acceptance:

- Play, pause, speed, and marker jump work in two-window local test.
- Old sequence/revision does not override newer state.
- Player report updates control preview/status.
- Remote mode does not rely on per-frame scroll broadcast.

## M3: Versioning

Goal: shooting-site edits are recoverable.

Tasks:

- ScriptDraft storage.
- Manual ScriptVersion save.
- Version message.
- Version list.
- Text diff.
- Marker/stage cue diff visibility.
- Restore as current draft.
- Re-anchor playback after version switch.

Acceptance:

- Save under 10 seconds.
- Restore creates new draft without deleting history.
- Current draft and saved version are distinguishable.
- Old ScrollClock does not apply blindly after version switch.

## M4: Voice Following

Goal: one active voice source can help advance player safely.

Tasks:

- Voice source selection.
- Microphone permission flow.
- ASR adapter interface.
- `voice.transcript` and `voice.matchResult`.
- Spoken index matching near current anchor.
- Confidence levels.
- Smooth player advancement from high-confidence match.
- Manual takeover cooldown and relock.
- Permission/ASR/network fallback.

Acceptance:

- Only one active voice source.
- Partial transcript does not jump playback.
- High-confidence nearby final transcript can advance.
- Low confidence holds.
- Manual scroll/pause/jump pauses voice auto-advance.

## M5: Reliability, Performance, And Acceptance

Goal: prove this can survive a real 10-minute shooting session.

Tasks:

- Weak network/reconnect handling.
- Full room state resync.
- Event replay or full snapshot fallback.
- Player disconnect visual hint.
- Control drift prompt.
- Browser compatibility passes for Chrome desktop, Safari desktop, iPad Safari.
- 10-minute sync test.
- Test report and known limitation list.

Acceptance:

- Player never clears content during disconnect.
- Reconnect restores version/config/ScrollClock.
- 10-minute local and remote-style sessions complete.
- Known P1/P2 items are not mixed into P0 acceptance.

## First Sprint Recommendation

Do not start with full UI polish. Start with these slices:

1. `RoomState + WebSocket hello + role.set`
2. `ScriptEngine.parse(markdown) -> RenderBundle`
3. `PlayerStage renders RenderBundle`
4. `ScrollClock -> player local scroll -> playback.reportState`

These four slices make the core product truth visible early.
