# Frontend Interaction Spec

**Status**: Draft v0.1  
**Views**: Control side and Player side only.

## Information Architecture

```text
Home / Room Entry
├─ Create room
├─ Join by room code
└─ Local draft / recovery hint

Role Select
├─ Control
└─ Player

Control View
├─ Room header
├─ Script workspace
├─ Live preview + playback control
├─ Operations panel
└─ Sync / version / voice status strip

Player View
├─ Ready state
├─ Formal playback state
├─ Hidden controls
└─ Exception states
```

## Control View

Use a three-zone layout:

```text
Header
  Room code / copy invite / current role / connection / save state

Left: Script Workspace
  Markdown editor
  Render preview
  Insert Stage Cue
  Insert Cue Marker
  Save version

Center: Live Preview + Playback
  Player-like preview
  Current anchor / marker
  Play / pause
  Previous / next
  Jump marker
  Speed
  Resync

Right: Operations Panel
  Devices
  Display Config
  Versions
  Voice
```

Right side should use tabs to reduce现场 clutter.

## Player View

Player state tree:

```text
Ready
  Connected / waiting for script / fullscreen / mirror / microphone permission

Formal Playback
  Speech text / Stage Cue / Cue Marker / lightweight status hint

Hidden Controls
  Pause / resume / speed / resync / voice / exit fullscreen

Exception Layer
  Disconnected / reconnecting / version mismatch / drift / microphone unavailable
```

Formal playback must not show navigation, room code, persistent buttons, setting panels, or editing metadata.

## Player Text Hierarchy

```text
Speech text: largest, highest contrast, stable line height
Stage Cue: indented, 1-2 sizes smaller, readable but quieter
Cue Marker: visible control point, not louder than speech text
```

Canonical display:

```text
今天我们讲一个很多人都好奇的问题：AI 到底是在猜，还是在想？

        ↳ 停顿 · 1s

◆ M002 · 重录点
  如果前面状态不好，可以从这里重新开始
```

## Hidden Player Controls

Reveal by:

- Mouse near edge.
- Triple tap/click.
- `Space`.
- `Esc`.

Auto-hide after 3-5 seconds without action. Place controls at bottom or side; never center-cover the text.

## ScrollClock Local Execution

Player receives ScrollClock and executes locally. Control side does not push every position.

Execution rules:

- Accept only matching `scriptVersionId`.
- Newer accepted `roomRevision` supersedes older clock for the same `scriptVersionId`.
- Use `issuedAt` for approximation, but animate with local monotonic time such as `performance.now()`.
- `playing`: resolve anchor, start from `offsetPx`, scroll by speed.
- `paused`: freeze current position and immediately report `positionPx`.
- `frozen`: keep screen visible, stop automatic movement.
- Speed, jump, pause, and resume create new ScrollClock.

## Player Scroll Loop

```ts
positionPx = baseOffsetPx + elapsedSeconds * velocityPxPerSecond;
```

Rules:

- Actual position is based on rendered DOM.
- Display config changes require re-measuring anchors.
- During font/line-height/margin changes, preserve anchor before preserving pixel value.
- Browser throttling should recover by recalculating from local time.
- Player reports state at 250-1000ms intervals; immediate on jump, pause, reconnect, or manual control.

## Manual Scrolling

Control-side manual scroll:

- Local extension-screen mode can feel near realtime.
- Remote mode does not promise pixel-perfect wheel follow.
- Throttle preview-to-ScrollClock generation to about 100-200ms.

Player-side manual scroll:

- Pauses fixed-speed auto-scroll or enters manual state.
- Reports current anchor and position.
- Control UI shows "player local control" rather than immediately stealing authority.

## Fullscreen And Mirror

Rules:

- Fullscreen failure prompts user to click manually.
- iOS Safari may degrade to immersive mode.
- Mirror applies only to formal player stage.
- Control preview is not mirrored by default.
- Overlay controls and exit buttons must not be mirrored.

```css
.teleprompter-stage.mirrored {
  transform: scaleX(-1);
}
```

## Role Switching

Role switching changes `role`; it does not leave the room.

Control entry:

```text
Header > Current role: Control > Switch to Player
```

Player entry:

```text
Hidden controls > More > Switch to Control
```

Confirm before switch. Preserve `roomId`, `deviceId`, current script version, display config, ScrollClock, PlaybackState, and voice source state.

## Version Interactions

Version panel:

```text
Current draft status
Save version
Version list
Compare with current draft
Restore as current draft
```

Use "restore as current draft", not "rollback overwrite." Confirm that history will not be deleted.

## Voice Takeover UI

Voice panel:

```text
Voice follow on/off
Current voice source
Available devices
Live transcript
Matched position
Confidence
Manual takeover
```

State flow:

```text
voiceFollow -> userManualOverride -> pausedVoiceFollow -> relockNearby -> voiceFollow
```

After takeover:

- Auto-advance pauses.
- Transcript may continue.
- Button changes to "relock voice following."

## Device And Sync States

```ts
type ConnectionState = "online" | "unstable" | "reconnecting" | "offline";
type SyncState =
  | "synced"
  | "versionMismatch"
  | "positionDrift"
  | "waitingForPlayerReport"
  | "recovering";
type ControlAuthority = "controller" | "player" | "voiceSource" | "roomConfirmed";
```

Exception priority:

```text
versionMismatch > disconnected/reconnecting > positionDrift > microphoneUnavailable > lowConfidenceVoice
```

Control device list shows:

- Device name.
- Role.
- Connection state.
- Current version.
- Anchor/marker/paragraph.
- Playback state.
- Control mode.
- Last sync time.
- Voice source flag.
- Drift state.

## Disconnect And Drift

Player disconnect hint should be low-interruption:

```text
连接中断，画面保持中
正在重新连接...
已恢复连接
正在更新文稿版本...
```

When player position differs from control expectation, do not force-correct.

Control prompt:

```text
播放端已偏离当前预期位置
播放端：M003 附近
控制端预期：M002 附近

[同步到播放端] [以播放端为准]
```

- "同步到播放端" sends a new ScrollClock to bring player back to control position.
- "以播放端为准" accepts the player reported position as current room fact.
