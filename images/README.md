# 🖼️ Images hébergées — gratuit via GitHub Pages

Ce dossier héberge les **images haute qualité** de l'app gratuitement, sans Cloudinary.
GitHub Pages les sert comme un CDN (gratuit, illimité pour cet usage, URLs stables) et
**sur le même domaine que l'app** → aucun souci de qualité ou de CORS.

## Arborescence

```
images/
├── maps/            ← cartes du VTT (fonds de scène)
└── illustrations/   ← illustrations de profil + galerie photos des personnages
```

Tu peux créer des **sous-dossiers** dedans pour t'organiser
(`images/maps/donjons/`, `images/illustrations/pnj/`…). L'URL suit l'arborescence.

## Principe général (3 étapes)

1. **Dépose** ton image dans le bon sous-dossier (drag-drop sur GitHub, ou commit/push).
   Nom simple, **sans espace ni accent** (ex. `donjon-niv1.jpg`).
2. **URL publique** = base du site + chemin du fichier :
   ```
   https://conseillerdoriantation.github.io/le-grand-jdr/images/<sous-dossier>/<fichier>
   ```
3. **Colle l'URL** dans l'app via le bouton **🔗 URL** correspondant.

> ⏳ Après l'upload, attends ~1 min (GitHub Pages se redéploie) avant que l'URL réponde.

Voir les guides dédiés : [maps/README.md](maps/README.md) · [illustrations/README.md](illustrations/README.md)

## Pourquoi ce dossier plutôt que Cloudinary / Drive

- **Cloudinary** : quota gratuit épuisé (bande passante + transformations).
- **Google Drive** : hotlinking d'images peu fiable (URLs changeantes, blocages).
- **Dossier GitHub** : déjà servi par GitHub Pages, gratuit, stable, qualité d'origine.
  Seule contrainte : on ajoute une image par commit (pas de bouton in-app), ce qui reste
  rare (quelques images par campagne).
