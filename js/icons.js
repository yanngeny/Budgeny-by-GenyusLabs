// Icônes de l'appli (tracés simples, contour 2 px, fonctionnent hors ligne) + logo + choix de l'icône d'une opération.
import { norm } from './text.js';

const P = {
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
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M3 4h2.5l2.2 11h10.6l2-8H6.2"/>',
  car: '<path d="M4 15v-4l2-5h12l2 5v4"/><path d="M3 15h18v3H3z"/><circle cx="7.5" cy="18" r="1.2"/><circle cx="16.5" cy="18" r="1.2"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/>',
  book: '<path d="M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4z"/><path d="M20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z"/>',
  fork: '<path d="M5 3v6M8 3v6M11 3v6"/><path d="M5 9a3 3 0 0 0 6 0"/><path d="M8 12v9"/><path d="M17 21V3c-2 1.5-3 4-3 7 0 2 1.5 3 3 3"/>',
  coffee: '<path d="M5 8h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z"/><path d="M16 10h2a2 2 0 0 1 0 4h-2"/><path d="M8 3v2M12 3v2"/>',
  gamepad: '<rect x="3" y="7" width="18" height="10" rx="4"/><path d="M8 10v4M6 12h4"/><path d="M16 11h.01M18 13h.01"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M10 9l5 3-5 3z"/><path d="M8 21h8"/>',
  bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
  plane: '<path d="M3 13l18-9-4 17-5-6-5 3z"/>',
  coins: '<ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7"/><path d="M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 12h.01"/>',
  down: '<path d="M12 4v10M8 10l4 4 4-4"/><path d="M4 19h16"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M16 12h5v3h-5a1.5 1.5 0 0 1 0-3z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7"/><path d="M12 17h.01"/>',
  eyeoff: '<path d="M3 3l18 18"/><path d="M6.3 7.5A14 14 0 0 0 3 12c2 3.5 5.5 6 9 6 1.3 0 2.5-.3 3.6-.8"/><path d="M10.6 6.2A9 9 0 0 1 21 12a14 14 0 0 1-2.2 3"/>',
  bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  drop: '<path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z"/>',
  sparkle: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 8.5 4 4 0 0 1 17 18z"/>',
  bank: '<path d="M3 10l9-6 9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14-4M4 5v4h4"/><path d="M4 13a8 8 0 0 0 14 4M20 19v-4h-4"/>',
};

export const ic = (n, cls = 'ic') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] ?? P.help}</svg>`;

// Logo Budgeny : lampe d'Aladin dans l'anneau 50-30-20 (mêmes dessins que branding/logo-round.svg).
export const logo = (px = 28) =>
  `<svg width="${px}" height="${px}" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="50" fill="#14201f"/><g transform="rotate(-90 50 50)" fill="none" stroke-width="9"><circle cx="50" cy="50" r="41" stroke="#1D9E75" stroke-dasharray="125.8 257.6"/><circle cx="50" cy="50" r="41" stroke="#EF9F27" stroke-dasharray="74.3 257.6" stroke-dashoffset="-128.8"/><circle cx="50" cy="50" r="41" stroke="#7F77DD" stroke-dasharray="48.5 257.6" stroke-dashoffset="-206.1"/></g><g transform="translate(50 50) scale(0.68) translate(-47.5 -53)"><path d="M13 41C6 34 16 30 11 22" stroke="#1D9E75" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M16 40C14 32 23 31 21 22" stroke="#EF9F27" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M19 41C21 34 29 34 28 26" stroke="#7F77DD" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M32 60C22 62 20 52 13 46" stroke="#EF9F27" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M68 60C82 60 84 46 70 49" stroke="#EF9F27" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M30 56H70C70 70 60 77 50 77C40 77 30 70 30 56Z" fill="#EF9F27"/><path d="M36 56C36 49 42 46 50 46C58 46 64 49 64 56Z" fill="#EF9F27"/><rect x="48.5" y="41" width="3" height="6" fill="#EF9F27"/><circle cx="50" cy="40.5" r="3.5" fill="#EF9F27"/><path d="M42 77H58L61 84H39Z" fill="#EF9F27"/><path d="M32 56H68" stroke="#BA7517" stroke-width="2"/><path d="M80 22l2.6 7.4 7.4 2.6-7.4 2.6L80 42l-2.6-7.4-7.4-2.6 7.4-2.6z" fill="#fff"/></g></svg>`;

export const BUCKET_ICON = { needs: 'home', wants: 'sparkle', savings: 'coins', income: 'wallet', ignore: 'eyeoff' };

const SUB_ICON = {
  Logement: 'home',
  Courses: 'cart',
  Transport: 'car',
  Santé: 'heart',
  Télécom: 'phone',
  'Assurances et impôts': 'shield',
  Éducation: 'book',
  Restau: 'fork',
  Loisirs: 'gamepad',
  Abonnements: 'music',
  Shopping: 'bag',
  Voyages: 'plane',
  Livret: 'coins',
  Investissement: 'trend',
  Projet: 'target',
  Retrait: 'down',
};
export const subIcon = (s) => SUB_ICON[s] || 'help';

// Mots du libellé qui parlent plus que la catégorie (Spotify -> note de musique, Carrefour -> caddie…).
const KEYWORDS = [
  [/spotify|deezer|apple music/, 'music'],
  [/netflix|disney|canal|prime video|youtube|twitch|crunchyroll/, 'tv'],
  [/instant gaming|steam|playstation|xbox|nintendo/, 'gamepad'],
  [/carrefour|leclerc|intermarche|lidl|auchan|monoprix|super u|franprix|boucherie|pluxee/, 'cart'],
  [/cafe|starbucks|boulangerie/, 'coffee'],
  [/restaurant|burger|mcdo|kfc|tacos|deliveroo|uber eats|pizza|sushi|trattoria|hiyoko/, 'fork'],
  [/pharmacie|medecin|dentiste|opticien|mutuelle/, 'heart'],
  [/\b(edf|engie|energie|electricite|totalenergies)\b/, 'bolt'],
  [/\beau\b/, 'drop'],
  [/bouygues|orange|sfr|free mobile|spliiit/, 'phone'],
  [/amazon|vinted|kiabi|uniqlo|decathlon|leroy|ikea|leboncoin|cultura|fnac|zara|action/, 'bag'],
  [/sncf|ratp|navigo|keolis|tixipass|parking|pkg|kerpark|citedia|total |station|garage|depann|auto/, 'car'],
];

export function opIconName(t) {
  if (t.bucket === 'income') return 'wallet';
  if (t.bucket === 'ignore') return 'eyeoff';
  if (t.bucket === 'savings') return SUB_ICON[t.sub] || 'coins';
  const text = norm(t.label);
  for (const [re, name] of KEYWORDS) if (re.test(text)) return name;
  if (SUB_ICON[t.sub]) return SUB_ICON[t.sub];
  return t.bucket ? BUCKET_ICON[t.bucket] || 'help' : 'help';
}
