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

describe('migration de la base (version 1 → 2)', () => {
  it('conserve les dossiers existants et ajoute le magasin des circularisations', async () => {
    await toutPurger();
    // Base au format de la version 1, créée sans passer par le code applicatif.
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open(NOM_BASE, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('dossiers', { keyPath: 'id' }).put({ id: 'ancien', nom: 'Dossier v1', siren: null, creeLe: '2026-10-01', modifieLe: '2026-10-01', fec: {} });
        db.createObjectStore('imports', { keyPath: 'id' }).createIndex('dossierId', 'dossierId');
        db.createObjectStore('colonnes', { keyPath: 'id' });
        db.createObjectStore('profils', { keyPath: 'signature' });
      };
      r.onsuccess = () => {
        r.result.close();
        resolve();
      };
      r.onerror = () => reject(r.error);
    });
    expect((await listerDossiers()).map((d) => d.nom)).toEqual(['Dossier v1']);
    const { enregistrerParametres, lireParametres } = await import('../../../src/modules/circularisations/stockage.ts');
    const { parametresParDefaut } = await import('../../../src/modules/circularisations/parametres.ts');
    await enregistrerParametres('ancien', parametresParDefaut('2025-12-31', 7));
    expect((await lireParametres('ancien'))?.graine).toBe(7);
    // Paramètres enregistrés en version 1 (avec le préfixe 164) : convertis à la lecture.
    const v1 = { ...parametresParDefaut('2025-12-31', 8), version: 1 } as unknown as Parameters<typeof enregistrerParametres>[1];
    v1.banques.prefixes = ['512', '514', '517', '519', '5186', '164'];
    await enregistrerParametres('ancien', v1);
    const migres = await lireParametres('ancien');
    expect(migres?.version).toBe(2);
    expect(migres?.banques.prefixes).toEqual(['512', '514', '517', '519', '5186']);
    expect(migres?.graine).toBe(8);
    await purgerDossier('ancien');
    expect(await lireParametres('ancien')).toBeNull();
  });
});

describe('migration de la base (version 2 → 3)', () => {
  it('conserve les dossiers et les circularisations, ajoute les magasins des courriers', async () => {
    await toutPurger();
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open(NOM_BASE, 2);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('dossiers', { keyPath: 'id' }).put({ id: 'v2', nom: 'Dossier v2', siren: null, creeLe: '2026-10-01', modifieLe: '2026-10-01', fec: {} });
        db.createObjectStore('imports', { keyPath: 'id' }).createIndex('dossierId', 'dossierId');
        db.createObjectStore('colonnes', { keyPath: 'id' });
        db.createObjectStore('profils', { keyPath: 'signature' });
        db.createObjectStore('circularisations', { keyPath: 'dossierId' }).put({ dossierId: 'v2', parametres: { graine: 42 }, modifieLe: '' });
      };
      r.onsuccess = () => {
        r.result.close();
        resolve();
      };
      r.onerror = () => reject(r.error);
    });
    expect((await listerDossiers()).map((d) => d.nom)).toEqual(['Dossier v2']);
    const { lireParametres } = await import('../../../src/modules/circularisations/stockage.ts');
    expect((await lireParametres('v2'))?.graine).toBe(42);
    const s = await import('../../../src/modules/circularisations/courriers/stockage.ts');
    const { reglagesDossierParDefaut } = await import('../../../src/modules/circularisations/courriers/modeles.ts');
    // Modèles par défaut tant que rien n'est enregistré, puis complétés pour les clés absentes.
    const m = await s.lireModeles();
    expect(m.modeles.fournisseurs.soldeIndique).toBe(false);
    m.cabinet.nom = 'Cabinet fictif';
    m.modeles.clients.soldeIndique = true;
    await s.enregistrerModeles(m);
    expect((await s.lireModeles()).cabinet.nom).toBe('Cabinet fictif');
    expect((await s.lireModeles()).modeles.clients.soldeIndique).toBe(true);
    await s.enregistrerReglagesCourriers('v2', { ...reglagesDossierParDefaut('Dossier v2', null), lieu: 'Lyon' });
    expect((await s.lireReglagesCourriers('v2'))?.lieu).toBe('Lyon');
    // « Purger ce dossier » efface ses réglages de courriers, pas les modèles du poste.
    await purgerDossier('v2');
    expect(await s.lireReglagesCourriers('v2')).toBeNull();
    expect((await s.lireModeles()).cabinet.nom).toBe('Cabinet fictif');
  });
});

describe('migration de la base (version 3 → 4)', () => {
  it('conserve les données et ajoute le magasin du cadrage de TVA, purgé avec le dossier', async () => {
    await toutPurger();
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open(NOM_BASE, 3);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('dossiers', { keyPath: 'id' }).put({ id: 'v3', nom: 'Dossier v3', siren: null, creeLe: '2026-10-01', modifieLe: '2026-10-01', fec: {} });
        db.createObjectStore('imports', { keyPath: 'id' }).createIndex('dossierId', 'dossierId');
        db.createObjectStore('colonnes', { keyPath: 'id' });
        db.createObjectStore('profils', { keyPath: 'signature' });
        db.createObjectStore('circularisations', { keyPath: 'dossierId' });
        db.createObjectStore('courriers', { keyPath: 'dossierId' });
        db.createObjectStore('modeles-courriers', { keyPath: 'id' }).put({ id: 'poste', modeles: { cabinet: { nom: 'Cabinet v3' } } });
      };
      r.onsuccess = () => {
        r.result.close();
        resolve();
      };
      r.onerror = () => reject(r.error);
    });
    expect((await listerDossiers()).map((d) => d.nom)).toEqual(['Dossier v3']);
    const { lireModeles } = await import('../../../src/modules/circularisations/courriers/stockage.ts');
    expect((await lireModeles()).cabinet.nom).toBe('Cabinet v3');
    const { enregistrerTva, lireTva } = await import('../../../src/modules/tva/stockage.ts');
    expect((await lireTva('v3')).declarations).toEqual([]);
    const tva = await lireTva('v3');
    tva.declarations.push({ id: 'd1', source: 'saisie', nomFichier: null, empreinte: null, identification: { denomination: null, siren: null, debut: '2026-01-01', fin: '2026-01-31', dateLimite: null, dateDepot: null, dateCreation: null, millesime: null }, lues: { A1: { montant: 100 } }, corrections: [], messagesLecture: [], casesInconnues: [], importeLe: '' });
    await enregistrerTva(tva);
    expect((await lireTva('v3')).declarations).toHaveLength(1);
    await purgerDossier('v3');
    expect((await lireTva('v3')).declarations).toEqual([]);
  });
});

describe('paramètres du cadrage de TVA (version 1 → 2)', () => {
  it('convertit les paramètres enregistrés avec un seuil d’écart : seuil retiré, le reste conservé', async () => {
    await toutPurger();
    const { enregistrerTva, lireTva } = await import('../../../src/modules/tva/stockage.ts');
    const { parametresParDefaut } = await import('../../../src/modules/tva/cadrage/parametres.ts');
    const anciens = { ...parametresParDefaut(), version: 1, seuil: 250_000, collaborateur: 'C. Fictif' };
    await enregistrerTva({ version: 1, dossierId: 'p1', declarations: [], parametres: anciens as never, modifieLe: '' });
    const relus = (await lireTva('p1')).parametres!;
    expect(relus.version).toBe(2);
    expect('seuil' in relus).toBe(false);
    expect(relus.collaborateur).toBe('C. Fictif');
    expect(relus).toEqual({ ...parametresParDefaut(), collaborateur: 'C. Fictif' });
  });
});
