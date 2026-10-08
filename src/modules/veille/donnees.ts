/**
 * Chargement des fichiers de veille publiés avec le site (CLAUDE.md, règle n° 1) :
 * seuls news.json et veille-etat.json sont chargés, sur la même origine, en GET, sans paramètre.
 * Le navigateur ne contacte jamais les sites sources.
 */
import type { EtatVeille, NewsJson } from './modele.ts';

const FICHIERS = { news: 'news.json', etat: 'veille-etat.json' } as const;

export type Chargement<T> = { ok: true; donnees: T } | { ok: false; raison: 'absent' | 'illisible' | 'reseau' };

async function charger<T>(nom: string, valider: (v: unknown) => v is T): Promise<Chargement<T>> {
  let reponse: Response;
  try {
    // « no-cache » : le navigateur revalide le fichier (il change chaque matin) sans ajouter de paramètre à l'adresse.
    reponse = await fetch(`${import.meta.env.BASE_URL}${nom}`, { method: 'GET', cache: 'no-cache', credentials: 'omit' });
  } catch {
    return { ok: false, raison: 'reseau' };
  }
  if (!reponse.ok) return { ok: false, raison: reponse.status === 404 ? 'absent' : 'reseau' };
  try {
    const json: unknown = await reponse.json();
    return valider(json) ? { ok: true, donnees: json } : { ok: false, raison: 'illisible' };
  } catch {
    return { ok: false, raison: 'illisible' };
  }
}

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export function estNews(v: unknown): v is NewsJson {
  return estObjet(v) && v.version === 1 && Array.isArray(v.articles) && Array.isArray(v.indicateurs) && estObjet(v.suivi) && Array.isArray(v.sources);
}

export function estEtat(v: unknown): v is EtatVeille {
  return estObjet(v) && v.version === 1 && Array.isArray(v.sources) && estObjet(v.couche_c) && estObjet(v.couts);
}

let enCours: Promise<Chargement<NewsJson>> | null = null;

/** news.json est partagé entre l'accueil et la veille : un seul chargement par affichage de page. */
export function chargerNews(): Promise<Chargement<NewsJson>> {
  enCours ??= charger(FICHIERS.news, estNews).then((r) => {
    if (!r.ok) enCours = null; // nouvel essai au prochain affichage
    return r;
  });
  return enCours;
}

export function chargerEtat(): Promise<Chargement<EtatVeille>> {
  return charger(FICHIERS.etat, estEtat);
}

/** Pour les tests. */
export function oublierCache(): void {
  enCours = null;
}

export const MESSAGES_CHARGEMENT: Record<'absent' | 'illisible' | 'reseau', string> = {
  absent: 'Aucune collecte n’a encore été publiée. Elle a lieu chaque jour ouvré à 6 h 30.',
  illisible: 'Le fichier de veille publié est illisible. Signalez-le à l’équipe du Pôle 003.',
  reseau: 'Le fichier de veille n’a pas pu être chargé. Vérifiez votre connexion puis rechargez la page.',
};
