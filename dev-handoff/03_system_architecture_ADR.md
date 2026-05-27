# System Architecture And ADR

**Status**: Draft v0.1  
**Architecture default**: Single app + modular domain layer + realtime sync channel.

## Recommended MVP Architecture

Use a modular monolith for MVP. Do not split into microservices before the room model, realtime protocol, and playback engine are proven.

```text
UI Views
  Control View
  Player View

Application Services
  Room Service
  Script Service
  Playback Service
  Version Service
  Voice Service

Domain
  Room
  Device
  ScriptDraft
  ScriptVersion
  DisplayConfig
  ScrollClock
  PlaybackState
  VoiceState

Infrastructure
  Realtime Transport
  Persistence
  Browser APIs
  Speech Provider
  LLM Provider
```

## Module Boundaries

### Room Sync

Owns:

- Room state.
- Command intake and state broadcast.
- Device heartbeat and presence.
- `roomRevision` and `serverSeq`.
- Current accepted ScrollClock.
- Observed playback states.

Does not own Markdown parsing, UI rendering, or ASR logic.

### Script Engine

Owns:

- Markdown parsing.
- Stage Cue and Cue Marker extension parsing.
- Speech text extraction.
- Marker index.
- Anchor index.
- Diff input preparation.

Does not own WebSocket sync or playback execution.

### Playback Engine

Owns:

- Applying ScrollClock.
- Local position calculation.
- Pause/resume/jump/speed changes.
- PlaybackState generation.
- Disconnect display holding.

The control preview may reuse this engine, but the player side is the authoritative executor.

### Voice Follow

Owns:

- Active voice source.
- Transcript intake.
- Nearby spoken-text matching.
- Confidence levels.
- Manual takeover cooldown.
- Match result output.

Keep it provider-adapted. Browser speech, cloud ASR, and local services should be swappable.

### Versioning

Owns:

- Manual snapshot save.
- Restore-as-new-draft.
- Text diff.
- Marker/stage cue change visibility.

It must not expose Git concepts to users.

## Key Architectural Decisions

### ADR-001: Use ScrollClock Instead Of Frame-By-Frame Scroll Sync

**Status**: Proposed

**Context**: Remote frame sync creates jitter, makes the player a dumb screen, and fails poorly during disconnects.

**Decision**: Sync ScrollClock intent. Player computes local scroll and reports PlaybackState.

**Consequences**:

- Easier: remote stability, disconnect holding, lower network pressure.
- Harder: needs sequence/revision handling, drift detection, and clear UI for confirmed vs optimistic state.

### ADR-002: Markdown Is The Only User Source Format

**Status**: Proposed

**Context**: Users paste/edit/export Markdown. Stage Cue and Cue Marker must be understandable in the source.

**Decision**: Store Markdown as source. Derive render tree, speech text, marker index, anchor index, and voice matching index at runtime.

**Consequences**:

- Easier: user mental model, version diff, portable script.
- Harder: parser quality and anchor recovery matter.

### ADR-003: Observed PlaybackState Wins Over Control Prediction

**Status**: Proposed

**Context**: The control side may send playback intent, but the real shooting fact is what the player screen is doing.

**Decision**: Separate desired state from observed playback state. Control UI shows player-confirmed facts when available.

**Consequences**:

- Easier: honest现场判断 and better recovery.
- Harder: UI must show sent/acknowledged/reported states.

### ADR-004: Control Organizes, Player Executes

**Status**: Proposed

**Context**: The product has only two views, but both can influence playback.

**Decision**:

- Control View organizes script, version, config, mode, and devices.
- Player View renders and executes local scrolling.
- Room Sync confirms shared facts.

**Consequences**:

- Easier: product mind model stays clear.
- Harder: player side needs stronger local state and recovery logic.

### ADR-005: MVP Uses Modular Monolith, Not Microservices

**Status**: Proposed

**Context**: The MVP must validate room, Markdown, ScrollClock, versions, voice following, and reconnect quickly.

**Decision**: Deploy as one app, but keep modules strict internally.

**Consequences**:

- Easier: faster development, simpler debugging, fewer consistency problems.
- Harder: requires discipline to prevent UI from bypassing domain services.

### ADR-006: One Active Voice Source Per Room

**Status**: Proposed

**Context**: Voice following decides where the speaker is in the script. Multiple simultaneous voice sources create conflicting position authority.

**Decision**: A room has at most one active voice source. The source may be control side or one player device.

**Consequences**:

- Easier: conflict handling and UI explanation.
- Harder: no multi-microphone fusion in MVP.

## First Technical Skeleton To Lock

Before UI-heavy work, implement or stub these contracts:

- `RoomState` aggregate.
- `ScrollClock` and `PlaybackState` as separate types.
- `ScriptEngine.parse(markdown)` returning render/speech/marker/anchor indexes.
- `PlaybackEngine.applyScrollClock(clock)` for local player execution.
- `RoomSync` command/event envelope.
- `VoiceState` with one active source.
- `Versioning` save and restore semantics.
