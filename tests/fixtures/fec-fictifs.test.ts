import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { simulerNegoce } from '../../scripts/fec-fictifs/negoce.ts';
import { genererJeu, PARAMS_PETIT, PARAMS_PROPRE, type Attendus } from '../../scripts/generer-fec-fictifs.ts';
import { estJourOuvre } from '../../src/core/dates.ts';

const COMMITE = join(import.meta.dirname, 'fec');

function lister(dossier: string, prefixe = ''): string[] {
  return readdirSync(join(dossier, prefixe), { withFileTypes: true }).flatMap((f) =>
    f.isDirectory() ? (f.name === 'gros' ? [] : lister(dossier, join(prefixe, f.name))) : [join(prefixe, f.name)],
  );
}

describe('jeu de FEC fictifs', () => {
  let dossier: string;
  let attendus: Attendus;

  beforeAll(() => {
    dossier = mkdtempSync(join(tmpdir(), 'pole003-fec-'));
    attendus = genererJeu(dossier);
  });
  afterAll(() => rmSync(dossier, { recursive: true, force: true }));

  it('est déterministe et identique aux fichiers commités (relancer npm run fec:fictifs sinon)', () => {
    const fichiers = lister(dossier).sort();
    expect(lister(COMMITE).sort()).toEqual(fichiers);
    for (const f of fichiers) {
      expect(readFileSync(join(dossier, f)).equals(readFileSync(join(COMMITE, f))), f).toBe(true);
    }
  });

  it('le FEC propre compte environ 20 000 lignes, équilibrées', () => {
    const t = attendus.totaux.propre;
    expect(t.nbLignes).toBeGreaterThan(18_000);
    expect(t.nbLignes).toBeLessThan(23_000);
    expect(t.totalDebit).toBe(t.totalCredit);
    expect(Object.keys(t.tiers).filter((c) => c.startsWith('C'))).toHaveLength(150);
    expect(Object.keys(t.tiers).filter((c) => c.startsWith('F'))).toHaveLength(80);
  });

  it('contient les situations utiles aux circularisations', () => {
    const t = attendus.totaux.propre;
    expect(t.banques).toEqual(['512100', '512200', '512300']);
    expect(t.comptes['512300']!.cloture).toBe(0);
    expect(t.comptes['512300']!.credit).toBeGreaterThan(0);
    expect(attendus.faits.clientsCrediteurs.length).toBeGreaterThanOrEqual(3);
    expect(attendus.faits.fournisseursDebiteurs.length).toBeGreaterThanOrEqual(3);
    expect(t.tiers.F0001!.cloture).toBe(0);
    expect(t.tiers.F0001!.credit).toBeGreaterThan(100_000_000);
    expect(t.comptes['164000']!.ouverture).toBeLessThan(0);
  });

  it.each([
    ['propre', PARAMS_PROPRE],
    ['petit', PARAMS_PETIT],
  ] as const)('%s : écritures équilibrées, dans l’exercice, validation chronologique', (_, params) => {
    let validationPrecedente = '';
    for (const e of simulerNegoce(params)) {
      expect(e.lignes.reduce((s, l) => s + l.debit - l.credit, 0)).toBe(0);
      expect(e.ecritureDate >= params.societe.debut && e.ecritureDate <= params.societe.cloture).toBe(true);
      expect(e.validDate >= validationPrecedente).toBe(true);
      validationPrecedente = e.validDate;
      if (!estJourOuvre(e.ecritureDate) && e.journalCode !== 'AN') expect(e.piste).toMatch(/week-end|jour-ferie/);
      for (const l of e.lignes) expect(l.debit === 0 || l.credit === 0).toBe(true);
    }
  });

  it('chaque fichier piégé déclare au moins un constat attendu', () => {
    const pieges = attendus.fichiers.filter((f) => f.categorie === 'piege');
    expect(pieges.length).toBeGreaterThanOrEqual(11);
    for (const p of pieges) expect(p.constats.length, p.fichier).toBeGreaterThan(0);
  });

  it('les encodages ISO-8859-15 et Windows-1252 codent « € » à des positions différentes', () => {
    const iso = readFileSync(join(COMMITE, 'variantes/000987651FEC20251231_iso-8859-15.txt'));
    const win = readFileSync(join(COMMITE, 'variantes/000987651FEC20251231_windows-1252.txt'));
    expect(iso.includes(Buffer.from('18 \xa4', 'latin1'))).toBe(true);
    expect(win.includes(Buffer.from('18 \x80', 'latin1'))).toBe(true);
    expect(iso.includes(Buffer.from('B\xbduf', 'latin1'))).toBe(true);
    expect(win.includes(Buffer.from('B\x9cuf', 'latin1'))).toBe(true);
  });
});
