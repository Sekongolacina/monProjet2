const $ = (s) => document.querySelector(s);
const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

let produits = [];
let produitEnEdition = null;

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.erreur || 'Erreur');
  return data;
}

function echapper(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2500);
}

async function chargerStats() {
  const s = await api('/api/stats');
  $('#stat-produits').textContent = s.nb_produits;
  $('#stat-articles').textContent = s.total_articles.toLocaleString('fr-FR');
  $('#stat-valeur').textContent = euros.format(s.valeur_stock);
  $('#stat-alertes').textContent = s.nb_alertes;

  const select = $('#filtre-categorie');
  const courant = select.value;
  select.innerHTML = '<option value="">Toutes les catégories</option>' +
    s.categories.map((c) => `<option>${echapper(c)}</option>`).join('');
  select.value = s.categories.includes(courant) ? courant : '';
  $('#liste-categories').innerHTML = s.categories.map((c) => `<option value="${echapper(c)}">`).join('');
}

async function chargerProduits() {
  const params = new URLSearchParams({
    q: $('#recherche').value,
    categorie: $('#filtre-categorie').value,
    alerte: $('#filtre-alerte').checked ? '1' : '0',
  });
  produits = await api('/api/produits?' + params);
  $('#liste-produits').innerHTML = produits.map((p) => `
    <tr class="${p.quantite <= p.seuil_alerte ? 'bas' : ''}">
      <td>${echapper(p.reference)}</td>
      <td>${echapper(p.nom)}</td>
      <td>${echapper(p.categorie)}</td>
      <td class="num">${euros.format(p.prix)}</td>
      <td class="num qte">${p.quantite}</td>
      <td class="num">${p.seuil_alerte}</td>
      <td class="actions"><div>
        <button class="petit entree" data-action="entree" data-id="${p.id}" title="Entrée de stock">+ Entrée</button>
        <button class="petit sortie" data-action="sortie" data-id="${p.id}" title="Sortie de stock">− Sortie</button>
        <button class="petit" data-action="modifier" data-id="${p.id}">Modifier</button>
        <button class="petit suppr" data-action="supprimer" data-id="${p.id}">Supprimer</button>
      </div></td>
    </tr>`).join('');
  $('#vide-produits').hidden = produits.length > 0;
}

async function chargerMouvements() {
  const mvts = await api('/api/mouvements?limite=200');
  $('#liste-mouvements').innerHTML = mvts.map((m) => `
    <tr>
      <td>${new Date(m.date.replace(' ', 'T') + 'Z').toLocaleString('fr-FR')}</td>
      <td>${echapper(m.produit_reference)} — ${echapper(m.produit_nom)}</td>
      <td><span class="badge ${m.type}">${m.type === 'entree' ? 'Entrée' : 'Sortie'}</span></td>
      <td class="num">${m.quantite}</td>
      <td>${echapper(m.commentaire)}</td>
    </tr>`).join('');
  $('#vide-mouvements').hidden = mvts.length > 0;
}

async function toutRafraichir() {
  await Promise.all([chargerStats(), chargerProduits()]);
  if (!$('#vue-mouvements').hidden) await chargerMouvements();
}

function ouvrirDialogue(dlg) {
  dlg.querySelector('.erreur').hidden = true;
  dlg.showModal();
}

function afficherErreur(form, e) {
  const p = form.querySelector('.erreur');
  p.textContent = e.message;
  p.hidden = false;
}

function ouvrirProduit(p = null) {
  produitEnEdition = p;
  const f = $('#form-produit');
  f.reset();
  $('#titre-produit').textContent = p ? 'Modifier le produit' : 'Nouveau produit';
  $('#champ-quantite').hidden = !!p; // la quantité se modifie via les mouvements
  if (p) for (const k of ['reference', 'nom', 'categorie', 'prix', 'seuil_alerte']) f.elements[k].value = p[k];
  ouvrirDialogue($('#dlg-produit'));
}

function ouvrirMouvement(p, type) {
  const f = $('#form-mouvement');
  f.reset();
  f.elements.produit_id.value = p.id;
  f.elements.type.value = type;
  $('#titre-mouvement').textContent = type === 'entree' ? 'Entrée de stock' : 'Sortie de stock';
  $('#info-mouvement').textContent = `${p.reference} — ${p.nom} (stock actuel : ${p.quantite})`;
  ouvrirDialogue($('#dlg-mouvement'));
}

$('#form-produit').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const data = Object.fromEntries(new FormData(f));
  try {
    if (produitEnEdition) {
      delete data.quantite;
      await api(`/api/produits/${produitEnEdition.id}`, { method: 'PUT', body: data });
      toast('Produit modifié');
    } else {
      await api('/api/produits', { method: 'POST', body: data });
      toast('Produit ajouté');
    }
    $('#dlg-produit').close();
    await toutRafraichir();
  } catch (e) {
    afficherErreur(f, e);
  }
});

$('#form-mouvement').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const data = Object.fromEntries(new FormData(f));
  try {
    await api('/api/mouvements', { method: 'POST', body: data });
    $('#dlg-mouvement').close();
    toast(data.type === 'entree' ? 'Entrée enregistrée' : 'Sortie enregistrée');
    await toutRafraichir();
  } catch (e) {
    afficherErreur(f, e);
  }
});

$('#liste-produits').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-action]');
  if (!btn) return;
  const p = produits.find((x) => x.id === Number(btn.dataset.id));
  if (!p) return;
  switch (btn.dataset.action) {
    case 'entree':
    case 'sortie':
      return ouvrirMouvement(p, btn.dataset.action);
    case 'modifier':
      return ouvrirProduit(p);
    case 'supprimer':
      if (!confirm(`Supprimer « ${p.nom} » et tout son historique ?`)) return;
      try {
        await api(`/api/produits/${p.id}`, { method: 'DELETE' });
        toast('Produit supprimé');
        await toutRafraichir();
      } catch (e) {
        toast(e.message);
      }
  }
});

document.querySelectorAll('[data-fermer]').forEach((b) =>
  b.addEventListener('click', () => b.closest('dialog').close())
);

document.querySelectorAll('.onglet').forEach((b) =>
  b.addEventListener('click', async () => {
    document.querySelectorAll('.onglet').forEach((x) => x.classList.toggle('actif', x === b));
    document.querySelectorAll('.vue').forEach((v) => (v.hidden = v.id !== `vue-${b.dataset.vue}`));
    if (b.dataset.vue === 'mouvements') await chargerMouvements();
  })
);

let delai;
$('#recherche').addEventListener('input', () => {
  clearTimeout(delai);
  delai = setTimeout(chargerProduits, 200);
});
$('#filtre-categorie').addEventListener('change', chargerProduits);
$('#filtre-alerte').addEventListener('change', chargerProduits);
$('#btn-nouveau').addEventListener('click', () => ouvrirProduit());

toutRafraichir().catch((e) => toast(e.message));
