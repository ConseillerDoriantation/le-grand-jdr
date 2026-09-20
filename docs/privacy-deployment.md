# Confidentialité et mise en production

## Ce qui est appliqué dans le dépôt

- politique de confidentialité, CGU et page 404 publiques ;
- HTTPS imposé hors environnement local, avec mise à niveau des ressources HTTP par la CSP ;
- consentement séparé entre fonctionnement essentiel et mesure d’audience ;
- aucun chargement Google Analytics avant consentement ;
- validation native et applicative de l’inscription, champ leurre et délai anti-robot ;
- métadonnées SEO/sociales, `robots.txt` et `sitemap.xml` ;
- audit automatisé des liens locaux, textes alternatifs, métadonnées et contrastes essentiels.

## Actions de déploiement à vérifier

1. Remplacer, si besoin, l’URL canonique `https://conseillerdoriantation.github.io/le-grand-jdr/` dans les pages, le sitemap et les métadonnées sociales.
2. Vérifier le nom du responsable et l’adresse de contact dans `privacy.html` et `terms.html`.
3. Pour activer Google Analytics, renseigner l’identifiant `G-XXXXXXXXXX` dans la balise `grimorium-analytics-id` de `index.html`. Sans identifiant, aucune mesure d’audience n’est émise.
4. Dans Google Cloud Console, restreindre la clé Web Firebase aux domaines réellement utilisés et uniquement aux API Firebase nécessaires.
5. Activer Firebase App Check pour une protection serveur supplémentaire contre les clients automatisés. Le champ leurre et le délai du formulaire ne sont qu’une première barrière côté navigateur.
6. Vérifier dans les réglages GitHub Pages que « Enforce HTTPS » est activé. GitHub Pages gère l’en-tête HSTS de la plateforme ; un site statique ne peut pas le définir lui-même.

## À propos de la clé Firebase

La valeur `apiKey` de la configuration Web Firebase identifie le projet mais n’est pas un secret d’authentification. La retirer casserait la connexion et Firestore. Les protections autoritatives restent les règles Firebase, les restrictions de clé par domaine/API et App Check. Aucun jeton serveur, mot de passe ou clé privée n’est attendu dans le front-end.
