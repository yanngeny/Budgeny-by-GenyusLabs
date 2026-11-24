// Tests sans dépendance : `node tests/run.js`
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { isZip, unzipFirst } from '../js/zip.js';
import { fileURLToPath } from 'node:url';
import { emptyData, normalize, mergeData, summarize, fingerprint } from '../js/model.js';
import { parseBoursorama, prepareImport, parseAmount, parseDate, ruleKeyOf, classify, decodeBuffer } from '../js/csv.js';
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

// --- ZIP : l'export BoursoBank est livré zippé ---
function makeZip(name, buf, deflate) {
  const nameB = Buffer.from(name);
  const comp = deflate ? deflateRawSync(buf) : buf;
  const method = deflate ? 8 : 0;
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(method, 8);
  lh.writeUInt32LE(comp.length, 18);
  lh.writeUInt32LE(buf.length, 22);
  lh.writeUInt16LE(nameB.length, 26);
  const local = Buffer.concat([lh, nameB, comp]);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(method, 10);
  cd.writeUInt32LE(comp.length, 20);
  cd.writeUInt32LE(buf.length, 24);
  cd.writeUInt16LE(nameB.length, 28);
  const cdFull = Buffer.concat([cd, nameB]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdFull.length, 12);
  eocd.writeUInt32LE(local.length, 16);
  const all = Buffer.concat([local, cdFull, eocd]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.length);
}
const withBom = Buffer.from('﻿' + csv);
const zDeflate = makeZip('export-operations-24-11-2026_21-21-28.CSV', withBom, true);
const zStored = makeZip('a.csv', withBom, false);
const z1 = await unzipFirst(zDeflate);
const z2 = await unzipFirst(zStored);
let zipErr = '';
await unzipFirst(makeZip('lisez-moi.txt', Buffer.from('x'), false)).catch((e) => (zipErr = e.message));
t('ZIP : export zippé lu (deflate et stocké, extension .CSV en majuscules, BOM)', () => {
  assert.equal(isZip(zDeflate), true);
  assert.equal(isZip(withBom.buffer.slice(withBom.byteOffset, withBom.byteOffset + withBom.length)), false);
  for (const z of [z1, z2]) {
    const r = parseBoursorama(decodeBuffer(z.bytes.buffer));
    assert.equal(r.ok, true);
    assert.equal(r.transactions.length, 6);
    assert.equal(r.transactions[3].amount, 2400);
  }
  assert.match(zipErr, /Aucun fichier CSV/);
});

t('ancien format d’export (amount / categoryParent) toujours lu', () => {
  const old = 'dateOp;dateVal;label;category;categoryParent;supplierFound;amount;comment;accountNum;accountLabel;accountbalance\n2026-11-20;2026-11-20;CARTE 20/11/26 LIDL CB*1;Supermarchés;Alimentation;lidl;-12,00;;1;CC;100,00\n';
  const r = parseBoursorama(old);
  assert.equal(r.transactions.length, 1);
  assert.equal(r.transactions[0].amount, -12);
  assert.equal(classify(r.transactions[0], []).bucket, 'needs');
});

t('revenus d’épargne et virements reçus (positifs) = revenus, pas épargne', () => {
  const rev = { label: 'X', hint: '', cat: 'Revenus placement immobiliers', parent: 'Revenus d’épargne', amount: 350 };
  const vir = { label: 'VIR SEPA EMPLOYEUR', hint: '', cat: 'Virements reçus', parent: 'Virements reçus', amount: 2000 };
  assert.equal(classify(rev, []).bucket, 'income');
  assert.equal(classify(vir, []).bucket, 'income');
  assert.equal(classify({ ...vir, amount: -500, cat: 'Virements émis', parent: 'Virements émis' }, []).bucket, '');
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
