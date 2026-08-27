const HTTPS_URL = /^https:\/\//i;
function parseClientVersion(value) {
  const match = String(value ?? '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error('Invalid ReviveRelay version');
  return match.slice(1).map(Number);
}
function compareClientVersions(a,b) {
  const left=parseClientVersion(a), right=parseClientVersion(b);
  for (let i=0;i<3;i+=1) { if(left[i]>right[i]) return 1; if(left[i]<right[i]) return -1; }
  return 0;
}
function meetsMinimum(current,minimum){ return compareClientVersions(current,minimum)>=0; }
function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid release manifest ${label}`);
  const actual=Object.keys(value).sort(), wanted=[...expected].sort();
  if (actual.length!==wanted.length || actual.some((key,i)=>key!==wanted[i])) throw new Error(`Invalid release manifest ${label}`);
}
function validateReleaseManifest(manifest) {
  assertExactKeys(manifest,['latestVersion','minimumVersion','releasedAt','releaseNotes','gitCommit','automatic','manual','mandatory'],'fields');
  parseClientVersion(manifest.latestVersion); parseClientVersion(manifest.minimumVersion);
  if(compareClientVersions(manifest.minimumVersion,manifest.latestVersion)>0) throw new Error('Invalid minimum version');
  if(typeof manifest.releaseNotes!=='string' || manifest.releaseNotes.length>4000) throw new Error('Invalid release notes');
  if(typeof manifest.releasedAt!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(manifest.releasedAt) || Number.isNaN(Date.parse(manifest.releasedAt))) throw new Error('Invalid releasedAt timestamp');
  if(typeof manifest.gitCommit!=='string' || !/^[0-9a-f]{40}$/.test(manifest.gitCommit)) throw new Error('Invalid Git commit');
  if(typeof manifest.mandatory!=='boolean') throw new Error('Invalid mandatory flag');
  assertExactKeys(manifest.automatic,['installUrl','metaUrl','sha256'],'automatic fields');
  assertExactKeys(manifest.manual,['installUrl','sha256'],'manual fields');
  for (const [label,url] of [['automatic install',manifest.automatic.installUrl],['automatic meta',manifest.automatic.metaUrl],['manual install',manifest.manual.installUrl]]) {
    if(typeof url!=='string'||!HTTPS_URL.test(url)) throw new Error(`Invalid ${label} URL`);
  }
  for (const sha of [manifest.automatic.sha256,manifest.manual.sha256]) if(typeof sha!=='string'||!/^[0-9a-f]{64}$/.test(sha)) throw new Error('Invalid SHA-256');
  return JSON.parse(JSON.stringify(manifest));
}
module.exports={parseClientVersion,compareClientVersions,meetsMinimum,validateReleaseManifest};
