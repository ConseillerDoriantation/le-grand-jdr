import { STATE } from '../core/state.js';
import { addToCol, updateInCol, deleteFromCol } from '../data/firestore.js';
import { openModal, closeModal } from '../shared/modal.js';
import { showNotif } from '../shared/notifications.js';
import PAGES from './pages.js';

const TAB_LABELS = {
  carac: 'Vue d’ensemble',
  equip: 'Équipement',
  deck: 'Sorts',
  inventaire: 'Inventaire',
  quetes: 'Quêtes',
  notes: 'Notes',
};

const STATS = [
  { key: 'force', label: 'Force', short: 'FO' },
  { key: 'dexterite', label: 'Dextérité', short: 'DEX' },
  { key: 'intelligence', label: 'Intelligence', short: 'INT' },
  { key: 'sagesse', label: 'Sagesse', short: 'SAG' },
  { key: 'constitution', label: 'Constitution', short: 'CON' },
  { key: 'charisme', label: 'Charisme', short: 'CHA' },
];

const ARMOR_SLOTS = ['Tête', 'Torse', 'Bottes', 'Amulette', 'Anneau', 'Objet magique'];
const WEAPON_SLOTS = ['Main principale', 'Main secondaire'];
const NOYAUX = ['Feu', 'Eau', 'Terre', 'Vent', 'Foudre', 'Ombre', 'Lumière', 'Physique', 'Arcane'];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getDefaultStats() {
  return { force: 10, dexterite: 8, intelligence: 8, sagesse: 8, constitution: 8, charisme: 10 };
}

function getCurrentChar() {
  return STATE.activeChar || window._currentChar || null;
}

function canEditChar(char) {
  return Boolean(char && (STATE.isAdmin || char.uid === STATE.user?.uid));
}

function normaliseTab(tab) {
  return TAB_LABELS[tab] ? tab : 'carac';
}

function getPathValue(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function setPathValue(obj, path, value) {
  const keys = path.split('.');
  let ref = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (typeof ref[key] !== 'object' || ref[key] === null) ref[key] = {};
    ref = ref[key];
  }
  ref[keys[keys.length - 1]] = value;
}

function statTotal(c, key) {
  const stats = { ...getDefaultStats(), ...(c.stats || {}) };
  const bonus = c.statsBonus || {};
  return (stats[key] || 0) + (bonus[key] || 0);
}

function getMod(c, key) {
  return Math.floor((statTotal(c, key) - 10) / 2);
}

function formatMod(value) {
  return value >= 0 ? `+${value}` : `${value}`;
}

function calcCA(c) {
  const equip = c.equipement || {};
  const torse = equip['Torse']?.typeArmure || '';
  let caBase = 8;
  if (torse === 'Légère') caBase = 10;
  else if (torse === 'Intermédiaire') caBase = 12;
  else if (torse === 'Lourde') caBase = 14;
  const caEquip = Object.values(equip).reduce((sum, item) => sum + (item?.ca || 0), 0);
  return caBase + getMod(c, 'dexterite') + caEquip;
}

function calcVitesse(c) {
  return 3 + getMod(c, 'force');
}

function calcDeck(c) {
  const sorts = c.deck_sorts || [];
  const actifs = sorts.filter((s) => s.actif).length;
  const modIn = getMod(c, 'intelligence');
  const niveau = c.niveau || 1;
  const maxDeck = 3 + Math.min(0, modIn) + Math.floor(Math.max(0, modIn) * Math.pow(Math.max(0, niveau - 1), 0.75));
  return `${actifs}/${maxDeck}`;
}

function calcPVMax(c) {
  const pvBase = c.pvBase || 10;
  const modCo = getMod(c, 'constitution');
  const niveau = c.niveau || 1;
  if (modCo > 0) return pvBase + Math.floor(modCo * (niveau - 1));
  return pvBase + modCo * (niveau - 1);
}

function calcPMMax(c) {
  const pmBase = c.pmBase || 10;
  const modSa = getMod(c, 'sagesse');
  const niveau = c.niveau || 1;
  if (modSa > 0) return pmBase + Math.floor(modSa * (niveau - 1));
  return pmBase + modSa * (niveau - 1);
}

function recalcDerived(c) {
  c.pvMax = calcPVMax(c);
  c.pmMax = calcPMMax(c);
  c.pvActuel = Math.min(c.pvActuel ?? c.pvMax, c.pvMax);
  c.pmActuel = Math.min(c.pmActuel ?? c.pmMax, c.pmMax);
  c.ca = calcCA(c);
  c.vitesse = calcVitesse(c);
  c.deck = calcDeck(c);
}

function computeEquipBonuses(equipement = {}) {
  const statsBonus = {
    force: 0,
    dexterite: 0,
    intelligence: 0,
    sagesse: 0,
    constitution: 0,
    charisme: 0,
  };

  Object.values(equipement).forEach((item) => {
    statsBonus.force += item?.fo || 0;
    statsBonus.dexterite += item?.dex || 0;
    statsBonus.intelligence += item?.in || 0;
    statsBonus.sagesse += item?.sa || 0;
    statsBonus.constitution += item?.co || 0;
    statsBonus.charisme += item?.ch || 0;
  });

  return statsBonus;
}

function makeEditableField({ label, path, value, type = 'text', muted = false, hint = '', canEdit = false, large = false }) {
  const classes = ['char-inline-field'];
  if (canEdit) classes.push('is-editable');
  if (muted) classes.push('is-muted');
  if (large) classes.push('is-large');
  const raw = value ?? '';
  return `
    <button
      class="${classes.join(' ')}"
      type="button"
      ${canEdit ? '' : 'disabled'}
      data-inline-edit="true"
      data-path="${escapeHtml(path)}"
      data-type="${escapeHtml(type)}"
      data-value="${escapeHtml(Array.isArray(raw) ? raw.join(', ') : raw)}"
    >
      <span class="char-inline-label">${escapeHtml(label)}</span>
      <span class="char-inline-value">${escapeHtml(raw || '—')}</span>
      ${hint ? `<span class="char-inline-hint">${escapeHtml(hint)}</span>` : ''}
    </button>`;
}

function makeStatCard(c, stat, canEdit) {
  const stats = { ...getDefaultStats(), ...(c.stats || {}) };
  const base = stats[stat.key] ?? 8;
  const bonus = (c.statsBonus || {})[stat.key] || 0;
  const total = base + bonus;
  return `
    <button
      class="char-stat-card ${canEdit ? 'is-editable' : ''}"
      type="button"
      ${canEdit ? '' : 'disabled'}
      data-inline-edit="true"
      data-path="stats.${stat.key}"
      data-type="number"
      data-value="${escapeHtml(base)}"
    >
      <span class="char-stat-short">${stat.short}</span>
      <span class="char-stat-name">${escapeHtml(stat.label)}</span>
      <span class="char-stat-value">${escapeHtml(total)}</span>
      <span class="char-stat-mod">${formatMod(Math.floor((total - 10) / 2))}</span>
      <span class="char-stat-meta">Base ${escapeHtml(base)}${bonus ? ` · Bonus ${bonus > 0 ? `+${bonus}` : bonus}` : ''}</span>
    </button>`;
}

function makeMetricCard(label, value, hint = '') {
  return `
    <article class="char-metric-card">
      <span class="char-metric-label">${escapeHtml(label)}</span>
      <strong class="char-metric-value">${escapeHtml(value)}</strong>
      ${hint ? `<small class="char-metric-hint">${escapeHtml(hint)}</small>` : ''}
    </article>`;
}

function makeSlotTags(item) {
  const tags = [];
  if (item.degats) tags.push(`Dégâts ${item.degats}`);
  if (item.typeArme) tags.push(item.typeArme);
  if (item.portee) tags.push(`Portée ${item.portee}`);
  if (item.statAttaque) tags.push(`Stat ${item.statAttaque}`);
  ['fo', 'dex', 'in', 'sa', 'co', 'ch'].forEach((k) => {
    if (item[k]) tags.push(`${k.toUpperCase()} ${item[k] > 0 ? `+${item[k]}` : item[k]}`);
  });
  if (item.ca) tags.push(`CA +${item.ca}`);
  return tags;
}

function renderCharHeader(c, canEdit) {
  const initials = (c.nom || 'PJ')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'PJ';
  const titles = c.titres || [];

  return `
    <section class="char-hero-card">
      <div class="char-hero-main">
        <div class="char-avatar${c.photo ? ' has-photo' : ''}">
          ${c.photo ? `<img src="${escapeHtml(c.photo)}" alt="Portrait de ${escapeHtml(c.nom || 'personnage')}">` : `<span>${escapeHtml(initials)}</span>`}
        </div>

        <div class="char-hero-copy">
          <div class="char-hero-topline">Fiche personnage</div>
          <div class="char-identity-grid">
            ${makeEditableField({ label: 'Nom', path: 'nom', value: c.nom || 'Nouveau personnage', canEdit, large: true })}
            ${makeEditableField({ label: 'Niveau', path: 'niveau', value: c.niveau || 1, type: 'number', canEdit })}
            ${makeEditableField({ label: 'EXP', path: 'exp', value: c.exp || 0, type: 'number', canEdit, hint: `Palier ${c.palier || 100}` })}
            ${makeEditableField({ label: 'Or', path: 'or', value: c.or || 0, type: 'number', canEdit })}
          </div>

          <div class="char-title-row">
            <span class="char-block-label">Titres</span>
            <div class="char-title-list">
              ${titles.length ? titles.map((title, index) => `
                <span class="char-tag">
                  ${escapeHtml(title)}
                  ${canEdit ? `<button type="button" class="char-tag-remove" onclick="removeTitre(${index})">×</button>` : ''}
                </span>`).join('') : `<span class="char-empty-inline">Aucun titre</span>`}
            </div>
            ${canEdit ? `
              <div class="char-inline-add">
                <input id="char-title-input" class="input-field" type="text" placeholder="Ajouter un titre">
                <button class="char-mini-btn" type="button" onclick="addTitre()">Ajouter</button>
              </div>` : ''}
          </div>
        </div>
      </div>

      <div class="char-hero-side">
        <div class="char-side-card">
          <span>Joueur</span>
          <strong>${escapeHtml(c.ownerPseudo || STATE.profile?.pseudo || '—')}</strong>
          <small>${STATE.isAdmin ? 'Vue admin active' : 'Compte joueur'}</small>
        </div>
        <div class="char-side-card">
          <span>Rôle</span>
          <strong>${STATE.isAdmin ? 'MJ / Admin' : 'Joueur'}</strong>
          <small>Clique sur une valeur pour modifier</small>
        </div>
        ${canEdit ? `
          <button class="char-danger-btn" type="button" onclick="deleteChar('${escapeHtml(c.id)}')">Supprimer ce personnage</button>` : ''}
      </div>
    </section>`;
}

function renderVitals(c, canEdit) {
  const pvMax = c.pvMax || calcPVMax(c);
  const pmMax = c.pmMax || calcPMMax(c);
  const pvNow = c.pvActuel ?? pvMax;
  const pmNow = c.pmActuel ?? pmMax;

  return `
    <section class="char-panel-card">
      <div class="char-panel-head">
        <div>
          <span class="char-panel-kicker">Ressources</span>
          <h3>État du personnage</h3>
        </div>
      </div>

      <div class="char-vital-grid">
        <article class="char-vital-card is-health">
          <span class="char-vital-label">PV actuels</span>
          <div class="char-vital-controls">
            ${canEdit ? `<button type="button" class="char-stepper-btn minus" onclick="adjustStat('pvActuel', -1, '${escapeHtml(c.id)}')">−</button>` : ''}
            <button
              class="char-vital-value ${canEdit ? 'is-editable' : ''}"
              type="button"
              ${canEdit ? '' : 'disabled'}
              data-inline-edit="true"
              data-path="pvActuel"
              data-type="number"
              data-value="${escapeHtml(pvNow)}"
            >${escapeHtml(pvNow)}</button>
            ${canEdit ? `<button type="button" class="char-stepper-btn plus" onclick="adjustStat('pvActuel', 1, '${escapeHtml(c.id)}')">+</button>` : ''}
          </div>
          <small>Max ${escapeHtml(pvMax)}</small>
        </article>

        <article class="char-vital-card is-mana">
          <span class="char-vital-label">PM actuels</span>
          <div class="char-vital-controls">
            ${canEdit ? `<button type="button" class="char-stepper-btn minus" onclick="adjustStat('pmActuel', -1, '${escapeHtml(c.id)}')">−</button>` : ''}
            <button
              class="char-vital-value ${canEdit ? 'is-editable' : ''}"
              type="button"
              ${canEdit ? '' : 'disabled'}
              data-inline-edit="true"
              data-path="pmActuel"
              data-type="number"
              data-value="${escapeHtml(pmNow)}"
            >${escapeHtml(pmNow)}</button>
            ${canEdit ? `<button type="button" class="char-stepper-btn plus" onclick="adjustStat('pmActuel', 1, '${escapeHtml(c.id)}')">+</button>` : ''}
          </div>
          <small>Max ${escapeHtml(pmMax)}</small>
        </article>

        ${makeMetricCard('PV de base', c.pvBase || 10, canEdit ? 'Cliquer pour modifier' : '')
          .replace('<article class="char-metric-card">', `<button class="char-metric-card ${canEdit ? 'is-editable' : ''}" type="button" ${canEdit ? '' : 'disabled'} data-inline-edit="true" data-path="pvBase" data-type="number" data-value="${escapeHtml(c.pvBase || 10)}">`)
          .replace('</article>', '</button>')}
        ${makeMetricCard('PM de base', c.pmBase || 10, canEdit ? 'Cliquer pour modifier' : '')
          .replace('<article class="char-metric-card">', `<button class="char-metric-card ${canEdit ? 'is-editable' : ''}" type="button" ${canEdit ? '' : 'disabled'} data-inline-edit="true" data-path="pmBase" data-type="number" data-value="${escapeHtml(c.pmBase || 10)}">`)
          .replace('</article>', '</button>')}
      </div>
    </section>`;
}

function renderCharCarac(c, canEdit) {
  return `
    <div class="char-overview-grid">
      ${renderVitals(c, canEdit)}

      <section class="char-panel-card">
        <div class="char-panel-head">
          <div>
            <span class="char-panel-kicker">Caractéristiques</span>
            <h3>Stats principales</h3>
          </div>
          <p>Clique sur une carte pour modifier la valeur de base.</p>
        </div>
        <div class="char-stat-grid">
          ${STATS.map((stat) => makeStatCard(c, stat, canEdit)).join('')}
        </div>
      </section>

      <section class="char-panel-card">
        <div class="char-panel-head">
          <div>
            <span class="char-panel-kicker">Synthèse</span>
            <h3>Valeurs calculées</h3>
          </div>
        </div>
        <div class="char-metric-grid">
          ${makeMetricCard('CA', calcCA(c), 'Armure + DEX')}
          ${makeMetricCard('Vitesse', `${calcVitesse(c)} m`, '3 + mod. Force')}
          ${makeMetricCard('Deck', calcDeck(c), 'Sorts actifs / capacité')}
          ${makeMetricCard('Bonus équipement', Object.values(c.statsBonus || {}).some(Boolean)
            ? Object.entries(c.statsBonus || {}).filter(([, val]) => val).map(([key, val]) => `${key.slice(0, 3).toUpperCase()} ${val > 0 ? `+${val}` : val}`).join(' · ')
            : 'Aucun', 'Appliqué automatiquement')}
        </div>
      </section>
    </div>`;
}

function renderCharEquip(c, canEdit) {
  const equip = c.equipement || {};
  return `
    <div class="char-tab-layout">
      <section class="char-panel-card">
        <div class="char-panel-head">
          <div>
            <span class="char-panel-kicker">Combat</span>
            <h3>Armes</h3>
          </div>
        </div>
        <div class="char-slot-grid">
          ${WEAPON_SLOTS.map((slot) => {
            const item = equip[slot] || {};
            const tags = makeSlotTags(item);
            return `
              <article class="char-slot-card">
                <div class="char-slot-head">
                  <div>
                    <span class="char-slot-label">${escapeHtml(slot)}</span>
                    <h4>${escapeHtml(item.nom || 'Non configuré')}</h4>
                  </div>
                  ${canEdit ? `<button class="char-mini-btn" type="button" onclick="editEquipSlot('${escapeHtml(slot)}')">${item.nom ? 'Modifier' : 'Configurer'}</button>` : ''}
                </div>
                <p>${escapeHtml(item.trait || 'Aucune information complémentaire.')}</p>
                <div class="char-chip-row">
                  ${tags.length ? tags.map((tag) => `<span class="char-chip">${escapeHtml(tag)}</span>`).join('') : `<span class="char-empty-inline">Aucune donnée</span>`}
                </div>
              </article>`;
          }).join('')}
        </div>
      </section>

      <section class="char-panel-card">
        <div class="char-panel-head">
          <div>
            <span class="char-panel-kicker">Équipement</span>
            <h3>Armures et accessoires</h3>
          </div>
        </div>
        <div class="char-slot-grid">
          ${ARMOR_SLOTS.map((slot) => {
            const item = equip[slot] || {};
            const tags = makeSlotTags(item);
            return `
              <article class="char-slot-card">
                <div class="char-slot-head">
                  <div>
                    <span class="char-slot-label">${escapeHtml(slot)}</span>
                    <h4>${escapeHtml(item.nom || 'Vide')}</h4>
                  </div>
                  ${canEdit ? `<button class="char-mini-btn" type="button" onclick="editEquipSlot('${escapeHtml(slot)}')">${item.nom ? 'Modifier' : 'Ajouter'}</button>` : ''}
                </div>
                <p>${escapeHtml(item.trait || 'Aucun bonus renseigné.')}</p>
                <div class="char-chip-row">
                  ${tags.length ? tags.map((tag) => `<span class="char-chip">${escapeHtml(tag)}</span>`).join('') : `<span class="char-empty-inline">Aucun bonus</span>`}
                </div>
              </article>`;
          }).join('')}
        </div>
      </section>
    </div>`;
}

function renderCharDeck(c, canEdit) {
  const sorts = c.deck_sorts || [];
  return `
    <section class="char-panel-card">
      <div class="char-panel-head">
        <div>
          <span class="char-panel-kicker">Magie</span>
          <h3>Sorts et compétences</h3>
        </div>
        ${canEdit ? `<button class="char-primary-btn" type="button" onclick="addSort()">Ajouter un sort</button>` : ''}
      </div>
      <div class="char-list-stack">
        ${sorts.length ? sorts.map((sort, index) => `
          <article class="char-list-card">
            <div class="char-list-main">
              <div>
                <h4>${escapeHtml(sort.nom || 'Sort sans nom')}</h4>
                <p>${escapeHtml(sort.effet || 'Aucun descriptif.')}</p>
              </div>
              <div class="char-chip-row">
                ${sort.noyau ? `<span class="char-chip">${escapeHtml(sort.noyau)}</span>` : ''}
                ${(sort.runes || []).map((rune) => `<span class="char-chip">${escapeHtml(rune)}</span>`).join('')}
                <span class="char-chip">${escapeHtml(sort.pm || 0)} PM</span>
                ${sort.degats ? `<span class="char-chip">${escapeHtml(sort.degats)}</span>` : ''}
                ${sort.soin ? `<span class="char-chip">Soin ${escapeHtml(sort.soin)}</span>` : ''}
              </div>
            </div>
            <div class="char-list-actions">
              <button class="char-toggle ${sort.actif ? 'is-on' : ''}" type="button" onclick="toggleSort(${index})">${sort.actif ? 'Actif' : 'Inactif'}</button>
              ${canEdit ? `<button class="char-mini-btn" type="button" onclick="editSort(${index})">Modifier</button>` : ''}
              ${canEdit ? `<button class="char-ghost-btn danger" type="button" onclick="deleteSort(${index})">Supprimer</button>` : ''}
            </div>
          </article>`).join('') : `<div class="char-empty-state">Aucun sort enregistré pour ce personnage.</div>`}
      </div>
    </section>`;
}

function renderCharInventaire(c, canEdit) {
  const inventaire = c.inventaire || [];
  return `
    <section class="char-panel-card">
      <div class="char-panel-head">
        <div>
          <span class="char-panel-kicker">Objets</span>
          <h3>Inventaire</h3>
        </div>
        ${canEdit ? `<button class="char-primary-btn" type="button" onclick="addInvItem()">Ajouter un objet</button>` : ''}
      </div>
      <div class="char-table-wrap">
        ${inventaire.length ? `
          <table class="char-table">
            <thead>
              <tr>
                <th>Objet</th>
                <th>Type</th>
                <th>Qté</th>
                <th>Description</th>
                ${canEdit ? '<th></th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${inventaire.map((item, index) => `
                <tr>
                  <td>${escapeHtml(item.nom || '—')}</td>
                  <td>${escapeHtml(item.type || '—')}</td>
                  <td>${escapeHtml(item.qte || '1')}</td>
                  <td>${escapeHtml(item.description || '—')}</td>
                  ${canEdit ? `<td class="char-table-actions"><button class="char-mini-btn" type="button" onclick="editInvItem(${index})">Modifier</button><button class="char-ghost-btn danger" type="button" onclick="deleteInvItem(${index})">Supprimer</button></td>` : ''}
                </tr>`).join('')}
            </tbody>
          </table>` : `<div class="char-empty-state">Inventaire vide.</div>`}
      </div>
    </section>`;
}

function renderCharQuetes(c, canEdit) {
  const quetes = c.quetes || [];
  return `
    <section class="char-panel-card">
      <div class="char-panel-head">
        <div>
          <span class="char-panel-kicker">Suivi</span>
          <h3>Quêtes</h3>
        </div>
        ${canEdit ? `<button class="char-primary-btn" type="button" onclick="addQuete()">Ajouter une quête</button>` : ''}
      </div>
      <div class="char-list-stack">
        ${quetes.length ? quetes.map((quete, index) => `
          <article class="char-list-card">
            <div class="char-list-main">
              <div>
                <h4>${escapeHtml(quete.nom || 'Quête')}</h4>
                <p>${escapeHtml(quete.description || 'Aucun descriptif.')}</p>
              </div>
              <div class="char-chip-row">
                ${quete.type ? `<span class="char-chip">${escapeHtml(quete.type)}</span>` : ''}
                <span class="char-chip ${quete.valide ? 'is-success' : ''}">${quete.valide ? 'Terminée' : 'En cours'}</span>
              </div>
            </div>
            <div class="char-list-actions">
              <button class="char-toggle ${quete.valide ? 'is-on' : ''}" type="button" onclick="toggleQuete(${index})">${quete.valide ? 'Validée' : 'Valider'}</button>
              ${canEdit ? `<button class="char-mini-btn" type="button" onclick="editQuete(${index})">Modifier</button>` : ''}
              ${canEdit ? `<button class="char-ghost-btn danger" type="button" onclick="deleteQuete(${index})">Supprimer</button>` : ''}
            </div>
          </article>`).join('') : `<div class="char-empty-state">Aucune quête enregistrée.</div>`}
      </div>
    </section>`;
}

function renderCharNotes(c, canEdit) {
  return `
    <section class="char-panel-card">
      <div class="char-panel-head">
        <div>
          <span class="char-panel-kicker">Libre</span>
          <h3>Notes</h3>
        </div>
      </div>
      <div class="char-notes-wrap">
        <textarea id="char-notes-area" class="input-field char-notes-area" ${canEdit ? '' : 'readonly'} placeholder="Notes de session, rappels, idées...">${escapeHtml(c.notes || '')}</textarea>
        ${canEdit ? `<div class="char-notes-actions"><button class="char-primary-btn" type="button" onclick="saveNotes()">Sauvegarder les notes</button></div>` : ''}
      </div>
    </section>`;
}

function renderTabContent(c, canEdit, tab) {
  switch (normaliseTab(tab)) {
    case 'equip':
      return renderCharEquip(c, canEdit);
    case 'deck':
      return renderCharDeck(c, canEdit);
    case 'inventaire':
      return renderCharInventaire(c, canEdit);
    case 'quetes':
      return renderCharQuetes(c, canEdit);
    case 'notes':
      return renderCharNotes(c, canEdit);
    case 'carac':
    default:
      return renderCharCarac(c, canEdit);
  }
}

function renderCharSheet(c, keepTab) {
  const area = document.getElementById('char-sheet-area');
  if (!area || !c) return;

  recalcDerived(c);
  const canEdit = canEditChar(c);
  const currentTab = normaliseTab(keepTab || window._currentCharTab || 'carac');
  window._currentChar = c;
  window._canEditChar = canEdit;
  window._currentCharTab = currentTab;

  area.innerHTML = `
    <div class="char-sheet-shell">
      ${renderCharHeader(c, canEdit)}

      <div class="char-tabbar" id="char-tabs">
        ${Object.entries(TAB_LABELS).map(([key, label]) => `
          <button class="char-tab ${key === currentTab ? 'active' : ''}" type="button" onclick="showCharTab('${key}', this)">${escapeHtml(label)}</button>`).join('')}
      </div>

      <div class="char-tab-panel" id="char-tab-content">
        ${renderTabContent(c, canEdit, currentTab)}
      </div>
    </div>`;

  bindCharSheetInteractions();
}

function showCharTab(tab, el) {
  document.querySelectorAll('#char-tabs .char-tab').forEach((button) => button.classList.remove('active'));
  if (el) el.classList.add('active');
  window._currentCharTab = normaliseTab(tab);
  const c = getCurrentChar();
  if (!c) return;
  const content = document.getElementById('char-tab-content');
  if (!content) return;
  content.innerHTML = renderTabContent(c, canEditChar(c), window._currentCharTab);
  bindCharSheetInteractions();
}

function bindCharSheetInteractions() {
  const area = document.getElementById('char-sheet-area');
  if (!area || area.dataset.bound === '1') return;
  area.dataset.bound = '1';

  area.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-inline-edit="true"]');
    if (!trigger || !window._canEditChar) return;
    event.preventDefault();
    startInlineEdit(trigger);
  });
}

function startInlineEdit(trigger) {
  if (!trigger || trigger.dataset.editing === '1') return;
  trigger.dataset.editing = '1';

  const valueNode = trigger.querySelector('.char-inline-value, .char-stat-value, .char-vital-value, .char-metric-value');
  if (!valueNode) {
    trigger.dataset.editing = '0';
    return;
  }

  const type = trigger.dataset.type || 'text';
  const input = document.createElement('input');
  input.type = type === 'number' ? 'number' : 'text';
  input.className = 'char-inline-input';
  input.value = trigger.dataset.value || '';
  input.autocomplete = 'off';

  valueNode.replaceWith(input);
  input.focus();
  input.select();

  let handled = false;
  const finish = async (shouldSave) => {
    if (handled) return;
    handled = true;
    trigger.dataset.editing = '0';
    if (!shouldSave) {
      const c = getCurrentChar();
      if (c) renderCharSheet(c, window._currentCharTab);
      return;
    }
    await updateCharField(trigger.dataset.path, input.value, type);
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    }
  });

  input.addEventListener('blur', () => finish(true), { once: true });
}

async function updateCharField(path, rawValue, type = 'text') {
  const c = getCurrentChar();
  if (!c || !path) return;

  const updates = {};
  let value = rawValue;
  if (type === 'number') {
    const parsed = parseInt(rawValue, 10);
    value = Number.isFinite(parsed) ? parsed : 0;
  } else {
    value = String(rawValue || '').trim();
  }

  if (path.startsWith('stats.')) {
    const statKey = path.split('.')[1];
    c.stats = { ...getDefaultStats(), ...(c.stats || {}) };
    c.stats[statKey] = Math.max(1, value);
    recalcDerived(c);
    updates.stats = c.stats;
    updates.pvMax = c.pvMax;
    updates.pmMax = c.pmMax;
    updates.pvActuel = c.pvActuel;
    updates.pmActuel = c.pmActuel;
    updates.ca = c.ca;
  } else {
    const numericFields = new Set(['niveau', 'exp', 'or', 'pvBase', 'pmBase', 'pvActuel', 'pmActuel']);
    if (numericFields.has(path)) value = Math.max(0, value);
    setPathValue(c, path, value);
    recalcDerived(c);
    updates[path] = value;
    if (['niveau', 'pvBase', 'pmBase', 'pvActuel', 'pmActuel'].includes(path)) {
      updates.pvMax = c.pvMax;
      updates.pmMax = c.pmMax;
      updates.pvActuel = c.pvActuel;
      updates.pmActuel = c.pmActuel;
      updates.ca = c.ca;
    }
  }

  await updateInCol('characters', c.id, updates);
  if (path === 'nom') syncActiveCharLabel(c.id, c.nom || 'Nouveau personnage');
  renderCharSheet(c, window._currentCharTab);
}

function syncActiveCharLabel(id, label) {
  document.querySelectorAll('#char-pills [data-char-id]').forEach((node) => {
    if (node.dataset.charId === id) {
      const title = node.querySelector('.char-rail-card__title');
      if (title) title.textContent = label;
    }
  });
}

function selectChar(id, el) {
  document.querySelectorAll('#char-pills .char-pill, #char-pills .char-rail-card').forEach((item) => item.classList.remove('active'));
  el?.classList.add('active');
  const found = STATE.characters.find((char) => char.id === id);
  if (!found) return;
  STATE.activeChar = found;
  renderCharSheet(found, window._currentCharTab || 'carac');
}

function filterAdminChars(pseudo, el) {
  document.querySelectorAll('#admin-player-filter .char-filter-pill').forEach((item) => item.classList.remove('active'));
  el?.classList.add('active');
  const chars = pseudo ? STATE.characters.filter((char) => char.ownerPseudo === pseudo) : STATE.characters;
  const pills = document.getElementById('char-pills');
  if (!pills) return;

  pills.innerHTML = chars.map((char, index) => `
    <button class="char-rail-card ${index === 0 ? 'active' : ''}" type="button" data-char-id="${escapeHtml(char.id)}" onclick="selectChar('${escapeHtml(char.id)}', this)">
      <span class="char-rail-card__title">${escapeHtml(char.nom || 'Nouveau personnage')}</span>
      <span class="char-rail-card__meta">Niv. ${escapeHtml(char.niveau || 1)} · ${escapeHtml(char.ownerPseudo || '—')}</span>
    </button>`).join('');

  if (chars.length) {
    STATE.activeChar = chars[0];
    renderCharSheet(chars[0], window._currentCharTab || 'carac');
  } else {
    pills.innerHTML = '<div class="char-empty-state">Aucun personnage pour ce filtre.</div>';
    const area = document.getElementById('char-sheet-area');
    if (area) area.innerHTML = '';
  }
}

async function adjustStat(stat, delta, charId) {
  const c = STATE.characters.find((char) => char.id === charId) || getCurrentChar();
  if (!c) return;
  recalcDerived(c);
  const maxKey = stat === 'pvActuel' ? 'pvMax' : 'pmMax';
  const max = c[maxKey] || (stat === 'pvActuel' ? calcPVMax(c) : calcPMMax(c));
  const current = c[stat] ?? max;
  c[stat] = Math.max(0, Math.min(max, current + delta));
  await updateInCol('characters', c.id, { [stat]: c[stat] });
  renderCharSheet(c, window._currentCharTab);
}

async function saveNotes() {
  const c = getCurrentChar();
  if (!c) return;
  const notes = document.getElementById('char-notes-area')?.value || '';
  c.notes = notes;
  await updateInCol('characters', c.id, { notes });
  showNotif('Notes sauvegardées.', 'success');
}

async function toggleSort(index) {
  const c = getCurrentChar();
  if (!c) return;
  const sorts = [...(c.deck_sorts || [])];
  if (!sorts[index]) return;
  sorts[index].actif = !sorts[index].actif;
  c.deck_sorts = sorts;
  await updateInCol('characters', c.id, { deck_sorts: sorts });
  renderCharSheet(c, 'deck');
}

async function deleteSort(index) {
  const c = getCurrentChar();
  if (!c) return;
  const sorts = [...(c.deck_sorts || [])];
  sorts.splice(index, 1);
  c.deck_sorts = sorts;
  await updateInCol('characters', c.id, { deck_sorts: sorts });
  renderCharSheet(c, 'deck');
}

async function toggleQuete(index) {
  const c = getCurrentChar();
  if (!c) return;
  const quetes = [...(c.quetes || [])];
  if (!quetes[index]) return;
  quetes[index].valide = !quetes[index].valide;
  c.quetes = quetes;
  await updateInCol('characters', c.id, { quetes });
  renderCharSheet(c, 'quetes');
}

async function deleteQuete(index) {
  const c = getCurrentChar();
  if (!c) return;
  const quetes = [...(c.quetes || [])];
  quetes.splice(index, 1);
  c.quetes = quetes;
  await updateInCol('characters', c.id, { quetes });
  renderCharSheet(c, 'quetes');
}

async function deleteInvItem(index) {
  const c = getCurrentChar();
  if (!c) return;
  const inventaire = [...(c.inventaire || [])];
  inventaire.splice(index, 1);
  c.inventaire = inventaire;
  await updateInCol('characters', c.id, { inventaire });
  renderCharSheet(c, 'inventaire');
}

async function deleteChar(id) {
  if (!confirm('Supprimer ce personnage ?')) return;
  await deleteFromCol('characters', id);
  showNotif('Personnage supprimé.', 'success');
  PAGES.characters();
}

async function createNewChar() {
  const data = {
    uid: STATE.user?.uid,
    ownerPseudo: STATE.profile?.pseudo || '?',
    nom: 'Nouveau personnage',
    titre: '',
    titres: [],
    niveau: 1,
    or: 0,
    pvBase: 10,
    pvActuel: 10,
    pmBase: 10,
    pmActuel: 10,
    pvMax: 10,
    pmMax: 10,
    ca: 8,
    vitesse: 3,
    exp: 0,
    palier: 100,
    stats: getDefaultStats(),
    statsBonus: {},
    equipement: {},
    inventaire: [],
    deck_sorts: [],
    quetes: [],
    notes: '',
  };
  await addToCol('characters', data);
  showNotif('Personnage créé.', 'success');
  PAGES.characters();
}

function addTitre() {
  const c = getCurrentChar();
  if (!c) return;
  const input = document.getElementById('char-title-input');
  const value = input?.value.trim();
  if (!value) return;
  const titres = [...(c.titres || []), value];
  updateInCol('characters', c.id, { titres }).then(() => {
    c.titres = titres;
    if (input) input.value = '';
    renderCharSheet(c, window._currentCharTab);
  });
}

function removeTitre(index) {
  const c = getCurrentChar();
  if (!c) return;
  const titres = [...(c.titres || [])];
  titres.splice(index, 1);
  updateInCol('characters', c.id, { titres }).then(() => {
    c.titres = titres;
    renderCharSheet(c, window._currentCharTab);
  });
}

function editCharInfo() {}
function cancelEditChar() {}
async function saveCharInfo() {}
function editCharStats() {}
async function saveCharStats() {}
async function saveCharCombat() {}
function toggleRune() {}
function updateSortPM() {}

function addSort() {
  openSortModal(-1, {});
}

function editSort(index) {
  const c = getCurrentChar();
  const sort = (c?.deck_sorts || [])[index] || {};
  openSortModal(index, sort);
}

function openSortModal(index, sort = {}) {
  openModal(index >= 0 ? 'Modifier le sort' : 'Nouveau sort', `
    <div class="form-grid">
      <div class="form-group">
        <label>Nom</label>
        <input id="sort-nom" class="input-field" type="text" value="${escapeHtml(sort.nom || '')}">
      </div>
      <div class="form-group">
        <label>Noyau</label>
        <select id="sort-noyau" class="input-field">
          <option value="">—</option>
          ${NOYAUX.map((noyau) => `<option value="${escapeHtml(noyau)}" ${sort.noyau === noyau ? 'selected' : ''}>${escapeHtml(noyau)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Runes</label>
        <input id="sort-runes" class="input-field" type="text" value="${escapeHtml((sort.runes || []).join(', '))}" placeholder="Puissance, Zone, Bouclier...">
      </div>
      <div class="form-group">
        <label>Coût PM</label>
        <input id="sort-pm" class="input-field" type="number" value="${escapeHtml(sort.pm || 2)}">
      </div>
      <div class="form-group">
        <label>Dégâts</label>
        <input id="sort-degats" class="input-field" type="text" value="${escapeHtml(sort.degats || '')}" placeholder="1d8 + mod.">
      </div>
      <div class="form-group">
        <label>Soin</label>
        <input id="sort-soin" class="input-field" type="text" value="${escapeHtml(sort.soin || '')}" placeholder="1d4">
      </div>
      <div class="form-group full-span">
        <label>Description / effet</label>
        <textarea id="sort-effet" class="input-field" rows="5">${escapeHtml(sort.effet || '')}</textarea>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-gold" onclick="saveSort(${index})">Enregistrer</button>
    </div>`);
}

async function saveSort(index) {
  const c = getCurrentChar();
  if (!c) return;
  const sorts = [...(c.deck_sorts || [])];
  const newSort = {
    nom: document.getElementById('sort-nom')?.value.trim() || 'Sort',
    noyau: document.getElementById('sort-noyau')?.value || '',
    runes: (document.getElementById('sort-runes')?.value || '').split(',').map((value) => value.trim()).filter(Boolean),
    pm: parseInt(document.getElementById('sort-pm')?.value, 10) || 2,
    degats: document.getElementById('sort-degats')?.value.trim() || '',
    soin: document.getElementById('sort-soin')?.value.trim() || '',
    effet: document.getElementById('sort-effet')?.value.trim() || '',
    actif: index >= 0 ? Boolean(sorts[index]?.actif) : false,
  };
  if (index >= 0) sorts[index] = newSort;
  else sorts.push(newSort);
  c.deck_sorts = sorts;
  await updateInCol('characters', c.id, { deck_sorts: sorts });
  closeModal();
  renderCharSheet(c, 'deck');
}

function editEquipSlot(slot) {
  const c = getCurrentChar();
  if (!c) return;
  const item = (c.equipement || {})[slot] || {};
  const isWeapon = WEAPON_SLOTS.includes(slot);
  openModal(`Équipement — ${slot}`, `
    <div class="form-grid">
      <div class="form-group">
        <label>Nom</label>
        <input id="eq-nom" class="input-field" type="text" value="${escapeHtml(item.nom || '')}">
      </div>
      <div class="form-group">
        <label>Trait</label>
        <input id="eq-trait" class="input-field" type="text" value="${escapeHtml(item.trait || '')}">
      </div>
      ${isWeapon ? `
        <div class="form-group">
          <label>Dégâts</label>
          <input id="eq-degats" class="input-field" type="text" value="${escapeHtml(item.degats || '')}">
        </div>
        <div class="form-group">
          <label>Stat d’attaque</label>
          <select id="eq-stat-attaque" class="input-field">
            ${['force', 'dexterite', 'intelligence'].map((stat) => `<option value="${stat}" ${item.statAttaque === stat ? 'selected' : ''}>${stat}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Type</label>
          <input id="eq-type-arme" class="input-field" type="text" value="${escapeHtml(item.typeArme || '')}">
        </div>
        <div class="form-group">
          <label>Portée</label>
          <input id="eq-portee" class="input-field" type="text" value="${escapeHtml(item.portee || '')}">
        </div>
        <div class="form-group full-span">
          <label>Particularité</label>
          <textarea id="eq-particularite" class="input-field" rows="4">${escapeHtml(item.particularite || '')}</textarea>
        </div>` : `
        ${[['fo', 'Force'], ['dex', 'Dex'], ['in', 'Int'], ['sa', 'Sag'], ['co', 'Con'], ['ch', 'Cha'], ['ca', 'CA']].map(([key, label]) => `
          <div class="form-group">
            <label>${label}</label>
            <input id="eq-${key}" class="input-field" type="number" value="${escapeHtml(item[key] || 0)}">
          </div>`).join('')}`}
    </div>
    <div class="modal-actions">
      <button class="btn btn-gold" onclick="saveEquipSlot('${escapeHtml(slot)}')">Enregistrer</button>
      <button class="btn btn-secondary" onclick="clearEquipSlot('${escapeHtml(slot)}')">Retirer</button>
    </div>`);
}

async function saveEquipSlot(slot) {
  const c = getCurrentChar();
  if (!c) return;
  const equipement = { ...(c.equipement || {}) };
  const isWeapon = WEAPON_SLOTS.includes(slot);

  if (isWeapon) {
    equipement[slot] = {
      nom: document.getElementById('eq-nom')?.value.trim() || '',
      trait: document.getElementById('eq-trait')?.value.trim() || '',
      degats: document.getElementById('eq-degats')?.value.trim() || '',
      statAttaque: document.getElementById('eq-stat-attaque')?.value || 'force',
      typeArme: document.getElementById('eq-type-arme')?.value.trim() || '',
      portee: document.getElementById('eq-portee')?.value.trim() || '',
      particularite: document.getElementById('eq-particularite')?.value.trim() || '',
    };
  } else {
    equipement[slot] = {
      nom: document.getElementById('eq-nom')?.value.trim() || '',
      trait: document.getElementById('eq-trait')?.value.trim() || '',
      fo: parseInt(document.getElementById('eq-fo')?.value, 10) || 0,
      dex: parseInt(document.getElementById('eq-dex')?.value, 10) || 0,
      in: parseInt(document.getElementById('eq-in')?.value, 10) || 0,
      sa: parseInt(document.getElementById('eq-sa')?.value, 10) || 0,
      co: parseInt(document.getElementById('eq-co')?.value, 10) || 0,
      ch: parseInt(document.getElementById('eq-ch')?.value, 10) || 0,
      ca: parseInt(document.getElementById('eq-ca')?.value, 10) || 0,
    };
  }

  c.equipement = equipement;
  c.statsBonus = computeEquipBonuses(equipement);
  recalcDerived(c);
  await updateInCol('characters', c.id, {
    equipement,
    statsBonus: c.statsBonus,
    ca: c.ca,
    pvMax: c.pvMax,
    pmMax: c.pmMax,
    pvActuel: c.pvActuel,
    pmActuel: c.pmActuel,
  });
  closeModal();
  renderCharSheet(c, 'equip');
}

async function clearEquipSlot(slot) {
  const c = getCurrentChar();
  if (!c) return;
  const equipement = { ...(c.equipement || {}) };
  delete equipement[slot];
  c.equipement = equipement;
  c.statsBonus = computeEquipBonuses(equipement);
  recalcDerived(c);
  await updateInCol('characters', c.id, {
    equipement,
    statsBonus: c.statsBonus,
    ca: c.ca,
    pvMax: c.pvMax,
    pmMax: c.pmMax,
    pvActuel: c.pvActuel,
    pmActuel: c.pmActuel,
  });
  closeModal();
  renderCharSheet(c, 'equip');
}

function addInvItem() {
  openModal('Ajouter un objet', `
    <div class="form-grid">
      <div class="form-group"><label>Nom</label><input id="inv-nom" class="input-field" type="text"></div>
      <div class="form-group"><label>Type</label><input id="inv-type" class="input-field" type="text"></div>
      <div class="form-group"><label>Quantité</label><input id="inv-qte" class="input-field" type="number" value="1"></div>
      <div class="form-group full-span"><label>Description</label><textarea id="inv-desc" class="input-field" rows="4"></textarea></div>
    </div>
    <div class="modal-actions"><button class="btn btn-gold" onclick="saveInvItem(-1)">Ajouter</button></div>`);
}

function editInvItem(index) {
  const c = getCurrentChar();
  if (!c) return;
  const item = (c.inventaire || [])[index] || {};
  openModal('Modifier l’objet', `
    <div class="form-grid">
      <div class="form-group"><label>Nom</label><input id="inv-nom" class="input-field" type="text" value="${escapeHtml(item.nom || '')}"></div>
      <div class="form-group"><label>Type</label><input id="inv-type" class="input-field" type="text" value="${escapeHtml(item.type || '')}"></div>
      <div class="form-group"><label>Quantité</label><input id="inv-qte" class="input-field" type="number" value="${escapeHtml(item.qte || 1)}"></div>
      <div class="form-group full-span"><label>Description</label><textarea id="inv-desc" class="input-field" rows="4">${escapeHtml(item.description || '')}</textarea></div>
    </div>
    <div class="modal-actions"><button class="btn btn-gold" onclick="saveInvItem(${index})">Enregistrer</button></div>`);
}

async function saveInvItem(index) {
  const c = getCurrentChar();
  if (!c) return;
  const inventaire = [...(c.inventaire || [])];
  const newItem = {
    nom: document.getElementById('inv-nom')?.value.trim() || '?',
    type: document.getElementById('inv-type')?.value.trim() || '',
    qte: parseInt(document.getElementById('inv-qte')?.value, 10) || 1,
    description: document.getElementById('inv-desc')?.value.trim() || '',
  };
  if (index >= 0) inventaire[index] = newItem;
  else inventaire.push(newItem);
  c.inventaire = inventaire;
  await updateInCol('characters', c.id, { inventaire });
  closeModal();
  renderCharSheet(c, 'inventaire');
}

function addQuete() {
  openModal('Ajouter une quête', `
    <div class="form-grid">
      <div class="form-group"><label>Nom</label><input id="q-nom" class="input-field" type="text"></div>
      <div class="form-group"><label>Type</label><input id="q-type" class="input-field" type="text"></div>
      <div class="form-group full-span"><label>Description</label><textarea id="q-desc" class="input-field" rows="4"></textarea></div>
    </div>
    <div class="modal-actions"><button class="btn btn-gold" onclick="saveQuete(-1)">Ajouter</button></div>`);
}

function editQuete(index) {
  const c = getCurrentChar();
  if (!c) return;
  const quete = (c.quetes || [])[index] || {};
  openModal('Modifier la quête', `
    <div class="form-grid">
      <div class="form-group"><label>Nom</label><input id="q-nom" class="input-field" type="text" value="${escapeHtml(quete.nom || '')}"></div>
      <div class="form-group"><label>Type</label><input id="q-type" class="input-field" type="text" value="${escapeHtml(quete.type || '')}"></div>
      <div class="form-group full-span"><label>Description</label><textarea id="q-desc" class="input-field" rows="4">${escapeHtml(quete.description || '')}</textarea></div>
    </div>
    <div class="modal-actions"><button class="btn btn-gold" onclick="saveQuete(${index})">Enregistrer</button></div>`);
}

async function saveQuete(index) {
  const c = getCurrentChar();
  if (!c) return;
  const quetes = [...(c.quetes || [])];
  const newQuete = {
    nom: document.getElementById('q-nom')?.value.trim() || 'Quête',
    type: document.getElementById('q-type')?.value.trim() || '',
    description: document.getElementById('q-desc')?.value.trim() || '',
    valide: index >= 0 ? Boolean(quetes[index]?.valide) : false,
  };
  if (index >= 0) quetes[index] = newQuete;
  else quetes.push(newQuete);
  c.quetes = quetes;
  await updateInCol('characters', c.id, { quetes });
  closeModal();
  renderCharSheet(c, 'quetes');
}

const renderCharCombat = renderCharEquip;

Object.assign(window, {
  selectChar,
  filterAdminChars,
  getMod,
  calcCA,
  calcVitesse,
  calcDeck,
  calcPVMax,
  calcPMMax,
  renderCharSheet,
  showCharTab,
  renderCharCarac,
  renderCharCombat,
  renderCharDeck,
  renderCharEquip,
  renderCharInventaire,
  renderCharQuetes,
  renderCharNotes,
  adjustStat,
  saveNotes,
  toggleSort,
  toggleQuete,
  deleteQuete,
  deleteSort,
  deleteInvItem,
  deleteChar,
  createNewChar,
  editCharInfo,
  cancelEditChar,
  addTitre,
  removeTitre,
  saveCharInfo,
  editCharStats,
  saveCharStats,
  saveCharCombat,
  addSort,
  editSort,
  openSortModal,
  toggleRune,
  updateSortPM,
  saveSort,
  editEquipSlot,
  saveEquipSlot,
  clearEquipSlot,
  addInvItem,
  editInvItem,
  saveInvItem,
  addQuete,
  editQuete,
  saveQuete,
});
