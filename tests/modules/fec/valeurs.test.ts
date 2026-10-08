import { describe, expect, it } from 'vitest';
import { lireDate, lireMontant, lireSens } from '../../../src/modules/fec/import/valeurs.ts';

describe('lireMontant', () => {
  it.each([
    ['1234,56', 123456, {}],
    ['0,00', 0, {}],
    ['12,5', 1250, {}],
    ['-12,00', -1200, { signe: true }],
    ['12,00-', -1200, { signe: true }],
    ['+12,00', 1200, {}],
    ['1234.56', 123456, { pointDecimal: true }],
    ['1 234,56', 123456, { milliers: true }],
    ['1 234,56', 123456, { milliers: true }],
    ['1.234,56', 123456, { milliers: true }],
    ['1,234.56', 123456, { milliers: true, pointDecimal: true }],
    ['1.234.567', 123456700, { milliers: true }],
    ['10', 1000, {}],
    ['0,125', 13, {}],
    ['1E3', 100000, {}],
  ] as [string, number, { pointDecimal?: boolean; milliers?: boolean; signe?: boolean }][])('« %s » → %i centimes', (texte, centimes, drapeaux) => {
    const m = lireMontant(texte);
    expect(m.centimes).toBe(centimes);
    expect(m.invalide).toBe(false);
    expect(m.pointDecimal).toBe(drapeaux.pointDecimal ?? false);
    expect(m.milliers).toBe(drapeaux.milliers ?? false);
    expect(m.signe).toBe(drapeaux.signe ?? false);
  });

  it('accepte le point décimal sans le signaler en XML', () => {
    expect(lireMontant('1234.56', true)).toMatchObject({ centimes: 123456, pointDecimal: false });
  });

  it.each(['néant', '12,34,56', '1-2', 'abc', '--5'])('rejette « %s »', (texte) => {
    expect(lireMontant(texte).invalide).toBe(true);
  });

  it('distingue la valeur vide', () => {
    expect(lireMontant('  ')).toMatchObject({ vide: true, centimes: 0, invalide: false });
  });
});

describe('lireDate', () => {
  it.each([
    ['20250131', 20250131, false],
    ['2025-01-31', 20250131, true],
    ['31/01/2025', 20250131, true],
    ['31.01.2025', 20250131, true],
    ['20250131 10:12:00', 20250131, true],
    ['2024-02-29T00:00:00', 20240229, true],
  ])('« %s » → %i (hors format : %s)', (texte, valeur, horsFormat) => {
    expect(lireDate(texte)).toMatchObject({ valeur, horsFormat });
  });

  it.each(['20250231', '20251301', '2025013', 'hier', '31/02/2025', '18991231'])('« %s » est invalide', (texte) => {
    expect(lireDate(texte).valeur).toBe(-1);
  });

  it('repère les dates vides et remplies de zéros', () => {
    expect(lireDate('')).toMatchObject({ valeur: 0, zeros: false });
    expect(lireDate('00000000')).toMatchObject({ valeur: 0, zeros: true });
  });

  it('AAAA-MM-JJ est la norme en XML', () => {
    expect(lireDate('2025-01-31', true)).toMatchObject({ valeur: 20250131, horsFormat: false });
    expect(lireDate('20250131', true)).toMatchObject({ valeur: 20250131, horsFormat: true });
  });
});

describe('lireSens', () => {
  it.each([
    ['D', 'D', true],
    ['c', 'C', true],
    ['+1', 'D', true],
    ['-1', 'C', true],
    ['+ 1', 'D', false],
    ['X', null, false],
  ])('« %s »', (texte, sens, conforme) => {
    expect(lireSens(texte)).toEqual({ sens, conforme });
  });
});
