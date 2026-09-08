# Sources de romans web sondees, et trois retenues

Date : 2026-09-08. 46 domaines testes avec `curl` avant tout code. Ce document
garde les mesures pour qu'on ne refasse pas le chemin.

## Ce qui a ete construit

| Extension | Langue | Volume mesure | Chapitre lu | Verdict du harnais |
|---|---|---|---|---|
| `lightnovelvf` | FR | ~1440 oeuvres (30 x 48 pages) | 8898 a 20241 car. | VERT 3/3 |
| `trad-index` | FR | ~576 oeuvres (24 x 24 pages) | 10023 a 11434 car. | VERT 3/3 |
| `readnovelfull` | EN | ~2400 oeuvres (20 x 120 pages) | 7454 a 12455 car. | VERT 3/3 |

Chacune a ses couvertures verifiees joignables (3/3) et ses tests hors ligne.

## Deux conclusions du sondage initial que la mesure a renversees

**Baka-Tsuki n'est pas le meilleur candidat, malgre son interface.** Son
`api.php` MediaWiki 1.43.1 est effectivement propre et documente, et
`Category:French` rend bien 93 projets. Mais compter les chapitres par projet
change le verdict :

| Projet | pages FR | pages EN | pages ID |
|---|---|---|---|
| Absolute Duo | **6** | 74 | 15 |
| Boku wa Tomodachi ga Sukunai | **1** | 49 | 24 |
| Bienvenue a la N.H.K. ! | **0** | 0 | 0 |
| 86 | **0** | 0 | 0 |

Les 93 « projets francais » sont surtout des pages de presentation sans
traduction. Deux pieges s'ajoutent : l'espace de noms d'un projet est
**multilingue** (on y trouve de l'indonesien sous le meme prefixe), et le
nommage varie jusqu'a la ponctuation (`Absolute Duo:Tome 1 Chapitre 1` mais
`Absolute Duo : Tome 1 Prologue`). Une extension y rendrait 93 oeuvres dont la
plupart s'ouvriraient sur zero ou deux chapitres — exactement le defaut que le
triage sert a attraper. Baka-Tsuki reste interessant cote ANGLAIS, pour des
series anciennes, mais pas en priorite.

**J-Garden est un site d'equipe, pas un catalogue.** WordPress avec `wp-json`
ouvert, mais aucun type de contenu dedie : les oeuvres sont des pages faites a la
main sous une mise en page Elementor, environ 26 au total, sans page de catalogue
reguliere. Le texte y est excellent (21 279 caracteres par chapitre) mais le cout
de suivi depasse l'apport.

**novelfr.com n'est pas le successeur de novel-fr.net.** Il repond, il est bien
en francais, et son catalogue compte **2 romans**. Il expose `wp-json`, ce qui
serait exploitable, mais il n'y a rien a lire.

## Les sources retenues et non construites

Par ordre d'interet mesure, si on veut aller plus loin :

| Source | Langue | Volume | Interet | Reserve |
|---|---|---|---|---|
| Ranobes | EN | ~10 000 oeuvres (24 x 421 pages) | le plus gros volume du panel | sa page de liste des chapitres rend « No results » ; il faut passer par `/chapters/ID/first` |
| WeTriedTLS | EN | 79 series | interface JSON complete (`api.wetriedtls.com/query`), la plus propre techniquement | petit catalogue |
| Wattpad | EN+FR | hors norme | interface `v3` publique sans cle | fiction amateur generique, pas du light novel |
| LibRead, FanMTL, HostedNovel, Hiraeth | EN | 11 a 30 par page | sans defi Cloudflare | volume total non mesure |
| Wuxiaworld | EN | 16 rendues cote serveur | chapitre 1 libre a 16 760 car. | part payante non mesuree |

## Ce qui a ete ecarte, et pourquoi

- **Sept sites en defi Cloudflare** (freewebnovel, novelhall, lightnovelworld,
  webnovel, inkitt, penana, foxaholic) : 403 avec `cf-mitigated: challenge`. Le
  navigateur embarque de l'app passera peut-etre — aucune donnee pour l'affirmer.
- **WTR-LAB** : l'interface repond, le corps du chapitre arrive **chiffre**
  (`arr:<base64>:<base64>`). Seule la metadonnee de longueur est lisible.
- **NovelCool** : lecteur a images, pas de texte (316 caracteres par chapitre).
- **Gravity Tales** : chapitres payants en points, quatre testes, quatre
  verrouilles.
- **Novel-Index** : annuaire qui redirige vers les sites des equipes. Utile comme
  source de metadonnees (44 equipes, ~1000 oeuvres), pas comme lecteur.
- **massnovel.fr / novelfrance.fr** : c'est la cible de `massnovel.js`, deja
  couverte.
- **Domaines morts** : jeeo-team.fr, whitenovels.com, novel-fr.com,
  lightnovel-francaises.fr (page vide), zetrotranslation et dragonholic (en
  demenagement), mtlnovels (redirige vers un domaine parasite).
- **WuxiaBox** : clone de FanMTL, texte identique au caractere pres.

## Ce qui n'a pas ete mesure, et doit etre dit

- La tenue dans la duree : un seul appel par site, depuis une seule adresse,
  sans test de cadence. Rien ne dit comment ces sites reagissent a une
  application qui telecharge des dizaines de chapitres d'affilee.
- Le volume total de libread, hostednovel, wuxiabox et fanmtl : aucun compteur
  de pages dans leur HTML.
- Le volet juridique. Chrysanthemum Garden affiche avoir retire ses romans
  coreens sur mise en demeure ; c'est un rappel que la disponibilite d'une source
  n'est pas sa perennite.
