# Nouveautés

Toutes les évolutions notables de la Sandbox Pôle 003. Format inspiré de « Keep a Changelog », numéros de version au format semver.

## [0.14.1] - 2026-10-08

### Modifié
- **Cadrage de TVA :** plus de seuil d'écart. L'écart et l'écart résiduel non justifié sont affichés tels quels, à l'écran et dans la feuille Excel, et mis en évidence dès qu'ils ne sont pas nuls.
- **Cadrage de TVA :** le module ne dépend plus du module Circularisations (il ne reprend plus le SAI). Les paramètres déjà enregistrés sont convertis automatiquement.

## [0.14.0] - 2026-10-08

### Ajouté
- **Module Cadrage de TVA (TVA collectée, prestations de services au régime des encaissements).**
- **Lecture des CA3 :** les PDF des déclarations téléchargés depuis l'espace professionnel se déposent en lot, dans n'importe quel ordre, et sont lus dans votre navigateur, sans envoi.
  - Contrôles de chaque déclaration (totaux 16, 23, TD ou 25, 27, 28, 32, base × taux) et de la série (SIREN, périodes manquantes ou en double, report du crédit, dépôt tardif).
  - Correction d'une valeur avec motif obligatoire, tracée ; saisie manuelle d'une déclaration illisible (PDF scanné).
- **Récapitulatif annuel des montants déclarés (G300)**, limité aux cases servies dans l'année.
- **TVA collectée théorique reconstituée à partir du FEC (G340) :**
  - chiffre d'affaires par compte, avec le taux observé dans les écritures de vente, à défaut deviné d'après le libellé, ou saisi ;
  - régularisations des encaissements : clients N-1 et N, clients douteux, avances, factures à établir, produits constatés d'avance, pertes sur créances irrécouvrables, TVA autoliquidée sur achats ;
  - soldes N-1 pré-remplis et modifiables, ventilation des encours au prorata ou saisie par taux ;
  - rapprochement des bases et des taxes avec la CA3.
- **Écart et justification :** écart annuel comparé au seuil du dossier, tableau de justification, écart résiduel mis en évidence.
- **Cadrage par période et contrôles :** TVA déclarée, TVA comptabilisée et chiffre d'affaires par période ; contrôles de la TVA à décaisser (4455), du crédit de TVA (44567) et de la TVA des encours. Chaque montant ouvre le détail des écritures du FEC.
- **Feuille de travail Excel avec formules vivantes :** G300, G340, cadrage mensuel, anomalies et paramètres, avec les empreintes du FEC et des PDF.

## [0.13.0] - 2026-10-08

### Ajouté
- Module FEC : nouvel onglet « Flux de trésorerie ». C'est un tableau des flux au format anglo-saxon (IAS 7, méthode indirecte), en trois parties : activités opérationnelles (résultat net, capacité d'autofinancement, variation du BFR), activités d'investissement et activités de financement.
- La somme des flux est égale à la variation de trésorerie entre l'ouverture et la clôture de l'exercice. Ce contrôle est affiché, et un écart n'apparaît que si la balance du FEC est déséquilibrée.
- Comparaison avec l'exercice précédent quand son FEC est chargé, avec une alerte si la trésorerie de clôture N-1 ne correspond pas à la trésorerie d'ouverture N.
- Export Excel du tableau des flux : tableau croisé dynamique par section, rubrique et compte (le total général est la variation de trésorerie), puis tableau présenté N / N-1.
- Soldes intermédiaires de gestion : colonne de variation en % en plus de N-1 et de la variation en valeur, à l'écran et dans l'export.

## [0.12.0] - 2026-10-08

### Ajouté
- Exports Excel du module FEC en tableaux croisés dynamiques : chaque export s'ouvre sur un TCD, avec ses données sources dans l'onglet voisin.
  - Balance générale : regroupement par classe, sous-classe et compte, avec les soldes d'ouverture et de clôture, les mouvements et la comparaison N-1.
  - Balances clients et fournisseurs : regroupement par compte collectif et par tiers, avec les soldes, le non lettré et la balance âgée.
  - Soldes intermédiaires de gestion : regroupement par rubrique et par compte ; le total général est le résultat de l'exercice.
- Les TCD s'actualisent à l'ouverture dans Excel et se manipulent comme d'habitude (déplier, filtrer, réorganiser les champs). Leur contenu est déjà affiché à l'ouverture, même en mode protégé. Les onglets détaillés existants sont conservés.

## [0.11.0] - 2026-10-08

### Ajouté
- Module FEC : nouvel onglet « Chiffres clés », ouvert par défaut. Il affiche le chiffre d'affaires, le résultat de l'exercice, l'excédent brut d'exploitation, le total des produits et le total des charges, avec la comparaison N-1 si le FEC de l'exercice précédent est chargé. Il présente aussi les soldes intermédiaires de gestion, de la marge commerciale jusqu'au résultat, et propose un export Excel. Si les comptes de gestion sont soldés dans le FEC, le résultat est lu au compte 12.

### Modifié
- Accueil : le brief du jour s'affiche sous l'encart « Vos fichiers restent sur votre poste ».
- Balance générale : repliée par classe à l'ouverture (boutons « Tout déplier » et « Tout replier »).
- Circularisations : les critères C2 et F2 s'appellent désormais « Mouvements débiteurs » et « Mouvements créditeurs » de l'exercice, à l'écran comme dans le tableau de suivi.
- Circularisations : les emprunts (comptes 164) ne font plus partie des banques. Les sélections déjà enregistrées sont converties automatiquement. La lettre aux banques demande toujours les emprunts et concours.

## [0.10.0] - 2026-10-08

### Ajouté
- Courriers de circularisation : lettres de demande de confirmation au format Word (.docx), générées à partir de la sélection, avec les mêmes références que le tableau de suivi (BQ-001, CL-001, FO-001).
- Un modèle par population, modifiable : banques (soldes, emprunts, engagements hors bilan, effets, titres en dépôt, personnes habilitées, rappel des comptes y compris soldés), clients et fournisseurs (solde non indiqué par défaut, solde indiqué en option ; confirmation du solde, relevé de compte, ou les deux), coupon-réponse en option.
- Lettres sur papier à en-tête du client, signées par son dirigeant, avec réponse directe au cabinet ; bloc adresse du destinataire à compléter dans Word.
- Écran d'édition : coordonnées du cabinet (communes au poste), en-tête et signataire du client (par dossier), dates des lettres et de réponse, texte des modèles avec variables à insérer, aperçu en direct de la lettre de n'importe quel tiers retenu.
- Export en lot : archive .zip avec un fichier .docx par tiers, ou document unique pour impression ; choix des lettres à générer.

## [0.9.0] - 2026-10-08

### Ajouté
- Module Circularisations : à partir du FEC d'un dossier, sélection des banques (toutes, y compris les comptes soldés en cours d'année, regroupées par établissement), des clients et des fournisseurs selon les critères du cabinet (soldes, facturation ou achats de l'exercice, soldes anormaux, tirage aléatoire, ajouts et exclusions justifiés).
- Réglage des seuils (SS, SP, SAI, seuils en euros ou en % du SP) avec recalcul instantané ; indicateurs de couverture des soldes et des mouvements par population.
- Tirage aléatoire reproductible : la graine est affichée, modifiable et exportée ; même FEC, mêmes paramètres et même graine donnent exactement la même sélection.
- Tableau de suivi Excel : un onglet par population, listes déroulantes (statut, mode de réponse, sens, nature de la justification), écarts calculés par formule, écarts non justifiés supérieurs au SAI et demandes sans réponse mis en évidence, synthèse en formules vivantes, décisions manuelles et paramètres (graine, seuils, empreinte du FEC).
- Paramètres et décisions enregistrés avec le dossier, sur ce poste ; « Purger ce dossier » les supprime aussi.

## [0.8.0] - 2026-10-08

### Ajouté
- Analyses du FEC, après l'import : balance générale par classe et sous-classe (repliable), avec contrôle d'équilibre et comparaison avec l'exercice précédent si son FEC est chargé.
- Balances auxiliaires clients et fournisseurs, soldes anormaux mis en évidence, balance âgée des montants non lettrés à la clôture.
- Grand-livre filtrable (compte, auxiliaire, journal, période, montant, texte, lettrage) avec solde progressif, fluide même pour plusieurs millions de lignes ; un clic sur un compte de la balance ouvre son grand-livre, un clic sur une ligne affiche l'écriture complète.
- Statistiques et tests d'écritures : écritures par journal et par mois, week-ends et jours fériés, après clôture, montants ronds, OD sur la trésorerie ou le chiffre d'affaires, libellés génériques, doublons probables, loi de Benford, fin de période. Chaque indicateur ouvre la liste des écritures concernées.
- Export Excel de chaque vue (montants numériques, en-têtes figés, filtres, totaux, onglet « Paramètres » avec l'empreinte du FEC).
- Données du FEC mises à disposition du futur module Circularisations (soldes par tiers et par compte, banques, écritures).

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
