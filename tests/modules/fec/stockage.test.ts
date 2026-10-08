import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  creerDossier,
  enregistrerImport,
  enregistrerProfil,
  listerDossiers,
  lireColonnes,
  lireDossier,
  lireImport,
  mettreAJourImport,
  NOM_BASE,
  purgerDossier,
  toutPurger,
  trouverProfil,
} from '../../../src/modules/fec/stockage/base-fec.ts';
import { importerFichier } from './aides.ts';

async function importPetit() {
  const r = await importerFichier('variantes/000987651FEC20251231_standard.txt');
  if (r.statut !== 'termine') throw new Error();
  return r.fec;
}

describe('stockage local IndexedDB des dossiers FEC', () => {
  beforeEach(async () => {
    await toutPurger();
  });

  it('nom de base préfixé (CLAUDE.md, règle n° 5)', () => {
    expect(NOM_BASE).toMatch(/^pole003-sandbox-(beta-)?fec$/);
  });

  it('enregistre un FEC N et N-1, relit les colonnes typées intactes', async () => {
    const fec = await importPetit();
    const d = await creerDossier('Petit Comptoir');
    const n = await enregistrerImport(d.id, 'N', fec);
    const n1 = await enregistrerImport(d.id, 'N-1', fec);
    const relu = await lireDossier(d.id);
    expect(relu?.fec).toEqual({ N: n.id, 'N-1': n1.id });
    expect(relu?.siren).toBe('000987651');
    const colonnes = await lireColonnes(n.id);
    expect(colonnes?.nbLignes).toBe(fec.colonnes.nbLignes);
    expect(colonnes?.debit).toBeInstanceOf(Float64Array);
    expect(Array.from(colonnes!.debit)).toEqual(Array.from(fec.colonnes.debit));
    expect(colonnes?.textes).toEqual(fec.colonnes.textes);
    expect((await lireImport(n.id))?.reglages).toMatchObject({ debut: '2025-01-01', fin: '2025-12-31', journalAN: 'AN', journalANConfirme: false });
  });

  it('remplace le FEC du même rôle et met à jour les réglages', async () => {
    const fec = await importPetit();
    const d = await creerDossier('Dossier');
    const a = await enregistrerImport(d.id, 'N', fec);
    const b = await enregistrerImport(d.id, 'N', fec);
    expect(await lireImport(a.id)).toBeNull();
    expect(await lireColonnes(a.id)).toBeNull();
    const maj = await mettreAJourImport(b.id, { reglages: { ...b.reglages, journalANConfirme: true } });
    expect(maj.reglages.journalANConfirme).toBe(true);
  });

  it('« Purger ce dossier » ne supprime que ce dossier ; « Tout purger » supprime tout', async () => {
    const fec = await importPetit();
    const a = await creerDossier('A');
    const b = await creerDossier('B');
    const ia = await enregistrerImport(a.id, 'N', fec);
    await enregistrerImport(b.id, 'N', fec);
    await purgerDossier(a.id);
    expect((await listerDossiers()).map((d) => d.nom)).toEqual(['B']);
    expect(await lireColonnes(ia.id)).toBeNull();
    await toutPurger();
    expect(await listerDossiers()).toEqual([]);
  });

  it('mémorise un profil d’import par signature d’en-tête', async () => {
    await enregistrerProfil({ signature: 'A\u0001B', nom: 'Logiciel X', correspondance: { 0: 'JournalCode', 1: null }, regime: null, sansEntete: false });
    expect(await trouverProfil('A\u0001B')).toMatchObject({ nom: 'Logiciel X', correspondance: { 0: 'JournalCode', 1: null } });
    expect(await trouverProfil('autre')).toBeNull();
  });
});
