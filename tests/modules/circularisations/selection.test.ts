import { beforeAll, describe, expect, it } from 'vitest';
import { mulberry32, tirageSansRemise } from '../../../src/modules/circularisations/alea.ts';
import { parametresParDefaut, proposerEtablissement, seuilEffectif, type ParametresCircularisation } from '../../../src/modules/circularisations/parametres.ts';
import { selectionner } from '../../../src/modules/circularisations/selection.ts';
import { construireDonneesFec, type DonneesFec } from '../../../src/modules/fec/interface-circularisations.ts';
import { reglagesInitiaux, type ImportEnregistre } from '../../../src/modules/fec/stockage/base-fec.ts';
import { ATTENDUS, importerFichier } from '../fec/aides.ts';

let donnees: DonneesFec;

function parametres(modifier: (p: ParametresCircularisation) => void = () => {}): ParametresCircularisation {
  const p = parametresParDefaut('2026-06-30', 12345);
  p.sp = 5_000_000; // 50 000 €
  p.ss = 7_500_000;
  p.sai = 250_000;
  modifier(p);
  return p;
}

beforeAll(async () => {
  const r = await importerFichier(ATTENDUS.fichiers.find((f) => f.categorie === 'propre')!.fichier);
  if (r.statut !== 'termine') throw new Error();
  const imp: ImportEnregistre = {
    id: 'x',
    dossierId: 'd',
    role: 'N',
    importeLe: '2026-10-08T00:00:00Z',
    meta: r.fec.meta,
    constatsLecture: r.fec.constatsLecture,
    constatsEcritures: r.fec.constatsEcritures,
    reglages: reglagesInitiaux(r.fec.meta),
  };
  donnees = construireDonneesFec(r.fec.colonnes, imp, { id: 'd', nom: 'Négoce fictif' });
});

describe('générateur à graine (mulberry32)', () => {
  it('suite identique à l’implémentation de référence ; tirage reproductible, sans remise', () => {
    const a = mulberry32(1);
    expect([a(), a(), a()].map((x) => x.toFixed(10))).toEqual(['0.6270739406', '0.0027357212', '0.5274470400']);
    const liste = Array.from({ length: 100 }, (_, i) => i);
    const t1 = tirageSansRemise(liste, 10, 42);
    expect(tirageSansRemise(liste, 10, 42)).toEqual(t1);
    expect(new Set(t1).size).toBe(10);
    expect(tirageSansRemise(liste, 10, 43)).not.toEqual(t1);
    expect(tirageSansRemise([1, 2], 5, 1)).toHaveLength(2);
  });
});

describe('paramètres', () => {
  it('seuils en euros ou en % du SP', () => {
    expect(seuilEffectif({ actif: true, mode: 'pct-sp', valeur: 50 }, 5_000_000)).toBe(2_500_000);
    expect(seuilEffectif({ actif: true, mode: 'euros', valeur: 123_400 }, null)).toBe(123_400);
    expect(seuilEffectif({ actif: true, mode: 'pct-sp', valeur: 50 }, null)).toBeNull();
  });

  it('établissement proposé d’après le libellé', () => {
    expect(proposerEtablissement('Banque Alpha')).toBe('Banque Alpha');
    expect(proposerEtablissement('BNP Paribas compte courant 00012345')).toBe('BNP Paribas');
    expect(proposerEtablissement('Emprunts auprès des établissements de crédit')).toBe('À préciser');
    expect(proposerEtablissement('Banque')).toBe('À préciser');
  });
});

describe('sélection sur le FEC propre', () => {
  it('banques : sélection exhaustive, y compris le compte soldé en cours d’année', () => {
    const s = selectionner(donnees, parametres());
    expect(s.banques.comptes.map((c) => c.compteNum)).toEqual(['512100', '512200', '512300']);
    expect(s.banques.comptes.find((c) => c.compteNum === '512300')).toMatchObject({ cloture: 0, mouvemente: true });
    expect(s.banques.etablissements.map((e) => e.etablissement)).toEqual(['Banque Alpha', 'Banque Bêta', 'Banque Gamma']);
    const regroupe = selectionner(donnees, parametres((p) => (p.banques.etablissements = { '512200': 'Banque Alpha' })));
    expect(regroupe.banques.etablissements.find((e) => e.etablissement === 'Banque Alpha')!.comptes.map((c) => c.compteNum)).toEqual(['512100', '512200']);
  });

  it('fournisseur à fort volume et solde nul retenu en F2', () => {
    const f = selectionner(donnees, parametres()).fournisseurs;
    const volume = f.tiers.find((t) => t.cle === 'F0001')!;
    expect(volume.solde).toBe(0);
    expect(volume.motifs).toEqual(['F2']);
    expect(volume.retenu).toBe(true);
    expect(volume.methode).toBe('Seuil');
  });

  it('soldes anormaux : clients créditeurs (C3) et fournisseurs débiteurs (F3)', () => {
    const s = selectionner(donnees, parametres());
    expect(s.clients.tiers.filter((t) => t.motifs.includes('C3')).map((t) => t.cle)).toEqual(ATTENDUS.faits.clientsCrediteurs);
    expect(s.fournisseurs.tiers.filter((t) => t.motifs.includes('F3')).map((t) => t.cle)).toEqual(ATTENDUS.faits.fournisseursDebiteurs);
    expect(s.clients.indicateurs.nbAnormaux).toBe(3);
    // 418100 (factures à établir) et 408100 (factures non parvenues) exclus par défaut.
    expect(s.clients.tiers.some((t) => t.cle.startsWith('418'))).toBe(false);
    expect(s.fournisseurs.tiers.some((t) => t.cle.startsWith('408'))).toBe(false);
  });

  it('C1 / C2 aux seuils : 50 % et 100 % du SP', () => {
    const c = selectionner(donnees, parametres()).clients;
    expect(c.seuils).toEqual({ solde: 2_500_000, mouvements: 5_000_000 });
    for (const t of c.tiers) {
      expect(t.motifs.includes('C1')).toBe(t.solde >= 2_500_000);
      expect(t.motifs.includes('C2')).toBe(t.debit >= 5_000_000);
    }
  });

  it('tirage aléatoire : uniquement parmi les non retenus à solde non nul, reproductible avec la même graine', () => {
    const a = selectionner(donnees, parametres());
    const b = selectionner(donnees, parametres());
    const tires = (s: typeof a) => s.clients.tiers.filter((t) => t.motifs.includes('C4')).map((t) => [t.cle, t.rangTirage]);
    expect(tires(a)).toHaveLength(5);
    expect(tires(b)).toEqual(tires(a));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    for (const t of a.clients.tiers.filter((x) => x.motifs.includes('C4'))) {
      expect(t.motifs).toEqual(['C4']);
      expect(t.solde).not.toBe(0);
    }
    const autre = selectionner(donnees, parametres((p) => (p.graine = 999)));
    expect(tires(autre)).not.toEqual(tires(a));
  });

  it('ajout et exclusion manuels, justification obligatoire', () => {
    const base = selectionner(donnees, parametres());
    const nonRetenu = base.clients.tiers.find((t) => !t.retenu)!;
    const retenu = base.clients.tiers.find((t) => t.motifs.includes('C1'))!;
    const s = selectionner(
      donnees,
      parametres((p) => {
        p.manuels = [
          { population: 'clients', cle: nonRetenu.cle, action: 'ajout', justification: 'Litige connu', le: '2026-10-08' },
          { population: 'clients', cle: retenu.cle, action: 'exclusion', justification: 'Confirmé par un autre moyen', le: '2026-10-08' },
          { population: 'clients', cle: 'C0002', action: 'ajout', justification: '   ', le: '2026-10-08' },
        ];
      }),
    );
    const ajoute = s.clients.tiers.find((t) => t.cle === nonRetenu.cle)!;
    expect(ajoute).toMatchObject({ retenu: true, methode: 'Manuelle', justificationAjout: 'Litige connu' });
    expect(ajoute.motifs).toContain('C5');
    const exclu = s.clients.tiers.find((t) => t.cle === retenu.cle)!;
    expect(exclu).toMatchObject({ retenu: false, exclusion: 'Confirmé par un autre moyen' });
    expect(exclu.motifs).toContain('C1');
    expect(s.clients.tiers.find((t) => t.cle === 'C0002')!.motifs).not.toContain('C5');
    expect(s.clients.indicateurs.nbSelectionnes).toBe(base.clients.indicateurs.nbSelectionnes);
  });

  it('indicateurs de couverture', () => {
    const { indicateurs, tiers } = selectionner(donnees, parametres()).fournisseurs;
    expect(indicateurs.nbTotal).toBe(tiers.length);
    expect(indicateurs.couvertureSoldes).toBeGreaterThan(0);
    expect(indicateurs.couvertureSoldes).toBeLessThanOrEqual(1);
    expect(indicateurs.couvertureMouvements).toBeGreaterThan(0.5);
    const sansSp = selectionner(donnees, parametres((p) => (p.sp = null))).fournisseurs;
    expect(sansSp.seuils).toEqual({ solde: null, mouvements: null });
  });
});
