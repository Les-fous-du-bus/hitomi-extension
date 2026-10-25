# Vérifier une extension

`node tools/ext-test.js src/manga/asurascans.js` exécute le catalogue, la recherche et trois chapitres. Pour les mangas, le verdict exige maintenant des index uniques et contigus et des octets d’images réels sur les pages échantillonnées, dont la page 20 quand elle existe. Un HTTP 200 ou Content-Type image/jpeg ne suffit pas.

Les fichiers `tools/*.test.js` se lancent avec `node --test tools/*.test.js`. Les tests de sélecteurs utilisent des réponses contrôlées ; le contrôle HTTP reste nécessaire. Le harnais Node ne valide pas le runtime QuickJS, les protections ni les sessions de l’appareil Android. Un verdict GREEN porte sur les échantillons mesurés, jamais sur tous les chapitres d’un site.

Le 25 octobre 2026, MangaRead sert un document HTML 521 sous des URL JPEG de Superhuman Era. Aucune correction de sélecteur ni résolution de défi ne recrée ces images. Le harnais doit signaler cet échec, sans le convertir en succès.
