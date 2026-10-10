import { h } from './dom.ts';
import { Menu, Monitor, Moon, ShieldCheck, Sun, icone } from './icones.ts';
import type { DescripteurModule } from './module.ts';
import { lienVers, resoudreRoute } from './routeur.ts';
import { LIBELLES_THEME, appliquerTheme, lireChoixTheme, memoriserTheme, themeSuivant, type ChoixTheme } from './theme.ts';

const ICONES_THEME = { auto: Monitor, clair: Sun, sombre: Moon } as const;

export interface OptionsCoque {
  modules: readonly DescripteurModule[];
  version: string;
  canal: 'production' | 'beta';
}

/** Monte la coque d'interface (barre latérale, en-tête, zone principale) et le routage par ancre. */
export function monterCoque(racine: HTMLElement, { modules, version, canal }: OptionsCoque): () => void {
  const actifs = modules.filter((m) => m.statut === 'actif');
  const idsActifs = actifs.map((m) => m.id);
  const defaut = idsActifs[0] ?? 'accueil';

  // --- Barre latérale ---
  const liens = new Map<string, HTMLAnchorElement>();
  const elementsNav = modules.map((m) => {
    if (m.statut === 'bientot') {
      return h(
        'li',
        {},
        h(
          'span',
          { class: 'nav-element nav-bientot', 'aria-disabled': 'true', title: 'Bientôt disponible' },
          icone(m.icone),
          h('span', { class: 'nav-libelle' }, m.libelle),
          h('span', { class: 'etiquette' }, 'bientôt'),
        ),
      );
    }
    const lien = h(
      'a',
      { class: 'nav-element', href: lienVers(m.id), 'aria-keyshortcuts': `g ${m.id[0]}` },
      icone(m.icone),
      h('span', { class: 'nav-libelle' }, m.libelle),
      h('kbd', { class: 'nav-touche', 'aria-hidden': 'true' }, m.id[0]!.toUpperCase()),
    );
    liens.set(m.id, lien);
    return h('li', {}, lien);
  });

  const barre = h(
    'aside',
    { class: 'barre-laterale', id: 'barre-laterale' },
    h(
      'div',
      { class: 'marque' },
      h('span', { class: 'marque-nom' }, 'Pôle 003'),
      h('span', { class: 'marque-sous-titre' }, 'Innovation · Sandbox'),
    ),
    h('nav', { 'aria-label': 'Modules' }, h('ul', { class: 'nav-liste' }, ...elementsNav)),
  );

  // --- En-tête ---
  const boutonMenu = h(
    'button',
    { type: 'button', class: 'bouton-icone bouton-menu', 'aria-controls': 'barre-laterale', 'aria-expanded': 'false' },
    icone(Menu, 20),
    h('span', { class: 'visuellement-masque' }, 'Afficher le menu des modules'),
  );
  const titre = h('span', { class: 'entete-titre' });
  const boutonTheme = h('button', { type: 'button', class: 'bouton-icone' });
  const entete = h(
    'header',
    { class: 'entete' },
    boutonMenu,
    titre,
    canal === 'beta' &&
      h('span', { class: 'badge badge-beta', title: 'Version de validation : les données sont séparées de la version officielle.' }, 'Bêta'),
    h('span', { class: 'entete-espace' }),
    boutonTheme,
  );

  // --- Barre d'état : ce qui doit rester visible en permanence (confidentialité, version, navigation clavier) ---
  const barreEtat = h(
    'footer',
    { class: 'barre-etat' },
    h(
      'span',
      { class: 'badge-local', title: 'Les fichiers sont traités dans votre navigateur et ne quittent jamais votre poste.' },
      icone(ShieldCheck, 14),
      h('span', {}, '100 % local'),
      h('span', { class: 'badge-local-detail' }, ' · aucune donnée envoyée'),
    ),
    h('span', { class: 'barre-etat-espace' }),
    h('span', { class: 'barre-etat-aide' }, h('kbd', {}, 'g'), ' puis une lettre : changer de module'),
    h('span', { class: 'version', title: 'Version de la Sandbox' }, `v${version}`),
  );

  const principal = h('main', { id: 'contenu', class: 'contenu', tabindex: '-1' });
  const lienEvitement = h('a', { class: 'lien-evitement', href: '#contenu' }, 'Aller au contenu');
  const voile = h('div', { class: 'voile', hidden: true });

  racine.replaceChildren(
    lienEvitement,
    h('div', { class: 'coque' }, barre, voile, h('div', { class: 'colonne-principale' }, entete, principal, barreEtat)),
  );

  // --- Thème ---
  let choixTheme: ChoixTheme = lireChoixTheme();
  const afficherTheme = () => {
    appliquerTheme(choixTheme);
    boutonTheme.replaceChildren(
      icone(ICONES_THEME[choixTheme], 20),
      h('span', { class: 'visuellement-masque' }, `Thème : ${LIBELLES_THEME[choixTheme]}. Changer de thème`),
    );
    boutonTheme.title = `Thème : ${LIBELLES_THEME[choixTheme]}`;
  };
  boutonTheme.addEventListener('click', () => {
    choixTheme = themeSuivant(choixTheme);
    memoriserTheme(choixTheme);
    afficherTheme();
  });
  afficherTheme();

  // --- Menu mobile ---
  const basculerMenu = (ouvert: boolean) => {
    barre.classList.toggle('ouverte', ouvert);
    voile.hidden = !ouvert;
    boutonMenu.setAttribute('aria-expanded', String(ouvert));
  };
  boutonMenu.addEventListener('click', () => basculerMenu(!barre.classList.contains('ouverte')));
  voile.addEventListener('click', () => basculerMenu(false));
  const surTouche = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && barre.classList.contains('ouverte')) {
      basculerMenu(false);
      boutonMenu.focus();
    }
  };
  document.addEventListener('keydown', surTouche);

  // Navigation au clavier : « g » puis la lettre du module (comme dans les outils de développement).
  let attenteLettre = 0;
  const surRaccourci = (e: KeyboardEvent) => {
    const cible = e.target as HTMLElement | null;
    if (e.ctrlKey || e.metaKey || e.altKey || cible?.closest?.('input, textarea, select, [contenteditable], dialog[open]')) return;
    if (e.key === 'g') {
      attenteLettre = Date.now() + 1500;
      return;
    }
    if (Date.now() > attenteLettre) return;
    attenteLettre = 0;
    const id = idsActifs.find((i) => i[0] === e.key.toLowerCase());
    if (id) location.hash = lienVers(id);
  };
  document.addEventListener('keydown', surRaccourci);

  // Le lien d'évitement ne doit pas modifier l'ancre (elle porte la route).
  lienEvitement.addEventListener('click', (e) => {
    e.preventDefault();
    principal.focus();
  });

  // --- Routage ---
  let nettoyer: void | (() => void);
  const afficher = (deplacerFocus: boolean) => {
    const id = resoudreRoute(location.hash, idsActifs, defaut);
    const module = actifs.find((m) => m.id === id);
    if (!module) return;
    if (typeof nettoyer === 'function') nettoyer();
    for (const [idLien, lien] of liens) {
      if (idLien === id) lien.setAttribute('aria-current', 'page');
      else lien.removeAttribute('aria-current');
    }
    titre.textContent = module.libelle;
    document.title = `${module.libelle} · Sandbox Pôle 003`;
    principal.replaceChildren();
    nettoyer = module.rendre(principal);
    basculerMenu(false);
    if (deplacerFocus) (principal.querySelector<HTMLElement>('h1') ?? principal).focus();
  };
  const surAncre = () => afficher(true);
  window.addEventListener('hashchange', surAncre);
  afficher(false);

  return () => {
    window.removeEventListener('hashchange', surAncre);
    document.removeEventListener('keydown', surTouche);
    document.removeEventListener('keydown', surRaccourci);
    if (typeof nettoyer === 'function') nettoyer();
  };
}
