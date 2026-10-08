/**
 * Cases de la déclaration n° 3310-CA3 (régime réel normal, mini-réel), d'après les formulaires officiels
 * publiés sur impots.gouv.fr : millésime 2025 (cerfa n° 10963*30) et 2026 (n° 10963*31), qui comportent
 * les mêmes cases. Libellés abrégés quand l'imprimé les répète (« Opérations réalisées dans les DOM… »).
 *
 * Une déclaration d'un millésime absent de MILLESIMES_CONNUS est acceptée avec un avertissement ; une case
 * inconnue de la table est conservée et signalée. Pour un nouveau millésime : vérifier le formulaire,
 * ajouter le millésime aux cases inchangées, créer ou retirer les cases modifiées.
 */

export type SectionCa3 =
  /** A — Montant des opérations réalisées (opérations taxées et non taxées), une colonne HT. */
  | 'operations'
  /** B — TVA brute : base hors taxe et taxe due. */
  | 'tva-brute'
  | 'tva-deductible'
  /** TVA due ou crédit (25, TD). */
  | 'solde'
  /** Régularisation d'accise sur les énergies (X, Y, Z, M). */
  | 'accise'
  /** Détermination du montant à payer et des crédits. */
  | 'determination';

export interface CaseCa3 {
  code: string;
  libelle: string;
  section: SectionCa3;
  /** 2 : « Base hors taxe » et « Taxe due » ; 1 : un seul montant. */
  colonnes: 1 | 2;
  /** Taux de TVA en points de base (2000 = 20 %) pour le contrôle base × taux ≈ taxe. */
  taux?: number;
  /** Ligne de taux comptée dans la « TVA collectée déclarée » (lignes 08 à 13, T1 à TC, P1, P2, I1 à I6). */
  collectee?: boolean;
  /** Valeur en pourcentage (22A), pas en euros. */
  pourcentage?: boolean;
  /** Ligne « dont » : non additionnée dans les totaux. */
  dont?: boolean;
  millesimes: readonly string[];
}

export const MILLESIMES_CONNUS = ['2025', '2026'] as const;
const M = MILLESIMES_CONNUS;

const op = (code: string, libelle: string): CaseCa3 => ({ code, libelle, section: 'operations', colonnes: 1, millesimes: M });
const taux = (code: string, libelle: string, bp: number | undefined): CaseCa3 => ({ code, libelle, section: 'tva-brute', colonnes: 2, taux: bp, collectee: true, millesimes: M });
const un = (code: string, libelle: string, section: SectionCa3, autres: Partial<CaseCa3> = {}): CaseCa3 => ({ code, libelle, section, colonnes: 1, millesimes: M, ...autres });

export const CASES_CA3: readonly CaseCa3[] = [
  op('A1', 'Ventes, prestations de services'),
  op('A2', 'Autres opérations imposables'),
  op('A3', 'Achats de prestations de services réalisés auprès d’un assujetti non établi en France (article 283-2 du CGI)'),
  op('A4', 'Importations (autres que les produits pétroliers)'),
  op('A5', 'Sorties de régime fiscal suspensif et sorties de régime particulier douanier'),
  op('B1', 'Mises à la consommation de produits pétroliers'),
  op('B2', 'Acquisitions intracommunautaires'),
  op('B3', 'Achats d’électricité, de gaz naturel, de chaleur ou de froid imposables en France'),
  op('B4', 'Achats de biens ou de prestations de services réalisés auprès d’un assujetti non établi en France (article 283-1 du CGI)'),
  op('B5', 'Régularisations'),
  op('E1', 'Exportations hors UE'),
  op('E2', 'Autres opérations non imposables'),
  op('E3', 'Ventes à distance taxables dans un autre État membre au profit des personnes non assujetties – Ventes B to C'),
  op('E4', 'Importations (autres que les produits pétroliers)'),
  op('E5', 'Sorties de régime fiscal suspensif (autres que les produits pétroliers)'),
  op('E6', 'Importations placées sous régime fiscal suspensif (autres que les produits pétroliers)'),
  op('F1', 'Acquisitions intracommunautaires'),
  op('F2', 'Livraisons intracommunautaires à destination d’une personne assujettie – Ventes B to B'),
  op('F3', 'Livraisons d’électricité, de gaz naturel, de chaleur ou de froid non imposables en France'),
  op('F4', 'Mises à la consommation de produits pétroliers'),
  op('F5', 'Importations de produits pétroliers placées sous régime fiscal suspensif'),
  op('F6', 'Achats en franchise'),
  op('F7', 'Ventes de biens ou prestations de services réalisées par un assujetti non établi en France (article 283-1 du CGI)'),
  op('F8', 'Régularisations'),
  op('F9', 'Opérations internes réalisées entre membres d’un assujetti unique'),
  taux('08', 'Taux normal 20 %', 2000),
  taux('09', 'Taux réduit 5,5 %', 550),
  taux('9B', 'Taux réduit 10 %', 1000),
  taux('10', 'DOM – Taux normal 8,5 %', 850),
  taux('11', 'DOM – Taux réduit 2,1 %', 210),
  taux('T1', 'Opérations réalisées dans les DOM et imposables au taux de 1,75 %', 175),
  taux('T2', 'Opérations réalisées dans les DOM et imposables au taux de 1,05 %', 105),
  taux('TC', 'Opérations réalisées en Corse et imposables au taux de 13 %', 1300),
  taux('T3', 'Opérations réalisées en Corse et imposables au taux de 10 %', 1000),
  taux('T4', 'Opérations réalisées en Corse et imposables au taux de 2,1 %', 210),
  taux('T5', 'Opérations réalisées en Corse et imposables au taux de 0,9 %', 90),
  taux('T6', 'Opérations réalisées en France continentale au taux de 2,1 %', 210),
  taux('T7', 'Retenue de TVA sur droits d’auteur', undefined),
  taux('13', 'Anciens taux', undefined),
  taux('P1', 'Produits pétroliers – Taux normal 20 %', 2000),
  taux('P2', 'Produits pétroliers – Taux réduit 13 %', 1300),
  taux('I1', 'Importations – Taux normal 20 %', 2000),
  taux('I2', 'Importations – Taux réduit 10 %', 1000),
  taux('I3', 'Importations – Taux réduit 8,5 %', 850),
  taux('I4', 'Importations – Taux réduit 5,5 %', 550),
  taux('I5', 'Importations – Taux réduit 2,1 %', 210),
  taux('I6', 'Importations – Taux réduit 1,05 %', 105),
  un('15', 'TVA antérieurement déduite à reverser', 'tva-brute'),
  un('5B', 'Sommes à ajouter, y compris acompte congés', 'tva-brute'),
  un('16', 'Total de la TVA brute due (lignes 08 à 5B)', 'tva-brute'),
  un('17', 'Dont TVA sur acquisitions intracommunautaires', 'tva-brute', { dont: true }),
  un('18', 'Dont TVA sur opérations à destination de Monaco', 'tva-brute', { dont: true }),
  un('19', 'Biens constituant des immobilisations', 'tva-deductible'),
  un('20', 'Autres biens et services', 'tva-deductible'),
  un('21', 'Autre TVA à déduire', 'tva-deductible'),
  un('22', 'Report du crédit apparaissant ligne 27 de la précédente déclaration', 'tva-deductible'),
  un('2C', 'Sommes à imputer, y compris acompte congés', 'tva-deductible'),
  un('22A', 'Coefficient de taxation unique applicable pour la période s’il est différent de 100 %', 'tva-deductible', { pourcentage: true }),
  un('23', 'Total TVA déductible (lignes 19 à 2C)', 'tva-deductible'),
  un('24', 'Dont TVA déductible sur importations hors produits pétroliers', 'tva-deductible', { dont: true }),
  un('2E', 'Dont TVA déductible sur les produits pétroliers', 'tva-deductible', { dont: true }),
  un('25', 'Crédit de TVA (ligne 23 – ligne 16)', 'solde'),
  un('TD', 'TVA due (ligne 16 – ligne 23)', 'solde'),
  ...(
    [
      ['X1', 'Crédit constaté – accise sur l’électricité'],
      ['X2', 'Crédit constaté – accise sur les gaz naturels'],
      ['X3', 'Crédit constaté – accise sur les charbons'],
      ['XA', 'Crédit constaté – accise sur les autres produits énergétiques'],
      ['X4', 'Total du crédit d’accise imputé sur la TVA'],
      ['Y1', 'Reliquat de crédit à rembourser – accise sur l’électricité'],
      ['Y2', 'Reliquat de crédit à rembourser – accise sur les gaz naturels'],
      ['Y3', 'Reliquat de crédit à rembourser – accise sur les charbons'],
      ['YA', 'Reliquat de crédit à rembourser – accise sur les autres produits énergétiques'],
      ['Y4', 'Total du reliquat de crédit d’accise à rembourser'],
      ['Z1', 'Taxe due – accise sur l’électricité'],
      ['Z2', 'Taxe due – accise sur les gaz naturels'],
      ['Z3', 'Taxe due – accise sur les charbons'],
      ['ZB', 'Taxe due – accise sur le gazole non routier agricole'],
      ['Z4', 'Total de l’accise sur les énergies due'],
      ['M1', 'Majoration de l’accise sur l’électricité – crédit imputé'],
      ['M2', 'Majoration de l’accise sur les gaz naturels – crédit imputé'],
      ['M3', 'Majoration de l’accise sur les charbons – crédit imputé'],
      ['M4', 'Majoration de l’accise sur l’électricité – reliquat à rembourser'],
      ['M5', 'Majoration de l’accise sur les gaz naturels – reliquat à rembourser'],
      ['M6', 'Majoration de l’accise sur les charbons – reliquat à rembourser'],
      ['M7', 'Majoration de l’accise sur l’électricité – taxe due'],
      ['M8', 'Majoration de l’accise sur les gaz naturels – taxe due'],
      ['M9', 'Majoration de l’accise sur les charbons – taxe due'],
    ] as const
  ).map(([code, libelle]) => un(code, libelle, 'accise')),
  un('26', 'Remboursement de crédit de TVA demandé sur formulaire n° 3519', 'determination'),
  un('AA', 'Crédit de TVA transféré à la société tête de groupe sur la déclaration récapitulative 3310-CA3G', 'determination'),
  un('27', 'Crédit de TVA à reporter (ligne 25 – ligne 26)', 'determination'),
  un('Y5', 'Remboursement de reliquat d’accise sur les énergies demandé par les consommateurs', 'determination'),
  un('Y6', 'Remboursement de reliquat d’accise transféré à la société tête de groupe (3310-CA3G)', 'determination'),
  un('X5', 'Crédit d’accise sur les énergies des consommateurs imputé sur la TVA', 'determination'),
  un('28', 'TVA nette due (ligne TD – ligne X5)', 'determination'),
  un('29', 'Taxes assimilées calculées sur l’annexe n° 3310-A', 'determination'),
  un('Z5', 'Total de l’accise sur les énergies dû par les consommateurs', 'determination'),
  un('AB', 'Total à payer acquitté par la société tête de groupe sur la déclaration 3310-CA3G', 'determination'),
  un('32', 'Total à payer (lignes 28 + 29 + Z5 – AB)', 'determination'),
];

export const CASES_PAR_CODE: ReadonlyMap<string, CaseCa3> = new Map(CASES_CA3.map((c) => [c.code, c]));

/**
 * Codes de case possibles en début de ligne (connus ou non) : deux caractères chiffres/majuscules,
 * ou 22A. Sert à repérer une case inconnue d'un nouveau millésime.
 */
export const MOTIF_CODE = /^(?:[0-9A-Z]{2}|22A)$/;

/** Ordre de présentation (récapitulatif, saisie). */
export const ORDRE_CASES: ReadonlyMap<string, number> = new Map(CASES_CA3.map((c, i) => [c.code, i]));
