import { beforeAll, describe, expect, it } from 'vitest';
import type { FecColonnes } from '../../../src/modules/fec/donnees/colonnes.ts';
import type { FecImporte } from '../../../src/modules/fec/import/pipeline.ts';
import { ATTENDUS, importerFichier } from './aides.ts';

/** Lignes normalisées sous forme comparable (ordre du fichier ignoré : le XML regroupe par journal). */
function empreinteLignes(f: FecColonnes, options: { lettrage: boolean; tiers: 'code' | 'libelle' }): string[] {
  const t = (col: keyof FecColonnes, i: number) => f.textes[(f[col] as Uint32Array)[i]!]!;
  const lignes: string[] = [];
  for (let i = 0; i < f.nbLignes; i++) {
    lignes.push(
      [
        t('journalCode', i),
        t('journalLib', i),
        t('ecritureNum', i),
        f.ecritureDate[i],
        options.tiers === 'code' ? t('compteNum', i) : t('compteNum', i).slice(0, 3),
        options.tiers === 'code' ? t('compAuxNum', i) : '',
        t('compAuxLib', i) || (options.tiers === 'libelle' && /^4[01]/.test(t('compteNum', i)) ? '?' : ''),
        t('pieceRef', i),
        f.pieceDate[i],
        t('ecritureLib', i),
        f.debit[i],
        f.credit[i],
        options.lettrage ? t('ecritureLet', i) : '',
        options.lettrage ? f.dateLet[i] : '',
        f.validDate[i],
        Number.isNaN(f.montantDevise[i]) ? '' : f.montantDevise[i],
        t('idevise', i),
      ].join('|'),
    );
  }
  return lignes.sort();
}

const variantes = ATTENDUS.fichiers.filter((f) => f.categorie === 'variante' && f.reference === 'petit');
const reference = variantes.find((f) => f.fichier.endsWith('_standard.txt'))!;

describe('toutes les variantes du petit FEC donnent les mêmes données normalisées', () => {
  let ref: FecImporte;
  beforeAll(async () => {
    const r = await importerFichier(reference.fichier);
    if (r.statut !== 'termine') throw new Error('import impossible');
    ref = r.fec;
  });

  it.each(variantes.map((v) => [v.fichier]))('%s', async (fichier) => {
    const r = await importerFichier(fichier);
    if (r.statut !== 'termine') throw new Error('import impossible');
    const xml = fichier.endsWith('.xml');
    const integre = fichier.includes('tiers-integre');
    const options = { lettrage: !xml, tiers: integre ? ('libelle' as const) : ('code' as const) };
    expect(empreinteLignes(r.fec.colonnes, options)).toEqual(empreinteLignes(ref.colonnes, options));
    if (integre) {
      // Les auxiliaires reconstruits portent le nom du tiers : même nombre de tiers que la référence.
      const tiers = (f: FecColonnes) => new Set(Array.from(f.compAuxNum).filter((x) => x !== 0)).size;
      expect(tiers(r.fec.colonnes)).toBe(tiers(ref.colonnes));
    }
  });
});

describe('totaux du FEC propre identiques à ceux du générateur', () => {
  it('balance par compte : ouverture, mouvements hors à-nouveaux, clôture', async () => {
    const r = await importerFichier(ATTENDUS.fichiers.find((f) => f.categorie === 'propre')!.fichier);
    if (r.statut !== 'termine') throw new Error('import impossible');
    const f = r.fec.colonnes;
    const an = f.textes.indexOf('AN');
    const comptes: Record<string, { ouverture: number; debit: number; credit: number; cloture: number }> = {};
    for (let i = 0; i < f.nbLignes; i++) {
      const c = (comptes[f.textes[f.compteNum[i]!]!] ??= { ouverture: 0, debit: 0, credit: 0, cloture: 0 });
      if (f.journalCode[i] === an) c.ouverture += f.debit[i]! - f.credit[i]!;
      else {
        c.debit += f.debit[i]!;
        c.credit += f.credit[i]!;
      }
      c.cloture += f.debit[i]! - f.credit[i]!;
    }
    const attendu = Object.fromEntries(
      Object.entries(ATTENDUS.totaux.propre.comptes).map(([k, v]) => [k, { ouverture: v.ouverture, debit: v.debit, credit: v.credit, cloture: v.cloture }]),
    );
    expect(comptes).toEqual(attendu);
    expect(r.fec.meta.empreinte).toMatch(/^[0-9a-f]{64}$/);
  });
});
