import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFeatures, viewSimilarity, bestPairs } from '../../js/lib/features.js';

const S = 64;
// Простая «сцена»: небо сверху, дом слева или справа, трава снизу; палитра меняется по сезону
function scene({ house = 'left', season = 'summer' }) {
  const px = new Uint8ClampedArray(S * S * 4);
  const grass = season === 'summer' ? [70, 140, 60] : [170, 120, 50];
  const sky = season === 'summer' ? [150, 190, 230] : [180, 185, 195];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let c = y < 20 ? sky : grass;
    const hx = house === 'left' ? [6, 28] : [36, 58];
    if (x >= hx[0] && x < hx[1] && y >= 12 && y < 36) c = [200, 170, 130];
    if (x >= hx[0] + 6 && x < hx[0] + 12 && y >= 18 && y < 26) c = [60, 80, 100];
    const i = (y * S + x) * 4;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
  }
  return computeFeatures(px, S);
}

test('тот же ракурс в другой сезон похож больше, чем другой ракурс в тот же сезон', () => {
  const sameView = viewSimilarity(scene({ house: 'left', season: 'summer' }), scene({ house: 'left', season: 'autumn' }));
  const otherView = viewSimilarity(scene({ house: 'left', season: 'summer' }), scene({ house: 'right', season: 'summer' }));
  assert.ok(sameView > otherView, `${sameView} > ${otherView}`);
  assert.ok(sameView > 0.9);
});

test('пары подбираются по ракурсу, каждое фото один раз', () => {
  const A = [{ id: 'a-left', f: scene({ house: 'left' }) }, { id: 'a-right', f: scene({ house: 'right' }) }];
  const B = [{ id: 'b-right', f: scene({ house: 'right', season: 'autumn' }) }, { id: 'b-left', f: scene({ house: 'left', season: 'autumn' }) }];
  const pairs = bestPairs(A, B);
  assert.equal(pairs.length, 2);
  const map = Object.fromEntries(pairs.map((p) => [p.a, p.b]));
  assert.deepEqual(map, { 'a-left': 'b-left', 'a-right': 'b-right' });
});

test('оценки: пара с 👎 больше не предлагается, с 👍 — первой', async () => {
  const A = [{ id: 'a-left', f: scene({ house: 'left' }) }, { id: 'a-right', f: scene({ house: 'right' }) }];
  const B = [{ id: 'b-right', f: scene({ house: 'right', season: 'autumn' }) }, { id: 'b-left', f: scene({ house: 'left', season: 'autumn' }) }];
  const { bestPairs: bp } = await import('../../js/lib/features.js');
  const pairs = bp(A, B, 6, { disliked: new Set(['a-left|b-left']), liked: new Set(['a-right|b-left']) });
  assert.equal(pairs[0].a, 'a-right');
  assert.equal(pairs[0].b, 'b-left');
  assert.ok(pairs[0].liked);
  assert.ok(!pairs.some((p) => p.a === 'a-left' && p.b === 'b-left'));
});

test('веса подстраиваются по оценкам', async () => {
  const { fitViewWeights } = await import('../../js/lib/features.js');
  assert.equal(fitViewWeights([{ parts: { lum: 1, tex: 0, full: 0 }, good: true }]), null);
  // Хорошие пары отличаются только по линиям — вес линий должен вырасти
  const votes = [];
  for (let i = 0; i < 5; i++) votes.push({ parts: { lum: 0.5, tex: 0.9 + i * 0.01, full: 0.5 }, good: true });
  for (let i = 0; i < 5; i++) votes.push({ parts: { lum: 0.9, tex: 0.3, full: 0.9 }, good: false });
  const w = fitViewWeights(votes);
  assert.ok(w.tex > 0.5, JSON.stringify(w));
});
