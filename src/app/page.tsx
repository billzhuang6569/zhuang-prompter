"use client";

import type { FormEvent } from "react";

export default function Home() {
  async function createRoom() {
    const response = await fetch("/api/rooms", { method: "POST" });
    const data = (await response.json()) as { roomCode: string; deviceId: string };
    window.localStorage.setItem(`zhuang-prompter:${data.roomCode}:deviceId`, data.deviceId);
    window.location.href = `/room/${data.roomCode}/select-role`;
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
          <p className="eyebrow">庄Sir 的提词器 · M0</p>
          <h1>拍摄房间实时地基</h1>
          <p className="lead">先验证房间、设备、角色和在线状态同步。Markdown、播放时钟、版本和语音将在后续里程碑进入。</p>
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
