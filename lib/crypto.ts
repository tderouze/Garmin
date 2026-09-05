import crypto from 'crypto';

const ALGO = 'aes-256-gcm';

function getKey(): Buffer {
  const hex = process.env.GARMIN_TOKEN_KEY || '';
  if (hex.length !== 64 || !/^[0-9a-f]+$/i.test(hex)) throw new Error('GARMIN_TOKEN_KEY must be 64 hex chars (32 bytes)');
  return Buffer.from(hex, 'hex');
}

export function encrypt(plain: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decrypt(cipherText: string): string {
  const key = getKey();
  const [ivHex, tagHex, encHex] = cipherText.split(':');
  if (ivHex === undefined || tagHex === undefined || encHex === undefined) throw new Error('Invalid cipher format');
  const hexRe = /^[0-9a-f]+$/i;
  if (!hexRe.test(ivHex) || !hexRe.test(tagHex) || (encHex !== '' && !hexRe.test(encHex))) throw new Error('Invalid cipher format');
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const dec = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
  return dec.toString('utf8');
}
