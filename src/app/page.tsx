"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { copyTextToClipboard } from "@/shared/clipboard";

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
  kind: "local" | "lan" | "mdns";
};

export default function Home() {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [networkOrigins, setNetworkOrigins] = useState<NetworkOrigin[]>([]);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  // 是否为"短链/播放端主机"：即通过 play.local 或局域网 IP 访问（非本机 localhost）。
  // 这类访问只展示干净的播放入口（画册→播放端 + 房间号输入），不显示创建房间等控制端功能（§item3）。
  const [isPlayerHost, setIsPlayerHost] = useState(false);

  useEffect(() => {
    let alive = true;
    // 延后到微任务后再置状态，避免在 effect 体内同步 setState（与 room-client 一致）。
    const timer = window.setTimeout(() => {
      if (!alive) {
        return;
      }
      const hostname = window.location.hostname;
      const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
      setIsPlayerHost(!isLocalHost);
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, []);

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
  // 固定统一短链（mDNS）：所有机器统一广播的好记地址，作为播放端进入入口（§12.5）。
  const mdnsOrigin = useMemo(() => networkOrigins.find((origin) => origin.kind === "mdns"), [networkOrigins]);
  // 展示串去掉协议前缀（如 play.local:3000）；拿不到时用占位串，不崩。
  const shortLink = mdnsOrigin?.origin.replace(/^https?:\/\//, "") ?? "play.local:3000";
  const shortLinkHref = mdnsOrigin?.origin ?? `http://${shortLink}`;

  function openShortLink() {
    window.open(shortLinkHref, "_blank", "noopener,noreferrer");
  }

  async function copyShortLink() {
    // 走统一的多级降级复制（原生桥 → clipboard API → execCommand），修复大字网址点击不复制（§item1）。
    const ok = await copyTextToClipboard(shortLink);
    setCopyState(ok ? "copied" : "failed");
    window.setTimeout(() => setCopyState("idle"), 1800);
  }

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
      // 加入即播放端：不再经过角色确认页（§12.3）。
      window.location.href = `/room/${roomCode}/player`;
    }
  }

  // —— 短链/播放端主机：干净的播放入口界面（§item3）——
  if (isPlayerHost) {
    return (
      <main className="home-workspace">
        <header className="home-appbar">
          <div className="control-brand">
            <img className="app-brand-logo" src="/brand/logo.png" alt="" width={40} height={40} />
            <div>
              <strong>庄Sir的提词器</strong>
              <span>播放端入口</span>
            </div>
          </div>
          <div className="home-appbar-meta">
            <span>提词器网址</span>
            <strong>{shortLink}</strong>
          </div>
        </header>

        <section className="home-entry-shell">
          {/* 左列：项目画册。点击进入播放端（§item3）。 */}
          <div className="home-left-col">
            <section className="home-projects home-projects-lead" aria-label="项目画册">
              <div className="home-section-title">
                <span>PROJECTS</span>
                <strong>项目画册</strong>
              </div>
              {rooms.length > 0 ? (
                <div className="home-project-grid">
                  {rooms.map((room) => (
                    <a className="home-project-card" href={`/room/${room.roomCode}/player`} key={room.roomId}>
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
                <div className="home-empty-projects">控制端还没有创建房间。请在控制端电脑上创建房间后，这里会出现可进入的项目。</div>
              )}
            </section>
          </div>

          {/* 右列：只保留房间号输入 → 播放端（§item3）。 */}
          <div className="home-right-col">
            <div className="home-action-panel">
              <div className="home-action-head">
                <span>JOIN</span>
                <Icon name="player" />
              </div>
              <form onSubmit={joinRoom} className="home-join-form">
                <label htmlFor="roomCode">输入房间号进入播放端</label>
                <div className="home-join-row">
                  <input id="roomCode" name="roomCode" inputMode="numeric" placeholder="输入 6 位房间号" autoFocus />
                  <button type="submit">
                    <Icon name="arrow" />
                    进入
                  </button>
                </div>
              </form>
              <p className="home-join-hint">选择左侧项目画册中的房间，或直接输入房间号，即可作为提词器（播放端）加入。</p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  // —— 本机（控制端）：完整的控制房间界面 ——
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
        {/* 左列：单一滚动容器。向上滚动时 hero（标题+说明+步骤）被推走，PROJECTS 标题吸顶后画册在其下方继续滚动（§12.5）。 */}
        <div className="home-left-col">
          <div className="home-hero-copy">
            <div className="home-hero-tag">CONTROL ROOM</div>
            <h1>创建一个拍摄提词房间</h1>
            <p>
              这台电脑作为控制者，创建房间后，其他提词器电脑，通过{" "}
              <strong className="home-shortlink-inline">{shortLink}</strong> 输入房间号进入房间。
            </p>

            <ol className="home-flow" aria-label="使用步骤">
              <li className="home-step">
                <span className="home-step-icon">
                  <Icon name="wifi" />
                </span>
                <div className="home-step-body">
                  <span className="home-step-tag">STEP 1</span>
                  <strong>连接同一 Wi-Fi</strong>
                </div>
              </li>
              <li className="home-step-arrow" aria-hidden="true">
                <Icon name="arrow" />
              </li>
              <li className="home-step">
                <span className="home-step-icon">
                  <Icon name="create" />
                </span>
                <div className="home-step-body">
                  <span className="home-step-tag">STEP 2</span>
                  <strong>APP 建立房间</strong>
                </div>
              </li>
              <li className="home-step-arrow" aria-hidden="true">
                <Icon name="arrow" />
              </li>
              <li className="home-step">
                <span className="home-step-icon">
                  <Icon name="player" />
                </span>
                <div className="home-step-body">
                  <span className="home-step-tag">STEP 3</span>
                  <strong>
                    提词器电脑使用{" "}
                    <button type="button" className="home-step-link" onClick={openShortLink}>
                      {shortLink}
                    </button>{" "}
                    加入房间
                  </strong>
                  <small>（点击 {shortLink} 可打开浏览器）</small>
                </div>
              </li>
            </ol>
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

        {/* 右列：始终冻结在视口内（§12.4）。 */}
        <div className="home-right-col">
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
          </div>

          <button type="button" className="home-shortlink-box" onClick={copyShortLink} aria-label={`复制短链地址 ${shortLink}`}>
            <span className="home-shortlink-label">短链地址（局域网内直接输入）</span>
            <strong className="home-shortlink-value">{shortLink}</strong>
            <span className={`home-shortlink-hint${copyState === "copied" ? " is-copied" : ""}${copyState === "failed" ? " is-failed" : ""}`}>
              {copyState === "copied" ? "已复制到剪贴板" : copyState === "failed" ? "复制失败，请手动输入" : "点击复制"}
            </span>
          </button>
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

function Icon({ name }: { name: "arrow" | "bolt" | "control" | "create" | "player" | "wifi" }) {
  const paths = {
    arrow: <path d="M5 12h13m-5-5 5 5-5 5" />,
    bolt: <path d="M13 2 4 14h7l-1 8 10-13h-7l1-7Z" />,
    control: <path d="M4 6h16v12H4V6Zm4 16h8M12 18v4" />,
    create: <path d="M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0Zm8-4v8M8 12h8" />,
    player: <path d="M7 4h10v16H7V4Zm3 13h4M10 7h4" />,
    wifi: <path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8 15.5a5 5 0 0 1 8 0M12 19h.01" />,
  };

  return (
    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24">
      {paths[name]}
    </svg>
  );
}
