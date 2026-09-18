import {createRequire} from 'node:module';
import {readFile,mkdir,copyFile,writeFile,link} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,basename} from 'node:path';
const require=createRequire(import.meta.url);const updaterRequire=createRequire(require.resolve('electron-updater'));const yaml=updaterRequire('js-yaml');
const pkg=JSON.parse(await readFile('package.json','utf8')),version=pkg.version;
const dir=`release/public/${version}`,base=`https://bill-api.whatonearth.work/prompter/downloads/${version}`;
await mkdir(dir,{recursive:true});
const specs=[['macos','arm64','dmg',`release/zhuang-prompter-${version}-mac-arm64.dmg`,'installer-handoff'],['macos','x64','dmg',`release/mac-x64/zhuang-prompter-${version}-mac-x64.dmg`,'installer-handoff'],['windows','x64','exe',`release/win-x64/zhuang-prompter-${version}-win-x64.exe`,'in-app-install'],['windows','arm64','exe',`release/win-arm64/zhuang-prompter-${version}-win-arm64.exe`,'in-app-install']];
const artifacts=[];
for(const [platform,arch,format,path,mode] of specs){const bytes=await readFile(path),filename=basename(path);await copyFile(path,join(dir,filename));await link(join(dir,filename),join(dir,`${platform}-${arch}.${format}`)).catch(e=>{if(e.code!=='EEXIST')throw e;});artifacts.push({platform,arch,format,filename,url:`${base}/${filename}`,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),updateMode:mode,minOS:platform==='macos'?'macOS 12+':'Windows 11 (tested)',verification:platform==='macos'?(arch==='arm64'?'Apple Silicon local DMG installation':'Intel (x64) local DMG installation'):arch==='arm64'?'Windows 11 ARM native':'Windows 11 ARM x64 emulation; native x64 UI not tested'});}
for(const [key,source] of [['macos-arm64','release/latest-mac.yml'],['macos-x64','release/mac-x64/latest-mac.yml'],['windows-x64','release/win-x64/latest.yml'],['windows-arm64','release/win-arm64/latest.yml']]){
 const feed=yaml.load(await readFile(source,'utf8'));if(feed.version!==version)throw Error('Feed version mismatch');
 const sourceDir=source.slice(0,source.lastIndexOf('/'));for(const f of feed.files){const name=basename(f.url);const data=await readFile(join(sourceDir,name));if(createHash('sha512').update(data).digest('base64')!==f.sha512||data.length!==f.size)throw Error('Feed checksum mismatch');await copyFile(join(sourceDir,name),join(dir,name));await copyFile(join(sourceDir,name+'.blockmap'),join(dir,name+'.blockmap')).catch(e=>{if(e.code!=='ENOENT')throw e;});f.url=`${base}/${name}`;}
 feed.path=`${base}/${basename(feed.path)}`;await mkdir(join(dir,'updater',key),{recursive:true});await writeFile(join(dir,'updater',key,key.startsWith('macos')?'latest-mac.yml':'latest.yml'),yaml.dump(feed));
}
const manifest={schemaVersion:1,product:'zhuang-prompter',channel:'stable',version,publishedAt:new Date().toISOString(),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceWorkingTree:true,releaseNotes:'新增 Intel(x64) 芯片 Mac 安装包：Intel Mac 用户可直接下载对应 DMG 并获得 App 内更新提示。macOS 现覆盖 Apple Silicon 与 Intel 两种架构；Windows（x64 / ARM64）不变。沿用 Mac 拖拽安装、Windows 应用内更新与拍摄保护。',artifacts};
await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
await writeFile(join(dir,'SHA256SUMS'),artifacts.map(a=>`${a.sha256}  ${a.filename}`).join('\n')+'\n');
console.log(JSON.stringify({directory:dir,version,artifacts:artifacts.map(a=>({platform:a.platform,arch:a.arch,bytes:a.bytes}))},null,2));
