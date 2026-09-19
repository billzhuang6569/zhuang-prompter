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
const manifest={schemaVersion:1,product:'zhuang-prompter',channel:'stable',version,publishedAt:new Date().toISOString(),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceWorkingTree:true,releaseNotes:'修复 Intel(x64) Mac 与 ARM64 Windows 交叉构建包启动失败（“本机服务未能及时启动 / The local server did not start in time”）：这两个平台在异构 runner 上交叉构建，此前误打入错误架构的 @next/swc / sharp 原生库，导致本机服务无法启动。现按目标架构安装并只保留正确架构的原生库，并在打包时强制校验。0.1.11 的 Intel Mac 与 ARM64 Windows 包受此问题影响，请升级到 0.1.12（Apple Silicon Mac 与 x64 Windows 不受影响）。功能不变；沿用 Mac 拖拽安装、Windows 应用内更新与拍摄保护。',artifacts};
await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
await writeFile(join(dir,'SHA256SUMS'),artifacts.map(a=>`${a.sha256}  ${a.filename}`).join('\n')+'\n');
console.log(JSON.stringify({directory:dir,version,artifacts:artifacts.map(a=>({platform:a.platform,arch:a.arch,bytes:a.bytes}))},null,2));
