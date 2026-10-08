/**
 * Tirage aléatoire reproductible (CLAUDE.md, règle n° 6).
 *
 * Générateur : mulberry32 (Tommy Ettinger, domaine public), état de 32 bits initialisé par la graine.
 * Même graine + même liste de candidats (triée par clé de tiers) = même tirage, sur tout navigateur.
 * Tirage : uniforme, sans remise (mélange de Fisher-Yates partiel).
 */

export function mulberry32(graine: number): () => number {
  let etat = graine >>> 0;
  return () => {
    etat = (etat + 0x6d2b79f5) >>> 0;
    let t = etat;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tire `n` éléments distincts, uniformément, dans l'ordre du tirage. */
export function tirageSansRemise<T>(candidats: readonly T[], n: number, graine: number): T[] {
  const aleatoire = mulberry32(graine);
  const copie = [...candidats];
  const nombre = Math.min(Math.max(0, Math.floor(n)), copie.length);
  for (let i = 0; i < nombre; i++) {
    const j = i + Math.floor(aleatoire() * (copie.length - i));
    [copie[i], copie[j]] = [copie[j]!, copie[i]!];
  }
  return copie.slice(0, nombre);
}

/** Graine proposée : entier de 32 bits tiré par le générateur cryptographique du navigateur. */
export function nouvelleGraine(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}
