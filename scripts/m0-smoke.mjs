import WebSocket from "ws";

const base = process.env.M0_BASE_URL ?? "http://localhost:3000";
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
  const created = await postJson(`${base}/api/rooms`);
  const joined = await postJson(`${base}/api/rooms/${created.roomCode}/join`, {});
  const seen = [];

  const controlSocket = await openSocket(`${wsBase}${created.wsUrl}`);
  const playerSocket = await openSocket(`${wsBase}${joined.wsUrl}`);

  controlSocket.on("message", (message) => seen.push(["control", JSON.parse(String(message))]));
  playerSocket.on("message", (message) => seen.push(["player", JSON.parse(String(message))]));

  controlSocket.send(
    makeEvent("client.hello", created.deviceId, "sess_control", 1, created.lastRoomRevision, {
      role: "control",
      lastSeenRoomRevision: 0,
      lastSeenServerSeq: 0,
    }),
  );
  playerSocket.send(
    makeEvent("client.hello", joined.deviceId, "sess_player", 1, joined.lastRoomRevision, {
      role: "player",
      lastSeenRoomRevision: 0,
      lastSeenServerSeq: 0,
    }),
  );

  await sleep(300);

  controlSocket.send(makeEvent("role.set", created.deviceId, "sess_control", 2, 0, { role: "control" }));
  playerSocket.send(makeEvent("role.set", joined.deviceId, "sess_player", 2, 0, { role: "player" }));

  await sleep(300);
  playerSocket.close();
  await sleep(300);
  controlSocket.close();

  const latest = [...seen].reverse().find(([, event]) => event.state)?.[1].state;
  const devices = latest ? Object.values(latest.devices) : [];

  if (!latest) {
    throw new Error("No RoomState was received over WebSocket.");
  }

  if (devices.length < 2) {
    throw new Error(`Expected at least 2 devices, received ${devices.length}.`);
  }

  if (!devices.some((device) => device.role === "control")) {
    throw new Error("Control device role was not observed.");
  }

  if (!devices.some((device) => device.role === "player")) {
    throw new Error("Player device role was not observed.");
  }

  if (!devices.some((device) => device.role === "player" && device.online === false)) {
    throw new Error("Player offline presence was not observed after socket close.");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        roomCode: created.roomCode,
        eventCount: seen.length,
        roomRevision: latest.roomRevision,
        serverSeq: latest.serverSeq,
        devices: devices.map((device) => ({
          role: device.role,
          online: device.online,
          connectionState: device.connectionState,
        })),
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
