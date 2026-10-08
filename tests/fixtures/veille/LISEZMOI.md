# Flux d'exemple pour les tests de la veille

Fichiers **reconstitués à la main** : ils reproduisent les particularités observées le 08/10/2026 et
décrites dans `docs/VEILLE.md`. Les titres et contenus sont fictifs. Aucun texte d'article réel n'est recopié.

- `senat-encodage-trompeur.rss` : le prologue XML annonce `iso-8859-15`, mais les octets sont en UTF-8.
  Les dates n'ont pas d'espace après la virgule (`Wed,07 Oct 2026`).
- `bofip-sans-pubdate.rss` : aucun `pubDate`. La date figure dans la description (« publié le JJ/MM/AAAA »).
  Le lien du canal est en `http://`.
- `atom-exemple.xml` : flux Atom minimal (dates `updated` en ISO 8601).
- `page-html.html` : page HTML renvoyée à la place d'un flux.
