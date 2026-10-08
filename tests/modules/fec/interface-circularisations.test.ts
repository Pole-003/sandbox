import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { chargerDonneesFec, VERSION_INTERFACE_FEC, type DonneesFec } from '../../../src/modules/fec/interface-circularisations.ts';
import { creerDossier, enregistrerImport, toutPurger } from '../../../src/modules/fec/stockage/base-fec.ts';
import { ATTENDUS, importerFichier } from './aides.ts';

describe('interface Circularisations sur le FEC propre (import → IndexedDB → chargement)', () => {
  let donnees: DonneesFec;

  beforeAll(async () => {
    await toutPurger();
    const r = await importerFichier(ATTENDUS.fichiers.find((f) => f.categorie === 'propre')!.fichier);
    if (r.statut !== 'termine') throw new Error();
    const dossier = await creerDossier('Négoce fictif');
    await enregistrerImport(dossier.id, 'N', r.fec);
    donnees = (await chargerDonneesFec(dossier.id))!;
  });

  it('métadonnées du dossier', () => {
    expect(donnees.version).toBe(VERSION_INTERFACE_FEC);
    expect(donnees.metadonnees).toMatchObject({
      nomDossier: 'Négoce fictif',
      siren: '000123455',
      exercice: { debut: '2025-07-01', fin: '2026-06-30' },
      dateCloture: '2026-06-30',
      journalAN: { code: 'AN', confirme: false },
      nomFichier: '000123455FEC20260630.txt',
      nbLignes: ATTENDUS.totaux.propre.nbLignes,
    });
    expect(donnees.metadonnees.empreinte).toMatch(/^[0-9a-f]{64}$/);
  });

  it('soldes par tiers = totaux du générateur (ouverture, mouvements hors AN, clôture, sens)', () => {
    const tiers = donnees.soldesParTiers();
    const attendu = ATTENDUS.totaux.propre.tiers;
    expect(tiers.map((t) => t.cle)).toEqual(Object.keys(attendu));
    for (const t of tiers) {
      const a = attendu[t.cle]!;
      expect({ cle: t.cle, ouverture: t.ouverture, debit: t.debit, credit: t.credit, cloture: t.cloture }).toEqual({
        cle: t.cle,
        ouverture: a.ouverture,
        debit: a.debit,
        credit: a.credit,
        cloture: a.cloture,
      });
      expect(t.sens).toBe(a.cloture > 0 ? 'D' : a.cloture < 0 ? 'C' : '');
    }
    const volume = tiers.find((t) => t.cle === 'F0001')!;
    expect(volume).toMatchObject({ cloture: 0, sens: '', compAuxNum: 'F0001', comptes: ['401000'] });
    expect(volume.credit).toBe(ATTENDUS.faits.fournisseurVolumeSoldeNul.achats);
  });

  it('soldes par compte = balance du générateur', () => {
    const comptes = donnees.soldesParCompte();
    for (const c of comptes) expect(c.cloture).toBe(ATTENDUS.totaux.propre.comptes[c.compteNum]!.cloture);
    expect(comptes.length).toBe(Object.keys(ATTENDUS.totaux.propre.comptes).length);
  });

  it('comptes bancaires mouvementés, y compris celui soldé en cours d’exercice', () => {
    const banques = donnees.comptesBancaires();
    expect(banques.filter((b) => b.compteNum.startsWith('512')).map((b) => b.compteNum)).toEqual(ATTENDUS.totaux.propre.banques);
    expect(banques.find((b) => b.compteNum === '512300')).toMatchObject({ cloture: 0, sens: '', mouvemente: true });
    expect(banques.map((b) => b.compteNum)).not.toContain('164000');
  });

  it('écritures d’un tiers et d’un compte (procédures alternatives)', () => {
    const ecritures = donnees.ecrituresDuTiers('C0148');
    expect(ecritures.length).toBeGreaterThan(0);
    const solde = ecritures
      .flatMap((e) => e.lignes)
      .filter((l) => l.compAuxNum === 'C0148')
      .reduce((s, l) => s + l.debit - l.credit, 0);
    expect(solde).toBe(ATTENDUS.totaux.propre.tiers.C0148!.cloture);
    for (const e of ecritures) expect(e.lignes.reduce((s, l) => s + l.debit - l.credit, 0)).toBe(0);
    expect(donnees.ecrituresDuCompte('512300').length).toBeGreaterThanOrEqual(3);
    expect(donnees.ecrituresDuTiers('inconnu')).toEqual([]);
  });
});
