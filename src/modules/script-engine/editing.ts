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

// §item7：把已存在或待定的注释/标记指令"改为正文"。
// 与选区转换（buildConvertedDirective）互为逆操作：指令的 text= 文本被取出，
// 原地替换整段指令（含尾随  /​ 强制行内标记），从而重新作为朗读正文，
// 回到语音/阅读索引。标记被移除后统一重新编号，保持文档序号连续。
export type DirectiveToBodyTarget = {
  kind: ConvertibleDirectiveKind;
  /** 待定指令：按 pending 锚点定位。 */
  pendingId?: string;
  /** 已存在指令：标记按 markerId 优先、否则按出现序号定位；注释按出现序号定位。 */
  markerId?: string;
  occurrence?: number;
};

function escapeRegExpLiteral(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeMarkerNumber(markerId: string) {
  const numeric = markerId.match(/\d+/)?.[0];
  return numeric ? Number(numeric).toString().padStart(2, "0") : markerId;
}

function recoveredBodyText(directive: string) {
  return directive.match(/text="([^"]*)"/)?.[1] ?? "";
}

export function convertDirectiveToBody(source: string, target: DirectiveToBodyTarget): string {
  const { kind } = target;
  // 尾随 ​/ （强制行内渲染的零宽/不换行空格）随指令一并消费。
  const trailing = "[\\u200B\\u00A0]?";
  let next = source;

  if (target.pendingId) {
    const pending = escapeRegExpLiteral(target.pendingId);
    const pattern =
      kind === "marker"
        ? new RegExp(`:{1,2}marker\\[[^\\]\\r\\n]*\\]\\{[^}]*pending="${pending}"[^}]*\\}${trailing}`)
        : new RegExp(`:{1,3}(?:notes|stage|stageCue)(?:\\[[^\\]]*\\])?\\{[^}]*pending="${pending}"[^}]*\\}${trailing}`);
    next = next.replace(pattern, (directive) => recoveredBodyText(directive));
  } else if (kind === "marker") {
    const occurrence = target.occurrence ?? 0;
    let markerOccurrence = -1;
    next = next.replace(
      new RegExp(`:{1,2}marker\\[([^\\]]+)\\]\\{[^}]*\\}${trailing}`, "g"),
      (directive, currentMarkerId: string) => {
        markerOccurrence += 1;
        const isTarget = target.markerId
          ? currentMarkerId === target.markerId ||
            normalizeMarkerNumber(currentMarkerId) === normalizeMarkerNumber(target.markerId)
          : markerOccurrence === occurrence;
        return isTarget ? recoveredBodyText(directive) : directive;
      },
    );
  } else {
    const occurrence = target.occurrence ?? 0;
    let notesOccurrence = -1;
    next = next.replace(
      new RegExp(`:{1,3}(?:notes|stage|stageCue)(?:\\[[^\\]]*\\])?\\{[^}]*\\}${trailing}`, "g"),
      (directive) => {
        notesOccurrence += 1;
        return notesOccurrence === occurrence ? recoveredBodyText(directive) : directive;
      },
    );
  }

  return kind === "marker" ? renumberMarkerDirectives(next) : next;
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
