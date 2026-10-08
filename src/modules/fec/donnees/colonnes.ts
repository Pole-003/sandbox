/**
 * FEC normalisé, stocké en colonnes : une colonne par zone, en tableaux typés, et un dictionnaire unique
 * pour les textes (chaque ligne ne porte qu'un indice). Environ 75 octets par ligne : 3 millions de lignes
 * tiennent en 250 Mo environ, transférables sans copie du Worker au fil principal puis vers IndexedDB.
 *
 * Conventions :
 *  - textes : indice dans `textes` (0 = chaîne vide) ;
 *  - dates : entier AAAAMMJJ, 0 = vide, -1 = invalide ;
 *  - montants : centimes entiers dans des Float64Array (exacts jusqu'à 2^53), débit et crédit positifs ;
 *  - Montantdevise : NaN si vide.
 */

export const COLONNES_TEXTE = [
  'journalCode',
  'journalLib',
  'ecritureNum',
  'compteNum',
  'compteLib',
  'compAuxNum',
  'compAuxLib',
  'pieceRef',
  'ecritureLib',
  'ecritureLet',
  'idevise',
  'modeRglt',
  'natOp',
  'idClient',
] as const;
export const COLONNES_DATE = ['ecritureDate', 'pieceDate', 'validDate', 'dateLet', 'dateRglt'] as const;
export const COLONNES_MONTANT = ['debit', 'credit', 'montantDevise'] as const;

export type ColonneTexte = (typeof COLONNES_TEXTE)[number];
export type ColonneDate = (typeof COLONNES_DATE)[number];
export type ColonneMontant = (typeof COLONNES_MONTANT)[number];

export type FecColonnes = {
  nbLignes: number;
  nbEcritures: number;
  textes: string[];
  /** Numéro de ligne d'origine (fichier à plat : en-tête = 1 ; XML : rang de l'élément <ligne>). */
  ligneOrigine: Uint32Array;
  /** Indice de l'écriture (JournalCode + EcritureNum), de 0 à nbEcritures − 1, par ordre d'apparition. */
  ecriture: Uint32Array;
} & Record<ColonneTexte, Uint32Array> &
  Record<ColonneDate, Int32Array> &
  Record<ColonneMontant, Float64Array>;

/** Ligne en cours de normalisation (valeurs déjà converties). */
export interface LigneNormalisee {
  ligneOrigine: number;
  journalCode: string;
  journalLib: string;
  ecritureNum: string;
  compteNum: string;
  compteLib: string;
  compAuxNum: string;
  compAuxLib: string;
  pieceRef: string;
  ecritureLib: string;
  ecritureLet: string;
  idevise: string;
  modeRglt: string;
  natOp: string;
  idClient: string;
  ecritureDate: number;
  pieceDate: number;
  validDate: number;
  dateLet: number;
  dateRglt: number;
  debit: number;
  credit: number;
  montantDevise: number;
}

type Tableau = Uint32Array | Int32Array | Float64Array;

/** Construit les colonnes au fil de la lecture (capacité doublée à la demande). */
export class ConstructeurColonnes {
  private capacite: number;
  private n = 0;
  private readonly dictionnaire = new Map<string, number>([['', 0]]);
  private readonly textes: string[] = [''];
  private readonly ecritures = new Map<number, number>();
  private colonnes: Record<string, Tableau>;

  constructor(capaciteInitiale = 65_536) {
    this.capacite = capaciteInitiale;
    this.colonnes = this.allouer(capaciteInitiale);
  }

  private allouer(capacite: number): Record<string, Tableau> {
    const c: Record<string, Tableau> = {
      ligneOrigine: new Uint32Array(capacite),
      ecriture: new Uint32Array(capacite),
    };
    for (const nom of COLONNES_TEXTE) c[nom] = new Uint32Array(capacite);
    for (const nom of COLONNES_DATE) c[nom] = new Int32Array(capacite);
    for (const nom of COLONNES_MONTANT) c[nom] = new Float64Array(capacite);
    return c;
  }

  get nbLignes(): number {
    return this.n;
  }

  texte(valeur: string): number {
    let i = this.dictionnaire.get(valeur);
    if (i === undefined) {
      i = this.textes.length;
      // Copie à plat : une sous-chaîne V8 retiendrait en mémoire tout le morceau de fichier dont elle est issue.
      const copie = valeur.length > 12 ? (valeur + ' ').slice(0, -1) : valeur;
      this.textes.push(copie);
      this.dictionnaire.set(copie, i);
    }
    return i;
  }

  /** Dernière valeur vue par colonne : les zones d'écriture se répètent d'une ligne à la suivante. */
  private readonly derniers = new Map<string, [string, number]>();

  private texteColonne(colonne: string, valeur: string): number {
    const d = this.derniers.get(colonne);
    if (d && d[0] === valeur) return d[1];
    const i = this.texte(valeur);
    if (d) {
      d[0] = valeur;
      d[1] = i;
    } else this.derniers.set(colonne, [valeur, i]);
    return i;
  }

  /** Ajoute une ligne ; renvoie l'indice de son écriture et indique si l'écriture est nouvelle. */
  ajouter(l: LigneNormalisee): { ecriture: number; nouvelle: boolean } {
    if (this.n === this.capacite) {
      const plus = this.allouer(this.capacite * 2);
      for (const [nom, t] of Object.entries(this.colonnes)) (plus[nom] as Tableau).set(t as never);
      this.colonnes = plus;
      this.capacite *= 2;
    }
    const i = this.n++;
    const c = this.colonnes as Record<'ligneOrigine' | 'ecriture' | ColonneTexte, Uint32Array> &
      Record<ColonneDate, Int32Array> &
      Record<ColonneMontant, Float64Array>;
    // Affectations déroulées : nettement plus rapides qu'une boucle sur les noms de colonnes.
    c.journalCode[i] = this.texteColonne('journalCode', l.journalCode);
    c.journalLib[i] = this.texteColonne('journalLib', l.journalLib);
    c.ecritureNum[i] = this.texteColonne('ecritureNum', l.ecritureNum);
    c.compteNum[i] = this.texteColonne('compteNum', l.compteNum);
    c.compteLib[i] = this.texteColonne('compteLib', l.compteLib);
    c.compAuxNum[i] = this.texteColonne('compAuxNum', l.compAuxNum);
    c.compAuxLib[i] = this.texteColonne('compAuxLib', l.compAuxLib);
    c.pieceRef[i] = this.texteColonne('pieceRef', l.pieceRef);
    c.ecritureLib[i] = this.texteColonne('ecritureLib', l.ecritureLib);
    c.ecritureLet[i] = this.texteColonne('ecritureLet', l.ecritureLet);
    c.idevise[i] = this.texteColonne('idevise', l.idevise);
    c.modeRglt[i] = this.texteColonne('modeRglt', l.modeRglt);
    c.natOp[i] = this.texteColonne('natOp', l.natOp);
    c.idClient[i] = this.texteColonne('idClient', l.idClient);
    c.ecritureDate[i] = l.ecritureDate;
    c.pieceDate[i] = l.pieceDate;
    c.validDate[i] = l.validDate;
    c.dateLet[i] = l.dateLet;
    c.dateRglt[i] = l.dateRglt;
    c.debit[i] = l.debit;
    c.credit[i] = l.credit;
    c.montantDevise[i] = l.montantDevise;
    c.ligneOrigine[i] = l.ligneOrigine;
    // Clé numérique JournalCode × 2^32 + EcritureNum (indices du dictionnaire, < 2^53).
    const cle = c.journalCode[i]! * 4294967296 + c.ecritureNum[i]!;
    let e = this.ecritures.get(cle);
    const nouvelle = e === undefined;
    if (e === undefined) {
      e = this.ecritures.size;
      this.ecritures.set(cle, e);
    }
    c.ecriture[i] = e;
    return { ecriture: e, nouvelle };
  }

  terminer(): FecColonnes {
    const n = this.n;
    // Recopie seulement si la capacité inutilisée dépasse 20 % (évite de doubler la mémoire au pic).
    const coupe = <T extends Tableau>(t: T): T => (n >= 0.8 * this.capacite ? t.subarray(0, n) : t.slice(0, n)) as T;
    const resultat: Record<string, unknown> = { nbLignes: n, nbEcritures: this.ecritures.size, textes: this.textes };
    for (const [nom, t] of Object.entries(this.colonnes)) resultat[nom] = coupe(t);
    return resultat as FecColonnes;
  }
}

/** Tampons à transférer (postMessage) sans copie. */
export function tamponsTransferables(f: FecColonnes): ArrayBuffer[] {
  const tampons: ArrayBuffer[] = [f.ligneOrigine.buffer as ArrayBuffer, f.ecriture.buffer as ArrayBuffer];
  for (const nom of COLONNES_TEXTE) tampons.push(f[nom].buffer as ArrayBuffer);
  for (const nom of COLONNES_DATE) tampons.push(f[nom].buffer as ArrayBuffer);
  for (const nom of COLONNES_MONTANT) tampons.push(f[nom].buffer as ArrayBuffer);
  return tampons;
}

/** Texte d'une colonne à une ligne donnée. */
export function texteDe(f: FecColonnes, colonne: ColonneTexte, ligne: number): string {
  return f.textes[f[colonne][ligne]!]!;
}
