# La fabrock – l'archive

Le site public de La fabrock, l'émission de Radio 666 : toutes les tracklists depuis 2012,
la recherche par titre et par artiste, ce qui passait avant et après, et combien de fois.

## Site
https://lafabrock.github.io/lafabrock/
Publié automatiquement par GitHub Pages depuis la branche `main`.

## Fichiers
- `index.html`, `style.css`, `app.js` : l'archive interactive (sans framework ni serveur)
- `show/<identifiant>/` : une page statique par émission (pochette, tracklist, liens d'écoute),
  celle à partager sur les réseaux : elle affiche la pochette dans l'aperçu du lien
- `show/index.html` : la liste de toutes les émissions ; `sitemap.xml` : le plan du site pour Google
- `data/shows.json` : toutes les émissions et tracklists (généré)
- `data/manual_shows.json` : tracklists ajoutées à la main pour les émissions qui n'en ont pas sur Mixcloud
- `data/overrides.json` : corrections par émission, par exemple la date de diffusion
- `data/aliases.json` : graphies d'artistes à corriger
- `data/slugs.json` : l'identifiant permanent de chaque émission (ne pas modifier)
- `data/youtube.json` : la vidéo YouTube de chaque émission (versions mix sans voix), par identifiant
- `tools/update_data.py` : reconstruit `data/shows.json` depuis Mixcloud et hearthis
- `tools/postprocess.py` : identifiants, dates de diffusion, alias (lancé par `update_data.py`)
- `tools/youtube.py` : repère les nouvelles vidéos de la chaîne YouTube et ajoute le lien « YouTube »
- `tools/build_pages.py` : génère les pages statiques, le sitemap et les balises de partage
- `.github/workflows/update.yml` : la mise à jour automatique hebdomadaire

## Adresses des émissions
Chaque émission a un identifiant permanent : `s14e05` pour un épisode, un nom court pour les
autres émissions (`funk-soul-session-11-with-la-fabrock`). Deux adresses existent :
- `https://lafabrock.github.io/lafabrock/show/s14e05/` : la page à partager (Spotify, Instagram, Facebook)
- `https://lafabrock.github.io/lafabrock/#/show/s14e05` : la même émission dans l'archive interactive

Un identifiant ne change jamais une fois donné (il est gardé dans `data/slugs.json`).
Les anciens liens numériques (`#/show/418`) redirigent vers la bonne émission.

## Mise à jour après une nouvelle émission
Automatique : le workflow tourne chaque samedi à 9 h UTC. Il relit Mixcloud (profil lafabrock,
playlist « la-fabrock » de Radiosixsixsix, tout upload de Radiosixsixsix contenant « fabrock »,
playlist « la-fabrock-collabs ») et hearthis.at/lafabrock, régénère les pages, enregistre le
résultat, et GitHub Pages republie le site.
Lancement manuel : onglet Actions → « Update archive and deploy » → Run workflow.

**Garde-fou :** si Mixcloud répond mal (tracklists qui disparaissent, émissions manquantes,
nombre de morceaux en forte baisse), le workflow s'arrête sans rien publier et GitHub envoie un
e-mail. Le site garde alors les données de la semaine précédente. Si la baisse est voulue (une
tracklist supprimée exprès), lancer `python3 tools/update_data.py --force` en local.

En local : `pip install requests` puis `python3 tools/update_data.py` (environ 1 min) et
`python3 tools/build_pages.py`. Ajouter `--no-hearthis` pour ignorer hearthis.

## Vidéos YouTube
Chaque samedi, le workflow lit aussi le flux public de la chaîne YouTube La fabrock (les 15 dernières
vidéos). Une vidéo dont le titre contient le code de l'épisode (`s14e06`, ou `1406` avec « fabrock »
dans le titre ou en début de titre) est ajoutée à `data/youtube.json`, et l'émission reçoit un bouton
« Écouter sur YouTube ». Si le titre ne contient pas le code, ajouter la ligne à la main :
`"s14e06": "https://www.youtube.com/watch?v=…"`, puis `python3 tools/postprocess.py` et
`python3 tools/build_pages.py` (ou attendre le samedi). Une ligne écrite à la main n'est jamais remplacée.

## Corriger une date de diffusion
Le site affiche la date de diffusion quand il la connaît, sinon la date de mise en ligne sur
Mixcloud. Les dates écrites dans les titres (20140717, 7th January 2016…) sont reprises
automatiquement. Pour les autres, ajouter une ligne dans `data/overrides.json` :
`"s14e05": {"aired": "2026-10-30"}`, puis `python3 tools/postprocess.py` et
`python3 tools/build_pages.py` (ou attendre la mise à jour du samedi).

## Corriger la graphie d'un artiste
Les variantes de majuscules, d'espaces et de ponctuation (Jay Z, JAY-Z, JayZ) sont fusionnées
automatiquement. Pour les autres, ajouter `"graphie trouvée": "graphie à garder"` dans
`data/aliases.json`.

## Ajouter une tracklist à la main
Modifier `data/manual_shows.json`. Chaque entrée : `match_name` (titre Mixcloud exact, ou un
nouveau nom pour une émission pas encore en ligne), `name`, `date` (AAAA-MM-JJ), `source` et
`tracks` : `[{"type": "track", "artist": "...", "title": "...", "ts": "12:34"}]`.
Une tracklist officielle sur Mixcloud a toujours la priorité sur celle ajoutée à la main.

## Rapprochement avec hearthis (tools/hearthis.py)
Chaque upload hearthis est rapproché de Mixcloud par code d'épisode (s03e15, 0309…), numéro de
série (Topspin #12, Funky Explorations #46, ZKR5…) ou titre, puis comparé par durée :
- même mix (à 3 min près) : le lien hearthis est ajouté à l'émission Mixcloud
- durée différente : ajouté comme « version alternative » liée à l'original, avec la tracklist de
  la description hearthis ; les titres déjà dans l'original ne sont pas comptés deux fois
- aucune correspondance : ajouté comme émission seulement sur hearthis
Modifier `TOL_MIN` dans `tools/hearthis.py` pour rendre la règle « même mix » plus ou moins stricte.

## Référencement
Le site est public et indexable. Pour accélérer sa prise en compte par Google, déclarer
`https://lafabrock.github.io/lafabrock/` dans Google Search Console et y soumettre
`https://lafabrock.github.io/lafabrock/sitemap.xml`.

## Tester en local
Le site doit être servi en HTTP : `python3 -m http.server 8000` puis http://localhost:8000
