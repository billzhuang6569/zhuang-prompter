import WebSocket from "ws";

const base = process.env.M5_BASE_URL ?? process.env.M0_BASE_URL ?? "http://localhost:3000";
const wsBase = base.replace(/^http/, "ws");

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

  const firstSeen = [];
  const playerSocket = await openSocket(`${wsBase}${player.wsUrl}`);
  playerSocket.on("message", (message) => firstSeen.push(JSON.parse(String(message))));
  playerSocket.send(makeEvent("client.hello", player.deviceId, "sess_player_a", 1, 0, { role: "player" }));
  await sleep(200);

  const scrollClock = {
    scrollClockId: `clk_${crypto.randomUUID()}`,
    scriptVersionId: "draft",
    state: "playing",
    controlMode: "fixedSpeed",
    anchor: { type: "marker", markerId: "M001" },
    offsetPx: 120,
    velocityPxPerSecond: 68,
    issuedAt: Date.now(),
    sourceDeviceId: room.deviceId,
  };
  const controlSocket = await openSocket(`${wsBase}${room.wsUrl}`);
  controlSocket.send(makeEvent("client.hello", room.deviceId, "sess_control", 1, 0, { role: "control" }));
  await sleep(100);
  controlSocket.send(
    makeEvent("playback.setScrollClock", room.deviceId, "sess_control", 2, 0, { scrollClock }),
  );
  await sleep(200);
  playerSocket.close();
  await sleep(250);

  const rejoined = await postJson(`${base}/api/rooms/${room.roomCode}/join`, { deviceId: player.deviceId });
  const reconnectSeen = [];
  const reconnectSocket = await openSocket(`${wsBase}${rejoined.wsUrl}`);
  reconnectSocket.on("message", (message) => reconnectSeen.push(JSON.parse(String(message))));
  reconnectSocket.send(
    makeEvent("client.hello", player.deviceId, "sess_player_b", 2, rejoined.lastRoomRevision, {
      role: "player",
      lastSeenRoomRevision: 0,
      lastSeenServerSeq: 0,
    }),
  );
  await sleep(300);
  controlSocket.close();
  reconnectSocket.close();

  const welcome = reconnectSeen.find((event) => event.type === "server.welcome");
  const state = welcome?.state;
  const device = state?.devices?.[player.deviceId];

  if (!state?.scrollClock || state.scrollClock.scrollClockId !== scrollClock.scrollClockId) {
    throw new Error("Reconnect did not restore current ScrollClock.");
  }
  if (!device || device.sessionId !== "sess_player_b" || !device.online) {
    throw new Error("Reconnect did not preserve device identity with a new session.");
  }
  if (!state.scriptDraft?.markdown) {
    throw new Error("Reconnect did not include full script draft state.");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        roomCode: room.roomCode,
        deviceId: player.deviceId,
        reconnectedSessionId: device.sessionId,
        restoredScrollClock: state.scrollClock.scrollClockId,
        roomRevision: state.roomRevision,
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
