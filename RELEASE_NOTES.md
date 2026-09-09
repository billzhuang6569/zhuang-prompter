# Release Notes

## v0.1.3

### Fixed

- Controller guide and player center now share a character position instead of document-height percentages, including font changes, line breaks and mirrors.
- Voice matching identifies the next text near the reading head. The primary display uses actual layout to adjust speed, stops on silence or lost matches, and respects manual pause.
- Recognition restarts no longer save the draft, reselect the voice source or resume playback.

### Added

- `/join`: a reusable player entry page with a six-digit room code.
- Open the local control page in Chrome when desktop speech recognition is unavailable.
- `npm run install:mac`: install in Applications, keep a verified archive of the previous installed app, and remove verified old executable build copies.

### Compatibility

- Existing room data and editor changes are preserved. Recognition still depends on the browser's speech service and microphone permission; live speech should be checked before a shoot.

## v0.1.2

Player-display cleanup for parser diagnostics.

### Fixed

- Parser warnings are now limited to the control preview and no longer cover the player display.
- Long Chinese, Japanese, and Korean paragraphs are no longer misclassified as unbreakable tokens.
- Genuine long URLs or Latin tokens still produce an actionable warning in the control preview.
- Vertical mirroring now preserves the current playback position instead of jumping to another part of the script.

### Compatibility

- Room data, playback behavior, and the WebSocket synchronization protocol are unchanged.
- Safari and iOS Safari 15 compatibility from v0.1.1 remains enforced in the release workflow.

## v0.1.1

Compatibility update for older iPads without changing the room or synchronization protocol.

### Fixed

- Player pages now compile for Safari and iOS Safari 15, including iPadOS 15.8.
- Removed a client-side `Array.prototype.at` dependency from script export handling.
- Added a build regression check that rejects unsupported class static blocks in client bundles.

### Compatibility

- Existing macOS, Windows, and modern desktop-browser workflows remain unchanged.
- Room data and local drafts stay in the existing application-data directory during upgrades.

## v0.1.0

First public release of 庄Sir的提词器.

### Highlights

- Create local teleprompter rooms.
- Use one control view and one player view on the same local network.
- Edit scripts in a friendly Markdown-first control surface.
- Save local drafts and versions.
- Control play, pause, speed, jump points, mirror mode, and player display.
- Use automatic scrolling with experimental voice-assisted speed/position following.
- Run as a desktop app on the control computer, while player devices join from a browser.

### Known Limits

- The desktop packages are unsigned in this first release.
- Player devices must be on the same local network as the control computer.
- Browser microphone behavior on non-local LAN pages can vary by browser security policy; use the desktop control window for voice recognition.
- Voice following is experimental and should be tested before real shooting.
