import * as store from './store.js';
import * as sync from './sync.js';
import { init as initUi, goBack } from './ui.js';

store.load();
sync.init();
store.onChange((origin) => {
  if (origin === 'local') sync.schedule();
});
initUi(document.getElementById('app'));

// Retour dans l'appli : on resynchronise (utile si un autre téléphone a écrit dans le fichier).
const resume = () => sync.now();
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) resume();
});
const AppPlugin = window.Capacitor?.Plugins?.App;
AppPlugin?.addListener?.('appStateChange', (s) => {
  if (s.isActive) resume();
});

// Bouton retour d'Android : remonte d'un écran dans l'appli ; à l'Accueil, il quitte l'appli.
AppPlugin?.addListener?.('backButton', () => {
  if (!goBack()) AppPlugin.exitApp?.();
});
