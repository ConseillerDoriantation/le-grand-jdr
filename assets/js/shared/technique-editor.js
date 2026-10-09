// ══════════════════════════════════════════════════════════════════════════════
// SHARED / TECHNIQUE-EDITOR.JS — Éditeur de technique en modificateurs (factorisé)
// Un SEUL tableau de modificateurs, partagé par la modale des types d'arme et
// celle des types de dégâts. La fabrique reçoit les dépendances (échappement,
// icônes, options de caracs/états/types de dégâts) et renvoie : la table, le
// résumé généré, le tag d'équilibrage, la carte d'édition, les menus et l'action.
// Le balisage (classes .wf-*, attributs data-wf-*) est identique pour les deux
// modales : chaque contrôleur hôte dispatche les mêmes actions.
// ══════════════════════════════════════════════════════════════════════════════

const _DEGATS_RE_DEFAULT = /^\d*d\d+(?:[+-]\d+)?$/i;

export function makeTechniqueEditor(cfg = {}) {
  const esc = cfg.esc || (s => String(s ?? ''));
  const icon = cfg.icon || (() => '');
  // statOptions peut être un tableau ou un getter (résolu paresseusement au rendu).
  const _statSrc = cfg.statOptions || [];
  const statOptions = typeof _statSrc === 'function' ? _statSrc : () => _statSrc;
  const dmgOpts = cfg.damageTypeOptions || (() => []);
  const condOpts = cfg.conditionOptions || (() => []);
  const dmgLabel = cfg.damageLabel || (id => id || '');
  const condLabel = cfg.conditionLabel || (id => id || '');
  const degatsRe = cfg.degatsRe || _DEGATS_RE_DEFAULT;
  const MOVE = { push: 'repousse', pull: 'attire' };

  // ── Contrôles (adressés par champ sur la technique ouverte) ──
  function stp(field, val, o = {}) {
    const { step = 1, min = 0, max = 99, pre = '', suf = '', zero = false, disp } = o;
    const show = disp ? disp(val) : `${pre}${val}${suf}`;
    const a = `data-wf-step="${field}" data-step="${step}" data-min="${min}" data-max="${max}" data-zero="${zero ? 1 : 0}"`;
    return `<div class="wf-stp"><button type="button" ${a} data-dir="-1">−</button><span>${esc(show)}</span><button type="button" ${a} data-dir="1">+</button></div>`;
  }
  const segF = (field, val, opts) => `<div class="wf-seg">${opts.map(([v, l]) => `<button type="button" class="${val === v ? 'on' : ''}" data-wf-fxset="${field}:${v}">${esc(l)}</button>`).join('')}</div>`;
  const selF = (field, val, opts, empty) => `<select class="wf-sel sans" data-wf-fx="${field}">${empty != null ? `<option value="">${esc(empty)}</option>` : ''}${opts.map(([v, l]) => `<option value="${esc(v)}"${val === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const txtF = (field, val, ph, mono) => `<input class="wf-fi${mono ? '' : ' sans'} wf-fi-sm" value="${esc(val || '')}" placeholder="${esc(ph || '')}" maxlength="30" data-wf-fxt="${field}">`;
  const togF = (field, on, label) => `<label class="wf-mini"><button type="button" class="wf-sw${on ? ' on' : ''}" data-wf-fxtog="${field}" role="switch" aria-checked="${on}"></button>${esc(label)}</label>`;

  const MODS = [
    { k: 'tch', grp: 'Précision', badge: 'TCH', name: 'Toucher', help: 'Bonus/malus au jet d’attaque', good: true,
      on: t => (t.attackModifier || 0) !== 0, txt: t => `toucher ${t.attackModifier > 0 ? '+' : '−'}${Math.abs(t.attackModifier)}`,
      add: t => { t.attackModifier = 2; }, clear: t => { t.attackModifier = 0; },
      ctl: t => stp('attackModifier', t.attackModifier || 0, { min: -10, max: 10, zero: true, pre: t.attackModifier > 0 ? '+' : '' }) },
    { k: 'ca', grp: 'Précision', badge: 'CA', name: 'CA de la cible', help: 'Plus dure à toucher (contrepartie)', good: false,
      on: t => (t.defenseBonus || 0) !== 0, txt: t => `CA cible +${t.defenseBonus}`,
      add: t => { t.defenseBonus = 2; }, clear: t => { t.defenseBonus = 0; },
      ctl: t => stp('defenseBonus', t.defenseBonus || 0, { min: 1, max: 10, pre: '+' }) },
    { k: 'av', grp: 'Précision', badge: 'AV', name: 'Avec avantage seulement', help: 'Sinon l’attaque reste normale', good: false,
      on: t => !!t.requiresAdvantage, txt: () => 'avantage requis',
      add: t => { t.requiresAdvantage = true; }, clear: t => { t.requiresAdvantage = false; }, ctl: () => '' },
    { k: 'de', grp: 'Dégâts', badge: 'DÉ', name: 'Dés d’arme', help: 'Dés d’arme supplémentaires', good: true,
      on: t => (t.extraWeaponDice || 0) > 0, txt: t => `+${t.extraWeaponDice} dé d’arme`,
      add: t => { t.extraWeaponDice = 1; }, clear: t => { t.extraWeaponDice = 0; },
      ctl: t => stp('extraWeaponDice', t.extraWeaponDice || 0, { min: 1, max: 6, pre: '+' }) },
    { k: 'fml', grp: 'Dégâts', badge: 'FML', name: 'Dégâts bonus', help: 'Formule + type propre', good: true,
      on: t => !!t.extraDamageFormula, txt: t => `+${t.extraDamageFormula}${t.damageTypeId ? ' ' + dmgLabel(t.damageTypeId) : ''}`,
      add: t => { t.extraDamageFormula = '1d6'; }, clear: t => { t.extraDamageFormula = ''; t.damageTypeId = ''; },
      ctl: t => txtF('extraDamageFormula', t.extraDamageFormula, '1d6', true) + selF('damageTypeId', t.damageTypeId || '', dmgOpts(), 'Même type') },
    { k: 'dg', grp: 'Dégâts', badge: '+DG', name: 'Dégâts fixes', help: 'Dégâts plats ajoutés', good: true,
      on: t => (t.extraDamageFlat || 0) > 0, txt: t => `+${t.extraDamageFlat} dégâts`,
      add: t => { t.extraDamageFlat = 2; }, clear: t => { t.extraDamageFlat = 0; },
      ctl: t => stp('extraDamageFlat', t.extraDamageFlat || 0, { min: 1, max: 99, pre: '+' }) },
    { k: 'mod', grp: 'Dégâts', badge: 'MOD', name: 'Modificateur d’arme', help: 'Ajoute le mod de carac de l’arme', good: true,
      on: t => !!t.addWeaponModifier, txt: () => '+ mod d’arme',
      add: t => { t.addWeaponModifier = true; }, clear: t => { t.addWeaponModifier = false; }, ctl: () => '' },
    { k: 'crt', grp: 'Dégâts', badge: 'CRT', name: 'Critique élargi', help: 'Abaisse le seuil, bonus doublé possible', good: true,
      on: t => (t.critRangeBonus || 0) > 0, txt: t => `critique ${20 - t.critRangeBonus}–20`,
      add: t => { t.critRangeBonus = 1; }, clear: t => { t.critRangeBonus = 0; t.criticalMode = 'normal'; },
      ctl: t => stp('critRangeBonus', t.critRangeBonus || 0, { min: 1, max: 5, disp: v => `${20 - v}–20` }) + segF('criticalMode', t.criticalMode || 'normal', [['normal', 'Normal'], ['double', 'Doublé']]) },
    { k: 'prc', grp: 'Dégâts', badge: 'PRC', name: 'Armure ignorée', help: 'Pourcentage de CA ignoré', good: true,
      on: t => (t.armorIgnorePct || 0) > 0, txt: t => `ignore ${t.armorIgnorePct}% CA`,
      add: t => { t.armorIgnorePct = 20; }, clear: t => { t.armorIgnorePct = 0; },
      ctl: t => stp('armorIgnorePct', t.armorIgnorePct || 0, { min: 10, max: 100, step: 10, suf: '%' }) },
    { k: 'prg', grp: 'Dégâts', badge: 'PRG', name: 'Progression', help: 'Monte avec niveau/maîtrise/carac', good: true,
      on: t => (t.scalingMode || 'none') !== 'none', txt: () => 'progression',
      add: t => { t.scalingMode = 'level'; t.scalingEvery = 4; t.scalingFormula = '1d4'; },
      clear: t => { t.scalingMode = 'none'; t.scalingEvery = 1; t.scalingFormula = ''; t.scalingStat = 'force'; },
      ctl: t => selF('scalingMode', t.scalingMode || 'level', [['level', 'Niveau'], ['mastery', 'Maîtrise'], ['stat', 'Carac']]) + txtF('scalingFormula', t.scalingFormula, '1d4', true) + '<span class="wf-ctl-x">/</span>' + stp('scalingEvery', t.scalingEvery || 1, { min: 1, max: 20 }) + (t.scalingMode === 'stat' ? selF('scalingStat', t.scalingStat || 'force', statOptions()) : '') },
    { k: 'zon', grp: 'Effets', badge: 'ZON', name: 'Zone', help: 'Forme, rayon, cibles, origine', good: true,
      on: t => (t.blastRadius || 0) > 0, txt: t => `zone ${t.blastRadius}`,
      add: t => { t.blastRadius = 1; t.areaShape = 'circle'; },
      clear: t => { t.blastRadius = 0; t.areaShape = 'square'; t.areaOrigin = 'target'; t.areaTargets = 'all'; t.includeCaster = false; },
      ctl: t => selF('areaShape', t.areaShape || 'circle', [['square', 'Carré'], ['circle', 'Cercle'], ['line', 'Ligne'], ['cone', 'Cône']]) + stp('blastRadius', t.blastRadius || 0, { min: 1, max: 30 }) + selF('areaTargets', t.areaTargets || 'all', [['all', 'Tout le monde'], ['enemies', 'Ennemis'], ['allies', 'Alliés']]) + selF('areaOrigin', t.areaOrigin || 'target', [['target', 'Sur la cible'], ['caster', 'Sur le lanceur']]) + togF('includeCaster', !!t.includeCaster, 'Lanceur affecté') },
    { k: 'ett', grp: 'Effets', badge: 'ÉTT', name: 'État infligé', help: 'État, durée et jet de sauvegarde', good: true,
      on: t => !!t.conditionId, txt: t => condLabel(t.conditionId),
      add: t => { t.conditionId = 'prone'; }, clear: t => { t.conditionId = ''; t.conditionDuration = 0; t.conditionSaveStat = ''; t.conditionSaveDC = 0; },
      ctl: t => selF('conditionId', t.conditionId || '', condOpts(), 'Aucun') + stp('conditionDuration', t.conditionDuration || 0, { min: 0, max: 100, disp: v => v ? `${v} t` : 'défaut' }) + selF('conditionSaveStat', t.conditionSaveStat || '', statOptions(), 'Aucun JS') + (t.conditionSaveStat ? stp('conditionSaveDC', t.conditionSaveDC || 0, { min: 0, max: 40, disp: v => v ? `DD ${v}` : 'DD déf.' }) : '') },
    { k: 'dep', grp: 'Effets', badge: 'DEP', name: 'Déplacement forcé', help: 'Pousser ou attirer la cible', good: true,
      on: t => (t.forcedMovement || 'none') !== 'none', txt: t => `${MOVE[t.forcedMovement] || 'déplace'} ${t.forcedMovementDistance || 1}`,
      add: t => { t.forcedMovement = 'push'; t.forcedMovementDistance = 1; }, clear: t => { t.forcedMovement = 'none'; t.forcedMovementDistance = 0; },
      ctl: t => segF('forcedMovement', t.forcedMovement || 'push', [['push', 'Pousser'], ['pull', 'Attirer']]) + stp('forcedMovementDistance', t.forcedMovementDistance || 1, { min: 1, max: 6 }) },
    { k: 'txt', grp: 'Effets', badge: 'TXT', name: 'Effet narratif', help: 'Texte affiché dans le résultat', good: true,
      on: t => !!t.onHitEffect, txt: t => `« ${t.onHitEffect} »`,
      add: t => { t.onHitEffect = 'La cible lâche son arme'; }, clear: t => { t.onHitEffect = ''; },
      ctl: t => `<input class="wf-fi sans wf-fi-wide" value="${esc(t.onHitEffect || '')}" maxlength="160" placeholder="Ex. La cible lâche son arme" data-wf-fxt="onHitEffect">` },
    { k: 'mdg', grp: 'Contreparties', badge: '−DG', name: 'Malus de dégâts', help: 'Dégâts retirés', good: false,
      on: t => (t.damageMalusFlat || 0) > 0, txt: t => `−${t.damageMalusFlat} dégâts`,
      add: t => { t.damageMalusFlat = 2; }, clear: t => { t.damageMalusFlat = 0; },
      ctl: t => stp('damageMalusFlat', t.damageMalusFlat || 0, { min: 1, max: 99, pre: '−' }) },
    { k: 'ratca', grp: 'Contreparties', badge: 'RAT', name: 'Raté : CA réduite', help: 'Jusqu’à la fin du round', good: false,
      on: t => (t.missSelfCaMalus || 0) > 0, txt: t => `raté : CA −${t.missSelfCaMalus}`,
      add: t => { t.missSelfCaMalus = 2; }, clear: t => { t.missSelfCaMalus = 0; },
      ctl: t => stp('missSelfCaMalus', t.missSelfCaMalus || 0, { min: 1, max: 10, pre: '−' }) },
    { k: 'ratet', grp: 'Contreparties', badge: 'RAT', name: 'Raté : état sur soi', help: 'État subi en cas d’échec', good: false,
      on: t => !!t.missSelfConditionId, txt: t => `raté : ${condLabel(t.missSelfConditionId)}`,
      add: t => { t.missSelfConditionId = 'exposed'; }, clear: t => { t.missSelfConditionId = ''; },
      ctl: t => selF('missSelfConditionId', t.missSelfConditionId || '', condOpts(), 'Aucun') },
    { k: 'cot', grp: 'Contreparties', badge: 'CÔT', name: 'Coût en ressource', help: 'PM, PV ou or', good: false,
      on: t => (t.resourceType || 'none') !== 'none' && (t.resourceCost || 0) > 0, txt: t => `${t.resourceCost} ${({ pm: 'PM', pv: 'PV', or: 'or' })[t.resourceType] || ''}`.trim(),
      add: t => { t.resourceType = 'pm'; t.resourceCost = 2; }, clear: t => { t.resourceType = 'none'; t.resourceCost = 0; },
      ctl: t => selF('resourceType', t.resourceType || 'pm', [['pm', 'PM'], ['pv', 'PV'], ['or', 'Or']]) + stp('resourceCost', t.resourceCost || 0, { min: 1, max: 99 }) },
    { k: 'lim', grp: 'Contreparties', badge: 'LIM', name: 'Utilisations limitées', help: 'Par combat ou session', good: false,
      on: t => (t.usageScope || 'none') !== 'none', txt: t => `${t.maxUses || 1}/${t.usageScope === 'session' ? 'session' : 'combat'}`,
      add: t => { t.usageScope = 'combat'; t.maxUses = 1; }, clear: t => { t.usageScope = 'none'; t.maxUses = 0; },
      ctl: t => selF('usageScope', t.usageScope || 'combat', [['combat', 'Par combat'], ['session', 'Par session']]) + stp('maxUses', t.maxUses || 1, { min: 1, max: 9 }) },
    { k: 'rch', grp: 'Contreparties', badge: 'RCH', name: 'Recharge', help: 'Tours avant réutilisation', good: false,
      on: t => (t.cooldownRounds || 0) > 0, txt: t => `recharge ${t.cooldownRounds} t`,
      add: t => { t.cooldownRounds = 2; }, clear: t => { t.cooldownRounds = 0; },
      ctl: t => stp('cooldownRounds', t.cooldownRounds || 0, { min: 1, max: 10, suf: ' t' }) },
  ];
  const GROUPS = ['Précision', 'Dégâts', 'Effets', 'Contreparties'];

  const activeMods = t => MODS.filter(m => m.on(t));
  const summary = t => { const p = activeMods(t).map(m => m.txt(t)).filter(Boolean); return p.length ? p.join(' · ') : 'Aucun effet'; };
  const isInvalid = t => [t.extraDamageFormula, t.scalingFormula].some(f => f && !degatsRe.test(String(f).replace(/\s+/g, '')));
  // Tag d'équilibrage : { cls:'ko'|'warn'|'ok', txt } ou null (équilibré).
  function balance(t) {
    if (!String(t.label || '').trim() || isInvalid(t)) return { cls: 'ko', txt: 'À corriger' };
    const on = activeMods(t);
    if (!on.length) return { cls: 'ok', txt: 'Sans effet' };
    const gain = on.filter(m => m.good).length, cout = on.length - gain;
    if (!cout) return { cls: 'warn', txt: 'Sans contrepartie' };
    if (!gain) return { cls: 'warn', txt: 'Que des contreparties' };
    return null;
  }

  // Corps de l'éditeur ouvert (.wf-tq-ed) : en-tête, modificateurs, menu, pied.
  function editorHtml(t, { menuOpen = false } = {}) {
    const active = activeMods(t);
    const hasAreaEffect = (t.blastRadius || 0) > 0 || !!t.conditionId || (t.forcedMovement || 'none') !== 'none';
    const showMiss = (t.trigger || 'hit') === 'hit' && hasAreaEffect;
    const tag = balance(t);
    let h = `<div class="wf-tq-ed">
      <div class="wf-tq-top">
        <input class="wf-tq-emo" value="${esc(t.icon || '🎯')}" maxlength="8" data-wf-fxt="icon" aria-label="Icône">
        <input class="wf-tq-name${String(t.label || '').trim() ? '' : ' bad'}" value="${esc(t.label || '')}" maxlength="60" placeholder="Nom de la technique" data-wf-fxt="label">
        <div class="wf-seg">${[['hit', 'Sur touche'], ['crit', 'Sur critique'], ['miss', 'Sur raté'], ['always', 'Toujours']].map(([v, l]) => `<button type="button" class="${(t.trigger || 'hit') === v ? 'on' : ''}" data-wf-trig="${v}">${l}</button>`).join('')}</div>
      </div>
      <input class="wf-tq-desc" value="${esc(t.description || '')}" maxlength="240" placeholder="Phrase affichée au joueur au moment de choisir" data-wf-fxt="description">
      <div class="wf-mods">`;
    if (!active.length) h += `<div class="wf-empty-fx">Aucun modificateur. « Ajouter un modificateur » pour commencer.</div>`;
    GROUPS.forEach(g => {
      const rows = active.filter(m => m.grp === g);
      if (!rows.length) return;
      h += `<div class="wf-mg">${g}</div>`;
      h += rows.map(m => `<div class="wf-e"><span class="wf-badge ${m.good ? 'good' : 'bad'}">${m.badge}</span><span class="wf-k">${esc(m.name)}<small>${esc(m.help)}</small></span><span class="wf-ctl">${m.ctl(t)}</span><button type="button" class="wf-rm" data-wf-fxrm="${m.k}" title="Retirer">${icon('x')}</button></div>`).join('');
    });
    h += `</div>
      <div class="wf-tq-f">
        <div class="wf-addtq"><button type="button" class="wf-addfx" data-wf-fxmenu>${icon('plus')}Ajouter un modificateur</button>${menuOpen ? fxMenuHtml(t) : ''}</div>
        <span class="wf-sp"></span>
        ${showMiss ? `<label class="wf-mini">Si raté ${selF('missEffectMode', t.missEffectMode || 'none', [['none', 'aucun effet'], ['half', 'effets + ½ dégâts'], ['full', 'effets + dégâts']])}</label>` : ''}
        ${togF('allowWithAbilities', t.allowWithAbilities !== false, 'Sorts & compétences')}
        <button type="button" class="wf-ib" data-wf-duptech title="Dupliquer">${icon('dup')}</button>
        <button type="button" class="wf-ib del" data-wf-deltech title="Supprimer">${icon('trash')}</button>
      </div>`;
    if (tag?.cls === 'warn') h += `<div class="wf-warnl">${tag.txt === 'Sans contrepartie' ? 'Que des gains : ajoute un coût ou un risque pour équilibrer.' : 'Que des contreparties : ajoute un gain, sinon la technique n’a aucun intérêt.'}</div>`;
    h += `</div>`;
    return h;
  }

  function fxMenuHtml(t) {
    return `<div class="wf-fxm">${GROUPS.map(g => {
      const items = MODS.filter(m => m.grp === g);
      return `<h4>${g}</h4>${items.map(m => `<button type="button" data-wf-fxadd="${m.k}" ${m.on(t) ? 'disabled' : ''}><span class="wf-badge ${m.good ? 'good' : 'bad'}">${m.badge}</span><span><b>${esc(m.name)}</b><small>${esc(m.help)}</small></span></button>`).join('')}`;
    }).join('')}</div>`;
  }

  // presets : objet { key: {icon,label,...} } · order : [[key, fallbackLabel]] · normalize : technique
  function presetMenuHtml(presets, normalize, order) {
    return `<div class="wf-fxm pre">${order.map(([k, l]) => {
      const src = presets[k] || {};
      const sum = k === 'blank' ? 'Part de zéro' : summary(normalize({ ...src, id: 'tmp' }));
      return `<button type="button" data-wf-addtech="${k}"><span class="wf-tq-ic">${esc(src.icon || '⚔️')}</span><span><b>${esc(src.label || l)}</b><small>${esc(sum)}</small></span></button>`;
    }).join('')}</div>`;
  }

  // Applique un clic de modificateur (addfx/rmfx/set/tog/step/trig) → true si muté.
  function applyClick(d, t) {
    if (!t) return false;
    if (d.wfFxadd) { const m = MODS.find(x => x.k === d.wfFxadd); if (m && !m.on(t)) { m.add(t); return true; } return false; }
    if (d.wfFxrm) { const m = MODS.find(x => x.k === d.wfFxrm); if (m) { m.clear(t); return true; } return false; }
    if (d.wfFxset) { const [field, val] = d.wfFxset.split(':'); t[field] = val; return true; }
    if (d.wfFxtog) { const f = d.wfFxtog; const cur = f === 'allowWithAbilities' ? t.allowWithAbilities !== false : !!t[f]; t[f] = !cur; return true; }
    if (d.wfTrig) { t.trigger = d.wfTrig; return true; }
    if (d.wfStep) { const field = d.wfStep, step = +d.step || 1, min = +d.min, max = +d.max; let v = (parseInt(t[field], 10) || 0) + (+d.dir) * step; if (d.zero === '1' && v === 0) v += (+d.dir) * step; t[field] = Math.max(min, Math.min(max, v)); return true; }
    return false;
  }
  // Applique une saisie texte (data-wf-fxt) ou un select (data-wf-fx) → nom du champ, ou null.
  function applyField(d, t, value) {
    if (!t) return null;
    if (d.wfFxt != null) { t[d.wfFxt] = value; return d.wfFxt; }
    if (d.wfFx != null) { t[d.wfFx] = value; return d.wfFx; }
    return null;
  }

  return { MODS, GROUPS, activeMods, summary, balance, isInvalid, editorHtml, fxMenuHtml, presetMenuHtml, applyClick, applyField };
}
