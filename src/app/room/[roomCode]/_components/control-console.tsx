"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { RoomJoinResult } from "@/domain/room/types";
import type { MarkerAnchor, RenderBundle, RenderNode } from "@/modules/script-engine/types";

type VersionSummary = {
  versionId: string;
  message?: string;
  createdAt: number;
  markerCount: number;
  markdownLength: number;
};

type PlayerLink = {
  label: string;
  origin: string;
  kind: "local" | "lan";
  controlUrl: string;
  playerUrl: string;
};

type MarkdownCommand = "heading" | "marker" | "comment";

type PendingEditorAction = {
  kind: "marker" | "comment";
  value: string;
};

type ControlConsoleProps = {
  roomCode: string;
  connectionLabel: string;
  isConnected: boolean;
  deviceCount: number;
  joinResult: RoomJoinResult | null;
  projectName: string;
  setProjectName: (value: string) => void;
  draftRevision?: number;
  parseStatus?: string;
  hasSavedVersion: boolean;
  markdown: string;
  setMarkdown: (value: string) => void;
  versionMessage: string;
  setVersionMessage: (value: string) => void;
  bundle?: RenderBundle;
  versions: VersionSummary[];
  speed: number;
  isPlaying: boolean;
  playerEntryLink?: PlayerLink;
  roomLinks: PlayerLink[];
  inviteStatus: "idle" | "copied" | "fallback";
  previewScrollRef: RefObject<HTMLDivElement | null>;
  markdownEditorRef: RefObject<HTMLTextAreaElement | null>;
  onInvite: () => void;
  onOpenQr: (link: PlayerLink) => void;
  onSaveDraft: () => void;
  onSaveVersion: () => void;
  onRestoreVersion: (versionId: string) => void;
  onTogglePlay: () => void;
  onNudge: (deltaPx: number) => void;
  onJumpToMarker: (markerId: string) => void;
  onSpeedChange: (speed: number) => void;
  onMarkdownCommand: (command: MarkdownCommand) => void;
  onBeginMarkerEdit: () => void;
  onBeginCommentEdit: () => void;
  pendingEditorAction: PendingEditorAction | null;
  onPendingEditorValueChange: (value: string) => void;
  onConfirmPendingEditorAction: () => void;
  onPreviewScroll: (scrollTop: number) => void;
};

export function ControlConsole({
  roomCode,
  connectionLabel,
  isConnected,
  deviceCount,
  joinResult,
  projectName,
  setProjectName,
  draftRevision,
  parseStatus,
  hasSavedVersion,
  markdown,
  setMarkdown,
  versionMessage,
  setVersionMessage,
  bundle,
  versions,
  speed,
  isPlaying,
  playerEntryLink,
  roomLinks,
  inviteStatus,
  previewScrollRef,
  markdownEditorRef,
  onInvite,
  onOpenQr,
  onSaveDraft,
  onSaveVersion,
  onRestoreVersion,
  onTogglePlay,
  onNudge,
  onJumpToMarker,
  onSpeedChange,
  onMarkdownCommand,
  onBeginMarkerEdit,
  onBeginCommentEdit,
  pendingEditorAction,
  onPendingEditorValueChange,
  onConfirmPendingEditorAction,
  onPreviewScroll,
}: ControlConsoleProps) {
  const [view, setView] = useState<"render" | "raw">("render");
  const quickInputRef = useRef<HTMLInputElement | null>(null);

  const markers = bundle?.markerIndex ?? [];
  const safePlayerLink = playerEntryLink ?? roomLinks[0];

  useEffect(() => {
    if (pendingEditorAction) {
      quickInputRef.current?.focus();
      quickInputRef.current?.select();
    }
  }, [pendingEditorAction]);

  return (
    <main className="nike-control">
      <header className="nike-ubar" data-od-id="status-bar">
        <div className="nike-brand">
          <div className="nike-brand-ic">
            <MiniPrompterIcon />
          </div>
          庄Sir的提词器
        </div>
        <div className="nike-u-div" />
        <div className="nike-u-it">
          <span>房间</span>
          <span className="nike-u-value">{roomCode}</span>
        </div>
        <div className="nike-u-div" />
        <div className="nike-u-it">
          <div className={isConnected ? "nike-u-dot" : "nike-u-dot is-muted"} />
          <span className={isConnected ? "nike-u-ok" : undefined}>{connectionLabel}</span>
        </div>
        <div className="nike-u-div" />
        <div className="nike-u-it">
          <span>设备</span>
          <span className="nike-u-value">{deviceCount}</span>
        </div>
        <div className="nike-u-sp" />
        {joinResult?.deviceId && <div className="nike-u-did">{joinResult.deviceId}</div>}
        <button className="nike-top-btn" type="button" disabled={!safePlayerLink} onClick={onInvite}>
          {inviteStatus === "copied" ? "已复制" : inviteStatus === "fallback" ? "扫码邀请" : "邀请"}
        </button>
      </header>

      <div className="nike-main">
        <section className="nike-lp" data-od-id="left-panel">
          <div className="nike-shdr" data-od-id="script-header">
            <input
              className="nike-title-input"
              aria-label="项目名称"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
            />
            <span className="nike-bdg">draft rev {draftRevision ?? 0}</span>
            <span className={`nike-bdg ${parseStatus === "valid" ? "nike-bdg-ok" : ""}`}>{parseStatus ?? "draft"}</span>
            <span className="nike-bdg nike-bdg-ink">{hasSavedVersion ? "已保存版本" : "未保存版本"}</span>
            <div className="nike-vtabs">
              <button className={`nike-vtab ${view === "render" ? "on" : ""}`} type="button" onClick={() => setView("render")}>
                预览
              </button>
              <button className={`nike-vtab ${view === "raw" ? "on" : ""}`} type="button" onClick={() => setView("raw")}>
                原文
              </button>
            </div>
          </div>

          <div className={`nike-srw ${isPlaying ? "playing" : ""}`} data-od-id="script-render-wrapper">
            <div className="nike-iline" />

            {view === "render" ? (
              <div
                className="nike-sr"
                ref={previewScrollRef}
                data-od-id="script-render"
                onScroll={(event) => onPreviewScroll(event.currentTarget.scrollTop)}
              >
                <div className="nike-sc">
                  {bundle ? (
                    bundle.htmlTree.map((node) => (
                      <ControlRenderNode key={node.renderNodeId} node={node} onJumpToMarker={onJumpToMarker} />
                    ))
                  ) : (
                    <p>开始输入 Markdown 文稿，右侧播放端会同步显示。</p>
                  )}
                  <div className="nike-bottom-space" />
                </div>
              </div>
            ) : (
              <div className="nike-sr" data-od-id="script-raw">
                <pre className="nike-raw">{markdown}</pre>
              </div>
            )}
          </div>

          <div className="nike-mde-w" data-od-id="md-editor">
            <div className="nike-mde-b open">
              <div className="nike-editor-tools" data-od-id="toolbar">
                <button
                  className="nike-tlb"
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={onBeginMarkerEdit}
                >
                  <StarIcon />
                  增加标记
                </button>
                <button
                  className="nike-tlb"
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={onBeginCommentEdit}
                >
                  <CommentIcon />
                  增加注释
                </button>
                <div className="nike-t-sep" />
                <button
                  className="nike-tlb"
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onMarkdownCommand("heading")}
                >
                  标题
                </button>
                <button className="nike-t-save" type="button" onClick={onSaveVersion}>
                  <SaveIcon />
                  保存
                </button>
              </div>
              {pendingEditorAction && (
                <div className="nike-quick-editor">
                  <span>{pendingEditorAction.kind === "marker" ? "标记内容" : "注释内容"}</span>
                  <input
                    ref={quickInputRef}
                    value={pendingEditorAction.value}
                    onChange={(event) => onPendingEditorValueChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        onConfirmPendingEditorAction();
                      }
                    }}
                    placeholder={pendingEditorAction.kind === "marker" ? "输入标记名称" : "输入注释内容"}
                  />
                  <button type="button" title="完成" onClick={onConfirmPendingEditorAction}>
                    <CheckIcon />
                  </button>
                </div>
              )}
              <textarea
                ref={markdownEditorRef}
                className="nike-mde-ta"
                spellCheck={false}
                value={markdown}
                onChange={(event) => setMarkdown(event.target.value)}
              />
              <div className="nike-mde-acts">
                <input
                  className="nike-mde-note"
                  type="text"
                  value={versionMessage}
                  onChange={(event) => setVersionMessage(event.target.value)}
                  placeholder="版本备注，如「现场保存」..."
                />
                <button className="nike-mde-save" type="button" onClick={onSaveDraft}>
                  保存草稿
                </button>
              </div>
            </div>
          </div>
        </section>

        <aside className="nike-rp" data-od-id="right-panel">
          <section className="nike-psec" data-od-id="playback-controls">
            <div className="nike-ph">播放控制</div>
            <div className="nike-pb">
              <button className="nike-stpb" type="button" title="后退 160px" onClick={() => onNudge(-160)}>
                ‹
              </button>
              <button className="nike-play-btn" type="button" onClick={onTogglePlay}>
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
              </button>
              <button className="nike-stpb" type="button" title="前进 160px" onClick={() => onNudge(160)}>
                ›
              </button>
            </div>
            <div className="nike-spdr">
              <span className="nike-spd-l">速度</span>
              <input type="range" min="10" max="150" value={speed} onChange={(event) => onSpeedChange(Number(event.target.value))} />
              <span className="nike-spd-v">{speed}px/s</span>
            </div>
            <div className="nike-sadj">
              <button className="nike-sadjb" type="button" onClick={() => onSpeedChange(speed - 10)}>
                -10
              </button>
              <button className="nike-sadjb" type="button" onClick={() => onSpeedChange(speed + 10)}>
                +10
              </button>
            </div>
            <div className="nike-srow">
              <button className="nike-srowb" type="button" onClick={() => onNudge(-160)}>
                ← 160px
              </button>
              <button className="nike-srowb" type="button" onClick={() => onNudge(160)}>
                160px →
              </button>
            </div>
          </section>

          <section className="nike-psec" data-od-id="marker-jump">
            <div className="nike-ph">标记跳转</div>
            <div className="nike-mkg">
              {markers.length === 0 ? (
                <span className="nike-empty">暂无标记</span>
              ) : (
                markers.map((marker) => (
                  <button className="nike-mkb" type="button" key={marker.markerId} onClick={() => onJumpToMarker(marker.markerId)}>
                    跳到 {marker.markerId}
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="nike-psec" data-od-id="version-history">
            <div className="nike-ph">历史版本</div>
            <div className="nike-vl">
              {versions.length === 0 ? (
                <span className="nike-empty">还没有保存过版本</span>
              ) : (
                versions.map((version, index) => (
                  <div className={`nike-vi ${index === 0 ? "cur" : ""}`} key={version.versionId}>
                    <div className="nike-vi-info">
                      <div className="nike-vi-name">{version.message || "现场保存"}</div>
                      <div className="nike-vi-meta">
                        {formatTime(version.createdAt)} · {version.markerCount} markers
                      </div>
                    </div>
                    <button className="nike-vib" type="button" onClick={() => onRestoreVersion(version.versionId)}>
                      ↩ 回退
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="nike-psec" data-od-id="player-entrance">
            <div className="nike-ph">播放端入口</div>
            {safePlayerLink ? (
              <>
                <div className="nike-qra">
                  <button className="nike-qrb" type="button" onClick={() => onOpenQr(safePlayerLink)} title="点击放大">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt="播放端二维码" src={`/api/qr?text=${encodeURIComponent(safePlayerLink.playerUrl)}`} />
                  </button>
                  <div className="nike-qrl">
                    {roomLinks.map((link) => (
                      <div className="nike-ql" key={`${link.kind}-${link.origin}`}>
                        <div className="nike-ql-lbl">{link.label}</div>
                        <button className="nike-ql-v" type="button" onClick={() => copyToClipboard(link.playerUrl)}>
                          {link.kind === "lan" ? link.origin.replace(/^https?:\/\//, "") : link.playerUrl}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="nike-qr-acts">
                  <button className="nike-btn" type="button" onClick={() => onOpenQr(safePlayerLink)}>
                    放大二维码
                  </button>
                  <button className="nike-btn nike-btn-ink" type="button" onClick={() => openPlayerWindow(safePlayerLink.playerUrl)}>
                    打开播放端
                  </button>
                </div>
              </>
            ) : (
              <span className="nike-empty">正在生成播放端入口</span>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

function ControlRenderNode({ node, onJumpToMarker }: { node: RenderNode; onJumpToMarker: (markerId: string) => void }) {
  if (node.type === "heading") {
    const HeadingTag = node.depth <= 1 ? "h1" : "h2";
    return <HeadingTag>{node.text}</HeadingTag>;
  }

  if (node.type === "marker") {
    return <MarkerTag marker={node.marker} onJumpToMarker={onJumpToMarker} />;
  }

  if (node.type === "stageCue") {
    return <StageCue label={cueText(node.cue) || node.body || "注释"} />;
  }

  return (
    <div className={`nike-script-text ${node.type === "listItem" ? "is-list-item" : ""}`}>
      <p>
        {node.inlineMarkers?.map((marker) => (
          <MarkerTag key={marker.markerId} marker={marker} onJumpToMarker={onJumpToMarker} inline />
        ))}
        {node.text}
      </p>
      {node.cue && <StageCue label={cueText(node.cue)} />}
    </div>
  );
}

function MarkerTag({
  marker,
  inline = false,
  onJumpToMarker,
}: {
  marker: Pick<MarkerAnchor, "markerId" | "label" | "type">;
  inline?: boolean;
  onJumpToMarker: (markerId: string) => void;
}) {
  return (
    <button className={`nike-mtag ${inline ? "inline" : ""}`} type="button" onClick={() => onJumpToMarker(marker.markerId)}>
      <span className="nike-dot-mini" />
      {marker.markerId}
      {marker.label ? ` · ${marker.label}` : ""}
    </button>
  );
}

function StageCue({ label }: { label: string }) {
  return (
    <div className="nike-scue">
      <span className="nike-scue-arrow">↳</span>
      {label}
    </div>
  );
}

function cueText(cue: { label?: string; cue?: string; level?: string; duration?: string }) {
  const levelLabels: Record<string, string> = {
    important: "重点",
    warning: "注意",
    soft: "轻声",
  };
  const level = cue.level ? (levelLabels[cue.level] ?? cue.level) : undefined;
  const cueValue = cue.label ? undefined : cue.cue;
  return [cue.label ?? cueValue, level, cue.duration].filter(Boolean).join(" · ");
}

function formatTime(value: number) {
  return new Date(value).toLocaleTimeString("zh-CN", { hour12: false });
}

async function copyToClipboard(value: string) {
  await navigator.clipboard?.writeText(value).catch(() => undefined);
}

function openPlayerWindow(url: string) {
  const width = 920;
  const height = 720;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
  const features = [
    "popup=yes",
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    "noopener=yes",
    "noreferrer=yes",
  ].join(",");
  const playerWindow = window.open(url, "zhuang-prompter-player", features);
  playerWindow?.focus();
}

function MiniPrompterIcon() {
  return (
    <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
      <rect x="1" y="1" width="7.5" height="7" rx="1" fill="#111111" opacity=".9" />
      <rect x="9.5" y="2.8" width="1.5" height="3.5" rx=".4" fill="#111111" opacity=".7" />
      <line x1="2.5" y1="3.8" x2="7" y2="3.8" stroke="#4493f8" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="2.5" y1="5.8" x2="5.5" y2="5.8" stroke="#4493f8" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
      <path
        d="M5.5 1.2 6.8 4.2h3.4L7.7 5.9 8.7 9 5.5 7.1 2.3 9l1-3.1L.8 4.2h3.4L5.5 1.2Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
      <path
        d="M1.5 1.5h8a.7.7 0 0 1 .7.7v5.2a.7.7 0 0 1-.7.7H6.8L4.8 9.8V8.1H1.5a.7.7 0 0 1-.7-.7V2.2a.7.7 0 0 1 .7-.7Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <line x1="3" y1="4" x2="8" y2="4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <line x1="3" y1="5.8" x2="6.2" y2="5.8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
      <path
        d="M1.5 1.5h6.7L10 3v7a.7.7 0 0 1-.7.7H1.7A.7.7 0 0 1 1 10V2.2a.7.7 0 0 1 .5-.7Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <rect x="3.5" y="1.5" width="4" height="2.5" rx=".3" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="m2 6.2 2.4 2.3L10 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <polygon points="5.5,3 14.5,9 5.5,15" fill="var(--nike-canvas)" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="4" y="3" width="3" height="12" rx="1.5" fill="var(--nike-canvas)" />
      <rect x="11" y="3" width="3" height="12" rx="1.5" fill="var(--nike-canvas)" />
    </svg>
  );
}
