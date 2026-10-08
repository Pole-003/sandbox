/**
 * Format des fichiers publiés par la collecte (docs/VEILLE.md) et lus par l'interface :
 * public/news.json et public/veille-etat.json.
 *
 * Ce fichier ne contient que des types et des constantes : il est partagé entre les scripts
 * de collecte (Node, GitHub Actions) et le navigateur.
 */

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

/** D'où vient l'article : flux officiel (couche A), recherche IA (couche C), ou les deux. */
export type Origine = 'flux' | 'recherche_ia' | 'flux_et_ia';

export interface Article {
  /** Empreinte de l'URL normalisée. */
  id: string;
  titre: string;
  /** Émetteur affiché (mention obligatoire de la source). */
  source: string;
  /** Identifiant dans veille/sources.json (couche A), null pour la recherche IA. */
  source_id: string | null;
  url: string;
  /** Date de publication, AAAA-MM-JJ. */
  date: string;
  theme: Theme;
  /** Résumé rédigé avec nos mots (jamais le texte de la source). */
  resume: string | null;
  importance: Importance | null;
  public: Public[];
  type: TypeArticle | null;
  origine: Origine;
  /** Première collecte, AAAA-MM-JJ. */
  collecte_le: string;
}

export interface Indicateur {
  libelle: string;
  valeur: string;
  periode: string;
  source: string;
  url: string;
  date_publication: string;
  /** Faux tant qu'aucune API officielle (couche B) ne fournit la même série : badge « Source IA, à vérifier ». */
  verifie_par_api: boolean;
  collecte_le: string;
}

export type StatutEtape = 'fait' | 'en_cours' | 'a_venir';

export interface SuiviTexte {
  texte: string;
  etape_actuelle: string;
  etapes: { libelle: string; date: string | null; statut: StatutEtape }[];
  prochaine_echeance: { libelle: string; date: string | null } | null;
  /** Date de la recherche qui a produit ce suivi, AAAA-MM-JJ. */
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
}

export type EtatCollecte = 'ok' | 'erreur' | 'inactive' | 'non_configuree';

export interface EtatSource {
  id: string;
  nom: string;
  type: 'rss' | 'page' | 'api';
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

export type StatutCoucheC = 'executee' | 'partielle' | 'sautee';

export interface EtatTheme {
  theme: Theme;
  statut: 'ok' | 'abandonne';
  retenus: number;
  rejetes: number;
  recherches: number;
  cout_usd: number;
  erreur: string | null;
}

export interface EtatVeille {
  version: 1;
  genere_le: string;
  sources: EtatSource[];
  couche_c: {
    statut: StatutCoucheC;
    raison: string | null;
    modele: string | null;
    outil: string | null;
    themes: EtatTheme[];
  };
  notation: { statut: 'executee' | 'sautee' | 'echec'; raison: string | null; notes: number; cout_usd: number };
  couts: { mois: string; jour_usd: number; mois_usd: number; budget_mensuel_usd: number };
}
