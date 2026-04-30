# Regles Firestore - Le Grand JDR

Firebase Console > Firestore > Regles > coller ci-dessous > Publier.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isAdmin() {
      return request.auth != null &&
             request.auth.token.email == "dorianferrer02@gmail.com";
    }
    function isLoggedIn() { return request.auth != null; }

    function inAdventure(adventureId) {
      return isLoggedIn() &&
        get(/databases/$(database)/documents/adventures/$(adventureId))
          .data.accessList.hasAny([request.auth.uid]);
    }

    function isAdvAdmin(adventureId) {
      return isAdmin() ||
        (isLoggedIn() &&
          get(/databases/$(database)/documents/adventures/$(adventureId))
            .data.admins.hasAny([request.auth.uid]));
    }

    match /shop/{id}              { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /shopCategories/{id}    { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /story/{id}             { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /story_meta/{id}        { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /places/{id}            { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /organizations/{id}     { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /place_types/{id}       { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /map_lieux/{id}         { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /npcs/{id}              { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /npc_affinites/{id}     { allow read, write: if isLoggedIn(); }
    match /settings/{id}          { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /achievements/{id}      { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /achievements_meta/{id} { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /bestiary/{id}          { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /bestiaire/{id}         { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /bestiary_meta/{id}     { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /bestiary_tracker/{id}  { allow read, write: if isLoggedIn(); }
    match /collection/{id}        { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /collectionSettings/{id}{ allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /players/{id} {
      allow read:   if isLoggedIn();
      allow create: if isLoggedIn();
      allow update: if isLoggedIn();
      allow delete: if isAdmin();
    }
    match /world/{id}             { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /informations/{id}      { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /tutorial/{id}          { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /recettes/{id}          { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /recipes/{id}           { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /combat_styles/{id}     { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /order/{id}             { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /bastion/{id}           { allow read, write: if isLoggedIn(); }
    match /story_histories/{id}   { allow read: if isLoggedIn(); allow write: if isAdmin(); }

    match /characters/{id} {
      allow read: if isLoggedIn();
      allow create: if isLoggedIn() && request.resource.data.uid == request.auth.uid;
      allow update, delete: if isLoggedIn() &&
        (resource.data.uid == request.auth.uid || isAdmin());
    }

    match /users/{uid} {
      allow read:   if isLoggedIn();
      allow create: if isLoggedIn() && uid == request.auth.uid;
      allow update: if isLoggedIn() && (uid == request.auth.uid || isAdmin());
      allow delete: if isAdmin();
    }

    match /adventures/{adventureId} {
      allow list:   if isLoggedIn();
      allow get:    if isAdmin() ||
                       (isLoggedIn() && resource.data.accessList.hasAny([request.auth.uid]));
      allow create: if isAdmin();
      allow update: if isAdvAdmin(adventureId);
      allow delete: if isAdmin();

      match /shop/{id}              { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /shopCategories/{id}    { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /story/{id}             { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /story_meta/{id}        { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /places/{id}            { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /organizations/{id}     { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /place_types/{id}       { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /map_lieux/{id}         { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /npcs/{id}              { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /npc_affinites/{id}     { allow read, write: if inAdventure(adventureId); }
      match /settings/{id}          { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /achievements/{id}      { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /achievements_meta/{id} { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /bestiary/{id}          { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /bestiary_meta/{id}     { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /bestiary_tracker/{id}  { allow read, write: if inAdventure(adventureId); }
      match /collection/{id}        { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /collectionSettings/{id}{ allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }

      // Présentations joueurs : tout membre de l'aventure peut lire et écrire sa propre fiche
      match /players/{id} {
        allow read, write: if inAdventure(adventureId);
      }

      match /world/{id}             { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /informations/{id}      { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /tutorial/{id}          { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /recettes/{id}          { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /recipes/{id}           { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /combat_styles/{id}     { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /order/{id}             { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /bastion/{id}           { allow read, write: if inAdventure(adventureId); }
      match /story_histories/{id}   { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }

      match /characters/{id} {
        allow read: if inAdventure(adventureId);
        allow create: if inAdventure(adventureId) &&
          (request.resource.data.uid == request.auth.uid || isAdvAdmin(adventureId));
        allow update: if inAdventure(adventureId) && (
          resource.data.uid == request.auth.uid ||
          isAdvAdmin(adventureId) ||
          request.resource.data.diff(resource.data).affectedKeys().hasOnly(['inventaire', 'compte'])
        );
        allow delete: if inAdventure(adventureId) &&
          (resource.data.uid == request.auth.uid || isAdvAdmin(adventureId));
      }

      // Quêtes : lecture tous, création/suppression MJ, mise à jour participants par les joueurs
      match /quests/{id} {
        allow read:           if inAdventure(adventureId);
        allow create, delete: if isAdvAdmin(adventureId);
        allow update:         if isAdvAdmin(adventureId) ||
          (inAdventure(adventureId) &&
           request.resource.data.diff(resource.data)
             .affectedKeys().hasOnly(['participants']));
      }

      // ── VTT ──────────────────────────────────────────────────────
      // Session (page active, état combat) : lecture tous, écriture MJ
      match /vtt/{docId} {
        allow read:  if inAdventure(adventureId);
        allow write: if isAdvAdmin(adventureId);
      }

      // Butin partagé : tous les membres lisent et écrivent
      match /vtt/loot {
        allow read, write: if inAdventure(adventureId);
      }

      // Pages (cartes) : lecture tous, écriture MJ
      match /vttPages/{id} {
        allow read:  if inAdventure(adventureId);
        allow write: if isAdvAdmin(adventureId);
      }

      // Annotations (dessins) : tous créent, chacun modifie/supprime les siennes, MJ gère tout
      match /vttAnnotations/{id} {
        allow read:   if inAdventure(adventureId);
        allow create: if inAdventure(adventureId);
        allow update: if isAdvAdmin(adventureId) ||
                         (inAdventure(adventureId) && resource.data.createdBy == request.auth.uid);
        allow delete: if isAdvAdmin(adventureId) ||
                         (inAdventure(adventureId) && resource.data.createdBy == request.auth.uid);
      }

      // Tokens : MJ écrit tout.
      // Un joueur peut uniquement déplacer son propre token (col/row/movedThisTurn).
      match /vttTokens/{id} {
        allow read: if inAdventure(adventureId);
        allow write: if isAdvAdmin(adventureId);
        allow update: if inAdventure(adventureId)
          && request.auth.uid == resource.data.ownerId
          && request.resource.data.diff(resource.data)
               .affectedKeys().hasOnly(['col', 'row', 'movedThisTurn']);
      }

      // Chat & log de dés : tous les membres de l'aventure peuvent lire et écrire
      match /vttLog/{id} {
        allow read, write: if inAdventure(adventureId);
      }

      // Pings temps réel : tous les membres lisent et écrivent (1 doc par joueur)
      match /vttPings/{id} {
        allow read, write: if inAdventure(adventureId);
      }

      // Réactions émotes : 1 doc par joueur (setDoc écrase)
      // isAdvAdmin inclus car l'admin peut ne pas être dans accessList
      match /vttEmoteReactions/{id} {
        allow read, write: if inAdventure(adventureId) || isAdvAdmin(adventureId);
      }
    }
  }
}
```

## Pourquoi c'est suffisant

Meme si STATE.isAdmin est force en console, les regles verifient
request.auth.token.email cote serveur (token Google signe, non falsifiable).
