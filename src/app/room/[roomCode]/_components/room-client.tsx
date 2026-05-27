"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const scrollClockRef = useRef<ScrollClock | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("joining");
  const [joinResult, setJoinResult] = useState<RoomJoinResult | null>(null);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [playbackPositionPx, setPlaybackPositionPx] = useState(0);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [markdown, setMarkdown] = useState("");
  const [draftStatus, setDraftStatus] = useState("草稿未加载");
  const [versionMessage, setVersionMessage] = useState("");
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [currentOrigin, setCurrentOrigin] = useState("");
  const [networkOrigins, setNetworkOrigins] = useState<NetworkOrigin[]>([]);
  const [playerFontScale, setPlayerFontScale] = useState(1);
  const [playerMirrored, setPlayerMirrored] = useState(false);
  const [playerOverlayHidden, setPlayerOverlayHidden] = useState(false);
  const [fullscreenActive, setFullscreenActive] = useState(false);
  const [wakeLockWanted, setWakeLockWanted] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [wakeLockStatus, setWakeLockStatus] = useState("");
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [expandedQrLink, setExpandedQrLink] = useState<(NetworkOrigin & { playerUrl: string }) | null>(null);

  const selectedRole = preferredRole(mode);
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
  const activeScrollClock = roomState?.scrollClock ?? null;
  const activeScrollClockKey = activeScrollClock
    ? [
        activeScrollClock.scrollClockId,
        activeScrollClock.state,
        activeScrollClock.offsetPx,
        activeScrollClock.velocityPxPerSecond,
        activeScrollClock.issuedAt,
        JSON.stringify(activeScrollClock.anchor),
      ].join(":")
    : "";

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
  }, [activeScrollClock, activeScrollClockKey]);

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

  function insertMarkdownSnippet(kind: "marker" | "comment") {
    if (kind === "marker") {
      const nextIndex = (bundle?.markerIndex.length ?? 0) + 1;
      const markerId = `M${nextIndex.toString().padStart(3, "0")}`;
      setMarkdown((value) => `${value.trimEnd()}\n\n::marker[${markerId}]{type="section" label="新标记" note="现场跳转点"}\n`);
      return;
    }
    setMarkdown((value) => `${value.trimEnd()}\n\n::stageCue[注释]{cue="给拍摄或后期看的提示"}\n`);
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
    if (mode !== "player" || !activeScrollClockKey || !joinResult) {
      return;
    }

    const clock = scrollClockRef.current;
    if (!clock) {
      return;
    }

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

    let animationFrame = 0;
    let lastReportedAt = 0;
    const tick = () => {
      const elapsedSeconds = Math.max(0, Date.now() - clock.issuedAt) / 1000;
      const position = clock.offsetPx + elapsedSeconds * clock.velocityPxPerSecond;
      setPlaybackPositionPx(position);
      playbackPositionRef.current = position;
      if (Date.now() - lastReportedAt >= 350) {
        lastReportedAt = Date.now();
        reportPlayerState(clock, position);
      }
      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);

    return () => window.cancelAnimationFrame(animationFrame);
  }, [activeScrollClockKey, joinResult, mode, reportPlayerState]);

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
            <button className="player-tool-button" type="button" aria-pressed={playerMirrored} onClick={() => setPlayerMirrored((value) => !value)}>
              {playerMirrored ? "取消镜像" : "镜像"}
            </button>
            <button className="player-tool-button" type="button" onClick={() => playFromCurrentOffset()}>
              播放
            </button>
            <button className="player-tool-button" type="button" onClick={pauseAtCurrentOffset}>
              暂停
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
        {mode === "control" && bundle && (
          <div className="panel control-hero-panel">
            <div className="control-hero-head">
              <div>
                <p className="eyebrow">文稿中心</p>
                <h2>渲染视图编辑</h2>
                <p className="muted">{draftStatus}</p>
              </div>
              <div className="editor-toolbar" aria-label="文稿工具栏">
                <button className="icon-button" type="button" title="增加标记" onClick={() => insertMarkdownSnippet("marker")}>
                  M+
                </button>
                <button className="icon-button" type="button" title="增加注释" onClick={() => insertMarkdownSnippet("comment")}>
                  注
                </button>
                <button className="button primary" type="button" onClick={saveVersion}>
                  保存
                </button>
              </div>
            </div>
            <RenderBundleView bundle={bundle} variant="control" playbackPositionPx={playbackPositionPx} showCenterGuide />
            <details className="source-editor">
              <summary>编辑 Markdown 原文</summary>
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
              </div>
            </details>
          </div>
        )}

        {mode === "control" && (
          <div className="panel version-panel">
            <p className="eyebrow">历史版本</p>
            <h2>版本列表</h2>
            <div className="version-list compact">
              {versions.length === 0 && <p className="muted">还没有保存过版本</p>}
              {versions.map((version) => (
                <div className="version-row" key={version.versionId}>
                  <div>
                    <strong>{version.message ?? "未命名版本"}</strong>
                    <small>
                      {new Date(version.createdAt).toLocaleTimeString("zh-CN")} · {version.markerCount} markers
                    </small>
                  </div>
                  <button className="icon-button" title="回退到这个版本" onClick={() => restoreVersion(version.versionId)}>
                    ↩
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {mode === "control" && bundle && (
          <div className="panel playback-panel">
            <p className="eyebrow">播放控制</p>
            <h2>控制播放端</h2>
            <div className="playback-controls">
              <button className="button primary" onClick={() => playFromCurrentOffset()}>
                播放
              </button>
              <button className="button secondary" onClick={pauseAtCurrentOffset}>
                暂停
              </button>
              <label>
                速度
                <input
                  aria-label="播放速度"
                  max={160}
                  min={24}
                  onChange={(event) => {
                    const nextSpeed = Number(event.target.value);
                    setSpeed(nextSpeed);
                    if (roomState?.scrollClock?.state === "playing") {
                      playFromCurrentOffset(nextSpeed);
                    }
                  }}
                  type="range"
                  value={speed}
                />
                <span>{speed}px/s</span>
              </label>
            </div>
            <div className="marker-buttons secondary-markers">
              <button className="button secondary" onClick={() => nudgePlayback(-160)}>
                回退 160px
              </button>
              <button className="button secondary" onClick={() => nudgePlayback(160)}>
                前进 160px
              </button>
              {bundle.markerIndex.map((marker) => (
                <button className="button secondary" key={marker.markerId} onClick={() => jumpToMarker(marker.markerId)}>
                  跳到 {marker.markerId}
                </button>
              ))}
            </div>
          </div>
        )}

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
      {mode === "player" && bundle && (
        <RenderBundleView
          bundle={bundle}
          variant={mode === "player" ? "player" : "control"}
          playbackPositionPx={playbackPositionPx}
          fontScale={playerFontScale}
          mirrored={mode === "player" && playerMirrored}
        />
      )}
    </main>
  );
}

function devicesWithPlayback(roomState: RoomState | null) {
  return Object.values(roomState?.devices ?? {}).filter((device) => device.playbackState);
}
