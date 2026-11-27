// Tests sans dépendance : `node tests/run.js`
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { isZip, unzipFirst } from '../js/zip.js';
import { fileURLToPath } from 'node:url';
import { emptyData, normalize, mergeData, summarize, fingerprint, periodFn, paydays, cycleLabel, cycles, currentPeriod, suggestPay, accountBalance, reconcile, checkBalances, balanceAt, YEAR_MS } from '../js/model.js';
import { backFrom } from '../js/nav.js';
import { parseBoursorama, prepareImport, parseAmount, parseDate, ruleKeyOf, classify, decodeBuffer, anchorOf, selectAccount, importedTwin } from '../js/csv.js';
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

t('salaire versé en fin de mois : compté dans le mois suivant', () => {
  const d = emptyData();
  d.settings.incomeShiftDay = 25;
  d.transactions = [
    { id: 'a', date: '2026-10-28', amount: 2000, bucket: 'income' }, // -> novembre
    { id: 'b', date: '2026-11-03', amount: -1000, bucket: 'needs' },
    { id: 'c', date: '2026-10-10', amount: 50, bucket: 'income' }, // avant le jour 25 : reste en octobre
    { id: 'd', date: '2026-12-29', amount: 2000, bucket: 'income' }, // -> janvier 2027
    { id: 'e', date: '2026-10-30', amount: -80, bucket: 'needs' }, // dépense : jamais décalée
  ];
  const nov = summarize(d, '2026-11');
  assert.equal(nov.income, 2000);
  assert.equal(nov.shiftedIn, 2000); // le salaire du 28 octobre vient d'un autre mois
  assert.equal(nov.pct.needs, 50);
  assert.equal(summarize(d, '2026-10').income, 50);
  assert.equal(summarize(d, '2026-10').spent.needs, 80);
  assert.equal(summarize(d, '2027-01').income, 2000);
  d.transactions[0].period = '2026-10'; // forcé à la main
  assert.equal(summarize(d, '2026-10').income, 2050);
  d.settings.incomeShiftDay = 0; // désactivé
  d.transactions[3].period = '';
  assert.equal(summarize(d, '2026-12').income, 2000);
});

t('retrait d’épargne : la dépense financée ne pèse pas sur le budget du mois', () => {
  const d = emptyData();
  d.transactions = [
    { id: '1', date: '2026-11-02', amount: 2000, bucket: 'income' },
    { id: '2', date: '2026-11-05', amount: -800, bucket: 'needs', sub: 'Transport' }, // frais de véhicule
    { id: '3', date: '2026-11-06', amount: -200, bucket: 'needs' },
    { id: '4', date: '2026-11-06', amount: 800, bucket: 'savings', sub: 'Retrait' }, // virement du Livret A
    { id: '5', date: '2026-11-07', amount: -100, bucket: 'savings', sub: 'Livret' },
  ];
  let s = summarize(d, '2026-11');
  assert.equal(s.spent.needs, 1000);
  assert.equal(s.covered.needs, 800);
  assert.equal(s.net.needs, 200);
  assert.equal(s.pct.needs, 10);
  assert.equal(s.spent.savings, 100); // versements ; le retrait est déduit dans l'épargne nette
  assert.equal(s.net.savings, -700);
  assert.equal(s.withdrawn, 800);
  assert.equal(s.rest, 1700);
  d.transactions[3].amount = 1500; // plafonné à la dépense
  s = summarize(d, '2026-11');
  assert.equal(s.covered.needs, 1000);
  assert.equal(s.net.needs, 0);
  d.transactions[3].covers = 'wants'; // finance les envies : rien à couvrir ici
  s = summarize(d, '2026-11');
  assert.equal(s.covered.wants, 0);
  assert.equal(s.net.needs, 1000);
});

t('détail du reste : opérations à classer, ignorées, retraits non utilisés, total de contrôle', () => {
  const d = emptyData();
  d.transactions = [
    { id: '1', date: '2026-11-02', amount: 2000, bucket: 'income' },
    { id: '2', date: '2026-11-05', amount: -800, bucket: 'needs' },
    { id: '3', date: '2026-11-09', amount: -92.16, bucket: '' }, // pas encore classée
    { id: '4', date: '2026-11-10', amount: -50, bucket: 'ignore' },
    { id: '5', date: '2026-11-12', amount: 900, bucket: 'savings', sub: 'Retrait' }, // 100 de plus que la dépense
  ];
  const r2 = (n) => Math.round(n * 100) / 100;
  const s = summarize(d, '2026-11');
  assert.equal(s.rest, 2100); // besoins (800) financés par le retrait, et les 100 € retirés en plus sont disponibles
  assert.equal(s.net.savings, -900); // épargne nette = versée (0) − retirée (900)
  assert.equal(s.pending.count, 1);
  assert.equal(r2(s.pending.sum), -92.16);
  assert.equal(r2(s.restIfPending), 2007.84);
  assert.deepEqual(s.ignored, { count: 1, sum: -50 });
  assert.equal(s.surplus, 100);
  assert.equal(r2(s.allSum), 1957.84);
  assert.equal(s.lastDate, '2026-11-12');
});

t('entrée depuis un compte d’épargne : retrait, pas un revenu', () => {
  const x = { label: 'VIR LIVRET A', hint: '', cat: 'Virements reçus de comptes à comptes', parent: 'Mouvements internes créditeurs', amount: 800 };
  const r = classify(x, []);
  assert.equal(r.bucket, 'savings');
  assert.equal(r.sub, 'Retrait');
  assert.equal(classify({ label: 'VIREMENT PERSO', hint: '', cat: '', parent: '', amount: 300 }, [{ k: 'virement perso', bucket: 'savings' }]).sub, 'Retrait');
  assert.equal(classify({ ...x, amount: -150 }, []).sub, 'Livret'); // sortie vers le livret : épargne normale
});

t('icône Android : PNG aux bonnes tailles et ressources adaptatives présentes', () => {
  const res = (p) => readFileSync(new URL('../native/android/res/' + p, import.meta.url));
  const size = (p) => {
    const b = res(p);
    assert.equal(b.readUInt32BE(0), 0x89504e47, p + ' n’est pas un PNG');
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  };
  for (const [d, k] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 })) {
    const s = Math.round(48 * k);
    const f = Math.round(108 * k);
    assert.deepEqual(size(`mipmap-${d}/ic_launcher.png`), [s, s]);
    assert.deepEqual(size(`mipmap-${d}/ic_launcher_round.png`), [s, s]);
    assert.deepEqual(size(`mipmap-${d}/ic_launcher_foreground.png`), [f, f]);
  }
  assert.match(res('mipmap-anydpi-v26/ic_launcher.xml').toString(), /ic_launcher_foreground/);
  assert.match(res('mipmap-anydpi-v26/ic_launcher_round.xml').toString(), /ic_launcher_foreground/);
  assert.match(res('values/ic_launcher_background.xml').toString(), /ic_launcher_background/);
});

t('mois choisi à la main pour n’importe quelle opération (virement de clôture, dépense après la paye)', () => {
  const d = emptyData();
  d.transactions = [
    { id: 'a', date: '2026-10-29', amount: -500, bucket: 'savings', sub: 'Livret' }, // clôture octobre
    { id: 'b', date: '2026-10-30', amount: -46.59, bucket: 'needs', period: '2026-11' }, // après la paye : novembre
    { id: 'c', date: '2026-10-31', amount: -10, bucket: 'wants' }, // automatique : octobre
  ];
  const oct = summarize(d, '2026-10');
  const nov = summarize(d, '2026-11');
  assert.equal(oct.spent.savings, 500);
  assert.equal(oct.spent.needs, 0);
  assert.equal(oct.spent.wants, 10);
  assert.equal(Math.round(nov.spent.needs * 100) / 100, 46.59);
  assert.equal(nov.spent.savings, 0);
});

t('paye détectée par son libellé : les mois suivent la paye, quelle que soit sa date', () => {
  const d = emptyData();
  d.settings.payKeys = ['link france'];
  const L = 'VIR SEPA IT LINK FRANCE';
  d.transactions = [
    { id: 'p1', date: '2026-09-29', amount: 2543.99, label: L, bucket: 'income' },
    { id: 'p2', date: '2026-10-29', amount: 2410.76, label: L, bucket: 'income' },
    { id: 'extra', date: '2026-10-16', amount: 243, label: L, bucket: 'income' }, // même employeur, pas la paye
    { id: 'sw1', date: '2026-09-29', amount: -500, label: 'VIR depuis BoursoBank', bucket: 'savings', sub: 'Livret' }, // clôture septembre
    { id: 'sw2', date: '2026-10-29', amount: -500, label: 'VIR depuis BoursoBank', bucket: 'savings', sub: 'Livret' }, // clôture octobre
    { id: 'a', date: '2026-09-30', amount: -486, label: 'FAUTEUIL', bucket: 'needs' }, // après la paye de septembre
    { id: 'b', date: '2026-10-28', amount: -12.89, label: 'VINTED', bucket: 'wants' }, // veille de paye
    { id: 'c', date: '2026-10-30', amount: -46.59, label: 'BOUYGUES', bucket: 'needs' }, // après la paye d'octobre
    { id: 'early', date: '2026-09-10', amount: -20, label: 'AVANT', bucket: 'needs' }, // avant la 1re paye connue
    { id: 'manual', date: '2026-10-30', amount: -5, label: 'MANUEL', bucket: 'needs', period: '2026-10' }, // choix manuel prioritaire
  ];
  const per = periodFn(d);
  const got = Object.fromEntries(d.transactions.map((x) => [x.id, per(x)]));
  assert.deepEqual(got, { p1: '2026-10', p2: '2026-11', extra: '2026-10', sw1: '2026-09', sw2: '2026-10', a: '2026-10', b: '2026-10', c: '2026-11', early: '2026-09', manual: '2026-10' });
  assert.deepEqual(paydays(d).map((p) => p.id), ['p1', 'p2']); // le virement de 243 € est écarté
  const r2 = (n) => Math.round(n * 100) / 100;
  const oct = summarize(d, '2026-10');
  assert.equal(r2(oct.income), 2786.99); // paye du 29/09 + virement du 16/10
  assert.equal(r2(oct.spent.needs), 491); // 486 + 5 (choix manuel)
  assert.equal(r2(oct.spent.wants), 12.89);
  assert.equal(oct.spent.savings, 500); // virement du 29/10 qui clôture octobre
  const nov = summarize(d, '2026-11');
  assert.equal(r2(nov.income), 2410.76);
  assert.equal(r2(nov.spent.needs), 46.59);
  assert.equal(nov.spent.savings, 0);
});

t('paye irrégulière (début de mois) : le mois porte le nom du mois où tombent la plupart de ses jours', () => {
  assert.equal(cycleLabel('2026-09-29'), '2026-10');
  assert.equal(cycleLabel('2026-11-03'), '2026-11');
  assert.equal(cycleLabel('2026-12-29'), '2027-01');
  const d = emptyData();
  d.settings.payKeys = ['employeur'];
  d.transactions = [
    { id: 'p1', date: '2026-10-03', amount: 2000, label: 'VIR EMPLOYEUR', bucket: 'income' },
    { id: 'p2', date: '2026-11-05', amount: 2100, label: 'VIR EMPLOYEUR', bucket: 'income' },
    { id: 'x', date: '2026-10-20', amount: -10, label: 'X', bucket: 'needs' },
    { id: 'y', date: '2026-11-06', amount: -10, label: 'Y', bucket: 'needs' },
  ];
  const per = periodFn(d);
  assert.deepEqual(d.transactions.map(per), ['2026-10', '2026-11', '2026-10', '2026-11']);
});

t('« Détecter ma paye » propose le plus gros revenu ; sans paye, ancien comportement conservé', () => {
  const d = emptyData();
  d.transactions = [
    { id: '1', date: '2026-10-05', amount: 350, label: 'VIR de DUREL JEANNE - Loyer etc', bucket: 'income' },
    { id: '2', date: '2026-10-29', amount: 2410.76, label: 'VIR SEPA IT LINK FRANCE', bucket: 'income' },
  ];
  const c = suggestPay(d);
  assert.equal(c.key, 'link france');
  assert.equal(c.amount, 2410.76);
  assert.deepEqual(paydays(d), []); // aucune paye enregistrée : rien ne change
  assert.equal(periodFn(d)(d.transactions[1]), '2026-10');
});

t('bouton retour d’Android : remonte d’un écran, quitte à l’Accueil', () => {
  assert.equal(backFrom('home'), null);
  assert.deepEqual(backFrom('edit'), { tab: 'ops' });
  assert.deepEqual(backFrom('detail'), { tab: 'home' });
  assert.deepEqual(backFrom('add'), { tab: 'home' });
  assert.deepEqual(backFrom('ops'), { tab: 'home' });
  assert.deepEqual(backFrom('set'), { tab: 'home' });
  assert.deepEqual(backFrom('import', true), { tab: 'import', clearImport: true });
  assert.deepEqual(backFrom('import', false), { tab: 'ops' });
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /addListener\?\.\('backButton'/); // le bouton retour est bien branché
});

t('solde du compte : déduit de l’export, rapproché de la somme des opérations (cas réel de l’utilisateur)', () => {
  const r2 = (n) => Math.round(n * 100) / 100;
  const L = 'VIR SEPA IT LINK FRANCE';
  const imp = (id, date, amount, extra = {}) => ({ id, date, amount, label: extra.label ?? 'OP ' + id, source: 'import', bucket: extra.bucket ?? 'needs', ...extra });
  const d = emptyData();
  d.settings.payKeys = ['link france'];
  d.account = { date: '2026-11-24', balance: 488.82 }; // dernier solde lu dans l'export
  d.transactions = [
    imp('v', '2026-10-28', -12.89, { bucket: 'wants' }),
    imp('pay', '2026-10-29', 2410.76, { label: L, bucket: 'income' }),
    imp('sweep', '2026-10-29', -500, { bucket: 'savings', sub: 'Livret' }), // clôture octobre
    imp('a', '2026-10-30', -33.6),
    imp('b', '2026-10-30', -12.99),
    imp('nov', '2026-11-10', -1841.97),
    { id: 'att', date: '2026-11-24', amount: -11.98, label: 'En attente', bucket: 'needs', source: 'manual', pending: true },
  ];
  const bal = accountBalance(d);
  assert.equal(r2(bal.total), 476.84); // = le solde affiché par la banque, opération en attente comprise
  assert.equal(r2(bal.pending), -11.98);
  const rec = reconcile(d, '2026-11');
  assert.equal(rec.start, '2026-10-29');
  assert.equal(rec.openingDay, '2026-10-28');
  assert.equal(r2(rec.opening), 466.62); // état initial retrouvé sans le saisir
  assert.equal(r2(rec.estimated), 476.84);
  assert.equal(r2(rec.elsewhere), -500); // le virement d'épargne de clôture est compté en octobre
  assert.equal(r2(rec.sumOps), 510.22);
  assert.equal(r2(rec.sumOps), r2(summarize(d, '2026-11').allSum)); // le rapprochement tombe juste
  assert.equal(accountBalance(emptyData()), null);
  assert.equal(reconcile(emptyData(), '2026-11'), null);
});

t('solde du compte : fusion (le plus récent gagne), données invalides ignorées', () => {
  const a = normalize({ account: { date: '2026-11-20', balance: 100, _m: 1 } });
  const b = normalize({ account: { date: '2026-11-24', balance: 488.82, _m: 2 } });
  assert.equal(mergeData(a, b).account.balance, 488.82);
  assert.equal(mergeData(b, a).account.balance, 488.82);
  assert.equal(normalize({ account: { date: '2026-11-24' } }).account, null);
  assert.equal(mergeData(normalize({}), b).account.balance, 488.82);
});

t('lecture du solde dans l’export : première ligne du jour le plus récent (fichier du plus récent au plus ancien)', () => {
  const r = parseBoursorama(csv);
  assert.equal(r.anchor.date, '2026-11-20');
  assert.equal(r.anchor.balance, 1234.5);
  const asc = [
    { date: '2026-11-01', amount: -1, bal: 100 },
    { date: '2026-11-02', amount: -2, bal: 98 },
    { date: '2026-11-02', amount: -3, bal: 95 },
  ];
  assert.deepEqual(anchorOf(asc), { date: '2026-11-02', balance: 95 }); // ordre croissant : dernière ligne du jour
  assert.equal(anchorOf([{ date: '2026-11-01', amount: -1, bal: null }]), null);
});

t('opération « en attente » : confirmée par l’import, garde sa catégorie', () => {
  const d = emptyData();
  d.transactions = [{ id: 'att', date: '2026-11-24', amount: -11.98, label: 'Cantine', bucket: 'needs', sub: 'Courses', source: 'manual', pending: true }];
  const parsed = [
    { date: '2026-11-25', amount: -11.98, label: 'CARTE 24/11 BOULANGERIE X', cat: '', parent: '', hint: '', account: '1' },
    { date: '2026-11-25', amount: -50, label: 'AUTRE OPERATION', cat: '', parent: '', hint: '', account: '1' },
  ];
  const p = prepareImport(parsed, d);
  assert.equal(p.confirmed, 1);
  const f = p.fresh.find((x) => x.amount === -11.98);
  assert.equal(f.replaces, 'att');
  assert.equal(f.bucket, 'needs');
  assert.equal(f.sub, 'Courses');
  assert.equal(p.fresh.find((x) => x.amount === -50).replaces, undefined);
});


// --- Correctifs 0.5.0 ------------------------------------------------------------------------------
const PAY = 'VIR SEPA ACME PAIE';
const payData = (dates, extra = []) => {
  const d = emptyData();
  d.settings.payKeys = ['acme paie'];
  d.transactions = [...dates.map((date, i) => ({ id: 'p' + i, date, amount: 2000, label: PAY, bucket: 'income' })), ...extra];
  return d;
};

t('paye vers le 15 qui bouge : jamais deux mois du même nom, aucun mois sauté', () => {
  const d = payData(['2025-12-16', '2026-01-17', '2026-02-13', '2026-03-16'], [{ id: 'x', date: '2026-01-20', amount: -50, label: 'X', bucket: 'wants' }]);
  assert.deepEqual(cycles(d).map((c) => c.label), ['2025-12', '2026-01', '2026-02', '2026-03']);
  assert.equal(periodFn(d)(d.transactions[4]), '2026-01');
  assert.equal(summarize(d, '2026-02').income, 2000);
});

t('avant la 1re paye connue : mois du calendrier (pas tout l’historique dans un seul mois)', () => {
  const d = payData(['2026-10-29'], [
    { id: 'a', date: '2026-06-10', amount: -1, label: 'A', bucket: 'needs' },
    { id: 'b', date: '2026-09-10', amount: -1, label: 'B', bucket: 'needs' },
    { id: 'c', date: '2026-10-10', amount: -1, label: 'C', bucket: 'needs' },
  ]);
  const per = periodFn(d);
  assert.deepEqual(['a', 'b', 'c'].map((id) => per(d.transactions.find((x) => x.id === id))), ['2026-06', '2026-09', '2026-10']);
});

t('une prime plus grosse que le salaire, versée peu après, ne remplace pas la paye', () => {
  const d = payData(['2026-09-29', '2026-10-29']);
  d.transactions.push({ id: 'prime', date: '2026-11-08', amount: 3000, label: PAY, bucket: 'income' });
  assert.deepEqual(paydays(d).map((p) => p.id), ['p0', 'p1']);
});

t('mois en cours à l’ouverture : paye du 25 novembre -> on affiche décembre', () => {
  const d = payData(['2026-10-25', '2026-11-25']);
  assert.equal(currentPeriod(d, '2026-11-27'), '2026-12');
  assert.equal(currentPeriod(emptyData(), '2026-11-27'), '2026-11');
});

t('revenu attendu : tant que la paye n’est pas là, le réglage sert de base', () => {
  const d = emptyData();
  d.settings.income = 2400;
  d.transactions = [
    { id: 'caf', date: '2026-11-03', amount: 30, label: 'CAF', bucket: 'income' },
    { id: 'l', date: '2026-11-04', amount: -800, label: 'LOYER', bucket: 'needs' },
  ];
  let s = summarize(d, '2026-11');
  assert.equal(s.base, 2400);
  assert.equal(s.fromSetting, true);
  assert.equal(s.pct.needs, 33);
  d.transactions.push({ id: 'sal', date: '2026-11-05', amount: 2500, label: 'SALAIRE', bucket: 'income' });
  s = summarize(d, '2026-11');
  assert.equal(s.base, 2530);
  assert.equal(s.fromSetting, false);
  const p = payData(['2026-10-29']); // mode paye : la paye est là, on prend ce qui a été reçu
  p.settings.income = 2400;
  assert.equal(summarize(p, '2026-11').base, 2000);
});

t('cas de la capture : montants nets, épargne et reste cohérents', () => {
  const d = emptyData();
  d.settings.targets = { needs: 50, wants: 25, savings: 25 };
  d.transactions = [
    { id: 'i', date: '2026-11-01', amount: 2411, bucket: 'income' },
    { id: 'n', date: '2026-11-05', amount: -2226, bucket: 'needs' },
    { id: 'w', date: '2026-11-06', amount: -425, bucket: 'wants' },
    { id: 's', date: '2026-11-07', amount: -500, bucket: 'savings', sub: 'Livret' },
    { id: 'r', date: '2026-11-08', amount: 750, bucket: 'savings', sub: 'Retrait' },
  ];
  const s = summarize(d, '2026-11');
  assert.equal(s.net.needs, 1476); // hors financement par l'épargne
  assert.equal(s.pct.needs, 61);
  assert.equal(s.pctGross.needs, 92); // total, financement par l'épargne compris
  assert.equal(s.net.savings, -250); // 500 versés − 750 retirés
  assert.equal(s.pct.savings, -10);
  assert.equal(s.rest, 10);
  assert.equal(s.rest, s.base - s.spent.needs - s.spent.wants - s.net.savings);
  assert.deepEqual(s.off, { needs: true, wants: false, savings: true });
  // jusqu'au seuil : besoins 1 206 € (50 %), envies 603 € (25 %), épargne 603 € (25 %)
  assert.deepEqual(s.target, { needs: 1205.5, wants: 602.75, savings: 602.75 });
  assert.equal(s.left.needs, -270.5); // seuil dépassé
  assert.equal(s.left.wants, 177.75); // encore à dépenser
  assert.equal(s.left.savings, 852.75); // encore à épargner
});

t('entrée d’argent en Épargne = retrait, quelle que soit la sous-catégorie', () => {
  const d = emptyData();
  d.settings.income = 2000;
  d.transactions = [{ id: 'l', date: '2026-11-03', amount: 300, label: 'VIR LIVRET', bucket: 'savings', sub: 'Livret' }];
  const s = summarize(d, '2026-11');
  assert.equal(s.spent.savings, 0);
  assert.equal(s.withdrawn, 300);
  assert.equal(s.net.savings, -300); // épargne reprise
  assert.equal(s.rest, 2300);
});

t('remboursement plus gros que les dépenses de sa catégorie : catégorie à zéro, l’excédent est une rentrée', () => {
  const d = emptyData();
  d.transactions = [
    { id: 'i', date: '2026-11-01', amount: 1000, bucket: 'income' },
    { id: 'a', date: '2026-11-02', amount: -20, bucket: 'wants' },
    { id: 'r', date: '2026-11-03', amount: 120, bucket: 'wants' }, // remboursement d'un achat du mois dernier
  ];
  const s = summarize(d, '2026-11');
  assert.equal(s.net.wants, 0);
  assert.equal(s.pct.wants, 0);
  assert.equal(s.refunds, 100);
  assert.equal(s.base, 1100);
  assert.equal(s.rest, 1100);
});

t('cibles comparées sans arrondi, calculs en centimes', () => {
  const d = emptyData();
  d.transactions = [
    { id: 'i', date: '2026-11-01', amount: 1000, bucket: 'income' },
    { id: 'n', date: '2026-11-02', amount: -504, bucket: 'needs' },
    { id: 'a', date: '2026-11-03', amount: -0.1, bucket: 'wants' },
    { id: 'b', date: '2026-11-03', amount: -0.2, bucket: 'wants' },
  ];
  const s = summarize(d, '2026-11');
  assert.equal(s.pct.needs, 50);
  assert.equal(s.off.needs, true); // 50,4 % > 50 %
  assert.equal(s.net.wants, 0.3);
  assert.equal(s.rest, 495.7);
});

t('saisie en attente : montant un peu différent rapproché ; trop ancienne, plus ajoutée au solde', () => {
  const d = emptyData();
  d.transactions = [{ id: 'att', date: '2026-11-20', amount: -60, label: 'Essence', bucket: 'needs', sub: 'Transport', source: 'manual', pending: true, note: 'plein' }];
  const p = prepareImport([{ date: '2026-11-22', amount: -60.37, label: 'CARTE TOTAL', cat: '', parent: '', hint: '', account: '1' }], d);
  assert.equal(p.confirmed, 1);
  assert.equal(p.fresh[0].sub, 'Transport');
  assert.equal(p.fresh[0].note, 'plein');
  assert.equal(prepareImport([{ date: '2026-11-22', amount: -90, label: 'AUTRE', cat: '', parent: '', hint: '', account: '1' }], d).confirmed, 0);
  d.account = { date: '2026-12-15', balance: 100 };
  const b = accountBalance(d);
  assert.equal(b.total, 100);
  assert.equal(b.stale.count, 1);
  assert.equal(summarize(d, '2026-11').net.needs, 0); // ni dans le solde, ni dans le budget
  assert.equal(summarize(d, '2026-11').stale.count, 1);
  d.account.date = '2026-11-25';
  assert.equal(accountBalance(d).total, 40);
  assert.equal(summarize(d, '2026-11').net.needs, 60);
});

t('saisie en attente d’une opération déjà importée : détectée', () => {
  const d = emptyData();
  d.transactions = [{ id: 'imp', date: '2026-11-20', amount: -12.5, label: 'BOULANGERIE', source: 'import', bucket: 'needs' }];
  assert.equal(importedTwin(d, { date: '2026-11-22', amount: -12.5 }).id, 'imp');
  assert.equal(importedTwin(d, { date: '2026-12-22', amount: -12.5 }), null);
});

t('soldes des exports : trou dans l’historique détecté, solde passé calculé par date de valeur', () => {
  const d = emptyData();
  d.balances = [
    { id: 'bal:2026-10-31', date: '2026-10-31', balance: 1000, _m: 1 },
    { id: 'bal:2026-11-30', date: '2026-11-30', balance: 900, _m: 2 },
  ];
  d.transactions = [{ id: 'a', date: '2026-11-10', amount: -100, source: 'import', bucket: 'needs' }];
  assert.deepEqual(checkBalances(d), []);
  d.transactions.push({ id: 'b', date: '2026-11-29', vdate: '2026-12-02', amount: -30, source: 'import', bucket: 'needs' });
  assert.deepEqual(checkBalances(d), []); // passée sur le compte le 2 décembre : après le 2e export
  assert.equal(balanceAt(d, '2026-11-15'), 900);
  d.transactions = d.transactions.filter((x) => x.id !== 'a'); // opération supprimée ou export manquant
  assert.deepEqual(checkBalances(d), [{ from: '2026-10-31', to: '2026-11-30', diff: -100 }]);
});

t('solde lu dans l’export : enchaînement des soldes plutôt que l’ordre du fichier', () => {
  const rows = [
    { date: '2026-11-02', amount: -3, bal: 95 }, // ordre du fichier mélangé dans la journée
    { date: '2026-11-02', amount: -2, bal: 98 },
    { date: '2026-11-01', amount: -1, bal: 100 },
  ];
  assert.deepEqual(anchorOf(rows), { date: '2026-11-02', balance: 95 });
});

t('export avec plusieurs comptes : un seul compte importé', () => {
  const two = 'dateOp;dateVal;label;category;categoryParent;supplierFound;amount;comment;accountNum;accountLabel;accountbalance\n'
    + '2026-11-20;2026-11-20;A;;;;-10,00;;111;CC;90,00\n2026-11-19;2026-11-19;B;;;;-5,00;;111;CC;100,00\n2026-11-20;2026-11-20;C;;;;-1,00;;222;JOINT;50,00\n';
  const r = parseBoursorama(two);
  assert.deepEqual(r.accounts, ['111', '222']);
  assert.equal(r.anchor.balance, 90);
  const j = selectAccount(r, '222');
  assert.equal(j.transactions.length, 1);
  assert.equal(j.anchor.balance, 50);
});

t('classement : remboursements entre amis, assurance auto, mots entiers, règle la plus précise', () => {
  const tx = (label, amount, cat = '', parent = '') => ({ label, hint: '', cat, parent, amount });
  assert.equal(classify(tx('VIR LYDIA DUPONT', 25, 'Virements reçus', 'Virements reçus'), []).bucket, '');
  assert.equal(classify(tx('PRLV MAAF', -40, 'Assurance auto', ''), []).sub, 'Assurances et impôts');
  assert.equal(classify(tx('VIR COMPTE JOINT', 200, '', 'Mouvements internes créditeurs'), []).bucket, '');
  assert.equal(classify(tx('FREEZE CORP', -5), [{ k: 'free', bucket: 'needs' }]).bucket, '');
  const rules = [{ k: 'amazon', bucket: 'wants', sub: 'Shopping' }, { k: 'amazon prime', bucket: 'wants', sub: 'Abonnements' }];
  assert.equal(classify(tx('AMAZON PRIME FR', -6.99), rules).sub, 'Abonnements');
});

t('montants : formats de milliers, anglais, signe moins typographique', () => {
  assert.equal(parseAmount('1.234'), 1234);
  assert.equal(parseAmount('1,234.56'), 1234.56);
  assert.equal(parseAmount('−12,50'), -12.5);
  assert.equal(parseAmount('12.5'), 12.5);
  assert.equal(parseAmount('0,10'), 0.1);
});

t('fusion : même export importé sur deux téléphones -> une seule opération', () => {
  const row = (id, _m, bucket) => ({ id, _m, date: '2026-11-03', amount: -10, label: 'CAFE', bucket, hash: 'h#0', source: 'import' });
  const a = normalize({ transactions: [row('id1', 1, 'wants')] });
  const b = normalize({ transactions: [row('id2', 2, 'needs')] });
  const m = mergeData(a, b);
  assert.equal(m.transactions.length, 1);
  assert.equal(m.transactions[0].bucket, 'needs'); // la plus récemment modifiée
  assert.equal(fingerprint(mergeData(b, a)), fingerprint(m));
  assert.equal(fingerprint(mergeData(m, a)), fingerprint(m));
});

t('fusion : réglages fusionnés un par un, vieilles suppressions purgées', () => {
  const a = normalize({ settings: { income: 2400, _m: 5, _f: { income: 5 } } });
  const b = normalize({ settings: { targets: { needs: 60, wants: 20, savings: 20 }, _m: 6, _f: { targets: 6 } } });
  const m = mergeData(a, b);
  assert.equal(m.settings.income, 2400);
  assert.equal(m.settings.targets.needs, 60);
  const now = 10 * YEAR_MS;
  const old = normalize({ deleted: [{ id: 'vieux', _m: now - 2 * YEAR_MS }, { id: 'recent', _m: now - 1000 }], transactions: [{ id: 'x', _m: now, date: '2026-11-01', amount: -1 }] });
  assert.deepEqual(mergeData(old, normalize({})).deleted.map((x) => x.id), ['recent']);
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

// Une catégorie choisie se répercute sur les opérations encore « à classer » de même libellé
store.addMany([
  { date: '2026-11-01', label: 'MYSTERE SARL PARIS', amount: -5, bucket: '' },
  { date: '2026-11-02', label: 'MYSTERE SARL LYON', amount: -6, bucket: '' },
  { date: '2026-11-03', label: 'BOULANGER', amount: -7, bucket: '' },
  { date: '2026-11-04', label: 'MYSTERE SARL', amount: -8, bucket: 'needs' },
]);
const caught = store.addRule({ k: 'mystere sarl', bucket: 'wants' });
t('règle : rattrape les opérations à classer de même libellé, pas les autres', () => {
  const tx = (l) => store.get().transactions.find((x) => x.label === l);
  assert.equal(caught, 2);
  assert.equal(tx('MYSTERE SARL PARIS').bucket, 'wants');
  assert.equal(tx('MYSTERE SARL LYON').bucket, 'wants');
  assert.equal(tx('BOULANGER').bucket, '');
  assert.equal(tx('MYSTERE SARL').bucket, 'needs');
});

store.addMany([
  { date: '2026-08-30', label: 'APRESPAYE1', amount: -20, bucket: 'needs' },
  { date: '2026-08-30', label: 'APRESPAYE2', amount: -30, bucket: 'wants' },
]);
const ppIds = store.get().transactions.filter((x) => x.label.startsWith('APRESPAYE')).map((x) => x.id);
const ppCount = store.setPeriod(ppIds, '2026-09');
t('setPeriod : rattache plusieurs opérations à un mois en une seule écriture', () => {
  assert.equal(ppCount, 2);
  assert.ok(store.get().transactions.filter((x) => ppIds.includes(x.id)).every((x) => x.period === '2026-09'));
});

store.addMany([{ date: '2026-11-05', label: 'XYZ 123', cat: 'Supermarchés', amount: -9, bucket: '', source: 'import' }]);
const caughtCat = store.addRule({ k: 'supermarches', bucket: 'needs', sub: 'Courses' });
const s1 = store.stamp();
const s2 = store.stamp();
t('règle : rattrapage avec le même texte qu’à l’import (catégorie de la banque), sous-catégorie retenue ; horloge monotone', () => {
  assert.equal(caughtCat, 1);
  assert.equal(store.get().transactions.find((x) => x.label === 'XYZ 123').sub, 'Courses');
  assert.ok(s2 > s1);
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
