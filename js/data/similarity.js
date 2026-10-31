// Помощник распознавания: отпечатки фото, фоновый расчёт, подсказки «Похоже на…», проверка точности.
import { STORES, tx, promisify, getAll } from './db.js';
import { emit, catalog, photosByStatus } from './store.js';
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

/**
 * Подсказки для выбранных фото.
 * @param mode 'place' | 'plant'
 * @param ctxPlace — клумба фото: растения из других клумб предлагаются как сорт («v:вид:сорт»)
 * @returns [{key, share, support}] — до 3 вариантов
 */
export async function suggest(photos, mode, { ctxPlace = null } = {}) {
  if (!photos.length) return [];
  const selected = new Set(photos.map((p) => p.id));
  const labeled = await labeledSet(selected);
  if (labeled.length < MIN_LABELED) return [];
  const qf = await featuresFor([...selected]);
  if (!qf.size) return [];
  const query = meanFeature([...qf.values()]);
  const month = new Date(photos[0].takenAt).getMonth();
  const items = labeled.map((l) => ({ f: l.f, takenAt: l.takenAt, labels: mode === 'place' ? l.places : l.plants })).filter((x) => x.labels.length);
  if (items.length < MIN_LABELED / 2) return [];
  let res = vote(query, items, { month });
  if (mode === 'plant' && ctxPlace) {
    // Растение из другой клумбы → тот же сорт в клумбе фото
    const merged = new Map();
    for (const r of res) {
      const p = catalog.plants.get(r.label);
      if (!p) continue;
      const vk = `v:${p.speciesId}:${p.cultivarId || ''}`;
      const here = [...catalog.plants.values()].find((x) => x.placeId === ctxPlace && x.speciesId === p.speciesId && (x.cultivarId || '') === (p.cultivarId || ''));
      const key = here ? here.id : vk;
      const cur = merged.get(key) || { key, share: 0, support: 0 };
      cur.share += r.share;
      cur.support += r.support;
      merged.set(key, cur);
    }
    res = [...merged.values()].sort((a, b) => b.share - a.share);
  } else {
    res = res.map((r) => ({ key: r.label, share: r.share, support: r.support }));
  }
  return res.filter((r) => r.share >= 0.12).slice(0, 3);
}

/**
 * Проверка точности на ваших размеченных фото: каждое фото «угадывается» по остальным,
 * без фото той же прогулки (±2 часа), чтобы почти одинаковые кадры не завышали результат.
 */
export async function evaluate({ sample = 250, onProgress } = {}) {
  const all = await labeledSet();
  const pick = all.length > sample ? [...all].sort(() => Math.random() - 0.5).slice(0, sample) : all;
  const res = { place: { n: 0, top1: 0, top3: 0 }, plant: { n: 0, top1: 0, top3: 0 }, total: all.length };
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
    onProgress?.(++i, pick.length);
    if (i % 20 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return res;
}
