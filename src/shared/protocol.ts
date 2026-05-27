import type { DeviceRole, RoomState } from "../domain/room/types";

export type ClientEventType = "client.hello" | "role.set" | "presence.heartbeat";
export type ServerEventType =
  | "server.welcome"
  | "server.ack"
  | "server.nack"
  | "room.state"
  | "room.patch"
  | "device.presenceChanged";

export type ClientEnvelope<TPayload = unknown> = {
  type: ClientEventType;
  eventId: string;
  roomId?: string;
  deviceId: string;
  sessionId: string;
  clientSeq: number;
  baseRoomRevision: number;
  sentAt: number;
  payload: TPayload;
};

export type ClientHelloPayload = {
  role: DeviceRole | null;
  lastSeenRoomRevision: number;
  lastSeenServerSeq: number;
};

export type RoleSetPayload = {
  role: DeviceRole;
};

export type ServerAck = {
  type: "server.ack";
  eventId: string;
  accepted: true;
  roomRevision: number;
  serverSeq: number;
  serverTime: number;
};

export type ServerNack = {
  type: "server.nack";
  eventId: string;
  accepted: false;
  code: "ROOM_NOT_FOUND" | "INVALID_EVENT" | "STALE_ROOM_REVISION";
  message: string;
  roomRevision?: number;
  recoverable: boolean;
};

export type ServerWelcome = {
  type: "server.welcome";
  eventId: string;
  roomId: string;
  roomCode: string;
  deviceId: string;
  sessionId: string;
  serverTime: number;
  roomRevision: number;
  serverSeq: number;
  state: RoomState;
};

export type RoomStateEvent = {
  type: "room.state";
  eventId: string;
  roomRevision: number;
  serverSeq: number;
  state: RoomState;
};

export type RoomPatchEvent = {
  type: "room.patch";
  eventId: string;
  roomRevision: number;
  serverSeq: number;
  state: RoomState;
};

export type ServerEnvelope = ServerAck | ServerNack | ServerWelcome | RoomStateEvent | RoomPatchEvent;

export function makeEventId(prefix = "evt") {
  return `${prefix}_${crypto.randomUUID()}`;
}
