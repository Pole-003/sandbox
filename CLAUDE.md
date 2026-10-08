# Sandbox Pôle 003 — Innovation

Boîte à outils web interne d'un cabinet d'expertise comptable et de commissariat aux comptes, utilisée par l'équipe « Le pôle 003 - Innovation » (~6 personnes).

Modules : accueil, veille (actualités comptables, fiscales, économiques), analyse de FEC et contrôle de conformité, sélection et suivi des circularisations. Plus tard : génération des courriers de circularisation, analyse de fichier de stock, cadrage de TVA (CA3 + FEC).

La spécification fonctionnelle détaillée est dans `docs/SPEC.md`. Le plan de construction étape par étape est dans `docs/ETAPES.md`. Lis la section de `docs/SPEC.md` correspondant à l'étape en cours avant de coder.

## Règles non négociables (confidentialité)

Les fichiers traités (FEC, stocks, déclarations) sont des données clients confidentielles soumises au secret professionnel et au RGPD. L'application doit garantir qu'ils ne quittent jamais le poste de l'utilisateur.

1. **Aucun envoi réseau de données utilisateur.** Les seuls appels réseau autorisés dans le code applicatif sont les chargements des fichiers statiques de veille `news.json` et `veille-etat.json` (même origine, méthode GET, sans paramètre de requête). Les scripts de collecte de `scripts/veille/` tournent dans GitHub Actions, jamais dans le navigateur, et ne manipulent que de l'information publique ; leurs clés d'API sont lues depuis les secrets GitHub et ne doivent jamais apparaître dans le code, les journaux ou les fichiers publiés. Aucun `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `EventSource`, formulaire, image ou iframe ne doit pointer vers une autre origine ou transporter des données.
2. **Aucune ressource externe au chargement.** Pas de CDN, pas de Google Fonts, pas d'analytics, pas de télémétrie. Toutes les librairies sont installées via npm et intégrées au build. Les polices sont auto-hébergées.
3. **Content-Security-Policy stricte** injectée dans le `index.html` de production via `<meta http-equiv="Content-Security-Policy">` (GitHub Pages ne permet pas d'en-têtes personnalisés) :
   `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; form-action 'none'; base-uri 'none'; object-src 'none'`
   Toute modification de cette ligne doit être signalée explicitement à l'utilisateur dans le résumé de fin de tâche.
4. **Aucune donnée réelle dans le dépôt.** Le dépôt est public. Tests et démos utilisent exclusivement des FEC fictifs générés par `scripts/generer-fec-fictifs.ts`. Ne demande jamais à l'utilisateur de te fournir un vrai FEC et ne lis aucun fichier hors du dépôt. Le `.gitignore` exclut `*.txt` et `*.xml` à la racine et dans `data-reelles/`.
5. **Stockage local uniquement.** Persistance dans IndexedDB du navigateur (dossiers, paramètres, sélections), avec un bouton « Purger ce dossier » et « Tout purger ». `localStorage` uniquement pour des préférences d'interface (prénom, thème, animation déjà vue). Le site est publié par l'organisation GitHub `pole-003` à l'adresse `https://pole-003.github.io/sandbox` : configure Vite avec `base: '/sandbox/'` et préfixe toutes les bases IndexedDB et clés `localStorage` par `pole003-sandbox-`.
6. **Traçabilité audit.** Toute sélection d'échantillon doit être reproductible : générateur pseudo-aléatoire à graine (mulberry32 ou équivalent documenté), graine affichée et exportée avec les paramètres.

Avant chaque fin de tâche, vérifie avec `npm run check:securite` qu'aucune URL externe ni API réseau interdite n'apparaît dans `src/`.

## Stack technique

- Vite + TypeScript strict, sans framework lourd (Preact autorisé si l'interface le justifie, à valider avec l'utilisateur).
- Traitement des gros fichiers dans un Web Worker (FEC jusqu'à 3 millions de lignes, lecture en flux par morceaux).
- Lecture des encodages via `TextDecoder` (utf-8, iso-8859-15, windows-1252).
- XML via `DOMParser` natif.
- Export Excel : ExcelJS (mise en forme et formules nécessaires dans les feuilles de travail).
- Tests : Vitest. Toute règle de conformité FEC et tout critère de sélection a ses tests unitaires.
- Déploiement : GitHub Actions → GitHub Pages, à chaque push sur `main`. Une branche `beta` déployée séparément pour validation.

## Commandes

- `npm run dev` : serveur de développement local
- `npm run build` : build de production (avec CSP)
- `npm test` : tests unitaires
- `npm run check:securite` : recherche d'URL externes et d'API réseau interdites dans `src/`
- `npm run fec:fictifs` : régénère le jeu de FEC fictifs dans `tests/fixtures/`

## Conventions

- Interface et messages en français, vocabulaire de la profession (FEC, balance, auxiliaire, à-nouveaux, seuil de signification, circularisation, procédure alternative).
- Montants manipulés en centimes entiers (pas de flottants) pour éviter les erreurs d'arrondi ; affichage au format français (`1 234,56`).
- Dates internes en ISO `AAAA-MM-JJ`, affichées en `JJ/MM/AAAA`.
- Un module = un dossier dans `src/modules/<nom>/` (logique pure séparée de l'interface pour être testable).
- Numéro de version affiché dans l'interface (semver dans `package.json`) et encart « Nouveautés » alimenté par `CHANGELOG.md`.
- Toute migration de structure de données IndexedDB est versionnée et convertit l'ancien format.
- Accessibilité : contrastes suffisants, navigation clavier, `prefers-reduced-motion` respecté.

## Manière de travailler

- Une étape de `docs/ETAPES.md` par session. Commence en mode plan, propose le découpage, attends la validation.
- Pose des questions quand une règle métier est ambiguë plutôt que de supposer.
- Termine chaque étape par : tests verts, `check:securite` OK, build OK, résumé de ce qui a changé et de ce que l'utilisateur doit vérifier à la main.
