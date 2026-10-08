/**
 * Cadrage par période de déclaration et contrôles complémentaires (fonctions pures).
 *
 * Vue par période : pour chaque CA3 de l'exercice (mensuelle ou trimestrielle), TVA collectée déclarée,
 * TVA comptabilisée au crédit des comptes 4457 dans le FEC sur les mêmes mois (et TVA autoliquidée sur
 * achats, au crédit de 4452, comprise dans la TVA collectée déclarée), CA déclaré (opérations
 * de vente des cadres A, E, F) et CA comptabilisé (produits retenus), avec les écarts. Le décalage
 * déclaratif est pris en compte : la CA3 d'une période, déposée le mois suivant, est rapprochée des
 * écritures de la période elle-même (date de dépôt affichée). Les mois de l'exercice qu'aucune
 * déclaration ne couvre sont présentés à part.
 *
 * Contrôles complémentaires : TVA à décaisser comptabilisée (4455) et lignes 28 / 32 ; crédit de TVA
 * (44567) et ligne 27 de la dernière déclaration ; solde des comptes de TVA collectée (4457, 44587) à la
 * clôture et TVA comprise dans les encours (régime des encaissements).
 */
import type { MouvementMensuel, SoldeCompteTva } from '../../fec/interface-tva.ts';
import type { IdentificationCa3, ValeurCase } from '../ca3/analyse.ts';
import { tvaCollecteeDeclaree } from '../ca3/controles.ts';
import { libellePeriode, valeur } from '../ca3/declaration.ts';
import type { G340 } from './g340.ts';
import type { ParametresCadrage } from './parametres.ts';

/** Opérations de vente déclarées (CA déclaré) : A1, A2 et ventes non taxées. */
export const CASES_CA_DECLARE = ['A1', 'A2', 'E1', 'E2', 'E3', 'F2', 'F3'];

export interface LigneMensuelle {
  periode: string;
  /** Mois « AAAA-MM » couverts. */
  mois: string[];
  dateDepot: string | null;
  tvaDeclaree: number | null;
  tva4457: number;
  /** TVA autoliquidée sur achats (crédits 4452), déclarée avec la TVA collectée (ligne 08…). */
  tvaAutoliquidee: number;
  /** TVA déclarée − (TVA 4457 + TVA autoliquidée). */
  ecartTva: number | null;
  caDeclare: number | null;
  caComptabilise: number;
  ecartCa: number | null;
}

export interface ControleComplementaire {
  cle: string;
  libelle: string;
  comptable: number;
  declare: number | null;
  ecart: number | null;
  explication: string;
  comptes: string[];
}

const moisEntre = (debut: string, fin: string): string[] => {
  const r: string[] = [];
  let a = Number(debut.slice(0, 4));
  let m = Number(debut.slice(5, 7));
  const af = Number(fin.slice(0, 4));
  const mf = Number(fin.slice(5, 7));
  while (a < af || (a === af && m <= mf)) {
    r.push(`${a}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      a++;
    }
  }
  return r;
};

export interface DeclarationRetenue {
  identification: IdentificationCa3;
  valeurs: Record<string, ValeurCase>;
}

export function cadrageMensuel(
  exercice: { debut: string; fin: string },
  declarations: DeclarationRetenue[],
  tva4457: MouvementMensuel[],
  produits: MouvementMensuel[],
  autoliquidation: MouvementMensuel[] = [],
): LigneMensuelle[] {
  const credit4457 = new Map(tva4457.map((m) => [m.mois, m.credit]));
  const credit4452 = new Map(autoliquidation.map((m) => [m.mois, m.credit]));
  const ca = new Map(produits.map((m) => [m.mois, m.credit - m.debit]));
  const somme = (mois: string[], m: Map<string, number>) => mois.reduce((s, x) => s + (m.get(x) ?? 0), 0);
  const lignes: LigneMensuelle[] = [];
  const couverts = new Set<string>();
  for (const d of declarations) {
    const { debut, fin, dateDepot } = d.identification;
    if (!debut || !fin) continue;
    const mois = moisEntre(debut, fin);
    mois.forEach((x) => couverts.add(x));
    const tvaDeclaree = tvaCollecteeDeclaree(d.valeurs);
    const caDeclare = CASES_CA_DECLARE.reduce((s, c) => s + valeur(d.valeurs, c, 'montant'), 0);
    const t = somme(mois, credit4457);
    const a = somme(mois, credit4452);
    const c = somme(mois, ca);
    lignes.push({ periode: libellePeriode(debut, fin), mois, dateDepot, tvaDeclaree, tva4457: t, tvaAutoliquidee: a, ecartTva: tvaDeclaree - t - a, caDeclare, caComptabilise: c, ecartCa: caDeclare - c });
  }
  for (const m of moisEntre(exercice.debut, exercice.fin)) {
    if (couverts.has(m)) continue;
    lignes.push({ periode: `${m.slice(5)}/${m.slice(0, 4)} (non déclaré)`, mois: [m], dateDepot: null, tvaDeclaree: null, tva4457: credit4457.get(m) ?? 0, tvaAutoliquidee: credit4452.get(m) ?? 0, ecartTva: null, caDeclare: null, caComptabilise: ca.get(m) ?? 0, ecartCa: null });
  }
  return lignes.sort((a, b) => a.mois[0]!.localeCompare(b.mois[0]!));
}

const prefixeSomme = (comptes: SoldeCompteTva[], prefixes: string[], cle: 'cloture' | 'credit' | 'debit') => comptes.reduce((s, c) => (prefixes.some((p) => c.compteNum.startsWith(p)) ? s + c[cle] : s), 0);

export function controlesComplementaires(comptes: SoldeCompteTva[], declarations: DeclarationRetenue[], g340: G340 | null, p: ParametresCadrage, finExercice: string): ControleComplementaire[] {
  const c: ControleComplementaire[] = [];
  const total = (code: string) => declarations.reduce((s, d) => s + valeur(d.valeurs, code, 'montant'), 0);
  const derniere = [...declarations].sort((a, b) => (a.identification.fin ?? '').localeCompare(b.identification.fin ?? '')).at(-1);
  const derniereALaCloture = derniere?.identification.fin === finExercice ? derniere : undefined;
  const ecart = (a: number, b: number | null) => (b === null ? null : a - b);

  const credits4455 = prefixeSomme(comptes, ['4455'], 'credit');
  c.push({
    cle: '4455-mouvements',
    libelle: 'TVA à décaisser comptabilisée (crédits 4455) / TVA nette due déclarée (lignes 28)',
    comptable: credits4455,
    declare: total('28'),
    ecart: ecart(credits4455, total('28')),
    explication: 'Les liquidations mensuelles de l’exercice doivent correspondre à la TVA nette due déclarée sur la même période.',
    comptes: ['4455'],
  });
  const solde4455 = -prefixeSomme(comptes, ['4455'], 'cloture');
  const l28 = derniereALaCloture ? valeur(derniereALaCloture.valeurs, '28', 'montant') : null;
  c.push({
    cle: '4455-solde',
    libelle: `Solde de 4455 à la clôture / ligne 28 de la dernière déclaration${derniereALaCloture ? ` (${libellePeriode(derniereALaCloture.identification.debut, derniereALaCloture.identification.fin)})` : ''}`,
    comptable: solde4455,
    declare: l28,
    ecart: ecart(solde4455, l28),
    explication: derniereALaCloture ? 'La dette de TVA à la clôture correspond à la TVA due de la dernière période, payée après la clôture (ligne 32 si des taxes assimilées s’y ajoutent).' : 'Aucune déclaration ne se termine à la date de clôture.',
    comptes: ['4455'],
  });
  const credit44567 = prefixeSomme(comptes, ['44567'], 'cloture');
  const l27 = derniereALaCloture ? valeur(derniereALaCloture.valeurs, '27', 'montant') : null;
  c.push({
    cle: '44567',
    libelle: 'Crédit de TVA à reporter (solde de 44567) / ligne 27 de la dernière déclaration',
    comptable: credit44567,
    declare: l27,
    ecart: ecart(credit44567, l27),
    explication: 'Le crédit de TVA comptabilisé à la clôture correspond au crédit à reporter de la dernière déclaration.',
    comptes: ['44567'],
  });
  if (g340 && p.regime !== 'debits') {
    const soldeCollectee = -prefixeSomme(comptes, p.prefixesTva, 'cloture');
    const tvaEncours = g340.regularisations.filter((r) => r.cle !== 'pertes' && r.cle !== 'autoliquidation' && r.cle !== 'pca').reduce((s, r) => s + r.parTaux.reduce((t, x) => t + x.tvaN, 0), 0);
    c.push({
      cle: '4457-encours',
      libelle: `Solde des comptes de TVA collectée (${p.prefixesTva.join(', ')}) à la clôture / TVA comprise dans les encours N`,
      comptable: soldeCollectee,
      declare: tvaEncours,
      ecart: soldeCollectee - tvaEncours,
      explication: 'Au régime des encaissements, la TVA des factures non encaissées reste due à la clôture : le solde des comptes de TVA collectée doit correspondre à la TVA comprise dans les encours clients, clients douteux, avances et factures à établir.',
      comptes: p.prefixesTva,
    });
  }
  return c;
}
