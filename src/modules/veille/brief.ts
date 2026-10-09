/**
 * Brief du jour pour l'accueil (docs/VEILLE.md) : les 5 articles d'importance 4 ou 5 les plus récents,
 * et la prochaine échéance du PLF et du PLFSS.
 */
import { h } from '../../app/dom.ts';
import { chargerNews, MESSAGES_CHARGEMENT } from './donnees.ts';
import { badgeImportance, dateFr, lienExterne, type Annulation } from './ecran.ts';
import { briefDuJour, prochainesEcheances } from './logique.ts';
import { blocEcheancesAccueil } from './ecran-echeances.ts';
import { dateIsoParis } from './dates-paris.ts';

export function sectionBrief(annulation: Annulation, maintenant: () => Date = () => new Date()): HTMLElement {
  const contenu = h('div', { class: 'brief-contenu' }, h('p', { class: 'texte-secondaire', role: 'status' }, 'Chargement du brief…'));
  const section = h(
    'section',
    { class: 'carte brief', 'aria-labelledby': 'titre-brief' },
    h('div', { class: 'brief-entete' }, h('h2', { id: 'titre-brief' }, 'Brief du jour'), h('a', { href: '#/veille' }, 'Toute la veille')),
    contenu,
  );

  void chargerNews().then((resultat) => {
    if (annulation.annule) return;
    if (!resultat.ok) {
      contenu.replaceChildren(h('p', { class: 'texte-secondaire' }, MESSAGES_CHARGEMENT[resultat.raison]));
      return;
    }
    const news = resultat.donnees;
    const articles = briefDuJour(news);
    const echeances = prochainesEcheances(news);
    contenu.replaceChildren(
      articles.length
        ? h(
            'ol',
            { class: 'brief-liste' },
            ...articles.map((a) =>
              h(
                'li',
                {},
                h('span', { class: 'brief-titre' }, lienExterne(a.url, a.titre)),
                h('span', { class: 'brief-meta' }, badgeImportance(a.importance), ` ${a.source} · ${dateFr(a.date)}`),
                a.resume ? h('span', { class: 'brief-resume' }, a.resume) : null,
              ),
            ),
          )
        : h('p', { class: 'texte-secondaire' }, 'Aucune information d’importance 4 ou 5 sur la période.'),
      echeances.length
        ? h(
            'div',
            { class: 'brief-echeances' },
            h('h3', {}, 'Prochaines échéances'),
            h(
              'ul',
              {},
              ...echeances.map((e) => h('li', {}, h('strong', {}, `${e.texte} : `), e.libelle, e.date ? ` (${dateFr(e.date)}${e.indicative ? ', délai indicatif' : ''})` : '', h('span', { class: 'texte-secondaire' }, ` — étape actuelle : ${e.etapeActuelle}`))),
            ),
            h('a', { href: '#/veille/plf' }, 'Voir le suivi PLF / PLFSS'),
          )
        : '',
      blocEcheancesAccueil(news.echeances ?? [], dateIsoParis(maintenant())) ?? '',
      h('p', { class: 'note texte-secondaire' }, `Collecte du ${dateFr(news.genere_le)}. Extraits publiés par les sources : seul le texte officiel fait foi.`),
    );
  });
  return section;
}
