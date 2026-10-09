/**
 * Onglet « Suivi » de la veille : trois sous-onglets.
 *  - Marchés et finances publiques : cartes, graphique détaillé, estimation de la dette, prochaines publications ;
 *  - PLF / PLFSS : frise interactive (Assemblée nationale et Sénat), échéances, articles liés à chaque étape ;
 *  - État des sources : veille et indicateurs, avec l'historique des 30 derniers jours.
 * Données : news.json, veille-etat.json et marches.json (même origine, relus sans requête périodique).
 */
import { h } from '../../app/dom.ts';
import { ajouterJours, ajouterMois, ecartJours, jourSemaine } from '../../core/dates.ts';
import { chargerMarches } from './donnees.ts';
import { dateIsoParis } from './dates-paris.ts';
import { badgeImportance, dateFr, lienExterne } from './ecran.ts';
import { dateCourte, graphiqueBarres, graphiqueLignes, nombreFr, sparkline, tableauValeurs, type SerieTrace } from './graphiques.ts';
import { articlesDeLEtape } from './logique.ts';
import {
  calculerFraicheur,
  CRENEAU_VEILLE,
  enHeureDeParis,
  extrapolerDette,
  LIBELLES_FRAICHEUR,
  prochainCreneau,
  prochaineRecuperation,
  valeurAu,
  type Fraicheur,
  type IndicateurMarche,
  type MarchesJson,
  type Variation,
} from './marches.ts';
import type { ArticleProjet, EtatSource, EtatVeille, NewsJson, SuiviTexte, Theme } from './modele.ts';

export const SOUS_ONGLETS = [
  { id: 'marches', libelle: 'Marchés et finances publiques' },
  { id: 'plf', libelle: 'PLF / PLFSS' },
  { id: 'sources', libelle: 'État des sources' },
] as const;
export type IdSousOnglet = (typeof SOUS_ONGLETS)[number]['id'];

export interface ContexteSuivi {
  news: NewsJson;
  etat: EtatVeille | null;
  sousOnglet: IdSousOnglet;
  maintenant: () => Date;
  /** Met à jour l'adresse (#/veille/suivi/<sous-onglet>). */
  changerAncre: (sous: IdSousOnglet) => void;
}

/** Préférence système « réduire les animations ». */
const animationsReduites = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const heureEnClair = (heure: string | null) => (heure ? heure.replace(':', ' h ') : '');

// --- Mise en forme des valeurs ---

export function valeurEnClair(i: Pick<IndicateurMarche, 'unite' | 'decimales'>, v: number): string {
  const n = nombreFr(v, i.decimales);
  return i.unite === '%' ? `${n} %` : i.unite === '$' ? `${n} $` : `${n} ${i.unite}`;
}

/** Variation en clair : points de base pour un taux, pourcentage sinon. */
export function variationEnClair(i: Pick<IndicateurMarche, 'genre' | 'unite' | 'decimales'>, v: Variation | null): string {
  if (!v) return '—';
  const signe = (x: number) => (x > 0 ? '+' : x < 0 ? '−' : '');
  if (i.genre === 'taux') return `${signe(v.absolue)}${nombreFr(Math.abs(v.absolue * 100), 0)} pb`;
  return `${signe(v.absolue)}${nombreFr(Math.abs(v.relative ?? 0), 2)} %`;
}

export function badgeFraicheur(f: Fraicheur): HTMLElement {
  return h('span', { class: `badge badge-fraicheur fraicheur-${f}` }, LIBELLES_FRAICHEUR[f]);
}

function trimestreCourt(date: string): string {
  return `T${Math.ceil(Number(date.slice(5, 7)) / 3)} ${date.slice(2, 4)}`;
}

function trimestreLong(date: string): string {
  const t = Math.ceil(Number(date.slice(5, 7)) / 3);
  return `${t === 1 ? '1er' : `${t}e`} trimestre ${date.slice(0, 4)}`;
}

// --- Marchés et finances publiques ---

interface VueMarches {
  choisie: IndicateurMarche['id'];
  /** Période en mois (1, 3, 12, 24). */
  periode: number;
  comparer: boolean;
  avec: IndicateurMarche['id'] | '';
}

const PERIODES = [
  { mois: 1, libelle: '1 mois' },
  { mois: 3, libelle: '3 mois' },
  { mois: 12, libelle: '1 an' },
  { mois: 24, libelle: '2 ans' },
];

/** Date de la valeur selon sa périodicité : « août 2026 » pour une moyenne mensuelle, « 09/10/2026 » sinon. */
export function dateDeValeur(i: Pick<IndicateurMarche, 'regle' | 'date_valeur'>): string {
  if (!i.date_valeur) return '—';
  if (i.regle.frequence !== 'mensuelle') return dateFr(i.date_valeur);
  return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${i.date_valeur.slice(0, 10)}T12:00:00Z`));
}

/** Ligne sous la carte : nature, organisme et date de la valeur (« Moyenne mensuelle officielle · BCE · août 2026 »). */
export function metaCarte(i: Pick<IndicateurMarche, 'source' | 'regle' | 'date_valeur'>): string {
  const nature = i.source.nature.charAt(0).toUpperCase() + i.source.nature.slice(1);
  return `${nature} · ${i.source.organisme}${i.source.secours ? ' (secours)' : ''} · ${dateDeValeur(i)}`;
}

/** Lien vers la valeur du jour chez l'organisme (adresse publiée par la collecte, jamais la valeur). */
export function lienDuJour(i: Pick<IndicateurMarche, 'lien_du_jour'>, classe: string): HTMLElement | null {
  const l = i.lien_du_jour;
  if (!l || !l.url.startsWith('https://')) return null;
  const libelle = l.date ? `${l.libelle} du ${dateFr(l.date)}` : `${l.libelle} du jour`;
  return h('p', { class: classe }, 'Taux du jour : ', lienExterne(l.url, `${libelle} · ${l.organisme}`));
}

function carteIndicateur(i: IndicateurMarche, maintenant: Date, choisie: boolean, rang: number): HTMLButtonElement {
  const derniers = i.historique.slice(-30).map((p) => p[1]);
  const pib = i.complements.find((c) => c.cle === 'pib')?.historique.at(-1);
  const v = i.variations.precedente;
  const sens = !v || v.absolue === 0 ? '' : v.absolue > 0 ? ' hausse' : ' baisse';
  const carte = h(
    'button',
    { type: 'button', class: `carte-marche${animationsReduites() ? '' : ' apparition'}`, 'aria-pressed': String(choisie), 'data-id': i.id },
    h('span', { class: 'carte-marche-tete' }, h('span', { class: 'carte-marche-nom' }, i.nom), badgeFraicheur(calculerFraicheur(i, maintenant))),
    h(
      'span',
      { class: 'carte-marche-valeur chiffre' },
      i.valeur === null ? '—' : nombreFr(i.valeur, i.decimales),
      i.valeur === null ? '' : h('span', { class: 'carte-marche-unite' }, i.unite === '%' ? ' %' : ` ${i.unite}`),
    ),
    h(
      'span',
      { class: 'carte-marche-variation' },
      h('span', { class: `variation chiffre${sens}` }, variationEnClair(i, v)),
      v ? ` depuis le ${dateCourte(v.depuis)}` : ' (pas de valeur précédente)',
    ),
    sparkline(derniers, `${i.nom} : ${derniers.length} dernières valeurs`),
    h(
      'span',
      { class: 'carte-marche-meta' },
      i.id === 'dette' && i.date_valeur
        ? `${trimestreLong(i.date_valeur)}${pib ? ` · ${nombreFr(pib[1], 1)} % du PIB` : ''}`
        : metaCarte(i),
    ),
  );
  carte.dataset.rang = String(rang);
  return carte;
}

/** Points de la période choisie (en mois, depuis la dernière valeur). */
export function pointsPeriode(historique: readonly [string, number][], mois: number): [string, number][] {
  const dernier = historique.at(-1);
  if (!dernier) return [];
  const debut = ajouterMois(dernier[0], -mois);
  return historique.filter(([d]) => d >= debut);
}

/** Deux séries ramenées en base 100 sur les dates de la première (valeur de la seconde au plus tard à cette date). */
export function enBase100(a: readonly [string, number][], b: readonly [string, number][]): { a: [string, number][]; b: [string, number][] } | null {
  const communs = a.filter(([d]) => valeurAu(b, d) !== null);
  if (communs.length < 2) return null;
  const baseA = communs[0]![1];
  const baseB = valeurAu(b, communs[0]![0])![1];
  if (!baseA || !baseB) return null;
  return {
    a: communs.map(([d, v]) => [d, (v / baseA) * 100]),
    b: communs.map(([d]) => [d, (valeurAu(b, d)![1] / baseB) * 100]),
  };
}

function blocVariations(i: IndicateurMarche): HTMLElement {
  const lignes: [string, Variation | null][] = [
    ['Publication précédente', i.variations.precedente],
    ['1 mois', i.variations.un_mois],
    ['Depuis le 1er janvier', i.variations.debut_annee],
    ['1 an', i.variations.un_an],
  ];
  return h(
    'dl',
    { class: 'variations-marche' },
    ...lignes.flatMap(([libelle, v]) => [h('dt', {}, libelle), h('dd', { class: 'chiffre' }, variationEnClair(i, v))]),
  );
}

function ligneSource(i: IndicateurMarche): HTMLElement {
  return h(
    'div',
    { class: 'source-marche' },
    h('p', {}, 'Source : ', lienExterne(i.source.lien, `${i.source.organisme} — ${i.source.libelle}`), ` · ${i.source.nature}. ${i.source.conditions}.`),
    i.source.secours ? h('p', { class: 'note-secours' }, 'Source de secours : la source principale n’a pas pu être lue (voir « État des sources »).') : null,
    lienDuJour(i, 'lien-du-jour'),
    i.lien_du_jour?.mention ? h('p', { class: 'texte-secondaire' }, i.lien_du_jour.mention) : null,
    i.derniere_erreur ? h('p', { class: 'alerte-texte' }, `Dernière collecte en échec : ${i.derniere_erreur}. La dernière valeur connue est affichée.`) : null,
  );
}

function detailDette(i: IndicateurMarche): HTMLElement {
  const pib = i.complements.find((c) => c.cle === 'pib');
  const negociable = i.complements.find((c) => c.cle === 'negociable');
  const derniereNego = negociable?.historique.at(-1);
  const un = i.historique.at(-1);
  const ilYaUnAn = un ? valeurAu(i.historique, ajouterMois(un[0], -12)) : null;
  return h(
    'div',
    { class: 'detail-marche' },
    h('div', { class: 'panneau-tete' }, h('h2', {}, 'Dette publique au sens de Maastricht')),
    h('h3', { class: 'sous-titre-graphique' }, 'Encours en fin de trimestre, en milliards d’euros'),
    graphiqueBarres({
      points: i.historique,
      libelle: trimestreCourt,
      formatValeur: (v) => `${nombreFr(v, 1)} Md€`,
      description: `Dette publique trimestrielle, ${i.historique.length} trimestres, dernière valeur ${un ? nombreFr(un[1], 1) : '—'} Md€`,
    }),
    pib
      ? h(
          'div',
          {},
          h('h3', { class: 'sous-titre-graphique' }, 'En % du PIB'),
          graphiqueLignes({
            series: [{ nom: pib.libelle, classe: 'serie-2', points: pib.historique, libelleValeur: (k) => `${nombreFr(pib.historique[k]![1], 1)} % du PIB` }],
            formatAxe: (v, d) => `${nombreFr(v, d)} %`,
            hauteur: 170,
            description: `Dette publique en % du PIB, dernière valeur ${nombreFr(pib.historique.at(-1)![1], 1)} %`,
          }),
        )
      : null,
    h(
      'div',
      { class: 'extremes-marche chiffre' },
      un ? h('span', {}, 'Dernier trimestre : ', h('strong', {}, `${nombreFr(un[1], 1)} Md€`), ` (${trimestreLong(un[0])})`) : null,
      un && ilYaUnAn ? h('span', {}, 'Sur un an : ', h('strong', {}, `+${nombreFr(un[1] - ilYaUnAn[1], 1)} Md€`)) : null,
      derniereNego
        ? h('span', {}, 'Dette négociable de l’État : ', h('strong', {}, `${nombreFr(derniereNego[1], 1)} Md€`), ` fin ${new Date(`${derniereNego[0]}T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })} (AFT)`)
        : null,
    ),
    ligneSource(i),
    tableauValeurs('Dette publique trimestrielle', ['Trimestre', 'Md€', '% du PIB'], i.historique.map(([d, v]) => [trimestreLong(d), nombreFr(v, 1), pib ? (valeurAu(pib.historique, d)?.[1] ?? '—') : '—'])),
  );
}

function detailLignes(i: IndicateurMarche, m: MarchesJson, vue: VueMarches, rafraichir: () => void): HTMLElement {
  const points = pointsPeriode(i.historique, vue.periode);
  const autres = m.indicateurs.filter((x) => x.id !== i.id && x.id !== 'dette' && x.historique.length > 1);
  if (!autres.some((x) => x.id === vue.avec)) vue.avec = autres[0]?.id ?? '';
  const autre = vue.comparer ? autres.find((x) => x.id === vue.avec) : undefined;
  const base = autre ? enBase100(points, autre.historique) : null;

  const series: SerieTrace[] = base
    ? [
        { nom: i.nom, classe: 'serie-1', points: base.a, libelleValeur: (k) => `${valeurEnClair(i, valeurAu(points, base.a[k]![0])![1])} (${nombreFr(base.a[k]![1], 1)})` },
        { nom: autre!.nom, classe: 'serie-2', points: base.b, libelleValeur: (k) => `${valeurEnClair(autre!, valeurAu(autre!.historique, base.b[k]![0])![1])} (${nombreFr(base.b[k]![1], 1)})` },
      ]
    : [{ nom: i.nom, classe: 'serie-1', points, libelleValeur: (k) => valeurEnClair(i, points[k]![1]) }];

  const boutonsPeriode = PERIODES.map((p) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(vue.periode === p.mois) }, p.libelle);
    b.addEventListener('click', () => {
      vue.periode = p.mois;
      rafraichir();
    });
    return b;
  });
  const caseComparer = h('input', { type: 'checkbox', id: 'comparer-base100', checked: vue.comparer, disabled: autres.length === 0 });
  const choixAutre = h('select', { id: 'comparer-avec', 'aria-label': 'Indicateur à superposer', disabled: autres.length === 0 }, ...autres.map((x) => h('option', { value: x.id, selected: x.id === vue.avec }, x.nom)));
  caseComparer.addEventListener('change', () => {
    vue.comparer = caseComparer.checked;
    rafraichir();
  });
  choixAutre.addEventListener('change', () => {
    vue.avec = choixAutre.value as VueMarches['avec'];
    vue.comparer = true;
    rafraichir();
  });

  const valeurs = points.map((p) => p[1]);
  const iMin = valeurs.indexOf(Math.min(...valeurs));
  const iMax = valeurs.indexOf(Math.max(...valeurs));
  const premier = points[0];
  const dernier = points.at(-1);
  return h(
    'div',
    { class: 'detail-marche' },
    h('div', { class: 'panneau-tete' }, h('h2', {}, i.nom), h('div', { class: 'periodes', role: 'group', 'aria-label': 'Période' }, ...boutonsPeriode)),
    h('div', { class: 'comparateur' }, h('label', { for: 'comparer-base100' }, caseComparer, ' Comparer en base 100 avec'), choixAutre),
    graphiqueLignes({
      series,
      evenements: m.evenements,
      extremes: !base,
      formatAxe: base ? (v) => nombreFr(v, 0) : (v, d) => (i.unite === '%' ? `${nombreFr(v, d)} %` : nombreFr(v, Math.max(d, i.decimales > 2 ? 2 : 0))),
      description: base
        ? `${i.nom} et ${autre!.nom} en base 100 au ${dateCourte(base.a[0]![0])}`
        : `${i.nom} sur ${PERIODES.find((p) => p.mois === vue.periode)?.libelle}, de ${premier ? dateCourte(premier[0]) : '—'} à ${dernier ? dateCourte(dernier[0]) : '—'}`,
    }),
    base
      ? h('p', { class: 'legende-graphique' }, ...series.map((s) => h('span', { class: `legende-${s.classe}` }, `${s.nom} (base 100 au ${dateCourte(base.a[0]![0])})`)))
      : vue.comparer && autre
        ? h('p', { class: 'texte-secondaire' }, 'Pas assez de dates communes pour comparer ces deux indicateurs sur la période.')
        : null,
    points.length > 1
      ? h(
          'div',
          { class: 'extremes-marche chiffre' },
          h('span', {}, 'Minimum ', h('strong', {}, valeurEnClair(i, valeurs[iMin]!)), ` le ${dateCourte(points[iMin]![0])}`),
          h('span', {}, 'Maximum ', h('strong', {}, valeurEnClair(i, valeurs[iMax]!)), ` le ${dateCourte(points[iMax]![0])}`),
          h('span', {}, 'Sur la période ', h('strong', {}, variationEnClair(i, { depuis: premier![0], absolue: dernier![1] - premier![1], relative: ((dernier![1] - premier![1]) / premier![1]) * 100 }))),
        )
      : null,
    blocVariations(i),
    ligneSource(i),
    tableauValeurs(i.nom, ['Date', i.unite], points.map(([d, v]) => [dateCourte(d), nombreFr(v, i.decimales)])),
  );
}

/** Compteur « Dette publique, estimation en temps réel » : calcul local, sans requête. */
export function compteurDette(dette: IndicateurMarche | undefined, maintenant: () => Date): HTMLElement | null {
  if (!dette) return null;
  const premier = extrapolerDette(dette.historique, maintenant());
  if (!premier) return null;
  const montant = h('p', { class: 'compteur-montant chiffre', 'aria-live': 'off' });
  const maj = () => {
    const e = extrapolerDette(dette.historique, maintenant());
    if (e) montant.textContent = `${nombreFr(e.valeur, 0)} €`;
  };
  maj();
  const bloc = h(
    'section',
    { class: 'panneau-marche compteur-dette', 'aria-labelledby': 'titre-compteur' },
    h('h2', { id: 'titre-compteur' }, 'Dette publique, estimation en temps réel'),
    montant,
    h('p', { class: 'mention-estimation' }, 'Estimation, ce n’est pas un chiffre officiel'),
    h(
      'div',
      { class: 'methode' },
      h('button', { type: 'button', class: 'methode-bouton', 'aria-describedby': 'methode-dette' }, 'Méthode et hypothèses'),
      h(
        'p',
        { class: 'methode-texte', id: 'methode-dette', role: 'tooltip' },
        `Point de départ : dernier chiffre officiel de l’INSEE, ${nombreFr(premier.base.valeur, 1)} Md€ au ${dateCourte(premier.base.date)}. `,
        `Progression linéaire égale à la variation moyenne des ${premier.trimestres} derniers trimestres, soit environ ${nombreFr(premier.parSeconde, 0)} € par seconde. `,
        'Calcul fait dans votre navigateur, sans aucune requête ; il ne tient compte ni de la saisonnalité ni des opérations de trésorerie.',
      ),
    ),
  );
  // Défilement chaque seconde (une fois par minute si les animations sont réduites) ; arrêt quand le bloc disparaît.
  const minuterie = setInterval(() => {
    if (!bloc.isConnected && bloc.dataset.affiche === 'oui') {
      clearInterval(minuterie);
      return;
    }
    if (bloc.isConnected) bloc.dataset.affiche = 'oui';
    maj();
  }, animationsReduites() ? 60_000 : 1_000);
  return bloc;
}

/** Fin de la semaine (dimanche) et du trimestre civil d'une date. */
function finSemaine(iso: string): string {
  return ajouterJours(iso, (7 - jourSemaine(iso)) % 7);
}
function finTrimestre(iso: string): string {
  const mois = Math.ceil(Number(iso.slice(5, 7)) / 3) * 3;
  return ajouterJours(ajouterMois(`${iso.slice(0, 4)}-${String(mois).padStart(2, '0')}-01`, 1), -1);
}

export function prochainesPublications(m: MarchesJson, aujourdhui: string): HTMLElement {
  const items = m.indicateurs
    .filter((i) => i.prochaine_publication)
    .map((i) => ({ i, p: i.prochaine_publication! }))
    .sort((a, b) => a.p.date.localeCompare(b.p.date) || (a.p.heure ?? '').localeCompare(b.p.heure ?? ''));
  const groupes: [string, typeof items][] = [
    ['Aujourd’hui', items.filter((x) => x.p.date <= aujourdhui)],
    ['Cette semaine', items.filter((x) => x.p.date > aujourdhui && x.p.date <= finSemaine(aujourdhui))],
    ['Ce trimestre', items.filter((x) => x.p.date > finSemaine(aujourdhui) && x.p.date <= finTrimestre(aujourdhui))],
    ['Plus tard', items.filter((x) => x.p.date > finTrimestre(aujourdhui) && x.p.date > finSemaine(aujourdhui))],
  ];
  return h(
    'section',
    { class: 'panneau-marche', 'aria-labelledby': 'titre-publications' },
    h('h2', { id: 'titre-publications' }, 'Prochaines publications attendues'),
    h(
      'ol',
      { class: 'chronologie' },
      ...groupes
        .filter(([, liste]) => liste.length)
        .map(([titre, liste]) =>
          h(
            'li',
            {},
            h('h3', {}, titre),
            h(
              'ul',
              {},
              ...liste.map(({ i, p }) =>
                h(
                  'li',
                  {},
                  h('strong', {}, i.nom),
                  ` · ${i.source.organisme}`,
                  h('span', { class: 'chronologie-quand' }, `${p.date <= aujourdhui ? (p.date < aujourdhui ? `attendue depuis le ${dateCourte(p.date)}` : 'aujourd’hui') : dateCourte(p.date)}${p.heure ? ` à ${heureEnClair(p.heure)}` : ''}${p.estimee ? ' (estimée)' : ' (calendrier officiel)'}`),
                ),
              ),
            ),
          ),
        ),
    ),
  );
}

function conjoncture(news: NewsJson): HTMLElement | null {
  const insee = news.indicateurs.filter((i) => i.source_id === 'insee-bdm');
  if (insee.length === 0) return null;
  return h(
    'section',
    { class: 'panneau-marche', 'aria-labelledby': 'titre-conjoncture' },
    h('h2', { id: 'titre-conjoncture' }, 'Conjoncture (INSEE)'),
    h(
      'dl',
      { class: 'conjoncture' },
      ...insee.flatMap((i) => [h('dt', {}, lienExterne(i.url, i.libelle)), h('dd', { class: 'chiffre' }, i.valeur, h('span', { class: 'texte-secondaire' }, ` · ${i.periode}`))]),
    ),
  );
}

function tableauMarches(conteneur: HTMLElement, m: MarchesJson, news: NewsJson, vue: VueMarches, maintenant: () => Date): void {
  const rendre = () => {
    const actuel = maintenant();
    const choisie = m.indicateurs.find((i) => i.id === vue.choisie) ?? m.indicateurs[0];
    if (!choisie) {
      conteneur.replaceChildren(h('p', { class: 'texte-secondaire' }, 'Aucun indicateur publié.'));
      return;
    }
    vue.choisie = choisie.id;
    const cartes = h(
      'div',
      { class: 'cartes-marche' },
      ...m.indicateurs.map((i, k) => h('div', { class: 'carte-marche-bloc' }, carteIndicateur(i, actuel, i.id === choisie.id, k), lienDuJour(i, 'carte-marche-lien') ?? '')),
    );
    for (const carte of cartes.querySelectorAll<HTMLButtonElement>('.carte-marche')) {
      carte.addEventListener('click', () => {
        vue.choisie = carte.dataset.id as IndicateurMarche['id'];
        rendre();
        conteneur.querySelector<HTMLButtonElement>(`.carte-marche[data-id="${vue.choisie}"]`)?.focus();
      });
    }
    const detail = h('section', { class: 'panneau-marche', 'aria-live': 'polite' }, choisie.id === 'dette' ? detailDette(choisie) : detailLignes(choisie, m, vue, rendre));
    conteneur.replaceChildren(
      cartes,
      h(
        'div',
        { class: 'disposition-marche' },
        detail,
        h('div', { class: 'colonne-marche' }, compteurDette(m.indicateurs.find((i) => i.id === 'dette'), maintenant) ?? '', prochainesPublications(m, enHeureDeParis(actuel).date), conjoncture(news) ?? ''),
      ),
      h('p', { class: 'note texte-secondaire' }, `Indicateurs relevés le ${dateFr(m.genere_le)} à ${enHeureDeParis(new Date(m.genere_le)).heure.replace(':', ' h ')}. Valeurs officielles publiées par chaque organisme ; relues à l’ouverture de cet onglet.`),
    );
  };
  rendre();
}

async function rendreMarches(zone: HTMLElement, ctx: ContexteSuivi): Promise<void> {
  const vue: VueMarches = { choisie: 'dette', periode: 12, comparer: false, avec: '' };
  const contenu = h('div', { class: 'marches' }, h('p', { class: 'texte-secondaire', role: 'status' }, 'Chargement des indicateurs…'));
  zone.append(contenu);
  const charger = async () => {
    const r = await chargerMarches();
    if (!contenu.isConnected) return false;
    if (!r.ok) {
      contenu.replaceChildren(
        h('p', { class: 'texte-secondaire' }, r.raison === 'absent'
          ? 'Les indicateurs n’ont pas encore été collectés : ils le seront au prochain créneau (7 h 05, 9 h 02, 15 h 25, 16 h 20 ou 19 h 30, les jours ouvrés).'
          : 'Les indicateurs n’ont pas pu être chargés. Vérifiez votre connexion puis rechargez la page.'),
      );
      return true;
    }
    tableauMarches(contenu, r.donnees, ctx.news, vue, ctx.maintenant);
    return true;
  };
  await charger();
  // Relecture quand l'onglet du navigateur redevient visible ; jamais de requête périodique.
  const surVisibilite = () => {
    if (!contenu.isConnected) {
      document.removeEventListener('visibilitychange', surVisibilite);
      return;
    }
    if (document.visibilityState === 'visible') void charger();
  };
  document.addEventListener('visibilitychange', surVisibilite);
}

// --- PLF / PLFSS ---

const LIBELLES_STATUT = { fait: 'Fait', en_cours: 'En cours', a_venir: 'À venir' } as const;

/** Seuil d'importance (classement par mots-clés) au-delà duquel un article figure parmi les principales mesures. */
export const SEUIL_MESURE_PRINCIPALE = 3;

/** Paliers des principales mesures, du plus au moins important. */
export const PALIERS_MESURES = [
  { importance: 5, titre: 'Essentiel pour nos dossiers' },
  { importance: 4, titre: 'Important' },
  { importance: 3, titre: 'À suivre' },
] as const;

function ligneArticle(a: ArticleProjet, avecImportance: boolean): HTMLElement {
  const libelle = `Art. ${a.numero} — ${a.intitule}`;
  return h(
    'li',
    { class: 'mesure' },
    a.url ? lienExterne(a.url, libelle) : h('span', {}, libelle),
    avecImportance
      ? h('span', { class: 'mesure-meta' }, ' ', a.rubrique ? h('span', { class: 'puce puce-rubrique' }, a.rubrique) : badgeImportance(a.importance), ...a.public.map((p) => h('span', { class: 'puce' }, p)))
      : null,
  );
}

function mesures(suivi: SuiviTexte, nom: string): HTMLElement | null {
  const m = suivi.mesures;
  if (!m) return null;
  const parPole = m.hierarchie?.origine === 'pole';
  const paliers = PALIERS_MESURES.map((p) => ({ ...p, articles: m.articles.filter((a) => a.importance === p.importance) })).filter((p) => p.articles.length > 0);
  const groupes = new Map<string, ArticleProjet[]>();
  for (const a of m.articles) {
    const cle = [a.partie, a.groupe].filter(Boolean).join(' — ') || 'Articles';
    groupes.set(cle, [...(groupes.get(cle) ?? []), a]);
  }
  return h(
    'section',
    { class: 'carte mesures', 'aria-label': `Mesures du ${suivi.texte}` },
    h('h2', {}, `${nom} — principales mesures pour nos métiers`),
    paliers.length
      ? h('div', { class: 'paliers-mesures' }, ...paliers.flatMap((p) => [h('h3', { class: `palier palier-${p.importance}` }, `${p.titre} (${p.articles.length})`), h('ul', { class: 'liste-mesures' }, ...p.articles.map((a) => ligneArticle(a, true)))]))
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
      '. Ils évolueront avec les amendements. ',
      parPole && m.hierarchie?.etablie_le
        ? `Hiérarchie établie par le pôle le ${dateFr(m.hierarchie.etablie_le)}, d’après les intitulés.`
        : `Mesures choisies par nos mots-clés (importance ${SEUIL_MESURE_PRINCIPALE} et plus).`,
    ),
  );
}

/** Frise interactive d'un texte : clic sur une étape → articles de la veille publiés pendant cette étape. */
export function friseTexte(suivi: SuiviTexte | null, nom: string, theme: Theme, news: NewsJson, aujourdhui: string): HTMLElement {
  if (!suivi) {
    return h(
      'section',
      { class: 'carte suivi' },
      h('h2', {}, nom),
      h('p', { class: 'texte-secondaire' }, 'Pas encore de suivi : le dossier législatif n’a pas pu être lu. Il est relu à chaque collecte (jours ouvrés, 6 h 30).'),
    );
  }
  const indiceCourant = Math.max(0, suivi.etapes.findIndex((e) => e.statut === 'en_cours') >= 0 ? suivi.etapes.findIndex((e) => e.statut === 'en_cours') : suivi.etapes.map((e) => e.statut).lastIndexOf('fait'));
  const liste = h('div', { class: 'articles-etape', 'aria-live': 'polite' });
  const boutons = suivi.etapes.map((e, k) => {
    const b = h(
      'button',
      { type: 'button', class: `etape-frise etape-${e.statut}`, 'aria-pressed': String(k === indiceCourant), 'aria-current': e.statut === 'en_cours' ? 'step' : false },
      h('span', { class: 'etape-point', 'aria-hidden': 'true' }),
      h('span', { class: 'etape-libelle' }, e.libelle),
      h('span', { class: 'etape-date chiffre' }, e.statut === 'en_cours' && e.date ? `depuis le ${dateCourte(e.date)}` : e.date ? dateCourte(e.date) : LIBELLES_STATUT[e.statut].toLowerCase()),
      e.saisie ? h('span', { class: 'etape-saisie' }, 'saisie du pôle') : null,
    );
    b.addEventListener('click', () => {
      boutons.forEach((x, j) => x.setAttribute('aria-pressed', String(j === k)));
      afficherArticles(k);
    });
    return b;
  });
  const afficherArticles = (k: number) => {
    const etape = suivi.etapes[k]!;
    const articles = articlesDeLEtape(news.articles, suivi, theme, k, aujourdhui);
    liste.replaceChildren(
      h('h3', {}, `Articles de la veille liés à l’étape « ${etape.libelle} »`),
      etape.statut === 'a_venir' && (!etape.date || etape.date > aujourdhui)
        ? h('p', { class: 'texte-secondaire' }, 'Étape à venir : les articles apparaîtront quand elle commencera.')
        : articles.length
          ? h('ul', { class: 'liste-articles-etape' }, ...articles.slice(0, 12).map((a) => h('li', {}, lienExterne(a.url, a.titre), h('span', { class: 'texte-secondaire' }, ` — ${a.source}, ${dateFr(a.date)} `), badgeImportance(a.importance))))
          : h('p', { class: 'texte-secondaire' }, 'Aucun article de la veille sur cette période.'),
      articles.length > 12 ? h('p', { class: 'texte-secondaire' }, `… et ${articles.length - 12} autres dans le fil d’actualité.`) : '',
    );
  };
  afficherArticles(indiceCourant);
  const echeances = [
    ...(suivi.delais ?? []).filter((d) => d.date && d.date >= aujourdhui).map((d) => ({ libelle: d.libelle, date: d.date!, note: 'délai indicatif' })),
    ...(suivi.echeances_saisies ?? []).map((e) => ({ libelle: e.libelle, date: e.date ?? '', note: `source : ${e.source}` })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const enCours = suivi.etapes[indiceCourant];
  return h(
    'section',
    { class: 'carte suivi', 'aria-label': `Suivi du ${suivi.texte}` },
    h('div', { class: 'panneau-tete' }, h('h2', {}, `${nom} — ${suivi.texte}`), enCours ? h('span', { class: 'badge badge-etape' }, `Étape en cours : ${suivi.etape_actuelle}`) : null),
    h('ol', { class: 'frise-interactive', 'aria-label': `Étapes du ${suivi.texte}` }, ...boutons.map((b) => h('li', {}, b))),
    echeances.length
      ? h('div', { class: 'echeances-texte' }, h('h3', {}, 'Échéances à venir'), h('ul', {}, ...echeances.map((e) => h('li', {}, h('strong', { class: 'chiffre' }, dateCourte(e.date)), ` ${e.libelle} (${e.note})`))))
      : null,
    liste,
    h(
      'p',
      { class: 'texte-secondaire note' },
      `Relevé le ${dateFr(suivi.mis_a_jour_le)} sur les dossiers législatifs `,
      suivi.url ? lienExterne(suivi.url, 'de l’Assemblée nationale') : 'de l’Assemblée nationale',
      ...(suivi.url_senat ? [' et ', lienExterne(suivi.url_senat, 'du Sénat')] : []),
      '. Étapes « à venir » et délais (comptés depuis le dépôt) indicatifs.',
    ),
  );
}

function rendrePlf(zone: HTMLElement, ctx: ContexteSuivi): void {
  const aujourdhui = dateIsoParis(ctx.maintenant());
  const { plf, plfss } = ctx.news.suivi;
  const cartesMesures = [plf ? mesures(plf, 'PLF') : null, plfss ? mesures(plfss, 'PLFSS') : null].filter((c): c is HTMLElement => c !== null);
  zone.append(
    h('div', { class: 'grille-suivi' }, friseTexte(plf, 'Loi de finances', 'Loi de finances', ctx.news, aujourdhui), friseTexte(plfss, 'Financement de la sécurité sociale', 'Sécurité sociale', ctx.news, aujourdhui)),
    cartesMesures.length ? h('div', { class: 'grille-suivi' }, ...cartesMesures) : '',
  );
}

// --- État des sources ---

type Pastille = 'vert' | 'orange' | 'rouge' | 'gris';

/** 30 pastilles (du plus ancien au plus récent) à partir d'un journal { date, état }. */
export function pastilles(journal: readonly { date: string; etat: string }[], aujourdhui: string): { date: string; couleur: Pastille; libelle: string }[] {
  const parDate = new Map(journal.map((j) => [j.date, j.etat]));
  const resultat: { date: string; couleur: Pastille; libelle: string }[] = [];
  for (let k = 29; k >= 0; k--) {
    const date = ajouterJours(aujourdhui, -k);
    const etat = parDate.get(date);
    const [couleur, libelle]: [Pastille, string] =
      etat === 'ok' ? ['vert', 'collecte réussie']
        : etat === 'sans_nouveaute' ? ['orange', 'valeur attendue, pas encore publiée']
          : etat === 'erreur' ? ['rouge', 'échec']
            : etat === 'non_configuree' || etat === 'inactive' ? ['gris', 'non collectée']
              : ['gris', 'pas de collecte'];
    resultat.push({ date, couleur, libelle });
  }
  return resultat;
}

function rangeePastilles(journal: readonly { date: string; etat: string }[], aujourdhui: string): HTMLElement {
  const p = pastilles(journal, aujourdhui);
  const resume = `${p.filter((x) => x.couleur === 'vert').length} réussies, ${p.filter((x) => x.couleur === 'orange').length} en attente, ${p.filter((x) => x.couleur === 'rouge').length} en échec sur 30 jours`;
  return h('span', { class: 'pastilles', role: 'img', 'aria-label': resume, title: resume }, ...p.map((x) => h('i', { class: `pastille pastille-${x.couleur}`, title: `${dateCourte(x.date)} : ${x.libelle}` })));
}

/** Fraîcheur d'une source de veille : à jour si la dernière réussite date de moins de 4 jours. */
export function fraicheurSource(s: EtatSource, maintenant: Date): Fraicheur | 'non_configuree' | 'inactive' {
  if (s.etat === 'non_configuree' || s.etat === 'inactive') return s.etat;
  if (s.etat === 'erreur') return 'en_panne';
  const age = s.derniere_reussite ? ecartJours(s.derniere_reussite.slice(0, 10), dateIsoParis(maintenant)) : Infinity;
  return age <= 4 ? 'a_jour' : 'en_retard';
}

const instantEnClair = (iso: string | null) => (iso ? `${dateCourte(enHeureDeParis(new Date(iso)).date)} ${enHeureDeParis(new Date(iso)).heure.replace(':', ' h ')}` : '—');

function rendreSources(zone: HTMLElement, ctx: ContexteSuivi): void {
  const maintenant = ctx.maintenant();
  const aujourdhui = dateIsoParis(maintenant);
  const corps = h('tbody', {});
  const entete = h('thead', {}, h('tr', {}, ...['Source', 'Fraîcheur', 'Dernière réussite', 'Prochaine récupération', 'Éléments', '30 derniers jours', 'Dernière erreur'].map((t) => h('th', { scope: 'col' }, t))));
  const groupe = (titre: string) => h('tr', { class: 'groupe-sources' }, h('th', { colspan: '7', scope: 'colgroup' }, titre));
  const etatVeille = ctx.etat;
  const prochaineVeille = prochainCreneau(maintenant, [CRENEAU_VEILLE]).toISOString();

  const lignesMarches = h('tbody', {}, h('tr', {}, h('td', { colspan: '7', class: 'texte-secondaire' }, 'Chargement des indicateurs…')));
  void chargerMarches().then((r) => {
    if (!r.ok) {
      lignesMarches.replaceChildren(h('tr', {}, h('td', { colspan: '7', class: 'texte-secondaire' }, 'Indicateurs pas encore collectés.')));
      return;
    }
    lignesMarches.replaceChildren(
      groupe('Indicateurs de marché et de finances publiques'),
      ...r.donnees.indicateurs.map((i) =>
        h(
          'tr',
          {},
          h('th', { scope: 'row' }, `${i.nom} — ${i.source.organisme}`, i.source.secours ? h('span', { class: 'texte-secondaire' }, ' (secours)') : ''),
          h('td', {}, badgeFraicheur(calculerFraicheur(i, maintenant))),
          h('td', { class: 'chiffre' }, instantEnClair(i.derniere_reussite)),
          h('td', { class: 'chiffre' }, instantEnClair(prochaineRecuperation(i, maintenant).toISOString())),
          h('td', { class: 'nombre' }, String(i.historique.length)),
          h('td', {}, rangeePastilles(i.journal, aujourdhui)),
          h('td', {}, i.derniere_erreur ?? i.remarque ?? ''),
        ),
      ),
    );
  });

  if (etatVeille) {
    corps.append(
      groupe('Veille (flux, API, dossiers législatifs, calendrier fiscal)'),
      ...etatVeille.sources.map((s) => {
        const f = fraicheurSource(s, maintenant);
        return h(
          'tr',
          {},
          h('th', { scope: 'row' }, s.nom),
          h('td', {}, f === 'non_configuree' || f === 'inactive' ? h('span', { class: 'badge badge-fraicheur fraicheur-neutre' }, f === 'inactive' ? 'Inactive' : 'Non configurée') : badgeFraicheur(f)),
          h('td', { class: 'chiffre' }, instantEnClair(s.derniere_reussite)),
          h('td', { class: 'chiffre' }, f === 'inactive' || f === 'non_configuree' ? '—' : instantEnClair(prochaineVeille)),
          h('td', { class: 'nombre' }, String(s.nb_elements ?? s.nb_articles)),
          h('td', {}, rangeePastilles(s.historique ?? [], aujourdhui)),
          h('td', {}, s.erreur ?? ''),
        );
      }),
    );
  }
  zone.append(
    h('p', {}, etatVeille ? `Dernière collecte de la veille : ${instantEnClair(etatVeille.genere_le)}.` : 'L’état de la veille n’est pas encore disponible.'),
    h('div', { class: 'tableau-defilant' }, h('table', { class: 'tableau tableau-sources' }, h('caption', { class: 'visuellement-masque' }, 'État des sources'), entete, lignesMarches, corps)),
    h(
      'p',
      { class: 'note texte-secondaire' },
      'Pastilles : vert, collecte réussie ; orange, valeur attendue mais pas encore publiée ; rouge, échec ; gris, pas de collecte ce jour-là (week-end, source non configurée). ',
      'Une source « non configurée » attend son identifiant (secret GitHub) ; elle ne bloque jamais la collecte.',
    ),
    etatVeille
      ? h(
          'section',
          { class: 'carte' },
          h('h2', {}, 'Classement et coût'),
          h('p', {}, `Classement par mots-clés : ${etatVeille.classement.articles} article(s) en ligne, dont ${etatVeille.classement.marginaux} marginal(aux) masqué(s) par défaut ; ${etatVeille.classement.exclus} exclu(s).`),
          h('p', {}, `Recherche IA : ${etatVeille.recherche_ia.raison}.`),
          h('p', {}, h('strong', {}, 'Coût : '), '0 € (sources publiques gratuites, exécution sur GitHub Actions).'),
        )
      : '',
  );
}

// --- Onglet ---

export function rendreSuivi(conteneur: HTMLElement, ctx: ContexteSuivi): void {
  const liste = h('div', { class: 'sous-onglets', role: 'tablist', 'aria-label': 'Suivi' });
  const zone = h('div', { class: 'zone-suivi', role: 'tabpanel', tabindex: '0', id: 'panneau-suivi' });
  const boutons = SOUS_ONGLETS.map((o) => h('button', { type: 'button', role: 'tab', id: `sous-onglet-${o.id}`, 'aria-controls': 'panneau-suivi' }, o.libelle));
  liste.append(...boutons);
  const activer = (id: IdSousOnglet, focus = false) => {
    boutons.forEach((b, k) => {
      const actif = SOUS_ONGLETS[k]?.id === id;
      b.setAttribute('aria-selected', String(actif));
      b.tabIndex = actif ? 0 : -1;
      if (actif && focus) b.focus();
    });
    zone.setAttribute('aria-labelledby', `sous-onglet-${id}`);
    zone.replaceChildren();
    ctx.changerAncre(id);
    if (id === 'marches') void rendreMarches(zone, ctx);
    if (id === 'plf') rendrePlf(zone, ctx);
    if (id === 'sources') rendreSources(zone, ctx);
  };
  boutons.forEach((b, k) => {
    b.addEventListener('click', () => activer(SOUS_ONGLETS[k]!.id));
    b.addEventListener('keydown', (e) => {
      const cible = { ArrowRight: k + 1, ArrowLeft: k - 1, Home: 0, End: SOUS_ONGLETS.length - 1 }[e.key];
      if (cible === undefined) return;
      e.preventDefault();
      activer(SOUS_ONGLETS[(cible + SOUS_ONGLETS.length) % SOUS_ONGLETS.length]!.id, true);
    });
  });
  conteneur.append(liste, zone);
  activer(ctx.sousOnglet);
}
