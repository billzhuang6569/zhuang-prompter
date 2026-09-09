import {spawn} from 'node:child_process';import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';import WebSocket from 'ws';
const dir=await mkdtemp(join(tmpdir(),'prompter-update-lock-'));const port=3191,base=`http://127.0.0.1:${port}`,token=crypto.randomUUID();
const server=spawn(process.execPath,['.desktop/server/server.cjs'],{env:{...process.env,NODE_ENV:'production',PORT:String(port),ZHUANG_PROMPTER_STORE_FILE:join(dir,'rooms.json'),PROMPTER_UPDATE_TOKEN:token},stdio:'ignore'});
const post=(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:body?JSON.stringify(body):undefined});let ws;
try{let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/rooms')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready);
assert.equal((await post('/api/desktop/update-lock')).status,403);
const room=await(await post('/api/rooms')).json();ws=new WebSocket(base.replace('http','ws')+room.wsUrl);await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
const messages=[];ws.on('message',x=>messages.push(JSON.parse(String(x))));ws.send(JSON.stringify({type:'client.hello',eventId:crypto.randomUUID(),deviceId:room.deviceId,sessionId:'guard-test',clientSeq:1,baseRoomRevision:0,sentAt:Date.now(),payload:{role:'control',lastSeenRoomRevision:0,lastSeenServerSeq:0}}));
for(let i=0;i<30&&!messages.some(x=>x.type==='server.welcome');i++)await new Promise(r=>setTimeout(r,100));
assert.equal((await post('/api/desktop/update-lock',null,{'x-update-token':token})).status,409);
await new Promise(r=>{ws.once('close',r);ws.close();});
assert.equal((await post('/api/desktop/update-lock',null,{'x-update-token':token})).status,200);
assert.equal((await post('/api/rooms')).status,503);
assert.equal((await fetch(base+'/api/desktop/update-lock',{method:'DELETE',headers:{'x-update-token':token}})).status,200);
assert.equal((await post('/api/rooms')).status,201);
console.log('PASS: unauthorized requests rejected; controller blocks install; lock rejects new mutations; release restores normal operation');
}finally{ws?.terminate();server.kill();}
