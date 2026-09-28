const crypto = require('node:crypto');
const express = require('express');
const { HttpError, texte } = require('./util');

const COOKIE = 'stock_session';
const DUREE_SESSION_S = 7 * 24 * 3600;
const ROLES = ['admin', 'gestionnaire', 'lecteur'];

function hacherMotDePasse(mdp) {
  const sel = crypto.randomBytes(16);
  const empreinte = crypto.scryptSync(String(mdp), sel, 64);
  return `scrypt$${sel.toString('hex')}$${empreinte.toString('hex')}`;
}

function verifierMotDePasse(mdp, stocke) {
  const [algo, sel, empreinte] = String(stocke).split('$');
  if (algo !== 'scrypt' || !sel || !empreinte) return false;
  const attendu = Buffer.from(empreinte, 'hex');
  const calcule = crypto.scryptSync(String(mdp), Buffer.from(sel, 'hex'), attendu.length);
  return crypto.timingSafeEqual(calcule, attendu);
}

// Empreinte utilisée quand l'identifiant n'existe pas, pour que la durée de réponse ne le révèle pas.
const EMPREINTE_FACTICE = hacherMotDePasse(crypto.randomBytes(16).toString('hex'));

function validerMotDePasse(mdp) {
  if (typeof mdp !== 'string' || mdp.length < 8) {
    throw new HttpError(400, 'Le mot de passe doit contenir au moins 8 caractères');
  }
  if (mdp.length > 200) throw new HttpError(400, 'Le mot de passe est trop long');
  return mdp;
}

function validerRole(role) {
  if (!ROLES.includes(role)) throw new HttpError(400, `Le rôle doit être : ${ROLES.join(', ')}`);
  return role;
}

const empreinteJeton = (jeton) => crypto.createHash('sha256').update(jeton).digest('hex');

function lireCookie(req, nom) {
  for (const partie of (req.headers.cookie || '').split(';')) {
    const i = partie.indexOf('=');
    if (i > 0 && partie.slice(0, i).trim() === nom) {
      try {
        return decodeURIComponent(partie.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function enteteCookie(valeur, maxAge) {
  const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
  return `${COOKIE}=${valeur}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

const utilisateurPublic = ({ id, identifiant, nom, role }) => ({ id, identifiant, nom, role });

/** Middleware : exige une session valide et place l'utilisateur dans req.utilisateur. */
function authentifier(db) {
  const requete = db.prepare(
    `SELECT u.id, u.identifiant, u.nom, u.role
     FROM sessions s JOIN utilisateurs u ON u.id = s.utilisateur_id
     WHERE s.jeton = ? AND s.expire_le > datetime('now') AND u.actif = 1`
  );
  return (req, res, next) => {
    const jeton = lireCookie(req, COOKIE);
    const empreinte = jeton ? empreinteJeton(jeton) : null;
    const utilisateur = empreinte && requete.get(empreinte);
    if (!utilisateur) throw new HttpError(401, 'Authentification requise');
    req.utilisateur = utilisateur;
    req.session = empreinte;
    next();
  };
}

function exigerRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.utilisateur.role)) {
      throw new HttpError(403, 'Action non autorisée pour votre rôle');
    }
    next();
  };
}

/** Limite les tentatives de connexion échouées par identifiant. */
class LimiteurConnexion {
  constructor(max = 10, fenetreMs = 15 * 60 * 1000) {
    this.max = max;
    this.fenetreMs = fenetreMs;
    this.echecs = new Map();
  }
  verifier(cle) {
    const e = this.echecs.get(cle);
    if (e && Date.now() - e.debut > this.fenetreMs) this.echecs.delete(cle);
    else if (e && e.n >= this.max) {
      throw new HttpError(429, 'Trop de tentatives échouées, réessayez dans quelques minutes');
    }
  }
  echec(cle) {
    const e = this.echecs.get(cle) || { n: 0, debut: Date.now() };
    e.n++;
    this.echecs.set(cle, e);
  }
  reussite(cle) {
    this.echecs.delete(cle);
  }
}

function routeurAuth(db) {
  const r = express.Router();
  const limiteur = new LimiteurConnexion();
  const auth = authentifier(db);

  r.post('/connexion', (req, res) => {
    const identifiant = texte(req.body.identifiant, 'identifiant', { requis: true });
    const cle = identifiant.toLowerCase();
    limiteur.verifier(cle);
    const u = db.prepare('SELECT * FROM utilisateurs WHERE identifiant = ?').get(identifiant);
    const valide = verifierMotDePasse(req.body.mot_de_passe ?? '', u ? u.mot_de_passe : EMPREINTE_FACTICE);
    if (!u || !valide || !u.actif) {
      limiteur.echec(cle);
      throw new HttpError(401, 'Identifiant ou mot de passe incorrect');
    }
    limiteur.reussite(cle);
    db.prepare("DELETE FROM sessions WHERE expire_le <= datetime('now')").run();
    const jeton = crypto.randomBytes(32).toString('base64url');
    db.prepare(`INSERT INTO sessions (jeton, utilisateur_id, expire_le) VALUES (?, ?, datetime('now', ?))`).run(
      empreinteJeton(jeton),
      u.id,
      `+${DUREE_SESSION_S} seconds`
    );
    res.setHeader('Set-Cookie', enteteCookie(jeton, DUREE_SESSION_S));
    res.json(utilisateurPublic(u));
  });

  r.post('/deconnexion', auth, (req, res) => {
    db.prepare('DELETE FROM sessions WHERE jeton = ?').run(req.session);
    res.setHeader('Set-Cookie', enteteCookie('', 0));
    res.status(204).end();
  });

  r.get('/moi', auth, (req, res) => res.json(req.utilisateur));

  r.post('/mot-de-passe', auth, (req, res) => {
    const u = db.prepare('SELECT mot_de_passe FROM utilisateurs WHERE id = ?').get(req.utilisateur.id);
    if (!verifierMotDePasse(req.body.ancien ?? '', u.mot_de_passe)) {
      throw new HttpError(400, 'Mot de passe actuel incorrect');
    }
    const nouveau = validerMotDePasse(req.body.nouveau);
    db.prepare('UPDATE utilisateurs SET mot_de_passe = ? WHERE id = ?').run(hacherMotDePasse(nouveau), req.utilisateur.id);
    // Déconnecte les autres appareils
    db.prepare('DELETE FROM sessions WHERE utilisateur_id = ? AND jeton <> ?').run(req.utilisateur.id, req.session);
    res.status(204).end();
  });

  return r;
}

/** Crée le compte « admin » au premier démarrage. */
function initialiserAdmin(db, log = console.log) {
  if (db.prepare('SELECT COUNT(*) AS n FROM utilisateurs').get().n > 0) return;
  const fourni = process.env.ADMIN_PASSWORD;
  const mdp = fourni ? validerMotDePasse(fourni) : crypto.randomBytes(9).toString('base64url');
  db.prepare(
    "INSERT INTO utilisateurs (identifiant, nom, mot_de_passe, role) VALUES ('admin', 'Administrateur', ?, 'admin')"
  ).run(hacherMotDePasse(mdp));
  log(
    fourni
      ? 'Compte « admin » créé avec le mot de passe défini dans ADMIN_PASSWORD.'
      : `Compte « admin » créé. Mot de passe provisoire : ${mdp}\n(changez-le après la première connexion)`
  );
}

module.exports = {
  ROLES,
  authentifier,
  exigerRole,
  hacherMotDePasse,
  initialiserAdmin,
  routeurAuth,
  validerMotDePasse,
  validerRole,
};
