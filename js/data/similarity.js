// Помощник распознавания: отпечатки фото, фоновый расчёт, подсказки «Похоже на…», проверка точности.
import { STORES, tx, promisify, getAll } from './db.js';
import { emit, catalog, photosByStatus, placeWithDescendants } from './store.js';
import { computeFeatures, vote, meanFeature, FEATURE_SIZE, FEATURE_VERSION } from '../lib/features.js';

const cache = new Map(); // id фото → Float32Array
let loaded = false;
export const indexState = { running: false, done: 0, total: 0 };

async function loadAll() {
  if (loaded) return;
  await tx([STORES.features], 'readonly', (t) => new Promise((resolve, reject) => {
    const req = t.objectStore(STORES.features).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) { resolve(); return; }
      if (c.value?.v === FEATURE_VERSION) cache.set(c.key, c.value.f);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  }));
  loaded = true;
}

async function thumbBlob(id) {
  return tx([STORES.images], 'readonly', (t) => promisify(t.objectStore(STORES.images).get(`${id}:t`)));
}

async function compute(id) {
  const blob = await thumbBlob(id);
  if (!blob) return null;
  const bmp = await createImageBitmap(blob);
  const S = FEATURE_SIZE;
  let ctx;
  if (typeof OffscreenCanvas !== 'undefined') ctx = new OffscreenCanvas(S, S).getContext('2d', { willReadFrequently: true });
  else {
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    ctx = c.getContext('2d', { willReadFrequently: true });
  }
  // Квадрат из центра кадра, чтобы горизонтальные и вертикальные фото сравнивались честно
  const side = Math.min(bmp.width, bmp.height);
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, S, S);
  bmp.close?.();
  return computeFeatures(ctx.getImageData(0, 0, S, S).data, S);
}

async function saveMany(items) {
  if (!items.length) return;
  await tx([STORES.features], 'readwrite', (t) => {
    const s = t.objectStore(STORES.features);
    for (const [id, f] of items) s.put({ v: FEATURE_VERSION, f }, id);
  });
}

/** Отпечатки для этих фото: из памяти или посчитать сейчас. */
export async function featuresFor(ids) {
  await loadAll();
  const out = new Map();
  const fresh = [];
  for (const id of ids) {
    if (cache.has(id)) { out.set(id, cache.get(id)); continue; }
    try {
      const f = await compute(id);
      if (f) { cache.set(id, f); out.set(id, f); fresh.push([id, f]); }
    } catch { /* фото не читается — пропускаем */ }
  }
  await saveMany(fresh);
  return out;
}

/** Посчитать отпечатки всех фото в фоне, понемногу, не мешая работе. */
export async function indexAll() {
  if (indexState.running) return;
  indexState.running = true;
  try {
    await loadAll();
    const ids = (await getAll(STORES.photos)).filter((p) => p.status !== 'hidden').map((p) => p.id);
    const missing = ids.filter((id) => !cache.has(id));
    indexState.total = ids.length;
    indexState.done = ids.length - missing.length;
    emit('features', { ...indexState });
    let batch = [];
    for (const id of missing) {
      try {
        const f = await compute(id);
        if (f) { cache.set(id, f); batch.push([id, f]); }
      } catch { /* пропускаем */ }
      indexState.done++;
      if (batch.length >= 25) {
        await saveMany(batch);
        batch = [];
        emit('features', { ...indexState });
        await new Promise((r) => setTimeout(r, 30)); // дать интерфейсу подышать
      }
    }
    await saveMany(batch);
  } finally {
    indexState.running = false;
    emit('features', { ...indexState });
  }
}

export function forget(id) {
  cache.delete(id);
}

/** Размеченные фото с отпечатками: [{id, f, takenAt, places[], plants[]}] */
async function labeledSet(excludeIds = new Set()) {
  const tagged = (await photosByStatus('tagged')).filter((p) => !excludeIds.has(p.id));
  const feats = await featuresFor(tagged.map((p) => p.id));
  return tagged.filter((p) => feats.has(p.id)).map((p) => ({
    id: p.id,
    f: feats.get(p.id),
    takenAt: p.takenAt,
    places: p.placeIds.filter((id) => catalog.places.has(id)),
    plants: p.plantIds.filter((id) => catalog.plants.has(id)),
  }));
}

export const MIN_LABELED = 10;

const varietyOf = (p) => `${p.speciesId}:${p.cultivarId || ''}`;

/**
 * Распознавание растения только среди тех, что растут в клумбе.
 * Фото других клумб тоже учитываются, если на них тот же сорт, что растёт здесь.
 * @returns [{key, share, support}] или null, если в клумбе нет растений
 */
function plantVoteInBed(query, month, labeled, bedId) {
  const inBed = new Set(placeWithDescendants(bedId));
  const bedPlants = [...catalog.plants.values()].filter((p) => inBed.has(p.placeId));
  if (!bedPlants.length) return null;
  const byVariety = new Map();
  for (const p of bedPlants) if (!byVariety.has(varietyOf(p)) || p.status !== 'dead') byVariety.set(varietyOf(p), p.id);
  const items = [];
  for (const l of labeled) {
    const labels = [...new Set(l.plants.map((id) => {
      const p = catalog.plants.get(id);
      if (!p) return null;
      return inBed.has(p.placeId) ? p.id : byVariety.get(varietyOf(p)) || null;
    }).filter(Boolean))];
    if (labels.length) items.push({ f: l.f, takenAt: l.takenAt, labels });
  }
  if (!items.length) return [];
  return vote(query, items, { month }).map((r) => ({ key: r.label, share: r.share, support: r.support }));
}

/** Клумбы, где растут растения, уже отмеченные на фото (и тот же сорт в других клумбах). */
function bedsOfPlants(photos) {
  const ids = new Set(photos.flatMap((p) => p.plantIds || []));
  const own = new Map();
  const same = new Map();
  for (const id of ids) {
    const p = catalog.plants.get(id);
    if (!p || !catalog.places.has(p.placeId)) continue;
    own.set(p.placeId, (own.get(p.placeId) || 0) + 1);
    for (const o of catalog.plants.values()) {
      if (o.id !== p.id && varietyOf(o) === varietyOf(p) && catalog.places.has(o.placeId)) same.set(o.placeId, (same.get(o.placeId) || 0) + 1);
    }
  }
  return { own, same };
}

/**
 * Подсказки для выбранных фото.
 * @param mode 'place' | 'plant'
 * @param ctxPlace — клумба фото: растения ищутся только среди растущих в ней
 * @returns [{key, share, support, reason?}] — до 3 вариантов
 */
export async function suggest(photos, mode, { ctxPlace = null } = {}) {
  if (!photos.length) return [];
  const selected = new Set(photos.map((p) => p.id));
  const labeled = await labeledSet(selected);
  const month = new Date(photos[0].takenAt).getMonth();

  // Клумба по уже отмеченным растениям — даже без «зрения»
  let fromPlants = [];
  if (mode === 'place') {
    const { own, same } = bedsOfPlants(photos);
    fromPlants = [
      ...[...own.keys()].map((key) => ({ key, share: 1, support: 0, reason: 'plant' })),
      ...[...same.keys()].filter((k) => !own.has(k)).map((key) => ({ key, share: 0.6, support: 0, reason: 'variety' })),
    ];
  }

  let res = [];
  const enough = labeled.length >= MIN_LABELED;
  const qf = enough ? await featuresFor([...selected]) : new Map();
  if (qf.size) {
    const query = meanFeature([...qf.values()]);
    if (mode === 'plant' && ctxPlace) {
      res = plantVoteInBed(query, month, labeled, ctxPlace);
      if (res === null) {
        // В клумбе ещё нет растений — ищем по всему саду, сорт добавится в эту клумбу
        const items = labeled.map((l) => ({ f: l.f, takenAt: l.takenAt, labels: l.plants })).filter((x) => x.labels.length);
        const merged = new Map();
        for (const r of vote(query, items, { month })) {
          const p = catalog.plants.get(r.label);
          if (!p) continue;
          const key = `v:${p.speciesId}:${p.cultivarId || ''}`;
          const cur = merged.get(key) || { key, share: 0, support: 0 };
          cur.share += r.share;
          cur.support += r.support;
          merged.set(key, cur);
        }
        res = [...merged.values()].sort((a, b) => b.share - a.share);
      }
    } else {
      const items = labeled.map((l) => ({ f: l.f, takenAt: l.takenAt, labels: mode === 'place' ? l.places : l.plants })).filter((x) => x.labels.length);
      if (items.length >= MIN_LABELED / 2) res = vote(query, items, { month }).map((r) => ({ key: r.label, share: r.share, support: r.support }));
    }
  }
  res = res.filter((r) => r.share >= 0.12);
  const seen = new Set(fromPlants.map((r) => r.key));
  return [...fromPlants, ...res.filter((r) => !seen.has(r.key))].slice(0, 3);
}

/**
 * Проверка точности на ваших размеченных фото: каждое фото «угадывается» по остальным,
 * без фото той же прогулки (±2 часа), чтобы почти одинаковые кадры не завышали результат.
 */
export async function evaluate({ sample = 250, onProgress } = {}) {
  const all = await labeledSet();
  const pick = all.length > sample ? [...all].sort(() => Math.random() - 0.5).slice(0, sample) : all;
  const res = { place: { n: 0, top1: 0, top3: 0 }, plant: { n: 0, top1: 0, top3: 0 }, plantInBed: { n: 0, top1: 0, top3: 0 }, total: all.length };
  const near = 2 * 3600 * 1000;
  let i = 0;
  for (const q of pick) {
    const others = all.filter((o) => Math.abs(o.takenAt - q.takenAt) > near);
    for (const mode of ['place', 'plant']) {
      const truth = new Set(mode === 'place' ? q.places : q.plants);
      if (!truth.size) continue;
      const items = others.map((o) => ({ f: o.f, takenAt: o.takenAt, labels: mode === 'place' ? o.places : o.plants })).filter((x) => x.labels.length);
      if (items.length < 3) continue;
      const top = vote(q.f, items, { month: new Date(q.takenAt).getMonth() }).slice(0, 3).map((x) => x.label);
      const r = res[mode];
      r.n++;
      if (top[0] && truth.has(top[0])) r.top1++;
      if (top.some((l) => truth.has(l))) r.top3++;
    }
    // Растение, когда клумба уже выбрана: ищем только среди растений этой клумбы
    const bed = q.places.find((id) => catalog.places.get(id)?.kind !== 'view' && q.plants.some((pid) => catalog.plants.get(pid)?.placeId === id));
    if (bed) {
      const top = (plantVoteInBed(q.f, new Date(q.takenAt).getMonth(), others, bed) || []).slice(0, 3).map((x) => x.key);
      const truth = new Set(q.plants);
      const r = res.plantInBed;
      r.n++;
      if (top[0] && truth.has(top[0])) r.top1++;
      if (top.some((l) => truth.has(l))) r.top3++;
    }
    onProgress?.(++i, pick.length);
    if (i % 20 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return res;
}
