import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseExif, parseExifDate } from '../../js/lib/exif.js';
import { groupWalks } from '../../js/lib/walks.js';
import { seasonOf, seasonRange } from '../../js/lib/seasons.js';
import { formatDate, formatTime, plural, formatNumber, formatBytes } from '../../js/lib/format.js';
import { distanceMeters, centerOf } from '../../js/lib/geo.js';

const fixture = (name) => {
  const b = readFileSync(new URL(`../fixtures/${name}`, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

test('EXIF: дата съёмки из DateTimeOriginal, а не DateTime', () => {
  const r = parseExif(fixture('with-exif.jpg'));
  assert.equal(r.takenAt, new Date(2023, 3, 14, 9, 12, 30).getTime());
});

test('EXIF: координаты GPS', () => {
  const r = parseExif(fixture('with-exif.jpg'));
  assert.ok(Math.abs(r.lat - 55.756) < 0.001, `lat ${r.lat}`);
  assert.ok(Math.abs(r.lon - 37.618) < 0.001, `lon ${r.lon}`);
});

test('EXIF: фото без EXIF и не-JPEG', () => {
  assert.deepEqual(parseExif(fixture('no-exif.jpg')), { takenAt: null, lat: null, lon: null });
  assert.deepEqual(parseExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer), { takenAt: null, lat: null, lon: null });
});

test('EXIF: разбор строки даты', () => {
  assert.equal(parseExifDate('2025:06:01 18:05:00'), new Date(2025, 5, 1, 18, 5, 0).getTime());
  assert.equal(parseExifDate('0000:00:00 00:00:00'), null);
  assert.equal(parseExifDate(undefined), null);
});

test('Прогулки: перерыв больше порога начинает новую', () => {
  const t0 = new Date(2023, 3, 14, 9, 0).getTime();
  const min = 60 * 1000;
  const photos = [
    { id: 'c', takenAt: t0 + 25 * min },
    { id: 'a', takenAt: t0 },
    { id: 'b', takenAt: t0 + 19 * min },
    { id: 'd', takenAt: t0 + 50 * min },
  ];
  const walks = groupWalks(photos, 20);
  assert.deepEqual(walks.map((w) => w.photos.map((p) => p.id)), [['a', 'b', 'c'], ['d']]);
  assert.equal(walks[0].id, 'a');
  assert.equal(walks[0].end, t0 + 25 * min);
});

test('Прогулки: пустой список', () => {
  assert.deepEqual(groupWalks([], 20), []);
});

test('Сезоны: границы и зима через Новый год', () => {
  assert.deepEqual(seasonOf(new Date(2025, 2, 1).getTime()), { season: 'spring', year: 2025 });
  assert.deepEqual(seasonOf(new Date(2025, 4, 31).getTime()), { season: 'spring', year: 2025 });
  assert.deepEqual(seasonOf(new Date(2025, 5, 1).getTime()), { season: 'summer', year: 2025 });
  assert.deepEqual(seasonOf(new Date(2025, 10, 30).getTime()), { season: 'autumn', year: 2025 });
  assert.deepEqual(seasonOf(new Date(2025, 11, 15).getTime()), { season: 'winter', year: 2025 });
  assert.deepEqual(seasonOf(new Date(2026, 1, 10).getTime()), { season: 'winter', year: 2025 });
  const [s, e] = seasonRange('winter', 2025);
  assert.equal(s, new Date(2025, 11, 1).getTime());
  assert.equal(e, new Date(2026, 2, 1).getTime());
});

test('Форматирование по-русски', () => {
  assert.equal(formatDate(new Date(2023, 3, 14).getTime()), '14 апреля 2023');
  assert.equal(formatTime(new Date(2023, 3, 14, 9, 5).getTime()), '9:05');
  assert.equal(plural(1, ['растение', 'растения', 'растений']), 'растение');
  assert.equal(plural(3, ['растение', 'растения', 'растений']), 'растения');
  assert.equal(plural(12, ['растение', 'растения', 'растений']), 'растений');
  assert.equal(plural(21, ['растение', 'растения', 'растений']), 'растение');
  assert.equal(formatNumber(4812), '4 812');
  assert.equal(formatBytes(1.5 * 1024 ** 3), '1,5 ГБ');
});

test('Гео: расстояние и центр', () => {
  const a = { lat: 55.75, lon: 37.61 };
  const b = { lat: 55.7501, lon: 37.61 };
  const d = distanceMeters(a, b);
  assert.ok(d > 10 && d < 12, `d=${d}`);
  assert.deepEqual(centerOf([{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }, { lat: null }]), { lat: 2, lon: 3 });
  assert.equal(centerOf([{}]), null);
});
