// Vérifie la dernière release GitHub (un seul GET anonyme, aucune donnée envoyée).
import { REPO, VERSION } from './version.js';

const nums = (v) =>
  String(v)
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map((n) => parseInt(n, 10) || 0);

export function isNewer(remote, local) {
  const a = nums(remote);
  const b = nums(local);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

export async function checkUpdate() {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!r.ok) throw new Error('Impossible de joindre GitHub');
  const j = await r.json();
  const apk = (j.assets || []).find((a) => /\.apk$/i.test(a.name) && !/debug/i.test(a.name)) || (j.assets || []).find((a) => /\.apk$/i.test(a.name));
  const version = String(j.tag_name || '').replace(/^v/i, '');
  return {
    newer: isNewer(version, VERSION),
    version,
    url: apk?.browser_download_url || j.html_url || `https://github.com/${REPO}/releases`,
    notes: String(j.body || '').slice(0, 600),
  };
}
