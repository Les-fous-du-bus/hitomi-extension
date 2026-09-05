# Remise en etat des extensions light novel — 2026-09-04

Point de depart : « plusieurs extensions LN ne fonctionnent pas ou fonctionnent mal ».
Personne ne savait lesquelles. Ce document dit pourquoi, et ce qui a ete change.

## 1. La cause racine etait dans l'outillage, pas dans les extensions

Trois defauts du harnais rendaient tout diagnostic faux. Ils se cumulaient.

### 1.1 Le triage ne voyait pas les light novels

`tools/triage-all.sh` bouclait sur `src/manga/*.js`. Les 19 extensions de
`src/novel/` etaient donc hors de portee du triage.

[CLAIM L2] Reproductible : `git show f303420:tools/triage-all.sh | grep 'for f in'`
rend `for f in src/manga/*.js`, et `git show f303420:tools/triage-report.csv`
ne liste que des extensions du dossier manga — aucune entree de `src/novel/`.

D'ou l'impression que le catalogue etait sain.

### 1.2 Le contenu etait valide sur sa longueur brute

`tools/ext-test.js` considerait un chapitre lisible des que
`content.length > 0`. La chaine `<p>Contenu non disponible</p>` fait 29
caracteres : elle passait donc pour un succes. Cinq extensions etaient au vert
tout en rendant une page blanche sur le telephone.

Le harnais mesure desormais le TEXTE REEL, balises retirees, contre un plancher
(`EXT_TEST_MIN_TEXT`, 400 caracteres par defaut). Le plancher est place entre le
rebut a attraper (message d'indisponibilite : 22 caracteres de texte ; widget de
notation : 76 ; barre de boutons : 0) et le chapitre court legitime (plus de mille).

### 1.3 Un seul chapitre etait teste, le premier de la liste

Sur les extensions examinees ici, le premier element se revele souvent atypique :
preface, annonce de publication, page « A propos », ou lien de menu. Le juger seul
a produit les deux erreurs a la fois — `chireads` passait pour cassee alors que
son chapitre 149 rendait 12 736 caracteres, et `novhell` passait pour saine alors
que son premier element etait un lien vers un autre roman.

Le harnais echantillonne maintenant debut, milieu et fin.

Un raffinement s'est impose apres coup : c'est la POSITION de l'echec qui
renseigne, pas le simple compte. Un echec isole sur le DERNIER chapitre n'accuse
pas l'extension — c'est le plus recent, donc celui qu'un site en cours de
traduction sert encore sous forme d'annonce. Mesure sur `lnmtl` : cinq chapitres
preleves entre le debut et la fin rendent 13 000 a 22 000 caracteres, seul le tout
dernier rend un message d'attente de 350 caracteres. A l'inverse, un echec sur le
PREMIER element trahit une liste polluee (lien de menu, preface, autre roman),
comme `novhell` avant correction. Le harnais rend donc GREEN quand seul le dernier
echoue, en le disant dans une note, et PARTIAL dans les autres cas.

### 1.4 Le socle d'execution n'etait pas celui de l'app

Le harnais definissait son propre socle `MProvider` / `LNProvider` ou chaque
methode levait « NI ». L'app, elle, fournit un vrai pont entre les deux dialectes
avec conversion des champs. Le harnais mesurait donc autre chose que ce que le
telephone execute.

Le socle est desormais extrait dans `tools/runtime-base.js`, copie fidele de
`_baseClassesJs` dans `Hitomi/lib/data/extensions/runtime/m_provider_wrapper.dart`.
**Toute modification du pont cote app doit etre reportee dans ce fichier**, sinon
le harnais redevient un menteur.

### 1.5 Cloudflare n'est pas une panne d'extension

Un site protege rend 403 sur du HTTP natif alors que le navigateur embarque de
l'app resout le defi. Le harnais rendait RED, donc « extension cassee », sur des
extensions saines. Un verdict `BLOCKED-CF` distinct a ete ajoute.

Les verdicts sont passes de trois a six : `GREEN`, `PARTIAL`, `EMPTY`,
`BLOCKED-CF`, `NO-CHAPTERS`, `RED`. La distinction qui compte est
**EMPTY** (on navigue, on ouvre, il n'y a pas de texte : c'est le
« fonctionne mal ») contre **RED** (rien ne revient du tout).

## 2. Une contrainte d'ecriture qui n'existe plus

Une note interne affirmait que le moteur QuickJS de l'app ne connait pas le
drapeau `/s` (dotAll), ni le lookbehind, ni plusieurs constructions modernes. Dix
extensions LN sur 19 utilisent `/s`, ce qui aurait ete une piste serieuse.

C'est faux sur la version embarquee. `flutter_qjs` est epingle sur la revision
`f1e4993`, dont `cxx/quickjs/VERSION` indique **2025-09-13**. La table des
drapeaux dans `quickjs.c` contient :

```c
case 's':
    mask = LRE_FLAG_DOTALL;
    break;
```

Le lookbehind est present dans `libregexp.c`, et le drapeau `v`
(`LRE_FLAG_UNICODE_SETS`, ES2024) est meme reconnu. Aucune des extensions
examinees ne casse pour cette raison.

## 3. Les corrections, extension par extension

Chaque ligne est mesuree sur trois chapitres (debut, milieu, fin).

| Extension | Avant | Defaut | Apres |
|---|---|---|---|
| `noveldeglace` | EMPTY 0/3, 33 chapitres | ancrage sur `class="chapter-content"` en correspondance exacte, alors que le theme sert `class="entry-content-chapitre chapter-inner chapter-content"` ; et table des matieres bornee sur `</div></div></div>`, coupee au premier tome | GREEN 3/3, **907 chapitres** |
| `xiaowaz` | EMPTY 0/3 | texte borne entre `wp-post-navigation` et l'un de `abh_box` / ko-fi / `sharedaddy` — les trois marqueurs de fin ont disparu du site | GREEN 3/3, 190 chapitres |
| `chireads` | PARTIAL 1/3, 747 « chapitres » | le repli parcourait la page entiere sans filtrer : la liste ramassait le menu (accueil, Traductions, Original, A Propos de Nous) | GREEN 3/3, **733 chapitres reels** |
| `wuxialnscantrad` | EMPTY 0/3 (76 car) | `([\s\S]*?)</div>` fermait sur le widget de notation en tete de contenu | GREEN 3/3, 107 chapitres |
| `warriorlegendtrad` | EMPTY 0/3 (303 car) | meme defaut, ferme sur la barre de boutons | GREEN 3/3, 36 chapitres |
| `novhell` | PARTIAL 2/3, 411 entrees | le filtre « only chapter-like links » figurait en commentaire sans etre applique dans le code : la liste ramassait les liens vers les autres romans du site | GREEN 3/3, **398 chapitres reels** |
| `novelbuddy` | RED, marquee morte | domaine ET site changes en meme temps (voir 3.1) | GREEN 3/3 |

### 3.1 novelbuddy — reecriture complete

Deux choses avaient change ensemble, ce qui rendait le diagnostic trompeur :

1. `novelbuddy.com` n'a plus d'enregistrement DNS et redirige vers `novelbuddy.me`.
2. Le site est devenu une application Next.js. Les blocs `.book-detailed-item`,
   le conteneur `div.chapter__content` et le point d'entree
   `/api/manga/{id}/chapters` ont tous disparu.

Repointer le domaine seul ne suffisait donc pas — l'extension restait RED. Elle
lit maintenant le JSON embarque par le site (`__NEXT_DATA__`) :
`props.pageProps.ssrItems` pour les listes, `initialManga` pour la fiche,
`initialChapter.content` pour le texte.

**Limite connue et mesuree** : la fiche n'expose que les 50 derniers chapitres.
Les points d'entree de pagination essayes le 2026-09-04 (parametres de page sur
la fiche, segment `/chapters`, `api.novelbuddy.me`, ancien chemin
`/api/manga/{id}/chapters?source=detail`) rendent tous 400 ou 404. Sur une serie
longue on voit donc les 50 derniers chapitres. Le tout premier est repeche via
`firstChapter` pour que le lecteur garde un point d'entree.

## 4. Corrections d'index sans changement de code

- **`lightnovelpub`** : repassee de `dead` a `active`. Cloudflare en mode
  « managed » (403 + `cf-ray`, revalide le 2026-09-04) faisait rendre RED au
  harnais depuis du HTTP natif. Le defaut etait dans la mesure, pas dans
  l'extension : le navigateur embarque resout le defi, d'ou `cloudflare: true`.
- **`novelfull`, `novelupdates`, `scribblehub`** : meme situation, deja `active`,
  inchangees. Elles rendent `BLOCKED-CF` au harnais, ce qui est le comportement
  attendu.
- **`novelbin`** : laissee `dead`, avec la cause mesuree. `novelbin.com` n'a plus
  aucun DNS ; `novelbin.net` repond mais sert une redirection JavaScript a jeton,
  et une fois le defi franchi la page ne contient zero caractere de texte visible
  ni aucun lien d'oeuvre — rien ne prouve qu'il s'agisse du meme service.
  `novelbin.org`, `.io` et `.me` sont sans DNS.

## 5. Deux entrees retirees du catalogue

Les fichiers `.js` restent dans le depot ; seules les entrees d'`index.json` sont
retirees, pour que le catalogue ne montre que ce qui marche.

- **`allnovel`** : `allnovel.org` redirige vers `novelfull.com`. C'est un doublon
  strict de l'extension `novelfull`, deja presente et fonctionnelle. Au passage,
  son drapeau `cloudflare` etait a `false` alors que le site rend un 403 Cloudflare.
- **`light_novel_fr`** : `novel-fr.net` n'a plus aucun enregistrement DNS.
  `novelfr.com` a repris le nom (« Novel FR — Light novel en francais ») mais ne
  sert qu'un WordPress vierge, theme Kadence, dont le seul contenu est l'article
  de demonstration `hello-world`. Il n'y a rien a lire. A surveiller : si le site
  se remplit, l'extension est recuperable depuis le depot.

## 6. Etat final du catalogue light novel

17 entrees au catalogue (19 fichiers moins les 2 retires) :

- **12 lisibles de bout en bout** : chireads, kisswood, lnmtl, massnovel,
  noveldeglace, novelbuddy, novelfire, novhell, royal_road, warriorlegendtrad,
  wuxialnscantrad, xiaowaz.
- **4 protegees par Cloudflare**, saines, resolues par le navigateur embarque de
  l'app : lightnovelpub, novelfull, novelupdates, scribblehub.
- **1 morte**, cause mesuree : novelbin.

## 7. Ce qui reste a faire

- **Confirmer sur appareil** les 4 extensions Cloudflare. Le harnais ne peut pas
  les mesurer par construction : il faudrait ouvrir un chapitre depuis l'app.
- **Surveiller `novelfr.com`** : si le site se remplit, `light_novel_fr` revient
  au catalogue.
- **Trouver la pagination de `novelbuddy`** : il faudrait observer les appels que
  fait le site depuis un navigateur pour decouvrir le chemin qui sert la suite des
  chapitres.
- **Passer les 27 extensions manga au nouveau harnais.** Le seuil de texte reel et
  l'echantillonnage sur trois chapitres sont posterieurs au dernier triage manga
  (`tools/triage-report.csv`, commit f303420) : les memes faux verts y sont donc
  possibles.
