# Design System — Sandbox Pôle 003 · Innovation

> **Règle de lecture :** pour une page précise, lire d'abord `pages/<page>.md`. S'il existe, il prévaut sur ce fichier.
> Les valeurs ci-dessous sont celles **réellement appliquées** dans `src/styles/` (jetons : `jetons.css`).
> Les contrastes AA sont vérifiés par `tests/app/contrastes.test.ts` : toute nouvelle paire texte/fond doit y figurer.

**Généré avec UI UX Pro Max 2.13.0** (`--design-system --persist`, dials : variance 4, motion 2, densité 8), puis **adapté** aux règles du projet (voir « Écarts par rapport à la sortie générée »).

---

## 1. Direction artistique : « poste de travail »

Un outil d'analyste ouvert toute la journée, pas un site vitrine. Précision d'un outil de développement, lisibilité d'un logiciel de gestion, densité maîtrisée.

- **Papier, encre, un accent.** Fond papier chaud, texte encre, un seul accent **pétrole** pour les actions et les liens. Un **signal ambre** minuscule (carrés de section, repère de navigation active) donne la signature ; il ne sert jamais pour du texte.
- **Barre latérale sombre** dans les deux thèmes : ancre visuelle stable, les données restent sur fond clair.
- **Typographie technique.** IBM Plex Sans (lecture) + IBM Plex Mono (étiquettes, chiffres, métadonnées).
- **Filets, pas de relief.** Bordures 1 px, rayons 3–4 px, aucune ombre (sauf infobulle), aucun dégradé.
- **Détails « geek » utiles :** fil d'Ariane `sandbox / module`, barre d'état permanente (confidentialité, version, aide), raccourcis `g` puis lettre (`g f` = FEC), compte à rebours d'échéances `J−3`, chiffres en mono alignés.

## 2. Jetons

### Couleurs (clair / sombre)

| Jeton | Clair | Sombre | Usage |
|---|---|---|---|
| `--c-fond` | `#f1f0ec` | `#0e1217` | fond de page |
| `--c-surface` | `#fafaf8` | `#141a21` | panneaux, tableaux, en-tête |
| `--c-surface-2` | `#e8e6e0` | `#1b222b` | survol de ligne, sous-onglets, `kbd` |
| `--c-bordure` | `#d3d0c7` | `#2a323d` | filets |
| `--c-texte` / `--c-texte-2` | `#15181d` / `#555a63` | `#dfe3e8` / `#98a1ad` | texte / texte secondaire |
| `--c-primaire` | `#0b5a60` | `#5fc4ca` | actions, liens, focus |
| `--c-succes` `--c-alerte` `--c-danger` | `#28692b` `#8a5200` `#b0241b` | `#66c273` `#f0b44c` `#f38b82` | **états uniquement** (conforme, attention, erreur) |
| `--c-signal` | `#d99a1e` | `#e8ad3a` | repères d'identité, jamais du texte |
| `--c-barre*` | `#11171e` … | `#0a0e13` … | barre latérale (sombre dans les deux thèmes) |
| `--c-serie-1/2` | `#2a64b0` / `#c0620f` | `#5b8fd9` / `#c47a32` | séries de graphiques (palette validée daltonisme) |

Règle : une couleur d'état s'accompagne toujours d'un libellé ou d'une icône (jamais la couleur seule).

### Typographie

| Rôle | Police | Détails |
|---|---|---|
| Texte | IBM Plex Sans 400 / 500 / 600 | 14 px (`--taille-base`), interligne 1,45 |
| Étiquettes, en-têtes de tableaux, chiffres | IBM Plex Mono 400 / 500 | 11–12,5 px, capitales + espacement 0,04–0,06 em pour les titres |
| Titre de page (`h1`) | Plex Sans 600 | 1,25 rem |
| Titre de section (`h2`) | Plex Mono 500, capitales | 0,75 rem, précédé du carré signal |

Polices **auto-hébergées** par npm (`@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`, sous-ensemble latin) : aucun CDN, conforme à la règle n° 2 et à la CSP `font-src 'self'`. Chiffres tabulaires partout (`font-variant-numeric: tabular-nums`).

### Espacement, forme, mouvement (densité 8/10)

- Rayons : `--rayon` 3 px, `--rayon-carte` 4 px. Hauteur de contrôle : 2 rem. Ligne de tableau ≈ 30 px.
- Échelle : 0,25 · 0,5 · 0,75 · 1 · 1,25 rem. Gouttière de grille : 0,75 rem.
- En-tête 2,75 rem, barre d'état 1,75 rem, barre latérale 13,5 rem. Contenu jusqu'à 96 rem (écran secondaire).
- Mouvement : `--duree` 120 ms, uniquement sur survol et focus. `prefers-reduced-motion` respecté globalement. Aucune animation d'entrée ou de défilement.

## 3. Composants (fichier : `src/styles/composants.css`)

| Composant | Règle |
|---|---|
| Panneau `.carte` | surface plate, filet 1 px, **jamais imbriqué** dans un autre panneau |
| Bouton `.bouton` | 2 rem, filet ; `.bouton-primaire` plein pétrole ; `.bouton-danger` filet rouge. Un seul bouton primaire par zone |
| Champ `.champ` | libellé 12 px au-dessus, saisie 2 rem, focus = bordure pétrole + anneau 2 px |
| Tableau `.tableau` | en-tête mono capitales soulignée d'un filet plein, filets de ligne discrets, survol de ligne, nombres (`.nombre`, `.montant`) en mono alignés à droite |
| Onglets `.onglets` | soulignement 2 px sous l'onglet actif ; sous-onglets `.sous-onglets` = commutateur segmenté |
| Badge `.badge` | étiquette carrée à filet ; réservé à un **état** (conformité, fraîcheur, bêta) |
| Bandeau `.bandeau` | filet gauche 3 px + teinte ; `.bandeau-alerte` pour les erreurs |
| `kbd` | raccourci clavier, mono 11 px |

## 4. Mise en page

- Coque : barre latérale sombre + en-tête fin (fil d'Ariane) + contenu + barre d'état (`coque.css`).
- Pages de travail : panneaux de tailles adaptées au contenu, colonnes asymétriques (3 / 2) plutôt que grille de cartes identiques ; tableaux à pleine largeur du panneau.
- Sous 70 rem : une colonne. Sous 48 rem : barre latérale escamotable. Pas de défilement horizontal de page (les tableaux larges défilent dans `.tableau-defilant`).

## 5. Données et graphiques

- Toute valeur affiche **unité, date et source** (accueil : colonne « Date · source »).
- Courbes pour les séries temporelles, barres pour les encours trimestriels, mini-courbes (`sparkline`) pour la tendance. Pas de graphique décoratif, axes non tronqués pour les barres.
- Les variations sont signées (+ / −) et neutres : une hausse n'est ni verte ni rouge (une dette qui monte n'est pas « bonne »).

## 6. Accessibilité

Contraste AA (testé), focus visible 2 px sur tous les contrôles, lien d'évitement, un `h1` par page, tableaux avec `caption` masquée et `scope`, compte à rebours doublé d'un texte pour lecteur d'écran, `aria-keyshortcuts` sur la navigation, cibles ≥ 24 px, thème clair / sombre / automatique.

## 7. Écarts par rapport à la sortie générée

Éléments **volontairement écartés** car contraires au brief ou aux règles du dépôt :

- Import **Google Fonts** et Fira Code / Fira Sans : interdit (aucune ressource externe) → IBM Plex auto-hébergée.
- Pattern « Enterprise Gateway » (hero, CTA « Contact Sales », logos clients) : conçu pour une vitrine, pas pour un outil.
- Rayons 8–16 px, ombres `shadow-md/lg/xl`, survol qui soulève (`translateY`), flou d'arrière-plan des modales : relief décoratif.
- Révélation au défilement (GSAP ScrollTrigger) : animation sans fonction ; aucune dépendance d'animation ajoutée.
- Bouton primaire ambre sur texte noir : l'ambre est réservé au signal ; l'action est pétrole.
- Recherche « chart » : a renvoyé des chandeliers boursiers, hors sujet (aucune donnée OHLC) ; non retenue.

## 8. Avant de livrer une page

- [ ] Jetons uniquement (aucune couleur ou rayon en dur)
- [ ] Aucun panneau dans un panneau, aucun badge sans fonction, aucune icône décorative
- [ ] Nombres en mono alignés à droite, unité et période visibles
- [ ] Focus clavier visible, ordre de tabulation logique
- [ ] Clair et sombre vérifiés ; 375 px sans défilement horizontal de page
- [ ] `npm test`, `npm run check:securite`, `npm run build` verts (CSP inchangée)
