# CLAUDE.md - Guide projet optimise

## Mission
Tu travailles sur **Le Grand JDR**, une application web de gestion de campagne JDR pour plusieurs joueurs.
Ton objectif est de produire des reponses **directement exploitables**, avec un maximum de signal et un minimum de bruit.

Tu dois privilegier :
- la correction rapide et fiable
- les modifications locales plutot que les refontes
- la lisibilite pour des utilisateurs non techniques
- la coherence avec l'existant

## Contexte projet
- Type : application web statique sans build obligatoire
- Stack : HTML, CSS, JavaScript en ES modules
- Donnees : Firebase Firestore
- Hebergement : GitHub Pages
- Philosophie : base artisanale, modulaire, simple a deployer

## Structure repo a connaitre
- `index.html` : point d'entree principal
- `assets/css/` : styles globaux et styles par domaine
- `assets/js/app.js` : point d'entree JavaScript
- `assets/js/config/` : configuration Firebase
- `assets/js/core/` : auth, init, navigation, layout, state
- `assets/js/data/` : acces Firestore
- `assets/js/shared/` : helpers reutilisables
- `assets/js/features/` : modules metier par domaine
- `docs/architecture.md` : architecture cible
- `docs/migration-plan.md` : priorites de migration
- `docs/firestore-rules.md` : contraintes de securite Firestore

## Realite technique du projet
- Le projet vient d'un refactor d'une page monolithique vers une structure modulaire.
- Le fonctionnement actuel est prioritaire sur la purete architecturale.
- Il reste encore du legacy, notamment des `onclick` inline dans certaines features.
- La prochaine evolution saine est la migration vers `data-action` + delegation d'evenements.
- Les droits admin cote client ne sont pas une securite suffisante : ne jamais presenter une logique client comme une vraie protection.

## Regles absolues
- Lire l'existant avant de proposer une modification.
- Modifier le minimum necessaire pour repondre a la demande.
- Reutiliser les helpers, patterns et conventions deja presents.
- Ne pas inventer une architecture "enterprise" pour un besoin simple.
- Ne pas rewriter un fichier entier si un patch local suffit.
- Ne pas casser le mode de deploiement statique.
- Ne pas introduire de build, framework ou dependance lourde sans demande explicite.
- Ne pas deplacer le projet vers un paradigme completement different sans validation claire.
- Les refactors de reduction de code sont souhaites, mais seulement s'ils sont prudents, locaux et sans risque de regression inutile.

## Priorites produit
1. Clarifier l'usage pour les joueurs et admins
2. Preserver la rapidite et la simplicite d'execution
3. Maintenir une interface dense mais lisible
4. Garder le code maintenable sans sur-abstraction
5. Preserver desktop en priorite sans casser mobile

## Philosophie de code
- Preferer des fonctions courtes et explicites.
- Eviter la duplication si un module existant couvre deja le besoin.
- Garder des noms concrets, metier et faciles a suivre.
- Respecter le style du fichier modifie.
- Conserver des imports minimaux.
- Introduire une nouvelle abstraction seulement si elle supprime une vraie complexite recurrente.
- Quand un refactor est demande, chercher a reduire la taille et la repetition du code sans modifier le comportement observable.
- Preferer l'extraction de helpers simples, la mutualisation locale et la suppression de duplication plutot qu'une reorganisation lourde.

## Regles UI / UX
- L'interface doit rester lisible immediatement.
- La densite visuelle est acceptable si la hierarchie reste nette.
- Les actions principales doivent etre evidentes.
- Les cartes, panneaux, modales et fiches doivent garder une structure stable.
- Les couleurs servent d'abord a hierarchiser l'information.
- Ne pas ajouter des effets visuels gratuits qui degradent la clarte.
- Sur un ecran charge, simplifier la lecture avant d'ajouter des elements.

## Workflow attendu
Quand on te demande une modification :
1. Identifier la zone du repo concernee
2. Lire les fichiers lies avant de conclure
3. Verifier s'il existe deja un helper, module ou pattern reutilisable
4. Choisir l'option la plus simple compatible avec l'existant
5. Produire une reponse courte, orientee action
6. Signaler les risques reels et les tests utiles

## Quand la demande concerne un refactor
Priorite absolue : reduire le code sans rien casser.

Tu dois :
1. Identifier ce qui est duplique, verbeux ou evitable
2. Preserver strictement le comportement fonctionnel et visuel
3. Refactorer par petites unites faciles a relire
4. Eviter les changements melanges avec des evolutions de comportement
5. Donner les points de verification les plus exposes a la regression

Tu dois privilegier :
- les extractions de helpers locaux
- la factorisation de logique repetitive
- la clarification des conditions et flux trop verbeux
- la suppression de branches mortes evidentes si elle est sure

Tu dois eviter :
- les refactors transverses difficiles a verifier
- les renommages massifs sans gain net
- les changements simultanes de structure, style et comportement
- toute optimisation "maligne" qui rend le code plus fragile

## Pour les grosses features
Tu dois raisonner ainsi :
1. Quelle structure existe deja ?
2. Qu'est-ce qui bloque vraiment aujourd'hui ?
3. Quelle evolution est compatible avec l'architecture actuelle ?
4. Quel decoupage en petites etapes limite le risque ?
5. Quels tests manuels valident le resultat ?

## Pour les demandes UI / UX
Tu dois optimiser :
- la hierarchie visuelle
- la lisibilite immediate
- le regroupement logique des informations
- la reduction du fouillis
- la clarte des actions primaires

Tu ne dois pas :
- tout redesign sans necessite
- casser l'identite actuelle du projet
- sacrifier la rapidite pour une mise en scene purement decorative

## Pour les demandes de debug
Priorise :
1. reproduction probable
2. lecture du flux de donnees
3. verification des listeners / imports / exports
4. verification des effets de bord DOM
5. verification des acces Firestore et permissions

## Pour les demandes Firestore
- Distinguer clairement ce qui releve du client et ce qui releve des regles serveur.
- Si une "securite" depend de `STATE.isAdmin` ou d'un flag cote client, la presenter comme du confort UI, pas comme une protection.
- Quand tu proposes une modification de donnees ou de permissions, rappeler si une mise a jour des regles Firestore est necessaire.

## Sortie attendue
Sauf demande contraire, repondre dans cet ordre :

```text
Resume
- objectif en une ou deux lignes

Plan
- approche retenue

Fichiers
- fichiers a lire / modifier

Patch
- changements precis et localises

Tests
- verifications utiles

Risques
- seulement les vrais points de vigilance
```

## Style de reponse
- Aller droit au but
- Eviter le blabla
- Donner une recommandation principale, pas trois directions equivalentes
- Mentionner les hypotheses seulement si elles ont un impact
- Si plusieurs options existent, choisir celle qui se maintient le mieux

## Ce qu'il faut eviter
- les refactors massifs non demandes
- les longues dissertations sans patch concret
- les solutions lourdes pour un petit probleme
- les pseudo-bonnes pratiques deconnectees du repo
- la duplication de logique deja presente
- l'oubli des impacts visuels ou des cas limites evidents

## Points de vigilance propres au repo
- `app.js` est le point d'entree central
- la navigation et l'etat global passent par `assets/js/core/`
- les features doivent rester decouplees autant que possible
- la migration hors `onclick` inline n'est pas terminee
- le projet doit rester deployable tel quel sur GitHub Pages

## Prompt de travail recommande
Tu peux suivre mentalement ce canevas :

```text
Lis les fichiers lies a la demande.
Explique tres brievement le probleme reel.
Propose la solution la plus simple compatible avec l'existant.
Fais des patchs localises.
Liste les tests manuels utiles.
Mentionne uniquement les risques concrets.
```

## Memo final
Si tu hesites entre une solution elegante et une solution robuste, choisis la solution robuste.
Si tu hesites entre une grosse reorganisation et un patch net, choisis le patch net.
Si tu hesites entre plusieurs pistes, recommande-en une seule.
Si la demande est un refactor pour alleger le code, reduis d'abord la duplication et la verbosite, jamais la fiabilite.
