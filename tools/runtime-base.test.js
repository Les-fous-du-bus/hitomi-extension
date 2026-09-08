// Le harnais doit executer EXACTEMENT ce que le telephone execute.
//
// POURQUOI ce fichier existe : le socle du harnais se declarait "copie fidele"
// du socle de l'app alors qu'il en avait perdu les trois quarts — dont le
// substitut de DOMParser. Consequence mesuree le 2026-09-08 : les deux seules
// extensions qui appellent DOMParser (anime_sama, bato) etaient classees ROUGE
// avec zero oeuvre, alors que leur code n'etait pas en cause. Le harnais
// mesurait l'absence de son propre socle.
//
// La cause de la perte est mecanique : le socle etait stocke dans une chaine a
// apostrophes inverses, et le JS de l'app en contient dix. La premiere termine
// la chaine. D'ou le stockage en fichier texte brut, ou aucun caractere n'a de
// sens particulier.
//
// Lancer : node --test tools/runtime-base.test.js

const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const { RUNTIME_BASE_JS } = require('./runtime-base.js');
const { extraireSocleDepuisDart, cheminSourceDart } = require('./sync-runtime-base.js');

// Une classe declaree dans un contexte vm vit dans sa portee lexicale, pas sur
// l'objet du bac a sable : `sandbox.MProvider` est indefini alors que le nom est
// bien resolu par le code qui tourne DEDANS. Les extensions tournant dedans, on
// mesure de la meme place qu'elles — sinon le test dirait absent ce qui est la.
function bacASable() {
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, Date, Math, JSON,
    RegExp, Error, Object, Array, String, Number, Boolean, Symbol, Map, Set,
    encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
    parseInt, parseFloat, isNaN, isFinite, URL, URLSearchParams,
    fetchv2: async () => '', fetchBinary: async () => '',
  };
  vm.createContext(sandbox);
  vm.runInContext(RUNTIME_BASE_JS, sandbox);
  return {
    // Evalue une expression a l'interieur du contexte et rend une valeur simple.
    ev: (expression) => vm.runInContext(expression, sandbox),
  };
}

test('le socle fournit ce que les extensions appellent', async (t) => {
  const s = bacASable();

  await t.test('les deux classes de base sont la', () => {
    assert.strictEqual(s.ev('typeof MProvider'), 'function');
    assert.strictEqual(s.ev('typeof LNProvider'), 'function');
  });

  await t.test('DOMParser est fourni, comme sur le telephone', () => {
    assert.strictEqual(s.ev('typeof DOMParser'), 'function',
      'sans DOMParser le harnais classe ROUGE une extension saine');
  });

  await t.test('le decodage base64 est fourni', () => {
    assert.strictEqual(s.ev('typeof atob'), 'function');
    assert.strictEqual(s.ev('typeof btoa'), 'function');
  });
});

test('le substitut de DOMParser lit vraiment une page', async (t) => {
  const s = bacASable();

  // Fragment recopie de la page catalogue d'anime-sama le 2026-09-08 : c'est la
  // forme exacte que l'extension doit savoir lire, adresses absolues comprises.
  // Il est pose DANS le contexte, la ou tourne une extension.
  s.ev(String.raw`
    var HTML_CATALOGUE = `
    + '`' + String.raw`
    <div id="list_catalog">
      <div class="shrink-0 catalog-card card-base">
        <a href="https://anime-sama.to/catalogue/07-ghost">
          <div class="card-image-container">
            <img loading="lazy" class="card-image"
                 src="https://cdn.jsdelivr.net/gh/Anime-Sama/IMG@img/contenu/thumb/07-ghost.webp"
                 alt="07 Ghost">
          </div>
          <div class="card-content">
            <h2 class="card-title">07 Ghost</h2>
          </div>
        </a>
      </div>
      <div class="shrink-0 catalog-card card-base">
        <a href="https://anime-sama.to/catalogue/20th-century-boys">
          <div class="card-content">
            <h2 class="card-title">20th Century Boys</h2>
          </div>
        </a>
      </div>
    </div>` + '`' + String.raw`;
    var DOC_CATALOGUE = new DOMParser().parseFromString(HTML_CATALOGUE, "text/html");
  `);

  await t.test('le selecteur par attribut trouve les liens', () => {
    assert.strictEqual(
      s.ev(`DOC_CATALOGUE.querySelectorAll("a[href*='/catalogue/']").length`), 2);
  });

  await t.test('un selecteur compose descend dans la fiche', () => {
    assert.strictEqual(s.ev(`DOC_CATALOGUE.querySelectorAll("h2.card-title").length`), 2);
    assert.strictEqual(
      s.ev(`DOC_CATALOGUE.querySelectorAll("h2.card-title")[0].textContent`), '07 Ghost');
  });

  await t.test('les attributs sont lisibles', () => {
    assert.strictEqual(
      s.ev(`DOC_CATALOGUE.querySelector("a[href*='/catalogue/']").getAttribute("href")`),
      'https://anime-sama.to/catalogue/07-ghost');
  });

  await t.test('une recherche imbriquee part bien de l element', () => {
    const src = s.ev(
      `DOC_CATALOGUE.querySelector("a[href*='/catalogue/']").querySelector("img").getAttribute("src")`);
    assert.match(src, /07-ghost\.webp$/);
  });

  await t.test('getElementById repond', () => {
    assert.ok(s.ev(`!!DOC_CATALOGUE.getElementById("list_catalog")`));
  });
});

test('le socle ne peut plus deriver de celui de l app', async (t) => {
  const dart = cheminSourceDart();

  await t.test('la source Dart est joignable', () => {
    assert.ok(fs.existsSync(dart),
      `source introuvable : ${dart}\n` +
      'Poser HITOMI_APP_DIR sur le dossier du depot de l app si elle est ailleurs.');
  });

  await t.test('le socle du harnais est identique a celui de l app', () => {
    const attendu = extraireSocleDepuisDart(dart);
    assert.strictEqual(RUNTIME_BASE_JS.trim(), attendu.trim(),
      'Le socle a derive. Relancer : node tools/sync-runtime-base.js');
  });
});

test('le fichier de socle ne subit aucune interpretation', () => {
  // Le stockage precedent etait une chaine a apostrophes inverses ; le JS de
  // l'app en contient. Ce test echoue si quelqu'un revient a ce stockage.
  const corps = fs.readFileSync(path.join(__dirname, 'runtime-base.jsbody'), 'utf8');
  assert.ok(corps.includes('`'), 'le socle contient des apostrophes inverses');
  assert.ok(RUNTIME_BASE_JS.includes('`'),
    'elles doivent survivre au chargement, donc pas de chaine a apostrophes inverses');
});
