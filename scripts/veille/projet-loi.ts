/**
 * Articles d'un projet de loi (PLF, PLFSS), lus dans la version open data publiée par l'Assemblée nationale :
 * https://www.assemblee-nationale.fr/dyn/opendata/PRJLANR5L<législature>B<numéro>.html
 *
 * Deux présentations relevées le 08/10/2026 (npm run veille:explorer-suivi) :
 *  1. table des matières (PLF 2027) : <p class="assnatTOC6"><a href="#_Toc…"><span>ARTICLE</span> <span>2</span>
 *     <span> :</span> <span>Soutenir le travail…</span></a></p>, les niveaux TOC2 à TOC5 portant parties et titres ;
 *  2. blocs d'article (PLFSS 2027) : <p class="assnat9ArticleNum"> Article 1<span>er</span><br>Rectification… </p>,
 *     les parties dans <p class="assnat2PartieIntit">.
 * Les intitulés sont ceux du texte officiel ; aucune reformulation.
 */
import type { ArticleProjet, MesuresProjet } from '../../src/modules/veille/modele.ts';
import { classer, type MotsCles } from './classement.ts';
import { decoderEntites } from './flux.ts';

export interface ArticleLu {
  numero: string;
  intitule: string;
  partie: string | null;
  groupe: string | null;
  ancre: string | null;
}

const texte = (html: string) =>
  decoderEntites(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/[\s ]+/g, ' ')
    .trim();

/** Majuscules en début de mot seulement (« PREMIÈRE PARTIE : CONDITIONS… » → « Première partie : conditions… »). */
function adoucir(titre: string): string {
  if (titre !== titre.toUpperCase()) return titre;
  const bas = titre.toLowerCase();
  return bas.charAt(0).toUpperCase() + bas.slice(1);
}

/** Présentation 1 : table des matières. */
export function lireTableDesMatieres(html: string): ArticleLu[] {
  const articles: ArticleLu[] = [];
  const niveaux: (string | null)[] = [];
  for (const m of html.matchAll(/<p[^>]*class=["'][^"']*assnatTOC(\d)[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi)) {
    const niveau = Number(m[1]);
    const contenu = m[2] ?? '';
    const ligne = texte(contenu);
    if (!ligne) continue;
    const article = /^ARTICLE\s+([^:]+?)\s*:\s*(.+)$/i.exec(ligne);
    if (article) {
      const partie = niveaux[2] ?? null;
      const groupe = [...niveaux].reverse().find((n, i, t) => n && t.length - 1 - i > 2) ?? null;
      articles.push({
        numero: article[1]!.trim(),
        intitule: article[2]!.trim(),
        partie: partie ? adoucir(partie) : null,
        groupe: groupe ? adoucir(groupe) : null,
        ancre: /href=["']#([^"']+)["']/.exec(contenu)?.[1] ?? null,
      });
    } else {
      niveaux[niveau] = ligne;
      niveaux.length = niveau + 1; // les niveaux inférieurs ne s'appliquent plus
    }
  }
  return articles;
}

/** Présentation 2 : blocs « assnat9ArticleNum ». */
export function lireBlocsArticles(html: string): ArticleLu[] {
  const articles: ArticleLu[] = [];
  let partie: string | null = null;
  let groupe: string | null = null;
  const motif = /<p[^>]*class=["'][^"']*assnat(\d)(Partie|Titre|Chapitre|Section)Intit[^"']*["'][^>]*>([\s\S]*?)<\/p>|<p[^>]*class=["'][^"']*assnat9ArticleNum[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi;
  for (const m of html.matchAll(motif)) {
    if (m[2]) {
      const intitule = texte(m[3] ?? '');
      if (m[2] === 'Partie') {
        partie = intitule;
        groupe = null;
      } else {
        groupe = intitule;
      }
      continue;
    }
    const brut = m[4] ?? '';
    const [avant, ...apres] = brut.split(/<br\s*\/?>/i);
    // Balises retirées sans espace : « 1<span>er</span> » doit donner « 1er ».
    const numero = texte((avant ?? '').replace(/<[^>]+>/g, '')).replace(/^Article\s+/i, '');
    const intitule = texte(apres.join(' '));
    if (!numero || !intitule) continue; // article sans intitulé : rien d'utile à afficher
    articles.push({ numero, intitule, partie, groupe, ancre: null });
  }
  return articles;
}

export function lireArticles(html: string): ArticleLu[] {
  const toc = lireTableDesMatieres(html);
  return toc.length >= 3 ? toc : lireBlocsArticles(html);
}

/** Adresse open data du texte, d'après le lien du dossier (« /dyn/17/textes/l17b3210_projet-loi »). */
export function texteDepuisDossier(htmlDossier: string): { numero: string; page: string; opendata: string } | null {
  const m = /href=["'](?:https:\/\/www\.assemblee-nationale\.fr)?\/dyn\/(\d+)\/textes\/l\1b(\d+)_projet-loi["']/i.exec(htmlDossier);
  if (!m) return null;
  const [, legislature, numero] = m;
  return {
    numero: numero!,
    page: `https://www.assemblee-nationale.fr/dyn/${legislature}/textes/l${legislature}b${numero}_projet-loi`,
    opendata: `https://www.assemblee-nationale.fr/dyn/opendata/PRJLANR5L${legislature}B${numero}.html`,
  };
}

/** Classe chaque article par mots-clés (même règles que le fil, sans bonus de source). */
export function construireMesures(
  articles: readonly ArticleLu[],
  regles: MotsCles,
  theme: ArticleProjet['theme'],
  libelle: string,
  url: string,
  urlOpendata: string,
): MesuresProjet {
  return {
    libelle,
    url,
    articles: articles.map((a) => {
      const c = classer({ titre: a.intitule, resume: a.groupe, source_id: null, theme }, regles);
      return {
        numero: a.numero,
        intitule: a.intitule,
        partie: a.partie,
        groupe: a.groupe,
        theme: c.theme,
        importance: c.exclu ? 1 : c.importance,
        public: c.public,
        url: a.ancre ? `${urlOpendata}#${a.ancre}` : null,
      };
    }),
  };
}

/** Hiérarchie des mesures établie par le pôle (veille/hierarchie-mesures.json), par numéro de projet de loi. */
export interface HierarchieMesures {
  textes: Record<string, {
    texte: string;
    etablie_le: string;
    articles: Record<string, { importance: ArticleProjet['importance']; rubrique: string; intitule: string }>;
  }>;
}

/** Plafond des articles non retenus d'un texte hiérarchisé par le pôle. */
export const PLAFOND_NON_RETENU = 2;

const comparable = (t: string) =>
  t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’'«»"\[\]]/g, ' ').replace(/\s+/g, ' ').trim();

export function verifierHierarchie(h: HierarchieMesures): void {
  const erreurs: string[] = [];
  for (const [numero, t] of Object.entries(h.textes ?? {})) {
    for (const [art, l] of Object.entries(t.articles ?? {})) {
      if (![1, 2, 3, 4, 5].includes(l.importance)) erreurs.push(`texte ${numero}, art. ${art} : importance de 1 à 5`);
      if (!l.rubrique || !l.intitule) erreurs.push(`texte ${numero}, art. ${art} : rubrique et intitulé obligatoires`);
    }
  }
  if (erreurs.length) throw new Error(`veille/hierarchie-mesures.json invalide : ${erreurs.join(' ; ')}`);
}

/**
 * Applique la hiérarchie du pôle au texte n° `numero`, si elle existe. Une ligne dont l'intitulé ne correspond
 * plus (renumérotation, amendement) est ignorée et signalée dans `ecarts` : le classement par mots-clés s'applique.
 */
export function appliquerHierarchie(
  mesures: MesuresProjet,
  numero: string,
  hierarchie: HierarchieMesures | undefined,
): { mesures: MesuresProjet; ecarts: string[] } {
  const t = hierarchie?.textes?.[numero];
  if (!t) return { mesures: { ...mesures, hierarchie: { origine: 'mots-cles', etablie_le: null } }, ecarts: [] };
  const ecarts: string[] = [];
  const presents = new Set(mesures.articles.map((a) => a.numero));
  for (const art of Object.keys(t.articles)) if (!presents.has(art)) ecarts.push(`art. ${art} absent du texte`);
  const articles = mesures.articles.map((a) => {
    const ligne = t.articles[a.numero];
    if (!ligne) return { ...a, importance: Math.min(a.importance, PLAFOND_NON_RETENU) as ArticleProjet['importance'], rubrique: null };
    if (comparable(ligne.intitule) !== comparable(a.intitule)) {
      ecarts.push(`art. ${a.numero} : intitulé modifié`);
      return { ...a, rubrique: null };
    }
    return { ...a, importance: ligne.importance, rubrique: ligne.rubrique };
  });
  return { mesures: { ...mesures, articles, hierarchie: { origine: 'pole', etablie_le: t.etablie_le } }, ecarts };
}
