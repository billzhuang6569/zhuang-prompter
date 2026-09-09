/* eslint-disable @typescript-eslint/no-require-imports */
// Runs only in a disposable Windows Electron clone. No renderer automation.
const {app}=require('electron');
const {autoUpdater}=require('electron-updater');
const fs=require('node:fs');
const result='C:\\prompter-test\\update-engine-result.json';
const events=[];
if(!app.requestSingleInstanceLock())app.exit(0);
const record=(type,data={})=>{events.push({type,...data});fs.writeFileSync(result,JSON.stringify({events},null,2));};
app.whenReady().then(async()=>{
  autoUpdater.autoDownload=false;autoUpdater.autoInstallOnAppQuit=false;autoUpdater.disableDifferentialDownload=true;
  autoUpdater.setFeedURL({provider:'generic',url:'https://bill-api.whatonearth.work/prompter/updates/stable/windows-x64/'});
  let lastProgress=0;autoUpdater.on('download-progress',p=>{if(Date.now()-lastProgress>10000){record('progress',{percent:p.percent,transferred:p.transferred});lastProgress=Date.now();}});
  autoUpdater.on('error',e=>{record('error',{message:e.message});app.exit(1);});
  autoUpdater.on('update-downloaded',()=>{record('downloaded',{version:'0.1.5'});autoUpdater.quitAndInstall(true,true);});
  record('started',{version:app.getVersion(),arch:process.arch});
  try {const found=await autoUpdater.checkForUpdates();record('checked',{version:found?.updateInfo.version});if(found?.updateInfo.version!=='0.1.5')throw Error('Unexpected version');await autoUpdater.downloadUpdate();}catch(e){record('error',{message:e.message});app.exit(1);}
});
