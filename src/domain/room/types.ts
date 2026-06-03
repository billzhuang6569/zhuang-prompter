export type DeviceRole = "control" | "player";

export type DeviceConnectionState = "online" | "reconnecting" | "offline";
export type ControlMode = "fixedSpeed" | "manual" | "voiceFollow";
export type PlaybackStatus = "playing" | "paused" | "frozen";

export type Anchor = {
  anchorId?: string;
  type: "marker" | "heading" | "paragraph" | "speechSegment" | "textHash" | "renderLine";
  markerId?: string;
  speechSegmentId?: string;
  headingText?: string;
  paragraphIndex?: number;
  textHash?: string;
  renderLineIndex?: number;
  fallbackTextHash?: string;
};

export type ScrollClock = {
  scrollClockId: string;
  scriptVersionId: string;
  state: PlaybackStatus;
  controlMode: ControlMode;
  anchor: Anchor;
  offsetPx: number;
  velocityPxPerSecond: number;
  issuedAt: number;
  sourceDeviceId: string;
  roomRevision: number;
};

export type PlaybackState = {
  scriptVersionId: string;
  state: PlaybackStatus;
  positionPx: number;
  viewportHeightPx?: number;
  contentHeightPx?: number;
  centerPositionRatio?: number;
  currentAnchor: Anchor;
  currentAnchorProgress?: number;
  velocityPxPerSecond: number;
  controlMode: ControlMode;
  sourceDeviceId: string;
  scrollClockId?: string;
  reportedAt: number;
  serverReceivedAt?: number;
};

export type ScriptDraft = {
  draftId: string;
  roomId: string;
  markdown: string;
  updatedBy: string;
  updatedAt: number;
  draftRevision: number;
  parseStatus: "valid" | "warning" | "error";
};

export type ScriptVersion = {
  versionId: string;
  roomId: string;
  markdown: string;
  message?: string;
  displayConfigSnapshot: null;
  markerIndexSnapshot: Array<{
    markerId: string;
    type: string;
    label?: string;
    note?: string;
    text?: string;
  }>;
  contentHash: string;
  createdBy: string;
  createdAt: number;
};

export type VoiceMatchLevel = "locked" | "probable" | "uncertain" | "lost";

export type VoiceTranscript = {
  segmentId: string;
  sourceDeviceId: string;
  scriptVersionId: string;
  isFinal: boolean;
  text: string;
  normalizedText: string;
  asrConfidence: number;
  receivedAt: number;
};

export type VoiceMatchResult = {
  transcriptSegmentId: string;
  matchedScrollAnchorId?: string;
  matchedSpeechSegmentId?: string;
  targetOffsetPx?: number;
  confidence: number;
  level: VoiceMatchLevel;
  shouldAdvance: boolean;
  reason: string;
  updatedAt: number;
};

export type VoiceState = {
  active: boolean;
  sourceDeviceId: string | null;
  status: "idle" | "active" | "permissionDenied" | "asrUnavailable";
  transcript?: VoiceTranscript;
  match?: VoiceMatchResult;
};

export type DevicePresence = {
  deviceId: string;
  sessionId: string | null;
  role: DeviceRole | null;
  online: boolean;
  connectionState: DeviceConnectionState;
  lastSeenAt: number;
  lastClientSeq: number;
  capabilities: {
    fullscreen?: boolean;
    microphone?: boolean;
    speechRecognition?: boolean;
    wakeLock?: boolean;
  };
  isVoiceSource: boolean;
  playbackState?: PlaybackState;
};

export type RoomSettings = {
  projectName: string;
  playbackSpeedPxPerSecond: number;
  playerFontScale: number;
  playerMirrorX: boolean;
  playerMirrorY: boolean;
  playerMarkersVisible: boolean;
  primaryPlayerDeviceId: string | null;
};

export type RoomState = {
  roomId: string;
  roomCode: string;
  status: "active" | "closed";
  settings: RoomSettings;
  currentScriptVersionId: string | null;
  currentDraftId: string;
  scriptDraft: ScriptDraft;
  scriptVersions: ScriptVersion[];
  currentControlMode: ControlMode;
  displayConfig: null;
  scrollClock: ScrollClock | null;
  voiceState: VoiceState;
  devices: Record<string, DevicePresence>;
  roomRevision: number;
  serverSeq: number;
  createdAt: number;
  updatedAt: number;
};

export type RoomJoinResult = {
  roomId: string;
  roomCode: string;
  deviceId: string;
  joinToken: string;
  wsUrl: string;
  roomState: RoomState;
  lastRoomRevision: number;
};
