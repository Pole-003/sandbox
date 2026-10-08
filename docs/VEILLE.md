# Veille Pôle 003 — architecture et sources

Ce document remplace la section 2 de `docs/SPEC.md` pour tout ce qui concerne la collecte. Le catalogue des sources est dans `veille/sources.json`.

**Veille à 0 € (décision du 08/10/2026)** : aucun appel à l'API Claude ni à un autre service d'IA, ni automatique ni manuel. La recherche IA est décrite plus bas pour mémoire, dans « Plus tard : recherche IA (désactivée) ». Le paramètre `"recherche_ia": false` de `veille/config.json` le rappelle ; la collecte refuse de démarrer s'il vaut `true`, puisque le code correspondant n'existe pas.

## Pourquoi les tentatives précédentes échouaient

Constats faits le 08/10/2026 en testant les sources une par une :

| Problème | Exemples | Parade |
|---|---|---|
| La liste des flux est générée en JavaScript : on ne trouve pas l'URL du flux en lisant la page | BOFiP, INSEE, CNCC | Utiliser les URL de flux directes du catalogue (déjà trouvées) |
| Le site bloque les robots par un défi JavaScript ou cookies | vie-publique.fr, cncc.fr | Pas de parade gratuite pour l'instant : source écartée (la recherche IA, qui la contournait, est désactivée) |
| Le flux annonce un encodage faux | Sénat : déclare `iso-8859-15` mais contient de l'UTF-8 | Décoder les octets soi-même : essayer UTF-8 strict, sinon l'encodage déclaré |
| Dates absentes ou mal formées | BOFiP : pas de `pubDate` (date dans la description) ; Sénat : `Wed,07 Oct` sans espace | Parseur de date tolérant + extraction par expression régulière dans la description |
| Liens en `http://` | Assemblée nationale, BOFiP (canal) | Réécrire en `https://` |
| Pages qui n'existent plus (404) | anciennes pages « flux RSS » de plusieurs sites | Health-check quotidien, la source est marquée « en panne » sans faire échouer le reste |
| `robots.txt` interdit l'accès | Google News RSS, certaines API publiques | Ne jamais contourner ; passer par une API officielle (couche B) |

Règle d'or : **une source en échec ne doit jamais faire échouer la collecte.** Chaque source est isolée (try/catch, délai maximal de 20 s, 2 nouvelles tentatives espacées), et son état est consigné dans `public/veille-etat.json`.

## Architecture : couches A et B (0 €)

Le workflow GitHub Actions `veille.yml` tourne chaque jour ouvré à 6 h 30 (heure de Paris) et sur déclenchement manuel. Il exécute les couches A et B, fusionne, déduplique, classe par mots-clés, puis publie `public/news.json` et `public/veille-etat.json`. Coût : 0 € (sources publiques gratuites, minutes GitHub Actions d'un dépôt public).

### Couche A — Flux RSS/Atom vérifiés (gratuit, fiable)
Lecture directe des flux listés dans `veille/sources.json` avec `"type": "rss"`. En-tête `User-Agent` explicite (`Pole003-Veille/1.0 (+https://pole-003.github.io/sandbox)`), respect du `robots.txt`, au plus 1 requête par seconde et par domaine.

### Couche B — API officielles (gratuit, clé personnelle)
Sources structurées, beaucoup plus fiables que le scraping. Clés stockées en *secrets* GitHub, jamais dans le code.
- **PISTE** (piste.gouv.fr, compte gratuit) : API Légifrance (Journal officiel, textes publiés) et API Judilibre (décisions de la Cour de cassation, filtrables par chambre commerciale et par date).
- **Portail des API de l'INSEE** (compte gratuit) : séries de la BDM pour les indicateurs (inflation, chômage, PIB, climat des affaires, créations d'entreprises).
- **Banque de France Webstat** (compte gratuit) : taux, défaillances d'entreprises.
- **BODACC** (open data DILA) : annonces commerciales filtrées sur le département 35 (créations, ventes de fonds, procédures collectives) pour la rubrique Rennes. Vérifier l'URL d'API et les conditions d'utilisation.

Chaque API est optionnelle. Les noms des secrets attendus figurent dans le champ `secret` du catalogue (`PISTE_CLIENT_ID` et `PISTE_CLIENT_SECRET`, `INSEE_API_KEY`, `BDF_API_KEY`) ; le workflow les transmet à la seule étape de collecte. Sans identifiants, l'API est sautée et signalée « non configurée » dans `veille-etat.json`, sans bloquer la collecte. Les messages ne citent que le nom des variables manquantes, jamais leur valeur.

Chaque API a besoin d'un connecteur (`scripts/veille/couche-b.ts`). Un connecteur n'est ajouté qu'après validation de l'API par du code exécuté dans GitHub Actions, comme pour les flux ; tant qu'il manque, l'API est signalée « non configurée (connecteur à développer) ».

## Suivi du PLF et du PLFSS (automatique, 0 €)

Priorité du pôle. Source : les dossiers législatifs de l'Assemblée nationale (`dyn/17/dossiers/PLF_<année>` et `PLFSS_<année>`, sources `an-dossier-plf` et `an-dossier-plfss` de type « dossier »), qui retracent toute la navette (Sénat, CMP, Conseil constitutionnel, promulgation). Structure relevée le 08/10/2026 par `npm run veille:explorer-suivi` : bloc « Étapes de lecture » (`etape-slider`), une diapositive par étape avec son libellé et sa date. Le Sénat n'avait pas encore de page de dossier (404) : non utilisé.

- Année : l'année suivante est essayée en premier (le PLF est déposé à l'automne), puis l'année en cours. Rien à changer chaque automne.
- Frise : étapes publiées (la dernière « en cours », toutes « faites » après la promulgation), puis étapes restantes « à venir » dans l'ordre de la procédure (1re lecture au Sénat, CMP, Conseil constitutionnel, promulgation). Nouvelle lecture et lecture définitive n'apparaissent que si elles ont lieu.
- Délais constitutionnels, comptés en jours depuis le dépôt et présentés comme indicatifs : PLF (art. 47 C) 40 jours pour la 1re lecture à l'Assemblée et 70 jours pour le Parlement ; PLFSS (art. 47-1 C) 20 et 50 jours.
- Prochaine échéance : le premier délai encore à venir et pertinent, sinon la prochaine étape.
- Nouvelle étape détectée (par rapport au relevé précédent) : alerte dans le fil d'actualité, importance 5.
- Page illisible (maquette modifiée) : erreur explicite dans « État des sources », le dernier suivi publié est conservé. `veille/suivi.json` (saisie manuelle) ne sert que si le dossier n'a encore jamais pu être lu.

## Fusion, déduplication et classement

- Clé de déduplication : URL normalisée (https, sans paramètres de suivi `utm_*`, sans `#`), puis similarité de titre. Un article déjà publié garde sa date de première collecte ; un résumé manquant est complété.
- **Résumé** : la description fournie par le flux, nettoyée du HTML et tronquée à 300 caractères (`longueur_resume` de `config.json`), coupée entre deux mots. Aucune reformulation. Pas de description (ou description identique au titre) : pas de résumé.
- **Classement par mots-clés** (`veille/mots-cles.json`, sans IA), recalculé à chaque exécution pour que toute modification des règles s'applique aussi aux articles déjà publiés :
  - texte examiné : titre et résumé, sans accents ni majuscules ; un mot-clé reconnaît le début d'un mot (« comptab » trouve « comptabilité ») ;
  - score d'un thème : somme des poids des mots-clés trouvés (chacun une fois), plus le bonus éventuel de la source (`bonus_sources`) ;
  - thème : celui au score le plus élevé, à défaut celui de la source dans le catalogue ;
  - importance de 1 à 5 : premier seuil atteint dans `seuils_importance` ; en dessous du seuil 2, importance 1 (marginal, conservé mais masqué par défaut à l'écran) ;
  - public : publics dont un mot-clé (`publics`) est trouvé, à défaut le public par défaut du thème ;
  - exclusions : un mot de la liste générale retire l'article de la publication ; une exclusion propre à un thème empêche seulement d'attribuer ce thème.
- Type de publication (texte officiel, doctrine, jurisprudence…) : celui de la source (`type_article` du catalogue).
- Conservation : 60 jours glissants dans `public/news.json` ; au-delà, archivage mensuel dans `public/archives/AAAA-MM.json`.

## Droits et citation

- On publie uniquement : titre, émetteur, date, lien, et l'extrait fourni par la source dans son flux, tronqué à 300 caractères. Jamais le texte intégral. Les sources de la couche A sont des publications officielles, pas de la presse.
- Mention visible de la source sous chaque article (exigée notamment par le BOFiP).
- Respect du `robots.txt` et des conditions d'utilisation de chaque site et API.

## Écrans

- **Brief du jour** (accueil) : les 5 articles d'importance 4 ou 5 les plus récents, tous thèmes confondus, plus la prochaine échéance du PLF et du PLFSS.
- **Veille** : fil filtrable par thème, source, importance et public ; recherche locale ; marquage « lu » et « important pour nos dossiers » en local.
- **Suivi PLF / PLFSS** : frise automatique des étapes (dossiers législatifs de l'Assemblée nationale), délais constitutionnels indicatifs, lien vers le dossier, et dernières actualités de chaque texte.
- **Indicateurs** : tuiles (valeur, période, source, date) alimentées par la couche B (INSEE, Banque de France) une fois configurée.
- **Rennes et Bretagne** : fil dédié et, si la couche B BODACC est active, compteurs hebdomadaires des créations et procédures collectives en Ille-et-Vilaine.
- **État des sources** : tableaux de `veille-etat.json` pour les flux (couche A) et les API (couche B, dont « non configurée ») : dernière réussite, erreurs, nombre d'articles ; bilan du classement ; recherche IA désactivée ; coût 0 €.

## État de réalisation (08/10/2026)

| Élément | État |
|---|---|
| Diagnostic des sources (`npm run veille:test`, workflow `veille-diagnostic.yml`) | Fait |
| Couche A (flux RSS/Atom, page du dossier PLF) | Fait |
| Couche B (API PISTE, INSEE, Banque de France, BODACC) | Cadre fait (API optionnelles, « non configurée » sans identifiants) ; connecteurs à développer et valider un par un |
| Classement par mots-clés (`veille/mots-cles.json`) | Fait |
| Résumés repris des flux (300 caractères) | Fait |
| Fusion, 60 jours glissants, archives mensuelles | Fait |
| Workflow `veille.yml` (couches A et B, 0 €) | Fait |
| Suivi PLF / PLFSS automatique (dossiers législatifs de l'Assemblée nationale) | Fait ; `veille/suivi.json` en secours |
| Écrans (brief, veille, suivi, indicateurs, Rennes, état des sources) | Fait. Indicateurs et compteurs BODACC en attente de la couche B |
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
