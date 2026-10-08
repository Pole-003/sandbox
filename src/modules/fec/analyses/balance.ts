/**
 * Balance générale : solde d'ouverture (à-nouveaux), mouvements débit et crédit hors à-nouveaux,
 * solde de clôture ; regroupements par classe et sous-classe ; comparaison N / N-1.
 * Montants en centimes entiers.
 */
import type { ContexteAnalyse } from './contexte.ts';

export interface SoldesCompte {
  /** Solde d'ouverture débit − crédit (à-nouveaux). */
  ouverture: number;
  /** Mouvements de l'exercice hors à-nouveaux. */
  debit: number;
  credit: number;
  /** Solde de clôture = ouverture + débit − crédit. */
  cloture: number;
  nbLignes: number;
}

export interface LigneBalance extends SoldesCompte {
  compteNum: string;
  compteLib: string;
}

export interface GroupeBalance extends SoldesCompte {
  /** « 4 », « 41 »… */
  code: string;
  libelle: string;
  niveau: 'classe' | 'sous-classe';
  comptes: LigneBalance[];
  sousGroupes: GroupeBalance[];
}

export interface Balance {
  comptes: LigneBalance[];
  classes: GroupeBalance[];
  total: SoldesCompte;
  /** Total débit = total crédit, pour l'ouverture, les mouvements et le total général. */
  equilibre: { ouverture: boolean; mouvements: boolean; cloture: boolean };
}

export const LIBELLES_CLASSES: Record<string, string> = {
  '1': 'Comptes de capitaux',
  '2': "Comptes d'immobilisations",
  '3': 'Comptes de stocks et en-cours',
  '4': 'Comptes de tiers',
  '5': 'Comptes financiers',
  '6': 'Comptes de charges',
  '7': 'Comptes de produits',
  '8': 'Comptes spéciaux',
  '9': 'Comptabilité analytique',
};

const vide = (): SoldesCompte => ({ ouverture: 0, debit: 0, credit: 0, cloture: 0, nbLignes: 0 });

function cumuler(cible: SoldesCompte, s: SoldesCompte): void {
  cible.ouverture += s.ouverture;
  cible.debit += s.debit;
  cible.credit += s.credit;
  cible.cloture += s.cloture;
  cible.nbLignes += s.nbLignes;
}

/** Soldes par clé (indice de dictionnaire), sur les lignes retenues. */
export function soldesPar(ctx: ContexteAnalyse, cle: Uint32Array, retenir: (i: number) => boolean = () => true): Map<number, SoldesCompte> {
  const { f, an } = ctx;
  const m = new Map<number, SoldesCompte>();
  for (let i = 0; i < f.nbLignes; i++) {
    if (!retenir(i)) continue;
    const k = cle[i]!;
    let s = m.get(k);
    if (!s) m.set(k, (s = vide()));
    const d = f.debit[i]!;
    const c = f.credit[i]!;
    if (an[i]) s.ouverture += d - c;
    else {
      s.debit += d;
      s.credit += c;
    }
    s.cloture += d - c;
    s.nbLignes++;
  }
  return m;
}

/** Libellé majoritaire de chaque compte. */
function libellesMajoritaires(ctx: ContexteAnalyse): Map<number, number> {
  const { f } = ctx;
  const comptes = new Map<number, Map<number, number>>();
  for (let i = 0; i < f.nbLignes; i++) {
    let m = comptes.get(f.compteNum[i]!);
    if (!m) comptes.set(f.compteNum[i]!, (m = new Map()));
    m.set(f.compteLib[i]!, (m.get(f.compteLib[i]!) ?? 0) + 1);
  }
  const r = new Map<number, number>();
  for (const [c, m] of comptes) r.set(c, [...m].sort((a, b) => b[1] - a[1] || (a[0] === 0 ? 1 : 0))[0]![0]);
  return r;
}

export function calculerBalance(ctx: ContexteAnalyse): Balance {
  const { f } = ctx;
  const soldes = soldesPar(ctx, f.compteNum);
  const libelles = libellesMajoritaires(ctx);
  const comptes: LigneBalance[] = [...soldes]
    .map(([c, s]) => ({ compteNum: f.textes[c]!, compteLib: f.textes[libelles.get(c)!]!, ...s }))
    .sort((a, b) => (a.compteNum < b.compteNum ? -1 : a.compteNum > b.compteNum ? 1 : 0));
  const classes = new Map<string, GroupeBalance>();
  const total = vide();
  // Totaux débit/crédit séparés pour contrôler l'équilibre.
  let ouvD = 0;
  let ouvC = 0;
  let mvtD = 0;
  let mvtC = 0;
  for (let i = 0; i < f.nbLignes; i++) {
    if (ctx.an[i]) {
      ouvD += f.debit[i]!;
      ouvC += f.credit[i]!;
    } else {
      mvtD += f.debit[i]!;
      mvtC += f.credit[i]!;
    }
  }
  for (const l of comptes) {
    const codeClasse = /^\d/.test(l.compteNum) ? l.compteNum[0]! : '?';
    const codeSous = /^\d\d/.test(l.compteNum) ? l.compteNum.slice(0, 2) : `${codeClasse}?`;
    let classe = classes.get(codeClasse);
    if (!classe) {
      classe = { code: codeClasse, libelle: LIBELLES_CLASSES[codeClasse] ?? 'Comptes non codifiés', niveau: 'classe', comptes: [], sousGroupes: [], ...vide() };
      classes.set(codeClasse, classe);
    }
    let sous = classe.sousGroupes.find((g) => g.code === codeSous);
    if (!sous) {
      sous = { code: codeSous, libelle: '', niveau: 'sous-classe', comptes: [], sousGroupes: [], ...vide() };
      classe.sousGroupes.push(sous);
    }
    sous.comptes.push(l);
    cumuler(sous, l);
    cumuler(classe, l);
    cumuler(total, l);
  }
  // Libellé d'une sous-classe : celui de son premier compte « rond » (ex. 401000), à défaut du premier compte.
  for (const c of classes.values()) {
    for (const s of c.sousGroupes) s.libelle = (s.comptes.find((x) => /^\d\d0*$/.test(x.compteNum)) ?? s.comptes[0]!).compteLib;
  }
  return {
    comptes,
    classes: [...classes.values()].sort((a, b) => a.code.localeCompare(b.code)),
    total,
    equilibre: { ouverture: ouvD === ouvC, mouvements: mvtD === mvtC, cloture: total.cloture === 0 },
  };
}

export interface LigneComparaison {
  compteNum: string;
  compteLib: string;
  clotureN: number;
  clotureN1: number | null;
  variation: number;
  /** Variation en % du solde N-1 (null si N-1 nul ou absent). */
  variationPct: number | null;
}

/** Comparaison des soldes de clôture N et N-1 par compte (union des comptes des deux exercices). */
export function comparerBalances(n: Balance, n1: Balance): LigneComparaison[] {
  const parCompte = new Map<string, LigneComparaison>();
  for (const l of n.comptes) {
    parCompte.set(l.compteNum, { compteNum: l.compteNum, compteLib: l.compteLib, clotureN: l.cloture, clotureN1: null, variation: 0, variationPct: null });
  }
  for (const l of n1.comptes) {
    const x = parCompte.get(l.compteNum);
    if (x) x.clotureN1 = l.cloture;
    else parCompte.set(l.compteNum, { compteNum: l.compteNum, compteLib: l.compteLib, clotureN: 0, clotureN1: l.cloture, variation: 0, variationPct: null });
  }
  for (const x of parCompte.values()) {
    x.variation = x.clotureN - (x.clotureN1 ?? 0);
    x.variationPct = x.clotureN1 ? (x.variation / Math.abs(x.clotureN1)) * 100 : null;
  }
  return [...parCompte.values()].sort((a, b) => (a.compteNum < b.compteNum ? -1 : 1));
}

/** Utilitaire pour les vues : ligne d'un compte par son numéro. */
export function compteDe(b: Balance, compteNum: string): LigneBalance | undefined {
  return b.comptes.find((c) => c.compteNum === compteNum);
}

