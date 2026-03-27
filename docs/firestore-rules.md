# Regles Firestore - Le Grand JDR

## Probleme actuel

Les regles actuelles autorisent tout utilisateur connecte a tout faire.
Un joueur peut modifier les donnees d'un autre, supprimer la boutique, etc.

---

## Regles a deployer

Firebase Console > Firestore > Regles > coller > Publier.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isAdmin() {
      return request.auth != null &&
             request.auth.token.email == "dorianferrer02@gmail.com";
    }
    function isLoggedIn() { return request.auth != null; }

    match /shop/{id}         { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /achievements/{id} { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /collection/{id}   { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /story/{id}        { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /npcs/{id}         { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /players/{id}      { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /bestiaire/{id}    { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /informations/{id} { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /tutorial/{id}     { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /recettes/{id}     { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /world/{id}        { allow read: if isLoggedIn(); allow write: if isAdmin(); }
    match /bastion/{id}      { allow read, write: if isLoggedIn(); }

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
  }
}
```

## Pourquoi c'est suffisant

Meme si STATE.isAdmin est force en console, les regles verifient
request.auth.token.email cote serveur (token Google signe, non falsifiable).
