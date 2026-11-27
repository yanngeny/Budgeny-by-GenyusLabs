// Normalisation de texte et « clés » de libellé (ex. « link france »), sans dépendance :
// partagé par csv.js (classement) et model.js (détection de la paye).
export const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

const STOP = new Set(['carte', 'prlv', 'sepa', 'vir', 'virement', 'paiement', 'achat', 'par', 'les', 'des']);

export function ruleKeyOf(label) {
  return norm(label)
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .slice(0, 2)
    .join(' ');
}

// Mots entiers seulement : la clé « free » ne doit pas attraper « freeze », ni « car » « carrefour ».
const words = (text) => new Set(norm(text).split(/[^a-z0-9]+/).filter(Boolean));

export function ruleMatches(key, text) {
  if (!key) return false;
  const w = words(text);
  return key.split(' ').every((tok) => w.has(tok));
}

// Une règle plus précise (plus de mots, plus longue) passe avant une règle plus générale.
export const bySpecificity = (a, b) => b.k.split(' ').length - a.k.split(' ').length || b.k.length - a.k.length || (a.k < b.k ? -1 : 1);

// Texte servant au classement : libellé + indices de la banque (libellé suggéré, catégories).
export const classText = (t) => `${t.label ?? ''} ${t.hint ?? ''} ${t.cat ?? ''} ${t.parent ?? ''}`;

// Une opération déjà enregistrée (libellé seul) correspond-elle à cette clé ?
export const labelMatchesKey = (key, label) => ruleMatches(key, label);
