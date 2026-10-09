/**
 * Format des fichiers publiés par la collecte (docs/VEILLE.md) et lus par l'interface :
 * public/news.json et public/veille-etat.json.
 *
 * Ce fichier ne contient que des types et des constantes : il est partagé entre les scripts
 * de collecte (Node, GitHub Actions) et le navigateur.
 */
import type { EcheanceEntreprise } from './echeances.ts';

export const THEMES = [
  'Loi de finances',
  'Sécurité sociale',
  'Fiscal et comptable',
  'Audit et profession',
  'Économie et statistiques',
  'Rennes et Bretagne',
] as const;
export type Theme = (typeof THEMES)[number];

export const PUBLICS = ['Expertise comptable', 'Audit / CAC', 'Social / paie', 'Conseil aux dirigeants'] as const;
export type Public = (typeof PUBLICS)[number];

export const TYPES_ARTICLE = ['texte_officiel', 'doctrine', 'jurisprudence', 'statistique', 'presse', 'evenement'] as const;
export type TypeArticle = (typeof TYPES_ARTICLE)[number];

export const LIBELLES_TYPE: Record<TypeArticle, string> = {
  texte_officiel: 'Texte officiel',
  doctrine: 'Doctrine',
  jurisprudence: 'Jurisprudence',
  statistique: 'Statistique',
  presse: 'Presse',
  evenement: 'Événement',
};

export type Importance = 1 | 2 | 3 | 4 | 5;

/** D'où vient l'article : flux officiel (couche A), API officielle (couche B) ou alerte Google (presse). */
export type Origine = 'flux' | 'api' | 'alerte';

/** Détail du score de classement, affiché dans « Pourquoi ce score ». */
export interface DetailScore {
  /** Mots-clés reconnus pour le thème retenu, avec leur poids. */
  mots: { mot: string; poids: number }[];
  /** Coefficient de la nature de la source (officielle 1, alerte presse plus faible). */
  coefficient: number;
  bonus_source: number;
  /** Bonus de fraîcheur du jour de la collecte : sert au tri, pas à l'importance. */
  bonus_fraicheur: number;
  /** Score thématique (mots × coefficient + bonus de source), qui fixe l'importance. */
  score: number;
}

/** Même information publiée par une autre source (regroupement des articles similaires). */
export interface AutreSource {
  source: string;
  url: string;
  titre: string;
}

export interface Article {
  /** Empreinte de l'URL normalisée. */
  id: string;
  titre: string;
  /** Émetteur affiché (mention obligatoire de la source). */
  source: string;
  /** Identifiant dans veille/sources.json. */
  source_id: string | null;
  url: string;
  /** Date de publication, AAAA-MM-JJ. */
  date: string;
  theme: Theme;
  /** Description fournie par la source, nettoyée du HTML et tronquée à 300 caractères (sans reformulation). */
  resume: string | null;
  importance: Importance | null;
  public: Public[];
  type: TypeArticle | null;
  origine: Origine;
  /** Première collecte, AAAA-MM-JJ. */
  collecte_le: string;
  /** Thème de départ propre à l'article (alerte Google : thème de l'alerte), prioritaire sur celui du catalogue. */
  theme_source?: Theme;
  /** Détail du classement par mots-clés. */
  pourquoi?: DetailScore;
  /** Score de tri : score thématique + bonus de fraîcheur. */
  score?: number;
  /** Autres sources ayant publié la même information (titres proches, dates voisines). */
  autres_sources?: AutreSource[];
}

export interface Indicateur {
  /** Source du catalogue qui a fourni l'indicateur (insee-bdm, bodacc-35…). */
  source_id?: string;
  libelle: string;
  valeur: string;
  periode: string;
  source: string;
  url: string;
  date_publication: string;
  collecte_le: string;
}

export type StatutEtape = 'fait' | 'en_cours' | 'a_venir';

export interface EcheanceSuivi {
  libelle: string;
  date: string | null;
  /** Vrai pour un délai calculé (Constitution, art. 47 et 47-1) : indicatif. */
  indicative?: boolean;
}

/** Article du projet de loi, avec son intitulé officiel et son classement par mots-clés. */
export interface ArticleProjet {
  numero: string;
  intitule: string;
  /** Partie du texte (ex. « Première partie : conditions générales de l’équilibre financier »). */
  partie: string | null;
  /** Subdivision la plus proche (ex. « B – Mesures fiscales »). */
  groupe: string | null;
  theme: Theme;
  importance: Importance;
  public: Public[];
  /** Lien direct vers l'article dans le texte, quand il existe. */
  url: string | null;
  /** Rubrique de la hiérarchie établie par le pôle (ex. « Social et paie »). */
  rubrique?: string | null;
}

export interface MesuresProjet {
  /** Ex. « Projet de loi de finances pour 2027, n° 3210 (texte déposé) ». */
  libelle: string;
  url: string;
  articles: ArticleProjet[];
  /** Origine de l'importance : hiérarchie établie par le pôle (veille/hierarchie-mesures.json) ou mots-clés. */
  hierarchie?: { origine: 'pole' | 'mots-cles'; etablie_le: string | null };
}

export interface SuiviTexte {
  texte: string;
  etape_actuelle: string;
  etapes: { libelle: string; date: string | null; statut: StatutEtape }[];
  prochaine_echeance: EcheanceSuivi | null;
  /** Délais constitutionnels calculés depuis le dépôt (indicatifs). */
  delais?: EcheanceSuivi[];
  /** Articles du projet de loi déposé (intitulés officiels). */
  mesures?: MesuresProjet | null;
  /** Dossier législatif d'origine. */
  source?: string;
  url?: string | null;
  /** Date de la dernière mise à jour, AAAA-MM-JJ. */
  mis_a_jour_le: string;
}

export interface SourceCitee {
  id: string;
  nom: string;
  url: string | null;
}

export interface NewsJson {
  version: 1;
  genere_le: string;
  articles: Article[];
  indicateurs: Indicateur[];
  suivi: { plf: SuiviTexte | null; plfss: SuiviTexte | null };
  /** Sources consultées, pour la mention des sources. */
  sources: SourceCitee[];
  /** Échéances des entreprises : calendrier fiscal officiel et veille/echeances.json (7 jours passés, 100 à venir). */
  echeances?: EcheanceEntreprise[];
}

export type EtatCollecte = 'ok' | 'erreur' | 'inactive' | 'non_configuree';

export interface EtatSource {
  id: string;
  nom: string;
  type: 'rss' | 'page' | 'api' | 'dossier' | 'alerte_google' | 'calendrier';
  theme: string;
  statut_catalogue: string;
  etat: EtatCollecte;
  derniere_tentative: string | null;
  derniere_reussite: string | null;
  erreur: string | null;
  /** Articles retenus lors de la dernière collecte (après filtre par mots-clés et fenêtre). */
  nb_articles: number;
  /** Éléments présents dans le flux. */
  nb_elements: number | null;
  duree_ms: number | null;
  /** Pages suivies : empreinte du texte visible, pour détecter un changement. */
  empreinte?: string | null;
}

export interface EtatVeille {
  version: 2;
  genere_le: string;
  /** Sources des couches A (flux) et B (API officielles). */
  sources: EtatSource[];
  /** Recherche IA : désactivée (veille à 0 €). */
  recherche_ia: { active: false; raison: string };
  /** Classement par mots-clés (veille/mots-cles.json). */
  classement: { articles: number; exclus: number; marginaux: number };
}
