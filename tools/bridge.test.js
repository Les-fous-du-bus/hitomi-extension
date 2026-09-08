// Le pont JS -> reseau du harnais doit rendre la MEME forme que le pont Dart.
//
// POURQUOI ce fichier existe : le socle de l'app definit `fetchv2` en termes de
// `sendMessage`, et le harnais fournissait son propre `fetchv2` a la place. Il
// court-circuitait donc le chemin reel. Une fois le socle recopie fidelement,
// `sendMessage` manquait et bato rendait "sendMessage is not defined". Le pont
// doit exister ET rendre la forme attendue, sinon `result.body` est indefini et
// toute extension rend du vide sans erreur visible.
//
// Formes attendues, relevees dans m_provider_wrapper.dart :
//   fetchv2      -> { status, headers, body, error? }
//   fetchBinary  -> { status, headers, base64, error? }
//   storage_get  -> la valeur, ou null
//
// Lancer : node --test tools/bridge.test.js

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const { creerPont } = require('./bridge.js');

// Un serveur local evite de dependre d'un site en ligne pour tester le pont.
// Il est volontairement bavard sur ce qu'il a recu : c'est ce qui permet de
// verifier que la methode, les en-tetes et le corps traversent vraiment.
function serveurLocal() {
  return new Promise((resolve) => {
    const recus = [];
    const srv = http.createServer((req, res) => {
      let corps = '';
      req.on('data', (c) => { corps += c; });
      req.on('end', () => {
        recus.push({ methode: req.method, chemin: req.url, entetes: req.headers, corps });
        if (req.url === '/binaire') {
          res.writeHead(200, { 'Content-Type': 'image/png' });
          res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
          return;
        }
        if (req.url === '/erreur') {
          res.writeHead(503, { 'Content-Type': 'text/html' });
          res.end('<html>indisponible</html>');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body>bonjour</body></html>');
      });
    });
    srv.listen(0, '127.0.0.1', () => {
      resolve({ base: `http://127.0.0.1:${srv.address().port}`, recus, fermer: () => srv.close() });
    });
  });
}

test('le pont rend la forme du pont Dart', async (t) => {
  const srv = await serveurLocal();
  const sendMessage = creerPont({});

  try {
    await t.test('fetchv2 rend status, headers et body', async () => {
      const r = await sendMessage('fetchv2', JSON.stringify([srv.base + '/page', {}]));
      assert.strictEqual(r.status, 200);
      assert.strictEqual(typeof r.headers, 'object');
      assert.match(r.body, /bonjour/);
      assert.strictEqual(r.error, undefined);
    });

    await t.test('fetchBinary rend du base64, pas du texte', async () => {
      const r = await sendMessage('fetchBinary', JSON.stringify([srv.base + '/binaire', {}]));
      assert.strictEqual(r.status, 200);
      // 0x89 'P' 'N' 'G' encode en base64 donne iVBORw==
      assert.strictEqual(r.base64, 'iVBORw==');
    });

    await t.test('un code d erreur remonte sans lever', async () => {
      const r = await sendMessage('fetchv2', JSON.stringify([srv.base + '/erreur', {}]));
      assert.strictEqual(r.status, 503);
      assert.match(r.body, /indisponible/);
    });

    await t.test('une adresse injoignable rend un champ error', async () => {
      const r = await sendMessage('fetchv2', JSON.stringify(['http://127.0.0.1:1/x', {}]));
      assert.ok(r.error, 'le pont Dart met le probleme dans error, il ne leve pas');
      assert.strictEqual(r.status, 0);
    });
  } finally {
    srv.fermer();
  }
});

test('les deux conventions d en-tetes sont acceptees', async (t) => {
  const srv = await serveurLocal();
  const sendMessage = creerPont({});

  try {
    // Le pont Dart accepte les en-tetes imbriques dans `headers` ET poses a plat
    // dans les options ; certaines extensions font l'un, d'autres l'autre.
    await t.test('en-tetes imbriques', async () => {
      await sendMessage('fetchv2', JSON.stringify([srv.base + '/a',
        { headers: { 'X-Essai': 'imbrique' } }]));
      assert.strictEqual(srv.recus.at(-1).entetes['x-essai'], 'imbrique');
    });

    await t.test('en-tetes a plat', async () => {
      await sendMessage('fetchv2', JSON.stringify([srv.base + '/b',
        { 'X-Essai': 'plat' }]));
      assert.strictEqual(srv.recus.at(-1).entetes['x-essai'], 'plat');
    });

    await t.test('un POST avec un objet est serialise en formulaire', async () => {
      await sendMessage('fetchv2', JSON.stringify([srv.base + '/c',
        { method: 'POST', body: { action: 'chercher', page: 2 } }]));
      const recu = srv.recus.at(-1);
      assert.strictEqual(recu.methode, 'POST');
      assert.strictEqual(recu.corps, 'action=chercher&page=2');
      assert.match(recu.entetes['content-type'], /x-www-form-urlencoded/);
    });

    await t.test('un corps deja en chaine passe tel quel', async () => {
      await sendMessage('fetchv2', JSON.stringify([srv.base + '/d',
        { method: 'POST', body: '{"deja":"json"}', headers: { 'Content-Type': 'application/json' } }]));
      assert.strictEqual(srv.recus.at(-1).corps, '{"deja":"json"}');
    });

    await t.test('une identite de navigateur est posee par defaut', async () => {
      await sendMessage('fetchv2', JSON.stringify([srv.base + '/e', {}]));
      assert.match(srv.recus.at(-1).entetes['user-agent'] || '', /Mozilla/);
    });
  } finally {
    srv.fermer();
  }
});

test('le stockage tient en memoire pendant l essai', async (t) => {
  const sendMessage = creerPont({});

  await t.test('une cle absente rend null', async () => {
    assert.strictEqual(await sendMessage('storage_get', JSON.stringify({ key: 'absente' })), null);
  });

  await t.test('ecrire puis relire rend la valeur', async () => {
    await sendMessage('storage_set', JSON.stringify({ key: 'jeton', value: 'abc' }));
    assert.strictEqual(await sendMessage('storage_get', JSON.stringify({ key: 'jeton' })), 'abc');
  });

  await t.test('retirer une cle la fait disparaitre', async () => {
    await sendMessage('storage_remove', JSON.stringify({ key: 'jeton' }));
    assert.strictEqual(await sendMessage('storage_get', JSON.stringify({ key: 'jeton' })), null);
  });
});

test('l observateur voit passer chaque reponse', async (t) => {
  const srv = await serveurLocal();
  const vues = [];
  const sendMessage = creerPont({ observer: (info) => vues.push(info) });

  try {
    await t.test('le code et la detection Cloudflare sont rapportes', async () => {
      await sendMessage('fetchv2', JSON.stringify([srv.base + '/page', {}]));
      assert.strictEqual(vues.length, 1);
      assert.strictEqual(vues[0].status, 200);
      assert.strictEqual(vues[0].cloudflare, false);
    });
  } finally {
    srv.fermer();
  }
});

test('une page d attente Cloudflare est reconnue', () => {
  const { estPageCloudflare } = require('./bridge.js');
  assert.ok(estPageCloudflare('<title>Just a moment...</title>'));
  assert.ok(estPageCloudflare('<div id="cf-browser-verification">'));
  assert.ok(estPageCloudflare('challenge-platform/h/b/orchestrate'));
  assert.ok(estPageCloudflare('<h1>Attention Required!</h1>'));
  assert.ok(!estPageCloudflare('<html><body>un vrai catalogue</body></html>'));
});
