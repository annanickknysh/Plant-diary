// Нейросеть: фоновый расчёт отпечатков всех фото. Каждый отпечаток сохраняется сразу,
// поэтому после закрытия приложения работа продолжается с того же места.
import { STORES, tx, promisify, getAll } from './db.js';
import { emit, getSetting } from './store.js';

export const NN_VERSION = 1;
export const NN_SIZE = 224;
const cache = new Map(); // id фото → Float32Array (нормированный)
let loaded = false;
let meanVec = null; // среднее по всем фото — вычитается, чтобы «общее садовое» не мешало сравнению
export const nnState = { enabled: false, running: false, paused: false, done: 0, total: 0, msPerPhoto: 0, error: '' };

let worker = null;
let seq = 0;
const waiting = new Map();
function call(msg, transfer = []) {
  if (!worker) {
    worker = new Worker(new URL('../workers/nnWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = waiting.get(e.data.id);
      if (!p) return;
      waiting.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data); else p.reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      for (const p of waiting.values()) p.reject(new Error(e.message || 'Нейросеть не запустилась'));
      waiting.clear();
      worker = null;
    };
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id }, transfer);
  });
}

const normalize = (v) => {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  s = Math.sqrt(s) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / s;
  return out;
};

async function loadAll() {
  if (loaded) return;
  await tx([STORES.embeddings], 'readonly', (t) => new Promise((resolve, reject) => {
    const req = t.objectStore(STORES.embeddings).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) { resolve(); return; }
      if (c.value?.v === NN_VERSION) cache.set(c.key, c.value.e);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  }));
  loaded = true;
  meanVec = null;
}

/** Пиксели превью 224×224 (весь кадр, без обрезки) — для нейросети. */
async function pixelsOf(id) {
  const blob = await tx([STORES.images], 'readonly', (t) => promisify(t.objectStore(STORES.images).get(`${id}:t`)));
  if (!blob) return null;
  const bmp = await createImageBitmap(blob);
  const S = NN_SIZE;
  let ctx;
  if (typeof OffscreenCanvas !== 'undefined') ctx = new OffscreenCanvas(S, S).getContext('2d', { willReadFrequently: true });
  else {
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    ctx = c.getContext('2d', { willReadFrequently: true });
  }
  ctx.drawImage(bmp, 0, 0, S, S);
  bmp.close?.();
  return ctx.getImageData(0, 0, S, S).data;
}

/** Посчитать и сохранить отпечаток одного фото. */
async function embedOne(id) {
  const px = await pixelsOf(id);
  if (!px) return null;
  const r = await call({ type: 'embed', pixels: px }, [px.buffer]);
  const e = normalize(r.embedding);
  await tx([STORES.embeddings], 'readwrite', (t) => { t.objectStore(STORES.embeddings).put({ v: NN_VERSION, e }, id); });
  cache.set(id, e);
  meanVec = null;
  nnState.msPerPhoto = nnState.msPerPhoto ? nnState.msPerPhoto * 0.8 + r.ms * 0.2 : r.ms;
  return e;
}

const progress = () => emit('nn', { ...nnState });

/** Запустить (или продолжить) фоновый расчёт. Безопасно вызывать сколько угодно раз. */
export async function nnRun() {
  nnState.enabled = (await getSetting('nnEnabled')) === true;
  if (!nnState.enabled || nnState.running) { progress(); return; }
  nnState.running = true;
  nnState.error = '';
  try {
    await loadAll();
    const ids = (await getAll(STORES.photos)).filter((p) => p.status !== 'hidden').sort((a, b) => b.importedAt - a.importedAt).map((p) => p.id);
    nnState.total = ids.length;
    nnState.done = ids.filter((id) => cache.has(id)).length;
    progress();
    await call({ type: 'init' });
    for (const id of ids) {
      if (cache.has(id)) continue;
      if (nnState.paused || !nnState.enabled) break;
      try { await embedOne(id); } catch (e) { if (/модель|веса|запуст/i.test(e.message)) throw e; }
      nnState.done++;
      progress();
    }
  } catch (e) {
    nnState.error = e.message || String(e);
  } finally {
    nnState.running = false;
    progress();
  }
}

export function nnPause(paused) {
  nnState.paused = paused;
  if (!paused) nnRun(); else progress();
}

/** Отпечатки нейросети для фото (только уже посчитанные), с вычтенным средним. */
export async function nnVectors(ids) {
  await loadAll();
  if (!meanVec) {
    const all = [...cache.values()];
    if (!all.length) return new Map();
    meanVec = new Float32Array(all[0].length);
    for (const v of all) for (let i = 0; i < v.length; i++) meanVec[i] += v[i] / all.length;
  }
  const out = new Map();
  for (const id of ids) {
    const v = cache.get(id);
    if (!v) continue;
    const c = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) c[i] = v[i] - meanVec[i];
    out.set(id, normalize(c));
  }
  return out;
}

/** Посчитать отпечатки этих фото сейчас (для свежих фото в подсказках). */
export async function nnEnsure(ids) {
  if ((await getSetting('nnEnabled')) !== true) return;
  await loadAll();
  for (const id of ids) if (!cache.has(id)) await embedOne(id).catch(() => null);
}

export function nnForget(id) { cache.delete(id); meanVec = null; }

export async function nnCount() {
  await loadAll();
  return cache.size;
}
