import WebSocket from "ws";

const base = process.env.M3_BASE_URL ?? process.env.M0_BASE_URL ?? "http://localhost:3000";
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

async function waitFor(predicate, timeoutMs = 1500) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = predicate();
    if (value) {
      return value;
    }
    await sleep(25);
  }
  return null;
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

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from ${url}`);
  }
  return response.json();
}

async function main() {
  const room = await postJson(`${base}/api/rooms`);
  const subscriber = await postJson(`${base}/api/rooms/${room.roomCode}/join`, {});
  const seen = [];
  const socket = await openSocket(`${wsBase}${subscriber.wsUrl}`);
  socket.on("message", (message) => seen.push(JSON.parse(String(message))));
  socket.send(makeEvent("client.hello", subscriber.deviceId, "sess_m3_subscriber", 1, 0, { role: "player" }));
  await sleep(150);

  const original = await getJson(`${base}/api/rooms/${room.roomCode}/script/draft`);
  const firstMarkdown = `${original.markdown}\n\n::marker[M999]{type="retake" label="烟测版本"}`;
  const secondMarkdown = `${firstMarkdown}\n\n这是一段恢复前会被移除的临时修改。`;

  await postJson(`${base}/api/rooms/${room.roomCode}/script/draft`, {
    deviceId: room.deviceId,
    markdown: firstMarkdown,
  });
  const draftPatch = await waitFor(() =>
    seen.find((event) => event.type === "room.patch" && event.state?.scriptDraft?.markdown?.includes("M999")),
  );
  if (!draftPatch) {
    throw new Error("Draft update was not broadcast to subscribed room clients.");
  }
  const saved = await postJson(`${base}/api/rooms/${room.roomCode}/script/versions`, {
    deviceId: room.deviceId,
    message: "M3 smoke save",
  });
  await postJson(`${base}/api/rooms/${room.roomCode}/script/draft`, {
    deviceId: room.deviceId,
    markdown: secondMarkdown,
  });
  const restored = await postJson(`${base}/api/rooms/${room.roomCode}/script/restore`, {
    deviceId: room.deviceId,
    versionId: saved.version.versionId,
  });
  const listed = await getJson(`${base}/api/rooms/${room.roomCode}/script/versions`);
  socket.close();

  if (!restored.draft.markdown.includes("M999")) {
    throw new Error("Restored draft does not include saved marker.");
  }
  if (restored.draft.markdown.includes("临时修改")) {
    throw new Error("Restore did not replace later draft text.");
  }
  if (listed.versions.length !== 1) {
    throw new Error("Restore deleted or duplicated version history.");
  }
  if (restored.roomState.currentDraftId === original.draftId) {
    throw new Error("Restore did not create a new draft id.");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        roomCode: room.roomCode,
        versionId: saved.version.versionId,
        versionCount: listed.versions.length,
        restoredDraftRevision: restored.draft.draftRevision,
        currentScriptVersionId: restored.roomState.currentScriptVersionId,
        broadcastRevision: draftPatch.roomRevision,
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
