const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chargerExtension } = require("./ext-harness.js");
const source = path.join(__dirname, "../src/novel/novelupdates.js");
const fail = { error: "connexion interrompue" };
test("les erreurs reseau ne deviennent pas des catalogues ou fiches vides", async () => {
 const { ext } = chargerExtension(source, { "/series-ranking/": fail, "/series-finder/": fail, "/series/example/": fail });
 await assert.rejects(ext.getPopular(1), /connexion interrompue/);
 await assert.rejects(ext.getLatestUpdates(1), /connexion interrompue/);
 await assert.rejects(ext.search("test", 1, {}), /connexion interrompue/);
 await assert.rejects(ext.getMangaDetail("https://www.novelupdates.com/series/example/"), /connexion interrompue/);
});

test("une panne de chapitre est signalee et pas sauvegardee comme texte", async () => {
 const { ext } = chargerExtension(source, { "/series/example/": fail, "/chapter-fail": fail, "/chapter-empty": "<html><body>Indisponible</body></html>" });
 await assert.rejects(ext.getChapterList("https://www.novelupdates.com/series/example/"), /connexion interrompue/);
 await assert.rejects(ext.getContent("https://www.novelupdates.com/chapter-fail"), /connexion interrompue/);
 await assert.rejects(ext.getContent("https://www.novelupdates.com/chapter-empty"), /contenu indisponible/);
});
