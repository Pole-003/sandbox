import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Sha256, sha256 } from '../../src/core/sha256.ts';

describe('SHA-256 incrémental', () => {
  it('vecteurs FIPS 180-4', () => {
    expect(sha256(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('donne la même empreinte quel que soit le découpage en morceaux', () => {
    const donnees = new Uint8Array(100_003).map((_, i) => (i * 31 + 7) & 0xff);
    const attendu = createHash('sha256').update(donnees).digest('hex');
    for (const taille of [1, 63, 64, 65, 1000, 65_536]) {
      const h = new Sha256();
      for (let i = 0; i < donnees.length; i += taille) h.ajouter(donnees.subarray(i, i + taille));
      expect(h.terminer()).toBe(attendu);
    }
  });
});
