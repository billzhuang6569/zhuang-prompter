const ORIGIN = 'https://bill-api.whatonearth.work';
function safeUrl(value) {
  const u = new URL(value);
  if (u.origin !== ORIGIN || !u.pathname.startsWith('/prompter/downloads/') || u.username || u.password) throw new Error('更新地址无效');
  return u.href;
}
function newer(a, b) {
  if (!/^\d+\.\d+\.\d+$/.test(a)) return false;
  const x=a.split('.').map(Number), y=b.split('.').map(Number);
  for(let i=0;i<3;i++) { if(x[i]!==y[i]) return x[i]>y[i]; } return false;
}
function selectArtifact(manifest, platform, arch, current) {
  if(manifest.product!=='zhuang-prompter' || manifest.schemaVersion!==1) throw new Error('更新信息无效');
  if(!newer(manifest.version,current)) return null;
  const file=manifest.artifacts.find(f=>f.platform===platform && f.arch===arch && f.format===(platform==='macos'?'dmg':'exe'));
  if(!file || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes<=0) throw new Error('没有适合这台电脑的更新包');
  return {...file,url:safeUrl(file.url)};
}
module.exports={safeUrl,newer,selectArtifact};
