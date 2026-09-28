const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { demarrer } = require('./aide');

let env, admin;
before(async () => {
  env = await demarrer();
  admin = await env.client().connecter('admin');
});
after(() => env.fermer());

test('création et liste des utilisateurs', async () => {
  const r = await admin.post('/api/utilisateurs', { identifiant: 'bob', nom: 'Bob', role: 'gestionnaire', mot_de_passe: 'secret-bob' });
  assert.equal(r.status, 201);
  assert.equal(r.body.mot_de_passe, undefined, "l'empreinte n'est jamais renvoyée");
  await env.client().connecter('bob', 'secret-bob');

  const liste = await admin.get('/api/utilisateurs');
  assert.ok(liste.body.every((u) => u.mot_de_passe === undefined));
  assert.equal((await admin.post('/api/utilisateurs', { identifiant: 'BOB', role: 'lecteur', mot_de_passe: '12345678' })).status, 409);
  assert.equal((await admin.post('/api/utilisateurs', { identifiant: 'x y', role: 'lecteur', mot_de_passe: '12345678' })).status, 400);
  assert.equal((await admin.post('/api/utilisateurs', { identifiant: 'zed', role: 'chef', mot_de_passe: '12345678' })).status, 400);
});

test('désactivation et réinitialisation du mot de passe', async () => {
  const { body: u } = await admin.post('/api/utilisateurs', { identifiant: 'carla', role: 'lecteur', mot_de_passe: 'mdp-carla' });
  const carla = await env.client().connecter('carla', 'mdp-carla');

  await admin.put(`/api/utilisateurs/${u.id}`, { actif: false });
  assert.equal((await carla.get('/api/produits')).status, 401, 'la session est coupée');
  assert.equal((await env.client().post('/api/auth/connexion', { identifiant: 'carla', mot_de_passe: 'mdp-carla' })).status, 401);

  await admin.put(`/api/utilisateurs/${u.id}`, { actif: true, mot_de_passe: 'nouveau-carla' });
  await env.client().connecter('carla', 'nouveau-carla');
});

test("un admin ne peut pas se retirer ses propres droits", async () => {
  assert.equal((await admin.put('/api/utilisateurs/1', { role: 'lecteur' })).status, 400);
  assert.equal((await admin.put('/api/utilisateurs/1', { actif: false })).status, 400);
  assert.equal((await admin.del('/api/utilisateurs/1')).status, 400);
});

test("supprimer un utilisateur conserve l'historique", async () => {
  const { body: u } = await admin.post('/api/utilisateurs', { identifiant: 'temp', role: 'gestionnaire', mot_de_passe: 'mdp-temp1' });
  const temp = await env.client().connecter('temp', 'mdp-temp1');
  const { body: p } = await temp.post('/api/produits', { reference: 'T1', nom: 'Temp', quantite: 3 });
  assert.equal((await admin.del(`/api/utilisateurs/${u.id}`)).status, 204);
  const mvts = await admin.get(`/api/mouvements?produit_id=${p.id}`);
  assert.equal(mvts.body.length, 1);
  assert.equal(mvts.body[0].utilisateur_id, null);
});
