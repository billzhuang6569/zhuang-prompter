import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  DevicePresence,
  DeviceRole,
  PlaybackState,
  RoomJoinResult,
  RoomSettings,
  RoomState,
  ScriptDraft,
  ScriptVersion,
  ScrollClock,
  VoiceMatchLevel,
  VoiceTranscript,
} from "../../domain/room/types";
import { extensionSpecFixture, parseMarkdown } from "../script-engine";

const OFFLINE_AFTER_MS = 30_000;
const STORE_FILE = process.env.ZHUANG_PROMPTER_STORE_FILE ?? join(process.cwd(), ".local-data", "rooms.json");

export type RoomSummary = {
  roomId: string;
  roomCode: string;
  projectName: string;
  status: RoomState["status"];
  createdAt: number;
  updatedAt: number;
  draftRevision: number;
  markerCount: number;
  versionCount: number;
  previewText: string;
};

type RoomRecord = {
  state: RoomState;
  joinTokens: Map<string, string>;
};

const roomsByCode = new Map<string, RoomRecord>();

const defaultRoomSettings: RoomSettings = {
  projectName: "小庄Sir013",
  playbackSpeedPxPerSecond: 68,
  playerFontScale: 1,
  playerMirrorX: false,
  playerMirrorY: false,
  playerMarkersVisible: false,
};

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

function withDefaultSettings(settings?: Partial<RoomSettings> | null): RoomSettings {
  return {
    ...defaultRoomSettings,
    ...(settings ?? {}),
  };
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

function hashContent(markdown: string) {
  let hash = 0x811c9dc5;
  for (const char of markdown) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function createDraft(roomId: string, deviceId: string, at: number, markdown = extensionSpecFixture): ScriptDraft {
  return {
    draftId: `draft_${crypto.randomUUID()}`,
    roomId,
    markdown,
    updatedBy: deviceId,
    updatedAt: at,
    draftRevision: 1,
    parseStatus: "valid",
  };
}

function summarizeVersion(version: ScriptVersion) {
  return {
    versionId: version.versionId,
    message: version.message,
    createdBy: version.createdBy,
    createdAt: version.createdAt,
    contentHash: version.contentHash,
    markerCount: version.markerIndexSnapshot.length,
    markdownLength: version.markdown.length,
  };
}

function cloneState(state: RoomState): RoomState {
  return structuredClone(state);
}

function sanitizeLoadedState(state: RoomState): RoomState {
  const sanitized = structuredClone(state);
  sanitized.settings = withDefaultSettings(sanitized.settings);
  sanitized.voiceState = {
    active: false,
    sourceDeviceId: null,
    status: "idle",
  };
  sanitized.scrollClock = null;
  for (const device of Object.values(sanitized.devices ?? {})) {
    device.online = false;
    device.connectionState = "offline";
    device.sessionId = null;
    device.isVoiceSource = false;
    delete device.playbackState;
  }
  return sanitized;
}

function persistRooms() {
  mkdirSync(dirname(STORE_FILE), { recursive: true });
  const states = Array.from(roomsByCode.values()).map((record) => record.state);
  writeFileSync(STORE_FILE, JSON.stringify({ rooms: states }, null, 2));
}

function loadPersistedRooms() {
  if (!existsSync(STORE_FILE)) {
    return;
  }

  try {
    const parsed = JSON.parse(readFileSync(STORE_FILE, "utf8")) as { rooms?: RoomState[] };
    for (const state of parsed.rooms ?? []) {
      if (!state?.roomCode || roomsByCode.has(state.roomCode)) {
        continue;
      }
      roomsByCode.set(state.roomCode, {
        state: sanitizeLoadedState(state),
        joinTokens: new Map(),
      });
    }
  } catch {
    // Keep the live room service available even if the local cache is corrupt.
  }
}

loadPersistedRooms();

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
  const scriptDraft = createDraft(roomId, deviceId, at);
  const state: RoomState = {
    roomId,
    roomCode,
    status: "active",
    settings: withDefaultSettings(),
    currentScriptVersionId: null,
    currentDraftId: scriptDraft.draftId,
    scriptDraft,
    scriptVersions: [],
    currentControlMode: "fixedSpeed",
    displayConfig: null,
    scrollClock: null,
    voiceState: {
      active: false,
      sourceDeviceId: null,
      status: "idle",
    },
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
  persistRooms();

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

export function listRooms(): RoomSummary[] {
  return Array.from(roomsByCode.values())
    .map((record) => {
      const bundle = parseMarkdown(record.state.scriptDraft.markdown);
      const previewText = record.state.scriptDraft.markdown
        .replace(/:{1,2}(?:marker|notes?)(?:\[[^\]]*])?\{[^}]*}/g, "")
        .replace(/[#*_`>|-]/g, "")
        .split(/\s+/)
        .join(" ")
        .trim()
        .slice(0, 80);
      return {
        roomId: record.state.roomId,
        roomCode: record.state.roomCode,
        projectName: record.state.settings.projectName,
        status: record.state.status,
        createdAt: record.state.createdAt,
        updatedAt: record.state.updatedAt,
        draftRevision: record.state.scriptDraft.draftRevision,
        markerCount: bundle.markerIndex.length,
        versionCount: record.state.scriptVersions.length,
        previewText,
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
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

export function updateRoomSettings(input: {
  roomCode: string;
  settings: Partial<RoomSettings>;
}): RoomState | null {
  const record = roomsByCode.get(input.roomCode);
  if (!record) {
    return null;
  }

  const nextSettings: RoomSettings = withDefaultSettings(record.state.settings);
  if (input.settings.projectName !== undefined) nextSettings.projectName = input.settings.projectName;
  if (input.settings.playbackSpeedPxPerSecond !== undefined) {
    nextSettings.playbackSpeedPxPerSecond = input.settings.playbackSpeedPxPerSecond;
  }
  if (input.settings.playerFontScale !== undefined) nextSettings.playerFontScale = input.settings.playerFontScale;
  if (input.settings.playerMirrorX !== undefined) nextSettings.playerMirrorX = input.settings.playerMirrorX;
  if (input.settings.playerMirrorY !== undefined) nextSettings.playerMirrorY = input.settings.playerMirrorY;
  if (input.settings.playerMarkersVisible !== undefined) nextSettings.playerMarkersVisible = input.settings.playerMarkersVisible;
  record.state.settings = withDefaultSettings(nextSettings);
  bumpRoomFact(record);
  persistRooms();
  return cloneState(record.state);
}

export function getRoomState(roomCode: string): RoomState | null {
  const record = roomsByCode.get(roomCode);
  if (!record) {
    return null;
  }
  markExpiredDevices(record);
  return cloneState(record.state);
}

export function getScriptDraft(roomCode: string): ScriptDraft | null {
  const record = roomsByCode.get(roomCode);
  if (!record) {
    return null;
  }
  return structuredClone(record.state.scriptDraft);
}

export function updateScriptDraft(input: {
  roomCode: string;
  deviceId: string;
  markdown: string;
}): RoomState | null {
  const record = roomsByCode.get(input.roomCode);
  if (!record) {
    return null;
  }

  const at = now();
  record.state.scriptDraft = {
    ...record.state.scriptDraft,
    markdown: input.markdown,
    updatedBy: input.deviceId,
    updatedAt: at,
    draftRevision: record.state.scriptDraft.draftRevision + 1,
    parseStatus: parseMarkdown(input.markdown).parseWarnings.length > 0 ? "warning" : "valid",
  };
  record.state.currentDraftId = record.state.scriptDraft.draftId;
  record.state.currentScriptVersionId = null;
  record.state.scrollClock = null;
  bumpRoomFact(record, at);
  persistRooms();
  return cloneState(record.state);
}

export function saveScriptVersion(input: {
  roomCode: string;
  deviceId: string;
  message?: string;
}): ScriptVersion | null {
  const record = roomsByCode.get(input.roomCode);
  if (!record) {
    return null;
  }

  const at = now();
  const bundle = parseMarkdown(record.state.scriptDraft.markdown);
  const version: ScriptVersion = {
    versionId: `ver_${crypto.randomUUID()}`,
    roomId: record.state.roomId,
    markdown: record.state.scriptDraft.markdown,
    message: input.message,
    displayConfigSnapshot: null,
    markerIndexSnapshot: bundle.markerIndex.map((marker) => ({
      markerId: marker.markerId,
      type: marker.type,
      label: marker.label,
      note: marker.note,
      text: marker.text,
    })),
    contentHash: hashContent(record.state.scriptDraft.markdown),
    createdBy: input.deviceId,
    createdAt: at,
  };
  record.state.scriptVersions.unshift(version);
  record.state.currentScriptVersionId = version.versionId;
  bumpRoomFact(record, at);
  persistRooms();
  return structuredClone(version);
}

export function listScriptVersions(roomCode: string) {
  const record = roomsByCode.get(roomCode);
  if (!record) {
    return null;
  }
  return record.state.scriptVersions.map(summarizeVersion);
}

export function restoreScriptVersion(input: {
  roomCode: string;
  deviceId: string;
  versionId: string;
}): RoomState | null {
  const record = roomsByCode.get(input.roomCode);
  if (!record) {
    return null;
  }
  const version = record.state.scriptVersions.find((candidate) => candidate.versionId === input.versionId);
  if (!version) {
    return null;
  }

  const at = now();
  record.state.scriptDraft = {
    draftId: `draft_${crypto.randomUUID()}`,
    roomId: record.state.roomId,
    markdown: version.markdown,
    updatedBy: input.deviceId,
    updatedAt: at,
    draftRevision: record.state.scriptDraft.draftRevision + 1,
    parseStatus: parseMarkdown(version.markdown).parseWarnings.length > 0 ? "warning" : "valid",
  };
  record.state.currentDraftId = record.state.scriptDraft.draftId;
  record.state.currentScriptVersionId = version.versionId;
  record.state.scrollClock = null;
  bumpRoomFact(record, at);
  persistRooms();
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

export function setScrollClock(input: {
  roomCode: string;
  deviceId: string;
  sessionId: string;
  clientSeq: number;
  scrollClock: Omit<ScrollClock, "roomRevision">;
}): RoomState | null {
  const record = roomsByCode.get(input.roomCode);
  if (!record) {
    return null;
  }

  const at = now();
  const device = record.state.devices[input.deviceId] ?? createDevicePresence(input.deviceId, at);
  device.sessionId = input.sessionId;
  device.online = true;
  device.connectionState = "online";
  device.lastSeenAt = at;
  device.lastClientSeq = Math.max(device.lastClientSeq, input.clientSeq);
  record.state.devices[input.deviceId] = device;
  bumpRoomFact(record, at);
  record.state.scrollClock = {
    ...input.scrollClock,
    sourceDeviceId: input.deviceId,
    roomRevision: record.state.roomRevision,
  };
  record.state.currentControlMode = input.scrollClock.controlMode;
  touchRoom(record, at);
  return cloneState(record.state);
}

export function reportPlaybackState(input: {
  roomCode: string;
  deviceId: string;
  sessionId: string;
  clientSeq: number;
  playbackState: PlaybackState;
}): RoomState | null {
  const record = roomsByCode.get(input.roomCode);
  if (!record) {
    return null;
  }

  const at = now();
  const device = record.state.devices[input.deviceId] ?? createDevicePresence(input.deviceId, at);
  device.sessionId = input.sessionId;
  device.online = true;
  device.connectionState = "online";
  device.lastSeenAt = at;
  device.lastClientSeq = Math.max(device.lastClientSeq, input.clientSeq);
  device.playbackState = {
    ...input.playbackState,
    serverReceivedAt: at,
  };
  record.state.devices[input.deviceId] = device;
  record.state.serverSeq += 1;
  touchRoom(record, at);
  return cloneState(record.state);
}

export function setVoiceSource(input: {
  roomCode: string;
  sourceDeviceId: string | null;
}): RoomState | null {
  const record = roomsByCode.get(input.roomCode);
  if (!record) {
    return null;
  }
  const at = now();
  for (const device of Object.values(record.state.devices)) {
    device.isVoiceSource = input.sourceDeviceId === device.deviceId;
  }
  record.state.voiceState = {
    active: Boolean(input.sourceDeviceId),
    sourceDeviceId: input.sourceDeviceId,
    status: input.sourceDeviceId ? "active" : "idle",
    transcript: undefined,
    match: undefined,
  };
  bumpRoomFact(record, at);
  return cloneState(record.state);
}

export function processVoiceTranscript(input: {
  roomCode: string;
  transcript: Omit<VoiceTranscript, "receivedAt" | "normalizedText">;
}): RoomState | null {
  const record = roomsByCode.get(input.roomCode);
  if (!record || record.state.voiceState.sourceDeviceId !== input.transcript.sourceDeviceId) {
    return null;
  }

  const at = now();
  const normalizedText = normalizeForVoice(input.transcript.text);
  const transcript: VoiceTranscript = {
    ...input.transcript,
    normalizedText,
    receivedAt: at,
  };
  const bundle = parseMarkdown(record.state.scriptDraft.markdown, {
    scriptVersionId: record.state.currentScriptVersionId ?? "draft",
  });
  const match = findBestVoiceMatch(normalizedText, bundle.speechIndex, input.transcript.asrConfidence);
  const shouldAdvance =
    Boolean(match.matchedScrollAnchorId) && (input.transcript.isFinal ? match.confidence >= 0.48 : match.confidence >= 0.56);
  record.state.voiceState = {
    ...record.state.voiceState,
    transcript,
    match: {
      ...match,
      transcriptSegmentId: transcript.segmentId,
      shouldAdvance,
      reason: input.transcript.isFinal ? (shouldAdvance ? "voice_speed_adjust_ready" : match.reason) : "partial_transcript_hold",
      updatedAt: at,
    },
  };
  record.state.serverSeq += 1;
  touchRoom(record, at);
  return cloneState(record.state);
}

function normalizeForVoice(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function findBestVoiceMatch(
  normalizedText: string,
  speechIndex: ReturnType<typeof parseMarkdown>["speechIndex"],
  asrConfidence: number,
) {
  let best = {
    confidence: 0,
    level: "lost" as VoiceMatchLevel,
    reason: "no_match",
    matchedScrollAnchorId: undefined as string | undefined,
    matchedSpeechSegmentId: undefined as string | undefined,
    targetOffsetPx: undefined as number | undefined,
  };
  for (const item of speechIndex) {
    const candidate = normalizeForVoice(item.rawText);
    const overlap = normalizedOverlap(normalizedText, candidate);
    const confidence = Math.min(0.99, overlap * asrConfidence);
    if (confidence > best.confidence) {
      best = {
        confidence,
        level: confidence >= 0.78 ? "locked" : confidence >= 0.48 ? "probable" : confidence >= 0.28 ? "uncertain" : "lost",
        reason: confidence >= 0.78 ? "nearby_final_match" : "low_confidence_hold",
        matchedScrollAnchorId: item.scrollAnchorId,
        matchedSpeechSegmentId: item.speechSegmentId,
        targetOffsetPx: Math.max(0, (item.paragraphIndex - 1) * 360),
      };
    }
  }
  return best;
}

function normalizedOverlap(needle: string, haystack: string) {
  if (!needle || !haystack) {
    return 0;
  }
  if (haystack.includes(needle) || needle.includes(haystack)) {
    return 1;
  }

  const lcs = longestCommonSubstringLength(needle, haystack);
  const contiguousScore = lcs / Math.max(1, Math.min(needle.length, haystack.length));
  const bigramScore = diceCoefficient(bigrams(needle), bigrams(haystack));
  const charScore = diceCoefficient(Array.from(needle), Array.from(haystack));
  return Math.max(contiguousScore, bigramScore, charScore * 0.72);
}

function longestCommonSubstringLength(left: string, right: string) {
  const previous = new Array(right.length + 1).fill(0);
  const current = new Array(right.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = left[i - 1] === right[j - 1] ? previous[j - 1] + 1 : 0;
      if (current[j] > best) {
        best = current[j];
      }
    }
    previous.splice(0, previous.length, ...current);
    current.fill(0);
  }
  return best;
}

function bigrams(value: string) {
  if (value.length <= 1) {
    return Array.from(value);
  }
  const grams: string[] = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    grams.push(value.slice(index, index + 2));
  }
  return grams;
}

function diceCoefficient(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  const counts = new Map<string, number>();
  for (const item of right) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  let hits = 0;
  for (const item of left) {
    const count = counts.get(item) ?? 0;
    if (count > 0) {
      hits += 1;
      counts.set(item, count - 1);
    }
  }
  return (2 * hits) / (left.length + right.length);
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
