/**
 * Interface stable du module FEC pour le module Cadrage de TVA (src/modules/tva/) : soldes par compte,
 * mouvements mensuels, observation des taux de TVA dans les écritures de vente, lignes de détail.
 * Le module TVA consomme ces données normalisées et ne relit jamais le fichier.
 *
 * Conventions : montants en centimes ; soldes signés débit − crédit ; mouvements hors à-nouveaux ;
 * mois « AAAA-MM » ; taux en points de base (2000 = 20 %).
 * Toute modification incompatible incrémente VERSION_INTERFACE_TVA.
 */
import { calculerBalance } from './analyses/balance.ts';
import { creerContexte, t, type ContexteAnalyse } from './analyses/contexte.ts';
import type { FecColonnes } from './donnees/colonnes.ts';
import { lireDossierFec, type MetadonneesDossierFec } from './dossier-fec.ts';
import { dateIso } from './import/valeurs.ts';
import { lireColonnes, lireDossier, lireImport, type Dossier, type ImportEnregistre, type Role } from './stockage/base-fec.ts';

export const VERSION_INTERFACE_TVA = 1;

/** Taux de TVA reconnus lors de l'observation des écritures (points de base). */
export const TAUX_CONNUS = [2000, 1000, 550, 210, 850, 1300, 175, 105, 90] as const;

export interface SoldeCompteTva {
  compteNum: string;
  compteLib: string;
  ouverture: number;
  debit: number;
  credit: number;
  cloture: number;
}

export interface MouvementMensuel {
  mois: string;
  debit: number;
  credit: number;
}

/** Observation des écritures de vente d'un compte de produits. */
export interface ObservationVentes {
  compteNum: string;
  compteLib: string;
  /** Chiffre d'affaires de l'exercice : crédit − débit, hors à-nouveaux. */
  ca: number;
  /** HT des écritures dont la TVA correspond à un taux connu, par taux. */
  parTaux: Record<number, number>;
  /** HT des écritures de vente (compte client 41 mouvementé) sans TVA : exonérations, autoliquidations, exportations. */
  sansTva: number;
  /** HT des écritures avec TVA ne correspondant à aucun taux connu. */
  tauxInconnu: number;
  /** HT des autres écritures (opérations diverses sans client ni TVA : extournes, PCA…). */
  autres: number;
  nbEcrituresVente: number;
}

export interface FiltreLignes {
  /** Préfixes de comptes (ex. ['706', '4457']). */
  comptes: string[];
  /** Mois « AAAA-MM » ; absent = tout l'exercice. */
  mois?: string;
  /** Inclure les à-nouveaux (par défaut : non). */
  aNouveaux?: boolean;
  /** Sens : lignes au débit, au crédit, ou toutes. */
  sens?: 'debit' | 'credit';
}

export interface LigneDetailFec {
  ligneOrigine: number;
  date: string | null;
  journal: string;
  ecritureNum: string;
  pieceRef: string;
  libelle: string;
  compteNum: string;
  compteLib: string;
  compAuxNum: string;
  debit: number;
  credit: number;
  aNouveau: boolean;
}

export interface DonneesTvaFec {
  readonly version: typeof VERSION_INTERFACE_TVA;
  readonly metadonnees: MetadonneesDossierFec;
  comptes(): SoldeCompteTva[];
  /** Mouvements par mois des comptes commençant par l'un des préfixes (hors préfixes exclus). */
  mouvementsMensuels(prefixes: string[], exclus?: string[]): MouvementMensuel[];
  observerVentes(o: { produits: string[]; tva: string[]; clients: string[] }): ObservationVentes[];
  /** Lignes du FEC répondant au filtre (au plus `limite`, 2 000 par défaut), et leur nombre total. */
  lignes(filtre: FiltreLignes, limite?: number): { lignes: LigneDetailFec[]; total: number };
}

const commence = (num: string, prefixes: readonly string[]) => prefixes.some((p) => num.startsWith(p));

/** Marque, pour chaque indice du dictionnaire de textes, les numéros de compte retenus. */
function marquer(f: FecColonnes, prefixes: readonly string[], exclus: readonly string[] = []): Uint8Array {
  const m = new Uint8Array(f.textes.length);
  for (const c of new Set(f.compteNum)) {
    const num = f.textes[c]!;
    if (commence(num, prefixes) && !commence(num, exclus)) m[c] = 1;
  }
  return m;
}

const moisDe = (d: number) => (d > 0 ? `${Math.floor(d / 10000)}-${String(Math.floor(d / 100) % 100).padStart(2, '0')}` : '');

export function construireDonneesTva(colonnes: FecColonnes, imp: ImportEnregistre, dossier: Pick<Dossier, 'id' | 'nom'>): DonneesTvaFec {
  const { metadonnees, journalAN } = lireDossierFec(imp, dossier);
  const ctx: ContexteAnalyse = creerContexte(colonnes, metadonnees.exercice, journalAN);
  const f = colonnes;
  let balance: SoldeCompteTva[] | null = null;
  // Lignes de chaque écriture (indices), construites à la demande.
  let parEcriture: Map<number, number[]> | null = null;
  const lignesDesEcritures = () => {
    if (!parEcriture) {
      parEcriture = new Map();
      for (let i = 0; i < f.nbLignes; i++) {
        const e = f.ecriture[i]!;
        const l = parEcriture.get(e);
        if (l) l.push(i);
        else parEcriture.set(e, [i]);
      }
    }
    return parEcriture;
  };

  return {
    version: VERSION_INTERFACE_TVA,
    metadonnees,
    comptes() {
      balance ??= calculerBalance(ctx).comptes.map((c) => ({ compteNum: c.compteNum, compteLib: c.compteLib, ouverture: c.ouverture, debit: c.debit, credit: c.credit, cloture: c.cloture }));
      return balance;
    },
    mouvementsMensuels(prefixes, exclus = []) {
      const retenus = marquer(f, prefixes, exclus);
      const m = new Map<string, MouvementMensuel>();
      for (let i = 0; i < f.nbLignes; i++) {
        if (ctx.an[i] || !retenus[f.compteNum[i]!]) continue;
        const cle = moisDe(f.ecritureDate[i]!);
        let x = m.get(cle);
        if (!x) m.set(cle, (x = { mois: cle, debit: 0, credit: 0 }));
        x.debit += f.debit[i]!;
        x.credit += f.credit[i]!;
      }
      return [...m.values()].sort((a, b) => a.mois.localeCompare(b.mois));
    },
    observerVentes({ produits, tva, clients }) {
      const estProduit = marquer(f, produits);
      const estTva = marquer(f, tva);
      const estClient = marquer(f, clients);
      const obs = new Map<number, ObservationVentes>();
      const libelles = new Map<number, number>();
      const observation = (c: number) => {
        let o = obs.get(c);
        if (!o) obs.set(c, (o = { compteNum: f.textes[c]!, compteLib: '', ca: 0, parTaux: {}, sansTva: 0, tauxInconnu: 0, autres: 0, nbEcrituresVente: 0 }));
        return o;
      };
      const ecritures = new Set<number>();
      for (let i = 0; i < f.nbLignes; i++) {
        if (ctx.an[i] || !estProduit[f.compteNum[i]!]) continue;
        const o = observation(f.compteNum[i]!);
        o.ca += f.credit[i]! - f.debit[i]!;
        if (!libelles.has(f.compteNum[i]!)) libelles.set(f.compteNum[i]!, f.compteLib[i]!);
        ecritures.add(f.ecriture[i]!);
      }
      const index = lignesDesEcritures();
      for (const e of ecritures) {
        const lignes = index.get(e)!;
        const htParCompte = new Map<number, number>();
        let taxe = 0;
        let client = false;
        for (const i of lignes) {
          if (ctx.an[i]) continue;
          const c = f.compteNum[i]!;
          if (estProduit[c]) htParCompte.set(c, (htParCompte.get(c) ?? 0) + f.credit[i]! - f.debit[i]!);
          else if (estTva[c]) taxe += f.credit[i]! - f.debit[i]!;
          else if (estClient[c]) client = true;
        }
        const ht = [...htParCompte.values()].reduce((a, b) => a + b, 0);
        let taux: number | null = null;
        if (taxe !== 0 && ht !== 0) {
          // Tolérance d'arrondi : 2 centimes par ligne de produit, ou 0,1 % de la taxe.
          const tolerance = Math.max(2 * htParCompte.size, Math.abs(taxe) * 0.001);
          taux = TAUX_CONNUS.find((tx) => Math.abs(taxe - (ht * tx) / 10000) <= tolerance) ?? null;
        }
        for (const [c, montant] of htParCompte) {
          const o = observation(c);
          if (taxe !== 0) {
            if (taux !== null) o.parTaux[taux] = (o.parTaux[taux] ?? 0) + montant;
            else o.tauxInconnu += montant;
            if (client) o.nbEcrituresVente++;
          } else if (client) {
            o.sansTva += montant;
            o.nbEcrituresVente++;
          } else o.autres += montant;
        }
      }
      for (const [c, o] of obs) o.compteLib = f.textes[libelles.get(c) ?? 0] ?? '';
      return [...obs.values()].sort((a, b) => a.compteNum.localeCompare(b.compteNum));
    },
    lignes(filtre, limite = 2000) {
      const retenus = marquer(f, filtre.comptes);
      const resultat: LigneDetailFec[] = [];
      let total = 0;
      for (let i = 0; i < f.nbLignes; i++) {
        if (!retenus[f.compteNum[i]!]) continue;
        if (ctx.an[i] && !filtre.aNouveaux) continue;
        if (filtre.mois && moisDe(f.ecritureDate[i]!) !== filtre.mois) continue;
        if (filtre.sens === 'debit' && !f.debit[i]) continue;
        if (filtre.sens === 'credit' && !f.credit[i]) continue;
        total++;
        if (resultat.length >= limite) continue;
        resultat.push({
          ligneOrigine: f.ligneOrigine[i]!,
          date: f.ecritureDate[i]! > 0 ? dateIso(f.ecritureDate[i]!) : null,
          journal: t(f, 'journalCode', i),
          ecritureNum: t(f, 'ecritureNum', i),
          pieceRef: t(f, 'pieceRef', i),
          libelle: t(f, 'ecritureLib', i),
          compteNum: t(f, 'compteNum', i),
          compteLib: t(f, 'compteLib', i),
          compAuxNum: t(f, 'compAuxNum', i),
          debit: f.debit[i]!,
          credit: f.credit[i]!,
          aNouveau: ctx.an[i] === 1,
        });
      }
      return { lignes: resultat, total };
    },
  };
}

/** Charge l'interface d'un dossier depuis le stockage local (FEC N par défaut) ; null si absent. */
export async function chargerDonneesTva(dossierId: string, role: Role = 'N'): Promise<DonneesTvaFec | null> {
  const dossier = await lireDossier(dossierId);
  const id = dossier?.fec[role];
  if (!dossier || !id) return null;
  const [imp, colonnes] = await Promise.all([lireImport(id), lireColonnes(id)]);
  if (!imp || !colonnes) return null;
  return construireDonneesTva(colonnes, imp, dossier);
}
