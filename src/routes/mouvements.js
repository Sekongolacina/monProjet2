const express = require('express');
const { HttpError, transaction, texte, entier, idOptionnel, verifierExiste } = require('../util');
const { appliquerMouvement } = require('../stock');
const { obtenirProduit } = require('./produits');

const TYPES = ['entree', 'sortie', 'transfert'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function listerMouvements(db, f = {}) {
  let sql = `
    SELECT m.*, p.nom AS produit_nom, p.reference AS produit_reference,
           e.nom AS entrepot_nom, ed.nom AS entrepot_dest_nom,
           fo.nom AS fournisseur_nom, COALESCE(NULLIF(u.nom, ''), u.identifiant) AS utilisateur_nom
    FROM mouvements m
    JOIN produits p ON p.id = m.produit_id
    JOIN entrepots e ON e.id = m.entrepot_id
    LEFT JOIN entrepots ed ON ed.id = m.entrepot_dest_id
    LEFT JOIN fournisseurs fo ON fo.id = m.fournisseur_id
    LEFT JOIN utilisateurs u ON u.id = m.utilisateur_id
    WHERE 1 = 1`;
  const params = [];
  if (f.id !== undefined) {
    sql += ' AND m.id = ?';
    params.push(f.id);
  }
  if (f.produit_id) {
    sql += ' AND m.produit_id = ?';
    params.push(idOptionnel(f.produit_id, 'produit_id'));
  }
  if (f.entrepot_id) {
    const entrepotId = idOptionnel(f.entrepot_id, 'entrepot_id');
    sql += ' AND (m.entrepot_id = ? OR m.entrepot_dest_id = ?)';
    params.push(entrepotId, entrepotId);
  }
  if (f.type) {
    if (!TYPES.includes(f.type)) throw new HttpError(400, 'Type de mouvement inconnu');
    sql += ' AND m.type = ?';
    params.push(f.type);
  }
  if (f.du) {
    if (!DATE.test(f.du)) throw new HttpError(400, 'Date de début invalide (AAAA-MM-JJ)');
    sql += ' AND m.date >= ?';
    params.push(f.du);
  }
  if (f.au) {
    if (!DATE.test(f.au)) throw new HttpError(400, 'Date de fin invalide (AAAA-MM-JJ)');
    sql += " AND m.date < date(?, '+1 day')";
    params.push(f.au);
  }
  sql += ' ORDER BY m.date DESC, m.id DESC';
  if (f.limite !== undefined) {
    sql += ' LIMIT ?';
    params.push(Math.min(Number(f.limite) || 100, 5000));
  }
  return db.prepare(sql).all(...params);
}

function routeurMouvements(db) {
  const r = express.Router();

  r.get('/', (req, res) => res.json(listerMouvements(db, { limite: 200, ...req.query })));

  r.post('/', (req, res) => {
    const b = req.body;
    if (!TYPES.includes(b.type)) throw new HttpError(400, "Le type doit être 'entree', 'sortie' ou 'transfert'");
    const m = {
      type: b.type,
      produit_id: entier(b.produit_id, 'produit', { min: 1 }),
      quantite: entier(b.quantite, 'quantité', { min: 1 }),
      entrepot_id: entier(b.entrepot_id, 'entrepôt', { min: 1 }),
      entrepot_dest_id: b.type === 'transfert' ? idOptionnel(b.entrepot_dest_id, 'entrepôt de destination') : null,
      fournisseur_id: b.type === 'entree' ? idOptionnel(b.fournisseur_id, 'fournisseur') : null,
      commentaire: texte(b.commentaire, 'commentaire', { max: 500 }),
      utilisateur_id: req.utilisateur.id,
    };
    verifierExiste(db, 'produits', m.produit_id, 'Produit introuvable');
    verifierExiste(db, 'entrepots', m.entrepot_id, 'Entrepôt introuvable');
    verifierExiste(db, 'entrepots', m.entrepot_dest_id, 'Entrepôt de destination introuvable');
    verifierExiste(db, 'fournisseurs', m.fournisseur_id, 'Fournisseur introuvable');

    const id = transaction(db, () => appliquerMouvement(db, m));
    res.status(201).json({
      mouvement: listerMouvements(db, { id })[0],
      produit: obtenirProduit(db, m.produit_id),
    });
  });

  return r;
}

module.exports = { routeurMouvements, listerMouvements };
