const path = require('node:path');
const express = require('express');
const { HttpError } = require('./util');
const { authentifier, routeurAuth } = require('./auth');
const { routeurProduits } = require('./routes/produits');
const { routeurMouvements } = require('./routes/mouvements');
const { routeurFournisseurs } = require('./routes/fournisseurs');
const { routeurEntrepots } = require('./routes/entrepots');
const { routeurUtilisateurs } = require('./routes/utilisateurs');
const { routeurStats } = require('./routes/stats');
const { routeurExport } = require('./routes/export');

const MESSAGES_UNICITE = {
  'produits.reference': 'Cette référence existe déjà',
  'fournisseurs.nom': 'Un fournisseur porte déjà ce nom',
  'entrepots.nom': 'Un entrepôt porte déjà ce nom',
  'utilisateurs.identifiant': 'Cet identifiant est déjà utilisé',
};

function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Connexion / déconnexion : accessibles sans session
  app.use('/api/auth', routeurAuth(db));

  // Tout le reste de l'API exige une session ; le rôle « lecteur » est en lecture seule.
  app.use('/api', authentifier(db), (req, res, next) => {
    if (req.method !== 'GET' && req.utilisateur.role === 'lecteur') {
      throw new HttpError(403, 'Votre compte est en lecture seule');
    }
    next();
  });

  app.use('/api/produits', routeurProduits(db));
  app.use('/api/mouvements', routeurMouvements(db));
  app.use('/api/fournisseurs', routeurFournisseurs(db));
  app.use('/api/entrepots', routeurEntrepots(db));
  app.use('/api/utilisateurs', routeurUtilisateurs(db));
  app.use('/api/stats', routeurStats(db));
  app.use('/api/export', routeurExport(db));

  app.use('/api', () => {
    throw new HttpError(404, 'Route inconnue');
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ erreur: err.message });
    const unicite = /UNIQUE constraint failed: (\w+\.\w+)/.exec(err.message);
    if (unicite) return res.status(409).json({ erreur: MESSAGES_UNICITE[unicite[1]] || 'Cette valeur existe déjà' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ erreur: 'JSON invalide' });
    if (err.type === 'entity.too.large') return res.status(413).json({ erreur: 'Requête trop volumineuse' });
    console.error(err);
    res.status(500).json({ erreur: 'Erreur interne du serveur' });
  });

  return app;
}

module.exports = { createApp };
