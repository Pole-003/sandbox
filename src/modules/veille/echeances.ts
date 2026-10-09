/**
 * Échéances fiscales, sociales et juridiques des entreprises (logique pure, partagée entre la collecte
 * et le navigateur).
 *
 * Deux origines, chacune avec sa source officielle :
 *  - le calendrier fiscal officiel d'impots.gouv.fr, relu à chaque collecte (mois en cours et deux suivants) ;
 *  - veille/echeances.json, complété à la main : règles récurrentes (mensuelles, annuelles, « n-ième jour
 *    ouvré après une date ») et dates ponctuelles.
 * Une échéance qui tombe un samedi, un dimanche ou un jour férié est reportée au premier jour ouvré suivant,
 * sauf si la règle indique « report: false ».
 */
import { ajouterJours, ecartJours, estDateIso, estJourOuvre, finDeMois } from '../../core/dates.ts';

export const CATEGORIES_ECHEANCE = ['fiscal', 'social', 'juridique'] as const;
export type CategorieEcheance = (typeof CATEGORIES_ECHEANCE)[number];

export const LIBELLES_CATEGORIE: Record<CategorieEcheance, string> = { fiscal: 'Fiscal', social: 'Social', juridique: 'Juridique' };

export interface EcheanceEntreprise {
  id: string;
  /** AAAA-MM-JJ. */
  date: string;
  titre: string;
  detail: string | null;
  categorie: CategorieEcheance;
  /** Émetteur de la source officielle (impots.gouv.fr, URSSAF, service-public.fr…). */
  source: string;
  url: string;
  origine: 'calendrier_officiel' | 'saisie';
}

interface BaseRegle {
  id: string;
  titre: string;
  detail?: string;
  categorie: CategorieEcheance;
  source: string;
  url: string;
  /** Report au premier jour ouvré suivant (défaut : oui). */
  report?: boolean;
}

export type RegleEcheance = BaseRegle &
  (
    | { mensuelle: { jour: number; mois?: number[] } }
    | { annuelle: { jour: number; mois: number } }
    /** Le « rang »-ième jour ouvré après le jour/mois indiqué, plus un délai éventuel (liasse fiscale : 2e jour ouvré après le 1er mai, + 15 jours). */
    | { jours_ouvres_apres: { jour: number; mois: number; rang: number; plus_jours?: number } }
  );

export interface EcheanceSaisie {
  id: string;
  date: string;
  titre: string;
  detail?: string;
  categorie: CategorieEcheance;
  source: string;
  url: string;
}

export interface FichierEcheances {
  mis_a_jour_le: string;
  regles: RegleEcheance[];
  ponctuelles: EcheanceSaisie[];
}

const deux = (n: number) => String(n).padStart(2, '0');

/** Premier jour ouvré à partir de `iso` (inclus). */
export function jourOuvreSuivant(iso: string): string {
  let d = iso;
  while (!estJourOuvre(d)) d = ajouterJours(d, 1);
  return d;
}

/** Date du jour `jour` du mois, bornée à la fin du mois (31 → 30 en avril). */
function dateDuMois(annee: number, mois: number, jour: number): string {
  const premier = `${annee}-${deux(mois)}-01`;
  const fin = finDeMois(premier);
  return Number(fin.slice(8)) < jour ? fin : `${annee}-${deux(mois)}-${deux(jour)}`;
}

/** Le n-ième jour ouvré strictement après `iso`. */
export function nIemeJourOuvreApres(iso: string, rang: number): string {
  let d = iso;
  for (let n = 0; n < rang; ) {
    d = ajouterJours(d, 1);
    if (estJourOuvre(d)) n++;
  }
  return d;
}

/** Dates brutes d'une règle entre `du` et `au` (inclus), avant report. */
function datesRegle(regle: RegleEcheance, du: string, au: string): string[] {
  const dates: string[] = [];
  const anneeDebut = Number(du.slice(0, 4)) - 1;
  const anneeFin = Number(au.slice(0, 4)) + 1;
  for (let annee = anneeDebut; annee <= anneeFin; annee++) {
    if ('mensuelle' in regle) {
      for (let mois = 1; mois <= 12; mois++) {
        if (!regle.mensuelle.mois || regle.mensuelle.mois.includes(mois)) dates.push(dateDuMois(annee, mois, regle.mensuelle.jour));
      }
    } else if ('annuelle' in regle) {
      dates.push(dateDuMois(annee, regle.annuelle.mois, regle.annuelle.jour));
    } else {
      const r = regle.jours_ouvres_apres;
      dates.push(ajouterJours(nIemeJourOuvreApres(dateDuMois(annee, r.mois, r.jour), r.rang), r.plus_jours ?? 0));
    }
  }
  return dates;
}

/** Échéances du fichier saisi à la main entre `du` et `au` (inclus), reports appliqués. */
export function developperEcheances(fichier: FichierEcheances, du: string, au: string): EcheanceEntreprise[] {
  const resultat: EcheanceEntreprise[] = [];
  for (const regle of fichier.regles) {
    for (const brute of datesRegle(regle, du, au)) {
      const date = regle.report === false ? brute : jourOuvreSuivant(brute);
      if (date < du || date > au) continue;
      resultat.push({
        id: `${regle.id}-${date}`, date, titre: regle.titre, detail: regle.detail ?? null, categorie: regle.categorie,
        source: regle.source, url: regle.url, origine: 'saisie',
      });
    }
  }
  for (const p of fichier.ponctuelles) {
    if (p.date < du || p.date > au) continue;
    resultat.push({ id: p.id, date: p.date, titre: p.titre, detail: p.detail ?? null, categorie: p.categorie, source: p.source, url: p.url, origine: 'saisie' });
  }
  return trierEcheances(resultat);
}

export function trierEcheances(echeances: readonly EcheanceEntreprise[]): EcheanceEntreprise[] {
  return [...echeances].sort((a, b) => a.date.localeCompare(b.date) || a.categorie.localeCompare(b.categorie) || a.titre.localeCompare(b.titre, 'fr'));
}

const cle = (e: EcheanceEntreprise) => `${e.date}|${e.titre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()}`;

/** Réunit les deux origines ; à date et intitulé égaux, le calendrier officiel l'emporte. */
export function fusionnerEcheances(officielles: readonly EcheanceEntreprise[], saisies: readonly EcheanceEntreprise[]): EcheanceEntreprise[] {
  const vues = new Set(officielles.map(cle));
  return trierEcheances([...officielles, ...saisies.filter((e) => !vues.has(cle(e)))]);
}

/** Échéances des `jours` prochains jours (aujourd'hui compris). */
export function echeancesAVenir(echeances: readonly EcheanceEntreprise[], aujourdhui: string, jours = 15): EcheanceEntreprise[] {
  return echeances.filter((e) => {
    const ecart = ecartJours(aujourdhui, e.date);
    return ecart >= 0 && ecart < jours;
  });
}

/** Contrôle du fichier saisi à la main : messages en français, vides si tout va bien. */
export function verifierFichierEcheances(f: FichierEcheances): string[] {
  const erreurs: string[] = [];
  const ids = new Set<string>();
  const commun = (e: { id: string; titre: string; categorie: string; source: string; url: string }, ou: string) => {
    if (!e.id || ids.has(e.id)) erreurs.push(`${ou} : identifiant absent ou en double (« ${e.id} »)`);
    ids.add(e.id);
    if (!e.titre) erreurs.push(`${ou} : intitulé absent`);
    if (!(CATEGORIES_ECHEANCE as readonly string[]).includes(e.categorie)) erreurs.push(`${ou} : catégorie inconnue « ${e.categorie} »`);
    if (!e.source || !/^https:\/\//.test(e.url)) erreurs.push(`${ou} : source officielle (nom et lien https) obligatoire`);
  };
  for (const r of f.regles ?? []) {
    commun(r, `règle « ${r.id} »`);
    const jour = 'mensuelle' in r ? r.mensuelle.jour : 'annuelle' in r ? r.annuelle.jour : 'jours_ouvres_apres' in r ? r.jours_ouvres_apres.jour : NaN;
    if (!(jour >= 1 && jour <= 31)) erreurs.push(`règle « ${r.id} » : jour invalide`);
  }
  for (const p of f.ponctuelles ?? []) {
    commun(p, `échéance « ${p.id} »`);
    if (!estDateIso(p.date)) erreurs.push(`échéance « ${p.id} » : date invalide « ${p.date} »`);
  }
  return erreurs;
}
