import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RenderBundleView } from "../../app/room/[roomCode]/_components/render-bundle-view";
import { parseMarkdown } from "./parse";

const bundleWithWarning = parseMarkdown(`https://example.com/${"a".repeat(100)}`);

test("player view never renders parser diagnostics", () => {
  assert.ok(bundleWithWarning.parseWarnings.some((warning) => warning.code === "LONG_UNBREAKABLE_TOKEN"));

  const markup = renderToStaticMarkup(<RenderBundleView bundle={bundleWithWarning} variant="player" />);

  assert.doesNotMatch(markup, /LONG_UNBREAKABLE_TOKEN/);
  assert.doesNotMatch(markup, /warning-list/);
});

test("control preview keeps actionable parser diagnostics", () => {
  const markup = renderToStaticMarkup(<RenderBundleView bundle={bundleWithWarning} variant="control" />);

  assert.match(markup, /LONG_UNBREAKABLE_TOKEN/);
  assert.match(markup, /warning-list/);
});

test("player paints inline emphasis inside the reading text (§12.5)", () => {
  const bundle = parseMarkdown("普通**加粗**和`代码`结束");
  const markup = renderToStaticMarkup(<RenderBundleView bundle={bundle} variant="player" />);

  assert.match(markup, /data-reading-text/);
  assert.match(markup, /<strong>加粗<\/strong>/);
  assert.match(markup, /script-inline-code/);
});

test("player and control render the same reading text for enriched paragraphs (§12.5)", () => {
  const bundle = parseMarkdown("这是**加粗**和*斜体*。");
  const strip = (variant: "player" | "control") => {
    const markup = renderToStaticMarkup(<RenderBundleView bundle={bundle} variant={variant} />);
    const match = markup.match(/data-reading-text[^>]*>([\s\S]*?)<\/span>/);
    return (match?.[1] ?? "").replace(/<[^>]+>/g, "");
  };

  assert.equal(strip("player"), strip("control"));
  assert.equal(strip("player"), "这是加粗和斜体。");
});

test("ordered list number renders outside the reading text (§12.5)", () => {
  const bundle = parseMarkdown("1. 甲\n2. 乙");
  const markup = renderToStaticMarkup(<RenderBundleView bundle={bundle} variant="player" />);

  assert.match(markup, /list-item-marker/);
  assert.match(markup, /is-ordered/);
  // The number sits in its own marker span, before the reading-text span.
  assert.match(markup, /list-item-marker[^>]*>1\.\s*<\/span>/);
});

test("player note cue keeps the accent arrow marker (§12.1)", () => {
  const bundle = parseMarkdown('口播。:notes{text="抬头看镜头"}继续。');
  const markup = renderToStaticMarkup(<RenderBundleView bundle={bundle} variant="player" />);

  assert.match(markup, /bound-stage-cue/);
  assert.match(markup, /bound-stage-cue-arrow/);
  assert.match(markup, /抬头看镜头/);
});

test("vertical mirroring uses a viewport layer without changing the playback offset", async () => {
  const markup = renderToStaticMarkup(
    <RenderBundleView bundle={bundleWithWarning} variant="player" playbackPositionPx={240} mirrorY />,
  );
  const stylesheet = await readFile("src/app/globals.css", "utf8");

  assert.match(markup, /is-mirrored-y/);
  assert.match(markup, /teleprompter-viewport/);
  assert.match(markup, /--playback-offset:240px/);
  assert.match(stylesheet, /\.player-stage\.is-mirrored-y \.teleprompter-viewport\s*{\s*transform: scaleY\(-1\);/);
  assert.doesNotMatch(stylesheet, /\.player-stage\.is-mirrored-y \.teleprompter-content/);
});
