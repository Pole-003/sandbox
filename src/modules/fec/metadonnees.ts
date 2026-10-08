/**
 * Métadonnées du dossier : SIREN et date de clôture tirés du nom de fichier, journal d'à-nouveaux,
 * dates de début et de fin d'exercice.
 */
import { ajouterJours, ajouterMois, estDateIso, finDeMois } from '../../core/dates.ts';
import type { FecColonnes } from './donnees/colonnes.ts';
import { dateIso } from './import/valeurs.ts';

/** Clé de Luhn du SIREN. */
export function sirenValide(siren: string): boolean {
  if (!/^\d{9}$/.test(siren)) return false;
  let total = 0;
  for (let i = 0; i < 9; i++) {
    let c = Number(siren[8 - i]);
    if (i % 2 === 1) {
      c *= 2;
      if (c > 9) c -= 9;
    }
    total += c;
  }
  return total % 10 === 0;
}

export interface NomFichier {
  siren: string | null;
  cloture: string | null;
  /** Nom conforme à {SIREN}FEC{AAAAMMJJ} (suffixe toléré, BOFiP § 370). */
  conforme: boolean;
  sirenValide: boolean;
}

export function lireNomFichier(nom: string): NomFichier {
  const base = nom.split(/[\\/]/).pop() ?? nom;
  const r = /^(\d{9})FEC(\d{4})(\d{2})(\d{2})/i.exec(base);
  const r2 = r ?? /(\d{9})FEC(\d{4})(\d{2})(\d{2})/i.exec(base);
  if (!r2) return { siren: null, cloture: null, conforme: false, sirenValide: false };
  const iso = `${r2[2]}-${r2[3]}-${r2[4]}`;
  const dateOk = estDateIso(iso);
  const siren = r2[1]!;
  const valide = sirenValide(siren);
  return { siren, cloture: dateOk ? iso : null, conforme: Boolean(r) && dateOk && valide, sirenValide: valide };
}

export interface JournalAN {
  code: string;
  libelle: string;
  /** Comment le journal a été reconnu (à confirmer par l'utilisateur). */
  methode: 'code' | 'libelle-journal' | 'libelle-ecritures';
}

const CODES_AN = /^(A\.?N\.?|AN\d?|ANO|ANX|RAN\d?|R\.?A\.?N\.?|OUV|NOUV|REP|REPORT)$/i;
const LIBELLES_AN = /(^|[^a-z])([aà][ \-.]*nouveaux?|ouverture|reprise des soldes|report [aà] nouveau|reports? des soldes)/i;

/** Journal d'à-nouveaux : par son code, son libellé, ou par les écritures du premier jour au libellé d'à-nouveau. */
export function detecterJournalAN(f: FecColonnes): JournalAN | null {
  const journaux = new Map<number, { lib: number; lignes: number; libellesAN: number; premiereDate: number }>();
  let dateMin = Number.MAX_SAFE_INTEGER;
  for (let i = 0; i < f.nbLignes; i++) {
    const d = f.ecritureDate[i]!;
    if (d > 0 && d < dateMin) dateMin = d;
  }
  for (let i = 0; i < f.nbLignes; i++) {
    const j = f.journalCode[i]!;
    let e = journaux.get(j);
    if (!e) journaux.set(j, (e = { lib: f.journalLib[i]!, lignes: 0, libellesAN: 0, premiereDate: f.ecritureDate[i]! }));
    e.lignes++;
    if (f.ecritureDate[i] === dateMin && LIBELLES_AN.test(f.textes[f.ecritureLib[i]!]!)) e.libellesAN++;
  }
  const t = (i: number) => f.textes[i]!;
  for (const [code, e] of journaux) if (CODES_AN.test(t(code).trim())) return { code: t(code), libelle: t(e.lib), methode: 'code' };
  for (const [code, e] of journaux) if (LIBELLES_AN.test(t(e.lib))) return { code: t(code), libelle: t(e.lib), methode: 'libelle-journal' };
  let meilleur: [number, number] | null = null;
  for (const [code, e] of journaux) if (e.libellesAN > 0 && (!meilleur || e.libellesAN > meilleur[1])) meilleur = [code, e.libellesAN];
  if (meilleur) {
    const e = journaux.get(meilleur[0])!;
    return { code: t(meilleur[0]), libelle: t(e.lib), methode: 'libelle-ecritures' };
  }
  return null;
}

/** Une ligne appartient-elle aux à-nouveaux ? (journal d'AN ; si le journal est reconnu par les libellés, seulement ces écritures). */
export function filtreAN(f: FecColonnes, an: JournalAN | null): (ligne: number) => boolean {
  if (!an) return () => false;
  const code = f.textes.indexOf(an.code);
  if (an.methode !== 'libelle-ecritures') return (i) => f.journalCode[i] === code;
  const ecritures = new Set<number>();
  for (let i = 0; i < f.nbLignes; i++) {
    if (f.journalCode[i] === code && LIBELLES_AN.test(f.textes[f.ecritureLib[i]!]!)) ecritures.add(f.ecriture[i]!);
  }
  return (i) => ecritures.has(f.ecriture[i]!);
}

export interface Exercice {
  debut: string;
  fin: string;
  /** Durée en mois (exercice décalé, court ou de plus de 12 mois accepté). */
  dureeMois: number;
}

/** Quantile des dates d'écriture valides (robuste aux quelques écritures hors exercice). */
function quantileDates(f: FecColonnes, q: number, filtre: (i: number) => boolean = () => true): number | null {
  const dates: number[] = [];
  for (let i = 0; i < f.nbLignes; i++) if (f.ecritureDate[i]! > 0 && filtre(i)) dates.push(f.ecritureDate[i]!);
  if (dates.length === 0) return null;
  dates.sort((a, b) => a - b);
  return dates[Math.min(dates.length - 1, Math.floor(q * dates.length))]!;
}

/**
 * Fin : date du nom de fichier, sinon DateCloture du XML, sinon fin du mois des dernières écritures.
 * Début : date des à-nouveaux, sinon premier jour du mois des premières écritures ; si la durée
 * obtenue s'écarte de plus d'un mois d'un exercice de 12 mois, le lendemain de la clôture N-1 est retenu.
 */
export function deduireExercice(f: FecColonnes, an: JournalAN | null, clotureConnue: string | null): Exercice | null {
  const derniere = quantileDates(f, 0.999);
  if (derniere === null) return null;
  const fin = clotureConnue ?? finDeMois(dateIso(derniere));
  const estAN = filtreAN(f, an);
  const dateAN = an ? quantileDates(f, 0, estAN) : null;
  let debut: string;
  if (dateAN !== null) debut = dateIso(dateAN);
  else {
    const premiere = quantileDates(f, 0.001)!;
    debut = `${dateIso(premiere).slice(0, 8)}01`;
    const douzeMois = ajouterJours(ajouterMois(fin, -12), 1);
    if (Math.abs(Number(debut.slice(0, 4)) * 12 + Number(debut.slice(5, 7)) - (Number(douzeMois.slice(0, 4)) * 12 + Number(douzeMois.slice(5, 7)))) <= 1) {
      debut = douzeMois;
    }
  }
  const dureeMois =
    (Number(fin.slice(0, 4)) - Number(debut.slice(0, 4))) * 12 + Number(fin.slice(5, 7)) - Number(debut.slice(5, 7)) + 1;
  return { debut, fin, dureeMois };
}
