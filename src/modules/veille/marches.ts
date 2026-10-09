/**
 * Suivi des marchés et des finances publiques (logique pure, partagée entre la collecte et le navigateur) :
 * format de public/marches.json, variations, prochaine publication attendue, fraîcheur, extrapolation
 * de la dette. Heures exprimées en heure de Paris ; dates internes AAAA-MM-JJ.
 */
import { ajouterJours, ajouterMois, ecartJours, jourSemaine, paques } from '../../core/dates.ts';

export type IdIndicateur = 'dette' | 'oat10' | 'eurusd' | 'brent';
export type Fraicheur = 'a_jour' | 'decalage_normal' | 'en_retard' | 'en_panne';

export const LIBELLES_FRAICHEUR: Record<Fraicheur, string> = {
  a_jour: 'À jour',
  decalage_normal: 'Décalage normal',
  en_retard: 'En retard',
  en_panne: 'Source en panne',
};

/** Règle de publication d'un indicateur (veille/marches-sources.json). */
export type ReglePublication =
  /** Une valeur par jour ouvré TARGET, publiée le jour même (ou le lendemain) à l'heure indiquée. */
  | { frequence: 'quotidienne'; heure: string; decalage_jours_ouvres?: number; tolerance_jours_ouvres: number }
  /** Valeurs quotidiennes publiées chaque semaine (Brent, EIA : le mercredi). */
  | { frequence: 'hebdomadaire'; jour_semaine: number; heure: string; tolerance_jours_ouvres: number }
  /** Une valeur par mois, publiée environ `decalage_jours` après la fin du mois. */
  | { frequence: 'mensuelle'; decalage_jours: number; heure: string | null; tolerance_jours_ouvres: number }
  /** Une valeur par trimestre, aux dates du calendrier officiel ; à défaut, environ `decalage_jours` après la fin du trimestre. */
  | { frequence: 'trimestrielle'; decalage_jours: number; heure: string | null; tolerance_jours_ouvres: number };

export interface ProchainePublication {
  date: string;
  heure: string | null;
  /** Vrai si la date est déduite de la fréquence, faux si elle vient du calendrier officiel. */
  estimee: boolean;
}

export interface Variation {
  /** Date de la valeur de comparaison. */
  depuis: string;
  /** Écart absolu (points pour un taux). */
  absolue: number;
  /** Écart relatif en %, null pour un taux (on parle alors en points de base). */
  relative: number | null;
}

export interface Variations {
  precedente: Variation | null;
  un_mois: Variation | null;
  debut_annee: Variation | null;
  un_an: Variation | null;
}

export interface SerieComplementaire {
  cle: string;
  libelle: string;
  unite: string;
  decimales: number;
  historique: [string, number][];
  source: string;
  lien: string;
}

/**
 * Lien vers la page où l'organisme publie la valeur du jour (ex. TEC 10 de la Banque de France),
 * quand sa licence interdit de reprendre la valeur elle-même : seule l'adresse est publiée.
 */
export interface LienDuJour {
  libelle: string;
  organisme: string;
  url: string;
  /** Date de la page liée ; null quand le lien mène à la page générale (page du jour introuvable). */
  date: string | null;
  /** Pourquoi la valeur n'est pas reprise (licence). */
  mention?: string;
}

export interface JournalCollecte {
  date: string;
  etat: 'ok' | 'sans_nouveaute' | 'erreur';
}

export interface IndicateurMarche {
  id: IdIndicateur;
  nom: string;
  unite: string;
  decimales: number;
  /** « taux » : variations en points de base ; « niveau » : variations en %. */
  genre: 'taux' | 'niveau';
  nature: string;
  valeur: number | null;
  date_valeur: string | null;
  /** Instant de récupération de la dernière valeur nouvelle (ISO). */
  recupere_le: string | null;
  variations: Variations;
  /** Historique (2 ans) : [date, valeur], du plus ancien au plus récent. */
  historique: [string, number][];
  /** Séries associées (dette : % du PIB, dette négociable de l'État). */
  complements: SerieComplementaire[];
  source: { id: string; organisme: string; libelle: string; lien: string; conditions: string; secours: boolean; nature: string };
  regle: ReglePublication;
  prochaine_publication: ProchainePublication | null;
  /** État de la dernière tentative de collecte. */
  derniere_tentative: string | null;
  derniere_reussite: string | null;
  derniere_erreur: string | null;
  /** Incident sans conséquence sur la valeur (source principale non configurée, série associée illisible…). */
  remarque: string | null;
  /** 30 derniers jours de collecte. */
  journal: JournalCollecte[];
  /** Valeur du jour consultable chez l'organisme (absente des fichiers antérieurs). */
  lien_du_jour?: LienDuJour | null;
}

export interface EvenementMarche {
  date: string;
  libelle: string;
  type: 'bce' | 'plf' | 'autre';
  source: string;
}

export interface MarchesJson {
  version: 1;
  genere_le: string;
  indicateurs: IndicateurMarche[];
  evenements: EvenementMarche[];
}

// --- Jours ouvrés des marchés (TARGET) et heure de Paris ---

/** Jours de fermeture TARGET : 1er janvier, Vendredi saint, lundi de Pâques, 1er mai, 25 et 26 décembre. */
export function estJourTarget(iso: string): boolean {
  const j = jourSemaine(iso);
  if (j === 0 || j === 6) return false;
  const md = iso.slice(5);
  if (md === '01-01' || md === '05-01' || md === '12-25' || md === '12-26') return false;
  const p = paques(Number(iso.slice(0, 4)));
  return iso !== ajouterJours(p, -2) && iso !== ajouterJours(p, 1);
}

export function jourTargetSuivant(iso: string, n = 1): string {
  let d = iso;
  for (let i = 0; i < n; ) {
    d = ajouterJours(d, 1);
    if (estJourTarget(d)) i++;
  }
  return d;
}

/** Jours ouvrés TARGET de a (exclu) à b (inclus). */
export function joursTargetEntre(a: string, b: string): number {
  if (b <= a) return 0;
  let n = 0;
  for (let d = ajouterJours(a, 1); d <= b; d = ajouterJours(d, 1)) if (estJourTarget(d)) n++;
  return n;
}

const FORMAT_PARIS = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** Date et heure de Paris d'un instant : { date: AAAA-MM-JJ, heure: HH:MM }. */
export function enHeureDeParis(instant: Date): { date: string; heure: string } {
  const p = Object.fromEntries(FORMAT_PARIS.formatToParts(instant).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, heure: `${p.hour}:${p.minute}` };
}

/** Instant correspondant à une date et une heure de Paris (heure d'été et d'hiver comprises). */
export function instantParis(date: string, heure: string | null): Date {
  const [h, m] = (heure ?? '00:00').split(':').map(Number) as [number, number];
  const naif = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), h, m);
  // Décalage de Paris à cet instant (1 h ou 2 h), recalculé une fois pour les heures proches du changement.
  let instant = naif;
  for (let i = 0; i < 2; i++) {
    const vu = enHeureDeParis(new Date(instant));
    const vuMs = Date.UTC(Number(vu.date.slice(0, 4)), Number(vu.date.slice(5, 7)) - 1, Number(vu.date.slice(8, 10)), Number(vu.heure.slice(0, 2)), Number(vu.heure.slice(3, 5)));
    instant += naif - vuMs;
  }
  return new Date(instant);
}

// --- Variations ---

/** Dernière valeur à la date `date` ou avant ; null si l'historique commence après. */
export function valeurAu(historique: readonly [string, number][], date: string): [string, number] | null {
  let trouve: [string, number] | null = null;
  for (const point of historique) {
    if (point[0] > date) break;
    trouve = point;
  }
  return trouve;
}

function variation(courant: [string, number], reference: [string, number] | null, genre: IndicateurMarche['genre']): Variation | null {
  if (!reference || reference[0] >= courant[0]) return null;
  const absolue = Math.round((courant[1] - reference[1]) * 1e6) / 1e6;
  const relative = genre === 'taux' || reference[1] === 0 ? null : Math.round(((courant[1] - reference[1]) / reference[1]) * 1e6) / 1e4;
  return { depuis: reference[0], absolue, relative };
}

/** Variations sur la publication précédente, 1 mois, depuis le 1er janvier et 1 an. */
export function calculerVariations(historique: readonly [string, number][], genre: IndicateurMarche['genre']): Variations {
  const vide: Variations = { precedente: null, un_mois: null, debut_annee: null, un_an: null };
  const dernier = historique.at(-1);
  if (!dernier) return vide;
  const date = dernier[0];
  return {
    precedente: variation(dernier, historique.at(-2) ?? null, genre),
    un_mois: variation(dernier, valeurAu(historique, ajouterMois(date, -1)), genre),
    debut_annee: variation(dernier, valeurAu(historique, `${Number(date.slice(0, 4)) - 1}-12-31`), genre),
    un_an: variation(dernier, valeurAu(historique, ajouterMois(date, -12)), genre),
  };
}

// --- Prochaine publication ---

/** Fin du mois ou du trimestre qui suit celui de `date`. */
function finPeriodeSuivante(date: string, mois: number): string {
  const debutSuivante = ajouterMois(`${date.slice(0, 7)}-01`, mois);
  return ajouterJours(ajouterMois(debutSuivante, 1), -1);
}

/**
 * Prochaine publication attendue après la valeur du `dateValeur` : calendrier officiel s'il contient
 * une date à venir, sinon déduite de la fréquence (marquée « estimée »).
 */
export function prochainePublication(
  regle: ReglePublication,
  dateValeur: string | null,
  maintenant: Date,
  calendrier: readonly { date: string; heure: string | null }[] = [],
): ProchainePublication | null {
  const auj = enHeureDeParis(maintenant);
  if (regle.frequence === 'trimestrielle' || regle.frequence === 'mensuelle') {
    const officielle = [...calendrier].sort((a, b) => a.date.localeCompare(b.date)).find((c) => instantParis(c.date, c.heure) > maintenant);
    if (officielle) return { date: officielle.date, heure: officielle.heure, estimee: false };
    if (!dateValeur) return null;
    const fin = finPeriodeSuivante(dateValeur, regle.frequence === 'trimestrielle' ? 3 : 1);
    let date = ajouterJours(fin, regle.decalage_jours);
    while (!estJourTarget(date)) date = ajouterJours(date, 1);
    return { date, heure: regle.heure, estimee: true };
  }
  if (regle.frequence === 'quotidienne') {
    const base = dateValeur ?? ajouterJours(auj.date, -1);
    // La valeur du jour J (jour TARGET suivant la dernière connue) est publiée J + décalage, à l'heure dite.
    const jour = jourTargetSuivant(base);
    const publication = regle.decalage_jours_ouvres ? jourTargetSuivant(jour, regle.decalage_jours_ouvres) : jour;
    return { date: publication, heure: regle.heure, estimee: true };
  }
  // Hebdomadaire : premier jour de publication postérieur d'au moins 2 jours à la dernière valeur.
  let date = ajouterJours(dateValeur ?? auj.date, 2);
  while (jourSemaine(date) !== regle.jour_semaine) date = ajouterJours(date, 1);
  return { date, heure: regle.heure, estimee: true };
}

// --- Fraîcheur ---

/**
 * « À jour » tant que la prochaine publication n'est pas passée ; « décalage normal » ensuite, dans la
 * tolérance de la source (jours ouvrés) ; « en retard » au-delà ; « source en panne » si la dernière
 * tentative de collecte a échoué.
 */
export function calculerFraicheur(
  i: Pick<IndicateurMarche, 'prochaine_publication' | 'regle' | 'derniere_erreur' | 'valeur'>,
  maintenant: Date,
): Fraicheur {
  if (i.derniere_erreur !== null || i.valeur === null) return 'en_panne';
  const p = i.prochaine_publication;
  if (!p) return 'a_jour';
  const echeance = instantParis(p.date, p.heure);
  if (maintenant < echeance) return 'a_jour';
  const limite = instantParis(jourTargetSuivant(p.date, i.regle.tolerance_jours_ouvres), p.heure ?? '23:59');
  return maintenant <= limite ? 'decalage_normal' : 'en_retard';
}

/**
 * Une nouvelle valeur est-elle attendue ? Oui si la prochaine publication est passée, si la dernière
 * tentative a échoué ou si l'on n'a encore aucune valeur. Le rattrapage quotidien interroge aussi ce qui
 * est en retard. Sinon la source n'est pas interrogée.
 */
export function nouvelleValeurAttendue(i: Pick<IndicateurMarche, 'prochaine_publication' | 'derniere_erreur' | 'valeur'>, maintenant: Date): boolean {
  if (i.valeur === null || i.derniere_erreur !== null || !i.prochaine_publication) return true;
  return maintenant >= instantParis(i.prochaine_publication.date, i.prochaine_publication.heure);
}

// --- Dette : estimation en temps réel ---

export interface Extrapolation {
  /** Valeur estimée à l'instant demandé, en euros. */
  valeur: number;
  /** Progression moyenne retenue, en euros par seconde. */
  parSeconde: number;
  base: { date: string; valeur: number };
  /** Nombre de trimestres utilisés pour la moyenne. */
  trimestres: number;
}

/**
 * Extrapolation linéaire de la dette (Md€ par trimestre) depuis le dernier chiffre officiel, à partir
 * de la variation moyenne des `n` derniers trimestres. La base est la fin du dernier trimestre publié.
 */
export function extrapolerDette(historique: readonly [string, number][], maintenant: Date, n = 4): Extrapolation | null {
  if (historique.length < 2) return null;
  const derniers = historique.slice(-(n + 1));
  const premier = derniers[0]!;
  const dernier = derniers.at(-1)!;
  const secondes = ecartJours(premier[0], dernier[0]) * 86_400;
  if (secondes <= 0) return null;
  const parSeconde = ((dernier[1] - premier[1]) * 1e9) / secondes;
  // Fin du trimestre à 24 h, heure de Paris.
  const base = instantParis(ajouterJours(dernier[0], 1), '00:00').getTime();
  const ecoulees = Math.max(0, (maintenant.getTime() - base) / 1000);
  return { valeur: dernier[1] * 1e9 + parSeconde * ecoulees, parSeconde, base: { date: dernier[0], valeur: dernier[1] }, trimestres: derniers.length - 1 };
}

// --- Lecture ---

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export function estMarches(v: unknown): v is MarchesJson {
  return estObjet(v) && v.version === 1 && Array.isArray(v.indicateurs) && Array.isArray(v.evenements);
}

// --- Prochaine récupération (« État des sources ») ---

/** Horaires de la collecte des marchés, heure de Paris, jours ouvrés : doivent rester alignés sur marches.yml. */
export const CRENEAUX_MARCHES = ['07:05', '09:02', '15:25', '16:20', '19:30'] as const;
/** Horaire de la collecte de la veille (veille.yml), jours ouvrés. */
export const CRENEAU_VEILLE = '06:30';

const estJourOuvreSemaine = (iso: string) => jourSemaine(iso) !== 0 && jourSemaine(iso) !== 6;

/** Premier créneau (jour ouvré, du lundi au vendredi) à partir de `apres`, parmi les horaires donnés. */
export function prochainCreneau(apres: Date, creneaux: readonly string[]): Date {
  let jour = enHeureDeParis(apres).date;
  for (let i = 0; i < 14; i++, jour = ajouterJours(jour, 1)) {
    if (!estJourOuvreSemaine(jour)) continue;
    for (const heure of creneaux) {
      const instant = instantParis(jour, heure);
      if (instant >= apres) return instant;
    }
  }
  return instantParis(jour, creneaux[0] ?? '00:00');
}

/** Prochaine interrogation d'un indicateur : premier créneau après la prochaine publication (ou tout de suite si elle est passée). */
export function prochaineRecuperation(i: Pick<IndicateurMarche, 'prochaine_publication' | 'derniere_erreur'>, maintenant: Date): Date {
  const publication = i.prochaine_publication && i.derniere_erreur === null ? instantParis(i.prochaine_publication.date, i.prochaine_publication.heure) : maintenant;
  return prochainCreneau(publication > maintenant ? publication : maintenant, CRENEAUX_MARCHES);
}
