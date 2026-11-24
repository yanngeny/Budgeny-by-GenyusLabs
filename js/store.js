// État de l'appli : copie de travail en localStorage, la source de vérité partagée est le fichier JSON.
import { emptyData, normalize, uid } from './model.js';

const KEY = 'budgeny.data.v1';
let data = emptyData();
const listeners = new Set();

export function load() {
  try {
    data = normalize(JSON.parse(localStorage.getItem(KEY)));
  } catch {
    data = emptyData();
  }
  return data;
}
export const get = () => data;
export const onChange = (fn) => listeners.add(fn);

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* quota ou mode privé : le fichier synchronisé reste la référence */
  }
}
function emit(origin) {
  for (const fn of listeners) fn(origin);
}
function touch() {
  data.updatedAt = new Date().toISOString();
  persist();
  emit('local');
}

export function replace(d, origin = 'remote') {
  data = d;
  persist();
  emit(origin);
}

export function addMany(list) {
  const now = Date.now();
  for (const t of list) {
    data.transactions.push({
      id: uid(),
      _m: now,
      source: 'manual',
      bucket: '',
      sub: '',
      note: '',
      who: data.settings.me,
      ...t,
    });
  }
  touch();
}
export const addTx = (t) => addMany([t]);

export function updateTx(id, patch) {
  const t = data.transactions.find((x) => x.id === id);
  if (!t) return;
  Object.assign(t, patch, { _m: Date.now() });
  touch();
}

export function deleteTx(id) {
  data.transactions = data.transactions.filter((x) => x.id !== id);
  data.deleted.push({ id, _m: Date.now() });
  touch();
}

export function setSettings(patch) {
  data.settings = { ...data.settings, ...patch, _m: Date.now() };
  touch();
}

export function addRule(r) {
  const ex = data.rules.find((x) => x.k === r.k);
  if (ex) Object.assign(ex, r, { _m: Date.now() });
  else data.rules.push({ id: uid(), _m: Date.now(), sub: '', ...r });
  touch();
}
