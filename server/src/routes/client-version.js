const {CHANNELS}=require('../domain/client-version');
async function registerClientVersionRoute(app,{releaseRegistry}){if(!releaseRegistry)throw new Error('releaseRegistry is required');app.get('/v1/client/version',async(request,reply)=>{const channel=String(request.headers['x-reviverelay-channel']||'');if(!CHANNELS.includes(channel)||!releaseRegistry[channel])return reply.code(400).send({error:'INVALID_RELEASE_CHANNEL'});reply.header('Cache-Control','public, max-age=300');return releaseRegistry[channel];});}
module.exports={registerClientVersionRoute};
