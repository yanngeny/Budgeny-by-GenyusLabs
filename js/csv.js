// Import des exports CSV BoursoBank (Boursorama) : analyse, dédoublonnage, classement.
const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

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

export function parseAmount(s) {
  let t = String(s ?? '').replace(/[\s €"]/g, '');
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '');
  t = t.replace(',', '.');
  if (!/^[-+]?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
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
      label: cleanLabel(get(r, 'label')) || '(sans libellé)',
      hint: get(r, 'hint').trim(),
      cat: get(r, 'cat').trim(),
      parent: get(r, 'parent').trim(),
      account: get(r, 'account').trim(),
    });
  }
  return { ok: true, transactions: out, skipped };
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

const STOP = new Set(['carte', 'prlv', 'sepa', 'vir', 'virement', 'paiement', 'achat', 'par', 'les', 'des']);

export function ruleKeyOf(label) {
  return norm(label)
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .slice(0, 2)
    .join(' ');
}

function ruleMatches(key, text) {
  return key !== '' && key.split(' ').every((tok) => text.includes(tok));
}

const DEFAULTS = [
  [/\b(salaire|paie|remuneration|revenu|revenus|traitement|allocation|allocations|caf|france travail|pole emploi|retraite|virements recus)\b/, 'income', '', 'pos'],
  [/\b(epargne|livret|assurance vie|pea|placement|investissement)\b/, 'savings', 'Livret', 'neg'],
  [/\b(spotify|netflix|disney|canal|deezer|youtube|prime video|streaming)\b/, 'wants', 'Abonnements', null],
  [/\b(loyer|logement|energie|electricite|gaz|eau|edf|engie|copropriete|maison)\b/, 'needs', 'Logement', null],
  [/\b(alimentation|supermarche|supermarches|courses|carrefour|leclerc|auchan|lidl|intermarche|monoprix|franprix)\b/, 'needs', 'Courses', null],
  [/\b(transport|transports|carburant|essence|station|parking|peage|navigo|sncf|ratp|auto)\b/, 'needs', 'Transport', null],
  [/\b(sante|pharmacie|medecin|mutuelle|dentiste|opticien)\b/, 'needs', 'Santé', null],
  [/\b(telephonie|telephone|mobile|internet|box|free|sfr|bouygues)\b/, 'needs', 'Télécom', null],
  [/\b(assurance|assurances|impot|impots|taxe|taxes|frais bancaires|cotisation)\b/, 'needs', 'Assurances et impôts', null],
  [/\b(enfant|enfants|education|ecole|creche|scolarite)\b/, 'needs', 'Éducation', null],
  [/\b(restaurant|restaurants|restauration|fast food|cafe|boulangerie)\b/, 'wants', 'Restau', null],
  [/\b(loisir|loisirs|sortie|sorties|culture|sport|cinema|spectacle|jeu|jeux)\b/, 'wants', 'Loisirs', null],
  [/\b(abonnement|abonnements)\b/, 'wants', 'Abonnements', null],
  [/\b(shopping|vetement|vetements|habillement|electronique|cadeau|cadeaux|amazon|bricolage|jardinage|livres|jouets|bijoux)\b/, 'wants', 'Shopping', null],
  [/\b(sportifs|artistiques)\b/, 'wants', 'Loisirs', null],
  [/\b(voyage|voyages|vacance|vacances|hotel|airbnb|booking)\b/, 'wants', 'Voyages', null],
];

// Règles de l'utilisateur d'abord, puis règles par défaut. Bucket '' = à classer à la main.
export function classify(t, rules = []) {
  const text = norm(`${t.label} ${t.hint ?? ''} ${t.cat} ${t.parent}`);
  for (const r of rules) {
    if (ruleMatches(r.k, text)) return { bucket: r.bucket, sub: r.sub || '' };
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
  return { fresh, dup, groups: [...groups.values()] };
}
