const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');

let server;
let base;

before(async () => {
  const app = createApp(openDatabase(':memory:'));
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function req(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

test('cycle de vie complet d’un produit', async () => {
  const cree = await req('POST', '/api/produits', {
    reference: 'CAF-001', nom: 'Café 1kg', categorie: 'Épicerie', prix: 12.5, quantite: 10, seuil_alerte: 3,
  });
  assert.equal(cree.status, 201);
  assert.equal(cree.body.quantite, 10);
  const id = cree.body.id;

  // Le stock initial est tracé comme un mouvement
  let mvts = await req('GET', `/api/mouvements?produit_id=${id}`);
  assert.equal(mvts.body.length, 1);
  assert.equal(mvts.body[0].type, 'entree');

  const sortie = await req('POST', '/api/mouvements', { produit_id: id, type: 'sortie', quantite: 8 });
  assert.equal(sortie.status, 201);
  assert.equal(sortie.body.produit.quantite, 2);

  const alertes = await req('GET', '/api/produits?alerte=1');
  assert.deepEqual(alertes.body.map((p) => p.id), [id]);

  const stats = await req('GET', '/api/stats');
  assert.equal(stats.body.valeur_stock, 25);
  assert.equal(stats.body.nb_alertes, 1);
  assert.deepEqual(stats.body.categories, ['Épicerie']);

  const modif = await req('PUT', `/api/produits/${id}`, { nom: 'Café moulu 1kg', quantite: 999 });
  assert.equal(modif.body.nom, 'Café moulu 1kg');
  assert.equal(modif.body.quantite, 2, 'la quantité ne change pas via PUT');

  assert.equal((await req('DELETE', `/api/produits/${id}`)).status, 204);
  assert.equal((await req('GET', `/api/produits/${id}`)).status, 404);
  mvts = await req('GET', `/api/mouvements?produit_id=${id}`);
  assert.equal(mvts.body.length, 0);
});

test('refuse une sortie supérieure au stock', async () => {
  const { body: p } = await req('POST', '/api/produits', { reference: 'STY-01', nom: 'Stylo', quantite: 2 });
  const r = await req('POST', '/api/mouvements', { produit_id: p.id, type: 'sortie', quantite: 5 });
  assert.equal(r.status, 400);
  assert.match(r.body.erreur, /Stock insuffisant/);
  assert.equal((await req('GET', `/api/produits/${p.id}`)).body.quantite, 2);
});

test('valide les données', async () => {
  assert.equal((await req('POST', '/api/produits', { nom: 'Sans ref' })).status, 400);
  assert.equal((await req('POST', '/api/produits', { reference: 'X', nom: 'X', prix: -1 })).status, 400);
  assert.equal((await req('POST', '/api/produits', { reference: 'Y', nom: 'Y', quantite: 1.5 })).status, 400);
  await req('POST', '/api/produits', { reference: 'DUP', nom: 'A' });
  assert.equal((await req('POST', '/api/produits', { reference: 'DUP', nom: 'B' })).status, 409);
  assert.equal((await req('POST', '/api/mouvements', { produit_id: 1, type: 'vol', quantite: 1 })).status, 400);
  assert.equal((await req('POST', '/api/mouvements', { produit_id: 9999, type: 'entree', quantite: 1 })).status, 404);
});
