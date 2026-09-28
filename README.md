# Gestion de stocks

Application web simple pour gérer un stock de produits.

## Fonctionnalités

- **Produits** : ajout, modification, suppression (référence unique, nom, catégorie, prix, seuil d'alerte)
- **Mouvements** : entrées et sorties de stock avec commentaire ; une sortie ne peut pas dépasser le stock disponible
- **Historique** : chaque mouvement est tracé (y compris le stock initial) — la quantité ne se modifie que par mouvements
- **Tableau de bord** : nombre de produits, articles en stock, valeur totale, alertes de stock bas
- **Recherche et filtres** : par nom/référence, par catégorie, stock bas uniquement

## Démarrage

Prérequis : Node.js 22.13 ou plus récent (utilise le module SQLite intégré `node:sqlite`).

```bash
npm install
npm start
```

Puis ouvrir <http://localhost:3000>. Les données sont stockées dans `stock.db`
(modifiable via la variable `DB_FILE`, le port via `PORT`).

## Tests

```bash
npm test
```

## API REST

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/produits?q=&categorie=&alerte=1` | Liste / recherche des produits |
| GET | `/api/produits/:id` | Détail d'un produit |
| POST | `/api/produits` | Créer un produit |
| PUT | `/api/produits/:id` | Modifier un produit (hors quantité) |
| DELETE | `/api/produits/:id` | Supprimer un produit et son historique |
| GET | `/api/mouvements?produit_id=&limite=` | Historique des mouvements |
| POST | `/api/mouvements` | Enregistrer une entrée/sortie (`{produit_id, type: "entree"\|"sortie", quantite, commentaire}`) |
| GET | `/api/stats` | Statistiques et liste des catégories |

## Structure

```
src/db.js       schéma SQLite
src/app.js      API Express
src/server.js   point d'entrée
public/         interface web (HTML/CSS/JS sans framework)
test/           tests de l'API (node:test)
```
