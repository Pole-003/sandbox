/**
 * Conversion des valeurs d'un FEC : montants en centimes entiers (sans calcul flottant),
 * dates en entiers AAAAMMJJ, sens D/C.
 */

export interface Montant {
  /** Centimes (entier signé) ; 0 si vide ou invalide. */
  centimes: number;
  vide: boolean;
  invalide: boolean;
  pointDecimal: boolean;
  milliers: boolean;
  signe: boolean;
}

const MONTANT_VIDE: Montant = { centimes: 0, vide: true, invalide: false, pointDecimal: false, milliers: false, signe: false };
const ESPACES = /[\s\u00a0\u202f]/g;
const A_ESPACES = /[\s\u00a0\u202f]/;

/** Arrondit au centime une partie décimale de longueur quelconque (« 5 » → 50, « 567 » → 57). */
function centimesDecimales(decimales: string): number {
  if (decimales.length <= 2) return Number(decimales.padEnd(2, '0'));
  const base = Number(decimales.slice(0, 2));
  return Number(decimales[2]) >= 5 ? base + 1 : base;
}

/**
 * Montant au format FEC (virgule décimale, signe en tête ou en fin, A47 A-1 XII 2°), avec tolérance :
 * point décimal, séparateurs de milliers (espace, espace insécable, point ou virgule de groupement),
 * notation scientifique. `xml` : le point décimal est la norme.
 */
export function lireMontant(texte: string, xml = false): Montant {
  // Chemin rapide : format conforme « 1234,56 » (ou « 1234.56 » en XML), sans signe.
  const sep = xml ? 46 : 44;
  const n = texte.length;
  if (n >= 4 && n <= 17 && texte.charCodeAt(n - 3) === sep) {
    let entiers = 0;
    let ok = true;
    for (let i = 0; i < n - 3; i++) {
      const c = texte.charCodeAt(i) - 48;
      if (c < 0 || c > 9) {
        ok = false;
        break;
      }
      entiers = entiers * 10 + c;
    }
    const d1 = texte.charCodeAt(n - 2) - 48;
    const d2 = texte.charCodeAt(n - 1) - 48;
    if (ok && d1 >= 0 && d1 <= 9 && d2 >= 0 && d2 <= 9) {
      return { centimes: entiers * 100 + d1 * 10 + d2, vide: false, invalide: false, pointDecimal: false, milliers: false, signe: false };
    }
  }
  let t = texte.trim();
  if (t === '') return MONTANT_VIDE;
  let negatif = false;
  let signe = false;
  if (/^[+-]/.test(t)) {
    negatif = t[0] === '-';
    signe = negatif;
    t = t.slice(1).trim();
  } else if (/[+-]$/.test(t)) {
    negatif = t.endsWith('-');
    signe = negatif;
    t = t.slice(0, -1).trim();
  }
  const invalide = (): Montant => ({ ...MONTANT_VIDE, vide: false, invalide: true });
  if (/^\d+(?:[.,]\d+)?[eE][+-]?\d+$/.test(t)) {
    const valeur = Number(t.replace(',', '.'));
    if (!Number.isFinite(valeur)) return invalide();
    const c = Math.round(valeur * 100);
    return { centimes: negatif ? -c : c, vide: false, invalide: false, pointDecimal: t.includes('.') && !xml, milliers: false, signe };
  }
  let milliers = false;
  if (A_ESPACES.test(t)) {
    milliers = true;
    t = t.replace(ESPACES, '');
  }
  if (!/^[\d.,]+$/.test(t) || !/\d/.test(t)) return invalide();
  const virgules = (t.match(/,/g) ?? []).length;
  const points = (t.match(/\./g) ?? []).length;
  let entiers: string;
  let decimales = '';
  let pointDecimal = false;
  if (virgules && points) {
    // Le dernier séparateur est décimal, l'autre groupe les milliers.
    const dernier = Math.max(t.lastIndexOf(','), t.lastIndexOf('.'));
    const sepDecimal = t[dernier];
    const sepMilliers = sepDecimal === ',' ? '.' : ',';
    if ((sepDecimal === ',' ? virgules : points) > 1) return invalide();
    entiers = t.slice(0, dernier).replaceAll(sepMilliers, '');
    decimales = t.slice(dernier + 1);
    milliers = true;
    pointDecimal = sepDecimal === '.';
  } else if (virgules || points) {
    const sep = virgules ? ',' : '.';
    const nb = virgules || points;
    if (nb > 1) {
      // « 1.234.567 » ou « 1,234,567 » : groupement des milliers sans décimales.
      if (!new RegExp(`^\\d{1,3}(\\${sep}\\d{3})+$`).test(t)) return invalide();
      entiers = t.replaceAll(sep, '');
      milliers = true;
    } else {
      const position = t.indexOf(sep);
      entiers = t.slice(0, position);
      decimales = t.slice(position + 1);
      pointDecimal = sep === '.';
    }
  } else {
    entiers = t;
  }
  if (entiers === '') entiers = '0';
  if (!/^\d+$/.test(entiers) || !/^\d*$/.test(decimales)) return invalide();
  const centimes = Number(entiers) * 100 + centimesDecimales(decimales);
  if (!Number.isSafeInteger(centimes)) return invalide();
  return {
    centimes: negatif ? -centimes : centimes,
    vide: false,
    invalide: false,
    pointDecimal: pointDecimal && !xml,
    milliers,
    signe,
  };
}

export interface DateLue {
  /** AAAAMMJJ (entier), 0 si vide, -1 si invalide. */
  valeur: number;
  /** Lisible mais pas au format AAAAMMJJ (D04). */
  horsFormat: boolean;
  /** Remplie de zéros au lieu d'être vide (D17). */
  zeros: boolean;
}

function dateExiste(a: number, m: number, j: number): boolean {
  if (m < 1 || m > 12 || j < 1 || a < 1900 || a > 2099) return false;
  const jours = [31, a % 4 === 0 && (a % 100 !== 0 || a % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return j <= jours[m - 1]!;
}

const HEURE = String.raw`(?:[T ]\d{1,2}:\d{1,2}(?::\d{1,2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?`;
const AMJ = new RegExp(String.raw`^(\d{4})[-/.]?(\d{2})[-/.]?(\d{2})${HEURE}$`);
const JMA = new RegExp(String.raw`^(\d{2})[-/.](\d{2})[-/.](\d{4})${HEURE}$`);

/** Lit une date FEC (AAAAMMJJ), en tolérant AAAA-MM-JJ, JJ/MM/AAAA et une heure accolée. `xml` : AAAA-MM-JJ est la norme. */
export function lireDate(texte: string, xml = false): DateLue {
  // Chemin rapide : AAAAMMJJ (à plat) ou AAAA-MM-JJ (XML).
  if (!xml && texte.length === 8) {
    let v = 0;
    for (let i = 0; i < 8; i++) {
      const c = texte.charCodeAt(i) - 48;
      if (c < 0 || c > 9) {
        v = -1;
        break;
      }
      v = v * 10 + c;
    }
    if (v > 0) {
      const a = Math.floor(v / 10000);
      const m = Math.floor(v / 100) % 100;
      const j = v % 100;
      return dateExiste(a, m, j) ? { valeur: v, horsFormat: false, zeros: false } : { valeur: -1, horsFormat: false, zeros: false };
    }
  }
  const t = texte.trim();
  if (t === '') return { valeur: 0, horsFormat: false, zeros: false };
  if (/^[0\-/. :T]+$/.test(t)) return { valeur: 0, horsFormat: false, zeros: true };
  let a: number;
  let m: number;
  let j: number;
  let conforme: boolean;
  let r = AMJ.exec(t);
  if (r) {
    [a, m, j] = [Number(r[1]), Number(r[2]), Number(r[3])];
    conforme = xml ? /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(t) : /^\d{8}$/.test(t);
  } else if ((r = JMA.exec(t))) {
    [j, m, a] = [Number(r[1]), Number(r[2]), Number(r[3])];
    conforme = false;
  } else {
    return { valeur: -1, horsFormat: false, zeros: false };
  }
  if (!dateExiste(a, m, j)) return { valeur: -1, horsFormat: false, zeros: false };
  return { valeur: a * 10000 + m * 100 + j, horsFormat: !conforme, zeros: false };
}

export type Sens = 'D' | 'C';

/** Sens D/C ou +1/-1 (casse ignorée) ; `toleree` si interprétable mais non conforme (« + 1 »). */
export function lireSens(texte: string): { sens: Sens | null; conforme: boolean } {
  const t = texte.trim().toUpperCase();
  if (t === 'D' || t === '+1') return { sens: 'D', conforme: true };
  if (t === 'C' || t === '-1') return { sens: 'C', conforme: true };
  const compact = t.replace(/\s+/g, '');
  if (compact === '+1' || compact === '1' || compact === 'DEBIT' || compact === 'DÉBIT') return { sens: 'D', conforme: false };
  if (compact === '-1' || compact === 'CREDIT' || compact === 'CRÉDIT') return { sens: 'C', conforme: false };
  return { sens: null, conforme: false };
}

/** AAAAMMJJ → « AAAA-MM-JJ ». */
export function dateIso(valeur: number): string {
  const s = String(valeur);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** « AAAA-MM-JJ » → AAAAMMJJ. */
export function dateNombre(iso: string): number {
  return Number(iso.replaceAll('-', ''));
}
