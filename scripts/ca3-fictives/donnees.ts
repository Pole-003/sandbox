/**
 * Données des CA3 fictives (aucune donnée réelle) : montants en euros entiers, cohérents entre eux sauf
 * les incohérences volontaires documentées. Le générateur calcule lui-même les valeurs attendues des cases,
 * indépendamment du code de lecture de l'application.
 */

/** SIREN fictif valide (clé de Luhn) construit à partir d'un préfixe de 8 chiffres. */
export function sirenFictif(prefixe8: string): string {
  for (let d = 0; d <= 9; d++) {
    const s = `${prefixe8}${d}`;
    let somme = 0;
    for (let i = 0; i < 9; i++) {
      let n = Number(s[8 - i]);
      if (i % 2 === 1) n = n * 2 > 9 ? n * 2 - 9 : n * 2;
      somme += n;
    }
    if (somme % 10 === 0) return s;
  }
  throw new Error('SIREN impossible');
}

export interface ValeursCases {
  [code: string]: { base?: number; taxe?: number; montant?: number };
}

export interface Ca3Fictive {
  fichier: string;
  denomination: string;
  siren: string;
  debut: string;
  fin: string;
  dateLimite: string;
  dateDepot: string;
  millesime: string;
  /** Mise en page : 1 (code et libellé séparés, insécables) ou 2 (code collé, montants découpés). */
  variante: 1 | 2;
  cases: ValeursCases;
  /** Ligne « dont » sans code, avec un montant, imprimée sous la case indiquée (piège de lecture). */
  dontSous?: { code: string; texte: string; montant: number };
  /** Cases ajoutées par un millésime inconnu (fictif). */
  casesSupplementaires?: { code: string; libelle: string; montant: number }[];
  /** Codes de contrôle attendus (anomalies volontaires). */
  controlesAttendus: string[];
  description: string;
  /** PDF image, sans texte. */
  scanne?: boolean;
}

const fr = (iso: string) => iso.split('-').reverse().join('/');
const finDeMois = (annee: number, mois: number) => new Date(Date.UTC(annee, mois, 0)).toISOString().slice(0, 10);
const iso = (a: number, m: number, j: number) => `${a}-${String(m).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
const taxe = (base: number, bp: number) => Math.round((base * bp) / 10000);

/** Conseil Fictif Services SAS : prestations de services, exercice du 01/07/2025 au 30/06/2026. */
export const SIREN_SERVICES = sirenFictif('00077712');
export const SIREN_ATELIER = sirenFictif('00088823');

interface Mois {
  annee: number;
  mois: number;
  ca20: number;
  ca10: number;
  e2: number;
  /** Achats de prestations auprès d'un prestataire non établi (A3), autoliquidés au taux normal. */
  a3: number;
  ded20: number;
  imm19: number;
  /** Autre TVA à déduire (21), avec une ligne « dont » sans code imprimée dessous. */
  autre21?: number;
}

const MOIS: Mois[] = [
  { annee: 2025, mois: 7, ca20: 84_000, ca10: 6_000, e2: 12_000, a3: 0, ded20: 3_100, imm19: 0 },
  { annee: 2025, mois: 8, ca20: 91_500, ca10: 0, e2: 0, a3: 0, ded20: 2_850, imm19: 0 },
  { annee: 2025, mois: 9, ca20: 76_000, ca10: 4_500, e2: 9_500, a3: 0, ded20: 3_020, imm19: 30_000 },
  { annee: 2025, mois: 10, ca20: 102_300, ca10: 0, e2: 0, a3: 2_500, ded20: 3_400, imm19: 0 },
  { annee: 2025, mois: 11, ca20: 88_800, ca10: 8_000, e2: 0, a3: 0, ded20: 3_210, imm19: 0, autre21: 300 },
  { annee: 2025, mois: 12, ca20: 95_000, ca10: 3_000, e2: 15_000, a3: 0, ded20: 3_650, imm19: 0 },
  { annee: 2026, mois: 1, ca20: 79_500, ca10: 0, e2: 0, a3: 0, ded20: 2_980, imm19: 0 },
  { annee: 2026, mois: 2, ca20: 83_250, ca10: 5_500, e2: 8_000, a3: 0, ded20: 3_120, imm19: 0 },
  { annee: 2026, mois: 3, ca20: 97_000, ca10: 2_500, e2: 0, a3: 3_200, ded20: 3_300, imm19: 0 },
  { annee: 2026, mois: 4, ca20: 101_000, ca10: 0, e2: 11_000, a3: 0, ded20: 3_560, imm19: 0 },
  { annee: 2026, mois: 5, ca20: 89_500, ca10: 7_000, e2: 0, a3: 0, ded20: 3_090, imm19: 0 },
  { annee: 2026, mois: 6, ca20: 112_400, ca10: 4_000, e2: 6_000, a3: 0, ded20: 3_870, imm19: 0 },
];

/** Calcule les cases d'une déclaration à partir des opérations, comme le ferait le déclarant. */
function cases(m: Mois, report: number): { cases: ValeursCases; credit: number } {
  const c: ValeursCases = {};
  const base08 = m.ca20 + m.a3;
  if (m.ca20) c.A1 = { montant: m.ca20 + m.ca10 };
  else if (m.ca10) c.A1 = { montant: m.ca10 };
  if (m.a3) c.A3 = { montant: m.a3 };
  if (m.e2) c.E2 = { montant: m.e2 };
  if (base08) c['08'] = { base: base08, taxe: taxe(base08, 2000) };
  if (m.ca10) c['9B'] = { base: m.ca10, taxe: taxe(m.ca10, 1000) };
  const brute = (c['08']?.taxe ?? 0) + (c['9B']?.taxe ?? 0);
  c['16'] = { montant: brute };
  if (m.imm19) c['19'] = { montant: m.imm19 };
  // La TVA autoliquidée sur A3 est déductible ligne 20.
  const ded20 = m.ded20 + taxe(m.a3, 2000);
  c['20'] = { montant: ded20 };
  if (m.autre21) c['21'] = { montant: m.autre21 };
  if (report) c['22'] = { montant: report };
  const deductible = m.imm19 + ded20 + (m.autre21 ?? 0) + report;
  c['23'] = { montant: deductible };
  let credit = 0;
  if (brute >= deductible) {
    c.TD = { montant: brute - deductible };
    c['28'] = { montant: brute - deductible };
    c['32'] = { montant: brute - deductible };
  } else {
    credit = deductible - brute;
    c['25'] = { montant: credit };
    c['27'] = { montant: credit };
  }
  return { cases: c, credit };
}

export function serieServices(): Ca3Fictive[] {
  const liste: Ca3Fictive[] = [];
  let report = 0;
  MOIS.forEach((m, k) => {
    const r = cases(m, report);
    report = r.credit;
    const suivant = m.mois === 12 ? { a: m.annee + 1, m: 1 } : { a: m.annee, m: m.mois + 1 };
    const tardif = m.annee === 2025 && m.mois === 12;
    const d: Ca3Fictive = {
      fichier: `CA3_${SIREN_SERVICES}_${m.annee}${String(m.mois).padStart(2, '0')}.pdf`,
      denomination: 'CONSEIL FICTIF SERVICES SAS',
      siren: SIREN_SERVICES,
      debut: iso(m.annee, m.mois, 1),
      fin: finDeMois(m.annee, m.mois),
      dateLimite: iso(suivant.a, suivant.m, 19),
      dateDepot: iso(suivant.a, suivant.m, tardif ? 22 : 15),
      millesime: String(m.annee),
      variante: k % 2 === 0 ? 1 : 2,
      cases: r.cases,
      controlesAttendus: [],
      description: `Mensuelle ${String(m.mois).padStart(2, '0')}/${m.annee}`,
    };
    if (m.imm19) d.description += ' : achat d’immobilisation, crédit de TVA reporté (ligne 27)';
    if (report === 0 && r.cases['22']) d.description += ' : imputation du crédit reporté (ligne 22)';
    if (r.cases['22'] && report > 0) d.description += ' : crédit reporté partiellement imputé, nouveau crédit';
    if (m.a3) d.description += ' : achat de prestation autoliquidé (A3)';
    if (m.autre21) {
      d.dontSous = { code: '21', texte: '(dont régularisation de TVA collectée sur autres produits ou PS [cf. notice] ou de TVA déductible :', montant: m.autre21 };
      d.description += ' : ligne « dont » sans code avec montant sous la ligne 21';
    }
    if (tardif) {
      d.description += ' : déposée après la date limite';
      d.controlesAttendus.push('DEPOT_TARDIF');
    }
    if (m.annee === 2026 && m.mois === 2) {
      // Incohérences volontaires : taxe 9B erronée (500 au lieu de 550) et total 16 mal reporté (+1 000).
      const juste = r.cases['9B']!.taxe!;
      r.cases['9B']!.taxe = 500;
      r.cases['16']!.montant = r.cases['16']!.montant! - juste + 500 + 1_000;
      r.cases.TD!.montant = r.cases['16']!.montant! - r.cases['23']!.montant!;
      r.cases['28']!.montant = r.cases.TD!.montant;
      r.cases['32']!.montant = r.cases.TD!.montant;
      d.description += ' : incohérences volontaires (taxe 9B ≠ base × 10 %, ligne 16 ≠ somme des taxes)';
      d.controlesAttendus.push('T9B', 'L16');
    }
    liste.push(d);
  });
  return liste;
}

/** Atelier Trimestriel SARL : déclarations trimestrielles de l'année 2025. */
export function serieTrimestrielle(): Ca3Fictive[] {
  const trimestres = [
    { t: 1, ca: 4_200, ded: 310 },
    { t: 2, ca: 3_900, ded: 280 },
    { t: 3, ca: 2_750, ded: 420 },
    { t: 4, ca: 4_600, ded: 350 },
  ];
  return trimestres.map(({ t, ca, ded }) => {
    const mFin = t * 3;
    const tva = taxe(ca, 2000);
    const c: ValeursCases = { A1: { montant: ca }, '08': { base: ca, taxe: tva }, '16': { montant: tva }, '20': { montant: ded }, '23': { montant: ded }, TD: { montant: tva - ded }, '28': { montant: tva - ded }, '32': { montant: tva - ded } };
    const suivant = mFin === 12 ? { a: 2026, m: 1 } : { a: 2025, m: mFin + 1 };
    return {
      fichier: `CA3_${SIREN_ATELIER}_2025T${t}.pdf`,
      denomination: 'ATELIER TRIMESTRIEL SARL',
      siren: SIREN_ATELIER,
      debut: iso(2025, mFin - 2, 1),
      fin: finDeMois(2025, mFin),
      dateLimite: iso(suivant.a, suivant.m, 24),
      dateDepot: iso(suivant.a, suivant.m, 20),
      millesime: '2025',
      variante: t % 2 === 0 ? 2 : 1,
      cases: c,
      controlesAttendus: [],
      description: `Trimestrielle T${t} 2025`,
    };
  });
}

/** Variante d'un millésime inconnu (fictif) : une case supplémentaire « W1 » inventée pour le test. */
export function millesimeInconnu(): Ca3Fictive {
  const base = serieTrimestrielle()[0]!;
  return {
    ...base,
    fichier: `CA3_${SIREN_ATELIER}_millesime_inconnu.pdf`,
    millesime: '2027',
    casesSupplementaires: [{ code: 'W1', libelle: 'Case fictive d’un millésime futur (test)', montant: 1_234 }],
    controlesAttendus: [],
    description: 'Formulaire d’un millésime inconnu (2027, fictif) avec une case inconnue W1',
  };
}

export function pdfScanne(): Ca3Fictive {
  const base = serieTrimestrielle()[1]!;
  return { ...base, fichier: 'CA3_scan_illisible.pdf', scanne: true, description: 'PDF image sans texte (déclaration scannée) : saisie manuelle', controlesAttendus: [] };
}

export { fr };
