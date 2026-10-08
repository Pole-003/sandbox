/**
 * Vérification du build de production (exécutée après `vite build`).
 *  - dist/index.html contient exactement la CSP de config/csp.ts, en tête de <head> ;
 *  - aucun script ni style en ligne (interdits par la CSP) ;
 *  - aucune URL absolue vers une autre origine dans les fichiers produits.
 *
 * Exception : les données de veille (news.json, veille-etat.json, archives/) contiennent par nature
 * les liens vers les sources. Ce sont des données, jamais exécutées ni chargées par le navigateur :
 * ces liens ne s'ouvrent que sur clic, dans un nouvel onglet (rel="noopener noreferrer").
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BALISE_CSP } from '../config/csp.ts';

export function verifierIndex(html: string): string[] {
  const erreurs: string[] = [];
  const occurrences = html.split('http-equiv="Content-Security-Policy"').length - 1;
  if (occurrences !== 1) erreurs.push(`CSP présente ${occurrences} fois (attendu : 1).`);
  if (!html.includes(BALISE_CSP)) erreurs.push('La CSP ne correspond pas exactement à config/csp.ts.');
  const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? '';
  const premiereBalise = /<(meta|link|script|style|title)\b[^>]*>/gi;
  const balises = [...head.matchAll(premiereBalise)].map((m) => m[0]);
  const indexCsp = balises.findIndex((b) => b.includes('Content-Security-Policy'));
  if (balises.slice(0, indexCsp).some((b) => /^<(script|link|style)/i.test(b))) {
    erreurs.push('La CSP doit précéder tout script et toute feuille de style.');
  }
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) erreurs.push('Script en ligne détecté.');
  if (/<style\b/i.test(html)) erreurs.push('Balise <style> en ligne détectée.');
  if (/\sstyle\s*=/i.test(html)) erreurs.push('Attribut style= en ligne détecté.');
  return erreurs;
}

/** Les URL tolérées dans le code tiers compilé : espaces de noms XML (identifiants, jamais chargés). */
const URL_TOLEREES = /^https?:\/\/www\.w3\.org\//;
/**
 * Espaces de noms du format Office Open XML (.xlsx) écrits dans les fichiers générés par ExcelJS :
 * de simples identifiants, jamais chargés.
 */
const ESPACES_DE_NOMS_OOXML = /^http:\/\/(schemas\.openxmlformats\.org|schemas\.microsoft\.com\/office|purl\.org\/dc)\//;

export function verifierUrls(fichier: string, contenu: string, urlsAutorisees: string[]): string[] {
  return [...contenu.matchAll(/\b(?:https?|wss?):\/\/[^\s'"`<>)\\]+/gi)]
    .map((m) => m[0])
    .filter((url) => !URL_TOLEREES.test(url) && !ESPACES_DE_NOMS_OOXML.test(url) && !urlsAutorisees.includes(url))
    .map((url) => `${fichier} : URL externe ${url}`);
}

/** Fichiers de données de veille publiés avec le site (chemin relatif à dist/). */
export function estDonneeVeille(cheminDansDist: string): boolean {
  const chemin = cheminDansDist.split('\\').join('/');
  return chemin === 'news.json' || chemin === 'veille-etat.json' || /^archives\/\d{4}-\d{2}\.json$/.test(chemin);
}

function lister(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    return statSync(chemin).isDirectory() ? lister(chemin) : [chemin];
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const racine = fileURLToPath(new URL('..', import.meta.url));
  const dist = join(racine, 'dist');
  const { urls, urlsCodeTiers } = JSON.parse(readFileSync(join(racine, 'scripts/securite-liste-blanche.json'), 'utf8')) as {
    urls: string[];
    urlsCodeTiers?: string[];
  };
  const erreurs = verifierIndex(readFileSync(join(dist, 'index.html'), 'utf8'));
  for (const chemin of lister(dist)) {
    if (!/\.(html|js|css|json|svg)$/.test(chemin) || estDonneeVeille(relative(dist, chemin))) continue;
    erreurs.push(...verifierUrls(relative(racine, chemin), readFileSync(chemin, 'utf8'), [...urls, ...(urlsCodeTiers ?? [])]));
  }
  if (erreurs.length > 0) {
    console.error(`Vérification du build ÉCHEC :\n  ${erreurs.join('\n  ')}`);
    process.exit(1);
  }
  console.log('Vérification du build OK : CSP présente et exacte, aucune ressource en ligne ni URL externe.');
}
