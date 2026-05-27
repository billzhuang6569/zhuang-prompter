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
import { RenderBundleView } from "./render-bundle-view";

type RoomClientProps = {
  roomCode: string;
  mode: "select-role" | "control" | "player";
  bundle?: RenderBundle;
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

export function RoomClient({ roomCode, mode, bundle }: RoomClientProps) {
  const socketRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const roomRevisionRef = useRef(0);
  const playbackPositionRef = useRef(0);
  const clientSeqRef = useRef(0);
  const [connection, setConnection] = useState<ConnectionState>("joining");
  const [joinResult, setJoinResult] = useState<RoomJoinResult | null>(null);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [lastAck, setLastAck] = useState<string>("尚未发送事件");
  const [playbackPositionPx, setPlaybackPositionPx] = useState(0);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);

  const selectedRole = preferredRole(mode);
  const selfDevice = roomState && joinResult ? roomState.devices[joinResult.deviceId] : null;
  const playerReports = devicesWithPlayback(roomState);

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
  }, [roomState?.roomRevision]);

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
    if (!joinResult) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${window.location.host}${joinResult.wsUrl}`);
    const sessionId = makeSessionId();
    sessionIdRef.current = sessionId;
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      clientSeqRef.current += 1;
      const hello: ClientEnvelope<ClientHelloPayload> = {
        type: "client.hello",
        eventId: makeEventId(),
        roomId: joinResult.roomId,
        deviceId: joinResult.deviceId,
        sessionId,
        clientSeq: clientSeqRef.current,
        baseRoomRevision: joinResult.lastRoomRevision,
        sentAt: Date.now(),
        payload: {
          role: selectedRole,
          lastSeenRoomRevision: joinResult.lastRoomRevision,
          lastSeenServerSeq: joinResult.roomState.serverSeq,
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
      setConnection("disconnected");
    });

    const heartbeat = window.setInterval(() => {
      sendEvent("presence.heartbeat", {});
    }, 10_000);

    return () => {
      window.clearInterval(heartbeat);
      socket.close();
      sessionIdRef.current = null;
    };
  }, [joinResult, selectedRole, sendEvent]);

  const devices = useMemo(() => Object.values(roomState?.devices ?? {}), [roomState]);

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
    <main className="workspace">
      <section className="room-topbar">
        <div>
          <p className="eyebrow">房间 {roomCode}</p>
          <h1>{mode === "control" ? "控制端" : mode === "player" ? "播放端" : "选择角色"}</h1>
        </div>
        <div className={`status-pill ${connection}`}>
          <span />
          {connection === "connected" ? "已连接" : connection}
        </div>
      </section>

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
        </div>

        {mode === "control" && bundle && (
          <div className="panel playback-panel">
            <p className="eyebrow">M2 Playback Intent</p>
            <h2>播放控制</h2>
            <div className="role-actions">
              <button className="button primary" onClick={() => sendScrollClock("playing")}>
                播放
              </button>
              <button className="button secondary" onClick={() => sendScrollClock("paused", playbackPositionPx, 0)}>
                暂停
              </button>
              <button
                className="button secondary"
                onClick={() => {
                  const nextSpeed = speed === DEFAULT_SPEED ? 96 : DEFAULT_SPEED;
                  setSpeed(nextSpeed);
                  sendScrollClock("playing", playbackPositionPx, nextSpeed);
                }}
              >
                速度 {speed}px/s
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
        />
      )}
    </main>
  );
}

function devicesWithPlayback(roomState: RoomState | null) {
  return Object.values(roomState?.devices ?? {}).filter((device) => device.playbackState);
}
