// Помощник распознавания: отпечатки фото, фоновый расчёт, подсказки «Похоже на…», проверка точности.
import { STORES, tx, promisify, getAll } from './db.js';
import { emit, catalog, photosByStatus, placeWithDescendants, getSetting, setSetting } from './store.js';
import { nnVectors, nnEnsure, nnCount, nnTrainHead } from './nnIndex.js';
import { predictHead, toShares } from '../lib/head.js';
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

/** Размеченные фото с отпечатками: [{id, f, takenAt, places[], plants[]}]
 *  nn — брать отпечатки нейросети (только у тех фото, где они уже посчитаны) */
async function labeledSet(excludeIds = new Set(), { nn = false } = {}) {
  const tagged = (await photosByStatus('tagged')).filter((p) => !excludeIds.has(p.id));
  const feats = nn ? await nnVectors(tagged.map((p) => p.id)) : await featuresFor(tagged.map((p) => p.id));
  return tagged.filter((p) => feats.has(p.id)).map((p) => ({
    id: p.id,
    f: feats.get(p.id),
    takenAt: p.takenAt,
    u: p.updatedAt || p.importedAt || 0,
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

// ---------- обученная «голова» над нейросетью ----------

const headState = { key: '', head: null, training: null };
const headKey = (labeled) => `${labeled.length}:${labeled.reduce((s, l) => Math.max(s, l.u || 0), 0)}:${labeled.reduce((s, l) => s + l.places.length + l.plants.length, 0)}`;
const trainAsync = (items) => nnTrainHead(items.map((l) => l.f), items.map((l) => [...l.places, ...l.plants]));

/** Одна модель на клумбы, виды и растения сразу. Обучается в фоновом потоке; пока учится свежая —
 *  подсказки берёт последняя готовая (или прежний способ, если готовой ещё нет). */
function headFor(labeled) {
  const key = headKey(labeled);
  if (headState.key !== key && !headState.training) {
    headState.training = trainAsync(labeled)
      .then((head) => { headState.head = head; headState.key = key; })
      .catch(() => {})
      .finally(() => { headState.training = null; });
  }
  return headState.head;
}

const isPlaceKey = (k) => catalog.places.has(k);
const isPlantKey = (k) => catalog.plants.has(k);

/** Подсказки «головы»: клумбы, растения, или растения внутри клумбы (сорт из другой клумбы → экземпляр здесь). */
function headSuggest(head, q, mode, ctxPlace) {
  if (mode === 'place') {
    return toShares(predictHead(head, q, { allow: new Set(head.classes.filter(isPlaceKey)) })).map((r) => ({ key: r.label, share: r.share, support: r.support }));
  }
  const plants = predictHead(head, q, { allow: new Set(head.classes.filter(isPlantKey)) });
  if (!ctxPlace) return toShares(plants).map((r) => ({ key: r.label, share: r.share, support: r.support }));
  const inBed = new Set(placeWithDescendants(ctxPlace));
  const bedPlants = [...catalog.plants.values()].filter((p) => inBed.has(p.placeId));
  const byVariety = new Map(bedPlants.map((p) => [varietyOf(p), p.id]));
  const merged = new Map();
  for (const r of plants) {
    const p = catalog.plants.get(r.label);
    const key = inBed.has(p.placeId) ? p.id : byVariety.get(varietyOf(p)) || (bedPlants.length ? null : `v:${p.speciesId}:${p.cultivarId || ''}`);
    if (!key) continue;
    const cur = merged.get(key) || { label: key, score: -Infinity, support: 0 };
    cur.score = Math.max(cur.score, r.score);
    cur.support += r.support;
    merged.set(key, cur);
  }
  return toShares([...merged.values()].sort((a, b) => b.score - a.score)).map((r) => ({ key: r.label, share: r.share, support: r.support }));
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
  // Нейросеть — если включена и уже знает достаточно размеченных фото; иначе прежний способ
  let nn = (await getSetting('nnEnabled')) === true && (await nnCount()) >= MIN_LABELED;
  if (nn) await nnEnsure([...selected].slice(0, 12));
  let labeled = await labeledSet(selected, { nn });
  if (nn && labeled.length < MIN_LABELED) { nn = false; labeled = await labeledSet(selected); }
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
  let qf = enough ? (nn ? await nnVectors([...selected]) : await featuresFor([...selected])) : new Map();
  if (nn && !qf.size && enough) { labeled = await labeledSet(selected); qf = await featuresFor([...selected]); }
  const useHead = nn && (await getSetting('nnModel')) === 'head';
  const head = useHead && qf.size ? headFor(labeled) : null;
  if (head) {
    res = headSuggest(head, meanFeature([...qf.values()]), mode, ctxPlace);
  } else if (qf.size) {
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
  const classic = await labeledSet();
  const nnOn = (await getSetting('nnEnabled')) === true;
  const nnAll = nnOn ? await labeledSet(new Set(), { nn: true }) : [];
  // Для честного сравнения обе модели проверяются на одних и тех же фото
  const nnIds = new Set(nnAll.map((x) => x.id));
  const base = nnAll.length >= MIN_LABELED ? classic.filter((x) => nnIds.has(x.id)) : classic;
  const pick = base.length > sample ? [...base].sort(() => Math.random() - 0.5).slice(0, sample) : base;
  const steps = pick.length * (nnAll.length >= MIN_LABELED ? 2 : 1);
  let done = 0;
  const tick = async () => {
    onProgress?.(++done, steps);
    if (done % 20 === 0) await new Promise((r) => setTimeout(r, 0));
  };
  const out = await evalOn(classic, pick.map((p) => p.id), tick);
  out.total = classic.length;
  if (nnAll.length >= MIN_LABELED) {
    out.nn = await evalOn(nnAll, pick.map((p) => p.id), tick);
    out.head = await evalHead(nnAll, pick.map((p) => p.id));
    // Подсказки дальше даёт та нейросеть, что угадала лучше
    const score = (r) => r.place.top3 / (r.place.n || 1) + r.plant.top3 / (r.plant.n || 1) + r.plantInBed.top3 / (r.plantInBed.n || 1);
    out.best = score(out.head) > score(out.nn) ? 'head' : 'knn';
    await setSetting('nnModel', out.best);
  }
  out.nnCount = nnAll.length;
  return out;
}

/** Проверка «головы»: прогулки делятся на 5 частей, учимся на четырёх и угадываем пятую. */
async function evalHead(all, pickIds) {
  const res = { place: { n: 0, top1: 0, top3: 0 }, plant: { n: 0, top1: 0, top3: 0 }, plantInBed: { n: 0, top1: 0, top3: 0 } };
  // Прогулки: снимки с перерывом меньше 2 часов — одна прогулка
  const sorted = [...all].sort((a, b) => a.takenAt - b.takenAt);
  const walkOf = new Map();
  let w = 0;
  sorted.forEach((x, i) => { if (i && x.takenAt - sorted[i - 1].takenAt > 2 * 3600 * 1000) w++; walkOf.set(x.id, w); });
  const pick = new Set(pickIds);
  const add = (r, top, truth) => { r.n++; if (top[0] && truth.has(top[0])) r.top1++; if (top.some((l) => truth.has(l))) r.top3++; };
  for (let fold = 0; fold < 5; fold++) {
    const train = all.filter((x) => walkOf.get(x.id) % 5 !== fold);
    const test = all.filter((x) => walkOf.get(x.id) % 5 === fold && pick.has(x.id));
    if (!test.length) continue;
    const head = await trainAsync(train);
    if (!head) continue;
    for (const q of test) {
      if (q.places.length) add(res.place, headSuggest(head, q.f, 'place').slice(0, 3).map((x) => x.key), new Set(q.places));
      if (q.plants.length) add(res.plant, headSuggest(head, q.f, 'plant').slice(0, 3).map((x) => x.key), new Set(q.plants));
      const bed = q.places.find((pid) => catalog.places.get(pid)?.kind !== 'view' && q.plants.some((x) => catalog.plants.get(x)?.placeId === pid));
      if (bed) add(res.plantInBed, headSuggest(head, q.f, 'plant', bed).slice(0, 3).map((x) => x.key), new Set(q.plants));
    }
  }
  return res;
}

async function evalOn(all, pickIds, tick) {
  const byId = new Map(all.map((x) => [x.id, x]));
  const res = { place: { n: 0, top1: 0, top3: 0 }, plant: { n: 0, top1: 0, top3: 0 }, plantInBed: { n: 0, top1: 0, top3: 0 } };
  const near = 2 * 3600 * 1000;
  for (const id of pickIds) {
    const q = byId.get(id);
    if (!q) { await tick(); continue; }
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
    const bed = q.places.find((pid) => catalog.places.get(pid)?.kind !== 'view' && q.plants.some((x) => catalog.plants.get(x)?.placeId === pid));
    if (bed) {
      const top = (plantVoteInBed(q.f, new Date(q.takenAt).getMonth(), others, bed) || []).slice(0, 3).map((x) => x.key);
      const truth = new Set(q.plants);
      const r = res.plantInBed;
      r.n++;
      if (top[0] && truth.has(top[0])) r.top1++;
      if (top.some((l) => truth.has(l))) r.top3++;
    }
    await tick();
  }
  return res;
}
