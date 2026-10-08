# Contrôle de conformité des FEC : règles et variantes de format

> **Validé au point d'arrêt 1 (08/10/2026).** Ce document est la référence des codes de règles utilisés par `src/modules/fec/` et par `tests/fixtures/fec/attendus.json`. Il complète la section 3.2 de `docs/SPEC.md`.

## Sources

- **Article A47 A-1 du LPF** : texte reproduit en annexe de la notice officielle « Mode d'emploi de l'outil Test Compta Demat », version 1.4 de mars 2021 (dépôt DGFiP). Légifrance oppose une vérification anti-robot à tout accès automatisé : **à confirmer à la main sur Légifrance** qu'aucune modification n'est intervenue depuis.
- **BOFiP BOI-CF-IOR-60-40-20** (« Format du fichier des écritures comptables », version en vigueur depuis le 07/06/2017), cité ci-dessous par numéro de paragraphe (§). Il précise la numérotation par journal (§ 100), les à-nouveaux enregistrés en cours d'exercice (§ 110), le sens de « à blanc si non utilisé » (§ 70), le remplissage de Debit et Credit (§ 210) et du Sens (§ 230), les devises (§ 260) et le découpage d'un exercice en plusieurs fichiers suffixés (§ 370).
- **Test Compta Demat** (dépôt `github.com/DGFiP/Test-Compta-Demat`, version 1_00_10b, licence CeCILL v2.1) : lu pour comprendre ses règles (scripts `init.pl`, `trt_entete.pl`, `trt_txt.pl`, `trt_xml.pl`, définitions SQL des tables FEC, fichier `fmt_arrete`, schémas XSD). Aucun code n'est repris.
- **Contrôles d'audit complémentaires** : section 3.2 de `docs/SPEC.md`.

## Gravités

Calquées sur le verdict de Test Compta Demat, pour que l'indicateur de l'outil soit lisible par rapport à l'outil officiel :

| Gravité | Signification | Correspondance Test Compta Demat |
|---|---|---|
| **Non conforme** | Test Compta Demat déclarerait le fichier non conforme, ou l'anomalie fausse les balances. **N'empêche jamais l'import ni l'exploitation du FEC** : l'utilisateur est averti et continue. | erreurs `E` (structure, format), `O` (zone absente), `V` (données absentes) |
| **Anomalie** | Non-conformité au texte ou incohérence à examiner, sans rejet par l'outil officiel. | anomalies `A`, règles du texte non contrôlées par l'outil |
| **Information** | Constat utile, toléré par le texte ou par l'outil officiel. | informations `I`, champs supplémentaires `S` |

Chaque constat liste les lignes concernées (numéro de ligne d'origine du fichier, en-tête = 1 ; pour le XML, rang de l'élément `<ligne>`). Les constats globaux (fichier, en-tête, totaux) n'ont pas de ligne.

## Règles

Écriture = lignes de même `JournalCode` + `EcritureNum` (SPEC 3.2). Mode de numérotation détecté automatiquement : **globale** (un numéro n'est utilisé que dans un seul journal, cas de Test Compta Demat) ou **par journal**.

### Structure du fichier (S)

| Code | Libellé | Gravité | Source | Méthode de détection |
|---|---|---|---|---|
| S01 | Nom de fichier non conforme à `{SIREN}FEC{AAAAMMJJ}` | Anomalie | A47 A-1 IX ; BOFiP § 370 | Expression `^\d{9}FEC\d{8}` en début de nom (suffixe toléré : `_01`, `_1T` pour un exercice découpé, BOFiP § 370) ; SIREN à 9 chiffres avec clé de Luhn ; date existante. |
| S02 | Séparateur de zones autre que tabulation ou « \| » | Non conforme | A47 A-1 VI 1° c ; Test Compta Demat (virgule et point-virgule refusés depuis 2013) | Séparateur détecté par comptage sur les 50 premières lignes (constance du nombre de zones). |
| S03 | Jeu de caractères non prévu (ni ASCII, ni ISO-8859-15, ni UTF-8) | Anomalie | A47 A-1 XII 1° | UTF-8 strict refusé et présence d'octets 0x80–0x9F (propres à Windows-1252). |
| S04 | Marque d'ordre des octets (BOM) UTF-8 en tête | Information | Test Compta Demat (BOM retiré silencieusement) | Octets `EF BB BF` en tête. |
| S05 | Première ligne sans nom des zones | Non conforme | A47 A-1 VII 4° / VIII 9° | Moins de trois cellules de la première ligne reconnues comme noms de zones ; ouverture de l'assistant de correspondance (les colonnes attribuées alors ne sont pas signalées en S08). |
| S06 | Zone réglementaire absente de l'en-tête | Non conforme | A47 A-1 VII 1°, VIII 3° à 8° ; Test Compta Demat (`O`) | Zones attendues selon le régime (18, 21 ou 22) non trouvées, même après normalisation. Une zone fournie par l'assistant de correspondance reste signalée. |
| S07 | Nom de zone reconnu malgré une casse ou des accents différents, ou variante officielle | Information | Test Compta Demat (comparaison insensible à la casse, « é/è » remplacés) ; XSD et BOFiP pour `CompteAuxNum` / `CompteAuxLib` | Nom différent de l'officiel, identique après mise en majuscules et suppression des accents, ou variante `CompteAuxNum` / `CompteAuxLib`. |
| S08 | Nom de zone reconnu par un alias (espaces, synonyme) | Non conforme | Test Compta Demat (zone considérée absente) | Correspondance trouvée seulement via la table d'alias (ex. `Compte Num`, `Libellé écriture`) ou l'assistant. `CompteAuxNum` et `CompteAuxLib` ne sont **pas** concernés : prévus par les schémas XSD et employés par le BOFiP (§ 160 et 170), ils relèvent de S07. |
| S09 | Ordre des zones différent de l'arrêté | Anomalie | A47 A-1 VII 1° (« dans l'ordre ») ; non contrôlé par Test Compta Demat | Rang de chaque zone réglementaire dans l'en-tête. |
| S10 | Zones supplémentaires | Information | A47 A-1 VII 1° (autorisées) ; Test Compta Demat (`S`) | Colonnes non reconnues ; listées par nom. |
| S11 | Nombre de zones d'une ligne différent de l'en-tête | Non conforme | Test Compta Demat (`E`) | Comptage par ligne ; les zones manquantes sont lues comme vides. |
| S12 | Ligne vide | Information | Test Compta Demat | Ligne sans aucun caractère hors blancs ; ignorée. |
| S13 | Séparateur en fin de ligne (zone vide fictive) | Information | Test Compta Demat (`I`) | En-tête terminé par un séparateur. |
| S14 | Zones entre guillemets | Anomalie | A47 A-1 XII 3° (aucun délimiteur prévu) | Guillemets ouvrants et fermants sur la majorité des zones ; retirés à la lecture. |
| S15 | Fichier sans écriture | Non conforme | Test Compta Demat | Aucune ligne de données. |
| S16 | XML non conforme au schéma officiel | Non conforme | A47 A-1 VI 2° ; Test Compta Demat (validation XSD) | Racine `comptabilite`, schéma déclaré, `exercice` / `DateCloture`, `journal` (JournalCode, JournalLib en BIC/IS), `ecriture` (zones obligatoires, au moins 2 `ligne`), `ligne` (CompteNum en BIC/IS, CompteLib, une seule zone Debit, Credit ou le couple Montant/Sens), selon le schéma déclaré (`formatA47A-I-VII-1`, `VIII-3`, `VIII-5`, `VIII-7`). Contrôle structurel, sans validateur XSD complet (l'ordre des éléments n'est pas vérifié). |

### Données (D)

| Code | Libellé | Gravité | Source | Méthode de détection |
|---|---|---|---|---|
| D01 | Zone obligatoire non renseignée | Non conforme | Test Compta Demat (`E` et `V` « données absentes ») ; A47 A-1 VII 1° ; BOFiP § 180-190 (PieceRef et PieceDate conventionnelles exigées même pour les à-nouveaux) | BIC/IS : JournalCode, JournalLib, EcritureNum, EcritureDate, CompteNum, CompteLib, PieceRef, PieceDate, EcritureLib, Montant/Sens le cas échéant, ValidDate. BNC/BA : JournalCode, JournalLib et CompteNum relèvent de D19. Debit et Credit vides relèvent de D18. |
| D02 | DateRglt ou ModeRglt non renseigné (trésorerie BA/BNC) | Anomalie | A47 A-1 VIII 5° et 7° (non contrôlé par Test Compta Demat depuis 2015) | Zone vide sur une ligne d'un FEC de trésorerie. |
| D03 | Date inexistante ou illisible | Non conforme | A47 A-1 XII 4° ; Test Compta Demat | EcritureDate, PieceDate, ValidDate, DateLet, DateRglt : ni AAAAMMJJ ni format reconnaissable, ou date inexistante (31 février, mois 13). Test Compta Demat ne détecte que mois > 12 et jour > 31 : cet outil est plus strict. |
| D04 | Date valide mais pas au format AAAAMMJJ | Anomalie | A47 A-1 XII 4° (Test Compta Demat tolère AAAA-MM-JJ, JJ/MM/AAAA…) | Date lue avec séparateurs, ordre JJ/MM/AAAA ou heure accolée. Non applicable au XML (format AAAA-MM-JJ imposé par le schéma). |
| D05 | Montant non numérique | Non conforme | Test Compta Demat (`E`) | Debit, Credit, Montant, Montantdevise non convertibles ; la valeur est comptée pour 0. |
| D06 | Montant au point décimal | Non conforme | A47 A-1 XII 2° ; Test Compta Demat (`E` en fichier à plat) | Point comme séparateur décimal (le point est la norme en XML : non signalé). La conversion est faite. |
| D07 | Montant avec séparateur de milliers | Non conforme | A47 A-1 XII 2° ; Test Compta Demat (`E`) | Espace, espace insécable ou point de groupement des milliers. La conversion est faite. |
| D08 | Montant signé (négatif) | Information | A47 A-1 XII 2° (signe en tête ou en fin autorisé) | Signe « - » en tête ou en fin ; un débit négatif est converti en crédit positif (et inversement). |
| D09 | Sens hors D, C, +1, -1 | Non conforme | A47 A-1 X ; BOFiP § 230 ; Test Compta Demat (`E`) | Valeur de Sens autre que D, C, +1, -1 (casse ignorée ; « + 1 » avec espace refusé par le X mais interprété). |
| D10 | CompteNum ne commençant pas par trois chiffres | Anomalie | A47 A-1 VII 1° (info. 5) ; Test Compta Demat (`A`) | `^\d{3}`. |
| D11 | Débit et crédit non nuls sur la même ligne | Anomalie | Test Compta Demat (`A`) | Debit ≠ 0 et Credit ≠ 0. |
| D12 | Ligne à débit et crédit nuls | Information | Test Compta Demat (`A`) — **gravité abaissée, à valider** | Debit = Credit = 0 (fréquent et sans incidence sur les soldes). |
| D13 | CompAuxNum sans CompAuxLib, ou l'inverse | Anomalie | Contrôle d'audit complémentaire | Une zone du couple vide, l'autre renseignée. |
| D14 | Montantdevise sans Idevise, ou l'inverse | Anomalie | Contrôle d'audit complémentaire ; BOFiP § 260-270 | Idem ; un Montantdevise nul sans Idevise relève de D17. |
| D15 | EcritureLet sans DateLet, ou l'inverse | Anomalie | Contrôle d'audit complémentaire | Idem. |
| D16 | Tiers intégré au numéro de compte (auxiliaire reconstruit) | Information | Contrôle d'audit complémentaire (forme admise : exemples `401AE` du BOFiP § 100) | CompAuxNum vide partout et comptes 40/41 de forme `4xx` + lettres (`411DUPONT`) : reconstruction proposée (compte général `411`, auxiliaire `DUPONT`). |
| D17 | Zone facultative remplie de zéros ou d'espaces au lieu d'être vide | Information | BOFiP § 70 (« Il ne faut pas remplir avec des 0 ou des espaces ») | Montantdevise à 0 sans Idevise, date `00000000`. (Les espaces en bordure de zone sont retirés à la lecture, comme le fait Test Compta Demat.) |
| D18 | Debit ou Credit vide au lieu de 0 | Anomalie | BOFiP § 210 (valeur numérique obligatoire, zéro du côté non mouvementé) ; Test Compta Demat le tolère (lu comme 0) | Zone Debit ou Credit vide sur une ligne (format Debit/Credit). |
| D19 | JournalCode, JournalLib ou CompteNum vide (BNC/BA) | Anomalie | A47 A-1 VIII (« à blanc si non utilisé ») ; BOFiP § 70 et § 130 (le numéro de compte est attendu même hors PCG) | Zone vide dans un FEC BNC/BA ; en BIC/IS, relève de D01. |

### Libellés (L)

| Code | Libellé | Gravité | Source | Méthode de détection |
|---|---|---|---|---|
| L01 | Libellés différents pour un même CompteNum | Anomalie | Contrôle d'audit complémentaire | Libellé majoritaire par compte ; lignes portant un autre libellé non vide. |
| L02 | Libellés différents pour un même JournalCode | Anomalie | Contrôle d'audit complémentaire | Idem par journal. |
| L03 | Libellés différents pour un même CompAuxNum | Anomalie | Contrôle d'audit complémentaire | Idem par auxiliaire. |
| L04 | Même CompAuxNum rattaché à plusieurs CompteNum | Information | Contrôle d'audit complémentaire | Utile aux circularisations (un tiers à la fois client et fournisseur). |

### Écritures et cohérence comptable (E)

| Code | Libellé | Gravité | Source | Méthode de détection |
|---|---|---|---|---|
| E01 | Écriture déséquilibrée | Non conforme | Contrôle d'audit complémentaire (partie double) | Σ débit ≠ Σ crédit par écriture. |
| E02 | Déséquilibre global | Non conforme | Contrôle d'audit complémentaire | Σ débit ≠ Σ crédit sur le fichier ; écart affiché. |
| E03 | Déséquilibre d'un journal | Anomalie | Contrôle d'audit complémentaire | Par JournalCode. |
| E04 | Déséquilibre d'un mois | Anomalie | Contrôle d'audit complémentaire | Par mois d'EcritureDate. |
| E05 | Écriture d'une seule ligne | Anomalie | Test Compta Demat (schéma XSD : au moins 2 lignes par écriture) | Nombre de lignes de l'écriture. |
| E06 | Dates ou pièces différentes au sein d'une écriture | Anomalie | Test Compta Demat (vues « Différentes dates comptables », « Différents numéros de pièce ») | EcritureDate ou ValidDate non unique dans l'écriture. |
| E07 | EcritureDate hors exercice | Anomalie | A47 A-1 VII 1° (« au titre d'un exercice ») | Avant la date de début ou après la date de clôture. |
| E08 | ValidDate antérieure à EcritureDate | Anomalie | Contrôle d'audit complémentaire | Comparaison de dates. |
| E09 | ValidDate postérieure à la clôture | Information | Contrôle d'audit complémentaire | Écritures validées après la clôture (normal pour l'inventaire, à examiner pour le reste). |
| E10 | Trou dans la numérotation | Anomalie | A47 A-1 VII 1° (« séquence continue ») | Partie numérique des EcritureNum, par préfixe (et par journal en mode « par journal ») ; chaque trou listé avec les numéros manquants. |
| E11 | Numéro d'écriture en double | Anomalie | A47 A-1 VII 1° ; BOFiP § 100 (un même numéro dans deux journaux est admis en numérotation par journal) | Mode global : même numéro dans deux journaux, ou bloc de lignes non contigu. Mode par journal : même numéro en deux blocs non contigus. |
| E12 | Écritures non classées par ordre chronologique de validation | Information | A47 A-1 VII 1° | ValidDate inférieure à la plus grande ValidDate des lignes précédentes, dans l'ordre du fichier. Non contrôlé en XML (écritures regroupées par journal par le schéma). |
| E13 | À-nouveaux absents | Anomalie | A47 A-1 VII 1° et 3° | Aucun journal d'à-nouveaux détecté (code AN, RAN, ANO… ou écritures du premier jour au libellé d'à-nouveau). Premier exercice d'une société : à ignorer. |
| E14 | À-nouveaux ne portant pas les premiers numéros d'écriture | Information | A47 A-1 VII 3° ; BOFiP § 110 (admis s'ils restent identifiables) | Mode de numérotation globale seulement. |
| E15 | À-nouveaux sur des comptes de gestion (classes 6 et 7) | Anomalie | Contrôle d'audit complémentaire | Lignes du journal d'à-nouveaux en classe 6 ou 7. |
| E16 | Écritures de solde des comptes de charges et de produits présentes | Anomalie | A47 A-1 VII 1° (« hors écritures de solde ») | Écriture datée de la clôture soldant des comptes 6/7 contre un compte 12. |
| E17 | Numérotation non chronologique (inversion) | Anomalie | BOFiP § 40 et § 100 (numérotation « croissante dans le temps », « sans rupture ni inversion ») | Dans une même séquence, numéro supérieur portant une EcritureDate antérieure à celle d'un numéro inférieur (à-nouveaux exclus). |

Le rapport s'ouvre sur : « Contrôle indicatif. Seul l'outil officiel Test Compta Demat de la DGFiP fait foi » et le lien officiel (SPEC 3.2).

## Variantes de format et zones

| Variante | Zones (dans l'ordre) | Reconnaissance |
|---|---|---|
| **BIC/IS** (A47 A-1 VII 1°) | 18 : JournalCode, JournalLib, EcritureNum, EcritureDate, CompteNum, CompteLib, CompAuxNum, CompAuxLib, PieceRef, PieceDate, EcritureLib, Debit, Credit, EcritureLet, DateLet, ValidDate, Montantdevise, Idevise | En-tête (régime par défaut). |
| **Montant / Sens** (VII 2°, VIII 4°, 6°, 8°) | Montant et Sens remplacent Debit (12) et Credit (13) ; Sens = D/C ou +1/-1 (X) | Présence de Montant et Sens. |
| **BNC/BA en droit commercial** (VIII 3°) | Les 18 zones BIC/IS ; JournalCode, JournalLib et CompteNum « à blanc si non utilisé » | Indiscernable du BIC/IS par sa structure : régime choisi par l'utilisateur à l'import (BIC/IS par défaut) ; en XML, schéma `formatA47A-I-VIII-3.xsd`. |
| **BA de trésorerie** (VIII 5°) | 21 : les 18 + DateRglt, ModeRglt, NatOp | Présence de DateRglt/ModeRglt sans IdClient. |
| **BNC de trésorerie** (VIII 7°) | 22 : les 18 + DateRglt, ModeRglt, NatOp, IdClient | Présence d'IdClient. |
| **XML** (VI 2°) | `comptabilite` › `exercice` (DateCloture) › `journal` (JournalCode, JournalLib) › `ecriture` (EcritureNum, EcritureDate, EcritureLib, PieceRef, PieceDate, EcritureLet ?, DateLet ?, ValidDate, [DateRglt, ModeRglt, NatOp ?, IdClient ?]) › `ligne` ×2+ (CompteNum, CompteLib, CompAuxNum ? ou CompteAuxNum ?, CompAuxLib ? ou CompteAuxLib ?, Montantdevise ?, Idevise ?, Debit **ou** Credit **ou** Montant + Sens, zones libres) | Racine `comptabilite` ; schéma déclaré par `xsi:noNamespaceSchemaLocation` (pas d'espace de noms) : `VII-1` BIC/IS, `VIII-3` BNC/BA droit commercial, `VIII-5` BA trésorerie, `VIII-7` BNC trésorerie. Dates AAAA-MM-JJ (ou avec heure), montants au point décimal. Le lettrage y est une donnée d'**écriture**, appliquée à toutes ses lignes. |

Tolérances de forme (signalées, jamais bloquantes pour l'import) : encodage UTF-8 avec ou sans BOM, ISO-8859-15, Windows-1252 (forçable) ; fins de ligne CR, LF, CRLF ; point-virgule ou virgule avec guillemets ; point décimal, milliers, signes ; casse, accents, alias de colonnes et colonnes en trop ; tiers intégré au numéro de compte.

## Décisions du point d'arrêt 1

1. Niveau le plus élevé nommé « Non conforme » ; il n'empêche jamais l'exploitation du FEC.
2. D06 / D07 (point décimal, milliers) et S08 (alias) : « Non conforme », comme Test Compta Demat ; la valeur est néanmoins convertie.
3. D12 (lignes à zéro) : Information.
4. Encodages : `TextDecoder` pour UTF-8 ; table de correspondance pour Windows-1252 et ISO-8859-15 (le `TextDecoder` de Node 22 décode Windows-1252 comme ISO-8859-1, ce qui fausserait les tests).
