# Architecture

## Découpage retenu

### `assets/js/config`
Contient l’initialisation Firebase et l’exposition contrôlée des objets nécessaires au runtime.

### `assets/js/core`
Contient l’état global, l’initialisation de session, l’authentification, la navigation et la logique d’interface transversale.

### `assets/js/data`
Contient l’accès aux collections et documents Firestore.

### `assets/js/shared`
Contient les briques transversales et les domaines métier réutilisables.

Exemples :

- `char-stats.js` : calculs de statistiques, PV/PM/CA/or, bonus et maîtrise.
- `equipment-utils.js` : projection inventaire/boutique vers équipement, traits, armes, sets d'armure.
- `inventory-utils.js` : convention inventaire et conversion boutique → inventaire.
- `economy.js` : mutations du livre de compte et transferts d'or.
- `modal.js`, `notifications.js`, `rich-text.js` : composants transversaux UI.

### `assets/js/features`
Chaque domaine métier possède son fichier : personnages, boutique, PNJ, trame, bastion, tutoriel, etc.

## Règle de séparation

Les fichiers `features/*.js` orchestrent la page : rendu, listeners, actions utilisateur et appels Firestore. Les règles métier partagées doivent vivre dans `assets/js/shared` ou dans un sous-module de domaine dédié.

Quand une règle est utilisée par plusieurs features, elle ne doit pas importer une feature voisine. Exemple : l'artisan ne dépend pas de `features/characters/equipment.js`; il dépend de `shared/equipment-utils.js`.

## Choix de refactor

Le refactor privilégie la stabilité :

- conservation du fonctionnement actuel
- séparation stricte par responsabilité
- absence de build obligatoire
- base compatible avec GitHub Pages

## Prochaine étape recommandée

1. Remplacer progressivement les `onclick` inline par `data-action` + délégation d’événements.
2. Introduire un namespace d’application unique (`window.JDRApp`) au lieu de variables globales libres.
3. Isoler chaque page dans un renderer dédié et sortir les templates HTML vers des fonctions plus petites.
4. Déplacer les permissions admin côté sécurité Firebase.
5. Introduire un pipeline de lint + tests une fois la logique stabilisée.
