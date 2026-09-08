# Triage refait sur un harnais honnete, et quatre domaines morts

Date : 2026-09-08. Tout ce qui suit est mesure, pas deduit.

## 1. Le harnais mesurait sa propre absence

Le socle du harnais se declarait copie fidele de celui de l'app. Il en avait
perdu **dix declarations sur douze** : tout le substitut de `DOMParser` et le
decodage base64.

| | socle de l'app | socle du harnais (avant) |
|---|---|---|
| classes de base | MProvider, LNProvider | MProvider, LNProvider |
| lecture du HTML | DOMParser, _FakeDocument, _FakeElement, _querySelectorAll, _matchesSelector, _parseSimpleSelector, _findClosingTag, _findMatching | aucune |
| base64 | atob, btoa | aucune |
| total | 455 lignes | 180 lignes |

Consequence : les deux seules extensions qui appellent `DOMParser`
(`anime_sama`, `bato`) etaient classees ROUGE avec zero oeuvre, sans etre en
cause. `royal_road` ne le mentionne qu'en commentaire et etait VERT.

**Cause de la perte.** Le socle etait stocke dans une chaine a apostrophes
inverses et le JS de l'app en contient dix : la premiere terminait la chaine. Il
vit maintenant dans un fichier texte brut (`tools/runtime-base.jsbody`), recopie
par `tools/sync-runtime-base.js`. Le test echoue si les deux divergent.

**Second defaut du meme ordre.** Le socle de l'app definit `fetchv2` en termes de
`sendMessage` ; le harnais posait son propre `fetchv2`, qui le masquait. Il
testait donc un chemin que le telephone n'emprunte pas : la lecture des deux
conventions d'en-tetes et la serialisation du corps vivent cote Dart. Le harnais
fournit desormais `sendMessage` (`tools/bridge.js`), avec les formes de retour
exactes du pont Dart.

## 2. Verdicts apres correction

49 extensions : 31 VERT, 1 PARTIEL, 13 bloquees par Cloudflare, 4 ROUGE.
`anime_sama` est passe de ROUGE 0/0 a **VERT 3/3** — 48 oeuvres, 49 chapitres,
59 pages, trois couvertures joignables — sans toucher a sa logique de lecture.

## 3. anime-sama : le vrai defaut, plus petit que prevu

Le catalogue annonce dans la categorie Scans des oeuvres que l'arriere-plan de
scans ne connait pas. Sur « 07 Ghost » :

| Etape | Reponse |
|---|---|
| `/catalogue/?type[]=Scans` | l'oeuvre est listee |
| `/catalogue/07-ghost/scan/vf/` | 200, `#titreOeuvre` = « 07 Ghost » |
| `get_nb_chap_et_img.php?oeuvre=07 Ghost` | **200**, corps `{"error":"Oeuvre '07 Ghost' not found"}` |

L'extension traversait ce cas sans rien dire et rendait une liste vide, qui se
lit comme « pas encore de chapitre publie ». Corrige : une erreur du site et une
oeuvre neuve ne se ressemblent plus.

Note au passage : `type[0]=Scans` et `type[]=Scans` donnent le meme resultat
(PHP lit l'index explicite comme un element de tableau). Le filtre n'etait pas
en cause.

## 4. Les quatre ROUGE restants : des sites, pas des extensions

| Extension | Domaine declare | DNS | Etat reel |
|---|---|---|---|
| `bato` | bato.to | **aucun enregistrement** | miroirs vivants (batotoo.com, bato.si, batocomic.com) mais tous derriere un interstitiel JavaScript |
| `manhwaz` | manhwaz.com | **aucun enregistrement** | manhwaz.net repond, meme interstitiel que bato (script identique) |
| `novelbin` | novelbin.com | **aucun enregistrement** | novelbin.net et binnovel.com repondent, redirection JavaScript a deux etages |
| `light_novel_fr` | novel-fr.net | **aucun enregistrement** | aucun remplacant trouve ; novelfr.com est un autre site, 2 romans au catalogue |

### Pourquoi le contournement actuel ne les franchit pas

`CloudflareBypassService.isCfChallenge` exige un code **403, 503 ou 429**. Ces
interstitiels repondent **200**. L'intercepteur ne se declenche donc jamais.

Et l'elargir ne suffirait pas : la resolution sans fenetre exige un cookie
`cf_clearance` et ne recolte que des cookies Cloudflare. Ces pages n'en posent
aucun — la resolution rendrait `null`.

Le mandataire par navigateur (`WebViewHttpProxy`) existe sur mobile, mais il
execute `fetch()` dans le contexte du navigateur : il preserve l'empreinte TLS,
il ne fait pas tourner le JavaScript de la page. Franchir ces interstitiels
demande un mode « naviguer puis lire le DOM », qui n'existe pas encore.

### Comment reconnaitre un interstitiel (mesure de calibrage)

Texte visible apres retrait des scripts, styles et balises :

| Page | HTML | Texte visible | Redirection cote client |
|---|---|---|---|
| batotoo.com/browse | 4 719 | **14** | oui |
| manhwaz.net | 4 705 | **14** | oui |
| novelbin.net | 474 | **10** | oui |
| binnovel.com | 1 052 | **32** | oui (empreinte de navigateur) |
| anime-sama catalogue | 357 606 | 38 748 | non |
| royalroad classement | 161 227 | 30 446 | non |
| mangadex accueil | 6 850 | 102 | non |

Les deux conditions ensemble separent proprement : **une redirection cote client
ET moins de 200 caracteres de texte visible**. Le cas mangadex montre pourquoi il
faut les deux — une coquille remplie cote client a peu de texte mais ne redirige
pas.

## 5. Ce qui reste ouvert

- Un mode « naviguer puis lire le DOM » dans `WebViewHttpProxy` debloquerait
  `bato`, `manhwaz` et `novelbin`. Non fait : il ne se verifie pas sans appareil.
- `light_novel_fr` n'a pas de remplacant. A retirer ou a remplacer par une autre
  source francaise.
- `mangapark1` est PARTIEL (1 chapitre lisible sur 3), non diagnostique.
