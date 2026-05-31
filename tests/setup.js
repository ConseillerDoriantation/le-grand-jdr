// char-stats.js expose ses fonctions sur window pour les appels HTML inline.
// En environnement Node, window n'existe pas — on l'aliase sur global.
global.window = global;
