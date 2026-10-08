/**
 * Génère le jeu de FEC entièrement fictifs de tests/fixtures/fec/ (CLAUDE.md, règle n° 4).
 *
 *   npm run fec:fictifs            → propre, variantes, piégés, attendus.json et README.md (commités)
 *   npm run fec:gros [-- lignes]   → gros FEC de performance (2 000 000 lignes par défaut), NON commité
 *
 * La génération est déterministe (graines fixes) : relancer le script produit des fichiers identiques
 * octet pour octet, ce que vérifie tests/fixtures/fec-fictifs.test.ts.
 */
import { closeSync, mkdirSync, openSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  encoder,
  ligneEnTete,
  lignesEcriture,
  OPTIONS_STANDARD,
  texteFec,
  texteXml,
  type OptionsPlat,
  type Zone,
} from './fec-fictifs/ecriture-fichier.ts';
import type { EcritureFictive, LigneFictive, Regime, Societe } from './fec-fictifs/modele.ts';
import { simulerNegoce, type ParamsNegoce } from './fec-fictifs/negoce.ts';
import { fabriqueCodesTiers } from './fec-fictifs/noms.ts';
import { construirePieges, type ConstatAttendu } from './fec-fictifs/pieges.ts';
import { genererTresorerie } from './fec-fictifs/tresorerie.ts';
import { totaliser, type Totaux } from './fec-fictifs/totaux.ts';

export const SOCIETES = {
  negoce: {
    siren: '000123455',
    raisonSociale: 'Négoce Fictif du Littoral SAS',
    regime: 'bic',
    debut: '2025-07-01',
    cloture: '2026-06-30',
  },
  petit: {
    siren: '000987651',
    raisonSociale: 'Petit Comptoir Fictif SARL',
    regime: 'bic',
    debut: '2025-01-01',
    cloture: '2025-12-31',
  },
  bnc: {
    siren: '000555011',
    raisonSociale: "Atelier d'architecture Fictif",
    regime: 'bnc-tresorerie',
    debut: '2025-01-01',
    cloture: '2025-12-31',
  },
  ba: {
    siren: '000555029',
    raisonSociale: 'EARL des Champs Fictifs',
    regime: 'ba-tresorerie',
    debut: '2025-01-01',
    cloture: '2025-12-31',
  },
  gros: {
    siren: '000444034',
    raisonSociale: 'Grande Distribution Fictive SA',
    regime: 'bic',
    debut: '2025-01-01',
    cloture: '2025-12-31',
  },
} as const satisfies Record<string, Societe>;

export const PARAMS_PROPRE: ParamsNegoce = {
  societe: SOCIETES.negoce,
  graine: 20260630,
  nbClients: 150,
  nbFournisseurs: 80,
  ventesParJour: 12,
  achatsParJour: 4.6,
  clientsCrediteurs: 3,
  fournisseursDebiteurs: 3,
  pistes: true,
  validationApresCloture: true,
  libellesParLigne: true,
  devise: true,
  echelle: 1,
};

export const PARAMS_PETIT: ParamsNegoce = {
  societe: SOCIETES.petit,
  graine: 20251231,
  nbClients: 10,
  nbFournisseurs: 6,
  ventesParJour: 0.25,
  achatsParJour: 0.1,
  clientsCrediteurs: 1,
  fournisseursDebiteurs: 2,
  pistes: false,
  validationApresCloture: false,
  libellesParLigne: false,
  devise: true,
  echelle: 0.08,
};

export interface FichierAttendu {
  fichier: string;
  categorie: 'propre' | 'variante' | 'piege';
  description: string;
  format: 'plat' | 'xml';
  regime: Regime;
  encodage: string;
  separateur: string | null;
  finLigne: string | null;
  presentationMontants: 'debit-credit' | 'montant-sens-dc' | 'montant-sens-pm';
  /** Jeu de données de référence (mêmes écritures, à la forme près). */
  reference: 'propre' | 'petit' | 'bnc' | 'ba';
  siren: string;
  debut: string;
  cloture: string;
  journalAN: string | null;
  nbLignes: number;
  nbEcritures: number;
  constats: ConstatAttendu[];
}

export interface Attendus {
  $commentaire: string;
  fichiers: FichierAttendu[];
  totaux: Record<'propre' | 'petit' | 'bnc' | 'ba', Totaux>;
  /** Pistes d'audit volontaires du FEC propre : type → numéros d'écriture. */
  pistes: Record<string, string[]>;
  /** Faits notables du FEC propre, calculés à partir des totaux. */
  faits: {
    clientsCrediteurs: string[];
    fournisseursDebiteurs: string[];
    fournisseurVolumeSoldeNul: { tiers: string; achats: number };
    banqueClotureeEnCours: string;
  };
}

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const DOSSIER = join(RACINE, 'tests/fixtures/fec');

const nomFec = (s: Societe, suffixe = '') => `${s.siren}FEC${s.cloture.replaceAll('-', '')}${suffixe}`;

function ecrire(chemin: string, contenu: Uint8Array | string): void {
  mkdirSync(join(chemin, '..'), { recursive: true });
  writeFileSync(chemin, contenu);
}

/** Lignes du fichier portant un montant qui satisfait le prédicat (en-tête = ligne 1). */
function lignesOu(ecritures: EcritureFictive[], predicat: (montants: number[], e: EcritureFictive) => boolean): number[] {
  const resultat: number[] = [];
  let n = 1;
  for (const e of ecritures) {
    for (const l of e.lignes) {
      n++;
      if (predicat([l.debit, l.credit, ...(l.montantDevise === null ? [] : [l.montantDevise])], e)) resultat.push(n);
    }
  }
  return resultat;
}

const parLignes = (code: string, lignes: number[]): ConstatAttendu => ({ code, lignes, occurrences: lignes.length });
const global = (code: string, occurrences = 1): ConstatAttendu => ({ code, lignes: [], occurrences });

interface Variante {
  nom: string;
  description: string;
  options: Partial<OptionsPlat>;
  constats: (ecritures: EcritureFictive[]) => ConstatAttendu[];
}

const ENTETES_CASSE: Partial<Record<Zone, string>> = {
  JournalCode: 'journalcode',
  EcritureDate: 'ÉcritureDate',
  CompteNum: 'COMPTENUM',
  PieceRef: 'PièceRef',
  EcritureLib: 'Écriturelib',
  Montantdevise: 'MontantDevise',
  Idevise: 'IDevise',
};

const VARIANTES: Variante[] = [
  {
    nom: 'pipe',
    description: 'Séparateur « | » (conforme).',
    options: { separateur: '|' },
    constats: () => [],
  },
  {
    nom: 'montant-sens-dc',
    description: 'Zones Montant et Sens (D/C) à la place de Debit et Credit (A47 A-1 VII 2°, conforme).',
    options: { montant: 'montant-sens-dc' },
    constats: () => [],
  },
  {
    nom: 'montant-sens-pm',
    description: 'Zones Montant et Sens (+1/-1) à la place de Debit et Credit (conforme).',
    options: { montant: 'montant-sens-pm' },
    constats: () => [],
  },
  {
    nom: 'utf8-bom',
    description: 'UTF-8 avec marque d\'ordre des octets (BOM) en tête.',
    options: { encodage: 'utf-8-bom' },
    constats: () => [global('S04')],
  },
  {
    nom: 'iso-8859-15',
    description: 'Encodage ISO-8859-15 (conforme ; « € » codé 0xA4, « œ » 0xBD).',
    options: { encodage: 'iso-8859-15' },
    constats: () => [],
  },
  {
    nom: 'windows-1252',
    description: 'Encodage Windows-1252 (non prévu par l\'article A47 A-1 XII ; « € » codé 0x80, « œ » 0x9C).',
    options: { encodage: 'windows-1252' },
    constats: () => [global('S03')],
  },
  {
    nom: 'excel-point-virgule',
    description: 'Export Excel : séparateur « ; », toutes les zones entre guillemets, Windows-1252, fins de ligne CRLF.',
    options: { separateur: ';', guillemets: true, encodage: 'windows-1252' },
    constats: () => [global('S02'), global('S03'), global('S14')],
  },
  {
    nom: 'point-decimal',
    description: 'Montants au point décimal (« 1234.56 ») au lieu de la virgule.',
    options: { decimal: '.' },
    constats: (e) => [parLignes('D06', lignesOu(e, () => true))],
  },
  {
    nom: 'milliers',
    description: 'Montants avec séparateur de milliers (espace insécable : « 1 234,56 »).',
    options: { milliers: ' ' },
    constats: (e) => [parLignes('D07', lignesOu(e, (m) => m.some((x) => Math.abs(x) >= 100_000)))],
  },
  {
    nom: 'montants-signes',
    description: 'Avoirs saisis en montants négatifs dans la colonne d\'origine, signe en tête (« -12,00 ») ou en fin (« 12,00- ») en alternance (autorisé par A47 A-1 XII 2°).',
    options: { signes: true },
    constats: (e) => [parLignes('D08', lignesOu(e, (_, ec) => ec.pieceRef.startsWith('AV')))],
  },
  {
    nom: 'colonnes-casse-accents',
    description: `En-têtes en casse et accents différents : ${Object.values(ENTETES_CASSE).join(', ')}.`,
    options: { enTetes: ENTETES_CASSE },
    constats: () => [{ code: 'S07', lignes: [1], occurrences: Object.keys(ENTETES_CASSE).length }],
  },
  {
    nom: 'colonnes-en-trop',
    description: 'Deux zones supplémentaires après les 18 zones réglementaires : CodeAnalytique et Utilisateur (autorisé).',
    options: {
      colonnesEnPlus: [
        { nom: 'CodeAnalytique', valeur: (_, l) => (l.compteNum.startsWith('6') || l.compteNum.startsWith('7') ? 'NEGOCE' : '') },
        { nom: 'Utilisateur', valeur: (e) => (e.journalCode === 'OD' ? 'COMPTA' : 'AUTO') },
      ],
    },
    constats: () => [{ code: 'S10', lignes: [1], occurrences: 2 }],
  },
  {
    nom: 'colonnes-ordre',
    description: 'Zones dans un ordre différent de l\'arrêté (CompteNum et CompteLib en tête, Debit et Credit inversés).',
    options: { ordre: [4, 5, 0, 1, 2, 3, 6, 7, 8, 9, 10, 12, 11, 13, 14, 15, 16, 17] },
    constats: () => [{ code: 'S09', lignes: [1], occurrences: 1 }],
  },
  {
    nom: 'tiers-integre',
    description: 'Logiciel sans comptes auxiliaires : tiers intégré au numéro de compte (« 411ELITTORAL »), CompAuxNum et CompAuxLib vides, CompteLib = nom du tiers.',
    options: {
      tiersIntegre: (() => {
        const codeDuNom = fabriqueCodesTiers();
        const codes = new Map<string, string>();
        return (l: LigneFictive) => {
          let code = codes.get(l.compAuxNum);
          if (!code) codes.set(l.compAuxNum, (code = codeDuNom(l.compAuxLib)));
          return `${l.compteNum.slice(0, 3)}${code}`;
        };
      })(),
    },
    constats: (e) => [parLignes('D16', lignesTiers(e))],
  },
  {
    nom: 'fin-ligne-lf',
    description: 'Fins de ligne LF (Unix).',
    options: { finLigne: '\n' },
    constats: () => [],
  },
  {
    nom: 'fin-ligne-cr',
    description: 'Fins de ligne CR seul (anciens Mac).',
    options: { finLigne: '\r' },
    constats: () => [],
  },
];

function lignesTiers(ecritures: EcritureFictive[]): number[] {
  const r: number[] = [];
  let n = 1;
  for (const e of ecritures) for (const l of e.lignes) (n++, l.compAuxNum && r.push(n));
  return r;
}

function compterLignes(ecritures: EcritureFictive[]): number {
  return ecritures.reduce((s, e) => s + e.lignes.filter((l) => l.brutLigne !== '').length, 0);
}

function attendu(
  fichier: string,
  base: Omit<FichierAttendu, 'fichier' | 'nbLignes' | 'nbEcritures' | 'siren' | 'debut' | 'cloture'>,
  societe: Societe,
  ecritures: EcritureFictive[],
): FichierAttendu {
  const cles = new Set(ecritures.map((e) => `${e.journalCode}\u0000${e.ecritureNum}`));
  return {
    fichier,
    ...base,
    siren: societe.siren,
    debut: societe.debut,
    cloture: societe.cloture,
    nbLignes: compterLignes(ecritures),
    nbEcritures: cles.size,
  };
}

export function genererJeu(dossier = DOSSIER): Attendus {
  rmSync(join(dossier, 'propre'), { recursive: true, force: true });
  rmSync(join(dossier, 'variantes'), { recursive: true, force: true });
  rmSync(join(dossier, 'pieges'), { recursive: true, force: true });
  const fichiers: FichierAttendu[] = [];
  const communs = { encodage: 'utf-8', separateur: 'tabulation', finLigne: 'CRLF', presentationMontants: 'debit-credit' as const };

  // ---- FEC propre ---------------------------------------------------------------------------------
  const propre = [...simulerNegoce(PARAMS_PROPRE)];
  const nomPropre = `propre/${nomFec(SOCIETES.negoce)}.txt`;
  ecrire(join(dossier, nomPropre), encoder(texteFec(propre, OPTIONS_STANDARD), 'utf-8'));
  fichiers.push(
    attendu(
      nomPropre,
      {
        categorie: 'propre',
        description:
          "PME de négoce, exercice décalé du 01/07/2025 au 30/06/2026. Journaux AN, VT, AC, BQ1, BQ2, OD ; 150 clients et 80 fournisseurs avec auxiliaires ; 3 banques dont Banque Gamma (512300) clôturée en cours d'exercice ; emprunt ; lettrage partiel ; clients créditeurs, fournisseurs débiteurs ; un fournisseur à fort volume et solde nul ; un fournisseur en USD. Écritures d'inventaire validées après la clôture.",
        format: 'plat',
        regime: 'bic',
        ...communs,
        reference: 'propre',
        journalAN: 'AN',
        constats: [
          parLignes(
            'E09',
            lignesOu(propre, (_, e) => e.piste === 'validee-apres-cloture'),
          ),
        ],
      },
      SOCIETES.negoce,
      propre,
    ),
  );

  // ---- Petit FEC de référence et ses variantes -----------------------------------------------------
  const petit = [...simulerNegoce(PARAMS_PETIT)];
  const textePetit = texteFec(petit, OPTIONS_STANDARD);
  if (!textePetit.includes('€') || !textePetit.includes('œ')) {
    throw new Error('Le petit FEC doit contenir « € » et « œ » pour tester les encodages.');
  }
  const nomPetit = `variantes/${nomFec(SOCIETES.petit)}_standard.txt`;
  ecrire(join(dossier, nomPetit), encoder(textePetit, 'utf-8'));
  fichiers.push(
    attendu(
      nomPetit,
      {
        categorie: 'variante',
        description:
          'Petit FEC de référence (exercice civil 2025) : tabulation, UTF-8 sans BOM, CRLF, Debit/Credit, virgule décimale. Toutes les variantes ci-dessous contiennent les mêmes écritures.',
        format: 'plat',
        regime: 'bic',
        ...communs,
        reference: 'petit',
        journalAN: 'AN',
        constats: [],
      },
      SOCIETES.petit,
      petit,
    ),
  );

  for (const v of VARIANTES) {
    const options: OptionsPlat = { ...OPTIONS_STANDARD, ...v.options };
    const nom = `variantes/${nomFec(SOCIETES.petit)}_${v.nom}.txt`;
    ecrire(join(dossier, nom), encoder(texteFec(petit, options), options.encodage));
    fichiers.push(
      attendu(
        nom,
        {
          categorie: 'variante',
          description: v.description,
          format: 'plat',
          regime: 'bic',
          encodage: options.encodage,
          separateur: { '\t': 'tabulation', '|': 'pipe', ';': 'point-virgule' }[options.separateur],
          finLigne: { '\r\n': 'CRLF', '\n': 'LF', '\r': 'CR' }[options.finLigne],
          presentationMontants: options.montant,
          reference: 'petit',
          journalAN: 'AN',
          constats: v.constats(petit),
        },
        SOCIETES.petit,
        petit,
      ),
    );
  }

  const nomXml = `variantes/${nomFec(SOCIETES.petit)}_xml.xml`;
  ecrire(join(dossier, nomXml), texteXml(petit, 'bic', SOCIETES.petit.cloture));
  fichiers.push(
    attendu(
      nomXml,
      {
        categorie: 'variante',
        description:
          'XML conforme au schéma formatA47A-I-VII-1.xsd (BIC/IS) : écritures regroupées par journal, dates AAAA-MM-JJ, montants au point décimal, une seule zone Debit ou Credit par ligne. Le lettrage est une donnée d\'écriture en XML : seul le premier code de lettrage de chaque écriture est repris.',
        format: 'xml',
        regime: 'bic',
        encodage: 'utf-8',
        separateur: null,
        finLigne: 'LF',
        presentationMontants: 'debit-credit',
        reference: 'petit',
        journalAN: 'AN',
        constats: [],
      },
      SOCIETES.petit,
      petit,
    ),
  );

  // ---- Comptabilités de trésorerie BNC et BA -------------------------------------------------------
  const bnc = genererTresorerie(SOCIETES.bnc, 555011);
  const ba = genererTresorerie(SOCIETES.ba, 555029);
  for (const [cle, societe, ecritures] of [
    ['bnc', SOCIETES.bnc, bnc],
    ['ba', SOCIETES.ba, ba],
  ] as const) {
    const regime = societe.regime;
    const zones = regime === 'bnc-tresorerie' ? '22 zones (18 + DateRglt, ModeRglt, NatOp, IdClient), A47 A-1 VIII 7°' : '21 zones (18 + DateRglt, ModeRglt, NatOp), A47 A-1 VIII 5°';
    const nom = `variantes/${nomFec(societe)}_${cle}-tresorerie.txt`;
    ecrire(join(dossier, nom), encoder(texteFec(ecritures, { ...OPTIONS_STANDARD, regime }), 'utf-8'));
    fichiers.push(
      attendu(
        nom,
        {
          categorie: 'variante',
          description: `${societe.raisonSociale} : comptabilité de trésorerie ${cle.toUpperCase()}, ${zones}.`,
          format: 'plat',
          regime,
          ...communs,
          reference: cle,
          journalAN: 'AN',
          constats: [],
        },
        societe,
        ecritures,
      ),
    );
  }
  const nomXmlBnc = `variantes/${nomFec(SOCIETES.bnc)}_bnc-tresorerie-xml.xml`;
  ecrire(join(dossier, nomXmlBnc), texteXml(bnc, 'bnc-tresorerie', SOCIETES.bnc.cloture));
  fichiers.push(
    attendu(
      nomXmlBnc,
      {
        categorie: 'variante',
        description: 'Comptabilité de trésorerie BNC en XML, schéma formatA47A-I-VIII-7.xsd.',
        format: 'xml',
        regime: 'bnc-tresorerie',
        encodage: 'utf-8',
        separateur: null,
        finLigne: 'LF',
        presentationMontants: 'debit-credit',
        reference: 'bnc',
        journalAN: 'AN',
        constats: [],
      },
      SOCIETES.bnc,
      bnc,
    ),
  );

  // ---- FEC piégés ----------------------------------------------------------------------------------
  for (const piege of construirePieges(petit, SOCIETES.petit.debut, SOCIETES.petit.cloture)) {
    const options: OptionsPlat = { ...OPTIONS_STANDARD, montant: piege.montantSens ?? 'debit-credit' };
    const nom = `pieges/${nomFec(SOCIETES.petit)}_piege-${piege.nom}.txt`;
    ecrire(join(dossier, nom), encoder(texteFec(piege.ecritures, options), 'utf-8'));
    fichiers.push(
      attendu(
        nom,
        {
          categorie: 'piege',
          description: piege.description,
          format: 'plat',
          regime: 'bic',
          ...communs,
          presentationMontants: options.montant,
          reference: 'petit',
          journalAN: piege.nom === 'sans-a-nouveaux' ? null : 'AN',
          constats: piege.constats(),
        },
        SOCIETES.petit,
        piege.ecritures,
      ),
    );
  }

  // ---- Attendus ------------------------------------------------------------------------------------
  const totaux = {
    propre: totaliser(propre),
    petit: totaliser(petit),
    bnc: totaliser(bnc),
    ba: totaliser(ba),
  };
  const pistes: Record<string, string[]> = {};
  for (const e of propre) if (e.piste) (pistes[e.piste] ??= []).push(e.ecritureNum);
  const tiersPropre = Object.entries(totaux.propre.tiers);
  const achatsVolume = tiersPropre.find(([cle]) => cle === 'F0001')![1];
  const attendus: Attendus = {
    $commentaire:
      'Généré par scripts/generer-fec-fictifs.ts — ne pas modifier à la main. Montants en centimes, dates ISO, lignes numérotées à partir de 1 (en-tête).',
    fichiers,
    totaux,
    pistes,
    faits: {
      clientsCrediteurs: tiersPropre.filter(([, t]) => t.compteNum.startsWith('411') && t.cloture < 0).map(([c]) => c),
      fournisseursDebiteurs: tiersPropre.filter(([, t]) => t.compteNum.startsWith('401') && t.cloture > 0).map(([c]) => c),
      fournisseurVolumeSoldeNul: { tiers: 'F0001', achats: achatsVolume.credit },
      banqueClotureeEnCours: '512300',
    },
  };
  if (achatsVolume.cloture !== 0) throw new Error(`F0001 devrait être soldé à la clôture (${achatsVolume.cloture}).`);
  if (totaux.propre.comptes['512300']!.cloture !== 0) throw new Error('512300 devrait être soldé à la clôture.');
  ecrire(join(dossier, 'attendus.json'), `${JSON.stringify(attendus, null, 1)}\n`);
  ecrire(join(dossier, 'README.md'), readme(attendus));
  return attendus;
}

// ---- README ----------------------------------------------------------------------------------------

const LIBELLES_CODES: Record<string, string> = {
  S02: 'Séparateur de zones autre que tabulation ou « | »',
  S03: 'Jeu de caractères non prévu (ni ASCII, ni ISO-8859-15, ni UTF-8)',
  S04: 'Marque d\'ordre des octets (BOM) UTF-8',
  S07: 'Nom de zone reconnu malgré une casse ou des accents différents',
  S09: 'Ordre des zones différent de l\'arrêté',
  S10: 'Zones supplémentaires',
  S11: 'Nombre de zones de la ligne différent de l\'en-tête',
  S12: 'Ligne vide',
  S14: 'Zones entre guillemets',
  D01: 'Zone obligatoire non renseignée',
  D03: 'Date inexistante ou illisible',
  D04: 'Date valide mais pas au format AAAAMMJJ',
  D05: 'Montant non numérique',
  D06: 'Montant au point décimal',
  D07: 'Montant avec séparateur de milliers',
  D08: 'Montant signé',
  D09: 'Sens hors D, C, +1, -1',
  D10: 'CompteNum ne commençant pas par trois chiffres',
  D11: 'Débit et crédit non nuls sur la même ligne',
  D13: 'CompAuxNum sans CompAuxLib (ou l\'inverse)',
  D14: 'Montantdevise sans Idevise (ou l\'inverse)',
  D16: 'Tiers intégré au numéro de compte (auxiliaire reconstruit)',
  L01: 'Libellés différents pour un même CompteNum',
  E01: 'Écriture déséquilibrée',
  E02: 'Déséquilibre global',
  E03: 'Déséquilibre d\'un journal',
  E04: 'Déséquilibre d\'un mois',
  E07: 'EcritureDate hors exercice',
  E08: 'ValidDate antérieure à EcritureDate',
  E09: 'ValidDate postérieure à la clôture',
  E10: 'Trou dans la numérotation',
  E11: 'Numéro d\'écriture en double',
  E13: 'À-nouveaux absents',
};

function lignesResumees(lignes: number[]): string {
  if (lignes.length === 0) return '—';
  if (lignes.length <= 8) return lignes.join(', ');
  return `${lignes.slice(0, 5).join(', ')}… (${lignes.length} lignes)`;
}

function readme(a: Attendus): string {
  const euros = (c: number) => (c / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 });
  const t: string[] = [];
  t.push('# Jeu de FEC fictifs');
  t.push('');
  t.push('> Fichier généré par `npm run fec:fictifs` (scripts/generer-fec-fictifs.ts). Ne pas modifier à la main.');
  t.push('');
  t.push(
    "Toutes les données sont **entièrement fictives** et générées de façon déterministe (graines fixes). Les SIREN commencent par `000`, préfixe jamais attribué par l'INSEE. Aucun vrai FEC ne doit être placé dans ce dossier ni ailleurs dans le dépôt (CLAUDE.md, règle n° 4).",
  );
  t.push('');
  t.push('- `attendus.json` : pour chaque fichier, ses caractéristiques et les **constats de conformité attendus** (code de règle, lignes concernées), les totaux par compte et par tiers, les pistes d\'audit volontaires.');
  t.push('- `gros/` : gros FEC de performance (`npm run fec:gros`, 2 000 000 lignes par défaut), **non commité**.');
  t.push('- Numéros de ligne : ligne 1 = en-tête. Montants en euros ci-dessous, en centimes dans `attendus.json`.');
  t.push('');
  for (const [categorie, titre] of [
    ['propre', 'FEC propre'],
    ['variante', 'Variantes de format'],
    ['piege', 'FEC piégés'],
  ] as const) {
    t.push(`## ${titre}`);
    t.push('');
    for (const f of a.fichiers.filter((x) => x.categorie === categorie)) {
      t.push(`### \`${f.fichier}\``);
      t.push('');
      t.push(f.description);
      t.push('');
      t.push(
        `${f.format === 'xml' ? 'XML' : `Séparateur ${f.separateur}`}, ${f.encodage}, fins de ligne ${f.finLigne}, ${f.presentationMontants} — ${f.nbLignes} lignes, ${f.nbEcritures} écritures, exercice du ${f.debut} au ${f.cloture}.`,
      );
      t.push('');
      if (f.constats.length === 0) t.push('Constats attendus : **aucun**.');
      else {
        t.push('| Code | Constat attendu | Occurrences | Lignes |');
        t.push('|---|---|---|---|');
        for (const c of f.constats) {
          t.push(`| ${c.code} | ${LIBELLES_CODES[c.code] ?? ''} | ${c.occurrences} | ${lignesResumees(c.lignes)} |`);
        }
      }
      t.push('');
    }
  }
  const p = a.totaux.propre;
  t.push('## Faits remarquables du FEC propre');
  t.push('');
  t.push(`- Total débit = total crédit = ${euros(p.totalDebit)} € ; ${p.nbLignes} lignes, ${p.nbEcritures} écritures.`);
  t.push(`- Banques mouvementées : ${p.banques.join(', ')} ; ${a.faits.banqueClotureeEnCours} (Banque Gamma) est soldée en cours d'exercice.`);
  t.push(`- Clients créditeurs à la clôture : ${a.faits.clientsCrediteurs.join(', ')}.`);
  t.push(`- Fournisseurs débiteurs à la clôture : ${a.faits.fournisseursDebiteurs.join(', ')}.`);
  t.push(
    `- Fournisseur à fort volume et solde nul : ${a.faits.fournisseurVolumeSoldeNul.tiers} (Grossiste Central Fictif SA), ${euros(a.faits.fournisseurVolumeSoldeNul.achats)} € de mouvements créditeurs.`,
  );
  t.push('- Emprunt 164000 remboursé par échéances mensuelles (BQ1) ; fournisseur en USD (Montantdevise / Idevise).');
  t.push('');
  t.push("### Pistes d'audit volontaires (statistiques, pas des anomalies)");
  t.push('');
  t.push('| Piste | Écritures (EcritureNum) |');
  t.push('|---|---|');
  for (const [piste, nums] of Object.entries(a.pistes)) t.push(`| ${piste} | ${nums.join(', ')} |`);
  t.push('');
  return `${t.join('\n')}`;
}

// ---- Gros FEC (flux) -------------------------------------------------------------------------------

export function genererGros(nbLignesCible: number, dossier = join(DOSSIER, 'gros')): { fichier: string; lignes: number; octets: number } {
  const ventesParJour = nbLignesCible / 1640; // ≈ 1 640 lignes par vente quotidienne moyenne sur un an
  const params: ParamsNegoce = {
    ...PARAMS_PROPRE,
    societe: SOCIETES.gros,
    graine: 444034,
    nbClients: 5000,
    nbFournisseurs: 1500,
    ventesParJour,
    achatsParJour: ventesParJour * 0.38,
    echelle: ventesParJour / 12,
  };
  mkdirSync(dossier, { recursive: true });
  const fichier = join(dossier, `${nomFec(SOCIETES.gros)}.txt`);
  const fd = openSync(fichier, 'w');
  let tampon = ligneEnTete(OPTIONS_STANDARD) + '\r\n';
  let lignes = 0;
  let octets = 0;
  const vider = () => {
    const b = encoder(tampon, 'utf-8');
    writeSync(fd, b);
    octets += b.length;
    tampon = '';
  };
  for (const e of simulerNegoce(params)) {
    for (const texte of lignesEcriture(e, OPTIONS_STANDARD)) {
      tampon += texte + '\r\n';
      lignes++;
    }
    if (tampon.length > 1 << 20) vider();
  }
  vider();
  closeSync(fd);
  return { fichier, lignes, octets };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const i = process.argv.indexOf('--gros');
  if (i >= 0) {
    const cible = Number(process.argv[i + 1] ?? 2_000_000) || 2_000_000;
    const debut = performance.now();
    const r = genererGros(cible);
    console.log(`Gros FEC : ${r.lignes} lignes, ${(r.octets / 1e6).toFixed(0)} Mo en ${((performance.now() - debut) / 1000).toFixed(1)} s → ${r.fichier}`);
  } else {
    const a = genererJeu();
    console.log(`${a.fichiers.length} FEC fictifs générés dans tests/fixtures/fec/ (propre : ${a.totaux.propre.nbLignes} lignes).`);
  }
}
