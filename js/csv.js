// Import des exports CSV BoursoBank (Boursorama) : analyse, dédoublonnage, classement.
import { RETRAIT, cents } from './model.js';
import { norm, ruleKeyOf, ruleMatches, labelMatchesKey, bySpecificity, classText } from './text.js';
export { ruleKeyOf, labelMatchesKey };


export function decodeBuffer(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = first.split(';').length >= first.split(',').length ? ';' : ',';
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(cur);
      cur = '';
    } else if (c === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export function parseDate(s) {
  s = String(s).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

// Montants : « -42,30 », « 2 400,00 », « 1.234,56 », « 1,234.56 », « 1.234 » (milliers), signe « − ».
export function parseAmount(s) {
  let t = String(s ?? '')
    .replace(/[\s €"']/g, '')
    .replace(/[−–]/g, '-');
  const lc = t.lastIndexOf(',');
  const ld = t.lastIndexOf('.');
  if (lc >= 0 && ld >= 0) {
    // les deux séparateurs : le dernier est le séparateur décimal, l'autre sépare les milliers
    t = lc > ld ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else {
    const sep = lc >= 0 ? ',' : ld >= 0 ? '.' : '';
    if (sep) {
      const parts = t.split(sep);
      // « 1.234 » ou « 12.345.678 » : séparateur de milliers (un montant n'a jamais 3 décimales)
      if (parts.length > 2 || (parts[1].length === 3 && /\d/.test(parts[0].replace(/^[-+]/, '')))) t = parts.join('');
      else t = parts.join('.');
    }
  }
  if (!/^[-+]?\d+(\.\d+)?$/.test(t)) return null;
  return Math.round(Number(t) * 100) / 100;
}

export function cleanLabel(raw) {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^CARTE \d{2}\/\d{2}(\/\d{2,4})? /i, '')
    .replace(/ CB\*\d{4}\s*$/i, '')
    .trim();
}

// Deux variantes connues de l'export BoursoBank :
//  - ancien : dateOp;dateVal;label;category;categoryParent;supplierFound;amount;...
//  - actuel : « Date Opération »;« Date Valeur »;Libellé;« Libellé Suggéré »;Catégorie;« Catégorie Parente »;
//    Solde;Commentaire;« Numéro Compte »;« Libellé Compte »;Solde;Pointage
//    (la 1re colonne « Solde » est en réalité le MONTANT de l'opération, la 2e est le solde du compte).
const COLS = {
  date: ['dateop', 'date operation', 'date', 'dateval'],
  vdate: ['dateval', 'date valeur'],
  label: ['label', 'libelle', 'libelle operation'],
  hint: ['libelle suggere', 'supplierfound'],
  amount: ['amount', 'montant'],
  cat: ['category', 'categorie'],
  parent: ['categoryparent', 'categorie parent', 'categorie parente', 'parent'],
  account: ['accountnum', 'numero compte', 'accountlabel', 'compte'],
};

const amountIndex = (head) => {
  const j = COLS.amount.map((a) => head.indexOf(a)).find((x) => x >= 0);
  return j ?? head.indexOf('solde'); // 1re colonne « Solde » = montant
};

export function parseBoursorama(text) {
  const rows = parseCsv(text);
  const hi = rows.findIndex((r) => {
    const h = r.map(norm);
    return COLS.date.some((a) => h.includes(a)) && amountIndex(h) >= 0;
  });
  if (hi < 0) return { ok: false, error: 'Format non reconnu : colonnes date et montant introuvables.', transactions: [], skipped: 0 };
  const head = rows[hi].map(norm);
  const idx = {};
  for (const k of Object.keys(COLS)) {
    const j = COLS[k].map((a) => head.indexOf(a)).find((x) => x >= 0);
    idx[k] = j ?? -1;
  }
  idx.amount = amountIndex(head);
  // Solde du compte après l'opération : « accountbalance » (ancien format) ou 2e colonne « Solde » (actuel)
  const balIdx = head.indexOf('accountbalance') >= 0 ? head.indexOf('accountbalance') : head.lastIndexOf('solde') > idx.amount ? head.lastIndexOf('solde') : -1;
  const get = (r, k) => (idx[k] >= 0 ? r[idx[k]] ?? '' : '');
  const out = [];
  let skipped = 0;
  for (const r of rows.slice(hi + 1)) {
    const date = parseDate(get(r, 'date'));
    const amount = parseAmount(get(r, 'amount'));
    if (!date || amount === null) {
      skipped++;
      continue;
    }
    out.push({
      date,
      amount,
      vdate: parseDate(get(r, 'vdate')) || date, // date de passage sur le compte (sert au calcul du solde)
      label: cleanLabel(get(r, 'label')) || '(sans libellé)',
      hint: get(r, 'hint').trim(),
      cat: get(r, 'cat').trim(),
      parent: get(r, 'parent').trim(),
      account: get(r, 'account').trim(),
      bal: balIdx >= 0 ? parseAmount(r[balIdx] ?? '') : null,
    });
  }
  const accounts = accountsOf(out);
  const main = accounts[0] ?? '';
  return { ok: true, transactions: out, skipped, accounts, account: main, anchor: anchorOf(accounts.length > 1 ? out.filter((t) => t.account === main) : out) };
}

// Comptes présents dans l'export, du plus fourni au moins fourni.
export function accountsOf(list) {
  const n = new Map();
  for (const t of list) if (t.account) n.set(t.account, (n.get(t.account) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a);
}

// Export qui contient plusieurs comptes : on n'importe que le compte suivi (les soldes et les virements entre
// tes comptes ne se mélangent pas).
export function selectAccount(parsed, account) {
  if (!parsed.accounts || parsed.accounts.length < 2) return parsed;
  const acc = parsed.accounts.includes(account) ? account : parsed.accounts[0];
  const transactions = parsed.transactions.filter((t) => t.account === acc);
  return { ...parsed, account: acc, transactions, anchor: anchorOf(transactions) };
}

// Solde du compte après la dernière opération passée. Chaque ligne donne le solde après elle : en enchaînant
// les lignes (solde avant = solde après − montant), la dernière est celle dont le solde n'est le point de départ
// d'aucune autre. Si l'enchaînement est ambigu, on se fie à l'ordre du fichier (le plus récent en tête ou en bas).
export function anchorOf(list) {
  const withBal = list.filter((t) => t.bal !== null && t.bal !== undefined);
  if (!withBal.length) return null;
  const date = withBal.reduce((m, t) => ((t.vdate || t.date) > m ? t.vdate || t.date : m), '');
  const starts = new Map();
  for (const t of withBal) {
    const k = cents(t.bal) - cents(t.amount);
    starts.set(k, (starts.get(k) || 0) + 1);
  }
  const ends = [];
  for (const t of withBal) {
    const k = cents(t.bal);
    if (starts.get(k)) starts.set(k, starts.get(k) - 1);
    else ends.push(t);
  }
  if (ends.length === 1) return { date, balance: ends[0].bal };
  const desc = list[0].date >= list[list.length - 1].date;
  const maxDate = withBal.reduce((m, t) => (t.date > m ? t.date : m), '');
  const same = withBal.filter((t) => t.date === maxDate);
  const row = desc ? same[0] : same[same.length - 1];
  return { date, balance: row.bal };
}


// Pas d'identifiant d'opération chez la banque : empreinte + numéro d'occurrence.
export function addHashes(list) {
  const seen = new Map();
  for (const t of list) {
    const base = `${t.date}|${t.amount.toFixed(2)}|${norm(t.label)}|${t.account}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    t.hash = `${base}#${n}`;
  }
  return list;
}


// Bucket '' = à classer à la main : mieux vaut demander que se tromper.
const DEFAULTS = [
  // Remboursements entre particuliers (Lydia, Tricount…) : pas un revenu, ça compense une dépense
  [/\b(lydia|paypal|tricount|wero|pumpkin|remboursement|rembt|rbt)\b/, '', '', 'pos'],
  [/\b(revenu|revenus|salaire|paie|remuneration|traitement)\b/, 'income', '', 'pos'],
  // Argent qui revient d'un compte d'épargne : retrait d'épargne (voir isWithdrawal dans model.js)
  [/\b(livret|epargne|pea|assurance vie)\b/, 'savings', RETRAIT, 'pos'],
  // Autre mouvement interne entrant (compte joint…) : à classer
  [/\b(mouvements internes)\b/, '', '', 'pos'],
  [/\b(allocation|allocations|caf|france travail|pole emploi|retraite|virements recus)\b/, 'income', '', 'pos'],
  [/\b(epargne|livret|assurance vie|pea|placement|investissement)\b/, 'savings', 'Livret', 'neg'],
  [/\b(spotify|netflix|disney|canal|deezer|youtube|prime video|streaming)\b/, 'wants', 'Abonnements', null],
  [/\b(loyer|logement|energie|electricite|gaz|eau|edf|engie|copropriete|maison)\b/, 'needs', 'Logement', null],
  [/\b(alimentation|supermarche|supermarches|courses|carrefour|leclerc|auchan|lidl|intermarche|monoprix|franprix)\b/, 'needs', 'Courses', null],
  [/\b(assurance|assurances|impot|impots|taxe|taxes|frais bancaires|cotisation)\b/, 'needs', 'Assurances et impôts', null], // avant Transport : « assurance auto »
  [/\b(transport|transports|carburant|essence|station|parking|peage|navigo|sncf|ratp|auto)\b/, 'needs', 'Transport', null],
  [/\b(sante|pharmacie|medecin|mutuelle|dentiste|opticien)\b/, 'needs', 'Santé', null],
  [/\b(telephonie|telephone|mobile|internet|box|free|sfr|bouygues)\b/, 'needs', 'Télécom', null],
  [/\b(enfant|enfants|education|ecole|creche|scolarite)\b/, 'needs', 'Éducation', null],
  [/\b(restaurant|restaurants|restauration|fast food|cafe|boulangerie)\b/, 'wants', 'Restau', null],
  [/\b(loisir|loisirs|sortie|sorties|culture|sport|cinema|spectacle|jeu|jeux)\b/, 'wants', 'Loisirs', null],
  [/\b(abonnement|abonnements)\b/, 'wants', 'Abonnements', null],
  [/\b(shopping|vetement|vetements|habillement|electronique|cadeau|cadeaux|amazon|bricolage|jardinage|livres|jouets|bijoux)\b/, 'wants', 'Shopping', null],
  [/\b(sportifs|artistiques)\b/, 'wants', 'Loisirs', null],
  [/\b(voyage|voyages|vacance|vacances|hotel|airbnb|booking)\b/, 'wants', 'Voyages', null],
];

// Règles de l'utilisateur d'abord (mots entiers, la plus précise gagne), puis règles par défaut.
export function classify(t, rules = []) {
  const text = norm(classText(t));
  for (const r of [...rules].sort(bySpecificity)) {
    if (ruleMatches(r.k, text)) return { bucket: r.bucket, sub: r.bucket === 'savings' && t.amount > 0 ? RETRAIT : r.sub || '' };
  }
  for (const [re, bucket, sub, cond] of DEFAULTS) {
    if (cond === 'pos' && t.amount <= 0) continue;
    if (cond === 'neg' && t.amount >= 0) continue;
    if (re.test(text)) return { bucket, sub };
  }
  return { bucket: '', sub: '' };
}

// Sépare les opérations déjà présentes des nouvelles, et classe les nouvelles.
export function prepareImport(list, data) {
  addHashes(list);
  const existing = new Set(data.transactions.map((t) => t.hash).filter(Boolean));
  const fresh = [];
  let dup = 0;
  for (const t of list) {
    if (existing.has(t.hash)) {
      dup++;
      continue;
    }
    fresh.push({ ...t, ...classify(t, data.rules) });
  }
  // Opérations saisies « en attente de la banque » : confirmées par l'import. Même sens, montant proche (le
  // montant débité peut différer un peu de la saisie : carburant, pourboire…), passée entre 2 jours avant et
  // 10 jours après la saisie. On apparie d'abord les couples les plus proches (montant, puis date).
  // L'opération importée remplace la saisie et garde la catégorie, la note et le mois choisis.
  const pendings = data.transactions.filter((t) => t.pending);
  const pairs = [];
  for (const p of pendings) {
    fresh.forEach((f, i) => {
      if (Math.sign(p.amount) !== Math.sign(f.amount)) return;
      const gap = Math.abs(cents(p.amount) - cents(f.amount));
      if (gap > Math.max(100, Math.round(Math.abs(cents(p.amount)) * 0.1))) return;
      const days = (new Date(f.date + 'T12:00:00') - new Date(p.date + 'T12:00:00')) / 86400000;
      if (days < -2 || days > 10) return;
      pairs.push({ p, i, gap, days: Math.abs(days) });
    });
  }
  pairs.sort((a, b) => a.gap - b.gap || a.days - b.days);
  const usedPending = new Set();
  const usedFresh = new Set();
  let confirmed = 0;
  for (const { p, i } of pairs) {
    if (usedPending.has(p.id) || usedFresh.has(i)) continue;
    usedPending.add(p.id);
    usedFresh.add(i);
    const f = fresh[i];
    f.replaces = p.id;
    confirmed++;
    if (p.bucket) {
      f.bucket = p.bucket;
      f.sub = p.sub || '';
      if (p.covers) f.covers = p.covers;
    }
    if (p.note) f.note = p.note;
    if (p.period) f.period = p.period;
  }
  const groups = new Map();
  fresh.forEach((t, i) => {
    if (t.bucket) return;
    const key = ruleKeyOf(t.label) || `#${i}`;
    if (!groups.has(key)) groups.set(key, { key, label: t.label, count: 0, total: 0, idxs: [], bucket: '' });
    const g = groups.get(key);
    g.count++;
    g.total += t.amount;
    g.idxs.push(i);
  });
  return { fresh, dup, confirmed, groups: [...groups.values()] };
}

// Saisie « en attente » alors que la banque a déjà passé la même opération (déjà importée) : risque de doublon.
export function importedTwin(data, tx) {
  return data.transactions.find(
    (t) => t.source === 'import' && cents(t.amount) === cents(tx.amount) && Math.abs(new Date(t.date + 'T12:00:00') - new Date(tx.date + 'T12:00:00')) <= 7 * 86400000,
  ) ?? null;
}
