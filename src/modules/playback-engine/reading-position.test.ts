import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMarkdown } from '../script-engine/parse';
import { normalizeReadingText, readingBlocks, offsetForReadingY } from './reading-position';
import { matchVoice, followVelocity } from '../voice-follow/match';

test('reading offsets exclude notes and markers and retain spoken order across newlines', () => {
  const bundle = parseMarkdown('# 开场\n\n第一行\n第二行\n\n第三段');
  const blocks = readingBlocks(bundle);
  assert.equal(blocks.map(x => x.text).join(''), '开场第一行第二行第三段');
  assert.equal(blocks.at(-1)?.start, 8);
  assert.equal(normalizeReadingText('ＡＢＣ，欢迎\n你！'), 'abc欢迎你');
});
test('centering has the same reading location before and after vertical reflection', () => {
  for (const height of [480, 768, 1080]) {
    for (const offset of [0, 300, 4000]) {
      const y = height / 2 + 150;
      assert.equal(offsetForReadingY(offset, y, height, false), offsetForReadingY(offset, height - y, height, true));
    }
  }
});
test('voice locates the next character within a long paragraph rather than its midpoint', () => {
  const bundle = parseMarkdown('今天我们讲一个很多人都好奇的问题。接下来仔细看看它是怎么发生的。');
  const result = matchVoice('今天我们讲一个很多人都好奇的问题', bundle, 0, 0.98);
  assert.equal(result?.targetTextOffset, normalizeReadingText('今天我们讲一个很多人都好奇的问题').length);
});
test('voice suffix can span paragraphs and ignores distant repeated phrases', () => {
  const bundle = parseMarkdown('欢迎来到我们的节目。\n\n' + '这是一段很长的正文'.repeat(50) + '\n\n欢迎来到我们的节目。接下来开始');
  const current = readingBlocks(bundle).at(-1)!.start;
  assert.ok(matchVoice('欢迎来到我们的节目', bundle, current, 0.9)!.targetTextOffset > current);
  assert.equal(matchVoice('好', bundle, 0, 1), undefined);
  assert.equal(matchVoice('完全不在稿中的随机句子', bundle, 0, 1), undefined);
});
test('silence, low confidence and a reader behind the head stop the scroll', () => {
  assert.equal(followVelocity(300, 2000, 0.9), 0);
  assert.equal(followVelocity(300, 100, 0.3), 0);
  assert.equal(followVelocity(-300, 100, 0.9), 0);
  assert.ok(followVelocity(30, 100, 0.9) < followVelocity(100, 100, 0.9));
  assert.ok(followVelocity(2000, 100, 0.9) <= 150);
});

test('the same display line always reports its first character on either side of its center', async () => {
  const { readingAtY } = await import('./reading-position');
  const oldDocument = globalThis.document;
  const oldNodeFilter = globalThis.NodeFilter;
  const text = '字'.repeat(100);
  const textNode = { textContent: text };
  let mirrored = false;
  Object.assign(globalThis, { NodeFilter: { SHOW_TEXT: 4 }, document: {
    createTreeWalker() { let done = false; return { nextNode() { if (done) return null; done = true; return textNode; } }; },
    createRange() { let index = 0; return {
      setStart(_node: unknown, value: number) { index = value; }, setEnd() {},
      getBoundingClientRect() { const center = Math.floor(index / 10) * 30; return { top: (mirrored ? 300 - center : center) - 10, height: 20 }; },
    }; },
  } });
  try {
    const bundle = parseMarkdown(text);
    for (mirrored of [false, true]) for (const y of [59.9, 60, 60.1, 65]) {
      assert.equal(readingAtY({} as HTMLElement, bundle, mirrored ? 300-y : y, mirrored)?.textOffset, 20);
    }
  } finally { Object.assign(globalThis, { document: oldDocument, NodeFilter: oldNodeFilter }); }
});

test('primary fallback is stable regardless of report timing or device insertion order', async () => {
  const { effectivePrimary } = await import('./reading-position');
  const devices = ['c','a','b'].map(deviceId => ({deviceId, role:'player',online:true,connectionState:'online'})) as import('../../domain/room/types').DevicePresence[];
  assert.equal(effectivePrimary(Object.fromEntries(devices.map(d=>[d.deviceId,d])), 'gone')?.deviceId,'a');
  assert.equal(effectivePrimary(Object.fromEntries([...devices].reverse().map(d=>[d.deviceId,d])), 'gone')?.deviceId,'a');
  assert.equal(effectivePrimary(Object.fromEntries(devices.map(d=>[d.deviceId,d])), 'b')?.deviceId,'b');
});
