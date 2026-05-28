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
  attributes: ["type", "label", "note", "pending"],
  hasChildren: false,
  type: "leafDirective",
  Editor: MarkerDirectiveEditor,
};

const stageDirectiveDescriptor: DirectiveDescriptor = {
  name: "stage",
  testNode: (node) => node.name === "stage" || node.name === "stageCue",
  attributes: ["cue", "label", "level", "duration", "pending"],
  hasChildren: false,
  Editor: StageDirectiveEditor,
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
        directivesPlugin({ directiveDescriptors: [markerDirectiveDescriptor, stageDirectiveDescriptor] }),
        markdownShortcutPlugin(),
      ]}
    />
  );
}

function MarkerDirectiveEditor({ mdastNode }: DirectiveEditorProps) {
  const node = mdastNode as DirectiveNodeLike;
  const attributes = directiveAttributes(node);
  const markerId = directiveLabel(node) || "M000";
  const label = stringValue(attributes.label);
  return (
    <span className="nike-mtag nike-mdx-directive" contentEditable={false}>
      <span className="nike-dot-mini" />
      {markerId}
      {label ? ` · ${label}` : ""}
    </span>
  );
}

function StageDirectiveEditor({ mdastNode }: DirectiveEditorProps) {
  const node = mdastNode as DirectiveNodeLike;
  const attributes = directiveAttributes(node);
  const label = stringValue(attributes.label) || stringValue(attributes.cue) || directiveLabel(node) || "注释";
  const level = stringValue(attributes.level);
  const duration = stringValue(attributes.duration);
  return (
    <span className="nike-scue nike-mdx-directive" contentEditable={false}>
      <span className="nike-scue-arrow">↳</span>
      {[label, levelLabel(level), duration].filter(Boolean).join(" · ")}
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

function levelLabel(value: string) {
  const labels: Record<string, string> = {
    important: "重点",
    warning: "注意",
    soft: "轻声",
  };
  return labels[value] ?? value;
}
