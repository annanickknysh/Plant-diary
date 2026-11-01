import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSlides } from '../../js/lib/slideshow.js';

const ph = (y, m, d) => ({ id: `${y}-${m}-${d}`, takenAt: new Date(y, m - 1, d, 12).getTime() });
const photos = [ph(2025, 6, 20), ph(2024, 6, 1), ph(2024, 7, 15), ph(2024, 9, 1), ph(2026, 6, 5), ph(2025, 12, 20), ph(2026, 1, 10)];

test('все фото — по порядку от старых к новым', () => {
  const s = buildSlides(photos, { mode: 'all' });
  assert.equal(s.length, 7);
  assert.equal(s[0].photo.id, '2024-6-1');
  assert.equal(s.at(-1).photo.id, '2026-6-5');
});

test('один год', () => {
  assert.deepEqual(buildSlides(photos, { mode: 'year', year: 2024 }).map((x) => x.photo.id), ['2024-6-1', '2024-7-15', '2024-9-1']);
});

test('сезон по годам — разделитель перед каждым годом', () => {
  const s = buildSlides(photos, { mode: 'season', season: 'summer' });
  assert.deepEqual(s.map((x) => x.divider || x.photo.id), ['Лето 2024', '2024-6-1', '2024-7-15', 'Лето 2025', '2025-6-20', 'Лето 2026', '2026-6-5']);
  assert.equal(s[0].count, 2);
});

test('зима относится к году, в котором началась', () => {
  const s = buildSlides(photos, { mode: 'season', season: 'winter' });
  assert.deepEqual(s.map((x) => x.divider || x.photo.id), ['Зима 2025–26', '2025-12-20', '2026-1-10']);
});
