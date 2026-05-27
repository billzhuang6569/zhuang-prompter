import WebSocket from "ws";

const base = process.env.M5_BASE_URL ?? process.env.M0_BASE_URL ?? "http://localhost:3000";
const wsBase = base.replace(/^http/, "ws");
const durationMs = Number.parseInt(process.env.M5_SESSION_MS ?? "30000", 10);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeEvent(type, deviceId, sessionId, clientSeq, baseRoomRevision, payload = {}) {
  return JSON.stringify({
    type,
    eventId: `evt_${crypto.randomUUID()}`,
    deviceId,
    sessionId,
    clientSeq,
    baseRoomRevision,
    sentAt: Date.now(),
    payload,
  });
}

function openSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.on("open", () => resolve(socket));
    socket.on("error", reject);
  });
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from ${url}`);
  }
  return response.json();
}

async function main() {
  const room = await postJson(`${base}/api/rooms`);
  const player = await postJson(`${base}/api/rooms/${room.roomCode}/join`, {});
  const controlSocket = await openSocket(`${wsBase}${room.wsUrl}`);
  const playerSocket = await openSocket(`${wsBase}${player.wsUrl}`);
  const reports = [];
  let lastState;

  controlSocket.on("message", (message) => {
    const event = JSON.parse(String(message));
    if (event.state) {
      lastState = event.state;
      const playerDevice = Object.values(event.state.devices).find((device) => device.deviceId === player.deviceId);
      if (playerDevice?.playbackState) {
        reports.push(playerDevice.playbackState);
      }
    }
  });

  controlSocket.send(makeEvent("client.hello", room.deviceId, "sess_control", 1, 0, { role: "control" }));
  playerSocket.send(makeEvent("client.hello", player.deviceId, "sess_player", 1, 0, { role: "player" }));
  await sleep(200);

  const clock = {
    scrollClockId: `clk_${crypto.randomUUID()}`,
    scriptVersionId: "draft",
    state: "playing",
    controlMode: "fixedSpeed",
    anchor: { type: "marker", markerId: "M001" },
    offsetPx: 0,
    velocityPxPerSecond: 68,
    issuedAt: Date.now(),
    sourceDeviceId: room.deviceId,
  };
  controlSocket.send(makeEvent("playback.setScrollClock", room.deviceId, "sess_control", 2, 0, { scrollClock: clock }));

  const start = Date.now();
  let seq = 2;
  while (Date.now() - start < durationMs) {
    seq += 1;
    const elapsedSeconds = (Date.now() - clock.issuedAt) / 1000;
    playerSocket.send(
      makeEvent("playback.reportState", player.deviceId, "sess_player", seq, 0, {
        playbackState: {
          scriptVersionId: "draft",
          state: "playing",
          positionPx: clock.offsetPx + elapsedSeconds * clock.velocityPxPerSecond,
          currentAnchor: clock.anchor,
          velocityPxPerSecond: clock.velocityPxPerSecond,
          controlMode: "fixedSpeed",
          sourceDeviceId: player.deviceId,
          scrollClockId: clock.scrollClockId,
          reportedAt: Date.now(),
        },
      }),
    );
    await sleep(400);
  }

  controlSocket.close();
  playerSocket.close();

  if (reports.length < Math.max(3, Math.floor(durationMs / 700))) {
    throw new Error(`Insufficient playback reports observed: ${reports.length}`);
  }
  const positions = reports.map((report) => report.positionPx);
  for (let index = 1; index < positions.length; index += 1) {
    if (positions[index] + 1 < positions[index - 1]) {
      throw new Error("Playback position moved backwards during stability session.");
    }
  }
  if (!lastState?.scriptDraft?.markdown || !lastState?.scrollClock) {
    throw new Error("Session ended without full room state.");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        roomCode: room.roomCode,
        durationMs,
        reportCount: reports.length,
        firstPositionPx: Math.round(positions[0]),
        lastPositionPx: Math.round(positions.at(-1)),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
