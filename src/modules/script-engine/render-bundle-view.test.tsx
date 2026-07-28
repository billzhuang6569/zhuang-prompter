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
