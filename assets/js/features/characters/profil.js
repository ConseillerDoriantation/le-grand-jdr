// ══════════════════════════════════════════════════════════════════════════════
// CHARACTERS / PROFIL.JS — Onglet « Profil » (lecture éditoriale + radar +
// identité + citation + traits + biographie + visibilité joueurs)
//
// Extrait de characters.js. Re-render via le seam charSession.renderTab('profil', …)
// (équivalent à _renderTabV3('profil', …) — 'profil' ∈ V3_TABS).
//
// Le cache de présence (bio rich-text, image, visibilité) et le renderer legacy
// vivent dans ./tabs.js — on les réutilise (getProfilCacheRef / renderCharProfil).
//
// Exporte renderCharProfilV3 (routeur) + les handlers câblés par characters.js
// (registre data-action / data-change / data-blur).
// ══════════════════════════════════════════════════════════════════════════════
import { charSession } from '../../shared/char-session.js';
import { STATE } from '../../core/state.js';
import { updateInCol } from '../../data/firestore.js';
import { _esc } from '../../shared/html.js';
import { showNotif } from '../../shared/notifications.js';
import { getCharacterById } from '../../shared/character-state.js';
import { promptModal } from '../../shared/modal.js';
import { richTextContentHtml } from '../../shared/rich-text.js';
import {
  bindFreePageEditor,
  compressFreePageImages,
  freePageEditorHtml,
  freePageToLegacyHtml,
  getFreePageData,
  hasFreePage,
  renderFreePageHtml,
} from '../../shared/free-page.js';
import { renderCharProfil, getProfilCacheRef as _profilCache } from './tabs.js';

// État module-local
let _csV3EditingBio = null;

const _TAG_PALETTE = [
  ['rgba(79,140,255,.14)','rgba(79,140,255,.35)','#7fb0ff'],
  ['rgba(34,195,142,.14)','rgba(34,195,142,.35)','#22c38e'],
  ['rgba(232,184,75,.14)','rgba(232,184,75,.35)','#e8b84b'],
  ['rgba(180,127,255,.14)','rgba(180,127,255,.35)','#b47fff'],
  ['rgba(255,107,107,.14)','rgba(255,107,107,.35)','#ff8080'],
];
function _v3TagColor(text) {
  let h = 0; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) & 0xffff;
  return _TAG_PALETTE[h % _TAG_PALETTE.length];
}

function _renderRadarV3(c) {
  const statValue = (key) => Math.min(22, (c.stats?.[key] || 8) + (c.statsBonus?.[key] || 0));
  const STATS_K = [
    { k: 'FOR', v: statValue('force') },
    { k: 'DEX', v: statValue('dexterite') },
    { k: 'INT', v: statValue('intelligence') },
    { k: 'CON', v: statValue('constitution') },
    { k: 'SAG', v: statValue('sagesse') },
    { k: 'CHA', v: statValue('charisme') },
  ];
  const cx = 120, cy = 120, R = 80, maxStat = 22, n = STATS_K.length;
  const angle = (i) => -Math.PI / 2 + (i * 2 * Math.PI / n);
  const point = (i, v) => {
    const r = (Math.max(0, Math.min(maxStat, v)) / maxStat) * R;
    const a = angle(i);
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  const rings = [1, .75, .5, .25].map(k => {
    const pts = STATS_K.map((_, i) => {
      const a = angle(i);
      return [cx + Math.cos(a) * R * k, cy + Math.sin(a) * R * k];
    });
    return `<polygon class="radar-grid" points="${pts.map(p => p.join(',')).join(' ')}"/>`;
  }).join('');
  const axes = STATS_K.map((_, i) => {
    const a = angle(i);
    return `<line class="radar-axis" x1="${cx}" y1="${cy}" x2="${cx + Math.cos(a) * R}" y2="${cy + Math.sin(a) * R}"/>`;
  }).join('');
  const poly = STATS_K.map((s, i) => point(i, s.v).join(',')).join(' ');
  const pts = STATS_K.map((s, i) => {
    const [x, y] = point(i, s.v);
    return `<circle class="radar-pt" cx="${x}" cy="${y}" r="2.5"/>`;
  }).join('');
  const lbls = STATS_K.map((s, i) => {
    const a = angle(i);
    const lx = cx + Math.cos(a) * (R + 14);
    const ly = cy + Math.sin(a) * (R + 14);
    return `<text class="radar-lbl" x="${lx}" y="${ly}" text-anchor="middle" dy="3">${s.k}</text>
            <text class="radar-val" x="${lx}" y="${ly + 10}" text-anchor="middle" dy="3">${s.v}</text>`;
  }).join('');
  return `<div class="radar-wrap"><svg class="radar-svg" viewBox="0 0 240 240">
    ${rings}${axes}<polygon class="radar-poly" points="${poly}"/>${pts}${lbls}
  </svg></div>`;
}

// La drop-cap est gérée 100% en CSS (.profil-text > p:first-of-type::first-letter)
// → rendu fidèle, on ne touche jamais à l'HTML du contenu.

// Champs d'identité par défaut (insérés si absents de c.identity)
const IDENTITY_DEFAULTS = ['Âge', 'Taille', 'Yeux', 'Cheveux', 'Origine', 'Idéal', 'Lien'];

// Normalise un tableau d'identité depuis le schéma legacy [[k,v]] OU le nouveau
// schéma [{k,v}]. Firestore n'accepte PAS les arrays d'arrays — on migre.
function _normalizeIdentity(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(x => {
    if (Array.isArray(x) && x[0]) return { k: String(x[0]), v: String(x[1] || '') };
    if (x && typeof x === 'object' && x.k) return { k: String(x.k), v: String(x.v || '') };
    return null;
  }).filter(Boolean);
}

function _mergeIdentityDefaults(arr) {
  // Renvoie [{k,v}] avec les 7 défauts toujours présents + les éventuels customs.
  const current = _normalizeIdentity(arr);
  const byKey = new Map(current.map(e => [e.k, e.v]));
  const out = [];
  IDENTITY_DEFAULTS.forEach(k => out.push({ k, v: byKey.get(k) || '' }));
  current.forEach(e => {
    if (!IDENTITY_DEFAULTS.includes(e.k)) out.push(e);
  });
  return out;
}

export function renderCharProfilV3(c, canEdit) {
  // Bootstrap pres cache pour récupérer la bio rich-text
  if (!(c.id in _profilCache)) {
    try { renderCharProfil(c, canEdit); } catch {}
  }

  const quote = c.quote || '';
  const identity = _mergeIdentityDefaults(c.identity);
  const presCache = _profilCache?.[c.id] || null;
  const canManageIllustration = STATE.isAdmin;
  const bioHtml = presCache?.content || c.bio || '';
  const bioPage = c.bioPage || presCache?.bioPage || null;
  // Source de vérité des traits = c.tags (le V3 écrit dessus via updateInCol
  // 'characters'). On ne lit presCache.tags QUE si c.tags est absent : sinon un
  // `tags:[]` périmé du doc players (truthy !) masquait les traits enregistrés.
  const tags = Array.isArray(c.tags) ? c.tags : (presCache?.tags || []);

  const visEntries = [
    { k: 'afficherNiveau',    lbl: 'Niveau',           def: true  },
    { k: 'afficherPV',        lbl: 'PV',               def: true  },
    { k: 'afficherPM',        lbl: 'PM',               def: true  },
    { k: 'afficherCA',        lbl: "Classe d'armure",  def: true  },
    { k: 'afficherOr',        lbl: 'Or',               def: false },
    { k: 'afficherStats',     lbl: 'Statistiques',     def: true  },
    { k: 'afficherEquip',     lbl: 'Équipement',       def: true  },
    { k: 'afficherIdentite',  lbl: 'Identité',         def: true  },
    { k: 'afficherCitation',  lbl: 'Citation',         def: true  },
    { k: 'afficherBio',       lbl: 'Biographie',       def: true  },
    { k: 'afficherTags',      lbl: 'Traits perso.',    def: true  },
  ];

  const TAG_MAX_V3 = 8;
  const V3_TAG_SUGGESTIONS = [
    'Bienveillant','Vengeur','Courageux','Méfiant','Loyal','Obsessionnel',
    'Impulsif','Protecteur','Solitaire','Curieux','Ambitieux','Charismatique',
    'Prudent','Rusé','Empathique','Froid','Fervent','Téméraire',
  ];
  const tagsLow = tags.map(t => t.toLowerCase());
  const tagChips = tags.map(t => {
    const [bg, bd, col] = _v3TagColor(t);
    const removeBtn = canEdit
      ? `<button class="profil-tag-x" title="Retirer" data-action="csV3RemoveProfilTag" data-id="${c.id}" data-tag="${_esc(t)}">×</button>`
      : '';
    return `<span class="profil-tag" style="--tag-bg:${bg};--tag-bd:${bd};--tag-c:${col}">${_esc(t)}${removeBtn}</span>`;
  }).join('');

  const tagsFull = tags.length >= TAG_MAX_V3;
  const tagEditor = canEdit
    ? `<div class="profil-tags-editor">
        <div class="profil-tags-input-row">
          <input type="text" id="csv3-tag-input-${c.id}" class="profil-tag-input"
            placeholder="${tagsFull ? `Maximum ${TAG_MAX_V3} traits atteint` : 'Ajouter un trait personnalisé…'}"
            maxlength="24" ${tagsFull?'disabled':''}
            data-enter-click="[data-action=csV3AddProfilTagFromInput]" data-esc="clear-blur">
          <button class="profil-tag-add-btn" ${tagsFull?'disabled':''}
            data-action="csV3AddProfilTagFromInput" data-id="${c.id}">Ajouter</button>
        </div>
        <details class="profil-tag-suggest-details">
          <summary>Suggestions rapides</summary>
          <div class="profil-tag-suggest-row">
            ${V3_TAG_SUGGESTIONS.map(s => {
              const used = tagsLow.includes(s.toLowerCase());
              return `<button class="profil-tag-suggest ${used?'is-used':''}" ${used||tagsFull?'disabled':''}
                data-action="csV3AddProfilTag" data-id="${c.id}" data-tag="${_esc(s)}">${_esc(s)}</button>`;
            }).join('')}
          </div>
        </details>
      </div>`
    : '';

  // Identité : 7 champs par défaut + éventuels custom. Valeur DIRECTEMENT éditable inline.
  const identityHtml = identity.map(({ k, v }) => {
    const isCustom = !IDENTITY_DEFAULTS.includes(k);
    const safeKey = k.replace(/'/g, "\\'");
    const valHtml = canEdit
      ? `<input type="text" class="profil-fact-input" value="${_esc(v)}" placeholder="—"
          data-id-key="${_esc(k)}"
          data-blur="csV3SaveIdentityValue" data-id="${c.id}" data-key="${safeKey}"
          data-enter="blur" data-esc="revert-blur">`
      : `<span class="profil-fact-v">${v ? _esc(v) : '<span style="color:var(--text-dim)">—</span>'}</span>`;
    const keyClickable = isCustom && canEdit
      ? `data-action="csV3RenameIdentity" data-id="${c.id}" data-key="${safeKey}" style="cursor:pointer" title="Renommer / supprimer"`
      : '';
    return `<div class="profil-fact">
      <span class="profil-fact-k" ${keyClickable}>${_esc(k)}${isCustom && canEdit?' <small style="opacity:.5">✎</small>':''}</span>
      ${valHtml}
    </div>`;
  }).join('');

  // Bio : page libre structurée. L'ancien HTML est importé dans un premier bloc
  // à la première édition, sans migration destructive du contenu existant.
  const editingBio = _csV3EditingBio === c.id;
  const bioBlockHtml = editingBio && canEdit
    ? `<div class="profil-bio-edit">
        ${freePageEditorHtml({ id: 'profil-bio-page', page: bioPage, legacyHtml: bioHtml })}
        <div class="profil-bio-savebar">
          <span>La composition sera visible de la même façon sur la page Joueurs.</span>
          <div class="profil-bio-saveactions">
          <button class="btn btn-gold btn-sm" data-action="csV3SaveBioRt" data-free-page-save data-id="${c.id}">Enregistrer</button>
          <button class="btn btn-outline btn-sm" data-action="csV3CancelBio" data-id="${c.id}">Annuler</button>
          </div>
        </div>
      </div>`
    : `${hasFreePage(bioPage)
        ? renderFreePageHtml({ page: bioPage, className: 'profil-free-page' })
        : bioHtml
          ? richTextContentHtml({ html: bioHtml, className: 'profil-text' })
        : `<div class="profil-text"><p style="color:var(--text-dim);font-style:italic">${canEdit?'Clique sur ✎ pour rédiger une bio.':'Aucune biographie publique.'}</p></div>`}
      ${canEdit ? `<button class="section-action" style="align-self:flex-start;margin-top:6px"
        data-action="csV3EnterBioEdit" data-id="${c.id}">Composer la biographie</button>` : ''}`;
  const quoteHtml = canEdit
    ? `<label class="profil-quote-block">
        <span class="profil-field-label">Citation</span>
        <input class="profil-quote profil-quote-edit ${!quote ? 'is-empty' : ''}" type="text"
        value="${_esc(quote)}"
        placeholder="Ajoute une citation pour ton personnage…"
        data-input="_csQuoteToggleEmpty"
        data-blur="csV3SaveQuote" data-id="${c.id}"
        data-enter="blur" data-esc="revert-blur">
      </label>`
    : (quote ? `<div class="profil-quote-block"><span class="profil-field-label">Citation</span><div class="profil-quote">${_esc(quote)}</div></div>` : '');
  const tagsBlockHtml = (canEdit || tags.length) ? `<div class="profil-tags-block">
    ${canEdit ? `<div class="profil-tags-head">
      <div class="profil-tags-title">🎭 Traits de caractère</div>
      <span class="profil-tag-counter">${tags.length} / ${TAG_MAX_V3}</span>
    </div>` : ''}
    <div class="profil-tags">${tagChips || (canEdit ? '<span class="profil-tags-empty">Aucun trait pour l\'instant</span>' : '')}</div>
    ${tagEditor}
  </div>` : '';
  const heroSub = [c.classe, c.race].filter(Boolean).map(_esc).join(' · ') || 'Identité à préciser';
  const illustrationCardHtml = (canManageIllustration || presCache?.imageUrl) ? `
      <div class="profil-side-card profil-illu-card">
        <h4>🖼️ Illustration page Joueurs</h4>
        <div class="profil-illu-row">
          <div class="profil-img-wrap">
            ${presCache?.imageUrl
              ? `<img class="profil-img" src="${_esc(presCache.imageUrl)}" alt="">`
              : `<div class="profil-img profil-img-empty">Aucune image</div>`}
          </div>
          <div class="profil-illu-meta">
            <div class="profil-img-hint">L'image apparaît sur la page Joueurs comme illustration grand format du personnage.</div>
            ${canManageIllustration ? `<div class="profil-img-actions">
              <button class="section-action" style="flex:1" data-action="openProfilImageUpload" data-id="${c.id}">
                ${presCache?.imageUrl ? '🔄 Changer' : '📷 Upload image'}
              </button>
              ${presCache?.imageUrl ? `<button class="section-action" style="color:var(--crimson-light,#ff8ca7);border-color:rgba(255,90,126,.3)" data-action="removeProfilImage" data-id="${c.id}" title="Retirer">✕</button>` : ''}
            </div>` : ''}
          </div>
        </div>
      </div>` : '';

  return `
  <div class="profil-layout ${editingBio ? 'is-bio-editing' : ''}">
    <div class="profil-main">
      <div class="profil-side-card profil-bio-card">
        <h4>✎ Biographie</h4>
        ${bioBlockHtml}
      </div>
      <div class="profil-meta-stack">
        <section class="profil-hero">
          <div class="profil-hero-head">
            <div>
              <span class="profil-hero-kicker">Profil</span>
              <h3>${_esc(c.nom || 'Sans nom')}</h3>
              <p>${heroSub}</p>
            </div>
          </div>
          ${quoteHtml}
          ${tagsBlockHtml}
        </section>
        <div class="profil-side-card profil-identity-card">
          <h4>📜 Identité</h4>
          <div class="profil-facts-grid">${identityHtml}</div>
          ${canEdit ? `<button class="section-action" style="margin-top:.6rem;width:100%" data-action="csV3AddFact" data-id="${c.id}">＋ Champ personnalisé</button>` : ''}
        </div>
      </div>
    </div>
    <div class="profil-side">
      <div class="profil-side-card">
        <h4>🎯 Profil de stats</h4>
        ${_renderRadarV3(c)}
      </div>
      ${illustrationCardHtml}
      ${canEdit ? `
      <div class="profil-side-card">
        <h4>👁️ Visible par les joueurs</h4>
        <div class="vis-toggles">
        ${visEntries.map(v => {
          const cur = presCache?.[v.k];
          const checked = cur === undefined ? v.def : !!cur;
          return `<label class="vis-toggle">
            <span class="vis-toggle-lbl">${_esc(v.lbl)}</span>
            <input type="checkbox" ${checked?'checked':''}
              data-change="_csV3SaveVisibility" data-id="${c.id}" data-key="${v.k}">
            <span class="vis-toggle-track"><span class="vis-toggle-thumb"></span></span>
          </label>`;
        }).join('')}
        </div>
      </div>` : ''}
    </div>
  </div>`;
}

// Handler édition citation — sauvegarde inline sans modal
export async function _csV3SaveQuote(charId, value) {
  const c = getCharacterById(charId); if (!c) return;
  const trimmed = (value || '').trim();
  if ((c.quote || '') === trimmed) return;
  c.quote = trimmed;
  try { await updateInCol('characters', charId, { quote: trimmed }); }
  catch (e) { console.warn('[quote save]', e); }
}
async function _csV3CommitTags(charId, nextTags) {
  const c = getCharacterById(charId); if (!c) return;
  c.tags = nextTags;
  if (_profilCache?.[charId]) _profilCache[charId].tags = nextTags;
  try { await updateInCol('characters', charId, { tags: nextTags }); }
  catch (e) { console.warn('[tags save]', e); }
  if (charSession.getCurrentCharTab() === 'profil') charSession.renderTab('profil', c, true);
}
export async function _csV3AddProfilTag(charId, value) {
  const t = (value || '').trim(); if (!t) return;
  const c = getCharacterById(charId); if (!c) return;
  const cur = (Array.isArray(c.tags) ? c.tags : (_profilCache?.[charId]?.tags || [])).slice();
  if (cur.length >= 8) return;
  if (cur.some(x => x.toLowerCase() === t.toLowerCase())) return;
  cur.push(t);
  await _csV3CommitTags(charId, cur);
}
export async function _csV3AddProfilTagFromInput(charId) {
  const input = document.getElementById(`csv3-tag-input-${charId}`);
  if (!input) return;
  const val = input.value.trim();
  if (!val) { input.focus(); return; }
  await _csV3AddProfilTag(charId, val);
}
export async function _csV3RemoveProfilTag(charId, value) {
  const t = (value || '').trim(); if (!t) return;
  const c = getCharacterById(charId); if (!c) return;
  const cur = (Array.isArray(c.tags) ? c.tags : (_profilCache?.[charId]?.tags || [])).slice();
  const next = cur.filter(x => x.toLowerCase() !== t.toLowerCase());
  if (next.length === cur.length) return;
  await _csV3CommitTags(charId, next);
}
// Sauvegarde la VALEUR d'un champ identité (defaults ou custom) directement depuis l'input.
// Ne re-render PAS la fiche pour éviter de perdre le focus pendant la saisie.
export async function _csV3SaveIdentityValue(charId, key, value) {
  const c = getCharacterById(charId); if (!c) return;
  const merged = _mergeIdentityDefaults(c.identity);
  const trimmed = (value || '').trim();
  const old = (merged.find(e => e.k === key)?.v) || '';
  if (old === trimmed) return;
  // Schéma Firestore-friendly : array d'objets {k,v}. On ne stocke que les
  // defaults qui ont une valeur + tous les customs.
  const next = merged
    .map(e => e.k === key ? { k: e.k, v: trimmed } : e)
    .filter(e => IDENTITY_DEFAULTS.includes(e.k) ? !!e.v : true);
  c.identity = next;
  try { await updateInCol('characters', charId, { identity: next }); }
  catch (e) {
    console.warn('[identity save]', e);
    showNotif('Erreur de sauvegarde.', 'error');
  }
}
// Renomme / supprime un champ CUSTOM (les defaults ne sont pas renommables)
export async function _csV3RenameIdentity(charId, key) {
  if (IDENTITY_DEFAULTS.includes(key)) return;
  const c = getCharacterById(charId); if (!c) return;
  const newK = await promptModal(`Renommer "${_esc(key)}" <span style="opacity:.7;font-size:.85em">(vide = supprimer)</span> :`, { title: 'Renommer', default: key });
  if (newK === null) return;
  const trimmed = newK.trim();
  let next = _normalizeIdentity(c.identity);
  if (!trimmed) {
    next = next.filter(e => e.k !== key);
  } else {
    next = next.map(e => e.k === key ? { k: trimmed, v: e.v } : e);
  }
  c.identity = next;
  try { await updateInCol('characters', charId, { identity: next }); }
  catch (e) { console.warn('[identity rename]', e); }
  if (charSession.getCurrentCharTab() === 'profil') charSession.renderTab('profil', c, true);
}
// Ajoute un champ identité custom
export async function _csV3AddFact(charId) {
  const c = getCharacterById(charId); if (!c) return;
  const k = (await promptModal('Nom du champ (ex: Bras-droit, Phobie…) :', { title: 'Nouveau champ', required: true })); if (!k?.trim()) return;
  const v = (await promptModal('Valeur :', { title: 'Nouveau champ' })) || '';
  const next = _normalizeIdentity(c.identity);
  next.push({ k: k.trim(), v: v.trim() });
  c.identity = next;
  try { await updateInCol('characters', charId, { identity: next }); }
  catch (e) { console.warn('[identity add]', e); }
  if (charSession.getCurrentCharTab() === 'profil') charSession.renderTab('profil', c, true);
}
// Édition bio avec l'éditeur rich-text — mode "édition" toggle
export function _csV3EnterBioEdit(charId) {
  _csV3EditingBio = charId;
  const c = getCharacterById(charId); if (!c) return;
  charSession.renderTab('profil', c, true);
}
export function _csV3CancelBio(charId) {
  _csV3EditingBio = null;
  const c = getCharacterById(charId); if (!c) return;
  charSession.renderTab('profil', c, true);
}
// Firestore plafonne un document à 1 048 576 octets. La bio (diapo) vit SUR le
// doc perso, à côté de l'inventaire/builds/etc. → on doit borner le DOCUMENT
// ENTIER, pas seulement la bio. Marge de sécurité sous la limite (noms de champs
// + surcoût Firestore non comptés par JSON.stringify).
const BIO_DOC_SAFE_BYTES = 1_000_000;
const _utf8Len = (str) => new TextEncoder().encode(str).length;
// Taille approx du doc perso résultant avec la nouvelle bio appliquée.
const _projectedCharDocBytes = (c, extra) => _utf8Len(JSON.stringify({ ...c, ...extra }));

export async function _csV3SaveBioRt(charId) {
  const c = getCharacterById(charId); if (!c) return;
  let bioPage = getFreePageData(document.getElementById('profil-bio-page'));
  if (!bioPage) return showNotif('Editeur de biographie indisponible.', 'error');
  let html = freePageToLegacyHtml(bioPage);

  // Garde-fou de taille : si le doc perso dépasserait la limite Firestore, on
  // recompresse d'abord les images du deck (progressivement), et seulement en
  // dernier recours on bloque avec un message chiffré — jamais d'écriture vouée
  // à l'échec (cause du blocage « document size exceeds maximum »).
  let bytes = _projectedCharDocBytes(c, { bio: html, bioPage });
  if (bytes > BIO_DOC_SAFE_BYTES) {
    for (const opts of [{ max: 900, quality: .6 }, { max: 720, quality: .5 }, { max: 560, quality: .42 }]) {
      bioPage = await compressFreePageImages(bioPage, opts);
      html = freePageToLegacyHtml(bioPage);
      bytes = _projectedCharDocBytes(c, { bio: html, bioPage });
      if (bytes <= BIO_DOC_SAFE_BYTES) { showNotif('Images recompressées pour tenir dans la limite Firestore.', 'info'); break; }
    }
  }
  if (bytes > BIO_DOC_SAFE_BYTES) {
    return showNotif(`Cette biographie est trop lourde (~${Math.round(bytes / 1024)} Ko pour une limite de ~${Math.round(BIO_DOC_SAFE_BYTES / 1024)} Ko). Retire une image ou une diapo.`, 'error');
  }

  try {
    await updateInCol('characters', charId, { bio: html, bioPage });
  } catch (e) {
    console.error('[bio page save]', e);
    if (isFirestoreDocumentSizeError(e)) {
      showNotif('Biographie trop lourde pour Firestore. Supprime une image ou remplace-la par une version plus lÃ©gÃ¨re.', 'error');
      return;
    }
    showNotif('La biographie n\'a pas pu être enregistrée.', 'error');
    return;
  }
  c.bio = html;
  c.bioPage = bioPage;
  const presCache = _profilCache?.[charId];
  if (presCache?.id) {
    try {
      await updateInCol('players', presCache.id, { content: html, bioPage });
      presCache.content = html;
      presCache.bioPage = bioPage;
    } catch (e) { console.warn('[bio→pres sync]', e); }
  }
  _csV3EditingBio = null;
  showNotif('Biographie enregistrée.', 'success');
  charSession.renderTab('profil', c, true);
}

function isFirestoreDocumentSizeError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('exceeds the maximum allowed size') || message.includes('1,048,576');
}

export function bindCharProfilV3(root) {
  bindFreePageEditor(root);
}

export async function _csV3SaveVisibility(charId, key, value) {
  // Sauvegarde directement sur le document pres (collection 'players'). Si pas en cache, on fallback char doc.
  const presCache = _profilCache?.[charId];
  if (presCache?.id) {
    try {
      await updateInCol('players', presCache.id, { [key]: value });
      presCache[key] = value;
    } catch (e) { console.error('[visibility]', e); }
  } else {
    // Fallback : stocker sur le char
    const c = getCharacterById(charId);
    if (c) { c[key] = value; await updateInCol('characters', charId, { [key]: value }); }
  }
}
