/**
 * Préfixes de stockage local (CLAUDE.md, règle n° 5).
 * La bêta est servie sur la même origine que la production : elle utilise un préfixe distinct
 * pour qu'une migration de structure testée en bêta ne puisse pas altérer les dossiers de production.
 */
export const PREFIXE_STOCKAGE = __CANAL__ === 'beta' ? 'pole003-sandbox-beta-' : 'pole003-sandbox-';

export function cleStockage(nom: string): string {
  return PREFIXE_STOCKAGE + nom;
}

/** Lit une préférence d'interface (localStorage peut être indisponible : navigation privée, stratégie d'entreprise). */
export function lirePreference(nom: string): string | null {
  try {
    return localStorage.getItem(cleStockage(nom));
  } catch {
    return null;
  }
}

export function ecrirePreference(nom: string, valeur: string | null): void {
  try {
    if (valeur === null) localStorage.removeItem(cleStockage(nom));
    else localStorage.setItem(cleStockage(nom), valeur);
  } catch {
    // Préférence non mémorisée : sans conséquence sur le fonctionnement.
  }
}
