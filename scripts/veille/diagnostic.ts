/**
 * Diagnostic des sources de veille : npm run veille:test
 *
 * Pour chaque source « rss » et « page » de veille/sources.json : statut HTTP, type de contenu,
 * encodage déclaré et réel, nombre d'éléments, date du plus récent, temps de réponse, erreur.
 * Ne publie rien et ne modifie aucun fichier : le rapport est affiché (et ajouté au résumé
 * de l'exécution GitHub Actions si GITHUB_STEP_SUMMARY est défini).
 *
 * Une source en échec n'interrompt jamais le diagnostic des autres.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { analyserFlux, analyserPage } from './analyse.ts';
import { dateIsoParis } from './dates.ts';
import { decoderOctets, lireEncodageDeclare, type EncodageDeclare } from './encodage.ts';
import { ClientHttp, ErreurCollecte } from './http.ts';

export interface Source {
  id: string;
  nom: string;
  type: 'rss' | 'page' | 'api';
  url?: string;
  theme: string;
  statut: string;
  notes?: string;
}

export type Verdict = 'ok' | 'a_surveiller' | 'echec';

export interface ResultatDiagnostic {
  id: string;
  nom: string;
  type: Source['type'];
  url: string;
  urlFinale: string | null;
  verdict: Verdict;
  http: number | null;
  contentType: string | null;
  encodageDeclare: EncodageDeclare | null;
  encodageReel: string | null;
  ascii: boolean;
  elements: number | null;
  sansDate: number | null;
  dateDansDescription: number | null;
  plusRecent: string | null;
  dureeMs: number | null;
  empreinte: string | null;
  message: string | null;
}

/** Au-delà, un flux qui répond mais ne publie plus rien est signalé. */
const JOURS_SANS_PUBLICATION = 45;

export async function diagnostiquerSource(client: ClientHttp, source: Source, maintenant = new Date()): Promise<ResultatDiagnostic> {
  const base: ResultatDiagnostic = {
    id: source.id, nom: source.nom, type: source.type, url: source.url ?? '', urlFinale: null,
    verdict: 'echec', http: null, contentType: null, encodageDeclare: null, encodageReel: null, ascii: false,
    elements: null, sansDate: null, dateDansDescription: null, plusRecent: null, dureeMs: null, empreinte: null, message: null,
  };
  if (!source.url) return { ...base, message: 'aucune URL dans le catalogue' };

  try {
    const reponse = await client.recuperer(source.url);
    const declare = lireEncodageDeclare(reponse.octets, reponse.contentType);
    const decode = decoderOctets(reponse.octets, declare);
    const r: ResultatDiagnostic = {
      ...base,
      urlFinale: reponse.urlFinale !== source.url ? reponse.urlFinale : null,
      http: reponse.statut,
      contentType: reponse.contentType?.split(';')[0]?.trim() ?? null,
      encodageDeclare: declare,
      encodageReel: decode.encodage,
      ascii: decode.ascii,
      dureeMs: reponse.dureeMs,
    };
    if (reponse.statut < 200 || reponse.statut >= 300) return { ...r, message: `HTTP ${reponse.statut}` };

    if (source.type === 'page') {
      const page = analyserPage(decode.texte);
      return { ...r, verdict: page.remarque ? 'a_surveiller' : 'ok', empreinte: page.empreinte, message: page.remarque ?? page.titre };
    }

    const flux = analyserFlux(decode.texte);
    const avecFlux = {
      ...r,
      elements: flux.format ? flux.elements : null,
      sansDate: flux.format ? flux.sansDate : null,
      dateDansDescription: flux.format ? flux.dateDansDescription : null,
      plusRecent: flux.plusRecent ? dateIsoParis(flux.plusRecent) : null,
    };
    if (!flux.format) return { ...avecFlux, message: flux.remarque };
    if (flux.elements === 0) return { ...avecFlux, message: 'flux valide mais vide' };

    const remarques: string[] = [];
    if (flux.sansDate === flux.elements) remarques.push('aucune date lisible');
    else if (flux.sansDate > 0) remarques.push(`${flux.sansDate} élément(s) sans date`);
    if (flux.dateDansDescription > 0) remarques.push(`${flux.dateDansDescription} date(s) lue(s) dans la description`);
    const ageJours = flux.plusRecent ? (maintenant.getTime() - flux.plusRecent.getTime()) / 86_400_000 : null;
    if (ageJours !== null && ageJours > JOURS_SANS_PUBLICATION) remarques.push(`rien de publié depuis ${Math.floor(ageJours)} jours`);

    const aSurveiller = flux.sansDate === flux.elements || (ageJours !== null && ageJours > JOURS_SANS_PUBLICATION);
    return { ...avecFlux, verdict: aSurveiller ? 'a_surveiller' : 'ok', message: remarques.join(' ; ') || null };
  } catch (e) {
    const message = e instanceof ErreurCollecte ? e.message : `erreur inattendue : ${e instanceof Error ? e.message : String(e)}`;
    return { ...base, message };
  }
}

const SYMBOLES: Record<Verdict, string> = { ok: '✅ OK', a_surveiller: '🟡 À surveiller', echec: '🔴 Échec' };

function formaterDeclare(d: EncodageDeclare | null): string {
  if (!d || (!d.entete && !d.document)) return '—';
  if (d.entete && d.document && d.entete !== d.document) return `en-tête ${d.entete} · document ${d.document}`;
  return (d.document ?? d.entete) as string;
}

function formaterReel(r: ResultatDiagnostic): string {
  if (!r.encodageReel) return '—';
  if (r.ascii) return 'ascii (neutre)';
  const declare = r.encodageDeclare?.document ?? r.encodageDeclare?.entete;
  return declare && declare !== r.encodageReel ? `${r.encodageReel} ⚠ différent` : r.encodageReel;
}

function cellule(valeur: string | number | null | undefined): string {
  if (valeur === null || valeur === undefined || valeur === '') return '—';
  return String(valeur).replace(/\|/g, '\\|').replace(/\s+/g, ' ');
}

export function rapportMarkdown(resultats: ResultatDiagnostic[], horodatage: Date): string {
  const lignes = [
    `## Diagnostic des sources de veille — ${horodatage.toISOString()}`,
    '',
    '| Source | Type | Résultat | HTTP | Contenu | Encodage déclaré | Encodage réel | Éléments | Plus récent | Temps | Détail |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of resultats) {
    const temps = r.dureeMs === null ? null : `${(r.dureeMs / 1000).toFixed(1).replace('.', ',')} s`;
    const plusRecent = r.plusRecent ? r.plusRecent.split('-').reverse().join('/') : null;
    const detail = [r.message, r.urlFinale ? `redirigé vers ${r.urlFinale}` : null, r.empreinte ? `empreinte ${r.empreinte}` : null]
      .filter(Boolean)
      .join(' ; ');
    lignes.push(
      `| ${cellule(r.id)} | ${r.type} | ${SYMBOLES[r.verdict]} | ${cellule(r.http)} | ${cellule(r.contentType)} | ${cellule(formaterDeclare(r.encodageDeclare))} | ${cellule(formaterReel(r))} | ${cellule(r.elements)} | ${cellule(plusRecent)} | ${cellule(temps)} | ${cellule(detail)} |`,
    );
  }
  const compte = (v: Verdict) => resultats.filter((r) => r.verdict === v).length;
  lignes.push('', `Bilan : ${compte('ok')} OK, ${compte('a_surveiller')} à surveiller, ${compte('echec')} en échec, sur ${resultats.length} sources testées.`);
  return lignes.join('\n');
}

async function principal(): Promise<void> {
  const racine = new URL('../../', import.meta.url);
  const { sources } = JSON.parse(readFileSync(new URL('veille/sources.json', racine), 'utf8')) as { sources: Source[] };
  const config = JSON.parse(readFileSync(new URL('veille/config.json', racine), 'utf8')) as { user_agent: string };

  const client = new ClientHttp({ userAgent: config.user_agent, delaiMaxMs: 20_000, intervalleParDomaineMs: 1_000 });
  const testees = sources.filter((s) => s.type === 'rss' || s.type === 'page');
  console.log(`Diagnostic de ${testees.length} sources (User-Agent : ${config.user_agent})…`);

  // Les domaines différents sont interrogés en parallèle ; le client limite à 1 requête/s par domaine.
  const resultats = await Promise.all(testees.map((s) => diagnostiquerSource(client, s)));
  const rapport = rapportMarkdown(resultats, new Date());

  console.log(`\n${rapport}\n`);
  console.log('JSON du diagnostic :');
  console.log(JSON.stringify(resultats));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${rapport}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  principal().catch((e: unknown) => {
    console.error('Le diagnostic a échoué :', e);
    process.exit(1);
  });
}
