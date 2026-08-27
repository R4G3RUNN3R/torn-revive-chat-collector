const fs=require('node:fs'); const path=require('node:path');
const root=path.resolve(__dirname,'..'); const source=path.join(root,'torn-revive-chat-collector.user.js'); const outDir=path.join(root,'dist'); const version=require(path.join(root,'package.json')).version;
const requiredSupportModules=['src/core.js','src/chat-dom.js','src/public-channels.js','src/client-chat-policy.js','src/api-client.js','src/versioning.js','src/update-manager.js','src/telemetry-client.js','src/revive-classifier.js','src/candidate-pipeline.js'];
const AUTO_UPDATE='https://reviverelay.voidsmithindustries.com/install/reviverelay-auto.meta.js';
const AUTO_DOWNLOAD='https://reviverelay.voidsmithindustries.com/install/reviverelay-auto.user.js';
function ensureSource(text){ for(const marker of ['__REVIVERELAY_VERSION__','__REVIVERELAY_UPDATE_URL__','__REVIVERELAY_DOWNLOAD_URL__','__REVIVERELAY_UPDATE_CHANNEL__']) if(!text.includes(marker)) throw new Error(`Missing build marker ${marker}`); }
function variant(sourceText,{updateUrl,downloadUrl,channel}) { const output=sourceText.replaceAll('__REVIVERELAY_VERSION__',version).replace('__REVIVERELAY_UPDATE_URL__',updateUrl).replace('__REVIVERELAY_DOWNLOAD_URL__',downloadUrl).replace('__REVIVERELAY_UPDATE_CHANNEL__',channel); if(/__REVIVERELAY_(?:VERSION|UPDATE_URL|DOWNLOAD_URL|UPDATE_CHANNEL)__/.test(output)) throw new Error('Unresolved ReviveRelay build marker'); return output; }
function metadataOnly(text){ const end=text.indexOf('// ==/UserScript=='); if(end<0) throw new Error('Userscript metadata header missing'); return `${text.slice(0,end+'// ==/UserScript=='.length)}\n`; }
if(!fs.existsSync(source)) throw new Error('Installable userscript not found.');
for(const relativePath of requiredSupportModules) if(!fs.existsSync(path.join(root,relativePath))) throw new Error(`Required userscript support module not found: ${relativePath}`);
const sourceText=fs.readFileSync(source,'utf8'); ensureSource(sourceText); fs.mkdirSync(outDir,{recursive:true});
const auto=variant(sourceText,{updateUrl:AUTO_UPDATE,downloadUrl:AUTO_DOWNLOAD,channel:'automatic'});
const manual=variant(sourceText,{updateUrl:'none',downloadUrl:'none',channel:'manual'});
fs.writeFileSync(path.join(outDir,'reviverelay-auto.user.js'),auto);
fs.writeFileSync(path.join(outDir,'reviverelay-auto.meta.js'),metadataOnly(auto));
fs.writeFileSync(path.join(outDir,'reviverelay-manual.user.js'),manual);
console.log('Built automatic/manual ReviveRelay client artifacts');
module.exports={variant,metadataOnly};
