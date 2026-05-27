# Developer Start Here

**Status**: Draft v0.1  
**Date**: 2026-05-27  
**Upstream sources**: `docs/00_productdesign.md`, `docs/01_prd.md`, `docs/02_markdown-extension-spec.md`

This folder is the development handoff package for the online shooting teleprompter room. It does not replace the upstream product documents. It translates them into decisions that engineering, design, and QA can use before implementation starts.

## Core Model

This product is not a single-screen teleprompter and not a remote-controlled display.

The correct model is:

```text
Control side sends: script, config, version, playback intent
Player side executes: local rendering, local scrolling, local/remote voice following
Player side reports: real position, playback state, device state
Room confirms: the shared current fact
```

Do not synchronize every scroll frame. The room synchronizes state, config, version, intent, and observed facts.

## Reading Order

1. `01_PRD_MVP_review.md`  
   Locks P0/P1 boundaries and resolves scope conflicts in the current PRD.
2. `02_domain_state_model.md`  
   Defines Room, Device, ScriptDraft, ScriptVersion, ScrollClock, PlaybackState, VoiceState, and ownership rules.
3. `03_system_architecture_ADR.md`  
   Defines the modular architecture and key ADRs.
4. `04_realtime_event_protocol.md`  
   Defines HTTP/WebSocket responsibilities, event envelope, ack/nack, sequence, and recovery.
5. `05_markdown_rendering_contract.md`  
   Defines Markdown runtime outputs, speech extraction, marker/cue indexes, and anchors.
6. `06_voice_following_design.md`  
   Defines voice source, ASR output, matching, confidence, manual takeover, and fallback.
7. `07_frontend_interaction_spec.md`  
   Defines control/player IA, playback UI states, drift, disconnect, and identity switching.
8. `08_test_acceptance_plan.md`  
   Defines acceptance scenarios and gates.
9. `09_milestone_task_breakdown.md`  
   Defines M0-M5 development sequence.
10. `10_cross_review_gate.md`  
   Records the cross-review result and the current development gate.

## Open-Gate Rules Before Product Coding

Do not start full P0 implementation until these are accepted:

- `02_domain_state_model.md`: state ownership and invariants are accepted.
- `04_realtime_event_protocol.md`: event envelope, ScrollClock, ack/nack, and reconnect behavior are accepted.
- `05_markdown_rendering_contract.md`: RenderBundle, speech extraction, marker index, and anchor index are accepted.
- `08_test_acceptance_plan.md`: the 10-minute sync test, reconnect test, and voice fallback tests are accepted.

Current gate after cross-review:

- M0 may start.
- M1 may start and close if the Markdown contract tests pass.
- Full P0 should still follow the M0-M5 sequence; do not skip straight to voice/reliability before M0-M2 are green.

## Recommended Frontend Routes

```text
/
  Room entry

/room/:roomCode/select-role
  Role selection

/room/:roomCode/control
  Control side

/room/:roomCode/player
  Player side
```

## Recommended Component Boundaries

```text
RoomEntry
RoleSelect

ControlShell
├─ RoomHeader
├─ ScriptEditorPanel
├─ LivePreviewPanel
├─ PlaybackControls
├─ DevicePanel
├─ DisplayConfigPanel
├─ VersionPanel
└─ VoicePanel

PlayerShell
├─ PlayerStage
├─ PlayerOverlayControls
├─ PlayerStatusToast
└─ PlayerPermissionGate
```

## State Priority

Developers should reason about state in this order:

1. Script content is owned by the control side.
2. Display config is owned by the control side.
3. The player side is the authority for its real playback position.
4. In fixed-speed mode, the control side is the main intent source.
5. In manual mode, control and player sides may both initiate position changes.
6. In voice-follow mode, the active voice source is the main position source.
7. UI should display the room-confirmed state, not just the local optimistic command.

## First Implementation Bias

Build the product in this order:

1. Room creation and join.
2. Role selection.
3. Control three-panel IA.
4. Player formal playback state.
5. Markdown rendering for Stage Cue and Cue Marker.
6. ScrollClock dispatch and player local scrolling.
7. Player state reporting.
8. Version save, diff, and restore.
9. Voice source selection and manual takeover.
10. Disconnect, reconnect, and drift states.

## Do Not Expand V1 Into

- Observer view.
- Director view.
- Separate phone remote view.
- Multi-user simultaneous editing.
- Live-broadcast safe edit horizon.
- Git concepts exposed to users.
- Complex player-side settings console.

First version should make the shooting room reliable enough to use on set, not make the feature list look large.
