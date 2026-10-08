# FEC fictifs du cadrage de TVA

Générés par `npm run tva:fictifs` (`scripts/generer-tva-fictif.ts`, `scripts/tva-fictif/fec-services.ts`).
Aucune donnée réelle.

CONSEIL FICTIF SERVICES SAS (SIREN fictif 000777128), prestations de services et travaux, TVA sur les
encaissements, exercice du 01/07/2025 au 30/06/2026, **cohérent avec les CA3 fictives** de
`tests/fixtures/ca3/services/` :

- les encaissements HT de chaque mois, par taux, sont les bases déclarées (A1, 08, 9B, E2) ; chaque facture
  est encaissée le mois suivant (clients N-1 = factures de juin 2025, clients N = factures de juin 2026) ;
- TVA des factures en 44587 (TVA sur factures non encaissées), virée en 445710 (20 %) ou 445712 (10 %) à
  l'encaissement ; liquidation mensuelle telle que déclarée (4455, 44567, 44566, 44562, 4452) ;
- prestations intracommunautaires autoliquidées par le client (706300 « Prestations UE AUTO LIQ », E2) ;
  achats de prestations auprès d'un prestataire non établi (A3) : TVA autoliquidée 4452 / 44566 ;
- facture à établir N-1 (extournée, facturée en juillet, encaissée en août) et N ; produit constaté
  d'avance N ; créance douteuse N-1 passée en perte (654) en mars 2026.

| Fichier | Cas | TVA théorique | TVA collectée déclarée | Écart |
|---|---|---|---|---|
| `…_conforme.txt` | sans écart (février corrigé) / écart de déclaration de février | 225 240 € | 225 190 € (225 240 € corrigée) | +50 € (0 €) |
| `…_cutoff.txt` | encaissement du 30/06/2026 (12 000 € TTC) comptabilisé le 01/07/2026 | 223 240 € | 225 190 € | −1 950 € |

`attendus.json` donne ces valeurs en centimes, la ventilation exacte des encours par taux, la TVA
comptabilisée au crédit des 4457 par mois et les soldes de 4455 et 44567, calculés par le générateur.
