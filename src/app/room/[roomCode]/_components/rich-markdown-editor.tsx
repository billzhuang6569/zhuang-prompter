"use client";

import dynamic from "next/dynamic";
import { forwardRef, useEffect, useRef, type ForwardedRef } from "react";
import type { MDXEditorMethods, MDXEditorProps } from "@mdxeditor/editor";

type RichMarkdownEditorProps = Omit<MDXEditorProps, "markdown" | "onChange"> & {
  markdown: string;
  onChange: (markdown: string) => void;
};

const ClientRichMarkdownEditor = dynamic(() => import("./initialized-rich-markdown-editor"), {
  ssr: false,
});

export const RichMarkdownEditor = forwardRef<MDXEditorMethods, RichMarkdownEditorProps>(function RichMarkdownEditor(
  { markdown, onChange, ...props },
  forwardedRef,
) {
  const localRef = useRef<MDXEditorMethods | null>(null);
  const lastMarkdownRef = useRef(markdown);

  useEffect(() => {
    const editor = localRef.current;
    if (!editor || markdown === lastMarkdownRef.current || markdown === editor.getMarkdown()) {
      return;
    }
    editor.setMarkdown(markdown);
    lastMarkdownRef.current = markdown;
  }, [markdown]);

  function setRefs(instance: MDXEditorMethods | null) {
    localRef.current = instance;
    if (typeof forwardedRef === "function") {
      forwardedRef(instance);
      return;
    }
    if (forwardedRef) {
      (forwardedRef as ForwardedRef<MDXEditorMethods> & { current: MDXEditorMethods | null }).current = instance;
    }
  }

  return (
    <ClientRichMarkdownEditor
      {...props}
      editorRef={setRefs}
      markdown={markdown}
      onChange={(nextMarkdown, initialMarkdownNormalize) => {
        lastMarkdownRef.current = nextMarkdown;
        if (!initialMarkdownNormalize) {
          onChange(nextMarkdown);
        }
      }}
    />
  );
});
