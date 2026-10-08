/** Extrait l'identifiant d'écran d'une ancre « #/fec » ; repli sur l'écran par défaut si inconnu. */
export function resoudreRoute(ancre: string, idsValides: readonly string[], defaut: string): string {
  const id = ancre.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  return idsValides.includes(id) ? id : defaut;
}

export function lienVers(id: string): string {
  return `#/${id}`;
}
