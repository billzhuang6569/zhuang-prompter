import type { RenderBundle } from '../script-engine/types';
import { normalizeReadingText, readingBlocks } from '../playback-engine/reading-position';

// Match a recent, ordered suffix near the reading head. Common isolated words
// and distant repetitions must never seek the whole script backwards.
export function matchVoice(text: string, bundle: RenderBundle, currentOffset: number, asrConfidence: number) {
  const blocks = readingBlocks(bundle);
  const script = blocks.map(block => block.text).join('');
  const needle = normalizeReadingText(text).slice(-48);
  if (needle.length < 4) return undefined;
  const start = Math.max(0, Math.floor(currentOffset) - 100);
  const end = Math.min(script.length, Math.floor(currentOffset) + 500);
  let best: { targetTextOffset: number; confidence: number; block: typeof blocks[number] } | undefined;
  for (let length = needle.length; length >= Math.max(4, Math.ceil(needle.length * 0.6)); length--) {
    const suffix = needle.slice(-length);
    let from = start;
    while (from < end) {
      const index = script.indexOf(suffix, from);
      if (index < 0 || index >= end) break;
      const target = Math.min(script.length - 1, index + length);
      const block = [...blocks].reverse().find(block => target >= block.start);
      const confidence = (length / needle.length) * Math.max(0, Math.min(1, asrConfidence));
      if (block && (!best || confidence > best.confidence || (confidence === best.confidence && Math.abs(target - currentOffset) < Math.abs(best.targetTextOffset - currentOffset)))) {
        best = { targetTextOffset: target, confidence, block };
      }
      from = index + 1;
    }
    if (best) break;
  }
  return best;
}

export function followVelocity(distancePx: number, ageMs: number, confidence: number) {
  // Stop on silence, loss of recognition, or when the reader is behind the head.
  if (ageMs > 1600 || confidence < 0.56 || distancePx <= 0) return 0;
  return Math.min(150, distancePx / 0.65);
}
