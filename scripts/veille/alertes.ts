/**
 * Alertes Google (type « alerte_google » du catalogue, docs/VEILLE.md).
 *
 * Les flux sont créés par l'utilisateur sur google.com/alerts (« Envoyer à : flux RSS »). Leur adresse
 * contient un identifiant lié à son compte : elle est lue dans le secret GitHub nommé par le champ
 * « secret » du catalogue (ALERTES_RSS), une ligne par flux au format « Thème|URL », jamais dans le dépôt.
 * Aucune adresse de flux n'est journalisée ni publiée : les messages ne citent que le numéro de ligne
 * et le libellé de l'alerte.
 *
 * google.com/robots.txt interdit /alerts/ aux robots d'indexation ; l'utilisateur a demandé le
 * 09/10/2026 de lire malgré tout ses propres flux (politique « ignorer », voir http.ts).
 */
import { THEMES, type EtatSource, type Theme } from '../../src/modules/veille/modele.ts';
import { avecNouvellesTentatives, type ArticleFlux } from './couche-a.ts';
import { fenetreJours, themeConnu, type ConfigVeille, type SourceCatalogue } from './config.ts';
import { dateIsoParis } from './dates.ts';
import { decoderOctets, lireEncodageDeclare } from './encodage.ts';
import { lireFlux, resumeDepuisDescription } from './flux.ts';
import type { ClientHttp } from './http.ts';
import { secretsRequis } from './couche-b.ts';
import { sansAccents } from './classement.ts';

export interface Alerte {
  /** Numéro de ligne dans le secret (pour les messages). */
  ligne: number;
  libelle: string;
  url: string;
}

/** Lit le secret : une ligne « Thème|URL » par flux ; lignes vides et commentaires (#) ignorés. */
export function lireAlertes(texte: string): { alertes: Alerte[]; invalides: number[] } {
  const alertes: Alerte[] = [];
  const invalides: number[] = [];
  texte.split(/\r\n|\r|\n/).forEach((brute, i) => {
    const ligne = brute.trim();
    if (!ligne || ligne.startsWith('#')) return;
    const separateur = ligne.indexOf('|');
    const libelle = separateur > 0 ? ligne.slice(0, separateur).trim() : '';
    const adresse = separateur > 0 ? ligne.slice(separateur + 1).trim() : '';
    try {
      const url = new URL(adresse);
      if (!libelle || url.protocol !== 'https:') throw new Error('ligne invalide');
      alertes.push({ ligne: i + 1, libelle, url: url.href });
    } catch {
      invalides.push(i + 1);
    }
  });
  return { alertes, invalides };
}

/**
 * Lien d'article d'une alerte : Google publie « https://www.google.com/url?rct=j&sa=t&url=<article>&ct=ga&… ».
 * On garde l'adresse de l'article ; null si elle est absente ou n'est pas en http(s).
 */
export function nettoyerLienGoogle(lien: string): string | null {
  let url: URL;
  try {
    url = new URL(lien);
  } catch {
    return null;
  }
  const redirection = /(^|\.)google\.[a-z.]+$/i.test(url.hostname) && url.pathname === '/url';
  if (!redirection) return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  const cible = url.searchParams.get('url') ?? url.searchParams.get('q');
  if (!cible) return null;
  try {
    const article = new URL(cible);
    return article.protocol === 'https:' || article.protocol === 'http:' ? article.href : null;
  } catch {
    return null;
  }
}

/** Thème d'une alerte : son libellé s'il désigne un thème de la veille, sinon le thème du catalogue. */
export function themeAlerte(libelle: string, themeCatalogue: string): Theme {
  const cle = sansAccents(libelle);
  return THEMES.find((t) => sansAccents(t) === cle) ?? themeConnu(themeCatalogue);
}

/** Émetteur affiché : le domaine de l'article (la presse n'est pas nommée dans le flux). */
export function emetteur(url: string): string {
  return `${new URL(url).hostname.replace(/^www\./, '')} (alerte Google)`;
}

export interface OptionsAlertes {
  config: ConfigVeille;
  client: ClientHttp;
  maintenant: Date;
  env: Readonly<Record<string, string | undefined>>;
  etatPrecedent: EtatSource[];
  delaisNouvellesTentatives?: number[];
  attendre?: (ms: number) => Promise<void>;
}

export async function collecterAlertes(
  sources: readonly SourceCatalogue[],
  options: OptionsAlertes,
): Promise<{ articles: ArticleFlux[]; etats: EtatSource[] }> {
  const articles: ArticleFlux[] = [];
  const etats: EtatSource[] = [];
  const precedents = new Map(options.etatPrecedent.map((e) => [e.id, e]));

  for (const source of sources.filter((s) => s.type === 'alerte_google')) {
    const precedent = precedents.get(source.id);
    const etat: EtatSource = {
      id: source.id, nom: source.nom, type: 'alerte_google', theme: source.theme, statut_catalogue: source.statut, etat: 'non_configuree',
      derniere_tentative: precedent?.derniere_tentative ?? null, derniere_reussite: precedent?.derniere_reussite ?? null,
      erreur: null, nb_articles: 0, nb_elements: null, duree_ms: null,
    };
    const [nomSecret] = secretsRequis(source);
    const secret = nomSecret ? options.env[nomSecret] : undefined;
    if (source.statut !== 'verifie') {
      etats.push({ ...etat, etat: 'inactive', erreur: 'source à vérifier (non collectée)' });
      continue;
    }
    if (!secret?.trim()) {
      etats.push({ ...etat, erreur: `non configurée : secret ${nomSecret ?? '(nom absent du catalogue)'} absent` });
      continue;
    }

    const { alertes, invalides } = lireAlertes(secret);
    const remarques = invalides.map((n) => `ligne ${n} du secret illisible (format attendu « Thème|URL »)`);
    etat.derniere_tentative = options.maintenant.toISOString();
    const debut = Date.now();
    let reussies = 0;
    let elements = 0;
    const avant = articles.length;

    for (const alerte of alertes) {
      const theme = themeAlerte(alerte.libelle, source.theme);
      try {
        const reponse = await avecNouvellesTentatives(
          () => options.client.recuperer(alerte.url, { robots: source.robots ?? 'ignorer' }),
          options.delaisNouvellesTentatives ?? [5_000, 15_000],
          options.attendre ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
        );
        const texte = decoderOctets(reponse.octets, lireEncodageDeclare(reponse.octets, reponse.contentType)).texte;
        const flux = lireFlux(texte, 'https://www.google.com/');
        elements += flux.length;
        const limite = new Date(options.maintenant.getTime() - fenetreJours(options.config, theme) * 86_400_000);
        for (const e of flux) {
          const url = nettoyerLienGoogle(e.lien);
          if (!url) continue;
          if (e.date && (e.date < limite || e.date.getTime() > options.maintenant.getTime() + 86_400_000)) continue;
          articles.push({
            titre: e.titre,
            url,
            date: e.date ? dateIsoParis(e.date) : dateIsoParis(options.maintenant),
            theme,
            theme_source: theme,
            source: emetteur(url),
            source_id: source.id,
            resume: resumeDepuisDescription(e.description, e.titre, options.config.longueur_resume),
            type: source.type_article ?? 'presse',
          });
        }
        reussies++;
      } catch (e) {
        // Jamais l'adresse du flux dans le message : seulement la ligne et le libellé.
        remarques.push(`alerte « ${alerte.libelle} » (ligne ${alerte.ligne}) : ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    Object.assign(etat, {
      etat: alertes.length > 0 && reussies === 0 ? 'erreur' : 'ok',
      derniere_reussite: reussies > 0 ? etat.derniere_tentative : etat.derniere_reussite,
      nb_elements: elements,
      nb_articles: articles.length - avant,
      duree_ms: Date.now() - debut,
      erreur: alertes.length === 0 ? 'aucune alerte lisible dans le secret' : remarques.join(' ; ') || null,
    });
    if (alertes.length === 0) etat.etat = 'erreur';
    etats.push(etat);
  }
  return { articles, etats };
}
