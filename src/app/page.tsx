"use client";

import type { FormEvent } from "react";

export default function Home() {
  async function createRoom() {
    const response = await fetch("/api/rooms", { method: "POST" });
    const data = (await response.json()) as { roomCode: string; deviceId: string };
    window.localStorage.setItem(`zhuang-prompter:${data.roomCode}:deviceId`, data.deviceId);
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
          <span className="brand-badge">PROMPTER</span>
          <div>
            <strong>庄Sir的提词器</strong>
            <span>房间入口</span>
          </div>
        </div>
        <div className="home-appbar-meta">
          <span>本地服务器</span>
          <strong>localhost:3000</strong>
        </div>
      </header>

      <section className="home-entry-shell">
        <div className="home-hero-copy">
          <div className="home-hero-tag">CONTROL ROOM</div>
          <h1>创建一个拍摄提词房间</h1>
          <p>这台 Mac 会作为本地房间服务器。创建后自动进入控制端，其他设备通过同一局域网链接进入播放端。</p>
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
            <p>控制端和播放端都连接到这台 Mac 上运行的本地服务；热点或同 Wi-Fi 均可测试。</p>
          </div>
        </div>
      </section>
    </main>
  );
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
