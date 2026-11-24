import * as store from './store.js';
import * as sync from './sync.js';
import { init as initUi } from './ui.js';

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
window.Capacitor?.Plugins?.App?.addListener?.('appStateChange', (s) => {
  if (s.isActive) resume();
});
