const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { demarrer, MDP } = require('./aide');

let env;
before(async () => (env = await demarrer()));
after(() => env.fermer());

test("l'API exige une session", async () => {
  const c = env.client();
  assert.equal((await c.get('/api/produits')).status, 401);
  assert.equal((await c.get('/api/auth/moi')).status, 401);
});

test('connexion, session et déconnexion', async () => {
  const c = env.client();
  const echec = await c.post('/api/auth/connexion', { identifiant: 'admin', mot_de_passe: 'mauvais' });
  assert.equal(echec.status, 401);
  assert.equal((await c.post('/api/auth/connexion', { identifiant: 'inconnu', mot_de_passe: MDP })).status, 401);

  const ok = await c.post('/api/auth/connexion', { identifiant: 'ADMIN', mot_de_passe: MDP });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { id: 1, identifiant: 'admin', nom: 'Alice Admin', role: 'admin' });
  assert.match(ok.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal((await c.get('/api/auth/moi')).body.role, 'admin');

  assert.equal((await c.post('/api/auth/deconnexion')).status, 204);
  assert.equal((await c.get('/api/auth/moi')).status, 401);
});

test('le mot de passe est stocké haché', () => {
  const { mot_de_passe } = env.db.prepare("SELECT mot_de_passe FROM utilisateurs WHERE identifiant = 'admin'").get();
  assert.match(mot_de_passe, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
});

test('changement de mot de passe', async () => {
  const c = await env.client().connecter('gestion');
  const autreAppareil = await env.client().connecter('gestion');
  assert.equal((await c.post('/api/auth/mot-de-passe', { ancien: 'faux', nouveau: 'nouveau-mdp' })).status, 400);
  assert.equal((await c.post('/api/auth/mot-de-passe', { ancien: MDP, nouveau: 'court' })).status, 400);
  assert.equal((await c.post('/api/auth/mot-de-passe', { ancien: MDP, nouveau: 'nouveau-mdp' })).status, 204);
  assert.equal((await c.get('/api/auth/moi')).status, 200, 'la session courante reste valide');
  assert.equal((await autreAppareil.get('/api/auth/moi')).status, 401, 'les autres sessions sont fermées');
  await env.client().connecter('gestion', 'nouveau-mdp');
  // Remet le mot de passe d'origine pour les autres tests
  await c.post('/api/auth/mot-de-passe', { ancien: 'nouveau-mdp', nouveau: MDP });
});

test('droits par rôle', async () => {
  const lecteur = await env.client().connecter('lecture');
  const gestion = await env.client().connecter('gestion');
  const admin = await env.client().connecter('admin');

  assert.equal((await lecteur.get('/api/produits')).status, 200);
  assert.equal((await lecteur.post('/api/produits', { reference: 'L1', nom: 'x' })).status, 403);
  assert.equal((await lecteur.get('/api/export/produits')).status, 200, 'le lecteur peut exporter');

  assert.equal((await gestion.post('/api/produits', { reference: 'G1', nom: 'x' })).status, 201);
  assert.equal((await gestion.post('/api/fournisseurs', { nom: 'F-gestion' })).status, 201);
  assert.equal((await gestion.post('/api/entrepots', { nom: 'E-gestion' })).status, 403);
  assert.equal((await gestion.get('/api/utilisateurs')).status, 403);

  assert.equal((await admin.post('/api/entrepots', { nom: 'E-admin' })).status, 201);
  assert.equal((await admin.get('/api/utilisateurs')).status, 200);
});

test('limite les tentatives de connexion', async () => {
  const c = env.client();
  env.db
    .prepare("INSERT INTO utilisateurs (identifiant, mot_de_passe, role) VALUES ('cible', 'x', 'lecteur')")
    .run();
  for (let i = 0; i < 10; i++) {
    assert.equal((await c.post('/api/auth/connexion', { identifiant: 'cible', mot_de_passe: 'x' })).status, 401);
  }
  assert.equal((await c.post('/api/auth/connexion', { identifiant: 'cible', mot_de_passe: 'x' })).status, 429);
});
