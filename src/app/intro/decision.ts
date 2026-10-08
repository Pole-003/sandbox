export type ModeIntro = 'animee' | 'statique' | 'aucune';

export interface ContexteIntro {
  /** Date locale du jour, AAAA-MM-JJ. */
  aujourdhui: string;
  /** Date de la dernière lecture mémorisée, ou null. */
  derniereLecture: string | null;
  /** L'utilisateur a désactivé l'animation dans les paramètres. */
  desactivee: boolean;
  /** Le système demande de réduire les animations (prefers-reduced-motion). */
  reduireMouvement: boolean;
}

/** Une fois par jour et par navigateur ; version statique si le système demande de réduire les animations. */
export function deciderIntro({ aujourdhui, derniereLecture, desactivee, reduireMouvement }: ContexteIntro): ModeIntro {
  if (desactivee || derniereLecture === aujourdhui) return 'aucune';
  return reduireMouvement ? 'statique' : 'animee';
}

/** Date locale (et non UTC) au format AAAA-MM-JJ : « une fois par jour » suit le calendrier de l'utilisateur. */
export function dateLocaleIso(date: Date): string {
  const deuxChiffres = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${deuxChiffres(date.getMonth() + 1)}-${deuxChiffres(date.getDate())}`;
}
