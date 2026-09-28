const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { demarrer } = require('./aide');

let env, gestion;
before(async () => {
  env = await demarrer();
  gestion = await env.client().connecter('gestion');
  const { body: fo } = await gestion.post('/api/fournisseurs', { nom: 'Papeterie; Martin', telephone: '01 02 03 04 05' });
  await gestion.post('/api/produits', {
    reference: 'RAM-A4', nom: 'Ramette "A4"', categorie: 'Bureau', prix: 4.2, quantite: 120, seuil_alerte: 30, fournisseur_id: fo.id,
  });
  await gestion.post('/api/produits', { reference: 'EVIL', nom: '=HYPERLINK("http://x")', prix: 1, quantite: 1 });
});
after(() => env.fermer());

test('export CSV des produits (format Excel français)', async () => {
  const r = await gestion.get('/api/export/produits?format=csv');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.match(r.headers.get('content-disposition'), /attachment; filename="produits-\d{4}-\d{2}-\d{2}\.csv"/);
  const texte = r.body.toString('utf8');
  assert.ok(texte.startsWith('﻿'), 'BOM UTF-8 pour Excel');
  const lignes = texte.slice(1).trim().split('\r\n');
  assert.equal(
    lignes[0],
    "Référence;Nom;Catégorie;Fournisseur;Prix unitaire;Seuil d'alerte;Stock Entrepôt principal;Stock total;Valeur du stock;Statut"
  );
  assert.equal(lignes[2], 'RAM-A4;"Ramette ""A4""";Bureau;"Papeterie; Martin";4,20;30;120;120;504,00;OK');
  assert.ok(lignes[1].startsWith(`EVIL;"'=HYPERLINK(""http://x"")"`), 'les formules sont neutralisées');
});

test('export Excel des produits', async () => {
  const r = await gestion.get('/api/export/produits?format=xlsx');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /spreadsheetml/);
  const classeur = new ExcelJS.Workbook();
  await classeur.xlsx.load(r.body);
  const feuille = classeur.getWorksheet('Produits');
  assert.equal(feuille.getCell('A1').value, 'Référence');
  assert.equal(feuille.getCell('A3').value, 'RAM-A4');
  assert.equal(feuille.getCell('E3').value, 4.2);
  assert.equal(feuille.getCell('I3').value, 504);
  assert.equal(feuille.getCell('B2').value, '=HYPERLINK("http://x")', 'stocké en texte, pas en formule');
  assert.equal(feuille.getCell('B2').formula, undefined);
});

test('export des mouvements, fournisseurs et stocks', async () => {
  const classeur = new ExcelJS.Workbook();
  await classeur.xlsx.load((await gestion.get('/api/export/mouvements?format=xlsx')).body);
  const f = classeur.worksheets[0];
  assert.equal(f.rowCount, 3);
  assert.ok(f.getCell('A2').value instanceof Date);
  assert.equal(f.getCell('I2').value, 'Gaston Gestion');

  const csv = (await gestion.get('/api/export/fournisseurs')).body.toString('utf8');
  assert.match(csv, /"Papeterie; Martin";;;01 02 03 04 05;;1;/);

  const stocks = (await gestion.get('/api/export/stocks?format=csv')).body.toString('utf8');
  assert.match(stocks, /Entrepôt principal;RAM-A4;"Ramette ""A4""";Bureau;120;4,20;504,00/);
});

test('export : filtres et erreurs', async () => {
  const filtre = (await gestion.get('/api/export/produits?q=RAM')).body.toString('utf8').trim().split('\r\n');
  assert.equal(filtre.length, 2);
  assert.equal((await gestion.get('/api/export/inconnu')).status, 404);
  assert.equal((await gestion.get('/api/export/constructor')).status, 404);
  assert.equal((await gestion.get('/api/export/produits?format=pdf')).status, 400);
});
