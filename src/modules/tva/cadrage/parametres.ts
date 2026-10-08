/**
 * Paramètres du cadrage de TVA d'un dossier (SPEC 5.3), enregistrés avec les déclarations.
 * Montants en centimes ; taux en points de base (2000 = 20 %).
 */

export type Regime = 'encaissements' | 'debits' | 'mixte';

/** Nature d'une vente, qui détermine la case de la CA3 quand elle n'est pas imposable. */
export type Nature = 'imposable' | 'autoliquidation' | 'exportation' | 'intracom-biens' | 'exoneree';

/** Encours clients et assimilés soumis aux régularisations du régime des encaissements. */
export type CategorieEncours = 'clients' | 'douteux' | 'avances' | 'fae' | 'pca';

export const LIBELLES_ENCOURS: Record<CategorieEncours, { libelle: string; ttc: boolean }> = {
  clients: { libelle: 'Clients dus TTC', ttc: true },
  douteux: { libelle: 'Clients douteux TTC', ttc: true },
  avances: { libelle: 'Avances et acomptes reçus TTC', ttc: true },
  fae: { libelle: 'Factures à établir TTC', ttc: true },
  pca: { libelle: 'Produits constatés d’avance HT', ttc: false },
};

export const CATEGORIES_ENCOURS = Object.keys(LIBELLES_ENCOURS) as CategorieEncours[];

/** Réglages d'un compte de produits (saisie du collaborateur, prioritaire sur la proposition). */
export interface ReglageCompte {
  /** Taux en points de base ; 0 ou null : non imposable. */
  taux?: number | null;
  nature?: Nature;
  /** CA exonéré (centimes), remplace la valeur observée. */
  exonere?: number;
  caseCa3?: string;
  /** Compte écarté du chiffre d'affaires. */
  exclu?: boolean;
  /** Régime d'exigibilité du compte (régime mixte). */
  regime?: 'encaissements' | 'debits';
}

export interface SoldeN1 {
  /** Solde signé (débit positif), centimes. */
  montant: number;
  source: 'an' | 'fec-n1' | 'saisie';
}

export interface LigneJustification {
  id: string;
  libelle: string;
  montant: number;
  commentaire: string;
  piece: string;
}

export interface ParametresCadrage {
  version: 1;
  regime: Regime;
  /** Seuil d'écart acceptable (centimes). */
  seuil: number;
  collaborateur: string;
  /** Préfixes des comptes de produits retenus (70 par défaut ; 75, 77… sélectionnables). */
  prefixesProduits: string[];
  /** Comptes de TVA collectée observés dans les écritures de vente (4457 et 44587 : TVA non encaissée). */
  prefixesTva: string[];
  prefixesEncours: Record<CategorieEncours, string[]>;
  /** Pertes sur créances irrécouvrables (TVA à régulariser). */
  prefixesPertes: string[];
  /** TVA autoliquidée sur les achats (TVA due intracommunautaire, 4452), comprise dans la TVA collectée déclarée. */
  prefixesAutoliquidation: string[];
  comptes: Record<string, ReglageCompte>;
  ventilation: {
    methode: 'prorata' | 'manuelle';
    /**
     * Ventilation saisie, en montants (centimes, signés comme le solde) par taux (points de base, « 0 » pour
     * le non imposable), pour chaque solde : « clients:n1 », « clients:n », …, « pertes:n ». Un solde sans
     * ventilation saisie reste au prorata ; un écart entre la somme saisie et le solde est porté au taux principal.
     */
    manuelle: Partial<Record<string, Record<string, number>>>;
  };
  /** Soldes N-1 retenus ; absent = pré-rempli depuis les à-nouveaux ou le FEC N-1. */
  soldesN1: Partial<Record<CategorieEncours, SoldeN1>>;
  justifications: LigneJustification[];
}

export function parametresParDefaut(seuil = 100_000): ParametresCadrage {
  return {
    version: 1,
    regime: 'encaissements',
    seuil,
    collaborateur: '',
    prefixesProduits: ['70'],
    prefixesTva: ['4457', '44587'],
    prefixesEncours: { clients: ['411', '413'], douteux: ['416'], avances: ['4191'], fae: ['418'], pca: ['487'] },
    prefixesPertes: ['654'],
    prefixesAutoliquidation: ['4452'],
    comptes: {},
    ventilation: { methode: 'prorata', manuelle: {} },
    soldesN1: {},
    justifications: [],
  };
}

/** Exemples de lignes de justification proposés (notre feuille G340). */
export const EXEMPLES_JUSTIFICATION = ['Régularisation N-1', 'Régularisation intracommunautaire', 'Écart de déclaration du mois de …', 'Régularisation N'];

/** Case de la CA3 correspondant à un taux ou à une nature d'opération. */
export function caseParDefaut(taux: number | null, nature: Nature): string | null {
  if (nature !== 'imposable' || !taux) return { autoliquidation: 'E2', exportation: 'E1', 'intracom-biens': 'F2', exoneree: 'E2', imposable: 'E2' }[nature];
  return ({ 2000: '08', 1000: '9B', 550: '09', 850: '10', 210: 'T6', 1300: 'TC', 175: 'T1', 105: 'T2', 90: 'T5' } as Record<number, string>)[taux] ?? null;
}

export const LIBELLES_NATURES: Record<Nature, string> = {
  imposable: 'Imposable',
  autoliquidation: 'Autoliquidation (preneur assujetti)',
  exportation: 'Exportation hors UE',
  'intracom-biens': 'Livraison intracommunautaire de biens',
  exoneree: 'Exonérée ou non imposable',
};

/** Indice de taux ou de nature dans un libellé de compte (« 20 % », « 5,5 », « AUTO LIQ », « EXO », « EXPORT »). */
export function indiceLibelle(libelle: string): { taux?: number; nature?: Nature } | null {
  const l = libelle.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  if (/AUTO\s*-?\s*LIQ|AUTOLIQ/.test(l)) return { taux: 0, nature: 'autoliquidation' };
  if (/EXPORT/.test(l)) return { taux: 0, nature: 'exportation' };
  if (/\bEXO|EXONER|NON IMPOSABLE|HORS TAXE|\bHT\b.*\bEXO/.test(l)) return { taux: 0, nature: 'exoneree' };
  if (/INTRA|\bUE\b|\bCEE\b/.test(l)) return { taux: 0, nature: 'autoliquidation' };
  const m = /(?:^|[^\d,.])(20|10|8[,.]5|5[,.]5|2[,.]1|13|1[,.]75|1[,.]05|0[,.]9)\s*%?(?![\d,.])/.exec(l);
  if (m) return { taux: Math.round(Number(m[1]!.replace(',', '.')) * 100), nature: 'imposable' };
  return null;
}
