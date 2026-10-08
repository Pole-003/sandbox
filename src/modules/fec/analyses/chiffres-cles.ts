/**
 * Chiffres clés de l'exercice et soldes intermédiaires de gestion (SIG, présentation du PCG), calculés
 * à partir des soldes de clôture de la balance : de quoi rapprocher le FEC de la liasse fiscale
 * (chiffre d'affaires, résultat…). Montants en centimes ; produits et charges en valeur positive,
 * soldes signés (négatif = perte).
 *
 * Le résultat de l'exercice est toujours « produits (classe 7) − charges (classe 6) » ; les comptes de
 * gestion qu'aucune rubrique ne couvre apparaissent sur une ligne « non classés », pour que les SIG
 * aboutissent exactement à ce résultat. Si les comptes de gestion ont été soldés dans le FEC (écriture de
 * détermination du résultat), le résultat est lu au compte 12.
 */
import type { Balance } from './balance.ts';

export type NatureLigne = 'produit' | 'charge' | 'solde';

export interface LigneSig {
  code: string;
  libelle: string;
  /** Comptes retenus, pour l'info-bulle et l'export (ex. « 707, 7097 »). */
  comptes: string;
  nature: NatureLigne;
  montant: number;
}

export interface ChiffresCles {
  chiffreAffaires: number;
  totalProduits: number;
  totalCharges: number;
  /** Résultat de l'exercice (bénéfice positif). */
  resultat: number;
  /** Solde créditeur du compte 12 à la clôture (bénéfice positif), null si le compte 12 est absent ou soldé. */
  resultatCompte12: number | null;
  /** Comptes de gestion soldés dans le FEC : le résultat est celui du compte 12. */
  gestionSoldee: boolean;
  sig: LigneSig[];
}

interface Rubrique {
  code: string;
  libelle: string;
  nature: Exclude<NatureLigne, 'solde'>;
  inclus: string[];
  exclus?: string[];
}

const R = {
  ventesMarchandises: { code: 'VM', libelle: 'Ventes de marchandises', nature: 'produit', inclus: ['707', '7097'] },
  coutMarchandises: { code: 'CAMV', libelle: 'Coût d’achat des marchandises vendues', nature: 'charge', inclus: ['607', '6087', '6097', '6037'] },
  productionVendue: { code: 'PV', libelle: 'Production vendue (biens et services)', nature: 'produit', inclus: ['70'], exclus: ['707', '7097'] },
  productionStockee: { code: 'PS', libelle: 'Production stockée', nature: 'produit', inclus: ['71'] },
  productionImmobilisee: { code: 'PI', libelle: 'Production immobilisée', nature: 'produit', inclus: ['72', '73'] },
  consommations: { code: 'CT', libelle: 'Consommations en provenance des tiers', nature: 'charge', inclus: ['60', '61', '62'], exclus: ['607', '6087', '6097', '6037'] },
  subventions: { code: 'SE', libelle: 'Subventions d’exploitation', nature: 'produit', inclus: ['74'] },
  impots: { code: 'IT', libelle: 'Impôts, taxes et versements assimilés', nature: 'charge', inclus: ['63'] },
  personnel: { code: 'CP', libelle: 'Charges de personnel', nature: 'charge', inclus: ['64'] },
  autresProduits: { code: 'AP', libelle: 'Autres produits, reprises et transferts de charges d’exploitation', nature: 'produit', inclus: ['75', '781', '791'] },
  autresCharges: { code: 'AC', libelle: 'Autres charges, dotations aux amortissements et provisions d’exploitation', nature: 'charge', inclus: ['65', '681'] },
  produitsFinanciers: { code: 'PF', libelle: 'Produits financiers', nature: 'produit', inclus: ['76', '786', '796'] },
  chargesFinancieres: { code: 'CF', libelle: 'Charges financières', nature: 'charge', inclus: ['66', '686'] },
  produitsExceptionnels: { code: 'PE', libelle: 'Produits exceptionnels', nature: 'produit', inclus: ['77', '787', '797'] },
  chargesExceptionnelles: { code: 'CE', libelle: 'Charges exceptionnelles', nature: 'charge', inclus: ['67', '687'] },
  impotsBenefices: { code: 'IS', libelle: 'Participation des salariés et impôts sur les bénéfices', nature: 'charge', inclus: ['69'] },
} satisfies Record<string, Rubrique>;

const commence = (compte: string, prefixes: string[]) => prefixes.some((p) => compte.startsWith(p));

export function calculerChiffresCles(b: Balance): ChiffresCles {
  // Produits : solde créditeur (−cloture) ; charges : solde débiteur (cloture).
  const montant = (r: Rubrique) => {
    let s = 0;
    for (const c of b.comptes) if (commence(c.compteNum, r.inclus) && !commence(c.compteNum, r.exclus ?? [])) s += c.cloture;
    return r.nature === 'produit' ? -s : s;
  };
  const classe = (k: string) => b.comptes.reduce((s, c) => (c.compteNum.startsWith(k) ? s + c.cloture : s), 0);
  const totalProduits = -classe('7');
  const totalCharges = classe('6');
  const mouvementsGestion = b.comptes.some((c) => /^[67]/.test(c.compteNum) && (c.debit !== 0 || c.credit !== 0));
  const comptes12 = b.comptes.filter((c) => c.compteNum.startsWith('12'));
  const solde12 = -comptes12.reduce((s, c) => s + c.cloture, 0);
  const resultatCompte12 = comptes12.length && solde12 !== 0 ? solde12 : null;
  const gestionSoldee = mouvementsGestion && b.comptes.every((c) => !/^[67]/.test(c.compteNum) || c.cloture === 0) && resultatCompte12 !== null;
  const resultat = gestionSoldee ? resultatCompte12! : totalProduits - totalCharges;

  const sig: LigneSig[] = [];
  const ligne = (r: Rubrique) => {
    const m = montant(r);
    sig.push({ code: r.code, libelle: r.libelle, comptes: [...r.inclus, ...(r.exclus ?? []).map((x) => `hors ${x}`)].join(', '), nature: r.nature, montant: m });
    return m;
  };
  const solde = (code: string, libelle: string, m: number) => {
    sig.push({ code, libelle, comptes: '', nature: 'solde', montant: m });
    return m;
  };

  const vm = ligne(R.ventesMarchandises);
  const camv = ligne(R.coutMarchandises);
  const marge = solde('MC', 'Marge commerciale', vm - camv);
  const pv = ligne(R.productionVendue);
  const ps = ligne(R.productionStockee);
  const pi = ligne(R.productionImmobilisee);
  const production = solde('PX', 'Production de l’exercice', pv + ps + pi);
  const ct = ligne(R.consommations);
  const va = solde('VA', 'Valeur ajoutée', marge + production - ct);
  const ebe = solde('EBE', 'Excédent brut d’exploitation', va + ligne(R.subventions) - ligne(R.impots) - ligne(R.personnel));
  const re = solde('RE', 'Résultat d’exploitation', ebe + ligne(R.autresProduits) - ligne(R.autresCharges));
  const rf = solde('RF', 'Résultat financier', ligne(R.produitsFinanciers) - ligne(R.chargesFinancieres));
  const rcai = solde('RCAI', 'Résultat courant avant impôts', re + rf);
  const rx = solde('RX', 'Résultat exceptionnel', ligne(R.produitsExceptionnels) - ligne(R.chargesExceptionnelles));
  const sigResultat = rcai + rx - ligne(R.impotsBenefices);
  const nonClasses = totalProduits - totalCharges - sigResultat;
  if (nonClasses !== 0) sig.push({ code: 'NC', libelle: 'Comptes de gestion non classés dans les rubriques ci-dessus', comptes: '6, 7', nature: 'solde', montant: nonClasses });
  solde('RN', 'Résultat de l’exercice', totalProduits - totalCharges);

  return { chiffreAffaires: vm + pv, totalProduits, totalCharges, resultat, resultatCompte12, gestionSoldee, sig };
}
