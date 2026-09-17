import remarkDirective from "remark-directive";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { toString } from "mdast-util-to-string";
import type {
  InlineRun,
  MarkerAnchor,
  MarkerData,
  ParseOptions,
  ParseWarning,
  RenderBundle,
  RenderNode,
  ScrollAnchor,
  SourceRange,
  SpeechIndexItem,
  StageCueData,
} from "./types";

type MarkdownNode = {
  type: string;
  value?: string;
  depth?: number;
  ordered?: boolean;
  start?: number;
  url?: string;
  lang?: string;
  name?: string;
  label?: string;
  attributes?: Record<string, string | number | boolean | null | undefined>;
  children?: MarkdownNode[];
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
};

const processor = unified().use(remarkParse).use(remarkDirective);

export function parseMarkdown(markdown: string, options: ParseOptions = {}): RenderBundle {
  const scriptVersionId = options.scriptVersionId ?? "draft";
  const tree = processor.parse(normalizeLineMarkerDirectives(markdown)) as MarkdownNode;
  const htmlTree: RenderNode[] = [];
  const speechIndex: SpeechIndexItem[] = [];
  const markerIndex: MarkerAnchor[] = [];
  const scrollAnchorIndex: ScrollAnchor[] = [];
  const parseWarnings: ParseWarning[] = [];
  const seenMarkerIds = new Set<string>();
  let blockIndex = 0;
  let paragraphIndex = 0;
  let nearbyMarkerId: string | undefined;

  function addScrollAnchor(anchor: ScrollAnchor) {
    scrollAnchorIndex.push(anchor);
    return anchor.anchorId;
  }

  function addSpeech(rawText: string, node: MarkdownNode, kind: "heading" | "paragraph" | "speechSegment") {
    const normalizedText = normalizeSpeech(rawText);
    if (!normalizedText) {
      return null;
    }

    paragraphIndex += 1;
    const sourceRange = rangeOf(node);
    const textHash = hashText(normalizedText);
    const speechSegmentId = `speech_${paragraphIndex}_${textHash}`;
    const scrollAnchorId = addScrollAnchor({
      anchorId: `anchor_${kind}_${paragraphIndex}_${textHash}`,
      scriptVersionId,
      kind,
      paragraphIndex,
      speechSegmentId,
      sourceRange,
      textHash,
    });

    const item: SpeechIndexItem = {
      speechSegmentId,
      rawText,
      normalizedText,
      sourceRange,
      scrollAnchorId,
      paragraphIndex,
      textHash,
      nearbyMarkerId,
    };
    speechIndex.push(item);
    warnLongTokens(normalizedText, sourceRange, parseWarnings);
    return item;
  }

  function addMarker(node: MarkdownNode, inline: boolean) {
    const marker = markerFromNode(node);
    const sourceRange = rangeOf(node);
    const textHash = hashText(`${marker.markerId}:${marker.text ?? marker.label ?? ""}`);
    const anchorId = addScrollAnchor({
      anchorId: `anchor_marker_${marker.markerId}`,
      scriptVersionId,
      kind: "marker",
      markerId: marker.markerId,
      sourceRange,
      textHash,
    });

    if (seenMarkerIds.has(marker.markerId)) {
      parseWarnings.push({
        code: "DUPLICATE_MARKER_ID",
        message: `Duplicate marker id: ${marker.markerId}`,
        sourceRange,
      });
    }
    seenMarkerIds.add(marker.markerId);

    if (!marker.text && !marker.label) {
      parseWarnings.push({
        code: "MISSING_MARKER_LABEL",
        message: `Marker ${marker.markerId} has no text.`,
        sourceRange,
      });
    }

    markerIndex.push({
      ...marker,
      sourceRange,
      blockIndex,
      textHash,
      inline,
    });
    nearbyMarkerId = marker.markerId;
    return { marker, anchorId, sourceRange };
  }

  function handleBlock(node: MarkdownNode) {
    blockIndex += 1;

    if (node.type === "heading") {
      const text = cleanDisplayText(flattenInlineText(node));
      const speech = addSpeech(text, node, "heading");
      htmlTree.push({
        renderNodeId: `render_heading_${blockIndex}`,
        type: "heading",
        depth: node.depth ?? 1,
        text,
        inlines: inlinesOrUndefined(buildInlines(node.children ?? [])),
        sourceRange: rangeOf(node),
        scrollAnchorId: speech?.scrollAnchorId ?? addRenderLineAnchor(node, scriptVersionId, scrollAnchorIndex),
      });
      return;
    }

    if (node.type === "paragraph") {
      const segments = paragraphSegments(node);
      const paragraphContainsOnlyMarkers =
        segments.length > 0 &&
        segments.every((parsed) => parsed.markers.length > 0 && !parsed.spokenText && !parsed.cue);

      if (paragraphContainsOnlyMarkers) {
        let markerSegmentIndex = 0;
        for (const parsed of segments) {
          for (const markerNode of parsed.markers) {
            markerSegmentIndex += 1;
            const { marker, anchorId, sourceRange } = addMarker(markerNode, false);
            htmlTree.push({
              renderNodeId: `render_marker_${blockIndex}_${markerSegmentIndex}`,
              type: "marker",
              marker,
              sourceRange,
              scrollAnchorId: anchorId,
            });
          }
        }
        return;
      }

      let segmentIndex = 0;
      for (const parsed of segments) {
        segmentIndex += 1;
        const speech = addSpeech(parsed.spokenText, node, parsed.cue ? "speechSegment" : "paragraph");
        if (parsed.markers.length > 0) {
          for (const markerNode of parsed.markers) {
            addMarker(markerNode, true);
          }
        }
        htmlTree.push({
          renderNodeId: `render_paragraph_${blockIndex}_${segmentIndex}`,
          type: "paragraph",
          text: parsed.spokenText,
          inlines: parsed.spokenText ? inlinesOrUndefined(buildInlines(parsed.inlineNodes)) : undefined,
          cue: parsed.cue,
          inlineMarkers: parsed.markers.map((markerNode) => markerFromNode(markerNode)),
          sourceRange: rangeOf(node),
          scrollAnchorId: speech?.scrollAnchorId ?? addRenderLineAnchor(node, scriptVersionId, scrollAnchorIndex),
        });
      }
      if (segments.length === 0) {
        for (const markerNode of paragraphMarkers(node)) {
          addMarker(markerNode, true);
        }
      }
      return;
    }

    if (node.type === "list") {
      const ordered = node.ordered === true;
      const startNumber = ordered ? node.start ?? 1 : 1;
      let itemOffset = 0;
      for (const item of node.children ?? []) {
        blockIndex += 1;
        const text = cleanDisplayText(flattenInlineText(item));
        const speech = addSpeech(text, item, "paragraph");
        htmlTree.push({
          renderNodeId: `render_list_item_${blockIndex}`,
          type: "listItem",
          text,
          inlines: inlinesOrUndefined(buildInlines(listItemInlineChildren(item))),
          ordered,
          itemNumber: ordered ? startNumber + itemOffset : undefined,
          sourceRange: rangeOf(item),
          scrollAnchorId: speech?.scrollAnchorId ?? addRenderLineAnchor(item, scriptVersionId, scrollAnchorIndex),
        });
        itemOffset += 1;
      }
      return;
    }

    if (node.type === "thematicBreak") {
      htmlTree.push({
        renderNodeId: `render_rule_${blockIndex}`,
        type: "thematicBreak",
        sourceRange: rangeOf(node),
        scrollAnchorId: addRenderLineAnchor(node, scriptVersionId, scrollAnchorIndex),
      });
      return;
    }

    if (node.type === "blockquote") {
      const text = cleanDisplayText(flattenInlineText(node));
      const speech = addSpeech(text, node, "paragraph");
      htmlTree.push({
        renderNodeId: `render_quote_${blockIndex}`,
        type: "blockquote",
        text,
        inlines: inlinesOrUndefined(blockContainerInlines(node)),
        sourceRange: rangeOf(node),
        scrollAnchorId: speech?.scrollAnchorId ?? addRenderLineAnchor(node, scriptVersionId, scrollAnchorIndex),
      });
      return;
    }

    if (node.type === "code") {
      const text = cleanDisplayText(node.value ?? "");
      const speech = addSpeech(text, node, "paragraph");
      htmlTree.push({
        renderNodeId: `render_code_${blockIndex}`,
        type: "code",
        text,
        lang: typeof node.lang === "string" && node.lang ? node.lang : undefined,
        sourceRange: rangeOf(node),
        scrollAnchorId: speech?.scrollAnchorId ?? addRenderLineAnchor(node, scriptVersionId, scrollAnchorIndex),
      });
      return;
    }

    if (isDirective(node, "marker")) {
      const { marker, anchorId, sourceRange } = addMarker(node, false);
      htmlTree.push({
        renderNodeId: `render_marker_${blockIndex}`,
        type: "marker",
        marker,
        sourceRange,
        scrollAnchorId: anchorId,
      });
      return;
    }

    if (isNoteDirective(node)) {
      htmlTree.push({
        renderNodeId: `render_stage_${blockIndex}`,
        type: "stageCue",
        cue: cueFromNode(node),
        body: node.type === "containerDirective" ? cleanText(toString(node)) : undefined,
        sourceRange: rangeOf(node),
      });
      return;
    }

    const text = cleanDisplayText(flattenInlineText(node));
    if (text) {
      const speech = addSpeech(text, node, "paragraph");
      htmlTree.push({
        renderNodeId: `render_paragraph_${blockIndex}`,
        type: "paragraph",
        text,
        inlines: inlinesOrUndefined(buildInlines(node.children ?? [])),
        sourceRange: rangeOf(node),
        scrollAnchorId: speech?.scrollAnchorId ?? addRenderLineAnchor(node, scriptVersionId, scrollAnchorIndex),
      });
    }
  }

  collectUnsupportedDirectives(tree, parseWarnings);

  for (const child of tree.children ?? []) {
    handleBlock(child);
  }

  return { htmlTree, speechIndex, markerIndex, scrollAnchorIndex, parseWarnings };
}

function collectUnsupportedDirectives(node: MarkdownNode, warnings: ParseWarning[]) {
  if (
    (node.type === "textDirective" || node.type === "leafDirective" || node.type === "containerDirective") &&
    !isNoteDirective(node) &&
    node.name !== "marker"
  ) {
    warnings.push({
      code: "INVALID_EXTENSION_SYNTAX",
      message: `Unsupported directive: ${node.name ?? "unknown"}`,
      sourceRange: rangeOf(node),
    });
  }

  for (const child of node.children ?? []) {
    collectUnsupportedDirectives(child, warnings);
  }
}

function paragraphSegments(node: MarkdownNode) {
  const segments: Array<{ spokenText: string; cue?: StageCueData; markers: MarkdownNode[]; inlineNodes: MarkdownNode[] }> = [];
  let parts: string[] = [];
  let inlineNodes: MarkdownNode[] = [];
  let markers: MarkdownNode[] = [];

  function flush() {
    const spokenText = cleanDisplayText(parts.join(""));
    if (spokenText || markers.length > 0) {
      segments.push({ spokenText, markers, inlineNodes });
    }
    parts = [];
    inlineNodes = [];
    markers = [];
  }

  for (const child of node.children ?? []) {
    if (isNoteDirective(child)) {
      flush();
      segments.push({ spokenText: "", cue: cueFromNode(child), markers: [], inlineNodes: [] });
      continue;
    }
    if (isDirective(child, "marker")) {
      markers.push(child);
      continue;
    }
    parts.push(flattenInlineText(child));
    inlineNodes.push(child);
  }
  flush();

  return segments;
}

// Mirror of mdast-util-to-string for our inline set, except a hard `break` node
// contributes "\n" so adjacent words no longer merge (§12.5). Kept in lockstep
// with buildInlines so `text` and the rendered runs carry the same characters.
function flattenInlineText(node: MarkdownNode): string {
  if (node.type === "break") {
    return "\n";
  }
  if (typeof node.value === "string") {
    return node.value;
  }
  if (node.children) {
    return node.children.map(flattenInlineText).join("");
  }
  return "";
}

function buildInlines(children: MarkdownNode[]): InlineRun[] {
  const runs: InlineRun[] = [];
  for (const child of children) {
    switch (child.type) {
      case "text":
        runs.push({ type: "text", text: child.value ?? "" });
        break;
      case "inlineCode":
        runs.push({ type: "inlineCode", text: child.value ?? "" });
        break;
      case "break":
        runs.push({ type: "break" });
        break;
      case "strong":
        runs.push({ type: "strong", children: buildInlines(child.children ?? []) });
        break;
      case "emphasis":
        runs.push({ type: "emphasis", children: buildInlines(child.children ?? []) });
        break;
      case "link":
        runs.push({
          type: "link",
          href: typeof child.url === "string" ? child.url : undefined,
          children: buildInlines(child.children ?? []),
        });
        break;
      default: {
        // Unknown inline (e.g. delete/strikethrough without gfm, stray directive):
        // keep its text so nothing silently disappears from the spoken line.
        const text = flattenInlineText(child);
        if (text) {
          runs.push({ type: "text", text });
        }
      }
    }
  }
  return runs;
}

function inlinesOrUndefined(runs: InlineRun[]): InlineRun[] | undefined {
  return runs.length > 0 ? runs : undefined;
}

// A list item wraps its inline content in a child paragraph; unwrap it so the
// runs sit directly on the item (matches how `text` is flattened).
function listItemInlineChildren(item: MarkdownNode): MarkdownNode[] {
  const children = item.children ?? [];
  if (children.length === 1 && children[0]?.type === "paragraph") {
    return children[0].children ?? [];
  }
  return children;
}

// Blockquotes (and similar containers) hold block children; join their inline
// runs with a break between blocks so the visible text matches the flattened
// spoken text after normalization.
function blockContainerInlines(node: MarkdownNode): InlineRun[] {
  const runs: InlineRun[] = [];
  const blocks = node.children ?? [];
  blocks.forEach((block, index) => {
    if (index > 0) {
      runs.push({ type: "break" });
    }
    if (block.children && block.children.length > 0) {
      runs.push(...buildInlines(block.children));
    } else {
      const text = flattenInlineText(block);
      if (text) {
        runs.push({ type: "text", text });
      }
    }
  });
  return runs;
}

function paragraphMarkers(node: MarkdownNode) {
  return (node.children ?? []).filter((child) => isDirective(child, "marker"));
}

function isDirective(node: MarkdownNode, name: string) {
  return (
    (node.type === "textDirective" || node.type === "leafDirective" || node.type === "containerDirective") &&
    node.name === name
  );
}

function isStageDirective(node: MarkdownNode) {
  return isDirective(node, "stage") || isDirective(node, "stageCue");
}

function isNoteDirective(node: MarkdownNode) {
  return isDirective(node, "notes") || isStageDirective(node);
}

function markerFromNode(node: MarkdownNode): MarkerData {
  const text = stringAttr(node, "text") ?? stringAttr(node, "label");
  return {
    markerId: cleanText(node.label ?? toString(node) ?? "UNLABELED"),
    type: stringAttr(node, "type") ?? "marker",
    label: text,
    text,
    note: stringAttr(node, "note"),
  };
}

function cueFromNode(node: MarkdownNode): StageCueData {
  const text = stringAttr(node, "text") ?? stringAttr(node, "label") ?? stringAttr(node, "cue") ?? cleanText(node.label ?? undefined);
  return {
    cue: stringAttr(node, "cue") ?? text,
    label: text,
    level: stringAttr(node, "level"),
    duration: stringAttr(node, "duration"),
    text,
  };
}

function stringAttr(node: MarkdownNode, key: string) {
  const value = node.attributes?.[key];
  if (value === null || value === undefined) {
    return undefined;
  }
  return String(value);
}

function rangeOf(node: MarkdownNode): SourceRange {
  return {
    start: node.position?.start?.offset ?? 0,
    end: node.position?.end?.offset ?? node.position?.start?.offset ?? 0,
  };
}

function addRenderLineAnchor(node: MarkdownNode, scriptVersionId: string, scrollAnchorIndex: ScrollAnchor[]) {
  const sourceRange = rangeOf(node);
  const anchorId = `anchor_render_${sourceRange.start}_${sourceRange.end}`;
  scrollAnchorIndex.push({
    anchorId,
    scriptVersionId,
    kind: "renderLine",
    sourceRange,
    textHash: hashText(cleanText(toString(node))),
  });
  return anchorId;
}

function cleanText(value?: string) {
  return (value ?? "").replace(/\u200B/g, "").replace(/\s+/g, " ").trim();
}

function cleanDisplayText(value?: string) {
  return (value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u200B/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeLineMarkerDirectives(markdown: string) {
  return markdown.replace(/^([ \t]*):marker(\[[^\]\n]+\](?:\{[^\n}]*\})?)[\u200B\u00A0 \t]*$/gm, "$1::marker$2");
}

function normalizeSpeech(value: string) {
  return cleanText(value).toLocaleLowerCase();
}

function hashText(value: string) {
  let hash = 0x811c9dc5;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(12, "0").slice(0, 12);
}

function warnLongTokens(text: string, sourceRange: SourceRange, warnings: ParseWarning[]) {
  const token = text
    .split(/[\s\u2e80-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]+/)
    .find((part) => part.length > 80);
  if (token) {
    warnings.push({
      code: "LONG_UNBREAKABLE_TOKEN",
      message: `Long unbreakable token may require hard wrapping: ${token.slice(0, 40)}...`,
      sourceRange,
    });
  }
}
