# Refonte du craft — système génératif

> Statut : **conception validée**, implémentation en cours (incréments).
> Objectif : rendre le craft **attrayant** tout en restant **simple et accessible**.
> Les tableaux de **traits** et de **templates** ci-dessous sont un **premier jet à ajuster** par le MJ.

## 1. Principe

Le joueur **forge** un objet :

1. choisit un **type** (arme CaC / arme distance / arme magique / armure légère / intermédiaire / lourde / anneau / amulette) ;
2. apporte des **matériaux** dont le **palier** (★/★★/★★★) fixe la **rareté** de l'objet (1★ / 2★ / 3★) ;
3. **choisit 1 trait** dans la **liste du type × palier** (jamais inventé — toujours une liste) ;
4. **nomme** l'objet librement ;
5. **lance le jet** d'Artisanat à la table.
   - **Réussite** → objet créé (stats de base + trait + nom) ;
   - **Échec** → **perte totale des matériaux** (défaut, loot généreux : 2 matériaux par créature). Fraction rendue **réglable** par le MJ (`refundFractionOnFail`, ex. 1/4).

**Aucun objet pré-créé, aucune recette à assigner.** Le craft d'équipement est **ouvert** : y accède qui a les **matériaux** + la **compétence de discipline**. Les **4★/5★ restent des uniques** placés par le MJ (non craftables).

Distinction assumée :
- **Potions / cuisine** = recettes **apprises** (le MJ les attribue) — système actuel inchangé.
- **Équipement** = craft **ouvert** (matériaux + compétence).

## 2. Paliers & matériaux

7 catégories × 3 paliers = **21 matériaux** (l'étoile est dans le nom) :

| Catégorie | ★ | ★★ | ★★★ | Sert à |
|---|---|---|---|---|
| Bestiaux | Matériaux bestiaux ★ | ★★ | ★★★ | Armes CaC physiques |
| Souples | Matériaux souples ★ | ★★ | ★★★ | Armes distance physiques |
| Mystiques | Matériaux mystiques ★ | ★★ | ★★★ | Armes magiques |
| Légers | Matériaux légers ★ | ★★ | ★★★ | Armures légères |
| Tannés | Matériaux tannés ★ | ★★ | ★★★ | Armures intermédiaires |
| Résistants | Matériaux résistants ★ | ★★ | ★★★ | Armures lourdes |
| Précieux | Matériaux précieux ★ | ★★ | ★★★ | Bijoux |

Mapping palier → rareté craftable : **★ → 1★**, **★★ → 2★**, **★★★ → 3★**.

Quantité requise par palier (défaut, éditable) : **1★ = 6**, **2★ = 10**, **3★ = 15**.

> **Création & liaison** : les matériaux sont des objets **créés dans la Boutique** par le MJ (avec leur **rareté**). **Aucun champ spécial à ajouter** : à chaque recette de craft, le MJ **lie le ou les objets-matériaux requis par leur `itemId`** (choix 100 % libre — matériaux bestiaux, cartouches d'encre, peu importe) + une quantité. L'exigence de craft est donc une **liste `[{ itemId, quantite }]`**, pas une catégorie déduite.

## 3. Disciplines & jet

3 disciplines, chacune reliée à **une compétence** des Jets 🎲 (console MJ). Mapping **catégorie → discipline** éditable ; défauts :

| Discipline | Catégories d'objet |
|---|---|
| **Forge** | armes CaC physiques (épée, lance…) · armures **lourdes** |
| **Confection** | armes distance (arc, arbalète) · armures **légères & intermédiaires** |
| **Orfèvre** | armes **magiques** · **bijoux** |

Jet : **d20 + compétence(discipline) vs DD(palier)**.
DD par palier (défaut, éditable) : **1★ = 11**, **2★ = 14**, **3★ = 17**.

## 4. Flux de craft (onglet Recettes du VTT = hub)

1. **Forger un équipement** → choix du **type** (+ **nature** physique/magique pour les armes → détermine la discipline).
2. **Palier** déduit des matériaux disponibles (affiche « requis ×N / possédé ×M »).
3. **Choix d'1 trait** dans la liste `type × palier`.
4. **Nom** libre.
5. **Jet** `d20 + compétence(discipline)` vs `DD(palier)`, **visible dans le log VTT**.
   - Réussite → objet ajouté à l'inventaire ;
   - Échec → **matériaux perdus** (défaut ; `floor(quantité × refundFractionOnFail)`, fraction 0 par défaut).

Modale **compacte** : type · palier · 1 trait · nom · bouton.

## 5. Modèle de données

### `world/craft_config` (MJ)
```
{
  categorieDiscipline: {           // catégorie d'objet → discipline
    armeCaC: 'forge', armeDist: 'confection', armeMagique: 'orfevre',
    armureLegere: 'confection', armureIntermediaire: 'confection', armureLourde: 'forge',
    anneau: 'orfevre', amulette: 'orfevre'
  },
  disciplineCompetence: {          // discipline → id de compétence (Jets 🎲)
    forge: '<competenceId>', confection: '<competenceId>', orfevre: '<competenceId>'
  },
  ddParPalier:          { 1: 11, 2: 14, 3: 17 },   // DD du jet par palier
  quantiteParPalier:    { 1: 6,  2: 10, 3: 15 },   // quantité de matériaux par défaut
  refundFractionOnFail: 0                           // part rendue à l'échec (0 = perte totale)
}
```
*(Plus de `categorieMateriau` : les matériaux sont liés par `itemId` dans chaque recette, cf. §2.)*

### Recette de craft (liée par le MJ)
`{ outputType, tier, requiredMaterials: [{ itemId, quantite }], … }`
- `outputType` → discipline (donc compétence) + pool de traits ;
- `tier` → DD + palier de traits ;
- `requiredMaterials` → objets-matériaux liés par `itemId` (choix libre du MJ).

### Stats de base — **PAS de nouveau doc** : on lit l'existant
Les données de base (type d'arme, dégâts, portée, données fixes des armures, bijoux)
**sont déjà définies dans la console MJ**. Le craft **s'aligne dessus**, il ne les
redéfinit pas :
- **Armes** : défauts par type d'arme (`world/weapon_formats` → `normalizeWeaponDefaults` : `degats`, `degatsStats`, `toucherStat`, `portee`, `mains`, `caBonus`).
- **Armures** : données fixes par type d'armure (config console).
- **Bijoux** : données par type (config console).
→ à câbler en **lecture** ; rien à ré-saisir.

### Traits — **PAS de nouveau doc** : on réutilise les traits existants
Les traits sont **déjà établis dans la Boutique, par rareté d'objet**, et gérés par
le **système d'améliorations/fragments** (`upgrade-settings.js` / Artisan). Le craft
**pioche dans ce pool existant** (par emplacement × rareté), il n'invente rien.
Compat au craft (à appliquer au pool existant) : **arme** isolée · **armure** = pool commun (tête/torse/bottes) · **anneau / amulette** séparés.
⚠️ Codex refond **Artisan / le système de fragments** en ce moment → on lira la source une fois son travail stabilisé.

### Matériaux (inventaire) — `{ matCategorie, tier }`
Objets d'inventaire normaux, tagués catégorie + palier.

### Objet crafté (inventaire)
Objet normal (réutilise `nature`, `traits[]`, stats, rareté) : `rarete = tier`, `nom` saisi, `traits = [traitChoisi]`, `craftedBy` (traçabilité). S'équipe comme n'importe quel objet.

## 6. Templates de base — ⚠️ REMPLACÉ (voir §5)

> **Non normatif.** Le MJ a confirmé que **type, dégâts, portée, données fixes des armures et bijoux sont déjà spécifiés dans la console MJ**. Le craft **lit ces données existantes** (cf. §5) — les tables ci-dessous ne sont qu'une **illustration d'intention** et ne doivent PAS être ressaisies.

> Rappel de convention : sur les **armes**, les stats n'apparaissent qu'à partir de 3★ ; sur les **armures**, le schéma de slots est propre à l'aventure.

### Armes (dégâts de base + slots de stats)
| Type | 1★ | 2★ | 3★ |
|---|---|---|---|
| CaC (épée, lance) | 1d6, portée contact | 1d8, contact | 1d8 + **1 slot stat**, contact |
| Distance (arc, arbalète) | 1d6, portée moyenne | 1d8 | 1d8 + **1 slot stat** |
| Magique | 1d6 (élément au choix) | 1d8 | 1d8 + **1 slot stat** |

### Armures (CA de base + slots de stats)
| Type | 1★ | 2★ | 3★ |
|---|---|---|---|
| Légère | CA +1 | CA +1 | CA +2 |
| Intermédiaire | CA +2 | CA +2 | CA +3 |
| Lourde | CA +3 | CA +3 | CA +4 |

*(slots de stats : à aligner sur ton schéma d'aventure)*

### Bijoux
| Type | 1★ | 2★ | 3★ |
|---|---|---|---|
| Anneau | trait seul (bonus de compétence) | idem | idem |
| Amulette | trait seul (règle à briser) | idem | idem |

## 7. Listes de traits — ⚠️ REMPLACÉ (voir §5)

> **Non normatif.** Les traits sont **déjà établis dans la Boutique, par rareté d'objet** (système de fragments / améliorations). Le craft **pioche dans ce pool existant** (cf. §5) ; le MJ me montrera l'existant pour l'aligner. Les tables ci-dessous ne sont qu'une **illustration d'intention**.

Chaque objet crafté 1★-3★ = **1 trait**, tiré du palier correspondant. Budget : ★ = petit / ★★ = modéré / ★★★ = fort.

### Arme (actions & thèmes de combat) — pool **arme**
| Palier | Traits (exemples) |
|---|---|
| ★ | **Aiguisé** (+1 dégât) · **Allonge** (+1 case de portée) · **Équilibrée** (+1 au toucher) |
| ★★ | **Perce-armure** (ignore 2 CA sur le jet) · **Élan** (+1 dé de dégât si tu as bougé ce tour) · **Entaille** (applique Saignement sur critique) |
| ★★★ | **Balayage** (1/round : touche aussi une 2ᵉ cible adjacente) · **Exécution** (+X dégâts sous 25 % PV cible) · **Brise-garde** (annule la Garde de la cible sur un coup) |

### Armure — Tête (relances / compétences) — pool **armure**
| Palier | Traits |
|---|---|
| ★ | **Concentration** (relance 1 jet de compétence / mission) · **Perception aiguisée** (+1 à une compétence de perception) |
| ★★ | **Sang-froid** (avantage sur une famille de jets choisie) · **Vigilance** (ne peut être pris par surprise) |
| ★★★ | **Seconde chance** (relance 1 jet raté / combat) · **Clairvoyance** (1/combat : voir un danger caché) |

### Armure — Torse (large) — pool **armure**
| Palier | Traits |
|---|---|
| ★ | **Robuste** (+2 PV max) · **Endurant** (avantage contre l'épuisement) |
| ★★ | **Résistance** (résistance mineure à un type de dégâts choisi) · **Rempart** (+1 CA quand tu n'as pas bougé) |
| ★★★ | **Égide** (1/combat : annule les dégâts d'une attaque) · **Immunité ciblée** (immunité à un état choisi) |

### Armure — Bottes (déplacement / réaction) — pool **armure**
| Palier | Traits |
|---|---|
| ★ | **Léger** (+1 case de mouvement) · **Agile** (+1 aux jets d'esquive/acrobatie) |
| ★★ | **Insaisissable** (se dégager sans provoquer d'attaque d'opportunité) · **Tout-terrain** (ignore le terrain difficile) |
| ★★★ | **Repli** (réaction : te déplacer de X cases hors de ton tour) · **Assaut** (1/combat : te déplacer + attaquer en réaction) |

### Bijou — Anneau (bonus plat de compétence) — pool **anneau**
| Palier | Traits |
|---|---|
| ★ | **Anneau mineur** (+1 à une compétence au choix) |
| ★★ | **Anneau majeur** (+2 à une compétence au choix) |
| ★★★ | **Anneau supérieur** (+3 à une compétence au choix) |

### Bijou — Amulette (règles à briser) — pool **amulette**
| Palier | Traits |
|---|---|
| ★ | **Souffle aquatique** (respirer sous l'eau) · **Œil nocturne** (voir dans le noir) |
| ★★ | **Pas de l'ombre** (1/combat : téléportation courte) · **Contre-sort** (1/mission : annuler un sort ennemi) |
| ★★★ | **Hors du temps** (1/jour : agir hors de l'initiative un tour) · **Refus de la mort** (1/aventure : survivre à 1 PV) |

## 8. Recyclage (dans Artisan refondu)

Démonter un objet → rend des **matériaux** (`catégorie` selon le type, `tier` selon la rareté, quantité = fraction du coût de craft). Remplace l'ancien « extraire la recette / le trait ». **À intégrer dans la refonte d'Artisan** (en cours côté Codex → à cadencer).

## 9. Règles Firestore

- Craft = **1 écriture** sur l'inventaire du perso (consomme matériaux + ajoute l'objet).
- `world/craft_config`, `world/craft_traits`, `world/craft_templates` : **lecture** tous, **écriture** MJ.
- Recyclage = 1 écriture inventaire.
→ Ajouter/vérifier les règles pour les docs `world/craft_*`.

## 10. Incréments de code

1. **Moteur pur** `shared/craft-engine.js` (+ tests) : discipline d'un type, DD/quantité par palier, matériau requis, résolution du jet (succès/échec + remboursement), filtrage des traits par emplacement. ✅ *(cet incrément)*
2. **Config MJ** : docs `world/craft_*` + écran de réglage (mapping, DD, quantités).
3. **Flux de craft génératif** dans l'onglet Recettes du VTT (choix type/trait/nom, jet, remboursement, log).
4. **Templates & application des traits** sur l'objet crafté.
5. **Recyclage** dans Artisan (à cadencer avec Codex).

> ⚠️ Codex refond `shop.js` / atelier / éditeur d'objets et Artisan : relire l'état frais avant les incréments 3-5 pour éviter les collisions.
