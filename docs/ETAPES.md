# Plan de construction — étape par étape

Chaque étape = une session Claude Code. Colle le prompt, laisse Claude proposer un plan (mode plan), valide, puis laisse-le coder. Teste toi-même avec la liste « À vérifier » avant de passer à la suite.

---

## Étape 0 — Préparer le poste et le dépôt (sans Claude Code)

### À valider avec l'informatique
- **Git for Windows** : nécessaire pour versionner et pousser sur GitHub. Recommandé aussi par Claude Code sous Windows.
- **Node.js LTS** : nécessaire sur **ton poste uniquement** pour développer et tester (Vite, tests). Tes collègues n'en ont pas besoin : ils utilisent juste le site. Si refusé, dis-le à Claude Code à l'étape 1 : il basculera sur une version sans outil de build.
- **Claude Code** : s'installe sans droits administrateur.

### Compte et crédits
1. Connecte-toi à la Console Claude (console.anthropic.com) avec le compte qui porte tes crédits en dollars.
2. Fixe une limite de dépense mensuelle dans les paramètres de facturation, pour ne jamais avoir de surprise.

### Installer Claude Code
Dans PowerShell (invite `PS C:\...`) :
```powershell
irm https://claude.ai/install.ps1 | iex
```
Ouvre un nouveau terminal, puis vérifie :
```powershell
claude --version
```
Au premier lancement de `claude`, choisis la connexion avec ton compte **Console** (facturation à l'usage sur tes crédits), pas un abonnement claude.ai.

### GitHub
1. Active la **double authentification** sur ton compte personnel (photo de profil > Settings > Password and authentication). C'est un prérequis pour l'exiger dans l'organisation.
2. Crée l'**organisation** : photo de profil > Settings > Organizations > **New organization** > offre **Free**. Nom conseillé : `pole-003` (il fixe l'adresse de l'outil). Choisis « My personal account » comme propriétaire.
3. Exige la double authentification : page de l'organisation > Settings > Authentication security > cocher « Require two-factor authentication for everyone in your organization » > Save.
4. Crée dans l'organisation un dépôt **public** vide nommé `sandbox` (« + » > New repository, propriétaire `pole-003`). Adresse de l'outil : `https://pole-003.github.io/sandbox`.
5. Dans le dépôt : Settings > Pages > Source : **GitHub Actions** (le workflow de l'étape 1 s'occupera du reste).
6. Clone le dépôt sur ton poste, dans un dossier hors de tout répertoire contenant des données clients, copie-y `CLAUDE.md`, `docs/SPEC.md` et `docs/ETAPES.md`, puis lance `claude` depuis ce dossier.

**Règles :**
- La sandbox est le seul site GitHub Pages de l'organisation. Les autres dépôts (sans Pages) ne posent pas de problème.
- Ne renomme pas l'organisation ni le dépôt : l'adresse changerait et les collègues perdraient leurs dossiers en cache.
- **Continuité :** invite un second propriétaire (organisation > People > Invite member > rôle **Owner**), par exemple un associé. Il lui faut un compte GitHub avec double authentification ; rien d'autre au quotidien.

---

## Étape 1 — Socle, sécurité et déploiement

**Prompt :**
> Lis CLAUDE.md et docs/SPEC.md. Mets en place le socle du projet : Vite + TypeScript strict, structure `src/modules/`, coque d'interface (barre latérale avec Accueil, Veille, FEC, Circularisations, Stocks et TVA grisés « bientôt », en-tête avec badge « 100 % local », numéro de version), thème clair et sombre, CSP de production, script `check:securite`, Vitest configuré, `.gitignore` protecteur, workflow GitHub Actions qui déploie `main` sur GitHub Pages et `beta` dans un sous-dossier `/beta`. Propose d'abord ton plan et la charte graphique (couleurs, typographie) avant de coder.

**À vérifier :**
- Le site s'ouvre en ligne sur l'adresse GitHub Pages.
- F12 > Réseau : après chargement, plus aucune requête.
- F12 > Console : taper `fetch('https://example.com')` doit être bloqué par la CSP.
- Mode avion après chargement : la navigation entre écrans fonctionne.

---

## Étape 2 — Animation « Pôle 003 - Bienvenue » et accueil

**Prompt :**
> Implémente la section 1 de docs/SPEC.md. Propose-moi d'abord 2 ou 3 variantes de l'animation sous forme de maquettes rapides que je peux comparer dans le navigateur, puis développe celle que je choisis. Respecte les contraintes de durée, de saut et de `prefers-reduced-motion`.

**À vérifier :**
- Animation fluide, passable d'un clic, jouée une seule fois par jour.
- Prénom demandé au premier lancement puis mémorisé.

---

## Étape 3 — Veille

La veille se construit en trois sessions. La référence est `docs/VEILLE.md`, le catalogue `veille/sources.json`, les réglages `veille/config.json`.

### Étape 3a — Collecte par flux (couche A) et écrans

**Prompt :**
> Lis docs/VEILLE.md, veille/sources.json et veille/config.json : ils font foi pour la veille et remplacent la section 2 de docs/SPEC.md.
>
> Important : n'essaie pas de valider les sources avec tes propres outils de navigation web. Plusieurs sites officiels bloquent ce type d'accès ou génèrent leurs liens en JavaScript, et c'est ce qui faisait échouer les tentatives précédentes. Les URL du catalogue ont déjà été trouvées. À la place, écris un script `npm run veille:test` qui interroge chaque source du catalogue depuis la machine (et plus tard depuis GitHub Actions) et produit un rapport : statut HTTP, type de contenu, encodage détecté, nombre d'éléments, date du plus récent, erreurs. Lance-le, montre-moi le rapport, et mets à jour le champ `statut` du catalogue en conséquence.
>
> Ensuite, implémente la couche A : parseur RSS/Atom tolérant (encodage déclaré faux, dates mal formées ou absentes, liens http), isolation stricte de chaque source (délai maximal, nouvelles tentatives, aucune source ne fait échouer l'ensemble), filtrage par mots-clés pour les flux volumineux, déduplication, `public/news.json` et `public/veille-etat.json`. Crée le workflow GitHub Actions `veille.yml` (jours ouvrés à 6 h 30 heure de Paris, plus déclenchement manuel) qui exécute la collecte et publie le résultat. Enfin, les écrans décrits en fin de docs/VEILLE.md : Brief du jour sur l'accueil, Veille, Suivi PLF/PLFSS, Indicateurs (vides pour l'instant), Rennes et Bretagne, État des sources. Tests unitaires sur des flux d'exemple enregistrés dans `tests/fixtures/veille/` (y compris un flux du Sénat avec son encodage trompeur).

**À vérifier :**
- Le rapport `veille:test` liste les sources qui fonctionnent et celles en panne, avec la raison.
- Le workflow tourne (onglet Actions de GitHub) et met à jour `news.json`, même si une source est en panne.
- L'écran Veille charge uniquement `news.json` et `veille-etat.json` (onglet Réseau) ; les accents du Sénat s'affichent correctement.

### Étape 3b — Recherche IA quotidienne (couche C)

Prérequis : crée dans la Console Claude une clé API dédiée à la veille, avec sa propre limite de dépense mensuelle, puis ajoute-la dans GitHub : dépôt > Settings > Secrets and variables > Actions > New repository secret, nom `ANTHROPIC_API_KEY`.

**Prompt :**
> Implémente la couche C de docs/VEILLE.md : un appel à l'API Claude par thème avec l'outil de recherche web côté serveur, le prompt système et les consignes par thème décrits dans le document (à placer dans `veille/prompt-systeme.md` et `veille/themes.json` pour que je puisse les modifier sans toucher au code), le schéma JSON de réponse, les contrôles automatiques (validation du schéma, URL obligatoirement présentes dans les citations de l'outil, fenêtre de dates), le calcul du coût réel à partir du champ `usage`, le plafond `budget_mensuel_usd` suivi dans `veille/couts.json`, puis la fusion avec la couche A et la notation groupée des articles sans score. Vérifie dans la documentation officielle de l'API la version de l'outil `web_search` compatible avec les modèles de `veille/config.json`. La clé est lue depuis le secret `ANTHROPIC_API_KEY` ; si elle est absente, la couche C est sautée proprement. Ajoute un mode `npm run veille:essai -- --theme "Rennes et Bretagne"` qui exécute un seul thème et affiche le résultat et son coût, pour que je règle les consignes.

**À vérifier :**
- `veille:essai` sur chaque thème donne des articles récents, pertinents, avec des liens qui fonctionnent.
- Ouvre 5 liens au hasard : la source et la date correspondent au résumé.
- Le coût d'une journée complète, visible dans l'écran État des sources, reste cohérent avec ton budget.
- Le Suivi PLF/PLFSS affiche l'étape en cours et la prochaine échéance.

### Étape 3c — API officielles (couche B, optionnelle)

Prérequis : crée les comptes gratuits dont tu as besoin (PISTE pour Légifrance et Judilibre, portail des API de l'INSEE, Banque de France Webstat) et ajoute leurs identifiants en secrets GitHub, avec les noms indiqués dans `veille/sources.json`.

**Prompt :**
> Implémente la couche B de docs/VEILLE.md pour les sources de type `api` de veille/sources.json dont le secret est configuré : Légifrance (Journal officiel du jour, filtré), Judilibre (chambres commerciale et sociale), INSEE et Banque de France pour alimenter l'écran Indicateurs (propose-moi d'abord la liste des séries avec leur identifiant officiel dans `veille/indicateurs.json`), et BODACC pour l'Ille-et-Vilaine. Vérifie pour chacune l'URL officielle de l'API et ses conditions d'utilisation avant de coder. Quand une série officielle existe, elle remplace l'indicateur fourni par la couche C et le badge « à vérifier » disparaît.

**À vérifier :**
- Les tuiles Indicateurs affichent la bonne valeur, la bonne période et la source officielle.
- Une source dont le secret est absent apparaît « non configurée » dans État des sources, sans erreur.

---

## Étape 4 — Jeu de FEC fictifs (avant tout code d'analyse)

**Prompt :**
> Crée `scripts/generer-fec-fictifs.ts` qui produit dans `tests/fixtures/` des FEC entièrement fictifs couvrant toutes les variantes de la section 3.1 de docs/SPEC.md : tabulation, pipe, Montant/Sens (D/C et +1/-1), BNC de trésorerie, BA de trésorerie, XML, encodages UTF-8 avec et sans BOM, ISO-8859-15, Windows-1252, séparateur point-virgule. Prévois un FEC « propre » d'une PME de négoce (environ 20 000 lignes, avec banques, 150 clients, 80 fournisseurs, à-nouveaux, soldes anormaux, un compte bancaire clôturé en cours d'année) et des FEC « piégés » contenant chacun des anomalies connues et documentées. Ajoute un générateur de gros FEC (2 millions de lignes) pour les tests de performance.

**À vérifier :**
- Ouvrir 2 ou 3 fichiers générés dans un éditeur de texte : ils ressemblent à de vrais FEC.
- La liste des anomalies injectées est documentée dans `tests/fixtures/README.md`.

---

## Étape 5 — Import FEC et contrôle de conformité

**Prompt :**
> Implémente les sections 3.1 et 3.2 de docs/SPEC.md. Consulte l'article A47 A-1 du LPF et les sources publiques de Test Compta Demat (github.com/DGFiP/Test-Compta-Demat) pour établir la liste des règles et la structure exacte des variantes BNC/BA ; présente-moi cette liste de règles sous forme de tableau avant de coder. Le parsing tourne dans un Web Worker, en flux, avec barre de progression. Chaque règle a ses tests sur les FEC piégés de l'étape 4.

**À vérifier :**
- Chaque FEC piégé fait remonter exactement les anomalies attendues.
- Le gros FEC de 2 millions de lignes se charge sans figer le navigateur.
- Comparer le rapport sur un FEC fictif avec celui de Test Compta Demat (si l'outil officiel est installé sur un poste).

---

## Étape 6 — Analyses du FEC

**Prompt :**
> Implémente la section 3.3 de docs/SPEC.md : balance générale, balance auxiliaire, grand-livre filtrable, statistiques et exports .xlsx. Privilégie la lisibilité : tableaux denses mais aérés, montants alignés, totaux en pied de tableau.

**À vérifier :**
- La balance générale du FEC propre est équilibrée et correspond aux totaux calculés par le générateur.
- Les exports Excel s'ouvrent correctement et les montants sont des nombres, pas du texte.

---

## Étape 7 — Circularisations : sélection et tableau de suivi

**Prompt :**
> Implémente les sections 4.1 à 4.4 de docs/SPEC.md. Commence par la logique de sélection (pure, testée), puis l'écran de réglage des seuils avec recalcul instantané, puis l'export Excel du tableau de suivi avec formules, listes déroulantes et mises en forme conditionnelles. Vérifie la reproductibilité : même FEC + mêmes paramètres + même graine = même sélection.

**À vérifier :**
- Toutes les banques sont sélectionnées, y compris le compte clôturé en cours d'année.
- Un fournisseur à solde nul mais à gros volume ressort bien en F2.
- Les soldes anormaux (clients créditeurs, fournisseurs débiteurs) ressortent.
- Dans l'Excel : saisir un solde confirmé fait apparaître l'écart et met à jour la synthèse.
- Relancer la sélection avec la même graine redonne exactement la même liste.

---

## Étape 8 — Courriers de circularisation (plus tard)

**Prompt :**
> Implémente la section 4.5 de docs/SPEC.md. Propose d'abord les modèles de lettres par population et l'écran d'édition des modèles.

---

## Bonnes pratiques Claude Code

- **Une étape, une session.** Tape `/clear` entre deux étapes : le contexte repart léger, ce qui coûte moins cher et donne de meilleurs résultats.
- **Mode plan d'abord** (Maj+Tab) : Claude propose avant de modifier quoi que ce soit.
- **Commit après chaque étape validée**, sur `beta` d'abord, puis fusion dans `main` quand tu as testé.
- **Jamais de vrai FEC** dans le dossier du projet : ce que Claude Code lit est envoyé à l'API pour être traité. Teste les vrais fichiers toi-même dans le navigateur, sur le site déployé.
- **Surveille ta consommation** dans la Console (page d'utilisation) ; les étapes 5 et 7 seront les plus gourmandes.
- **Quand une règle métier te paraît fausse**, corrige d'abord `docs/SPEC.md`, puis demande à Claude de mettre le code en conformité avec la spec. La spec reste la référence.
