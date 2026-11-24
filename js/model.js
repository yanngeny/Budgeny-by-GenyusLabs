// Modèle de données Budgeny : un seul objet JSON, fusionnable ligne par ligne.
export const SCHEMA = 1;

export const BUCKETS = {
  needs: { label: 'Besoins', color: '#1D9E75' },
  wants: { label: 'Envies', color: '#EF9F27' },
  savings: { label: 'Épargne', color: '#7F77DD' },
};
export const BUCKET_KEYS = Object.keys(BUCKETS);

export const SUBS = {
  needs: ['Logement', 'Courses', 'Transport', 'Santé', 'Télécom', 'Assurances et impôts', 'Éducation'],
  wants: ['Restau', 'Loisirs', 'Abonnements', 'Shopping', 'Voyages'],
  savings: ['Livret', 'Investissement', 'Projet'],
};

export const bucketLabel = (b) =>
  BUCKETS[b]?.label ?? ({ income: 'Revenu', ignore: 'Ignoré', '': 'À classer' }[b] ?? 'À classer');
export const bucketColor = (b) => BUCKETS[b]?.color ?? (b === 'income' ? '#639922' : '#888780');

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const BANK_URL = 'https://clients.boursobank.com/operations/generate/';
const OLD_BANK_URL = 'https://clients.boursobank.com/';
export const BANK_PKG = 'com.boursorama.android.clients';

export function defaultSettings() {
  return {
    income: 0,
    targets: { needs: 50, wants: 30, savings: 20 },
    me: 'Moi',
    bankUrl: BANK_URL,
    incomeShiftDay: 0, // 0 = désactivé ; ex. 25 : un revenu reçu à partir du 25 compte pour le mois suivant
    bankMode: 'app', // 'app' : ouvre l'appli BoursoBank (site web en secours), 'web' : le site
    _m: 0,
  };
}

export function emptyData() {
  return {
    _note: 'Base de données Budgeny (JSON). Fusionnée automatiquement : évite de la modifier à la main.',
    app: 'budgeny',
    schema: SCHEMA,
    updatedAt: new Date().toISOString(),
    settings: defaultSettings(),
    rules: [],
    transactions: [],
    deleted: [],
  };
}

export function normalize(d) {
  const base = emptyData();
  if (!d || typeof d !== 'object') return base;
  const s = { ...(d.settings || {}) };
  if (s.bankUrl === OLD_BANK_URL) s.bankUrl = BANK_URL; // ancien défaut -> nouveau lien
  return {
    ...base,
    ...d,
    settings: { ...base.settings, ...s, targets: { ...base.settings.targets, ...(s.targets || {}) } },
    rules: Array.isArray(d.rules) ? d.rules : [],
    transactions: Array.isArray(d.transactions) ? d.transactions : [],
    deleted: Array.isArray(d.deleted) ? d.deleted : [],
  };
}

const byId = (x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);

function mergeRows(a, b, tomb) {
  const m = new Map();
  for (const r of [...a, ...b]) {
    const p = m.get(r.id);
    if (!p || (r._m || 0) > (p._m || 0)) m.set(r.id, r);
  }
  return [...m.values()].filter((r) => (tomb.get(r.id) ?? -1) < (r._m || 0)).sort(byId);
}

// Fusion « dernier écrit gagne » par ligne, suppressions conservées sous forme de tombstones.
export function mergeData(a, b) {
  const tomb = new Map();
  for (const t of [...a.deleted, ...b.deleted]) tomb.set(t.id, Math.max(tomb.get(t.id) ?? -1, t._m || 0));
  const settings = (b.settings._m || 0) > (a.settings._m || 0) ? b.settings : a.settings;
  return {
    ...a,
    settings,
    rules: mergeRows(a.rules, b.rules, tomb),
    transactions: mergeRows(a.transactions, b.transactions, tomb),
    deleted: [...tomb.entries()].map(([id, _m]) => ({ id, _m })).sort(byId),
    updatedAt: a.updatedAt > b.updatedAt ? a.updatedAt : b.updatedAt,
  };
}

export function fingerprint(d) {
  return JSON.stringify([
    d.settings,
    [...d.rules].sort(byId),
    [...d.transactions].sort(byId),
    [...d.deleted].sort(byId),
  ]);
}

export function shiftMonth(k, delta) {
  const [y, m] = k.split('-').map(Number);
  const t = new Date(y, m - 1 + delta, 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
}

// Mois budgétaire d'une opération. Un revenu reçu à partir du jour `incomeShiftDay` (ex. salaire versé le 28)
// compte pour le mois suivant ; `t.period` (AAAA-MM) force un mois précis.
export function periodOf(t, settings) {
  if (t.period) return t.period;
  const month = t.date.slice(0, 7);
  const shift = Number(settings?.incomeShiftDay) || 0;
  if (t.bucket === 'income' && shift > 0 && Number(t.date.slice(8, 10)) >= shift) return shiftMonth(month, 1);
  return month;
}

export function monthsOf(d) {
  return [...new Set(d.transactions.map((t) => periodOf(t, d.settings)))].sort().reverse();
}

export function summarize(d, month) {
  const spent = { needs: 0, wants: 0, savings: 0 };
  let income = 0;
  let todo = 0;
  let count = 0;
  for (const t of d.transactions) {
    if (periodOf(t, d.settings) !== month) continue;
    count++;
    if (t.bucket === 'income') income += t.amount;
    else if (t.bucket in spent) spent[t.bucket] -= t.amount;
    else if (!t.bucket) todo++;
  }
  const base = income > 0 ? income : d.settings.income || 0;
  const pct = {};
  for (const k of BUCKET_KEYS) pct[k] = base > 0 ? Math.round((spent[k] / base) * 100) : 0;
  const total = spent.needs + spent.wants + spent.savings;
  return { income, base, spent, pct, total, rest: base - total, todo, count };
}
