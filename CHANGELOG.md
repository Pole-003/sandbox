# Nouveautés

Toutes les évolutions notables de la Sandbox Pôle 003. Format inspiré de « Keep a Changelog », numéros de version au format semver.

## [0.7.0] - 2026-10-08

### Ajouté
- Module FEC, import et contrôle de conformité : déposez un FEC de n'importe quel logiciel (fichier texte ou XML, BIC/IS, BNC, BA, Montant/Sens, tous encodages et séparateurs courants). Il est lu dans votre navigateur, en arrière-plan, avec une barre de progression et un bouton d'annulation ; rien n'est envoyé.
- Assistant de correspondance des colonnes quand le fichier n'a pas d'en-tête ou utilise des noms inhabituels ; la correspondance peut être mémorisée comme profil d'import pour les FEC suivants du même logiciel.
- Carte de résumé (format, encodage, variante, lignes, écritures, période, SIREN, empreinte SHA-256), exercice et journal d'à-nouveaux modifiables et à confirmer.
- Contrôle de conformité indicatif (56 contrôles inspirés de l'article A47 A-1 du LPF, de Test Compta Demat, du BOFiP et de contrôles d'audit) classés « Non conforme », « Anomalie », « Information », avec les lignes concernées et un export Excel. Les non-conformités n'empêchent jamais l'analyse.
- Dossiers enregistrés sur ce poste (FEC de l'exercice et de l'exercice précédent), avec « Purger ce dossier » et « Tout purger ».

## [0.6.0] - 2026-10-08

### Ajouté
- Principales mesures du PLF 2027 et du PLFSS 2027 hiérarchisées pour le cabinet : « Essentiel pour nos dossiers », « Important », « À suivre », avec une rubrique par mesure (fiscalité des entreprises, transmission et patrimoine, impôt sur le revenu, contrôle fiscal, social et paie, retraite…).
- La hiérarchie se modifie sans toucher au code (`veille/hierarchie-mesures.json`). Si un article change de numéro ou d'intitulé, il est reclassé automatiquement et l'écart est signalé dans « État des sources ».

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
