/**
 * Interprétation de robots.txt (RFC 9309), pour ne jamais contourner une interdiction.
 *
 * Groupe retenu : celui dont la ligne User-agent correspond à notre robot (« pole003-veille »),
 * sinon le groupe « * ». Règle la plus longue gagnante, Allow l'emporte à longueur égale.
 */

interface Regle {
  autorise: boolean;
  motif: string;
}

interface Groupe {
  agents: string[];
  regles: Regle[];
}

export interface Robots {
  groupes: Groupe[];
}

export function analyserRobots(texte: string): Robots {
  const groupes: Groupe[] = [];
  let courant: Groupe | null = null;
  let dernierEtaitAgent = false;

  for (const brute of texte.split(/\r\n|\r|\n/)) {
    const ligne = brute.replace(/#.*$/, '').trim();
    const separateur = ligne.indexOf(':');
    if (separateur < 0) continue;
    const cle = ligne.slice(0, separateur).trim().toLowerCase();
    const valeur = ligne.slice(separateur + 1).trim();

    if (cle === 'user-agent') {
      if (!courant || !dernierEtaitAgent) {
        courant = { agents: [], regles: [] };
        groupes.push(courant);
      }
      courant.agents.push(valeur.toLowerCase());
      dernierEtaitAgent = true;
    } else if ((cle === 'allow' || cle === 'disallow') && courant) {
      // « Disallow: » vide signifie « tout est permis » : aucune règle à ajouter.
      if (valeur !== '') courant.regles.push({ autorise: cle === 'allow', motif: valeur });
      dernierEtaitAgent = false;
    } else {
      dernierEtaitAgent = false;
    }
  }
  return { groupes };
}

function correspond(motif: string, chemin: string): boolean {
  const ancre = motif.endsWith('$');
  const corps = (ancre ? motif.slice(0, -1) : motif)
    .split('*')
    .map((morceau) => morceau.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${corps}${ancre ? '$' : ''}`).test(chemin);
}

/** Vrai si le robot `userAgent` (ex. « Pole003-Veille/1.0 (…) ») peut lire `chemin` (chemin + requête). */
export function estAutorise(robots: Robots, userAgent: string, chemin: string): boolean {
  const jeton = (userAgent.split('/')[0] ?? '').trim().toLowerCase();
  const groupe =
    robots.groupes.find((g) => g.agents.includes(jeton)) ??
    robots.groupes.find((g) => g.agents.includes('*'));
  if (!groupe) return true;

  let meilleure: Regle | null = null;
  for (const regle of groupe.regles) {
    if (!correspond(regle.motif, chemin)) continue;
    if (
      !meilleure ||
      regle.motif.length > meilleure.motif.length ||
      (regle.motif.length === meilleure.motif.length && regle.autorise)
    ) {
      meilleure = regle;
    }
  }
  return meilleure?.autorise ?? true;
}
