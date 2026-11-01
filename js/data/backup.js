// Резервная копия и перенос между устройствами: дневник целиком или изменения → файл(ы) .zip,
// и загрузка такого файла со слиянием с тем, что уже есть на устройстве.
import { STORES, getAll, get, put, tx, promisify } from './db.js';
import { loadCatalog, emit, catalog } from './store.js';
import { createZip, readZip } from '../lib/zip.js';

const FORMAT = 'plant-diary-backup';
const FORMAT_VERSION = 1;
const PART_LIMIT = 1.8 * 1024 ** 3; // меньше 2 ГБ на файл
const CATALOG_KINDS = ['species', 'cultivars', 'places', 'plants', 'entries'];

const stamp = (r) => r.updatedAt || r.createdAt || 0;

export async function lastExportAt() {
  return (await get(STORES.meta, 'lastExportAt')) || 0;
}

/**
 * Подготовить файлы резервной копии.
 * @param mode 'all' — всё; 'changes' — изменения с прошлого раза
 * @returns [{blob, name, photos}] — одна или несколько частей
 */
export async function exportBackup(mode = 'all', onProgress = () => {}) {
  const started = Date.now();
  const since = mode === 'changes' ? await lastExportAt() : 0;
  const catalog = {};
  for (const k of CATALOG_KINDS) catalog[k] = await getAll(STORES[k]);
  const [allPhotos, deletedIds, deletedEntities, coverPins] = await Promise.all([
    getAll(STORES.photos), get(STORES.meta, 'deletedIds'), get(STORES.meta, 'deletedEntities'), get(STORES.meta, 'coverPins'),
  ]);
  const photos = allPhotos.filter((p) => !since || (p.updatedAt || p.importedAt || 0) > since || (p.importedAt || 0) > since);
  const withImages = (p) => !since || (p.importedAt || 0) > since;

  // Делим на части по размеру изображений
  const parts = [[]];
  let size = 0;
  for (const p of photos) {
    const s = withImages(p) ? p.size || 300000 : 0;
    if (size + s > PART_LIMIT && parts.at(-1).length) {
      parts.push([]);
      size = 0;
    }
    parts.at(-1).push(p);
    size += s;
  }

  const date = new Date(started);
  const pad = (x) => String(x).padStart(2, '0');
  // Имя латиницей: браузеры и телефоны надёжнее сохраняют такие файлы
  const base = `plant-diary-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}${mode === 'changes' ? '-changes' : ''}`;
  const totalImages = photos.filter(withImages).length;
  let doneImages = 0;
  const result = [];
  for (let i = 0; i < parts.length; i++) {
    const list = parts[i];
    const entries = [{
      name: 'data.json',
      data: JSON.stringify({
        format: FORMAT, version: FORMAT_VERSION, exportedAt: started, mode, since,
        part: i + 1, parts: parts.length,
        catalog, photos: list, deletedIds: deletedIds || [], deletedEntities: deletedEntities || [], coverPins: coverPins || {},
      }),
    }];
    for (const p of list) {
      if (!withImages(p)) continue;
      const [t, f] = await tx([STORES.images], 'readonly', (t2) => Promise.all([
        promisify(t2.objectStore(STORES.images).get(`${p.id}:t`)),
        promisify(t2.objectStore(STORES.images).get(`${p.id}:f`)),
      ]));
      if (t) entries.push({ name: `images/${p.id}_t.jpg`, data: t });
      if (f) entries.push({ name: `images/${p.id}_f.jpg`, data: f });
      onProgress({ stage: 'images', done: ++doneImages, total: totalImages });
    }
    onProgress({ stage: 'pack', part: i + 1, parts: parts.length });
    const blob = await createZip(entries);
    result.push({ blob, name: parts.length > 1 ? `${base}-part-${i + 1}-of-${parts.length}.zip` : `${base}.zip`, photos: list.length });
  }
  await put(STORES.meta, started, 'lastExportAt');
  return result;
}

/**
 * Загрузить файл резервной копии и слить с данными устройства.
 * Растения и места — побеждает более поздняя правка; отметки фото объединяются;
 * удалённое на другом устройстве удаляется и здесь.
 */
/** Картинки фото есть в хранилище и читаются. */
async function imagesReadable(id) {
  try {
    for (const k of ['t', 'f']) {
      const b = await get(STORES.images, `${id}:${k}`);
      if (!b || !b.size) return false;
      await b.slice(0, 16).arrayBuffer();
    }
    return true;
  } catch {
    return false;
  }
}

export async function importBackup(file, onProgress = () => {}) {
  const files = await readZip(file);
  const dataFile = files.get('data.json');
  if (!dataFile) throw new Error('В архиве нет данных дневника.');
  const data = JSON.parse(await dataFile.getText());
  if (data.format !== FORMAT) throw new Error('Это не файл «Дневника растений».');
  if (data.version > FORMAT_VERSION) throw new Error('Файл из более новой версии приложения. Обновите приложение и попробуйте снова.');

  const report = { catalogAdded: 0, catalogUpdated: 0, photosAdded: 0, photosMerged: 0, photosDeleted: 0, missingImages: 0, removed: 0, part: data.part, parts: data.parts };

  // Каталог
  for (const kind of CATALOG_KINDS) {
    for (const r of data.catalog?.[kind] || []) {
      const l = await get(STORES[kind], r.id);
      if (!l) { await put(STORES[kind], r); report.catalogAdded++; } else if (stamp(r) > stamp(l)) { await put(STORES[kind], r); report.catalogUpdated++; }
    }
  }

  // Удалённые записи каталога
  const localDelEnt = (await get(STORES.meta, 'deletedEntities')) || [];
  const seenEnt = new Set(localDelEnt.map((d) => `${d.kind}:${d.id}`));
  for (const d of data.deletedEntities || []) {
    if (!seenEnt.has(`${d.kind}:${d.id}`)) { localDelEnt.push(d); seenEnt.add(`${d.kind}:${d.id}`); }
    const l = await get(STORES[d.kind], d.id);
    if (l && stamp(l) <= d.at) {
      await tx([STORES[d.kind]], 'readwrite', (t) => promisify(t.objectStore(STORES[d.kind]).delete(d.id)));
      report.removed++;
    }
  }
  await put(STORES.meta, localDelEnt.slice(-5000), 'deletedEntities');

  // Удалённые фото
  const deleted = new Set([...((await get(STORES.meta, 'deletedIds')) || []), ...(data.deletedIds || [])]);
  await put(STORES.meta, [...deleted], 'deletedIds');
  for (const id of data.deletedIds || []) {
    const was = await get(STORES.photos, id);
    if (!was) continue;
    await tx([STORES.photos, STORES.images], 'readwrite', (t) => {
      t.objectStore(STORES.photos).delete(id);
      t.objectStore(STORES.images).delete(`${id}:t`);
      t.objectStore(STORES.images).delete(`${id}:f`);
    });
    report.photosDeleted++;
  }

  // Фото
  const total = (data.photos || []).length;
  let done = 0;
  for (const r of data.photos || []) {
    onProgress({ done: ++done, total });
    if (deleted.has(r.id)) continue;
    const l = await get(STORES.photos, r.id);
    // Фото уже есть, но его картинки не читаются (например, прошлый импорт в Safari сорвался) — запишем их заново
    const broken = l && !(await imagesReadable(r.id));
    if (!l || broken) {
      const t = files.get(`images/${r.id}_t.jpg`);
      const f = files.get(`images/${r.id}_f.jpg`);
      if (!t || !f) { report.missingImages++; continue; }
      // Копируем байты в память: Safari не умеет надёжно хранить ссылки на кусочки выбранного файла
      const tb = new Blob([await (await t.getBlob()).arrayBuffer()], { type: 'image/jpeg' });
      const fb = new Blob([await (await f.getBlob()).arrayBuffer()], { type: 'image/jpeg' });
      await tx([STORES.photos, STORES.images], 'readwrite', (tr) => {
        tr.objectStore(STORES.images).put(tb, `${r.id}:t`);
        tr.objectStore(STORES.images).put(fb, `${r.id}:f`);
        if (!l) tr.objectStore(STORES.photos).put(r);
      });
      if (l) report.imagesRepaired = (report.imagesRepaired || 0) + 1;
      else { report.photosAdded++; continue; }
    }
    if (l) {
      const newer = stamp(r) > stamp(l) ? r : l;
      const merged = {
        ...newer,
        placeIds: [...new Set([...l.placeIds, ...r.placeIds])],
        plantIds: [...new Set([...l.plantIds, ...r.plantIds])],
      };
      merged.status = merged.placeIds.length || merged.plantIds.length ? 'tagged' : (l.status === 'hidden' || r.status === 'hidden' ? 'hidden' : 'new');
      if (JSON.stringify(merged) !== JSON.stringify(l)) {
        await put(STORES.photos, merged);
        report.photosMerged++;
      }
    }
  }

  // Ссылки на удалённые растения и места убираем из фото
  await loadCatalog();
  const all = await getAll(STORES.photos);
  for (const p of all) {
    const placeIds = p.placeIds.filter((id) => catalog.places.has(id));
    const plantIds = p.plantIds.filter((id) => catalog.plants.has(id));
    if (placeIds.length !== p.placeIds.length || plantIds.length !== p.plantIds.length) {
      const status = placeIds.length || plantIds.length ? p.status : (p.status === 'tagged' ? 'new' : p.status);
      await put(STORES.photos, { ...p, placeIds, plantIds, status });
    }
  }

  const pins = (await get(STORES.meta, 'coverPins')) || {};
  await put(STORES.meta, { ...(data.coverPins || {}), ...pins }, 'coverPins');

  emit('catalog');
  emit('photos');
  return report;
}
