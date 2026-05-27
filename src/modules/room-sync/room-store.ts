import type { DevicePresence, DeviceRole, RoomJoinResult, RoomState } from "../../domain/room/types";

const OFFLINE_AFTER_MS = 30_000;

type RoomRecord = {
  state: RoomState;
  joinTokens: Map<string, string>;
};

const roomsByCode = new Map<string, RoomRecord>();

function now() {
  return Date.now();
}

function randomDigits(length: number) {
  let value = "";
  for (let i = 0; i < length; i += 1) {
    value += Math.floor(Math.random() * 10).toString();
  }
  return value;
}

function createRoomCode() {
  let roomCode = randomDigits(6);
  while (roomsByCode.has(roomCode)) {
    roomCode = randomDigits(6);
  }
  return roomCode;
}

function createDevicePresence(deviceId: string, at: number): DevicePresence {
  return {
    deviceId,
    sessionId: null,
    role: null,
    online: false,
    connectionState: "offline",
    lastSeenAt: at,
    lastClientSeq: 0,
    capabilities: {},
    isVoiceSource: false,
  };
}

function cloneState(state: RoomState): RoomState {
  return structuredClone(state);
}

function touchRoom(record: RoomRecord, at = now()) {
  record.state.updatedAt = at;
}

function bumpRoomFact(record: RoomRecord, at = now()) {
  record.state.roomRevision += 1;
  record.state.serverSeq += 1;
  touchRoom(record, at);
}

function markExpiredDevices(record: RoomRecord, at = now()) {
  let changed = false;
  for (const device of Object.values(record.state.devices)) {
    if (device.online && at - device.lastSeenAt > OFFLINE_AFTER_MS) {
      device.online = false;
      device.connectionState = "offline";
      device.sessionId = null;
      changed = true;
    }
  }

  if (changed) {
    bumpRoomFact(record, at);
  }
}

export function createRoom(): RoomJoinResult {
  const at = now();
  const roomCode = createRoomCode();
  const roomId = `room_${crypto.randomUUID()}`;
  const deviceId = `dev_${crypto.randomUUID()}`;
  const joinToken = `join_${crypto.randomUUID()}`;
  const state: RoomState = {
    roomId,
    roomCode,
    status: "active",
    currentScriptVersionId: null,
    currentDraftId: null,
    currentControlMode: "fixedSpeed",
    displayConfig: null,
    scrollClock: null,
    voiceState: null,
    devices: {
      [deviceId]: createDevicePresence(deviceId, at),
    },
    roomRevision: 1,
    serverSeq: 1,
    createdAt: at,
    updatedAt: at,
  };

  const record: RoomRecord = {
    state,
    joinTokens: new Map([[deviceId, joinToken]]),
  };
  roomsByCode.set(roomCode, record);

  return {
    roomId,
    roomCode,
    deviceId,
    joinToken,
    wsUrl: `/ws/rooms/${roomCode}`,
    roomState: cloneState(state),
    lastRoomRevision: state.roomRevision,
  };
}

export function joinRoom(roomCode: string, existingDeviceId?: string | null): RoomJoinResult | null {
  const record = roomsByCode.get(roomCode);
  if (!record) {
    return null;
  }

  const at = now();
  markExpiredDevices(record, at);

  const deviceId =
    existingDeviceId && record.state.devices[existingDeviceId] ? existingDeviceId : `dev_${crypto.randomUUID()}`;
  if (!record.state.devices[deviceId]) {
    record.state.devices[deviceId] = createDevicePresence(deviceId, at);
    bumpRoomFact(record, at);
  }

  const joinToken = `join_${crypto.randomUUID()}`;
  record.joinTokens.set(deviceId, joinToken);
  touchRoom(record, at);

  return {
    roomId: record.state.roomId,
    roomCode,
    deviceId,
    joinToken,
    wsUrl: `/ws/rooms/${roomCode}`,
    roomState: cloneState(record.state),
    lastRoomRevision: record.state.roomRevision,
  };
}

export function getRoomState(roomCode: string): RoomState | null {
  const record = roomsByCode.get(roomCode);
  if (!record) {
    return null;
  }
  markExpiredDevices(record);
  return cloneState(record.state);
}

export function registerSession(input: {
  roomCode: string;
  deviceId: string;
  sessionId: string;
  role: DeviceRole | null;
  clientSeq: number;
}): RoomState | null {
  const record = roomsByCode.get(input.roomCode);
  if (!record) {
    return null;
  }

  const at = now();
  const existing = record.state.devices[input.deviceId] ?? createDevicePresence(input.deviceId, at);
  const previous = { ...existing };
  existing.sessionId = input.sessionId;
  existing.online = true;
  existing.connectionState = "online";
  existing.lastSeenAt = at;
  existing.lastClientSeq = Math.max(existing.lastClientSeq, input.clientSeq);
  if (input.role) {
    existing.role = input.role;
  }
  record.state.devices[input.deviceId] = existing;

  if (
    previous.sessionId !== existing.sessionId ||
    previous.online !== existing.online ||
    previous.connectionState !== existing.connectionState ||
    previous.role !== existing.role
  ) {
    bumpRoomFact(record, at);
  } else {
    record.state.serverSeq += 1;
    touchRoom(record, at);
  }

  return cloneState(record.state);
}

export function setDeviceRole(input: {
  roomCode: string;
  deviceId: string;
  sessionId: string;
  role: DeviceRole;
  clientSeq: number;
}): RoomState | null {
  const record = roomsByCode.get(input.roomCode);
  if (!record) {
    return null;
  }

  const at = now();
  const device = record.state.devices[input.deviceId] ?? createDevicePresence(input.deviceId, at);
  device.sessionId = input.sessionId;
  device.role = input.role;
  device.online = true;
  device.connectionState = "online";
  device.lastSeenAt = at;
  device.lastClientSeq = Math.max(device.lastClientSeq, input.clientSeq);
  record.state.devices[input.deviceId] = device;
  bumpRoomFact(record, at);
  return cloneState(record.state);
}

export function heartbeat(input: {
  roomCode: string;
  deviceId: string;
  sessionId: string;
  clientSeq: number;
}): RoomState | null {
  const record = roomsByCode.get(input.roomCode);
  if (!record) {
    return null;
  }

  const at = now();
  const device = record.state.devices[input.deviceId];
  if (!device) {
    return null;
  }

  device.sessionId = input.sessionId;
  device.online = true;
  device.connectionState = "online";
  device.lastSeenAt = at;
  device.lastClientSeq = Math.max(device.lastClientSeq, input.clientSeq);
  record.state.serverSeq += 1;
  touchRoom(record, at);
  return cloneState(record.state);
}

export function disconnectSession(input: { roomCode: string; deviceId: string; sessionId: string }): RoomState | null {
  const record = roomsByCode.get(input.roomCode);
  if (!record) {
    return null;
  }

  const device = record.state.devices[input.deviceId];
  if (!device || device.sessionId !== input.sessionId) {
    return cloneState(record.state);
  }

  const at = now();
  device.online = false;
  device.connectionState = "offline";
  device.sessionId = null;
  device.lastSeenAt = at;
  bumpRoomFact(record, at);
  return cloneState(record.state);
}
