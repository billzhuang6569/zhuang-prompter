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
  currentAnchor: Anchor;
  velocityPxPerSecond: number;
  controlMode: ControlMode;
  sourceDeviceId: string;
  scrollClockId?: string;
  reportedAt: number;
  serverReceivedAt?: number;
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

export type RoomState = {
  roomId: string;
  roomCode: string;
  status: "active" | "closed";
  currentScriptVersionId: null;
  currentDraftId: null;
  currentControlMode: ControlMode;
  displayConfig: null;
  scrollClock: ScrollClock | null;
  voiceState: null;
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
