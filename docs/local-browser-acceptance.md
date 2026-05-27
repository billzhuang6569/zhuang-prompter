# Local Browser Acceptance

Use this checklist after `pnpm dev` starts the local server at `http://localhost:3000`.

## Latest Short Browser Pass

Date: 2026-05-27

Result: PASS for the short desktop flow.

Observed flow:

- Safari opened the home page and created room `283838`.
- Safari selected the same device as control and opened `/room/283838/control`.
- Chrome opened `/room/283838/player` as a separate device.
- Both devices appeared online in the same RoomState.
- Control pressed Play and RoomState changed `ScrollClock` to `playing`.
- Control observed the player reporting `playing` playback state and a live position.
- Player rendered the dark teleprompter view with CJK text, markers, and stage cues.

## Latest Long Stability Pass

Date: 2026-05-27

Result: PASS for the automated 10-minute local session.

Observed result:

- Room `885346` ran for `600000ms`.
- Playback report count: `1497`.
- First observed position: `0px`.
- Last observed position: `40793px`.
- Playback position never moved backwards.
- Final RoomState still included the script draft and active ScrollClock.

## Latest Player Stage Pass

Date: 2026-05-27

Result: PASS for desktop Safari visual check of the player-first layout.

Observed flow:

- Opened `/room/064121/player` in Safari.
- The first viewport was the black teleprompter stage, not the device/debug panels.
- Room code and connection state remained visible as a compact top overlay.
- CJK headline, marker, stage cue, and body text were readable at shooting size.
- Device, RoomState, and same-network entry panels remained available below the stage.

## Repeatable Manual Pass

1. Start the app with `pnpm dev`.
2. Open `http://localhost:3000` in Safari.
3. Create a new room and select control.
4. Confirm the room page shows a `同网设备加入` section with at least the current browser URL and, when Wi-Fi is active, a LAN URL such as `http://192.168.x.x:3000`.
5. Open the player URL in another browser, a private window, or iPad Safari on the same Wi-Fi so it becomes a separate device.
6. If using iPad Safari, type the LAN player URL from the room page or the terminal output. `localhost` only works on the Mac itself.
7. Confirm both devices are online in the control device list.
8. Press Play, Pause, Speed, and each marker jump from control.
9. Confirm the player view updates without reloading and the control view shows player playback reports.
10. Edit the markdown draft, save the draft, save a version, and restore the version.
11. Refresh the player page and confirm it rejoins with the full RoomState.
12. Keep the session running for 10 minutes before a real shoot.

For an automated 10-minute stability pass, run `pnpm smoke:m5:session:10min` while `pnpm dev` is running.

## Still Required Before Calling P0 Fully Field-Ready

- 10-minute human-operated shooting session.
- Safari desktop visual pass at full-screen player size.
- iPad Safari join/player pass on the same network.
- Weak-network or offline/reconnect observation beyond the local reconnect smoke.
