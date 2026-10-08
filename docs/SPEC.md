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
- Chiffres clés (onglet ouvert par défaut) : chiffre d'affaires, résultat de l'exercice, excédent brut d'exploitation, totaux des produits et des charges, soldes intermédiaires de gestion, comparaison N-1 ; pour rapprocher le FEC de la liasse.
- Balance générale (soldes d'ouverture, mouvements débit/crédit, solde de clôture) avec regroupement par classe et sous-classe, comparaison N-1 si un second FEC est chargé.
- Balance auxiliaire clients et fournisseurs.
- Grand-livre filtrable (compte, période, journal, montant, libellé).
- Statistiques : nombre d'écritures par journal et par mois, écritures le week-end ou un jour férié, montants ronds, écritures passées après la clôture, écritures manuelles d'OD sur comptes sensibles (trésorerie, chiffre d'affaires). Ces indicateurs servent de base aux tests sur les écritures de journal ; ils sont présentés comme des pistes, pas des conclusions.
- Exports `.xlsx` de chaque vue.
- Exports de la balance générale, des balances clients et fournisseurs et des SIG en tableaux croisés dynamiques (décision du 08/10/2026). Chaque classeur s'ouvre sur un onglet TCD (sommes, disposition compacte, niveaux repliables), suivi d'un onglet de données sources. Le cache du TCD s'actualise à l'ouverture et le résultat du TCD est déjà écrit dans les cellules. Les onglets détaillés sont conservés. TCD de la balance : classe → sous-classe → compte. TCD des balances auxiliaires : compte collectif → tiers. TCD des SIG : rubrique → compte, avec la contribution de chaque compte de gestion au résultat (produits positifs, charges négatives). ExcelJS ne gérant pas les TCD, les parties OOXML sont ajoutées au fichier (`src/modules/fec/export/tcd.ts`).

Règles précisées à l'étape 6 (08/10/2026) :
- **Soldes** : « ouverture » = lignes du journal d'à-nouveaux confirmé ; « mouvements » = toutes les autres lignes ; « clôture » = ouverture + débit − crédit. Montants en centimes, soldes signés débit − crédit, affichés avec le sens D / C.
- **Chiffres clés** (décision du 08/10/2026) : calculés sur les soldes de clôture. Chiffre d'affaires = solde créditeur des comptes 70. SIG du PCG : ventes de marchandises (707, 7097) − coût d'achat des marchandises vendues (607, 6087, 6097, 6037) = marge commerciale ; production vendue (70 hors 707, 7097) + stockée (71) + immobilisée (72, 73) = production de l'exercice ; − consommations en provenance des tiers (60 hors marchandises, 61, 62) = valeur ajoutée ; + subventions (74) − impôts et taxes (63) − personnel (64) = EBE ; + autres produits et reprises (75, 781, 791) − autres charges et dotations (65, 681) = résultat d'exploitation ; financier (76, 786, 796 − 66, 686) ; exceptionnel (77, 787, 797 − 67, 687) ; − participation et IS (69). Le résultat de l'exercice est toujours classe 7 − classe 6 ; les comptes de gestion non couverts apparaissent sur une ligne « non classés ». Si tous les comptes 6 et 7 sont soldés et le compte 12 ne l'est pas, le résultat est lu au compte 12 ; sinon un solde du compte 12 est signalé pour rapprochement.
- **Tableau des flux de trésorerie** (décision du 08/10/2026) : présentation anglo-saxonne (IAS 7, méthode indirecte), comparée à N-1 si le FEC N-1 est chargé (calculé sur ce FEC, avec ses propres à-nouveaux). Trésorerie = classe 5 hors 59 (disponibilités, VMP, concours bancaires courants en négatif). Chaque compte hors trésorerie est rattaché à une rubrique, et la somme de ses contributions vaut −(clôture − ouverture). La somme des flux est donc égale à la variation de trésorerie ; un écart signale une balance déséquilibrée. Rattachements :
  - **Opérationnel** : résultat net (6, 7) ; dotations aux amortissements (crédits des 28) ; dépréciations et provisions (14, 15, 29, 39, 49, 59) ; élimination des résultats de cession (675, 775) ; = CAF ; stocks (3) ; clients (41) ; fournisseurs (40 hors 404, 405) ; fiscal et social (42 à 44) ; autres (46 hors 462, 47, 48, 1688, classes 8 et 9).
  - **Investissement** : acquisitions (débits du 2 hors 28, 29) ; prix de cession (775) ; dettes et créances sur immobilisations (404, 405, 462) ; autres mouvements (crédits du 2, débits du 28, 675, 105), nuls pour une cession normalement comptabilisée.
  - **Financement** : capital et apports (10 hors 105, 106) ; dividendes et distributions (106, 11, 12, 457) ; subventions d'investissement (13) ; nouveaux emprunts et remboursements (crédits et débits du 16 hors 1688) ; comptes courants et autres dettes financières (17, 18, 45 hors 457).
  - Si les comptes de gestion sont soldés dans le FEC, le résultat est repris du compte 12 en flux opérationnels.
- **Balance générale** : repliée par classe à l'ouverture ; classe = 1er chiffre du compte, sous-classe = 2 premiers chiffres ; contrôle d'équilibre des à-nouveaux, des mouvements et du solde global ; comparaison N / N-1 par compte (variation en valeur et en % du solde N-1, union des comptes des deux exercices).
- **Balance auxiliaire** : clients = comptes 41, fournisseurs = comptes 40 ; clé du tiers = CompAuxNum, sinon CompteNum ; soldes anormaux = clients créditeurs, fournisseurs débiteurs.
- **Balance âgée** : lignes non lettrées à la clôture (EcritureLet vide, ou DateLet postérieure à la clôture), datées au plus tard à la clôture ; ancienneté = clôture − PieceDate (EcritureDate si la pièce est absente ou postérieure) ; tranches 0-30, 31-60, 61-90, 91-180, 181-365 jours, plus d'un an. Pour les à-nouveaux, l'ancienneté part de la date portée par la ligne.
- **Grand-livre** : tri compte, à-nouveaux, date, ordre du fichier ; solde progressif par compte ; filtres compte (début du numéro), auxiliaire, journal, période, montant (débit ou crédit de la ligne), texte (libellé, pièce, libellés de compte et de tiers, sans casse ni accents), lettrage ; affichage virtualisé ; un clic ouvre l'écriture complète. Export limité à 200 000 lignes (au-delà, affiner les filtres).
- **Statistiques** (hors à-nouveaux) : week-end ; jours fériés légaux français (Pâques, Ascension, Pentecôte calculées) ; datées et validées après la clôture ; montants ronds = ligne multiple de 1 000 € et d'au moins 1 000 € ; OD sensibles = journal d'OD (code OD, DIV… ou libellé « opérations diverses ») mouvementant un compte 51, 53, 54, 58 (trésorerie) ou 70 (chiffre d'affaires) ; libellés vides ou génériques (« divers », « régul », « OD »…, moins de 3 caractères) ; doublons probables = même journal, même pièce et même montant, ou même date, même tiers et même montant ; loi de Benford sur le premier chiffre des lignes d'au moins 10 €, écart absolu moyen et seuils de Nigrini (0,006 / 0,012 / 0,015), au moins 300 lignes ; fin de période = écritures datées dans les 5 jours avant ou après la clôture, d'un total au moins égal au 99e centile des écritures de l'exercice.

### 3.4 Interface avec le module Circularisations
`src/modules/fec/interface-circularisations.ts` (version `VERSION_INTERFACE_FEC`) expose, sans relire le FEC :
- `chargerDonneesFec(dossierId, role = 'N')` → `DonneesFec | null` ;
- `metadonnees` : dossier, SIREN, exercice, date de clôture, journal d'à-nouveaux (et s'il est confirmé), empreinte SHA-256, nom du fichier, nombres de lignes et d'écritures ;
- `soldesParCompte()` et `soldesParTiers(prefixes = ['40', '41'])` : ouverture, mouvements débit et crédit hors à-nouveaux, clôture, sens ;
- `comptesBancaires(prefixes = ['512', '514', '517', '519', '5186'])` : comptes présents dans le FEC, même soldés à la clôture, avec l'indicateur `mouvemente` ;
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
- Préfixes par défaut : 512, 514, 517, 519, 5186 (intérêts courus), 50 (valeurs mobilières, optionnel). Les emprunts auprès des établissements de crédit (164) ne sont pas retenus (décision du 08/10/2026) ; la lettre aux banques demande néanmoins les emprunts et concours.
- Tous les comptes sont sélectionnés, y compris ceux dont le solde est nul à la clôture mais qui ont enregistré des mouvements dans l'exercice (compte clôturé en cours d'année).
- Regroupement par établissement : table de correspondance compte → établissement, proposée à partir du libellé et éditable. Une ligne de suivi par établissement, avec le détail des comptes.

**Clients**
- Préfixes par défaut : 411, 413, 416, 4191. Exclus par défaut : 418 (factures à établir).
- Critères combinables (un tiers peut cumuler plusieurs motifs) :
  - C1 Solde débiteur ≥ seuil.
  - C2 Mouvements débiteurs de l'exercice ≥ seuil.
  - C3 Solde anormal : solde créditeur (hors avances 4191 identifiées).
  - C4 Sélection aléatoire parmi les tiers non retenus par C1 à C3 et dont le solde n'est pas nul, nombre de tirages paramétrable.
  - C5 Ajout ou exclusion manuelle, justification obligatoire.

**Fournisseurs**
- Préfixes par défaut : 401, 403, 404, 405, 4091. Exclus par défaut : 408 (factures non parvenues).
- Critères :
  - F1 Solde créditeur ≥ seuil.
  - F2 Mouvements créditeurs de l'exercice ≥ seuil. Critère clé pour la recherche de passifs non comptabilisés : il retient aussi les fournisseurs à solde faible ou nul mais à fort volume.
  - F3 Solde anormal : solde débiteur (hors avances 4091 identifiées).
  - F4 Sélection aléatoire parmi les non retenus.
  - F5 Ajout ou exclusion manuelle, justification obligatoire.

**Règles précisées à l'étape 7 (08/10/2026)**
- Seuils par défaut : C1 / F1 = 50 % du SP, C2 / F2 = 100 % du SP (modifiables, en euros ou en % du SP ; un critère en % du SP reste inopérant tant que le SP n'est pas saisi).
- C3 / F3 : le test du solde anormal porte sur le solde du tiers **hors comptes d'avances** (4191, 4091) ; le solde présenté et circularisé reste le solde total.
- C4 / F4 : tirage **uniforme sans remise** (mulberry32, mélange de Fisher-Yates) parmi les tiers non retenus par les critères 1 à 3 et à solde non nul, triés par clé ; graine propre à chaque population dérivée de la graine du dossier. Les décisions manuelles s'appliquent après le tirage et ne le modifient pas.
- C5 / F5 : une décision par tiers (la dernière l'emporte), justification obligatoire ; une exclusion conserve les motifs pour la traçabilité (onglet « Décisions manuelles » de l'export).
- Banques : comptes des préfixes bancaires présents dans le FEC (à-nouveaux ou mouvements), même soldés ; établissement proposé d'après le libellé du compte (« À préciser » sinon), modifiable ; une ligne de suivi par établissement.
- Toute modification des paramètres remet la sélection à l'état « non arrêtée » ; « Arrêter la sélection » fixe la date et l'heure reprises dans l'export.

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
| Solde confirmé par le tiers | à compléter, en valeur absolue |
| Sens confirmé | liste D / C, prérempli avec le sens comptable (décision du 08/10/2026) |
| Écart | formule : solde confirmé signé (C = négatif) − solde comptable signé |
| Écart justifié | à compléter |
| Nature de la justification | liste : Décalage de règlement, Cut-off facturation, Litige, Erreur du tiers, Erreur comptable, Autre |
| Écart non justifié | formule : écart − écart justifié |
| Procédure alternative | description (règlements postérieurs, factures, bons de livraison) |
| Réf. feuille de travail | à compléter |
| Commentaire | libre |
| Préparé par | initiales |
| Revu par | initiales |

Mises en forme : en-têtes figés, filtres, listes déroulantes de validation, mise en évidence conditionnelle des écarts non justifiés supérieurs au SAI et des demandes sans réponse.

Onglet Synthèse (formules vivantes) : par population, nombre de demandes, taux de réponse, couverture en valeur des réponses obtenues, total des écarts, total des écarts non justifiés comparé au SAI.

Onglet Paramètres : SS, SP, SAI, seuils par critère, graine, date et heure de sélection, version de l'outil, nom du fichier FEC et son empreinte SHA-256 (pour prouver quel fichier a servi, sans le contenu).

### 4.5 Courriers
- Génération `.docx` (librairie `docx`) des lettres de demande de confirmation, un modèle par population, à partir du tableau de suivi.
- Modèles éditables (en-tête du client, signataire, adresse de réponse du cabinet, date de clôture, mention « solde ou relevé de compte »).
- Option de lettre « à solde non indiqué » ou « à solde indiqué » selon la population.
- Export en lot (un fichier par tiers dans une archive, ou un document unique pour impression).

Règles retenues à l'étape 8 (décisions du 08/10/2026) :
- Une lettre par demande du tableau de suivi, avec la même référence : une par établissement bancaire (BQ-…), une par client (CL-…) et par fournisseur (FO-…) retenu. Les lettres sont générées depuis la sélection en cours ; un avertissement s'affiche tant que la sélection n'est pas arrêtée (les références peuvent encore changer).
- Lettre sur papier à en-tête du client, signée par son dirigeant (nom et qualité saisis par dossier), réponse adressée directement au cabinet (nom, adresse de réponse, e-mail facultatif). Pour les banques, la lettre autorise expressément l'établissement à répondre au cabinet.
- Bloc adresse du destinataire : nom du tiers ou de l'établissement seulement, adresse laissée vide et complétée dans Word (le FEC ne contient pas d'adresses).
- Solde non indiqué par défaut pour toutes les populations. Banques : toujours non indiqué (demande ouverte : soldes de tous les comptes y compris clôturés, emprunts et concours, engagements hors bilan, effets escomptés et Dailly, titres en dépôt, personnes habilitées ; rappel facultatif des comptes enregistrés, numéro et libellé, sans solde). Clients et fournisseurs : option « solde indiqué » (montant en valeur absolue, « en notre faveur » si le solde est débiteur, « en votre faveur » s'il est créditeur), et demande au choix : confirmation du solde, relevé de compte, ou les deux (par défaut). Une demande de relevé seul n'indique jamais le solde.
- Coupon-réponse facultatif (par défaut pour clients et fournisseurs), sur une page séparée : accord / désaccord à cocher pour une lettre à solde indiqué, solde à compléter sinon, case « relevé joint », date, signataire, cachet.
- Modèles et coordonnées du cabinet communs à tous les dossiers du poste ; en-tête, signataire, date des lettres (par défaut : jour de l'export) et date limite de réponse (par défaut : « dans les meilleurs délais ») propres au dossier. Stockage IndexedDB (base version 3) ; « Purger ce dossier » efface les réglages du dossier, « Tout purger » efface aussi les modèles.
- Texte des modèles : texte simple, paragraphes séparés par une ligne vide, « - » pour une puce, variables entre accolades (`{societe}`, `{tiers}`, `{code_tiers}`, `{reference}`, `{date_cloture}`, `{cabinet}`, `{contact_reponse}`, `{delai_reponse}`, `{phrase_solde}`, `{phrase_demande}`, `{solde}`, `{sens_solde}`, `{comptes_banque}`) ; un paragraphe vide après remplacement est supprimé ; une variable inconnue reste visible. Bouton « Rétablir le texte par défaut ».
- Export : archive `.zip` d'un `.docx` par lettre, nommé `{Réf.} - {tiers}.docx`, ou document unique (une section par lettre, coupon sur page séparée). Lettres choisies par population ou une à une.

## 5. Cadrage de TVA

Module `src/modules/tva/`. Il consomme les données normalisées du module FEC (jamais le fichier) et les déclarations CA3 déposées par le collaborateur. Tout le traitement se fait dans le navigateur ; les PDF ne sont ni envoyés ni conservés (seules les valeurs lues, les corrections et l'empreinte SHA-256 de chaque PDF sont enregistrées dans IndexedDB, magasin `tva`, base version 4).

Périmètre prioritaire : TVA collectée des sociétés de prestations de services et de travaux, au régime des encaissements. Les livraisons de biens (régime des débits), les régimes mixtes et la TVA déductible viendront ensuite.

### 5.1 Lecture des CA3 (partie 1, 08/10/2026)
- **Extraction** : pdfjs-dist 6.3 (Apache-2.0), chargé à la demande, analyse du PDF dans son worker servi depuis la même origine. Les options désactivent WebAssembly, les polices système, XFA et les scripts du document, et aucune ressource n'est téléchargée : la CSP est inchangée. La version 5.x a été écartée à cause d'une faille d'exécution de code à l'ouverture d'un PDF malveillant (GHSA-hq66-cqwq-w95j, corrigée en 6.2.108).
- **Lecture par position** (`ca3/analyse.ts`), jamais par l'ordre du texte :
  - les éléments de texte sont découpés en mots, avec une abscisse estimée pour chaque mot ;
  - les mots sont regroupés en lignes visuelles (ordonnée proche), puis en cellules (un écart supérieur à 1,2 fois la taille de police sépare deux cellules) ;
  - le code de case est le premier mot de la ligne, dans la colonne des codes de la page ;
  - un montant est une cellule purement numérique (euros entiers ; espace, espace insécable ou espace fine comme séparateur de milliers) située dans la zone des montants ;
  - après les en-têtes « Base hors taxe » et « Taxe due », reportés d'une page à l'autre, un montant est affecté à la colonne dont l'en-tête est le plus proche ; avant ces en-têtes (section A), la zone des montants est la moitié droite de la page ;
  - les montants d'une ligne sans code (libellé sur plusieurs lignes) vont à la case précédente si elle n'en a pas encore ; une ligne « dont … » sans code n'est jamais rattachée, et son montant est signalé en information.
- **Identification** : dénomination, SIREN, période déclarée, date limite de dépôt, date de dépôt, date de création du document, millésime (année de la mention « 3310-CA3 … applicable à compter du … »).
- **Table des cases** (`ca3-cases.ts`) : code, libellé, section, nombre de colonnes, taux, millésimes. Elle est établie d'après les formulaires officiels 2025 (cerfa 10963*30) et 2026 (10963*31), qui comportent les mêmes cases. Un millésime absent de la table, comme une case inconnue, est accepté avec un avertissement ; les montants d'une case inconnue sont conservés sans être contrôlés.
- **Contrôles de chaque déclaration** (anomalies non bloquantes) :
  - 16 = somme des taxes de 08 à I6 + 15 + 5B ;
  - 23 = 19 + 20 + 21 + 22 + 2C ;
  - TD = 16 − 23 sans crédit, ou 25 = 23 − 16 sans TVA due ;
  - 27 = 25 − 26 ;
  - 28 = TD − X5 ;
  - 32 = 28 + 29 + Z5 − AB ;
  - base × taux ≈ taxe pour chaque taux connu, à 1 € près ;
  - opérations taxées (A1 à A5, B1 à B5) = somme des bases des lignes de taux, à 1 € près (avertissement).
- **Contrôles de la série** :
  - même SIREN dans toutes les déclarations ;
  - périodicité détectée (mensuelle, trimestrielle ou mixte) ;
  - périodes consécutives, sans trou, chevauchement ni doublon ;
  - report du crédit : ligne 22 = ligne 27 de la période précédente ;
  - dépôt après la date limite signalé.
- **PDF illisible** (scanné, image, PDF invalide) : saisie manuelle dans une grille des cases utiles. Pas d'OCR.
- **Écran** :
  - dépôt en lot dans n'importe quel ordre, tri par période ; un PDF déjà déposé (même empreinte) est ignoré ;
  - tableau « case par période » des cases servies au moins une fois, avec total et ligne « TVA collectée déclarée » ;
  - correction d'une valeur avec motif obligatoire, tracée (valeur lue, nouvelle valeur, date, motif), affichée en couleur et annulable ;
  - liste des contrôles et des fichiers, avec leur empreinte.
- **CA3 fictives** : `npm run ca3:fictives` (pdf-lib en dépendance de développement), décrites dans `tests/fixtures/ca3/README.md`.
- **Robustesse** (08/10/2026) :
  - la lecture est aussi éprouvée sur des CA3 fictives imprimées par Chromium (« Imprimer en PDF », avec les en-têtes et pieds de page du navigateur) et par LibreOffice (`npm run ca3:navigateurs`) ;
  - elle est testée sur des pages déformées : en-têtes de colonnes absents (colonnes alors déduites des lignes de taux à deux montants) ou renommés (« Base HT », « Montant de la taxe »), montants suivis de « € », texte découpé caractère par caractère, autre échelle, numéros de page isolés ;
  - l'identification tolère les libellés coupés sur deux lignes ;
  - une ligne sans code n'est rattachée à la case précédente que si elle en est proche (au plus trois lignes), jamais un pied de page.

### 5.2 Récapitulatif déclaré (G300)
Le tableau croise les cases et les CA3 de l'exercice, avec un total annuel. Seules les cases servies au moins une fois sont affichées, dans l'ordre suivant :
1. opérations (A1, A2, E1, E2, F2, puis les autres cases servies) ;
2. base puis taxe de chaque taux servi ;
3. ligne « TVA collectée déclarée » = somme des taxes des lignes 08 à 13, T1 à TC, P1, P2, I1 à I6 ;
4. lignes 15, 5B et 16, présentées à part ;
5. TVA déductible (19, 20, 21, 22, 2C, 23) ;
6. 25, TD, 27, 28, 32, puis les autres cases servies.

Le même tableau sert à la vérification : un clic sur une valeur la corrige, avec traçabilité. Les déclarations retenues sont celles dont la période est comprise dans l'exercice du FEC ; les autres sont signalées, de même que les mois de l'exercice non couverts.

### 5.3 TVA collectée théorique (G340)
Interface FEC dédiée : `src/modules/fec/interface-tva.ts`. Elle fournit la balance, les mouvements mensuels, l'observation des écritures de vente et les lignes de détail.

Le module TVA est indépendant du module Circularisations, qui relève du commissariat aux comptes : il n'en lit ni les paramètres (SS, SP, SAI) ni les données. Les métadonnées communes du dossier FEC sont dans le fichier neutre `src/modules/fec/dossier-fec.ts`.

**Paramètres du dossier** (IndexedDB, avec les déclarations) :
- régime d'exigibilité : encaissements par défaut, débits, ou mixte avec un régime par compte ;
- collaborateur ;
- préfixes : produits (70 ; 75, 77 ou comptes précis sélectionnables), TVA collectée observée (4457, 44587), encours (clients 411 et 413, douteux 416, avances 4191, FAE 418, PCA 487), pertes (654), TVA autoliquidée sur achats (4452) ;
- réglages par compte, ventilation et justifications.

**1. Chiffre d'affaires par compte.** Il correspond aux mouvements de l'exercice hors à-nouveaux. Le taux est proposé dans l'ordre suivant :
- **(a) taux observé :** dans chaque écriture qui mouvemente le compte, la TVA des comptes 4457 et 44587 est rapprochée du HT, avec une tolérance de 2 centimes par ligne ou 0,1 % ;
- **(b) indice dans le libellé :** « 20 % », « 5,5 », « AUTO LIQ », « EXO », « EXPORT », « UE » ;
- **(c) saisie.**

Règles complémentaires :
- un compte vendu à plusieurs taux est réparti au prorata des montants observés ;
- les ventes sans TVA, c'est-à-dire avec un compte 41 mouvementé, forment le CA exonéré ;
- les écritures sans client ni TVA (extournes, PCA) ne sont pas prises pour des ventes exonérées ;
- colonnes : N° de compte, libellé, CA HT, CA exonéré, % du CA soumis, CA imposable, taux, montant de TVA, case CA3 (20 % : 08, 10 % : 9B, 5,5 % : 09, 2,1 % : T6, 8,5 % : 10, 13 % : TC ; autoliquidation et exonérée : E2, exportation : E1, livraison intracommunautaire : F2).

**2. Régularisations au régime des encaissements.** Pour chaque catégorie d'encours, la régularisation vaut la TVA comprise dans les soldes N-1 moins celle comprise dans les soldes N, ventilée par taux. Les soldes sont signés, débit positif.
- **Calcul de la TVA comprise :** TTC / (1 + taux) × taux pour les clients, les clients douteux, les avances et les factures à établir ; HT × taux pour les produits constatés d'avance.
- **Soldes N :** lus dans le FEC.
- **Soldes N-1 :** pré-remplis depuis le FEC N-1 s'il est chargé, sinon depuis les à-nouveaux ; ils restent modifiables, et la source est affichée.
- **Ventilation par taux :**
  - par défaut, au prorata du chiffre d'affaires TTC de chaque taux, non imposable compris (HT pour les PCA et les pertes) ;
  - sinon saisie en montants, pour chaque solde (N-1 et N), par exemple d'après les factures ouvertes. Le mélange des taux diffère en effet souvent entre N-1 et N ;
  - un écart avec le solde est porté au taux principal et signalé, et la méthode est affichée.
- **Pertes sur créances irrécouvrables (654) :** la TVA est retranchée, sur une ligne dédiée.
- **TVA autoliquidée sur achats (crédits 4452) :** elle est ajoutée, car elle est comprise dans la TVA collectée déclarée (ligne 08 et suivantes).
- **Régime des débits :** pas de régularisation des encours.
- **Régime mixte :** les régularisations portent sur la part du chiffre d'affaires des comptes au régime des encaissements ; c'est une approximation affichée.

**3. Résultat.** TVA théorique = TVA sur le CA imposable + régularisations ; écart = théorique − déclarée.

**4. Synthèse par taux.** Elle reprend les colonnes Ventes, TVA, Régularisations et Montant à déclarer, puis les rapproche de la CA3 :
- pour un taux imposable, la base théorique encaissée (montant à déclarer / taux) est comparée à la base déclarée, et la taxe à la taxe déclarée ;
- pour la principale nature non imposable, la base théorique est égale aux ventes + encours N-1 − encours N.

### 5.4 Cadrage et justification
- **Vue par période de déclaration**, mensuelle ou trimestrielle. Pour chaque période :
  - TVA collectée déclarée ;
  - TVA comptabilisée au crédit des 4457 sur les mêmes mois, et TVA autoliquidée au crédit de 4452 ;
  - écart ;
  - CA déclaré (A1, A2, E1, E2, E3, F2, F3) et CA comptabilisé, avec leur écart.
- **Décalage déclaratif :** la CA3 d'une période, déposée le mois suivant, est rapprochée des écritures de la période elle-même (date de dépôt affichée). Les mois sans déclaration sont présentés à part.
- **Contrôles complémentaires :**
  - crédits de 4455 = somme des lignes 28 ;
  - solde de 4455 à la clôture = ligne 28 de la déclaration qui se termine à la clôture ;
  - solde de 44567 = ligne 27 de cette déclaration ;
  - au régime des encaissements, solde des comptes de TVA collectée (4457, 44587) = TVA comprise dans les encours N.
- **Justification :** lignes libres (libellé avec exemples proposés, montant, commentaire, référence de pièce). Pas de seuil : l'écart et l'écart résiduel non justifié sont affichés tels quels, et mis en évidence dès qu'ils ne sont pas nuls. Les paramètres enregistrés avec un seuil (version 1) sont convertis à la lecture (version 2, seuil retiré).
- **Détail des écritures :** chaque montant calculé (CA par compte, soldes N, TVA du mois, CA du mois, contrôles) ouvre les lignes du FEC qui le composent, dans la limite de 2 000 lignes affichées, avec le total.

### 5.5 Export Excel
Classeur ExcelJS avec des formules vivantes. Chaque formule porte son résultat pour l'aperçu, et le recalcul complet à l'ouverture est demandé.
- **« G300 Récap TVA » :** totaux en formules ; la TVA collectée déclarée est la somme des lignes de taxe (nom défini `TVA_DECLAREE`).
- **« G340 Contrôle TVA collectée » :**
  - en-tête : Entreprise, Exercice, Date, Collaborateur, Chap. G 340 ;
  - ventes par compte : CA imposable = CA − exonéré, TVA = ROUND(imposable × taux) ;
  - régularisations par catégorie et par taux, avec les formules TTC / (1 + taux) × taux ;
  - synthèse par taux (SUMIFS) ;
  - TOTAL, TVA déclarée liée par formule à la feuille G300, ÉCART ;
  - tableau de justification, et écart résiduel non justifié, mis en évidence s'il n'est pas nul (mise en forme conditionnelle).
- **« Cadrage mensuel » :** écarts en formules, plus les contrôles complémentaires.
- **« Anomalies CA3 » :** anomalies, puis corrections tracées.
- **« Paramètres » :** régime, méthode de ventilation, préfixes, empreintes SHA-256 du FEC et de chaque PDF, date, version de l'outil.

Les formules sont vérifiées par un recalcul réel avec LibreOffice, après modification de saisies dans le classeur.

### 5.6 Données de test
- **CA3 fictives :** voir 5.1.
- **FEC fictifs de la même société** (`npm run tva:fictifs`, `tests/fixtures/tva/README.md`). Ils sont cohérents avec les CA3, et la TVA théorique est connue d'avance :
  - cas sans écart (0 € avec février corrigé) ;
  - écart de déclaration (+50 €, taxe 9B de février) ;
  - cut-off (−1 950 € : encaissement du 30/06 comptabilisé en N+1) ;
  - dans les deux FEC : autoliquidation des ventes (E2) et des achats (A3), FAE, PCA, perte sur créance.
