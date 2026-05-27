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
    <main className="workspace">
      <section className="entry-layout">
        <div className="entry-copy">
          <p className="eyebrow">庄Sir 的提词器 · P0 本地验收版</p>
          <h1>拍摄提词房间</h1>
          <p className="lead">创建房间后，可分开打开控制端和播放端，验证文稿、播放时钟、版本保存、语音跟随和断线恢复。</p>
        </div>
        <div className="panel entry-panel">
          <button className="button primary full" onClick={createRoom}>
            创建新房间
          </button>
          <form onSubmit={joinRoom} className="join-form">
            <label htmlFor="roomCode">加入已有房间</label>
            <div className="join-row">
              <input id="roomCode" name="roomCode" inputMode="numeric" placeholder="6 位房间号" />
              <button className="button secondary" type="submit">
                加入
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
