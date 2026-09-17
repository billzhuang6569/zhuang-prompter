export type SourceRange = {
  start: number;
  end: number;
};

// Display-only inline structure (§12.5). The spoken `text` string on each node
// stays the single source of truth for speech / anchors / reading alignment;
// `inlines` only enriches how that same text is painted. The concatenation of
// run visible-text is the same character sequence as `text` (runs are built
// from the same mdast children), so normalizeReadingText() is unaffected.
export type InlineRun =
  | { type: "text"; text: string }
  | { type: "break" }
  | { type: "inlineCode"; text: string }
  | { type: "strong"; children: InlineRun[] }
  | { type: "emphasis"; children: InlineRun[] }
  | { type: "link"; href?: string; children: InlineRun[] };

export type RenderNode =
  | {
      renderNodeId: string;
      type: "heading";
      depth: number;
      text: string;
      inlines?: InlineRun[];
      sourceRange: SourceRange;
      scrollAnchorId: string;
    }
  | {
      renderNodeId: string;
      type: "paragraph" | "listItem" | "blockquote";
      text: string;
      inlines?: InlineRun[];
      ordered?: boolean;
      itemNumber?: number;
      cue?: StageCueData;
      inlineMarkers?: MarkerData[];
      sourceRange: SourceRange;
      scrollAnchorId: string;
    }
  | {
      renderNodeId: string;
      type: "code";
      text: string;
      lang?: string;
      sourceRange: SourceRange;
      scrollAnchorId: string;
    }
  | {
      renderNodeId: string;
      type: "thematicBreak";
      sourceRange: SourceRange;
      scrollAnchorId: string;
    }
  | {
      renderNodeId: string;
      type: "stageCue";
      cue: StageCueData;
      body?: string;
      sourceRange: SourceRange;
    }
  | {
      renderNodeId: string;
      type: "marker";
      marker: MarkerData;
      sourceRange: SourceRange;
      scrollAnchorId: string;
    };

export type StageCueData = {
  cue?: string;
  label?: string;
  level?: string;
  duration?: string;
  text?: string;
};

export type MarkerData = {
  markerId: string;
  type: string;
  label?: string;
  note?: string;
  text?: string;
};

export type SpeechIndexItem = {
  speechSegmentId: string;
  rawText: string;
  normalizedText: string;
  sourceRange: SourceRange;
  displayRange?: { startPx?: number; endPx?: number };
  scrollAnchorId: string;
  paragraphIndex: number;
  textHash: string;
  nearbyMarkerId?: string;
};

export type MarkerAnchor = {
  markerId: string;
  type: string;
  label?: string;
  note?: string;
  text?: string;
  sourceRange: SourceRange;
  nearestSpeechAnchorId?: string;
  blockIndex: number;
  textHash: string;
  inline: boolean;
};

export type ScrollAnchor = {
  anchorId: string;
  scriptVersionId: string;
  kind: "marker" | "heading" | "paragraph" | "speechSegment" | "renderLine";
  markerId?: string;
  paragraphIndex?: number;
  speechSegmentId?: string;
  sourceRange?: SourceRange;
  textHash?: string;
  renderedTopPx?: number;
  renderedHeightPx?: number;
  lineIndex?: number;
};

export type ParseWarning = {
  code: "DUPLICATE_MARKER_ID" | "INVALID_EXTENSION_SYNTAX" | "MISSING_MARKER_LABEL" | "LONG_UNBREAKABLE_TOKEN";
  message: string;
  sourceRange?: SourceRange;
};

export type RenderBundle = {
  htmlTree: RenderNode[];
  speechIndex: SpeechIndexItem[];
  markerIndex: MarkerAnchor[];
  scrollAnchorIndex: ScrollAnchor[];
  parseWarnings: ParseWarning[];
};

export type ParseOptions = {
  scriptVersionId?: string;
};
