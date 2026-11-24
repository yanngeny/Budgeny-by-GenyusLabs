// Modèle de données Budgeny : un seul objet JSON, fusionnable ligne par ligne.
import { labelMatchesKey, ruleKeyOf } from './text.js';

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
  savings: ['Livret', 'Investissement', 'Projet', 'Retrait'],
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
    payKeys: [], // clés de libellé des virements de paye (ex. « link france ») : elles ouvrent chaque mois budgétaire
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
    account: null, // { date, balance, _m } : dernier solde du compte connu (dernier export importé)
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
    account: d.account && d.account.date && Number.isFinite(d.account.balance) ? d.account : null,
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

const newerAccount = (x, y) => (!x ? y ?? null : !y ? x : y.date > x.date || (y.date === x.date && (y._m || 0) > (x._m || 0)) ? y : x);

// Fusion « dernier écrit gagne » par ligne, suppressions conservées sous forme de tombstones.
export function mergeData(a, b) {
  const tomb = new Map();
  for (const t of [...a.deleted, ...b.deleted]) tomb.set(t.id, Math.max(tomb.get(t.id) ?? -1, t._m || 0));
  const settings = (b.settings._m || 0) > (a.settings._m || 0) ? b.settings : a.settings;
  return {
    ...a,
    settings,
    account: newerAccount(a.account, b.account),
    rules: mergeRows(a.rules, b.rules, tomb),
    transactions: mergeRows(a.transactions, b.transactions, tomb),
    deleted: [...tomb.entries()].map(([id, _m]) => ({ id, _m })).sort(byId),
    updatedAt: a.updatedAt > b.updatedAt ? a.updatedAt : b.updatedAt,
  };
}

export function fingerprint(d) {
  return JSON.stringify([
    d.settings,
    d.account ?? null,
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

// --- Mois budgétaire -----------------------------------------------------------------------------
// Mode « paye » : chaque virement de paye (reconnu par son libellé, settings.payKeys) ouvre un mois budgétaire
// qui dure jusqu'à la paye suivante, quelle que soit sa date de versement. Le mois porte le nom du mois où
// tombe la majorité de ses jours. Sans paye connue : ancien comportement (jour de décalage des revenus).
export const cycleLabel = (date) => {
  const t = new Date(date + 'T12:00:00');
  t.setDate(t.getDate() + 15);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
};

const dayDiff = (a, b) => Math.abs(new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 86400000;

export const payKeysOf = (settings) => (Array.isArray(settings?.payKeys) ? settings.payKeys : []);

// Dates de paye : parmi les entrées d'argent au libellé reconnu, on garde la plus grosse, on écarte celles à
// moins de 20 jours (ex. un petit virement du même employeur en cours de mois), et ainsi de suite.
export function paydays(d) {
  const keys = payKeysOf(d.settings);
  if (!keys.length) return [];
  const cands = d.transactions.filter((t) => t.amount > 0 && keys.some((k) => labelMatchesKey(k, t.label))).sort((a, b) => b.amount - a.amount);
  const kept = [];
  for (const t of cands) if (!kept.some((p) => dayDiff(p.date, t.date) < 20)) kept.push(t);
  return kept.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Ancien mode : un revenu reçu à partir du jour `incomeShiftDay` compte pour le mois suivant.
function legacyPeriod(t, settings) {
  const month = t.date.slice(0, 7);
  const shift = Number(settings?.incomeShiftDay) || 0;
  if (t.bucket === 'income' && shift > 0 && Number(t.date.slice(8, 10)) >= shift) return shiftMonth(month, 1);
  return month;
}

// Renvoie une fonction (opération) -> mois « AAAA-MM » ; à appeler une fois par écran puis à réutiliser.
// `t.period` (choix manuel) est toujours prioritaire. Un virement d'épargne fait le jour exact de la paye clôture
// l'ancien mois (tu y verses ce qu'il te restait) : il reste dans le mois précédent.
export function periodFn(d) {
  const pays = paydays(d);
  return (t) => {
    if (t.period) return t.period;
    if (!pays.length) return legacyPeriod(t, d.settings);
    let idx = -1;
    for (let i = 0; i < pays.length && pays[i].date <= t.date; i++) idx = i;
    if (idx >= 0 && t.date === pays[idx].date && t.bucket === 'savings' && t.amount < 0) idx--;
    if (idx < 0) return shiftMonth(cycleLabel(pays[0].date), -1); // avant la 1re paye connue : mois précédent
    return cycleLabel(pays[idx].date);
  };
}

// Suggestion pour « Détecter ma paye » : le plus gros revenu importé.
export function suggestPay(d) {
  const inc = d.transactions.filter((t) => t.amount > 0 && (t.bucket === 'income' || !t.bucket));
  if (!inc.length) return null;
  const top = inc.reduce((a, b) => (b.amount > a.amount ? b : a));
  const key = ruleKeyOf(top.label);
  return key ? { key, label: top.label, amount: top.amount } : null;
}

export const dayBefore = (iso) => {
  const t = new Date(iso + 'T12:00:00');
  t.setDate(t.getDate() - 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

const lastDayOf = (month) => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};

// Solde du compte : dernier solde connu (celui de l'export) + opérations saisies « en attente de la banque ».
export function accountBalance(d) {
  const a = d.account;
  if (!a || !Number.isFinite(a.balance)) return null;
  const pending = d.transactions.filter((t) => t.pending).reduce((s, t) => s + t.amount, 0);
  return { exportBalance: a.balance, date: a.date, pending, total: a.balance + pending };
}

// Rapprochement avec la banque pour un mois budgétaire : relie « Somme des opérations » au solde du compte.
// Le solde de n'importe quel jour passé se déduit du dernier solde connu et des opérations importées
// (solde(J) = dernier solde − opérations après J) : aucun état initial à saisir.
export function reconcile(d, month) {
  const acc = accountBalance(d);
  if (!acc) return null;
  const per = periodFn(d);
  const pays = paydays(d);
  let start;
  let end;
  if (pays.length) {
    const i = pays.findIndex((p) => cycleLabel(p.date) === month);
    if (i < 0) return null;
    start = pays[i].date;
    end = pays[i + 1] ? dayBefore(pays[i + 1].date) : acc.date;
  } else {
    start = `${month}-01`;
    end = lastDayOf(month);
  }
  if (end > acc.date) end = acc.date;
  if (start > end) return null;
  const bank = (t) => t.source === 'import'; // passées sur le compte
  const onAccount = (t) => bank(t) || t.pending; // + en attente chez la banque
  const after = (day) => d.transactions.filter((t) => bank(t) && t.date > day && t.date <= acc.date).reduce((s, t) => s + t.amount, 0);
  const balanceAtEnd = (day) => d.account.balance - after(day);
  const inWin = (t) => t.date >= start && t.date <= end;
  const sum = (f) => d.transactions.filter(f).reduce((s, t) => s + t.amount, 0);
  const opening = balanceAtEnd(dayBefore(start));
  const closing = balanceAtEnd(end);
  const pendingIn = sum((t) => t.pending && inWin(t));
  const elsewhere = sum((t) => onAccount(t) && inWin(t) && per(t) !== month); // ex. virement d'épargne de clôture
  const brought = sum((t) => onAccount(t) && !inWin(t) && per(t) === month); // opérations d'autres dates comptées ici
  const cash = sum((t) => !onAccount(t) && per(t) === month); // hors banque (espèces…)
  const estimated = closing + pendingIn;
  return { start, end, openingDay: dayBefore(start), opening, closing, pendingIn, estimated, elsewhere, brought, cash, sumOps: estimated - opening - elsewhere + brought + cash };
}

export function monthsOf(d) {
  const per = periodFn(d);
  return [...new Set(d.transactions.map(per))].sort().reverse();
}

export const RETRAIT = 'Retrait';

// Une entrée d'argent classée Épargne > Retrait est un retrait d'épargne qui finance une dépense
// (ex. frais de véhicule payés grâce au Livret A). Elle « couvre » des Besoins (par défaut) ou des Envies.
export const isWithdrawal = (t) => t.bucket === 'savings' && t.amount > 0 && t.sub === RETRAIT;

export function summarize(d, month) {
  const per = periodFn(d);
  const spent = { needs: 0, wants: 0, savings: 0 };
  const withdrawn = { needs: 0, wants: 0 };
  let income = 0;
  let todo = 0;
  let todoSum = 0;
  let shiftedIn = 0;
  let count = 0;
  let allSum = 0;
  let lastDate = '';
  const ignored = { count: 0, sum: 0 };
  for (const t of d.transactions) {
    if (per(t) !== month) continue;
    count++;
    allSum += t.amount;
    if (t.date > lastDate) lastDate = t.date;
    if (t.bucket === 'income') {
      income += t.amount;
      if (t.date.slice(0, 7) !== month) shiftedIn += t.amount; // revenu reçu un autre mois, compté ici
    } else if (isWithdrawal(t)) withdrawn[t.covers === 'wants' ? 'wants' : 'needs'] += t.amount;
    else if (t.bucket in spent) spent[t.bucket] -= t.amount;
    else if (t.bucket === 'ignore') {
      ignored.count++;
      ignored.sum += t.amount;
    } else if (!t.bucket) {
      todo++;
      todoSum += t.amount;
    }
  }
  // Une dépense financée par l'épargne ne pèse pas sur le budget courant : on la sépare (plafonnée à la dépense).
  const covered = { needs: Math.min(withdrawn.needs, Math.max(0, spent.needs)), wants: Math.min(withdrawn.wants, Math.max(0, spent.wants)) };
  const net = { needs: spent.needs - covered.needs, wants: spent.wants - covered.wants, savings: spent.savings };
  const base = income > 0 ? income : d.settings.income || 0;
  const pct = {};
  for (const k of BUCKET_KEYS) pct[k] = base > 0 ? Math.round((net[k] / base) * 100) : 0;
  const total = net.needs + net.wants + net.savings;
  const withdrawnTotal = withdrawn.needs + withdrawn.wants;
  const rest = base - total;
  return {
    income,
    shiftedIn,
    base,
    spent,
    net,
    covered,
    withdrawn: withdrawnTotal,
    surplus: withdrawnTotal - covered.needs - covered.wants, // retraits d'épargne au-delà de la dépense financée
    pct,
    total,
    rest,
    todo,
    pending: { count: todo, sum: todoSum }, // opérations à classer : non déduites du reste
    restIfPending: rest + todoSum,
    ignored,
    allSum, // somme brute de toutes les opérations de la période, à comparer avec la banque
    lastDate,
    count,
  };
}
