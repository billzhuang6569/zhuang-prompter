import assert from "node:assert/strict";
import test from "node:test";
import { extensionSpecFixture, longTokenFixture, parseMarkdown } from ".";

test("extracts speech and indexes from the full extension fixture", () => {
  const bundle = parseMarkdown(extensionSpecFixture, { scriptVersionId: "ver_fixture" });

  assert.equal(bundle.markerIndex.length, 3);
  assert.ok(bundle.speechIndex.some((item) => item.rawText.includes("AI 到底是在猜")));
  assert.ok(bundle.speechIndex.some((item) => item.rawText === "这就是我们今天要拆开的核心问题。"));
  assert.ok(!bundle.speechIndex.some((item) => item.rawText.includes("切演示画面")));
  assert.ok(!bundle.speechIndex.some((item) => item.rawText.includes("重录点")));
  assert.ok(
    bundle.speechIndex.every((item) =>
      bundle.scrollAnchorIndex.some((anchor) => anchor.anchorId === item.scrollAnchorId),
    ),
  );
});

test("notes do not enter speech index", () => {
  const bundle = parseMarkdown('口播一句。\n::notes{text="这里抬一下头"}\n继续口播。');

  assert.deepEqual(
    bundle.speechIndex.map((item) => item.rawText),
    ["口播一句。", "继续口播。"],
  );
  assert.equal(bundle.htmlTree[1].type, "stageCue");
});

test("legacy stage cues still do not enter speech index", () => {
  const bundle = parseMarkdown(`今天开始。
::stage[pause]{label="停顿"}
继续口播。`);

  assert.deepEqual(
    bundle.speechIndex.map((item) => item.rawText),
    ["今天开始。", "继续口播。"],
  );
});

test("notes directive is accepted for editor inserted comments", () => {
  const bundle = parseMarkdown('::notes{text="给拍摄或后期看的提示"}');

  assert.equal(bundle.parseWarnings.length, 0);
  assert.equal(bundle.htmlTree[0].type, "stageCue");
});

test("inline notes directive is accepted for rich editor comments", () => {
  const bundle = parseMarkdown('口播前。:notes{text="给拍摄或后期看的提示"}继续。');

  assert.equal(bundle.parseWarnings.length, 0);
  assert.ok(bundle.htmlTree.some((node) => node.type === "paragraph" && node.cue?.text === "给拍摄或后期看的提示"));
  assert.ok(!bundle.speechIndex.some((item) => item.rawText.includes("给拍摄或后期看的提示")));
});

test("duplicate marker id creates parse warning", () => {
  const bundle = parseMarkdown(`::marker[01]{text="开场"}
::marker[01]{text="重录"}`);

  assert.equal(bundle.markerIndex.length, 2);
  assert.ok(bundle.parseWarnings.some((warning) => warning.code === "DUPLICATE_MARKER_ID"));
});

test("inline marker enters marker index without entering speech", () => {
  const bundle = parseMarkdown('第一段。:marker[02]{text="跳段点"}继续说。');

  assert.equal(bundle.markerIndex.length, 1);
  assert.equal(bundle.markerIndex[0].inline, true);
  assert.equal(bundle.markerIndex[0].markerId, "02");
  assert.ok(!bundle.speechIndex.some((item) => item.rawText.includes("跳段点")));
});

test("line marker renders as an independent marker block", () => {
  const bundle = parseMarkdown('第一段。\n:marker[02]{text="跳段点"}\u00A0\n继续说。');

  assert.equal(bundle.markerIndex.length, 1);
  assert.equal(bundle.markerIndex[0].inline, false);
  assert.deepEqual(
    bundle.htmlTree.map((node) => node.type),
    ["paragraph", "marker", "paragraph"],
  );
});

test("unsupported directive becomes parse warning", () => {
  const bundle = parseMarkdown("::unknown[test]{label=\"nope\"}");

  assert.ok(bundle.parseWarnings.some((warning) => warning.code === "INVALID_EXTENSION_SYNTAX"));
});

test("headings paragraphs lists and no-marker scripts still produce anchors", () => {
  const bundle = parseMarkdown(`# 标题
第一段。
- 第一条
- second item`);

  assert.equal(bundle.markerIndex.length, 0);
  assert.equal(bundle.speechIndex.length, 4);
  assert.ok(bundle.speechIndex.every((item) => item.textHash.length === 12));
});

test("long tokens produce warning but remain speech", () => {
  const bundle = parseMarkdown(longTokenFixture);

  assert.equal(bundle.speechIndex.length, 1);
  assert.ok(bundle.parseWarnings.some((warning) => warning.code === "LONG_UNBREAKABLE_TOKEN"));
});
