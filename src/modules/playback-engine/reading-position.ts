import type { DevicePresence } from "../../domain/room/types";
import type { RenderBundle } from '../script-engine/types';

// A position in spoken text, independent of font, wrapping, markers and mirrors.
export type ReadingPosition = { textOffset: number; lineFraction?: number };
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

type Character = { node: Text; start: number; end: number };
type TextMap = { text: string; chars: Character[] };
function textMap(root: HTMLElement): TextMap {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const chars: Character[] = [];
  let text = '';
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest('[data-directive-kind], .script-marker, .inline-marker, .bound-stage-cue, .script-stage-cue')) continue;
    let index = 0;
    for (const value of node.textContent ?? '') {
      const normalized = normalizeReadingText(value);
      text += normalized;
      for (let i = 0; i < normalized.length; i++) chars.push({ node: node as Text, start: index, end: index + value.length });
      index += value.length;
    }
  }
  return { text, chars };
}
function rectFor(char: Character) {
  const range = document.createRange();
  range.setStart(char.node, char.start);
  range.setEnd(char.node, char.end);
  return range.getBoundingClientRect();
}
// The editor has decorations absent from the player. Match spoken runs in order,
// never use the editor's total height or include directive labels in the offset.
export function readingMap(root: HTMLElement, bundle: RenderBundle) {
  const blocks = readingBlocks(bundle);
  const map = textMap(root);
  let cursor = 0;
  const chars: Array<Character | undefined> = [];
  for (const block of blocks) {
    const found = map.text.indexOf(block.text, cursor);
    if (found < 0 || !block.text) continue;
    for (let i = 0; i < block.text.length; i++) chars[block.start + i] = map.chars[found + i];
    cursor = found + block.text.length;
  }
  return chars;
}
export function readingY(root: HTMLElement, bundle: RenderBundle, position: ReadingPosition): number | undefined {
  const chars = readingMap(root, bundle);
  const char = chars[Math.max(0, Math.min(chars.length - 1, Math.floor(position.textOffset)))];
  if (!char) return undefined;
  const rect = rectFor(char);
  return rect.top + rect.height / 2 + (position.lineFraction ?? 0) * rect.height;
}
export function readingAtY(root: HTMLElement, bundle: RenderBundle, y: number, mirroredY = false): ReadingPosition | undefined {
  const chars = readingMap(root, bundle);
  // Binary search by visual line, reversing the comparison for a vertical mirror.
  const direction = mirroredY ? -1 : 1;
  let low = 0, high = chars.length - 1;
  let best: { index: number; distance: number; center: number; height: number } | undefined;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const char = chars[mid];
    if (!char) return undefined; // Unsaved editor text cannot be mapped honestly.
    const rect = rectFor(char);
    const center = rect.top + rect.height / 2;
    const distance = Math.abs(center - y);
    if (!best || distance < best.distance || (distance === best.distance && mid < best.index)) best = { index: mid, distance, center, height: rect.height };
    if ((center - y) * direction < 0) low = mid + 1;
    else high = mid - 1;
  }
  if (best) {
    // A whole visual line is one reading location. Always report its logical
    // first character, including while the center passes through that line.
    let left = 0, right = best.index;
    while (left < right) {
      const mid = (left + right) >>> 1;
      const char = chars[mid];
      if (!char) break;
      const rect = rectFor(char);
      if ((rect.top + rect.height / 2 - best.center) * direction < -0.5) left = mid + 1;
      else right = mid;
    }
    best.index = left;
  }
  return best ? { textOffset: best.index, lineFraction: Math.max(-0.5, Math.min(0.5, (y - best.center) / Math.max(1, best.height))) * direction } : undefined;
}
export function offsetForReadingY(offset: number, y: number, viewportHeight: number, mirrorY: boolean) {
  return Math.max(0, offset + (y - viewportHeight / 2) * (mirrorY ? -1 : 1));
}

export function effectivePrimary(devices: Record<string, DevicePresence>, preferred: string | null) {
  const online = Object.values(devices).filter(device => device.role === 'player' && device.online && device.connectionState !== 'offline');
  return online.find(device => device.deviceId === preferred) ?? online.sort((a, b) => a.deviceId.localeCompare(b.deviceId))[0];
}
