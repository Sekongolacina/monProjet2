const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { hacherMotDePasse } = require('../src/auth');

const MDP = 'motdepasse123';

/** Démarre l'application sur une base en mémoire avec trois comptes (un par rôle). */
async function demarrer() {
  const db = openDatabase(':memory:');
  const creer = db.prepare('INSERT INTO utilisateurs (identifiant, nom, mot_de_passe, role) VALUES (?, ?, ?, ?)');
  const empreinte = hacherMotDePasse(MDP);
  creer.run('admin', 'Alice Admin', empreinte, 'admin');
  creer.run('gestion', 'Gaston Gestion', empreinte, 'gestionnaire');
  creer.run('lecture', 'Léa Lecture', empreinte, 'lecteur');

  const serveur = createApp(db).listen(0);
  await new Promise((r) => serveur.once('listening', r));
  const base = `http://127.0.0.1:${serveur.address().port}`;

  /** Client HTTP qui conserve le cookie de session. */
  function client() {
    let cookie = '';
    async function req(method, url, body) {
      const res = await fetch(base + url, {
        method,
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const type = res.headers.get('content-type') || '';
      let corps = null;
      if (res.status !== 204) corps = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
      return { status: res.status, body: corps, headers: res.headers };
    }
    return {
      req,
      get: (u) => req('GET', u),
      post: (u, b) => req('POST', u, b ?? {}),
      put: (u, b) => req('PUT', u, b),
      del: (u) => req('DELETE', u),
      async connecter(identifiant, mdp = MDP) {
        const r = await req('POST', '/api/auth/connexion', { identifiant, mot_de_passe: mdp });
        if (r.status !== 200) throw new Error(`Connexion de ${identifiant} impossible : ${r.status}`);
        return this;
      },
    };
  }

  return { db, client, fermer: () => serveur.close() };
}

module.exports = { demarrer, MDP };
