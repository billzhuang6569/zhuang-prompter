import assert from "node:assert/strict";
import test from "node:test";
import { extensionSpecFixture, longTokenFixture, parseMarkdown, stripScriptDirectives } from ".";

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

test("long CJK paragraphs wrap normally without an unbreakable token warning", () => {
  const bundle = parseMarkdown(`这是一段没有空格但可以正常换行的中文文稿。`.repeat(12));

  assert.equal(bundle.speechIndex.length, 1);
  assert.ok(bundle.parseWarnings.every((warning) => warning.code !== "LONG_UNBREAKABLE_TOKEN"));
});

test("pasted markdown with marker and notes imports as teleprompter script", () => {
  const pastedMarkdown = `# 新房间导入测试

::marker[01]{text="开场"}

今天我们测试粘贴导入。

::notes{text="这里看镜头"}

第二段继续念。

:marker[02]{text="结尾"}
\u00a0

最后一句。`;

  const bundle = parseMarkdown(pastedMarkdown);

  assert.deepEqual(
    bundle.speechIndex.map((item) => item.rawText),
    ["新房间导入测试", "今天我们测试粘贴导入。", "第二段继续念。", "最后一句。"],
  );
  assert.deepEqual(
    bundle.markerIndex.map((marker) => marker.markerId),
    ["01", "02"],
  );
  assert.equal(bundle.parseWarnings.length, 0);
});

test("plain markdown export removes markers notes and legacy stage cues", () => {
  const markdown = `# 标题

::marker[01]{text="开场"}

第一段。:marker[02]{text="中间点"}继续。

::notes{text="这里看镜头"}

第二段。

::stage[pause]{label="停顿" duration="1s"}

第三段。`;

  assert.equal(
    stripScriptDirectives(markdown),
    `# 标题

第一段。继续。

第二段。

第三段。`,
  );
});

test("blank-line separated interview markdown stays as separate paragraphs", () => {
  const markdown = `**采访：**

作为国内领先的芯片 IP 设计与服务提供商，安谋科技锚定“AI Arm CHINA”战略发展方向。

此次，安谋科技携手火山引擎，将云端弹性算力引入芯片IP研发的关键流程。

此外，双方也在探索大模型调用和智能体等能力在办公运营场景中的应用。

**采访：安谋科技 Principal Engineer Jared Wang**

在芯片IP设计流程中，EDA 仿真和验证是非常关键的一环。`;

  const bundle = parseMarkdown(markdown);

  assert.deepEqual(
    bundle.htmlTree.flatMap((node) => (node.type === "paragraph" ? [node.text] : [])),
    [
      "采访：",
      "作为国内领先的芯片 IP 设计与服务提供商，安谋科技锚定“AI Arm CHINA”战略发展方向。",
      "此次，安谋科技携手火山引擎，将云端弹性算力引入芯片IP研发的关键流程。",
      "此外，双方也在探索大模型调用和智能体等能力在办公运营场景中的应用。",
      "采访：安谋科技 Principal Engineer Jared Wang",
      "在芯片IP设计流程中，EDA 仿真和验证是非常关键的一环。",
    ],
  );
});

test("single soft line breaks are preserved for rendering but normalized for speech", () => {
  const bundle = parseMarkdown(`文字1
文字2

文字3`);

  assert.deepEqual(
    bundle.htmlTree.flatMap((node) => (node.type === "paragraph" ? [node.text] : [])),
    ["文字1\n文字2", "文字3"],
  );
  assert.equal(bundle.speechIndex[0].normalizedText, "文字1 文字2");
});
