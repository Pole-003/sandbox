/**
 * Catalogue des règles de conformité FEC, validé au point d'arrêt 1 (docs/fec-regles-conformite.md).
 * Source unique des codes, libellés et gravités : le rapport, l'export Excel et la documentation
 * des FEC fictifs s'y réfèrent.
 */

export type Gravite = 'non-conforme' | 'anomalie' | 'information';

export const LIBELLES_GRAVITE: Record<Gravite, string> = {
  'non-conforme': 'Non conforme',
  anomalie: 'Anomalie',
  information: 'Information',
};

export interface Regle {
  code: string;
  libelle: string;
  gravite: Gravite;
  source: string;
  /** Résumé de la méthode de détection, affiché dans le rapport. */
  methode: string;
}

const r = (code: string, gravite: Gravite, libelle: string, source: string, methode: string): Regle => ({
  code,
  libelle,
  gravite,
  source,
  methode,
});

const NC = 'non-conforme';
const AN = 'anomalie';
const IN = 'information';
const TCD = 'Test Compta Demat';
const AUDIT = "Contrôle d'audit complémentaire";

export const REGLES: readonly Regle[] = [
  r('S01', AN, 'Nom de fichier non conforme à {SIREN}FEC{AAAAMMJJ}', 'A47 A-1 IX ; BOFiP § 370', 'Début du nom, SIREN (clé de Luhn) et date de clôture existante ; suffixe toléré.'),
  r('S02', NC, 'Séparateur de zones autre que la tabulation ou « | »', `A47 A-1 VI 1° c ; ${TCD}`, 'Séparateur détecté sur les 50 premières lignes.'),
  r('S03', AN, 'Jeu de caractères non prévu (ni ASCII, ni ISO-8859-15, ni UTF-8)', 'A47 A-1 XII 1°', 'Octets 0x80 à 0x9F propres à Windows-1252.'),
  r('S04', IN, "Marque d'ordre des octets (BOM) UTF-8 en tête de fichier", TCD, 'Octets EF BB BF en tête.'),
  r('S05', NC, 'Première ligne sans nom des zones', 'A47 A-1 VII 4° et VIII 9°', 'Aucun nom de zone reconnu en première ligne.'),
  r('S06', NC, "Zone réglementaire absente de l'en-tête", `A47 A-1 VII et VIII ; ${TCD}`, 'Zones attendues selon le régime, introuvables même après normalisation.'),
  r('S07', IN, 'Nom de zone reconnu malgré une casse, des accents ou une variante officielle', `${TCD} ; XSD ; BOFiP § 160-170`, 'Identique après majuscules et retrait des accents, ou CompteAuxNum / CompteAuxLib.'),
  r('S08', NC, 'Nom de zone reconnu seulement par un alias ou une correspondance manuelle', TCD, 'Table d’alias ou assistant de correspondance.'),
  r('S09', AN, "Ordre des zones différent de l'arrêté", 'A47 A-1 VII 1°', 'Rang des zones réglementaires dans l’en-tête.'),
  r('S10', IN, 'Zones supplémentaires', `A47 A-1 VII 1° ; ${TCD}`, 'Colonnes non reconnues, listées par nom.'),
  r('S11', NC, "Nombre de zones d'une ligne différent de l'en-tête", TCD, 'Comptage par ligne ; les zones manquantes sont lues comme vides.'),
  r('S12', IN, 'Ligne vide', TCD, 'Ligne sans caractère significatif, ignorée.'),
  r('S13', IN, 'Séparateur en fin de ligne', TCD, 'En-tête terminé par un séparateur.'),
  r('S14', AN, 'Zones entre guillemets', 'A47 A-1 XII 3°', 'Guillemets autour des zones, retirés à la lecture.'),
  r('S15', NC, 'Fichier sans écriture', TCD, 'Aucune ligne de données.'),
  r('S16', NC, 'XML non conforme au schéma officiel', `A47 A-1 VI 2° ; ${TCD}`, 'Éléments obligatoires, ordre et nombre de lignes par écriture selon le schéma déclaré.'),
  r('D01', NC, 'Zone obligatoire non renseignée', `${TCD} ; A47 A-1 VII 1° ; BOFiP § 180-190`, 'Zones obligatoires du régime vides.'),
  r('D02', AN, 'DateRglt ou ModeRglt non renseigné (trésorerie)', 'A47 A-1 VIII 5° et 7°', 'Zone vide dans un FEC de trésorerie.'),
  r('D03', NC, 'Date inexistante ou illisible', `A47 A-1 XII 4° ; ${TCD}`, 'Format non reconnu ou date inexistante (31 février, mois 13).'),
  r('D04', AN, 'Date valide mais pas au format AAAAMMJJ', 'A47 A-1 XII 4°', 'Séparateurs, ordre JJ/MM/AAAA ou heure accolée.'),
  r('D05', NC, 'Montant non numérique', TCD, 'Valeur non convertible, comptée pour zéro.'),
  r('D06', NC, 'Montant au point décimal', `A47 A-1 XII 2° ; ${TCD}`, 'Point séparateur décimal (fichier à plat) ; valeur convertie.'),
  r('D07', NC, 'Montant avec séparateur de milliers', `A47 A-1 XII 2° ; ${TCD}`, 'Espace ou point de groupement ; valeur convertie.'),
  r('D08', IN, 'Montant signé', 'A47 A-1 XII 2°', 'Signe en tête ou en fin ; un débit négatif devient un crédit positif.'),
  r('D09', NC, 'Sens hors D, C, +1, -1', `A47 A-1 X ; BOFiP § 230 ; ${TCD}`, 'Valeur de Sens non admise (« + 1 » avec espace : interprété).'),
  r('D10', AN, 'CompteNum ne commençant pas par trois chiffres', `A47 A-1 VII 1° ; ${TCD}`, 'Trois premiers caractères non numériques.'),
  r('D11', AN, 'Débit et crédit non nuls sur la même ligne', TCD, 'Debit ≠ 0 et Credit ≠ 0.'),
  r('D12', IN, 'Ligne à débit et crédit nuls', TCD, 'Debit = Credit = 0.'),
  r('D13', AN, 'CompAuxNum sans CompAuxLib, ou l’inverse', AUDIT, 'Une zone du couple vide, l’autre renseignée.'),
  r('D14', AN, 'Montantdevise sans Idevise, ou l’inverse', `${AUDIT} ; BOFiP § 260-270`, 'Une zone du couple vide, l’autre renseignée.'),
  r('D15', AN, 'EcritureLet sans DateLet, ou l’inverse', AUDIT, 'Une zone du couple vide, l’autre renseignée.'),
  r('D16', IN, 'Tiers intégré au numéro de compte (auxiliaire reconstruit)', AUDIT, 'Comptes 40/41 de forme 4xx + lettres sans CompAuxNum.'),
  r('D17', IN, 'Zone facultative remplie de zéros ou d’espaces au lieu d’être vide', 'BOFiP § 70', 'Montantdevise nul sans devise, date 00000000, espaces seuls.'),
  r('D18', AN, 'Debit ou Credit vide au lieu de 0', 'BOFiP § 210', 'Zone Debit ou Credit vide.'),
  r('D19', AN, 'JournalCode, JournalLib ou CompteNum vide (BNC/BA)', 'A47 A-1 VIII ; BOFiP § 70 et 130', 'Zone « à blanc si non utilisé » vide.'),
  r('L01', AN, 'Libellés différents pour un même CompteNum', AUDIT, 'Lignes dont le libellé diffère du libellé majoritaire du compte.'),
  r('L02', AN, 'Libellés différents pour un même JournalCode', AUDIT, 'Lignes dont le libellé diffère du libellé majoritaire du journal.'),
  r('L03', AN, 'Libellés différents pour un même CompAuxNum', AUDIT, 'Lignes dont le libellé diffère du libellé majoritaire de l’auxiliaire.'),
  r('L04', IN, 'Même CompAuxNum rattaché à plusieurs CompteNum', AUDIT, 'Auxiliaire présent sous plusieurs comptes généraux.'),
  r('E01', NC, 'Écriture déséquilibrée', AUDIT, 'Σ débit ≠ Σ crédit par JournalCode + EcritureNum.'),
  r('E02', NC, 'Déséquilibre global', AUDIT, 'Σ débit ≠ Σ crédit sur le fichier.'),
  r('E03', AN, "Déséquilibre d'un journal", AUDIT, 'Par JournalCode.'),
  r('E04', AN, "Déséquilibre d'un mois", AUDIT, "Par mois d'EcritureDate."),
  r('E05', AN, "Écriture d'une seule ligne", `${TCD} (XSD)`, 'Une seule ligne pour JournalCode + EcritureNum.'),
  r('E06', AN, 'Dates différentes au sein d’une même écriture', TCD, 'EcritureDate ou ValidDate non unique dans l’écriture.'),
  r('E07', AN, 'EcritureDate hors exercice', 'A47 A-1 VII 1°', 'Avant le début ou après la clôture.'),
  r('E08', AN, 'ValidDate antérieure à EcritureDate', AUDIT, 'Comparaison des dates.'),
  r('E09', IN, 'ValidDate postérieure à la clôture', AUDIT, 'Écritures validées après la date de clôture.'),
  r('E10', AN, 'Trou dans la numérotation', 'A47 A-1 VII 1°', 'Numéros manquants dans la séquence (globale ou par journal).'),
  r('E11', AN, "Numéro d'écriture en double", 'A47 A-1 VII 1° ; BOFiP § 100', 'Même numéro pour deux écritures d’une même séquence.'),
  r('E12', IN, 'Écritures non classées par ordre chronologique de validation', 'A47 A-1 VII 1°', 'ValidDate décroissante d’une ligne à la suivante.'),
  r('E13', AN, 'À-nouveaux absents', 'A47 A-1 VII 1° et 3°', 'Aucun journal d’à-nouveaux détecté (premier exercice : à ignorer).'),
  r('E14', IN, "À-nouveaux ne portant pas les premiers numéros d'écriture", 'A47 A-1 VII 3° ; BOFiP § 110', 'Numérotation globale seulement.'),
  r('E15', AN, 'À-nouveaux sur des comptes de gestion (classes 6 et 7)', AUDIT, 'Lignes d’à-nouveaux en classe 6 ou 7.'),
  r('E16', AN, 'Écritures de solde des comptes de charges et de produits', 'A47 A-1 VII 1°', 'Écriture de clôture soldant des comptes 6/7 contre un compte 12.'),
  r('E17', AN, 'Numérotation non chronologique (inversion)', 'BOFiP § 40 et 100', 'Numéro supérieur daté avant un numéro inférieur de la même séquence.'),
];

export const REGLES_PAR_CODE: ReadonlyMap<string, Regle> = new Map(REGLES.map((x) => [x.code, x]));

export function regle(code: string): Regle {
  const x = REGLES_PAR_CODE.get(code);
  if (!x) throw new Error(`Règle inconnue : ${code}`);
  return x;
}

export const MENTION_RAPPORT = 'Contrôle indicatif. Seul l’outil officiel Test Compta Demat de la DGFiP fait foi.';
export const LIEN_TEST_COMPTA_DEMAT = 'https://www.economie.gouv.fr/dgfip/outil-test-des-fichiers-des-ecritures-comptables-fec';
