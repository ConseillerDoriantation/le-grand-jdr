# Plan de migration — Le Grand JDR

## Ce qui a ete fait (Sprint 1)

- firebase.js : window._jdr supprime, exports ES6 nommes
- state.js : STATE centralise, mutateurs types, plus de window.*
- init.js : import direct Firebase, plus de firebase-ready event
- auth.js : imports propres
- navigation.js : delegation d'evenements, pattern data-navigate
- layout.js : imports propres
- firestore.js : couche data isolee
- modal.js / notifications.js : ES module exports
- app.js : point d'entree unique (remplace 15 script defer)
- index.html : 1 script type=module + data-navigate partout

## Sprint 2 — onclick dans les features (prochain)

Migrer les onclick inline generes par les features vers data-action.

```js
// Avant
`<button onclick="editCharInfo()">Modifier</button>`

// Apres
`<button data-action="editCharInfo">Modifier</button>`

// Dans un actions.js centralise :
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  ACTIONS[btn.dataset.action]?.(btn.dataset.id, btn);
});
```

Fichiers prioritaires : characters.js (~30 onclick), shop.js, npcs.js

## Sprint 3 — Formulaires auth sans onclick

```html
<button id="btn-login" type="button">Connexion</button>
```
```js
document.getElementById('btn-login')?.addEventListener('click', doLogin);
```

## Sprint 4 — Router lazy avec import() dynamique — **FAIT**

Implémenté dans `core/navigation.js` via `FEATURE_MAP` (page → `import()` dynamique,
module importé une fois puis caché). CSS également lazy par feature via `FEATURE_CSS`.

```js
// core/navigation.js (extrait)
const FEATURE_MAP = {
  characters: () => import('../features/characters.js'),
  shop:       () => import('../features/shop.js'),
  // …
};
```

## Issues GitHub recommandees

- Issue 1 : Sprint 2 - data-action dans characters.js
- Issue 2 : Sprint 2 - data-action dans les autres features
- Issue 3 : Sprint 3 - formulaires auth sans onclick
- Issue 4 : Sprint 4 - router lazy
- Issue 5 : Deployer les regles Firestore (docs/firestore-rules.md)
