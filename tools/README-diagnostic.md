# Vérifier une extension

`node tools/ext-test.js src/manga/asurascans.js` exécute le catalogue, la recherche et trois chapitres. Pour les mangas, le verdict exige maintenant des index uniques et contigus et des octets d’images réels sur les pages échantillonnées, dont la page 20 quand elle existe. Un HTTP 200 ou Content-Type image/jpeg ne suffit pas.

Les fichiers `tools/*.test.js` se lancent avec `node --test tools/*.test.js`. Les tests de sélecteurs utilisent des réponses contrôlées ; le contrôle HTTP reste nécessaire. Le harnais Node ne valide pas le runtime QuickJS, les protections ni les sessions de l’appareil Android. Un verdict GREEN porte sur les échantillons mesurés, jamais sur tous les chapitres d’un site.

Le 25 octobre 2026, MangaRead sert un document HTML 521 sous des URL JPEG de Superhuman Era. Aucune correction de sélecteur ni résolution de défi ne recrée ces images. Le harnais doit signaler cet échec, sans le convertir en succès.

## MangaHere, 26 octobre 2026

Les chapitres modernes peuvent contenir la liste complète `newImgs` dans un script packed. Le dépaquetage extrait les URL sans exécuter ce code. Ne pas imposer le lecteur historique `chapterfun.ashx` à ce format. La capture de Seoul chapitre 3 et les tests dans `mangahere.test.js` couvrent ce cas ainsi que le repli historique. Les six chapitres 1, 3, 4, 5, 6 et 12 ont été contrôlés sur HTTP avec signatures binaires des 544 URL ; cela ne remplace pas un essai sur appareil Android.
