import { describe, expect, it } from 'vitest';
import { formaterDate, formaterMontant } from '../../src/core/format.ts';

const F = ' ';

describe('formaterMontant', () => {
  it.each([
    [0, '0,00'],
    [5, '0,05'],
    [99, '0,99'],
    [100, '1,00'],
    [123456, `1${F}234,56`],
    [-123456, `-1${F}234,56`],
    [-7, '-0,07'],
    [100000000, `1${F}000${F}000,00`],
    [Number.MAX_SAFE_INTEGER, `90${F}071${F}992${F}547${F}409,91`],
  ])('%i centimes → %s', (centimes, attendu) => {
    expect(formaterMontant(centimes)).toBe(attendu);
  });

  it('refuse les montants non entiers ou hors plage', () => {
    expect(() => formaterMontant(12.5)).toThrow(RangeError);
    expect(() => formaterMontant(Number.NaN)).toThrow(RangeError);
    expect(() => formaterMontant(2 ** 53)).toThrow(RangeError);
  });
});

describe('formaterDate', () => {
  it('convertit AAAA-MM-JJ en JJ/MM/AAAA', () => {
    expect(formaterDate('2026-10-08')).toBe('08/10/2026');
    expect(formaterDate('2024-02-29')).toBe('29/02/2024');
  });

  it('refuse les formats et dates invalides', () => {
    expect(() => formaterDate('20261008')).toThrow(RangeError);
    expect(() => formaterDate('08/10/2026')).toThrow(RangeError);
    expect(() => formaterDate('2025-02-29')).toThrow(RangeError);
    expect(() => formaterDate('2026-13-01')).toThrow(RangeError);
  });
});
