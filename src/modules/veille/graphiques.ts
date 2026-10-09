/**
 * Graphiques SVG du suivi des marchés, dessinés sans librairie ni style en ligne (CSP) : couleurs et traits
 * par classes CSS (jetons --c-serie-1, --c-serie-2), positions par attributs SVG, infobulle positionnée
 * par le CSSOM. Une seule échelle verticale par graphique (pas de double axe).
 */
import { h } from '../../app/dom.ts';

const NS = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(balise: K, attributs: Record<string, string | number> = {}, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, balise);
  for (const [nom, valeur] of Object.entries(attributs)) e.setAttribute(nom, String(valeur));
  parent?.append(e);
  return e;
}

export const nombreFr = (n: number, decimales: number) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales }).format(n);

export const dateCourte = (iso: string) => iso.split('-').reverse().join('/');

/** Graduations « rondes » couvrant [min, max] (environ `nombre` intervalles). */
export function graduations(min: number, max: number, nombre = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const brut = (max - min) / nombre;
  const puissance = 10 ** Math.floor(Math.log10(brut));
  const pas = [1, 2, 2.5, 5, 10].map((m) => m * puissance).find((p) => p >= brut) ?? brut;
  const debut = Math.ceil(min / pas - 1e-9) * pas;
  const resultat: number[] = [];
  for (let v = debut; v <= max + pas * 1e-9; v += pas) resultat.push(Math.round(v / pas) * pas || 0);
  return resultat;
}

/** Décimales utiles pour afficher des graduations d'un pas donné. */
function decimalesPas(valeurs: number[]): number {
  const pas = valeurs.length > 1 ? Math.abs(valeurs[1]! - valeurs[0]!) : 1;
  return pas >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(pas)));
}

/** Mini-graphique (30 dernières valeurs) : ligne fine, aire légère, point final. */
export function sparkline(valeurs: readonly number[], libelle: string): SVGSVGElement {
  const L = 220;
  const H = 40;
  const s = svg('svg', { viewBox: `0 0 ${L} ${H}`, preserveAspectRatio: 'none', class: 'sparkline', role: 'img', 'aria-label': libelle });
  if (valeurs.length < 2) return s;
  const min = Math.min(...valeurs);
  const max = Math.max(...valeurs);
  const e = max - min || 1;
  const xy = valeurs.map((v, i) => [(i * L) / (valeurs.length - 1), H - 4 - ((v - min) / e) * (H - 8)] as const);
  const chemin = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L');
  svg('path', { d: `M${chemin} L${L},${H} L0,${H} Z`, class: 'sparkline-aire' }, s);
  svg('path', { d: `M${chemin}`, class: 'sparkline-ligne', 'vector-effect': 'non-scaling-stroke' }, s);
  const [fx, fy] = xy.at(-1)!;
  svg('circle', { cx: fx.toFixed(1), cy: fy.toFixed(1), r: 2.5, class: 'sparkline-point' }, s);
  return s;
}

export interface SerieTrace {
  nom: string;
  /** Classe de couleur : « serie-1 » ou « serie-2 ». */
  classe: 'serie-1' | 'serie-2';
  points: readonly [string, number][];
  /** Valeur affichée dans l'infobulle (la valeur brute, même en base 100). */
  libelleValeur: (i: number) => string;
}

export interface OptionsLignes {
  series: SerieTrace[];
  /** Repères verticaux (réunions de la BCE, dépôt du PLF). */
  evenements?: readonly { date: string; libelle: string }[];
  formatAxe: (v: number, decimales: number) => string;
  /** Marque le minimum et le maximum de la première série. */
  extremes?: boolean;
  description: string;
  /** Hauteur du dessin (unités du viewBox, largeur 720) ; 280 par défaut. */
  hauteur?: number;
}

const L = 720;
const H_DEFAUT = 280;
const M = { haut: 26, droite: 16, bas: 28, gauche: 58 };

const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/**
 * Graphique en lignes, toutes les séries sur les dates de la première. Survol et clavier (flèches) :
 * ligne de repère et infobulle « date · valeur ».
 */
export function graphiqueLignes(o: OptionsLignes): HTMLElement {
  const conteneur = h('div', { class: 'graphique' });
  const bulle = h('div', { class: 'graphique-infobulle', role: 'status', 'aria-live': 'polite', hidden: true });
  const reference = o.series[0];
  if (!reference || reference.points.length < 2) {
    conteneur.append(h('p', { class: 'texte-secondaire' }, 'Pas assez de valeurs sur cette période.'));
    return conteneur;
  }
  const n = reference.points.length;
  const H = o.hauteur ?? H_DEFAUT;
  const toutes = o.series.flatMap((s) => s.points.map((p) => p[1]));
  let min = Math.min(...toutes);
  let max = Math.max(...toutes);
  const marge = (max - min) * 0.08 || Math.abs(max) * 0.01 || 1;
  min -= marge;
  max += marge;
  const X = (i: number) => M.gauche + (i * (L - M.gauche - M.droite)) / (n - 1);
  const Y = (v: number) => M.haut + ((max - v) / (max - min)) * (H - M.haut - M.bas);

  const s = svg('svg', { viewBox: `0 0 ${L} ${H}`, role: 'img', 'aria-label': o.description, tabindex: 0, class: 'graphique-svg' });
  const ticks = graduations(min, max, 4);
  const dec = decimalesPas(ticks);
  for (const v of ticks) {
    svg('line', { x1: M.gauche, x2: L - M.droite, y1: Y(v).toFixed(1), y2: Y(v).toFixed(1), class: 'graphique-grille' }, s);
    svg('text', { x: M.gauche - 8, y: (Y(v) + 4).toFixed(1), 'text-anchor': 'end', class: 'graphique-axe' }, s).textContent = o.formatAxe(v, dec);
  }
  // Graduations de mois (un mois sur 1, 2 ou 3 selon la période).
  const pasMois = n > 300 ? 3 : n > 120 ? 2 : 1;
  let moisPrecedent = '';
  reference.points.forEach(([date], i) => {
    const mois = date.slice(0, 7);
    if (mois === moisPrecedent) return;
    moisPrecedent = mois;
    const m = Number(date.slice(5, 7));
    if (i === 0 || (m - 1) % pasMois !== 0 || X(i) > L - M.droite - 20) return;
    const t = svg('text', { x: X(i).toFixed(1), y: H - 8, 'text-anchor': 'middle', class: 'graphique-axe' }, s);
    t.textContent = m === 1 ? `${MOIS_COURTS[0]} ${date.slice(2, 4)}` : MOIS_COURTS[m - 1]!;
  });
  // Repères d'événements : ligne pointillée et libellé court en haut.
  const dates = reference.points.map((p) => p[0]);
  let dernierLibelleX = -Infinity;
  for (const ev of o.evenements ?? []) {
    if (ev.date < dates[0]! || ev.date > dates[n - 1]!) continue;
    const i = dates.findIndex((d) => d >= ev.date);
    if (i < 0) continue;
    const x = X(i);
    const g = svg('g', { class: 'graphique-evenement' }, s);
    svg('line', { x1: x.toFixed(1), x2: x.toFixed(1), y1: M.haut, y2: H - M.bas }, g);
    svg('title', {}, g).textContent = `${ev.libelle} — ${dateCourte(ev.date)}`;
    if (x - dernierLibelleX > 46) {
      svg('text', { x: x.toFixed(1), y: M.haut - 10, 'text-anchor': 'middle' }, g).textContent = ev.libelle.replace(/^Réunion /, '');
      dernierLibelleX = x;
    }
  }
  for (const serie of o.series) {
    const d = serie.points.map(([, v], i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
    svg('path', { d, class: `graphique-ligne ${serie.classe}` }, s);
  }
  if (o.extremes) {
    const valeurs = reference.points.map((p) => p[1]);
    for (const i of new Set([valeurs.indexOf(Math.min(...valeurs)), valeurs.indexOf(Math.max(...valeurs))])) {
      svg('circle', { cx: X(i).toFixed(1), cy: Y(valeurs[i]!).toFixed(1), r: 4, class: `graphique-extreme ${reference.classe}` }, s);
    }
  }
  const repere = svg('line', { y1: M.haut, y2: H - M.bas, class: 'graphique-repere', visibility: 'hidden' }, s);
  const zone = svg('rect', { x: M.gauche, y: M.haut, width: L - M.gauche - M.droite, height: H - M.haut - M.bas, class: 'graphique-zone' }, s);

  let courant = n - 1;
  const montrer = (i: number) => {
    courant = Math.max(0, Math.min(n - 1, i));
    const x = X(courant);
    repere.setAttribute('x1', x.toFixed(1));
    repere.setAttribute('x2', x.toFixed(1));
    repere.setAttribute('visibility', 'visible');
    bulle.textContent = `${dateCourte(reference.points[courant]![0])} · ${o.series.map((serie) => `${o.series.length > 1 ? `${serie.nom} ` : ''}${serie.libelleValeur(courant)}`).join(' · ')}`;
    bulle.hidden = false;
    const largeur = s.getBoundingClientRect().width || L;
    bulle.style.left = `${Math.max(60, Math.min(largeur - 60, (x / L) * largeur))}px`;
  };
  const cacher = () => {
    repere.setAttribute('visibility', 'hidden');
    bulle.hidden = true;
  };
  zone.addEventListener('pointermove', (e) => {
    const r = s.getBoundingClientRect();
    const x = ((e.clientX - r.left) * L) / (r.width || L);
    montrer(Math.round(((x - M.gauche) / (L - M.gauche - M.droite)) * (n - 1)));
  });
  zone.addEventListener('pointerleave', cacher);
  s.addEventListener('focus', () => montrer(courant));
  s.addEventListener('blur', cacher);
  s.addEventListener('keydown', (e) => {
    const pas = { ArrowLeft: -1, ArrowRight: 1, PageUp: -20, PageDown: 20 }[e.key];
    if (pas !== undefined) {
      e.preventDefault();
      montrer(courant + pas);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      montrer(e.key === 'Home' ? 0 : n - 1);
    }
  });
  conteneur.append(s, bulle);
  return conteneur;
}

export interface OptionsBarres {
  points: readonly [string, number][];
  libelle: (date: string) => string;
  formatValeur: (v: number) => string;
  description: string;
}

/** Barres verticales (dette trimestrielle), axe partant de zéro, infobulle au survol de chaque barre. */
export function graphiqueBarres(o: OptionsBarres): HTMLElement {
  const conteneur = h('div', { class: 'graphique' });
  const bulle = h('div', { class: 'graphique-infobulle', role: 'status', 'aria-live': 'polite', hidden: true });
  const n = o.points.length;
  if (n === 0) return conteneur;
  const max = Math.max(...o.points.map((p) => p[1])) * 1.06;
  const hauteur = 220;
  const Y = (v: number) => M.haut + ((max - v) / max) * (hauteur - M.haut - M.bas);
  const largeurBande = (L - M.gauche - M.droite) / n;
  const s = svg('svg', { viewBox: `0 0 ${L} ${hauteur}`, role: 'img', 'aria-label': o.description, class: 'graphique-svg' });
  const ticks = graduations(0, max, 4);
  for (const v of ticks) {
    svg('line', { x1: M.gauche, x2: L - M.droite, y1: Y(v).toFixed(1), y2: Y(v).toFixed(1), class: 'graphique-grille' }, s);
    svg('text', { x: M.gauche - 8, y: (Y(v) + 4).toFixed(1), 'text-anchor': 'end', class: 'graphique-axe' }, s).textContent = nombreFr(v, 0);
  }
  o.points.forEach(([date, v], i) => {
    const x = M.gauche + i * largeurBande + largeurBande * 0.2;
    const l = largeurBande * 0.6;
    const y = Y(v);
    const base = Y(0);
    const r = Math.min(4, l / 2);
    // Barre aux coins supérieurs arrondis, ancrée sur l'axe.
    const barre = svg('path', {
      d: `M${x.toFixed(1)},${base.toFixed(1)} V${(y + r).toFixed(1)} Q${x.toFixed(1)},${y.toFixed(1)} ${(x + r).toFixed(1)},${y.toFixed(1)} H${(x + l - r).toFixed(1)} Q${(x + l).toFixed(1)},${y.toFixed(1)} ${(x + l).toFixed(1)},${(y + r).toFixed(1)} V${base.toFixed(1)} Z`,
      class: `graphique-barre serie-1${i === n - 1 ? ' graphique-barre-derniere' : ''}`,
      tabindex: 0,
      'aria-label': `${o.libelle(date)} : ${o.formatValeur(v)}`,
    }, s);
    const montrer = () => {
      bulle.textContent = `${o.libelle(date)} · ${o.formatValeur(v)}`;
      bulle.hidden = false;
      const largeur = s.getBoundingClientRect().width || L;
      bulle.style.left = `${Math.max(60, Math.min(largeur - 60, ((x + l / 2) / L) * largeur))}px`;
    };
    barre.addEventListener('pointerenter', montrer);
    barre.addEventListener('focus', montrer);
    barre.addEventListener('pointerleave', () => (bulle.hidden = true));
    barre.addEventListener('blur', () => (bulle.hidden = true));
    if (n <= 16 || i % 2 === n % 2) {
      svg('text', { x: (x + l / 2).toFixed(1), y: hauteur - 8, 'text-anchor': 'middle', class: 'graphique-axe' }, s).textContent = o.libelle(date);
    }
  });
  conteneur.append(s, bulle);
  return conteneur;
}

/** Vue tableau des valeurs (accessibilité), repliée par défaut. */
export function tableauValeurs(titre: string, colonnes: string[], lignes: (string | number)[][]): HTMLElement {
  return h(
    'details',
    { class: 'graphique-tableau' },
    h('summary', {}, `Voir les valeurs (${lignes.length})`),
    h(
      'div',
      { class: 'tableau-defilant' },
      h(
        'table',
        { class: 'tableau' },
        h('caption', { class: 'visuellement-masque' }, titre),
        h('thead', {}, h('tr', {}, ...colonnes.map((c) => h('th', { scope: 'col' }, c)))),
        h('tbody', {}, ...[...lignes].reverse().map((l) => h('tr', {}, ...l.map((c, i) => h(i ? 'td' : 'th', i ? { class: 'nombre' } : { scope: 'row' }, String(c)))))),
      ),
    ),
  );
}
