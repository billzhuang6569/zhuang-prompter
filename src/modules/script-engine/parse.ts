import { createHash } from "node:crypto";
import remarkDirective from "remark-directive";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { toString } from "mdast-util-to-string";
import type {
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
  const tree = processor.parse(markdown) as MarkdownNode;
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
    const textHash = hashText(`${marker.markerId}:${marker.label ?? ""}:${marker.note ?? ""}`);
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

    if (!marker.label) {
      parseWarnings.push({
        code: "MISSING_MARKER_LABEL",
        message: `Marker ${marker.markerId} has no label.`,
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
      const text = cleanText(toString(node));
      const speech = addSpeech(text, node, "heading");
      htmlTree.push({
        renderNodeId: `render_heading_${blockIndex}`,
        type: "heading",
        depth: node.depth ?? 1,
        text,
        sourceRange: rangeOf(node),
        scrollAnchorId: speech?.scrollAnchorId ?? addRenderLineAnchor(node, scriptVersionId, scrollAnchorIndex),
      });
      return;
    }

    if (node.type === "paragraph") {
      const segments = paragraphSegments(node);
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
      for (const item of node.children ?? []) {
        blockIndex += 1;
        const text = cleanText(toString(item));
        const speech = addSpeech(text, item, "paragraph");
        htmlTree.push({
          renderNodeId: `render_list_item_${blockIndex}`,
          type: "listItem",
          text,
          sourceRange: rangeOf(item),
          scrollAnchorId: speech?.scrollAnchorId ?? addRenderLineAnchor(item, scriptVersionId, scrollAnchorIndex),
        });
      }
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

    if (isDirective(node, "stage")) {
      htmlTree.push({
        renderNodeId: `render_stage_${blockIndex}`,
        type: "stageCue",
        cue: cueFromNode(node),
        body: node.type === "containerDirective" ? cleanText(toString(node)) : undefined,
        sourceRange: rangeOf(node),
      });
      return;
    }

    const text = cleanText(toString(node));
    if (text) {
      const speech = addSpeech(text, node, "paragraph");
      htmlTree.push({
        renderNodeId: `render_paragraph_${blockIndex}`,
        type: "paragraph",
        text,
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
    node.name !== "stage" &&
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
  const segments: Array<{ spokenText: string; cue?: StageCueData; markers: MarkdownNode[] }> = [];
  let parts: string[] = [];
  let markers: MarkdownNode[] = [];

  function flush(cue?: StageCueData, forcedText?: string) {
    const spokenText = cleanText(forcedText ?? parts.join(""));
    if (spokenText || markers.length > 0) {
      segments.push({ spokenText, cue, markers });
    }
    parts = [];
    markers = [];
  }

  for (const child of node.children ?? []) {
    if (isDirective(child, "stage")) {
      flush();
      flush(cueFromNode(child), child.label ?? toString(child));
      continue;
    }
    if (isDirective(child, "marker")) {
      markers.push(child);
      continue;
    }
    parts.push(toString(child));
  }
  flush();

  return segments;
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

function markerFromNode(node: MarkdownNode): MarkerData {
  return {
    markerId: cleanText(node.label ?? "UNLABELED"),
    type: stringAttr(node, "type") ?? "section",
    label: stringAttr(node, "label"),
    note: stringAttr(node, "note"),
  };
}

function cueFromNode(node: MarkdownNode): StageCueData {
  return {
    cue: stringAttr(node, "cue") ?? cleanText(node.label ?? undefined),
    label: stringAttr(node, "label") ?? cleanText(node.label ?? undefined),
    level: stringAttr(node, "level"),
    duration: stringAttr(node, "duration"),
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
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeSpeech(value: string) {
  return cleanText(value).toLocaleLowerCase();
}

function hashText(value: string) {
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function warnLongTokens(text: string, sourceRange: SourceRange, warnings: ParseWarning[]) {
  const token = text.split(/\s+/).find((part) => part.length > 80);
  if (token) {
    warnings.push({
      code: "LONG_UNBREAKABLE_TOKEN",
      message: `Long unbreakable token may require hard wrapping: ${token.slice(0, 40)}...`,
      sourceRange,
    });
  }
}
