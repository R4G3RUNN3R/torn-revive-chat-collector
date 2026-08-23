const {
  randomBytes,
  createCipheriv,
  createDecipheriv
} = require('node:crypto');

function parseKey(keyHex) {
  if (typeof keyHex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error('Encryption key must be exactly 64 hexadecimal characters');
  }
  return Buffer.from(keyHex, 'hex');
}

function encryptSecret(plaintext, keyHex) {
  if (typeof plaintext !== 'string') {
    throw new TypeError('Secret must be a string');
  }

  const key = parseKey(keyHex);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64')
  };
}

function decryptSecret(record, keyHex) {
  if (!record || typeof record !== 'object') {
    throw new TypeError('Encrypted secret record is required');
  }

  const key = parseKey(keyHex);
  const iv = Buffer.from(record.iv, 'base64');
  const tag = Buffer.from(record.tag, 'base64');
  const ciphertext = Buffer.from(record.ciphertext, 'base64');

  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error('Encrypted secret record is malformed');
  }

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]).toString('utf8');
}

module.exports = {
  encryptSecret,
  decryptSecret
};
