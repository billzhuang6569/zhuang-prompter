"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { MDXEditorMethods } from "@mdxeditor/editor";
import type { RoomJoinResult } from "@/domain/room/types";
import type { RenderBundle } from "@/modules/script-engine/types";
import { RichMarkdownEditor } from "./rich-markdown-editor";

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
  kind: "marker" | "notes";
  pendingId?: string;
  value: string;
};

type EditorInsertionTarget = {
  start: number;
  end: number;
};

type FloatingEditorPosition = {
  left: number;
  top: number;
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
  setMarkdown: Dispatch<SetStateAction<string>>;
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
  onBeginMarkerEdit: (target?: EditorInsertionTarget) => void;
  onBeginCommentEdit: (target?: EditorInsertionTarget) => void;
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
  const richEditorRef = useRef<MDXEditorMethods | null>(null);
  const scriptSurfaceRef = useRef<HTMLDivElement | null>(null);
  const previousMarkdownRef = useRef(markdown);
  const undoStackRef = useRef<string[]>([]);
  const restoringRef = useRef(false);
  const [floatingEditorPosition, setFloatingEditorPosition] = useState<FloatingEditorPosition | null>(null);
  const [richPendingEditorAction, setRichPendingEditorAction] = useState<PendingEditorAction | null>(null);
  const [canUndo, setCanUndo] = useState(false);

  const markers = bundle?.markerIndex ?? [];
  const safePlayerLink = playerEntryLink ?? roomLinks[0];
  const activePendingEditorAction = richPendingEditorAction ?? pendingEditorAction;

  useEffect(() => {
    if (activePendingEditorAction) {
      window.requestAnimationFrame(() => {
        quickInputRef.current?.focus();
        quickInputRef.current?.select();
      });
    }
  }, [activePendingEditorAction]);

  useEffect(() => {
    if (view === "raw") {
      window.requestAnimationFrame(() => markdownEditorRef.current?.focus());
    }
  }, [markdownEditorRef, view]);

  useEffect(() => {
    if (previousMarkdownRef.current === markdown) {
      return;
    }
    if (restoringRef.current) {
      previousMarkdownRef.current = markdown;
      restoringRef.current = false;
      return;
    }
    if (hasPendingDirective(previousMarkdownRef.current)) {
      previousMarkdownRef.current = markdown;
      return;
    }
    undoStackRef.current = [...undoStackRef.current.slice(-79), previousMarkdownRef.current];
    previousMarkdownRef.current = markdown;
    setCanUndo(true);
  }, [markdown]);

  const undoMarkdown = useCallback(() => {
    const previous = undoStackRef.current.pop();
    if (!previous) {
      setCanUndo(false);
      return;
    }
    restoringRef.current = true;
    setFloatingEditorPosition(null);
    setRichPendingEditorAction(null);
    setCanUndo(undoStackRef.current.length > 0);
    setMarkdown(previous);
  }, [setMarkdown]);

  useEffect(() => {
    function handleKeyboardUndo(event: KeyboardEvent) {
      const isUndoKey = event.key.toLowerCase() === "z" && (event.metaKey || event.ctrlKey);
      if (!isUndoKey || event.shiftKey || event.altKey || event.isComposing || !canUndo) {
        return;
      }
      event.preventDefault();
      undoMarkdown();
    }

    window.addEventListener("keydown", handleKeyboardUndo, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyboardUndo, { capture: true });
  }, [canUndo, undoMarkdown]);

  function runInRawEditor(action: () => void) {
    if (view !== "raw") {
      setView("raw");
      window.requestAnimationFrame(action);
      return;
    }
    action();
  }

  function beginInlineMarkerEdit() {
    if (view === "render") {
      if (!richEditorRef.current) {
        return;
      }
      const pendingId = `pending_${crypto.randomUUID()}`;
      const label = "标记点";
      const marker = `\n\n::marker[${nextMarkerId(markers)}]{text="${label}" pending="${pendingId}"}\n\n`;
      const insertionIndex = markdownInsertionIndexFromSelection(markdown);
      setFloatingEditorPosition(floatingPositionForCurrentSelection());
      setRichPendingEditorAction({ kind: "marker", pendingId, value: label });
      setMarkdown((source) =>
        renumberMarkerDirectives(
          sourceWithBlockInsertion(source, insertionIndex ?? source.length, insertionIndex ?? source.length, marker.trim()),
        ),
      );
      return;
    }

    setFloatingEditorPosition(fallbackFloatingEditorPosition());
    runInRawEditor(() => onBeginMarkerEdit());
  }

  function beginInlineCommentEdit() {
    if (view === "render") {
      if (!richEditorRef.current) {
        return;
      }
      const pendingId = `pending_${crypto.randomUUID()}`;
      const note = "提示内容";
      const stage = `\n\n::notes{text="${note}" pending="${pendingId}"}\n\n`;
      const insertionIndex = markdownInsertionIndexFromSelection(markdown);
      setFloatingEditorPosition(floatingPositionForCurrentSelection());
      setRichPendingEditorAction({ kind: "notes", pendingId, value: note });
      setMarkdown((source) =>
        sourceWithBlockInsertion(source, insertionIndex ?? source.length, insertionIndex ?? source.length, stage.trim()),
      );
      return;
    }

    setFloatingEditorPosition(fallbackFloatingEditorPosition());
    runInRawEditor(() => onBeginCommentEdit());
  }

  function insertHeading() {
    if (view === "render") {
      const editor = richEditorRef.current;
      if (!editor) {
        return;
      }
      editor.focus(() => editor.insertMarkdown("\n\n# 标题\n\n"), { defaultSelection: "rootEnd" });
      return;
    }
    runInRawEditor(() => onMarkdownCommand("heading"));
  }

  function confirmFloatingEditorAction() {
    if (richPendingEditorAction) {
      const fallback = richPendingEditorAction.kind === "marker" ? "标记点" : "提示内容";
      const cleanValue = escapeDirectiveAttr(richPendingEditorAction.value || fallback);
      setMarkdown((source) => updatePendingDirective(source, richPendingEditorAction, cleanValue, true));
      setRichPendingEditorAction(null);
    } else {
      onConfirmPendingEditorAction();
    }
    setFloatingEditorPosition(null);
  }

  function updateFloatingEditorValue(value: string) {
    if (richPendingEditorAction) {
      const fallback = richPendingEditorAction.kind === "marker" ? "标记点" : "提示内容";
      const cleanValue = escapeDirectiveAttr(value || fallback);
      const nextAction = { ...richPendingEditorAction, value };
      setRichPendingEditorAction(nextAction);
      setMarkdown((source) => updatePendingDirective(source, richPendingEditorAction, cleanValue, false));
      return;
    }
    onPendingEditorValueChange(value);
  }

  function fallbackFloatingEditorPosition() {
    const surface = scriptSurfaceRef.current;
    if (!surface) {
      return { left: 24, top: 24 };
    }
    const rect = surface.getBoundingClientRect();
    return { left: Math.min(320, Math.max(24, rect.width * 0.28)), top: 72 };
  }

  function floatingPositionForCurrentSelection() {
    const selection = window.getSelection();
    const surface = scriptSurfaceRef.current;
    const surfaceRect = surface?.getBoundingClientRect();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const rangeRect = range?.getBoundingClientRect();
    if (!surfaceRect || !rangeRect || (rangeRect.width === 0 && rangeRect.height === 0)) {
      return fallbackFloatingEditorPosition();
    }
    return {
      left: clamp(rangeRect.left - surfaceRect.left, 20, Math.max(20, surfaceRect.width - 390)),
      top: clamp(rangeRect.bottom - surfaceRect.top + 10, 18, Math.max(18, surfaceRect.height - 72)),
    };
  }

  function markdownInsertionIndexFromSelection(source: string) {
    const selection = window.getSelection();
    const surface = scriptSurfaceRef.current;
    const anchorNode = selection?.anchorNode;
    if (!surface || !selection || !anchorNode || !surface.contains(anchorNode)) {
      return null;
    }

    const anchorText = anchorNode.textContent ?? "";
    if (!anchorText.trim()) {
      return null;
    }

    const sourceIndex = source.indexOf(anchorText);
    if (sourceIndex < 0) {
      return null;
    }

    return sourceIndex + clamp(selection.anchorOffset, 0, anchorText.length);
  }

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

          <div className="nike-editor-toolbar-shell">
            <div className="nike-editor-toolbar-inner">
              <div className="nike-editor-tools" data-od-id="toolbar">
                <button
                  className="nike-tlb"
                  type="button"
                  disabled={!canUndo}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={undoMarkdown}
                >
                  <UndoIcon />
                  撤销
                </button>
                <button
                  className="nike-tlb"
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={beginInlineMarkerEdit}
                >
                  <StarIcon />
                  增加标记
                </button>
                <button
                  className="nike-tlb"
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={beginInlineCommentEdit}
                >
                  <CommentIcon />
                  增加注释
                </button>
                <div className="nike-t-sep" />
                <button
                  className="nike-tlb"
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={insertHeading}
                >
                  标题
                </button>
                <button className="nike-t-save" type="button" onClick={onSaveVersion}>
                  <SaveIcon />
                  保存
                </button>
              </div>
            </div>
          </div>

          <div className={`nike-srw ${isPlaying ? "playing" : ""}`} data-od-id="script-render-wrapper" ref={scriptSurfaceRef}>
            <div className="nike-iline" />
            {activePendingEditorAction && floatingEditorPosition && (
              <div className="nike-floating-editor" style={{ left: floatingEditorPosition.left, top: floatingEditorPosition.top }}>
                <span>{activePendingEditorAction.kind === "marker" ? "标记" : "注释"}</span>
                <input
                  ref={quickInputRef}
                  value={activePendingEditorAction.value}
                  onChange={(event) => updateFloatingEditorValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      confirmFloatingEditorAction();
                    }
                  }}
                  placeholder={activePendingEditorAction.kind === "marker" ? "输入标记文本" : "输入注释文本"}
                />
                <button type="button" title="完成" onClick={confirmFloatingEditorAction}>
                  <CheckIcon />
                </button>
              </div>
            )}

            {view === "render" ? (
              <div
                className="nike-sr"
                ref={previewScrollRef}
                data-od-id="script-render"
                onScroll={(event) => onPreviewScroll(event.currentTarget.scrollTop)}
              >
                <div className="nike-sc nike-rich-editor-wrap">
                  <RichMarkdownEditor
                    ref={richEditorRef}
                    className="nike-rich-editor"
                    contentEditableClassName="nike-rich-editor-content"
                    markdown={markdown}
                    onChange={setMarkdown}
                    spellCheck={false}
                  />
                  <div className="nike-bottom-space" />
                </div>
              </div>
            ) : (
              <div className="nike-sr" data-od-id="script-raw">
                <textarea
                  ref={markdownEditorRef}
                  className="nike-raw-editor"
                  aria-label="Markdown 原文编辑"
                  spellCheck={false}
                  value={markdown}
                  onChange={(event) => setMarkdown(event.target.value)}
                  placeholder="在这里直接编辑 Markdown 原文..."
                />
              </div>
            )}
          </div>

          <div className="nike-mde-w" data-od-id="md-editor">
            <div className="nike-mde-b open">
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function sourceWithBlockInsertion(source: string, start: number, end: number, replacement: string) {
  const prefix = start > 0 && !source.slice(0, start).endsWith("\n\n") ? "\n\n" : "";
  const suffix = end < source.length && !source.slice(end).startsWith("\n\n") ? "\n\n" : "";
  return `${source.slice(0, start)}${prefix}${replacement}${suffix}${source.slice(end)}`;
}

function nextMarkerId(markers: Array<{ markerId: string }>) {
  const usedIds = new Set(markers.map((marker) => normalizeMarkerId(marker.markerId)));
  let nextIndex = Math.max(0, ...Array.from(usedIds).map((id) => Number(id) || 0)) + 1;
  let markerId = nextIndex.toString().padStart(2, "0");
  while (usedIds.has(markerId)) {
    nextIndex += 1;
    markerId = nextIndex.toString().padStart(2, "0");
  }
  return markerId;
}

function renumberMarkerDirectives(source: string) {
  let markerIndex = 0;
  return source.replace(/((?::|::)marker\[)(?:M)?\d{2,3}(\]\{)/g, (_match, before: string, after: string) => {
    markerIndex += 1;
    return `${before}${markerIndex.toString().padStart(2, "0")}${after}`;
  });
}

function normalizeMarkerId(markerId: string) {
  const numeric = markerId.match(/\d+/)?.[0];
  return numeric ? Number(numeric).toString().padStart(2, "0") : markerId;
}

function escapeDirectiveAttr(value: string) {
  return value.replace(/["\\\n\r]/g, " ").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasPendingDirective(source: string) {
  return /\spending="[^"]*"/.test(source);
}

function replaceDirectiveAttribute(directive: string, attr: "label" | "cue" | "text", value: string) {
  const attrPattern = new RegExp(`${attr}="[^"]*"`);
  if (attrPattern.test(directive)) {
    return directive.replace(attrPattern, `${attr}="${value}"`);
  }
  return directive.replace(/\}$/, ` ${attr}="${value}"}`);
}

function updatePendingDirective(source: string, action: PendingEditorAction, value: string, finalize: boolean) {
  if (!action.pendingId) {
    return source;
  }

  const pendingPattern = escapeRegExp(action.pendingId);
  const directivePattern =
    action.kind === "marker"
      ? new RegExp(`::marker\\[(?:M)?\\d{2,3}\\]\\{[^}]*pending="${pendingPattern}"[^}]*\\}`)
      : new RegExp(`::notes\\{[^}]*pending="${pendingPattern}"[^}]*\\}`);

  return source.replace(directivePattern, (directive) => {
    const nextDirective = replaceDirectiveAttribute(directive, "text", value);
    return finalize ? nextDirective.replace(/\s+pending="[^"]*"/, "") : nextDirective;
  });
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

function UndoIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M5 3H2v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.4 5.7A4.2 4.2 0 1 0 4 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
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
