const express = require('express');
const { HttpError, transaction, texte } = require('../util');
const { exigerRole, hacherMotDePasse, validerMotDePasse, validerRole } = require('../auth');

const COLONNES = 'id, identifiant, nom, role, actif, cree_le';

function routeurUtilisateurs(db) {
  const r = express.Router();
  r.use(exigerRole('admin'));

  const obtenir = (id) => {
    const u = db.prepare(`SELECT ${COLONNES} FROM utilisateurs WHERE id = ?`).get(id);
    if (!u) throw new HttpError(404, 'Utilisateur introuvable');
    return u;
  };

  r.get('/', (req, res) => {
    res.json(db.prepare(`SELECT ${COLONNES} FROM utilisateurs ORDER BY identifiant COLLATE NOCASE`).all());
  });

  r.post('/', (req, res) => {
    const identifiant = texte(req.body.identifiant, 'identifiant', { requis: true, max: 50 });
    if (!/^[\w.@-]+$/.test(identifiant)) {
      throw new HttpError(400, "L'identifiant ne peut contenir que des lettres, chiffres et . _ - @");
    }
    const nom = texte(req.body.nom, 'nom', { max: 100 });
    const role = validerRole(req.body.role);
    const mdp = validerMotDePasse(req.body.mot_de_passe);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO utilisateurs (identifiant, nom, mot_de_passe, role) VALUES (?, ?, ?, ?)')
      .run(identifiant, nom, hacherMotDePasse(mdp), role);
    res.status(201).json(obtenir(lastInsertRowid));
  });

  r.put('/:id', (req, res) => {
    const u = obtenir(req.params.id);
    const nom = req.body.nom !== undefined ? texte(req.body.nom, 'nom', { max: 100 }) : u.nom;
    const role = req.body.role !== undefined ? validerRole(req.body.role) : u.role;
    const actif = req.body.actif !== undefined ? (req.body.actif ? 1 : 0) : u.actif;
    const mdp = req.body.mot_de_passe ? validerMotDePasse(req.body.mot_de_passe) : null;
    if (u.id === req.utilisateur.id && (role !== 'admin' || !actif)) {
      throw new HttpError(400, 'Vous ne pouvez pas retirer vos propres droits administrateur');
    }
    transaction(db, () => {
      db.prepare('UPDATE utilisateurs SET nom = ?, role = ?, actif = ? WHERE id = ?').run(nom, role, actif, u.id);
      if (mdp) db.prepare('UPDATE utilisateurs SET mot_de_passe = ? WHERE id = ?').run(hacherMotDePasse(mdp), u.id);
      if (mdp || !actif) {
        db.prepare('DELETE FROM sessions WHERE utilisateur_id = ? AND jeton <> ?').run(u.id, req.session);
      }
    });
    res.json(obtenir(u.id));
  });

  // L'historique des mouvements est conservé (l'auteur devient vide).
  r.delete('/:id', (req, res) => {
    const u = obtenir(req.params.id);
    if (u.id === req.utilisateur.id) throw new HttpError(400, 'Vous ne pouvez pas supprimer votre propre compte');
    db.prepare('DELETE FROM utilisateurs WHERE id = ?').run(u.id);
    res.status(204).end();
  });

  return r;
}

module.exports = { routeurUtilisateurs };
