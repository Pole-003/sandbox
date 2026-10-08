# Nouveautés

Toutes les évolutions notables de la Sandbox Pôle 003. Format inspiré de « Keep a Changelog », numéros de version au format semver.

## [0.5.0] - 2026-10-08

### Ajouté
- Onglet « Suivi PLF / PLFSS » : principales mesures du projet de loi de finances et du projet de loi de financement de la sécurité sociale, reprises du texte officiel déposé (numéro et intitulé de chaque article), sélectionnées par les mots-clés de la veille (impôt sur les sociétés, TVA, cotisations…).
- Liste complète des articles, groupés par partie, avec lien vers le texte officiel. Relue chaque jour, toujours à 0 €.

## [0.4.0] - 2026-10-08

### Ajouté
- Suivi automatique de la loi de finances (PLF) et du financement de la sécurité sociale (PLFSS), relu chaque jour sur les dossiers législatifs officiels de l'Assemblée nationale : frise des étapes avec leurs dates, étapes restantes, délais constitutionnels calculés depuis le dépôt (indicatifs), lien vers le dossier.
- Alerte dans le fil d'actualité à chaque nouvelle étape du PLF ou du PLFSS.
- Onglet « Suivi PLF / PLFSS » : dernières actualités de chaque texte sous la frise.
- Le texte suivi change d'année tout seul (PLF 2027, puis 2028…).

## [0.3.0] - 2026-10-08

### Ajouté
- Veille, gratuite (0 €) : collecte automatique chaque jour ouvré à 6 h 30 (et à la demande) par GitHub Actions, sans aucun service d'IA. Le navigateur ne contacte jamais les sites sources : il ne charge que les fichiers publiés avec le site.
- Flux officiels vérifiés : BOFiP, Sénat (textes, rapports, thèmes budget, fiscalité, entreprises, PME, sécurité sociale), Assemblée nationale (publications filtrées par mots-clés, commissions des finances, des affaires sociales et économiques), Conseil d'État, et suivi du dossier législatif du PLF 2027.
- API officielles gratuites (PISTE, INSEE, Banque de France, BODACC) prévues et facultatives : sans identifiants, elles sont signalées « non configurées » sans bloquer la collecte.
- Classement par mots-clés modifiable (`veille/mots-cles.json`) : thème, importance de 1 à 5, public concerné, mots d'exclusion. Les informations marginales sont masquées par défaut.
- Extraits repris tels quels des flux officiels, nettoyés et limités à 300 caractères.
- Écran Veille : fil filtrable par thème, source, importance et public, recherche locale, marques « lu » et « important pour nos dossiers » conservées dans le navigateur ; suivi PLF / PLFSS (saisi à la main) ; indicateurs ; Rennes et Bretagne ; état des sources.
- Accueil : brief du jour (5 informations d'importance 4 ou 5) et prochaines échéances PLF et PLFSS.

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
