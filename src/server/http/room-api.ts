import type { IncomingMessage, ServerResponse } from "node:http";
import { createRoom, joinRoom } from "../../modules/room-sync/room-store";

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

  return false;
}
