const { DatabaseSync } = require('node:sqlite');

function openDatabase(file = process.env.DB_FILE || 'stock.db') {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS produits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT NOT NULL UNIQUE,
      nom TEXT NOT NULL,
      categorie TEXT NOT NULL DEFAULT '',
      prix REAL NOT NULL DEFAULT 0 CHECK (prix >= 0),
      quantite INTEGER NOT NULL DEFAULT 0 CHECK (quantite >= 0),
      seuil_alerte INTEGER NOT NULL DEFAULT 0 CHECK (seuil_alerte >= 0),
      cree_le TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS mouvements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produit_id INTEGER NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('entree', 'sortie')),
      quantite INTEGER NOT NULL CHECK (quantite > 0),
      commentaire TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

module.exports = { openDatabase };
