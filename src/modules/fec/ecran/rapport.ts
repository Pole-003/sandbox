/** Rapport de conformité détaillé (écran). */
import { h } from '../../../app/dom.ts';
import type { Constat } from '../conformite/constats.ts';
import { LIEN_TEST_COMPTA_DEMAT, MENTION_RAPPORT, regle } from '../conformite/regles.ts';
import { badgeGravite, bouton, indicateurConformite, nombreFr } from './commun.ts';

const LIGNES_AFFICHEES = 200;

export function rendreRapport(
  constats: Constat[],
  nomFichier: string,
  actions: { exporter: () => void; retour: () => void },
): HTMLElement {
  const corps = constats.map((c) => {
    const r = regle(c.code);
    const lignes = c.lignes.slice(0, LIGNES_AFFICHEES).join(', ') + (c.lignes.length > LIGNES_AFFICHEES || c.lignes.length < c.occurrences ? ', …' : '');
    return h(
      'tr',
      {},
      h('th', { scope: 'row', class: 'mono' }, c.code),
      h(
        'td',
        {},
        h(
          'details',
          {},
          h('summary', {}, r.libelle),
          h('p', { class: 'note texte-secondaire' }, `Méthode : ${r.methode}`),
          c.details.length ? h('ul', { class: 'details-constat' }, ...c.details.slice(0, 50).map((d) => h('li', {}, d))) : null,
          c.lignes.length ? h('p', { class: 'note lignes-constat' }, `Lignes du fichier : ${lignes}`) : null,
        ),
      ),
      h('td', {}, badgeGravite(r.gravite)),
      h('td', { class: 'note' }, r.source),
      h('td', { class: 'nombre' }, nombreFr(c.occurrences)),
    );
  });
  return h(
    'section',
    { class: 'rapport', 'aria-labelledby': 'titre-rapport' },
    h('div', { class: 'actions' }, bouton('← Retour au dossier', actions.retour), bouton('Exporter le rapport (.xlsx)', actions.exporter, { primaire: true })),
    h('h2', { id: 'titre-rapport' }, `Rapport de conformité — ${nomFichier}`),
    h(
      'p',
      { class: 'avertissement-officiel' },
      `${MENTION_RAPPORT} `,
      h('a', { href: LIEN_TEST_COMPTA_DEMAT, target: '_blank', rel: 'noopener noreferrer' }, 'Télécharger Test Compta Demat sur economie.gouv.fr', h('span', { class: 'visuellement-masque' }, ' (nouvel onglet)')),
    ),
    indicateurConformite(constats),
    constats.length === 0
      ? h('p', { class: 'carte' }, 'Aucune anomalie détectée par les contrôles de l’outil.')
      : h(
          'div',
          { class: 'tableau-defilant', tabindex: '0', role: 'region', 'aria-label': 'Contrôles en anomalie' },
          h(
            'table',
            { class: 'tableau tableau-rapport' },
            h(
              'thead',
              {},
              h('tr', {}, h('th', { scope: 'col' }, 'Code'), h('th', { scope: 'col' }, 'Contrôle'), h('th', { scope: 'col' }, 'Gravité'), h('th', { scope: 'col' }, 'Source'), h('th', { scope: 'col', class: 'nombre' }, 'Occurrences')),
            ),
            h('tbody', {}, ...corps),
          ),
        ),
    h('p', { class: 'note texte-secondaire' }, '« Non conforme » : Test Compta Demat déclarerait le fichier non conforme. Ces constats n’empêchent pas l’analyse du FEC.'),
  );
}
