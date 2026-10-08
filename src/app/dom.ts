type Attributs = Record<string, string | boolean | undefined>;
type Enfant = Node | string | null | undefined | false;

/** Crée un élément sans passer par innerHTML (aucun risque d'injection de balisage). */
export function h<K extends keyof HTMLElementTagNameMap>(
  balise: K,
  attributs: Attributs = {},
  ...enfants: Enfant[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(balise);
  for (const [nom, valeur] of Object.entries(attributs)) {
    if (valeur === undefined || valeur === false) continue;
    element.setAttribute(nom, valeur === true ? '' : valeur);
  }
  for (const enfant of enfants) {
    if (enfant === null || enfant === undefined || enfant === false) continue;
    element.append(enfant);
  }
  return element;
}
