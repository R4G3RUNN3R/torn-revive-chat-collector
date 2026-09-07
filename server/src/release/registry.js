const fs=require('node:fs');
const {validateReleaseManifest,CHANNELS}=require('../domain/client-version');
function deepFreeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const item of Object.values(value))deepFreeze(item);}return value;}
function loadReleaseManifest(file){try{return deepFreeze(validateReleaseManifest(JSON.parse(fs.readFileSync(file,'utf8'))));}catch(error){throw new Error(`Invalid ReviveRelay release manifest: ${error.message}`);}}
function loadReleaseRegistry(files){if(!files||typeof files!=='object')throw new Error('Release registry files are required');const registry={};for(const channel of CHANNELS){if(!files[channel])throw new Error(`Missing ${channel} release manifest`);const manifest=loadReleaseManifest(files[channel]);if(manifest.releaseChannel!==channel)throw new Error(`Release manifest channel mismatch: ${channel}`);registry[channel]=manifest;}return deepFreeze(registry);}
module.exports={loadReleaseManifest,loadReleaseRegistry,deepFreeze};
