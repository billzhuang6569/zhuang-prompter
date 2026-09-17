type PendingEditorActionIdentity = {
  kind: "marker" | "notes";
  pendingId?: string;
  editTarget?: {
    markerId?: string;
    occurrence: number;
  };
};

// 指令属性转义：折叠引号、反斜杠、换行与多余空白为单行安全文本（§3.3）。
// 原文两处（room-client / control-console）历史各自复制过同一实现，这里作为唯一权威。
export function escapeDirectiveAttr(value: string) {
  return value.replace(/["\\\n\r]/g, " ").replace(/\s+/g, " ").trim();
}

export const MARKER_PLACEHOLDER = "标记点";
export const NOTES_PLACEHOLDER = "提示内容";

export type ConvertibleDirectiveKind = "marker" | "notes";

export type BuiltDirective = {
  /** 完整指令文本，尾随 \u00A0 以强制行内渲染。 */
  directive: string;
  /** 存入 pendingEditorAction 的可再编辑标签（已转义、单行）。 */
  label: string;
  /** 是否发生"真正转换"（存在非空选区）。false 表示按占位插入。 */
  converted: boolean;
};

// 由选区文本构建注释/标记指令（§3.3 选区转换契约）。
// 存在非空选区时执行"真正转换"：选区文本经转义后成为指令的 text= 值；
// 调用方随后用该指令替换选区范围（sourceWithBlockInsertion），
// 因此原选区文本不再作为朗读正文出现——注释不进入语音索引，
// 标记只保留跳转锚点与显示标签，标签文字不进入阅读/朗读索引。
// 选区为空时退回占位文本，保持"插入"语义。
export function buildConvertedDirective(options: {
  kind: ConvertibleDirectiveKind;
  selectedText?: string;
  markerId?: string;
  pendingId: string;
}): BuiltDirective {
  const { kind, selectedText = "", markerId = "01", pendingId } = options;
  const escaped = escapeDirectiveAttr(selectedText);
  const converted = escaped.length > 0;
  const label = converted ? escaped : kind === "marker" ? MARKER_PLACEHOLDER : NOTES_PLACEHOLDER;
  const directive =
    kind === "marker"
      ? `:marker[${markerId}]{text="${label}" pending="${pendingId}"}\u00A0`
      : `:notes{text="${label}" pending="${pendingId}"}\u00A0`;
  return { directive, label, converted };
}

export function pendingEditorActionKey(action: PendingEditorActionIdentity | null | undefined) {
  if (!action) {
    return null;
  }
  if (action.pendingId) {
    return `${action.kind}:pending:${action.pendingId}`;
  }
  if (action.editTarget) {
    return `${action.kind}:existing:${action.editTarget.markerId ?? ""}:${action.editTarget.occurrence}`;
  }
  return `${action.kind}:unknown`;
}

export function renumberMarkerDirectives(source: string) {
  let markerIndex = 0;
  let activeFence: { character: string; length: number } | null = null;

  return source
    .split("\n")
    .map((line) => {
      const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
      if (fenceMatch) {
        const fence = fenceMatch[1];
        const character = fence[0];
        if (!activeFence) {
          activeFence = { character, length: fence.length };
        } else if (activeFence.character === character && fence.length >= activeFence.length) {
          activeFence = null;
        }
        return line;
      }

      if (activeFence) {
        return line;
      }

      return line.replace(/(:{1,2}marker\[)[^\]\r\n]*(\])/g, (_match, before: string, after: string) => {
        markerIndex += 1;
        return `${before}${markerIndex.toString().padStart(2, "0")}${after}`;
      });
    })
    .join("\n");
}
