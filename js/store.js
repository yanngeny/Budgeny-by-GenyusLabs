// État de l'appli : copie de travail en localStorage, la source de vérité partagée est le fichier JSON.
import { emptyData, normalize, uid, RETRAIT, maxStamp } from './model.js';
import { ruleMatches, classText } from './text.js';

const KEY = 'budgeny.data.v1';
let data = emptyData();
let clock = 0;
const listeners = new Set();

// Horodatage des modifications : jamais en arrière par rapport à ce qui est déjà dans les données. Si l'horloge
// d'un autre téléphone est en avance, nos modifications suivantes restent quand même plus récentes que les siennes.
export function stamp() {
  clock = Math.max(Date.now(), clock + 1);
  return clock;
}
const seeClock = () => {
  clock = Math.max(clock, maxStamp(data));
};

export function load() {
  try {
    data = normalize(JSON.parse(localStorage.getItem(KEY)));
  } catch {
    data = emptyData();
  }
  seeClock();
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
  seeClock();
  persist();
  emit(origin);
}

export function addMany(list) {
  const now = stamp();
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
  Object.assign(t, patch, { _m: stamp() });
  touch();
}

export function deleteTx(id) {
  data.transactions = data.transactions.filter((x) => x.id !== id);
  data.deleted.push({ id, _m: stamp() });
  touch();
}

// Rattache plusieurs opérations à un mois budgétaire (AAAA-MM) en une seule écriture.
export function setPeriod(ids, period) {
  const set = new Set(ids);
  const now = stamp();
  let n = 0;
  for (const t of data.transactions) {
    if (set.has(t.id)) {
      t.period = period;
      t._m = now;
      n++;
    }
  }
  if (n) touch();
  return n;
}

// Retient le solde du compte lu dans un export : historique des soldes (contrôle des trous entre exports) et
// dernier solde connu (le plus récent l'emporte).
export function setAccount(anchor) {
  if (!anchor || !Number.isFinite(anchor.balance)) return false;
  const now = stamp();
  const id = 'bal:' + anchor.date;
  const row = data.balances.find((b) => b.id === id);
  if (row) Object.assign(row, { balance: anchor.balance, _m: now });
  else data.balances.push({ id, date: anchor.date, balance: anchor.balance, _m: now });
  if (!data.account || data.account.date <= anchor.date) data.account = { date: anchor.date, balance: anchor.balance, _m: now };
  touch();
  return true;
}

// Chaque réglage modifié garde son propre horodatage (fusion réglage par réglage).
export function setSettings(patch) {
  const now = stamp();
  const f = { ...(data.settings._f || {}) };
  for (const k of Object.keys(patch)) f[k] = now;
  data.settings = { ...data.settings, ...patch, _m: now, _f: f };
  touch();
}

// Crée ou met à jour une règle (catégorie et sous-catégorie), et l'applique aussitôt à toutes les opérations
// encore « à classer » qui lui correspondent (même texte que le classement à l'import : libellé + indices de la
// banque). Renvoie le nombre d'opérations rattrapées.
export function addRule(r) {
  const now = stamp();
  const ex = data.rules.find((x) => x.k === r.k);
  const rule = { sub: '', ...r };
  if (ex) Object.assign(ex, rule, { _m: now });
  else data.rules.push({ id: uid(), _m: now, ...rule });
  let n = 0;
  for (const t of data.transactions) {
    if (!t.bucket && ruleMatches(r.k, classText(t))) {
      t.bucket = rule.bucket;
      t.sub = rule.bucket === 'savings' && t.amount > 0 ? RETRAIT : rule.sub || '';
      t._m = now;
      n++;
    }
  }
  touch();
  return n;
}
