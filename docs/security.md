# Sécurité — Le Grand JDR

App statique (GitHub Pages) + Firestore, sans backend. ~20 joueurs entre potes,
dont certains tenteront de tricher / glitcher. Ce document distingue ce qui est
**réellement protégé** de ce qui relève du **confort client**.

## 1. Modèle de menace

| Surface | Protection | Réalité |
|---|---|---|
| Lecture/écriture des collections | Règles Firestore (serveur) | Vraie protection. Voir `firestore-rules.md`. |
| Inconnu qui s'inscrit (inscription email ouverte) | Données métier scopées par aventure (`inAdventure`) + legacy racine en admin-only | Un compte étranger n'est dans aucune aventure → 0 accès métier ; il ne peut plus lire/vandaliser les collections racine. La confiance n'est **jamais** `isLoggedIn` seul. |
| Promotion MJ par un invité (escalade) | Règles : `isAccountSelfRepair` borné à `accessList`/`players` | **Bloqué.** L'auto-rattachement ne peut plus toucher `admins`/`accessEmails`. Re-grader un MJ = action d'un admin existant. |
| Moisson d'emails / PII | Règles : `users` `get` = soi-même + admin, `list` = admin | Un membre ne lit plus l'email/pseudo des autres comptes. *Effet de bord : un MJ d'aventure non-super ne résout plus les autres membres via `users` (accès par uid intact, dégradation douce).* |
| `STATE.isAdmin` côté client | Aucune | Confort UI. Un joueur peut le forcer en console — sans effet, les règles vérifient `users/{uid}.isAdmin` et les admins d'aventure. |
| Triche sur **ses propres** données (PV, or, inventaire de SA fiche) | Règles : `resource.data.uid == request.auth.uid` | **Possible par design.** Sans backend, on ne peut pas empêcher un joueur d'éditer sa propre fiche via la console. Acceptable entre potes ; seule parade réelle = Cloud Functions. |
| `gmOnly` (jets cachés du MJ) | Règles Firestore (serveur) | **Vraie protection.** Les jets cachés sont écrits dans la sous-collection `vttLogGm` (`allow read, write: if isAdvAdmin`) ; les joueurs ne s'y abonnent pas et ne peuvent pas la lire. Le filtre client subsiste en défense en profondeur. |
| Hauts-faits **secrets** (prophéties / twists) | Règles : sous-collection `achievements_secret` (`isAdvAdmin`) | **Vraie protection** (même schéma que `gmOnly`). Sortis de `achievements` → plus téléchargés par les joueurs. Migration douce auto au 1er chargement MJ de la page. Le filtre client `!a.secret` subsiste en défense en profondeur. |
| Collection : cartes verrouillées / défis masqués | Règles : sous-collection `collection_secret` (`isAdvAdmin`) + projection publique | **Vraie protection.** Le doc public `collection/{id}` ne contient que les champs révélés ; recto/nom/défi des cartes verrouillées ou masquées vivent dans `collection_secret` (MJ-only). Re-projeté à chaque déblocage/masquage. Migration douce auto au 1er chargement MJ. |
| XSS stocké (HTML injecté dans un champ) | Échappement systématique + sanitizer rich-text | Voir §2. |

### Admins et rôles

- Le super-admin est `users/{uid}.isAdmin === true`, vérifié côté règles Firestore.
- Ne pas réintroduire de constante `ADMIN_EMAIL` ni de comparaison `request.auth.token.email == ...`.
- Bootstrap initial : définir `isAdmin: true` manuellement dans Firebase Console sur le document `users/{uid}` du premier admin.
- L'auto-rattachement par email ajoute uniquement le `uid` courant dans `accessList` et `players`; il ne peut pas modifier `admins` ni `accessEmails` (garanti côté règles par `affectedKeys().hasOnly(["accessList", "players"])` dans `isAccountSelfRepair`).

## 2. XSS — règles internes

Tout champ **écrit par un joueur** et affiché à d'autres (nom de perso, classe,
race, titres, bio, notes, présentations…) doit être neutralisé avant injection DOM.

- **Texte simple** → `_esc()` (contenu ET attributs `title=""`, `src=""`, etc.)
  depuis `shared/html.js`. Ex. `title="${_esc(c.nom)}"`.
- **Rich text** (bio, notes) → stocké en HTML, **toujours** rendu via
  `richTextContentHtml()` / `richTextViewHtml()` qui appellent `sanitizeRichTextHtml()`
  (strip `script/style/iframe/object/embed/form`, attributs `on*`, `srcdoc`,
  URLs `javascript:`/`data:text/html`/`vbscript:`). Ne jamais injecter de rich text
  brut sans passer par ces helpers.

Le sanitizer reste « best effort ». Le filet de sécurité réel est la CSP (§3).

## 3. CSP (Content-Security-Policy)

GitHub Pages ne permet pas d'en-têtes HTTP → CSP via `<meta http-equiv>` dans `index.html`.

### CSP stricte — ACTIVE dans `index.html`

Bloque l'exécution de tout `<script>`/handler inline injecté (le vrai rempart anti-XSS).
La CSP minimale (`object-src 'none'; base-uri 'self'`) reste présente en commentaire juste
en dessous comme **fallback de revert instantané**.

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' https://www.gstatic.com 'sha256-pux95tWeUAUbC4qBEFQ0c9EyyXfMrPyeU6SN0nA8yVE=';
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src https://fonts.gstatic.com;
  img-src 'self' data: https:;
  media-src 'self' https:;
  connect-src 'self' https://www.gstatic.com https://*.googleapis.com https://*.firebaseio.com https://*.cloudinary.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://api.github.com wss://*.firebaseio.com;
  frame-src https://*.firebaseapp.com https://accounts.google.com https://apis.google.com;
  object-src 'none';
  base-uri 'self'">
```

Directives non triviales : `media-src 'self' https:` = audio de la musique VTT (assets de
releases GitHub ou URLs libres) ; `https://api.github.com` dans `connect-src` = import de sons
depuis une release GitHub (`vtt-music.js`). Retirer l'une casse la musique VTT.
`https://www.gstatic.com` dans `connect-src` (en plus de `script-src`) = fetch des *source maps*
`.js.map` du SDK Firebase quand la console est ouverte (sans lui : warnings CSP bénins en devtools).

#### Prérequis avant activation (sinon l'app casse)

1. **Importmap Firebase** (`index.html`, head — le `<script type="importmap">`) :
   c'est le seul script *inline* restant (le script de thème est déjà externalisé
   dans `core/theme-boot.js`, chargé en `<script src>` → couvert par `script-src 'self'`).
   L'importmap doit rester inline et précéder les modules ; son hash sha256 est donc
   listé dans `script-src` ci-dessus.
   - Hash courant : `sha256-pux95tWeUAUbC4qBEFQ0c9EyyXfMrPyeU6SN0nA8yVE=`
   - **⚠ À RECALCULER** à chaque modif de l'importmap — y compris un bump de version
     du SDK Firebase (l'URL versionnée fait partie du contenu haché) ou tout changement
     d'espaces/indentation. Commande (⚠ normaliser CRLF→LF : le navigateur hache le
     contenu servi en LF ; sans la normalisation on obtient un faux hash sur Windows) :
   ```sh
   node -e 'const fs=require("fs"),c=require("crypto");const m=fs.readFileSync("index.html","utf8").replace(/\r\n/g,"\n").match(/<script type="importmap">([\s\S]*?)<\/script>/);console.log("sha256-"+c.createHash("sha256").update(m[1]).digest("base64"))'
   ```
2. **Handlers inline générés** — ✅ **FAIT** : migrés vers des écouteurs délégués dans
   `shared/inline-compat.js` (importé au boot par `app.js`). Le HTML porte désormais des
   attributs `data-*` (`data-hov-bg`/`-border`/`-color`/`-opacity` pour le survol,
   `data-enter`/`data-enter-click`/`data-esc` pour Entrée/Échap, `data-img-err` pour le
   fallback d'image, `data-toggle-disable`) au lieu de `on*=`. Plus aucun `on*="…"` inline
   dans le HTML généré → `script-src` sans `'unsafe-inline'` ne casse plus rien.
   (Les `reader.onload`/`img.onload` restants sont des affectations JS, non concernées par la CSP.)

#### Checklist de test (avec Firebase réel, avant commit)

- [ ] Connexion email/mot de passe
- [ ] Connexion Google (popup)
- [ ] Lecture d'une page (Firestore read)
- [ ] Écriture (sauvegarde fiche perso)
- [ ] Upload image Cloudinary
- [ ] Musique VTT : jouer un son (audio externe → `media-src`) + import depuis une release GitHub (→ `api.github.com`)
- [ ] Aucun warning `Refused to ... because it violates CSP` en console

> Pas de mode *Report-Only* via `<meta>` (en-tête HTTP only) → tester sur une branche/preview
> avant de merger sur `main`. Revert : dans `index.html`, recommenter la CSP stricte et
> décommenter la CSP minimale juste en dessous (1 push).
