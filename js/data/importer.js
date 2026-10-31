// Импорт фото: дата и GPS из EXIF, защита от дублей, превью и рабочая копия.
// Работает в фоне: можно продолжать пользоваться приложением.
import { parseExif } from '../lib/exif.js';
import { makeResized, saveImages, THUMB_SIZE, FULL_SIZE } from './images.js';
import { STORES, get, put } from './db.js';
import { emit, getSetting, deletedIds, tagPhotos } from './store.js';

const IMAGE_EXT = /\.(jpe?g|png|webp|heic|heif|avif)$/i;

export const importState = {
  running: false,
  total: 0,
  processed: 0,
  added: 0,
  duplicates: 0,
  noDate: 0,
  failed: [], // {name, reason}
  skipped: 0, // не изображения
  deletedBefore: 0, // удалены из приложения раньше
  outOfRange: 0, // не попали в выбранный период
  startedAt: 0,
  finishedAt: 0,
};

let queue = [];
let lastEmit = 0;

function progress(force = false) {
  const now = performance.now();
  if (force || now - lastEmit > 150) {
    lastEmit = now;
    emit('import', { ...importState });
  }
}

export function isImageFile(f) {
  return (f.type && f.type.startsWith('image/')) || IMAGE_EXT.test(f.name);
}

/**
 * Добавить файлы в очередь импорта. Можно вызывать, пока идёт предыдущий импорт.
 * @param opts.tag — сразу отметить фото: {placeId, plantIds} (съёмка из приложения)
 * @param opts.range — импортировать только снятые в период {from, to} (мс, to — не включая)
 */
export function importFiles(fileList, { tag = null, range = null } = {}) {
  const files = [...fileList];
  const images = files.filter(isImageFile);
  if (!importState.running) {
    Object.assign(importState, { total: 0, processed: 0, added: 0, duplicates: 0, noDate: 0, failed: [], skipped: 0, deletedBefore: 0, outOfRange: 0, startedAt: Date.now(), finishedAt: 0 });
  }
  importState.skipped += files.length - images.length;
  importState.total += images.length;
  queue.push(...images.map((file) => ({ file, tag, range })));
  if (!importState.running) run();
  else progress(true);
}

async function run() {
  importState.running = true;
  progress(true);
  const deleted = await deletedIds();
  const quality = (await getSetting('fullQuality')) === 'economy' ? { size: 1200, q: 0.78 } : { size: FULL_SIZE, q: 0.82 };
  const worker = async () => {
    while (queue.length) {
      const { file, tag, range } = queue.shift();
      try {
        const id = await importOne(file, quality, deleted, range);
        if (id && tag) await tagPhotos([id], tag);
      } catch (e) {
        importState.failed.push({ name: file.name, reason: describeError(file, e) });
      }
      importState.processed++;
      progress();
    }
  };
  await Promise.all([worker(), worker()]);
  importState.running = false;
  importState.finishedAt = Date.now();
  progress(true);
  emit('photos');
}

function describeError(file, e) {
  if (/\.(heic|heif)$/i.test(file.name)) return 'формат HEIC не открывается в этом браузере';
  if (e?.name === 'QuotaExceededError') return 'не хватает места в хранилище';
  return 'не удалось прочитать изображение';
}

async function hashFile(file) {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Файл, изменённый раньше начала периода, не мог быть снят в этот период (копия всегда новее снимка).
const DAY = 24 * 3600 * 1000;

async function importOne(file, quality, deleted, range = null) {
  let head = null;
  let exif = null;
  if (range) {
    if (file.lastModified && file.lastModified < range.from - DAY) { importState.outOfRange++; return null; }
    head = await file.slice(0, 256 * 1024).arrayBuffer();
    exif = parseExif(head);
    const t = exif.takenAt || file.lastModified;
    if (t && (t < range.from || t >= range.to)) { importState.outOfRange++; return null; }
  }
  const id = await hashFile(file);
  if (deleted.has(id)) {
    importState.deletedBefore++;
    return null;
  }
  if (await get(STORES.photos, id)) {
    importState.duplicates++;
    return id;
  }
  if (!exif) {
    head = await file.slice(0, 256 * 1024).arrayBuffer();
    exif = parseExif(head);
  }
  let takenAt = exif.takenAt;
  const dateApprox = !takenAt;
  if (!takenAt) {
    takenAt = file.lastModified || Date.now();
    importState.noDate++;
  }
  const full = await makeResized(file, quality.size, quality.q);
  const thumb = await makeResized(full.blob, THUMB_SIZE, 0.78);
  await saveImages(id, thumb.blob, full.blob);
  const rel = file.webkitRelativePath || '';
  await put(STORES.photos, {
    id,
    takenAt,
    dateApprox,
    lat: exif.lat,
    lon: exif.lon,
    fileName: file.name,
    folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
    w: full.width,
    h: full.height,
    size: full.blob.size + thumb.blob.size,
    importedAt: Date.now(),
    status: 'new',
    placeIds: [],
    plantIds: [],
  });
  importState.added++;
  return id;
}
