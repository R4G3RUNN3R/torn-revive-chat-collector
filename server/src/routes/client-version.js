async function registerClientVersionRoute(app,{releaseRegistry}){if(!releaseRegistry) throw new Error('releaseRegistry is required'); app.get('/v1/client/version',async(_request,reply)=>{reply.header('Cache-Control','public, max-age=300'); return releaseRegistry;});}
module.exports={registerClientVersionRoute};
