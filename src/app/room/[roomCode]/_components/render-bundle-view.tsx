import type { CSSProperties } from "react";
import type { InlineRun, RenderBundle, RenderNode } from "@/modules/script-engine";

type RenderBundleViewProps = {
  bundle: RenderBundle;
  variant: "control" | "player";
  playbackPositionPx?: number;
  fontScale?: number;
  mirrored?: boolean;
  mirrorX?: boolean;
  mirrorY?: boolean;
  showCenterGuide?: boolean;
  showMarkers?: boolean;
};

export function RenderBundleView({
  bundle,
  variant,
  playbackPositionPx = 0,
  fontScale = 1,
  mirrored = false,
  mirrorX = mirrored,
  mirrorY = false,
  showCenterGuide = false,
  showMarkers = true,
}: RenderBundleViewProps) {
  const contentStyle =
    variant === "player"
      ? ({
          "--playback-offset": `${Math.max(0, playbackPositionPx)}px`,
          "--player-font-scale": fontScale,
          "--player-font-size": `${Math.round(48 * fontScale)}px`,
        } as CSSProperties)
      : undefined;

  return (
    <section
      className={`script-surface ${variant === "player" ? "player-stage" : "control-preview"} ${
        mirrorX ? "is-mirrored-x" : ""
      } ${
        mirrorY ? "is-mirrored-y" : ""
      } ${showCenterGuide ? "has-center-guide" : ""} ${variant === "player" && !showMarkers ? "is-markers-hidden" : ""}`}
    >
      <div className="script-header">
        <div>
          <p className="eyebrow">M1 RenderBundle</p>
          <h2>{variant === "player" ? "播放端正式显示" : "控制端预览"}</h2>
        </div>
        <div className="bundle-stats">
          <span>{bundle.speechIndex.length} speech</span>
          <span>{bundle.markerIndex.length} markers</span>
          <span>{bundle.scrollAnchorIndex.length} anchors</span>
        </div>
      </div>

      {variant === "control" && bundle.parseWarnings.length > 0 && (
        <div className="warning-list">
          {bundle.parseWarnings.map((warning, index) => (
            <p key={`${warning.code}-${index}`}>
              {warning.code}: {warning.message}
            </p>
          ))}
        </div>
      )}

      <div className="render-bundle-layout">
        <div className="teleprompter-viewport">
          <div className="teleprompter-content" style={contentStyle}>
            {bundle.htmlTree.map((node) => (
              <RenderNodeView key={node.renderNodeId} node={node} />
            ))}
          </div>
        </div>

        <aside className="marker-index-panel">
          <p className="eyebrow">Marker Index</p>
          {bundle.markerIndex.length === 0 ? (
            <p className="muted">No markers</p>
          ) : (
            <div className="marker-index-list">
              {bundle.markerIndex.map((marker) => (
                <div className="marker-index-item" key={`${marker.markerId}-${marker.blockIndex}`}>
                  <strong>{marker.markerId}</strong>
                  <span>{marker.label ?? marker.type}</span>
                  {marker.note && <small>{marker.note}</small>}
                  <code>{marker.inline ? "inline" : "independent"}</code>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function ReadingText({ node }: { node: { text: string; inlines?: InlineRun[] } }) {
  // Display-only enrichment: when inline runs are present, paint them; otherwise
  // fall back to the flat spoken text. Both normalize to the same characters, so
  // the reading indicator maps identically on control and player (§12.5).
  return (
    <span data-reading-text>
      {node.inlines && node.inlines.length > 0 ? <InlineRuns runs={node.inlines} /> : node.text}
    </span>
  );
}

function InlineRuns({ runs }: { runs: InlineRun[] }) {
  return (
    <>
      {runs.map((run, index) => (
        <InlineRunView key={index} run={run} />
      ))}
    </>
  );
}

function InlineRunView({ run }: { run: InlineRun }) {
  switch (run.type) {
    case "text":
      return <>{run.text}</>;
    case "break":
      return <br />;
    case "inlineCode":
      return <code className="script-inline-code">{run.text}</code>;
    case "strong":
      return (
        <strong>
          <InlineRuns runs={run.children} />
        </strong>
      );
    case "emphasis":
      return (
        <em>
          <InlineRuns runs={run.children} />
        </em>
      );
    case "link":
      // Non-navigable on the stage; the href is kept as a title for reference.
      return (
        <span className="script-link" title={run.href}>
          <InlineRuns runs={run.children} />
        </span>
      );
  }
}

function RenderNodeView({ node }: { node: RenderNode }) {
  if (node.type === "heading") {
    const HeadingTag = `h${Math.min(Math.max(node.depth, 1), 3)}` as "h1" | "h2" | "h3";
    return (
      <HeadingTag className="script-heading" data-scroll-anchor-id={node.scrollAnchorId}>
        <ReadingText node={node} />
      </HeadingTag>
    );
  }

  if (node.type === "marker") {
    return (
      <div className="script-marker" data-scroll-anchor-id={node.scrollAnchorId} data-marker-id={node.marker.markerId}>
        <strong>
          ◆ {node.marker.markerId}
          {node.marker.label ? ` · ${node.marker.label}` : ""}
        </strong>
        {node.marker.note && <p>{node.marker.note}</p>}
      </div>
    );
  }

  if (node.type === "stageCue") {
    return (
      <div className="script-stage-cue">
        <span className="script-stage-cue-arrow" aria-hidden="true">
          ↳
        </span>
        <span>{cueText(node.cue)}</span>
        {node.body && <p>{node.body}</p>}
      </div>
    );
  }

  if (node.type === "thematicBreak") {
    return <hr className="script-rule" data-scroll-anchor-id={node.scrollAnchorId} />;
  }

  if (node.type === "code") {
    return (
      <pre className="script-code" data-scroll-anchor-id={node.scrollAnchorId}>
        <ReadingText node={node} />
      </pre>
    );
  }

  if (node.type === "blockquote") {
    return (
      <blockquote className="script-quote" data-scroll-anchor-id={node.scrollAnchorId}>
        <ReadingText node={node} />
      </blockquote>
    );
  }

  return (
    <p
      className={`${node.type === "listItem" ? "script-list-item" : "script-paragraph"}${
        node.type === "listItem" && node.ordered ? " is-ordered" : ""
      }`}
      data-scroll-anchor-id={node.scrollAnchorId}
    >
      {node.type === "listItem" && node.ordered && node.itemNumber != null && (
        <span className="list-item-marker" aria-hidden="true">
          {node.itemNumber}.{" "}
        </span>
      )}
      {node.inlineMarkers?.map((marker) => (
        <span className="inline-marker" data-marker-id={marker.markerId} key={marker.markerId}>
          ◆ {marker.markerId}
          {marker.label ? ` · ${marker.label}` : ""}
        </span>
      ))}
      <ReadingText node={node} />
      {node.cue && (
        <span className="bound-stage-cue">
          <span className="bound-stage-cue-arrow" aria-hidden="true">
            ↳
          </span>
          {cueText(node.cue)}
        </span>
      )}
    </p>
  );
}

function cueText(cue: { label?: string; cue?: string; level?: string; duration?: string }) {
  return [cue.label ?? cue.cue, cue.level, cue.duration].filter(Boolean).join(" · ");
}
