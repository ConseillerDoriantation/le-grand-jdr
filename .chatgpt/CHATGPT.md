# CHATGPT.md - Guide projet optimise

## Role
Tu assistes sur **Le Grand JDR**, une application web JDR modulaire, statique, sans build obligatoire.
Tu dois produire des reponses et des modifications **ultra actionnables**, ancrees dans le repo, sans sur-ingenierie.

## Objectif principal
Maximiser la qualite des prompts et des sorties sur ce projet :
- comprendre rapidement le contexte
- proposer la solution la plus simple qui marche
- modifier localement plutot que refondre
- rester coherent avec l'architecture et le style existants

## Contexte essentiel
- Application : gestion de campagne JDR
- Utilisateurs : joueurs et administrateurs non techniques
- Frontend : HTML, CSS, JavaScript ES modules
- Data layer : Firebase Firestore
- Hebergement : GitHub Pages
- Projet issu d'un refactor progressif d'un fichier monolithique

## Cartographie du repo
- `index.html` : shell principal
- `assets/js/app.js` : bootstrap principal
- `assets/js/core/` : auth, init, layout, navigation, state
- `assets/js/data/firestore.js` : acces aux donnees
- `assets/js/shared/` : utilitaires transverses
- `assets/js/features/` : logique metier par domaine
- `assets/css/` : tokens, base, layout, responsive, styles metier
- `docs/architecture.md` : architecture actuelle
- `docs/migration-plan.md` : etapes de migration
- `docs/firestore-rules.md` : securite a garder en tete

## Comportement attendu
- Toujours commencer par lire les fichiers lies a la demande.
- S'appuyer sur les conventions existantes avant de proposer autre chose.
- Favoriser les patchs cibles et faciles a relire.
- Expliquer brievement le pourquoi des changements.
- Signaler les tests manuels les plus utiles.

## Contraintes fortes
- Ne pas introduire de build system, framework ou dependance importante sans demande explicite.
- Ne pas proposer une refonte generale si une correction locale suffit.
- Ne pas casser la compatibilite GitHub Pages.
- Ne pas presenter une logique client comme une securite.
- Ne pas multiplier les abstractions si le repo n'en a pas besoin.
- Les refactors pour alleger le code sont encourages seulement s'ils preservent strictement le comportement existant.

## Heuristiques de decision
Choisir en priorite :
1. la solution la plus simple a maintenir
2. la solution la plus compatible avec l'existant
3. la solution la moins risquee visuellement et fonctionnellement
4. la solution la plus lisible pour une future iteration
5. en cas de refactor, la reduction de duplication avant toute reorganisation plus large

## Ce qui compte le plus dans ce projet
1. Clarte pour les utilisateurs
2. Stabilite fonctionnelle
3. Lisibilite du code
4. Iteration rapide
5. Evolution progressive de l'architecture

## Signaux d'architecture a respecter
- Le projet est decoupe par responsabilites.
- `core/` porte les mecanismes transverses.
- `features/` porte le metier.
- `shared/` sert aux briques reutilisables.
- Le refactor reste conservateur : on ameliore sans tout renverser.

## Points techniques a garder en tete
- Il reste du legacy issu de l'ancien fonctionnement.
- Certains `onclick` inline existent encore et doivent plutot evoluer vers `data-action`.
- Les modifications de permissions demandent parfois aussi une mise a jour des regles Firestore.
- Le projet n'est pas pense pour une complexite "enterprise".

## Regles pour bien repondre aux demandes
Si la demande porte sur une correction :
- identifier la cause la plus probable
- verifier le flux de donnees et les listeners
- proposer un correctif limite au vrai point de defaut

Si la demande porte sur une feature :
- chercher d'abord le module deja responsable
- etendre l'existant avant de creer une nouvelle couche
- decouper en petites etapes si la feature est large

Si la demande porte sur l'UI :
- augmenter la clarte avant d'ajouter des effets
- mieux hierarchiser avant d'enrichir
- garder une interface dense mais lisible

Si la demande porte sur un refactor :
- chercher d'abord ce qui peut etre mutualise sans effet de bord
- conserver le comportement observable a l'identique
- preferer plusieurs petits refactors surs a un gros refactor central
- separer clairement refactor et changement fonctionnel
- signaler les zones a retester en priorite

## Format de sortie recommande
Par defaut, reponds avec cette structure courte :

```text
Resume
- besoin reel

Approche
- solution retenue

Fichiers
- zones du repo concernees

Implementation
- patchs ou changements cibles

Verification
- tests manuels utiles
```

## Style ideal
- Bref
- Precis
- Oriente resultat
- Pas de blabla
- Pas de plusieurs strategies equivalentes sans recommandation

## Ce qu'il faut eviter
- refonte d'architecture non demandee
- code inutilement abstrait
- longues explications sans action
- duplication de logique
- promesses de securite qui ne sont vraies que cote client

## Meta-prompt recommande
Utilise ce cadre de raisonnement :

```text
Analyse le contexte reel dans le repo.
Determine le plus petit changement correct.
Respecte la structure actuelle.
Explique brievement la logique.
Donne une sortie exploitable immediatement.
```

## Version courte ultra efficace
Si tu dois resumer au maximum ton comportement :

```text
Lis avant d'agir.
Patch le minimum utile.
Respecte l'architecture actuelle.
Ne sur-complexifie pas.
Donne un resultat directement integrable.
```

## Rappel critique
Quand l'objectif est de reduire le code :
- supprimer la duplication avant de changer la structure
- alleger sans rendre le code plus opaque
- refactorer prudemment pour eviter toute regression
