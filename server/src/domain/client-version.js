const HTTPS_URL=/^https:\/\//i;
const CHANNELS=Object.freeze(['review','stable']);
function parseClientVersion(value){const match=String(value??'').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);if(!match)throw new Error('Invalid ReviveRelay version');return match.slice(1).map(Number);}
function compareClientVersions(a,b){const left=parseClientVersion(a),right=parseClientVersion(b);for(let i=0;i<3;i+=1){if(left[i]>right[i])return 1;if(left[i]<right[i])return -1;}return 0;}
function meetsMinimum(current,minimum){return compareClientVersions(current,minimum)>=0;}
function assertExactKeys(value,expected,label){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`Invalid release manifest ${label}`);const actual=Object.keys(value).sort(),wanted=[...expected].sort();if(actual.length!==wanted.length||actual.some((key,i)=>key!==wanted[i]))throw new Error(`Invalid release manifest ${label}`);}
function validTimestamp(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&!Number.isNaN(Date.parse(value));}
function validateReleaseManifest(manifest){
 assertExactKeys(manifest,['latestVersion','minimumVersion','buildTimestamp','releaseNotes','gitCommit','releaseChannel','sha256','apiCompatibility','install','mandatory'],'fields');
 parseClientVersion(manifest.latestVersion);parseClientVersion(manifest.minimumVersion);if(compareClientVersions(manifest.minimumVersion,manifest.latestVersion)>0)throw new Error('Invalid minimum version');
 if(!validTimestamp(manifest.buildTimestamp))throw new Error('Invalid build timestamp');if(typeof manifest.releaseNotes!=='string'||manifest.releaseNotes.length>4000)throw new Error('Invalid release notes');if(typeof manifest.gitCommit!=='string'||!/^[0-9a-f]{40}$/.test(manifest.gitCommit))throw new Error('Invalid Git commit');if(!CHANNELS.includes(manifest.releaseChannel))throw new Error('Invalid release channel');if(typeof manifest.sha256!=='string'||!/^[0-9a-f]{64}$/.test(manifest.sha256))throw new Error('Invalid SHA-256');if(typeof manifest.mandatory!=='boolean')throw new Error('Invalid mandatory flag');
 assertExactKeys(manifest.apiCompatibility,['minimum','current'],'API compatibility fields');if(!Number.isInteger(manifest.apiCompatibility.minimum)||!Number.isInteger(manifest.apiCompatibility.current)||manifest.apiCompatibility.minimum<1||manifest.apiCompatibility.current<manifest.apiCompatibility.minimum)throw new Error('Invalid API compatibility');
 assertExactKeys(manifest.install,['installUrl','metaUrl'],'install fields');for(const [label,url] of [['install',manifest.install.installUrl],['meta',manifest.install.metaUrl]])if(typeof url!=='string'||!HTTPS_URL.test(url))throw new Error(`Invalid ${label} URL`);
 const channelSegment=`/releases/${manifest.releaseChannel}/`;if(!manifest.install.installUrl.includes(channelSegment)||!manifest.install.metaUrl.includes(channelSegment))throw new Error('Release channel URL mismatch');
 const versionSegment=`/${manifest.latestVersion}/ReviveRelay-${manifest.latestVersion}`;if(!manifest.install.installUrl.includes(`${versionSegment}.user.js`)||!manifest.install.metaUrl.includes(`${versionSegment}.meta.js`))throw new Error('Release version URL mismatch');
 return JSON.parse(JSON.stringify(manifest));
}
module.exports={CHANNELS,parseClientVersion,compareClientVersions,meetsMinimum,validateReleaseManifest};
