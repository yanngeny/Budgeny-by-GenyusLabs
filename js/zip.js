// Lecture minimale d'une archive ZIP (stockée ou deflate) sans dépendance : BoursoBank exporte ses CSV zippés.
export function isZip(buf) {
  const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && ((b[2] === 3 && b[3] === 4) || (b[2] === 5 && b[3] === 6));
}

// Renvoie { name, bytes } pour le premier fichier dont le nom correspond à `match` (par défaut .csv).
export async function unzipFirst(buf, match = /\.csv$/i) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let e = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      e = i;
      break;
    }
  }
  if (e < 0) throw new Error('Archive ZIP invalide.');
  const count = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Archive ZIP invalide.');
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/') || !match.test(name)) continue;
    if (flags & 1) throw new Error('Archive protégée par mot de passe.');
    if (dv.getUint32(off, true) !== 0x04034b50) throw new Error('Archive ZIP invalide.');
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    const data = u8.slice(start, start + csize);
    if (method === 0) return { name, bytes: data };
    if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return { name, bytes: new Uint8Array(await new Response(stream).arrayBuffer()) };
    }
    throw new Error('Compression ZIP non prise en charge.');
  }
  throw new Error('Aucun fichier CSV dans l’archive.');
}
