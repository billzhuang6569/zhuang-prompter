import type { DevicePresence } from "../../domain/room/types";
import type { RenderBundle } from '../script-engine/types';

// A position in spoken text, independent of font, wrapping, markers and mirrors.
export type ReadingPosition = { textOffset: number; lineEndOffset?: number; lineLeadingExtra?: number; lineTrailingExtra?: number; lineFraction?: number };
export function normalizeReadingText(text: string) {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
export function readingBlocks(bundle: RenderBundle) {
  let start = 0;
  return bundle.htmlTree.flatMap(node => {
    if (!('text' in node) || !('scrollAnchorId' in node)) return [];
    const text = normalizeReadingText(node.text);
    const block = { text, start, anchorId: node.scrollAnchorId };
    start += text.length;
    return [block];
  });
}

type Character = { node: Text; start: number; end: number; block: Element | null };
const excluded = '[data-directive-kind], .script-marker, .inline-marker, .bound-stage-cue, .script-stage-cue, .list-item-marker';
type CachedMap = { bundle: RenderBundle; chars: Array<Character | undefined>; units: Character[]; indices: Map<Character, number>; spoken: Set<Character | undefined>; observer?: MutationObserver; dirty: boolean };
const maps = new WeakMap<HTMLElement, CachedMap>();
let segmenter: Intl.Segmenter | undefined;
export function readingGraphemes(text: string) {
  if (typeof Intl.Segmenter !== 'undefined') {
    segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), ({ segment, index }) => ({ segment, index }));
  }
  let index = 0;
  return Array.from(text, segment => {
    const unit = { segment, index };
    index += segment.length;
    return unit;
  });
}
export function releaseReadingMap(root: HTMLElement) {
  maps.get(root)?.observer?.disconnect();
  maps.delete(root);
}
function mapped(root: HTMLElement, bundle: RenderBundle): CachedMap {
  let cached = maps.get(root);
  if (cached?.observer?.takeRecords().length) cached.dirty = true;
  if (cached && cached.bundle === bundle && !cached.dirty) return cached;
  const observer = cached?.observer ?? (typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(() => {
    const current = maps.get(root);
    if (current) current.dirty = true;
  }));
  if (!cached) observer?.observe(root, { childList: true, subtree: true, characterData: true });
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const units: Character[] = [], source: Character[] = [];
  let text = '', node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest(excluded)) continue;
    for (const { segment, index } of readingGraphemes(node.textContent ?? '')) {
      const unit = { node: node as Text, start: index, end: index + segment.length,
        block: node.parentElement?.closest('p,h1,h2,h3,h4,h5,h6,li,pre,blockquote,[data-reading-text]') ?? null };
      units.push(unit);
      const normalized = normalizeReadingText(segment);
      text += normalized;
      for (let i = 0; i < normalized.length; i++) source.push(unit);
    }
  }
  let cursor = 0;
  const chars: Array<Character | undefined> = [];
  for (const block of readingBlocks(bundle)) {
    const found = text.indexOf(block.text, cursor);
    for (let i = 0; i < block.text.length; i++) chars[block.start + i] = found < 0 ? undefined : source[found + i];
    if (found >= 0) cursor = found + block.text.length;
  }
  cached = { bundle, chars, units, indices: new Map(units.map((unit, index) => [unit, index])), spoken: new Set(chars), observer, dirty: false };
  maps.set(root, cached);
  return cached;
}
export function readingMap(root: HTMLElement, bundle: RenderBundle) { return mapped(root, bundle).chars; }
function rangeFor(char: Character) {
  const range = document.createRange();
  range.setStart(char.node, char.start);
  range.setEnd(char.node, char.end);
  return range;
}
function rectFor(char: Character) { return rangeFor(char).getBoundingClientRect(); }
export function readingY(root: HTMLElement, bundle: RenderBundle, position: ReadingPosition): number | undefined {
  const chars = readingMap(root, bundle);
  const char = chars[Math.max(0, Math.min(chars.length - 1, Math.floor(position.textOffset)))];
  if (!char) return undefined;
  const rect = rectFor(char);
  return rect.top + rect.height / 2 + (position.lineFraction ?? 0) * rect.height;
}
function overlaps(a: {top:number; height:number}, b: {top:number; height:number}) {
  return Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top) > Math.min(a.height,b.height) * 0.35;
}
export function readingAtY(root: HTMLElement, bundle: RenderBundle, y: number, mirroredY = false): ReadingPosition | undefined {
  const { chars, units, indices, spoken } = mapped(root, bundle);
  const direction = mirroredY ? -1 : 1;
  let low = 0, high = chars.length - 1;
  let best: { index: number; distance: number; rect: DOMRect } | undefined;
  while (low <= high) {
    const mid = (low + high) >>> 1, char = chars[mid];
    if (!char) return undefined;
    const rect = rectFor(char), center = rect.top + rect.height / 2;
    const distance = Math.max(rect.top - y, y - rect.bottom, 0);
    // rect.bottom is absent in the lightweight geometry test double.
    const stableDistance = Number.isFinite(distance) ? distance : Math.abs(center-y);
    if (!best || stableDistance < best.distance || (stableDistance === best.distance && mid < best.index)) best = { index: mid, distance: stableDistance, rect };
    if ((center-y)*direction < 0) low = mid+1; else high = mid-1;
  }
  if (!best) return undefined;
  let start = best.index, end = best.index+1;
  while (start > 0 && chars[start-1] && overlaps(rectFor(chars[start-1]!), best.rect)) start--;
  while (end < chars.length && chars[end] && overlaps(rectFor(chars[end]!), best.rect)) end++;
  const first = indices.get(chars[start]!)!, last = indices.get(chars[end-1]!)!;
  let lineLeadingExtra = 0, lineTrailingExtra = 0;
  while (lineLeadingExtra < 64 && first-lineLeadingExtra > 0) {
    const unit = units[first-lineLeadingExtra-1];
    if (unit.block !== units[first].block || spoken.has(unit) || !overlaps(rectFor(unit), best.rect)) break;
    lineLeadingExtra++;
  }
  while (lineTrailingExtra < 64 && last+lineTrailingExtra+1 < units.length) {
    const unit = units[last+lineTrailingExtra+1];
    if (unit.block !== units[last].block || spoken.has(unit) || !overlaps(rectFor(unit), best.rect)) break;
    lineTrailingExtra++;
  }
  // shortcut: pure non-spoken rows use the nearest spoken row; add display anchors if those must be addressable.
  return { textOffset: start, lineEndOffset: end, lineLeadingExtra, lineTrailingExtra,
    lineFraction: Math.max(-0.5, Math.min(0.5, (y-best.rect.top-best.rect.height/2)/Math.max(1,best.rect.height))) * direction };
}
export function readingOffsetForPoint(root: HTMLElement, bundle: RenderBundle, node: Node, offset: number, point?: {x:number;y:number}) {
  if (!root.contains(node) || node.nodeType !== Node.TEXT_NODE || node.parentElement?.closest(excluded)) return undefined;
  const { chars, units, indices } = mapped(root,bundle);
  const unit = point ? units.find(u => {
    if (u.node !== node || u.start > offset || u.end < offset) return false;
    return Array.from(rangeFor(u).getClientRects()).some(r=>point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom);
  }) : units.find(u => u.node === node && u.start <= offset && u.end > offset)
    ?? units.find(u => u.node === node && u.end === offset);
  if (!unit || !unit.node.textContent?.slice(unit.start,unit.end).trim()) return undefined;
  const index = indices.get(unit)!;
  const unitRect = rectFor(unit);
  let best: { offset: number; distance: number; sameLine: boolean } | undefined;
  chars.forEach((char, textOffset) => {
    if (!char || char.block !== unit.block) return;
    const distance = Math.abs(indices.get(char)!-index);
    const sameLine = overlaps(rectFor(char), unitRect);
    if (!best || (sameLine && !best.sameLine) || (sameLine === best.sameLine && distance < best.distance)) best = { offset: textOffset, distance, sameLine };
  });
  return best?.offset;
}
export function readingHighlight(root: HTMLElement, bundle: RenderBundle, start: number, end: number, lineLeadingExtra?: number, lineTrailingExtra?: number) {
  const {chars, units, indices, spoken} = mapped(root,bundle);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > chars.length || chars.slice(start,end).some(c=>!c)) return undefined;
  let first = indices.get(chars[start]!)!, last = indices.get(chars[end-1]!)!;
  const leadingLimit = lineLeadingExtra ?? Infinity, trailingLimit = lineTrailingExtra ?? Infinity;
  let leading = 0, trailing = 0;
  while (leading < leadingLimit && first > 0 && units[first-1].block === units[first].block && !spoken.has(units[first-1])) { first--; leading++; }
  while (trailing < trailingLimit && last+1 < units.length && units[last+1].block === units[last].block && !spoken.has(units[last+1])) { last++; trailing++; }
  const rects: DOMRect[] = [], lines: Array<{rect:DOMRect; count:number}> = [];
  for (const unit of units.slice(first,last+1)) {
    for (const rect of Array.from(rangeFor(unit).getClientRects())) {
      if (!rect.width || !rect.height) continue;
      rects.push(rect);
      const line = lines.find(l=>overlaps(l.rect,rect));
      if (line) line.count++; else lines.push({rect,count:1});
    }
  }
  const majority = lines.reduce<(typeof lines)[number] | undefined>((best,line)=>!best || line.count > best.count ? line : best, undefined);
  return majority ? {rects, guideY:majority.rect.top+majority.rect.height/2} : undefined;
}
export function offsetForReadingY(offset: number, y: number, viewportHeight: number, mirrorY: boolean) {
  return Math.max(0, offset + (y - viewportHeight / 2) * (mirrorY ? -1 : 1));
}

export function effectivePrimary(devices: Record<string, DevicePresence>, preferred: string | null) {
  const online = Object.values(devices).filter(device => device.role === 'player' && device.online && device.connectionState !== 'offline');
  return online.find(device => device.deviceId === preferred) ?? online.sort((a, b) => a.deviceId.localeCompare(b.deviceId))[0];
}

export function reanchorReadingText(previousLine: string, bundle: RenderBundle) {
  const needle = normalizeReadingText(previousLine).slice(0, 24);
  if (!needle) return undefined;
  const text = readingBlocks(bundle).map(block => block.text).join('');
  const index = text.indexOf(needle);
  return index >= 0 && text.indexOf(needle, index + 1) < 0 ? index : undefined;
}
