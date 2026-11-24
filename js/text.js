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

export function ruleMatches(key, text) {
  return key !== '' && key.split(' ').every((tok) => text.includes(tok));
}

// Une opération déjà enregistrée (libellé seul) correspond-elle à cette clé ?
export const labelMatchesKey = (key, label) => ruleMatches(key, norm(label));
