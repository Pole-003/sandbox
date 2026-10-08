const NS = 'http://www.w3.org/2000/svg';

type Attributs = Record<string, string | number>;

function s(balise: string, attributs: Attributs = {}, ...enfants: SVGElement[]): SVGElement {
  const element = document.createElementNS(NS, balise);
  for (const [nom, valeur] of Object.entries(attributs)) element.setAttribute(nom, String(valeur));
  element.append(...enfants);
  return element;
}

const ETOILES: [number, number, number][] = [
  [30, 30, 1.2], [78, 64, 0.9], [122, 22, 1.4], [170, 52, 0.8], [214, 18, 1.1], [300, 40, 1.3],
  [338, 76, 0.9], [262, 88, 0.8], [52, 110, 1], [190, 104, 1.2], [326, 128, 1], [140, 140, 0.8],
];

/** Scène de l'animation d'ouverture : ciel étoilé, télescope sur trépied, fusée sur son pas de tir. */
export function construireScene(): SVGElement {
  const etoiles = s(
    'g',
    { class: 'intro-etoiles' },
    ...ETOILES.map(([cx, cy, r], i) => s('circle', { cx, cy, r, class: `intro-etoile intro-etoile-${i % 3}` })),
  );

  // Télescope : le tube pivote autour de la monture (90, 150) ; le capot est articulé sur le bord haut de l'objectif.
  const tube = s(
    'g',
    { class: 'intro-tube' },
    s('rect', { x: 50, y: 145, width: 12, height: 10, rx: 2, class: 'intro-metal-sombre' }),
    s('rect', { x: 60, y: 142, width: 84, height: 16, rx: 3, class: 'intro-metal' }),
    s('rect', { x: 96, y: 141, width: 6, height: 18, rx: 1, class: 'intro-metal-sombre' }),
    s('rect', { x: 142, y: 137, width: 18, height: 26, rx: 3, class: 'intro-metal' }),
    s('ellipse', { cx: 160, cy: 150, rx: 2.5, ry: 11, class: 'intro-lentille' }),
    s('rect', { x: 160, y: 136, width: 4, height: 28, rx: 1.5, class: 'intro-capot' }),
  );
  const telescope = s(
    'g',
    { class: 'intro-telescope' },
    s('line', { x1: 90, y1: 152, x2: 62, y2: 212, class: 'intro-pied' }),
    s('line', { x1: 90, y1: 152, x2: 118, y2: 212, class: 'intro-pied' }),
    s('line', { x1: 90, y1: 152, x2: 92, y2: 212, class: 'intro-pied' }),
    tube,
    s('circle', { cx: 90, cy: 150, r: 5, class: 'intro-metal-sombre' }),
  );

  const fumee = s(
    'g',
    { class: 'intro-fumee' },
    s('circle', { cx: 262, cy: 206, r: 9, class: 'intro-bouffee intro-bouffee-1' }),
    s('circle', { cx: 284, cy: 206, r: 11, class: 'intro-bouffee intro-bouffee-2' }),
    s('circle', { cx: 306, cy: 206, r: 9, class: 'intro-bouffee intro-bouffee-3' }),
  );

  const fusee = s(
    'g',
    { class: 'intro-fusee' },
    s('path', { d: 'M278 190 L284 214 L290 190 Z', class: 'intro-flamme' }),
    s('path', { d: 'M274 182 L266 194 L274 192 Z', class: 'intro-aileron' }),
    s('path', { d: 'M294 182 L302 194 L294 192 Z', class: 'intro-aileron' }),
    s('path', { d: 'M284 140 C294 152 296 170 294 192 L274 192 C272 170 274 152 284 140 Z', class: 'intro-carlingue' }),
    s('path', { d: 'M284 140 C289 146 292 152 293 158 L275 158 C276 152 279 146 284 140 Z', class: 'intro-ogive' }),
    s('circle', { cx: 284, cy: 170, r: 5, class: 'intro-hublot' }),
  );

  return s(
    'svg',
    { viewBox: '0 0 360 230', class: 'intro-scene', 'aria-hidden': 'true', focusable: 'false' },
    etoiles,
    s('rect', { x: 0, y: 212, width: 360, height: 18, class: 'intro-sol' }),
    s('rect', { x: 262, y: 206, width: 44, height: 6, rx: 1, class: 'intro-metal-sombre' }),
    fumee,
    fusee,
    telescope,
  );
}
