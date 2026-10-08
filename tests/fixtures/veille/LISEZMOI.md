# Flux d'exemple pour les tests de la veille

Fichiers **reconstitués à la main** : ils reproduisent les particularités observées le 08/10/2026 et
décrites dans `docs/VEILLE.md`. Les titres et contenus sont fictifs. Aucun texte d'article réel n'est recopié.

- `senat-encodage-trompeur.rss` : le prologue XML annonce `iso-8859-15`, mais les octets sont en UTF-8.
  Les dates n'ont pas d'espace après la virgule (`Wed,07 Oct 2026`).
- `bofip-sans-pubdate.rss` : aucun `pubDate`. La date figure dans la description (« publié le JJ/MM/AAAA »).
  Le lien du canal est en `http://`.
- `atom-exemple.xml` : flux Atom minimal (dates `updated` en ISO 8601).
- `page-html.html` : page HTML renvoyée à la place d'un flux.
- `reponse-ia-rennes.json` : réponse simulée de l'API Claude (couche C, thème « Rennes et Bretagne »), avec
  un article valide, un article à l'URL inventée (absente des résultats de recherche) et un article hors fenêtre.
- `reponse-ia-json-invalide.json` : réponse simulée tronquée (`max_tokens`), au JSON invalide.

Les réponses simulées permettent de tester les contrôles automatiques sans appeler l'API ni consommer de crédit.
Les domaines en `.invalid` sont réservés et n'existent pas.
- `an-documents.rss` : flux volumineux de l'Assemblée (fictif) : liens en `http://`, entités HTML, éléments hors sujet
  et hors fenêtre, pour tester le filtre par mots-clés.
- `senat-iso-8859-15.rss` : flux réellement encodé en iso-8859-15 (cas constaté au diagnostic du 08/10/2026), avec « € » et « Œ ».
