const fs=require('node:fs'); const {validateReleaseManifest}=require('../domain/client-version');
function deepFreeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value); for(const item of Object.values(value)) deepFreeze(item);} return value;}
function loadReleaseManifest(file){try{const parsed=JSON.parse(fs.readFileSync(file,'utf8')); return deepFreeze(validateReleaseManifest(parsed));}catch(error){throw new Error(`Invalid ReviveRelay release manifest: ${error.message}`);}}
module.exports={loadReleaseManifest,deepFreeze};
