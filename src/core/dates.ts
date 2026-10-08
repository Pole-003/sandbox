/**
 * Dates calendaires au format interne ISO « AAAA-MM-JJ » (CLAUDE.md, conventions).
 * Calculs en UTC pour échapper aux changements d'heure.
 */

const MS_PAR_JOUR = 86_400_000;

function versUtc(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

function depuisUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Vrai si la chaîne est une date ISO existante (rejette 2025-02-30, 2025-13-01…). */
export function estDateIso(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const ms = versUtc(iso);
  return depuisUtc(ms) === iso;
}

export function ajouterJours(iso: string, jours: number): string {
  return depuisUtc(versUtc(iso) + jours * MS_PAR_JOUR);
}

/** Nombre de jours de a à b (positif si b est postérieure). */
export function ecartJours(a: string, b: string): number {
  return Math.round((versUtc(b) - versUtc(a)) / MS_PAR_JOUR);
}

/** 0 = dimanche … 6 = samedi. */
export function jourSemaine(iso: string): number {
  return new Date(versUtc(iso)).getUTCDay();
}

export function finDeMois(iso: string): string {
  const d = new Date(versUtc(iso));
  return depuisUtc(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

/** Ajoute des mois en conservant le jour, borné à la fin du mois (31/01 + 1 mois = 28 ou 29/02). */
export function ajouterMois(iso: string, mois: number): string {
  const annee = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1 + mois;
  const jour = Number(iso.slice(8, 10));
  const dernier = new Date(Date.UTC(annee, m + 1, 0)).getUTCDate();
  return depuisUtc(Date.UTC(annee, m, Math.min(jour, dernier)));
}

/** Dimanche de Pâques (algorithme de Meeus/Jones/Butcher, calendrier grégorien). */
export function paques(annee: number): string {
  const a = annee % 19;
  const b = Math.floor(annee / 100);
  const c = annee % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return `${annee}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
}

/** Jours fériés légaux de France métropolitaine (Code du travail, art. L3133-1), date ISO → nom. */
export function joursFeries(annee: number): Map<string, string> {
  const p = paques(annee);
  const fixe = (mmjj: string) => `${annee}-${mmjj}`;
  return new Map([
    [fixe('01-01'), "Jour de l'an"],
    [ajouterJours(p, 1), 'Lundi de Pâques'],
    [fixe('05-01'), 'Fête du travail'],
    [fixe('05-08'), 'Victoire 1945'],
    [ajouterJours(p, 39), 'Ascension'],
    [ajouterJours(p, 50), 'Lundi de Pentecôte'],
    [fixe('07-14'), 'Fête nationale'],
    [fixe('08-15'), 'Assomption'],
    [fixe('11-01'), 'Toussaint'],
    [fixe('11-11'), 'Armistice 1918'],
    [fixe('12-25'), 'Noël'],
  ]);
}

const cacheFeries = new Map<number, Map<string, string>>();

/** Nom du jour férié, ou undefined. */
export function jourFerie(iso: string): string | undefined {
  const annee = Number(iso.slice(0, 4));
  let feries = cacheFeries.get(annee);
  if (!feries) {
    feries = joursFeries(annee);
    cacheFeries.set(annee, feries);
  }
  return feries.get(iso);
}

export function estJourOuvre(iso: string): boolean {
  const j = jourSemaine(iso);
  return j !== 0 && j !== 6 && jourFerie(iso) === undefined;
}
