const path = require('node:path');
const express = require('express');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function validerProduit(body, partiel = false) {
  const p = {};
  const champs = ['reference', 'nom', 'categorie', 'prix', 'quantite', 'seuil_alerte'];
  for (const c of champs) if (body[c] !== undefined) p[c] = body[c];

  if (!partiel) {
    if (!p.reference || !String(p.reference).trim()) throw new HttpError(400, 'La référence est obligatoire');
    if (!p.nom || !String(p.nom).trim()) throw new HttpError(400, 'Le nom est obligatoire');
  }
  for (const c of ['reference', 'nom', 'categorie']) {
    if (p[c] !== undefined) p[c] = String(p[c]).trim();
  }
  if (p.prix !== undefined) {
    p.prix = Number(p.prix);
    if (!Number.isFinite(p.prix) || p.prix < 0) throw new HttpError(400, 'Le prix doit être un nombre positif');
  }
  for (const c of ['quantite', 'seuil_alerte']) {
    if (p[c] !== undefined) {
      p[c] = Number(p[c]);
      if (!Number.isInteger(p[c]) || p[c] < 0) throw new HttpError(400, `Le champ ${c} doit être un entier positif`);
    }
  }
  return p;
}

function createApp(db) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const getProduit = (id) => {
    const p = db.prepare('SELECT * FROM produits WHERE id = ?').get(id);
    if (!p) throw new HttpError(404, 'Produit introuvable');
    return p;
  };

  const transaction = (fn) => {
    db.exec('BEGIN');
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };

  // --- Produits ---
  app.get('/api/produits', (req, res) => {
    const { q = '', categorie = '', alerte } = req.query;
    let sql = 'SELECT * FROM produits WHERE (nom LIKE ? OR reference LIKE ?)';
    const params = [`%${q}%`, `%${q}%`];
    if (categorie) {
      sql += ' AND categorie = ?';
      params.push(categorie);
    }
    if (alerte === '1') sql += ' AND quantite <= seuil_alerte';
    sql += ' ORDER BY nom COLLATE NOCASE';
    res.json(db.prepare(sql).all(...params));
  });

  app.get('/api/produits/:id', (req, res) => res.json(getProduit(req.params.id)));

  app.post('/api/produits', (req, res) => {
    const p = validerProduit(req.body);
    const produit = transaction(() => {
      const r = db
        .prepare(
          `INSERT INTO produits (reference, nom, categorie, prix, quantite, seuil_alerte)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(p.reference, p.nom, p.categorie ?? '', p.prix ?? 0, p.quantite ?? 0, p.seuil_alerte ?? 0);
      if (p.quantite > 0) {
        db.prepare(
          `INSERT INTO mouvements (produit_id, type, quantite, commentaire) VALUES (?, 'entree', ?, 'Stock initial')`
        ).run(r.lastInsertRowid, p.quantite);
      }
      return getProduit(r.lastInsertRowid);
    });
    res.status(201).json(produit);
  });

  app.put('/api/produits/:id', (req, res) => {
    const existant = getProduit(req.params.id);
    // La quantité ne se modifie que via les mouvements, pour garder un historique fiable.
    const { quantite, ...p } = validerProduit(req.body, true);
    const maj = { ...existant, ...p };
    if (!maj.reference || !maj.nom) throw new HttpError(400, 'Référence et nom obligatoires');
    db.prepare(
      `UPDATE produits SET reference = ?, nom = ?, categorie = ?, prix = ?, seuil_alerte = ? WHERE id = ?`
    ).run(maj.reference, maj.nom, maj.categorie, maj.prix, maj.seuil_alerte, existant.id);
    res.json(getProduit(existant.id));
  });

  app.delete('/api/produits/:id', (req, res) => {
    const p = getProduit(req.params.id);
    db.prepare('DELETE FROM produits WHERE id = ?').run(p.id);
    res.status(204).end();
  });

  // --- Mouvements ---
  app.get('/api/mouvements', (req, res) => {
    const limite = Math.min(Number(req.query.limite) || 100, 1000);
    let sql = `SELECT m.*, p.nom AS produit_nom, p.reference AS produit_reference
               FROM mouvements m JOIN produits p ON p.id = m.produit_id`;
    const params = [];
    if (req.query.produit_id) {
      sql += ' WHERE m.produit_id = ?';
      params.push(req.query.produit_id);
    }
    sql += ' ORDER BY m.date DESC, m.id DESC LIMIT ?';
    params.push(limite);
    res.json(db.prepare(sql).all(...params));
  });

  app.post('/api/mouvements', (req, res) => {
    const { produit_id, type, commentaire = '' } = req.body;
    const quantite = Number(req.body.quantite);
    if (!['entree', 'sortie'].includes(type)) throw new HttpError(400, "Le type doit être 'entree' ou 'sortie'");
    if (!Number.isInteger(quantite) || quantite <= 0) throw new HttpError(400, 'La quantité doit être un entier strictement positif');

    const resultat = transaction(() => {
      const p = getProduit(produit_id);
      const delta = type === 'entree' ? quantite : -quantite;
      if (p.quantite + delta < 0) {
        throw new HttpError(400, `Stock insuffisant (disponible : ${p.quantite})`);
      }
      db.prepare('UPDATE produits SET quantite = quantite + ? WHERE id = ?').run(delta, p.id);
      const r = db
        .prepare('INSERT INTO mouvements (produit_id, type, quantite, commentaire) VALUES (?, ?, ?, ?)')
        .run(p.id, type, quantite, String(commentaire).trim());
      return {
        mouvement: db.prepare('SELECT * FROM mouvements WHERE id = ?').get(r.lastInsertRowid),
        produit: getProduit(p.id),
      };
    });
    res.status(201).json(resultat);
  });

  // --- Statistiques ---
  app.get('/api/stats', (req, res) => {
    const s = db
      .prepare(
        `SELECT COUNT(*) AS nb_produits,
                COALESCE(SUM(quantite), 0) AS total_articles,
                COALESCE(SUM(quantite * prix), 0) AS valeur_stock,
                COALESCE(SUM(CASE WHEN quantite <= seuil_alerte THEN 1 ELSE 0 END), 0) AS nb_alertes
         FROM produits`
      )
      .get();
    const categories = db
      .prepare(`SELECT DISTINCT categorie FROM produits WHERE categorie <> '' ORDER BY categorie`)
      .all()
      .map((r) => r.categorie);
    res.json({ ...s, categories });
  });

  app.use('/api', (req, res) => res.status(404).json({ erreur: 'Route inconnue' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ erreur: err.message });
    if (String(err.message).includes('UNIQUE constraint failed: produits.reference')) {
      return res.status(409).json({ erreur: 'Cette référence existe déjà' });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ erreur: 'JSON invalide' });
    console.error(err);
    res.status(500).json({ erreur: 'Erreur interne du serveur' });
  });

  return app;
}

module.exports = { createApp };
