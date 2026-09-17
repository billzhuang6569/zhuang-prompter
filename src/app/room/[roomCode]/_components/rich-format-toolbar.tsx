"use client";

/**
 * §3.1 Rich-text format toolbar for the MDXEditor-based script editor.
 *
 * Rendered inside the editor via `toolbarPlugin` (see initialized-rich-markdown-editor.tsx),
 * because every MDXEditor toolbar component (BlockTypeSelect / BoldItalicUnderlineToggles /
 * ListsToggle / UndoRedo) reads from the editor realm and MUST live inside the MDXEditor tree.
 *
 * Formatting semantics (block conversion, inline toggles, mixed/neutral state, Enter/Backspace
 * behaviour, single-undo transactions, IME safety) are all handled natively by Lexical /
 * MDXEditor. The only custom piece is the "清除格式" (clear inline formatting) button, because
 * `applyFormat$` merely dispatches FORMAT_TEXT_COMMAND, which *toggles* — on a mixed selection it
 * would ADD emphasis rather than remove it. Clearing therefore manipulates the Lexical text nodes
 * directly, touching only inline format/style and never deleting text, breaks, notes, or markers.
 */

import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  ButtonWithTooltip,
  ListsToggle,
  Separator,
  UndoRedo,
  activeEditor$,
  currentSelection$,
  useCellValues,
  type Translation,
} from "@mdxeditor/editor";
import { $getSelection, $isRangeSelection, $isTextNode } from "lexical";

const CLEAR_FORMAT_TITLE = "清除格式（仅移除所选文字的加粗/斜体等行内格式）";

/**
 * Chinese labels/tooltips for the toolbar. Providing `translation` on <MDXEditor> replaces the
 * built-in (English) translator entirely, so unknown keys fall back to the component-supplied
 * default string. Interpolation (e.g. `{{level}}`, `{{shortcut}}`) is re-implemented here because
 * the fallback path no longer goes through the library's interpolator.
 */
const ZH_STRINGS: Record<string, string> = {
  "toolbar.undo": "撤销 {{shortcut}}",
  "toolbar.redo": "重做 {{shortcut}}",
  "toolbar.blockTypes.paragraph": "正文",
  "toolbar.blockTypes.quote": "引用",
  "toolbar.blockTypes.heading": "H{{level}}",
  "toolbar.blockTypeSelect.selectBlockTypeTooltip": "选择段落样式",
  // Shown by the block-type <Select> only when the block type is empty/unknown, i.e. a mixed
  // selection spanning different block types. Neutral wording, never a false single-format label.
  "toolbar.blockTypeSelect.placeholder": "混合",
  "toolbar.bold": "加粗",
  "toolbar.removeBold": "取消加粗",
  "toolbar.italic": "斜体",
  "toolbar.removeItalic": "取消斜体",
  "toolbar.bulletedList": "无序列表",
  "toolbar.numberedList": "有序列表",
  "toolbar.checkList": "任务列表",
};

function interpolate(template: string, interpolations?: Record<string, unknown>): string {
  if (!interpolations) {
    return template;
  }
  return template.replace(/{{\s*([\w.]+)\s*}}/g, (_match, key: string) => {
    const value = interpolations[key];
    return value == null ? "" : String(value);
  });
}

export const richEditorTranslation: Translation = (key, defaultValue, interpolations) => {
  const template = Object.prototype.hasOwnProperty.call(ZH_STRINGS, key) ? ZH_STRINGS[key] : defaultValue;
  return interpolate(template, interpolations);
};

/** Eraser / "clear formatting" glyph. Uses currentColor so the toolbar's svg color rule applies. */
function ClearFormatIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M6 7V5h12v2M9 5l-2 14M11 19h4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M14.5 13.5l6 6M20.5 13.5l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ClearFormattingButton() {
  const [activeEditor, selection] = useCellValues(activeEditor$, currentSelection$);
  const hasRange = $isRangeSelection(selection) && !selection.isCollapsed();
  const disabled = !activeEditor || !hasRange;

  const clearFormatting = () => {
    if (!activeEditor) {
      return;
    }
    // Single editor.update() => single undoable transaction (§3.1 contract).
    activeEditor.update(() => {
      const current = $getSelection();
      if (!$isRangeSelection(current) || current.isCollapsed()) {
        return;
      }
      // extract() splits the boundary text nodes so the returned nodes cover *exactly* the
      // selection — no over-clearing of adjacent unselected text. Only TextNodes are touched;
      // heading/quote element nodes and directive decorator nodes (markers/notes) are left intact,
      // so nothing is ever deleted.
      for (const node of current.extract()) {
        if ($isTextNode(node)) {
          node.setStyle("");
          node.setFormat(0);
        }
      }
    });
  };

  return (
    <ButtonWithTooltip title={CLEAR_FORMAT_TITLE} disabled={disabled} onClick={clearFormatting}>
      <ClearFormatIcon />
    </ButtonWithTooltip>
  );
}

/**
 * Toolbar contents (first-version control set):
 *   撤销/重做 · | · 段落样式(正文/H1–H6/引用) · | · 加粗/斜体 · | · 有序/无序列表 · | · 清除格式
 */
export function RichFormatToolbar() {
  return (
    <>
      <UndoRedo />
      <Separator />
      <BlockTypeSelect />
      <Separator />
      <BoldItalicUnderlineToggles options={["Bold", "Italic"]} />
      <Separator />
      <ListsToggle options={["bullet", "number"]} />
      <Separator />
      <ClearFormattingButton />
    </>
  );
}
