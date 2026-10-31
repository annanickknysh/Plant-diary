// Минимальный разбор EXIF из JPEG: дата съёмки и координаты GPS.
// Читаем только начало файла (первые ~256 КБ), этого достаточно для блока APP1.

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

/**
 * @param {ArrayBuffer} buf — начало файла
 * @returns {{takenAt: number|null, lat: number|null, lon: number|null}}
 */
export function parseExif(buf) {
  const empty = { takenAt: null, lat: null, lon: null };
  const view = new DataView(buf);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return empty;
  let pos = 2;
  while (pos + 4 <= view.byteLength) {
    if (view.getUint8(pos) !== 0xff) return empty;
    const marker = view.getUint8(pos + 1);
    if (marker === 0xda || marker === 0xd9) return empty; // начались данные изображения
    const len = view.getUint16(pos + 2);
    if (marker === 0xe1 && pos + 10 <= view.byteLength && readAscii(view, pos + 4, 4) === 'Exif') {
      try {
        return parseTiff(view, pos + 10, Math.min(view.byteLength, pos + 2 + len));
      } catch {
        return empty;
      }
    }
    pos += 2 + len;
  }
  return empty;
}

function readAscii(view, start, n) {
  let s = '';
  for (let i = 0; i < n && start + i < view.byteLength; i++) {
    const c = view.getUint8(start + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function parseTiff(view, base, limit) {
  const order = view.getUint16(base);
  const le = order === 0x4949;
  if (!le && order !== 0x4d4d) throw new Error('bad tiff');
  const u16 = (o) => view.getUint16(base + o, le);
  const u32 = (o) => view.getUint32(base + o, le);
  if (u16(2) !== 42) throw new Error('bad magic');

  const readIfd = (off) => {
    const tags = new Map();
    if (!off || base + off + 2 > limit) return tags;
    const n = u16(off);
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      if (base + e + 12 > limit) break;
      const tag = u16(e);
      const type = u16(e + 2);
      const count = u32(e + 4);
      const size = (TYPE_SIZE[type] || 1) * count;
      const valOff = size > 4 ? u32(e + 8) : e + 8;
      if (base + valOff + size > limit) continue;
      tags.set(tag, readValue(type, count, valOff));
    }
    return tags;
  };

  const readValue = (type, count, off) => {
    if (type === 2) return readAscii(view, base + off, count);
    const out = [];
    for (let i = 0; i < count; i++) {
      if (type === 3) out.push(u16(off + i * 2));
      else if (type === 4) out.push(u32(off + i * 4));
      else if (type === 5) {
        const den = u32(off + i * 8 + 4);
        out.push(den ? u32(off + i * 8) / den : 0);
      } else if (type === 10) {
        const den = view.getInt32(base + off + i * 8 + 4, le);
        out.push(den ? view.getInt32(base + off + i * 8, le) / den : 0);
      } else out.push(view.getUint8(base + off + i));
    }
    return count === 1 ? out[0] : out;
  };

  const ifd0 = readIfd(u32(4));
  const exif = readIfd(ifd0.get(0x8769));
  const gps = readIfd(ifd0.get(0x8825));

  const dateStr = exif.get(0x9003) || exif.get(0x9004) || ifd0.get(0x0132) || null;
  const takenAt = parseExifDate(dateStr);

  let lat = null;
  let lon = null;
  const la = gps.get(2);
  const lo = gps.get(4);
  if (Array.isArray(la) && Array.isArray(lo) && la.length === 3 && lo.length === 3) {
    lat = la[0] + la[1] / 60 + la[2] / 3600;
    lon = lo[0] + lo[1] / 60 + lo[2] / 3600;
    if (gps.get(1) === 'S') lat = -lat;
    if (gps.get(3) === 'W') lon = -lon;
    if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) {
      lat = null;
      lon = null;
    }
  }
  return { takenAt, lat, lon };
}

/** «2023:04:14 09:12:30» → мс по местному времени, или null. */
export function parseExifDate(s) {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  if (y < 1990 || mo < 1 || mo > 12 || d < 1) return null;
  return new Date(y, mo - 1, d, h, mi, se).getTime();
}
