// Каталог (виды, сорта, места, экземпляры), отметки фото и настройки.
import { STORES, get, getAll, put, del, tx, promisify, updatePhotos, getAllByIndex } from './db.js';

export const bus = new EventTarget();
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

export const catalog = {
  species: new Map(),
  cultivars: new Map(),
  places: new Map(),
  plants: new Map(),
};

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

export async function loadCatalog() {
  for (const kind of Object.keys(catalog)) {
    const rows = await getAll(STORES[kind]);
    catalog[kind] = new Map(rows.map((r) => [r.id, r]));
  }
}

async function save(kind, obj) {
  await put(STORES[kind], obj);
  catalog[kind].set(obj.id, obj);
  emit('catalog');
  return obj;
}

// ---------- создание и правка ----------

export function createSpecies({ name, latin = '', family = '', notes = '' }) {
  return save('species', { id: newId(), name: name.trim(), latin: latin.trim(), family: family.trim(), notes, createdAt: Date.now() });
}

export function createCultivar({ speciesId, name, notes = '' }) {
  return save('cultivars', { id: newId(), speciesId, name: name.trim(), notes, createdAt: Date.now() });
}

/** kind: 'bed' — клумба или зона (может содержать растения), 'view' — вид (ракурс), без растений. */
export function createPlace({ name, parentId = null, lat = null, lon = null, notes = '', kind = 'bed' }) {
  return save('places', { id: newId(), parentId, name: name.trim(), lat, lon, notes, kind, createdAt: Date.now() });
}

export const isView = (id) => catalog.places.get(id)?.kind === 'view';

export function createPlant({ speciesId, cultivarId = null, placeId, plantedAt = null, notes = '' }) {
  return save('plants', {
    id: newId(), speciesId, cultivarId, placeId, plantedAt, status: 'growing', prevPlantId: null, coverPhotoId: null, notes, createdAt: Date.now(),
  });
}

export function updateEntity(kind, obj) {
  return save(kind, { ...obj, updatedAt: Date.now() });
}

/** Почему объект нельзя удалить (или null, если можно). */
export function deleteBlocker(kind, id) {
  const plants = [...catalog.plants.values()];
  if (kind === 'species') {
    if ([...catalog.cultivars.values()].some((c) => c.speciesId === id)) return 'Сначала удалите или перенесите сорта этого вида.';
    if (plants.some((p) => p.speciesId === id)) return 'У этого вида есть растения. Сначала удалите их.';
  }
  if (kind === 'cultivars' && plants.some((p) => p.cultivarId === id)) return 'У этого сорта есть растения. Сначала удалите их.';
  if (kind === 'places') {
    if ([...catalog.places.values()].some((p) => p.parentId === id)) return 'Внутри этого места есть другие места. Сначала удалите или перенесите их.';
    if (plants.some((p) => p.placeId === id)) return 'В этом месте есть растения. Сначала удалите их.';
  }
  return null;
}

/** Удалить объект каталога. Фото, у которых не осталось отметок, возвращаются в «Разбор». */
export async function deleteEntity(kind, id) {
  const blocker = deleteBlocker(kind, id);
  if (blocker) throw new Error(blocker);
  if (kind === 'plants' || kind === 'places') {
    const field = kind === 'plants' ? 'plantIds' : 'placeIds';
    const photos = await getAllByIndex(STORES.photos, field, id);
    await updatePhotos(photos.map((p) => p.id), (p) => {
      p[field] = p[field].filter((x) => x !== id);
      if (!p.placeIds.length && !p.plantIds.length && p.status === 'tagged') p.status = 'new';
    });
  }
  await del(STORES[kind], id);
  catalog[kind].delete(id);
  emit('catalog');
  emit('photos');
}

// ---------- названия ----------

export function speciesName(id) {
  return catalog.species.get(id)?.name ?? 'Без вида';
}

/** «Хоста «June»» или «Хоста» */
export function varietyName(plant) {
  const sp = speciesName(plant.speciesId);
  const cv = plant.cultivarId ? catalog.cultivars.get(plant.cultivarId) : null;
  return cv ? `${sp} «${cv.name}»` : sp;
}

/** «Хоста «June» — Клумба у крыльца» */
export function plantName(plant) {
  if (!plant) return 'Удалённое растение';
  const place = catalog.places.get(plant.placeId);
  return place ? `${varietyName(plant)} — ${place.name}` : varietyName(plant);
}

/** «Участок › Перед домом › Клумба у крыльца» */
export function placePath(id) {
  const parts = [];
  let cur = catalog.places.get(id);
  let guard = 0;
  while (cur && guard++ < 10) {
    parts.unshift(cur.name);
    cur = cur.parentId ? catalog.places.get(cur.parentId) : null;
  }
  return parts.join(' › ');
}

/** Путь к родителю места («Участок › Перед домом») или пустая строка. */
export function parentPath(id) {
  const p = catalog.places.get(id);
  return p?.parentId ? placePath(p.parentId) : '';
}

export function placeDepth(id) {
  let d = 0;
  let cur = catalog.places.get(id);
  while (cur?.parentId && d < 10) {
    d++;
    cur = catalog.places.get(cur.parentId);
  }
  return d;
}

// ---------- настройки ----------

const DEFAULTS = { walkGapMinutes: 20, recentPlaces: [], recentPlants: [], queueOrder: 'old' };

export async function getSetting(key) {
  const v = await get(STORES.meta, key);
  return v === undefined ? DEFAULTS[key] : v;
}

export function setSetting(key, value) {
  return put(STORES.meta, value, key);
}

async function pushRecent(key, ids) {
  const cur = await getSetting(key);
  const next = [...ids, ...cur.filter((x) => !ids.includes(x))].slice(0, 5);
  await setSetting(key, next);
}

// ---------- отметки фото ----------

/**
 * Отметить фото местом и/или растениями. Отметка растения добавляет и его место.
 * @returns снимок прежнего состояния для отмены
 */
export async function tagPhotos(ids, { placeId = null, plantIds = [] }) {
  const addPlaces = new Set();
  if (placeId) addPlaces.add(placeId);
  for (const pid of plantIds) {
    const pl = catalog.plants.get(pid);
    if (pl?.placeId) addPlaces.add(pl.placeId);
  }
  const before = [];
  await updatePhotos(ids, (p) => {
    before.push({ id: p.id, status: p.status, placeIds: [...p.placeIds], plantIds: [...p.plantIds] });
    p.placeIds = [...new Set([...p.placeIds, ...addPlaces])];
    p.plantIds = [...new Set([...p.plantIds, ...plantIds])];
    if (p.status === 'new') p.status = 'tagged';
  });
  if (placeId) await pushRecent('recentPlaces', [placeId]);
  if (plantIds.length) await pushRecent('recentPlants', plantIds);
  emit('photos');
  return before;
}

/** Снять отметки с фото (одно фото, правка вручную). */
export async function setPhotoTags(id, { placeIds, plantIds }) {
  await updatePhotos([id], (p) => {
    p.placeIds = placeIds;
    p.plantIds = plantIds;
    if (!placeIds.length && !plantIds.length && p.status === 'tagged') p.status = 'new';
    if ((placeIds.length || plantIds.length) && p.status === 'new') p.status = 'tagged';
  });
  emit('photos');
}

export async function hidePhotos(ids) {
  const before = [];
  await updatePhotos(ids, (p) => {
    before.push({ id: p.id, status: p.status, placeIds: [...p.placeIds], plantIds: [...p.plantIds] });
    p.status = 'hidden';
  });
  emit('photos');
  return before;
}

export async function unhidePhotos(ids) {
  await updatePhotos(ids, (p) => {
    p.status = p.placeIds.length || p.plantIds.length ? 'tagged' : 'new';
  });
  emit('photos');
}

/** Вернуть фото в состояние из снимка (кнопка «Отменить»). */
export async function restorePhotos(snapshot) {
  const map = new Map(snapshot.map((s) => [s.id, s]));
  await updatePhotos([...map.keys()], (p) => {
    const s = map.get(p.id);
    p.status = s.status;
    p.placeIds = s.placeIds;
    p.plantIds = s.plantIds;
  });
  emit('photos');
}

export async function setPhotoDate(ids, takenAt) {
  await updatePhotos(ids, (p) => {
    p.takenAt = takenAt;
    p.dateApprox = false;
  });
  emit('photos');
}

export async function shiftPhotoDates(ids, deltaMs) {
  await updatePhotos(ids, (p) => {
    p.takenAt += deltaMs;
  });
  emit('photos');
}

// ---------- выборки фото ----------

export const photosByStatus = (status) => getAllByIndex(STORES.photos, 'status', status);
export const photosOfPlant = (id) => getAllByIndex(STORES.photos, 'plantIds', id);
export const photosOfPlace = (id) => getAllByIndex(STORES.photos, 'placeIds', id);
export const getPhoto = (id) => get(STORES.photos, id);

export function countPhotos() {
  return tx([STORES.photos], 'readonly', async (t) => {
    const s = t.objectStore(STORES.photos);
    const idx = s.index('status');
    const [total, fresh, hidden] = await Promise.all([
      promisify(s.count()),
      promisify(idx.count('new')),
      promisify(idx.count('hidden')),
    ]);
    return { total, fresh, hidden, tagged: total - fresh - hidden };
  });
}

// ---------- объекты для сеток и сравнений ----------
// Объект просмотра: растение (plant), сорт (cultivar), вид (species) или место (place).

export function plantsOfTarget(kind, id) {
  const plants = [...catalog.plants.values()];
  if (kind === 'plant') return plants.filter((p) => p.id === id);
  if (kind === 'cultivar') return plants.filter((p) => p.cultivarId === id);
  if (kind === 'species') return plants.filter((p) => p.speciesId === id);
  return [];
}

/** Место и все вложенные в него места. */
export function placeWithDescendants(id) {
  const out = [id];
  for (let i = 0; i < out.length && i < 500; i++) {
    for (const p of catalog.places.values()) if (p.parentId === out[i]) out.push(p.id);
  }
  return out;
}

export async function photosForTarget(kind, id) {
  const lists = kind === 'place'
    ? await Promise.all(placeWithDescendants(id).map((pid) => getAllByIndex(STORES.photos, 'placeIds', pid)))
    : await Promise.all(plantsOfTarget(kind, id).map((p) => getAllByIndex(STORES.photos, 'plantIds', p.id)));
  const seen = new Map();
  for (const list of lists) for (const p of list) if (p.status !== 'hidden') seen.set(p.id, p);
  return [...seen.values()];
}

export function targetExists(kind, id) {
  const map = { plant: catalog.plants, cultivar: catalog.cultivars, species: catalog.species, place: catalog.places }[kind];
  return !!map?.has(id);
}

export function targetName(kind, id) {
  if (kind === 'plant') return varietyName(catalog.plants.get(id));
  if (kind === 'cultivar') {
    const c = catalog.cultivars.get(id);
    return c ? `${speciesName(c.speciesId)} «${c.name}»` : 'Сорт';
  }
  if (kind === 'species') return speciesName(id);
  if (kind === 'place') return catalog.places.get(id)?.name ?? 'Место';
  return '';
}

export function targetSubtitle(kind, id) {
  if (kind === 'plant') return placePath(catalog.plants.get(id)?.placeId);
  if (kind === 'cultivar' || kind === 'species') {
    const n = plantsOfTarget(kind, id).length;
    return n === 1 ? 'одно растение' : `все растения: ${n}`;
  }
  if (kind === 'place') return [isView(id) ? 'вид' : null, parentPath(id)].filter(Boolean).join(' · ') || 'место';
  return '';
}

/** Сорт или вид растения, если он растёт больше чем в одном месте — для сравнения клумб. */
export function comparableVariety(plant) {
  if (!plant) return null;
  if (plant.cultivarId && plantsOfTarget('cultivar', plant.cultivarId).length > 1) return { kind: 'cultivar', id: plant.cultivarId };
  if (plantsOfTarget('species', plant.speciesId).length > 1) return { kind: 'species', id: plant.speciesId };
  return null;
}

export async function getPins() {
  return (await get(STORES.meta, 'coverPins')) || {};
}

export async function setPin(key, photoId) {
  const pins = await getPins();
  if (photoId) pins[key] = photoId;
  else delete pins[key];
  await put(STORES.meta, pins, 'coverPins');
}

export async function rememberTarget(kind, id) {
  const cur = ((await get(STORES.meta, 'recentTargets')) || []).filter((t) => !(t.kind === kind && t.id === id));
  await put(STORES.meta, [{ kind, id }, ...cur].slice(0, 6), 'recentTargets');
}

export async function recentTargets() {
  return ((await get(STORES.meta, 'recentTargets')) || []).filter((t) => targetExists(t.kind, t.id));
}

/** Фото, отмеченные клумбой (не видом), но ещё без растений: {placeId: count}. */
export async function placesNeedingPlants() {
  const tagged = await photosByStatus('tagged');
  const counts = new Map();
  for (const p of tagged) {
    if (p.plantIds.length) continue;
    for (const id of p.placeIds) {
      if (!catalog.places.has(id) || isView(id)) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  return counts;
}
