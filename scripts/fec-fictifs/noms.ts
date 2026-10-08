/**
 * Noms de tiers fictifs, construits par combinaison. Toute ressemblance avec une entreprise existante
 * serait fortuite. Les accents, « œ » et « € » sont volontaires : ils servent à tester les encodages
 * (ces caractères existent en ISO-8859-15 et en Windows-1252, à des positions différentes).
 */
import type { Alea } from './alea.ts';

const FORMES = ['SARL', 'SAS', 'SA', 'EURL', 'SNC'];
const DEBUTS = [
  'Comptoir',
  'Établissements',
  'Maison',
  'Atelier',
  'Société',
  'Boutique',
  'Entrepôts',
  'Négoce',
  'Distribution',
  'Coopérative',
  'Cœur de',
  'Galerie',
];
const FINS = [
  'des Lilas',
  'du Vieux Port',
  'Bellerive',
  'des Trois Chênes',
  'Saint-Aubert',
  'de la Forêt',
  'des Écluses',
  'Montclair',
  'du Moulin',
  'Pré-Vert',
  'des Cévennes',
  'Bœuf & Cie',
  'Rivière',
  'des Hêtres',
  'Lafontaine',
  'Mirabeau',
  'du Littoral',
  "de l'Étang",
  'Valmont',
  'Côte Sauvage',
  'Grand Large',
  'Haute Vallée',
];

/** Nom unique : « Comptoir des Lilas SARL » ; un suffixe numérique départage les doublons. */
export function genererNoms(alea: Alea, nombre: number): string[] {
  const vus = new Map<string, number>();
  const noms: string[] = [];
  for (let i = 0; i < nombre; i++) {
    const base = `${alea.choix(DEBUTS)} ${alea.choix(FINS)}`;
    const rang = (vus.get(base) ?? 0) + 1;
    vus.set(base, rang);
    noms.push(`${base}${rang > 1 ? ` ${rang}` : ''} ${alea.choix(FORMES)}`);
  }
  return noms;
}

/**
 * Code de tiers intégré au numéro de compte, à la manière des logiciels sans auxiliaires (« 411ELITTORAL ») :
 * initiale du premier mot puis mots significatifs, sans accents ; unicité garantie par un suffixe numérique.
 */
export function fabriqueCodesTiers(longueur = 10): (nom: string) => string {
  const vus = new Map<string, number>();
  return (nom) => {
    const mots = nom
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/œ/gi, 'OE')
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter((m) => m && !['SARL', 'SAS', 'SA', 'EURL', 'SNC', 'DE', 'DES', 'DU', 'LA', 'LE', 'L', 'CIE'].includes(m));
    const base = `${mots[0]?.[0] ?? 'X'}${mots.slice(1).join('')}`.slice(0, longueur);
    const rang = (vus.get(base) ?? 0) + 1;
    vus.set(base, rang);
    return rang > 1 ? `${base.slice(0, longueur - 1)}${rang}` : base;
  };
}
