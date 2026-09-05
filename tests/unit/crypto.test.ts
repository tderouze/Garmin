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
});
