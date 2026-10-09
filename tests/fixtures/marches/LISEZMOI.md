# Réponses enregistrées des sources d'indicateurs (tests de scripts/marches/)

Réponses **réelles** des API officielles, enregistrées le 09/10/2026 (données publiques, aucune donnée
personnelle) :

- `bce-eur-usd.csv` : taux de référence EUR/USD de la BCE depuis le 01/08/2026 (`EXR/D.USD.EUR.SP00.A`, format csvdata).
- `bce-taux-long-fr.csv` : taux long terme de la France pour le critère de convergence (`IRS/M.FR.L.L40.CI.0000.EUR.N.Z`), mensuel.
- `bce-gfs-dette.csv` : dette consolidée des administrations publiques françaises en millions d'euros (`GFS/Q.N.FR.W0.S13…`), trimestrielle.
- `fred-brent.csv` : Brent (`DCOILBRENTEU`, données EIA) depuis le 01/08/2026.
- `insee-dette.xml` : API BDM de l'INSEE, dette de Maastricht en Md€ (010777616) et en % du PIB (010777608), 12 trimestres.
- `insee-dette-negociable.xml` : dette négociable de l'État en M€ (001711531, données de l'AFT), 12 mois.
- `insee-ir-dette.html` : extrait de la page « Informations rapides » de la dette du 2e trimestre 2026 (mention de la prochaine publication).

La page quotidienne du TEC 10 de la Banque de France n'est pas enregistrée : la collecte vérifie seulement
qu'elle existe et n'en lit jamais le contenu (licence Euronext, redistribution interdite).
