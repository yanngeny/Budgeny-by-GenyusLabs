// Modèle de données Budgeny : un seul objet JSON, fusionnable ligne par ligne.
import { labelMatchesKey, ruleKeyOf } from './text.js';

export const SCHEMA = 2;

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

const isoOf = (t) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
export const todayISO = () => isoOf(new Date());

export const addDays = (iso, n) => {
  const t = new Date(iso + 'T12:00:00');
  t.setDate(t.getDate() + n);
  return isoOf(t);
};
export const dayBefore = (iso) => addDays(iso, -1);

const lastDayOf = (month) => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
};

// Calculs en centimes entiers : pas d'erreurs d'arrondi qui s'accumulent (0,1 + 0,2…).
export const cents = (x) => Math.round((Number(x) || 0) * 100);
const eurOf = (c) => c / 100;
export const sumAmounts = (list) => eurOf(list.reduce((s, t) => s + cents(t.amount), 0));

export const BANK_URL = 'https://clients.boursobank.com/operations/generate/';
const OLD_BANK_URL = 'https://clients.boursobank.com/';
export const BANK_PKG = 'com.boursorama.android.clients';

export function defaultSettings() {
  return {
    income: 0, // revenu mensuel attendu : sert tant que la paye du mois n'est pas arrivée
    targets: { needs: 50, wants: 30, savings: 20 },
    me: 'Moi',
    bankUrl: BANK_URL,
    payKeys: [], // clés de libellé des virements de paye (ex. « link france ») : elles ouvrent chaque mois budgétaire
    incomeShiftDay: 0, // 0 = désactivé ; ex. 25 : un revenu reçu à partir du 25 compte pour le mois suivant
    closeSavingsOnPayday: true, // virement d'épargne le jour de la paye : clôture le mois précédent
    account: '', // numéro du compte suivi quand l'export en contient plusieurs
    bankMode: 'app', // 'app' : ouvre l'appli BoursoBank (site web en secours), 'web' : le site
    _m: 0,
    _f: {}, // horodatage de chaque réglage : la fusion se fait réglage par réglage
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
    balances: [], // { id, date, balance, _m } : solde du compte en fin de journée, lu dans chaque export
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
    schema: SCHEMA,
    settings: { ...base.settings, ...s, targets: { ...base.settings.targets, ...(s.targets || {}) }, _f: { ...(s._f || {}) } },
    account: d.account && d.account.date && Number.isFinite(d.account.balance) ? d.account : null,
    balances: Array.isArray(d.balances) ? d.balances.filter((b) => b && b.id && b.date && Number.isFinite(b.balance)) : [],
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

// Le même export importé sur deux téléphones avant la synchro donne deux lignes (id différents) pour la même
// opération bancaire : on n'en garde qu'une (la plus récemment modifiée), l'autre devient une suppression.
function dedupeByHash(rows, tomb) {
  const best = new Map();
  for (const r of rows) {
    if (!r.hash) continue;
    const p = best.get(r.hash);
    if (!p || (r._m || 0) > (p._m || 0) || ((r._m || 0) === (p._m || 0) && r.id < p.id)) best.set(r.hash, r);
  }
  return rows.filter((r) => {
    if (!r.hash || best.get(r.hash) === r) return true;
    tomb.set(r.id, Math.max(tomb.get(r.id) ?? -1, r._m || 0));
    return false;
  });
}

// Réglages fusionnés un par un : deux téléphones qui changent deux réglages différents gardent les deux.
function mergeSettings(a, b) {
  const fa = a._f || {};
  const fb = b._f || {};
  const out = { ...a, _f: { ...fa } };
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k === '_m' || k === '_f') continue;
    // Réglage jamais modifié de ce côté : 0 (valeur par défaut). Ancien fichier sans horodatage par réglage :
    // l'horodatage global de ses réglages.
    const ta = fa[k] ?? (Object.keys(fa).length ? 0 : a._m || 0);
    const tb = fb[k] ?? (Object.keys(fb).length ? 0 : b._m || 0);
    if (tb > ta || !(k in a)) {
      out[k] = b[k];
      out._f[k] = tb;
    } else out._f[k] = ta;
  }
  out._m = Math.max(a._m || 0, b._m || 0);
  return out;
}

const newerAccount = (x, y) => (!x ? y ?? null : !y ? x : y.date > x.date || (y.date === x.date && (y._m || 0) > (x._m || 0)) ? y : x);

export const YEAR_MS = 365 * 86400000;

// Plus grand horodatage connu : sert d'horloge commune (voir store.stamp) et de repère pour purger.
export function maxStamp(d) {
  let m = d.settings?._m || 0;
  for (const v of Object.values(d.settings?._f || {})) m = Math.max(m, v || 0);
  for (const list of [d.rules, d.transactions, d.deleted, d.balances]) for (const r of list || []) m = Math.max(m, r._m || 0);
  return Math.max(m, d.account?._m || 0);
}

// Fusion « dernier écrit gagne » par ligne, suppressions conservées sous forme de tombstones
// (purgées au bout d'un an d'activité pour que le fichier ne grossisse pas sans fin).
export function mergeData(a, b) {
  const tomb = new Map();
  for (const t of [...a.deleted, ...b.deleted]) tomb.set(t.id, Math.max(tomb.get(t.id) ?? -1, t._m || 0));
  const transactions = dedupeByHash(mergeRows(a.transactions, b.transactions, tomb), tomb);
  const merged = {
    ...a,
    settings: mergeSettings(a.settings, b.settings),
    account: newerAccount(a.account, b.account),
    balances: mergeRows(a.balances || [], b.balances || [], tomb),
    rules: mergeRows(a.rules, b.rules, tomb),
    transactions,
    updatedAt: a.updatedAt > b.updatedAt ? a.updatedAt : b.updatedAt,
  };
  const cutoff = Math.max(maxStamp(a), maxStamp(b)) - YEAR_MS;
  merged.deleted = [...tomb.entries()].filter(([, m]) => m >= cutoff).map(([id, _m]) => ({ id, _m })).sort(byId);
  return merged;
}

export function fingerprint(d) {
  return JSON.stringify([
    d.settings,
    d.account ?? null,
    [...(d.balances || [])].sort(byId),
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
// qui dure jusqu'à la paye suivante, quelle que soit sa date de versement.
export const cycleLabel = (date) => addDays(date, 15).slice(0, 7);

const dayDiff = (a, b) => Math.abs(new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 86400000;

export const payKeysOf = (settings) => (Array.isArray(settings?.payKeys) ? settings.payKeys : []);

// Dates de paye : entrées d'argent au libellé reconnu, sans les petits virements du même employeur (moins de la
// moitié du montant habituel). Deux payes sont espacées d'au moins 20 jours : dans ce délai on garde la première,
// une prime versée quelques jours après le salaire ne le remplace donc pas.
export function paydays(d) {
  const keys = payKeysOf(d.settings);
  if (!keys.length) return [];
  const cands = d.transactions.filter((t) => t.amount > 0 && keys.some((k) => labelMatchesKey(k, t.label)));
  if (!cands.length) return [];
  const amounts = cands.map((t) => t.amount).sort((a, b) => a - b);
  const median = amounts[Math.floor(amounts.length / 2)];
  const big = cands.filter((t) => t.amount >= median / 2).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.amount - a.amount));
  const kept = [];
  for (const t of big) if (!kept.length || dayDiff(kept[kept.length - 1].date, t.date) >= 20) kept.push(t);
  return kept;
}

const monthIndex = (iso) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
const monthOfIndex = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
const fracOfMonth = (iso) => {
  const [y, m, day] = iso.split('-').map(Number);
  return (day - 1) / new Date(y, m, 0).getDate();
};

// Cycles de paye avec leur nom de mois. Le nom ne dépend pas de chaque date isolée (une paye vers le 15 qui bouge
// de quelques jours donnait deux « Février » d'affilée) : on cherche le jour habituel de la paye (moyenne
// circulaire sur le mois) et chaque paye prend le mois de la paye « habituelle » la plus proche. Paye habituelle
// en fin de mois -> mois suivant, en début de mois -> même mois. Deux cycles ne portent jamais le même nom.
export function cycles(d) {
  const pays = paydays(d);
  if (!pays.length) return [];
  let sx = 0;
  let sy = 0;
  for (const p of pays) {
    const a = 2 * Math.PI * fracOfMonth(p.date);
    sx += Math.cos(a);
    sy += Math.sin(a);
  }
  const phase = ((Math.atan2(sy, sx) / (2 * Math.PI)) % 1 + 1) % 1;
  const lead = phase >= 0.5 ? 1 : 0;
  const out = [];
  let prev = -Infinity;
  pays.forEach((p, i) => {
    let idx = Math.floor(monthIndex(p.date) + fracOfMonth(p.date) - phase + 0.5) + lead;
    if (idx <= prev) idx = prev + 1;
    prev = idx;
    out.push({ date: p.date, label: monthOfIndex(idx), pay: p, end: pays[i + 1] ? dayBefore(pays[i + 1].date) : null });
  });
  return out;
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
// l'ancien mois (réglage closeSavingsOnPayday). Avant la 1re paye connue : mois du calendrier.
export function periodFn(d) {
  const cyc = cycles(d);
  const closeSavings = d.settings?.closeSavingsOnPayday !== false;
  return (t) => {
    if (t.period) return t.period;
    if (!cyc.length) return legacyPeriod(t, d.settings);
    let idx = -1;
    for (let i = 0; i < cyc.length && cyc[i].date <= t.date; i++) idx = i;
    if (closeSavings && idx >= 0 && t.date === cyc[idx].date && t.bucket === 'savings' && t.amount < 0) idx--;
    if (idx < 0) {
      const m = t.date.slice(0, 7);
      return m < cyc[0].label ? m : shiftMonth(cyc[0].label, -1);
    }
    return cyc[idx].label;
  };
}

// Mois budgétaire en cours (celui à afficher à l'ouverture de l'appli).
export const currentPeriod = (d, date = todayISO()) => periodFn(d)({ date, amount: -1, bucket: 'needs' });

// Suggestion pour « Détecter ma paye » : le plus gros revenu importé.
export function suggestPay(d) {
  const inc = d.transactions.filter((t) => t.amount > 0 && (t.bucket === 'income' || !t.bucket));
  if (!inc.length) return null;
  const top = inc.reduce((a, b) => (b.amount > a.amount ? b : a));
  const key = ruleKeyOf(top.label);
  return key ? { key, label: top.label, amount: top.amount } : null;
}

// --- Solde du compte ----------------------------------------------------------------------------------
const fromBank = (t) => t.source === 'import';
// Date de passage sur le compte (date de valeur) : c'est elle qui fait bouger le solde. Une carte payée le 29
// peut n'être débitée que le 2 du mois suivant.
const valueDate = (t) => t.vdate || t.date;
export const STALE_DAYS = 10;

// Soldes de fin de journée connus (lus dans les exports), du plus ancien au plus récent.
export function balanceRows(d) {
  const m = new Map();
  for (const b of d.balances || []) m.set(b.date, b.balance);
  if (d.account && !m.has(d.account.date)) m.set(d.account.date, d.account.balance);
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, balance]) => ({ date, balance }));
}

const bankSum = (d, after, upTo) => d.transactions.filter((t) => fromBank(t) && valueDate(t) > after && valueDate(t) <= upTo).reduce((s, t) => s + cents(t.amount), 0);

// Solde en fin de journée `day`, déduit du solde connu le plus proche et des opérations importées entre les deux.
export function balanceAt(d, day) {
  const rows = balanceRows(d);
  if (!rows.length) return null;
  let r = null;
  for (const x of rows) if (x.date <= day) r = x;
  if (r) return eurOf(cents(r.balance) + bankSum(d, r.date, day));
  const next = rows[0];
  return eurOf(cents(next.balance) - bankSum(d, day, next.date));
}

// Contrôle : entre deux soldes lus dans les exports, les opérations importées doivent expliquer la différence.
// Sinon il manque un export (trou dans l'historique) ou une opération importée a été supprimée.
export function checkBalances(d) {
  const rows = balanceRows(d);
  const gaps = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    const diff = cents(b.balance) - (cents(a.balance) + bankSum(d, a.date, b.date));
    if (diff !== 0) gaps.push({ from: a.date, to: b.date, diff: eurOf(diff) });
  }
  return gaps;
}

// Opération saisie « en attente » depuis plus de STALE_DAYS avant le dernier export : la banque l'a sans doute
// déjà passée (montant différent, rapprochement raté). Elle n'est plus ajoutée au solde, mais signalée.
export const isStalePending = (t, accDate) => !!t.pending && !!accDate && t.date < addDays(accDate, -STALE_DAYS);

// Solde du compte : dernier solde connu (celui de l'export) + opérations saisies « en attente de la banque ».
export function accountBalance(d) {
  const rows = balanceRows(d);
  if (!rows.length) return null;
  const a = rows[rows.length - 1];
  const pend = d.transactions.filter((t) => t.pending);
  const stale = pend.filter((t) => isStalePending(t, a.date));
  const live = pend.filter((t) => !isStalePending(t, a.date));
  const pending = live.reduce((s, t) => s + cents(t.amount), 0);
  return {
    exportBalance: a.balance,
    date: a.date,
    pending: eurOf(pending),
    total: eurOf(cents(a.balance) + pending),
    stale: { count: stale.length, sum: sumAmounts(stale), ids: stale.map((t) => t.id) },
  };
}

// Passage du solde du compte au budget d'un mois : relie le solde de la banque à la somme des opérations du mois.
// Le solde de n'importe quel jour passé se déduit des soldes lus dans les exports : aucun état initial à saisir.
export function reconcile(d, month) {
  const acc = accountBalance(d);
  if (!acc) return null;
  const per = periodFn(d);
  const cyc = cycles(d);
  let start;
  let end;
  if (cyc.length) {
    const c = cyc.find((x) => x.label === month);
    if (!c) return null;
    start = c.date;
    end = c.end ?? acc.date;
  } else {
    start = `${month}-01`;
    end = lastDayOf(month);
  }
  if (end > acc.date) end = acc.date;
  if (start > end) return null;
  const pendingOk = (t) => t.pending && !isStalePending(t, acc.date);
  const onAccount = (t) => fromBank(t) || pendingOk(t);
  // Opérations bancaires : fenêtre selon la date de valeur (comme le solde) ; saisies : selon leur date.
  const inWin = (t) => {
    const day = fromBank(t) ? valueDate(t) : t.date;
    return day >= start && day <= end;
  };
  const sum = (f) => d.transactions.filter(f).reduce((s, t) => s + cents(t.amount), 0);
  const openingDay = dayBefore(start);
  const opening = cents(balanceAt(d, openingDay));
  const closing = cents(balanceAt(d, end));
  const pendingIn = sum((t) => pendingOk(t) && inWin(t));
  const elsewhere = sum((t) => onAccount(t) && inWin(t) && per(t) !== month); // ex. virement d'épargne de clôture
  const brought = sum((t) => onAccount(t) && !inWin(t) && per(t) === month); // opérations d'autres dates comptées ici
  const cash = sum((t) => !fromBank(t) && !t.pending && per(t) === month); // hors banque (espèces…)
  const stale = sum((t) => t.pending && !pendingOk(t) && per(t) === month); // en attente trop ancienne : non comptée
  const estimated = closing + pendingIn;
  const gaps = checkBalances(d).filter((g) => g.to >= openingDay && g.from <= end);
  return {
    start,
    end,
    openingDay,
    opening: eurOf(opening),
    closing: eurOf(closing),
    pendingIn: eurOf(pendingIn),
    estimated: eurOf(estimated),
    elsewhere: eurOf(elsewhere),
    brought: eurOf(brought),
    cash: eurOf(cash),
    stale: eurOf(stale),
    sumOps: eurOf(estimated - opening - elsewhere + brought + cash),
    gaps,
  };
}

export function monthsOf(d) {
  const per = periodFn(d);
  return [...new Set(d.transactions.map(per))].sort().reverse();
}

export const RETRAIT = 'Retrait';

// Toute entrée d'argent classée Épargne est un retrait d'épargne (quelle que soit la sous-catégorie). Il « couvre »
// une dépense des Besoins (par défaut) ou des Envies : ex. frais de véhicule payés grâce au Livret A.
export const isWithdrawal = (t) => t.bucket === 'savings' && t.amount > 0;

// Bilan d'un mois budgétaire. Toutes les sommes sont calculées en centimes, puis rendues en euros.
//  - Besoins et envies : deux pourcentages. Total (toutes les dépenses du mois) et hors épargne (sans la part
//    financée par un retrait d'épargne, qui a été payée avec de l'argent mis de côté avant). La cible est
//    comparée au pourcentage hors épargne.
//  - Épargne nette = versée − retirée (tous les retraits) : elle est négative si on retire plus qu'on ne verse.
//  - Un remboursement supérieur aux dépenses de sa catégorie compte comme une rentrée d'argent.
//  - Revenus : ceux reçus ; tant que la paye du mois n'est pas arrivée, le revenu mensuel des réglages (s'il est
//    plus élevé) sert de revenu attendu.
// On a toujours : reste = base − besoins (total) − envies (total) − épargne nette (= argent réellement disponible).
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
  const stale = { count: 0, sum: 0 };
  const rows = balanceRows(d);
  const accDate = rows.length ? rows[rows.length - 1].date : null;
  for (const t of d.transactions) {
    if (per(t) !== month) continue;
    const c = cents(t.amount);
    if (isStalePending(t, accDate)) {
      // saisie jamais retrouvée dans les exports : sans doute déjà comptée via l'opération de la banque
      stale.count++;
      stale.sum += c;
      continue;
    }
    count++;
    allSum += c;
    if (t.date > lastDate) lastDate = t.date;
    if (t.bucket === 'income') {
      income += c;
      if (t.date.slice(0, 7) !== month) shiftedIn += c; // revenu reçu un autre mois, compté ici
    } else if (isWithdrawal(t)) withdrawn[t.covers === 'wants' ? 'wants' : 'needs'] += c;
    else if (t.bucket in spent) spent[t.bucket] -= c;
    else if (t.bucket === 'ignore') {
      ignored.count++;
      ignored.sum += c;
    } else if (!t.bucket) {
      todo++;
      todoSum += c;
    }
  }
  let refunds = 0;
  const gross = { needs: spent.needs, wants: spent.wants };
  for (const k of ['needs', 'wants']) {
    if (gross[k] < 0) {
      refunds -= gross[k];
      gross[k] = 0;
    }
  }
  const covered = { needs: Math.min(withdrawn.needs, gross.needs), wants: Math.min(withdrawn.wants, gross.wants) };
  const withdrawnTotal = withdrawn.needs + withdrawn.wants;
  const surplus = withdrawnTotal - covered.needs - covered.wants;
  const net = { needs: gross.needs - covered.needs, wants: gross.wants - covered.wants, savings: spent.savings - withdrawnTotal };
  const received = income + refunds;
  const hasPay = cycles(d).some((c) => c.label === month);
  const setting = cents(d.settings.income);
  const base = !hasPay && setting > received ? setting : received;
  const pctOf = (v) => (base > 0 ? (v / base) * 100 : 0);
  const pctRaw = {};
  const pct = {};
  const off = {};
  const T = d.settings.targets || {};
  for (const k of BUCKET_KEYS) {
    pctRaw[k] = pctOf(net[k]);
    pct[k] = Math.round(pctRaw[k]);
    off[k] = base > 0 && (k === 'savings' ? pctRaw[k] < (T[k] ?? 0) : pctRaw[k] > (T[k] ?? 0));
  }
  const pctGross = { needs: Math.round(pctOf(gross.needs)), wants: Math.round(pctOf(gross.wants)) };
  // Montant jusqu'au seuil de chaque catégorie (cible × revenus) : pour besoins et envies, ce qu'on peut encore
  // dépenser (négatif = seuil dépassé) ; pour l'épargne, ce qu'il reste à mettre de côté (négatif = cible dépassée).
  const target = {};
  const left = {};
  for (const k of BUCKET_KEYS) {
    target[k] = Math.round((base * (T[k] ?? 0)) / 100);
    left[k] = target[k] - net[k];
  }
  const total = gross.needs + gross.wants + net.savings;
  const rest = base - total;
  const E = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, eurOf(v)]));
  return {
    income: eurOf(income),
    refunds: eurOf(refunds),
    received: eurOf(received),
    fromSetting: base !== received, // revenu attendu (réglage) : la paye du mois n'est pas encore là
    shiftedIn: eurOf(shiftedIn),
    base: eurOf(base),
    spent: { ...E(gross), savings: eurOf(spent.savings) }, // total : dépenses (besoins, envies), versements (épargne)
    net: E(net), // besoins et envies hors part financée par l'épargne ; épargne nette = versée − retirée
    covered: E(covered),
    withdrawn: eurOf(withdrawnTotal),
    surplus: eurOf(surplus), // retraits d'épargne au-delà de la dépense financée
    pct, // besoins et envies : hors épargne ; épargne : nette (peut être négative)
    pctGross, // besoins et envies : total, financement par l'épargne compris
    target: E(target), // seuil de chaque catégorie en euros
    left: E(left), // jusqu'au seuil : à dépenser encore (besoins, envies) ou à épargner encore (épargne)
    pctRaw,
    off,
    total: eurOf(total),
    rest: eurOf(rest),
    todo,
    pending: { count: todo, sum: eurOf(todoSum) }, // opérations à classer : non déduites du reste
    restIfPending: eurOf(rest + todoSum),
    ignored: { count: ignored.count, sum: eurOf(ignored.sum) },
    stale: { count: stale.count, sum: eurOf(stale.sum) }, // saisies en attente trop anciennes : non comptées
    allSum: eurOf(allSum), // somme brute de toutes les opérations de la période, à comparer avec la banque
    lastDate,
    count,
  };
}
