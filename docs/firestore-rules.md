rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isLoggedIn() { return request.auth != null; }

    function currentProfile() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
    }

    function isAdmin() {
      return isLoggedIn() && currentProfile().isAdmin == true;
    }

    function hasEmailAccess(data) {
      return isLoggedIn() &&
             request.auth.token.email != null &&
             data.keys().hasAny(["accessEmails"]) &&
             request.auth.token.email in data.accessEmails;
    }

    function isUserSelfCreate(uid) {
      return isLoggedIn() &&
             uid == request.auth.uid &&
             request.resource.data.keys().hasOnly(["uid", "email", "pseudo", "isAdmin", "createdAt"]) &&
             request.resource.data.uid == request.auth.uid &&
             request.resource.data.email == request.auth.token.email &&
             (
               !request.resource.data.keys().hasAny(["isAdmin"]) ||
               request.resource.data.isAdmin == false
             );
    }

    function isUserSelfUpdate(uid) {
      return isLoggedIn() &&
             uid == request.auth.uid &&
             request.resource.data.diff(resource.data).affectedKeys().hasOnly(["email", "pseudo"]);
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

    // Auto-rattachement de compte : un membre invité (par email ou via un ancien
    // uid) peut UNIQUEMENT s'ajouter lui-même à accessList + players. Le diff est
    // borné à ces deux clés via hasOnly → `admins` et `accessEmails` sont garantis
    // INCHANGÉS. Sans cette borne, un invité email pouvait se promouvoir MJ en
    // s'ajoutant à `admins` (les anciennes clauses hasAll n'empêchaient que le
    // retrait, pas l'ajout). Re-grader un MJ reste réservé à un admin existant.
    function isAccountSelfRepair(before, after) {
      return isLoggedIn() &&
             (hasEmailAccess(before) || hasPreviousUidAccess(before)) &&
             after.diff(before).affectedKeys().hasOnly(["accessList", "players"]) &&
             after.accessList.hasAll(before.accessList) &&
             after.accessList.hasAny([request.auth.uid]) &&
             after.players.hasAll(before.players);
    }

    // Invitation en attente : l'utilisateur est invité (email dans invitedEmails)
    // mais pas encore membre. Sert à autoriser get/list pour afficher l'invitation.
    function hasEmailInvite(data) {
      return isLoggedIn() &&
             request.auth.token.email != null &&
             data.keys().hasAny(["invitedEmails"]) &&
             request.auth.token.email in data.invitedEmails;
    }

    // Accepter une invitation : l'invité déplace SON email invitedEmails→accessEmails
    // et s'ajoute à accessList + players. Le diff est borné à ces 4 clés (admins et
    // le reste INCHANGÉS), et les bornes de taille empêchent d'ajouter des tiers :
    // il ne peut ajouter que son propre email (raw+lower ⇒ +2 max) et son uid (+1).
    function isInviteAccept(before, after) {
      return isLoggedIn() &&
             request.auth.token.email != null &&
             request.auth.token.email in before.invitedEmails &&
             after.diff(before).affectedKeys().hasOnly(["invitedEmails", "accessEmails", "accessList", "players", "memberProfiles"]) &&
             !(request.auth.token.email in after.invitedEmails) &&
             after.accessEmails.hasAll(before.accessEmails) &&
             request.auth.token.email in after.accessEmails &&
             after.accessEmails.size() <= before.accessEmails.size() + 2 &&
             after.accessList.hasAll(before.accessList) &&
             request.auth.uid in after.accessList &&
             after.accessList.size() <= before.accessList.size() + 1 &&
             after.players.hasAll(before.players) &&
             // Profils dénormalisés : l'invité ne touche QUE sa propre entrée (uid).
             after.get("memberProfiles", {}).diff(before.get("memberProfiles", {}))
               .affectedKeys().hasOnly([request.auth.uid]);
    }

    // Self-heal du profil dénormalisé : un membre (dans accessList ou admins) écrit
    // UNIQUEMENT sa propre entrée memberProfiles (pseudo à jour). Permet d'afficher
    // les vrais pseudos côté MJ non super-admin sans lire users/{uid}.
    function isMemberProfileSelfUpdate(before, after) {
      return isLoggedIn() &&
             (before.accessList.hasAny([request.auth.uid]) || before.admins.hasAny([request.auth.uid])) &&
             after.diff(before).affectedKeys().hasOnly(["memberProfiles"]) &&
             after.get("memberProfiles", {}).diff(before.get("memberProfiles", {}))
               .affectedKeys().hasOnly([request.auth.uid]);
    }

    // Refuser une invitation : l'invité retire simplement son email de invitedEmails.
    function isInviteDecline(before, after) {
      return isLoggedIn() &&
             request.auth.token.email != null &&
             request.auth.token.email in before.invitedEmails &&
             after.diff(before).affectedKeys().hasOnly(["invitedEmails"]) &&
             !(request.auth.token.email in after.invitedEmails);
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
          isAdmin() ||
          adv.admins.hasAny([request.auth.uid]) ||
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

    function ownsAdventureCharacter(adventureId, charId) {
      return isLoggedIn() &&
             charId is string &&
             exists(/databases/$(database)/documents/adventures/$(adventureId)/characters/$(charId)) &&
             get(/databases/$(database)/documents/adventures/$(adventureId)/characters/$(charId)).data.uid == request.auth.uid;
    }

    function canCreateAdventurePlayer(adventureId) {
      return isAdvAdmin(adventureId) ||
             (inAdventure(adventureId) &&
              request.resource.data.keys().hasAny(["charId"]) &&
              ownsAdventureCharacter(adventureId, request.resource.data.charId));
    }

    function canUpdateAdventurePlayer(adventureId) {
      return isAdvAdmin(adventureId) ||
             (inAdventure(adventureId) &&
              resource.data.keys().hasAny(["charId"]) &&
              ownsAdventureCharacter(adventureId, resource.data.charId) &&
              request.resource.data.charId == resource.data.charId);
    }

    function canSpendCharacterPmViaToken(adventureId, charId, tokenId) {
      let tokenPath = /databases/$(database)/documents/adventures/$(adventureId)/vttTokens/$(tokenId);
      let token = get(tokenPath).data;
      return isLoggedIn() &&
             tokenId is string &&
             exists(tokenPath) &&
             (
               token.ownerId == request.auth.uid ||
               (token.controlDelegates is list &&
                request.auth.uid in token.controlDelegates)
             ) &&
             (
               token.characterId == charId ||
               (
                 token.summonOwnerId is string &&
                 get(/databases/$(database)/documents/adventures/$(adventureId)/vttTokens/$(token.summonOwnerId)).data.characterId == charId
               )
             );
    }

    // ── Collections LEGACY top-level — ADMIN ONLY ───────────────────────────
    // Toutes les données « métier » sont désormais scopées par aventure
    // (adventures/{advId}/…, cf. _colPath dans data/firestore.js : seules `users`
    // et `adventures` restent globales). Ces collections racine ne sont plus ni
    // lues ni écrites par l'app en fonctionnement normal ; elles ne subsistent que
    // comme SOURCE de la migration (super-admin, runMigration).
    //
    // L'app étant publique et l'inscription email ouverte, la frontière de confiance
    // ne peut PAS être `isLoggedIn` ici : un inconnu qui s'inscrit deviendrait
    // « membre ». On verrouille donc tout le legacy racine en admin-only — un compte
    // étranger n'y a plus aucun accès (ni lecture/PII, ni vandalisme).
    match /shop/{id}              { allow read, write: if isAdmin(); }
    match /shopCategories/{id}    { allow read, write: if isAdmin(); }
    match /story/{id}             { allow read, write: if isAdmin(); }
    match /story_meta/{id}        { allow read, write: if isAdmin(); }
    match /places/{id}            { allow read, write: if isAdmin(); }
    match /organizations/{id}     { allow read, write: if isAdmin(); }
    match /place_types/{id}       { allow read, write: if isAdmin(); }
    match /map_lieux/{id}         { allow read, write: if isAdmin(); }
    match /npcs/{id}              { allow read, write: if isAdmin(); }
    match /npc_affinites/{id}     { allow read, write: if isAdmin(); }
    // Capteur d'erreurs client : tout joueur connecté peut créer/incrémenter un
    // doc d'erreur (id = hash de la signature → collection bornée) ; seul le MJ lit.
    match /errors/{id}            { allow create, update: if isLoggedIn(); allow read, delete: if isAdmin(); }
    match /settings/{id}          { allow read, write: if isAdmin(); }
    match /achievements/{id}      { allow read, write: if isAdmin(); }
    match /achievements_meta/{id} { allow read, write: if isAdmin(); }
    match /bestiary/{id}          { allow read, write: if isAdmin(); }
    match /bestiaire/{id}         { allow read, write: if isAdmin(); }
    match /bestiary_meta/{id}     { allow read, write: if isAdmin(); }
    match /bestiary_tracker/{id}  { allow read, write: if isAdmin(); }
    match /collection/{id}        { allow read, write: if isAdmin(); }
    match /collectionSettings/{id}{ allow read, write: if isAdmin(); }
    match /players/{id}           { allow read, write: if isAdmin(); }
    match /world/{id}             { allow read, write: if isAdmin(); }
    match /informations/{id}      { allow read, write: if isAdmin(); }
    match /tutorial/{id}          { allow read, write: if isAdmin(); }
    match /recettes/{id}          { allow read, write: if isAdmin(); }
    match /recipes/{id}           { allow read, write: if isAdmin(); }
    match /combat_styles/{id}     { allow read, write: if isAdmin(); }
    match /order/{id}             { allow read, write: if isAdmin(); }
    match /bastion/{id}           { allow read, write: if isAdmin(); }
    match /story_histories/{id}   { allow read, write: if isAdmin(); }
    match /characters/{id}        { allow read, write: if isAdmin(); }

    match /users/{uid} {
      // PII (email, pseudo, isAdmin) : lisible seulement par soi-même et le
      // super-admin. Empêche la moisson d'emails (inconnu inscrit → lire les uids
      // ailleurs → get users/{uid}). `list` déjà réservé à l'admin.
      allow get:    if request.auth.uid == uid || isAdmin();
      allow list:   if isAdmin();
      allow create: if isUserSelfCreate(uid) || isAdmin();
      allow update: if isUserSelfUpdate(uid) || isAdmin();
      allow delete: if isAdmin();
    }

    match /adventures/{adventureId} {
      allow list:   if isAdmin() ||
                       (isLoggedIn() &&
                         (
                           resource.data.accessList.hasAny([request.auth.uid]) ||
                           resource.data.admins.hasAny([request.auth.uid]) ||
                           hasEmailAccess(resource.data) ||
                           hasEmailInvite(resource.data)
                         ));
      allow get:    if isAdmin() ||
                       (isLoggedIn() &&
                         (
                           resource.data.accessList.hasAny([request.auth.uid]) ||
                           resource.data.admins.hasAny([request.auth.uid]) ||
                           hasEmailAccess(resource.data) ||
                           hasEmailInvite(resource.data)
                         ));
      // Création ouverte à tout utilisateur connecté : il devient l'unique MJ de sa
      // nouvelle aventure. On force createdBy/admins/accessList = [uid] pour empêcher
      // d'injecter des membres tiers dès la création (invitedEmails reste libre =
      // inviter à la création, protégé par l'acceptation explicite côté invité).
      allow create: if isAdmin() ||
                       (isLoggedIn() &&
                        request.resource.data.createdBy == request.auth.uid &&
                        request.resource.data.admins == [request.auth.uid] &&
                        request.resource.data.accessList == [request.auth.uid]);
      allow update: if isAdvAdmin(adventureId) ||
                       isAccountSelfRepair(resource.data, request.resource.data) ||
                       isInviteAccept(resource.data, request.resource.data) ||
                       isInviteDecline(resource.data, request.resource.data) ||
                       isMemberProfileSelfUpdate(resource.data, request.resource.data);
      allow delete: if isAdvAdmin(adventureId);

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
      // Hauts-faits SECRETS (prophéties / twists) : sous-collection MJ-only.
      // Sortis de `achievements` pour ne PAS être téléchargés par les joueurs
      // (Firestore ne masque pas un doc à la lecture → vrai secret serveur, plus
      // seulement filtré dans l'UI). Révéler = déplacer le doc vers `achievements`.
      match /achievements_secret/{id} { allow read, write: if isAdvAdmin(adventureId); }
      match /bestiary/{id}          { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /bestiary_meta/{id}     { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /bestiary_tracker/{id}  { allow read, write: if inAdventure(adventureId); }
      match /collection/{id}        { allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      match /collectionSettings/{id}{ allow read: if inAdventure(adventureId); allow write: if isAdvAdmin(adventureId); }
      // Contenu SECRET des cartes (recto / nom / défi des cartes non révélées) :
      // sous-collection MJ-only. Le doc public `collection/{id}` ne contient que la
      // projection révélée (cf. _publicProjection dans collection.js) → les joueurs
      // ne téléchargent plus le contenu des cartes verrouillées ou masquées.
      match /collection_secret/{id} { allow read, write: if isAdvAdmin(adventureId); }

      // Présentations joueurs : lecture membres, écriture MJ ou propriétaire du personnage lié.
      match /players/{id} {
        allow read:   if inAdventure(adventureId);
        allow create: if canCreateAdventurePlayer(adventureId);
        allow update: if canUpdateAdventurePlayer(adventureId);
        allow delete: if canUpdateAdventurePlayer(adventureId);
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
      match /availabilities/{uid} {
        allow read: if inAdventure(adventureId);
        allow write: if inAdventure(adventureId) && uid == request.auth.uid;
      }

      match /characters/{id} {
        allow read: if inAdventure(adventureId);
        allow create: if inAdventure(adventureId) &&
          (request.resource.data.uid == request.auth.uid || isAdvAdmin(adventureId));
        allow update: if inAdventure(adventureId) && (
          resource.data.uid == request.auth.uid ||
          isAdvAdmin(adventureId) ||
          isCharacterUidSelfRepair(resource.data, request.resource.data) ||
          request.resource.data.diff(resource.data).affectedKeys().hasOnly(['inventaire', 'compte']) ||
          // Dépense de PM par le propriétaire ou le délégué du token lanceur.
          // `vttControlTokenId` fournit à la règle le token précis à vérifier.
          (
            request.resource.data.diff(resource.data).affectedKeys()
              .hasOnly(['pm', 'vttControlTokenId']) &&
            canSpendCharacterPmViaToken(
              adventureId,
              id,
              request.resource.data.vttControlTokenId
            )
          ) ||
          // ── VTT : tout membre de l'aventure peut écrire les champs de combat ──
          //   nécessaire pour que les sorts (DoT, soins, buffs, états) lancés par
          //   un joueur appliquent leur effet sur une fiche cible (PJ allié comme
          //   PJ ennemi).
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
      // Exception : les joueurs peuvent voter pour un court repos → ils ne
      // modifient QUE le sous-champ `shortRest.vote`, sans toucher `max`/`count`
      // qui restent réservés au MJ.
      match /vtt/{docId} {
        allow read:  if inAdventure(adventureId);
        allow write: if isAdvAdmin(adventureId);
        allow update: if inAdventure(adventureId)
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['shortRest'])
          && request.resource.data.shortRest.diff(resource.data.shortRest).affectedKeys().hasOnly(['vote']);
      }

      // Butin partagé : tous les membres lisent et écrivent
      match /vtt/loot {
        allow read, write: if inAdventure(adventureId);
      }

      // Statistiques d'aventure (compteurs incrémentaux) : tous les membres
      // lisent et incrémentent (un joueur compte ses propres jets/attaques).
      match /stats/{id} {
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
        // Contrôle du token : propriétaire OU délégué de contrôle.
        // `pageId`/`visible` permettent au joueur d'« Invoquer mon token » (le poser
        // sur la carte active). Les compteurs d'action et PM sont écrits lors d'une
        // attaque ou compétence ; sans eux, seul le déplacement délégué fonctionne.
        allow update: if inAdventure(adventureId)
          && (request.auth.uid == resource.data.ownerId
              || (resource.data.controlDelegates is list
                  && request.auth.uid in resource.data.controlDelegates))
          && request.resource.data.diff(resource.data)
               .affectedKeys().hasOnly([
                 'col', 'row', 'movedThisTurn', 'movedCells', 'bonusMvt',
                 'pageId', 'visible',
                 'attackedThisTurn', 'bonusActionThisTurn', 'reactionThisTurn',
                 'pm', 'pmCombat'
               ]);
        // Sorts de déplacement : un joueur peut pousser/attirer une cible
        // sans pouvoir modifier sa page, sa visibilité ou ses compteurs de tour.
        allow update: if inAdventure(adventureId)
          && request.resource.data.diff(resource.data)
               .affectedKeys().hasOnly(['col', 'row']);
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

      // Chat & log de dés PUBLIC : tous les membres de l'aventure lisent et écrivent.
      // Les jets cachés du MJ ne sont PAS ici (voir vttLogGm ci-dessous) → cette
      // collection ne contient aucun secret.
      match /vttLog/{id} {
        allow read, write: if inAdventure(adventureId);
      }

      // Jets cachés du MJ : sous-collection réservée au MJ de l'aventure.
      // Les joueurs n'ont AUCUN accès (lecture ni écriture) → vrais jets secrets,
      // protégés côté serveur et plus seulement filtrés dans l'UI.
      match /vttLogGm/{id} {
        allow read, write: if isAdvAdmin(adventureId);
      }

      // Pings temps réel : tous les membres lisent et écrivent (1 doc par joueur)
      match /vttPings/{id} {
        allow read, write: if inAdventure(adventureId);
      }

      // Visée & sceaux runiques temps réel : 1 doc par joueur (id = uid).
      // Porte les lignes de visée (active/srcId/targets/pageId) ET le champ
      // sigilFire {tokenId, sigil, targets, impColor, pageId, n} qui déclenche le
      // sceau + les impacts chez les autres joueurs au lancement d'un sort.
      // Lecture : tous les membres · Écriture : chacun son propre doc.
      match /vttCasting/{uid} {
        allow read:  if inAdventure(adventureId);
        allow write: if inAdventure(adventureId) && uid == request.auth.uid;
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
      
            // Sons & playlists (musique) : lecture membres, écriture MJ
      match /vttSons/{id} {
        allow read:  if inAdventure(adventureId);
        allow write: if isAdvAdmin(adventureId);
      }
      match /vttPlaylists/{id} {
        allow read:  if inAdventure(adventureId);
        allow write: if isAdvAdmin(adventureId);
      }
    }
  }
}
