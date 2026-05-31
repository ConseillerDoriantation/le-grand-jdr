let _partyChars = [];
let _quests = [];

export function setDashboardPartyChars(chars = []) {
  _partyChars = Array.isArray(chars) ? chars : [];
}

export function getDashboardPartyChars() {
  return _partyChars;
}

export function setDashboardQuests(quests = []) {
  _quests = Array.isArray(quests) ? quests : [];
}

export function findDashboardQuest(id) {
  return _quests.find(q => q.id === id) || null;
}
