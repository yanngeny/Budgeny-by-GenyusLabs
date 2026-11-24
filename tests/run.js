// Tests sans dépendance : `node tests/run.js`
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { emptyData, normalize, mergeData, summarize, fingerprint } from '../js/model.js';
import { parseBoursorama, prepareImport, parseAmount, parseDate, ruleKeyOf, classify } from '../js/csv.js';
import { isNewer } from '../js/update.js';

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log('ok  ' + name);
};

t('tous les fichiers js/ sont syntaxiquement valides', () => {
  const dir = new URL('../js/', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    execFileSync(process.execPath, ['--check', fileURLToPath(new URL(f, dir))], { stdio: 'pipe' });
  }
});

const csv = readFileSync(new URL('./fixtures/boursorama-sample.csv', import.meta.url), 'utf8');

t('parseAmount / parseDate', () => {
  assert.equal(parseAmount('-42,30'), -42.3);
  assert.equal(parseAmount('"2 400,00"'), 2400);
  assert.equal(parseAmount('1.234,56'), 1234.56);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseDate('2026-11-20'), '2026-11-20');
  assert.equal(parseDate('20/11/2026'), '2026-11-20');
});

t('parseBoursorama lit le CSV exemple', () => {
  const r = parseBoursorama(csv);
  assert.equal(r.ok, true);
  assert.equal(r.transactions.length, 6);
  assert.equal(r.transactions[0].label, 'CARREFOUR');
  assert.equal(r.transactions[3].amount, 2400);
});

t('prepareImport : doublons exacts conservés, réimport ignoré', () => {
  const d = emptyData();
  const p1 = prepareImport(parseBoursorama(csv).transactions, d);
  assert.equal(p1.fresh.length, 6); // deux achats identiques = deux opérations
  assert.equal(p1.dup, 0);
  d.transactions = p1.fresh.map((x, i) => ({ id: 'id' + i, _m: 1, hash: x.hash, date: x.date, amount: x.amount, label: x.label, bucket: x.bucket }));
  const p2 = prepareImport(parseBoursorama(csv).transactions, d);
  assert.equal(p2.fresh.length, 0);
  assert.equal(p2.dup, 6);
});

t('classement par défaut', () => {
  const p = prepareImport(parseBoursorama(csv).transactions, emptyData());
  const by = (l) => p.fresh.find((x) => x.label.includes(l));
  assert.equal(by('CARREFOUR').bucket, 'needs');
  assert.equal(by('SPOTIFY').bucket, 'wants');
  assert.equal(by('SALAIRE').bucket, 'income');
  assert.equal(by('Livret').bucket, 'savings');
  assert.equal(by('MYSTERE').bucket, '');
  assert.equal(p.groups.length, 1);
});

t('règle utilisateur prioritaire', () => {
  const tx = { label: 'MYSTERE SARL', cat: '', parent: '', amount: -5 };
  assert.equal(ruleKeyOf('MYSTERE SARL'), 'mystere sarl');
  assert.equal(classify(tx, [{ k: 'mystere sarl', bucket: 'wants' }]).bucket, 'wants');
});

t('fusion : dernier écrit gagne, suppression respectée', () => {
  const a = normalize({ transactions: [{ id: 'x', _m: 1, date: '2026-11-01', amount: -1, bucket: 'needs' }, { id: 'y', _m: 1, date: '2026-11-01', amount: -2, bucket: 'needs' }] });
  const b = normalize({
    transactions: [{ id: 'x', _m: 5, date: '2026-11-01', amount: -1, bucket: 'wants' }],
    deleted: [{ id: 'y', _m: 3 }],
  });
  const m = mergeData(a, b);
  assert.equal(m.transactions.length, 1);
  assert.equal(m.transactions[0].bucket, 'wants');
  assert.equal(fingerprint(mergeData(m, b)), fingerprint(m)); // idempotent
});

t('summarize : 50/30/20', () => {
  const d = emptyData();
  d.transactions = [
    { id: '1', date: '2026-11-05', amount: 2000, bucket: 'income' },
    { id: '2', date: '2026-11-06', amount: -1000, bucket: 'needs' },
    { id: '3', date: '2026-11-07', amount: -600, bucket: 'wants' },
    { id: '4', date: '2026-11-08', amount: -400, bucket: 'savings' },
    { id: '5', date: '2026-11-09', amount: -5, bucket: '' },
  ];
  const s = summarize(d, '2026-11');
  assert.deepEqual(s.pct, { needs: 50, wants: 30, savings: 20 });
  assert.equal(s.todo, 1);
});

t('comparaison de versions', () => {
  assert.equal(isNewer('v0.2.0', '0.1.9'), true);
  assert.equal(isNewer('0.1.0', '0.1.0'), false);
});

t('version.js et package.json sont alignés', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const ver = readFileSync(new URL('../js/version.js', import.meta.url), 'utf8').match(/VERSION = '([^']+)'/)[1];
  assert.equal(ver, pkg.version);
});

// --- Pont natif simulé : Capacitor SANS registerPlugin, comme dans l'APK (pas de bundler) ---
let disk = '';
let failBrowser = false;
const opened = [];
const plugin = {
  pick: async () => ({ uri: 'content://fake/Budgeny_data.json', name: 'Budgeny_data.json' }),
  read: async () => ({ text: disk }),
  write: async ({ text }) => {
    disk = text;
  },
  openApp: async ({ package: pkg }) => {
    if (pkg !== 'com.boursorama.android.clients') throw new Error('not_installed');
  },
  openBrowser: async ({ url }) => {
    opened.push(url);
    if (failBrowser) throw new Error('boom');
  },
};
const mem = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  },
});
globalThis.window = { Capacitor: { isNativePlatform: () => true, Plugins: { BudgenyFile: plugin } }, location: { href: '' }, open() {} };

const storage = await import('../js/storage.js');
const sync = await import('../js/sync.js');
const store = await import('../js/store.js');

t('pont natif : le plugin est trouvé via Capacitor.Plugins', () => {
  assert.equal(storage.isNative(), true);
});

await sync.choose(true);
t('pont natif : créer le fichier initial écrit un JSON Budgeny', () => {
  assert.equal(sync.state.status, 'ok');
  assert.equal(sync.state.ref.kind, 'saf');
  assert.equal(JSON.parse(disk).app, 'budgeny');
});

store.load();
store.addTx({ date: '2026-11-24', label: 'Test', amount: -3, bucket: 'wants' });
await sync.now();
t('pont natif : une action locale est écrite dans le fichier', () => {
  assert.equal(JSON.parse(disk).transactions.length, 1);
  assert.equal(sync.state.status, 'ok');
});

await storage.openBrowser('https://clients.boursobank.com/operations/generate/');
failBrowser = true;
await storage.openBrowser('https://github.com/x/y.apk', { fallback: true });
let rejected = false;
await storage.openBrowser('https://clients.boursobank.com/', {}).catch(() => (rejected = true));
t('pont natif : ouverture du navigateur, repli seulement si demandé', () => {
  assert.equal(opened[0], 'https://clients.boursobank.com/operations/generate/');
  assert.equal(window.location.href, 'https://github.com/x/y.apk');
  assert.equal(rejected, true);
});

const appOk = await storage.openApp('com.boursorama.android.clients');
const appAbsent = await storage.openApp('com.exemple.absent');
const M = await import('../js/model.js');
t('lancement de l’appli BoursoBank (false si absente) et réglages par défaut', () => {
  assert.equal(appOk, true);
  assert.equal(appAbsent, false);
  assert.equal(M.BANK_PKG, 'com.boursorama.android.clients');
  assert.equal(M.defaultSettings().bankMode, 'app');
  assert.equal(M.normalize({ settings: { bankUrl: 'https://clients.boursobank.com/' } }).settings.bankUrl, M.BANK_URL);
});

console.log(`\n${n} tests passés`);
