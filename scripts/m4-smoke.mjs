import WebSocket from "ws";

const base = process.env.M4_BASE_URL ?? process.env.M0_BASE_URL ?? "http://localhost:3000";
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
  const joined = await postJson(`${base}/api/rooms/${room.roomCode}/join`, {});
  const seen = [];
  const controlSocket = await openSocket(`${wsBase}${room.wsUrl}`);
  const playerSocket = await openSocket(`${wsBase}${joined.wsUrl}`);
  controlSocket.on("message", (message) => seen.push(["control", JSON.parse(String(message))]));
  playerSocket.on("message", (message) => seen.push(["player", JSON.parse(String(message))]));

  controlSocket.send(makeEvent("client.hello", room.deviceId, "sess_control", 1, 0, { role: "control" }));
  playerSocket.send(makeEvent("client.hello", joined.deviceId, "sess_player", 1, 0, { role: "player" }));
  await sleep(250);

  controlSocket.send(
    makeEvent("voice.setSource", room.deviceId, "sess_control", 2, 0, { sourceDeviceId: joined.deviceId }),
  );
  await sleep(250);

  playerSocket.send(
    makeEvent("voice.transcript", joined.deviceId, "sess_player", 2, 0, {
      transcript: {
        segmentId: "seg_smoke",
        sourceDeviceId: joined.deviceId,
        scriptVersionId: "draft",
        isFinal: true,
        text: "今天我们讲一个很多人都好奇的问题",
        asrConfidence: 0.98,
      },
    }),
  );
  await sleep(350);
  controlSocket.close();
  playerSocket.close();

  const latest = [...seen].reverse().find(([, event]) => event.state?.voiceState?.match)?.[1].state;
  const match = latest?.voiceState?.match;
  if (!match || match.level !== "locked" || !match.shouldAdvance) {
    throw new Error("High-confidence final transcript did not lock voice match.");
  }
  if (!latest.scrollClock || latest.scrollClock.controlMode !== "voiceFollow") {
    throw new Error("Locked voice match did not create voiceFollow ScrollClock.");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        roomCode: room.roomCode,
        voiceSource: latest.voiceState.sourceDeviceId,
        level: match.level,
        confidence: match.confidence,
        scrollClockMode: latest.scrollClock.controlMode,
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
