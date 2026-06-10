// ══════════════════════════════════════════════
// CONFIG FIREBASE — identifiant PUBLIC du projet
// ══════════════════════════════════════════════
// ⚠️ Ce n'est PAS un secret : ces valeurs sont livrées à chaque navigateur qui
//    charge l'app. Les masquer ne sert à rien. La vraie protection = règles
//    Firestore (docs/firestore-rules.md) + restriction de la clé API côté
//    console Google Cloud (référents HTTP + APIs autorisées).
//
// Source unique partagée par l'app (config/firebase.js) ET la page autonome
// auth-action.html, pour ne plus dupliquer la config.

export const firebaseConfig = {
  apiKey:            'AIzaSyAetYIzoPMnXwL9TjKLjzKCGyrjwFgBNxU',
  authDomain:        'le-grand-jdr.firebaseapp.com',
  projectId:         'le-grand-jdr',
  storageBucket:     'le-grand-jdr.firebasestorage.app',
  messagingSenderId: '641426541133',
  appId:             '1:641426541133:web:c4c55d900ae6304bcf6a04',
};
