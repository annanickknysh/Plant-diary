import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trainHead, predictHead, toShares } from '../../js/lib/head.js';

// Псевдослучайные числа с зерном — тест всегда одинаковый
function rng(seed) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) - 0.5; }
const norm = (v) => { const n = Math.hypot(...v) || 1; return Float32Array.from(v, (x) => x / n); };

test('голова учится различать классы и выбирает только среди разрешённых', () => {
  const r = rng(7);
  const d = 32;
  const centers = { rose: Array.from({ length: d }, r), hosta: Array.from({ length: d }, r), bedA: Array.from({ length: d }, r) };
  const sample = (c) => norm(centers[c].map((x) => x + r() * 0.6));
  const X = []; const L = [];
  for (let i = 0; i < 20; i++) { X.push(sample('rose')); L.push(['rose']); X.push(sample('hosta')); L.push(['hosta']); }
  for (let i = 0; i < 5; i++) { X.push(sample('bedA')); L.push(['bedA']); }
  const head = trainHead(X, L);
  let right = 0;
  for (let i = 0; i < 20; i++) {
    if (predictHead(head, sample('rose'))[0].label === 'rose') right++;
    if (predictHead(head, sample('hosta'))[0].label === 'hosta') right++;
  }
  assert.ok(right >= 36, `верно ${right} из 40`);
  const only = predictHead(head, sample('rose'), { allow: new Set(['hosta', 'bedA']) });
  assert.ok(only.every((x) => x.label !== 'rose'));
  const sh = toShares(predictHead(head, sample('rose')));
  assert.ok(Math.abs(sh.reduce((s, x) => s + x.share, 0) - 1) < 1e-6);
});

test('нечему учиться — null', () => {
  assert.equal(trainHead([new Float32Array(4)], [[]]), null);
});
