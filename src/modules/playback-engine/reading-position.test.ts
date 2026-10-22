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

// Deliberately independent, deterministic geometry: each supplied grapheme has a visual row.
function withTextDOM(text: string, rows: number[], run: (dom: {
  root: HTMLElement; node: Text; mutate: (text: string) => void; walks: () => number;
}) => void) {
  const keys = ['document','NodeFilter','Node','MutationObserver'] as const;
  const old = keys.map(key=>globalThis[key]);
  const block = {};
  const parent = { closest: (selector:string) => selector.startsWith('[data-directive') ? null : block };
  let node = {textContent:text,parentElement:parent,nodeType:3} as unknown as Text;
  let walks = 0, pending = false;
  const root = { contains: (n:Node)=>n===node } as HTMLElement;
  const rect = (index:number) => {
    const units = [...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(node.textContent!)];
    const ordinal = units.findIndex(u=>u.index===index);
    const top = (rows[ordinal] ?? 0)*30;
    return {top,bottom:top+20,height:20,left:ordinal*12,right:ordinal*12+12,width:12} as DOMRect;
  };
  Object.assign(globalThis, {
    NodeFilter:{SHOW_TEXT:4}, Node:{TEXT_NODE:3},
    MutationObserver:class { observe(){} disconnect(){} takeRecords(){const result=pending?[{}]:[];pending=false;return result;} },
    document:{
      createTreeWalker(){walks++;let done=false;return {nextNode(){if(done)return null;done=true;return node;}};},
      createRange(){let start=0;return {setStart(_n:Node,i:number){start=i;},setEnd(){},getBoundingClientRect(){return rect(start);},getClientRects(){return [rect(start)];}};},
    },
  });
  try { run({root,node,walks:()=>walks,mutate(value){node={...node,textContent:value} as Text;pending=true;}}); }
  finally { keys.forEach((key,i)=>Object.assign(globalThis,{[key]:old[i]})); }
}

test('line ends are exclusive UTF-16 normalized ranges; nearest row and ties are stable', async () => {
  const {readingAtY} = await import('./reading-position');
  withTextDOM('甲乙丙丁',[0,0,1,1],({root})=>{
    const bundle=parseMarkdown('甲乙丙丁');
    for(const y of [0,10,19,24.9,25]) {
      const range=readingAtY(root,bundle,y)!;
      assert.deepEqual([range.textOffset,range.lineEndOffset],[0,2]);
    }
    const range=readingAtY(root,bundle,26)!;
    assert.deepEqual([range.textOffset,range.lineEndOffset],[2,4]);
  });
});

test('20k text cache survives layout, offset and overlay work but drains pending DOM mutations', async () => {
  const {readingMap,readingAtY,releaseReadingMap}=await import('./reading-position');
  const text='甲'.repeat(20000);
  withTextDOM(text,[],({root,mutate,walks})=>{
    const bundle=parseMarkdown(text);
    const first=readingMap(root,bundle);
    for(let i=0;i<10;i++) assert.equal(readingMap(root,bundle),first);
    assert.equal(walks(),1);
    mutate(text);
    const second=readingMap(root,bundle);
    assert.notEqual(second,first);
    assert.notEqual(second[0]?.node,first[0]?.node);
    assert.equal(walks(),2);
    assert.notEqual(readingMap(root,parseMarkdown(text)),second);
    releaseReadingMap(root);
    assert.notEqual(readingMap(root,bundle),second);
    assert.equal(walks(),4);
    assert.equal(readingAtY(root,parseMarkdown(''),0),undefined);
  });
});

test('point reverse lookup snaps emoji to nearest spoken grapheme with earlier tie, rejects whitespace', async () => {
  const {readingOffsetForPoint,readingMap}=await import('./reading-position');
  withTextDOM('甲🙂乙 Ａﬁe\u0301𠮷',[0,0,1,1,1,1,1,1],({root,node})=>{
    const bundle=parseMarkdown(node.textContent!);
    assert.equal(readingOffsetForPoint(root,bundle,node,1),0);
    assert.equal(readingOffsetForPoint(root,bundle,node,2),0);
    assert.equal(readingOffsetForPoint(root,bundle,node,3),1);
    assert.equal(readingOffsetForPoint(root,bundle,node,3,{x:20,y:10}),0); // right half of emoji yields a trailing caret
    assert.equal(readingOffsetForPoint(root,bundle,node,1,{x:8,y:10}),0);
    assert.equal(readingOffsetForPoint(root,bundle,node,1,{x:200,y:200}),undefined);
    assert.equal(readingOffsetForPoint(root,bundle,node,4),undefined);
    const chars=readingMap(root,bundle);
    assert.equal(chars[3],chars[4]); // ligature fi expands, one display grapheme
    assert.equal(chars[6],chars[7]); // supplementary ideograph stays whole
    assert.equal(chars[5]!.end - chars[5]!.start,2); // combining acute stays attached
  });
});

test('phase 1 documents the indistinguishable 甲🙂|乙 versus 甲|🙂乙 edge', async () => {
  const {readingAtY,readingHighlight}=await import('./reading-position');
  for(const rows of [[0,0,1],[0,1,1]]) withTextDOM('甲🙂乙',rows,({root})=>{
    const bundle=parseMarkdown('甲🙂乙');
    const line=readingAtY(root,bundle,10)!;
    assert.deepEqual([line.textOffset,line.lineEndOffset],[0,1]);
    const highlight=readingHighlight(root,bundle,0,1)!;
    assert.equal(highlight.rects.length,2); // approximation includes emoji in both cases
    assert.equal(highlight.guideY,10); // tie chooses the earlier logical row
    assert.equal(readingHighlight(root,bundle,0,3),undefined);
  });
});

test('server rejects stale revisions, invalid ranges, old sessions and nonfinite font scales', async () => {
  const {mkdtempSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  process.env.ZHUANG_PROMPTER_STORE_FILE=join(mkdtempSync(join(tmpdir(),'m6-contract-')),'store.json');
  const store=await import('../room-sync/room-store');
  const room=store.createRoom();
  const state=store.updateScriptDraft({roomCode:room.roomCode,deviceId:room.deviceId,markdown:'甲🙂乙'})!;
  store.registerSession({roomCode:room.roomCode,deviceId:room.deviceId,sessionId:'new',role:'player',clientSeq:1});
  const clock={draftRevision:state.scriptDraft.draftRevision,scriptVersionId:`draft:${state.scriptDraft.draftRevision}`,scrollClockId:'jump',state:'playing' as const,controlMode:'manual' as const,anchor:{type:'renderLine' as const,textOffset:1},offsetPx:0,velocityPxPerSecond:42,issuedAt:Date.now(),sourceDeviceId:room.deviceId};
  const input={roomCode:room.roomCode,deviceId:room.deviceId,sessionId:'new',clientSeq:2};
  assert.equal(store.setScrollClock({...input,scrollClock:{...clock,draftRevision:0}}),null);
  assert.equal(store.setScrollClock({...input,scrollClock:{...clock,anchor:{type:'renderLine',textOffset:99}}}),null);
  assert.equal(store.setScrollClock({...input,sessionId:'old',scrollClock:clock}),null);
  assert.ok(store.setScrollClock({...input,scrollClock:clock}));
  assert.equal(store.setScrollClock({...input,scrollClock:clock}),null);
  const report={...clock,positionPx:10,currentAnchor:{type:'renderLine' as const,textOffset:0,lineEndOffset:1},reportedAt:Date.now()};
  assert.equal(store.reportPlaybackState({...input,clientSeq:3,playbackState:{...report,currentAnchor:{...report.currentAnchor,lineEndOffset:3}}}),null);
  assert.ok(store.reportPlaybackState({...input,clientSeq:3,playbackState:report}));
  store.setVoiceSource({roomCode:room.roomCode,sourceDeviceId:room.deviceId});
  const transcript={segmentId:'late',sourceDeviceId:room.deviceId,scriptVersionId:clock.scriptVersionId,isFinal:true,text:'甲乙',asrConfidence:1,scrollClockId:'old-clock'};
  assert.equal(store.processVoiceTranscript({roomCode:room.roomCode,transcript}),null);
  assert.ok(store.processVoiceTranscript({roomCode:room.roomCode,transcript:{...transcript,scrollClockId:'jump'}}));
  const jump=store.setScrollClock({...input,clientSeq:4,scrollClock:{...clock,scrollClockId:'second-jump'}})!;
  assert.equal(jump.voiceState.match,undefined);
  assert.equal(jump.scrollClock?.state,'playing');
  assert.equal(jump.scrollClock?.velocityPxPerSecond,42);
  assert.equal(jump.scrollClock?.controlMode,'manual');
  store.registerSession({...input,sessionId:'replacement',clientSeq:1,role:'player'});
  assert.equal(store.reportPlaybackState({...input,clientSeq:5,playbackState:report}),null);
  assert.equal(store.getRoomState(room.roomCode)?.devices[room.deviceId].playbackState,undefined);
  for(const playerFontScale of [NaN,Infinity,0,-1,0.5]) assert.equal(store.updateRoomSettings({roomCode:room.roomCode,settings:{playerFontScale}}),null);
  for(const playerFontScale of [3,5,10,100]) assert.equal(store.updateRoomSettings({roomCode:room.roomCode,settings:{playerFontScale}})?.settings.playerFontScale,playerFontScale);
});

test('guide follows the local row with most graphemes, while repeated blocks retain distinct offsets', async () => {
  const {readingHighlight,readingAtY,readingMap}=await import('./reading-position');
  withTextDOM('甲乙丙丁戊己',[0,1,1,1,2,2],({root})=>{
    const high=readingHighlight(root,parseMarkdown('甲乙丙丁戊己'),0,6)!;
    assert.equal(high.rects.length,6);
    assert.equal(high.guideY,40);
  });
  withTextDOM('甲乙甲乙',[0,0,1,1],({root})=>{
    const bundle=parseMarkdown('甲乙\n\n甲乙');
    assert.equal(readingMap(root,bundle).length,4);
    const line=readingAtY(root,bundle,40)!;
    assert.deepEqual([line.textOffset,line.lineEndOffset],[2,4]);
    assert.equal(readingHighlight(root,parseMarkdown('稿件已分叉'),0,2),undefined);
  });
  withTextDOM('🙂！',[0,0],({root})=>{
    const bundle=parseMarkdown('🙂！');
    assert.equal(readingAtY(root,bundle,10),undefined);
    assert.equal(readingHighlight(root,bundle,0,0),undefined);
  });
});
