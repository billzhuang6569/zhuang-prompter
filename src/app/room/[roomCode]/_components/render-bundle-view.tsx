import type { CSSProperties } from "react";
import type { RenderBundle, RenderNode } from "@/modules/script-engine";

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

      {bundle.parseWarnings.length > 0 && (
        <div className="warning-list">
          {bundle.parseWarnings.map((warning, index) => (
            <p key={`${warning.code}-${index}`}>
              {warning.code}: {warning.message}
            </p>
          ))}
        </div>
      )}

      <div className="render-bundle-layout">
        <div className="teleprompter-content" style={contentStyle}>
          {bundle.htmlTree.map((node) => (
            <RenderNodeView key={node.renderNodeId} node={node} />
          ))}
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

function RenderNodeView({ node }: { node: RenderNode }) {
  if (node.type === "heading") {
    const HeadingTag = `h${Math.min(Math.max(node.depth, 1), 3)}` as "h1" | "h2" | "h3";
    return <HeadingTag className="script-heading">{node.text}</HeadingTag>;
  }

  if (node.type === "marker") {
    return (
      <div className="script-marker">
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
        <span>↳ {cueText(node.cue)}</span>
        {node.body && <p>{node.body}</p>}
      </div>
    );
  }

  return (
    <p className={node.type === "listItem" ? "script-list-item" : "script-paragraph"}>
      {node.inlineMarkers?.map((marker) => (
        <span className="inline-marker" key={marker.markerId}>
          ◆ {marker.markerId}
          {marker.label ? ` · ${marker.label}` : ""}
        </span>
      ))}
      {node.text}
      {node.cue && <span className="bound-stage-cue">↳ {cueText(node.cue)}</span>}
    </p>
  );
}

function cueText(cue: { label?: string; cue?: string; level?: string; duration?: string }) {
  return [cue.label ?? cue.cue, cue.level, cue.duration].filter(Boolean).join(" · ");
}
