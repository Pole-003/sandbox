# Flux d'exemple pour les tests de la veille

Fichiers **reconstitués à la main** : ils reproduisent les particularités observées le 08/10/2026 et
décrites dans `docs/VEILLE.md`. Les titres et contenus sont fictifs. Aucun texte d'article réel n'est recopié.

- `senat-encodage-trompeur.rss` : le prologue XML annonce `iso-8859-15`, mais les octets sont en UTF-8.
  Les dates n'ont pas d'espace après la virgule (`Wed,07 Oct 2026`).
- `bofip-sans-pubdate.rss` : aucun `pubDate`. La date figure dans la description (« publié le JJ/MM/AAAA »).
  Le lien du canal est en `http://`.
- `atom-exemple.xml` : flux Atom minimal (dates `updated` en ISO 8601).
- `page-html.html` : page HTML renvoyée à la place d'un flux.
- `an-documents.rss` : flux volumineux de l'Assemblée (fictif) : liens en `http://`, entités HTML, éléments hors sujet
  et hors fenêtre, pour tester le filtre par mots-clés.
- `senat-iso-8859-15.rss` : flux réellement encodé en iso-8859-15 (cas constaté au diagnostic du 08/10/2026), avec « € » et « Œ ».
- `an-dossier-plf.html` et `an-dossier-plf-cmp.html` : pages de dossier législatif de l'Assemblée nationale
  reconstituées d'après la structure relevée le 08/10/2026 (bloc « Étapes de lecture », `etape-slider`) ;
  la seconde simule un dossier arrivé en commission mixte paritaire. Les étapes et dates sont fictives.
- `an-projet-plf-toc.html` : texte open data d'un projet de loi présenté par table des matières (`assnatTOC2` à `assnatTOC6`),
  comme le PLF 2027 ; `an-projet-plfss-blocs.html` : présentation par blocs d'article (`assnat9ArticleNum`), comme le PLFSS 2027.
  Intitulés fictifs ; seule la structure est reproduite.
