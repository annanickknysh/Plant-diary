import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGrid, buildComparison, placeInGrid, cellRange, cellLabel, columnsOf } from '../../js/lib/periods.js';

const at = (y, m, d = 15, h = 12) => new Date(y, m, d, h).getTime();
const ph = (id, y, m, d) => ({ id, takenAt: at(y, m, d) });

test('Столбцы режимов', () => {
  assert.deepEqual(columnsOf('seasons').map((c) => c.key), ['spring', 'summer', 'autumn', 'winter']);
  assert.equal(columnsOf('months').length, 12);
  assert.deepEqual(columnsOf('spring').map((c) => c.label), ['март', 'апрель', 'май']);
  assert.deepEqual(columnsOf('winter').map((c) => c.key), ['11', '0', '1']);
});

test('Положение фото: январь относится к зиме прошлого года', () => {
  assert.deepEqual(placeInGrid(at(2026, 0, 10), 'seasons'), { year: 2025, col: 'winter' });
  assert.deepEqual(placeInGrid(at(2026, 0, 10), 'months'), { year: 2026, col: '0' });
  assert.deepEqual(placeInGrid(at(2026, 0, 10), 'winter'), { year: 2025, col: '0' });
  assert.equal(placeInGrid(at(2026, 5, 10), 'spring'), null);
  assert.deepEqual(placeInGrid(at(2026, 3, 10), 'spring'), { year: 2026, col: '3' });
});

test('Границы и подписи ячеек', () => {
  assert.deepEqual(cellRange('winter', 2025, '1'), [new Date(2026, 1, 1).getTime(), new Date(2026, 2, 1).getTime()]);
  assert.equal(cellLabel('seasons', 2025, 'winter'), 'зима 2025/26');
  assert.equal(cellLabel('winter', 2025, '0'), 'январь 2026');
  assert.equal(cellLabel('spring', 2024, '4'), 'май 2024');
});

test('Сетка сезонов: годы подряд, пропуски, будущее, обложка ближе к середине', () => {
  const photos = [
    ph('a', 2024, 3, 2), ph('b', 2024, 3, 20), ph('c', 2024, 4, 30), // весна 2024
    ph('d', 2026, 6, 1), // лето 2026
  ];
  const now = at(2026, 9, 31);
  const g = buildGrid(photos, 'seasons', { now });
  assert.deepEqual(g.years, [2026, 2025, 2024]);
  const r2024 = g.rows.find((r) => r.year === 2024);
  const spring = r2024.cells[0];
  assert.equal(spring.photos.length, 3);
  assert.equal(spring.cover.id, 'b', 'середина весны — середина апреля');
  assert.equal(r2024.cells[1].state, 'empty');
  const r2026 = g.rows[0];
  assert.equal(r2026.cells[1].state, 'photos');
  assert.equal(r2026.cells[3].state, 'future', 'зима 2026 ещё впереди');
  assert.equal(g.rows[1].cells.every((c) => c.state === 'empty'), true, '2025 — пустой год всё равно показан');
});

test('Сетка: закреплённая обложка и фильтр лет', () => {
  const photos = [ph('a', 2024, 3, 2), ph('b', 2024, 3, 20), ph('z', 2025, 3, 20)];
  const g = buildGrid(photos, 'spring', { pins: { 'spring:2024:3': 'a' }, years: new Set([2024]) });
  assert.deepEqual(g.rows.map((r) => r.year), [2024]);
  assert.equal(g.rows[0].cells[1].cover.id, 'a');
  assert.deepEqual(g.years, [2025, 2024], 'список всех лет для фильтра не зависит от выбора');
});

test('Сравнение клумб: только периоды с фото, новые сверху, ячейка на каждую клумбу', () => {
  const groups = [
    { id: 'porch', photos: [ph('p1', 2025, 4, 14), ph('p2', 2026, 4, 17)] },
    { id: 'fence', photos: [ph('f1', 2025, 4, 16), ph('f2', 2025, 6, 11)] },
  ];
  const rows = buildComparison(groups, 'seasons');
  assert.deepEqual(rows.map((r) => r.label), ['весна 2026', 'лето 2025', 'весна 2025']);
  assert.deepEqual(rows[0].cells.map((c) => c.photos.length), [1, 0]);
  assert.deepEqual(rows[2].cells.map((c) => c.cover?.id), ['p1', 'f1']);
});
