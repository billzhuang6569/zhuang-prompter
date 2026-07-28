import remarkDirective from "remark-directive";
import remarkParse from "remark-parse";
import { unified } from "unified";

type MarkdownNode = {
  type: string;
  name?: string;
  children?: MarkdownNode[];
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
};

const processor = unified().use(remarkParse).use(remarkDirective);
const STRIPPED_DIRECTIVES = new Set(["marker", "notes", "stage", "stageCue"]);

export function stripScriptDirectives(markdown: string) {
  const tree = processor.parse(markdown) as MarkdownNode;
  const ranges: Array<{ start: number; end: number }> = [];

  collectDirectiveRanges(tree, markdown, ranges);
  if (ranges.length === 0) {
    return markdown.trimEnd();
  }

  let output = markdown;
  for (const range of mergeRanges(ranges).sort((a, b) => b.start - a.start)) {
    output = `${output.slice(0, range.start)}${output.slice(range.end)}`;
  }

  return output
    .replace(/[ \t\u00a0]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function collectDirectiveRanges(node: MarkdownNode, markdown: string, ranges: Array<{ start: number; end: number }>) {
  if (isStrippedDirective(node)) {
    const start = node.position?.start?.offset;
    const end = node.position?.end?.offset;
    if (typeof start === "number" && typeof end === "number" && end >= start) {
      ranges.push(expandDirectiveRemovalRange(markdown, start, end));
    }
  }

  for (const child of node.children ?? []) {
    collectDirectiveRanges(child, markdown, ranges);
  }
}

function isStrippedDirective(node: MarkdownNode) {
  return (
    (node.type === "textDirective" || node.type === "leafDirective" || node.type === "containerDirective") &&
    typeof node.name === "string" &&
    STRIPPED_DIRECTIVES.has(node.name)
  );
}

function expandDirectiveRemovalRange(markdown: string, start: number, end: number) {
  const lineStart = markdown.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextLineBreak = markdown.indexOf("\n", end);
  const lineEnd = nextLineBreak === -1 ? markdown.length : nextLineBreak + 1;
  const fullLine = markdown.slice(lineStart, lineEnd).replace(/[\u200b\u00a0]/g, "").trim();
  const directiveText = markdown.slice(start, end).replace(/[\u200b\u00a0]/g, "").trim();

  if (fullLine === directiveText && directiveText.startsWith(":")) {
    return {
      start: lineStart > 0 ? lineStart - 1 : lineStart,
      end: lineEnd,
    };
  }

  return { start, end };
}

function mergeRanges(ranges: Array<{ start: number; end: number }>) {
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (!last || range.start > last.end) {
      merged.push({ ...range });
      continue;
    }
    last.end = Math.max(last.end, range.end);
  }
  return merged;
}
