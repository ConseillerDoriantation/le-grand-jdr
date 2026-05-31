# Sécurité — Le Grand JDR

App statique (GitHub Pages) + Firestore, sans backend. ~20 joueurs entre potes,
dont certains tenteront de tricher / glitcher. Ce document distingue ce qui est
**réellement protégé** de ce qui relève du **confort client**.

## 1. Modèle de menace

| Surface | Protection | Réalité |
|---|---|---|
| Lecture/écriture des collections | Règles Firestore (serveur) | Vraie protection. Voir `firestore-rules.md`. |
| `STATE.isAdmin` côté client | Aucune | Confort UI. Un joueur peut le forcer en console — sans effet, les règles vérifient `request.auth.token.email`. |
| Triche sur **ses propres** données (PV, or, inventaire de SA fiche) | Règles : `resource.data.uid == request.auth.uid` | **Possible par design.** Sans backend, on ne peut pas empêcher un joueur d'éditer sa propre fiche via la console. Acceptable entre potes ; seule parade réelle = Cloud Functions. |
| `gmOnly` (jets cachés du MJ dans `vttLog`) | Filtré **côté client** | Un joueur abonné directement à la collection peut les lire. Pour durcir : restreindre la lecture des docs `gmOnly` au MJ dans les règles. |
| XSS stocké (HTML injecté dans un champ) | Échappement systématique + sanitizer rich-text + CSP | Voir §2. |

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

### Active aujourd'hui (sûre, ne peut rien casser)

```html
<meta http-equiv="Content-Security-Policy" content="object-src 'none'; base-uri 'self'">
```

### CSP complète (à déployer APRÈS test — peut casser l'auth si incomplète)

Bloque l'exécution de tout `<script>`/handler inline injecté (le vrai rempart anti-XSS).

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' https://www.gstatic.com 'sha256-REMPLACER_PAR_LE_HASH_DU_SCRIPT_THEME';
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src https://fonts.gstatic.com;
  img-src 'self' data: https:;
  connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.cloudinary.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com wss://*.firebaseio.com;
  frame-src https://*.firebaseapp.com https://accounts.google.com https://apis.google.com;
  object-src 'none';
  base-uri 'self'">
```

#### Prérequis avant activation (sinon l'app casse)

1. **Script inline du thème** (`index.html`, head) : soit le déplacer dans un fichier
   `.js` chargé en `<script src>`, soit calculer son hash sha256 et le mettre dans
   `script-src` (toute modif d'espace casse le hash) :
   ```sh
   # contenu = exactement ce qu'il y a ENTRE <script> et </script>
   printf '%s' '<contenu>' | openssl dgst -sha256 -binary | openssl base64
   ```
2. **Handlers inline restants** (`onmouseover`/`onclick` générés dans
   `core/navigation.js` `_renderPageError`, `shared/upload-cloudinary.js`, `core/init.js`) :
   les remplacer par des classes CSS / `data-action`, sinon ils sont bloqués.

#### Checklist de test (avec Firebase réel, avant commit)

- [ ] Connexion email/mot de passe
- [ ] Connexion Google (popup)
- [ ] Lecture d'une page (Firestore read)
- [ ] Écriture (sauvegarde fiche perso)
- [ ] Upload image Cloudinary
- [ ] Aucun warning `Refused to ... because it violates CSP` en console

> Astuce rollout : il n'existe pas de mode *Report-Only* via `<meta>` (en-tête HTTP only).
> Tester donc sur une branche/preview avant de merger sur `main`.
