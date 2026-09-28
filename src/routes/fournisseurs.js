const express = require('express');
const { HttpError, texte } = require('../util');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function listerFournisseurs(db, f = {}) {
  const params = [`%${f.q ?? ''}%`];
  let sql = `SELECT fo.*, (SELECT COUNT(*) FROM produits p WHERE p.fournisseur_id = fo.id) AS nb_produits
             FROM fournisseurs fo WHERE (fo.nom LIKE ?1 OR fo.contact LIKE ?1 OR fo.email LIKE ?1)`;
  if (f.id !== undefined) {
    sql += ' AND fo.id = ?';
    params.push(f.id);
  }
  return db.prepare(sql + ' ORDER BY fo.nom COLLATE NOCASE').all(...params);
}

function routeurFournisseurs(db) {
  const r = express.Router();

  const obtenir = (id) => {
    const f = listerFournisseurs(db, { id: Number(id) || 0 })[0];
    if (!f) throw new HttpError(404, 'Fournisseur introuvable');
    return f;
  };

  function lireChamps(body, existant) {
    const f = { ...existant };
    if (!existant || body.nom !== undefined) f.nom = texte(body.nom, 'nom', { requis: true, max: 150 });
    for (const [cle, nom, max] of [
      ['contact', 'contact', 150],
      ['email', 'email', 150],
      ['telephone', 'téléphone', 50],
      ['adresse', 'adresse', 300],
      ['notes', 'notes', 1000],
    ]) {
      if (!existant || body[cle] !== undefined) f[cle] = texte(body[cle], nom, { max });
    }
    if (f.email && !EMAIL.test(f.email)) throw new HttpError(400, "L'adresse email est invalide");
    return f;
  }

  r.get('/', (req, res) => res.json(listerFournisseurs(db, { q: req.query.q })));
  r.get('/:id', (req, res) => res.json(obtenir(req.params.id)));

  r.post('/', (req, res) => {
    const f = lireChamps(req.body, null);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO fournisseurs (nom, contact, email, telephone, adresse, notes) VALUES (?, ?, ?, ?, ?, ?)')
      .run(f.nom, f.contact, f.email, f.telephone, f.adresse, f.notes);
    res.status(201).json(obtenir(lastInsertRowid));
  });

  r.put('/:id', (req, res) => {
    const f = lireChamps(req.body, obtenir(req.params.id));
    db.prepare(
      'UPDATE fournisseurs SET nom = ?, contact = ?, email = ?, telephone = ?, adresse = ?, notes = ? WHERE id = ?'
    ).run(f.nom, f.contact, f.email, f.telephone, f.adresse, f.notes, f.id);
    res.json(obtenir(f.id));
  });

  // Les produits et mouvements liés sont conservés, sans fournisseur.
  r.delete('/:id', (req, res) => {
    if (!db.prepare('DELETE FROM fournisseurs WHERE id = ?').run(req.params.id).changes) {
      throw new HttpError(404, 'Fournisseur introuvable');
    }
    res.status(204).end();
  });

  return r;
}

module.exports = { routeurFournisseurs, listerFournisseurs };
