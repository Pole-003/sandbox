/**
 * Panneaux de l'accueil : chacun lit une source de données réelle (news.json, marches.json, dossiers du navigateur)
 * et reste lisible sans elle (état de chargement, erreur, absence de données).
 */
import { h } from '../../app/dom.ts';
import { lireImport, listerDossiers } from '../fec/stockage/base-fec.ts';
import { formaterDate } from '../../core/format.ts';
import { dateIsoParis } from '../veille/dates-paris.ts';
import { MESSAGES_CHARGEMENT, chargerMarches, chargerNews, type Chargement } from '../veille/donnees.ts';
import { dateFr, lienExterne } from '../veille/ecran.ts';
import { blocEcheancesAccueil } from '../veille/ecran-echeances.ts';
import { badgeFraicheur, variationEnClair } from '../veille/ecran-suivi.ts';
import { dateCourte, nombreFr, sparkline } from '../veille/graphiques.ts';
import { briefDuJour, prochainesEcheances } from '../veille/logique.ts';
import { calculerFraicheur, type MarchesJson } from '../veille/marches.ts';
import type { NewsJson } from '../veille/modele.ts';

export type Annulation = { annule: boolean };

/** Cadre d'un panneau : titre, lien éventuel vers l'écran complet, contenu remplacé quand les données arrivent. */
function cadre(id: string, titre: string, lien: { href: string; texte: string } | null): { section: HTMLElement; corps: HTMLElement } {
  const corps = h('div', { class: 'accueil-corps' }, h('p', { class: 'texte-secondaire accueil-vide', role: 'status' }, 'Chargement…'));
  const section = h(
    'section',
    { class: 'carte accueil-panneau', 'aria-labelledby': `titre-${id}` },
    h('div', { class: 'accueil-tete' }, h('h2', { id: `titre-${id}` }, titre), lien ? h('a', { href: lien.href }, lien.texte) : null),
    corps,
  );
  return { section, corps };
}

const message = (texte: string) => h('p', { class: 'texte-secondaire accueil-vide' }, texte);

/** Remplit un panneau quand les données arrivent, sauf si l'écran a été quitté entre-temps. */
function remplir<T>(corps: HTMLElement, annulation: Annulation, donnees: Promise<Chargement<T>>, rendre: (d: T) => Node | Node[]): void {
  void donnees.then((r) => {
    if (annulation.annule) return;
    corps.replaceChildren(...(r.ok ? [rendre(r.donnees)].flat() : [message(MESSAGES_CHARGEMENT[r.raison])]));
  });
}

// --- Veille : articles d'importance 4 ou 5 ---
export function tableauArticles(news: NewsJson): HTMLElement {
  const articles = briefDuJour(news);
  if (articles.length === 0) return message('Aucune information d’importance 4 ou 5 sur la période.');
  return h(
    'div',
    { class: 'tableau-defilant' },
    h(
      'table',
      { class: 'tableau brief-liste' },
      h('caption', { class: 'visuellement-masque' }, 'Informations importantes de la veille'),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col', class: 'col-importance' }, 'Imp.'), h('th', { scope: 'col' }, 'Titre'), h('th', { scope: 'col' }, 'Source'), h('th', { scope: 'col', class: 'col-date' }, 'Date'))),
      h(
        'tbody',
        {},
        ...articles.map((a) =>
          h(
            'tr',
            {},
            h('td', { class: 'col-importance', title: a.importance === null ? 'Pas encore noté' : `Importance ${a.importance} sur 5` }, a.importance === null ? '–' : `${a.importance}/5`),
            h('td', { class: 'brief-titre' }, lienExterne(a.url, a.titre)),
            h('td', { class: 'texte-secondaire' }, a.source),
            h('td', { class: 'col-date' }, dateFr(a.date)),
          ),
        ),
      ),
    ),
  );
}

// --- Échéances : textes budgétaires puis échéances des entreprises ---
export function contenuEcheances(news: NewsJson, aujourdhui: string): Node[] {
  const textes = prochainesEcheances(news);
  const entreprises = blocEcheancesAccueil(news.echeances ?? [], aujourdhui);
  if (textes.length === 0 && !entreprises) return [message('Aucune échéance publiée sur la période.')];
  return [
    textes.length
      ? h(
          'div',
          { class: 'tableau-defilant' },
          h(
            'table',
            { class: 'tableau' },
            h('caption', { class: 'visuellement-masque' }, 'Prochaines étapes du PLF et du PLFSS'),
            h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Texte'), h('th', { scope: 'col' }, 'Prochaine échéance'), h('th', { scope: 'col', class: 'col-date' }, 'Date'), h('th', { scope: 'col' }, 'Étape actuelle'))),
            h(
              'tbody',
              {},
              ...textes.map((e) =>
                h(
                  'tr',
                  {},
                  h('th', { scope: 'row', class: 'col-texte' }, e.texte),
                  h('td', {}, e.libelle),
                  h('td', { class: 'col-date' }, e.date ? dateFr(e.date) : '—', e.indicative ? h('span', { class: 'texte-secondaire' }, ' (indicatif)') : null),
                  h('td', { class: 'texte-secondaire' }, e.etapeActuelle),
                ),
              ),
            ),
          ),
          h('a', { class: 'accueil-pied', href: '#/veille/suivi/plf' }, 'Voir le suivi PLF / PLFSS'),
        )
      : null,
    entreprises,
  ].filter((n): n is HTMLElement => n !== null);
}

// --- Indicateurs : dernières valeurs officielles, avec date, unité et source ---
export function tableauIndicateurs(m: MarchesJson, maintenant: Date): HTMLElement {
  if (m.indicateurs.length === 0) return message('Aucun indicateur publié.');
  return h(
    'div',
    { class: 'tableau-defilant' },
    h(
      'table',
      { class: 'tableau' },
      h('caption', { class: 'visuellement-masque' }, 'Indicateurs de marché et de finances publiques'),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Indicateur'), h('th', { scope: 'col', class: 'nombre' }, 'Valeur'), h('th', { scope: 'col', class: 'nombre' }, 'Variation'), h('th', { scope: 'col' }, 'Tendance'), h('th', { scope: 'col' }, 'Date · source'))),
      h(
        'tbody',
        {},
        ...m.indicateurs.map((i) => {
          const fraicheur = calculerFraicheur(i, maintenant);
          return h(
            'tr',
            {},
            h('th', { scope: 'row' }, i.nom, fraicheur === 'en_retard' || fraicheur === 'en_panne' ? h('span', { class: 'accueil-fraicheur' }, badgeFraicheur(fraicheur)) : null),
            h('td', { class: 'nombre' }, i.valeur === null ? '—' : `${nombreFr(i.valeur, i.decimales)} ${i.unite}`),
            h('td', { class: 'nombre', title: i.variations.precedente ? `Depuis le ${dateCourte(i.variations.precedente.depuis)}` : '' }, variationEnClair(i, i.variations.precedente)),
            h('td', { class: 'col-tendance' }, i.historique.length > 1 ? sparkline(i.historique.slice(-12).map(([, v]) => v), `Tendance : ${i.nom}`) : null),
            h('td', { class: 'texte-secondaire' }, i.date_valeur ? `${dateCourte(i.date_valeur)} · ` : '', i.source.organisme),
          );
        }),
      ),
    ),
  );
}

// --- Dossiers : ce que ce navigateur conserve ---
async function tableauDossiers(): Promise<HTMLElement> {
  const dossiers = await listerDossiers();
  if (dossiers.length === 0) {
    return h('p', { class: 'texte-secondaire accueil-vide' }, 'Aucun dossier dans ce navigateur. ', h('a', { href: '#/fec' }, 'Importez un FEC'), ' pour commencer.');
  }
  const lignes = await Promise.all(
    dossiers.map(async (d) => {
      const imp = d.fec.N ? await lireImport(d.fec.N) : null;
      return h(
        'tr',
        {},
        h('th', { scope: 'row' }, d.nom),
        h('td', { class: 'mono' }, d.siren ?? '—'),
        h('td', {}, imp?.meta.exercice ? `clôture ${dateFr(imp.meta.exercice.fin)} · ${imp.meta.nbLignes.toLocaleString('fr-FR')} lignes` : h('span', { class: 'texte-secondaire' }, 'pas de FEC')),
        h('td', { class: 'col-date' }, formaterDate(dateIsoParis(new Date(d.modifieLe)))),
      );
    }),
  );
  return h(
    'div',
    { class: 'tableau-defilant' },
    h(
      'table',
      { class: 'tableau' },
      h('caption', { class: 'visuellement-masque' }, 'Dossiers conservés dans ce navigateur'),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Dossier'), h('th', { scope: 'col' }, 'SIREN'), h('th', { scope: 'col' }, 'FEC de l’exercice'), h('th', { scope: 'col', class: 'col-date' }, 'Modifié'))),
      h('tbody', {}, ...lignes),
    ),
  );
}

export interface PanneauxAccueil {
  veille: HTMLElement;
  echeances: HTMLElement;
  indicateurs: HTMLElement;
  dossiers: HTMLElement;
  /** Résumé d'une ligne (collecte, nombre de dossiers), complété quand les données arrivent. */
  surResume: (cb: (texte: string) => void) => void;
}

export function creerPanneaux(annulation: Annulation, maintenant: Date): PanneauxAccueil {
  const aujourdhui = dateIsoParis(maintenant);
  const news = chargerNews();
  const veille = cadre('accueil-veille', 'Veille · à lire', { href: '#/veille', texte: 'Toute la veille' });
  const echeances = cadre('accueil-echeances', 'Échéances', { href: '#/veille/echeances', texte: 'Calendrier complet' });
  const indicateurs = cadre('accueil-indicateurs', 'Indicateurs', { href: '#/veille/suivi/marches', texte: 'Suivi détaillé' });
  const dossiers = cadre('accueil-dossiers', 'Dossiers locaux', { href: '#/fec', texte: 'Ouvrir FEC' });

  remplir(veille.corps, annulation, news, (n) => [tableauArticles(n), h('p', { class: 'note texte-secondaire accueil-pied' }, `Collecte du ${dateFr(n.genere_le)}. Extraits publiés par les sources : seul le texte officiel fait foi.`)]);
  remplir(echeances.corps, annulation, news, (n) => contenuEcheances(n, aujourdhui));
  remplir(indicateurs.corps, annulation, chargerMarches(), (m) => [tableauIndicateurs(m, maintenant), h('p', { class: 'note texte-secondaire accueil-pied' }, `Valeurs officielles relevées le ${dateFr(m.genere_le)}, publiées par chaque organisme.`)]);
  void tableauDossiers().then(
    (t) => !annulation.annule && dossiers.corps.replaceChildren(t),
    () => !annulation.annule && dossiers.corps.replaceChildren(message('Les dossiers de ce navigateur sont indisponibles (stockage local bloqué).')),
  );

  return {
    veille: veille.section,
    echeances: echeances.section,
    indicateurs: indicateurs.section,
    dossiers: dossiers.section,
    surResume(cb) {
      void Promise.all([news, listerDossiers().catch(() => null)]).then(([n, d]) => {
        if (annulation.annule) return;
        const parties = [n.ok ? `veille collectée le ${dateFr(n.donnees.genere_le)}` : 'veille indisponible', d === null ? null : `${d.length} dossier${d.length > 1 ? 's' : ''} dans ce navigateur`];
        cb(parties.filter(Boolean).join(' · '));
      });
    },
  };
}
