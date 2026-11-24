// Emplacement du fichier JSON : Android = Storage Access Framework (téléphone, Google Drive, etc.),
// navigateur = File System Access API (pratique pour développer sur PC).
let plugin;
function plug() {
  if (plugin === undefined) {
    // Sans bundler, le pont natif expose les plugins via Capacitor.Plugins (registerPlugin n'existe pas ici).
    const C = window.Capacitor;
    plugin = C?.isNativePlatform?.() ? C.Plugins?.BudgenyFile ?? C.registerPlugin?.('BudgenyFile') ?? null : null;
  }
  return plugin;
}

export const isNative = () => !!plug();

const REF_KEY = 'budgeny.file.v1';
let memRef = null;

export function loadRef() {
  try {
    const r = JSON.parse(localStorage.getItem(REF_KEY));
    if (r?.kind === 'saf' && r.uri) return (memRef = r);
  } catch {
    /* ignore */
  }
  return memRef;
}
export function saveRef(ref) {
  memRef = ref;
  try {
    if (ref?.kind === 'saf') localStorage.setItem(REF_KEY, JSON.stringify({ kind: 'saf', uri: ref.uri, name: ref.name }));
    else localStorage.removeItem(REF_KEY);
  } catch {
    /* ignore */
  }
}

const JSON_TYPES = [{ description: 'Budgeny', accept: { 'application/json': ['.json'] } }];

export async function pick(create) {
  const p = plug();
  if (p) {
    const r = await p.pick({ create, name: 'Budgeny_data.json' });
    return { kind: 'saf', uri: r.uri, name: r.name };
  }
  if (window.showSaveFilePicker) {
    const h = create
      ? await window.showSaveFilePicker({ suggestedName: 'Budgeny_data.json', types: JSON_TYPES })
      : (await window.showOpenFilePicker({ types: JSON_TYPES }))[0];
    return { kind: 'fs', name: h.name, handle: h };
  }
  throw new Error('Sélecteur de fichier indisponible ici.');
}

export async function read(ref) {
  if (ref.kind === 'saf') return (await plug().read({ uri: ref.uri })).text;
  return (await (await ref.handle.getFile()).text()) || null;
}

export async function write(ref, text) {
  if (ref.kind === 'saf') {
    await plug().write({ uri: ref.uri, text });
    return;
  }
  const w = await ref.handle.createWritable();
  await w.write(text);
  await w.close();
}

// Ouvre une page dans le navigateur, sans passer par l'appli de la banque.
// fallback: en cas d'échec du plugin, laisse Android ouvrir le lien lui-même (téléchargements GitHub).
export async function openBrowser(url, { fallback = false } = {}) {
  const p = plug();
  if (p) {
    try {
      return await p.openBrowser({ url });
    } catch (e) {
      if (!fallback) throw e;
      window.location.href = url;
      return;
    }
  }
  window.open(url, '_blank', 'noopener');
}
