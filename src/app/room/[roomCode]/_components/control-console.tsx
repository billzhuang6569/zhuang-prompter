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
import { copyTextToClipboard } from "@/shared/clipboard";
import { readingHighlight, readingOffsetForPoint, releaseReadingMap } from "@/modules/playback-engine/reading-position";
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
  roomMarkdown?: string;
  draftSynchronized?: boolean;
  readingAnchor?: Anchor;
  hasPrimaryPlayer: boolean;
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
  onSaveDraft: (markdown?: string) => Promise<boolean>;
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
  onSeekAnchor: (anchor: Anchor) => void;
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
  roomMarkdown,
  draftSynchronized = false,
  readingAnchor,
  hasPrimaryPlayer,
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
  onSeekAnchor,
  onBeginMarkerEdit,
  onBeginCommentEdit,
  pendingEditorAction,
  onPendingEditorValueChange,
  onConfirmPendingEditorAction,
  onPreviewScroll,
}: ControlConsoleProps) {
  const [fontPercentInput, setFontPercentInput] = useState<string | null>(null);
  function commitFontPercent() {
    if (fontPercentInput !== null && fontPercentInput.trim() !== "") {
      const percent = Number(fontPercentInput);
      if (Number.isFinite(percent) && percent >= 75) onPlayerFontScaleChange(percent / 100);
    }
    setFontPercentInput(null);
  }
  const [view, setView] = useState<"render" | "raw">("render");
  const quickInputRef = useRef<HTMLInputElement | null>(null);
  const richEditorRef = useRef<MDXEditorMethods | null>(null);
  const scriptSurfaceRef = useRef<HTMLDivElement | null>(null);
  const richContentWrapRef = useRef<HTMLDivElement | null>(null);
  const readingRootRef = useRef<HTMLElement | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const guideLineRef = useRef<HTMLDivElement | null>(null);
  const copyStatusTimerRef = useRef<number | undefined>(undefined);
  const modeInitializedRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasHighlight, setHasHighlight] = useState(false);
  const savingRef = useRef(false);
  const composingRef = useRef(false);
  const finishRequestedRef = useRef(false);
  const latestMarkdownRef = useRef(markdown);
  useLayoutEffect(() => { latestMarkdownRef.current = markdown; }, [markdown]);
  const pointerStartRef = useRef<{x:number;y:number;scroll:number;moved:boolean} | null>(null);
  const synchronized = draftSynchronized && typeof readingAnchor?.lineEndOffset === "number";
  const previousMarkdownRef = useRef(markdown);
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const restoringRef = useRef(false);
  const [floatingEditorPosition, setFloatingEditorPosition] = useState<FloatingEditorPosition | null>(null);
  const [richPendingEditorAction, setRichPendingEditorAction] = useState<PendingEditorAction | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
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
    if (modeInitializedRef.current || roomMarkdown === undefined) return;
    modeInitializedRef.current = true;
    const frame = requestAnimationFrame(() => setEditing(!roomMarkdown.trim()));
    return () => cancelAnimationFrame(frame);
  }, [roomMarkdown]);

  useLayoutEffect(() => {
    const scroll = previewScrollRef.current;
    const wrap = richContentWrapRef.current;
    const overlay = highlightRef.current, guide = guideLineRef.current;
    if (!scroll || !wrap || !overlay || !guide) return;
    let frame = 0;
    const draw = () => {
      overlay.replaceChildren();
      guide.hidden = true;
      setHasHighlight(false);
      const content = wrap.querySelector<HTMLElement>(".nike-rich-editor-content");
      if (readingRootRef.current !== content) {
        if (readingRootRef.current) releaseReadingMap(readingRootRef.current);
        readingRootRef.current = content;
      }
      if (!content || !bundle || !synchronized || view !== "render" || readingAnchor?.textOffset === undefined || readingAnchor.lineEndOffset === undefined) return;
      const highlight = readingHighlight(content,bundle,readingAnchor.textOffset,readingAnchor.lineEndOffset,readingAnchor.lineLeadingExtra,readingAnchor.lineTrailingExtra);
      if (!highlight) return;
      setHasHighlight(true);
      const origin = scroll.getBoundingClientRect();
      for (const rect of highlight.rects) {
        const span = document.createElement("span");
        Object.assign(span.style, { position:"absolute", left:`${rect.left-origin.left+scroll.scrollLeft}px`, top:`${rect.top-origin.top+scroll.scrollTop}px`, width:`${rect.width}px`, height:`${rect.height}px` });
        overlay.append(span);
      }
      const top = highlight.guideY-origin.top+scroll.scrollTop;
      guide.style.top = `${top}px`;
      guide.hidden = false;
      if (!editing && !window.getSelection()?.toString() && Math.abs(scroll.scrollTop+scroll.clientHeight/2-top)>72) scroll.scrollTop = Math.max(0,top-scroll.clientHeight/2);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); };
    schedule();
    const resize = new ResizeObserver(schedule);
    resize.observe(wrap);
    const mutations = new MutationObserver(schedule);
    mutations.observe(wrap,{subtree:true,childList:true,characterData:true});
    scroll.addEventListener("scroll",schedule);
    window.addEventListener("resize",schedule);
    document.fonts?.addEventListener("loadingdone",schedule);
    return () => {
      cancelAnimationFrame(frame); resize.disconnect(); mutations.disconnect();
      scroll.removeEventListener("scroll",schedule); window.removeEventListener("resize",schedule);
      document.fonts?.removeEventListener("loadingdone",schedule);
    };
  }, [bundle, readingAnchor, synchronized, editing, view, previewScrollRef]);

  useEffect(() => () => {
    if (readingRootRef.current) releaseReadingMap(readingRootRef.current);
  }, []);

  async function finishEditing() {
    if (savingRef.current) return;
    if (composingRef.current) {
      finishRequestedRef.current = true;
      (document.activeElement as HTMLElement | null)?.blur();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      if (activePendingEditorAction) confirmFloatingEditorAction();
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (await onSaveDraft(latestMarkdownRef.current)) { setView("render"); setEditing(false); }
    } finally { savingRef.current = false; setSaving(false); }
  }

  function seekPoint(node: Node, offset: number, point?: {x:number;y:number}) {
    const content = richContentWrapRef.current?.querySelector<HTMLElement>(".nike-rich-editor-content");
    if (!content || !bundle || !synchronized) return;
    const textOffset = readingOffsetForPoint(content,bundle,node,offset,point);
    if (textOffset !== undefined) onSeekAnchor({type:"renderLine",textOffset});
  }
  function clickToSeek(event: MouseEvent<HTMLDivElement>) {
    if (editing) { beginExistingDirectiveEdit(event); return; }
    event.preventDefault();
    const down = pointerStartRef.current;
    if (!down || down.moved || Math.hypot(event.clientX-down.x,event.clientY-down.y)>5 || Math.abs((previewScrollRef.current?.scrollTop ?? 0)-down.scroll)>2 || window.getSelection()?.toString()) return;
    const doc = document as Document & {caretPositionFromPoint?: (x:number,y:number)=>{offsetNode:Node;offset:number} | null};
    const caret = doc.caretRangeFromPoint?.(event.clientX,event.clientY);
    const position = !caret ? doc.caretPositionFromPoint?.(event.clientX,event.clientY) : null;
    const node = caret?.startContainer ?? position?.offsetNode, offset = caret?.startOffset ?? position?.offset;
    if (!node || offset === undefined || node.nodeType !== Node.TEXT_NODE) return;
    seekPoint(node,offset,{x:event.clientX,y:event.clientY});
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
      if (!editing || saving || !isHistoryKey || event.altKey || event.isComposing) {
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
  }, [canRedo, canUndo, redoMarkdown, undoMarkdown, editing, saving]);

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
    if (!editing || saving) return;
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
    if (!editing || saving) return;
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
    const copied = await copyTextToClipboard(value);
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
      if (target.closest(".nike-floating-editor") || target.closest(".nike-mdx-directive") || target.closest(".nike-mode-toggle")) {
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
    if (!editing || saving) return;
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
    if (!editing || saving) return;
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
                disabled={!editing || saving}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={beginInlineMarkerEdit}
              >
                <StarIcon />
                {canConvertSelection ? "改为标记" : "增加标记"}
              </button>
              <button
                className="nike-tlb"
                disabled={!editing || saving}
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
              {exportStatus && <span className="nike-export-status">{exportStatus}</span>}
            </div>
            <div className="nike-edit-controls">
              <span className="nike-edit-status" role="status">{saving ? "正在保存" : saveStatus} {!hasPrimaryPlayer ? "未连接播放端" : !synchronized || !hasHighlight ? "未同步" : ""}</span>
              {!editing && <button className="nike-selection-seek" type="button" onMouseDown={event => event.preventDefault()} onClick={() => {
                const selection = window.getSelection();
                if (selection?.anchorNode) seekPoint(selection.anchorNode, selection.anchorOffset);
              }}>定位到选区</button>}
            </div>
            <div className="nike-script-switches">
              <div className="nike-vswitch nike-mode-toggle" role="group" aria-label="编辑模式">
                <button className={`nike-vswitch-seg ${editing ? "on" : ""}`} type="button" aria-pressed={editing} disabled={saving} onClick={() => setEditing(true)}>编辑</button>
                <button className={`nike-vswitch-seg ${!editing ? "on" : ""}`} type="button" aria-pressed={!editing} disabled={saving} onClick={() => { if (editing) void finishEditing(); }}>完成</button>
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
                  disabled={!editing || saving}
                  onClick={() => setView("raw")}
                >
                  原文
                </button>
              </div>
            </div>
          </div>

          <div className={`nike-srw ${isPlaying ? "playing" : ""} ${!editing || saving ? "is-done" : ""}`} data-od-id="script-render-wrapper" ref={scriptSurfaceRef}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; if (finishRequestedRef.current) { finishRequestedRef.current = false; void finishEditing(); } }}
            >
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

            {(

              <div
                className="nike-sr"
                style={{display:view === "render" ? undefined : "none"}}
                ref={previewScrollRef}
                data-od-id="script-render"
                onMouseDown={placeCaretAfterDirective}
                onClick={clickToSeek}
                onScroll={(event) => onPreviewScroll(event.currentTarget.scrollTop)}
                onPointerDown={(event) => { pointerStartRef.current = {x:event.clientX,y:event.clientY,scroll:event.currentTarget.scrollTop,moved:false}; }}
                onPointerMove={(event) => { const down = pointerStartRef.current; if (down && Math.hypot(event.clientX-down.x,event.clientY-down.y)>5) down.moved = true; }}
                onPointerCancel={() => { pointerStartRef.current = null; }}
              >
                <div className="nike-reading-highlight" ref={highlightRef} aria-hidden="true" />
                <div className="nike-iline" ref={guideLineRef} hidden aria-hidden="true" />
                <div className="nike-sc nike-rich-editor-wrap" ref={richContentWrapRef}>
                  <RichMarkdownEditor
                    ref={richEditorRef}
                    className="nike-rich-editor"
                    contentEditableClassName="nike-rich-editor-content"
                    readOnly={!editing || saving}
                    markdown={markdown}
                    onChange={setMarkdown}
                    spellCheck={false}
                  />
                  <div className="nike-bottom-space" />
                </div>
              </div>
            )}
            {(
              <div className="nike-sr" style={{display:view === "raw" ? undefined : "none"}} data-od-id="script-raw">
                <textarea
                  ref={markdownEditorRef}
                  className="nike-raw-editor"
                  aria-label="Markdown 原文编辑"
                  spellCheck={false}
                  readOnly={!editing || saving}
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
                <button className="nike-mde-save" type="button" onClick={onSaveVersion}><SaveIcon /> 保存版本</button>
              </div>
            </div>
          </div>
        </section>

        <aside className="nike-rp" data-od-id="right-panel">
          <div className="nike-playback-cards" data-od-id="playback-controls">
            <section className="nike-playback-card" aria-label="播放位置">
              <h2><PanelIcon kind="position" />播放位置</h2>
              <p>控制播放端现在停在稿子的哪里</p>
              <div className="nike-transport">
                <button type="button" title="回到开始" aria-label="开头" onClick={onJumpToStart}><PanelIcon kind="start" /><span>开头</span></button>
                <button type="button" title="后退 160px" aria-label="后退一段" onClick={() => onNudge(-160)}><PanelIcon kind="back" /><span>后退一段</span></button>
                <button className="nike-play-btn" type="button" title={isPlaying ? "暂停" : "播放"} aria-label={isPlaying ? "暂停" : "播放"} onClick={onTogglePlay}>
                  <span className="nike-play-disc">{isPlaying ? <PauseIcon /> : <PlayIcon />}</span><span>{isPlaying ? "暂停" : "播放"}</span>
                </button>
                <button type="button" title="前进 160px" aria-label="前进一段" onClick={() => onNudge(160)}><PanelIcon kind="forward" /><span>前进一段</span></button>
                <button type="button" title="回到结束" aria-label="结尾" onClick={onJumpToEnd}><PanelIcon kind="end" /><span>结尾</span></button>
              </div>
            </section>
            <section className="nike-playback-card" aria-label="播放速度">
              <div className="nike-card-heading"><h2><PanelIcon kind="speed" />播放速度</h2><div className="nike-card-value">{speed} <small>px/s</small></div></div>
              <p>稿子向上滚动的快慢</p>
              <div className="nike-card-slider">
                <button className="nike-step" type="button" title="减速 10 px/s" aria-label="减速 10 px/s" onClick={() => onSpeedChange(speed - 10)}>−</button>
                <input aria-label="播放速度" type="range" min="10" max="150" value={speed} onChange={event => onSpeedChange(Number(event.target.value))} />
                <button className="nike-step" type="button" title="加速 10 px/s" aria-label="加速 10 px/s" onClick={() => onSpeedChange(speed + 10)}>+</button>
              </div>
              <div className="nike-slider-labels"><span>慢 10</span><span>快 150</span></div>
            </section>
            <section className="nike-playback-card" aria-label="播放端字号">
              <div className="nike-card-heading"><h2><PanelIcon kind="font" />播放端字号</h2><div className="nike-card-value">
                <input aria-label="播放端字号百分比" type="number" min="75" value={fontPercentInput ?? Math.round(playerFontScale * 100)}
                  onChange={event => setFontPercentInput(event.target.value)} onBlur={commitFontPercent}
                  onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} /><small>%</small>
              </div></div>
              <p>只影响播放端屏幕，不影响这里</p>
              <div className="nike-card-slider">
                <button className="nike-step nike-font-step" type="button" title="字号减小 10%" aria-label="字号减小 10%" onClick={() => onPlayerFontScaleChange(playerFontScale - 0.1)}>A−</button>
                <input aria-label="播放端字号" type="range" min="75" max={Math.max(500, Math.round(playerFontScale * 100))} value={Math.round(playerFontScale * 100)} onChange={event => onPlayerFontScaleChange(Number(event.target.value) / 100)} />
                <button className="nike-step nike-font-step" type="button" title="字号增大 10%" aria-label="字号增大 10%" onClick={() => onPlayerFontScaleChange(playerFontScale + 0.1)}>A+</button>
              </div>
              <div className="nike-slider-labels"><span>小 75%</span><span>大 500%+</span></div>
              <div className="nike-font-sample"><span>字</span>播放端字号示意</div>
            </section>
            <section className="nike-playback-card" aria-label="镜像">
              <h2><PanelIcon kind="mirrorX" />镜像</h2>
              <p>配合分光镜提词器时打开</p>
              <div className="nike-mirror-toggles">
                <button className="nike-panel-toggle" type="button" title="左右镜像" aria-label="左右镜像" aria-pressed={playerMirrorX} onClick={() => onPlayerMirrorXChange(!playerMirrorX)}><PanelIcon kind="mirrorX" />左右镜像</button>
                <button className="nike-panel-toggle" type="button" title="上下镜像" aria-label="上下镜像" aria-pressed={playerMirrorY} onClick={() => onPlayerMirrorYChange(!playerMirrorY)}><PanelIcon kind="mirrorY" />上下镜像</button>
              </div>
            </section>
          </div>
          <section className="nike-psec" data-od-id="voice-assist">
            <div className="nike-ph">语音辅助</div>
            <button className="nike-panel-toggle" type="button" aria-pressed={voiceAssistWanted} onClick={onToggleVoiceAssist}>{voiceAssistWanted ? "识别中" : "自动识别"}</button>
            <div className="nike-voice-status" role="status" aria-live="polite">{voiceAssistStatus}</div>
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

function PanelIcon({kind}: {kind: "position" | "start" | "back" | "forward" | "end" | "speed" | "font" | "mirrorX" | "mirrorY"}) {
  const paths = {
    position: "M4 5h16M4 12h16M4 19h16M8 9l3 3-3 3",
    start: "M5 5v14M18 5l-9 7 9 7Z",
    back: "m12 5-7 7 7 7m7-14-7 7 7 7",
    forward: "m5 5 7 7-7 7m7-14 7 7-7 7",
    end: "M19 5v14M6 5l9 7-9 7Z",
    speed: "M4 19a9 9 0 1 1 16 0M12 13l5-6M7 17h10",
    font: "m4 19 6-14 6 14M6 14h8M17 10h5m-2.5 0v9",
    mirrorX: "M12 3v18M3 6v12l6-6Zm18 0v12l-6-6Z",
    mirrorY: "M3 12h18M6 3h12l-6 6Zm0 18h12l-6-6Z",
  };
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
}

function PlayIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="m8 4 12 8-12 8Z" /></svg>;
}

function PauseIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M6 4h4v16H6ZM14 4h4v16h-4Z" /></svg>;
}
