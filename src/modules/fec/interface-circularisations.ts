/**
 * Interface stable du module FEC, consommée par le module Circularisations (src/modules/circularisations/)
 * sans relire le fichier : métadonnées du dossier, soldes par compte et par tiers, comptes bancaires,
 * écritures d'un tiers ou d'un compte (procédures alternatives).
 *
 * Conventions :
 *  - montants en centimes entiers ; soldes signés débit − crédit (positif = débiteur) ;
 *  - « ouverture » = à-nouveaux ; « debit » / « credit » = mouvements de l'exercice HORS à-nouveaux ;
 *    « cloture » = ouverture + debit − credit ; « sens » = 'D', 'C' ou '' (solde nul) ;
 *  - clé d'un tiers : CompAuxNum s'il est renseigné, sinon CompteNum (SPEC 4.2) ;
 *  - dates ISO AAAA-MM-JJ.
 *
 * Toute modification incompatible incrémente VERSION_INTERFACE_FEC.
 */
import { soldesPar, calculerBalance } from './analyses/balance.ts';
import { clesTiers } from './analyses/auxiliaire.ts';
import { creerContexte, sens, type ContexteAnalyse } from './analyses/contexte.ts';
import { lignesEcriture } from './analyses/grand-livre.ts';
import type { FecColonnes } from './donnees/colonnes.ts';
import { lireDossierFec, type MetadonneesDossierFec } from './dossier-fec.ts';
import { dateIso } from './import/valeurs.ts';
import { lireColonnes, lireDossier, lireImport, type Dossier, type ImportEnregistre, type Role } from './stockage/base-fec.ts';

export const VERSION_INTERFACE_FEC = 1;

export type { MetadonneesDossierFec };

export interface SoldeFec {
  ouverture: number;
  debit: number;
  credit: number;
  cloture: number;
  sens: 'D' | 'C' | '';
}

export interface SoldeCompteFec extends SoldeFec {
  compteNum: string;
  compteLib: string;
}

export interface SoldeTiersFec extends SoldeFec {
  /** CompAuxNum, sinon CompteNum. */
  cle: string;
  compAuxNum: string | null;
  libelle: string;
  /** Comptes généraux mouvementés par le tiers (ex. 411000, 4191). */
  comptes: string[];
}

export interface CompteBancaireFec extends SoldeCompteFec {
  /** Mouvements dans l'exercice (hors à-nouveaux). */
  mouvemente: boolean;
}

export interface LigneEcritureFec {
  ligneOrigine: number;
  compteNum: string;
  compteLib: string;
  compAuxNum: string;
  compAuxLib: string;
  debit: number;
  credit: number;
  ecritureLet: string;
  dateLet: string | null;
}

export interface EcritureFec {
  journalCode: string;
  journalLib: string;
  ecritureNum: string;
  ecritureDate: string | null;
  pieceRef: string;
  pieceDate: string | null;
  ecritureLib: string;
  validDate: string | null;
  aNouveau: boolean;
  lignes: LigneEcritureFec[];
}

/** Préfixes bancaires par défaut (SPEC 4.2) : banques et intérêts courus (les emprunts 164 sont exclus). */
export const PREFIXES_BANQUES_DEFAUT = ['512', '514', '517', '519', '5186'];

export interface DonneesFec {
  readonly version: typeof VERSION_INTERFACE_FEC;
  readonly metadonnees: MetadonneesDossierFec;
  soldesParCompte(): SoldeCompteFec[];
  /** Tiers des comptes commençant par l'un des préfixes (par défaut 40 et 41), hors préfixes exclus. */
  soldesParTiers(prefixes?: string[], exclus?: string[]): SoldeTiersFec[];
  /** Comptes bancaires présents dans le FEC (à-nouveaux ou mouvements), même soldés à la clôture. */
  comptesBancaires(prefixes?: string[]): CompteBancaireFec[];
  ecrituresDuTiers(cle: string): EcritureFec[];
  ecrituresDuCompte(compteNum: string): EcritureFec[];
}

const solde = (s: { ouverture: number; debit: number; credit: number; cloture: number }): SoldeFec => ({
  ouverture: s.ouverture,
  debit: s.debit,
  credit: s.credit,
  cloture: s.cloture,
  sens: sens(s.cloture),
});

const dateOuNull = (d: number) => (d > 0 ? dateIso(d) : null);

function ecritures(ctx: ContexteAnalyse, retenir: (i: number) => boolean): EcritureFec[] {
  const { f } = ctx;
  const ids = new Set<number>();
  for (let i = 0; i < f.nbLignes; i++) if (retenir(i)) ids.add(f.ecriture[i]!);
  const tx = (k: number) => f.textes[k]!;
  return [...ids]
    .map((e) => {
      const lignes = lignesEcriture(ctx, e);
      const p = lignes[0]!;
      return {
        journalCode: tx(f.journalCode[p]!),
        journalLib: tx(f.journalLib[p]!),
        ecritureNum: tx(f.ecritureNum[p]!),
        ecritureDate: dateOuNull(f.ecritureDate[p]!),
        pieceRef: tx(f.pieceRef[p]!),
        pieceDate: dateOuNull(f.pieceDate[p]!),
        ecritureLib: tx(f.ecritureLib[p]!),
        validDate: dateOuNull(f.validDate[p]!),
        aNouveau: ctx.an[p] === 1,
        lignes: Array.from(lignes, (i) => ({
          ligneOrigine: f.ligneOrigine[i]!,
          compteNum: tx(f.compteNum[i]!),
          compteLib: tx(f.compteLib[i]!),
          compAuxNum: tx(f.compAuxNum[i]!),
          compAuxLib: tx(f.compAuxLib[i]!),
          debit: f.debit[i]!,
          credit: f.credit[i]!,
          ecritureLet: tx(f.ecritureLet[i]!),
          dateLet: dateOuNull(f.dateLet[i]!),
        })),
      };
    })
    .sort((a, b) => (a.ecritureDate ?? '').localeCompare(b.ecritureDate ?? '') || a.ecritureNum.localeCompare(b.ecritureNum, 'fr', { numeric: true }));
}

/** Construit l'interface à partir d'un FEC normalisé (fonction pure, sans IndexedDB). */
export function construireDonneesFec(colonnes: FecColonnes, imp: ImportEnregistre, dossier: Pick<Dossier, 'id' | 'nom'>): DonneesFec {
  const { metadonnees, journalAN } = lireDossierFec(imp, dossier);
  const ctx = creerContexte(colonnes, metadonnees.exercice, journalAN);
  const f = colonnes;
  const balance = calculerBalance(ctx);

  return {
    version: VERSION_INTERFACE_FEC,
    metadonnees,
    soldesParCompte: () => balance.comptes.map((c) => ({ compteNum: c.compteNum, compteLib: c.compteLib, ...solde(c) })),
    soldesParTiers(prefixes = ['40', '41'], exclus = []) {
      const retenus = new Uint8Array(f.textes.length);
      for (const c of new Set(f.compteNum)) {
        const num = f.textes[c]!;
        if (prefixes.some((p) => num.startsWith(p)) && !exclus.some((p) => num.startsWith(p))) retenus[c] = 1;
      }
      const retenir = (i: number) => retenus[f.compteNum[i]!] === 1;
      const cles = clesTiers(ctx);
      const infos = new Map<number, { comptes: Set<number>; libelle: number; aux: boolean }>();
      for (let i = 0; i < f.nbLignes; i++) {
        if (!retenir(i)) continue;
        let x = infos.get(cles[i]!);
        if (!x) infos.set(cles[i]!, (x = { comptes: new Set(), libelle: f.compAuxLib[i] || f.compteLib[i]!, aux: f.compAuxNum[i] !== 0 }));
        x.comptes.add(f.compteNum[i]!);
      }
      return [...soldesPar(ctx, cles, retenir)]
        .map(([k, s]) => {
          const x = infos.get(k)!;
          return {
            cle: f.textes[k]!,
            compAuxNum: x.aux ? f.textes[k]! : null,
            libelle: f.textes[x.libelle]!,
            comptes: [...x.comptes].map((c) => f.textes[c]!).sort(),
            ...solde(s),
          };
        })
        .sort((a, b) => (a.cle < b.cle ? -1 : 1));
    },
    comptesBancaires(prefixes = PREFIXES_BANQUES_DEFAUT) {
      return balance.comptes
        .filter((c) => prefixes.some((p) => c.compteNum.startsWith(p)))
        .map((c) => ({ compteNum: c.compteNum, compteLib: c.compteLib, ...solde(c), mouvemente: c.debit !== 0 || c.credit !== 0 }));
    },
    ecrituresDuTiers(cle) {
      const k = f.textes.indexOf(cle);
      if (k < 0) return [];
      return ecritures(ctx, (i) => (f.compAuxNum[i] || f.compteNum[i]) === k);
    },
    ecrituresDuCompte(compteNum) {
      const k = f.textes.indexOf(compteNum);
      if (k < 0) return [];
      return ecritures(ctx, (i) => f.compteNum[i] === k);
    },
  };
}

/** Charge l'interface d'un dossier depuis le stockage local (FEC N par défaut) ; null si absent. */
export async function chargerDonneesFec(dossierId: string, role: Role = 'N'): Promise<DonneesFec | null> {
  const dossier = await lireDossier(dossierId);
  const id = dossier?.fec[role];
  if (!dossier || !id) return null;
  const [imp, colonnes] = await Promise.all([lireImport(id), lireColonnes(id)]);
  if (!imp || !colonnes) return null;
  return construireDonneesFec(colonnes, imp, dossier);
}
