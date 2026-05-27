# Domain And State Model

**Status**: Draft v0.1  
**Purpose**: Define the shared state language before implementation starts.

## Core Architecture Judgment

The room should not be modeled as "control side remotely controls player side." It should be modeled as:

```text
Control side organizes shooting facts.
Player side executes local playback.
Room sync confirms shared facts.
```

The center of the system is `RoomState`, not either UI.

## Core Types

```ts
type ControlMode = "fixedSpeed" | "manual" | "voiceFollow";
type DeviceRole = "control" | "player";
type PlaybackStatus = "playing" | "paused" | "frozen";
type FreezeReason =
  | "VERSION_MISMATCH"
  | "ANCHOR_NOT_FOUND"
  | "VOICE_SOURCE_LOST"
  | "RECONNECTING_HOLD"
  | "MANUAL_HOLD";
```

### Room

`Room` is a real-time collaboration boundary for one shooting teleprompter session.

```ts
type Room = {
  roomId: string;
  roomCode: string;
  status: "active" | "closed";
  currentScriptVersionId: string | null;
  currentDraftId: string | null;
  currentControlMode: ControlMode;
  displayConfig: DisplayConfig;
  scrollClock: ScrollClock | null;
  voiceState: VoiceState;
  devices: Record<string, DevicePresence>;
  roomRevision: number;
  serverSeq: number;
  createdAt: number;
  updatedAt: number;
};
```

### Device And Session

`deviceId` is the logical device identity. `sessionId` is one WebSocket connection.

```ts
type Device = {
  deviceId: string;
  roomId: string;
  role: DeviceRole;
  name?: string;
  firstSeenAt: number;
  lastSeenAt: number;
  lastSessionId?: string;
};

type Session = {
  sessionId: string;
  deviceId: string;
  roomId: string;
  connectedAt: number;
  disconnectedAt?: number;
  lastSeenServerSeq: number;
  lastSeenRoomRevision: number;
};

type DevicePresence = {
  deviceId: string;
  sessionId: string;
  role: DeviceRole;
  online: boolean;
  connectionState: "online" | "reconnecting" | "offline";
  lastSeenAt: number;
  lastClientSeq: number;
  currentScriptVersionId: string | null;
  renderRevision?: string;
  playbackState?: PlaybackState;
  capabilities: {
    fullscreen?: boolean;
    microphone?: boolean;
    speechRecognition?: boolean;
    wakeLock?: boolean;
  };
  isVoiceSource: boolean;
};
```

### ScriptDraft And ScriptVersion

Markdown is the only user source format. Runtime indexes are derived.

```ts
type ScriptDraft = {
  draftId: string;
  roomId: string;
  markdown: string;
  updatedBy: string;
  updatedAt: number;
  draftRevision: number;
  parseStatus: "valid" | "warning" | "error";
};

type ScriptVersion = {
  versionId: string;
  roomId: string;
  markdown: string;
  message?: string;
  displayConfigSnapshot: DisplayConfig;
  markerIndexSnapshot: MarkerAnchor[];
  contentHash: string;
  createdBy: string;
  createdAt: number;
};
```

Restoring a historical version creates a new current draft. It never deletes or overwrites historical versions.

### DisplayConfig

```ts
type DisplayConfig = {
  fontSize: number;
  lineHeight: number;
  fontFamily?: string;
  fontWeight?: number;
  textColor: string;
  backgroundColor: string;
  margin: { top: number; right: number; bottom: number; left: number };
  safeArea: { top: number; right: number; bottom: number; left: number };
  mirror: boolean;
  orientation?: "landscape" | "portrait" | "auto";
  showStageCues: boolean;
  showMarkers: boolean;
};
```

Mirror affects player formal display. It must not make control preview unreadable.

### Anchor

Anchors must not rely only on character offset.

```ts
type Anchor = {
  anchorId?: string;
  type: "marker" | "heading" | "paragraph" | "speechSegment" | "textHash" | "renderLine";
  markerId?: string;
  speechSegmentId?: string;
  headingText?: string;
  paragraphIndex?: number;
  textHash?: string;
  renderLineIndex?: number;
  fallbackTextHash?: string;
};
```

Anchor priority:

1. `markerId`
2. `paragraphIndex + textHash`
3. `headingText + paragraphIndex`
4. `fallbackTextHash`
5. `renderLineIndex`

### ScrollClock

`ScrollClock` is playback intent, not playback fact.

```ts
type ScrollClock = {
  scrollClockId: string;
  scriptVersionId: string;
  state: PlaybackStatus;
  freezeReason?: FreezeReason;
  controlMode: ControlMode;
  anchor: Anchor;
  offsetPx: number;
  velocityPxPerSecond: number;
  issuedAt: number;
  sourceDeviceId: string;
  roomRevision: number;
};
```

### PlaybackState

`PlaybackState` is the player-side observed execution fact.

```ts
type PlaybackState = {
  scriptVersionId: string;
  state: PlaybackStatus;
  freezeReason?: FreezeReason;
  positionPx: number;
  currentAnchor: Anchor;
  velocityPxPerSecond: number;
  controlMode: ControlMode;
  sourceDeviceId: string;
  scrollClockId?: string;
  reportedAt: number;
  serverReceivedAt?: number;
};
```

### VoiceState

```ts
type VoiceState = {
  active: boolean;
  sourceDeviceId: string | null;
  transcript?: {
    segmentId: string;
    text: string;
    isFinal: boolean;
    updatedAt: number;
  };
  match?: {
    scriptVersionId: string;
    matchedAnchor: Anchor;
    confidence: number;
    shouldAdvance: boolean;
    updatedAt: number;
  };
  followLock?: VoiceFollowLock;
};

type VoiceFollowLock = {
  mode: "auto" | "manualCooldown" | "relocking";
  cooldownUntil?: number;
  relockAnchorId?: string;
};
```

Only one active voice source is allowed per room.

## State Ownership

| State | Primary source | Note |
| --- | --- | --- |
| Markdown draft | Control side | No multi-user editing in MVP. |
| Manual versions | Control-side HTTP operation | Save then broadcast version change. |
| DisplayConfig | Control side | Player applies and reports state. |
| ScrollClock | Current valid control source | Server serializes confirmation. |
| Real playback position | Player side | Control UI displays reported fact. |
| Presence | Server | Calculated from connection and heartbeat. |
| Voice source | Server | One active source per room. |
| Transcript | Active voice source | Partial can be dropped. |
| Match result | Active voice source or server matching module | Must search near current anchor first. |

## State Classes

1. **Strong room facts**: current version, display config, control mode, active voice source, current ScrollClock. Must be server-acked before broadcast.
2. **Device facts**: each device presence, render version, playback position, microphone capability. Last valid write wins per device.
3. **High-frequency transient facts**: position reports, partial transcripts, manual scroll movement. Throttled and lossy; must not block script/config sync.

## Lifecycles

```text
Room: active -> closed
Device: joining -> online -> reconnecting -> offline
Playback: paused -> playing -> paused -> frozen
```

Use `frozen` when:

- Script version does not match.
- ScrollClock cannot be resolved.
- Voice source is lost and auto-advance should stop.
- Player must protect the visible screen.

## Control Mode Conflict Rules

| Mode | Position source | Rule |
| --- | --- | --- |
| fixedSpeed | Control ScrollClock | Player computes locally and reports observed fact. Player manual movement is drift unless explicitly accepted. |
| manual | Last accepted control action | Control and player may both initiate movement; server serializes. |
| voiceFollow | Active voice source | Match results advance only inside nearby window; manual actions create cooldown. |

## Invariants

- Markdown is the only user source document.
- Derived render/speech/marker/anchor indexes are rebuildable caches.
- Control side owns script and display intent.
- Player side owns observed playback state.
- ScrollClock must reference a `scriptVersionId`.
- Old-version ScrollClock cannot directly apply to a new version.
- Newer accepted ScrollClock supersedes older ScrollClock for the same version.
- Ordering uses `roomRevision` for accepted room facts. `clientSeq` and `serverSeq` belong to transport and replay, not to ScrollClock itself.
- Stage Cue and Cue Marker labels/notes never enter speech matching.
- Marker jump prefers marker ID.
- Restore creates a new draft and preserves history.
- Disconnect never clears player display.
- Drift is shown to control side; the system does not silently force correction.

## Persistence Boundary

Persist:

- Room metadata.
- Current Markdown draft.
- Manual ScriptVersion snapshots.
- Current DisplayConfig.
- Current RoomStateSnapshot.
- Key operation and error logs.

Short-term cache:

- WebSocket sessions.
- Presence.
- Recent event log.
- Partial transcript.
- High-frequency position reports.

Do not persist as core fact:

- Every animation frame position.
- Every partial transcript.
- Control-side predicted position.
- Full rendered Markdown tree, except as rebuildable cache.
