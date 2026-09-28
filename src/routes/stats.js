const express = require('express');
const { listerProduits } = require('./produits');

function routeurStats(db) {
  const r = express.Router();
  r.get('/', (req, res) => {
    const produits = listerProduits(db, { entrepot_id: req.query.entrepot_id });
    const compter = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    res.json({
      nb_produits: produits.length,
      total_articles: produits.reduce((t, p) => t + p.quantite, 0),
      valeur_stock: Math.round(produits.reduce((t, p) => t + p.quantite * p.prix, 0) * 100) / 100,
      nb_alertes: produits.filter((p) => p.quantite_totale <= p.seuil_alerte).length,
      nb_fournisseurs: compter('fournisseurs'),
      nb_entrepots: compter('entrepots'),
      categories: db
        .prepare(`SELECT DISTINCT categorie FROM produits WHERE categorie <> '' ORDER BY categorie COLLATE NOCASE`)
        .all()
        .map((c) => c.categorie),
    });
  });
  return r;
}

module.exports = { routeurStats };
