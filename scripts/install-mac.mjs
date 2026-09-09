import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';

if (process.platform !== 'darwin') throw new Error('This installer is for macOS.');
const root = resolve(import.meta.dirname, '..');
if (process.argv.includes('--help')) {
  console.log('Usage: npm run install:mac -- [--dry-run]\nBuild and install the current version in /Applications. Archive the previously installed version, then remove only verified old copies from this project release directory. Room data is untouched.');
  process.exit(0);
}
const name = '庄Sir的提词器.app';
const bundleId = 'com.zhuangsir.prompter';
const destination = join('/Applications', name);
const version = JSON.parse(readFileSync(join(root, 'package.json'))).version;
const plistValue = (app, key) => execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, join(app, 'Contents/Info.plist')], {encoding:'utf8'}).trim();
const verify = app => { if (plistValue(app,'CFBundleIdentifier') !== bundleId) throw new Error(`Unexpected application: ${app}`); };
const run = (file,args) => { const result=spawnSync(file,args,{cwd:root,stdio:'inherit',env:process.env}); if(result.status!==0) throw new Error(`${file} failed (${result.status})`); };
if (existsSync(destination)) {
  verify(destination);
  const current = plistValue(destination, 'CFBundleShortVersionString');
  if (current.localeCompare(version, undefined, {numeric:true}) > 0) throw new Error(`Refusing downgrade from ${current} to ${version}`);
  if (spawnSync('/usr/bin/pgrep',['-f',join(destination,'Contents/MacOS/庄Sir的提词器')]).status === 0) throw new Error('请先退出庄Sir的提词器，再安装。');
}
if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify({ version, destination, backupDirectory: join(root,'release/backups.noindex'), cleanupDirectories: [join(root,'release/mac-arm64'),join(root,'release/backups')], requiredBundleId: bundleId }, null, 2));
  process.exit(0);
}
run(process.execPath, ['node_modules/next/dist/bin/next','build','--webpack']);
run(process.execPath, ['scripts/build-desktop-server.mjs']);
const output = join(root,'release/build.noindex');
run(process.execPath, ['node_modules/electron-builder/cli.js','--mac','--dir',`--config.directories.output=${output}`,'--publish','never']);
const built = join(output, process.arch === 'arm64' ? 'mac-arm64' : 'mac', name);
verify(built);
if (plistValue(built,'CFBundleShortVersionString') !== version) throw new Error('Built version mismatch');
const backups = join(root,'release/backups.noindex');
mkdirSync(backups,{recursive:true});
const stamp = new Date().toISOString().replace(/[:.]/g,'-');
const staging = join('/Applications',`.zhuang-prompter-install-${stamp}`);
run('/usr/bin/ditto',[built,staging]);
verify(staging);
if (existsSync(destination)) {
  const archive = join(backups,`previous-${plistValue(destination,'CFBundleShortVersionString')}-${stamp}.zip`);
  run('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',destination,archive]);
  const check=spawnSync('/usr/bin/unzip',['-tq',archive],{stdio:'ignore'});
  if(check.status!==0) throw new Error('Backup verification failed; existing application retained');
}
const previous = join('/Applications',`.zhuang-prompter-previous-${stamp}`);
if(existsSync(destination)) renameSync(destination,previous);
try { renameSync(staging,destination); verify(destination); }
catch(error) { if(existsSync(destination)) renameSync(destination,staging); if(existsSync(previous)) renameSync(previous,destination); throw error; }
// Exact bundle identity is verified before removing any old executable copy.
const oldCopies=[previous,built,join(root,'release/mac-arm64',name)];
const legacy=join(root,'release/backups');
if(existsSync(legacy)) for(const entry of readdirSync(legacy)) if(entry.endsWith('.app')) oldCopies.push(join(legacy,entry));
const lsregister='/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
for(const app of oldCopies) if(existsSync(app)) { verify(app); if(plistValue(app,'CFBundleShortVersionString').localeCompare(version,undefined,{numeric:true}) > 0) throw new Error(`Refusing to remove newer app: ${app}`); spawnSync(lsregister,['-u',app]); rmSync(app,{recursive:true}); }
run(lsregister,['-f',destination]);
console.log(`Installed ${version}: ${destination}\nPrevious installed version archived in ${backups}`);
