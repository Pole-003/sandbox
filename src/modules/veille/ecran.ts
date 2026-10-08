/**
 * Écran Veille : fil filtrable, suivi PLF / PLFSS, indicateurs, Rennes et Bretagne, état des sources.
 * Le navigateur ne charge que news.json et veille-etat.json ; les liens vers les sources s'ouvrent
 * dans un nouvel onglet et ne transportent aucune donnée.
 */
import { h } from '../../app/dom.ts';
import { formaterDate } from '../../core/format.ts';
import { chargerEtat, chargerNews, MESSAGES_CHARGEMENT } from './donnees.ts';
import {
  ageEnJours,
  CRITERES_PAR_DEFAUT,
  filtrerArticles,
  sourcesPresentes,
  type Criteres,
  type Marque,
} from './logique.ts';
import { ouvrirMagasin, type MagasinMarques } from './marques.ts';
import {
  LIBELLES_TYPE,
  PUBLICS,
  THEMES,
  type Article,
  type EtatVeille,
  type Importance,
  type NewsJson,
  type SuiviTexte,
} from './modele.ts';

export const ONGLETS = [
  { id: 'fil', libelle: 'Fil d’actualité' },
  { id: 'plf', libelle: 'Suivi PLF / PLFSS' },
  { id: 'indicateurs', libelle: 'Indicateurs' },
  { id: 'rennes', libelle: 'Rennes et Bretagne' },
  { id: 'sources', libelle: 'État des sources' },
] as const;
export type IdOnglet = (typeof ONGLETS)[number]['id'];

/** Onglet demandé par l'adresse : « #/veille/plf ». */
export function ongletDepuisAncre(ancre: string): IdOnglet {
  const sous = ancre.replace(/^#\/?/, '').split('/')[1] ?? '';
  return (ONGLETS.find((o) => o.id === sous)?.id ?? 'fil') as IdOnglet;
}

/** Date ISO ou date-heure → JJ/MM/AAAA (tolère une valeur invalide). */
export function dateFr(valeur: string | null | undefined): string {
  if (!valeur) return '—';
  try {
    return formaterDate(valeur.slice(0, 10));
  } catch {
    return valeur;
  }
}

function heureFr(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
}

/** Lien vers une source externe : nouvel onglet, sans référent ni accès à la page d'origine. */
export function lienExterne(url: string, ...contenu: (Node | string)[]): HTMLAnchorElement {
  return h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, ...contenu, h('span', { class: 'visuellement-masque' }, ' (nouvel onglet)'));
}

export function badgeImportance(importance: Importance | null): HTMLElement | null {
  if (importance === null) return h('span', { class: 'badge badge-neutre', title: 'Pas encore noté' }, 'Non noté');
  const niveau = importance >= 4 ? 'forte' : importance === 3 ? 'moyenne' : 'faible';
  return h('span', { class: `badge badge-importance badge-importance-${niveau}`, title: 'Importance pour le métier, de 1 à 5' }, `Importance ${importance}/5`);
}

function ligneMeta(a: Article): HTMLElement {
  return h(
    'p',
    { class: 'article-meta' },
    h('span', {}, `Source : ${a.source}`),
    h('span', {}, h('time', { datetime: a.date }, dateFr(a.date))),
    h('span', {}, a.theme),
    a.type ? h('span', {}, LIBELLES_TYPE[a.type]) : null,
  );
}

// --- Fil ---

function carteArticle(a: Article, marque: Marque | undefined, basculer: (champ: keyof Marque) => void): HTMLElement {
  const bouton = (champ: keyof Marque, libelle: string) =>
    h('button', { type: 'button', class: 'bouton-marque', 'aria-pressed': String(Boolean(marque?.[champ])), 'data-marque': champ }, libelle);
  const carte = h(
    'article',
    { class: `carte article${marque?.lu ? ' article-lu' : ''}${marque?.important ? ' article-important' : ''}`, 'data-id': a.id },
    h('div', { class: 'article-badges' }, badgeImportance(a.importance), a.origine !== 'flux' ? h('span', { class: 'badge badge-ia', title: 'Repéré par la recherche IA quotidienne' }, a.origine === 'recherche_ia' ? 'Recherche IA' : 'Flux + IA') : null),
    h('h3', { class: 'article-titre' }, lienExterne(a.url, a.titre)),
    ligneMeta(a),
    a.resume ? h('p', { class: 'article-resume' }, a.resume) : h('p', { class: 'article-resume texte-secondaire' }, 'Pas de résumé disponible : consultez la source.'),
    a.public.length ? h('p', { class: 'article-public' }, h('span', { class: 'visuellement-masque' }, 'Public concerné : '), ...a.public.map((p) => h('span', { class: 'puce' }, p))) : null,
    h('div', { class: 'article-actions' }, bouton('lu', 'Lu'), bouton('important', 'Important pour nos dossiers')),
  );
  for (const b of carte.querySelectorAll<HTMLButtonElement>('.bouton-marque')) {
    b.addEventListener('click', () => basculer(b.dataset.marque as keyof Marque));
  }
  return carte;
}

function champ(libelle: string, controle: HTMLElement, id: string): HTMLElement {
  controle.id = id;
  return h('div', { class: 'champ' }, h('label', { for: id }, libelle), controle);
}

function liste<T extends string>(options: readonly (readonly [T, string])[], valeur: string): HTMLSelectElement {
  const select = h('select', {});
  for (const [v, texte] of options) select.append(h('option', { value: v, selected: v === valeur }, texte));
  return select;
}

interface ContexteFil {
  articles: readonly Article[];
  marques: Map<string, Marque>;
  magasin: MagasinMarques;
  criteres: Criteres;
  /** Thème imposé (onglet Rennes et Bretagne). */
  themeFixe?: Article['theme'];
}

function rendreFil(conteneur: HTMLElement, ctx: ContexteFil): void {
  const c = { ...ctx.criteres, ...(ctx.themeFixe ? { theme: ctx.themeFixe } : {}) };
  const prefixe = ctx.themeFixe ? 'rennes' : 'fil';
  const base = ctx.themeFixe ? ctx.articles.filter((a) => a.theme === ctx.themeFixe) : ctx.articles;

  const theme = liste([['', 'Tous les thèmes'], ...THEMES.map((t) => [t, t] as const)], c.theme);
  const source = liste([['', 'Toutes les sources'], ...sourcesPresentes(base).map((s) => [s, s] as const)], c.source);
  const importance = liste(
    [['0', 'Toutes, y compris marginales'], ['2', '2 et plus'], ['3', '3 et plus'], ['4', '4 et plus (essentiel)']],
    String(c.importanceMin),
  );
  const publicCible = liste([['', 'Tous les publics'], ...PUBLICS.map((p) => [p, p] as const)], c.public);
  const recherche = h('input', { type: 'search', placeholder: 'Mots du titre, du résumé ou de la source', value: c.recherche, autocomplete: 'off' });
  const nonLus = h('input', { type: 'checkbox', checked: c.nonLus });
  const importants = h('input', { type: 'checkbox', checked: c.importants });
  const compteur = h('p', { class: 'compteur', role: 'status', 'aria-live': 'polite' });
  const resultats = h('div', { class: 'liste-articles' });

  const filtres = h(
    'div',
    { class: 'filtres', role: 'search', 'aria-label': 'Filtrer les actualités' },
    ctx.themeFixe ? null : champ('Thème', theme, `${prefixe}-theme`),
    champ('Source', source, `${prefixe}-source`),
    champ('Importance', importance, `${prefixe}-importance`),
    champ('Public', publicCible, `${prefixe}-public`),
    champ('Recherche', recherche, `${prefixe}-recherche`),
    h(
      'div',
      { class: 'champ champ-cases' },
      h('label', {}, nonLus, ' Non lus seulement'),
      h('label', {}, importants, ' Importants pour nos dossiers'),
    ),
  );

  const afficher = () => {
    Object.assign(ctx.criteres, {
      theme: ctx.themeFixe ? ctx.criteres.theme : (theme.value as Criteres['theme']),
      source: source.value,
      importanceMin: Number(importance.value) as Criteres['importanceMin'],
      public: publicCible.value as Criteres['public'],
      recherche: recherche.value,
      nonLus: nonLus.checked,
      importants: importants.checked,
    } satisfies Criteres);
    const visibles = filtrerArticles(base, { ...ctx.criteres, ...(ctx.themeFixe ? { theme: ctx.themeFixe } : {}) }, ctx.marques);
    compteur.textContent = `${visibles.length} article${visibles.length > 1 ? 's' : ''} sur ${base.length}`;
    resultats.replaceChildren(
      ...(visibles.length
        ? visibles.map((a) =>
            carteArticle(a, ctx.marques.get(a.id), (champMarque) => {
              const actuelle = ctx.marques.get(a.id) ?? { lu: false, important: false };
              const nouvelle = { ...actuelle, [champMarque]: !actuelle[champMarque] };
              ctx.marques.set(a.id, nouvelle);
              void ctx.magasin.enregistrer(a.id, nouvelle);
              // On reconstruit la liste pour appliquer les filtres, en gardant le focus sur le bouton utilisé
              // (ou sur le compteur si l'article vient de sortir de la sélection).
              afficher();
              const bouton = resultats.querySelector<HTMLButtonElement>(`[data-id="${a.id}"] [data-marque="${champMarque}"]`);
              if (bouton) {
                bouton.focus();
              } else {
                compteur.tabIndex = -1;
                compteur.focus();
              }
            }),
          )
        : [h('p', { class: 'texte-secondaire vide' }, 'Aucun article ne correspond à ces critères.')]),
    );
  };
  for (const controle of [theme, source, importance, publicCible, nonLus, importants]) controle.addEventListener('change', afficher);
  recherche.addEventListener('input', afficher);

  conteneur.append(
    filtres,
    ctx.magasin.persistant ? '' : h('p', { class: 'note' }, 'Ce navigateur ne permet pas de conserver les marques « lu » et « important » : elles seront perdues en quittant la page.'),
    compteur,
    resultats,
  );
  afficher();
}

// --- Suivi PLF / PLFSS ---

const LIBELLES_STATUT = { fait: 'Fait', en_cours: 'En cours', a_venir: 'À venir' } as const;

function frise(suivi: SuiviTexte | null, nom: string): HTMLElement {
  if (!suivi) {
    return h('section', { class: 'carte suivi' }, h('h2', {}, nom), h('p', { class: 'texte-secondaire' }, 'Pas encore de suivi : il est alimenté par la recherche IA quotidienne.'));
  }
  return h(
    'section',
    { class: 'carte suivi', 'aria-label': `Suivi du ${suivi.texte}` },
    h('h2', {}, suivi.texte),
    h('p', {}, h('strong', {}, 'Étape actuelle : '), suivi.etape_actuelle),
    suivi.prochaine_echeance
      ? h('p', {}, h('strong', {}, 'Prochaine échéance : '), suivi.prochaine_echeance.libelle, suivi.prochaine_echeance.date ? ` (${dateFr(suivi.prochaine_echeance.date)})` : '')
      : null,
    h(
      'ol',
      { class: 'frise' },
      ...suivi.etapes.map((e) =>
        h(
          'li',
          { class: `frise-etape frise-${e.statut}`, 'aria-current': e.statut === 'en_cours' ? 'step' : false },
          h('span', { class: 'frise-libelle' }, e.libelle),
          h('span', { class: 'frise-detail' }, `${LIBELLES_STATUT[e.statut]}${e.date ? ` · ${dateFr(e.date)}` : ''}`),
        ),
      ),
    ),
    h('p', { class: 'texte-secondaire note' }, `Mis à jour le ${dateFr(suivi.mis_a_jour_le)} par la recherche IA : à recouper avec les dossiers législatifs officiels.`),
  );
}

function rendreSuivi(conteneur: HTMLElement, news: NewsJson): void {
  const dossiers = news.articles.filter((a) => a.source_id === 'an-dossier-plf');
  conteneur.append(
    h('div', { class: 'grille-suivi' }, frise(news.suivi.plf, 'Projet de loi de finances'), frise(news.suivi.plfss, 'Projet de loi de financement de la sécurité sociale')),
    dossiers.length
      ? h('section', { class: 'carte' }, h('h2', {}, 'Changements détectés sur le dossier législatif'), h('ul', {}, ...dossiers.map((a) => h('li', {}, lienExterne(a.url, a.titre), ` — ${dateFr(a.date)}`))))
      : '',
  );
}

// --- Indicateurs ---

function rendreIndicateurs(conteneur: HTMLElement, news: NewsJson): void {
  if (news.indicateurs.length === 0) {
    conteneur.append(h('p', { class: 'texte-secondaire' }, 'Aucun indicateur publié pour l’instant : ils sont relevés par la recherche IA quotidienne (thème « Économie et statistiques »).'));
    return;
  }
  conteneur.append(
    h(
      'ul',
      { class: 'grille-indicateurs' },
      ...news.indicateurs.map((i) =>
        h(
          'li',
          { class: 'carte tuile' },
          h('p', { class: 'tuile-libelle' }, i.libelle),
          h('p', { class: 'tuile-valeur' }, i.valeur),
          h('p', { class: 'tuile-periode' }, i.periode),
          h('p', { class: 'tuile-source' }, 'Source : ', lienExterne(i.url, i.source), ` · publié le ${dateFr(i.date_publication)}`),
          i.verifie_par_api ? null : h('span', { class: 'badge badge-alerte' }, 'Source IA, à vérifier'),
        ),
      ),
    ),
  );
}

// --- État des sources ---

const LIBELLES_NOTATION = { executee: 'exécutée', sautee: 'sautée', echec: 'en échec' } as const;
const LIBELLES_ETAT = { ok: 'OK', erreur: 'En échec', inactive: 'Inactive', non_configuree: 'Non configurée' } as const;

function rendreEtat(conteneur: HTMLElement, etat: EtatVeille | null): void {
  if (!etat) {
    conteneur.append(h('p', { class: 'texte-secondaire' }, 'L’état des sources n’est pas encore disponible.'));
    return;
  }
  const usd = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} $`;
  const c = etat.couche_c;
  conteneur.append(
    h('p', {}, `Dernière collecte : ${dateFr(etat.genere_le)} à ${heureFr(etat.genere_le)}.`),
    h(
      'div',
      { class: 'tableau-defilant' },
      h(
        'table',
        { class: 'tableau' },
        h('caption', { class: 'visuellement-masque' }, 'État des sources de la couche A (flux officiels)'),
        h('thead', {}, h('tr', {}, ...['Source', 'Type', 'État', 'Dernière réussite', 'Articles', 'Détail'].map((t) => h('th', { scope: 'col' }, t)))),
        h(
          'tbody',
          {},
          ...etat.sources.map((s) =>
            h(
              'tr',
              {},
              h('th', { scope: 'row' }, s.nom),
              h('td', {}, s.type),
              h('td', {}, h('span', { class: `badge badge-etat-${s.etat}` }, LIBELLES_ETAT[s.etat])),
              h('td', {}, s.derniere_reussite ? `${dateFr(s.derniere_reussite)} ${heureFr(s.derniere_reussite)}` : '—'),
              h('td', { class: 'nombre' }, String(s.nb_articles)),
              h('td', {}, s.erreur ?? ''),
            ),
          ),
        ),
      ),
    ),
    h(
      'section',
      { class: 'carte' },
      h('h2', {}, 'Recherche IA (couche C)'),
      h('p', {}, `Statut : ${c.statut === 'executee' ? 'exécutée' : c.statut === 'partielle' ? 'partielle' : 'sautée'}${c.raison ? ` — ${c.raison}` : ''}.`),
      c.themes.length
        ? h(
            'ul',
            {},
            ...c.themes.map((t) => h('li', {}, `${t.theme} : ${t.statut === 'ok' ? `${t.retenus} retenu(s), ${t.rejetes} rejeté(s)` : `abandonné (${t.erreur ?? 'erreur'})`}, ${t.recherches} recherche(s), ${usd(t.cout_usd)}`)),
          )
        : null,
      h('p', {}, `Notation des flux : ${LIBELLES_NOTATION[etat.notation.statut]}${etat.notation.raison ? ` — ${etat.notation.raison}` : ''}.`),
      h('p', {}, h('strong', {}, 'Coût : '), `aujourd’hui ${usd(etat.couts.jour_usd)} · mois ${usd(etat.couts.mois_usd)} sur un budget de ${usd(etat.couts.budget_mensuel_usd)}`),
    ),
  );
}

// --- Mention des sources ---

function mentionSources(news: NewsJson): HTMLElement {
  return h(
    'footer',
    { class: 'mention-sources' },
    h('h2', {}, 'Sources'),
    h(
      'p',
      {},
      'Flux officiels consultés : ',
      ...news.sources.flatMap((s, i) => [i ? ', ' : '', s.url ? lienExterne(s.url, s.nom) : s.nom]),
      '. Recherche IA : la source de chaque information est indiquée sous l’article. Les résumés sont rédigés par nos soins ; seul le texte officiel fait foi.',
    ),
  );
}

// --- Écran ---

export interface Annulation {
  annule: boolean;
}

export async function rendreVeille(
  conteneur: HTMLElement,
  options: { magasin?: MagasinMarques; maintenant?: Date; annulation?: Annulation } = {},
): Promise<void> {
  const ongletInitial = ongletDepuisAncre(location.hash);
  const statut = h('p', { class: 'texte-secondaire', role: 'status' }, 'Chargement de la veille…');
  conteneur.append(h('h1', { tabindex: '-1' }, 'Veille'), statut);

  const [resultat, resultatEtat, magasin] = await Promise.all([chargerNews(), chargerEtat(), options.magasin ? Promise.resolve(options.magasin) : ouvrirMagasin()]);
  // L'utilisateur a quitté l'écran pendant le chargement : on n'ajoute rien.
  if (options.annulation?.annule) return;
  if (!resultat.ok) {
    statut.textContent = MESSAGES_CHARGEMENT[resultat.raison];
    return;
  }
  const news = resultat.donnees;
  const etat = resultatEtat.ok ? resultatEtat.donnees : null;
  const age = ageEnJours(news.genere_le, options.maintenant ?? new Date());
  statut.replaceChildren(
    `Collecte du ${dateFr(news.genere_le)} à ${heureFr(news.genere_le)} · ${news.articles.length} articles sur 60 jours.`,
    age > 3 ? h('strong', { class: 'alerte-texte' }, ` Attention : la dernière collecte date de ${age} jours.`) : '',
  );

  const marques = await magasin.toutes();
  if (options.annulation?.annule) return;
  const criteresFil: Criteres = { ...CRITERES_PAR_DEFAUT };
  const criteresRennes: Criteres = { ...CRITERES_PAR_DEFAUT };

  const liste = h('div', { class: 'onglets', role: 'tablist', 'aria-label': 'Rubriques de la veille' });
  const panneau = h('div', { class: 'panneau', role: 'tabpanel', tabindex: '0' });
  const boutons = ONGLETS.map((o) =>
    h('button', { type: 'button', role: 'tab', id: `onglet-${o.id}`, class: 'onglet', 'aria-controls': 'panneau-veille' }, o.libelle),
  );
  panneau.id = 'panneau-veille';
  liste.append(...boutons);

  const activer = (id: IdOnglet, focus = false) => {
    boutons.forEach((b, i) => {
      const actif = ONGLETS[i]?.id === id;
      b.setAttribute('aria-selected', String(actif));
      b.tabIndex = actif ? 0 : -1;
      if (actif && focus) b.focus();
    });
    panneau.setAttribute('aria-labelledby', `onglet-${id}`);
    panneau.replaceChildren();
    // L'adresse reflète l'onglet sans relancer le rendu de l'écran (replaceState ne déclenche pas « hashchange »).
    history.replaceState(null, '', `#/veille${id === 'fil' ? '' : `/${id}`}`);
    if (id === 'fil') rendreFil(panneau, { articles: news.articles, marques, magasin, criteres: criteresFil });
    if (id === 'rennes') rendreFil(panneau, { articles: news.articles, marques, magasin, criteres: criteresRennes, themeFixe: 'Rennes et Bretagne' });
    if (id === 'plf') rendreSuivi(panneau, news);
    if (id === 'indicateurs') rendreIndicateurs(panneau, news);
    if (id === 'sources') rendreEtat(panneau, etat);
  };
  boutons.forEach((b, i) => {
    b.addEventListener('click', () => activer(ONGLETS[i]!.id));
    b.addEventListener('keydown', (e) => {
      const cible = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: ONGLETS.length - 1 }[e.key];
      if (cible === undefined) return;
      e.preventDefault();
      activer(ONGLETS[(cible + ONGLETS.length) % ONGLETS.length]!.id, true);
    });
  });

  conteneur.append(liste, panneau, mentionSources(news));
  activer(ongletInitial);
}
