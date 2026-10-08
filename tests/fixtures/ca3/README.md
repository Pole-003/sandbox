# CA3 fictives

Déclarations de TVA n° 3310-CA3 **fictives**, générées par `npm run ca3:fictives`
(`scripts/generer-ca3-fictives.ts`, pdf-lib en dépendance de développement). Aucune donnée réelle :
sociétés, SIREN (clé de Luhn valide) et montants sont inventés.

La mise en page imite l'impression d'une déclaration depuis l'espace professionnel impots.gouv.fr
(page 1 « Identification », puis une ligne par case, montants alignés à droite, colonnes « Base hors
taxe » et « Taxe due » pour la TVA brute) avec deux variantes de production du PDF :

| Variante | Code et libellé | Montants | Position des montants | En-têtes de colonnes |
|---|---|---|---|---|
| 1 | deux éléments de texte | un élément, milliers séparés par une espace insécable | première ligne du libellé | répétés à chaque page |
| 2 | un seul élément | un élément par groupe de milliers (« 120 », « 000 ») | dernière ligne du libellé | non répétés ; page décalée de 12 points |

Les libellés reprennent ceux du formulaire officiel (millésimes 2025 et 2026, cases identiques) et
contiennent donc les pièges attendus : « 20 % », « 1,75 % », « art 283-2 », « ligne 27 », « 3310-CA3G ».

## Séries

- `services/` : CONSEIL FICTIF SERVICES SAS, prestations de services, 12 déclarations mensuelles du
  01/07/2025 au 30/06/2026 (formulaire 2025 de juillet à décembre, 2026 ensuite) :
  - 09/2025 : achat d'immobilisation (ligne 19), crédit de TVA (lignes 25 et 27) ;
  - 10/2025 : crédit reporté ligne 22, partiellement imputé, nouveau crédit ; achat autoliquidé (A3) ;
  - 11/2025 : imputation du solde du crédit ; ligne « dont » sans code avec un montant sous la ligne 21 ;
  - 12/2025 : déposée après la date limite ;
  - 02/2026 : incohérences volontaires (taxe 9B ≠ base × 10 % ; ligne 16 ≠ somme des taxes) ;
  - 03/2026 : achat de prestation autoliquidé (A3).
- `trimestrielle/` : ATELIER TRIMESTRIEL SARL, 4 déclarations trimestrielles de 2025.
- `autres/` : un formulaire d'un millésime inconnu (2027, fictif) avec une case inventée « W1 », et un
  PDF image sans texte (déclaration scannée, saisie manuelle).

`attendus.json` donne, pour chaque fichier, l'identification, les valeurs des cases en centimes et les
contrôles attendus, calculés par le générateur indépendamment du code de lecture.

## Moteurs de rendu réels (`navigateurs/`)

`npm run ca3:navigateurs` imprime quatre déclarations de la série `services` (09/2025, 11/2025, 02/2026,
06/2026) avec de vrais producteurs de PDF, pour éprouver la lecture au-delà de pdf-lib :

- **Chromium** (« Imprimer en PDF » d'une page HTML, avec les en-têtes et pieds de page du navigateur :
  date, titre, adresse du fichier, « 3/5 »), en disposition « tableau » (cellules centrées verticalement,
  en-têtes de colonnes répétés) ou « blocs » (lignes en flexbox, montants en haut) ;
- **LibreOffice** (export PDF d'un document Word à tableaux, interlignes serrés).

Les PDF produits sont versionnés ; leur régénération demande Chromium et LibreOffice. Les tests de
`tests/modules/tva/ca3-robustesse.test.ts` déforment en outre les pages lues (en-têtes absents ou
renommés, montants suivis de « € », texte découpé caractère par caractère, échelle, pieds de page).
