/**
 * Écran « Échéances » de la veille et bloc des 15 prochains jours de l'accueil.
 * Données : news.json (calendrier fiscal officiel + veille/echeances.json, fusionnés à la collecte).
 */
import { h } from '../../app/dom.ts';
import { ecartJours, jourSemaine } from '../../core/dates.ts';
import { dateFr, lienExterne } from './ecran.ts';
import { CATEGORIES_ECHEANCE, echeancesAVenir, LIBELLES_CATEGORIE, type CategorieEcheance, type EcheanceEntreprise } from './echeances.ts';

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** « Aujourd'hui », « Demain », « Dans 3 jours » ou « Passée ». */
export function delaiEnClair(date: string, aujourdhui: string): string {
  const ecart = ecartJours(aujourdhui, date);
  if (ecart < 0) return ecart === -1 ? 'Hier' : `Il y a ${-ecart} jours`;
  if (ecart === 0) return 'Aujourd’hui';
  if (ecart === 1) return 'Demain';
  return `Dans ${ecart} jours`;
}

function ligneEcheance(e: EcheanceEntreprise, aujourdhui: string, detail: boolean): HTMLElement {
  return h(
    'li',
    { class: `echeance echeance-${e.categorie}` },
    h('span', { class: `badge badge-categorie badge-categorie-${e.categorie}` }, LIBELLES_CATEGORIE[e.categorie]),
    h('div', { class: 'echeance-corps' },
      h('p', { class: 'echeance-titre' }, e.titre),
      detail && e.detail ? h('p', { class: 'echeance-detail' }, e.detail) : null,
      h('p', { class: 'echeance-source texte-secondaire' }, 'Source : ', lienExterne(e.url, e.source), detail ? '' : ` · ${dateFr(e.date)}, ${delaiEnClair(e.date, aujourdhui).toLowerCase()}`),
    ),
  );
}

/** Liste groupée par jour. */
function listeParJour(echeances: readonly EcheanceEntreprise[], aujourdhui: string): HTMLElement {
  const jours = new Map<string, EcheanceEntreprise[]>();
  for (const e of echeances) jours.set(e.date, [...(jours.get(e.date) ?? []), e]);
  return h(
    'div',
    { class: 'echeances-jours' },
    ...[...jours].map(([date, liste]) =>
      h(
        'section',
        { class: `echeances-jour${date === aujourdhui ? ' echeances-aujourdhui' : ''}`, 'aria-label': `Échéances du ${dateFr(date)}` },
        h('h3', { class: 'echeances-date' }, h('time', { datetime: date }, `${JOURS[jourSemaine(date)]} ${dateFr(date)}`), h('span', { class: 'texte-secondaire' }, ` · ${delaiEnClair(date, aujourdhui)}`)),
        h('ul', { class: 'liste-echeances' }, ...liste.map((e) => ligneEcheance(e, aujourdhui, true))),
      ),
    ),
  );
}

export function rendreEcheances(conteneur: HTMLElement, echeances: readonly EcheanceEntreprise[], aujourdhui: string): void {
  if (echeances.length === 0) {
    conteneur.append(h('p', { class: 'texte-secondaire' }, 'Aucune échéance publiée : elles apparaîtront après la prochaine collecte (jours ouvrés, 6 h 30).'));
    return;
  }
  const categorie = h('select', { id: 'echeances-categorie' }, h('option', { value: '' }, 'Toutes'), ...CATEGORIES_ECHEANCE.map((c) => h('option', { value: c }, LIBELLES_CATEGORIE[c])));
  const periode = h(
    'select',
    { id: 'echeances-periode' },
    h('option', { value: '15' }, '15 prochains jours'),
    h('option', { value: '31', selected: true }, '30 prochains jours'),
    h('option', { value: '100' }, '3 prochains mois'),
  );
  const compteur = h('p', { class: 'compteur', role: 'status', 'aria-live': 'polite' });
  const resultats = h('div', {});
  const afficher = () => {
    const visibles = echeancesAVenir(echeances, aujourdhui, Number(periode.value)).filter((e) => !categorie.value || e.categorie === (categorie.value as CategorieEcheance));
    compteur.textContent = `${visibles.length} échéance${visibles.length > 1 ? 's' : ''}`;
    resultats.replaceChildren(visibles.length ? listeParJour(visibles, aujourdhui) : h('p', { class: 'texte-secondaire vide' }, 'Aucune échéance sur cette période.'));
  };
  categorie.addEventListener('change', afficher);
  periode.addEventListener('change', afficher);
  conteneur.append(
    h('div', { class: 'filtres', role: 'search', 'aria-label': 'Filtrer les échéances' },
      h('div', { class: 'champ' }, h('label', { for: 'echeances-categorie' }, 'Catégorie'), categorie),
      h('div', { class: 'champ' }, h('label', { for: 'echeances-periode' }, 'Période'), periode),
    ),
    compteur,
    resultats,
    h('p', { class: 'note texte-secondaire' },
      'Calendrier fiscal officiel d’impots.gouv.fr (relu à chaque collecte) et échéances sociales et juridiques saisies par le pôle, chacune avec sa source. ',
      'Dates de droit commun : la date propre à chaque entreprise figure dans son espace professionnel.'),
  );
  afficher();
}

/** Bloc de l'accueil : les échéances des 15 prochains jours (8 au plus). */
export function blocEcheancesAccueil(echeances: readonly EcheanceEntreprise[], aujourdhui: string): HTMLElement | null {
  const prochaines = echeancesAVenir(echeances, aujourdhui, 15);
  if (prochaines.length === 0) return null;
  return h(
    'div',
    { class: 'brief-echeances-entreprises' },
    h('h3', {}, 'Échéances des 15 prochains jours'),
    h('ul', { class: 'liste-echeances liste-echeances-compacte' }, ...prochaines.slice(0, 8).map((e) => ligneEcheance(e, aujourdhui, false))),
    h('a', { href: '#/veille/echeances' }, prochaines.length > 8 ? `Voir les ${prochaines.length} échéances` : 'Voir toutes les échéances'),
  );
}
