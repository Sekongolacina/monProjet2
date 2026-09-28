const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { demarrer } = require('./aide');

let env, admin, gestion;
before(async () => {
  env = await demarrer();
  admin = await env.client().connecter('admin');
  gestion = await env.client().connecter('gestion');
});
after(() => env.fermer());

test('un entrepôt principal existe par défaut', async () => {
  const { body } = await gestion.get('/api/entrepots');
  assert.deepEqual(body.map((e) => e.nom), ['Entrepôt principal']);
});

test('multi-entrepôts : entrées, transferts et sorties', async () => {
  const { body: e2 } = await admin.post('/api/entrepots', { nom: 'Dépôt Nord', adresse: 'Lille' });
  const { body: fo } = await gestion.post('/api/fournisseurs', { nom: 'Torréfaction Dupont', email: 'contact@dupont.fr' });

  const { body: p, status } = await gestion.post('/api/produits', {
    reference: 'CAF-001', nom: 'Café 1kg', categorie: 'Épicerie', prix: 12.5, quantite: 10, seuil_alerte: 3,
    fournisseur_id: fo.id, entrepot_id: 1,
  });
  assert.equal(status, 201);
  assert.equal(p.quantite_totale, 10);
  assert.equal(p.fournisseur_nom, 'Torréfaction Dupont');

  // Transfert de 6 unités vers le dépôt Nord
  const t = await gestion.post('/api/mouvements', {
    produit_id: p.id, type: 'transfert', quantite: 6, entrepot_id: 1, entrepot_dest_id: e2.id, commentaire: 'Réassort',
  });
  assert.equal(t.status, 201);
  assert.equal(t.body.produit.quantite_totale, 10, 'un transfert ne change pas le total');
  assert.deepEqual(
    t.body.produit.stocks.map((s) => [s.entrepot_nom, s.quantite]),
    [['Dépôt Nord', 6], ['Entrepôt principal', 4]]
  );
  assert.equal(t.body.mouvement.entrepot_dest_nom, 'Dépôt Nord');
  assert.equal(t.body.mouvement.utilisateur_nom, 'Gaston Gestion');

  // Sortie supérieure au stock de l'entrepôt (même si le total suffirait)
  const trop = await gestion.post('/api/mouvements', { produit_id: p.id, type: 'sortie', quantite: 5, entrepot_id: 1 });
  assert.equal(trop.status, 400);
  assert.match(trop.body.erreur, /Stock insuffisant dans « Entrepôt principal » \(disponible : 4\)/);

  await gestion.post('/api/mouvements', { produit_id: p.id, type: 'sortie', quantite: 5, entrepot_id: e2.id });
  // Entrée avec fournisseur
  const entree = await gestion.post('/api/mouvements', {
    produit_id: p.id, type: 'entree', quantite: 2, entrepot_id: e2.id, fournisseur_id: fo.id,
  });
  assert.equal(entree.body.mouvement.fournisseur_nom, 'Torréfaction Dupont');
  assert.equal(entree.body.produit.quantite_totale, 7);

  // Filtre par entrepôt
  const nord = await gestion.get(`/api/produits?entrepot_id=${e2.id}`);
  assert.equal(nord.body[0].quantite, 3);
  assert.equal(nord.body[0].quantite_totale, 7);

  const stats = await gestion.get('/api/stats');
  assert.equal(stats.body.valeur_stock, 87.5);
  assert.equal(stats.body.nb_entrepots, 2);

  const mvts = await gestion.get(`/api/mouvements?produit_id=${p.id}`);
  assert.deepEqual(mvts.body.map((m) => m.type), ['entree', 'sortie', 'transfert', 'entree']);
  assert.equal((await gestion.get(`/api/mouvements?entrepot_id=${e2.id}`)).body.length, 3);
  assert.equal((await gestion.get('/api/mouvements?type=transfert')).body.length, 1);
});

test('alertes de stock bas sur le total', async () => {
  const { body: p } = await gestion.post('/api/produits', { reference: 'STY-01', nom: 'Stylo', quantite: 2, seuil_alerte: 5 });
  const alertes = await gestion.get('/api/produits?alerte=1');
  assert.ok(alertes.body.some((x) => x.id === p.id));
  assert.ok(!alertes.body.some((x) => x.reference === 'CAF-001'));
});

test('transferts invalides', async () => {
  const { body: p } = await gestion.post('/api/produits', { reference: 'TR-1', nom: 'x', quantite: 5 });
  const base = { produit_id: p.id, type: 'transfert', quantite: 1, entrepot_id: 1 };
  assert.equal((await gestion.post('/api/mouvements', base)).status, 400);
  assert.equal((await gestion.post('/api/mouvements', { ...base, entrepot_dest_id: 1 })).status, 400);
  assert.equal((await gestion.post('/api/mouvements', { ...base, entrepot_dest_id: 999 })).status, 404);
});

test('la quantité ne se modifie pas via PUT', async () => {
  const { body: p } = await gestion.post('/api/produits', { reference: 'PUT-1', nom: 'Avant', quantite: 4 });
  const { body } = await gestion.put(`/api/produits/${p.id}`, { nom: 'Après', quantite: 999, fournisseur_id: '' });
  assert.equal(body.nom, 'Après');
  assert.equal(body.quantite_totale, 4);
});

test("suppression d'un fournisseur : les produits sont conservés", async () => {
  const { body: fo } = await gestion.post('/api/fournisseurs', { nom: 'Éphémère' });
  const { body: p } = await gestion.post('/api/produits', { reference: 'EPH-1', nom: 'x', fournisseur_id: fo.id });
  assert.equal((await gestion.get('/api/fournisseurs')).body.find((f) => f.id === fo.id).nb_produits, 1);
  assert.equal((await gestion.del(`/api/fournisseurs/${fo.id}`)).status, 204);
  assert.equal((await gestion.get(`/api/produits/${p.id}`)).body.fournisseur_id, null);
});

test("règles de suppression d'un entrepôt", async () => {
  const { body: vide } = await admin.post('/api/entrepots', { nom: 'Vide' });
  assert.equal((await admin.del(`/api/entrepots/${vide.id}`)).status, 204);

  const { body: e } = await admin.post('/api/entrepots', { nom: 'Utilisé' });
  const { body: p } = await gestion.post('/api/produits', { reference: 'ENT-1', nom: 'x', quantite: 1, entrepot_id: e.id });
  assert.equal((await admin.del(`/api/entrepots/${e.id}`)).status, 409, 'contient du stock');
  await gestion.post('/api/mouvements', { produit_id: p.id, type: 'sortie', quantite: 1, entrepot_id: e.id });
  const r = await admin.del(`/api/entrepots/${e.id}`);
  assert.equal(r.status, 409);
  assert.match(r.body.erreur, /historique/);
});

test('validation des données', async () => {
  const cas = [
    ['/api/produits', { nom: 'Sans ref' }, 400],
    ['/api/produits', { reference: 'X', nom: 'X', prix: -1 }, 400],
    ['/api/produits', { reference: 'Y', nom: 'Y', quantite: 1.5 }, 400],
    ['/api/produits', { reference: 'Z', nom: 'Z', fournisseur_id: 999 }, 404],
    ['/api/produits', { reference: 'CAF-001', nom: 'Doublon' }, 409],
    ['/api/fournisseurs', { nom: 'Mauvais email', email: 'pas-un-email' }, 400],
    ['/api/fournisseurs', { nom: 'torréfaction dupont' }, 409],
    ['/api/mouvements', { produit_id: 1, type: 'vol', quantite: 1, entrepot_id: 1 }, 400],
    ['/api/mouvements', { produit_id: 9999, type: 'entree', quantite: 1, entrepot_id: 1 }, 404],
    ['/api/mouvements', { produit_id: 1, type: 'entree', quantite: 0, entrepot_id: 1 }, 400],
  ];
  for (const [url, corps, attendu] of cas) {
    const r = await gestion.post(url, corps);
    assert.equal(r.status, attendu, `${url} ${JSON.stringify(corps)} → ${JSON.stringify(r.body)}`);
  }
  assert.equal((await admin.post('/api/entrepots', { nom: 'dépôt nord' })).status, 409);
  assert.equal((await gestion.get('/api/mouvements?du=hier')).status, 400);
});
