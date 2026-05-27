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

## Repeatable Manual Pass

1. Start the app with `pnpm dev`.
2. Open `http://localhost:3000` in Safari.
3. Create a new room and select control.
4. Open the player URL in another browser or a private window so it becomes a separate device.
5. Confirm both devices are online in the control device list.
6. Press Play, Pause, Speed, and each marker jump from control.
7. Confirm the player view updates without reloading and the control view shows player playback reports.
8. Edit the markdown draft, save the draft, save a version, and restore the version.
9. Refresh the player page and confirm it rejoins with the full RoomState.
10. Keep the session running for 10 minutes before a real shoot.

For an automated 10-minute stability pass, run `pnpm smoke:m5:session:10min` while `pnpm dev` is running.

## Still Required Before Calling P0 Fully Field-Ready

- 10-minute human-operated shooting session.
- Safari desktop visual pass at full-screen player size.
- iPad Safari join/player pass on the same network.
- Weak-network or offline/reconnect observation beyond the local reconnect smoke.
