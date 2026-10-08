/**
 * Zones du FEC (article A47 A-1 du LPF, VII et VIII) et reconnaissance des noms de colonnes.
 */

export const ZONES_BIC = [
  'JournalCode',
  'JournalLib',
  'EcritureNum',
  'EcritureDate',
  'CompteNum',
  'CompteLib',
  'CompAuxNum',
  'CompAuxLib',
  'PieceRef',
  'PieceDate',
  'EcritureLib',
  'Debit',
  'Credit',
  'EcritureLet',
  'DateLet',
  'ValidDate',
  'Montantdevise',
  'Idevise',
] as const;

export const ZONES_TRESORERIE = ['DateRglt', 'ModeRglt', 'NatOp', 'IdClient'] as const;

export type Zone = (typeof ZONES_BIC)[number] | (typeof ZONES_TRESORERIE)[number] | 'Montant' | 'Sens';

export const TOUTES_ZONES: readonly Zone[] = [...ZONES_BIC, ...ZONES_TRESORERIE, 'Montant', 'Sens'];

/**
 * - bic : BIC/IS (VII 1°) ;
 * - bnc-ba-commercial : BNC/BA tenus selon le droit commercial (VIII 3°), mêmes zones, certaines « à blanc » ;
 * - ba-tresorerie (VIII 5°, 21 zones) ; bnc-tresorerie (VIII 7°, 22 zones).
 */
export type Regime = 'bic' | 'bnc-ba-commercial' | 'ba-tresorerie' | 'bnc-tresorerie';

export const LIBELLES_REGIME: Record<Regime, string> = {
  bic: 'BIC / IS',
  'bnc-ba-commercial': 'BNC / BA en droit commercial',
  'ba-tresorerie': 'BA de trésorerie',
  'bnc-tresorerie': 'BNC de trésorerie',
};

export type PresentationMontants = 'debit-credit' | 'montant-sens';

/** Zones réglementaires dans l'ordre de l'arrêté. */
export function zonesReglementaires(regime: Regime, presentation: PresentationMontants): Zone[] {
  const base: Zone[] = ZONES_BIC.map((z) =>
    presentation === 'montant-sens' && z === 'Debit' ? 'Montant' : presentation === 'montant-sens' && z === 'Credit' ? 'Sens' : z,
  );
  if (regime === 'ba-tresorerie') return [...base, 'DateRglt', 'ModeRglt', 'NatOp'];
  if (regime === 'bnc-tresorerie') return [...base, 'DateRglt', 'ModeRglt', 'NatOp', 'IdClient'];
  return base;
}

/** Zones dont la valeur est obligatoire (D01). En BNC/BA, JournalCode, JournalLib et CompteNum relèvent de D19. */
export function zonesObligatoires(regime: Regime, presentation: PresentationMontants): Zone[] {
  const toutes: Zone[] = [
    'JournalCode',
    'JournalLib',
    'EcritureNum',
    'EcritureDate',
    'CompteNum',
    'CompteLib',
    'PieceRef',
    'PieceDate',
    'EcritureLib',
    'ValidDate',
    ...(presentation === 'montant-sens' ? (['Montant', 'Sens'] as Zone[]) : []),
  ];
  if (regime === 'bic') return toutes;
  return toutes.filter((z) => z !== 'JournalCode' && z !== 'JournalLib' && z !== 'CompteNum');
}

/** Majuscules sans accents ni blancs en bordure (tolérance de Test Compta Demat). */
export function normaliserCasse(nom: string): string {
  return nom
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();
}

/** Clé d'alias : uniquement lettres et chiffres. */
export function cleAlias(nom: string): string {
  return normaliserCasse(nom).replace(/[^A-Z0-9]/g, '');
}

/** Variantes officielles (schémas XSD, BOFiP) : tolérées sans non-conformité. */
const VARIANTES_OFFICIELLES: Record<string, Zone> = {
  COMPTEAUXNUM: 'CompAuxNum',
  COMPTEAUXLIB: 'CompAuxLib',
};

/** Alias rencontrés dans les exports des logiciels comptables. */
const ALIAS: Record<string, Zone> = {
  CODEJOURNAL: 'JournalCode',
  JOURNAL: 'JournalCode',
  LIBELLEJOURNAL: 'JournalLib',
  NUMEROECRITURE: 'EcritureNum',
  NUMECRITURE: 'EcritureNum',
  NOECRITURE: 'EcritureNum',
  DATEECRITURE: 'EcritureDate',
  DATECOMPTABLE: 'EcritureDate',
  NUMEROCOMPTE: 'CompteNum',
  NUMCOMPTE: 'CompteNum',
  COMPTE: 'CompteNum',
  COMPTEGENERAL: 'CompteNum',
  LIBELLECOMPTE: 'CompteLib',
  INTITULECOMPTE: 'CompteLib',
  COMPTEAUXILIAIRE: 'CompAuxNum',
  NUMCOMPTEAUX: 'CompAuxNum',
  NUMEROCOMPTEAUXILIAIRE: 'CompAuxNum',
  COMPAUXILIAIRE: 'CompAuxNum',
  LIBELLECOMPTEAUXILIAIRE: 'CompAuxLib',
  LIBELLEAUXILIAIRE: 'CompAuxLib',
  INTITULEAUXILIAIRE: 'CompAuxLib',
  REFPIECE: 'PieceRef',
  REFERENCEPIECE: 'PieceRef',
  NUMPIECE: 'PieceRef',
  NUMEROPIECE: 'PieceRef',
  PIECE: 'PieceRef',
  DATEPIECE: 'PieceDate',
  LIBELLE: 'EcritureLib',
  LIBELLEECRITURE: 'EcritureLib',
  MONTANTDEBIT: 'Debit',
  MONTANTCREDIT: 'Credit',
  LETTRAGE: 'EcritureLet',
  CODELETTRAGE: 'EcritureLet',
  DATELETTRAGE: 'DateLet',
  DATEVALIDATION: 'ValidDate',
  DATEVALID: 'ValidDate',
  MONTANTENDEVISE: 'Montantdevise',
  DEVISE: 'Idevise',
  CODEDEVISE: 'Idevise',
  DATEREGLEMENT: 'DateRglt',
  MODEREGLEMENT: 'ModeRglt',
  NATUREOPERATION: 'NatOp',
  IDENTIFIANTCLIENT: 'IdClient',
  IDENTIFICATIONCLIENT: 'IdClient',
};

export type Reconnaissance = 'exacte' | 'casse' | 'variante-officielle' | 'alias' | 'manuelle';

/** Reconnaît une colonne d'en-tête ; null si inconnue (zone supplémentaire). */
export function reconnaitreZone(nom: string): { zone: Zone; reconnaissance: Reconnaissance } | null {
  const brut = nom.trim();
  const exacte = TOUTES_ZONES.find((z) => z === brut);
  if (exacte) return { zone: exacte, reconnaissance: 'exacte' };
  const casse = normaliserCasse(brut);
  const parCasse = TOUTES_ZONES.find((z) => z.toUpperCase() === casse);
  if (parCasse) return { zone: parCasse, reconnaissance: 'casse' };
  const officielle = VARIANTES_OFFICIELLES[casse];
  if (officielle) return { zone: officielle, reconnaissance: 'variante-officielle' };
  const cle = cleAlias(brut);
  const parCle = TOUTES_ZONES.find((z) => z.toUpperCase() === cle) ?? VARIANTES_OFFICIELLES[cle] ?? ALIAS[cle];
  if (parCle) return { zone: parCle, reconnaissance: 'alias' };
  return null;
}
