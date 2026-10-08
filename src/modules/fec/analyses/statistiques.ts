/**
 * Statistiques et tests sur les écritures de journal. Ce sont des pistes d'investigation, pas des
 * conclusions : chaque indicateur renvoie la liste des écritures concernées.
 */
import { ajouterJours, jourFerie, jourSemaine } from '../../../core/dates.ts';
import { dateIso } from '../import/valeurs.ts';
import type { ContexteAnalyse } from './contexte.ts';

export interface ParametresStatistiques {
  /** Montant rond : multiple de ce montant (centimes)… */
  multipleRond: number;
  /** … et au moins égal à ce montant (centimes). */
  minimumRond: number;
  /** Fin de période : nombre de jours avant (et après) la clôture. */
  joursFinPeriode: number;
  /** Fin de période : seuil de montant ; null = 99e centile des écritures de l'exercice. */
  seuilFinPeriode: number | null;
}

export const PARAMETRES_STATISTIQUES: ParametresStatistiques = {
  multipleRond: 100_000,
  minimumRond: 100_000,
  joursFinPeriode: 5,
  seuilFinPeriode: null,
};

export interface Indicateur {
  id: string;
  libelle: string;
  description: string;
  /** Indices d'écriture (champ `ecriture` des colonnes), triés. */
  ecritures: number[];
}

export interface Benford {
  /** Effectifs observés pour les chiffres 1 à 9 (indice 0 = chiffre 1). */
  observes: number[];
  /** Proportions attendues selon la loi de Benford. */
  attendues: number[];
  total: number;
  /** Écart absolu moyen (MAD, Nigrini) et appréciation. */
  mad: number;
  conformite: 'proche' | 'acceptable' | 'marginale' | 'non conforme' | 'échantillon insuffisant';
}

export interface Statistiques {
  journaux: string[];
  /** Mois AAAA-MM de l'exercice et hors exercice présents. */
  mois: string[];
  /** Nombre d'écritures [journal][mois]. */
  ecrituresParJournalMois: number[][];
  /** Total des débits [journal][mois] (centimes). */
  debitsParJournalMois: number[][];
  indicateurs: Indicateur[];
  benford: Benford;
  seuilFinPeriode: number;
}

const LIBELLES_GENERIQUES = new Set([
  'divers',
  'diverses',
  'regul',
  'regul.',
  'regularisation',
  'regularisations',
  'a regulariser',
  'od',
  'o.d.',
  'ecriture',
  'ecritures',
  'virement',
  'correction',
  'ajustement',
  'annulation',
  'test',
  'x',
  'xx',
  'xxx',
  '?',
  '-',
  '.',
  'nc',
  'sans libelle',
]);

function normaliser(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function libelleGenerique(texte: string): boolean {
  // Les libellés génériques sont courts : inutile de normaliser les libellés longs.
  if (texte.length > 24) return false;
  const n = normaliser(texte);
  return n.length <= 2 || LIBELLES_GENERIQUES.has(n);
}

/** Journal d'opérations diverses : code OD, DIV… ou libellé « opérations diverses ». */
export function estJournalOD(code: string, libelle: string): boolean {
  return /^(O\.?D|DIV|OPD|ODA|ODS|ODP)/i.test(code.trim()) || /op[ée]rations? diverses|\bdivers\b/i.test(libelle);
}

/** Comptes sensibles : trésorerie (51, 53, 54, 58) et chiffre d'affaires (70). */
export function compteSensible(compte: string): 'tresorerie' | 'chiffre-affaires' | null {
  if (/^5[1348]/.test(compte)) return 'tresorerie';
  if (/^70/.test(compte)) return 'chiffre-affaires';
  return null;
}

export const BENFORD = Array.from({ length: 9 }, (_, d) => Math.log10(1 + 1 / (d + 1)));

/** Premier chiffre significatif d'un montant en centimes (≥ 1). */
export function premierChiffre(centimes: number): number {
  let x = Math.abs(centimes);
  while (x >= 10) x = Math.floor(x / 10);
  return x;
}

export function calculerStatistiques(ctx: ContexteAnalyse, p: ParametresStatistiques = PARAMETRES_STATISTIQUES): Statistiques {
  const { f } = ctx;
  const E = f.nbEcritures;
  const date = new Int32Array(E);
  const valid = new Int32Array(E);
  const journal = new Uint32Array(E);
  const libelle = new Uint32Array(E);
  const piece = new Uint32Array(E);
  const tiers = new Uint32Array(E);
  const totalDebit = new Float64Array(E);
  const an = new Uint8Array(E);
  const rond = new Uint8Array(E);
  const sensible = new Uint8Array(E); // 1 trésorerie, 2 CA, 3 les deux
  const vue = new Uint8Array(E);
  const benford = new Array<number>(9).fill(0);
  const natureCompte = new Uint8Array(f.textes.length);
  for (let i = 0; i < f.nbLignes; i++) {
    const e = f.ecriture[i]!;
    if (!vue[e]) {
      vue[e] = 1;
      date[e] = f.ecritureDate[i]!;
      journal[e] = f.journalCode[i]!;
      libelle[e] = f.ecritureLib[i]!;
      piece[e] = f.pieceRef[i]!;
    }
    if (f.validDate[i]! > valid[e]!) valid[e] = f.validDate[i]!;
    if (ctx.an[i]) an[e] = 1;
    const m = f.debit[i]! || f.credit[i]!;
    totalDebit[e] = totalDebit[e]! + f.debit[i]!;
    if (m >= p.minimumRond && m % p.multipleRond === 0) rond[e] = 1;
    const c = f.compteNum[i]!;
    // Nature du compte, calculée une fois par compte : 1 trésorerie, 2 CA, 4 tiers 40/41, 8 autre.
    let nature = natureCompte[c]!;
    if (nature === 0) {
      const num = f.textes[c]!;
      const s = compteSensible(num);
      natureCompte[c] = nature = s === 'tresorerie' ? 1 : s === 'chiffre-affaires' ? 2 : /^4[01]/.test(num) ? 4 : 8;
    }
    if (nature <= 2) sensible[e]! |= nature;
    if (nature === 4 && !tiers[e]) tiers[e] = f.compAuxNum[i] || c;
    if (!ctx.an[i] && m >= 1_000) benford[premierChiffre(m) - 1]!++;
  }

  // Écritures par journal et par mois.
  const codesJournaux = [...new Set(journal)].sort((a, b) => f.textes[a]!.localeCompare(f.textes[b]!));
  const moisSet = new Set<string>();
  for (let e = 0; e < E; e++) if (date[e]! > 0) moisSet.add(String(Math.floor(date[e]! / 100)));
  const mois = [...moisSet].sort();
  const rangJournal = new Map(codesJournaux.map((j, r) => [j, r]));
  const rangMois = new Map(mois.map((m, r) => [m, r]));
  const nb = codesJournaux.map(() => mois.map(() => 0));
  const montants = codesJournaux.map(() => mois.map(() => 0));
  for (let e = 0; e < E; e++) {
    if (date[e]! <= 0) continue;
    const r = rangJournal.get(journal[e]!)!;
    const c = rangMois.get(String(Math.floor(date[e]! / 100)))!;
    nb[r]![c]!++;
    montants[r]![c]! += totalDebit[e]!;
  }

  const liste = (predicat: (e: number) => boolean) => {
    const r: number[] = [];
    for (let e = 0; e < E; e++) if (predicat(e)) r.push(e);
    return r;
  };
  const ouvert = (e: number) => !an[e] && date[e]! > 0;
  // Caches par date et par libellé (quelques centaines de dates, libellés répétés).
  const parDate = new Map<number, { weekEnd: boolean; ferie: boolean }>();
  const infoDate = (d: number) => {
    let x = parDate.get(d);
    if (!x) {
      const iso = dateIso(d);
      parDate.set(d, (x = { weekEnd: [0, 6].includes(jourSemaine(iso)), ferie: jourFerie(iso) !== undefined }));
    }
    return x;
  };
  const generique = new Int8Array(f.textes.length).fill(-1);
  const estGenerique = (k: number) => {
    if (generique[k] === -1) generique[k] = libelleGenerique(f.textes[k]!) ? 1 : 0;
    return generique[k] === 1;
  };
  const libelleJournal = new Map<number, number>();
  for (let i = 0; i < f.nbLignes; i++) if (!libelleJournal.has(f.journalCode[i]!)) libelleJournal.set(f.journalCode[i]!, f.journalLib[i]!);
  const journalOD = new Uint8Array(f.textes.length);
  for (const j of codesJournaux) if (estJournalOD(f.textes[j]!, f.textes[libelleJournal.get(j)!]!)) journalOD[j] = 1;

  // Doublons probables : même journal, même pièce et même montant ; ou même date, même tiers et même montant.
  // Clés numériques (indices de dictionnaire) ; le montant est vérifié à l'intérieur de chaque groupe.
  const groupes = new Map<number, number | number[]>();
  const doublons = new Set<number>();
  const ajouterGroupe = (cle: number, e: number) => {
    const g = groupes.get(cle);
    if (g === undefined) {
      groupes.set(cle, e);
      return;
    }
    const membres = typeof g === 'number' ? [g] : g;
    for (const autre of membres) {
      if (totalDebit[autre] === totalDebit[e] && autre !== e) {
        doublons.add(autre);
        doublons.add(e);
      }
    }
    membres.push(e);
    if (typeof g === 'number') groupes.set(cle, membres);
  };
  const jourDe = (d: number) => Math.floor(d / 10000) * 372 + (Math.floor(d / 100) % 100) * 31 + (d % 100);
  for (let e = 0; e < E; e++) {
    if (!ouvert(e) || totalDebit[e] === 0) continue;
    // Pièce : clé positive ; tiers et date : clé négative (deux familles de groupes disjointes).
    if (piece[e]) ajouterGroupe(piece[e]! * 65_536 + (journal[e]! % 65_536), e);
    if (tiers[e]) ajouterGroupe(-(tiers[e]! * 1_048_576 + (jourDe(date[e]!) % 1_048_576)) - 1, e);
  }
  // Les clés tronquées peuvent réunir deux journaux ou deux dates : on ne garde que les vrais doublons.
  for (const e of [...doublons]) {
    let confirme = false;
    for (const autre of doublons) {
      if (autre === e || totalDebit[autre] !== totalDebit[e]) continue;
      if ((piece[e] && piece[autre] === piece[e] && journal[autre] === journal[e]) || (tiers[e] && tiers[autre] === tiers[e] && date[autre] === date[e])) {
        confirme = true;
        break;
      }
    }
    if (!confirme) doublons.delete(e);
  }

  // Fin de période : seuil = 99e centile des totaux d'écriture (hors à-nouveaux), sauf seuil imposé.
  const totaux: number[] = [];
  for (let e = 0; e < E; e++) if (ouvert(e)) totaux.push(totalDebit[e]!);
  totaux.sort((a, b) => a - b);
  const seuil = p.seuilFinPeriode ?? (totaux.length ? totaux[Math.min(totaux.length - 1, Math.floor(0.99 * totaux.length))]! : 0);
  const finMoins = Number(ajouterJours(ctx.fin, -p.joursFinPeriode).replaceAll('-', ''));
  const finPlus = Number(ajouterJours(ctx.fin, p.joursFinPeriode).replaceAll('-', ''));

  const total = benford.reduce((a, b) => a + b, 0);
  const mad = total ? benford.reduce((s, n, d) => s + Math.abs(n / total - BENFORD[d]!), 0) / 9 : 0;
  const conformite: Benford['conformite'] =
    total < 300 ? 'échantillon insuffisant' : mad < 0.006 ? 'proche' : mad < 0.012 ? 'acceptable' : mad < 0.015 ? 'marginale' : 'non conforme';

  const indicateurs: Indicateur[] = [
    {
      id: 'week-end',
      libelle: 'Écritures datées un samedi ou un dimanche',
      description: 'Date de comptabilisation un jour de week-end (hors à-nouveaux).',
      ecritures: liste((e) => ouvert(e) && infoDate(date[e]!).weekEnd),
    },
    {
      id: 'jour-ferie',
      libelle: 'Écritures datées un jour férié',
      description: 'Jours fériés légaux français, fêtes mobiles (Pâques, Ascension, Pentecôte) comprises.',
      ecritures: liste((e) => ouvert(e) && infoDate(date[e]!).ferie),
    },
    {
      id: 'datee-apres-cloture',
      libelle: 'Écritures datées après la clôture',
      description: 'EcritureDate postérieure à la date de fin d’exercice.',
      ecritures: liste((e) => date[e]! > ctx.finN),
    },
    {
      id: 'validee-apres-cloture',
      libelle: 'Écritures validées après la clôture',
      description: 'ValidDate postérieure à la date de fin d’exercice (normal pour l’inventaire, à examiner pour le reste).',
      ecritures: liste((e) => valid[e]! > ctx.finN),
    },
    {
      id: 'montants-ronds',
      libelle: 'Montants ronds',
      description: `Au moins une ligne d’un montant multiple de ${(p.multipleRond / 100).toLocaleString('fr-FR')} € et d’au moins ${(p.minimumRond / 100).toLocaleString('fr-FR')} €.`,
      ecritures: liste((e) => ouvert(e) && rond[e] === 1),
    },
    {
      id: 'od-tresorerie',
      libelle: 'Opérations diverses touchant la trésorerie',
      description: 'Écritures d’un journal d’OD mouvementant un compte 51, 53, 54 ou 58.',
      ecritures: liste((e) => ouvert(e) && journalOD[journal[e]!] === 1 && (sensible[e]! & 1) === 1),
    },
    {
      id: 'od-chiffre-affaires',
      libelle: 'Opérations diverses touchant le chiffre d’affaires',
      description: 'Écritures d’un journal d’OD mouvementant un compte 70.',
      ecritures: liste((e) => ouvert(e) && journalOD[journal[e]!] === 1 && (sensible[e]! & 2) === 2),
    },
    {
      id: 'libelle-generique',
      libelle: 'Libellés vides ou génériques',
      description: '« Divers », « Régul », « OD », libellé vide ou de moins de trois caractères…',
      ecritures: liste((e) => ouvert(e) && estGenerique(libelle[e]!)),
    },
    {
      id: 'doublon-probable',
      libelle: 'Écritures en double probable',
      description: 'Même journal, même pièce et même montant ; ou même date, même tiers et même montant.',
      ecritures: [...doublons].sort((a, b) => a - b),
    },
    {
      id: 'fin-periode',
      libelle: 'Écritures de fin de période de montant élevé',
      description: `Datées dans les ${p.joursFinPeriode} jours qui précèdent ou suivent la clôture, d’un montant total d’au moins ${(seuil / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €${p.seuilFinPeriode === null ? ' (99e centile des écritures)' : ''}.`,
      ecritures: liste((e) => ouvert(e) && date[e]! >= finMoins && date[e]! <= finPlus && totalDebit[e]! >= seuil && seuil > 0),
    },
  ];

  return {
    journaux: codesJournaux.map((j) => f.textes[j]!),
    mois: mois.map((m) => `${m.slice(0, 4)}-${m.slice(4)}`),
    ecrituresParJournalMois: nb,
    debitsParJournalMois: montants,
    indicateurs,
    benford: { observes: benford, attendues: BENFORD, total, mad, conformite },
    seuilFinPeriode: seuil,
  };
}

/** Écritures dont une ligne (hors à-nouveaux, ≥ 10 €) commence par le chiffre donné (exploration Benford). */
export function ecrituresDuChiffre(ctx: ContexteAnalyse, chiffre: number): number[] {
  const { f } = ctx;
  const r = new Set<number>();
  for (let i = 0; i < f.nbLignes; i++) {
    const m = f.debit[i]! || f.credit[i]!;
    if (!ctx.an[i] && m >= 1_000 && premierChiffre(m) === chiffre) r.add(f.ecriture[i]!);
  }
  return [...r].sort((a, b) => a - b);
}
