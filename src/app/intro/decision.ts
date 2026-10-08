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

/** Une fois par jour et par navigateur ; jamais si l'utilisateur ou le système demande de s'en passer. */
export function doitJouerIntro({ aujourdhui, derniereLecture, desactivee, reduireMouvement }: ContexteIntro): boolean {
  return !desactivee && !reduireMouvement && derniereLecture !== aujourdhui;
}

/** Date locale (et non UTC) au format AAAA-MM-JJ : « une fois par jour » suit le calendrier de l'utilisateur. */
export function dateLocaleIso(date: Date): string {
  const deuxChiffres = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${deuxChiffres(date.getMonth() + 1)}-${deuxChiffres(date.getDate())}`;
}

export interface PointDeVol {
  x: number;
  y: number;
  /** Rotation en degrés ; 0 = nez vers le haut. */
  angle: number;
}

/**
 * Trajectoire de la fusée : courbe de Bézier quadratique du bas-gauche au haut-droit de l'écran,
 * départ et arrivée hors champ, nez orienté selon la tangente.
 * Les coordonnées sont celles du centre de la fusée, en pixels de la fenêtre.
 */
export function calculerTrajectoire(largeur: number, hauteur: number, marge = 80, etapes = 12): PointDeVol[] {
  const depart = { x: -marge, y: hauteur * 0.85 };
  const controle = { x: largeur * 0.45, y: hauteur * 0.15 };
  const arrivee = { x: largeur + marge, y: hauteur * 0.05 };
  return Array.from({ length: etapes + 1 }, (_, i) => {
    const t = i / etapes;
    const u = 1 - t;
    const x = u * u * depart.x + 2 * u * t * controle.x + t * t * arrivee.x;
    const y = u * u * depart.y + 2 * u * t * controle.y + t * t * arrivee.y;
    const dx = 2 * u * (controle.x - depart.x) + 2 * t * (arrivee.x - controle.x);
    const dy = 2 * u * (controle.y - depart.y) + 2 * t * (arrivee.y - controle.y);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    return { x, y, angle };
  });
}
