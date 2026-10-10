# Accueil — poste de pilotage

> Surcharge `MASTER.md` pour l'accueil (`src/modules/accueil/`, `src/styles/accueil.css`).

## Principe

L'accueil répond à trois questions en un coup d'œil : *qu'est-ce qui a changé ?* (veille), *qu'est-ce qui arrive ?* (échéances), *où en sont les chiffres ?* (indicateurs), plus *ce que ce poste conserve* (dossiers locaux). Rien n'est affiché sans donnée réelle derrière.

## Mise en page

- Entête : `h1` « Accueil » + ligne d'état mono (date du jour à Paris · date de la collecte de veille · nombre de dossiers dans ce navigateur).
- Grille asymétrique **3 / 2** (`.accueil-grille`) : colonne principale = Veille puis Échéances ; colonne latérale = Indicateurs puis Dossiers locaux. Sous 70 rem : une colonne.
- Chaque panneau = un tableau pleine largeur, titre `h2` + lien vers l'écran complet. Pas de carte dans une carte.

## Panneaux

| Panneau | Source | Contenu |
|---|---|---|
| Veille · à lire | `news.json` | 5 articles d'importance 4 ou 5 : importance `4/5` (mono), titre (lien externe), source, date |
| Échéances | `news.json` | prochaines étapes PLF / PLFSS (date, étape actuelle) puis échéances des entreprises sur 15 jours avec compte à rebours `J−n` |
| Indicateurs | `marches.json` | valeur + unité, variation signée neutre, tendance (mini-courbe), date et organisme source ; badge de fraîcheur **seulement** en retard ou en panne |
| Dossiers locaux | IndexedDB du navigateur | dossier, SIREN, clôture et nombre de lignes du FEC, date de modification |

## États

Chargement (`role="status"`), erreur de chargement (message explicite de `MESSAGES_CHARGEMENT`), absence de données (« Aucun dossier… » avec lien d'import), stockage local bloqué.

## Décisions

- **Pas de bloc « accès aux outils » dupliqué** : la barre latérale les porte déjà, avec raccourcis `g` + lettre. Les répéter en cartes ajouterait du bruit.
- **Pas de salutation ni de bandeau de confidentialité** : la mention « 100 % local » est permanente dans la barre d'état.
- **Pas de couleur sur les variations** : une hausse n'est pas « bonne » ou « mauvaise » en soi.
- **Activité récente** : limitée à ce qui existe (dossiers et FEC importés). Pas d'historique d'analyses : il n'est pas enregistré.
