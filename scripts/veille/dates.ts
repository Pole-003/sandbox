/**
 * Lecture tolérante des dates de flux (docs/VEILLE.md).
 *
 * Formats acceptés :
 *  - ISO 8601 (Atom) : 2026-10-07, 2026-10-07T08:30:00+02:00 ;
 *  - RFC 822 (RSS), y compris sans espace après la virgule (Sénat : « Wed,07 Oct 2026 ») ;
 *  - date française dans un texte : « publié le 07/10/2026 », « 7 octobre 2026 ».
 */

const MOIS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  janv: 1, fevr: 2, fev: 2, mars: 3, avr: 4, mai: 5, juin: 6, juil: 7, aout: 8, sept: 9,
  janvier: 1, fevrier: 2, avril: 4, juillet: 7, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
};

const FUSEAUX: Record<string, string> = {
  UT: '+0000', UTC: '+0000', GMT: '+0000', Z: '+0000',
  CET: '+0100', CEST: '+0200', EST: '-0500', EDT: '-0400', PST: '-0800', PDT: '-0700',
};

function sansAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function construire(annee: number, mois: number, jour: number, h = 0, mi = 0, s = 0, decalage = '+0000'): Date | null {
  if (annee < 100) annee += 2000;
  if (mois < 1 || mois > 12 || jour < 1 || jour > 31 || h > 23 || mi > 59 || s > 60) return null;
  const signe = decalage.startsWith('-') ? -1 : 1;
  const minutes = signe * (Number(decalage.slice(1, 3)) * 60 + Number(decalage.slice(3, 5)));
  const date = new Date(Date.UTC(annee, mois - 1, jour, h, mi, s) - minutes * 60_000);
  // Rejette les dates impossibles (31 février…).
  return new Date(Date.UTC(annee, mois - 1, jour)).getUTCDate() === jour ? date : null;
}

/** Analyse une valeur de date de flux. Renvoie null si elle est illisible. */
export function lireDate(valeur: string | null | undefined): Date | null {
  if (!valeur) return null;
  const v = valeur.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?)?/.exec(v);
  if (iso) {
    const [, a, mo, j, h, mi, s, tz] = iso;
    const decalage = !tz || tz === 'Z' ? '+0000' : tz.replace(':', '');
    return construire(Number(a), Number(mo), Number(j), Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0), decalage);
  }

  const rfc = /^(?:[a-zé]+\.?,?\s*)?(\d{1,2})\s+([a-zéû]+)\.?\s+(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*([+-]\d{4}|[a-z]{1,4})?/i.exec(
    v.replace(/,(?=\S)/, ', '),
  );
  if (rfc) {
    const [, j, nomMois, a, h, mi, s, tz] = rfc;
    const mois = MOIS[sansAccents(nomMois ?? '')] ?? MOIS[sansAccents(nomMois ?? '').slice(0, 3)];
    if (!mois) return null;
    const decalage = tz ? (/^[+-]/.test(tz) ? tz : FUSEAUX[tz.toUpperCase()] ?? '+0000') : '+0000';
    return construire(Number(a), mois, Number(j), Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0), decalage);
  }

  return extraireDateDuTexte(v);
}

/** Cherche une date française dans un texte libre (description BOFiP : « publié le 07/10/2026 »). */
export function extraireDateDuTexte(texte: string): Date | null {
  const numerique = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(texte);
  if (numerique) return construire(Number(numerique[3]), Number(numerique[2]), Number(numerique[1]), 12);
  const litterale = /\b(\d{1,2})(?:er)?\s+([a-zéû]+)\s+(\d{4})\b/i.exec(texte);
  if (litterale) {
    const mois = MOIS[sansAccents(litterale[2] ?? '')];
    if (mois) return construire(Number(litterale[3]), mois, Number(litterale[1]), 12);
  }
  return null;
}

const FORMAT_PARIS = new Intl.DateTimeFormat('fr-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** Date ISO AAAA-MM-JJ, à l'heure de Paris. */
export function dateIsoParis(date: Date): string {
  return FORMAT_PARIS.format(date);
}
