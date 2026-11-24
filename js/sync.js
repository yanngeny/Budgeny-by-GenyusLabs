// Synchronisation automatique : lecture du fichier, fusion, réécriture si nécessaire.
// Déclenchée (avec un léger délai) après chaque modification, au démarrage et au retour dans l'appli.
import * as store from './store.js';
import * as storage from './storage.js';
import { normalize, mergeData, fingerprint } from './model.js';

export const state = { status: 'off', last: null, error: '', ref: null };
const listeners = new Set();
export const onState = (fn) => listeners.add(fn);
const set = (patch) => {
  Object.assign(state, patch);
  for (const fn of listeners) fn();
};

let timer = null;
let running = false;
let again = false;

export function init() {
  state.ref = storage.loadRef();
  set({ status: state.ref ? 'idle' : 'off' });
  if (state.ref) now();
}

export async function choose(create) {
  const ref = await storage.pick(create);
  storage.saveRef(ref);
  set({ ref, status: 'idle', error: '' });
  await now();
}

export function schedule() {
  if (!state.ref) return;
  clearTimeout(timer);
  timer = setTimeout(now, 1500);
}

export async function now() {
  const ref = state.ref;
  if (!ref) return;
  clearTimeout(timer);
  if (running) {
    again = true;
    return;
  }
  running = true;
  set({ status: 'syncing', error: '' });
  try {
    const txt = await storage.read(ref);
    let remote = null;
    if (txt && txt.trim()) {
      try {
        remote = normalize(JSON.parse(txt));
      } catch {
        // Fichier illisible : on ne l'écrase JAMAIS.
        throw new Error('Le fichier choisi n’est pas un JSON Budgeny valide. Rien n’a été écrasé.');
      }
    }
    const local = store.get();
    const merged = remote ? mergeData(local, remote) : local;
    if (fingerprint(merged) !== fingerprint(local)) store.replace(merged, 'remote');
    if (!remote || fingerprint(merged) !== fingerprint(remote)) {
      await storage.write(ref, JSON.stringify(merged, null, 1));
    }
    set({ status: 'ok', last: Date.now() });
  } catch (e) {
    set({ status: 'error', error: e?.message || String(e) });
  } finally {
    running = false;
    if (again) {
      again = false;
      schedule();
    }
  }
}
