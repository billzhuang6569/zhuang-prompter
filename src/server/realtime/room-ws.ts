import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage, Server } from "node:http";
import {
  disconnectSession,
  getRoomState,
  heartbeat,
  processVoiceTranscript,
  registerSession,
  reportPlaybackState,
  setScrollClock,
  setDeviceRole,
  setVoiceSource,
} from "../../modules/room-sync/room-store";
import type {
  ClientEnvelope,
  ClientHelloPayload,
  PlaybackReportPayload,
  RoleSetPayload,
  ServerEnvelope,
  SetScrollClockPayload,
  VoiceSetSourcePayload,
  VoiceTranscriptPayload,
} from "../../shared/protocol";
import { makeEventId } from "../../shared/protocol";

type ClientRecord = {
  roomCode: string;
  deviceId: string;
  sessionId: string;
  socket: WebSocket;
};

const clients = new Map<WebSocket, ClientRecord>();

function send(socket: WebSocket, event: ServerEnvelope) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(event));
  }
}

function broadcastRoom(roomCode: string, event: ServerEnvelope) {
  for (const client of clients.values()) {
    if (client.roomCode === roomCode) {
      send(client.socket, event);
    }
  }
}

function nack(socket: WebSocket, eventId: string, message: string) {
  send(socket, {
    type: "server.nack",
    eventId,
    accepted: false,
    code: "INVALID_EVENT",
    message,
    recoverable: true,
  });
}

function handleClientEvent(socket: WebSocket, roomCode: string, raw: Buffer) {
  let event: ClientEnvelope;
  try {
    event = JSON.parse(raw.toString()) as ClientEnvelope;
  } catch {
    nack(socket, makeEventId("bad_json"), "Message is not valid JSON.");
    return;
  }

  if (!event.type || !event.eventId || !event.deviceId || !event.sessionId) {
    nack(socket, event.eventId ?? makeEventId("bad_event"), "Event envelope is incomplete.");
    return;
  }

  if (event.type === "client.hello") {
    const payload = event.payload as ClientHelloPayload;
    const state = registerSession({
      roomCode,
      deviceId: event.deviceId,
      sessionId: event.sessionId,
      role: payload.role,
      clientSeq: event.clientSeq,
    });

    if (!state) {
      send(socket, {
        type: "server.nack",
        eventId: event.eventId,
        accepted: false,
        code: "ROOM_NOT_FOUND",
        message: "Room does not exist.",
        recoverable: false,
      });
      return;
    }

    clients.set(socket, { roomCode, deviceId: event.deviceId, sessionId: event.sessionId, socket });
    send(socket, {
      type: "server.welcome",
      eventId: makeEventId("welcome"),
      roomId: state.roomId,
      roomCode: state.roomCode,
      deviceId: event.deviceId,
      sessionId: event.sessionId,
      serverTime: Date.now(),
      roomRevision: state.roomRevision,
      serverSeq: state.serverSeq,
      state,
    });
    broadcastRoom(roomCode, {
      type: "room.patch",
      eventId: makeEventId("patch"),
      roomRevision: state.roomRevision,
      serverSeq: state.serverSeq,
      state,
    });
    return;
  }

  if (event.type === "role.set") {
    const payload = event.payload as RoleSetPayload;
    if (payload.role !== "control" && payload.role !== "player") {
      nack(socket, event.eventId, "Role must be control or player.");
      return;
    }

    const state = setDeviceRole({
      roomCode,
      deviceId: event.deviceId,
      sessionId: event.sessionId,
      role: payload.role,
      clientSeq: event.clientSeq,
    });
    if (!state) {
      send(socket, {
        type: "server.nack",
        eventId: event.eventId,
        accepted: false,
        code: "ROOM_NOT_FOUND",
        message: "Room does not exist.",
        recoverable: false,
      });
      return;
    }

    send(socket, {
      type: "server.ack",
      eventId: event.eventId,
      accepted: true,
      roomRevision: state.roomRevision,
      serverSeq: state.serverSeq,
      serverTime: Date.now(),
    });
    broadcastRoom(roomCode, {
      type: "room.patch",
      eventId: makeEventId("patch"),
      roomRevision: state.roomRevision,
      serverSeq: state.serverSeq,
      state,
    });
    return;
  }

  if (event.type === "presence.heartbeat") {
    const state = heartbeat({
      roomCode,
      deviceId: event.deviceId,
      sessionId: event.sessionId,
      clientSeq: event.clientSeq,
    });
    if (state) {
      send(socket, {
        type: "server.ack",
        eventId: event.eventId,
        accepted: true,
        roomRevision: state.roomRevision,
        serverSeq: state.serverSeq,
        serverTime: Date.now(),
      });
    }
    return;
  }

  if (event.type === "playback.setScrollClock") {
    const payload = event.payload as SetScrollClockPayload;
    const state = payload.scrollClock
      ? setScrollClock({
          roomCode,
          deviceId: event.deviceId,
          sessionId: event.sessionId,
          clientSeq: event.clientSeq,
          scrollClock: payload.scrollClock,
        })
      : null;
    if (!state) {
      nack(socket, event.eventId, "Invalid ScrollClock payload.");
      return;
    }
    send(socket, {
      type: "server.ack",
      eventId: event.eventId,
      accepted: true,
      roomRevision: state.roomRevision,
      serverSeq: state.serverSeq,
      serverTime: Date.now(),
    });
    broadcastRoom(roomCode, {
      type: "room.patch",
      eventId: makeEventId("patch"),
      roomRevision: state.roomRevision,
      serverSeq: state.serverSeq,
      state,
    });
    return;
  }

  if (event.type === "playback.reportState") {
    const payload = event.payload as PlaybackReportPayload;
    const state = payload.playbackState
      ? reportPlaybackState({
          roomCode,
          deviceId: event.deviceId,
          sessionId: event.sessionId,
          clientSeq: event.clientSeq,
          playbackState: payload.playbackState,
        })
      : null;
    if (!state) {
      nack(socket, event.eventId, "Invalid PlaybackState payload.");
      return;
    }
    broadcastRoom(roomCode, {
      type: "room.patch",
      eventId: makeEventId("patch"),
      roomRevision: state.roomRevision,
      serverSeq: state.serverSeq,
      state,
    });
    return;
  }

  if (event.type === "voice.setSource") {
    const payload = event.payload as VoiceSetSourcePayload;
    const state = setVoiceSource({ roomCode, sourceDeviceId: payload.sourceDeviceId });
    if (!state) {
      nack(socket, event.eventId, "Invalid voice source.");
      return;
    }
    send(socket, {
      type: "server.ack",
      eventId: event.eventId,
      accepted: true,
      roomRevision: state.roomRevision,
      serverSeq: state.serverSeq,
      serverTime: Date.now(),
    });
    broadcastRoom(roomCode, {
      type: "room.patch",
      eventId: makeEventId("patch"),
      roomRevision: state.roomRevision,
      serverSeq: state.serverSeq,
      state,
    });
    return;
  }

  if (event.type === "voice.transcript") {
    const payload = event.payload as VoiceTranscriptPayload;
    const state = payload.transcript
      ? processVoiceTranscript({ roomCode, transcript: payload.transcript })
      : null;
    if (!state) {
      nack(socket, event.eventId, "Invalid voice transcript.");
      return;
    }
    broadcastRoom(roomCode, {
      type: "room.patch",
      eventId: makeEventId("patch"),
      roomRevision: state.roomRevision,
      serverSeq: state.serverSeq,
      state,
    });
    return;
  }

  nack(socket, event.eventId, `Unsupported event: ${event.type}`);
}

export function attachRoomWebSocketServer(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request: IncomingMessage, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const match = url.pathname.match(/^\/ws\/rooms\/([^/]+)$/);
    if (!match) {
      return;
    }

    const roomCode = match[1];
    if (!getRoomState(roomCode)) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request, roomCode);
    });
  });

  wss.on("connection", (socket: WebSocket, _request: IncomingMessage, roomCode: string) => {
    socket.on("message", (raw: Buffer) => handleClientEvent(socket, roomCode, raw));
    socket.on("close", () => {
      const client = clients.get(socket);
      if (!client) {
        return;
      }
      clients.delete(socket);
      const state = disconnectSession(client);
      if (state) {
        broadcastRoom(client.roomCode, {
          type: "room.patch",
          eventId: makeEventId("patch"),
          roomRevision: state.roomRevision,
          serverSeq: state.serverSeq,
          state,
        });
      }
    });
  });
}
