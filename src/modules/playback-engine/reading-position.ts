import type { DevicePresence } from "../../domain/room/types";
import type { RenderBundle } from '../script-engine/types';

// A position in spoken text, independent of font, wrapping, markers and mirrors.
export type ReadingPosition = { textOffset: number; lineEndOffset?: number; lineFraction?: number };
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
type CachedMap = { bundle: RenderBundle; chars: Array<Character | undefined>; units: Character[]; observer?: MutationObserver; dirty: boolean };
const maps = new WeakMap<HTMLElement, CachedMap>();
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
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
    for (const { segment, index } of segmenter.segment(node.textContent ?? '')) {
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
  cached = { bundle, chars, units, observer, dirty: false };
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
  const chars = readingMap(root, bundle);
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
  return { textOffset: start, lineEndOffset: end,
    lineFraction: Math.max(-0.5, Math.min(0.5, (y-best.rect.top-best.rect.height/2)/Math.max(1,best.rect.height))) * direction };
}
export function readingOffsetForPoint(root: HTMLElement, bundle: RenderBundle, node: Node, offset: number, point?: {x:number;y:number}) {
  if (!root.contains(node) || node.nodeType !== Node.TEXT_NODE || node.parentElement?.closest(excluded)) return undefined;
  const { chars, units } = mapped(root,bundle);
  const unit = point ? units.find(u => {
    if (u.node !== node || u.start > offset || u.end < offset) return false;
    return Array.from(rangeFor(u).getClientRects()).some(r=>point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom);
  }) : units.find(u => u.node === node && u.start <= offset && u.end > offset)
    ?? units.find(u => u.node === node && u.end === offset);
  if (!unit || !unit.node.textContent?.slice(unit.start,unit.end).trim()) return undefined;
  const index = units.indexOf(unit);
  let best: { offset: number; distance: number } | undefined;
  const indices = new Map(units.map((u,i)=>[u,i]));
  chars.forEach((char, textOffset) => {
    if (!char || char.block !== unit.block) return;
    const distance = Math.abs(indices.get(char)!-index);
    if (!best || distance < best.distance) best = { offset: textOffset, distance };
  });
  return best?.offset;
}
export function readingHighlight(root: HTMLElement, bundle: RenderBundle, start: number, end: number) {
  const {chars, units} = mapped(root,bundle);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > chars.length || chars.slice(start,end).some(c=>!c)) return undefined;
  let first = units.indexOf(chars[start]!), last = units.indexOf(chars[end-1]!);
  const spoken = new Set(chars);
  // shortcut: normalized ranges cannot disambiguate a wrapped edge emoji; phase 2 needs display boundaries.
  while (first > 0 && units[first-1].block === units[first].block && !spoken.has(units[first-1])) first--;
  while (last+1 < units.length && units[last+1].block === units[last].block && !spoken.has(units[last+1])) last++;
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
