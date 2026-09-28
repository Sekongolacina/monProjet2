const express = require('express');
const ExcelJS = require('exceljs');
const { HttpError, asynchrone } = require('../util');
const { listerProduits } = require('./produits');
const { listerMouvements } = require('./mouvements');
const { listerFournisseurs } = require('./fournisseurs');
const { listerEntrepots } = require('./entrepots');

const LIBELLES_TYPE = { entree: 'Entrée', sortie: 'Sortie', transfert: 'Transfert' };

/** Date SQLite UTC → Date dont les champs UTC portent l'heure locale du serveur (ce qu'attend Excel). */
function dateLocale(sqlite) {
  const d = new Date(sqlite.replace(' ', 'T') + 'Z');
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000);
}

const col = (titre, valeur, type = 'texte') => ({ titre, valeur, type });

/** Chaque export décrit ses colonnes (titre, extraction, type) et ses lignes. */
const EXPORTS = {
  produits(db, q) {
    const entrepots = listerEntrepots(db);
    return {
      titre: 'Produits',
      lignes: listerProduits(db, q),
      colonnes: [
        col('Référence', (p) => p.reference),
        col('Nom', (p) => p.nom),
        col('Catégorie', (p) => p.categorie),
        col('Fournisseur', (p) => p.fournisseur_nom ?? ''),
        col('Prix unitaire', (p) => p.prix, 'monnaie'),
        col("Seuil d'alerte", (p) => p.seuil_alerte, 'entier'),
        ...entrepots.map((e) =>
          col(`Stock ${e.nom}`, (p) => p.stocks.find((s) => s.entrepot_id === e.id)?.quantite ?? 0, 'entier')
        ),
        col('Stock total', (p) => p.quantite_totale, 'entier'),
        col('Valeur du stock', (p) => p.quantite_totale * p.prix, 'monnaie'),
        col('Statut', (p) => (p.quantite_totale <= p.seuil_alerte ? 'Stock bas' : 'OK')),
      ],
    };
  },

  mouvements(db, q) {
    return {
      titre: 'Mouvements',
      lignes: listerMouvements(db, { ...q, limite: undefined }),
      colonnes: [
        col('Date', (m) => dateLocale(m.date), 'date'),
        col('Type', (m) => LIBELLES_TYPE[m.type]),
        col('Référence', (m) => m.produit_reference),
        col('Produit', (m) => m.produit_nom),
        col('Quantité', (m) => m.quantite, 'entier'),
        col('Entrepôt', (m) => m.entrepot_nom),
        col('Entrepôt destination', (m) => m.entrepot_dest_nom ?? ''),
        col('Fournisseur', (m) => m.fournisseur_nom ?? ''),
        col('Utilisateur', (m) => m.utilisateur_nom ?? ''),
        col('Commentaire', (m) => m.commentaire),
      ],
    };
  },

  fournisseurs(db, q) {
    return {
      titre: 'Fournisseurs',
      lignes: listerFournisseurs(db, { q: q.q }),
      colonnes: [
        col('Nom', (f) => f.nom),
        col('Contact', (f) => f.contact),
        col('Email', (f) => f.email),
        col('Téléphone', (f) => f.telephone),
        col('Adresse', (f) => f.adresse),
        col('Produits', (f) => f.nb_produits, 'entier'),
        col('Notes', (f) => f.notes),
      ],
    };
  },

  stocks(db) {
    return {
      titre: 'Stocks par entrepôt',
      lignes: db
        .prepare(
          `SELECT e.nom AS entrepot, p.reference, p.nom, p.categorie, s.quantite, p.prix
           FROM stocks s JOIN entrepots e ON e.id = s.entrepot_id JOIN produits p ON p.id = s.produit_id
           WHERE s.quantite > 0 ORDER BY e.nom COLLATE NOCASE, p.nom COLLATE NOCASE`
        )
        .all(),
      colonnes: [
        col('Entrepôt', (s) => s.entrepot),
        col('Référence', (s) => s.reference),
        col('Produit', (s) => s.nom),
        col('Catégorie', (s) => s.categorie),
        col('Quantité', (s) => s.quantite, 'entier'),
        col('Prix unitaire', (s) => s.prix, 'monnaie'),
        col('Valeur', (s) => s.quantite * s.prix, 'monnaie'),
      ],
    };
  },
};

const deux = (n) => String(n).padStart(2, '0');

function celluleCsv(v, type) {
  if (v === null || v === undefined) return '';
  if (type === 'monnaie') return v.toFixed(2).replace('.', ',');
  if (type === 'entier') return String(v);
  if (type === 'date') {
    return `${deux(v.getUTCDate())}/${deux(v.getUTCMonth() + 1)}/${v.getUTCFullYear()} ${deux(v.getUTCHours())}:${deux(v.getUTCMinutes())}`;
  }
  let s = String(v);
  // Empêche l'interprétation comme formule par le tableur (injection CSV)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[";\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** CSV au format attendu par Excel en français : séparateur « ; », virgule décimale, BOM UTF-8. */
function enCsv({ colonnes, lignes }) {
  const texte = [colonnes.map((c) => celluleCsv(c.titre)), ...lignes.map((l) => colonnes.map((c) => celluleCsv(c.valeur(l), c.type)))]
    .map((l) => l.join(';'))
    .join('\r\n');
  return Buffer.from('﻿' + texte + '\r\n', 'utf8');
}

const FORMATS_XLSX = { monnaie: '#,##0.00 "€"', entier: '0', date: 'dd/mm/yyyy hh:mm' };

async function enXlsx({ titre, colonnes, lignes }) {
  const classeur = new ExcelJS.Workbook();
  classeur.creator = 'Gestion de stocks';
  classeur.created = new Date();
  const feuille = classeur.addWorksheet(titre.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  const valeurs = lignes.map((l) => colonnes.map((c) => c.valeur(l)));
  feuille.columns = colonnes.map((c, i) => ({
    header: c.titre,
    width: Math.min(
      50,
      Math.max(c.titre.length + 2, c.type === 'date' ? 17 : 10, ...valeurs.map((v) => String(v[i] ?? '').length + 2))
    ),
    style: FORMATS_XLSX[c.type] ? { numFmt: FORMATS_XLSX[c.type] } : {},
  }));
  feuille.addRows(valeurs);
  const entete = feuille.getRow(1);
  entete.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  entete.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
  feuille.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colonnes.length } };
  return Buffer.from(await classeur.xlsx.writeBuffer());
}

function routeurExport(db) {
  const r = express.Router();
  r.get(
    '/:type',
    asynchrone(async (req, res) => {
      const construire = Object.hasOwn(EXPORTS, req.params.type) && EXPORTS[req.params.type];
      if (!construire) throw new HttpError(404, "Type d'export inconnu");
      const format = req.query.format || 'csv';
      if (!['csv', 'xlsx'].includes(format)) throw new HttpError(400, "Le format doit être 'csv' ou 'xlsx'");

      const donnees = construire(db, req.query);
      const jour = new Date().toISOString().slice(0, 10);
      const fichier = `${req.params.type}-${jour}.${format}`;
      res.setHeader('Content-Disposition', `attachment; filename="${fichier}"`);
      if (format === 'csv') {
        res.type('text/csv; charset=utf-8').send(enCsv(donnees));
      } else {
        res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(await enXlsx(donnees));
      }
    })
  );
  return r;
}

module.exports = { routeurExport };
