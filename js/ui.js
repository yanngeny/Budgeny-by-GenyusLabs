// Écrans de l'appli (voir les maquettes) : accueil, ajout rapide, opérations, import, historique, réglages.
import * as store from './store.js';
import * as sync from './sync.js';
import * as storage from './storage.js';
import { BANK_PKG, BUCKETS, BUCKET_KEYS, SUBS, bucketLabel, bucketColor, summarize, monthsOf, todayISO, shiftMonth, periodOf, isWithdrawal, RETRAIT } from './model.js';
import { decodeBuffer, parseBoursorama, prepareImport, ruleKeyOf } from './csv.js';
import { isZip, unzipFirst } from './zip.js';
import { checkUpdate } from './update.js';
import { VERSION } from './version.js';

const ICON = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  chart: '<path d="M5 20V11M12 20V4M19 20v-6"/>',
  settings: '<path d="M4 6h8M16 6h4M4 12h4M12 12h8M4 18h10M18 18h2"/><circle cx="14" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
};
const ic = (n) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

const E = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (n, d = 0) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' €';
const eur2 = (n) => eur(n, 2);
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const monthLabel = (k) => {
  const [y, m] = k.split('-');
  const name = MONTHS[+m - 1];
  return `${name[0].toUpperCase()}${name.slice(1)} ${y}`;
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
const flash = (m) => {
  U.flash = m;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    U.flash = '';
    render();
  }, 2600);
};

/* ---------- composants ---------- */
const monthNav = () => `<div class="hd"><button class="ib" data-act="month" data-v="-1" aria-label="Mois précédent">${ic('left')}</button><div style="text-align:center"><h1>${E(monthLabel(U.month))}</h1></div><button class="ib" data-act="month" data-v="1" aria-label="Mois suivant">${ic('right')}</button></div>`;

function opRow(t) {
  const c = bucketColor(t.bucket);
  const per = periodOf(t, store.get().settings);
  const shifted = per !== t.date.slice(0, 7) ? `compté en ${monthLabel(per).split(' ')[0].toLowerCase()}` : '';
  const funds = isWithdrawal(t) ? `finance les ${t.covers === 'wants' ? 'envies' : 'besoins'}` : '';
  const sub = [bucketLabel(t.bucket), t.sub, funds, shifted].filter(Boolean).join(' · ');
  return `<div class="row tap" data-act="edit" data-v="${E(t.id)}"><div class="dot" style="background:${c}33;color:${c}">${E((t.label[0] || '?').toUpperCase())}</div><div class="grow"><div>${E(t.label)}</div><div class="sm">${E(sub)}</div></div><div class="amt ${t.amount > 0 ? 'pos' : ''}">${t.amount > 0 ? '+' : ''}${eur2(t.amount).replace('-', '−')}</div></div>`;
}

function bucketBar(k, s, d) {
  const p = s.pct[k];
  const t = d.settings.targets[k];
  const ok = k === 'savings' ? p >= t : p <= t;
  const diff = p - t;
  const txt = ok ? (k === 'savings' ? 'Cible atteinte' : 'Dans la cible') : `${diff > 0 ? '+' : '−'}${Math.abs(diff)} pts`;
  const w = Math.min(100, (p / 60) * 100);
  const color = BUCKETS[k].color;
  // Part financée par un retrait d'épargne : barre hachurée au-delà de la part « budget courant »
  const cov = s.covered[k] || 0;
  const gp = s.base > 0 ? Math.round((s.spent[k] / s.base) * 100) : p;
  const hatch = cov > 0 ? `<i style="width:${Math.min(100, (gp / 60) * 100)}%;background:repeating-linear-gradient(135deg,${color} 0 4px,transparent 4px 8px);opacity:.6"></i>` : '';
  const note = cov > 0 ? `<div class="sm">dont ${eur(cov)} financés par l’épargne</div>` : k === 'savings' && s.withdrawn > 0 ? `<div class="sm">${eur(s.withdrawn)} retirés de l’épargne</div>` : '';
  return `<div><div class="line"><b>${bucketLabel(k)}</b><span>${eur(s.spent[k])}</span></div><div class="bar">${hatch}<i style="width:${w}%;background:${color}"></i><b style="left:${Math.min(100, (t / 60) * 100)}%"></b></div><div class="line sm"><span>${p} % · cible ${t} %</span><span style="color:var(--${ok ? 'ok' : 'warn'})">${txt}</span></div>${note}</div>`;
}

/* ---------- écrans ---------- */
function home() {
  const d = store.get();
  const s = summarize(d, U.month);
  const recent = d.transactions.filter((t) => periodOf(t, d.settings) === U.month).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5);
  const noFile = !sync.state.ref;
  return `${monthNav()}
${noFile ? `<div class="banner" data-act="go" data-v="set">${ic('settings')}<span class="grow">Choisis où enregistrer tes données (téléphone ou Google Drive)</span>${ic('right')}</div>` : ''}
${s.base > 0 ? `<div class="card line tap" data-act="detail" style="cursor:pointer"><div><div class="sm">Revenus</div><b style="font-size:19px">${eur(s.base)}</b></div><div style="text-align:right"><div class="sm">Reste ce mois · détail ›</div><b style="font-size:19px">${eur(s.rest)}</b></div></div>` : `<div class="banner" data-act="go" data-v="set"><span class="grow">Renseigne tes revenus mensuels dans les réglages, ou importe ton salaire.</span>${ic('right')}</div>`}
<div class="card" style="display:flex;flex-direction:column;gap:14px">${BUCKET_KEYS.map((k) => bucketBar(k, s, d)).join('')}</div>
${s.todo ? `<div class="banner" data-act="todo">${ic('list')}<span class="grow">${s.todo} opération${s.todo > 1 ? 's' : ''} à catégoriser</span>${ic('right')}</div>` : ''}
${recent.length ? `<b style="font-size:14px">Dernières opérations</b>${recent.map(opRow).join('')}` : `<div class="card"><b>Rien pour ce mois</b><div class="sm">Importe ton export BoursoBank ou ajoute une dépense avec le bouton +.</div></div>`}`;
}

function addScreen() {
  const A = U.add;
  const subs = SUBS[A.bucket] || [];
  return `<div class="hd"><button class="ib" data-act="go" data-v="home" aria-label="Fermer">${ic('x')}</button><b>Nouvelle opération</b><span style="width:34px"></span></div>
<div class="chips"><button class="chip f ${A.type === 'out' ? 'on' : ''}" data-act="atype" data-v="out">Dépense</button><button class="chip f ${A.type === 'in' ? 'on' : ''}" data-act="atype" data-v="in">Revenu</button></div>
<div><div class="big">${A.amt ? E(A.amt.replace('.', ',')) : '0'} €</div><div class="sm" style="text-align:center">Aujourd’hui · ${E(store.get().settings.me)}</div></div>
${A.type === 'out' ? `<div class="chips">${BUCKET_KEYS.map((b) => `<button class="chip f ${A.bucket === b ? 'on' : ''}" data-act="abucket" data-v="${b}">${BUCKETS[b].label}</button>`).join('')}</div>
<div class="chips">${subs.map((x) => `<button class="chip ${A.sub === x ? 'on' : ''}" data-act="asub" data-v="${E(x)}">${E(x)}</button>`).join('')}</div>` : ''}
<input type="text" id="note" data-in="note" placeholder="Note (facultatif)" value="${E(A.note)}">
<div class="keys">${['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'].map((k) => `<button class="key" data-act="key" data-v="${k}">${k}</button>`).join('')}</div>
<button class="btn" data-act="asave">Enregistrer</button>`;
}

function opsScreen() {
  const d = store.get();
  const F = [['all', 'Tout'], ['needs', 'Besoins'], ['wants', 'Envies'], ['savings', 'Épargne'], ['todo', 'À classer']];
  let list = d.transactions.filter((t) => periodOf(t, d.settings) === U.month);
  if (U.filter === 'todo') list = list.filter((t) => !t.bucket);
  else if (U.filter !== 'all') list = list.filter((t) => t.bucket === U.filter);
  list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  let html = '';
  let last = '';
  for (const t of list) {
    if (t.date !== last) {
      last = t.date;
      html += `<div class="sm" style="margin-top:6px;text-transform:capitalize">${E(dayLabel(t.date))}</div>`;
    }
    html += opRow(t);
  }
  return `<div class="hd"><h1>Opérations</h1><button class="ib" data-act="go" data-v="import" aria-label="Importer un export">${ic('upload')}</button></div>
${monthNav()}
<div class="chips">${F.map(([k, l]) => `<button class="chip ${U.filter === k ? 'on' : ''}" data-act="filter" data-v="${k}">${l}</button>`).join('')}</div>
${html || '<div class="sm">Aucune opération.</div>'}`;
}

function editScreen() {
  const d = store.get();
  const t = d.transactions.find((x) => x.id === U.edit?.id);
  if (!t) return (U.tab = 'ops'), opsScreen();
  const key = ruleKeyOf(t.label);
  const all = [...BUCKET_KEYS, 'income', 'ignore'];
  return `<div class="hd"><button class="ib" data-act="eclose" aria-label="Retour">${ic('back')}</button><b>Opération</b><span style="width:34px"></span></div>
<div class="card"><div style="font-size:17px;font-weight:600">${E(t.label)}</div><div class="line sm"><span>${E(dayLabel(t.date))}</span><b style="color:var(--text)">${eur2(t.amount).replace('-', '−')}</b></div></div>
<b style="font-size:14px">Catégorie</b>
<div class="chips">${all.map((b) => `<button class="chip ${t.bucket === b ? 'on' : ''}" data-act="ebucket" data-v="${b}">${bucketLabel(b)}</button>`).join('')}</div>
${SUBS[t.bucket] ? `<div class="chips">${SUBS[t.bucket].map((x) => `<button class="chip ${t.sub === x ? 'on' : ''}" data-act="esub" data-v="${E(x)}">${E(x)}</button>`).join('')}</div>` : ''}
${isWithdrawal(t) ? `<b style="font-size:14px">Cet argent a financé</b><div class="chips">${[['needs', 'Besoins'], ['wants', 'Envies']].map(([v, l]) => `<button class="chip ${(t.covers === 'wants' ? 'wants' : 'needs') === v ? 'on' : ''}" data-act="ecovers" data-v="${v}">${l}</button>`).join('')}</div><div class="sm">Un retrait d’épargne qui finance une dépense (frais de véhicule, par exemple) n’est pas compté contre ton budget du mois.</div>` : ''}
${(() => {
    const base = t.date.slice(0, 7);
    const cur = t.period || 'auto';
    const opts = [['auto', 'Automatique'], [shiftMonth(base, -1), monthLabel(shiftMonth(base, -1))], [base, monthLabel(base)], [shiftMonth(base, 1), monthLabel(shiftMonth(base, 1))]];
    return `<b style="font-size:14px">Compté dans le budget de</b><div class="chips">${opts.map(([v, l]) => `<button class="chip ${cur === v ? 'on' : ''}" data-act="eperiod" data-v="${v}">${E(l)}</button>`).join('')}</div><div class="sm">Laisse « Automatique » sauf si l’opération appartient à un autre mois (épargne de fin de mois, dépense juste après la paye…).</div>`;
  })()}
${key ? `<label class="chk"><input type="checkbox" data-in="always" ${U.edit.always ? 'checked' : ''}> Toujours classer « ${E(key)} » ainsi</label>` : ''}
<button class="btn dng" data-act="edel">Supprimer l’opération</button>`;
}

function importScreen() {
  const d = store.get();
  const I = U.imp;
  const web = d.settings.bankMode === 'web';
  const bank = `<button class="btn sec" data-act="bank">1 · Ouvrir ${web ? 'le site' : 'l’appli'} BoursoBank</button>`;
  if (!I) {
    return `<div class="hd"><button class="ib" data-act="go" data-v="ops" aria-label="Retour">${ic('back')}</button><b>Importer un export</b><span style="width:34px"></span></div>
<div class="card sm">${web ? 'Sur le site BoursoBank : ouvre ton compte, affiche les mouvements de la période voulue, puis exporte-les au format CSV.' : 'Dans l’appli BoursoBank : utilise la loupe pour choisir la période voulue, puis exporte les opérations au format CSV.'} Reviens ici ensuite.</div>
${bank}<button class="btn" data-act="pickcsv">2 · Choisir le fichier CSV</button>`;
  }
  if (I.error) {
    return `<div class="hd"><button class="ib" data-act="iclose" aria-label="Retour">${ic('back')}</button><b>Importer un export</b><span style="width:34px"></span></div><div class="banner" style="color:var(--danger)">${E(I.error)}</div><button class="btn" data-act="pickcsv">Choisir un autre fichier</button>`;
  }
  const open = I.groups.filter((g) => !g.bucket).length;
  return `<div class="hd"><button class="ib" data-act="iclose" aria-label="Retour">${ic('back')}</button><b>Importer un export</b><span style="width:34px"></span></div>
<div class="card"><div>${E(I.name)}</div><div class="sm">${I.fresh.length + I.dup} opérations lues${I.skipped ? ` · ${I.skipped} lignes ignorées` : ''}</div></div>
<div class="tiles"><div class="tile"><b>${I.fresh.length}</b><span class="sm">nouvelles</span></div><div class="tile"><b>${I.dup}</b><span class="sm">déjà là</span></div><div class="tile"><b>${I.groups.reduce((n, g) => n + g.count, 0)}</b><span class="sm">à classer</span></div></div>
${I.groups.length ? `<b style="font-size:14px">À classer avant d’importer</b>${I.groups.map((g, i) => `<div class="card"><div class="line"><span>${E(g.label)}${g.count > 1 ? ` <span class="sm">×${g.count}</span>` : ''}</span><b>${eur2(g.total).replace('-', '−')}</b></div><div class="chips" style="margin-top:8px">${BUCKET_KEYS.concat(['income', 'ignore']).map((b) => `<button class="chip ${g.bucket === b ? 'on' : ''}" data-act="ibucket" data-v="${i}:${b}">${bucketLabel(b)}</button>`).join('')}</div></div>`).join('')}` : ''}
<button class="btn" data-act="idoimport" style="margin-top:auto">Importer ${I.fresh.length} opération${I.fresh.length > 1 ? 's' : ''}${open ? ` (${open} resteront à classer)` : ''}</button>`;
}

function detailScreen() {
  const d = store.get();
  const s = summarize(d, U.month);
  const sg = (n) => (n > 0.004 ? '+' : n < -0.004 ? '−' : '') + eur2(Math.abs(n));
  const line = (l, v, o = {}) => `<div class="line" style="padding:5px 0;${o.b ? 'font-weight:600;' : ''}"><span>${l}</span><span${o.c ? ` style="color:var(--${o.c})"` : ''}>${v}</span></div>`;
  const small = (t) => `<div class="sm" style="margin:2px 0 6px">${t}</div>`;
  const day = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  const misc = [];
  if (s.pending.count) misc.push(line(`${s.pending.count} opération${s.pending.count > 1 ? 's' : ''} à classer`, sg(s.pending.sum), { c: 'warn' }) + small(`Non déduites du reste. Reste si on les déduit : <b>${eur2(s.restIfPending)}</b>.`) + `<button class="chip" data-act="todo">Voir les opérations à classer</button>`);
  if (s.ignored.count) misc.push(line(`${s.ignored.count} opération${s.ignored.count > 1 ? 's' : ''} ignorée${s.ignored.count > 1 ? 's' : ''}`, sg(s.ignored.sum)) + small('Classées « Ignoré » : exclues du calcul, mais elles ont bien bougé sur ton compte.'));
  if (s.surplus > 0.004) misc.push(line('Retraits d’épargne non utilisés', eur2(s.surplus)) + small('Part des retraits supérieure aux dépenses qu’ils financent.'));
  return `<div class="hd"><button class="ib" data-act="go" data-v="home" aria-label="Retour">${ic('back')}</button><b>Détail du calcul</b><span style="width:34px"></span></div>
<div class="sm" style="text-align:center">${E(monthLabel(U.month))}</div>
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
<div class="card"><b>Pour comparer avec ta banque</b>
${line('Somme de toutes les opérations', sg(s.allSum))}
${small(`${s.count} opération${s.count > 1 ? 's' : ''}${s.lastDate ? ` · la plus récente : ${E(day(s.lastDate))}` : ''}`)}
<div class="sm">Ce n’est pas le solde de ton compte. Il n’inclut ni l’argent déjà présent en début de période, ni les opérations restées dans le mois précédent (par exemple les dépenses du jour du salaire), ni celles « en cours de traitement » qui ne sont pas encore dans ton export.</div>
</div>`;
}

function histScreen() {
  const d = store.get();
  const months = [...new Set([todayISO().slice(0, 7), ...monthsOf(d)])].sort().reverse().slice(0, 6);
  const legend = BUCKET_KEYS.map((k) => `<span class="sm"><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${BUCKETS[k].color};margin-right:4px"></i>${BUCKETS[k].label}</span>`).join(' ');
  const T = d.settings.targets;
  return `<h1>Historique</h1><div class="chips" style="gap:14px">${legend}</div>
${months.map((m) => {
    const s = summarize(d, m);
    const ok = s.base > 0 && s.pct.needs <= T.needs && s.pct.wants <= T.wants && s.pct.savings >= T.savings;
    return `<div class="tap" data-act="gomonth" data-v="${m}" style="cursor:pointer"><div class="line" style="margin-bottom:4px"><b style="text-transform:capitalize">${E(monthLabel(m))}</b><span class="sm">${s.pct.needs} / ${s.pct.wants} / ${s.pct.savings} ${ok ? `<span style="color:var(--ok)">${ic('check').replace('class="ic"', 'class="ic" style="width:14px;height:14px;vertical-align:-2px"')}</span>` : ''}</span></div><div class="stack">${BUCKET_KEYS.map((k) => `<i style="width:${Math.min(100, s.pct[k])}%;background:${BUCKETS[k].color}"></i>`).join('')}</div></div>`;
  }).join('')}
<div class="card sm" style="margin-top:auto">Cible ${T.needs} / ${T.wants} / ${T.savings}. La coche indique un mois où les trois limites sont respectées.</div>`;
}

function ago(ts) {
  if (!ts) return '';
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? 'à l’instant' : m < 60 ? `il y a ${m} min` : `il y a ${Math.round(m / 60)} h`;
}

function setScreen() {
  const d = store.get();
  const S = sync.state;
  const T = d.settings.targets;
  const st = { off: 'Pas encore de fichier', idle: 'Prêt', syncing: 'Synchronisation…', ok: `Synchronisé · ${ago(S.last)}`, error: 'Erreur de synchronisation' }[S.status];
  const upd = U.upd;
  return `<h1>Réglages</h1>
<div class="card"><b>Données</b>
<div class="sm">${S.ref ? `Fichier : ${E(S.ref.name)}` : 'Choisis un fichier sur le téléphone ou dans Google Drive. Il est synchronisé automatiquement après chaque action.'}</div>
<div style="color:var(--${S.status === 'error' ? 'danger' : 'muted'});margin:6px 0;font-size:14px">${E(st)}${S.error ? ` — ${E(S.error)}` : ''}</div>
<div class="chips"><button class="chip" data-act="pickfile" data-v="new">Créer un fichier</button><button class="chip" data-act="pickfile" data-v="open">Ouvrir un fichier existant</button>${S.ref ? '<button class="chip" data-act="syncnow">Synchroniser</button>' : ''}</div></div>
<div class="card"><b>Budget</b>
<div class="sm" style="margin:6px 0 4px">Revenus mensuels (si aucun salaire importé)</div><input type="number" inputmode="decimal" data-in="income" value="${d.settings.income || ''}" placeholder="2400">
<div class="sm" style="margin:10px 0 4px">Revenus reçus à partir du jour … : comptés dans le mois suivant (0 = désactivé)</div><input type="number" inputmode="numeric" min="0" max="31" data-in="shiftday" value="${d.settings.incomeShiftDay || 0}">
<div class="sm" style="margin:10px 0 4px">Cibles en % : besoins / envies / épargne</div>
<div class="chips" style="flex-wrap:nowrap">${BUCKET_KEYS.map((k) => `<input type="number" inputmode="numeric" data-in="t-${k}" value="${T[k]}" aria-label="${BUCKETS[k].label}">`).join('')}</div></div>
<div class="card"><b>BoursoBank</b><div class="sm" style="margin:6px 0 8px">Le bouton d’export ouvre :</div>
<div class="chips"><button class="chip f ${d.settings.bankMode !== 'web' ? 'on' : ''}" data-act="bankmode" data-v="app">L’appli</button><button class="chip f ${d.settings.bankMode === 'web' ? 'on' : ''}" data-act="bankmode" data-v="web">Le site web</button></div>
<div class="sm" style="margin:10px 0 4px">Adresse du site (mode « site web » ou si l’appli est absente)</div><input type="text" data-in="bankurl" value="${E(d.settings.bankUrl)}"></div>
<div class="card"><b>Version ${E(VERSION)}</b>
<div class="sm" style="margin:4px 0 8px">${!upd ? 'Vérifie s’il existe une nouvelle version sur GitHub.' : upd.state === 'checking' ? 'Vérification…' : upd.state === 'error' ? E(upd.msg) : upd.newer ? `Version ${E(upd.version)} disponible.` : 'Tu as la dernière version.'}</div>
<div class="chips"><button class="chip" data-act="checkupd">Vérifier</button>${upd?.newer ? '<button class="chip on" data-act="getupd">Télécharger</button>' : ''}</div></div>`;
}

/* ---------- rendu ---------- */
const NAV = [['home', 'home', 'Accueil'], ['ops', 'list', 'Opérations'], ['add'], ['hist', 'chart', 'Historique'], ['set', 'settings', 'Réglages']];

function render() {
  const screens = { home, detail: detailScreen, add: addScreen, ops: opsScreen, edit: editScreen, import: importScreen, hist: histScreen, set: setScreen };
  const hideNav = U.tab === 'add' || U.tab === 'edit';
  const nav = hideNav
    ? ''
    : `<div class="nav">${NAV.map((n) => (n.length === 1 ? `<button class="fab" data-act="go" data-v="add" aria-label="Ajouter">${ic('plus')}</button>` : `<button class="nb ${U.tab === n[0] || (U.tab === 'import' && n[0] === 'ops') || (U.tab === 'detail' && n[0] === 'home') ? 'on' : ''}" data-act="go" data-v="${n[0]}">${ic(n[1])}${n[2]}</button>`)).join('')}</div>`;
  const keep = root.querySelector('.screen')?.scrollTop || 0;
  root.innerHTML = `<div class="screen">${screens[U.tab]()}</div>${nav}${U.flash ? `<div class="toast">${E(U.flash)}</div>` : ''}`;
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
    const n = I.fresh.length;
    const last = I.fresh.map((t) => t.date).sort().pop();
    U.imp = null;
    if (last) U.month = last.slice(0, 7);
    U.tab = 'home';
    flash(`${n} opération${n > 1 ? 's' : ''} importée${n > 1 ? 's' : ''}`);
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
    else U.imp = { name: f.name, skipped: parsed.skipped, ...prepareImport(parsed.transactions, store.get()) };
  } catch (e) {
    U.imp = { error: e?.message?.includes('ZIP') || e?.message?.includes('archive') ? e.message : 'Lecture du fichier impossible.' };
  }
  render();
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
