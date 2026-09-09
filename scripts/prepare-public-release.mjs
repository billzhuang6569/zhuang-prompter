import {createRequire} from 'node:module';
import {readFile,mkdir,copyFile,writeFile,link} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,basename} from 'node:path';
const require=createRequire(import.meta.url);const updaterRequire=createRequire(require.resolve('electron-updater'));const yaml=updaterRequire('js-yaml');
const pkg=JSON.parse(await readFile('package.json','utf8')),version=pkg.version;
const dir=`release/public/${version}`,base=`https://bill-api.whatonearth.work/prompter/downloads/${version}`;
await mkdir(dir,{recursive:true});
const specs=[['macos','arm64','dmg',`release/zhuang-prompter-${version}-mac-arm64.dmg`,'installer-handoff'],['windows','x64','exe',`release/win-x64/zhuang-prompter-${version}-win-x64.exe`,'in-app-install'],['windows','arm64','exe',`release/win-arm64/zhuang-prompter-${version}-win-arm64.exe`,'in-app-install']];
const artifacts=[];
for(const [platform,arch,format,path,mode] of specs){const bytes=await readFile(path),filename=basename(path);await copyFile(path,join(dir,filename));await link(join(dir,filename),join(dir,`${platform}-${arch}.${format}`)).catch(e=>{if(e.code!=='EEXIST')throw e;});artifacts.push({platform,arch,format,filename,url:`${base}/${filename}`,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),updateMode:mode,minOS:platform==='macos'?'macOS 12+':'Windows 11 (tested)',verification:platform==='macos'?'Apple Silicon local DMG installation':arch==='arm64'?'Windows 11 ARM native':'Windows 11 ARM x64 emulation; native x64 UI not tested'});}
for(const [key,source] of [['macos-arm64','release/latest-mac.yml'],['windows-x64','release/win-x64/latest.yml'],['windows-arm64','release/win-arm64/latest.yml']]){
 const feed=yaml.load(await readFile(source,'utf8'));if(feed.version!==version)throw Error('Feed version mismatch');
 const sourceDir=source.slice(0,source.lastIndexOf('/'));for(const f of feed.files){const name=basename(f.url);const data=await readFile(join(sourceDir,name));if(createHash('sha512').update(data).digest('base64')!==f.sha512||data.length!==f.size)throw Error('Feed checksum mismatch');await copyFile(join(sourceDir,name),join(dir,name));await copyFile(join(sourceDir,name+'.blockmap'),join(dir,name+'.blockmap')).catch(e=>{if(e.code!=='ENOENT')throw e;});f.url=`${base}/${name}`;}
 feed.path=`${base}/${basename(feed.path)}`;await mkdir(join(dir,'updater',key),{recursive:true});await writeFile(join(dir,'updater',key,key.startsWith('macos')?'latest-mac.yml':'latest.yml'),yaml.dump(feed));
}
const manifest={schemaVersion:1,product:'zhuang-prompter',channel:'stable',version,publishedAt:new Date().toISOString(),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceWorkingTree:true,releaseNotes:'全新阅读中线品牌 Logo，统一 Mac、Windows 与应用内视觉；保留 App 内更新和拍摄保护。官网新增主控、热点与多屏同步交互演示。',artifacts};
await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
await writeFile(join(dir,'SHA256SUMS'),artifacts.map(a=>`${a.sha256}  ${a.filename}`).join('\n')+'\n');
console.log(JSON.stringify({directory:dir,version,artifacts:artifacts.map(a=>({platform:a.platform,arch:a.arch,bytes:a.bytes}))},null,2));
