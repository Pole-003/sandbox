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
  type ArticleProjet,
  type SuiviTexte,
  type Theme,
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
    h('div', { class: 'article-badges' }, badgeImportance(a.importance), a.origine === 'api' ? h('span', { class: 'badge badge-api', title: 'Publié par une API officielle' }, 'API officielle') : null),
    h('h3', { class: 'article-titre' }, lienExterne(a.url, a.titre)),
    ligneMeta(a),
    a.resume ? h('p', { class: 'article-resume' }, a.resume) : h('p', { class: 'article-resume texte-secondaire' }, 'Pas d’extrait fourni par la source : consultez-la.'),
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

function echeanceTexte(e: { libelle: string; date: string | null; indicative?: boolean }): string {
  return `${e.libelle}${e.date ? ` : ${dateFr(e.date)}` : ''}${e.indicative ? ' (délai indicatif)' : ''}`;
}

function frise(suivi: SuiviTexte | null, nom: string): HTMLElement {
  if (!suivi) {
    return h(
      'section',
      { class: 'carte suivi' },
      h('h2', {}, nom),
      h('p', { class: 'texte-secondaire' }, 'Pas encore de suivi : le dossier législatif n’a pas pu être lu. Il est relu à chaque collecte (jours ouvrés, 6 h 30).'),
    );
  }
  const automatique = Boolean(suivi.source);
  return h(
    'section',
    { class: 'carte suivi', 'aria-label': `Suivi du ${suivi.texte}` },
    h('h2', {}, `${nom} — ${suivi.texte}`),
    h('p', {}, h('strong', {}, 'Étape actuelle : '), suivi.etape_actuelle),
    suivi.prochaine_echeance ? h('p', {}, h('strong', {}, 'Prochaine échéance : '), echeanceTexte(suivi.prochaine_echeance)) : null,
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
    suivi.delais?.length
      ? h('div', { class: 'delais' }, h('h3', {}, 'Délais constitutionnels'), h('ul', {}, ...suivi.delais.map((d) => h('li', {}, echeanceTexte(d)))))
      : null,
    h(
      'p',
      { class: 'texte-secondaire note' },
      automatique
        ? `Relevé automatiquement le ${dateFr(suivi.mis_a_jour_le)} sur le `
        : `Saisi à la main, mis à jour le ${dateFr(suivi.mis_a_jour_le)}. `,
      automatique && suivi.url ? lienExterne(suivi.url, 'dossier législatif de l’Assemblée nationale') : '',
      automatique ? '. Les étapes « à venir » et les délais (comptés depuis le dépôt) sont indicatifs.' : 'À recouper avec les dossiers législatifs officiels.',
    ),
  );
}

function actualitesTexte(news: NewsJson, theme: Theme, titre: string): HTMLElement {
  const articles = news.articles.filter((a) => a.theme === theme && (a.importance ?? 0) >= 2).slice(0, 8);
  return h(
    'section',
    { class: 'carte actualites-suivi' },
    h('h2', {}, titre),
    articles.length
      ? h('ul', {}, ...articles.map((a) => h('li', {}, lienExterne(a.url, a.titre), h('span', { class: 'texte-secondaire' }, ` — ${a.source}, ${dateFr(a.date)}`))))
      : h('p', { class: 'texte-secondaire' }, 'Aucune actualité sur la période.'),
  );
}

/** Seuil d'importance (classement par mots-clés) au-delà duquel un article figure parmi les principales mesures. */
export const SEUIL_MESURE_PRINCIPALE = 3;

function ligneArticle(a: ArticleProjet, avecImportance: boolean): HTMLElement {
  const libelle = `Art. ${a.numero} — ${a.intitule}`;
  return h(
    'li',
    { class: 'mesure' },
    a.url ? lienExterne(a.url, libelle) : h('span', {}, libelle),
    avecImportance ? h('span', { class: 'mesure-meta' }, ' ', badgeImportance(a.importance), ...a.public.map((p) => h('span', { class: 'puce' }, p))) : null,
  );
}

function mesures(suivi: SuiviTexte | null, nom: string): HTMLElement | null {
  const m = suivi?.mesures;
  if (!suivi || !m) return null;
  const principales = m.articles
    .filter((a) => a.importance >= SEUIL_MESURE_PRINCIPALE)
    .sort((a, b) => b.importance - a.importance);
  const groupes = new Map<string, ArticleProjet[]>();
  for (const a of m.articles) {
    const cle = [a.partie, a.groupe].filter(Boolean).join(' — ') || 'Articles';
    groupes.set(cle, [...(groupes.get(cle) ?? []), a]);
  }
  return h(
    'section',
    { class: 'carte mesures', 'aria-label': `Mesures du ${suivi.texte}` },
    h('h2', {}, `${nom} — principales mesures pour nos métiers`),
    principales.length
      ? h('ol', { class: 'liste-mesures' }, ...principales.map((a) => ligneArticle(a, true)))
      : h('p', { class: 'texte-secondaire' }, 'Aucun article ne correspond à nos mots-clés.'),
    h(
      'details',
      { class: 'tous-articles' },
      h('summary', {}, `Tous les articles du projet (${m.articles.length})`),
      ...[...groupes].flatMap(([groupe, articles]) => [h('h3', {}, groupe), h('ul', { class: 'liste-mesures' }, ...articles.map((a) => ligneArticle(a, false)))]),
    ),
    h(
      'p',
      { class: 'texte-secondaire note' },
      'Intitulés officiels des articles du ',
      lienExterne(m.url, m.libelle.replace(/^Projet/, 'projet')),
      `. Ils évolueront avec les amendements ; mesures choisies par nos mots-clés (importance ${SEUIL_MESURE_PRINCIPALE} et plus).`,
    ),
  );
}

function rendreSuivi(conteneur: HTMLElement, news: NewsJson): void {
  const cartesMesures = [mesures(news.suivi.plf, 'PLF'), mesures(news.suivi.plfss, 'PLFSS')].filter((c): c is HTMLElement => c !== null);
  conteneur.append(
    h('div', { class: 'grille-suivi' }, frise(news.suivi.plf, 'Loi de finances'), frise(news.suivi.plfss, 'Financement de la sécurité sociale')),
    cartesMesures.length ? h('div', { class: 'grille-suivi' }, ...cartesMesures) : '',
    h(
      'div',
      { class: 'grille-suivi' },
      actualitesTexte(news, 'Loi de finances', 'Actualité de la loi de finances'),
      actualitesTexte(news, 'Sécurité sociale', 'Actualité de la sécurité sociale'),
    ),
  );
}

// --- Indicateurs ---

function rendreIndicateurs(conteneur: HTMLElement, news: NewsJson): void {
  if (news.indicateurs.length === 0) {
    conteneur.append(h('p', { class: 'texte-secondaire' }, 'Aucun indicateur publié pour l’instant : ils seront fournis par les API officielles (INSEE, Banque de France) une fois configurées.'));
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
        ),
      ),
    ),
  );
}

// --- État des sources ---

const LIBELLES_ETAT = { ok: 'OK', erreur: 'En échec', inactive: 'Inactive', non_configuree: 'Non configurée' } as const;

function tableauSources(titre: string, sources: EtatVeille['sources'], colonneNombre: string): HTMLElement {
  return h(
    'section',
    { class: 'bloc-sources' },
    h('h2', {}, titre),
    h(
      'div',
      { class: 'tableau-defilant' },
      h(
        'table',
        { class: 'tableau' },
        h('caption', { class: 'visuellement-masque' }, titre),
        h('thead', {}, h('tr', {}, ...['Source', 'État', 'Dernière réussite', colonneNombre, 'Détail'].map((t) => h('th', { scope: 'col' }, t)))),
        h(
          'tbody',
          {},
          ...sources.map((s) =>
            h(
              'tr',
              {},
              h('th', { scope: 'row' }, s.nom),
              h('td', {}, h('span', { class: `badge badge-etat-${s.etat}` }, LIBELLES_ETAT[s.etat])),
              h('td', {}, s.derniere_reussite ? `${dateFr(s.derniere_reussite)} ${heureFr(s.derniere_reussite)}` : '—'),
              h('td', { class: 'nombre' }, String(s.nb_articles)),
              h('td', {}, s.erreur ?? ''),
            ),
          ),
        ),
      ),
    ),
  );
}

function rendreEtat(conteneur: HTMLElement, etat: EtatVeille | null): void {
  if (!etat) {
    conteneur.append(h('p', { class: 'texte-secondaire' }, 'L’état des sources n’est pas encore disponible.'));
    return;
  }
  const flux = etat.sources.filter((s) => s.type !== 'api');
  const api = etat.sources.filter((s) => s.type === 'api');
  conteneur.append(
    h('p', {}, `Dernière collecte : ${dateFr(etat.genere_le)} à ${heureFr(etat.genere_le)}.`),
    tableauSources('Flux officiels (couche A)', flux, 'Articles'),
    tableauSources('API officielles (couche B)', api, 'Éléments'),
    api.some((s) => s.etat === 'non_configuree')
      ? h('p', { class: 'note texte-secondaire' }, 'Une API « non configurée » est sautée sans bloquer la collecte : il lui manque ses identifiants (secrets GitHub) ou son connecteur.')
      : '',
    h(
      'section',
      { class: 'carte' },
      h('h2', {}, 'Classement et coût'),
      h('p', {}, `Classement par mots-clés : ${etat.classement.articles} article(s) en ligne, dont ${etat.classement.marginaux} marginal(aux) masqué(s) par défaut ; ${etat.classement.exclus} exclu(s).`),
      h('p', {}, `Recherche IA : ${etat.recherche_ia.raison}.`),
      h('p', {}, h('strong', {}, 'Coût : '), '0 € (flux et API publics gratuits, exécution sur GitHub Actions).'),
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
      '. Les extraits sont ceux publiés par chaque source, tronqués à 300 caractères ; seul le texte officiel fait foi.',
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
