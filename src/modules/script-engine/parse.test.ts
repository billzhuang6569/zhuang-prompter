import assert from "node:assert/strict";
import test from "node:test";
import { extensionSpecFixture, longTokenFixture, parseMarkdown } from ".";

test("extracts speech and indexes from the full extension fixture", () => {
  const bundle = parseMarkdown(extensionSpecFixture, { scriptVersionId: "ver_fixture" });

  assert.equal(bundle.markerIndex.length, 3);
  assert.ok(bundle.speechIndex.some((item) => item.rawText.includes("AI 到底是在猜")));
  assert.ok(bundle.speechIndex.some((item) => item.rawText === "但问题是，它真的理解重力吗？"));
  assert.ok(!bundle.speechIndex.some((item) => item.rawText.includes("切演示画面")));
  assert.ok(!bundle.speechIndex.some((item) => item.rawText.includes("重录点")));
  assert.ok(
    bundle.speechIndex.every((item) =>
      bundle.scrollAnchorIndex.some((anchor) => anchor.anchorId === item.scrollAnchorId),
    ),
  );
});

test("bound stage contributes bracket text only", () => {
  const bundle = parseMarkdown(':stage[这句话要说出来]{cue="look-camera" label="看镜头"}');

  assert.equal(bundle.speechIndex.length, 1);
  assert.equal(bundle.speechIndex[0].rawText, "这句话要说出来");
  assert.ok(!bundle.speechIndex[0].rawText.includes("看镜头"));
  assert.equal(bundle.htmlTree[0].type, "paragraph");
});

test("standalone and block stage cues do not enter speech index", () => {
  const bundle = parseMarkdown(`今天开始。
::stage[pause]{label="停顿"}
:::stage{label="导演提示"}
这里不是口播。
:::
继续口播。`);

  assert.deepEqual(
    bundle.speechIndex.map((item) => item.rawText),
    ["今天开始。", "继续口播。"],
  );
});

test("stageCue alias is accepted for editor inserted comments", () => {
  const bundle = parseMarkdown('::stageCue[注释]{cue="给拍摄或后期看的提示"}');

  assert.equal(bundle.parseWarnings.length, 0);
  assert.equal(bundle.htmlTree[0].type, "stageCue");
});

test("duplicate marker id creates parse warning", () => {
  const bundle = parseMarkdown(`::marker[M001]{type="section" label="开场"}
::marker[M001]{type="retake" label="重录"}`);

  assert.equal(bundle.markerIndex.length, 2);
  assert.ok(bundle.parseWarnings.some((warning) => warning.code === "DUPLICATE_MARKER_ID"));
});

test("inline marker enters marker index without entering speech", () => {
  const bundle = parseMarkdown('第一段。:marker[M002]{type="jump" label="跳段点"}继续说。');

  assert.equal(bundle.markerIndex.length, 1);
  assert.equal(bundle.markerIndex[0].inline, true);
  assert.equal(bundle.markerIndex[0].markerId, "M002");
  assert.ok(!bundle.speechIndex.some((item) => item.rawText.includes("跳段点")));
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
