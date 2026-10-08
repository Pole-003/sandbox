/**
 * Sérialisation des écritures fictives en FEC « à plat » ou XML, avec toutes les variantes de forme
 * (séparateur, encodage, fins de ligne, Montant/Sens, format des montants, en-têtes…).
 */
import type { EcritureFictive, LigneFictive, Regime } from './modele.ts';

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
export const ZONES_TRESORERIE_BA = [...ZONES_BIC, 'DateRglt', 'ModeRglt', 'NatOp'] as const;
export const ZONES_TRESORERIE_BNC = [...ZONES_TRESORERIE_BA, 'IdClient'] as const;
export type Zone = (typeof ZONES_TRESORERIE_BNC)[number] | 'Montant' | 'Sens';

export function zonesDuRegime(regime: Regime): readonly Zone[] {
  if (regime === 'ba-tresorerie') return ZONES_TRESORERIE_BA;
  if (regime === 'bnc-tresorerie') return ZONES_TRESORERIE_BNC;
  return ZONES_BIC;
}

export type Encodage = 'utf-8' | 'utf-8-bom' | 'iso-8859-15' | 'windows-1252';

export interface OptionsPlat {
  regime: Regime;
  separateur: '\t' | '|' | ';';
  finLigne: '\r\n' | '\n' | '\r';
  encodage: Encodage;
  montant: 'debit-credit' | 'montant-sens-dc' | 'montant-sens-pm';
  decimal: ',' | '.';
  /** Séparateur de milliers ('' = aucun, conforme). */
  milliers: '' | ' ' | ' ';
  /** Avoirs exprimés en montants négatifs (signe en tête ou en fin, en alternance). */
  signes: boolean;
  guillemets: boolean;
  /** Renommage des en-têtes (casse, accents, alias). */
  enTetes: Partial<Record<Zone, string>>;
  /** Colonnes ajoutées après les zones réglementaires. */
  colonnesEnPlus: { nom: string; valeur: (e: EcritureFictive, l: LigneFictive) => string }[];
  /** Ordre des zones différent de l'arrêté (indices dans la liste réglementaire). */
  ordre: number[] | null;
  /** Logiciel sans comptes auxiliaires : le tiers est intégré au numéro de compte (411DUPONT). */
  tiersIntegre: ((l: LigneFictive) => string) | null;
}

export const OPTIONS_STANDARD: OptionsPlat = {
  regime: 'bic',
  separateur: '\t',
  finLigne: '\r\n',
  encodage: 'utf-8',
  montant: 'debit-credit',
  decimal: ',',
  milliers: '',
  signes: false,
  guillemets: false,
  enTetes: {},
  colonnesEnPlus: [],
  ordre: null,
  tiersIntegre: null,
};

/** Date ISO → AAAAMMJJ ; une valeur non ISO (piège volontaire) est écrite telle quelle. */
export function dateFec(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.replaceAll('-', '') : iso;
}

/** Centimes → texte selon les options (virgule, point, milliers). */
export function montantTexte(centimes: number, decimal: ',' | '.' = ',', milliers = ''): string {
  const signe = centimes < 0 ? '-' : '';
  const chiffres = Math.abs(centimes).toString().padStart(3, '0');
  let entiers = chiffres.slice(0, -2);
  if (milliers) entiers = entiers.replace(/\B(?=(\d{3})+(?!\d))/g, milliers);
  return `${signe}${entiers}${decimal}${chiffres.slice(-2)}`;
}

let alternanceSigne = 0;

function valeursZones(e: EcritureFictive, l: LigneFictive, o: OptionsPlat): Record<Zone, string> {
  const m = (c: number) => montantTexte(c, o.decimal, o.milliers);
  let debit = l.debit;
  let credit = l.credit;
  let signe = '';
  if (o.signes && e.pieceRef.startsWith('AV')) {
    // Avoir : le montant reste dans la colonne de la facture d'origine, avec un signe négatif.
    if (credit > 0 && debit === 0) {
      debit = -credit;
      credit = 0;
    } else if (debit > 0 && credit === 0) {
      credit = -debit;
      debit = 0;
    }
    signe = alternanceSigne++ % 2 === 0 ? 'tete' : 'fin';
  }
  const signeEnFin = (texte: string) => (signe === 'fin' && texte.startsWith('-') ? `${texte.slice(1)}-` : texte);
  const montantDevise = l.montantDevise === null ? '' : montantTexte(l.montantDevise, o.decimal, o.milliers);
  let compteNum = l.compteNum;
  let compAuxNum = l.compAuxNum;
  let compAuxLib = l.compAuxLib;
  if (o.tiersIntegre && l.compAuxNum) {
    compteNum = o.tiersIntegre(l);
    compAuxNum = '';
    compAuxLib = '';
  }
  const v: Record<Zone, string> = {
    JournalCode: e.journalCode,
    JournalLib: e.journalLib,
    EcritureNum: e.ecritureNum,
    EcritureDate: dateFec(e.ecritureDate),
    CompteNum: compteNum,
    CompteLib: o.tiersIntegre && l.compAuxNum ? l.compAuxLib : l.compteLib,
    CompAuxNum: compAuxNum,
    CompAuxLib: compAuxLib,
    PieceRef: e.pieceRef,
    PieceDate: dateFec(e.pieceDate),
    EcritureLib: l.libelle ?? e.ecritureLib,
    Debit: signeEnFin(m(debit)),
    Credit: signeEnFin(m(credit)),
    EcritureLet: l.ecritureLet,
    DateLet: dateFec(l.dateLet),
    ValidDate: dateFec(e.validDate),
    Montantdevise: montantDevise,
    Idevise: l.idevise,
    DateRglt: dateFec(e.dateRglt ?? ''),
    ModeRglt: e.modeRglt ?? '',
    NatOp: e.natOp ?? '',
    IdClient: e.idClient ?? '',
    Montant: m(l.debit !== 0 ? l.debit : l.credit),
    Sens:
      o.montant === 'montant-sens-pm'
        ? l.debit !== 0 || l.credit === 0
          ? '+1'
          : '-1'
        : l.debit !== 0 || l.credit === 0
          ? 'D'
          : 'C',
  };
  for (const [zone, brut] of Object.entries(l.brut ?? {})) v[zone as Zone] = brut;
  return v;
}

/** Zones dans l'ordre d'écriture du fichier (réglementaire, puis éventuellement permuté). */
export function zonesDuFichier(o: OptionsPlat): Zone[] {
  let zones: Zone[] = [...zonesDuRegime(o.regime)];
  if (o.montant !== 'debit-credit') {
    zones = zones.map((z) => (z === 'Debit' ? 'Montant' : z === 'Credit' ? 'Sens' : z));
  }
  if (o.ordre) zones = o.ordre.map((i) => zones[i]!);
  return zones;
}

function champ(texte: string, o: OptionsPlat): string {
  return o.guillemets ? `"${texte.replaceAll('"', '""')}"` : texte;
}

export function ligneEnTete(o: OptionsPlat): string {
  const noms = [...zonesDuFichier(o).map((z) => o.enTetes[z] ?? z), ...o.colonnesEnPlus.map((c) => c.nom)];
  return noms.map((n) => champ(n, o)).join(o.separateur);
}

/** Lignes de texte d'une écriture (sans fin de ligne). */
export function lignesEcriture(e: EcritureFictive, o: OptionsPlat): string[] {
  const zones = zonesDuFichier(o);
  return e.lignes.map((l) => {
    const v = valeursZones(e, l, o);
    const champs = [...zones.map((z) => v[z]), ...o.colonnesEnPlus.map((c) => c.valeur(e, l))];
    if (l.zonesEnMoins) champs.splice(champs.length - l.zonesEnMoins);
    const texte = champs.map((c) => champ(c, o)).join(o.separateur);
    return l.brutLigne ?? texte;
  });
}

export function texteFec(ecritures: Iterable<EcritureFictive>, o: OptionsPlat): string {
  alternanceSigne = 0;
  const lignes = [ligneEnTete(o)];
  for (const e of ecritures) lignes.push(...lignesEcriture(e, o));
  return lignes.join(o.finLigne) + o.finLigne;
}

// ---- Encodages -----------------------------------------------------------------------------------

/** Caractères propres à ISO-8859-15 (par rapport à ISO-8859-1). */
const ISO_8859_15: Record<string, number> = { '€': 0xa4, Š: 0xa6, š: 0xa8, Ž: 0xb4, ž: 0xb8, Œ: 0xbc, œ: 0xbd, Ÿ: 0xbe };
const REMPLACES_8859_15 = new Set([0xa4, 0xa6, 0xa8, 0xb4, 0xb8, 0xbc, 0xbd, 0xbe]);
/** Plage 0x80–0x9F de Windows-1252. */
const WINDOWS_1252: Record<string, number> = {
  '€': 0x80, '‚': 0x82, ƒ: 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, ˆ: 0x88, '‰': 0x89, Š: 0x8a,
  '‹': 0x8b, Œ: 0x8c, Ž: 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, š: 0x9a, '›': 0x9b, œ: 0x9c, ž: 0x9e, Ÿ: 0x9f,
};

export function encoder(texte: string, encodage: Encodage): Uint8Array {
  if (encodage === 'utf-8') return new TextEncoder().encode(texte);
  if (encodage === 'utf-8-bom') return new TextEncoder().encode(`﻿${texte}`);
  const table = encodage === 'iso-8859-15' ? ISO_8859_15 : WINDOWS_1252;
  const octets = new Uint8Array(texte.length);
  let i = 0;
  for (const caractere of texte) {
    const code = caractere.codePointAt(0)!;
    const special = table[caractere];
    if (special !== undefined) octets[i++] = special;
    else if (code < 0x80 || (code >= 0xa0 && code <= 0xff && !(encodage === 'iso-8859-15' && REMPLACES_8859_15.has(code)))) {
      octets[i++] = code;
    } else {
      throw new Error(`Caractère « ${caractere} » impossible à coder en ${encodage}`);
    }
  }
  return octets.slice(0, i);
}

// ---- XML (schémas formatA47A-I-VII-1, VIII-3, VIII-5, VIII-7) ------------------------------------

export const XSD_DU_REGIME: Record<Regime, string> = {
  bic: 'formatA47A-I-VII-1.xsd',
  'ba-tresorerie': 'formatA47A-I-VIII-5.xsd',
  'bnc-tresorerie': 'formatA47A-I-VIII-7.xsd',
};

function xml(texte: string): string {
  return texte.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function dateXml(iso: string): string {
  return iso;
}

/**
 * FEC XML : écritures regroupées par journal (ordre de première apparition), montants au point décimal,
 * dates AAAA-MM-JJ. Le lettrage est une donnée d'écriture en XML : on reprend le code des lignes lettrées
 * s'il est unique dans l'écriture (limite du format, documentée).
 */
export function texteXml(ecritures: EcritureFictive[], regime: Regime, cloture: string): string {
  const parJournal = new Map<string, EcritureFictive[]>();
  for (const e of ecritures) {
    const liste = parJournal.get(e.journalCode);
    if (liste) liste.push(e);
    else parJournal.set(e.journalCode, [e]);
  }
  const t: string[] = [];
  t.push('<?xml version="1.0" encoding="UTF-8"?>');
  t.push(
    `<comptabilite xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="${XSD_DU_REGIME[regime]}">`,
  );
  t.push('  <exercice>');
  t.push(`    <DateCloture>${dateXml(cloture)}</DateCloture>`);
  for (const [code, liste] of parJournal) {
    t.push('    <journal>');
    t.push(`      <JournalCode>${xml(code)}</JournalCode>`);
    t.push(`      <JournalLib>${xml(liste[0]!.journalLib)}</JournalLib>`);
    for (const e of liste) {
      t.push('      <ecriture>');
      t.push(`        <EcritureNum>${xml(e.ecritureNum)}</EcritureNum>`);
      t.push(`        <EcritureDate>${dateXml(e.ecritureDate)}</EcritureDate>`);
      t.push(`        <EcritureLib>${xml(e.ecritureLib)}</EcritureLib>`);
      t.push(`        <PieceRef>${xml(e.pieceRef)}</PieceRef>`);
      t.push(`        <PieceDate>${dateXml(e.pieceDate)}</PieceDate>`);
      // Un seul code possible par écriture : omis si les lignes portent des codes différents (à-nouveaux).
      const codes = new Set(e.lignes.map((l) => l.ecritureLet).filter(Boolean));
      const lettree = codes.size === 1 ? e.lignes.find((l) => l.ecritureLet) : undefined;
      if (lettree) {
        t.push(`        <EcritureLet>${xml(lettree.ecritureLet)}</EcritureLet>`);
        t.push(`        <DateLet>${dateXml(lettree.dateLet)}</DateLet>`);
      }
      t.push(`        <ValidDate>${dateXml(e.validDate)}</ValidDate>`);
      if (regime !== 'bic') {
        t.push(`        <DateRglt>${dateXml(e.dateRglt ?? '')}</DateRglt>`);
        t.push(`        <ModeRglt>${xml(e.modeRglt ?? '')}</ModeRglt>`);
        if (e.natOp) t.push(`        <NatOp>${xml(e.natOp)}</NatOp>`);
        if (regime === 'bnc-tresorerie' && e.idClient) t.push(`        <IdClient>${xml(e.idClient)}</IdClient>`);
      }
      for (const l of e.lignes) {
        t.push('        <ligne>');
        t.push(`          <CompteNum>${xml(l.compteNum)}</CompteNum>`);
        t.push(`          <CompteLib>${xml(l.compteLib)}</CompteLib>`);
        if (l.compAuxNum) {
          t.push(`          <CompAuxNum>${xml(l.compAuxNum)}</CompAuxNum>`);
          t.push(`          <CompAuxLib>${xml(l.compAuxLib)}</CompAuxLib>`);
        }
        if (l.montantDevise !== null) {
          t.push(`          <Montantdevise>${montantTexte(l.montantDevise, '.')}</Montantdevise>`);
          t.push(`          <Idevise>${xml(l.idevise)}</Idevise>`);
        }
        if (l.credit !== 0) t.push(`          <Credit>${montantTexte(l.credit, '.')}</Credit>`);
        else t.push(`          <Debit>${montantTexte(l.debit, '.')}</Debit>`);
        t.push('        </ligne>');
      }
      t.push('      </ecriture>');
    }
    t.push('    </journal>');
  }
  t.push('  </exercice>');
  t.push('</comptabilite>');
  return t.join('\n') + '\n';
}
