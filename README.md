# Le Grand JDR - Grimorium

App web statique de gestion de campagne JDR multi-joueurs.

Le projet est volontairement simple a deployer : HTML, CSS et JavaScript ES modules, sans build obligatoire. Les donnees vivent dans Firebase Firestore et l'app peut etre servie telle quelle par GitHub Pages ou par un serveur statique local.

## Stack

- `index.html` + `assets/js/app.js` comme points d'entree.
- ES modules natifs, import map Firebase dans `index.html`.
- Firestore via `assets/js/data/firestore.js`.
- CSS globales au boot, CSS de pages en lazy via `FEATURE_CSS`.
- Tests Node uniquement pour les helpers purs (`node --test`).

## Structure active

```text
.
├─ index.html
├─ assets/
│  ├─ css/                  # global + feuilles lazy par domaine
│  └─ js/
│     ├─ app.js             # bootstrap app
│     ├─ config/            # Firebase
│     ├─ core/              # auth, navigation, etat, layout
│     ├─ data/              # couche Firestore centralisee
│     ├─ shared/            # helpers UI + logique metier partagee
│     └─ features/          # pages metier lazy
│        ├─ characters/     # sous-modules fiche personnage
│        ├─ map/            # carte: state, repos, render, UI
│        └─ vtt/            # table virtuelle: coeur + modules peripheriques
├─ docs/
│  ├─ architecture.md
│  ├─ migration-plan.md
│  ├─ security.md
│  ├─ firestore-rules.md
│  ├─ vtt-decomposition.md
│  └─ window-globals-inventory.md
└─ tests/                   # tests node:test sur helpers purs
```

## Lancer localement

```bash
python3 -m http.server 8080
```

Puis ouvrir `http://localhost:8080`.

## Tests et verifications

```bash
npm test
node --check assets/js/core/navigation.js
```

Pour les gros changements JS, lancer aussi `node --check` sur les fichiers touches. Le VTT depend de Konva + Firestore temps reel : les changements qui le touchent necessitent un smoke-test manuel dans le navigateur.

## Dette assumee

- Le refactor monolithe vers modules est avance, mais conserve du legacy de donnees et quelques ponts applicatifs pour préserver le comportement.
- `STATE.isAdmin` cote client n'est qu'un confort UI. La vraie securite doit rester dans les regles Firestore.
- Ne pas supprimer les branches de compat legacy tant que les donnees de production correspondantes n'ont pas ete migrees ou verifiees.
- Le suivi de la reduction `window.*` est dans `docs/window-globals-inventory.md`.
