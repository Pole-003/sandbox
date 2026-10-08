import { describe, expect, it } from 'vitest';
import { PREFIXE_STOCKAGE, cleStockage } from '../../src/core/stockage.ts';

describe('stockage', () => {
  it('préfixe toutes les clés par pole003-sandbox- (canal production)', () => {
    expect(PREFIXE_STOCKAGE).toBe('pole003-sandbox-');
    expect(cleStockage('theme')).toBe('pole003-sandbox-theme');
  });
});
