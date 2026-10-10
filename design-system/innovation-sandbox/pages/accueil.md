# Accueil — poste de pilotage

> Surcharge `MASTER.md` pour l'accueil (`src/modules/accueil/`, `src/styles/accueil.css`).

## Principe

L'accueil répond à trois questions en un coup d'œil : *qu'est-ce qui a changé ?* (veille), *qu'est-ce qui arrive ?* (échéances), *où en sont les chiffres ?* (indicateurs), plus *ce que ce poste conserve* (dossiers locaux). Rien n'est affiché sans donnée réelle derrière.

## Mise en page

- Entête : surtitre « Pôle 003 · Innovation », `h1` « Accueil », puis ligne d'état (date du jour à Paris · date de la collecte de veille · nombre de dossiers dans ce navigateur).
- Grille **deux colonnes égales** (`.accueil-grille`, les cartes de 32 px de marge laissent trop peu de place aux indicateurs en 3 / 2) : colonne principale = Veille puis Échéances ; colonne latérale = Indicateurs puis Dossiers locaux. Sous 70 rem : une colonne.
- Chaque panneau = une carte (nuage, rayon 36 px) : titre `h2` + lien vers l'écran complet, puis un tableau. Pas de carte dans une carte.

## Panneaux

| Panneau | Source | Contenu |
|---|---|---|
| Veille · à lire | `news.json` | 5 articles d'importance 4 ou 5 : importance `4/5`, titre (lien externe violet), source, date |
| Échéances | `news.json` | prochaines étapes PLF / PLFSS (date, étape actuelle) puis échéances des entreprises sur 15 jours avec compte à rebours `J−n` |
| Indicateurs | `marches.json` | nom avec date et organisme source dessous, valeur + unité, variation signée neutre, tendance (mini-courbe violette) ; badge de fraîcheur **seulement** en retard ou en panne |
| Dossiers locaux | IndexedDB du navigateur | dossier, SIREN, clôture et nombre de lignes du FEC, date de modification |

## États

Chargement (`role="status"`), erreur de chargement (message explicite de `MESSAGES_CHARGEMENT`), absence de données (« Aucun dossier… » avec lien d'import), stockage local bloqué.

## Décisions

- **Pas de bloc « accès aux outils » dupliqué** : la navigation du haut les porte déjà, avec raccourcis `g` + lettre. Les répéter en grille de cartes (motif « feature cards » de la charte) ajouterait du bruit.
- **Pas de salutation, de hero ni de bandeau de confidentialité** : la mention « 100 % local » est permanente dans le pied de page.
- **Pas de couleur sur les variations** : une hausse n'est pas « bonne » ou « mauvaise » en soi.
- **Activité récente** : limitée à ce qui existe (dossiers et FEC importés). Pas d'historique d'analyses : il n'est pas enregistré.
