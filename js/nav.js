// Navigation « retour » (bouton Android) : d'où revient-on depuis un écran ?
// null = on est à la racine (Accueil) : le retour quitte l'appli.
export function backFrom(tab, hasImport = false) {
  switch (tab) {
    case 'home':
      return null;
    case 'edit':
      return { tab: 'ops' };
    case 'import':
      // Aperçu d'import ouvert : on revient d'abord à l'écran de départ de l'import
      return hasImport ? { tab: 'import', clearImport: true } : { tab: 'ops' };
    default:
      return { tab: 'home' }; // add, detail, ops, hist, set
  }
}
