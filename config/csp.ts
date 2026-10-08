/**
 * Content-Security-Policy de production (règle n° 3 de CLAUDE.md).
 * Toute modification de cette valeur doit être signalée explicitement à l'utilisateur.
 */
export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; form-action 'none'; base-uri 'none'; object-src 'none'";

export const BALISE_CSP = `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`;

/** Insère la balise CSP en tête de <head> (juste après <meta charset> s'il existe), avant tout script ou feuille de style. */
export function injecterCsp(html: string): string {
  if (html.includes('http-equiv="Content-Security-Policy"')) {
    throw new Error('index.html contient déjà une CSP : elle doit être injectée uniquement par le build.');
  }
  const ouverture = /<head[^>]*>(\s*<meta charset=[^>]*>)?/i.exec(html);
  if (!ouverture) throw new Error('Balise <head> introuvable dans index.html.');
  const fin = ouverture.index + ouverture[0].length;
  return `${html.slice(0, fin)}\n    ${BALISE_CSP}${html.slice(fin)}`;
}
