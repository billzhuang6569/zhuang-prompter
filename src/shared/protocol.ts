import type { DeviceRole, PlaybackState, RoomState, ScrollClock, VoiceTranscript } from "../domain/room/types";
import { makeRandomId } from "./id";

export type ClientEventType =
  | "client.hello"
  | "role.set"
  | "presence.heartbeat"
  | "playback.setScrollClock"
  | "playback.reportState"
  | "voice.setSource"
  | "voice.transcript";
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

export type SetScrollClockPayload = {
  scrollClock: Omit<ScrollClock, "roomRevision">;
};

export type PlaybackReportPayload = {
  playbackState: PlaybackState;
};

export type VoiceSetSourcePayload = {
  sourceDeviceId: string | null;
};

export type VoiceTranscriptPayload = {
  transcript: Omit<VoiceTranscript, "receivedAt" | "normalizedText">;
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
  return makeRandomId(prefix);
}
