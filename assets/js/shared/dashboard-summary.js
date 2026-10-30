// Résumé compact du tableau de bord, écrit par le client MJ et lu par les joueurs.
// Il ne contient que les séances et groupes nécessaires à l'accueil : aucune
// image/base64, aucun haut-fait, aucune collection complète.

import { agendaSessionsFromDoc } from './agenda-sessions.js';

export const DASHBOARD_SUMMARY_VERSION = 2;

const _list = value => (Array.isArray(value) ? value : []);
const _text = value => String(value ?? '').trim();

function _participant(value = {}) {
  const uid = _text(value.uid);
  const charId = _text(value.charId);
  const nom = _text(value.nom || value.name);
  return {
    ...(uid ? { uid } : {}),
    ...(charId ? { charId } : {}),
    ...(nom ? { nom } : {}),
  };
}

export function activeGroupsFromSources(story = [], quests = []) {
  const missions = new Map(_list(story).map(item => [String(item?.id || ''), item]));
  const closed = new Set(
    _list(story)
      .filter(item => item?.statut === 'Terminée' || item?.statut === 'Échouée')
      .map(item => String(item?.id || '')),
  );

  return _list(quests)
    .filter(quest => quest?.id && quest?.missionId
      && (quest.statut || 'active') === 'active'
      && !closed.has(String(quest.missionId)))
    .map(quest => {
      const mission = missions.get(String(quest.missionId)) || {};
      return {
        id: String(quest.id),
        title: _text(quest.titre || quest.nom || 'Groupe'),
        missionId: String(quest.missionId),
        missionTitle: _text(mission.titre || mission.nom || 'Mission'),
        act: _text(quest.acte || mission.acte),
        location: _text(quest.lieu || mission.lieu),
        participants: _list(quest.participants).map(_participant).filter(p => p.uid || p.charId || p.nom),
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title, 'fr'));
}

export function compactDashboardSessions(agenda = null, quests = []) {
  const questById = new Map(_list(quests).map(quest => [String(quest?.id || ''), quest]));
  return agendaSessionsFromDoc(agenda).map((session, index) => {
    const questId = _text(session?.questId);
    const quest = questById.get(questId);
    const participantUids = _list(session?.participantUids).length
      ? _list(session.participantUids)
      : _list(quest?.participants).map(p => p?.uid);
    const date = _text(session?.date);
    const slot = _text(session?.slot);
    return {
      key: _text(session?.key) || `${questId}|${date}|${slot}|${index}`,
      date,
      slot,
      questId,
      participantUids: [...new Set(participantUids.map(_text).filter(Boolean))],
      ...(session?.done ? { done: true } : {}),
      ...(session?.doneAt ? { doneAt: session.doneAt } : {}),
    };
  });
}

// Une source non fournie conserve la partie déjà stockée. Cela permet au
// mainteneur passif de recevoir story, quests et agenda dans n'importe quel ordre.
export function buildDashboardSummary({ story, quests, agenda } = {}, previous = null) {
  const next = { v: DASHBOARD_SUMMARY_VERSION };
  if (Array.isArray(story) && Array.isArray(quests)) {
    next.groups = activeGroupsFromSources(story, quests);
  } else if (Array.isArray(previous?.groups)) {
    next.groups = previous.groups;
  }
  if (agenda !== undefined) {
    next.sessions = compactDashboardSessions(agenda, quests);
  } else if (Array.isArray(previous?.sessions)) {
    next.sessions = previous.sessions;
  }
  return next;
}

export function isUsableSummary(doc) {
  return !!doc
    && doc.v === DASHBOARD_SUMMARY_VERSION
    && Array.isArray(doc.groups)
    && Array.isArray(doc.sessions);
}

// Comparaison de contenu hors métadonnées Firestore afin de ne jamais écrire
// le même résumé deux fois.
export function sameSummary(a, b) {
  const strip = value => {
    if (!value) return null;
    const { updatedAt: _updatedAt, id: _id, ...rest } = value;
    return rest;
  };
  return _stableJson(strip(a)) === _stableJson(strip(b));
}

function _stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(_stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${_stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}
