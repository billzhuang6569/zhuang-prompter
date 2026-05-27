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
- Player font control changed the stage from `100%` to `110%`.
- Player `保持亮屏` control was visible in Safari room `114210`; after clicking it, the control changed to `亮屏中` and showed `保持亮屏已开启`.
- Hide status left only a compact `显示状态` reveal button over the stage.
- Device, RoomState, and same-network entry panels remained available below the stage.

## Latest Script Hot Update Pass

Date: 2026-05-27

Result: PASS for desktop Safari player update without refresh.

Observed flow:

- Opened `/room/997401/player` in Safari and kept it connected.
- Simulated a control-side draft save through the room draft API.
- The player page updated from the original sample script to `现场热更新验证`.
- The player showed marker `M777` and unique text `LIVE_SYNC_997401` without reloading.
- RoomState changed to draft revision `2` while the player stayed connected.

## Latest Same-Network QR Pass

Date: 2026-05-27

Result: PASS for desktop Safari same-network entry visibility.

Observed flow:

- Opened `/room/980335/control` in Safari.
- The control page connected and showed the `同网设备加入` section.
- The LAN row showed `http://10.250.1.221:3000`.
- The LAN row displayed a QR code labeled `扫码打开播放端`.
- Control and player LAN links remained visible beside the QR code.

## Latest Field Check Panel Pass

Date: 2026-05-27

Result: PASS for desktop Safari field readiness panel.

Observed flow:

- Opened `/room/644966/control` in Safari.
- The control page connected without staying on `joining`.
- The `现场验收` panel marked `局域网入口` and `控制端连接` as passed.
- Opened `/room/644966/player` in Chrome as a separate device.
- The `现场验收` panel marked `播放端在线` as passed.
- Pressed Play from Safari control.
- The `现场验收` panel marked `播放回报` as passed and showed a fresh `playing` position.

## Latest Reconnect Button Pass

Date: 2026-05-27

Result: PASS for desktop Safari manual reconnect exercise.

Observed flow:

- Opened `/room/103257/control` in Safari.
- Pressed `测试断线重连` in the `现场验收` panel.
- The control status briefly left the connected state, then returned to `已连接`.
- The `现场验收` panel marked `重连观察` as passed with `已尝试重连 1 次，当前 已恢复`.

## Latest 10-Minute Monitor UI Pass

Date: 2026-05-27

Result: PASS for rendered control-side 10-minute session monitor.

Observed flow:

- Opened `/room/610821/control` through local headless Chrome rendering.
- The `现场验收` panel rendered `开始10分钟监测`, `重置监测`, and `测试断线重连`.
- The panel included a `10分钟运行` row.
- Before starting the monitor, the row showed the expected pending prompt: keep the player running to `10:00`.
- The panel rendered `复制验收记录`, which produces a pasteable field report from the current room state.
- The LAN QR row rendered `放大二维码` for easier iPad scanning from a physical device.

## Repeatable Manual Pass

1. Start the app with `pnpm dev`.
2. Open `http://localhost:3000` in Safari.
3. Create a new room and select control.
4. Confirm the room page shows a `同网设备加入` section with at least the current browser URL and, when Wi-Fi is active, a LAN URL such as `http://192.168.x.x:3000`.
5. Confirm the LAN row shows a `扫码打开播放端` QR code for the player URL, then press `放大二维码` and confirm the larger QR code opens.
6. Open the player URL in another browser, a private window, or iPad Safari on the same Wi-Fi so it becomes a separate device.
7. If using iPad Safari, scan the LAN player QR code or type the LAN player URL from the room page. `localhost` only works on the Mac itself.
8. Confirm the control page's `现场验收` panel marks `局域网入口`, `控制端连接`, and `播放端在线` as passed.
9. Press `开始10分钟监测` in the `现场验收` panel.
10. Press Play, Pause, Speed, and each marker jump from control.
11. Press `回退 160px` and `前进 160px`, then confirm the player view moves without jumping back to the top.
12. Confirm the `现场验收` panel marks `播放回报` as passed after the player starts reporting position.
13. Confirm the `10分钟运行` row counts elapsed time and playback reports, and does not show `检测到位置倒退`.
14. On the player page, press `保持亮屏`; confirm the browser either enters `亮屏中` or shows a graceful unsupported/permission message.
15. Edit the markdown draft, save the draft, save a version, and restore the version.
16. Confirm the player page receives saved draft/version/restore changes without refreshing.
17. Refresh the player page and confirm it rejoins with the full RoomState.
18. Keep the session running for 10 minutes before a real shoot, then confirm `10分钟运行` becomes passed.
19. Press `测试断线重连` in the control page's `现场验收` panel and confirm the page returns to `已连接` without refreshing.
20. During a device pass, briefly toggle Wi-Fi off/on or background/foreground iPad Safari and confirm the status returns to `已连接` without refreshing.
21. Confirm the `现场验收` panel updates `重连观察` after either reconnect path has been exercised.
22. Press `复制验收记录` and paste the generated report into the project notes or acceptance log.

For an automated 10-minute stability pass, run `pnpm smoke:m5:session:10min` while `pnpm dev` is running.

## Still Required Before Calling P0 Fully Field-Ready

- 10-minute human-operated shooting session.
- Safari desktop visual pass at full-screen player size.
- iPad Safari join/player pass on the same network.
- Real weak-network or offline/reconnect observation beyond the automatic retry implementation and local reconnect smoke.
