/**
 * Générateur pseudo-aléatoire à graine (mulberry32) : même graine = mêmes FEC fictifs, octet pour octet.
 * Réservé aux scripts de génération ; la sélection d'échantillons de l'application aura son propre module.
 */
export class Alea {
  private etat: number;

  constructor(graine: number) {
    this.etat = graine >>> 0;
  }

  /** Nombre dans [0, 1[. */
  suivant(): number {
    this.etat = (this.etat + 0x6d2b79f5) >>> 0;
    let t = this.etat;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Entier dans [min, max] (bornes incluses). */
  entier(min: number, max: number): number {
    return min + Math.floor(this.suivant() * (max - min + 1));
  }

  probabilite(p: number): boolean {
    return this.suivant() < p;
  }

  choix<T>(liste: readonly T[]): T {
    const element = liste[Math.floor(this.suivant() * liste.length)];
    if (element === undefined) throw new Error('Liste vide');
    return element;
  }

  /** Choix pondéré : renvoie l'indice tiré. */
  indicePondere(poidsCumules: readonly number[]): number {
    const total = poidsCumules[poidsCumules.length - 1] ?? 0;
    const cible = this.suivant() * total;
    let bas = 0;
    let haut = poidsCumules.length - 1;
    while (bas < haut) {
      const milieu = (bas + haut) >> 1;
      if ((poidsCumules[milieu] ?? 0) > cible) haut = milieu;
      else bas = milieu + 1;
    }
    return bas;
  }

  /**
   * Montant en centimes, distribution log-uniforme entre min et max (centimes).
   * Une telle distribution respecte naturellement la loi de Benford sur le premier chiffre.
   */
  montantLog(min: number, max: number): number {
    const u = this.suivant();
    return Math.round(Math.exp(Math.log(min) + u * (Math.log(max) - Math.log(min))));
  }
}
