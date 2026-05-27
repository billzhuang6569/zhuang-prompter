# Realtime Event Protocol

**Status**: Draft v0.1  
**Purpose**: Define minimum HTTP/WebSocket contracts for the MVP.

## Realtime Principles

- HTTP handles room creation, join validation, draft/version operations, and full state fetch.
- WebSocket handles realtime room state, playback control, device presence, player state reports, transcript, and voice match results.
- The server maintains room facts. It does not push every scroll frame.
- The player executes ScrollClock locally and reports observed facts.
- The control side displays server-confirmed room state and player-reported state.

## Canonical Naming And Transport

Dot notation in this document is canonical for implementation. Colon notation in upstream PRD, such as `room:create`, is treated as conceptual naming only.

Canonical split:

- HTTP: room creation/join validation, draft save, version save/list/restore, full state fetch.
- WebSocket: role changes, display config broadcast, ScrollClock, playback report, presence, voice transcript, voice match, room patches.

## HTTP API Draft

```http
POST /api/rooms
```

Creates a room and first device.

```json
{
  "roomCode": "849263",
  "roomId": "room_abc",
  "deviceId": "dev_001",
  "joinToken": "short_lived_token",
  "wsUrl": "/ws/rooms/room_abc"
}
```

```http
POST /api/rooms/{roomCode}/join
```

Joins a room and returns initial state plus WS credentials.

```json
{
  "roomId": "room_abc",
  "deviceId": "dev_002",
  "joinToken": "short_lived_token",
  "roomState": {},
  "lastRoomRevision": 128
}
```

```http
GET /api/rooms/{roomId}/state
POST /api/rooms/{roomId}/script/draft
POST /api/rooms/{roomId}/script/versions
GET  /api/rooms/{roomId}/script/versions
POST /api/rooms/{roomId}/script/restore
```

Draft and version operations use HTTP. Successful changes are broadcast by WebSocket.

## WebSocket Connection

```text
/ws/rooms/{roomId}?deviceId=dev_001&token=...
```

Client hello:

```json
{
  "type": "client.hello",
  "eventId": "evt_001",
  "deviceId": "dev_001",
  "sessionId": "sess_001",
  "role": "control",
  "lastSeenRoomRevision": 120,
  "lastSeenServerSeq": 330,
  "clientTime": 1780000000000
}
```

Server welcome:

```json
{
  "type": "server.welcome",
  "eventId": "evt_002",
  "roomId": "room_abc",
  "deviceId": "dev_001",
  "sessionId": "sess_001",
  "serverTime": 1780000000100,
  "roomRevision": 128,
  "serverSeq": 350,
  "state": {}
}
```

If the client is slightly behind, server may replay missed events. If it is too far behind, server sends full `room.state`.

## Event Envelope

All client events use one envelope:

```json
{
  "type": "playback.setScrollClock",
  "eventId": "evt_ulid",
  "roomId": "room_abc",
  "deviceId": "dev_001",
  "sessionId": "sess_001",
  "clientSeq": 42,
  "baseRoomRevision": 128,
  "sentAt": 1780000000000,
  "payload": {}
}
```

Ack:

```json
{
  "type": "server.ack",
  "eventId": "evt_ulid",
  "accepted": true,
  "roomRevision": 129,
  "serverSeq": 351,
  "serverTime": 1780000000050
}
```

Nack:

```json
{
  "type": "server.nack",
  "eventId": "evt_ulid",
  "accepted": false,
  "code": "STALE_SCRIPT_VERSION",
  "message": "Scroll Clock references an old script version.",
  "roomRevision": 130,
  "recoverable": true
}
```

## Core Events

### Role

```json
{
  "type": "role.set",
  "payload": { "role": "control" }
}
```

Broadcast:

```json
{
  "type": "device.presenceChanged",
  "payload": {
    "deviceId": "dev_001",
    "role": "control",
    "online": true,
    "lastSeenAt": 1780000000000
  }
}
```

### Display Config

```json
{
  "type": "display.updateConfig",
  "payload": {
    "config": {
      "fontSize": 64,
      "lineHeight": 1.35,
      "mirror": true,
      "safeArea": { "top": 80, "right": 80, "bottom": 80, "left": 80 },
      "showStageCues": true,
      "showMarkers": true
    }
  }
}
```

### ScrollClock

```json
{
  "type": "playback.setScrollClock",
  "payload": {
    "scrollClockId": "clk_001",
    "scriptVersionId": "ver_001",
    "state": "playing",
    "controlMode": "fixedSpeed",
    "anchor": {
      "type": "marker",
      "markerId": "M002",
      "paragraphIndex": 12,
      "textHash": "hash_xxx"
    },
    "offsetPx": 0,
    "velocityPxPerSecond": 68,
    "issuedAt": 1780000000000,
    "sourceDeviceId": "dev_control_01"
  }
}
```

Broadcast:

```json
{
  "type": "playback.scrollClockChanged",
  "payload": {
    "scrollClock": {},
    "roomRevision": 129
  }
}
```

### Player State Report

```json
{
  "type": "playback.reportState",
  "payload": {
    "scriptVersionId": "ver_001",
    "state": "playing",
    "controlMode": "fixedSpeed",
    "positionPx": 1248,
    "currentAnchor": {
      "type": "paragraph",
      "paragraphIndex": 14,
      "nearestMarkerId": "M002",
      "textHash": "hash_yyy"
    },
    "velocityPxPerSecond": 68,
    "renderRevision": "render_001",
    "latencyMs": 80,
    "reportedAt": 1780000000200
  }
}
```

Report frequency:

- Playing: every 250-500ms.
- Paused: heartbeat every 2s is enough.
- Manual scroll: throttle to 100-200ms.
- State change: send immediately.

### Local Player Control

Local pause, speed change, manual scroll, and resync may use:

```json
{
  "type": "playback.localControl",
  "payload": {
    "action": "manualScroll",
    "positionPx": 1500,
    "anchor": {},
    "reason": "player_touch_scroll"
  }
}
```

Server accepts or records it according to current control mode.

### Voice

```json
{
  "type": "voice.setSource",
  "payload": { "sourceDeviceId": "dev_player_01" }
}
```

```json
{
  "type": "voice.transcript",
  "payload": {
    "sourceDeviceId": "dev_player_01",
    "segmentId": "seg_001",
    "text": "今天我们讲一个很多人都好奇的问题",
    "isFinal": false,
    "startedAt": 1780000000000,
    "endedAt": 1780000001200
  }
}
```

```json
{
  "type": "voice.matchResult",
  "payload": {
    "sourceDeviceId": "dev_player_01",
    "scriptVersionId": "ver_001",
    "matchedAnchor": {
      "type": "paragraph",
      "paragraphIndex": 3,
      "textHash": "hash_abc"
    },
    "confidence": 0.82,
    "searchWindow": { "fromParagraph": 1, "toParagraph": 8 },
    "shouldAdvance": true
  }
}
```

Voice advancement should ultimately produce or update a ScrollClock so player execution stays unified.

## Sequence, Ack, And Idempotency

Use three order markers:

- `clientSeq`: increments within one session.
- `serverSeq`: global room broadcast sequence for replay.
- `roomRevision`: increments when room facts change.

ScrollClock does not have its own `sequence`. Accepted ScrollClock order is determined by `roomRevision`; transport order is determined by `clientSeq` and `serverSeq`.

Rules:

- `eventId` is globally unique and retained in a short de-duplication window.
- Duplicate `eventId` returns the first result.
- Duplicate `deviceId + sessionId + clientSeq` is duplicate.
- Old `clientSeq` can be acked as ignored.
- Events include `baseRoomRevision`; server may reject stale operations.
- Same-version newer ScrollClock supersedes older ScrollClock.
- Cross-version ScrollClock requires version switch and anchor relocation first.
- Same-room events are processed serially by the server.

## Version Activation And Anchor Relocation

Script save creates a `ScriptVersion`; it does not automatically change the playing version unless the control side activates it.

Activation flow:

```text
draft saved
-> version activated
-> player receives version change
-> player rebuilds RenderBundle
-> player relocates old anchor into new scrollAnchorIndex
-> success: server accepts a new ScrollClock for the new scriptVersionId
-> failure: player enters frozen with ANCHOR_NOT_FOUND and keeps old visible screen until manual resync
```

Rules:

- Old-version ScrollClock is never applied directly to the new version.
- On activation, player keeps current visible screen until new render is ready.
- If relocation succeeds, player reports the new anchor and accepts the new ScrollClock.
- If relocation fails, player remains visible, reports `frozenReason: "ANCHOR_NOT_FOUND"`, and control side prompts manual resync.

## Local Control Normalization

Any accepted local control that changes room playback intent must become a new accepted ScrollClock and broadcast `playback.scrollClockChanged`.

| Action | fixedSpeed | manual | voiceFollow |
| --- | --- | --- | --- |
| player pause | record drift unless explicit takeover | accept as new paused ScrollClock | accept, set voice cooldown |
| player speed change | reject unless explicit takeover | accept as new ScrollClock | accept, set voice cooldown |
| player manual scroll | record drift unless explicit takeover | accept as new ScrollClock | accept, set voice cooldown |
| player resync | accept if based on current version | accept | accept, set voice cooldown |

Pure telemetry remains `playback.reportState` and does not create ScrollClock.

## Reconnect And Replay

Client rules:

- Drop broadcasts with `serverSeq <= lastServerSeq`.
- If `serverSeq` has a gap, send `room.resyncRequest`.
- Drop stale `roomRevision` patches.
- Apply full `room.state` as server truth, while player keeps visible screen stable.

Server rules:

- Track `lastClientSeq` per device session.
- Keep recent room events for replay.
- If replay window is exceeded, send full state.

MVP replay window default:

- Recent 5 minutes, or
- Recent 1000 events.

Disconnect defaults:

- Ping/pong every 10s.
- Mark offline after 30s without response.
- Player keeps last screen and shows low-interruption hint.
- Control device list shows offline and last sync time.

Reconnect priority:

1. Keep player screen visible.
2. Restore script version.
3. Restore display config.
4. Restore ScrollClock if valid.
5. Send one `playback.reportState` immediately.

## Storage And Recovery

Persist:

- Room metadata.
- ScriptDraft.
- ScriptVersion.
- Device registration.
- RoomStateSnapshot.
- Short RoomEventLog for replay and diagnosis.

Cache:

- Presence.
- Current room state.
- Recent events.
- WebSocket fanout data.

Implementation default:

- PostgreSQL or SQLite for durable objects.
- Redis optional for presence/event replay when deployment needs it.
- Protocol should not depend on the storage choice.

## Error Codes

| code | Meaning | recoverable | clientAction |
| --- | --- | --- | --- |
| `ROOM_NOT_FOUND` | Room does not exist | false | Show not found and return to entry |
| `ROOM_CLOSED` | Room has ended | false | Show closed and offer new room |
| `JOIN_TOKEN_INVALID` | Join token invalid | true | Rejoin through HTTP |
| `DEVICE_NOT_IN_ROOM` | Device not in room | true | Rejoin through HTTP |
| `ROLE_INVALID` | Invalid role | true | Reset role selection |
| `EVENT_SCHEMA_INVALID` | Invalid event shape | true | Log developer error and request full state |
| `EVENT_DUPLICATE` | Duplicate event | true | Keep first ack result |
| `CLIENT_SEQ_STALE` | Client sequence too old | true | Ignore or reconnect session |
| `ROOM_REVISION_STALE` | Operation based on stale room state | true | Fetch full room state and retry if safe |
| `SCRIPT_VERSION_NOT_FOUND` | Version not found | true | Fetch versions and freeze playback intent |
| `STALE_SCRIPT_VERSION` | Event references old script version | true | Freeze, fetch state, relocate anchor |
| `ANCHOR_NOT_FOUND` | Anchor cannot be located | true | Freeze and prompt manual resync |
| `VOICE_SOURCE_UNAVAILABLE` | Voice source not available | true | Prompt new voice source |
| `VOICE_SOURCE_CONFLICT` | Another active voice source exists | true | Refresh voice state |
| `CONTROL_REJECTED_BY_MODE` | Current mode rejects source | true | Show rejected control and current mode |
| `RATE_LIMITED` | Events too frequent | true | Backoff and throttle |
| `ROOM_STATE_TOO_OLD` | Full sync required | true | Fetch full room state |
| `INTERNAL_ERROR` | Server error | true | Retry or reconnect |
