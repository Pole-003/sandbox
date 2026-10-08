/**
 * Lecture d'un FEC « à plat » : découpage en lignes (CR, LF ou CRLF, y compris à cheval sur deux
 * morceaux), détection du séparateur et des guillemets, découpage des zones.
 */

export type Separateur = '\t' | '|' | ';' | ',';

export const LIBELLES_SEPARATEUR: Record<Separateur, string> = {
  '\t': 'tabulation',
  '|': 'barre verticale « | »',
  ';': 'point-virgule',
  ',': 'virgule',
};

export type FinLigne = 'CRLF' | 'LF' | 'CR' | 'mixte' | 'aucune';

/** Découpe un texte arrivant par morceaux en lignes complètes. */
export class DecoupeurLignes {
  private reste = '';

  pousser(texte: string, final = false): string[] {
    let t = this.reste + texte;
    this.reste = '';
    if (!final && t.endsWith('\r')) {
      // Le \n d'un CRLF peut arriver dans le morceau suivant.
      this.reste = '\r';
      t = t.slice(0, -1);
    }
    const lignes = t.split(/\r\n|\r|\n/);
    const derniere = lignes.pop()!;
    if (final) {
      if (derniere !== '') lignes.push(derniere);
    } else {
      this.reste = derniere + this.reste;
    }
    return lignes;
  }
}

export function detecterFinLigne(texte: string): FinLigne {
  const crlf = (texte.match(/\r\n/g) ?? []).length;
  const cr = (texte.match(/\r(?!\n)/g) ?? []).length;
  const lf = (texte.match(/(?<!\r)\n/g) ?? []).length;
  const types = [crlf && 'CRLF', cr && 'CR', lf && 'LF'].filter(Boolean) as FinLigne[];
  if (types.length === 0) return 'aucune';
  return types.length > 1 ? 'mixte' : types[0]!;
}

/** Découpe une ligne avec gestion des guillemets (« "a;b";"c""d" » → [a;b, c"d]). */
export function decouperAvecGuillemets(ligne: string, sep: string): string[] {
  const champs: string[] = [];
  let i = 0;
  const n = ligne.length;
  for (;;) {
    while (i < n && ligne[i] === ' ') i++;
    if (ligne[i] === '"') {
      let valeur = '';
      i++;
      for (;;) {
        const fin = ligne.indexOf('"', i);
        if (fin < 0) {
          valeur += ligne.slice(i);
          i = n;
          break;
        }
        valeur += ligne.slice(i, fin);
        if (ligne[fin + 1] === '"') {
          valeur += '"';
          i = fin + 2;
        } else {
          i = fin + 1;
          break;
        }
      }
      const suite = ligne.indexOf(sep, i);
      champs.push(valeur.trim());
      if (suite < 0) return champs;
      i = suite + sep.length;
    } else {
      const suite = ligne.indexOf(sep, i);
      if (suite < 0) {
        champs.push(ligne.slice(i).trim());
        return champs;
      }
      champs.push(ligne.slice(i, suite).trim());
      i = suite + sep.length;
    }
  }
}

export function decouper(ligne: string, sep: string, guillemets: boolean): string[] {
  if (guillemets) return decouperAvecGuillemets(ligne, sep);
  const champs = ligne.split(sep);
  for (let i = 0; i < champs.length; i++) champs[i] = champs[i]!.trim();
  return champs;
}

export interface DetectionStructure {
  separateur: Separateur;
  guillemets: boolean;
  /** Nombre de zones de la première ligne. */
  nbZones: number;
  /** Proportion des lignes de l'échantillon ayant ce nombre de zones. */
  regularite: number;
}

/**
 * Séparateur : celui qui donne, sur les 50 premières lignes, un nombre de zones ≥ 9 identique à la
 * première ligne pour le plus de lignes (priorité tabulation, |, ;, virgule à score égal).
 */
export function detecterStructure(lignes: string[]): DetectionStructure | null {
  const echantillon = lignes.filter((l) => l.trim() !== '').slice(0, 50);
  if (echantillon.length === 0) return null;
  const guillemets =
    echantillon.slice(0, 10).filter((l) => /^\s*"/.test(l) && /"\s*$/.test(l)).length >= Math.ceil(Math.min(10, echantillon.length) / 2);
  let meilleur: DetectionStructure | null = null;
  for (const sep of ['\t', '|', ';', ','] as Separateur[]) {
    const comptes = echantillon.map((l) => decouper(l, sep, guillemets).length);
    const nbZones = comptes[0]!;
    if (nbZones < 9) continue;
    const regularite = comptes.filter((c) => c === nbZones).length / comptes.length;
    if (!meilleur || regularite > meilleur.regularite + 1e-9) meilleur = { separateur: sep, guillemets, nbZones, regularite };
  }
  return meilleur;
}
