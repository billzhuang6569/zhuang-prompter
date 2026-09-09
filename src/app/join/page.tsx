"use client";

import { useState, type FormEvent } from 'react';

export default function JoinPlayer() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('roomCode') ?? '').trim();
    if (!/^\d{6}$/.test(code)) { setError('请输入完整的 6 位房间号'); return; }
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/rooms/${code}/join`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId: localStorage.getItem(`zhuang-prompter:${code}:player:deviceId`) }),
      });
      if (!response.ok) { setError(response.status === 404 ? '没有找到这个房间，请核对房间号' : '暂时无法连接，请重试'); return; }
      const result = await response.json();
      localStorage.setItem(`zhuang-prompter:${code}:player:deviceId`, result.deviceId);
      window.location.assign(`/room/${code}/player`);
    } catch { setError('连接失败，请确认与主控电脑连接同一网络'); }
    finally { setBusy(false); }
  }
  return <main className="home-workspace">
    <section className="home-action-panel" style={{ maxWidth: 480, margin: '10vh auto' }}>
      <span className="brand-badge">PROMPTER</span>
      <h1>加入提词房间</h1>
      <p>输入主控端的房间号，开始展示提词。</p>
      <form className="home-join-form" onSubmit={join}>
        <label htmlFor="roomCode">6 位房间号</label>
        <div className="home-join-row">
          <input id="roomCode" name="roomCode" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="off" required placeholder="例如 123456" aria-describedby="join-error" />
          <button type="submit" disabled={busy}>{busy ? '连接中…' : '进入展示'}</button>
        </div>
        <p id="join-error" role="alert">{error}</p>
      </form>
      <p>请与主控电脑连接同一个 Wi-Fi 或热点。可以收藏本页，下次输入新的房间号即可。</p>
    </section>
  </main>;
}
