import assert from "node:assert/strict";
import test from "node:test";
import {
  MARKER_PLACEHOLDER,
  NOTES_PLACEHOLDER,
  buildConvertedDirective,
  escapeDirectiveAttr,
  pendingEditorActionKey,
  renumberMarkerDirectives,
} from "./editing";
import { parseMarkdown } from ".";
import { normalizeReadingText } from "../playback-engine/reading-position";

// §3.3 契约：把源文中 [start,end) 选区替换为构建出的指令，
// 复刻 room-client sourceWithBlockInsertion 的块级替换语义，用于往返验证。
function replaceRange(source: string, start: number, end: number, replacement: string) {
  const prefix = start > 0 && !source.slice(0, start).endsWith("\n\n") ? "\n\n" : "";
  const suffix = end < source.length && !source.slice(end).startsWith("\n\n") ? "\n\n" : "";
  return `${source.slice(0, start)}${prefix}${replacement}${suffix}${source.slice(end)}`;
}

test("renumberMarkerDirectives assigns every marker a document-order number", () => {
  const markdown = [
    ':marker[01]{text="开场"}',
    "正文一",
    ':marker[01]{text="重复编号"}',
    ':marker[M099]{text="旧编号"}',
    ':marker[自定义]{text="文字编号"}',
  ].join("\n");

  assert.equal(
    renumberMarkerDirectives(markdown),
    [
      ':marker[01]{text="开场"}',
      "正文一",
      ':marker[02]{text="重复编号"}',
      ':marker[03]{text="旧编号"}',
      ':marker[04]{text="文字编号"}',
    ].join("\n"),
  );
});

test("renumberMarkerDirectives leaves fenced examples untouched", () => {
  const markdown = [
    ':marker[09]{text="正文标记"}',
    "```md",
    ':marker[99]{text="代码示例"}',
    "```",
    ':marker[09]{text="正文标记"}',
  ].join("\n");

  assert.equal(
    renumberMarkerDirectives(markdown),
    [
      ':marker[01]{text="正文标记"}',
      "```md",
      ':marker[99]{text="代码示例"}',
      "```",
      ':marker[02]{text="正文标记"}',
    ].join("\n"),
  );
});

test("escapeDirectiveAttr 折叠引号、反斜杠与多行空白为单行安全文本", () => {
  assert.equal(escapeDirectiveAttr('他说"稳住"'), "他说 稳住");
  assert.equal(escapeDirectiveAttr("第一行\n第二行\t结尾  "), "第一行 第二行 结尾");
  assert.equal(escapeDirectiveAttr("path\\to"), "path to");
  assert.equal(escapeDirectiveAttr("   "), "");
});

test("buildConvertedDirective 非空选区真正转换为标记说明并转义", () => {
  const built = buildConvertedDirective({
    kind: "marker",
    selectedText: '这里"停顿"一下\n继续',
    markerId: "03",
    pendingId: "pending_x",
  });
  assert.equal(built.converted, true);
  assert.equal(built.label, "这里 停顿 一下 继续");
  assert.equal(built.directive, ':marker[03]{text="这里 停顿 一下 继续" pending="pending_x"} ');
});

test("buildConvertedDirective 空选区退回占位插入", () => {
  const marker = buildConvertedDirective({ kind: "marker", selectedText: "   ", pendingId: "p1" });
  assert.equal(marker.converted, false);
  assert.equal(marker.label, MARKER_PLACEHOLDER);
  assert.equal(marker.directive, ':marker[01]{text="标记点" pending="p1"} ');

  const notes = buildConvertedDirective({ kind: "notes", selectedText: "", pendingId: "p2" });
  assert.equal(notes.converted, false);
  assert.equal(notes.label, NOTES_PLACEHOLDER);
  assert.equal(notes.directive, ':notes{text="提示内容" pending="p2"} ');
});

test("选区转注释后原文本移出朗读与语音索引（真正转换）", () => {
  const source = "开场白提醒观众看镜头。正片开始。";
  const start = source.indexOf("提醒观众看镜头");
  const end = start + "提醒观众看镜头".length;
  const { directive } = buildConvertedDirective({
    kind: "notes",
    selectedText: source.slice(start, end),
    pendingId: "pending_note",
  });
  const nextSource = replaceRange(source, start, end, directive);

  const bundle = parseMarkdown(nextSource);
  const speechText = bundle.speechIndex.map((item) => item.rawText).join("");
  // 被转换的文字不再出现在任何朗读段落里。
  assert.ok(!speechText.includes("提醒观众看镜头"));
  assert.ok(speechText.includes("开场白"));
  assert.ok(speechText.includes("正片开始"));
});

test("选区转标记：标签文字不进入朗读索引，仅保留跳转锚点", () => {
  const source = "第一段正文。重点一句在此。第三段收尾。";
  const start = source.indexOf("重点一句在此");
  const end = start + "重点一句在此".length;
  const { directive, label } = buildConvertedDirective({
    kind: "marker",
    selectedText: source.slice(start, end),
    markerId: "01",
    pendingId: "pending_marker",
  });
  const nextSource = renumberMarkerDirectives(replaceRange(source, start, end, directive));

  const bundle = parseMarkdown(nextSource);
  const normalizedSpeech = bundle.speechIndex.map((item) => item.normalizedText).join("");
  // 标记标签（原选区文字）不得进入规范化朗读索引。
  assert.ok(!normalizedSpeech.includes(normalizeReadingText(label)));
  // 但标记锚点必须保留，供跳转使用。
  assert.equal(bundle.markerIndex.length, 1);
});

test("pendingEditorActionKey stays stable while the same input value changes", () => {
  const firstValue = {
    kind: "notes" as const,
    pendingId: "pending_1",
    value: "甲",
  };
  const secondValue = { ...firstValue, value: "甲乙" };

  assert.equal(pendingEditorActionKey(firstValue), pendingEditorActionKey(secondValue));
  assert.notEqual(pendingEditorActionKey(firstValue), pendingEditorActionKey({ ...secondValue, pendingId: "pending_2" }));
});

test("pendingEditorActionKey identifies edits to existing directives", () => {
  const firstValue = {
    kind: "marker" as const,
    value: "开场",
    editTarget: { markerId: "01", occurrence: 0 },
  };
  const secondValue = { ...firstValue, value: "开场重录" };

  assert.equal(pendingEditorActionKey(firstValue), pendingEditorActionKey(secondValue));
  assert.notEqual(
    pendingEditorActionKey(firstValue),
    pendingEditorActionKey({ ...secondValue, editTarget: { markerId: "02", occurrence: 1 } }),
  );
});
