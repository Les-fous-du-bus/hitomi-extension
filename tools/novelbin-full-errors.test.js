const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chargerExtension } = require("./ext-harness.js");
for (const id of ["novelbin"]) {
  const source = path.join(__dirname, "../src/novel/" + id + ".js");
  test(id + " refuses a missing chapter body instead of a fake download", async () => {
    const { ext } = chargerExtension(source, { "/chapter-1": "<html><body>Not available</body></html>" });
    await assert.rejects(ext.parseChapter("https://example.org/chapter-1"), /Contenu du chapitre indisponible/);
  });
}
