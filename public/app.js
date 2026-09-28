const $ = (s, racine = document) => racine.querySelector(s);
const $$ = (s, racine = document) => [...racine.querySelectorAll(s)];
const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const LIBELLES_TYPE = { entree: 'Entrée', sortie: 'Sortie', transfert: 'Transfert' };
const LIBELLES_ROLE = { admin: 'Administrateur', gestionnaire: 'Gestionnaire', lecteur: 'Lecteur' };

const etat = {
  moi: null,
  vue: 'produits',
  entrepots: [],
  fournisseurs: [],
  categories: [],
  produits: [],
  utilisateurs: [],
};

// ---------- Utilitaires ----------

async function api(url, options = {}) {
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401 && !url.startsWith('/api/auth/connexion')) {
    afficherConnexion();
    throw new Error('Session expirée, veuillez vous reconnecter');
  }
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.erreur || 'Erreur');
  return data;
}

function echapper(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const dateFr = (d) => new Date(d.replace(' ', 'T') + 'Z').toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.minuteur);
  toast.minuteur = setTimeout(() => (t.hidden = true), 3000);
}

/** Remplit un <select> en conservant la valeur choisie si elle existe encore. */
function remplirSelect(select, elements, { vide = null, valeur = select.value } = {}) {
  select.innerHTML =
    (vide !== null ? `<option value="">${echapper(vide)}</option>` : '') +
    elements.map((e) => `<option value="${echapper(e.id)}">${echapper(e.nom)}</option>`).join('');
  if ([...select.options].some((o) => o.value === String(valeur))) select.value = valeur;
}

function afficherVide(tbody, liste) {
  const vide = $('.vide', tbody.closest('.tableau'));
  if (vide) vide.hidden = liste.length > 0;
}

const peutEcrire = () => etat.moi && etat.moi.role !== 'lecteur';
const estAdmin = () => etat.moi && etat.moi.role === 'admin';

// ---------- Connexion ----------

function afficherConnexion() {
  etat.moi = null;
  $$('dialog[open]').forEach((d) => d.close());
  $('#application').hidden = true;
  $('#ecran-connexion').hidden = false;
  $('#form-connexion').reset();
  $('#form-connexion [name=identifiant]').focus();
}

async function demarrerSession(moi) {
  etat.moi = moi;
  document.body.className = `role-${moi.role}`;
  $('#moi').innerHTML = `${echapper(moi.nom || moi.identifiant)} <span class="badge ${moi.role}">${LIBELLES_ROLE[moi.role]}</span>`;
  $('#ecran-connexion').hidden = true;
  $('#application').hidden = false;
  if (etat.vue === 'utilisateurs' && !estAdmin()) etat.vue = 'produits';
  await afficherVue(etat.vue);
}

$('#form-connexion').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const erreur = $('.erreur', f);
  erreur.hidden = true;
  try {
    const moi = await api('/api/auth/connexion', { method: 'POST', body: Object.fromEntries(new FormData(f)) });
    await demarrerSession(moi);
  } catch (e) {
    erreur.textContent = e.message;
    erreur.hidden = false;
  }
});

$('#btn-deconnexion').addEventListener('click', async () => {
  await api('/api/auth/deconnexion', { method: 'POST' }).catch(() => {});
  afficherConnexion();
});

$('#btn-mdp').addEventListener('click', () =>
  ouvrirFormulaire('mdp', 'Changer mon mot de passe', {}, async (d) => {
    if (d.nouveau !== d.confirmation) throw new Error('Les deux mots de passe ne correspondent pas');
    await api('/api/auth/mot-de-passe', { method: 'POST', body: { ancien: d.ancien, nouveau: d.nouveau } });
    toast('Mot de passe modifié');
  })
);

// ---------- Formulaires en boîte de dialogue ----------

const surValidation = {};

function ouvrirFormulaire(id, titre, valeurs, valider) {
  const dlg = $(`#dlg-${id}`);
  const f = $('form', dlg);
  f.reset();
  $('h2', dlg).textContent = titre;
  for (const [cle, v] of Object.entries(valeurs)) {
    if (f.elements[cle]) f.elements[cle].value = v ?? '';
  }
  $('.erreur', f).hidden = true;
  surValidation[id] = valider;
  dlg.showModal();
  return f;
}

$$('dialog form').forEach((f) =>
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const dlg = f.closest('dialog');
    const bouton = $('[type=submit]', f);
    bouton.disabled = true;
    try {
      await surValidation[dlg.id.slice(4)](Object.fromEntries(new FormData(f)), f);
      dlg.close();
      await rafraichir();
    } catch (e) {
      const p = $('.erreur', f);
      p.textContent = e.message;
      p.hidden = false;
    } finally {
      bouton.disabled = false;
    }
  })
);

$$('[data-fermer]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

// ---------- Données de référence et statistiques ----------

async function chargerReferences() {
  const [entrepots, fournisseurs, stats] = await Promise.all([
    api('/api/entrepots'),
    api('/api/fournisseurs'),
    api('/api/stats?' + new URLSearchParams({ entrepot_id: $('#p-entrepot').value })),
  ]);
  Object.assign(etat, { entrepots, fournisseurs, categories: stats.categories });

  $('#stat-produits').textContent = stats.nb_produits;
  $('#stat-articles').textContent = stats.total_articles.toLocaleString('fr-FR');
  $('#stat-valeur').textContent = euros.format(stats.valeur_stock);
  $('#stat-alertes').textContent = stats.nb_alertes;

  remplirSelect($('#p-categorie'), stats.categories.map((c) => ({ id: c, nom: c })), { vide: 'Toutes les catégories' });
  remplirSelect($('#p-fournisseur'), fournisseurs, { vide: 'Tous les fournisseurs' });
  remplirSelect($('#p-entrepot'), entrepots, { vide: 'Tous les entrepôts' });
  remplirSelect($('#m-entrepot'), entrepots, { vide: 'Tous les entrepôts' });
  $('#liste-categories').innerHTML = stats.categories.map((c) => `<option value="${echapper(c)}">`).join('');
}

// ---------- Exports ----------

function filtresExport(type) {
  if (type === 'produits') return filtresProduits();
  if (type === 'mouvements') return filtresMouvements();
  if (type === 'fournisseurs') return { q: $('#f-recherche').value };
  return {};
}

$$('[data-export]').forEach((zone) => {
  zone.innerHTML = `${echapper(zone.dataset.libelle || 'Exporter')} :
    <button class="petit" data-format="csv">CSV</button>
    <button class="petit" data-format="xlsx">Excel</button>`;
  zone.addEventListener('click', (ev) => {
    const format = ev.target.dataset.format;
    if (!format) return;
    const type = zone.dataset.export;
    const params = new URLSearchParams({ ...filtresExport(type), format });
    const a = document.createElement('a');
    a.href = `/api/export/${type}?${params}`;
    a.download = '';
    a.click();
  });
});

// ---------- Produits ----------

function filtresProduits() {
  return {
    q: $('#p-recherche').value,
    categorie: $('#p-categorie').value,
    fournisseur_id: $('#p-fournisseur').value,
    entrepot_id: $('#p-entrepot').value,
    alerte: $('#p-alerte').checked ? '1' : '',
  };
}

async function chargerProduits() {
  etat.produits = await api('/api/produits?' + new URLSearchParams(filtresProduits()));
  const multi = etat.entrepots.length > 1;
  const tbody = $('#liste-produits');
  tbody.innerHTML = etat.produits
    .map((p) => {
      const detail = p.stocks.map((s) => `${s.entrepot_nom} : ${s.quantite}`).join('\n');
      const filtre = $('#p-entrepot').value;
      const quantite = filtre ? `${p.quantite} <span class="doux">/ ${p.quantite_totale}</span>` : p.quantite_totale;
      return `
      <tr class="${p.quantite_totale <= p.seuil_alerte ? 'bas' : ''}">
        <td>${echapper(p.reference)}</td>
        <td>${echapper(p.nom)}</td>
        <td>${echapper(p.categorie)}</td>
        <td>${echapper(p.fournisseur_nom)}</td>
        <td class="num">${euros.format(p.prix)}</td>
        <td class="num qte" ${multi && detail ? `title="${echapper(detail)}"` : ''}>${quantite}</td>
        <td class="num">${p.seuil_alerte}</td>
        <td class="ecriture"><div class="actions-ligne">
          <button class="petit entree" data-action="entree" data-id="${p.id}">+ Entrée</button>
          <button class="petit sortie" data-action="sortie" data-id="${p.id}">− Sortie</button>
          ${multi ? `<button class="petit transfert" data-action="transfert" data-id="${p.id}">⇄ Transfert</button>` : ''}
          <button class="petit" data-action="modifier" data-id="${p.id}">Modifier</button>
          <button class="petit suppr" data-action="supprimer" data-id="${p.id}">Supprimer</button>
        </div></td>
      </tr>`;
    })
    .join('');
  afficherVide(tbody, etat.produits);
}

function ouvrirProduit(p = null) {
  const f = $('#dlg-produit form');
  remplirSelect(f.elements.fournisseur_id, etat.fournisseurs, { vide: '— Aucun —', valeur: '' });
  remplirSelect(f.elements.entrepot_id, etat.entrepots, { valeur: '' });
  $('.creation-seule', f).hidden = !!p; // la quantité se modifie via les mouvements
  const valeurs = p
    ? { reference: p.reference, nom: p.nom, categorie: p.categorie, prix: p.prix, seuil_alerte: p.seuil_alerte, fournisseur_id: p.fournisseur_id ?? '' }
    : {};
  ouvrirFormulaire('produit', p ? 'Modifier le produit' : 'Nouveau produit', valeurs, async (d) => {
    if (p) {
      delete d.quantite;
      delete d.entrepot_id;
      await api(`/api/produits/${p.id}`, { method: 'PUT', body: d });
      toast('Produit modifié');
    } else {
      await api('/api/produits', { method: 'POST', body: d });
      toast('Produit ajouté');
    }
  });
}

function ouvrirMouvement(p, type) {
  const f = $('#dlg-mouvement form');
  const entrepotFiltre = $('#p-entrepot').value;
  // Par défaut : l'entrepôt filtré, sinon celui qui contient le plus de ce produit
  const principal = [...p.stocks].sort((a, b) => b.quantite - a.quantite)[0];
  const parDefaut = entrepotFiltre || principal?.entrepot_id || etat.entrepots[0]?.id;
  remplirSelect(f.elements.entrepot_id, etat.entrepots.map((e) => {
    const s = p.stocks.find((x) => x.entrepot_id === e.id);
    return { id: e.id, nom: `${e.nom} (${s ? s.quantite : 0})` };
  }), { valeur: '' });
  remplirSelect(f.elements.entrepot_dest_id, etat.entrepots, { valeur: '' });
  remplirSelect(f.elements.fournisseur_id, etat.fournisseurs, { vide: '— Aucun —', valeur: '' });
  ouvrirFormulaire('mouvement', `${p.reference} — ${p.nom}`, { produit_id: p.id, type, entrepot_id: parDefaut, fournisseur_id: p.fournisseur_id ?? '' }, async (d) => {
    const r = await api('/api/mouvements', { method: 'POST', body: d });
    toast(`${LIBELLES_TYPE[d.type]} enregistrée — stock total : ${r.produit.quantite_totale}`);
  });
  $('#info-mouvement').textContent = `Stock total : ${p.quantite_totale}`;
  const autre = etat.entrepots.find((e) => String(e.id) !== String(parDefaut));
  if (autre) f.elements.entrepot_dest_id.value = autre.id;
  majChampsMouvement();
}

function majChampsMouvement() {
  const f = $('#dlg-mouvement form');
  const type = f.elements.type.value;
  $('.si-transfert', f).hidden = type !== 'transfert';
  $('.si-entree', f).hidden = type !== 'entree';
  $('#libelle-entrepot').textContent = type === 'transfert' ? 'Depuis' : 'Entrepôt';
}
$('#dlg-mouvement [name=type]').addEventListener('change', majChampsMouvement);

$('#liste-produits').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-action]');
  if (!btn) return;
  const p = etat.produits.find((x) => x.id === Number(btn.dataset.id));
  if (!p) return;
  const action = btn.dataset.action;
  if (['entree', 'sortie', 'transfert'].includes(action)) return ouvrirMouvement(p, action);
  if (action === 'modifier') return ouvrirProduit(p);
  if (action === 'supprimer' && confirm(`Supprimer « ${p.nom} » et tout son historique de mouvements ?`)) {
    await supprimer(`/api/produits/${p.id}`, 'Produit supprimé');
  }
});

async function supprimer(url, message) {
  try {
    await api(url, { method: 'DELETE' });
    toast(message);
    await rafraichir();
  } catch (e) {
    toast(e.message);
  }
}

// ---------- Mouvements ----------

function filtresMouvements() {
  return { type: $('#m-type').value, entrepot_id: $('#m-entrepot').value, du: $('#m-du').value, au: $('#m-au').value };
}

async function chargerMouvements() {
  const mvts = await api('/api/mouvements?' + new URLSearchParams({ ...filtresMouvements(), limite: 200 }));
  const tbody = $('#liste-mouvements');
  tbody.innerHTML = mvts
    .map(
      (m) => `
    <tr>
      <td>${dateFr(m.date)}</td>
      <td>${echapper(m.produit_reference)} — ${echapper(m.produit_nom)}</td>
      <td><span class="badge ${m.type}">${LIBELLES_TYPE[m.type]}</span></td>
      <td class="num">${m.quantite}</td>
      <td>${echapper(m.entrepot_nom)}${m.entrepot_dest_nom ? ` → ${echapper(m.entrepot_dest_nom)}` : ''}</td>
      <td>${echapper(m.fournisseur_nom)}</td>
      <td class="doux">${echapper(m.utilisateur_nom)}</td>
      <td class="long">${echapper(m.commentaire)}</td>
    </tr>`
    )
    .join('');
  afficherVide(tbody, mvts);
}

// ---------- Fournisseurs ----------

async function chargerFournisseurs() {
  const liste = await api('/api/fournisseurs?' + new URLSearchParams({ q: $('#f-recherche').value }));
  const tbody = $('#liste-fournisseurs');
  tbody.innerHTML = liste
    .map(
      (f) => `
    <tr>
      <td><strong>${echapper(f.nom)}</strong>${f.adresse ? `<br><span class="doux">${echapper(f.adresse)}</span>` : ''}</td>
      <td>${echapper(f.contact)}</td>
      <td>${f.email ? `<a href="mailto:${echapper(f.email)}">${echapper(f.email)}</a>` : ''}</td>
      <td>${f.telephone ? `<a href="tel:${echapper(f.telephone.replace(/\s/g, ''))}">${echapper(f.telephone)}</a>` : ''}</td>
      <td class="num">${f.nb_produits}</td>
      <td><div class="actions-ligne">
        <button class="petit" data-action="produits" data-id="${f.id}">Voir les produits</button>
        <button class="petit ecriture" data-action="modifier" data-id="${f.id}">Modifier</button>
        <button class="petit suppr ecriture" data-action="supprimer" data-id="${f.id}">Supprimer</button>
      </div></td>
    </tr>`
    )
    .join('');
  etat.listeFournisseurs = liste;
  afficherVide(tbody, liste);
}

function ouvrirFournisseur(fo = null) {
  ouvrirFormulaire('fournisseur', fo ? 'Modifier le fournisseur' : 'Nouveau fournisseur', fo || {}, async (d) => {
    await api(fo ? `/api/fournisseurs/${fo.id}` : '/api/fournisseurs', { method: fo ? 'PUT' : 'POST', body: d });
    toast(fo ? 'Fournisseur modifié' : 'Fournisseur ajouté');
  });
}

$('#liste-fournisseurs').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-action]');
  if (!btn) return;
  const fo = etat.listeFournisseurs.find((x) => x.id === Number(btn.dataset.id));
  if (btn.dataset.action === 'produits') {
    $('#p-fournisseur').value = fo.id;
    return afficherVue('produits');
  }
  if (btn.dataset.action === 'modifier') return ouvrirFournisseur(fo);
  if (btn.dataset.action === 'supprimer' && confirm(`Supprimer le fournisseur « ${fo.nom} » ? Ses produits seront conservés.`)) {
    await supprimer(`/api/fournisseurs/${fo.id}`, 'Fournisseur supprimé');
  }
});

// ---------- Entrepôts ----------

async function chargerEntrepots() {
  const tbody = $('#liste-entrepots');
  tbody.innerHTML = etat.entrepots
    .map(
      (e) => `
    <tr>
      <td><strong>${echapper(e.nom)}</strong></td>
      <td>${echapper(e.adresse)}</td>
      <td class="num">${e.nb_produits}</td>
      <td class="num">${e.total_articles.toLocaleString('fr-FR')}</td>
      <td class="num">${euros.format(e.valeur_stock)}</td>
      <td><div class="actions-ligne">
        <button class="petit" data-action="stock" data-id="${e.id}">Voir le stock</button>
        <button class="petit admin-seul" data-action="modifier" data-id="${e.id}">Modifier</button>
        <button class="petit suppr admin-seul" data-action="supprimer" data-id="${e.id}">Supprimer</button>
      </div></td>
    </tr>`
    )
    .join('');
}

function ouvrirEntrepot(e = null) {
  ouvrirFormulaire('entrepot', e ? "Modifier l'entrepôt" : 'Nouvel entrepôt', e || {}, async (d) => {
    await api(e ? `/api/entrepots/${e.id}` : '/api/entrepots', { method: e ? 'PUT' : 'POST', body: d });
    toast(e ? 'Entrepôt modifié' : 'Entrepôt ajouté');
  });
}

$('#liste-entrepots').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-action]');
  if (!btn) return;
  const e = etat.entrepots.find((x) => x.id === Number(btn.dataset.id));
  if (btn.dataset.action === 'stock') {
    $('#p-entrepot').value = e.id;
    return afficherVue('produits');
  }
  if (btn.dataset.action === 'modifier') return ouvrirEntrepot(e);
  if (btn.dataset.action === 'supprimer' && confirm(`Supprimer l'entrepôt « ${e.nom} » ?`)) {
    await supprimer(`/api/entrepots/${e.id}`, 'Entrepôt supprimé');
  }
});

// ---------- Utilisateurs ----------

async function chargerUtilisateurs() {
  etat.utilisateurs = await api('/api/utilisateurs');
  $('#liste-utilisateurs').innerHTML = etat.utilisateurs
    .map((u) => {
      const soi = u.id === etat.moi.id;
      return `
    <tr class="${u.actif ? '' : 'inactif'}">
      <td><strong>${echapper(u.identifiant)}</strong>${soi ? ' <span class="doux">(vous)</span>' : ''}</td>
      <td>${echapper(u.nom)}</td>
      <td><span class="badge ${u.role}">${LIBELLES_ROLE[u.role]}</span></td>
      <td><span class="badge ${u.actif ? 'actif' : 'inactif'}">${u.actif ? 'Actif' : 'Désactivé'}</span></td>
      <td class="doux">${dateFr(u.cree_le)}</td>
      <td><div class="actions-ligne">
        <button class="petit" data-action="modifier" data-id="${u.id}">Modifier</button>
        ${soi ? '' : `<button class="petit" data-action="basculer" data-id="${u.id}">${u.actif ? 'Désactiver' : 'Réactiver'}</button>
        <button class="petit suppr" data-action="supprimer" data-id="${u.id}">Supprimer</button>`}
      </div></td>
    </tr>`;
    })
    .join('');
}

function ouvrirUtilisateur(u = null) {
  const f = ouvrirFormulaire('utilisateur', u ? `Modifier ${u.identifiant}` : 'Nouvel utilisateur', u ? { identifiant: u.identifiant, nom: u.nom, role: u.role } : {}, async (d) => {
    if (u) {
      const corps = { nom: d.nom, role: d.role };
      if (d.mot_de_passe) corps.mot_de_passe = d.mot_de_passe;
      await api(`/api/utilisateurs/${u.id}`, { method: 'PUT', body: corps });
      toast('Utilisateur modifié');
    } else {
      await api('/api/utilisateurs', { method: 'POST', body: d });
      toast('Utilisateur créé');
    }
  });
  f.elements.identifiant.readOnly = !!u;
  f.elements.role.disabled = !!u && u.id === etat.moi.id;
  f.elements.mot_de_passe.required = !u;
  $('#libelle-mdp').textContent = u ? 'Nouveau mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe (8 caractères min.)';
}

$('#liste-utilisateurs').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-action]');
  if (!btn) return;
  const u = etat.utilisateurs.find((x) => x.id === Number(btn.dataset.id));
  if (btn.dataset.action === 'modifier') return ouvrirUtilisateur(u);
  if (btn.dataset.action === 'basculer') {
    try {
      await api(`/api/utilisateurs/${u.id}`, { method: 'PUT', body: { actif: !u.actif } });
      toast(u.actif ? 'Compte désactivé' : 'Compte réactivé');
      await rafraichir();
    } catch (e) {
      toast(e.message);
    }
  }
  if (btn.dataset.action === 'supprimer' && confirm(`Supprimer le compte « ${u.identifiant} » ? Ses mouvements restent dans l'historique.`)) {
    await supprimer(`/api/utilisateurs/${u.id}`, 'Utilisateur supprimé');
  }
});

// ---------- Navigation ----------

const CHARGEURS = {
  produits: chargerProduits,
  mouvements: chargerMouvements,
  fournisseurs: chargerFournisseurs,
  entrepots: chargerEntrepots,
  utilisateurs: chargerUtilisateurs,
};

async function rafraichir() {
  try {
    await chargerReferences();
    await CHARGEURS[etat.vue]();
  } catch (e) {
    if (etat.moi) toast(e.message);
  }
}

async function afficherVue(vue) {
  etat.vue = vue;
  $$('.onglet').forEach((b) => b.classList.toggle('actif', b.dataset.vue === vue));
  $$('.vue').forEach((v) => (v.hidden = v.id !== `vue-${vue}`));
  await rafraichir();
}

$$('.onglet').forEach((b) => b.addEventListener('click', () => afficherVue(b.dataset.vue)));

function differer(fn, ms = 200) {
  let t;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

$('#p-recherche').addEventListener('input', differer(chargerProduits));
$('#f-recherche').addEventListener('input', differer(chargerFournisseurs));
['#p-categorie', '#p-fournisseur', '#p-alerte'].forEach((s) => $(s).addEventListener('change', chargerProduits));
$('#p-entrepot').addEventListener('change', rafraichir); // les statistiques dépendent aussi de l'entrepôt
['#m-type', '#m-entrepot', '#m-du', '#m-au'].forEach((s) => $(s).addEventListener('change', chargerMouvements));

$('#btn-nouveau-produit').addEventListener('click', () => ouvrirProduit());
$('#btn-nouveau-fournisseur').addEventListener('click', () => ouvrirFournisseur());
$('#btn-nouvel-entrepot').addEventListener('click', () => ouvrirEntrepot());
$('#btn-nouvel-utilisateur').addEventListener('click', () => ouvrirUtilisateur());

// ---------- Démarrage ----------

api('/api/auth/moi').then(demarrerSession, () => {});
