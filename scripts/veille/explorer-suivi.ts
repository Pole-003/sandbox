/**
 * Exploration des sources possibles pour le suivi PLF / PLFSS : npm run veille:explorer-suivi
 *
 * Lecture seule, sans coût : pour chaque page candidate (dossiers législatifs de l'Assemblée et du Sénat),
 * affiche le statut, le titre, les flux RSS déclarés, le plan des titres et les lignes qui évoquent une
 * étape de la procédure (dépôt, lecture, CMP, Conseil constitutionnel, promulgation…). Sert à choisir
 * la méthode d'extraction avant d'écrire le collecteur.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decoderOctets, lireEncodageDeclare } from './encodage.ts';
import { decoderEntites } from './flux.ts';
import { ClientHttp } from './http.ts';

const ANNEE = 2027;

export const CANDIDATS = [
  { id: 'an-plf', url: `https://www.assemblee-nationale.fr/dyn/17/dossiers/PLF_${ANNEE}` },
  { id: 'an-plfss', url: `https://www.assemblee-nationale.fr/dyn/17/dossiers/PLFSS_${ANNEE}` },
  { id: 'senat-plf', url: `https://www.senat.fr/dossier-legislatif/pjlf${ANNEE}.html` },
  { id: 'senat-plfss', url: `https://www.senat.fr/dossier-legislatif/plfss${ANNEE}.html` },
];

const MOTS_ETAPES = /d[ée]p[ôo]t|lecture|commission mixte|cmp|conseil constitutionnel|promulg|adopt|rejet|nouvelle lecture|lecture d[ée]finitive|49[.,]3|saisine|d[ée]cision n°|journal officiel/i;

function texteLigne(html: string): string {
  return decoderEntites(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Extrait le HTML simplifié (balises gardées, attributs réduits à class) autour d'un repère, pour étudier la structure. */
export function extraitAutour(html: string, repere: RegExp, longueur = 6000): string | null {
  const corps = html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, '');
  const i = corps.search(repere);
  if (i < 0) return null;
  return corps
    .slice(i, i + longueur)
    .replace(/<([a-z0-9]+)\b([^>]*)>/gi, (_t, b: string, attrs: string) => {
      const classe = /class=["']([^"']*)["']/i.exec(attrs)?.[1];
      const lien = /href=["']([^"']*)["']/i.exec(attrs)?.[1];
      const date = /datetime=["']([^"']*)["']/i.exec(attrs)?.[1];
      return `<${b}${classe ? ` .${classe.trim().replace(/\s+/g, '.')}` : ''}${lien ? ` href=${lien}` : ''}${date ? ` datetime=${date}` : ''}>`;
    })
    .replace(/\s+/g, ' ');
}

export function analyserDossier(html: string): { titre: string | null; flux: string[]; plan: string[]; etapes: string[] } {
  const titre = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
  const flux = [...html.matchAll(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/gi)].map((m) => /href=["']([^"']+)["']/i.exec(m[0])?.[1] ?? m[0]);
  const fluxAncres = [...html.matchAll(/href=["']([^"']*(?:\.rss|\/rss[^"']*|feeds?\/[^"']*))["']/gi)].map((m) => m[1] ?? '');
  const plan = [...html.matchAll(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => `h${m[1]} ${texteLigne(m[2] ?? '')}`).filter((l) => l.length > 3);
  const corps = html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ');
  const blocs = corps.split(/<\/(?:li|p|div|tr|h[1-6]|dt|dd|span)>/i).map(texteLigne).filter((l) => l.length > 6 && l.length < 300);
  const etapes = [...new Set(blocs.filter((l) => MOTS_ETAPES.test(l)))];
  return { titre, flux: [...new Set([...flux, ...fluxAncres])], plan, etapes };
}

async function principal(): Promise<void> {
  const config = JSON.parse(readFileSync(new URL('../../veille/config.json', import.meta.url), 'utf8')) as { user_agent: string };
  const client = new ClientHttp({ userAgent: config.user_agent, delaiMaxMs: 20_000 });
  const rapport: string[] = ['## Exploration des sources du suivi PLF / PLFSS', ''];
  for (const c of CANDIDATS) {
    rapport.push(`### ${c.id} — ${c.url}`);
    try {
      const r = await client.recuperer(c.url);
      const texte = decoderOctets(r.octets, lireEncodageDeclare(r.octets, r.contentType)).texte;
      rapport.push(`- HTTP ${r.statut}, ${r.contentType ?? '?'}, ${r.octets.length} octets${r.urlFinale !== c.url ? `, redirigé vers ${r.urlFinale}` : ''}`);
      if (r.statut === 200) {
        const a = analyserDossier(texte);
        rapport.push(`- Titre : ${a.titre ?? '—'}`, `- Flux déclarés : ${a.flux.join(' · ') || 'aucun'}`, '- Plan :');
        rapport.push(...a.plan.slice(0, 40).map((l) => `  - ${l}`));
        rapport.push(`- Lignes évoquant une étape (${a.etapes.length}) :`);
        rapport.push(...a.etapes.slice(0, 60).map((l) => `  - ${l}`));
        const dates = [...new Set(texte.replace(/<[^>]+>/g, ' ').match(/\b\d{1,2}(?:er)?\s+(?:janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+\d{4}\b|\b\d{2}\/\d{2}\/\d{4}\b/gi) ?? [])];
        rapport.push(`- Dates trouvées dans la page : ${dates.slice(0, 30).join(' · ') || 'aucune'}`);
        const extrait = extraitAutour(texte, /[ÉE]tapes de lecture/);
        rapport.push('- Structure HTML autour de « Étapes de lecture » :', '```', extrait ?? '(repère absent)', '```');
      }
    } catch (e) {
      rapport.push(`- Échec : ${e instanceof Error ? e.message : String(e)}`);
    }
    rapport.push('');
  }
  const texte = rapport.join('\n');
  console.log(texte);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${texte}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  principal().catch((e: unknown) => {
    console.error('Exploration impossible :', e);
    process.exit(1);
  });
}
