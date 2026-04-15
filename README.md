# Le Grand JDR — refactor modulaire

Refactor structurel de la page monolithique `index.html` en projet statique multi-fichiers, prêt à être versionné sur GitHub.

## Objectif

- sortir le HTML, le CSS et le JavaScript du fichier unique
- découper le code par domaines fonctionnels
- garder une base simple à déployer sans build
- préparer une migration ultérieure vers Vite ou un framework si nécessaire

## Structure

```text
.
├─ index.html
├─ assets/
│  ├─ css/
│  │  ├─ main.css
│  │  ├─ tokens.css
│  │  ├─ base.css
│  │  ├─ auth.css
│  │  ├─ layout.css
│  │  ├─ responsive.css
│  │  └─ features.css
│  └─ js/
│     ├─ config/
│     │  └─ firebase.js
│     ├─ core/
│     │  ├─ state.js
│     │  ├─ init.js
│     │  ├─ auth.js
│     │  ├─ layout.js
│     │  └─ navigation.js
│     ├─ data/
│     │  └─ firestore.js
│     ├─ shared/
│     │  ├─ modal.js
│     │  └─ notifications.js
│     └─ features/
│        ├─ pages.js
│        ├─ characters.js
│        ├─ shop.js
│        ├─ npcs.js
│        ├─ story.js
│        ├─ bastion.js
│        ├─ world.js
│        ├─ achievements.js
│        ├─ collection.js
│        ├─ players.js
│        ├─ tutorial.js
│        ├─ informations.js
│        ├─ recettes.js
│        ├─ bestiary.js
│        └─ photo-cropper.js
├─ docs/
│  └─ architecture.md
└─ .github/
   └─ workflows/
      └─ pages.yml
```

## Lancer localement

Option simple : ouvrir `index.html` via un serveur statique.

Exemples :

```bash
python -m http.server 8080
```

Puis ouvrir `http://localhost:8000`.

## Déploiement GitHub Pages

Le workflow fourni publie le dépôt comme site statique. Il faut seulement activer **GitHub Pages** dans le dépôt et choisir **GitHub Actions** comme source de déploiement.

## Remarques

- Le refactor est volontairement conservateur : la logique métier a été découpée sans réécriture complète.
- Les appels inline (`onclick`) sont encore présents. La prochaine étape saine est de migrer progressivement vers de la délégation d’événements.
- La logique `ADMIN_EMAIL` côté client a été conservée pour ne pas casser le fonctionnement. Elle doit être déplacée vers des règles Firestore et des custom claims.
