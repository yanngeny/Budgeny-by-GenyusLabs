// Tests sans dépendance : `node tests/run.js`
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyData, normalize, mergeData, summarize, fingerprint } from '../js/model.js';
import { parseBoursorama, prepareImport, parseAmount, parseDate, ruleKeyOf, classify } from '../js/csv.js';
import { isNewer } from '../js/update.js';

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log('ok  ' + name);
};

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

console.log(`\n${n} tests passés`);
