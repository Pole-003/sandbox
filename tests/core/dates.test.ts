import { describe, expect, it } from 'vitest';
import {
  ajouterJours,
  ajouterMois,
  ecartJours,
  estDateIso,
  estJourOuvre,
  finDeMois,
  jourFerie,
  jourSemaine,
  paques,
} from '../../src/core/dates.ts';

describe('dates ISO', () => {
  it('valide les dates existantes', () => {
    expect(estDateIso('2024-02-29')).toBe(true);
    expect(estDateIso('2025-02-29')).toBe(false);
    expect(estDateIso('2025-13-01')).toBe(false);
    expect(estDateIso('20250101')).toBe(false);
  });

  it('calcule jours, mois et fins de mois', () => {
    expect(ajouterJours('2025-12-31', 1)).toBe('2026-01-01');
    expect(ajouterJours('2025-03-01', -1)).toBe('2025-02-28');
    expect(ecartJours('2025-07-01', '2026-06-30')).toBe(364);
    expect(ajouterMois('2025-01-31', 1)).toBe('2025-02-28');
    expect(ajouterMois('2025-07-15', 6)).toBe('2026-01-15');
    expect(finDeMois('2024-02-10')).toBe('2024-02-29');
    expect(jourSemaine('2026-10-08')).toBe(4);
  });
});

describe('jours fériés', () => {
  it.each([
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2038, '2038-04-25'],
  ])('Pâques %i = %s', (annee, date) => {
    expect(paques(annee)).toBe(date);
  });

  it('reconnaît les fêtes fixes et mobiles', () => {
    expect(jourFerie('2026-04-06')).toBe('Lundi de Pâques');
    expect(jourFerie('2026-05-14')).toBe('Ascension');
    expect(jourFerie('2026-05-25')).toBe('Lundi de Pentecôte');
    expect(jourFerie('2025-11-11')).toBe('Armistice 1918');
    expect(jourFerie('2025-11-12')).toBeUndefined();
  });

  it('distingue jours ouvrés, week-ends et fériés', () => {
    expect(estJourOuvre('2026-10-08')).toBe(true);
    expect(estJourOuvre('2026-10-10')).toBe(false);
    expect(estJourOuvre('2025-12-25')).toBe(false);
  });
});
