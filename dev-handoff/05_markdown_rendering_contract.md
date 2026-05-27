# Markdown Rendering Contract

**Status**: Draft v0.1  
**Source syntax**: `docs/02_markdown-extension-spec.md`

## Contract Goal

The system must not simply render Markdown into HTML. It must parse Markdown once into a reusable runtime bundle for:

- Control preview.
- Player formal display.
- Marker navigation.
- Scroll anchor recovery.
- Voice matching.
- Version diff support.

Markdown remains the only user source format.

## RenderBundle

```ts
type RenderBundle = {
  htmlTree: RenderNode[];
  speechIndex: SpeechIndexItem[];
  markerIndex: MarkerAnchor[];
  scrollAnchorIndex: ScrollAnchor[];
  parseWarnings: ParseWarning[];
};
```

Cache key must include:

- `scriptVersionId`
- Markdown content hash
- display config fields that affect layout

## Speech Index Extraction

Rules:

- Normal paragraphs, headings, and list text enter `speechIndex`.
- In `:stage[口播文本]{...}`, only bracket text enters `speechIndex`.
- Standalone Stage Cue and block Stage Cue directives, including block body, do not enter `speechIndex`.
- `::marker[...]` and `:marker[...]` labels/notes do not enter `speechIndex`.
- Marker may assist search window boundaries, but marker label/note is not matchable speech.

```ts
type SpeechIndexItem = {
  speechSegmentId: string;
  rawText: string;
  normalizedText: string;
  sourceRange: { start: number; end: number };
  displayRange?: { startPx?: number; endPx?: number };
  scrollAnchorId: string;
  paragraphIndex: number;
  textHash: string;
  nearbyMarkerId?: string;
};
```

## Stage Cue Rendering

Stage Cue should be weakly interruptive:

- Bound Stage Cue: spoken text remains primary; cue renders on a following visual line.
- Standalone Stage Cue: low-weight cue line.
- Block Stage Cue: multi-line cue block with lower visual priority than spoken text.
- Hiding Stage Cue does not remove speech anchors or voice matching indexes.

Canonical visual form:

```text
口播文本
        ↳ 舞台提示 · 补充信息
```

## Cue Marker Rendering And Index

Marker is a control point and must enter `markerIndex`.

```ts
type MarkerAnchor = {
  markerId: string;
  type: "section" | "retake" | "jump" | "edit" | string;
  label?: string;
  note?: string;
  sourceRange: { start: number; end: number };
  nearestSpeechAnchorId?: string;
  blockIndex: number;
  textHash: string;
};
```

Rules:

- Independent marker is the preferred MVP jump point.
- Inline marker may render, but navigation should prefer independent markers.
- Marker ID must be unique inside a version.
- Duplicate marker IDs are parse warnings, not silent first-match behavior.
- Hiding markers in display does not remove marker navigation indexes.

## ScrollAnchor

```ts
type ScrollAnchor = {
  anchorId: string;
  scriptVersionId: string;
  kind: "marker" | "heading" | "paragraph" | "speechSegment" | "renderLine";
  markerId?: string;
  paragraphIndex?: number;
  speechSegmentId?: string;
  sourceRange?: { start: number; end: number };
  textHash?: string;
  renderedTopPx?: number;
  renderedHeightPx?: number;
  lineIndex?: number;
};
```

`speechIndex[].scrollAnchorId` must reference one item in `scrollAnchorIndex`. Voice matching must use this bridge rather than creating a separate spoken index.

## Voice Match To ScrollClock Bridge

Voice matching outputs a `matchedScrollAnchorId`, not a standalone incompatible anchor shape.

```ts
type VoiceMatchTarget = {
  matchedScrollAnchorId: string;
  speechSegmentId?: string;
  confidence: number;
  level: "locked" | "probable" | "uncertain" | "lost";
  targetOffsetPx?: number;
};
```

Conversion:

1. Resolve `matchedScrollAnchorId` in `scrollAnchorIndex`.
2. Convert that `ScrollAnchor` into the domain `Anchor`.
3. Use `renderedTopPx` or `targetOffsetPx` as ScrollClock `offsetPx`.
4. `locked` may create a new ScrollClock.
5. `probable` may only create a small correction inside the current viewport.
6. `uncertain` and `lost` must not create ScrollClock.

Anchor priority:

1. Marker ID.
2. Heading + text hash.
3. Paragraph index + text hash.
4. Speech segment hash.
5. Rendered line position.
6. Pixel offset fallback.

On script version change:

- Do not reuse old `positionPx` directly.
- Relocate by old anchor first.
- If exact anchor fails, search nearby paragraph or similar text hash.
- If still unresolved, use relative progress and show "approximate restore" to control side.

## CJK And English Line Breaking

Baseline CSS:

```css
.teleprompter-content {
  word-break: normal;
  overflow-wrap: anywhere;
  line-break: strict;
  text-wrap: pretty;
  font-kerning: normal;
}
```

Rules:

- Chinese, Japanese, and Korean can break at character boundaries.
- English prefers word/space breaks.
- URLs, long English words, and long number strings may hard-wrap.
- Avoid Chinese punctuation at line start: `，。！？：；）】》`.
- Avoid opening punctuation at line end: `（【《“‘`.
- Use stable font stack to reduce fallback width changes.

Suggested stack:

```css
font-family:
  system-ui,
  -apple-system,
  BlinkMacSystemFont,
  "PingFang SC",
  "Hiragino Sans GB",
  "Microsoft YaHei",
  "Noto Sans CJK SC",
  sans-serif;
```

## Parse Warnings

P0 should detect:

- Duplicate marker ID.
- Invalid Stage Cue / Marker syntax.
- Missing marker label when needed for navigation.
- Very long URL or unbreakable string.
- Unsupported extension syntax.

LLM typography suggestions are P1, not P0.
