const {
  randomBytes,
  createCipheriv,
  createDecipheriv
} = require('node:crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

function parseKey(keyHex) {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex || '')) {
    throw new Error('Encryption key must be 64 hexadecimal characters');
  }
  return Buffer.from(keyHex, 'hex');
}

function encryptSecret(plaintext, keyHex) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('Secret plaintext is required');
  }

  const key = parseKey(keyHex);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex')
  };
}

function decryptSecret(record, keyHex) {
  if (!record || !record.ciphertext || !record.iv || !record.tag) {
    throw new Error('Encrypted secret record is incomplete');
  }

  const key = parseKey(keyHex);
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(record.iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(record.tag, 'hex'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, 'hex')),
    decipher.final()
  ]);

  return plaintext.toString('utf8');
}

module.exports = {
  encryptSecret,
  decryptSecret
};
