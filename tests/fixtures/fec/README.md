# Jeu de FEC fictifs

> Fichier généré par `npm run fec:fictifs` (scripts/generer-fec-fictifs.ts). Ne pas modifier à la main.

Toutes les données sont **entièrement fictives** et générées de façon déterministe (graines fixes). Les SIREN commencent par `000`, préfixe jamais attribué par l'INSEE. Aucun vrai FEC ne doit être placé dans ce dossier ni ailleurs dans le dépôt (CLAUDE.md, règle n° 4).

- `attendus.json` : pour chaque fichier, ses caractéristiques et les **constats de conformité attendus** (code de règle, lignes concernées), les totaux par compte et par tiers, les pistes d'audit volontaires.
- `gros/` : gros FEC de performance (`npm run fec:gros`, 2 000 000 lignes par défaut), **non commité**.
- Numéros de ligne : ligne 1 = en-tête. Montants en euros ci-dessous, en centimes dans `attendus.json`.

## FEC propre

### `propre/000123455FEC20260630.txt`

PME de négoce, exercice décalé du 01/07/2025 au 30/06/2026. Journaux AN, VT, AC, BQ1, BQ2, OD ; 150 clients et 80 fournisseurs avec auxiliaires ; 3 banques dont Banque Gamma (512300) clôturée en cours d'exercice ; emprunt ; lettrage partiel ; clients créditeurs, fournisseurs débiteurs ; un fournisseur à fort volume et solde nul ; un fournisseur en USD. Écritures d'inventaire validées après la clôture.

Séparateur tabulation, utf-8, fins de ligne CRLF, debit-credit — 20546 lignes, 8048 écritures, exercice du 2025-07-01 au 2026-06-30.

| Code | Constat attendu | Occurrences | Lignes |
|---|---|---|---|
| E09 | ValidDate postérieure à la clôture (Information) | 18 | 20530, 20531, 20532, 20533, 20534… (18 lignes) |

## Variantes de format

### `variantes/000987651FEC20251231_standard.txt`

Petit FEC de référence (exercice civil 2025) : tabulation, UTF-8 sans BOM, CRLF, Debit/Credit, virgule décimale. Toutes les variantes ci-dessous contiennent les mêmes écritures.

Séparateur tabulation, utf-8, fins de ligne CRLF, debit-credit — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

Constats attendus : **aucun**.

### `variantes/000987651FEC20251231_pipe.txt`

Séparateur « | » (conforme).

Séparateur pipe, utf-8, fins de ligne CRLF, debit-credit — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

Constats attendus : **aucun**.

### `variantes/000987651FEC20251231_montant-sens-dc.txt`

Zones Montant et Sens (D/C) à la place de Debit et Credit (A47 A-1 VII 2°, conforme).

Séparateur tabulation, utf-8, fins de ligne CRLF, montant-sens-dc — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

Constats attendus : **aucun**.

### `variantes/000987651FEC20251231_montant-sens-pm.txt`

Zones Montant et Sens (+1/-1) à la place de Debit et Credit (conforme).

Séparateur tabulation, utf-8, fins de ligne CRLF, montant-sens-pm — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

Constats attendus : **aucun**.

### `variantes/000987651FEC20251231_utf8-bom.txt`

UTF-8 avec marque d'ordre des octets (BOM) en tête.

Séparateur tabulation, utf-8-bom, fins de ligne CRLF, debit-credit — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

| Code | Constat attendu | Occurrences | Lignes |
|---|---|---|---|
| S04 | Marque d'ordre des octets (BOM) UTF-8 en tête de fichier (Information) | 1 | — |

### `variantes/000987651FEC20251231_iso-8859-15.txt`

Encodage ISO-8859-15 (conforme ; « € » codé 0xA4, « œ » 0xBD).

Séparateur tabulation, iso-8859-15, fins de ligne CRLF, debit-credit — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

Constats attendus : **aucun**.

### `variantes/000987651FEC20251231_windows-1252.txt`

Encodage Windows-1252 (non prévu par l'article A47 A-1 XII ; « € » codé 0x80, « œ » 0x9C).

Séparateur tabulation, windows-1252, fins de ligne CRLF, debit-credit — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

| Code | Constat attendu | Occurrences | Lignes |
|---|---|---|---|
| S03 | Jeu de caractères non prévu (ni ASCII, ni ISO-8859-15, ni UTF-8) (Anomalie) | 1 | — |

### `variantes/000987651FEC20251231_excel-point-virgule.txt`

Export Excel : séparateur « ; », toutes les zones entre guillemets, Windows-1252, fins de ligne CRLF.

Séparateur point-virgule, windows-1252, fins de ligne CRLF, debit-credit — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

| Code | Constat attendu | Occurrences | Lignes |
|---|---|---|---|
| S02 | Séparateur de zones autre que la tabulation ou « | » (Non conforme) | 1 | — |
| S03 | Jeu de caractères non prévu (ni ASCII, ni ISO-8859-15, ni UTF-8) (Anomalie) | 1 | — |
| S14 | Zones entre guillemets (Anomalie) | 1 | — |

### `variantes/000987651FEC20251231_point-decimal.txt`

Montants au point décimal (« 1234.56 ») au lieu de la virgule.

Séparateur tabulation, utf-8, fins de ligne CRLF, debit-credit — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

| Code | Constat attendu | Occurrences | Lignes |
|---|---|---|---|
| D06 | Montant au point décimal (Non conforme) | 860 | 2, 3, 4, 5, 6… (860 lignes) |

### `variantes/000987651FEC20251231_milliers.txt`

Montants avec séparateur de milliers (espace insécable : « 1 234,56 »).

Séparateur tabulation, utf-8, fins de ligne CRLF, debit-credit — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

| Code | Constat attendu | Occurrences | Lignes |
|---|---|---|---|
| D07 | Montant avec séparateur de milliers (Non conforme) | 467 | 2, 3, 4, 7, 8… (467 lignes) |

### `variantes/000987651FEC20251231_montants-signes.txt`

Avoirs saisis en montants négatifs dans la colonne d'origine, signe en tête (« -12,00 ») ou en fin (« 12,00- ») en alternance (autorisé par A47 A-1 XII 2°).

Séparateur tabulation, utf-8, fins de ligne CRLF, debit-credit — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

| Code | Constat attendu | Occurrences | Lignes |
|---|---|---|---|
| D08 | Montant signé (Information) | 3 | 768, 769, 770 |

### `variantes/000987651FEC20251231_colonnes-casse-accents.txt`

En-têtes en casse et accents différents : journalcode, ÉcritureDate, COMPTENUM, PièceRef, Écriturelib, MontantDevise, IDevise.

Séparateur tabulation, utf-8, fins de ligne CRLF, debit-credit — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

| Code | Constat attendu | Occurrences | Lignes |
|---|---|---|---|
| S07 | Nom de zone reconnu malgré une casse, des accents ou une variante officielle (Information) | 7 | — |

### `variantes/000987651FEC20251231_colonnes-en-trop.txt`

Deux zones supplémentaires après les 18 zones réglementaires : CodeAnalytique et Utilisateur (autorisé).

Séparateur tabulation, utf-8, fins de ligne CRLF, debit-credit — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

| Code | Constat attendu | Occurrences | Lignes |
|---|---|---|---|
| S10 | Zones supplémentaires (Information) | 2 | — |

### `variantes/000987651FEC20251231_colonnes-ordre.txt`

Zones dans un ordre différent de l'arrêté (CompteNum et CompteLib en tête, Debit et Credit inversés).

Séparateur tabulation, utf-8, fins de ligne CRLF, debit-credit — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

| Code | Constat attendu | Occurrences | Lignes |
|---|---|---|---|
| S09 | Ordre des zones différent de l'arrêté (Anomalie) | 1 | — |

### `variantes/000987651FEC20251231_tiers-integre.txt`

Logiciel sans comptes auxiliaires : tiers intégré au numéro de compte (« 411ELITTORAL »), CompAuxNum et CompAuxLib vides, CompteLib = nom du tiers.

Séparateur tabulation, utf-8, fins de ligne CRLF, debit-credit — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

| Code | Constat attendu | Occurrences | Lignes |
|---|---|---|---|
| D16 | Tiers intégré au numéro de compte (auxiliaire reconstruit) (Information) | 246 | 2, 3, 4, 5, 6… (246 lignes) |

### `variantes/000987651FEC20251231_fin-ligne-lf.txt`

Fins de ligne LF (Unix).

Séparateur tabulation, utf-8, fins de ligne LF, debit-credit — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

Constats attendus : **aucun**.

### `variantes/000987651FEC20251231_fin-ligne-cr.txt`

Fins de ligne CR seul (anciens Mac).

Séparateur tabulation, utf-8, fins de ligne CR, debit-credit — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

Constats attendus : **aucun**.

### `variantes/000987651FEC20251231_xml.xml`

XML conforme au schéma formatA47A-I-VII-1.xsd (BIC/IS) : écritures regroupées par journal, dates AAAA-MM-JJ, montants au point décimal, une seule zone Debit ou Credit par ligne. Le lettrage est une donnée d'écriture en XML : seul le premier code de lettrage de chaque écriture est repris.

XML, utf-8, fins de ligne LF, debit-credit — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

Constats attendus : **aucun**.

### `variantes/000555011FEC20251231_bnc-tresorerie.txt`

Atelier d'architecture Fictif : comptabilité de trésorerie BNC, 22 zones (18 + DateRglt, ModeRglt, NatOp, IdClient), A47 A-1 VIII 7°.

Séparateur tabulation, utf-8, fins de ligne CRLF, debit-credit — 258 lignes, 129 écritures, exercice du 2025-01-01 au 2025-12-31.

Constats attendus : **aucun**.

### `variantes/000555029FEC20251231_ba-tresorerie.txt`

EARL des Champs Fictifs : comptabilité de trésorerie BA, 21 zones (18 + DateRglt, ModeRglt, NatOp), A47 A-1 VIII 5°.

Séparateur tabulation, utf-8, fins de ligne CRLF, debit-credit — 224 lignes, 112 écritures, exercice du 2025-01-01 au 2025-12-31.

Constats attendus : **aucun**.

### `variantes/000555011FEC20251231_bnc-tresorerie-xml.xml`

Comptabilité de trésorerie BNC en XML, schéma formatA47A-I-VIII-7.xsd.

XML, utf-8, fins de ligne LF, debit-credit — 258 lignes, 129 écritures, exercice du 2025-01-01 au 2025-12-31.

Constats attendus : **aucun**.

## FEC piégés

### `pieges/000987651FEC20251231_piege-desequilibre.txt`

Une facture de vente dont la ligne de chiffre d'affaires est majorée de 100,00 € : écriture, journal VT, mois et total général déséquilibrés.

Séparateur tabulation, utf-8, fins de ligne CRLF, debit-credit — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

| Code | Constat attendu | Occurrences | Lignes |
|---|---|---|---|
| E01 | Écriture déséquilibrée (Non conforme) | 3 | 196, 197, 198 |
| E02 | Déséquilibre global (Non conforme) | 1 | — |
| E03 | Déséquilibre d'un journal (Anomalie) | 1 | — |
| E04 | Déséquilibre d'un mois (Anomalie) | 1 | — |

### `pieges/000987651FEC20251231_piege-dates-invalides.txt`

EcritureDate « AAAA0231 » (31 février) sur une facture d'achat, PieceDate « AAAA1301 » (mois 13) sur une facture de vente : dates inexistantes. Une autre facture de vente porte une EcritureDate valide mais au format JJ/MM/AAAA.

Séparateur tabulation, utf-8, fins de ligne CRLF, debit-credit — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

| Code | Constat attendu | Occurrences | Lignes |
|---|---|---|---|
| D03 | Date inexistante ou illisible (Non conforme) | 6 | 104, 105, 106, 358, 359, 360 |
| D04 | Date valide mais pas au format AAAAMMJJ (Anomalie) | 3 | 484, 485, 486 |

### `pieges/000987651FEC20251231_piege-hors-exercice.txt`

Une écriture datée 12 jours avant l'ouverture (placée juste après les à-nouveaux) et une écriture de frais bancaires datée 15 jours après la clôture, validée 20 jours après (placée en fin de fichier).

Séparateur tabulation, utf-8, fins de ligne CRLF, debit-credit — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

| Code | Constat attendu | Occurrences | Lignes |
|---|---|---|---|
| E07 | EcritureDate hors exercice (Anomalie) | 4 | 31, 32, 860, 861 |
| E09 | ValidDate postérieure à la clôture (Information) | 2 | 860, 861 |

### `pieges/000987651FEC20251231_piege-validdate-anterieure.txt`

Deux écritures (les premières de leur mois) validées la veille de leur date de comptabilisation. Elles restent classées dans l'ordre chronologique de validation.

Séparateur tabulation, utf-8, fins de ligne CRLF, debit-credit — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

| Code | Constat attendu | Occurrences | Lignes |
|---|---|---|---|
| E08 | ValidDate antérieure à EcritureDate (Anomalie) | 6 | 148, 149, 150, 279, 280, 281 |

### `pieges/000987651FEC20251231_piege-numerotation.txt`

Trou de deux numéros avant l'écriture n° 43 ; le n° 84 est porté par deux écritures de journaux différents (BQ1 et VT).

Séparateur tabulation, utf-8, fins de ligne CRLF, debit-credit — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

| Code | Constat attendu | Occurrences | Lignes |
|---|---|---|---|
| E10 | Trou dans la numérotation (Anomalie) | 1 | 126 |
| E11 | Numéro d'écriture en double (Anomalie) | 5 | 227, 228, 229, 230, 231 |

### `pieges/000987651FEC20251231_piege-libelle-compte.txt`

« Achats marchandises » au lieu de « Achats de marchandises » sur une ligne du compte 607000.

Séparateur tabulation, utf-8, fins de ligne CRLF, debit-credit — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

| Code | Constat attendu | Occurrences | Lignes |
|---|---|---|---|
| L01 | Libellés différents pour un même CompteNum (Anomalie) | 1 | 167 |

### `pieges/000987651FEC20251231_piege-debit-credit-meme-ligne.txt`

Une facture de vente dont les lignes client et chiffre d'affaires portent chacune un débit et un crédit (10,00 €) ; l'écriture reste équilibrée.

Séparateur tabulation, utf-8, fins de ligne CRLF, debit-credit — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

| Code | Constat attendu | Occurrences | Lignes |
|---|---|---|---|
| D11 | Débit et crédit non nuls sur la même ligne (Anomalie) | 2 | 261, 262 |

### `pieges/000987651FEC20251231_piege-zone-obligatoire-vide.txt`

PieceRef vide sur une ligne, CompteLib vide sur une autre, EcritureLib vide sur une troisième.

Séparateur tabulation, utf-8, fins de ligne CRLF, debit-credit — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

| Code | Constat attendu | Occurrences | Lignes |
|---|---|---|---|
| D01 | Zone obligatoire non renseignée (Non conforme) | 3 | 51, 115, 396 |

### `pieges/000987651FEC20251231_piege-auxiliaire-sans-libelle.txt`

CompAuxNum renseigné sans CompAuxLib sur une ligne client et une ligne fournisseur.

Séparateur tabulation, utf-8, fins de ligne CRLF, debit-credit — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

| Code | Constat attendu | Occurrences | Lignes |
|---|---|---|---|
| D13 | CompAuxNum sans CompAuxLib, ou l’inverse (Anomalie) | 2 | 71, 161 |

### `pieges/000987651FEC20251231_piege-devise-incomplete.txt`

Idevise « USD » sans Montantdevise sur une ligne ; Montantdevise sans Idevise sur une autre.

Séparateur tabulation, utf-8, fins de ligne CRLF, debit-credit — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

| Code | Constat attendu | Occurrences | Lignes |
|---|---|---|---|
| D14 | Montantdevise sans Idevise, ou l’inverse (Anomalie) | 2 | 109, 173 |

### `pieges/000987651FEC20251231_piege-sans-a-nouveaux.txt`

L'écriture d'à-nouveaux est supprimée (numérotation reprise à 1).

Séparateur tabulation, utf-8, fins de ligne CRLF, debit-credit — 831 lignes, 333 écritures, exercice du 2025-01-01 au 2025-12-31.

| Code | Constat attendu | Occurrences | Lignes |
|---|---|---|---|
| E13 | À-nouveaux absents (Anomalie) | 1 | — |

### `pieges/000987651FEC20251231_piege-structure.txt`

Une ligne à laquelle il manque la dernière zone, un CompteNum ne commençant pas par trois chiffres, un montant non numérique (« néant » au lieu de 0,00) et une ligne vide.

Séparateur tabulation, utf-8, fins de ligne CRLF, debit-credit — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

| Code | Constat attendu | Occurrences | Lignes |
|---|---|---|---|
| S11 | Nombre de zones d'une ligne différent de l'en-tête (Non conforme) | 1 | 45 |
| D10 | CompteNum ne commençant pas par trois chiffres (Anomalie) | 1 | 136 |
| D05 | Montant non numérique (Non conforme) | 1 | 173 |
| S12 | Ligne vide (Information) | 1 | 531 |

### `pieges/000987651FEC20251231_piege-sens-invalide.txt`

Variante Montant/Sens (+1/-1) dont une ligne porte le sens « + 1 » (espace interdit par le X de l'article A47 A-1).

Séparateur tabulation, utf-8, fins de ligne CRLF, montant-sens-pm — 860 lignes, 334 écritures, exercice du 2025-01-01 au 2025-12-31.

| Code | Constat attendu | Occurrences | Lignes |
|---|---|---|---|
| D09 | Sens hors D, C, +1, -1 (Non conforme) | 1 | 232 |

## Faits remarquables du FEC propre

- Total débit = total crédit = 47 635 186,08 € ; 20546 lignes, 8048 écritures.
- Banques mouvementées : 512100, 512200, 512300 ; 512300 (Banque Gamma) est soldée en cours d'exercice.
- Clients créditeurs à la clôture : C0148, C0149, C0150.
- Fournisseurs débiteurs à la clôture : F0077, F0078, F0079.
- Fournisseur à fort volume et solde nul : F0001 (Grossiste Central Fictif SA), 2 648 377,76 € de mouvements créditeurs.
- Emprunt 164000 remboursé par échéances mensuelles (BQ1) ; fournisseur en USD (Montantdevise / Idevise).

### Pistes d'audit volontaires (statistiques, pas des anomalies)

| Piste | Écritures (EcritureNum) |
|---|---|
| od-tresorerie | 1073, 2857, 7956 |
| week-end | 1439, 4334, 5446 |
| jour-ferie | 2782, 6075, 6964 |
| doublon-probable | 4876, 4877 |
| libelle-generique | 5262, 5977 |
| od-chiffre-affaires | 7991 |
| validee-apres-cloture | 8044, 8045, 8046, 8047, 8048 |
