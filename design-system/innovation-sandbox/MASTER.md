# Design System — Sandbox Pôle 003 · Innovation

> **Règle de lecture :** pour une page précise, lire d'abord `pages/<page>.md`. S'il existe, il prévaut sur ce fichier.
> Les valeurs ci-dessous sont celles **réellement appliquées** dans `src/styles/` (jetons : `jetons.css`, composants : `composants.css`).
> Les contrastes sont vérifiés par `tests/app/contrastes.test.ts` : toute nouvelle paire texte/fond doit y figurer.

**Source :** charte « Ivory terminal with violet pulse » (fichier `DESIGN.md` fourni le 10/10/2026), appliquée à la v0.17.0. Elle remplace la direction « poste de travail » de la v0.16.0.

---

## 1. Principe

Un espace de travail blanc et clinique où **une seule couleur, le violet, marque chaque action délibérée**. 98 % monochrome, plat : ni dégradé, ni ombre décorative, ni animation. La profondeur vient de la **teinte des surfaces** (porcelaine → nuage), pas du relief. Géométrie généreuse : boutons en pilules, cartes très arrondies.

## 2. Jetons

### Couleurs

| Jeton | Clair | Sombre | Nom charte | Usage |
|---|---|---|---|---|
| `--c-fond` | `#ffffff` | `#000000` | Porcelain / Obsidian | fond de page, champs, panneaux dans une carte |
| `--c-surface` | `#f6f6f6` | `#1f1f1f` | Cloud / Inkstone | cartes, bandeaux, onglets inactifs |
| `--c-surface-2` | `#e7e7e7` | `#333333` | Mist / Graphite | survol |
| `--c-bordure` | `#e7e7e7` | `#333333` | Mist | séparateurs discrets, lignes de tableau |
| `--c-filet` | `#b0b0b0` | `#5d5d5d` | Ash | filet sous la navigation et les en-têtes de tableau, boutons neutres |
| `--c-champ` | `#888888` | `#888888` | Smoke | bordure de champ (≥ 3:1, WCAG 1.4.11) |
| `--c-texte` / `--c-texte-2` | `#1f1f1f` / `#5d5d5d` | `#f6f6f6` / `#b0b0b0` | Inkstone / Slate | texte / texte secondaire |
| `--c-primaire` | `#594ff4` | `#8b84ff` | Signal Violet | actions, liens, onglet actif, logo, focus |
| `--c-primaire-fond` | `#f0efff` | `#25224a` | — | état sélectionné ou survolé léger (bouton secondaire, sélection de texte) |
| `--c-pied` | `#000000` | `#000000` | Obsidian | pied de page |
| `--c-serie-1` / `--c-serie-2` | `#594ff4` / `#1f1f1f` | `#8b84ff` / `#e7e7e7` | violet / encre | séries des graphiques |
| `--c-succes` `--c-alerte` `--c-danger` | inchangés | inchangés | — | **états uniquement** (voir § 7) |

Règle : une couleur d'état s'accompagne toujours d'un libellé (jamais la couleur seule).

### Typographie

| Rôle | Taille | Graisse | Interligne | Interlettrage |
|---|---|---|---|---|
| Texte courant, interface | 15 px (`--taille-base`) | 500 | 1,5 | — |
| Légende, tableaux, métadonnées | 14 px (minimum) | 500 | 1,5 | — |
| Surtitre (`.surtitre`, en-têtes de tableau) | 13–14 px, capitales | 500 | — | 0,075 em |
| `h3` | 17 px | 700 | 1,4 | — |
| `h2` (titre de carte) | 20 px | 700 | 1,33 | 0,075 em |
| `h1` (titre de page) | 26 px | 700 | 1,2 | 0,075 em |

Police : **Inter Variable**, auto-hébergée (`@fontsource-variable/inter`), variantes `ss01` et `cv11` actives. Une seule famille, deux graisses (500, 700). Chiffres tabulaires partout.

### Formes, espacements, mouvement

- Rayons : pilule `--rayon-pilule` 99 px (boutons, onglets, étiquettes), champ `--rayon-champ` 16 px (champs, bandeaux, groupes de champs), carte `--rayon-carte` 36 px, petit élément `--rayon` 10 px.
- Base 4 px. Écart entre éléments `--ecart` 24 px, marge intérieure de carte `--marge-carte` 32 px (20 px sous 48 rem), bas de page `--ecart-section` 64 px.
- Largeur de page 1 200 px (`--largeur-page`), navigation 64 px de haut.
- Ombre unique `--ombre` (`rgba(0,0,0,.12) 0 0 60px -13px`) : réservée aux éléments **flottants** (fenêtre d'écriture, infobulle). Jamais sur un bouton, une carte ou un champ.
- Mouvement : `--duree` 120 ms, uniquement sur survol et focus. `prefers-reduced-motion` respecté.

## 3. Composants (fichier : `src/styles/composants.css`, `base.css`)

| Composant | Règle |
|---|---|
| Carte `.carte` | fond nuage, rayon 36 px, marge 32 px, **sans bordure ni ombre** ; deux cartes successives espacées de 24 px |
| Bouton `.bouton` | pilule, contour et texte violets, fond porcelaine (bouton « fantôme » de la charte) |
| Bouton `.bouton-primaire` | pilule violette pleine, texte blanc — **un seul par zone** |
| Bouton `.bouton-danger` | pilule à contour rouge (purge, suppression) |
| Champ `.champ` | libellé 14 px ardoise au-dessus, saisie 44 px, rayon 16 px, fond porcelaine, bordure fumée |
| Groupe `fieldset` | panneau porcelaine rayon 16 px, légende en gras au-dessus (pas de cadre gravé) |
| Tableau `.tableau` | en-tête en surtitre (capitales espacées) sur filet cendre ; lignes séparées d'un filet discret ; nombres alignés à droite ; liens de tableau soulignés au survol seulement |
| Onglets `.onglets` | pilules ; l'onglet actif est violet plein (état « sélectionné » de la charte) |
| Sous-onglets `.sous-onglets` | commutateur pilule sur fond nuage, élément actif en porcelaine |
| Étiquette `.badge` | pilule 14 px, fond nuage (porcelaine dans une carte) ; variantes d'état colorent le texte |
| Bandeau `.bandeau` | panneau nuage rayon 16 px ; `.bandeau-alerte` en teinte d'erreur |
| `kbd` | pilule à filet, 13 px |

## 4. Mise en page

- **Navigation** (`coque.css`) : barre blanche collante de 64 px, filet cendre en bas. Logo (forme géométrique violette + « Pôle 003 Sandbox ») à gauche, modules au centre (texte 16 px, module courant en violet gras), réglages à droite (badge bêta, thème). Sous 64 rem : menu déroulant.
- **Contenu** : 1 200 px centrés, 48 px au-dessus du titre de page.
- **Pied de page** : bande noire pleine largeur (logo, « 100 % local », aide clavier, version).
- Pages de travail : cartes empilées ; deux colonnes sur l'accueil ; tableaux larges défilant dans `.tableau-defilant` (jamais de défilement horizontal de la page).

## 5. Données et graphiques

- Toute valeur affiche **unité, date et source**.
- Graphiques monochromes : série principale violette, série de comparaison encre. Pas de graphique décoratif, axes non tronqués pour les barres.
- Variations signées (+ / −) et neutres : une hausse n'est ni verte ni rouge.

## 6. Accessibilité

Contraste AA vérifié par les tests (texte ≥ 4,5:1 ; bordures de champ et séries ≥ 3:1), focus visible violet 2 px, lien d'évitement, un `h1` par page, tableaux avec `caption` masquée et `scope`, `aria-keyshortcuts` sur la navigation (`g` + lettre), cibles ≥ 40 px, thème clair / sombre / automatique.

## 7. Écarts assumés par rapport à la charte

| Charte | Appliqué | Raison |
|---|---|---|
| Police Aeonik (et Rubik en appoint) | Inter (substitut cité par la charte) | Aeonik est commerciale et absente de npm ; règle n° 2 : polices auto-hébergées uniquement. Rubik non utilisée (usage marginal). |
| Thème clair seul | Thème sombre dérivé (Obsidian / Inkstone / Graphite, violet éclairci `#8b84ff`) | Le choix du thème est une fonctionnalité existante. Le violet de la charte n'atteint que 2,7:1 sur fond sombre. |
| Smoke `#888888` pour le texte d'aide | Slate `#5d5d5d` pour tout texte secondaire ; Smoke réservé aux bordures de champ | Smoke sur blanc = 3,5:1, sous le seuil AA pour du texte. |
| Aucune autre couleur chromatique | Vert, ambre, rouge conservés **pour les états** (conforme, anomalie, non conforme, purge) | Un outil de contrôle FEC / TVA doit signaler une erreur sans ambiguïté. Toujours doublés d'un libellé. |
| Teinte violette interdite en fond | `--c-primaire-fond` très clair pour les états sélectionnés / survolés | Usage fonctionnel (état actif), jamais décoratif. |
| Grands titres 56–72 px, hero, maquettes superposées, grilles de 3 cartes, FAQ | Non repris | Composants de site vitrine ; la Sandbox est un outil de travail. L'échelle s'arrête à 26 px. |
| Section 64–96 px entre blocs | 24 px entre cartes, 64 px en bas de page | Les écrans de travail (FEC, TVA) enchaînent de nombreuses cartes. |
| Animation interdite | Animation d'ouverture (fusée) conservée | Fonctionnalité existante, une fois par jour, désactivée par `prefers-reduced-motion`. |

## 8. Avant de livrer une page

- [ ] Jetons uniquement (aucune couleur ni rayon en dur)
- [ ] Violet réservé aux actions, liens, états actifs et logo
- [ ] Graisses 500 et 700 uniquement ; aucun texte sous 14 px (hors données brutes du FEC)
- [ ] Aucune carte dans une carte (dans une carte, utiliser un `fieldset` ou un panneau porcelaine)
- [ ] Focus clavier visible, ordre de tabulation logique
- [ ] Clair et sombre vérifiés ; 375 px sans défilement horizontal de page
- [ ] `npm test`, `npm run check:securite`, `npm run build` verts (CSP inchangée)
