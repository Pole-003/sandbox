/**
 * Écran Veille : fil filtrable, échéances, suivi (marchés, PLF / PLFSS, état des sources), Rennes et Bretagne.
 * Le navigateur ne charge que news.json, veille-etat.json et marches.json (même origine, GET, sans paramètre) ;
 * les liens vers les sources s'ouvrent dans un nouvel onglet et ne transportent aucune donnée.
 */
import { h } from '../../app/dom.ts';
import { formaterDate } from '../../core/format.ts';
import { chargerEtat, chargerNews, MESSAGES_CHARGEMENT } from './donnees.ts';
import { rendreEcheances } from './ecran-echeances.ts';
import { rendreSuivi, SOUS_ONGLETS, type IdSousOnglet } from './ecran-suivi.ts';
import { dateIsoParis } from './dates-paris.ts';
import {
  ageEnJours,
  analyserRecherche,
  CRITERES_PAR_DEFAUT,
  decouperSurlignage,
  estNouveau,
  filtrerArticles,
  lireCriteres,
  lireVisites,
  noterVisite,
  sourcesPresentes,
  type Criteres,
  type Marque,
} from './logique.ts';
import { ecrirePreference, lirePreference } from '../../core/stockage.ts';
import { telecharger, TYPE_XLSX } from '../fec/ecran/commun.ts';
import { ouvrirMagasin, type MagasinMarques } from './marques.ts';
import {
  LIBELLES_TYPE,
  PUBLICS,
  THEMES,
  type Article,
  type Importance,
  type Indicateur,
  type NewsJson,
} from './modele.ts';

export const ONGLETS = [
  { id: 'fil', libelle: 'Fil d’actualité' },
  { id: 'echeances', libelle: 'Échéances' },
  { id: 'suivi', libelle: 'Suivi' },
  { id: 'rennes', libelle: 'Rennes et Bretagne' },
] as const;
export type IdOnglet = (typeof ONGLETS)[number]['id'];

/** Anciennes adresses (avant l'onglet « Suivi ») : #/veille/plf, #/veille/indicateurs, #/veille/sources. */
const ANCIENNES_ADRESSES: Record<string, IdSousOnglet> = { plf: 'plf', indicateurs: 'marches', sources: 'sources' };

/** Onglet et sous-onglet demandés par l'adresse : « #/veille/suivi/plf ». */
export function ancreVeille(ancre: string): { onglet: IdOnglet; sous: IdSousOnglet } {
  const [, premier = '', second = ''] = ancre.replace(/^#\/?/, '').split('/');
  const ancienne = ANCIENNES_ADRESSES[premier];
  if (ancienne) return { onglet: 'suivi', sous: ancienne };
  const onglet = (ONGLETS.find((o) => o.id === premier)?.id ?? 'fil') as IdOnglet;
  const sous = (SOUS_ONGLETS.find((o) => o.id === second)?.id ?? 'marches') as IdSousOnglet;
  return { onglet, sous };
}

/** Onglet demandé par l'adresse. */
export function ongletDepuisAncre(ancre: string): IdOnglet {
  return ancreVeille(ancre).onglet;
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

/** Texte avec les termes recherchés entourés de <mark>. */
function surligne(texte: string, termes: readonly string[]): (Node | string)[] {
  return decouperSurlignage(texte, termes).map((m) => (m.surligne ? h('mark', {}, m.texte) : m.texte));
}

const nombreFr = (n: number) => String(n).replace('.', ',');

/** « Pourquoi ce score » : mots-clés reconnus, coefficient de la source, bonus. */
export function detailScore(a: Article): HTMLElement | null {
  const p = a.pourquoi;
  if (!p) return null;
  const lignes: (HTMLElement | null)[] = [
    p.mots.length
      ? h('li', {}, 'Mots-clés détectés : ', ...p.mots.flatMap((m, i) => [i ? ', ' : '', h('strong', {}, m.mot), ` (+${nombreFr(m.poids)})`]))
      : h('li', {}, 'Aucun mot-clé détecté : thème de la source.'),
    p.coefficient !== 1 ? h('li', {}, `Coefficient de la source : × ${nombreFr(p.coefficient)} (alerte de presse)`) : null,
    p.bonus_source ? h('li', {}, `Bonus de la source : +${nombreFr(p.bonus_source)}`) : null,
    h('li', {}, `Score : ${nombreFr(p.score)}, soit l’importance ${a.importance ?? '—'}/5`),
    p.bonus_fraicheur ? h('li', {}, `Bonus de fraîcheur pour le tri : +${nombreFr(p.bonus_fraicheur)}`) : null,
  ];
  return h('details', { class: 'pourquoi-score' }, h('summary', {}, 'Pourquoi ce score ?'), h('ul', {}, ...lignes));
}

function carteArticle(
  a: Article,
  marque: Marque | undefined,
  basculer: (champ: keyof Marque) => void,
  options: { nouveau: boolean; termes: readonly string[] },
): HTMLElement {
  const bouton = (champ: keyof Marque, libelle: string) =>
    h('button', { type: 'button', class: 'bouton-marque', 'aria-pressed': String(Boolean(marque?.[champ])), 'data-marque': champ }, libelle);
  const carte = h(
    'article',
    { class: `carte article${marque?.lu ? ' article-lu' : ''}${marque?.important ? ' article-important' : ''}${options.nouveau ? ' article-nouveau' : ''}`, 'data-id': a.id },
    h(
      'div',
      { class: 'article-badges' },
      options.nouveau ? h('span', { class: 'badge badge-nouveau', title: 'Collecté depuis votre dernière visite' }, 'Nouveau') : null,
      badgeImportance(a.importance),
      a.origine === 'api' ? h('span', { class: 'badge badge-api', title: 'Publié par une API officielle' }, 'API officielle') : null,
      a.origine === 'alerte' ? h('span', { class: 'badge badge-presse', title: 'Article de presse repéré par une alerte Google' }, 'Presse') : null,
    ),
    h('h3', { class: 'article-titre' }, lienExterne(a.url, ...surligne(a.titre, options.termes))),
    ligneMeta(a),
    a.resume ? h('p', { class: 'article-resume' }, ...surligne(a.resume, options.termes)) : h('p', { class: 'article-resume texte-secondaire' }, 'Pas d’extrait fourni par la source : consultez-la.'),
    a.autres_sources?.length
      ? h('p', { class: 'article-autres-sources' }, 'Aussi publié par : ', ...a.autres_sources.flatMap((x, i) => [i ? ', ' : '', lienExterne(x.url, x.source)]))
      : null,
    a.public.length ? h('p', { class: 'article-public' }, h('span', { class: 'visuellement-masque' }, 'Public concerné : '), ...a.public.map((p) => h('span', { class: 'puce' }, p))) : null,
    detailScore(a),
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
  /** Jour de la visite précédente (badge « nouveau »). */
  visitePrecedente: string | null;
  /** Mémorise les critères (préférence d'interface, localStorage). */
  memoriser?: (c: Criteres) => void;
}

const LIBELLES_IMPORTANCE = { '0': 'Toutes, y compris marginales', '2': '2 et plus', '3': '3 et plus', '4': '4 et plus (essentiel)' } as const;

/** Critères en clair pour l'onglet « Paramètres » de l'export. */
function criteresEnClair(c: Criteres, themeFixe?: string): [string, string][] {
  return [
    ['Thème', themeFixe ?? (c.theme || 'Tous')],
    ['Source', c.source || 'Toutes'],
    ['Importance', LIBELLES_IMPORTANCE[String(c.importanceMin) as keyof typeof LIBELLES_IMPORTANCE]],
    ['Public', c.public || 'Tous'],
    ['Recherche', c.recherche || '—'],
    ['Non lus seulement', c.nonLus ? 'oui' : 'non'],
    ['Importants pour nos dossiers', c.importants ? 'oui' : 'non'],
    ['Nouveaux depuis la dernière visite', c.nouveaux ? 'oui' : 'non'],
  ];
}

function rendreFil(conteneur: HTMLElement, ctx: ContexteFil): void {
  const c = { ...ctx.criteres, ...(ctx.themeFixe ? { theme: ctx.themeFixe } : {}) };
  const prefixe = ctx.themeFixe ? 'rennes' : 'fil';
  const base = ctx.themeFixe ? ctx.articles.filter((a) => a.theme === ctx.themeFixe) : ctx.articles;
  const nbNouveaux = base.filter((a) => estNouveau(a, ctx.visitePrecedente)).length;

  const theme = liste([['', 'Tous les thèmes'], ...THEMES.map((t) => [t, t] as const)], c.theme);
  const source = liste([['', 'Toutes les sources'], ...sourcesPresentes(base).map((s) => [s, s] as const)], c.source);
  const importance = liste(Object.entries(LIBELLES_IMPORTANCE) as [string, string][], String(c.importanceMin));
  const publicCible = liste([['', 'Tous les publics'], ...PUBLICS.map((p) => [p, p] as const)], c.public);
  const recherche = h('input', { type: 'search', placeholder: 'Mots, "expression exacte", -mot exclu', value: c.recherche, autocomplete: 'off', 'aria-describedby': `${prefixe}-aide-recherche` });
  const nonLus = h('input', { type: 'checkbox', checked: c.nonLus });
  const importants = h('input', { type: 'checkbox', checked: c.importants });
  const nouveaux = h('input', { type: 'checkbox', checked: c.nouveaux, disabled: ctx.visitePrecedente === null });
  const compteur = h('p', { class: 'compteur', role: 'status', 'aria-live': 'polite' });
  const resultats = h('div', { class: 'liste-articles' });
  const reinitialiser = h('button', { type: 'button', class: 'bouton' }, 'Réinitialiser les filtres');
  const exporter = h('button', { type: 'button', class: 'bouton' }, 'Exporter la sélection (.xlsx)');
  let visibles: Article[] = [];

  const filtres = h(
    'div',
    { class: 'filtres', role: 'search', 'aria-label': 'Filtrer les actualités' },
    ctx.themeFixe ? null : champ('Thème', theme, `${prefixe}-theme`),
    champ('Source', source, `${prefixe}-source`),
    champ('Importance', importance, `${prefixe}-importance`),
    champ('Public', publicCible, `${prefixe}-public`),
    h(
      'div',
      { class: 'champ champ-recherche' },
      h('label', { for: `${prefixe}-recherche` }, 'Recherche dans les 60 derniers jours'),
      recherche,
      h('span', { class: 'aide texte-secondaire', id: `${prefixe}-aide-recherche` }, 'Titres, extraits, sources et thèmes, sans tenir compte des accents.'),
    ),
    h(
      'div',
      { class: 'champ champ-cases' },
      h('label', {}, nonLus, ' Non lus seulement'),
      h('label', {}, importants, ' Importants pour nos dossiers'),
      h('label', {}, nouveaux, ctx.visitePrecedente ? ` Nouveaux depuis ma dernière visite (${nbNouveaux})` : ' Nouveaux depuis ma dernière visite (première visite)'),
    ),
  );
  recherche.id = `${prefixe}-recherche`;

  const afficher = () => {
    Object.assign(ctx.criteres, {
      theme: ctx.themeFixe ? ctx.criteres.theme : (theme.value as Criteres['theme']),
      source: source.value,
      importanceMin: Number(importance.value) as Criteres['importanceMin'],
      public: publicCible.value as Criteres['public'],
      recherche: recherche.value,
      nonLus: nonLus.checked,
      importants: importants.checked,
      nouveaux: nouveaux.checked,
    } satisfies Criteres);
    ctx.memoriser?.(ctx.criteres);
    const criteres = { ...ctx.criteres, ...(ctx.themeFixe ? { theme: ctx.themeFixe } : {}) };
    const termes = analyserRecherche(criteres.recherche).inclus;
    visibles = filtrerArticles(base, criteres, ctx.marques, ctx.visitePrecedente);
    compteur.textContent = `${visibles.length} article${visibles.length > 1 ? 's' : ''} sur ${base.length}`;
    exporter.disabled = visibles.length === 0;
    resultats.replaceChildren(
      ...(visibles.length
        ? visibles.map((a) =>
            carteArticle(
              a,
              ctx.marques.get(a.id),
              (champMarque) => {
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
              },
              { nouveau: estNouveau(a, ctx.visitePrecedente), termes },
            ),
          )
        : [h('p', { class: 'texte-secondaire vide' }, 'Aucun article ne correspond à ces critères.')]),
    );
  };
  for (const controle of [theme, source, importance, publicCible, nonLus, importants, nouveaux]) controle.addEventListener('change', afficher);
  recherche.addEventListener('input', afficher);
  reinitialiser.addEventListener('click', () => {
    const d = CRITERES_PAR_DEFAUT;
    theme.value = d.theme;
    source.value = d.source;
    importance.value = String(d.importanceMin);
    publicCible.value = d.public;
    recherche.value = d.recherche;
    nonLus.checked = d.nonLus;
    importants.checked = d.importants;
    nouveaux.checked = d.nouveaux;
    afficher();
  });
  exporter.addEventListener('click', async () => {
    exporter.disabled = true;
    const libelle = exporter.textContent;
    exporter.textContent = 'Préparation du classeur…';
    try {
      const { exporterArticles } = await import('./export-xlsx.ts');
      const octets = await exporterArticles(visibles, criteresEnClair(ctx.criteres, ctx.themeFixe), __APP_VERSION__);
      telecharger(octets, `veille-selection-${dateIsoParis(new Date())}.xlsx`, TYPE_XLSX);
    } finally {
      exporter.textContent = libelle;
      exporter.disabled = visibles.length === 0;
    }
  });

  conteneur.append(
    filtres,
    ctx.magasin.persistant ? '' : h('p', { class: 'note' }, 'Ce navigateur ne permet pas de conserver les marques « lu » et « important » : elles seront perdues en quittant la page.'),
    h('div', { class: 'barre-fil' }, compteur, h('div', { class: 'barre-fil-actions' }, reinitialiser, exporter)),
    resultats,
  );
  afficher();
}

// --- Rennes et Bretagne : compteurs du BODACC ---

function blocBodacc(compteurs: readonly Indicateur[]): HTMLElement {
  return h(
    'section',
    { class: 'carte compteurs-bodacc', 'aria-labelledby': 'titre-bodacc' },
    h('h2', { id: 'titre-bodacc' }, 'Annonces du BODACC en Ille-et-Vilaine'),
    h(
      'dl',
      { class: 'grille-compteurs' },
      ...compteurs.flatMap((c) => [h('dt', {}, c.libelle.replace(/ en Ille-et-Vilaine$/, '')), h('dd', { class: 'chiffre' }, c.valeur.replace(/ annonces$/, ''))]),
    ),
    h('p', { class: 'note texte-secondaire' }, `Annonces publiées ${compteurs[0]?.periode ?? ''}. Source : `, compteurs[0] ? lienExterne(compteurs[0].url, compteurs[0].source) : 'BODACC', ', données ouvertes ; comptes uniquement, aucun nom.'),
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
  const { onglet: ongletInitial, sous: sousInitial } = ancreVeille(location.hash);
  let sousOnglet: IdSousOnglet = sousInitial;
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
  // Préférences d'interface (localStorage, CLAUDE.md règle n° 5) : critères des filtres et jour des visites.
  const criteresFil = lireCriteres(lirePreference('veille-filtres-fil'));
  const criteresRennes = lireCriteres(lirePreference('veille-filtres-rennes'));
  const visites = noterVisite(lireVisites(lirePreference('veille-visites')), dateIsoParis(options.maintenant ?? new Date()));
  ecrirePreference('veille-visites', JSON.stringify(visites));
  const nbNouveaux = news.articles.filter((a) => estNouveau(a, visites.precedente)).length;
  if (visites.precedente && nbNouveaux > 0) statut.append(` ${nbNouveaux} nouveau${nbNouveaux > 1 ? 'x' : ''} depuis votre dernière visite.`);

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
    if (id !== 'suivi') history.replaceState(null, '', `#/veille${id === 'fil' ? '' : `/${id}`}`);
    if (id === 'fil') {
      rendreFil(panneau, {
        articles: news.articles, marques, magasin, criteres: criteresFil, visitePrecedente: visites.precedente,
        memoriser: (c) => ecrirePreference('veille-filtres-fil', JSON.stringify(c)),
      });
    }
    if (id === 'rennes') {
      const bodacc = news.indicateurs.filter((i) => i.source_id === 'bodacc-35');
      if (bodacc.length) panneau.append(blocBodacc(bodacc));
      rendreFil(panneau, {
        articles: news.articles, marques, magasin, criteres: criteresRennes, themeFixe: 'Rennes et Bretagne', visitePrecedente: visites.precedente,
        memoriser: (c) => ecrirePreference('veille-filtres-rennes', JSON.stringify(c)),
      });
    }
    if (id === 'echeances') rendreEcheances(panneau, news.echeances ?? [], dateIsoParis(options.maintenant ?? new Date()));
    if (id === 'suivi') {
      rendreSuivi(panneau, {
        news, etat, sousOnglet, maintenant: () => options.maintenant ?? new Date(),
        changerAncre: (sous) => {
          sousOnglet = sous;
          history.replaceState(null, '', `#/veille/suivi/${sous}`);
        },
      });
    }
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
