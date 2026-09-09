"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, SetStateAction } from "react";
import Link from "next/link";
import type { Anchor, DeviceRole, PlaybackState, RoomJoinResult, RoomState, ScrollClock } from "@/domain/room/types";
import type {
  ClientEnvelope,
  ClientHelloPayload,
  PlaybackReportPayload,
  ServerEnvelope,
  SetScrollClockPayload,
} from "@/shared/protocol";
import type { RenderBundle } from "@/modules/script-engine";
import { parseMarkdown } from "@/modules/script-engine";
import { renumberMarkerDirectives } from "@/modules/script-engine/editing";
import { makeRandomId } from "@/shared/id";
import { effectivePrimary, readingAtY, readingY, offsetForReadingY } from "@/modules/playback-engine/reading-position";
import { followVelocity } from "@/modules/voice-follow/match";
import { ControlConsole } from "./control-console";
import { RenderBundleView } from "./render-bundle-view";

type RoomClientProps = {
  roomCode: string;
  mode: "select-role" | "control" | "player";
};

type ConnectionState = "joining" | "connecting" | "connected" | "disconnected" | "not-found";

function makeSessionId() {
  return makeRandomId("sess");
}

function makeEventId() {
  return makeRandomId("evt");
}

function deviceStorageKey(roomCode: string, role: DeviceRole | "select-role" | null) {
  return `zhuang-prompter:${roomCode}:${role ?? "select-role"}:deviceId`;
}

function preferredRole(mode: RoomClientProps["mode"]): DeviceRole | null {
  if (mode === "control") {
    return "control";
  }
  if (mode === "player") {
    return "player";
  }
  return null;
}

const DEFAULT_SPEED = 68;
const MIN_PLAYER_FONT_SCALE = 0.75;
const MAX_PLAYER_FONT_SCALE = 2;
const SCRIPT_VERSION_ID = "fixture_m1";

function currentTime() {
  return Date.now();
}

function monotonicTime() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function scrollClockRuntimeKey(clock: ScrollClock | null) {
  return clock
    ? [
        clock.scrollClockId,
        clock.state,
        clock.offsetPx,
        clock.velocityPxPerSecond,
        clock.issuedAt,
        JSON.stringify(clock.anchor),
      ].join(":")
    : "";
}

function playerDisplayMetrics(positionPx: number, bundle?: RenderBundle) {
  const content = document.querySelector<HTMLElement>(".player-stage .teleprompter-content");
  const viewportHeightPx = window.innerHeight;
  const contentHeightPx = content?.scrollHeight;
  const centerPositionRatio =
    contentHeightPx && contentHeightPx > viewportHeightPx ? Math.max(0, Math.min(1, positionPx / (contentHeightPx - viewportHeightPx))) : 0;
  const currentCenterAnchor = currentPlayerCenterAnchor(bundle);

  return {
    viewportHeightPx,
    contentHeightPx,
    centerPositionRatio,
    currentAnchor: currentCenterAnchor?.anchor,
    currentAnchorProgress: currentCenterAnchor?.progress,
  };
}

function currentPlayerCenterAnchor(bundle?: RenderBundle): { anchor: Anchor; progress: number } | undefined {
  if (!bundle) {
    return undefined;
  }
  const content = document.querySelector<HTMLElement>(".player-stage .teleprompter-content");
  if (!content) return undefined;
  const mirrored = Boolean(content.closest(".is-mirrored-y"));
  const position = readingAtY(content, bundle, window.innerHeight / 2, mirrored);
  return position ? { anchor: { type: "renderLine", ...position }, progress: 0.5 } : undefined;
}

function playerOffsetForMarker(markerId: string) {
  const content = document.querySelector<HTMLElement>(".player-stage .teleprompter-content");
  if (!content) {
    return undefined;
  }
  const markerElement = Array.from(content.querySelectorAll<HTMLElement>("[data-marker-id]")).find(
    (element) => element.dataset.markerId === markerId,
  );
  if (!markerElement) {
    return undefined;
  }
  return Math.max(0, markerElement.offsetTop + markerElement.offsetHeight / 2 - window.innerHeight / 2);
}

type VersionSummary = {
  versionId: string;
  message?: string;
  createdAt: number;
  markerCount: number;
  markdownLength: number;
};

type NetworkOrigin = {
  label: string;
  origin: string;
  kind: "local" | "lan";
};

type IconName =
  | "bolt"
  | "file"
  | "bookmark"
  | "comment"
  | "monitor"
  | "keyboard"
  | "qr"
  | "copy"
  | "invite"
  | "history"
  | "undo"
  | "play"
  | "pause"
  | "skipBack"
  | "skipForward"
  | "minus"
  | "plus"
  | "fullscreen"
  | "list"
  | "heading"
  | "bold"
  | "italic"
  | "strike"
  | "quote"
  | "code"
  | "link"
  | "image"
  | "table"
  | "save";

type MarkdownCommand =
  | "heading"
  | "bold"
  | "italic"
  | "strike"
  | "list"
  | "quote"
  | "code"
  | "link"
  | "image"
  | "table"
  | "marker"
  | "comment";

type PendingEditorAction = {
  kind: "marker" | "notes";
  pendingId: string;
  value: string;
};

type EditorInsertionTarget = {
  start: number;
  end: number;
};

type WakeLockSentinelLike = EventTarget & {
  released: boolean;
  release: () => Promise<void>;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

type SpeechRecognitionAlternativeLike = {
  transcript: string;
  confidence?: number;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
};

type SpeechRecognitionEventLike = Event & {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
};

type SpeechRecognitionErrorEventLike = Event & {
  error?: string;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

type LocalScrollClockTiming = {
  key: string;
  receivedAt: number;
  offsetPx: number;
  velocityPxPerSecond: number;
};

export function RoomClient({ roomCode, mode }: RoomClientProps) {
  const socketRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const roomRevisionRef = useRef(0);
  const serverSeqRef = useRef(0);
  const playbackPositionRef = useRef(0);
  const clientSeqRef = useRef(0);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const wakeLockReleaseHandlerRef = useRef<(() => void) | null>(null);
  const wakeLockWantedRef = useRef(false);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceAssistWantedRef = useRef(false);
  const voiceRestartTimerRef = useRef<number | undefined>(undefined);
  const voiceTranscriptFlushRef = useRef(0);
  const lastReadingAnchorRef = useRef<Anchor | undefined>(undefined);
  const voiceFailuresRef = useRef(0);
  const scrollClockRef = useRef<ScrollClock | null>(null);
  const scrollClockTimingRef = useRef<LocalScrollClockTiming | null>(null);
  const markdownEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const controlPreviewScrollRef = useRef<HTMLDivElement | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("joining");
  const [joinResult, setJoinResult] = useState<RoomJoinResult | null>(null);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [playbackPositionPx, setPlaybackPositionPx] = useState(0);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [markdown, setMarkdownState] = useState("");
  const setMarkdown = useCallback((update: SetStateAction<string>) => {
    setMarkdownState((current) => {
      const next = typeof update === "function" ? update(current) : update;
      return renumberMarkerDirectives(next);
    });
  }, []);
  const [versionMessage, setVersionMessage] = useState("");
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [saveStatus, setSaveStatus] = useState("");
  const [currentOrigin, setCurrentOrigin] = useState("");
  const [networkOrigins, setNetworkOrigins] = useState<NetworkOrigin[]>([]);
  const [playerFontScale, setPlayerFontScale] = useState(1);
  const [playerMirrorX, setPlayerMirrorX] = useState(false);
  const [playerMirrorY, setPlayerMirrorY] = useState(false);
  const [playerMarkersVisible, setPlayerMarkersVisible] = useState(false);
  const [playerOverlayHidden, setPlayerOverlayHidden] = useState(false);
  const [fullscreenActive, setFullscreenActive] = useState(false);
  const [wakeLockWanted, setWakeLockWanted] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [wakeLockStatus, setWakeLockStatus] = useState("");
  const [voiceAssistWanted, setVoiceAssistWanted] = useState(false);
  const [voiceAssistStatus, setVoiceAssistStatus] = useState("未开启");
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [expandedQrLink, setExpandedQrLink] = useState<(NetworkOrigin & { playerUrl: string }) | null>(null);
  const [projectName, setProjectName] = useState("小庄Sir013");
  const [inviteStatus, setInviteStatus] = useState<"idle" | "copied" | "fallback">("idle");
  const [pendingEditorAction, setPendingEditorAction] = useState<PendingEditorAction | null>(null);

  const selectedRole = preferredRole(mode);
  const scriptDraft = roomState?.scriptDraft;
  const roomLinks = useMemo(() => {
    const origins = new Map<string, NetworkOrigin>();
    if (currentOrigin) {
      origins.set(currentOrigin, { label: "当前浏览器", origin: currentOrigin, kind: "local" });
    }
    for (const origin of networkOrigins) {
      origins.set(origin.origin, origin);
    }
    return Array.from(origins.values()).map((origin) => ({
      ...origin,
      controlUrl: `${origin.origin}/room/${roomCode}/control`,
      playerUrl: `${origin.origin}/room/${roomCode}/player`,
    }));
  }, [currentOrigin, networkOrigins, roomCode]);
  const bundle = useMemo<RenderBundle | undefined>(() => {
    if (!markdown) {
      return undefined;
    }
    return parseMarkdown(markdown, { scriptVersionId: roomState?.currentScriptVersionId ?? "draft" });
  }, [markdown, roomState?.currentScriptVersionId]);
  const activeScrollClock = roomState?.scrollClock ?? null;
  const activeScrollClockKey = scrollClockRuntimeKey(activeScrollClock);
  const primaryPlayerDeviceId = roomState?.settings.primaryPlayerDeviceId ?? null;
  const primaryPlayerDevice = effectivePrimary(roomState?.devices ?? {}, primaryPlayerDeviceId);
  const primaryPlaybackState = primaryPlayerDevice?.playbackState;
  const latestRoomRef = useRef({ roomState, primaryPlaybackState });
  useLayoutEffect(() => { latestRoomRef.current = { roomState, primaryPlaybackState }; }, [roomState, primaryPlaybackState]);
  const isPrimaryPlayer = mode === "player" && Boolean(joinResult?.deviceId && joinResult.deviceId === primaryPlayerDevice?.deviceId);
  const primaryPlayerReportedPosition = primaryPlaybackState?.positionPx;
  const hasPlayerSyncRatio = typeof primaryPlaybackState?.centerPositionRatio === "number";
  const playbackCenterRatio =
    typeof primaryPlaybackState?.centerPositionRatio === "number"
      ? Math.max(0, Math.min(1, primaryPlaybackState.centerPositionRatio))
      : typeof primaryPlaybackState?.positionPx === "number" &&
          typeof primaryPlaybackState.viewportHeightPx === "number" &&
          typeof primaryPlaybackState.contentHeightPx === "number" &&
          primaryPlaybackState.contentHeightPx > primaryPlaybackState.viewportHeightPx
        ? Math.max(0, Math.min(1, primaryPlaybackState.positionPx / (primaryPlaybackState.contentHeightPx - primaryPlaybackState.viewportHeightPx)))
        : 0;
  const playerEntryLink = roomLinks.find((link) => link.kind === "lan") ?? roomLinks[0];
  const voiceMatch = roomState?.voiceState.match;
  const voiceAssistSummary = voiceAssistWanted
    ? voiceMatch
      ? `${voiceAssistStatus || "识别中"} · ${voiceMatch.level} ${Math.round(voiceMatch.confidence * 100)}%`
      : voiceAssistStatus || "正在听..."
    : voiceAssistStatus || "未开启";
  const playerStatusToast = wakeLockStatus || (mode === "player" && voiceAssistWanted ? voiceAssistSummary : "");

  const sendEvent = useCallback(
    <TPayload,>(type: ClientEnvelope<TPayload>["type"], payload: TPayload) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN || !joinResult) {
        return;
      }

      clientSeqRef.current += 1;
      const event: ClientEnvelope<TPayload> = {
        type,
        eventId: makeEventId(),
        roomId: joinResult.roomId,
        deviceId: joinResult.deviceId,
        sessionId: sessionIdRef.current ?? makeSessionId(),
        clientSeq: clientSeqRef.current,
        baseRoomRevision: roomRevisionRef.current,
        sentAt: Date.now(),
        payload,
      };
      socket.send(JSON.stringify(event));
    },
    [joinResult],
  );

  useEffect(() => {
    roomRevisionRef.current = roomState?.roomRevision ?? 0;
    serverSeqRef.current = roomState?.serverSeq ?? 0;
  }, [roomState?.roomRevision, roomState?.serverSeq]);

  useEffect(() => {
    scrollClockRef.current = activeScrollClock;
  }, [activeScrollClock]);

  useEffect(() => {
    if (!activeScrollClock || !activeScrollClockKey) {
      scrollClockTimingRef.current = null;
      return;
    }

    scrollClockTimingRef.current = {
      key: activeScrollClockKey,
      receivedAt: monotonicTime(),
      offsetPx: Math.max(0, activeScrollClock.offsetPx),
      velocityPxPerSecond: activeScrollClock.velocityPxPerSecond,
    };
    // The timing baseline must reset only when the semantic clock changes.
    // RoomState patches for playback reports reuse the same ScrollClock object
    // values and must not restart the local elapsed-time counter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeScrollClockKey]);

  useEffect(() => {
    let alive = true;
    const storageKey = deviceStorageKey(roomCode, selectedRole);
    const existingDeviceId = window.localStorage.getItem(storageKey);

    async function join() {
      setConnection("joining");
      const response = await fetch(`/api/rooms/${roomCode}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId: existingDeviceId }),
      });

      if (!alive) {
        return;
      }

      if (response.status === 404) {
        setConnection("not-found");
        return;
      }

      const result = (await response.json()) as RoomJoinResult;
      window.localStorage.setItem(storageKey, result.deviceId);
      setJoinResult(result);
      setRoomState(result.roomState);
      setConnection("connecting");
    }

    void join().catch(() => {
      if (alive) {
        setConnection("disconnected");
      }
    });

    return () => {
      alive = false;
    };
  }, [roomCode, selectedRole]);

  useEffect(() => {
    let alive = true;
    async function loadNetworkInfo() {
      const response = await fetch("/api/network-info");
      if (!response.ok || !alive) {
        return;
      }
      const data = (await response.json()) as { origins: NetworkOrigin[] };
      setNetworkOrigins(data.origins);
    }
    const timer = window.setTimeout(() => {
      if (alive) {
        setCurrentOrigin(window.location.origin);
      }
      void loadNetworkInfo().catch(() => undefined);
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!roomState?.settings) {
      return;
    }
    const settings = roomState.settings;
    const timer = window.setTimeout(() => {
      setProjectName(settings.projectName);
      setSpeed(settings.playbackSpeedPxPerSecond);
      setPlayerFontScale(settings.playerFontScale);
      setPlayerMirrorX(settings.playerMirrorX);
      setPlayerMirrorY(settings.playerMirrorY);
      setPlayerMarkersVisible(settings.playerMarkersVisible);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [roomState?.settings]);

  useEffect(() => {
    if (!joinResult || !roomState?.settings) {
      return;
    }
    const nextSettings = {
      projectName,
      playbackSpeedPxPerSecond: speed,
      playerFontScale,
      playerMirrorX,
      playerMirrorY,
      playerMarkersVisible,
    };
    if (
      roomState.settings.projectName === nextSettings.projectName &&
      roomState.settings.playbackSpeedPxPerSecond === nextSettings.playbackSpeedPxPerSecond &&
      roomState.settings.playerFontScale === nextSettings.playerFontScale &&
      roomState.settings.playerMirrorX === nextSettings.playerMirrorX &&
      roomState.settings.playerMirrorY === nextSettings.playerMirrorY &&
      roomState.settings.playerMarkersVisible === nextSettings.playerMarkersVisible
    ) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/rooms/${roomCode}/settings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(nextSettings),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) {
            return;
          }
          const data = (await response.json()) as { roomState: RoomState };
          setRoomState(data.roomState);
        })
        .catch(() => undefined);
    }, 350);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [joinResult, playerFontScale, playerMarkersVisible, playerMirrorX, playerMirrorY, projectName, roomCode, roomState?.settings, speed]);

  const loadDraftAndVersions = useCallback(async () => {
    const [draftResponse, versionsResponse] = await Promise.all([
      fetch(`/api/rooms/${roomCode}/script/draft`),
      fetch(`/api/rooms/${roomCode}/script/versions`),
    ]);
    if (draftResponse.ok) {
      const draft = (await draftResponse.json()) as { markdown: string; draftRevision: number; parseStatus: string };
      setMarkdown(normalizeEditableDirectives(draft.markdown));
    }
    if (versionsResponse.ok) {
      const data = (await versionsResponse.json()) as { versions: VersionSummary[] };
      setVersions(data.versions);
    }
  }, [roomCode, setMarkdown]);

  useEffect(() => {
    if (!joinResult) {
      return;
    }
    const timer = window.setTimeout(() => {
      void loadDraftAndVersions();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [joinResult, loadDraftAndVersions]);

  useEffect(() => {
    if (mode === "control" || !scriptDraft) {
      return;
    }
    const timer = window.setTimeout(() => {
      setMarkdown(normalizeEditableDirectives(scriptDraft.markdown));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [mode, scriptDraft, setMarkdown]);

  async function saveDraft() {
    if (!joinResult) {
      setSaveStatus("连接后再保存");
      return false;
    }
    setSaveStatus("正在保存");
    try {
      const response = await fetch(`/api/rooms/${roomCode}/script/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId: joinResult.deviceId, markdown }),
      });
      if (!response.ok) {
        setSaveStatus("保存失败");
        return false;
      }
      const data = (await response.json()) as { roomState: RoomState };
      setRoomState(data.roomState);
      setSaveStatus("草稿已保存");
      return true;
    } catch {
      setSaveStatus("保存失败，请刷新重试");
      return false;
    }
  }

  useEffect(() => {
    if (mode !== "control") return;
    const dirty = markdown !== normalizeEditableDirectives(scriptDraft?.markdown ?? "");
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    const saveAndHome = async () => {
      if (scrollClockRef.current?.state === "playing") { setSaveStatus("请先暂停播放再返回首页安装更新"); return; }
      if (await saveDraft()) window.location.href = "/";
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("prompter-save-and-home", saveAndHome);
    return () => { window.removeEventListener("beforeunload", beforeUnload); window.removeEventListener("prompter-save-and-home", saveAndHome); };
  });

  async function saveVersion() {
    if (!joinResult) {
      setSaveStatus("连接后再保存");
      return;
    }
    const draftSaved = await saveDraft();
    if (!draftSaved) {
      return;
    }
    try {
      const response = await fetch(`/api/rooms/${roomCode}/script/versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId: joinResult.deviceId, message: versionMessage || "现场保存" }),
      });
      if (!response.ok) {
        setSaveStatus("版本保存失败");
        return;
      }
      setVersionMessage("");
      await loadDraftAndVersions();
      setSaveStatus("版本已保存");
    } catch {
      setSaveStatus("版本保存失败，请刷新重试");
    }
  }

  async function restoreVersion(versionId: string) {
    if (!joinResult) {
      return;
    }
    try {
      const response = await fetch(`/api/rooms/${roomCode}/script/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId: joinResult.deviceId, versionId }),
      });
      if (!response.ok) {
        setSaveStatus("回退失败");
        return;
      }
      const data = (await response.json()) as { roomState: RoomState; draft: { markdown: string } };
      setRoomState(data.roomState);
      setMarkdown(normalizeEditableDirectives(data.draft.markdown));
      await loadDraftAndVersions();
      setSaveStatus("已回退版本");
    } catch {
      setSaveStatus("回退失败，请刷新重试");
    }
  }

  useEffect(() => {
    if (!joinResult) {
      return;
    }

    let closedByCleanup = false;
    let reconnectTimer: number | undefined;
    const connectingTimer = window.setTimeout(() => {
      if (!closedByCleanup) {
        setConnection("connecting");
      }
    }, 0);
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${window.location.host}${joinResult.wsUrl}`);
    const sessionId = makeSessionId();
    sessionIdRef.current = sessionId;
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      clientSeqRef.current += 1;
      const lastSeenRoomRevision = roomRevisionRef.current || joinResult.lastRoomRevision;
      const lastSeenServerSeq = serverSeqRef.current || joinResult.roomState.serverSeq;
      const hello: ClientEnvelope<ClientHelloPayload> = {
        type: "client.hello",
        eventId: makeEventId(),
        roomId: joinResult.roomId,
        deviceId: joinResult.deviceId,
        sessionId,
        clientSeq: clientSeqRef.current,
        baseRoomRevision: lastSeenRoomRevision,
        sentAt: Date.now(),
        payload: {
          role: selectedRole,
          lastSeenRoomRevision,
          lastSeenServerSeq,
        },
      };
      socket.send(JSON.stringify(hello));
      setConnection("connected");
    });

    socket.addEventListener("message", (message) => {
      const event = JSON.parse(message.data as string) as ServerEnvelope;
      if (event.type === "server.welcome" || event.type === "room.patch" || event.type === "room.state") {
        setRoomState(event.state);
      }
    });

    socket.addEventListener("close", () => {
      if (closedByCleanup) {
        return;
      }
      setConnection("disconnected");
      const delay = Math.min(5000, 600 + reconnectAttempt * 700);
      reconnectTimer = window.setTimeout(() => {
        setReconnectAttempt((attempt) => attempt + 1);
      }, delay);
    });

    const heartbeat = window.setInterval(() => {
      sendEvent("presence.heartbeat", {});
    }, 10_000);

    return () => {
      closedByCleanup = true;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      window.clearTimeout(connectingTimer);
      window.clearInterval(heartbeat);
      socket.close();
      sessionIdRef.current = null;
    };
  }, [joinResult, reconnectAttempt, selectedRole, sendEvent]);

  const devices = useMemo(() => Object.values(roomState?.devices ?? {}), [roomState]);
  const defaultAnchor = useMemo<Anchor>(() => {
    const speech = bundle?.speechIndex[0];
    if (speech) {
      return {
        type: "speechSegment",
        speechSegmentId: speech.speechSegmentId,
        paragraphIndex: speech.paragraphIndex,
        textHash: speech.textHash,
      };
    }
    const marker = bundle?.markerIndex[0];
    if (marker) {
      return { type: "marker", markerId: marker.markerId, textHash: marker.textHash };
    }
    return { type: "paragraph", paragraphIndex: 0 };
  }, [bundle]);

  function sendScrollClock(
    state: ScrollClock["state"],
    offsetPx = playbackPositionPx,
    velocity = speed,
    anchor = defaultAnchor,
    controlMode: ScrollClock["controlMode"] = "fixedSpeed",
  ) {
    if (!joinResult) {
      return;
    }
    const scrollClock: Omit<ScrollClock, "roomRevision"> = {
      scrollClockId: makeRandomId("clk"),
      scriptVersionId: SCRIPT_VERSION_ID,
      state,
      controlMode,
      anchor,
      offsetPx,
      velocityPxPerSecond: state === "playing" ? velocity : 0,
      issuedAt: currentTime(),
      sourceDeviceId: joinResult.deviceId,
    };
    const payload: SetScrollClockPayload = { scrollClock };
    sendEvent("playback.setScrollClock", payload);
  }

  function positionFromScrollClock(clock: ScrollClock) {
    if (clock.state !== "playing") {
      return Math.max(0, clock.offsetPx);
    }

    const key = scrollClockRuntimeKey(clock);
    const timing = scrollClockTimingRef.current;
    const offsetPx = timing?.key === key ? timing.offsetPx : clock.offsetPx;
    const velocityPxPerSecond = timing?.key === key ? timing.velocityPxPerSecond : clock.velocityPxPerSecond;
    const elapsedMs = timing?.key === key ? Math.max(0, monotonicTime() - timing.receivedAt) : 0;
    return Math.max(0, offsetPx + (elapsedMs / 1000) * velocityPxPerSecond);
  }

  function currentControlOffset() {
    const { primaryPlaybackState: report, roomState: latest } = latestRoomRef.current;
    if (report && report.scrollClockId === latest?.scrollClock?.scrollClockId) return report.positionPx;
    const clock = scrollClockRef.current;
    return clock ? positionFromScrollClock(clock) : report?.positionPx ?? playbackPositionRef.current;
  }

  function pauseAtCurrentOffset() {
    const offset = currentControlOffset();
    setPlaybackPositionPx(offset);
    playbackPositionRef.current = offset;
    sendScrollClock("paused", offset, 0);
  }

  function playFromCurrentOffset(nextSpeed = speed) {
    const offset = currentControlOffset();
    setPlaybackPositionPx(offset);
    playbackPositionRef.current = offset;
    sendScrollClock("playing", offset, nextSpeed);
  }

  function stopSpeechRecognition() {
    if (voiceRestartTimerRef.current) {
      window.clearTimeout(voiceRestartTimerRef.current);
      voiceRestartTimerRef.current = undefined;
    }
    const recognition = speechRecognitionRef.current;
    speechRecognitionRef.current = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.stop();
      } catch {
        recognition.abort();
      }
    }
  }

  function stopVoiceAssist(status = "自动识别已关闭") {
    voiceAssistWantedRef.current = false;
    setVoiceAssistWanted(false);
    setVoiceAssistStatus(status);
    stopSpeechRecognition();
    if (scrollClockRef.current?.controlMode === "voiceFollow") {
      sendScrollClock("paused", currentControlOffset(), 0);
    }
    if (joinResult && latestRoomRef.current.roomState?.voiceState.sourceDeviceId === joinResult.deviceId) {
      sendEvent("voice.setSource", { sourceDeviceId: null });
    }
  }

  async function startVoiceAssist(restarting = false) {
    if (!joinResult) {
      setVoiceAssistStatus("请先等待房间连接");
      return;
    }

    const Recognition = (window as SpeechRecognitionWindow).SpeechRecognition ?? (window as SpeechRecognitionWindow).webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceAssistWanted(false);
      setVoiceAssistStatus("此应用环境不支持语音识别。请在 Chrome 中打开本机控制端网址，使用自动识别。");
      return;
    }

    stopSpeechRecognition();
    voiceAssistWantedRef.current = true;
    setVoiceAssistWanted(true);
    if (!restarting && mode === "control") {
      setVoiceAssistStatus("正在保存稿件");
      await saveDraft();
    }
    if (!voiceAssistWantedRef.current) return;
    setVoiceAssistStatus("正在请求麦克风");
    if (!restarting) {
      voiceFailuresRef.current = 0;
      sendEvent("voice.setSource", { sourceDeviceId: joinResult.deviceId });
      sendScrollClock("playing", currentControlOffset(), 0, defaultAnchor, "voiceFollow");
    }

    const recognition = new Recognition();
    recognition.lang = "zh-CN";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      voiceFailuresRef.current = 0;
      let text = "";
      let isFinal = false;
      let confidence = 0;
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const alternative = result[0];
        text += alternative?.transcript ?? "";
        isFinal = isFinal || result.isFinal;
        confidence = Math.max(confidence, alternative?.confidence ?? 0);
      }

      const transcriptText = text.trim();
      if (!transcriptText) {
        return;
      }

      const at = currentTime();
      if (!isFinal && at - voiceTranscriptFlushRef.current < 550) {
        return;
      }
      voiceTranscriptFlushRef.current = at;
      setVoiceAssistStatus(isFinal ? "已识别，正在微调速度" : "正在听...");
      sendEvent("voice.transcript", {
        transcript: {
          segmentId: makeRandomId("seg"),
          sourceDeviceId: joinResult.deviceId,
          scriptVersionId: roomState?.currentScriptVersionId ?? SCRIPT_VERSION_ID,
          isFinal,
          text: transcriptText,
          asrConfidence: confidence || (isFinal ? 0.9 : 0.62),
        },
      });
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        stopVoiceAssist("麦克风权限被拒绝");
        return;
      }
      if (event.error !== "no-speech" && ++voiceFailuresRef.current >= 3) {
        stopVoiceAssist("语音服务不可用。请在 Chrome 中打开本机控制端，检查网络后重试。");
        return;
      }
      setVoiceAssistStatus("语音识别暂时中断，正在重试");
    };
    recognition.onend = () => {
      speechRecognitionRef.current = null;
      if (!voiceAssistWantedRef.current) {
        return;
      }
      voiceRestartTimerRef.current = window.setTimeout(() => {
        if (voiceAssistWantedRef.current) {
          void startVoiceAssist(true);
        }
      }, 700);
    };

    speechRecognitionRef.current = recognition;
    try {
      recognition.start();
      setVoiceAssistStatus("正在听...");
    } catch {
      stopVoiceAssist("语音识别启动失败，请刷新后重试");
    }
  }

  function toggleVoiceAssist() {
    if (voiceAssistWantedRef.current) {
      stopVoiceAssist();
      return;
    }
    void startVoiceAssist();
  }

  function nudgePlayback(deltaPx: number) {
    const offset = Math.max(0, currentControlOffset() + deltaPx);
    setPlaybackPositionPx(offset);
    playbackPositionRef.current = offset;
    sendScrollClock("paused", offset, 0);
  }

  function endPlaybackOffset() {
    const reportedState = primaryPlaybackState;
    if (
      typeof reportedState?.contentHeightPx === "number" &&
      typeof reportedState.viewportHeightPx === "number" &&
      reportedState.contentHeightPx > 0
    ) {
      return Math.max(0, reportedState.contentHeightPx - reportedState.viewportHeightPx);
    }

    const controlPreview = controlPreviewScrollRef.current;
    if (controlPreview) {
      return Math.max(0, controlPreview.scrollHeight - controlPreview.clientHeight);
    }

    const playerContent = document.querySelector<HTMLElement>(".player-stage .teleprompter-content");
    if (playerContent) {
      return Math.max(0, playerContent.scrollHeight - window.innerHeight);
    }

    const estimatedSegments = Math.max(bundle?.speechIndex.length ?? 1, bundle?.markerIndex.length ?? 1);
    return Math.max(0, estimatedSegments * 360);
  }

  function jumpToStart() {
    setPlaybackPositionPx(0);
    playbackPositionRef.current = 0;
    sendScrollClock("paused", 0, 0, { type: "paragraph", paragraphIndex: 0 });
  }

  function jumpToEnd() {
    const offset = endPlaybackOffset();
    setPlaybackPositionPx(offset);
    playbackPositionRef.current = offset;
    sendScrollClock("paused", offset, 0);
  }

  function seekPlaybackByRatio(ratio: number, anchor?: Anchor) {
    const boundedRatio = Math.max(0, Math.min(1, ratio));
    const reportedState = primaryPlaybackState;
    const maxOffset =
      typeof reportedState?.contentHeightPx === "number" &&
      typeof reportedState.viewportHeightPx === "number" &&
      reportedState.contentHeightPx > reportedState.viewportHeightPx
        ? reportedState.contentHeightPx - reportedState.viewportHeightPx
        : endPlaybackOffset();
    const offset = Math.max(0, Math.round(boundedRatio * maxOffset));
    setPlaybackPositionPx(offset);
    playbackPositionRef.current = offset;
    sendScrollClock("paused", offset, 0, anchor);
  }

  function manuallyAdjustPlayer(deltaPx: number) {
    const offset = Math.max(0, playbackPositionRef.current + deltaPx);
    setPlaybackPositionPx(offset);
    playbackPositionRef.current = offset;
    sendScrollClock("paused", offset, 0);
  }

  function jumpToMarker(markerId: string) {
    const marker = bundle?.markerIndex.find((item) => item.markerId === markerId);
    if (!marker) {
      return;
    }
    const markerOrder = bundle?.markerIndex.findIndex((item) => item.markerId === markerId) ?? 0;
    const targetOffset = Math.max(0, markerOrder * 420);
    setPlaybackPositionPx(targetOffset);
    playbackPositionRef.current = targetOffset;
    sendScrollClock("paused", targetOffset, 0, { type: "marker", markerId, textHash: marker.textHash });
  }

  function nextMarkerId() {
    const usedIds = new Set((bundle?.markerIndex ?? []).map((marker) => normalizeMarkerId(marker.markerId)));
    let nextIndex = Math.max(0, ...Array.from(usedIds).map((id) => Number(id) || 0)) + 1;
    let markerId = nextIndex.toString().padStart(2, "0");
    while (usedIds.has(markerId)) {
      nextIndex += 1;
      markerId = nextIndex.toString().padStart(2, "0");
    }
    return markerId;
  }

  function sourceWithBlockInsertion(source: string, start: number, end: number, replacement: string) {
    const prefix = start > 0 && !source.slice(0, start).endsWith("\n\n") ? "\n\n" : "";
    const suffix = end < source.length && !source.slice(end).startsWith("\n\n") ? "\n\n" : "";
    return `${source.slice(0, start)}${prefix}${replacement}${suffix}${source.slice(end)}`;
  }

  function focusPendingDirective(pendingId: string, value: string) {
    window.requestAnimationFrame(() => {
      const editor = markdownEditorRef.current;
      if (!editor) {
        return;
      }
      const source = editor.value;
      const pendingIndex = source.indexOf(`pending="${pendingId}"`);
      const valueIndex = pendingIndex >= 0 ? source.lastIndexOf(value, pendingIndex) : -1;
      editor.focus();
      if (valueIndex >= 0) {
        editor.setSelectionRange(valueIndex, valueIndex + value.length);
      }
    });
  }

  function beginMarkerEdit(target?: EditorInsertionTarget) {
    const editor = markdownEditorRef.current;
    const source = editor?.value ?? markdown;
    const start = target?.start ?? editor?.selectionStart ?? source.length;
    const end = target?.end ?? editor?.selectionEnd ?? source.length;
    const pendingId = makeRandomId("pending");
    const label = "标记点";
    const marker = `:marker[${nextMarkerId()}]{text="${label}" pending="${pendingId}"}\u00A0`;
    const nextValue = renumberMarkerDirectives(sourceWithBlockInsertion(source, start, end, marker));

    setMarkdown(nextValue);
    setPendingEditorAction({ kind: "marker", pendingId, value: label });
    if (!target) {
      focusPendingDirective(pendingId, label);
    }
  }

  function beginCommentEdit(target?: EditorInsertionTarget) {
    const editor = markdownEditorRef.current;
    const source = editor?.value ?? markdown;
    const start = target?.start ?? editor?.selectionStart ?? source.length;
    const end = target?.end ?? editor?.selectionEnd ?? source.length;
    const pendingId = makeRandomId("pending");
    const note = "提示内容";
    const stage = `:notes{text="${note}" pending="${pendingId}"}\u00A0`;
    const nextValue = sourceWithBlockInsertion(source, start, end, stage);

    setMarkdown(nextValue);
    setPendingEditorAction({ kind: "notes", pendingId, value: note });
    if (!target) {
      focusPendingDirective(pendingId, note);
    }
  }

  function updatePendingEditorValue(value: string) {
    if (!pendingEditorAction) {
      return;
    }
    const fallback = pendingEditorAction.kind === "marker" ? "标记点" : "提示内容";
    const cleanValue = escapeDirectiveAttr(value || fallback);
    setPendingEditorAction({ ...pendingEditorAction, value });
    setMarkdown((source) => updatePendingDirective(source, pendingEditorAction, cleanValue, false));
  }

  function confirmPendingEditorAction() {
    if (!pendingEditorAction) {
      return;
    }
    const fallback = pendingEditorAction.kind === "marker" ? "标记点" : "提示内容";
    const cleanValue = escapeDirectiveAttr(pendingEditorAction.value || fallback);
    setMarkdown((source) => updatePendingDirective(source, pendingEditorAction, cleanValue, true));
    setPendingEditorAction(null);
    window.requestAnimationFrame(() => markdownEditorRef.current?.focus());
  }

  function applyMarkdownCommand(command: MarkdownCommand) {
    if (command === "marker") {
      beginMarkerEdit();
      return;
    }
    if (command === "comment") {
      beginCommentEdit();
      return;
    }

    const editor = markdownEditorRef.current;
    const source = editor?.value ?? markdown;
    const start = editor?.selectionStart ?? source.length;
    const end = editor?.selectionEnd ?? source.length;
    const selected = source.slice(start, end);
    const cleanSelection = selected.trim();

    let replacement = "";
    let selectionOffsetStart = 0;
    let selectionOffsetEnd = 0;

    const wrap = (before: string, after = before, placeholder = "文字") => {
      const body = selected || placeholder;
      replacement = `${before}${body}${after}`;
      selectionOffsetStart = before.length;
      selectionOffsetEnd = before.length + body.length;
    };

    switch (command) {
      case "heading":
        replacement = `## ${cleanSelection || "小标题"}`;
        selectionOffsetStart = 3;
        selectionOffsetEnd = replacement.length;
        break;
      case "bold":
        wrap("**", "**", "加粗文字");
        break;
      case "italic":
        wrap("*", "*", "斜体文字");
        break;
      case "strike":
        wrap("~~", "~~", "删除线文字");
        break;
      case "list":
        replacement = selected
          ? selected
              .split("\n")
              .map((line) => (line.trim() ? `- ${line.replace(/^[-*]\s+/, "")}` : line))
              .join("\n")
          : "- 列表项";
        selectionOffsetStart = replacement.startsWith("- ") ? 2 : 0;
        selectionOffsetEnd = replacement.length;
        break;
      case "quote":
        replacement = selected
          ? selected
              .split("\n")
              .map((line) => (line.trim() ? `> ${line.replace(/^>\s?/, "")}` : line))
              .join("\n")
          : "> 引用内容";
        selectionOffsetStart = replacement.startsWith("> ") ? 2 : 0;
        selectionOffsetEnd = replacement.length;
        break;
      case "code":
        if (selected.includes("\n")) {
          replacement = `\`\`\`\n${selected || "代码"}\n\`\`\``;
          selectionOffsetStart = 4;
          selectionOffsetEnd = replacement.length - 4;
        } else {
          wrap("`", "`", "代码");
        }
        break;
      case "link":
        replacement = `[${cleanSelection || "链接文字"}](https://example.com)`;
        selectionOffsetStart = 1;
        selectionOffsetEnd = 1 + (cleanSelection || "链接文字").length;
        break;
      case "image":
        replacement = `![${cleanSelection || "图片说明"}](https://example.com/image.png)`;
        selectionOffsetStart = 2;
        selectionOffsetEnd = 2 + (cleanSelection || "图片说明").length;
        break;
      case "table":
        replacement = `| 项目 | 内容 |\n| --- | --- |\n| 标题 | 说明 |`;
        selectionOffsetStart = 2;
        selectionOffsetEnd = 4;
        break;
    }

    const needsBlockBreak = command === "heading" || command === "list" || command === "quote" || command === "table";
    const prefix = needsBlockBreak && start > 0 && !source.slice(0, start).endsWith("\n\n") ? "\n\n" : "";
    const suffix = needsBlockBreak && end < source.length && !source.slice(end).startsWith("\n\n") ? "\n\n" : "";
    const nextValue = `${source.slice(0, start)}${prefix}${replacement}${suffix}${source.slice(end)}`;
    const nextStart = start + prefix.length + selectionOffsetStart;
    const nextEnd = start + prefix.length + selectionOffsetEnd;

    setMarkdown(nextValue);
    window.requestAnimationFrame(() => {
      markdownEditorRef.current?.focus();
      markdownEditorRef.current?.setSelectionRange(nextStart, nextEnd);
    });
  }

  function insertMarkdownSnippet(kind: "marker" | "comment") {
    applyMarkdownCommand(kind);
  }

  useEffect(() => {
    playbackPositionRef.current = playbackPositionPx;
  }, [playbackPositionPx]);

  useLayoutEffect(() => {
    if (mode !== "player") {
      return;
    }
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    window.scrollTo(0, 0);
    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [mode]);

  const reportPlayerState = useCallback(
    (clock: ScrollClock, positionPx: number) => {
      if (!joinResult) {
        return;
      }
      document.querySelector<HTMLElement>(".player-stage .teleprompter-content")?.style.setProperty("--playback-offset", `${positionPx}px`);
      const { currentAnchor, ...metrics } = playerDisplayMetrics(positionPx, bundle);
      lastReadingAnchorRef.current = currentAnchor;
      const playbackState: PlaybackState = {
        scriptVersionId: clock.scriptVersionId,
        state: clock.state,
        positionPx,
        ...metrics,
        currentAnchor: currentAnchor ?? clock.anchor,
        velocityPxPerSecond: clock.velocityPxPerSecond,
        controlMode: clock.controlMode,
        sourceDeviceId: joinResult.deviceId,
        scrollClockId: clock.scrollClockId,
        reportedAt: currentTime(),
      };
      const payload: PlaybackReportPayload = { playbackState };
      sendEvent("playback.reportState", payload);
    },
    [bundle, joinResult, sendEvent],
  );

  useEffect(() => {
    if (mode !== "player" || !joinResult || !bundle || activeScrollClockKey) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      const positionPx = playbackPositionRef.current;
      document.querySelector<HTMLElement>(".player-stage .teleprompter-content")?.style.setProperty("--playback-offset", `${positionPx}px`);
      const { currentAnchor, ...metrics } = playerDisplayMetrics(positionPx, bundle);
      const playbackState: PlaybackState = {
        scriptVersionId: roomState?.currentScriptVersionId ?? SCRIPT_VERSION_ID,
        state: "paused",
        positionPx,
        ...metrics,
        currentAnchor: currentAnchor ?? defaultAnchor,
        velocityPxPerSecond: 0,
        controlMode: "fixedSpeed",
        sourceDeviceId: joinResult.deviceId,
        reportedAt: currentTime(),
      };
      const payload: PlaybackReportPayload = { playbackState };
      sendEvent("playback.reportState", payload);
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [
    activeScrollClockKey,
    bundle,
    defaultAnchor,
    joinResult,
    mode,
    playerFontScale,
    playerMarkersVisible,
    roomState?.currentScriptVersionId,
    sendEvent,
  ]);

  useEffect(() => {
    if (mode !== "player" || !activeScrollClockKey || !joinResult) {
      return;
    }

    const clock = scrollClockRef.current;
    if (!clock) {
      return;
    }

    if (clock.state === "paused") {
      const frame = window.requestAnimationFrame(() => {
        const markerOffset =
          clock.anchor.type === "marker" && clock.anchor.markerId ? playerOffsetForMarker(clock.anchor.markerId) : undefined;
        const content = document.querySelector<HTMLElement>(".player-stage .teleprompter-content");
        const y = content && bundle && typeof clock.anchor.textOffset === "number"
          ? readingY(content, bundle, { textOffset: clock.anchor.textOffset, lineFraction: (clock.anchor.lineFraction ?? 0) * (playerMirrorY ? -1 : 1) }) : undefined;
        const nextOffset = y !== undefined ? offsetForReadingY(playbackPositionRef.current, y, window.innerHeight, playerMirrorY)
          : typeof markerOffset === "number" ? markerOffset : clock.offsetPx;
        setPlaybackPositionPx(nextOffset);
        playbackPositionRef.current = nextOffset;
        reportPlayerState(clock, nextOffset);
      });
      return () => window.cancelAnimationFrame(frame);
    }

    if (clock.state !== "playing") {
      return;
    }

    let animationFrame = 0;
    let lastReportedAt = 0;
    const tick = () => {
      const position = positionFromScrollClock(clock);
      setPlaybackPositionPx(position);
      playbackPositionRef.current = position;
      if (Date.now() - lastReportedAt >= 100) {
        lastReportedAt = Date.now();
        reportPlayerState(clock, position);
      }
      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(animationFrame);
  }, [activeScrollClockKey, bundle, joinResult, mode, playerMirrorY, reportPlayerState]);

  useEffect(() => {
    if (mode !== "control" || !activeScrollClockKey || hasPlayerSyncRatio) {
      return;
    }

    const scrollEl = controlPreviewScrollRef.current;
    const clock = scrollClockRef.current;
    if (!scrollEl || !clock) {
      return;
    }

    if (clock.state !== "playing") {
      const offset = Math.max(0, clock.offsetPx);
      scrollEl.scrollTop = offset;
      setPlaybackPositionPx(offset);
      playbackPositionRef.current = offset;
      return;
    }

    let animationFrame = 0;
    const tick = () => {
      const position = positionFromScrollClock(clock);
      scrollEl.scrollTop = position;
      setPlaybackPositionPx(position);
      playbackPositionRef.current = position;
      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [activeScrollClockKey, hasPlayerSyncRatio, mode]);

  useEffect(() => {
    if (mode !== "control" || activeScrollClockKey || hasPlayerSyncRatio || typeof primaryPlayerReportedPosition !== "number") {
      return;
    }
    const offset = Math.max(0, primaryPlayerReportedPosition);
    const animationFrame = window.requestAnimationFrame(() => {
      const scrollEl = controlPreviewScrollRef.current;
      if (scrollEl && Math.abs(scrollEl.scrollTop - offset) > 1) {
        scrollEl.scrollTop = offset;
      }
      setPlaybackPositionPx(offset);
      playbackPositionRef.current = offset;
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [activeScrollClockKey, hasPlayerSyncRatio, mode, primaryPlayerReportedPosition]);

  useEffect(() => {
    // Only the primary display knows the actual layout and drives the feedback loop.
    if (!isPrimaryPlayer || !roomState?.voiceState.active || !bundle) return;
    const match = roomState.voiceState.match;
    const adjust = () => {
      const clock = scrollClockRef.current;
      if (!clock || clock.state !== "playing") return; // Manual pause always wins.
      const content = document.querySelector<HTMLElement>(".player-stage .teleprompter-content");
      const targetY = content && typeof match?.targetTextOffset === "number"
        ? readingY(content, bundle, { textOffset: match.targetTextOffset }) : undefined;
      const distance = targetY === undefined ? 0 : (targetY - window.innerHeight / 2) * (playerMirrorY ? -1 : 1);
      const velocity = followVelocity(distance, Date.now() - (match?.updatedAt ?? 0), match?.shouldAdvance ? match.confidence : 0);
      if (clock.controlMode === "voiceFollow" && Math.abs(velocity - clock.velocityPxPerSecond) < 3) return;
      sendScrollClock("playing", playbackPositionRef.current, velocity, defaultAnchor, "voiceFollow");
    };
    adjust();
    const timer = window.setInterval(adjust, 200);
    return () => window.clearInterval(timer);
    // The timer reads the latest clock without resetting on every report.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPrimaryPlayer, roomState?.voiceState.active, roomState?.voiceState.match, bundle, playerMirrorY]);

  useLayoutEffect(() => {
    if (mode !== "player" || isPrimaryPlayer || !bundle || typeof primaryPlaybackState?.currentAnchor.textOffset !== "number") return;
    const content = document.querySelector<HTMLElement>(".player-stage .teleprompter-content");
    if (!content) return;
    const anchor = primaryPlaybackState.currentAnchor;
    const y = readingY(content, bundle, { textOffset: anchor.textOffset!, lineFraction: (anchor.lineFraction ?? 0) * (playerMirrorY ? -1 : 1) });
    if (y === undefined) return;
    const position = offsetForReadingY(playbackPositionRef.current, y, window.innerHeight, playerMirrorY);
    playbackPositionRef.current = position;
    content.style.setProperty("--playback-offset", `${position}px`);
    setPlaybackPositionPx(position);
    const timing = scrollClockTimingRef.current;
    if (timing) { timing.offsetPx = position; timing.receivedAt = monotonicTime(); }
    // Only new primary samples rebase a secondary display, never its own reports.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPrimaryPlayer, mode, primaryPlaybackState?.reportedAt, primaryPlaybackState?.sourceDeviceId, activeScrollClockKey, bundle, playerMirrorY]);

  useLayoutEffect(() => {
    if (mode !== "player" || !bundle) return;
    const content = document.querySelector<HTMLElement>(".player-stage .teleprompter-content");
    if (!content) return;
    const preserveReadingPosition = () => {
      const anchor = lastReadingAnchorRef.current;
      if (typeof anchor?.textOffset !== "number") return;
      const y = readingY(content, bundle, { textOffset: anchor.textOffset, lineFraction: (anchor.lineFraction ?? 0) * (playerMirrorY ? -1 : 1) });
      if (y === undefined) return;
      const position = offsetForReadingY(playbackPositionRef.current, y, window.innerHeight, playerMirrorY);
      playbackPositionRef.current = position;
      content.style.setProperty("--playback-offset", `${position}px`);
      setPlaybackPositionPx(position);
      const timing = scrollClockTimingRef.current;
      if (timing) { timing.offsetPx = position; timing.receivedAt = monotonicTime(); }
      const clock = scrollClockRef.current;
      if (clock) reportPlayerState(clock, position);
    };
    const observer = new ResizeObserver(preserveReadingPosition);
    observer.observe(content);
    window.addEventListener("resize", preserveReadingPosition);
    return () => { observer.disconnect(); window.removeEventListener("resize", preserveReadingPosition); };
  }, [bundle, mode, playerMirrorY, reportPlayerState]);

  useEffect(() => {
    return () => {
      voiceAssistWantedRef.current = false;
      stopSpeechRecognition();
    };
  }, []);

  useEffect(() => {
    if (mode !== "player") {
      return;
    }
    function updateFullscreenState() {
      setFullscreenActive(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", updateFullscreenState);
    return () => document.removeEventListener("fullscreenchange", updateFullscreenState);
  }, [mode]);

  useEffect(() => {
    if (mode !== "player") {
      return;
    }

    function exitFullscreenWithEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || !document.fullscreenElement) {
        return;
      }
      event.preventDefault();
      void document.exitFullscreen();
    }

    window.addEventListener("keydown", exitFullscreenWithEscape, { capture: true });
    return () => window.removeEventListener("keydown", exitFullscreenWithEscape, { capture: true });
  }, [mode]);

  const detachWakeLock = useCallback(() => {
    const sentinel = wakeLockRef.current;
    const handler = wakeLockReleaseHandlerRef.current;
    if (sentinel && handler) {
      sentinel.removeEventListener("release", handler);
    }
    wakeLockRef.current = null;
    wakeLockReleaseHandlerRef.current = null;
  }, []);

  const releaseWakeLock = useCallback(async () => {
    const sentinel = wakeLockRef.current;
    detachWakeLock();
    if (sentinel && !sentinel.released) {
      await sentinel.release().catch(() => undefined);
    }
  }, [detachWakeLock]);

  const requestWakeLock = useCallback(async () => {
    const wakeLock = (navigator as WakeLockNavigator).wakeLock;
    if (!wakeLock) {
      setWakeLockActive(false);
      setWakeLockStatus("当前浏览器不支持保持亮屏");
      return false;
    }

    try {
      await releaseWakeLock();
      const sentinel = await wakeLock.request("screen");
      const handleRelease = () => {
        detachWakeLock();
        setWakeLockActive(false);
        setWakeLockStatus(wakeLockWantedRef.current ? "亮屏权限已暂停，回到页面后会重试" : "保持亮屏已关闭");
      };

      wakeLockRef.current = sentinel;
      wakeLockReleaseHandlerRef.current = handleRelease;
      sentinel.addEventListener("release", handleRelease);
      setWakeLockActive(true);
      setWakeLockStatus("保持亮屏已开启");
      return true;
    } catch {
      setWakeLockActive(false);
      setWakeLockStatus("保持亮屏开启失败，请先与页面互动后重试");
      return false;
    }
  }, [detachWakeLock, releaseWakeLock]);

  useEffect(() => {
    if (mode !== "player") {
      return;
    }

    function retryWakeLockWhenVisible() {
      if (document.visibilityState === "visible" && wakeLockWantedRef.current && !wakeLockRef.current) {
        void requestWakeLock();
      }
    }

    document.addEventListener("visibilitychange", retryWakeLockWhenVisible);
    return () => {
      document.removeEventListener("visibilitychange", retryWakeLockWhenVisible);
      wakeLockWantedRef.current = false;
      setWakeLockWanted(false);
      setWakeLockActive(false);
      void releaseWakeLock();
    };
  }, [mode, releaseWakeLock, requestWakeLock]);

  useEffect(() => {
    if (mode !== "player" || !wakeLockStatus) {
      return;
    }
    const timer = window.setTimeout(() => setWakeLockStatus(""), 2200);
    return () => window.clearTimeout(timer);
  }, [mode, wakeLockStatus]);

  async function toggleWakeLock() {
    if (wakeLockWantedRef.current) {
      wakeLockWantedRef.current = false;
      setWakeLockWanted(false);
      setWakeLockActive(false);
      setWakeLockStatus("保持亮屏已关闭");
      await releaseWakeLock();
      return;
    }

    wakeLockWantedRef.current = true;
    setWakeLockWanted(true);
    setWakeLockStatus("正在请求保持亮屏");
    const granted = await requestWakeLock();
    if (!granted) {
      wakeLockWantedRef.current = false;
      setWakeLockWanted(false);
    }
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    if (!document.documentElement.requestFullscreen) {
      return;
    }
    await document.documentElement.requestFullscreen();
  }

  function changePlayerFontScale(delta: number) {
    setPlayerFontScale((value) => Math.min(MAX_PLAYER_FONT_SCALE, Math.max(MIN_PLAYER_FONT_SCALE, Number((value + delta).toFixed(2)))));
  }

  function setBoundedPlayerFontScale(nextScale: number) {
    setPlayerFontScale(Math.min(MAX_PLAYER_FONT_SCALE, Math.max(MIN_PLAYER_FONT_SCALE, Number(nextScale.toFixed(2)))));
  }

  async function setPrimaryPlayer() {
    if (!joinResult || mode !== "player") {
      return;
    }
    try {
      const response = await fetch(`/api/rooms/${roomCode}/settings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ primaryPlayerDeviceId: joinResult.deviceId }),
      });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { roomState: RoomState };
      setRoomState(data.roomState);
    } catch {
      // The player can keep executing; the existing primary remains authoritative.
    }
  }

  async function invitePlayer() {
    if (!playerEntryLink) {
      return;
    }

    try {
      await navigator.clipboard.writeText(playerEntryLink.playerUrl);
      setInviteStatus("copied");
      window.setTimeout(() => setInviteStatus("idle"), 1800);
    } catch {
      setInviteStatus("fallback");
      setExpandedQrLink(playerEntryLink);
      window.setTimeout(() => setInviteStatus("idle"), 2200);
    }
  }

  if (connection === "not-found") {
    return (
      <main className="workspace">
        <section className="panel">
          <p className="eyebrow">房间不存在</p>
          <h1>没有找到 {roomCode}</h1>
          <Link className="button primary" href="/">
            回到入口
          </Link>
        </section>
      </main>
    );
  }

  const isControlPlaying = activeScrollClock?.state === "playing";
  const isPlayerPlaying = mode === "player" && activeScrollClock?.state === "playing";
  const setBoundedSpeed = (nextSpeed: number) => {
    const boundedSpeed = Math.max(10, Math.min(150, Math.round(nextSpeed)));
    setSpeed(boundedSpeed);
    if (activeScrollClock?.state === "playing") {
      playFromCurrentOffset(boundedSpeed);
    }
  };

  if (mode === "control") {
    return (
      <>
        <ControlConsole
          roomCode={roomCode}
          connectionLabel={connection === "connected" ? "已连接" : connection}
          isConnected={connection === "connected"}
          deviceCount={devices.length}
          joinResult={joinResult}
          projectName={projectName}
          setProjectName={setProjectName}
          parseStatus={scriptDraft?.parseStatus}
          hasSavedVersion={versions.length > 0}
          saveStatus={saveStatus}
          markdown={markdown}
          setMarkdown={setMarkdown}
          versionMessage={versionMessage}
          setVersionMessage={setVersionMessage}
          bundle={bundle}
          versions={versions}
          playbackCenterRatio={playbackCenterRatio}
          readingAnchor={primaryPlaybackState?.currentAnchor}
          speed={speed}
          isPlaying={isControlPlaying}
          playerFontScale={playerFontScale}
          playerMirrorX={playerMirrorX}
          playerMirrorY={playerMirrorY}
          voiceAssistWanted={voiceAssistWanted}
          voiceAssistStatus={voiceAssistSummary}
          playerEntryLink={playerEntryLink}
          roomLinks={roomLinks}
          inviteStatus={inviteStatus}
          previewScrollRef={controlPreviewScrollRef}
          markdownEditorRef={markdownEditorRef}
          onInvite={() => void invitePlayer()}
          onOpenQr={setExpandedQrLink}
          onSaveDraft={() => void saveDraft()}
          onSaveVersion={() => void saveVersion()}
          onRestoreVersion={(versionId) => void restoreVersion(versionId)}
          onTogglePlay={() => {
            if (isControlPlaying) {
              pauseAtCurrentOffset();
              return;
            }
            playFromCurrentOffset();
          }}
          onJumpToStart={jumpToStart}
          onJumpToEnd={jumpToEnd}
          onNudge={nudgePlayback}
          onJumpToMarker={jumpToMarker}
          onSpeedChange={setBoundedSpeed}
          onPlayerFontScaleChange={setBoundedPlayerFontScale}
          onPlayerMirrorXChange={setPlayerMirrorX}
          onPlayerMirrorYChange={setPlayerMirrorY}
          onToggleVoiceAssist={toggleVoiceAssist}
          onGuideSeekRatio={seekPlaybackByRatio}
          onBeginMarkerEdit={beginMarkerEdit}
          onBeginCommentEdit={beginCommentEdit}
          pendingEditorAction={pendingEditorAction}
          onPendingEditorValueChange={updatePendingEditorValue}
          onConfirmPendingEditorAction={confirmPendingEditorAction}
          onPreviewScroll={() => undefined}
        />
        {expandedQrLink && (
          <div className="qrm open" role="dialog" aria-modal="true" aria-label="播放端入口" onClick={() => setExpandedQrLink(null)}>
            <div className="qrm-in" onClick={(event) => event.stopPropagation()}>
              <div className="qrm-h">播放端入口 · 扫码进入房间 {roomCode}</div>
              <div className="qrm-card">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt={`${expandedQrLink.label} 播放端二维码`} src={`/api/qr?text=${encodeURIComponent(expandedQrLink.playerUrl)}`} />
              </div>
              <div className="qrm-url">{expandedQrLink.playerUrl}</div>
              <button className="nike-btn" type="button" onClick={() => setExpandedQrLink(null)}>
                关闭
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  if ((process.env.NEXT_PUBLIC_LEGACY_CONTROL ?? "") === "1") {
    return (
      <main className="control-workspace">
        <header className="control-appbar">
          <div className="control-brand">
            <img className="app-brand-logo" src="/brand/logo.png" alt="" width={40} height={40} />
            <div>
              <strong>庄Sir的提词器</strong>
              <span>控制端</span>
            </div>
          </div>

          <div className="control-room-meta">
            <div>
              <span>房间号</span>
              <strong>{roomCode}</strong>
            </div>
            <div>
              <span>状态</span>
              <strong className="connected-label">
                <i />
                {connection === "connected" ? "已连接" : connection}
              </strong>
            </div>
            <div>
              <span>设备数</span>
              <strong>{devices.length}</strong>
            </div>
            {joinResult?.deviceId && (
              <div className="control-device-id">
                <span>Device ID</span>
                <code>{joinResult.deviceId}</code>
              </div>
            )}
          </div>

          <div className="control-app-actions">
            <button
              className="chrome-icon-button"
              type="button"
              title="房间二维码"
              disabled={!playerEntryLink}
              onClick={() => playerEntryLink && setExpandedQrLink(playerEntryLink)}
            >
              <Icon name="qr" />
            </button>
            <button
              className="chrome-button"
              type="button"
              disabled={!playerEntryLink}
              onClick={() => void invitePlayer()}
            >
              <Icon name="invite" />
              {inviteStatus === "copied" ? "已复制" : inviteStatus === "fallback" ? "扫码邀请" : "邀请"}
            </button>
            <div className="user-chip">ZS</div>
          </div>
        </header>

        <div className="control-shell">
          <aside className="control-sidebar">
            <button className="new-button" type="button">
              NEW
              <Icon name="bolt" />
            </button>
            <nav className="control-nav">
              <a className="active" href="#script">
                <Icon name="file" />
                文稿编辑
              </a>
              <a href="#markers">
                <Icon name="bookmark" />
                标记管理
              </a>
              <a href="#comments">
                <Icon name="comment" />
                注释
              </a>
              <a href="#devices">
                <Icon name="monitor" />
                设备
              </a>
              <a href="#shortcuts">
                <Icon name="keyboard" />
                快捷键
              </a>
            </nav>
            <div className="project-card">
              <span>项目名称</span>
              <input
                aria-label="项目名称"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="输入项目名称"
              />
            </div>
          </aside>

          <section className="control-main-column">
            <section className="control-document-panel" id="script">
              <div className="document-toolbar">
                <div className="format-tools" aria-label="文稿格式工具栏">
                  <button type="button" title="标题" onClick={() => applyMarkdownCommand("heading")}>
                    <Icon name="heading" />
                  </button>
                  <button type="button" title="加粗" onClick={() => applyMarkdownCommand("bold")}>
                    <Icon name="bold" />
                  </button>
                  <button type="button" title="斜体" onClick={() => applyMarkdownCommand("italic")}>
                    <Icon name="italic" />
                  </button>
                  <button type="button" title="删除线" onClick={() => applyMarkdownCommand("strike")}>
                    <Icon name="strike" />
                  </button>
                  <button type="button" title="列表" onClick={() => applyMarkdownCommand("list")}>
                    <Icon name="list" />
                  </button>
                  <button type="button" title="引用" onClick={() => applyMarkdownCommand("quote")}>
                    <Icon name="quote" />
                  </button>
                  <button type="button" title="代码" onClick={() => applyMarkdownCommand("code")}>
                    <Icon name="code" />
                  </button>
                  <button type="button" title="链接" onClick={() => applyMarkdownCommand("link")}>
                    <Icon name="link" />
                  </button>
                  <button type="button" title="图片" onClick={() => applyMarkdownCommand("image")}>
                    <Icon name="image" />
                  </button>
                  <button type="button" title="表格" onClick={() => applyMarkdownCommand("table")}>
                    <Icon name="table" />
                  </button>
                </div>
                <div className="script-actions">
                  <button className="toolbar-action" type="button" onClick={() => insertMarkdownSnippet("marker")}>
                    <Icon name="bookmark" />
                    标记
                  </button>
                  <button className="toolbar-action" type="button" onClick={() => insertMarkdownSnippet("comment")}>
                    <Icon name="comment" />
                    注释
                  </button>
                  <button className="save-button" type="button" onClick={saveVersion}>
                    <Icon name="save" />
                    保存
                  </button>
                </div>
              </div>

              <div className="markdown-editor-workbench">
                <section className="markdown-source-pane" aria-label="Markdown 原文编辑">
                  <div className="pane-heading">
                    <strong>文稿编辑</strong>
                    <button className="text-save-button" type="button" onClick={saveDraft}>
                      保存草稿
                    </button>
                  </div>
                  <textarea
                    ref={markdownEditorRef}
                    className="markdown-editor-textarea"
                    value={markdown}
                    onChange={(event) => setMarkdown(event.target.value)}
                    spellCheck={false}
                    placeholder="# 写下你的题词文稿"
                  />
                  <input
                    className="version-note-input"
                    aria-label="版本备注"
                    value={versionMessage}
                    onChange={(event) => setVersionMessage(event.target.value)}
                    placeholder="版本备注，例如：发布会开场版"
                  />
                </section>

                <section className="markdown-preview-pane" aria-label="播放端渲染预览">
                  {bundle && (
                    <RenderBundleView bundle={bundle} variant="control" playbackPositionPx={playbackPositionPx} showCenterGuide />
                  )}
                </section>
              </div>
            </section>

            {bundle && (
              <section className="control-playback-bar" aria-label="播放控制">
                <strong>播放控制</strong>
                <button className="round-tool" type="button" title="回退" onClick={() => nudgePlayback(-160)}>
                  <Icon name="skipBack" />
                </button>
                <button className="play-main-button" type="button" onClick={() => playFromCurrentOffset()}>
                  <Icon name="play" />
                </button>
                <button className="round-tool" type="button" title="暂停" onClick={pauseAtCurrentOffset}>
                  <Icon name="pause" />
                </button>
                <div className="speed-control">
                  <span>速度</span>
                  <button type="button" onClick={() => setSpeed((value) => Math.max(24, value - 8))}>
                    <Icon name="minus" />
                  </button>
                  <strong>{speed} px/s</strong>
                  <button type="button" onClick={() => setSpeed((value) => Math.min(160, value + 8))}>
                    <Icon name="plus" />
                  </button>
                </div>
                <button className="chrome-button" type="button" onClick={() => nudgePlayback(160)}>
                  前进
                </button>
                <a className="chrome-button preview-button" href={`/room/${roomCode}/player`} target="_blank">
                  <Icon name="fullscreen" />
                  全屏预览
                </a>
              </section>
            )}

            {bundle && (
              <section className="marker-dock" id="markers">
                <div>
                  <Icon name="bookmark" />
                  标记点导航
                </div>
                <div className="marker-chip-list">
                  {bundle.markerIndex.map((marker, index) => (
                    <button
                      className={`marker-chip chip-${index % 8}`}
                      type="button"
                      key={marker.markerId}
                      onClick={() => jumpToMarker(marker.markerId)}
                    >
                      {marker.markerId}
                    </button>
                  ))}
                </div>
                <button className="chrome-button" type="button" onClick={() => insertMarkdownSnippet("marker")}>
                  <Icon name="plus" />
                  添加标记
                </button>
              </section>
            )}
          </section>

          <aside className="control-history-panel">
            <div className="history-head">
              <Icon name="history" />
              <strong>历史版本</strong>
            </div>
            <div className="version-timeline">
              {versions.length === 0 && <p className="muted">还没有保存过版本</p>}
              {versions.map((version, index) => (
                <article className={`timeline-version ${index === 0 ? "current" : ""}`} key={version.versionId}>
                  <div>
                    <strong>{index === 0 ? `${version.message ?? "现场保存"} · 当前版本` : version.message ?? "未命名版本"}</strong>
                    <span>
                      {new Date(version.createdAt).toLocaleDateString("zh-CN")} {new Date(version.createdAt).toLocaleTimeString("zh-CN")}
                    </span>
                    <small>{projectName}</small>
                  </div>
                  <button type="button" title="回退到这个版本" onClick={() => restoreVersion(version.versionId)}>
                    <Icon name="undo" />
                  </button>
                </article>
              ))}
            </div>
          </aside>
        </div>

        {expandedQrLink && (
          <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="播放端二维码">
            <div className="qr-modal control-qr-popover">
              <p className="eyebrow">房间二维码</p>
              <h2>{roomCode}</h2>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt={`${expandedQrLink.label} 播放端二维码`} src={`/api/qr?text=${encodeURIComponent(expandedQrLink.playerUrl)}`} />
              <span>扫码加入播放端</span>
              <code>{expandedQrLink.playerUrl}</code>
              <button className="button primary" type="button" onClick={() => setExpandedQrLink(null)}>
                关闭
              </button>
            </div>
          </div>
        )}
      </main>
    );
  }

  return (
    <main
      className={`workspace ${mode === "player" ? "player-workspace" : ""} ${playerOverlayHidden ? "player-overlay-hidden" : ""}`}
      onWheel={
        mode === "player"
          ? (event) => {
              event.preventDefault();
              manuallyAdjustPlayer(event.deltaY);
            }
          : undefined
      }
    >
      <section className="room-topbar">
        <div>
          <p className="eyebrow">房间 {roomCode}</p>
          <h1>{mode === "player" ? "播放端" : "选择角色"}</h1>
        </div>
        {mode === "player" && (
          <div className="player-stage-controls">
            <button className="player-tool-button" type="button" onClick={() => changePlayerFontScale(-0.1)}>
              A-
            </button>
            <span>{Math.round(playerFontScale * 100)}%</span>
            <button className="player-tool-button" type="button" onClick={() => changePlayerFontScale(0.1)}>
              A+
            </button>
            <button className="player-tool-button" type="button" aria-pressed={isPrimaryPlayer} onClick={() => void setPrimaryPlayer()}>
              {isPrimaryPlayer ? "主播放端" : "设为主播放端"}
            </button>
            <button className="player-tool-button" type="button" aria-pressed={playerMirrorX} onClick={() => setPlayerMirrorX((value) => !value)}>
              {playerMirrorX ? "取消水平镜像" : "水平镜像"}
            </button>
            <button className="player-tool-button" type="button" aria-pressed={playerMirrorY} onClick={() => setPlayerMirrorY((value) => !value)}>
              {playerMirrorY ? "取消垂直镜像" : "垂直镜像"}
            </button>
            <button
              className="player-tool-button"
              type="button"
              aria-pressed={playerMarkersVisible}
              onClick={() => setPlayerMarkersVisible((value) => !value)}
            >
              {playerMarkersVisible ? "隐藏标记" : "显示标记"}
            </button>
            <button
              className="player-tool-button"
              type="button"
              aria-pressed={isPlayerPlaying}
              onClick={isPlayerPlaying ? pauseAtCurrentOffset : () => playFromCurrentOffset()}
            >
              {isPlayerPlaying ? "暂停" : "播放"}
            </button>
            <button className="player-tool-button" type="button" title="回到开始" onClick={jumpToStart}>
              |&lt;
            </button>
            <button className="player-tool-button" type="button" title="回到结束" onClick={jumpToEnd}>
              &gt;|
            </button>
            <button className="player-tool-button" type="button" aria-pressed={voiceAssistWanted} onClick={toggleVoiceAssist}>
              {voiceAssistWanted ? "识别中" : "自动识别"}
            </button>
            <button className="player-tool-button" type="button" onClick={() => void toggleFullscreen()}>
              {fullscreenActive ? "退出全屏" : "全屏"}
            </button>
            <button className="player-tool-button" type="button" aria-pressed={wakeLockWanted} onClick={() => void toggleWakeLock()}>
              {wakeLockActive ? "亮屏中" : "保持亮屏"}
            </button>
            <button className="player-tool-button" type="button" onClick={() => setPlayerOverlayHidden(true)}>
              隐藏状态
            </button>
          </div>
        )}
        {mode === "player" && playerStatusToast && (
          <div className="player-toast" role="status" aria-live="polite">
            {playerStatusToast}
          </div>
        )}
        <div className="topbar-status-group">
          <div className={`status-pill ${connection}`}>
            <span />
            {connection === "connected" ? "已连接" : connection}
          </div>
          <div className="status-chip">设备 {devices.length}</div>
          {joinResult?.deviceId && <code className="status-chip device-id-chip">Device ID {joinResult.deviceId}</code>}
        </div>
      </section>
      {mode === "player" && playerOverlayHidden && (
        <button className="player-reveal-button" type="button" onClick={() => setPlayerOverlayHidden(false)}>
          显示状态
        </button>
      )}

      {mode !== "player" && (
      <section className="room-grid">
        <div className="panel share-panel">
          <p className="eyebrow">设备入口</p>
          <h2>同网设备加入</h2>
          <p className="muted">iPad 或另一台电脑需要和这台 Mac 在同一个 Wi-Fi，并使用局域网地址打开播放端。</p>
          <div className="share-list">
            {roomLinks.map((link) => (
              <div className="share-row" key={link.origin}>
                <div>
                  <strong>{link.label}</strong>
                  <code>{link.origin}</code>
                </div>
                {link.kind === "lan" && (
                  <div className="share-qr">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt={`${link.label} 播放端二维码`} src={`/api/qr?text=${encodeURIComponent(link.playerUrl)}`} />
                    <span>扫码打开播放端</span>
                    <button className="text-button" type="button" onClick={() => setExpandedQrLink(link)}>
                      放大二维码
                    </button>
                  </div>
                )}
                <div className="share-actions">
                  <a className="button secondary" href={link.controlUrl}>
                    控制端
                  </a>
                  <a className="button primary" href={link.playerUrl}>
                    播放端
                  </a>
                </div>
              </div>
            ))}
          </div>
          {roomLinks.every((link) => link.kind !== "lan") && (
            <p className="muted">暂未检测到局域网地址。请确认 Wi-Fi 已连接，或使用本机浏览器继续测试。</p>
          )}
        </div>

      </section>
      )}
      {expandedQrLink && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="播放端二维码">
          <div className="qr-modal">
            <p className="eyebrow">{expandedQrLink.label}</p>
            <h2>扫码打开播放端</h2>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt={`${expandedQrLink.label} 播放端大二维码`} src={`/api/qr?text=${encodeURIComponent(expandedQrLink.playerUrl)}`} />
            <code>{expandedQrLink.playerUrl}</code>
            <button className="button primary" type="button" onClick={() => setExpandedQrLink(null)}>
              关闭
            </button>
          </div>
        </div>
      )}
      {mode === "player" && bundle ? (
        <RenderBundleView
          bundle={bundle}
          variant="player"
          playbackPositionPx={playbackPositionPx}
          fontScale={playerFontScale}
          mirrorX={playerMirrorX}
          mirrorY={playerMirrorY}
          showMarkers={playerMarkersVisible}
        />
      ) : mode === "player" ? (
        <section className="player-empty-stage" aria-label="播放端等待文稿">
          <div>
            <p className="eyebrow">播放端</p>
            <h2>正在同步文稿</h2>
            <p>控制端保存或同步文稿后，这里会自动显示提词内容。</p>
          </div>
        </section>
      ) : null}
    </main>
  );
}

function escapeDirectiveAttr(value: string) {
  return value.replace(/["\\\n\r]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeMarkerId(markerId: string) {
  const numeric = markerId.match(/\d+/)?.[0];
  return numeric ? Number(numeric).toString().padStart(2, "0") : markerId;
}

function normalizeEditableDirectives(source: string) {
  return source
    .replace(/^(\s*)::(marker\[[^\]]+\]\{[^}]*\})(\s*)$/gm, (_match, indent: string, body: string, tail: string) => {
      return `${indent}:${body}\u00A0${tail}`;
    })
    .replace(/^(\s*)::(notes\{[^}]*\})(\s*)$/gm, (_match, indent: string, body: string, tail: string) => {
      return `${indent}:${body}\u00A0${tail}`;
    })
    .replace(/(:{1,2}marker\[[^\]]+\]\{[^}]*\})\u200B/g, "$1\u00A0")
    .replace(/(:{1,2}notes\{[^}]*\})\u200B/g, "$1\u00A0")
    .replace(/(:{1,2}marker\[[^\]]+\]\{[^}]*\})(?![\u200B\u00A0])/g, "$1\u00A0")
    .replace(/(:{1,2}notes\{[^}]*\})(?![\u200B\u00A0])/g, "$1\u00A0");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceDirectiveAttribute(directive: string, attr: "label" | "cue" | "text", value: string) {
  const attrPattern = new RegExp(`${attr}="[^"]*"`);
  if (attrPattern.test(directive)) {
    return directive.replace(attrPattern, `${attr}="${value}"`);
  }
  return directive.replace(/\}$/, ` ${attr}="${value}"}`);
}

function updatePendingDirective(source: string, action: PendingEditorAction, value: string, finalize: boolean) {
  const pendingPattern = escapeRegExp(action.pendingId);
  const directivePattern =
    action.kind === "marker"
    ? new RegExp(`:{1,2}marker\\[(?:M)?\\d{2,3}\\]\\{[^}]*pending="${pendingPattern}"[^}]*\\}`)
    : new RegExp(`:{1,2}notes\\{[^}]*pending="${pendingPattern}"[^}]*\\}`);

  return source.replace(directivePattern, (directive) => {
    const nextDirective = replaceDirectiveAttribute(directive, "text", value);
    return finalize ? nextDirective.replace(/\s+pending="[^"]*"/, "") : nextDirective;
  });
}

function Icon({ name }: { name: IconName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.9,
    viewBox: "0 0 24 24",
  };

  const paths: Record<IconName, ReactNode> = {
    bolt: <path d="M13 2 4 14h7l-1 8 10-13h-7l1-7Z" />,
    file: <path d="M7 3h7l4 4v14H7V3Zm7 0v5h5M9 13h6M9 17h5" />,
    bookmark: <path d="M7 4h10v17l-5-3-5 3V4Z" />,
    comment: <path d="M5 6h14v10H9l-4 4V6Z" />,
    monitor: <path d="M4 5h16v11H4V5Zm6 15h4M12 16v4" />,
    keyboard: <path d="M4 7h16v10H4V7Zm3 3h.01M10 10h.01M13 10h.01M16 10h.01M7 14h10" />,
    qr: <path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm11 1h2v2h-2v-2Zm3 3h2v2h-2v-2Zm-4 1h2" />,
    copy: <path d="M8 8h11v11H8V8Zm-3 8V5h11" />,
    invite: <path d="M15 19c0-2.2-1.8-4-4-4H8c-2.2 0-4 1.8-4 4m7-8a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8 2v6m3-3h-6" />,
    history: <path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6M4 4v4.6h4.6M12 8v5l3 2" />,
    undo: <path d="M9 7H4v5m0-5 5 5m-4-1a7 7 0 1 0 2-5" />,
    play: <path d="m8 5 11 7-11 7V5Z" />,
    pause: <path d="M8 5v14M16 5v14" />,
    skipBack: <path d="M19 5 9 12l10 7V5ZM5 5v14" />,
    skipForward: <path d="m5 5 10 7-10 7V5Zm14 0v14" />,
    minus: <path d="M5 12h14" />,
    plus: <path d="M12 5v14M5 12h14" />,
    fullscreen: <path d="M8 4H4v4m12-4h4v4M8 20H4v-4m16 0v4h-4" />,
    list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
    heading: <path d="M6 5v14M18 5v14M6 12h12" />,
    bold: <path d="M8 5h5a3.5 3.5 0 0 1 0 7H8V5Zm0 7h6a3.5 3.5 0 0 1 0 7H8v-7Z" />,
    italic: <path d="M10 5h8M6 19h8M14 5l-4 14" />,
    strike: <path d="M5 12h14M8 8c.8-2 2.5-3 5-3 2 0 3.5.6 4.4 1.8M16 16c-.9 2-2.6 3-5 3-2.2 0-3.9-.7-5-2" />,
    quote: <path d="M8 10H5c0-3 1-5 4-6v3c-1 .5-1.5 1.5-1.5 3H10v6H5v-6m11 0h-3c0-3 1-5 4-6v3c-1 .5-1.5 1.5-1.5 3H18v6h-5v-6" />,
    code: <path d="m9 8-4 4 4 4m6-8 4 4-4 4" />,
    link: <path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1" />,
    image: <path d="M4 5h16v14H4V5Zm4 4h.01M4 16l5-5 4 4 2-2 5 5" />,
    table: <path d="M4 5h16v14H4V5Zm0 5h16M4 14h16M10 5v14M16 5v14" />,
    save: <path d="M5 4h12l2 2v14H5V4Zm3 0v6h8V4M8 20v-6h8v6" />,
  };

  return (
    <svg aria-hidden="true" {...common}>
      {paths[name]}
    </svg>
  );
}
