class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function texte(valeur, nom, { requis = false, max = 200 } = {}) {
  if (valeur === undefined || valeur === null) valeur = '';
  if (typeof valeur !== 'string' && typeof valeur !== 'number') {
    throw new HttpError(400, `Le champ « ${nom} » est invalide`);
  }
  const v = String(valeur).trim();
  if (requis && !v) throw new HttpError(400, `Le champ « ${nom} » est obligatoire`);
  if (v.length > max) throw new HttpError(400, `Le champ « ${nom} » ne doit pas dépasser ${max} caractères`);
  return v;
}

function entier(valeur, nom, { min = 0 } = {}) {
  const n = Number(valeur);
  if (valeur === '' || valeur === null || typeof valeur === 'boolean' || !Number.isInteger(n) || n < min) {
    throw new HttpError(400, `Le champ « ${nom} » doit être un entier ${min > 0 ? 'strictement positif' : 'positif ou nul'}`);
  }
  return n;
}

function decimal(valeur, nom) {
  const n = Number(valeur);
  if (valeur === '' || valeur === null || typeof valeur === 'boolean' || !Number.isFinite(n) || n < 0) {
    throw new HttpError(400, `Le champ « ${nom} » doit être un nombre positif`);
  }
  return n;
}

/** Identifiant facultatif : '', null et undefined deviennent null. */
function idOptionnel(valeur, nom) {
  if (valeur === undefined || valeur === null || valeur === '') return null;
  return entier(valeur, nom, { min: 1 });
}

function verifierExiste(db, table, id, message) {
  if (id !== null && !db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)) {
    throw new HttpError(404, message);
  }
  return id;
}

/** Enveloppe un gestionnaire asynchrone pour qu'Express 4 transmette ses erreurs. */
const asynchrone = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { HttpError, transaction, texte, entier, decimal, idOptionnel, verifierExiste, asynchrone };
