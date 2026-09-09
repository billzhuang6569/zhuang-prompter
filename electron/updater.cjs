/* eslint-disable @typescript-eslint/no-require-imports */
const {app,ipcMain,shell,BrowserWindow}=require('electron');
const {autoUpdater}=require('electron-updater');
const {mkdir,open,rename,rm,readFile,writeFile,copyFile}=require('node:fs/promises');
const {join}=require('node:path');
const {createHash}=require('node:crypto');
const {selectArtifact}=require('./update-policy.cjs');
const BASE='https://bill-api.whatonearth.work/prompter';
function setupUpdater({getOrigin,token,getDataFile}) {
  let state={status:'idle',currentVersion:app.getVersion(),mode:process.platform==='win32'?'in-app-install':'installer-handoff',autoCheck:true};
  let file=null,downloadPath=null,task=null,abort=null,installing=false,lastCheckedAt=0;
  const settingsPath=join(app.getPath('userData'),'update-settings.json');
  const emit=patch=>{state={...state,...patch}; for(const w of BrowserWindow.getAllWindows()) w.webContents.send('update-state',state); return state;};
  const failure=error=>emit({status:'error',message:error?.name==='AbortError'?'下载已取消':String(error?.message||'更新失败，请重试')});
  const trusted=event=>event.senderFrame===event.sender.mainFrame && event.sender===BrowserWindow.getAllWindows().find(w=>w.webContents===event.sender)?.webContents && new URL(event.sender.getURL()).origin===getOrigin() && (new URL(event.sender.getURL()).pathname==='/' || /^\/room\/\d{6}\/control$/.test(new URL(event.sender.getURL()).pathname));
  autoUpdater.autoDownload=false; autoUpdater.autoInstallOnAppQuit=false; autoUpdater.allowDowngrade=false; autoUpdater.disableDifferentialDownload=true;
  autoUpdater.setFeedURL({provider:'generic',url:`${BASE}/updates/stable/windows-${process.arch}/`});
  autoUpdater.on('download-progress',p=>emit({status:'downloading',percent:p.percent}));
  autoUpdater.on('update-downloaded',()=>emit({status:'downloaded',percent:100}));
  autoUpdater.on('error',failure);
  async function check() {
    if(!app.isPackaged) throw new Error('开发模式不安装更新，请使用已安装的 App');
    if(state.status==='downloaded') return state;
    lastCheckedAt=Date.now();
    await writeFile(settingsPath,JSON.stringify({autoCheck:state.autoCheck,lastCheckedAt}));
    emit({status:'checking',message:''});
    const res=await fetch(`${BASE}/releases/latest.json`,{signal:AbortSignal.timeout(15000)});
    if(!res.ok) throw new Error('暂时无法获取更新信息，请稍后重试');
    const m=await res.json(); file=selectArtifact(m,process.platform==='darwin'?'macos':'windows',process.arch,app.getVersion());
    if(!file) return emit({status:'current'});
    if(process.platform==='win32') { const result=await autoUpdater.checkForUpdates(); if(!result || result.updateInfo.version!==m.version) throw new Error('发布信息正在更新，请稍后再试'); }
    return emit({status:'available',version:m.version,bytes:file.bytes,notes:String(m.releaseNotes||'体验与稳定性更新').slice(0,6000)});
  }
  async function download() {
    if(!file || state.status!=='available') throw new Error('请先检查更新');
    emit({status:'downloading',percent:0,message:''});
    if(process.platform==='win32') { const {CancellationToken}=require('builder-util-runtime'); abort=new CancellationToken(); await autoUpdater.downloadUpdate(abort); return state; }
    const dir=join(app.getPath('userData'),'updates'); await mkdir(dir,{recursive:true});
    const dest=join(dir,`zhuang-prompter-${state.version}-${process.arch}.dmg`),part=dest+'.part';
    abort=new AbortController(); const hash=createHash('sha256'); let bytes=0,last=0;
    const out=await open(part,'w');
    try {
      const res=await fetch(file.url,{signal:abort.signal,redirect:'error'});
      if(!res.ok || !res.body) throw new Error('下载安装包失败');
      for await(const chunk of res.body) { bytes+=chunk.length; if(bytes>file.bytes) throw new Error('安装包大小不一致'); hash.update(chunk); await out.write(chunk); if(Date.now()-last>150) {emit({percent:100*bytes/file.bytes});last=Date.now();} }
      if(bytes!==file.bytes || hash.digest('hex')!==file.sha256) throw new Error('安装包校验失败，请重新下载');
      await out.close(); await rename(part,dest); downloadPath=dest; return emit({status:'downloaded',percent:100});
    } catch(e) { await out.close().catch(()=>{}); await rm(part,{force:true});throw e; }
  }
  async function install() {
    if(state.status!=='downloaded' || installing) throw new Error('请先完成下载');
    const origin=getOrigin();
    const res=await fetch(`${origin}/api/desktop/update-lock`,{method:'POST',headers:{'x-update-token':token},signal:AbortSignal.timeout(5000)});
    if(!res.ok) { emit({message:'请先停止播放、保存稿件并返回首页，同时关闭其他设备的控制页。'});return state; }
    try {
      const data=getDataFile(); await copyFile(data,data+'.before-update.bak').catch(e=>{if(e.code!=='ENOENT')throw e;});
      if(process.platform==='darwin') { const error=await shell.openPath(downloadPath);if(error)throw new Error(error);emit({message:'安装包已打开。请退出 App，将新版拖入 Applications 替换后重新打开。'}); }
      else { installing=true;emit({status:'installing'});autoUpdater.quitAndInstall(false,true); }
    } finally {if(!installing)await fetch(`${origin}/api/desktop/update-lock`,{method:'DELETE',headers:{'x-update-token':token}}).catch(()=>{});}
    return state;
  }
  ipcMain.handle('update-action',async(event,action,value)=>{
    if(!trusted(event)) throw new Error('Forbidden');
    if(action==='state') return state;
    if(action==='cancel'){abort?.abort?.();abort?.cancel?.();return state;}
    if(action==='auto-check'){state.autoCheck=Boolean(value);await writeFile(settingsPath,JSON.stringify({autoCheck:state.autoCheck,lastCheckedAt}));return emit({});}
    if(task)return state;
    const work={check,download,install}[action]; if(!work)throw new Error('Invalid action');
    task=work().catch(failure).finally(()=>{task=null;abort=null;});return await task;
  });
  setTimeout(async()=>{
    const settings=await readFile(settingsPath,'utf8').then(JSON.parse).catch(()=>({}));
    emit({autoCheck:settings.autoCheck!==false});
    lastCheckedAt=Number(settings.lastCheckedAt)||0;
    if(state.autoCheck && Date.now()-lastCheckedAt>86400000 && app.isPackaged && !task) {task=check().catch(()=>emit({status:'idle'})).finally(()=>{task=null;});}
  },30000).unref();
}
module.exports={setupUpdater};
