import { loadCollection, addToCol, updateInCol, deleteFromCol } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import PAGES from './pages.js';

// SHOP ACTIONS
// ══════════════════════════════════════════════
function openShopItemModal(item) {
  openModal(item?'✏️ Modifier l\'article':'🛒 Nouvel Article', `
    <div class="form-group"><label>Nom</label><input class="input-field" id="si-nom" value="${item?.nom||''}"></div>
    <div class="form-group"><label>Catégorie</label><input class="input-field" id="si-cat" value="${item?.categorie||''}" placeholder="Armes, Armures, Potions, Runes..."></div>
    <div class="form-group"><label>Prix (Or)</label><input type="number" class="input-field" id="si-prix" value="${item?.prix||0}" min="0"></div>
    <div class="form-group"><label>Description / Effet</label><textarea class="input-field" id="si-desc" rows="4">${item?.description||''}</textarea></div>
    <button class="btn btn-gold" style="width:100%;margin-top:1rem" onclick="saveShopItem('${item?.id||''}')">Enregistrer</button>
  `);
}

async function saveShopItem(id) {
  const data = {
    nom: document.getElementById('si-nom')?.value||'?',
    categorie: document.getElementById('si-cat')?.value||'Divers',
    prix: parseInt(document.getElementById('si-prix')?.value)||0,
    description: document.getElementById('si-desc')?.value||'',
  };
  if (id) await updateInCol('shop',id,data);
  else await addToCol('shop',data);
  closeModal(); showNotif('Article enregistré !','success');
  PAGES.shop();
}

async function editShopItem(id) {
  const items = await loadCollection('shop');
  const item = items.find(i=>i.id===id);
  if (item) openShopItemModal(item);
}

async function deleteShopItem(id) {
  if (!confirm('Supprimer cet article ?')) return;
  await deleteFromCol('shop',id);
  showNotif('Article supprimé.','success'); PAGES.shop();
}

function filterShop(cat, el) {
  document.querySelectorAll('#shop-cats .tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.shop-item').forEach(item=>{
    item.style.display = !cat||item.dataset.cat===cat ? '' : 'none';
  });
}


Object.assign(window, {
  openShopItemModal,
  saveShopItem,
  editShopItem,
  deleteShopItem,
  filterShop
});
