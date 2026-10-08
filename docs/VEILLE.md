# Veille Pôle 003 — architecture et sources

Ce document remplace la section 2 de `docs/SPEC.md` pour tout ce qui concerne la collecte. Le catalogue des sources est dans `veille/sources.json`.

## Pourquoi les tentatives précédentes échouaient

Constats faits le 08/10/2026 en testant les sources une par une :

| Problème | Exemples | Parade |
|---|---|---|
| La liste des flux est générée en JavaScript : on ne trouve pas l'URL du flux en lisant la page | BOFiP, INSEE, CNCC | Utiliser les URL de flux directes du catalogue (déjà trouvées) |
| Le site bloque les robots par un défi JavaScript ou cookies | vie-publique.fr, cncc.fr | Couche C (recherche IA côté serveur) |
| Le flux annonce un encodage faux | Sénat : déclare `iso-8859-15` mais contient de l'UTF-8 | Décoder les octets soi-même : essayer UTF-8 strict, sinon l'encodage déclaré |
| Dates absentes ou mal formées | BOFiP : pas de `pubDate` (date dans la description) ; Sénat : `Wed,07 Oct` sans espace | Parseur de date tolérant + extraction par expression régulière dans la description |
| Liens en `http://` | Assemblée nationale, BOFiP (canal) | Réécrire en `https://` |
| Pages qui n'existent plus (404) | anciennes pages « flux RSS » de plusieurs sites | Health-check quotidien, la source est marquée « en panne » sans faire échouer le reste |
| `robots.txt` interdit l'accès | Google News RSS, certaines API publiques | Ne jamais contourner ; passer par une API officielle ou par la couche C |

Règle d'or : **une source en échec ne doit jamais faire échouer la collecte.** Chaque source est isolée (try/catch, délai maximal de 20 s, 2 nouvelles tentatives espacées), et son état est consigné dans `public/veille-etat.json`.

## Architecture en trois couches

Le workflow GitHub Actions `veille.yml` tourne chaque jour ouvré à 6 h 30 (heure de Paris) et sur déclenchement manuel. Il exécute les trois couches dans l'ordre, fusionne, déduplique, puis publie `public/news.json`.

### Couche A — Flux RSS/Atom vérifiés (gratuit, fiable)
Lecture directe des flux listés dans `veille/sources.json` avec `"type": "rss"`. En-tête `User-Agent` explicite (`Pole003-Veille/1.0 (+https://pole-003.github.io/sandbox)`), respect du `robots.txt`, au plus 1 requête par seconde et par domaine.

### Couche B — API officielles (gratuit, clé personnelle)
Sources structurées, beaucoup plus fiables que le scraping. Clés stockées en *secrets* GitHub, jamais dans le code.
- **PISTE** (piste.gouv.fr, compte gratuit) : API Légifrance (Journal officiel, textes publiés) et API Judilibre (décisions de la Cour de cassation, filtrables par chambre commerciale et par date).
- **Portail des API de l'INSEE** (compte gratuit) : séries de la BDM pour les indicateurs (inflation, chômage, PIB, climat des affaires, créations d'entreprises).
- **Banque de France Webstat** (compte gratuit) : taux, défaillances d'entreprises.
- **BODACC** (open data DILA) : annonces commerciales filtrées sur le département 35 (créations, ventes de fonds, procédures collectives) pour la rubrique Rennes. Vérifier l'URL d'API et les conditions d'utilisation.

Chaque API est optionnelle : si le secret n'est pas configuré, la couche saute cette source et le signale dans l'état.

### Couche C — Recherche IA quotidienne (payant, la parade universelle)
Pour tout ce que A et B ne couvrent pas (sites protégés, presse économique, actualité de Rennes, analyses du PLF), le workflow appelle l'API Claude avec l'**outil de recherche web côté serveur**. C'est Anthropic qui effectue les recherches : les blocages JavaScript et anti-robots qui gênent un script ne s'appliquent pas de la même façon, et chaque fait est accompagné de sa citation.

- Outil : `web_search` (type `web_search_20250305` ou version plus récente compatible avec le modèle choisi), avec `user_location` = Rennes, Bretagne, FR, fuseau `Europe/Paris`.
- Modèle : configurable dans `veille/config.json` (par défaut `claude-sonnet-5-5` ; `claude-haiku-5-5` pour réduire le coût). Vérifier au démarrage, via l'API Models, que le modèle supporte l'outil.
- Un appel par thème (6 thèmes), `max_uses` de 4 à 6 recherches par thème.
- Coût indicatif : 10 $ pour 1 000 recherches, plus les jetons. Environ 30 recherches par jour ouvré, soit quelques dizaines de centimes par jour. Le coût réel de chaque exécution est calculé à partir du champ `usage` et inscrit dans `veille-etat.json`.
- Plafond dur : si le coût cumulé du mois (suivi dans `veille/couts.json`) dépasse `budget_mensuel_usd` de `config.json`, la couche C est sautée jusqu'au mois suivant.
- Clé `ANTHROPIC_API_KEY` en secret GitHub, sur une clé dédiée à la veille avec sa propre limite de dépense dans la Console.

## Prompt de la couche C

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

## Fusion, déduplication et classement

- Clé de déduplication : URL normalisée (https, sans paramètres de suivi `utm_*`, sans `#`), puis similarité de titre.
- Un article trouvé à la fois par la couche A et la couche C garde les métadonnées de la couche A (plus fiables) et le résumé de la couche C.
- Les articles des couches A et B sans score sont notés par un appel IA léger groupé (un seul appel pour tous les nouveaux titres du jour, sans recherche web), avec le même barème.
- Conservation : 60 jours glissants dans `public/news.json` ; au-delà, archivage mensuel dans `public/archives/AAAA-MM.json`.

## Droits et citation

- On publie uniquement : titre, émetteur, date, lien, résumé rédigé avec nos mots. Jamais le texte intégral ni de longs extraits d'un article de presse.
- Mention visible de la source sous chaque article (exigée notamment par le BOFiP).
- Respect du `robots.txt` et des conditions d'utilisation de chaque site et API.

## Écrans

- **Brief du jour** (accueil) : les 5 articles d'importance 4 ou 5 les plus récents, tous thèmes confondus, plus la prochaine échéance du PLF et du PLFSS.
- **Veille** : fil filtrable par thème, source, importance et public ; recherche locale ; marquage « lu » et « important pour nos dossiers » en local.
- **Suivi PLF / PLFSS** : frise des étapes alimentée par `suivi_texte`, avec liens vers les dossiers législatifs.
- **Indicateurs** : tuiles (valeur, variation, période, source, date) pour les indicateurs clés.
- **Rennes et Bretagne** : fil dédié et, si la couche B BODACC est active, compteurs hebdomadaires des créations et procédures collectives en Ille-et-Vilaine.
- **État des sources** : tableau de `veille-etat.json` (dernière réussite, erreurs, nombre d'articles, coût de la couche C du jour et du mois).

## État de réalisation (08/10/2026)

| Élément | État |
|---|---|
| Diagnostic des sources (`npm run veille:test`, workflow `veille-diagnostic.yml`) | Fait |
| Couche A (flux RSS/Atom, page du dossier PLF) | Fait |
| Couche B (API PISTE, INSEE, Banque de France, BODACC) | À faire : les sources sont listées dans le catalogue et signalées « non configurées » |
| Couche C (recherche IA), contrôles, coûts et plafond | Fait |
| Notation groupée des articles de flux | Fait. Les articles notés 1 restent dans `news.json` (pour ne pas être renotés chaque jour) et sont masqués par défaut à l'écran |
| Fusion, 60 jours glissants, archives mensuelles | Fait |
| Workflow `veille.yml` | Fait |
| Écrans (brief, veille, suivi, indicateurs, Rennes, état des sources) | Fait. Compteurs BODACC en attente de la couche B |
