export type SourceRange = {
  start: number;
  end: number;
};

export type RenderNode =
  | {
      renderNodeId: string;
      type: "heading";
      depth: number;
      text: string;
      sourceRange: SourceRange;
      scrollAnchorId: string;
    }
  | {
      renderNodeId: string;
      type: "paragraph" | "listItem";
      text: string;
      cue?: StageCueData;
      inlineMarkers?: MarkerData[];
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
