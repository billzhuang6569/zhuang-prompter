type PendingEditorActionIdentity = {
  kind: "marker" | "notes";
  pendingId?: string;
  editTarget?: {
    markerId?: string;
    occurrence: number;
  };
};

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
