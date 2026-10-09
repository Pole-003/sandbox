/**
 * Calendrier fiscal officiel des professionnels (impots.gouv.fr), source « impots-calendrier-fiscal »
 * du catalogue (type « calendrier »).
 *
 * Une page par mois : https://www.impots.gouv.fr/professionnel/calendrier-fiscal/AAAA-MM (structure
 * relevée le 09/10/2026) : titres de jour <h3> (« À partir du » 05 <p class="--month">octobre</p>),
 * puis des cartes <h4 class="fr-card__title">Intitulé</h4><div class="fr-card__desc">Détail</div>.
 * robots.txt autorise ces pages.
 */
import type { EtatSource } from '../../src/modules/veille/modele.ts';
import type { CategorieEcheance, EcheanceEntreprise } from '../../src/modules/veille/echeances.ts';
import type { SourceCatalogue } from './config.ts';
import { avecNouvellesTentatives } from './couche-a.ts';
import { dateIsoParis } from './dates.ts';
import { decoderOctets, lireEncodageDeclare } from './encodage.ts';
import { texteBrut } from './flux.ts';
import type { ClientHttp } from './http.ts';
import { createHash } from 'node:crypto';

const MOIS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const sansAccents = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Catégorie d'une ligne du calendrier fiscal : sociale pour les déclarations sociales (DSN, PASRAU). */
export function categorieCalendrier(titre: string): CategorieEcheance {
  return /\b(dsn|pasrau)\b/i.test(titre) ? 'social' : 'fiscal';
}

/** Mois AAAA-MM et les `nombre` suivants. */
export function moisAConsulter(maintenant: Date, nombre = 3): string[] {
  const [annee, mois] = dateIsoParis(maintenant).split('-').map(Number) as [number, number];
  return Array.from({ length: nombre }, (_, i) => {
    const d = new Date(Date.UTC(annee, mois - 1 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

export const urlCalendrier = (mois: string) => `https://www.impots.gouv.fr/professionnel/calendrier-fiscal/${mois}`;

/** Lit une page mensuelle du calendrier. `mois` (AAAA-MM) fixe l'année ; une erreur si la page n'a pas la structure attendue. */
export function lireCalendrier(html: string, mois: string, url: string): EcheanceEntreprise[] {
  const titreMois = /id="mois_calendrier"[^>]*>([^<]+)</.exec(html)?.[1];
  if (!titreMois) throw new Error('titre du mois introuvable (structure de la page modifiée ?)');
  const annee = Number(mois.slice(0, 4));
  const echeances: EcheanceEntreprise[] = [];
  // Découpage par titre de jour : chaque morceau commence par un <h3> de date suivi de ses cartes.
  const morceaux = html.split(/<h3\b[^>]*>/).slice(1);
  for (const morceau of morceaux) {
    const entete = morceau.slice(0, morceau.indexOf('</h3>'));
    const jour = /(\d{1,2})\s*<p\b/.exec(entete)?.[1];
    const nomMois = /--month[^>]*>\s*([^<]+)</.exec(entete)?.[1];
    if (!jour || !nomMois) continue;
    const m = MOIS.indexOf(sansAccents(nomMois));
    if (m < 0) continue;
    // Un mois de janvier lu sur la page de décembre appartient à l'année suivante (et inversement).
    const moisPage = Number(mois.slice(5, 7));
    const anneeDate = moisPage === 12 && m === 0 ? annee + 1 : moisPage === 1 && m === 11 ? annee - 1 : annee;
    const date = `${anneeDate}-${String(m + 1).padStart(2, '0')}-${jour.padStart(2, '0')}`;
    for (const carte of morceau.matchAll(/<h4\b[^>]*fr-card__title[^>]*>([\s\S]*?)<\/h4>\s*(?:<div\b[^>]*fr-card__desc[^>]*>([\s\S]*?)<\/div>)?/g)) {
      const titre = texteBrut(carte[1] ?? '');
      if (!titre) continue;
      const detail = texteBrut(carte[2] ?? '') || null;
      const id = `impots-${date}-${createHash('sha256').update(`${titre}|${detail ?? ''}`).digest('hex').slice(0, 8)}`;
      echeances.push({ id, date, titre, detail, categorie: categorieCalendrier(titre), source: 'impots.gouv.fr — calendrier fiscal', url, origine: 'calendrier_officiel' });
    }
  }
  if (echeances.length === 0 && /fr-card__title/.test(html)) throw new Error('cartes du calendrier illisibles (structure de la page modifiée ?)');
  return echeances;
}

export async function collecterCalendrier(
  sources: readonly SourceCatalogue[],
  options: { client: ClientHttp; maintenant: Date; etatPrecedent: EtatSource[]; delaisNouvellesTentatives?: number[]; attendre?: (ms: number) => Promise<void> },
): Promise<{ echeances: EcheanceEntreprise[]; etats: EtatSource[]; moisLus: string[] }> {
  const etats: EtatSource[] = [];
  const echeances: EcheanceEntreprise[] = [];
  const moisLus: string[] = [];
  for (const source of sources.filter((s) => s.type === 'calendrier')) {
    const precedent = options.etatPrecedent.find((e) => e.id === source.id);
    const etat: EtatSource = {
      id: source.id, nom: source.nom, type: 'calendrier', theme: source.theme, statut_catalogue: source.statut, etat: 'inactive',
      derniere_tentative: options.maintenant.toISOString(), derniere_reussite: precedent?.derniere_reussite ?? null,
      erreur: null, nb_articles: 0, nb_elements: null, duree_ms: null,
    };
    if (source.statut !== 'verifie') {
      etats.push({ ...etat, derniere_tentative: precedent?.derniere_tentative ?? null, erreur: 'source à vérifier (non collectée)' });
      continue;
    }
    const erreurs: string[] = [];
    const debut = Date.now();
    for (const mois of moisAConsulter(options.maintenant)) {
      const url = urlCalendrier(mois);
      try {
        const r = await avecNouvellesTentatives(
          () => options.client.recuperer(url, source.robots ? { robots: source.robots } : {}),
          options.delaisNouvellesTentatives ?? [5_000, 15_000],
          options.attendre ?? ((ms) => new Promise((res) => setTimeout(res, ms))),
        );
        echeances.push(...lireCalendrier(decoderOctets(r.octets, lireEncodageDeclare(r.octets, r.contentType)).texte, mois, url));
        moisLus.push(mois);
      } catch (e) {
        erreurs.push(`${mois} : ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    etats.push({
      ...etat,
      etat: erreurs.length === 3 ? 'erreur' : 'ok',
      derniere_reussite: erreurs.length === 3 ? etat.derniere_reussite : etat.derniere_tentative,
      erreur: erreurs.join(' ; ') || null,
      nb_elements: echeances.length,
      nb_articles: echeances.length,
      duree_ms: Date.now() - debut,
    });
  }
  return { echeances, etats, moisLus };
}
