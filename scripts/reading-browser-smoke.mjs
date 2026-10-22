import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = process.env.TEST_BASE_URL ?? 'http://localhost:3107';
const dir = await mkdtemp(join(tmpdir(), 'reading-smoke-'));
await build({ stdin: { contents: `export * from './src/modules/playback-engine/reading-position'; export {parseMarkdown} from './src/modules/script-engine/parse';`, resolveDir: process.cwd() }, bundle: true, format: 'iife', globalName: 'ReadingTest', outfile: join(dir, 'reading.js') });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext();
  const player = await context.newPage();
  const control = await context.newPage();
  const errors = [];
  for (const page of [player, control]) page.on('pageerror', e => errors.push(e.message));
  const room = await (await fetch(`${base}/api/rooms`, {method:'POST'})).json();
  const markdown = '# 开场\n\n今天我们讲一个很多人都好奇的问题。\n这是加了换行的第二行。\n\n::notes{text="这条备注只在控制端显示"}\n\n' + Array.from({length:12}, (_,i)=>`第${i+1}段文字。这一段的长度不相同。${'欢迎大家仔细阅读这里的文字。'.repeat(i%4+1)}`).join('\n\n');
  await fetch(`${base}/api/rooms/${room.roomCode}/script/draft`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:room.deviceId,markdown})});
  await player.goto(`${base}/room/${room.roomCode}/player`);
  await control.goto(`${base}/room/${room.roomCode}/control`);
  await player.waitForSelector('.player-stage [data-reading-text]');
  await control.waitForSelector('.nike-rich-editor-content p');
  for (const page of [player,control]) {
    await page.addScriptTag({content: await readFile(join(dir,'reading.js'),'utf8')});
    await page.evaluate(markdown => { window.testBundle = ReadingTest.parseMarkdown(markdown); }, markdown);
  }
  const setPosition = async (offset) => {
    // Exercise the normalized anchor contract over the real room WebSocket.
    await control.evaluate(async ({base, code, offset})=>{
      const room=await (await fetch(`/api/rooms/${code}/join`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json();
      const ws=new WebSocket(base.replace('http','ws')+room.wsUrl);
      await new Promise(resolve=>ws.onopen=resolve);
      const event=(type,payload,seq)=>({type,eventId:crypto.randomUUID(),roomId:room.roomId,deviceId:room.deviceId,sessionId:'test',clientSeq:seq,baseRoomRevision:0,sentAt:Date.now(),payload});
      ws.send(JSON.stringify(event('client.hello',{role:'control'},1)));
      const revision=room.roomState.scriptDraft.draftRevision;
      const version=room.roomState.currentScriptVersionId ?? `draft:${revision}`;
      ws.send(JSON.stringify(event('playback.setScrollClock',{scrollClock:{scrollClockId:crypto.randomUUID(),scriptVersionId:version,draftRevision:revision,state:'paused',controlMode:'manual',anchor:{type:'renderLine',textOffset:offset},offsetPx:0,velocityPxPerSecond:0,issuedAt:Date.now(),sourceDeviceId:room.deviceId}},2)));
      await new Promise((resolve,reject)=>{ws.onmessage=e=>{const event=JSON.parse(e.data);if(event.type==='server.ack'){ws.close();resolve();}if(event.type==='server.nack'){ws.close();reject(new Error(event.message));}}});
    }, {base,code:room.roomCode,offset});
  };
  const measure = ({selector,highlight=false}) => {
    const root=document.querySelector(selector), units=[];
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    let node,offset=0;
    while((node=walker.nextNode())) {
      if(node.parentElement.closest('[data-directive-kind],.script-marker,.inline-marker,.bound-stage-cue,.script-stage-cue,.list-item-marker')) continue;
      for(const {segment,index} of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(node.textContent)) {
        const range=document.createRange();range.setStart(node,index);range.setEnd(node,index+segment.length);
        const rect=range.getBoundingClientRect();
        const normalized=segment.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
        units.push({text:segment,start:offset,end:offset+normalized.length,rect:{top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right,width:rect.width,height:rect.height}});
        offset+=normalized.length;
      }
    }
    if(highlight) {
      const boxes=[...document.querySelectorAll('.nike-reading-highlight span')].map(e=>e.getBoundingClientRect());
      return units.filter(u=>boxes.some(b=>Math.abs(b.left-u.rect.left)<1 && Math.abs(b.top-u.rect.top)<1 && Math.abs(b.width-u.rect.width)<1)).map(u=>({text:u.text,start:u.start,end:u.end}));
    }
    const spoken=units.filter(u=>u.end>u.start && u.rect.height>0);
    const nearest=spoken.reduce((best,u)=>{
      const distance=Math.max(u.rect.top-innerHeight/2,innerHeight/2-u.rect.bottom,0);
      return !best || distance<best.distance ? {unit:u,distance}:best;
    },null)?.unit;
    if(!nearest)return [];
    return units.filter(u=>u.rect.width>0 && Math.min(u.rect.bottom,nearest.rect.bottom)-Math.max(u.rect.top,nearest.rect.top)>Math.min(u.rect.height,nearest.rect.height)*.35).map(u=>({text:u.text,start:u.start,end:u.end}));
  };
  const assertHighlight = async () => {
    const expected=await player.evaluate(measure,{selector:'.teleprompter-content'});
    await control.waitForFunction(()=>document.querySelectorAll('.nike-reading-highlight span').length>0);
    await new Promise(resolve=>setTimeout(resolve,150));
    const actual=await control.evaluate(measure,{selector:'.nike-rich-editor-content',highlight:true});
    const spoken=values=>values.filter(u=>u.end>u.start);
    assert.deepEqual(spoken(actual),spoken(expected),'independent player center and controller overlay spoken characters');
    if(JSON.stringify(actual)!==JSON.stringify(expected)) {
      console.log('PHASE_1_EDGE_LIMIT '+JSON.stringify({expected,actual}));
    }
    assert.deepEqual(actual,expected,'all highlighted display graphemes equal the independently measured player center line');
  };
  const cases=[];
  for (const size of [{width:1280,height:800},{width:768,height:1024},{width:390,height:844}]) {
    await player.setViewportSize(size);
    for (const scale of [0.75,1,2,3,5,10]) for (const mirrorY of [false,true]) {
      await fetch(`${base}/api/rooms/${room.roomCode}/settings`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({playerFontScale:scale,playerMirrorX:true,playerMirrorY:mirrorY})});
      await player.waitForFunction(({mirrorY,scale})=>document.querySelector('.player-stage').classList.contains('is-mirrored-y')===mirrorY && document.querySelector('.teleprompter-content').style.getPropertyValue('--player-font-scale')===String(scale), {mirrorY,scale});
      await setPosition(85);
      await player.waitForFunction(()=>Math.abs(ReadingTest.readingY(document.querySelector('.teleprompter-content'),window.testBundle,{textOffset:85})-innerHeight/2)<2);
      await assertHighlight();
      cases.push({size,scale,mirrorY,centered:true});
      console.log(JSON.stringify(cases.at(-1)));
    }
  }
  // Drive real room events through the actual primary display feedback loop.
  await fetch(`${base}/api/rooms/${room.roomCode}/settings`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({playerFontScale:1,playerMirrorX:false,playerMirrorY:false})});
  await setPosition(0);
  const joined = await (await fetch(`${base}/api/rooms/${room.roomCode}/join`, {method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json();
  const socket = new WebSocket(base.replace('http','ws')+joined.wsUrl);
  await new Promise((resolve,reject)=>{socket.on('open',resolve);socket.on('error',reject);});
  let state;
  const observedClocks=[];
  socket.on('message',data=>{const event=JSON.parse(String(data));if(event.state) {state=event.state; const clock=state.scrollClock;if(clock && observedClocks.at(-1)?.scrollClockId!==clock.scrollClockId)observedClocks.push(clock);}});
  let seq=0;
  let heartbeat;
  socket.on('close', () => clearInterval(heartbeat));
  const send=(type,payload)=>socket.send(JSON.stringify({type,payload,eventId:crypto.randomUUID(),roomId:room.roomId,deviceId:joined.deviceId,sessionId:'voice-test',clientSeq:++seq,baseRoomRevision:0,sentAt:Date.now()}));
  const waitState=predicate=>new Promise((resolve,reject)=>{const started=Date.now();const timer=setInterval(()=>{if(predicate(state)){clearInterval(timer);resolve();}else if(Date.now()-started>8000){clearInterval(timer);reject(new Error('Voice state timeout: '+JSON.stringify(state?.scrollClock)));}},25);});
  send('client.hello',{role:'control'});
  heartbeat=setInterval(()=>send('presence.heartbeat',{}),10000);
  heartbeat.unref();
  await waitState(s=>Boolean(s));
  await control.locator('.nike-play-btn').click();
  await waitState(s=>s?.scrollClock?.state==='playing');
  await control.getByRole('slider', {name:'播放端字号',exact:true}).evaluate(input => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'130');
    input.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await waitState(s=>s?.settings?.playerFontScale===1.3);
  await new Promise(resolve=>setTimeout(resolve,600));
  assert.equal(state.scrollClock.state,'playing');
  assert.equal(state.settings.playerFontScale,1.3,'controller font scale persists during 10Hz playback reports');
  assert.equal(await control.getByRole('slider', {name:'播放端字号',exact:true}).inputValue(),'130');
  await control.getByRole('group',{name:'编辑模式'}).getByRole('button',{name:'编辑',exact:true}).click();
  await control.getByRole('tab',{name:'原文',exact:true}).click();
  await control.getByLabel('Markdown 原文编辑').fill(markdown+'\n\n尚未保存的本地修改');
  const roomRevision=state.scriptDraft.draftRevision;
  await control.locator('.nike-play-btn').click();
  await waitState(s=>s?.scrollClock?.state==='paused');
  assert.equal(state.scrollClock.draftRevision,roomRevision);
  await control.locator('.nike-play-btn').click();
  await waitState(s=>s?.scrollClock?.state==='playing');
  assert.equal(state.scrollClock.draftRevision,roomRevision);
  assert.equal(state.scriptDraft.markdown,markdown,'transport does not save local edits');
  await control.getByLabel('Markdown 原文编辑').fill(markdown);
  await control.getByRole('group',{name:'编辑模式'}).getByRole('button',{name:'完成',exact:true}).click();
  await control.waitForFunction(()=>document.querySelector('.nike-mode-toggle button:last-child')?.getAttribute('aria-pressed')==='true');
  await control.getByRole('tab',{name:'预览',exact:true}).click();
  // Finishing may save (new revision) and clear the clock; build the injected clock from the settled draft.
  await new Promise(resolve=>setTimeout(resolve,500));
  const settledRevision=state.scriptDraft.draftRevision;
  const runningClock={scrollClockId:crypto.randomUUID(),scriptVersionId:state.currentScriptVersionId ?? `draft:${settledRevision}`,draftRevision:settledRevision,state:'playing',velocityPxPerSecond:37,controlMode:'manual',anchor:{type:'renderLine',textOffset:85},offsetPx:0,issuedAt:Date.now(),sourceDeviceId:joined.deviceId};
  send('playback.setScrollClock',{scrollClock:runningClock});
  await waitState(s=>s?.scrollClock?.scrollClockId===runningClock.scrollClockId);
  const observedStart=observedClocks.length;
  const beforeClick={...state.scrollClock};
  const target=await control.evaluate(()=>{
    const root=document.querySelector('.nike-rich-editor-content');
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
    while((node=walker.nextNode())) {
      if(node.parentElement.closest('[data-directive-kind]'))continue;
      for(let i=0;i<node.length;i++) {
        if(!/[\p{L}\p{N}]/u.test(node.textContent[i]))continue;
        const range=document.createRange();range.setStart(node,i);range.setEnd(node,i+1);const r=range.getBoundingClientRect();
        const viewport=document.querySelector('.nike-sr').getBoundingClientRect();
        if(r.top>viewport.top+70 && r.bottom<viewport.bottom-20)return {x:r.left+r.width/2,y:r.top+r.height/2};
      }
    }
    throw new Error('No visible spoken click target');
  });
  await control.mouse.click(target.x,target.y);
  await waitState(s=>s?.scrollClock?.scrollClockId!==beforeClick.scrollClockId);
  assert.equal(state.scrollClock.state,'playing');
  assert.equal(state.scrollClock.velocityPxPerSecond,beforeClick.velocityPxPerSecond);
  assert.equal(state.scrollClock.controlMode,beforeClick.controlMode);
  const beforeNudge={...state.scrollClock};
  await control.getByTitle('前进 160px',{exact:true}).click();
  await waitState(s=>s?.scrollClock?.scrollClockId!==beforeNudge.scrollClockId);
  assert.equal(state.scrollClock.state,'playing');
  assert.equal(state.scrollClock.velocityPxPerSecond,beforeNudge.velocityPxPerSecond);
  assert.equal(state.scrollClock.controlMode,beforeNudge.controlMode);
  assert.ok(observedClocks.slice(observedStart).every(clock=>clock.state==='playing' && clock.velocityPxPerSecond===37 && clock.controlMode==='manual'),'jumps must never emit an interim pause or reset speed/mode');
  await control.locator('.nike-play-btn').click();
  await waitState(s=>s?.scrollClock?.state==='paused');
  for(const scale of [3,5]) {
    await control.locator('input[type=range]').nth(1).evaluate((input,value)=>{
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));
      input.dispatchEvent(new Event('input',{bubbles:true}));
    },scale*100);
    await waitState(s=>s?.settings?.playerFontScale===scale);
    await player.waitForFunction(scale=>document.querySelector('.teleprompter-content').style.getPropertyValue('--player-font-scale')===String(scale),scale);
    await assertHighlight();
    await control.reload();
    await control.waitForFunction(scale=>Number(document.querySelectorAll('input[type=range]')[1]?.value)===scale*100,scale);
    await player.reload();
    await player.waitForSelector('.player-stage [data-reading-text]');
    await player.addScriptTag({content:await readFile(join(dir,'reading.js'),'utf8')});
    await player.evaluate(markdown=>{window.testBundle=ReadingTest.parseMarkdown(markdown);},markdown);
    await player.waitForFunction(scale=>document.querySelector('.teleprompter-content').style.getPropertyValue('--player-font-scale')===String(scale),scale);
    await assertHighlight();
  }
  console.log('Playing click/nudge preserve state, velocity and controlMode; 300%/500% persist across both reloads.');
  send('voice.setSource',{sourceDeviceId:joined.deviceId});
  const revision=joined.roomState.scriptDraft.draftRevision;
  const version=joined.roomState.currentScriptVersionId ?? `draft:${revision}`;
  const voiceClock={draftRevision:revision,scrollClockId:crypto.randomUUID(),scriptVersionId:version,state:'playing',controlMode:'voiceFollow',anchor:{type:'paragraph'},offsetPx:0,velocityPxPerSecond:0,issuedAt:Date.now(),sourceDeviceId:joined.deviceId};
  send('playback.setScrollClock',{scrollClock:voiceClock});
  send('voice.transcript',{transcript:{segmentId:'voice-regression',sourceDeviceId:joined.deviceId,scriptVersionId:'draft',isFinal:false,text:'今天我们讲一个很多人都好奇的问题',asrConfidence:0.98}});
  await waitState(s=>s?.scrollClock?.velocityPxPerSecond>0 && s.scrollClock.controlMode==='voiceFollow');
  await waitState(s=>s?.scrollClock?.velocityPxPerSecond===0);
  send('playback.setScrollClock',{scrollClock:{...voiceClock,scrollClockId:'manual-pause',state:'paused',offsetPx:70}});
  send('voice.transcript',{transcript:{segmentId:'after-pause',sourceDeviceId:joined.deviceId,scriptVersionId:'draft',isFinal:true,text:'今天我们讲一个很多人都好奇的问题',asrConfidence:0.98}});
  await waitState(s=>s?.voiceState?.match?.transcriptSegmentId==='after-pause');
  await new Promise(resolve=>setTimeout(resolve,500));
  assert.equal(state.scrollClock.state,'paused');
  socket.close();
  console.log('Voice feedback: interim transcript moves, silence stops, manual pause holds.');
  // A differently sized secondary display must center the same text.
  const secondContext = await browser.newContext({viewport:{width:1100,height:700}});
  const secondary = await secondContext.newPage();
  await secondary.goto(`${base}/room/${room.roomCode}/player`);
  await secondary.waitForSelector('.player-stage [data-reading-text]');
  await secondary.addScriptTag({content:await readFile(join(dir,'reading.js'),'utf8')});
  await secondary.evaluate(markdown=>{window.testBundle=ReadingTest.parseMarkdown(markdown);},markdown);
  await setPosition(145);
  await player.waitForFunction(()=>Math.abs(ReadingTest.readingY(document.querySelector('.teleprompter-content'),window.testBundle,{textOffset:145})-innerHeight/2)<2);
  const sharedPosition=await player.evaluate(()=>ReadingTest.readingAtY(document.querySelector('.teleprompter-content'),window.testBundle,innerHeight/2));
  await secondary.waitForFunction(position=>Math.abs(ReadingTest.readingY(document.querySelector('.teleprompter-content'),window.testBundle,position)-innerHeight/2)<3,sharedPosition);
  await secondContext.close();
  console.log('Secondary display uses the same reading anchor at a different viewport size.');
  await fetch(`${base}/api/rooms/${room.roomCode}/settings`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({playerFontScale:2})});
  await player.waitForFunction(()=>document.querySelector('.teleprompter-content').style.getPropertyValue('--player-font-scale')==='2');
  await player.waitForFunction(position=>Math.abs(ReadingTest.readingY(document.querySelector('.teleprompter-content'),window.testBundle,position)-innerHeight/2)<3,sharedPosition);
  const beforeResize=await player.evaluate(()=>ReadingTest.readingAtY(document.querySelector('.teleprompter-content'),window.testBundle,innerHeight/2));
  await player.setViewportSize({width:820,height:600});
  await player.waitForFunction(position=>Math.abs(ReadingTest.readingY(document.querySelector('.teleprompter-content'),window.testBundle,position)-innerHeight/2)<3,beforeResize);
  console.log('Changing font and viewport preserves the reading head without a new seek.');
  const edgeEvidence=await player.evaluate(()=>{
    const root=document.createElement('div');
    Object.assign(root.style,{position:'fixed',left:'0',top:'0',font:'40px monospace',width:'300px',lineHeight:'50px'});
    document.body.append(root);
    const samples=[];
    for(const html of ['甲🙂<br>乙','甲<br>🙂乙']) {
      root.innerHTML=html;
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT), units=[];let node;
      while((node=walker.nextNode())) for(const {segment,index} of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(node.textContent)) {
        const range=document.createRange();range.setStart(node,index);range.setEnd(node,index+segment.length);
        units.push({text:segment,top:range.getBoundingClientRect().top});
      }
      const y=units[0].top+20,bundle=ReadingTest.parseMarkdown('甲🙂乙');
      const range=ReadingTest.readingAtY(root,bundle,y);
      const expected=units.filter(u=>u.top===units[0].top).map(u=>u.text).join('');
      const actual=ReadingTest.readingHighlight(root,bundle,range.textOffset,range.lineEndOffset,range.lineLeadingExtra,range.lineTrailingExtra);
      samples.push({html,expected,reported:[range.textOffset,range.lineEndOffset,range.lineLeadingExtra,range.lineTrailingExtra],highlightedGraphemes:actual.rects.length,exact:actual.rects.length===Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(expected)).length});
      ReadingTest.releaseReadingMap(root);
    }
    root.remove();return samples;
  });
  assert.deepEqual(edgeEvidence.map(s=>s.reported),[[0,1,0,1],[0,1,0,0]]);
  assert.deepEqual(edgeEvidence.map(s=>s.highlightedGraphemes),[2,1]);
  assert.ok(edgeEvidence.every(s=>s.exact),'edge counts make wrapped edge emoji exact');
  assert.deepEqual(edgeEvidence.map(s=>s.expected),['甲🙂','甲']);
  console.log('EDGE_BOUNDARIES '+JSON.stringify(edgeEvidence));
  await player.screenshot({path:join(dir,'player.png')});
  await control.screenshot({path:join(dir,'control.png')});
  await player.goto(`${base}/join`);
  await player.getByLabel('6 位房间号').fill('000000');
  await player.getByRole('button',{name:'进入展示'}).click();
  await player.getByRole('alert').filter({hasText:'没有找到'}).waitFor();
  await player.getByLabel('6 位房间号').fill(room.roomCode);
  await player.getByRole('button',{name:'进入展示'}).click();
  await player.waitForURL(`**/room/${room.roomCode}/player`);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,cases:cases.length,join:true,exactEdgeCorrespondence:true,screenshots:dir},null,2));
} finally { await browser.close(); }
