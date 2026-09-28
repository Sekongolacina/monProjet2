const express = require('express');
const { HttpError, transaction, texte, entier, decimal, idOptionnel, verifierExiste } = require('../util');
const { appliquerMouvement } = require('../stock');

/**
 * Liste les produits avec :
 *  - quantite_totale : stock tous entrepôts confondus (sert aux alertes)
 *  - quantite : stock dans l'entrepôt filtré, sinon égal au total
 *  - stocks : détail par entrepôt
 */
function listerProduits(db, f = {}) {
  const entrepotId = idOptionnel(f.entrepot_id, 'entrepot_id');
  let sql = `
    SELECT * FROM (
      SELECT p.*, fo.nom AS fournisseur_nom,
        COALESCE((SELECT SUM(s.quantite) FROM stocks s WHERE s.produit_id = p.id), 0) AS quantite_totale,
        COALESCE((SELECT SUM(s.quantite) FROM stocks s
                  WHERE s.produit_id = p.id AND (?1 IS NULL OR s.entrepot_id = ?1)), 0) AS quantite
      FROM produits p LEFT JOIN fournisseurs fo ON fo.id = p.fournisseur_id
    ) WHERE (nom LIKE ?2 OR reference LIKE ?2)`;
  const params = [entrepotId, `%${f.q ?? ''}%`];
  if (f.id !== undefined) {
    sql += ' AND id = ?';
    params.push(f.id);
  }
  if (f.categorie) {
    sql += ' AND categorie = ?';
    params.push(String(f.categorie));
  }
  if (f.fournisseur_id) {
    sql += ' AND fournisseur_id = ?';
    params.push(idOptionnel(f.fournisseur_id, 'fournisseur_id'));
  }
  if (entrepotId) {
    sql += ' AND id IN (SELECT produit_id FROM stocks WHERE entrepot_id = ? AND quantite > 0)';
    params.push(entrepotId);
  }
  if (f.alerte === '1' || f.alerte === true) sql += ' AND quantite_totale <= seuil_alerte';
  sql += ' ORDER BY nom COLLATE NOCASE, reference';
  const produits = db.prepare(sql).all(...params);

  const detail = new Map();
  for (const s of db
    .prepare(
      `SELECT s.produit_id, s.entrepot_id, e.nom AS entrepot_nom, s.quantite
       FROM stocks s JOIN entrepots e ON e.id = s.entrepot_id
       WHERE s.quantite > 0 AND (?1 IS NULL OR s.produit_id = ?1) ORDER BY e.nom COLLATE NOCASE`
    )
    .all(f.id ?? null)) {
    if (!detail.has(s.produit_id)) detail.set(s.produit_id, []);
    detail.get(s.produit_id).push({ entrepot_id: s.entrepot_id, entrepot_nom: s.entrepot_nom, quantite: s.quantite });
  }
  for (const p of produits) p.stocks = detail.get(p.id) || [];
  return produits;
}

function obtenirProduit(db, id) {
  const p = listerProduits(db, { id: Number(id) || 0 })[0];
  if (!p) throw new HttpError(404, 'Produit introuvable');
  return p;
}

function routeurProduits(db) {
  const r = express.Router();

  function lireChamps(body, existant) {
    const p = { ...existant };
    if (!existant || body.reference !== undefined) p.reference = texte(body.reference, 'référence', { requis: true, max: 50 });
    if (!existant || body.nom !== undefined) p.nom = texte(body.nom, 'nom', { requis: true });
    if (!existant || body.categorie !== undefined) p.categorie = texte(body.categorie, 'catégorie', { max: 100 });
    if (body.prix !== undefined) p.prix = decimal(body.prix, 'prix');
    if (body.seuil_alerte !== undefined) p.seuil_alerte = entier(body.seuil_alerte, "seuil d'alerte");
    if (body.fournisseur_id !== undefined) {
      p.fournisseur_id = verifierExiste(db, 'fournisseurs', idOptionnel(body.fournisseur_id, 'fournisseur'), 'Fournisseur introuvable');
    }
    return p;
  }

  r.get('/', (req, res) => res.json(listerProduits(db, req.query)));

  r.get('/:id', (req, res) => res.json(obtenirProduit(db, req.params.id)));

  r.post('/', (req, res) => {
    const p = lireChamps(req.body, null);
    const quantite = req.body.quantite === undefined || req.body.quantite === '' ? 0 : entier(req.body.quantite, 'quantité initiale');
    const id = transaction(db, () => {
      const res = db
        .prepare(
          `INSERT INTO produits (reference, nom, categorie, prix, seuil_alerte, fournisseur_id)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(p.reference, p.nom, p.categorie, p.prix ?? 0, p.seuil_alerte ?? 0, p.fournisseur_id ?? null);
      const produitId = Number(res.lastInsertRowid);
      if (quantite > 0) {
        const entrepotId =
          idOptionnel(req.body.entrepot_id, 'entrepôt') ?? db.prepare('SELECT MIN(id) AS id FROM entrepots').get().id;
        verifierExiste(db, 'entrepots', entrepotId, 'Entrepôt introuvable');
        appliquerMouvement(db, {
          produit_id: produitId,
          type: 'entree',
          quantite,
          entrepot_id: entrepotId,
          fournisseur_id: p.fournisseur_id,
          utilisateur_id: req.utilisateur.id,
          commentaire: 'Stock initial',
        });
      }
      return produitId;
    });
    res.status(201).json(obtenirProduit(db, id));
  });

  // La quantité ne se modifie que par des mouvements, pour garder un historique fiable.
  r.put('/:id', (req, res) => {
    const existant = db.prepare('SELECT * FROM produits WHERE id = ?').get(req.params.id);
    if (!existant) throw new HttpError(404, 'Produit introuvable');
    const p = lireChamps(req.body, existant);
    db.prepare(
      `UPDATE produits SET reference = ?, nom = ?, categorie = ?, prix = ?, seuil_alerte = ?, fournisseur_id = ? WHERE id = ?`
    ).run(p.reference, p.nom, p.categorie, p.prix, p.seuil_alerte, p.fournisseur_id, existant.id);
    res.json(obtenirProduit(db, existant.id));
  });

  r.delete('/:id', (req, res) => {
    const r2 = db.prepare('DELETE FROM produits WHERE id = ?').run(req.params.id);
    if (!r2.changes) throw new HttpError(404, 'Produit introuvable');
    res.status(204).end();
  });

  return r;
}

module.exports = { routeurProduits, listerProduits, obtenirProduit };
