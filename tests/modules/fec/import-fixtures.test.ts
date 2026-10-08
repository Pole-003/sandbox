import { describe, expect, it } from 'vitest';
import { tousLesConstats } from '../../../src/modules/fec/import/pipeline.ts';
import { ATTENDUS, importerFichier } from './aides.ts';

describe('import des FEC fictifs : constats exactement conformes à attendus.json', () => {
  it.each(ATTENDUS.fichiers.map((f) => [f.fichier, f] as const))('%s', async (_, attendu) => {
    const r = await importerFichier(attendu.fichier);
    expect(r.statut).toBe('termine');
    if (r.statut !== 'termine') return;
    const { meta } = r.fec;
    expect(meta.nbLignes).toBe(attendu.nbLignes);
    expect(meta.nbEcritures).toBe(attendu.nbEcritures);
    expect(meta.siren).toBe(attendu.siren);
    expect(meta.cloture).toBe(attendu.cloture);
    expect(meta.exercice?.debut).toBe(attendu.debut);
    expect(meta.exercice?.fin).toBe(attendu.cloture);
    expect(meta.journalAN?.code ?? null).toBe(attendu.journalAN);
    expect(meta.format).toBe(attendu.format);
    const parCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code);
    const obtenus = tousLesConstats(r.fec)
      .map((c) => ({ code: c.code, occurrences: c.occurrences, lignes: c.lignes }))
      .sort(parCode);
    const attendus = attendu.constats.map((c) => ({ code: c.code, occurrences: c.occurrences, lignes: c.lignes })).sort(parCode);
    expect(obtenus).toEqual(attendus);
  });
});
