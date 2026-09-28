const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS utilisateurs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifiant TEXT NOT NULL UNIQUE COLLATE NOCASE,
    nom TEXT NOT NULL DEFAULT '',
    mot_de_passe TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'gestionnaire', 'lecteur')),
    actif INTEGER NOT NULL DEFAULT 1,
    cree_le TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    jeton TEXT PRIMARY KEY, -- empreinte SHA-256 du jeton envoyé dans le cookie
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    expire_le TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS entrepots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL UNIQUE COLLATE NOCASE,
    adresse TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS fournisseurs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL UNIQUE COLLATE NOCASE,
    contact TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    telephone TEXT NOT NULL DEFAULT '',
    adresse TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS produits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL UNIQUE,
    nom TEXT NOT NULL,
    categorie TEXT NOT NULL DEFAULT '',
    prix REAL NOT NULL DEFAULT 0 CHECK (prix >= 0),
    seuil_alerte INTEGER NOT NULL DEFAULT 0 CHECK (seuil_alerte >= 0),
    fournisseur_id INTEGER REFERENCES fournisseurs(id) ON DELETE SET NULL,
    cree_le TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Quantité de chaque produit dans chaque entrepôt
  CREATE TABLE IF NOT EXISTS stocks (
    produit_id INTEGER NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
    entrepot_id INTEGER NOT NULL REFERENCES entrepots(id),
    quantite INTEGER NOT NULL DEFAULT 0 CHECK (quantite >= 0),
    PRIMARY KEY (produit_id, entrepot_id)
  );
  CREATE TABLE IF NOT EXISTS mouvements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    produit_id INTEGER NOT NULL REFERENCES produits(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('entree', 'sortie', 'transfert')),
    quantite INTEGER NOT NULL CHECK (quantite > 0),
    -- Entrepôt concerné (destination d'une entrée, source d'une sortie ou d'un transfert)
    entrepot_id INTEGER NOT NULL REFERENCES entrepots(id),
    entrepot_dest_id INTEGER REFERENCES entrepots(id),
    fournisseur_id INTEGER REFERENCES fournisseurs(id) ON DELETE SET NULL,
    utilisateur_id INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
    commentaire TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_mouvements_produit ON mouvements(produit_id);
  CREATE INDEX IF NOT EXISTS idx_mouvements_date ON mouvements(date);
  CREATE INDEX IF NOT EXISTS idx_stocks_entrepot ON stocks(entrepot_id);
`;

function openDatabase(file = process.env.DB_FILE || 'stock.db') {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  if (!db.prepare('SELECT 1 FROM entrepots LIMIT 1').get()) {
    db.prepare("INSERT INTO entrepots (nom) VALUES ('Entrepôt principal')").run();
  }
  return db;
}

module.exports = { openDatabase };
