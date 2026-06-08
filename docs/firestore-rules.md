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

    function hasEmailAccess(data) {
      return request.auth.token.email != null &&
             data.keys().hasAny(["accessEmails"]) &&
             request.auth.token.email in data.accessEmails;
    }

    function currentProfile() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
    }

    function hasPreviousUid(uid) {
      let profile = currentProfile();
      return profile.keys().hasAny(["previousUids"]) &&
             profile.previousUids.hasAny([uid]) &&
             request.auth.token.email != null &&
             get(/databases/$(database)/documents/users/$(uid)).data.email == request.auth.token.email;
    }

    function hasPreviousUidAccess(data) {
      let profile = currentProfile();
      return profile.keys().hasAny(["previousUids"]) &&
             (
               data.accessList.hasAny(profile.previousUids) ||
               data.players.hasAny(profile.previousUids) ||
               data.admins.hasAny(profile.previousUids)
             );
    }

    function isAccountSelfRepair(before, after) {
      return isLoggedIn() &&
             (hasEmailAccess(before) || hasPreviousUidAccess(before)) &&
             after.diff(before).affectedKeys().hasOnly(["accessList", "players", "admins", "accessEmails"]) &&
             after.accessList.hasAll(before.accessList) &&
             after.accessList.hasAny([request.auth.uid]) &&
             after.players.hasAll(before.players) &&
             after.admins.hasAll(before.admins) &&
             (
               !after.keys().hasAny(["accessEmails"]) ||
               !before.keys().hasAny(["accessEmails"]) ||
               after.accessEmails.hasAll(before.accessEmails)
             );
    }

    function isCharacterUidSelfRepair(before, after) {
      return isLoggedIn() &&
             hasPreviousUid(before.uid) &&
             after.diff(before).affectedKeys().hasOnly(["uid"]) &&
             after.uid == request.auth.uid;
    }

    function inAdventure(adventureId) {
      let adv = get(/databases/$(database)/documents/adventures/$(adventureId)).data;
      return isLoggedIn() &&
        (
          adv.accessList.hasAny([request.auth.uid]) ||
          hasEmailAccess(adv)
        );
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
                       (isLoggedIn() &&
                         (
                           resource.data.accessList.hasAny([request.auth.uid]) ||
                           hasEmailAccess(resource.data)
                         ));
      allow create: if isAdmin();
      allow update: if isAdvAdmin(adventureId) ||
                       isAccountSelfRepair(resource.data, request.resource.data);
      allow delete: if isAdmin();

      // Boutique : MJ écrit tout, les joueurs peuvent uniquement mettre à jour `dispo`
      // (décrément à l'achat, incrément à la revente).
      match /shop/{id} {
        allow read:   if inAdventure(adventureId);
        allow write:  if isAdvAdmin(adventureId);
        allow update: if inAdventure(adventureId)
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['dispo']);
      }
      match /shopCategories/{id}    { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /story/{id}             { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /story_meta/{id}        { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /places/{id}            { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /organizations/{id}     { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /place_types/{id}       { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /map_lieux/{id}         { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /npcs/{id} {
        allow read:  if inAdventure(adventureId);
        allow write: if isAdvAdmin(adventureId);
        // VTT : tout membre de l'aventure peut appliquer dégâts + buffs/états sur
        // une fiche PNJ (cohérent avec les permissions vttTokens et characters).
        allow update: if inAdventure(adventureId)
          && request.resource.data.diff(resource.data)
               .affectedKeys().hasOnly(['hp', 'pvCombatHp', 'buffs', 'conditions']);
      }
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
      match /agenda_session/{id}    { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }

      match /characters/{id} {
        allow read: if inAdventure(adventureId);
        allow create: if inAdventure(adventureId) &&
          (request.resource.data.uid == request.auth.uid || isAdvAdmin(adventureId));
        allow update: if inAdventure(adventureId) && (
          resource.data.uid == request.auth.uid ||
          isAdvAdmin(adventureId) ||
          isCharacterUidSelfRepair(resource.data, request.resource.data) ||
          request.resource.data.diff(resource.data).affectedKeys().hasOnly(['inventaire', 'compte']) ||
          // ── VTT : tout membre de l'aventure peut écrire les champs de combat ──
          //   nécessaire pour que les sorts (DoT, soins, buffs, états) lancés par
          //   un joueur appliquent leur effet sur une fiche cible (PJ allié comme
          //   PJ ennemi). hp et pvCombatHp étaient déjà permis via les tokens ;
          //   on étend aux conditions/buffs pour les sorts à effet persistant.
          request.resource.data.diff(resource.data)
            .affectedKeys().hasOnly(['hp', 'pvCombatHp', 'buffs', 'conditions'])
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
      // Exception : les joueurs peuvent mettre à jour le champ `walls` (ouvrir/fermer portes et fenêtres)
      match /vttPages/{id} {
        allow read:  if inAdventure(adventureId);
        allow write: if isAdvAdmin(adventureId);
        allow update: if inAdventure(adventureId)
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['walls']);
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
      // Un joueur peut déplacer son propre token (col/row/movedThisTurn),
      // l'invoquer / le retirer sur la carte active (pageId/visible),
      // et infliger des dégâts aux ennemis (hp + pvCombatHp pour le suivi de groupe).
      // Il peut aussi appliquer des effets persistants (buffs/conditions) :
      // nécessaire pour que les sorts joueurs (DoT, états, enchantements) soient
      // équivalents aux sorts du MJ. Le coût d'autorisation est minime car ces
      // champs sont déjà manipulables côté MJ et toute action est traçable via vttLog.
      //
      // Délégation de contrôle : un joueur peut autoriser d'autres joueurs à
      // contrôler son token via le champ `controlDelegates` (array d'UIDs).
      // Le propriétaire (ownerId) ou un délégué peuvent alors faire les mêmes
      // updates que le propriétaire direct (déplacement, mvt en combat…).
      // Seul le propriétaire (ou le MJ) peut modifier la liste `controlDelegates`.
      match /vttTokens/{id} {
        allow read: if inAdventure(adventureId);
        allow write: if isAdvAdmin(adventureId);
        // Déplacement + invocation/retrait : propriétaire OU délégué de contrôle.
        // `pageId`/`visible` permettent au joueur d'« Invoquer mon token » (le poser
        // sur la carte active) et de le retirer — cf. _vttInvokeMyToken dans vtt.js.
        allow update: if inAdventure(adventureId)
          && (request.auth.uid == resource.data.ownerId
              || (resource.data.controlDelegates is list
                  && request.auth.uid in resource.data.controlDelegates))
          && request.resource.data.diff(resource.data)
               .affectedKeys().hasOnly(['col', 'row', 'movedThisTurn', 'movedCells', 'bonusMvt', 'pageId', 'visible']);
        // Dégâts / effets : tout membre de l'aventure
        allow update: if inAdventure(adventureId)
          && request.resource.data.diff(resource.data)
               .affectedKeys().hasOnly(['hp', 'pvCombatHp', 'buffs', 'conditions']);
        // Gestion des délégations : SEUL le propriétaire (et le MJ via la règle write ci-dessus)
        allow update: if inAdventure(adventureId)
          && request.auth.uid == resource.data.ownerId
          && request.resource.data.diff(resource.data)
               .affectedKeys().hasOnly(['controlDelegates']);
      }

      // Chat & log de dés : tous les membres de l'aventure peuvent lire et écrire.
      // À durcir : les messages `gmOnly == true` (jets cachés du MJ) ne sont
      // filtrés que côté client — un joueur peut techniquement les lire en
      // s'abonnant directement à la collection. Pour une vraie protection,
      // restreindre la lecture des docs `gmOnly` à `isAdmin(adventureId)`.
      match /vttLog/{id} {
        allow read, write: if inAdventure(adventureId);
      }

      // Pings temps réel : tous les membres lisent et écrivent (1 doc par joueur)
      match /vttPings/{id} {
        allow read, write: if inAdventure(adventureId);
      }

      // Présence app-wide : heartbeat depuis le client (1 doc par joueur, id = uid).
      // Lecture : tous les membres (pour permettre au MJ d'afficher qui est connecté).
      // Écriture : chacun écrit/supprime uniquement sa propre entrée.
      match /presence/{uid} {
        allow read:  if inAdventure(adventureId);
        allow write: if inAdventure(adventureId) && uid == request.auth.uid;
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
