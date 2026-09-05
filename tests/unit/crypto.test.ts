import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '@/lib/crypto';

describe('crypto AES-256-GCM', () => {
  it('round-trips', () => {
    const plain = 'garmin-token-123';
    const enc = encrypt(plain);
    expect(enc).not.toBe(plain);
    expect(decrypt(enc)).toBe(plain);
  });
  it('fails on tampered cipher', () => {
    expect(() => decrypt('tampered')).toThrow();
  });
  it('fails GCM auth on tampered ciphertext bytes', () => {
    const enc = encrypt('hello-garmin');
    const parts = enc.split(':');
    // tamper encHex: flip last hex char (keep valid hex charset so it passes format check but fails GCM auth)
    const encHex = parts[2];
    const tamperedHex = encHex.length > 0
      ? encHex.slice(0, -1) + (encHex.slice(-1) === '0' ? '1' : '0')
      : '00';
    const tampered = `${parts[0]}:${parts[1]}:${tamperedHex}`;
    expect(() => decrypt(tampered)).toThrow();
    // also tamper tag to ensure auth failure path
    const tagHex = parts[1];
    const tamperedTag = tagHex.slice(0, -1) + (tagHex.slice(-1) === '0' ? '1' : '0');
    const tamperedTagCipher = `${parts[0]}:${tamperedTag}:${parts[2]}`;
    expect(() => decrypt(tamperedTagCipher)).toThrow();
  });
});
