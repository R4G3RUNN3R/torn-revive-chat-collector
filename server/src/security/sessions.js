const {
  randomBytes,
  createHmac
} = require('node:crypto');

function newSessionToken() {
  return randomBytes(32).toString('base64url');
}

function hashSessionToken(token, pepper) {
  if (typeof token !== 'string' || token.length === 0) {
    throw new TypeError('Session token is required');
  }
  if (typeof pepper !== 'string' || pepper.length === 0) {
    throw new TypeError('Session token pepper is required');
  }

  return createHmac('sha256', pepper)
    .update(token, 'utf8')
    .digest('hex');
}

module.exports = {
  newSessionToken,
  hashSessionToken
};
