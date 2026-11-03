// Фоновый поток: нейросеть считает отпечатки фото, не мешая интерфейсу.
import { loadModel, run, toInput } from '../lib/nn.js';
import { trainHead } from '../lib/head.js';

const MODEL = new URL('../../vendor/mobilenetv2-1.json', import.meta.url);
const WEIGHTS = new URL('../../vendor/mobilenetv2-1.f16', import.meta.url);
let model = null;

async function init() {
  if (model) return;
  const [spec, w] = await Promise.all([
    fetch(MODEL).then((r) => { if (!r.ok) throw new Error(`модель: ${r.status}`); return r.json(); }),
    fetch(WEIGHTS).then((r) => { if (!r.ok) throw new Error(`веса: ${r.status}`); return r.arrayBuffer(); }),
  ]);
  model = loadModel(spec, w);
}

self.onmessage = async (e) => {
  const { id, type } = e.data;
  try {
    if (type === 'init') {
      await init();
      self.postMessage({ id, ok: true, size: model.spec.size });
      return;
    }
    if (type === 'train') {
      // Обучение «головы»: отпечатки приходят одним массивом n×d
      const { flat, n, d, labels } = e.data;
      const X = Array.from({ length: n }, (_, i) => flat.subarray(i * d, (i + 1) * d));
      const t = performance.now();
      const head = trainHead(X, labels);
      if (!head) { self.postMessage({ id, ok: true, head: null }); return; }
      self.postMessage({ id, ok: true, head: { classes: head.classes, A: head.A, counts: head.counts, C: head.C }, ms: performance.now() - t }, [head.A.buffer]);
      return;
    }
    if (type === 'embed') {
      await init();
      const t = performance.now();
      const { spec } = model;
      const out = run(model, toInput(e.data.pixels, spec.size, spec.mean, spec.std));
      self.postMessage({ id, ok: true, embedding: out, ms: performance.now() - t }, [out.buffer]);
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
