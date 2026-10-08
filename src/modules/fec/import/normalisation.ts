/**
 * Normalisation d'une ligne de FEC (à plat ou XML) et contrôles de données associés (règles D).
 */
import type { LigneNormalisee } from '../donnees/colonnes.ts';
import type { Constats } from '../conformite/constats.ts';
import type { Regime, Zone } from '../zones.ts';
import { lireDate, lireMontant, lireSens, type Montant } from './valeurs.ts';

export interface ContexteNormalisation {
  regime: Regime;
  xml: boolean;
  /** Zones dont la valeur est obligatoire (D01), présentes dans le fichier. */
  obligatoires: Zone[];
  /** Applique la reconstruction des auxiliaires intégrés au numéro de compte (411DUPONT). */
  reconstruireAuxiliaires: boolean;
  constats: Constats;
}

/** Libellés des comptes collectifs reconstruits (PCG). */
const COLLECTIFS: Record<string, string> = {
  '401': 'Fournisseurs',
  '403': 'Fournisseurs - effets à payer',
  '404': "Fournisseurs d'immobilisations",
  '408': 'Fournisseurs - factures non parvenues',
  '409': 'Fournisseurs débiteurs',
  '411': 'Clients',
  '413': 'Clients - effets à recevoir',
  '416': 'Clients douteux ou litigieux',
  '418': 'Clients - produits non encore facturés',
  '419': 'Clients créditeurs',
};

/** Compte de tiers à auxiliaire intégré : racine numérique 40x/41x suivie de lettres (« 411DUPONT », « 401AE »). */
const TIERS_INTEGRE = /^(4[01]\d*?)([A-Za-z].*)$/;

/** Accès aux valeurs brutes d'une ligne : undefined si la zone est absente du fichier. */
export type Valeurs = (zone: Zone) => string | undefined;

export function normaliserLigne(v: Valeurs, ligne: number, ctx: ContexteNormalisation): LigneNormalisee {
  const k = ctx.constats;
  const texte = (z: Zone) => v(z) ?? '';

  for (const z of ctx.obligatoires) {
    if (v(z) === '') {
      k.ligne('D01', ligne);
      break;
    }
  }
  if (ctx.regime !== 'bic') {
    if (v('JournalCode') === '' || v('JournalLib') === '' || v('CompteNum') === '') k.ligne('D19', ligne);
  }
  if (ctx.regime === 'ba-tresorerie' || ctx.regime === 'bnc-tresorerie') {
    if (v('DateRglt') === '' || v('ModeRglt') === '') k.ligne('D02', ligne);
  }

  // Dates
  const dates: Record<'ecritureDate' | 'pieceDate' | 'validDate' | 'dateLet' | 'dateRglt', number> = {
    ecritureDate: 0,
    pieceDate: 0,
    validDate: 0,
    dateLet: 0,
    dateRglt: 0,
  };
  const zonesDates: [keyof typeof dates, Zone][] = [
    ['ecritureDate', 'EcritureDate'],
    ['pieceDate', 'PieceDate'],
    ['validDate', 'ValidDate'],
    ['dateLet', 'DateLet'],
    ['dateRglt', 'DateRglt'],
  ];
  for (const [cle, zone] of zonesDates) {
    const d = lireDate(texte(zone), ctx.xml);
    dates[cle] = d.valeur;
    if (d.valeur === -1) k.ligne('D03', ligne);
    else if (d.horsFormat) k.ligne('D04', ligne);
    if (d.zeros) k.ligne('D17', ligne);
  }

  // Montants
  const signaler = (m: Montant) => {
    if (m.invalide) k.ligne('D05', ligne);
    if (m.pointDecimal) k.ligne('D06', ligne);
    if (m.milliers) k.ligne('D07', ligne);
    if (m.signe) k.ligne('D08', ligne);
  };
  let debit: number;
  let credit: number;
  const montant = v('Montant');
  if (montant !== undefined && (!ctx.xml || montant !== '' || v('Debit') === undefined)) {
    const m = lireMontant(montant, ctx.xml);
    signaler(m);
    const s = lireSens(texte('Sens'));
    if (!s.conforme && texte('Sens') !== '') k.ligne('D09', ligne);
    if (s.sens === 'C') [debit, credit] = [0, m.centimes];
    else [debit, credit] = [m.centimes, 0];
  } else {
    const d = lireMontant(texte('Debit'), ctx.xml);
    const c = lireMontant(texte('Credit'), ctx.xml);
    signaler(d);
    signaler(c);
    if (!ctx.xml && (d.vide || c.vide)) k.ligne('D18', ligne);
    debit = d.centimes;
    credit = c.centimes;
  }
  if (debit !== 0 && credit !== 0) k.ligne('D11', ligne);
  // Montant négatif : un débit négatif est un crédit (et inversement).
  if (debit < 0) [debit, credit] = [0, credit - debit];
  if (credit < 0) [debit, credit] = [debit - credit, 0];
  if (debit === 0 && credit === 0) k.ligne('D12', ligne);

  // Devise
  const idevise = texte('Idevise');
  const md = lireMontant(texte('Montantdevise'), ctx.xml);
  if (md.invalide) k.ligne('D05', ligne);
  let montantDevise = md.vide || md.invalide ? Number.NaN : md.centimes;
  if (!idevise && !md.vide && md.centimes === 0) {
    k.ligne('D17', ligne);
    montantDevise = Number.NaN;
  } else if (Boolean(idevise) === md.vide) {
    k.ligne('D14', ligne);
  }

  // Comptes et tiers
  let compteNum = texte('CompteNum');
  let compteLib = texte('CompteLib');
  let compAuxNum = texte('CompAuxNum');
  let compAuxLib = texte('CompAuxLib');
  if (compteNum !== '' && !/^\d{3}/.test(compteNum)) k.ligne('D10', ligne);
  if ((compAuxNum === '') !== (compAuxLib === '')) k.ligne('D13', ligne);
  if (compAuxNum === '' && compAuxLib === '') {
    const t = TIERS_INTEGRE.exec(compteNum);
    if (t) {
      k.ligne('D16', ligne);
      if (ctx.reconstruireAuxiliaires) {
        compAuxNum = compteNum;
        compAuxLib = compteLib;
        compteNum = t[1]!;
        compteLib = COLLECTIFS[compteNum.slice(0, 3)] ?? compteLib;
      }
    }
  }

  const ecritureLet = texte('EcritureLet');
  if ((ecritureLet !== '') !== (dates.dateLet !== 0)) k.ligne('D15', ligne);

  return {
    ligneOrigine: ligne,
    journalCode: texte('JournalCode'),
    journalLib: texte('JournalLib'),
    ecritureNum: texte('EcritureNum'),
    compteNum,
    compteLib,
    compAuxNum,
    compAuxLib,
    pieceRef: texte('PieceRef'),
    ecritureLib: texte('EcritureLib'),
    ecritureLet,
    idevise,
    modeRglt: texte('ModeRglt'),
    natOp: texte('NatOp'),
    idClient: texte('IdClient'),
    ...dates,
    debit,
    credit,
    montantDevise,
  };
}
