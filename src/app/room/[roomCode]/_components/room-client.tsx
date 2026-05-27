"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { DeviceRole, RoomJoinResult, RoomState } from "@/domain/room/types";
import type { ClientEnvelope, ClientHelloPayload, RoleSetPayload, ServerEnvelope } from "@/shared/protocol";

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

export function RoomClient({ roomCode, mode }: RoomClientProps) {
  const socketRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const roomRevisionRef = useRef(0);
  const clientSeqRef = useRef(0);
  const [connection, setConnection] = useState<ConnectionState>("joining");
  const [joinResult, setJoinResult] = useState<RoomJoinResult | null>(null);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [lastAck, setLastAck] = useState<string>("尚未发送事件");

  const selectedRole = preferredRole(mode);
  const selfDevice = roomState && joinResult ? roomState.devices[joinResult.deviceId] : null;

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
        </div>

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
    </main>
  );
}
