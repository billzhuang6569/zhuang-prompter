"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

type RoomSummary = {
  roomId: string;
  roomCode: string;
  projectName: string;
  status: "active" | "closed";
  createdAt: number;
  updatedAt: number;
  draftRevision: number;
  markerCount: number;
  versionCount: number;
  previewText: string;
};

type NetworkOrigin = {
  label: string;
  origin: string;
  kind: "local" | "lan";
};

export default function Home() {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [networkOrigins, setNetworkOrigins] = useState<NetworkOrigin[]>([]);

  useEffect(() => {
    let alive = true;
    async function loadHomeData() {
      const [roomsResponse, networkResponse] = await Promise.all([fetch("/api/rooms"), fetch("/api/network-info")]);
      if (!alive) {
        return;
      }
      if (roomsResponse.ok) {
        const data = (await roomsResponse.json()) as { rooms: RoomSummary[] };
        setRooms(data.rooms);
      }
      if (networkResponse.ok) {
        const data = (await networkResponse.json()) as { origins: NetworkOrigin[] };
        setNetworkOrigins(data.origins);
      }
    }
    void loadHomeData().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const lanOrigin = useMemo(() => networkOrigins.find((origin) => origin.kind === "lan"), [networkOrigins]);

  async function createRoom() {
    const response = await fetch("/api/rooms", { method: "POST" });
    const data = (await response.json()) as { roomCode: string; deviceId: string };
    window.localStorage.setItem(`zhuang-prompter:${data.roomCode}:control:deviceId`, data.deviceId);
    window.location.href = `/room/${data.roomCode}/control`;
  }

  function joinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const roomCode = String(formData.get("roomCode") ?? "").replace(/\D/g, "");
    if (roomCode) {
      window.location.href = `/room/${roomCode}/select-role`;
    }
  }

  return (
    <main className="home-workspace">
      <header className="home-appbar">
        <div className="control-brand">
          <img className="app-brand-logo" src="/brand/logo.png" alt="" width={40} height={40} />
          <div>
            <strong>庄Sir的提词器</strong>
            <span>房间入口</span>
          </div>
        </div>
        <div className="home-appbar-meta">
          <span>本地服务器</span>
          <strong>{lanOrigin?.origin.replace(/^https?:\/\//, "") ?? "localhost:3000"}</strong>
        </div>
      </header>

      <section className="home-entry-shell">
        <div className="home-hero-copy">
          <div className="home-hero-tag">CONTROL ROOM</div>
          <h1>创建一个拍摄提词房间</h1>
          <p>这台电脑 会作为本地房间服务器。创建后自动进入控制端，其他设备通过同一局域网链接进入播放端。</p>
          <div className="home-flow">
            <div>
              <Icon name="create" />
              <span>创建房间</span>
            </div>
            <div>
              <Icon name="control" />
              <span>控制播放</span>
            </div>
            <div>
              <Icon name="player" />
              <span>扫码播放端</span>
            </div>
          </div>

          <section className="home-projects" aria-label="项目画册">
            <div className="home-section-title">
              <span>PROJECTS</span>
              <strong>项目画册</strong>
            </div>
            {rooms.length > 0 ? (
              <div className="home-project-grid">
                {rooms.map((room) => (
                  <a className="home-project-card" href={`/room/${room.roomCode}/control`} key={room.roomId}>
                    <span className="home-project-code">ROOM {room.roomCode}</span>
                    <strong>{room.projectName || `房间 ${room.roomCode}`}</strong>
                    <p>{room.previewText || "还没有文稿内容"}</p>
                    <div>
                      <span>{room.markerCount} 个标记</span>
                      <span>{room.versionCount} 个版本</span>
                      <span>{formatTime(room.updatedAt)}</span>
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <div className="home-empty-projects">还没有固定下来的房间。创建第一个房间后，它会出现在这里。</div>
            )}
          </section>
        </div>

        <div className="home-action-panel">
          <div className="home-action-head">
            <span>NEW</span>
            <Icon name="bolt" />
          </div>
          <button className="home-create-button" onClick={createRoom}>
            <Icon name="create" />
            创建新房间
          </button>

          <form onSubmit={joinRoom} className="home-join-form">
            <label htmlFor="roomCode">加入已有房间</label>
            <div className="home-join-row">
              <input id="roomCode" name="roomCode" inputMode="numeric" placeholder="输入 6 位房间号" />
              <button type="submit">
                <Icon name="arrow" />
                加入
              </button>
            </div>
          </form>

          <div className="home-note-card">
            <strong>同局域网使用</strong>
            <p><a href="/join">打开通用展示端入口</a></p>
            <p>
              本机服务已监听局域网。其他电脑与这台电脑 在同一 Wi-Fi 或热点下，打开{" "}
              {lanOrigin?.origin ?? "http://本机IP:3000"} 即可进入。
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function Icon({ name }: { name: "arrow" | "bolt" | "control" | "create" | "player" }) {
  const paths = {
    arrow: <path d="M5 12h13m-5-5 5 5-5 5" />,
    bolt: <path d="M13 2 4 14h7l-1 8 10-13h-7l1-7Z" />,
    control: <path d="M4 6h16v12H4V6Zm4 16h8M12 18v4" />,
    create: <path d="M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0Zm8-4v8M8 12h8" />,
    player: <path d="M7 4h10v16H7V4Zm3 13h4M10 7h4" />,
  };

  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24">
      {paths[name]}
    </svg>
  );
}
