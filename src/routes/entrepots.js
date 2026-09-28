const express = require('express');
const { HttpError, transaction, texte } = require('../util');
const { exigerRole } = require('../auth');

function listerEntrepots(db) {
  return db
    .prepare(
      `SELECT e.*,
              COUNT(CASE WHEN s.quantite > 0 THEN 1 END) AS nb_produits,
              COALESCE(SUM(s.quantite), 0) AS total_articles,
              COALESCE(SUM(s.quantite * p.prix), 0) AS valeur_stock
       FROM entrepots e
       LEFT JOIN stocks s ON s.entrepot_id = e.id
       LEFT JOIN produits p ON p.id = s.produit_id
       GROUP BY e.id ORDER BY e.nom COLLATE NOCASE`
    )
    .all();
}

function routeurEntrepots(db) {
  const r = express.Router();
  const admin = exigerRole('admin');

  const obtenir = (id) => {
    const e = listerEntrepots(db).find((x) => x.id === Number(id));
    if (!e) throw new HttpError(404, 'Entrepôt introuvable');
    return e;
  };

  r.get('/', (req, res) => res.json(listerEntrepots(db)));

  r.post('/', admin, (req, res) => {
    const nom = texte(req.body.nom, 'nom', { requis: true, max: 100 });
    const adresse = texte(req.body.adresse, 'adresse', { max: 300 });
    const { lastInsertRowid } = db.prepare('INSERT INTO entrepots (nom, adresse) VALUES (?, ?)').run(nom, adresse);
    res.status(201).json(obtenir(lastInsertRowid));
  });

  r.put('/:id', admin, (req, res) => {
    const e = obtenir(req.params.id);
    const nom = req.body.nom !== undefined ? texte(req.body.nom, 'nom', { requis: true, max: 100 }) : e.nom;
    const adresse = req.body.adresse !== undefined ? texte(req.body.adresse, 'adresse', { max: 300 }) : e.adresse;
    db.prepare('UPDATE entrepots SET nom = ?, adresse = ? WHERE id = ?').run(nom, adresse, e.id);
    res.json(obtenir(e.id));
  });

  // Un entrepôt n'est supprimable que s'il est vide et n'a jamais servi, pour préserver l'historique.
  r.delete('/:id', admin, (req, res) => {
    const e = obtenir(req.params.id);
    transaction(db, () => {
      if (db.prepare('SELECT COUNT(*) AS n FROM entrepots').get().n <= 1) {
        throw new HttpError(400, 'Impossible de supprimer le dernier entrepôt');
      }
      if (e.total_articles > 0) throw new HttpError(409, "L'entrepôt contient encore du stock");
      if (db.prepare('SELECT 1 FROM mouvements WHERE entrepot_id = ?1 OR entrepot_dest_id = ?1 LIMIT 1').get(e.id)) {
        throw new HttpError(409, "L'entrepôt a un historique de mouvements et ne peut pas être supprimé");
      }
      db.prepare('DELETE FROM stocks WHERE entrepot_id = ?').run(e.id);
      db.prepare('DELETE FROM entrepots WHERE id = ?').run(e.id);
    });
    res.status(204).end();
  });

  return r;
}

module.exports = { routeurEntrepots, listerEntrepots };
