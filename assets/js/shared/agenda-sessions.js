export function agendaSessionsFromDoc(doc = null) {
  if (Array.isArray(doc?.sessions)) return doc.sessions.filter(Boolean);
  return doc?.date ? [doc] : [];
}

export function isAgendaSessionUpcoming(session = {}, todayIso = '') {
  const date=String(session?.date || '');
  const today=String(todayIso || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return false;
  // Une date future prime sur un ancien marqueur « jouée » : ce marqueur peut
  // rester attaché lorsqu'une séance historique est reprogrammée.
  if (date>today) return true;
  // Les anciens documents ne stockaient pas la date de clôture. Sur la date du
  // jour, `done` seul peut donc être le reliquat d'un déplacement antérieur.
  return date===today && !(session.done && session.doneAt);
}

export function removeAgendaSession(doc, { questId = '', date = '', slot = '' } = {}) {
  const sessions=agendaSessionsFromDoc(doc);
  const kept=sessions.filter(session=>
    String(session?.questId || '')!==String(questId || '')
    || String(session?.date || '')!==String(date || '')
    || String(session?.slot || '')!==String(slot || '')
  );
  return { sessions:kept, removed:sessions.length-kept.length };
}

export function removeQuestAgendaSessions(doc, questId = '') {
  const target=String(questId || '');
  const sessions=agendaSessionsFromDoc(doc);
  if (!target) return { sessions, removed:0 };
  const kept=sessions.filter(session=>String(session?.questId || '')!==target);
  return { sessions:kept, removed:sessions.length-kept.length };
}

function sessionKey({ questId = '', date = '', slot = '' } = {}) {
  return `${String(questId)}|${String(date)}|${String(slot)}`;
}

export function moveAgendaSession(doc, from = {}, to = {}, { reopen = false } = {}) {
  const sessions=agendaSessionsFromDoc(doc);
  const sourceKey=sessionKey(from);
  const targetKey=sessionKey({ questId:from.questId,date:to.date,slot:to.slot });
  const sourceIndex=sessions.findIndex(session=>sessionKey(session)===sourceKey);
  if (sourceIndex<0) return { sessions,moved:0,duplicate:false,reopened:false };

  const duplicate=sessions.some((session,index)=>index!==sourceIndex && sessionKey(session)===targetKey);
  if (duplicate) return { sessions,moved:0,duplicate:true,reopened:false };

  const previous=sessions[sourceIndex];
  const updated={ ...previous,date:to.date,slot:to.slot };
  const reopened=Boolean(reopen && previous.done);
  if (reopen) {
    updated.done=false;
    delete updated.doneAt;
  }
  const next=[...sessions];
  next[sourceIndex]=updated;
  return { sessions:next,moved:1,duplicate:false,reopened };
}
