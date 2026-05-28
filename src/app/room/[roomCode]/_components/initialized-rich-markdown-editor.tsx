"use client";

import {
  MDXEditor,
  codeBlockPlugin,
  directivesPlugin,
  headingsPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  type DirectiveDescriptor,
  type DirectiveEditorProps,
  type MDXEditorMethods,
  type MDXEditorProps,
} from "@mdxeditor/editor";
import type { ForwardedRef } from "react";

type DirectiveNodeLike = {
  name?: string;
  label?: string;
  value?: string;
  children?: DirectiveNodeLike[];
  attributes?: Record<string, unknown> | null;
};

type InitializedRichMarkdownEditorProps = {
  editorRef: ForwardedRef<MDXEditorMethods>;
} & MDXEditorProps;

const markerDirectiveDescriptor: DirectiveDescriptor = {
  name: "marker",
  testNode: (node) => node.name === "marker",
  attributes: ["text", "pending"],
  hasChildren: false,
  type: "leafDirective",
  Editor: MarkerDirectiveEditor,
};

const notesDirectiveDescriptor: DirectiveDescriptor = {
  name: "notes",
  testNode: (node) => node.name === "notes" || node.name === "stage" || node.name === "stageCue",
  attributes: ["text", "pending"],
  hasChildren: false,
  type: "leafDirective",
  Editor: NotesDirectiveEditor,
};

export default function InitializedRichMarkdownEditor({ editorRef, ...props }: InitializedRichMarkdownEditorProps) {
  return (
    <MDXEditor
      {...props}
      ref={editorRef}
      plugins={[
        headingsPlugin(),
        listsPlugin(),
        quotePlugin(),
        thematicBreakPlugin(),
        linkPlugin(),
        tablePlugin(),
        codeBlockPlugin(),
        directivesPlugin({ directiveDescriptors: [markerDirectiveDescriptor, notesDirectiveDescriptor] }),
        markdownShortcutPlugin(),
      ]}
    />
  );
}

function MarkerDirectiveEditor({ mdastNode }: DirectiveEditorProps) {
  const node = mdastNode as DirectiveNodeLike;
  const attributes = directiveAttributes(node);
  const markerId = directiveLabel(node) || "00";
  const text = stringValue(attributes.text) || stringValue(attributes.label);
  return (
    <span
      className="nike-mtag nike-mdx-directive"
      contentEditable={false}
      data-directive-kind="marker"
      data-marker-id={markerId}
      data-directive-text={text}
      title="双击编辑标记"
    >
      <span className="nike-dot-mini" />
      {markerId}
      {text ? ` · ${text}` : ""}
    </span>
  );
}

function NotesDirectiveEditor({ mdastNode }: DirectiveEditorProps) {
  const node = mdastNode as DirectiveNodeLike;
  const attributes = directiveAttributes(node);
  const text = stringValue(attributes.text) || stringValue(attributes.label) || stringValue(attributes.cue) || directiveLabel(node) || "提示内容";
  return (
    <span
      className="nike-scue nike-mdx-directive"
      contentEditable={false}
      data-directive-kind="notes"
      data-directive-text={text}
      title="双击编辑注释"
    >
      <span className="nike-scue-arrow">↳</span>
      {text}
    </span>
  );
}

function directiveAttributes(node: DirectiveNodeLike) {
  return (node.attributes ?? {}) as Record<string, unknown>;
}

function directiveLabel(node: DirectiveNodeLike): string {
  if (typeof node.label === "string") {
    return node.label;
  }
  if (typeof node.value === "string") {
    return node.value;
  }
  return (node.children ?? []).map(directiveLabel).join("").trim();
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}
