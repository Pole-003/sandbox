/** Date du jour à Paris (AAAA-MM-JJ), quel que soit le fuseau du poste. */
const FORMAT_PARIS = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });

export function dateIsoParis(date: Date): string {
  return FORMAT_PARIS.format(date);
}
