export const lsJson = {
  /**
   * Lit une valeur JSON depuis le localStorage.
   * Retourne la valeur de secours si la cle n'existe pas ou si le JSON stocke est invalide.
   *
   * @template T
   * @param {string} storageKey Cle localStorage a lire.
   * @param {T | null} [fallbackValue=null] Valeur renvoyee si rien de lisible n'est stocke.
   * @returns {T | null}
   */
  get(storageKey, fallbackValue = null) {
    try {
      const storedJson = localStorage.getItem(storageKey);
      return storedJson == null ? fallbackValue : JSON.parse(storedJson);
    } catch {
      return fallbackValue;
    }
  },

  /**
   * Enregistre une valeur sous forme JSON dans le localStorage.
   * Retourne false si la valeur ne peut pas etre stringify ou si le navigateur refuse l'ecriture.
   *
   * @param {string} storageKey Cle localStorage a ecrire.
   * @param {unknown} serializableValue Valeur compatible JSON a stocker.
   * @returns {boolean} true si l'ecriture a reussi, false sinon.
   */
  set(storageKey, serializableValue) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(serializableValue));
      return true;
    } catch {
      return false;
    }
  },
};
