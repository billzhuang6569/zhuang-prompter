import type { IncomingMessage, ServerResponse } from "node:http";
import { getNetworkInfo } from "../network-info";
import {
  createRoom,
  getScriptDraft,
  joinRoom,
  listScriptVersions,
  restoreScriptVersion,
  saveScriptVersion,
  updateScriptDraft,
} from "../../modules/room-sync/room-store";

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

export async function handleRoomApi(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "GET" && url.pathname === "/api/network-info") {
    writeJson(response, 200, getNetworkInfo());
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/rooms") {
    writeJson(response, 201, createRoom());
    return true;
  }

  const joinMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/join$/);
  if (request.method === "POST" && joinMatch) {
    const body = await readJson(request);
    const result = joinRoom(joinMatch[1], typeof body.deviceId === "string" ? body.deviceId : null);

    if (!result) {
      writeJson(response, 404, { message: "Room not found." });
      return true;
    }

    writeJson(response, 200, result);
    return true;
  }

  const draftMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/script\/draft$/);
  if (draftMatch && request.method === "GET") {
    const draft = getScriptDraft(draftMatch[1]);
    if (!draft) {
      writeJson(response, 404, { message: "Room not found." });
      return true;
    }
    writeJson(response, 200, draft);
    return true;
  }

  if (draftMatch && request.method === "POST") {
    const body = await readJson(request);
    const state = updateScriptDraft({
      roomCode: draftMatch[1],
      deviceId: typeof body.deviceId === "string" ? body.deviceId : "unknown",
      markdown: typeof body.markdown === "string" ? body.markdown : "",
    });
    if (!state) {
      writeJson(response, 404, { message: "Room not found." });
      return true;
    }
    writeJson(response, 200, { draft: state.scriptDraft, roomState: state });
    return true;
  }

  const versionsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/script\/versions$/);
  if (versionsMatch && request.method === "GET") {
    const versions = listScriptVersions(versionsMatch[1]);
    if (!versions) {
      writeJson(response, 404, { message: "Room not found." });
      return true;
    }
    writeJson(response, 200, { versions });
    return true;
  }

  if (versionsMatch && request.method === "POST") {
    const body = await readJson(request);
    const version = saveScriptVersion({
      roomCode: versionsMatch[1],
      deviceId: typeof body.deviceId === "string" ? body.deviceId : "unknown",
      message: typeof body.message === "string" ? body.message : undefined,
    });
    if (!version) {
      writeJson(response, 404, { message: "Room not found." });
      return true;
    }
    writeJson(response, 201, { version });
    return true;
  }

  const restoreMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/script\/restore$/);
  if (restoreMatch && request.method === "POST") {
    const body = await readJson(request);
    const state = restoreScriptVersion({
      roomCode: restoreMatch[1],
      deviceId: typeof body.deviceId === "string" ? body.deviceId : "unknown",
      versionId: typeof body.versionId === "string" ? body.versionId : "",
    });
    if (!state) {
      writeJson(response, 404, { message: "Version not found." });
      return true;
    }
    writeJson(response, 200, { draft: state.scriptDraft, roomState: state });
    return true;
  }

  return false;
}
