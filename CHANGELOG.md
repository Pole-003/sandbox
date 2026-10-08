# Nouveautés

Toutes les évolutions notables de la Sandbox Pôle 003. Format inspiré de « Keep a Changelog », numéros de version au format semver.

## [0.2.0] - 2026-10-08

### Ajouté
- Animation d'ouverture : une petite fusée traverse l'écran au lancement du site, par-dessus l'interface qui reste utilisable. Jouée une fois par jour, absente si le système demande de réduire les animations.

## [0.1.0] - 2026-10-08

### Ajouté
- Socle de l'application : coque d'interface avec barre latérale (Accueil, Veille, FEC, Circularisations ; Stocks et TVA à venir).
- Badge « 100 % local · aucune donnée envoyée » et numéro de version dans l'en-tête.
- Thèmes clair et sombre (automatique selon le système, ou forcé).
- Sécurité : Content-Security-Policy stricte en production, contrôle `check:securite` des URL externes et API réseau.
- Déploiement automatique : `main` sur l’adresse officielle, `beta` dans le sous-dossier `/beta` pour validation.
