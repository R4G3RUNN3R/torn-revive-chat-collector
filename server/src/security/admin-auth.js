const crypto = require('node:crypto');

function tokenDigest(value) {
  return crypto.createHash('sha256').update(String(value || ''),'utf8').digest();
}

function createAdminAuthenticate({adminToken}) {
  if (typeof adminToken!=='string' || !adminToken) throw new Error('adminToken is required');
  const expected=tokenDigest(adminToken);
  return async function adminAuthenticate(request,reply) {
    const supplied=request && request.headers && request.headers['x-reviverelay-admin-token'];
    const actual=tokenDigest(typeof supplied==='string'?supplied:'');
    if (!crypto.timingSafeEqual(expected,actual)) {
      return reply.code(401).send({error:'ADMIN_AUTH_REQUIRED'});
    }
  };
}

module.exports={createAdminAuthenticate};
