# Spécification fonctionnelle — Sandbox Pôle 003

## 1. Accueil et animation « Pôle 003 - Bienvenue »

### Animation d'ouverture
- Une petite fusée traverse l'écran au lancement du site, par-dessus l'interface qui reste visible et utilisable (l'animation ne capte ni les clics ni le clavier).
- Trajectoire : entrée en bas à gauche, léger arc, sortie en haut à droite, nez orienté dans le sens du vol, flamme et traînée. Durée environ 1,6 s (2,5 s maximum).
- Jouée une fois par jour et par navigateur (date mémorisée en `localStorage`), désactivable dans les paramètres.
- Aucune animation si `prefers-reduced-motion` est actif.
- Dessin en SVG intégré au code, mouvement par la Web Animations API : aucune ressource externe, compatible avec la CSP sans la modifier.
- Historique : une première version plein écran (titre « Pôle 003 - Innovation », fusée et télescope) a été jugée trop chargée par l'utilisateur le 08/10/2026.

### Tableau de bord d'accueil
- Salutation personnalisée : « Bonjour {prénom} · jeudi 8 octobre 2026 » (prénom saisi au premier lancement, stocké en local).
- Badge permanent « 100 % local · aucune donnée envoyée ».
- Cartes d'accès aux modules, avec indication du dossier en cours.
- Bloc « À la une » : 3 dernières actualités de la veille.
- Liste des dossiers présents dans le cache local (nom, date de chargement, taille) avec purge.

## 2. Veille comptable, fiscale et économique

> **Remplacée par `docs/VEILLE.md`** (architecture en couches, sources, prompt, écrans), qui fait foi pour tout ce qui concerne la veille. Le texte ci-dessous est conservé pour mémoire.

> **Remplacée par `docs/VEILLE.md`**, qui fait foi (architecture en trois couches, catalogue de sources vérifiées, prompt de recherche IA, écrans). La suite de cette section est conservée pour mémoire.

### Principe
Information publique uniquement. Le navigateur ne contacte jamais les sites sources (règle CORS et règle de confidentialité). Un workflow GitHub Actions planifié collecte les flux, produit `public/news.json`, le commit, ce qui redéploie le site.

### Collecte (`scripts/veille/`)
- Exécution planifiée chaque jour ouvré tôt le matin, plus déclenchement manuel.
- Sources candidates (vérifier pour chacune l'existence d'un flux RSS/Atom ou d'une API publique et ses conditions de réutilisation avant de l'intégrer) :
  - BOFiP, flux « Actualités » (évolutions doctrinales) — mention de la source obligatoire.
  - Légifrance / Journal officiel (API PISTE, compte gratuit ; clé stockée en secret GitHub).
  - Conseil d'État, Cour de cassation (chambre commerciale), Conseil constitutionnel.
  - Assemblée nationale et Sénat (dossiers législatifs, en particulier projet de loi de finances et PLFSS).
  - ANC, CNCC, H3C, Ordre des experts-comptables.
  - INSEE, Banque de France (indicateurs économiques).
- Dédoublonnage, classement par thème (Fiscal, Comptable, Audit, Social, Économie, Jurisprudence, Loi de finances) par mots-clés.
- Option ultérieure : résumé de 2 phrases par article via l'API Claude (clé en secret GitHub, modèle léger, plafond de dépense). Le texte traité est public.

### Format `news.json`
```json
{
  "genere_le": "2026-10-08T05:30:00Z",
  "articles": [
    { "id": "hash", "titre": "...", "source": "BOFiP", "url": "https://...", "date": "2026-10-07", "theme": "Fiscal", "resume": "..." }
  ],
  "suivi_plf": { "texte": "PLF 2027", "etapes": [ { "libelle": "Dépôt", "date": "...", "statut": "fait" } ] }
}
```

### Écran
- Fil filtrable par thème et par source, recherche plein texte locale.
- Widget « Suivi du PLF » : frise des étapes (dépôt, 1re lecture AN, Sénat, CMP, lecture définitive, Conseil constitutionnel, promulgation). Alimenté manuellement dans un fichier `veille/suivi-plf.json` si aucune source automatique fiable.
- Liens externes ouverts dans un nouvel onglet avec `rel="noopener noreferrer"`. Un lien sortant ne transporte jamais de donnée de dossier.
- Marquage local « lu » et « important pour nos dossiers ».

## 3. Import et analyse de FEC

### 3.1 Formats à accepter
Référence : article A47 A-1 du LPF (Légifrance) et l'outil officiel DGFiP « Test Compta Demat » (sources publiques sur `github.com/DGFiP/Test-Compta-Demat`, licence CeCILL v2.1 : s'en inspirer pour la liste des règles ; ne pas copier de code sans vérifier la compatibilité de licence avec l'utilisateur).

| Variante | Détection |
|---|---|
| Fichier à plat, séparateur tabulation | ligne d'en-tête, comptage des tabulations |
| Fichier à plat, séparateur `|` | idem |
| BIC/IS standard, 18 zones Debit / Credit | noms de colonnes |
| BIC/IS avec `Montant` + `Sens` à la place de Debit/Credit (Sens `D`/`C` ou `+1`/`-1`) | noms de colonnes |
| BNC/BA en droit commercial | structure proche du standard |
| BA de trésorerie (21 zones : + DateRglt, ModeRglt, NatOp), BNC de trésorerie (22 zones : + IdClient) | présence de ces zones (A47 A-1 VIII 5° et 7°) |
| XML conforme aux XSD officiels (BIC/IS, BNC/BA droit commercial, BA trésorerie, BNC trésorerie) | racine `comptabilite` et schéma déclaré (`xsi:noNamespaceSchemaLocation`, sans espace de noms) |

Tolérances pratiques (import accepté mais signalé comme non-conformité) :
- Encodages UTF-8 avec ou sans BOM, ISO-8859-15, Windows-1252 ; détection automatique avec possibilité de forcer.
- Fins de ligne CR, LF, CRLF.
- Point-virgule ou virgule comme séparateur (export Excel), guillemets autour des champs.
- Point comme séparateur décimal, séparateurs de milliers, montants négatifs.
- Noms de colonnes avec casse ou accents différents, colonnes en trop.
- Compte auxiliaire absent mais tiers intégré au numéro de compte (ex. `411DUPONT`) : proposer une reconstruction de l'auxiliaire.

Contrôle du nom de fichier : `{SIREN}FEC{AAAAMMJJ}` (date de clôture) ; extraction du SIREN et de la date de clôture, modifiables par l'utilisateur.

### 3.2 Contrôle de conformité (inspiré de Test Compta Demat)
Chaque contrôle a : un code, un libellé, une gravité (Non conforme / Anomalie / Information), un nombre d'occurrences, la liste des lignes concernées (export possible), la source de la règle (« A47 A-1 », « Test Compta Demat », BOFiP ou « Contrôle d'audit complémentaire »).

**Le tableau détaillé des règles (codes S, D, L, E), validé le 08/10/2026, est dans `docs/fec-regles-conformite.md` ; il fait référence.** « Non conforme » signifie que Test Compta Demat rejetterait le fichier : l'utilisateur est averti mais l'import et les analyses restent possibles.

Structure et format :
- Nombre, noms et ordre des zones.
- Zones obligatoires renseignées (JournalCode, JournalLib, EcritureNum, EcritureDate, CompteNum, CompteLib, PieceRef, PieceDate, EcritureLib, Debit/Credit ou Montant/Sens, ValidDate).
- Dates au format `AAAAMMJJ` et valides ; montants numériques au format attendu.
- Cohérence des couples CompAuxNum / CompAuxLib, Montantdevise / Idevise, EcritureLet / DateLet.

Cohérence comptable :
- Équilibre débit = crédit par écriture (JournalCode + EcritureNum) et global.
- Équilibre par journal et par mois.
- Une ligne ne porte pas à la fois un débit et un crédit non nuls.
- Unicité du libellé pour un même CompteNum, un même JournalCode, un même CompAuxNum.
- Dates d'écriture comprises dans l'exercice ; ValidDate postérieure ou égale à EcritureDate ; écritures validées après la clôture signalées.
- Numérotation des écritures progressive et continue (trous et doublons listés).
- Présence et position des à-nouveaux.

Le rapport affiche en tête : « Contrôle indicatif. Seul l'outil officiel Test Compta Demat de la DGFiP fait foi » avec un lien vers la page de téléchargement officielle (`https://www.economie.gouv.fr/dgfip/outil-test-des-fichiers-des-ecritures-comptables-fec`).

Export du rapport de conformité en `.xlsx` (onglet synthèse + un onglet par contrôle en anomalie).

### 3.3 Analyses
- Balance générale (soldes d'ouverture, mouvements débit/crédit, solde de clôture) avec regroupement par classe et sous-classe, comparaison N-1 si un second FEC est chargé.
- Balance auxiliaire clients et fournisseurs.
- Grand-livre filtrable (compte, période, journal, montant, libellé).
- Statistiques : nombre d'écritures par journal et par mois, écritures le week-end ou un jour férié, montants ronds, écritures passées après la clôture, écritures manuelles d'OD sur comptes sensibles (trésorerie, chiffre d'affaires). Ces indicateurs servent de base aux tests sur les écritures de journal ; ils sont présentés comme des pistes, pas des conclusions.
- Exports `.xlsx` de chaque vue.

Règles précisées à l'étape 6 (08/10/2026) :
- **Soldes** : « ouverture » = lignes du journal d'à-nouveaux confirmé ; « mouvements » = toutes les autres lignes ; « clôture » = ouverture + débit − crédit. Montants en centimes, soldes signés débit − crédit, affichés avec le sens D / C.
- **Balance générale** : classe = 1er chiffre du compte, sous-classe = 2 premiers chiffres ; contrôle d'équilibre des à-nouveaux, des mouvements et du solde global ; comparaison N / N-1 par compte (variation en valeur et en % du solde N-1, union des comptes des deux exercices).
- **Balance auxiliaire** : clients = comptes 41, fournisseurs = comptes 40 ; clé du tiers = CompAuxNum, sinon CompteNum ; soldes anormaux = clients créditeurs, fournisseurs débiteurs.
- **Balance âgée** : lignes non lettrées à la clôture (EcritureLet vide, ou DateLet postérieure à la clôture), datées au plus tard à la clôture ; ancienneté = clôture − PieceDate (EcritureDate si la pièce est absente ou postérieure) ; tranches 0-30, 31-60, 61-90, 91-180, 181-365 jours, plus d'un an. Pour les à-nouveaux, l'ancienneté part de la date portée par la ligne.
- **Grand-livre** : tri compte, à-nouveaux, date, ordre du fichier ; solde progressif par compte ; filtres compte (début du numéro), auxiliaire, journal, période, montant (débit ou crédit de la ligne), texte (libellé, pièce, libellés de compte et de tiers, sans casse ni accents), lettrage ; affichage virtualisé ; un clic ouvre l'écriture complète. Export limité à 200 000 lignes (au-delà, affiner les filtres).
- **Statistiques** (hors à-nouveaux) : week-end ; jours fériés légaux français (Pâques, Ascension, Pentecôte calculées) ; datées et validées après la clôture ; montants ronds = ligne multiple de 1 000 € et d'au moins 1 000 € ; OD sensibles = journal d'OD (code OD, DIV… ou libellé « opérations diverses ») mouvementant un compte 51, 53, 54, 58 (trésorerie) ou 70 (chiffre d'affaires) ; libellés vides ou génériques (« divers », « régul », « OD »…, moins de 3 caractères) ; doublons probables = même journal, même pièce et même montant, ou même date, même tiers et même montant ; loi de Benford sur le premier chiffre des lignes d'au moins 10 €, écart absolu moyen et seuils de Nigrini (0,006 / 0,012 / 0,015), au moins 300 lignes ; fin de période = écritures datées dans les 5 jours avant ou après la clôture, d'un total au moins égal au 99e centile des écritures de l'exercice.

### 3.4 Interface avec le module Circularisations
`src/modules/fec/interface-circularisations.ts` (version `VERSION_INTERFACE_FEC`) expose, sans relire le FEC :
- `chargerDonneesFec(dossierId, role = 'N')` → `DonneesFec | null` ;
- `metadonnees` : dossier, SIREN, exercice, date de clôture, journal d'à-nouveaux (et s'il est confirmé), empreinte SHA-256, nom du fichier, nombres de lignes et d'écritures ;
- `soldesParCompte()` et `soldesParTiers(prefixes = ['40', '41'])` : ouverture, mouvements débit et crédit hors à-nouveaux, clôture, sens ;
- `comptesBancaires(prefixes = ['512', '514', '517', '519', '5186', '164'])` : comptes présents dans le FEC, même soldés à la clôture, avec l'indicateur `mouvemente` ;
- `ecrituresDuTiers(cle)` et `ecrituresDuCompte(compteNum)` : écritures complètes, pour les procédures alternatives.

## 4. Circularisations

### 4.1 Paramètres du dossier
Saisis par l'utilisateur et sauvegardés avec le dossier :
- Date de clôture (déduite du FEC, modifiable).
- Seuil de signification (SS), seuil de planification (SP), seuil des anomalies insignifiantes (SAI), en euros.
- Pour chaque population et chaque critère : seuil en euros ou en % du SP, activable/désactivable.
- Nombre de tirages aléatoires et graine (proposée automatiquement, modifiable).
- Préfixes de comptes par population (valeurs par défaut ci-dessous, modifiables).

### 4.2 Populations et critères

Clé du tiers : `CompAuxNum` s'il est renseigné, sinon `CompteNum`. Solde de clôture = à-nouveaux + mouvements de l'exercice. Les mouvements de l'exercice excluent le journal d'à-nouveaux.

**Banques (sélection exhaustive)**
- Préfixes par défaut : 512, 514, 517, 519, 5186 (intérêts courus), 164 (emprunts auprès des établissements de crédit), 50 (valeurs mobilières, optionnel).
- Tous les comptes sont sélectionnés, y compris ceux dont le solde est nul à la clôture mais qui ont enregistré des mouvements dans l'exercice (compte clôturé en cours d'année).
- Regroupement par établissement : table de correspondance compte → établissement, proposée à partir du libellé et éditable. Une ligne de suivi par établissement, avec le détail des comptes.

**Clients**
- Préfixes par défaut : 411, 413, 416, 4191. Exclus par défaut : 418 (factures à établir).
- Critères combinables (un tiers peut cumuler plusieurs motifs) :
  - C1 Solde débiteur ≥ seuil.
  - C2 Mouvements débiteurs de l'exercice (facturation) ≥ seuil.
  - C3 Solde anormal : solde créditeur (hors avances 4191 identifiées).
  - C4 Sélection aléatoire parmi les tiers non retenus par C1 à C3 et dont le solde n'est pas nul, nombre de tirages paramétrable.
  - C5 Ajout ou exclusion manuelle, justification obligatoire.

**Fournisseurs**
- Préfixes par défaut : 401, 403, 404, 405, 4091. Exclus par défaut : 408 (factures non parvenues).
- Critères :
  - F1 Solde créditeur ≥ seuil.
  - F2 Mouvements créditeurs de l'exercice (achats) ≥ seuil. Critère clé pour la recherche de passifs non comptabilisés : il retient aussi les fournisseurs à solde faible ou nul mais à fort volume.
  - F3 Solde anormal : solde débiteur (hors avances 4091 identifiées).
  - F4 Sélection aléatoire parmi les non retenus.
  - F5 Ajout ou exclusion manuelle, justification obligatoire.

### 4.3 Écran de sélection
- Réglage des seuils avec recalcul instantané.
- Indicateurs par population : nombre de tiers sélectionnés / total, couverture en valeur absolue des soldes (%), couverture des mouvements (%), nombre de soldes anormaux.
- Liste des tiers avec motifs sous forme d'étiquettes, tri et filtre, case à cocher pour l'ajout/exclusion manuel.
- Bandeau rappelant la graine et la date de sélection.

### 4.4 Tableau de suivi (export `.xlsx`)
Un onglet par population (Banques, Clients, Fournisseurs), un onglet Synthèse, un onglet Paramètres.

Colonnes :

| Colonne | Contenu |
|---|---|
| Réf. | identifiant de la demande (ex. CL-001) |
| Population | Banque / Client / Fournisseur |
| Compte(s) | CompteNum (et liste des comptes pour une banque) |
| Code tiers | CompAuxNum |
| Tiers / Établissement | libellé |
| Solde comptable au {date de clôture} | montant signé |
| Sens | D / C |
| Mouvements débit exercice | montant |
| Mouvements crédit exercice | montant |
| Motif(s) de sélection | C1, C2… avec libellé |
| Méthode | Exhaustive / Seuil / Aléatoire / Manuelle |
| Contact / adresse | à compléter |
| Date d'envoi | à compléter |
| Date de relance 1 | à compléter |
| Date de relance 2 | à compléter |
| Date de réponse | à compléter |
| Mode de réponse | Courrier / E-mail / Plateforme / Aucune |
| Statut | liste déroulante : À envoyer, Envoyé, Relancé, Réponse reçue, Sans réponse – procédure alternative |
| Solde confirmé par le tiers | à compléter |
| Écart | formule : solde confirmé − solde comptable (avec gestion du sens) |
| Écart justifié | à compléter |
| Nature de la justification | liste : Décalage de règlement, Cut-off facturation, Litige, Erreur du tiers, Erreur comptable, Autre |
| Écart non justifié | formule : écart − écart justifié |
| Procédure alternative | description (règlements postérieurs, factures, bons de livraison) |
| Réf. feuille de travail | à compléter |
| Commentaire | libre |
| Préparé par / Revu par | initiales |

Mises en forme : en-têtes figés, filtres, listes déroulantes de validation, mise en évidence conditionnelle des écarts non justifiés supérieurs au SAI et des demandes sans réponse.

Onglet Synthèse (formules vivantes) : par population, nombre de demandes, taux de réponse, couverture en valeur des réponses obtenues, total des écarts, total des écarts non justifiés comparé au SAI.

Onglet Paramètres : SS, SP, SAI, seuils par critère, graine, date et heure de sélection, version de l'outil, nom du fichier FEC et son empreinte SHA-256 (pour prouver quel fichier a servi, sans le contenu).

### 4.5 Plus tard : courriers
- Génération `.docx` (librairie `docx`) des lettres de demande de confirmation, un modèle par population, à partir du tableau de suivi.
- Modèles éditables (en-tête du client, signataire, adresse de réponse du cabinet, date de clôture, mention « solde ou relevé de compte »).
- Option de lettre « à solde non indiqué » ou « à solde indiqué » selon la population.
- Export en lot (un fichier par tiers dans une archive, ou un document unique pour impression).
