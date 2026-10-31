import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFeatures, similarity, vote, meanFeature, FEATURE_SIZE } from '../../js/lib/features.js';

const S = FEATURE_SIZE;
let seed = 1;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

/** Синтетическая «сцена»: фон, круг, полосы; с шумом, сдвигом и яркостью. */
function scene({ bg, fg, stripes = 0, cx = 32, cy = 32, r = 14, shift = 0, light = 1, noise = 0 }) {
  const px = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const xx = x - shift;
      let c = bg;
      if (stripes && Math.floor(xx / stripes) % 2) c = bg.map((v) => v * 0.6);
      if ((xx - cx) ** 2 + (y - cy) ** 2 < r * r) c = fg;
      const i = (y * S + x) * 4;
      for (let k = 0; k < 3; k++) px[i + k] = c[k] * light + (rnd() - 0.5) * noise;
      px[i + 3] = 255;
    }
  }
  return computeFeatures(px, S);
}

test('Отпечаток: единичная длина, то же фото — похожесть 1', () => {
  const a = scene({ bg: [70, 130, 60], fg: [220, 210, 80] });
  assert.ok(Math.abs(similarity(a, a) - 1) < 1e-5);
});

test('Та же клумба при другом свете и сдвиге похожа сильнее, чем другая клумба', () => {
  const bed1 = scene({ bg: [70, 130, 60], fg: [220, 210, 80] });
  const bed1b = scene({ bg: [70, 130, 60], fg: [220, 210, 80], shift: 4, light: 0.85, noise: 30 });
  const bed2 = scene({ bg: [120, 90, 60], fg: [200, 60, 120], stripes: 6 });
  assert.ok(similarity(bed1, bed1b) > similarity(bed1, bed2) + 0.15, `${similarity(bed1, bed1b)} vs ${similarity(bed1, bed2)}`);
});

test('Голосование соседей выбирает правильную клумбу', () => {
  const labeled = [];
  for (let i = 0; i < 6; i++) {
    labeled.push({ f: scene({ bg: [70, 130, 60], fg: [220, 210, 80], shift: i - 3, noise: 25 }), labels: ['porch'], takenAt: Date.UTC(2025, 5, 1) });
    labeled.push({ f: scene({ bg: [120, 90, 60], fg: [200, 60, 120], stripes: 6, shift: i - 3, noise: 25 }), labels: ['fence'], takenAt: Date.UTC(2025, 5, 1) });
    labeled.push({ f: scene({ bg: [40, 60, 110], fg: [240, 240, 240], cx: 16, cy: 16, r: 10, noise: 25 }), labels: ['pond'], takenAt: Date.UTC(2025, 5, 1) });
  }
  const q = scene({ bg: [120, 90, 60], fg: [200, 60, 120], stripes: 6, shift: 2, light: 0.9, noise: 30 });
  const res = vote(q, labeled, { k: 9 });
  assert.equal(res[0].label, 'fence');
  assert.ok(res[0].share > 0.6, `доля ${res[0].share}`);
  const q2 = meanFeature([scene({ bg: [70, 130, 60], fg: [220, 210, 80], noise: 20 }), scene({ bg: [70, 130, 60], fg: [220, 210, 80], shift: 3, noise: 20 })]);
  assert.equal(vote(q2, labeled)[0].label, 'porch');
});
