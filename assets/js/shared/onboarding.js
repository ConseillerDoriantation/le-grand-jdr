// ══════════════════════════════════════════════════════════════════════════════
// ONBOARDING — Aide in-app + accueil « première visite »
// ──────────────────────────────────────────────────────────────────────────────
// • Bouton « ❓ » de l'en-tête → openHelpModal() : guide permanent (créer son
//   perso, lancer les dés, suivre la trame…).
// • maybeShowWelcome() : modale d'accueil affichée UNE fois (flag localStorage),
//   appelée au montage de l'app. Réduit le support manuel du MJ pour les nouveaux.
// Aucune dépendance Firestore. Navigation via le module navigation (runtime).
// ══════════════════════════════════════════════════════════════════════════════
import { STATE } from '../core/state.js';
import { registerActions } from '../core/actions.js';
import { openModal, closeModal } from './modal.js';
import { navigate } from '../core/navigation.js';

const WELCOME_FLAG = 'lgjdr-welcomed-v1';

// ── Sections du guide ─────────────────────────────────────────────────────────
// page = clé FEATURE_MAP (data-navigate) ; le bouton ferme la modale puis navigue.
function _step(num, icon, page, title, body, cta) {
  return `
    <div class="ob-step">
      <div class="ob-step-num">${num}</div>
      <div class="ob-step-body">
        <h3>${icon} ${title}</h3>
        <p>${body}</p>
        ${page ? `<button class="btn btn-gold btn-sm ob-go" data-action="helpGo" data-page="${page}">${cta} →</button>` : ''}
      </div>
    </div>`;
}

function _helpSteps() {
  return [
    _step(1, '🧙', 'characters', 'Crée ton personnage',
      'Va dans <b>Personnage</b> puis clique <b>➕ Nouveau</b>. Renseigne nom, caractéristiques, équipement et sorts. Tu peux y revenir à tout moment pour l\'ajuster.',
      'Ouvrir Personnage'),
    _step(2, '🎲', 'vtt', 'Joue & lance les dés',
      'Rejoins la <b>Table (Jouer)</b> : déplace ton pion, et lance les dés via le <b>lanceur 🎲</b> (Désavantage / Normal / Avantage). Tes jets s\'affichent dans le journal, visibles de tous.',
      'Ouvrir la Table'),
    _step(3, '📖', 'story', 'Suis la trame',
      'La <b>Trame</b> raconte l\'aventure en cours. Le <b>Tableau de bord</b> (logo en haut) liste tes quêtes et l\'actualité du groupe.',
      'Ouvrir la Trame'),
    _step(4, '🧭', '', 'Repères',
      '<b>☀️</b> change le thème · ton <b>pseudo / compte</b> est en haut · l\'<b>aventure en cours</b> est indiquée dans la barre latérale. Reviens à ce guide via <b>❓</b> en haut quand tu veux.',
      ''),
  ].join('');
}

export function openHelpModal() {
  const mjNote = STATE.isAdmin ? `
    <div class="ob-mj">
      <b>👑 Côté MJ</b> — tu gères les PNJ, le Bestiaire, la Boutique et la Trame depuis la barre latérale,
      et tu animes la partie depuis la Table (combats, états, butin, brouillard).
    </div>` : '';
  openModal('🧭 Guide de démarrage', `
    <div class="ob-modal">
      <p class="ob-intro">Bienvenue ! Voici l'essentiel pour bien démarrer${STATE.profile?.pseudo ? `, <b>${STATE.profile.pseudo}</b>` : ''}.</p>
      <div class="ob-steps">${_helpSteps()}</div>
      ${mjNote}
      <div class="ob-foot">
        <button class="btn btn-outline btn-sm" data-action="helpClose">Fermer</button>
      </div>
    </div>`);
}

export function maybeShowWelcome() {
  try { if (localStorage.getItem(WELCOME_FLAG)) return; } catch { return; }
  // Marque comme vu immédiatement : la modale ne s'affiche qu'une fois, même si
  // l'utilisateur recharge sans la fermer explicitement.
  try { localStorage.setItem(WELCOME_FLAG, '1'); } catch {}
  // Différé pour laisser la première page se peindre avant d'ouvrir la modale.
  setTimeout(() => {
    if (document.getElementById('auth-screen')?.style.display !== 'none') return; // pas encore dans l'app
    openModal('👋 Bienvenue !', `
      <div class="ob-modal ob-welcome">
        <p class="ob-intro">Première fois ici ? Trois choses pour démarrer :</p>
        <div class="ob-welcome-actions">
          <button class="ob-wa" data-action="helpGo" data-page="characters"><span>🧙</span>Créer mon personnage</button>
          <button class="ob-wa" data-action="helpGo" data-page="vtt"><span>🎲</span>Découvrir la table</button>
          <button class="ob-wa" data-action="helpGo" data-page="story"><span>📖</span>Lire la trame</button>
        </div>
        <div class="ob-foot">
          <button class="btn btn-outline btn-sm" data-action="helpOpenFull">📘 Guide complet</button>
          <div style="flex:1"></div>
          <button class="btn btn-gold btn-sm" data-action="helpClose">C'est parti !</button>
        </div>
      </div>`);
  }, 600);
}

function _helpGo(btn) {
  closeModal();
  const page = btn?.dataset?.page;
  if (page) navigate(page);
}

registerActions({
  'open-help':    () => openHelpModal(),
  helpGo:         (btn) => _helpGo(btn),
  helpOpenFull:   () => openHelpModal(),
  helpClose:      () => closeModal(),
});
