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
    // Exercise the actual control guide's semantic seek over the room WebSocket.
    await control.evaluate(async ({base, code, offset})=>{
      const room=await (await fetch(`/api/rooms/${code}/join`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json();
      const ws=new WebSocket(base.replace('http','ws')+room.wsUrl);
      await new Promise(resolve=>ws.onopen=resolve);
      const event=(type,payload,seq)=>({type,eventId:crypto.randomUUID(),roomId:room.roomId,deviceId:room.deviceId,sessionId:'test',clientSeq:seq,baseRoomRevision:0,sentAt:Date.now(),payload});
      ws.send(JSON.stringify(event('client.hello',{role:'control'},1)));
      ws.send(JSON.stringify(event('playback.setScrollClock',{scrollClock:{scrollClockId:crypto.randomUUID(),scriptVersionId:'draft',state:'paused',controlMode:'manual',anchor:{type:'renderLine',textOffset:offset},offsetPx:0,velocityPxPerSecond:0,issuedAt:Date.now(),sourceDeviceId:room.deviceId}},2)));
      await new Promise(resolve=>{ws.onmessage=e=>{if(JSON.parse(e.data).type==='server.ack'){ws.close();resolve();}}});
    }, {base,code:room.roomCode,offset});
  };
  const cases=[];
  for (const size of [{width:1280,height:800},{width:768,height:1024},{width:390,height:844}]) {
    await player.setViewportSize(size);
    for (const scale of [0.75,1,2]) for (const mirrorY of [false,true]) {
      await fetch(`${base}/api/rooms/${room.roomCode}/settings`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({playerFontScale:scale,playerMirrorX:true,playerMirrorY:mirrorY})});
      await player.waitForFunction(({mirrorY,scale})=>document.querySelector('.player-stage').classList.contains('is-mirrored-y')===mirrorY && document.querySelector('.teleprompter-content').style.getPropertyValue('--player-font-scale')===String(scale), {mirrorY,scale});
      await setPosition(85);
      await player.waitForFunction(()=>Math.abs(ReadingTest.readingY(document.querySelector('.teleprompter-content'),window.testBundle,{textOffset:85})-innerHeight/2)<2);
      const position = await player.evaluate(()=>ReadingTest.readingAtY(document.querySelector('.teleprompter-content'),window.testBundle,innerHeight/2,document.querySelector('.player-stage').classList.contains('is-mirrored-y')));
      await control.waitForFunction(position=>{
        const p=ReadingTest.readingY(document.querySelector('.nike-rich-editor-content'),window.testBundle,position);
        const r=document.querySelector('.nike-iline').getBoundingClientRect();
        return Math.abs(r.top+r.height/2-p)<3;
      }, position);
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
  socket.on('message',data=>{const event=JSON.parse(String(data));if(event.state) state=event.state;});
  let seq=0;
  const send=(type,payload)=>socket.send(JSON.stringify({type,payload,eventId:crypto.randomUUID(),roomId:room.roomId,deviceId:joined.deviceId,sessionId:'voice-test',clientSeq:++seq,baseRoomRevision:0,sentAt:Date.now()}));
  const waitState=predicate=>new Promise((resolve,reject)=>{const started=Date.now();const timer=setInterval(()=>{if(predicate(state)){clearInterval(timer);resolve();}else if(Date.now()-started>8000){clearInterval(timer);reject(new Error('Voice state timeout: '+JSON.stringify(state?.scrollClock)));}},25);});
  send('client.hello',{role:'control'});
  send('voice.setSource',{sourceDeviceId:joined.deviceId});
  const voiceClock={scrollClockId:crypto.randomUUID(),scriptVersionId:'draft',state:'playing',controlMode:'voiceFollow',anchor:{type:'paragraph'},offsetPx:0,velocityPxPerSecond:0,issuedAt:Date.now(),sourceDeviceId:joined.deviceId};
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
  console.log(JSON.stringify({ok:true,cases:cases.length,join:true,screenshots:dir},null,2));
} finally { await browser.close(); }
