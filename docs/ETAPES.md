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

**Prompt :**
> Implémente la section 2 de docs/SPEC.md. Commence par vérifier, source par source, l'existence d'un flux RSS/Atom ou d'une API publique et ses conditions de réutilisation, et présente-moi un tableau récapitulatif avant de coder. Ensuite : script de collecte, workflow GitHub Actions planifié (jours ouvrés, tôt le matin, plus déclenchement manuel), génération de `public/news.json`, écran Veille et bloc « À la une » sur l'accueil. Pas de résumé par IA pour l'instant.

**À vérifier :**
- Le workflow tourne (onglet Actions de GitHub) et met à jour `news.json`.
- L'écran Veille charge uniquement `news.json` (onglet Réseau).
- Les sources sont mentionnées.

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
