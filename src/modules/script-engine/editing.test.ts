import assert from "node:assert/strict";
import test from "node:test";
import { pendingEditorActionKey, renumberMarkerDirectives } from "./editing";

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
