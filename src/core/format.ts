/** Espace fine insécable (U+202F), séparateur de milliers de la typographie française. */
const ESPACE_FINE = ' ';

/**
 * Formate un montant exprimé en centimes entiers au format français : 123456 → « 1 234,56 ».
 * Aucun calcul flottant : la conversion se fait sur les chiffres.
 */
export function formaterMontant(centimes: number): string {
  if (!Number.isSafeInteger(centimes)) {
    throw new RangeError(`Montant invalide (centimes entiers attendus) : ${centimes}`);
  }
  const chiffres = Math.abs(centimes).toString().padStart(3, '0');
  const euros = chiffres.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ESPACE_FINE);
  const signe = centimes < 0 ? '-' : '';
  return `${signe}${euros},${chiffres.slice(-2)}`;
}

/** Convertit une date ISO « AAAA-MM-JJ » en affichage « JJ/MM/AAAA », après contrôle de validité. */
export function formaterDate(iso: string): string {
  const parties = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!parties) throw new RangeError(`Date ISO invalide : ${iso}`);
  const [, annee, mois, jour] = parties as unknown as [string, string, string, string];
  const date = new Date(Date.UTC(Number(annee), Number(mois) - 1, Number(jour)));
  if (date.getUTCMonth() !== Number(mois) - 1 || date.getUTCDate() !== Number(jour)) {
    throw new RangeError(`Date inexistante : ${iso}`);
  }
  return `${jour}/${mois}/${annee}`;
}
