"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Anchor, DeviceRole, PlaybackState, RoomJoinResult, RoomState, ScrollClock } from "@/domain/room/types";
import type {
  ClientEnvelope,
  ClientHelloPayload,
  PlaybackReportPayload,
  RoleSetPayload,
  ServerEnvelope,
  SetScrollClockPayload,
} from "@/shared/protocol";
import type { RenderBundle } from "@/modules/script-engine";
import { parseMarkdown } from "@/modules/script-engine";
import { RenderBundleView } from "./render-bundle-view";

type RoomClientProps = {
  roomCode: string;
  mode: "select-role" | "control" | "player";
};

type ConnectionState = "joining" | "connecting" | "connected" | "disconnected" | "not-found";

function makeSessionId() {
  return `sess_${crypto.randomUUID()}`;
}

function makeEventId() {
  return `evt_${crypto.randomUUID()}`;
}

function deviceStorageKey(roomCode: string) {
  return `zhuang-prompter:${roomCode}:deviceId`;
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

function roleLabel(role: DeviceRole | null) {
  if (role === "control") {
    return "控制端";
  }
  if (role === "player") {
    return "播放端";
  }
  return "未选择";
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
}

const DEFAULT_SPEED = 68;
const SCRIPT_VERSION_ID = "fixture_m1";

function currentTime() {
  return Date.now();
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

type FieldReadinessItem = {
  label: string;
  status: "pass" | "pending" | "warn";
  detail: string;
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
  const [connection, setConnection] = useState<ConnectionState>("joining");
  const [joinResult, setJoinResult] = useState<RoomJoinResult | null>(null);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [lastAck, setLastAck] = useState<string>("尚未发送事件");
  const [playbackPositionPx, setPlaybackPositionPx] = useState(0);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [markdown, setMarkdown] = useState("");
  const [draftStatus, setDraftStatus] = useState("草稿未加载");
  const [versionMessage, setVersionMessage] = useState("");
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [currentOrigin, setCurrentOrigin] = useState("");
  const [networkOrigins, setNetworkOrigins] = useState<NetworkOrigin[]>([]);
  const [playerFontScale, setPlayerFontScale] = useState(1);
  const [playerOverlayHidden, setPlayerOverlayHidden] = useState(false);
  const [fullscreenActive, setFullscreenActive] = useState(false);
  const [wakeLockWanted, setWakeLockWanted] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [wakeLockStatus, setWakeLockStatus] = useState("");
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [nowMs, setNowMs] = useState(0);

  const selectedRole = preferredRole(mode);
  const selfDevice = roomState && joinResult ? roomState.devices[joinResult.deviceId] : null;
  const scriptDraft = roomState?.scriptDraft;
  const playerReports = devicesWithPlayback(roomState);
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
    const timer = window.setTimeout(() => {
      setNowMs(Date.now());
    }, 0);
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const existingDeviceId = window.localStorage.getItem(deviceStorageKey(roomCode));

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
      window.localStorage.setItem(deviceStorageKey(roomCode), result.deviceId);
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
  }, [roomCode]);

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

  const loadDraftAndVersions = useCallback(async () => {
    const [draftResponse, versionsResponse] = await Promise.all([
      fetch(`/api/rooms/${roomCode}/script/draft`),
      fetch(`/api/rooms/${roomCode}/script/versions`),
    ]);
    if (draftResponse.ok) {
      const draft = (await draftResponse.json()) as { markdown: string; draftRevision: number; parseStatus: string };
      setMarkdown(draft.markdown);
      setDraftStatus(`draft rev ${draft.draftRevision} · ${draft.parseStatus}`);
    }
    if (versionsResponse.ok) {
      const data = (await versionsResponse.json()) as { versions: VersionSummary[] };
      setVersions(data.versions);
    }
  }, [roomCode]);

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
      setMarkdown(scriptDraft.markdown);
      setDraftStatus(`draft rev ${scriptDraft.draftRevision} · ${scriptDraft.parseStatus}`);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [mode, scriptDraft]);

  async function saveDraft() {
    if (!joinResult) {
      return;
    }
    const response = await fetch(`/api/rooms/${roomCode}/script/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: joinResult.deviceId, markdown }),
    });
    if (response.ok) {
      const data = (await response.json()) as { roomState: RoomState };
      setRoomState(data.roomState);
      setDraftStatus(`draft rev ${data.roomState.scriptDraft.draftRevision} · ${data.roomState.scriptDraft.parseStatus}`);
    }
  }

  async function saveVersion() {
    if (!joinResult) {
      return;
    }
    await saveDraft();
    const response = await fetch(`/api/rooms/${roomCode}/script/versions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: joinResult.deviceId, message: versionMessage || "现场保存" }),
    });
    if (response.ok) {
      setVersionMessage("");
      await loadDraftAndVersions();
    }
  }

  async function restoreVersion(versionId: string) {
    if (!joinResult) {
      return;
    }
    const response = await fetch(`/api/rooms/${roomCode}/script/restore`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: joinResult.deviceId, versionId }),
    });
    if (response.ok) {
      const data = (await response.json()) as { roomState: RoomState; draft: { markdown: string } };
      setRoomState(data.roomState);
      setMarkdown(data.draft.markdown);
      setDraftStatus(`restored · draft rev ${data.roomState.scriptDraft.draftRevision}`);
      await loadDraftAndVersions();
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
      if (event.type === "server.ack") {
        setLastAck(`已确认 ${event.eventId.slice(0, 12)} · rev ${event.roomRevision} · seq ${event.serverSeq}`);
      }
      if (event.type === "server.nack") {
        setLastAck(`被拒绝 ${event.code}: ${event.message}`);
      }
    });

    socket.addEventListener("close", () => {
      if (closedByCleanup) {
        return;
      }
      setConnection("disconnected");
      setLastAck("连接断开，正在尝试重连");
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
  const fieldReadiness = useMemo<FieldReadinessItem[]>(() => {
    const lanLink = roomLinks.find((link) => link.kind === "lan");
    const controlDevice = devices.find((device) => device.role === "control" && device.online);
    const playerDevice = devices.find((device) => device.role === "player" && device.online);
    const latestPlaybackReport = playerReports
      .map((device) => device.playbackState)
      .filter((state): state is PlaybackState => Boolean(state))
      .sort((a, b) => b.reportedAt - a.reportedAt)[0];
    const playbackReportAge = latestPlaybackReport ? nowMs - latestPlaybackReport.reportedAt : null;
    const playbackReportFresh = playbackReportAge !== null && playbackReportAge >= 0 && playbackReportAge < 5000;

    return [
      {
        label: "局域网入口",
        status: lanLink ? "pass" : "warn",
        detail: lanLink ? `${lanLink.origin} 可扫码打开播放端` : "未检测到 LAN 地址，iPad 可能无法从同网访问",
      },
      {
        label: "控制端连接",
        status: connection === "connected" && controlDevice ? "pass" : "pending",
        detail: controlDevice ? `${controlDevice.deviceId.slice(0, 12)} 在线` : "等待控制端完成连接",
      },
      {
        label: "播放端在线",
        status: playerDevice ? "pass" : "pending",
        detail: playerDevice ? `${playerDevice.deviceId.slice(0, 12)} 在线` : "等待 iPad 或另一浏览器打开播放端",
      },
      {
        label: "播放回报",
        status: playbackReportFresh ? "pass" : "pending",
        detail: latestPlaybackReport
          ? `${latestPlaybackReport.state} · ${Math.round(latestPlaybackReport.positionPx)}px · ${Math.round((playbackReportAge ?? 0) / 1000)}s 前`
          : "按播放后等待播放端上报位置",
      },
      {
        label: "重连观察",
        status: reconnectAttempt > 0 && connection === "connected" ? "pass" : "pending",
        detail:
          reconnectAttempt > 0
            ? `已尝试重连 ${reconnectAttempt} 次，当前 ${connection === "connected" ? "已恢复" : connection}`
            : "实机验收时短暂切后台或切换网络后观察恢复",
      },
    ];
  }, [connection, devices, nowMs, playerReports, reconnectAttempt, roomLinks]);

  function setRole(role: DeviceRole) {
    const payload: RoleSetPayload = { role };
    sendEvent("role.set", payload);
  }

  const defaultAnchor = useMemo<Anchor>(() => {
    const marker = bundle?.markerIndex[0];
    if (marker) {
      return { type: "marker", markerId: marker.markerId, textHash: marker.textHash };
    }
    const speech = bundle?.speechIndex[0];
    if (speech) {
      return {
        type: "speechSegment",
        speechSegmentId: speech.speechSegmentId,
        paragraphIndex: speech.paragraphIndex,
        textHash: speech.textHash,
      };
    }
    return { type: "paragraph", paragraphIndex: 0 };
  }, [bundle]);

  function sendScrollClock(state: ScrollClock["state"], offsetPx = playbackPositionPx, velocity = speed, anchor = defaultAnchor) {
    if (!joinResult) {
      return;
    }
    const scrollClock: Omit<ScrollClock, "roomRevision"> = {
      scrollClockId: `clk_${crypto.randomUUID()}`,
      scriptVersionId: SCRIPT_VERSION_ID,
      state,
      controlMode: "fixedSpeed",
      anchor,
      offsetPx,
      velocityPxPerSecond: state === "playing" ? velocity : 0,
      issuedAt: currentTime(),
      sourceDeviceId: joinResult.deviceId,
    };
    const payload: SetScrollClockPayload = { scrollClock };
    sendEvent("playback.setScrollClock", payload);
  }

  function currentControlOffset() {
    const clock = roomState?.scrollClock;
    if (clock?.state === "playing") {
      const elapsedSeconds = Math.max(0, Date.now() - clock.issuedAt) / 1000;
      return Math.max(0, clock.offsetPx + elapsedSeconds * clock.velocityPxPerSecond);
    }
    if (clock) {
      return Math.max(0, clock.offsetPx);
    }
    const reportedPosition = playerReports[0]?.playbackState?.positionPx;
    if (typeof reportedPosition === "number") {
      return Math.max(0, reportedPosition);
    }
    return Math.max(0, playbackPositionPx);
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

  function nudgePlayback(deltaPx: number) {
    const offset = Math.max(0, currentControlOffset() + deltaPx);
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

  useEffect(() => {
    playbackPositionRef.current = playbackPositionPx;
  }, [playbackPositionPx]);

  const reportPlayerState = useCallback(
    (clock: ScrollClock, positionPx: number) => {
      if (!joinResult) {
        return;
      }
      const playbackState: PlaybackState = {
        scriptVersionId: clock.scriptVersionId,
        state: clock.state,
        positionPx,
        currentAnchor: clock.anchor,
        velocityPxPerSecond: clock.velocityPxPerSecond,
        controlMode: clock.controlMode,
        sourceDeviceId: joinResult.deviceId,
        scrollClockId: clock.scrollClockId,
        reportedAt: currentTime(),
      };
      const payload: PlaybackReportPayload = { playbackState };
      sendEvent("playback.reportState", payload);
    },
    [joinResult, sendEvent],
  );

  useEffect(() => {
    if (mode !== "player" || !roomState?.scrollClock || !joinResult) {
      return;
    }

    const clock = roomState.scrollClock;
    if (clock.state === "paused") {
      window.setTimeout(() => {
        setPlaybackPositionPx(clock.offsetPx);
        playbackPositionRef.current = clock.offsetPx;
        reportPlayerState(clock, clock.offsetPx);
      }, 0);
      return;
    }

    if (clock.state !== "playing") {
      return;
    }

    const interval = window.setInterval(() => {
      const elapsedSeconds = Math.max(0, Date.now() - clock.issuedAt) / 1000;
      const position = clock.offsetPx + elapsedSeconds * clock.velocityPxPerSecond;
      setPlaybackPositionPx(position);
      playbackPositionRef.current = position;
      reportPlayerState(clock, position);
    }, 350);

    return () => window.clearInterval(interval);
  }, [joinResult, mode, reportPlayerState, roomState?.scrollClock]);

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
    setPlayerFontScale((value) => Math.min(1.35, Math.max(0.75, Number((value + delta).toFixed(2)))));
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

  return (
    <main className={`workspace ${mode === "player" ? "player-workspace" : ""} ${playerOverlayHidden ? "player-overlay-hidden" : ""}`}>
      <section className="room-topbar">
        <div>
          <p className="eyebrow">房间 {roomCode}</p>
          <h1>{mode === "control" ? "控制端" : mode === "player" ? "播放端" : "选择角色"}</h1>
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
            <button className="player-tool-button" type="button" onClick={() => void toggleFullscreen()}>
              {fullscreenActive ? "退出全屏" : "全屏"}
            </button>
            <button className="player-tool-button" type="button" aria-pressed={wakeLockWanted} onClick={() => void toggleWakeLock()}>
              {wakeLockActive ? "亮屏中" : "保持亮屏"}
            </button>
            {wakeLockStatus && <small className="player-wake-status">{wakeLockStatus}</small>}
            <button className="player-tool-button" type="button" onClick={() => setPlayerOverlayHidden(true)}>
              隐藏状态
            </button>
          </div>
        )}
        <div className={`status-pill ${connection}`}>
          <span />
          {connection === "connected" ? "已连接" : connection}
        </div>
      </section>
      {mode === "player" && playerOverlayHidden && (
        <button className="player-reveal-button" type="button" onClick={() => setPlayerOverlayHidden(false)}>
          显示状态
        </button>
      )}

      <section className="room-grid">
        <div className="panel">
          <p className="eyebrow">当前设备</p>
          <h2>{roleLabel(selfDevice?.role ?? selectedRole)}</h2>
          <p className="muted">Device ID</p>
          <code className="code-line">{joinResult?.deviceId ?? "joining"}</code>
          <div className="role-actions">
            <button className="button primary" onClick={() => setRole("control")}>
              设为控制端
            </button>
            <button className="button secondary" onClick={() => setRole("player")}>
              设为播放端
            </button>
          </div>
          <div className="role-links">
            <Link href={`/room/${roomCode}/control`}>打开控制端</Link>
            <Link href={`/room/${roomCode}/player`}>打开播放端</Link>
          </div>
          <p className="muted">{lastAck}</p>
        </div>

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

        <div className="panel">
          <p className="eyebrow">RoomState</p>
          <div className="stat-row">
            <span>roomRevision</span>
            <strong>{roomState?.roomRevision ?? "-"}</strong>
          </div>
          <div className="stat-row">
            <span>serverSeq</span>
            <strong>{roomState?.serverSeq ?? "-"}</strong>
          </div>
          <div className="stat-row">
            <span>设备数</span>
            <strong>{devices.length}</strong>
          </div>
          <div className="stat-row">
            <span>ScrollClock</span>
            <strong>{roomState?.scrollClock?.state ?? "-"}</strong>
          </div>
          <div className="stat-row">
            <span>Draft</span>
            <strong>{roomState?.scriptDraft.draftRevision ?? "-"}</strong>
          </div>
          <div className="stat-row">
            <span>Version</span>
            <strong>{roomState?.currentScriptVersionId ? "saved" : "draft"}</strong>
          </div>
        </div>

        {mode === "control" && (
          <div className="panel field-panel">
            <p className="eyebrow">Field Check</p>
            <h2>现场验收</h2>
            <div className="readiness-list">
              {fieldReadiness.map((item) => (
                <div className="readiness-row" key={item.label}>
                  <span className={`readiness-state ${item.status}`}>{item.status === "pass" ? "已通过" : item.status === "warn" ? "注意" : "待确认"}</span>
                  <div>
                    <strong>{item.label}</strong>
                    <p>{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {mode === "control" && (
          <div className="panel editor-panel">
            <p className="eyebrow">M3 Script Draft</p>
            <h2>文稿编辑与版本</h2>
            <p className="muted">{draftStatus}</p>
            <textarea value={markdown} onChange={(event) => setMarkdown(event.target.value)} />
            <div className="role-actions">
              <button className="button secondary" onClick={saveDraft}>
                保存草稿
              </button>
              <input
                aria-label="版本备注"
                value={versionMessage}
                onChange={(event) => setVersionMessage(event.target.value)}
                placeholder="版本备注"
              />
              <button className="button primary" onClick={saveVersion}>
                保存版本
              </button>
            </div>
            <div className="version-list">
              {versions.map((version) => (
                <div className="version-row" key={version.versionId}>
                  <div>
                    <strong>{version.message ?? "未命名版本"}</strong>
                    <small>
                      {new Date(version.createdAt).toLocaleTimeString("zh-CN")} · {version.markerCount} markers ·{" "}
                      {version.markdownLength} chars
                    </small>
                  </div>
                  <button className="button secondary" onClick={() => restoreVersion(version.versionId)}>
                    恢复
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {mode === "control" && bundle && (
          <div className="panel playback-panel">
            <p className="eyebrow">M2 Playback Intent</p>
            <h2>播放控制</h2>
            <div className="role-actions">
              <button className="button primary" onClick={() => playFromCurrentOffset()}>
                播放
              </button>
              <button className="button secondary" onClick={pauseAtCurrentOffset}>
                暂停
              </button>
              <button
                className="button secondary"
                onClick={() => {
                  const nextSpeed = speed === DEFAULT_SPEED ? 96 : DEFAULT_SPEED;
                  setSpeed(nextSpeed);
                  playFromCurrentOffset(nextSpeed);
                }}
              >
                速度 {speed}px/s
              </button>
            </div>
            <div className="marker-buttons">
              <button className="button secondary" onClick={() => nudgePlayback(-160)}>
                回退 160px
              </button>
              <button className="button secondary" onClick={() => nudgePlayback(160)}>
                前进 160px
              </button>
            </div>
            <div className="marker-buttons">
              {bundle.markerIndex.map((marker) => (
                <button className="button secondary" key={marker.markerId} onClick={() => jumpToMarker(marker.markerId)}>
                  跳到 {marker.markerId}
                </button>
              ))}
            </div>
            <div className="report-list">
              {playerReports.map((device) => (
                <p key={device.deviceId}>
                  {device.deviceId.slice(0, 10)} · {device.playbackState?.state} ·{" "}
                  {Math.round(device.playbackState?.positionPx ?? 0)}px
                </p>
              ))}
            </div>
          </div>
        )}

        <div className="panel device-panel">
          <p className="eyebrow">设备在线状态</p>
          <div className="device-list">
            {devices.map((device) => (
              <div className="device-row" key={device.deviceId}>
                <div>
                  <strong>{roleLabel(device.role)}</strong>
                  <code>{device.deviceId.slice(0, 16)}</code>
                </div>
                <div className="device-meta">
                  <span className={`dot ${device.online ? "online" : "offline"}`} />
                  {device.connectionState}
                  <small>{formatTime(device.lastSeenAt)}</small>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      {bundle && (
        <RenderBundleView
          bundle={bundle}
          variant={mode === "player" ? "player" : "control"}
          playbackPositionPx={playbackPositionPx}
          fontScale={playerFontScale}
        />
      )}
    </main>
  );
}

function devicesWithPlayback(roomState: RoomState | null) {
  return Object.values(roomState?.devices ?? {}).filter((device) => device.playbackState);
}
