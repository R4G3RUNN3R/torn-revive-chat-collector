const {meetsMinimum}=require('../domain/client-version');
const PROTECTED=[
  ['POST',/^\/v1\/requests$/],
  ['POST',/^\/v1\/requests\/[^/]+\/(?:cancel|accept)$/],
  ['POST',/^\/v1\/transactions\/[^/]+\/(?:check-payment|retry-request|retry-response|request-refund|check-refund)$/]
];
function isProtectedMarketplaceMutation(method,url){const clean=String(url||'').split('?')[0]; return PROTECTED.some(([verb,pattern])=>verb===String(method||'').toUpperCase()&&pattern.test(clean));}
function checkClientVersion({current,releaseRegistry}){if(!releaseRegistry) return {allowed:true}; try{return {allowed:meetsMinimum(current,releaseRegistry.minimumVersion)};}catch(_){return {allowed:false};}}
function createClientVersionPreHandler({releaseRegistry}){if(!releaseRegistry) throw new Error('releaseRegistry is required'); return async function clientVersionPreHandler(request,reply){if(!isProtectedMarketplaceMutation(request.method,request.url)) return; const result=checkClientVersion({current:request.headers['x-reviverelay-version'],releaseRegistry}); if(result.allowed) return; return reply.code(426).send({error:'CLIENT_UPDATE_REQUIRED',latestVersion:releaseRegistry.latestVersion,minimumVersion:releaseRegistry.minimumVersion,installUrl:releaseRegistry.automatic.installUrl});};}
module.exports={checkClientVersion,isProtectedMarketplaceMutation,createClientVersionPreHandler};
