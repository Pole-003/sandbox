/**
 * Contrôle de sécurité statique (CLAUDE.md, règles n° 1 et 2).
 *
 * Analyse src/ et index.html à la recherche :
 *  - d'URL absolues (http, https, ws, wss, //domaine) hors liste blanche ;
 *  - d'API réseau ou de vecteurs d'exfiltration interdits ;
 *  - d'appels fetch() hors des fichiers explicitement autorisés.
 *
 * Usage : node scripts/check-securite.ts   (code de sortie 1 si une violation est trouvée)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ListeBlanche {
  urls: string[];
  fichiersFetch: string[];
}

export interface Violation {
  fichier: string;
  ligne: number;
  regle: string;
  extrait: string;
}

/** Espaces de noms XML : identifiants, jamais chargés par le navigateur. */
const ESPACES_DE_NOMS = [/^http:\/\/www\.w3\.org\/\d{4}\//];

const MOTIFS_INTERDITS: { regle: string; motif: RegExp }[] = [
  { regle: 'XMLHttpRequest interdit', motif: /\bXMLHttpRequest\b/ },
  { regle: 'WebSocket interdit', motif: /\bWebSocket\b/ },
  { regle: 'WebTransport interdit', motif: /\bWebTransport\b/ },
  { regle: 'EventSource interdit', motif: /\bEventSource\b/ },
  { regle: 'sendBeacon interdit', motif: /\bsendBeacon\b/ },
  { regle: 'RTCPeerConnection interdit', motif: /\bRTCPeerConnection\b/ },
  { regle: 'importScripts interdit', motif: /\bimportScripts\s*\(/ },
  { regle: 'window.open interdit (utiliser un lien rel="noopener noreferrer")', motif: /\bwindow\.open\s*\(/ },
  { regle: 'new Image() interdit', motif: /\bnew\s+Image\s*\(/ },
  { regle: '<iframe> interdit', motif: /<iframe\b|createElement\(\s*['"`]iframe['"`]/i },
  { regle: '<form> interdit', motif: /<form\b|createElement\(\s*['"`]form['"`]/i },
  { regle: '<script> dynamique interdit', motif: /createElement\(\s*['"`]script['"`]/i },
  { regle: 'formaction interdit', motif: /\bformaction\b/i },
];

const MOTIF_URL = /\b(?:https?|wss?|ftp):\/\/[^\s'"`<>)\]]+/gi;
/** URL relative au protocole dans une chaîne ou un url() CSS : '//cdn.exemple.com/…' */
const MOTIF_URL_SANS_PROTOCOLE = /(?<=['"`(]|=\s*)\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/:?#][^\s'"`)]*)?/gi;
const MOTIF_FETCH = /\bfetch\s*\(/;
/** Seuls fichiers que le code applicatif peut charger (CLAUDE.md, règle n° 1). */
const FICHIERS_CHARGEABLES = new Set(['news.json', 'veille-etat.json', 'marches.json']);
const MOTIF_NOM_JSON = /['"`]([\w.-]+\.json)['"`]/g;

const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.html', '.json', '.svg']);

function normaliser(chemin: string): string {
  return chemin.split(sep).join('/');
}

/** Analyse le contenu d'un fichier et renvoie les violations trouvées. */
export function analyserContenu(fichier: string, contenu: string, listeBlanche: ListeBlanche): Violation[] {
  const violations: Violation[] = [];
  const fetchAutorise = listeBlanche.fichiersFetch.includes(fichier);
  const lignes = contenu.split(/\r\n|\r|\n/);

  lignes.forEach((texte, index) => {
    const ligne = index + 1;
    const extrait = texte.trim().slice(0, 160);
    const signaler = (regle: string) => violations.push({ fichier, ligne, regle, extrait });

    for (const correspondance of texte.matchAll(MOTIF_URL)) {
      const url = correspondance[0].replace(/[.,;]+$/, '');
      if (ESPACES_DE_NOMS.some((m) => m.test(url))) continue;
      if (listeBlanche.urls.includes(url)) continue;
      signaler(`URL externe non autorisée : ${url}`);
    }
    for (const correspondance of texte.matchAll(MOTIF_URL_SANS_PROTOCOLE)) {
      signaler(`URL externe sans protocole : ${correspondance[0]}`);
    }
    for (const { regle, motif } of MOTIFS_INTERDITS) {
      if (motif.test(texte)) signaler(regle);
    }
    if (MOTIF_FETCH.test(texte) && !fetchAutorise) {
      signaler('fetch() interdit hors des fichiers autorisés (seuls news.json, veille-etat.json et marches.json peuvent être chargés)');
    }
    if (fetchAutorise) {
      // Même dans un fichier autorisé : même origine (base du site), sans paramètre de requête.
      const appel = texte.slice(texte.search(MOTIF_FETCH));
      if (MOTIF_FETCH.test(texte) && (!appel.includes('import.meta.env.BASE_URL') || appel.includes('?'))) {
        signaler('fetch() doit viser la base du site (import.meta.env.BASE_URL), sans paramètre de requête');
      }
      for (const [, nom] of texte.matchAll(MOTIF_NOM_JSON)) {
        if (nom && !FICHIERS_CHARGEABLES.has(nom)) signaler(`fichier ${nom} non autorisé (seuls news.json, veille-etat.json et marches.json)`);
      }
    }
  });
  return violations;
}

function listerFichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return listerFichiers(chemin);
    const extension = nom.slice(nom.lastIndexOf('.'));
    return EXTENSIONS.has(extension) ? [chemin] : [];
  });
}

export function analyserProjet(racine: string): Violation[] {
  const listeBlanche = JSON.parse(
    readFileSync(join(racine, 'scripts/securite-liste-blanche.json'), 'utf8'),
  ) as ListeBlanche;
  const fichiers = [...listerFichiers(join(racine, 'src')), join(racine, 'index.html')];
  return fichiers.flatMap((chemin) =>
    analyserContenu(normaliser(relative(racine, chemin)), readFileSync(chemin, 'utf8'), listeBlanche),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const racine = fileURLToPath(new URL('..', import.meta.url));
  const violations = analyserProjet(racine);
  if (violations.length === 0) {
    console.log('check:securite OK : aucune URL externe ni API réseau interdite dans src/ et index.html.');
  } else {
    console.error(`check:securite ÉCHEC : ${violations.length} violation(s)\n`);
    for (const v of violations) console.error(`  ${v.fichier}:${v.ligne}  ${v.regle}\n      ${v.extrait}`);
    process.exit(1);
  }
}
