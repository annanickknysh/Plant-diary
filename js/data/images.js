// Превью и рабочие копии фото: создание, хранение, выдача ссылок для <img>.
import { tx, promisify, STORES } from './db.js';

export const THUMB_SIZE = 400;
export const FULL_SIZE = 1600;

// Декодер HEIC (libheif) — 3 МБ, грузится только когда встретился такой файл.
let heicLib = null;
const loadHeic = () => (heicLib ||= import('../../vendor/heic-to-1.6.7.js').catch((e) => { heicLib = null; throw e; }));

/** Похоже ли содержимое на HEIF-контейнер (ftyp heic/mif1/…). */
async function looksHeif(blob) {
  const head = new Uint8Array(await blob.slice(4, 12).arrayBuffer());
  const s = String.fromCharCode(...head);
  return s.startsWith('ftyp') && /^(heic|heix|hevc|hevx|mif1|msf1|heim|heis)/.test(s.slice(4));
}

async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    if (!(await looksHeif(file))) throw e;
    const { heicTo } = await loadHeic();
    // libheif сам применяет поворот из файла
    return heicTo({ blob: file, type: 'bitmap' });
  }
}

/** Уменьшить изображение. Ориентацию по EXIF браузер применяет сам. */
export async function makeResized(file, maxSide, quality) {
  const bmp = await decode(file);
  try {
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    let blob;
    if (typeof OffscreenCanvas !== 'undefined') {
      const c = new OffscreenCanvas(w, h);
      c.getContext('2d').drawImage(bmp, 0, 0, w, h);
      blob = await c.convertToBlob({ type: 'image/jpeg', quality });
    } else {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(bmp, 0, 0, w, h);
      blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
    }
    return { blob, width: bmp.width, height: bmp.height };
  } finally {
    bmp.close?.();
  }
}

export function saveImages(id, thumb, full) {
  return tx([STORES.images], 'readwrite', (t) => {
    const s = t.objectStore(STORES.images);
    s.put(thumb, `${id}:t`);
    s.put(full, `${id}:f`);
  });
}

// Кэш ссылок на превью: держим ограниченное число, старые освобождаем.
const urlCache = new Map();
const MAX_URLS = 800;

export async function imageURL(id, kind = 't') {
  const key = `${id}:${kind}`;
  if (urlCache.has(key)) {
    const u = urlCache.get(key);
    urlCache.delete(key);
    urlCache.set(key, u);
    return u;
  }
  const blob = await tx([STORES.images], 'readonly', (t) => promisify(t.objectStore(STORES.images).get(key)));
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(key, url);
  if (urlCache.size > MAX_URLS) {
    const [oldKey, oldUrl] = urlCache.entries().next().value;
    urlCache.delete(oldKey);
    setTimeout(() => URL.revokeObjectURL(oldUrl), 30000);
  }
  return url;
}
