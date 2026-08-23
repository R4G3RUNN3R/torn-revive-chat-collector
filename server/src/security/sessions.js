const { randomBytes, createHash } = require('node:crypto');

function newSessionToken() {
  return randomBytes(32).toString('base64url');
}

function hashSessionToken(token, pepper) {
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('Session token is required');
  }
  if (typeof pepper !== 'string' || pepper.length === 0) {
    throw new Error('Session token pepper is required');
  }

  return createHash('sha256')
    .update(pepper, 'utf8')
    .update('\0', 'utf8')
    .update(token, 'utf8')
    .digest('hex');
}

module.exports = {
  newSessionToken,
  hashSessionToken
};
