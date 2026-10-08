/** Modèle logique des écritures fictives, indépendant du format de sortie. Montants en centimes entiers, dates ISO. */

export interface LigneFictive {
  compteNum: string;
  compteLib: string;
  compAuxNum: string;
  compAuxLib: string;
  debit: number;
  credit: number;
  /** Libellé propre à la ligne (sinon celui de l'écriture). Jamais utilisé dans les jeux convertis en XML. */
  libelle?: string;
  ecritureLet: string;
  dateLet: string;
  montantDevise: number | null;
  idevise: string;
  /** Pièges : valeur brute imposée pour une zone (ex. date « 20250231 »), écrite telle quelle. */
  brut?: Record<string, string>;
  /** Pièges : ligne de texte entière imposée (ex. ligne vide). */
  brutLigne?: string;
  /** Pièges : nombre de zones retirées en fin de ligne. */
  zonesEnMoins?: number;
}

export interface EcritureFictive {
  journalCode: string;
  journalLib: string;
  ecritureNum: string;
  ecritureDate: string;
  pieceRef: string;
  pieceDate: string;
  ecritureLib: string;
  validDate: string;
  /** Zones des comptabilités de trésorerie BA/BNC (A47 A-1, VIII 5° et 7°). */
  dateRglt?: string;
  modeRglt?: string;
  natOp?: string;
  idClient?: string;
  lignes: LigneFictive[];
  /** Piste d'audit volontaire (documentée dans le README, non écrite dans le fichier). */
  piste?: string;
}

export type Regime = 'bic' | 'ba-tresorerie' | 'bnc-tresorerie';

export interface Societe {
  siren: string;
  raisonSociale: string;
  regime: Regime;
  debut: string;
  cloture: string;
}

export function ligne(
  compteNum: string,
  compteLib: string,
  debit: number,
  credit: number,
  options: Partial<LigneFictive> = {},
): LigneFictive {
  return {
    compteNum,
    compteLib,
    compAuxNum: '',
    compAuxLib: '',
    debit,
    credit,
    ecritureLet: '',
    dateLet: '',
    montantDevise: null,
    idevise: '',
    ...options,
  };
}

/** Code de lettrage alphabétique : 0 → AA, 1 → AB … 675 → ZZ, 676 → AAA… */
export function codeLettrage(n: number): string {
  let longueur = 2;
  let reste = n;
  while (reste >= 26 ** longueur) {
    reste -= 26 ** longueur;
    longueur++;
  }
  let code = '';
  for (let i = 0; i < longueur; i++) {
    code = String.fromCharCode(65 + (reste % 26)) + code;
    reste = Math.floor(reste / 26);
  }
  return code;
}

/** TVA en centimes, arrondi commercial (les montants sont positifs). */
export function tva(ht: number, tauxPourMille: number): number {
  return Math.round((ht * tauxPourMille) / 1000);
}
