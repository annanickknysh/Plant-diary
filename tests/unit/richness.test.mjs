import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRich, addPhoto, richLabel, richScore } from '../../js/lib/richness.js';

const at = (y, m, d = 10) => new Date(y, m - 1, d, 12).getTime();

test('отметка: годы, сезоны в разных годах, избранные пары', () => {
  const r = newRich();
  [at(2024, 6), at(2025, 7), at(2026, 6), at(2024, 10), at(2026, 9), at(2025, 4)].forEach((t) => addPhoto(r, t));
  r.stars = 2;
  assert.equal(richLabel(r), '★2 · 3 года · лето ×3 · осень ×2');
  assert.ok(richScore(r) > 0);
});

test('один год — хвалиться нечем', () => {
  const r = newRich();
  [at(2025, 5), at(2025, 6)].forEach((t) => addPhoto(r, t));
  assert.equal(richLabel(r), '');
  assert.equal(richScore(r), 0);
});

test('зима 2025–26 — один сезон, хоть и в двух календарных годах', () => {
  const r = newRich();
  [at(2025, 12), at(2026, 1)].forEach((t) => addPhoto(r, t));
  assert.equal(r.seasons.winter.size, 1);
  assert.equal(richLabel(r), '2 года');
});

test('пять лет — «5 лет»', () => {
  const r = newRich();
  [2020, 2021, 2022, 2023, 2024].forEach((y) => addPhoto(r, at(y, 3)));
  assert.equal(richLabel(r), '5 лет · весна ×5');
});
