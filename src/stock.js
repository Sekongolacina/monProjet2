const { HttpError } = require('./util');

function ajusterStock(db, produitId, entrepotId, delta) {
  db.prepare('INSERT INTO stocks (produit_id, entrepot_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(produitId, entrepotId);
  const { quantite } = db
    .prepare('SELECT quantite FROM stocks WHERE produit_id = ? AND entrepot_id = ?')
    .get(produitId, entrepotId);
  if (quantite + delta < 0) {
    const { nom } = db.prepare('SELECT nom FROM entrepots WHERE id = ?').get(entrepotId);
    throw new HttpError(400, `Stock insuffisant dans « ${nom} » (disponible : ${quantite})`);
  }
  db.prepare('UPDATE stocks SET quantite = quantite + ? WHERE produit_id = ? AND entrepot_id = ?').run(
    delta,
    produitId,
    entrepotId
  );
}

/**
 * Met à jour les stocks et trace le mouvement. À appeler dans une transaction,
 * après avoir vérifié que le produit, les entrepôts et le fournisseur existent.
 */
function appliquerMouvement(db, m) {
  switch (m.type) {
    case 'entree':
      ajusterStock(db, m.produit_id, m.entrepot_id, m.quantite);
      break;
    case 'sortie':
      ajusterStock(db, m.produit_id, m.entrepot_id, -m.quantite);
      break;
    case 'transfert':
      if (!m.entrepot_dest_id) throw new HttpError(400, "L'entrepôt de destination est obligatoire pour un transfert");
      if (m.entrepot_dest_id === m.entrepot_id) {
        throw new HttpError(400, "L'entrepôt de destination doit être différent de l'entrepôt d'origine");
      }
      ajusterStock(db, m.produit_id, m.entrepot_id, -m.quantite);
      ajusterStock(db, m.produit_id, m.entrepot_dest_id, m.quantite);
      break;
    default:
      throw new HttpError(400, "Le type doit être 'entree', 'sortie' ou 'transfert'");
  }
  const r = db
    .prepare(
      `INSERT INTO mouvements
         (produit_id, type, quantite, entrepot_id, entrepot_dest_id, fournisseur_id, utilisateur_id, commentaire)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      m.produit_id,
      m.type,
      m.quantite,
      m.entrepot_id,
      m.type === 'transfert' ? m.entrepot_dest_id : null,
      m.type === 'entree' ? m.fournisseur_id ?? null : null,
      m.utilisateur_id ?? null,
      m.commentaire ?? ''
    );
  return Number(r.lastInsertRowid);
}

module.exports = { appliquerMouvement };
