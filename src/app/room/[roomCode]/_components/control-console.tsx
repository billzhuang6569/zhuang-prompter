"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import type { MDXEditorMethods } from "@mdxeditor/editor";
import type { Anchor, RoomJoinResult } from "@/domain/room/types";
import { stripScriptDirectives } from "@/modules/script-engine";
import {
  buildConvertedDirective,
  convertDirectiveToBody,
  escapeDirectiveAttr,
  pendingEditorActionKey,
  renumberMarkerDirectives,
} from "@/modules/script-engine/editing";
import type { RenderBundle } from "@/modules/script-engine/types";
import { makeRandomId } from "@/shared/id";
import { readingAtY, readingY } from "@/modules/playback-engine/reading-position";
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
  kind: "local" | "lan" | "mdns";
  controlUrl: string;
  playerUrl: string;
  shortPlayerUrl: string;
};

type PendingEditorAction = {
  kind: "marker" | "notes";
  pendingId?: string;
  value: string;
  editTarget?: {
    markerId?: string;
    occurrence: number;
  };
};

type EditorInsertionTarget = {
  start: number;
  end: number;
};

type FloatingEditorPosition = {
  left: number;
  top: number;
};

type DesktopClipboardBridge = Window & {
  zhuangPrompter?: {
    openVoiceBrowser?: () => Promise<boolean>;
    writeClipboardText?: (value: string) => boolean | void | Promise<boolean | void>;
  };
};

type ControlConsoleProps = {
  roomCode: string;
  connectionLabel: string;
  isConnected: boolean;
  deviceCount: number;
  joinResult: RoomJoinResult | null;
  projectName: string;
  setProjectName: (value: string) => void;
  parseStatus?: string;
  hasSavedVersion: boolean;
  saveStatus: string;
  markdown: string;
  setMarkdown: Dispatch<SetStateAction<string>>;
  versionMessage: string;
  setVersionMessage: (value: string) => void;
  bundle?: RenderBundle;
  versions: VersionSummary[];
  playbackCenterRatio?: number;
  readingAnchor?: Anchor;
  speed: number;
  isPlaying: boolean;
  playerFontScale: number;
  playerMirrorX: boolean;
  playerMirrorY: boolean;
  voiceAssistWanted: boolean;
  voiceAssistStatus: string;
  playerEntryLink?: PlayerLink;
  memorablePlayerLink?: PlayerLink;
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
  onJumpToStart: () => void;
  onJumpToEnd: () => void;
  onNudge: (deltaPx: number) => void;
  onJumpToMarker: (markerId: string) => void;
  onSpeedChange: (speed: number) => void;
  onPlayerFontScaleChange: (scale: number) => void;
  onPlayerMirrorXChange: (enabled: boolean) => void;
  onPlayerMirrorYChange: (enabled: boolean) => void;
  onToggleVoiceAssist: () => void;
  onGuideSeekRatio: (ratio: number, anchor?: Anchor) => void;
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
  parseStatus,
  hasSavedVersion,
  saveStatus,
  markdown,
  setMarkdown,
  versionMessage,
  setVersionMessage,
  bundle,
  versions,
  playbackCenterRatio,
  readingAnchor,
  speed,
  isPlaying,
  playerFontScale,
  playerMirrorX,
  playerMirrorY,
  voiceAssistWanted,
  voiceAssistStatus,
  playerEntryLink,
  memorablePlayerLink,
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
  onJumpToStart,
  onJumpToEnd,
  onNudge,
  onJumpToMarker,
  onSpeedChange,
  onPlayerFontScaleChange,
  onPlayerMirrorXChange,
  onPlayerMirrorYChange,
  onToggleVoiceAssist,
  onGuideSeekRatio,
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
  const richContentWrapRef = useRef<HTMLDivElement | null>(null);
  const pendingReadingAnchorRef = useRef<Anchor | undefined>(undefined);
  const guideLineRef = useRef<HTMLDivElement | null>(null);
  const guideHoverTimerRef = useRef<number | undefined>(undefined);
  const copyStatusTimerRef = useRef<number | undefined>(undefined);
  const guideDraggingRef = useRef(false);
  const pendingGuideRatioRef = useRef<number | null>(null);
  const lastGuideSeekAtRef = useRef(0);
  const previousMarkdownRef = useRef(markdown);
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const restoringRef = useRef(false);
  const [floatingEditorPosition, setFloatingEditorPosition] = useState<FloatingEditorPosition | null>(null);
  const [richPendingEditorAction, setRichPendingEditorAction] = useState<PendingEditorAction | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [guideMetrics, setGuideMetrics] = useState({ height: 0, offsetTop: 0 });
  const [guideDragReady, setGuideDragReady] = useState(false);
  const [guideDragging, setGuideDragging] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  // §3.3：原文视图存在非空选区时，"增加"改为"改为"，反映即将发生的真正转换。
  const [rawSelectionActive, setRawSelectionActive] = useState(false);
  // §item6：预览（render）视图内富文本存在非空选区时，同样把"增加"切换为"改为"。
  const [renderSelectionActive, setRenderSelectionActive] = useState(false);
  const canConvertSelection =
    (view === "raw" && rawSelectionActive) || (view === "render" && renderSelectionActive);

  function syncRawSelection() {
    const editor = markdownEditorRef.current;
    if (!editor) {
      setRawSelectionActive(false);
      return;
    }
    setRawSelectionActive(editor.selectionStart !== editor.selectionEnd);
  }

  // §item9：状态徽标（草稿/已保存版本/保存状态）已从 UI 移除，但这些 props 仍是对外契约的一部分，
  // 由上层传入。此处显式引用以保留 props 而不触发未使用告警。
  void parseStatus;
  void hasSavedVersion;
  void saveStatus;

  const markers = bundle?.markerIndex ?? [];
  const safePlayerLink = playerEntryLink ?? roomLinks[0];
  const activePendingEditorAction = richPendingEditorAction ?? pendingEditorAction;
  const activePendingEditorKey = pendingEditorActionKey(activePendingEditorAction);

  useLayoutEffect(() => {
    if (activePendingEditorKey) {
      quickInputRef.current?.focus();
      quickInputRef.current?.select();
    }
  }, [activePendingEditorKey]);

  useEffect(() => {
    return () => {
      if (copyStatusTimerRef.current) {
        window.clearTimeout(copyStatusTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (view !== "raw" || activePendingEditorKey) {
      return;
    }
    const animationFrame = window.requestAnimationFrame(() => markdownEditorRef.current?.focus());
    return () => window.cancelAnimationFrame(animationFrame);
  }, [activePendingEditorKey, markdownEditorRef, view]);

  // §item6：仅在预览视图监听 selectionchange，判断富文本内容区内是否存在非空选区，
  // 以驱动 renderSelectionActive（进而把动作按钮从"增加"切换为"改为"）。
  useEffect(() => {
    if (view !== "render") {
      return;
    }
    function handleSelectionChange() {
      const wrap = richContentWrapRef.current;
      const selection = window.getSelection();
      if (!wrap || !selection || selection.isCollapsed || selection.rangeCount === 0) {
        setRenderSelectionActive(false);
        return;
      }
      const { anchorNode, focusNode } = selection;
      const inside = !!anchorNode && !!focusNode && wrap.contains(anchorNode) && wrap.contains(focusNode);
      setRenderSelectionActive(inside && selection.toString().trim().length > 0);
    }
    document.addEventListener("selectionchange", handleSelectionChange);
    // 离开预览视图（或卸载）时在清理阶段复位选区标志——避免在 effect 主体中同步 setState。
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      setRenderSelectionActive(false);
    };
  }, [view]);

  useEffect(() => {
    if (view !== "render") {
      return;
    }

    const updateGuideMetrics = () => {
      const scrollElement = previewScrollRef.current;
      const contentElement =
        richContentWrapRef.current?.querySelector<HTMLElement>(".nike-rich-editor-content") ?? richContentWrapRef.current;
      if (!scrollElement || !contentElement) {
        return;
      }
      const scrollRect = scrollElement.getBoundingClientRect();
      const contentRect = contentElement.getBoundingClientRect();
      setGuideMetrics({
        height: Math.max(1, contentElement.scrollHeight),
        offsetTop: scrollElement.scrollTop + contentRect.top - scrollRect.top,
      });
    };

    updateGuideMetrics();
    const observer = new ResizeObserver(updateGuideMetrics);
    if (richContentWrapRef.current) {
      observer.observe(richContentWrapRef.current);
    }
    window.addEventListener("resize", updateGuideMetrics);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateGuideMetrics);
    };
  }, [markdown, previewScrollRef, view]);

  useLayoutEffect(() => {
    const guideLine = guideLineRef.current;
    const scrollElement = previewScrollRef.current;
    if (!guideLine || !scrollElement || view !== "render" || guideDraggingRef.current) {
      return;
    }
    const ratio = Math.max(0, Math.min(1, playbackCenterRatio ?? 0));
    const content = richContentWrapRef.current?.querySelector<HTMLElement>(".nike-rich-editor-content");
    const y = content && bundle && typeof readingAnchor?.textOffset === "number"
      ? readingY(content, bundle, { textOffset: readingAnchor.textOffset, lineFraction: readingAnchor.lineFraction }) : undefined;
    const top = y === undefined ? guideMetrics.offsetTop + ratio * guideMetrics.height
      : scrollElement.scrollTop + y - scrollElement.getBoundingClientRect().top;
    guideLine.style.top = `${top}px`;
    const diff = scrollElement.scrollTop + scrollElement.clientHeight / 2 - top;
    if (Math.abs(diff) > 72) {
      scrollElement.scrollTop = Math.max(0, top - scrollElement.clientHeight / 2);
    }
  }, [bundle, readingAnchor, guideDragging, guideMetrics, playbackCenterRatio, previewScrollRef, view]);

  useEffect(() => {
    const releaseGuideDrag = () => {
      if (!guideDraggingRef.current) {
        return;
      }
      const pendingRatio = pendingGuideRatioRef.current;
      guideDraggingRef.current = false;
      pendingGuideRatioRef.current = null;
      setGuideDragging(false);
      setGuideDragReady(false);
      if (typeof pendingRatio === "number") {
        onGuideSeekRatio(pendingRatio, pendingReadingAnchorRef.current);
      }
    };
    window.addEventListener("pointerup", releaseGuideDrag);
    window.addEventListener("pointercancel", releaseGuideDrag);
    window.addEventListener("blur", releaseGuideDrag);
    return () => {
      window.removeEventListener("pointerup", releaseGuideDrag);
      window.removeEventListener("pointercancel", releaseGuideDrag);
      window.removeEventListener("blur", releaseGuideDrag);
    };
  }, [onGuideSeekRatio]);

  useEffect(() => {
    return () => {
      if (guideHoverTimerRef.current) {
        window.clearTimeout(guideHoverTimerRef.current);
      }
    };
  }, []);

  const seekFromGuidePointer = useCallback(
    (clientY: number) => {
      const scrollElement = previewScrollRef.current;
      if (!scrollElement || guideMetrics.height <= 0) {
        return null;
      }
      const scrollRect = scrollElement.getBoundingClientRect();
      if (clientY > scrollRect.bottom - 48) {
        scrollElement.scrollTop += 18;
      } else if (clientY < scrollRect.top + 48) {
        scrollElement.scrollTop = Math.max(0, scrollElement.scrollTop - 18);
      }
      const contentY = scrollElement.scrollTop + clientY - scrollRect.top;
      const ratio = Math.max(0, Math.min(1, (contentY - guideMetrics.offsetTop) / guideMetrics.height));
      const top = guideMetrics.offsetTop + ratio * guideMetrics.height;
      if (guideLineRef.current) {
        guideLineRef.current.style.top = `${top}px`;
      }
      const content = richContentWrapRef.current?.querySelector<HTMLElement>(".nike-rich-editor-content");
      const position = content && bundle ? readingAtY(content, bundle, clientY) : undefined;
      pendingReadingAnchorRef.current = position ? { type: "renderLine", ...position } : undefined;
      pendingGuideRatioRef.current = ratio;
      return ratio;
    },
    [bundle, guideMetrics, previewScrollRef],
  );

  function beginGuideHover() {
    if (guideHoverTimerRef.current) {
      window.clearTimeout(guideHoverTimerRef.current);
    }
    guideHoverTimerRef.current = window.setTimeout(() => setGuideDragReady(true), 500);
  }

  function endGuideHover() {
    if (guideHoverTimerRef.current) {
      window.clearTimeout(guideHoverTimerRef.current);
      guideHoverTimerRef.current = undefined;
    }
    if (!guideDraggingRef.current) {
      setGuideDragReady(false);
    }
  }

  function beginGuideDrag(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    guideDraggingRef.current = true;
    pendingGuideRatioRef.current = null;
    lastGuideSeekAtRef.current = performance.now();
    setGuideDragReady(true);
    setGuideDragging(true);
    const ratio = seekFromGuidePointer(event.clientY);
    if (typeof ratio === "number") {
      onGuideSeekRatio(ratio, pendingReadingAnchorRef.current);
    }
  }

  function beginGuideRailDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const guideLine = guideLineRef.current;
    if (!guideLine || guideDraggingRef.current) {
      return;
    }
    const guideRect = guideLine.getBoundingClientRect();
    const guideCenterY = guideRect.top + guideRect.height / 2;
    if (Math.abs(event.clientY - guideCenterY) > 16) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    guideDraggingRef.current = true;
    pendingGuideRatioRef.current = null;
    lastGuideSeekAtRef.current = performance.now();
    setGuideDragReady(true);
    setGuideDragging(true);
    const ratio = seekFromGuidePointer(event.clientY);
    if (typeof ratio === "number") {
      onGuideSeekRatio(ratio, pendingReadingAnchorRef.current);
    }
  }

  function moveGuideDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!guideDraggingRef.current) {
      return;
    }
    event.preventDefault();
    const ratio = seekFromGuidePointer(event.clientY);
    const now = performance.now();
    if (typeof ratio === "number" && now - lastGuideSeekAtRef.current > 80) {
      lastGuideSeekAtRef.current = now;
      onGuideSeekRatio(ratio, pendingReadingAnchorRef.current);
    }
  }

  function endGuideDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!guideDraggingRef.current) {
      return;
    }
    event.preventDefault();
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }
    const pendingRatio = pendingGuideRatioRef.current;
    guideDraggingRef.current = false;
    pendingGuideRatioRef.current = null;
    setGuideDragging(false);
    setGuideDragReady(false);
    if (typeof pendingRatio === "number") {
      onGuideSeekRatio(pendingRatio, pendingReadingAnchorRef.current);
    }
  }

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
    // 任何新的编辑都会作废重做栈（标准 undo/redo 语义）。
    if (redoStackRef.current.length > 0) {
      redoStackRef.current = [];
      setCanRedo(false);
    }
  }, [markdown]);

  const undoMarkdown = useCallback(() => {
    const previous = undoStackRef.current.pop();
    if (!previous) {
      setCanUndo(false);
      return;
    }
    restoringRef.current = true;
    // 把撤销前的内容压入重做栈，供 Shift+Cmd/Ctrl+Z 恢复。
    redoStackRef.current = [...redoStackRef.current.slice(-79), previousMarkdownRef.current];
    setCanRedo(true);
    setFloatingEditorPosition(null);
    setRichPendingEditorAction(null);
    setCanUndo(undoStackRef.current.length > 0);
    setMarkdown(previous);
  }, [setMarkdown]);

  const redoMarkdown = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) {
      setCanRedo(false);
      return;
    }
    restoringRef.current = true;
    undoStackRef.current = [...undoStackRef.current.slice(-79), previousMarkdownRef.current];
    setCanUndo(true);
    setCanRedo(redoStackRef.current.length > 0);
    setFloatingEditorPosition(null);
    setRichPendingEditorAction(null);
    setMarkdown(next);
  }, [setMarkdown]);

  useEffect(() => {
    function handleKeyboardHistory(event: KeyboardEvent) {
      const isHistoryKey = event.key.toLowerCase() === "z" && (event.metaKey || event.ctrlKey);
      if (!isHistoryKey || event.altKey || event.isComposing) {
        return;
      }
      // 富文本（MDXEditor / Lexical）contentEditable 内的 Cmd/Ctrl+Z 交由其原生撤销栈处理，
      // 避免与应用级 markdown 撤销栈冲突。原文视图（textarea）与其它焦点仍走应用级撤销/重做。
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".nike-rich-editor-content")) {
        return;
      }
      if (event.shiftKey) {
        if (!canRedo) {
          return;
        }
        event.preventDefault();
        redoMarkdown();
      } else {
        if (!canUndo) {
          return;
        }
        event.preventDefault();
        undoMarkdown();
      }
    }

    window.addEventListener("keydown", handleKeyboardHistory, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyboardHistory, { capture: true });
  }, [canRedo, canUndo, redoMarkdown, undoMarkdown]);

  function runInRawEditor(action: () => void) {
    if (view !== "raw") {
      setView("raw");
      window.requestAnimationFrame(action);
      return;
    }
    action();
  }

  // §item6：预览视图下把当前非空选区"真正转换"为注释/标记指令（策略 b）。
  // 与原文视图 room-client.beginMarkerEdit/beginCommentEdit 语义一致：选区文本经
  // buildConvertedDirective 转义后成为指令 text=，随 sourceWithBlockInsertion 替换选区，
  // 因此原文本移出朗读/语音索引（注释）或仅保留跳转锚点（标记）。
  // 局限：按"首个正文出现位置"匹配选区纯文本，若选区跨越行内格式/多段落导致
  // toString 与源文不完全一致而匹配失败，则返回 false，调用方退回占位插入。
  function convertRenderSelectionToDirective(kind: "marker" | "notes") {
    const selected = (window.getSelection()?.toString() ?? "").trim();
    if (!selected || firstBodyOccurrence(markdown, selected) < 0) {
      return false;
    }
    const pendingId = makeRandomId("pending");
    const { directive, label } = buildConvertedDirective({
      kind,
      selectedText: selected,
      markerId: kind === "marker" ? nextMarkerId(markers) : undefined,
      pendingId,
    });
    setFloatingEditorPosition(floatingPositionForCurrentSelection());
    setRichPendingEditorAction({ kind, pendingId, value: label });
    setMarkdown((source) => {
      const at = firstBodyOccurrence(source, selected);
      if (at < 0) {
        return source;
      }
      const next = sourceWithBlockInsertion(source, at, at + selected.length, directive);
      return kind === "marker" ? renumberMarkerDirectives(next) : next;
    });
    return true;
  }

  function beginInlineMarkerEdit() {
    if (view === "render") {
      if (!richEditorRef.current) {
        return;
      }
      if (renderSelectionActive && convertRenderSelectionToDirective("marker")) {
        return;
      }
      const pendingId = makeRandomId("pending");
      const label = "标记点";
      const marker = `\n\n:marker[${nextMarkerId(markers)}]{text="${label}" pending="${pendingId}"}\u00A0\n\n`;
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
    runInRawEditor(() => {
      const editor = markdownEditorRef.current;
      const target = {
        start: editor?.selectionStart ?? markdown.length,
        end: editor?.selectionEnd ?? markdown.length,
      };
      onBeginMarkerEdit(target);
    });
  }

  function beginInlineCommentEdit() {
    if (view === "render") {
      if (!richEditorRef.current) {
        return;
      }
      if (renderSelectionActive && convertRenderSelectionToDirective("notes")) {
        return;
      }
      const pendingId = makeRandomId("pending");
      const note = "提示内容";
      const stage = `\n\n:notes{text="${note}" pending="${pendingId}"}\u00A0\n\n`;
      const insertionIndex = markdownInsertionIndexFromSelection(markdown);
      setFloatingEditorPosition(floatingPositionForCurrentSelection());
      setRichPendingEditorAction({ kind: "notes", pendingId, value: note });
      setMarkdown((source) =>
        sourceWithBlockInsertion(source, insertionIndex ?? source.length, insertionIndex ?? source.length, stage.trim()),
      );
      return;
    }

    setFloatingEditorPosition(fallbackFloatingEditorPosition());
    runInRawEditor(() => {
      const editor = markdownEditorRef.current;
      const target = {
        start: editor?.selectionStart ?? markdown.length,
        end: editor?.selectionEnd ?? markdown.length,
      };
      onBeginCommentEdit(target);
    });
  }

  function exportMarkdown(includeDirectives: boolean) {
    const exportedMarkdown = includeDirectives ? markdown.trimEnd() : stripScriptDirectives(markdown);
    const suffix = includeDirectives ? "with-notes-markers" : "plain";
    const fileName = `${safeFileName(projectName || `room-${roomCode}`)}-${suffix}.md`;
    downloadMarkdownFile(fileName, `${exportedMarkdown}\n`);
    setExportStatus(includeDirectives ? "已导出 MD" : "已导出纯文本 MD");
    window.setTimeout(() => setExportStatus(""), 1800);
  }

  async function copyPlayerLink(value: string) {
    const copied = await copyToClipboard(value);
    setCopyStatus(copied ? "copied" : "failed");
    if (copyStatusTimerRef.current) {
      window.clearTimeout(copyStatusTimerRef.current);
    }
    copyStatusTimerRef.current = window.setTimeout(() => setCopyStatus("idle"), copied ? 1800 : 2400);
  }

  // 播放端短链：一次点击同时（a）复制到剪贴板，（b）在系统外部浏览器打开。
  // 桌面端未暴露通用 openExternal 桥接方法，故使用 window.open —— 在 Electron 中，
  // 非本机 IP/origin 的地址（如 .local 记忆域名）会被 setWindowOpenHandler 交给
  // shell.openExternal，从而在外部浏览器而非新的 App 窗口打开。
  async function openPlayerLink(value: string) {
    await copyPlayerLink(value);
    window.open(value, "_blank", "noopener,noreferrer");
  }

  function confirmFloatingEditorAction() {
    if (richPendingEditorAction) {
      const fallback = richPendingEditorAction.kind === "marker" ? "标记点" : "提示内容";
      const cleanValue = escapeDirectiveAttr(richPendingEditorAction.value || fallback);
      setMarkdown((source) =>
        richPendingEditorAction.editTarget
          ? updateExistingDirective(source, richPendingEditorAction, cleanValue)
          : updatePendingDirective(source, richPendingEditorAction, cleanValue, true),
      );
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
      if (richPendingEditorAction.editTarget) {
        return;
      }
      setMarkdown((source) => updatePendingDirective(source, richPendingEditorAction, cleanValue, false));
      return;
    }
    onPendingEditorValueChange(value);
  }

  const cancelFloatingEditorAction = useCallback(() => {
    if (richPendingEditorAction?.pendingId && !richPendingEditorAction.editTarget) {
      setMarkdown((source) => removePendingDirective(source, richPendingEditorAction));
    }
    setRichPendingEditorAction(null);
    setFloatingEditorPosition(null);
  }, [richPendingEditorAction, setMarkdown]);

  // §item7：浮层"×"按钮 = 把该注释/标记"改为正文"（并非仅关闭）。
  // 取出指令 text= 文本原地替换整段指令，使文字重新进入朗读/语音索引；
  // 待定与已存在指令均支持。浮层外点击仍走 cancelFloatingEditorAction（关闭/放弃）。
  const convertFloatingDirectiveToBody = useCallback(() => {
    const action = richPendingEditorAction;
    if (!action) {
      // 原文视图 room-client 拥有的待定动作没有可就地转换的浮层入口，退回关闭。
      cancelFloatingEditorAction();
      return;
    }
    const target = action.pendingId
      ? { kind: action.kind, pendingId: action.pendingId }
      : { kind: action.kind, markerId: action.editTarget?.markerId, occurrence: action.editTarget?.occurrence ?? 0 };
    setMarkdown((source) => convertDirectiveToBody(source, target));
    setRichPendingEditorAction(null);
    setFloatingEditorPosition(null);
  }, [cancelFloatingEditorAction, richPendingEditorAction, setMarkdown]);

  useEffect(() => {
    if (!activePendingEditorAction || !floatingEditorPosition) {
      return;
    }

    function closeFloatingEditorOnOutsidePointerDown(event: PointerEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) {
        return;
      }
      if (target.closest(".nike-floating-editor") || target.closest(".nike-mdx-directive")) {
        return;
      }
      cancelFloatingEditorAction();
    }

    document.addEventListener("pointerdown", closeFloatingEditorOnOutsidePointerDown, { capture: true });
    return () => document.removeEventListener("pointerdown", closeFloatingEditorOnOutsidePointerDown, { capture: true });
  }, [activePendingEditorAction, cancelFloatingEditorAction, floatingEditorPosition]);

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

  function beginExistingDirectiveEdit(event: MouseEvent<HTMLDivElement>) {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>(".nike-mdx-directive") : null;
    if (!target || !scriptSurfaceRef.current?.contains(target)) {
      return;
    }

    const kind = target.dataset.directiveKind === "marker" ? "marker" : target.dataset.directiveKind === "notes" ? "notes" : null;
    if (!kind) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const directiveElements = Array.from(
      scriptSurfaceRef.current.querySelectorAll<HTMLElement>(`.nike-mdx-directive[data-directive-kind="${kind}"]`),
    );
    const occurrence = Math.max(0, directiveElements.indexOf(target));
    const markerId = target.dataset.markerId;
    const value = target.dataset.directiveText || directiveTextFromElement(target, kind);
    const surfaceRect = scriptSurfaceRef.current.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();

    setFloatingEditorPosition({
      left: clamp(targetRect.left - surfaceRect.left, 20, Math.max(20, surfaceRect.width - 390)),
      top: clamp(targetRect.bottom - surfaceRect.top + 10, 18, Math.max(18, surfaceRect.height - 72)),
    });
    setRichPendingEditorAction({
      kind,
      value,
      editTarget: {
        markerId,
        occurrence,
      },
    });
  }

  function placeCaretAfterDirective(event: MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }
    const surface = scriptSurfaceRef.current;
    const target = event.target instanceof Element ? event.target : null;
    if (!surface || !target || target.closest(".nike-mdx-directive")) {
      return;
    }

    const directive = Array.from(surface.querySelectorAll<HTMLElement>(".nike-mdx-directive")).find((element) => {
      const rect = element.getBoundingClientRect();
      return event.clientY >= rect.top && event.clientY <= rect.bottom && event.clientX >= rect.right && event.clientX <= rect.right + 28;
    });
    const decorator = directive?.parentElement;
    const trailingText = decorator?.nextSibling;
    const textNode = trailingText?.firstChild;
    if (!decorator || (textNode && textNode.nodeType !== Node.TEXT_NODE)) {
      return;
    }

    const range = document.createRange();
    if (textNode) {
      range.setStart(textNode, Math.min(1, textNode.textContent?.length ?? 0));
    } else {
      range.setStartAfter(decorator);
    }
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    directive?.closest<HTMLElement>("[contenteditable='true']")?.focus();
  }

  return (
    <main className="nike-control">
      <header className="nike-ubar" data-od-id="status-bar">
        <Link className="nike-back-btn" href="/" aria-label="返回房间入口">
          返回
        </Link>
        <div className="nike-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="app-brand-logo nike-brand-logo" src="/brand/logo.png" alt="" width={28} height={28} />
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
            <div className="nike-editor-tools" data-od-id="toolbar">
              <button
                className="nike-tlb"
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={beginInlineMarkerEdit}
              >
                <StarIcon />
                {canConvertSelection ? "改为标记" : "增加标记"}
              </button>
              <button
                className="nike-tlb"
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={beginInlineCommentEdit}
              >
                <CommentIcon />
                {canConvertSelection ? "改为注释" : "增加注释"}
              </button>
              <button className="nike-tlb" type="button" onClick={() => exportMarkdown(true)}>
                <DownloadIcon />
                导出MD
              </button>
              <button className="nike-tlb" type="button" onClick={() => exportMarkdown(false)}>
                <DownloadIcon />
                导出纯文本MD
              </button>
              <button className="nike-t-save" type="button" onClick={onSaveVersion}>
                <SaveIcon />
                保存
              </button>
              {exportStatus && <span className="nike-export-status">{exportStatus}</span>}
            </div>
            <div className="nike-vswitch" role="tablist" aria-label="脚本视图切换">
              <button
                className={`nike-vswitch-seg ${view === "render" ? "on" : ""}`}
                type="button"
                role="tab"
                aria-selected={view === "render"}
                onClick={() => {
                  setRawSelectionActive(false);
                  setView("render");
                }}
              >
                预览
              </button>
              <button
                className={`nike-vswitch-seg ${view === "raw" ? "on" : ""}`}
                type="button"
                role="tab"
                aria-selected={view === "raw"}
                onClick={() => setView("raw")}
              >
                原文
              </button>
            </div>
          </div>

          <div className={`nike-srw ${isPlaying ? "playing" : ""}`} data-od-id="script-render-wrapper" ref={scriptSurfaceRef}>
            {activePendingEditorAction && floatingEditorPosition && (
              <div className="nike-floating-editor" style={{ left: floatingEditorPosition.left, top: floatingEditorPosition.top }}>
                <span>
                  {activePendingEditorAction.editTarget
                    ? activePendingEditorAction.kind === "marker"
                      ? "编辑标记"
                      : "编辑注释"
                    : activePendingEditorAction.kind === "marker"
                      ? "标记"
                      : "注释"}
                </span>
                <input
                  ref={quickInputRef}
                  value={activePendingEditorAction.value}
                  onChange={(event) => updateFloatingEditorValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      confirmFloatingEditorAction();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      cancelFloatingEditorAction();
                    }
                  }}
                  placeholder={activePendingEditorAction.kind === "marker" ? "输入标记文本" : "输入注释文本"}
                />
                <button className="muted" type="button" title="改为正文" onClick={convertFloatingDirectiveToBody}>
                  <CloseIcon />
                </button>
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
                onMouseDown={placeCaretAfterDirective}
                onClick={beginExistingDirectiveEdit}
                onScroll={(event) => onPreviewScroll(event.currentTarget.scrollTop)}
                onPointerDown={beginGuideRailDrag}
                onPointerMove={moveGuideDrag}
                onPointerUp={endGuideDrag}
                onPointerCancel={endGuideDrag}
              >
                <div
                  className={`nike-iline ${guideDragReady ? "is-guide-ready" : ""} ${guideDragging ? "is-guide-dragging" : ""}`}
                  ref={guideLineRef}
                  role="slider"
                  aria-label="拖拽控制播放端位置"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(Math.max(0, Math.min(1, playbackCenterRatio ?? 0)) * 100)}
                  tabIndex={0}
                  onPointerEnter={beginGuideHover}
                  onPointerLeave={endGuideHover}
                  onPointerDown={beginGuideDrag}
                  onPointerMove={moveGuideDrag}
                  onPointerUp={endGuideDrag}
                  onPointerCancel={endGuideDrag}
                  onMouseDown={(event) => {
                    if (guideDragReady) {
                      event.preventDefault();
                      event.stopPropagation();
                    }
                  }}
                />
                <div className="nike-sc nike-rich-editor-wrap" ref={richContentWrapRef}>
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
                  onChange={(event) => {
                    setMarkdown(event.target.value);
                    syncRawSelection();
                  }}
                  onSelect={syncRawSelection}
                  onKeyUp={syncRawSelection}
                  onMouseUp={syncRawSelection}
                  onBlur={() => setRawSelectionActive(false)}
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
              <button className="nike-stpb" type="button" title="回到开始" onClick={onJumpToStart}>
                |&lt;
              </button>
              <button className="nike-stpb" type="button" title="后退 160px" onClick={() => onNudge(-160)}>
                ‹
              </button>
              <button className="nike-play-btn" type="button" onClick={onTogglePlay}>
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
              </button>
              <button className="nike-stpb" type="button" title="前进 160px" onClick={() => onNudge(160)}>
                ›
              </button>
              <button className="nike-stpb" type="button" title="回到结束" onClick={onJumpToEnd}>
                &gt;|
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
            <div className="nike-control-label">播放端显示</div>
            <div className="nike-spdr">
              <span className="nike-spd-l">字号</span>
              <input
                type="range"
                min="75"
                max="200"
                value={Math.round(playerFontScale * 100)}
                onChange={(event) => onPlayerFontScaleChange(Number(event.target.value) / 100)}
              />
              <span className="nike-spd-v">{Math.round(playerFontScale * 100)}%</span>
            </div>
            <div className="nike-sadj">
              <button className="nike-sadjb" type="button" onClick={() => onPlayerFontScaleChange(playerFontScale - 0.1)}>
                A-
              </button>
              <button className="nike-sadjb" type="button" onClick={() => onPlayerFontScaleChange(playerFontScale + 0.1)}>
                A+
              </button>
            </div>
            <div className="nike-srow">
              <button
                className="nike-srowb"
                type="button"
                aria-pressed={playerMirrorX}
                onClick={() => onPlayerMirrorXChange(!playerMirrorX)}
              >
                水平镜像
              </button>
              <button
                className="nike-srowb"
                type="button"
                aria-pressed={playerMirrorY}
                onClick={() => onPlayerMirrorYChange(!playerMirrorY)}
              >
                垂直镜像
              </button>
            </div>
            <div className="nike-control-label">语音辅助</div>
            <div className="nike-srow">
              <button className="nike-srowb" type="button" aria-pressed={voiceAssistWanted} onClick={onToggleVoiceAssist}>
                {voiceAssistWanted ? "识别中" : "自动识别"}
              </button>
            </div>
            <div className="nike-voice-status" role="status" aria-live="polite">
              {voiceAssistStatus}
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
            {memorablePlayerLink && safePlayerLink ? (
              <>
                <div className="nike-entrance" data-od-id="player-short-link">
                  <div className="nike-entrance-main">
                    <div className="nike-ql-lbl">好记网址（点击复制并在浏览器打开）</div>
                    <button
                      className="nike-short-link-v"
                      type="button"
                      onClick={() => void openPlayerLink(memorablePlayerLink.shortPlayerUrl)}
                      title="点击复制并在浏览器打开"
                    >
                      {stripUrlProtocol(memorablePlayerLink.shortPlayerUrl)}
                    </button>
                  </div>
                  <button className="nike-qrb" type="button" onClick={() => onOpenQr(safePlayerLink)} title="点击放大二维码">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt="播放端二维码" src={`/api/qr?text=${encodeURIComponent(safePlayerLink.playerUrl)}`} />
                  </button>
                </div>
                {copyStatus !== "idle" && (
                  <span className={`nike-copy-status ${copyStatus}`}>
                    {copyStatus === "copied" ? "已复制到剪贴板" : "复制失败，请手动选中网址复制"}
                  </span>
                )}
                <div className="nike-hint">
                  播放电脑打开 {stripUrlProtocol(memorablePlayerLink.origin)}，输入房间号即可进入
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

function stripUrlProtocol(url: string) {
  return url.replace(/^https?:\/\//, "");
}

function sourceWithBlockInsertion(source: string, start: number, end: number, replacement: string) {
  const prefix = start > 0 && !source.slice(0, start).endsWith("\n\n") ? "\n\n" : "";
  const suffix = end < source.length && !source.slice(end).startsWith("\n\n") ? "\n\n" : "";
  return `${source.slice(0, start)}${prefix}${replacement}${suffix}${source.slice(end)}`;
}

// §item6 策略 b：定位源文中所有指令占用的字符区间，供选区文本"避开指令"匹配之用。
function directiveSpans(source: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const patterns = [
    /:{1,2}marker\[[^\]\r\n]*\]\{[^}]*\}/g,
    /:{1,3}(?:notes|stage|stageCue)(?:\[[^\]]*\])?\{[^}]*\}/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source))) {
      spans.push([match.index, match.index + match[0].length]);
    }
  }
  return spans;
}

// 返回选区文本在源文中首个"落在正文（不与任何指令区间重叠）"的位置，找不到返回 -1。
function firstBodyOccurrence(source: string, needle: string): number {
  if (!needle) {
    return -1;
  }
  const spans = directiveSpans(source);
  let from = 0;
  for (;;) {
    const index = source.indexOf(needle, from);
    if (index < 0) {
      return -1;
    }
    const end = index + needle.length;
    const overlaps = spans.some(([spanStart, spanEnd]) => index < spanEnd && end > spanStart);
    if (!overlaps) {
      return index;
    }
    from = index + 1;
  }
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

function normalizeMarkerId(markerId: string) {
  const numeric = markerId.match(/\d+/)?.[0];
  return numeric ? Number(numeric).toString().padStart(2, "0") : markerId;
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
    ? new RegExp(`:{1,2}marker\\[(?:M)?\\d{2,3}\\]\\{[^}]*pending="${pendingPattern}"[^}]*\\}`)
    : new RegExp(`:{1,2}notes\\{[^}]*pending="${pendingPattern}"[^}]*\\}`);

  return source.replace(directivePattern, (directive) => {
    const nextDirective = replaceDirectiveAttribute(directive, "text", value);
    return finalize ? nextDirective.replace(/\s+pending="[^"]*"/, "") : nextDirective;
  });
}

function removePendingDirective(source: string, action: PendingEditorAction) {
  if (!action.pendingId) {
    return source;
  }
  const pendingPattern = escapeRegExp(action.pendingId);
  const directivePattern =
    action.kind === "marker"
    ? new RegExp(`\\n*:{1,2}marker\\[(?:M)?\\d{2,3}\\]\\{[^}]*pending="${pendingPattern}"[^}]*\\}[\\u200B\\u00A0]?\\n*`)
    : new RegExp(`\\n*:{1,2}notes\\{[^}]*pending="${pendingPattern}"[^}]*\\}[\\u200B\\u00A0]?\\n*`);

  return source.replace(directivePattern, "\n\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

function updateExistingDirective(source: string, action: PendingEditorAction, value: string) {
  const target = action.editTarget;
  if (!target) {
    return source;
  }

  if (action.kind === "marker") {
    return updateMarkerDirective(source, target.markerId, target.occurrence, value);
  }

  return updateNthDirectiveText(source, /:{1,3}(?:notes|stage|stageCue)(?:\[[^\]]*\])?\{[^}]*\}/g, target.occurrence, value);
}

function updateMarkerDirective(source: string, markerId: string | undefined, occurrence: number, value: string) {
  const markerPattern = /:{1,2}marker\[([^\]]+)\]\{[^}]*\}/g;
  let markerOccurrence = -1;
  return source.replace(markerPattern, (directive, currentMarkerId: string) => {
    markerOccurrence += 1;
    const isTarget = markerId
      ? currentMarkerId === markerId || normalizeMarkerId(currentMarkerId) === normalizeMarkerId(markerId)
      : markerOccurrence === occurrence;
    return isTarget ? replaceDirectiveAttribute(directive, "text", value) : directive;
  });
}

function updateNthDirectiveText(source: string, pattern: RegExp, occurrence: number, value: string) {
  let currentOccurrence = -1;
  return source.replace(pattern, (directive) => {
    currentOccurrence += 1;
    return currentOccurrence === occurrence ? replaceDirectiveAttribute(directive, "text", value) : directive;
  });
}

function directiveTextFromElement(element: HTMLElement, kind: "marker" | "notes") {
  const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
  if (kind === "marker") {
    return text.replace(/^(?:M)?\d{2,3}\s*·?\s*/, "").trim() || "标记点";
  }
  return text.replace(/^↳\s*/, "").trim() || "提示内容";
}

function formatTime(value: number) {
  return new Date(value).toLocaleTimeString("zh-CN", { hour12: false });
}

async function copyToClipboard(value: string) {
  if (!value) {
    return false;
  }

  try {
    const bridge = (window as DesktopClipboardBridge).zhuangPrompter;
    if (bridge?.writeClipboardText) {
      await bridge.writeClipboardText(value);
      return true;
    }
  } catch {
    // Fall back to browser clipboard APIs below.
  }

  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall back to the selection-based copy path below.
  }

  return copyToClipboardWithSelection(value);
}

function copyToClipboardWithSelection(value: string) {
  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.readOnly = true;
  textArea.style.position = "fixed";
  textArea.style.top = "0";
  textArea.style.left = "-9999px";
  textArea.style.opacity = "0";
  textArea.style.pointerEvents = "none";
  document.body.appendChild(textArea);

  try {
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textArea.remove();
  }
}

function safeFileName(value: string) {
  return (
    value
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "zhuang-prompter-script"
  );
}

function downloadMarkdownFile(fileName: string, markdown: string) {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
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

function DownloadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 1.2v5.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="m3.8 4.7 2.2 2.2 2.2-2.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.2 8.4v1.7h7.6V8.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
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

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="m3 3 6 6M9 3 3 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
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
