# Veille Pôle 003 — architecture et sources

Ce document remplace la section 2 de `docs/SPEC.md` pour tout ce qui concerne la collecte. Catalogues :

| Fichier | Contenu | Modifiable à la main |
|---|---|---|
| `veille/sources.json` | sources de la veille (flux, pages, API, dossiers législatifs, calendrier fiscal, alertes) | oui |
| `veille/mots-cles.json` | classement par mots-clés | oui |
| `veille/indicateurs.json` | séries INSEE de la conjoncture | oui |
| `veille/echeances.json` | échéances des entreprises absentes du calendrier fiscal officiel | oui |
| `veille/suivi-textes.json` | compléments du suivi PLF / PLFSS (mots-clés, étapes, échéances, secours) | oui |
| `veille/hierarchie-mesures.json` | hiérarchie des mesures du PLF et du PLFSS | oui |
| `veille/marches-sources.json` | indicateurs de marché : sources, règles de publication, emplacement de la valeur | oui |
| `veille/evenements.json` | repères des graphiques (réunions de la BCE, dépôt du PLF) | oui |
| `veille/config.json` | fenêtres, conservation, User-Agent | oui |

**Veille à 0 € (décision du 08/10/2026)** : aucun appel à l'API Claude ni à un autre service d'IA, ni automatique ni manuel. La recherche IA est décrite plus bas pour mémoire, dans « Plus tard : recherche IA (désactivée) ». Le paramètre `"recherche_ia": false` de `veille/config.json` le rappelle ; la collecte refuse de démarrer s'il vaut `true`, puisque le code correspondant n'existe pas. Aucun service payant n'est utilisé : sources publiques gratuites, minutes GitHub Actions d'un dépôt public.

Le navigateur ne charge que trois fichiers de la même origine, en GET, sans paramètre : `news.json`, `veille-etat.json` et `marches.json` (CLAUDE.md, règle n° 1). La CSP est inchangée.

## Pourquoi les tentatives précédentes échouaient

Constats faits le 08/10/2026 (et le 09/10/2026 pour les nouvelles sources) en testant les sources une par une :

| Problème | Exemples | Parade |
|---|---|---|
| La liste des flux est générée en JavaScript : on ne trouve pas l'URL du flux en lisant la page | BOFiP, INSEE, CNCC | Utiliser les URL de flux directes du catalogue (déjà trouvées) |
| Le site bloque les robots par un défi JavaScript ou cookies | vie-publique.fr, cncc.fr, aft.gouv.fr | Pas de parade gratuite : source écartée, ou relais officiel (la dette négociable de l'AFT est lue dans la BDM de l'INSEE) |
| Le flux annonce un encodage faux | Sénat : déclare `iso-8859-15` mais contient de l'UTF-8 | Décoder les octets soi-même : essayer UTF-8 strict, sinon l'encodage déclaré |
| Dates absentes ou mal formées | BOFiP : pas de `pubDate` (date dans la description) ; Sénat : `Wed,07 Oct` sans espace | Parseur de date tolérant + extraction par expression régulière dans la description |
| Liens en `http://` | Assemblée nationale, BOFiP (canal) | Réécrire en `https://` |
| Pages qui n'existent plus (404) | anciennes pages « flux RSS » de plusieurs sites | Health-check quotidien, la source est marquée « en panne » sans faire échouer le reste |
| `robots.txt` injoignable | api.insee.fr (connexion coupée depuis GitHub Actions) ; www.senat.fr (503 passager) | API documentée : exception « api_documentee » ; panne passagère : le robots.txt n'est pas gardé en mémoire, la nouvelle tentative le relit |
| `robots.txt` interdit l'accès | Google (`/alerts/`), portail open data du BODACC (`/api/`), Google News RSS | Exception « ignorer » validée par l'utilisateur pour ses propres alertes et pour l'API du BODACC ; sinon jamais de contournement |

Règle d'or : **une source en échec ne doit jamais faire échouer la collecte.** Chaque source est isolée (try/catch, délai maximal de 20 s, 2 nouvelles tentatives espacées), et son état est consigné dans `public/veille-etat.json` (avec l'historique des 30 derniers jours).

### Exceptions à robots.txt (décision de l'utilisateur, 09/10/2026)

Le client HTTP respecte `robots.txt` (RFC 9309 : un fichier injoignable vaut interdiction totale). Une source du catalogue peut porter le champ `"robots"` :

- `"api_documentee"` : API officielle documentée pour un usage automatisé. Un `robots.txt` injoignable est traité comme absent ; une interdiction explicite reste respectée. Utilisé pour l'API BDM de l'INSEE.
- `"ignorer"` : `robots.txt` n'est pas consulté. Utilisé pour les flux d'alertes Google créés par l'utilisateur et pour l'API open data du BODACC, dont le `robots.txt` vise les robots d'indexation.

Les en-têtes d'authentification (clé Webstat) ne suivent jamais une redirection vers un autre hôte.

## Architecture : couches A et B (0 €)

Le workflow GitHub Actions `veille.yml` tourne chaque jour ouvré à 6 h 30 (heure de Paris), sur déclenchement manuel et à chaque modification sur `main` d'un réglage saisi à la main. Il exécute les couches A et B, les alertes Google, le calendrier fiscal et le suivi des textes, fusionne, déduplique, regroupe, classe par mots-clés, puis publie `public/news.json` et `public/veille-etat.json`.

### Couche A — Flux RSS/Atom vérifiés (gratuit, fiable)
Lecture directe des flux listés dans `veille/sources.json` avec `"type": "rss"`. En-tête `User-Agent` explicite (`Pole003-Veille/1.0 (+https://pole-003.github.io/sandbox)`), respect du `robots.txt`, au plus 1 requête par seconde et par domaine.

### Alertes Google (presse, gratuit)
Type `alerte_google` (source `alertes-google`). L'utilisateur crée ses alertes sur google.com/alerts avec « Envoyer à : flux RSS ». Les adresses des flux contiennent un identifiant lié à son compte : elles sont lues dans le secret GitHub `ALERTES_RSS`, une ligne par flux au format `Thème|URL` (lignes vides et `#` ignorées), jamais dans le dépôt, jamais journalisées ni publiées (les messages citent le numéro de ligne et le libellé).

- Si `Thème` est l'un des thèmes de la veille, il sert de thème de départ au classement ; sinon c'est le thème du catalogue.
- Les liens de redirection Google (`https://www.google.com/url?…&url=<article>&…`) sont réduits à l'adresse de l'article.
- L'émetteur affiché est le domaine de l'article, suivi de « (alerte Google) » ; type d'article « presse », badge « Presse ».
- Comme pour les flux officiels, on ne publie que le titre, le lien, la date et l'extrait fourni par le flux, tronqué à 300 caractères.
- Sans le secret, la source est « non configurée ».

### Couche B — API officielles (gratuit)
Sources structurées, beaucoup plus fiables que le scraping. Clés éventuelles en *secrets* GitHub, jamais dans le code.

| Source | État | Clé |
|---|---|---|
| **INSEE, API BDM** (`insee-bdm`) | Active : 5 indicateurs de `veille/indicateurs.json` (inflation IPCH, croissance du PIB, chômage BIT, climat des affaires, créations d'entreprises) | Aucune (API ouverte depuis 2024 ; `INSEE_API_KEY` n'est plus utilisé) |
| **BODACC 35** (`bodacc-35`) | Active : nombre d'annonces d'Ille-et-Vilaine sur 7 jours par famille (créations, procédures collectives, ventes et cessions, radiations), aucun nom publié | Aucune |
| **PISTE** (Légifrance, Judilibre) | Non configurée, connecteur à développer | `PISTE_CLIENT_ID`, `PISTE_CLIENT_SECRET` |
| **Banque de France Webstat** (`bdf-webstat`, défaillances, crédits) | Non configurée, connecteur à développer (le TEC 10 est suivi par la collecte des marchés) | `BDF_API_KEY` |

Les indicateurs d'une API en panne restent ceux déjà publiés. Sans identifiants, l'API est sautée et signalée « non configurée » dans `veille-etat.json`, sans bloquer la collecte. Un connecteur n'est ajouté qu'après validation de l'API par du code exécuté dans GitHub Actions (`npm run veille:explorer-marches`).

### Calendrier fiscal officiel
Source `impots-calendrier-fiscal` (type `calendrier`) : les pages mensuelles `https://www.impots.gouv.fr/professionnel/calendrier-fiscal/AAAA-MM` du mois en cours et des deux suivants (structure relevée le 09/10/2026 : titres de jour `<h3>` puis cartes `fr-card__title` / `fr-card__desc`). Un mois illisible garde les échéances déjà publiées pour ce mois.

## Suivi du PLF et du PLFSS (automatique, 0 €)

Priorité du pôle. Sources :

- les dossiers législatifs de l'Assemblée nationale (`dyn/17/dossiers/PLF_<année>` et `PLFSS_<année>`, sources `an-dossier-plf` et `an-dossier-plfss`), qui retracent toute la navette ; bloc « Étapes de lecture » (`etape-slider`) ;
- les dossiers législatifs du Sénat (`dossier-legislatif/pjlf<année>.html` et `plfss<année>.html`, sources `senat-dossier-plf` et `senat-dossier-plfss`, `"chambre": "senat"`) : liste « Les étapes de la discussion » (`ol.timeline-summary`, dates dans `time[datetime]`), structure relevée le 09/10/2026 sur pjlf2026.html. Le Sénat est lu pour **la même année** que le dossier de l'Assemblée (jamais le texte de l'année précédente) ; une erreur 404 est normale tant que le texte ne lui a pas été transmis. Ses étapes absentes du dossier de l'Assemblée sont ajoutées à la frise.

- Année : l'année suivante est essayée en premier (le PLF est déposé à l'automne), puis l'année en cours. Rien à changer chaque automne.
- Frise : étapes publiées (la dernière « en cours », toutes « faites » après la promulgation), puis étapes restantes « à venir » dans l'ordre de la procédure.
- Délais constitutionnels, comptés en jours depuis le dépôt et présentés comme indicatifs : PLF (art. 47 C) 40 jours pour la 1re lecture à l'Assemblée et 70 jours pour le Parlement ; PLFSS (art. 47-1 C) 20 et 50 jours.
- **Détection des changements :** à chaque collecte, les étapes lues sont comparées à celles de l'exécution précédente (empreinte), pour l'Assemblée comme pour le Sénat. Une nouvelle étape crée une alerte dans le fil d'actualité.
- Page illisible (maquette modifiée) : erreur explicite dans « État des sources », le dernier suivi publié est conservé.
- **`veille/suivi-textes.json`** (remplace `veille/suivi.json`), par texte : `mots_cles` (rattachent un article de la veille au texte, même syntaxe que `mots-cles.json`), `etapes` connues absentes des dossiers (`{libelle, date, source}`, elles remplacent l'étape générique « à venir » de même nature), `echeances` annoncées (`{libelle, date, source}`) et `secours` (frise complète, utilisée seulement si le dossier n'a jamais pu être lu).

### Principales mesures du projet de loi

- Texte lu : le dossier renvoie vers le projet de loi déposé (`dyn/17/textes/l17b<numéro>_projet-loi`) ; on lit sa version open data `dyn/opendata/PRJLANR5L17B<numéro>.html` (PLF 2027 : n° 3210 ; PLFSS 2027 : n° 3211).
- Deux présentations relevées le 08/10/2026 et toutes deux gérées : table des matières (`assnatTOC2` à `assnatTOC6`, PLF) et blocs d'article (`assnat9ArticleNum`, parties `assnat2PartieIntit`, PLFSS).
- Chaque article est repris avec son numéro et son intitulé officiel, sans reformulation, puis classé avec les mêmes mots-clés que le fil (sans bonus de source). Les articles d'importance 3 et plus forment les « principales mesures » ; tous les articles restent consultables, groupés par partie.
- Texte illisible : le suivi reste publié sans les mesures, l'erreur est indiquée dans « État des sources ».
- Hiérarchie établie par le pôle (`veille/hierarchie-mesures.json`), prioritaire sur les mots-clés : pour chaque projet de loi (clé : son numéro), les articles retenus avec leur importance (5 « Essentiel pour nos dossiers », 4 « Important », 3 « À suivre ») et leur rubrique. Les articles non retenus sont plafonnés à 2. L'intitulé de chaque ligne sert de contrôle : s'il ne correspond plus, la ligne est ignorée et l'écart est signalé dans « État des sources ».

## Fusion, déduplication, regroupement et classement

- Clé de déduplication : URL normalisée (https, sans paramètres de suivi `utm_*`, sans `#`), puis similarité de titre (indice de Jaccard ≥ 0,8, dates à moins de 3 jours). Un article déjà publié garde sa date de première collecte ; un résumé manquant est complété.
- **Regroupement des articles similaires :** deux articles de **sources différentes**, publiés à moins de 3 jours d'écart, dont les titres sont proches (Jaccard ≥ 0,5), forment un seul article ; les autres sources sont gardées dans `autres_sources` (« Aussi publié par » à l'écran) et ne réapparaissent pas le lendemain. Une publication officielle est toujours l'article principal, même si une alerte de presse est arrivée la veille.
- **Résumé** : la description fournie par le flux, nettoyée du HTML et tronquée à 300 caractères (`longueur_resume` de `config.json`), coupée entre deux mots. Aucune reformulation.
- **Classement par mots-clés** (`veille/mots-cles.json`, sans IA), recalculé à chaque exécution pour que toute modification des règles s'applique aussi aux articles déjà publiés :
  - texte examiné : titre et résumé, sans accents ni majuscules ; un mot-clé reconnaît le début d'un mot (« comptab » trouve « comptabilité ») ; **précédé de « = », il ne reconnaît que le mot ou l'expression exacte** (« =plf » ne trouve ni « plfss » ni « plfr » ; « =audit » ne trouve pas « audition ») ;
  - score d'un thème : somme des poids des mots-clés trouvés (chacun une fois) **× coefficient de la nature de la source** (`coefficients_origine` : flux et API officiels 1, alertes de presse 0,6), plus le bonus éventuel de la source (`bonus_sources`) ;
  - thème : celui au score le plus élevé, à défaut le thème propre de l'article (alerte), puis celui de la source dans le catalogue ;
  - importance de 1 à 5 : premier seuil atteint dans `seuils_importance` ; en dessous du seuil 2, importance 1 (marginal, conservé mais masqué par défaut à l'écran) ;
  - **bonus de fraîcheur** (`bonus_fraicheur`, par paliers d'âge en jours) : ajouté au score de tri, sans effet sur l'importance (qui reste stable d'un jour à l'autre) ;
  - **« Pourquoi ce score »** : le détail (mots-clés reconnus et leurs poids, coefficient, bonus) est publié avec l'article (`pourquoi`) et affiché à l'écran ;
  - public : publics dont un mot-clé (`publics`) est trouvé, à défaut le public par défaut du thème ;
  - exclusions : un mot de la liste générale retire l'article de la publication ; une exclusion propre à un thème (ex. « stade rennais » pour Rennes et Bretagne) empêche seulement d'attribuer ce thème.
- Type de publication (texte officiel, doctrine, jurisprudence, presse…) : celui de la source (`type_article` du catalogue).
- Conservation : 60 jours glissants dans `public/news.json` ; au-delà, archivage mensuel dans `public/archives/AAAA-MM.json`.

## Échéances des entreprises

- Deux origines, chacune avec sa source officielle : le calendrier fiscal d'impots.gouv.fr (automatique, voir plus haut) et `veille/echeances.json`, saisi à la main pour ce que le calendrier fiscal ne contient pas (cotisations des travailleurs indépendants, index de l'égalité professionnelle, approbation et dépôt des comptes, facturation électronique…).
- `veille/echeances.json` : règles `mensuelle` (`jour`, `mois` facultatifs), `annuelle` (`jour`, `mois`), `jours_ouvres_apres` (`jour`, `mois`, `rang`, `plus_jours` : liasse fiscale = 2e jour ouvré après le 1er mai + 15 jours) et dates `ponctuelles`. Une date tombant un samedi, un dimanche ou un jour férié est reportée au premier jour ouvré suivant, sauf `"report": false`. Chaque échéance a un nom de source et un lien https (contrôlés à chaque collecte).
- Publication : `news.json` → `echeances`, de J-7 à J+100 ; à date et intitulé égaux, le calendrier officiel l'emporte.
- Écran « Échéances » (filtres par catégorie et période, groupé par jour) et bloc « Échéances des 15 prochains jours » sur l'accueil. Dates de droit commun : la date propre à chaque entreprise figure dans son espace professionnel.

## Suivi des marchés et des finances publiques (0 €)

### Sources (point d'arrêt 1, validé le 09/10/2026)

| Indicateur | Source principale | Secours | Rythme (heure de Paris) | Clé | Réutilisation |
|---|---|---|---|---|---|
| Dette publique (Md€ et % du PIB) | INSEE, BDM 010777616 et 010777608 (base 2020) | BCE, GFS (mêmes chiffres via Eurostat, environ 4 semaines plus tard) | trimestrielle, 8 h 45 aux dates du calendrier officiel (prochaine : 18/12/2026) | non | Licence Ouverte Etalab 2.0, « Source : Insee » |
| Dette négociable de l'État (complément) | données de l'AFT, BDM 001711531 | — | mensuelle | non | Licence Ouverte |
| OAT 10 ans | Banque de France, Webstat, TEC 10 quotidien (`FM.D.FR.EUR.FR2.BB.FRMOYTEC10.HSTA`) | BCE, taux long terme de la France (moyenne mensuelle, environ 12 jours après la fin du mois) | quotidien, en soirée | `BDF_API_KEY` (compte gratuit) | licence ouverte des jeux Webstat, « Banque de France » |
| EUR/USD | BCE, taux de référence (`EXR/D.USD.EUR.SP00.A`) | — | jours TARGET, vers 16 h | non | libre avec mention « Source : BCE » |
| Brent | EIA via FRED (`DCOILBRENTEU`) | — | valeurs quotidiennes publiées chaque mercredi | non | domaine public, citation demandée |

Choix du Brent : FRED, sans clé (le plus simple à actualiser), qui reprend la série officielle de l'EIA. Le site de l'AFT bloque les robots : la dette négociable est lue dans la BDM de l'INSEE, qui la diffuse.

### `veille/marches-sources.json`
Pour chaque indicateur : règle de publication (`frequence` quotidienne, hebdomadaire, mensuelle ou trimestrielle ; `heure` de Paris ; `tolerance_jours_ouvres` ; `decalage_jours` pour les estimations), `calendrier` officiel (dates et heures connues), `page_calendrier` (page INSEE lue à chaque interrogation pour « Prochaine publication : le … à … »), `sources` par ordre de préférence avec l'emplacement de la valeur (`emplacement` : idbank INSEE, ou colonnes date et valeur d'un CSV ; `multiplicateur` pour les unités), `regle_secours` propre à une source de secours, et `complements` (% du PIB, dette négociable).

**À mettre à jour à la main :** après chaque publication trimestrielle de la dette, l'adresse de la nouvelle page « Informations rapides » de l'INSEE dans `page_calendrier` (sinon la date suivante est estimée, mention « estimée ») ; les dates connues du calendrier de l'INSEE dans `calendrier`.

### Collecte calée sur les publications (`marches.yml`, `npm run marches:collecte`)
- Jours ouvrés à **7 h 05** (rattrapage quotidien), **9 h 02** (INSEE, publiée à 8 h 45), **16 h 20** (BCE, vers 16 h) et **19 h 30** (TEC 10 et Brent), plus déclenchement manuel (option « forcer ») et exécution à chaque modification de `marches-sources.json` ou `evenements.json` sur `main`. Le cron de GitHub est en UTC : chaque horaire est programmé pour l'heure d'été et pour l'heure d'hiver, et seul celui qui correspond à l'heure légale du jour passe.
- **N'interroge que les indicateurs dont une nouvelle valeur est attendue** : prochaine publication passée, échec à l'exécution précédente, pas encore de valeur, ou source principale de nouveau disponible quand le secours est utilisé.
- Une source en panne passe la main au secours ; si toutes échouent, la dernière valeur est conservée et l'erreur notée.
- **Publication** : `public/marches.json` n'est réécrit que si une valeur a changé ou si un indicateur tombe en panne ou s'en remet ; un commit groupé par exécution au plus, au message explicite (« Marchés : EUR/USD 1,1201 au 09/10 (collecte du 09/10/2026 16 h 20) »), puis redéploiement.

### `public/marches.json`
Pour chaque indicateur : valeur, unité, date de la valeur, date de récupération, variations (publication précédente, 1 mois, depuis le 1er janvier, 1 an ; en points de base pour un taux), historique (2 ans pour les séries quotidiennes, 12 trimestres pour la dette), séries complémentaires, source (organisme, libellé, lien, conditions, secours ou non, nature : « quotidien officiel », « mensuel », « trimestriel »…), règle en vigueur, prochaine publication attendue (calendrier officiel, ou estimée d'après la fréquence), dernière tentative, réussite et erreur, journal des 30 derniers jours. Plus les repères de `veille/evenements.json`.

### Fraîcheur (calculée dans le navigateur, à l'instant de la consultation)
- **À jour** : la prochaine publication attendue n'est pas encore passée.
- **Décalage normal** : elle est passée, mais dans la tolérance de la source (jours ouvrés TARGET).
- **En retard** : au-delà de la tolérance.
- **Source en panne** : la dernière tentative de collecte a échoué (la dernière valeur connue reste affichée).

### Estimation de la dette en temps réel
Extrapolation linéaire depuis le dernier chiffre officiel de l'INSEE (fin de trimestre, minuit), au rythme de la variation moyenne des 4 derniers trimestres. Calcul local, sans requête ; mise à jour chaque seconde (une fois par minute si les animations sont réduites) ; mention « Estimation, ce n'est pas un chiffre officiel » et méthode au survol.

## Droits et citation

- On publie uniquement : titre, émetteur, date, lien, et l'extrait fourni par la source dans son flux, tronqué à 300 caractères. Jamais le texte intégral. Les indicateurs sont des chiffres officiels, cités avec leur source et leurs conditions de réutilisation.
- Mention visible de la source sous chaque article et chaque indicateur (exigée notamment par le BOFiP, l'INSEE et la BCE).
- Respect du `robots.txt` et des conditions d'utilisation de chaque site et API, sauf les exceptions décrites plus haut, validées par l'utilisateur.

## Écrans

- **Accueil** : brief du jour (5 articles d'importance 4 ou 5), prochaine échéance du PLF et du PLFSS, échéances des 15 prochains jours.
- **Veille › Fil d'actualité** : filtres (thème, source, importance, public, non lus, importants, nouveaux depuis la dernière visite) mémorisés en local ; recherche plein texte sur 60 jours (guillemets, « -mot », surlignage) ; badge « Nouveau » ; « Pourquoi ce score ? » ; « Aussi publié par » ; marquage « lu » et « important » (IndexedDB) ; export .xlsx de la sélection.
- **Veille › Échéances** : calendrier fiscal officiel et échéances saisies, par jour.
- **Veille › Suivi** :
  - *Marchés et finances publiques* : quatre cartes, graphique détaillé (périodes, survol et clavier, minimum et maximum, repères, comparaison en base 100), dette en barres trimestrielles et en % du PIB (deux panneaux superposés, une échelle chacun : jamais de double axe), compteur de la dette, prochaines publications, conjoncture INSEE. `marches.json` est relu à l'ouverture du sous-onglet et quand l'onglet du navigateur redevient visible, jamais périodiquement.
  - *PLF / PLFSS* : frise interactive (étape en cours mise en avant, dates, échéances à venir ; clic sur une étape → articles de la veille liés au texte publiés pendant l'étape), principales mesures.
  - *État des sources* : une ligne par source de veille et par indicateur (dernière réussite, prochaine récupération prévue, fraîcheur, nombre d'éléments, dernière erreur, 30 pastilles : vert réussie, orange valeur attendue pas encore publiée, rouge échec, gris pas de collecte) ; classement et coût.
- **Veille › Rennes et Bretagne** : compteurs du BODACC sur 7 jours et fil dédié.
- Anciennes adresses (`#/veille/plf`, `#/veille/indicateurs`, `#/veille/sources`) redirigées vers les sous-onglets du Suivi.

## Configuration (secrets GitHub, tous facultatifs)

| Secret | Utilisé par | Effet sans lui |
|---|---|---|
| `ALERTES_RSS` | `veille.yml` | alertes Google « non configurées » |
| `BDF_API_KEY` | `veille.yml`, `marches.yml` | OAT 10 ans en moyenne mensuelle (BCE) au lieu du TEC 10 quotidien |
| `PISTE_CLIENT_ID`, `PISTE_CLIENT_SECRET` | `veille.yml` | Légifrance et Judilibre « non configurés » (connecteurs à développer) |

Les workflows programmés ne tournent que depuis la branche par défaut (`main`).

## État de réalisation (09/10/2026)

| Élément | État |
|---|---|
| Diagnostic des sources (`npm run veille:test`, `veille:explorer-marches`, workflow `veille-diagnostic.yml`) | Fait |
| Couche A (flux RSS/Atom) | Fait |
| Alertes Google (secret `ALERTES_RSS`) | Fait, à configurer |
| Couche B : INSEE et BODACC | Fait ; PISTE et Webstat (veille) à développer |
| Exceptions à robots.txt par source | Fait |
| Classement par mots-clés v2 (expressions exactes, coefficients, fraîcheur, détail du score) | Fait |
| Regroupement des articles similaires | Fait |
| Échéances (calendrier fiscal officiel et saisie) | Fait |
| Fil : nouveautés, filtres mémorisés, recherche plein texte, export .xlsx | Fait |
| Suivi PLF / PLFSS (Assemblée nationale et Sénat, `suivi-textes.json`) | Fait |
| Suivi des marchés (`marches.yml`, `marches.json`, onglet Suivi) | Fait ; TEC 10 quotidien dès que `BDF_API_KEY` est configuré |
| État des sources avec historique sur 30 jours | Fait |
| Recherche IA (couche C) et notation IA | Désactivées : code retiré, description conservée ci-dessous |

## Plus tard : recherche IA (désactivée)

> **Désactivée le 08/10/2026 : la veille doit fonctionner à 0 €.** Le code correspondant a été retiré (scripts, dépendance au SDK, secret `ANTHROPIC_API_KEY` dans les workflows). Ce qui suit est conservé pour mémoire, au cas où la décision serait revue ; il faudrait alors repasser par une validation explicite du budget.

### Principe
Pour tout ce que A et B ne couvrent pas (sites protégés, presse économique, actualité de Rennes, analyses du PLF), le workflow appelle l'API Claude avec l'**outil de recherche web côté serveur**. C'est Anthropic qui effectue les recherches : les blocages JavaScript et anti-robots qui gênent un script ne s'appliquent pas de la même façon, et chaque fait est accompagné de sa citation.

- Outil : `web_search` (type `web_search_20250305` ou version plus récente compatible avec le modèle choisi), avec `user_location` = Rennes, Bretagne, FR, fuseau `Europe/Paris`.
- Modèle : configurable dans `veille/config.json` (par défaut `claude-sonnet-5-5` ; `claude-haiku-5-5` pour réduire le coût). Vérifier au démarrage, via l'API Models, que le modèle supporte l'outil.
- Un appel par thème (6 thèmes), `max_uses` de 4 à 6 recherches par thème.
- Coût indicatif : 10 $ pour 1 000 recherches, plus les jetons. Environ 30 recherches par jour ouvré, soit quelques dizaines de centimes par jour. Le coût réel de chaque exécution est calculé à partir du champ `usage` et inscrit dans `veille-etat.json`.
- Plafond dur : si le coût cumulé du mois (suivi dans `veille/couts.json`) dépasse `budget_mensuel_usd` de `config.json`, la couche C est sautée jusqu'au mois suivant.
- Clé `ANTHROPIC_API_KEY` en secret GitHub, sur une clé dédiée à la veille avec sa propre limite de dépense dans la Console.

### Prompt de la recherche IA

Prompt système (fichier `veille/prompt-systeme.md`) :

```
Tu es le documentaliste du pôle innovation d'un cabinet d'expertise comptable et de commissariat aux comptes basé à Rennes (Ille-et-Vilaine). Ton lectorat : experts-comptables, commissaires aux comptes et collaborateurs qui conseillent des PME et ETI bretonnes.

Ta mission : repérer, parmi les publications des derniers jours, les informations qui changent quelque chose pour ce métier ou pour ses clients, et écarter le reste.

Méthode :
1. Effectue des recherches ciblées en privilégiant les sources primaires officielles (legifrance.gouv.fr, bofip.impots.gouv.fr, impots.gouv.fr, economie.gouv.fr, assemblee-nationale.fr, senat.fr, vie-publique.fr, conseil-constitutionnel.fr, conseil-etat.fr, courdecassation.fr, urssaf.fr, boss.gouv.fr, insee.fr, banque-france.fr, anc.gouv.fr, cncc.fr, experts-comptables.fr, metropole.rennes.fr, bretagne.bzh, ille-et-vilaine.cci.fr). Utilise la presse économique et régionale pour les sujets d'entreprise et de conjoncture, en remontant si possible à la source primaire.
2. Ne retiens que des publications datées des 7 derniers jours (14 jours pour les thèmes Statistiques et Rennes). Écarte tout ce qui est antérieur, même pertinent.
3. Pour chaque information retenue, vérifie la date, l'émetteur et l'URL exacte. N'invente jamais un chiffre, un numéro d'article, une date ou une URL ; en cas de doute, n'inclus pas l'information.
4. Rédige chaque résumé en français, avec tes propres mots, en 2 phrases maximum, sans recopier le texte source.
5. Attribue un score d'importance de 1 à 5 :
   5 = change immédiatement une pratique ou une obligation (nouvelle règle fiscale ou sociale applicable, date limite, décision de jurisprudence de principe, vote définitif) ;
   4 = évolution probable à préparer (amendement adopté, projet de texte, doctrine en consultation) ;
   3 = contexte utile au conseil (statistique majeure, rapport officiel, tendance économique) ;
   2 = information d'ambiance ;
   1 = marginal. N'inclus pas les scores 1.
6. Indique pour qui c'est important : « Expertise comptable », « Audit / CAC », « Social / paie », « Conseil aux dirigeants ».
7. Réponds uniquement par un objet JSON valide conforme au schéma fourni, sans texte autour.
```

Thèmes et consignes (fichier `veille/themes.json`, une requête utilisateur par thème) :

| Thème | Consigne envoyée |
|---|---|
| Loi de finances | Où en est le projet de loi de finances pour l'année prochaine ? Étape parlementaire actuelle, prochaines échéances, mesures fiscales votées, adoptées ou supprimées cette semaine qui concernent les entreprises, les dirigeants et les particuliers (IS, TVA, CVAE, IR, plus-values, transmission, crédits d'impôt). Inclure les éventuelles lois de finances rectificatives et la saisine du Conseil constitutionnel. Renseigne aussi le champ `suivi_texte`. |
| Sécurité sociale | Même consigne pour le projet de loi de financement de la sécurité sociale : cotisations, exonérations, allègements généraux, indépendants, épargne salariale, avantages en nature. Ajoute les actualités du BOSS et de l'URSSAF. Renseigne `suivi_texte`. |
| Fiscal et comptable | Nouveautés de doctrine (BOFiP, rescrits), décrets et arrêtés au Journal officiel, règlements et avis de l'ANC, facturation électronique et e-reporting (calendrier, plateformes agréées), obligations déclaratives et échéances à venir. |
| Audit et profession | Actualité des commissaires aux comptes et des experts-comptables : CNCC, Haute autorité de l'audit (H2A, ex-H3C), Ordre des experts-comptables, normes d'exercice professionnel, rapport de durabilité (CSRD et ses reports), contrôles qualité, décisions et sanctions publiées. |
| Économie et statistiques | Derniers chiffres publiés en France : inflation, PIB et prévisions, chômage, climat des affaires, défaillances et créations d'entreprises, taux directeurs de la BCE, taux d'emprunt des entreprises, taux de l'intérêt légal et taux d'usure s'ils ont changé. Pour chaque chiffre : valeur, période, émetteur, date de publication. Remplis le tableau `indicateurs`. |
| Rennes et Bretagne | Vie économique de Rennes, de la métropole et de l'Ille-et-Vilaine : implantations et extensions d'entreprises, levées de fonds, reprises et cessions, plans sociaux et procédures collectives notables, grands projets d'aménagement, aides régionales et appels à projets, événements pour les dirigeants (CCI, French Tech Rennes, réseaux d'entreprises), chiffres de conjoncture régionaux (INSEE Bretagne, Banque de France). |

Schéma JSON attendu pour chaque thème :

```json
{
  "theme": "Loi de finances",
  "articles": [
    {
      "titre": "…",
      "resume": "…",
      "source": "Assemblée nationale",
      "url": "https://…",
      "date_publication": "2026-10-07",
      "importance": 4,
      "public": ["Expertise comptable", "Conseil aux dirigeants"],
      "type": "texte_officiel | doctrine | jurisprudence | statistique | presse | evenement"
    }
  ],
  "indicateurs": [
    { "libelle": "Inflation sur un an", "valeur": "…", "periode": "septembre 2026", "source": "INSEE", "url": "https://…", "date_publication": "…" }
  ],
  "suivi_texte": {
    "texte": "PLF 2027",
    "etape_actuelle": "…",
    "etapes": [ { "libelle": "Dépôt à l'Assemblée nationale", "date": "…", "statut": "fait | en_cours | a_venir" } ],
    "prochaine_echeance": { "libelle": "…", "date": "…" }
  }
}
```

Contrôles automatiques après chaque appel (le script, pas l'IA) :
- JSON valide et conforme au schéma, sinon un nouvel essai, puis abandon du thème pour la journée.
- Toute URL d'article doit figurer parmi les URL citées par l'outil de recherche dans la réponse ; sinon l'article est rejeté (protection contre les URL inventées).
- Date de publication dans la fenêtre demandée, sinon rejet.
- Indicateurs : affichés avec leur source et leur date, et un badge « Source IA, à vérifier » tant qu'aucune API de la couche B ne fournit la même série.

Notation des articles de flux (également désactivée) : un appel IA léger groupé, sans recherche web, notait les articles sans score avec le même barème ; il est remplacé par le classement par mots-clés.
