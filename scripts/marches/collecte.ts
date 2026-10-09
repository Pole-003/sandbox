/**
 * Collecte des indicateurs de marché et de finances publiques : npm run marches:collecte (workflow marches.yml).
 *
 * Coût : 0 €. Exécutée quelques fois par jour ouvré, juste après les heures de publication validées
 * (veille/marches-sources.json). À chaque exécution, seuls les indicateurs dont une nouvelle valeur est
 * attendue sont interrogés (prochaine publication passée, échec précédent, ou déclenchement forcé).
 * Une source en panne passe la main à la suivante (secours) et ne fait jamais échouer la collecte.
 *
 * public/marches.json n'est réécrit que si une valeur a changé (ou si un indicateur tombe en panne ou
 * s'en remet) : le workflow ne commite et ne redéploie qu'à cette condition, avec un message explicite.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ajouterJours, ajouterMois } from '../../src/core/dates.ts';
import {
  calculerVariations,
  enHeureDeParis,
  estMarches,
  nouvelleValeurAttendue,
  prochainePublication,
  type EvenementMarche,
  type IdIndicateur,
  type IndicateurMarche,
  type JournalCollecte,
  type MarchesJson,
  type ReglePublication,
  type SerieComplementaire,
} from '../../src/modules/veille/marches.ts';
import { ClientHttp, type PolitiqueRobots } from '../veille/http.ts';
import { lireProchainePublicationInsee, lireSerieCsv, lireSerieInsee, type Emplacement, type Lecture } from './lecture.ts';

export interface SourceIndicateur {
  id: string;
  organisme: string;
  libelle: string;
  format: 'insee' | 'csv';
  separateur?: string;
  /** Variable d'environnement de la clé (en-tête « Authorization: Apikey »). */
  secret?: string;
  url: string;
  emplacement: Emplacement;
  robots?: Exclude<PolitiqueRobots, 'respecter'>;
  lien: string;
  conditions: string;
  /** Nature affichée quand cette source sert de secours (ex. « mensuel »). */
  nature_secours?: string;
  /** Règle de publication de cette source quand elle sert de secours. */
  regle_secours?: ReglePublication;
}

export interface IndicateurConfig {
  id: IdIndicateur;
  nom: string;
  unite: string;
  decimales: number;
  genre: IndicateurMarche['genre'];
  nature: string;
  regle: ReglePublication;
  calendrier?: { date: string; heure: string | null }[];
  /** Page lue à chaque interrogation pour la prochaine publication (INSEE). */
  page_calendrier?: string;
  sources: SourceIndicateur[];
  complements?: { cle: string; libelle: string; unite: string; decimales: number; source?: SourceIndicateur }[];
}

export interface ConfigMarches {
  historique_jours: number;
  indicateurs: IndicateurConfig[];
}

export const CHEMIN_MARCHES = 'public/marches.json';

/** Erreur de configuration (clé absente) : la source est sautée sans être comptée comme une panne. */
class SourceNonConfiguree extends Error {}


/** Remplace {debut}, {debut_mois} et {debut_trimestre} dans une URL. */
export function urlAvecJetons(url: string, maintenant: Date, historiqueJours: number): string {
  const auj = enHeureDeParis(maintenant).date;
  const debut = ajouterJours(auj, -historiqueJours - 7);
  const ilYa3Ans = ajouterMois(auj, -36);
  const trimestre = `${ilYa3Ans.slice(0, 4)}-Q${Math.floor((Number(ilYa3Ans.slice(5, 7)) - 1) / 3) + 1}`;
  return url.replaceAll('{debut}', debut).replaceAll('{debut_mois}', ilYa3Ans.slice(0, 7)).replaceAll('{debut_trimestre}', trimestre);
}

export async function lireSource(client: ClientHttp, s: SourceIndicateur, env: Readonly<Record<string, string | undefined>>, maintenant: Date, historiqueJours: number): Promise<Lecture> {
  const cle = s.secret ? env[s.secret] : undefined;
  if (s.secret && !cle) throw new SourceNonConfiguree(`non configurée (${s.secret} absent)`);
  const r = await client.recuperer(urlAvecJetons(s.url, maintenant, historiqueJours), {
    ...(s.robots ? { robots: s.robots } : {}),
    ...(cle ? { entetes: { Authorization: `Apikey ${cle}` } } : {}),
  });
  if (r.statut !== 200) throw new Error(`HTTP ${r.statut}`);
  const texte = new TextDecoder().decode(r.octets);
  return s.format === 'insee' ? lireSerieInsee(texte, s.emplacement) : lireSerieCsv(texte, s.emplacement, s.separateur ?? ',');
}

function indicateurVide(c: IndicateurConfig): IndicateurMarche {
  const s = c.sources[0]!;
  return {
    id: c.id, nom: c.nom, unite: c.unite, decimales: c.decimales, genre: c.genre, nature: c.nature,
    valeur: null, date_valeur: null, recupere_le: null,
    variations: { precedente: null, un_mois: null, debut_annee: null, un_an: null },
    historique: [], complements: [],
    source: { id: s.id, organisme: s.organisme, libelle: s.libelle, lien: s.lien, conditions: s.conditions, secours: false, nature: c.nature },
    regle: c.regle, prochaine_publication: null,
    derniere_tentative: null, derniere_reussite: null, derniere_erreur: null, remarque: null, journal: [],
  };
}

/** Règle de publication en vigueur : celle de la source de secours utilisée, sinon celle de l'indicateur. */
export function regleEffective(c: IndicateurConfig, source: IndicateurMarche['source']): ReglePublication {
  return (source.secours ? c.sources.find((s) => s.id === source.id)?.regle_secours : undefined) ?? c.regle;
}

/** Ajoute l'état du jour au journal (30 jours) ; « ok » n'est jamais remplacé le même jour par « sans nouveauté ». */
export function noterJournal(journal: readonly JournalCollecte[], date: string, etat: JournalCollecte['etat']): JournalCollecte[] {
  const existant = journal.find((j) => j.date === date);
  const garde = existant && existant.etat === 'ok' && etat === 'sans_nouveaute' ? existant : { date, etat };
  return [...journal.filter((j) => j.date !== date), garde].sort((a, b) => a.date.localeCompare(b.date)).filter((j) => j.date > ajouterJours(date, -30));
}

/** Contenu qui justifie une publication : valeurs, séries, source utilisée, panne ou non, prochaine publication. */
export function signature(i: IndicateurMarche): string {
  return JSON.stringify([i.valeur, i.date_valeur, i.historique, i.complements.map((c) => c.historique), i.source.id, i.derniere_erreur !== null, i.prochaine_publication]);
}

const nombreFr = (n: number, d: number) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);

export interface DependancesMarches {
  config: ConfigMarches;
  evenements: EvenementMarche[];
  precedent: MarchesJson | null;
  client: ClientHttp;
  maintenant: Date;
  env: Readonly<Record<string, string | undefined>>;
  /** Interroge toutes les sources, même si aucune valeur n'est attendue (déclenchement manuel). */
  forcer?: boolean;
  journal?: (m: string) => void;
}

export async function collecterMarches(d: DependancesMarches): Promise<{ marches: MarchesJson; modifie: boolean; nouveautes: string[] }> {
  const log = d.journal ?? (() => {});
  const auj = enHeureDeParis(d.maintenant).date;
  const indicateurs: IndicateurMarche[] = [];
  const nouveautes: string[] = [];

  for (const c of d.config.indicateurs) {
    const precedent = d.precedent?.indicateurs.find((i) => i.id === c.id);
    // Les réglages (libellés, règle) viennent toujours du catalogue ; les données, du fichier publié.
    let i: IndicateurMarche = { ...indicateurVide(c), ...(precedent ?? {}), nom: c.nom, unite: c.unite, decimales: c.decimales, genre: c.genre };
    i.regle = regleEffective(c, i.source);
    const calendrier = [...(c.calendrier ?? [])];
    // Sur une source de secours, la source principale est réessayée dès qu'elle est disponible (clé configurée).
    const principale = c.sources[0]!;
    const principaleDisponible = i.source.secours && (!principale.secret || Boolean(d.env[principale.secret]));
    const attendue =
      d.forcer || principaleDisponible || nouvelleValeurAttendue({ ...i, prochaine_publication: prochainePublication(i.regle, i.date_valeur, d.maintenant, calendrier) }, d.maintenant);

    if (!attendue) {
      log(`  —      ${c.id} : aucune nouvelle valeur attendue avant le ${i.prochaine_publication?.date.split('-').reverse().join('/') ?? '?'}`);
    } else {
      i.derniere_tentative = d.maintenant.toISOString();
      if (c.page_calendrier) {
        try {
          const r = await d.client.recuperer(c.page_calendrier);
          const prochaine = r.statut === 200 ? lireProchainePublicationInsee(new TextDecoder().decode(r.octets)) : null;
          if (prochaine && !calendrier.some((x) => x.date === prochaine.date)) calendrier.push(prochaine);
        } catch {
          // Calendrier illisible : la date est estimée d'après la fréquence.
        }
      }
      const erreurs: string[] = [];
      let lecture: Lecture | null = null;
      let rang = 0;
      for (const [n, s] of c.sources.entries()) {
        try {
          lecture = await lireSource(d.client, s, d.env, d.maintenant, d.config.historique_jours);
          rang = n;
          break;
        } catch (e) {
          erreurs.push(`${s.id} : ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (lecture) {
        const s = c.sources[rang]!;
        const quotidien = c.regle.frequence === 'quotidienne' || c.regle.frequence === 'hebdomadaire';
        const limite = ajouterJours(auj, -d.config.historique_jours);
        const historique = lecture.historique.filter(([date]) => !quotidien || rang > 0 || date >= limite);
        const dernier = historique.at(-1)!;
        const nouvelle = dernier[0] !== i.date_valeur || dernier[1] !== i.valeur;
        const remarques = [...erreurs];
        const complements: SerieComplementaire[] = [];
        for (const def of c.complements ?? []) {
          let serie = lecture.complements[def.cle];
          let src = s;
          if (def.source) {
            src = def.source;
            try {
              serie = (await lireSource(d.client, def.source, d.env, d.maintenant, d.config.historique_jours)).historique;
            } catch (e) {
              remarques.push(`${def.source.id} : ${e instanceof Error ? e.message : String(e)}`);
              serie = undefined;
            }
          }
          const ancienne = i.complements.find((x) => x.cle === def.cle);
          if (serie?.length) complements.push({ cle: def.cle, libelle: def.libelle, unite: def.unite, decimales: def.decimales, historique: serie, source: src.organisme, lien: src.lien });
          else if (ancienne && (def.source || rang === 0)) complements.push(ancienne);
        }
        i = {
          ...i,
          valeur: dernier[1], date_valeur: dernier[0], historique, complements,
          recupere_le: nouvelle ? d.maintenant.toISOString() : i.recupere_le,
          source: { id: s.id, organisme: s.organisme, libelle: s.libelle, lien: s.lien, conditions: s.conditions, secours: rang > 0, nature: rang > 0 ? (s.nature_secours ?? c.nature) : c.nature },
          derniere_reussite: d.maintenant.toISOString(), derniere_erreur: null, remarque: remarques.join(' ; ') || null,
          journal: noterJournal(i.journal, auj, nouvelle ? 'ok' : 'sans_nouveaute'),
        };
        if (nouvelle) nouveautes.push(`${c.nom} ${nombreFr(dernier[1], c.decimales)}${c.unite === '%' ? ' %' : ''} au ${dernier[0].split('-').reverse().slice(0, 2).join('/')}`);
        log(`  ${nouvelle ? 'NOUVEAU' : 'OK     '} ${c.id} : ${dernier[1]} au ${dernier[0]} (${s.id}${rang > 0 ? ', secours' : ''})${remarques.length ? ` — ${remarques.join(' ; ')}` : ''}`);
      } else {
        i = { ...i, derniere_erreur: erreurs.join(' ; '), journal: noterJournal(i.journal, auj, 'erreur') };
        log(`  ÉCHEC   ${c.id} : ${i.derniere_erreur}`);
      }
    }
    i.regle = regleEffective(c, i.source);
    i.variations = calculerVariations(i.historique, c.genre);
    i.prochaine_publication = prochainePublication(i.regle, i.date_valeur, d.maintenant, calendrier);
    indicateurs.push(i);
  }

  const evenements = [...d.evenements].sort((a, b) => a.date.localeCompare(b.date));
  const marches: MarchesJson = { version: 1, genere_le: d.maintenant.toISOString(), indicateurs, evenements };
  const avant = d.precedent;
  const modifie =
    !avant ||
    JSON.stringify(avant.evenements) !== JSON.stringify(evenements) ||
    indicateurs.length !== avant.indicateurs.length ||
    indicateurs.some((i) => {
      const a = avant.indicateurs.find((x) => x.id === i.id);
      return !a || signature(a) !== signature(i);
    });
  return { marches, modifie, nouveautes };
}

/** Message de commit : nouvelles valeurs, ou changement d'état des sources. */
export function messageCommit(nouveautes: readonly string[], maintenant: Date): string {
  const quand = enHeureDeParis(maintenant);
  const date = `${quand.date.split('-').reverse().join('/')} ${quand.heure.replace(':', ' h ')}`;
  return nouveautes.length ? `Marchés : ${nouveautes.join(', ')} (collecte du ${date})` : `Marchés : état des sources mis à jour (collecte du ${date})`;
}

async function principal(): Promise<void> {
  const racine = new URL('../../', import.meta.url);
  const lire = <T>(chemin: string): T => JSON.parse(readFileSync(new URL(chemin, racine), 'utf8')) as T;
  const config = lire<ConfigMarches>('veille/marches-sources.json');
  const { evenements } = lire<{ evenements: EvenementMarche[] }>('veille/evenements.json');
  const { user_agent: userAgent } = lire<{ user_agent: string }>('veille/config.json');
  const chemin = new URL(CHEMIN_MARCHES, racine);
  let precedent: MarchesJson | null = null;
  try {
    const v: unknown = existsSync(chemin) ? JSON.parse(readFileSync(chemin, 'utf8')) : null;
    precedent = estMarches(v) ? v : null;
  } catch {
    precedent = null;
  }
  const maintenant = new Date();
  console.log(`Marchés : collecte du ${maintenant.toISOString()}${process.env.MARCHES_FORCER === 'true' ? ' (toutes les sources)' : ''}`);
  const { marches, modifie, nouveautes } = await collecterMarches({
    config, evenements, precedent, maintenant, env: process.env, forcer: process.env.MARCHES_FORCER === 'true',
    client: new ClientHttp({ userAgent, delaiMaxMs: 20_000, intervalleParDomaineMs: 1_000 }),
    journal: (m) => console.log(m),
  });
  if (modifie) writeFileSync(chemin, `${JSON.stringify(marches, null, 2)}\n`);
  const message = messageCommit(nouveautes, maintenant);
  console.log(modifie ? `Publication : ${message}` : 'Aucune valeur nouvelle : rien à publier.');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `modifie=${modifie}\nmessage=${message}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lignes = ['## Collecte des marchés', '', '| Indicateur | Valeur | Date | Source | Prochaine publication | Erreur |', '|---|---|---|---|---|---|'];
    for (const i of marches.indicateurs) {
      lignes.push(`| ${i.nom} | ${i.valeur ?? '—'} | ${i.date_valeur ?? '—'} | ${i.source.id}${i.source.secours ? ' (secours)' : ''} | ${i.prochaine_publication ? `${i.prochaine_publication.date} ${i.prochaine_publication.heure ?? ''}${i.prochaine_publication.estimee ? ' (estimée)' : ''}` : '—'} | ${(i.derniere_erreur ?? i.remarque ?? '').replace(/\|/g, '/')} |`);
    }
    lignes.push('', modifie ? `Publication : ${message}` : 'Aucune valeur nouvelle : rien à publier.', '');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, lignes.join('\n'));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  principal().catch((e: unknown) => {
    console.error('La collecte des marchés a échoué :', e instanceof Error ? e.message : e);
    process.exit(1);
  });
}


