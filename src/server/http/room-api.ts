import type { IncomingMessage, ServerResponse } from "node:http";
import QRCode from "qrcode";
import { getNetworkInfo } from "../network-info";
import {
  createRoom,
  getScriptDraft,
  getRoomState,
  joinRoom,
  listRooms,
  listScriptVersions,
  restoreScriptVersion,
  saveScriptVersion,
  updateRoomSettings,
  updateScriptDraft,
} from "../../modules/room-sync/room-store";
import type { RoomState } from "../../domain/room/types";

type RoomStateBroadcaster = (roomCode: string, state: RoomState) => void;

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

function writeSvg(response: ServerResponse, statusCode: number, body: string) {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "image/svg+xml; charset=utf-8",
  });
  response.end(body);
}

export async function handleRoomApi(
  request: IncomingMessage,
  response: ServerResponse,
  broadcastState?: RoomStateBroadcaster,
) {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "GET" && url.pathname === "/api/network-info") {
    writeJson(response, 200, getNetworkInfo());
    return true;
  }

  if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/api/qr") {
    const text = url.searchParams.get("text") ?? "";
    if (!text || text.length > 500) {
      writeJson(response, 400, { message: "A text query parameter up to 500 characters is required." });
      return true;
    }

    if (request.method === "HEAD") {
      writeSvg(response, 200, "");
      return true;
    }

    const svg = await QRCode.toString(text, {
      errorCorrectionLevel: "M",
      margin: 2,
      type: "svg",
      width: 180,
      color: {
        dark: "#0f172aff",
        light: "#ffffffff",
      },
    });
    writeSvg(response, 200, svg);
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/rooms") {
    writeJson(response, 200, { rooms: listRooms() });
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

  const settingsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/settings$/);
  if (request.method === "POST" && settingsMatch) {
    const body = await readJson(request);
    const state = updateRoomSettings({
      roomCode: settingsMatch[1],
      settings: {
        projectName: typeof body.projectName === "string" ? body.projectName : undefined,
        playbackSpeedPxPerSecond:
          typeof body.playbackSpeedPxPerSecond === "number" ? body.playbackSpeedPxPerSecond : undefined,
        playerFontScale: typeof body.playerFontScale === "number" ? body.playerFontScale : undefined,
        playerMirrorX: typeof body.playerMirrorX === "boolean" ? body.playerMirrorX : undefined,
        playerMirrorY: typeof body.playerMirrorY === "boolean" ? body.playerMirrorY : undefined,
        playerMarkersVisible: typeof body.playerMarkersVisible === "boolean" ? body.playerMarkersVisible : undefined,
        primaryPlayerDeviceId:
          typeof body.primaryPlayerDeviceId === "string" || body.primaryPlayerDeviceId === null ? body.primaryPlayerDeviceId : undefined,
      },
    });

    if (!state) {
      writeJson(response, 404, { message: "Room not found." });
      return true;
    }

    broadcastState?.(settingsMatch[1], state);
    writeJson(response, 200, { roomState: state });
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
    broadcastState?.(draftMatch[1], state);
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
    const state = getRoomState(versionsMatch[1]);
    if (state) {
      broadcastState?.(versionsMatch[1], state);
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
    broadcastState?.(restoreMatch[1], state);
    writeJson(response, 200, { draft: state.scriptDraft, roomState: state });
    return true;
  }

  return false;
}
