(function(root,factory){const api=factory(root&&root.ReviveRelayVersioning); if(typeof module==='object'&&module.exports) module.exports=api; if(root) root.ReviveRelayUpdateManager=api;})(typeof globalThis!=='undefined'?globalThis:this,function(browserVersioning){
'use strict';
const DAY_MS=86_400_000;
function versioning(){if(browserVersioning) return browserVersioning; if(typeof require==='function') return require('./versioning'); throw new Error('ReviveRelay versioning unavailable');}
function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
function validateManifest(input){
 const {compareVersions}=versioning();
 if(!input||typeof input!=='object'||Array.isArray(input)) throw new Error('Invalid manifest');
 for(const key of ['latestVersion','minimumVersion','releasedAt','releaseNotes','gitCommit','automatic','manual','mandatory']) if(!(key in input)) throw new Error('Invalid manifest');
 compareVersions(input.latestVersion,input.minimumVersion);
 if(compareVersions(input.minimumVersion,input.latestVersion)>0) throw new Error('Invalid manifest minimum');
 if(typeof input.releaseNotes!=='string'||input.releaseNotes.length>4000||typeof input.releasedAt!=='string'||Number.isNaN(Date.parse(input.releasedAt))||typeof input.gitCommit!=='string'||!/^[0-9a-f]{40}$/.test(input.gitCommit)||typeof input.mandatory!=='boolean') throw new Error('Invalid manifest');
 for(const item of [input.automatic,input.manual]) if(!item||typeof item!=='object'||typeof item.installUrl!=='string'||!/^https:\/\//i.test(item.installUrl)||typeof item.sha256!=='string'||!/^[0-9a-f]{64}$/.test(item.sha256)) throw new Error('Invalid manifest');
 if(typeof input.automatic.metaUrl!=='string'||!/^https:\/\//i.test(input.automatic.metaUrl)) throw new Error('Invalid manifest');
 return clone(input);
}
function createUpdateManager({currentVersion,channel,fetchManifest,getState,saveState,now=Date.now,openUrl}){
 const {compareVersions}=versioning();
 if(typeof fetchManifest!=='function'||typeof getState!=='function'||typeof saveState!=='function'||typeof openUrl!=='function') throw new Error('Update manager dependencies are required');
 function read(){const value=getState(); return value&&typeof value==='object'?clone(value):{};}
 function write(state){const next={lastCheckedAt:Number(state.lastCheckedAt||0),lastManifest:state.lastManifest?clone(state.lastManifest):null,dismissedVersion:state.dismissedVersion||null}; saveState(next); return next;}
 function describe(manifest,state,extra={}){if(!manifest) return {updateAvailable:false,mandatory:false,supported:true,...extra}; const updateAvailable=compareVersions(manifest.latestVersion,currentVersion)>0; const supported=compareVersions(currentVersion,manifest.minimumVersion)>=0; const dismissed=Boolean(updateAvailable&&!manifest.mandatory&&state.dismissedVersion===manifest.latestVersion); return {manifest:clone(manifest),latestVersion:manifest.latestVersion,minimumVersion:manifest.minimumVersion,updateAvailable,mandatory:manifest.mandatory,supported,dismissed,...extra};}
 async function check({force=false}={}){let state=read(); const timestamp=Number(now()); if(!force&&state.lastCheckedAt&&timestamp-state.lastCheckedAt<DAY_MS) return describe(state.lastManifest,state,{skipped:true,lastCheckedAt:state.lastCheckedAt}); try{const manifest=validateManifest(await fetchManifest()); if(state.dismissedVersion&&state.dismissedVersion!==manifest.latestVersion) state.dismissedVersion=null; state=write({...state,lastCheckedAt:timestamp,lastManifest:manifest}); return describe(manifest,state,{skipped:false,lastCheckedAt:timestamp});}catch(_){state=write({...state,lastCheckedAt:timestamp}); return {error:'INVALID_MANIFEST',updateAvailable:false,mandatory:false,supported:true,skipped:false,lastCheckedAt:timestamp};}}
 function dismiss(version){let state=read(); const manifest=state.lastManifest; if(!manifest||manifest.mandatory||manifest.latestVersion!==version) return false; state=write({...state,dismissedVersion:version}); return true;}
 function switchChannel(target){const state=read(), manifest=state.lastManifest; if(!manifest||!['automatic','manual'].includes(target)||target===channel) return false; const url=target==='automatic'?manifest.automatic.installUrl:manifest.manual.installUrl; openUrl(url); return true;}
 return Object.freeze({check,dismiss,switchChannel,getState:read});
}
return Object.freeze({DAY_MS,validateManifest,createUpdateManager});
});
