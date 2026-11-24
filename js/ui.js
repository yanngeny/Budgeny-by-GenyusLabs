// Écrans de l'appli (voir les maquettes) : accueil, ajout rapide, opérations, import, historique, réglages.
import * as store from './store.js';
import * as sync from './sync.js';
import * as storage from './storage.js';
import { BANK_PKG, BUCKETS, BUCKET_KEYS, SUBS, bucketLabel, bucketColor, summarize, monthsOf, todayISO, shiftMonth, periodFn, isWithdrawal, RETRAIT, suggestPay, payKeysOf, paydays, cycleLabel, accountBalance, reconcile } from './model.js';
import { decodeBuffer, parseBoursorama, prepareImport, ruleKeyOf } from './csv.js';
import { ic, logo, opIconName, subIcon, BUCKET_ICON } from './icons.js';
import { backFrom } from './nav.js';
import { isZip, unzipFirst } from './zip.js';
import { checkUpdate } from './update.js';
import { VERSION } from './version.js';

const E = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (n, d = 0) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' €';
const eur2 = (n) => eur(n, 2);
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const monthLabel = (k) => {
  const [y, m] = k.split('-');
  const name = MONTHS[+m - 1];
  return `${name[0].toUpperCase()}${name.slice(1)} ${y}`;
};
const monthName = (k) => monthLabel(k).split(' ')[0].toLowerCase();
const longDay = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
const dayBefore = (iso) => {
  const t = new Date(iso + 'T12:00:00');
  t.setDate(t.getDate() - 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};
function dayLabel(iso) {
  const today = todayISO();
  if (iso === today) return 'Aujourd’hui';
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yi = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  if (iso === yi) return 'Hier';
  return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

const U = {
  tab: 'home',
  month: todayISO().slice(0, 7),
  filter: 'all',
  add: { amt: '', type: 'out', bucket: 'wants', sub: 'Restau', note: '' },
  edit: null,
  imp: null,
  upd: null,
  flash: '',
};
let root;
let flashTimer;
let lastTab = '';
const flash = (m) => {
  U.flash = m;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    U.flash = '';
    render();
  }, 2600);
};

/* ---------- composants ---------- */
const monthBar = () => `<div class="monthbar"><button class="ib" data-act="month" data-v="-1" aria-label="Mois précédent">${ic('left')}</button><div class="mtitle">${E(monthLabel(U.month))}</div><button class="ib" data-act="month" data-v="1" aria-label="Mois suivant">${ic('right')}</button></div>`;
const backBar = (act, v, title) => `<div class="hd"><button class="ib" data-act="${act}"${v ? ` data-v="${v}"` : ''} aria-label="Retour">${ic('back')}</button><b style="font-size:17px">${title}</b><span style="width:40px"></span></div>`;
const bucketChip = (b, on, act, v, extra = '') => `<button class="chip ${extra} b-${b} ${on ? 'on' : ''}" data-act="${act}" data-v="${v}">${BUCKET_ICON[b] ? ic(BUCKET_ICON[b]) : ''}${bucketLabel(b)}</button>`;

function opRow(t, per) {
  const c = bucketColor(t.bucket);
  const p = per(t);
  const shifted = p !== t.date.slice(0, 7) ? `compté en ${monthName(p)}` : '';
  const funds = isWithdrawal(t) ? `finance les ${t.covers === 'wants' ? 'envies' : 'besoins'}` : '';
  const sub = [bucketLabel(t.bucket), t.sub, funds, shifted, t.pending ? 'en attente de la banque' : ''].filter(Boolean).join(' · ');
  return `<div class="row tap" data-act="edit" data-v="${E(t.id)}"><div class="opic" style="--c:${c}">${ic(opIconName(t))}</div><div class="grow"><div>${E(t.label)}</div><div class="sm">${E(sub)}</div></div><div class="amt ${t.amount > 0 ? 'pos' : ''}">${t.amount > 0 ? '+' : ''}${eur2(t.amount).replace('-', '−')}</div></div>`;
}

function bucketCard(k, s, d, scale = 60) {
  const p = s.pct[k];
  const t = d.settings.targets[k];
  const ok = k === 'savings' ? p >= t : p <= t;
  const diff = p - t;
  const txt = ok ? (k === 'savings' ? 'Cible atteinte' : 'Dans la cible') : `${diff > 0 ? '+' : '−'}${Math.abs(diff)} pts`;
  const color = BUCKETS[k].color;
  const w = Math.min(100, (p / scale) * 100);
  // Part financée par un retrait d'épargne : barre hachurée au-delà de la part « budget courant »
  const cov = s.covered[k] || 0;
  const gp = s.base > 0 ? Math.round((s.spent[k] / s.base) * 100) : p;
  const hatch = cov > 0 ? `<i style="width:${Math.min(100, (gp / scale) * 100)}%;background:repeating-linear-gradient(135deg,${color} 0 4px,transparent 4px 8px);opacity:.6"></i>` : '';
  const note = cov > 0 ? `<div class="sm">dont ${eur(cov)} financés par l’épargne</div>` : k === 'savings' && s.withdrawn > 0 ? `<div class="sm">${eur(s.withdrawn)} retirés de l’épargne</div>` : '';
  return `<div class="bk"><div class="bk-top"><div class="opic" style="--c:${color}">${ic(BUCKET_ICON[k])}</div><div class="grow"><div>${bucketLabel(k)}</div><div class="sm">${p} % · cible ${t} %</div></div><div style="text-align:right"><div class="amt">${eur(s.spent[k])}</div><span class="pill ${ok ? 'ok' : 'warn'}">${txt}</span></div></div><div class="bar">${hatch}<i style="width:${w}%;background:${color}"></i><b style="left:${Math.min(100, (t / scale) * 100)}%"></b></div>${note}</div>`;
}

/* ---------- écrans ---------- */
function home() {
  const d = store.get();
  const per = periodFn(d);
  const s = summarize(d, U.month);
  const T = d.settings.targets;
  const recent = d.transactions.filter((t) => per(t) === U.month).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5);
  const S = sync.state;
  const sy = !S.ref ? ['', 'Local'] : S.status === 'syncing' ? ['busy', 'Synchro…'] : S.status === 'error' ? ['err', 'Erreur'] : ['ok', 'Synchronisé'];
  const needPay = !payKeysOf(d.settings).length && suggestPay(d);
  const bank = accountBalance(d);
  // Échelle commune aux trois barres (au moins 60 %), pour que la dépense financée par l'épargne reste visible
  const scale = Math.max(60, Math.ceil(Math.max(...BUCKET_KEYS.map((k) => (s.base > 0 ? (s.spent[k] / s.base) * 100 : 0))) / 10) * 10);
  const offs = BUCKET_KEYS.filter((k) => (k === 'savings' ? s.pct[k] < T[k] : s.pct[k] > T[k])).length;
  const hero =
    s.base > 0
      ? `<div class="hero" data-act="detail"><div class="hero-top"><span class="hero-label">Reste ce mois</span><span class="pill">${offs ? `${offs} à surveiller` : 'Dans les clous'}</span></div><div class="hero-amt">${eur(s.rest)}</div><div class="hero-sub"><span>${eur(s.base)} de revenus · ${eur(s.total)} dépensés</span><span>Détail ›</span></div>${bank ? `<div class="hero-sub" style="margin-top:6px"><span>Solde du compte</span><span style="color:#fff;font-weight:600">${eur2(bank.total)}</span></div>` : ''}</div>`
      : `<div class="banner" data-act="go" data-v="set">${ic('wallet')}<span class="grow">Renseigne tes revenus mensuels dans les réglages, ou importe ton salaire.</span>${ic('right')}</div>`;
  return `<div class="top"><div class="brand">${logo(30)}Budgeny</div><div class="sync ${sy[0]}" data-act="go" data-v="set"><i></i>${sy[1]}</div></div>
${monthBar()}
${!S.ref ? `<div class="banner" data-act="go" data-v="set">${ic('cloud')}<span class="grow">Choisis où enregistrer tes données (téléphone ou Google Drive)</span>${ic('right')}</div>` : ''}
${needPay ? `<div class="banner" data-act="detectpay">${ic('calendar')}<span class="grow">Indique ta paye pour que les mois suivent ton salaire</span>${ic('right')}</div>` : ''}
${hero}
${BUCKET_KEYS.map((k) => bucketCard(k, s, d, scale)).join('')}
${s.todo ? `<div class="banner" data-act="todo">${ic('help')}<span class="grow">${s.todo} opération${s.todo > 1 ? 's' : ''} à catégoriser</span>${ic('right')}</div>` : ''}
${recent.length ? `<div class="sec">Dernières opérations<a data-act="go" data-v="ops">Tout voir ›</a></div><div class="grp">${recent.map((t) => opRow(t, per)).join('')}</div>` : `<div class="card empty">${logo(60)}<b>Rien pour ce mois</b><div class="sm">Importe ton export BoursoBank ou ajoute une dépense avec le bouton +.</div><button class="btn" data-act="go" data-v="import">${ic('upload')}Importer un export</button></div>`}`;
}

function addScreen() {
  const A = U.add;
  const subs = SUBS[A.bucket] || [];
  const color = A.type === 'out' ? BUCKETS[A.bucket].color : '#639922';
  return `<div class="hd"><button class="ib" data-act="go" data-v="home" aria-label="Fermer">${ic('x')}</button><b style="font-size:17px">Nouvelle opération</b><span style="width:40px"></span></div>
<div class="chips"><button class="chip f ${A.type === 'out' ? 'on' : ''}" data-act="atype" data-v="out">Dépense</button><button class="chip f ${A.type === 'in' ? 'on' : ''}" data-act="atype" data-v="in">Revenu</button></div>
<div><div class="big" style="color:${color}">${A.amt ? E(A.amt.replace('.', ',')) : '0'} €</div><div class="sm" style="text-align:center">Aujourd’hui · ${E(store.get().settings.me)}</div></div>
${A.type === 'out' ? `<div class="chips">${BUCKET_KEYS.map((b) => bucketChip(b, A.bucket === b, 'abucket', b, 'f')).join('')}</div>
<div class="chips">${subs.map((x) => `<button class="chip b-${A.bucket} ${A.sub === x ? 'on' : ''}" data-act="asub" data-v="${E(x)}">${ic(subIcon(x))}${E(x)}</button>`).join('')}</div>` : ''}
<input type="text" id="note" data-in="note" placeholder="Note (facultatif)" value="${E(A.note)}">
${A.type === 'out' ? `<label class="chk"><input type="checkbox" data-in="pending" ${A.pending ? 'checked' : ''}> En attente de la banque (pas encore dans l’export)</label>` : ''}
<div class="keys">${['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'].map((k) => `<button class="key" data-act="key" data-v="${k}">${k}</button>`).join('')}</div>
<button class="btn" data-act="asave">${ic('check')}Enregistrer</button>`;
}

function opsScreen() {
  const d = store.get();
  const per = periodFn(d);
  const F = [['all', 'Tout'], ['needs', 'Besoins'], ['wants', 'Envies'], ['savings', 'Épargne'], ['todo', 'À classer']];
  let list = d.transactions.filter((t) => per(t) === U.month);
  if (U.filter === 'todo') list = list.filter((t) => !t.bucket);
  else if (U.filter !== 'all') list = list.filter((t) => t.bucket === U.filter);
  list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  let html = '';
  let rows = '';
  let last = '';
  const flushRows = () => {
    if (rows) html += `<div class="grp">${rows}</div>`;
    rows = '';
  };
  for (const t of list) {
    if (t.date !== last) {
      flushRows();
      last = t.date;
      html += `<div class="sm" style="margin-top:2px;font-weight:600;text-transform:capitalize">${E(dayLabel(t.date))}</div>`;
    }
    rows += opRow(t, per);
  }
  flushRows();
  return `<div class="hd"><h1>Opérations</h1><button class="ib" data-act="go" data-v="import" aria-label="Importer un export">${ic('upload')}</button></div>
${monthBar()}
<div class="chips">${F.map(([k, l]) => `<button class="chip ${BUCKETS[k] ? `b-${k}` : ''} ${U.filter === k ? 'on' : ''}" data-act="filter" data-v="${k}">${l}</button>`).join('')}</div>
${html || `<div class="card empty">${logo(52)}<b>Aucune opération</b><div class="sm">Rien dans ce filtre pour ${E(monthLabel(U.month))}.</div></div>`}`;
}

function editScreen() {
  const d = store.get();
  const t = d.transactions.find((x) => x.id === U.edit?.id);
  if (!t) return (U.tab = 'ops'), opsScreen();
  const key = ruleKeyOf(t.label);
  const all = [...BUCKET_KEYS, 'income', 'ignore'];
  const c = bucketColor(t.bucket);
  return `<div class="hd"><button class="ib" data-act="eclose" aria-label="Retour">${ic('back')}</button><b style="font-size:17px">Opération</b><span style="width:40px"></span></div>
<div class="card"><div class="row" style="padding:0"><div class="opic" style="--c:${c}">${ic(opIconName(t))}</div><div class="grow"><div style="font-size:17px;font-weight:700;white-space:normal">${E(t.label)}</div><div class="sm">${E(dayLabel(t.date))}</div></div><div class="amt" style="font-size:17px">${eur2(t.amount).replace('-', '−')}</div></div></div>
<b style="font-size:14px">Catégorie</b>
<div class="chips">${all.map((b) => bucketChip(b, t.bucket === b, 'ebucket', b)).join('')}</div>
${SUBS[t.bucket] ? `<div class="chips">${SUBS[t.bucket].map((x) => `<button class="chip b-${t.bucket} ${t.sub === x ? 'on' : ''}" data-act="esub" data-v="${E(x)}">${ic(subIcon(x))}${E(x)}</button>`).join('')}</div>` : ''}
${isWithdrawal(t) ? `<b style="font-size:14px">Cet argent a financé</b><div class="chips">${[['needs', 'Besoins'], ['wants', 'Envies']].map(([v, l]) => `<button class="chip b-${v} ${(t.covers === 'wants' ? 'wants' : 'needs') === v ? 'on' : ''}" data-act="ecovers" data-v="${v}">${l}</button>`).join('')}</div><div class="sm">Un retrait d’épargne qui finance une dépense (frais de véhicule, par exemple) n’est pas compté contre ton budget du mois.</div>` : ''}
${t.bucket === 'income' && key ? `<label class="chk"><input type="checkbox" data-in="paycheck" ${payKeysOf(d.settings).includes(key) ? 'checked' : ''}> C’est ma paye : elle ouvre le mois budgétaire</label>` : ''}
${(() => {
    const base = t.date.slice(0, 7);
    const cur = t.period || 'auto';
    const opts = [['auto', 'Automatique'], [shiftMonth(base, -1), monthLabel(shiftMonth(base, -1))], [base, monthLabel(base)], [shiftMonth(base, 1), monthLabel(shiftMonth(base, 1))]];
    return `<b style="font-size:14px">Compté dans le budget de</b><div class="chips">${opts.map(([v, l]) => `<button class="chip ${cur === v ? 'on' : ''}" data-act="eperiod" data-v="${v}">${E(l)}</button>`).join('')}</div><div class="sm">Laisse « Automatique » sauf si l’opération appartient à un autre mois.</div>`;
  })()}
${key ? `<label class="chk"><input type="checkbox" data-in="always" ${U.edit.always ? 'checked' : ''}> Toujours classer « ${E(key)} » ainsi</label>` : ''}
<button class="btn dng" data-act="edel">Supprimer l’opération</button>`;
}

function importScreen() {
  const d = store.get();
  const I = U.imp;
  const web = d.settings.bankMode === 'web';
  const bank = `<button class="btn sec" data-act="bank">${ic('bank')}1 · Ouvrir ${web ? 'le site' : 'l’appli'} BoursoBank</button>`;
  if (!I) {
    return `${backBar('go', 'ops', 'Importer un export')}
<div class="card"><div class="row" style="padding:0">${`<div class="opic" style="--c:#1D9E75">${ic('bank')}</div>`}<div class="sm grow" style="white-space:normal">${web ? 'Sur le site BoursoBank : ouvre ton compte, affiche les mouvements de la période voulue, puis exporte-les au format CSV.' : 'Dans l’appli BoursoBank : utilise la loupe pour choisir la période voulue, puis exporte les opérations au format CSV.'} Reviens ici ensuite.</div></div></div>
${bank}<button class="btn" data-act="pickcsv">${ic('upload')}2 · Choisir le fichier</button>`;
  }
  if (I.error) {
    return `${backBar('iclose', '', 'Importer un export')}<div class="banner" style="color:var(--danger)">${E(I.error)}</div><button class="btn" data-act="pickcsv">Choisir un autre fichier</button>`;
  }
  const open = I.groups.filter((g) => !g.bucket).length;
  return `${backBar('iclose', '', 'Importer un export')}
<div class="card"><div style="font-weight:600">${E(I.name)}</div><div class="sm">${I.fresh.length + I.dup} opérations lues${I.skipped ? ` · ${I.skipped} lignes ignorées` : ''}</div></div>
<div class="tiles"><div class="tile"><b>${I.fresh.length}</b><span class="sm">nouvelles</span></div><div class="tile"><b>${I.dup}</b><span class="sm">déjà là</span></div><div class="tile"><b>${I.groups.reduce((n, g) => n + g.count, 0)}</b><span class="sm">à classer</span></div></div>
${I.groups.length ? `<b style="font-size:14px">À classer avant d’importer</b>${I.groups.map((g, i) => `<div class="card"><div class="line"><span>${E(g.label)}${g.count > 1 ? ` <span class="sm">×${g.count}</span>` : ''}</span><b>${eur2(g.total).replace('-', '−')}</b></div><div class="chips" style="margin-top:10px">${BUCKET_KEYS.concat(['income', 'ignore']).map((b) => bucketChip(b, g.bucket === b, 'ibucket', `${i}:${b}`)).join('')}</div></div>`).join('')}` : ''}
${I.confirmed ? `<div class="banner" style="cursor:default">${ic('check')}<span class="grow">${I.confirmed} opération${I.confirmed > 1 ? 's' : ''} saisie${I.confirmed > 1 ? 's' : ''} « en attente » confirmée${I.confirmed > 1 ? 's' : ''} par la banque</span></div>` : ''}
${I.anchor ? `<div class="sm" style="text-align:center">Solde du compte lu dans le fichier : <b>${eur2(I.anchor.balance)}</b> au ${E(longDay(I.anchor.date))}</div>` : ''}
<button class="btn" data-act="idoimport" style="margin-top:auto">${ic('check')}${I.fresh.length ? `Importer ${I.fresh.length} opération${I.fresh.length > 1 ? 's' : ''}${open ? ` (${open} resteront à classer)` : ''}` : I.anchor ? 'Mettre à jour le solde' : 'Rien de nouveau'}</button>`;
}

function detailScreen() {
  const d = store.get();
  const s = summarize(d, U.month);
  const sg = (n) => (n > 0.004 ? '+' : n < -0.004 ? '−' : '') + eur2(Math.abs(n));
  const line = (l, v, o = {}) => `<div class="line" style="padding:5px 0;${o.b ? 'font-weight:700;' : ''}"><span>${l}</span><span${o.c ? ` style="color:var(--${o.c})"` : ''}>${v}</span></div>`;
  const small = (t) => `<div class="sm" style="margin:2px 0 6px">${t}</div>`;
  const pays = paydays(d);
  const i = pays.findIndex((p) => cycleLabel(p.date) === U.month);
  const range = i >= 0 ? ` · du ${longDay(pays[i].date)} ${pays[i + 1] ? `au ${longDay(dayBefore(pays[i + 1].date))}` : 'à aujourd’hui'}` : '';
  const rec = reconcile(d, U.month);
  const compare = rec
    ? `<div class="card"><b>Pour comparer avec ta banque</b>
${rec.pendingIn ? line(`Solde du compte au ${E(longDay(rec.end))}`, eur2(rec.closing)) + line('Opérations en attente', sg(rec.pendingIn)) + `<div class="sep" style="margin:4px 0"></div>` + line('Solde estimé', eur2(rec.estimated), { b: 1 }) : line(`Solde du compte au ${E(longDay(rec.end))}`, eur2(rec.estimated), { b: 1 })}
${small('À comparer avec le solde affiché par ta banque.')}
${line(`Solde la veille de la paye (${E(longDay(rec.openingDay))})`, sg(-rec.opening))}
${Math.abs(rec.elsewhere) > 0.004 ? line('Opérations de la période comptées dans un autre mois', sg(-rec.elsewhere)) + small('Par exemple ton virement d’épargne de clôture.') : ''}
${Math.abs(rec.brought) > 0.004 ? line('Opérations d’autres dates comptées ici', sg(rec.brought)) : ''}
${Math.abs(rec.cash) > 0.004 ? line('Opérations hors banque (espèces…)', sg(rec.cash)) : ''}
<div class="sep" style="margin:4px 0"></div>
${line('Somme des opérations de ce mois', sg(rec.sumOps), { b: 1 })}
${small('Le solde de départ se déduit du solde de ton export : tu n’as rien à saisir.')}
</div>`
    : `<div class="card"><b>Pour comparer avec ta banque</b>
${line('Somme de toutes les opérations', sg(s.allSum))}
${small(`${s.count} opération${s.count > 1 ? 's' : ''}${s.lastDate ? ` · la plus récente : ${E(longDay(s.lastDate))}` : ''}`)}
<div class="sm">Importe un export BoursoBank pour voir le solde de ton compte et le rapprocher de ce calcul.</div>
</div>`;
  const misc = [];
  if (s.pending.count) misc.push(line(`${s.pending.count} opération${s.pending.count > 1 ? 's' : ''} à classer`, sg(s.pending.sum), { c: 'warn' }) + small(`Non déduites du reste. Reste si on les déduit : <b>${eur2(s.restIfPending)}</b>.`) + `<button class="chip" data-act="todo">Voir les opérations à classer</button>`);
  if (s.ignored.count) misc.push(line(`${s.ignored.count} opération${s.ignored.count > 1 ? 's' : ''} ignorée${s.ignored.count > 1 ? 's' : ''}`, sg(s.ignored.sum)) + small('Classées « Ignoré » : exclues du calcul, mais elles ont bien bougé sur ton compte.'));
  if (s.surplus > 0.004) misc.push(line('Retraits d’épargne non utilisés', eur2(s.surplus)) + small('Part des retraits supérieure aux dépenses qu’ils financent.'));
  return `${backBar('go', 'home', 'Détail du calcul')}
<div class="sm" style="text-align:center">${E(monthLabel(U.month))}${E(range)}</div>
<div class="card">
${line('Revenus', s.income > 0 ? sg(s.base) : `${sg(s.base)} <span class="sm">(réglage)</span>`)}
${s.shiftedIn > 0.004 ? small(`dont ${eur2(s.shiftedIn)} reçus un autre mois et comptés ici`) : ''}
${line('Besoins', sg(-s.net.needs))}${line('Envies', sg(-s.net.wants))}${line('Épargne versée', sg(-s.spent.savings))}
<div class="sep" style="margin:4px 0"></div>
${line('Reste ce mois', sg(s.rest), { b: 1 })}
${s.covered.needs + s.covered.wants > 0.004 ? small(`Les ${eur2(s.covered.needs + s.covered.wants)} de dépenses financées par un retrait d’épargne ne sont pas déduits.`) : ''}
</div>
<div class="card"><b>Pas pris en compte</b>
${misc.length ? misc.join('<div class="sep" style="margin:6px 0"></div>') : small('Rien : toutes les opérations du mois sont comptées.')}
</div>
${compare}`;
}

function histScreen() {
  const d = store.get();
  const months = [...new Set([todayISO().slice(0, 7), ...monthsOf(d)])].sort().reverse().slice(0, 6);
  const legend = BUCKET_KEYS.map((k) => `<span class="sm"><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${BUCKETS[k].color};margin-right:5px"></i>${BUCKETS[k].label}</span>`).join(' ');
  const T = d.settings.targets;
  return `<h1>Historique</h1><div class="chips" style="gap:16px">${legend}</div>
${months.map((m) => {
    const s = summarize(d, m);
    const ok = s.base > 0 && s.pct.needs <= T.needs && s.pct.wants <= T.wants && s.pct.savings >= T.savings;
    return `<div class="card tap" data-act="gomonth" data-v="${m}" style="cursor:pointer"><div class="line" style="margin-bottom:8px;align-items:center"><b>${E(monthLabel(m))}</b>${ok ? '<span class="pill ok">Cible atteinte</span>' : `<span class="sm">${s.pct.needs} / ${s.pct.wants} / ${s.pct.savings}</span>`}</div><div class="stack">${BUCKET_KEYS.map((k) => `<i style="width:${Math.min(100, s.pct[k])}%;background:${BUCKETS[k].color}"></i>`).join('')}</div>${ok ? `<div class="sm" style="margin-top:6px">${s.pct.needs} / ${s.pct.wants} / ${s.pct.savings}</div>` : ''}</div>`;
  }).join('')}
<div class="sm" style="text-align:center">Cible ${T.needs} / ${T.wants} / ${T.savings} (besoins / envies / épargne)</div>`;
}

function ago(ts) {
  if (!ts) return '';
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? 'à l’instant' : m < 60 ? `il y a ${m} min` : `il y a ${Math.round(m / 60)} h`;
}

const sTitle = (icon, text, color) => `<div class="stitle"><div class="opic" style="--c:${color}">${ic(icon)}</div>${text}</div>`;

function setScreen() {
  const d = store.get();
  const S = sync.state;
  const T = d.settings.targets;
  const keys = payKeysOf(d.settings);
  const st = { off: 'Pas encore de fichier', idle: 'Prêt', syncing: 'Synchronisation…', ok: `Synchronisé · ${ago(S.last)}`, error: 'Erreur de synchronisation' }[S.status];
  const upd = U.upd;
  return `<h1>Réglages</h1>
<div class="card">${sTitle('cloud', 'Données', '#1D9E75')}
<div class="sm">${S.ref ? `Fichier : ${E(S.ref.name)}` : 'Choisis un fichier sur le téléphone ou dans Google Drive. Il est synchronisé automatiquement après chaque action.'}</div>
<div style="color:var(--${S.status === 'error' ? 'danger' : 'muted'});margin:6px 0 10px;font-size:14px">${E(st)}${S.error ? ` — ${E(S.error)}` : ''}</div>
<div class="chips"><button class="chip" data-act="pickfile" data-v="new">Créer un fichier</button><button class="chip" data-act="pickfile" data-v="open">Ouvrir un fichier existant</button>${S.ref ? '<button class="chip" data-act="syncnow">Synchroniser</button>' : ''}</div></div>
<div class="card">${sTitle('calendar', 'Ta paye', '#EF9F27')}
<div class="sm" style="margin-bottom:8px">Chaque virement de paye ouvre un mois budgétaire, quelle que soit sa date.</div>
${keys.length ? `<div class="chips">${keys.map((k) => `<span class="chip on" style="cursor:default">${E(k)} <span data-act="rmpay" data-v="${E(k)}" style="cursor:pointer;margin-left:8px" aria-label="Retirer">×</span></span>`).join('')}</div>` : '<div class="sm">Aucune paye définie : les mois suivent le calendrier.</div>'}
<div class="chips" style="margin-top:10px"><button class="chip" data-act="detectpay">Détecter ma paye</button></div>
${keys.length ? '' : `<div class="sm" style="margin:12px 0 4px">Sinon : revenus reçus à partir du jour … comptés le mois suivant (0 = désactivé)</div><input type="number" inputmode="numeric" min="0" max="31" data-in="shiftday" value="${d.settings.incomeShiftDay || 0}">`}</div>
<div class="card">${sTitle('wallet', 'Budget', '#7F77DD')}
<div class="sm" style="margin:0 0 4px">Revenus mensuels (si aucun salaire importé)</div><input type="number" inputmode="decimal" data-in="income" value="${d.settings.income || ''}" placeholder="2400">
<div class="sm" style="margin:12px 0 4px">Cibles en % : besoins / envies / épargne</div>
<div class="chips" style="flex-wrap:nowrap">${BUCKET_KEYS.map((k) => `<input type="number" inputmode="numeric" data-in="t-${k}" value="${T[k]}" aria-label="${BUCKETS[k].label}">`).join('')}</div></div>
<div class="card">${sTitle('bank', 'BoursoBank', '#378ADD')}<div class="sm" style="margin:0 0 8px">Le bouton d’export ouvre :</div>
<div class="chips"><button class="chip f ${d.settings.bankMode !== 'web' ? 'on' : ''}" data-act="bankmode" data-v="app">L’appli</button><button class="chip f ${d.settings.bankMode === 'web' ? 'on' : ''}" data-act="bankmode" data-v="web">Le site web</button></div>
<div class="sm" style="margin:12px 0 4px">Adresse du site (mode « site web » ou si l’appli est absente)</div><input type="text" data-in="bankurl" value="${E(d.settings.bankUrl)}"></div>
<div class="card">${sTitle('info', `Version ${E(VERSION)}`, '#888780')}
<div class="sm" style="margin:0 0 10px">${!upd ? 'Vérifie s’il existe une nouvelle version sur GitHub.' : upd.state === 'checking' ? 'Vérification…' : upd.state === 'error' ? E(upd.msg) : upd.newer ? `Version ${E(upd.version)} disponible.` : 'Tu as la dernière version.'}</div>
<div class="chips"><button class="chip" data-act="checkupd">Vérifier</button>${upd?.newer ? '<button class="chip on" data-act="getupd">Télécharger</button>' : ''}</div></div>`;
}

/* ---------- rendu ---------- */
const NAV = [['home', 'home', 'Accueil'], ['ops', 'list', 'Opérations'], ['add'], ['hist', 'chart', 'Historique'], ['set', 'settings', 'Réglages']];

function render() {
  const screens = { home, detail: detailScreen, add: addScreen, ops: opsScreen, edit: editScreen, import: importScreen, hist: histScreen, set: setScreen };
  const hideNav = U.tab === 'add' || U.tab === 'edit';
  const body = screens[U.tab]();
  const changed = U.tab !== lastTab;
  lastTab = U.tab;
  const nav = hideNav
    ? ''
    : `<div class="nav">${NAV.map((n) => (n.length === 1 ? `<button class="fab" data-act="go" data-v="add" aria-label="Ajouter">${ic('plus')}</button>` : `<button class="nb ${U.tab === n[0] || (U.tab === 'import' && n[0] === 'ops') || (U.tab === 'detail' && n[0] === 'home') ? 'on' : ''}" data-act="go" data-v="${n[0]}"><span class="nbi">${ic(n[1])}</span>${n[2]}</button>`)).join('')}</div>`;
  const keep = changed ? 0 : root.querySelector('.screen')?.scrollTop || 0;
  root.innerHTML = `<div class="screen${changed ? ' anim' : ''}">${body}</div>${nav}${U.flash ? `<div class="toast">${E(U.flash)}</div>` : ''}`;
  const sc = root.querySelector('.screen');
  if (sc) sc.scrollTop = keep;
}

/* ---------- actions ---------- */
const ACT = {
  go: (v) => {
    U.tab = v;
    if (v === 'add') U.add = { amt: '', type: 'out', bucket: 'wants', sub: 'Restau', note: '' };
  },
  detail: () => (U.tab = 'detail'),
  month: (v) => (U.month = shiftMonth(U.month, +v)),
  gomonth: (v) => {
    U.month = v;
    U.tab = 'home';
  },
  todo: () => {
    U.filter = 'todo';
    U.tab = 'ops';
  },
  filter: (v) => (U.filter = v),
  atype: (v) => (U.add.type = v),
  abucket: (v) => {
    U.add.bucket = v;
    U.add.sub = SUBS[v][0];
  },
  asub: (v) => (U.add.sub = v),
  key: (k) => {
    const A = U.add;
    if (k === '⌫') A.amt = A.amt.slice(0, -1);
    else if (k === ',') {
      if (!A.amt.includes('.')) A.amt = (A.amt || '0') + '.';
    } else if (A.amt.length < 9 && !(A.amt.includes('.') && A.amt.split('.')[1].length >= 2)) A.amt += k;
  },
  asave: () => {
    const A = U.add;
    const v = parseFloat(A.amt);
    if (!(v > 0)) return flash('Saisis un montant');
    const out = A.type === 'out';
    store.addTx({
      date: todayISO(),
      label: A.note.trim() || (out ? A.sub || bucketLabel(A.bucket) : 'Revenu'),
      amount: out ? -v : v,
      bucket: out ? A.bucket : 'income',
      sub: out ? A.sub : '',
      note: A.note.trim(),
      ...(out && A.pending ? { pending: true } : {}),
    });
    U.month = todayISO().slice(0, 7);
    U.tab = 'home';
    flash('Enregistré');
  },
  edit: (v) => {
    U.edit = { id: v, always: true };
    U.tab = 'edit';
  },
  eclose: () => (U.tab = 'ops'),
  ebucket: (v) => {
    const t = store.get().transactions.find((x) => x.id === U.edit.id);
    // Argent qui rentre classé en Épargne = retrait d'épargne
    store.updateTx(t.id, { bucket: v, sub: v === 'savings' && t.amount > 0 ? RETRAIT : '', covers: '' });
    const k = ruleKeyOf(t.label);
    if (U.edit.always && k) {
      const n = store.addRule({ k, bucket: v });
      if (n) flash(n === 1 ? '1 autre opération classée' : `${n} autres opérations classées`);
    }
  },
  esub: (v) => store.updateTx(U.edit.id, { sub: v }),
  ecovers: (v) => store.updateTx(U.edit.id, { covers: v }),
  eperiod: (v) => store.updateTx(U.edit.id, { period: v === 'auto' ? '' : v }),
  edel: () => {
    if (!window.confirm('Supprimer cette opération ?')) return;
    store.deleteTx(U.edit.id);
    U.tab = 'ops';
    flash('Supprimée');
  },
  detectpay: () => {
    const d = store.get();
    const c = suggestPay(d);
    if (!c) return flash('Aucun revenu trouvé : importe d’abord un export');
    if (payKeysOf(d.settings).includes(c.key)) return flash('Ta paye est déjà enregistrée');
    if (!window.confirm(`Ta paye est-elle « ${c.label} » (${eur2(c.amount)}) ?`)) return;
    store.setSettings({ payKeys: [...new Set([...payKeysOf(d.settings), c.key])] });
    flash('Paye enregistrée : les mois suivent ton salaire');
  },
  rmpay: (v) => store.setSettings({ payKeys: payKeysOf(store.get().settings).filter((k) => k !== v) }),
  pickcsv: () => document.getElementById('csv').click(),
  bank: async () => {
    const s = store.get().settings;
    if (s.bankMode !== 'web') {
      if (await storage.openApp(BANK_PKG)) return;
      flash('Appli BoursoBank introuvable : ouverture du site');
    }
    await storage.openBrowser(s.bankUrl).catch((e) => flash(e?.message || 'Ouverture impossible'));
  },
  bankmode: (v) => store.setSettings({ bankMode: v }),
  iclose: () => (U.imp = null),
  ibucket: (v) => {
    const [i, b] = v.split(':');
    const g = U.imp.groups[+i];
    g.bucket = g.bucket === b ? '' : b;
  },
  idoimport: () => {
    const I = U.imp;
    for (const g of I.groups) {
      if (!g.bucket) continue;
      for (const j of g.idxs) I.fresh[j].bucket = g.bucket;
      if (!g.key.startsWith('#')) store.addRule({ k: g.key, bucket: g.bucket });
    }
    store.addMany(I.fresh.map((t) => ({ date: t.date, label: t.label, amount: t.amount, bucket: t.bucket, sub: t.sub || (t.bucket === 'savings' && t.amount > 0 ? RETRAIT : ''), hash: t.hash, source: 'import' })));
    for (const t of I.fresh) if (t.replaces) store.deleteTx(t.replaces); // saisie « en attente » confirmée par la banque
    store.setAccount(I.anchor);
    const n = I.fresh.length;
    const last = I.fresh.map((t) => t.date).sort().pop();
    U.imp = null;
    if (last) U.month = last.slice(0, 7);
    U.tab = 'home';
    const c = I.confirmed ? ` · ${I.confirmed} en attente confirmée${I.confirmed > 1 ? 's' : ''}` : '';
    flash(n ? `${n} opération${n > 1 ? 's' : ''} importée${n > 1 ? 's' : ''}${c}` : 'Solde du compte mis à jour');
  },
  pickfile: async (v) => {
    try {
      await sync.choose(v === 'new');
      flash('Fichier connecté');
    } catch (e) {
      if (String(e?.message || e).includes('cancel') || e?.name === 'AbortError') return;
      flash(e?.message || 'Impossible de choisir le fichier');
    }
  },
  syncnow: () => sync.now(),
  checkupd: async () => {
    U.upd = { state: 'checking' };
    render();
    try {
      U.upd = { state: 'done', ...(await checkUpdate()) };
    } catch (e) {
      U.upd = { state: 'error', msg: e.message || 'Vérification impossible' };
    }
  },
  getupd: () => storage.openBrowser(U.upd.url, { fallback: true }).catch((e) => flash(`Ouverture impossible : ${e?.message || e}`)),
};

function onInput(el) {
  const k = el.dataset.in;
  if (k === 'note') U.add.note = el.value;
}
function onChange(el) {
  const k = el.dataset.in;
  const d = store.get();
  if (k === 'income') store.setSettings({ income: Math.max(0, parseFloat(el.value) || 0) });
  else if (k === 'shiftday') store.setSettings({ incomeShiftDay: Math.min(31, Math.max(0, parseInt(el.value, 10) || 0)) });
  else if (k?.startsWith('t-')) store.setSettings({ targets: { ...d.settings.targets, [k.slice(2)]: Math.max(0, parseInt(el.value, 10) || 0) } });
  else if (k === 'bankurl') store.setSettings({ bankUrl: /^https:\/\//.test(el.value.trim()) ? el.value.trim() : d.settings.bankUrl });
  else if (k === 'always') U.edit.always = el.checked;
  else if (k === 'pending') U.add.pending = el.checked;
  else if (k === 'paycheck') {
    const t = d.transactions.find((x) => x.id === U.edit?.id);
    const key = t && ruleKeyOf(t.label);
    if (!key) return;
    const keys = payKeysOf(d.settings);
    store.setSettings({ payKeys: el.checked ? [...new Set([...keys, key])] : keys.filter((x) => x !== key) });
  }
}

async function onCsv(ev) {
  const f = ev.target.files?.[0];
  ev.target.value = '';
  if (!f) return;
  U.tab = 'import';
  try {
    let buf = await f.arrayBuffer();
    if (isZip(buf)) buf = (await unzipFirst(buf)).bytes;
    const parsed = parseBoursorama(decodeBuffer(buf));
    if (!parsed.ok) U.imp = { error: parsed.error };
    else if (!parsed.transactions.length) U.imp = { error: 'Aucune opération trouvée dans ce fichier.' };
    else U.imp = { name: f.name, skipped: parsed.skipped, anchor: parsed.anchor, ...prepareImport(parsed.transactions, store.get()) };
  } catch (e) {
    U.imp = { error: e?.message?.includes('ZIP') || e?.message?.includes('archive') ? e.message : 'Lecture du fichier impossible.' };
  }
  render();
}

// Bouton retour d'Android : renvoie true si l'appli a géré le retour, false à l'Accueil (l'appli se ferme alors).
export function goBack() {
  const next = backFrom(U.tab, !!U.imp);
  if (!next) return false;
  if (next.clearImport) U.imp = null;
  U.tab = next.tab;
  render();
  return true;
}

export function init(el) {
  root = el;
  el.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    try {
      await ACT[a.dataset.act]?.(a.dataset.v, a);
    } catch (err) {
      flash(err?.message || 'Une erreur est survenue');
    }
    render();
  });
  el.addEventListener('input', (e) => e.target.closest('[data-in]') && onInput(e.target));
  el.addEventListener('change', (e) => {
    if (e.target.closest('[data-in]')) {
      onChange(e.target);
      render();
    }
  });
  document.getElementById('csv').addEventListener('change', onCsv);
  store.onChange(() => render());
  sync.onState(() => render());
  render();
}
