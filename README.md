# Hitomi Extensions Repository

Depot d'extensions pour l'application Hitomi (manga, light novel, webtoon reader).

## Ajouter ce depot dans Hitomi

1. Ouvrir Hitomi
2. Aller dans **Parametres > Extensions > Depots**
3. Ajouter l'URL du depot :
   ```
   https://raw.githubusercontent.com/Les-fous-du-bus/hitomi-extension/main/index.json
   ```
4. Les extensions apparaissent dans l'ecran **Decouvrir > Sources**

## Extensions disponibles

### Manga

| Extension | Langue | Cloudflare | Mature | Risque obsolescence |
|-----------|--------|------------|--------|---------------------|
| MangaDex | multi | Non | Non | low |
| ScanVF | fr | Oui | Non | high |
| Bato.to | multi | Oui | Oui | high |
| MangaPlus | fr | Non | Non | low |

### Light Novel

| Extension | Langue | Cloudflare | Mature | Risque obsolescence |
|-----------|--------|------------|--------|---------------------|
| LightNovelFR | fr | Non | Non | medium |
| NovelIndex | fr | Non | Non | medium |
| Royal Road | en | Non | Oui | medium |

## Structure du depot

```
index.json              -- Index des extensions (lu par Hitomi)
sources/
  manga/
    mangadex.js
    scan_vf.js
    bato.js
    manga_plus.js
  novel/
    light_novel_fr.js
    novel_index.js
    royal_road.js
```

## Format index.json

Chaque entree dans le tableau `extensions` contient :

| Champ | Type | Description |
|-------|------|-------------|
| `id` | string | Identifiant unique de l'extension |
| `name` | string | Nom d'affichage |
| `lang` | string | Code langue ISO (fr, en, multi) |
| `space` | string | Type de contenu : "manga" ou "light_novel" |
| `version` | number | Version de l'extension |
| `mature` | boolean | Contenu adulte |
| `cloudflare` | boolean | Protection Cloudflare active |
| `jsUrl` | string | Chemin relatif vers le fichier JS |
| `iconUrl` | string | URL de l'icone de la source |
| `status` | string | "active" ou "deprecated" |
| `obsolescenceRisk` | string | "low" (API), "medium" (scraping), "high" (CF) |
| `sha256` | string | Hash SHA-256 du fichier JS pour verification d'integrite |

Les `jsUrl` sont relatifs a la racine du depot. Hitomi resout le chemin complet
en utilisant le repertoire parent de l'URL `index.json` comme base.

## Contribuer

Pour ajouter une extension :
1. Creer le fichier JS dans `sources/manga/` ou `sources/novel/`
2. Ajouter l'entree correspondante dans `index.json`
3. Calculer le SHA-256 : `sha256sum sources/manga/mon_extension.js`
4. Ouvrir une pull request
