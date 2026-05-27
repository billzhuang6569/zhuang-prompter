export type DeviceRole = "control" | "player";

export type DeviceConnectionState = "online" | "reconnecting" | "offline";

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
};

export type RoomState = {
  roomId: string;
  roomCode: string;
  status: "active" | "closed";
  currentScriptVersionId: null;
  currentDraftId: null;
  currentControlMode: "fixedSpeed";
  displayConfig: null;
  scrollClock: null;
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
