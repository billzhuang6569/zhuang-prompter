import WebSocket from "ws";

const base = process.env.M0_BASE_URL ?? process.env.M2_BASE_URL ?? "http://localhost:3000";
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
  await sleep(250);

  const scrollClock = {
    scrollClockId: `clk_${crypto.randomUUID()}`,
    scriptVersionId: "fixture_m1",
    state: "playing",
    controlMode: "fixedSpeed",
    anchor: { type: "marker", markerId: "M001" },
    offsetPx: 0,
    velocityPxPerSecond: 68,
    issuedAt: Date.now(),
    sourceDeviceId: created.deviceId,
  };

  controlSocket.send(
    makeEvent("playback.setScrollClock", created.deviceId, "sess_control", 2, 0, { scrollClock }),
  );
  await sleep(250);

  playerSocket.send(
    makeEvent("playback.reportState", joined.deviceId, "sess_player", 2, 0, {
      playbackState: {
        scriptVersionId: "fixture_m1",
        state: "playing",
        positionPx: 42,
        currentAnchor: { type: "marker", markerId: "M001" },
        velocityPxPerSecond: 68,
        controlMode: "fixedSpeed",
        sourceDeviceId: joined.deviceId,
        scrollClockId: scrollClock.scrollClockId,
        reportedAt: Date.now(),
      },
    }),
  );
  await sleep(250);

  controlSocket.close();
  playerSocket.close();

  const latest = [...seen].reverse().find(([, event]) => event.state?.scrollClock)?.[1].state;
  const reports = latest ? Object.values(latest.devices).filter((device) => device.playbackState) : [];

  if (!latest?.scrollClock || latest.scrollClock.state !== "playing") {
    throw new Error("ScrollClock was not accepted into RoomState.");
  }
  if (reports.length === 0) {
    throw new Error("No PlaybackState report was observed in RoomState.");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        roomCode: created.roomCode,
        scrollClockState: latest.scrollClock.state,
        roomRevision: latest.roomRevision,
        serverSeq: latest.serverSeq,
        reports: reports.map((device) => ({
          role: device.role,
          state: device.playbackState.state,
          positionPx: device.playbackState.positionPx,
          scrollClockId: device.playbackState.scrollClockId,
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
