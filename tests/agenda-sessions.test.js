import test from 'node:test';
import assert from 'node:assert/strict';

import {
  agendaSessionsFromDoc,
  isAgendaSessionUpcoming,
  moveAgendaSession,
  removeAgendaSession,
  removeQuestAgendaSessions,
} from '../assets/js/shared/agenda-sessions.js';

const sessions=[
  { questId:'groupe-a', date:'2026-09-10', slot:'s' },
  { questId:'groupe-a', date:'2026-09-17', slot:'s' },
  { questId:'groupe-b', date:'2026-09-10', slot:'a' },
];

test('une séance précise peut être retirée sans toucher aux autres dates',()=>{
  const result=removeAgendaSession({ sessions },{ questId:'groupe-a',date:'2026-09-10',slot:'s' });
  assert.equal(result.removed,1);
  assert.deepEqual(result.sessions,[sessions[1],sessions[2]]);
});

test('supprimer un groupe retire toutes ses programmations uniquement',()=>{
  const result=removeQuestAgendaSessions({ sessions },'groupe-a');
  assert.equal(result.removed,2);
  assert.deepEqual(result.sessions,[sessions[2]]);
});

test('le format historique à séance unique reste nettoyable',()=>{
  const legacy={ questId:'ancien-groupe',date:'2025-04-02',slot:'m' };
  assert.deepEqual(agendaSessionsFromDoc(legacy),[legacy]);
  assert.deepEqual(removeQuestAgendaSessions(legacy,'ancien-groupe'),{ sessions:[],removed:1 });
});

test('déplacer une séance jouée vers une date à venir la remet à venir',()=>{
  const result=moveAgendaSession({ sessions:[
    { questId:'groupe-a',date:'2026-08-20',slot:'s',done:true,questTitle:'Les Veilleurs' },
  ] },{
    questId:'groupe-a',date:'2026-08-20',slot:'s',
  },{
    date:'2026-09-12',slot:'a',
  },{ reopen:true });

  assert.equal(result.moved,1);
  assert.equal(result.reopened,true);
  assert.deepEqual(result.sessions,[{
    questId:'groupe-a',date:'2026-09-12',slot:'a',done:false,questTitle:'Les Veilleurs',
  }]);
});

test('un déplacement ne réussit pas silencieusement si la séance est introuvable',()=>{
  const result=moveAgendaSession({ sessions },{
    questId:'groupe-inconnu',date:'2026-09-10',slot:'s',
  },{
    date:'2026-09-20',slot:'s',
  },{ reopen:true });

  assert.equal(result.moved,0);
  assert.equal(result.duplicate,false);
  assert.deepEqual(result.sessions,sessions);
});

test('un déplacement refuse de créer un doublon pour le même groupe',()=>{
  const result=moveAgendaSession({ sessions },sessions[0],{
    date:sessions[1].date,slot:sessions[1].slot,
  });

  assert.equal(result.moved,0);
  assert.equal(result.duplicate,true);
  assert.deepEqual(result.sessions,sessions);
});

test('une séance déplacée dans le futur reste à venir malgré un ancien marqueur jouée',()=>{
  assert.equal(isAgendaSessionUpcoming({ date:'2026-09-12',done:true },'2026-08-31'),true);
  assert.equal(isAgendaSessionUpcoming({ date:'2026-08-31',done:true },'2026-08-31'),true);
  assert.equal(isAgendaSessionUpcoming({ date:'2026-08-31',done:true,doneAt:Date.now() },'2026-08-31'),false);
  assert.equal(isAgendaSessionUpcoming({ date:'2026-08-30',done:false },'2026-08-31'),false);
});
